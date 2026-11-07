import { useCallback, useMemo, useState, type ReactElement, type RefObject } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  Combobox,
  ComboboxItem,
  type ComboboxOption,
  type ComboboxProps,
} from "@/components/ui/combobox";
import { filterComboboxOptionsInOrder } from "@/components/ui/combobox-options";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import { useSidebarWorkspacePinController } from "@/hooks/use-sidebar-workspace-pin";
import { usePinnedSidebarKeys } from "@/hooks/use-sidebar-pins";
import { shouldShowSidebarHostLabels } from "@/hooks/sidebar-workspaces-view-model";
import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import { useHostBadges } from "@/hosts/use-host-badges";
import { buildAddPinOptions, resolveGroupStarts } from "./add-pin-options";

type RenderOption = NonNullable<ComboboxProps["renderOption"]>;

// Every host takes part: the grid holds pins from all hosts, so a sidebar host filter does not
// narrow what can be pinned here.
const ALL_HOSTS: readonly string[] = [];

interface AddPinPickerProps {
  anchorRef: RefObject<View | null>;
  onClose: () => void;
  /** Called with the workspace key once the pin request has been sent. */
  onPicked: (workspaceKey: string) => void;
}

/**
 * The anchored list behind the "+" cell. It reads the sidebar workspace list, so it mounts only
 * while it is open: the list hook keeps its subscription and projection running while mounted.
 */
export function AddPinPicker({ anchorRef, onClose, onPicked }: AddPinPickerProps): ReactElement {
  const { t } = useTranslation();
  const { projects } = useSidebarWorkspacesList({ hostFilters: ALL_HOSTS });
  const { pinnedWorkspaceKeys } = usePinnedSidebarKeys(projects);
  const rowItems = useSidebarRowItems();
  const hostBadgeByServerId = useHostBadges({
    enabled: rowItems.host && shouldShowSidebarHostLabels(projects),
  });
  const togglePin = useSidebarWorkspacePinController();
  const [query, setQuery] = useState("");

  const { options, groupLabelById, workspaceByKey } = useMemo(() => {
    const hostLabelByServerId = new Map<string, string>();
    for (const [serverId, badge] of hostBadgeByServerId) {
      hostLabelByServerId.set(serverId, badge.label);
    }
    return buildAddPinOptions({
      projects,
      pinnedKeys: pinnedWorkspaceKeys,
      hostLabelByServerId,
    });
  }, [hostBadgeByServerId, pinnedWorkspaceKeys, projects]);

  const groupStarts = useMemo(
    () =>
      resolveGroupStarts(
        filterComboboxOptionsInOrder(options, query.trim().toLowerCase()),
        groupLabelById,
      ),
    [groupLabelById, options, query],
  );

  const handleSelect = useCallback(
    (workspaceKey: string) => {
      const target = workspaceByKey.get(workspaceKey);
      if (!target) return;
      togglePin({ ...target, workspaceKey, pinnedAt: null });
      onClose();
      onPicked(workspaceKey);
    },
    [onClose, onPicked, togglePin, workspaceByKey],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  const renderOption = useCallback<RenderOption>(
    ({ option, active, onPress }) => (
      <AddPinOptionRow
        option={option}
        active={active}
        groupLabel={groupStarts.has(option.id) ? groupLabelById.get(option.id) : undefined}
        onPress={onPress}
      />
    ),
    [groupLabelById, groupStarts],
  );

  return (
    <Combobox
      open
      onOpenChange={handleOpenChange}
      anchorRef={anchorRef}
      options={options}
      value=""
      onSelect={handleSelect}
      renderOption={renderOption}
      onSearchQueryChange={setQuery}
      preserveOptionOrder
      searchable
      searchPlaceholder={t("workspace.gridCell.addPin.searchPlaceholder")}
      emptyText={
        query.trim().length > 0
          ? t("workspace.gridCell.addPin.noMatch")
          : t("workspace.gridCell.addPin.allPinned")
      }
      desktopPlacement="bottom-start"
    />
  );
}

function AddPinOptionRow({
  option,
  active,
  groupLabel,
  onPress,
}: {
  option: ComboboxOption;
  active: boolean;
  groupLabel: string | undefined;
  onPress: () => void;
}): ReactElement {
  return (
    <View>
      {groupLabel ? (
        <Text style={styles.groupLabel} numberOfLines={1}>
          {groupLabel}
        </Text>
      ) : null}
      <ComboboxItem
        label={option.label}
        description={option.description}
        active={active}
        onPress={onPress}
        testID={`pinned-grid-add-option-${option.id}`}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  groupLabel: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
}));
