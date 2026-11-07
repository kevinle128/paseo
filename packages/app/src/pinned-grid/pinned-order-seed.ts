import { isWeb } from "@/constants/platform";
import { usePinnedOrderSeedStore } from "@/stores/pinned-order-seed-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { buildPinnedOrderSeed, resolvePinnedOrderPrune } from "./pinned-order";

// A write made before a store rehydrates is lost when the stored state is merged in.
function storesReady(): boolean {
  return (
    useSidebarOrderStore.persist.hasHydrated() && usePinnedOrderSeedStore.persist.hasHydrated()
  );
}

/**
 * Freezes the order the user sees today into the stored order, then sets the flag that switches
 * web to the append rule. Only this function sets the flag. If the app stops between the two
 * writes, the next call computes the same list because the recency rule returns a full stored
 * order unchanged.
 */
export function seedPinnedWorkspaceOrder(pinnedAtByKey: Record<string, string>): void {
  if (!isWeb || !storesReady()) return;
  const seedStore = usePinnedOrderSeedStore.getState();
  if (seedStore.seeded) return;
  const orderStore = useSidebarOrderStore.getState();
  orderStore.setPinnedWorkspaceOrder(
    buildPinnedOrderSeed({ pinnedAtByKey, storedOrder: orderStore.pinnedWorkspaceOrder }),
  );
  seedStore.markSeeded();
}

/** Drops one key from the stored order. Seeds first so the removal does not move other rows. */
export function removePinnedOrderKey(key: string, pinnedAtByKey: Record<string, string>): void {
  if (!isWeb || !storesReady()) return;
  seedPinnedWorkspaceOrder(pinnedAtByKey);
  useSidebarOrderStore.getState().removePinnedWorkspaceKey(key);
}

/**
 * Drops stored keys of workspaces that are loaded and no longer pinned, which covers an unpin
 * made on another device. Runs only after the seed.
 */
export function prunePinnedOrder(workspacePinnedAtByKey: Record<string, string | null>): void {
  if (!isWeb || !storesReady() || !usePinnedOrderSeedStore.getState().seeded) return;
  const orderStore = useSidebarOrderStore.getState();
  const keys = resolvePinnedOrderPrune({
    storedOrder: orderStore.pinnedWorkspaceOrder,
    workspacePinnedAtByKey,
  });
  if (keys) orderStore.removePinnedWorkspaceKeys(keys);
}
