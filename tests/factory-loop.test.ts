import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createBlackboard } from "../src/blackboard/db.js";
import { runFactory } from "../src/conductor/factory-loop.js";

describe("factory loop", () => {
  test("builds a real Notion Lite app and records completion evidence", async () => {
    const targetDir = mkdtempSync(join(tmpdir(), "pi-factory-target-"));
    const runRoot = mkdtempSync(join(tmpdir(), "pi-factory-runs-"));
    try {
      writeFileSync(
        join(targetDir, "PRD.md"),
        [
          "# Notion Lite",
          "Build a simple full-stack productivity app.",
          "It needs a kanban todo tracker and freeform note taking.",
          "Use a lightweight local backend and browser UI."
        ].join("\n")
      );

      const result = await runFactory({
        factoryRoot: process.cwd(),
        targetDir,
        runRoot,
        runId: "loop-test",
        goal: "complete the app described in @PRD.md",
        startGateway: false,
        coralMode: "recorded"
      });

      expect(result.completed).toBe(true);
      expect(result.collaborationEvents).toBeGreaterThanOrEqual(1);
      expect(result.gatewayUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(result.summary).toContain("completed");
      expect(existsSync(join(targetDir, "package.json"))).toBe(true);
      expect(existsSync(join(targetDir, "src", "server.mjs"))).toBe(true);
      expect(existsSync(join(targetDir, "public", "index.html"))).toBe(true);
      expect(existsSync(join(targetDir, "tests", "smoke.mjs"))).toBe(true);
      expect(readFileSync(join(targetDir, "PRD.md"), "utf8")).toContain("Notion Lite");

      const board = createBlackboard(result.dbPath);
      const dashboard = board.getDashboard(result.runId);
      const tickets = dashboard.kanban.columns.done;
      expect(tickets.length).toBeGreaterThanOrEqual(4);
      expect(tickets.some((ticket) => ticket.collaboratorAgents.includes("reviewer"))).toBe(true);
      expect(dashboard.threads.length).toBeGreaterThanOrEqual(1);
      expect(dashboard.messages.map((message) => message.senderAgent)).toEqual(expect.arrayContaining(["planner", "implementer", "reviewer"]));
      expect(dashboard.messages.length).toBeGreaterThanOrEqual(3);
      expect(dashboard.codeEvidence.some((evidence) => evidence.agentId === "implementer" && evidence.path === "package.json")).toBe(true);
      expect(dashboard.commandEvidence.map((evidence) => evidence.agentId)).toEqual(expect.arrayContaining(["reviewer"]));
      expect(dashboard.commandEvidence.some((evidence) => evidence.command.includes("npm test") && evidence.exitCode === 0)).toBe(true);
      expect(dashboard.logs.some((log) => log.level === "complete")).toBe(true);
      const completion = dashboard.logs.find((log) => log.level === "complete");
      expect(completion?.data).toMatchObject({
        completionGate: {
          passed: true,
          evidence: {
            implementerCodeEvidence: expect.any(Number),
            passingCommands: expect.any(Number),
            reviewerEvents: expect.any(Number)
          }
        }
      });
      board.close();
    } finally {
      rmSync(targetDir, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
    }
  }, 30000);
});
