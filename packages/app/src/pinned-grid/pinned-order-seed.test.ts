import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ isWeb: true }));
vi.mock("@/constants/platform", () => ({
  get isWeb() {
    return platform.isWeb;
  },
}));

import { usePinnedOrderSeedStore } from "@/stores/pinned-order-seed-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import {
  prunePinnedOrder,
  removePinnedOrderKey,
  seedPinnedWorkspaceOrder,
} from "./pinned-order-seed";
import { orderPinnedWorkspaceKeys } from "./pinned-order";

const PINNED_AT = {
  older: "2026-01-01T00:00:00Z",
  newer: "2026-02-01T00:00:00Z",
  fresh: "2026-03-01T00:00:00Z",
};

const ALL_LIVE = { serverIds: ["a", "b"], loadedServerIds: ["a", "b"] };
// Host "b" is offline and has no cached directory, so its pins are unknown.
const ONE_UNCACHED = { serverIds: ["a", "b"], loadedServerIds: ["a"] };
// Host "b" is offline but its directory was restored from cache, which counts as loaded.
const ONE_CACHED = { serverIds: ["a", "b"], loadedServerIds: ["a", "b"] };

describe("pinned order seed", () => {
  beforeEach(() => {
    platform.isWeb = true;
    usePinnedOrderSeedStore.setState({ seeded: false });
    useSidebarOrderStore.setState({ pinnedWorkspaceOrder: ["older", "newer"] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the order the recency rule shows, then sets the flag once", () => {
    seedPinnedWorkspaceOrder(PINNED_AT, ALL_LIVE);

    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual([
      "fresh",
      "older",
      "newer",
    ]);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(true);

    useSidebarOrderStore.setState({ pinnedWorkspaceOrder: ["newer"] });
    seedPinnedWorkspaceOrder(PINNED_AT, ALL_LIVE);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["newer"]);
  });

  it("does nothing before both stores rehydrate", () => {
    vi.spyOn(useSidebarOrderStore.persist, "hasHydrated").mockReturnValue(false);
    seedPinnedWorkspaceOrder(PINNED_AT, ALL_LIVE);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(false);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["older", "newer"]);

    vi.restoreAllMocks();
    vi.spyOn(usePinnedOrderSeedStore.persist, "hasHydrated").mockReturnValue(false);
    seedPinnedWorkspaceOrder(PINNED_AT, ALL_LIVE);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(false);
  });

  it("does nothing on native", () => {
    platform.isWeb = false;
    seedPinnedWorkspaceOrder(PINNED_AT, ALL_LIVE);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(false);
  });

  it("seeds first when removing a key, then removes it", () => {
    removePinnedOrderKey("older", PINNED_AT, ALL_LIVE);

    expect(usePinnedOrderSeedStore.getState().seeded).toBe(true);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["fresh", "newer"]);
  });

  it("does not remove a key on native", () => {
    platform.isWeb = false;
    removePinnedOrderKey("older", PINNED_AT, ALL_LIVE);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["older", "newer"]);
  });

  it("prunes unpinned keys once and writes nothing the second time", () => {
    seedPinnedWorkspaceOrder(PINNED_AT, ALL_LIVE);
    const input = { fresh: PINNED_AT.fresh, older: null, newer: PINNED_AT.newer };
    prunePinnedOrder(input);
    const afterFirst = useSidebarOrderStore.getState().pinnedWorkspaceOrder;
    prunePinnedOrder(input);

    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["fresh", "newer"]);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toBe(afterFirst);
  });

  it("does not prune before the seed", () => {
    prunePinnedOrder({ older: null });
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["older", "newer"]);
  });

  it("keeps hidden keys in place when a partial drag writes before the seed", () => {
    useSidebarOrderStore.getState().setPinnedWorkspaceOrder(["newer", "older"]);

    expect(usePinnedOrderSeedStore.getState().seeded).toBe(false);
    expect(
      orderPinnedWorkspaceKeys({
        pinnedAtByKey: PINNED_AT,
        storedOrder: useSidebarOrderStore.getState().pinnedWorkspaceOrder,
        rule: "recency",
      }),
    ).toEqual(["fresh", "newer", "older"]);
  });

  it("seeds when an offline host has a cached directory", () => {
    seedPinnedWorkspaceOrder(PINNED_AT, ONE_CACHED);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(true);
  });

  it("does not seed while an offline host has no cached directory", () => {
    seedPinnedWorkspaceOrder(PINNED_AT, ONE_UNCACHED);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(false);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["older", "newer"]);
  });

  it("does not seed on a local pin or unpin while a host is uncached, but still drops the key", () => {
    removePinnedOrderKey("older", PINNED_AT, ONE_UNCACHED);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(false);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["newer"]);
  });

  it("seeds on a local unpin when the offline host is cached", () => {
    removePinnedOrderKey("older", PINNED_AT, ONE_CACHED);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(true);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["fresh", "newer"]);
  });
});
