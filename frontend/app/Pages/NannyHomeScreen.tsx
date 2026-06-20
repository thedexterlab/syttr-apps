import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { hp, rf, rs, wp } from "../utils/responsive";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  apiRequest,
  BASE_URL,
  checkNannyApprovalStatus,
  getNannyRatingSummary,
  getRuntimeApiKey,
  sanitizeToken,
  updateNannyProfile,
} from "../Api";
import NannyBottomNav, { NannyNavKey } from "../components/NannyBottomNav";
import SafeScreen from "../components/SafeScreen";
import { fetchUnreadConversationCount } from "../../lib/chatUnreadCount";
import { hydrateNannySessionProfile, resolveSessionImageUrl } from "../../lib/nannySessionProfile";

type JobSummary = {
  id: string;
  family: string;
  parentImage?: string;
  summary: string;
  schedule: string;
  location: string;
  pay?: string;
  latitude?: number;
  longitude?: number;
  startDate?: string;
  endDate?: string;
  kidName?: string;
  kidAge?: number | string;
  kids?: { name?: string; age?: number | string }[];
  hoursLabel?: string;
  raw?: any;
};

type HireRequestSummary = {
  id: string;
  applicationId: string;
  notificationId?: string;
  parentName: string;
  dateLabel: string;
  timeLabel: string;
  location: string;
  kidsLabel: string;
  parentStatsLabel: string;
  raw: any;
};

type EarningDay = {
  day: string;
  amount: number;
};

type Props = {
  navigation?: any;
  userName?: string;
  rateCards?: { morning?: string; evening?: string; night?: string };
  onAvailability?: () => void;
  onJobs?: () => void;
  onMessages?: () => void;
  onNotifications?: () => void;
  onCalendar?: () => void;
  onSettings?: () => void;
  onWithdraw?: () => void;
  onJobPress?: (job: JobSummary) => void;
  onOpenBooking?: (event: any, date?: string) => void;
  onRejected?: () => void;
};
const WEEK_DAYS_MON_TO_SUN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const STORAGE_ROOT = BASE_URL.replace(/\/api\/?$/, "");
const ASSET_CACHE_BUST = "asset_v=20260327_1";

const resolveImageUrl = (value?: string | null): string | undefined => {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const withCacheBust = (url: string) =>
    `${url}${url.includes("?") ? "&" : "?"}${ASSET_CACHE_BUST}`;
  if (/^https?:\/\//i.test(raw)) return withCacheBust(raw);
  const clean = raw.replace(/^\/+/, "");
  if (clean.startsWith("storage/") || clean.startsWith("public/")) {
    return withCacheBust(`${STORAGE_ROOT}/${clean}`);
  }
  return withCacheBust(`${STORAGE_ROOT}/storage/${clean}`);
};

const createEmptyWeekEarnings = (): EarningDay[] =>
  WEEK_DAYS_MON_TO_SUN.map((day) => ({ day, amount: 0 }));

const getJobStartTimestamp = (job: any) => {
  const startDateRaw = String(job?.start_date || job?.date || "").trim();
  const startTimeRaw = String(job?.start_time || job?.time || "").trim();

  if (startDateRaw && startTimeRaw) {
    const combined = parseLocalDateLike(`${startDateRaw} ${startTimeRaw}`);
    if (combined) return combined.getTime();
  }

  if (startDateRaw) {
    const dateOnly = parseLocalDateLike(startDateRaw);
    if (dateOnly) return dateOnly.getTime();
  }

  return NaN;
};

const parseMoneyAmount = (value: any): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseNumber = (value: any): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const ACCEPTED_JOB_STATUSES = new Set([
  "accept",
  "accepted",
  "approved",
  "confirmed",
  "confirm",
]);
const PENDING_JOB_STATUSES = new Set([
  "pending",
  "requested",
  "request_sent",
  "applied",
  "waiting",
]);

const normalizeStatusValue = (value: any) => String(value || "").toLowerCase().trim();

const isAcceptedJobStatus = (value: any) => ACCEPTED_JOB_STATUSES.has(normalizeStatusValue(value));
const isPendingJobStatus = (value: any) => PENDING_JOB_STATUSES.has(normalizeStatusValue(value));

const formatHoursLabel = (value: any) => {
  const hours = parseNumber(value);
  if (hours === null || hours <= 0) return "Hours TBD";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hrs`;
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

const formatDateValue = (value: any) => {
  const parsed = parseLocalDateLike(value);
  if (!parsed) return String(value || "").trim();
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const buildParentStatsLabel = (parent: any, job: any) => {
  const rating = parseNumber(
    parent?.average_rating ??
      parent?.parent_average_rating ??
      job?.parent_average_rating
  );
  const jobsPosted = parseNumber(
    parent?.jobs_posted_count ??
      parent?.parent_jobs_posted_count ??
      job?.parent_jobs_posted_count
  );
  const ratersCount = parseNumber(
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

const parseLocalDateLike = (value: any): Date | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const dateOnly = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (dateOnly) {
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const dateTime = raw.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (dateTime) {
    const d = new Date(
      Number(dateTime[1]),
      Number(dateTime[2]) - 1,
      Number(dateTime[3]),
      Number(dateTime[4]),
      Number(dateTime[5]),
      Number(dateTime[6] || 0)
    );
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const fallback = new Date(raw);
  return Number.isFinite(fallback.getTime()) ? fallback : null;
};

const getWeekStartMonday = (date = new Date()) => {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (base.getDay() + 6) % 7; // Monday=0 ... Sunday=6
  base.setDate(base.getDate() - offset);
  base.setHours(0, 0, 0, 0);
  return base;
};

const getTransactionsArrayFromPayload = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.transactions)) return payload.transactions;
  if (Array.isArray(payload?.data?.transactions)) return payload.data.transactions;
  if (Array.isArray(payload?.history)) return payload.history;
  if (Array.isArray(payload?.data?.history)) return payload.data.history;
  return [];
};

const isDebitLikeTransaction = (value: any, direction?: any) => {
  const normalizedDirection = String(direction || "").trim().toLowerCase();
  if (normalizedDirection === "credit") return false;
  if (normalizedDirection === "debit") return true;

  const type = String(value || "").trim().toLowerCase();
  if (!type) return false;
  return (
    type.includes("debit") ||
    type.includes("withdraw") ||
    type.includes("refund") ||
    type.includes("reversal") ||
    type.includes("fee")
  );
};

const isNotificationRead = (item?: { isRead?: unknown; is_read?: unknown } | null) => {
  if (!item) return false;
  if (item.isRead === true) return true;

  const raw = item.is_read;
  if (raw === true || raw === 1 || raw === "1") return true;
  if (typeof raw === "string" && raw.toLowerCase() === "true") return true;
  return false;
};

const sanitizeDisplayName = (value?: string | null): string | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  // Avoid showing emails in greeting header (e.g. "Hi, 1@gmail.com").
  if (raw.includes("@")) return null;
  return raw;
};

const resolveDashboardAvatarCandidate = (...values: any[]): string => {
  for (const value of values) {
    const normalized = resolveSessionImageUrl(value);
    if (normalized) return normalized;
  }
  return "";
};

export default function NannyHomeScreen({
  navigation,
  onAvailability,
  onJobs,
  onMessages,
  onNotifications,
  onCalendar,
  onSettings,
  onWithdraw,
  userName,
  rateCards,
  onJobPress,
  onOpenBooking,
  onRejected,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isSmallPhone = width <= 360;
  const [availability, setAvailability] = useState(true);
  const [activeTab, setActiveTab] = useState<NannyNavKey>("Home");
  const [notificationCount, setNotificationCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [storedName, setStoredName] = useState<string | null>(null);
  const [storedRates, setStoredRates] = useState<{ morning?: string; evening?: string; night?: string }>({});
  const [showRateModal, setShowRateModal] = useState(false);
  const [requireHourlyRate, setRequireHourlyRate] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [savingRate, setSavingRate] = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [hireRequests, setHireRequests] = useState<HireRequestSummary[]>([]);
  const [hireRequestsLoading, setHireRequestsLoading] = useState(false);
  const [hireDecisionLoadingKey, setHireDecisionLoadingKey] = useState<string>("");
  const [hireDecisionLoadingAction, setHireDecisionLoadingAction] = useState<"accept" | "reject" | null>(null);
  const [nextBooking, setNextBooking] = useState<JobSummary | null>(null);
  const [bookingJobs, setBookingJobs] = useState<JobSummary[]>([]);
  const [upcomingShifts, setUpcomingShifts] = useState<JobSummary[]>([]);
  const [activeJobsCount, setActiveJobsCount] = useState(0);
  const [averageRating, setAverageRating] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<"availability" | "withdraw" | null>(null);
  const [earningsByDay, setEarningsByDay] = useState<EarningDay[]>(() =>
    createEmptyWeekEarnings()
  );
  const lastMessageCountRef = useRef(0);
  const initializedMessageCountRef = useRef(false);
  const networkWarnAtRef = useRef<Record<string, number>>({});
  const lastHireRequestClosedAlertRef = useRef("");
  const maxEarning = useMemo(() => {
    const values = earningsByDay.map((entry) => entry.amount || 0);
    const max = Math.max(0, ...values);
    return max || 1;
  }, [earningsByDay]);
  const weeklyTotal = useMemo(() => {
    return earningsByDay.reduce((sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0), 0);
  }, [earningsByDay]);
  const maxBarHeight = isSmallPhone ? 108 : 140;

  const today = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
    []
  );

  useEffect(() => {
    const load = async () => {
      const entries = await AsyncStorage.multiGet([
        "nanny_name",
        "user_name",
        "name",
        "full_name",
        "nanny_image",
        "user_image",
        "profile_image_url",
        "user_image_url",
        "profile_image",
        "avatar",
        "image_url",
        "image",
      ]);
      const map = Object.fromEntries(entries);
      const resolvedName =
        sanitizeDisplayName(map.nanny_name as string) ||
        sanitizeDisplayName(map.user_name as string) ||
        sanitizeDisplayName(map.name as string) ||
        sanitizeDisplayName(map.full_name as string);
      if (resolvedName) {
        setStoredName(resolvedName);
      }
      const resolvedAvatar = resolveSessionImageUrl(
        map.nanny_image ||
        map.user_image ||
        map.profile_image_url ||
        map.user_image_url ||
        map.profile_image ||
        map.avatar ||
        map.image_url ||
        map.image
      );
      if (resolvedAvatar) {
        setAvatarFailed(false);
        setAvatarUrl(resolvedAvatar);
      } else {
        setAvatarFailed(false);
        setAvatarUrl(null);
      }
      if (!resolvedName || !resolvedAvatar) {
        try {
          const sessionProfile = await hydrateNannySessionProfile();
          if (sessionProfile?.name) setStoredName(sessionProfile.name);
          if (sessionProfile?.image) {
            setAvatarFailed(false);
            setAvatarUrl(sessionProfile.image);
          }
        } catch {
          // keep cached values
        }
      }
      try {
        const [tokenRaw, storedNannyId, storedUserId, storedApiKey] = await Promise.all([
          AsyncStorage.getItem("token"),
          AsyncStorage.getItem("nanny_id"),
          AsyncStorage.getItem("user_id"),
          AsyncStorage.getItem("api_key"),
        ]);
        const token = sanitizeToken(tokenRaw || undefined);
        const effectiveNannyId = String(storedNannyId || storedUserId || "").trim();
        const apiKey = String(storedApiKey || getRuntimeApiKey() || "").trim();

        if (effectiveNannyId) {
          const headers = {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          };

          const [detailsJson, profileJson] = await Promise.all([
            apiRequest<any>(`nannies/${encodeURIComponent(effectiveNannyId)}`, { headers }).catch(() => null),
            apiRequest<any>(`profiles/syttrs?user_id=${encodeURIComponent(effectiveNannyId)}`, {
              headers,
            }).catch(() => null),
          ]);

          const profileRow = Array.isArray(profileJson)
            ? profileJson[0]
            : Array.isArray(profileJson?.data)
            ? profileJson.data[0]
            : profileJson?.data?.profile || profileJson?.profile || null;
          const detailsRow = detailsJson?.data || detailsJson?.nanny || detailsJson || null;

          const directAvatar = resolveDashboardAvatarCandidate(
            profileRow?.avatar,
            profileRow?.user_image_url,
            profileRow?.profile_image_url,
            profileRow?.profile_image,
            profileRow?.user_image,
            profileRow?.image_url,
            profileRow?.image,
            profileRow?.user?.user_image_url,
            profileRow?.user?.profile_image_url,
            profileRow?.user?.profile_image,
            profileRow?.user?.user_image,
            profileRow?.user?.avatar,
            detailsRow?.avatar,
            detailsRow?.user_image_url,
            detailsRow?.profile_image_url,
            detailsRow?.profile_image,
            detailsRow?.user_image,
            detailsRow?.image_url,
            detailsRow?.image,
            detailsRow?.user?.user_image_url,
            detailsRow?.user?.profile_image_url,
            detailsRow?.user?.profile_image,
            detailsRow?.user?.user_image,
            detailsRow?.user?.avatar
          );

          if (directAvatar) {
            setAvatarFailed(false);
            setAvatarUrl(directAvatar);
            await AsyncStorage.multiSet([
              ["nanny_image", directAvatar],
              ["user_image", directAvatar],
            ]);
          }

          const directName =
            sanitizeDisplayName(profileRow?.fullname) ||
            sanitizeDisplayName(profileRow?.name) ||
            sanitizeDisplayName(detailsRow?.fullname) ||
            sanitizeDisplayName(detailsRow?.name) ||
            sanitizeDisplayName(profileRow?.user?.fullname) ||
            sanitizeDisplayName(profileRow?.user?.name) ||
            sanitizeDisplayName(detailsRow?.user?.fullname) ||
            sanitizeDisplayName(detailsRow?.user?.name);
          if (directName) {
            setStoredName(directName);
            await AsyncStorage.multiSet([
              ["nanny_name", directName],
              ["user_name", directName],
            ]);
          }
        }
      } catch {
        // keep previously resolved dashboard identity
      }
      void fetchRateCard();
      void fetchHireRequests();
      void fetchNextBooking();
      void fetchRatingSummary();
      void fetchWeeklyEarnings();
      void fetchNotificationCount();
      void fetchMessageCount();
      void checkProfileStatus();
    };
    load();
    const unsubscribe = navigation?.addListener?.("focus", load);
    return () => unsubscribe?.();
  }, [rateCards, navigation]);

  useEffect(() => {
    const timer = setInterval(() => {
      void fetchMessageCount();
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshLiveNannyData = () => {
      void fetchHireRequests(true);
      void fetchNotificationCount();
    };

    const interval = setInterval(refreshLiveNannyData, 5000);
    const unsubscribe = navigation?.addListener?.("focus", refreshLiveNannyData);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshLiveNannyData();
      }
    });

    return () => {
      clearInterval(interval);
      unsubscribe?.();
      appStateSubscription.remove();
    };
  }, [navigation]);

  const displayName =
    sanitizeDisplayName(userName) ||
    sanitizeDisplayName(storedName) ||
    "Syttr";
  const formatRateLabel = (raw?: string) => {
    const num = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(num)) return "--";
    return `$${num.toFixed(2)}`;
  };

  const extractKidNames = (job: any) => {
    const names: string[] = [];
    const collect = (child: any) => {
      if (child?.name) names.push(child.name);
    };

    const kidsList =
      Array.isArray(job?.kids) ? job.kids : Array.isArray(job?.children) ? job.children : null;
    const kidArray = Array.isArray(job?.kid) ? job.kid : null;
    if (kidsList?.length) {
      kidsList.forEach((entry: any) => collect(entry?.kids || entry?.kid || entry));
    } else if (kidArray?.length) {
      kidArray.forEach((entry: any) => collect(entry?.kids || entry?.kid || entry));
    } else {
      collect(job?.kid);
      collect(job?.child);
      collect(job?.kids);
      collect(job?.children);
    }

    return names;
  };

  const extractJobListFromPayload = (payload: any): any[] => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data?.data)) return payload.data.data;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.jobs)) return payload.jobs;
    if (Array.isArray(payload?.data?.jobs)) return payload.data.jobs;
    return [];
  };

  const buildActiveJobSummary = (sourceRow: any, effectiveNannyId: string): JobSummary | null => {
    const job =
      sourceRow?.job && typeof sourceRow.job === "object" && (sourceRow.job?.id || sourceRow.job?.job_id)
        ? sourceRow.job
        : sourceRow;
    if (!job || typeof job !== "object") return null;

    const applications = Array.isArray(job?.applications) ? job.applications : [];
    const matchedAcceptedApplication = applications.find(
      (application: any) =>
        String(application?.nanny_id || "").trim() === effectiveNannyId &&
        isAcceptedJobStatus(application?.status)
    );
    const viewerStatus =
      sourceRow?.application?.status ??
      sourceRow?.application_status ??
      sourceRow?.status ??
      job?.application_status ??
      job?.my_application_status ??
      job?.application?.status ??
      matchedAcceptedApplication?.status ??
      "";

    if (!isAcceptedJobStatus(viewerStatus) && !matchedAcceptedApplication) {
      return null;
    }

    const mergedJob = {
      ...job,
      status: sourceRow?.status ?? job?.status,
      application_status: viewerStatus,
      my_application_status: job?.my_application_status ?? viewerStatus,
      application:
        sourceRow?.application ||
        job?.application ||
        matchedAcceptedApplication ||
        null,
      application_id:
        sourceRow?.application_id ||
        sourceRow?.application?.id ||
        sourceRow?.application?.application_id ||
        job?.application_id ||
        job?.application?.id ||
        job?.application?.application_id ||
        matchedAcceptedApplication?.id ||
        matchedAcceptedApplication?.application_id,
      nanny_id:
        sourceRow?.nanny_id ||
        sourceRow?.application?.nanny_id ||
        job?.nanny_id ||
        job?.application?.nanny_id ||
        matchedAcceptedApplication?.nanny_id,
      nanny: sourceRow?.nanny || job?.nanny || matchedAcceptedApplication?.nanny || null,
      notification_id: sourceRow?.notification_id || sourceRow?.id || job?.notification_id,
    };

    const kidNames = extractKidNames(mergedJob);
    const familyName =
      mergedJob?.parent_name ||
      [mergedJob?.parent_firstname, mergedJob?.parent_lastname].filter(Boolean).join(" ").trim() ||
      mergedJob?.parent_user?.name ||
      mergedJob?.parent?.name ||
      mergedJob?.client?.name ||
      "Family";
    const scheduleDate = mergedJob?.start_date || mergedJob?.date || "";
    const scheduleTime = mergedJob?.start_time || mergedJob?.time || "";
    const formattedScheduleDate = formatDateValue(scheduleDate);
    const formattedScheduleTime = formatTimeValue(scheduleTime);
    const scheduleLabel =
      [formattedScheduleDate, formattedScheduleTime].filter(Boolean).join(" - ") || "Upcoming";
    const summary = kidNames.length ? kidNames.join(", ") : "Childcare shift";
    const location = mergedJob?.location || "Client home";
    const parentImage = resolveImageUrl(
      mergedJob?.parent_image_url ||
        mergedJob?.parent_profile_image ||
        mergedJob?.parent_image ||
        mergedJob?.parent?.profile_image ||
        mergedJob?.parent?.user_image_url ||
        mergedJob?.parent?.user_image ||
        mergedJob?.parent_user?.profile_image ||
        mergedJob?.parent_user?.user_image
    );

    return {
      id: String(mergedJob?.id || mergedJob?.job_id || mergedJob?.application_id || ""),
      family: familyName,
      parentImage,
      summary,
      schedule: scheduleLabel,
      location,
      startDate: scheduleDate || undefined,
      hoursLabel: formatHoursLabel(mergedJob?.hours),
      raw: mergedJob,
    };
  };

  const buildPendingJobSummary = (sourceRow: any, effectiveNannyId: string): JobSummary | null => {
    const job =
      sourceRow?.job && typeof sourceRow.job === "object" && (sourceRow.job?.id || sourceRow.job?.job_id)
        ? sourceRow.job
        : sourceRow;
    if (!job || typeof job !== "object") return null;

    const applications = Array.isArray(job?.applications) ? job.applications : [];
    const matchedViewerApplication = applications.find(
      (application: any) => String(application?.nanny_id || "").trim() === effectiveNannyId
    );

    const hasApplicationMarker =
      !!sourceRow?.application ||
      !!sourceRow?.application_id ||
      !!job?.application ||
      !!job?.application_id ||
      matchedViewerApplication !== undefined ||
      job?.has_applied === true ||
      job?.has_applied === 1 ||
      job?.has_pending_application === true ||
      job?.has_pending_application === 1 ||
      !!job?.application_status ||
      !!job?.my_application_status;

    const viewerStatus =
      sourceRow?.application?.status ??
      sourceRow?.application_status ??
      job?.application_status ??
      job?.my_application_status ??
      job?.application?.status ??
      matchedViewerApplication?.status ??
      "";

    const requestSource = String(
      sourceRow?.request_source ||
        job?.request_source ||
        matchedViewerApplication?.request_source ||
        ""
    )
      .toLowerCase()
      .trim();
    const jobStatus = String(sourceRow?.status ?? job?.status ?? "")
      .toLowerCase()
      .trim();
    const alreadyTaken =
      isAcceptedJobStatus(viewerStatus) ||
      isAcceptedJobStatus(jobStatus) ||
      applications.some((application: any) => isAcceptedJobStatus(application?.status));

    // Direct hire requests should only appear for the nanny they were sent to.
    if (!hasApplicationMarker && requestSource === "hire_request") {
      return null;
    }

    if (alreadyTaken) {
      return null;
    }

    const shouldShowAsPending =
      (hasApplicationMarker && isPendingJobStatus(viewerStatus)) ||
      (!hasApplicationMarker &&
        (jobStatus === "" ||
          isPendingJobStatus(jobStatus) ||
          ["open", "new", "available"].includes(jobStatus)));

    if (!shouldShowAsPending) {
      return null;
    }

    const mergedJob = {
      ...job,
      status: sourceRow?.status ?? job?.status,
      application_status: viewerStatus,
      my_application_status: job?.my_application_status ?? viewerStatus,
      application:
        sourceRow?.application ||
        job?.application ||
        matchedViewerApplication ||
        null,
      application_id:
        sourceRow?.application_id ||
        sourceRow?.application?.id ||
        sourceRow?.application?.application_id ||
        job?.application_id ||
        job?.application?.id ||
        job?.application?.application_id ||
        matchedViewerApplication?.id ||
        matchedViewerApplication?.application_id,
      nanny_id:
        sourceRow?.nanny_id ||
        sourceRow?.application?.nanny_id ||
        job?.nanny_id ||
        job?.application?.nanny_id ||
        matchedViewerApplication?.nanny_id,
      nanny: sourceRow?.nanny || job?.nanny || matchedViewerApplication?.nanny || null,
      notification_id: sourceRow?.notification_id || sourceRow?.id || job?.notification_id,
    };

    const kidNames = extractKidNames(mergedJob);
    const familyName =
      mergedJob?.parent_name ||
      [mergedJob?.parent_firstname, mergedJob?.parent_lastname].filter(Boolean).join(" ").trim() ||
      mergedJob?.parent_user?.name ||
      mergedJob?.parent?.name ||
      mergedJob?.client?.name ||
      "Family";
    const scheduleDate = mergedJob?.start_date || mergedJob?.date || "";
    const scheduleTime = mergedJob?.start_time || mergedJob?.time || "";
    const formattedScheduleDate = formatDateValue(scheduleDate);
    const formattedScheduleTime = formatTimeValue(scheduleTime);
    const scheduleLabel =
      [formattedScheduleDate, formattedScheduleTime].filter(Boolean).join(" - ") || "Upcoming";
    const summary = kidNames.length ? kidNames.join(", ") : "Childcare shift";
    const location = mergedJob?.location || "Client home";
    const parentImage = resolveImageUrl(
      mergedJob?.parent_image_url ||
        mergedJob?.parent_profile_image ||
        mergedJob?.parent_image ||
        mergedJob?.parent?.profile_image ||
        mergedJob?.parent?.user_image_url ||
        mergedJob?.parent?.user_image ||
        mergedJob?.parent_user?.profile_image ||
        mergedJob?.parent_user?.user_image
    );

    return {
      id: String(mergedJob?.id || mergedJob?.job_id || mergedJob?.application_id || ""),
      family: familyName,
      parentImage,
      summary,
      schedule: scheduleLabel,
      location,
      startDate: scheduleDate || undefined,
      hoursLabel: formatHoursLabel(mergedJob?.hours),
      raw: mergedJob,
    };
  };

  const fetchRateCard = async () => {
    let hadLocalRate = false;
    try {
      setRateLoading(true);
      const [tokenRaw, storedNannyId, storedUserId] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("nanny_id"),
        AsyncStorage.getItem("user_id"),
      ]);
      const token = sanitizeToken(tokenRaw || undefined);
      const effectiveNannyId = String(storedNannyId || storedUserId || "").trim();

      const persistLocalRate = async (value: any) => {
        if (value === null || value === undefined || value === "") return false;
        const normalized = String(value).trim();
        if (!normalized) return false;
        setStoredRates({ morning: normalized, evening: normalized, night: normalized });
        setRateInput(normalized);
        await AsyncStorage.multiSet([
          ["rate_morning", normalized],
          ["rate_evening", normalized],
          ["rate_night", normalized],
        ]);
        return true;
      };

      const [savedMorning, savedEvening, savedNight] = await AsyncStorage.multiGet([
        "rate_morning",
        "rate_evening",
        "rate_night",
      ]);
      const localMorning = String(savedMorning?.[1] || "").trim();
      const localEvening = String(savedEvening?.[1] || "").trim();
      const localNight = String(savedNight?.[1] || "").trim();
      if (localMorning || localEvening || localNight) {
        hadLocalRate = true;
        const fallbackLocalRate = localMorning || localEvening || localNight;
        setStoredRates({
          morning: localMorning || fallbackLocalRate,
          evening: localEvening || fallbackLocalRate,
          night: localNight || fallbackLocalRate,
        });
        setRateInput(fallbackLocalRate);
        setRequireHourlyRate(false);
        setShowRateModal(false);
      }

      if (!effectiveNannyId) {
        return;
      }

      // Primary source: Laravel profile endpoint (DB-backed hourly_rate)
      const profileJson = await apiRequest<any>(
        `profiles/syttrs?user_id=${encodeURIComponent(effectiveNannyId)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
      );

      const profiles = Array.isArray(profileJson)
        ? profileJson
        : Array.isArray(profileJson?.data)
        ? profileJson.data
        : [];
      const hourlyRate = profiles?.[0]?.hourly_rate;
      const hasPersistedRate = await persistLocalRate(hourlyRate);
      if (hasPersistedRate) {
        setRequireHourlyRate(false);
        setShowRateModal(false);
      } else if (!(localMorning || localEvening || localNight)) {
        setRequireHourlyRate(true);
        setShowRateModal(true);
      }
    } catch (e) {
      if (!hadLocalRate) {
        setRequireHourlyRate(true);
        setShowRateModal(true);
      }
      const message = String((e as any)?.message || e || "");
      const isNetworkError = /network request failed|timed out/i.test(message);
      const now = Date.now();
      const last = networkWarnAtRef.current.fetchRateCard || 0;
      if (!isNetworkError || now - last > 30000) {
        networkWarnAtRef.current.fetchRateCard = now;
        console.warn("fetchRateCard failed", e);
      }
    } finally {
      setRateLoading(false);
    }
  };

  const fetchNotificationCount = async () => {
    try {
      const tokenRaw =
        (await AsyncStorage.getItem("token")) ||
        (await AsyncStorage.getItem("nanny_token"));
      const apiKey =
        (await AsyncStorage.getItem("api_key")) ||
        getRuntimeApiKey() ||
        undefined;
      const nannyId =
        (await AsyncStorage.getItem("nanny_id")) ||
        (await AsyncStorage.getItem("user_id"));
      const token = sanitizeToken(tokenRaw || undefined);

      if (!token || !nannyId) {
        setNotificationCount(0);
        return;
      }

      const queryParts = [];
      if (nannyId) queryParts.push(`nanny_id=${encodeURIComponent(nannyId)}`);
      if (apiKey) queryParts.push(`api_key=${encodeURIComponent(apiKey)}`);
      const query = queryParts.length ? `?${queryParts.join("&")}` : "";

      const json = await apiRequest<any>(`nanny/notifications${query}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(apiKey ? { "x-api-key": apiKey } : {}),
          ...(nannyId ? { "nanny-id": nannyId, nanny_id: nannyId } : {}),
        },
      });
      const data = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : [];
      const unread = data.filter((item: any) => !isNotificationRead(item));
      setNotificationCount(unread.length);

      const latestHireRequestClosed = unread.find((item: any) => {
        const type = String(item?.type || "").trim().toLowerCase();
        return type === "hire_request_closed";
      });
      const latestHireRequestClosedId = String(
        latestHireRequestClosed?.id ||
          latestHireRequestClosed?.notification_id ||
          latestHireRequestClosed?.data?.notification_key ||
          ""
      ).trim();
      if (
        latestHireRequestClosed &&
        latestHireRequestClosedId &&
        latestHireRequestClosedId !== lastHireRequestClosedAlertRef.current
      ) {
        lastHireRequestClosedAlertRef.current = latestHireRequestClosedId;
        Alert.alert(
          "Hire Request Closed",
          latestHireRequestClosed?.message ||
            "This job request is no longer available because the parent hired another Syttr."
        );
      }
    } catch (e) {
      const message = String((e as any)?.message || e || "");
      const isNetworkError = /network request failed|timed out/i.test(message);
      const now = Date.now();
      const last = networkWarnAtRef.current.fetchNotificationCount || 0;
      if (!isNetworkError || now - last > 30000) {
        networkWarnAtRef.current.fetchNotificationCount = now;
        console.warn("fetchNotificationCount failed", e);
      }
      setNotificationCount(0);
    }
  };

  const getNannyAuthContext = async () => {
    const [tokenRaw, nannyTokenRaw, apiKeyStored, userIdRaw, nannyIdRaw] = await Promise.all([
      AsyncStorage.getItem("token"),
      AsyncStorage.getItem("nanny_token"),
      AsyncStorage.getItem("api_key"),
      AsyncStorage.getItem("user_id"),
      AsyncStorage.getItem("nanny_id"),
    ]);
    const token = sanitizeToken(tokenRaw || nannyTokenRaw || undefined);
    const apiKey = String(apiKeyStored || getRuntimeApiKey() || "").trim() || undefined;
    const userId = String(userIdRaw || "").trim();
    const nannyId = String(nannyIdRaw || userIdRaw || "").trim();

    return {
      token,
      apiKey,
      userId,
      nannyId,
      authHeader: token ? `Bearer ${token}` : undefined,
    };
  };

  const fetchHireRequests = async (silent = false) => {
    if (!silent) {
      setHireRequestsLoading(true);
    }
    try {
      const { authHeader, apiKey, nannyId } = await getNannyAuthContext();
      if (!nannyId) {
        setHireRequests([]);
        return;
      }

      const queryParts = [`nanny_id=${encodeURIComponent(nannyId)}`];
      if (apiKey) queryParts.push(`api_key=${encodeURIComponent(apiKey)}`);
      const json = await apiRequest<any>(`nanny/hire-requests?${queryParts.join("&")}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
      });
      if (json?.success === false) {
        throw new Error(json?.message || "Unable to load hire requests.");
      }

      const rows = Array.isArray(json?.data) ? json.data : [];
      const mapped: HireRequestSummary[] = rows
        .map((row: any, index: number) => {
          const job = row?.job || {};
          const parent = row?.parent || {};
          const kids = Array.isArray(row?.kids)
            ? row.kids
            : Array.isArray(job?.kids)
            ? job.kids
            : [];
          const applicationId = String(
            row?.application_id ||
              row?.application?.application_id ||
              row?.application?.id ||
              ""
          ).trim();
          if (!applicationId) return null;

          const notificationId = String(row?.id || row?.notification_id || "").trim() || undefined;
          const parentName = String(parent?.name || "Parent").trim() || "Parent";
          const kidsLabel = kids
            .map((kid: any) => {
              const bits = [kid?.name, kid?.age ? `${kid.age}` : "", kid?.gender].filter(Boolean);
              return bits.join(" ");
            })
            .filter(Boolean)
            .join(", ");

          return {
            id: notificationId || `hire-${applicationId}-${index}`,
            applicationId,
            notificationId,
            parentName,
            dateLabel: formatDateValue(job?.start_date || row?.created_at || ""),
            timeLabel: formatTimeValue(job?.start_time || ""),
            location: String(job?.location || "Location TBD").trim() || "Location TBD",
            kidsLabel,
            parentStatsLabel: buildParentStatsLabel(parent, job),
            raw: {
              ...row,
              type: "hire_request",
              title: "Hire Request",
              job,
              parent,
              kids,
            },
          };
        })
        .filter(Boolean) as HireRequestSummary[];

      setHireRequests(mapped);
    } catch (e) {
      const message = String((e as any)?.message || e || "");
      const isNetworkError = /network request failed|timed out/i.test(message);
      const now = Date.now();
      const last = networkWarnAtRef.current.fetchHireRequests || 0;
      if (!isNetworkError || now - last > 30000) {
        networkWarnAtRef.current.fetchHireRequests = now;
        console.warn("fetchHireRequests failed", e);
      }
      if (!silent) {
        setHireRequests([]);
      }
    } finally {
      if (!silent) {
        setHireRequestsLoading(false);
      }
    }
  };

  const goToNotifications = () => {
    if (onNotifications) onNotifications();
    else navigation?.navigate?.("NannyNotifications");
  };

  const submitHireRequestDecision = async (
    request: HireRequestSummary,
    decision: "accept" | "reject"
  ) => {
    if (!request.applicationId) {
      Alert.alert("Hire Request", "Application ID missing.");
      return;
    }
    if (hireDecisionLoadingKey && hireDecisionLoadingKey === request.applicationId) {
      return;
    }

    try {
      setHireDecisionLoadingKey(request.applicationId);
      setHireDecisionLoadingAction(decision);
      const { authHeader, apiKey, nannyId, userId } = await getNannyAuthContext();
      const endpoint = decision === "accept" ? "accept" : "reject";
      const payload: Record<string, string> = {};
      if (userId) payload.user_id = userId;
      if (nannyId) payload.nanny_id = nannyId;

      const json = await apiRequest<any>(
        `nanny/hire-requests/${encodeURIComponent(request.applicationId)}/${endpoint}`,
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

      setHireRequests((prev) =>
        prev.filter((entry) => entry.applicationId !== request.applicationId)
      );
      await Promise.all([
        fetchNotificationCount(),
        fetchHireRequests(),
        decision === "accept" ? fetchNextBooking() : Promise.resolve(),
      ]);

      Alert.alert(
        "Hire Request",
        decision === "accept" ? "Hire request accepted." : "Hire request rejected."
      );
    } catch (e: any) {
      Alert.alert("Hire Request", e?.message || "Unable to update hire request.");
    } finally {
      setHireDecisionLoadingKey("");
      setHireDecisionLoadingAction(null);
    }
  };

  const fetchMessageCount = async () => {
    try {
      const count = await fetchUnreadConversationCount();
      setMessageCount(count);
      lastMessageCountRef.current = count;
      initializedMessageCountRef.current = true;
    } catch {
      setMessageCount(0);
    }
  };

  const fetchNextBooking = async () => {
    try {
      const [{ authHeader, apiKey, nannyId }, canceledRaw] = await Promise.all([
        getNannyAuthContext(),
        AsyncStorage.getItem("canceled_job_ids"),
      ]);
      const effectiveNannyId = String(nannyId || "").trim();
      if (!effectiveNannyId) {
        setActiveJobsCount(0);
        setBookingJobs([]);
        setUpcomingShifts([]);
        setNextBooking(null);
        return;
      }

      let canceledParsed: any[] = [];
      try {
        const parsed = canceledRaw ? JSON.parse(canceledRaw) : [];
        canceledParsed = Array.isArray(parsed) ? parsed : [];
      } catch {
        canceledParsed = [];
      }
      const canceledIds = new Set(canceledParsed.map((id: any) => String(id || "").trim()).filter(Boolean));

      let acceptedRows: any[] | null = null;
      let feedRows: any[] = [];

      try {
        const res = await fetch(`${BASE_URL}calendar/bookings`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(authHeader ? { Authorization: authHeader } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
            ...(effectiveNannyId ? { "nanny-id": effectiveNannyId, nanny_id: effectiveNannyId } : {}),
          },
          body: JSON.stringify({
            viewer: "nanny",
            nanny_id: effectiveNannyId,
            per_page: 200,
          }),
        });
        const json = await res.json().catch(() => null);
        if (res.ok) {
          acceptedRows = extractJobListFromPayload(json);
        }
      } catch {
        acceptedRows = null;
      }

      const jobQueryCandidates = [`?nanny_id=${encodeURIComponent(effectiveNannyId)}`, ""];
      for (const suffix of jobQueryCandidates) {
        try {
          const payload: any = await apiRequest(`job/index${suffix}`, {
            method: "GET",
            headers: {
              ...(authHeader ? { Authorization: authHeader } : {}),
            },
          });
          const rows = extractJobListFromPayload(payload);
          if (Array.isArray(rows)) {
            feedRows = rows;
            if (acceptedRows === null) {
              acceptedRows = rows;
            }
            break;
          }
        } catch {
          // try next candidate
        }
      }

      const now = Date.now();
      const upcomingMap = (acceptedRows || []).reduce<Map<string, JobSummary>>((map, row: any) => {
          const summary = buildActiveJobSummary(row, effectiveNannyId);
          if (!summary) return map;

          const jobId = String(summary.raw?.id || summary.raw?.job_id || summary.id || "").trim();
          if (jobId && canceledIds.has(jobId)) return map;
          const jobStart = getJobStartTimestamp(summary.raw);
          if (!Number.isFinite(jobStart) || jobStart <= now) return map;

          const dedupeKey = jobId || String(summary.id);
          const existing = map.get(dedupeKey);
          if (!existing) {
            map.set(dedupeKey, summary);
            return map;
          }

          const existingStamp = getJobStartTimestamp(existing.raw);
          const nextStamp = getJobStartTimestamp(summary.raw);
          const shouldReplace =
            !Number.isFinite(existingStamp) ||
            (Number.isFinite(nextStamp) && nextStamp < existingStamp);
          if (shouldReplace) {
            map.set(dedupeKey, summary);
          }
          return map;
        }, new Map<string, JobSummary>());
      const normalizedUpcomingJobs: JobSummary[] = Array.from(upcomingMap.values()).sort(
        (left: JobSummary, right: JobSummary) => {
        const leftStamp = getJobStartTimestamp(left.raw);
        const rightStamp = getJobStartTimestamp(right.raw);
        const safeLeft = Number.isFinite(leftStamp) ? leftStamp : Number.MAX_SAFE_INTEGER;
        const safeRight = Number.isFinite(rightStamp) ? rightStamp : Number.MAX_SAFE_INTEGER;
        return safeLeft - safeRight;
      });

      const pendingMap = (feedRows || []).reduce<Map<string, JobSummary>>((map, row: any) => {
        const summary = buildPendingJobSummary(row, effectiveNannyId);
        if (!summary) return map;

        const jobId = String(summary.raw?.id || summary.raw?.job_id || summary.id || "").trim();
        if (jobId && canceledIds.has(jobId)) return map;
        const jobStart = getJobStartTimestamp(summary.raw);
        if (!Number.isFinite(jobStart) || jobStart <= now) return map;

        const dedupeKey = jobId || String(summary.id);
        const existing = map.get(dedupeKey);
        if (!existing) {
          map.set(dedupeKey, summary);
          return map;
        }

        const existingStamp = getJobStartTimestamp(existing.raw);
        const nextStamp = getJobStartTimestamp(summary.raw);
        const shouldReplace =
          !Number.isFinite(existingStamp) ||
          (Number.isFinite(nextStamp) && nextStamp < existingStamp);
        if (shouldReplace) {
          map.set(dedupeKey, summary);
        }
        return map;
      }, new Map<string, JobSummary>());
      const normalizedPendingJobs: JobSummary[] = Array.from(pendingMap.values()).sort(
        (left: JobSummary, right: JobSummary) => {
          const leftStamp = getJobStartTimestamp(left.raw);
          const rightStamp = getJobStartTimestamp(right.raw);
          const safeLeft = Number.isFinite(leftStamp) ? leftStamp : Number.MAX_SAFE_INTEGER;
          const safeRight = Number.isFinite(rightStamp) ? rightStamp : Number.MAX_SAFE_INTEGER;
          return safeLeft - safeRight;
        }
      );

      setUpcomingShifts(normalizedUpcomingJobs);
      setActiveJobsCount(normalizedUpcomingJobs.length);
      setBookingJobs(normalizedPendingJobs);
      setNextBooking(normalizedPendingJobs[0] || null);
    } catch (e) {
      console.warn("fetchNextBooking failed", e);
      setActiveJobsCount(0);
      setBookingJobs([]);
      setUpcomingShifts([]);
      setNextBooking(null);
    }
  };

  const fetchRatingSummary = async () => {
    try {
      const [token, apiKey, nannyId, userId] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("api_key"),
        AsyncStorage.getItem("nanny_id"),
        AsyncStorage.getItem("user_id"),
      ]);
      const effectiveNannyId = nannyId || userId;
      if (!effectiveNannyId) {
        setAverageRating(null);
        return;
      }
      const summary: any = await getNannyRatingSummary(
        effectiveNannyId,
        token || undefined,
        apiKey || undefined
      );
      const avg =
        parseNumber(summary?.average_rating) ??
        parseNumber(summary?.data?.average_rating) ??
        parseNumber(summary?.rating) ??
        parseNumber(summary?.data?.rating);
      setAverageRating(avg);
    } catch (e) {
      const status = Number((e as any)?.status || 0);
      const message = String((e as any)?.message || "").toLowerCase();
      const isExpectedUnavailable =
        status === 404 ||
        status === 405 ||
        message.includes("network request failed") ||
        message.includes("supported methods: options") ||
        message.includes("unable to load rating summary");
      if (!isExpectedUnavailable) {
        console.warn("fetchRatingSummary failed", e);
      }
      setAverageRating(null);
    }
  };

  const fetchWeeklyEarnings = async () => {
    try {
      const tokenRaw =
        (await AsyncStorage.getItem("token")) ||
        (await AsyncStorage.getItem("nanny_token"));
      const token = tokenRaw ? tokenRaw.replace(/"/g, "").trim() : "";
      const apiKey =
        (await AsyncStorage.getItem("api_key")) ||
        getRuntimeApiKey() ||
        undefined;
      const nannyId =
        (await AsyncStorage.getItem("nanny_id")) ||
        (await AsyncStorage.getItem("user_id"));

      if (!nannyId) {
        setEarningsByDay(createEmptyWeekEarnings());
        return;
      }

      const queryParts = [];
      if (nannyId) queryParts.push(`nanny_id=${encodeURIComponent(nannyId)}`);
      if (apiKey) queryParts.push(`api_key=${encodeURIComponent(apiKey)}`);
      const query = queryParts.length ? `?${queryParts.join("&")}` : "";
      const endpointCandidates = [
        `${BASE_URL}wallet/transactions${query}`,
        `${BASE_URL}wallet/history${query}`,
        `${BASE_URL}nanny/transactions${query}`,
        `${BASE_URL}nanny/wallet/transactions${query}`,
      ];

      const headers = {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
        ...(nannyId ? { "nanny-id": nannyId, nanny_id: nannyId } : {}),
      };

      let transactions: any[] = [];
      for (const url of endpointCandidates) {
        try {
          const res = await fetch(url, { headers });
          if (!res.ok) continue;
          const json = await res.json().catch(() => null);
          const list = getTransactionsArrayFromPayload(json);
          if (Array.isArray(list)) {
            transactions = list;
            if (transactions.length > 0) break;
          }
        } catch {
          // try next candidate
        }
      }

      const weekStart = getWeekStartMonday(new Date());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const totals = [0, 0, 0, 0, 0, 0, 0];
      transactions.forEach((tx: any) => {
        const amount =
          parseMoneyAmount(tx?.net_amount) ??
          parseMoneyAmount(tx?.amount) ??
          parseMoneyAmount(tx?.value) ??
          parseMoneyAmount(tx?.total) ??
          parseMoneyAmount(tx?.credit) ??
          0;
        if (!Number.isFinite(amount) || amount <= 0) return;

        const typeRaw = tx?.type || tx?.transaction_type || tx?.kind || tx?.category;
        if (isDebitLikeTransaction(typeRaw, tx?.direction)) return;

        const statusRaw = String(tx?.status || tx?.payment_status || tx?.state || "")
          .trim()
          .toLowerCase();
        if (
          statusRaw &&
          (statusRaw.includes("fail") || statusRaw.includes("cancel") || statusRaw.includes("declin"))
        ) {
          return;
        }

        const dateCandidate = tx?.created_at || tx?.paid_at || tx?.date || tx?.updated_at;
        const when = parseLocalDateLike(dateCandidate);
        if (!when) return;

        const localDay = new Date(when.getFullYear(), when.getMonth(), when.getDate());
        if (localDay < weekStart || localDay >= weekEnd) return;

        const dayIndex = (localDay.getDay() + 6) % 7; // Monday=0 ... Sunday=6
        totals[dayIndex] += amount;
      });

      setEarningsByDay(
        WEEK_DAYS_MON_TO_SUN.map((day, index) => ({
          day,
          amount: Number(totals[index].toFixed(2)),
        }))
      );
    } catch (e) {
      console.warn("fetchWeeklyEarnings failed", e);
      setEarningsByDay(createEmptyWeekEarnings());
    }
  };

  const checkProfileStatus = async () => {
    try {
      const [token, apiKey, nannyId] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("api_key"),
        AsyncStorage.getItem("nanny_id"),
      ]);
      if (!nannyId) return;
      const res: any = await checkNannyApprovalStatus(
        { nanny_id: nannyId },
        token || undefined,
        apiKey || undefined
      );
      const status =
        res?.status ||
        res?.data?.status ||
        res?.approval_status ||
        res?.data?.approval_status ||
        "";
      const normalizedStatus = String(status).toLowerCase();
      if (normalizedStatus.includes("reject") || normalizedStatus.includes("blacklist")) {
        await AsyncStorage.multiSet([
          ["nanny_approval_state", "rejected"],
          ["user_verification_status", "blacklisted"],
        ]);
        onRejected?.();
      }
    } catch (e) {
      console.warn("checkProfileStatus failed", e);
    }
  };

  const openRateEdit = () => {
    setRateInput(storedRates.morning || rateInput || "");
    setShowRateModal(true);
  };

  const saveRate = async () => {
    const trimmed = rateInput.trim();
    if (!trimmed) {
      Alert.alert("Hourly rate", "Please enter your hourly rate (e.g. 24 or $24/hr).");
      return;
    }
    const normalizedRate = trimmed.replace(/[^0-9.]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(normalizedRate)) {
      Alert.alert("Hourly rate", "Enter a valid number (e.g. 24 or 24.50).");
      return;
    }

    try {
      setSavingRate(true);
      const [token, nannyId, userId] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("nanny_id"),
        AsyncStorage.getItem("user_id"),
      ]);
      const effectiveId = nannyId || userId;
      if (!effectiveId) throw new Error("Syttr ID not found. Please sign in again.");
      await updateNannyProfile(
        {
          nanny_id: effectiveId,
          hourly_rate: Number(normalizedRate),
        },
        token || undefined
      );

      await AsyncStorage.multiSet([
        ["rate_morning", normalizedRate],
        ["rate_evening", normalizedRate],
        ["rate_night", normalizedRate],
      ]);
      setStoredRates({ morning: normalizedRate, evening: normalizedRate, night: normalizedRate });
      setRateInput(normalizedRate);
      setRequireHourlyRate(false);
      fetchRateCard();
      setShowRateModal(false);
      Alert.alert("Saved", "Hourly rate updated.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to save hourly rate.");
    } finally {
      setSavingRate(false);
    }
  };

  const onTabPress = (key: NannyNavKey) => {
    setActiveTab(key);

    if (key === "Jobs" && onJobs) return onJobs();
    if (key === "Messages" && onMessages) return onMessages();
    if (key === "Notifications" && onNotifications) return onNotifications();
    if (key === "Calendar" && onCalendar) return onCalendar();
    if (key === "Settings" && onSettings) return onSettings();

    const routeMap: Record<NannyNavKey, string> = {
      Home: "NannyHome",
      Jobs: "NannyJobs",
      Calendar: "NannyCalendar",
      Messages: "NannyMessages",
      Notifications: "NannyNotifications",
      Settings: "NannySettings",
    };

    const route = routeMap[key];
    if (navigation?.navigate && route) {
      Alert.alert("Navigation", "Screen navigation is not configured for this action.");
    }
  };

  return (
    <SafeScreen edges={["top", "right", "bottom", "left"]} style={{ backgroundColor: "#FFFFFF" }}>
      <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={styles.root}>
        {/* CONTENT */}
        <ScrollView
          contentContainerStyle={{ paddingTop: rs(2), paddingBottom: rs(76) + Math.max(insets.bottom, 8) }}
          showsVerticalScrollIndicator={false}
        >
          {/* HEADER */}
          <View style={[styles.headerCard, isSmallPhone && styles.headerCardCompact]}>
            <View style={[styles.avatar, isSmallPhone && styles.avatarCompact]}>
              {avatarUrl && !avatarFailed ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={[styles.avatarImg, isSmallPhone && styles.avatarImgCompact]}
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <Ionicons name="person" size={24} color="#fff" />
              )}
            </View>

            <View style={{ flex: 1 }}>
              <Text style={[styles.hiText, isSmallPhone && styles.hiTextCompact]}>Hi, {displayName}!</Text>
              <Text style={styles.dateText}>{today}</Text>

              <View style={[styles.pillsRow, isSmallPhone && styles.pillsRowCompact]}>
                <View style={[styles.pill, isSmallPhone && styles.pillCompact]}>
                  <Ionicons name="star" size={12} color="#FFA000" />
                  <Text style={styles.pillText}>
                    {averageRating !== null ? averageRating.toFixed(1) : "--"}
                  </Text>
                </View>

                <View style={[styles.pill, isSmallPhone && styles.pillCompact]}>
                  <Ionicons name="calendar-outline" size={12} color="#C2185B" />
                  <Text style={styles.pillText}>
                    {activeJobsCount} active job{activeJobsCount === 1 ? "" : "s"}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* AVAILABILITY + QUICK ACTION */}
          <View style={[styles.row, isSmallPhone && styles.rowCompact]}>
         
            <View style={[styles.card, isSmallPhone && styles.cardCompact]}>
              <Text style={styles.cardTitle}>Quick Actions</Text>
              <TouchableOpacity
                style={styles.outlineBtn}
                activeOpacity={0.9}
                disabled={actionLoading !== null}
                onPress={async () => {
                  if (actionLoading) return;
                  setActionLoading("availability");
                  try {
                    if (onAvailability) await onAvailability();
                    else setAvailability(!availability);
                  } finally {
                    setActionLoading(null);
                  }
                }}
              >
                {actionLoading === "availability" ? (
                  <ActivityIndicator size="small" color="#C2185B" />
                ) : (
                  <Ionicons name="create-outline" size={14} color="#C2185B" />
                )}
                <Text style={styles.outlineBtnText}>Edit Availability</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.outlineBtn}
                activeOpacity={0.9}
                disabled={actionLoading !== null}
                onPress={async () => {
                  if (actionLoading) return;
                  setActionLoading("withdraw");
                  try {
                    if (onWithdraw) {
                      await onWithdraw();
                      return;
                    }
                    navigation?.navigate?.("Withdraw");
                  } finally {
                    setActionLoading(null);
                  }
                }}
              >
                {actionLoading === "withdraw" ? (
                  <ActivityIndicator size="small" color="#C2185B" />
                ) : (
                  <Ionicons name="cash-outline" size={14} color="#C2185B" />
                )}
                <Text style={styles.outlineBtnText}>Withdraw</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* RATE CARDS */}
          <View style={[styles.section, styles.hourlyRateSection, isSmallPhone && styles.sectionCompact]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Hourly Rate</Text>
              <TouchableOpacity onPress={openRateEdit}>
                <Text style={styles.link}>Edit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.rateRow}>
              <RateCard
                title="Hourly Rate"
                value={rateLoading ? "Loading..." : formatRateLabel(storedRates.morning)}
              />
            </View>
          </View>

          {/* HIRING REQUESTS */}
          <View style={[styles.section, isSmallPhone && styles.sectionCompact]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Hiring Requests</Text>
              <TouchableOpacity onPress={goToNotifications}>
                <Text style={styles.link}>View all</Text>
              </TouchableOpacity>
            </View>

            {hireRequestsLoading ? (
              <View style={styles.hireRequestEmpty}>
                <ActivityIndicator size="small" color="#C2185B" />
              </View>
            ) : hireRequests.length === 0 ? (
              <View style={styles.hireRequestEmpty}>
                <Text style={styles.lightText}>No pending hire requests right now.</Text>
              </View>
            ) : (
              hireRequests.slice(0, 3).map((request) => {
                const isLoading = hireDecisionLoadingKey === request.applicationId;
                const isAccepting = isLoading && hireDecisionLoadingAction === "accept";
                const isRejecting = isLoading && hireDecisionLoadingAction === "reject";
                const requestJob = request.raw?.job || {};
                const bookingDate = String(requestJob?.start_date || "").trim() || undefined;
                const bookingEvent = {
                  id: String(requestJob?.id || request.applicationId || request.id),
                  bookingId: String(requestJob?.id || request.applicationId || request.id),
                  job_id: requestJob?.id || request.raw?.job_id,
                  application_id: request.applicationId,
                  status:
                    request.raw?.status ||
                    request.raw?.request_status ||
                    request.raw?.application_status ||
                    request.raw?.application?.status ||
                    "hire_requested",
                  hours: requestJob?.hours,
                  start: requestJob?.start_time,
                  start_time: requestJob?.start_time,
                  end: requestJob?.end_time,
                  end_time: requestJob?.end_time,
                  date: requestJob?.start_date,
                  start_date: requestJob?.start_date,
                  pay: requestJob?.hourly_rate || requestJob?.rate || requestJob?.pay_rate,
                  parent: request.parentName,
                  child: request.kidsLabel,
                  location: request.location,
                  job: requestJob,
                  raw: request.raw,
                };

                return (
                  <TouchableOpacity
                    key={request.id}
                    activeOpacity={0.92}
                    style={styles.hireRequestCard}
                    onPress={() => {
                      onOpenBooking?.(bookingEvent, bookingDate);
                    }}
                  >
                    <View style={styles.hireRequestHeader}>
                      <Text style={styles.hireRequestTitle}>
                        Hire Request from {request.parentName}
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          onOpenBooking?.(bookingEvent, bookingDate);
                        }}
                      >
                        <Ionicons name="chevron-forward" size={16} color="#C2185B" />
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.hireRequestMeta}>
                      {request.dateLabel || "--"}
                      {request.timeLabel ? ` - ${request.timeLabel}` : ""}
                    </Text>
                    <Text style={styles.lightText}>{request.location}</Text>
                    {request.kidsLabel ? (
                      <Text style={styles.lightText}>Kids: {request.kidsLabel}</Text>
                    ) : null}
                    {request.parentStatsLabel ? (
                      <Text style={styles.hireRequestStats}>{request.parentStatsLabel}</Text>
                    ) : null}

                    <View style={styles.hireRequestActions}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        disabled={isLoading}
                        style={[
                          styles.hireRequestBtn,
                          styles.hireRequestAcceptBtn,
                          isLoading && styles.hireRequestBtnDisabled,
                        ]}
                        onPress={() => {
                          void submitHireRequestDecision(request, "accept");
                        }}
                      >
                        <Text style={[styles.hireRequestBtnText, styles.hireRequestAcceptText]}>
                          {isAccepting ? "Accepting..." : "Accept"}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={0.9}
                        disabled={isLoading}
                        style={[
                          styles.hireRequestBtn,
                          styles.hireRequestRejectBtn,
                          isLoading && styles.hireRequestBtnDisabled,
                        ]}
                        onPress={() => {
                          void submitHireRequestDecision(request, "reject");
                        }}
                      >
                        <Text style={[styles.hireRequestBtnText, styles.hireRequestRejectText]}>
                          {isRejecting ? "Rejecting..." : "Reject"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {/* EARNINGS */}
          <View style={[styles.section, isSmallPhone && styles.sectionCompact]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Earnings Overview</Text>
              <View style={styles.weekPill}>
                <Text style={styles.weekPillText}>This Week</Text>
              </View>
            </View>

            <View style={[styles.chartWrapper, isSmallPhone && styles.chartWrapperCompact]}>
              {earningsByDay.map((entry) => {
                const safeAmount = Number.isFinite(entry.amount) ? entry.amount : 0;
                const height = safeAmount > 0 ? Math.max(20, (safeAmount / maxEarning) * maxBarHeight) : 0;
                return (
                  <View key={entry.day} style={styles.chartBar}>
                    {safeAmount > 0 && (
                      <LinearGradient colors={["#FFB6D5", "#FF80AB"]} style={[styles.bar, { height }]}>
                        <View style={styles.barTextWrap}>
                          <Text
                            style={styles.barText}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.45}
                          >
                            {`$${Math.round(safeAmount)}`}
                          </Text>
                        </View>
                      </LinearGradient>
                    )}
                    <Text style={styles.dayLabel}>{entry.day}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.earningsFooter}>
              <View>
                <Text style={styles.lightText}>Weekly Total</Text>
                <Text style={styles.totalText}>
                  ${Number.isInteger(weeklyTotal) ? weeklyTotal.toFixed(0) : weeklyTotal.toFixed(2)}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.primaryBtnSmall}
                activeOpacity={0.9}
                onPress={() => {
                  if (onJobs) onJobs();
                  else navigation?.navigate?.("NannyJobs");
                }}
              >
                <Ionicons name="briefcase" size={14} color="#fff" />
                <Text style={styles.primaryBtnText}>View Jobs</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* NEXT BOOKING */}
          <View style={[styles.section, styles.nextBookingSection, isSmallPhone && styles.sectionCompact]}>
            <Text style={[styles.sectionTitle, styles.centeredSectionTitle]}>Find Your Next Booking</Text>

            {bookingJobs.length === 0 ? (
              <View style={styles.bookingCard}>
                <View style={styles.bookingAvatar}>
                  {nextBooking?.parentImage ? (
                    <Image source={{ uri: nextBooking.parentImage }} style={styles.bookingAvatarImg} />
                  ) : (
                    <Ionicons name="person" size={18} color="#FF80AB" />
                  )}
                </View>
                <View style={{ marginLeft: rs(10), flex: 1 }}>
                  <Text style={styles.bookingTitle}>{nextBooking?.family || "No Pending Booking"}</Text>
                  <Text style={styles.bookingSub}>{nextBooking?.schedule || "No pending bookings right now"}</Text>
                  <Text style={styles.lightText}>
                    {nextBooking?.summary || "Only jobs waiting on approval will appear here."}
                  </Text>
                  <Text style={styles.lightText}>{nextBooking?.location || ""}</Text>
                </View>
              </View>
            ) : (
              bookingJobs.map((job, idx) => (
                <TouchableOpacity
                  key={`home-booking-${String(job.id || idx)}`}
                  style={styles.bookingCard}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (onJobPress) {
                      onJobPress(job);
                      return;
                    }
                    if (onJobs) onJobs();
                  }}
                >
                  <View style={styles.bookingAvatar}>
                    {job.parentImage ? (
                      <Image source={{ uri: job.parentImage }} style={styles.bookingAvatarImg} />
                    ) : (
                      <Ionicons name="person" size={18} color="#FF80AB" />
                    )}
                  </View>
                  <View style={{ marginLeft: rs(10), flex: 1 }}>
                    <Text style={styles.bookingTitle}>{job.family}</Text>
                    <Text style={styles.bookingSub}>{job.schedule || "Flexible"}</Text>
                    <Text style={styles.lightText}>{job.summary || "Childcare shift"}</Text>
                    <Text style={styles.lightText}>{job.location || ""}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* UPCOMING */}
          <View style={[styles.section, styles.upcomingSection, isSmallPhone && styles.sectionCompact]}>
            <Text style={styles.sectionTitle}>Upcoming Shifts</Text>
            {upcomingShifts.length === 0 ? (
              <Text style={styles.lightText}>No upcoming shifts scheduled yet.</Text>
            ) : (
              upcomingShifts.map((job, idx) => (
                <TouchableOpacity
                  key={`upcoming-shift-${String(job.id || idx)}`}
                  style={styles.bookingCard}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (onJobPress) {
                      onJobPress(job);
                      return;
                    }
                    if (onJobs) onJobs();
                  }}
                >
                  <View style={styles.bookingAvatar}>
                    {job.parentImage ? (
                      <Image source={{ uri: job.parentImage }} style={styles.bookingAvatarImg} />
                    ) : (
                      <Ionicons name="person" size={18} color="#FF80AB" />
                    )}
                  </View>
                  <View style={{ marginLeft: rs(10), flex: 1 }}>
                    <Text style={styles.bookingTitle}>{job.family}</Text>
                    <Text style={styles.bookingSub}>{job.schedule || "Flexible"}</Text>
                    <Text style={styles.lightText}>{job.summary || "Childcare shift"}</Text>
                    <Text style={styles.lightText}>{job.location || ""}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>

        </ScrollView>

        <RateEditModal
          visible={showRateModal}
          value={rateInput}
          onChange={setRateInput}
          onClose={() => {
            if (requireHourlyRate) return;
            setShowRateModal(false);
          }}
          onSave={saveRate}
          saving={savingRate}
          required={requireHourlyRate}
        />

        {/* BOTTOM NAV BAR */}
        <NannyBottomNav
          active={activeTab}
          onPress={onTabPress}
          notificationCount={notificationCount}
          messageCount={messageCount}
        />
      </LinearGradient>
    </SafeScreen>
  );
}

/* -------------------- Small components -------------------- */

function RateCard({ title, value }: { title: string; value?: string }) {
  return (
    <LinearGradient colors={["#FFB6D5", "#FF80AB"]} style={styles.rateCard}>
      <Text style={styles.rateTitle}>{title}</Text>
      <Text style={styles.rateValue}>{value || "--"}</Text>
    </LinearGradient>
  );
}

function RateEditModal({
  visible,
  value,
  onChange,
  onClose,
  onSave,
  saving,
  required,
}: {
  visible: boolean;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  required?: boolean;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>
            {required ? "Add Your Hourly Rate" : "Update Hourly Rate"}
          </Text>
          <Text style={styles.modalSubtitle}>
            {required
              ? "Please add your hourly rate to continue using your dashboard."
              : "Enter your base hourly rate."}
          </Text>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="$24/hr"
            keyboardType="decimal-pad"
            style={styles.modalInput}
            autoFocus
          />
          <View style={styles.modalActions}>
            {!required ? (
              <TouchableOpacity style={styles.modalSecondary} onPress={onClose} disabled={saving}>
                <Text style={styles.modalSecondaryText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.modalPrimary, saving && { opacity: 0.7 }]}
              onPress={onSave}
              disabled={saving}
            >
              <Text style={styles.modalPrimaryText}>{saving ? "Saving..." : "Save"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* -------------------- Styles -------------------- */

const styles = StyleSheet.create({
  root: { flex: 1 },

  headerCard: {
    marginHorizontal: rs(14),
    marginBottom: rs(12),
    marginTop: rs(4),
    padding: rs(16),
    borderRadius: rs(20),
    backgroundColor: "#FFF1F6",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    flexDirection: "row",
    alignItems: "center",
  },
  headerCardCompact: {
    marginHorizontal: rs(10),
    marginBottom: rs(8),
    marginTop: rs(2),
    padding: rs(12),
    borderRadius: rs(16),
  },

  avatar: {
    width: wp(13),
    height: wp(13),
    borderRadius: rs(26),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: wp(3.5),
  },
  avatarCompact: {
    width: rs(40),
    height: rs(40),
    borderRadius: rs(20),
    marginRight: rs(10),
  },
  avatarImg: { width: wp(13), height: wp(13), borderRadius: rs(26) },
  avatarImgCompact: { width: rs(40), height: rs(40), borderRadius: rs(20) },

  hiText: { fontSize: rf(20), fontWeight: "700", color: "#880E4F" },
  hiTextCompact: { fontSize: rf(17) },
  dateText: { fontSize: rf(12), color: "#C26B8C", marginTop: hp(0.2) },

  pillsRow: { flexDirection: "row", gap: wp(2.5), marginTop: hp(1.2) },
  pillsRowCompact: { gap: rs(6), marginTop: rs(8) },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: wp(2.5),
    paddingVertical: hp(0.7),
    borderRadius: rs(12),
  },
  pillCompact: {
    paddingHorizontal: rs(8),
    paddingVertical: rs(4),
  },
  pillText: { marginLeft: wp(1.5), fontSize: rf(12), fontWeight: "700", color: "#880E4F" },

  row: { flexDirection: "row", gap: wp(3), paddingHorizontal: wp(3.5) },
  rowCompact: { gap: rs(8), paddingHorizontal: rs(10) },

  card: {
    flex: 1,
    backgroundColor: "#FFF1F6",
    borderRadius: rs(18),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  cardCompact: { borderRadius: rs(14), padding: rs(10) },

  cardTitle: { fontSize: rf(14), fontWeight: "700", color: "#880E4F" },

  availabilityRow: { flexDirection: "row", alignItems: "center", marginVertical: hp(1.2) },
  dot: { width: wp(2.5), height: wp(2.5), borderRadius: rs(5), marginRight: wp(1.5) },
  availabilityText: { fontWeight: "700", color: "#880E4F" },

  primaryBtn: {
    backgroundColor: "#FF80AB",
    paddingVertical: hp(1.2),
    borderRadius: rs(12),
    alignItems: "center",
  },
  primaryBtnSmall: {
    backgroundColor: "#FF80AB",
    paddingHorizontal: wp(3.5),
    paddingVertical: hp(1.2),
    borderRadius: rs(12),
    flexDirection: "row",
    gap: wp(1.5),
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: rf(13) },

  outlineBtn: {
    marginTop: hp(1.2),
    borderWidth: 1,
    borderColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: hp(1.2),
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: wp(1.5),
  },
  outlineBtnText: { color: "#C2185B", fontWeight: "700" },

  section: {
    backgroundColor: "#FFF1F6",
    marginHorizontal: rs(14),
    marginBottom: rs(12),
    padding: rs(14),
    borderRadius: rs(18),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  hourlyRateSection: {
    marginTop: rs(8),
  },
  nextBookingSection: {
    backgroundColor: "#FFF1F6",
  },
  upcomingSection: {
    backgroundColor: "#FFF1F6",
  },
  sectionCompact: {
    marginHorizontal: rs(10),
    marginBottom: rs(8),
    padding: rs(10),
    borderRadius: rs(14),
  },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: rf(15), fontWeight: "700", color: "#880E4F" },
  centeredSectionTitle: { textAlign: "center" },
  link: { fontSize: rf(12), fontWeight: "700", color: "#C2185B" },

  rateRow: { flexDirection: "row", gap: wp(2.5), marginTop: hp(1.4) },
  rateCard: { flex: 1, paddingVertical: hp(2.1), borderRadius: rs(16), alignItems: "center" },
  rateTitle: { color: "#fff", fontWeight: "700", fontSize: rf(12) },
  rateValue: { color: "#fff", fontSize: rf(20), fontWeight: "800", marginTop: hp(0.7) },

  weekPill: { backgroundColor: "#FFE7F0", paddingHorizontal: wp(2.5), paddingVertical: hp(0.7), borderRadius: rs(12) },
  weekPillText: { fontSize: rf(12), fontWeight: "700", color: "#C2185B" },

  chartWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginVertical: hp(2.3),
    gap: wp(2.5),
  },
  chartWrapperCompact: {
    marginVertical: rs(10),
    gap: rs(8),
  },
  chartBar: { alignItems: "center", flex: 1 },
  bar: {
    width: "100%",
    borderRadius: rs(16),
    alignItems: "center",
    justifyContent: "center",
    paddingTop: hp(0.95),
  },
  barTextWrap: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  barText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(11),
    width: "100%",
    textAlign: "center",
    includeFontPadding: false,
  },
  dayLabel: { fontSize: rf(11), color: "#6B4350", marginTop: hp(0.7) },

  earningsFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

  totalText: { fontSize: rf(18), fontWeight: "700", color: "#880E4F" },

  bookingCard: { flexDirection: "row", marginTop: hp(1.2) },
  hireRequestCard: {
    marginTop: hp(1.2),
    padding: rs(12),
    borderRadius: rs(16),
    backgroundColor: "#FFF4F8",
    borderWidth: 1,
    borderColor: "rgba(194,24,91,0.10)",
  },
  hireRequestHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: rs(10),
  },
  hireRequestTitle: {
    flex: 1,
    fontSize: rf(13),
    fontWeight: "700",
    color: "#880E4F",
  },
  hireRequestMeta: {
    marginTop: hp(0.45),
    fontSize: rf(12),
    fontWeight: "600",
    color: "#C2185B",
  },
  hireRequestStats: {
    marginTop: hp(0.55),
    fontSize: rf(11),
    color: "#8A5A67",
    fontWeight: "600",
  },
  hireRequestActions: {
    flexDirection: "row",
    gap: rs(10),
    marginTop: hp(1.1),
  },
  hireRequestBtn: {
    flex: 1,
    minHeight: rs(36),
    borderRadius: rs(12),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: rs(12),
  },
  hireRequestAcceptBtn: {
    backgroundColor: "#FFE2EC",
    borderWidth: 1,
    borderColor: "#F6A9C2",
  },
  hireRequestRejectBtn: {
    backgroundColor: "#FFF7E9",
    borderWidth: 1,
    borderColor: "#F1D193",
  },
  hireRequestBtnDisabled: {
    opacity: 0.65,
  },
  hireRequestBtnText: {
    fontSize: rf(12),
    fontWeight: "700",
  },
  hireRequestAcceptText: {
    color: "#C2185B",
  },
  hireRequestRejectText: {
    color: "#8B5E00",
  },
  hireRequestEmpty: {
    paddingTop: hp(0.8),
  },
  bookingAvatar: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFE7F0",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    overflow: "hidden",
  },
  bookingAvatarImg: {
    width: "100%",
    height: "100%",
  },
  bookingTitle: { fontSize: rf(14), fontWeight: "700", color: "#880E4F" },
  bookingSub: { fontSize: rf(12), color: "#AD1457" },

  lightText: { fontSize: rf(12), color: "#6B4350", marginTop: hp(0.45) },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: rs(16),
  },
  modalCard: {
    width: "100%",
    maxWidth: wp(92),
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(18),
  },
  modalTitle: { fontSize: rf(18), fontWeight: "700", color: "#880E4F" },
  modalSubtitle: { marginTop: hp(0.7), fontSize: rf(13), color: "#6B4350" },
  modalInput: {
    marginTop: hp(1.6),
    borderWidth: 1,
    borderColor: "#FF80AB",
    borderRadius: rs(12),
    padding: rs(12),
    color: "#880E4F",
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: hp(1.9), gap: wp(2.5) },
  modalPrimary: {
    backgroundColor: "#FF80AB",
    paddingHorizontal: wp(4),
    paddingVertical: hp(1.4),
    borderRadius: rs(12),
  },
  modalPrimaryText: { color: "#fff", fontWeight: "700" },
  modalSecondary: {
    paddingHorizontal: wp(3),
    paddingVertical: hp(1.4),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB",
  },
  modalSecondaryText: { color: "#C2185B", fontWeight: "700" },
});
