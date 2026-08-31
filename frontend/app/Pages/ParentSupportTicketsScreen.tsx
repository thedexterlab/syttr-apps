import AppStorage from "@/lib/storage";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, getRuntimeApiKey, isVerificationRequiredApiError, sanitizeToken } from "../Api";
import { rf, rs } from "../utils/responsive";

type Props = {
  navigation?: any;
  onBack?: () => void;
  onCreateTicket?: () => void;
  onRequireVerification?: () => void;
};

type SupportTicket = {
  id: number | string;
  reference?: string;
  category?: string;
  status?: string;
  subject?: string;
  message?: string;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string | null;
};

const formatDate = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return "Date unavailable";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatStatus = (value?: string) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "New";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const getStatusTone = (value?: string) => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.includes("closed") || raw.includes("resolved")) {
    return { bg: "#E8F5E9", border: "#B8E0C0", text: "#1B5E20" };
  }
  if (raw.includes("waiting") || raw.includes("pending")) {
    return { bg: "#FFF4E5", border: "#FFD69F", text: "#B86B00" };
  }
  return { bg: "#FCE4EC", border: "#F6BCD0", text: "#C2185B" };
};

export default function ParentSupportTicketsScreen({
  navigation,
  onBack,
  onCreateTicket,
  onRequireVerification,
}: Props) {
  const [items, setItems] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState<string>("");

  const loadTickets = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "refresh") {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");

    try {
      const entries = await AppStorage.multiGet([
        "token",
        "api_key",
        "user_id",
        "user_email",
      ]);
      const map = Object.fromEntries(entries);
      const cleanToken = sanitizeToken(map.token || undefined);
      const cleanApiKey = String(map.api_key || "").trim() || getRuntimeApiKey();
      const userId = String(map.user_id || "").trim();
      const userEmail = String(map.user_email || "").trim();

      const params = new URLSearchParams();
      if (userId) params.set("user_id", userId);
      if (!userId && userEmail) params.set("email", userEmail);
      params.set("limit", "100");

      const payload = await apiRequest<any>(`support/messages?${params.toString()}`, {
        headers: {
          ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
          ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
        },
      });
      if (payload?.success === false) {
        if (isVerificationRequiredApiError({ payload, message: payload?.message })) {
          onRequireVerification?.();
          return;
        }
        throw new Error(payload?.message || "Unable to load support tickets.");
      }

      setItems(Array.isArray(payload?.data) ? payload.data : []);
    } catch (e: any) {
      if (isVerificationRequiredApiError(e)) {
        setItems([]);
        setError("");
        onRequireVerification?.();
        return;
      }
      setItems([]);
      setError(e?.message || "Unable to load support tickets.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onRequireVerification]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    const unsubscribe = navigation?.addListener?.("focus", () => {
      void loadTickets();
    });
    return () => unsubscribe?.();
  }, [loadTickets, navigation]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void loadTickets("refresh");
      }
    });
    return () => sub.remove();
  }, [loadTickets]);

  useEffect(() => {
    if (!items.length) {
      if (selectedTicketId) setSelectedTicketId("");
      return;
    }

    const hasCurrent = items.some((item) => String(item.id) === selectedTicketId);
    if (!hasCurrent) {
      setSelectedTicketId(String(items[0].id));
    }
  }, [items, selectedTicketId]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <LinearGradient colors={["#FFFFFF", "#FFF8FB", "#FFF3EC"]} style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => onBack?.() || navigation?.goBack?.()}
          >
            <Ionicons name="chevron-back" size={22} color="#C2185B" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Support Tickets</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Create support ticket"
            onPress={onCreateTicket}
            disabled={!onCreateTicket}
            style={{ opacity: onCreateTicket ? 1 : 0 }}
          >
            <Ionicons name="add-circle-outline" size={22} color="#C2185B" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.container}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void loadTickets("refresh")} />
          }
        >
          <View style={styles.heroCard}>
            <LinearGradient colors={["#FF80AB", "#FFC06A"]} style={styles.heroGradient}>
              <View style={styles.heroIcon}>
                <Ionicons name="document-text-outline" size={22} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>Support ticket history</Text>
                <Text style={styles.heroSubtitle}>
                  Track the support requests you already submitted from the app.
                </Text>
              </View>
            </LinearGradient>
          </View>

          {loading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator color="#C2185B" />
              <Text style={styles.stateText}>Loading your support tickets...</Text>
            </View>
          ) : error ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>Unable to load tickets</Text>
              <Text style={styles.stateText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => void loadTickets()}>
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : !items.length ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>No support tickets yet</Text>
              <Text style={styles.stateText}>
                Submit a request from Contact Us and it will appear here.
              </Text>
              {onCreateTicket ? (
                <TouchableOpacity style={styles.retryBtn} onPress={onCreateTicket}>
                  <Text style={styles.retryText}>Open Contact Us</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
          items.map((item) => {
            const tone = getStatusTone(item.status);
            const isSelected = String(item.id) === selectedTicketId;
            return (
              <TouchableOpacity
                key={String(item.id)}
                activeOpacity={0.92}
                onPress={() =>
                  setSelectedTicketId((current) =>
                    current === String(item.id) ? "" : String(item.id)
                  )
                }
                style={[
                  styles.ticketCard,
                  isSelected && styles.ticketCardSelected,
                ]}
              >
                <View style={styles.ticketTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ticketReference}>
                      {item.reference || `Ticket #${item.id}`}
                    </Text>
                      <Text style={styles.ticketSubject}>
                        {item.subject || "Support request"}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: tone.bg, borderColor: tone.border },
                      ]}
                    >
                      <Text style={[styles.statusText, { color: tone.text }]}>
                        {formatStatus(item.status)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.metaRow}>
                    <View style={styles.metaPill}>
                      <Ionicons name="layers-outline" size={14} color="#C2185B" />
                      <Text style={styles.metaText}>{formatStatus(item.category)}</Text>
                    </View>
                  <View style={styles.metaPill}>
                    <Ionicons name="time-outline" size={14} color="#C2185B" />
                    <Text style={styles.metaText}>{formatDate(item.created_at)}</Text>
                  </View>
                </View>

                <Text
                  style={styles.ticketMessage}
                  numberOfLines={isSelected ? undefined : 2}
                >
                  {item.message || "No message provided."}
                </Text>

                {isSelected ? (
                  <View style={styles.detailCard}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Reference</Text>
                      <Text style={styles.detailValue}>
                        {item.reference || `Ticket #${item.id}`}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Category</Text>
                      <Text style={styles.detailValue}>{formatStatus(item.category)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Status</Text>
                      <Text style={styles.detailValue}>{formatStatus(item.status)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Created</Text>
                      <Text style={styles.detailValue}>{formatDate(item.created_at)}</Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Updated</Text>
                      <Text style={styles.detailValue}>{formatDate(item.updated_at)}</Text>
                    </View>
                    {item.resolved_at ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Resolved</Text>
                        <Text style={styles.detailValue}>{formatDate(item.resolved_at)}</Text>
                      </View>
                    ) : null}
                    <View style={styles.fullMessageWrap}>
                      <Text style={styles.detailLabel}>Full message</Text>
                      <Text style={styles.fullMessageText}>
                        {item.message || "No message provided."}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  screen: {
    flex: 1,
  },
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
    paddingBottom: rs(42),
    gap: rs(16),
  },
  heroCard: {
    borderRadius: rs(22),
    overflow: "hidden",
  },
  heroGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(14),
    padding: rs(18),
  },
  heroIcon: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(14),
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    color: "#fff",
    fontSize: rf(18),
    fontWeight: "800",
  },
  heroSubtitle: {
    marginTop: rs(4),
    color: "rgba(255,255,255,0.92)",
    fontSize: rf(12),
    lineHeight: rf(18),
  },
  stateCard: {
    borderRadius: rs(20),
    padding: rs(20),
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#F6D7E3",
    alignItems: "center",
    gap: rs(10),
  },
  stateTitle: {
    color: "#7A2E43",
    fontSize: rf(17),
    fontWeight: "800",
    textAlign: "center",
  },
  stateText: {
    color: "#9A6272",
    fontSize: rf(13),
    textAlign: "center",
    lineHeight: rf(19),
  },
  retryBtn: {
    marginTop: rs(6),
    paddingHorizontal: rs(16),
    paddingVertical: rs(10),
    borderRadius: rs(999),
    backgroundColor: "#C2185B",
  },
  retryText: {
    color: "#fff",
    fontSize: rf(13),
    fontWeight: "700",
  },
  ticketCard: {
    borderRadius: rs(20),
    padding: rs(16),
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#F6D7E3",
    gap: rs(12),
  },
  ticketCardSelected: {
    borderColor: "#F09AB8",
    backgroundColor: "#FFF9FC",
  },
  ticketTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: rs(10),
  },
  ticketReference: {
    color: "#C2185B",
    fontSize: rf(12),
    fontWeight: "700",
  },
  ticketSubject: {
    marginTop: rs(4),
    color: "#6B2140",
    fontSize: rf(16),
    fontWeight: "800",
  },
  statusBadge: {
    borderRadius: rs(999),
    borderWidth: 1,
    paddingHorizontal: rs(10),
    paddingVertical: rs(6),
  },
  statusText: {
    fontSize: rf(11),
    fontWeight: "700",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: rs(8),
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
    paddingHorizontal: rs(10),
    paddingVertical: rs(8),
    borderRadius: rs(999),
    backgroundColor: "#FFF3F7",
  },
  metaText: {
    color: "#8A4A60",
    fontSize: rf(11),
    fontWeight: "700",
  },
  ticketMessage: {
    color: "#7B5260",
    fontSize: rf(13),
    lineHeight: rf(19),
  },
  detailCard: {
    borderTopWidth: 1,
    borderTopColor: "#F7D8E4",
    paddingTop: rs(12),
    gap: rs(10),
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: rs(12),
  },
  detailLabel: {
    color: "#A15C73",
    fontSize: rf(12),
    fontWeight: "700",
  },
  detailValue: {
    flex: 1,
    textAlign: "right",
    color: "#6B2140",
    fontSize: rf(12),
    fontWeight: "600",
  },
  fullMessageWrap: {
    gap: rs(6),
    paddingTop: rs(4),
  },
  fullMessageText: {
    color: "#6F4655",
    fontSize: rf(13),
    lineHeight: rf(20),
  },
});
