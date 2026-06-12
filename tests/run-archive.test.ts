import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createBlackboard } from "../src/blackboard/db.js";
import { createApiServer } from "../src/conductor/api.js";
import { listRunArchive } from "../src/conductor/run-archive.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function seedRun(root: string, input: { runId: string; targetDir: string; title: string; status: string }) {
  const board = createBlackboard(join(root, ".factory", "runs", input.runId, "blackboard.sqlite"));
  const project = board.createProject({ title: input.title, prompt: input.title, status: "active" });
  board.createRun({
    runId: input.runId,
    projectId: project.id,
    targetDir: input.targetDir,
    goal: input.title,
    status: input.status,
    gatewayUrl: "http://127.0.0.1:5173"
  });
  const ticket = board.createTicket({
    projectId: project.id,
    title: `${input.title} ticket`,
    description: "Archive visible ticket",
    status: input.status === "complete" ? "done" : "in_progress",
    priority: 1,
    ownerAgent: "planner",
    collaboratorAgents: ["reviewer"],
    acceptanceCriteria: "Visible in archive.",
    createdBy: "planner"
  });
  board.appendTicketEvent({ ticketId: ticket.id, agentId: "planner", eventType: "progress", body: "Seeded archive row." });
  board.recordCoralEvent({
    runId: input.runId,
    sessionId: null,
    threadId: null,
    eventType: "thread_message_sent",
    agentId: "planner",
    body: "Seeded collaboration.",
    raw: { seeded: true }
  });
  board.close();
}

describe("run archive", () => {
  test("maps runs to their project spaces across run directories", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-factory-archive-"));
    try {
      seedRun(root, { runId: "run-alpha", targetDir: "/tmp/project-alpha", title: "Alpha", status: "complete" });
      seedRun(root, { runId: "run-beta", targetDir: "/tmp/project-beta", title: "Beta", status: "running" });

      const archive = listRunArchive(root);

      expect(archive.runs.map((run) => run.runId)).toEqual(["run-beta", "run-alpha"]);
      expect(archive.projectSpaces.map((space) => space.targetDir)).toEqual(["/tmp/project-beta", "/tmp/project-alpha"]);
      expect(archive.projectSpaces[0].runs[0].ticketCounts.in_progress).toBe(1);
      expect(archive.projectSpaces[1].runs[0].coralEventCount).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("serves archive and selected run dashboard from one API server", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-factory-archive-api-"));
    try {
      seedRun(root, { runId: "run-alpha", targetDir: "/tmp/project-alpha", title: "Alpha", status: "complete" });
      seedRun(root, { runId: "run-beta", targetDir: "/tmp/project-beta", title: "Beta", status: "complete" });
      const board = createBlackboard(join(root, ".factory", "runs", "run-alpha", "blackboard.sqlite"));
      const server = await createApiServer({ board, runId: "run-alpha", factoryRoot: root, port: 0 });
      servers.push(server);

      const archive = await fetch(`http://127.0.0.1:${server.port}/api/runs`).then((res) => res.json());
      const beta = await fetch(`http://127.0.0.1:${server.port}/api/dashboard?runId=run-beta`).then((res) => res.json());

      expect(archive.projectSpaces).toHaveLength(2);
      expect(archive.runs.map((run: { runId: string }) => run.runId)).toContain("run-beta");
      expect(beta.run.runId).toBe("run-beta");
      expect(beta.run.targetDir).toBe("/tmp/project-beta");
      board.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
