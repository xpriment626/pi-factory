import { describe, expect, test } from "vitest";
import { parsePlannerTicketPlan } from "../src/conductor/planner-tickets.js";

describe("planner ticket plan parsing", () => {
  test("extracts realistic tickets from planner JSON output", () => {
    const tickets = parsePlannerTicketPlan(`
      Planner output:
      {
        "tickets": [
          {
            "title": "Plan PRD implementation",
            "description": "Read PRD and define the smallest useful Notion Lite surface.",
            "ownerAgent": "planner",
            "collaboratorAgents": ["architect"],
            "acceptanceCriteria": "Tickets map directly to PRD requirements."
          },
          {
            "title": "Build app shell",
            "description": "Create runnable backend, frontend, package scripts, and tests.",
            "ownerAgent": "implementer",
            "collaboratorAgents": ["architect", "reviewer"],
            "acceptanceCriteria": "npm install, npm run build, and npm test are meaningful."
          }
        ]
      }
    `);

    expect(tickets).toEqual([
      {
        title: "Plan PRD implementation",
        description: "Read PRD and define the smallest useful Notion Lite surface.",
        ownerAgent: "planner",
        collaboratorAgents: ["architect"],
        acceptanceCriteria: "Tickets map directly to PRD requirements.",
        priority: 1
      },
      {
        title: "Build app shell",
        description: "Create runnable backend, frontend, package scripts, and tests.",
        ownerAgent: "implementer",
        collaboratorAgents: ["architect", "reviewer"],
        acceptanceCriteria: "npm install, npm run build, and npm test are meaningful.",
        priority: 2
      }
    ]);
  });

  test("rejects missing reviewer participation because factory completion needs review evidence", () => {
    expect(() =>
      parsePlannerTicketPlan({
        tickets: [
          {
            title: "Plan work",
            description: "Create tickets.",
            ownerAgent: "planner",
            collaboratorAgents: ["architect"],
            acceptanceCriteria: "Tickets exist."
          },
          {
            title: "Build app",
            description: "Create files.",
            ownerAgent: "implementer",
            collaboratorAgents: ["architect"],
            acceptanceCriteria: "Files exist."
          }
        ]
      })
    ).toThrow(/reviewer/i);
  });

  test("prepends a planner lifecycle ticket when model output only has downstream tickets", () => {
    const tickets = parsePlannerTicketPlan({
      tickets: [
        {
          title: "Architecture and setup",
          description: "Choose stack and scaffold files.",
          ownerAgent: "architect",
          collaboratorAgents: ["implementer"],
          acceptanceCriteria: "Architecture is clear."
        },
        {
          title: "Build app",
          description: "Create files.",
          ownerAgent: "implementer",
          collaboratorAgents: ["reviewer"],
          acceptanceCriteria: "Files exist."
        },
        {
          title: "Review app",
          description: "Check work.",
          ownerAgent: "reviewer",
          collaboratorAgents: ["implementer"],
          acceptanceCriteria: "Review is complete."
        }
      ]
    });

    expect(tickets[0]).toMatchObject({
      title: "Plan PRD implementation",
      ownerAgent: "planner",
      collaboratorAgents: ["architect"]
    });
    expect(tickets.map((ticket) => ticket.priority)).toEqual([1, 2, 3, 4]);
  });
});
