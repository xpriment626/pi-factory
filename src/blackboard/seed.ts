import type { Blackboard } from "./db.js";

export function seedPlaceholderProject(board: Blackboard) {
  const project = board.createProject({
    title: "Factory wiring smoke run",
    prompt: "Prove Pi, Coral, SQLite, and the operator UI are connected."
  });

  const tickets = [
    {
      title: "Generate Coral server config",
      description: "Create a run-local config.toml that points at factory agents.",
      status: "todo" as const,
      ownerAgent: "planner"
    },
    {
      title: "Mirror Coral events",
      description: "Connect to the Coral event stream and store normalized comms events.",
      status: "in_progress" as const,
      ownerAgent: "architect"
    },
    {
      title: "Render operator UI",
      description: "Show placeholder kanban tickets and comms in one Svelte view.",
      status: "review" as const,
      ownerAgent: "implementer"
    },
    {
      title: "Verify Pi RPC loading",
      description: "Load a local Pi extension path and prove the command registry sees it.",
      status: "done" as const,
      ownerAgent: "reviewer"
    }
  ];

  tickets.forEach((ticket, index) => {
    const row = board.createTicket({
      projectId: project.id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: index + 1,
      ownerAgent: ticket.ownerAgent,
      acceptanceCriteria: "Visible in the operator UI and backed by SQLite.",
      createdBy: "planner"
    });
    board.appendTicketEvent({
      ticketId: row.id,
      agentId: ticket.ownerAgent,
      eventType: "seed",
      body: `Placeholder ticket seeded in ${ticket.status}.`
    });
  });

  return project;
}
