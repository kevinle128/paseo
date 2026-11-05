import { applyStoredOrdering } from "@/hooks/sidebar-workspaces-view-model";

/**
 * The single ordering for pinned workspaces, shared by the sidebar Pinned section and the
 * pinned grid so both always list them the same way. Most recently pinned first, then the
 * user's stored drag order is laid over those slots.
 *
 * `pinnedAtByKey` must hold every pinned workspace on every host. Callers must not pass a
 * filtered subset, or the grid would lose cells whenever a sidebar filter is active.
 */
export function orderPinnedWorkspaceKeys(input: {
  pinnedAtByKey: Record<string, string>;
  pinnedWorkspaceOrder: string[];
}): string[] {
  const { pinnedAtByKey, pinnedWorkspaceOrder } = input;
  const byRecency = Object.keys(pinnedAtByKey).sort((a, b) =>
    (pinnedAtByKey[b] ?? "").localeCompare(pinnedAtByKey[a] ?? ""),
  );
  return applyStoredOrdering({
    items: byRecency,
    storedOrder: pinnedWorkspaceOrder,
    getKey: (key) => key,
  });
}
