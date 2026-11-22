import {
  FORK_PLUGIN_REGISTRY_URL,
  type PluginSourceKind,
} from "@getpaseo/protocol/fork-plugin-source";
import type { RegistryOptions } from "./registry.js";

/**
 * The client names a source. The daemon reads the default registry or the fork registry, and never
 * a URL from the request.
 */
export function registryBaseFor(
  source: PluginSourceKind | undefined,
  options: RegistryOptions,
): string | undefined {
  if (source !== "fork") return undefined;
  return (options.forkUrl ?? FORK_PLUGIN_REGISTRY_URL).replace(/\/+$/, "");
}
