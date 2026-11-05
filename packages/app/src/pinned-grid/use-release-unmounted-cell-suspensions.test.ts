/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
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

import { useSessionStore, type SessionState } from "@/stores/session-store";
import {
  selectReleasedCells,
  selectUnmountedCells,
  useReleaseUnmountedCellSuspensions,
} from "./use-release-unmounted-cell-suspensions";

const a = { serverId: "s", workspaceId: "a" };
const b = { serverId: "s", workspaceId: "b" };

describe("unmounted cell selection", () => {
  it("lists the grid cells without a mounted workspace", () => {
    expect(selectUnmountedCells([a, b], new Set(["s:a"]))).toEqual([b]);
    expect(selectUnmountedCells(null, new Set())).toEqual([]);
  });

  it("releases a cell that left the grid but not one that mounted", () => {
    expect(selectReleasedCells([a, b], [], new Set(["s:b"]))).toEqual([a]);
    expect(selectReleasedCells([a], [a], new Set())).toEqual([]);
  });
});

describe("useReleaseUnmountedCellSuspensions", () => {
  const resumeSource = vi.fn<(id: string) => void>();

  beforeEach(() => {
    resumeSource.mockReset();
    useSessionStore.setState({
      sessions: { s: { viewedTimelineSync: { resumeSource } } as unknown as SessionState },
    });
  });

  function renderRelease(unmountedCells: (typeof a)[], mounted: string[] = []) {
    return renderHook(
      (props: { cells: (typeof a)[]; mounted: ReadonlySet<string> }) =>
        useReleaseUnmountedCellSuspensions({
          unmountedCells: props.cells,
          mountedKeys: props.mounted,
        }),
      { initialProps: { cells: unmountedCells, mounted: new Set(mounted) } },
    );
  }

  it("keeps an unmounted cell suspended while it stays in the grid", () => {
    const view = renderRelease([a]);
    view.rerender({ cells: [a], mounted: new Set() });

    expect(resumeSource).not.toHaveBeenCalled();
  });

  it("resumes a cell that was unpinned or evicted from the grid while unmounted", () => {
    const view = renderRelease([a, b]);

    view.rerender({ cells: [b], mounted: new Set() });

    expect(resumeSource).toHaveBeenCalledTimes(1);
    expect(resumeSource).toHaveBeenCalledWith("s:a");
  });

  it("leaves a cell that mounted again to its own workspace", () => {
    const view = renderRelease([a]);

    view.rerender({ cells: [], mounted: new Set(["s:a"]) });

    expect(resumeSource).not.toHaveBeenCalled();
  });

  it("resumes every held cell when the grid goes away", () => {
    const view = renderRelease([a, b]);

    view.unmount();

    expect(resumeSource.mock.calls.map(([id]) => id).sort()).toEqual(["s:a", "s:b"]);
  });
});
