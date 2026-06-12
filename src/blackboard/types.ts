export type TicketStatus = "todo" | "in_progress" | "review" | "done";

export type Project = {
  id: string;
  title: string;
  prompt: string;
  status: string;
  createdAt: string;
};

export type FactoryRun = {
  runId: string;
  projectId: string | null;
  targetDir: string;
  goal: string;
  status: string;
  gatewayUrl: string | null;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
};

export type Ticket = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: number;
  ownerAgent: string | null;
  collaboratorAgents: string[];
  acceptanceCriteria: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TicketEvent = {
  id: string;
  ticketId: string;
  agentId: string;
  eventType: string;
  body: string;
  createdAt: string;
};

export type Kanban = {
  project: Project;
  columns: Record<TicketStatus, Ticket[]>;
};

export type CoralTimelineEvent = {
  id: string;
  runId: string;
  sessionId: string | null;
  threadId: string | null;
  eventType: string;
  agentId: string | null;
  body: string;
  rawJson: string;
  createdAt: string;
};

export type CoralThread = {
  id: string;
  runId: string;
  sessionId: string | null;
  name: string;
  creatorAgent: string | null;
  participants: string[];
  state: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CoralMessage = {
  id: string;
  runId: string;
  sessionId: string | null;
  threadId: string;
  senderAgent: string;
  mentions: string[];
  body: string;
  createdAt: string;
};

export type AgentLog = {
  id: string;
  runId: string;
  agentId: string;
  level: string;
  message: string;
  data: unknown;
  createdAt: string;
};

export type AgentState = {
  runId: string;
  agentId: string;
  role: string | null;
  status: string;
  summary: string;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
};

export type Dashboard = {
  run: FactoryRun;
  kanban: Kanban;
  ticketEvents: TicketEvent[];
  comms: CoralTimelineEvent[];
  threads: CoralThread[];
  messages: CoralMessage[];
  logs: AgentLog[];
  agents: AgentState[];
};

export type RunArchiveEntry = {
  runId: string;
  projectId: string | null;
  projectTitle: string;
  targetDir: string;
  goal: string;
  status: string;
  gatewayUrl: string | null;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  ticketCounts: Record<TicketStatus, number>;
  totalTickets: number;
  coralEventCount: number;
  logCount: number;
  dbPath: string;
};

export type ProjectSpaceArchive = {
  targetDir: string;
  latestRunAt: string;
  runs: RunArchiveEntry[];
};

export type RunArchive = {
  runs: RunArchiveEntry[];
  projectSpaces: ProjectSpaceArchive[];
};
