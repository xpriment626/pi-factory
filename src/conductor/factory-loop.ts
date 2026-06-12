import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createBlackboard } from "../blackboard/db.js";
import type { Blackboard } from "../blackboard/db.js";
import type { ReviewVerdictValue, Ticket } from "../blackboard/types.js";
import { createRunContext, writeCoralConfig } from "../coral/config.js";
import { createFactorySession, puppetCreateThread, puppetSendThreadMessage } from "../coral/client.js";
import { mirrorCoralEvents } from "../coral/mirror.js";
import { startCoral, waitForCoral } from "../coral/server.js";
import { runPiAgentTurn, runPiToolAgent } from "../pi/live.js";
import { createApiServer } from "./api.js";
import { readGoalWithReferences, scaffoldNotionLiteApp } from "./app-scaffold.js";
import { requireFactoryCompletionGate } from "./coordination-gate.js";
import { createTicketsFromPlan, defaultPlannerTicketPlan, parsePlannerTicketPlan } from "./planner-tickets.js";
import { selectFactoryTicketPhases } from "./ticket-phases.js";

export type FactoryLoopOptions = {
  factoryRoot: string;
  targetDir: string;
  goal: string;
  runRoot?: string;
  runId?: string;
  startGateway?: boolean;
  gatewayPort?: number;
  apiPort?: number;
  coralMode?: "live" | "recorded" | "skip";
};

export type FactoryLoopResult = {
  completed: boolean;
  runId: string;
  dbPath: string;
  targetDir: string;
  gatewayUrl: string;
  summary: string;
  collaborationEvents: number;
  ticketsCompleted: number;
};

type CommandResult = {
  command: string;
  code: number | null;
  stdout: string;
  stderr: string;
};

type FileSnapshot = Map<string, { size: number; mtimeMs: number }>;
type ReviewCycleResult = {
  architectVerdict: ReviewVerdictValue;
  reviewerVerdict: ReviewVerdictValue;
  feedback: string;
};

const MAX_REVIEW_CYCLES = 2;

function runCommand(command: string, args: readonly string[], cwd: string, timeoutMs = 120000): Promise<CommandResult> {
  const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
  return new Promise((resolve) => {
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ command: [command, ...args].join(" "), code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function recordCommand(board: Blackboard, input: { runId: string; ticketId?: string; agentId: string; cwd: string; result: CommandResult }) {
  board.recordAgentLog({
    runId: input.runId,
    agentId: input.agentId,
    level: input.result.code === 0 ? "info" : "error",
    message: `${input.result.command} exited ${input.result.code}`,
    data: { stdout: input.result.stdout.slice(-2000), stderr: input.result.stderr.slice(-2000) }
  });
  board.recordCommandEvidence({
    runId: input.runId,
    ticketId: input.ticketId,
    agentId: input.agentId,
    command: input.result.command,
    cwd: input.cwd,
    exitCode: input.result.code,
    stdout: input.result.stdout.slice(-4000),
    stderr: input.result.stderr.slice(-4000)
  });
  if (input.result.code !== 0) throw new Error(`${input.result.command} failed: ${input.result.stderr || input.result.stdout}`);
}

const ignoredFileParts = new Set(["node_modules", ".git", ".factory", "dist"]);

function snapshotFiles(root: string): FileSnapshot {
  const snapshot: FileSnapshot = new Map();
  if (!existsSync(root)) return snapshot;
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignoredFileParts.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = statSync(path);
      snapshot.set(relative(root, path), { size: stat.size, mtimeMs: stat.mtimeMs });
    }
  };
  visit(root);
  return snapshot;
}

function recordFileChanges(input: { board: Blackboard; runId: string; ticketId?: string; agentId: string; before: FileSnapshot; after: FileSnapshot }) {
  for (const [path, afterStat] of input.after) {
    const beforeStat = input.before.get(path);
    if (beforeStat && beforeStat.size === afterStat.size && beforeStat.mtimeMs === afterStat.mtimeMs) continue;
    input.board.recordCodeEvidence({
      runId: input.runId,
      ticketId: input.ticketId,
      agentId: input.agentId,
      path,
      action: beforeStat ? "modified" : "created",
      summary: `${beforeStat ? "Modified" : "Created"} ${path}`
    });
  }
}

function loadArchitectPlaybook(factoryRoot: string) {
  const architectRoot = join(factoryRoot, "agents", "architect");
  const chunks: string[] = [];
  const playbookPath = join(architectRoot, "playbook.md");
  if (existsSync(playbookPath)) chunks.push(readFileSync(playbookPath, "utf8").trim());

  const skillsDir = join(architectRoot, "skills");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      chunks.push(readFileSync(join(skillsDir, entry.name), "utf8").trim());
    }
  }

  return chunks.filter(Boolean).join("\n\n---\n\n");
}

function defaultArchitectureBrief() {
  return [
    "Architecture brief:",
    "- Build a local-only Notion Lite app with a small HTTP API, browser UI, and local persistence.",
    "- Keep the implementation simple enough for npm install, npm run build, and npm test to exercise.",
    "- Provide task and note flows, input validation, and no credential handling.",
    "- Review actual files for API/data/UI consistency before green-lighting."
  ].join("\n");
}

function implementerPrompt(input: { goal: string; ticketTitles: string[]; architectureBrief: string; revisionFeedback?: string }) {
  return [
    "You are the implementer in a Pi factory run.",
    "Work in the current project directory. Use tools to create and edit files.",
    "Build the smallest runnable Notion Lite app described by the PRD/goal.",
    "Required app surface: kanban tasks, freeform notes, local backend/API or equivalent local server, browser UI, package scripts.",
    "Required commands: npm install, npm run build, npm test. Create scripts/tests that make these commands meaningful.",
    "If you start a local server for smoke testing, stop it before finishing. Do not leave background processes running.",
    "Prefer no external dependencies unless needed.",
    "Do not modify files outside the current project directory.",
    `Tickets: ${input.ticketTitles.join(" | ")}`,
    `Architecture brief:\n${input.architectureBrief}`,
    input.revisionFeedback ? `Revision feedback to address:\n${input.revisionFeedback}` : "",
    `Goal:\n${input.goal}`,
    "Finish with a concise summary of files created/edited and command results."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function architectBriefPrompt(input: { goal: string; ticketTitles: string[]; playbook: string }) {
  return [
    "You are the architect in a Pi factory run.",
    "Create the architecture brief before implementation starts.",
    "Use the local architect playbook below. Do not mention hidden or external skills.",
    "Return concise markdown with sections: stack, data model, API contract, file layout, risks, review checklist.",
    `Architect playbook:\n${input.playbook || "Use a small, local, testable architecture with explicit API/data/UI boundaries."}`,
    `Tickets: ${input.ticketTitles.join(" | ")}`,
    `Goal:\n${input.goal}`
  ].join("\n\n");
}

function reviewerPrompt(input: { goal: string; architectureBrief: string; verificationSummary: string; cycle: number }) {
  return [
    "You are the reviewer in a Pi factory run.",
    "Work in the current project directory. Use only read/search/list/bash style tools.",
    "Inspect the generated code against the PRD/goal.",
    "Run npm install, npm run build, and npm test if package.json is present.",
    "If you start a local server for smoke testing, stop it before finishing. Do not leave background processes running.",
    "Return a verdict using exactly one line: VERDICT: green or VERDICT: changes_requested.",
    "Use changes_requested if the app does not run, tests fail, or PRD acceptance is incomplete.",
    `Review cycle: ${input.cycle}`,
    `Architecture brief:\n${input.architectureBrief}`,
    `Verification evidence:\n${input.verificationSummary}`,
    `Goal:\n${input.goal}`,
    "After the verdict line, include concrete evidence and any required changes."
  ].join("\n\n");
}

function architectReviewPrompt(input: { goal: string; architectureBrief: string; verificationSummary: string; playbook: string; cycle: number }) {
  return [
    "You are the architect reviewer in a Pi factory run.",
    "Inspect actual files in the current project directory with read/search/bash tools.",
    "Compare the implementation to the architecture brief, API/data/UI boundaries, and risk checklist.",
    "Return a verdict using exactly one line: VERDICT: green or VERDICT: changes_requested.",
    "Use changes_requested for architecture mismatch, insecure handling, leaked credentials, unbounded side effects, or untestable structure.",
    `Review cycle: ${input.cycle}`,
    `Architect playbook:\n${input.playbook || "Check boundaries, risks, tests, and local-only behavior."}`,
    `Architecture brief:\n${input.architectureBrief}`,
    `Verification evidence:\n${input.verificationSummary}`,
    `Goal:\n${input.goal}`,
    "After the verdict line, include concrete evidence and required changes if any."
  ].join("\n\n");
}

function readyForReviewPrompt(input: { goal: string; architectureBrief: string; verificationSummary: string; cycle: number }) {
  return [
    "You are the implementer in a Pi factory run.",
    "Post one Coral-ready message announcing readiness for architect and reviewer review.",
    "The message must include the literal token ready_for_review.",
    `Review cycle: ${input.cycle}`,
    `Architecture brief:\n${input.architectureBrief}`,
    `Verification evidence:\n${input.verificationSummary}`,
    `Goal:\n${input.goal}`
  ].join("\n\n");
}

function plannerTicketPrompt(goal: string) {
  return [
    "You are the planner in a Pi factory run.",
    "Read the goal/PRD and create the implementation tickets that the agent team should execute.",
    "Return only JSON with this exact shape:",
    '{"tickets":[{"title":"...","description":"...","ownerAgent":"planner|architect|implementer|reviewer","collaboratorAgents":["..."],"acceptanceCriteria":"...","priority":1}]}',
    "Requirements:",
    "- Include planner, implementer, and reviewer in the ticket plan.",
    "- Include at least one implementation ticket and one validation/review ticket.",
    "- Make tickets concrete enough for a small engineering team to execute.",
    `Goal:\n${goal}`
  ].join("\n\n");
}

async function runLivePlannerHarness(input: {
  board: Blackboard;
  runId: string;
  targetDir: string;
  runDir: string;
  goal: string;
}) {
  const planner = await runPiAgentTurn({
    cwd: input.targetDir,
    sessionDir: join(input.runDir, "pi-sessions"),
    role: "planner",
    prompt: plannerTicketPrompt(input.goal),
    timeoutMs: 180000
  });
  const ticketPlan = parsePlannerTicketPlan(planner.response);
  input.board.recordAgentLog({
    runId: input.runId,
    agentId: "planner",
    level: "pi-planner",
    message: "Pi planner created ticket plan",
    data: {
      command: planner.command,
      role: planner.role,
      sessionPath: planner.sessionPath,
      response: planner.response.slice(0, 4000),
      stderr: planner.stderr.slice(-2000),
      ticketIdsTouched: [],
      ticketPlan
    }
  });
  return ticketPlan;
}

async function runLiveArchitectBriefHarness(input: {
  board: Blackboard;
  runId: string;
  targetDir: string;
  runDir: string;
  goal: string;
  tickets: Ticket[];
  playbook: string;
}) {
  const architect = await runPiAgentTurn({
    cwd: input.targetDir,
    sessionDir: join(input.runDir, "pi-sessions"),
    role: "architect",
    prompt: architectBriefPrompt({
      goal: input.goal,
      ticketTitles: input.tickets.map((ticket) => ticket.title),
      playbook: input.playbook
    }),
    timeoutMs: 180000
  });
  input.board.recordAgentLog({
    runId: input.runId,
    agentId: "architect",
    level: "architecture-brief",
    message: "Pi architect produced architecture brief",
    data: {
      command: architect.command,
      role: architect.role,
      sessionPath: architect.sessionPath,
      response: architect.response.slice(0, 4000),
      stderr: architect.stderr.slice(-2000),
      ticketIdsTouched: input.tickets.filter((ticket) => ticket.ownerAgent === "architect").map((ticket) => ticket.id)
    }
  });
  return input.board.recordArchitectureBrief({
    runId: input.runId,
    agentId: "architect",
    body: architect.response.slice(0, 8000)
  });
}

async function runLiveImplementationHarness(input: {
  board: Blackboard;
  runId: string;
  targetDir: string;
  runDir: string;
  goal: string;
  tickets: Ticket[];
  architectureBrief: string;
  revisionFeedback?: string;
}) {
  const implementationTicket = input.tickets.find((ticket) => ticket.ownerAgent === "implementer") ?? input.tickets[0];
  const before = snapshotFiles(input.targetDir);
  const implementer = await runPiToolAgent({
    cwd: input.targetDir,
    sessionDir: join(input.runDir, "pi-sessions"),
    role: "implementer",
    tools: ["read", "write", "edit", "bash", "ls", "grep", "find"],
    prompt: implementerPrompt({
      goal: input.goal,
      ticketTitles: input.tickets.map((ticket) => ticket.title),
      architectureBrief: input.architectureBrief,
      revisionFeedback: input.revisionFeedback
    }),
    timeoutMs: 900000
  });
  input.board.recordAgentLog({
    runId: input.runId,
    agentId: "implementer",
    level: "pi-tool-agent",
    message: "Pi implementer tool harness completed",
    data: {
      command: implementer.command,
      sessionPath: implementer.sessionPath,
      response: implementer.response.slice(0, 4000),
      stderr: implementer.stderr.slice(-2000),
      ticketIdsTouched: implementationTicket ? [implementationTicket.id] : []
    }
  });
  recordFileChanges({
    board: input.board,
    runId: input.runId,
    ticketId: implementationTicket?.id,
    agentId: "implementer",
    before,
    after: snapshotFiles(input.targetDir)
  });
}

function parseReviewVerdict(output: string): ReviewVerdictValue {
  const match = output.match(/verdict\s*:\s*(green|changes[_ ]requested)/i);
  if (!match) return "changes_requested";
  return match[1]!.toLowerCase().replace(" ", "_") as ReviewVerdictValue;
}

async function runLiveReviewerHarness(input: {
  board: Blackboard;
  runId: string;
  targetDir: string;
  runDir: string;
  goal: string;
  architectureBrief: string;
  verificationSummary: string;
  cycle: number;
  ticketId?: string;
}) {
  const reviewer = await runPiToolAgent({
    cwd: input.targetDir,
    sessionDir: join(input.runDir, "pi-sessions"),
    role: "reviewer",
    tools: ["read", "bash", "ls", "grep", "find"],
    prompt: reviewerPrompt({
      goal: input.goal,
      architectureBrief: input.architectureBrief,
      verificationSummary: input.verificationSummary,
      cycle: input.cycle
    }),
    timeoutMs: 600000
  });
  const verdict = parseReviewVerdict(reviewer.response);
  input.board.recordAgentLog({
    runId: input.runId,
    agentId: "reviewer",
    level: "pi-tool-agent",
    message: "Pi reviewer tool harness completed",
    data: {
      command: reviewer.command,
      sessionPath: reviewer.sessionPath,
      response: reviewer.response.slice(0, 4000),
      stderr: reviewer.stderr.slice(-2000),
      ticketIdsTouched: input.ticketId ? [input.ticketId] : [],
      verdict,
      cycle: input.cycle
    }
  });
  input.board.recordReviewVerdict({
    runId: input.runId,
    cycle: input.cycle,
    agentId: "reviewer",
    verdict,
    body: reviewer.response.slice(0, 4000)
  });
  if (input.ticketId) {
    input.board.appendTicketEvent({
      ticketId: input.ticketId,
      agentId: "reviewer",
      eventType: "verification",
      body: reviewer.response.slice(0, 4000)
    });
  }
  return { response: reviewer.response, verdict };
}

async function runLiveArchitectReviewHarness(input: {
  board: Blackboard;
  runId: string;
  targetDir: string;
  runDir: string;
  goal: string;
  architectureBrief: string;
  verificationSummary: string;
  playbook: string;
  cycle: number;
  ticketId?: string;
}) {
  const architect = await runPiToolAgent({
    cwd: input.targetDir,
    sessionDir: join(input.runDir, "pi-sessions"),
    role: "architect",
    tools: ["read", "bash", "ls", "grep", "find"],
    prompt: architectReviewPrompt({
      goal: input.goal,
      architectureBrief: input.architectureBrief,
      verificationSummary: input.verificationSummary,
      playbook: input.playbook,
      cycle: input.cycle
    }),
    timeoutMs: 600000
  });
  const verdict = parseReviewVerdict(architect.response);
  input.board.recordAgentLog({
    runId: input.runId,
    agentId: "architect",
    level: "pi-tool-agent",
    message: "Pi architect review harness completed",
    data: {
      command: architect.command,
      sessionPath: architect.sessionPath,
      response: architect.response.slice(0, 4000),
      stderr: architect.stderr.slice(-2000),
      ticketIdsTouched: input.ticketId ? [input.ticketId] : [],
      verdict,
      cycle: input.cycle
    }
  });
  input.board.recordReviewVerdict({
    runId: input.runId,
    cycle: input.cycle,
    agentId: "architect",
    verdict,
    body: architect.response.slice(0, 4000)
  });
  if (input.ticketId) {
    input.board.appendTicketEvent({
      ticketId: input.ticketId,
      agentId: "architect",
      eventType: "architecture_review",
      body: architect.response.slice(0, 4000)
    });
  }
  return { response: architect.response, verdict };
}

function completeTicket(board: Blackboard, ticket: Ticket, agentId: string, body: string) {
  board.appendTicketEvent({ ticketId: ticket.id, agentId, eventType: "progress", body });
  board.updateTicket({ ticketId: ticket.id, status: "done", ownerAgent: agentId, collaboratorAgents: ticket.collaboratorAgents });
}

function recordCoordinationMessage(input: {
  board: Blackboard;
  runId: string;
  sessionId: string;
  threadId: string;
  senderAgent: string;
  mentions: string[];
  body: string;
  messageId?: string;
  raw?: unknown;
}) {
  const message = input.board.recordCoralMessage({
    id: input.messageId,
    runId: input.runId,
    sessionId: input.sessionId,
    threadId: input.threadId,
    senderAgent: input.senderAgent,
    mentions: input.mentions,
    body: input.body
  });
  input.board.recordCoralEvent({
    runId: input.runId,
    sessionId: input.sessionId,
    threadId: input.threadId,
    eventType: "thread_message_sent",
    agentId: input.senderAgent,
    body: input.body,
    raw: input.raw ?? { type: "thread_message_sent", message }
  });
  return message;
}

function recordSyntheticArchitectureBriefThread(board: Blackboard, runId: string, architectureBrief: string) {
  const thread = board.recordCoralThread({
    id: `${runId}-architecture-thread`,
    runId,
    sessionId: `${runId}-recorded-session`,
    name: "Architecture handoff",
    creatorAgent: "planner",
    participants: ["planner", "architect", "implementer"],
    state: { mode: "recorded" }
  });
  recordCoordinationMessage({
    board,
    runId,
    sessionId: thread.sessionId!,
    threadId: thread.id,
    senderAgent: "planner",
    mentions: ["architect"],
    body: "Planner request: architect, produce the architecture brief before implementation starts."
  });
  recordCoordinationMessage({
    board,
    runId,
    sessionId: thread.sessionId!,
    threadId: thread.id,
    senderAgent: "architect",
    mentions: ["planner", "implementer"],
    body: architectureBrief
  });
}

function recordSyntheticReviewCycle(board: Blackboard, runId: string, input: { cycle: number; ticketId: string; verificationSummary: string }) {
  const thread = board.recordCoralThread({
    id: `${runId}-review-thread-${input.cycle}`,
    runId,
    sessionId: `${runId}-recorded-session`,
    name: `Review cycle ${input.cycle}`,
    creatorAgent: "implementer",
    participants: ["implementer", "architect", "reviewer"],
    state: { mode: "recorded", cycle: input.cycle }
  });
  recordCoordinationMessage({
    board,
    runId,
    sessionId: thread.sessionId!,
    threadId: thread.id,
    senderAgent: "implementer",
    mentions: ["architect", "reviewer"],
    body: `ready_for_review: implementation is ready for cycle ${input.cycle}; ${input.verificationSummary}.`
  });
  recordCoordinationMessage({
    board,
    runId,
    sessionId: thread.sessionId!,
    threadId: thread.id,
    senderAgent: "architect",
    mentions: ["implementer", "reviewer"],
    body: "VERDICT: green\nArchitecture review passed against the generated files."
  });
  recordCoordinationMessage({
    board,
    runId,
    sessionId: thread.sessionId!,
    threadId: thread.id,
    senderAgent: "reviewer",
    mentions: ["implementer", "architect"],
    body: "VERDICT: green\nReviewer accepted completion because runnable code exists and verification commands passed."
  });
  board.recordReviewVerdict({
    runId,
    cycle: input.cycle,
    agentId: "architect",
    verdict: "green",
    body: "Architecture review passed against the generated files."
  });
  board.recordReviewVerdict({
    runId,
    cycle: input.cycle,
    agentId: "reviewer",
    verdict: "green",
    body: "Reviewer accepted completion because runnable code exists and verification commands passed."
  });
  board.appendTicketEvent({
    ticketId: input.ticketId,
    agentId: "reviewer",
    eventType: "verification",
    body: "Reviewer verification commands passed."
  });
}

async function recordLiveThreadMessages(
  board: Blackboard,
  ctx: ReturnType<typeof createRunContext>,
  input: {
    threadName: string;
    creatorAgent: string;
    participants: string[];
    state: unknown;
    messages: Array<{ senderAgent: string; mentions: string[]; body: string; command?: string }>;
  }
) {
  const coral = startCoral(ctx);
  try {
    await waitForCoral("http://127.0.0.1:5555", 180000, coral);
    const session = await createFactorySession({ baseUrl: "http://127.0.0.1:5555", ctx });
    const mirror = await mirrorCoralEvents({
      board,
      runId: ctx.runId,
      authKey: ctx.authKey,
      namespace: session.namespace,
      sessionId: session.sessionId,
      minEvents: input.messages.length,
      timeoutMs: 25000,
      afterOpen: async () => {
        const threadBody = await puppetCreateThread({
          baseUrl: "http://127.0.0.1:5555",
          authKey: ctx.authKey,
          namespace: session.namespace,
          sessionId: session.sessionId,
          senderName: input.creatorAgent,
          threadName: input.threadName,
          participantNames: input.participants.filter((participant) => participant !== input.creatorAgent)
        });
        const thread = threadBody.thread as { id: string; name?: string };
        board.recordCoralThread({
          id: thread.id,
          runId: ctx.runId,
          sessionId: session.sessionId,
          name: thread.name ?? input.threadName,
          creatorAgent: input.creatorAgent,
          participants: input.participants,
          state: { mode: "live", namespace: session.namespace, ...((input.state && typeof input.state === "object") ? input.state : {}) }
        });

        for (const message of input.messages) {
          const puppetMessage = await puppetSendThreadMessage({
            baseUrl: "http://127.0.0.1:5555",
            authKey: ctx.authKey,
            namespace: session.namespace,
            sessionId: session.sessionId,
            senderName: message.senderAgent,
            threadId: thread.id,
            content: message.body,
            mentions: message.mentions
          });
          const puppetMessageBody = puppetMessage as { message?: { id?: unknown } };
          const messageId =
            typeof puppetMessageBody.message?.id === "string" ? puppetMessageBody.message.id : undefined;
          recordCoordinationMessage({
            board,
            runId: ctx.runId,
            sessionId: session.sessionId,
            threadId: thread.id,
            senderAgent: message.senderAgent,
            mentions: message.mentions,
            body: message.body,
            messageId,
            raw: { type: "thread_message_sent", source: "pi_agent_turn", command: message.command, puppetMessage }
          });
        }
      }
    });
    return Math.max(mirror.events.length, 1);
  } finally {
    await coral.stop();
  }
}

async function recordLiveArchitectureBriefThread(input: {
  board: Blackboard;
  ctx: ReturnType<typeof createRunContext>;
  architectureBrief: string;
}) {
  return await recordLiveThreadMessages(input.board, input.ctx, {
    threadName: "Architecture handoff",
    creatorAgent: "planner",
    participants: ["planner", "architect", "implementer"],
    state: { phase: "architecture" },
    messages: [
      {
        senderAgent: "planner",
        mentions: ["architect"],
        body: "Planner request: architect, produce the architecture brief before implementation starts."
      },
      {
        senderAgent: "architect",
        mentions: ["planner", "implementer"],
        body: input.architectureBrief
      }
    ]
  });
}

async function runLiveReviewCycle(input: {
  board: Blackboard;
  ctx: ReturnType<typeof createRunContext>;
  targetDir: string;
  runDir: string;
  goal: string;
  architectureBrief: string;
  verificationSummary: string;
  playbook: string;
  cycle: number;
  ticketId: string;
}): Promise<ReviewCycleResult> {
  const ready = await runPiAgentTurn({
    cwd: input.targetDir,
    sessionDir: join(input.runDir, "pi-sessions", "factory-agents"),
    role: "implementer",
    prompt: readyForReviewPrompt({
      goal: input.goal,
      architectureBrief: input.architectureBrief,
      verificationSummary: input.verificationSummary,
      cycle: input.cycle
    }),
    timeoutMs: 180000
  });
  const readyBody = ready.response.toLowerCase().includes("ready_for_review") ? ready.response : `ready_for_review: ${ready.response}`;
  input.board.recordAgentLog({
    runId: input.ctx.runId,
    agentId: "implementer",
    level: "ready_for_review",
    message: `Pi implementer posted ready_for_review for cycle ${input.cycle}`,
    data: {
      command: ready.command,
      sessionPath: ready.sessionPath,
      response: readyBody.slice(0, 1200),
      stderr: ready.stderr.slice(-1200),
      cycle: input.cycle,
      ticketIdsTouched: [input.ticketId]
    }
  });

  const architect = await runLiveArchitectReviewHarness({
    board: input.board,
    runId: input.ctx.runId,
    targetDir: input.targetDir,
    runDir: input.runDir,
    goal: input.goal,
    architectureBrief: input.architectureBrief,
    verificationSummary: input.verificationSummary,
    playbook: input.playbook,
    cycle: input.cycle,
    ticketId: input.ticketId
  });
  const reviewer = await runLiveReviewerHarness({
    board: input.board,
    runId: input.ctx.runId,
    targetDir: input.targetDir,
    runDir: input.runDir,
    goal: input.goal,
    architectureBrief: input.architectureBrief,
    verificationSummary: input.verificationSummary,
    cycle: input.cycle,
    ticketId: input.ticketId
  });

  await recordLiveThreadMessages(input.board, input.ctx, {
    threadName: `Review cycle ${input.cycle}`,
    creatorAgent: "implementer",
    participants: ["implementer", "architect", "reviewer"],
    state: { phase: "review", cycle: input.cycle },
    messages: [
      {
        senderAgent: "implementer",
        mentions: ["architect", "reviewer"],
        body: readyBody,
        command: ready.command
      },
      {
        senderAgent: "architect",
        mentions: ["implementer", "reviewer"],
        body: `VERDICT: ${architect.verdict}\n${architect.response}`,
        command: "architect-review"
      },
      {
        senderAgent: "reviewer",
        mentions: ["implementer", "architect"],
        body: `VERDICT: ${reviewer.verdict}\n${reviewer.response}`,
        command: "reviewer-review"
      }
    ]
  });

  const feedback = [
    architect.verdict === "changes_requested" ? `Architect requested changes:\n${architect.response}` : "",
    reviewer.verdict === "changes_requested" ? `Reviewer requested changes:\n${reviewer.response}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    architectVerdict: architect.verdict,
    reviewerVerdict: reviewer.verdict,
    feedback
  };
}

async function startGateway(input: { factoryRoot: string; board: Blackboard; runId: string; apiPort: number; gatewayPort: number }) {
  const api = await createApiServer({ board: input.board, runId: input.runId, factoryRoot: input.factoryRoot, port: input.apiPort });
  const vite = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(input.gatewayPort)], {
    cwd: input.factoryRoot,
    env: { ...process.env, FACTORY_API_PORT: String(api.port) },
    stdio: ["ignore", "ignore", "ignore"]
  });
  return {
    gatewayUrl: `http://127.0.0.1:${input.gatewayPort}`,
    close: async () => {
      vite.kill("SIGTERM");
      await api.close();
    }
  };
}

export async function runFactory(options: FactoryLoopOptions): Promise<FactoryLoopResult> {
  mkdirSync(options.targetDir, { recursive: true });
  const ctx = createRunContext({ projectRoot: options.factoryRoot, runRoot: options.runRoot, runId: options.runId });
  writeCoralConfig(ctx);
  const board = createBlackboard(ctx.dbPath);
  const gatewayPort = options.gatewayPort ?? Number(process.env.FACTORY_GATEWAY_PORT ?? 5173);
  const apiPort = options.apiPort ?? Number(process.env.FACTORY_API_PORT ?? 8787);
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
  let gateway: Awaited<ReturnType<typeof startGateway>> | null = null;

  try {
    const expandedGoal = readGoalWithReferences(options.targetDir, options.goal);
    const project = board.createProject({
      title: "Factory run",
      prompt: expandedGoal,
      status: "active"
    });
    board.createRun({
      runId: ctx.runId,
      projectId: project.id,
      targetDir: options.targetDir,
      goal: options.goal,
      status: "running",
      gatewayUrl
    });
    board.recordAgentLog({ runId: ctx.runId, agentId: "conductor", level: "start", message: "Factory run started", data: { targetDir: options.targetDir } });
    if (options.startGateway) {
      gateway = await startGateway({ factoryRoot: options.factoryRoot, board, runId: ctx.runId, apiPort, gatewayPort });
      board.updateRun({ runId: ctx.runId, gatewayUrl: gateway.gatewayUrl });
    }
    const architectPlaybook = loadArchitectPlaybook(options.factoryRoot);

    const ticketPlan =
      options.coralMode === "recorded" || options.coralMode === "skip"
        ? defaultPlannerTicketPlan()
        : await runLivePlannerHarness({
            board,
            runId: ctx.runId,
            targetDir: options.targetDir,
            runDir: ctx.runDir,
            goal: expandedGoal
          });
    let tickets = createTicketsFromPlan(board, project.id, ticketPlan);
    const ticketPhases = selectFactoryTicketPhases(tickets);
    const completedTicketIds = new Set<string>();
    const completeTickets = (phaseTickets: Ticket[], agentId: string, body: string) => {
      for (const ticket of phaseTickets) {
        if (completedTicketIds.has(ticket.id)) continue;
        completedTicketIds.add(ticket.id);
        completeTicket(board, ticket, agentId, body);
      }
    };
    board.recordAgentLog({
      runId: ctx.runId,
      agentId: "planner",
      level: "tickets",
      message: "Planner tickets persisted to blackboard",
      data: { ticketIdsTouched: tickets.map((ticket) => ticket.id), ticketPlan }
    });

    completeTickets(ticketPhases.planning, "planner", "PRD read and implementation tickets created.");
    const architectureBrief =
      options.coralMode === "recorded" || options.coralMode === "skip"
        ? board.recordArchitectureBrief({
            runId: ctx.runId,
            agentId: "architect",
            body: defaultArchitectureBrief()
          })
        : await runLiveArchitectBriefHarness({
            board,
            runId: ctx.runId,
            targetDir: options.targetDir,
            runDir: ctx.runDir,
            goal: expandedGoal,
            tickets,
            playbook: architectPlaybook
          });

    if (options.coralMode === "recorded" || options.coralMode === "skip") {
      recordSyntheticArchitectureBriefThread(board, ctx.runId, architectureBrief.body);
    } else {
      await recordLiveArchitectureBriefThread({ board, ctx, architectureBrief: architectureBrief.body });
    }
    completeTickets(ticketPhases.architecture, "architect", "Architect produced implementation architecture brief.");

    if (options.coralMode === "recorded" || options.coralMode === "skip") {
      const beforeImplementation = snapshotFiles(options.targetDir);
      scaffoldNotionLiteApp(options.targetDir, expandedGoal);
      recordFileChanges({
        board,
        runId: ctx.runId,
        ticketId: ticketPhases.implementationAnchor.id,
        agentId: "implementer",
        before: beforeImplementation,
        after: snapshotFiles(options.targetDir)
      });
    } else {
      await runLiveImplementationHarness({
        board,
        runId: ctx.runId,
        targetDir: options.targetDir,
        runDir: ctx.runDir,
        goal: expandedGoal,
        tickets,
        architectureBrief: architectureBrief.body
      });
    }
    completeTickets(ticketPhases.implementation, "implementer", "Generated backend API, browser UI, scripts, and smoke test.");

    let latestReview: ReviewCycleResult | null = null;
    for (let cycle = 1; cycle <= MAX_REVIEW_CYCLES; cycle++) {
      const commandResults: CommandResult[] = [];
      for (const command of [
        ["npm", ["install"]],
        ["npm", ["run", "build"]],
        ["npm", ["test"]]
      ] as const) {
        const result = await runCommand(command[0], command[1], options.targetDir);
        commandResults.push(result);
        recordCommand(board, {
          runId: ctx.runId,
          ticketId: ticketPhases.validationAnchor.id,
          agentId: "reviewer",
          cwd: options.targetDir,
          result
        });
      }
      completeTickets([ticketPhases.validationAnchor], "implementer", "Install, build, and smoke test passed.");
      const verificationSummary = commandResults.map((result) => `${result.command} exited ${result.code}`).join("; ");

      latestReview =
        options.coralMode === "recorded" || options.coralMode === "skip"
          ? (() => {
              recordSyntheticReviewCycle(board, ctx.runId, {
                cycle,
                ticketId: ticketPhases.collaborationAnchor.id,
                verificationSummary
              });
              return { architectVerdict: "green", reviewerVerdict: "green", feedback: "" } satisfies ReviewCycleResult;
            })()
          : await runLiveReviewCycle({
              board,
              ctx,
              targetDir: options.targetDir,
              runDir: ctx.runDir,
              goal: expandedGoal,
              architectureBrief: architectureBrief.body,
              verificationSummary,
              playbook: architectPlaybook,
              cycle,
              ticketId: ticketPhases.collaborationAnchor.id
            });

      board.recordAgentLog({
        runId: ctx.runId,
        agentId: "conductor",
        level: "review-cycle",
        message: `Review cycle ${cycle} completed`,
        data: latestReview
      });

      if (latestReview.architectVerdict === "green" && latestReview.reviewerVerdict === "green") break;
      if (cycle === MAX_REVIEW_CYCLES) break;

      const revisionTicket = board.createTicket({
        projectId: project.id,
        title: `Revision cycle ${cycle + 1}`,
        description: "Implement review feedback from architect and reviewer before the next review cycle.",
        status: "in_progress",
        priority: tickets.length + 1,
        ownerAgent: "implementer",
        collaboratorAgents: ["architect", "reviewer"],
        acceptanceCriteria: "Review feedback is addressed and the next review cycle can pass.",
        createdBy: "conductor"
      });
      board.appendTicketEvent({
        ticketId: revisionTicket.id,
        agentId: "conductor",
        eventType: "changes_requested",
        body: latestReview.feedback || "Review cycle requested changes."
      });
      tickets = [...tickets, revisionTicket];
      await runLiveImplementationHarness({
        board,
        runId: ctx.runId,
        targetDir: options.targetDir,
        runDir: ctx.runDir,
        goal: expandedGoal,
        tickets,
        architectureBrief: architectureBrief.body,
        revisionFeedback: latestReview.feedback
      });
      completeTicket(board, revisionTicket, "implementer", "Implemented review feedback for another review cycle.");
    }

    const collaborationEvents = board.listCoralTimeline(ctx.runId).filter((event) => event.eventType.includes("thread")).length;
    completeTickets(ticketPhases.review, "reviewer", "Collaboration event exists and generated app checks passed.");
    const dashboard = board.getDashboard(ctx.runId);
    const completionGate = requireFactoryCompletionGate({
      threads: dashboard.threads,
      messages: dashboard.messages,
      tickets: Object.values(dashboard.kanban.columns).flat(),
      ticketEvents: dashboard.ticketEvents,
      architectureBriefs: dashboard.architectureBriefs,
      codeEvidence: dashboard.codeEvidence,
      commandEvidence: dashboard.commandEvidence,
      reviewVerdicts: dashboard.reviewVerdicts
    });

    const ticketsCompleted = board.listKanban(project.id).columns.done.length;
    const summary = `Factory run ${ctx.runId} completed: ${ticketsCompleted} tickets done, ${collaborationEvents} collaboration events, ${completionGate.responders.length} responders, app generated at ${options.targetDir}.`;
    board.recordAgentLog({
      runId: ctx.runId,
      agentId: "conductor",
      level: "complete",
      message: summary,
      data: { ticketsCompleted, collaborationEvents, completionGate }
    });
    board.updateRun({ runId: ctx.runId, status: "complete", summary, completed: true });
    return {
      completed: true,
      runId: ctx.runId,
      dbPath: ctx.dbPath,
      targetDir: options.targetDir,
      gatewayUrl,
      summary,
      collaborationEvents,
      ticketsCompleted
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      board.recordAgentLog({ runId: ctx.runId, agentId: "conductor", level: "error", message, data: null });
      board.updateRun({ runId: ctx.runId, status: "failed", summary: message, completed: true });
    } catch {
      // Run row may not exist if initialization failed before creation.
    }
    throw error;
  } finally {
    if (gateway && process.env.FACTORY_KEEP_GATEWAY !== "1") await gateway.close();
    board.close();
  }
}
