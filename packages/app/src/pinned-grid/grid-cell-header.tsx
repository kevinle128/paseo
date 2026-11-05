import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, Minimize2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { SidebarMenuToggle } from "@/components/headers/sidebar-menu-toggle";
import {
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useWorkspaceGridCell } from "./grid-cell-context";

const ThemedMaximize = withUnistyles(Maximize2);
const ThemedMinimize = withUnistyles(Minimize2);
const NO_SHORTCUT_KEYS: ShortcutKey[] = [];
const MAXIMIZED_STATE = { expanded: true };
const RESTORED_STATE = { expanded: false };

/** The workspace header's sidebar toggle. A grid cell has no toggle: the sidebar is not the cell's. */
export function WorkspaceHeaderSidebarToggle(): ReactElement | null {
  const cell = useWorkspaceGridCell();
  return cell ? null : <SidebarMenuToggle />;
}

/** Maximize or restore button for the cell header. Renders nothing in Normal mode. */
export function GridCellMaximizeButton(): ReactElement | null {
  const { t } = useTranslation();
  const cell = useWorkspaceGridCell();
  const shortcutKeys = useShortcutKeys("toggle-cell-maximize")?.[0] ?? NO_SHORTCUT_KEYS;
  if (!cell) {
    return null;
  }
  const label = cell.isMaximized
    ? t("workspace.gridCell.restore")
    : t("workspace.gridCell.maximize");
  const Icon = cell.isMaximized ? ThemedMinimize : ThemedMaximize;
  return (
    <HeaderToggleButton
      onPress={cell.toggleMaximize}
      tooltipLabel={label}
      tooltipKeys={shortcutKeys}
      tooltipSide="bottom"
      testID="workspace-grid-cell-maximize"
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={cell.isMaximized ? MAXIMIZED_STATE : RESTORED_STATE}
      style={styles.button}
    >
      <Icon
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={mutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}

const styles = StyleSheet.create(() => ({
  button: {},
}));
