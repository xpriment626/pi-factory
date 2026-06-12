import { describe, expect, test } from "vitest";
import { activeSpaceTarget, nextCollapsedSpaces, toggleCollapsedSpace } from "../src/ui/sidebar-state.js";

const spaces = [
  {
    targetDir: "/workspace/alpha",
    latestRunAt: "2026-06-12T00:00:00.000Z",
    runs: [{ runId: "run-alpha" }]
  },
  {
    targetDir: "/workspace/beta",
    latestRunAt: "2026-06-12T00:00:00.000Z",
    runs: [{ runId: "run-beta" }]
  }
];

describe("sidebar collapse state", () => {
  test("keeps the active run space expanded while preserving other collapsed spaces", () => {
    const collapsed = nextCollapsedSpaces(spaces, ["alpha", "/workspace/beta"], "run-alpha");

    expect(collapsed).toEqual(["/workspace/beta"]);
    expect(activeSpaceTarget(spaces, "run-alpha")).toBe("/workspace/alpha");
  });

  test("toggles project space collapse by target directory", () => {
    expect(toggleCollapsedSpace([], "/workspace/alpha")).toEqual(["/workspace/alpha"]);
    expect(toggleCollapsedSpace(["/workspace/alpha", "/workspace/beta"], "/workspace/alpha")).toEqual(["/workspace/beta"]);
  });
});
