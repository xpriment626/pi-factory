type SidebarRun = {
  runId: string;
};

type SidebarProjectSpace = {
  targetDir: string;
  runs: SidebarRun[];
};

function knownTargets(spaces: SidebarProjectSpace[]) {
  return new Set(spaces.map((space) => space.targetDir));
}

function sorted(values: Iterable<string>) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function activeSpaceTarget(spaces: SidebarProjectSpace[], runId: string | null | undefined) {
  if (!runId) return null;
  return spaces.find((space) => space.runs.some((run) => run.runId === runId))?.targetDir ?? null;
}

export function nextCollapsedSpaces(
  spaces: SidebarProjectSpace[],
  collapsedSpaces: Iterable<string>,
  selectedRunId: string | null | undefined
) {
  const targets = knownTargets(spaces);
  const activeTarget = activeSpaceTarget(spaces, selectedRunId);
  return sorted([...collapsedSpaces].filter((target) => targets.has(target) && target !== activeTarget));
}

export function toggleCollapsedSpace(collapsedSpaces: Iterable<string>, targetDir: string) {
  const next = new Set(collapsedSpaces);
  if (next.has(targetDir)) next.delete(targetDir);
  else next.add(targetDir);
  return sorted(next);
}
