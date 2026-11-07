import { applyStoredOrdering } from "@/hooks/sidebar-workspaces-view-model";

/**
 * "recency": newest pin first, the stored order laid over those slots. Native always uses it.
 * "append": the stored keys that are still pinned, then the other pins oldest first, so a new
 * pin lands at the end. Web uses it once the stored order has been seeded.
 */
export type PinnedOrderRule = "recency" | "append";

/**
 * The rule depends on the platform, a build-time constant, and not on the window width. A rule
 * tied to the grid layout would reorder the sidebar whenever the window crosses the compact
 * breakpoint.
 */
export function resolvePinnedOrderRule(input: {
  isWeb: boolean;
  seeded: boolean;
}): PinnedOrderRule {
  return input.isWeb && input.seeded ? "append" : "recency";
}

/**
 * The single ordering for pinned workspaces, shared by the sidebar Pinned section and the
 * pinned grid so both always list them the same way.
 *
 * `pinnedAtByKey` must hold every pinned workspace on every host. Callers must not pass a
 * filtered subset, or the grid would lose cells whenever a sidebar filter is active.
 */
export function orderPinnedWorkspaceKeys(input: {
  pinnedAtByKey: Record<string, string>;
  storedOrder: string[];
  rule: PinnedOrderRule;
}): string[] {
  const { pinnedAtByKey, storedOrder, rule } = input;
  if (rule === "append") {
    return orderAppend(pinnedAtByKey, storedOrder);
  }
  return orderByRecency(pinnedAtByKey, storedOrder);
}

// Equal pin times must still give one order, whatever order the session map lists them in.
function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function orderByRecency(pinnedAtByKey: Record<string, string>, storedOrder: string[]): string[] {
  const byRecency = Object.keys(pinnedAtByKey).sort(
    (a, b) => (pinnedAtByKey[b] ?? "").localeCompare(pinnedAtByKey[a] ?? "") || compareKeys(a, b),
  );
  return applyStoredOrdering({ items: byRecency, storedOrder, getKey: (key) => key });
}

function orderAppend(pinnedAtByKey: Record<string, string>, storedOrder: string[]): string[] {
  const ordered: string[] = [];
  const placed = new Set<string>();
  for (const key of storedOrder) {
    if (key in pinnedAtByKey && !placed.has(key)) {
      placed.add(key);
      ordered.push(key);
    }
  }
  const rest = Object.keys(pinnedAtByKey)
    .filter((key) => !placed.has(key))
    .sort((a, b) => {
      const byTime = (pinnedAtByKey[a] ?? "").localeCompare(pinnedAtByKey[b] ?? "");
      return byTime !== 0 ? byTime : compareKeys(a, b);
    });
  return [...ordered, ...rest];
}

/** True once every registered host has loaded its workspaces and no seed ran yet. */
export function shouldSeedPinnedOrder(input: {
  seeded: boolean;
  serverIds: string[];
  hydratedServerIds: string[];
}): boolean {
  if (input.seeded || input.serverIds.length === 0) return false;
  const hydrated = new Set(input.hydratedServerIds);
  return input.serverIds.every((serverId) => hydrated.has(serverId));
}

/**
 * The order the recency rule shows today for the known pins, followed by stored keys that are
 * not known (a host that has not loaded yet), in stored order. Writing it freezes what the
 * user sees now, so switching to the append rule does not move any row.
 */
export function buildPinnedOrderSeed(input: {
  pinnedAtByKey: Record<string, string>;
  storedOrder: string[];
}): string[] {
  const known = orderByRecency(input.pinnedAtByKey, input.storedOrder);
  const knownSet = new Set(known);
  return [...known, ...input.storedOrder.filter((key) => !knownSet.has(key))];
}

/**
 * Stored keys to drop: those whose workspace is loaded and not pinned. A key whose workspace is
 * not loaded stays, because it may belong to a host that has not synced yet.
 */
export function resolvePinnedOrderPrune(input: {
  storedOrder: string[];
  workspacePinnedAtByKey: Record<string, string | null>;
}): string[] | null {
  const keys = input.storedOrder.filter(
    (key) => key in input.workspacePinnedAtByKey && input.workspacePinnedAtByKey[key] == null,
  );
  return keys.length > 0 ? keys : null;
}
