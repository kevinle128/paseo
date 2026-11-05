import { describe, expect, it } from "vitest";
import { orderPinnedWorkspaceKeys } from "./pinned-order";

describe("orderPinnedWorkspaceKeys", () => {
  it("orders by most recently pinned first when there is no stored order", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: {
          a: "2026-01-01T00:00:00Z",
          b: "2026-03-01T00:00:00Z",
          c: "2026-02-01T00:00:00Z",
        },
        pinnedWorkspaceOrder: [],
      }),
    ).toEqual(["b", "c", "a"]);
  });

  it("lets the stored user order win over recency", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: {
          a: "2026-01-01T00:00:00Z",
          b: "2026-02-01T00:00:00Z",
        },
        pinnedWorkspaceOrder: ["a", "b"],
      }),
    ).toEqual(["a", "b"]);
  });

  it("keeps a workspace without a stored position in its recency slot", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: {
          older: "2026-01-01T00:00:00Z",
          newer: "2026-02-01T00:00:00Z",
          fresh: "2026-03-01T00:00:00Z",
        },
        pinnedWorkspaceOrder: ["older", "newer"],
      }),
    ).toEqual(["fresh", "older", "newer"]);
  });

  it("ignores stored keys that are no longer pinned", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: { a: "2026-01-01T00:00:00Z" },
        pinnedWorkspaceOrder: ["gone", "a"],
      }),
    ).toEqual(["a"]);
  });

  it("mixes keys from several hosts", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: {
          "host-1:w1": "2026-01-01T00:00:00Z",
          "host-2:w1": "2026-02-01T00:00:00Z",
          "host-1:w2": "2026-03-01T00:00:00Z",
        },
        pinnedWorkspaceOrder: [],
      }),
    ).toEqual(["host-1:w2", "host-2:w1", "host-1:w1"]);
  });

  it("returns an empty list when nothing is pinned", () => {
    expect(orderPinnedWorkspaceKeys({ pinnedAtByKey: {}, pinnedWorkspaceOrder: ["a"] })).toEqual(
      [],
    );
  });
});
