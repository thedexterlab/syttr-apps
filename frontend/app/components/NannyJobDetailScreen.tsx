import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { apiRequest, BASE_URL, getRuntimeApiKey, sanitizeToken } from "../Api";
import SafeScreen from "../components/SafeScreen";
import { formatDateToMDY } from "../utils/dateFormat";
import { rf, rs } from "../utils/responsive";
import { MapView, Marker } from "../../lib/WebSafeMap";

const STORAGE_ROOT = BASE_URL.replace(/\/api\/?$/, "");

const formatTimeValue = (value: any, fallback = "Time TBD") => {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/\b(am|pm)\b/i.test(raw)) {
    const parsed = new Date(`2000-01-01 ${raw}`);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return raw;
  }
  const hhmm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hhmm) {
    const parsed = new Date(2000, 0, 1, Number(hhmm[1]), Number(hhmm[2]), 0);
    return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) {
    return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return raw;
};

const resolveImageUrl = (value?: string | null): string | undefined => {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replace(/^\/+/, "");
  if (clean.startsWith("storage/") || clean.startsWith("public/")) {
    return `${STORAGE_ROOT}/${clean}`;
  }
  return `${STORAGE_ROOT}/storage/${clean}`;
};

const parseNumeric = (value: any): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

type Props = {
  job?: {
    id?: string;
    family?: string;
    parentImage?: string;
    summary?: string;
    schedule?: string;
    location?: string;
    pay?: string;
    latitude?: number;
    longitude?: number;
    startDate?: string;
    endDate?: string;
    kidName?: string;
    kidAge?: number | string;
    raw?: any;
  };
  navigation?: any;
  onBack?: () => void;
  onSendRequest?: (job: Props["job"]) => Promise<void> | void;
  onRequireVerification?: () => void;
  onOpenParentProfile?: (parent: any) => void;
};

export default function NannyJobDetailScreen({
  job,
  navigation,
  onBack,
  onSendRequest,
  onRequireVerification,
  onOpenParentProfile,
}: Props) {
  const [sending, setSending] = useState(false);
  const [localStatus, setLocalStatus] = useState<string>("");
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [details, setDetails] = useState<{ job?: any; parent?: any; kids?: any[] } | null>(null);

  useEffect(() => {
    const jobId = String(job?.id || job?.raw?.id || "").trim();
    if (!jobId) {
      setDetails(null);
      return;
    }

    let mounted = true;
    const loadDetails = async () => {
      try {
        setDetailsLoading(true);
        const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
        const storedNannyId = await AsyncStorage.getItem("nanny_id");
        const storedUserId = await AsyncStorage.getItem("user_id");
        const effectiveNannyId = String(storedNannyId || storedUserId || "").trim();
        const apiKey =
          (await AsyncStorage.getItem("api_key")) ||
          getRuntimeApiKey() ||
          undefined;
        const detailsPath = effectiveNannyId
          ? `job/${encodeURIComponent(jobId)}/details?nanny_id=${encodeURIComponent(effectiveNannyId)}`
          : `job/${encodeURIComponent(jobId)}/details`;

        const json: any = await apiRequest(detailsPath, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
        });

        if (!mounted) return;
        if (json?.success && json?.data) {
          setDetails({
            job: json.data.job || null,
            parent: json.data.parent || null,
            kids: Array.isArray(json.data.kids) ? json.data.kids : [],
          });
        } else {
          setDetails(null);
        }
      } catch {
        if (mounted) setDetails(null);
      } finally {
        if (mounted) setDetailsLoading(false);
      }
    };

    void loadDetails();
    return () => {
      mounted = false;
    };
  }, [job?.id, job?.raw?.id]);

  const kidInfo = useMemo(() => {
    const kids: {
      name?: string;
      age?: number | string;
      gender?: string;
      allergies?: string | null;
      medical_conditions?: string | null;
      notes?: string | null;
    }[] = [];

    const collect = (child: any) => {
      if (!child) return;
      kids.push({
        name: child.name || child.kid_name,
        age: child.age,
        gender: child.gender,
        allergies: child.allergies,
        medical_conditions: child.medical_conditions,
        notes: child.notes,
      });
    };
    const walkKids = (value: any) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach((entry) => walkKids(entry));
        return;
      }
      collect(value);
      walkKids(value.kids);
      walkKids(value.kid);
      walkKids(value.child);
    };

    const raw = details?.job || job?.raw || {};
    const apiKids = Array.isArray(details?.kids) ? details?.kids : [];

    if (apiKids.length) {
      walkKids(apiKids);
      return kids;
    }
    walkKids(raw.kids);
    walkKids(raw.kid);
    walkKids(raw.child);
    walkKids((job as any)?.kids);
    walkKids((job as any)?.kid);
    walkKids((job as any)?.child);

    return kids;
  }, [details, job]);

  const lat = useMemo(() => {
    const fromJob = Number(job?.latitude);
    if (Number.isFinite(fromJob)) return fromJob;
    const fromRaw = Number(
      details?.job?.latitude ?? details?.job?.lat ?? job?.raw?.latitude ?? job?.raw?.lat
    );
    return Number.isFinite(fromRaw) ? fromRaw : undefined;
  }, [details, job]);

  const lon = useMemo(() => {
    const fromJob = Number(job?.longitude);
    if (Number.isFinite(fromJob)) return fromJob;
    const fromRaw = Number(
      details?.job?.longitude ??
        details?.job?.lng ??
        details?.job?.lon ??
        job?.raw?.longitude ??
        job?.raw?.lng ??
        job?.raw?.lon
    );
    return Number.isFinite(fromRaw) ? fromRaw : undefined;
  }, [details, job]);

  const region =
    lat !== undefined && lon !== undefined
      ? { latitude: lat, longitude: lon, latitudeDelta: 0.03, longitudeDelta: 0.03 }
      : undefined;

  const parentInfo = useMemo(
    () => ({
      name:
        details?.parent?.parent_name ||
        details?.parent?.name ||
        job?.family ||
        job?.raw?.parent_user?.name ||
        job?.raw?.parent?.name ||
        job?.raw?.parent_user?.email ||
        "Client",
      email:
        details?.parent?.parent_email ||
        details?.parent?.email ||
        job?.raw?.parent_user?.email ||
        "--",
      image: resolveImageUrl(
        job?.parentImage ||
        details?.parent?.user_image_url ||
          details?.parent?.profile_image ||
          details?.parent?.user_image ||
          details?.job?.parent_image_url ||
          details?.job?.parent_image ||
          job?.raw?.parent_image_url ||
          job?.raw?.parent_profile_image ||
          job?.raw?.parent_image ||
          job?.raw?.parent?.profile_image ||
          job?.raw?.parent?.user_image_url ||
          job?.raw?.parent?.user_image ||
          job?.raw?.parent_user?.profile_image ||
          job?.raw?.parent_user?.user_image
      ),
      phone: details?.parent?.phone || details?.parent?.number || "--",
      area: details?.parent?.city_area || details?.parent?.city || "--",
      country: details?.parent?.country || "--",
      averageRating:
        parseNumeric(details?.parent?.average_rating) ??
        parseNumeric(details?.job?.parent_average_rating) ??
        parseNumeric(job?.raw?.parent_average_rating) ??
        null,
      jobsPostedCount:
        parseNumeric(details?.parent?.jobs_posted_count) ??
        parseNumeric(details?.job?.parent_jobs_posted_count) ??
        parseNumeric(job?.raw?.parent_jobs_posted_count) ??
        0,
      ratingsCount:
        parseNumeric(details?.parent?.ratings_count) ??
        parseNumeric(details?.parent?.raters_count) ??
        parseNumeric(details?.job?.parent_ratings_count) ??
        parseNumeric(details?.job?.parent_raters_count) ??
        parseNumeric(job?.raw?.parent_ratings_count) ??
        parseNumeric(job?.raw?.parent_raters_count) ??
        0,
    }),
    [details, job]
  );

  const kidNames = kidInfo.map((k) => k.name).filter(Boolean) as string[];
  const kidName = job?.kidName || (kidNames.length ? kidNames.join(", ") : "Child");
  const primaryAge =
    job?.kidAge ??
    (kidInfo.length === 1 ? kidInfo[0].age : undefined);
  const kidCountLabel = kidInfo.length > 1 ? `${kidInfo.length} children` : null;
  const hours =
    (details?.job?.hours !== undefined && details?.job?.hours !== null)
      ? `${details.job.hours} hrs`
      : job?.raw?.hours !== undefined && job?.raw?.hours !== null
      ? `${job.raw.hours} hrs`
      : "Hours TBD";
  const startDate = formatDateToMDY(details?.job?.start_date || job?.startDate || job?.raw?.start_date);
  const endDate = formatDateToMDY(details?.job?.end_date || job?.endDate || job?.raw?.end_date);
  const startTime = formatTimeValue(
    details?.job?.start_time ||
      details?.job?.time ||
      job?.raw?.start_time ||
      job?.raw?.time
  );
  const endTime = formatTimeValue(
    details?.job?.end_time ||
      job?.raw?.end_time,
    ""
  );
  const timeLabel =
    endTime && endTime !== startTime
      ? `${startTime} - ${endTime}`
      : startTime;
  const schedule =
    startDate && endDate && endDate !== startDate
      ? `${startDate} - ${endDate}`
      : startDate || formatDateToMDY(job?.schedule || job?.raw?.start_date) || "--";
  const postedOn = formatDateToMDY(details?.job?.created_at || job?.raw?.created_at);
  const locLabel = details?.job?.location || job?.location || "Location not set";
  const hasAppliedFlag =
    details?.job?.has_applied === true ||
    details?.job?.has_applied === 1 ||
    details?.job?.has_pending_application === true ||
    details?.job?.has_pending_application === 1 ||
    job?.raw?.has_applied === true ||
    job?.raw?.has_applied === 1 ||
    job?.raw?.has_pending_application === true ||
    job?.raw?.has_pending_application === 1;
  const derivedApplicationStatus =
    localStatus ||
    details?.job?.my_application_status ||
    details?.job?.application_status ||
    details?.job?.application?.status ||
    details?.job?.current_application?.status ||
    job?.raw?.my_application_status ||
    job?.raw?.request_status ||
    job?.raw?.application?.status ||
    job?.raw?.current_application?.status ||
    (hasAppliedFlag ? job?.raw?.application_status || job?.raw?.applicationStatus : null) ||
    (hasAppliedFlag ? "pending" : null);
  const applicationStatus = derivedApplicationStatus || null;
  const normalizedStatus = applicationStatus ? String(applicationStatus).toLowerCase() : "";
  const statusLabel =
    normalizedStatus === "pending"
      ? "Pending"
      : normalizedStatus === "accept" || normalizedStatus === "accepted"
        ? "Accepted"
        : normalizedStatus === "reject" || normalizedStatus === "rejected"
          ? "Rejected"
          : "Send request";
  const statusLocked =
    normalizedStatus === "pending" ||
    normalizedStatus === "accept" ||
    normalizedStatus === "accepted" ||
    normalizedStatus === "reject" ||
    normalizedStatus === "rejected";

  const handleOpenParentProfile = () => {
    if (!onOpenParentProfile) return;
    onOpenParentProfile({
      ...(job?.raw?.parent || {}),
      ...(job?.raw?.parent_user || {}),
      ...(details?.parent || {}),
      user_id:
        details?.parent?.user_id ||
        job?.raw?.parent?.user_id ||
        job?.raw?.parent_user?.user_id ||
        job?.raw?.user_id,
      parent_name: parentInfo.name,
      parent_email: parentInfo.email,
      phone: parentInfo.phone,
      city_area: parentInfo.area,
      country: parentInfo.country,
      average_rating: parentInfo.averageRating,
      jobs_posted_count: parentInfo.jobsPostedCount,
      ratings_count: parentInfo.ratingsCount,
      user_image_url: parentInfo.image,
      kids: kidInfo,
      created_at: details?.parent?.created_at || job?.raw?.created_at,
    });
  };

  const sendRequest = async () => {
    if (!job?.id) {
      Alert.alert("Unavailable", "Job ID missing");
      return;
    }

    if (onSendRequest) {
      return onSendRequest(job);
    }

    try {
      setSending(true);
      const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
      const nannyId = (await AsyncStorage.getItem("nanny_id")) || (await AsyncStorage.getItem("user_id"));
      const userId = await AsyncStorage.getItem("user_id");
      const effectiveUserId = userId || nannyId || "";
      const apiKey =
        (await AsyncStorage.getItem("api_key")) ||
        getRuntimeApiKey() ||
        undefined;

      const data: any = await apiRequest("jobs/send-request", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({ job_id: job.id, nanny_id: nannyId, user_id: effectiveUserId }),
      });

      if (data?.success === false) {
        const apiMessage =
          data?.message ||
          data?.error ||
          (typeof data === "string" ? data : "") ||
          "Could not send request right now.";
        const normalizedApiMessage = String(apiMessage).toLowerCase();
        const normalizedCode = String(data?.code || "").toLowerCase();
        if (
          normalizedCode === "nanny_verification_required" ||
          normalizedApiMessage.includes("nanny_verification_required") ||
          normalizedApiMessage.includes("verification is required before accessing nanny features")
        ) {
          onRequireVerification?.();
          return;
        }
        Alert.alert("Error", String(apiMessage));
        return;
      }

      const successMessage = data?.message || "Request sent successfully.";
      setLocalStatus("pending");
      Alert.alert("Applied", String(successMessage));
    } catch (e: any) {
      const normalizedMessage = String(e?.message || "").toLowerCase();
      const normalizedCode = String(e?.code || e?.response?.data?.code || "").toLowerCase();
      if (
        normalizedCode === "nanny_verification_required" ||
        normalizedMessage.includes("nanny_verification_required") ||
        normalizedMessage.includes("verification is required before accessing nanny features")
      ) {
        onRequireVerification?.();
        return;
      }
      Alert.alert("Error", e?.message || "Could not send request right now.");
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeScreen edges={["left", "right"]} style={{ backgroundColor: "#FFF6FA" }}>
      <LinearGradient colors={["#FFE3ED", "#FFF6FA"]} style={styles.hero}>
        <View style={styles.heroRow}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              if (onBack) onBack();
              else navigation?.goBack?.();
            }}
          >
            <Ionicons name="chevron-back" size={18} color="#C2185B" />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{parentInfo.name}</Text>
            <Text style={styles.heroSub}>Job Details</Text>
          </View>
          <View style={styles.parentAvatar}>
            {parentInfo.image ? (
              <Image source={{ uri: parentInfo.image }} style={styles.parentAvatarImage} />
            ) : (
              <Ionicons name="person" size={18} color="#C2185B" />
            )}
          </View>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: rs(16), paddingBottom: rs(32) }}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>{kidName}</Text>
              <Text style={styles.cardMeta}>
                {(primaryAge ? `Age ${primaryAge}` : kidCountLabel ? kidCountLabel : "Child details") +
                  (hours ? ` | ${hours}` : "")}
              </Text>
            </View>
            {job?.pay ? <Text style={styles.payTag}>{job.pay}</Text> : null}
          </View>

          <View style={styles.row}>
            <Ionicons name="calendar-outline" size={14} color="#C2185B" />
            <Text style={styles.rowText}>{schedule}</Text>
          </View>
          <View style={styles.row}>
            <Ionicons name="time-outline" size={14} color="#C2185B" />
            <Text style={styles.rowText}>{timeLabel}</Text>
          </View>
          <View style={styles.row}>
            <Ionicons name="location-outline" size={14} color="#C2185B" />
            <Text style={styles.rowText}>{locLabel}</Text>
          </View>
          {detailsLoading ? <Text style={[styles.fieldLabel, { marginTop: rs(10) }]}>Loading full details...</Text> : null}
        </View>

        <View style={[styles.card, { marginTop: rs(12) }]}>
          <Text style={styles.sectionHeaderText}>Child{kidInfo.length > 1 ? "ren" : ""}</Text>
          {kidInfo.length === 0 ? (
            <>
              <Text style={styles.infoValue}>Not provided</Text>
            </>
          ) : (
            kidInfo.map((kid, idx) => (
              <View key={`${kid.name || "kid"}-${idx}`} style={{ marginTop: idx === 0 ? 4 : 12 }}>
                <Text style={styles.infoValue}>{kid.name || "Child"}</Text>
                {kid.age !== undefined && kid.age !== null ? (
                  <>
                    <Text style={[styles.fieldLabel, { marginTop: rs(4) }]}>Age</Text>
                    <Text style={styles.infoValue}>{kid.age}</Text>
                  </>
                ) : null}
                {kid.gender ? (
                  <>
                    <Text style={[styles.fieldLabel, { marginTop: rs(4) }]}>Gender</Text>
                    <Text style={styles.infoValue}>{kid.gender}</Text>
                  </>
                ) : null}
                {kid.allergies ? (
                  <>
                    <Text style={[styles.fieldLabel, { marginTop: rs(4) }]}>Allergies</Text>
                    <Text style={styles.infoValue}>{kid.allergies}</Text>
                  </>
                ) : null}
                {kid.medical_conditions ? (
                  <>
                    <Text style={[styles.fieldLabel, { marginTop: rs(4) }]}>Medical conditions</Text>
                    <Text style={styles.infoValue}>{kid.medical_conditions}</Text>
                  </>
                ) : null}
                {kid.notes ? (
                  <>
                    <Text style={[styles.fieldLabel, { marginTop: rs(4) }]}>Notes</Text>
                    <Text style={styles.infoValue}>{kid.notes}</Text>
                  </>
                ) : null}
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionHeaderWithSpacing}>Location</Text>
        <View style={styles.mapWrapper}>
          <MapView
            style={styles.map}
            region={region}
            showsUserLocation
            showsMyLocationButton
          >
            {region ? (
              <Marker
                coordinate={{ latitude: region.latitude, longitude: region.longitude }}
                title={parentInfo.name}
                description={locLabel}
              />
            ) : null}
          </MapView>
          {!region ? (
            <View style={styles.mapPlaceholder}>
              <Text style={styles.mapPlaceholderText}>Location not set</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.card, { marginTop: rs(16) }]}
          activeOpacity={onOpenParentProfile ? 0.88 : 1}
          onPress={handleOpenParentProfile}
          disabled={!onOpenParentProfile}
        >
          <View style={styles.parentCardHeader}>
            <View style={styles.parentAvatarLarge}>
              {parentInfo.image ? (
                <Image source={{ uri: parentInfo.image }} style={styles.parentAvatarImage} />
              ) : (
                <Ionicons name="person" size={22} color="#C2185B" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionHeaderText}>Parent</Text>
              <Text style={styles.infoValue}>{parentInfo.name}</Text>
            </View>
          </View>
          <View style={styles.parentStatsRow}>
            <View style={styles.parentStatChip}>
              <Ionicons name="star-outline" size={14} color="#C2185B" />
              <Text style={styles.parentStatText}>
                {parentInfo.averageRating !== null
                  ? parentInfo.averageRating.toFixed(1)
                  : "N/A"}
              </Text>
            </View>
            <View style={styles.parentStatChip}>
              <Ionicons name="briefcase-outline" size={14} color="#C2185B" />
              <Text style={styles.parentStatText}>{parentInfo.jobsPostedCount || 0} jobs</Text>
            </View>
            <View style={styles.parentStatChip}>
              <Ionicons name="people-outline" size={14} color="#C2185B" />
              <Text style={styles.parentStatText}>{parentInfo.ratingsCount || 0} raters</Text>
            </View>
          </View>
          <Text style={[styles.fieldLabel, { marginTop: rs(10) }]}>Lives in</Text>
          <Text style={styles.infoValue}>{parentInfo.area}</Text>
          <Text style={[styles.fieldLabel, { marginTop: rs(10) }]}>Posted on</Text>
          <Text style={styles.infoValue}>{postedOn || "Not provided"}</Text>
        </TouchableOpacity>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => onBack?.() || navigation?.goBack?.()}>
            <Text style={styles.secondaryText}>Close</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (sending || statusLocked) && { opacity: 0.7 },
              statusLocked ? styles.primaryBtnDisabled : null,
            ]}
            onPress={sendRequest}
            disabled={sending || statusLocked}
          >
            <Text style={styles.primaryText}>
              {sending ? "Sending..." : statusLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: rs(16), paddingTop: rs(12), paddingBottom: rs(12) },
  heroRow: { flexDirection: "row", alignItems: "center", gap: rs(12) },
  backBtn: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  heroTitle: { fontSize: rf(18), fontWeight: "700", color: "#880E4F" },
  heroSub: { fontSize: rf(12), color: "#AD1457" },
  parentAvatar: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#FFE4EF",
    borderWidth: 1,
    borderColor: "#FFB4CF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  parentAvatarLarge: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    backgroundColor: "#FFE4EF",
    borderWidth: 1,
    borderColor: "#FFB4CF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginRight: rs(10),
  },
  parentAvatarImage: {
    width: "100%",
    height: "100%",
  },
  parentCardHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  parentStatsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: rs(8),
    marginTop: rs(10),
  },
  parentStatChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
    backgroundColor: "#FFF3F8",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.25)",
    borderRadius: rs(12),
    paddingHorizontal: rs(10),
    paddingVertical: rs(6),
  },
  parentStatText: {
    fontSize: rf(12),
    color: "#6B4350",
    fontWeight: "700",
  },

  card: {
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: rf(16), fontWeight: "700", color: "#880E4F" },
  cardMeta: { fontSize: rf(12), color: "#6B4350", marginTop: rs(4) },
  payTag: {
    backgroundColor: "#FFE7F0",
    paddingHorizontal: rs(10),
    paddingVertical: rs(6),
    borderRadius: rs(10),
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(12),
  },
  row: { flexDirection: "row", alignItems: "center", gap: rs(8), marginTop: rs(8) },
  rowText: { fontSize: rf(13), color: "#6B4350" },

  sectionHeaderText: { fontSize: rf(16), fontWeight: "700", color: "#880E4F" },
  sectionHeaderWithSpacing: {
    marginTop: rs(18),
    marginBottom: rs(8),
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
  },
  mapWrapper: {
    backgroundColor: "#FFF",
    borderRadius: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.25)",
    overflow: "hidden",
  },
  map: { height: rs(260), width: "100%" },
  mapPlaceholder: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  mapPlaceholderText: {
    fontSize: rf(13),
    color: "#AD1457",
    fontWeight: "700",
  },

  fieldLabel: { fontSize: rf(12), color: "#AD1457", fontWeight: "700" },
  infoValue: { fontSize: rf(14), color: "#6B4350", marginTop: rs(4) },

  actions: { flexDirection: "row", marginTop: rs(18), gap: rs(10) },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: rs(12),
    alignItems: "center",
  },
  secondaryText: { color: "#C2185B", fontWeight: "700" },
  primaryBtn: {
    flex: 1,
    backgroundColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: rs(12),
    alignItems: "center",
  },
  primaryBtnDisabled: {
    backgroundColor: "#F3A9C4",
  },
  primaryText: { color: "#fff", fontWeight: "700" },
});
