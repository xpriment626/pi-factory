import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(here, "factory-smoke-extension.ts");

export function piPathEnv() {
  try {
    const piPath = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
    const piBinDir = dirname(piPath);
    return `${piBinDir}:${process.env.PATH ?? ""}`;
  } catch {
    return process.env.PATH;
  }
}

type RpcResponse = {
  id?: string;
  type?: string;
  command?: string;
  success?: boolean;
  data?: {
    commands?: Array<{ name: string }>;
  };
};

export async function verifyPiExtensionLoading(input: { cwd: string }) {
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
      cwd: input.cwd,
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
    .map((line) => JSON.parse(line) as RpcResponse);
  const response = responses.find((line) => line.id === "commands");
  const commandNames = response?.data?.commands?.map((command) => command.name) ?? [];

  return {
    success: exit.code === 0 && response?.success === true,
    commandNames,
    stdout,
    stderr,
    exit
  };
}
