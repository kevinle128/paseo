import { describe, expect, it } from "vitest";
import {
  areDormantCellStatesEqual,
  deriveDormantCellState,
  resolveDormantCells,
  type DormantCellAgent,
} from "./dormant-cell-state";

function agent(overrides: Partial<DormantCellAgent> & { id: string }): DormantCellAgent {
  return { status: "idle", workspaceId: "ws", pendingPermissionCount: 0, ...overrides };
}

describe("deriveDormantCellState", () => {
  it("is done without agents", () => {
    expect(deriveDormantCellState([], "ws")).toEqual({ bucket: "done", attentionAgentId: null });
  });

  it("reads needs_input from a pending permission on any agent and targets that agent", () => {
    const state = deriveDormantCellState(
      [
        agent({ id: "a", status: "running" }),
        agent({ id: "b", pendingPermissionCount: 1 }),
        agent({ id: "c", pendingPermissionCount: 2 }),
      ],
      "ws",
    );
    expect(state).toEqual({ bucket: "needs_input", attentionAgentId: "b" });
  });

  it("reads the permission attention reason as needs_input", () => {
    const state = deriveDormantCellState(
      [agent({ id: "a", attentionReason: "permission", requiresAttention: true })],
      "ws",
    );
    expect(state.bucket).toBe("needs_input");
    expect(state.attentionAgentId).toBe("a");
  });

  it("ranks failed over running over attention over done", () => {
    expect(
      deriveDormantCellState(
        [
          agent({ id: "a", status: "running" }),
          agent({
            id: "b",
            status: "error",
            requiresAttention: true,
            attentionReason: "error",
          }),
        ],
        "ws",
      ).bucket,
    ).toBe("failed");
    expect(
      deriveDormantCellState(
        [agent({ id: "a", requiresAttention: true }), agent({ id: "b", status: "running" })],
        "ws",
      ).bucket,
    ).toBe("running");
    expect(deriveDormantCellState([agent({ id: "a", requiresAttention: true })], "ws").bucket).toBe(
      "attention",
    );
  });

  it("stops reading an error as failed once the user has seen it", () => {
    expect(deriveDormantCellState([agent({ id: "a", status: "error" })], "ws").bucket).toBe("done");
  });

  it("counts background work as running", () => {
    expect(
      deriveDormantCellState([agent({ id: "a", backgroundWork: { count: 1 } })], "ws").bucket,
    ).toBe("running");
  });

  it("counts an open turn as running", () => {
    expect(deriveDormantCellState([agent({ id: "a", turnOpen: true })], "ws").bucket).toBe(
      "running",
    );
  });

  it("ignores archived agents and agents of other workspaces", () => {
    const state = deriveDormantCellState(
      [
        agent({ id: "a", pendingPermissionCount: 1, archivedAt: new Date(0) }),
        agent({ id: "b", pendingPermissionCount: 1, workspaceId: "other" }),
      ],
      "ws",
    );
    expect(state).toEqual({ bucket: "done", attentionAgentId: null });
  });

  it("compares states by value", () => {
    expect(
      areDormantCellStatesEqual(
        { bucket: "running", attentionAgentId: null },
        { bucket: "running", attentionAgentId: null },
      ),
    ).toBe(true);
    expect(
      areDormantCellStatesEqual(
        { bucket: "needs_input", attentionAgentId: "a" },
        { bucket: "needs_input", attentionAgentId: "b" },
      ),
    ).toBe(false);
  });
});

describe("resolveDormantCells", () => {
  const cells = [
    { serverId: "s", workspaceId: "a" },
    { serverId: "s", workspaceId: "b" },
    { serverId: "s", workspaceId: "c" },
  ];
  const cellRects = new Map([
    ["s:a", 1],
    ["s:b", 2],
    ["s:c", 3],
  ]);

  it("lists the cells that are not mounted", () => {
    expect(
      resolveDormantCells({
        cells,
        mountedKeys: new Set(["s:a"]),
        cellRects,
      }),
    ).toEqual([
      { serverId: "s", workspaceId: "b", rect: 2 },
      { serverId: "s", workspaceId: "c", rect: 3 },
    ]);
  });

  it("lists nothing without a grid", () => {
    expect(resolveDormantCells({ mountedKeys: new Set<string>(), cellRects, cells: null })).toEqual(
      [],
    );
  });
});
