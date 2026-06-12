import { createBlackboard } from "../src/blackboard/db.js";
import { seedPlaceholderProject } from "../src/blackboard/seed.js";
import { createRunContext, writeCoralConfig } from "../src/coral/config.js";
import { runLivePiPing } from "../src/pi/live.js";

const ctx = createRunContext({ projectRoot: process.cwd() });
writeCoralConfig(ctx);
const board = createBlackboard(ctx.dbPath);
const project = seedPlaceholderProject(board);
const kanban = board.listKanban(project.id);
const ticket = kanban.columns.todo[0] ?? kanban.columns.in_progress[0];
const ping = await runLivePiPing({ cwd: process.cwd(), sessionDir: `${ctx.runDir}/pi-sessions/live-ping` });

if (ticket) {
  board.appendTicketEvent({
    ticketId: ticket.id,
    agentId: "pi-live",
    eventType: ping.success ? "model_ping" : "model_ping_failed",
    body: ping.success ? ping.response : `${ping.command}\n${ping.stderr}`
  });
}

console.log(
  JSON.stringify(
    {
      ok: ping.success,
      runId: ctx.runId,
      dbPath: ctx.dbPath,
      ticketId: ticket?.id,
      response: ping.response,
      stderr: ping.stderr,
      command: ping.command,
      exit: ping.exit
    },
    null,
    2
  )
);
board.close();
if (!ping.success) process.exit(1);
