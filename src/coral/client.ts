import type { RunContext } from "./config.js";

const roles = [
  { sessionName: "planner", registryName: "factory-planner", description: "Plans the wiring demo and creates placeholder tickets." },
  { sessionName: "architect", registryName: "factory-architect", description: "Checks system boundaries and Coral/Pi wiring." },
  { sessionName: "implementer", registryName: "factory-implementer", description: "Represents implementation work for the wiring demo." },
  { sessionName: "reviewer", registryName: "factory-reviewer", description: "Reviews smoke evidence and acceptance checks." }
];

const headers = (authKey: string) => ({
  authorization: `Bearer ${authKey}`,
  "content-type": "application/json"
});

async function readResponse(res: Response) {
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Coral ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

export function buildSessionRequest(ctx: RunContext) {
  return {
    agentGraphRequest: {
      agents: roles.map((role) => ({
        id: {
          name: role.registryName,
          version: "0.1.0",
          registrySourceId: { type: "local" }
        },
        name: role.sessionName,
        description: role.description,
        systemPrompt: `You are the ${role.sessionName} in a local pi-factory wiring demo. Keep messages concise.`,
        blocking: false,
        provider: { type: "local", runtime: "executable" },
        annotations: { factoryRunId: ctx.runId, role: role.sessionName }
      })),
      groups: [roles.map((role) => role.sessionName)]
    },
    namespaceProvider: {
      type: "create_if_not_exists",
      namespaceRequest: {
        name: `factory-${ctx.runId}`.slice(0, 48),
        deleteOnLastSessionExit: false,
        annotations: { factoryRunId: ctx.runId }
      }
    },
    execution: {
      mode: "immediate",
      runtimeSettings: {
        ttl: 180000,
        extendedEndReport: true,
        persistenceMode: { mode: "hold_after_exit", duration: 300000 }
      }
    },
    annotations: { factoryRunId: ctx.runId }
  };
}

export async function createFactorySession(input: { baseUrl: string; ctx: RunContext }) {
  const res = await fetch(`${input.baseUrl}/api/v1/local/session`, {
    method: "POST",
    headers: headers(input.ctx.authKey),
    body: JSON.stringify(buildSessionRequest(input.ctx))
  });
  return (await readResponse(res)) as { namespace: string; sessionId: string };
}

export async function getExtendedSession(input: { baseUrl: string; authKey: string; namespace: string; sessionId: string }) {
  const res = await fetch(`${input.baseUrl}/api/v1/local/session/${input.namespace}/${input.sessionId}/extended`, {
    headers: headers(input.authKey)
  });
  return readResponse(res);
}

export async function puppetPingThread(input: { baseUrl: string; authKey: string; namespace: string; sessionId: string }) {
  const threadRes = await fetch(`${input.baseUrl}/api/v1/puppet/${input.namespace}/${input.sessionId}/planner/thread`, {
    method: "POST",
    headers: headers(input.authKey),
    body: JSON.stringify({
      threadName: "factory wiring ping",
      participantNames: ["architect", "implementer", "reviewer"]
    })
  });
  const threadBody = (await readResponse(threadRes)) as { thread: { id: string } };
  const threadId = threadBody.thread.id;
  const messageRes = await fetch(`${input.baseUrl}/api/v1/puppet/${input.namespace}/${input.sessionId}/planner/thread/message`, {
    method: "POST",
    headers: headers(input.authKey),
    body: JSON.stringify({
      threadId,
      content: "ping: Coral session, Puppet API, and blackboard mirror are wired.",
      mentions: ["implementer"]
    })
  });
  return {
    thread: threadBody.thread,
    message: await readResponse(messageRes)
  };
}
