import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type RunContext = {
  projectRoot: string;
  runRoot: string;
  runId: string;
  runDir: string;
  dbPath: string;
  coralDir: string;
  coralConfigPath: string;
  authKey: string;
  customToolSecret: string;
};

export function createRunContext(input: { projectRoot: string; runRoot?: string; runId?: string }): RunContext {
  const projectRoot = resolve(input.projectRoot);
  const runId = input.runId ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const runRoot = resolve(input.runRoot ?? join(projectRoot, ".factory", "runs"));
  const runDir = join(runRoot, runId);
  const coralDir = join(runDir, "coral");
  mkdirSync(coralDir, { recursive: true });
  return {
    projectRoot,
    runRoot,
    runId,
    runDir,
    dbPath: join(runDir, "blackboard.sqlite"),
    coralDir,
    coralConfigPath: join(coralDir, "config.toml"),
    authKey: `factory-${randomUUID()}`,
    customToolSecret: randomUUID()
  };
}

export function writeCoralConfig(
  ctx: RunContext,
  input: { authKey?: string; customToolSecret?: string; port?: number } = {}
) {
  const authKey = input.authKey ?? ctx.authKey;
  const customToolSecret = input.customToolSecret ?? ctx.customToolSecret;
  const port = input.port ?? 5555;
  const localAgents = `${ctx.projectRoot}/agents/*`;
  const config = `[network]
bind_address = "127.0.0.1"
external_address = "127.0.0.1"
bind_port = ${port}
allow_any_host = true
custom_tool_secret = "${customToolSecret}"

[session]
default_wait_timeout = 240000

[auth]
keys = ["${authKey}"]

[registry]
include_coral_home_agents = false
include_debug_agents = false
include_marketplace_agents = false
watch_local_agents = true
local_agent_rescan_timer = "10s"
local_agents = ["${localAgents}"]

[console]
enabled = false
`;
  writeFileSync(ctx.coralConfigPath, config);
  return ctx.coralConfigPath;
}
