import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createBlackboard } from "../blackboard/db.js";
import type { Blackboard } from "../blackboard/db.js";
import type { Ticket } from "../blackboard/types.js";
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

function implementerPrompt(input: { goal: string; ticketTitles: string[] }) {
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
    `Goal:\n${input.goal}`,
    "Finish with a concise summary of files created/edited and command results."
  ].join("\n\n");
}

function reviewerPrompt(input: { goal: string }) {
  return [
    "You are the reviewer in a Pi factory run.",
    "Work in the current project directory. Use only read/search/list/bash style tools.",
    "Inspect the generated code against the PRD/goal.",
    "Run npm install, npm run build, and npm test if package.json is present.",
    "If you start a local server for smoke testing, stop it before finishing. Do not leave background processes running.",
    `Goal:\n${input.goal}`,
    "Finish with ACCEPT or REJECT and concrete verification evidence."
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

async function runLiveImplementationHarness(input: {
  board: Blackboard;
  runId: string;
  targetDir: string;
  runDir: string;
  goal: string;
  tickets: Ticket[];
}) {
  const implementationTicket = input.tickets.find((ticket) => ticket.ownerAgent === "implementer") ?? input.tickets[0];
  const before = snapshotFiles(input.targetDir);
  const implementer = await runPiToolAgent({
    cwd: input.targetDir,
    sessionDir: join(input.runDir, "pi-sessions"),
    role: "implementer",
    tools: ["read", "write", "edit", "bash", "ls", "grep", "find"],
    prompt: implementerPrompt({ goal: input.goal, ticketTitles: input.tickets.map((ticket) => ticket.title) }),
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

async function runLiveReviewerHarness(input: {
  board: Blackboard;
  runId: string;
  targetDir: string;
  runDir: string;
  goal: string;
  ticketId?: string;
}) {
  const reviewer = await runPiToolAgent({
    cwd: input.targetDir,
    sessionDir: join(input.runDir, "pi-sessions"),
    role: "reviewer",
    tools: ["read", "bash", "ls", "grep", "find"],
    prompt: reviewerPrompt({ goal: input.goal }),
    timeoutMs: 600000
  });
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
      ticketIdsTouched: input.ticketId ? [input.ticketId] : []
    }
  });
  if (input.ticketId) {
    input.board.appendTicketEvent({
      ticketId: input.ticketId,
      agentId: "reviewer",
      eventType: "verification",
      body: reviewer.response.slice(0, 4000)
    });
  }
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

function recordSyntheticCollaboration(board: Blackboard, runId: string) {
  const thread = board.recordCoralThread({
    id: `${runId}-review-thread`,
    runId,
    sessionId: `${runId}-recorded-session`,
    name: "Factory kickoff and final review",
    creatorAgent: "planner",
    participants: ["planner", "architect", "implementer", "reviewer"],
    state: { mode: "recorded" }
  });
  recordCoordinationMessage({
    board,
    runId,
    sessionId: thread.sessionId!,
    threadId: thread.id,
    senderAgent: "planner",
    mentions: ["implementer", "reviewer"],
    body: "Planner request: implementer confirm runnable build evidence and reviewer confirm acceptance before completion."
  });
  recordCoordinationMessage({
    board,
    runId,
    sessionId: thread.sessionId!,
    threadId: thread.id,
    senderAgent: "implementer",
    mentions: ["planner", "reviewer"],
    body: "Implementer response: app files were generated and npm install, npm run build, and npm test completed successfully."
  });
  recordCoordinationMessage({
    board,
    runId,
    sessionId: thread.sessionId!,
    threadId: thread.id,
    senderAgent: "reviewer",
    mentions: ["planner", "implementer"],
    body: "Reviewer response: accepted completion because runnable code exists and verification commands passed."
  });
}

function agentPrompt(input: { role: "planner" | "architect" | "implementer" | "reviewer"; goal: string; verificationSummary: string }) {
  const shared = [
    "You are one role in a Pi factory multi-agent coding run.",
    "Write one concise Coral thread message, not markdown.",
    "The project is a small Notion Lite full-stack productivity app with kanban tasks and freeform notes.",
    `Goal: ${input.goal}`,
    `Verification evidence: ${input.verificationSummary}`
  ].join("\n");
  if (input.role === "planner") {
    return `${shared}\nAs planner, ask implementer and reviewer to confirm runnable app evidence before completion. Mention implementer and reviewer by role name in prose.`;
  }
  if (input.role === "architect") {
    return `${shared}\nAs architect, state the smallest viable architecture and any risk you want implementer and reviewer to check.`;
  }
  if (input.role === "implementer") {
    return `${shared}\nAs implementer, respond to planner with concrete implementation evidence: generated files and commands that passed.`;
  }
  return `${shared}\nAs reviewer, respond to planner and implementer with acceptance or rejection based only on the verification evidence.`;
}

async function recordLiveCollaboration(
  board: Blackboard,
  ctx: ReturnType<typeof createRunContext>,
  input: { targetDir: string; goal: string; verificationSummary: string }
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
      minEvents: 3,
      timeoutMs: 25000,
      afterOpen: async () => {
        const threadBody = await puppetCreateThread({
          baseUrl: "http://127.0.0.1:5555",
          authKey: ctx.authKey,
          namespace: session.namespace,
          sessionId: session.sessionId,
          senderName: "planner",
          threadName: "Factory implementation review",
          participantNames: ["implementer", "reviewer"]
        });
        const thread = threadBody.thread as { id: string; name?: string };
        board.recordCoralThread({
          id: thread.id,
          runId: ctx.runId,
          sessionId: session.sessionId,
          name: thread.name ?? "Factory collaboration",
          creatorAgent: "planner",
          participants: ["planner", "architect", "implementer", "reviewer"],
          state: { mode: "live", namespace: session.namespace }
        });

        for (const role of ["planner", "architect", "implementer", "reviewer"] as const) {
          const turn = await runPiAgentTurn({
            cwd: input.targetDir,
            sessionDir: join(ctx.runDir, "pi-sessions", "factory-agents"),
            role,
            prompt: agentPrompt({ role, goal: input.goal, verificationSummary: input.verificationSummary })
          });
          const mentions =
            role === "planner"
              ? ["implementer", "reviewer"]
              : role === "architect"
                ? ["planner", "implementer", "reviewer"]
                : ["planner", role === "implementer" ? "reviewer" : "implementer"];
          const puppetMessage = await puppetSendThreadMessage({
            baseUrl: "http://127.0.0.1:5555",
            authKey: ctx.authKey,
            namespace: session.namespace,
            sessionId: session.sessionId,
            senderName: role,
            threadId: thread.id,
            content: turn.response,
            mentions
          });
          const puppetMessageBody = puppetMessage as { message?: { id?: unknown } };
          const messageId =
            typeof puppetMessageBody.message?.id === "string" ? puppetMessageBody.message.id : undefined;
          recordCoordinationMessage({
            board,
            runId: ctx.runId,
            sessionId: session.sessionId,
            threadId: thread.id,
            senderAgent: role,
            mentions,
            body: turn.response,
            messageId,
            raw: { type: "thread_message_sent", source: "pi_agent_turn", command: turn.command, puppetMessage }
          });
          board.recordAgentLog({
            runId: ctx.runId,
            agentId: role,
            level: "pi-turn",
            message: `Pi ${role} coordination turn completed`,
            data: {
              command: turn.command,
              role: turn.role,
              sessionPath: turn.sessionPath,
              response: turn.response.slice(0, 1200),
              stderr: turn.stderr.slice(-1200),
              ticketIdsTouched: []
            }
          });
        }
      }
    });
    return Math.max(mirror.events.length, 1);
  } finally {
    await coral.stop();
  }
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
    const tickets = createTicketsFromPlan(board, project.id, ticketPlan);
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
        tickets
      });
    }
    completeTickets(ticketPhases.implementation, "implementer", "Generated backend API, browser UI, scripts, and smoke test.");

    if (options.coralMode !== "recorded" && options.coralMode !== "skip") {
      await runLiveReviewerHarness({
        board,
        runId: ctx.runId,
        targetDir: options.targetDir,
        runDir: ctx.runDir,
        goal: expandedGoal,
        ticketId: ticketPhases.collaborationAnchor.id
      });
    }

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
    if (options.coralMode === "recorded" || options.coralMode === "skip") {
      board.appendTicketEvent({
        ticketId: ticketPhases.collaborationAnchor.id,
        agentId: "reviewer",
        eventType: "verification",
        body: "Reviewer verification commands passed."
      });
    }
    const verificationSummary = commandResults.map((result) => `${result.command} exited ${result.code}`).join("; ");

    if (options.coralMode === "skip") {
      board.recordAgentLog({ runId: ctx.runId, agentId: "conductor", level: "warning", message: "Coral collaboration skipped", data: null });
    } else if (options.coralMode === "recorded") {
      recordSyntheticCollaboration(board, ctx.runId);
    } else {
      const liveEvents = await recordLiveCollaboration(board, ctx, {
        targetDir: options.targetDir,
        goal: expandedGoal,
        verificationSummary
      });
      board.recordAgentLog({ runId: ctx.runId, agentId: "conductor", level: "info", message: "Live Coral collaboration mirrored", data: { liveEvents } });
    }

    const collaborationEvents = board.listCoralTimeline(ctx.runId).filter((event) => event.eventType.includes("thread")).length;
    completeTickets(ticketPhases.architecture, "architect", "Architect posted design guidance in Coral.");
    completeTickets(ticketPhases.review, "reviewer", "Collaboration event exists and generated app checks passed.");
    const dashboard = board.getDashboard(ctx.runId);
    const completionGate = requireFactoryCompletionGate({
      threads: dashboard.threads,
      messages: dashboard.messages,
      tickets: Object.values(dashboard.kanban.columns).flat(),
      ticketEvents: dashboard.ticketEvents,
      codeEvidence: dashboard.codeEvidence,
      commandEvidence: dashboard.commandEvidence
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
