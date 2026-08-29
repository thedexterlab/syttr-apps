import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hp, rf, rs } from "../utils/responsive";
import { useManageChildStore } from "../Pages/manageChildStore";
import { geocodeAddress } from "../utils/geocodeAddress";
import { formatDateToMDY } from "../utils/dateFormat";
import SpinnerTimePicker from "./SpinnerTimePicker";
import {
  addFavoriteSyttr,
  apiRequest,
  GOOGLE_MAPS_KEY,
  getNannyRatingSummary,
  getRuntimeApiKey,
  isVerificationRequiredApiError,
  removeFavoriteSyttr,
} from "../Api";
import { resolveSessionImageUrl } from "../../lib/nannySessionProfile";

/* ----------------------------- TYPES ----------------------------- */

type Child = {
  id: number;
  name: string;
  gender?: string;
  age?: number;
};

type AvailabilitySlot = {
  period?: string;
  time?: string;
  start_time?: string;
  end_time?: string;
};

type AvailabilityDay = {
  day: string;
  slots?: AvailabilitySlot[];
};

type LocationSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

type HireRequestDraft = {
  selectedDate?: string;
  selectedTime?: string;
  selectedEndTime?: string;
  hireHours?: string;
  endTimeEdited?: boolean;
  locationLabel?: string;
  selectedChildIds?: number[];
};

type RatingReview = {
  id?: string | number;
  rating?: number | null;
  review?: string | null;
  parent_name?: string | null;
  reviewed_at?: string | null;
};

type ProfileSectionKey = "about" | "availability" | "reviews";

const formatSlotLabel = (slot?: AvailabilitySlot) => {
  if (!slot) return "";
  const time = String(slot.time || slot.start_time || "").trim();
  const period = String(slot.period || "").trim();
  if (!time) return period;
  if (/\b(AM|PM)\b/i.test(time)) return time;
  return [period, time].filter(Boolean).join(" • ");
};

const getAvailabilitySlotStartDate = (slot?: AvailabilitySlot) => {
  const label = formatSlotLabel(slot);
  return parseDisplayTimeToDate(label);
};

const getAvailabilitySlotEndDate = (slot?: AvailabilitySlot) => {
  const explicitEnd = parseDisplayTimeToDate(String(slot?.end_time || "").trim());
  if (explicitEnd) return explicitEnd;

  const start = getAvailabilitySlotStartDate(slot);
  if (!start) return null;
  return new Date(start.getTime() + 60 * 60 * 1000);
};

const formatRangeLabel = (start: Date, end: Date) => {
  const startLabel = formatDisplayTime(start);
  const endLabel = formatDisplayTime(end);
  if (!startLabel) return "";
  if (!endLabel) return startLabel;
  return `${startLabel}-${endLabel}`;
};

const buildAvailabilityDisplayGroups = (slots: AvailabilitySlot[]) => {
  const sorted = [...(slots || [])]
    .map((slot) => ({
      slot,
      start: getAvailabilitySlotStartDate(slot),
      end: getAvailabilitySlotEndDate(slot),
      rawLabel: formatSlotLabel(slot),
    }))
    .filter((item) => item.start && item.end && item.rawLabel)
    .sort((a, b) => a.start!.getTime() - b.start!.getTime());

  if (!sorted.length) {
    return (slots || [])
      .map((slot) => formatSlotLabel(slot))
      .filter(Boolean)
      .map((label) => ({ label }));
  }

  const groups: Array<{ label: string }> = [];
  let currentStart = sorted[0].start as Date;
  let currentEnd = sorted[0].end as Date;

  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index];
    const nextStart = next.start as Date;
    const nextEnd = next.end as Date;

    if (nextStart.getTime() === currentEnd.getTime()) {
      currentEnd = nextEnd;
      continue;
    }

    groups.push({ label: formatRangeLabel(currentStart, currentEnd) });
    currentStart = nextStart;
    currentEnd = nextEnd;
  }

  groups.push({ label: formatRangeLabel(currentStart, currentEnd) });
  return groups.filter((item) => item.label);
};

type RateCard = {
  rate?: string | number;
  hourly_rate?: string | number;
  hourlyRate?: string | number;
  price?: string | number;
  amount?: string | number;
  pay_rate?: string | number;
  rate_per_hour?: string | number;
  nanny_hourly_rate?: string | number;
};

const getMinuteMarks = (size: number) => {
  const radius = size * 0.39;
  const center = size / 2;
  const marks = [];
  for (let i = 0; i < 60; i += 5) {
    const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
    const x = center + radius * Math.cos(angle) - size * 0.073;
    const y = center + radius * Math.sin(angle) - size * 0.073;
    marks.push({ value: i, x, y });
  }
  return marks;
};

const getHourMarks = (size: number) => {
  const radius = size * 0.318;
  const center = size / 2;
  const marks = [];
  for (let i = 1; i <= 12; i += 1) {
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
    const x = center + radius * Math.cos(angle) - size * 0.073;
    const y = center + radius * Math.sin(angle) - size * 0.073;
    marks.push({ value: i, x, y });
  }
  return marks;
};

const normalizeAddressPart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const dedupeAddressParts = (parts: Array<string | null | undefined>) => {
  const dedupedRaw: string[] = [];
  const dedupedNorm: string[] = [];

  for (const part of parts) {
    const raw = String(part || "").trim();
    if (!raw) continue;

    const normalized = normalizeAddressPart(raw);
    if (!normalized) continue;

    const duplicateIndex = dedupedNorm.findIndex(
      (seen) => seen === normalized || seen.includes(normalized) || normalized.includes(seen)
    );

    if (duplicateIndex === -1) {
      dedupedRaw.push(raw);
      dedupedNorm.push(normalized);
      continue;
    }

    if (normalized.length > dedupedNorm[duplicateIndex].length) {
      dedupedRaw[duplicateIndex] = raw;
      dedupedNorm[duplicateIndex] = normalized;
    }
  }

  return dedupedRaw.join(", ");
};

const sanitizeLocationLabel = (value: string) =>
  dedupeAddressParts(String(value || "").split(","));

const LOCATION_AUTOCOMPLETE_DEBOUNCE_MS = 280;
const LOCATION_AUTOCOMPLETE_LIMIT = 5;

const fetchLocationSuggestions = async (query: string): Promise<LocationSuggestion[]> => {
  if (!GOOGLE_MAPS_KEY) return [];
  const trimmed = String(query || "").trim();
  if (trimmed.length < 2) return [];

  try {
    const buildUrl = (types?: string) =>
      "https://maps.googleapis.com/maps/api/place/autocomplete/json?input=" +
      `${encodeURIComponent(trimmed)}` +
      "&language=en&components=country:us" +
      (types ? `&types=${encodeURIComponent(types)}` : "") +
      `&key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`;

    const addressRes = await fetch(buildUrl("address"), { headers: { Accept: "application/json" } });
    if (!addressRes.ok) return [];
    const addressJson = await addressRes.json().catch(() => null);
    let predictions = Array.isArray(addressJson?.predictions) ? addressJson.predictions : [];

    if (predictions.length === 0) {
      const geocodeRes = await fetch(buildUrl("geocode"), { headers: { Accept: "application/json" } });
      if (geocodeRes.ok) {
        const geocodeJson = await geocodeRes.json().catch(() => null);
        predictions = Array.isArray(geocodeJson?.predictions) ? geocodeJson.predictions : [];
      }
    }

    return predictions
      .slice(0, LOCATION_AUTOCOMPLETE_LIMIT)
      .map((item: any) => ({
        placeId: String(item?.place_id || ""),
        description: String(item?.description || "").trim(),
        mainText: String(item?.structured_formatting?.main_text || item?.description || "").trim(),
        secondaryText: String(item?.structured_formatting?.secondary_text || "").trim(),
      }))
      .filter((item: LocationSuggestion) => item.placeId && item.description);
  } catch {
    return [];
  }
};

const fetchLocationDetails = async (placeId: string) => {
  if (!GOOGLE_MAPS_KEY || !placeId) return null;
  try {
    const url =
      "https://maps.googleapis.com/maps/api/place/details/json?place_id=" +
      `${encodeURIComponent(placeId)}` +
      "&fields=formatted_address,geometry" +
      `&key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const result = json?.result;
    const latitude = Number(result?.geometry?.location?.lat);
    const longitude = Number(result?.geometry?.location?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      formattedAddress: String(result?.formatted_address || "").trim(),
    };
  } catch {
    return null;
  }
};

const formatIsoDateLabel = (value: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(parsed.getTime())) return raw;
  const weekday = parsed.toLocaleDateString("en-US", { weekday: "short" }).replace(/\.$/, "");
  const month = parsed.toLocaleDateString("en-US", { month: "short" });
  return `${weekday}. ${month} ${parsed.getDate()}, ${parsed.getFullYear()}`;
};

const parseDisplayTimeToDate = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const period = String(match[3] || "").toUpperCase();

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;

  if (period === "PM" && hours < 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;

  const parsed = new Date(2000, 0, 1, hours, minutes, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDisplayTime = (value?: Date | null) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const hour24 = value.getHours();
  const minute = String(value.getMinutes()).padStart(2, "0");
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute} ${suffix}`;
};

const to24HourTime = (value?: string | null) => {
  const parsed = parseDisplayTimeToDate(value);
  if (!parsed) return "";
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
};

const buildDerivedEndTime = (startLabel?: string | null, hoursValue?: number | null) => {
  const start = parseDisplayTimeToDate(startLabel);
  if (!start || !Number.isFinite(hoursValue as number) || Number(hoursValue) <= 0) return "";
  const end = new Date(start.getTime() + Number(hoursValue) * 60 * 60 * 1000);
  return formatDisplayTime(end);
};

const calculateHoursBetweenDisplayTimes = (
  startLabel?: string | null,
  endLabel?: string | null
) => {
  const start = parseDisplayTimeToDate(startLabel);
  const end = parseDisplayTimeToDate(endLabel);
  if (!start || !end) return null;

  let diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) {
    diffMs += 24 * 60 * 60 * 1000;
  }

  const diffHours = diffMs / (60 * 60 * 1000);
  if (!Number.isFinite(diffHours) || diffHours <= 0) return null;
  return diffHours;
};

const formatDerivedHours = (hoursValue: number) => {
  if (!Number.isFinite(hoursValue) || hoursValue <= 0) return "";
  const rounded = Math.round(hoursValue * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const normalizeManualTimeInput = (value: string) => {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2})(?::(\d{1,2}))?\s*([AP]M)?$/i);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const period = (match[3] || "").toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59 || !period) return value;
  return `${hour}:${String(minute).padStart(2, "0")} ${period}`;
};

const formatPickerDateLabel = (value: Date) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const weekday = value.toLocaleDateString("en-US", { weekday: "short" }).replace(/\.$/, "");
  const month = value.toLocaleDateString("en-US", { month: "short" });
  return `${weekday}. ${month} ${value.getDate()}, ${value.getFullYear()}`;
};

type Nanny = {
  id: string | number;
  nanny_id?: string | number;
  fullname?: string;
  name?: string;
  city?: string;
  city_area?: string;
  country?: string;
  address?: string;
  gender?: string;
  phone?: string;
  bio?: string;
  age?: number;
  experience?: number | string | null;
  experience_years?: number | string | null;
  hourly_rate?: number | string | null;
  hourlyRate?: number | string | null;
  pay_rate?: number | string | null;
  rate_per_hour?: number | string | null;
  nanny_hourly_rate?: number | string | null;
  user_image?: string;
  user_image_url?: string;
  rating?: number;
  avg_rating?: number;
  profile_image?: string;
  availability?: AvailabilityDay[];
  rate_cards?: RateCard[];
  conversation_id?: number;
  total_reviews?: number | string;
  review_count?: number | string;
  jobs_count?: number | string;
  total_jobs?: number | string;
  raters_count?: number | string;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toLooseNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const extractHourlyRateValue = (profile?: Nanny | null): number | null => {
  if (!profile) return null;

  const directRate =
    toLooseNumberOrNull(profile.hourly_rate) ??
    toLooseNumberOrNull(profile.hourlyRate) ??
    toLooseNumberOrNull(profile.pay_rate) ??
    toLooseNumberOrNull(profile.rate_per_hour) ??
    toLooseNumberOrNull(profile.nanny_hourly_rate);
  if (directRate !== null && directRate > 0) return directRate;

  const firstRateCard = Array.isArray(profile.rate_cards) ? profile.rate_cards[0] : null;
  if (!firstRateCard) return null;

  return (
    toLooseNumberOrNull(firstRateCard.rate) ??
    toLooseNumberOrNull(firstRateCard.hourly_rate) ??
    toLooseNumberOrNull(firstRateCard.hourlyRate) ??
    toLooseNumberOrNull(firstRateCard.price) ??
    toLooseNumberOrNull(firstRateCard.amount) ??
    toLooseNumberOrNull(firstRateCard.pay_rate) ??
    toLooseNumberOrNull(firstRateCard.rate_per_hour) ??
    toLooseNumberOrNull(firstRateCard.nanny_hourly_rate)
  );
};

const mergeNannyPreservingRate = (
  incoming?: Nanny | null,
  fallback?: Nanny | null
): Nanny | null => {
  if (!incoming && !fallback) return null;
  if (!incoming) return fallback || null;
  if (!fallback) return incoming;

  const incomingRate = extractHourlyRateValue(incoming);
  if (incomingRate !== null && incomingRate > 0) return { ...fallback, ...incoming };

  return {
    ...fallback,
    ...incoming,
    hourly_rate:
      incoming.hourly_rate ??
      incoming.hourlyRate ??
      incoming.pay_rate ??
      incoming.rate_per_hour ??
      incoming.nanny_hourly_rate ??
      fallback.hourly_rate ??
      fallback.hourlyRate ??
      fallback.pay_rate ??
      fallback.rate_per_hour ??
      fallback.nanny_hourly_rate ??
      null,
    rate_cards:
      Array.isArray(incoming.rate_cards) && incoming.rate_cards.length > 0
        ? incoming.rate_cards
        : fallback.rate_cards,
  };
};

const sanitizeToken = (value?: string | null) =>
  String(value || "")
    .replace(/^Bearer\s+/i, "")
    .replace(/"/g, "")
    .trim();

const normalizeIdValue = (value: any): number | string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!text || text === "undefined" || text === "null") return undefined;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return text;
};

const formatRatingValue = (value: number) => (Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1));

const buildAvailabilityFromRows = (rows: any[]): AvailabilityDay[] => {
  const grouped = new Map<string, AvailabilitySlot[]>();
  rows.forEach((row: any) => {
    const dayKey = String(row?.day || row?.date || "").trim();
    if (!dayKey) return;
    const slot: AvailabilitySlot = {
      period: String(row?.period || "").trim(),
      time: String(row?.time || "").trim(),
    };
    if (!slot.time && !slot.period) return;
    const list = grouped.get(dayKey) || [];
    list.push(slot);
    grouped.set(dayKey, list);
  });
  return Array.from(grouped.entries()).map(([day, slots]) => ({ day, slots }));
};

const normalizeNanny = (raw: any): Nanny | null => {
  if (!raw || typeof raw !== "object") return null;

  const rawAvailability = Array.isArray(raw.availability)
    ? raw.availability
    : Array.isArray(raw.availabilities)
      ? raw.availabilities
      : [];

  const availability = rawAvailability
    .map((entry: any) => {
      if (!entry || typeof entry !== "object") return null;
      const day = String(entry?.day || entry?.date || "").trim();
      if (!day) return null;

      const rawSlots = Array.isArray(entry?.slots)
        ? entry.slots
        : Array.isArray(entry?.time_slots)
          ? entry.time_slots
          : entry?.time
            ? [{ period: entry?.period, time: entry?.time }]
            : [];

      const slots = rawSlots
        .map((slot: any) => ({
          period: String(slot?.period || "").trim(),
          time: String(slot?.time || "").trim(),
        }))
        .filter((slot: AvailabilitySlot) => !!slot.time || !!slot.period);

      return { day, slots };
    })
    .filter(Boolean) as AvailabilityDay[];

  const rateCards = Array.isArray(raw.rate_cards)
    ? raw.rate_cards
    : Array.isArray(raw.rateCards)
      ? raw.rateCards
      : raw?.hourly_rate !== undefined && raw?.hourly_rate !== null && String(raw.hourly_rate) !== ""
        ? [{ rate: raw.hourly_rate }]
        : [];

  return {
    ...raw,
    id: raw?.id ?? raw?.nanny_id ?? raw?.user_id,
    nanny_id: raw?.nanny_id ?? raw?.id ?? raw?.user_id,
    fullname: raw?.fullname || raw?.name || undefined,
    name: raw?.name || raw?.fullname || undefined,
    city: raw?.city || raw?.city_area || raw?.address || undefined,
    city_area: raw?.city_area || undefined,
    country: raw?.country || undefined,
    address: raw?.address || raw?.location || undefined,
    experience: raw?.experience ?? raw?.experience_years ?? null,
    experience_years: raw?.experience_years ?? raw?.experience ?? null,
    hourly_rate: raw?.hourly_rate ?? null,
    profile_image:
      raw?.profile_image ||
      raw?.user_image_url ||
      raw?.user_image ||
      undefined,
    user_image: raw?.user_image || undefined,
    user_image_url: raw?.user_image_url || undefined,
    rating: toNumberOrNull(raw?.rating ?? raw?.average_rating ?? raw?.avg_rating) ?? undefined,
    avg_rating: toNumberOrNull(raw?.avg_rating ?? raw?.average_rating ?? raw?.rating) ?? undefined,
    availability,
    rate_cards: rateCards,
  };
};

/* ----------------------------- CONFIG ----------------------------- */

const FAVORITES_KEY = "favorite_nannies";

type Props = {
  route?: any;
  navigation?: any;
  onBack?: () => void;
  onMessage?: (params: any) => void;
  onRequirePayment?: () => void;
  onRequireVerification?: () => void;
};

/* ----------------------------- SCREEN ----------------------------- */

export default function NannyProfileScreen({
  route,
  navigation,
  onBack,
  onMessage,
  onRequirePayment,
  onRequireVerification,
}: Props) {
  const { width, height } = useWindowDimensions();
  const isVerySmall = width <= 320;
  const isSmall = width <= 360;
  const isTablet = width >= 768;
  const isLandscape = width > height;
  const avatarSize = Math.min(isTablet ? width * 0.2 : width * 0.25, isTablet ? rs(130) : rs(110));
  const avatarInnerSize = Math.max(avatarSize - rs(4), rs(84));
  const calendarCellSize = Math.max(rs(28), Math.min(rs(40), (width - rs(70)) / 7));
  const narrowActions = width <= 340;
  const nannyId =
    route?.params?.id ||
    route?.params?.nanny?.id ||
    route?.params?.nanny?.nanny_id;
  const initialNanny: Nanny | null = normalizeNanny(route?.params?.nanny || null);

  const [nanny, setNanny] = useState<Nanny | null>(initialNanny);
  const [loading, setLoading] = useState(false);
  const [showHire, setShowHire] = useState(false);
  const [showChildrenModal, setShowChildrenModal] = useState(false);
  const [hireLoading, setHireLoading] = useState(false);
  const [hasPaymentMethod, setHasPaymentMethod] = useState(true);
  const [checkingPaymentMethod, setCheckingPaymentMethod] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [selectedEndTime, setSelectedEndTime] = useState<string>("");
  const [hireHours, setHireHours] = useState<string>("");
  const [endTimeEdited, setEndTimeEdited] = useState(false);
  const [locationLabel, setLocationLabel] = useState<string>("");
  const [geocodingLocation, setGeocodingLocation] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [loadingLocationSuggestions, setLoadingLocationSuggestions] = useState(false);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [restoreHireAfterPicker, setRestoreHireAfterPicker] = useState(false);
  const pickerTransitionRef = useRef(0);
  const [tempDate, setTempDate] = useState<Date>(new Date());
  const [monthCursor, setMonthCursor] = useState<Date>(new Date());
  const [selectedChildIds, setSelectedChildIds] = useState<number[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [ratingSummary, setRatingSummary] = useState<{
    average: number | null;
    totalReviews: number | null;
    jobsCount: number | null;
    ratersCount: number | null;
    reviews: RatingReview[];
  }>({ average: null, totalReviews: null, jobsCount: null, ratersCount: null, reviews: [] });
  const profileScrollRef = useRef<ScrollView | null>(null);
  const [activeProfileSection, setActiveProfileSection] = useState<ProfileSectionKey>("about");
  const [profileSectionOffsets, setProfileSectionOffsets] = useState<Record<ProfileSectionKey, number>>({
    about: 0,
    availability: 0,
    reviews: 0,
  });

  const { kids, loadChildren } = useManageChildStore(onRequireVerification);
  const displayName =
    String(route?.params?.name || "").trim() ||
    nanny?.fullname ||
    nanny?.name ||
    "Syttr";
  const publicLocationLabel = sanitizePublicLocation(
    nanny?.city || nanny?.city_area || nanny?.address || nanny?.country
  );
  const imagePath = nanny?.profile_image || nanny?.user_image_url || nanny?.user_image || "";
  const avatarUrl = resolveSessionImageUrl(imagePath);
  const hireDraftStorageKey = useMemo(() => {
    const targetNannyId = normalizeIdValue(nanny?.nanny_id || nanny?.id || nannyId);
    const targetUserId = normalizeIdValue(currentUserId);
    if (!targetNannyId || !targetUserId) return "";
    return `hire_request_draft:${targetUserId}:${targetNannyId}`;
  }, [currentUserId, nanny?.id, nanny?.nanny_id, nannyId]);

  useEffect(() => {
    if (endTimeEdited) return;
    setSelectedEndTime(buildDerivedEndTime(selectedTime, toLooseNumberOrNull(hireHours) ?? 0));
  }, [endTimeEdited, hireHours, selectedTime]);

  useEffect(() => {
    if (!selectedTime || !selectedEndTime) return;
    const derivedHours = calculateHoursBetweenDisplayTimes(selectedTime, selectedEndTime);
    if (derivedHours === null) return;
    const nextHours = formatDerivedHours(derivedHours);
    if (!nextHours || nextHours === hireHours) return;
    setHireHours(nextHours);
  }, [hireHours, selectedEndTime, selectedTime]);

  useEffect(() => {
    const query = String(locationLabel || "").trim();
    if (!showLocationSuggestions || query.length < 2 || !GOOGLE_MAPS_KEY) {
      setLocationSuggestions([]);
      setLoadingLocationSuggestions(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingLocationSuggestions(true);
      const next = await fetchLocationSuggestions(query);
      if (cancelled) return;
      setLocationSuggestions(next);
      setLoadingLocationSuggestions(false);
    }, LOCATION_AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [locationLabel, showLocationSuggestions]);

  useEffect(() => {
    let active = true;

    (async () => {
      const userId = normalizeIdValue(
        (await AsyncStorage.getItem("user_id")) || (await AsyncStorage.getItem("id"))
      );
      if (!active) return;
      setCurrentUserId(String(userId || ""));
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hireDraftStorageKey) return;

    let active = true;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(hireDraftStorageKey);
        if (!raw || !active) return;
        const draft: HireRequestDraft | null = JSON.parse(raw);
        if (!draft || typeof draft !== "object") return;

        setSelectedDate(String(draft.selectedDate || ""));
        setSelectedTime(String(draft.selectedTime || ""));
        setSelectedEndTime(String(draft.selectedEndTime || ""));
        setHireHours(String(draft.hireHours || ""));
        setEndTimeEdited(!!draft.endTimeEdited);
        setLocationLabel(String(draft.locationLabel || ""));
        setSelectedChildIds(
          Array.isArray(draft.selectedChildIds)
            ? draft.selectedChildIds
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value))
            : []
        );
      } catch {
        // ignore malformed drafts
      }
    })();

    return () => {
      active = false;
    };
  }, [hireDraftStorageKey]);

  useEffect(() => {
    if (!hireDraftStorageKey) return;

    const draft: HireRequestDraft = {
      selectedDate,
      selectedTime,
      selectedEndTime,
      hireHours,
      endTimeEdited,
      locationLabel,
      selectedChildIds,
    };

    AsyncStorage.setItem(hireDraftStorageKey, JSON.stringify(draft)).catch(() => {
      // ignore storage failures
    });
  }, [
    endTimeEdited,
    hireDraftStorageKey,
    hireHours,
    locationLabel,
    selectedChildIds,
    selectedDate,
    selectedEndTime,
    selectedTime,
  ]);

  const loadLocationLabel = async () => {
    const storedLabel = await AsyncStorage.getItem("last_location_label");
    if (storedLabel) {
      setLocationLabel(sanitizeLocationLabel(storedLabel));
      return;
    }
    const address = await AsyncStorage.getItem("user_address");
    const city = await AsyncStorage.getItem("user_city");
    const country = await AsyncStorage.getItem("user_country");
    const fallback = sanitizeLocationLabel([address || city, country].filter(Boolean).join(", "));
    if (fallback) {
      setLocationLabel(fallback);
      return;
    }
    const latText = await AsyncStorage.getItem("last_location_lat");
    const lonText = await AsyncStorage.getItem("last_location_lon");
    const lat = latText ? Number(latText) : NaN;
    const lon = lonText ? Number(lonText) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      setLocationLabel(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    }
  };

  const fetchHirePaymentMethods = async (): Promise<boolean | null> => {
    try {
      setCheckingPaymentMethod(true);
      const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
      const apiKey = getRuntimeApiKey();
      const userId = normalizeIdValue(await AsyncStorage.getItem("user_id"));
      const userEmail = String((await AsyncStorage.getItem("user_email")) || "").trim();
      const queryParts = [
        ...(userId ? [`user_id=${encodeURIComponent(userId)}`] : []),
        ...(!userId && userEmail ? [`user_email=${encodeURIComponent(userEmail)}`] : []),
      ];
      const query = queryParts.length ? `?${queryParts.join("&")}` : "";
      const json = await apiRequest<any>(`payment-method${query}`, {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
      });
      const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      const hasAny = list.length > 0;
      setHasPaymentMethod(hasAny);
      return hasAny;
    } catch (error: any) {
      if (isVerificationRequiredApiError(error)) {
        onRequireVerification?.();
        return false;
      }
      setHasPaymentMethod(true);
      return null;
    } finally {
      setCheckingPaymentMethod(false);
    }
  };

  const requireHirePaymentMethod = async (openPaymentScreen = true): Promise<boolean> => {
    const hasMethod = await fetchHirePaymentMethods();
    if (hasMethod) return true;

    if (hasMethod === false) {
      Alert.alert(
        "Payment method required",
        "Please add a valid payment method to your account before sending a hire request."
      );
      if (openPaymentScreen) onRequirePayment?.();
      return false;
    }

    setHasPaymentMethod(true);
    return true;
  };

  useEffect(() => {
    loadProfile();
    loadChildren();
    loadLocationLabel();
  }, []);

  useEffect(() => {
    if (!showHire) return;
    if (String(locationLabel || "").trim()) return;
    void loadLocationLabel();
  }, [showHire]);

  useEffect(() => {
    if (!showHire) return;
    void fetchHirePaymentMethods();
  }, [showHire]);

  useEffect(() => {
    if (nanny?.id) {
      void loadFavoriteState(nanny.id);
    }
  }, [nanny?.id]);

  useEffect(() => {
    const targetNannyId = nanny?.id || nannyId;
    if (!targetNannyId) {
      setRatingSummary({ average: null, totalReviews: null, jobsCount: null, ratersCount: null, reviews: [] });
      return;
    }

    let active = true;
    setRatingSummary({ average: null, totalReviews: null, jobsCount: null, ratersCount: null, reviews: [] });

    (async () => {
      try {
        const tokenRaw = await AsyncStorage.getItem("token");
        const cleanToken = tokenRaw
          ? tokenRaw.replace(/^Bearer\s+/i, "").replace(/"/g, "").trim()
          : "";

        const summary: any = await getNannyRatingSummary(targetNannyId, cleanToken || undefined);
        if (!active) return;

        const average = toNumberOrNull(
          summary?.average_rating ??
            summary?.data?.average_rating ??
            summary?.average ??
            summary?.data?.average ??
            summary?.rating ??
            summary?.data?.rating
        );
        const total = toNumberOrNull(
          summary?.total_reviews ??
            summary?.ratings_count ??
            summary?.data?.total_reviews ??
            summary?.data?.ratings_count ??
            summary?.review_count ??
            summary?.data?.review_count
        );
        const jobsCount = toNumberOrNull(
          summary?.jobs_count ??
            summary?.total_jobs ??
            summary?.data?.jobs_count ??
            summary?.data?.total_jobs
        );
        const ratersCount = toNumberOrNull(
          summary?.raters_count ??
            summary?.data?.raters_count
        );
        const reviewsRaw = Array.isArray(summary?.reviews)
          ? summary.reviews
          : Array.isArray(summary?.data?.reviews)
          ? summary.data.reviews
          : [];
        const reviews = reviewsRaw.map((entry: any) => ({
          id: entry?.id,
          rating: toNumberOrNull(entry?.rating),
          review: String(entry?.review || "").trim() || null,
          parent_name: String(entry?.parent_name || "Parent").trim() || "Parent",
          reviewed_at: String(entry?.reviewed_at || "").trim() || null,
        }));

        setRatingSummary({
          average,
          totalReviews: total !== null ? Math.max(0, Math.round(total)) : null,
          jobsCount: jobsCount !== null ? Math.max(0, Math.round(jobsCount)) : null,
          ratersCount: ratersCount !== null ? Math.max(0, Math.round(ratersCount)) : null,
          reviews,
        });
      } catch {
        if (!active) return;
      }
    })();

    return () => {
      active = false;
    };
  }, [nanny?.id, nannyId]);

  useEffect(() => {
    (async () => {
      setIsPending(await isVerificationPending());
    })();
  }, []);

  /* ----------------------------- LOAD PROFILE ----------------------------- */

  const loadProfile = async () => {
    if (!nannyId) return;

    setLoading(true);
    try {
      const currentNanny = normalizeNanny(route?.params?.nanny || nanny || null);
      const token = await AsyncStorage.getItem("token");
      const cleanToken = sanitizeToken(token || undefined);
      const authHeaders: Record<string, string> = cleanToken
        ? { Authorization: `Bearer ${cleanToken}` }
        : {};
      const targetId = String(nannyId).trim();

      const detailsJson = await apiRequest<any>(`nannies/${encodeURIComponent(targetId)}`, {
        headers: authHeaders,
      }).catch((error) => {
        if (isVerificationRequiredApiError(error)) {
          onRequireVerification?.();
        }
        return null;
      });
      if (detailsJson) {
        const normalized = normalizeNanny(
          detailsJson?.data || detailsJson?.nanny || detailsJson
        );
        if (normalized) {
          setNanny(mergeNannyPreservingRate(normalized, currentNanny));
          return;
        }
      }

      const profileJson = await apiRequest<any>(
        `profiles/syttrs?user_id=${encodeURIComponent(targetId)}`,
        { headers: authHeaders }
      ).catch((error) => {
        if (isVerificationRequiredApiError(error)) {
          onRequireVerification?.();
        }
        return null;
      });
      const profileList = Array.isArray(profileJson)
        ? profileJson
        : Array.isArray(profileJson?.data)
          ? profileJson.data
          : [];
      const profile = profileList[0] || null;

      let availabilityRows: any[] = [];
      try {
        const availabilityJson = await apiRequest<any>(
          `nanny/getavailability?nanny_id=${encodeURIComponent(targetId)}`,
          { headers: authHeaders }
        ).catch((error) => {
          if (isVerificationRequiredApiError(error)) {
            onRequireVerification?.();
          }
          return null;
        });
        availabilityRows = Array.isArray(availabilityJson)
          ? availabilityJson
          : Array.isArray(availabilityJson?.availability)
            ? availabilityJson.availability
            : Array.isArray(availabilityJson?.data)
              ? availabilityJson.data
              : [];
      } catch {
        availabilityRows = [];
      }

      const fallbackNanny = normalizeNanny({
        ...(profile || {}),
        id: targetId,
        nanny_id: targetId,
        availability: buildAvailabilityFromRows(availabilityRows),
        rate_cards:
          profile?.hourly_rate !== undefined && profile?.hourly_rate !== null
            ? [{ rate: profile.hourly_rate }]
            : [],
      });
      if (fallbackNanny) {
        setNanny(mergeNannyPreservingRate(fallbackNanny, currentNanny));
      }
    } catch (error: any) {
      if (isVerificationRequiredApiError(error)) {
        onRequireVerification?.();
        return;
      }
      setNanny((prev) => prev || null);
    } finally {
      setLoading(false);
    }
  };

  const isVerificationPending = async () => {
    const raw = await AsyncStorage.getItem("user_verification_status");
    const val = (raw || "").toLowerCase().trim();
    return val === "pending" || val === "app-pending";
  };

  const loadFavoriteState = async (id: string | number) => {
    try {
      const raw = await AsyncStorage.getItem(FAVORITES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      const targetId = String(id || "").trim();
      setIsFavorite(
        list.some((item: any) => String(item?.id || "").trim() === targetId)
      );
    } catch {
      setIsFavorite(false);
    }
  };

	  const toggleFavorite = async () => {
	    if (!nanny?.id) return;
	    try {
      const [userId, token] = await Promise.all([
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("token"),
      ]);
      const raw = await AsyncStorage.getItem(FAVORITES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      const targetId = String(nanny.id || "").trim();
      const existingItem = list.find(
        (item: any) => String(item?.id || "").trim() === targetId
      );
      const exists = !!existingItem;
      let next = list;
      if (exists) {
        const deleteId =
          existingItem?.favorite_id || existingItem?.syttr_user_id || existingItem?.id;
        if (deleteId) {
          await removeFavoriteSyttr(
            deleteId,
            userId ? { user_id: userId } : undefined,
            token || undefined
          );
        }
        next = list.filter(
          (item: any) => String(item?.id || "").trim() !== targetId
        );
      } else {
        let favoriteId: string | number | undefined;
        if (userId) {
          const response: any = await addFavoriteSyttr(
            {
              user_id: userId,
              syttr_user_id: targetId,
            },
            token || undefined
          );
          favoriteId = response?.data?.id;
        }
        next = [
          ...list,
          {
            id: nanny.id,
            favorite_id: favoriteId,
            syttr_user_id: nanny.id,
            fullname: nanny.fullname,
            name: nanny.name,
            city: nanny.city,
            experience: nanny.experience,
            age: nanny.age,
            profile_image: nanny.profile_image,
          },
        ];
      }
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      setIsFavorite(!exists);
    } catch {
      Alert.alert("Favorites", "Unable to update favorites.");
	    }
	  };

	  const [availabilityAnchor, setAvailabilityAnchor] = useState(new Date());
	  const [selectedAvailabilityDate, setSelectedAvailabilityDate] = useState<Date | null>(null);

	  const availabilityMap = useMemo(() => {
	    const map: Record<string, AvailabilitySlot[]> = {};
	    (nanny?.availability || []).forEach((entry) => {
	      if (!entry?.day) return;
	      map[String(entry.day)] = Array.isArray(entry.slots) ? entry.slots : [];
	    });
	    return map;
	  }, [nanny?.availability]);

	  const monthDays = useMemo(() => buildMonthDays(availabilityAnchor), [availabilityAnchor]);
	  const monthLabel = availabilityAnchor.toLocaleDateString("en-US", {
	    month: "long",
	    year: "numeric",
	  });
	  const selectedAvailabilityKey = selectedAvailabilityDate
	    ? formatDateKey(selectedAvailabilityDate)
	    : null;
	  const selectedAvailabilityLabel = selectedAvailabilityDate
	    ? formatDateToMDY(formatDateKey(selectedAvailabilityDate)) || formatDateKey(selectedAvailabilityDate)
	    : "";
	  const selectedWeekday = selectedAvailabilityDate
	    ? getDayName(selectedAvailabilityDate)
	    : null;
	  const selectedSlots = selectedAvailabilityKey
	    ? availabilityMap[selectedAvailabilityKey] ||
	      availabilityMap[selectedWeekday || ""] ||
	      []
	    : [];
    const selectedSlotGroups = buildAvailabilityDisplayGroups(selectedSlots);

	  if (loading)
	    return (
	      <View style={styles.center}>
	        <ActivityIndicator color="#FF80AB" />
	      </View>
	    );

	  if (!nanny)
	    return (
	      <View style={styles.center}>
	        <Text style={{ color: "#880E4F" }}>Profile not available</Text>
	      </View>
	    );

	  const fallbackRating = toNumberOrNull(nanny.rating ?? nanny.avg_rating);
	  const effectiveRating = ratingSummary.average ?? fallbackRating;
	  const effectiveTotalReviews =
      ratingSummary.totalReviews ??
      toNumberOrNull(nanny.total_reviews ?? nanny.review_count);
    const effectiveJobsCount =
      ratingSummary.jobsCount ??
      toNumberOrNull(nanny.jobs_count ?? nanny.total_jobs);
    const effectiveRatersCount =
      ratingSummary.ratersCount ??
      toNumberOrNull(nanny.raters_count) ??
      effectiveTotalReviews;
    const displayedReviews = ratingSummary.reviews || [];
    const rating =
      effectiveRating !== null
        ? effectiveTotalReviews && effectiveTotalReviews > 0
          ? `${formatRatingValue(effectiveRating)} (${Math.round(effectiveTotalReviews)})`
          : formatRatingValue(effectiveRating)
        : "N/A";
	  const hourlyRate = extractHourlyRateValue(nanny) ?? NaN;
    const hourlyRateLabel =
      Number.isFinite(hourlyRate) && hourlyRate > 0 ? `$${hourlyRate}/hr` : "Rate N/A";
    const parsedHireHours = toLooseNumberOrNull(hireHours) ?? 0;
	  const computedTotal =
	    Number.isFinite(hourlyRate) && hourlyRate > 0 && parsedHireHours > 0
	      ? (parsedHireHours * hourlyRate).toFixed(2)
	      : "";

  const scrollToProfileSection = (section: ProfileSectionKey) => {
    setActiveProfileSection(section);
    profileScrollRef.current?.scrollTo({
      x: 0,
      y: Math.max(0, profileSectionOffsets[section] - rs(12)),
      animated: true,
    });
  };

  const trackProfileSection =
    (section: ProfileSectionKey) =>
    (event: { nativeEvent: { layout: { y: number } } }) => {
      const nextY = event.nativeEvent.layout.y;
      setProfileSectionOffsets((prev) => {
        if (prev[section] === nextY) return prev;
        return { ...prev, [section]: nextY };
      });
    };

  const openDatePicker = () => {
    const transitionId = ++pickerTransitionRef.current;
    const parsedSelected = String(selectedDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const base = parsedSelected
      ? new Date(
          Number(parsedSelected[1]),
          Number(parsedSelected[2]) - 1,
          Number(parsedSelected[3])
        )
      : new Date();
    const monthBase = new Date(base.getFullYear(), base.getMonth(), 1);
    setTempDate(base);
    setMonthCursor(monthBase);
    const shouldRestore = showHire;
    setRestoreHireAfterPicker(shouldRestore);
    if (shouldRestore) setShowHire(false);
    requestAnimationFrame(() => {
      if (pickerTransitionRef.current !== transitionId) return;
      setShowDatePicker(true);
    });
  };

  const closeDatePicker = () => {
    const transitionId = ++pickerTransitionRef.current;
    setShowDatePicker(false);
    if (restoreHireAfterPicker) {
      setRestoreHireAfterPicker(false);
      requestAnimationFrame(() => {
        if (pickerTransitionRef.current !== transitionId) return;
        setShowHire(true);
      });
    }
  };

  const closeStartTimePicker = () => {
    const transitionId = ++pickerTransitionRef.current;
    setShowStartTimePicker(false);
    if (restoreHireAfterPicker) {
      setRestoreHireAfterPicker(false);
      requestAnimationFrame(() => {
        if (pickerTransitionRef.current !== transitionId) return;
        setShowHire(true);
      });
    }
  };

  const closeEndTimePicker = () => {
    const transitionId = ++pickerTransitionRef.current;
    setShowEndTimePicker(false);
    if (restoreHireAfterPicker) {
      setRestoreHireAfterPicker(false);
      requestAnimationFrame(() => {
        if (pickerTransitionRef.current !== transitionId) return;
        setShowHire(true);
      });
    }
  };

  const confirmDatePicker = () => {
    setSelectedDate(formatDateKey(tempDate));
    closeDatePicker();
  };

  const openStartTimePicker = () => {
    if (Platform.OS === "web") return;
    const transitionId = ++pickerTransitionRef.current;
    const shouldRestore = showHire;
    setRestoreHireAfterPicker(shouldRestore);
    if (shouldRestore) setShowHire(false);
    requestAnimationFrame(() => {
      if (pickerTransitionRef.current !== transitionId) return;
      setShowStartTimePicker(true);
    });
  };

  const openEndTimePicker = () => {
    if (Platform.OS === "web") return;
    const transitionId = ++pickerTransitionRef.current;
    const shouldRestore = showHire;
    setRestoreHireAfterPicker(shouldRestore);
    if (shouldRestore) setShowHire(false);
    requestAnimationFrame(() => {
      if (pickerTransitionRef.current !== transitionId) return;
      setShowEndTimePicker(true);
    });
  };

  const confirmStartTimePicker = (value: Date) => {
    setSelectedTime(formatDisplayTime(value));
    const transitionId = ++pickerTransitionRef.current;
    setShowStartTimePicker(false);
    if (restoreHireAfterPicker) {
      setRestoreHireAfterPicker(false);
      requestAnimationFrame(() => {
        if (pickerTransitionRef.current !== transitionId) return;
        setShowHire(true);
      });
    }
  };

  const confirmEndTimePicker = (value: Date) => {
    setEndTimeEdited(true);
    setSelectedEndTime(formatDisplayTime(value));
    const transitionId = ++pickerTransitionRef.current;
    setShowEndTimePicker(false);
    if (restoreHireAfterPicker) {
      setRestoreHireAfterPicker(false);
      requestAnimationFrame(() => {
        if (pickerTransitionRef.current !== transitionId) return;
        setShowHire(true);
      });
    }
  };

  const closeHireModal = () => {
    pickerTransitionRef.current += 1;
    Keyboard.dismiss();
    setShowHire(false);
    setShowChildrenModal(false);
    setShowDatePicker(false);
    setShowStartTimePicker(false);
    setShowEndTimePicker(false);
    setGeocodingLocation(false);
    setRestoreHireAfterPicker(false);
    setSelectedEndTime("");
    setEndTimeEdited(false);
  };

  const clearHireDraft = async () => {
    if (!hireDraftStorageKey) return;
    try {
      await AsyncStorage.removeItem(hireDraftStorageKey);
    } catch {
      // ignore storage failures
    }
  };

  const persistHireLocation = async (label: string, lat?: number, lon?: number) => {
    const trimmed = (label || "").trim();
    if (!trimmed) return;
    const pairs: Array<[string, string]> = [["last_location_label", trimmed]];
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      pairs.push(["last_location_lat", String(lat)]);
      pairs.push(["last_location_lon", String(lon)]);
    }
    try {
      await AsyncStorage.multiSet(pairs);
    } catch {
      // ignore storage failures
    }
  };

  const hideHireLocationSuggestions = () => {
    setShowLocationSuggestions(false);
    setLocationSuggestions([]);
    setLoadingLocationSuggestions(false);
  };

	  const geocodeHireLocation = async (query: string) => {
	    const trimmed = sanitizeLocationLabel(query || "");
	    if (!trimmed) return;
	    if (geocodingLocation) return;

	    try {
	      hideHireLocationSuggestions();
	      setGeocodingLocation(true);
	      setLocationLabel(trimmed);

	      const found = await geocodeAddress(trimmed);
	      if (found) {
	        const label = sanitizeLocationLabel(found.formattedAddress || trimmed);
	        if (label !== trimmed) setLocationLabel(label);
	        await persistHireLocation(label, found.latitude, found.longitude);
	        return;
	      }

	      await persistHireLocation(sanitizeLocationLabel(trimmed));
	    } finally {
	      setGeocodingLocation(false);
	    }
	  };

  const applyHireLocationSuggestion = async (item: LocationSuggestion) => {
    const fallbackLabel = sanitizeLocationLabel(item.description || "");
    if (!fallbackLabel) return;

    try {
      Keyboard.dismiss();
      hideHireLocationSuggestions();
      setGeocodingLocation(true);
      setLocationLabel(fallbackLabel);

      const details = await fetchLocationDetails(item.placeId);
      const resolved = details || (await geocodeAddress(fallbackLabel));
      if (resolved) {
        const nextLabel = sanitizeLocationLabel(resolved.formattedAddress || fallbackLabel);
        setLocationLabel(nextLabel);
        await persistHireLocation(nextLabel, resolved.latitude, resolved.longitude);
      } else {
        await persistHireLocation(fallbackLabel);
      }
    } finally {
      setGeocodingLocation(false);
    }
  };

  const resolveProfileConversationId = async (
    parentUserId?: string | number,
    targetNannyId?: string | number
  ): Promise<number | string | undefined> => {
    const normalizedParentId = normalizeIdValue(parentUserId);
    const normalizedNannyId = normalizeIdValue(targetNannyId);
    if (!normalizedParentId || !normalizedNannyId) return undefined;

    const [tokenRaw] = await Promise.all([
      AsyncStorage.getItem("token"),
    ]);
    const cleanToken = sanitizeToken(tokenRaw || undefined);

    const json = await apiRequest<any>("chat/conversations/list", {
      method: "POST",
      headers: {
        ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
      },
      body: JSON.stringify({
        user_id: normalizedParentId,
        nanny_id: normalizedNannyId,
      }),
    });
    const list: any[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.data?.data)
      ? json.data.data
      : Array.isArray(json?.conversations)
      ? json.conversations
      : Array.isArray(json)
      ? json
      : [];

    const match =
      list.find(
        (item) =>
          normalizeIdValue(item?.user_id || item?.user?.id) === normalizedParentId &&
          normalizeIdValue(item?.nanny_id || item?.nanny?.id) === normalizedNannyId
      ) || list[0];

    return normalizeIdValue(match?.id || match?.conversation_id);
  };

  const handleMessagePress = async () => {
    const userId = normalizeIdValue(await AsyncStorage.getItem("user_id"));
    const targetNannyId = normalizeIdValue(nanny?.nanny_id || nanny?.id || nannyId);
    if (!targetNannyId) {
      Alert.alert("Message", "Unable to open chat for this Syttr.");
      return;
    }

    let conversationToOpen = normalizeIdValue(nanny?.conversation_id);
    if (!conversationToOpen && userId) {
      try {
        conversationToOpen = await resolveProfileConversationId(userId, targetNannyId);
      } catch {
        // Chat screen will still try to resolve on open.
      }
    }

    const params = {
      nannyId: targetNannyId,
      conversationId: conversationToOpen,
      userId,
      name: displayName,
    };
    if (onMessage) onMessage(params);
    else navigation?.navigate?.("ClientChat", params);
  };

  /* ----------------------------- UI ----------------------------- */

  return (
    <View style={styles.root}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (onBack) onBack();
            else navigation?.goBack?.();
          }}
          style={styles.headerIcon}
        >
          <Ionicons name="chevron-back" size={20} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {displayName}
        </Text>
        <View style={styles.headerIconGhost} />
      </View>

      <ScrollView
        ref={profileScrollRef}
        contentContainerStyle={{ paddingBottom: isLandscape ? hp(3) : hp(5) }}
      >
        {/* HERO */}
        <View style={styles.hero}>
          <View style={[styles.heroAvatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={[styles.heroImg, { width: avatarInnerSize, height: avatarInnerSize, borderRadius: avatarInnerSize / 2 }]} />
            ) : (
              <View style={[styles.heroInitials, { width: avatarInnerSize, height: avatarInnerSize, borderRadius: avatarInnerSize / 2 }]}>
                <Image
                  source={require("../../assets/app-logo.png")}
                  style={styles.heroLogo}
                  resizeMode="contain"
                />
              </View>
            )}
          </View>

          <Text style={styles.heroName} numberOfLines={1}>{displayName}</Text>

          <View style={styles.heroTags}>
            <Tag icon="star" label={String(rating)} />
            <Tag icon="briefcase" label={`Completed Jobs ${Math.max(0, Math.round(effectiveJobsCount || 0))}`} />
            <Tag icon="people" label={`Rated by ${Math.max(0, Math.round(effectiveRatersCount || 0))}`} />
            <Tag icon="location" label={publicLocationLabel} />
            <Tag icon="cash" label={hourlyRateLabel} />
          </View>
        </View>

        {/* ACTIONS */}
        <View style={[styles.actionRow, narrowActions && styles.actionRowStack]}>
          <ActionBtn
            icon="chatbubble"
            label="Message"
            onPress={handleMessagePress}
          />
          <ActionBtn
            icon="briefcase"
            label="Hire Now"
            filled
            onPress={() => setShowHire(true)}
            disabled={isPending}
          />
        </View>
        <TouchableOpacity
          style={[styles.favoriteBtn, isFavorite && styles.favoriteBtnActive]}
          onPress={toggleFavorite}
          activeOpacity={0.85}
        >
          <Ionicons
            name={isFavorite ? "heart" : "heart-outline"}
            size={16}
            color={isFavorite ? "#fff" : "#C2185B"}
          />
          <Text
            style={[styles.favoriteText, isFavorite && styles.favoriteTextActive]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {isFavorite ? "Favorited" : "Add to Favorites"}
          </Text>
        </TouchableOpacity>

        <View style={styles.profileTabsRow}>
          <TouchableOpacity
            style={[
              styles.profileTabBtn,
              activeProfileSection === "about" && styles.profileTabBtnActive,
            ]}
            onPress={() => scrollToProfileSection("about")}
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.profileTabText,
                activeProfileSection === "about" && styles.profileTabTextActive,
              ]}
            >
              About
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.profileTabBtn,
              activeProfileSection === "availability" && styles.profileTabBtnActive,
            ]}
            onPress={() => scrollToProfileSection("availability")}
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.profileTabText,
                activeProfileSection === "availability" && styles.profileTabTextActive,
              ]}
            >
              Availability
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.profileTabBtn,
              activeProfileSection === "reviews" && styles.profileTabBtnActive,
            ]}
            onPress={() => scrollToProfileSection("reviews")}
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.profileTabText,
                activeProfileSection === "reviews" && styles.profileTabTextActive,
              ]}
            >
              Reviews
            </Text>
          </TouchableOpacity>
        </View>

        <View onLayout={trackProfileSection("about")}>
          <Section title="About Me" body={nanny.bio || "No bio provided"} />
        </View>

        {/* AVAILABILITY */}
        <View onLayout={trackProfileSection("availability")}>
          <Section title="Availability">
            <View style={styles.calendarCard}>
              <View style={styles.monthHeader}>
                <TouchableOpacity
                  onPress={() =>
                    setAvailabilityAnchor(
                      new Date(availabilityAnchor.getFullYear(), availabilityAnchor.getMonth() - 1, 1)
                    )
                  }
                >
                  <Ionicons name="chevron-back" size={18} color="#C2185B" />
                </TouchableOpacity>
                <Text style={styles.monthLabel}>{monthLabel}</Text>
                <TouchableOpacity
                  onPress={() =>
                    setAvailabilityAnchor(
                      new Date(availabilityAnchor.getFullYear(), availabilityAnchor.getMonth() + 1, 1)
                    )
                  }
                >
                  <Ionicons name="chevron-forward" size={18} color="#C2185B" />
                </TouchableOpacity>
              </View>
              <View style={styles.weekRow}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <Text key={d} style={styles.weekLabel}>
                    {d}
                  </Text>
                ))}
              </View>
              <View style={styles.grid}>
                {monthDays.map((day, idx) => {
                  if (!day) return <View key={`empty-${idx}`} style={[styles.emptyCell, { width: `${100 / 7}%`, height: calendarCellSize + rs(4) }]} />;
                  const key = formatDateKey(day);
                  const weekday = getDayName(day);
                  const hasSlots = !!availabilityMap[key]?.length || !!availabilityMap[weekday]?.length;
                  const isSelected = selectedAvailabilityKey === key;
                  const isToday = isTodayDate(day);
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.dayCell, { width: `${100 / 7}%`, minHeight: calendarCellSize + rs(4) }]}
                      onPress={() => setSelectedAvailabilityDate(day)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.dayBubble, { width: calendarCellSize, height: calendarCellSize, borderRadius: calendarCellSize / 2 }, hasSlots && styles.dayHasEvent, isToday && styles.dayToday, isSelected && styles.daySelected]}>
                        {hasSlots && <View style={styles.dayDot} />}
                        <Text style={[styles.dayText, hasSlots && styles.dayTextActive, isToday && styles.dayTextToday, isSelected && styles.dayTextSelected]}>
                          {day.getDate()}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {selectedAvailabilityDate ? (
              selectedSlotGroups.length ? (
                <View style={styles.availRow}>
                  <Text style={styles.availDay}>{selectedAvailabilityLabel}</Text>
                  <View style={styles.slotRow}>
                    {selectedSlotGroups.map((slotGroup, j) => (
                      <View key={`${selectedAvailabilityKey}-${j}`} style={styles.slotPill}>
                        <Text style={styles.slotText}>{slotGroup.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <Text style={styles.emptyText}>No availability for this date.</Text>
              )
            ) : (
              <Text style={styles.emptyText}>Select a date to view availability.</Text>
            )}
          </Section>
        </View>

        <View onLayout={trackProfileSection("reviews")}>
          <Section title="Reviews">
            <View style={styles.reviewsSummaryRow}>
              <View style={styles.reviewMetricCard}>
                <Text style={styles.reviewMetricValue}>
                  {effectiveRating !== null ? formatRatingValue(effectiveRating) : "N/A"}
                </Text>
                <Text style={styles.reviewMetricLabel}>Average Rating</Text>
              </View>
              <View style={styles.reviewMetricCard}>
                <Text style={styles.reviewMetricValue}>
                  {effectiveTotalReviews !== null ? `${Math.max(0, Math.round(effectiveTotalReviews))}` : "0"}
                </Text>
                <Text style={styles.reviewMetricLabel}>Reviews</Text>
              </View>
              <View style={styles.reviewMetricCard}>
                <Text style={styles.reviewMetricValue}>
                  {effectiveRatersCount !== null ? `${Math.max(0, Math.round(effectiveRatersCount))}` : "0"}
                </Text>
                <Text style={styles.reviewMetricLabel}>Parent Raters</Text>
              </View>
            </View>

            {displayedReviews.length > 0 ? (
              <View style={styles.reviewList}>
                {displayedReviews.map((entry, index) => (
                  <View
                    key={`${entry.id || entry.parent_name || "review"}-${index}`}
                    style={styles.reviewCard}
                  >
                    <View style={styles.reviewCardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reviewAuthor}>
                          {entry.parent_name || "Parent"}
                        </Text>
                        <Text style={styles.reviewDate}>
                          {entry.reviewed_at
                            ? formatDateToMDY(entry.reviewed_at) || entry.reviewed_at
                            : "Recent review"}
                        </Text>
                      </View>
                      <View style={styles.reviewRatingPill}>
                        <Ionicons name="star" size={12} color="#C2185B" />
                        <Text style={styles.reviewRatingText}>
                          {entry.rating !== null && entry.rating !== undefined
                            ? formatRatingValue(entry.rating)
                            : "N/A"}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.reviewBody}>
                      {entry.review || "This parent left a star rating without written feedback."}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>No written reviews yet.</Text>
            )}
          </Section>
        </View>
      </ScrollView>

      {/* HIRE MODAL */}
      <HireModal
        visible={showHire && !showDatePicker && !showStartTimePicker && !showEndTimePicker}
        onClose={closeHireModal}
        kids={kids}
        selectedChildIds={selectedChildIds}
        onToggleChild={(id: number) => {
          setSelectedChildIds((prev) =>
            prev.includes(id) ? prev.filter((kidId) => kidId !== id) : [...prev, id]
          );
        }}
        selectedDate={selectedDate}
        onChangeDate={setSelectedDate}
        selectedTime={selectedTime}
        onChangeTime={setSelectedTime}
        selectedEndTime={selectedEndTime}
        onChangeEndTime={(value: string) => {
          setEndTimeEdited(true);
          setSelectedEndTime(value);
        }}
        locationLabel={locationLabel}
        searchingLocation={geocodingLocation}
        onChangeLocation={(next: string) => setLocationLabel(next)}
        onSearchLocation={geocodeHireLocation}
        hireHours={hireHours}
        hirePrice={computedTotal}
        onChangeHours={setHireHours}
        onOpenDatePicker={openDatePicker}
        onOpenStartTimePicker={openStartTimePicker}
        onOpenEndTimePicker={openEndTimePicker}
        locationSuggestions={locationSuggestions}
        loadingLocationSuggestions={loadingLocationSuggestions}
        showLocationSuggestions={showLocationSuggestions}
        onShowLocationSuggestions={() => setShowLocationSuggestions(true)}
        onHideLocationSuggestions={hideHireLocationSuggestions}
        onApplyLocationSuggestion={applyHireLocationSuggestion}
        hasPaymentMethod={hasPaymentMethod}
        checkingPaymentMethod={checkingPaymentMethod}
        onRequirePayment={onRequirePayment}
        onConfirm={() => {
          (async () => {
            if (!nanny?.id && !nanny?.nanny_id && !nannyId) return;
            if (hireLoading) return;
            if (await isVerificationPending()) {
              Alert.alert(
                "Verification pending",
                "You can send a hire request after verification is complete."
              );
              return;
            }
            if (!selectedChildIds.length) {
              Alert.alert("Missing info", "Please select a child.");
              return;
            }
            if (!selectedDate || !selectedTime || !selectedEndTime) {
              Alert.alert("Missing info", "Please select start time and end time.");
              return;
            }
            if (!hireHours || parsedHireHours <= 0) {
              Alert.alert("Missing info", "Please enter hours.");
              return;
            }
            if (!(await requireHirePaymentMethod())) {
              return;
            }
            setHireLoading(true);
            try {
              const userId = normalizeIdValue(await AsyncStorage.getItem("user_id"));
              if (!userId) {
                Alert.alert("Missing info", "Please log in again.");
                return;
              }
              const nannyTargetId = normalizeIdValue(nanny?.nanny_id || nanny?.id);
              if (!nannyTargetId) {
                Alert.alert("Hire request", "Unable to identify selected Syttr.");
                return;
              }
              const safeLocation = sanitizeLocationLabel(locationLabel || "");
              if (!safeLocation) {
                Alert.alert("Missing info", "Please enter a location.");
                return;
              }
              const latText = await AsyncStorage.getItem("last_location_lat");
              const lonText = await AsyncStorage.getItem("last_location_lon");
              const lat = latText ? Number(latText) : NaN;
              const lon = lonText ? Number(lonText) : NaN;
              await persistHireLocation(
                safeLocation,
                Number.isFinite(lat) ? lat : undefined,
                Number.isFinite(lon) ? lon : undefined
              );
              const formattedTime = to24HourTime(selectedTime);
              const formattedEndTime = to24HourTime(selectedEndTime);
              if (!formattedTime || !formattedEndTime) {
                Alert.alert("Missing info", "Please select valid start time and end time.");
                return;
              }
              const priceToSend = Number(computedTotal);
              const token = sanitizeToken(await AsyncStorage.getItem("token"));
              const apiKey =
                String((await AsyncStorage.getItem("api_key")) || getRuntimeApiKey() || "").trim();
              const payload: Record<string, any> = {
                nanny_id: nannyTargetId,
                user_id: userId,
                kids: selectedChildIds,
                location: safeLocation,
                start_date: selectedDate,
                end_date: selectedDate,
                start_time: formattedTime,
                end_time: formattedEndTime,
                hours: parsedHireHours,
              };
              if (Number.isFinite(lat)) payload.latitude = lat;
              if (Number.isFinite(lon)) payload.longitude = lon;
              if (Number.isFinite(hourlyRate) && hourlyRate > 0) {
                payload.hourly_rate = hourlyRate;
              }
              if (Number.isFinite(priceToSend) && priceToSend > 0) {
                payload.price = priceToSend;
              }
              const json = await apiRequest<any>("jobs/hire-now", {
                method: "POST",
                headers: {
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  ...(apiKey ? { "x-api-key": apiKey } : {}),
                },
                body: JSON.stringify(payload),
              });
              if (json?.success === false) {
                if (isVerificationRequiredApiError({ payload: json, message: json?.message })) {
                  onRequireVerification?.();
                  return;
                }
                Alert.alert(
                  "Hire request",
                  json?.message || "Something went wrong"
                );
                return;
              }
              await clearHireDraft();
              closeHireModal();
              setSelectedDate("");
              setSelectedTime("");
              setSelectedEndTime("");
              setHireHours("");
              setEndTimeEdited(false);
              setSelectedChildIds([]);
              Alert.alert("Request Sent", json?.message || "Hiring request submitted.");
            } catch (e: any) {
              if (isVerificationRequiredApiError(e)) {
                onRequireVerification?.();
                return;
              }
              Alert.alert("Hire request", e?.message || "Unable to send hire request.");
            } finally {
              setHireLoading(false);
            }
          })();
        }}
      />

      <Modal visible={showDatePicker} transparent animationType="fade" onRequestClose={closeDatePicker}>
        <View style={styles.timeOverlay}>
          <View style={styles.dateCard}>
            <Text style={styles.timeTitle}>Select Date</Text>
            <Text style={styles.dateDisplay}>
              {formatPickerDateLabel(tempDate)}
            </Text>
            <View style={styles.dateHeaderRow}>
              <View style={styles.dateMonthRow}>
                  <Text style={styles.dateMonthLabel}>
                    {monthCursor.toLocaleString("en-US", { month: "long", year: "numeric" })}
                  </Text>
              </View>
              <View style={styles.dateArrows}>
                <TouchableOpacity
                  style={styles.dateArrowBtn}
                  onPress={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}
                >
                  <Ionicons name="chevron-back" size={18} color="#C2185B" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.dateArrowBtn}
                  onPress={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}
                >
                  <Ionicons name="chevron-forward" size={18} color="#C2185B" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.weekRowPicker}>
              {["S", "M", "T", "W", "T", "F", "S"].map((d, idx) => (
                <Text key={`${d}-${idx}`} style={styles.weekLabelPicker}>
                  {d}
                </Text>
              ))}
            </View>
            <View style={styles.daysGridPicker}>
              {buildMonthDays(monthCursor).map((day, idx) => {
                if (!day) return <View key={`picker-empty-${idx}`} style={styles.dayCellPicker} />;
                const isSelected = tempDate.toDateString() === day.toDateString();
                return (
                  <TouchableOpacity
                    key={`picker-${idx}`}
                    style={[styles.dayCellPicker, isSelected && styles.dayCellSelected]}
                    onPress={() => setTempDate(day)}
                  >
                    <Text style={[styles.dayLabelPicker, isSelected && styles.dayLabelSelected]}>
                      {day.getDate()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.timeActions}>
              <TouchableOpacity onPress={closeDatePicker}>
                <Text style={styles.timeCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmDatePicker}>
                <Text style={styles.timeOk}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <SpinnerTimePicker
        visible={showStartTimePicker}
        value={parseDisplayTimeToDate(selectedTime) || new Date()}
        title="Select Start Time"
        onCancel={closeStartTimePicker}
        onConfirm={confirmStartTimePicker}
      />

      <SpinnerTimePicker
        visible={showEndTimePicker}
        value={parseDisplayTimeToDate(selectedEndTime) || parseDisplayTimeToDate(selectedTime) || new Date()}
        title="Select End Time"
        onCancel={closeEndTimePicker}
        onConfirm={confirmEndTimePicker}
      />

      <ChildCardsModal
        visible={showChildrenModal}
        kids={kids}
        selectedChildIds={selectedChildIds}
        onToggleChild={(id: number) => {
          setSelectedChildIds((prev) =>
            prev.includes(id) ? prev.filter((kidId) => kidId !== id) : [...prev, id]
          );
        }}
        onClose={() => setShowChildrenModal(false)}
      />
    </View>
  );
}

/* ----------------------------- COMPONENTS ----------------------------- */

const Tag = ({ icon, label }: any) => (
  <View style={styles.tag}>
    <Ionicons name={icon} size={12} color="#C2185B" />
    <Text style={styles.tagText} numberOfLines={1} ellipsizeMode="tail">{label}</Text>
  </View>
);

const ActionBtn = ({ icon, label, filled, onPress, disabled }: any) => (
  <TouchableOpacity
    style={[
      styles.actionBtn,
      filled && styles.actionBtnFilled,
      disabled && styles.actionBtnDisabled,
    ]}
    onPress={onPress}
    disabled={disabled}
  >
    <Ionicons name={icon} size={14} color={filled ? "#fff" : "#C2185B"} />
    <Text
      style={[styles.actionBtnText, filled && { color: "#fff" }]}
      numberOfLines={1}
      ellipsizeMode="tail"
    >
      {label}
    </Text>
  </TouchableOpacity>
);

const Section = ({ title, body, children }: any) => (
  <View style={styles.sectionBox}>
    <Text style={styles.sectionHeading}>{title}</Text>
    {body ? <Text style={styles.bodyText}>{body}</Text> : children}
  </View>
);

const buildMonthDays = (anchor: Date) => {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const startDay = first.getDay();
  const totalDays = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const cells: Array<Date | null> = [];
  for (let i = 0; i < startDay; i += 1) cells.push(null);
  for (let d = 1; d <= totalDays; d += 1) {
    cells.push(new Date(anchor.getFullYear(), anchor.getMonth(), d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isTodayDate = (date: Date) => formatDateKey(date) === formatDateKey(new Date());

const getDayName = (date: Date) =>
  date.toLocaleDateString("en-US", { weekday: "long" });

const sanitizePublicLocation = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return "Nearby";

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const looksLikeStreet = (part: string) => {
    const text = part.toLowerCase();
    if (/^\d/.test(text)) return true;
    return /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|ct|court|cir|circle|pkwy|parkway)\b/.test(
      text
    );
  };

  const isStateCode = (part: string) => /^[A-Za-z]{2}$/.test(part);

  const cityPart = parts.find((part) => !looksLikeStreet(part) && !isStateCode(part));
  const statePart = parts.find((part) => isStateCode(part));

  if (cityPart && statePart) return `${cityPart}, ${statePart.toUpperCase()}`;
  if (cityPart) return cityPart;
  if (parts.length > 1) return parts[parts.length - 1];
  if (looksLikeStreet(raw)) return "Nearby";
  return raw;
};

/* ----------------------------- HIRE MODAL ----------------------------- */

const HireModal = ({
  visible,
  onClose,
  kids,
  selectedChildIds,
  onToggleChild,
  selectedDate,
  onChangeDate,
  selectedTime,
  onChangeTime,
  selectedEndTime,
  onChangeEndTime,
  locationLabel,
  searchingLocation,
  onChangeLocation,
  onSearchLocation,
  hireHours,
  hirePrice,
  onChangeHours,
  onConfirm,
  onOpenDatePicker,
  onOpenStartTimePicker,
  onOpenEndTimePicker,
  locationSuggestions,
  loadingLocationSuggestions,
  showLocationSuggestions,
  onShowLocationSuggestions,
  onHideLocationSuggestions,
  onApplyLocationSuggestion,
  hasPaymentMethod,
  checkingPaymentMethod,
  onRequirePayment,
}: any) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isTablet = width >= 768;
  const modalScrollRef = useRef<ScrollView | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (event: any) => {
      const inset = event?.endCoordinates?.height || 0;
      setKeyboardInset(inset);
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardInset(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[
          styles.modalBackdrop,
          isTablet ? { paddingHorizontal: rs(14) } : null,
          {
            paddingTop: Math.max(insets.top + rs(12), rs(20)),
            paddingBottom: 0,
          },
        ]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? (height < 700 ? 10 : 18) : 0}
      >
        <View
          style={[
            styles.modalCard,
            {
              width: "100%",
              alignSelf: "center",
              maxWidth: isTablet ? rs(560) : undefined,
              maxHeight: Math.min(
                height - Math.max(insets.top + rs(24), rs(36)),
                height * 0.84,
                hp(84)
              ),
            },
          ]}
        >
          <ScrollView
            ref={modalScrollRef}
            contentContainerStyle={[
              styles.modalScrollContent,
              keyboardInset > 0
                ? { paddingBottom: keyboardInset + Math.max(insets.bottom, rs(16)) }
                : { paddingBottom: Math.max(insets.bottom + rs(10), rs(16)) },
            ]}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.modalTitle}>Hire Syttr</Text>

            <View style={styles.modalInput}>
              <Ionicons name="people" size={16} color="#C2185B" />
              <Text style={[styles.modalInputText, { flex: 1 }]}>
                {selectedChildIds?.length
                  ? `Children: ${(kids || [])
                      .filter((c: any) => selectedChildIds.includes(c.id))
                      .map((c: any) => c.name || c.id)
                      .join(", ")}`
                  : "Pick Child"}
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.childPillRow}
            >
              {(kids || []).length === 0 ? (
                <Text style={styles.childHintText}>No children found</Text>
              ) : (
                (kids || []).map((c: Child) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.childPill,
                      selectedChildIds?.includes(c.id) && styles.childPillSelected,
                    ]}
                    onPress={() => onToggleChild?.(c.id)}
                  >
                    <Text
                      style={[
                        styles.childPillText,
                        selectedChildIds?.includes(c.id) && { color: "#fff" },
                      ]}
                    >
                      {c.name || "Child"}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <TouchableOpacity style={styles.modalInput} onPress={onOpenDatePicker}>
              <Ionicons name="calendar" size={16} color="#C2185B" />
              <Text style={styles.modalInputText}>
                {selectedDate ? formatIsoDateLabel(selectedDate) : "Pick Date"}
              </Text>
            </TouchableOpacity>

            {Platform.OS === "web" ? (
              <>
                <View style={styles.modalInput}>
                  <Ionicons name="time" size={16} color="#C2185B" />
                  <TextInput
                    style={styles.modalTextInput}
                    placeholder="5:00 PM"
                    placeholderTextColor="rgba(136,14,79,0.5)"
                    value={selectedTime}
                    onChangeText={onChangeTime}
                    onBlur={() => onChangeTime?.(normalizeManualTimeInput(selectedTime))}
                    autoCapitalize="characters"
                  />
                </View>

                <View style={styles.modalInput}>
                  <Ionicons name="time" size={16} color="#C2185B" />
                  <TextInput
                    style={styles.modalTextInput}
                    placeholder="10:00 PM"
                    placeholderTextColor="rgba(136,14,79,0.5)"
                    value={selectedEndTime}
                    onChangeText={onChangeEndTime}
                    onBlur={() => onChangeEndTime?.(normalizeManualTimeInput(selectedEndTime))}
                    autoCapitalize="characters"
                  />
                </View>
              </>
            ) : (
              <>
                <TouchableOpacity style={styles.modalInput} onPress={onOpenStartTimePicker}>
                  <Ionicons name="time" size={16} color="#C2185B" />
                  <Text style={styles.modalInputText}>
                    {selectedTime || "Select start time"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.modalInput} onPress={onOpenEndTimePicker}>
                  <Ionicons name="time" size={16} color="#C2185B" />
                  <Text style={styles.modalInputText}>
                    {selectedEndTime || "Select end time"}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <View style={styles.modalInput}>
              <Ionicons name="hourglass" size={16} color="#C2185B" />
              <Text style={styles.modalInputText}>
                {hireHours ? `Hours: ${hireHours}` : "Hours: --"}
              </Text>
            </View>

            <View style={styles.modalInput}>
              <Ionicons name="cash" size={16} color="#C2185B" />
              <Text style={styles.modalInputText}>
                {hirePrice ? `Total: ${hirePrice}` : "Total: --"}
              </Text>
            </View>

            {!hasPaymentMethod ? (
              <View style={styles.hirePaymentNoticeCard}>
                <View style={styles.hirePaymentNoticeIcon}>
                  <Ionicons name="card-outline" size={16} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hirePaymentNoticeTitle}>Payment method required</Text>
                  <Text style={styles.hirePaymentNoticeText}>
                    Add and verify a payment method before sending a hire request.
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.hirePaymentNoticeBtn,
                      checkingPaymentMethod && { opacity: 0.7 },
                    ]}
                    onPress={() => onRequirePayment?.()}
                    disabled={checkingPaymentMethod}
                  >
                    <Text style={styles.hirePaymentNoticeBtnText}>
                      {checkingPaymentMethod ? "Checking payment..." : "Add payment method"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <View style={styles.modalInput}>
              <Ionicons name="location" size={16} color="#C2185B" />
              <TextInput
                style={styles.modalTextInput}
                placeholder="Address"
                placeholderTextColor="rgba(136,14,79,0.5)"
                value={locationLabel}
                onChangeText={(next) => {
                  onChangeLocation(next);
                  onShowLocationSuggestions?.();
                }}
                returnKeyType="search"
                onSubmitEditing={() => onSearchLocation?.(locationLabel)}
                onFocus={() => onShowLocationSuggestions?.()}
                onBlur={() => {
                  setTimeout(() => onHideLocationSuggestions?.(), 120);
                }}
              />
              <TouchableOpacity
                style={styles.modalLocationBtn}
                onPress={() => onSearchLocation?.(locationLabel)}
                disabled={!!searchingLocation}
                accessibilityLabel="Search address"
              >
                {searchingLocation ? (
                  <ActivityIndicator color="#C2185B" />
                ) : (
                  <Ionicons name="search" size={16} color="#C2185B" />
                )}
              </TouchableOpacity>
            </View>

            {showLocationSuggestions &&
            (loadingLocationSuggestions ||
              locationSuggestions.length > 0 ||
              String(locationLabel || "").trim().length >= 2) ? (
              <View style={styles.locationSuggestionsBox}>
                {loadingLocationSuggestions ? (
                  <View style={styles.locationSuggestionLoading}>
                    <ActivityIndicator size="small" color="#C2185B" />
                    <Text style={styles.locationSuggestionLoadingText}>Searching addresses...</Text>
                  </View>
                ) : (
                  <>
                    {locationSuggestions.map((item: LocationSuggestion) => (
                      <TouchableOpacity
                        key={item.placeId}
                        style={styles.locationSuggestionItem}
                        activeOpacity={0.85}
                        onPress={() => {
                          void onApplyLocationSuggestion?.(item);
                        }}
                      >
                        <Ionicons name="location-outline" size={16} color="#C2185B" />
                        <View style={styles.locationSuggestionTextWrap}>
                          <Text style={styles.locationSuggestionPrimary}>{item.mainText}</Text>
                          {!!item.secondaryText && (
                            <Text style={styles.locationSuggestionSecondary}>
                              {item.secondaryText}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                    {locationSuggestions.length === 0 &&
                    String(locationLabel || "").trim().length >= 2 ? (
                      <View style={styles.locationSuggestionEmpty}>
                        <Text style={styles.locationSuggestionEmptyText}>
                          No matching addresses found.
                        </Text>
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}

            <TouchableOpacity style={styles.hireBtn} onPress={onConfirm}>
              <Text style={styles.hireBtnText}>Confirm</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} style={{ marginTop: rs(10) }}>
              <Text style={{ textAlign: "center", color: "#C2185B" }}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const ChildCardsModal = ({
  visible,
  kids,
  selectedChildIds,
  onToggleChild,
  onClose,
}: any) => (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    presentationStyle="overFullScreen"
    statusBarTranslucent
  >
    <View style={styles.modalBackdrop}>
      <View style={[styles.modalCard, { maxHeight: "70%" }]}>
        <View style={styles.modalHeaderRow}>
          <Text style={styles.modalTitle}>Your Children</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeIcon}>
            <Ionicons name="close" size={18} color="#C2185B" />
          </TouchableOpacity>
        </View>

        {(kids || []).length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="people-outline" size={36} color="#FF80AB" />
            <Text style={styles.emptyText}>No children found</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingVertical: rs(6) }}>
            {(kids || []).map((c: Child) => (
              <TouchableOpacity
                key={c.id}
                activeOpacity={0.9}
                style={[
                  styles.childCard,
                  selectedChildIds?.includes(c.id) && styles.childSelected,
                ]}
                onPress={() => {
                  onToggleChild?.(c.id);
                }}
              >
                <View style={styles.childAvatar}>
                  <Ionicons name="person" size={16} color="#FF80AB" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.childName}>{c.name || "Child"}</Text>
                  <Text style={styles.childMeta}>
                    {[c.gender, c.age ? `${c.age} yrs` : null]
                      .filter(Boolean)
                      .join(" • ")}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  </Modal>
);

/* ----------------------------- STYLES ----------------------------- */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FFFFFF" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  header: {
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: rs(14),
    paddingTop: rs(18),
    paddingBottom: rs(14),
    borderBottomLeftRadius: rs(18),
    borderBottomRightRadius: rs(18),
    elevation: 2,
    marginBottom: rs(10),
  },
  headerIcon: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#FFF1F6",
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconGhost: {
    width: rs(34),
    height: rs(34),
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#C2185B",
    fontSize: rf(16),
    fontWeight: "700",
    marginHorizontal: rs(10),
  },

  hero: {
    alignItems: "center",
    paddingVertical: rs(18),
    paddingHorizontal: rs(12),
    backgroundColor: "#FFFFFF",
  },
  heroAvatar: { width: rs(110), height: rs(110), borderRadius: rs(55), backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  heroImg: { width: rs(106), height: rs(106), borderRadius: rs(53) },
  heroInitials: { width: rs(90), height: rs(90), borderRadius: rs(45), backgroundColor: "#FFEFF5", alignItems: "center", justifyContent: "center" },
  heroLogo: { width: "62%", height: "62%" },
  heroInitialsText: { fontSize: rf(26), fontWeight: "800", color: "#C2185B" },
  heroName: { fontSize: rf(20), fontWeight: "800", color: "#C2185B", marginTop: rs(6) },
  heroTags: { flexDirection: "row", flexWrap: "wrap", gap: rs(8), marginTop: rs(8), justifyContent: "center", paddingHorizontal: rs(8) },

  tag: { flexDirection: "row", backgroundColor: "#FFF5F9", padding: rs(6), borderRadius: rs(12), maxWidth: "92%" },
  tagText: { color: "#C2185B", fontWeight: "700", marginLeft: rs(6), flexShrink: 1 },

  actionRow: { flexDirection: "row", paddingHorizontal: rs(14), paddingVertical: rs(6), gap: rs(12) },
  actionRowStack: { flexDirection: "column", gap: rs(8) },
  actionBtn: {
    flex: 1,
    minWidth: rs(128),
    flexShrink: 1,
    borderWidth: 1,
    borderColor: "#FF80AB",
    borderRadius: rs(22),
    height: rs(44),
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: rs(8),
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 2,
  },
  actionBtnFilled: { backgroundColor: "#FF80AB", borderWidth: 0 },
  actionBtnText: { fontWeight: "700", color: "#C2185B", flexShrink: 1 },
  actionBtnDisabled: { opacity: 0.6 },
  favoriteBtn: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    alignSelf: "center",
    gap: rs(8),
    paddingHorizontal: rs(18),
    paddingVertical: rs(10),
    borderRadius: rs(20),
    borderWidth: 1,
    borderColor: "#FF80AB",
    backgroundColor: "#fff",
    marginBottom: rs(6),
  },
  favoriteBtnActive: {
    backgroundColor: "#FF80AB",
    borderColor: "#FF80AB",
  },
  favoriteText: { fontWeight: "700", color: "#C2185B", fontSize: rf(12), flexShrink: 1 },
  favoriteTextActive: { color: "#fff" },
  profileTabsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: rs(8),
    paddingHorizontal: rs(14),
    marginTop: rs(6),
    marginBottom: rs(4),
  },
  profileTabBtn: {
    minWidth: rs(86),
    paddingHorizontal: rs(16),
    paddingVertical: rs(10),
    borderRadius: rs(18),
    borderWidth: 1,
    borderColor: "#FFB4CD",
    backgroundColor: "#FFF7FA",
    alignItems: "center",
    justifyContent: "center",
  },
  profileTabBtnActive: {
    backgroundColor: "#FF80AB",
    borderColor: "#FF80AB",
  },
  profileTabText: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(12),
  },
  profileTabTextActive: {
    color: "#fff",
  },

  sectionBox: {
    marginHorizontal: rs(14),
    marginVertical: rs(8),
    padding: rs(14),
    backgroundColor: "#fff",
    borderRadius: rs(16),
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionHeading: { fontSize: rf(14), fontWeight: "800", color: "#880E4F", marginBottom: rs(6) },
  bodyText: { fontSize: rf(13), color: "#6B4350" },

  availRow: { marginBottom: rs(8) },
  availDay: { fontWeight: "700", color: "#880E4F" },
  slotRow: { flexDirection: "row", flexWrap: "wrap", gap: rs(6) },
  slotPill: { backgroundColor: "#FFF0F5", padding: rs(6), borderRadius: rs(10) },
  slotText: { fontSize: rf(11), color: "#C2185B" },
  calendarCard: {
    backgroundColor: "#FFF7FA",
    borderRadius: rs(14),
    padding: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    marginBottom: rs(10),
  },
  timeOverlay: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: rs(20),
  },
  timeCard: {
    width: "100%",
    maxWidth: rs(320),
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "#FFE0EB",
  },
  dateCard: {
    width: "100%",
    maxWidth: rs(320),
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "#FFE0EB",
  },
  dateDisplay: {
    color: "#C2185B",
    fontSize: rf(22),
    fontWeight: "700",
    marginBottom: rs(14),
  },
  dateHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(10),
  },
  dateMonthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
  },
  dateMonthLabel: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(14),
  },
  dateArrows: {
    flexDirection: "row",
    gap: rs(10),
  },
  dateArrowBtn: {
    width: rs(28),
    height: rs(28),
    borderRadius: rs(14),
    alignItems: "center",
    justifyContent: "center",
  },
  weekRowPicker: {
    flexDirection: "row",
    width: "100%",
    marginBottom: rs(6),
  },
  weekLabelPicker: {
    width: "14.28%",
    textAlign: "center",
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(12),
  },
  daysGridPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: "100%",
  },
  dayCellPicker: {
    width: "14.28%",
    height: rs(36),
    alignItems: "center",
    justifyContent: "center",
    marginVertical: rs(2),
  },
  dayCellSelected: {
    backgroundColor: "#FFD772",
    borderRadius: rs(16),
  },
  dayLabelPicker: {
    color: "#C2185B",
    fontWeight: "600",
    fontSize: rf(12),
  },
  dayLabelSelected: {
    color: "#9A6400",
    fontWeight: "700",
  },
  timeTitle: {
    color: "#C2185B",
    fontSize: rf(14),
    fontWeight: "700",
    marginBottom: rs(8),
    letterSpacing: rs(1),
    textTransform: "uppercase",
  },
  timeHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(16),
  },
  timeDisplayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(4),
  },
  timeDisplay: {
    color: "#C2185B",
    fontSize: rf(34),
    fontWeight: "700",
    letterSpacing: rs(1),
  },
  timeDisplayActive: {
    color: "#F4B000",
  },
  timeDisplayColon: {
    color: "#C2185B",
    fontSize: rf(34),
    fontWeight: "700",
  },
  periodColumn: {
    gap: rs(8),
  },
  periodBtn: {
    paddingVertical: rs(6),
    paddingHorizontal: rs(10),
    borderRadius: rs(8),
    borderWidth: 1,
    borderColor: "#FFD1DF",
    backgroundColor: "#fff",
  },
  periodBtnActive: {
    backgroundColor: "#FFD772",
    borderColor: "#F4B000",
  },
  periodText: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(12),
  },
  periodTextActive: {
    color: "#9A6400",
  },
  clockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: rs(10),
  },
  clockArrow: {
    width: rs(28),
    height: rs(28),
    borderRadius: rs(14),
    alignItems: "center",
    justifyContent: "center",
  },
  clockDial: {
    width: rs(220),
    height: rs(220),
    borderRadius: rs(110),
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  minuteDot: {
    position: "absolute",
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    alignItems: "center",
    justifyContent: "center",
  },
  minuteDotActive: {
    backgroundColor: "#FFD772",
  },
  minuteText: {
    color: "#C2185B",
    fontSize: rf(12),
  },
  minuteTextActive: {
    color: "#9A6400",
    fontWeight: "700",
  },
  minuteNeedleWrap: {
    position: "absolute",
    top: "50%",
    left: "50%",
    alignItems: "center",
    transform: [{ translateX: -22 }, { translateY: -22 }],
  },
  minuteNeedle: {
    width: rs(2),
    height: rs(70),
    backgroundColor: "#FFD772",
    borderRadius: rs(2),
    marginTop: rs(-70),
  },
  minuteKnob: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    backgroundColor: "#FFD772",
    alignItems: "center",
    justifyContent: "center",
    marginTop: rs(-12),
  },
  minuteKnobText: {
    color: "#9A6400",
    fontWeight: "700",
  },
  timeActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: rs(16),
    marginTop: rs(12),
  },
  timeCancel: {
    color: "#C2185B",
    fontWeight: "700",
  },
  timeOk: {
    color: "#C2185B",
    fontWeight: "700",
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(10),
  },
  monthLabel: { fontSize: rf(14), fontWeight: "700", color: "#C2185B" },
  weekRow: { flexDirection: "row", justifyContent: "space-between" },
  weekLabel: { width: "14.28%", textAlign: "center", fontSize: rf(11), color: "#AD1457", fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: rs(6) },
  emptyCell: { width: "14.28%", height: rs(34) },
  dayCell: { width: "14.28%", alignItems: "center", paddingVertical: rs(4) },
  dayBubble: { width: rs(30), height: rs(30), borderRadius: rs(15), alignItems: "center", justifyContent: "center" },
  dayToday: { backgroundColor: "#FFEB3B", borderWidth: 1, borderColor: "#FBC02D" },
  dayHasEvent: { backgroundColor: "#FFE4EC", borderWidth: 1, borderColor: "#FF80AB" },
  daySelected: { backgroundColor: "#FFD772", borderWidth: 1, borderColor: "#F4B000" },
  dayText: { color: "#880E4F", fontSize: rf(12), fontWeight: "600" },
  dayTextToday: { color: "#5D4037" },
  dayTextActive: { color: "#C2185B" },
  dayTextSelected: { color: "#9A6400", fontWeight: "700" },
  dayDot: { position: "absolute", top: rs(4), right: rs(4), width: rs(5), height: rs(5), borderRadius: rs(3), backgroundColor: "#FF80AB" },
  reviewsSummaryRow: {
    flexDirection: "row",
    gap: rs(10),
    marginBottom: rs(14),
  },
  reviewMetricCard: {
    flex: 1,
    backgroundColor: "#FFF6FA",
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    paddingVertical: rs(12),
    paddingHorizontal: rs(10),
    alignItems: "center",
  },
  reviewMetricValue: {
    color: "#C2185B",
    fontSize: rf(16),
    fontWeight: "800",
  },
  reviewMetricLabel: {
    color: "#AD1457",
    fontSize: rf(10),
    fontWeight: "600",
    marginTop: rs(4),
    textAlign: "center",
  },
  reviewList: {
    gap: rs(10),
  },
  reviewCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.16)",
    padding: rs(12),
  },
  reviewCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: rs(10),
    marginBottom: rs(8),
  },
  reviewAuthor: {
    color: "#880E4F",
    fontSize: rf(13),
    fontWeight: "700",
  },
  reviewDate: {
    color: "#AD1457",
    fontSize: rf(10),
    marginTop: rs(2),
  },
  reviewRatingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(4),
    backgroundColor: "#FFF1F6",
    borderRadius: rs(999),
    paddingHorizontal: rs(8),
    paddingVertical: rs(5),
  },
  reviewRatingText: {
    color: "#C2185B",
    fontSize: rf(11),
    fontWeight: "700",
  },
  reviewBody: {
    color: "#6B4350",
    fontSize: rf(12),
    lineHeight: rs(18),
  },

  childBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: rs(16),
    marginTop: rs(-6),
    marginBottom: rs(10),
    gap: rs(10),
  },
  childFab: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(21),
    backgroundColor: "#FFF5F8",
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  childHint: { fontSize: rf(12), color: "#AD1457", fontWeight: "600" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: rs(20),
    borderTopRightRadius: rs(20),
    padding: rs(16),
    maxHeight: "85%",
  },
  modalScrollContent: {
    paddingBottom: rs(6),
    flexGrow: 1,
  },
  modalTitle: { fontSize: rf(16), fontWeight: "700", color: "#880E4F", marginBottom: rs(10) },
  modalHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: rs(6) },
  closeIcon: {
    width: rs(26),
    height: rs(26),
    borderRadius: rs(13),
    backgroundColor: "#FFE7EF",
    alignItems: "center",
    justifyContent: "center",
  },
  modalInput: { flexDirection: "row", alignItems: "center", padding: rs(10), borderWidth: 1, borderColor: "#FF80AB40", borderRadius: rs(10), marginBottom: rs(10) },
  modalInputText: { marginLeft: rs(8), color: "#880E4F" },
  hirePaymentNoticeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: rs(10),
    backgroundColor: "#FFF5F9",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.28)",
    borderRadius: rs(16),
    paddingHorizontal: rs(12),
    paddingVertical: rs(12),
    marginBottom: rs(12),
  },
  hirePaymentNoticeIcon: {
    width: rs(28),
    height: rs(28),
    borderRadius: rs(14),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF80AB",
    marginTop: rs(2),
  },
  hirePaymentNoticeTitle: {
    color: "#880E4F",
    fontWeight: "700",
    fontSize: rf(13),
    marginBottom: rs(3),
  },
  hirePaymentNoticeText: {
    color: "#AD1457",
    fontSize: rf(11),
    lineHeight: rs(16),
  },
  hirePaymentNoticeBtn: {
    marginTop: rs(10),
    alignSelf: "flex-start",
    backgroundColor: "#FF80AB",
    paddingHorizontal: rs(14),
    paddingVertical: rs(10),
    borderRadius: rs(12),
  },
  hirePaymentNoticeBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(12),
  },
  modalTextInput: {
    flex: 1,
    marginLeft: rs(8),
    color: "#880E4F",
    paddingVertical: rs(0),
  },
  modalLocationBtn: {
    marginLeft: rs(8),
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    backgroundColor: "#FFF1F6",
    alignItems: "center",
    justifyContent: "center",
  },
  locationSuggestionsBox: {
    marginTop: rs(-2),
    marginBottom: rs(10),
    borderWidth: 1,
    borderColor: "#FF80AB30",
    borderRadius: rs(12),
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  locationSuggestionLoading: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: rs(12),
    paddingVertical: rs(12),
    gap: rs(8),
  },
  locationSuggestionLoadingText: {
    color: "#AD1457",
    fontSize: rf(12),
  },
  locationSuggestionItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: rs(10),
    paddingHorizontal: rs(12),
    paddingVertical: rs(11),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#FF80AB20",
  },
  locationSuggestionTextWrap: {
    flex: 1,
  },
  locationSuggestionPrimary: {
    color: "#880E4F",
    fontSize: rf(13),
    fontWeight: "600",
  },
  locationSuggestionSecondary: {
    color: "#AD1457",
    fontSize: rf(11),
    marginTop: rs(2),
  },
  locationSuggestionEmpty: {
    paddingHorizontal: rs(12),
    paddingVertical: rs(12),
  },
  locationSuggestionEmptyText: {
    color: "#AD1457",
    fontSize: rf(12),
  },
  childPillRow: { flexDirection: "row", alignItems: "center", gap: rs(8), marginBottom: rs(12), paddingRight: rs(6) },
  childPill: {
    paddingHorizontal: rs(12),
    paddingVertical: rs(6),
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "#FF80AB60",
    backgroundColor: "#FFF7FA",
  },
  childPillSelected: { backgroundColor: "#FF80AB", borderColor: "#FF80AB" },
  childPillText: { color: "#C2185B", fontWeight: "700", fontSize: rf(12) },
  childHintText: { color: "#AD1457", fontSize: rf(12), marginBottom: rs(8) },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: rs(12),
    gap: rs(6),
  },
  emptyText: { color: "#AD1457", fontSize: rf(13), fontWeight: "600" },

  childRow: { flexDirection: "row", alignItems: "center", padding: rs(8), borderWidth: 1, borderColor: "#FF80AB30", borderRadius: rs(10), marginBottom: rs(6) },
  childSelected: { borderColor: "#FF80AB", backgroundColor: "#FFF5F8" },

  kidAvatar: { width: rs(32), height: rs(32), borderRadius: rs(16), backgroundColor: "#FFE1EC", alignItems: "center", justifyContent: "center", marginRight: rs(8) },
  kidAvatarText: { fontWeight: "700", color: "#C2185B" },
  kidName: { fontWeight: "600", color: "#880E4F" },

  childCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: rs(10),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB30",
    marginBottom: rs(10),
    backgroundColor: "#FFF9FB",
    gap: rs(10),
  },
  childAvatar: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#FFE7EF",
    alignItems: "center",
    justifyContent: "center",
  },
  childName: { fontWeight: "700", color: "#880E4F", fontSize: rf(14) },
  childMeta: { color: "#AD1457", fontSize: rf(12), marginTop: rs(2) },

  hireBtn: { backgroundColor: "#FF80AB", paddingVertical: rs(12), borderRadius: rs(14), alignItems: "center", marginTop: rs(10) },
  hireBtnText: { color: "#fff", fontWeight: "700" },
});
