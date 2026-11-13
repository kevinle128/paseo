import { useEffect, useRef, useState, type RefObject } from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";
import { resolveComposerDensity, type ComposerDensity } from "@/pinned-grid/composer-density";
import { useWorkspaceGridCell } from "@/pinned-grid/grid-cell-context";

interface GridComposerDensityInput {
  rootRef: RefObject<View | null>;
  /** The editable element. A press inside it is the only press that expands a slim composer. */
  textInputElement: HTMLElement | null;
  inputFocused: boolean;
  hasDraft: boolean;
  hasAttachments: boolean;
}

/**
 * Density of the composer for the grid cell it sits in. Outside a grid it is always "full".
 *
 * The composer stays expanded while the user works inside it, not only while the text input
 * holds focus: opening a toolbar menu moves focus out of the input, and collapsing then would
 * remove the menu's anchor. A press inside holds the composer open for as long as its cell
 * keeps grid focus, or until a press lands outside it. A slim composer expands only when the
 * press lands in the text input, so pressing the bar around it only focuses the cell.
 */
export function useGridComposerDensity({
  rootRef,
  textInputElement,
  inputFocused,
  hasDraft,
  hasAttachments,
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
  const textInputElementRef = useRef(textInputElement);
  textInputElementRef.current = textInputElement;

  useEffect(() => {
    if (!isWeb || !inGridCell) return;
    const isInside = (container: Element | null, target: EventTarget | null) =>
      Boolean(container && target instanceof Node && container.contains(target));
    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current as unknown as HTMLElement | null;
      const insideRoot = isInside(root, event.target);
      const insideInput = isInside(textInputElementRef.current, event.target);
      // While full, any press inside keeps the composer open so toolbar menus keep their anchor.
      // While slim, only a press in the text input expands it.
      setPressHold(insideRoot && (densityRef.current === "full" || insideInput));
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [inGridCell, rootRef]);

  return density;
}
