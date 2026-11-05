import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isNative } from "@/constants/platform";
import { WindowChromeRegion } from "@/utils/desktop-window";
import { createPointerFocusClaim } from "./cell-press-guard";
import { WorkspaceGridCellProvider, type WorkspaceGridCell } from "./grid-cell-context";
import type { GridCellRect } from "./geometry";

type ChromeCorners = "both" | "top-left" | "top-right" | "none";

interface GridCellFrameProps {
  cellKey: string;
  /** True when the pinned grid shows and this entry is one of its cells. */
  isCell: boolean;
  /** Whether the entry is on screen. Hidden entries keep their place but draw nothing. */
  isVisible: boolean;
  rect: GridCellRect | null;
  isFocused: boolean;
  isMaximized: boolean;
  /** Other cells dim when more than one cell shows. */
  dimmed: boolean;
  chromeCorners: ChromeCorners;
  /** Returns true when the call moved focus to this cell. */
  onFocusCell: (key: string) => boolean;
  onToggleMaximize: (key: string) => void;
  children: ReactNode;
}

/**
 * The one stable wrapper of a deck entry. Normal mode gives it `flex: 1` (or hides it); the grid
 * gives it an absolute rect. Only its style differs, so the workspace inside never remounts when
 * the presentation changes.
 */
export const GridCellFrame = memo(function GridCellFrame({
  cellKey,
  isCell,
  isVisible,
  rect,
  isFocused,
  isMaximized,
  dimmed,
  chromeCorners,
  onFocusCell,
  onToggleMaximize,
  children,
}: GridCellFrameProps) {
  const frameRef = useRef<View | null>(null);
  const claim = useMemo(() => createPointerFocusClaim(), []);
  const [hovered, setHovered] = useState(false);
  const isCellRef = useRef(isCell);
  isCellRef.current = isCell;
  const onFocusCellRef = useRef(onFocusCell);
  onFocusCellRef.current = onFocusCell;

  // Focus moves in capture phase and without preventDefault: the click still reaches its target.
  useEffect(() => {
    const node: unknown = frameRef.current;
    if (isNative || !(node instanceof HTMLElement)) {
      return undefined;
    }
    // The gesture can end outside the cell, so its end is listened for on the window.
    const handlePointerEnd = () => {
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
      claim.pointerEnd();
      // Releasing on a timer lets the press that belongs to this gesture read the claim first.
      setTimeout(() => claim.release(), 0);
    };
    const handlePointerDown = () => {
      if (!isCellRef.current) {
        return;
      }
      claim.pointerDown(onFocusCellRef.current(cellKey));
      window.addEventListener("pointerup", handlePointerEnd, true);
      window.addEventListener("pointercancel", handlePointerEnd, true);
    };
    const handleKeyDown = () => claim.keyDown();
    const handleFocusIn = () => {
      if (isCellRef.current) {
        onFocusCellRef.current(cellKey);
      }
    };
    node.addEventListener("pointerdown", handlePointerDown, true);
    node.addEventListener("keydown", handleKeyDown, true);
    node.addEventListener("focusin", handleFocusIn, true);
    return () => {
      node.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
      node.removeEventListener("keydown", handleKeyDown, true);
      node.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [cellKey, claim]);

  // DOM focus can only sit in a cell that is not focused after the route moved away from it
  // (a sidebar click), because any focus inside a cell focuses that cell. Typed characters follow
  // the DOM focus, so release it instead of letting keys reach a previous cell, maybe on another host.
  useEffect(() => {
    const node: unknown = frameRef.current;
    if (isFocused || !isCell || isNative || !(node instanceof HTMLElement)) {
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && node.contains(active)) {
      active.blur();
    }
  }, [isCell, isFocused]);

  const focusCell = useCallback(() => {
    onFocusCell(cellKey);
  }, [cellKey, onFocusCell]);
  const toggleMaximize = useCallback(() => onToggleMaximize(cellKey), [cellKey, onToggleMaximize]);
  const cellValue = useMemo<WorkspaceGridCell | null>(
    () =>
      isCell
        ? {
            isFocused,
            isMaximized,
            showProjectBadge: true,
            toggleMaximize,
            focusCell,
            pointerFocusClaim: claim,
          }
        : null,
    [claim, focusCell, isCell, isFocused, isMaximized, toggleMaximize],
  );

  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);

  const rectStyle = useMemo(
    () =>
      rect ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height } : undefined,
    [rect],
  );
  const frameStyle = useMemo(
    () => [rect ? styles.cell : styles.single, !isVisible && styles.hidden, rectStyle],
    [isVisible, rect, rectStyle],
  );
  const ringStyle = useMemo(
    () => [styles.ring, isFocused && !isMaximized ? styles.ringFocused : styles.ringIdle],
    [isFocused, isMaximized],
  );
  const dimStyle = useMemo(
    () => [styles.dim, hovered ? styles.dimHovered : styles.dimResting],
    [hovered],
  );

  // The grid exists on web only. Native keeps the retained panel as the direct child of the entry:
  // `RetainedPanel` is the stable, non-collapsible native root, and an extra flattenable View
  // above it could reparent native descendants when visibility changes. `isNative` never changes
  // at runtime, so the tree shape stays stable.
  if (isNative) {
    return children;
  }

  return (
    <WindowChromeRegion corners={chromeCorners}>
      <WorkspaceGridCellProvider value={cellValue}>
        <View
          ref={frameRef}
          style={frameStyle}
          testID={isCell ? `pinned-grid-cell-${cellKey}` : undefined}
          onPointerEnter={isCell ? handlePointerEnter : undefined}
          onPointerLeave={isCell ? handlePointerLeave : undefined}
        >
          {children}
          {isCell && dimmed && !isFocused ? <View pointerEvents="none" style={dimStyle} /> : null}
          {isCell ? (
            <View
              pointerEvents="none"
              style={ringStyle}
              testID={isFocused ? "pinned-grid-focus-ring" : undefined}
            />
          ) : null}
        </View>
      </WorkspaceGridCellProvider>
    </WindowChromeRegion>
  );
});

const styles = StyleSheet.create((theme) => ({
  single: {
    flex: 1,
  },
  cell: {
    position: "absolute",
    overflow: "hidden",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface0,
  },
  hidden: {
    display: "none",
  },
  dim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    backgroundColor: theme.colors.surface0,
  },
  dimResting: {
    opacity: 0.45,
  },
  dimHovered: {
    opacity: 0.15,
  },
  ring: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 21,
    borderRadius: theme.borderRadius.md,
  },
  ringIdle: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  ringFocused: {
    borderWidth: 2,
    borderColor: theme.colors.accent,
    boxShadow: `inset 0 0 16px color-mix(in srgb, ${theme.colors.accent} 35%, transparent)`,
  },
}));
