import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest, getRuntimeApiKey, sanitizeToken } from "../Api";
import NannyBottomNav, { NannyNavKey } from "../components/NannyBottomNav";
import SafeScreen from "../components/SafeScreen";
import { formatDateToMDY } from "../utils/dateFormat";
import { rf, rs } from "../utils/responsive";

const ACCEPTED_STATUSES = ["accepted", "accept", "approved", "confirmed"];
const REJECTED_STATUSES = ["reject", "rejected", "declined", "decline"];
const PENDING_STATUSES = ["pending", "requested", "request_sent", "applied", "waiting"];
const HIDDEN_JOB_STATUSES = [
  "cancel",
  "cancelled",
  "canceled",
  "completed",
  "complete",
  "done",
  "closed",
  "expired",
  "withdrawn",
];
const HIDDEN_APPLICATION_STATUSES = [
  ...REJECTED_STATUSES,
  "cancelled",
  "canceled",
  "completed",
  "closed",
  "expired",
  "withdrawn",
];

const normalizeStatus = (value: any) => String(value || "").trim().toLowerCase();
const parseNumeric = (value: any): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const isHireRequestJob = (job: any) => {
  const explicitSources = [
    job?.request_source,
    job?.application?.request_source,
    ...(Array.isArray(job?.applications)
      ? job.applications.flatMap((entry: any) => [
          entry?.request_source,
          entry?.application?.request_source,
        ])
      : []),
  ]
    .map((value: any) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

  if (explicitSources.includes("hire_request") || explicitSources.includes("hire-request")) {
    return true;
  }

  const statuses = [
    job?.status,
    job?.application_status,
    job?.my_application_status,
    job?.application?.status,
    ...(Array.isArray(job?.applications) ? job.applications.map((entry: any) => entry?.status) : []),
  ]
    .map((value: any) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (statuses.includes("hire_requested") || statuses.includes("hire-requested")) {
    return true;
  }

  const haystack = [
    job?.message,
    job?.application?.message,
    ...(Array.isArray(job?.applications) ? job.applications.map((entry: any) => entry?.message) : []),
  ]
    .map((value: any) => String(value || "").toLowerCase())
    .join(" ");

  return haystack.includes("source:hire_now");
};

const collectApplicationStatuses = (job: any): string[] => {
  const statuses: string[] = [];
  const pushStatus = (value: any) => {
    const normalized = normalizeStatus(value);
    if (!normalized) return;
    statuses.push(normalized);
  };

  const hasApplicationMarker =
    job?.has_applied === true ||
    job?.has_applied === 1 ||
    job?.has_pending_application === true ||
    job?.has_pending_application === 1 ||
    !!job?.my_application_status ||
    !!job?.request_status ||
    !!job?.application?.status ||
    !!job?.current_application?.status;

  const sources = [
    job?.application_status,
    job?.my_application_status,
    job?.request_status,
    job?.application?.status,
    job?.application?.application_status,
    job?.current_application?.status,
  ];

  if (hasApplicationMarker) {
    sources.push(job?.status, job?.job_status);
  }

  sources.forEach(pushStatus);

  return statuses;
};

const shouldHideJobFromFeed = (job: any) => {
  const jobStatuses = [
    job?.status,
    job?.job_status,
  ]
    .map((value: any) => normalizeStatus(value))
    .filter(Boolean);
  if (jobStatuses.some((status) => HIDDEN_JOB_STATUSES.includes(status))) {
    return true;
  }

  const applicationStatuses = collectApplicationStatuses(job);
  return applicationStatuses.some((status) => HIDDEN_APPLICATION_STATUSES.includes(status));
};

const parseDateValue = (value: any): Date | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]) - 1;
    const day = Number(ymd[3]);
    const localDate = new Date(year, month, day);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseDateTimeValue = (dateValue: any, timeValue: any): Date | null => {
  const dateRaw = String(dateValue || "").trim();
  if (!dateRaw) return null;

  const dateOnly = parseDateValue(dateRaw);
  if (!dateOnly) return null;

  const timeRaw = String(timeValue || "").trim();
  if (!timeRaw) {
    return dateOnly;
  }

  const match = timeRaw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return dateOnly;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || "0");
  const combined = new Date(
    dateOnly.getFullYear(),
    dateOnly.getMonth(),
    dateOnly.getDate(),
    hours,
    minutes,
    seconds,
    0
  );

  return Number.isNaN(combined.getTime()) ? dateOnly : combined;
};

const getStartDateRaw = (job: any) =>
  job?.start_date ||
  job?.date ||
  job?.job?.start_date ||
  job?.job?.date ||
  job?.application?.start_date ||
  "";

const getEndDateRaw = (job: any) =>
  job?.end_date ||
  job?.job?.end_date ||
  job?.application?.end_date ||
  "";

const getStartTimeRaw = (job: any) =>
  job?.start_time ||
  job?.job?.start_time ||
  job?.application?.start_time ||
  "";

type Props = {
  navigation?: any;
  onJobSelect?: (job: any) => void;
  onRequireVerification?: () => void;
  onHome?: () => void;
  onJobs?: () => void;
  onCalendar?: () => void;
  onMessages?: () => void;
  onNotifications?: () => void;
  onSettings?: () => void;
};

export default function NannyJobsScreen({
  navigation,
  onJobSelect,
  onRequireVerification,
  onHome,
  onJobs,
  onCalendar,
  onMessages,
  onNotifications,
  onSettings,
}: Props) {
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState("All");
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [favoriteRecordByJobId, setFavoriteRecordByJobId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [activeJob, setActiveJob] = useState<any>(null);
  const [applyingJobIds, setApplyingJobIds] = useState<string[]>([]);
  const [activeTab] = useState<NannyNavKey>("Jobs");

  const isVerificationRequiredError = (error: any) => {
    const message = String(error?.message || "").toLowerCase();
    const code = String(
      error?.code ||
        error?.payload?.code ||
        error?.response?.data?.code ||
        ""
    ).toLowerCase();
    return (
      code.includes("verification_required") ||
      message.includes("nanny_verification_required") ||
      message.includes("verification is required before accessing") ||
      message.includes("verification required") ||
      (
        message.includes("payment") &&
        message.includes("background check") &&
        message.includes("admin approval")
      )
    );
  };

  const extractKidInfo = (job: any) => {
    const names: string[] = [];
    const ages: Array<number | string> = [];

    const collect = (child: any) => {
      if (!child) return;
      if (child.name) names.push(child.name);
      if (child.age !== undefined && child.age !== null) ages.push(child.age);
    };

    const sources = [job?.kid, job?.child, job?.kids];
    sources.forEach((source) => {
      if (Array.isArray(source)) {
        source.forEach((entry: any) => collect(entry?.kids || entry?.kid || entry));
      } else {
        collect(source);
      }
    });

    return { names, ages };
  };

  useEffect(() => {
    fetchJobs();
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
      const apiKey =
        (await AsyncStorage.getItem("api_key")) ||
        getRuntimeApiKey() ||
        undefined;
      const storedNannyId = await AsyncStorage.getItem("nanny_id");
      const storedUserId = await AsyncStorage.getItem("user_id");
      const nannyId = String(storedNannyId || storedUserId || "").trim();
      const raw = await AsyncStorage.getItem("favorite_job_ids");
      const parsed = raw ? JSON.parse(raw) : [];
      const localIds = Array.isArray(parsed) ? parsed.map((id) => String(id)) : [];

      if ((token || apiKey) && nannyId) {
        const payload: any = await apiRequest(
          `favorite-jobs/${encodeURIComponent(String(nannyId))}`,
          {
            method: "GET",
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(apiKey ? { "x-api-key": apiKey } : {}),
            },
          }
        );
        const list = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload)
          ? payload
          : [];
        const recordMap: Record<string, string> = {};
        const remoteJobIds: string[] = [];
        list.forEach((entry: any) => {
          const job = entry?.job || entry;
          const jobId = String(job?.id ?? entry?.job_id ?? "").trim();
          const favoriteId = String(entry?.id ?? "").trim();
          if (!jobId) return;
          remoteJobIds.push(jobId);
          if (favoriteId) recordMap[jobId] = favoriteId;
        });
        const mergedIds = Array.from(new Set([...remoteJobIds, ...localIds]));
        setSavedIds(mergedIds);
        setFavoriteRecordByJobId(recordMap);
        return;
      }

      setSavedIds(localIds);
    } catch {
      // ignore storage parse errors
    }
  };

  const persistFavorites = async (ids: string[], favorites: any[]) => {
    await AsyncStorage.multiSet([
      ["favorite_job_ids", JSON.stringify(ids)],
      ["favorite_jobs", JSON.stringify(favorites)],
    ]);
  };

  const extractJobsFromPayload = (payload: any) =>
    Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data?.data)
      ? payload.data.data
      : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.jobs)
      ? payload.jobs
      : [];

	  const fetchJobs = async () => {
  setLoading(true);
  try {
    const tokenRaw =
      (await AsyncStorage.getItem("token")) ||
      (await AsyncStorage.getItem("nanny_token"));
    const token = sanitizeToken(tokenRaw || undefined);
    const apiKey =
      (await AsyncStorage.getItem("api_key")) ||
      getRuntimeApiKey() ||
      undefined;
    const storedNannyId = await AsyncStorage.getItem("nanny_id");
    const storedUserId = await AsyncStorage.getItem("user_id");
    const effectiveNannyId = String(storedNannyId || storedUserId || "").trim();
    const query = effectiveNannyId
      ? `?nanny_id=${encodeURIComponent(effectiveNannyId)}`
      : "";
    const payload: any = await apiRequest(`job/index${query}`, {
      method: "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
    });
    const raw = extractJobsFromPayload(payload);

    console.log("[NannyJobs] fetchJobs context", {
      effectiveNannyId,
      query: "",
      rawCount: Array.isArray(raw) ? raw.length : 0,
      firstJobs: Array.isArray(raw)
        ? raw.slice(0, 5).map((job: any) => ({
            id: job?.id ?? job?.job_id,
            status: job?.status ?? job?.job_status,
            start_date: job?.start_date ?? job?.job?.start_date,
            request_source: job?.request_source,
            has_applied: job?.has_applied,
            has_pending_application: job?.has_pending_application,
          }))
        : [],
    });

	    const mapped = raw
	      .filter((job: any) => !isHireRequestJob(job))
	      .filter((job: any) => !shouldHideJobFromFeed(job))
	      .map((job: any) => {
        const parentFullName = [job.parent_firstname, job.parent_lastname]
          .filter(Boolean)
          .join(" ")
          .trim();
        const family =
          job.parent_name ||
          parentFullName ||
          job.parent?.name ||
          "Parent";
        const kidInfo = extractKidInfo(job);
        const kidName =
          kidInfo.names.join(", ") ||
          job.kid_name ||
          (job.kid_id ? `Kid #${job.kid_id}` : "");
        const hours = job.hours ? `${job.hours} ` : "Hours TBD";

        const rate =
          job.price ||
          job.total_price ||
          job.hourly_rate ||
          job.rate ||
          job.pay_rate ||
          "";
        const pay =
          rate
            ? rate.toString().includes("$") || rate.toString().includes("/")
              ? rate
              : `$${rate}`
            : "Rate TBD";

	        const startDateRaw = getStartDateRaw(job);
	        const endDateRaw = getEndDateRaw(job);
        const startDate = formatDateToMDY(startDateRaw) || "Flexible";
        const endDate = formatDateToMDY(endDateRaw);
        const schedule =
          endDate && startDate && endDate !== startDate
            ? `${startDate} - ${endDate}`
            : startDate || "Flexible";
        const statuses = collectApplicationStatuses(job);
        const applicationStatus =
          statuses.find(
            (status) =>
              PENDING_STATUSES.includes(status) ||
              ACCEPTED_STATUSES.includes(status) ||
              REJECTED_STATUSES.includes(status)
          ) ?? null;
        const hasPending =
          (job.has_applied === true || job.has_applied === 1) &&
            statuses.some((status) => PENDING_STATUSES.includes(status)) ||
          job.has_pending_application === 1 ||
          job.has_pending_application === true;
        const parentRating =
          parseNumeric(job.parent_average_rating) ??
          parseNumeric(job.parent?.average_rating) ??
          null;
        const parentJobsPostedCount =
          parseNumeric(job.parent_jobs_posted_count) ??
          parseNumeric(job.parent?.jobs_posted_count) ??
          0;
        const parentRatingsCount =
          parseNumeric(job.parent_ratings_count) ??
          parseNumeric(job.parent_raters_count) ??
          parseNumeric(job.parent?.ratings_count) ??
          parseNumeric(job.parent?.raters_count) ??
          0;

        return {
          id: String(job.id),
          family,
          pay,
          startDate,
          endDate,
          endDateRaw: endDateRaw || "",
          schedule,
          summary: job.summary || job.notes || job.description || "",
          location: job.location || job.address || "Location TBD",
          notes: job.notes || job.description || "",
          startDateRaw: startDateRaw || "",
          startTimeRaw: getStartTimeRaw(job),
          applicationStatus,
          hasPending,
          parentRating,
          parentJobsPostedCount,
          parentRatingsCount,
          raw: job,
        };
      });

    console.log("[NannyJobs] mapped jobs", {
      mappedCount: mapped.length,
      firstMapped: mapped.slice(0, 5).map((job: any) => ({
        id: job?.id,
        family: job?.family,
        applicationStatus: job?.applicationStatus,
        startDateRaw: job?.startDateRaw,
        hasPending: job?.hasPending,
      })),
    });

    setJobs(mapped);
  } catch (e: any) {
    if (isVerificationRequiredError(e)) {
      onRequireVerification?.();
      return;
    }
    Alert.alert("Error", e?.message || "Unable to load jobs.");
  } finally {
    setLoading(false);
  }
};


  const applyToJob = async (jobId: string) => {
    if (applyingJobIds.includes(String(jobId))) return;
    setApplyingJobIds((prev) =>
      prev.includes(String(jobId)) ? prev : [...prev, String(jobId)]
    );
    try {
      const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
      const storedNannyId = await AsyncStorage.getItem("nanny_id");
      const storedUserId = await AsyncStorage.getItem("user_id");
      const effectiveNannyId = String(storedNannyId || storedUserId || "").trim();
      const effectiveUserId = String(storedUserId || storedNannyId || "").trim();
      const apiKey =
        (await AsyncStorage.getItem("api_key")) ||
        getRuntimeApiKey() ||
        undefined;

      const res: any = await apiRequest("jobs/send-request", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          job_id: jobId,
          nanny_id: effectiveNannyId || undefined,
          user_id: effectiveUserId || undefined,
        }),
      });

      const successMessage =
        res?.message || res?.data?.message || "Request sent successfully.";
      setJobs((prev) =>
        prev.map((job) =>
          String(job.id) === String(jobId)
            ? { ...job, hasPending: true, applicationStatus: "pending" }
            : job
        )
      );
      setActiveJob((prev: any) =>
        prev && String(prev.id) === String(jobId)
          ? { ...prev, hasPending: true, applicationStatus: "pending" }
          : prev
      );
      Alert.alert("Applied", String(successMessage));
    } catch (e: any) {
      const apiMessage =
        e?.message ||
        "Could not apply right now.";
      if (isVerificationRequiredError(e)) {
        onRequireVerification?.();
        return;
      }
      const normalizedMessage = String(apiMessage).toLowerCase();
      if (
        normalizedMessage.includes("already") ||
        normalizedMessage.includes("pending") ||
        normalizedMessage.includes("already applied")
      ) {
        setJobs((prev) =>
          prev.map((job) =>
            String(job.id) === String(jobId)
              ? { ...job, hasPending: true, applicationStatus: "pending" }
              : job
          )
        );
      }
      if (
        normalizedMessage.includes("already been accepted") ||
        normalizedMessage.includes("no longer available")
      ) {
        setJobs((prev) =>
          prev.filter((job) => String(job.id) !== String(jobId))
        );
        setActiveJob((prev: any) =>
          prev && String(prev.id) === String(jobId) ? null : prev
        );
      }
      Alert.alert("Error", String(apiMessage));
    } finally {
      setApplyingJobIds((prev) => prev.filter((id) => id !== String(jobId)));
    }
  };

  const toggleSaved = async (job: any) => {
    const jobId = String(job.id);
    const isSaved = savedIds.includes(jobId);
    const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
    const apiKey =
      (await AsyncStorage.getItem("api_key")) ||
      getRuntimeApiKey() ||
      undefined;
    const storedNannyId = await AsyncStorage.getItem("nanny_id");
    const storedUserId = await AsyncStorage.getItem("user_id");
    const effectiveNannyId = String(storedNannyId || storedUserId || "").trim();
    const effectiveUserId = String(storedUserId || storedNannyId || "").trim();

    let nextIds = savedIds;
    let nextMap = { ...favoriteRecordByJobId };

    if (isSaved) {
      const favoriteId = nextMap[jobId];
      if ((token || apiKey) && favoriteId) {
        await apiRequest(
          `favorite-jobs/${encodeURIComponent(String(favoriteId))}`,
          {
            method: "DELETE",
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(apiKey ? { "x-api-key": apiKey } : {}),
            },
          }
        ).catch((err) => {
          console.warn("favorite remove failed", err?.message || err);
          return null;
        });
      }
      nextIds = savedIds.filter((id) => id !== jobId);
      delete nextMap[jobId];
    } else {
      if ((token || apiKey) && (effectiveNannyId || effectiveUserId)) {
        const res = await apiRequest<any>("favorite-jobs", {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            nanny_id: effectiveNannyId || undefined,
            user_id: effectiveUserId || undefined,
            job_id: jobId,
            api_key: apiKey || undefined,
          }),
        }).catch((err) => {
          console.warn("favorite add failed", err?.message || err);
          return null;
        });
        const createdId = String((res as any)?.data?.id ?? (res as any)?.id ?? "").trim();
        if (createdId) nextMap[jobId] = createdId;
      }
      nextIds = [...savedIds, jobId];
    }

    let favorites: any[] = [];
    try {
      const raw = await AsyncStorage.getItem("favorite_jobs");
      favorites = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(favorites)) favorites = [];
    } catch {
      console.warn("favorite_jobs parse failed");
      favorites = [];
    }

    const nextFavorites = nextIds.includes(jobId)
      ? [...favorites.filter((j) => String(j.id) !== jobId), job]
      : favorites.filter((j) => String(j.id) !== jobId);

    setSavedIds(nextIds);
    setFavoriteRecordByJobId(nextMap);
    await persistFavorites(nextIds, nextFavorites);
  };


  const filters = ["All", "Today", "This Week"];

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    return jobs.filter((job) => {
      const matchesSearch =
        !q ||
        job.family.toLowerCase().includes(q) ||
        job.location.toLowerCase().includes(q) ||
        (job.summary || job.notes || "").toLowerCase().includes(q);

      if (!matchesSearch) return false;

      const jobDateTime = parseDateTimeValue(job.startDateRaw, job.startTimeRaw);
      if (!jobDateTime || jobDateTime <= now) return false;

      const jobDate = parseDateValue(job.startDateRaw);
      const hasValidDate = !!jobDate;

      if (selectedFilter === "Today") {
        if (!hasValidDate) return false;
        return jobDate >= startOfToday && jobDate < endOfToday;
      }

      if (selectedFilter === "This Week") {
        if (!hasValidDate) return false;
        return jobDate >= startOfWeek && jobDate < endOfWeek;
      }

      if (selectedFilter === "Remote") {
        return job.location.toLowerCase().includes("remote");
      }

      return true;
    });
  }, [jobs, search, selectedFilter]);

  return (
    <SafeScreen edges={["left", "right"]} style={{ backgroundColor: "#FFFFFF" }}>
      <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: rs(2), paddingBottom: rs(88) + Math.max(insets.bottom, 8) }}>
          {/* HEADER */}
          <View style={styles.headerCard}>
            <LinearGradient colors={["#FFE3ED", "#FFF5FA"]} style={styles.headerInner}>
              <View style={styles.headerIcon}>
                <Ionicons name="briefcase-outline" size={22} color="#fff" />
              </View>
              <View style={{ flex: 1, marginLeft: rs(14) }}>
                <Text style={styles.headerTitle}>Find Your Next Booking</Text>
                <Text style={styles.headerSub}>
                  Curated opportunities that match your availability.
                </Text>
              </View>
            </LinearGradient>
          </View>

          {/* SEARCH */}
          <View style={styles.searchOuter}>
            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={18} color="#C2185B" />
              <TextInput
                placeholder="Search families or neighborhoods"
                placeholderTextColor="#C26B8C"
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
              />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
              {filters.map((f) => {
                const active = f === selectedFilter;
                return (
                  <TouchableOpacity
                    key={f}
                    onPress={() => setSelectedFilter(f)}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                  >
                    <Text style={[styles.filterText, active && styles.filterTextActive]}>
                      {f}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* JOB LIST */}
          <View style={styles.jobsWrapper}>
            <Text style={styles.sectionTitle}>Recommended Jobs</Text>

            {loading ? (
              <ActivityIndicator color="#FF80AB" />
            ) : filteredJobs.length === 0 ? (
              <Text style={styles.emptyText}>No jobs available.</Text>
            ) : (
              filteredJobs.map((job, idx) => {
                const normalizedStatus = normalizeStatus(job.applicationStatus);
                const isPending =
                  !!job.hasPending || PENDING_STATUSES.includes(normalizedStatus);
                const isAccepted = ACCEPTED_STATUSES.includes(normalizedStatus);
                const isRejected = REJECTED_STATUSES.includes(normalizedStatus);
                const isApplying = applyingJobIds.includes(String(job.id));
                const disableApply = isPending || isAccepted || isApplying;

                return (
                  <TouchableOpacity
                    key={`nanny-job-${String(job.id ?? "unknown")}-${String(job.startDateRaw ?? idx)}`}
                    style={styles.card}
                    onPress={() => {
                      setActiveJob(job);
                      onJobSelect?.(job);
                    }}
                  >
                    <View style={styles.cardTop}>
                      <View>
                        <Text style={styles.family}>{job.family}</Text>
                        <Text style={styles.summary}>{job.summary}</Text>
                      </View>
                      <TouchableOpacity onPress={() => toggleSaved(job)}>
                        <Ionicons
                          name={savedIds.includes(job.id) ? "heart" : "heart-outline"}
                          size={22}
                          color={savedIds.includes(job.id) ? "#FF80AB" : "#C2185B"}
                        />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.metaRow}>
                      <Ionicons name="time-outline" size={14} color="#C2185B" />
                      <Text style={styles.meta}>{job.schedule}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Ionicons name="location-outline" size={14} color="#C2185B" />
                      <Text style={styles.meta}>{job.location}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Ionicons name="cash-outline" size={14} color="#C2185B" />
                      <Text style={styles.meta}>{job.pay}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Ionicons name="star-outline" size={14} color="#C2185B" />
                      <Text style={styles.meta}>
                        {job.parentRating !== null
                          ? `${job.parentRating.toFixed(1)} rating`
                          : "No ratings yet"}
                        {` • ${job.parentRatingsCount || 0} raters • ${job.parentJobsPostedCount || 0} jobs posted`}
                      </Text>
                    </View>

                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={() => toggleSaved(job)}
                      >
                        <Text style={styles.secondaryText}>
                          {savedIds.includes(job.id) ? "Saved" : "Save"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.primaryBtn,
                          disableApply ? styles.primaryBtnDisabled : null,
                        ]}
                        onPress={() => applyToJob(job.id)}
                        disabled={disableApply}
                      >
                        <Text style={styles.primaryText}>
                          {isApplying
                            ? "Sending..."
                            : isPending
                            ? "Pending"
                            : isAccepted
                              ? "Accepted"
                              : isRejected
                                ? "Rejected"
                                : "Send Request"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </ScrollView>

        {/* ðŸ”¥ BOTTOM NAV */}
        <NannyBottomNav
          active={activeTab}
          onHome={onHome}
          onJobs={onJobs}
          onCalendar={onCalendar}
          onMessages={onMessages}
          onNotifications={onNotifications}
          onSettings={onSettings}
          navigation={navigation}
        />
      </LinearGradient>
    </SafeScreen>
  );
}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  headerCard: {
    marginHorizontal: rs(16),
    marginBottom: rs(16),
    marginTop: rs(6),
    borderRadius: rs(22),
    overflow: "hidden",
  },
  headerInner: { flexDirection: "row", padding: rs(18), alignItems: "center" },
  headerIcon: {
    width: rs(48),
    height: rs(48),
    borderRadius: rs(24),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: rf(18), fontWeight: "700", color: "#880E4F" },
  headerSub: { fontSize: rf(12), color: "#AD1457", marginTop: rs(4) },

  searchOuter: {
    marginHorizontal: rs(16),
    backgroundColor: "#FFF7D6",
    padding: rs(14),
    borderRadius: rs(22),
    borderWidth: 1,
    borderColor: "rgba(255,193,7,0.45)",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3F8",
    padding: rs(12),
    borderRadius: rs(14),
  },
  searchInput: { flex: 1, marginLeft: rs(10), color: "#880E4F" },

  filterRow: { marginTop: rs(12) },
  filterChip: {
    paddingHorizontal: rs(14),
    paddingVertical: rs(8),
    borderRadius: rs(20),
    backgroundColor: "#FFF5F8",
    marginRight: rs(8),
  },
  filterChipActive: { backgroundColor: "#FF80AB" },
  filterText: { color: "#880E4F", fontWeight: "700" },
  filterTextActive: { color: "#fff" },

  jobsWrapper: {
    backgroundColor: "#FFF7D6",
    margin: rs(16),
    borderRadius: rs(20),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,193,7,0.45)",
  },
  sectionTitle: { fontSize: rf(15), fontWeight: "700", color: "#880E4F" },
  emptyText: { marginTop: rs(10), color: "#6B4350" },

  card: {
    marginTop: rs(12),
    backgroundColor: "#FFF5F8",
    borderRadius: rs(16),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: rs(6), marginTop: rs(4) },
  family: { fontSize: rf(15), fontWeight: "700", color: "#880E4F" },
  summary: { fontSize: rf(12), color: "#6B4350", marginTop: rs(2) },
  meta: { fontSize: rf(12), color: "#6B4350" },

  actions: { flexDirection: "row", marginTop: rs(14) },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: rs(10),
    alignItems: "center",
    marginRight: rs(6),
  },
  secondaryText: { color: "#C2185B", fontWeight: "700" },
  primaryBtn: {
    flex: 1,
    backgroundColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: rs(10),
    alignItems: "center",
    marginLeft: rs(6),
  },
  primaryBtnDisabled: {
    backgroundColor: "#F3A9C4",
  },
  primaryText: { color: "#fff", fontWeight: "700" },
});
