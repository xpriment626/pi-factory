import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createBlackboard } from "../blackboard/db.js";
import { seedPlaceholderProject } from "../blackboard/seed.js";
import { createRunContext, writeCoralConfig } from "../coral/config.js";
import { createApiServer } from "./api.js";
import { listRunArchive } from "./run-archive.js";

const archive = listRunArchive(process.cwd());
const requestedRunId = process.env.FACTORY_RUN_ID ?? (process.env.FACTORY_ARCHIVE_MODE === "1" ? archive.runs[0]?.runId : undefined);
const ctx = createRunContext({ projectRoot: process.cwd(), runId: requestedRunId });
if (!existsSync(ctx.coralConfigPath)) writeCoralConfig(ctx);
const board = createBlackboard(ctx.dbPath);
const projectCount = (board.db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count;
if (projectCount === 0) {
  const project = seedPlaceholderProject(board);
  board.createRun({
    runId: ctx.runId,
    projectId: project.id,
    targetDir: process.cwd(),
    goal: "Manual gateway dev run",
    status: "running",
    gatewayUrl: "http://127.0.0.1:5173"
  });
  board.recordCoralEvent({
    runId: ctx.runId,
    sessionId: null,
    threadId: null,
    eventType: "factory_boot",
    agentId: "conductor",
    body: "Factory conductor booted with seeded blackboard tickets.",
    raw: { runId: ctx.runId, projectId: project.id }
  });
} else {
  const existingRun = board.db.prepare("SELECT run_id FROM factory_runs WHERE run_id = ?").get(ctx.runId);
  if (!existingRun) {
    const project = board.listKanban().project;
    board.createRun({
      runId: ctx.runId,
      projectId: project.id,
      targetDir: process.cwd(),
      goal: "Manual gateway dev run",
      status: "running",
      gatewayUrl: "http://127.0.0.1:5173"
    });
  }
}

const apiPort = Number(process.env.FACTORY_API_PORT ?? 8787);
const api = await createApiServer({ board, runId: ctx.runId, factoryRoot: process.cwd(), port: apiPort });
const vite = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5173"], {
  cwd: process.cwd(),
  stdio: "inherit"
});

console.log(`pi-factory run: ${ctx.runId}`);
console.log(`blackboard db: ${ctx.dbPath}`);
console.log(`coral config: ${ctx.coralConfigPath}`);
console.log(`api: http://${api.host}:${api.port}`);
console.log("ui: http://127.0.0.1:5173");

const shutdown = async () => {
  vite.kill("SIGTERM");
  await api.close();
  board.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
