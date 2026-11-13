import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

/**
 * The project a workspace belongs to, as a tag that leads the workspace title. Used where the
 * workspace sits outside its project group: pinned sidebar rows and the workspace header.
 *
 * It is a translucent tint of the muted text rather than a solid fill, so it stays quieter than
 * the title next to it and stays visible on hovered and selected backgrounds. Leading the title
 * puts the project names of a list on one rail, where they can be scanned.
 */
export function ProjectTag({
  name,
  style,
  testID,
}: {
  name: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[styles.tag, style]} testID={testID}>
      <Text style={styles.text} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  tag: {
    flexShrink: 0,
    maxWidth: "40%",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: `${theme.colors.foregroundMuted}24`,
    paddingHorizontal: theme.spacing[1],
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 16,
  },
}));
