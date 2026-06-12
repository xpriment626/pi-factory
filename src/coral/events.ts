export type NormalizedCoralEvent = {
  runId: string;
  sessionId: string | null;
  threadId: string | null;
  eventType: string;
  agentId: string | null;
  body: string;
  raw: unknown;
  thread: {
    id: string;
    name: string;
    creatorAgent: string | null;
    participants: string[];
    state: unknown;
  } | null;
  message: {
    id?: string;
    threadId: string;
    senderAgent: string;
    mentions: string[];
    body: string;
  } | null;
};

type CoralEvent = Record<string, unknown>;

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function stringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      const object = asObject(item);
      return stringValue(object.name, object.id, object.agentId, object.agentName);
    })
    .filter((item): item is string => Boolean(item));
}

function compactAgents(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function normalizeCoralEvent(runId: string, sessionId: string | null, event: CoralEvent): NormalizedCoralEvent {
  const type = String(event.type ?? "unknown");
  const message = asObject(event.message);
  const thread = asObject(event.thread);
  const threadId =
    typeof message.threadId === "string"
      ? message.threadId
      : typeof event.threadId === "string"
        ? event.threadId
        : typeof thread.id === "string"
          ? thread.id
          : null;
  const agentId =
    typeof message.senderName === "string"
      ? message.senderName
      : typeof event.name === "string"
        ? event.name
        : typeof event.agentName === "string"
        ? event.agentName
        : null;

  const messageBody = stringValue(message.text, message.content, message.body, event.body);
  let body = type;
  if (messageBody) body = messageBody;
  else if (type === "thread_created" && typeof thread.name === "string") body = `Thread created: ${thread.name}`;
  else if (type === "thread_closed" && typeof event.summary === "string") body = event.summary;
  else if (typeof event.name === "string") body = `${type}: ${event.name}`;

  const messageId = stringValue(message.id, event.messageId);
  const mentions = stringList(message.mentionNames).length
    ? stringList(message.mentionNames)
    : stringList(message.mentions).length
      ? stringList(message.mentions)
      : stringList(event.mentions);
  const participants = compactAgents([
    ...stringList(thread.participants),
    ...stringList(thread.participantNames),
    agentId,
    ...mentions
  ]);
  const threadName = stringValue(thread.name, event.threadName, threadId ? `Thread ${threadId}` : null);
  const normalizedThread =
    threadId && (type.includes("thread") || Object.keys(thread).length > 0 || messageBody)
      ? {
          id: threadId,
          name: threadName ?? "Coral thread",
          creatorAgent: stringValue(thread.creatorAgent, thread.creatorName, event.creatorAgent, agentId),
          participants,
          state: Object.keys(thread).length > 0 ? thread : { source: "derived", eventType: type }
        }
      : null;
  const normalizedMessage =
    threadId && type.includes("message") && body !== type
      ? {
          id: messageId ?? undefined,
          threadId,
          senderAgent: agentId ?? "unknown",
          mentions,
          body
        }
      : null;

  return {
    runId,
    sessionId,
    threadId,
    eventType: type,
    agentId,
    body,
    raw: event,
    thread: normalizedThread,
    message: normalizedMessage
  };
}
