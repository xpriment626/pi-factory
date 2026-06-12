import { describe, expect, test } from "vitest";
import { normalizeCoralEvent } from "../src/coral/events.js";

describe("coral event reducer", () => {
  test("normalizes thread messages for the blackboard timeline", () => {
    const normalized = normalizeCoralEvent("run-1", "session-1", {
      type: "thread_message_sent",
      timestamp: "2026-06-12T00:00:00Z",
      message: {
        id: "message-1",
        threadId: "thread-1",
        text: "ping from planner",
        senderName: "planner",
        mentionNames: ["implementer"],
        timestamp: "2026-06-12T00:00:00Z"
      }
    });
    expect(normalized).toMatchObject({
      runId: "run-1",
      sessionId: "session-1",
      threadId: "thread-1",
      eventType: "thread_message_sent",
      agentId: "planner",
      body: "ping from planner"
    });
  });
});
