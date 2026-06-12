import WebSocket from "ws";
import type { Blackboard } from "../blackboard/db.js";
import { normalizeCoralEvent } from "./events.js";
import { persistNormalizedCoralEvent } from "./persist.js";

export async function mirrorCoralEvents(input: {
  board: Blackboard;
  runId: string;
  baseWsUrl?: string;
  authKey: string;
  namespace: string;
  sessionId: string;
  minEvents?: number;
  timeoutMs?: number;
  afterOpen?: () => Promise<void> | void;
}) {
  const baseWsUrl = input.baseWsUrl ?? "ws://127.0.0.1:5555";
  const url = `${baseWsUrl}/ws/v1/events/${input.authKey}/session/${input.namespace}/${input.sessionId}`;
  const ws = new WebSocket(url);
  const events: unknown[] = [];

  return await new Promise<{ url: string; events: unknown[] }>((resolve, reject) => {
    let settled = false;
    let afterOpenDone = !input.afterOpen;
    let eventGoalMet = false;
    let timedOut = false;

    const finishIfReady = () => {
      if (settled || !afterOpenDone || (!eventGoalMet && !timedOut)) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();
      resolve({ url, events });
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      finishIfReady();
    }, input.timeoutMs ?? 10000);

    ws.on("message", (data) => {
      if (settled) return;
      const event = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      events.push(event);
      const normalized = normalizeCoralEvent(input.runId, input.sessionId, event);
      persistNormalizedCoralEvent(input.board, normalized);
      if (events.length >= (input.minEvents ?? 1)) {
        eventGoalMet = true;
        finishIfReady();
      }
    });
    ws.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    ws.on("open", () => {
      Promise.resolve(input.afterOpen?.())
        .then(() => {
          afterOpenDone = true;
          finishIfReady();
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          ws.close();
          reject(error);
        });
    });
    ws.on("close", () => {
      if (settled) return;
      timedOut = true;
      finishIfReady();
    });
  });
}
