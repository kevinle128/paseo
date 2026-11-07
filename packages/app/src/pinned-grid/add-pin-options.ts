import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
import type { ComboboxOptionModel } from "@/components/ui/combobox-options";

export interface AddPinOptions {
  options: ComboboxOptionModel[];
  /** The project name each option sits under, by option id. */
  groupLabelById: ReadonlyMap<string, string>;
  /** Where to pin an option, by option id. */
  workspaceByKey: ReadonlyMap<string, { serverId: string; workspaceId: string }>;
}

/**
 * The workspaces the "+" picker offers: every workspace that is not pinned, in sidebar project
 * order and then workspace order, so a project's workspaces stay together.
 */
export function buildAddPinOptions(input: {
  projects: SidebarProjectEntry[];
  pinnedKeys: readonly string[];
  hostLabelByServerId: ReadonlyMap<string, string>;
}): AddPinOptions {
  const pinned = new Set(input.pinnedKeys);
  const options: ComboboxOptionModel[] = [];
  const groupLabelById = new Map<string, string>();
  const workspaceByKey = new Map<string, { serverId: string; workspaceId: string }>();
  for (const project of input.projects) {
    for (const workspace of project.workspaces) {
      if (pinned.has(workspace.workspaceKey)) continue;
      const hostLabel = input.hostLabelByServerId.get(workspace.serverId);
      options.push({
        id: workspace.workspaceKey,
        label: workspace.name,
        description: hostLabel,
        searchText: hostLabel ? `${project.projectName} ${hostLabel}` : project.projectName,
      });
      groupLabelById.set(workspace.workspaceKey, project.projectName);
      workspaceByKey.set(workspace.workspaceKey, {
        serverId: workspace.serverId,
        workspaceId: workspace.workspaceId,
      });
    }
  }
  return { options, groupLabelById, workspaceByKey };
}

/** The ids of the visible options that begin a project group. */
export function resolveGroupStarts(
  visibleOptions: readonly ComboboxOptionModel[],
  groupLabelById: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const starts = new Set<string>();
  let previousGroup: string | undefined;
  for (const option of visibleOptions) {
    const group = groupLabelById.get(option.id);
    if (group !== undefined && group !== previousGroup) starts.add(option.id);
    previousGroup = group;
  }
  return starts;
}
