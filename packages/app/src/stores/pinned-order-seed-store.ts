import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface PinnedOrderSeedState {
  seeded: boolean;
  markSeeded: () => void;
}

const PinnedOrderSeedPersistedSchema = z.strictObject({ seeded: z.boolean() });

/**
 * Records that the stored pinned order was seeded with the order the user saw before the web
 * switched to the new-first rule. It lives apart from the sidebar order store so that rolling back to code
 * without this store leaves the order store readable.
 */
export const usePinnedOrderSeedStore = create<PinnedOrderSeedState>()(
  persist(
    (set) => ({
      seeded: false,
      markSeeded: () => set({ seeded: true }),
    }),
    {
      name: "pinned-workspace-order-seed",
      storage: createValidatedPersistStorage(AsyncStorage, PinnedOrderSeedPersistedSchema),
      partialize: (state) => ({ seeded: state.seeded }),
      version: 1,
    },
  ),
);
