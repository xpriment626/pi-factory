import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { piPathEnv } from "../src/pi/rpc.js";

async function getCommandsForExtension(extensionPath: string) {
  const child = spawn(
    "pi",
    [
      "--mode",
      "rpc",
      "--no-session",
      "--no-extensions",
      "-e",
      extensionPath,
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--offline"
    ],
    {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: piPathEnv() }
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.stdin.write(JSON.stringify({ id: "commands", type: "get_commands" }) + "\n");
  child.stdin.end();
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  const responses = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id?: string; success?: boolean; data?: { commands?: Array<{ name: string }> } });
  const response = responses.find((line) => line.id === "commands");
  return { exit, stderr, commandNames: response?.data?.commands?.map((command) => command.name) ?? [] };
}

describe("pi package extension", () => {
  test("declares local Pi package extension resources", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      keywords?: string[];
      pi?: { extensions?: string[] };
    };
    expect(pkg.keywords).toContain("pi-package");
    expect(pkg.pi?.extensions).toContain("./extensions");
  });

  test("registers factory slash commands when loaded as an extension", async () => {
    const result = await getCommandsForExtension(join(process.cwd(), "extensions", "factory.ts"));
    expect(result.exit.code, result.stderr).toBe(0);
    expect(result.commandNames).toEqual(expect.arrayContaining(["factory", "factory-status", "factory-open", "factory-doctor", "factory-ping"]));
  }, 30000);
});
