import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { apiRequest, BASE_URL, isVerificationRequiredApiError, sanitizeToken } from "../Api";
import NannyBottomNav from "../components/NannyBottomNav";
import { subscribeToNotifications } from "../../lib/pusherClient";
import { rewriteLoopbackAbsoluteUrl } from "../../lib/urlHosts";

const API_BASE = BASE_URL;
const STORAGE_ROOT = API_BASE.replace(/\/api\/?$/, "");

/* ---------------- TYPES ---------------- */

type ThreadItem = {
  id: number | string;
  name: string;
  lastMessage?: string;
  lastTime?: string;
  nanny_id?: number | string | null;
  user_id?: number | string | null;
  unread?: number;
  unread_count?: number;
  user_image?: string | null; // This will be the parent's image
};
type ThreadId = string | number;

const normalizeStoredId = (value: unknown): string => {
  if (value === undefined || value === null) return "";

  const raw = String(value).trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw);
    const candidate =
      parsed?.nanny_id ||
      parsed?.user_id ||
      parsed?.id ||
      parsed?.data?.nanny_id ||
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

const getInitials = (name?: string) => {
  const value = String(name || "").trim();
  if (!value) return "??";
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return value.slice(0, 2).toUpperCase();
};

type Props = {
  navigation?: any;
  onBack?: () => void;
  onOpenChat?: (params: any) => void;
  nannyId?: string | number | null;
  onHome?: () => void;
  onJobs?: () => void;
  onCalendar?: () => void;
  onMessages?: () => void;
  onNotifications?: () => void;
  onSettings?: () => void;
  onRequireVerification?: () => void;
};

export default function NannyMessagesScreen({
  navigation,
  onBack,
  onOpenChat,
  nannyId,
  onHome,
  onJobs,
  onCalendar,
  onMessages,
  onNotifications,
  onSettings,
  onRequireVerification,
}: Props) {
  const insets = useSafeAreaInsets();

  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [filtered, setFiltered] = useState<ThreadItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [currentNannyId, setCurrentNannyId] = useState<
    string | number | null
  >(nannyId ?? null);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState<boolean>(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());

  /* ---------------- API ---------------- */

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const [tokenRaw, storedNannyIdRaw, storedUserIdRaw] = await Promise.all([
        AppStorage.getItem("token"),
        AppStorage.getItem("nanny_id"),
        AppStorage.getItem("user_id"),
      ]);

      const token = sanitizeToken(tokenRaw || undefined);
      const explicitNannyId = normalizeStoredId(nannyId);
      const storedNannyId = normalizeStoredId(storedNannyIdRaw);
      const legacyUserId = normalizeStoredId(storedUserIdRaw);

      const nannyIdCandidates = Array.from(
        new Set([explicitNannyId, storedNannyId, legacyUserId].filter(Boolean))
      );

      if (explicitNannyId || storedNannyId) {
        const preferredId = explicitNannyId || storedNannyId;
        setCurrentNannyId(preferredId);
      }

      const payloads: Record<string, any>[] = token
        ? [{}, ...nannyIdCandidates.map((id) => ({ nanny_id: id }))]
        : nannyIdCandidates.length > 0
        ? nannyIdCandidates.map((id) => ({ nanny_id: id }))
        : [{}];

      let raw: any[] = [];
      let lastError: any = null;
      for (let index = 0; index < payloads.length; index += 1) {
        try {
          const requestBody = payloads[index];
          const json = await apiRequest<any>("chat/conversations/list", {
            method: "POST",
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(requestBody),
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
        const user = String(thread.user_id || "").trim();
        const nanny = String(thread.nanny_id || "").trim();
        // Never show invalid self-conversations.
        if (user && nanny && user === nanny) return false;
        return true;
      });
      const inferredNannyId = normalizeStoredId(normalizedList[0]?.nanny_id);
      if (inferredNannyId) {
        setCurrentNannyId((prev) => prev || inferredNannyId);
      }
      setThreads(normalizedList);
      setFiltered(normalizedList);
    } catch (e) {
      if (isVerificationRequiredApiError(e)) {
        setThreads([]);
        setFiltered([]);
        onRequireVerification?.();
        return;
      }
      Alert.alert("Messages", "Unable to load conversations.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [nannyId, onRequireVerification]);

  useEffect(() => {
    void loadThreads();
    const unsubscribe = navigation?.addListener?.('focus', () => {
      void loadThreads();
      setImageErrors(new Set());
    });

    return () => unsubscribe?.();
  }, [loadThreads, navigation]);

  useEffect(() => {
    let unsub = () => {};

    (async () => {
      const userType = String((await AppStorage.getItem("user_type")) || "").trim().toLowerCase();
      const nannyStored = normalizeStoredId(await AppStorage.getItem("nanny_id"));
      const userStored = normalizeStoredId(await AppStorage.getItem("user_id"));
      const targetId =
        userType === "nanny" || userType === "syttr"
          ? (nannyStored || userStored)
          : (currentNannyId ? normalizeStoredId(currentNannyId) : "");
      if (!targetId) return;

      const sub = subscribeToNotifications(targetId, (payload) => {
        const type = String(payload?.type || payload?.notification?.type || "").trim().toLowerCase();
        if (type === "chat_message" || type === "chat") {
          void loadThreads();
        }
      });
      unsub = sub.unsubscribe;
    })();

    return () => {
      unsub();
    };
  }, [currentNannyId, loadThreads]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setImageErrors(new Set());
    void loadThreads();
  }, [loadThreads]);

  /* ---------------- SEARCH ---------------- */

  const handleSearch = (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setFiltered(threads);
      return;
    }
    const q = text.toLowerCase();
    setFiltered(
      threads.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          String(t.lastMessage || "").toLowerCase().includes(q)
      )
    );
  };

  const toggleThreadSelection = (item: ThreadItem) => {
    const threadId = String(item.id ?? "").trim();
    if (!threadId) return;

    setSelectionMode(true);
    setSelectedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
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
    setThreads((prev) => prev.filter((thread) => !idSet.has(String(thread.id || "").trim())));
    setFiltered((prev) => prev.filter((thread) => !idSet.has(String(thread.id || "").trim())));
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

  /* ---------------- RENDER ITEM ---------------- */

  const handleImageError = (itemId: ThreadId) => {
    setImageErrors(prev => {
      const newSet = new Set(prev);
      newSet.add(String(itemId));
      return newSet;
    });
  };

  const renderItem = useCallback(({ item }: { item: ThreadItem }) => {
    const unread = Number(item.unread || item.unread_count || 0);
    const hasUnread = unread > 0;
    const threadId = String(item.id ?? "").trim();
    const isSelected = threadId ? selectedThreadIds.has(threadId) : false;
    const hasImageError = imageErrors.has(threadId);
    
    // Add fallback checks with null/undefined handling
    const effectiveNannyId = item.nanny_id ?? currentNannyId ?? null;
    const effectiveUserId = item.user_id ?? null;
    
    const handlePress = () => {
      if (!item.id) {
        Alert.alert("Cannot open chat", "Missing conversation ID.");
        return;
      }

      if (!effectiveUserId && !effectiveNannyId) {
        Alert.alert("Cannot open chat", "Missing user information.");
        return;
      }

      const chatParams = {
        conversationId: item.id,
        nannyId: effectiveNannyId,
        userId: effectiveUserId,
        name: item.name || "Parent",
        userImage: item.user_image,
        avatar: item.user_image,
      };

      if (onOpenChat) {
        onOpenChat(chatParams);
        return;
      }

      Alert.alert("Error", "Chat navigation not configured. Please contact support.");
    };

    return (
      <TouchableOpacity
        style={[
          styles.thread,
          hasUnread && styles.threadUnread,
          isSelected && styles.threadSelected,
        ]}
        onPress={() => {
          if (selectionMode) {
            toggleThreadSelection(item);
            return;
          }
          handlePress();
        }}
        onLongPress={() => {
          if (selectionMode) {
            toggleThreadSelection(item);
            return;
          }
          toggleThreadSelection(item);
        }}
        activeOpacity={0.7}
      >
        <View style={[styles.avatar, hasUnread && styles.avatarUnread]}>
          {item.user_image && !hasImageError ? (
            <Image 
              source={{ uri: item.user_image }}
              style={styles.avatarImage}
              onError={() => handleImageError(item.id)}
              resizeMode="cover"
            />
          ) : (
            <Text style={styles.avatarText}>
              {getInitials(item.name)}
            </Text>
          )}
        </View>

        <View style={styles.threadContent}>
          <View style={styles.rowBetween}>
            <Text 
              style={[styles.threadName, hasUnread && styles.threadNameUnread]}
              numberOfLines={1}
            >
              {item.name || "Parent"}
            </Text>
            <View style={styles.metaRight}>
              {item.lastTime ? (
                <Text style={[styles.threadTime, hasUnread && styles.threadTimeUnread]}>
                  {formatTime(item.lastTime)}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.rowBetween}>
            <Text 
              style={[styles.threadMsg, hasUnread && styles.threadMsgUnread]} 
              numberOfLines={1}
            >
              {item.lastMessage || "Tap to chat"}
            </Text>
            {hasUnread ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{unread > 9 ? "9+" : unread}</Text>
              </View>
            ) : selectionMode ? null : (
              <Ionicons name="chevron-forward" size={18} color="#C2185B" />
            )}
          </View>
        </View>
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
  }, [currentNannyId, imageErrors, navigation, onOpenChat, selectedThreadIds, selectionMode]);

  /* ---------------- UI ---------------- */

  return (
    <LinearGradient
      colors={["#FFFFFF", "#FFFFFF", "#FFFFFF"]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.container}
    >
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh}
            colors={["#FF80AB"]}
            tintColor="#FF80AB"
          />
        }
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: rs(88) + Math.max(insets.bottom, 8) },
        ]}
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color="#FF80AB" />
              <Text style={styles.loadingText}>Loading messages...</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubbles-outline" size={48} color="#FF80AB" />
              <Text style={styles.empty}>
                No conversations yet.{'\n'}Start chatting with parents.
              </Text>
            </View>
          )
        }
        ListHeaderComponent={
          <>
            <View style={styles.headerCard}>
              <View style={styles.headerInner}>
                <View style={styles.headerSide} />
                <Text style={styles.title}>Messages</Text>
                <View style={styles.headerActions}>
                  {selectionMode ? (
                    <>
                      <TouchableOpacity
                        style={styles.circleBtn}
                        onPress={clearSelection}
                      >
                        <Ionicons name="close" size={18} color="#C2185B" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.circleBtn, selectedThreadIds.size === 0 && styles.circleBtnDisabled]}
                        onPress={confirmDeleteSelectedThreads}
                        disabled={selectedThreadIds.size === 0}
                      >
                        <Ionicons name="trash-outline" size={18} color="#C2185B" />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={styles.circleBtn}
                        onPress={() => setSelectionMode(true)}
                      >
                        <Ionicons name="checkmark-circle-outline" size={18} color="#C2185B" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.circleBtn}
                        onPress={loadThreads}
                      >
                        <Ionicons name="refresh" size={18} color="#C2185B" />
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            </View>

            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color="#C2185B" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search conversations..."
                placeholderTextColor="#B76B88"
                value={query}
                onChangeText={handleSearch}
                returnKeyType="search"
                clearButtonMode="never"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => handleSearch("")}>
                  <Ionicons name="close-circle" size={16} color="#C2185B" />
                </TouchableOpacity>
              )}
            </View>
          </>
        }
      />

      <NannyBottomNav
        active="Messages"
        onHome={onHome}
        onJobs={onJobs}
        onCalendar={onCalendar}
        onMessages={onMessages}
        onNotifications={onNotifications}
        onSettings={onSettings}
        navigation={navigation}
      />
    </LinearGradient>
  );
}

/* ---------------- HELPERS ---------------- */

const buildFullImageUrl = (imagePath: string | null | undefined): string | null => {
  if (!imagePath) return null;
  
  try {
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      const resolvedUrl = rewriteLoopbackAbsoluteUrl(imagePath, STORAGE_ROOT);
      return resolvedUrl;
    }
    if (imagePath.startsWith("data:") || imagePath.startsWith("blob:")) {
      return imagePath;
    }
    if (imagePath.startsWith("//")) return `https:${imagePath}`;

    const cleanPath = imagePath.replace(/^\/+/, '');
    let fullUrl = "";

    if (cleanPath.startsWith("uploads/")) {
      fullUrl = `${STORAGE_ROOT.replace(/\/+$/, "")}/${cleanPath}`;
    } else if (cleanPath.startsWith("storage/") || cleanPath.startsWith("public/")) {
      fullUrl = `${STORAGE_ROOT.replace(/\/+$/, "")}/${cleanPath}`;
    } else {
      fullUrl = `${STORAGE_ROOT.replace(/\/+$/, "")}/storage/${cleanPath}`;
    }
    
    return fullUrl;
  } catch {
    return null;
  }
};

function normalizeThreads(raw: any[]): ThreadItem[] {
  if (!Array.isArray(raw)) return [];

  const looksLikeMessages =
    raw.length > 0 && raw[0]?.message && !raw[0]?.last_message && !raw[0]?.lastMessage;

  if (looksLikeMessages) {
    const grouped: Record<string, { last: any; unread: number }> = {};

    for (const m of raw) {
      const key = String(m?.conversation_id || `${m?.nanny_id || ""}-${m?.user_id || ""}`);
      if (!key) continue;
      if (!grouped[key]) grouped[key] = { last: m, unread: 0 };

      const isUnread =
        m?.is_read === 0 ||
        m?.is_read === "0" ||
        m?.isRead === false ||
        m?.read === 0;
      if (isUnread) grouped[key].unread += 1;

      const prevTime = Date.parse(String(grouped[key].last?.created_at || grouped[key].last?.time || 0));
      const currTime = Date.parse(String(m?.created_at || m?.time || 0));
      if (Number.isFinite(currTime) && currTime > (Number.isFinite(prevTime) ? prevTime : 0)) {
        grouped[key].last = m;
      }
    }

    return Object.values(grouped)
      .map((entry) => normalizeThread({ ...entry.last, unread_count: entry.unread }))
      .filter((item) => !!item.id)
      .sort(compareThreadTime);
  }

  return raw
    .map(normalizeThread)
    .filter((item) => !!item.id)
    .sort(compareThreadTime);
}

function normalizeThread(t: any): ThreadItem {
  const rawLast = t.last_message || t.lastMessage || t.message || t.last_message_obj;
  const msgObj = rawLast && typeof rawLast === "object" ? rawLast : {};
  const lastMessage =
    msgObj.message ||
    msgObj.text ||
    msgObj.body ||
    (typeof rawLast === "string" ? rawLast : "") ||
    "";
  const lastTime =
    msgObj.created_at ||
    msgObj.updated_at ||
    t.updated_at ||
    t.created_at ||
    t.time ||
    "";
  const unreadCount = Number(
    t.unread ??
      t.unread_count ??
      t.unreadCount ??
      t.unread_messages ??
      t.unread_message_count ??
      0
  );

  const userId =
    t.user_id ||
    t.user?.id ||
    t.parent_id ||
    t.client_id ||
    t.last_message?.user_id ||
    null;
  const nannyId =
    t.nanny_id ||
    t.nanny?.id ||
    t.last_message?.nanny_id ||
    null;

  const parentName =
    t.user?.name ||
    t.parent?.name ||
    t.client?.name ||
    t.name ||
    "Parent";

  const parentImage =
    t.user_image ||
    t.avatar ||
    t.user_profile?.user_image ||
    t.user_profile?.profile_image ||
    t.user?.user_image_url ||
    t.user?.user_image ||
    t.user?.profile_image ||
    t.user?.avatar ||
    t.profile_image ||
    null;
  const fullParentImageUrl = buildFullImageUrl(parentImage);

  return {
    id: t.id || t.conversation_id || t.chat_id,
    name: parentName,
    lastMessage,
    lastTime,
    nanny_id: nannyId,
    user_id: userId,
    user_image: fullParentImageUrl,
    unread: Number.isFinite(unreadCount) ? unreadCount : 0,
    unread_count: Number.isFinite(unreadCount) ? unreadCount : 0,
  };
}

function compareThreadTime(a: ThreadItem, b: ThreadItem): number {
  const aTime = parseThreadTime(a);
  const bTime = parseThreadTime(b);
  return bTime - aTime;
}

function parseThreadTime(t: ThreadItem): number {
  if (!t.lastTime) return 0;
  const ts = Date.parse(String(t.lastTime));
  return Number.isNaN(ts) ? Date.now() : ts;
}

function formatTime(value?: string) {
  if (!value) return "";
  
  try {
    const ts = new Date(value);
    if (isNaN(ts.getTime())) return "";
    
    const now = new Date();
    const diffMs = now.getTime() - ts.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);

    if (diffHrs > 24) {
      return ts.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return ts.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: wp(3),
    paddingTop: rs(2),
  },
  headerCard: {
    borderRadius: rs(18),
    marginBottom: hp(1.2),
    backgroundColor: "rgba(255,255,255,0.9)",
    elevation: 2,
  },
  headerInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(14),
  },
  headerSide: { width: rs(34) },
  headerActions: {
    minWidth: rs(72),
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: rs(8),
  },
  circleBtn: {
    width: wp(8.5),
    height: wp(8.5),
    borderRadius: rs(17),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  circleBtnDisabled: {
    opacity: 0.45,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: rf(20),
    fontWeight: "700",
    color: "#C77A00",
    fontFamily: "PlayfairDisplay",
  },
  subTitle: {
    fontSize: rf(12),
    color: "#C26B8C",
    marginTop: hp(0.45),
    fontFamily: "PlayfairDisplay",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: rs(16),
    paddingHorizontal: wp(3.5),
    paddingVertical: hp(1.4),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    marginBottom: hp(1.4),
  },
  searchInput: {
    flex: 1,
    marginHorizontal: wp(2.5),
    color: "#880E4F",
    fontFamily: "PlayfairDisplay",
    fontSize: rf(14),
  },
  thread: {
    flexDirection: "row",
    alignItems: "center",
    padding: rs(14),
    backgroundColor: "#FFF",
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.12)",
    marginVertical: hp(0.7),
  },
  threadContent: {
    flex: 1,
    marginHorizontal: wp(2.5),
  },
  threadUnread: {
    backgroundColor: "#FFF5F9",
    borderColor: "#FF80AB",
    borderLeftWidth: 4,
    borderLeftColor: "#FF80AB",
  },
  threadSelected: {
    borderWidth: 2,
    borderColor: "#C2185B",
  },
  avatar: {
    width: wp(10.5),
    height: wp(10.5),
    borderRadius: rs(21),
    backgroundColor: "#FFE7F0",
    alignItems: "center",
    justifyContent: "center",
    overflow: 'hidden',
  },
  avatarUnread: {
    backgroundColor: "#FFDCEB",
  },
  avatarImage: {
    width: wp(10.5),
    height: wp(10.5),
    borderRadius: rs(21),
  },
  avatarText: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(14),
  },
  threadName: {
    color: "#880E4F",
    fontWeight: "700",
    fontSize: rf(13),
    fontFamily: "PlayfairDisplay",
    flex: 1,
    marginRight: wp(2),
  },
  threadNameUnread: {
    color: "#6F0036",
  },
  threadMsg: {
    color: "#6B4350",
    fontSize: rf(11),
    marginTop: hp(0.2),
    fontFamily: "PlayfairDisplay",
    flex: 1,
    marginRight: wp(2),
  },
  threadMsgUnread: {
    color: "#8B1145",
    fontWeight: "600",
  },
  threadTime: {
    color: "#B76B88",
    fontSize: rf(10),
    fontFamily: "PlayfairDisplay",
  },
  threadTimeUnread: {
    color: "#C2185B",
    fontWeight: "700",
  },
  metaRight: {
    alignItems: "flex-end",
    marginLeft: wp(2),
  },
  unreadBadge: {
    minWidth: wp(5.5),
    paddingHorizontal: wp(1.5),
    height: wp(5.5),
    borderRadius: rs(11),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(12),
  },
  selectionBadge: {
    width: rs(24),
    height: rs(24),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#C2185B",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF5F9",
    marginLeft: wp(2),
  },
  selectionBadgeActive: {
    backgroundColor: "#C2185B",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: hp(4.8),
  },
  loadingText: {
    color: "#AD1457",
    fontSize: rf(14),
    fontWeight: "600",
    marginTop: hp(1.4),
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: hp(7.1),
  },
  empty: {
    textAlign: "center",
    color: "#6B4350",
    fontSize: rf(14),
    fontFamily: "PlayfairDisplay",
    lineHeight: rs(20),
    marginTop: hp(1.9),
  },
  listContent: {},
});
