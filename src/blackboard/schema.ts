export const schemaSql = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS factory_runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  target_dir TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  gateway_url TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
  priority INTEGER NOT NULL,
  owner_agent TEXT,
  collaborator_agents_json TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_touches (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (run_id, agent_id)
);

CREATE TABLE IF NOT EXISTS coral_threads (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_id TEXT,
  name TEXT NOT NULL,
  creator_agent TEXT,
  participants_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coral_messages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_id TEXT,
  thread_id TEXT NOT NULL,
  sender_agent TEXT NOT NULL,
  mentions_json TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coral_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_id TEXT,
  thread_id TEXT,
  event_type TEXT NOT NULL,
  agent_id TEXT,
  body TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS code_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  ticket_id TEXT,
  agent_id TEXT NOT NULL,
  path TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS command_evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  ticket_id TEXT,
  agent_id TEXT NOT NULL,
  command TEXT NOT NULL,
  cwd TEXT NOT NULL,
  exit_code INTEGER,
  stdout TEXT NOT NULL,
  stderr TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS architecture_briefs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_verdicts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  cycle INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('green', 'changes_requested')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_project_status ON tickets(project_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON ticket_events(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_factory_runs_status ON factory_runs(status, started_at);
CREATE INDEX IF NOT EXISTS idx_coral_events_run ON coral_events(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_coral_threads_run ON coral_threads(run_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_coral_messages_run ON coral_messages(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_coral_messages_thread ON coral_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_logs_run ON agent_logs(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agents_run ON agents(run_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_code_evidence_run ON code_evidence(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_command_evidence_run ON command_evidence(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_architecture_briefs_run ON architecture_briefs(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_review_verdicts_run_cycle ON review_verdicts(run_id, cycle, created_at);
`;
