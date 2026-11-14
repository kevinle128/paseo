import { describe, expect, it } from "vitest";
import { hasVisibleOrderChanged, mergeWithRemainder } from "@/utils/sidebar-reorder";
import {
  buildPinnedOrderSeed,
  orderPinnedWorkspaceKeys,
  resolvePinnedOrderPrune,
  resolvePinnedOrderRule,
  shouldSeedPinnedOrder,
} from "./pinned-order";

describe("orderPinnedWorkspaceKeys with the recency rule", () => {
  const rule = "recency" as const;

  it("orders by most recently pinned first when there is no stored order", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: {
          a: "2026-01-01T00:00:00Z",
          b: "2026-03-01T00:00:00Z",
          c: "2026-02-01T00:00:00Z",
        },
        storedOrder: [],
        rule,
      }),
    ).toEqual(["b", "c", "a"]);
  });

  it("lets the stored user order win over recency", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: { a: "2026-01-01T00:00:00Z", b: "2026-02-01T00:00:00Z" },
        storedOrder: ["a", "b"],
        rule,
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
        storedOrder: ["older", "newer"],
        rule,
      }),
    ).toEqual(["fresh", "older", "newer"]);
  });

  it("ignores stored keys that are no longer pinned", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: { a: "2026-01-01T00:00:00Z" },
        storedOrder: ["gone", "a"],
        rule,
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
        storedOrder: [],
        rule,
      }),
    ).toEqual(["host-1:w2", "host-2:w1", "host-1:w1"]);
  });

  it("returns an empty list when nothing is pinned", () => {
    expect(orderPinnedWorkspaceKeys({ pinnedAtByKey: {}, storedOrder: ["a"], rule })).toEqual([]);
  });
});

describe("recency rule ties", () => {
  it("breaks equal pin times by key ascending, whatever the input order", () => {
    const at = "2026-01-01T00:00:00Z";
    const forward = { a: at, b: at, c: at };
    const reversed = { c: at, b: at, a: at };
    const expected = ["a", "b", "c"];
    for (const pinnedAtByKey of [forward, reversed]) {
      expect(orderPinnedWorkspaceKeys({ pinnedAtByKey, storedOrder: [], rule: "recency" })).toEqual(
        expected,
      );
      expect(buildPinnedOrderSeed({ pinnedAtByKey, storedOrder: [] })).toEqual(expected);
    }
  });
});

describe("orderPinnedWorkspaceKeys with the new-first rule", () => {
  const rule = "new-first" as const;

  it("orders by pin time descending when there is no stored order", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: {
          a: "2026-01-01T00:00:00Z",
          b: "2026-03-01T00:00:00Z",
          c: "2026-02-01T00:00:00Z",
        },
        storedOrder: [],
        rule,
      }),
    ).toEqual(["b", "c", "a"]);
  });

  it("puts a new pin before the stored keys", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: {
          a: "2026-01-01T00:00:00Z",
          b: "2026-02-01T00:00:00Z",
          c: "2026-03-01T00:00:00Z",
        },
        storedOrder: ["b", "a"],
        rule,
      }),
    ).toEqual(["c", "b", "a"]);
  });

  it("keeps the stored order even when a stored key is newer than an unstored one", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: {
          a: "2026-01-01T00:00:00Z",
          b: "2026-02-01T00:00:00Z",
          c: "2026-03-01T00:00:00Z",
        },
        storedOrder: ["a", "c"],
        rule,
      }),
    ).toEqual(["b", "a", "c"]);
  });

  it("lists several unstored pins newest first", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: {
          a: "2026-01-01T00:00:00Z",
          b: "2026-02-01T00:00:00Z",
          c: "2026-03-01T00:00:00Z",
        },
        storedOrder: ["a"],
        rule,
      }),
    ).toEqual(["c", "b", "a"]);
  });

  it("ignores stored keys that are not pinned", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: { a: "2026-01-01T00:00:00Z" },
        storedOrder: ["gone", "a"],
        rule,
      }),
    ).toEqual(["a"]);
  });

  it("breaks pin time ties by key", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: { b: "2026-01-01T00:00:00Z", a: "2026-01-01T00:00:00Z" },
        storedOrder: [],
        rule,
      }),
    ).toEqual(["a", "b"]);
  });

  it("mixes keys from several hosts", () => {
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: {
          "host-1:w1": "2026-01-01T00:00:00Z",
          "host-2:w1": "2026-02-01T00:00:00Z",
          "host-1:w2": "2026-03-01T00:00:00Z",
        },
        storedOrder: ["host-2:w1"],
        rule,
      }),
    ).toEqual(["host-1:w2", "host-1:w1", "host-2:w1"]);
  });
});

// A reorder writes through mergeWithRemainder, as the sidebar Pinned section and the grid do.
// The written order must be the order the user saw, or an unstored pin would move on the first
// unrelated drag.
describe("reordering keeps a new pin where it shows", () => {
  const pinnedAtByKey = {
    a: "2026-01-01T00:00:00Z",
    b: "2026-02-01T00:00:00Z",
    n: "2026-03-01T00:00:00Z",
  };

  function drag(storedOrder: string[], reorderedVisibleKeys: string[]): string[] {
    const merge = { currentOrder: storedOrder, reorderedVisibleKeys };
    return hasVisibleOrderChanged(merge) ? mergeWithRemainder(merge) : storedOrder;
  }

  for (const rule of ["new-first", "recency"] as const) {
    it(`keeps the new pin first after the user swaps two other rows (${rule})`, () => {
      const storedOrder = ["b", "a"];
      const shown = orderPinnedWorkspaceKeys({ pinnedAtByKey, storedOrder, rule });
      expect(shown).toEqual(["n", "b", "a"]);

      const nextStored = drag(storedOrder, ["n", "a", "b"]);
      expect(orderPinnedWorkspaceKeys({ pinnedAtByKey, storedOrder: nextStored, rule })).toEqual([
        "n",
        "a",
        "b",
      ]);
    });
  }

  it("keeps a filtered-out new pin first after a drag of the visible rows", () => {
    const nextStored = drag(["b", "a"], ["a", "b"]);
    expect(nextStored).toEqual(["a", "b"]);
    expect(
      orderPinnedWorkspaceKeys({ pinnedAtByKey, storedOrder: nextStored, rule: "new-first" }),
    ).toEqual(["n", "a", "b"]);
  });
});

describe("resolvePinnedOrderRule", () => {
  it("uses new-first only on web once seeded", () => {
    expect(resolvePinnedOrderRule({ isWeb: true, seeded: true })).toBe("new-first");
    expect(resolvePinnedOrderRule({ isWeb: true, seeded: false })).toBe("recency");
    expect(resolvePinnedOrderRule({ isWeb: false, seeded: true })).toBe("recency");
    expect(resolvePinnedOrderRule({ isWeb: false, seeded: false })).toBe("recency");
  });

  it("keeps today's native result: a new pin goes first", () => {
    const rule = resolvePinnedOrderRule({ isWeb: false, seeded: true });
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: {
          a: "2026-01-01T00:00:00Z",
          b: "2026-02-01T00:00:00Z",
          c: "2026-03-01T00:00:00Z",
        },
        storedOrder: ["b", "a"],
        rule,
      }),
    ).toEqual(["c", "b", "a"]);
  });
});

describe("shouldSeedPinnedOrder", () => {
  it("seeds when every registered host has a loaded directory and the flag is unset", () => {
    expect(
      shouldSeedPinnedOrder({ seeded: false, serverIds: ["a", "b"], loadedServerIds: ["a", "b"] }),
    ).toBe(true);
  });

  it("blocks while a registered host has no loaded directory", () => {
    expect(
      shouldSeedPinnedOrder({ seeded: false, serverIds: ["a", "b"], loadedServerIds: ["a"] }),
    ).toBe(false);
  });

  it("does not seed twice", () => {
    expect(shouldSeedPinnedOrder({ seeded: true, serverIds: ["a"], loadedServerIds: ["a"] })).toBe(
      false,
    );
  });

  it("waits while no host is registered", () => {
    expect(shouldSeedPinnedOrder({ seeded: false, serverIds: [], loadedServerIds: [] })).toBe(
      false,
    );
  });
});

describe("buildPinnedOrderSeed", () => {
  it("equals today's order for the known pins", () => {
    const pinnedAtByKey = {
      older: "2026-01-01T00:00:00Z",
      newer: "2026-02-01T00:00:00Z",
      fresh: "2026-03-01T00:00:00Z",
    };
    const storedOrder = ["older", "newer"];
    expect(buildPinnedOrderSeed({ pinnedAtByKey, storedOrder })).toEqual(
      orderPinnedWorkspaceKeys({ pinnedAtByKey, storedOrder, rule: "recency" }),
    );
  });

  it("keeps stored keys of an unloaded host after the known pins", () => {
    expect(
      buildPinnedOrderSeed({
        pinnedAtByKey: { "h1:a": "2026-01-01T00:00:00Z" },
        storedOrder: ["h2:x", "h1:a", "h2:y"],
      }),
    ).toEqual(["h1:a", "h2:x", "h2:y"]);
  });
});

describe("resolvePinnedOrderPrune", () => {
  it("prunes only keys whose workspace exists and is unpinned", () => {
    expect(
      resolvePinnedOrderPrune({
        storedOrder: ["unpinned", "absent", "pinned"],
        workspacePinnedAtByKey: { unpinned: null, pinned: "2026-01-01T00:00:00Z" },
      }),
    ).toEqual(["unpinned"]);
  });

  it("returns null when nothing is prunable", () => {
    expect(
      resolvePinnedOrderPrune({
        storedOrder: ["absent", "pinned"],
        workspacePinnedAtByKey: { pinned: "2026-01-01T00:00:00Z" },
      }),
    ).toBeNull();
  });
});
