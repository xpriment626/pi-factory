import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunContext } from "./config.js";

export type CoralProcess = {
  child: ChildProcessByStdio<null, Readable, Readable>;
  logPath: string;
  stop: () => Promise<void>;
};

function tailLog(logPath: string, bytes = 8000) {
  if (!existsSync(logPath)) return "";
  const content = readFileSync(logPath, "utf8");
  return content.slice(Math.max(0, content.length - bytes)).trim();
}

function findModernJavaHome() {
  if (process.platform !== "darwin") return undefined;
  try {
    return execFileSync("/usr/libexec/java_home", ["-v", "24+"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function stopProcessTree(child: ChildProcessByStdio<null, Readable, Readable>, signal: NodeJS.Signals) {
  try {
    if (process.platform === "win32" || !child.pid) {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code !== "ESRCH") throw error;
  }
}

export async function waitForCoral(
  baseUrl = "http://127.0.0.1:5555",
  timeoutMs = 180000,
  coral?: CoralProcess
) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    if (coral && coral.child.exitCode !== null) {
      throw new Error(
        `Coral exited before becoming ready with code ${coral.child.exitCode}.\n${tailLog(coral.logPath)}`
      );
    }
    try {
      const res = await fetch(baseUrl);
      if (res.status > 0) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const log = coral ? `\n${tailLog(coral.logPath)}` : "";
  throw new Error(`Coral did not become ready at ${baseUrl}: ${lastError}${log}`);
}

export function startCoral(ctx: RunContext): CoralProcess {
  const logPath = join(ctx.coralDir, "coral-server.log");
  mkdirSync(ctx.coralDir, { recursive: true });
  const javaHome = process.env.JAVA_HOME ?? findModernJavaHome();
  const pathPrefix = javaHome ? `${javaHome}/bin:` : "";
  const child = spawn("npx", ["-y", "coralos-dev@latest", "server", "start"], {
    cwd: ctx.projectRoot,
    env: {
      ...process.env,
      ...(javaHome ? { JAVA_HOME: javaHome, PATH: `${pathPrefix}${process.env.PATH ?? ""}` } : {}),
      CONFIG_FILE_PATH: ctx.coralConfigPath,
      FACTORY_WORKER_HOLD_MS: "120000"
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk: Buffer) => {
    writeFileSync(logPath, chunk, { flag: "a" });
  });
  child.stderr.on("data", (chunk: Buffer) => {
    writeFileSync(logPath, chunk, { flag: "a" });
  });
  return {
    child,
    logPath,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        stopProcessTree(child, "SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) {
            stopProcessTree(child, "SIGKILL");
          }
        }, 5000).unref();
      })
  };
}
