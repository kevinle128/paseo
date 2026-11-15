import type { AgentSkillSelection } from "@getpaseo/protocol/messages";

import type { DaemonConfigStore } from "../daemon-config-store.js";
import { buildSkillCatalog, type SkillCatalogEntry } from "./internal/catalog.js";
import {
  createSkillsController,
  type SkillsController,
  type SkillsSaveResult,
  type SkillsSnapshot,
} from "./internal/controller.js";
import { resolveSkillTargets } from "./internal/paths.js";
import { createSkillSelectionStore } from "./internal/selection-store.js";

export interface OrchestrationSkills {
  getStatus(): Promise<SkillsSnapshot>;
  reconcile(): Promise<SkillsSnapshot>;
  uninstall(): Promise<SkillsSnapshot>;
  saveSelection(
    selection: AgentSkillSelection,
    confirmedRemovals?: readonly string[],
  ): Promise<SkillsSaveResult>;
  importLegacySelectionIfUnset(selection: AgentSkillSelection): Promise<{
    imported: boolean;
    selection: AgentSkillSelection;
  }>;
  autoUpdate(): Promise<SkillsSnapshot>;
  /** The bundled catalog with descriptions and host selection state, for read-only listing. */
  listCatalog(): Promise<SkillCatalogEntry[]>;
}

export function createOrchestrationSkills(
  configStore: DaemonConfigStore,
  resolveTargets = resolveSkillTargets,
): OrchestrationSkills {
  const controller: SkillsController = createSkillsController({
    resolveTargets,
    selectionStore: createSkillSelectionStore(configStore),
  });
  return {
    getStatus: () => controller.status(),
    reconcile: () => controller.update(),
    uninstall: () => controller.uninstall(),
    saveSelection: (selection, confirmedRemovals = []) =>
      controller.save({ ...selection, confirmedRemovals }),
    importLegacySelectionIfUnset: (selection) => controller.importLegacySelectionIfUnset(selection),
    autoUpdate: () => controller.autoUpdate(),
    listCatalog: async () => {
      const snapshot = await controller.status();
      return buildSkillCatalog({
        sourceDir: resolveTargets().sourceDir,
        available: snapshot.available,
        installed: snapshot.installed,
        selection: snapshot.selection,
      });
    },
  };
}

export type { SkillCatalogEntry } from "./internal/catalog.js";
export type { SkillsSaveResult, SkillsSnapshot } from "./internal/controller.js";
