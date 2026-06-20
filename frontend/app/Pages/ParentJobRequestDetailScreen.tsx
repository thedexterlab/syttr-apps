import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { apiRequest, BASE_URL, getRuntimeApiKey, sanitizeToken } from "../Api";
import { formatDateToMDY } from "../utils/dateFormat";
import { geocodeAddress } from "../utils/geocodeAddress";
import {
  fetchUnreadParentRequestCount,
  markParentRequestAsRead,
} from "../../lib/parentRequestNotifications";
import { fetchUnreadConversationCount } from "../../lib/chatUnreadCount";
import { hp, rf, rs, wp } from "../utils/responsive";
import { MapView, Marker } from "../../lib/WebSafeMap";

type Props = {
  item?: any;
  navigation?: any;
  onBack?: () => void;
  onOpenNannyProfile?: (nanny?: any) => void;
  onOpenBooking?: (item?: any) => void;
  onHome?: () => void;
  onMessages?: () => void;
  onJobRequests?: () => void;
  onNotifications?: () => void;
  onCalendar?: () => void;
  onSettings?: () => void;
};

const hasValue = (value: any) =>
  value !== undefined && value !== null && String(value).trim() !== "";

const pickFirstValue = (...values: any[]) => {
  for (const value of values) {
    if (hasValue(value)) return String(value).trim();
  }
  return "";
};

const parseNumericValue = (value: any) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!hasValue(value)) return null;
  const parsed = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const formatCurrencyValue = (value: any, options?: { suffix?: string }) => {
  if (!hasValue(value)) return "";
  const raw = String(value).trim();
  const suffix = options?.suffix || "";
  const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
  if (Number.isFinite(parsed)) {
    return `${parsed < 0 ? "-" : ""}$${Math.abs(parsed).toFixed(2)}${suffix}`;
  }
  const normalized = raw.replace(/\$/g, "").trim();
  return normalized ? `$${normalized}${suffix}` : "";
};

const formatHoursLabel = (hours: number | null) => {
  if (!hours || hours <= 0) return "TBD";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hrs`;
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

  return raw;
};

const formatHourlyRateLabel = (rate: number | null) => {
  if (!rate || rate <= 0) return "TBD";
  return `$${rate.toFixed(2)}/hr`;
};

const buildTimeDuration = (job: any, item: any) => {
  const startTime = pickFirstValue(
    job?.start_time,
    job?.time,
    item?.meta?.start_time,
    item?.meta?.time
  );
  const endTime = pickFirstValue(
    job?.end_time,
    job?.end,
    job?.finish_time,
    item?.meta?.end_time
  );

  const durationSource =
    job?.hours ??
    job?.duration ??
    item?.meta?.hours ??
    item?.meta?.duration ??
    null;
  const durationNumeric = parseNumericValue(durationSource);
  const durationLabel =
    durationNumeric && durationNumeric > 0
      ? `${durationNumeric} hour${durationNumeric === 1 ? "" : "s"}`
      : pickFirstValue(durationSource);
  const formattedStart = startTime ? formatTimeValue(startTime) : "";
  const formattedEnd = endTime ? formatTimeValue(endTime) : "";

  if (formattedStart && formattedEnd && durationLabel) return `${formattedStart} - ${formattedEnd} (${durationLabel})`;
  if (formattedStart && formattedEnd) return `${formattedStart} - ${formattedEnd}`;
  if (formattedStart && durationLabel) return `${formattedStart} (${durationLabel})`;
  if (durationLabel) return durationLabel;
  return formattedStart;
};

const normalizeKid = (child: any) => ({
  id: child?.id ?? child?.kid_id ?? child?.child_id,
  name: pickFirstValue(child?.name, child?.kid_name, child?.child_name),
  age: child?.age ?? child?.kid_age ?? child?.child_age,
  gender: pickFirstValue(child?.gender),
  allergies: pickFirstValue(child?.allergies),
  medical_conditions: pickFirstValue(child?.medical_conditions, child?.medical_condition),
  notes: pickFirstValue(child?.notes),
});

const kidCompletenessScore = (kid: any) =>
  [
    hasValue(kid?.id),
    hasValue(kid?.name),
    hasValue(kid?.age),
    hasValue(kid?.gender),
    hasValue(kid?.allergies),
    hasValue(kid?.medical_conditions),
    hasValue(kid?.notes),
  ].filter(Boolean).length;

const dedupeKids = (
  kids: Array<{
    id?: string | number;
    name?: string;
    age?: string | number;
    gender?: string;
    allergies?: string;
    medical_conditions?: string;
    notes?: string;
  }>
) => {
  const unique = new Map<string, (typeof kids)[number]>();
  kids.forEach((kid) => {
    if (
      !hasValue(kid?.name) &&
      !hasValue(kid?.age) &&
      !hasValue(kid?.gender) &&
      !hasValue(kid?.allergies) &&
      !hasValue(kid?.medical_conditions) &&
      !hasValue(kid?.notes)
    ) {
      return;
    }

    const key = hasValue(kid?.id)
      ? `id:${String(kid?.id).trim()}`
      : `name:${String(kid?.name || "").toLowerCase().trim()}|age:${String(
          kid?.age || ""
        ).trim()}|gender:${String(kid?.gender || "").toLowerCase().trim()}`;

    const existing = unique.get(key);
    if (!existing || kidCompletenessScore(kid) > kidCompletenessScore(existing)) {
      unique.set(key, kid);
    }
  });
  return Array.from(unique.values());
};

const extractKids = (job: any, item: any) => {
  const kids: {
    id?: string | number;
    name?: string;
    age?: string | number;
    gender?: string;
    allergies?: string;
    medical_conditions?: string;
    notes?: string;
  }[] = [];

  const collect = (value: any) => {
    if (!value) return;
    const target = value?.kids || value?.kid || value?.child || value;
    if (!target || Array.isArray(target)) {
      if (Array.isArray(target)) target.forEach((entry) => collect(entry));
      return;
    }
    const normalized = normalizeKid(target);
    if (
      hasValue(normalized.name) ||
      hasValue(normalized.age) ||
      hasValue(normalized.gender) ||
      hasValue(normalized.allergies) ||
      hasValue(normalized.medical_conditions) ||
      hasValue(normalized.notes)
    ) {
      kids.push(normalized);
    }
  };

  // Only use kids that belong to this job request.
  const primarySources = [
    job?.kids,
    item?.job?.kids,
    item?.raw?.data?.job?.kids,
  ];

  primarySources.forEach((source) => {
    if (Array.isArray(source)) source.forEach((entry) => collect(entry));
    else collect(source);
  });

  const structuredKids = dedupeKids(kids);
  if (structuredKids.length > 0) return structuredKids;

  const nameCandidates = [
    job?.kid_names,
    item?.job?.kid_names,
    item?.kid_names,
    item?.meta?.kid_names,
    item?.raw?.data?.job?.kid_names,
  ];

  const nameOnlyKids: { name: string }[] = [];
  nameCandidates.forEach((source) => {
    if (!source) return;
    if (Array.isArray(source)) {
      source.forEach((entry) => {
        const name = String(entry || "").trim();
        if (name) nameOnlyKids.push({ name });
      });
      return;
    }
    String(source)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((name) => nameOnlyKids.push({ name }));
  });

  return dedupeKids(nameOnlyKids);
};

const formatDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
};

const formatStatusLabel = (value: any) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());

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

const STORAGE_ROOT = BASE_URL.replace(/\/api\/?$/, "");

const resolveImageUrl = (value?: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replace(/^\/+/, "");
  return `${STORAGE_ROOT}/storage/${clean}`;
};

export default function ParentJobRequestDetailScreen({
  item,
  navigation,
  onBack,
  onOpenNannyProfile,
  onOpenBooking,
  onHome,
  onMessages,
  onJobRequests,
  onNotifications,
  onCalendar,
  onSettings,
}: Props) {
  const [requestCount, setRequestCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [resolvedJob, setResolvedJob] = useState<any | null>(null);
  const [resolvedNanny, setResolvedNanny] = useState<any | null>(null);
  const [resolvedApplication, setResolvedApplication] = useState<any | null>(null);
  const [showSyttrProfile, setShowSyttrProfile] = useState(false);
  const [decisionLoading, setDecisionLoading] = useState<"accept" | "reject" | null>(null);
  const job = useMemo(() => resolvedJob || item?.job || {}, [resolvedJob, item]);
  const nanny = useMemo(() => resolvedNanny || item?.nanny || {}, [resolvedNanny, item]);
  const application = useMemo(
    () => resolvedApplication || item?.application || {},
    [resolvedApplication, item]
  );
  const kids = useMemo(() => extractKids(job, item), [job, item]);
  const bookingId = job?.id || item?.job_id;
  const canViewBooking = hasValue(bookingId);
  const locationLabel = pickFirstValue(
    job?.location,
    item?.location,
    item?.meta?.location,
    item?.raw?.data?.job?.location
  );
  const [geocodedCoords, setGeocodedCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    let mounted = true;
    const hydrate = async () => {
      try {
        if (!mounted) return;
        const seedJob = item?.job || item?.raw?.data?.job || null;
        const seedNanny = item?.nanny || item?.raw?.data?.nanny || null;
        const seedApplication = item?.application || item?.raw?.data?.application || null;
        setResolvedJob(seedJob);
        setResolvedNanny(seedNanny);
        setResolvedApplication(seedApplication);

        const notificationJobId = pickFirstValue(
          seedJob?.id,
          item?.job_id,
          item?.raw?.data?.job_id,
          seedApplication?.job_id
        );
        const notificationApplicationId = pickFirstValue(
          seedApplication?.id,
          item?.application_id,
          item?.raw?.data?.application_id
        );
        const notificationNannyId = pickFirstValue(
          seedNanny?.id,
          item?.nanny_id,
          item?.raw?.data?.nanny_id
        );

        const needsHydration =
          !seedJob ||
          !seedNanny ||
          !seedApplication ||
          !Array.isArray(seedJob?.kids) ||
          seedJob?.kids?.length === 0;
        if (!needsHydration || !notificationJobId) return;

        const [tokenRaw, userId, apiKeyStored] = await Promise.all([
          AsyncStorage.getItem("token"),
          AsyncStorage.getItem("user_id"),
          AsyncStorage.getItem("api_key"),
        ]);
        const token = sanitizeToken(tokenRaw || undefined);
        const apiKey = String(apiKeyStored || "").trim() || getRuntimeApiKey() || undefined;
        const json = await apiRequest<any>("job/get-details", {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
          body: JSON.stringify({
            job_id: Number.isFinite(Number(notificationJobId))
              ? Number(notificationJobId)
              : notificationJobId,
            ...(userId ? { user_id: userId } : {}),
          }),
        });
        const root = json?.data || json;
        const fetchedJob = root?.job || null;
        const fetchedApplications = Array.isArray(root?.applications)
          ? root.applications
          : Array.isArray(fetchedJob?.applications)
          ? fetchedJob.applications
          : [];
        const fetchedNannies = Array.isArray(root?.nannies) ? root.nannies : [];

        const matchedApplication =
          fetchedApplications.find(
            (entry: any) =>
              String(entry?.id ?? entry?.application_id ?? "") ===
              String(notificationApplicationId || "")
          ) ||
          fetchedApplications.find(
            (entry: any) => String(entry?.nanny_id ?? "") === String(notificationNannyId || "")
          ) ||
          fetchedApplications[0] ||
          null;

        const matchedNanny =
          fetchedNannies.find(
            (entry: any) =>
              String(entry?.id ?? entry?.nanny_id ?? "") ===
              String(notificationNannyId || matchedApplication?.nanny_id || "")
          ) ||
          matchedApplication?.nanny ||
          null;

        let enrichedNanny = matchedNanny;
        const nannyNeedsProfileHydration =
          !enrichedNanny ||
          !pickFirstValue(
            enrichedNanny?.fullname,
            enrichedNanny?.name,
            enrichedNanny?.email,
            enrichedNanny?.phone,
            enrichedNanny?.city,
            enrichedNanny?.country,
            enrichedNanny?.bio
          );

        if (nannyNeedsProfileHydration && notificationNannyId) {
          try {
            const profileJson = await apiRequest<any>(
              `profiles/syttrs?user_id=${encodeURIComponent(String(notificationNannyId))}`,
              {
                headers: {
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  ...(apiKey ? { "x-api-key": apiKey } : {}),
                },
              }
            );
            const profileList = Array.isArray(profileJson)
              ? profileJson
              : Array.isArray(profileJson?.data)
                ? profileJson.data
                : [];
            const profile = profileList[0] || null;
            if (profile) {
              enrichedNanny = {
                ...(enrichedNanny || {}),
                ...profile,
                id: notificationNannyId,
                nanny_id: notificationNannyId,
                fullname:
                  pickFirstValue(
                    enrichedNanny?.fullname,
                    enrichedNanny?.name,
                    profile?.fullname,
                    profile?.name
                  ) || `Syttr ${notificationNannyId}`,
                name: pickFirstValue(enrichedNanny?.name, profile?.name, profile?.fullname),
                phone: pickFirstValue(enrichedNanny?.phone, profile?.phone, profile?.number),
                city: pickFirstValue(enrichedNanny?.city, profile?.city, profile?.city_area),
                country: pickFirstValue(enrichedNanny?.country, profile?.country),
                bio: pickFirstValue(enrichedNanny?.bio, profile?.bio),
                experience:
                  enrichedNanny?.experience ?? profile?.experience ?? profile?.experience_years,
                hourly_rate: enrichedNanny?.hourly_rate ?? profile?.hourly_rate,
              };
            }
          } catch {
            // keep existing fallback
          }
        }

        if (!mounted) return;
        if (fetchedJob) setResolvedJob(fetchedJob);
        if (matchedApplication) setResolvedApplication(matchedApplication);
        if (enrichedNanny) setResolvedNanny(enrichedNanny);
      } catch {
        // keep payload fallback
      }
    };
    void hydrate();

    return () => {
      mounted = false;
    };
  }, [item]);

  const title = item?.title || "Job Request from Syttr";
  const createdAt = item?.created_at || item?.time || "";
  const status = String(item?.status || application?.status || "pending");
  const directCoords = extractCoordinates({ ...job, location: locationLabel || job?.location });

  useEffect(() => {
    let canceled = false;

    if (!locationLabel) {
      setGeocodedCoords(null);
      return () => {
        canceled = true;
      };
    }

    (async () => {
      const found = await geocodeAddress(locationLabel);
      if (canceled) return;
      if (found?.latitude !== undefined && found?.longitude !== undefined) {
        setGeocodedCoords({
          latitude: Number(found.latitude),
          longitude: Number(found.longitude),
        });
      } else {
        setGeocodedCoords(null);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [locationLabel]);

  useEffect(() => {
    let mounted = true;

    const syncRequestState = async () => {
      try {
        await markParentRequestAsRead(item || {});
      } catch {
        // local override fallback is handled in utility
      }

      try {
        const count = await fetchUnreadParentRequestCount();
        if (mounted) setRequestCount(count);
      } catch {
        if (mounted) setRequestCount(0);
      }

      try {
        const count = await fetchUnreadConversationCount();
        if (mounted) setMessageCount(count);
      } catch {
        if (mounted) setMessageCount(0);
      }
    };

    void syncRequestState();
    return () => {
      mounted = false;
    };
  }, [item?.id, item?.request_key, item?.application_id, item?.job_id]);

  useEffect(() => {
    const unsubscribe = navigation?.addListener?.("focus", () => {
      void fetchUnreadParentRequestCount()
        .then((count) => setRequestCount(count))
        .catch(() => setRequestCount(0));
      void fetchUnreadConversationCount()
        .then((count) => setMessageCount(count))
        .catch(() => setMessageCount(0));
    });
    return () => unsubscribe?.();
  }, [navigation]);

  const coords = geocodedCoords || directCoords;
  const region = coords
    ? {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      }
    : undefined;
  const mapCoordinatesLabel = coords ? `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}` : "";
  const timeDurationLabel = buildTimeDuration(job, item);
  const hoursNumeric = parseNumericValue(
    job?.hours ??
      item?.meta?.hours ??
      job?.duration ??
      item?.meta?.duration
  );
  const totalPayNumeric = parseNumericValue(
    job?.price ??
      item?.meta?.pay
  );
  const hourlyRateNumericDirect = parseNumericValue(
    job?.hourly_rate ??
      item?.meta?.hourly_rate ??
      item?.meta?.rate ??
      item?.meta?.pay_rate
  );
  const hourlyRateNumeric =
    hourlyRateNumericDirect && hourlyRateNumericDirect > 0
      ? hourlyRateNumericDirect
      : hoursNumeric && totalPayNumeric
      ? totalPayNumeric / hoursNumeric
      : null;
  const summaryCards = [
    {
      key: "hours",
      label: "Hours",
      value: formatHoursLabel(hoursNumeric),
      icon: "time-outline" as const,
      bg: "#FFF6E9",
      border: "#FFD59A",
      iconColor: "#C77700",
    },
    {
      key: "rate",
      label: "Hourly Rate",
      value: formatHourlyRateLabel(hourlyRateNumeric),
      icon: "cash-outline" as const,
      bg: "#ECF8F0",
      border: "#9BD9B0",
      iconColor: "#2E7D32",
    },
    {
      key: "date",
      label: "Date",
      value: formatDateToMDY(job?.start_date || job?.date) || "TBD",
      icon: "calendar-outline" as const,
      bg: "#ECF4FF",
      border: "#9FC6FF",
      iconColor: "#1E62C9",
    },
  ];

  const bookingRows = [
    { label: "Job ID", value: job?.id || item?.job_id },
    { label: "Date", value: formatDateToMDY(job?.start_date || job?.date) },
    {
      label: "End date",
      value:
        formatDateToMDY(job?.end_date) && formatDateToMDY(job?.end_date) !== formatDateToMDY(job?.start_date)
          ? formatDateToMDY(job?.end_date)
          : "",
    },
    { label: "Time Duration", value: timeDurationLabel },
    { label: "Location", value: locationLabel },
    { label: "Location In Map", value: mapCoordinatesLabel },
    { label: "Price", value: hasValue(job?.price) ? formatCurrencyValue(job?.price) : formatCurrencyValue(item?.meta?.pay) },
  ].filter((row) => hasValue(row.value));

  const syttrName = useMemo(
    () =>
      pickFirstValue(
        nanny?.fullname,
        nanny?.name,
        [nanny?.first_name, nanny?.last_name].filter(Boolean).join(" "),
        item?.nanny_name,
        item?.raw?.data?.nanny_name
      ) || (item?.nanny_id ? `Syttr ${item.nanny_id}` : "Syttr"),
    [nanny, item]
  );

  const syttrRows = [
    {
      label: "Syttr ID",
      value: nanny?.id || item?.nanny_id,
    },
    { label: "City", value: nanny?.city || nanny?.city_area },
    { label: "Country", value: nanny?.country },
    {
      label: "Experience",
      value:
        nanny?.experience !== undefined && nanny?.experience !== null
          ? `${nanny.experience} yrs`
          : null,
    },
      { label: "Bio", value: nanny?.bio },
    { label: "Hourly Rate", value: hasValue(nanny?.hourly_rate) ? formatCurrencyValue(nanny?.hourly_rate, { suffix: "/hr" }) : null },
  ].filter((row) => hasValue(row.value));

  const syttrProfileRows = [
    { label: "Name", value: syttrName },
    { label: "Syttr ID", value: nanny?.id || item?.nanny_id },
    { label: "City", value: nanny?.city || nanny?.city_area },
    { label: "Country", value: nanny?.country },
    {
      label: "Experience",
      value:
        nanny?.experience !== undefined && nanny?.experience !== null
          ? `${nanny.experience} yrs`
          : null,
    },
    { label: "Hourly Rate", value: hasValue(nanny?.hourly_rate) ? formatCurrencyValue(nanny?.hourly_rate, { suffix: "/hr" }) : null },
    { label: "Bio", value: nanny?.bio },
  ].filter((row) => hasValue(row.value));

  const syttrAvatar = resolveImageUrl(nanny?.user_image_url || nanny?.profile_image || nanny?.user_image);

  const appRows = [
    { label: "Application ID", value: application?.id || item?.application_id },
    { label: "Status", value: formatStatusLabel(status) },
    { label: "Applied", value: formatDateTime(application?.created_at || createdAt) },
    { label: "Updated", value: formatDateTime(application?.updated_at) },
  ].filter((row) => hasValue(row.value));
  const applicationId = String(application?.id || item?.application_id || "").trim();
  const applicationStatusRaw = String(application?.status || item?.status || "pending").toLowerCase().trim();
  const isParentInitiatedHireRequest =
    applicationStatusRaw === "hire_requested" || applicationStatusRaw === "hire-requested";
  const canRespondToRequest =
    !!applicationId &&
    !isParentInitiatedHireRequest &&
    ![
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
    ].includes(applicationStatusRaw);

  const submitApplicationDecision = async (decision: "accept" | "reject") => {
    if (!applicationId) {
      Alert.alert("Request", "Application ID missing.");
      return;
    }
    if (decisionLoading) return;
    try {
      setDecisionLoading(decision);
      const [tokenRaw, userId, apiKeyStored] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("api_key"),
      ]);
      if (!userId) {
        Alert.alert("Request", "User ID missing. Please login again.");
        return;
      }
      const token = sanitizeToken(tokenRaw || undefined);
      const apiKey = String(apiKeyStored || "").trim() || getRuntimeApiKey() || undefined;
      const endpoint = decision === "accept" ? "accept" : "reject";
      const json = await apiRequest<any>(`job-requests/${applicationId}/${endpoint}`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({ user_id: userId }),
      });
      if (json?.success === false) {
        throw new Error((json as any)?.message || "Unable to update request.");
      }
      const nextStatus = decision === "accept" ? "accepted" : "rejected";
      setResolvedApplication((prev: any) => ({
        ...(prev || application || {}),
        id: prev?.id || application?.id || item?.application_id,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      }));
      Alert.alert("Success", decision === "accept" ? "Request accepted." : "Request rejected.");
    } catch (e: any) {
      Alert.alert("Request", e?.message || "Unable to update request.");
    } finally {
      setDecisionLoading(null);
    }
  };

  const confirmApplicationDecision = (decision: "accept" | "reject") => {
    const title = decision === "accept" ? "Accept Request" : "Reject Request";
    const message =
      decision === "accept"
        ? "Do you want to accept this job request?"
        : "Do you want to reject this job request?";
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: decision === "accept" ? "Accept" : "Reject", onPress: () => void submitApplicationDecision(decision) },
    ]);
  };
  const detailItem = useMemo(
    () => ({
      ...(item || {}),
      job,
      nanny,
      application,
      job_id: job?.id || item?.job_id,
      application_id: application?.id || item?.application_id,
      nanny_id: nanny?.id || item?.nanny_id,
    }),
    [item, job, nanny, application]
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <View style={styles.screen}>
      <LinearGradient
        colors={["#f9eecf", "#ffdbea"]}
        style={styles.hero}
      >
        <View style={styles.heroTop}>
          <TouchableOpacity
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => {
              if (onBack) onBack();
              else navigation?.goBack?.();
            }}
          >
            <Ionicons name="chevron-back" size={18} color="#C2185B" />
          </TouchableOpacity>

          <Text style={styles.heroTitle}>Job Request</Text>
          <View style={styles.backBtnGhost} />
        </View>

        <View style={styles.statusRow}>
          <View style={styles.iconCircle}>
            <Ionicons name="briefcase" size={22} color="#C2185B" />
          </View>
          <View style={styles.statusContent}>
            <Text style={styles.heroMainTitle}>{title}</Text>
            <Text style={styles.heroSub}>{createdAt ? new Date(createdAt).toLocaleString() : "Just now"}</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.summaryRow}>
          {summaryCards.map((card) => (
            <View
              key={card.key}
              style={[
                styles.summaryCard,
                {
                  backgroundColor: card.bg,
                  borderColor: card.border,
                },
              ]}
            >
              <View style={[styles.summaryIconWrap, { backgroundColor: "#FFFFFF" }]}>
                <Ionicons name={card.icon} size={18} color={card.iconColor} />
              </View>
              <Text style={styles.summaryValue}>{card.value}</Text>
              <Text style={styles.summaryLabel}>{card.label}</Text>
            </View>
          ))}
        </View>

        {!!syttrRows.length && (
          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>Syttr</Text>
            <TouchableOpacity
              style={styles.syttrProfileCard}
              activeOpacity={0.9}
              onPress={() => {
                if (onOpenNannyProfile) {
                  onOpenNannyProfile(nanny || item?.nanny || undefined);
                  return;
                }
                setShowSyttrProfile(true);
              }}
            >
              <View style={styles.syttrAvatarWrap}>
                {syttrAvatar ? (
                  <Image source={{ uri: syttrAvatar }} style={styles.syttrAvatar} />
                ) : (
                  <Text style={styles.syttrAvatarText}>{syttrName.slice(0, 1).toUpperCase()}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.syttrProfileName}>{syttrName}</Text>
                <Text style={styles.syttrProfileSub}>
                  {pickFirstValue(nanny?.city, nanny?.city_area, nanny?.country, "Tap to view profile")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#C2185B" />
            </TouchableOpacity>
           
          </View>
        )}

        {!!bookingRows.length && (
          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>Job Details</Text>
            {bookingRows.map((row) => (
              <InfoRow key={row.label} label={row.label} value={row.value} />
            ))}
            {region ? (
              <View style={styles.mapWrap}>
                <MapView
                  style={styles.map}
                  region={region}
                >
                  <Marker
                    coordinate={{ latitude: region.latitude, longitude: region.longitude }}
                  />
                </MapView>
              </View>
            ) : (
              <Text style={styles.metaText}>Map location not available</Text>
            )}
            {canViewBooking ? (
              <TouchableOpacity
                style={styles.viewBookingBtn}
                activeOpacity={0.85}
                onPress={() => onOpenBooking?.(detailItem)}
              >
                <Ionicons name="open-outline" size={16} color="#FFFFFF" />
                <Text style={styles.viewBookingBtnText}>View Booking Details</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}


        {!!kids.length && (
          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>Children</Text>
            {kids.map((kid: any, idx: number) => {
              const metaParts = [];
              if (kid?.age !== undefined && kid?.age !== null) metaParts.push(`Age: ${kid.age}`);
              if (kid?.gender) metaParts.push(kid.gender);
              const meta = metaParts.join(" | ");

              return (
                <View key={`${kid?.id || "child"}-${idx}`} style={idx ? { marginTop: rs(12) } : undefined}>
                  {kid?.name ? <Text style={styles.detailText}>{kid.name}</Text> : null}
                  {meta ? <Text style={styles.metaText}>{meta}</Text> : null}
                  {kid?.allergies ? <Text style={styles.metaText}>Allergies: {kid.allergies}</Text> : null}
                  {kid?.medical_conditions ? (
                    <Text style={styles.metaText}>Medical: {kid.medical_conditions}</Text>
                  ) : null}
                  {kid?.notes ? <Text style={styles.metaText}>Notes: {kid.notes}</Text> : null}
                </View>
              );
            })}
          </View>
        )}

        {!!appRows.length && (
          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>Application</Text>
            {appRows.map((row) => (
              <InfoRow key={row.label} label={row.label} value={row.value} />
            ))}
            {canRespondToRequest ? (
              <View style={styles.requestActionRow}>
                <TouchableOpacity
                  style={[
                    styles.requestAcceptBtn,
                    decisionLoading !== null && styles.requestActionDisabled,
                  ]}
                  disabled={decisionLoading !== null}
                  onPress={() => confirmApplicationDecision("accept")}
                >
                  <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" />
                  <Text style={styles.requestAcceptText}>
                    {decisionLoading === "accept" ? "Accepting..." : "Accept"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.requestRejectBtn,
                    decisionLoading !== null && styles.requestActionDisabled,
                  ]}
                  disabled={decisionLoading !== null}
                  onPress={() => confirmApplicationDecision("reject")}
                >
                  <Ionicons name="close-circle" size={16} color="#C2185B" />
                  <Text style={styles.requestRejectText}>
                    {decisionLoading === "reject" ? "Rejecting..." : "Reject"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Modal visible={showSyttrProfile} transparent animationType="slide" onRequestClose={() => setShowSyttrProfile(false)}>
        <View style={styles.profileModalBackdrop}>
          <View style={styles.profileModalCard}>
            <View style={styles.profileModalHeader}>
              <Text style={styles.profileModalTitle}>Syttr Profile</Text>
              <TouchableOpacity onPress={() => setShowSyttrProfile(false)} style={styles.profileCloseBtn}>
                <Ionicons name="close" size={18} color="#C2185B" />
              </TouchableOpacity>
            </View>

            <View style={styles.profileTopRow}>
              <View style={styles.profileTopAvatarWrap}>
                {syttrAvatar ? (
                  <Image source={{ uri: syttrAvatar }} style={styles.profileTopAvatar} />
                ) : (
                  <Text style={styles.syttrAvatarText}>{syttrName.slice(0, 1).toUpperCase()}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileTopName}>{syttrName}</Text>
                <Text style={styles.profileTopSub}>Applied for this job</Text>
              </View>
            </View>

            <ScrollView style={{ maxHeight: rs(320) }} showsVerticalScrollIndicator={false}>
              {syttrProfileRows.map((row) => (
                <InfoRow key={`profile-${row.label}`} label={row.label} value={row.value} />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <View
        style={[
          styles.bottomBar,
          {
            bottom: 0,
            paddingBottom: 8,
            height: rs(68),
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
        <Tab icon="notifications" label="Alerts" onPress={onNotifications || (() => {})} />
        <Tab icon="calendar" label="Calendar" onPress={onCalendar || (() => {})} />
        <Tab icon="settings" label="Settings" onPress={onSettings || (() => {})} />
      </View>
      </View>
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

function InfoRow({ label, value }: { label: string; value: any }) {
  if (!hasValue(value)) return null;
  const normalizedLabel = label.toLowerCase();
  const allowMultiline =
    normalizedLabel.includes("location") ||
    normalizedLabel.includes("bio") ||
    normalizedLabel.includes("notes");
  const isStatus = normalizedLabel === "status";
  const statusValue = String(value).toLowerCase();
  const statusStyle =
    statusValue.includes("accept") || statusValue.includes("approved")
      ? styles.statusValueAccepted
      : statusValue.includes("reject")
      ? styles.statusValueRejected
      : statusValue.includes("pending")
      ? styles.statusValuePending
      : null;

  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text
        style={[styles.infoValue, isStatus && statusStyle]}
        numberOfLines={allowMultiline ? undefined : 2}
      >
        {String(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  scroll: {
    backgroundColor: "#FFFFFF",
  },
  hero: {
    paddingTop: rs(18),
    paddingHorizontal: rs(16),
    paddingBottom: rs(20),
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  backBtn: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(12),
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnGhost: {
    width: rs(36),
    height: rs(36),
  },
  heroTitle: {
    color: "#C2185B",
    fontSize: rf(18),
    fontWeight: "700",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: rs(20),
  },
  statusContent: {
    marginLeft: rs(12),
    flex: 1,
  },
  iconCircle: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(14),
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroMainTitle: {
    color: "#C2185B",
    fontSize: rf(16),
    fontWeight: "700",
  },
  heroSub: {
    color: "#C2185B",
    fontSize: rf(12),
    marginTop: rs(2),
  },
  content: {
    padding: rs(16),
    paddingBottom: rs(96),
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: rs(8),
    marginBottom: rs(12),
  },
  summaryCard: {
    flex: 1,
    borderRadius: rs(14),
    borderWidth: 1,
    minHeight: rs(108),
    paddingHorizontal: rs(8),
    paddingVertical: rs(10),
    alignItems: "center",
    justifyContent: "center",
  },
  summaryIconWrap: {
    width: rs(30),
    height: rs(30),
    borderRadius: rs(15),
    alignItems: "center",
    justifyContent: "center",
  },
  summaryValue: {
    marginTop: rs(8),
    fontSize: rf(12.5),
    color: "#6B4350",
    fontWeight: "700",
    textAlign: "center",
  },
  summaryLabel: {
    marginTop: rs(4),
    fontSize: rf(10.5),
    color: "#AD1457",
    fontWeight: "700",
    textAlign: "center",
  },
  detailCard: {
    backgroundColor: "#FFF",
    borderRadius: rs(16),
    padding: rs(16),
    marginBottom: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.25)",
    shadowColor: "rgba(0,0,0,0.05)",
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: rs(0), height: rs(2) },
  },
  detailTitle: {
    fontSize: rf(15),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(8),
  },
  detailText: {
    fontSize: rf(13),
    color: "#6B4350",
    lineHeight: rs(18),
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: rs(6),
  },
  infoLabel: {
    fontSize: rf(12),
    color: "#AD1457",
    fontWeight: "700",
  },
  infoValue: {
    flex: 1,
    textAlign: "right",
    fontSize: rf(12),
    color: "#6B4350",
    fontWeight: "600",
  },
  statusValueAccepted: {
    color: "#2E7D32",
  },
  statusValuePending: {
    color: "#C77700",
  },
  statusValueRejected: {
    color: "#C62828",
  },
  metaText: {
    fontSize: rf(12),
    color: "#6B4350",
    fontWeight: "600",
  },
  mapWrap: {
    marginTop: rs(12),
    borderRadius: rs(12),
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  map: { height: rs(220), width: "100%" },
  viewBookingBtn: {
    marginTop: rs(12),
    height: rs(42),
    borderRadius: rs(12),
    backgroundColor: "#C2185B",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: rs(6),
  },
  viewBookingBtnText: {
    color: "#FFFFFF",
    fontSize: rf(12.5),
    fontWeight: "700",
  },
  requestActionRow: {
    marginTop: rs(12),
    flexDirection: "row",
    gap: rs(8),
  },
  requestAcceptBtn: {
    flex: 1,
    height: rs(40),
    borderRadius: rs(10),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: rs(6),
  },
  requestAcceptText: {
    color: "#FFFFFF",
    fontSize: rf(12),
    fontWeight: "700",
  },
  requestRejectBtn: {
    flex: 1,
    height: rs(40),
    borderRadius: rs(10),
    backgroundColor: "#FFF1F1",
    borderWidth: 1,
    borderColor: "#F5B5C8",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: rs(6),
  },
  requestRejectText: {
    color: "#C2185B",
    fontSize: rf(12),
    fontWeight: "700",
  },
  requestActionDisabled: {
    opacity: 0.7,
  },
  syttrProfileCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(194,24,91,0.2)",
    borderRadius: rs(12),
    padding: rs(10),
    marginBottom: rs(8),
    backgroundColor: "#FFF5F9",
    gap: rs(10),
  },
  syttrAvatarWrap: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  syttrAvatar: {
    width: rs(44),
    height: rs(44),
  },
  syttrAvatarText: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#C2185B",
  },
  syttrProfileName: {
    fontSize: rf(13),
    fontWeight: "700",
    color: "#880E4F",
  },
  syttrProfileSub: {
    fontSize: rf(11),
    color: "#AD1457",
    marginTop: rs(2),
  },
  profileModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  profileModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: rs(20),
    borderTopRightRadius: rs(20),
    padding: rs(16),
    paddingBottom: rs(22),
    minHeight: rs(260),
    maxHeight: "80%",
  },
  profileModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(12),
  },
  profileModalTitle: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
  },
  profileCloseBtn: {
    width: rs(30),
    height: rs(30),
    borderRadius: rs(15),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFEAF2",
  },
  profileTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(10),
    marginBottom: rs(10),
  },
  profileTopAvatarWrap: {
    width: rs(52),
    height: rs(52),
    borderRadius: rs(26),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  profileTopAvatar: {
    width: rs(52),
    height: rs(52),
  },
  profileTopName: {
    fontSize: rf(14),
    fontWeight: "700",
    color: "#880E4F",
  },
  profileTopSub: {
    fontSize: rf(11),
    color: "#AD1457",
    marginTop: rs(2),
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
