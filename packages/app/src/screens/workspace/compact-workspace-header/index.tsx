import { Fragment, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CompactHeader } from "@/components/headers/compact-header";
import {
  EXPLORER_TOGGLE_KEYS,
  WorkspaceExplorerToggle,
} from "@/screens/workspace/workspace-explorer-toggle";
import { WorkspaceHeaderProjectRow } from "@/screens/workspace/workspace-header-project-row";
import {
  useWindowLayout,
  resolveWorkspaceActionPlacement,
  resolveWorkspaceBarActions,
  WindowLayoutActions,
} from "@/window-layout";
import { IconButtonChromeProvider } from "@/components/ui/icon-button-chrome";
import { useWorkspaceGridCell } from "@/pinned-grid/grid-cell-context";
import { GridCellMaximizeButton } from "@/pinned-grid/grid-cell-header";

export { MobileWorkspaceTabSwitcher } from "./tab-switcher";

interface CompactWorkspaceHeaderProps {
  serverId: string;
  isLoading: boolean;
  title: string;
  subtitle: string;
  onToggleExplorer: () => void;
  explorerToggleLabel: string;
  explorerToggleAccessibilityState: { expanded: boolean };
  tabSwitcher: ReactNode;
  /** Workspace overflow menu. */
  children: ReactNode;
  headerVariant: "compact" | "full";
  actionsActive: boolean;
}

/** The compact header with the workspace's project row and controls. */
export function CompactWorkspaceHeader({
  isLoading,
  title,
  subtitle,
  onToggleExplorer,
  explorerToggleLabel,
  explorerToggleAccessibilityState,
  children,
  tabSwitcher,
  serverId,
  headerVariant,
  actionsActive,
}: CompactWorkspaceHeaderProps) {
  const { t } = useTranslation();
  const actionsInBar = resolveWorkspaceActionPlacement(useWindowLayout()) === "vertical-bar";
  const isGridCell = useWorkspaceGridCell() !== null;
  const projectRow = useMemo(
    () => <WorkspaceHeaderProjectRow subtitle={subtitle} serverId={serverId} />,
    [subtitle, serverId],
  );
  const symbols = {
    "tab-count": tabSwitcher,
    overflow: children,
    explorer: (
      <WorkspaceExplorerToggle
        onPress={onToggleExplorer}
        label={explorerToggleLabel}
        tooltipLabel={t("workspace.tabs.explorerSidebar.toggle")}
        tooltipKeys={EXPLORER_TOGGLE_KEYS}
        accessibilityState={explorerToggleAccessibilityState}
        mobile
      />
    ),
  };
  const actions = resolveWorkspaceBarActions(headerVariant).map((symbol) => (
    <Fragment key={symbol}>{symbols[symbol]}</Fragment>
  ));

  // A cell narrower than the compact threshold still needs its maximize control, and the
  // vertical bar only carries the workspace actions, not the cell's.
  const barActions = actionsInBar ? undefined : actions;
  const headerActions = isGridCell ? (
    <>
      {barActions}
      <GridCellMaximizeButton />
    </>
  ) : (
    barActions
  );

  return (
    <IconButtonChromeProvider value="header-island">
      {headerVariant === "compact" ? (
        <CompactHeader
          navigation="menu"
          title={title}
          titleTestID="workspace-header-title"
          subtitle={projectRow}
          loading={isLoading}
          actions={headerActions}
        />
      ) : null}
      <WindowLayoutActions active={actionsActive}>{actions}</WindowLayoutActions>
    </IconButtonChromeProvider>
  );
}
