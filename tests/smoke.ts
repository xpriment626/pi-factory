import { readFileSync, rmSync } from "node:fs";
import { createBlackboard } from "../src/blackboard/db.js";
import { seedPlaceholderProject } from "../src/blackboard/seed.js";
import { createApiServer } from "../src/conductor/api.js";
import { createRunContext, writeCoralConfig } from "../src/coral/config.js";
import { verifyPiExtensionLoading } from "../src/pi/rpc.js";

const ctx = createRunContext({ projectRoot: process.cwd(), runId: "smoke" });
writeCoralConfig(ctx, { authKey: "smoke-auth", customToolSecret: "smoke-tool" });
const board = createBlackboard(ctx.dbPath);
const project = seedPlaceholderProject(board);
board.recordCoralEvent({
  runId: ctx.runId,
  sessionId: "smoke-session",
  threadId: "smoke-thread",
  eventType: "thread_message_sent",
  agentId: "planner",
  body: "smoke ping",
  raw: { type: "thread_message_sent" }
});

const api = await createApiServer({ board, runId: ctx.runId, port: 0 });
const base = `http://127.0.0.1:${api.port}`;
const [kanban, comms] = await Promise.all([
  fetch(`${base}/api/kanban`).then((res) => res.json()),
  fetch(`${base}/api/comms`).then((res) => res.json())
]);
const pi = await verifyPiExtensionLoading({ cwd: process.cwd() });
const config = readFileSync(ctx.coralConfigPath, "utf8");

const result = {
  ok:
    kanban.columns.todo.length > 0 &&
    comms.events.length > 0 &&
    pi.success &&
    config.includes(`${process.cwd()}/agents/*`),
  runId: ctx.runId,
  dbPath: ctx.dbPath,
  coralConfigPath: ctx.coralConfigPath,
  kanbanCounts: Object.fromEntries(Object.entries(kanban.columns).map(([key, tickets]) => [key, (tickets as unknown[]).length])),
  commsEvents: comms.events.length,
  piCommands: pi.commandNames
};

await api.close();
board.close();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

if (process.env.FACTORY_KEEP_SMOKE_RUN !== "1") {
  rmSync(ctx.runDir, { recursive: true, force: true });
}
