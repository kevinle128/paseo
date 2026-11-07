import type { Page } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";

export interface RecordedAgentRequests {
  modeRequests(agentId: string): string[];
  cancelRequests(agentId: string): number;
  sendRequests(agentId: string): number;
}

function sessionMessage(message: string | Buffer): Record<string, unknown> | null {
  try {
    const envelope = JSON.parse(typeof message === "string" ? message : message.toString("utf8"));
    if (envelope?.type !== "session" || typeof envelope.message !== "object") return null;
    return envelope.message as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Shift+Tab and Escape reach the daemon as these two requests, keyed by agent. They are the
// observable proof of which cell's agent a shortcut acted on.
export async function recordAgentRequests(page: Page): Promise<RecordedAgentRequests> {
  const modes: Array<{ agentId: string; modeId: string }> = [];
  const cancels: string[] = [];
  const sends: string[] = [];
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const parsed = sessionMessage(message);
      const agentId = typeof parsed?.agentId === "string" ? parsed.agentId : "";
      if (parsed?.type === "set_agent_mode_request") {
        modes.push({ agentId, modeId: typeof parsed.modeId === "string" ? parsed.modeId : "" });
      } else if (parsed?.type === "cancel_agent_request") {
        cancels.push(agentId);
      } else if (parsed?.type === "send_agent_message_request") {
        sends.push(agentId);
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
  return {
    modeRequests: (agentId) =>
      modes.filter((entry) => entry.agentId === agentId).map((entry) => entry.modeId),
    cancelRequests: (agentId) => cancels.filter((id) => id === agentId).length,
    sendRequests: (agentId) => sends.filter((id) => id === agentId).length,
  };
}
