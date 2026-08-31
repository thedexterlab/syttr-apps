import AppStorage from "@/lib/storage";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BASE_URL, getRuntimeApiKey, sanitizeToken } from "../Api";
import { rf, rs } from "../_utils/responsive";

type Props = {
  navigation?: any;
};

type SupportCategory = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const SUPPORT_CATEGORIES: SupportCategory[] = [
  { key: "contact", label: "Contact-us", icon: "mail-outline" },
  { key: "ticket", label: "User ticket", icon: "ticket-outline" },
  { key: "chat", label: "Chat escalation", icon: "chatbubble-ellipses-outline" },
  { key: "status", label: "Issue status", icon: "pulse-outline" },
];

const ISSUE_STATUS_ITEMS = [
  {
    title: "Billing and payment updates",
    detail: "Most cases are handled within 24 hours.",
    tone: "#FFF4D8",
    icon: "card-outline" as const,
  },
  {
    title: "Chat or booking urgency",
    detail: "Escalate active booking risk through support immediately.",
    tone: "#FFE3E8",
    icon: "warning-outline" as const,
  },
  {
    title: "Account verification checks",
    detail: "Document review usually clears in 1 business day.",
    tone: "#FCE8FF",
    icon: "shield-checkmark-outline" as const,
  },
];

export default function ContactUsScreen({ navigation }: Props) {
  const useNative = Platform.OS !== "web";
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;
  const scale = useRef(new Animated.Value(0.95)).current;

  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("contact");
  const [loading, setLoading] = useState(false);
  const [accountLabel, setAccountLabel] = useState("App user");
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("");

  const recipientEmail = "support@syttr.com";

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 700,
        useNativeDriver: useNative,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 700,
        useNativeDriver: useNative,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        useNativeDriver: useNative,
      }),
    ]).start();
  }, [fade, scale, slide, useNative]);

  useEffect(() => {
    let alive = true;

    const loadIdentity = async () => {
      try {
        const entries = await AppStorage.multiGet([
          "user_type",
          "email",
          "user_email",
          "nanny_email",
          "user_name",
          "nanny_name",
          "user_profile_payload",
          "nanny_profile_payload",
        ]);
        const map = Object.fromEntries(entries);
        if (!alive) return;
        const userType = String(map.user_type || "").trim().toLowerCase();
        setAccountType(userType);

        const readPayloadEmail = (raw: string) => {
          const value = String(raw || "").trim();
          if (!value) return "";
          try {
            const parsed = JSON.parse(value);
            return String(
              parsed?.email ||
                parsed?.user?.email ||
                parsed?.profile?.email ||
                parsed?.data?.email ||
                parsed?.data?.profile?.email ||
                ""
            ).trim();
          } catch {
            return "";
          }
        };

        const storedEmail =
          (userType === "nanny" || userType === "syttr"
            ? String(map.nanny_email || "").trim()
            : String(map.user_email || "").trim()) ||
          String(map.user_email || "").trim() ||
          String(map.nanny_email || "").trim() ||
          String(map.email || "").trim() ||
          readPayloadEmail(String(map.user_profile_payload || "")) ||
          readPayloadEmail(String(map.nanny_profile_payload || ""));

        if (storedEmail) {
          setEmail((current) => current || storedEmail);
        }
        const storedName =
          (userType === "nanny" || userType === "syttr"
            ? String(map.nanny_name || "").trim()
            : String(map.user_name || "").trim()) ||
          String(map.user_name || "").trim() ||
          String(map.nanny_name || "").trim();
        if (storedName) {
          setAccountName(storedName);
        }
        if (userType === "nanny" || userType === "syttr") {
          setAccountLabel("Sitter account");
          return;
        }
        if (userType === "parent" || userType === "client") {
          setAccountLabel("Parent account");
          return;
        }
        setAccountLabel("App user");
      } catch {
        if (alive) setAccountLabel("App user");
      }
    };

    void loadIdentity();
    return () => {
      alive = false;
    };
  }, []);

  const categoryMeta = useMemo(
    () => SUPPORT_CATEGORIES.find((item) => item.key === selectedCategory) || SUPPORT_CATEGORIES[0],
    [selectedCategory],
  );

  const computedSubject = subject.trim() || `${categoryMeta.label} request`;

  const submitSupportRequest = async () => {
    if (loading) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !message.trim()) {
      Alert.alert("Missing details", "Please add your email and message.");
      return;
    }

    if (!emailRegex.test(email)) {
      Alert.alert("Invalid email", "Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const entries = await AppStorage.multiGet([
        "token",
        "nanny_token",
        "api_key",
        "user_id",
        "nanny_id",
        "user_type",
        "user_name",
        "nanny_name",
      ]);
      const map = Object.fromEntries(entries);
      const userType = String(map.user_type || "").trim().toLowerCase();
      const senderName =
        accountName ||
        (userType === "nanny" || userType === "syttr"
          ? String(map.nanny_name || "").trim()
          : String(map.user_name || "").trim()) ||
        String(map.user_name || "").trim() ||
        String(map.nanny_name || "").trim();
      const tokenRaw = map.token || map.nanny_token || "";
      const cleanToken = sanitizeToken(tokenRaw || undefined);
      const cleanApiKey = String(map.api_key || "").trim() || getRuntimeApiKey();

      const response = await fetch(`${BASE_URL}support/messages`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
          ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
        },
        body: JSON.stringify({
          user_id: String(map.user_id || "").trim() || undefined,
          nanny_id: String(map.nanny_id || "").trim() || undefined,
          account_type: userType || undefined,
          name: senderName || undefined,
          email: email.trim(),
          category: selectedCategory,
          subject: computedSubject,
          message: message.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.message || "Unable to submit support request.");
      }

      const reference = String(payload?.data?.reference || "").trim();
      Alert.alert(
        "Support request",
        reference
          ? `Support request submitted successfully. Reference: ${reference}`
          : "Support request submitted successfully."
      );
      setMessage("");
      setSubject("");
    } catch (error: any) {
      Alert.alert("Submit failed", error?.message || "Unable to submit support request.");
    } finally {
      setLoading(false);
    }
  };

  const openSupportLink = async () => {
    try {
      await Linking.openURL(`mailto:${recipientEmail}`);
    } catch {
      Alert.alert("Support", `Please email us at ${recipientEmail}`);
    }
  };

  const canViewTickets =
    (accountType === "parent" || accountType === "client") &&
    typeof navigation?.navigate === "function";

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={["#FFFFFF", "#FFF9FB", "#FFF4ED"]} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => navigation?.goBack?.()}
          >
            <Ionicons name="chevron-back" size={22} color="#C2185B" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Support Center</Text>
          <View style={{ width: rs(22) }} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            <Animated.View
              style={[
                styles.heroCard,
                {
                  opacity: fade,
                  transform: [{ translateY: slide }, { scale }],
                },
              ]}
            >
              <LinearGradient colors={["#FF80AB", "#FFC36B"]} style={styles.heroGradient}>
                <View style={styles.heroIcon}>
                  <Ionicons name="headset-outline" size={28} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroTitle}>Support / Contact Center</Text>
                  <Text style={styles.heroSubtitle}>
                    Contact us, submit a ticket, escalate chat issues, or check issue guidance.
                  </Text>
                </View>
              </LinearGradient>
            </Animated.View>

            <Animated.View
              style={[
                styles.formCard,
                { opacity: fade, transform: [{ translateY: slide }] },
              ]}
            >
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.formTitle}>Choose support type</Text>
                  <Text style={styles.sectionSubtitle}>This helps route the request correctly.</Text>
                </View>
                <View style={styles.accountBadge}>
                  <Text style={styles.accountBadgeText}>{accountLabel}</Text>
                </View>
              </View>

              <View style={styles.categoryGrid}>
                {SUPPORT_CATEGORIES.map((item) => {
                  const active = item.key === selectedCategory;
                  return (
                    <TouchableOpacity
                      key={item.key}
                      style={[styles.categoryChip, active && styles.categoryChipActive]}
                      onPress={() => setSelectedCategory(item.key)}
                      activeOpacity={0.9}
                    >
                      <Ionicons
                        name={item.icon}
                        size={18}
                        color={active ? "#FFFFFF" : "#C2185B"}
                      />
                      <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="your.email@example.com"
                icon="mail-outline"
              />

              <Input
                label="Subject"
                value={subject}
                onChangeText={setSubject}
                placeholder={`${categoryMeta.label} request`}
                icon="document-text-outline"
              />

              <Text style={styles.label}>Message</Text>
              <View style={styles.textArea}>
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={18}
                  color="#FF80AB"
                  style={{ marginTop: rs(12), marginRight: rs(8) }}
                />
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Describe the issue, include booking, payment, or chat details if relevant."
                  placeholderTextColor="#AD1457AA"
                  multiline
                  style={styles.textAreaInput}
                  textAlignVertical="top"
                  autoCapitalize="sentences"
                />
              </View>

              <View style={styles.quickNotes}>
                <Text style={styles.quickNotesTitle}>What happens next</Text>
                <Text style={styles.quickNotesText}>
                  Your request is submitted to the Syttr support inbox and can be reviewed from the admin panel.
                </Text>
              </View>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Submit support request"
                activeOpacity={0.9}
                onPress={submitSupportRequest}
                disabled={loading}
              >
                <LinearGradient colors={["#FF80AB", "#FFB06A"]} style={styles.sendBtn}>
                  {loading ? (
                    <Text style={styles.sendText}>Submitting request...</Text>
                  ) : (
                    <>
                      <Ionicons name="send" size={18} color="#fff" />
                      <Text style={styles.sendText}>Submit Support Request</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              {canViewTickets ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="View my support tickets"
                  style={styles.supportLinkBtn}
                  onPress={() => navigation?.navigate?.("supportTickets")}
                >
                  <Ionicons name="document-text-outline" size={16} color="#880E4F" />
                  <Text style={styles.supportLinkText}>View My Support Tickets</Text>
                </TouchableOpacity>
              ) : null}
            </Animated.View>

            <Animated.View
              style={[
                styles.infoCard,
                { opacity: fade, transform: [{ translateY: slide }] },
              ]}
            >
              <Text style={styles.infoTitle}>Issue status and escalation</Text>

              <View style={styles.statusGrid}>
                {ISSUE_STATUS_ITEMS.map((item) => (
                  <View key={item.title} style={styles.statusCard}>
                    <View style={[styles.statusIconWrap, { backgroundColor: item.tone }]}>
                      <Ionicons name={item.icon} size={18} color="#880E4F" />
                    </View>
                    <Text style={styles.statusTitle}>{item.title}</Text>
                    <Text style={styles.statusText}>{item.detail}</Text>
                  </View>
                ))}
              </View>

              <InfoItem icon="mail-outline" title="Support email" value="support@syttr.com" />
              <InfoItem icon="time-outline" title="Typical response" value="Within 24 hours" />
              <InfoItem
                icon="chatbubble-ellipses-outline"
                title="Chat escalation"
                value="Include booking or conversation details in the message."
              />

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Contact support by email"
                style={styles.supportLinkBtn}
                onPress={openSupportLink}
              >
                <Ionicons name="open-outline" size={16} color="#880E4F" />
                <Text style={styles.supportLinkText}>Open support email</Text>
              </TouchableOpacity>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </View>
  );
}

function Input({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const isEmail = label === "Email";
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.input}>
        <Ionicons name={icon} size={18} color="#FF80AB" />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#AD1457AA"
          style={styles.inputText}
          autoCapitalize="none"
          keyboardType={isEmail ? "email-address" : "default"}
        />
      </View>
    </>
  );
}

function InfoItem({
  icon,
  title,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
}) {
  return (
    <View style={styles.infoItem}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={18} color="#FF80AB" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{title}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(14),
    backgroundColor: "rgba(255,255,255,0.92)",
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
    gap: rs(18),
  },
  heroCard: {
    borderRadius: rs(22),
    overflow: "hidden",
  },
  heroGradient: {
    flexDirection: "row",
    alignItems: "center",
    padding: rs(18),
    gap: rs(14),
  },
  heroIcon: {
    width: rs(56),
    height: rs(56),
    borderRadius: rs(18),
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    fontSize: rf(20),
    fontWeight: "800",
    color: "#FFFFFF",
  },
  heroSubtitle: {
    fontSize: rf(13),
    color: "rgba(255,255,255,0.92)",
    marginTop: rs(4),
    lineHeight: rf(19),
  },
  formCard: {
    backgroundColor: "#FFF1F6",
    borderRadius: rs(20),
    padding: rs(18),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: rs(12),
    marginBottom: rs(14),
  },
  formTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
  },
  sectionSubtitle: {
    marginTop: rs(2),
    color: "#AD1457",
    fontSize: rf(12),
  },
  accountBadge: {
    paddingHorizontal: rs(10),
    paddingVertical: rs(7),
    borderRadius: rs(999),
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.3)",
  },
  accountBadgeText: {
    color: "#880E4F",
    fontWeight: "700",
    fontSize: rf(12),
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: rs(10),
    marginBottom: rs(6),
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
    paddingHorizontal: rs(12),
    paddingVertical: rs(10),
    borderRadius: rs(14),
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.3)",
  },
  categoryChipActive: {
    backgroundColor: "#FF80AB",
    borderColor: "#FF80AB",
  },
  categoryChipText: {
    color: "#880E4F",
    fontSize: rf(13),
    fontWeight: "700",
  },
  categoryChipTextActive: {
    color: "#FFFFFF",
  },
  label: {
    fontSize: rf(14),
    fontWeight: "600",
    color: "#880E4F",
    marginBottom: rs(6),
    marginTop: rs(12),
  },
  input: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.3)",
    borderRadius: rs(12),
    paddingHorizontal: rs(12),
    paddingVertical: rs(12),
  },
  inputText: {
    marginLeft: rs(8),
    flex: 1,
    color: "#880E4F",
  },
  textArea: {
    flexDirection: "row",
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.3)",
    borderRadius: rs(12),
    paddingHorizontal: rs(12),
    paddingVertical: rs(8),
  },
  textAreaInput: {
    flex: 1,
    minHeight: rs(110),
    textAlignVertical: "top",
    color: "#880E4F",
  },
  quickNotes: {
    marginTop: rs(14),
    padding: rs(12),
    borderRadius: rs(14),
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  quickNotesTitle: {
    color: "#880E4F",
    fontWeight: "700",
    fontSize: rf(13),
  },
  quickNotesText: {
    marginTop: rs(4),
    color: "#AD1457",
    fontSize: rf(12),
    lineHeight: rf(18),
  },
  sendBtn: {
    marginTop: rs(20),
    height: rs(56),
    borderRadius: rs(16),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
  },
  sendText: {
    color: "#FFFFFF",
    fontSize: rf(16),
    fontWeight: "700",
  },
  infoCard: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: rs(20),
    padding: rs(20),
    borderWidth: 1,
    borderColor: "rgba(255,214,230,0.95)",
  },
  infoTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(16),
  },
  statusGrid: {
    gap: rs(10),
    marginBottom: rs(16),
  },
  statusCard: {
    backgroundColor: "#FFF8FB",
    borderRadius: rs(16),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.16)",
  },
  statusIconWrap: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(12),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: rs(10),
  },
  statusTitle: {
    color: "#880E4F",
    fontWeight: "700",
    fontSize: rf(14),
  },
  statusText: {
    color: "#AD1457",
    marginTop: rs(4),
    fontSize: rf(12),
    lineHeight: rf(18),
  },
  infoItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: rs(12),
  },
  infoIcon: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    backgroundColor: "#FFE7F0",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(12),
  },
  infoLabel: {
    fontSize: rf(12),
    color: "#AD1457",
  },
  infoValue: {
    fontSize: rf(14),
    fontWeight: "600",
    color: "#880E4F",
  },
  supportLinkBtn: {
    marginTop: rs(10),
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
    backgroundColor: "#FFF1F5",
    borderRadius: rs(12),
    paddingHorizontal: rs(12),
    paddingVertical: rs(8),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.25)",
  },
  supportLinkText: {
    color: "#880E4F",
    fontWeight: "700",
    fontSize: rf(13),
  },
});
