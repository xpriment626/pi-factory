import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { piPathEnv } from "./rpc.js";

export type PiAgentArgsInput = {
  role: string;
  sessionDir: string;
  prompt: string;
  tools?: string[];
  disableBuiltinTools?: boolean;
};

export function buildPiAgentArgs(input: PiAgentArgsInput) {
  const args = [
    "--print",
    "--provider",
    "openrouter",
    "--model",
    "deepseek/deepseek-v4-pro",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--session-dir",
    join(input.sessionDir, input.role)
  ];
  if (input.disableBuiltinTools) args.splice(6, 0, "--no-builtin-tools");
  if (input.tools?.length) args.push("--tools", input.tools.join(","));
  args.push(input.prompt);
  return args;
}

async function runPiProcess(input: {
  cwd: string;
  args: string[];
  timeoutMs?: number;
  failureLabel: string;
}) {
  const child = spawn("pi", input.args, {
    cwd: input.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: piPathEnv() }
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const timeout = setTimeout(() => child.kill("SIGTERM"), input.timeoutMs ?? 180000);
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);

  const response = stdout.trim();
  if (exit.code !== 0 || response.length === 0) {
    throw new Error(`${input.failureLabel} failed: ${stderr.trim() || `exit ${exit.code}`}`);
  }

  return { response, stderr: stderr.trim(), exit };
}

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

export async function runPiAgentTurn(input: {
  cwd: string;
  sessionDir: string;
  role: string;
  prompt: string;
  timeoutMs?: number;
}) {
  mkdirSync(input.sessionDir, { recursive: true });
  const args = buildPiAgentArgs({
    role: input.role,
    sessionDir: input.sessionDir,
    prompt: input.prompt,
    disableBuiltinTools: true
  });
  const result = await runPiProcess({
    cwd: input.cwd,
    args,
    timeoutMs: input.timeoutMs,
    failureLabel: `Pi ${input.role} turn`
  });

  return {
    role: input.role,
    response: result.response,
    stderr: result.stderr,
    exit: result.exit,
    sessionPath: join(input.sessionDir, input.role),
    command: `pi --print --provider openrouter --model deepseek/deepseek-v4-pro --session-dir ${join(input.sessionDir, input.role)} <${input.role}-prompt>`
  };
}

export async function runPiToolAgent(input: {
  cwd: string;
  sessionDir: string;
  role: string;
  prompt: string;
  tools: string[];
  timeoutMs?: number;
}) {
  mkdirSync(join(input.sessionDir, input.role), { recursive: true });
  const args = buildPiAgentArgs({
    role: input.role,
    sessionDir: input.sessionDir,
    prompt: input.prompt,
    tools: input.tools
  });
  const result = await runPiProcess({
    cwd: input.cwd,
    args,
    timeoutMs: input.timeoutMs,
    failureLabel: `Pi ${input.role} tool agent`
  });
  return {
    role: input.role,
    response: result.response,
    stderr: result.stderr,
    exit: result.exit,
    sessionPath: join(input.sessionDir, input.role),
    command: `pi --print --provider openrouter --model deepseek/deepseek-v4-pro --tools ${input.tools.join(",")} --session-dir ${join(input.sessionDir, input.role)} <${input.role}-prompt>`
  };
}
