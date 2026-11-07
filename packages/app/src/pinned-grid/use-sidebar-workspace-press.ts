import { useCallback } from "react";
import { UnistylesRuntime } from "react-native-unistyles";
import { isCompactBreakpoint } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { queryClient } from "@/data/query-client";
import { APP_SETTINGS_QUERY_KEY } from "@/hooks/use-settings/storage";
import type { AppSettings } from "@/hooks/use-settings/storage";
import {
  focusWorkspaceCell,
  navigateToWorkspace,
} from "@/stores/navigation-active-workspace-store";
import { usePanelStore } from "@/stores/panel-store";
import { requestCellReveal } from "./cell-reveal-request";
import { resolveSidebarWorkspacePress } from "./sidebar-workspace-press";

interface PressedWorkspace {
  serverId: string;
  workspaceId: string;
  pinnedAt: unknown;
}

/**
 * Press handler for a sidebar workspace row. State is read when the press happens: the hook
 * runs once per row, and a subscription per row would re-render every row on a mode change.
 */
export function useSidebarWorkspacePress(): (workspace: PressedWorkspace) => void {
  return useCallback((workspace) => {
    const decision = resolveSidebarWorkspacePress({
      mode:
        queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)?.pinnedGrid.mode ?? "normal",
      supportsGrid: isWeb && !isCompactBreakpoint(UnistylesRuntime.breakpoint),
      focusModeEnabled: usePanelStore.getState().desktop.focusModeEnabled,
      isPinned: workspace.pinnedAt != null,
    });
    const { serverId, workspaceId } = workspace;
    if (decision === "focus-cell") {
      requestCellReveal(`${serverId}:${workspaceId}`);
      focusWorkspaceCell({ serverId, workspaceId });
      return;
    }
    navigateToWorkspace({ serverId, workspaceId });
  }, []);
}
