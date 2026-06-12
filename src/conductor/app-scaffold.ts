import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function readGoalWithReferences(targetDir: string, goal: string) {
  return goal.replace(/@([A-Za-z0-9_.\-/]+)/g, (_match, ref: string) => {
    try {
      return `\n\n--- ${ref} ---\n${readFileSync(join(targetDir, ref), "utf8")}\n--- end ${ref} ---\n`;
    } catch {
      return `@${ref}`;
    }
  });
}

export function scaffoldNotionLiteApp(targetDir: string, goal: string) {
  mkdirSync(join(targetDir, "src"), { recursive: true });
  mkdirSync(join(targetDir, "public"), { recursive: true });
  mkdirSync(join(targetDir, "scripts"), { recursive: true });
  mkdirSync(join(targetDir, "tests"), { recursive: true });

  writeFileSync(
    join(targetDir, "package.json"),
    JSON.stringify(
      {
        name: "notion-lite-factory-demo",
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          start: "node src/server.mjs",
          build: "node scripts/build.mjs",
          test: "node tests/smoke.mjs"
        },
        dependencies: {}
      },
      null,
      2
    ) + "\n"
  );

  writeFileSync(
    join(targetDir, "src", "server.mjs"),
    `import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const port = Number(process.env.PORT || 4173);
const root = join(process.cwd(), "public");
const tasks = [
  { id: "task-1", title: "Draft launch notes", status: "todo" },
  { id: "task-2", title: "Review dashboard copy", status: "doing" },
  { id: "task-3", title: "Ship first workspace", status: "done" }
];
const notes = [
  { id: "note-1", title: "Daily plan", body: "Capture priorities, blockers, and follow-ups." }
];

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"]
]);

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function staticFile(pathname, res) {
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  const body = await readFile(join(root, file));
  res.writeHead(200, { "content-type": types.get(extname(file)) || "text/plain; charset=utf-8" });
  res.end(body);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/api/tasks") return json(res, 200, { tasks });
    if (url.pathname === "/api/notes") return json(res, 200, { notes });
    await staticFile(url.pathname, res);
  } catch (error) {
    json(res, 404, { error: error instanceof Error ? error.message : String(error) });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(\`Notion Lite listening on http://127.0.0.1:\${port}\`);
});
`
  );

  writeFileSync(
    join(targetDir, "public", "index.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Notion Lite</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main>
      <header>
        <p>Factory generated app</p>
        <h1>Notion Lite</h1>
      </header>
      <section class="grid">
        <article>
          <h2>Kanban</h2>
          <div id="tasks" class="columns"></div>
        </article>
        <article>
          <h2>Notes</h2>
          <textarea id="note" spellcheck="false"></textarea>
        </article>
      </section>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
`
  );

  writeFileSync(
    join(targetDir, "public", "style.css"),
    `:root {
  color: #1b1f23;
  background: #f4f1ea;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body { margin: 0; }
main { width: min(1120px, calc(100vw - 32px)); margin: 0 auto; padding: 28px 0; }
header { border-bottom: 2px solid #202124; margin-bottom: 20px; }
header p { margin: 0 0 6px; text-transform: uppercase; font-size: 12px; font-weight: 800; }
h1 { margin: 0 0 16px; font-size: clamp(36px, 6vw, 76px); line-height: .9; }
h2 { margin: 0 0 12px; }
.grid { display: grid; grid-template-columns: 1.3fr .7fr; gap: 18px; }
article { background: #fffdf7; border: 1px solid #202124; box-shadow: 5px 5px 0 #202124; padding: 16px; }
.columns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.lane { min-height: 260px; border: 1px solid #202124; padding: 10px; background: #f8f6ef; }
.lane h3 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; }
.card { border: 1px solid #202124; background: white; padding: 10px; margin-bottom: 8px; }
textarea { width: 100%; min-height: 338px; resize: vertical; border: 1px solid #202124; padding: 12px; font: inherit; }
@media (max-width: 820px) { .grid, .columns { grid-template-columns: 1fr; } }
`
  );

  writeFileSync(
    join(targetDir, "public", "app.js"),
    `const labels = { todo: "To do", doing: "Doing", done: "Done" };
const tasks = await fetch("/api/tasks").then((res) => res.json()).then((data) => data.tasks);
const notes = await fetch("/api/notes").then((res) => res.json()).then((data) => data.notes);
const root = document.querySelector("#tasks");
for (const status of Object.keys(labels)) {
  const lane = document.createElement("section");
  lane.className = "lane";
  lane.innerHTML = \`<h3>\${labels[status]}</h3>\`;
  for (const task of tasks.filter((item) => item.status === status)) {
    const card = document.createElement("div");
    card.className = "card";
    card.textContent = task.title;
    lane.append(card);
  }
  root.append(lane);
}
document.querySelector("#note").value = notes[0]?.body || "";
`
  );

  writeFileSync(
    join(targetDir, "scripts", "build.mjs"),
    `import { cp, mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await cp("public", "dist/public", { recursive: true });
await cp("src", "dist/src", { recursive: true });
console.log("Build complete");
`
  );

  writeFileSync(
    join(targetDir, "tests", "smoke.mjs"),
    `import { existsSync, readFileSync } from "node:fs";
const required = ["package.json", "src/server.mjs", "public/index.html", "public/app.js", "public/style.css"];
for (const file of required) {
  if (!existsSync(file)) throw new Error(\`Missing \${file}\`);
}
const html = readFileSync("public/index.html", "utf8");
const server = readFileSync("src/server.mjs", "utf8");
if (!html.includes("Notion Lite")) throw new Error("UI title missing");
if (!server.includes("/api/tasks") || !server.includes("/api/notes")) throw new Error("API endpoints missing");
console.log("Smoke passed");
`
  );

  writeFileSync(
    join(targetDir, "FACTORY_SUMMARY.md"),
    `# Factory Summary

Generated from:

${goal}

Artifacts:
- Node HTTP API in src/server.mjs
- Browser UI in public/
- Build script in scripts/build.mjs
- Smoke test in tests/smoke.mjs
`
  );
}
