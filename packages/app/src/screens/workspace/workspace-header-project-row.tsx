import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ProjectTag } from "@/components/project-tag";
import { HostBadge } from "@/hosts/host-badge";
import { useHostBadges } from "@/hosts/use-host-badges";
import { useWorkspaceGridCell } from "@/pinned-grid/grid-cell-context";

/**
 * Which project the workspace belongs to, and which machine it runs on, on the compact header.
 *
 * Both sit on their own line under the workspace name: this header is the only thing on screen
 * that says where the workspace lives, because the sidebar that normally carries the host badge is
 * closed. It still follows the host's own badge setting, so a purely local setup stays quiet.
 */
export function WorkspaceHeaderProjectRow({
  subtitle,
  serverId,
}: {
  subtitle: string;
  serverId: string;
}) {
  const hostBadge = useHostBadges({ enabled: true }).get(serverId) ?? null;
  return (
    <View style={styles.row}>
      <Text testID="workspace-header-subtitle" style={styles.project} numberOfLines={1}>
        {subtitle}
      </Text>
      {hostBadge ? <Text style={styles.separator}>·</Text> : null}
      {hostBadge ? <HostBadge badge={hostBadge} /> : null}
    </View>
  );
}

/**
 * The project tag that leads the workspace title on the wide header. A project name that only
 * repeats the workspace name is dropped, except in a grid cell: a cell has no project group above
 * it, so its header always names the project.
 */
export function WorkspaceHeaderProjectTag({
  subtitle,
  isSubtitleDistinct,
}: {
  subtitle: string;
  isSubtitleDistinct: boolean;
}) {
  const isGridCell = useWorkspaceGridCell() !== null;
  if (!isSubtitleDistinct && !isGridCell) {
    return null;
  }
  return <ProjectTag name={subtitle} testID="workspace-header-subtitle" />;
}

/**
 * The host badge after the workspace title on the wide header. Only a grid cell shows it: in
 * Normal mode the sidebar row next to the header already carries it.
 */
export function WorkspaceHeaderHostBadge({ serverId }: { serverId: string }) {
  const isGridCell = useWorkspaceGridCell() !== null;
  const hostBadge = useHostBadges({ enabled: isGridCell }).get(serverId) ?? null;
  return hostBadge ? <HostBadge badge={hostBadge} /> : null;
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
  separator: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
}));
