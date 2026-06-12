import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createBlackboard } from "../src/blackboard/db.js";
import { normalizeCoralEvent } from "../src/coral/events.js";
import { persistNormalizedCoralEvent } from "../src/coral/persist.js";

describe("coral persistence", () => {
  test("derives durable thread and message rows from Coral message events", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-factory-coral-persist-"));
    try {
      const board = createBlackboard(join(dir, "factory.sqlite"));
      const project = board.createProject({
        title: "Coral persistence",
        prompt: "Persist audit-friendly thread history."
      });
      board.createRun({
        runId: "run-coral-persist",
        projectId: project.id,
        targetDir: dir,
        goal: "Persist Coral messages",
        status: "running"
      });

      const normalized = normalizeCoralEvent("run-coral-persist", "session-coral", {
        type: "thread_message_sent",
        thread: {
          id: "thread-kickoff",
          name: "Kickoff briefing",
          participants: ["planner", "implementer", "reviewer"]
        },
        message: {
          id: "message-kickoff-1",
          threadId: "thread-kickoff",
          senderName: "planner",
          mentionNames: ["implementer", "reviewer"],
          content: "Please confirm scope and handoff constraints."
        }
      });

      persistNormalizedCoralEvent(board, normalized);

      expect(board.listCoralTimeline("run-coral-persist")[0]).toMatchObject({
        eventType: "thread_message_sent",
        threadId: "thread-kickoff",
        agentId: "planner",
        body: "Please confirm scope and handoff constraints."
      });
      expect(board.listCoralThreads("run-coral-persist")[0]).toMatchObject({
        id: "thread-kickoff",
        name: "Kickoff briefing",
        participants: ["planner", "implementer", "reviewer"]
      });
      expect(board.listCoralMessages("run-coral-persist")[0]).toMatchObject({
        id: "message-kickoff-1",
        threadId: "thread-kickoff",
        senderAgent: "planner",
        mentions: ["implementer", "reviewer"],
        body: "Please confirm scope and handoff constraints."
      });
      board.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
