import { describe, expect, test } from "vitest";
import type { Ticket } from "../src/blackboard/types.js";
import { selectFactoryTicketPhases } from "../src/conductor/ticket-phases.js";

function ticket(input: Partial<Ticket> & Pick<Ticket, "id" | "ownerAgent" | "title">): Ticket {
  return {
    projectId: "project-phases",
    description: input.title,
    status: "todo",
    priority: 1,
    collaboratorAgents: [],
    acceptanceCriteria: input.title,
    createdBy: "planner",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...input
  };
}

describe("ticket phases", () => {
  test("groups every implementer-owned planner ticket into the implementation phase", () => {
    const phases = selectFactoryTicketPhases([
      ticket({ id: "plan", title: "PLAN: Allocate tickets", ownerAgent: "planner" }),
      ticket({ id: "backend", title: "IMPLEMENT: Backend API", ownerAgent: "implementer" }),
      ticket({ id: "frontend", title: "IMPLEMENT: Frontend UI", ownerAgent: "implementer" }),
      ticket({ id: "build", title: "IMPLEMENT: Build tooling", ownerAgent: "implementer", collaboratorAgents: ["planner"] }),
      ticket({ id: "tests", title: "IMPLEMENT: Write tests", ownerAgent: "implementer", collaboratorAgents: ["reviewer"] }),
      ticket({ id: "review", title: "REVIEW: Final validation", ownerAgent: "reviewer", collaboratorAgents: ["implementer"] })
    ]);

    expect(phases.planning.map((item) => item.id)).toEqual(["plan"]);
    expect(phases.implementation.map((item) => item.id)).toEqual(["backend", "frontend", "build", "tests"]);
    expect(phases.review.map((item) => item.id)).toEqual(["review"]);
    expect(phases.implementationAnchor.id).toBe("backend");
    expect(phases.validationAnchor.id).toBe("tests");
    expect(phases.collaborationAnchor.id).toBe("review");
  });
});
