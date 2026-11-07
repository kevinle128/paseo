import { memo, useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleAlert } from "lucide-react-native";
import { HostBadge } from "@/hosts/host-badge";
import { useHostBadges } from "@/hosts/use-host-badges";
import { resolveWorkspaceHeader } from "@/screens/workspace/workspace-header-source";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { prepareWorkspaceTab } from "@/utils/workspace-navigation";
import {
  deriveDormantCellState,
  type DormantCellAgent,
  type DormantCellPlacement,
  type DormantCellState,
} from "./dormant-cell-state";
import type { GridCellRect } from "./geometry";
import { useCellTimelineSuspension } from "./use-cell-timeline-suspension";

const ThemedCircleAlert = withUnistyles(CircleAlert, (theme) => ({
  color: getStatusDotColor({ theme, bucket: "needs_input" }) ?? theme.colors.foreground,
}));

function* dormantAgentsOf(agents: ReadonlyMap<string, Agent>): Generator<DormantCellAgent> {
  for (const agent of agents.values()) {
    yield {
      id: agent.id,
      workspaceId: agent.workspaceId,
      archivedAt: agent.archivedAt,
      status: agent.status,
      turnOpen: agent.turn.phase === "open",
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
      backgroundWork: agent.backgroundWork,
    };
  }
}

interface DormantCellSummaryProps {
  serverId: string;
  workspaceId: string;
  rect: GridCellRect;
  /** Returns true when the call moved focus to this cell. */
  onFocusCell: (key: string) => boolean;
}

/**
 * Stands in for a pinned cell that has no mounted workspace. It reads light data only (the
 * workspace descriptor and agent states) and holds no timeline subscription. A click focuses the
 * cell and, when an agent waits for the user, opens that agent's tab first.
 */
export const DormantCellSummary = memo(function DormantCellSummary({
  serverId,
  workspaceId,
  rect,
  onFocusCell,
}: DormantCellSummaryProps) {
  // A cell that was dropped from the mounted set before it could suspend itself must not keep
  // streaming its chats.
  useCellTimelineSuspension({ serverId, workspaceId, suspended: true });
  const workspace = useSessionStore(
    (state) => state.sessions[serverId]?.workspaces.get(workspaceId) ?? null,
  );
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const hostBadge = useHostBadges({ enabled: true }).get(serverId) ?? null;
  const dormantState = useMemo<DormantCellState>(
    () => deriveDormantCellState(agents ? dormantAgentsOf(agents) : [], workspaceId),
    [agents, workspaceId],
  );
  const header = workspace ? resolveWorkspaceHeader({ workspace }) : null;
  const needsInput = dormantState.bucket === "needs_input";

  const handlePress = useCallback(() => {
    if (dormantState.attentionAgentId) {
      prepareWorkspaceTab({
        serverId,
        workspaceId,
        target: { kind: "agent", agentId: dormantState.attentionAgentId },
      });
    }
    onFocusCell(`${serverId}:${workspaceId}`);
  }, [dormantState.attentionAgentId, onFocusCell, serverId, workspaceId]);

  const style = useMemo(
    () => [
      styles.card,
      needsInput ? styles.cardNeedsInput : null,
      { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
    ],
    [needsInput, rect.height, rect.width, rect.x, rect.y],
  );

  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityLabel={header?.title ?? workspaceId}
      onPress={handlePress}
      style={style}
      testID={`pinned-grid-dormant-${serverId}:${workspaceId}`}
    >
      <View style={styles.titleRow}>
        {needsInput ? (
          <ThemedCircleAlert size={18} testID="dormant-cell-needs-input" />
        ) : (
          <StateDot bucket={dormantState.bucket} />
        )}
        <Text style={styles.title} numberOfLines={1}>
          {header?.title ?? workspaceId}
        </Text>
      </View>
      <View style={styles.metaRow}>
        {header?.subtitle ? (
          <Text style={styles.meta} numberOfLines={1}>
            {header.subtitle}
          </Text>
        ) : null}
        {hostBadge ? <HostBadge badge={hostBadge} /> : null}
      </View>
    </PressHighlight>
  );
});

function StateDot({ bucket }: { bucket: DormantCellState["bucket"] }) {
  const style = useMemo(() => [styles.dot, dotStyleFor(bucket)], [bucket]);
  return <View style={style} testID={`dormant-cell-state-${bucket}`} />;
}

function dotStyleFor(bucket: DormantCellState["bucket"]) {
  switch (bucket) {
    case "failed":
      return styles.dotFailed;
    case "running":
      return styles.dotRunning;
    case "attention":
      return styles.dotAttention;
    default:
      return styles.dotIdle;
  }
}

const styles = StyleSheet.create((theme) => ({
  card: {
    position: "absolute",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  cardNeedsInput: {
    borderWidth: 2,
    borderColor: theme.colors.statusDotWarning,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  title: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
  },
  meta: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotIdle: { backgroundColor: theme.colors.border },
  dotFailed: { backgroundColor: theme.colors.statusDotDanger },
  dotRunning: { backgroundColor: theme.colors.statusDotRunning },
  dotAttention: { backgroundColor: theme.colors.statusDotSuccess },
}));

/** A card for every grid cell that has no mounted workspace. */
export function DormantCellLayer({
  placements,
  onFocusCell,
}: {
  placements: readonly DormantCellPlacement<GridCellRect>[];
  onFocusCell: (key: string) => boolean;
}) {
  return placements.map((placement) => (
    <DormantCellSummary
      key={`${placement.serverId}:${placement.workspaceId}`}
      serverId={placement.serverId}
      workspaceId={placement.workspaceId}
      rect={placement.rect}
      onFocusCell={onFocusCell}
    />
  ));
}
