import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FACTORY_PURGE_CONFIRMATION, purgeFactoryDataStores } from "../src/conductor/factory-data.js";
import { runFactory } from "../src/conductor/factory-loop.js";
import { signalRecordedGatewaySync, startGatewayArchive, stopRecordedGateway } from "../src/conductor/gateway-process.js";

type NotifyLevel = "info" | "warning" | "error";
type CommandContext = {
  ui: {
    notify: (message: string, level?: NotifyLevel) => void;
  };
};
type ExtensionAPI = {
  registerCommand: (
    name: string,
    command: {
      description: string;
      handler: (args: string, ctx: CommandContext) => Promise<void>;
    }
  ) => void;
};

const factoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let gatewayCleanupRegistered = false;

function modeFromEnv() {
  const mode = process.env.FACTORY_CORAL_MODE;
  return mode === "recorded" || mode === "skip" || mode === "live" ? mode : "live";
}

function truncate(text: string, limit = 1800) {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n... truncated ...`;
}

function registerGatewayCleanup() {
  if (gatewayCleanupRegistered) return;
  gatewayCleanupRegistered = true;
  process.once("exit", () => {
    signalRecordedGatewaySync(factoryRoot);
  });
}

async function runNpmScript(script: string) {
  const child = spawn("npm", ["run", script], {
    cwd: factoryRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: `/Users/bambozlor/.nvm/versions/node/v24.10.0/bin:${process.env.PATH ?? ""}` }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const exit = await new Promise<number | null>((resolveExit) => {
    child.on("exit", (code) => resolveExit(code));
  });
  return { exit, stdout: stdout.trim(), stderr: stderr.trim() };
}

export default function factoryExtension(pi: ExtensionAPI) {
  pi.registerCommand("factory", {
    description: "Run the local Pi + Coral factory loop for a goal or @PRD.md",
    handler: async (args, ctx) => {
      const goal = args.trim();
      if (!goal) {
        ctx.ui.notify("Usage: /factory <goal text or @PRD.md>", "warning");
        return;
      }
      const targetDir = process.cwd();
      const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
      const gatewayUrl = "http://127.0.0.1:5173";
      ctx.ui.notify(`Factory started: runId=${runId} url=${gatewayUrl}`, "info");
      const resultPromise = runFactory({
        factoryRoot,
        targetDir,
        goal,
        runId,
        startGateway: true,
        coralMode: modeFromEnv()
      });
      try {
        const result = await resultPromise;
        ctx.ui.notify(
          [
            "Factory completion logs:",
            `runId=${result.runId}`,
            `gateway=${result.gatewayUrl}`,
            `target=${result.targetDir}`,
            `ticketsDone=${result.ticketsCompleted}`,
            `collaborationEvents=${result.collaborationEvents}`,
            "checks=npm install, npm run build, npm test"
          ].join("\n"),
          "info"
        );
        ctx.ui.notify(result.summary, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Factory failed: runId=${runId}\n${message}`, "error");
        throw error;
      }
    }
  });

  pi.registerCommand("factory-status", {
    description: "Show local factory status guidance",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`Factory runs are stored under ${factoryRoot}/.factory/runs. Use FACTORY_RUN_ID=<runId> npm run dev to reopen a run.`, "info");
    }
  });

  pi.registerCommand("factory-open", {
    description: "Open the local factory gateway archive for all runs",
    handler: async (_args, ctx) => {
      const result = await startGatewayArchive({ factoryRoot });
      if (result.launched) registerGatewayCleanup();
      ctx.ui.notify(
        result.launched
          ? `Factory archive gateway started: ${result.url}\npid=${result.pid}`
          : `Factory archive gateway not launched: ${result.url}\n${result.reason ?? "already running"}${result.pid ? `\npid=${result.pid}` : ""}`,
        result.launched || result.reason === "already running" ? "info" : "warning"
      );
    }
  });

  pi.registerCommand("factory-stop", {
    description: "Stop the recorded local factory gateway process",
    handler: async (_args, ctx) => {
      const result = await stopRecordedGateway(factoryRoot);
      ctx.ui.notify(result.message, result.stopped ? "info" : "warning");
    }
  });

  pi.registerCommand("factory-purge", {
    description: "Delete all local pi-factory saved data after explicit confirmation",
    handler: async (args, ctx) => {
      const confirmation = args.trim();
      const result = await purgeFactoryDataStores(factoryRoot, confirmation);
      ctx.ui.notify(
        result.message,
        result.purged ? "info" : "warning"
      );
      if (!result.purged) {
        ctx.ui.notify(`This deletes .factory runs, blackboard SQLite files, Coral configs/logs, Pi session captures, and gateway state. Confirmation required: ${FACTORY_PURGE_CONFIRMATION}`, "warning");
      }
    }
  });

  pi.registerCommand("factory-doctor", {
    description: "Run pi-factory OpenRouter/Pi auth diagnostics",
    handler: async (_args, ctx) => {
      const result = await runNpmScript("pi:doctor");
      ctx.ui.notify(truncate(result.stdout || result.stderr || `factory-doctor exited ${result.exit}`), result.exit === 0 ? "info" : "error");
    }
  });

  pi.registerCommand("factory-ping", {
    description: "Run live Pi model ping and store result in a blackboard run",
    handler: async (_args, ctx) => {
      const result = await runNpmScript("pi:ping");
      ctx.ui.notify(truncate(result.stdout || result.stderr || `factory-ping exited ${result.exit}`), result.exit === 0 ? "info" : "error");
    }
  });
}
