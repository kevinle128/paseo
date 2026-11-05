/**
 * @vitest-environment jsdom
 */
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import {
  createWorkspaceLayoutStore,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { selectCellAgentIds, useCellTimelineSuspension } from "./use-cell-timeline-suspension";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sourceId = "server-1:workspace-a";

function createStore() {
  const store = createWorkspaceLayoutStore();
  store.setState({ layoutByWorkspace: {}, sheetsByWorkspace: {} });
  return store;
}

describe("selectCellAgentIds", () => {
  it("lists the chats open in the pane layout, sorted", () => {
    const store = createStore();
    store.getState().openTab({
      workspaceKey: sourceId,
      target: { kind: "agent", agentId: "b" },
      intent: "reveal",
    });
    store.getState().openTab({
      workspaceKey: sourceId,
      target: { kind: "agent", agentId: "a" },
      intent: "reveal",
    });

    expect(selectCellAgentIds(store.getState(), sourceId)).toEqual(["a", "b"]);
  });

  it("includes a chat open only in a sheet tab", () => {
    const store = createStore();
    store.getState().setLayoutMode("compact");
    store.getState().openTab({
      workspaceKey: sourceId,
      target: { kind: "terminal", terminalId: "term-1" },
      intent: "reveal",
    });
    // A file opens in a sheet in compact mode; swap its target for a subagent chat, which is the
    // kind of chat the sheet holds.
    store.getState().openTab({
      workspaceKey: sourceId,
      target: { kind: "file", path: "src/index.ts" },
      intent: "reveal",
    });
    const sheets = store.getState().sheetsByWorkspace[sourceId] ?? [];
    expect(sheets).toHaveLength(1);
    const [sheet] = sheets;
    store.setState({
      sheetsByWorkspace: {
        [sourceId]: [
          {
            policy: sheet.policy,
            parentTabId: sheet.parentTabId,
            tab: { ...sheet.tab, target: { kind: "agent", agentId: "sheet-chat" } },
          },
        ],
      },
    });

    expect(selectCellAgentIds(store.getState(), sourceId)).toEqual(["sheet-chat"]);
  });

  it("ignores other workspaces and returns a stable empty list", () => {
    const store = createStore();
    store.getState().openTab({
      workspaceKey: "server-1:workspace-b",
      target: { kind: "agent", agentId: "elsewhere" },
      intent: "reveal",
    });

    const first = selectCellAgentIds(store.getState(), sourceId);
    expect(first).toEqual([]);
    expect(selectCellAgentIds(store.getState(), sourceId)).toBe(first);
  });
});

describe("useCellTimelineSuspension", () => {
  const SERVER_ID = "server-1";
  const WORKSPACE_ID = "workspace-a";
  let container: HTMLDivElement;
  let root: Root;
  let calls: string[];

  function Probe({ suspended }: { suspended: boolean }) {
    useCellTimelineSuspension({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID, suspended });
    return null;
  }

  function render(suspended: boolean) {
    act(() => root.render(<Probe suspended={suspended} />));
  }

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
  });

  afterEach(() => {
    act(() => root.unmount());
    useSessionStore.getState().clearSession(SERVER_ID);
  });

  it("hands the chats of a suspended cell to the timeline sync", () => {
    const key = buildWorkspaceTabPersistenceKey({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID });
    expect(key).toBe(sourceId);
    act(() => {
      useWorkspaceLayoutStore.getState().openTab({
        workspaceKey: sourceId,
        target: { kind: "agent", agentId: "chat-1" },
        intent: "reveal",
      });
    });

    render(true);

    expect(calls).toEqual([`suspend ${sourceId} chat-1`]);
  });

  it("resumes the cell when it is no longer suspended", () => {
    render(true);
    calls.length = 0;

    render(false);

    expect(calls).toEqual([`resume ${sourceId}`]);
  });

  it("follows chats opened while the cell stays suspended", () => {
    render(true);
    calls.length = 0;

    act(() => {
      useWorkspaceLayoutStore.getState().openTab({
        workspaceKey: sourceId,
        target: { kind: "agent", agentId: "chat-2" },
        intent: "reveal",
      });
    });

    expect(calls).toEqual([`suspend ${sourceId} chat-2`]);
  });
});
