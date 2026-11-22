import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FORK_PLUGIN_REGISTRY_URL } from "@getpaseo/protocol/fork-plugin-source";
import { ManagedPluginSources } from "../managed-source.js";
import { registryBaseFor } from "./fork-registry.js";
import { getRegistryPlugin, listRegistryPlugins, type RegistryOptions } from "./registry.js";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface RecordedRequest {
  path?: string;
  authorization?: string;
  install?: string;
}

function listing(id: string, name: string) {
  return {
    id,
    name,
    description: name,
    categories: ["utils"],
    author: { github: "kevinle128" },
    repository: { url: "https://github.com/kevinle128/example" },
    artifact: {
      kind: "git",
      remote: "https://github.com/kevinle128/example.git",
      commit: "a".repeat(40),
    },
    media: [],
    submittedAt: "2026-11-22",
    reviewedAt: "2026-11-22",
    updatedAt: "2026-11-22",
    publishedAt: "2026-11-22",
  };
}

function indexDocument(name: string, plugins: ReturnType<typeof listing>[]) {
  return {
    schemaVersion: 1,
    registry: { name, url: "http://registry.test" },
    categories: [{ slug: "utils", label: "Utils" }],
    plugins,
    featured: plugins.map((plugin) => plugin.id),
    generatedAt: "2026-11-22",
  };
}

async function listen(documents: Record<string, unknown>): Promise<{
  base: string;
  host: string;
  requests: RecordedRequest[];
}> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const header = req.headers["x-paseo-install"];
    requests.push({
      path: req.url,
      authorization: req.headers.authorization,
      install: Array.isArray(header) ? header[0] : header,
    });
    const document = req.url ? documents[req.url] : undefined;
    if (!document) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(document));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const host = `127.0.0.1:${address.port}`;
  return { base: `http://${host}`, host, requests };
}

const forkPlugins = [
  listing("kevinle128/computer-use", "Computer Use"),
  listing("kevinle128/agent-memory", "Agent-Memory"),
  listing("kevinle128/paseo-slp", "Paseo SLP"),
];

describe("fork registry browsing", () => {
  it("reads the default registry unless the source is fork", async () => {
    const defaults = await listen({
      "/index.json": indexDocument("Default", [listing("acme/example", "Example")]),
    });
    const fork = await listen({
      "/index.json": indexDocument("Fork", forkPlugins),
      "/plugins/kevinle128/agent-memory.json": {
        ...forkPlugins[1],
        readme: "# Agent-Memory",
      },
      "/plugins/kevinle128/wrong.json": {
        ...forkPlugins[1],
        id: "kevinle128/other",
        readme: "# No",
      },
    });
    const options: RegistryOptions = { defaultUrl: defaults.base, forkUrl: fork.base };

    const listed = await listRegistryPlugins(options);
    expect(listed.plugins.map((plugin) => plugin.id)).toEqual(["acme/example"]);
    expect(defaults.requests.map((request) => request.path)).toEqual(["/index.json"]);
    expect(fork.requests).toEqual([]);

    const forked = await listRegistryPlugins(options, "fork");
    expect(forked.plugins.map((plugin) => plugin.id)).toEqual([
      "kevinle128/computer-use",
      "kevinle128/agent-memory",
      "kevinle128/paseo-slp",
    ]);

    const detail = await getRegistryPlugin("kevinle128/agent-memory", options, "fork");
    expect(detail.readme).toBe("# Agent-Memory");
    await expect(getRegistryPlugin("kevinle128/wrong", options, "fork")).rejects.toThrow(
      "Registry returned a different plugin ID",
    );
  });

  it("selects only the default registry or the fork registry", () => {
    expect(registryBaseFor(undefined, {})).toBeUndefined();
    expect(registryBaseFor("paseo", { forkUrl: "http://127.0.0.1:9/fork/" })).toBeUndefined();
    expect(registryBaseFor("fork", {})).toBe(FORK_PLUGIN_REGISTRY_URL);
    expect(registryBaseFor("fork", { forkUrl: "http://127.0.0.1:9/fork/" })).toBe(
      "http://127.0.0.1:9/fork",
    );
  });

  it("sends registry credentials only to the fork host", async () => {
    const defaults = await listen({
      "/index.json": indexDocument("Default", [listing("acme/example", "Example")]),
    });
    const fork = await listen({
      "/index.json": indexDocument("Fork", forkPlugins),
    });
    const options: RegistryOptions = {
      defaultUrl: defaults.base,
      forkUrl: fork.base,
      registries: { [fork.host]: { authorization: "Bearer x" } },
    };

    await listRegistryPlugins(options);
    await listRegistryPlugins(options, "fork");

    expect(defaults.requests).toEqual([
      { path: "/index.json", authorization: undefined, install: undefined },
    ]);
    expect(fork.requests).toEqual([
      { path: "/index.json", authorization: "Bearer x", install: undefined },
    ]);
  });

  it("fetches a fork install from the fork registry with install intent", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "paseo-fork-registry-"));
    roots.push(home);
    const fork = await listen({
      "/plugins/kevinle128/x.json": { id: "kevinle128/other" },
    });
    const sources = new ManagedPluginSources(home, { forkUrl: fork.base });

    await expect(sources.prepareInstall({ source: "fork:kevinle128/x" })).rejects.toThrow();
    expect(fork.requests).toEqual([
      { path: "/plugins/kevinle128/x.json", authorization: undefined, install: "1" },
    ]);
  });
});
