import type { PluginListItem } from "@getpaseo/protocol/messages";
import {
  FORK_SOURCE_PREFIX,
  isForkRegistryIdentity,
  type PluginSourceKind,
} from "@getpaseo/protocol/fork-plugin-source";
import { installedListingId } from "./listing";

/** A listing key that stays distinct when the same id exists in both registries. */
export function listingKey(source: PluginSourceKind | undefined, id: string): string {
  return source === "fork" ? `${FORK_SOURCE_PREFIX}${id}` : id;
}

/** The install reference the daemon resolves for this listing. */
export function installSourceFor(source: PluginSourceKind, listingId: string): string {
  return source === "fork" ? `${FORK_SOURCE_PREFIX}${listingId}` : listingId;
}

/** Which registry an installed plugin came from, when it came from one. */
export function installedSource(plugin: PluginListItem | undefined): PluginSourceKind | undefined {
  const identity = plugin?.installation?.identity;
  if (!identity || identity.kind === "directory" || !identity.registry) return undefined;
  return isForkRegistryIdentity(identity.registry) ? "fork" : "paseo";
}

/**
 * Installed plugins for the selected source.
 * Paseo keeps every install that did not come from the fork registry, including a directory or a
 * git or npm install with no registry identity. Fork keeps only installs whose registry URL is the
 * fork registry.
 */
export function installedPluginsForSource(
  plugins: readonly PluginListItem[],
  source: PluginSourceKind,
): PluginListItem[] {
  return plugins.filter((plugin) =>
    source === "fork" ? installedSource(plugin) === "fork" : installedSource(plugin) !== "fork",
  );
}

/** Installed plugins keyed by registry and listing id. */
export function installedByListingKey(plugins: readonly PluginListItem[]) {
  const byListing = new Map<string, PluginListItem>();
  for (const plugin of plugins) {
    const listingId = installedListingId(plugin);
    const source = installedSource(plugin);
    if (listingId && source) byListing.set(listingKey(source, listingId), plugin);
  }
  return byListing;
}
