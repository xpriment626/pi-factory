import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createBlackboard } from "../blackboard/db.js";
import type { Blackboard } from "../blackboard/db.js";
import type { Ticket } from "../blackboard/types.js";
import { createRunContext, writeCoralConfig } from "../coral/config.js";
import { createFactorySession, puppetPingThread } from "../coral/client.js";
import { mirrorCoralEvents } from "../coral/mirror.js";
import { startCoral, waitForCoral } from "../coral/server.js";
import { createApiServer } from "./api.js";
import { readGoalWithReferences, scaffoldNotionLiteApp } from "./app-scaffold.js";

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

function recordCommand(board: Blackboard, runId: string, result: CommandResult) {
  board.recordAgentLog({
    runId,
    agentId: "implementer",
    level: result.code === 0 ? "info" : "error",
    message: `${result.command} exited ${result.code}`,
    data: { stdout: result.stdout.slice(-2000), stderr: result.stderr.slice(-2000) }
  });
  if (result.code !== 0) throw new Error(`${result.command} failed: ${result.stderr || result.stdout}`);
}

function createTickets(board: Blackboard, projectId: string) {
  const tickets = [
    {
      title: "Plan PRD implementation",
      description: "Read PRD and define the smallest Notion Lite build surface.",
      ownerAgent: "planner",
      collaboratorAgents: ["architect"],
      acceptanceCriteria: "Tickets map to PRD requirements."
    },
    {
      title: "Scaffold full-stack app",
      description: "Create backend API, static frontend, package scripts, and test harness.",
      ownerAgent: "implementer",
      collaboratorAgents: ["architect"],
      acceptanceCriteria: "Project has runnable app files and package scripts."
    },
    {
      title: "Validate install build test",
      description: "Run npm install, build, and smoke test in the target project.",
      ownerAgent: "implementer",
      collaboratorAgents: ["reviewer"],
      acceptanceCriteria: "All verification commands pass."
    },
    {
      title: "Collaborative review",
      description: "Planner, implementer, and reviewer coordinate on completion evidence.",
      ownerAgent: "reviewer",
      collaboratorAgents: ["planner", "implementer"],
      acceptanceCriteria: "At least one Coral thread/message is mirrored."
    }
  ];
  return tickets.map((ticket, index) =>
    board.createTicket({
      projectId,
      title: ticket.title,
      description: ticket.description,
      status: index === 0 ? "in_progress" : "todo",
      priority: index + 1,
      ownerAgent: ticket.ownerAgent,
      collaboratorAgents: ticket.collaboratorAgents,
      acceptanceCriteria: ticket.acceptanceCriteria,
      createdBy: "planner"
    })
  );
}

function completeTicket(board: Blackboard, ticket: Ticket, agentId: string, body: string) {
  board.appendTicketEvent({ ticketId: ticket.id, agentId, eventType: "progress", body });
  board.updateTicket({ ticketId: ticket.id, status: "done", ownerAgent: agentId, collaboratorAgents: ticket.collaboratorAgents });
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
  const message = board.recordCoralMessage({
    id: `${runId}-review-message`,
    runId,
    sessionId: thread.sessionId,
    threadId: thread.id,
    senderAgent: "planner",
    mentions: ["implementer", "reviewer"],
    body: "Recorded collaboration: planner briefed implementer and reviewer before completion."
  });
  board.recordCoralEvent({
    runId,
    sessionId: thread.sessionId,
    threadId: thread.id,
    eventType: "thread_message_sent",
    agentId: message.senderAgent,
    body: message.body,
    raw: { type: "thread_message_sent", message }
  });
}

async function recordLiveCollaboration(board: Blackboard, ctx: ReturnType<typeof createRunContext>) {
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
      minEvents: 1,
      timeoutMs: 15000,
      afterOpen: async () => {
        const ping = await puppetPingThread({
          baseUrl: "http://127.0.0.1:5555",
          authKey: ctx.authKey,
          namespace: session.namespace,
          sessionId: session.sessionId
        });
        const thread = ping.thread as { id: string; name?: string };
        board.recordCoralThread({
          id: thread.id,
          runId: ctx.runId,
          sessionId: session.sessionId,
          name: thread.name ?? "Factory collaboration",
          creatorAgent: "planner",
          participants: ["planner", "architect", "implementer", "reviewer"],
          state: { mode: "live", namespace: session.namespace }
        });
        board.recordCoralMessage({
          runId: ctx.runId,
          sessionId: session.sessionId,
          threadId: thread.id,
          senderAgent: "planner",
          mentions: ["implementer"],
          body: "Live collaboration: planner asked implementer/reviewer to confirm completion evidence."
        });
        board.recordCoralEvent({
          runId: ctx.runId,
          sessionId: session.sessionId,
          threadId: thread.id,
          eventType: "thread_message_sent",
          agentId: "planner",
          body: "Live collaboration: planner asked implementer/reviewer to confirm completion evidence.",
          raw: { type: "thread_message_sent", source: "puppet_api", thread: ping.thread, message: ping.message }
        });
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
    const tickets = createTickets(board, project.id);
    board.recordAgentLog({ runId: ctx.runId, agentId: "conductor", level: "start", message: "Factory run started", data: { targetDir: options.targetDir } });
    if (options.startGateway) {
      gateway = await startGateway({ factoryRoot: options.factoryRoot, board, runId: ctx.runId, apiPort, gatewayPort });
      board.updateRun({ runId: ctx.runId, gatewayUrl: gateway.gatewayUrl });
    }

    completeTicket(board, tickets[0]!, "planner", "PRD read and implementation tickets created.");
    scaffoldNotionLiteApp(options.targetDir, expandedGoal);
    completeTicket(board, tickets[1]!, "implementer", "Generated backend API, browser UI, scripts, and smoke test.");

    for (const command of [
      ["npm", ["install"]],
      ["npm", ["run", "build"]],
      ["npm", ["test"]]
    ] as const) {
      recordCommand(board, ctx.runId, await runCommand(command[0], command[1], options.targetDir));
    }
    completeTicket(board, tickets[2]!, "implementer", "Install, build, and smoke test passed.");

    if (options.coralMode === "skip") {
      board.recordAgentLog({ runId: ctx.runId, agentId: "conductor", level: "warning", message: "Coral collaboration skipped", data: null });
    } else if (options.coralMode === "recorded") {
      recordSyntheticCollaboration(board, ctx.runId);
    } else {
      const liveEvents = await recordLiveCollaboration(board, ctx);
      board.recordAgentLog({ runId: ctx.runId, agentId: "conductor", level: "info", message: "Live Coral collaboration mirrored", data: { liveEvents } });
    }

    const collaborationEvents = board.listCoralTimeline(ctx.runId).filter((event) => event.eventType.includes("thread")).length;
    if (collaborationEvents < 1) throw new Error("Completion gate failed: no Coral collaboration event was recorded.");
    completeTicket(board, tickets[3]!, "reviewer", "Collaboration event exists and generated app checks passed.");

    const ticketsCompleted = board.listKanban(project.id).columns.done.length;
    const summary = `Factory run ${ctx.runId} completed: ${ticketsCompleted} tickets done, ${collaborationEvents} collaboration events, app generated at ${options.targetDir}.`;
    board.recordAgentLog({ runId: ctx.runId, agentId: "conductor", level: "complete", message: summary, data: { ticketsCompleted, collaborationEvents } });
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
