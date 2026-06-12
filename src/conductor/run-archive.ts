import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createBlackboard } from "../blackboard/db.js";
import type { RunArchive, RunArchiveEntry, TicketStatus } from "../blackboard/types.js";

const statuses: TicketStatus[] = ["todo", "in_progress", "review", "done"];

function runRoot(factoryRoot: string) {
  return join(factoryRoot, ".factory", "runs");
}

function runDbPath(factoryRoot: string, runId: string) {
  return join(runRoot(factoryRoot), runId, "blackboard.sqlite");
}

function sortRuns(a: RunArchiveEntry, b: RunArchiveEntry) {
  return b.startedAt.localeCompare(a.startedAt) || b.runId.localeCompare(a.runId);
}

export function listRunArchive(factoryRoot: string): RunArchive {
  const root = runRoot(factoryRoot);
  if (!existsSync(root)) return { runs: [], projectSpaces: [] };

  const runs: RunArchiveEntry[] = [];
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const dbPath = runDbPath(factoryRoot, dirent.name);
    if (!existsSync(dbPath)) continue;
    const board = createBlackboard(dbPath);
    try {
      const run = board.getRun(dirent.name);
      const kanban = board.listKanban(run.projectId ?? undefined);
      const ticketCounts = Object.fromEntries(
        statuses.map((status) => [status, kanban.columns[status].length])
      ) as Record<TicketStatus, number>;
      runs.push({
        ...run,
        projectTitle: kanban.project.title,
        ticketCounts,
        totalTickets: statuses.reduce((total, status) => total + ticketCounts[status], 0),
        coralEventCount: board.listCoralTimeline(run.runId).length,
        logCount: board.listAgentLogs(run.runId).length,
        dbPath
      });
    } catch {
      // Ignore partially initialized or incompatible run directories.
    } finally {
      board.close();
    }
  }

  runs.sort(sortRuns);
  const grouped = new Map<string, RunArchiveEntry[]>();
  for (const run of runs) grouped.set(run.targetDir, [...(grouped.get(run.targetDir) ?? []), run]);
  const projectSpaces = [...grouped.entries()]
    .map(([targetDir, spaceRuns]) => ({
      targetDir,
      latestRunAt: spaceRuns[0]?.startedAt ?? "",
      runs: spaceRuns
    }))
    .sort((a, b) => b.latestRunAt.localeCompare(a.latestRunAt) || a.targetDir.localeCompare(b.targetDir));

  return { runs, projectSpaces };
}

export function openRunDashboard(factoryRoot: string, runId: string) {
  const dbPath = runDbPath(factoryRoot, runId);
  if (!existsSync(dbPath)) throw new Error(`Factory run not found: ${runId}`);
  const board = createBlackboard(dbPath);
  try {
    return board.getDashboard(runId);
  } finally {
    board.close();
  }
}
