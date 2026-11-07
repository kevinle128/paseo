import { describe, expect, it } from "vitest";
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

describe("orderPinnedWorkspaceKeys with the append rule", () => {
  const rule = "append" as const;

  it("orders by pin time ascending when there is no stored order", () => {
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
    ).toEqual(["a", "c", "b"]);
  });

  it("puts a new pin after the stored keys", () => {
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
    ).toEqual(["b", "a", "c"]);
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
    ).toEqual(["host-2:w1", "host-1:w1", "host-1:w2"]);
  });
});

describe("resolvePinnedOrderRule", () => {
  it("uses append only on web once seeded", () => {
    expect(resolvePinnedOrderRule({ isWeb: true, seeded: true })).toBe("append");
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
  it("seeds only when every registered host is hydrated and the flag is unset", () => {
    expect(
      shouldSeedPinnedOrder({
        seeded: false,
        serverIds: ["a", "b"],
        hydratedServerIds: ["a", "b"],
      }),
    ).toBe(true);
    expect(
      shouldSeedPinnedOrder({ seeded: false, serverIds: ["a", "b"], hydratedServerIds: ["a"] }),
    ).toBe(false);
    expect(
      shouldSeedPinnedOrder({ seeded: true, serverIds: ["a"], hydratedServerIds: ["a"] }),
    ).toBe(false);
  });

  it("waits while no host is registered", () => {
    expect(shouldSeedPinnedOrder({ seeded: false, serverIds: [], hydratedServerIds: [] })).toBe(
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
