import { applyStoredOrdering } from "@/hooks/sidebar-workspaces-view-model";

/**
 * "recency": newest pin first, the stored order laid over those slots. Native always uses it.
 * "new-first": the pins without a stored position first, newest first, then the stored keys that
 * are still pinned in stored order. A new pin has no stored position, so it lands first and the
 * rows the user placed keep their relative order. Web uses it once the stored order has been
 * seeded.
 */
export type PinnedOrderRule = "recency" | "new-first";

/**
 * The rule depends on the platform, a build-time constant, and not on the window width. A rule
 * tied to the grid layout would reorder the sidebar whenever the window crosses the compact
 * breakpoint.
 */
export function resolvePinnedOrderRule(input: {
  isWeb: boolean;
  seeded: boolean;
}): PinnedOrderRule {
  return input.isWeb && input.seeded ? "new-first" : "recency";
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
  if (rule === "new-first") {
    return orderNewFirst(pinnedAtByKey, storedOrder);
  }
  return orderByRecency(pinnedAtByKey, storedOrder);
}

// Equal pin times must still give one order, whatever order the session map lists them in.
function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function sortNewestFirst(keys: string[], pinnedAtByKey: Record<string, string>): string[] {
  return keys.sort(
    (a, b) => (pinnedAtByKey[b] ?? "").localeCompare(pinnedAtByKey[a] ?? "") || compareKeys(a, b),
  );
}

function orderByRecency(pinnedAtByKey: Record<string, string>, storedOrder: string[]): string[] {
  const byRecency = sortNewestFirst(Object.keys(pinnedAtByKey), pinnedAtByKey);
  return applyStoredOrdering({ items: byRecency, storedOrder, getKey: (key) => key });
}

function orderNewFirst(pinnedAtByKey: Record<string, string>, storedOrder: string[]): string[] {
  const stored: string[] = [];
  const placed = new Set<string>();
  for (const key of storedOrder) {
    if (key in pinnedAtByKey && !placed.has(key)) {
      placed.add(key);
      stored.push(key);
    }
  }
  const unstored = sortNewestFirst(
    Object.keys(pinnedAtByKey).filter((key) => !placed.has(key)),
    pinnedAtByKey,
  );
  return [...unstored, ...stored];
}

/** The hosts a seed depends on: every registered host and those whose directory is loaded. */
export interface PinnedOrderSeedHosts {
  serverIds: string[];
  /** Hosts with a live snapshot or a directory restored from cache. */
  loadedServerIds: string[];
}

/**
 * True once every registered host has a loaded directory and no seed ran yet. A host that is
 * offline with a cached directory counts as loaded; one offline without a cache blocks the
 * seed, because its pins are unknown. Every seed path goes through this one condition.
 */
export function shouldSeedPinnedOrder(input: PinnedOrderSeedHosts & { seeded: boolean }): boolean {
  if (input.seeded || input.serverIds.length === 0) return false;
  const loaded = new Set(input.loadedServerIds);
  return input.serverIds.every((serverId) => loaded.has(serverId));
}

/**
 * The order the recency rule shows today for the known pins, followed by stored keys that are
 * not known (a host that has not loaded yet), in stored order. Writing it freezes what the
 * user sees now, so switching to the new-first rule does not move any row.
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
