import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isNative } from "@/constants/platform";
import { BROWSER_SURFACES_HELD_ATTRIBUTE } from "@/desktop/browser/resident-webviews";
import { WindowChromeRegion } from "@/utils/desktop-window";
import { createPointerFocusClaim } from "./cell-press-guard";
import type { GridCellRect } from "./geometry";
import { WorkspaceGridCellProvider, type WorkspaceGridCell } from "./grid-cell-context";
import { useGridScrollSignalSource } from "./grid-scroll-signal";
import { useCellMotion } from "./use-cell-motion";

type ChromeCorners = "both" | "top-left" | "top-right" | "none";

// DOM node of every mounted cell frame, so keyboard navigation can put focus on a frame.
const frameNodes = new Map<string, HTMLElement>();

/** Moves DOM focus to the frame of a cell. Returns false when the frame is not mounted. */
export function focusGridCellFrame(key: string): boolean {
  const node = frameNodes.get(key);
  if (!node) {
    return false;
  }
  node.focus({ preventScroll: true });
  return true;
}

/** Moves DOM focus to the frame that contains `inner`. Returns false when no frame does. */
export function focusGridCellFrameContaining(inner: Node | null): boolean {
  if (!inner) {
    return false;
  }
  for (const node of frameNodes.values()) {
    if (node.contains(inner)) {
      node.focus({ preventScroll: true });
      return true;
    }
  }
  return false;
}

interface GridCellFrameProps {
  cellKey: string;
  /** True when the pinned grid shows and this entry is one of its cells. */
  isCell: boolean;
  /** Whether the entry is on screen. Hidden entries keep their place but draw nothing. */
  isVisible: boolean;
  rect: GridCellRect | null;
  isFocused: boolean;
  isMaximized: boolean;
  /** Another cell is maximized. This cell fades out and, when the grid returns, fades in. */
  underMaximized?: boolean;
  /**
   * The cell was on screen when another cell was maximized. While it is not visible it keeps its
   * layout and is hidden without `display: none`, so the restore does not lay it out again.
   */
  parked?: boolean;
  /** Other cells dim when more than one cell shows. */
  dimmed: boolean;
  chromeCorners: ChromeCorners;
  /** Workspace title that assistive technology announces when the cell frame takes focus. */
  label?: string;
  /** Returns true when the call moved focus to this cell. */
  onFocusCell: (key: string) => boolean;
  onToggleMaximize: (key: string) => void;
  /** Starts a header drag for this cell. The cell cannot be reordered when missing. */
  onHeaderDragStart?: (key: string, event: PointerEvent, node: HTMLElement) => void;
  /** The cell being dragged. It draws above the other cells. */
  isDragSource?: boolean;
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
  underMaximized = false,
  parked = false,
  dimmed,
  chromeCorners,
  label,
  onFocusCell,
  onToggleMaximize,
  onHeaderDragStart,
  isDragSource = false,
  children,
}: GridCellFrameProps) {
  const frameRef = useRef<View | null>(null);
  const claim = useMemo(() => createPointerFocusClaim(), []);
  const [hovered, setHovered] = useState(false);
  const isCellRef = useRef(isCell);
  isCellRef.current = isCell;
  const onFocusCellRef = useRef(onFocusCell);
  onFocusCellRef.current = onFocusCell;

  const scrollSignal = useGridScrollSignalSource();
  const { layoutRect, isMoving } = useCellMotion({
    frameRef,
    scrollSignal,
    isCell,
    isVisible,
    rect,
    isMaximized,
    underMaximized,
  });

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

  // A cell frame takes DOM focus (not tab order) so that, after Escape leaves the composer, the
  // next key still reaches the shortcut pipeline inside the focused cell.
  useEffect(() => {
    const node: unknown = frameRef.current;
    if (!isCell || isNative || !(node instanceof HTMLElement)) {
      return undefined;
    }
    node.tabIndex = -1;
    node.style.outline = "none";
    frameNodes.set(cellKey, node);
    return () => {
      node.removeAttribute("tabindex");
      node.style.outline = "";
      if (frameNodes.get(cellKey) === node) {
        frameNodes.delete(cellKey);
      }
    };
  }, [cellKey, isCell]);

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

  // `visibility` hides the parked cell and `content-visibility` skips its layout and paint while
  // keeping the layout it has. Set on the node: React Native style types have no
  // `contentVisibility`. The layout effect clears both before the restore paints.
  // The workspace of a parked cell stays presented, so its Electron webviews do not park on their
  // own. They are fixed-position and `visibility` does not reach them: the held attribute hides
  // them, and the `layout` signal places them again at once.
  const isParkedHidden = parked && !isVisible;
  useLayoutEffect(() => {
    const node: unknown = frameRef.current;
    if (!isParkedHidden || !(node instanceof HTMLElement)) {
      return undefined;
    }
    node.style.visibility = "hidden";
    node.style.contentVisibility = "hidden";
    node.setAttribute(BROWSER_SURFACES_HELD_ATTRIBUTE, "");
    scrollSignal?.notify("layout");
    return () => {
      node.style.visibility = "";
      node.style.contentVisibility = "";
      node.removeAttribute(BROWSER_SURFACES_HELD_ATTRIBUTE);
      scrollSignal?.notify("layout");
    };
  }, [isParkedHidden, scrollSignal]);

  const focusCell = useCallback(() => {
    onFocusCell(cellKey);
  }, [cellKey, onFocusCell]);
  const toggleMaximize = useCallback(() => onToggleMaximize(cellKey), [cellKey, onToggleMaximize]);
  const beginHeaderDrag = useMemo(() => {
    if (!onHeaderDragStart) {
      return null;
    }
    return (event: PointerEvent) => {
      const node: unknown = frameRef.current;
      if (node instanceof HTMLElement) {
        onHeaderDragStart(cellKey, event, node);
      }
    };
  }, [cellKey, onHeaderDragStart]);
  const cellValue = useMemo<WorkspaceGridCell | null>(
    () =>
      isCell
        ? {
            isFocused,
            isMaximized,
            toggleMaximize,
            focusCell,
            pointerFocusClaim: claim,
            beginHeaderDrag,
          }
        : null,
    [beginHeaderDrag, claim, focusCell, isCell, isFocused, isMaximized, toggleMaximize],
  );

  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);

  const rectStyle = useMemo(
    () =>
      layoutRect
        ? {
            left: layoutRect.x,
            top: layoutRect.y,
            width: layoutRect.width,
            height: layoutRect.height,
          }
        : undefined,
    [layoutRect],
  );
  const frameStyle = useMemo(
    () => [
      rect ? styles.cell : styles.single,
      !isVisible && !parked && styles.hidden,
      isDragSource && styles.dragSource,
      isMoving && styles.moving,
      rectStyle,
    ],
    [isDragSource, isVisible, isMoving, parked, rect, rectStyle],
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
          pointerEvents={underMaximized ? "none" : undefined}
          role={isCell ? "group" : undefined}
          aria-label={isCell ? label : undefined}
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
  dragSource: {
    zIndex: 30,
  },
  // The cell that grows or shrinks draws above the cells that appear or vanish around it.
  moving: {
    zIndex: 25,
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
