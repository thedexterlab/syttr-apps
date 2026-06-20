import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest, BASE_URL, GOOGLE_MAPS_KEY, sanitizeToken } from "../Api";
import { geocodeAddress } from "../utils/geocodeAddress";
import { Location } from "../utils/safeLocation";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Dimensions,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { hp, rf, rs, wp } from "../utils/responsive";
import SpinnerTimePicker from "./SpinnerTimePicker";

/* -------------------------------- TYPES -------------------------------- */

type Child = {
  id: number;
  name: string;
  age?: number;
  gender?: string;
};

type LocationSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

type Props = {
  location?: string;
  latitude?: number;
  longitude?: number;
  navigation?: { goBack?: () => void };
  onBack?: () => void;
  onSuccess?: () => void;
  onAddChild?: () => void;
  onRequirePayment?: () => void;
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const DIAL_SIZE = Math.min(Math.max(SCREEN_WIDTH * 0.56, 180), 260);
const DIAL_CENTER = DIAL_SIZE / 2;
const KNOB_SIZE = Math.round(DIAL_SIZE * 0.2);
const DIAL_MARK_SIZE = Math.round(DIAL_SIZE * 0.145);
const DIAL_NEEDLE_HEIGHT = Math.round(DIAL_SIZE * 0.32);
const CALENDAR_COLUMNS = 7;
const CALENDAR_CELL_SIZE = Math.floor(Math.min(Math.max(SCREEN_WIDTH * 0.11, 30), 42));
const CALENDAR_GRID_WIDTH = CALENDAR_COLUMNS * CALENDAR_CELL_SIZE;
const API_BASE_URL = String(BASE_URL || "").replace(/\/+$/, "");

const getMinuteMarks = () => {
  const size = DIAL_SIZE;
  const radius = size * 0.39;
  const center = size / 2;
  const marks = [];
  for (let i = 0; i < 60; i += 5) {
    const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
    const x = center + radius * Math.cos(angle) - DIAL_MARK_SIZE / 2;
    const y = center + radius * Math.sin(angle) - DIAL_MARK_SIZE / 2;
    marks.push({ value: i, x, y });
  }
  return marks;
};

const getHourMarks = () => {
  const size = DIAL_SIZE;
  const radius = size * 0.32;
  const center = size / 2;
  const marks = [];
  for (let i = 1; i <= 12; i += 1) {
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
    const x = center + radius * Math.cos(angle) - DIAL_MARK_SIZE / 2;
    const y = center + radius * Math.sin(angle) - DIAL_MARK_SIZE / 2;
    marks.push({ value: i, x, y });
  }
  return marks;
};

const getMonthLabel = (date: Date) =>
  date.toLocaleString("en-US", { month: "long", year: "numeric" });

const buildMonthDays = (monthDate: Date) => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const daysInMonth = lastOfMonth.getDate();
  const startWeekday = firstOfMonth.getDay();

  const days: Array<{ date: Date | null; key: string }> = [];
  for (let i = 0; i < startWeekday; i += 1) {
    days.push({ date: null, key: `pad-${month}-${i}` });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    days.push({ date: new Date(year, month, d), key: `day-${month}-${d}` });
  }
  const remainder = days.length % 7;
  if (remainder) {
    for (let i = 0; i < 7 - remainder; i += 1) {
      days.push({ date: null, key: `trail-${month}-${i}` });
    }
  }
  return days;
};

const to24HourTime = (value: string) => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (!match) return value.trim();
  let hours = Number(match[1]);
  const minutes = match[2];
  const period = match[3]?.toUpperCase();
  if (period === "PM" && hours < 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${minutes}`;
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

const sanitizeCurrencyInput = (value: string) => {
  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("")}`;
};

const parseTimeValueToDate = (value?: string | Date | null) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime());
  }
  const normalized = to24HourTime(String(value || ""));
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const next = new Date();
  next.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return next;
};

const formatTimeDisplay = (value?: Date | string | null) => {
  const parsed = parseTimeValueToDate(value);
  if (!parsed) return "";
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const calculateHoursBetweenTimes = (
  startValue?: Date | string | null,
  endValue?: Date | string | null
) => {
  const start = parseTimeValueToDate(startValue);
  const end = parseTimeValueToDate(endValue);
  if (!start || !end) return null;

  let diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) {
    diffMs += 24 * 60 * 60 * 1000;
  }

  const diffHours = diffMs / (60 * 60 * 1000);
  if (!Number.isFinite(diffHours) || diffHours <= 0) return null;
  return Math.round(diffHours * 100) / 100;
};

const formatHoursValue = (value: number) =>
  Number.isInteger(value) ? String(value) : String(value);

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const isPastDate = (date: Date | null) => {
  if (!date) return false;
  return startOfDay(date).getTime() < startOfDay(new Date()).getTime();
};

const toLocalDateString = (date: Date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const formatDateDisplay = (date: Date) => {
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" }).replace(/\.$/, "");
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday}. ${month} ${date.getDate()}, ${date.getFullYear()}`;
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

const sanitizeLocationLabel = (value: string) => dedupeAddressParts(String(value || "").split(","));
const cleanStoredValue = (value?: string | null) =>
  String(value || "").trim().replace(/^["']+|["']+$/g, "");
const looksLikePublicUserId = (value?: string | null) => {
  const raw = cleanStoredValue(value).toUpperCase();
  return raw.length >= 5 && /[A-Z]/.test(raw) && /\d/.test(raw);
};
const pickBestUserId = (candidates: Array<string | null | undefined>) => {
  for (const candidate of candidates) {
    if (looksLikePublicUserId(candidate)) {
      return cleanStoredValue(candidate).toUpperCase();
    }
  }
  for (const candidate of candidates) {
    const raw = cleanStoredValue(candidate);
    if (raw) return raw;
  }
  return "";
};
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

    // Prefer street-level address matches first for partial inputs like "1121 aldine".
    const addressRes = await fetch(buildUrl("address"), { headers: { Accept: "application/json" } });
    if (!addressRes.ok) return [];
    const addressJson = await addressRes.json().catch(() => null);
    let predictions = Array.isArray(addressJson?.predictions) ? addressJson.predictions : [];

    // Fallback to broader geocode results if strict address predictions are empty.
    if (predictions.length === 0) {
      const geocodeRes = await fetch(buildUrl("geocode"), { headers: { Accept: "application/json" } });
      if (geocodeRes.ok) {
        const geocodeJson = await geocodeRes.json().catch(() => null);
        predictions = Array.isArray(geocodeJson?.predictions) ? geocodeJson.predictions : [];
      }
    }

    return predictions.slice(0, LOCATION_AUTOCOMPLETE_LIMIT).map((item: any) => ({
      placeId: String(item?.place_id || ""),
      description: String(item?.description || "").trim(),
      mainText: String(item?.structured_formatting?.main_text || item?.description || "").trim(),
      secondaryText: String(item?.structured_formatting?.secondary_text || "").trim(),
    })).filter((item: LocationSuggestion) => item.placeId && item.description);
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
/* -------------------------------- COMPONENT -------------------------------- */

export default function PostJobScreen({
  location = "Selected Location",
  latitude,
  longitude,
  navigation,
  onBack,
  onSuccess,
  onAddChild,
  onRequirePayment,
}: Props) {
  const [children, setChildren] = useState<Child[]>([]);
  const [loadingChildren, setLoadingChildren] = useState<boolean>(true);
  const [selectedChildIds, setSelectedChildIds] = useState<number[]>([]);

  const [hourlyRate, setHourlyRate] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedDateText, setSelectedDateText] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<string>("");
  const [selectedEndTime, setSelectedEndTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<string>("");
  const [locationLabel, setLocationLabel] = useState<string>(location);
  const [locLat, setLocLat] = useState<number | null>(
    Number.isFinite(latitude as number) ? Number(latitude) : null
  );
  const [locLon, setLocLon] = useState<number | null>(
    Number.isFinite(longitude as number) ? Number(longitude) : null
  );
  const [geocodingLocation, setGeocodingLocation] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [loadingLocationSuggestions, setLoadingLocationSuggestions] = useState(false);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);

  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(new Date());
  const [monthCursor, setMonthCursor] = useState<Date>(new Date());
  // Web-specific values (we use native <input type="date"> for calendar)
  const [webDateValue, setWebDateValue] = useState("");
  const [posting, setPosting] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [hasPaymentMethod, setHasPaymentMethod] = useState(false);
  const [checkingPaymentMethod, setCheckingPaymentMethod] = useState(true);
  const numberKeyboardAccessoryId = "post-job-number-accessory";
  const [fieldErrors, setFieldErrors] = useState<{
    rate?: boolean;
    date?: boolean;
    children?: boolean;
    time?: boolean;
    endTime?: boolean;
    location?: boolean;
  }>({});
  const MIN_HOURLY_RATE = 20;
  const parsedRate = Number(String(hourlyRate).replace(/[^0-9.]/g, ""));
  const hourlyRateDisplay = hourlyRate ? `${hourlyRate}$` : "";
  const calculatedHours = useMemo(
    () => calculateHoursBetweenTimes(selectedTime ?? startTime, selectedEndTime ?? endTime),
    [endTime, selectedEndTime, selectedTime, startTime]
  );
  const hasValidHours = useMemo(
    () => Number.isFinite(calculatedHours) && Number(calculatedHours) > 0,
    [calculatedHours]
  );
  const hasValidRate = useMemo(
    () => Number.isFinite(parsedRate) && parsedRate >= MIN_HOURLY_RATE,
    [parsedRate]
  );
  const hasTime = useMemo(() => !!startTime.trim(), [startTime]);
  const hasEndTime = useMemo(() => !!endTime.trim(), [endTime]);
  const hasDate = useMemo(() => !!selectedDate, [selectedDate]);
  const hasValidDate = useMemo(
    () => !!selectedDate && !isPastDate(selectedDate),
    [selectedDate]
  );
  const hasChildren = useMemo(() => selectedChildIds.length > 0, [selectedChildIds.length]);
  const hasLocation = useMemo(
    () =>
      !!locationLabel &&
      locationLabel.trim() !== "" &&
      locationLabel !== "Selected Location",
    [locationLabel]
  );
  const hasVerifiedLocation = useMemo(
    () => hasLocation && Number.isFinite(locLat) && Number.isFinite(locLon),
    [hasLocation, locLat, locLon]
  );
  const canSubmit = useMemo(
    () =>
      hasChildren &&
      hasValidHours &&
      hasValidRate &&
      hasValidDate &&
      hasTime &&
      hasEndTime &&
      hasVerifiedLocation &&
      hasPaymentMethod &&
      !checkingPaymentMethod &&
      !posting,
    [
      hasChildren,
      hasValidHours,
      hasValidRate,
      hasValidDate,
      hasTime,
      hasEndTime,
      hasVerifiedLocation,
      hasPaymentMethod,
      checkingPaymentMethod,
      posting,
    ]
  );
  const monthDays = useMemo(() => buildMonthDays(monthCursor), [monthCursor]);
  const totalPrice =
    Number.isFinite(calculatedHours) && Number.isFinite(parsedRate)
      ? Number(calculatedHours) * parsedRate
      : NaN;
  const showTotal = Number.isFinite(totalPrice) && totalPrice > 0;

  const showAlert = (title: string, message?: string) => {
    if (Platform.OS === "web") {
      window.alert([title, message].filter(Boolean).join("\n"));
      return;
    }
    Alert.alert(title, message);
  };

  const isParentVerified = async () => {
    const raw = await AsyncStorage.getItem("user_verification_status");
    const val = (raw || "").toLowerCase().trim();
    return (
      val === "verified" ||
      val === "approved" ||
      val === "completed" ||
      val === "quickapp-completed"
    );
  };

  const getAuthContext = async () => {
    const [tokenRaw, apiKeyStored, userIdStored, fallbackUserId, userEmailStored, nannyEmailStored] = await Promise.all([
      AsyncStorage.getItem("token"),
      AsyncStorage.getItem("api_key"),
      AsyncStorage.getItem("user_id"),
      AsyncStorage.getItem("id"),
      AsyncStorage.getItem("user_email"),
      AsyncStorage.getItem("nanny_email"),
    ]);
    const token = sanitizeToken(tokenRaw || undefined);

    const apiKey =
      apiKeyStored ||
      (typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_API_KEY : undefined) ||
      undefined;
    const resolvedUserId = pickBestUserId([userIdStored, fallbackUserId]) || undefined;
    const resolvedUserEmail =
      cleanStoredValue(userEmailStored || nannyEmailStored || undefined).toLowerCase() || undefined;

    if (resolvedUserId && looksLikePublicUserId(resolvedUserId)) {
      const normalizedStoredUserId = cleanStoredValue(userIdStored).toUpperCase();
      if (normalizedStoredUserId !== resolvedUserId) {
        await AsyncStorage.setItem("user_id", resolvedUserId);
      }
    }

    return {
      token: token || undefined,
      apiKey,
      userId: resolvedUserId,
      userEmail: resolvedUserEmail,
      authHeaders: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      } as Record<string, string>,
    };
  };

  const fetchPaymentMethods = async (): Promise<boolean | null> => {
    try {
      setCheckingPaymentMethod(true);
      const { authHeaders, userId, userEmail } = await getAuthContext();
      const queryParts = [
        ...(userId ? [`user_id=${encodeURIComponent(userId)}`] : []),
        ...(!userId && userEmail ? [`user_email=${encodeURIComponent(userEmail)}`] : []),
      ];
      const query = queryParts.length ? `?${queryParts.join("&")}` : "";
      const json = await apiRequest<any>(`payment-method${query}`, {
        headers: authHeaders,
      });
      const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      const hasAny = list.length > 0;
      setHasPaymentMethod(hasAny);
      return hasAny;
    } catch {
      // Match the runtime fallback in requirePaymentMethod so the CTA does not stay blocked.
      setHasPaymentMethod(true);
      return null;
    } finally {
      setCheckingPaymentMethod(false);
    }
  };

  const requirePaymentMethod = async (openPaymentScreen = true): Promise<boolean> => {
    const hasMethod = await fetchPaymentMethods();
    if (hasMethod) return true;

    if (hasMethod === false) {
      showAlert(
        "Payment method required",
        "Please add a valid payment method to your account before posting a babysitting job."
      );
      if (openPaymentScreen) onRequirePayment?.();
      return false;
    }

    // Local backend may not expose payment-method endpoints yet.
    setHasPaymentMethod(true);
    return true;
  };

  /* ----------------------------- LOAD CHILDREN ----------------------------- */

  useEffect(() => {
    let mounted = true;
    const refreshPending = async () => {
      const verified = await isParentVerified();
      if (mounted) setIsPending(!verified);
    };
    const refreshPaymentMethods = async () => {
      await fetchPaymentMethods();
    };

    loadChildren();
    void refreshPending();
    void refreshPaymentMethods();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshPending();
        void refreshPaymentMethods();
      }
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    const hydrateLocation = async () => {
      try {
        let nextLabel: string | null =
          location && location !== "Selected Location" ? location : null;
        let nextLat: number | null = latitude || null;
        let nextLon: number | null = longitude || null;

        if (Platform.OS === "web") {
          const urlLabel = new URLSearchParams(window.location.search).get("location");
          if (urlLabel && urlLabel.trim()) {
            nextLabel = sanitizeLocationLabel(urlLabel.trim());
          }
        }

        const storedLabel = await AsyncStorage.getItem("last_location_label");
        const storedLat = await AsyncStorage.getItem("last_location_lat");
        const storedLon = await AsyncStorage.getItem("last_location_lon");

        if (storedLabel) nextLabel = nextLabel ?? sanitizeLocationLabel(storedLabel);
        if (storedLat && !Number.isNaN(Number(storedLat))) nextLat = Number(storedLat);
        if (storedLon && !Number.isNaN(Number(storedLon))) nextLon = Number(storedLon);

        const shouldFetchFromDevice =
          !nextLabel || nextLabel === "Selected Location" || nextLat === null || nextLon === null;

        if (shouldFetchFromDevice) {
          try {
            if (Platform.OS !== "web") {
              const { status } = await Location.requestForegroundPermissionsAsync();
              if (status !== "granted") {
                throw new Error("permission");
              }
            }

            const current = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            nextLat = current.coords.latitude;
            nextLon = current.coords.longitude;

            let derivedLabel = `${nextLat.toFixed(4)}, ${nextLon.toFixed(4)}`;
            try {
              const res = await Location.reverseGeocodeAsync({
                latitude: current.coords.latitude,
                longitude: current.coords.longitude,
              });
              if (res?.[0]) {
                const candidate = dedupeAddressParts([
                  res[0].name,
                  res[0].street,
                  res[0].city,
                  res[0].postalCode,
                ]);
                if (candidate) derivedLabel = candidate;
              }
            } catch {
              // ignore reverse geocode errors
            }

            nextLabel = sanitizeLocationLabel(derivedLabel);
            await AsyncStorage.multiSet([
              ["last_location_label", nextLabel],
              ["last_location_lat", String(nextLat)],
              ["last_location_lon", String(nextLon)],
            ]);
          } catch {
            // If permission denied or lookup fails, keep fallbacks below
          }
        }

        if (nextLat !== null) setLocLat(nextLat);
        if (nextLon !== null) setLocLon(nextLon);

        if (nextLabel) {
          setLocationLabel(sanitizeLocationLabel(nextLabel));
        } else if (nextLat !== null && nextLon !== null) {
          setLocationLabel(`${nextLat.toFixed(4)}, ${nextLon.toFixed(4)}`);
        } else if (latitude && longitude) {
          setLocationLabel(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          setLocLat(latitude);
          setLocLon(longitude);
        }
      } catch (e) {
        // ignore
      }
    };
    hydrateLocation();
  }, []);

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

  const loadChildren = async (): Promise<void> => {
    try {
      setLoadingChildren(true);
      const { userId, authHeaders } = await getAuthContext();

      if (!userId) {
        console.log("[PostJob] no user_id in storage");
        setChildren([]);
        return;
      }

      const json = await apiRequest<any>(`user/${encodeURIComponent(String(userId))}/kids`, {
        headers: authHeaders,
      });

      if (Array.isArray(json)) setChildren(json);
      else if (Array.isArray(json.data)) setChildren(json.data);
      else if (Array.isArray(json.kids)) setChildren(json.kids);
      else setChildren([]);
    } catch (e) {
      console.log("Error loading children", e instanceof Error ? e.message : e);
      setChildren([]);
    } finally {
      setLoadingChildren(false);
    }
  };

  const persistLocation = async (label: string, lat?: number | null, lon?: number | null) => {
    const trimmed = sanitizeLocationLabel(label || "");
    if (!trimmed) return;
    const pairs: Array<[string, string]> = [["last_location_label", trimmed]];
    try {
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        pairs.push(["last_location_lat", String(lat)]);
        pairs.push(["last_location_lon", String(lon)]);
        await AsyncStorage.multiSet(pairs);
      } else {
        await AsyncStorage.multiSet(pairs);
        await AsyncStorage.multiRemove(["last_location_lat", "last_location_lon"]);
      }
    } catch {
      // ignore storage failures
    }
  };

  const hideLocationSuggestions = () => {
    setShowLocationSuggestions(false);
    setLocationSuggestions([]);
    setLoadingLocationSuggestions(false);
  };

  const geocodeAndSetLocation = async (query: string) => {
    const trimmed = sanitizeLocationLabel(query || "");
    if (geocodingLocation) return;
    if (!trimmed) {
      showAlert("Missing location", "Please enter an address, city, or ZIP code.");
      return;
    }

    try {
      Keyboard.dismiss();
      hideLocationSuggestions();
      setGeocodingLocation(true);
      setLocationLabel(trimmed);

      const found = await geocodeAddress(trimmed);
      if (found) {
        const nextLat = found.latitude;
        const nextLon = found.longitude;
        const formatted = sanitizeLocationLabel(found.formattedAddress || trimmed);
        setLocLat(nextLat);
        setLocLon(nextLon);
        setLocationLabel(formatted);
        if (fieldErrors.location) {
          setFieldErrors((prev) => ({ ...prev, location: false }));
        }
        await persistLocation(formatted, nextLat, nextLon);
        return;
      }

      showAlert("Location not found", "Try a fuller address, city, or ZIP code.");
    } catch {
      showAlert("Search failed", "Unable to search this location right now.");
    } finally {
      setGeocodingLocation(false);
    }
  };

  const applyLocationSuggestion = async (item: LocationSuggestion) => {
    const fallbackLabel = sanitizeLocationLabel(item.description || "");
    if (!fallbackLabel) return;

    try {
      Keyboard.dismiss();
      hideLocationSuggestions();
      setGeocodingLocation(true);
      setLocationLabel(fallbackLabel);

      const details = await fetchLocationDetails(item.placeId);
      const resolved = details || (await geocodeAddress(fallbackLabel));

      if (resolved) {
        const nextLabel = sanitizeLocationLabel(resolved.formattedAddress || fallbackLabel);
        setLocationLabel(nextLabel);
        setLocLat(resolved.latitude);
        setLocLon(resolved.longitude);
        await persistLocation(nextLabel, resolved.latitude, resolved.longitude);
      } else {
        setLocLat(null);
        setLocLon(null);
        await persistLocation(fallbackLabel, null, null);
      }

      if (fieldErrors.location) {
        setFieldErrors((prev) => ({ ...prev, location: false }));
      }
    } catch {
      showAlert("Search failed", "Unable to apply this location right now.");
    } finally {
      setGeocodingLocation(false);
    }
  };

  /* ----------------------------- POST JOB ----------------------------- */

  const submitJob = async (): Promise<void> => {
    if (posting) return;
    try {
      if (!(await isParentVerified())) {
        showAlert(
          "Verification required",
          "Please verify your account before posting a babysitting job."
        );
        return;
      }
      const { userId: userIdRaw, authHeaders } = await getAuthContext();
      const userId = String(userIdRaw || "").trim();
      if (!userId) {
        showAlert("Missing user", "Please login again and try posting the job.");
        return;
      }
      if (!selectedDate || isPastDate(selectedDate)) {
        showAlert("Invalid date", "Please choose today or a future date.");
        return;
      }
      setPosting(true);
      const startDateStr = toLocalDateString(selectedDate);

      const startTimeForApi = selectedTime
        ? selectedTime.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
        : to24HourTime(startTime);

      let payloadLocation = sanitizeLocationLabel(locationLabel || "");
      let payloadLat = locLat;
      let payloadLon = locLon;
      if (!payloadLocation || !Number.isFinite(payloadLat) || !Number.isFinite(payloadLon)) {
        showAlert(
          "Verified location required",
          "Please select a location from suggestions so we can save an exact address and map coordinates."
        );
        setFieldErrors((prev) => ({ ...prev, location: true }));
        return;
      }

      const payload = {
        kid_ids: selectedChildIds,
        hours: Number(calculatedHours),
        hourly_rate: hourlyRate.trim(),
        price: Number.isFinite(totalPrice) ? totalPrice : undefined,
        start_time: startTimeForApi,
        end_time: to24HourTime(endTime),
        location: payloadLocation || locationLabel,
        ...(Number.isFinite(payloadLat) && Number.isFinite(payloadLon)
          ? { latitude: String(payloadLat), longitude: String(payloadLon) }
          : {}),
        start_date: startDateStr,
        end_date: startDateStr,
        user_id: userId,
      };

      const json = await apiRequest<any>("job/store", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });

      if (json?.success !== false) {
        const onDone = () => {
          setSelectedChildIds([]);
          setHourlyRate("");
          setStartTime("");
          setSelectedTime(null);
          setEndTime("");
          setSelectedEndTime(null);
          setSelectedDate(null);
          setSelectedDateText("");
          setWebDateValue("");
          if (onSuccess) onSuccess();
          else navigation?.goBack?.();
        };
        if (Platform.OS === "web") {
          window.alert("Job posted successfully");
          onDone();
        } else {
          Alert.alert("Success", "Job posted successfully", [
            { text: "OK", onPress: onDone },
          ]);
        }
      } else {
        showAlert("Error", json?.message || json?.error || "Unable to post job right now.");
      }
    } catch (e: any) {
      showAlert("Network error", e?.message || "Something went wrong");
    } finally {
      setPosting(false);
    }
  };

  const postJob = (): void => {
    const errors: typeof fieldErrors = {};
    if (!hasChildren) errors.children = true;
    if (!hasValidRate) errors.rate = true;
    if (!hasValidDate) errors.date = true;
    if (!hasTime || !hasValidHours) errors.time = true;
    if (!hasEndTime || !hasValidHours) errors.endTime = true;
    if (!hasVerifiedLocation) errors.location = true;
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      const rateTooLow =
        Number.isFinite(parsedRate) && parsedRate > 0 && parsedRate < MIN_HOURLY_RATE;
      const pastDateSelected = hasDate && !hasValidDate;
      const invalidTimeRange = hasTime && hasEndTime && !hasValidHours;
      const rateMessage = !hasVerifiedLocation
        ? "Please choose a verified address from suggestions."
        : pastDateSelected
        ? "Date cannot be in the past. Please choose today or a future date."
        : invalidTimeRange
          ? "Please enter a valid start and end time."
        : rateTooLow
          ? `Hourly rate must be at least $${MIN_HOURLY_RATE}.`
          : "Please fill the highlighted fields.";
      showAlert("Missing info", rateMessage);
      return;
    }
    setFieldErrors({});

    const chosenChildren = children
      .filter((c) => selectedChildIds.includes(c.id))
      .map((c) => c.name)
      .filter(Boolean);
    const childrenLabel =
      chosenChildren.length > 0 ? chosenChildren.join(", ") : `${selectedChildIds.length} child(ren)`;

    const dateLabel = selectedDate ? formatDateDisplay(selectedDate) : selectedDateText;
    const hoursLabel =
      Number.isFinite(calculatedHours) && calculatedHours !== null
        ? formatHoursValue(Number(calculatedHours))
        : "--";
    const rateLabel = hourlyRate.trim();
    const timeLabel = startTime.trim();
    const endTimeLabel = endTime.trim();
    const locationLabelSafe = locationLabel || "Selected Location";

    const totalLabel = showTotal ? `$${totalPrice.toFixed(2)}` : "--";
    const confirmationMessage = `Children: ${childrenLabel}\nHours: ${hoursLabel}\nHourly rate: ${rateLabel || "--"}\nTotal price: ${totalLabel}\nStart time: ${timeLabel || "--"}\nEnd time: ${endTimeLabel || "--"}\nDate: ${dateLabel}\nLocation: ${locationLabelSafe}\n\nYour account will be charged when the job is marked completed.`;

    (async () => {
      if (!(await requirePaymentMethod())) return;
      if (!(await isParentVerified())) {
        showAlert(
          "Verification required",
          "Please verify your account before posting a babysitting job."
        );
        return;
      }
      if (Platform.OS === "web") {
        const proceed = window.confirm(`Confirm job post\n\n${confirmationMessage}`);
        if (proceed) submitJob();
      } else {
        Alert.alert(
          "Confirm job post",
          confirmationMessage,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Post", onPress: () => submitJob() },
          ]
        );
      }
    })();
  };

  const handleBack = () => {
    if (onBack) onBack();
    else navigation?.goBack?.();
  };

  /* ----------------------------- PICKERS ----------------------------- */

  const openDatePicker = () => {
    const base = selectedDate && !isPastDate(selectedDate) ? selectedDate : new Date();
    const monthBase = new Date(base.getFullYear(), base.getMonth(), 1);
    setTempDate(base);
    setMonthCursor(monthBase);
    setShowDatePicker(true);
  };

  const openStartTimePicker = () => {
    if (Platform.OS === "web") return;
    setShowStartTimePicker(true);
  };

  const openEndTimePicker = () => {
    if (Platform.OS === "web") return;
    setShowEndTimePicker(true);
  };

  const confirmStartTimePicker = (value: Date) => {
    setSelectedTime(value);
    setStartTime(formatTimeDisplay(value));
    setShowStartTimePicker(false);
  };

  const confirmEndTimePicker = (value: Date) => {
    setSelectedEndTime(value);
    setEndTime(formatTimeDisplay(value));
    setShowEndTimePicker(false);
  };

  const cancelDatePicker = () => {
    setShowDatePicker(false);
  };

  const confirmDatePicker = () => {
    const date = tempDate;
    if (isPastDate(date)) {
      showAlert("Invalid date", "Please choose today or a future date.");
      return;
    }
    setSelectedDate(date);
    setSelectedDateText(formatDateDisplay(date));
    setWebDateValue(toLocalDateString(date));
    setShowDatePicker(false);
  };

  const todayStart = startOfDay(new Date());
  const currentMonthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  const monthCursorStart = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const canGoPrevMonth = monthCursorStart.getTime() > currentMonthStart.getTime();

  /* ----------------------------- CHILD LIST ----------------------------- */

  const renderChildren = () => {
    if (loadingChildren) {
      return <ActivityIndicator size="large" color="#FF80AB" />;
    }

    if (children.length === 0) {
      return (
        <View style={styles.noChildBox}>
          <Ionicons name="alert-circle" size={60} color="#FF80AB" />
          <Text style={styles.noChildText}>No children added</Text>
          <TouchableOpacity
            style={styles.addChildButton}
            onPress={() => {
              if (onAddChild) {
                onAddChild();
                return;
              }
              if (navigation?.goBack) {
                navigation.goBack();
                return;
              }
              Alert.alert(
                "Children required",
                "Please add a child profile before posting a job."
              );
            }}
          >
            <Text style={styles.addChildButtonText}>Add Child</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return children.map((child) => {
      const selected = selectedChildIds.includes(child.id);
      return (
        <TouchableOpacity
          key={child.id}
          style={[styles.childCard, selected && styles.childCardSelected]}
          onPress={() => {
            setSelectedChildIds((prev) => {
              const exists = prev.includes(child.id);
              return exists
                ? prev.filter((id) => id !== child.id)
                : [...prev, child.id];
            });
          }}
        >
          <View style={styles.childAvatar}>
            <Text style={styles.childAvatarText}>
              {(child.name || "C").charAt(0)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.childName}>{child.name}</Text>
            <Text style={styles.childMeta}>
              {child.gender || "N/A"} • Age {child.age ?? "N/A"}
            </Text>
          </View>
          {selected && (
            <Ionicons name="checkmark-circle" size={24} color="#FF80AB" />
          )}
        </TouchableOpacity>
      );
    });
  };
  const showLocationDropdown =
    showLocationSuggestions &&
    (loadingLocationSuggestions || locationSuggestions.length > 0 || String(locationLabel || "").trim().length >= 2);

  /* ----------------------------- RENDER ----------------------------- */

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoidingContainer}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: rs(20), paddingBottom: rs(36) }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      >
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={18} color="#FF80AB" />
        </TouchableOpacity>
        <Text style={styles.header}>Post a Job</Text>
        <View style={{ width: wp(8) }} />
      </View>

      <Text style={styles.sectionTitle}>Select Children</Text>
      <View
        style={
          fieldErrors.children
            ? { borderColor: "#D32F2F", borderWidth: 1, borderRadius: rs(12), padding: rs(6) }
            : undefined
        }
      >
        {renderChildren()}
      </View>

      <Text style={styles.sectionTitle}>Hourly Rate</Text>
      <TextInput
        value={hourlyRateDisplay}
        onChangeText={(value) => setHourlyRate(sanitizeCurrencyInput(value))}
        keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
        inputAccessoryViewID={Platform.OS === "ios" ? numberKeyboardAccessoryId : undefined}
        placeholder="Price $"
        style={[
          styles.input,
          fieldErrors.rate && { borderColor: "#D32F2F", borderWidth: 1 },
        ]}
      />
      {Number.isFinite(parsedRate) && parsedRate > 0 && parsedRate < MIN_HOURLY_RATE ? (
        <Text style={styles.rateHint}>
          Hourly rate must be at least ${MIN_HOURLY_RATE}.
        </Text>
      ) : null}
      <Text style={styles.sectionTitle}>Start Time</Text>
      <>
        {Platform.OS === "web" ? (
          <View
            style={[
              styles.selectorBox,
              fieldErrors.time && { borderColor: "#D32F2F", borderWidth: 1 },
            ]}
          >
            <Ionicons name="time-outline" size={18} color="#FF80AB" />
            <TextInput
              value={startTime}
              onChangeText={(value) => {
                setStartTime(value);
                setSelectedTime(parseTimeValueToDate(value));
              }}
              onBlur={() => {
                const normalized = normalizeManualTimeInput(startTime);
                setStartTime(normalized);
                setSelectedTime(parseTimeValueToDate(normalized));
              }}
              placeholder="5:00 PM"
              autoCapitalize="characters"
              style={styles.selectorInput}
            />
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.selectorBox,
              fieldErrors.time && { borderColor: "#D32F2F", borderWidth: 1 },
            ]}
            onPress={openStartTimePicker}
          >
            <Ionicons name="time-outline" size={18} color="#FF80AB" />
            <Text style={styles.selectorText}>{startTime || "5:00 PM"}</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.sectionTitle}>End Time</Text>
        {Platform.OS === "web" ? (
          <View
            style={[
              styles.selectorBox,
              fieldErrors.endTime && { borderColor: "#D32F2F", borderWidth: 1 },
            ]}
          >
            <Ionicons name="time-outline" size={18} color="#FF80AB" />
            <TextInput
              value={endTime}
              onChangeText={(value) => {
                setEndTime(value);
                setSelectedEndTime(parseTimeValueToDate(value));
              }}
              onBlur={() => {
                const normalized = normalizeManualTimeInput(endTime);
                setEndTime(normalized);
                setSelectedEndTime(parseTimeValueToDate(normalized));
              }}
              placeholder="10:00 PM"
              autoCapitalize="characters"
              style={styles.selectorInput}
            />
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.selectorBox,
              fieldErrors.endTime && { borderColor: "#D32F2F", borderWidth: 1 },
            ]}
            onPress={openEndTimePicker}
          >
            <Ionicons name="time-outline" size={18} color="#FF80AB" />
            <Text style={styles.selectorText}>{endTime || "10:00 PM"}</Text>
          </TouchableOpacity>
        )}
      </>

      <Text style={styles.sectionTitle}>Location</Text>
      <View
        style={[
          styles.locationBox,
          fieldErrors.location && { borderColor: "#D32F2F", borderWidth: 1 },
        ]}
      >
        <Ionicons name="location" size={20} color="#FF80AB" />
        <TextInput
          style={styles.locationInput}
          placeholder="Enter address, city, or ZIP"
          placeholderTextColor="rgba(136,14,79,0.5)"
          value={locationLabel}
          onFocus={() => {
            const trimmed = sanitizeLocationLabel(locationLabel || "");
            if (trimmed.length >= 2) {
              setShowLocationSuggestions(true);
            }
          }}
          onChangeText={(text) => {
            const nextText = text;
            setLocationLabel(nextText);
            // Typed input can differ from the last geocoded point; avoid sending stale coordinates.
            setLocLat(null);
            setLocLon(null);
            setShowLocationSuggestions(true);
            if (fieldErrors.location) {
              setFieldErrors((prev) => ({ ...prev, location: false }));
            }
          }}
          returnKeyType="search"
          onSubmitEditing={() => {
            void geocodeAndSetLocation(locationLabel);
          }}
          onBlur={() => {
            void persistLocation(locationLabel, locLat, locLon);
            setTimeout(() => {
              setShowLocationSuggestions(false);
            }, 120);
          }}
        />
        <TouchableOpacity
          style={[styles.locationActionBtn, geocodingLocation && { opacity: 0.7 }]}
          onPress={() => {
            void geocodeAndSetLocation(locationLabel);
          }}
          disabled={geocodingLocation}
          accessibilityLabel="Search address"
        >
          {geocodingLocation ? (
            <ActivityIndicator color="#FF80AB" />
          ) : (
            <Ionicons name="search" size={18} color="#FF80AB" />
          )}
        </TouchableOpacity>
      </View>
      {showLocationDropdown ? (
        <View style={styles.locationSuggestionsBox}>
          {loadingLocationSuggestions ? (
            <View style={styles.locationSuggestionLoadingRow}>
              <ActivityIndicator size="small" color="#FF80AB" />
              <Text style={styles.locationSuggestionLoadingText}>Searching addresses...</Text>
            </View>
          ) : (
            <>
              {locationSuggestions.map((item) => (
                <TouchableOpacity
                  key={item.placeId}
                  style={styles.locationSuggestionRow}
                  onPress={() => {
                    void applyLocationSuggestion(item);
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="location-outline" size={16} color="#C2185B" />
                  <View style={styles.locationSuggestionTextWrap}>
                    <Text numberOfLines={1} style={styles.locationSuggestionMainText}>
                      {item.mainText || item.description}
                    </Text>
                    {!!item.secondaryText && (
                      <Text numberOfLines={1} style={styles.locationSuggestionSecondaryText}>
                        {item.secondaryText}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
              {locationSuggestions.length === 0 && String(locationLabel || "").trim().length >= 2 ? (
                <TouchableOpacity
                  style={styles.locationSuggestionRow}
                  onPress={() => {
                    void geocodeAndSetLocation(locationLabel);
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="search" size={16} color="#C2185B" />
                  <View style={styles.locationSuggestionTextWrap}>
                    <Text numberOfLines={1} style={styles.locationSuggestionMainText}>
                      Use &quot;{String(locationLabel || "").trim()}&quot;
                    </Text>
                    <Text numberOfLines={1} style={styles.locationSuggestionSecondaryText}>
                      Tap to set this location
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </View>
      ) : null}
      {hasLocation && !hasVerifiedLocation ? (
        <Text style={styles.rateHint}>Please select a suggested address to verify location.</Text>
      ) : null}

      <Text style={styles.sectionTitle}>Date</Text>
      <>
        <TouchableOpacity
          style={[
            styles.selectorBox,
            fieldErrors.date && { borderColor: "#D32F2F", borderWidth: 1 },
          ]}
          onPress={openDatePicker}
        >
          <Text>{(selectedDate ? formatDateDisplay(selectedDate) : selectedDateText) || "Pick Date"}</Text>
        </TouchableOpacity>
        <Modal
          visible={showDatePicker}
          transparent
          animationType="fade"
          onRequestClose={cancelDatePicker}
        >
          <View style={styles.timeOverlay}>
            <View style={styles.dateCard}>
              <Text style={styles.dateTitle}>Select Date</Text>
              <Text style={styles.dateDisplay}>{formatDateDisplay(tempDate)}</Text>
              <View style={styles.dateHeaderRow}>
                <View style={styles.dateMonthRow}>
                  <Text style={styles.dateMonthLabel}>{getMonthLabel(monthCursor)}</Text>
                </View>
                <View style={styles.dateArrows}>
                  <TouchableOpacity
                    style={[styles.dateArrowBtn, !canGoPrevMonth && styles.dateArrowBtnDisabled]}
                    onPress={() => {
                      if (!canGoPrevMonth) return;
                      setMonthCursor(
                        new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1)
                      );
                    }}
                    disabled={!canGoPrevMonth}
                  >
                    <Ionicons name="chevron-back" size={18} color={canGoPrevMonth ? "#C2185B" : "#D9AFC0"} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.dateArrowBtn}
                    onPress={() =>
                      setMonthCursor(
                        new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1)
                      )
                    }
                  >
                    <Ionicons name="chevron-forward" size={18} color="#C2185B" />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.weekRow}>
                {["S", "M", "T", "W", "T", "F", "S"].map((d, idx) => (
                  <Text key={`${d}-${idx}`} style={styles.weekLabel}>
                    {d}
                  </Text>
                ))}
              </View>
              <View style={styles.daysGrid}>
                {monthDays.map((day) => {
                  if (!day.date) {
                    return <View key={day.key} style={styles.dayCell} />;
                  }
                  const dayDate = day.date as Date;
                  const isPastDay = startOfDay(dayDate).getTime() < todayStart.getTime();
                  const isSelected =
                    !isPastDay && tempDate.toDateString() === dayDate.toDateString();
                  return (
                    <TouchableOpacity
                      key={day.key}
                      style={[
                        styles.dayCell,
                        isPastDay && styles.dayCellDisabled,
                        isSelected && styles.dayCellSelected,
                      ]}
                      onPress={() => {
                        if (isPastDay) return;
                        setTempDate(dayDate);
                      }}
                      disabled={isPastDay}
                    >
                      <Text
                        style={[
                          styles.dayLabel,
                          isPastDay && styles.dayLabelDisabled,
                          isSelected && styles.dayLabelSelected,
                        ]}
                      >
                        {dayDate.getDate()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.timeActions}>
                <TouchableOpacity onPress={cancelDatePicker}>
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
          value={selectedTime || parseTimeValueToDate(startTime) || new Date()}
          title="Select Start Time"
          onCancel={() => setShowStartTimePicker(false)}
          onConfirm={confirmStartTimePicker}
        />
        <SpinnerTimePicker
          visible={showEndTimePicker}
          value={selectedEndTime || parseTimeValueToDate(endTime) || selectedTime || new Date()}
          title="Select End Time"
          onCancel={() => setShowEndTimePicker(false)}
          onConfirm={confirmEndTimePicker}
        />
      </>

      {showTotal && (
        <View style={styles.invoiceCard}>
          <View style={styles.invoiceRow}>
            <Text style={styles.invoiceLabel}>Hours</Text>
            <Text style={styles.invoiceValue}>
              {calculatedHours !== null ? formatHoursValue(calculatedHours) : "--"}
            </Text>
          </View>
          <View style={styles.invoiceRow}>
            <Text style={styles.invoiceLabel}>Rate</Text>
            <Text style={styles.invoiceValue}>${parsedRate.toFixed(2)}</Text>
          </View>
          <View style={styles.invoiceDivider} />
          <View style={styles.invoiceRow}>
            <Text style={styles.invoiceTotalLabel}>Total</Text>
            <Text style={styles.invoiceTotalValue}>${totalPrice.toFixed(2)}</Text>
          </View>
        </View>
      )}

      <View style={styles.paymentNoticeCard}>
        <View style={styles.paymentNoticeIcon}>
          <Ionicons name="card-outline" size={16} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.paymentNoticeTitle}>Payment method required</Text>
          <Text style={styles.paymentNoticeText}>
            Add and verify a payment method before posting. Your account will be charged only when the job is marked completed.
          </Text>
          {!hasPaymentMethod && (
            <TouchableOpacity
              style={[
                styles.paymentNoticeBtn,
                (checkingPaymentMethod || posting) && { opacity: 0.7 },
              ]}
              onPress={() => onRequirePayment?.()}
              disabled={checkingPaymentMethod || posting}
            >
              <Text style={styles.paymentNoticeBtnText}>
                {checkingPaymentMethod ? "Checking payment..." : "Add payment method"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <TouchableOpacity
        style={[
          styles.postButton,
          (posting || !canSubmit || isPending) && { opacity: 0.7 },
        ]}
        onPress={postJob}
        disabled={!canSubmit || isPending}
      >
        <Text style={styles.postButtonText}>
          {posting ? "Posting..." : "Post Job"}
        </Text>
      </TouchableOpacity>

      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={numberKeyboardAccessoryId}>
          <View style={styles.keyboardAccessory}>
            <TouchableOpacity onPress={Keyboard.dismiss}>
              <Text style={styles.keyboardAccessoryDone}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* -------------------------------- STYLES -------------------------------- */

const styles = StyleSheet.create({
  keyboardAvoidingContainer: { flex: 1, backgroundColor: "#FFF" },
  container: { flex: 1, backgroundColor: "#FFF" },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: rs(10) },
  header: {
    fontSize: rf(24),
    fontWeight: "700",
    color: "#880E4F",
    fontFamily: "PlayfairDisplay",
  },
  backBtn: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    backgroundColor: "#FFE7EF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(10),
  },
  webModal: {
    backgroundColor: "#fff",
    borderRadius: rs(12),
    padding: rs(14),
    marginTop: rs(10),
    borderWidth: 1,
    borderColor: "#FF80AB30",
  },
  webModalTitle: {
    fontWeight: "700",
    marginBottom: rs(8),
    color: "#880E4F",
  },
  webModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: rs(10),
    marginTop: rs(6),
  },
  webModalBtn: {
    paddingVertical: rs(8),
    paddingHorizontal: rs(12),
    backgroundColor: "#FFEFF5",
    borderRadius: rs(8),
  },
  webModalBtnText: {
    color: "#880E4F",
    fontWeight: "700",
  },
  sectionTitle: {
    marginTop: rs(20),
    fontSize: rf(16),
    fontWeight: "600",
    color: "#880E4F",
    fontFamily: "PlayfairDisplay",
  },
  childCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: rs(14),
    marginTop: rs(12),
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "#FF80AB30",
    backgroundColor: "#FFF8FB",
  },
  childCardSelected: {
    borderColor: "#FF80AB",
    backgroundColor: "#FFEFF5",
  },
  childAvatar: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    backgroundColor: "#FFD1DF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(12),
  },
  childAvatarText: { fontWeight: "700", color: "#880E4F" },
  childName: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
    fontFamily: "PlayfairDisplay",
  },
  childMeta: { color: "#AD1457", fontSize: rf(13) },
  noChildBox: { alignItems: "center", marginTop: rs(20) },
  noChildText: { marginTop: rs(10), fontSize: rf(16), color: "#880E4F" },
  addChildButton: {
    marginTop: rs(15),
    backgroundColor: "#FF80AB",
    paddingVertical: rs(10),
    paddingHorizontal: rs(20),
    borderRadius: rs(12),
  },
  addChildButtonText: { color: "#FFF", fontWeight: "600" },
  input: {
    marginTop: rs(10),
    borderWidth: 1,
    borderColor: "#FF80AB50",
    borderRadius: rs(10),
    padding: rs(12),
  },
  rateHint: {
    marginTop: rs(6),
    color: "#D32F2F",
    fontSize: rf(12),
    fontWeight: "600",
  },
  locationBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FF80AB50",
    padding: rs(12),
    borderRadius: rs(10),
    marginTop: rs(10),
  },
  locationInput: {
    flex: 1,
    marginLeft: rs(8),
    color: "#880E4F",
    paddingVertical: rs(0),
    fontSize: rf(14),
  },
  locationActionBtn: {
    marginLeft: rs(8),
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#FFF1F6",
    alignItems: "center",
    justifyContent: "center",
  },
  locationSuggestionsBox: {
    marginTop: rs(6),
    borderWidth: 1,
    borderColor: "#FF80AB40",
    borderRadius: rs(10),
    backgroundColor: "#FFF9FC",
    overflow: "hidden",
  },
  locationSuggestionLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    paddingHorizontal: rs(12),
    paddingVertical: rs(10),
  },
  locationSuggestionLoadingText: {
    color: "#AD1457",
    fontSize: rf(12),
  },
  locationSuggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    paddingHorizontal: rs(12),
    paddingVertical: rs(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,128,171,0.25)",
  },
  locationSuggestionTextWrap: {
    flex: 1,
  },
  locationSuggestionMainText: {
    color: "#880E4F",
    fontSize: rf(13),
    fontWeight: "600",
  },
  locationSuggestionSecondaryText: {
    marginTop: rs(2),
    color: "#AD1457",
    fontSize: rf(11),
  },
  selectorBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FF80AB50",
    borderRadius: rs(10),
    padding: rs(14),
    marginTop: rs(10),
  },
  selectorInput: {
    flex: 1,
    marginLeft: rs(10),
    padding: 0,
    margin: 0,
    color: "#880E4F",
    fontSize: rf(14),
  },
  selectorText: {
    flex: 1,
    marginLeft: rs(10),
    color: "#880E4F",
    fontSize: rf(14),
  },
  // Only used on web; applied to native <input> elements
  webNativeInput: {
    width: "100%",
    padding: rs(8),
    borderWidth: 0,
    outlineStyle: "none",
    outlineWidth: 0,
    outlineColor: "transparent",
    fontSize: rf(14),
    color: "#880E4F",
    backgroundColor: "transparent",
  } as any,
  timeOverlay: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: rs(20),
  },
  timeCard: {
    width: "92%",
    maxWidth: rs(560),
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "#FFE0EB",
  },
  dateCard: {
    width: "92%",
    maxWidth: rs(560),
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "#FFE0EB",
  },
  dateTitle: {
    color: "#C2185B",
    fontSize: rf(12),
    fontWeight: "700",
    marginBottom: rs(6),
    letterSpacing: rs(1.2),
    textTransform: "uppercase",
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
  dateArrowBtnDisabled: {
    opacity: 0.45,
  },
  weekRow: {
    flexDirection: "row",
    width: CALENDAR_GRID_WIDTH,
    alignSelf: "center",
    marginBottom: rs(6),
  },
  weekLabel: {
    width: CALENDAR_CELL_SIZE,
    textAlign: "center",
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(12),
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: CALENDAR_GRID_WIDTH,
    alignSelf: "center",
  },
  dayCell: {
    width: CALENDAR_CELL_SIZE,
    height: rs(32),
    alignItems: "center",
    justifyContent: "center",
    marginVertical: rs(4),
  },
  dayCellDisabled: {
    opacity: 0.35,
  },
  dayCellSelected: {
    backgroundColor: "#FFD772",
    borderRadius: rs(16),
  },
  dayLabel: {
    color: "#C2185B",
    fontWeight: "600",
    fontSize: rf(12),
  },
  dayLabelDisabled: {
    color: "#D9AFC0",
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
    width: DIAL_SIZE,
    height: DIAL_SIZE,
    borderRadius: DIAL_CENTER,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  minuteDot: {
    position: "absolute",
    width: DIAL_MARK_SIZE,
    height: DIAL_MARK_SIZE,
    borderRadius: DIAL_MARK_SIZE / 2,
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
    transform: [{ translateX: -KNOB_SIZE / 2 }, { translateY: -KNOB_SIZE / 2 }],
  },
  minuteNeedle: {
    width: rs(2),
    height: DIAL_NEEDLE_HEIGHT,
    backgroundColor: "#FFD772",
    borderRadius: rs(2),
    marginTop: -DIAL_NEEDLE_HEIGHT,
  },
  minuteKnob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: "#FFD772",
    alignItems: "center",
    justifyContent: "center",
    marginTop: rs(-12),
  },
  minuteKnobText: {
    color: "#9A6400",
    fontWeight: "700",
  },
  postButton: {
    marginTop: rs(30),
    backgroundColor: "#FF80AB",
    padding: rs(16),
    borderRadius: rs(12),
    alignItems: "center",
  },
  postButtonText: {
    color: "#FFF",
    fontSize: rf(18),
    fontWeight: "700",
  },
  keyboardAccessory: {
    backgroundColor: "#FFF7FA",
    borderTopWidth: 1,
    borderTopColor: "#FFD1DF",
    paddingHorizontal: rs(14),
    paddingVertical: rs(10),
    alignItems: "flex-end",
  },
  keyboardAccessoryDone: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(14),
  },
  invoiceCard: {
    marginTop: rs(12),
    backgroundColor: "#FFF8FB",
    borderRadius: rs(12),
    padding: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB30",
  },
  invoiceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: rs(4),
  },
  invoiceLabel: {
    color: "#AD1457",
    fontWeight: "600",
  },
  invoiceValue: {
    color: "#880E4F",
    fontWeight: "700",
  },
  invoiceDivider: {
    height: rs(1),
    backgroundColor: "#FFD1DF",
    marginVertical: rs(8),
  },
  invoiceTotalLabel: {
    color: "#880E4F",
    fontWeight: "700",
  },
  invoiceTotalValue: {
    color: "#C2185B",
    fontWeight: "800",
  },
  paymentNoticeCard: {
    marginTop: rs(14),
    backgroundColor: "#FFF7FA",
    borderRadius: rs(12),
    padding: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.28)",
    flexDirection: "row",
    gap: rs(10),
  },
  paymentNoticeIcon: {
    width: rs(26),
    height: rs(26),
    borderRadius: rs(13),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: rs(2),
  },
  paymentNoticeTitle: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(13),
  },
  paymentNoticeText: {
    marginTop: rs(4),
    color: "#6B4350",
    fontSize: rf(12),
    lineHeight: rs(18),
  },
  paymentNoticeBtn: {
    marginTop: rs(10),
    alignSelf: "flex-start",
    backgroundColor: "#FFE4EC",
    borderRadius: rs(10),
    paddingHorizontal: rs(12),
    paddingVertical: rs(8),
  },
  paymentNoticeBtnText: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(12),
  },
});
