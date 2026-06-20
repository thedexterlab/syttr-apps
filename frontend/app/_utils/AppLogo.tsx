import { getLogoDimensions } from "@/constants/logo";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Image, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { rs } from "./responsive";

const palette = {
  primary: "#F27C9C",
  accent: "#F6BC63",
  outline: "rgba(242, 124, 156, 0.2)",
  shadow: "rgba(242, 124, 156, 0.18)",
};

export default function AppLogo() {
  const { width } = useWindowDimensions();
  const { outerSize, innerSize, outerRadius, innerRadius } = getLogoDimensions(width);

  return (
    <View style={styles.wrapper}>
      <LinearGradient
        colors={[palette.accent, palette.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.logoCircle, { width: outerSize, height: outerSize, borderRadius: outerRadius }]}
      >
        <View style={[styles.logoInnerCircle, { width: innerSize, height: innerSize, borderRadius: innerRadius }]}>
          <Image source={require("../../assets/app-logo.png")} style={styles.logo} resizeMode="contain" />
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    marginVertical: rs(18),
  },
  logoCircle: {
    alignItems: "center",
    justifyContent: "center",
    padding: rs(10),
    ...Platform.select({
      web: {
        boxShadow: `0px 10px 24px ${palette.shadow}`,
      },
      default: {
        elevation: 12,
        shadowColor: palette.primary,
        shadowOffset: { width: rs(0), height: rs(10) },
        shadowOpacity: 0.35,
        shadowRadius: 24,
      },
    }),
  },
  logoInnerCircle: {
    backgroundColor: "#FFF8F3",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: palette.outline,
  },
  logo: {
    width: "70%",
    height: "70%",
  },
});
