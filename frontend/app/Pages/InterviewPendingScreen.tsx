import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Fonts } from "@/constants/theme";
import {
  BASE_URL,
  checkAdminNannyProfileStatus,
  checkNannyApprovalStatus,
  getRuntimeApiKey,
  sanitizeToken,
} from "../Api";
import SafeScreen from "../components/SafeScreen";
import { hp, rf, rs, wp } from "../utils/responsive";

type Props = {
  onBack?: () => void;
  onDone?: () => void;
  onRejected?: () => void;
};

type ApprovalState = "pending" | "approved" | "rejected";

const APPROVAL_STATUS_KEY = "nanny_approval_state";
const normalizeApprovalState = (value?: string): ApprovalState => {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("approved")) return "approved";
  if (raw.includes("reject") || raw.includes("blacklist")) return "rejected";
  return "pending";
};

const InterviewPendingScreen: React.FC<Props> = ({ onBack, onDone, onRejected }) => {
  const router = useRouter();
  const [statusText, setStatusText] = useState("Pending approval");
  const [approvalState, setApprovalState] = useState<ApprovalState>("pending");
  const [gettingNewLink, setGettingNewLink] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isApproved = approvalState === "approved";
  const isRejected = approvalState === "rejected";

  const setStateAndPersist = async (state: ApprovalState, nextStatusText?: string) => {
    setApprovalState(state);
    if (nextStatusText) {
      setStatusText(nextStatusText);
    }
    if (state !== "pending" && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    try {
      await AsyncStorage.setItem(APPROVAL_STATUS_KEY, state);
    } catch {
      // ignore persistence errors
    }
  };

  useEffect(() => {
    let isActive = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const hydrateSavedStatus = async () => {
      try {
        const saved = await AsyncStorage.getItem(APPROVAL_STATUS_KEY);
        if (!isActive) return;
        if (saved === "approved") {
          setApprovalState("approved");
          setStatusText("approved");
        } else if (saved === "rejected") {
          setApprovalState("rejected");
          setStatusText("rejected");
        }
      } catch {
        // ignore hydration errors
      }
    };

    const pollStatus = async () => {
      try {
        const token = await AsyncStorage.getItem("token");
        const apiKey =
          (await AsyncStorage.getItem("api_key")) ||
          (typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_API_KEY : undefined) ||
          undefined;
        const nannyId = await AsyncStorage.getItem("nanny_id");
        if (!nannyId) return;
        const res: any = await checkNannyApprovalStatus(
          { nanny_id: nannyId },
          token || undefined,
          apiKey
        );
        if (!isActive) return;
        console.log("[InterviewPending] profile-status", res);
        const status =
          res?.status ||
          res?.data?.status ||
          res?.approval_status ||
          res?.data?.approval_status ||
          "";
        const normalizedState = normalizeApprovalState(status);
        const normalizedText = String(status || "").toLowerCase();
        if (normalizedText) {
          setStatusText(normalizedText.replace(/_/g, " "));
        }
        if (normalizedState === "approved") {
          await setStateAndPersist("approved", "approved");
          return;
        }
        if (normalizedState === "rejected") {
          await setStateAndPersist("rejected", "rejected");
          return;
        }
        if (approvalState !== "pending") return;

        if (Platform.OS === "web") {
          // Admin status endpoint is not available on web in this flow.
          return;
        }

        const adminRes: any = await checkAdminNannyProfileStatus(
          { nanny_id: nannyId },
          token || undefined,
          apiKey
        );
        if (!isActive) return;
        console.log("[InterviewPending] admin profile-status", adminRes);
        const adminStatus =
          adminRes?.data?.status ||
          adminRes?.status ||
          "";
        if (normalizeApprovalState(adminStatus) === "approved") {
          await setStateAndPersist("approved", "approved");
        }
      } catch (err) {
        console.warn("[InterviewPending] polling error", err);
      }
    };

    hydrateSavedStatus();
    pollStatus();
    intervalId = setInterval(pollStatus, 2000);
    intervalRef.current = intervalId;

    return () => {
      isActive = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [approvalState, onDone, onRejected]);

  const handleGetNewVerificationLink = async () => {
    if (gettingNewLink) return;

    try {
      setGettingNewLink(true);
      const nannyId = String((await AsyncStorage.getItem("nanny_id")) || "").trim();
      const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
      const apiKey =
        (await AsyncStorage.getItem("api_key")) ||
        getRuntimeApiKey() ||
        undefined;
      if (!nannyId) {
        Alert.alert("Verification", "Missing nanny id.");
        return;
      }

      const resp = await fetch(`${BASE_URL}taz/regenerate-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({ nanny_id: nannyId }),
      });

      const raw = await resp.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      if (!resp.ok || !data?.success) {
        Alert.alert(
          "Verification",
          data?.message || raw || `Could not generate a new verification link (${resp.status}).`
        );
        return;
      }

      const nextQuickappLink = String(data?.quickapp_link || "").trim();
      if (!nextQuickappLink) {
        Alert.alert("Verification", "New verification link was not returned.");
        return;
      }

      await AsyncStorage.setItem("taz_quickapp_link", nextQuickappLink);
      if (data?.taz_order_guid) {
        await AsyncStorage.setItem("taz_order_guid", String(data.taz_order_guid));
      }
      router.push({ pathname: "/background-check" as any, params: { url: nextQuickappLink } });
    } catch (e: any) {
      Alert.alert("Verification", e?.message || "Something went wrong.");
    } finally {
      setGettingNewLink(false);
    }
  };

  return (
    <SafeScreen>
      <LinearGradient colors={["#FFF1F5", "#FFE4EC", "#FFCDD2"]} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroIcon, isRejected && styles.heroIconRejected, isApproved && styles.heroIconApproved]}>
          <Ionicons
            name={isApproved ? "checkmark" : isRejected ? "close" : "hourglass-outline"}
            size={34}
            color="#fff"
          />
        </View>

        <Text style={styles.title}>
          {isApproved ? "Approved" : isRejected ? "We are sorry" : "Waiting for approval"}
        </Text>
        <Text style={styles.subtitle}>
          {isApproved
            ? "Your profile was approved. You can go straight to your dashboard."
            : isRejected
            ? "We reviewed your profile and could not approve it at this time. We apologize for the inconvenience."
            : "Thanks for scheduling your interview. We will review your details and contact you soon."}
        </Text>
        <Text style={styles.statusText}>Status: {statusText}</Text>

        <View style={[styles.card, isRejected && styles.cardRejected]}>
          <Text style={[styles.cardTitle, isRejected && styles.cardTitleRejected]}>
            {isRejected ? "Next steps" : "What happens next"}
          </Text>
          <Text style={styles.cardText}>
            {isRejected
              ? "- Please contact support if you think this was a mistake.\n- You can try again later if the team asks for updated details.\n- Thank you for your interest in joining Syttr."
              : "- Our team will verify your information\n- You will receive a call or email about your interview\n- You can use the app once you are approved and hired"}
          </Text>
        </View>

        {!isApproved ? (
          <TouchableOpacity
            style={[styles.secondaryButton, gettingNewLink && styles.lockedBtn]}
            onPress={handleGetNewVerificationLink}
            disabled={gettingNewLink}
          >
            {gettingNewLink ? (
              <ActivityIndicator color="#C2185B" />
            ) : (
              <Text style={styles.secondaryButtonText}>Get New Verification Link</Text>
            )}
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[
            styles.button,
            isRejected && styles.buttonRejected,
            !(isApproved || isRejected) && styles.lockedBtn,
          ]}
          onPress={() => {
            if (isApproved) {
              onDone?.();
              return;
            }
            if (isRejected) {
              onRejected?.();
            }
          }}
          disabled={!(isApproved || isRejected)}
        >
          <Text style={styles.buttonText}>
            {isApproved ? "Go to Dashboard" : isRejected ? "Back to login" : "Waiting for approval"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      </LinearGradient>
    </SafeScreen>
  );
};

export default InterviewPendingScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: rs(24),
  },
  heroIcon: {
    width: rs(72),
    height: rs(72),
    borderRadius: rs(36),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginVertical: rs(16),
  },
  heroIconApproved: {
    backgroundColor: "#4CAF50",
  },
  heroIconRejected: {
    backgroundColor: "#E53935",
  },
  title: {
    fontSize: rf(22),
    fontWeight: "700",
    color: "#880E4F",
    textAlign: "center",
    fontFamily: Fonts.display,
  },
  subtitle: {
    marginTop: rs(8),
    fontSize: rf(13),
    color: "#AD1457",
    textAlign: "center",
    fontFamily: Fonts.display,
  },
  statusText: {
    marginTop: rs(8),
    fontSize: rf(12),
    color: "#6B4350",
    textAlign: "center",
    fontFamily: Fonts.display,
    textTransform: "capitalize",
  },
  card: {
    marginTop: rs(20),
    backgroundColor: "#fff",
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "#FF80AB",
    padding: rs(16),
  },
  cardTitle: {
    fontSize: rf(14),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(8),
    fontFamily: Fonts.display,
  },
  cardRejected: {
    borderColor: "#F19999",
    backgroundColor: "#FFF5F5",
  },
  cardTitleRejected: {
    color: "#A11D2F",
  },
  cardText: {
    fontSize: rf(13),
    color: "#4A0033",
    lineHeight: rs(20),
    fontFamily: Fonts.display,
  },
  secondaryButton: {
    marginTop: rs(24),
    borderRadius: rs(14),
    paddingVertical: rs(14),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FF80AB",
    backgroundColor: "#FFF1F6",
    minHeight: rs(52),
  },
  secondaryButtonText: {
    color: "#C2185B",
    fontSize: rf(14),
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
  button: {
    marginTop: rs(24),
    backgroundColor: "#FF80AB",
    borderRadius: rs(14),
    paddingVertical: rs(14),
    alignItems: "center",
    elevation: 4,
  },
  buttonText: {
    color: "#fff",
    fontSize: rf(15),
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
  buttonRejected: {
    backgroundColor: "#E53935",
  },
  lockedBtn: {
    opacity: 0.55,
  },
});
