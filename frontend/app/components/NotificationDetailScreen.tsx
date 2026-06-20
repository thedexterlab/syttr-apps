import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { RouteProp } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { rf, rs } from "../utils/responsive";
import { formatDateToMDY } from "../utils/dateFormat";
import { MapView, Marker, PROVIDER_GOOGLE } from "../../lib/WebSafeMap";
import { geocodeAddress } from "../utils/geocodeAddress";
import { apiRequest, getRuntimeApiKey, sanitizeToken } from "../Api";

/* ---------------- TYPES ---------------- */

type NotificationItem = {
  id?: number | string;
  title?: string;
  subtitle?: string;
  message?: string;
  created_at?: string;
  time?: string;
  type?: string;
  status?: string;
  isRead?: boolean;
  is_read?: number | boolean | string;
  payload?: any;
  data?: any;
  raw?: any;
  job?: any;
  parent?: any;
  kids?: any[];
  nanny?: any;
  application?: any;
  application_id?: number | string;
  application_status?: string;
};

type KidDetail = {
  id?: string | number;
  name?: string;
  age?: string | number;
  gender?: string;
  allergies?: string;
  medical_conditions?: string;
  notes?: string;
};

const isNotificationRead = (
  item?: { isRead?: unknown; is_read?: unknown } | null
) => {
  if (!item) return false;
  return [item.isRead, item.is_read].some(
    (val) => val === true || val === 1 || String(val).toLowerCase() === "true"
  );
};

const isChatMessageType = (type: any) => {
  const value = String(type || "").trim().toLowerCase();
  return value === "chat_message" || value === "chat";
};

type RouteParams = {
  params: {
    item?: NotificationItem;
  };
};

type Props = {
  route?: RouteProp<RouteParams, "params"> | { params?: { item?: NotificationItem } };
  navigation?: any;
  onBack?: () => void;
};

const formatDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
};

const formatTimeValue = (value?: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const hhmm = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
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

const hasValue = (value: any) =>
  value !== undefined && value !== null && String(value).trim() !== "";

const pickFirstDefined = (...values: any[]) => {
  for (const value of values) {
    if (value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "")) {
      return value;
    }
  }
  return undefined;
};

const pickFirstText = (...values: any[]) => {
  const picked = pickFirstDefined(...values);
  return picked === undefined || picked === null ? "" : String(picked).trim();
};

const toFiniteNumber = (value: any): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractKids = (job: any, fallbackKids?: any[]): KidDetail[] => {
  const sources = [
    Array.isArray(fallbackKids) ? fallbackKids : null,
    job?.kids,
    job?.kid,
    job?.children,
    job?.child,
    job?.kids_list,
  ];
  const normalized = sources
    .flatMap((source: any) => {
      if (!source) return [];
      if (Array.isArray(source)) return source.flatMap((entry: any) => entry?.kids || entry?.kid || entry);
      return [source?.kids || source?.kid || source];
    })
    .filter(Boolean)
    .map((child: any) => ({
      id: child?.id ?? child?.kid_id ?? child?.child_id,
      name: child?.name,
      age: child?.age,
      gender: child?.gender,
      allergies: child?.allergies,
      medical_conditions: child?.medical_conditions,
      notes: child?.notes,
    }))
    .filter((kid) =>
      Object.values(kid).some((v) => v !== undefined && v !== null && String(v).trim() !== "")
    );

  if (normalized.length) return normalized;

  const kidNames = String(job?.kid_names || "").trim();
  if (!kidNames) return [];
  return kidNames
    .split(",")
    .map((name) => String(name).trim())
    .filter(Boolean)
    .map((name) => ({ name }));
};

const buildDetailSeed = (item: NotificationItem) => {
  const roots = [
    item,
    item?.payload,
    item?.data,
    item?.raw,
    item?.raw?.data,
    item?.raw?.payload,
    item?.raw?.raw,
  ].filter(Boolean) as any[];

  const pickFromRoots = (...keys: string[]) => {
    for (const root of roots) {
      for (const key of keys) {
        const candidate = root?.[key];
        if (candidate !== undefined && candidate !== null) {
          if (typeof candidate === "string" && candidate.trim() === "") continue;
          return candidate;
        }
      }
    }
    return undefined;
  };

  const job = pickFirstDefined(
    item?.job,
    pickFromRoots("job"),
    pickFromRoots("booking"),
    pickFromRoots("request")
  );
  const parent = pickFirstDefined(
    item?.parent,
    pickFromRoots("parent"),
    job?.parent
  );
  const nanny = pickFirstDefined(
    item?.nanny,
    pickFromRoots("nanny"),
    job?.nanny
  );
  const application = pickFirstDefined(
    item?.application,
    pickFromRoots("application"),
    pickFromRoots("job_application")
  );
  const kids = pickFirstDefined(
    item?.kids,
    pickFromRoots("kids"),
    job?.kids
  );
  const jobId = pickFirstDefined(
    job?.job_id,
    job?.id,
    item?.application?.job_id,
    application?.job_id,
    item?.application_id ? job?.id : undefined,
    pickFromRoots("job_id"),
    pickFromRoots("booking_id")
  );
  const applicationId = pickFirstDefined(
    item?.application_id,
    item?.application?.application_id,
    item?.application?.id,
    application?.application_id,
    application?.id,
    pickFromRoots("application_id"),
    pickFromRoots("job_application_id")
  );
  const applicationStatus = pickFirstDefined(
    item?.application_status,
    application?.status,
    pickFromRoots("status"),
    pickFromRoots("application_status")
  );

  return {
    job,
    parent,
    nanny,
    application,
    kids: Array.isArray(kids) ? kids : [],
    jobId,
    applicationId,
    applicationStatus,
  };
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

const getHireRequestMeta = (item?: NotificationItem) => {
  const row = item?.raw || {};
  const rowData = row?.data || {};
  const applicationId =
    row?.application_id ||
    rowData?.application_id ||
    row?.application?.application_id ||
    rowData?.application?.application_id ||
    row?.application?.id ||
    rowData?.application?.id ||
    item?.application?.application_id ||
    item?.application?.id ||
    item?.application_id;
  const notificationId = item?.id || row?.id || row?.notification_id;
  const applicationKey = String(applicationId || "").trim();
  const notificationKey = String(notificationId || "").trim();

  return {
    applicationId: applicationKey || "",
    notificationId: notificationKey || "",
  };
};

const getExtraHoursRequestMeta = (item?: NotificationItem) => {
  const row = item?.raw || {};
  const notificationId = item?.id || row?.id || row?.notification_id;
  const notificationKey = String(notificationId || "").trim();

  return {
    notificationId: notificationKey || "",
  };
};

/* ---------------- SCREEN ---------------- */

export default function NotificationDetailScreen({ route, navigation, onBack }: Props) {
  const nav = navigation;
  const params = route?.params ?? {};
  const initialItem: NotificationItem = params.item ?? {};

  const [item, setItem] = useState<NotificationItem>(initialItem);
  const [actionLoading, setActionLoading] = useState<"accept" | "reject" | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailBundle, setDetailBundle] = useState<any>(null);
  const [viewerUserType, setViewerUserType] = useState("");
  const [geocodedCoords, setGeocodedCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const detailSeed = React.useMemo(() => buildDetailSeed(item), [item]);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const storedUserType = String((await AsyncStorage.getItem("user_type")) || "")
          .trim()
          .toLowerCase();
        if (!canceled) setViewerUserType(storedUserType);
      } catch {
        if (!canceled) setViewerUserType("");
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    setDetailBundle(null);
  }, [item.id, detailSeed.jobId]);

  useEffect(() => {
    let canceled = false;
    const jobId = Number(detailSeed.jobId);
    if (!Number.isFinite(jobId) || jobId <= 0) {
      return () => {
        canceled = true;
      };
    }

    (async () => {
      setDetailLoading(true);
      try {
        const [tokenRaw, nannyTokenRaw, apiRaw, userIdRaw, nannyIdRaw] =
          await Promise.all([
            AsyncStorage.getItem("token"),
            AsyncStorage.getItem("nanny_token"),
            AsyncStorage.getItem("api_key"),
            AsyncStorage.getItem("user_id"),
            AsyncStorage.getItem("nanny_id"),
          ]);
        const token = sanitizeToken(tokenRaw || nannyTokenRaw || undefined);
        const apiKey = apiRaw || getRuntimeApiKey() || undefined;
        const queryParts = [
          ...(userIdRaw ? [`user_id=${encodeURIComponent(userIdRaw)}`] : []),
          ...(nannyIdRaw ? [`nanny_id=${encodeURIComponent(nannyIdRaw)}`] : []),
          ...(apiKey ? [`api_key=${encodeURIComponent(apiKey)}`] : []),
        ];
        const suffix = queryParts.length ? `?${queryParts.join("&")}` : "";
        const json = await apiRequest<any>(`job/${jobId}/details${suffix}`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
        }).catch(() => null);
        if (!json) return;

        const data = json?.data || {};
        const fetchedJob = data?.job || null;
        const fetchedParent = data?.parent || fetchedJob?.parent || null;
        const fetchedKids = Array.isArray(data?.kids)
          ? data.kids
          : Array.isArray(fetchedJob?.kids)
          ? fetchedJob.kids
          : [];
        const fetchedApplications = Array.isArray(data?.applications)
          ? data.applications
          : Array.isArray(fetchedJob?.applications)
          ? fetchedJob.applications
          : [];
        const activeApplicationId = String(detailSeed.applicationId || "").trim();
        const selectedApplication =
          activeApplicationId && fetchedApplications.length
            ? fetchedApplications.find(
                (entry: any) =>
                  String(entry?.id ?? entry?.application_id ?? "").trim() === activeApplicationId
              )
            : null;
        const fetchedApplication =
          data?.application ||
          fetchedJob?.application ||
          selectedApplication ||
          null;
        const fetchedNanny =
          data?.nanny ||
          fetchedApplication?.nanny ||
          (Array.isArray(data?.nannies) && data.nannies.length ? data.nannies[0] : null);

        if (canceled) return;
        setDetailBundle({
          job: fetchedJob || undefined,
          parent: fetchedParent || undefined,
          kids: fetchedKids,
          application: fetchedApplication || undefined,
          nanny: fetchedNanny || undefined,
        });
      } catch {
        // keep local payload fallback
      } finally {
        if (!canceled) setDetailLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [detailSeed.jobId, detailSeed.applicationId]);

  const normalizedTitle = normalizeParentText(item.title || "Notification");
  const isChatMessageNotification = isChatMessageType(item.type);
  const isExtraHoursRequestNotification =
    String(item.type || "").trim().toLowerCase() === "extra_hours_request";
  const isExtraHoursAcceptedNotification = String(item.type || "").trim().toLowerCase() === "extra_hours_accepted";
  const title = /job request from syttr/i.test(normalizedTitle)
    ? "Job Request from Syttr"
    : normalizedTitle || (isChatMessageNotification ? "New Message" : "Notification");
  const createdAt = item.created_at || item.time || "";
  const isRead = isNotificationRead(item);
  const job = detailBundle?.job || detailSeed.job || item.job || null;
  const message = isChatMessageNotification
    ? "Open chat to read your message."
    : isExtraHoursAcceptedNotification
    ? `Syttr accepted your extra hours request. The new end time is ${formatTimeValue(pickFirstText(detailBundle?.job?.end_time, job?.end_time, item?.data?.end_time, item?.raw?.data?.updated_end_time)) || "N/A"}.`
    : normalizeParentText(item.message || item.subtitle || "") || "No details available.";
  const parent =
    detailBundle?.parent ||
    detailSeed.parent ||
    job?.parent ||
    {};
  const nanny = detailBundle?.nanny || detailSeed.nanny || item.nanny;
  const kids = extractKids(job, detailBundle?.kids || detailSeed.kids);
  const application =
    detailBundle?.application ||
    detailSeed.application ||
    item.application;
  const hireRequestMeta = React.useMemo(() => getHireRequestMeta(item), [item]);
  const extraHoursRequestMeta = React.useMemo(() => getExtraHoursRequestMeta(item), [item]);
  const isHireRequestNotification = item.type === "hire_request";
  const applicationId = pickFirstDefined(
    detailBundle?.application?.id,
    detailBundle?.application?.application_id,
    hireRequestMeta.applicationId,
    application?.application_id,
    application?.id,
    detailSeed.applicationId,
    item.application_id
  );
  const applicationStatusRaw = pickFirstText(
    detailBundle?.application?.status,
    item.application_status,
    item.status,
    application?.status,
    detailSeed.applicationStatus
  );
  const applicationStatus = String(applicationStatusRaw).toLowerCase();
  const canRespond =
    !!applicationId && !["accepted", "rejected"].includes(applicationStatus);
  const extraHoursRequestStatus = String(
    pickFirstText(
      item?.raw?.data?.status,
      item?.raw?.status,
      item?.data?.status,
      item?.status
    ) || "pending"
  ).toLowerCase();
  const canRespondToExtraHours =
    !!extraHoursRequestMeta.notificationId &&
    !["accepted", "rejected", "declined"].includes(extraHoursRequestStatus);
  const formattedJobStartDate = formatDateToMDY(job?.start_date || job?.date);
  const formattedJobEndDate = formatDateToMDY(job?.end_date);
  const parentName =
    pickFirstText(
      parent?.name,
      parent?.parent_name,
      parent?.full_name,
      job?.parent_name,
      [job?.parent_firstname, job?.parent_lastname].filter(Boolean).join(" ").trim(),
      job?.parent?.name,
      job?.parent_user?.name
    ) || "Parent";
  const parentRows = [
    { label: "Name", value: parentName },
    { label: "Phone", value: pickFirstText(parent?.phone, parent?.parent_phone, job?.parent_phone) },
    { label: "Email", value: pickFirstText(parent?.email, parent?.parent_email, job?.parent_email) },
    { label: "Address", value: pickFirstText(parent?.address, job?.parent_address) },
    { label: "City", value: pickFirstText(parent?.city, parent?.city_area, job?.parent_city) },
    { label: "Country", value: pickFirstText(parent?.country, job?.parent_country) },
    {
      label: "Rating",
      value: (() => {
        const rating = toFiniteNumber(
          pickFirstDefined(
            parent?.average_rating,
            parent?.parent_average_rating,
            job?.parent_average_rating
          )
        );
        return rating !== null ? `${rating.toFixed(1)} / 5` : "";
      })(),
    },
    {
      label: "Jobs Posted",
      value: (() => {
        const jobsPosted = toFiniteNumber(
          pickFirstDefined(
            parent?.jobs_posted_count,
            parent?.parent_jobs_posted_count,
            job?.parent_jobs_posted_count
          )
        );
        return jobsPosted !== null ? Math.max(0, Math.round(jobsPosted)) : "";
      })(),
    },
    {
      label: "Rated By",
      value: (() => {
        const ratersCount = toFiniteNumber(
          pickFirstDefined(
            parent?.raters_count,
            parent?.parent_raters_count,
            parent?.ratings_count,
            job?.parent_raters_count,
            job?.parent_ratings_count
          )
        );
        return ratersCount !== null ? `${Math.max(0, Math.round(ratersCount))} Syttrs` : "";
      })(),
    },
  ].filter((row) => hasValue(row.value));
  const hasParentDetails =
    parentName.toLowerCase() !== "parent" ||
    parentRows.some((row) => row.label !== "Name");
  const syttrRows = [
    {
      label: "Location",
      value: [nanny?.city, nanny?.country].filter(Boolean).join(", "),
    },
    {
      label: "Experience",
      value:
        nanny?.experience !== undefined && nanny?.experience !== null
          ? `${nanny.experience} yrs`
          : null,
    },
    { label: "Bio", value: nanny?.bio },
  ].filter((row) => hasValue(row.value));
  const isNannyViewer = viewerUserType === "nanny" || viewerUserType === "syttr";
  const shouldShowSyttrDetails = !!nanny && !isNannyViewer && item.type !== "hire_request";
  const bookingRows = [
    { label: "Job ID", value: pickFirstText(job?.job_id, job?.id) },
    {
      label: "Date",
      value:
        formattedJobStartDate ||
        formattedJobEndDate ||
        "",
    },
    {
      label: "End date",
      value:
        formattedJobEndDate &&
        formattedJobEndDate !== formattedJobStartDate
          ? formattedJobEndDate
          : "",
    },
    { label: "Start time", value: formatTimeValue(pickFirstText(job?.start_time, job?.time)) },
    { label: "End time", value: formatTimeValue(pickFirstText(job?.end_time, job?.end, job?.finish_time)) },
    {
      label: "Requested end time",
      value: formatTimeValue(
        pickFirstText(
          item?.data?.new_end_time,
          item?.raw?.data?.new_end_time,
          item?.data?.requested_end_time,
          item?.raw?.data?.requested_end_time
        )
      ),
    },
    {
      label: "Duration",
      value: hasValue(job?.hours) ? `${job.hours} hours` : pickFirstText(job?.duration),
    },
    { label: "Location", value: job?.location },
    {
      label: "Price",
      value:
        job?.price ||
        job?.total_price ||
        job?.hourly_rate ||
        job?.rate ||
        job?.pay_rate ||
        "",
    },
    { label: "Application", value: application?.status },
    {
      label: "Applied",
      value: application?.created_at
        ? formatDateTime(application.created_at)
        : "",
    },
  ].filter((row) => hasValue(row.value));
  const locationQuery = pickFirstText(job?.location, parent?.address);
  const directCoords = extractCoordinates(job);
  useEffect(() => {
    let canceled = false;

    if (!locationQuery) {
      setGeocodedCoords(null);
      return () => {
        canceled = true;
      };
    }

    (async () => {
      const found = await geocodeAddress(locationQuery);
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
  }, [locationQuery]);

  const coords = React.useMemo(
    () => geocodedCoords || directCoords,
    [geocodedCoords, directCoords]
  );
  const region = coords
    ? {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      }
    : undefined;
  const openDirections = async () => {
    const destination = locationQuery || (coords ? `${coords.latitude},${coords.longitude}` : "");
    if (!destination) return;

    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
    const nativeUrl =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?daddr=${encodeURIComponent(destination)}`
        : `google.navigation:q=${encodeURIComponent(destination)}`;

    try {
      if (Platform.OS !== "web") {
        const canOpenNative = await Linking.canOpenURL(nativeUrl);
        if (canOpenNative) {
          await Linking.openURL(nativeUrl);
          return;
        }
      }
      await Linking.openURL(webUrl);
    } catch {
      Alert.alert("Map", "Unable to open directions right now.");
    }
  };

  const markAsRead = async () => {
    if (!item.id || isRead || markingRead) return;
    setMarkingRead(true);
    try {
      const [tokenRaw, nannyTokenRaw, apiRaw, userTypeRaw, userId, nannyIdRaw] =
        await Promise.all([
          AsyncStorage.getItem("token"),
          AsyncStorage.getItem("nanny_token"),
          AsyncStorage.getItem("api_key"),
          AsyncStorage.getItem("user_type"),
          AsyncStorage.getItem("user_id"),
          AsyncStorage.getItem("nanny_id"),
        ]);
      const token = sanitizeToken(tokenRaw || nannyTokenRaw || undefined);
      const apiKey = apiRaw || getRuntimeApiKey() || undefined;
      const userType = userTypeRaw ? userTypeRaw.toLowerCase() : "";
      const nannyId = nannyIdRaw || (userType === "nanny" ? userId : null);

      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      };
      const payload: Record<string, string> = {};
      if (userId) payload.user_id = userId;
      if (userType === "nanny" || nannyId) {
        payload.nanny_id = nannyId || userId || "";
      }

      const json = await apiRequest<any>(`notification/mark-read/${item.id}`, {
        method: "POST",
        headers: {
          ...(nannyId ? { "nanny-id": nannyId, nanny_id: nannyId } : {}),
          ...headers,
        },
        body: Object.keys(payload).length
          ? JSON.stringify(payload)
          : undefined,
      });
      if (json?.success === false) {
        throw new Error(json?.message || "Unable to mark notification as read.");
      }

      setItem((prev) => ({ ...prev, is_read: 1, isRead: true }));
    } catch (e) {
      console.log("[NotificationDetail] mark read error", e);
      Alert.alert("Error", "Unable to mark as read.");
    } finally {
      setMarkingRead(false);
    }
  };

  const postApplicationDecision = async (
    decision: "accept" | "reject",
    appId: string | number
  ) => {
    const [tokenRaw, userId, apiRaw] = await Promise.all([
      AsyncStorage.getItem("token"),
      AsyncStorage.getItem("user_id"),
      AsyncStorage.getItem("api_key"),
    ]);
    const token = sanitizeToken(tokenRaw || undefined);
    const apiKey = apiRaw || getRuntimeApiKey() || undefined;

    if (!userId) {
      throw new Error("Missing user id. Please login again.");
    }

    console.log("[NotificationDetail] submitting decision", {
      decision,
      applicationId: appId,
      userId,
    });

    const endpoint =
      decision === "accept" ? "accept" : "reject";
    const json = await apiRequest<any>(
      `job-requests/${appId}/${endpoint}`,
      {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({ user_id: userId }),
      }
    );
    if (json?.success === false) {
      throw new Error(json?.message || "Unable to update request.");
    }
    return json;
  };

  const postHireRequestDecision = async (
    decision: "accept" | "reject",
    appId: string | number
  ) => {
    const [tokenRaw, nannyTokenRaw, userId, nannyIdRaw, apiRaw] = await Promise.all([
      AsyncStorage.getItem("token"),
      AsyncStorage.getItem("nanny_token"),
      AsyncStorage.getItem("user_id"),
      AsyncStorage.getItem("nanny_id"),
      AsyncStorage.getItem("api_key"),
    ]);
    const token = sanitizeToken(tokenRaw || nannyTokenRaw || undefined);
    const nannyId = nannyIdRaw || userId || "";
    const apiKey = apiRaw || getRuntimeApiKey() || undefined;

    if (!nannyId && !userId) {
      throw new Error("Missing nanny id. Please login again.");
    }

    const endpoint = decision === "accept" ? "accept" : "reject";
    const payload: Record<string, string> = {};
    if (userId) payload.user_id = userId;
    if (nannyId) payload.nanny_id = nannyId;

    console.log("[NotificationDetail] submitting hire request decision", {
      decision,
      applicationId: appId,
      nannyId,
      userId,
    });

    const json = await apiRequest<any>(
      `nanny/hire-requests/${appId}/${endpoint}`,
      {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify(payload),
      }
    );
    if (json?.success === false) {
      throw new Error(json?.message || "Unable to update hire request.");
    }
    return json;
  };

  const postExtraHoursDecision = async (decision: "accept" | "reject") => {
    const [tokenRaw, nannyTokenRaw, userId, nannyIdRaw, apiRaw] = await Promise.all([
      AsyncStorage.getItem("token"),
      AsyncStorage.getItem("nanny_token"),
      AsyncStorage.getItem("user_id"),
      AsyncStorage.getItem("nanny_id"),
      AsyncStorage.getItem("api_key"),
    ]);
    const token = sanitizeToken(tokenRaw || nannyTokenRaw || undefined);
    const nannyId = nannyIdRaw || userId || "";
    const apiKey = apiRaw || getRuntimeApiKey() || undefined;
    const notificationId = extraHoursRequestMeta.notificationId;

    if (!notificationId) {
      throw new Error("Request ID missing.");
    }
    if (!nannyId && !userId) {
      throw new Error("Missing nanny id. Please login again.");
    }

    const endpoint = decision === "accept" ? "accept" : "reject";
    const payload: Record<string, string> = {};
    if (userId) payload.user_id = userId;
    if (nannyId) payload.nanny_id = nannyId;

    const json = await apiRequest<any>(
      `bookings/extra-hours/${encodeURIComponent(notificationId)}/${endpoint}`,
      {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify(payload),
      }
    );
    if (json?.success === false) {
      throw new Error(json?.message || "Unable to update extra hours request.");
    }
    return json;
  };

  const handleDecision = async (decision: "accept" | "reject") => {
    if (!isExtraHoursRequestNotification && !applicationId) return;
    setActionLoading(decision);
    try {
      if (isExtraHoursRequestNotification) {
        await postExtraHoursDecision(decision);
      } else if (isHireRequestNotification) {
        await postHireRequestDecision(decision, applicationId);
      } else {
        await postApplicationDecision(decision, applicationId);
      }
      const newStatus = decision === "accept" ? "accepted" : "rejected";
      setItem((prev) => ({
        ...prev,
        is_read: 1,
        isRead: true,
        status: newStatus,
        application_status: newStatus,
        raw: prev.raw
          ? {
              ...prev.raw,
              status: newStatus,
              request_status: newStatus,
              application_status: newStatus,
              application: prev.raw?.application
                ? { ...prev.raw.application, status: newStatus }
                : prev.raw?.application,
              data: prev.raw?.data
                ? {
                    ...prev.raw.data,
                    status: newStatus,
                    request_status: newStatus,
                    application_status: newStatus,
                    application: prev.raw.data.application
                      ? { ...prev.raw.data.application, status: newStatus }
                      : prev.raw.data.application,
                  }
                : prev.raw?.data,
            }
          : prev.raw,
        application: prev.application
          ? { ...prev.application, status: newStatus }
          : prev.application,
      }));
      setDetailBundle((prev: any) =>
        prev
          ? {
              ...prev,
              application: prev.application
                ? { ...prev.application, status: newStatus }
                : prev.application,
            }
          : prev
      );
      Alert.alert(
        "Success",
        isExtraHoursRequestNotification
          ? decision === "accept"
            ? "Extra hours request accepted."
            : "Extra hours request declined."
          : isHireRequestNotification
          ? decision === "accept"
            ? "Hire request accepted."
            : "Hire request declined."
          : decision === "accept"
          ? "Request accepted."
          : "You declined a job request from a Syttr."
      );
    } catch (e: any) {
      console.log("[NotificationDetail] decision error", e);
      Alert.alert("Error", e?.message || "Unable to update request.");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={["#FF80AB", "#FFC1D9"]}
        style={styles.hero}
      >
        <View style={styles.heroTop}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              if (onBack) onBack();
              else nav?.goBack?.();
            }}
          >
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </TouchableOpacity>

          <Text style={styles.heroTitle}>Notification</Text>
          <View style={{ width: rs(32) }} />
        </View>

        <View style={styles.statusRow}>
          <View style={styles.iconCircle}>
            <Ionicons name="notifications" size={22} color="#fff" />
          </View>
          <View>
            <Text style={styles.heroMainTitle}>{title}</Text>
            <Text style={styles.heroSub}>
              {createdAt
                ? new Date(createdAt).toLocaleString()
                : "Just now"}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView style={styles.contentScroll} contentContainerStyle={styles.content}>
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>Message</Text>
          <Text style={styles.detailText}>{message}</Text>
        </View>

        {hasParentDetails ? (
          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>Parent Details</Text>
            {parentRows.map((row) => (
              <InfoRow key={`parent-${row.label}`} label={row.label} value={row.value} />
            ))}
          </View>
        ) : null}

        {shouldShowSyttrDetails ? (
          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>Syttr</Text>
            <Text style={styles.detailText}>{nanny.fullname || "N/A"}</Text>
            {syttrRows.map((row) => (
              <InfoRow key={row.label} label={row.label} value={row.value} />
            ))}
          </View>
        ) : null}

        {job || detailLoading || detailSeed.jobId ? (
          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>Booking</Text>
            {detailLoading ? (
              <View style={{ marginBottom: rs(8) }}>
                <ActivityIndicator color="#FF80AB" />
              </View>
            ) : null}
            {bookingRows.map((row) => (
              <InfoRow key={row.label} label={row.label} value={row.value} />
            ))}
            {region ? (
              <View style={styles.mapWrap}>
                <MapView
                  style={styles.map}
                  region={region}
                  provider={PROVIDER_GOOGLE}
                  webQuery={locationQuery || undefined}
                  showsUserLocation
                >
                  <Marker
                    coordinate={{
                      latitude: region.latitude,
                      longitude: region.longitude,
                    }}
                    title="Booking location"
                    description={job?.location}
                  />
                </MapView>
              </View>
            ) : null}
            {locationQuery || coords ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={openDirections}>
                <Ionicons name="navigate-outline" size={16} color="#fff" />
                <Text style={styles.primaryText}>Open Directions</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {kids.length ? (
          <View style={styles.detailCard}>
            <Text style={styles.detailTitle}>Children</Text>
            {kids.map((kid, idx) => {
              const metaParts = [];
              if (kid.age !== undefined && kid.age !== null) {
                metaParts.push(`Age: ${kid.age}`);
              }
              if (kid.gender) metaParts.push(kid.gender);
              const meta = metaParts.join(" | ");
              return (
                <View key={`${kid.name || "child"}-${idx}`} style={idx ? { marginTop: rs(12) } : undefined}>
                  <Text style={styles.detailText}>
                    {kid.name || (kid.id ? `Child #${kid.id}` : `Child ${idx + 1}`)}
                  </Text>
                  {meta ? <Text style={styles.metaText}>{meta}</Text> : null}
                  {kid.allergies ? (
                    <Text style={styles.metaText}>Allergies: {kid.allergies}</Text>
                  ) : null}
                  {kid.medical_conditions ? (
                    <Text style={styles.metaText}>Medical: {kid.medical_conditions}</Text>
                  ) : null}
                  {kid.notes ? <Text style={styles.metaText}>Notes: {kid.notes}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {isExtraHoursRequestNotification && canRespondToExtraHours ? (
          <View style={styles.decisionRow}>
            <TouchableOpacity
              style={[
                styles.acceptBtn,
                actionLoading === "accept" && { opacity: 0.75 },
              ]}
              disabled={!!actionLoading || !canRespondToExtraHours}
              onPress={() => handleDecision("accept")}
            >
              {actionLoading === "accept" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.decisionText}>Accept</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.declineBtn,
                actionLoading === "reject" && { opacity: 0.75 },
              ]}
              disabled={!!actionLoading || !canRespondToExtraHours}
              onPress={() => handleDecision("reject")}
            >
              {actionLoading === "reject" ? (
                <ActivityIndicator color="#C2185B" />
              ) : (
                <Text style={styles.decisionTextAlt}>Decline</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {!isExtraHoursRequestNotification && applicationId && canRespond ? (
          <View style={styles.decisionRow}>
            <TouchableOpacity
              style={[
                styles.acceptBtn,
                actionLoading === "accept" && { opacity: 0.75 },
              ]}
              disabled={!!actionLoading || !canRespond}
              onPress={() => handleDecision("accept")}
            >
              {actionLoading === "accept" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.decisionText}>Accept</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.declineBtn,
                actionLoading === "reject" && { opacity: 0.75 },
              ]}
              disabled={!!actionLoading || !canRespond}
              onPress={() => handleDecision("reject")}
            >
              {actionLoading === "reject" ? (
                <ActivityIndicator color="#C2185B" />
              ) : (
                <Text style={styles.decisionTextAlt}>Decline</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {isExtraHoursRequestNotification && !canRespondToExtraHours ? (
          <View style={styles.statusPillWrap}>
            <View
              style={[
                styles.statusPill,
                extraHoursRequestStatus === "accepted"
                  ? styles.statusPillAccepted
                  : styles.statusPillDeclined,
              ]}
            >
              <Text
                style={[
                  styles.statusPillText,
                  extraHoursRequestStatus === "accepted"
                    ? styles.statusPillTextAccepted
                    : styles.statusPillTextDeclined,
                ]}
              >
                {extraHoursRequestStatus === "accepted" ? "Accepted" : "Declined"}
              </Text>
            </View>
          </View>
        ) : null}

        {!isExtraHoursRequestNotification && applicationId && !canRespond && isHireRequestNotification ? (
          <View style={styles.statusPillWrap}>
            <View
              style={[
                styles.statusPill,
                applicationStatus === "accepted"
                  ? styles.statusPillAccepted
                  : styles.statusPillDeclined,
              ]}
            >
              <Text
                style={[
                  styles.statusPillText,
                  applicationStatus === "accepted"
                    ? styles.statusPillTextAccepted
                    : styles.statusPillTextDeclined,
                ]}
              >
                {applicationStatus === "accepted" ? "Accepted" : "Declined"}
              </Text>
            </View>
          </View>
        ) : null}

        {!isRead ? (
          <TouchableOpacity
            style={[
              styles.markReadBtn,
              markingRead && { opacity: 0.75 },
            ]}
            disabled={markingRead}
            onPress={markAsRead}
          >
            <Ionicons name="checkmark-circle" size={16} color="#fff" />
            <Text style={styles.markReadText}>
              {markingRead ? "Marking..." : "Mark as read"}
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.metaRow}>
          <Ionicons
            name={isRead ? "checkmark-circle" : "ellipse"}
            size={14}
            color={isRead ? "#4CAF50" : "#FF80AB"}
          />
          <Text style={styles.metaText}>
            {isRead ? "Marked as read" : "Unread notification"}
          </Text>
        </View>

      

       
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: any }) {
  if (!hasValue(value)) return null;
  const normalizedLabel = String(label || "").trim().toLowerCase();
  const renderedValue =
    normalizedLabel === "start time" ||
    normalizedLabel === "end time" ||
    normalizedLabel === "requested end time"
      ? formatTimeValue(String(value))
      : String(value);
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {renderedValue}
      </Text>
    </View>
  );
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  hero: {
    paddingTop: rs(12),
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
  heroTitle: {
    color: "#fff",
    fontSize: rf(18),
    fontWeight: "700",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: rs(20),
    gap: rs(12),
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
    color: "#fff",
    fontSize: rf(16),
    fontWeight: "700",
  },
  heroSub: {
    color: "#FFE4EC",
    fontSize: rf(12),
    marginTop: rs(2),
  },

  contentScroll: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  content: {
    padding: rs(16),
    paddingBottom: rs(30),
    backgroundColor: "#FFFFFF",
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

  metaRow: {
    marginTop: rs(10),
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
  },
  metaText: {
    fontSize: rf(12),
    color: "#6B4350",
    fontWeight: "600",
  },
  markReadBtn: {
    marginTop: rs(12),
    backgroundColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: rs(12),
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: rs(8),
  },
  markReadText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(13),
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: rs(6),
    gap: rs(8),
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
  decisionRow: {
    flexDirection: "row",
    gap: rs(10),
    marginTop: rs(16),
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: rs(12),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
  },
  declineBtn: {
    flex: 1,
    backgroundColor: "#FFF7FC",
    borderRadius: rs(12),
    paddingVertical: rs(12),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FF80AB",
  },
  decisionText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(13),
  },
  decisionTextAlt: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(13),
  },
  statusPillWrap: {
    marginTop: rs(16),
    alignItems: "flex-start",
  },
  statusPill: {
    borderRadius: rs(12),
    paddingHorizontal: rs(14),
    paddingVertical: rs(10),
    borderWidth: 1,
  },
  statusPillAccepted: {
    backgroundColor: "#E7F8EF",
    borderColor: "#66BB6A",
  },
  statusPillDeclined: {
    backgroundColor: "#FFECEF",
    borderColor: "#E57373",
  },
  statusPillText: {
    fontWeight: "700",
    fontSize: rf(13),
  },
  statusPillTextAccepted: {
    color: "#2E7D32",
  },
  statusPillTextDeclined: {
    color: "#C62828",
  },
  mapWrap: {
    marginTop: rs(12),
    borderRadius: rs(14),
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  map: {
    width: "100%",
    height: rs(200),
  },

  actionRow: {
    flexDirection: "row",
    marginTop: rs(16),
    gap: rs(10),
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: rs(12),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
  },
  primaryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(13),
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: "#FFE4EC",
    borderRadius: rs(12),
    paddingVertical: rs(12),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
  },
  secondaryText: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(13),
  },

  tipBox: {
    marginTop: rs(14),
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    backgroundColor: "#FFF5F8",
    padding: rs(12),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  tipText: {
    fontSize: rf(12),
    color: "#6B4350",
    flex: 1,
  },
});
