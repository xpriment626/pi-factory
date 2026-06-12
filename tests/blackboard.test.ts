import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createBlackboard } from "../src/blackboard/db.js";
import { seedPlaceholderProject } from "../src/blackboard/seed.js";

describe("blackboard", () => {
  test("initializes schema, seeds tickets, and returns kanban columns", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-factory-db-"));
    try {
      const board = createBlackboard(join(dir, "factory.sqlite"));
      const project = seedPlaceholderProject(board);
      const kanban = board.listKanban(project.id);
      expect(kanban.project.id).toBe(project.id);
      expect(kanban.columns.todo.length).toBeGreaterThanOrEqual(1);
      expect(kanban.columns.in_progress.length).toBeGreaterThanOrEqual(1);
      expect(kanban.columns.review.length).toBeGreaterThanOrEqual(1);
      expect(kanban.columns.done.length).toBeGreaterThanOrEqual(1);
      const event = board.appendTicketEvent({
        ticketId: kanban.columns.todo[0]!.id,
        agentId: "planner",
        eventType: "note",
        body: "seed note"
      });
      expect(event.body).toBe("seed note");
      const events = board.listTicketEvents(kanban.columns.todo[0]!.id);
      expect(events.map((row) => row.eventType)).toEqual(["seed", "note"]);
      board.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
