/// <reference types="react" />
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  ListRenderItem,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest, getRuntimeApiKey, isVerificationRequiredApiError, sanitizeToken } from "../Api";
import { formatDateToMDY } from "../utils/dateFormat";
import {
  deleteParentRequestNotification,
  fetchParentRequestNotifications,
  isNotificationRead,
  markParentRequestAsRead,
  type ParentRequestNotification,
} from "../../lib/parentRequestNotifications";
import { fetchUnreadConversationCount } from "../../lib/chatUnreadCount";
import { hp, rf, rs, wp } from "../utils/responsive";

type NotificationItem = ParentRequestNotification;

type Props = {
  navigation?: any;
  onBack?: () => void;
  onOpenDetail?: (item: NotificationItem) => void;
  onHome?: () => void;
  onMessages?: () => void;
  onJobRequests?: () => void;
  onNotifications?: () => void;
  onCalendar?: () => void;
  onSettings?: () => void;
  onRequireVerification?: () => void;
};

export default function ParentJobRequestsScreen({
  navigation,
  onOpenDetail,
  onHome,
  onMessages,
  onJobRequests,
  onNotifications,
  onCalendar,
  onSettings,
  onRequireVerification,
}: Props) {
  const insets = useSafeAreaInsets();
  const bottomBarOffset = -Math.max(insets.bottom, 0);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [requestCount, setRequestCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedRequestKeys, setSelectedRequestKeys] = useState<Set<string>>(new Set());
  const [actionsMenuVisible, setActionsMenuVisible] = useState(false);

  const syncRequestCountFromItems = (list: NotificationItem[]) => {
    setRequestCount(list.filter((item) => !isNotificationRead(item)).length);
  };

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const requestsOnly = await fetchParentRequestNotifications();
      setItems(requestsOnly);
      syncRequestCountFromItems(requestsOnly);
    } catch (e: any) {
      if (isVerificationRequiredApiError(e)) {
        setItems([]);
        setRequestCount(0);
        onRequireVerification?.();
        return;
      }
      console.log("Job requests fetch error:", e);
      Alert.alert("Error", e?.message || "Unable to load job requests");
      setItems([]);
      setRequestCount(0);
    } finally {
      setLoading(false);
    }
  };

  const loadMessageCount = async () => {
    try {
      const count = await fetchUnreadConversationCount();
      setMessageCount(count);
    } catch {
      setMessageCount(0);
    }
  };

  const loadNotificationCount = async () => {
    try {
      const [token, apiKey, userId] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("api_key"),
        AsyncStorage.getItem("user_id"),
      ]);

      if (!userId) {
        setNotificationCount(0);
        return;
      }

      const headers: HeadersInit = { Accept: "application/json" };
      const cleanToken = sanitizeToken(token || undefined);
      const cleanApiKey = String(apiKey || "").trim() || getRuntimeApiKey();

      if (cleanToken) headers.Authorization = `Bearer ${cleanToken}`;
      if (cleanApiKey) headers["x-api-key"] = cleanApiKey;

      const json = await apiRequest<any>(
        `notifications?user_id=${encodeURIComponent(String(userId))}`,
        { headers: headers as Record<string, string> }
      );
      const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      const unread = data.filter((item: any) => !isNotificationRead(item));
      setNotificationCount(unread.length);
    } catch {
      setNotificationCount(0);
    }
  };

  useEffect(() => {
    void fetchRequests();
    void loadMessageCount();
    void loadNotificationCount();

    const unsubscribe = navigation?.addListener?.("focus", () => {
      void fetchRequests();
      void loadMessageCount();
      void loadNotificationCount();
    });

    return () => unsubscribe?.();
  }, [navigation]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void loadNotificationCount();
      }
    });
    return () => sub.remove();
  }, []);

  const formatDateLabel = (value?: string): string => {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return formatDateToMDY(value) || String(value);

    const diffMs = Date.now() - date.getTime();
    if (diffMs < 0) return formatDateToMDY(value) || String(value);

    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m ago`;

    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;

    return formatDateToMDY(value) || date.toLocaleDateString() || String(value);
  };

  const formatStatusLabel = (value?: string): string => {
    const raw = String(value || "").trim();
    if (!raw) return "Pending";
    return raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const removeItemLocally = (target: NotificationItem) => {
    setItems((prev) => {
      const next = prev.filter((item) => item.request_key !== target.request_key);
      syncRequestCountFromItems(next);
      return next;
    });
  };

  const deleteNotification = async (
    item: NotificationItem,
    options?: { silent?: boolean }
  ) => {
    try {
      await deleteParentRequestNotification(item);
      removeItemLocally(item);
    } catch (e: any) {
      if (!options?.silent) {
        Alert.alert("Delete failed", e?.message || "Unable to delete notification.");
      }
      throw e;
    }
  };

  const confirmDeleteNotification = (item: NotificationItem) => {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const ok = window.confirm("Delete this job request notification?");
      if (ok) {
        void deleteNotification(item).catch(() => {});
      }
      return;
    }

    Alert.alert("Delete notification", "Delete this job request notification?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteNotification(item).catch(() => {});
        },
      },
    ]);
  };

  const clearAllRequests = async () => {
    const snapshot = [...items];
    if (!snapshot.length) {
      setItems([]);
      setRequestCount(0);
      return;
    }

    let failed = 0;
    for (const item of snapshot) {
      try {
        await deleteNotification(item, { silent: true });
      } catch {
        failed += 1;
      }
    }

    if (failed > 0) {
      Alert.alert(
        "Some requests not deleted",
        `${failed} job request${failed === 1 ? "" : "s"} could not be deleted.`
      );
    }
  };

  const confirmClearAllRequests = () => {
    if (!items.length) return;
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const ok = window.confirm("Delete all job requests from this list?");
      if (ok) {
        void clearAllRequests();
      }
      return;
    }

    Alert.alert("Clear all requests", "Delete all job requests from this list?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete all",
        style: "destructive",
        onPress: () => {
          void clearAllRequests();
        },
      },
    ]);
  };

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedRequestKeys(new Set());
  };

  const openActionsMenu = () => setActionsMenuVisible(true);
  const closeActionsMenu = () => setActionsMenuVisible(false);

  const selectAllRequests = () => {
    const keys = items
      .filter((item) => {
        const statusRaw = String(item?.status || "").trim().toLowerCase();
        return statusRaw !== "hire_requested" && statusRaw !== "hire-requested";
      })
      .map((item) => String(item.request_key || item.id || "").trim())
      .filter(Boolean);

    setSelectionMode(true);
    setSelectedRequestKeys(new Set(keys));
  };

  const markItemsLocallyAsRead = (targets: NotificationItem[]) => {
    if (!targets.length) return;
    const targetKeys = new Set(
      targets
        .map((item) => String(item.request_key || item.id || "").trim())
        .filter(Boolean)
    );

    setItems((prev) => {
      const next = prev.map((item) => {
        const key = String(item.request_key || item.id || "").trim();
        if (!targetKeys.has(key)) return item;
        return { ...item, is_read: 1, isRead: true };
      });
      syncRequestCountFromItems(next);
      return next;
    });
  };

  const markItemsLocallyAsUnread = (targets: NotificationItem[]) => {
    if (!targets.length) return;
    const targetKeys = new Set(
      targets
        .map((item) => String(item.request_key || item.id || "").trim())
        .filter(Boolean)
    );

    setItems((prev) => {
      const next = prev.map((item) => {
        const key = String(item.request_key || item.id || "").trim();
        if (!targetKeys.has(key)) return item;
        return { ...item, is_read: 0, isRead: false };
      });
      syncRequestCountFromItems(next);
      return next;
    });
  };

  const resolveNotificationIds = (item: NotificationItem): string[] => {
    const ids = [item.id, ...(Array.isArray(item.source_ids) ? item.source_ids : [])]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return Array.from(new Set(ids));
  };

  const markRequestAsUnread = async (item: NotificationItem) => {
    const ids = resolveNotificationIds(item);
    if (!ids.length) return;

    const [token, apiKey, userId] = await Promise.all([
      AsyncStorage.getItem("token"),
      AsyncStorage.getItem("api_key"),
      AsyncStorage.getItem("user_id"),
    ]);

    const cleanToken = sanitizeToken(token || undefined);
    const cleanApiKey = String(apiKey || "").trim() || getRuntimeApiKey();
    const body = userId ? JSON.stringify({ user_id: Number(userId) }) : undefined;

    await Promise.all(
      ids.map(async (id) => {
        const json = await apiRequest<any>(`notification/mark-unread/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
            ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
          },
          body,
        });

        if (json?.success === false) {
          throw new Error(json?.message || "Unable to mark job request unread.");
        }
      })
    );
  };

  const markRequestsAsRead = async (targets: NotificationItem[]) => {
    if (!targets.length) return;
    markItemsLocallyAsRead(targets);

    const results = await Promise.allSettled(
      targets.map((item) => markParentRequestAsRead(item))
    );
    const failed = results.filter((result) => result.status === "rejected").length;

    if (failed > 0) {
      Alert.alert(
        "Mark read incomplete",
        `${failed} job request${failed === 1 ? "" : "s"} could not be marked read.`
      );
    }
  };

  const markAllRequestsAsRead = async () => {
    const unreadItems = items.filter((item) => !isNotificationRead(item));
    await markRequestsAsRead(unreadItems);
  };

  const markAllRequestsAsUnread = async () => {
    if (!items.length) return;
    markItemsLocallyAsUnread(items);

    const results = await Promise.allSettled(
      items.map((item) => markRequestAsUnread(item))
    );
    const failed = results.filter((result) => result.status === "rejected").length;

    if (failed > 0) {
      Alert.alert(
        "Mark unread incomplete",
        `${failed} job request${failed === 1 ? "" : "s"} could not be marked unread.`
      );
    }
  };

  const markSelectedRequestsAsUnread = async () => {
    const keys = new Set(Array.from(selectedRequestKeys));
    if (!keys.size) return;

    const selectedItems = items.filter((item) =>
      keys.has(String(item.request_key || item.id || "").trim())
    );

    markItemsLocallyAsUnread(selectedItems);
    const results = await Promise.allSettled(
      selectedItems.map((item) => markRequestAsUnread(item))
    );
    const failed = results.filter((result) => result.status === "rejected").length;

    if (failed > 0) {
      Alert.alert(
        "Mark unread incomplete",
        `${failed} selected job request${failed === 1 ? "" : "s"} could not be marked unread.`
      );
    }

    clearSelection();
  };

  const toggleRequestSelection = (item: NotificationItem) => {
    const key = String(item.request_key || item.id || "").trim();
    if (!key) return;

    const statusRaw = String(item?.status || "").trim().toLowerCase();
    const isParentInitiatedHireRequest =
      statusRaw === "hire_requested" || statusRaw === "hire-requested";
    if (isParentInitiatedHireRequest) return;

    setSelectionMode(true);
    setSelectedRequestKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const deleteSelectedRequests = () => {
    const keys = Array.from(selectedRequestKeys);
    if (!keys.length) return;

    const runDelete = async () => {
      let failed = 0;
      const selectedItems = items.filter((item) =>
        keys.includes(String(item.request_key || item.id || "").trim())
      );

      for (const item of selectedItems) {
        try {
          await deleteNotification(item, { silent: true });
        } catch {
          failed += 1;
        }
      }

      clearSelection();

      if (failed > 0) {
        Alert.alert(
          "Some requests not deleted",
          `${failed} selected job request${failed === 1 ? "" : "s"} could not be deleted.`
        );
      }
    };

    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const ok = window.confirm(
        `Delete ${keys.length} selected job request${keys.length === 1 ? "" : "s"}?`
      );
      if (ok) {
        void runDelete();
      }
      return;
    }

    Alert.alert(
      "Delete requests",
      `Delete ${keys.length} selected job request${keys.length === 1 ? "" : "s"}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void runDelete() },
      ]
    );
  };

  const renderItem: ListRenderItem<NotificationItem> = ({ item }) => {
    const isUnread = !isNotificationRead(item);
    const statusRaw = String(item?.status || "").trim().toLowerCase();
    const isParentInitiatedHireRequest =
      statusRaw === "hire_requested" || statusRaw === "hire-requested";
    const uniqueKidNames = Array.from(
      new Set(
        (Array.isArray(item.kid_names) ? item.kid_names : [])
          .map((name) => String(name || "").trim())
          .filter(Boolean)
      )
    );
    const itemKey = String(item.request_key || item.id || "").trim();
    const isSelected = itemKey ? selectedRequestKeys.has(itemKey) : false;
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          if (selectionMode) {
            toggleRequestSelection(item);
            return;
          }
          const nextItem = { ...item, is_read: 1, isRead: true };
          setItems((prev) => {
            const next = prev.map((entry) =>
              entry.request_key === item.request_key ? nextItem : entry
            );
            syncRequestCountFromItems(next);
            return next;
          });
          void markParentRequestAsRead(item);

          if (onOpenDetail) onOpenDetail(nextItem);
          else navigation?.navigate?.("ParentJobRequestDetail", { item: nextItem });
        }}
        onLongPress={() => {
          if (selectionMode) {
            toggleRequestSelection(item);
            return;
          }
          if (isParentInitiatedHireRequest) return;
          confirmDeleteNotification(item);
        }}
        style={[styles.card, isUnread && styles.cardUnread, isSelected && styles.cardSelected]}
      >
        <View style={styles.cardLeft}>
          <LinearGradient
            colors={["#FF80AB", "#FFB6C1"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardIconCircle}
          >
            <Ionicons name="briefcase" size={20} color="#fff" />
          </LinearGradient>

          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, isUnread && styles.cardTitleUnread]}>
              {item.nanny_name ? `${item.nanny_name}` : "Job Request"}
            </Text>
            <Text style={[styles.cardSubtitle, isUnread && styles.cardSubtitleUnread]}>
              {item.subtitle || item.message || `${item.nanny_name || "A Syttr"} has sent you a message for your job.`}
            </Text>
            <Text style={styles.detailText}>
              Kids: {uniqueKidNames.length ? uniqueKidNames.join(", ") : "Not provided"}
            </Text>
            <Text style={styles.detailText}>
              {item.hours_label || "Hours TBD"} - {item.pay_label || "Rate TBD"}
            </Text>
            {item.location ? <Text style={styles.detailText}>Location: {item.location}</Text> : null}
            <Text style={styles.detailText}>
              Status: {formatStatusLabel(item.application_status || item.status)}
            </Text>
            <Text style={styles.timeText}>{formatDateLabel(item.time || item.created_at)}</Text>
          </View>
        </View>
        {selectionMode ? (
          <View style={[styles.selectionBadge, isSelected && styles.selectionBadgeActive]}>
            <Ionicons
              name={isSelected ? "checkmark" : "ellipse-outline"}
              size={16}
              color={isSelected ? "#FFFFFF" : "#C77A00"}
            />
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerSlot}>
          {selectionMode ? (
            <TouchableOpacity style={styles.headerActionBtn} onPress={clearSelection}>
              <Ionicons name="close" size={18} color="#C77A00" />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.headerTitle}>Job Requests</Text>
        <View style={styles.headerActions}>
          {selectionMode ? (
            <>
              <TouchableOpacity
                style={styles.headerActionBtn}
                onPress={selectAllRequests}
                accessibilityLabel="Select all job requests"
              >
                <Ionicons name="checkmark-done-outline" size={18} color="#C77A00" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.headerActionBtn,
                  selectedRequestKeys.size === 0 && styles.headerActionBtnDisabled,
                ]}
                onPress={deleteSelectedRequests}
                disabled={selectedRequestKeys.size === 0}
                accessibilityLabel="Delete selected job requests"
              >
                <Ionicons name="trash-outline" size={18} color="#C77A00" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.headerActionBtn,
                  selectedRequestKeys.size === 0 && styles.headerActionBtnDisabled,
                ]}
                onPress={() => void markSelectedRequestsAsUnread()}
                disabled={selectedRequestKeys.size === 0}
                accessibilityLabel="Mark selected job requests unread"
              >
                <Ionicons name="mail-unread-outline" size={18} color="#C77A00" />
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.headerActionBtn}
              onPress={openActionsMenu}
              accessibilityLabel="Job request actions"
            >
              <Ionicons name="ellipsis-vertical" size={18} color="#C77A00" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color="#FFC107" />
        ) : items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View style={styles.iconCircle}>
              <Ionicons name="briefcase-outline" size={48} color="#FFC107" />
            </View>
            <Text style={styles.title}>No job requests</Text>
            <Text style={styles.subtitle}>You are all caught up.</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item, index) => item.request_key || item.id?.toString() || String(index)}
            renderItem={renderItem}
            contentContainerStyle={{
              paddingHorizontal: rs(16),
              paddingBottom: rs(88) + Math.max(insets.bottom, 8),
              gap: rs(12),
            }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <View
        style={[
          styles.bottomBar,
          {
            bottom: bottomBarOffset,
            paddingBottom: Math.max(8, insets.bottom),
            height: rs(60) + Math.max(8, insets.bottom),
          },
        ]}
      >
        <Tab icon="home" label="Home" onPress={onHome || (() => {})} />
        <Tab icon="chatbubble" label="Chat" badgeCount={messageCount} onPress={onMessages || (() => {})} />
        <Tab
          icon="briefcase"
          label="Requests"
          active
          badgeCount={requestCount}
          onPress={onJobRequests || (() => {})}
        />
        <Tab
          icon="notifications"
          label="Alerts"
          badgeCount={notificationCount}
          onPress={onNotifications || (() => {})}
        />
        <Tab icon="calendar" label="Calendar" onPress={onCalendar || (() => {})} />
        <Tab icon="settings" label="Settings" onPress={onSettings || (() => {})} />
      </View>

      <Modal
        visible={actionsMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={closeActionsMenu}
      >
        <Pressable style={styles.menuOverlay} onPress={closeActionsMenu}>
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeActionsMenu();
                void markAllRequestsAsRead();
              }}
            >
              <Ionicons name="checkmark-done" size={18} color="#C77A00" />
              <Text style={styles.menuItemText}>Mark All Read</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeActionsMenu();
                confirmClearAllRequests();
              }}
            >
              <Ionicons name="trash-outline" size={18} color="#C77A00" />
              <Text style={styles.menuItemText}>Delete All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeActionsMenu();
                setSelectionMode(true);
              }}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color="#C77A00" />
              <Text style={styles.menuItemText}>Select</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeActionsMenu();
                void markAllRequestsAsUnread();
              }}
            >
              <Ionicons name="mail-unread-outline" size={18} color="#C77A00" />
              <Text style={styles.menuItemText}>Mark All Unread</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
}

const Tab = ({
  icon,
  label,
  active = false,
  badgeCount,
  onPress,
}: {
  icon: any;
  label: string;
  active?: boolean;
  badgeCount?: number;
  onPress?: () => void;
}) => {
  const showBadge = typeof badgeCount === "number" && badgeCount > 0;

  return (
    <TouchableOpacity style={styles.tabItem} onPress={onPress}>
      <View style={styles.tabIconWrap}>
        <Ionicons name={icon} size={22} color={active ? "#FF80AB" : "#999"} />
        {showBadge ? (
          <View style={styles.tabBadge}>
            <Text style={styles.tabBadgeText}>{badgeCount! > 9 ? "9+" : badgeCount}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.tabLabel, active && styles.tabActive]}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
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
    fontSize: rf(20),
    fontWeight: "700",
    color: "#C77A00",
    fontFamily: "PlayfairDisplay",
    textAlign: "center",
  },
  headerSlot: {
    width: rs(72),
    alignItems: "flex-start",
    justifyContent: "center",
  },
  headerActions: {
    width: rs(72),
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: rs(8),
  },
  headerActionBtn: {
    width: rs(30),
    height: rs(30),
    borderRadius: rs(15),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  headerActionBtnDisabled: {
    opacity: 0.45,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    paddingTop: rs(72),
    paddingRight: rs(16),
    alignItems: "flex-end",
  },
  menuCard: {
    width: rs(190),
    backgroundColor: "#FFFFFF",
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,193,7,0.3)",
    paddingVertical: rs(6),
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(10),
    paddingHorizontal: rs(14),
    paddingVertical: rs(11),
  },
  menuItemText: {
    fontSize: rf(12),
    color: "#8B5E00",
    fontWeight: "600",
  },
  content: {
    flex: 1,
    paddingTop: rs(16),
    paddingBottom: rs(16),
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: rs(10),
  },
  iconCircle: {
    width: rs(120),
    height: rs(120),
    borderRadius: rs(60),
    backgroundColor: "rgba(255,193,7,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: rs(24),
  },
  title: {
    fontSize: rf(22),
    fontWeight: "700",
    color: "#C77A00",
    fontFamily: "PlayfairDisplay",
  },
  subtitle: {
    marginTop: rs(6),
    fontSize: rf(14),
    color: "#B07A1F",
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: rs(16),
    padding: rs(12),
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FFE28A",
  },
  cardUnread: {
    backgroundColor: "#FFF9ED",
    borderColor: "#FFC107",
    borderLeftWidth: 4,
    borderLeftColor: "#FFC107",
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: "#C77A00",
  },
  cardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: rs(12),
  },
  cardIconCircle: {
    width: rs(40),
    height: rs(40),
    borderRadius: rs(12),
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: rf(15),
    fontWeight: "700",
    color: "#8B5E00",
    fontFamily: "PlayfairDisplay",
  },
  cardTitleUnread: {
    color: "#7A4E00",
  },
  cardSubtitle: {
    fontSize: rf(12),
    color: "#8B5E00",
    marginTop: rs(2),
  },
  cardSubtitleUnread: {
    color: "#7A4E00",
    fontWeight: "600",
  },
  timeText: {
    marginTop: rs(6),
    fontSize: rf(11),
    color: "#8B5E00",
    fontWeight: "600",
  },
  detailText: {
    marginTop: rs(3),
    fontSize: rf(12),
    color: "#8B5E00",
  },
  selectionBadge: {
    width: rs(24),
    height: rs(24),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#C77A00",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: rs(8),
    backgroundColor: "#FFF9ED",
  },
  selectionBadgeActive: {
    backgroundColor: "#C77A00",
  },
  bottomBar: {
    position: "absolute",
    bottom: rs(0),
    left: rs(0),
    right: rs(0),
    backgroundColor: "#fff",
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: wp(2),
    paddingTop: hp(1.2),
    borderTopLeftRadius: rs(20),
    borderTopRightRadius: rs(20),
    elevation: 20,
  },
  tabItem: {
    flex: 1,
    minWidth: rs(0),
    alignItems: "center",
    justifyContent: "center",
  },
  tabIconWrap: {
    position: "relative",
  },
  tabBadge: {
    position: "absolute",
    top: -hp(0.7),
    right: -wp(2.5),
    minWidth: wp(4),
    height: wp(4),
    borderRadius: rs(8),
    backgroundColor: "#FF3B7B",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: wp(1),
  },
  tabBadgeText: {
    color: "#fff",
    fontSize: rf(9),
    fontWeight: "700",
  },
  tabLabel: {
    fontSize: rf(11),
    color: "#999",
    marginTop: hp(0.45),
    fontFamily: "PlayfairDisplay",
  },
  tabActive: {
    color: "#FF80AB",
    fontWeight: "700",
    fontFamily: "PlayfairDisplay",
  },
});
