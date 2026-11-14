import React, { createContext, memo, type ReactNode, useContext } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

const RetainedPanelActiveContext = createContext(true);
const RetainedPanelKeepsLayoutContext = createContext(false);

export function useRetainedPanelActive(): boolean {
  return useContext(RetainedPanelActiveContext);
}

/**
 * True while an inactive panel above keeps its layout and every panel between them is shown, so
 * the content still has a laid-out box even though it is inactive.
 */
export function useRetainedPanelKeepsLayout(): boolean {
  return useContext(RetainedPanelKeepsLayoutContext);
}

interface RetainedPanelProps {
  active: boolean;
  /**
   * An inactive panel stays laid out instead of `display: none`. The owner hides it another way,
   * so showing it again reuses the cached layout.
   */
  keepLayout?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface RetainedPanelActivityProps {
  active: boolean;
  /** The inactive content stays laid out. Without it, inactive content may be hidden. */
  keepLayout?: boolean;
  children: ReactNode;
}

export function RetainedPanelActivity({
  active,
  keepLayout = false,
  children,
}: RetainedPanelActivityProps) {
  const parentActive = useRetainedPanelActive();
  const parentKeepsLayout = useRetainedPanelKeepsLayout();
  return (
    <RetainedPanelActiveContext value={parentActive && active}>
      <RetainedPanelKeepsLayoutContext value={active ? parentKeepsLayout : keepLayout}>
        {children}
      </RetainedPanelKeepsLayoutContext>
    </RetainedPanelActiveContext>
  );
}

/**
 * Keeps expensive panel state mounted without letting an inactive panel render
 * on screen. The stable, non-collapsible native root is intentional: retained
 * panels must not detach or reparent their native descendants when visibility
 * changes.
 */
export const RetainedPanel = memo(function RetainedPanel({
  active,
  keepLayout = false,
  children,
  style,
  testID,
}: RetainedPanelProps) {
  const visibleStyle = StyleSheet.compose<ViewStyle, ViewStyle, ViewStyle>(styles.root, style);
  const panelStyle =
    active || keepLayout
      ? visibleStyle
      : StyleSheet.compose<ViewStyle, ViewStyle, ViewStyle>(visibleStyle, styles.hidden);

  return (
    <RetainedPanelActivity active={active} keepLayout={keepLayout}>
      <View
        collapsable={false}
        pointerEvents={active ? "auto" : "none"}
        style={panelStyle}
        testID={testID}
      >
        {children}
      </View>
    </RetainedPanelActivity>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  hidden: {
    display: "none",
  },
});
