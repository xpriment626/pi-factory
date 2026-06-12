import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const authPath = join(process.env.HOME ?? "", ".pi", "agent", "auth.json");
const settingsPath = join(process.env.HOME ?? "", ".pi", "agent", "settings.json");

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const auth = readJson(authPath);
const settings = readJson(settingsPath);
const key = String(auth?.openrouter?.key ?? "");

let openrouterStatus: unknown = null;
if (key) {
  const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
    headers: { Authorization: `Bearer ${key}` }
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  openrouterStatus = {
    status: res.status,
    ok: res.ok,
    body:
      body && typeof body === "object"
        ? JSON.parse(JSON.stringify(body).replaceAll(key, "[REDACTED]"))
        : body
  };
}

console.log(
  JSON.stringify(
    {
      piSettings: {
        defaultProvider: settings.defaultProvider,
        defaultModel: settings.defaultModel
      },
      environment: {
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ? "SET" : "UNSET",
        PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR ? "SET" : "UNSET"
      },
      authJson: {
        hasOpenRouterEntry: Boolean(auth?.openrouter),
        type: auth?.openrouter?.type,
        keyLength: key.length,
        startsWithOpenRouterPrefix: key.startsWith("sk-or-v1-"),
        sha256_12: key ? createHash("sha256").update(key).digest("hex").slice(0, 12) : null
      },
      openrouterStatus
    },
    null,
    2
  )
);
