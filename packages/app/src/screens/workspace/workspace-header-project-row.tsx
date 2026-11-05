import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HostBadge } from "@/hosts/host-badge";
import { useHostBadges } from "@/hosts/use-host-badges";
import { useWorkspaceGridCell } from "@/pinned-grid/grid-cell-context";

/**
 * Which project the workspace belongs to, and which machine it runs on.
 *
 * Compact gets both, on their own line under the workspace name: this header is the only thing on
 * screen that says where the workspace lives, because the sidebar that normally carries the host
 * badge is closed. It still follows the host's own badge setting, so a purely local setup stays
 * quiet. A project name that only repeats the workspace name is dropped on wide, where the two sit
 * side by side, and kept on compact, where the line exists for the host anyway.
 */
export function WorkspaceHeaderProjectRow({
  subtitle,
  isSubtitleDistinct,
  serverId,
}: {
  subtitle: string;
  isSubtitleDistinct: boolean;
  serverId: string;
}) {
  const isCompact = useIsCompactFormFactor();
  const gridCell = useWorkspaceGridCell();
  // A grid cell has no project group above it, so its header always names the project and host.
  const isGridCell = gridCell !== null;
  const hostBadge = useHostBadges({ enabled: isCompact || isGridCell }).get(serverId) ?? null;
  const showProject = isSubtitleDistinct || isCompact || isGridCell;
  if (!showProject && !hostBadge) {
    return null;
  }
  return (
    <View style={styles.row}>
      {showProject ? (
        <Text
          testID="workspace-header-subtitle"
          style={gridCell?.showProjectBadge ? styles.projectBadge : styles.project}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      ) : null}
      {showProject && hostBadge ? <Text style={styles.separator}>·</Text> : null}
      {hostBadge ? <HostBadge badge={hostBadge} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The compact header stretches this row to its available title width. Within that width,
  // the project truncates and HostBadge yields its label while retaining its fixed icon.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
    flexShrink: 1,
  },
  project: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.sm,
      md: theme.fontSize.base,
    },
    flexShrink: 1,
    minWidth: 0,
  },
  projectBadge: {
    color: theme.colors.accentForeground,
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[1.5],
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  separator: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
}));
