import { createBlackboard } from "../src/blackboard/db.js";
import { seedPlaceholderProject } from "../src/blackboard/seed.js";
import { createApiServer } from "../src/conductor/api.js";
import { createFactorySession, getExtendedSession, puppetPingThread } from "../src/coral/client.js";
import { createRunContext, writeCoralConfig } from "../src/coral/config.js";
import { mirrorCoralEvents } from "../src/coral/mirror.js";
import { startCoral, waitForCoral } from "../src/coral/server.js";

const ctx = createRunContext({ projectRoot: process.cwd() });
writeCoralConfig(ctx);
const board = createBlackboard(ctx.dbPath);
seedPlaceholderProject(board);
const api = await createApiServer({ board, runId: ctx.runId, port: 0 });
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
    minEvents: 2,
    timeoutMs: 15000,
    afterOpen: async () => {
      await puppetPingThread({
        baseUrl: "http://127.0.0.1:5555",
        authKey: ctx.authKey,
        namespace: session.namespace,
        sessionId: session.sessionId
      });
    }
  });
  const extended = await getExtendedSession({
    baseUrl: "http://127.0.0.1:5555",
    authKey: ctx.authKey,
    namespace: session.namespace,
    sessionId: session.sessionId
  });
  console.log(
    JSON.stringify(
      {
        ok: mirror.events.length > 0,
        runId: ctx.runId,
        dbPath: ctx.dbPath,
        api: `http://127.0.0.1:${api.port}`,
        coralConfigPath: ctx.coralConfigPath,
        coralLogPath: coral.logPath,
        session,
        mirroredEvents: mirror.events.length,
        threads: Array.isArray(extended.threads) ? extended.threads.length : 0
      },
      null,
      2
    )
  );
  if (mirror.events.length === 0) process.exitCode = 1;
} finally {
  await coral.stop();
  await api.close();
  board.close();
}
