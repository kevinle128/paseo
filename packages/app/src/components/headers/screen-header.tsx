import { ComposerDockBackground } from "@/composer/dock";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { LayoutChangeEvent } from "react-native";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { WindowChromeSafeArea } from "@/utils/desktop-window";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { isWeb } from "@/constants/platform";
import { useWorkspaceGridCell } from "@/pinned-grid/grid-cell-context";

// Controls the header double-click must leave alone, so a double-click on a button does nothing.
const HEADER_INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';

interface ScreenHeaderProps {
  left?: ReactNode;
  right?: ReactNode;
  leftStyle?: StyleProp<ViewStyle>;
  rightStyle?: StyleProp<ViewStyle>;
  borderless?: boolean;
  onRowLayout?: (event: LayoutChangeEvent) => void;
}

/**
 * Shared frame for the home/back headers so we only maintain padding, border,
 * and safe-area logic in one place.
 */
export function ScreenHeader({
  left,
  right,
  leftStyle,
  rightStyle,
  borderless,
  onRowLayout,
}: ScreenHeaderProps) {
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const isMobile = useIsCompactFormFactor();
  const gridCell = useWorkspaceGridCell();
  const toggleMaximize = gridCell?.toggleMaximize ?? null;
  const innerRef = useRef<View | null>(null);

  // A grid cell header maximizes the cell on double-click. Native handlers cannot see nested
  // controls, so the DOM listener skips targets inside interactive elements.
  useEffect(() => {
    const node: unknown = innerRef.current;
    if (!isWeb || !toggleMaximize || !(node instanceof HTMLElement)) {
      return undefined;
    }
    const handleDoubleClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(HEADER_INTERACTIVE_SELECTOR)) {
        return;
      }
      toggleMaximize();
    };
    node.addEventListener("dblclick", handleDoubleClick);
    return () => node.removeEventListener("dblclick", handleDoubleClick);
  }, [toggleMaximize]);

  // Only add extra padding on mobile for better touch targets; on desktop, only use safe area insets
  const topPadding = isMobile ? HEADER_TOP_PADDING_MOBILE : 0;
  const baseHorizontalPadding = isMobile ? theme.spacing[2] : theme.spacing[3];

  const innerStyle = useMemo(
    () => [styles.inner, { paddingTop: insets.top + topPadding }],
    [insets.top, topPadding],
  );
  const rowStyle = useMemo(() => [styles.row, borderless && styles.borderless], [borderless]);
  const headerStyle = useMemo(
    () => [styles.header, gridCell?.isFocused && styles.headerFocusedCell],
    [gridCell?.isFocused],
  );
  const leftCombinedStyle = useMemo(() => [styles.left, leftStyle], [leftStyle]);
  const rightCombinedStyle = useMemo(() => [styles.right, rightStyle], [rightStyle]);

  return (
    <ComposerDockBackground style={headerStyle} testID="composer-dock-header">
      <View ref={innerRef} style={innerStyle}>
        <WindowChromeSafeArea
          placement="inline"
          horizontalPadding={baseHorizontalPadding}
          onLayout={onRowLayout}
          style={rowStyle}
        >
          {gridCell ? null : <TitlebarDragRegion />}
          <View style={leftCombinedStyle}>{left}</View>
          <View style={rightCombinedStyle}>{right}</View>
        </WindowChromeSafeArea>
      </View>
    </ComposerDockBackground>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    backgroundColor: theme.colors.surface0,
  },
  headerFocusedCell: {
    backgroundColor: `color-mix(in srgb, ${theme.colors.accent} 10%, ${theme.colors.surface0})`,
  },
  inner: {},
  row: {
    position: "relative",
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    userSelect: "none",
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  borderless: {
    borderBottomColor: "transparent",
  },
}));
