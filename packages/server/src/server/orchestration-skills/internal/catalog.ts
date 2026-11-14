import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import type { SkillSelection } from "./operations.js";

export interface SkillCatalogEntry {
  name: string;
  description: string;
  /** Where the skill ships from. The host skill manager only manages the bundled set. */
  source: "paseo-bundled";
  /** True when the host selection includes the skill. */
  selected: boolean;
  /** True when the skill has a directory in at least one agent home on the host. */
  installed: boolean;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Reads only the `description` field. Missing or malformed metadata yields an empty string. */
export async function readSkillDescription(skillDir: string): Promise<string> {
  const raw = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8").catch(() => null);
  const block = raw ? FRONTMATTER_PATTERN.exec(raw)?.[1] : undefined;
  if (!block) return "";
  try {
    const parsed: unknown = parseYaml(block);
    const description =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)["description"]
        : undefined;
    return typeof description === "string" ? description.trim() : "";
  } catch {
    return "";
  }
}

export async function buildSkillCatalog(input: {
  sourceDir: string;
  available: readonly string[];
  installed: readonly string[];
  selection: SkillSelection;
}): Promise<SkillCatalogEntry[]> {
  const installed = new Set(input.installed);
  const chosen = input.selection.mode === "custom" ? new Set(input.selection.skills) : null;
  return Promise.all(
    input.available.map(async (name) => ({
      name,
      description: await readSkillDescription(path.join(input.sourceDir, name)),
      source: "paseo-bundled" as const,
      selected: chosen === null || chosen.has(name),
      installed: installed.has(name),
    })),
  );
}
