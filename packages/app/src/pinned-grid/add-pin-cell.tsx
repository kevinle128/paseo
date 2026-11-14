import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Plus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { isNative } from "@/constants/platform";
import { DensityIcon } from "@/components/ui/density-icon";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { GridCellRect } from "./geometry";
import { AddPinPicker } from "./add-pin-picker";
import { useGridScrollSignalSource } from "./grid-scroll-signal";

const ANCHOR_WIDTH = 320;

interface AddPinCellProps {
  rect: GridCellRect;
  /** The tile stays mounted while a cell is maximized, hidden. It closes its picker then. */
  hidden: boolean;
  /** Called with the workspace key the user picked. */
  onPicked: (workspaceKey: string) => void;
}

/**
 * The last slot of the pinned grid. A press opens a picker of unpinned workspaces anchored to
 * the tile. It draws nothing on native, where the grid does not exist.
 */
export const AddPinCell = memo(function AddPinCell({
  rect,
  hidden,
  onPicked,
}: AddPinCellProps): ReactElement | null {
  const { t } = useTranslation();
  const anchorRef = useRef<View | null>(null);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  const scrollSignal = useGridScrollSignalSource();

  // The popover is positioned once, when it opens. A grid that scrolls would leave it behind the
  // tile, so scrolling closes it like other dropdowns. A change of the cell list (a pin made on
  // another device) leaves it open, so the user keeps the search they typed.
  useEffect(() => {
    if (!open || !scrollSignal) {
      return undefined;
    }
    return scrollSignal.subscribe((reason) => {
      if (reason === "scroll") {
        setOpen(false);
      }
    });
  }, [open, scrollSignal]);

  useEffect(() => {
    if (hidden) {
      setOpen(false);
    }
  }, [hidden]);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);

  if (isNative) return null;

  const label = t("workspace.gridCell.addPin.label");
  const rectStyle = { left: rect.x, top: rect.y, width: rect.width, height: rect.height };

  return (
    <View
      style={[styles.tile, rectStyle]}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <PressHighlight
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="pinned-grid-add-cell"
        onPress={handleOpen}
        style={[styles.press, hovered && styles.pressHovered, open && styles.pressHovered]}
      >
        <DensityIcon icon={Plus} size="lg" color="foregroundMuted" />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </PressHighlight>
      {/* The picker hangs from the top of the tile. A tile in the last visible row would put a
          popover below its bottom edge outside the window, and web does not flip popovers. */}
      <View ref={anchorRef} pointerEvents="none" style={styles.anchor} />
      {open ? (
        <AddPinPicker anchorRef={anchorRef} onClose={handleClose} onPicked={onPicked} />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  tile: {
    position: "absolute",
  },
  anchor: {
    position: "absolute",
    top: theme.spacing[4],
    left: "50%",
    width: ANCHOR_WIDTH,
    marginLeft: -ANCHOR_WIDTH / 2,
    height: 1,
  },
  press: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
  },
  pressHovered: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
