import type { Blackboard } from "../blackboard/db.js";
import type { CoralMessage, CoralThread, CoralTimelineEvent } from "../blackboard/types.js";
import type { NormalizedCoralEvent } from "./events.js";

export type PersistedCoralEvent = {
  event: CoralTimelineEvent;
  thread: CoralThread | null;
  message: CoralMessage | null;
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function persistNormalizedCoralEvent(board: Blackboard, normalized: NormalizedCoralEvent): PersistedCoralEvent {
  const event = board.recordCoralEvent(normalized);
  let thread: CoralThread | null = null;
  let message: CoralMessage | null = null;

  if (normalized.thread) {
    thread = board.recordCoralThread({
      id: normalized.thread.id,
      runId: normalized.runId,
      sessionId: normalized.sessionId,
      name: normalized.thread.name,
      creatorAgent: normalized.thread.creatorAgent,
      participants: normalized.thread.participants,
      state: normalized.thread.state
    });
  }

  if (normalized.message) {
    if (!thread) {
      thread = board.recordCoralThread({
        id: normalized.message.threadId,
        runId: normalized.runId,
        sessionId: normalized.sessionId,
        name: `Thread ${normalized.message.threadId}`,
        creatorAgent: normalized.message.senderAgent,
        participants: unique([normalized.message.senderAgent, ...normalized.message.mentions]),
        state: { source: "message-derived" }
      });
    }
    message = board.recordCoralMessage({
      id: normalized.message.id,
      runId: normalized.runId,
      sessionId: normalized.sessionId,
      threadId: normalized.message.threadId,
      senderAgent: normalized.message.senderAgent,
      mentions: normalized.message.mentions,
      body: normalized.message.body
    });
  }

  return { event, thread, message };
}
