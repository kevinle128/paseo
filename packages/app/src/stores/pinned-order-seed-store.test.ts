import { beforeEach, describe, expect, it } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearAsyncStorageStub } from "../../test-stubs/async-storage";
import { usePinnedOrderSeedStore } from "./pinned-order-seed-store";

describe("pinned order seed store", () => {
  beforeEach(async () => {
    clearAsyncStorageStub();
    usePinnedOrderSeedStore.setState({ seeded: false });
  });

  it("starts unseeded", () => {
    expect(usePinnedOrderSeedStore.getState().seeded).toBe(false);
  });

  it("writes the flag and reads it back on rehydrate", async () => {
    usePinnedOrderSeedStore.getState().markSeeded();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const raw = await AsyncStorage.getItem("pinned-workspace-order-seed");
    expect(JSON.parse(raw ?? "null")).toEqual({ state: { seeded: true }, version: 1 });

    usePinnedOrderSeedStore.setState({ seeded: false });
    await AsyncStorage.setItem("pinned-workspace-order-seed", raw ?? "");
    await usePinnedOrderSeedStore.persist.rehydrate();

    expect(usePinnedOrderSeedStore.getState().seeded).toBe(true);
  });
});
