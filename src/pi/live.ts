import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { piPathEnv } from "./rpc.js";

export async function runLivePiPing(input: { cwd: string; sessionDir: string; prompt?: string; timeoutMs?: number }) {
  mkdirSync(input.sessionDir, { recursive: true });
  const prompt =
    input.prompt ??
    "Reply with exactly one short sentence containing the word PONG and no markdown. This is a pi-factory wiring ping.";
  const child = spawn(
    "pi",
    [
      "--print",
      "--provider",
      "openrouter",
      "--model",
      "deepseek/deepseek-v4-pro",
      "--no-builtin-tools",
      "--no-context-files",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--session-dir",
      input.sessionDir,
      prompt
    ],
    {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
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

  const timeout = setTimeout(() => child.kill("SIGTERM"), input.timeoutMs ?? 120000);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);

  return {
    success: exit.code === 0 && stdout.trim().length > 0,
    response: stdout.trim(),
    stderr: stderr.trim(),
    exit,
    command: `pi --print --provider openrouter --model deepseek/deepseek-v4-pro --session-dir ${join(input.sessionDir)} <ping>`
  };
}
