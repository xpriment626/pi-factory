import type {
  ArchitectureBrief,
  CodeEvidence,
  CommandEvidence,
  CoralMessage,
  CoralThread,
  ReviewVerdict,
  Ticket,
  TicketEvent
} from "../blackboard/types.js";

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
    architectureBriefs: number;
    implementerCodeEvidence: number;
    passingCommands: number;
    passingBuildCommands: number;
    passingTestCommands: number;
    reviewerEvents: number;
    greenReviewVerdicts: number;
    latestReviewCycle: number | null;
    invalidCoralMessages: number;
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

function messageMatchesThreadParticipants(thread: CoralThread, message: CoralMessage) {
  const participants = new Set(thread.participants);
  return participants.has(message.senderAgent) && message.mentions.every((mention) => participants.has(mention));
}

function countInvalidCoralMessages(input: { threads: CoralThread[]; messages: CoralMessage[] }) {
  const threads = new Map(input.threads.map((thread) => [thread.id, thread]));
  return input.messages.filter((message) => {
    const thread = threads.get(message.threadId);
    return thread ? !messageMatchesThreadParticipants(thread, message) : false;
  }).length;
}

export function evaluateCoordinationGate(input: { threads: CoralThread[]; messages: CoralMessage[] }): CoordinationGateResult {
  const reasons: string[] = [];
  if (input.threads.length === 0) reasons.push("No persisted Coral threads were recorded.");
  if (input.messages.length === 0) reasons.push("No persisted Coral messages were recorded.");

  for (const thread of input.threads) {
    const messages = input.messages
      .filter((message) => message.threadId === thread.id)
      .filter((message) => messageMatchesThreadParticipants(thread, message))
      .sort(byCreatedAt);
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

function evaluateReviewThreadGate(input: { threads: CoralThread[]; messages: CoralMessage[] }): CoordinationGateResult {
  const reasons: string[] = [];
  let foundReadyForReview = false;

  for (const thread of input.threads) {
    const messages = input.messages
      .filter((message) => message.threadId === thread.id)
      .filter((message) => messageMatchesThreadParticipants(thread, message))
      .sort(byCreatedAt);
    const ready = messages.find(
      (message) => message.senderAgent === "implementer" && message.body.toLowerCase().includes("ready_for_review") && meaningful(message)
    );
    if (!ready) continue;
    foundReadyForReview = true;

    const afterReady = messages.filter((message) => byCreatedAt(message, ready) > 0);
    const responders = ["architect", "reviewer"].filter((agentId) =>
      afterReady.some((message) => message.senderAgent === agentId && meaningful(message))
    );
    if (responders.length === 2) {
      return {
        passed: true,
        threadId: thread.id,
        responders,
        messageCount: messages.length,
        reasons: []
      };
    }
  }

  reasons.push(
    foundReadyForReview
      ? "No review thread has implementer ready_for_review plus architect and reviewer replies."
      : "No implementer ready_for_review message was recorded."
  );
  return {
    passed: false,
    threadId: null,
    responders: [],
    messageCount: input.messages.length,
    reasons
  };
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
  architectureBriefs: ArchitectureBrief[];
  codeEvidence: CodeEvidence[];
  commandEvidence: CommandEvidence[];
  reviewVerdicts: ReviewVerdict[];
}): FactoryCompletionGateResult {
  const coordination = evaluateReviewThreadGate({ threads: input.threads, messages: input.messages });
  const reasons = [...coordination.reasons];
  const invalidCoralMessages = countInvalidCoralMessages({ threads: input.threads, messages: input.messages });
  const doneTickets = input.tickets.filter((ticket) => ticket.status === "done").length;
  const implementerCodeEvidence = input.codeEvidence.filter((evidence) => evidence.agentId === "implementer").length;
  const firstImplementerCodeAt =
    input.codeEvidence
      .filter((evidence) => evidence.agentId === "implementer")
      .map((evidence) => evidence.createdAt)
      .sort()[0] ?? null;
  const architectureBriefsBeforeImplementation = firstImplementerCodeAt
    ? input.architectureBriefs.filter((brief) => brief.agentId === "architect" && brief.createdAt < firstImplementerCodeAt).length
    : input.architectureBriefs.filter((brief) => brief.agentId === "architect").length;
  const passingCommands = input.commandEvidence.filter((evidence) => evidence.exitCode === 0 && isBuildOrTest(evidence)).length;
  const passingBuildCommands = input.commandEvidence.filter((evidence) => evidence.exitCode === 0 && isBuild(evidence)).length;
  const passingTestCommands = input.commandEvidence.filter((evidence) => evidence.exitCode === 0 && isTest(evidence)).length;
  const reviewerEvents = input.ticketEvents.filter((event) => event.agentId === "reviewer" && event.body.trim().length > 0).length;
  const latestReviewCycle =
    input.reviewVerdicts.length === 0 ? null : Math.max(...input.reviewVerdicts.map((verdict) => verdict.cycle));
  const latestVerdicts = latestReviewCycle == null ? [] : input.reviewVerdicts.filter((verdict) => verdict.cycle === latestReviewCycle);
  const latestArchitectGreen = latestVerdicts.some((verdict) => verdict.agentId === "architect" && verdict.verdict === "green");
  const latestReviewerGreen = latestVerdicts.some((verdict) => verdict.agentId === "reviewer" && verdict.verdict === "green");
  const latestChangesRequested = latestVerdicts.some((verdict) => verdict.verdict === "changes_requested");
  const greenReviewVerdicts = latestVerdicts.filter(
    (verdict) => (verdict.agentId === "architect" || verdict.agentId === "reviewer") && verdict.verdict === "green"
  ).length;

  if (input.tickets.length === 0) reasons.push("No tickets were recorded.");
  if (input.tickets.length > 0 && doneTickets !== input.tickets.length) reasons.push("Not all tickets are done.");
  if (architectureBriefsBeforeImplementation === 0) reasons.push("No architect brief was recorded before implementation evidence.");
  if (implementerCodeEvidence === 0) reasons.push("No implementer code evidence was recorded.");
  if (passingBuildCommands === 0) reasons.push("No passing build command evidence was recorded.");
  if (passingTestCommands === 0) reasons.push("No passing test command evidence was recorded.");
  if (reviewerEvents === 0) reasons.push("No reviewer verification evidence was recorded.");
  if (invalidCoralMessages > 0) reasons.push("Some Coral messages reference agents outside their thread participants.");
  if (!latestArchitectGreen) reasons.push("Latest architect verdict is not green.");
  if (!latestReviewerGreen) reasons.push("Latest reviewer verdict is not green.");
  if (latestChangesRequested) reasons.push("Latest review cycle has unresolved changes_requested verdicts.");

  const passed = reasons.length === 0;
  return {
    ...coordination,
    passed,
    reasons,
    evidence: {
      doneTickets,
      architectureBriefs: architectureBriefsBeforeImplementation,
      implementerCodeEvidence,
      passingCommands,
      passingBuildCommands,
      passingTestCommands,
      reviewerEvents,
      greenReviewVerdicts,
      latestReviewCycle,
      invalidCoralMessages
    }
  };
}

export function requireFactoryCompletionGate(input: {
  threads: CoralThread[];
  messages: CoralMessage[];
  tickets: Ticket[];
  ticketEvents: TicketEvent[];
  architectureBriefs: ArchitectureBrief[];
  codeEvidence: CodeEvidence[];
  commandEvidence: CommandEvidence[];
  reviewVerdicts: ReviewVerdict[];
}) {
  const result = evaluateFactoryCompletionGate(input);
  if (!result.passed) {
    throw new Error(`Completion gate failed: ${result.reasons.join(" ")}`);
  }
  return result;
}
