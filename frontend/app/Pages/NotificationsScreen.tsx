/// <reference types="react" />
import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    AppState,
    Alert,
    FlatList,
    Keyboard,
    ListRenderItem,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { hp, rf, rs, wp } from "../utils/responsive";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest, getRuntimeApiKey, sanitizeToken } from "../Api";
import { formatDateToMDY } from "../utils/dateFormat";
import { fetchUnreadParentRequestCount } from "../../lib/parentRequestNotifications";
import { fetchUnreadConversationCount } from "../../lib/chatUnreadCount";
import { subscribeToNotifications } from "../../lib/pusherClient";

const HIDDEN_NOTIFICATIONS_KEY = "hidden_notifications_parent";

/* ----------------------------- TYPES ----------------------------- */

type NotificationItem = {
  id?: number | string;
  title?: string;
  subtitle?: string;
  message?: string;
  time?: string;
  created_at?: string;
  isRead?: boolean;
  is_read?: number | boolean | string;
  type?: string;
  job_id?: number | string;
  status?: string;
  application_id?: number | string;
  application?: any;
  job?: any;
  nanny?: any;
  raw?: any;
  application_status?: string;
};

type RatedSyttrTargets = {
  applicationIds: Set<string>;
};

const isNotificationRead = (
  item?: { isRead?: unknown; is_read?: unknown } | null
) => {
  if (!item) return false;
  if (item.isRead === true) return true;

  const raw = item.is_read;
  if (raw === true || raw === 1 || raw === "1") return true;
  if (typeof raw === "string" && raw.toLowerCase() === "true") return true;
  return false;
};

const isChatMessageType = (type: any) => {
  const value = String(type || "").trim().toLowerCase();
  return value === "chat_message" || value === "chat" || value === "new_message";
};

const isJobRequestNotification = (item?: NotificationItem | null) => {
  if (!item) return false;
  const type = String(item.type || "").trim().toLowerCase();
  if (["job_request", "job_application", "new_job_request", "new_application", "hire_request"].includes(type)) {
    return true;
  }
  const hay = `${item.title || ""} ${item.subtitle || ""} ${item.message || ""}`.toLowerCase();
  return (
    hay.includes("job request") ||
    hay.includes("booking request") ||
    hay.includes("new application") ||
    hay.includes("applied for your job") ||
    hay.includes("request from syttr")
  );
};

const isRateSitterPromptNotification = (item?: NotificationItem | null) => {
  if (!item) return false;
  const type = String(item.type || "").trim().toLowerCase();
  if (type) return type === "rate_sitter_prompt" || type === "rate-sitter-prompt";
  const haystack = `${item.title || ""} ${item.subtitle || ""} ${item.message || ""}`.toLowerCase();
  return haystack.includes("rate syttr") || haystack.includes("rate sitter");
};

const extractApplicationIdForRating = (item?: NotificationItem | null) => {
  if (!item) return "";
  const raw: any = item.raw || {};
  const rawData: any = raw?.data || {};
  const candidateValues = [
    item.application_id,
    item.application?.id,
    raw?.application_id,
    rawData?.application_id,
    raw?.application?.id,
    rawData?.application?.id,
    raw?.job_application_id,
    rawData?.job_application_id,
    raw?.application?.application_id,
    rawData?.application?.application_id,
  ];
  for (const candidate of candidateValues) {
    const value = String(candidate ?? "").trim();
    if (value) return value;
  }
  return "";
};

const createEmptyRatedSyttrTargets = (): RatedSyttrTargets => ({
  applicationIds: new Set<string>(),
});

const hasParentAlreadyRated = (application: any) =>
  application?.parent_rating !== undefined && application?.parent_rating !== null
    ? true
    : String(application?.parent_rated_at || "").trim() !== "";

const isAlreadyRatedError = (message: any) =>
  /already rated/i.test(String(message || "").trim());

const shouldHideRateSyttrPrompt = (
  item: NotificationItem,
  ratedTargets: RatedSyttrTargets
) => {
  if (!isRateSitterPromptNotification(item)) return false;
  const applicationId = extractApplicationIdForRating(item);
  if (applicationId && ratedTargets.applicationIds.has(applicationId)) return true;
  return false;
};

const pickDisplayName = (...candidates: any[]) => {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === "string") {
      const text = candidate.trim();
      if (text) return text;
      continue;
    }
    const direct =
      candidate.fullname ||
      candidate.name ||
      candidate.full_name ||
      candidate.display_name ||
      candidate.nanny_name ||
      candidate.parent_name;
    if (String(direct || "").trim()) return String(direct).trim();
    const joined = [candidate.first_name, candidate.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (joined) return joined;
  }
  return "";
};

const extractNotificationNames = (payload: any) => {
  const data = payload?.data || payload?.notification || payload || {};
  const job = data?.job || payload?.job || {};
  const application = data?.application || payload?.application || {};
  const raw = payload?.raw || {};
  const rawData = raw?.data || {};

  const syttrName = pickDisplayName(
    data?.nanny,
    payload?.nanny,
    job?.nanny,
    application?.nanny,
    rawData?.nanny,
    raw?.nanny,
    data?.sitter,
    payload?.sitter,
    job?.sitter,
    application?.sitter,
    data?.nanny_name,
    payload?.nanny_name,
    job?.nanny_name
  );

  const parentName = pickDisplayName(
    data?.parent,
    payload?.parent,
    job?.parent,
    application?.parent,
    rawData?.parent,
    raw?.parent,
    data?.parent_user,
    payload?.parent_user,
    job?.parent_user,
    data?.user,
    payload?.user,
    job?.client,
    data?.parent_name,
    payload?.parent_name,
    job?.parent_name
  );

  return { syttrName, parentName };
};

const applyNotificationNames = (
  text: string,
  names: { syttrName?: string; parentName?: string },
  options?: { role?: "parent" | "nanny" }
) => {
  const value = String(text || "").trim();
  if (!value) return "";

  const syttrLabel = names.syttrName || "the Syttr";
  const parentLabel = names.parentName || "the parent";
  let next = value;

  next = next.replace(/rate your experience with(?: this)? syttr/gi, `Rate your experience with ${syttrLabel}`);
  next = next.replace(/rate your syttr/gi, `Rate your experience with ${syttrLabel}`);
  next = next.replace(/tap stars to rate your experience with this syttr\.?/gi, `Tap stars to rate your experience with ${syttrLabel}.`);
  next = next.replace(/a parent wants to hire you\.?/gi, `${parentLabel} wants to hire you.`);
  next = next.replace(/job request from syttr/gi, syttrLabel ? `Job Request from ${syttrLabel}` : "Job Request from Syttr");
  next = next.replace(/request from syttr/gi, syttrLabel ? `Request from ${syttrLabel}` : "Request from Syttr");
  next = next.replace(/applied for your job/gi, syttrLabel ? `${syttrLabel} applied for your job` : "A Syttr applied for your job");
  next = next.replace(/your job has been accepted by the syttr\.?/gi, `Your job has been accepted by ${syttrLabel}.`);
  next = next.replace(/your job has been declined by the syttr\.?/gi, `Your job has been declined by ${syttrLabel}.`);

  if (options?.role === "parent" && /rate your experience with/i.test(next) && !names.syttrName) {
    next = next.replace(/rate your experience with/gi, "Rate your experience with the Syttr");
  }

  return next;
};

const fetchRatedSyttrTargets = async (params: {
  token?: string | null;
  userId?: string | null;
  apiKey?: string;
}): Promise<RatedSyttrTargets> => {
  const userId = String(params.userId || "").trim();
  if (!userId) return createEmptyRatedSyttrTargets();

  try {
    const token = sanitizeToken(params.token || undefined);
    const json = await apiRequest<any>("job/parent", {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(params.apiKey ? { "x-api-key": params.apiKey } : {}),
      },
      body: JSON.stringify({
        user_id: userId,
        per_page: 500,
      }),
    });

    const rows: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data?.data)
      ? json.data.data
      : Array.isArray(json?.data)
      ? json.data
      : [];

    const ratedTargets = createEmptyRatedSyttrTargets();
    rows.forEach((job: any) => {
      const applications = Array.isArray(job?.applications)
        ? job.applications
        : Array.isArray(job?.application)
        ? job.application
        : [];

      applications.forEach((application: any) => {
        if (!hasParentAlreadyRated(application)) return;

        const applicationId = String(
          application?.id ?? application?.application_id ?? ""
        ).trim();
        if (applicationId) ratedTargets.applicationIds.add(applicationId);

      });
    });

    return ratedTargets;
  } catch {
    return createEmptyRatedSyttrTargets();
  }
};

type Props = {
  navigation?: any;
  onBack?: () => void;
  onOpenDetail?: (item: NotificationItem) => void;
  onHome?: () => void;
  onMessages?: () => void;
  onJobRequests?: () => void;
  onCalendar?: () => void;
  onSettings?: () => void;
  onNotifications?: () => void;
  onRequireVerification?: () => void;
  initialRatingNotification?: NotificationItem | null;
};

const isVerificationRequiredError = (error: any) => {
  const message = String(
    error?.message ||
      error?.payload?.message ||
      error?.response?.data?.message ||
      ""
  ).toLowerCase();
  const code = String(
    error?.code ||
      error?.payload?.code ||
      error?.response?.data?.code ||
      ""
  ).toLowerCase();

  return (
    code.includes("verification_required") ||
    message.includes("verification is required before accessing") ||
    message.includes("verification required") ||
    (
      message.includes("payment") &&
      message.includes("background check") &&
      message.includes("admin approval")
    )
  );
};


/* ----------------------------- COMPONENT ----------------------------- */

export default function NotificationsScreen({
  navigation,
  onBack,
  onOpenDetail,
  onHome,
  onMessages,
  onJobRequests,
  onCalendar,
  onSettings,
  onNotifications,
  onRequireVerification,
  initialRatingNotification,
}: Props) {
  const insets = useSafeAreaInsets();
  const bottomBarOffset = -Math.max(insets.bottom, 0);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bottomBarHeight, setBottomBarHeight] = useState(rs(72));
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [hiddenNotificationIds, setHiddenNotificationIds] = useState<Set<string>>(new Set());
  const [requestCount, setRequestCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNotificationIds, setSelectedNotificationIds] = useState<Set<string>>(new Set());
  const [actionsMenuVisible, setActionsMenuVisible] = useState(false);
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<NotificationItem | null>(null);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingReview, setRatingReview] = useState("");
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const fetchNotificationsRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});
  const unreadCount = items.filter((item) => !isNotificationRead(item)).length;

  const loadHiddenNotificationIds = async (): Promise<Set<string>> => {
    try {
      const raw = await AppStorage.getItem(HIDDEN_NOTIFICATIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.map((id) => String(id)));
    } catch {
      return new Set();
    }
  };

  const persistHiddenNotificationIds = async (ids: Set<string>) => {
    const next = new Set(ids);
    setHiddenNotificationIds(next);
    try {
      await AppStorage.setItem(HIDDEN_NOTIFICATIONS_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // ignore storage issues
    }
  };

  const hideNotification = async (id?: string | number) => {
    if (!id) return;
    const normalized = String(id).trim();
    if (!normalized) return;
    const next = new Set(hiddenNotificationIds);
    next.add(normalized);
    await persistHiddenNotificationIds(next);
    setItems((prev) => prev.filter((item) => String(item.id || "") !== normalized));
  };

  const deleteNotificationFromServer = async (id?: string | number) => {
    if (!id) return;
    const normalized = String(id).trim();
    if (!normalized) return;

    const { token, userId, apiKey } = await getAuthContext();
    const cleanToken = token ? String(token).replace(/^Bearer\s+/i, "").replace(/"/g, "").trim() : "";

    const json = await apiRequest<any>(`notifications/${normalized}`, {
      method: "DELETE",
      headers: {
        ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        ...(userId ? { user_id: Number(userId) } : {}),
      }),
    });
    if (json?.success === false) {
      throw new Error(json?.message || "Unable to delete notification.");
    }

    await hideNotification(normalized);
  };

  const clearAllNotifications = async () => {
    const ids = items
      .map((item) => item?.id)
      .filter((id): id is string | number => id !== undefined && id !== null);

    if (!ids.length) {
      setItems([]);
      return;
    }

    const doDelete = async () => {
      let failed = 0;
      for (const id of ids) {
        try {
          await deleteNotificationFromServer(id);
        } catch {
          failed += 1;
        }
      }
      if (failed > 0) {
        Alert.alert(
          "Delete incomplete",
          `${failed} notification${failed === 1 ? "" : "s"} could not be deleted.`
        );
      }
    };

    if (Platform.OS === "web") {
      const ok = window.confirm("Delete all visible notifications?");
      if (ok) void doDelete();
      return;
    }

    Alert.alert("Delete all", "Delete all visible notifications?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void doDelete() },
    ]);
  };

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedNotificationIds(new Set());
  };

  const openActionsMenu = () => setActionsMenuVisible(true);
  const closeActionsMenu = () => setActionsMenuVisible(false);

  const toggleNotificationSelection = (id?: string | number) => {
    if (id === undefined || id === null) return;
    const normalized = String(id).trim();
    if (!normalized) return;

    setSelectionMode(true);
    setSelectedNotificationIds((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
  };

  const deleteSelectedNotifications = () => {
    const ids = Array.from(selectedNotificationIds);
    if (!ids.length) return;

    const runDelete = async () => {
      let failed = 0;
      for (const id of ids) {
        try {
          await deleteNotificationFromServer(id);
        } catch {
          failed += 1;
        }
      }
      clearSelection();
      if (failed > 0) {
        Alert.alert(
          "Delete incomplete",
          `${failed} selected notification${failed === 1 ? "" : "s"} could not be deleted.`
        );
      }
    };

    if (Platform.OS === "web") {
      const ok = window.confirm(
        `Delete ${ids.length} selected notification${ids.length === 1 ? "" : "s"}?`
      );
      if (ok) void runDelete();
      return;
    }

    Alert.alert(
      "Delete notifications",
      `Delete ${ids.length} selected notification${ids.length === 1 ? "" : "s"}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void runDelete() },
      ]
    );
  };

  const selectAllNotifications = () => {
    const ids = items
      .map((item) => String(item.id ?? "").trim())
      .filter(Boolean);
    setSelectionMode(true);
    setSelectedNotificationIds(new Set(ids));
  };

  /* ----------------------------- LOAD ----------------------------- */

  useEffect(() => {
    const load = async (silent = false) => {
      const hidden = await loadHiddenNotificationIds();
      setHiddenNotificationIds(hidden);
      await fetchNotificationsRef.current(silent);
      await loadRequestCount();
      await loadMessageCount();
    };

    void load(false);
    const unsubscribe = navigation?.addListener?.("focus", () => {
      void load(true);
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void load(true);
      }
    });

    return () => {
      unsubscribe?.();
      appStateSubscription.remove();
    };
  }, [navigation]);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const userId = await AppStorage.getItem("user_id");
      if (!userId) return;
      const sub = subscribeToNotifications(userId, () => {
        void fetchNotificationsRef.current(true);
        void loadRequestCount();
        void loadMessageCount();
      });
      unsub = sub.unsubscribe;
    })();
    return () => {
      unsub();
    };
  }, []);

  

  const fetchNotifications = async (silent = false): Promise<void> => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const token = await AppStorage.getItem("token");
      const cleanToken = sanitizeToken(token || undefined);
      const userId = await AppStorage.getItem("user_id");
      const apiKey =
        (await AppStorage.getItem("api_key")) ||
        getRuntimeApiKey() ||
        undefined;

      if (!userId) {
        Alert.alert("Session error", "Please login again.");
        setItems([]);
        return;
      }

      const json = await apiRequest<any>(`notifications?user_id=${userId}`, {
        headers: {
          ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
      });
      const rawList: any[] = Array.isArray(json)
        ? json
        : Array.isArray((json as any)?.data)
        ? (json as any).data
        : [];

      const normalized = rawList
        .map((row) => normalizeIncomingNotification(row))
        .filter(Boolean) as NotificationItem[];

      const filtered = normalized.filter((n) => {
        if (isJobRequestNotification(n)) return false;
        if (isLikelyNannyFacing(n)) return false;
        return true;
      });
      const ratedTargets = filtered.some((n) => isRateSitterPromptNotification(n))
        ? await fetchRatedSyttrTargets({ token: cleanToken, userId, apiKey })
        : createEmptyRatedSyttrTargets();
      const hiddenIds = await loadHiddenNotificationIds();
      const visible = filtered.filter((n) => {
        if (shouldHideRateSyttrPrompt(n, ratedTargets)) return false;
        const id = String(n?.id || "").trim();
        return !id || !hiddenIds.has(id);
      });
      setItems(visible);
    } catch (e) {
      if (isVerificationRequiredError(e)) {
        setItems([]);
        onRequireVerification?.();
        return;
      }
      console.log("Notification fetch error:", e);
      if (!silent) {
        Alert.alert("Error", "Unable to load notifications");
      }
      setItems([]);
    } finally {
      if (!silent) {
        setLoading(false);
      }
      void loadRequestCount();
    }
  };
  fetchNotificationsRef.current = fetchNotifications;

  const loadRequestCount = async () => {
    try {
      const count = await fetchUnreadParentRequestCount();
      setRequestCount(count);
    } catch {
      setRequestCount(0);
    }
  };

  const refreshNotifications = async () => {
    setRefreshing(true);
    try {
      await fetchNotifications();
    } finally {
      setRefreshing(false);
    }
  };

  const getAuthContext = async () => {
    const token =
      (await AppStorage.getItem("token")) ||
      (await AppStorage.getItem("nanny_token"));
    const userId = await AppStorage.getItem("user_id");
    const nannyId = await AppStorage.getItem("nanny_id");
    const apiKey =
      (await AppStorage.getItem("api_key")) ||
      getRuntimeApiKey() ||
      undefined;
    return { token, userId, nannyId, apiKey };
  };

  const markLocalAsRead = (id?: string | number) => {
    if (!id) return;
    setItems((prev) =>
      prev.map((n) =>
        n.id && String(n.id) === String(id) ? { ...n, is_read: 1, isRead: true } : n
      )
    );
  };

  const markLocalAsUnread = (id?: string | number) => {
    if (!id) return;
    setItems((prev) =>
      prev.map((n) =>
        n.id && String(n.id) === String(id) ? { ...n, is_read: 0, isRead: false } : n
      )
    );
  };

  const markAllAsRead = async () => {
    try {
      const { token, userId, nannyId, apiKey } = await getAuthContext();
      const cleanToken = sanitizeToken(token || undefined);
      const payload: Record<string, string> = {};
      if (userId) payload.user_id = userId;
      if (nannyId) payload.nanny_id = nannyId;

      const json = await apiRequest<any>("notification/mark-all-read", {
        method: "POST",
        headers: {
          ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: Object.keys(payload).length ? JSON.stringify(payload) : undefined,
      });
      if (json?.success === false) {
        throw new Error(json?.message || "Unable to mark notifications as read.");
      }

      setItems((prev) => prev.map((n) => ({ ...n, is_read: 1, isRead: true })));
    } catch (err) {
      console.log("[Notifications] mark all read error", err);
    }
  };

  const markAllAsUnread = async () => {
    try {
      const { token, userId, nannyId, apiKey } = await getAuthContext();
      const cleanToken = sanitizeToken(token || undefined);
      const payload: Record<string, string> = {};
      if (userId) payload.user_id = userId;
      if (nannyId) payload.nanny_id = nannyId;

      const json = await apiRequest<any>("notification/mark-all-unread", {
        method: "POST",
        headers: {
          ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: Object.keys(payload).length ? JSON.stringify(payload) : undefined,
      });
      if (json?.success === false) {
        throw new Error(json?.message || "Unable to mark notifications as unread.");
      }

      setItems((prev) => prev.map((n) => ({ ...n, is_read: 0, isRead: false })));
    } catch (err) {
      console.log("[Notifications] mark all unread error", err);
      Alert.alert("Notifications", "Unable to mark notifications as unread.");
    }
  };

  const markNotificationAsUnread = async (id?: string | number) => {
    if (!id) return;
    const { token, userId, nannyId, apiKey } = await getAuthContext();
    const cleanToken = sanitizeToken(token || undefined);
    const payload: Record<string, string> = {};
    if (userId) payload.user_id = userId;
    if (nannyId) payload.nanny_id = nannyId;

    const json = await apiRequest<any>(`notification/mark-unread/${encodeURIComponent(String(id).trim())}`, {
      method: "POST",
      headers: {
        ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: Object.keys(payload).length ? JSON.stringify(payload) : undefined,
    });
    if (json?.success === false) {
      throw new Error(json?.message || "Unable to mark notification as unread.");
    }

    markLocalAsUnread(id);
  };

  const markSelectedNotificationsUnread = () => {
    const ids = Array.from(selectedNotificationIds);
    if (!ids.length) return;

    const runMark = async () => {
      let failed = 0;
      for (const id of ids) {
        try {
          await markNotificationAsUnread(id);
        } catch {
          failed += 1;
        }
      }
      clearSelection();
      if (failed > 0) {
        Alert.alert(
          "Update incomplete",
          `${failed} selected notification${failed === 1 ? "" : "s"} could not be marked unread.`
        );
      }
    };

    if (Platform.OS === "web") {
      const ok = window.confirm(
        `Mark ${ids.length} selected notification${ids.length === 1 ? "" : "s"} as unread?`
      );
      if (ok) void runMark();
      return;
    }

    Alert.alert(
      "Mark unread",
      `Mark ${ids.length} selected notification${ids.length === 1 ? "" : "s"} as unread?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Mark unread", onPress: () => void runMark() },
      ]
    );
  };

  const openNotification = async (id?: string | number) => {
    if (!id) return;
    try {
      const { token, apiKey } = await getAuthContext();
      const cleanToken = sanitizeToken(token || undefined);
      await apiRequest(`notification/open/${id}`, {
        method: "GET",
        headers: {
          ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
      });
    } catch (err) {
      console.log("[Notifications] open notification error", err);
    }
  };

  const openRateSyttrModal = (item: NotificationItem) => {
    setRatingTarget(item);
    setRatingStars(0);
    setRatingReview("");
    setRatingModalVisible(true);
  };

  useEffect(() => {
    if (isRateSitterPromptNotification(initialRatingNotification)) {
      openRateSyttrModal(initialRatingNotification as NotificationItem);
    }
  }, [initialRatingNotification]);

  const closeRateSyttrModal = () => {
    if (ratingSubmitting) return;
    setRatingModalVisible(false);
    setRatingTarget(null);
    setRatingStars(0);
    setRatingReview("");
  };

  const submitSyttrRating = async () => {
    const target = ratingTarget;
    const applicationId = extractApplicationIdForRating(target);
    if (!applicationId) {
      Alert.alert("Rate Syttr", "This notification is missing booking information.");
      return;
    }
    if (ratingStars < 1) {
      Alert.alert("Rate Syttr", "Please select at least one star.");
      return;
    }

    setRatingSubmitting(true);
    try {
      const { token, userId, apiKey } = await getAuthContext();
      const cleanToken = sanitizeToken(token || undefined);
      const payload: Record<string, any> = {
        rating: ratingStars,
      };
      const review = ratingReview.trim();
      if (review) payload.review = review;
      if (userId) payload.user_id = userId;

      const json = await apiRequest<any>(
        `job-requests/${encodeURIComponent(applicationId)}/rate`,
        {
          method: "POST",
          headers: {
            ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
          body: JSON.stringify(payload),
        }
      );
      if (json?.success === false) {
        const message = json?.message || "Unable to submit rating.";
        const alreadyRated = isAlreadyRatedError(message);
        if (alreadyRated) {
          if (target?.id !== undefined && target?.id !== null) {
            await hideNotification(target.id);
          }
          setRatingModalVisible(false);
          setRatingTarget(null);
          setRatingStars(0);
          setRatingReview("");
          Alert.alert("Rate Syttr", "You already rated this Syttr. This alert has been removed.");
          return;
        }
        throw new Error(message);
      }

      if (target?.id !== undefined && target?.id !== null) {
        await hideNotification(target.id);
      }
      Alert.alert("Thanks", "Your rating has been submitted.");
      setRatingModalVisible(false);
      setRatingTarget(null);
      setRatingStars(0);
      setRatingReview("");
    } catch (e: any) {
      Alert.alert("Rate Syttr", e?.message || "Unable to submit rating.");
    } finally {
      setRatingSubmitting(false);
    }
  };

  /* ----------------------------- HELPERS ----------------------------- */

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

  const normalizeIncomingNotification = (
    payload: any
  ): NotificationItem | null => {
    if (!payload) return null;
    const data = payload.data || payload.notification || payload;
    const body = data.message || data.body || payload.message || "";
    const createdAt =
      data.created_at || payload.created_at || data.time;

    const application =
      data.application ||
      payload.application ||
      data.job_application ||
      payload.job_application;
    const type = String(data.type || payload.type || data.event || payload.event || "").trim();
    const isChatMessage = isChatMessageType(type);
    const status =
      data.status ||
      payload.status ||
      data.application_status ||
      payload.application_status ||
      application?.status;
    const applicationId =
      data.application_id ||
      data.job_application_id ||
      application?.id ||
      payload.application_id ||
      payload.job_application_id;
    const jobId =
      data.job_id ||
      data.booking_id ||
      data.job?.id ||
      data.job?.job_id ||
      payload.job_id ||
      payload.booking_id ||
      payload.job?.id ||
      payload.job?.job_id;
    const names = extractNotificationNames(payload);

    const readValue = data.is_read ?? payload.is_read;

    const resolvedId =
      data.id ||
      payload.id ||
      data.notification_id ||
      payload.notification_id ||
      data.application_id ||
      payload.application_id ||
      data.job_application_id ||
      payload.job_application_id;

    return {
      id: resolvedId,
      title: applyNotificationNames(
        data.title || data.subject || (isChatMessage ? "New Message" : "Notification"),
        names,
        { role: "parent" }
      ),
      subtitle: isChatMessage
        ? ""
        : applyNotificationNames(data.subtitle || body, names, { role: "parent" }),
      message: isChatMessage ? "" : applyNotificationNames(body, names, { role: "parent" }),
      time: createdAt,
      created_at: createdAt,
      is_read: readValue,
      isRead: isNotificationRead({
        isRead: data.isRead ?? payload.isRead,
        is_read: readValue,
      }),
      type: type || undefined,
      job_id: jobId,
      status: status || undefined,
      application,
      application_id: applicationId,
      job: data.job || payload.job,
      nanny: data.nanny || payload.nanny,
      raw: payload,
      application_status: status || undefined,
    };
  };

  const loadMessageCount = async () => {
    try {
      const count = await fetchUnreadConversationCount();
      setMessageCount(count);
    } catch {
      setMessageCount(0);
    }
  };

  const normalizeParentText = (text: string) => {
    const value = String(text || "").trim();
    if (!value) return "";
    return value
      .replace(/\bnannies\b/gi, "Syttrs")
      .replace(/\bnanny\b/gi, "Syttr")
      .replace(/\bapplication accepted\b/gi, "Job Accepted")
      .replace(/\bapplication (?:declined|rejected)\b/gi, "Job Declined")
      .replace(/\bjob request from syttr\b/gi, "Job Request from Syttr")
      .replace(
        /\byour application (?:was|has been) accepted by the parents?\b\.?/gi,
        "Your job has been accepted by the Syttr."
      )
      .replace(
        /\byour application (?:was|has been) (?:declined|rejected) by the parents?\b\.?/gi,
        "You declined a job request from a Syttr."
      )
      .replace(
        /\byour job has been declined by the syttr\b\.?/gi,
        "You declined a job request from a Syttr."
      );
  };

  const isLikelyNannyFacing = (item: NotificationItem) => {
    const hay = `${item.title || ""} ${item.subtitle || ""} ${item.message || ""}`
      .toLowerCase()
      .trim();
    return (
      hay.includes("wants to hire you") ||
      (hay.includes("hire request") && hay.includes("hire you")) ||
      (hay.includes("hire request") && hay.includes("you.")) ||
      (hay.includes("hire request") && hay.includes("a parent wants to hire you"))
    );
  };

  /* ----------------------------- RENDER ITEM ----------------------------- */

  const renderItem: ListRenderItem<NotificationItem> = ({ item }) => {
    const normalizedTitle = normalizeParentText(item.title || "Notification");
    const title = /job request from syttr/i.test(normalizedTitle)
      ? "Job Request from Syttr"
      : normalizedTitle || "Notification";
    const subtitle = isChatMessageType(item.type)
      ? ""
      : normalizeParentText(item.subtitle || item.message || "");
    const time = formatDateLabel(item.time || item.created_at);
    const isRead = isNotificationRead(item);
    const isUnread = !isRead;
    const itemId = String(item.id ?? "").trim();
    const isSelected = itemId ? selectedNotificationIds.has(itemId) : false;

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          if (selectionMode) {
            toggleNotificationSelection(item.id);
            return;
          }
          const nextItem = { ...item, is_read: 1, isRead: true };
          markLocalAsRead(item.id);
          void openNotification(item.id);
          if (isRateSitterPromptNotification(nextItem)) {
            openRateSyttrModal(nextItem);
            return;
          }
          if (onOpenDetail) onOpenDetail(nextItem);
          else navigation?.navigate?.("NotificationDetail", { item: nextItem });
        }}
        onLongPress={() => {
          if (selectionMode) {
            toggleNotificationSelection(item.id);
            return;
          }
          if (Platform.OS === "web") {
            const ok = window.confirm("Remove this alert from your list?");
            if (ok) {
              void deleteNotificationFromServer(item.id).catch((e: any) => {
                Alert.alert("Delete failed", e?.message || "Unable to delete notification.");
              });
            }
            return;
          }
          Alert.alert("Remove alert", "Remove this alert from your list?", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Remove",
              style: "destructive",
              onPress: () => {
                void deleteNotificationFromServer(item.id).catch((e: any) => {
                  Alert.alert("Delete failed", e?.message || "Unable to delete notification.");
                });
              },
            },
          ]);
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
            <Ionicons
              name="notifications"
              size={22}
              color="#fff"
            />
          </LinearGradient>

          <View style={styles.cardContent}>
            <Text allowFontScaling style={[styles.cardTitle, isUnread && styles.cardTitleUnread]}>{title}</Text>

            {subtitle ? (
              <Text allowFontScaling style={[styles.cardSubtitle, isUnread && styles.cardSubtitleUnread]}>
                {subtitle}
              </Text>
            ) : null}

            <View style={[styles.timePill, isUnread && styles.timePillUnread]}>
              <Ionicons
                name="time"
                size={12}
                color="#C2185B"
              />
              <Text allowFontScaling style={styles.timeText}>{time}</Text>
            </View>
          </View>
        </View>

        {isUnread ? (
          <View style={styles.unreadPill}>
            <Text allowFontScaling style={styles.unreadPillText}>Unread</Text>
          </View>
        ) : null}
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
    <View style={styles.screen}>
      <LinearGradient
        colors={["#FFFFFF", "#FFFFFF"]}
        style={styles.container}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.headerSide}>
            {selectionMode ? (
              <TouchableOpacity style={styles.headerActionBtn} onPress={clearSelection}>
                <Ionicons name="close" size={18} color="#C77A00" />
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.headerTitle}>Notifications</Text>
          <View style={styles.headerActions}>
            {selectionMode ? (
              <>
                <TouchableOpacity
                  style={styles.headerActionBtn}
                  onPress={selectAllNotifications}
                  accessibilityLabel="Select all notifications"
                >
                  <Ionicons name="checkmark-done-outline" size={18} color="#C77A00" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.headerActionBtn,
                    selectedNotificationIds.size === 0 && styles.headerActionBtnDisabled,
                  ]}
                  onPress={deleteSelectedNotifications}
                  disabled={selectedNotificationIds.size === 0}
                  accessibilityLabel="Delete selected notifications"
                >
                  <Ionicons name="trash-outline" size={18} color="#C77A00" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.headerActionBtn,
                    selectedNotificationIds.size === 0 && styles.headerActionBtnDisabled,
                  ]}
                  onPress={markSelectedNotificationsUnread}
                  disabled={selectedNotificationIds.size === 0}
                  accessibilityLabel="Mark selected notifications unread"
                >
                  <Ionicons name="mail-unread-outline" size={18} color="#C77A00" />
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={styles.headerActionBtn}
                onPress={openActionsMenu}
                accessibilityLabel="Notification actions"
              >
                <Ionicons name="ellipsis-vertical" size={18} color="#C77A00" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* CONTENT */}
        <View style={styles.content}>
          {loading && items.length === 0 ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color="#FFC107" />
            </View>
          ) : items.length === 0 ? (
            <View style={styles.emptyWrap}>
              <View style={styles.iconCircle}>
                <Ionicons
                  name="notifications-off"
                  size={48}
                  color="#FFC107"
                />
              </View>
              <Text allowFontScaling style={styles.title}>No notifications</Text>
              <Text allowFontScaling style={styles.subtitle}>{"You're all caught up!"}</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item, index) =>
                item.id?.toString() ?? index.toString()
              }
              renderItem={renderItem}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: bottomBarHeight + Math.max(insets.bottom, 8) + rs(12) },
              ]}
              ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
              initialNumToRender={10}
              windowSize={5}
              refreshing={refreshing}
              onRefresh={refreshNotifications}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </LinearGradient>

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
                void markAllAsRead();
              }}
            >
              <Ionicons name="checkmark-done" size={18} color="#C77A00" />
              <Text style={styles.menuItemText}>Mark All Read</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeActionsMenu();
                void clearAllNotifications();
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
                void markAllAsUnread();
              }}
            >
              <Ionicons name="mail-unread-outline" size={18} color="#C77A00" />
              <Text style={styles.menuItemText}>Mark All Unread</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

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
        onLayout={(e) => {
          const next = Math.ceil(e.nativeEvent.layout.height);
          if (Number.isFinite(next) && next > 0 && next !== bottomBarHeight) {
            setBottomBarHeight(next);
          }
        }}
      >
        <Tab icon="home" label="Home" onPress={onHome || (() => {})} />
        <Tab icon="chatbubble" label="Chat" badgeCount={messageCount} onPress={onMessages || (() => {})} />
        <Tab
          icon="briefcase"
          label="Requests"
          badgeCount={requestCount}
          onPress={onJobRequests || (() => {})}
        />
        <Tab
          icon="notifications"
          label="Alerts"
          active
          badgeCount={unreadCount}
          onPress={onNotifications || (() => {})}
        />
        <Tab icon="calendar" label="Calendar" onPress={onCalendar || (() => {})} />
        <Tab icon="settings" label="Settings" onPress={onSettings || (() => {})} />
      </View>

      <Modal
        visible={ratingModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeRateSyttrModal}
      >
        <Pressable style={styles.ratingOverlay} onPress={Keyboard.dismiss}>
          <Pressable style={styles.ratingCard} onPress={() => {}}>
            <Text style={styles.ratingTitle}>Rate Your Syttr</Text>
            <Text style={styles.ratingSubtitle}>
              {applyNotificationNames(
                "Tap stars to rate your experience with this Syttr.",
                extractNotificationNames(ratingTarget?.raw || ratingTarget || {}),
                { role: "parent" }
              )}
            </Text>

            <View style={styles.ratingStarsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={`rating-star-${star}`}
                  onPress={() => setRatingStars(star)}
                  disabled={ratingSubmitting}
                  style={styles.ratingStarBtn}
                >
                  <Ionicons
                    name={ratingStars >= star ? "star" : "star-outline"}
                    size={28}
                    color={ratingStars >= star ? "#F4B400" : "#C2185B"}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              value={ratingReview}
              onChangeText={setRatingReview}
              editable={!ratingSubmitting}
              placeholder="Optional feedback"
              placeholderTextColor="#B57A8F"
              multiline
              maxLength={500}
              textAlignVertical="top"
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={Keyboard.dismiss}
              style={styles.ratingInput}
            />

            <View style={styles.ratingActionsRow}>
              <TouchableOpacity
                style={[styles.ratingCancelBtn, ratingSubmitting && styles.disabledBtn]}
                onPress={closeRateSyttrModal}
                disabled={ratingSubmitting}
              >
                <Text style={styles.ratingCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.ratingSubmitBtn,
                  (ratingSubmitting || ratingStars < 1) && styles.disabledBtn,
                ]}
                onPress={submitSyttrRating}
                disabled={ratingSubmitting || ratingStars < 1}
              >
                {ratingSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.ratingSubmitText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
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
    <TouchableOpacity
      style={styles.tabItem}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${label} tab`}
    >
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
      <Text allowFontScaling numberOfLines={1} style={[styles.tabLabel, active && styles.tabActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

/* ----------------------------- STYLES ----------------------------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    position: "relative",
    backgroundColor: "#FFFFFF",
  },
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
  headerSide: {
    width: rs(108),
    alignItems: "flex-start",
    justifyContent: "center",
  },

  headerActions: {
    width: rs(108),
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: rs(10),
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
    minHeight: 0,
    paddingTop: rs(16),
    paddingBottom: rs(16),
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: rs(16),
  },
  listSeparator: {
    height: rs(12),
  },

  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
    marginTop: rs(10),
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
  },

  cardIconCircle: {
    width: rs(40),
    height: rs(40),
    borderRadius: rs(12),
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: {
    flex: 1,
    marginLeft: rs(10),
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

  timePill: {
    marginTop: rs(6),
    alignSelf: "flex-start",
    backgroundColor: "#FFE89A",
    paddingHorizontal: rs(8),
    paddingVertical: rs(4),
    borderRadius: rs(10),
    flexDirection: "row",
    alignItems: "center",
  },
  timePillUnread: {
    backgroundColor: "#FFE1A3",
  },

  timeText: {
    marginLeft: rs(4),
    fontSize: rf(11),
    color: "#8B5E00",
    fontWeight: "600",
  },

  unreadPill: {
    backgroundColor: "#FFE1A3",
    borderRadius: rs(10),
    paddingHorizontal: rs(10),
    paddingVertical: rs(4),
    marginLeft: rs(8),
    borderWidth: 1,
    borderColor: "#FFC107",
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
  unreadPillText: {
    color: "#8B5E00",
    fontSize: rf(10),
    fontWeight: "700",
  },
  disabledBtn: {
    opacity: 0.7,
  },
  ratingOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: rs(16),
  },
  ratingCard: {
    width: "100%",
    maxWidth: rs(360),
    backgroundColor: "#FFFFFF",
    borderRadius: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    padding: rs(14),
  },
  ratingTitle: {
    fontSize: rf(16),
    color: "#880E4F",
    fontWeight: "700",
  },
  ratingSubtitle: {
    marginTop: rs(6),
    fontSize: rf(12),
    color: "#6B4350",
  },
  ratingStarsRow: {
    marginTop: rs(12),
    flexDirection: "row",
    justifyContent: "space-between",
  },
  ratingStarBtn: {
    padding: rs(2),
  },
  ratingInput: {
    marginTop: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.4)",
    borderRadius: rs(10),
    minHeight: rs(84),
    textAlignVertical: "top",
    paddingHorizontal: rs(10),
    paddingVertical: rs(8),
    color: "#880E4F",
    fontSize: rf(12),
  },
  ratingActionsRow: {
    marginTop: rs(12),
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: rs(8),
  },
  ratingCancelBtn: {
    borderWidth: 1,
    borderColor: "#FF80AB",
    borderRadius: rs(10),
    paddingHorizontal: rs(14),
    paddingVertical: rs(9),
    backgroundColor: "#FFF7FC",
  },
  ratingCancelText: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(12),
  },
  ratingSubmitBtn: {
    borderWidth: 1,
    borderColor: "#FF80AB",
    borderRadius: rs(10),
    paddingHorizontal: rs(16),
    paddingVertical: rs(9),
    backgroundColor: "#FF80AB",
    minWidth: rs(88),
    alignItems: "center",
    justifyContent: "center",
  },
  ratingSubmitText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: rf(12),
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
