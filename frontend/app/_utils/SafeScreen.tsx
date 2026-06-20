import React from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: ScrollViewProps["contentContainerStyle"];
  edges?: Edge[];
  scroll?: boolean;
  scrollProps?: Omit<ScrollViewProps, "contentContainerStyle" | "children">;
};

export default function SafeScreen({
  children,
  style,
  contentContainerStyle,
  edges = ["top", "right", "bottom", "left"],
  scroll = false,
  scrollProps,
}: Props) {
  if (scroll) {
    return (
      <SafeAreaView style={[styles.root, style]} edges={edges}>
        <ScrollView
          {...scrollProps}
          contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, style]} edges={edges}>
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFF8F0",
  },
  content: {
    flex: 1,
    backgroundColor: "#FFF8F0",
  },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: "#FFF8F0",
  },
});
