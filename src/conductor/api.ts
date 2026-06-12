import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Blackboard } from "../blackboard/db.js";
import type { TicketStatus } from "../blackboard/types.js";
import { listRunArchive, openRunDashboard } from "./run-archive.js";

type ApiOptions = {
  board: Blackboard;
  runId: string;
  factoryRoot?: string;
  port?: number;
  host?: string;
};

const statuses = new Set<TicketStatus>(["todo", "in_progress", "review", "done"]);

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(body);
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? {} : JSON.parse(text);
}

export async function createApiServer(options: ApiOptions) {
  const host = options.host ?? "127.0.0.1";
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        sendJson(res, 200, { ok: true });
        return;
      }
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, runId: options.runId });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/kanban") {
        sendJson(res, 200, options.board.listKanban(url.searchParams.get("projectId") ?? undefined));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/comms") {
        sendJson(res, 200, { runId: options.runId, events: options.board.listCoralTimeline(options.runId) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/runs") {
        sendJson(res, 200, options.factoryRoot ? listRunArchive(options.factoryRoot) : { runs: [], projectSpaces: [] });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        const requestedRunId = url.searchParams.get("runId") ?? options.runId;
        sendJson(
          res,
          200,
          options.factoryRoot && requestedRunId !== options.runId
            ? openRunDashboard(options.factoryRoot, requestedRunId)
            : options.board.getDashboard(requestedRunId)
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/tickets") {
        const body = (await readJson(req)) as Record<string, unknown>;
        const status = statuses.has(body.status as TicketStatus) ? (body.status as TicketStatus) : "todo";
        const kanban = options.board.listKanban();
        const collaboratorAgents = Array.isArray(body.collaboratorAgents) ? body.collaboratorAgents.map(String) : [];
        const ticket = options.board.createTicket({
          projectId: String(body.projectId ?? kanban.project.id),
          title: String(body.title ?? "Untitled ticket"),
          description: String(body.description ?? ""),
          status,
          priority: Number(body.priority ?? Date.now()),
          ownerAgent: body.ownerAgent == null ? null : String(body.ownerAgent),
          collaboratorAgents,
          acceptanceCriteria: String(body.acceptanceCriteria ?? "Visible in kanban."),
          createdBy: String(body.createdBy ?? "operator")
        });
        sendJson(res, 201, { ticket });
        return;
      }
      const ticketStatusMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
      if (req.method === "PATCH" && ticketStatusMatch) {
        const body = (await readJson(req)) as Record<string, unknown>;
        if (!statuses.has(body.status as TicketStatus)) {
          sendJson(res, 400, { error: "Invalid status" });
          return;
        }
        const ticket = options.board.updateTicketStatus(
          decodeURIComponent(ticketStatusMatch[1]!),
          body.status as TicketStatus,
          body.ownerAgent == null ? undefined : String(body.ownerAgent)
        );
        sendJson(res, 200, { ticket });
        return;
      }
      const ticketEventMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/events$/);
      if (req.method === "POST" && ticketEventMatch) {
        const body = (await readJson(req)) as Record<string, unknown>;
        const event = options.board.appendTicketEvent({
          ticketId: decodeURIComponent(ticketEventMatch[1]!),
          agentId: String(body.agentId ?? "operator"),
          eventType: String(body.eventType ?? "note"),
          body: String(body.body ?? "")
        });
        sendJson(res, 201, { event });
        return;
      }
      sendJson(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 8787, host, resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    host,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
