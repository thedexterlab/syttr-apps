import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  AppState,
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { rf, rs } from "../utils/responsive";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest, BASE_URL, getRuntimeApiKey, sanitizeToken } from "../Api";
import NannyBottomNav from "../components/NannyBottomNav";
const HIDDEN_NOTIFICATIONS_KEY = "hidden_notifications_nanny";

/* ---------------- TYPES ---------------- */

type NotificationItem = {
  id?: number | string;
  application_id?: number | string;
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
  job?: any;
  application?: any;
  raw?: any;
};

const isExtraHoursRequestNotification = (item?: NotificationItem | null) =>
  String(item?.type || "").trim().toLowerCase() === "extra_hours_request";

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
  return value === "chat_message" || value === "chat";
};

const isRateParentPromptNotification = (item?: NotificationItem | null) => {
  if (!item) return false;
  const type = String(item.type || "").trim().toLowerCase();
  if (type === "rate_parent_prompt" || type === "rate-parent-prompt") return true;
  const haystack = `${item.title || ""} ${item.subtitle || ""} ${item.message || ""}`.toLowerCase();
  return haystack.includes("rate parent");
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

  return { parentName, syttrName };
};

const applyNotificationNames = (
  text: string,
  names: { parentName?: string; syttrName?: string },
  options?: { role?: "nanny" | "parent" }
) => {
  const value = String(text || "").trim();
  if (!value) return "";

  const parentLabel = names.parentName || "the parent";
  const syttrLabel = names.syttrName || "the Syttr";
  let next = value;

  next = next.replace(/rate your experience with(?: this)? parent/gi, `Rate your experience with ${parentLabel}`);
  next = next.replace(/rate parent/gi, `Rate ${parentLabel}`);
  next = next.replace(/tap stars to rate your experience with this parent\.?/gi, `Tap stars to rate your experience with ${parentLabel}.`);
  next = next.replace(/a parent wants to hire you\.?/gi, `${parentLabel} wants to hire you.`);
  next = next.replace(/your job has been accepted by the parent\.?/gi, `Your job has been accepted by ${parentLabel}.`);
  next = next.replace(/your application (?:was|has been) accepted by the parent/gi, `Your application was accepted by ${parentLabel}`);
  next = next.replace(/your application (?:was|has been) (?:declined|rejected) by the parent/gi, `Your application was declined by ${parentLabel}`);
  next = next.replace(/syttr/gi, syttrLabel);

  if (options?.role === "nanny" && /rate your experience with/i.test(next) && !names.parentName) {
    next = next.replace(/rate your experience with/gi, "Rate your experience with the parent");
  }

  return next;
};

type Props = {
  navigation?: any;
  onBack?: () => void;
  onOpenDetail?: (item: NotificationItem) => void;
  onHome?: () => void;
  onJobs?: () => void;
  onCalendar?: () => void;
  onMessages?: () => void;
  onNotifications?: () => void;
  onSettings?: () => void;
};


export default function NannyNotificationsScreen({
  navigation,
  onBack,
  onOpenDetail,
  onHome,
  onJobs,
  onCalendar,
  onMessages,
  onNotifications,
  onSettings,
}: Props) {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState<boolean>(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNotificationIds, setSelectedNotificationIds] = useState<Set<string>>(new Set());
  const [actionsMenuVisible, setActionsMenuVisible] = useState(false);
  const [decisionLoadingKey, setDecisionLoadingKey] = useState<string>("");
  const [decisionLoadingAction, setDecisionLoadingAction] = useState<"accept" | "reject" | null>(null);
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<NotificationItem | null>(null);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingReview, setRatingReview] = useState("");
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const unreadCount = items.filter(
    (item) => !isNotificationRead(item)
  ).length;

  const loadHiddenNotificationIds = async (): Promise<Set<string>> => {
    try {
      const raw = await AsyncStorage.getItem(HIDDEN_NOTIFICATIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.map((id) => String(id)));
    } catch {
      return new Set();
    }
  };

  const persistHiddenNotificationIds = async (ids: Set<string>) => {
    const next = new Set(ids);
    try {
      await AsyncStorage.setItem(HIDDEN_NOTIFICATIONS_KEY, JSON.stringify(Array.from(next)));
    } catch {
      // ignore storage issues
    }
  };

  const hideNotification = async (id?: string | number) => {
    if (!id) return;
    const normalized = String(id).trim();
    if (!normalized) return;
    const next = await loadHiddenNotificationIds();
    next.add(normalized);
    await persistHiddenNotificationIds(next);
    setItems((prev) => prev.filter((item) => String(item.id || "") !== normalized));
  };

  useEffect(() => {
    const refreshNotifications = (silent = false) => {
      void fetchNotifications(silent);
    };

    refreshNotifications(false);
    const unsubscribe = navigation?.addListener?.("focus", () => refreshNotifications(true));
    const interval = setInterval(() => refreshNotifications(true), 5000);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshNotifications(true);
      }
    });

    return () => {
      unsubscribe?.();
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [navigation]);

  const getAuthHeaders = async () => {
    const tokenRaw =
      (await AsyncStorage.getItem("token")) ||
      (await AsyncStorage.getItem("nanny_token"));
    const apiKey =
      (await AsyncStorage.getItem("api_key")) ||
      getRuntimeApiKey() ||
      undefined;
    const userId = await AsyncStorage.getItem("user_id");
    const nannyId =
      (await AsyncStorage.getItem("nanny_id")) ||
      userId;
    const cleanToken = sanitizeToken(tokenRaw || undefined);
    const authHeader = cleanToken ? `Bearer ${cleanToken}` : undefined;

    return { authHeader, apiKey, nannyId, userId };
  };



  /* ---------------- API ---------------- */

  const fetchNotifications = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const { authHeader, apiKey, nannyId } = await getAuthHeaders();
      const userType = await AsyncStorage.getItem("user_type");

      if (!authHeader) {
        if (!silent) {
          Alert.alert("Error", "Missing session token. Please log in again.");
        }
        setItems([]);
        return;
      }

      const queryParts = [];
      if (nannyId) queryParts.push(`nanny_id=${encodeURIComponent(nannyId)}`);
      if (apiKey) queryParts.push(`api_key=${encodeURIComponent(apiKey)}`);
      const query = queryParts.length ? `?${queryParts.join("&")}` : "";

      // Debug: log what we're sending (token truncated)
      console.log("[NannyNotifications] request", {
        url: `${BASE_URL}nanny/notifications${query}`,
        headers: {
          Authorization: authHeader ? `${authHeader.slice(0, 16)}...` : "none",
          "x-api-key": apiKey ? `${apiKey.slice(0, 6)}...` : "none",
          nannyId: nannyId || "none",
          userType: userType || "none",
        },
      });

      const json = await apiRequest<any>(`nanny/notifications${query}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
          ...(nannyId ? { "nanny-id": nannyId, nanny_id: nannyId } : {}),
        },
      });
      const rawData: any[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : [];
      const data: NotificationItem[] = rawData
        .map((entry) => normalizeIncomingNotification(entry))
        .filter((entry) => !!entry && !isChatMessageType((entry as NotificationItem).type))
        .filter(Boolean) as NotificationItem[];

      const hireRequests = await fetchHireRequests(nannyId, authHeader, apiKey);
      const merged = [...hireRequests, ...data];
      const deduped = merged.filter((item, idx, arr) => {
        const id = item.id ? String(item.id) : "";
        if (!id) return idx === arr.findIndex((n) => !n.id);
        return idx === arr.findIndex((n) => String(n.id) === id);
      });
      const hiddenIds = await loadHiddenNotificationIds();
      const visible = deduped.filter((n) => {
        const id = String(n?.id || "").trim();
        return !id || !hiddenIds.has(id);
      });
      setItems(visible);
    } catch (e: any) {
      console.log("Syttr notifications fetch error", e);
      if (e?.status === 401) {
        if (!silent) {
          Alert.alert(
            "Unauthorized",
            e?.message || "Session expired. Please log in again."
          );
        }
        setItems([]);
        return;
      }
      if (!silent) {
        Alert.alert("Error", e?.message || "Unable to load notifications right now.");
        setItems([]);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const fetchHireRequests = async (
    nannyId?: string | null,
    authHeader?: string,
    apiKey?: string
  ) => {
    if (!nannyId) return [];
    try {
      const query = `?nanny_id=${encodeURIComponent(nannyId)}`;
      const json = await apiRequest<any>(`nanny/hire-requests${query}`, {
        method: "GET",
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
      });
      const rows = Array.isArray(json?.data) ? json.data : [];

      const normalizeState = (value: any) =>
        String(value || "")
          .toLowerCase()
          .trim();

      const isActiveHireRequestRow = (row: any) => {
        const status = normalizeState(
          row?.status ||
            row?.request_status ||
            row?.hire_request_status ||
            row?.application_status ||
            row?.application?.status
        );
        const type = normalizeState(
          row?.type ||
            row?.notification_type ||
            row?.request_type ||
            row?.kind
        );
        const hasRequestStatusField =
          row?.request_status !== undefined || row?.hire_request_status !== undefined;
        const hasExplicitHireType = type.includes("hire");

        if (type.includes("application") && !hasExplicitHireType) {
          return false;
        }
        const job = row?.job || {};
        const hasJobRef = !!(job?.job_id || job?.id || row?.job_id);
        if (!hasJobRef) return false;

        if (
          status.includes("cancel") ||
          status.includes("reject") ||
          status.includes("declin") ||
          status.includes("complete") ||
          status.includes("close") ||
          status.includes("expire") ||
          status.includes("withdraw")
        ) {
          return false;
        }

        const hasHireSignal =
          hasExplicitHireType ||
          status.includes("pending") ||
          status.includes("request") ||
          status.includes("open") ||
          status.includes("new") ||
          status.includes("sent");
        if (!hasExplicitHireType && !hasRequestStatusField) {
          return false;
        }
        return hasHireSignal;
      };

      return rows
        .filter((row: any) => isActiveHireRequestRow(row))
        .map((row: any) => {
          const kids = Array.isArray(row.kids)
            ? row.kids.map((kid: any) => kid.name).filter(Boolean).join(", ")
            : "";
          const parentName = row.parent?.name || "Parent";
          const job = row.job || {};
          const when = job.start_date || job.end_date || "";
          const jobId = job?.job_id || job?.id || row?.job_id;
          const sourceId = row.id || row.notification_id;
          const id = sourceId
            ? String(sourceId)
            : row.application_id
            ? `hire-${row.application_id}`
            : jobId
            ? `hire-job-${jobId}`
            : undefined;
          return {
            id,
            type: "hire_request",
            title: "Hire Request",
            subtitle: `${parentName} wants to hire you${kids ? ` - Kids: ${kids}` : ""}`,
            message: "A parent wants to hire you.",
            time: when,
            created_at: when,
            is_read: row?.is_read ?? row?.isRead ?? 0,
            isRead: isNotificationRead({
              isRead: row?.isRead,
              is_read: row?.is_read,
            }),
            raw: row,
          };
        });
    } catch (e) {
      console.log("[NannyNotifications] hire-requests error", e);
      return [];
    }
  };

  /* ---------------- HELPERS ---------------- */

  const formatTime = (value?: string) => {
    if (!value) return "Just now";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

const formatTimeValue = (value?: string) => {
    if (!value) return "";
    const raw = String(value);
    if (/(AM|PM)$/i.test(raw)) return raw;
    const match = raw.match(/(\d{1,2}):(\d{2})/);
    if (!match) return raw;
    let hour = Number(match[1]);
    const minute = match[2];
    if (Number.isNaN(hour)) return raw;
    const suffix = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
};

const toFiniteNumber = (value: any): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildParentStatsLabel = (parent: any, job: any) => {
  const rating = toFiniteNumber(
    parent?.average_rating ??
      parent?.parent_average_rating ??
      job?.parent_average_rating
  );
  const jobsPosted = toFiniteNumber(
    parent?.jobs_posted_count ??
      parent?.parent_jobs_posted_count ??
      job?.parent_jobs_posted_count
  );
  const ratersCount = toFiniteNumber(
    parent?.raters_count ??
      parent?.parent_raters_count ??
      parent?.ratings_count ??
      job?.parent_raters_count ??
      job?.parent_ratings_count
  );

  const parts: string[] = [];
  if (rating !== null) parts.push(`Rating ${rating.toFixed(1)}`);
  if (jobsPosted !== null) parts.push(`Jobs ${Math.max(0, Math.round(jobsPosted))}`);
  if (ratersCount !== null) parts.push(`Rated by ${Math.max(0, Math.round(ratersCount))} Syttrs`);
  return parts.join("  |  ");
};


  const normalizeIncomingNotification = (
    payload: any
  ): NotificationItem | null => {
    if (!payload) return null;
    const data = payload.data || payload.notification || payload;
    const body = String(data.message || data.body || payload.message || "").trim();
    const createdAt =
      data.created_at || payload.created_at || data.time;
    const type = String(data.type || payload.type || "").trim();
    const isChatMessage = isChatMessageType(type);
    const jobId =
      data.job_id ||
      payload.job_id ||
      data.job?.id ||
      payload.job?.id ||
      data.meta?.job_id ||
      payload.meta?.job_id;
    const titleRaw = String(data.title || data.subject || "Notification").trim();
    const subtitleRaw = String(data.subtitle || body).trim();
    const haystack = `${titleRaw} ${subtitleRaw} ${body}`.toLowerCase();
    const names = extractNotificationNames(payload);

    const isParentFacingApplication =
      type.toLowerCase() === "job_application" ||
      haystack.includes("job request from syttr") ||
      haystack.includes("applied for your job") ||
      haystack.includes("request from syttr");

    const jobToken = jobId ? `Job #${String(jobId).trim()}` : "a job";
    const title = isParentFacingApplication
      ? applyNotificationNames("Application Submitted", names, { role: "nanny" })
      : applyNotificationNames(titleRaw, names, { role: "nanny" });
    const subtitle = isParentFacingApplication
      ? applyNotificationNames(`You applied to ${jobToken}.`, names, { role: "nanny" })
      : isChatMessage
      ? ""
      : applyNotificationNames(subtitleRaw, names, { role: "nanny" });
    const message = isParentFacingApplication
      ? subtitle
      : isChatMessage
      ? ""
      : applyNotificationNames(body, names, { role: "nanny" });

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
      title,
      subtitle,
      message,
      time: createdAt,
      created_at: createdAt,
      is_read: readValue,
      isRead: isNotificationRead({
        isRead: data.isRead ?? payload.isRead,
        is_read: readValue,
      }),
      type: type || undefined,
      job_id: jobId,
      status: data.status || payload.status,
      job: data.job || payload.job,
      application: data.application || payload.application,
      raw: payload,
    };
  };

  const markLocalAsRead = (id?: string | number) => {
    if (!id) return;
    setItems((prev) =>
      prev.map((n) =>
        n.id && String(n.id) === String(id) ? { ...n, is_read: 1, isRead: true } : n
      )
    );
  };

  const markAsRead = async (id?: string | number) => {
    if (!id) return;
    try {
      const { authHeader, apiKey, nannyId, userId } = await getAuthHeaders();
      const payload: Record<string, string> = {};
      if (userId) payload.user_id = userId;
      if (nannyId) payload.nanny_id = nannyId;

      const json = await apiRequest<any>(`notification/mark-read/${id}`, {
        method: "POST",
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: Object.keys(payload).length ? JSON.stringify(payload) : undefined,
      });
      if (json?.success === false) {
        throw new Error(json?.message || "Unable to mark notification as read.");
      }
      markLocalAsRead(id);
    } catch {
      // ignore; next refresh will reflect the database state
    }
  };

  const openNotification = async (id?: string | number) => {
    if (!id) return;
    try {
      const { authHeader, apiKey } = await getAuthHeaders();
      await apiRequest(`notification/open/${id}`, {
        method: "GET",
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
      });
    } catch (err) {
      console.log("[NannyNotifications] open notification error", err);
      await markAsRead(id);
      return;
    }
  };

  const markAllAsRead = async () => {
    try {
      const { authHeader, apiKey, nannyId, userId } = await getAuthHeaders();
      const payload: Record<string, string> = {};
      if (userId) payload.user_id = userId;
      if (nannyId) payload.nanny_id = nannyId;

      const json = await apiRequest<any>("notification/mark-all-read", {
        method: "POST",
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: Object.keys(payload).length ? JSON.stringify(payload) : undefined,
      });
      if (json?.success === false) {
        throw new Error(json?.message || "Unable to mark notifications as read.");
      }

      setItems((prev) =>
        prev.map((n) => ({ ...n, is_read: 1, isRead: true }))
      );
    } catch (err) {
      console.log("[NannyNotifications] mark all read error", err);
    }
  };

  const markLocalAsUnread = (id?: string | number) => {
    if (!id) return;
    setItems((prev) =>
      prev.map((n) =>
        n.id && String(n.id) === String(id) ? { ...n, is_read: 0, isRead: false } : n
      )
    );
  };

  const markAllAsUnread = async () => {
    try {
      const { authHeader, userId, nannyId, apiKey } = await getAuthHeaders();
      const payload: Record<string, string> = {};
      if (userId) payload.user_id = userId;
      if (nannyId) payload.nanny_id = nannyId;

      const json = await apiRequest<any>("notification/mark-all-unread", {
        method: "POST",
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: Object.keys(payload).length ? JSON.stringify(payload) : undefined,
      });
      if (json?.success === false) {
        throw new Error(json?.message || "Unable to mark notifications as unread.");
      }

      setItems((prev) => prev.map((n) => ({ ...n, is_read: 0, isRead: false })));
    } catch (err) {
      console.log("[NannyNotifications] mark all unread error", err);
      Alert.alert("Notifications", "Unable to mark notifications as unread.");
    }
  };

  const markNotificationAsUnread = async (id?: string | number) => {
    if (!id) return;
    const { authHeader, apiKey, nannyId, userId } = await getAuthHeaders();
    const payload: Record<string, string> = {};
    if (userId) payload.user_id = userId;
    if (nannyId) payload.nanny_id = nannyId;

    const json = await apiRequest<any>(`notification/mark-unread/${encodeURIComponent(String(id).trim())}`, {
      method: "POST",
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: Object.keys(payload).length ? JSON.stringify(payload) : undefined,
    });
    if (json?.success === false) {
      throw new Error(json?.message || "Unable to mark notification as unread.");
    }
    markLocalAsUnread(id);
  };

  const deleteNotificationFromServer = async (id?: string | number) => {
    if (!id) return;
    const normalized = String(id).trim();
    if (!normalized) return;

    // Synthetic hire-request ids are local-only; just hide them.
    if (/^hire-/i.test(normalized)) {
      await hideNotification(normalized);
      return;
    }

    try {
      const { authHeader, apiKey, nannyId, userId } = await getAuthHeaders();
      const payload: Record<string, any> = {};
      if (userId) payload.user_id = Number.isFinite(Number(userId)) ? Number(userId) : userId;
      if (nannyId) payload.nanny_id = Number.isFinite(Number(nannyId)) ? Number(nannyId) : nannyId;

      await apiRequest(`notifications/${encodeURIComponent(normalized)}`, {
        method: "DELETE",
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: Object.keys(payload).length ? JSON.stringify(payload) : undefined,
      });
    } catch {
      // best-effort server delete
    } finally {
      await hideNotification(normalized);
    }
  };

  const confirmDeleteNotification = (id?: string | number) => {
    if (!id) return;
    const runDelete = async () => {
      await deleteNotificationFromServer(id);
    };

    if (Platform.OS === "web") {
      const ok = window.confirm("Delete this notification?");
      if (ok) void runDelete();
      return;
    }

    Alert.alert("Delete notification", "Delete this notification?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void runDelete() },
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
      if (next.has(normalized)) {
        next.delete(normalized);
      } else {
        next.add(normalized);
      }
      return next;
    });
  };

  const deleteSelectedNotifications = () => {
    const ids = Array.from(selectedNotificationIds);
    if (!ids.length) return;

    const runDelete = async () => {
      for (const id of ids) {
        await deleteNotificationFromServer(id);
      }
      clearSelection();
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

  const clearAllNotifications = () => {
    const ids = items
      .map((item) => item?.id)
      .filter((id): id is string | number => id !== undefined && id !== null);

    if (!ids.length) {
      setItems([]);
      return;
    }

    const runClear = async () => {
      for (const id of ids) {
        await deleteNotificationFromServer(id);
      }
    };

    if (Platform.OS === "web") {
      const ok = window.confirm("Delete all visible notifications?");
      if (ok) void runClear();
      return;
    }

    Alert.alert("Delete all", "Delete all visible notifications?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete all", style: "destructive", onPress: () => void runClear() },
    ]);
  };

  const getHireRequestMeta = (item?: NotificationItem) => {
    const row = item?.raw || {};
    const rowData = row?.data || {};
    const applicationId =
      row?.application_id ||
      rowData?.application_id ||
      row?.application?.id ||
      rowData?.application?.id ||
      item?.application?.id;
    const notificationId = item?.id || row?.id || row?.notification_id;
    const applicationKey = String(applicationId || "").trim();
    const notificationKey = String(notificationId || "").trim();
    return {
      applicationId: applicationKey || undefined,
      notificationId: notificationKey || undefined,
      loadingKey: applicationKey || notificationKey || "",
    };
  };

  const submitHireRequestDecision = async (
    item: NotificationItem,
    decision: "accept" | "reject"
  ) => {
    const { applicationId, notificationId, loadingKey } = getHireRequestMeta(item);
    if (!applicationId) {
      Alert.alert("Hire Request", "Application ID missing.");
      return;
    }
    if (decisionLoadingKey && loadingKey && decisionLoadingKey === loadingKey) {
      return;
    }

    try {
      setDecisionLoadingKey(loadingKey);
      setDecisionLoadingAction(decision);
      const { authHeader, apiKey, nannyId, userId } = await getAuthHeaders();
      const endpoint = decision === "accept" ? "accept" : "reject";
      const payload: Record<string, string> = {};
      if (userId) payload.user_id = userId;
      if (nannyId) payload.nanny_id = nannyId;

      const json = await apiRequest<any>(
        `nanny/hire-requests/${encodeURIComponent(applicationId)}/${endpoint}`,
        {
          method: "POST",
          headers: {
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
          body: JSON.stringify(payload),
        }
      );
      if (json?.success === false) {
        throw new Error(json?.message || "Unable to update hire request.");
      }

      if (notificationId) {
        await openNotification(notificationId);
      }

      const newStatus = decision === "accept" ? "accepted" : "rejected";
      setItems((prev) =>
        prev.map((entry) => {
          const entryMeta = getHireRequestMeta(entry);
          const isSameApplication =
            entryMeta.applicationId && entryMeta.applicationId === applicationId;
          const isSameNotification =
            notificationId &&
            entryMeta.notificationId &&
            entryMeta.notificationId === notificationId;

          if (!isSameApplication && !isSameNotification) {
            return entry;
          }

          return {
            ...entry,
            is_read: 1,
            isRead: true,
            status: newStatus,
            application_status: newStatus,
            application: entry.application
              ? { ...entry.application, status: newStatus }
              : entry.application,
            raw: entry.raw
              ? {
                  ...entry.raw,
                  status: newStatus,
                  request_status: newStatus,
                  application_status: newStatus,
                  application: entry.raw?.application
                    ? { ...entry.raw.application, status: newStatus }
                    : entry.raw?.application,
                  data: entry.raw?.data
                    ? {
                        ...entry.raw.data,
                        status: newStatus,
                        request_status: newStatus,
                        application_status: newStatus,
                        application: entry.raw.data.application
                          ? { ...entry.raw.data.application, status: newStatus }
                          : entry.raw.data.application,
                      }
                    : entry.raw?.data,
                }
              : entry.raw,
          };
        })
      );

      Alert.alert(
        "Hire Request",
        decision === "accept" ? "Hire request accepted." : "Hire request rejected."
      );
    } catch (e: any) {
      Alert.alert("Hire Request", e?.message || "Unable to update hire request.");
    } finally {
      setDecisionLoadingKey("");
      setDecisionLoadingAction(null);
    }
  };

  const getExtraHoursRequestMeta = (item?: NotificationItem) => {
    const row = item?.raw || {};
    const rowData = row?.data || {};
    const notificationId = item?.id || row?.id || row?.notification_id;
    return {
      notificationId: String(notificationId || "").trim() || undefined,
      loadingKey: String(notificationId || "").trim() || "",
    };
  };

  const submitExtraHoursDecision = async (
    item: NotificationItem,
    decision: "accept" | "reject"
  ) => {
    const { notificationId, loadingKey } = getExtraHoursRequestMeta(item);
    if (!notificationId) {
      Alert.alert("Extra Hours", "Request ID missing.");
      return;
    }
    if (decisionLoadingKey && loadingKey && decisionLoadingKey === loadingKey) {
      return;
    }

    try {
      setDecisionLoadingKey(loadingKey);
      setDecisionLoadingAction(decision);
      const { authHeader, apiKey, nannyId, userId } = await getAuthHeaders();
      const endpoint = decision === "accept" ? "accept" : "reject";
      const payload: Record<string, string> = {};
      if (userId) payload.user_id = userId;
      if (nannyId) payload.nanny_id = nannyId;

      const json = await apiRequest<any>(
        `bookings/extra-hours/${encodeURIComponent(notificationId)}/${endpoint}`,
        {
          method: "POST",
          headers: {
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
          body: JSON.stringify(payload),
        }
      );
      if (json?.success === false) {
        throw new Error(json?.message || "Unable to update extra hours request.");
      }

      await openNotification(notificationId);
      setItems((prev) =>
        prev.filter((entry) => String(entry?.id || "") !== notificationId)
      );
      Alert.alert(
        "Extra Hours",
        decision === "accept" ? "Extra hours request accepted." : "Extra hours request rejected."
      );
    } catch (e: any) {
      Alert.alert("Extra Hours", e?.message || "Unable to update extra hours request.");
    } finally {
      setDecisionLoadingKey("");
      setDecisionLoadingAction(null);
    }
  };

  const openRateParentModal = (item: NotificationItem) => {
    const applicationId = extractApplicationIdForRating(item);
    if (!applicationId) {
      Alert.alert("Rate Parent", "Application ID missing for this rating.");
      return;
    }
    setRatingTarget(item);
    setRatingStars(0);
    setRatingReview("");
    setRatingModalVisible(true);
  };

  const closeRateParentModal = () => {
    if (ratingSubmitting) return;
    setRatingModalVisible(false);
    setRatingTarget(null);
    setRatingStars(0);
    setRatingReview("");
  };

  const submitParentRating = async () => {
    if (ratingSubmitting) return;
    if (ratingStars < 1 || ratingStars > 5) {
      Alert.alert("Rate Parent", "Please select a star rating.");
      return;
    }
    const target = ratingTarget;
    const applicationId = extractApplicationIdForRating(target);
    if (!target || !applicationId) {
      Alert.alert("Rate Parent", "Application ID missing for this rating.");
      return;
    }

    try {
      setRatingSubmitting(true);
      const { authHeader, apiKey, nannyId, userId } = await getAuthHeaders();
      const payload: Record<string, any> = {
        rating: ratingStars,
      };
      const review = ratingReview.trim();
      if (review) payload.review = review;
      if (userId) payload.user_id = userId;
      if (nannyId) payload.nanny_id = nannyId;

      const json = await apiRequest<any>(
        `job-requests/${encodeURIComponent(applicationId)}/rate`,
        {
          method: "POST",
          headers: {
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
          body: JSON.stringify(payload),
        }
      );
      if (json?.success === false) {
        throw new Error(json?.message || "Unable to submit rating.");
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
      Alert.alert("Rate Parent", e?.message || "Unable to submit rating.");
    } finally {
      setRatingSubmitting(false);
    }
  };

  /* ---------------- RENDER ITEM ---------------- */

  const renderItem = ({ item }: { item: NotificationItem }) => {
    const isRead = isNotificationRead(item);
    const isUnread = !isRead;
    const itemId = String(item.id ?? "").trim();
    const isSelected = itemId ? selectedNotificationIds.has(itemId) : false;

    if (isExtraHoursRequestNotification(item)) {
      const row = item.raw || {};
      const rowData = row.data || {};
      const parent = rowData.parent || row.parent || {};
      const requestMeta = getExtraHoursRequestMeta(item);
      const isDecisionLoading =
        requestMeta.loadingKey !== "" && decisionLoadingKey === requestMeta.loadingKey;
      const isAccepting = isDecisionLoading && decisionLoadingAction === "accept";
      const isRejecting = isDecisionLoading && decisionLoadingAction === "reject";
      const requestStatus = String(rowData.status || item.status || "pending").trim().toLowerCase();
      const isPendingRequest = requestStatus === "" || requestStatus === "pending";
      const requestedHours = Number(rowData.requested_hours || 0);
      const newHours = Number(rowData.new_hours || rowData.updated_hours || rowData.job?.hours || 0);
      const newTotal = Number(rowData.new_total || rowData.updated_total || rowData.job?.price || 0);

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
            if (onOpenDetail) onOpenDetail(nextItem);
            else Alert.alert("Error", "Notification detail navigation not configured.");
            void openNotification(item.id);
          }}
          onLongPress={() => {
            if (selectionMode) {
              toggleNotificationSelection(item.id);
              return;
            }
            confirmDeleteNotification(item.id);
          }}
          style={[styles.card, isUnread && styles.cardUnread, isSelected && styles.cardSelected]}
        >
          <View style={styles.cardLeft}>
            <LinearGradient
              colors={["#FF80AB", "#FFD59E"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardIconCircle}
            >
              <Ionicons name="time" size={22} color="#fff" />
            </LinearGradient>

            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, isUnread && styles.cardTitleUnread]}>
                Extra Hours Request
              </Text>
              <Text style={[styles.cardSubtitle, isUnread && styles.cardSubtitleUnread]}>
                {parent?.name || "Parent"} requested {requestedHours || 0} extra hour(s).
              </Text>
              <Text style={[styles.hireMetaText, isUnread && styles.hireMetaTextUnread]}>
                New total hours: {Number.isFinite(newHours) ? newHours : "--"}
              </Text>
              <Text style={[styles.hireMetaText, isUnread && styles.hireMetaTextUnread]}>
                New total amount: {Number.isFinite(newTotal) ? `$${newTotal.toFixed(2)}` : "--"}
              </Text>

              {isPendingRequest ? (
                <View style={styles.decisionRow}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    disabled={isDecisionLoading}
                    style={[
                      styles.decisionBtn,
                      styles.acceptBtn,
                      isDecisionLoading ? styles.disabledBtn : null,
                    ]}
                    onPress={(event: any) => {
                      event?.stopPropagation?.();
                      void submitExtraHoursDecision(item, "accept");
                    }}
                  >
                    <Text style={[styles.decisionBtnText, styles.acceptText]}>
                      {isAccepting ? "Accepting..." : "Accept"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    disabled={isDecisionLoading}
                    style={[
                      styles.decisionBtn,
                      styles.rejectBtn,
                      isDecisionLoading ? styles.disabledBtn : null,
                    ]}
                    onPress={(event: any) => {
                      event?.stopPropagation?.();
                      void submitExtraHoursDecision(item, "reject");
                    }}
                  >
                    <Text style={[styles.decisionBtnText, styles.rejectText]}>
                      {isRejecting ? "Rejecting..." : "Reject"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={[styles.hireMetaText, isUnread && styles.hireMetaTextUnread, { marginTop: rs(10) }]}>
                  {requestStatus === "accepted" ? "Request accepted" : "Request rejected"}
                </Text>
              )}
            </View>
          </View>

          {isUnread ? (
            <View style={styles.unreadPill}>
              <Text style={styles.unreadPillText}>Unread</Text>
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
    }

    if (item.type === "hire_request") {
      const row = item.raw || {};
      const rowData = row.data || {};
      const job = row.job || rowData.job || item.job || {};
      const parent = row.parent || rowData.parent || {};
      const kids = Array.isArray(row.kids)
        ? row.kids
        : Array.isArray(rowData.kids)
        ? rowData.kids
        : Array.isArray(job.kids)
        ? job.kids
        : [];
      const timeLabel = formatTimeValue(job.start_time);
      const parentStatsLabel = buildParentStatsLabel(parent, job);
      const hireMeta = getHireRequestMeta(item);
      const isDecisionLoading =
        hireMeta.loadingKey !== "" && decisionLoadingKey === hireMeta.loadingKey;
      const isAccepting = isDecisionLoading && decisionLoadingAction === "accept";
      const isRejecting = isDecisionLoading && decisionLoadingAction === "reject";
      const requestStatus = String(
        rowData.status ||
          rowData.request_status ||
          rowData.application_status ||
          item.status ||
          item.application?.status ||
          "pending"
      )
        .trim()
        .toLowerCase();
      const isPendingRequest = requestStatus === "" || requestStatus === "pending";

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
            if (onOpenDetail) onOpenDetail(nextItem);
            else Alert.alert("Error", "Notification detail navigation not configured.");
            void openNotification(item.id);
          }}
          onLongPress={() => {
            if (selectionMode) {
              toggleNotificationSelection(item.id);
              return;
            }
            confirmDeleteNotification(item.id);
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
              <Ionicons name="briefcase" size={22} color="#fff" />
            </LinearGradient>

            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, isUnread && styles.cardTitleUnread]}>
                Hire Request from {parent.name || "Parent"}
              </Text>
              <View style={styles.hireMetaRow}>
                <Text style={[styles.hireMetaText, isUnread && styles.hireMetaTextUnread]}>
                  Date: {job.start_date || "--"}
                </Text>
                <Text style={[styles.hireMetaText, isUnread && styles.hireMetaTextUnread]}>
                  Time: {timeLabel || "--"}
                </Text>
              </View>
              {parentStatsLabel ? (
                <Text style={[styles.hireStatsText, isUnread && styles.hireStatsTextUnread]}>
                  {parentStatsLabel}
                </Text>
              ) : null}
              
              {kids.length ? (
                <Text style={[styles.cardSubtitle, isUnread && styles.cardSubtitleUnread]}>
                  Kids:{" "}
                  {kids
                    .map((kid: any) => {
                      const meta = [
                        kid.name,
                        kid.age ? `${kid.age}` : "",
                        kid.gender,
                      ].filter(Boolean);
                      return meta.join(" ");
                    })
                    .join(", ")}
                </Text>
              ) : null}

              {isPendingRequest ? (
                <View style={styles.decisionRow}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    disabled={isDecisionLoading}
                    style={[
                      styles.decisionBtn,
                      styles.acceptBtn,
                      isDecisionLoading ? styles.disabledBtn : null,
                    ]}
                    onPress={(event: any) => {
                      event?.stopPropagation?.();
                      void submitHireRequestDecision(item, "accept");
                    }}
                  >
                    <Text style={[styles.decisionBtnText, styles.acceptText]}>
                      {isAccepting ? "Accepting..." : "Accept"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    disabled={isDecisionLoading}
                    style={[
                      styles.decisionBtn,
                      styles.rejectBtn,
                      isDecisionLoading ? styles.disabledBtn : null,
                    ]}
                    onPress={(event: any) => {
                      event?.stopPropagation?.();
                      void submitHireRequestDecision(item, "reject");
                    }}
                  >
                    <Text style={[styles.decisionBtnText, styles.rejectText]}>
                      {isRejecting ? "Rejecting..." : "Reject"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={[styles.hireMetaText, isUnread && styles.hireMetaTextUnread, { marginTop: rs(10) }]}>
                  {requestStatus === "accepted" ? "Accepted" : "Declined"}
                </Text>
              )}
            </View>
          </View>

          {isUnread ? (
            <View style={styles.unreadPill}>
              <Text style={styles.unreadPillText}>Unread</Text>
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
    }

    const title = item.title || "Notification";
    const subtitle = isChatMessageType(item.type)
      ? ""
      : item.subtitle || item.message || "";
    const time = formatTime(item.time || item.created_at);

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
          if (isRateParentPromptNotification(nextItem)) {
            openRateParentModal(nextItem);
            return;
          }
          if (onOpenDetail) onOpenDetail(nextItem);
          else Alert.alert("Error", "Notification detail navigation not configured.");
        }}
        onLongPress={() => {
          if (selectionMode) {
            toggleNotificationSelection(item.id);
            return;
          }
          confirmDeleteNotification(item.id);
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
            <Ionicons name="notifications" size={22} color="#fff" />
          </LinearGradient>

          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, isUnread && styles.cardTitleUnread]}>{title}</Text>

            {subtitle ? (
              <Text style={[styles.cardSubtitle, isUnread && styles.cardSubtitleUnread]}>
                {subtitle}
              </Text>
            ) : null}

            <View style={[styles.timePill, isUnread && styles.timePillUnread]}>
              <Ionicons name="time" size={12} color="#C2185B" />
              <Text style={styles.timeText}>{time}</Text>
            </View>
          </View>
        </View>

        {isUnread ? (
          <View style={styles.unreadPill}>
            <Text style={styles.unreadPillText}>Unread</Text>
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

  /* ---------------- UI ---------------- */

  return (
    <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={{ flex: 1 }}>
      {/* HEADER */}
      <View style={[styles.headerCard, { marginTop: rs(1) }]}>
        <View style={styles.headerInner}>
          <View style={styles.headerSide}>
            {selectionMode ? (
              <TouchableOpacity style={styles.headerActionBtn} onPress={clearSelection}>
                <Ionicons name="close" size={18} color="#C2185B" />
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.headerTitle}>Notifications</Text>
          <View style={styles.headerActions}>
            {selectionMode ? (
              <>
                <TouchableOpacity style={styles.headerActionBtn} onPress={selectAllNotifications}>
                  <Ionicons name="checkmark-done-outline" size={18} color="#C2185B" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.headerActionBtn,
                    selectedNotificationIds.size === 0 && styles.headerActionBtnDisabled,
                  ]}
                  onPress={deleteSelectedNotifications}
                  disabled={selectedNotificationIds.size === 0}
                >
                  <Ionicons name="trash-outline" size={18} color="#C2185B" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.headerActionBtn,
                    selectedNotificationIds.size === 0 && styles.headerActionBtnDisabled,
                  ]}
                  onPress={markSelectedNotificationsUnread}
                  disabled={selectedNotificationIds.size === 0}
                >
                  <Ionicons name="mail-unread-outline" size={18} color="#C2185B" />
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.headerActionBtn} onPress={openActionsMenu}>
                <Ionicons name="ellipsis-vertical" size={18} color="#C2185B" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* CONTENT */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#FF80AB" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, idx) => String(item.id ?? idx)}
          renderItem={renderItem}
          contentContainerStyle={{
            padding: rs(12),
            paddingBottom: rs(88) + Math.max(insets.bottom, 8),
          }}
          keyboardShouldPersistTaps="handled"
        />

      )}

      {/* BOTTOM NAV */}
      <NannyBottomNav
        active="Notifications"
        onHome={onHome}
        onJobs={onJobs}
        onCalendar={onCalendar}
        onMessages={onMessages}
        onNotifications={onNotifications}
        onSettings={onSettings}
        notificationCount={unreadCount}
        navigation={navigation}
      />

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
              <Ionicons name="checkmark-done" size={18} color="#C2185B" />
              <Text style={styles.menuItemText}>Mark All Read</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeActionsMenu();
                void clearAllNotifications();
              }}
            >
              <Ionicons name="trash-outline" size={18} color="#C2185B" />
              <Text style={styles.menuItemText}>Delete All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeActionsMenu();
                setSelectionMode(true);
              }}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color="#C2185B" />
              <Text style={styles.menuItemText}>Select</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                closeActionsMenu();
                void markAllAsUnread();
              }}
            >
              <Ionicons name="mail-unread-outline" size={18} color="#C2185B" />
              <Text style={styles.menuItemText}>Mark All Unread</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={ratingModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeRateParentModal}
      >
        <Pressable style={styles.ratingOverlay} onPress={Keyboard.dismiss}>
          <Pressable style={styles.ratingCard} onPress={() => {}}>
            <Text style={styles.ratingTitle}>Rate Parent</Text>
            <Text style={styles.ratingSubtitle}>
              {applyNotificationNames(
                "Tap stars to rate your experience with this parent.",
                extractNotificationNames(ratingTarget?.raw || ratingTarget || {}),
                { role: "nanny" }
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
                onPress={closeRateParentModal}
                disabled={ratingSubmitting}
              >
                <Text style={styles.ratingCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.ratingSubmitBtn,
                  (ratingSubmitting || ratingStars < 1) && styles.disabledBtn,
                ]}
                onPress={submitParentRating}
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
    </LinearGradient>
  );
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCard: {
    marginHorizontal: rs(12),
    marginBottom: rs(8),
    borderRadius: rs(20),
    backgroundColor: "rgba(255,255,255,0.9)",
    elevation: 2,
  },
  headerInner: {
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(14),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerSide: {
    width: rs(30),
    alignItems: "flex-start",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: rf(20),
    fontWeight: "700",
    color: "#C77A00",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
  },
  headerActionBtn: {
    width: rs(30),
    height: rs(30),
    borderRadius: rs(15),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
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
    borderColor: "rgba(255,128,171,0.25)",
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
    color: "#880E4F",
    fontWeight: "600",
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: rs(12),    borderRadius: rs(14),
    marginBottom: rs(10),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    shadowColor: "rgba(0,0,0,0.05)",
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: rs(0), height: rs(2) },
  },
  cardUnread: {
    backgroundColor: "#FFF5F9",
    borderColor: "#FF80AB",
    borderLeftWidth: 4,
    borderLeftColor: "#FF80AB",
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: "#C2185B",
  },
  cardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: rs(10),
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
    color: "#880E4F",
  },
  cardTitleUnread: {
    color: "#6F0036",
  },
  cardSubtitle: {
    fontSize: rf(12),
    color: "#AD1457",
    marginTop: rs(2),
  },
  cardSubtitleUnread: {
    color: "#8B1145",
    fontWeight: "600",
  },
  timePill: {
    marginTop: rs(6),
    alignSelf: "flex-start",
    backgroundColor: "#FFE4EC",
    paddingHorizontal: rs(8),
    paddingVertical: rs(4),
    borderRadius: rs(10),
    flexDirection: "row",
    alignItems: "center",
    gap: rs(4),
  },
  timePillUnread: {
    backgroundColor: "#FFE4EF",
  },
  timeText: {
    fontSize: rf(11),
    color: "#C2185B",
    fontWeight: "600",
  },
  unreadPill: {
    backgroundColor: "#FFE4EF",
    borderRadius: rs(10),
    paddingHorizontal: rs(10),
    paddingVertical: rs(4),
    marginLeft: rs(8),
    borderWidth: 1,
    borderColor: "#FF80AB",
  },
  unreadPillText: {
    color: "#C2185B",
    fontSize: rf(10),
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
    marginLeft: rs(8),
    backgroundColor: "#FFF5F9",
  },
  selectionBadgeActive: {
    backgroundColor: "#C2185B",
  },
  hireMetaRow: {
    flexDirection: "row",
    gap: rs(12),
    marginTop: rs(4),
  },
  hireMetaText: {
    fontSize: rf(11),
    color: "#C2185B",
    fontWeight: "600",
  },
  hireMetaTextUnread: {
    color: "#A80F4D",
  },
  hireStatsText: {
    fontSize: rf(11),
    color: "#880E4F",
    marginTop: rs(4),
    fontWeight: "600",
  },
  hireStatsTextUnread: {
    color: "#6F0036",
  },
  decisionRow: {
    flexDirection: "row",
    gap: rs(8),
    marginTop: rs(10),
  },
  decisionBtn: {
    borderRadius: rs(10),
    paddingVertical: rs(6),
    paddingHorizontal: rs(12),
    borderWidth: 1,
  },
  acceptBtn: {
    backgroundColor: "#E7F8EF",
    borderColor: "#66BB6A",
  },
  rejectBtn: {
    backgroundColor: "#FFECEF",
    borderColor: "#E57373",
  },
  decisionBtnText: {
    fontSize: rf(11),
    fontWeight: "700",
  },
  acceptText: {
    color: "#2E7D32",
  },
  rejectText: {
    color: "#C62828",
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
  mapWrap: {
    borderRadius: rs(14),
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    marginTop: rs(10),
  },
  map: {
    width: "100%",
    height: rs(160),
  },
  mapFallback: {
    borderRadius: rs(14),
    paddingVertical: rs(12),
    alignItems: "center",
    backgroundColor: "#FFF4F8",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    marginTop: rs(10),
  },
  mapFallbackText: {
    color: "#C77A00",
    fontWeight: "700",
    fontSize: rf(12),
  },
  empty: {
    textAlign: "center",
    color: "#6B4350",
    marginTop: rs(20),
  },
});
