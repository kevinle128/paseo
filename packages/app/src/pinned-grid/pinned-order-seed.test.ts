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
    seedPinnedWorkspaceOrder(PINNED_AT);

    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual([
      "fresh",
      "older",
      "newer",
    ]);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(true);

    useSidebarOrderStore.setState({ pinnedWorkspaceOrder: ["newer"] });
    seedPinnedWorkspaceOrder(PINNED_AT);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["newer"]);
  });

  it("does nothing before both stores rehydrate", () => {
    vi.spyOn(useSidebarOrderStore.persist, "hasHydrated").mockReturnValue(false);
    seedPinnedWorkspaceOrder(PINNED_AT);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(false);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["older", "newer"]);

    vi.restoreAllMocks();
    vi.spyOn(usePinnedOrderSeedStore.persist, "hasHydrated").mockReturnValue(false);
    seedPinnedWorkspaceOrder(PINNED_AT);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(false);
  });

  it("does nothing on native", () => {
    platform.isWeb = false;
    seedPinnedWorkspaceOrder(PINNED_AT);
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(false);
  });

  it("seeds first when removing a key, then removes it", () => {
    removePinnedOrderKey("older", PINNED_AT);

    expect(usePinnedOrderSeedStore.getState().seeded).toBe(true);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["fresh", "newer"]);
  });

  it("does not remove a key on native", () => {
    platform.isWeb = false;
    removePinnedOrderKey("older", PINNED_AT);
    expect(useSidebarOrderStore.getState().pinnedWorkspaceOrder).toEqual(["older", "newer"]);
  });

  it("prunes unpinned keys once and writes nothing the second time", () => {
    seedPinnedWorkspaceOrder(PINNED_AT);
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
});
