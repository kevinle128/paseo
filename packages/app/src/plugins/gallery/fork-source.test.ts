import { describe, expect, it } from "vitest";
import type { PluginListItem } from "@getpaseo/protocol/messages";
import {
  FORK_PLUGIN_REGISTRY_URL,
  parseForkRegistryReference,
} from "@getpaseo/protocol/fork-plugin-source";
import {
  installedByListingKey,
  installedPluginsForSource,
  installedSource,
  installSourceFor,
  listingKey,
} from "./fork-source";

const DEFAULT_REGISTRY = "https://plugins.paseo.sh";

function plugin(id: string, registry?: { url: string; id: string }): PluginListItem {
  return {
    id,
    path: `/plugins/${id}`,
    enabled: true,
    status: "running",
    installation: registry
      ? {
          identity: {
            kind: "git",
            remote: "https://github.com/kevinle128/example.git",
            pluginPath: ".",
            registry,
          },
        }
      : { identity: { kind: "directory", path: `/plugins/${id}` } },
  };
}

function npmPlugin(id: string): PluginListItem {
  return {
    id,
    path: `/plugins/${id}`,
    enabled: true,
    status: "running",
    installation: {
      identity: { kind: "npm", packageName: "@kevinle128/example", pluginPath: "." },
    },
  };
}
function gitPlugin(id: string): PluginListItem {
  return {
    id,
    path: `/plugins/${id}`,
    enabled: true,
    status: "running",
    installation: {
      identity: {
        kind: "git",
        remote: "https://github.com/kevinle128/example.git",
        pluginPath: ".",
      },
    },
  };
}

describe("installed plugin source filter", () => {
  const plugins = [
    plugin("computer-use", { url: FORK_PLUGIN_REGISTRY_URL, id: "kevinle128/computer-use" }),
    plugin("paseo-agent-memory", {
      url: FORK_PLUGIN_REGISTRY_URL,
      id: "kevinle128/agent-memory",
    }),
    plugin("paseo-slp", { url: FORK_PLUGIN_REGISTRY_URL, id: "kevinle128/paseo-slp" }),
    plugin("from-paseo", { url: DEFAULT_REGISTRY, id: "kevinle128/computer-use" }),
    plugin("local-dir"),
    gitPlugin("direct-git"),
    npmPlugin("direct-npm"),
  ];

  it("shows only fork-registry installs when the source is fork", () => {
    expect(installedPluginsForSource(plugins, "fork").map((entry) => entry.id)).toEqual([
      "computer-use",
      "paseo-agent-memory",
      "paseo-slp",
    ]);
  });

  it("keeps other registries, directories, and direct git installs on Paseo", () => {
    expect(installedPluginsForSource(plugins, "paseo").map((entry) => entry.id)).toEqual([
      "from-paseo",
      "local-dir",
      "direct-git",
      "direct-npm",
    ]);
  });
});

describe("fork plugin listing keys", () => {
  it("installs a Paseo listing by its registry id", () => {
    expect(installSourceFor("paseo", "kevinle128/computer-use")).toBe("kevinle128/computer-use");
  });

  it("installs a fork listing with the fork prefix the daemon reads", () => {
    const source = installSourceFor("fork", "kevinle128/agent-memory");
    expect(source).toBe("fork:kevinle128/agent-memory");
    expect(parseForkRegistryReference(source)).toEqual({
      url: FORK_PLUGIN_REGISTRY_URL,
      id: "kevinle128/agent-memory",
    });
  });

  it("tells a fork install from a Paseo install and from a directory", () => {
    expect(
      installedSource(
        plugin("computer-use", {
          url: FORK_PLUGIN_REGISTRY_URL,
          id: "kevinle128/computer-use",
        }),
      ),
    ).toBe("fork");
    expect(
      installedSource(
        plugin("computer-use", { url: DEFAULT_REGISTRY, id: "kevinle128/computer-use" }),
      ),
    ).toBe("paseo");
    expect(installedSource(plugin("local-plugin"))).toBeUndefined();
  });

  it("keeps the same plugin id from two registries under different keys", () => {
    const listingId = "kevinle128/computer-use";
    const installed = installedByListingKey([
      plugin("computer-use-paseo", { url: DEFAULT_REGISTRY, id: listingId }),
      plugin("computer-use-fork", { url: FORK_PLUGIN_REGISTRY_URL, id: listingId }),
    ]);
    expect([...installed.keys()]).toEqual([
      listingKey("paseo", listingId),
      listingKey("fork", listingId),
    ]);
    expect(installed.get(listingKey("paseo", listingId))?.id).toBe("computer-use-paseo");
    expect(installed.get(listingKey("fork", listingId))?.id).toBe("computer-use-fork");
  });
});
