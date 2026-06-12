import type { Ticket } from "../blackboard/types.js";

export type FactoryTicketPhases = {
  planning: Ticket[];
  architecture: Ticket[];
  implementation: Ticket[];
  review: Ticket[];
  implementationAnchor: Ticket;
  validationAnchor: Ticket;
  collaborationAnchor: Ticket;
};

function textOf(ticket: Ticket) {
  return `${ticket.title} ${ticket.description} ${ticket.acceptanceCriteria}`.toLowerCase();
}

function looksLikeValidation(ticket: Ticket) {
  const text = textOf(ticket);
  return text.includes("test") || text.includes("build") || text.includes("validation") || text.includes("verify");
}

export function selectFactoryTicketPhases(tickets: Ticket[]): FactoryTicketPhases {
  if (tickets.length === 0) throw new Error("Cannot select ticket phases without tickets.");

  const planning = tickets.filter((ticket) => ticket.ownerAgent === "planner");
  const architecture = tickets.filter((ticket) => ticket.ownerAgent === "architect");
  const implementation = tickets.filter((ticket) => ticket.ownerAgent === "implementer");
  const review = tickets.filter((ticket) => ticket.ownerAgent === "reviewer");

  const implementationAnchor = implementation[0] ?? tickets[0]!;
  const validationAnchor =
    implementation.find((ticket) => looksLikeValidation(ticket) && ticket.collaboratorAgents.includes("reviewer")) ??
    implementation.find(looksLikeValidation) ??
    tickets.find((ticket) => looksLikeValidation(ticket) && ticket.collaboratorAgents.includes("reviewer")) ??
    tickets.find(looksLikeValidation) ??
    review[0] ??
    tickets[tickets.length - 1]!;
  const collaborationAnchor =
    review.find((ticket) => ticket.collaboratorAgents.includes("implementer")) ??
    review[0] ??
    tickets[tickets.length - 1]!;

  return {
    planning: planning.length ? planning : [tickets[0]!],
    architecture,
    implementation: implementation.length ? implementation : [implementationAnchor],
    review: review.length ? review : [collaborationAnchor],
    implementationAnchor,
    validationAnchor,
    collaborationAnchor
  };
}
