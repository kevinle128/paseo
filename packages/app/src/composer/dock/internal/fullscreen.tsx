import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { useGridScrollSignalSource } from "@/pinned-grid/grid-scroll-signal";

/** The editing region of a composer; see the native file for the keyboard contract. */
export function ComposerFullscreenBody({
  fullscreen,
  children,
}: {
  fullscreen: boolean;
  children: ReactNode;
}) {
  return <View style={fullscreen ? styles.fullscreen : styles.inline}>{children}</View>;
}

export function ComposerFullscreenFooter({ children, ...props }: ViewProps) {
  return <View {...props}>{children}</View>;
}

export interface ComposerSlotFrame {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where a fullscreen composer sits, in layout-viewport coordinates for a fixed box: the
 * part of the dock surface the browser's visible viewport shows. A mobile browser
 * keyboard shrinks or pans that viewport without resizing the page, so the frame
 * follows it instead of the layout.
 */
export function useFullscreenSlotFrame(
  active: boolean,
  surfaceRef: RefObject<View | null>,
  surfaceSize: { width: number; height: number } | undefined,
): ComposerSlotFrame | undefined {
  const [frame, setFrame] = useState<ComposerSlotFrame>();
  // Inside a scrolling pinned grid the surface moves without resizing, so the grid's scroll
  // places the frame again, and the frame never extends past the grid's visible area.
  const gridSignal = useGridScrollSignalSource();
  useLayoutEffect(() => {
    if (!active) {
      setFrame(undefined);
      return;
    }
    const update = () => {
      const surface = surfaceRef.current as unknown as HTMLElement | null;
      if (!surface) return;
      setFrame(
        resolveVisibleSurfaceFrame(
          surface.getBoundingClientRect(),
          clipViewportToRect(readVisibleViewport(), gridSignal?.getViewportRect() ?? null),
        ),
      );
    };
    const visualViewport = window.visualViewport;
    const unsubscribeGridScroll = gridSignal?.subscribe(update);
    update();
    visualViewport?.addEventListener("resize", update);
    visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      unsubscribeGridScroll?.();
      visualViewport?.removeEventListener("resize", update);
      visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [active, gridSignal, surfaceRef, surfaceSize]);
  return frame;
}

function readVisibleViewport() {
  const viewport = window.visualViewport;
  return {
    top: viewport?.offsetTop ?? 0,
    left: viewport?.offsetLeft ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

export function clipViewportToRect(
  viewport: { top: number; left: number; width: number; height: number },
  rect: { top: number; left: number; right: number; bottom: number } | null,
): { top: number; left: number; width: number; height: number } {
  if (!rect) {
    return viewport;
  }
  const top = Math.max(viewport.top, rect.top);
  const left = Math.max(viewport.left, rect.left);
  return {
    top,
    left,
    width: Math.max(0, Math.min(viewport.left + viewport.width, rect.right) - left),
    height: Math.max(0, Math.min(viewport.top + viewport.height, rect.bottom) - top),
  };
}

function resolveVisibleSurfaceFrame(
  surface: { top: number; left: number; right: number; bottom: number },
  viewport: { top: number; left: number; width: number; height: number },
): ComposerSlotFrame {
  const top = Math.max(viewport.top, surface.top);
  const left = Math.max(viewport.left, surface.left);
  return {
    top,
    left,
    width: Math.max(0, Math.min(viewport.left + viewport.width, surface.right) - left),
    height: Math.max(0, Math.min(viewport.top + viewport.height, surface.bottom) - top),
  };
}

const styles = StyleSheet.create({
  inline: { flexShrink: 1 },
  fullscreen: { flex: 1, minHeight: 0 },
});
