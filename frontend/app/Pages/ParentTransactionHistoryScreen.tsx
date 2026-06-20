import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BASE_URL, getRuntimeApiKey, sanitizeToken } from "../Api";
import { hp, rf, rs, wp } from "../utils/responsive";

type Props = {
  navigation?: any;
  onBack?: () => void;
};

type TransactionItem = {
  id: string;
  description: string;
  statusLabel: string;
  amountLabel: string;
  dateLabel: string;
  createdAtRaw: string;
};

const formatDateLabel = (value?: string) => {
  if (!value) return "Date unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatAmountLabel = (value: any) => {
  if (value === undefined || value === null || value === "") return "--";
  const raw = String(value).trim();
  if (!raw) return "--";
  const amount = Number(raw.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(amount)) {
    const normalized = raw.replace(/\$/g, "").trim();
    return normalized ? `$${normalized}` : raw;
  }
  return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toFixed(2)}`;
};

const getRowsFromPayload = (payload: any): any[] => {
  const candidates = [
    payload,
    payload?.data,
    payload?.data?.data,
    payload?.transactions,
    payload?.data?.transactions,
    payload?.history,
    payload?.data?.history,
    payload?.billing,
    payload?.data?.billing,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
};

const normalizeTransactions = (rows: any[]): TransactionItem[] => {
  const items = rows.map((row: any, index: number) => {
    const createdAt = String(
      row?.created_at || row?.date || row?.paid_at || row?.updated_at || ""
    ).trim();
    const description = String(
      row?.description ||
        row?.title ||
        row?.reason ||
        row?.note ||
        row?.name ||
        row?.transaction_name ||
        row?.label ||
        "Transaction"
    ).trim();
    const id = String(
      row?.id ||
        row?.transaction_id ||
        row?.invoice_id ||
        row?.payment_id ||
        `${createdAt || "transaction"}-${index}`
    ).trim();

    return {
      id,
      description,
      statusLabel: String(row?.status || row?.payment_status || row?.state || "Processed").trim(),
      amountLabel: formatAmountLabel(
        row?.amount ?? row?.charge_amount ?? row?.total ?? row?.value ?? row?.price
      ),
      dateLabel: formatDateLabel(createdAt),
      createdAtRaw: createdAt,
    };
  });

  return items.sort((a, b) => Date.parse(b.createdAtRaw || "") - Date.parse(a.createdAtRaw || ""));
};

export default function ParentTransactionHistoryScreen({ navigation, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<TransactionItem[]>([]);

  const loadTransactions = useCallback(async () => {
    try {
      const [tokenRaw, userId, storedApiKey] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("api_key"),
      ]);
      const token = sanitizeToken(tokenRaw || undefined);
      const apiKey = String(storedApiKey || "").trim() || getRuntimeApiKey();
      const query = userId ? `?user_id=${encodeURIComponent(String(userId))}` : "";
      const endpoints = [
        `${BASE_URL}billing/history${query}`,
        `${BASE_URL}billing/transactions${query}`,
        `${BASE_URL}subscription/history${query}`,
        `${BASE_URL}subscription/transactions${query}`,
        `${BASE_URL}wallet/transactions${query}`,
      ];

      let resolvedRows: any[] = [];
      for (const url of endpoints) {
        try {
          const res = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(apiKey ? { "x-api-key": apiKey } : {}),
            },
          });
          if (!res.ok) continue;
          const payload = await res.json().catch(() => null);
          const rows = getRowsFromPayload(payload);
          if (rows.length) {
            resolvedRows = rows;
            break;
          }
          if (!resolvedRows.length) {
            resolvedRows = rows;
          }
        } catch {
          // try next endpoint
        }
      }

      setItems(normalizeTransactions(resolvedRows));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  return (
    <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={{ flex: 1 }}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, rs(14)) }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (onBack) onBack();
            else navigation?.goBack?.();
          }}
        >
          <Ionicons name="chevron-back" size={18} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Transaction History</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color="#FF80AB" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom + rs(24), rs(28)) },
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => {
              setRefreshing(true);
              void loadTransactions();
            }} />
          }
        >
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Transactions</Text>
            <Text style={styles.summaryValue}>{items.length}</Text>
          </View>

          {items.length ? (
            items.map((item) => (
              <View key={item.id} style={styles.rowCard}>
                <View style={styles.rowHeader}>
                  <Text style={styles.rowTitle}>{item.description}</Text>
                  <Text style={styles.rowAmount}>{item.amountLabel}</Text>
                </View>
                <View style={styles.rowFooter}>
                  <Text style={styles.rowMeta}>{item.dateLabel}</Text>
                  <Text style={styles.rowStatus}>{item.statusLabel}</Text>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="receipt-outline" size={40} color="#FF80AB" />
              <Text style={styles.emptyTitle}>No transactions found</Text>
              <Text style={styles.emptyText}>
                Your parent billing and payment history will appear here.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingBottom: rs(14),
  },
  backBtn: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#FFF1F1",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#F5B5C8",
  },
  headerTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#C77A00",
  },
  headerSpacer: {
    width: rs(34),
    height: rs(34),
  },
  content: {
    paddingHorizontal: rs(16),
    paddingTop: rs(8),
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryCard: {
    backgroundColor: "#FFF8E8",
    borderRadius: rs(18),
    paddingHorizontal: rs(16),
    paddingVertical: rs(14),
    marginBottom: rs(16),
    borderWidth: 1,
    borderColor: "#FFE1A6",
  },
  summaryLabel: {
    fontSize: rf(12),
    color: "#AD1457",
    fontWeight: "600",
  },
  summaryValue: {
    marginTop: rs(4),
    fontSize: rf(22),
    color: "#C2185B",
    fontWeight: "800",
  },
  rowCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: rs(16),
    padding: rs(14),
    marginBottom: rs(12),
    borderWidth: 1,
    borderColor: "#F7D7E4",
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: rs(10),
  },
  rowTitle: {
    flex: 1,
    fontSize: rf(14),
    fontWeight: "700",
    color: "#C2185B",
  },
  rowAmount: {
    fontSize: rf(14),
    fontWeight: "800",
    color: "#8B5E00",
  },
  rowFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: rs(10),
  },
  rowMeta: {
    fontSize: rf(12),
    color: "#A56B79",
  },
  rowStatus: {
    fontSize: rf(12),
    color: "#C77A00",
    fontWeight: "700",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: hp(10),
    paddingHorizontal: wp(8),
  },
  emptyTitle: {
    marginTop: rs(12),
    fontSize: rf(16),
    fontWeight: "700",
    color: "#C2185B",
  },
  emptyText: {
    marginTop: rs(6),
    fontSize: rf(13),
    color: "#8B5E00",
    textAlign: "center",
  },
});
