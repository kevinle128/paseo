import { useLayoutEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * Grid chrome (dividers, the "+" tile, dormant cards) that stays mounted while a cell is
 * maximized, so restoring the grid does not mount it again.
 *
 * Unistyles on web gives every distinct style a CSS class and changes its stylesheet each time a
 * class is first used or no longer used. Unmounting this chrome on maximize and mounting it on
 * restore dropped and added about twenty classes inside the commit that starts the motion. The
 * layer hides with an inline `display` on its node for the same reason: a style prop that toggles
 * is a new class too. `display: contents` gives the layer no box, so the absolute children keep
 * the deck as their containing block. Web only, like the grid.
 */
export function MaximizeHiddenLayer({
  hidden,
  children,
}: {
  hidden: boolean;
  children: ReactNode;
}) {
  const layerRef = useRef<View | null>(null);
  useLayoutEffect(() => {
    const node: unknown = layerRef.current;
    if (!hidden || !(node instanceof HTMLElement)) {
      return undefined;
    }
    node.style.display = "none";
    return () => {
      node.style.display = "";
    };
  }, [hidden]);
  return (
    <View ref={layerRef} style={styles.layer}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    // React Native style types have no `contents`; react-native-web passes the value through.
    display: "contents" as "flex",
  },
});
