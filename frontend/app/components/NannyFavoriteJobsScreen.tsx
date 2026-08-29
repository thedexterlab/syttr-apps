import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { apiRequest, getRuntimeApiKey, isVerificationRequiredApiError, sanitizeToken } from "../Api";
import { rf, rs } from "../utils/responsive";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NannyBottomNav from "../components/NannyBottomNav";

/* =========================
   TYPES
========================= */

type JobItem = {
  id: number | string;
  favorite_id?: string;
  title?: string;
  location?: string;
  date?: string;
  start_time?: string;
  hours?: string;
  rate?: string;
  pay?: string;
  schedule?: string;
  parent_name?: string;
  raw?: any;
};

const getFirstDefined = (...values: any[]) => values.find((v) => v !== undefined && v !== null && String(v).trim() !== "");
const hasValue = (value: any) => value !== undefined && value !== null && String(value).trim() !== "";
const buildName = (first?: any, last?: any) => [first, last].filter(Boolean).join(" ").trim();

const formatCurrencyValue = (value: any, options?: { suffix?: string }) => {
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const suffix = options?.suffix || "";
  const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
  if (Number.isFinite(parsed)) {
    return `${parsed < 0 ? "-" : ""}$${Math.abs(parsed)}${suffix}`;
  }
  const normalized = raw.replace(/\$/g, "").trim();
  return normalized ? `$${normalized}${suffix}` : "";
};

const parseScheduleParts = (value?: any) => {
  const raw = String(value || "").trim();
  if (!raw) return { date: "", time: "" };
  const parts = raw.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { date: parts[0], time: parts[1] };
  }
  return { date: raw, time: "" };
};

const mergeJobItem = (primary: JobItem, fallback: JobItem): JobItem => ({
  ...primary,
  favorite_id: primary.favorite_id || fallback.favorite_id,
  title: hasValue(primary.title) ? primary.title : fallback.title,
  location: hasValue(primary.location) ? primary.location : fallback.location,
  date: hasValue(primary.date) ? primary.date : fallback.date,
  start_time: hasValue(primary.start_time) ? primary.start_time : fallback.start_time,
  hours: hasValue(primary.hours) ? primary.hours : fallback.hours,
  rate: hasValue(primary.rate) ? primary.rate : fallback.rate,
  pay: hasValue(primary.pay) ? primary.pay : fallback.pay,
  schedule: hasValue(primary.schedule) ? primary.schedule : fallback.schedule,
  parent_name: hasValue(primary.parent_name) ? primary.parent_name : fallback.parent_name,
  raw: primary.raw || fallback.raw,
});

const formatDateToMDY = (value?: string) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const extractParentName = (job: any, input: any) => {
  const inputRaw = input?.raw || {};
  return getFirstDefined(
    job?.parent_name,
    job?.parent?.name,
    job?.parent_user?.name,
    job?.client?.name,
    buildName(job?.parent_firstname, job?.parent_lastname),
    input?.parent_name,
    input?.family,
    buildName(input?.parent_firstname, input?.parent_lastname),
    inputRaw?.parent_name,
    inputRaw?.parent?.name,
    inputRaw?.parent_user?.name,
    buildName(inputRaw?.parent_firstname, inputRaw?.parent_lastname)
  );
};

const normalizeFavoriteJob = (input: any): JobItem | null => {
  const job = input?.job || input;
  if (!job) return null;

  const id = job?.id ?? input?.id ?? input?.job_id;
  if (id === undefined || id === null || String(id).trim() === "") return null;
  const scheduleParts = parseScheduleParts(getFirstDefined(job?.schedule, input?.schedule));

  const rateValue = getFirstDefined(
    job?.rate,
    job?.hourly_rate,
    job?.pay_rate,
    job?.price,
    job?.total_price,
    input?.rate,
    input?.pay
  );
  const dateValue = getFirstDefined(
    job?.date,
    job?.start_date,
    job?.startDateRaw,
    job?.startDate,
    input?.date,
    input?.start_date,
    input?.startDateRaw,
    input?.startDate,
    input?.raw?.start_date,
    input?.raw?.date,
    scheduleParts.date
  );
  const startTimeValue = getFirstDefined(
    job?.start_time,
    job?.time,
    job?.startTime,
    input?.start_time,
    input?.time,
    input?.startTime,
    input?.raw?.start_time,
    input?.raw?.time,
    scheduleParts.time
  );
  const resolvedParentName = extractParentName(job, input);

  return {
    id: String(id),
    favorite_id: input?.job ? String(input?.id ?? "") : undefined,
    title: getFirstDefined(job?.title, input?.title, resolvedParentName, job?.summary, input?.summary, "Babysitting Job"),
    location: job?.location || job?.address || input?.location || "",
    date: dateValue ? String(dateValue) : "",
    start_time: startTimeValue ? String(startTimeValue) : "",
    hours: job?.hours || input?.hours || "",
    rate: rateValue !== undefined && rateValue !== null ? String(rateValue) : undefined,
    pay: input?.pay || job?.pay,
    schedule: input?.schedule,
    parent_name: resolvedParentName || "Parent",
    raw: job,
  };
};

const formatRate = (item: JobItem) => {
  const raw = item.pay ?? item.rate;
  if (!raw) return "Rate TBD";
  const rateStr = formatCurrencyValue(raw);
  if (!rateStr) return "Rate TBD";
  return rateStr.includes("/hr") ? rateStr : `${rateStr}/hr`;
};

/* =========================
   SCREEN
========================= */

type Props = {
  navigation?: any;
  onBack?: () => void;
  onHome?: () => void;
  onJobs?: () => void;
  onCalendar?: () => void;
  onMessages?: () => void;
  onNotifications?: () => void;
  onSettings?: () => void;
  onOpenJob?: (job: any) => void;
  onRequireVerification?: () => void;
};

const NannyFavoriteJobsScreen: React.FC<Props> = ({
  navigation,
  onBack,
  onHome,
  onJobs,
  onCalendar,
  onMessages,
  onNotifications,
  onSettings,
  onOpenJob,
  onRequireVerification,
}) => {
  const insets = useSafeAreaInsets();

  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadFavorites();
  }, []);

  /* ---------- LOAD FAVORITES ---------- */
  const loadFavorites = async () => {
    setLoading(true);
    try {
      const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
      const apiKey =
        (await AsyncStorage.getItem("api_key")) ||
        getRuntimeApiKey() ||
        undefined;
      const nannyId =
        (await AsyncStorage.getItem("nanny_id")) ||
        (await AsyncStorage.getItem("user_id"));
      const localRaw = await AsyncStorage.getItem("favorite_jobs");
      const localParsed = localRaw ? JSON.parse(localRaw) : [];
      const localFavorites = Array.isArray(localParsed)
        ? localParsed.map(normalizeFavoriteJob).filter(Boolean) as JobItem[]
        : [];

      if ((!token && !apiKey) || !nannyId) {
        setJobs(localFavorites);
        return;
      }

      const json: any = await apiRequest(
        `favorite-jobs/${encodeURIComponent(String(nannyId))}`,
        {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
        }
      );
      const remoteFavorites = Array.isArray(json?.data)
        ? json.data.map(normalizeFavoriteJob).filter(Boolean) as JobItem[]
        : [];
      const merged = new Map<string, JobItem>();
      remoteFavorites.forEach((job) => merged.set(String(job.id), job));
      localFavorites.forEach((job) => {
        const key = String(job.id);
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, job);
          return;
        }
        merged.set(key, mergeJobItem(existing, job));
      });
      setJobs(Array.from(merged.values()));
    } catch (e) {
      if (isVerificationRequiredApiError(e)) {
        setJobs([]);
        onRequireVerification?.();
        return;
      }
      try {
        const localRaw = await AsyncStorage.getItem("favorite_jobs");
        const localParsed = localRaw ? JSON.parse(localRaw) : [];
        const localFavorites = Array.isArray(localParsed)
          ? localParsed.map(normalizeFavoriteJob).filter(Boolean) as JobItem[]
          : [];
        setJobs(localFavorites);
      } catch {
        setJobs([]);
      }
    } finally {
      setLoading(false);
    }
  };

  /* ---------- REMOVE FAVORITE ---------- */
  const removeFavorite = async (jobId: number | string) => {
    try {
      const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
      const apiKey =
        (await AsyncStorage.getItem("api_key")) ||
        getRuntimeApiKey() ||
        undefined;
      const targetFavoriteId = jobs.find((j) => String(j.id) === String(jobId))?.favorite_id;
      if ((token || apiKey) && targetFavoriteId) {
        try {
          await apiRequest(`favorite-jobs/${encodeURIComponent(String(targetFavoriteId))}`, {
            method: "DELETE",
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(apiKey ? { "x-api-key": apiKey } : {}),
            },
          });
        } catch (error) {
          if (isVerificationRequiredApiError(error)) {
            onRequireVerification?.();
            return;
          }
        }
      }

      const normalizedId = String(jobId);
      setJobs((prev) => prev.filter((j) => String(j.id) !== normalizedId));
      const localRaw = await AsyncStorage.getItem("favorite_jobs");
      const localParsed = localRaw ? JSON.parse(localRaw) : [];
      const localFavorites = Array.isArray(localParsed) ? localParsed : [];
      const nextLocal = localFavorites.filter((job: any) => {
        const id = job?.id ?? job?.job_id ?? job?.job?.id;
        return String(id) !== normalizedId;
      });
      await AsyncStorage.multiSet([
        ["favorite_jobs", JSON.stringify(nextLocal)],
        ["favorite_job_ids", JSON.stringify(nextLocal.map((job: any) => String(job?.id ?? job?.job_id ?? job?.job?.id)).filter(Boolean))],
      ]);
      if (jobs.length > 1) {
        Alert.alert("Removed", "Job removed from favorites.");
      }
    } catch (error) {
      if (isVerificationRequiredApiError(error)) {
        onRequireVerification?.();
        return;
      }
      Alert.alert("Error", "Unable to remove from favorites.");
    }
  };

  const confirmRemoveFavorite = useCallback((jobId: number | string) => {
    Alert.alert(
      "Remove Favorite?",
      "Are you sure you want to remove this job from favorites?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => { void removeFavorite(jobId); } },
      ]
    );
  }, [jobs.length, removeFavorite]);

  const openFavoriteJob = useCallback((item: JobItem) => {
    const formattedDate = formatDateToMDY(item.date) || "Flexible date";
    const detailJob = {
      id: String(item.id),
      family: item.parent_name || "Parent",
      location: item.location || "",
      pay: formatRate(item),
      schedule: item.start_time ? `${formattedDate} - ${item.start_time}` : formattedDate,
      startDate: item.date || "",
      raw: item.raw || {
        id: String(item.id),
        start_date: item.date || "",
        start_time: item.start_time || "",
        location: item.location || "",
      },
    };
    if (onOpenJob) {
      onOpenJob(detailJob);
      return;
    }
    navigation?.navigate?.("NannyJobDetail", { job: detailJob });
  }, [navigation, onOpenJob]);

  /* ---------- RENDER JOB ---------- */
  const renderItem = useCallback(({ item }: { item: JobItem }) => {
    const formattedDate = formatDateToMDY(item.date) || "Flexible date";

    return (
      <TouchableOpacity
        style={styles.jobCard}
        onPress={() => openFavoriteJob(item)}
      >
        <View style={styles.jobHeader}>
          <Text style={styles.jobTitle}>{item.parent_name || item.title || "Babysitting Job"}</Text>
          <TouchableOpacity onPress={() => confirmRemoveFavorite(item.id)}>
            <Ionicons name="heart" size={18} color="#FF80AB" />
          </TouchableOpacity>
        </View>

        <Text style={styles.jobMeta}>
          <Ionicons name="location-outline" size={12} />{" "}
          {item.location || "Location not specified"}
        </Text>

        <Text style={styles.jobMeta}>
          <Ionicons name="calendar-outline" size={12} />{" "}
          {formattedDate} - {item.start_time || "--"}
        </Text>

        <View style={styles.jobFooter}>
          <Text style={styles.rate}>
            {formatRate(item)}
          </Text>
          <Text style={styles.parent}>
            {item.parent_name || "Parent"}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }, [confirmRemoveFavorite, openFavoriteJob]);

  /* =========================
     UI
  ========================= */

  return (
    <LinearGradient
      colors={["#FFFFFF", "#FFFFFF", "#FFFFFF"]}
      style={{ flex: 1 }}
    >
      {/* HEADER */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (onBack) onBack();
            else navigation?.goBack?.();
          }}
        >
          <Ionicons name="chevron-back" size={20} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Favorite Jobs</Text>
        <View style={{ width: rs(34) }} />
      </View>

      {loading ? (
        <ActivityIndicator color="#FF80AB" style={{ marginTop: rs(40) }} />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: rs(16), paddingBottom: rs(88) + Math.max(insets.bottom, 8) }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              You haven&apos;t added any jobs to favorites yet.
            </Text>
          }
        />
      )}
      <NannyBottomNav
        active="Jobs"
        onHome={onHome}
        onJobs={onJobs}
        onCalendar={onCalendar}
        onMessages={onMessages}
        onNotifications={onNotifications}
        onSettings={onSettings}
      />
    </LinearGradient>
  );
};

export default NannyFavoriteJobsScreen;

/* =========================
   STYLES
========================= */

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(12),
  },
  backBtn: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#FFE7F0",
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
  },

  jobCard: {
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
    marginBottom: rs(14),
    elevation: 3,
  },
  jobHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: rs(6),
  },
  jobTitle: {
    fontSize: rf(15),
    fontWeight: "700",
    color: "#880E4F",
  },
  jobMeta: {
    fontSize: rf(12),
    color: "#6B4350",
    marginTop: rs(4),
  },
  jobFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: rs(10),
  },
  rate: {
    fontSize: rf(13),
    fontWeight: "700",
    color: "#C2185B",
  },
  parent: {
    fontSize: rf(12),
    color: "#AD1457",
  },

  empty: {
    textAlign: "center",
    marginTop: rs(40),
    color: "#6B4350",
    fontSize: rf(13),
  },
});
