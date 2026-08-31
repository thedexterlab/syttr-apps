import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest, getRuntimeApiKey, isVerificationRequiredApiError, sanitizeToken } from "../Api";
import NannyBottomNav, { NannyNavKey } from "../components/NannyBottomNav";
import SafeScreen from "../components/SafeScreen";
import { rf, rs } from "../utils/responsive";

const formatKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isTodayDate = (date: Date) => formatKey(date) === formatKey(new Date());

const normalizeDateKey = (raw: any) => {
  if (!raw) return null;
  if (typeof raw === "string") {
    const value = raw.trim();
    const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      const day = Number(match[3]);
      return formatKey(new Date(year, month, day));
    }
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatKey(parsed);
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

const formatHoursValue = (value: any) => {
  const hours = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(hours) || hours <= 0) return "Hours TBD";
  return String(hours);
};

type Props = {
  navigation?: any;
  onHome?: () => void;
  onJobs?: () => void;
  onMessages?: () => void;
  onNotifications?: () => void;
  onSettings?: () => void;
  onOpenBooking?: (event: any, date: string) => void;
  onRequireVerification?: () => void;
};
type CalendarEvent = {
  id: string;
  parent: string;
  child: string;
  hours: string;
  start: string;
  location: string;
  raw: any;
};
type EventsByDay = Record<string, CalendarEvent[]>;

export default function NannyCalendarScreen({
  navigation,
  onHome,
  onJobs,
  onMessages,
  onNotifications,
  onSettings,
  onOpenBooking,
  onRequireVerification,
}: Props) {
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [monthAnchor, setMonthAnchor] = useState(new Date());
  const [eventsByDay, setEventsByDay] = useState<EventsByDay>({});
  const [loading, setLoading] = useState(false);
  const [activeTab] = useState<NannyNavKey>("Calendar");

  const extractKidNames = useCallback((job: any) => {
    const names: string[] = [];
    const collect = (child: any) => {
      if (child?.name) names.push(child.name);
    };

    const kidsList =
      Array.isArray(job?.kids) ? job.kids : Array.isArray(job?.children) ? job.children : null;
    const kidArray = Array.isArray(job?.kid) ? job.kid : null;
    if (kidsList?.length) {
      kidsList.forEach((entry: any) => collect(entry?.kids || entry?.kid || entry));
    } else if (kidArray?.length) {
      kidArray.forEach((entry: any) => collect(entry?.kids || entry?.kid || entry));
    } else {
      collect(job?.kid);
      collect(job?.child);
      collect(job?.kids);
      collect(job?.children);
    }

    return names;
  }, []);

  const handleMonthChange = (delta: number) => {
    const next = addMonths(monthAnchor, delta);
    setMonthAnchor(next);
    setSelectedDate((prev) => {
      const day = Math.min(prev.getDate(), daysInMonth(next));
      return new Date(next.getFullYear(), next.getMonth(), day);
    });
  };

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await AppStorage.multiGet([
        "token",
        "nanny_token",
        "api_key",
        "nanny_id",
        "user_id",
        "canceled_job_ids",
      ]);
      const map = Object.fromEntries(entries);
      const tokenRaw = map.token || map.nanny_token || "";
      const token = sanitizeToken(tokenRaw || undefined);
      const apiKey =
        map.api_key ||
        getRuntimeApiKey() ||
        undefined;
      const nannyId = String(map.nanny_id || map.user_id || "").trim();

      if (!nannyId) {
        setEventsByDay({});
        return;
      }

      const bookingJson = await apiRequest<any>("calendar/bookings", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
          ...(nannyId ? { "nanny-id": nannyId, nanny_id: nannyId } : {}),
        },
        body: JSON.stringify({
          viewer: "nanny",
          nanny_id: nannyId,
          per_page: 200,
        }),
      });
      let rows: any[] = Array.isArray(bookingJson)
        ? bookingJson
        : Array.isArray((bookingJson as any)?.data)
        ? (bookingJson as any).data
        : [];

      // Backward-compatible fallback for older servers.
      if (!rows.length) {
        const queryParts = [];
        if (nannyId) queryParts.push(`nanny_id=${encodeURIComponent(nannyId)}`);
        if (apiKey) queryParts.push(`api_key=${encodeURIComponent(apiKey)}`);
        const query = queryParts.length ? `?${queryParts.join("&")}` : "";
        const notificationJson = await apiRequest<any>(`nanny/notifications${query}`, {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
            ...(nannyId ? { "nanny-id": nannyId, nanny_id: nannyId } : {}),
          },
        });
        rows = Array.isArray(notificationJson)
          ? notificationJson
          : Array.isArray((notificationJson as any)?.data)
          ? (notificationJson as any).data
          : [];
      }

      let canceledParsed: any[] = [];
      try {
        const value = map.canceled_job_ids ? JSON.parse(map.canceled_job_ids) : [];
        canceledParsed = Array.isArray(value) ? value : [];
      } catch {
        canceledParsed = [];
      }
      const canceledIds = new Set(canceledParsed.map((id: any) => String(id)));
      const grouped: EventsByDay = {};
      const seenJobs = new Set<string>();

      rows.forEach((item: any) => {
        const source = item?.data && typeof item?.data === "object" ? item.data : item;
        const nestedJob = source?.job && typeof source?.job === "object" ? source.job : null;
        const job =
          nestedJob ||
          (source && typeof source === "object" && (source?.id || source?.job_id) ? source : null);
        if (!job) return;

        const jobId = String(job?.id ?? job?.job_id ?? "").trim();
        const dedupeKey =
          jobId !== ""
            ? `job:${jobId}`
            : `${normalizeDateKey(job?.start_date || job?.date) || "unknown"}|${String(
                job?.start_time || job?.time || ""
              ).trim()}|${String(job?.location || "").trim().toLowerCase()}`;
        if (seenJobs.has(dedupeKey)) return;
        seenJobs.add(dedupeKey);

        if (jobId !== "" && canceledIds.has(jobId)) return;

        const statusRaw =
          source?.application?.status ||
          source?.status ||
          source?.request_status ||
          source?.application_status ||
          item?.application?.status ||
          item?.status ||
          item?.application_status ||
          job?.application_status ||
          job?.status ||
          "";
        const normalizedStatus = String(statusRaw).toLowerCase().trim();
        if (
          normalizedStatus &&
          !["accept", "accepted", "approved", "confirmed", "confirm"].includes(normalizedStatus)
        ) {
          return;
        }

        const key = normalizeDateKey(job?.start_date || job?.date) || formatKey(new Date());

        if (!grouped[key]) grouped[key] = [];
        const kidNames = extractKidNames(job);
        const parentName =
          source?.parent_name ||
          source?.parent?.name ||
          job?.parent_name ||
          job?.parent_user?.name ||
          job?.parent?.name ||
          "Family";
        grouped[key].push({
          id: String(job?.id ?? job?.job_id ?? key),
          parent: parentName,
          child: kidNames.join(", ") || "Child",
          hours: formatHoursValue(job?.hours),
          start: formatTimeValue(job?.start_time || job?.time || ""),
          location: job?.location || "Client home",
          raw: job,
        });
      });

      setEventsByDay(grouped);
    } catch (e) {
      if (isVerificationRequiredApiError(e)) {
        setEventsByDay({});
        onRequireVerification?.();
        return;
      }
      console.log("Calendar load error", e);
    } finally {
      setLoading(false);
    }
  }, [extractKidNames, onRequireVerification]);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

  useEffect(() => {
    const unsubscribe = navigation?.addListener?.("focus", () => {
      void loadAppointments();
    });
    return () => unsubscribe?.();
  }, [loadAppointments, navigation]);

  const monthDays = useMemo(() => buildMonthDays(monthAnchor), [monthAnchor]);
  const selectedKey = formatKey(selectedDate);
  const todaysEvents = eventsByDay[selectedKey] || [];

  return (
    <SafeScreen edges={["left", "right"]} style={{ backgroundColor: "#FFF8F0" }}>
      <LinearGradient colors={["#ffffff", "#FFF1E1"]} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={{
              paddingTop: 0,
              paddingBottom: rs(88) + Math.max(insets.bottom, 8),
            }}
          >
          {/* HEADER */}
          <View style={styles.headerCard}>
            <View style={styles.headerInner}>
              <View style={styles.headerSide} />
              <Text style={styles.headerTitle}>Calendar</Text>
              <TouchableOpacity style={styles.refreshBtn} onPress={loadAppointments} disabled={loading}>
                {loading ? (
                  <ActivityIndicator size="small" color="#C2185B" />
                ) : (
                  <Ionicons name="refresh" size={16} color="#C2185B" />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* CALENDAR */}
          <View style={styles.calendarCard}>
            <View style={styles.monthHeader}>
              <TouchableOpacity onPress={() => handleMonthChange(-1)}>
                <Ionicons name="chevron-back" size={22} color="#D81B60" />
              </TouchableOpacity>

              <Text style={styles.monthText}>
                {monthAnchor.toLocaleString("default", { month: "long" })} {monthAnchor.getFullYear()}
              </Text>

              <TouchableOpacity onPress={() => handleMonthChange(1)}>
                <Ionicons name="chevron-forward" size={22} color="#D81B60" />
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
              {monthDays.map((day, index) => {
                if (!day) return <View key={index} style={styles.emptyCell} />;

                const key = formatKey(day);
                const isSelected = key === selectedKey;
                const isToday = isTodayDate(day);
                const hasEvent = Array.isArray(eventsByDay[key]) && eventsByDay[key].length > 0;

                return (
                  <TouchableOpacity key={index} style={styles.dayCell} onPress={() => setSelectedDate(day)}>
                    <View
                      style={[
                        styles.dayBubble,
                        isToday && styles.todayDay,
                        hasEvent && styles.hasEvent,
                        isSelected && styles.selectedDay,
                      ]}
                    >
                      {hasEvent ? <View style={styles.eventDot} /> : null}
                      <Text
                        style={[
                          styles.dayText,
                          isToday && styles.todayDayText,
                          isSelected && { color: "#fff", fontWeight: "700" },
                        ]}
                      >
                        {day.getDate()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* APPOINTMENTS */}
          <View style={styles.appointmentCard}>
            <Text style={styles.sectionTitle}>Bookings</Text>

            {loading ? (
              <ActivityIndicator color="#FF80AB" />
            ) : todaysEvents.length === 0 ? (
              <Text style={styles.emptyText}>No Bookings for this date.</Text>
            ) : (
              todaysEvents.map((ev, idx) => (
                <TouchableOpacity
                  key={`nanny-booking-${String(ev.id ?? "unknown")}-${idx}`}
                  style={styles.eventCard}
                  activeOpacity={0.9}
                  onPress={() => onOpenBooking?.(ev, selectedKey)}
                >
                  <Text style={styles.eventTitle}>{ev.parent}</Text>
                  <Text style={styles.eventMeta}>
                    {ev.child} • {ev.hours}
                  </Text>
                  <Text style={styles.eventMeta}>{ev.start}</Text>
                  <Text style={styles.eventMeta}>{ev.location}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        </ScrollView>

        <NannyBottomNav
          active={activeTab}
          onHome={onHome}
          onJobs={onJobs}
          onMessages={onMessages}
          onNotifications={onNotifications}
          onSettings={onSettings}
          navigation={navigation}
        />
      </LinearGradient>
    </SafeScreen>
  );
}

/* ---------------- HELPERS ---------------- */

function buildMonthDays(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();

  const cells: any[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(anchor.getFullYear(), anchor.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

function addMonths(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function daysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  headerCard: {
    marginHorizontal: rs(16),
    marginBottom: rs(16),
    marginTop: rs(1),
    borderRadius: rs(18),
    backgroundColor: "rgba(255,255,255,0.9)",
    elevation: 2,
  },
  headerInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(14),
  },
  headerSide: { width: rs(36) },
  headerTitle: { flex: 1, textAlign: "center", fontSize: rf(20), fontWeight: "700", color: "#C77A00" },
  refreshBtn: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(8),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },

  calendarCard: {
    margin: rs(16),
    backgroundColor: "#FFF1D6",
    borderRadius: rs(18),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "rgba(194,24,91,0.12)",
  },
  monthHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  monthText: { fontSize: rf(18), fontWeight: "700", color: "#5B2E2E" },
  weekRow: { flexDirection: "row", justifyContent: "space-between", marginTop: rs(10) },
  weekLabel: { width: `${100 / 7}%`, textAlign: "center", color: "#4E2A36", fontWeight: "700" },

  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: rs(12) },
  emptyCell: { width: `${100 / 7}%`, height: rs(40) },
  dayCell: { width: `${100 / 7}%`, alignItems: "center" },
  dayBubble: { width: rs(38), height: rs(38), borderRadius: rs(19), justifyContent: "center", alignItems: "center" },
  dayText: { color: "#4E2A36", fontWeight: "600" },
  todayDay: { backgroundColor: "#FFEB3B", borderWidth: 1, borderColor: "#FBC02D" },
  todayDayText: { color: "#5D4037", fontWeight: "700" },
  hasEvent: { backgroundColor: "rgba(255,128,171,0.18)" },
  selectedDay: { backgroundColor: "#D81B60" },
  eventDot: {
    position: "absolute",
    top: rs(6),
    right: rs(6),
    width: rs(6),
    height: rs(6),
    borderRadius: rs(3),
    backgroundColor: "#D81B60",
  },

  appointmentCard: {
    margin: rs(16),
    backgroundColor: "#FFE7D0",
    borderRadius: rs(18),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "rgba(194,24,91,0.10)",
  },
  sectionTitle: { fontSize: rf(16), fontWeight: "700", color: "#880E4F" },
  emptyText: { marginTop: rs(10), color: "#6B4350" },
  eventCard: { marginTop: rs(10), backgroundColor: "#FFF5F8", padding: rs(12), borderRadius: rs(14) },
  eventTitle: { fontWeight: "700", color: "#880E4F" },
  eventMeta: { fontSize: rf(12), color: "#6B4350", marginTop: rs(4) },
});
