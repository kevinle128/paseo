import { describe, expect, it } from "vitest";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
import { buildAddPinOptions, resolveGroupStarts } from "./add-pin-options";

function workspace(serverId: string, workspaceId: string, projectName: string, name: string) {
  return {
    workspaceKey: `${serverId}:${workspaceId}`,
    serverId,
    workspaceId,
    projectViewKey: projectName,
    projectName,
    projectKind: "git" as const,
    workspaceKind: "checkout" as const,
    name,
  };
}

function project(viewKey: string, workspaces: ReturnType<typeof workspace>[]): SidebarProjectEntry {
  return {
    viewKey,
    projectName: viewKey,
    projectKind: "git",
    iconWorkingDir: `/${viewKey}`,
    hosts: [],
    workspaces,
  };
}

const projects = [
  project("alpha", [workspace("h1", "a1", "alpha", "main"), workspace("h2", "a2", "alpha", "dev")]),
  project("beta", [workspace("h1", "b1", "beta", "main")]),
];

describe("buildAddPinOptions", () => {
  it("leaves pinned workspaces out", () => {
    const { options } = buildAddPinOptions({
      projects,
      pinnedKeys: ["h1:a1"],
      hostLabelByServerId: new Map(),
    });
    expect(options.map((o) => o.id)).toEqual(["h2:a2", "h1:b1"]);
  });

  it("keeps project order, then workspace order", () => {
    const { options, groupLabelById } = buildAddPinOptions({
      projects,
      pinnedKeys: [],
      hostLabelByServerId: new Map(),
    });
    expect(options.map((o) => o.id)).toEqual(["h1:a1", "h2:a2", "h1:b1"]);
    expect(groupLabelById.get("h2:a2")).toBe("alpha");
    expect(groupLabelById.get("h1:b1")).toBe("beta");
  });

  it("shows a host label only when one is given for the host", () => {
    const without = buildAddPinOptions({
      projects,
      pinnedKeys: [],
      hostLabelByServerId: new Map(),
    });
    expect(without.options.every((o) => o.description === undefined)).toBe(true);

    const withLabel = buildAddPinOptions({
      projects,
      pinnedKeys: [],
      hostLabelByServerId: new Map([["h2", "Laptop"]]),
    });
    expect(withLabel.options.find((o) => o.id === "h2:a2")?.description).toBe("Laptop");
    expect(withLabel.options.find((o) => o.id === "h1:a1")?.description).toBeUndefined();
    expect(withLabel.options.find((o) => o.id === "h2:a2")?.searchText).toBe("alpha Laptop");
  });

  it("returns nothing when every workspace is pinned", () => {
    const { options } = buildAddPinOptions({
      projects,
      pinnedKeys: ["h1:a1", "h2:a2", "h1:b1"],
      hostLabelByServerId: new Map(),
    });
    expect(options).toEqual([]);
  });
});

describe("resolveGroupStarts", () => {
  const { options, groupLabelById } = buildAddPinOptions({
    projects,
    pinnedKeys: [],
    hostLabelByServerId: new Map(),
  });

  it("marks the first option of each project", () => {
    expect([...resolveGroupStarts(options, groupLabelById)]).toEqual(["h1:a1", "h1:b1"]);
  });

  it("moves the start when a filter removes the first workspace of a project", () => {
    const visible = options.filter((o) => o.id !== "h1:a1");
    expect([...resolveGroupStarts(visible, groupLabelById)]).toEqual(["h2:a2", "h1:b1"]);
  });
});
