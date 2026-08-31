import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { rf, rs } from "../utils/responsive";
import {
  apiRequest,
  deleteJob as deleteJobApi,
  getRuntimeApiKey,
  isVerificationRequiredApiError,
  sanitizeToken,
} from "../Api";
import SafeScreen from "../components/SafeScreen";
import {
  fetchAllParentRequestNotifications,
  isParentInitiatedHireRequestNotification,
  type ParentRequestNotification,
} from "../../lib/parentRequestNotifications";
import { subscribeToNotifications } from "../../lib/pusherClient";

type Props = {
  navigation?: any;
  onBack?: () => void;
  onOpenBooking?: (event: any, date: string) => void;
  onRequireVerification?: () => void;
};

type JobStatusItem = {
  id: string;
  numericId: number;
  statusRaw: string;
  statusLabel: string;
  dateLabel: string;
  dateKey: string;
  timeLabel: string;
  childLabel: string;
  nannyLabel: string;
  locationLabel: string;
  hoursLabel: string;
  rateLabel: string;
  totalLabel: string;
  sortTime: number;
  applicants: JobApplicant[];
  raw: any;
};

type JobApplicant = {
  id: string;
  name: string;
  statusRaw: string;
  statusLabel: string;
  appliedAt?: string;
};

const HIDDEN_JOB_STATUS_IDS_KEY = "job_status_hidden_ids";

const parseNumber = (value?: string | number | null) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
};

const formatMoney = (value?: string | number | null) => {
  const parsed = parseNumber(value);
  if (parsed === null) return "";
  return `$${parsed.toFixed(2)}`;
};

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateLabel = (value: any) => {
  if (!value) return "Date TBD";
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const local = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return local.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatDateSort = (value: any) => {
  if (!value) return 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  return parsed.getTime();
};

const formatTimeValue = (value: any) => {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "time tbd") return "Time TBD";
  const hhmm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hhmm) {
    let hour = Number(hhmm[1]);
    const minute = hhmm[2];
    if (Number.isNaN(hour) || hour < 0 || hour > 23) return raw;
    const suffix = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;
    return `${hour}:${minute} ${suffix}`;
  }
  const meridiem = raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))$/);
  if (meridiem) {
    const hour = Number(meridiem[1]);
    const minute = meridiem[2];
    const suffix = String(meridiem[3] || "").toUpperCase();
    if (Number.isNaN(hour) || hour < 1 || hour > 12) return raw;
    return `${hour}:${minute} ${suffix}`;
  }
  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) {
    return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return raw;
};

const toStatusLabel = (status: string) => {
  const normalized = String(status || "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!normalized) return "Pending";
  if (normalized.toLowerCase() === "decision pending") return "Decision Pending";
  return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
};

const STATUS_MAP = {
  accepted: { bg: "#E8F5E9", border: "#A5D6A7", text: "#1B5E20" },
  completed: { bg: "#E3F2FD", border: "#90CAF9", text: "#0D47A1" },
  rejected: { bg: "#FCE4EC", border: "#F8BBD0", text: "#AD1457" },
  canceled: { bg: "#FFEBEE", border: "#FFCDD2", text: "#B71C1C" },
  pending: { bg: "#FFF8E1", border: "#FFE082", text: "#8B5E00" },
} as const;

const statusKey = (status: string) => {
  const raw = String(status || "").toLowerCase();
  if (raw.includes("cancel")) return "canceled";
  if (raw.includes("reject") || raw.includes("declin")) return "rejected";
  if (raw.includes("complete")) return "completed";
  if (raw.includes("accept") || raw.includes("approve") || raw.includes("confirm")) return "accepted";
  if (raw.includes("pending") || raw.includes("wait")) return "pending";
  return "pending";
};

const statusTone = (status: string) => {
  const key = statusKey(status);
  return STATUS_MAP[key] || STATUS_MAP.pending;
};

const canRemoveFromJobStatus = (status: string) => {
  const key = statusKey(status);
  return key === "pending" || key === "rejected" || key === "canceled";
};

const acceptedStatusTokens = new Set([
  "accepted",
  "accept",
  "approved",
  "confirm",
  "confirmed",
]);

const rejectedStatusTokens = new Set([
  "rejected",
  "reject",
  "declined",
  "decline",
]);

const canceledStatusTokens = new Set([
  "cancelled",
  "canceled",
  "cancel",
  "expired",
  "withdrawn",
]);

const completedStatusTokens = new Set([
  "completed",
  "complete",
  "done",
  "closed",
]);

const pendingDecisionTokens = new Set([
  "hire_requested",
  "hire-requested",
  "pending",
  "requested",
  "request_sent",
  "applied",
  "waiting",
]);

const normalizeStatusToken = (value: any) =>
  String(value || "")
    .toLowerCase()
    .trim();

const isHireRequestSource = (value: any) => {
  const normalized = normalizeStatusToken(value);
  return normalized === "hire_request" || normalized === "hire-request";
};

const extractKidNames = (job: any) => {
  const names: string[] = [];
  const csvNames = String(job?.kid_names || "").trim();
  if (csvNames) {
    csvNames
      .split(",")
      .map((name: string) => name.trim())
      .filter(Boolean)
      .forEach((name: string) => names.push(name));
  }
  const collect = (entry: any) => {
    const candidate = entry?.name || entry?.kid_name || entry?.child_name;
    if (candidate) names.push(String(candidate));
  };
  const kids = job?.kids || job?.children || job?.child || job?.kid || job?.kids_list;
  if (Array.isArray(kids)) {
    kids.forEach((entry) => collect(entry?.kids || entry?.kid || entry));
  } else if (kids) {
    collect(kids);
  }
  return names;
};

const toArray = (value: any) => (Array.isArray(value) ? value : value ? [value] : []);

const getDisplayName = (obj: any) => {
  if (!obj) return "";
  const direct =
    obj.fullname ||
    obj.name ||
    obj.full_name ||
    obj.display_name ||
    obj.nanny_name ||
    obj.sitter_name ||
    obj.user_name;
  if (direct) return String(direct).trim();
  return [obj.first_name, obj.last_name].filter(Boolean).join(" ").trim();
};

const buildApplicant = (input: any, fallbackStatus?: any): JobApplicant | null => {
  const person =
    input?.nanny ||
    input?.sitter ||
    input?.user ||
    input?.applicant ||
    input?.profile ||
    input;
  const name =
    getDisplayName(person) ||
    String(
      input?.nanny_name ||
        input?.sitter_name ||
        input?.user_name ||
        input?.name ||
        ""
    ).trim();
  if (!name) return null;
  const genericNames = new Set(["syttr", "sitter", "nanny", "no syttr assigned yet"]);
  if (genericNames.has(name.toLowerCase())) return null;

  const statusRaw = String(
    input?.status ||
      input?.application_status ||
      input?.state ||
      fallbackStatus ||
      "pending"
  );
  const id = String(
    input?.id ||
      input?.application_id ||
      input?.job_application_id ||
      input?.nanny_id ||
      input?.sitter_id ||
      input?.user_id ||
      name
  ).trim();
  const appliedAtRaw = input?.created_at || input?.applied_at || input?.time;

  return {
    id: id || name,
    name,
    statusRaw,
    statusLabel: toStatusLabel(statusRaw),
    appliedAt: appliedAtRaw ? String(appliedAtRaw) : undefined,
  };
};

const dedupeApplicants = (items: JobApplicant[]) => {
  const byKey = new Map<string, JobApplicant>();
  const seenIds = new Set<string>();
  items.forEach((item) => {
    if (!item?.name) return;
    const normalizedId = String(item.id || "").toLowerCase();
    if (normalizedId && seenIds.has(normalizedId)) return;
    const key = `${String(item.id || "").toLowerCase()}::${item.name.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      if (normalizedId) seenIds.add(normalizedId);
      return;
    }
    if (!existing.appliedAt && item.appliedAt) {
      byKey.set(key, item);
    }
  });
  return Array.from(byKey.values()).sort((a, b) => {
    const at = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
    const bt = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name);
  });
};

const filterApplicantsForCard = (items: JobApplicant[]) => {
  const applicants = dedupeApplicants(items || []);
  const acceptedApplicants = applicants.filter((item) =>
    acceptedStatusTokens.has(normalizeStatusToken(item?.statusRaw))
  );
  if (acceptedApplicants.length > 0) {
    return acceptedApplicants;
  }

  return applicants.filter((item) =>
    pendingDecisionTokens.has(normalizeStatusToken(item?.statusRaw))
  );
};

const deriveHireRequestDisplayStatus = (job: any) => {
  const explicit = String(job?.parent_display_status || job?.display_status || "").trim();
  if (explicit) return explicit;

  const rawJobStatus = normalizeStatusToken(
    job?.status ||
      job?.job_status ||
      job?.booking_status ||
      job?.application_statuses ||
      job?.application_status ||
      job?.application?.status
  );

  const applicationEntries = [
    ...toArray(job?.applications),
    ...toArray(job?.application),
    ...toArray(job?.job_applications),
  ];

  const hasHireRequest =
    isHireRequestSource(job?.request_source) ||
    applicationEntries.some(
      (entry) =>
        isHireRequestSource(entry?.request_source) ||
        ["hire_requested", "hire-requested"].includes(normalizeStatusToken(entry?.status))
    );

  if (!hasHireRequest) {
    return rawJobStatus || "pending";
  }

  if (completedStatusTokens.has(rawJobStatus)) return rawJobStatus;
  if (canceledStatusTokens.has(rawJobStatus)) return rawJobStatus;
  if (acceptedStatusTokens.has(rawJobStatus)) return "accepted";

  const applicationStatuses = applicationEntries
    .map((entry: any) => normalizeStatusToken(entry?.status || entry?.application_status))
    .filter(Boolean);

  const applicantStatuses = dedupeApplicants(extractApplicantsFromJob(job))
    .map((entry) => normalizeStatusToken(entry?.statusRaw))
    .filter(Boolean);

  const combinedStatuses = [...applicationStatuses, ...applicantStatuses];

  if (combinedStatuses.some((status) => completedStatusTokens.has(status))) {
    return "completed";
  }
  if (combinedStatuses.some((status) => canceledStatusTokens.has(status))) {
    return "canceled";
  }
  if (combinedStatuses.some((status) => acceptedStatusTokens.has(status))) {
    return "accepted";
  }
  if (combinedStatuses.some((status) => rejectedStatusTokens.has(status))) {
    return "rejected";
  }
  if (combinedStatuses.some((status) => pendingDecisionTokens.has(status))) {
    return "decision_pending";
  }

  return "decision_pending";
};

const resolveDeleteJobId = (item: JobStatusItem) => {
  const raw = item?.raw || {};
  const candidates = [
    raw?.job_id,
    raw?.job?.id,
    raw?.job?.job_id,
    raw?.id,
    raw?.booking_id,
    raw?.meta?.job_id,
    item?.id,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (!value) continue;
    if (/^\d+$/.test(value)) return value;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return String(Math.trunc(numeric));
  }
  return "";
};

const extractApplicantsFromJob = (job: any) => {
  const nannyEntries = toArray(job?.nannies).map((n: any) =>
    buildApplicant(
      {
        ...n,
        id: n?.nanny_id || n?.id,
        nanny_id: n?.nanny_id || n?.id,
        nanny_name: n?.fullname || n?.name,
        status: n?.status || job?.application_statuses || job?.application_status,
      },
      n?.status || job?.application_statuses || job?.application_status
    )
  );

  const appEntries = [
    ...nannyEntries,
    ...toArray(job?.applications),
    ...toArray(job?.application),
    ...toArray(job?.applicants),
    ...toArray(job?.job_applications),
  ];

  const applicants = appEntries
    .map((entry: any) => buildApplicant(entry, job?.application_status))
    .filter(Boolean) as JobApplicant[];

  if (applicants.length === 0) {
    const assigned = buildApplicant(
      {
        nanny: job?.nanny || job?.sitter || job?.assigned_nanny,
        nanny_name: job?.nanny_name || job?.sitter_name,
        nanny_id: job?.nanny_id || job?.sitter_id,
      },
      job?.application_status || job?.status
    );
    if (assigned) applicants.push(assigned);
  }

  return dedupeApplicants(applicants);
};

const extractNotificationJobId = (entry: any) => {
  const data = entry?.data || entry?.notification || entry;
  const job = data?.job || entry?.job || data?.payload?.job;
  const application =
    data?.application ||
    entry?.application ||
    data?.job_application ||
    entry?.job_application;

  return String(
    job?.id ||
      job?.job_id ||
      job?.booking_id ||
      data?.job_id ||
      entry?.job_id ||
      data?.booking_id ||
      entry?.booking_id ||
      application?.job_id ||
      ""
  ).trim();
};

const extractApplicantFromNotification = (entry: any) => {
  const data = entry?.data || entry?.notification || entry;
  const application =
    data?.application ||
    entry?.application ||
    data?.job_application ||
    entry?.job_application ||
    null;
  const nanny =
    data?.nanny ||
    entry?.nanny ||
    application?.nanny ||
    application?.sitter ||
    application?.user ||
    null;
  const source = application || nanny || data || entry;

  return buildApplicant(
    {
      ...source,
      application_status:
        application?.status ||
        source?.application_status ||
        data?.application_status ||
        entry?.application_status,
    },
    data?.status || entry?.status
  );
};

const buildApplicantsByJobFromNotifications = (notifications: any[]) => {
  const grouped: Record<string, JobApplicant[]> = {};
  notifications.forEach((entry) => {
    const jobId = extractNotificationJobId(entry);
    if (!jobId) return;
    const applicant = extractApplicantFromNotification(entry);
    if (!applicant) return;
    if (!grouped[jobId]) grouped[jobId] = [];
    grouped[jobId].push(applicant);
  });

  Object.keys(grouped).forEach((jobId) => {
    grouped[jobId] = dedupeApplicants(grouped[jobId]);
  });

  return grouped;
};

const buildHireRequestStatusItem = (
  item: ParentRequestNotification,
  applicantsByJob: Record<string, JobApplicant[]>
): JobStatusItem | null => {
  const job = item?.job || {};
  const application = item?.application || {};
  const nanny = item?.nanny || {};
  const jobIdRaw = String(item?.job_id || job?.id || job?.job_id || "").trim();
  const applicationIdRaw = String(
    item?.application_id || application?.id || application?.application_id || ""
  ).trim();
  const requestKeyRaw = String(item?.request_key || "").trim();
  const notificationIdRaw = String(item?.id || item?.notification_id || "").trim();
  const baseId = jobIdRaw || applicationIdRaw || item?.request_key || "";
  if (!baseId) return null;

  const id = jobIdRaw
    ? `hire-job-${jobIdRaw}-${applicationIdRaw || requestKeyRaw || notificationIdRaw || baseId}`
    : `hire-request-${applicationIdRaw || requestKeyRaw || notificationIdRaw || baseId}`;
  const numericId = Number.parseInt(jobIdRaw || applicationIdRaw, 10);
  const statusRaw = String(
    item?.status ||
      item?.application_status ||
      application?.status ||
      job?.status ||
      "hire_requested"
  ).trim();
  const normalizedStatus = deriveHireRequestDisplayStatus({
    ...job,
    ...application,
    status: statusRaw,
    application_status: item?.application_status || application?.status,
    request_source:
      item?.request_source || application?.request_source || job?.request_source || "hire_request",
    application: application ? [application] : [],
    applications: application ? [application] : [],
  });
  const dateValue = job?.start_date || job?.date || item?.created_at || item?.time;
  const dateLabel = formatDateLabel(dateValue);
  const dateKey = dateValue && !Number.isNaN(new Date(dateValue).getTime())
    ? formatDateKey(new Date(dateValue))
    : String(dateValue || "");
  const startTimeLabel = formatTimeValue(job?.start_time || job?.time || "");
  const endTimeLabel = formatTimeValue(job?.end_time || job?.end || job?.finish_time || "");
  const timeLabel =
    startTimeLabel && endTimeLabel && endTimeLabel !== "Time TBD"
      ? `${startTimeLabel} - ${endTimeLabel}`
      : startTimeLabel || "Time TBD";
  const childLabel =
    (Array.isArray(item?.kid_names) ? item.kid_names.join(", ") : "") ||
    extractKidNames(job).join(", ") ||
    "Child";
  const nannyLabel =
    String(
      item?.nanny_name ||
        nanny?.fullname ||
        nanny?.name ||
        job?.nanny_name ||
        job?.sitter_name ||
        "Syttr"
    ).trim() || "Syttr";
  const locationLabel = String(item?.location || job?.location || job?.address || "Location TBD");
  const applicants = filterApplicantsForCard([
    ...extractApplicantsFromJob({
      ...job,
      application,
      applications: application ? [application] : [],
      nanny,
      nanny_name: nannyLabel,
    }),
    ...(jobIdRaw ? applicantsByJob[jobIdRaw] || [] : []),
  ]);

  const hoursNum = parseNumber(job?.hours ?? item?.meta?.hours);
  const directRateNum = parseNumber(
    job?.hourly_rate ??
      item?.meta?.hourly_rate ??
      item?.meta?.rate ??
      item?.meta?.pay_rate ??
      nanny?.hourly_rate
  );
  const parsedTotalNum = parseNumber(
    job?.price ??
      item?.meta?.pay ??
      item?.meta?.price
  );
  const inferredRateNum =
    directRateNum ??
    (hoursNum !== null && hoursNum > 0 && parsedTotalNum !== null ? parsedTotalNum / hoursNum : null);
  const totalNum =
    parsedTotalNum ??
    (hoursNum !== null && inferredRateNum !== null ? hoursNum * inferredRateNum : null);

  return {
    id,
    numericId: Number.isFinite(numericId) ? numericId : 0,
    statusRaw: normalizedStatus,
    statusLabel: toStatusLabel(normalizedStatus),
    dateLabel,
    dateKey,
    timeLabel,
    childLabel,
    nannyLabel,
    locationLabel,
    hoursLabel: hoursNum !== null ? String(hoursNum) : "Hours TBD",
    rateLabel: inferredRateNum !== null ? `${formatMoney(inferredRateNum)}/hr` : "",
    totalLabel: totalNum !== null ? formatMoney(totalNum) : "Total TBD",
    sortTime:
      formatDateSort(`${job?.start_date || ""} ${job?.start_time || ""}`) ||
      formatDateSort(dateValue),
    applicants,
    raw: {
      ...item,
      source: "parent_hire_request",
      job,
      application,
      nanny,
      job_id: jobIdRaw || item?.job_id,
      application_id: applicationIdRaw || item?.application_id,
    },
  };
};

export default function JobStatusScreen({ navigation, onBack, onOpenBooking, onRequireVerification }: Props) {
  const [jobs, setJobs] = useState<JobStatusItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [activeSummaryFilter, setActiveSummaryFilter] = useState<
    "total" | "pending" | "accepted" | "completed" | "rejected" | "canceled"
  >("total");

  const summary = useMemo(() => {
    const next = {
      total: jobs.length,
      pending: 0,
      accepted: 0,
      completed: 0,
      rejected: 0,
      canceled: 0,
    };
    jobs.forEach((item) => {
      const key = statusKey(item.statusRaw);
      if (key === "accepted") next.accepted += 1;
      else if (key === "completed") next.completed += 1;
      else if (key === "rejected") next.rejected += 1;
      else if (key === "canceled") next.canceled += 1;
      else next.pending += 1;
    });
    return next;
  }, [jobs]);

  const visibleJobs = useMemo(() => {
    if (activeSummaryFilter === "total") return jobs;
    return jobs.filter((job) => statusKey(job.statusRaw) === activeSummaryFilter);
  }, [activeSummaryFilter, jobs]);

  const deleteJobFromStatus = useCallback(async (job: JobStatusItem) => {
    const jobId = resolveDeleteJobId(job);
    if (!jobId) {
      Alert.alert("Delete job", "Job ID is missing.");
      return;
    }
    try {
      const [tokenRaw, accessTokenRaw, nannyTokenRaw, userId, storedApiKey] = await Promise.all([
        AppStorage.getItem("token"),
        AppStorage.getItem("access_token"),
        AppStorage.getItem("nanny_token"),
        AppStorage.getItem("user_id"),
        AppStorage.getItem("api_key"),
      ]);
      if (!userId) {
        Alert.alert("Delete job", "User ID missing. Please login again.");
        return;
      }
      const token = sanitizeToken(tokenRaw || accessTokenRaw || nannyTokenRaw || undefined);

      setDeletingJobId(job.id);
      await deleteJobApi(jobId, userId, token || undefined, storedApiKey || undefined);
      setJobs((prev) => prev.filter((entry) => entry.id !== job.id));
      Alert.alert("Deleted", "Job deleted successfully.");
    } catch (e: any) {
      if (isVerificationRequiredApiError(e)) {
        onRequireVerification?.();
        return;
      }
      Alert.alert("Delete failed", e?.message || "Unable to delete this job right now.");
    } finally {
      setDeletingJobId("");
    }
  }, [onRequireVerification]);

  const confirmRemoveJob = useCallback(
    (job: JobStatusItem) => {
      if (!canRemoveFromJobStatus(job.statusRaw)) return;
      const title = "Delete job";
      const message =
        "Delete this job and all related applications/notifications?";
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        const ok = window.confirm(message);
        if (ok) void deleteJobFromStatus(job);
        return;
      }
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void deleteJobFromStatus(job),
        },
      ]);
    },
    [deleteJobFromStatus]
  );

  const loadJobs = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMessage("");

    try {
      const [tokenRaw, nannyTokenRaw, accessTokenRaw, userId, legacyId] = await Promise.all([
        AppStorage.getItem("token"),
        AppStorage.getItem("nanny_token"),
        AppStorage.getItem("access_token"),
        AppStorage.getItem("user_id"),
        AppStorage.getItem("id"),
      ]);
      const effectiveUserId = userId || legacyId;
      if (!effectiveUserId) {
        setJobs([]);
        setErrorMessage("Missing user ID.");
        return;
      }

      const tokenCandidate = tokenRaw || accessTokenRaw || nannyTokenRaw || "";
      const token = sanitizeToken(tokenCandidate || undefined);
      const apiKey =
        String((await AppStorage.getItem("api_key")) || "").trim() ||
        getRuntimeApiKey() ||
        "";
      const headers = {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(token ? { "x-access-token": token } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      };

      let json: any;
      try {
        json = await apiRequest<any>("job/parent", {
          method: "POST",
          headers,
          body: JSON.stringify({ user_id: effectiveUserId, per_page: 10 }),
        });
      } catch (error: any) {
        if (isVerificationRequiredApiError(error)) {
          throw error;
        }
        json = await apiRequest<any>(`job/index?user_id=${encodeURIComponent(effectiveUserId)}`, {
          method: "GET",
          headers,
        });
      }

      let applicantsByJob: Record<string, JobApplicant[]> = {};
      try {
        const notificationsJson = await apiRequest<any>(
          `notifications?user_id=${encodeURIComponent(effectiveUserId)}`,
          {
            method: "GET",
            headers,
          }
        );
        const notificationsRaw = Array.isArray(notificationsJson)
          ? notificationsJson
          : Array.isArray(notificationsJson?.data)
          ? notificationsJson.data
          : [];
        applicantsByJob = buildApplicantsByJobFromNotifications(notificationsRaw);
      } catch {
        applicantsByJob = {};
      }

      let hireRequestItems: ParentRequestNotification[] = [];
      try {
        const requestRows = await fetchAllParentRequestNotifications();
        hireRequestItems = requestRows.filter((item) => isParentInitiatedHireRequestNotification(item));
      } catch {
        hireRequestItems = [];
      }

      const rawJobs = Array.isArray(json)
        ? json
        : Array.isArray(json?.data?.jobs)
        ? json.data.jobs
        : Array.isArray(json?.data?.data)
        ? json.data.data
        : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.jobs)
        ? json.jobs
        : [];

      const [storedCanceled, storedHiddenJobIds] = await Promise.all([
        AppStorage.getItem("canceled_job_ids"),
        AppStorage.getItem(HIDDEN_JOB_STATUS_IDS_KEY),
      ]);
      let canceledParsed: any[] = [];
      let hiddenParsed: any[] = [];
      try {
        const rawCanceled = storedCanceled ? JSON.parse(storedCanceled) : [];
        canceledParsed = Array.isArray(rawCanceled) ? rawCanceled : [];
      } catch {
        canceledParsed = [];
      }
      try {
        const rawHidden = storedHiddenJobIds ? JSON.parse(storedHiddenJobIds) : [];
        hiddenParsed = Array.isArray(rawHidden) ? rawHidden : [];
      } catch {
        hiddenParsed = [];
      }
      const canceledIds = new Set(canceledParsed.map((id: any) => String(id)));
      const hiddenIds = new Set(hiddenParsed.map((id: any) => String(id)));

      const mappedJobs: JobStatusItem[] = rawJobs
        .map((job: any) => {
          const jobIdRaw = String(job?.id || job?.job_id || job?.booking_id || "").trim();
          const id = jobIdRaw || `job-${Math.random().toString(36).slice(2, 9)}`;
          const numericId = Number.parseInt(jobIdRaw, 10);
          const localCanceled = canceledIds.has(id);
          const derivedStatusRaw = deriveHireRequestDisplayStatus(job);
          const statusRaw = localCanceled
            ? "canceled"
            : String(derivedStatusRaw || "pending");
          const statusLabel = toStatusLabel(statusRaw);

          const dateValue = job?.start_date || job?.date || job?.created_at || job?.updated_at;
          const dateLabel = formatDateLabel(dateValue);
          let dateKey = "";
          if (dateValue) {
            if (typeof dateValue === "string") {
              const trimmed = dateValue.trim();
              const match = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
              if (match) {
                dateKey = formatDateKey(
                  new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
                );
              } else if (!Number.isNaN(new Date(trimmed).getTime())) {
                dateKey = formatDateKey(new Date(trimmed));
              } else {
                dateKey = String(dateValue);
              }
            } else if (!Number.isNaN(new Date(dateValue).getTime())) {
              dateKey = formatDateKey(new Date(dateValue));
            } else {
              dateKey = String(dateValue);
            }
          }
          const startTimeLabel = formatTimeValue(job?.start_time || job?.time || "");
          const endTimeLabel = formatTimeValue(job?.end_time || job?.end || job?.finish_time || "");
          const timeLabel =
            startTimeLabel && endTimeLabel && endTimeLabel !== "Time TBD"
              ? `${startTimeLabel} - ${endTimeLabel}`
              : startTimeLabel;

          const kidNames = extractKidNames(job);
          const childLabel = kidNames.join(", ") || "Child";
          const nannyNamesFromList = toArray(job?.nannies)
            .map((n: any) => String(n?.fullname || n?.name || "").trim())
            .filter(Boolean);
          const nannyLabel =
            nannyNamesFromList.join(", ") ||
            job?.nanny?.fullname ||
            job?.nanny?.name ||
            job?.sitter?.fullname ||
            job?.sitter?.name ||
            job?.syttr?.fullname ||
            job?.syttr?.name ||
            job?.nanny_name ||
            "Syttr";
          const locationLabel = String(job?.location || job?.address || "Location TBD");
  const applicants = filterApplicantsForCard([
            ...extractApplicantsFromJob(job),
            ...(jobIdRaw ? applicantsByJob[jobIdRaw] || [] : []),
          ]);

          const hoursNum = parseNumber(job?.hours);
          const rawRateCandidate =
            job?.hourly_rate ??
            job?.hourlyRate ??
            job?.rate ??
            job?.pay_rate ??
            job?.payRate ??
            job?.rate_per_hour ??
            job?.price_per_hour ??
            job?.amount_per_hour ??
            job?.meta?.hourly_rate ??
            job?.meta?.rate ??
            (typeof job?.meta?.pay === "string" && /hr/i.test(job.meta.pay)
              ? job.meta.pay
              : undefined);
          const directRateNum = parseNumber(rawRateCandidate);
          const parsedTotalNum = parseNumber(
            job?.price ??
              job?.total_price ??
              job?.total ??
              job?.total_amount ??
              job?.amount ??
              job?.grand_total ??
              job?.paid_amount
          );
          const inferredRateNum =
            directRateNum ??
            (hoursNum !== null && hoursNum > 0 && parsedTotalNum !== null
              ? parsedTotalNum / hoursNum
              : null);
          const totalNum =
            parsedTotalNum ??
            (hoursNum !== null && inferredRateNum !== null ? hoursNum * inferredRateNum : null);
          const hoursLabel = hoursNum !== null ? String(hoursNum) : "Hours TBD";
          const rateLabel = inferredRateNum !== null ? `${formatMoney(inferredRateNum)}/hr` : "";
          const totalLabel = totalNum !== null ? formatMoney(totalNum) : "Total TBD";

          const sortTime =
            formatDateSort(`${job?.start_date || ""} ${job?.start_time || ""}`) ||
            formatDateSort(job?.start_date || job?.date || job?.created_at || job?.updated_at);

          return {
            id,
            numericId: Number.isFinite(numericId) ? numericId : 0,
            statusRaw,
            statusLabel,
            dateLabel,
            dateKey,
            timeLabel,
            childLabel,
            nannyLabel,
            locationLabel,
            hoursLabel,
            rateLabel,
            totalLabel,
            sortTime,
            applicants,
            raw: job,
          };
        })
        .filter((job: JobStatusItem) => !hiddenIds.has(job.id));

      const existingJobKeys = new Set(
        mappedJobs.map((job) => String(job.raw?.id || job.raw?.job_id || job.id).trim()).filter(Boolean)
      );

      const mappedHireRequests = hireRequestItems
        .map((item) => buildHireRequestStatusItem(item, applicantsByJob))
        .filter(Boolean)
        .filter((item) => {
          const key = String(item?.raw?.job_id || item?.id || "").trim();
          return key ? !existingJobKeys.has(key) : true;
        }) as JobStatusItem[];

      const merged = [...mappedJobs, ...mappedHireRequests]
        .filter((job: JobStatusItem) => !hiddenIds.has(job.id))
        .sort((a: JobStatusItem, b: JobStatusItem) => {
          if (b.numericId !== a.numericId) return b.numericId - a.numericId;
          return b.sortTime - a.sortTime;
        });

      setJobs(merged);
    } catch (e: any) {
      if (isVerificationRequiredApiError(e)) {
        setErrorMessage("");
        setJobs([]);
        onRequireVerification?.();
        return;
      }
      setErrorMessage(e?.message || "Could not load job status.");
      setJobs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onRequireVerification]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    const unsubscribe = navigation?.addListener?.("focus", () => {
      void loadJobs(true);
    });
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [loadJobs, navigation]);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    void (async () => {
      const userId = String(
        (await AppStorage.getItem("user_id")) ||
          (await AppStorage.getItem("id")) ||
          ""
      ).trim();
      if (!active || !userId) return;

      const sub = subscribeToNotifications(userId, (payload) => {
        const type = String(payload?.type || payload?.data?.type || "")
          .trim()
          .toLowerCase();
        if (
          ![
            "extra_hours_request",
            "extra_hours_accepted",
            "extra_hours_rejected",
            "hire_request",
            "hire_accepted",
            "hire_rejected",
            "job_request",
            "job_application",
          ].includes(type)
        ) {
          return;
        }

        void loadJobs(true);
      });

      unsubscribe = sub.unsubscribe;
    })();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadJobs]);

  const openJobDetail = (job: JobStatusItem) => {
    if (!onOpenBooking) return;
    onOpenBooking(
      {
        id: job.id,
        bookingId: job.id,
        status: job.statusLabel,
        hours: job.hoursLabel,
        hoursLabel: job.hoursLabel,
        start: job.timeLabel,
        pay: job.totalLabel,
        sitter: job.nannyLabel,
        child: job.childLabel,
        location: job.locationLabel,
        raw: job.raw,
        source: "parentJobStatus",
      },
      job.dateKey || job.dateLabel
    );
  };

  return (
    <SafeScreen edges={["top", "left", "right"]} style={{ backgroundColor: "#FFFFFF" }}>
      <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={styles.root}>
        {/* HEADER */}
        <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              if (onBack) {
                onBack();
                return;
              }
              navigation?.goBack?.();
            }}
          >
            <Ionicons name="chevron-back" size={18} color="#C2185B" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Job Status</Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={() => void loadJobs(true)}>
            <Ionicons name="refresh" size={18} color="#C2185B" />
          </TouchableOpacity>
        </LinearGradient>

      {/* BODY */}
      <View style={styles.body}>
        {/* SUMMARY GRID - ALL 6 STATUSES VISIBLE */}
        <View style={styles.summaryGrid}>
          <SummaryCard 
            label="Total" 
            value={summary.total} 
            icon="briefcase-outline"
            gradientColors={["#FFFFFF", "#FFF5F9"]}
            textColor="#880E4F"
            active={activeSummaryFilter === "total"}
            onPress={() => setActiveSummaryFilter("total")}
          />
          <SummaryCard 
            label="Pending" 
            value={summary.pending} 
            icon="time-outline"
            gradientColors={["#FFF8E1", "#FFE082"]}
            textColor="#8B5E00"
            active={activeSummaryFilter === "pending"}
            onPress={() => setActiveSummaryFilter("pending")}
          />
          <SummaryCard 
            label="Accepted" 
            value={summary.accepted} 
            icon="checkmark-circle-outline"
            gradientColors={["#E8F5E9", "#A5D6A7"]}
            textColor="#1B5E20"
            active={activeSummaryFilter === "accepted"}
            onPress={() => setActiveSummaryFilter("accepted")}
          />
          <SummaryCard 
            label="Completed" 
            value={summary.completed} 
            icon="checkmark-done-outline"
            gradientColors={["#E3F2FD", "#90CAF9"]}
            textColor="#0D47A1"
            active={activeSummaryFilter === "completed"}
            onPress={() => setActiveSummaryFilter("completed")}
          />
          <SummaryCard 
            label="Rejected" 
            value={summary.rejected} 
            icon="close-circle-outline"
            gradientColors={["#FCE4EC", "#F8BBD0"]}
            textColor="#AD1457"
            active={activeSummaryFilter === "rejected"}
            onPress={() => setActiveSummaryFilter("rejected")}
          />
          <SummaryCard 
            label="Canceled" 
            value={summary.canceled} 
            icon="ban-outline"
            gradientColors={["#FFEBEE", "#FFCDD2"]}
            textColor="#B71C1C"
            active={activeSummaryFilter === "canceled"}
            onPress={() => setActiveSummaryFilter("canceled")}
          />
        </View>

        {/* JOBS LIST */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadJobs(true)}
              tintColor="#FF80AB"
              colors={["#FF80AB"]}
            />
          }
        >
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color="#FF80AB" size="large" />
              <Text style={styles.loadingText}>Loading job statuses...</Text>
            </View>
          ) : visibleJobs.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="briefcase-outline" size={48} color="#FF80AB" />
              <Text style={styles.emptyTitle}>No jobs found</Text>
              <Text style={styles.emptySub}>
                {errorMessage ||
                  (activeSummaryFilter === "total"
                    ? "Posted jobs and booking statuses will appear here."
                    : `No ${activeSummaryFilter} jobs right now.`)}
              </Text>
            </View>
          ) : (
            visibleJobs.map((job, idx) => {
              const tone = statusTone(job.statusRaw);
              return (
                <TouchableOpacity
                  key={`job-${job.id}-${job.dateKey || job.sortTime || idx}`}
                  style={styles.jobCard}
                  activeOpacity={0.85}
                  onPress={() => openJobDetail(job)}
                  disabled={!onOpenBooking}
                >
                  <View style={styles.jobTop}>
                    <Text style={styles.jobId}>Booking #{job.id.slice(0, 8)}</Text>
                    <View style={styles.jobTopRight}>
                      {canRemoveFromJobStatus(job.statusRaw) ? (
                        <TouchableOpacity
                          style={[
                            styles.removeBtn,
                            deletingJobId === job.id && { opacity: 0.5 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="Delete job"
                          disabled={deletingJobId === job.id}
                          onPress={(event: any) => {
                            event?.stopPropagation?.();
                            confirmRemoveJob(job);
                          }}
                        >
                          <Ionicons name="trash-outline" size={14} color="#C62828" />
                        </TouchableOpacity>
                      ) : null}
                      <View
                        style={[
                          styles.statusPill,
                          { backgroundColor: tone.bg, borderColor: tone.border },
                        ]}
                      >
                        <Text style={[styles.statusText, { color: tone.text }]}>
                          {job.statusLabel}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.infoRow}>
                    <Ionicons name="calendar-outline" size={14} color="#C2185B" />
                    <Text style={styles.infoText}>{job.dateLabel}</Text>
                  </View>
                  
                  <View style={styles.infoRow}>
                    <Ionicons name="time-outline" size={14} color="#C2185B" />
                    <Text style={styles.infoText}>{job.timeLabel}</Text>
                  </View>
                  
                  <View style={styles.infoRow}>
                    <Ionicons name="person-outline" size={14} color="#C2185B" />
                    <Text style={styles.infoText}>{job.childLabel}</Text>
                  </View>
                  
                  <View style={styles.infoRow}>
                    <Ionicons name="star-outline" size={14} color="#C2185B" />
                    <Text style={styles.infoText}>{job.nannyLabel}</Text>
                  </View>
                  
                  <View style={styles.infoRow}>
                    <Ionicons name="location-outline" size={14} color="#C2185B" />
                    <Text style={styles.infoText}>{job.locationLabel}</Text>
                  </View>

                  {job.applicants.length > 0 && (
                    <View style={styles.applicantsBlock}>
                      <View style={styles.applicantsHeaderRow}>
                        <Ionicons name="people-outline" size={14} color="#C2185B" />
                        <Text style={styles.applicantsTitle}>
                          Applicants ({job.applicants.length})
                        </Text>
                      </View>
                      {job.applicants.slice(0, 2).map((applicant) => (
                        <Text
                          key={`${job.id}-${applicant.id}-${applicant.name}`}
                          style={styles.applicantLine}
                        >
                          - {applicant.name}
                          {applicant.statusLabel ? ` (${applicant.statusLabel})` : ""}
                        </Text>
                      ))}
                      {job.applicants.length > 2 && (
                        <Text style={styles.applicantMore}>
                          +{job.applicants.length - 2} more
                        </Text>
                      )}
                    </View>
                  )}

                  <View style={styles.metaRow}>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Hours</Text>
                      <Text style={styles.metaValue}>{job.hoursLabel}</Text>
                    </View>
                    <View style={styles.metaDivider} />
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Rate</Text>
                      <Text style={styles.metaValue}>{job.rateLabel || "--"}</Text>
                    </View>
                    <View style={styles.metaDivider} />
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Total</Text>
                      <Text style={styles.metaValue}>{job.totalLabel}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>
      </LinearGradient>
    </SafeScreen>
  );
}

function SummaryCard({ 
  label, 
  value, 
  icon,
  gradientColors,
  textColor = "#880E4F",
  active = false,
  onPress,
}: { 
  label: string; 
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  gradientColors: readonly [string, string, ...string[]];
  textColor?: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[styles.summaryCardTouch, active && styles.summaryCardTouchActive]}
    >
      <LinearGradient
        colors={gradientColors}
        style={styles.summaryCard}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Ionicons name={icon} size={20} color={textColor} />
        <Text style={[styles.summaryValue, { color: textColor }]}>{value}</Text>
        <Text style={[styles.summaryLabel, { color: textColor }]}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    height: rs(64),
    paddingHorizontal: rs(16),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: rs(1),
    paddingBottom: rs(14),
    borderBottomLeftRadius: rs(18),
    borderBottomRightRadius: rs(18),
    backgroundColor: "rgba(255,255,255,0.9)",
    elevation: 2,
  },

  backBtn: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(21),
    backgroundColor: "#FFE89A",
    alignItems: "center",
    justifyContent: "center",
  },

  refreshBtn: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(21),
    backgroundColor: "#FFE89A",
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: {
    color: "#C77A00",
    fontSize: rf(18),
    fontWeight: "700",
    fontFamily: "PlayfairDisplay",
  },

  body: {
    flex: 1,
    paddingHorizontal: rs(12),
    paddingTop: rs(12),
  },

  // Grid layout for summary cards - 3 per row
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: rs(8),
    marginBottom: rs(16),
    justifyContent: "space-between",
  },

  summaryCardTouch: {
    width: "31.5%",
    borderRadius: rs(14),
    marginBottom: rs(0),
    minWidth: rs(96),
  },
  summaryCardTouchActive: {
    borderWidth: 2,
    borderColor: "#C2185B",
  },

  summaryCard: {
    width: "100%",
    borderRadius: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    minHeight: rs(86),
    paddingVertical: rs(10),
    paddingHorizontal: rs(8),
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "rgba(0,0,0,0.04)",
    shadowOpacity: 1,
    shadowOffset: { width: rs(0), height: rs(2) },
    shadowRadius: 4,
    elevation: 2,
    gap: rs(4),
  },

  summaryValue: {
    fontSize: rf(17),
    fontWeight: "800",
    marginTop: rs(2),
  },

  summaryLabel: {
    fontSize: rf(10),
    lineHeight: rs(12),
    fontWeight: "600",
    textAlign: "center",
  },

  scroll: { flex: 1 },

  content: { paddingBottom: rs(28) },

  loadingWrap: {
    marginTop: rs(40),
    alignItems: "center",
    justifyContent: "center",
    gap: rs(12),
  },

  loadingText: {
    fontSize: rf(13),
    color: "#C2185B",
    fontWeight: "600",
  },

  emptyCard: {
    marginTop: rs(40),
    padding: rs(24),
    borderRadius: rs(18),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.25)",
    backgroundColor: "#FFF",
    alignItems: "center",
    gap: rs(12),
  },

  emptyTitle: {
    fontSize: rf(16),
    color: "#880E4F",
    fontWeight: "700",
  },

  emptySub: {
    fontSize: rf(13),
    color: "#AD1457",
    textAlign: "center",
  },

  jobCard: {
    backgroundColor: "#FFF",
    borderRadius: rs(18),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    padding: rs(16),
    marginBottom: rs(12),
    shadowColor: "rgba(0,0,0,0.04)",
    shadowOpacity: 1,
    shadowOffset: { width: rs(0), height: rs(2) },
    shadowRadius: 6,
    elevation: 2,
  },

  jobTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: rs(12),
    gap: rs(8),
  },

  jobTopRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
  },

  removeBtn: {
    width: rs(28),
    height: rs(28),
    borderRadius: rs(14),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(198,40,40,0.2)",
    backgroundColor: "#FFF5F5",
  },

  jobId: {
    fontSize: rf(14),
    color: "#880E4F",
    fontWeight: "700",
    flex: 1,
  },

  statusPill: {
    borderWidth: 1,
    paddingHorizontal: rs(10),
    paddingVertical: rs(4),
    borderRadius: rs(20),
  },

  statusText: {
    fontSize: rf(11),
    fontWeight: "800",
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    marginTop: rs(6),
  },

  infoText: {
    color: "#AD1457",
    fontSize: rf(13),
    flex: 1,
  },

  applicantsBlock: {
    marginTop: rs(12),
    paddingTop: rs(12),
    borderTopWidth: 1,
    borderTopColor: "rgba(255,128,171,0.2)",
    gap: rs(6),
  },

  applicantsHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    marginBottom: rs(4),
  },

  applicantsTitle: {
    color: "#880E4F",
    fontSize: rf(12),
    fontWeight: "700",
  },

  applicantLine: {
    color: "#AD1457",
    fontSize: rf(12),
    marginLeft: rs(22),
  },

  applicantMore: {
    color: "#C2185B",
    fontSize: rf(11),
    fontWeight: "700",
    marginLeft: rs(22),
  },

  metaRow: {
    marginTop: rs(16),
    paddingTop: rs(12),
    borderTopWidth: 1,
    borderTopColor: "rgba(255,128,171,0.2)",
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },

  metaItem: {
    alignItems: "center",
    flex: 1,
  },

  metaLabel: {
    color: "#AD1457",
    fontSize: rf(10),
    fontWeight: "600",
    marginBottom: rs(2),
  },

  metaValue: {
    color: "#880E4F",
    fontSize: rf(13),
    fontWeight: "800",
  },

  metaDivider: {
    width: rs(1),
    height: rs(24),
    backgroundColor: "rgba(255,128,171,0.2)",
  },
});
