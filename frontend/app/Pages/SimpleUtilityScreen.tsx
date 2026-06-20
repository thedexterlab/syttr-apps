import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onPrimary?: () => void;
  primaryLabel?: string;
  onSecondary?: () => void;
  secondaryLabel?: string;
};

export default function SimpleUtilityScreen({
  title,
  subtitle,
  onBack,
  onPrimary,
  primaryLabel = "Home",
  onSecondary,
  secondaryLabel = "Settings",
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: Math.max(16, insets.top + 8) }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="chevron-back" size={20} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.body}>
        <Text style={styles.heading}>{title}</Text>
        <Text style={styles.subtitle}>
          {subtitle || `${title} screen connected successfully.`}
        </Text>
      </View>

      <View style={[styles.actions, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={onSecondary}>
          <Text style={styles.secondaryText}>{secondaryLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={onPrimary}>
          <Text style={styles.primaryText}>{primaryLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFE8F2",
  },
  title: {
    flex: 1,
    textAlign: "center",
    color: "#AD1457",
    fontSize: 18,
    fontWeight: "700",
  },
  spacer: { width: 34 },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  heading: {
    color: "#880E4F",
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    marginTop: 10,
    color: "#6B4350",
    fontSize: 14,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: "#C2185B",
    borderRadius: 12,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#F5B5C8",
    borderRadius: 12,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF6FA",
  },
  secondaryText: { color: "#AD1457", fontWeight: "700" },
});
