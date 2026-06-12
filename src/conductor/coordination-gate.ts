import type { CodeEvidence, CommandEvidence, CoralMessage, CoralThread, Ticket, TicketEvent } from "../blackboard/types.js";

export type CoordinationGateResult = {
  passed: boolean;
  threadId: string | null;
  responders: string[];
  messageCount: number;
  reasons: string[];
};

export type FactoryCompletionGateResult = CoordinationGateResult & {
  evidence: {
    doneTickets: number;
    implementerCodeEvidence: number;
    passingCommands: number;
    passingBuildCommands: number;
    passingTestCommands: number;
    reviewerEvents: number;
  };
};

const REQUIRED_RESPONDERS = 2;

function byCreatedAt(a: CoralMessage, b: CoralMessage) {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function meaningful(message: CoralMessage) {
  const body = message.body.trim().toLowerCase();
  return body.length >= 20 && body !== "thread_created" && !body.startsWith("thread created:");
}

export function evaluateCoordinationGate(input: { threads: CoralThread[]; messages: CoralMessage[] }): CoordinationGateResult {
  const reasons: string[] = [];
  if (input.threads.length === 0) reasons.push("No persisted Coral threads were recorded.");
  if (input.messages.length === 0) reasons.push("No persisted Coral messages were recorded.");

  for (const thread of input.threads) {
    const messages = input.messages.filter((message) => message.threadId === thread.id).sort(byCreatedAt);
    const plannerRequest = messages.find(
      (message) => message.senderAgent === "planner" && message.mentions.length > 0 && meaningful(message)
    );
    if (!plannerRequest) continue;

    const mentioned = new Set(plannerRequest.mentions);
    const responders = [
      ...new Set(
        messages
          .filter((message) => message.id !== plannerRequest.id)
          .filter((message) => message.senderAgent !== "planner")
          .filter((message) => mentioned.has(message.senderAgent))
          .filter(meaningful)
          .map((message) => message.senderAgent)
      )
    ].sort((a, b) => a.localeCompare(b));

    if (responders.length >= REQUIRED_RESPONDERS) {
      return {
        passed: true,
        threadId: thread.id,
        responders,
        messageCount: messages.length,
        reasons: []
      };
    }
  }

  reasons.push("No thread has recipient responses from at least two non-planner agents.");
  return {
    passed: false,
    threadId: null,
    responders: [],
    messageCount: input.messages.length,
    reasons
  };
}

export function requireCoordinationGate(input: { threads: CoralThread[]; messages: CoralMessage[] }) {
  const result = evaluateCoordinationGate(input);
  if (!result.passed) {
    throw new Error(`Completion gate failed: ${result.reasons.join(" ")}`);
  }
  return result;
}

function isBuildOrTest(command: CommandEvidence) {
  const text = command.command.toLowerCase();
  return text.includes("build") || text.includes("test");
}

function isBuild(command: CommandEvidence) {
  return command.command.toLowerCase().includes("build");
}

function isTest(command: CommandEvidence) {
  return command.command.toLowerCase().includes("test");
}

export function evaluateFactoryCompletionGate(input: {
  threads: CoralThread[];
  messages: CoralMessage[];
  tickets: Ticket[];
  ticketEvents: TicketEvent[];
  codeEvidence: CodeEvidence[];
  commandEvidence: CommandEvidence[];
}): FactoryCompletionGateResult {
  const coordination = evaluateCoordinationGate({ threads: input.threads, messages: input.messages });
  const reasons = [...coordination.reasons];
  const doneTickets = input.tickets.filter((ticket) => ticket.status === "done").length;
  const implementerCodeEvidence = input.codeEvidence.filter((evidence) => evidence.agentId === "implementer").length;
  const passingCommands = input.commandEvidence.filter((evidence) => evidence.exitCode === 0 && isBuildOrTest(evidence)).length;
  const passingBuildCommands = input.commandEvidence.filter((evidence) => evidence.exitCode === 0 && isBuild(evidence)).length;
  const passingTestCommands = input.commandEvidence.filter((evidence) => evidence.exitCode === 0 && isTest(evidence)).length;
  const reviewerEvents = input.ticketEvents.filter((event) => event.agentId === "reviewer" && event.body.trim().length > 0).length;

  if (input.tickets.length === 0) reasons.push("No tickets were recorded.");
  if (input.tickets.length > 0 && doneTickets !== input.tickets.length) reasons.push("Not all tickets are done.");
  if (implementerCodeEvidence === 0) reasons.push("No implementer code evidence was recorded.");
  if (passingBuildCommands === 0) reasons.push("No passing build command evidence was recorded.");
  if (passingTestCommands === 0) reasons.push("No passing test command evidence was recorded.");
  if (reviewerEvents === 0) reasons.push("No reviewer verification evidence was recorded.");

  const passed = reasons.length === 0;
  return {
    ...coordination,
    passed,
    reasons,
    evidence: {
      doneTickets,
      implementerCodeEvidence,
      passingCommands,
      passingBuildCommands,
      passingTestCommands,
      reviewerEvents
    }
  };
}

export function requireFactoryCompletionGate(input: {
  threads: CoralThread[];
  messages: CoralMessage[];
  tickets: Ticket[];
  ticketEvents: TicketEvent[];
  codeEvidence: CodeEvidence[];
  commandEvidence: CommandEvidence[];
}) {
  const result = evaluateFactoryCompletionGate(input);
  if (!result.passed) {
    throw new Error(`Completion gate failed: ${result.reasons.join(" ")}`);
  }
  return result;
}
