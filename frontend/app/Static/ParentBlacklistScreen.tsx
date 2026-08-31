import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { apiRequest } from "../Api";
// import SafeScreen from "../components/SafeScreen";
import { rf, rs } from "../_utils/responsive";

type Props = {
  onResolved?: () => void;
  onSignOut?: () => void;
  onSupport?: () => void;
};

export default function ParentBlacklistScreen({ onResolved, onSignOut, onSupport }: Props) {
  const poller = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const loggedNetworkErrorRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    const buildAuthHeaders = (token: string | null) => ({
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token.replace(/"/g, "").trim()}` } : {}),
    });

    const pollBlacklistStatus = async () => {
      if (!mountedRef.current) return;
      if (attemptsRef.current >= 12) {
        if (poller.current) clearInterval(poller.current);
        return;
      }
      attemptsRef.current += 1;

      try {
        const [userId, token] = await Promise.all([
          AppStorage.getItem("user_id"),
          AppStorage.getItem("token"),
        ]);
        if (!userId) return;

        const headers = buildAuthHeaders(token);
        const profileData = await apiRequest<any>("profile-status", {
          method: "POST",
          headers,
          body: JSON.stringify({ user_id: String(userId) }),
        });
        const status = String(
          profileData?.status || profileData?.approval_status || ""
        ).toLowerCase();
        if (status !== "blacklisted") {
          await AppStorage.setItem("user_verification_status", "pending");
          if (!mountedRef.current) return;
          onResolved?.();
          return;
        }

        const tazData = await apiRequest<any>("taz/status", {
          method: "POST",
          headers,
          body: JSON.stringify({ user_id: String(userId) }),
        }).catch(() => null);

        const orders = Array.isArray(tazData?.orders) ? tazData.orders : [];
        const hasBlacklisted = orders.some(
          (order: any) => String(order?.status || "").toLowerCase() === "blacklisted"
        );

        if (!hasBlacklisted) {
          await AppStorage.setItem("user_verification_status", "pending");
          if (!mountedRef.current) return;
          onResolved?.();
        }
        loggedNetworkErrorRef.current = false;
      } catch (error) {
        if (!loggedNetworkErrorRef.current) {
          console.log("Blacklist poll error:", error);
          loggedNetworkErrorRef.current = true;
        }
      }
    };

    void pollBlacklistStatus();
    poller.current = setInterval(pollBlacklistStatus, 10000);

    return () => {
      mountedRef.current = false;
      if (poller.current) clearInterval(poller.current);
    };
  }, [onResolved]);

  const handleSignOut = async () => {
    await AppStorage.clear();
    onSignOut?.();
  };

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={["#FFF1F3", "#FFE2E8"]} style={styles.root}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="alert-circle" size={26} color="#fff" />
          </View>
          <Text style={styles.title}>Account Blocked</Text>
          <Text style={styles.body}>
            Your background screening did not meet our platform requirements. For the safety of our
            community, your account has been restricted. If you believe this is an error, please
            contact support for assistance.
          </Text>
          <Text style={styles.smallText}>Checking account status...</Text>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Contact support"
            style={styles.primaryBtn}
            onPress={onSupport}
          >
            <Text style={styles.primaryText}>Contact support</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            style={styles.secondaryBtn}
            onPress={handleSignOut}
          >
            <Text style={styles.secondaryText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: rs(20),
  },
  card: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: rs(20),
    padding: rs(20),
    shadowColor: "rgba(0,0,0,0.12)",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: rs(0), height: rs(6) },
  },
  iconWrap: {
    width: rs(48),
    height: rs(48),
    borderRadius: rs(24),
    backgroundColor: "#E53935",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: rs(12),
  },
  title: {
    fontSize: rf(20),
    fontWeight: "700",
    color: "#C62828",
  },
  body: {
    marginTop: rs(10),
    color: "#6B4350",
    fontSize: rf(14),
    lineHeight: rs(20),
  },
  smallText: {
    marginTop: rs(10),
    color: "#8C5E6A",
    fontSize: rf(12),
  },
  primaryBtn: {
    marginTop: rs(16),
    backgroundColor: "#E53935",
    borderRadius: rs(12),
    paddingVertical: rs(12),
    alignItems: "center",
  },
  primaryText: {
    color: "#fff",
    fontWeight: "700",
  },
  secondaryBtn: {
    marginTop: rs(10),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#F2B8B5",
    paddingVertical: rs(10),
    alignItems: "center",
  },
  secondaryText: {
    color: "#C62828",
    fontWeight: "700",
  },
});

