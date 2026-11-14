import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildSkillCatalog } from "./catalog.js";

describe("buildSkillCatalog", () => {
  let sourceDir: string;

  beforeEach(async () => {
    sourceDir = await mkdtemp(path.join(tmpdir(), "skill-catalog-"));
  });

  afterEach(async () => {
    await rm(sourceDir, { recursive: true, force: true });
  });

  async function writeSkill(name: string, content: string | null) {
    await mkdir(path.join(sourceDir, name), { recursive: true });
    if (content !== null) await writeFile(path.join(sourceDir, name, "SKILL.md"), content);
  }

  it("reads descriptions and reports selection and installed state", async () => {
    await writeSkill("alpha", "---\nname: alpha\ndescription: Does alpha things.\n---\n# Alpha\n");
    await writeSkill("beta", "---\nname: beta\ndescription: Does beta things.\n---\n");

    const entries = await buildSkillCatalog({
      sourceDir,
      available: ["alpha", "beta"],
      installed: ["alpha"],
      selection: { mode: "custom", skills: ["alpha"] },
    });

    expect(entries).toEqual([
      {
        name: "alpha",
        description: "Does alpha things.",
        source: "paseo-bundled",
        selected: true,
        installed: true,
      },
      {
        name: "beta",
        description: "Does beta things.",
        source: "paseo-bundled",
        selected: false,
        installed: false,
      },
    ]);
  });

  it("treats every bundled skill as selected in all mode and tolerates bad metadata", async () => {
    await writeSkill("no-meta", "# No frontmatter\n");
    await writeSkill("broken", "---\ndescription: [unclosed\n---\n");
    await writeSkill("no-file", null);

    const entries = await buildSkillCatalog({
      sourceDir,
      available: ["no-meta", "broken", "no-file"],
      installed: [],
      selection: { mode: "all" },
    });

    expect(entries.map((entry) => [entry.name, entry.description, entry.selected])).toEqual([
      ["no-meta", "", true],
      ["broken", "", true],
      ["no-file", "", true],
    ]);
  });
});
