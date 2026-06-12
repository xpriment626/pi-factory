import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createBlackboard } from "../src/blackboard/db.js";
import { seedPlaceholderProject } from "../src/blackboard/seed.js";
import { createApiServer } from "../src/conductor/api.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("factory API", () => {
  test("serves kanban and comms state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-factory-api-"));
    try {
      const board = createBlackboard(join(dir, "factory.sqlite"));
      seedPlaceholderProject(board);
      board.recordCoralEvent({
        runId: "run-api",
        sessionId: "session-api",
        threadId: "thread-api",
        eventType: "thread_message_sent",
        agentId: "planner",
        body: "hello implementer",
        raw: { type: "thread_message_sent" }
      });
      const server = await createApiServer({ board, runId: "run-api", port: 0 });
      servers.push(server);
      const base = `http://127.0.0.1:${server.port}`;
      const kanban = await fetch(`${base}/api/kanban`).then((res) => res.json());
      const comms = await fetch(`${base}/api/comms`).then((res) => res.json());
      expect(kanban.columns.todo.length).toBeGreaterThan(0);
      expect(comms.events[0].body).toBe("hello implementer");
      board.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
