import { useCallback, useMemo } from "react";
import { Columns2, Columns3, Square } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { usePinnedGridPreferences } from "./use-pinned-grid-preferences";
import type { PinnedGridMode } from "./preferences";

type IconRenderer = (props: { color: string; size: number }) => React.ReactElement;

const renderSquare: IconRenderer = ({ color, size }) => <Square color={color} size={size} />;
const renderColumns2: IconRenderer = ({ color, size }) => <Columns2 color={color} size={size} />;
const renderColumns3: IconRenderer = ({ color, size }) => <Columns3 color={color} size={size} />;

/**
 * Normal / 2 columns / 3 columns switch for the sidebar Pinned header. Picking a mode only
 * stores the preference; the workspace area reacts to it without navigation. The grid exists on
 * wide web layouts only, so the control renders nothing elsewhere.
 */
export function PinnedGridModeControl() {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const { preferences, updatePreferences } = usePinnedGridPreferences();

  const options = useMemo<SegmentedControlOption<PinnedGridMode>[]>(
    () => [
      {
        value: "normal",
        label: t("sidebar.pinned.gridMode.normal"),
        tooltip: t("sidebar.pinned.gridMode.normal"),
        icon: renderSquare,
        testID: "sidebar-pinned-grid-mode-normal",
      },
      {
        value: "2",
        label: t("sidebar.pinned.gridMode.twoColumns"),
        tooltip: t("sidebar.pinned.gridMode.twoColumns"),
        icon: renderColumns2,
        testID: "sidebar-pinned-grid-mode-2",
      },
      {
        value: "3",
        label: t("sidebar.pinned.gridMode.threeColumns"),
        tooltip: t("sidebar.pinned.gridMode.threeColumns"),
        icon: renderColumns3,
        testID: "sidebar-pinned-grid-mode-3",
      },
    ],
    [t],
  );

  const handleValueChange = useCallback(
    (mode: PinnedGridMode) => {
      void updatePreferences({ mode });
    },
    [updatePreferences],
  );

  if (!isWeb || isCompact) return null;

  return (
    <SegmentedControl
      options={options}
      value={preferences.mode}
      onValueChange={handleValueChange}
      size="xs"
      hideLabels
      testID="sidebar-pinned-grid-mode"
    />
  );
}
