import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createBlackboard } from "../src/blackboard/db.js";
import { createApiServer } from "../src/conductor/api.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("dashboard API", () => {
  test("serves run, ticket, thread, message, and agent-log observability state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-factory-dashboard-"));
    try {
      const board = createBlackboard(join(dir, "factory.sqlite"));
      const project = board.createProject({
        title: "Dashboard test",
        prompt: "observe a long-running run",
        status: "active"
      });
      board.createRun({
        runId: "run-dashboard",
        projectId: project.id,
        targetDir: dir,
        goal: "observe a long-running run",
        status: "running",
        gatewayUrl: "http://127.0.0.1:5173"
      });
      const ticket = board.createTicket({
        projectId: project.id,
        title: "Review generated app",
        description: "Reviewer and implementer coordinate on final acceptance.",
        status: "review",
        priority: 1,
        ownerAgent: "reviewer",
        collaboratorAgents: ["implementer", "architect"],
        acceptanceCriteria: "Build passes and collaboration event exists.",
        createdBy: "planner"
      });
      board.appendTicketEvent({ ticketId: ticket.id, agentId: "reviewer", eventType: "review", body: "Looks ready." });
      board.recordCoralThread({
        id: "thread-dashboard",
        runId: "run-dashboard",
        sessionId: "session-dashboard",
        name: "Final review",
        creatorAgent: "planner",
        participants: ["planner", "implementer", "reviewer"],
        state: { phase: "review" }
      });
      board.recordCoralMessage({
        id: "message-dashboard",
        runId: "run-dashboard",
        sessionId: "session-dashboard",
        threadId: "thread-dashboard",
        senderAgent: "planner",
        mentions: ["reviewer"],
        body: "Please review the generated app."
      });
      board.recordAgentLog({
        runId: "run-dashboard",
        agentId: "reviewer",
        level: "info",
        message: "Review started",
        data: { ticketId: ticket.id }
      });
      board.recordArchitectureBrief({
        runId: "run-dashboard",
        agentId: "architect",
        body: "Architecture brief persisted for the gateway."
      });
      board.recordReviewVerdict({
        runId: "run-dashboard",
        cycle: 1,
        agentId: "architect",
        verdict: "green",
        body: "Architecture green."
      });

      const server = await createApiServer({ board, runId: "run-dashboard", port: 0 });
      servers.push(server);
      const dashboard = await fetch(`http://127.0.0.1:${server.port}/api/dashboard`).then((res) => res.json());

      expect(dashboard.run.runId).toBe("run-dashboard");
      expect(dashboard.kanban.columns.review[0].collaboratorAgents).toEqual(["implementer", "architect"]);
      expect(dashboard.ticketEvents[0].body).toBe("Looks ready.");
      expect(dashboard.threads[0].name).toBe("Final review");
      expect(dashboard.messages[0].body).toContain("review");
      expect(dashboard.logs[0].agentId).toBe("reviewer");
      expect(dashboard.architectureBriefs[0].body).toContain("Architecture brief");
      expect(dashboard.reviewVerdicts[0]).toMatchObject({ agentId: "architect", verdict: "green" });
      board.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
