# pi-factory

Local-only first-pass wiring demo for a Pi + Coral + SQLite software-factory harness. This is not packaged for a marketplace and does not mutate `~/.coral/agents`.

## Shape

- `src/blackboard`: SQLite schema and API helpers for projects, kanban tickets, ticket events, agent touches, and Coral timelines.
- `src/conductor`: local API and dev launcher.
- `src/coral`: per-run Coral config generation, server launch, local session client, event mirror.
- `src/pi`: Pi RPC extension smoke check and live model ping helper.
- `src/ui`: Vite/Svelte operator view for kanban tickets and Coral comms.
- `agents/*/coral-agent.toml`: local Coral agent manifests for planner, architect, implementer, reviewer.
- `worker/pi-coral-worker.mjs`: minimal executable runtime worker that receives Coral environment variables.

## Commands

Install dependencies:

```sh
npm install
```

Run the local operator view:

```sh
npm run dev
```

The dev launcher creates `.factory/runs/<runId>/blackboard.sqlite`, writes `.factory/runs/<runId>/coral/config.toml`, starts the API on `http://127.0.0.1:8787`, and starts the UI on `http://127.0.0.1:5173`.

Open a previous run through the same UI:

```sh
FACTORY_RUN_ID=<runId> npm run dev
```

Use this after `npm run coral:test` when you want the live mirrored Coral events visible in the operator view.

## Verification

```sh
npm test
npm run build
npm run smoke
npm run coral:test
npm run pi:doctor
npm run pi:ping
```

`npm run smoke` does not call a model. It initializes SQLite, inserts placeholder kanban tickets, verifies the board/comms API, verifies local Pi extension loading through `pi --mode rpc --no-session --no-extensions -e ... get_commands`, and checks the generated Coral config points at the absolute `agents/*` paths.

`npm run coral:test` starts Coral with `CONFIG_FILE_PATH` pointed at the generated run config, creates a local session with the four local agent manifests, creates a Puppet API thread/message, mirrors the event websocket into SQLite, then stops Coral.

`npm run pi:ping` attempts a live Pi call with inherited config:

```sh
pi --print --provider openrouter --model deepseek/deepseek-v4-pro ...
```

It never reads or copies secrets. The response, or the exact failure, is appended to a placeholder ticket event.

`npm run pi:doctor` checks Pi/OpenRouter auth wiring without printing the key. It reports whether `OPENROUTER_API_KEY` is set, whether `~/.pi/agent/auth.json` has an OpenRouter entry, a short hash of the stored key for identity comparison, and OpenRouter's redacted `/api/v1/auth/key` response.

## Local Notes

- The project requires Node 24+ because it uses Node's built-in `node:sqlite` instead of a native SQLite addon. This avoids ABI drift when switching between Node 20 and Node 24.
- Coral currently needs a Java runtime new enough for class file version 68. The launcher prefers `/usr/libexec/java_home -v '24+'` on macOS when available.
- Pi is installed under the user's Node 24 path, but some shells resolve Node 20 first. The Pi helpers prepend the Pi binary directory to `PATH` before spawning `pi`.
- The factory is deliberately a wiring proof: the worker is structurally valid and long-lived, but it does not implement autonomous planning or implementation behavior yet.
