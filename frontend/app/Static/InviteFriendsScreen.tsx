import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
// import SafeScreen from "../components/SafeScreen";
import { getReferralReference } from "../Api";
import { rf, rs } from "../_utils/responsive";
import { Clipboard } from "../_utils/safeClipboard";

type Props = {
  navigation?: any;
};

export default function InviteFriendsScreen({ navigation }: Props) {
  const useNative = Platform.OS !== "web";
  const [referralCode, setReferralCode] = useState("");
  const [referralLink, setReferralLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const fallbackReferralUrl = `https://syttr.com/r/${encodeURIComponent(referralCode || "invite")}`;
  const referralUrl = referralLink || fallbackReferralUrl;

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 600,
        useNativeDriver: useNative,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 600,
        useNativeDriver: useNative,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        useNativeDriver: useNative,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    const hydrateReferralCode = async () => {
      const [directCode, fallbackCode, profileRaw, userId, nannyId, token, genericId] = await Promise.all([
        AsyncStorage.getItem("referral_code"),
        AsyncStorage.getItem("user_referral_code"),
        AsyncStorage.getItem("user_profile"),
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("nanny_id"),
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("id"),
      ]);
      let profileCode = "";
      if (profileRaw) {
        try {
          const profile = JSON.parse(profileRaw);
          profileCode =
            String(
              profile?.referralCode ||
                profile?.referral_code ||
                profile?.refCode ||
                ""
            ).trim();
        } catch {
          // ignore bad profile payloads
        }
      }

      const selectedUserId = String(userId || nannyId || genericId || "").trim();
      let backendCode = "";
      let backendLink = "";
      if (selectedUserId || token) {
        try {
          const response: any = await getReferralReference(
            selectedUserId ? { user_id: selectedUserId } : {},
            token || undefined
          );
          const payload = response?.data || response || {};
          backendCode = String(
            payload?.referral_code ||
              payload?.reference_code ||
              payload?.referralCode ||
              ""
          ).trim();
          backendLink = String(
            payload?.referral_link ||
              payload?.reference_link ||
              payload?.referralUrl ||
              ""
          ).trim();
          if (backendCode) {
            await AsyncStorage.multiSet([
              ["referral_code", backendCode],
              ["user_referral_code", backendCode],
            ]);
          }
        } catch {
          // fallback to local values
        }
      }

      const nextCode = String(backendCode || directCode || fallbackCode || profileCode || "").trim();
      if (nextCode) setReferralCode(nextCode);
      if (backendLink) setReferralLink(backendLink);
      else if (nextCode) setReferralLink(`https://syttr.com/r/${encodeURIComponent(nextCode)}`);
    };
    void hydrateReferralCode();
  }, []);

  const copyLink = async () => {
    await Clipboard.setStringAsync(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (sharing) return;
    setSharing(true);
    const message = `Join me on Syttr!

Use my referral link below to sign up and earn rewards:

${referralUrl}


Referral Code: ${referralCode || "N/A"}`;

    try {
      if (Platform.OS === "web") {
        await Clipboard.setStringAsync(referralUrl);
        Alert.alert("Copied", "Referral link copied. Paste to share.");
        return;
      }
      await Share.share({ message });
    } catch {
      Alert.alert("Error", "Unable to open the share sheet right now.");
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
      colors={["#FFFFFF", "#FFFFFF"]}
      style={{ flex: 1 }}
      >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()}>
          <Ionicons name="chevron-back" size={22} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Invite Friends</Text>
        <View style={{ width: rs(22) }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Intro */}
        <Animated.View
          style={[
            styles.formCard,
            {
              opacity: fade,
              transform: [{ translateY: slide }, { scale }],
            },
          ]}
        >
          <View style={styles.iconCircle}>
            <Ionicons name="people" size={26} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Invite & Earn</Text>
            <Text style={styles.subtitle}>
              Share the love and get rewarded!
            </Text>
          </View>
        </Animated.View>

        {/* Rewards Info */}
        <Animated.View style={[styles.formCard, styles.mt]}>
          <Text style={styles.sectionTitle}>Earn Together!</Text>
          <Text style={styles.body}>
            Invite friends using your unique link. Earn $5 when they join and
            another $5 when they complete their first booking.
          </Text>
        </Animated.View>

        {/* Steps */}
        <Animated.View style={[styles.formCard, styles.mt]}>
          <Text style={styles.sectionTitle}>
            What invited friends need to do:
          </Text>

          <Step number="1" text="Download the app using your link" icon="download" />
          <Step number="2" text="Create an account" icon="person-add" />
          <Step number="3" text="Book a Syttr" icon="calendar" />
        </Animated.View>

        {/* Referral */}
        <Animated.View style={[styles.formCard, styles.mt]}>
            <Text style={styles.sectionTitle}>Your Referral Link</Text>

          <View style={styles.linkBox}>
            <Text
              style={styles.linkText}
              numberOfLines={2}
              ellipsizeMode="middle"
            >
              {referralUrl}
            </Text>
            <Text style={styles.code}>Code: {referralCode || "N/A"}</Text>
          </View>

          <View style={styles.row}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Copy referral link"
              style={styles.outlineBtn}
              onPress={copyLink}
            >
              <Ionicons name="copy" size={18} color="#FF80AB" />
              <Text style={styles.outlineText}>{copied ? "Copied!" : "Copy Link"}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Share referral link"
              style={[styles.primaryBtn, sharing && { opacity: 0.7 }]}
              onPress={shareLink}
              disabled={sharing}
            >
              <Ionicons name="share-social" size={18} color="#fff" />
              <Text style={styles.primaryText}>{sharing ? "Sharing..." : "Share Link"}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Rewards Summary */}
        <Animated.View style={[styles.card, styles.mt]}>
          <Text style={styles.sectionTitle}>Your Rewards</Text>

          <View style={styles.rewardRow}>
            <Reward amount="$5" label="Friend Joins" />
            <Reward amount="+$5" label="First Booking" />
            <Reward amount="$10" label="Total" />
          </View>

          <Text style={styles.italic}>
            Start inviting friends and watch rewards grow!
          </Text>
        </Animated.View>
      </ScrollView>
      </LinearGradient>
    </View>
  );
}

/* ---------------- COMPONENTS ---------------- */

const Step = ({ number, text, icon }: any) => (
  <View style={styles.step}>
    <View style={styles.stepCircle}>
      <Text style={styles.stepNumber}>{number}</Text>
    </View>
    <View style={styles.stepBox}>
      <Ionicons name={icon} size={18} color="#FF80AB" />
      <Text style={styles.stepText}>{text}</Text>
    </View>
  </View>
);

const Reward = ({ amount, label }: any) => (
  <View style={{ alignItems: "center" }}>
    <View style={styles.rewardCircle}>
      <Text style={styles.rewardAmount}>{amount}</Text>
    </View>
    <Text style={styles.rewardLabel}>{label}</Text>
  </View>
);

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(14),
    backgroundColor: "rgba(255,255,255,0.9)",
    borderBottomLeftRadius: rs(18),
    borderBottomRightRadius: rs(18),
    elevation: 2,
  },
  headerTitle: {
    color: "#C77A00",
    fontSize: rf(20),
    fontWeight: "700",
  },
  container: {
    padding: rs(16),
    paddingBottom: rs(40),
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: rs(20),
    padding: rs(18),
  },
  formCard: {
    backgroundColor: "#FFF1F6",
    borderRadius: rs(20),
    padding: rs(18),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  mt: {
    marginTop: rs(16),
  },
  iconCircle: {
    width: rs(56),
    height: rs(56),
    borderRadius: rs(28),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: rs(12),
  },
  title: {
    fontSize: rf(20),
    fontWeight: "700",
    color: "#880E4F",
  },
  subtitle: {
    fontSize: rf(14),
    color: "#AD1457",
  },
  sectionTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(10),
  },
  body: {
    fontSize: rf(14),
    color: "#AD1457",
    lineHeight: rs(22),
  },
  step: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: rs(12),
  },
  stepCircle: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(12),
  },
  stepNumber: {
    color: "#fff",
    fontWeight: "700",
  },
  stepBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF1F6",
    padding: rs(10),
    borderRadius: rs(12),
  },
  stepText: {
    marginLeft: rs(10),
    color: "#AD1457",
    fontSize: rf(14),
  },
  linkBox: {
    backgroundColor: "#FFF1F6",
    borderRadius: rs(12),
    padding: rs(12),
    marginBottom: rs(12),
  },
  linkText: {
    color: "#880E4F",
    fontWeight: "600",
    flexWrap: "wrap",
  },
  code: {
    marginTop: rs(6),
    color: "#880E4F",
    fontSize: rf(12),
  },
  row: {
    flexDirection: "row",
    gap: rs(12),
  },
  outlineBtn: {
    flex: 1,
    height: rs(48),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
  },
  outlineText: {
    color: "#FF80AB",
    fontWeight: "600",
  },
  primaryBtn: {
    flex: 1,
    height: rs(48),
    borderRadius: rs(12),
    backgroundColor: "#FF80AB",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
  },
  primaryText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  rewardRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginVertical: rs(16),
  },
  rewardCircle: {
    width: rs(48),
    height: rs(48),
    borderRadius: rs(24),
    backgroundColor: "#FF80AB20",
    alignItems: "center",
    justifyContent: "center",
  },
  rewardAmount: {
    fontWeight: "700",
    color: "#880E4F",
  },
  rewardLabel: {
    fontSize: rf(12),
    color: "#AD1457",
    marginTop: rs(6),
    textAlign: "center",
  },
  italic: {
    textAlign: "center",
    fontSize: rf(13),
    fontStyle: "italic",
    color: "#AD1457",
  },
});


