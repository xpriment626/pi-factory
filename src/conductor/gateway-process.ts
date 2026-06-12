import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type GatewayState = {
  pid: number;
  gatewayUrl: string;
  apiUrl: string;
  factoryRoot: string;
  startedAt: string;
  command: string[];
};

export type GatewayStartResult = {
  launched: boolean;
  url: string;
  pid: number | null;
  reason?: string;
};

export type GatewayStopResult = {
  stopped: boolean;
  pid: number | null;
  message: string;
};

export function gatewayStatePath(factoryRoot: string) {
  return join(factoryRoot, ".factory", "gateway.json");
}

export function readGatewayState(factoryRoot: string): GatewayState | null {
  const path = gatewayStatePath(factoryRoot);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as GatewayState;
}

export function writeGatewayState(factoryRoot: string, state: GatewayState) {
  const path = gatewayStatePath(factoryRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

export async function portAvailable(port: number) {
  return await new Promise<boolean>((resolveAvailable) => {
    const server = createServer();
    server.once("error", () => resolveAvailable(false));
    server.once("listening", () => server.close(() => resolveAvailable(true)));
    server.listen(port, "127.0.0.1");
  });
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

async function waitForExit(pid: number, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!processAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processAlive(pid);
}

function gatewayEnv(apiPort: number) {
  const execDir = dirname(process.execPath);
  const localNode24 = "/Users/bambozlor/.nvm/versions/node/v24.10.0/bin";
  const path = [execDir, existsSync(localNode24) ? localNode24 : null, process.env.PATH ?? ""].filter(Boolean).join(":");
  return {
    ...process.env,
    FACTORY_ARCHIVE_MODE: "1",
    FACTORY_API_PORT: String(apiPort),
    PATH: path
  };
}

export async function startGatewayArchive(input: {
  factoryRoot: string;
  gatewayPort?: number;
  apiPort?: number;
}): Promise<GatewayStartResult> {
  const gatewayPort = input.gatewayPort ?? 5173;
  const apiPort = input.apiPort ?? 8787;
  const url = `http://127.0.0.1:${gatewayPort}`;
  const state = readGatewayState(input.factoryRoot);
  if (state && processAlive(state.pid)) return { launched: false, url: state.gatewayUrl, pid: state.pid, reason: "already running" };
  if (!(await portAvailable(gatewayPort))) return { launched: false, url, pid: null, reason: `port ${gatewayPort} is already in use` };
  if (!(await portAvailable(apiPort))) return { launched: false, url, pid: null, reason: `port ${apiPort} is already in use` };

  const command = ["npm", "run", "dev"];
  const child = spawn(command[0]!, command.slice(1), {
    cwd: input.factoryRoot,
    detached: true,
    stdio: "ignore",
    env: gatewayEnv(apiPort)
  });
  child.unref();
  writeGatewayState(input.factoryRoot, {
    pid: child.pid!,
    gatewayUrl: url,
    apiUrl: `http://127.0.0.1:${apiPort}`,
    factoryRoot: input.factoryRoot,
    startedAt: new Date().toISOString(),
    command
  });
  return { launched: true, url, pid: child.pid! };
}

export async function stopRecordedGateway(factoryRoot: string, options: { graceMs?: number } = {}): Promise<GatewayStopResult> {
  const path = gatewayStatePath(factoryRoot);
  const state = readGatewayState(factoryRoot);
  if (!state) return { stopped: false, pid: null, message: "No recorded factory gateway process." };

  const wasAlive = processAlive(state.pid);
  if (wasAlive) signalProcessGroup(state.pid, "SIGTERM");
  const stoppedAfterTerm = wasAlive ? await waitForExit(state.pid, options.graceMs ?? 1500) : true;
  if (!stoppedAfterTerm) {
    signalProcessGroup(state.pid, "SIGKILL");
    await waitForExit(state.pid, 1000);
  }
  rmSync(path, { force: true });

  const stopped = !processAlive(state.pid);
  return {
    stopped,
    pid: state.pid,
    message: stopped
      ? `Stopped factory gateway process ${state.pid}.`
      : `Gateway process ${state.pid} did not exit after SIGTERM/SIGKILL.`
  };
}

export function signalRecordedGatewaySync(factoryRoot: string, signal: NodeJS.Signals = "SIGTERM") {
  const path = gatewayStatePath(factoryRoot);
  const state = readGatewayState(factoryRoot);
  if (!state) return false;
  const signaled = processAlive(state.pid) ? signalProcessGroup(state.pid, signal) : true;
  rmSync(path, { force: true });
  return signaled;
}
