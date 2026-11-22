import { describe, expect, it } from "vitest";
import { FORK_PLUGIN_REGISTRY_URL, parseForkRegistryReference } from "./fork-plugin-source.js";
import { PluginRegistryGetRequestSchema, PluginRegistryListRequestSchema } from "./messages.js";
import { formatPluginIdentity, parsePluginSourceReference } from "./plugin-source-reference.js";

describe("fork plugin source", () => {
  it("accepts a missing registry source and fork, and rejects any other source", () => {
    const request = { type: "plugin.registry.list.request" as const, requestId: "1" };
    expect(PluginRegistryListRequestSchema.safeParse(request).success).toBe(true);
    expect(PluginRegistryListRequestSchema.safeParse({ ...request, source: "fork" }).success).toBe(
      true,
    );
    expect(PluginRegistryListRequestSchema.safeParse({ ...request, source: "other" }).success).toBe(
      false,
    );
    expect(
      PluginRegistryGetRequestSchema.safeParse({
        type: "plugin.registry.get.request",
        requestId: "1",
        id: "kevinle128/paseo-slp",
      }).success,
    ).toBe(true);
    expect(
      PluginRegistryGetRequestSchema.safeParse({
        type: "plugin.registry.get.request",
        requestId: "1",
        id: "kevinle128/paseo-slp",
        source: "fork",
      }).success,
    ).toBe(true);
    expect(
      PluginRegistryGetRequestSchema.safeParse({
        type: "plugin.registry.get.request",
        requestId: "1",
        id: "kevinle128/paseo-slp",
        source: "other",
      }).success,
    ).toBe(false);
  });

  it("parses a fork registry id and rejects anything else", () => {
    expect(parseForkRegistryReference("fork:kevinle128/paseo-slp")).toEqual({
      url: FORK_PLUGIN_REGISTRY_URL,
      id: "kevinle128/paseo-slp",
    });
    expect(parseForkRegistryReference("fork:bad")).toBeNull();
    expect(parseForkRegistryReference("kevinle128/paseo-slp")).toBeNull();
    expect(
      parseForkRegistryReference("git:https://github.com/kevinle128/paseo-slp-plugin.git"),
    ).toBeNull();
  });

  it("keeps a fork install reference intact, including its plugin path separator", () => {
    expect(parsePluginSourceReference("fork:kevinle128/paseo-slp")).toEqual({
      kind: "managed",
      source: "fork:kevinle128/paseo-slp",
      pluginPath: undefined,
    });
  });

  it("prints a fork registry install as fork:owner/slug", () => {
    expect(
      formatPluginIdentity({
        kind: "git",
        remote: "https://github.com/kevinle128/paseo-slp-plugin.git",
        pluginPath: "plugin",
        registry: { url: FORK_PLUGIN_REGISTRY_URL, id: "kevinle128/paseo-slp" },
      }),
    ).toBe("fork:kevinle128/paseo-slp");
  });

  it("keeps existing source references unchanged", () => {
    expect(parsePluginSourceReference("kevinle128/computer-use")).toEqual({
      kind: "managed",
      source: "kevinle128/computer-use",
      pluginPath: undefined,
    });
    expect(parsePluginSourceReference("plugins.paseo.sh/kevinle128/computer-use")).toEqual({
      kind: "managed",
      source: "plugins.paseo.sh/kevinle128/computer-use",
      pluginPath: undefined,
    });
    expect(
      parsePluginSourceReference("git:https://github.com/kevinle128/paseo-slp-plugin.git:plugin"),
    ).toEqual({
      kind: "managed",
      source: "git:https://github.com/kevinle128/paseo-slp-plugin.git",
      pluginPath: "plugin",
    });
  });
});
