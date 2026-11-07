import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { GridCellRect } from "./geometry";

interface GridDropIndicatorProps {
  rect: GridCellRect;
}

/** Outlines the slot the dragged cell would take when dropped. It never takes pointer events. */
export function GridDropIndicator({ rect }: GridDropIndicatorProps) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.indicator,
        { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
      ]}
      testID="pinned-grid-drop-indicator"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  indicator: {
    position: "absolute",
    borderRadius: theme.borderRadius.md,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: theme.colors.accent,
    backgroundColor: `color-mix(in srgb, ${theme.colors.accent} 8%, transparent)`,
  },
}));
