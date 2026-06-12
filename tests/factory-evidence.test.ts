import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createBlackboard } from "../src/blackboard/db.js";

describe("factory evidence persistence", () => {
  test("records code and command evidence in the dashboard", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-factory-evidence-"));
    try {
      const board = createBlackboard(join(dir, "factory.sqlite"));
      const project = board.createProject({ title: "Evidence", prompt: "prove implementation" });
      board.createRun({
        runId: "run-evidence",
        projectId: project.id,
        targetDir: dir,
        goal: "prove implementation",
        status: "running"
      });
      const ticket = board.createTicket({
        projectId: project.id,
        title: "Implement app",
        description: "Create runnable files.",
        status: "in_progress",
        priority: 1,
        ownerAgent: "implementer",
        collaboratorAgents: ["reviewer"],
        acceptanceCriteria: "Files and commands are persisted.",
        createdBy: "planner"
      });

      board.recordCodeEvidence({
        runId: "run-evidence",
        ticketId: ticket.id,
        agentId: "implementer",
        path: "package.json",
        action: "created",
        summary: "Created package manifest."
      });
      board.recordCommandEvidence({
        runId: "run-evidence",
        ticketId: ticket.id,
        agentId: "reviewer",
        command: "npm test",
        cwd: dir,
        exitCode: 0,
        stdout: "Smoke passed",
        stderr: ""
      });
      board.recordArchitectureBrief({
        runId: "run-evidence",
        agentId: "architect",
        body: "Use a small local HTTP API and JSON persistence. Review validation and file layout before green-lighting."
      });
      board.recordReviewVerdict({
        runId: "run-evidence",
        cycle: 1,
        agentId: "architect",
        verdict: "green",
        body: "Architecture review passed against actual files."
      });
      board.recordReviewVerdict({
        runId: "run-evidence",
        cycle: 1,
        agentId: "reviewer",
        verdict: "green",
        body: "Build and tests passed."
      });

      const dashboard = board.getDashboard("run-evidence");
      expect(dashboard.codeEvidence).toHaveLength(1);
      expect(dashboard.codeEvidence[0]).toMatchObject({
        agentId: "implementer",
        path: "package.json",
        action: "created"
      });
      expect(dashboard.commandEvidence).toHaveLength(1);
      expect(dashboard.commandEvidence[0]).toMatchObject({
        agentId: "reviewer",
        command: "npm test",
        exitCode: 0
      });
      expect(dashboard.architectureBriefs).toHaveLength(1);
      expect(dashboard.architectureBriefs[0]).toMatchObject({
        agentId: "architect",
        body: expect.stringContaining("HTTP API")
      });
      expect(dashboard.reviewVerdicts).toHaveLength(2);
      expect(dashboard.reviewVerdicts.map((item) => item.agentId)).toEqual(["architect", "reviewer"]);
      board.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
