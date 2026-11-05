/**
 * @vitest-environment jsdom
 */
import { act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { DormantCellSummary } from "./dormant-cell-summary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SERVER_ID = "server-1";
const WORKSPACE_ID = "workspace-a";
const SOURCE_ID = `${SERVER_ID}:${WORKSPACE_ID}`;
const RECT = { x: 0, y: 0, width: 100, height: 100 };
const focusCell = () => true;

describe("DormantCellSummary", () => {
  let container: HTMLDivElement;
  let root: Root;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    container = document.createElement("div");
    root = createRoot(container);
    useSessionStore.getState().initializeSession(SERVER_ID, null as never);
    useSessionStore.getState().setViewedTimelineSync(SERVER_ID, {
      suspendSource: (id: string, agentIds: string[]) => calls.push(`suspend ${id} ${agentIds}`),
      resumeSource: (id: string) => calls.push(`resume ${id}`),
    } as never);
    useWorkspaceLayoutStore.setState({ layoutByWorkspace: {}, sheetsByWorkspace: {} });
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey: SOURCE_ID,
      target: { kind: "agent", agentId: "chat-1" },
      intent: "reveal",
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    useSessionStore.getState().clearSession(SERVER_ID);
  });

  it("releases the chats of a pinned cell that has no mounted workspace", () => {
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <DormantCellSummary
            serverId={SERVER_ID}
            workspaceId={WORKSPACE_ID}
            rect={RECT}
            onFocusCell={focusCell}
          />
        </QueryClientProvider>,
      );
    });

    expect(calls).toEqual([`suspend ${SOURCE_ID} chat-1`]);
  });
});
