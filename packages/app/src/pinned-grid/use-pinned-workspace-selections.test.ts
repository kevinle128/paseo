/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { SessionState } from "@/stores/session-store";
import {
  selectPinnedEntries,
  useHasPinnedWorkspace,
  usePinnedWorkspaceSelections,
} from "./use-pinned-workspace-selections";

function workspace(id: string, pinnedAt: string | null): WorkspaceDescriptor {
  return { id, pinnedAt } as unknown as WorkspaceDescriptor;
}

function session(workspaces: WorkspaceDescriptor[], extra = 0): SessionState {
  // Only the fields the selector reads; the rest of the session is irrelevant here.
  return {
    workspaces: new Map(workspaces.map((entry) => [entry.id, entry])),
    extra,
  } as unknown as SessionState;
}

function setSessions(sessions: Record<string, SessionState>) {
  useSessionStore.setState({ sessions });
}

describe("pinned workspace selections", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: {} });
  });

  it("lists pinned workspaces across hosts, most recent first, and ignores unpinned ones", () => {
    setSessions({
      "host-a": session([workspace("a1", "2026-01-01"), workspace("a2", null)]),
      "host-b": session([workspace("b1", "2026-01-02")]),
    });

    const { result } = renderHook(() => usePinnedWorkspaceSelections());

    expect(result.current).toEqual([
      { serverId: "host-b", workspaceId: "b1" },
      { serverId: "host-a", workspaceId: "a1" },
    ]);
  });

  it("keeps the same result when an unrelated session field changes", () => {
    const hostA = session([workspace("a1", "2026-01-01")]);
    setSessions({ "host-a": hostA });
    const { result } = renderHook(() => usePinnedWorkspaceSelections());
    const before = result.current;

    act(() => {
      setSessions({ "host-a": { ...hostA, extra: 1 } as unknown as SessionState });
    });

    expect(result.current).toBe(before);
  });

  it("does not rescan a workspaces map that did not change", () => {
    const hostA = session([workspace("a1", "2026-01-01")]);
    const first = selectPinnedEntries({ "host-a": hostA });
    const second = selectPinnedEntries({ "host-a": { ...hostA } });

    expect(second).toBe(first);
  });

  it("reports presence only when enabled", () => {
    setSessions({ "host-a": session([workspace("a1", "2026-01-01")]) });

    expect(renderHook(() => useHasPinnedWorkspace(true)).result.current).toBe(true);
    expect(renderHook(() => useHasPinnedWorkspace(false)).result.current).toBe(false);
  });
});
