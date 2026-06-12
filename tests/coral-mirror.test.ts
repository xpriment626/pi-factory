import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, test } from "vitest";
import { createBlackboard } from "../src/blackboard/db.js";
import { mirrorCoralEvents } from "../src/coral/mirror.js";

let servers: WebSocketServer[] = [];

afterEach(() => {
  for (const server of servers) server.close();
  servers = [];
});

describe("coral event mirroring", () => {
  test("waits for afterOpen work before resolving on minEvents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-factory-coral-mirror-"));
    try {
      const board = createBlackboard(join(dir, "factory.sqlite"));
      const project = board.createProject({ title: "Mirror", prompt: "Race check" });
      board.createRun({
        runId: "run-mirror",
        projectId: project.id,
        targetDir: dir,
        goal: "Mirror afterOpen fully",
        status: "running"
      });

      const server = new WebSocketServer({ port: 0 });
      servers.push(server);
      server.on("connection", (socket) => {
        socket.send(
          JSON.stringify({
            type: "thread_message_sent",
            message: {
              id: "message-1",
              threadId: "thread-1",
              text: "planner asks implementer and reviewer to confirm evidence",
              senderName: "planner",
              mentionNames: ["implementer", "reviewer"]
            }
          })
        );
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP test server");

      let afterOpenFinished = false;
      const started = Date.now();
      const result = await mirrorCoralEvents({
        board,
        runId: "run-mirror",
        baseWsUrl: `ws://127.0.0.1:${address.port}`,
        authKey: "test-key",
        namespace: "test-namespace",
        sessionId: "test-session",
        minEvents: 1,
        timeoutMs: 500,
        afterOpen: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          afterOpenFinished = true;
        }
      });

      expect(result.events).toHaveLength(1);
      expect(afterOpenFinished).toBe(true);
      expect(Date.now() - started).toBeGreaterThanOrEqual(45);
      expect(board.listCoralMessages("run-mirror")).toHaveLength(1);
      board.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
