import { useEffect, useRef, useState, type RefObject } from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";
import { resolveComposerDensity, type ComposerDensity } from "@/pinned-grid/composer-density";
import { useWorkspaceGridCell } from "@/pinned-grid/grid-cell-context";

interface GridComposerDensityInput {
  rootRef: RefObject<View | null>;
  inputFocused: boolean;
  hasDraft: boolean;
  hasAttachments: boolean;
  focusInput: () => void;
}

/**
 * Density of the composer for the grid cell it sits in. Outside a grid it is always "full".
 *
 * The composer stays expanded while the user works inside it, not only while the text input
 * holds focus: opening a toolbar menu moves focus out of the input, and collapsing then would
 * remove the menu's anchor. A press inside holds the composer open for as long as its cell
 * keeps grid focus, or until a press lands outside it.
 */
export function useGridComposerDensity({
  rootRef,
  inputFocused,
  hasDraft,
  hasAttachments,
  focusInput,
}: GridComposerDensityInput): ComposerDensity {
  const cell = useWorkspaceGridCell();
  const inGridCell = cell !== null;
  const [pressHold, setPressHold] = useState(false);
  const density = resolveComposerDensity({
    inGridCell,
    maximized: cell?.isMaximized ?? false,
    inputFocused: inputFocused || (pressHold && (cell?.isFocused ?? false)),
    hasDraft,
    hasAttachments,
  });
  const densityRef = useRef(density);
  densityRef.current = density;
  const focusInputRef = useRef(focusInput);
  focusInputRef.current = focusInput;

  useEffect(() => {
    if (!isWeb || !inGridCell) return;
    // A press on the slim bar expands it; the click that follows focuses the input, so a
    // press on bar padding (not the input itself) still lands the caret in the composer.
    let pressStartedMinimal = false;
    const isInsideComposer = (target: EventTarget | null) => {
      const root = rootRef.current as unknown as HTMLElement | null;
      return Boolean(root && target instanceof Node && root.contains(target));
    };
    const handlePointerDown = (event: PointerEvent) => {
      const inside = isInsideComposer(event.target);
      pressStartedMinimal = inside && densityRef.current === "minimal";
      setPressHold(inside);
    };
    const handleClick = (event: MouseEvent) => {
      if (!pressStartedMinimal) return;
      pressStartedMinimal = false;
      if (isInsideComposer(event.target)) focusInputRef.current();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [inGridCell, rootRef]);

  return density;
}
