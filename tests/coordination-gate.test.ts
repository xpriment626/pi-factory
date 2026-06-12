import { describe, expect, test } from "vitest";
import type { CodeEvidence, CommandEvidence, CoralMessage, CoralThread, Ticket, TicketEvent } from "../src/blackboard/types.js";
import { evaluateCoordinationGate, evaluateFactoryCompletionGate } from "../src/conductor/coordination-gate.js";

const thread: CoralThread = {
  id: "thread-review",
  runId: "run-coordination",
  sessionId: "session-coordination",
  name: "Implementation review",
  creatorAgent: "planner",
  participants: ["planner", "implementer", "reviewer"],
  state: {},
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z"
};

function message(input: Partial<CoralMessage> & Pick<CoralMessage, "id" | "senderAgent" | "body">): CoralMessage {
  return {
    runId: "run-coordination",
    sessionId: "session-coordination",
    threadId: "thread-review",
    mentions: [],
    createdAt: "2026-06-12T00:00:00.000Z",
    ...input
  };
}

function ticket(input: Partial<Ticket> & Pick<Ticket, "id" | "status" | "ownerAgent">): Ticket {
  return {
    projectId: "project-gate",
    title: "Gate ticket",
    description: "Gate ticket",
    priority: 1,
    collaboratorAgents: [],
    acceptanceCriteria: "Must pass gate.",
    createdBy: "planner",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...input
  };
}

const validMessages = [
  message({
    id: "m1",
    senderAgent: "planner",
    mentions: ["implementer", "reviewer"],
    body: "Please implement the generated app and review completion evidence."
  }),
  message({
    id: "m2",
    senderAgent: "implementer",
    mentions: ["planner"],
    body: "Implemented files are present and npm install/build/test passed."
  }),
  message({
    id: "m3",
    senderAgent: "reviewer",
    mentions: ["planner", "implementer"],
    body: "Reviewed the evidence and accepted the runnable app."
  })
];

const doneTickets = [
  ticket({ id: "ticket-plan", status: "done", ownerAgent: "planner" }),
  ticket({ id: "ticket-build", status: "done", ownerAgent: "implementer" }),
  ticket({ id: "ticket-review", status: "done", ownerAgent: "reviewer" })
];

const codeEvidence: CodeEvidence[] = [
  {
    id: "code-1",
    runId: "run-coordination",
    ticketId: "ticket-build",
    agentId: "implementer",
    path: "package.json",
    action: "created",
    summary: "Created package manifest.",
    createdAt: "2026-06-12T00:00:00.000Z"
  }
];

const passingCommands: CommandEvidence[] = [
  {
    id: "cmd-0",
    runId: "run-coordination",
    ticketId: "ticket-review",
    agentId: "reviewer",
    command: "npm run build",
    cwd: "/tmp/project",
    exitCode: 0,
    stdout: "Build passed",
    stderr: "",
    createdAt: "2026-06-12T00:00:00.000Z"
  },
  {
    id: "cmd-1",
    runId: "run-coordination",
    ticketId: "ticket-review",
    agentId: "reviewer",
    command: "npm test",
    cwd: "/tmp/project",
    exitCode: 0,
    stdout: "Smoke passed",
    stderr: "",
    createdAt: "2026-06-12T00:00:00.000Z"
  }
];

const reviewerEvents: TicketEvent[] = [
  {
    id: "event-review",
    ticketId: "ticket-review",
    agentId: "reviewer",
    eventType: "verification",
    body: "npm test passed and app is accepted.",
    createdAt: "2026-06-12T00:00:00.000Z"
  }
];

describe("coordination gate", () => {
  test("rejects one-way thread messages without recipient acknowledgement", () => {
    const result = evaluateCoordinationGate({
      threads: [thread],
      messages: [
        message({
          id: "m1",
          senderAgent: "planner",
          mentions: ["implementer", "reviewer"],
          body: "Please implement and review the app."
        })
      ]
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("No thread has recipient responses from at least two non-planner agents.");
  });

  test("accepts a persisted thread with planner request and implementer/reviewer responses", () => {
    const result = evaluateCoordinationGate({
      threads: [thread],
      messages: [
        message({
          id: "m1",
          senderAgent: "planner",
          mentions: ["implementer", "reviewer"],
          body: "Please implement the generated app and review completion evidence."
        }),
        message({
          id: "m2",
          senderAgent: "implementer",
          mentions: ["planner"],
          body: "Implemented files are present and npm install/build/test passed."
        }),
        message({
          id: "m3",
          senderAgent: "reviewer",
          mentions: ["planner", "implementer"],
          body: "Reviewed the evidence and accepted the runnable app."
        })
      ]
    });

    expect(result.passed).toBe(true);
    expect(result.threadId).toBe("thread-review");
    expect(result.responders).toEqual(["implementer", "reviewer"]);
  });

  test("rejects completion when chat replies exist but code evidence is missing", () => {
    const result = evaluateFactoryCompletionGate({
      threads: [thread],
      messages: validMessages,
      tickets: doneTickets,
      ticketEvents: reviewerEvents,
      codeEvidence: [],
      commandEvidence: passingCommands
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("No implementer code evidence was recorded.");
  });

  test("rejects completion when build or test evidence failed", () => {
    const result = evaluateFactoryCompletionGate({
      threads: [thread],
      messages: validMessages,
      tickets: doneTickets,
      ticketEvents: reviewerEvents,
      codeEvidence,
      commandEvidence: [{ ...passingCommands[0]!, exitCode: 1, stderr: "test failed" }]
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("No passing build command evidence was recorded.");
    expect(result.reasons).toContain("No passing test command evidence was recorded.");
  });

  test("rejects completion when only test evidence passed but build evidence is missing", () => {
    const result = evaluateFactoryCompletionGate({
      threads: [thread],
      messages: validMessages,
      tickets: doneTickets,
      ticketEvents: reviewerEvents,
      codeEvidence,
      commandEvidence: [passingCommands[1]!]
    });

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("No passing build command evidence was recorded.");
  });

  test("accepts completion with tickets, code evidence, passing commands, reviewer evidence, and replies", () => {
    const result = evaluateFactoryCompletionGate({
      threads: [thread],
      messages: validMessages,
      tickets: doneTickets,
      ticketEvents: reviewerEvents,
      codeEvidence,
      commandEvidence: passingCommands
    });

    expect(result.passed).toBe(true);
    expect(result.responders).toEqual(["implementer", "reviewer"]);
    expect(result.evidence).toMatchObject({
      doneTickets: 3,
      implementerCodeEvidence: 1,
      passingCommands: 2,
      passingBuildCommands: 1,
      passingTestCommands: 1,
      reviewerEvents: 1
    });
  });
});
