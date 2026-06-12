import { describe, expect, test } from "vitest";
import { buildPiAgentArgs } from "../src/pi/live.js";

describe("Pi agent harness args", () => {
  test("enables coding tools for implementer and read/bash tools for reviewer", () => {
    const implementer = buildPiAgentArgs({
      role: "implementer",
      sessionDir: "/tmp/sessions",
      prompt: "build app",
      tools: ["read", "write", "edit", "bash", "ls", "grep", "find"]
    });
    const reviewer = buildPiAgentArgs({
      role: "reviewer",
      sessionDir: "/tmp/sessions",
      prompt: "review app",
      tools: ["read", "bash", "ls", "grep", "find"]
    });

    expect(implementer).toContain("--tools");
    expect(implementer).toContain("read,write,edit,bash,ls,grep,find");
    expect(implementer).not.toContain("--no-builtin-tools");
    expect(implementer).toContain("/tmp/sessions/implementer");
    expect(reviewer).toContain("--tools");
    expect(reviewer).toContain("read,bash,ls,grep,find");
    expect(reviewer).not.toContain("write");
    expect(reviewer).not.toContain("edit");
  });
});
