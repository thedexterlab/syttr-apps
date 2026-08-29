import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { apiRequest, BASE_URL, getRuntimeApiKey, isVerificationRequiredApiError } from "../Api";
import SpinnerTimePicker from "./SpinnerTimePicker";
import { subscribeToNotifications } from "../../lib/pusherClient";
import { MapView, Marker, PROVIDER_GOOGLE } from "../../lib/WebSafeMap";
import { rf, rs } from "../utils/responsive";

const STORAGE_ROOT = String(BASE_URL || "").replace(/\/api\/?$/, "");

type BookingEvent = {
  bookingId?: string;
  id?: string | number;
  jobId?: string | number;
  job_id?: string | number;
  status?: string;
  source?: string;
  title?: string;
  message?: string;
  type?: string;
  hours?: string;
  hoursLabel?: string;
  start?: string;
  start_time?: string;
  end?: string;
  end_time?: string;
  date?: string;
  start_date?: string;
  pay?: string | number;
  sitter?: string;
  child?: string;
  kidAge?: number | string;
  location?: string;
  job?: any;
  application?: any;
  raw?: any;
};

type KidDetails = {
  name?: string;
  age?: number | string;
  gender?: string;
  allergies?: string | null;
  medical_conditions?: string | null;
  notes?: string | null;
};

type Props = {
  route?: { params?: { event?: BookingEvent; date?: string } };
  navigation?: any;
  onBack?: () => void;
  onViewSyttrProfile?: (params: {
    nannyId?: string | number;
    name?: string;
  }) => void;
  onMessageSyttr?: (params: {
    conversationId?: string | number;
    nannyId?: string | number;
    userId?: string | number;
    name?: string;
  }) => void;
  onRequireVerification?: () => void;
};

type DetailBundle = {
  job?: any;
  parent?: any;
  kids?: any[];
  nannies?: any[];
  applications?: any[];
};

type ApplicantCard = {
  id?: string | number;
  applicationId?: string | number;
  name: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  statusRaw?: string;
  statusLabel?: string;
};

const parseNumber = (value?: string | number | null) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
};

const formatMoney = (value?: string | number | null) => {
  const parsed = parseNumber(value);
  if (parsed === null) return "";
  return `$${parsed.toFixed(2)}`;
};

const parseLocalDate = (value: any): Date | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const dateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (dateTime) {
    return new Date(
      Number(dateTime[1]),
      Number(dateTime[2]) - 1,
      Number(dateTime[3]),
      Number(dateTime[4]),
      Number(dateTime[5]),
      Number(dateTime[6] || 0)
    );
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const formatDisplayDate = (value: any) => {
  const parsed = parseLocalDate(value);
  if (!parsed) return String(value || "Date TBD");
  return parsed.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
};

const formatDisplayTime = (value: any) => {
  const raw = String(value || "").trim();
  if (!raw || raw === "--" || raw.toLowerCase() === "time tbd") return "Time TBD";
  const timeMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = timeMatch[2];
    if (Number.isNaN(hour) || hour < 0 || hour > 23) return raw;
    const suffix = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;
    return `${hour}:${minute} ${suffix}`;
  }
  const meridiemMatch = raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))$/);
  if (meridiemMatch) {
    const hour = Number(meridiemMatch[1]);
    const minute = meridiemMatch[2];
    const suffix = String(meridiemMatch[3] || "").toUpperCase();
    if (Number.isNaN(hour) || hour < 1 || hour > 12) return raw;
    return `${hour}:${minute} ${suffix}`;
  }
  const parsed = parseLocalDate(raw);
  if (parsed) {
    return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return raw;
};

const formatHoursValue = (value: any) => {
  const hours = parseNumber(value);
  return hours !== null ? String(hours) : "Hours TBD";
};

const parseTimeStringToDate = (value: any) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const meridiemMatch = raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))$/);
  if (meridiemMatch) {
    const next = new Date();
    let hours = Number(meridiemMatch[1]) % 12;
    const minutes = Number(meridiemMatch[2]);
    if (meridiemMatch[3].toLowerCase() === "pm") hours += 12;
    next.setHours(hours, minutes, 0, 0);
    return next;
  }
  const normalized = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!normalized) return null;
  const next = new Date();
  next.setHours(Number(normalized[1]), Number(normalized[2]), Number(normalized[3] || 0), 0);
  return next;
};

const formatTime12 = (value: Date) =>
  value.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

const formatTime24 = (value: Date) => {
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

const resolveMeridiemAwareTime = (rawValue: any, referenceDate: Date) => {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;

  const explicit = parseTimeStringToDate(raw);
  if (explicit && /\b(am|pm)\b/i.test(raw)) {
    return explicit;
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return explicit;
  }

  const inputHour = Number(match[1]);
  const inputMinute = Number(match[2]);
  if (!Number.isFinite(inputHour) || !Number.isFinite(inputMinute) || inputHour < 1 || inputHour > 12 || inputMinute < 0 || inputMinute > 59) {
    return null;
  }

  const candidates = [0, 12].map((offset) => {
    const next = new Date(referenceDate);
    next.setHours((inputHour % 12) + offset, inputMinute, 0, 0);
    return next;
  });

  const afterReference = candidates
    .filter((candidate) => candidate.getTime() > referenceDate.getTime())
    .sort((a, b) => a.getTime() - b.getTime());

  return afterReference[0] || candidates.sort((a, b) => a.getTime() - b.getTime())[0] || null;
};

const pickFirstBookingValue = (...values: any[]) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text && text !== "undefined" && text !== "null") return value;
  }
  return "";
};

const resolveEventJobPayload = (event?: BookingEvent | null) => {
  const directJob = event?.job && typeof event.job === "object" ? event.job : null;
  const raw = event?.raw && typeof event.raw === "object" ? event.raw : null;
  const rawJob = raw?.job && typeof raw.job === "object" ? raw.job : null;
  const rawDataJob =
    raw?.data?.job && typeof raw.data.job === "object" ? raw.data.job : null;
  return directJob || rawJob || rawDataJob || raw || {};
};

const normalizeRequestSource = (value: any) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (raw === "hire_request") return "hire_request";
  if (raw === "job_post") return "job_post";
  return "";
};

const resolveImageUrl = (value: any) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replace(/^\/+/, "");
  if (!STORAGE_ROOT) return raw;
  if (clean.startsWith("storage/")) {
    return `${STORAGE_ROOT}/${clean}`;
  }
  if (clean.startsWith("public/")) {
    return `${STORAGE_ROOT}/storage/${clean.slice("public/".length)}`;
  }
  return `${STORAGE_ROOT}/storage/${clean}`;
};

const pickAvatarValue = (...sources: any[]) => {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const value =
      source.profile_image ||
      source.user_image_url ||
      source.user_image ||
      source.nanny_image ||
      source.avatar ||
      source.avatar_url ||
      source.image ||
      source.image_url ||
      source.photo ||
      source.photo_url ||
      source.profile_photo ||
      source.profile_photo_url;
    if (value) return resolveImageUrl(value);
  }
  return "";
};

const normalizeTokenValue = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    const nested =
      parsed?.token ||
      parsed?.access_token ||
      parsed?.data?.token ||
      parsed?.data?.access_token ||
      "";
    if (nested) return String(nested).replace(/^Bearer\s+/i, "").replace(/"/g, "").trim();
  } catch {
    // ignore parse error
  }
  return raw.replace(/^Bearer\s+/i, "").replace(/"/g, "").trim();
};

const formatDisplayDateTime = (value: any) => {
  const parsed = parseLocalDate(value);
  if (!parsed) return String(value || "N/A");
  return parsed.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const extractCoordinates = (job: any) => {
  const latRaw = job?.latitude ?? job?.lat ?? job?.location_lat;
  const lonRaw = job?.longitude ?? job?.lng ?? job?.lon ?? job?.location_lng;
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { latitude: lat, longitude: lon };
  }
  const loc = typeof job?.location === "string" ? job.location : "";
  if (loc.includes(",")) {
    const [latText, lonText] = loc.split(",").map((part: string) => part.trim());
    const latParsed = Number(latText);
    const lonParsed = Number(lonText);
    if (Number.isFinite(latParsed) && Number.isFinite(lonParsed)) {
      return { latitude: latParsed, longitude: lonParsed };
    }
  }
  return null;
};

const extractKids = (job: any): KidDetails[] => {
  const kids: KidDetails[] = [];
  const collect = (child: any) => {
    if (!child) return;
    kids.push({
      name: child.name || child.kid_name,
      age: child.age,
      gender: child.gender,
      allergies: child.allergies,
      medical_conditions: child.medical_conditions ?? child.medical_condition ?? null,
      notes: child.notes,
    });
  };

  const rawKids =
    job?.kids ||
    job?.kid ||
    job?.children ||
    job?.child ||
    job?.kids_list;

  if (Array.isArray(rawKids)) {
    rawKids.forEach((entry) => collect(entry?.kids || entry?.kid || entry));
  } else {
    collect(rawKids);
  }

  return kids.filter(
    (kid) =>
      kid.name || kid.gender || (kid.age !== undefined && kid.age !== null)
  );
};

const formatKidMeta = (kid: KidDetails) => {
  const parts: string[] = [];
  if (kid.age !== undefined && kid.age !== null) parts.push(`Age ${kid.age}`);
  if (kid.gender) parts.push(kid.gender);
  return parts.length ? parts.join(" | ") : "";
};

const normalizeStatus = (value: any) => {
  const raw = String(value || "").trim();
  if (!raw) return { key: "pending", label: "Pending" };
  const low = raw.toLowerCase();
  if (low.includes("cancel")) return { key: "canceled", label: "Canceled" };
  if (low.includes("complete")) return { key: "completed", label: "Completed" };
  if (low.includes("accept") || low.includes("approve") || low.includes("confirm")) {
    return { key: "accepted", label: "Accepted" };
  }
  if (low.includes("pending") || low.includes("wait")) {
    return { key: "pending", label: "Pending" };
  }
  return {
    key: low.replace(/[^a-z0-9]+/g, "_"),
    label: raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  };
};

const pickApplicationStatus = (applications: any[] = []) => {
  if (!Array.isArray(applications) || applications.length === 0) return "";
  const acceptedStatuses = new Set([
    "accept",
    "accepted",
    "approved",
    "confirmed",
    "confirm",
  ]);

  const accepted = [...applications]
    .filter((entry: any) => {
      const status = String(
        entry?.status || entry?.application_status || entry?.state || ""
      )
        .trim()
        .toLowerCase();
      return acceptedStatuses.has(status);
    })
    .sort((a, b) => {
      const aTime = parseLocalDate(a?.updated_at || a?.created_at)?.getTime() || 0;
      const bTime = parseLocalDate(b?.updated_at || b?.created_at)?.getTime() || 0;
      return bTime - aTime;
    });

  if (accepted.length > 0) {
    return String(
      accepted[0]?.status ||
        accepted[0]?.application_status ||
        accepted[0]?.state ||
        "accepted"
    ).trim();
  }

  const sorted = [...applications].sort((a, b) => {
    const aTime = parseLocalDate(a?.updated_at || a?.created_at)?.getTime() || 0;
    const bTime = parseLocalDate(b?.updated_at || b?.created_at)?.getTime() || 0;
    return bTime - aTime;
  });
  return String(sorted[0]?.status || "").trim();
};

const hasAcceptedApplication = (job: any) => {
  const lists = [
    ...(Array.isArray(job?.applications) ? job.applications : []),
    ...(Array.isArray(job?.application) ? job.application : []),
  ];
  return lists.some((app: any) => {
    const status = String(
      app?.status || app?.application_status || app?.state || ""
    ).toLowerCase();
    return ["accept", "accepted", "approved", "confirmed", "confirm"].includes(status);
  });
};

const hasAssignedSitter = (job: any) =>
  !!(
    job?.nanny ||
    job?.sitter ||
    job?.assigned_nanny ||
    job?.nanny_id ||
    job?.sitter_id
  );

const isAcceptedStatus = (value: any) => {
  const status = String(value || "").toLowerCase();
  return ["accept", "accepted", "approved", "confirmed", "confirm"].includes(status);
};

const isFinalApplicationStatus = (value: any) => {
  const status = String(value || "").toLowerCase().trim();
  return [
    "accepted",
    "accept",
    "approved",
    "confirmed",
    "confirm",
    "rejected",
    "reject",
    "declined",
    "cancel",
    "canceled",
    "cancelled",
    "completed",
  ].includes(status);
};

const toIdString = (value: any) =>
  value === undefined || value === null ? "" : String(value).trim();

const getDisplayName = (obj: any) => {
  if (!obj) return "";
  const direct =
    obj.fullname ||
    obj.name ||
    obj.full_name ||
    obj.display_name ||
    obj.nanny_name;
  if (direct) return String(direct).trim();
  return [obj.first_name, obj.last_name].filter(Boolean).join(" ").trim();
};

const isGenericSitterLabel = (value: any) => {
  const low = String(value || "").trim().toLowerCase();
  return !low || low === "Syttr" || low === "no Syttr assigned yet";
};

const toArraySafe = (value: any) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
};

const buildApplicantCards = (
  job: any,
  rawEvent: any,
  bundle: DetailBundle | null | undefined,
  fallbackSitter: {
    name?: string;
    email?: string;
    phone?: string;
    avatarUrl?: string;
    id?: string | number;
  },
  options?: {
    acceptedOnly?: boolean;
  }
): ApplicantCard[] => {
  const byKey = new Map<string, ApplicantCard>();
  const acceptedOnly = options?.acceptedOnly === true;

  const upsert = (entry: ApplicantCard) => {
    const name = String(entry.name || "").trim();
    if (!name || isGenericSitterLabel(name)) return;
    const key =
      entry.id !== undefined && entry.id !== null && String(entry.id).trim()
        ? `id:${String(entry.id).trim()}`
        : `name:${name.toLowerCase()}|${String(entry.email || "")
            .trim()
            .toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        id: entry.id,
        applicationId: entry.applicationId,
        name,
        email: entry.email,
        phone: entry.phone,
        avatarUrl: entry.avatarUrl,
        statusRaw: entry.statusRaw,
        statusLabel: entry.statusLabel,
      });
      return;
    }
    byKey.set(key, {
      id: existing.id ?? entry.id,
      applicationId: existing.applicationId ?? entry.applicationId,
      name: existing.name || name,
      email: existing.email || entry.email,
      phone: existing.phone || entry.phone,
      avatarUrl: existing.avatarUrl || entry.avatarUrl,
      statusRaw: existing.statusRaw || entry.statusRaw,
      statusLabel: existing.statusLabel || entry.statusLabel,
    });
  };

  const applicationEntries = [
    ...toArraySafe(bundle?.applications),
    ...toArraySafe(job?.applications),
    ...toArraySafe(job?.application),
    ...toArraySafe(rawEvent?.applications),
    ...toArraySafe(rawEvent?.application),
  ];

  const acceptedApplicationEntries = applicationEntries.filter((application: any) =>
    isAcceptedStatus(application?.status || application?.application_status || application?.state)
  );
  const entriesToUse = acceptedOnly ? acceptedApplicationEntries : applicationEntries;

  const acceptedNannyIds = new Set(
    acceptedApplicationEntries
      .map((application: any) =>
        toIdString(
          application?.nanny_id ||
            application?.sitter_id ||
            application?.user_id ||
            application?.nanny?.id ||
            application?.sitter?.id ||
            application?.user?.id
        )
      )
      .filter(Boolean)
  );

  entriesToUse.forEach((application: any) => {
    const person =
      application?.nanny ||
      application?.sitter ||
      application?.user ||
      application?.profile ||
      application;
    const statusRaw = String(
      application?.status || application?.application_status || application?.state || ""
    ).trim();
    upsert({
      id:
        application?.nanny_id ||
        application?.sitter_id ||
        application?.user_id ||
        person?.id ||
        person?.nanny_id ||
        person?.sitter_id,
      applicationId:
        application?.id ||
        application?.application_id ||
        application?.job_application_id,
      name:
        getDisplayName(person) ||
        String(
          application?.nanny_name || application?.sitter_name || application?.user_name || ""
        ).trim(),
      email: person?.email || application?.email,
      phone: person?.phone || person?.number || application?.phone,
      avatarUrl: pickAvatarValue(
        person,
        person?.profile,
        person?.user_profile,
        application,
        application?.nanny,
        application?.sitter,
        application?.user
      ),
      statusRaw: statusRaw || undefined,
      statusLabel: statusRaw ? normalizeStatus(statusRaw).label : undefined,
    });
  });

  const rawNannyEntries = toArraySafe(bundle?.nannies);
  const nannyEntries = !acceptedOnly
    ? rawNannyEntries
    : acceptedNannyIds.size === 0
    ? rawNannyEntries.slice(0, 1)
    : rawNannyEntries.filter((nanny: any) => {
        const nannyId = toIdString(nanny?.nanny_id || nanny?.id || nanny?.user_id);
        return nannyId ? acceptedNannyIds.has(nannyId) : false;
      });
  nannyEntries.forEach((nanny: any) => {
    upsert({
      id: nanny?.nanny_id || nanny?.id,
      name: getDisplayName(nanny) || String(nanny?.nanny_name || "").trim(),
      email: nanny?.email,
      phone: nanny?.phone || nanny?.number,
      avatarUrl: pickAvatarValue(nanny, nanny?.profile, nanny?.user_profile),
    });
  });

  if (!acceptedOnly || byKey.size === 0) {
    upsert({
      id: fallbackSitter?.id,
      name: fallbackSitter?.name || "",
      email: fallbackSitter?.email,
      phone: fallbackSitter?.phone,
      avatarUrl: fallbackSitter?.avatarUrl,
    });
  }

  return Array.from(byKey.values());
};

const resolveSitterDetails = (job: any, rawEvent: any, bundle?: DetailBundle | null) => {
  const applications = [
    ...(Array.isArray(bundle?.applications) ? bundle.applications : []),
    ...(Array.isArray(job?.applications) ? job.applications : []),
    ...(Array.isArray(job?.application) ? job.application : []),
    ...(Array.isArray(rawEvent?.applications) ? rawEvent.applications : []),
    ...(Array.isArray(rawEvent?.application) ? rawEvent.application : []),
  ];
  const acceptedApp = applications.find((app: any) =>
    isAcceptedStatus(app?.status || app?.application_status || app?.state)
  );
  const acceptedNannyId = toIdString(
    acceptedApp?.nanny_id ||
      acceptedApp?.sitter_id ||
      acceptedApp?.user_id ||
      acceptedApp?.nanny?.id ||
      acceptedApp?.sitter?.id ||
      acceptedApp?.user?.id
  );
  const bundleNannies = Array.isArray(bundle?.nannies) ? bundle.nannies : [];
  const bundleNannyByAcceptedId =
    acceptedNannyId !== ""
      ? bundleNannies.find((entry: any) =>
          toIdString(entry?.nanny_id || entry?.id || entry?.user_id) === acceptedNannyId
        )
      : null;
  const bundleNanny = bundleNannyByAcceptedId || bundleNannies[0] || null;

  const sitterObj =
    acceptedApp?.nanny ||
    acceptedApp?.sitter ||
    acceptedApp?.user ||
    bundleNannyByAcceptedId ||
    bundleNanny ||
    job?.nanny ||
    job?.sitter ||
    job?.assigned_nanny ||
    rawEvent?.nanny ||
    rawEvent?.sitter ||
    rawEvent?.assigned_nanny ||
    rawEvent?.application?.nanny ||
    rawEvent?.application?.sitter ||
    {};

  const name =
    getDisplayName(sitterObj) ||
    String(bundleNanny?.fullname || "").trim() ||
    String(rawEvent?.nanny_name || "").trim() ||
    "";
  const email =
    acceptedApp?.nanny?.email ||
    acceptedApp?.sitter?.email ||
    acceptedApp?.user?.email ||
    bundleNannyByAcceptedId?.email ||
    bundleNanny?.email ||
    sitterObj?.email ||
    rawEvent?.nanny_email ||
    job?.nanny?.email ||
    job?.sitter?.email;
  const phone =
    acceptedApp?.nanny?.phone ||
    acceptedApp?.sitter?.phone ||
    acceptedApp?.user?.phone ||
    bundleNannyByAcceptedId?.phone ||
    bundleNannyByAcceptedId?.number ||
    bundleNanny?.phone ||
    bundleNanny?.number ||
    sitterObj?.phone ||
    sitterObj?.number ||
    rawEvent?.nanny_phone ||
    job?.nanny?.phone ||
    job?.sitter?.phone;
  const id =
    acceptedNannyId ||
    bundleNannyByAcceptedId?.nanny_id ||
    bundleNannyByAcceptedId?.id ||
    bundleNanny?.nanny_id ||
    sitterObj?.id ||
    job?.nanny?.id ||
    job?.sitter?.id ||
    rawEvent?.nanny_id ||
    rawEvent?.sitter_id ||
    job?.nanny_id ||
    job?.sitter_id ||
    acceptedApp?.nanny_id ||
    acceptedApp?.sitter_id ||
    acceptedApp?.user_id;
  const avatarUrl = pickAvatarValue(
    acceptedApp?.nanny,
    acceptedApp?.sitter,
    acceptedApp?.user,
    bundleNannyByAcceptedId,
    bundleNanny,
    sitterObj,
    rawEvent,
    rawEvent?.nanny,
    rawEvent?.sitter,
    rawEvent?.assigned_nanny,
    rawEvent?.application,
    rawEvent?.application?.nanny,
    rawEvent?.application?.sitter,
    job?.nanny,
    job?.sitter,
    job?.assigned_nanny
  );

  return { name, email, phone, avatarUrl, id };
};

export default function ClientBookingDetailScreen({
  route,
  navigation,
  onBack,
  onViewSyttrProfile,
  onMessageSyttr,
  onRequireVerification,
}: Props) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isVerySmall = width <= 320;
  const isSmall = width <= 360;
  const isTablet = width >= 768;
  const stackNarrow = width <= 360;
  const stackVeryNarrow = width <= 340;
  const heroPadTop = isLandscape ? rs(8) : isTablet ? rs(12) : rs(10);
  const heroPadBottom = isLandscape ? rs(12) : isTablet ? rs(26) : isSmall ? rs(14) : rs(20);
  const heroPadHorizontal = isVerySmall ? rs(12) : isTablet ? rs(24) : rs(16);
  const contentHorizontal = isVerySmall ? rs(10) : isTablet ? rs(24) : rs(16);
  const contentTopPad = isLandscape ? rs(8) : rs(10);
  const contentMaxWidth = isTablet ? 980 : 760;
  const mapHeight = isLandscape ? (isTablet ? rs(240) : rs(160)) : isTablet ? rs(300) : rs(220);
  const summaryColumns = stackVeryNarrow ? 1 : stackNarrow ? 2 : 3;
  const summaryBasis = summaryColumns === 3 ? "31%" : summaryColumns === 2 ? "48%" : "100%";
  const event: BookingEvent = route?.params?.event ?? {};
  const date: string = route?.params?.date ?? "";
  const seedRawJob = resolveEventJobPayload(event);
  const [savingStatus, setSavingStatus] = useState(false);
  const [decisionLoading, setDecisionLoading] = useState<{
    applicationId: string;
    decision: "accept" | "reject";
  } | null>(null);
  const [extraHoursModalVisible, setExtraHoursModalVisible] = useState(false);
  const [extraHoursValue, setExtraHoursValue] = useState("");
  const [extraHoursPickerVisible, setExtraHoursPickerVisible] = useState(false);
  const [extraHoursPickerDraft, setExtraHoursPickerDraft] = useState<Date | null>(null);
  const [requestingExtraHours, setRequestingExtraHours] = useState(false);
  const [pendingExtraHours, setPendingExtraHours] = useState<number | null>(null);
  const [skipNextProfileOpen, setSkipNextProfileOpen] = useState(false);
  const [detailJob, setDetailJob] = useState<any | null>(null);
  const [detailBundle, setDetailBundle] = useState<DetailBundle | null>(null);
  const lastExtraHoursAlertKeyRef = useRef("");
  const rawJob = detailJob || seedRawJob;
  const jobId =
    rawJob?.id ||
    seedRawJob?.id ||
    event.job?.id ||
    event.job_id ||
    event.jobId ||
    event.raw?.job_id ||
    event.raw?.data?.job_id ||
    event.id ||
    event.bookingId;
  const bookingApplications = useMemo(
    () => [
      ...toArraySafe(detailBundle?.applications),
      ...toArraySafe(rawJob?.applications),
      ...toArraySafe(rawJob?.application),
      ...toArraySafe(event.raw?.applications),
      ...toArraySafe(event.raw?.application),
    ],
    [
      detailBundle?.applications,
      rawJob?.applications,
      rawJob?.application,
      event.raw?.applications,
      event.raw?.application,
    ]
  );

  const refreshJobDetails = React.useCallback(async () => {
    const id = String(jobId || "").trim();
    if (!id) return false;

    try {
      const [tokenRaw, userId, apiKeyRaw] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("api_key"),
      ]);
      const token = String(tokenRaw || "").replace(/^Bearer\s+/i, "").replace(/"/g, "").trim();
      const apiKey = String(apiKeyRaw || "").trim() || getRuntimeApiKey() || undefined;

      let res = await fetch(`${BASE_URL}job/get-details`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({
          job_id: Number.isFinite(Number(id)) ? Number(id) : id,
          ...(userId ? { user_id: userId } : {}),
        }),
      });

      let json = await res.json().catch(() => null);
      let nextJob =
        json?.data?.job ||
        (Array.isArray(json?.data) ? json.data.find((j: any) => String(j?.id) === id) : null) ||
        (json?.data && String(json?.data?.id || "") === id ? json.data : null) ||
        null;
      let nextKids = Array.isArray(json?.data?.kids) ? json.data.kids : Array.isArray(nextJob?.kids) ? nextJob.kids : [];
      let nextParent = json?.data?.parent || null;
      let nextNannies = Array.isArray(json?.data?.nannies)
        ? json.data.nannies
        : Array.isArray(nextJob?.nannies)
        ? nextJob.nannies
        : [];
      let nextApplications = Array.isArray(json?.data?.applications)
        ? json.data.applications
        : Array.isArray(nextJob?.applications)
        ? nextJob.applications
        : [];

      if (
        (!res.ok || json?.success === false) &&
        isVerificationRequiredApiError({ status: res.status, payload: json, message: json?.message })
      ) {
        onRequireVerification?.();
        return false;
      }

      if ((!res.ok || !json?.success) && res.status === 401 && userId) {
        res = await fetch(`${BASE_URL}parent-jobs`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
          body: JSON.stringify({ user_id: userId, per_page: 100 }),
        });
        json = await res.json().catch(() => null);
        if (
          (!res.ok || json?.success === false) &&
          isVerificationRequiredApiError({ status: res.status, payload: json, message: json?.message })
        ) {
          onRequireVerification?.();
          return false;
        }
        const list = Array.isArray(json?.data?.data)
          ? json.data.data
          : Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json)
          ? json
          : [];
        nextJob = list.find((j: any) => String(j?.id) === id) || null;
        nextKids = Array.isArray(nextJob?.kids) ? nextJob.kids : [];
        nextParent = json?.data?.parent || null;
        nextNannies = Array.isArray(nextJob?.nannies) ? nextJob.nannies : nextNannies;
        nextApplications = Array.isArray(nextJob?.applications) ? nextJob.applications : nextApplications;
      }

      if (!nextJob) return false;
      if (nextKids.length && !Array.isArray(nextJob?.kids)) nextJob.kids = nextKids;
      setDetailBundle({
        job: nextJob || undefined,
        parent: nextParent || undefined,
        kids: nextKids || [],
        nannies: nextNannies,
        applications: nextApplications,
      });
      setDetailJob(nextJob);
      return true;
    } catch (error) {
      if (isVerificationRequiredApiError(error)) {
        onRequireVerification?.();
      }
      return false;
    }
  }, [jobId, onRequireVerification]);

  const applyExtraHoursSnapshot = React.useCallback((snapshot: any) => {
    const source =
      snapshot?.data && typeof snapshot.data === "object"
        ? snapshot.data
        : snapshot;
    const nextHours =
      source?.hours ??
      source?.updated_hours ??
      source?.job?.hours;
    const nextPrice =
      source?.price ??
      source?.updated_total ??
      source?.job?.price;
    const nextEndTime =
      source?.end_time ??
      source?.updated_end_time ??
      source?.new_end_time ??
      source?.job?.end_time;
    const nextStatus =
      source?.status ??
      source?.job?.status;

    if (
      nextHours === undefined &&
      nextPrice === undefined &&
      !nextEndTime &&
      !nextStatus
    ) {
      return;
    }

    setDetailJob((prev: any) => {
      const base = prev || seedRawJob || {};
      return {
        ...base,
        ...(nextHours !== undefined ? { hours: nextHours } : null),
        ...(nextPrice !== undefined ? { price: nextPrice } : null),
        ...(nextEndTime ? { end_time: nextEndTime } : null),
        ...(nextStatus ? { status: nextStatus } : null),
      };
    });

    setDetailBundle((prev) => ({
      ...(prev || {}),
      job: {
        ...((prev?.job as any) || {}),
        ...(nextHours !== undefined ? { hours: nextHours } : null),
        ...(nextPrice !== undefined ? { price: nextPrice } : null),
        ...(nextEndTime ? { end_time: nextEndTime } : null),
        ...(nextStatus ? { status: nextStatus } : null),
      },
      kids: prev?.kids || [],
      nannies: prev?.nannies || [],
      applications: prev?.applications || [],
    }));
  }, [seedRawJob]);

  const notifyExtraHoursAccepted = React.useCallback(
    (snapshot: any) => {
      const source =
        snapshot?.data && typeof snapshot.data === "object"
          ? snapshot.data
          : snapshot;
      const nextEndTime =
        source?.end_time ??
        source?.updated_end_time ??
        source?.new_end_time ??
        source?.job?.end_time ??
        "";
      const nextHours =
        source?.hours ??
        source?.updated_hours ??
        source?.job?.hours ??
        "";
      const alertKey = `${String(jobId || "")}:${String(nextEndTime || "")}:${String(nextHours || "")}`;
      if (!alertKey || lastExtraHoursAlertKeyRef.current === alertKey) return;
      lastExtraHoursAlertKeyRef.current = alertKey;

      const timeText = nextEndTime ? formatDisplayTime(nextEndTime) : "";
      const message = timeText
        ? `Your request hour is accepted. New end time: ${timeText}.`
        : "Your request hour is accepted.";

      Alert.alert("Extra Hours Accepted", message, [
        {
          text: "OK",
          onPress: () => {
            void refreshJobDetails();
          },
        },
      ]);
    },
    [jobId, refreshJobDetails]
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const ok = await refreshJobDetails();
      if (!mounted || ok) return;
    })();
    return () => {
      mounted = false;
    };
  }, [refreshJobDetails]);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    void (async () => {
      const userId = String((await AsyncStorage.getItem("user_id")) || "").trim();
      const bookingKey = String(jobId || "").trim();
      if (!active || !userId || !bookingKey) return;

      const sub = subscribeToNotifications(userId, (payload) => {
        const notificationJobId = String(
          payload?.job_id ||
            payload?.data?.job_id ||
            payload?.data?.job?.id ||
            payload?.data?.job?.job_id ||
            payload?.job?.id ||
            payload?.job?.job_id ||
            ""
        ).trim();
        const type = String(payload?.type || payload?.data?.type || "").trim().toLowerCase();
        if (notificationJobId !== bookingKey) return;
        if (!["extra_hours_accepted", "extra_hours_rejected", "extra_hours_request"].includes(type)) {
          return;
        }
        if (type === "extra_hours_accepted" || type === "extra_hours_rejected") {
          setPendingExtraHours(null);
          applyExtraHoursSnapshot(payload);
          if (type === "extra_hours_accepted") {
            notifyExtraHoursAccepted(payload);
          }
        }
        void refreshJobDetails();
      });
      unsubscribe = sub.unsubscribe;
    })();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applyExtraHoursSnapshot, jobId, notifyExtraHoursAccepted, refreshJobDetails]);

  const resolvedParentDisplayStatus =
    detailBundle?.job?.parent_display_status ||
    rawJob?.parent_display_status ||
    "";
  const jobStatusRaw =
    resolvedParentDisplayStatus ||
    detailBundle?.job?.job_status ||
    detailBundle?.job?.booking_status ||
    detailBundle?.job?.status ||
    rawJob?.job_status ||
    rawJob?.booking_status ||
    rawJob?.status ||
    event.raw?.job_status ||
    event.raw?.booking_status ||
    event.raw?.status ||
    event.status ||
    "";
  const normalizedJobStatus = normalizeStatus(jobStatusRaw);

  const isExtraHoursPollingFinal = useMemo(() => {
    return ["canceled", "completed"].includes(normalizeStatus(jobStatusRaw).key);
  }, [jobStatusRaw]);

  useEffect(() => {
    if (!pendingExtraHours || !jobId || isExtraHoursPollingFinal) return;

    let active = true;
    let inFlight = false;

    const pollStatus = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const [userId, tokenRaw, apiKeyRaw] = await Promise.all([
          AsyncStorage.getItem("user_id"),
          AsyncStorage.getItem("token"),
          AsyncStorage.getItem("api_key"),
        ]);
        const normalizedJobId = String(jobId || "").trim();
        if (!active || !userId || !normalizedJobId) return;

        const token = normalizeTokenValue(tokenRaw || undefined);
        const apiKey = String(apiKeyRaw || "").trim() || getRuntimeApiKey() || undefined;
        const json = await apiRequest<any>(
          `bookings/${encodeURIComponent(normalizedJobId)}/extra-hours/status?user_id=${encodeURIComponent(userId)}`,
          {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(apiKey ? { "x-api-key": apiKey } : {}),
            },
          }
        );

        if (!active || json?.success === false) return;

        const statusData = json?.data || {};
        const isPending = statusData?.pending_request === true;
        const decision = String(statusData?.latest_decision || "").trim().toLowerCase();

        if (isPending) return;

        setPendingExtraHours(null);
        applyExtraHoursSnapshot(statusData);

        if (decision === "accepted" || decision === "rejected") {
          if (decision === "accepted") {
            notifyExtraHoursAccepted(statusData);
          }
          void refreshJobDetails();
        }
      } catch {
        // ignore polling failures and wait for the next cycle
      } finally {
        inFlight = false;
      }
    };

    void pollStatus();
    const timer = setInterval(() => {
      void pollStatus();
    }, 12000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [applyExtraHoursSnapshot, isExtraHoursPollingFinal, jobId, notifyExtraHoursAccepted, pendingExtraHours, refreshJobDetails]);

  const bookingId = event.bookingId || rawJob?.id || event.job_id || event.id || "#BK-1";
  const apiApplicationStatus = pickApplicationStatus(detailBundle?.applications || []);
  const statusRaw =
    normalizedJobStatus.key === "completed" || normalizedJobStatus.key === "canceled"
      ? jobStatusRaw
      : apiApplicationStatus ||
        detailBundle?.job?.application_status ||
        detailBundle?.job?.my_application_status ||
        event.raw?.application_status ||
        rawJob?.application_status ||
        jobStatusRaw ||
        "Pending";
  const normalizedFromRaw = normalizeStatus(statusRaw);
  const shouldForcePending =
    normalizedFromRaw.key === "accepted" &&
    !hasAcceptedApplication(rawJob) &&
    !hasAssignedSitter(rawJob);
  const normalizedStatus = shouldForcePending
    ? { key: "pending", label: "Pending" }
    : normalizedFromRaw;
  const status = normalizedStatus.label;
  const shouldShowAcceptedOnly = useMemo(() => {
    if (normalizedStatus.key === "accepted" || normalizedStatus.key === "completed") return true;
    return bookingApplications.some((app: any) =>
      isAcceptedStatus(app?.status || app?.application_status || app?.state)
    );
  }, [normalizedStatus.key, bookingApplications]);

  const start =
    String(
      pickFirstBookingValue(
        event.start,
        event.start_time,
        rawJob?.start_time,
        rawJob?.time,
        event.raw?.start_time,
        event.raw?.time,
        event.raw?.data?.start_time,
        event.raw?.data?.time
      ) || "--"
    );
  const end = String(
    pickFirstBookingValue(
      event.end,
      event.end_time,
      rawJob?.end_time,
      rawJob?.end,
      rawJob?.finish_time,
      event.raw?.end_time,
      event.raw?.end,
      event.raw?.finish_time,
      event.raw?.data?.end_time,
      event.raw?.data?.end,
      event.raw?.data?.finish_time
    ) || ""
  );
  const rawDate =
    pickFirstBookingValue(
      date,
      event.start_date,
      event.date,
      rawJob?.start_date,
      rawJob?.date,
      event.raw?.start_date,
      event.raw?.date,
      event.raw?.data?.start_date,
      event.raw?.data?.date
    ) || "Date TBD";
  const dateLabel = formatDisplayDate(rawDate);
  const formattedStart = formatDisplayTime(start);
  const formattedEnd = end ? formatDisplayTime(end) : "";
  const currentEndTimeValue =
    String(detailBundle?.job?.end_time || rawJob?.end_time || end || "").trim();
  const currentEndTimeDate = parseTimeStringToDate(currentEndTimeValue) || new Date();
  const resolvedExtraHoursDate =
    resolveMeridiemAwareTime(extraHoursValue, currentEndTimeDate) ||
    extraHoursPickerDraft ||
    currentEndTimeDate;
  const timeLabel =
    formattedStart === "Time TBD" && !formattedEnd
      ? "Time TBD"
      : `${formattedStart}${formattedEnd ? ` - ${formattedEnd}` : ""}`;
  const hoursLabel = formatHoursValue(event.hours || event.hoursLabel || rawJob?.hours);

  const sitterDetails = resolveSitterDetails(rawJob, event.raw, detailBundle);
  const eventSitterName = String(event.sitter || "").trim();
  const sitterName =
    (!isGenericSitterLabel(eventSitterName) ? eventSitterName : "") ||
    sitterDetails.name ||
    "No Syttr assigned yet";
  const sitterAvatar = sitterDetails.avatarUrl;
  const sitterId = sitterDetails.id;
  const applicantCards = useMemo(
    () =>
      buildApplicantCards(rawJob, event.raw, detailBundle, sitterDetails, {
        acceptedOnly: shouldShowAcceptedOnly,
      }),
    [rawJob, event.raw, detailBundle, sitterDetails, shouldShowAcceptedOnly]
  );
  const displayNannies = useMemo(() => {
    const allNannies = Array.isArray(detailBundle?.nannies) ? detailBundle.nannies : [];
    if (!shouldShowAcceptedOnly) return allNannies;
    if (allNannies.length <= 1) return allNannies;

    const acceptedNannyIds = new Set(
      bookingApplications
        .filter((app: any) =>
          isAcceptedStatus(app?.status || app?.application_status || app?.state)
        )
        .map((app: any) =>
          toIdString(
            app?.nanny_id ||
              app?.sitter_id ||
              app?.user_id ||
              app?.nanny?.id ||
              app?.sitter?.id ||
              app?.user?.id
          )
        )
        .filter(Boolean)
    );

    if (acceptedNannyIds.size === 0) return allNannies.slice(0, 1);

    const filtered = allNannies.filter((nanny: any) => {
      const nannyId = toIdString(nanny?.nanny_id || nanny?.id || nanny?.user_id);
      return nannyId ? acceptedNannyIds.has(nannyId) : false;
    });

    return filtered.length ? filtered : allNannies.slice(0, 1);
  }, [detailBundle?.nannies, shouldShowAcceptedOnly, bookingApplications]);

  const kids = useMemo(() => extractKids(rawJob), [rawJob]);
  const fallbackKids = useMemo<KidDetails[]>(() => {
    const rawNames =
      typeof event.child === "string"
        ? event.child.split(",").map((name) => name.trim()).filter(Boolean)
        : [];
    const names = rawNames.filter(
      (name) => name.toLowerCase() !== "child"
    );
    if (names.length) {
      if (names.length === 1) {
        const age =
          event.kidAge ?? rawJob?.kid?.age ?? rawJob?.child?.age;
        const gender = rawJob?.kid?.gender ?? rawJob?.child?.gender;
        return [{ name: names[0], age, gender }].filter(
          (kid) =>
            kid.name || kid.gender || (kid.age !== undefined && kid.age !== null)
        );
      }
      return names.map((name) => ({ name }));
    }

    const name = rawJob?.kid?.name || rawJob?.child?.name;
    const age = event.kidAge ?? rawJob?.kid?.age ?? rawJob?.child?.age;
    const gender = rawJob?.kid?.gender ?? rawJob?.child?.gender;
    const allergies = rawJob?.kid?.allergies ?? rawJob?.child?.allergies;
    const medicalConditions =
      rawJob?.kid?.medical_conditions ?? rawJob?.kid?.medical_condition ?? rawJob?.child?.medical_conditions ?? rawJob?.child?.medical_condition;
    const notes = rawJob?.kid?.notes ?? rawJob?.child?.notes;
    if (!name && age === undefined && !gender && !allergies && !medicalConditions && !notes) return [];
    return [{ name, age, gender, allergies, medical_conditions: medicalConditions ?? null, notes }];
  }, [event.child, event.kidAge, rawJob]);
  const displayKids: KidDetails[] = kids.length ? kids : fallbackKids;
  const detailKids = useMemo(() => {
    if ((detailBundle?.kids || []).length) return detailBundle?.kids || [];
    if (displayKids.length) return displayKids;
    return [];
  }, [detailBundle?.kids, displayKids]);
  const detailNannies = useMemo(() => {
    if (displayNannies.length) return displayNannies;
    if (sitterDetails.name || sitterName !== "No Syttr assigned yet") {
      return [
        {
          id: sitterId,
          nanny_id: sitterId,
          fullname: sitterDetails.name || sitterName,
          name: sitterDetails.name || sitterName,
          experience: rawJob?.experience ?? rawJob?.nanny?.experience ?? rawJob?.sitter?.experience,
          bio: rawJob?.bio ?? rawJob?.nanny?.bio ?? rawJob?.sitter?.bio,
        },
      ];
    }
    return [];
  }, [displayNannies, rawJob, sitterDetails.name, sitterId, sitterName]);

  const location =
    event.location || rawJob?.location || rawJob?.address || "Location TBD";
  const coords = useMemo(() => extractCoordinates(rawJob), [rawJob]);
  const region = coords
    ? {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      }
    : undefined;

  const hoursValue = parseNumber(hoursLabel);
  const source = String(event.source || "").toLowerCase();
  const eventPayText = String(event.pay ?? "").trim();
  const eventPayValue = parseNumber(event.pay);
  const eventPayLooksHourly = /\b(hr|hour)\b/i.test(eventPayText);

  const hourlyFromJob = parseNumber(
    rawJob?.hourly_rate ??
      rawJob?.hourlyRate ??
      rawJob?.rate ??
      rawJob?.pay_rate ??
      rawJob?.payRate ??
      rawJob?.rate_per_hour ??
      rawJob?.price_per_hour ??
      rawJob?.amount_per_hour ??
      detailBundle?.job?.hourly_rate ??
      detailBundle?.job?.hourlyRate ??
      detailBundle?.job?.rate ??
      detailBundle?.job?.pay_rate
  );

  const totalFromJob = parseNumber(
    rawJob?.price ??
      rawJob?.total_price ??
      rawJob?.total ??
      rawJob?.total_amount ??
      rawJob?.amount ??
      rawJob?.grand_total ??
      rawJob?.paid_amount ??
      detailBundle?.job?.price ??
      detailBundle?.job?.total_price ??
      detailBundle?.job?.total
  );

  const treatEventPayAsHourly =
    eventPayLooksHourly ||
    (source === "clientcalendar" && hourlyFromJob === null && totalFromJob === null);
  const eventRateValue = treatEventPayAsHourly ? eventPayValue : null;
  const eventTotalValue = !treatEventPayAsHourly ? eventPayValue : null;

  const totalValue =
    totalFromJob ??
    eventTotalValue ??
    (eventRateValue !== null && hoursValue !== null ? eventRateValue * hoursValue : null);

  const rateValue =
    hourlyFromJob ??
    eventRateValue ??
    (totalValue !== null && hoursValue !== null && hoursValue > 0
      ? totalValue / hoursValue
      : null);

  const rateLabel = rateValue !== null ? `${formatMoney(rateValue)}/hr` : "Rate TBD";
  const totalLabel = totalValue !== null ? formatMoney(totalValue) : "Total TBD";

  const statusTone = useMemo(() => {
    if (normalizedStatus.key === "accepted") {
      return { bg: "#E8F5E9", text: "#1B5E20", dot: "#43A047" };
    }
    if (normalizedStatus.key === "pending") {
      return { bg: "#FFF8E1", text: "#8B5E00", dot: "#FFC107" };
    }
    if (normalizedStatus.key === "completed") {
      return { bg: "#E3F2FD", text: "#0D47A1", dot: "#1E88E5" };
    }
    return { bg: "#FFEBEE", text: "#B71C1C", dot: "#E53935" };
  }, [normalizedStatus.key]);

  const isFinalStatus = useMemo(() => {
    return ["canceled", "completed"].includes(normalizedStatus.key);
  }, [normalizedStatus.key]);

  const canComplete = normalizedStatus.key === "accepted";
  const canMessageSyttr =
    normalizedStatus.key === "accepted" &&
    !!String(sitterId || "").trim();
  const canRequestExtraHours =
    normalizedStatus.key === "accepted" &&
    !!String(jobId || "").trim() &&
    !!String(sitterId || "").trim();
  const resolvedRequestSource = useMemo(() => {
    const explicitSources = [
      detailBundle?.job?.request_source,
      rawJob?.request_source,
      seedRawJob?.request_source,
      event?.raw?.request_source,
      event?.raw?.job?.request_source,
      detailBundle?.job?.application?.request_source,
      rawJob?.application?.request_source,
      event?.raw?.application?.request_source,
      ...bookingApplications.map((entry: any) =>
        entry?.request_source ||
        entry?.application?.request_source ||
        entry?.data?.request_source ||
        ""
      ),
    ]
      .map(normalizeRequestSource)
      .filter(Boolean);

    if (explicitSources.includes("hire_request")) return "hire_request";
    if (explicitSources.includes("job_post")) return "job_post";
    return "";
  }, [
    bookingApplications,
    detailBundle?.job?.application?.request_source,
    detailBundle?.job?.request_source,
    event?.raw?.application?.request_source,
    event?.raw?.job?.request_source,
    event?.raw?.request_source,
    rawJob?.application?.request_source,
    rawJob?.request_source,
    seedRawJob?.request_source,
  ]);

  const isParentInitiatedHireRequest = useMemo(() => {
    if (resolvedRequestSource === "hire_request") return true;
    if (resolvedRequestSource === "job_post") return false;

    const hasHireRequestedStatus = bookingApplications.some((entry: any) => {
      const status = String(
        entry?.status || entry?.application_status || entry?.state || ""
      )
        .trim()
        .toLowerCase();
      return status === "hire_requested" || status === "hire-requested";
    });
    if (hasHireRequestedStatus) return true;

    const topStatus = String(
      rawJob?.application_status ||
        rawJob?.status ||
        event?.raw?.application_status ||
        ""
    )
      .trim()
      .toLowerCase();
    if (topStatus === "hire_requested" || topStatus === "hire-requested") return true;

    const hasHireSourceMarker = bookingApplications.some((entry: any) =>
      String(entry?.message || "").toLowerCase().includes("source:hire_now")
    );
    if (hasHireSourceMarker) return true;

    const eventType = String(
      event?.raw?.type ||
        event?.raw?.notification?.type ||
        event?.raw?.data?.type ||
        event?.type ||
        ""
    )
      .trim()
      .toLowerCase();
    if (eventType === "hire_request" || eventType === "hire-request") return true;

    const hireHay = `${event?.raw?.title || ""} ${event?.raw?.message || ""} ${event?.title || ""} ${event?.message || ""}`
      .toLowerCase()
      .trim();
    if (hireHay.includes("hire request") || hireHay.includes("sent you a hire request")) {
      return true;
    }

    return false;
  }, [
    bookingApplications,
    event?.message,
    event?.raw?.application_status,
    event?.raw?.message,
    event?.raw?.notification?.type,
    event?.raw?.title,
    event?.raw?.type,
    event?.title,
    event?.type,
    rawJob?.application_status,
    rawJob?.status,
    resolvedRequestSource,
  ]);
  const canRespondToApplicants =
    resolvedRequestSource === "job_post"
      ? true
      : resolvedRequestSource === "hire_request"
      ? false
      : !isParentInitiatedHireRequest;

  const resolveApplicantDecisionTarget = (applicant: ApplicantCard) => {
    const explicitApplicationId = toIdString(applicant?.applicationId);
    if (explicitApplicationId) {
      const matchedByApplicationId = bookingApplications.find((entry: any) => {
        const entryId = toIdString(
          entry?.id || entry?.application_id || entry?.job_application_id
        );
        return entryId === explicitApplicationId;
      });
      const statusRaw = String(
        matchedByApplicationId?.status ||
          matchedByApplicationId?.application_status ||
          matchedByApplicationId?.state ||
          applicant?.statusRaw ||
          ""
      ).trim();
      return { applicationId: explicitApplicationId, statusRaw };
    }

    const targetNannyId = toIdString(applicant?.id);
    if (!targetNannyId) {
      return { applicationId: "", statusRaw: String(applicant?.statusRaw || "").trim() };
    }
    const matchedByNannyId = bookingApplications.find((entry: any) => {
      const entryNannyId = toIdString(
        entry?.nanny_id ||
          entry?.sitter_id ||
          entry?.user_id ||
          entry?.nanny?.id ||
          entry?.nanny?.nanny_id ||
          entry?.sitter?.id ||
          entry?.sitter?.sitter_id ||
          entry?.user?.id
      );
      return entryNannyId === targetNannyId;
    });
    return {
      applicationId: toIdString(
        matchedByNannyId?.id ||
          matchedByNannyId?.application_id ||
          matchedByNannyId?.job_application_id
      ),
      statusRaw: String(
        matchedByNannyId?.status ||
          matchedByNannyId?.application_status ||
          matchedByNannyId?.state ||
          applicant?.statusRaw ||
          ""
      ).trim(),
    };
  };

  const patchApplicationStatusInList = (
    list: any,
    applicationId: string,
    nextStatus: string,
    updatedAt: string
  ) => {
    if (!Array.isArray(list)) return list;
    return list.map((entry: any) => {
      const entryId = toIdString(
        entry?.id || entry?.application_id || entry?.job_application_id
      );
      if (!entryId || entryId !== applicationId) return entry;
      return {
        ...entry,
        status: nextStatus,
        application_status: nextStatus,
        state: nextStatus,
        updated_at: updatedAt,
      };
    });
  };

  const handleMessageSyttr = async () => {
    const userId =
      (await AsyncStorage.getItem("user_id")) ||
      (await AsyncStorage.getItem("id"));
    const conversationId =
      rawJob?.conversation_id ||
      rawJob?.conversationId ||
      event?.raw?.conversation_id ||
      event?.raw?.conversationId ||
      rawJob?.chat_id ||
      event?.raw?.chat_id;
    const targetNannyId = sitterId ? String(sitterId) : "";
    if (!targetNannyId) {
      const msg = "No Syttr is assigned to this booking yet.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Message Syttr", msg);
      return;
    }
    const payload = {
      conversationId,
      nannyId: targetNannyId,
      userId: userId || undefined,
      name: sitterName || "Syttr",
    };
    if (onMessageSyttr) {
      onMessageSyttr(payload);
      return;
    }
    navigation?.navigate?.("ClientChat", payload);
  };

  const handleViewSyttrProfile = () => {
    if (skipNextProfileOpen) {
      setSkipNextProfileOpen(false);
      return;
    }
    const targetNannyId = sitterId ? String(sitterId) : "";
    if (!targetNannyId) return;
    const payload = {
      nannyId: targetNannyId,
      name: sitterName || "Syttr",
    };
    if (onViewSyttrProfile) {
      onViewSyttrProfile(payload);
      return;
    }
    navigation?.navigate?.("NannyProfile", payload);
  };

  const handleViewApplicantProfile = (applicant: ApplicantCard) => {
    if (skipNextProfileOpen) {
      setSkipNextProfileOpen(false);
      return;
    }
    const targetNannyId =
      applicant?.id !== undefined && applicant?.id !== null
        ? String(applicant.id).trim()
        : "";
    if (!targetNannyId) return;
    const payload = {
      nannyId: targetNannyId,
      name: applicant?.name || "Syttr",
    };
    if (onViewSyttrProfile) {
      onViewSyttrProfile(payload);
      return;
    }
    navigation?.navigate?.("NannyProfile", payload);
  };

  const submitApplicantDecision = async (
    applicant: ApplicantCard,
    decision: "accept" | "reject"
  ) => {
    if (isParentInitiatedHireRequest) {
      const message = "For parent-initiated hire requests, you cannot accept/reject here. Please cancel the job instead.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Hire Request", message);
      return;
    }

    const target = resolveApplicantDecisionTarget(applicant);
    if (!target.applicationId) {
      const message = "Application ID missing for this request.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Request", message);
      return;
    }
    if (decisionLoading) return;
    try {
      setDecisionLoading({ applicationId: target.applicationId, decision });
      const [tokenRaw, userId, apiKey] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("api_key"),
      ]);
      if (!userId) {
        if (Platform.OS === "web") window.alert("User ID missing. Please login again.");
        else Alert.alert("Request", "User ID missing. Please login again.");
        return;
      }
      const token = normalizeTokenValue(tokenRaw || undefined);
      const endpoint = decision === "accept" ? "accept" : "reject";
      const res = await fetch(
        `${BASE_URL}job-requests/${target.applicationId}/${endpoint}`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
          body: JSON.stringify({ user_id: userId }),
        }
      );
      const raw = await res.text();
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }
      if (!res.ok || json?.success === false) {
        throw new Error(json?.message || raw || "Unable to update request.");
      }
      const nextStatus = decision === "accept" ? "accepted" : "rejected";
      const updatedAt = new Date().toISOString();
      setDetailBundle((prev) => {
        if (!prev) return prev;
        const patchedBundleApplications = patchApplicationStatusInList(
          prev.applications,
          target.applicationId,
          nextStatus,
          updatedAt
        );
        const patchedJobApplications = patchApplicationStatusInList(
          prev.job?.applications,
          target.applicationId,
          nextStatus,
          updatedAt
        );
        return {
          ...prev,
          applications: patchedBundleApplications,
          job: prev.job
            ? {
                ...prev.job,
                applications: patchedJobApplications,
                ...(decision === "accept"
                  ? { status: "accepted", job_status: "accepted" }
                  : null),
              }
            : prev.job,
        };
      });
      setDetailJob((prev: any) => {
        const base = prev || rawJob;
        if (!base || typeof base !== "object") return prev;
        return {
          ...base,
          applications: patchApplicationStatusInList(
            base?.applications,
            target.applicationId,
            nextStatus,
            updatedAt
          ),
          application: patchApplicationStatusInList(
            base?.application,
            target.applicationId,
            nextStatus,
            updatedAt
          ),
          ...(decision === "accept"
            ? { status: "accepted", job_status: "accepted", application_status: "accepted" }
            : null),
        };
      });
      const successMessage =
        decision === "accept" ? "Request accepted." : "Request rejected.";
      if (Platform.OS === "web") window.alert(successMessage);
      else Alert.alert("Success", successMessage);
    } catch (e: any) {
      if (isVerificationRequiredApiError(e)) {
        onRequireVerification?.();
        return;
      }
      const message = e?.message || "Unable to update request.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Request", message);
    } finally {
      setDecisionLoading(null);
    }
  };

  const handleApplicantDecisionLongPress = (applicant: ApplicantCard) => {
    if (isParentInitiatedHireRequest) {
      const message = "For parent-initiated hire requests, you cannot accept/reject here. Please cancel the job instead.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Hire Request", message);
      return;
    }

    const target = resolveApplicantDecisionTarget(applicant);
    if (!target.applicationId) {
      const message = "No actionable request found for this Syttr.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Request", message);
      return;
    }
    if (isFinalApplicationStatus(target.statusRaw)) {
      const label = normalizeStatus(target.statusRaw).label;
      const message = `This request is already ${label}.`;
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Request", message);
      return;
    }
    setSkipNextProfileOpen(true);
    const displayName = applicant?.name || "this Syttr";
    if (Platform.OS === "web") {
      const choice = String(
        window.prompt(
          `Type "accept" or "reject" for ${displayName}'s request.`,
          "accept"
        ) || ""
      )
        .trim()
        .toLowerCase();
      if (choice === "accept") {
        void submitApplicantDecision(applicant, "accept");
      } else if (choice === "reject") {
        void submitApplicantDecision(applicant, "reject");
      }
      return;
    }
    Alert.alert("Nanny Request", `Update ${displayName}'s request`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reject",
        style: "destructive",
        onPress: () => void submitApplicantDecision(applicant, "reject"),
      },
      {
        text: "Accept",
        onPress: () => void submitApplicantDecision(applicant, "accept"),
      },
    ]);
  };

  const updateJobStatus = async (
    action: "complete" | "cancel",
    reason?: string,
    confirmLateFee?: boolean
  ) => {
    if (!jobId) {
      if (Platform.OS === "web") {
        window.alert("Job ID missing.");
      } else {
        Alert.alert("Job", "Job ID missing.");
      }
      return;
    }
    if (savingStatus) return;
    try {
      setSavingStatus(true);
      const userId =
        (await AsyncStorage.getItem("user_id")) ||
        (await AsyncStorage.getItem("id"));
      if (!userId) {
        if (Platform.OS === "web") {
          window.alert("User ID missing.");
        } else {
          Alert.alert("Job", "User ID missing.");
        }
        return;
      }
      const numericUserId = Number(userId);
      const payload: Record<string, any> = {
        job_id: Number(jobId),
        booking_id: String(jobId),
        user_id: Number.isFinite(numericUserId) ? numericUserId : userId,
      };
      if (action === "cancel") {
        payload.reason = reason || "Plans changed";
        payload.cancel_reason = payload.reason;
      }
      const [tokenRaw, accessTokenRaw] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("access_token"),
      ]);
      const cleanToken = normalizeTokenValue(tokenRaw || accessTokenRaw);
      const apiKey =
        (await AsyncStorage.getItem("api_key")) ||
        getRuntimeApiKey() ||
        undefined;

      if (action === "cancel") {
        const ownerId = String(rawJob?.user_id ?? detailBundle?.job?.user_id ?? "").trim();
        const currentUserId = String(userId || "").trim();
        if (ownerId && currentUserId && ownerId !== currentUserId) {
          if (Platform.OS === "web") {
            window.alert("Unauthorized: this job belongs to another parent account.");
          } else {
            Alert.alert("Unauthorized", "This job belongs to another parent account.");
          }
          return;
        }
      }

      const primaryEndpoint =
        action === "cancel" ? "jobs/update-status" : "job/update-status";
      const fallbackEndpoint =
        action === "cancel" ? "job/cancel-booking" : "job/status";
      const requestPayload: Record<string, any> = (() => {
        if (action === "cancel") {
          return {
            job_id: Number(jobId),
            user_id: Number.isFinite(Number(userId)) ? Number(userId) : userId,
            reason: reason || "Plans changed",
            ...(confirmLateFee ? { confirm_late_fee: true } : {}),
          };
        }
        return {
          ...payload,
          id: Number(jobId),
          status: "completed",
        };
      })();

      const callUpdate = async (endpoint: string) => {
        try {
          const data: any = await apiRequest(endpoint, {
            method: "POST",
            headers: {
              ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
              ...(apiKey ? { "x-api-key": apiKey } : {}),
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify(requestPayload),
          });
          return {
            ok: data?.success !== false,
            status: 200,
            message: data?.message || "",
            data,
            verificationRequired: false,
          };
        } catch (error: any) {
          return {
            ok: false,
            status: Number(error?.status || 0),
            message: String(error?.message || ""),
            data: error?.payload ?? null,
            verificationRequired: isVerificationRequiredApiError(error),
          };
        }
      };

      const primaryResult = await callUpdate(primaryEndpoint);
      const secondaryResult = primaryResult.ok ? null : await callUpdate(fallbackEndpoint);

      if (primaryResult.verificationRequired || secondaryResult?.verificationRequired) {
        onRequireVerification?.();
        return;
      }

      const lateFeeCandidate = [secondaryResult, primaryResult].find(
        (result) => result && result.status === 409 && result.data?.requires_confirmation
      );
      if (action === "cancel" && lateFeeCandidate && !confirmLateFee) {
        const lateFeeAmount = Number(
          lateFeeCandidate?.data?.late_cancellation_fee ??
            lateFeeCandidate?.data?.data?.late_cancellation_fee ??
            0
        );
        const lateFeeMessage =
          lateFeeAmount > 0
            ? `Late cancellation fee: $${lateFeeAmount.toFixed(2)} (5% of the total job cost) will be charged if you continue.`
            : "Late cancellation fee: 5% of the total job cost will be charged if you continue.";
        if (Platform.OS === "web") {
          const ok = window.confirm(lateFeeMessage);
          if (!ok) {
            setSavingStatus(false);
            return;
          }
          await updateJobStatus("cancel", reason, true);
          return;
        }
        Alert.alert("Late Cancellation", lateFeeMessage, [
          { text: "Keep Job", style: "cancel", onPress: () => setSavingStatus(false) },
          {
            text: "Continue",
            style: "destructive",
            onPress: () => {
              void updateJobStatus("cancel", reason, true);
            },
          },
        ]);
        return;
      }

      const successfulResult = primaryResult.ok ? primaryResult : secondaryResult;
      const succeeded = !!successfulResult?.ok;
      const failureMessage =
        secondaryResult?.message ||
        primaryResult.message ||
        "Request failed.";

      if (!succeeded) {
        if (Platform.OS === "web") window.alert(failureMessage);
        else Alert.alert("Job", failureMessage);
        return;
      }
      const updatedJob =
        successfulResult?.data?.data?.job ||
        successfulResult?.data?.job ||
        null;
      if (updatedJob) {
        setDetailJob(updatedJob);
        setDetailBundle((prev) =>
          prev
            ? {
                ...prev,
                job: updatedJob,
              }
            : {
                job: updatedJob,
                kids: Array.isArray(updatedJob?.kids) ? updatedJob.kids : [],
                parent: undefined,
                nannies: Array.isArray(updatedJob?.nannies) ? updatedJob.nannies : [],
                applications: Array.isArray(updatedJob?.applications) ? updatedJob.applications : [],
              }
        );
      } else {
        void refreshJobDetails();
      }
      if (action === "cancel") {
        const stored = await AsyncStorage.getItem("canceled_job_ids");
        const list = Array.isArray(stored ? JSON.parse(stored) : []) ? JSON.parse(stored || "[]") : [];
        const next = Array.from(new Set([...list, String(jobId)]));
        await AsyncStorage.setItem("canceled_job_ids", JSON.stringify(next));
      }
      if (Platform.OS === "web") {
        window.alert(action === "complete" ? "Job completed." : "Booking canceled.");
        if (onBack) onBack();
        else navigation?.goBack?.();
      } else {
        Alert.alert(
          "Success",
          action === "complete" ? "Job completed." : "Booking canceled.",
          [
            {
              text: "OK",
              onPress: () => {
                if (onBack) onBack();
                else navigation?.goBack?.();
              },
            },
          ]
        );
      }
    } catch (e: any) {
      if (isVerificationRequiredApiError(e)) {
        onRequireVerification?.();
        return;
      }
      if (Platform.OS === "web") {
        window.alert(e?.message || "Something went wrong.");
      } else {
        Alert.alert("Job", e?.message || "Something went wrong.");
      }
    } finally {
      setSavingStatus(false);
    }
  };

  const submitExtraHoursRequest = async () => {
    const requestedEndDate = resolveMeridiemAwareTime(extraHoursValue, currentEndTimeDate);
    const requestedEndTime = requestedEndDate ? formatTime24(requestedEndDate) : "";
    const currentEnd = String(currentEndTimeValue || "").trim();
    const currentDate = parseTimeStringToDate(currentEnd);
    const requestedDate = requestedEndDate;
    if (!requestedDate) {
      const message = "Enter a valid end time.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Extra Hours", message);
      return;
    }
    if (currentDate && requestedDate.getTime() <= currentDate.getTime()) {
      const message = "Requested end time must be later than the current end time.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Extra Hours", message);
      return;
    }
    const parsedHours =
      currentDate
        ? Math.round(((requestedDate.getTime() - currentDate.getTime()) / 3600000) * 100) / 100
        : null;
    if (!jobId) {
      const message = "Booking ID missing.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Extra Hours", message);
      return;
    }
    if (requestingExtraHours) return;

    try {
      setRequestingExtraHours(true);
      const [userId, tokenRaw, apiKeyRaw] = await Promise.all([
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("api_key"),
      ]);
      if (!userId) {
        throw new Error("User ID missing. Please login again.");
      }
      const token = normalizeTokenValue(tokenRaw || undefined);
      const apiKey = String(apiKeyRaw || "").trim() || getRuntimeApiKey() || undefined;
      const json = await apiRequest<any>("bookings/extra-hours/request", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({
          user_id: userId,
          job_id: Number(jobId),
          ...(parsedHours !== null ? { hours: parsedHours } : {}),
          requested_end_time: requestedEndTime,
        }),
      });
      if (json?.success === false) {
        throw new Error(json?.message || "Unable to send extra hours request.");
      }
      setPendingExtraHours(parsedHours);
      setExtraHoursModalVisible(false);
      setExtraHoursValue("");
      if (Platform.OS === "web") {
        window.alert("Extra hours request sent to your Syttr.");
      } else {
        Alert.alert("Extra Hours", "Request sent to your Syttr.");
      }
    } catch (e: any) {
      if (isVerificationRequiredApiError(e)) {
        onRequireVerification?.();
        return;
      }
      const message = e?.message || "Unable to send extra hours request.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Extra Hours", message);
    } finally {
      setRequestingExtraHours(false);
    }
  };

  const confirmComplete = () => {
    if (!canComplete) {
      const message = "Job can be completed after it is accepted.";
      if (Platform.OS === "web") window.alert(message);
      else Alert.alert("Complete job", message);
      return;
    }
    if (Platform.OS === "web") {
      const ok = window.confirm("Mark this job as completed?");
      if (ok) updateJobStatus("complete");
      return;
    }
    Alert.alert("Complete job", "Mark this job as completed?", [
      { text: "Cancel", style: "cancel" },
      { text: "Complete", onPress: () => updateJobStatus("complete") },
    ]);
  };

  const confirmCancel = () => {
    if (Platform.OS === "web") {
      const reason = window.prompt("Reason for canceling?", "Plans changed") || "Plans changed";
      updateJobStatus("cancel", reason);
      return;
    }
    Alert.alert("Cancel booking", "Do you want to cancel this booking?", [
      { text: "No", style: "cancel" },
      { text: "Cancel booking", style: "destructive", onPress: () => updateJobStatus("cancel") },
    ]);
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#f9eecf", "#ffdbea"]}
        style={[
          styles.hero,
          {
            paddingTop: heroPadTop,
            paddingBottom: heroPadBottom,
            paddingHorizontal: heroPadHorizontal,
          },
        ]}
      >
        <View style={styles.heroTop}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              if (onBack) onBack();
              else navigation?.goBack?.();
            }}
          >
            <Ionicons name="chevron-back" size={18} color="#C2185B" />
          </TouchableOpacity>
          <Text style={styles.heroTitle}>Booking Details</Text>
          <View style={{ width: rs(32) }} />
        </View>

        <View style={[styles.heroCard, isLandscape && styles.heroCardCompact]}>
          <View>
            <Text style={styles.heroLabel}>Booking ID</Text>
            <Text style={styles.heroValue}>{bookingId}</Text>
          </View>

          <View style={[styles.heroRow, stackNarrow && styles.heroRowStack]}>
            <View style={[styles.statusPill, { backgroundColor: statusTone.bg }]}>
              <View style={[styles.statusDot, { backgroundColor: statusTone.dot }]} />
              <Text style={[styles.statusText, { color: statusTone.text }]}>
                {status}
              </Text>
            </View>

            <View style={[styles.totalPill, stackNarrow && styles.totalPillStack]}>
              <Text style={styles.totalPillLabel}>Total</Text>
              <Text style={styles.totalPillValue}>{totalLabel}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: contentTopPad, paddingHorizontal: contentHorizontal, paddingBottom: rs(30) },
        ]}
      >
        <View style={[styles.contentInner, { maxWidth: contentMaxWidth }]}>
        <View style={styles.summaryGrid}>
          <View style={[styles.summaryItem, { flexBasis: summaryBasis }]}>
            <SummaryPill icon="calendar-outline" label="Date" value={dateLabel} />
          </View>
          <View style={[styles.summaryItem, { flexBasis: summaryBasis }]}>
            <SummaryPill icon="time-outline" label="Time" value={timeLabel} />
          </View>
          <View style={[styles.summaryItem, { flexBasis: summaryBasis }]}>
            <SummaryPill icon="hourglass-outline" label="Hours" value={hoursLabel} />
          </View>
        </View>

        <SectionCard title={shouldShowAcceptedOnly ? "Syttr" : applicantCards.length > 1 ? "Applicants" : "Syttr"}>
          {applicantCards.length ? (
            <View style={{ gap: rs(10) }}>
              {applicantCards.map((applicant, index) => {
                const applicantId =
                  applicant?.id !== undefined && applicant?.id !== null
                    ? String(applicant.id).trim()
                    : "";
                const decisionTarget = resolveApplicantDecisionTarget(applicant);
                const canLongPressRespond =
                  canRespondToApplicants &&
                  !!decisionTarget.applicationId &&
                  !isFinalApplicationStatus(decisionTarget.statusRaw);
                const isRespondingThisCard =
                  !!decisionLoading &&
                  decisionLoading.applicationId === decisionTarget.applicationId;
                return (
                  <TouchableOpacity
                    key={`applicant-${applicantId || applicant.name}-${index}`}
                    activeOpacity={applicantId ? 0.75 : 1}
                    onPress={() => handleViewApplicantProfile(applicant)}
                    onLongPress={
                      canLongPressRespond
                        ? () => handleApplicantDecisionLongPress(applicant)
                        : undefined
                    }
                    delayLongPress={260}
                    disabled={!applicantId}
                    style={[
                      styles.profileRow,
                      stackVeryNarrow && styles.profileRowStack,
                      styles.applicantCard,
                    ]}
                  >
                    <View style={styles.avatar}>
                      {applicant.avatarUrl ? (
                        <Image source={{ uri: applicant.avatarUrl }} style={styles.avatarImage} />
                      ) : (
                        <Text style={styles.avatarText}>
                          {(applicant.name || "SY").slice(0, 2).toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View style={styles.profileTextWrap}>
                      <Text numberOfLines={1} style={styles.profileName}>
                        {applicant.name}
                      </Text>
                      {applicant.statusLabel ? (
                        <Text numberOfLines={1} style={styles.profileMeta}>
                          Status: {applicant.statusLabel}
                        </Text>
                      ) : null}
                      {isRespondingThisCard ? (
                        <Text numberOfLines={1} style={styles.profileMeta}>
                          {decisionLoading?.decision === "accept"
                            ? "Accepting request..."
                            : "Rejecting request..."}
                        </Text>
                      ) : canLongPressRespond ? (
                        <Text numberOfLines={1} style={styles.profileHint}>
                          Long press to accept or reject request
                        </Text>
                      ) : null}
                    </View>
                    {!!applicantId ? (
                      <Ionicons name="chevron-forward" size={16} color="#C2185B" />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <TouchableOpacity
              activeOpacity={sitterId ? 0.75 : 1}
              onPress={handleViewSyttrProfile}
              onLongPress={
                !canRespondToApplicants
                  ? undefined
                  : () =>
                      handleApplicantDecisionLongPress({
                        id: sitterId,
                        name: sitterName,
                        avatarUrl: sitterAvatar || undefined,
                      })
              }
              delayLongPress={260}
              disabled={!sitterId}
              style={[styles.profileRow, stackVeryNarrow && styles.profileRowStack]}
            >
              <View style={styles.avatar}>
                {sitterAvatar ? (
                  <Image source={{ uri: sitterAvatar }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>
                    {(sitterName || "SY").slice(0, 2).toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={styles.profileTextWrap}>
                <Text numberOfLines={1} style={styles.profileName}>
                  {sitterName}
                </Text>
              </View>
              {!!sitterId ? (
                <Ionicons name="chevron-forward" size={16} color="#C2185B" />
              ) : null}
            </TouchableOpacity>
          )}
        </SectionCard>

        {displayKids.length ? (
          <SectionCard title="Children">
            <View style={{ gap: rs(10) }}>
              {displayKids.map((kid, idx) => {
                const meta = formatKidMeta(kid);
                const hasDetails =
                  !!kid.name ||
                  !!meta ||
                  !!kid.allergies ||
                  !!kid.medical_conditions ||
                  !!kid.notes;
                if (!hasDetails) return null;
                return (
                  <View key={`${kid.name || "child"}-${idx}`} style={[styles.childRow, stackVeryNarrow && styles.childRowStack]}>
                    <View style={styles.childIcon}>
                      <Ionicons name="happy" size={18} color="#C2185B" />
                    </View>
                    <View style={styles.childTextWrap}>
                      {kid.name ? (
                        <Text style={styles.childName}>{kid.name}</Text>
                      ) : null}
                      {meta ? (
                        <Text style={styles.childMeta}>{meta}</Text>
                      ) : null}
                      {kid.allergies ? (
                        <Text style={styles.childMeta}>Allergies: {kid.allergies}</Text>
                      ) : null}
                      {kid.medical_conditions ? (
                        <Text style={styles.childMeta}>Medical: {kid.medical_conditions}</Text>
                      ) : null}
                      {kid.notes ? (
                        <Text style={styles.childMeta}>Notes: {kid.notes}</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </SectionCard>
        ) : null}

        <SectionCard title="Location">
          <View style={styles.locationRow}>
            <Ionicons name="location" size={16} color="#C2185B" />
            <Text style={styles.locationText}>{location}</Text>
          </View>
          {region ? (
            <View style={styles.mapWrap}>
              <MapView
                style={[styles.map, { height: mapHeight }]}
                region={region}
                provider={PROVIDER_GOOGLE}
                webQuery={location || undefined}
              >
                <Marker
                  coordinate={{ latitude: region.latitude, longitude: region.longitude }}
                  title="Booking location"
                  description={location}
                />
              </MapView>
            </View>
          ) : null}
        </SectionCard>

        <SectionCard title="Payment">
          <View style={[styles.paymentRow, stackNarrow && styles.paymentRowStack]}>
            <View>
              <Text style={styles.paymentLabel}>Rate</Text>
              <Text style={styles.paymentValue}>{rateLabel}</Text>
            </View>
            <View style={stackNarrow ? styles.paymentTotalBlockStack : undefined}>
              <Text style={styles.paymentLabel}>Total</Text>
              <Text style={styles.paymentTotal}>{totalLabel}</Text>
            </View>
          </View>
          {pendingExtraHours ? (
            <Text style={styles.inlineNotice}>
              Pending request: +{pendingExtraHours} hour(s) awaiting Syttr approval.
            </Text>
          ) : null}
          {canRequestExtraHours ? (
            <TouchableOpacity
              style={[styles.secondaryBtn, { marginTop: rs(12) }, requestingExtraHours && styles.actionDisabled]}
              onPress={() => {
                setExtraHoursPickerDraft(currentEndTimeDate);
                setExtraHoursValue(currentEndTimeValue ? formatTime12(currentEndTimeDate) : "");
                setExtraHoursPickerVisible(false);
                setExtraHoursModalVisible(true);
              }}
              disabled={requestingExtraHours}
            >
              <Ionicons name="time-outline" size={16} color="#C2185B" />
              <Text style={styles.secondaryText}>Request More Hours</Text>
            </TouchableOpacity>
          ) : null}
        </SectionCard>

        <SectionCard title="All Details">
          <View style={styles.detailsBlock}>
            <DetailRow label="Job Hours" value={detailBundle?.job?.hours ?? rawJob?.hours} />
            <DetailRow label="Location" value={detailBundle?.job?.location ?? rawJob?.location} />
            <DetailRow
              label="Start Date"
              value={formatDisplayDate(detailBundle?.job?.start_date ?? rawJob?.start_date)}
            />
            <DetailRow
              label="Start Time"
              value={formatDisplayTime(detailBundle?.job?.start_time ?? rawJob?.start_time)}
            />
            <DetailRow
              label="End Time"
              value={formatDisplayTime(detailBundle?.job?.end_time ?? rawJob?.end_time)}
            />

            <Text style={[styles.detailGroupTitle, { marginTop: rs(14) }]}>Kids</Text>
            {detailKids.length ? (
              detailKids.map((kid: any, index: number) => (
                <View key={`kid-full-${String(kid?.kid_id ?? kid?.id ?? "unknown")}-${index}`} style={styles.kidDetailCard}>
                  <DetailRow label="Name" value={kid?.kid_name ?? kid?.name} />
                  <DetailRow label="Age" value={kid?.age} />
                  <DetailRow label="Gender" value={kid?.gender} />
                  <DetailRow label="Allergies" value={kid?.allergies} />
                  <DetailRow label="Medical Conditions" value={kid?.medical_conditions} />
                  <DetailRow label="Notes" value={kid?.notes} />
                </View>
              ))
            ) : (
              <Text style={styles.detailValue}>No kids data</Text>
            )}

            <Text style={[styles.detailGroupTitle, { marginTop: rs(14) }]}>Syttrs</Text>
            {detailNannies.length ? (
              detailNannies.map((nanny: any, index: number) => (
                <View key={`nanny-full-${String(nanny?.nanny_id ?? nanny?.id ?? "unknown")}-${index}`} style={styles.kidDetailCard}>
                  <DetailRow label="Name" value={nanny?.fullname || nanny?.name} />
                  <DetailRow label="Experience" value={nanny?.experience !== undefined && nanny?.experience !== null ? `${nanny.experience} years` : "N/A"} />
                  <DetailRow label="Bio" value={nanny?.bio} />
                </View>
              ))
            ) : (
              <Text style={styles.detailValue}>No Syttr data</Text>
            )}

            
          </View>
        </SectionCard>

        {!isFinalStatus && (
          <>
            {canMessageSyttr ? (
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleMessageSyttr}>
                  <Ionicons name="chatbubble-ellipses" size={16} color="#fff" />
                  <Text style={styles.primaryText}>Message Syttr</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={[styles.actionRow, stackNarrow && styles.actionRowStack]}>
              {canComplete ? (
                <TouchableOpacity
                  style={[styles.primaryBtn, savingStatus && styles.actionDisabled]}
                  onPress={confirmComplete}
                  disabled={savingStatus}
                >
                  <Ionicons name="checkmark-circle" size={16} color="#fff" />
                  <Text style={styles.primaryText}>Complete Job</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.cancelBtn,
                  stackNarrow ? styles.actionBtnStackSpacing : styles.actionBtnInlineSpacing,
                  savingStatus && styles.actionDisabled,
                ]}
                onPress={confirmCancel}
                disabled={savingStatus}
              >
                <Ionicons name="close-circle" size={16} color="#C2185B" />
                <Text style={styles.cancelText}>Cancel Booking</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        </View>
      </ScrollView>

      <Modal
        visible={extraHoursModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!requestingExtraHours) setExtraHoursModalVisible(false);
        }}
      >
        <KeyboardAvoidingView
          style={styles.hoursModalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <TouchableOpacity
            style={styles.hoursModalBackdrop}
            activeOpacity={1}
            onPress={() => {
              if (!requestingExtraHours) setExtraHoursModalVisible(false);
            }}
          />
          <View style={styles.hoursModalCard}>
            <View style={styles.hoursModalHeader}>
              <Text style={styles.hoursModalTitle}>Request More Hours</Text>
              <TouchableOpacity
                style={styles.hoursModalCloseBtn}
                onPress={() => {
                  if (!requestingExtraHours) setExtraHoursModalVisible(false);
                }}
                disabled={requestingExtraHours}
              >
                <Ionicons name="close" size={18} color="#C2185B" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHelpText}>
              Choose the new booking end time. You can type `2:30` and the app will infer AM/PM from the current booking time.
            </Text>
            <Text style={styles.modalHelperLabel}>
              Current end time: {currentEndTimeValue ? formatTime12(currentEndTimeDate) : "N/A"}
            </Text>
            <TextInput
              value={extraHoursValue}
              onChangeText={(value) => setExtraHoursValue(value.replace(/[^0-9:\sAaPpMm]/g, "").slice(0, 8))}
              keyboardType="numbers-and-punctuation"
              placeholder="e.g. 2:30"
              placeholderTextColor="rgba(194,24,91,0.45)"
              style={styles.modalInput}
              editable={!requestingExtraHours}
              autoFocus
            />
            {Platform.OS !== "web" ? (
              <TouchableOpacity
                style={styles.timePickerBtn}
                onPress={() => {
                  setExtraHoursPickerDraft(resolvedExtraHoursDate);
                  setExtraHoursPickerVisible((prev) => !prev);
                }}
                disabled={requestingExtraHours}
              >
                <Ionicons name="time-outline" size={16} color="#C2185B" />
                <Text style={styles.timePickerBtnText}>Pick end time</Text>
              </TouchableOpacity>
            ) : null}
            {extraHoursPickerVisible && Platform.OS !== "web" ? (
              <View style={styles.inlinePickerCard}>
                <SpinnerTimePicker
                  visible
                  value={extraHoursPickerDraft || resolvedExtraHoursDate}
                  title="Select New End Time"
                  inline
                  onCancel={() => setExtraHoursPickerVisible(false)}
                  onConfirm={(value) => {
                    setExtraHoursPickerDraft(value);
                    setExtraHoursValue(formatTime12(value));
                    setExtraHoursPickerVisible(false);
                  }}
                />
              </View>
            ) : null}
            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={[styles.cancelBtn, styles.modalActionBtn]}
                onPress={() => {
                  setExtraHoursPickerVisible(false);
                  setExtraHoursModalVisible(false);
                }}
                disabled={requestingExtraHours}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, styles.modalActionBtn, requestingExtraHours && styles.actionDisabled]}
                onPress={submitExtraHoursRequest}
                disabled={requestingExtraHours}
              >
                {requestingExtraHours ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="send" size={16} color="#fff" />
                    <Text style={styles.primaryText}>Send Request</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function SummaryPill({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.summaryPill}>
      <Ionicons name={icon} size={16} color="#C2185B" />
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionDot} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: any }) {
  const { width } = useWindowDimensions();
  const stack = width <= 360;
  const display = value === null || value === undefined || value === "" ? "N/A" : String(value);
  return (
    <View style={[styles.detailRow, stack && styles.detailRowStack]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, stack && styles.detailValueStack]}>{display}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  hero: { paddingTop: rs(18), paddingHorizontal: rs(16), paddingBottom: rs(20) },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  backBtn: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    backgroundColor: "rgba(255,255,255,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#C2185B",
    fontFamily: "PlayfairDisplay",
  },
  heroCard: {
    marginTop: rs(16),
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: rs(18),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,182,193,0.6)",
  },
  heroCardCompact: {
    marginTop: rs(10),
  },
  heroLabel: {
    fontSize: rf(11),
    color: "#C77A00",
    textTransform: "uppercase",
    fontWeight: "700",
  },
  heroValue: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#C2185B",
    marginTop: rs(4),
  },
  heroRow: {
    marginTop: rs(12),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroRowStack: {
    flexWrap: "wrap",
    rowGap: rs(8),
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: rs(6),
    paddingHorizontal: rs(12),
    borderRadius: rs(16),
    gap: rs(6),
  },
  statusDot: {
    width: rs(8),
    height: rs(8),
    borderRadius: rs(4),
  },
  statusText: { fontSize: rf(12), fontWeight: "700" },
  totalPill: {
    backgroundColor: "#FFE4EC",
    paddingHorizontal: rs(12),
    paddingVertical: rs(6),
    borderRadius: rs(14),
    alignItems: "flex-end",
  },
  totalPillStack: {
    alignItems: "flex-start",
  },
  totalPillLabel: {
    fontSize: rf(10),
    color: "#C77A00",
    fontWeight: "700",
    textTransform: "uppercase",
  },
  totalPillValue: { fontSize: rf(14), color: "#C2185B", fontWeight: "700" },
  content: {
    alignItems: "center",
  },
  contentInner: {
    width: "100%",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: rs(4),
  },
  summaryItem: {
    marginBottom: rs(10),
  },
  summaryPill: {
    backgroundColor: "#FFF3F8",
    borderRadius: rs(14),
    paddingVertical: rs(12),
    paddingHorizontal: rs(10),
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.25)",
  },
  summaryLabel: {
    fontSize: rf(10),
    color: "#C77A00",
    fontWeight: "700",
    marginTop: rs(6),
    textTransform: "uppercase",
  },
  summaryValue: {
    fontSize: rf(12),
    color: "#C2185B",
    fontWeight: "700",
    marginTop: rs(4),
  },
  sectionCard: {
    marginTop: rs(14),
    backgroundColor: "#FFFDF8",
    borderRadius: rs(16),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "#FFE6A6",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: rs(10),
  },
  sectionDot: {
    width: rs(8),
    height: rs(8),
    borderRadius: rs(4),
    backgroundColor: "#FF80AB",
  },
  sectionTitle: {
    marginLeft: rs(8),
    fontSize: rf(14),
    fontWeight: "700",
    color: "#C2185B",
    fontFamily: "PlayfairDisplay",
  },
  applicantCard: {
    backgroundColor: "#FFF8FB",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    borderRadius: rs(12),
    padding: rs(10),
  },
  profileRow: { flexDirection: "row", alignItems: "center" },
  profileRowStack: { alignItems: "flex-start" },
  avatar: {
    width: rs(48),
    height: rs(48),
    borderRadius: rs(24),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: rs(24),
  },
  avatarText: { color: "#C2185B", fontWeight: "700" },
  profileTextWrap: { flex: 1, minWidth: 0, marginLeft: rs(12) },
  profileName: { fontSize: rf(15), fontWeight: "700", color: "#C2185B" },
  profileMeta: { fontSize: rf(12), color: "#C77A00", marginTop: rs(2) },
  profileHint: { fontSize: rf(11), color: "#7A5D18", marginTop: rs(4) },
  childRow: { flexDirection: "row", alignItems: "center" },
  childRowStack: { alignItems: "flex-start" },
  childIcon: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  childTextWrap: { flex: 1, minWidth: 0, marginLeft: rs(10) },
  childName: { fontSize: rf(14), fontWeight: "700", color: "#C2185B" },
  childMeta: { fontSize: rf(12), color: "#C77A00", marginTop: rs(2) },
  locationRow: { flexDirection: "row", alignItems: "center" },
  locationText: { fontSize: rf(12), color: "#C2185B", fontWeight: "600", marginLeft: rs(8), flex: 1 },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  paymentRowStack: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  paymentTotalBlockStack: {
    marginTop: rs(8),
  },
  paymentLabel: { fontSize: rf(11), color: "#C77A00", fontWeight: "700" },
  paymentValue: { fontSize: rf(14), color: "#C2185B", fontWeight: "700" },
  paymentTotal: { fontSize: rf(16), color: "#C2185B", fontWeight: "700" },
  inlineNotice: {
    marginTop: rs(10),
    fontSize: rf(12),
    color: "#8B5E00",
    fontWeight: "600",
  },
  actionRow: {
    flexDirection: "row",
    marginTop: rs(16),
    justifyContent: "space-between",
  },
  actionRowStack: {
    flexDirection: "column",
  },
  actionBtnStackSpacing: {
    marginTop: rs(8),
  },
  actionBtnInlineSpacing: {
    marginLeft: rs(10),
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: "#FF80AB",
    borderRadius: rs(14),
    paddingVertical: rs(12),
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: rf(13), marginLeft: rs(8) },
  secondaryBtn: {
    flex: 1,
    backgroundColor: "#FFE89A",
    borderRadius: rs(14),
    paddingVertical: rs(12),
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  secondaryText: { color: "#C2185B", fontWeight: "700", fontSize: rf(13) },
  cancelBtn: {
    flex: 1,
    backgroundColor: "#FFF1F1",
    borderRadius: rs(14),
    paddingVertical: rs(12),
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#F5B5C8",
  },
  cancelText: { color: "#C2185B", fontWeight: "700", fontSize: rf(13), marginLeft: rs(8) },
  actionDisabled: {
    opacity: 0.7,
  },
  detailsBlock: {
    marginTop: rs(2),
  },
  detailGroupTitle: {
    fontSize: rf(13),
    fontWeight: "700",
    color: "#C2185B",
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: rs(8),
  },
  detailRowStack: {
    flexDirection: "column",
  },
  detailLabel: {
    flex: 0.48,
    fontSize: rf(12),
    color: "#AD1457",
    fontWeight: "700",
  },
  detailValue: {
    flex: 0.52,
    fontSize: rf(12),
    color: "#C2185B",
    textAlign: "right",
  },
  detailValueStack: {
    flex: 1,
    width: "100%",
    textAlign: "left",
    marginTop: rs(2),
  },
  kidDetailCard: {
    borderWidth: 1,
    borderColor: "#FFE6A6",
    borderRadius: rs(10),
    padding: rs(8),
    marginTop: rs(4),
  },
  mapWrap: {
    marginTop: rs(12),
    borderRadius: rs(12),
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  map: { width: "100%", height: rs(220) },
  hoursModalOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: rs(18),
    backgroundColor: "rgba(79,42,50,0.28)",
  },
  hoursModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  hoursModalCard: {
    width: "100%",
    maxWidth: rs(340),
    backgroundColor: "#FFFDF8",
    borderRadius: rs(18),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.22)",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  hoursModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(8),
  },
  hoursModalTitle: {
    flex: 1,
    fontSize: rf(16),
    fontWeight: "800",
    color: "#C2185B",
  },
  hoursModalCloseBtn: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1F1",
    borderWidth: 1,
    borderColor: "#F5B5C8",
    marginLeft: rs(10),
  },
  modalHelpText: {
    color: "#8B5E00",
    fontSize: rf(12),
    marginBottom: rs(10),
  },
  modalHelperLabel: {
    color: "#C2185B",
    fontSize: rf(12),
    fontWeight: "700",
    marginBottom: rs(8),
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.3)",
    borderRadius: rs(12),
    paddingHorizontal: rs(12),
    paddingVertical: rs(10),
    color: "#C2185B",
    fontSize: rf(14),
    fontWeight: "600",
    marginBottom: rs(12),
  },
  timePickerBtn: {
    marginBottom: rs(12),
    borderWidth: 1,
    borderColor: "#F5B5C8",
    borderRadius: rs(12),
    paddingVertical: rs(10),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
    backgroundColor: "#FFF4F8",
  },
  timePickerBtnText: {
    color: "#C2185B",
    fontSize: rf(13),
    fontWeight: "700",
  },
  inlinePickerCard: {
    marginBottom: rs(12),
  },
  modalActionRow: {
    flexDirection: "row",
    gap: rs(10),
  },
  modalActionBtn: {
    flex: 1,
  },
});
