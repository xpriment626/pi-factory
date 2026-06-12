import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { schemaSql } from "./schema.js";
import type {
  AgentState,
  AgentLog,
  CoralMessage,
  CoralThread,
  CoralTimelineEvent,
  Dashboard,
  FactoryRun,
  Kanban,
  Project,
  Ticket,
  TicketEvent,
  TicketStatus
} from "./types.js";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

type DbRow = Record<string, unknown>;
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const statuses: TicketStatus[] = ["todo", "in_progress", "review", "done"];

const now = () => new Date().toISOString();
const stringify = (value: unknown) => JSON.stringify(value ?? null);
const stringifyArray = (value: string[] | undefined | null) => JSON.stringify(value ?? []);

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const projectFromRow = (row: DbRow): Project => ({
  id: String(row.id),
  title: String(row.title),
  prompt: String(row.prompt),
  status: String(row.status),
  createdAt: String(row.created_at)
});

const runFromRow = (row: DbRow): FactoryRun => ({
  runId: String(row.run_id),
  projectId: row.project_id == null ? null : String(row.project_id),
  targetDir: String(row.target_dir),
  goal: String(row.goal),
  status: String(row.status),
  gatewayUrl: row.gateway_url == null ? null : String(row.gateway_url),
  startedAt: String(row.started_at),
  completedAt: row.completed_at == null ? null : String(row.completed_at),
  summary: row.summary == null ? null : String(row.summary)
});

const ticketFromRow = (row: DbRow): Ticket => ({
  id: String(row.id),
  projectId: String(row.project_id),
  title: String(row.title),
  description: String(row.description),
  status: String(row.status) as TicketStatus,
  priority: Number(row.priority),
  ownerAgent: row.owner_agent == null ? null : String(row.owner_agent),
  collaboratorAgents: parseJson<string[]>(row.collaborator_agents_json, []),
  acceptanceCriteria: String(row.acceptance_criteria),
  createdBy: String(row.created_by),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

const ticketEventFromRow = (row: DbRow): TicketEvent => ({
  id: String(row.id),
  ticketId: String(row.ticket_id),
  agentId: String(row.agent_id),
  eventType: String(row.event_type),
  body: String(row.body),
  createdAt: String(row.created_at)
});

const coralThreadFromRow = (row: DbRow): CoralThread => ({
  id: String(row.id),
  runId: String(row.run_id),
  sessionId: row.session_id == null ? null : String(row.session_id),
  name: String(row.name),
  creatorAgent: row.creator_agent == null ? null : String(row.creator_agent),
  participants: parseJson<string[]>(row.participants_json, []),
  state: parseJson(row.state_json, {}),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

const coralMessageFromRow = (row: DbRow): CoralMessage => ({
  id: String(row.id),
  runId: String(row.run_id),
  sessionId: row.session_id == null ? null : String(row.session_id),
  threadId: String(row.thread_id),
  senderAgent: String(row.sender_agent),
  mentions: parseJson<string[]>(row.mentions_json, []),
  body: String(row.body),
  createdAt: String(row.created_at)
});

const coralEventFromRow = (row: DbRow): CoralTimelineEvent => ({
  id: String(row.id),
  runId: String(row.run_id),
  sessionId: row.session_id == null ? null : String(row.session_id),
  threadId: row.thread_id == null ? null : String(row.thread_id),
  eventType: String(row.event_type),
  agentId: row.agent_id == null ? null : String(row.agent_id),
  body: String(row.body),
  rawJson: String(row.raw_json),
  createdAt: String(row.created_at)
});

const agentLogFromRow = (row: DbRow): AgentLog => ({
  id: String(row.id),
  runId: String(row.run_id),
  agentId: String(row.agent_id),
  level: String(row.level),
  message: String(row.message),
  data: parseJson(row.data_json, null),
  createdAt: String(row.created_at)
});

const agentStateFromRow = (row: DbRow): AgentState => ({
  runId: String(row.run_id),
  agentId: String(row.agent_id),
  role: row.role == null ? null : String(row.role),
  status: String(row.status),
  summary: String(row.summary),
  metadata: parseJson(row.metadata_json, null),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  lastSeenAt: String(row.last_seen_at)
});

export class Blackboard {
  readonly db: DatabaseSyncType;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(schemaSql);
    this.migrate();
  }

  private migrate() {
    const ticketColumns = new Set(
      (this.db.prepare("PRAGMA table_info(tickets)").all() as Array<{ name: string }>).map((column) => column.name)
    );
    if (!ticketColumns.has("collaborator_agents_json")) {
      this.db.exec("ALTER TABLE tickets ADD COLUMN collaborator_agents_json TEXT NOT NULL DEFAULT '[]'");
    }
  }

  close() {
    this.db.close();
  }

  createProject(input: { id?: string; title: string; prompt: string; status?: string }): Project {
    const project: Project = {
      id: input.id ?? randomUUID(),
      title: input.title,
      prompt: input.prompt,
      status: input.status ?? "active",
      createdAt: now()
    };
    this.db
      .prepare("INSERT INTO projects (id, title, prompt, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(project.id, project.title, project.prompt, project.status, project.createdAt);
    return project;
  }

  createRun(input: {
    runId: string;
    projectId?: string | null;
    targetDir: string;
    goal: string;
    status?: string;
    gatewayUrl?: string | null;
    summary?: string | null;
  }): FactoryRun {
    const run: FactoryRun = {
      runId: input.runId,
      projectId: input.projectId ?? null,
      targetDir: input.targetDir,
      goal: input.goal,
      status: input.status ?? "running",
      gatewayUrl: input.gatewayUrl ?? null,
      startedAt: now(),
      completedAt: null,
      summary: input.summary ?? null
    };
    this.db
      .prepare(
        `INSERT INTO factory_runs
        (run_id, project_id, target_dir, goal, status, gateway_url, started_at, completed_at, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.runId,
        run.projectId,
        run.targetDir,
        run.goal,
        run.status,
        run.gatewayUrl,
        run.startedAt,
        run.completedAt,
        run.summary
      );
    return run;
  }

  updateRun(input: { runId: string; status?: string; gatewayUrl?: string | null; summary?: string | null; completed?: boolean }): FactoryRun {
    const current = this.getRun(input.runId);
    const status = input.status ?? current.status;
    const gatewayUrl = input.gatewayUrl === undefined ? current.gatewayUrl : input.gatewayUrl;
    const summary = input.summary === undefined ? current.summary : input.summary;
    const completedAt = input.completed ? now() : current.completedAt;
    this.db
      .prepare("UPDATE factory_runs SET status = ?, gateway_url = ?, completed_at = ?, summary = ? WHERE run_id = ?")
      .run(status, gatewayUrl, completedAt, summary, input.runId);
    return this.getRun(input.runId);
  }

  getRun(runId: string): FactoryRun {
    const row = this.db.prepare("SELECT * FROM factory_runs WHERE run_id = ?").get(runId) as DbRow | undefined;
    if (!row) throw new Error(`Factory run not found: ${runId}`);
    return runFromRow(row);
  }

  createTicket(input: {
    id?: string;
    projectId: string;
    title: string;
    description: string;
    status: TicketStatus;
    priority: number;
    ownerAgent?: string | null;
    collaboratorAgents?: string[];
    acceptanceCriteria: string;
    createdBy: string;
  }): Ticket {
    const stamp = now();
    const ticket: Ticket = {
      id: input.id ?? randomUUID(),
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      ownerAgent: input.ownerAgent ?? null,
      collaboratorAgents: input.collaboratorAgents ?? [],
      acceptanceCriteria: input.acceptanceCriteria,
      createdBy: input.createdBy,
      createdAt: stamp,
      updatedAt: stamp
    };
    this.db
      .prepare(
        `INSERT INTO tickets
        (id, project_id, title, description, status, priority, owner_agent, collaborator_agents_json, acceptance_criteria, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ticket.id,
        ticket.projectId,
        ticket.title,
        ticket.description,
        ticket.status,
        ticket.priority,
        ticket.ownerAgent,
        stringifyArray(ticket.collaboratorAgents),
        ticket.acceptanceCriteria,
        ticket.createdBy,
        ticket.createdAt,
        ticket.updatedAt
      );
    return ticket;
  }

  updateTicketStatus(ticketId: string, status: TicketStatus, ownerAgent?: string | null): Ticket {
    this.db
      .prepare("UPDATE tickets SET status = ?, owner_agent = COALESCE(?, owner_agent), updated_at = ? WHERE id = ?")
      .run(status, ownerAgent ?? null, now(), ticketId);
    const row = this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId) as DbRow | undefined;
    if (!row) throw new Error(`Ticket not found: ${ticketId}`);
    return ticketFromRow(row);
  }

  updateTicket(input: { ticketId: string; status?: TicketStatus; ownerAgent?: string | null; collaboratorAgents?: string[] }): Ticket {
    const currentRow = this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(input.ticketId) as DbRow | undefined;
    if (!currentRow) throw new Error(`Ticket not found: ${input.ticketId}`);
    const current = ticketFromRow(currentRow);
    this.db
      .prepare("UPDATE tickets SET status = ?, owner_agent = ?, collaborator_agents_json = ?, updated_at = ? WHERE id = ?")
      .run(
        input.status ?? current.status,
        input.ownerAgent === undefined ? current.ownerAgent : input.ownerAgent,
        stringifyArray(input.collaboratorAgents ?? current.collaboratorAgents),
        now(),
        input.ticketId
      );
    const row = this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(input.ticketId) as DbRow;
    return ticketFromRow(row);
  }

  appendTicketEvent(input: { ticketId: string; agentId: string; eventType: string; body: string }): TicketEvent {
    const event: TicketEvent = {
      id: randomUUID(),
      ticketId: input.ticketId,
      agentId: input.agentId,
      eventType: input.eventType,
      body: input.body,
      createdAt: now()
    };
    this.db
      .prepare("INSERT INTO ticket_events (id, ticket_id, agent_id, event_type, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(event.id, event.ticketId, event.agentId, event.eventType, event.body, event.createdAt);
    this.touch("ticket", input.ticketId, input.agentId, input.eventType);
    return event;
  }

  listTicketEvents(ticketId: string): TicketEvent[] {
    return (this.db.prepare("SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY created_at ASC").all(ticketId) as DbRow[]).map(
      ticketEventFromRow
    );
  }

  listProjectTicketEvents(projectId: string): TicketEvent[] {
    const rows = this.db
      .prepare(
        `SELECT te.* FROM ticket_events te
        JOIN tickets t ON t.id = te.ticket_id
        WHERE t.project_id = ?
        ORDER BY te.created_at ASC`
      )
      .all(projectId) as DbRow[];
    return rows.map(ticketEventFromRow);
  }

  listKanban(projectId?: string): Kanban {
    const projectRow = projectId
      ? (this.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as DbRow | undefined)
      : (this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC LIMIT 1").get() as DbRow | undefined);
    if (!projectRow) throw new Error("No project found");
    const project = projectFromRow(projectRow);
    const rows = this.db
      .prepare("SELECT * FROM tickets WHERE project_id = ? ORDER BY priority ASC, created_at ASC")
      .all(project.id) as DbRow[];
    const columns: Record<TicketStatus, Ticket[]> = {
      todo: [],
      in_progress: [],
      review: [],
      done: []
    };
    for (const ticket of rows.map(ticketFromRow)) columns[ticket.status].push(ticket);
    return { project, columns };
  }

  touch(entryType: string, entryId: string, agentId: string, action: string) {
    this.db
      .prepare("INSERT INTO agent_touches (id, entry_type, entry_id, agent_id, action, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), entryType, entryId, agentId, action, now());
  }

  recordAgentState(input: {
    runId: string;
    agentId: string;
    role?: string | null;
    status: string;
    summary: string;
    metadata?: unknown;
  }): AgentState {
    const stamp = now();
    this.db
      .prepare(
        `INSERT INTO agents
        (run_id, agent_id, role, status, summary, metadata_json, created_at, updated_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, agent_id) DO UPDATE SET
          role = COALESCE(excluded.role, agents.role),
          status = excluded.status,
          summary = excluded.summary,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at,
          last_seen_at = excluded.last_seen_at`
      )
      .run(
        input.runId,
        input.agentId,
        input.role ?? null,
        input.status,
        input.summary,
        stringify(input.metadata ?? null),
        stamp,
        stamp,
        stamp
      );
    const row = this.db.prepare("SELECT * FROM agents WHERE run_id = ? AND agent_id = ?").get(input.runId, input.agentId) as DbRow;
    return agentStateFromRow(row);
  }

  recordCoralEvent(input: {
    runId: string;
    sessionId?: string | null;
    threadId?: string | null;
    eventType: string;
    agentId?: string | null;
    body: string;
    raw: unknown;
  }): CoralTimelineEvent {
    const event: CoralTimelineEvent = {
      id: randomUUID(),
      runId: input.runId,
      sessionId: input.sessionId ?? null,
      threadId: input.threadId ?? null,
      eventType: input.eventType,
      agentId: input.agentId ?? null,
      body: input.body,
      rawJson: JSON.stringify(input.raw),
      createdAt: now()
    };
    this.db
      .prepare(
        `INSERT INTO coral_events
        (id, run_id, session_id, thread_id, event_type, agent_id, body, raw_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(event.id, event.runId, event.sessionId, event.threadId, event.eventType, event.agentId, event.body, event.rawJson, event.createdAt);
    return event;
  }

  recordCoralThread(input: {
    id?: string;
    runId: string;
    sessionId?: string | null;
    name: string;
    creatorAgent?: string | null;
    participants: string[];
    state: unknown;
  }): CoralThread {
    const stamp = now();
    const thread: CoralThread = {
      id: input.id ?? randomUUID(),
      runId: input.runId,
      sessionId: input.sessionId ?? null,
      name: input.name,
      creatorAgent: input.creatorAgent ?? null,
      participants: input.participants,
      state: input.state,
      createdAt: stamp,
      updatedAt: stamp
    };
    this.db
      .prepare(
        `INSERT INTO coral_threads
        (id, run_id, session_id, name, creator_agent, participants_json, state_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          creator_agent = excluded.creator_agent,
          participants_json = excluded.participants_json,
          state_json = excluded.state_json,
          updated_at = excluded.updated_at`
      )
      .run(
        thread.id,
        thread.runId,
        thread.sessionId,
        thread.name,
        thread.creatorAgent,
        stringifyArray(thread.participants),
        stringify(thread.state),
        thread.createdAt,
        thread.updatedAt
      );
    return thread;
  }

  recordCoralMessage(input: {
    id?: string;
    runId: string;
    sessionId?: string | null;
    threadId: string;
    senderAgent: string;
    mentions: string[];
    body: string;
  }): CoralMessage {
    const message: CoralMessage = {
      id: input.id ?? randomUUID(),
      runId: input.runId,
      sessionId: input.sessionId ?? null,
      threadId: input.threadId,
      senderAgent: input.senderAgent,
      mentions: input.mentions,
      body: input.body,
      createdAt: now()
    };
    this.db
      .prepare(
        `INSERT INTO coral_messages
        (id, run_id, session_id, thread_id, sender_agent, mentions_json, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          run_id = excluded.run_id,
          session_id = excluded.session_id,
          thread_id = excluded.thread_id,
          sender_agent = excluded.sender_agent,
          mentions_json = excluded.mentions_json,
          body = excluded.body`
      )
      .run(
        message.id,
        message.runId,
        message.sessionId,
        message.threadId,
        message.senderAgent,
        stringifyArray(message.mentions),
        message.body,
        message.createdAt
      );
    this.recordAgentState({
      runId: message.runId,
      agentId: message.senderAgent,
      status: "communicating",
      summary: message.body.slice(0, 220),
      metadata: { threadId: message.threadId, mentions: message.mentions }
    });
    return message;
  }

  recordAgentLog(input: { runId: string; agentId: string; level: string; message: string; data?: unknown }): AgentLog {
    const log: AgentLog = {
      id: randomUUID(),
      runId: input.runId,
      agentId: input.agentId,
      level: input.level,
      message: input.message,
      data: input.data ?? null,
      createdAt: now()
    };
    this.db
      .prepare("INSERT INTO agent_logs (id, run_id, agent_id, level, message, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(log.id, log.runId, log.agentId, log.level, log.message, stringify(log.data), log.createdAt);
    this.recordAgentState({
      runId: log.runId,
      agentId: log.agentId,
      status: log.level,
      summary: log.message,
      metadata: log.data
    });
    return log;
  }

  listCoralTimeline(runId?: string): CoralTimelineEvent[] {
    const query = runId
      ? this.db.prepare("SELECT * FROM coral_events WHERE run_id = ? ORDER BY created_at ASC")
      : this.db.prepare("SELECT * FROM coral_events ORDER BY created_at ASC");
    const rows = (runId ? query.all(runId) : query.all()) as DbRow[];
    return rows.map(coralEventFromRow);
  }

  listCoralThreads(runId: string): CoralThread[] {
    return (this.db.prepare("SELECT * FROM coral_threads WHERE run_id = ? ORDER BY updated_at ASC").all(runId) as DbRow[]).map(
      coralThreadFromRow
    );
  }

  listCoralMessages(runId: string): CoralMessage[] {
    return (this.db.prepare("SELECT * FROM coral_messages WHERE run_id = ? ORDER BY created_at ASC").all(runId) as DbRow[]).map(
      coralMessageFromRow
    );
  }

  listAgentLogs(runId: string): AgentLog[] {
    return (this.db.prepare("SELECT * FROM agent_logs WHERE run_id = ? ORDER BY created_at ASC").all(runId) as DbRow[]).map(agentLogFromRow);
  }

  listAgents(runId: string): AgentState[] {
    return (this.db.prepare("SELECT * FROM agents WHERE run_id = ? ORDER BY updated_at DESC, agent_id ASC").all(runId) as DbRow[]).map(
      agentStateFromRow
    );
  }

  getDashboard(runId: string): Dashboard {
    const run = this.getRun(runId);
    const kanban = this.listKanban(run.projectId ?? undefined);
    return {
      run,
      kanban,
      ticketEvents: this.listProjectTicketEvents(kanban.project.id),
      comms: this.listCoralTimeline(runId),
      threads: this.listCoralThreads(runId),
      messages: this.listCoralMessages(runId),
      logs: this.listAgentLogs(runId),
      agents: this.listAgents(runId)
    };
  }
}

export function createBlackboard(path: string) {
  return new Blackboard(path);
}
