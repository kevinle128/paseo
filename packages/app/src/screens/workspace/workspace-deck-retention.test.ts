import { describe, expect, it } from "vitest";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  getNextWorkspaceDeckExpirationDelay,
  orderWorkspaceSelectionsForStableRender,
  reconcileRetainedWorkspaceSelections,
  resolveWorkspaceDeckRetentionLimit,
  resolveWorkspaceDeckEntries,
  shouldKeepWorkspaceDeckEntryMounted,
  WORKSPACE_DECK_INACTIVE_TTL_MS,
  WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES,
  WORKSPACE_DECK_MAX_MOUNTED_GRID_CELLS,
  resolveGridCellsToMount,
} from "@/screens/workspace/workspace-deck-retention";

function workspace(workspaceId: string, serverId = "server"): ActiveWorkspaceSelection {
  return { serverId, workspaceId };
}

function mountedWorkspaceIds(selections: ActiveWorkspaceSelection[]): string[] {
  return selections.map((selection) => selection.workspaceId);
}

function retained(workspaceId: string, inactiveSince: number | null) {
  return { selection: workspace(workspaceId), inactiveSince };
}

function retainedWorkspaceIds(
  entries: ReturnType<typeof reconcileRetainedWorkspaceSelections>,
): string[] {
  return entries.map((entry) => entry.selection.workspaceId);
}

describe("reconcileRetainedWorkspaceSelections", () => {
  it("retains only the active workspace on native", () => {
    const entries = reconcileRetainedWorkspaceSelections({
      currentEntries: [retained("A", null)],
      activeSelection: workspace("B"),
      now: 2,
      maxMountedWorkspaces: resolveWorkspaceDeckRetentionLimit({ isNative: true }),
    });

    expect(retainedWorkspaceIds(entries)).toEqual(["B"]);
  });

  it("retains the desktop deck limit on web", () => {
    expect(resolveWorkspaceDeckRetentionLimit({ isNative: false })).toBe(
      WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES,
    );
  });

  it("retains inactive workspaces for ten minutes across app-wide routes", () => {
    const retainedEntries = [retained("A", 1_000), retained("B", 2_000)];

    expect(
      reconcileRetainedWorkspaceSelections({
        currentEntries: retainedEntries,
        activeSelection: null,
        now: 2_000 + WORKSPACE_DECK_INACTIVE_TTL_MS - 1,
      }),
    ).toEqual([retained("B", 2_000)]);
  });

  it("keeps the active workspace and nine most recently activated inactive workspaces", () => {
    let retainedEntries = Array.from(
      { length: WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES },
      (_, index) => retained(String(index + 1), index + 1),
    ).toReversed();

    retainedEntries = reconcileRetainedWorkspaceSelections({
      currentEntries: retainedEntries,
      activeSelection: workspace("11"),
      now: 11,
    });

    expect(retainedWorkspaceIds(retainedEntries)).toEqual([
      "11",
      "10",
      "9",
      "8",
      "7",
      "6",
      "5",
      "4",
      "3",
      "2",
    ]);
  });

  it("starts the TTL when the active workspace becomes inactive", () => {
    const retainedEntries = reconcileRetainedWorkspaceSelections({
      currentEntries: [retained("A", null), retained("B", 2_000)],
      activeSelection: workspace("B"),
      now: 3_000,
    });

    expect(retainedEntries).toEqual([retained("B", null), retained("A", 3_000)]);
  });

  it("never expires the active workspace", () => {
    const retainedEntries = reconcileRetainedWorkspaceSelections({
      currentEntries: [retained("A", 0)],
      activeSelection: workspace("A"),
      now: WORKSPACE_DECK_INACTIVE_TTL_MS,
    });

    expect(retainedEntries).toEqual([retained("A", null)]);
  });

  it("expires an inactive workspace at the TTL boundary", () => {
    const retainedEntries = reconcileRetainedWorkspaceSelections({
      currentEntries: [retained("B", null), retained("A", 0)],
      activeSelection: workspace("B"),
      now: WORKSPACE_DECK_INACTIVE_TTL_MS,
    });

    expect(retainedEntries).toEqual([retained("B", null)]);
  });

  it("deduplicates retained workspace selections", () => {
    const retainedEntries = reconcileRetainedWorkspaceSelections({
      currentEntries: [retained("B", 2), retained("A", 1), retained("B", 0)],
      activeSelection: workspace("A"),
      now: 3,
    });

    expect(retainedWorkspaceIds(retainedEntries)).toEqual(["A", "B"]);
  });
});

describe("getNextWorkspaceDeckExpirationDelay", () => {
  it("returns the remaining lifetime of the oldest inactive workspace", () => {
    expect(
      getNextWorkspaceDeckExpirationDelay({
        entries: [retained("C", null), retained("B", 2_000), retained("A", 1_000)],
        activeSelection: workspace("C"),
        now: 4_000,
      }),
    ).toBe(WORKSPACE_DECK_INACTIVE_TTL_MS - 3_000);
  });

  it("does not schedule expiration for the active workspace", () => {
    expect(
      getNextWorkspaceDeckExpirationDelay({
        entries: [retained("A", null)],
        activeSelection: workspace("A"),
        now: 4_000,
      }),
    ).toBeNull();
  });
});

describe("orderWorkspaceSelectionsForStableRender", () => {
  it("does not move retained native roots when the active LRU order changes", () => {
    const activeA = [workspace("A"), workspace("B")];
    const activeB = [workspace("B"), workspace("A")];

    expect(mountedWorkspaceIds(orderWorkspaceSelectionsForStableRender(activeA))).toEqual([
      "A",
      "B",
    ]);
    expect(mountedWorkspaceIds(orderWorkspaceSelectionsForStableRender(activeB))).toEqual([
      "A",
      "B",
    ]);
  });
});

describe("resolveWorkspaceDeckEntries", () => {
  it("keeps retained workspaces rendered but inactive on an app-wide route", () => {
    expect(
      resolveWorkspaceDeckEntries({
        selections: [workspace("A"), workspace("B")],
        activeSelection: null,
      }),
    ).toEqual([
      { selection: workspace("A"), active: false },
      { selection: workspace("B"), active: false },
    ]);
  });
});

describe("shouldKeepWorkspaceDeckEntryMounted", () => {
  it("keeps the active workspace mounted even when it is missing from hydrated workspaces", () => {
    expect(
      shouldKeepWorkspaceDeckEntryMounted({
        isActive: true,
        hasHydratedWorkspaces: true,
        workspaceExists: false,
      }),
    ).toBe(true);
  });

  it("keeps inactive workspaces mounted until workspace hydration finishes", () => {
    expect(
      shouldKeepWorkspaceDeckEntryMounted({
        isActive: false,
        hasHydratedWorkspaces: false,
        workspaceExists: false,
      }),
    ).toBe(true);
  });

  it("unmounts inactive workspaces that are gone after hydration", () => {
    expect(
      shouldKeepWorkspaceDeckEntryMounted({
        isActive: false,
        hasHydratedWorkspaces: true,
        workspaceExists: false,
      }),
    ).toBe(false);
  });

  it("keeps inactive workspaces that still exist after hydration", () => {
    expect(
      shouldKeepWorkspaceDeckEntryMounted({
        isActive: false,
        hasHydratedWorkspaces: true,
        workspaceExists: true,
      }),
    ).toBe(true);
  });
});

describe("reconcileRetainedWorkspaceSelections with pinned grid cells", () => {
  it("keeps pinned cells past the inactive TTL while the grid shows", () => {
    const entries = reconcileRetainedWorkspaceSelections({
      currentEntries: [retained("A", null), retained("P", 0)],
      activeSelection: workspace("A"),
      pinnedSelections: [workspace("A"), workspace("P")],
      now: WORKSPACE_DECK_INACTIVE_TTL_MS * 3,
    });

    expect(entries).toEqual([retained("A", null), retained("P", null)]);
  });

  it("adds pinned cells the user never opened", () => {
    const entries = reconcileRetainedWorkspaceSelections({
      currentEntries: [retained("A", null)],
      activeSelection: workspace("A"),
      pinnedSelections: [workspace("A"), workspace("N1"), workspace("N2")],
      now: 5,
    });

    expect(retainedWorkspaceIds(entries)).toEqual(["A", "N1", "N2"]);
  });

  it("does not cap pinned cells at the single-mode limit", () => {
    const pinned = Array.from({ length: 12 }, (_, index) => workspace(`P${index}`));
    const entries = reconcileRetainedWorkspaceSelections({
      currentEntries: [],
      activeSelection: pinned[0] ?? null,
      pinnedSelections: pinned,
      now: 5,
    });

    expect(entries).toHaveLength(12);
  });

  it("drops a cell that is unpinned once its TTL passes", () => {
    const grid = reconcileRetainedWorkspaceSelections({
      currentEntries: [retained("A", null)],
      activeSelection: workspace("A"),
      pinnedSelections: [workspace("A"), workspace("P")],
      now: 0,
    });
    const afterUnpin = reconcileRetainedWorkspaceSelections({
      currentEntries: grid,
      activeSelection: workspace("A"),
      pinnedSelections: [workspace("A")],
      now: 10,
    });
    expect(retainedWorkspaceIds(afterUnpin)).toEqual(["A", "P"]);
    expect(afterUnpin[1]?.inactiveSince).toBe(10);

    const expired = reconcileRetainedWorkspaceSelections({
      currentEntries: afterUnpin,
      activeSelection: workspace("A"),
      pinnedSelections: [workspace("A")],
      now: 10 + WORKSPACE_DECK_INACTIVE_TTL_MS,
    });
    expect(retainedWorkspaceIds(expired)).toEqual(["A"]);
  });

  it("keeps all 12 entries in the reconcile that closes the grid, then lets the TTL remove extras", () => {
    const pinned = Array.from({ length: 12 }, (_, index) => workspace(`P${index}`));
    const gridEntries = reconcileRetainedWorkspaceSelections({
      currentEntries: [],
      activeSelection: pinned[0] ?? null,
      pinnedSelections: pinned,
      now: 0,
    });

    const afterClose = reconcileRetainedWorkspaceSelections({
      currentEntries: gridEntries,
      activeSelection: pinned[0] ?? null,
      now: 100,
    });
    expect(afterClose).toHaveLength(12);

    const afterOtherSwitch = reconcileRetainedWorkspaceSelections({
      currentEntries: afterClose,
      activeSelection: pinned[1] ?? null,
      now: 200,
    });
    expect(afterOtherSwitch).toHaveLength(12);

    const afterTtl = reconcileRetainedWorkspaceSelections({
      currentEntries: afterOtherSwitch,
      activeSelection: pinned[1] ?? null,
      now: 100 + WORKSPACE_DECK_INACTIVE_TTL_MS,
    });
    expect(retainedWorkspaceIds(afterTtl)).toEqual(["P1", "P0"]);
  });

  it("does not drop unpinned retained entries when the grid opens", () => {
    const entries = reconcileRetainedWorkspaceSelections({
      currentEntries: [retained("A", null), retained("U", 1)],
      activeSelection: workspace("A"),
      pinnedSelections: Array.from({ length: 12 }, (_, index) =>
        index === 0 ? workspace("A") : workspace(`P${index}`),
      ),
      now: 2,
    });

    expect(retainedWorkspaceIds(entries)).toContain("U");
  });
});

describe("grid cell cap", () => {
  const cells = Array.from({ length: 16 }, (_, index) => workspace(`P${index}`));
  const key = (id: string) => `server:${id}`;

  function states(
    entries: Record<string, { presence: "focused" | "reduced" | "hidden"; distancePx: number }>,
  ) {
    return new Map(Object.entries(entries).map(([id, value]) => [key(id), value]));
  }

  it("mounts every cell while they fit under the cap", () => {
    const mounted = resolveGridCellsToMount({
      cells: cells.slice(0, 12),
      cellStates: states({}),
      maxMountedCells: WORKSPACE_DECK_MAX_MOUNTED_GRID_CELLS,
    });
    expect(mountedWorkspaceIds(mounted)).toHaveLength(12);
  });

  it("evicts hidden cells farthest from the viewport first", () => {
    const hidden = Object.fromEntries(
      cells
        .slice(8)
        .map((cell, index) => [
          cell.workspaceId,
          { presence: "hidden" as const, distancePx: (index + 1) * 100 },
        ]),
    );
    const mounted = resolveGridCellsToMount({
      cells,
      cellStates: states({
        ...Object.fromEntries(
          cells
            .slice(0, 8)
            .map((cell) => [cell.workspaceId, { presence: "reduced", distancePx: 0 }]),
        ),
        ...hidden,
      }),
      maxMountedCells: 12,
    });
    expect(mountedWorkspaceIds(mounted)).toEqual([
      ...cells.slice(0, 8).map((cell) => cell.workspaceId),
      "P8",
      "P9",
      "P10",
      "P11",
    ]);
  });

  it("never evicts focused or reduced cells, so the cap is soft on screen", () => {
    const onScreen = Object.fromEntries(
      cells.map((cell, index) => [
        cell.workspaceId,
        { presence: index === 0 ? ("focused" as const) : ("reduced" as const), distancePx: 0 },
      ]),
    );
    const mounted = resolveGridCellsToMount({
      cells,
      cellStates: states(onScreen),
      maxMountedCells: 12,
    });
    expect(mounted).toHaveLength(16);
  });

  it("evicts only as many hidden cells as the cap requires", () => {
    const mixed = Object.fromEntries(
      cells.map((cell, index) => [
        cell.workspaceId,
        index < 10
          ? { presence: "reduced" as const, distancePx: 0 }
          : { presence: "hidden" as const, distancePx: index * 10 },
      ]),
    );
    const mounted = resolveGridCellsToMount({
      cells,
      cellStates: states(mixed),
      maxMountedCells: 12,
    });
    expect(mountedWorkspaceIds(mounted)).toEqual([
      ...cells.slice(0, 10).map((cell) => cell.workspaceId),
      "P10",
      "P11",
    ]);
  });

  it("drops an evicted cell from the retained entries and keeps the rest", () => {
    const entries = reconcileRetainedWorkspaceSelections({
      currentEntries: cells.map((cell) => ({ selection: cell, inactiveSince: null })),
      activeSelection: cells[0],
      pinnedSelections: cells,
      gridCellStates: states(
        Object.fromEntries(
          cells.map((cell, index) => [
            cell.workspaceId,
            index < 4
              ? { presence: "reduced" as const, distancePx: 0 }
              : { presence: "hidden" as const, distancePx: index },
          ]),
        ),
      ),
      now: 1,
    });
    expect(retainedWorkspaceIds(entries)).toEqual(
      cells.slice(0, 12).map((cell) => cell.workspaceId),
    );
  });
});
