#!/usr/bin/env node

const roleIndex = process.argv.indexOf("--role");
const role = roleIndex >= 0 ? process.argv[roleIndex + 1] : process.env.CORAL_AGENT_ID || "unknown";
const holdMs = Number(process.env.FACTORY_WORKER_HOLD_MS || "120000");

console.log(
  JSON.stringify({
    event: "factory-worker-started",
    role,
    coralAgentId: process.env.CORAL_AGENT_ID || null,
    coralSessionId: process.env.CORAL_SESSION_ID || null,
    hasCoralConnectionUrl: Boolean(process.env.CORAL_CONNECTION_URL),
    hasCoralApiUrl: Boolean(process.env.CORAL_API_URL)
  })
);

let done = false;
const finish = () => {
  if (done) return;
  done = true;
  console.log(JSON.stringify({ event: "factory-worker-stopped", role }));
  process.exit(0);
};

process.on("SIGTERM", finish);
process.on("SIGINT", finish);

setTimeout(finish, holdMs).unref();
setInterval(() => {}, 1000);
