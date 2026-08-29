/// <reference types="react" />
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { hp, rf, rs, wp } from "../utils/responsive";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest, BASE_URL, getRuntimeApiKey, isVerificationRequiredApiError, sanitizeToken } from "../Api";
import { fetchUnreadParentRequestCount } from "../../lib/parentRequestNotifications";
import { fetchUnreadConversationCount } from "../../lib/chatUnreadCount";
import { subscribeToNotifications } from "../../lib/pusherClient";
import { rewriteLoopbackAbsoluteUrl } from "../../lib/urlHosts";

/* ----------------------------- TYPES ----------------------------- */

type Thread = {
  id: string | number;
  conversation_id?: string | number;
  nanny_id?: number;
  user_id?: number;
  name?: string;
  title?: string;
  avatar?: string;
  lastMessage?: string;
  message?: string;
  time?: string;
  created_at?: string;
  updated_at?: string;
  unread?: number;
  unread_count?: number;
  nanny?: any;
  nanny_profile?: any;
  user?: any;
};

type Props = {
  navigation?: any;
  onBack?: () => void;
  onOpenChat?: (params: {
    conversationId?: number | string;
    nannyId?: number | string;
    userId?: number | string;
    name?: string;
    avatar?: string;
  }) => void;
  onHome?: () => void;
  onMessages?: () => void;
  onJobRequests?: () => void;
  onNotifications?: () => void;
  onCalendar?: () => void;
  onSettings?: () => void;
  onRequireVerification?: () => void;
};

const API_BASE = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}`;
const STORAGE_ROOT = API_BASE.replace(/\/api\/?$/, "");

const normalizeStoredId = (value: unknown): string => {
  if (value === undefined || value === null) return "";

  const raw = String(value).trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw);
    const candidate =
      parsed?.user_id ||
      parsed?.id ||
      parsed?.nanny_id ||
      parsed?.data?.user_id ||
      parsed?.data?.id;
    if (candidate !== undefined && candidate !== null) {
      return String(candidate).replace(/"/g, "").trim();
    }
  } catch {
    // keep raw fallback
  }

  return raw.replace(/"/g, "").trim();
};

const extractConversationRows = (json: any): any[] => {
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json?.rows)) return json.rows;
  if (Array.isArray(json?.conversations)) return json.conversations;
  if (Array.isArray(json)) return json;
  return [];
};

const isNotificationRead = (
  item?: { isRead?: unknown; is_read?: unknown } | null
): boolean => {
  if (!item) return false;
  if (item.isRead === true) return true;

  const raw = item.is_read;
  if (raw === true || raw === 1 || raw === "1") return true;
  if (typeof raw === "string" && raw.toLowerCase() === "true") return true;
  return false;
};

/* ----------------------------- COMPONENT ----------------------------- */

export default function ClientMessagesScreen({
  navigation,
  onBack,
  onOpenChat,
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
  const [threads, setThreads] = useState<Thread[]>([]);
  const [filtered, setFiltered] = useState<Thread[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [notificationCount, setNotificationCount] = useState<number>(0);
  const [requestCount, setRequestCount] = useState<number>(0);
  const [messageCount, setMessageCount] = useState<number>(0);
  const [selectionMode, setSelectionMode] = useState<boolean>(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      await loadThreads();
      await loadRequestCount();
      await loadNotificationCount();
      await loadMessageCount();
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation?.addListener?.("focus", () => {
      void loadThreads();
      void loadRequestCount();
      void loadNotificationCount();
      void loadMessageCount();
    });
    return () => unsubscribe?.();
  }, [navigation]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void loadThreads();
        void loadNotificationCount();
        void loadMessageCount();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let unsub = () => {};

    (async () => {
      const userId = normalizeStoredId(
        (await AsyncStorage.getItem("user_id")) || (await AsyncStorage.getItem("id"))
      );
      if (!userId) return;

      const sub = subscribeToNotifications(userId, (payload) => {
        const type = String(payload?.type || payload?.notification?.type || "").trim().toLowerCase();
        if (type === "chat_message" || type === "chat") {
          void loadThreads();
          void loadMessageCount();
        }
      });
      unsub = sub.unsubscribe;
    })();

    return () => {
      unsub();
    };
  }, []);

  /* ----------------------------- LOAD THREADS ----------------------------- */

  const loadThreads = async (): Promise<void> => {
    setLoading(true);
    try {
      const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
      const userId = normalizeStoredId(
        (await AsyncStorage.getItem("user_id")) || (await AsyncStorage.getItem("id"))
      );

      const payloads: Record<string, any>[] = token
        ? [{}, ...(userId ? [{ user_id: userId }] : [])]
        : userId
        ? [{ user_id: userId }]
        : [{}];

      let raw: any[] = [];
      let lastError: any = null;
      for (let index = 0; index < payloads.length; index += 1) {
        try {
          const payload = payloads[index];
          const json = await apiRequest<any>("chat/conversations/list", {
            method: "POST",
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(payload),
          });
          const rows = extractConversationRows(json);
          raw = rows;
          lastError = null;
          if (rows.length > 0 || index === payloads.length - 1) {
            break;
          }
        } catch (error) {
          lastError = error;
          if (index === payloads.length - 1) {
            throw error;
          }
        }
      }

      if (lastError) throw lastError;

      const normalizedList = normalizeThreads(raw).filter((thread) => {
        const user = String((thread as any).user_id || "").trim();
        const nanny = String((thread as any).nanny_id || "").trim();
        // Never show invalid self-conversations.
        if (user && nanny && user === nanny) return false;
        return true;
      });

      setThreads(normalizedList);
      setFiltered(normalizedList);
    } catch (e) {
      if (isVerificationRequiredApiError(e)) {
        setThreads([]);
        setFiltered([]);
        onRequireVerification?.();
        return;
      }
      console.log("threads load error", e);
      Alert.alert("Messages", "We couldn't load your conversations. Please pull to refresh.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  /* ----------------------------- REFRESH ----------------------------- */

  const onRefresh = () => {
    setRefreshing(true);
    loadThreads();
    loadRequestCount();
    loadNotificationCount();
    loadMessageCount();
  };

  const loadRequestCount = async () => {
    try {
      const count = await fetchUnreadParentRequestCount();
      setRequestCount(count);
    } catch {
      setRequestCount(0);
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

      const res = await fetch(
        `${BASE_URL}notifications?user_id=${encodeURIComponent(String(userId))}`,
        { headers }
      );
      const json = await res.json().catch(() => null);
      const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      const unread = data.filter((item: any) => !isNotificationRead(item));
      setNotificationCount(unread.length);
    } catch {
      setNotificationCount(0);
    }
  };

  /* ----------------------------- SEARCH ----------------------------- */

  const handleSearch = (text: string): void => {
    setQuery(text);

    if (!text.trim()) {
      setFiltered(threads);
      return;
    }

    const q = text.toLowerCase();

    setFiltered(
      threads.filter(
        (t) =>
          String(t.name || t.title || "")
            .toLowerCase()
            .includes(q) ||
          String(t.lastMessage || t.message || "")
            .toLowerCase()
            .includes(q)
      )
    );
  };

  const toggleThreadSelection = (thread: Thread) => {
    const id = String(thread.id || thread.conversation_id || "").trim();
    if (!id) return;

    setSelectionMode(true);
    setSelectedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedThreadIds(new Set());
  };

  const removeThreadsByIds = (ids: string[]) => {
    const idSet = new Set(ids);
    setThreads((prev) =>
      prev.filter((thread) => !idSet.has(String(thread.id || thread.conversation_id || "").trim()))
    );
    setFiltered((prev) =>
      prev.filter((thread) => !idSet.has(String(thread.id || thread.conversation_id || "").trim()))
    );
    clearSelection();
  };

  const confirmDeleteSelectedThreads = () => {
    const ids = Array.from(selectedThreadIds);
    if (!ids.length) return;

    const runDelete = () => removeThreadsByIds(ids);

    if (Platform.OS === "web") {
      const ok = window.confirm(`Delete ${ids.length} selected chat${ids.length === 1 ? "" : "s"} from your list?`);
      if (ok) runDelete();
      return;
    }

    Alert.alert(
      "Delete chats",
      `Remove ${ids.length} selected conversation${ids.length === 1 ? "" : "s"} from your messages list?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: runDelete },
      ]
    );
  };

  /* ----------------------------- OPEN CHAT ----------------------------- */

  /* ----------------------------- RENDER ITEM ----------------------------- */

  const renderItem = ({ item }: { item: Thread }) => {
    const unread = Number(item.unread || item.unread_count || 0);
    const hasUnread = unread > 0;
    const threadId = String(item.id || item.conversation_id || "").trim();
    const isSelected = threadId ? selectedThreadIds.has(threadId) : false;
    const last = item.lastMessage || item.message || "Tap to chat";
    const time =
      item.time ||
      item.updated_at ||
      item.created_at ||
      "";

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => {
          if (selectionMode) {
            toggleThreadSelection(item);
            return;
          }
          const resolvedAvatar =
            item.avatar ||
            resolveImageUrl(
              item.nanny?.avatar ||
                item.nanny?.profile_image ||
                item.nanny?.user_image_url ||
                item.nanny?.user_image ||
                item.nanny_profile?.profile_image ||
                item.nanny_profile?.nanny_image ||
                item.nanny_profile?.image
            );
          const params = {
            conversationId: item.conversation_id || item.id,
            nannyId: item.nanny_id,
            userId: item.user_id,
            name: item.name,
            avatar: resolvedAvatar,
            userImage: resolvedAvatar,
          };
          if (onOpenChat) {
            onOpenChat(params);
            return;
          }
          navigation?.navigate?.("ClientChat", params);
        }}
        onLongPress={() => {
          if (selectionMode) {
            toggleThreadSelection(item);
            return;
          }
          toggleThreadSelection(item);
        }}
        style={[
          styles.card,
          hasUnread && styles.cardUnread,
          isSelected && styles.cardSelected,
        ]}
      >
        <View style={[styles.avatarCircle, hasUnread && styles.avatarCircleUnread]}>
          {(item.avatar ||
            item.nanny?.profile_image ||
            item.nanny?.user_image_url ||
            item.nanny?.user_image) ? (
            <Image
              source={{
                uri:
                  item.avatar ||
                  resolveImageUrl(
                    item.nanny?.profile_image ||
                      item.nanny?.user_image_url ||
                      item.nanny?.user_image
                  ),
              }}
              style={styles.avatarImage}
            />
          ) : (
            <Ionicons name="person" size={22} color="#FF80AB" />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <View style={styles.cardRow}>
            <Text style={[styles.cardTitle, hasUnread && styles.cardTitleUnread]} numberOfLines={1}>
              {item.name || "Conversation"}
            </Text>
            <View style={styles.metaRight}>
              <Text style={[styles.cardTime, hasUnread && styles.cardTimeUnread]}>
                {formatTime(time)}
              </Text>
              {hasUnread ? (
                <View style={styles.unreadPill}>
                  <Text style={styles.unreadPillText}>Unread</Text>
                </View>
              ) : null}
            </View>
          </View>

          <Text style={[styles.cardSubtitle, hasUnread && styles.cardSubtitleUnread]} numberOfLines={1}>
            {last}
          </Text>
        </View>

        {hasUnread && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>
              {unread > 9 ? "9+" : unread}
            </Text>
          </View>
        )}
        {selectionMode ? (
          <View style={[styles.selectionBadge, isSelected && styles.selectionBadgeActive]}>
            <Ionicons
              name={isSelected ? "checkmark" : "ellipse-outline"}
              size={16}
              color={isSelected ? "#FFFFFF" : "#C2185B"}
            />
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  /* ----------------------------- UI ----------------------------- */

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {selectionMode ? (
            <TouchableOpacity style={styles.headerActionBtn} onPress={clearSelection}>
              <Ionicons name="close" size={18} color="#C77A00" />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={styles.headerActions}>
          {selectionMode ? (
            <TouchableOpacity
              style={[styles.headerActionBtn, selectedThreadIds.size === 0 && styles.headerActionBtnDisabled]}
              onPress={confirmDeleteSelectedThreads}
              disabled={selectedThreadIds.size === 0}
            >
              <Ionicons name="trash-outline" size={18} color="#C77A00" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.headerActionBtn} onPress={() => setSelectionMode(true)}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#C77A00" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* SEARCH */}
      <View style={styles.search}>
        <Ionicons name="search" size={18} color="#FF80AB" />
        <TextInput
          placeholder="Search conversations..."
          value={query}
          onChangeText={handleSearch}
          style={styles.searchInput}
          placeholderTextColor="#AD1457"
          clearButtonMode="never"
        />
        {query ? (
          <TouchableOpacity onPress={() => handleSearch("")}>
            <Ionicons name="close" size={18} color="#FF80AB" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* CONTENT */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FF80AB" />
          <Text style={styles.loadingText}>Loading messages...</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={40}
            color="#FF80AB"
          />
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyText}>
            Send a message to start the conversation.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, idx) =>
            item.id?.toString() || `t-${idx}`
          }
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          }
          contentContainerStyle={{
            padding: rs(16),
            gap: rs(10),
            paddingBottom: rs(88) + Math.max(insets.bottom, 8),
          }}
        />
      )}

      <View
        style={[
          styles.bottomBar,
          {
            bottom: bottomBarOffset,
            paddingBottom: Math.max(8, insets.bottom),
          height: rs(60) + Math.max(8, insets.bottom),
          pointerEvents: "auto" as any,
          },
        ]}
      >
        <Tab
          icon="home"
          label="Home"
          onPress={() => {
            if (onHome) onHome();
            else navigation?.navigate?.("ParentsHomeTabs");
          }}
        />
        <Tab icon="chatbubble" label="Chat" active badgeCount={messageCount} />
        <Tab
          icon="briefcase"
          label="Requests"
          badgeCount={requestCount}
          onPress={onJobRequests}
        />
        <Tab
          icon="notifications"
          label="Alerts"
          onPress={() => {
            if (onNotifications) onNotifications();
            else navigation?.navigate?.("Notifications");
          }}
          badgeCount={notificationCount}
        />
        <Tab
          icon="calendar"
          label="Calendar"
          onPress={() => {
            if (onCalendar) onCalendar();
            else navigation?.navigate?.("Calendar");
          }}
        />
        <Tab
          icon="settings"
          label="Settings"
          onPress={() => {
            if (onSettings) onSettings();
            else navigation?.navigate?.("Settings");
          }}
        />
      </View>
    </View>
  );
}

/* ----------------------------- HELPERS ----------------------------- */

function formatTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);

  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function normalizeThreads(rawList: any[]): Thread[] {
  if (!Array.isArray(rawList)) return [];

  const looksLikeMessages =
    rawList.length > 0 && rawList[0].message && !rawList[0].lastMessage;

  if (looksLikeMessages) {
    const grouped: Record<
      string,
      { last: any; unread: number }
    > = {};

    for (const m of rawList) {
      const key =
        m.conversation_id || `${m.nanny_id || ""}-${m.user_id || ""}`;

      if (!grouped[key]) grouped[key] = { last: m, unread: 0 };

      if (m.is_read === 0) {
        grouped[key].unread += 1;
      }

      const prevDate = new Date(
        grouped[key].last.created_at || grouped[key].last.time || 0
      ).getTime();

      const currDate = new Date(
        m.created_at || m.time || 0
      ).getTime();

      if (currDate > prevDate) grouped[key].last = m;
    }

    return Object.values(grouped)
      .map((entry) =>
        normalizeThread({ ...entry.last, unread_count: entry.unread })
      )
      .sort((a, b) => compareThreadTime(b, a));
  }

  return rawList.map(normalizeThread).sort((a, b) => compareThreadTime(b, a));
}

function normalizeThread(t: any): Thread {
  const rawLast =
    t.last_message ||
    t.lastMessage ||
    t.lastMessageObj ||
    t.last_message_obj;
  const lastObj =
    rawLast && typeof rawLast === "object" ? rawLast : {};
  const last =
    lastObj.message ||
    lastObj.lastMessage ||
    lastObj.text ||
    lastObj.body ||
    t.last_message_text ||
    (typeof rawLast === "string" ? rawLast : "") ||
    (typeof t.lastMessage === "string" ? t.lastMessage : "") ||
    t.message ||
    "";

  const time =
    lastObj.created_at ||
    lastObj.updated_at ||
    t.last_message_at ||
    t.time ||
    t.updated_at ||
    t.created_at ||
    "";

  const nannyName =
    t.nanny?.fullname ||
    t.nanny?.name ||
    t.nanny_name ||
    t.sitter?.fullname ||
    t.sitter?.name ||
    t.sitter_name;

  const userName =
    t.user?.name || t.user_name || t.parent_name;

  const rawAvatar =
    t.nanny?.avatar ||
    t.nanny?.profile_image ||
    t.nanny?.user_image_url ||
    t.nanny?.user_image ||
    t.sitter?.avatar ||
    t.sitter?.profile_image ||
    t.sitter?.user_image_url ||
    t.sitter?.user_image ||
    t.avatar ||
    t.profile_image ||
    t.nanny_profile?.profile_image ||
    t.nanny_profile?.nanny_image ||
    t.nanny_profile?.image ||
    t.user?.avatar ||
    t.user?.profile_image ||
    t.user_profile?.user_image ||
    t.user_profile?.profile_image;
  const avatar = resolveImageUrl(rawAvatar);

  return {
    ...t,
    id: t.id || t.conversation_id || t.chat_id,
    conversation_id: t.conversation_id || t.id || t.chat_id,
    nanny_id:
      t.nanny_id ||
      t.nannyId ||
      t.nanny?.id ||
      t.sitter?.id ||
      t.last_message?.nanny_id ||
      t.lastMessage?.nanny_id,
    user_id:
      t.user_id ||
      t.userId ||
      t.user?.id ||
      t.parent?.id ||
      t.client?.id ||
      t.last_message?.user_id ||
      t.lastMessage?.user_id,
    name:
      nannyName ||
      t.contact_name ||
      t.fullname ||
      t.name ||
      userName ||
      t.title ||
      "Conversation",
    avatar,
    lastMessage: last,
    time,
    unread: Number(t.unread ?? t.unread_count ?? t.unreadCount ?? 0),
    unread_count: Number(t.unread ?? t.unread_count ?? t.unreadCount ?? 0),
  };
}

function resolveImageUrl(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    return rewriteLoopbackAbsoluteUrl(raw, STORAGE_ROOT);
  }
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return `${STORAGE_ROOT}${raw}`;
  const clean = raw.replace(/^\/+/, "");
  if (clean.startsWith("storage/") || clean.startsWith("public/")) {
    return `${STORAGE_ROOT}/${clean}`;
  }
  return `${STORAGE_ROOT}/storage/${clean}`;
}

function compareThreadTime(a: Thread, b: Thread): number {
  const aTime = parseThreadTime(a);
  const bTime = parseThreadTime(b);
  return aTime - bTime;
}

function parseThreadTime(t: Thread): number {
  const raw = t.time || t.updated_at || t.created_at || "";
  const ts = Date.parse(String(raw));
  return Number.isNaN(ts) ? 0 : ts;
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
            <Text style={styles.tabBadgeText}>
              {badgeCount! > 9 ? "9+" : badgeCount}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.tabLabel, active && styles.tabActive]}>{label}</Text>
    </TouchableOpacity>
  );
};

/* ----------------------------- STYLES ----------------------------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },

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
  },
  headerSide: {
    width: rs(40),
    alignItems: "flex-start",
    justifyContent: "center",
  },
  headerActions: {
    width: rs(40),
    alignItems: "flex-end",
    justifyContent: "center",
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

  search: {
    margin: rs(16),
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: rs(14),
    paddingHorizontal: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.25)",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },

  searchInput: {
    flex: 1,
    paddingVertical: hp(1.2),
    paddingHorizontal: wp(2),
    color: "#880E4F",
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: wp(2),
  },
  loadingText: {
    fontSize: rf(12),
    color: "#AD1457",
    fontWeight: "600",
  },

  emptyTitle: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
  },

  emptyText: {
    fontSize: rf(12),
    color: "#AD1457",
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: rs(16),
    padding: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardUnread: {
    backgroundColor: "#FFF5F9",
    borderColor: "#FF80AB",
    borderLeftWidth: 4,
    borderLeftColor: "#FF80AB",
  },
  cardSelected: {
    borderColor: "#C2185B",
    borderWidth: 2,
  },

  avatarCircle: {
    width: wp(11.5),
    height: wp(11.5),
    borderRadius: rs(23),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
    marginRight: wp(3),
  },
  avatarCircleUnread: {
    backgroundColor: "#FFDCEB",
  },
  avatarImage: {
    width: wp(11.5),
    height: wp(11.5),
    borderRadius: rs(23),
  },

  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaRight: {
    alignItems: "flex-end",
    marginLeft: wp(2),
    gap: wp(1),
  },

  cardTitle: {
    fontSize: rf(14),
    fontWeight: "700",
    color: "#880E4F",
  },
  cardTitleUnread: {
    color: "#6F0036",
  },

  cardSubtitle: {
    fontSize: rf(12),
    color: "#AD1457",
    marginTop: hp(0.45),
  },
  cardSubtitleUnread: {
    color: "#8B1145",
    fontWeight: "600",
  },

  cardTime: {
    fontSize: rf(10),
    color: "#B07A8F",
  },
  cardTimeUnread: {
    color: "#C2185B",
    fontWeight: "700",
  },
  unreadPill: {
    backgroundColor: "#FFE4EF",
    borderRadius: rs(9),
    paddingHorizontal: wp(2),
    paddingVertical: hp(0.2),
    borderWidth: 1,
    borderColor: "#FF80AB",
  },
  unreadPillText: {
    color: "#C2185B",
    fontSize: rf(10),
    fontWeight: "700",
  },

  unreadBadge: {
    backgroundColor: "#FF80AB",
    borderRadius: rs(10),
    paddingHorizontal: wp(2),
    paddingVertical: hp(0.45),
    marginLeft: wp(2),
  },

  unreadText: {
    color: "#fff",
    fontSize: rf(11),
    fontWeight: "700",
  },
  selectionBadge: {
    width: rs(24),
    height: rs(24),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#C2185B",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: wp(2),
    backgroundColor: "#FFF5F9",
  },
  selectionBadgeActive: {
    backgroundColor: "#C2185B",
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
