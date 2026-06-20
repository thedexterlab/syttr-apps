import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  BASE_URL,
  checkNannyApprovalStatus,
  isUserRejectedFromSources,
  isUserVerifiedFromSources,
} from "../Api";

import SafeScreen from "../_utils/SafeScreen";
import { rf, rs } from "../utils/responsive";

type Props = {
  onDone?: () => void;
  onRejected?: () => void;
};

export default function VerificationUnderReviewScreen({ onDone, onRejected }: Props) {
  const [statusText, setStatusText] = useState("Waiting for decision");
  const handledRef = useRef(false);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const [userId, nannyId, userTypeRaw, token] = await Promise.all([
          AsyncStorage.getItem("user_id"),
          AsyncStorage.getItem("nanny_id"),
          AsyncStorage.getItem("user_type"),
          AsyncStorage.getItem("token"),
        ]);
        const userType = String(userTypeRaw || "").toLowerCase().trim();
        const isNanny = userType === "nanny" || userType === "syttr";
        const resolvedId = String((isNanny ? nannyId : userId) || userId || nannyId || "").trim();
        if (!resolvedId) return;
        const idKey = isNanny ? "nanny_id" : "user_id";

        if (isNanny) {
          try {
            const profile: any = await checkNannyApprovalStatus(
              { nanny_id: resolvedId },
              token || undefined
            );
            const approvalStatus = String(
              profile?.status ||
                profile?.data?.status ||
                profile?.approval_status ||
                profile?.data?.approval_status ||
                ""
            )
              .trim()
              .toLowerCase();
            const interviewStatus = String(
              profile?.interview?.status ||
                profile?.data?.interview?.status ||
                profile?.interview_status ||
                profile?.data?.interview_status ||
                ""
            )
              .trim()
              .toLowerCase();
            const verificationRequired =
              typeof profile?.verification_required === "boolean"
                ? profile.verification_required
                : typeof profile?.data?.verification_required === "boolean"
                ? profile.data.verification_required
                : null;
            const isVerified =
              typeof profile?.is_verified === "boolean"
                ? profile.is_verified
                : typeof profile?.data?.is_verified === "boolean"
                ? profile.data.is_verified
                : null;

            if (approvalStatus) {
              setStatusText(approvalStatus.replace(/_/g, " "));
            } else if (interviewStatus) {
              setStatusText(interviewStatus.replace(/_/g, " "));
            }

            const adminApproved = isUserVerifiedFromSources({
              adminStatus: approvalStatus,
              isVerified,
              verificationRequired,
            });
            const adminRejected = isUserRejectedFromSources({
              adminStatus: approvalStatus,
            });

            if (!handledRef.current && adminApproved) {
              handledRef.current = true;
              await AsyncStorage.multiSet([
                ["nanny_approval_state", "approved"],
                ["user_verification_status", "approved"],
              ]);
              onDone?.();
              return;
            }
            if (!handledRef.current && adminRejected) {
              handledRef.current = true;
              await AsyncStorage.multiSet([
                ["nanny_approval_state", "rejected"],
                ["user_verification_status", "rejected"],
              ]);
              onRejected?.();
              return;
            }
          } catch {
            // Continue to TAZ status fallback below.
          }
        }

        const res = await fetch(`${BASE_URL}taz/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token.replace(/"/g, "").trim()}` } : {}),
          },
          body: JSON.stringify({ [idKey]: resolvedId }),
        });

        const raw = await res.text();
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = null;
        }
        if (!active || !res.ok || !data?.success) return;

        const latestOrder = Array.isArray(data?.orders) && data.orders.length > 0 ? data.orders[0] : {};
        const decisionStatus = String(
          latestOrder?.response_order_status ||
            latestOrder?.decision_status ||
            ""
        ).trim().toLowerCase();
        const eventStatus = String(
          latestOrder?.normalized_status ||
            latestOrder?.status ||
            data?.status ||
            ""
        ).trim().toLowerCase();

        if (decisionStatus) {
          setStatusText(decisionStatus.replace(/_/g, " "));
        } else if (eventStatus) {
          setStatusText(eventStatus.replace(/_/g, " "));
        }

        const verifiedFromAnySource = isUserVerifiedFromSources({
          tazDecisionStatus: decisionStatus,
          tazEventStatus: eventStatus,
          tazStatus: String(data?.status || "").trim().toLowerCase(),
        });
        const rejectedFromAnySource = isUserRejectedFromSources({
          tazDecisionStatus: decisionStatus,
          tazEventStatus: eventStatus,
          tazStatus: String(data?.status || "").trim().toLowerCase(),
        });

        if (!handledRef.current && verifiedFromAnySource) {
          handledRef.current = true;
          await AsyncStorage.multiSet([
            ["nanny_approval_state", "approved"],
            ["user_verification_status", "approved"],
          ]);
          onDone?.();
          return;
        }
        if (!handledRef.current && rejectedFromAnySource) {
          handledRef.current = true;
          await AsyncStorage.multiSet([
            ["nanny_approval_state", "rejected"],
            ["user_verification_status", "rejected"],
          ]);
          onRejected?.();
        }
      } catch {
        // ignore polling failures
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [onDone, onRejected]);

  return (
    <SafeScreen edges={["top", "left", "right", "bottom"]}>
      <LinearGradient colors={["#FFF8F0", "#FFF1F6", "#FFE4EC"]} style={styles.container}>
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Ionicons name="time-outline" size={34} color="#C2185B" />
          </View>

          <Text style={styles.title}>Background check under review</Text>
          <Text style={styles.subtitle}>
            Your background check is under review, you will receive a notification soon with next steps!
          </Text>
          <Text style={styles.statusText}>Status: {statusText}</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>What happens next</Text>
            <Text style={styles.cardText}>
              We are reviewing your submission now. Once the check is complete, we will send you a
              notification with the next step and any follow-up details.
            </Text>
          </View>

          <View style={styles.waitRow}>
            <ActivityIndicator size="small" color="#C2185B" />
            <Text style={styles.waitText}>Waiting for verification response...</Text>
          </View>
        </View>
      </LinearGradient>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: rs(20),
  },
  iconWrap: {
    width: rs(72),
    height: rs(72),
    borderRadius: rs(36),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF",
    marginBottom: rs(18),
    borderWidth: 1,
    borderColor: "rgba(194,24,91,0.14)",
  },
  title: {
    fontSize: rf(22),
    fontWeight: "800",
    color: "#880E4F",
    textAlign: "center",
  },
  subtitle: {
    fontSize: rf(14),
    lineHeight: rf(22),
    color: "#6B4350",
    textAlign: "center",
    marginTop: rs(10),
    maxWidth: rs(340),
  },
  statusText: {
    marginTop: rs(10),
    fontSize: rf(12),
    color: "#8C5E6A",
  },
  card: {
    width: "100%",
    maxWidth: rs(420),
    backgroundColor: "#FFF",
    borderRadius: rs(18),
    padding: rs(18),
    marginTop: rs(22),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.22)",
  },
  cardTitle: {
    fontSize: rf(15),
    fontWeight: "700",
    color: "#C2185B",
    marginBottom: rs(8),
  },
  cardText: {
    fontSize: rf(13),
    lineHeight: rf(20),
    color: "#6B4350",
  },
  waitRow: {
    marginTop: rs(22),
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
  },
  waitText: {
    color: "#8C5E6A",
    fontSize: rf(13),
    fontWeight: "600",
  },
});
