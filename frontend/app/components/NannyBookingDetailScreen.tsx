import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { hp, rf, rs, wp } from "../utils/responsive";
import { MapView, Marker, PROVIDER_GOOGLE } from "../../lib/WebSafeMap";
import { apiRequest, getRuntimeApiKey, isVerificationRequiredApiError, sanitizeToken } from "../Api";

/* ---------------- TYPES ---------------- */

type BookingEvent = {
  bookingId?: string;
  id?: string | number;
  job_id?: string | number;
  status?: string;
  hours?: string;
  start?: string;
  start_time?: string;
  end?: string;
  end_time?: string;
  date?: string;
  start_date?: string;
  pay?: string | number;
  parent?: string;
  sitter?: string;
  child?: string;
  kidAge?: number | string;
  location?: string;
  job?: any;
  raw?: any;
};

type Props = {
  route?: {
    params?: { event?: BookingEvent; date?: string; viewer?: "parent" | "nanny" };
  };
  navigation?: any;
  onBack?: () => void;
  onMessage?: (params: {
    conversationId?: number | string;
    userId?: number | string;
    nannyId?: number | string;
    name?: string;
  }) => void;
  onCancel?: (params: { bookingId?: string; jobId?: string | number }) => void;
  onOpenParentProfile?: (parent: any) => void;
  onRequireVerification?: () => void;
};

const pickFirstValue = (...values: any[]) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && text !== "undefined" && text !== "null") {
      return text;
    }
  }
  return "";
};

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

const resolveEventJobPayload = (event?: BookingEvent | null) => {
  const directJob = event?.job && typeof event.job === "object" ? event.job : null;
  const raw = event?.raw && typeof event.raw === "object" ? event.raw : null;
  const rawJob = raw?.job && typeof raw.job === "object" ? raw.job : null;
  const rawDataJob =
    raw?.data?.job && typeof raw.data.job === "object" ? raw.data.job : null;
  return directJob || rawJob || rawDataJob || raw || {};
};

/* ---------------- SCREEN ---------------- */

export default function NannyBookingDetailScreen({
  route,
  navigation,
  onBack,
  onMessage,
  onCancel,
  onOpenParentProfile,
  onRequireVerification,
}: Props) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isVerySmall = width <= 320;
  const isSmall = width <= 360;
  const isTablet = width >= 768;
  const contentMaxWidth = isTablet ? 960 : 720;
  const summaryCols = isVerySmall ? 1 : isSmall ? 2 : 3;
  const summaryBasis = summaryCols === 3 ? "31%" : summaryCols === 2 ? "48%" : "100%";
  const mapHeight = isLandscape ? (isTablet ? rs(260) : rs(150)) : isTablet ? rs(280) : rs(200);
  const stackNarrow = width <= 360;
  const heroPaddingTop = isLandscape ? rs(14) : rs(22);
  const heroPaddingBottom = isLandscape ? rs(12) : isTablet ? rs(26) : rs(20);

  const event: BookingEvent = route?.params?.event ?? {};
  const date: string = route?.params?.date ?? "";
  const viewer = route?.params?.viewer || "nanny";
  const isParentView = viewer === "parent";
  const initialStatus = (event.status || "Accepted").toString();
  const [currentStatus, setCurrentStatus] = useState(
    initialStatus
  );
  const [decisionLoading, setDecisionLoading] = useState<"accept" | "reject" | null>(null);
  const [selectedKid, setSelectedKid] = useState<{
    name?: string;
    age?: number | string;
    gender?: string;
    allergies?: string | null;
    medical_conditions?: string | null;
    notes?: string | null;
  } | null>(null);

  const rawJob = resolveEventJobPayload(event);
  const kids = useMemo(() => extractKids(rawJob), [rawJob]);
  const fallbackKids = useMemo(() => {
    const name =
      (typeof event.child === "string" && event.child !== "Child" && event.child.trim()) ||
      rawJob?.kid?.name ||
      rawJob?.child?.name;
    const age =
      event.kidAge ??
      rawJob?.kid?.age ??
      rawJob?.child?.age;
    const gender = rawJob?.kid?.gender || rawJob?.child?.gender;
    const allergies = rawJob?.kid?.allergies ?? rawJob?.child?.allergies;
    const medicalConditions =
      rawJob?.kid?.medical_conditions ??
      rawJob?.kid?.medical_condition ??
      rawJob?.child?.medical_conditions ??
      rawJob?.child?.medical_condition;
    const notes = rawJob?.kid?.notes ?? rawJob?.child?.notes;
    if (!name && age === undefined && !gender && !allergies && !medicalConditions && !notes) return [];
    return [
      {
        name,
        age,
        gender,
        allergies,
        medical_conditions: medicalConditions ?? null,
        notes,
      },
    ];
  }, [event.child, event.kidAge, rawJob]);
  const displayKids = kids.length ? kids : fallbackKids;
  const kidCount = displayKids.length || 1;

  const duration =
    pickFirstValue(
      event.hours,
      rawJob?.hours,
      rawJob?.duration,
      event.raw?.hours,
      event.raw?.data?.hours
    );
  const status = currentStatus;
  const formatTime12 = (value?: string) => {
    if (!value) return "";
    const raw = String(value).trim();
    if (!raw || raw === "--") return "";
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

  const start =
    formatTime12(
      pickFirstValue(
        event.start,
        event.start_time,
        rawJob?.start_time,
        rawJob?.time,
        event.raw?.start_time,
        event.raw?.time,
        event.raw?.data?.start_time,
        event.raw?.data?.time
      )
    ) || "--";
  const end =
    formatTime12(
      pickFirstValue(
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
      )
    ) || "";

  const totalFromJob =
    rawJob?.price ||
    rawJob?.total_price ||
    rawJob?.total;
  const ratePerHour =
    typeof event.pay === "number"
      ? event.pay
      : parseFloat(String(event.pay)) ||
        parseFloat(String(rawJob?.hourly_rate || rawJob?.rate || rawJob?.pay_rate)) ||
        0;

  const pay =
    event.pay !== undefined
      ? formatCurrencyValue(event.pay, { suffix: "/hr" })
      : ratePerHour > 0
      ? formatCurrencyValue(ratePerHour, { suffix: "/hr" })
      : "";

  const totalText = useMemo(() => {
    if (totalFromJob !== undefined && totalFromJob !== null) {
      const parsed = parseFloat(String(totalFromJob));
      if (Number.isFinite(parsed)) return `$${parsed.toFixed(2)}`;
    }
    const hrsNum = parseFloat(String(duration || ""));
    if (!Number.isFinite(hrsNum) || ratePerHour <= 0) return "";
    return `$${(hrsNum * ratePerHour).toFixed(2)}`;
  }, [duration, ratePerHour, totalFromJob]);

  const contactName = isParentView
    ? event.sitter || event.parent || "Syttr"
    : event.parent || event.sitter || "Client";
  const contactLabel = isParentView ? "Syttr Details" : "Client Details";
  const contactInitials = (contactName || "SX").slice(0, 2).toUpperCase();
  const contactSub = isParentView
    ? `This Syttr is scheduled to care for ${kidCount} child(ren).`
    : `You are scheduled to care for ${kidCount} child(ren) at their home.`;
  const totalLabel = isParentView ? "TOTAL COST" : "TOTAL EARNINGS";

  const coords = extractCoordinates(rawJob, event.location);
  const region = coords
    ? {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      }
    : undefined;
  const dateLabel =
    pickFirstValue(
      date,
      event.start_date,
      event.date,
      rawJob?.start_date,
      rawJob?.date,
      event.raw?.start_date,
      event.raw?.date,
      event.raw?.data?.start_date,
      event.raw?.data?.date
    ) ||
    "Date TBD";
  const timeLabel =
    start === "--" && !end ? "Time TBD" : `${start}${end ? ` - ${end}` : ""}`;
  const hoursLabel = duration || "Hours TBD";
  const normalizedStatus = String(currentStatus || "")
    .trim()
    .toLowerCase();
  const isPendingHireRequest =
    !isParentView &&
    ["hire_requested", "hire-requested", "pending"].includes(normalizedStatus);
  const applicationId = pickFirstValue(
    (event as any)?.application_id,
    event.raw?.application_id,
    event.raw?.application?.id,
    event.raw?.application?.application_id,
    event.raw?.data?.application_id,
    event.raw?.data?.application?.id,
    event.raw?.data?.application?.application_id,
    rawJob?.application_id,
    rawJob?.application?.id,
    rawJob?.application?.application_id
  );
  const parentUserId = pickFirstValue(
    rawJob?.user_id,
    rawJob?.parent_user_id,
    rawJob?.parent_user?.user_id,
    rawJob?.parent_user?.id,
    rawJob?.parent?.user_id,
    rawJob?.parent?.id,
    event.raw?.user_id,
    event.raw?.parent_user_id,
    event.raw?.parent?.user_id,
    event.raw?.parent?.id
  );
  const handleOpenParentProfile = () => {
    if (isParentView || !onOpenParentProfile) return;
    onOpenParentProfile({
      ...(rawJob?.parent || {}),
      ...(rawJob?.parent_user || {}),
      ...(event.raw?.parent || {}),
      user_id: parentUserId || undefined,
      parent_name: contactName,
      city_area: pickFirstValue(
        rawJob?.parent?.city_area,
        rawJob?.parent?.city,
        rawJob?.parent_user?.city_area,
        rawJob?.parent_user?.city
      ),
      country: pickFirstValue(
        rawJob?.parent?.country,
        rawJob?.parent_user?.country
      ),
      average_rating: rawJob?.parent_average_rating,
      jobs_posted_count: rawJob?.parent_jobs_posted_count,
      ratings_count: rawJob?.parent_ratings_count,
      user_image_url: pickFirstValue(
        rawJob?.parent_image_url,
        rawJob?.parent_profile_image,
        rawJob?.parent_image,
        rawJob?.parent?.profile_image,
        rawJob?.parent?.user_image_url,
        rawJob?.parent?.user_image,
        rawJob?.parent_user?.profile_image,
        rawJob?.parent_user?.user_image
      ),
      created_at: rawJob?.created_at || event.raw?.created_at,
      kids: displayKids,
    });
  };

  const handleMessage = async () => {
    const [storedUserId, storedNannyId] = await Promise.all([
      AppStorage.getItem("user_id"),
      AppStorage.getItem("nanny_id"),
    ]);

    const conversationId = pickFirstValue(
      event.raw?.conversation_id,
      event.raw?.conversationId,
      rawJob?.conversation_id,
      rawJob?.conversationId,
      rawJob?.chat_id,
      event.raw?.chat_id
    );
    const parentId = pickFirstValue(
      rawJob?.user_id,
      rawJob?.parent_user_id,
      rawJob?.parent_user?.user_id,
      rawJob?.parent_user?.id,
      rawJob?.parent?.user_id,
      rawJob?.parent?.id,
      rawJob?.client?.user_id,
      rawJob?.client?.id,
      event.raw?.user_id,
      event.raw?.parent_user_id,
      event.raw?.parent?.user_id,
      event.raw?.parent?.id
    );
    const resolvedNannyId = pickFirstValue(
      rawJob?.nanny_id,
      rawJob?.sitter_id,
      rawJob?.nanny?.user_id,
      rawJob?.nanny?.id,
      event.raw?.nanny_id,
      event.raw?.sitter_id,
      event.raw?.nanny?.user_id,
      event.raw?.nanny?.id,
      storedNannyId
    );
    const resolvedParentId = isParentView
      ? pickFirstValue(parentId, storedUserId)
      : parentId;

    if (!isParentView && !resolvedParentId) {
      Alert.alert("Message", "Client details not available yet.");
      return;
    }
    if (isParentView && !resolvedNannyId) {
      Alert.alert("Message", "Syttr details not available yet.");
      return;
    }

    const params = {
      conversationId: conversationId || undefined,
      nannyId: resolvedNannyId || undefined,
      userId: resolvedParentId || undefined,
      name: contactName,
    };

    if (onMessage) {
      onMessage(params);
      return;
    }

    if (isParentView) {
      navigation?.navigate?.("ClientChat", params);
    } else {
      navigation?.navigate?.("NannyChat", params);
    }
  };

  const handleExit = () => {
    if (onBack) {
      onBack();
      return;
    }
    navigation?.navigate?.("NannyHome");
  };

  const submitHireRequestDecision = async (decision: "accept" | "reject") => {
    if (!applicationId) {
      Alert.alert("Hire Request", "Application ID missing.");
      return;
    }
    if (decisionLoading) {
      return;
    }

    try {
      setDecisionLoading(decision);
      const [tokenRaw, apiKeyStored, nannyId, userId] = await Promise.all([
        AppStorage.getItem("token"),
        AppStorage.getItem("api_key"),
        AppStorage.getItem("nanny_id"),
        AppStorage.getItem("user_id"),
      ]);

      const token = sanitizeToken(tokenRaw || undefined);
      const apiKey = String(apiKeyStored || getRuntimeApiKey() || "").trim();
      const payload: Record<string, string> = {};
      if (userId) payload.user_id = userId;
      if (nannyId) payload.nanny_id = nannyId;

      const json = await apiRequest<any>(
        `nanny/hire-requests/${encodeURIComponent(applicationId)}/${decision}`,
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

      const nextStatus = decision === "accept" ? "accepted" : "rejected";
      setCurrentStatus(nextStatus);
      Alert.alert(
        "Hire Request",
        decision === "accept" ? "Hire request accepted." : "Hire request rejected."
      );
    } catch (e: any) {
      if (isVerificationRequiredApiError(e)) {
        onRequireVerification?.();
        return;
      }
      Alert.alert("Hire Request", e?.message || "Unable to update hire request.");
    } finally {
      setDecisionLoading(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.bgGlowTop, { pointerEvents: "none" as any }]} />
      <View style={[styles.bgGlowBottom, { pointerEvents: "none" as any }]} />
      {/* HERO */}
      <LinearGradient
        colors={["#FF80AB", "#FFD59E"]}
        style={[
          styles.hero,
          {
            paddingTop: heroPaddingTop,
            paddingBottom: heroPaddingBottom,
            marginHorizontal: isVerySmall ? rs(10) : isTablet ? rs(22) : rs(16),
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
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </TouchableOpacity>

          <Text style={styles.heroTitle} numberOfLines={1}>Booking Details</Text>
          <View style={{ width: rs(32) }} />
        </View>

        <View style={[styles.heroRow, stackNarrow && styles.heroRowStack]}>
          <View>
            <Text style={styles.heroLabel}>Booking ID</Text>
            <Text style={styles.heroValue}>
              {event.bookingId || "#NB-7"}
            </Text>
          </View>

          <View
            style={[
              styles.statusPill,
              stackNarrow && styles.statusPillStack,
              {
                borderColor: statusColor(status),
                backgroundColor: statusBg(status),
              },
            ]}
          >
            <Ionicons
              name="ellipse"
              size={9}
              color={statusColor(status)}
            />
            <Text
              style={[
                styles.statusText,
                { color: statusColor(status) },
              ]}
            >
              {status}
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* CONTENT */}
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: isLandscape ? rs(10) : rs(14) }]}>
        <View style={[styles.contentInner, { maxWidth: contentMaxWidth }]}>
        <View style={[styles.summaryCard, isLandscape && styles.summaryCardLandscape]}>
          <View style={[styles.summaryItemWrap, { flexBasis: summaryBasis }]}>
            <SummaryItem icon="calendar-outline" label="Date" value={dateLabel} />
          </View>
          <View style={[styles.summaryItemWrap, { flexBasis: summaryBasis }]}>
            <SummaryItem icon="time-outline" label="Time" value={timeLabel} />
          </View>
          <View style={[styles.summaryItemWrap, { flexBasis: summaryBasis }]}>
            <SummaryItem icon="hourglass-outline" label="Hours" value={hoursLabel} />
          </View>
        </View>

        <InfoCard
          icon="calendar"
          title="Booking Details"
          content={
            <View style={{ gap: rs(8) }}>
              <BulletRow text={event.location || "Location not set"} />
              <BulletRow text={dateLabel} />
              <BulletRow text={timeLabel} />
            </View>
          }
        />

        <InfoCard
          icon="location"
          title="Location"
          content={
            <View style={{ gap: rs(10) }}>
              <Text style={styles.locationText}>
                {event.location || rawJob.location || "Location not set"}
              </Text>
              {region ? (
                <View style={styles.mapWrap}>
              <MapView style={[styles.map, { height: mapHeight }]} region={region} provider={PROVIDER_GOOGLE}>
                    <Marker
                      coordinate={{
                        latitude: region.latitude,
                        longitude: region.longitude,
                      }}
                      title={contactName}
                      description={event.location || rawJob.location}
                    />
                  </MapView>
                </View>
              ) : (
                <View style={styles.mapFallback}>
                  <Text style={styles.mapFallbackText}>Map unavailable</Text>
                </View>
              )}
            </View>
          }
        />

        {displayKids.length ? (
          <InfoCard
            icon="happy"
            title="Children to Care For"
            content={
              <View style={{ gap: rs(10) }}>
                {displayKids.map((kid, idx) => {
                  const meta = formatKidMeta(kid);
                  return (
                    <TouchableOpacity
                      key={`${kid.name || "child"}-${idx}`}
                      style={styles.childCard}
                      activeOpacity={0.85}
                      onPress={() => setSelectedKid(kid)}
                    >
                      <View style={styles.childAvatar}>
                        <Ionicons name="person" size={18} color="#C2185B" />
                      </View>
                      <View style={styles.childTextBlock}>
                        {kid.name ? (
                          <Text style={styles.childName}>{kid.name}</Text>
                        ) : null}
                        {meta ? (
                          <Text style={styles.childMeta}>{meta}</Text>
                        ) : null}
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color="#C2185B"
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            }
          />
        ) : null}

        <InfoCard
          icon="person"
          title={contactLabel}
          content={
            <TouchableOpacity
              style={styles.clientCard}
              activeOpacity={!isParentView && onOpenParentProfile ? 0.88 : 1}
              onPress={handleOpenParentProfile}
              disabled={isParentView || !onOpenParentProfile}
            >
              <View style={styles.clientAvatar}>
                <Text style={styles.clientAvatarText}>{contactInitials}</Text>
              </View>

              <View style={{ flex: 1, marginLeft: rs(10) }}>
                <Text style={styles.clientName}>{contactName}</Text>
                <Text style={styles.clientSub}>{contactSub}</Text>
              </View>
              {!isParentView && onOpenParentProfile ? (
                <Ionicons name="chevron-forward" size={16} color="#C2185B" />
              ) : null}
            </TouchableOpacity>
          }
        />

        <InfoCard
          icon="cash"
          title="Payment Details"
          content={
            <View style={{ gap: rs(10) }}>
              <View style={[styles.serviceRow, stackNarrow && styles.moneyRowStack]}>
                <View>
                  <Text style={styles.serviceTitle}>Childcare</Text>
                  {/* <Text style={styles.serviceMeta}>Rate: {pay}</Text> */}
                </View>
                <Text style={styles.serviceAmount}>{totalText}</Text>
              </View>

              <View style={styles.divider} />

              <View style={[styles.totalRow, stackNarrow && styles.moneyRowStack]}>
                <View>
                  <Text style={styles.totalLabel}>{totalLabel}</Text>
                  {/* <Text style={styles.totalMeta}>Rate: {pay}</Text> */}
                </View>
                <Text style={styles.totalValue}>{totalText}</Text>
              </View>
            </View>
          }
        />

        {/* ACTIONS */}
        {isPendingHireRequest ? (
          <View style={[styles.actionRow, stackNarrow && styles.actionRowStack]}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.primaryBtn, decisionLoading && styles.actionBtnDisabled]}
              onPress={() => void submitHireRequestDecision("accept")}
              disabled={decisionLoading !== null}
            >
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
              <Text style={styles.actionTextPrimary}>
                {decisionLoading === "accept" ? "Accepting..." : "Accept"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.cancelBtn, decisionLoading && styles.actionBtnDisabled]}
              onPress={() => void submitHireRequestDecision("reject")}
              disabled={decisionLoading !== null}
            >
              <Ionicons name="close-circle" size={16} color="#C2185B" />
              <Text style={styles.actionTextCancel}>
                {decisionLoading === "reject" ? "Rejecting..." : "Reject"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={[styles.actionRow, stackNarrow && styles.actionRowStack]}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.primaryBtn]}
                onPress={handleMessage}
              >
                <Ionicons
                  name="chatbubble-ellipses"
                  size={16}
                  color="#fff"
                />
                <Text style={styles.actionTextPrimary}>
                  {isParentView ? "Message Syttr" : "Message Client"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.cancelBtn]}
                onPress={handleExit}
              >
                <Ionicons
                  name="exit-outline"
                  size={16}
                  color="#C2185B"
                />
                <Text style={styles.actionTextCancel}>Exit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.banner}>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color="#C2185B"
                />
              <Text style={styles.bannerText}>
                {isParentView
                  ? "Your booking is confirmed."
                  : "You have accepted this booking. Please arrive 15 minutes early."}
              </Text>
            </View>
          </>
        )}
        </View>
      </ScrollView>

      <Modal
        visible={!!selectedKid}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedKid(null)}
      >
        <View style={styles.kidOverlay}>
          <TouchableOpacity
            style={styles.kidBackdrop}
            activeOpacity={1}
            onPress={() => setSelectedKid(null)}
          />
          <View style={styles.kidModalCard}>
            <View style={styles.kidModalHeader}>
              <Text style={styles.kidModalTitle}>Child Profile</Text>
              <TouchableOpacity
                style={styles.kidCloseBtn}
                onPress={() => setSelectedKid(null)}
              >
                  <Ionicons name="close" size={16} color="#C2185B" />
              </TouchableOpacity>
            </View>

            {selectedKid ? (
              <View>
                {[
                  { label: "Name", value: selectedKid.name },
                  { label: "Age", value: selectedKid.age },
                  { label: "Gender", value: selectedKid.gender },
                  { label: "Allergies", value: selectedKid.allergies },
                  {
                    label: "Medical condition",
                    value: selectedKid.medical_conditions,
                  },
                  { label: "Notes", value: selectedKid.notes },
                ]
                  .filter((row) => row.value !== undefined && row.value !== null && String(row.value).trim())
                  .map((row, index, arr) => (
                    <View
                      key={row.label}
                      style={[
                        styles.kidDetailRow,
                        index === arr.length - 1 && styles.kidDetailRowLast,
                      ]}
                    >
                      <Text style={styles.kidDetailLabel}>{row.label}</Text>
                      <Text style={styles.kidDetailValue}>{String(row.value)}</Text>
                    </View>
                  ))}
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ---------------- HELPERS ---------------- */

function statusColor(status: string) {
  const s = status.toLowerCase();
  if (s === "accepted" || s === "accept" || s === "approved") return "#FF80AB";
  if (s === "declined" || s === "cancelled") return "#FFC67A";
  if (s === "completed") return "#FFB6D5";
  return "#FFD59E";
}

function statusBg(status: string) {
  return `${statusColor(status)}22`;
}

function extractKids(job: any) {
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
    const medicalConditions =
      child.medical_conditions ?? child.medical_condition ?? null;
    kids.push({
      name: child.name,
      age: child.age,
      gender: child.gender,
      allergies: child.allergies,
      medical_conditions: medicalConditions,
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
      kid.name ||
      kid.gender ||
      (kid.age !== undefined && kid.age !== null) ||
      kid.allergies ||
      kid.medical_conditions ||
      kid.notes
  );
}

function formatKidMeta(kid: { age?: number | string; gender?: string }) {
  const parts: string[] = [];
  if (kid.age !== undefined && kid.age !== null) parts.push(`Age: ${kid.age}`);
  if (kid.gender) parts.push(kid.gender);
  return parts.length ? parts.join(" | ") : "";
}

function extractCoordinates(job: any, fallbackLocation?: string) {
  const latRaw =
    job?.latitude ??
    job?.lat ??
    job?.location_lat ??
    job?.location?.lat ??
    job?.location?.latitude;
  const lonRaw =
    job?.longitude ??
    job?.lng ??
    job?.lon ??
    job?.location_lng ??
    job?.location?.lng ??
    job?.location?.longitude;

  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { latitude: lat, longitude: lon };
  }

  const loc = typeof job?.location === "string" ? job.location : fallbackLocation;
  if (typeof loc === "string" && loc.includes(",")) {
    const [latText, lonText] = loc.split(",").map((part) => part.trim());
    const latParsed = Number(latText);
    const lonParsed = Number(lonText);
    if (Number.isFinite(latParsed) && Number.isFinite(lonParsed)) {
      return { latitude: latParsed, longitude: lonParsed };
    }
  }

  return null;
}

function InfoCard({
  icon,
  title,
  content,
}: {
  icon: any;
  title: string;
  content: React.ReactNode;
}) {
  return (
    <View style={styles.infoCard}>
      <View style={styles.cardAccent} />
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <Ionicons name={icon} size={16} color="#fff" />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {content}
    </View>
  );
}

function BulletRow({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <Ionicons name="ellipse" size={9} color="#FF80AB" />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function SummaryItem({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.summaryItem}>
      <View style={styles.summaryIcon}>
        <Ionicons name={icon} size={16} color="#C2185B" />
      </View>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFF9F0", overflow: "hidden" },
  bgGlowTop: {
    position: "absolute",
    top: rs(-140),
    left: rs(-80),
    width: rs(240),
    height: rs(240),
    borderRadius: rs(120),
    backgroundColor: "#FFE4EC",
    opacity: 0.7,
  },
  bgGlowBottom: {
    position: "absolute",
    bottom: rs(-140),
    right: rs(-80),
    width: rs(240),
    height: rs(240),
    borderRadius: rs(120),
    backgroundColor: "#FFF0C7",
    opacity: 0.7,
  },
  hero: {
    marginHorizontal: rs(16),
    marginTop: rs(0),
    borderRadius: rs(28),
    paddingTop: rs(18),
    paddingHorizontal: rs(18),
    paddingBottom: rs(20),
    overflow: "hidden",
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  backBtn: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    backgroundColor: "rgba(255,255,255,0.25)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    color: "#fff",
    fontSize: rf(20),
    fontWeight: "700",
    fontFamily: "PlayfairDisplay",
  },
  heroRow: {
    marginTop: rs(16),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroRowStack: {
    flexWrap: "wrap",
    rowGap: rs(8),
  },
  heroLabel: { color: "#fff", opacity: 0.85, fontSize: rf(11) },
  heroValue: { color: "#fff", fontSize: rf(16), fontWeight: "700" },

  statusPill: {
    paddingHorizontal: rs(12),
    paddingVertical: rs(6),
    borderRadius: rs(18),
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
  },
  statusPillStack: {
    maxWidth: "100%",
  },
  statusText: { fontWeight: "700", fontSize: rf(12) },

  content: {
    paddingHorizontal: rs(16),
    paddingBottom: rs(28),
    paddingTop: rs(10),
    width: "100%",
    alignItems: "center",
  },
  contentInner: {
    width: "100%",
  },

  infoCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: rs(20),
    padding: rs(16),
    marginTop: rs(14),
    width: "100%",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    shadowColor: "#C2185B",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: rs(0), height: rs(4) },
    elevation: 3,
    position: "relative",
  },
  cardAccent: {
    position: "absolute",
    left: rs(0),
    top: rs(16),
    bottom: rs(16),
    width: rs(4),
    borderRadius: rs(4),
    backgroundColor: "#FF80AB",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: rs(10) },
  cardIcon: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(10),
  },
  cardTitle: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(16),
    fontFamily: "PlayfairDisplay",
  },

  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: rs(20),
    padding: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: rs(12),
    width: "100%",
    shadowColor: "#C2185B",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: rs(0), height: rs(4) },
    elevation: 3,
  },
  summaryCardLandscape: {
    marginTop: rs(12),
  },
  summaryItemWrap: {
    marginBottom: rs(8),
  },
  summaryItem: {
    alignItems: "flex-start",
    backgroundColor: "#FFF4F8",
    borderRadius: rs(14),
    paddingVertical: rs(12),
    paddingHorizontal: rs(10),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  summaryIcon: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: rs(6),
  },
  summaryLabel: {
    fontSize: rf(10),
    color: "#C77A00",
    fontWeight: "700",
    letterSpacing: rs(0.6),
    textTransform: "uppercase",
  },
  summaryValue: {
    fontSize: rf(14),
    color: "#C2185B",
    fontWeight: "700",
    marginTop: rs(4),
  },

  bulletRow: { flexDirection: "row", alignItems: "center", gap: rs(8) },
  bulletText: { color: "#C2185B", fontSize: rf(13), fontWeight: "600" },

  childCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF4F8",
    padding: rs(12),
    borderRadius: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  childTextBlock: { marginLeft: rs(10), flex: 1 },
  childAvatar: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(21),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  childName: { color: "#C2185B", fontWeight: "700", fontSize: rf(14) },
  childMeta: { color: "#C77A00", fontSize: rf(12) },

  locationText: {
    color: "#C2185B",
    fontSize: rf(13),
    fontWeight: "600",
  },
  mapWrap: {
    borderRadius: rs(18),
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  map: {
    width: "100%",
    height: rs(200),
  },
  mapFallback: {
    borderRadius: rs(18),
    paddingVertical: rs(18),
    alignItems: "center",
    backgroundColor: "#FFF4F8",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  mapFallbackText: {
    color: "#C77A00",
    fontWeight: "700",
    fontSize: rf(12),
  },

  clientCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF4F8",
    padding: rs(12),
    borderRadius: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  clientAvatar: {
    width: rs(46),
    height: rs(46),
    borderRadius: rs(23),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  clientAvatarText: { color: "#C2185B", fontWeight: "700" },
  clientName: {
    color: "#C2185B",
    fontSize: rf(15),
    fontWeight: "700",
    fontFamily: "PlayfairDisplay",
  },
  clientSub: { color: "#C77A00", fontSize: rf(12), marginTop: rs(4) },

  serviceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: rs(12),
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    backgroundColor: "#FFF4F8",
  },
  serviceTitle: { color: "#C2185B", fontSize: rf(13), fontWeight: "700" },
  serviceMeta: { color: "#C77A00", fontSize: rf(11) },
  serviceAmount: { color: "#C2185B", fontWeight: "700", fontSize: rf(13) },

  divider: { height: rs(1), backgroundColor: "rgba(255,128,171,0.2)", marginTop: rs(8) },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: rs(14),
    borderRadius: rs(16),
    backgroundColor: "#FF80AB",
  },
  totalLabel: { color: "#FFFFFF", fontWeight: "700", fontSize: rf(13) },
  totalMeta: { color: "#FFE9C7", fontSize: rf(11) },
  totalValue: { color: "#FFFFFF", fontWeight: "700", fontSize: rf(16) },

  actionRow: { flexDirection: "row", marginTop: rs(14), gap: rs(10) },
  actionRowStack: {
    flexDirection: "column",
    gap: rs(8),
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: rs(12),
    borderRadius: rs(16),
    gap: rs(8),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.25)",
    backgroundColor: "#FFFFFF",
  },
  primaryBtn: { backgroundColor: "#FF80AB", borderColor: "#FF80AB" },
  cancelBtn: { backgroundColor: "#FFF3D6", borderColor: "#FFC67A" },
  actionBtnDisabled: { opacity: 0.65 },
  actionTextPrimary: { color: "#fff", fontWeight: "700" },
  actionTextCancel: { color: "#C2185B", fontWeight: "700" },

  banner: {
    marginTop: rs(14),
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF1C1",
    borderRadius: rs(16),
    padding: rs(12),
    gap: rs(8),
  },
  bannerText: { color: "#8B5E00", fontSize: rf(12), fontWeight: "600", flex: 1, flexShrink: 1 },
  moneyRowStack: {
    flexDirection: "column",
    alignItems: "flex-start",
  },

  kidOverlay: {
    flex: 1,
    backgroundColor: "rgba(255,128,171,0.25)",
    justifyContent: "center",
    alignItems: "center",
    padding: rs(16),
  },
  kidBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  kidModalCard: {
    width: "100%",
    maxWidth: rs(420),
    backgroundColor: "#FFFFFF",
    borderRadius: rs(18),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  kidModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: rs(12),
  },
  kidModalTitle: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(16),
    fontFamily: "PlayfairDisplay",
  },
  kidCloseBtn: {
    width: rs(28),
    height: rs(28),
    borderRadius: rs(14),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  kidDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: rs(8),
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,128,171,0.2)",
  },
  kidDetailRowLast: {
    borderBottomWidth: 0,
    paddingBottom: rs(2),
  },
  kidDetailLabel: {
    color: "#C77A00",
    fontSize: rf(12),
    fontWeight: "700",
  },
  kidDetailValue: {
    color: "#C2185B",
    fontSize: rf(13),
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "right",
    marginLeft: rs(16),
  },
});
