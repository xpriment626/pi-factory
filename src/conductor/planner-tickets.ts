import type { Blackboard } from "../blackboard/db.js";
import type { Ticket } from "../blackboard/types.js";

export type PlannerTicketDraft = {
  title: string;
  description: string;
  ownerAgent: string;
  collaboratorAgents: string[];
  acceptanceCriteria: string;
  priority: number;
};

export function defaultPlannerTicketPlan(): PlannerTicketDraft[] {
  return [
    {
      title: "Plan PRD implementation",
      description: "Read PRD and define the smallest Notion Lite build surface.",
      ownerAgent: "planner",
      collaboratorAgents: ["architect"],
      acceptanceCriteria: "Tickets map to PRD requirements.",
      priority: 1
    },
    {
      title: "Scaffold full-stack app",
      description: "Create backend API, static frontend, package scripts, and test harness.",
      ownerAgent: "implementer",
      collaboratorAgents: ["architect"],
      acceptanceCriteria: "Project has runnable app files and package scripts.",
      priority: 2
    },
    {
      title: "Validate install build test",
      description: "Run npm install, build, and smoke test in the target project.",
      ownerAgent: "implementer",
      collaboratorAgents: ["reviewer"],
      acceptanceCriteria: "All verification commands pass.",
      priority: 3
    },
    {
      title: "Collaborative review",
      description: "Planner, implementer, and reviewer coordinate on completion evidence.",
      ownerAgent: "reviewer",
      collaboratorAgents: ["planner", "implementer"],
      acceptanceCriteria: "At least one Coral thread/message is mirrored.",
      priority: 4
    }
  ];
}

function extractJsonCandidate(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) return text.slice(objectStart, objectEnd + 1);

  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) return text.slice(arrayStart, arrayEnd + 1);

  return text.trim();
}

function asString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Planner ticket is missing ${field}.`);
  return value.trim();
}

function asCollaborators(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

export function parsePlannerTicketPlan(input: unknown): PlannerTicketDraft[] {
  const parsed = typeof input === "string" ? JSON.parse(extractJsonCandidate(input)) : input;
  const rawTickets = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { tickets?: unknown }).tickets)
      ? (parsed as { tickets: unknown[] }).tickets
      : null;

  if (!rawTickets || rawTickets.length === 0) throw new Error("Planner output did not include tickets.");

  const tickets = rawTickets.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error("Planner ticket must be an object.");
    const record = raw as Record<string, unknown>;
    return {
      title: asString(record.title, "title"),
      description: asString(record.description, "description"),
      ownerAgent: asString(record.ownerAgent, "ownerAgent"),
      collaboratorAgents: asCollaborators(record.collaboratorAgents),
      acceptanceCriteria: asString(record.acceptanceCriteria, "acceptanceCriteria"),
      priority: typeof record.priority === "number" && Number.isFinite(record.priority) ? record.priority : index + 1
    };
  });

  let normalizedTickets = tickets;
  const participatingAgents = new Set(normalizedTickets.flatMap((ticket) => [ticket.ownerAgent, ...ticket.collaboratorAgents]));
  for (const required of ["implementer", "reviewer"]) {
    if (!participatingAgents.has(required)) throw new Error(`Planner tickets must involve ${required}.`);
  }

  if (!participatingAgents.has("planner")) {
    normalizedTickets = [
      {
        title: "Plan PRD implementation",
        description: "Read PRD and persist the planner-created implementation ticket plan.",
        ownerAgent: "planner",
        collaboratorAgents: ["architect"],
        acceptanceCriteria: "Tickets map directly to PRD requirements and assign implementation and review work.",
        priority: 1
      },
      ...normalizedTickets
    ];
  }

  return normalizedTickets.map((ticket, index) => ({ ...ticket, priority: index + 1 }));
}

export function createTicketsFromPlan(board: Blackboard, projectId: string, plan: PlannerTicketDraft[]): Ticket[] {
  return plan
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((ticket, index) =>
      board.createTicket({
        projectId,
        title: ticket.title,
        description: ticket.description,
        status: index === 0 ? "in_progress" : "todo",
        priority: ticket.priority,
        ownerAgent: ticket.ownerAgent,
        collaboratorAgents: ticket.collaboratorAgents,
        acceptanceCriteria: ticket.acceptanceCriteria,
        createdBy: "planner"
      })
    );
}
