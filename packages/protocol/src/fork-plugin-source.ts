import { z } from "zod";
import { PluginRegistryIdSchema, type PluginRegistryIdentity } from "./plugin-registry.js";

export const PLUGIN_SOURCES = ["paseo", "fork"] as const;
export const PluginSourceKindSchema = z.enum(PLUGIN_SOURCES);
export type PluginSourceKind = z.infer<typeof PluginSourceKindSchema>;

/** Project site for the fork registry. The path prefix is part of the origin the daemon fetches. */
export const FORK_PLUGIN_REGISTRY_URL = "https://kevinle128.github.io/paseo-plugins";
/**
 * Install references use this prefix because `host/owner/slug` addresses the host root and would
 * miss the `/paseo-plugins` path on the project site.
 */
export const FORK_SOURCE_PREFIX = "fork:";

export function parseForkRegistryReference(
  source: string,
  forkUrl = FORK_PLUGIN_REGISTRY_URL,
): PluginRegistryIdentity | null {
  if (!source.startsWith(FORK_SOURCE_PREFIX)) return null;
  const id = source.slice(FORK_SOURCE_PREFIX.length);
  if (!PluginRegistryIdSchema.safeParse(id).success) return null;
  return { url: forkUrl.replace(/\/+$/, ""), id };
}

export function isForkRegistryIdentity(
  identity: Pick<PluginRegistryIdentity, "url">,
  forkUrl = FORK_PLUGIN_REGISTRY_URL,
): boolean {
  return identity.url.replace(/\/+$/, "") === forkUrl.replace(/\/+$/, "");
}
