import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest } from "../Api";
import { fetchUnreadParentRequestCount } from "../../lib/parentRequestNotifications";
import { fetchUnreadConversationCount } from "../../lib/chatUnreadCount";
import { hp, rf, rs, wp } from "../utils/responsive";

type DayCell = Date | null;

type Props = {
  navigation?: any;
  onBack?: () => void;
  onHome?: () => void;
  onMessages?: () => void;
  onJobRequests?: () => void;
  onNotifications?: () => void;
  onSettings?: () => void;
  onOpenBooking?: (event: any, date: string) => void;
};

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
    // Preserve calendar day from ISO strings and avoid timezone drift.
    const isoPrefix = value.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (isoPrefix) {
      return `${isoPrefix[1]}-${isoPrefix[2]}-${isoPrefix[3]}`;
    }
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

const isNotificationRead = (item?: { isRead?: unknown; is_read?: unknown } | null) => {
  if (!item) return false;
  if (item.isRead === true) return true;

  const raw = item.is_read;
  if (raw === true || raw === 1 || raw === "1") return true;
  if (typeof raw === "string" && raw.toLowerCase() === "true") return true;
  return false;
};
const getStoredAuthData = async () => {
  const entries = await AsyncStorage.multiGet([
    "token",
    "api_key",
    "user_id",
    "nanny_id",
    "user_type",
  ]);
  return Object.fromEntries(entries);
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

const resolveDisplayStatus = (job: any) => {
  const raw =
    job?.application_status ||
    job?.status ||
    job?.job_status ||
    job?.booking_status ||
    job?.application?.status ||
    "";
  const low = String(raw).toLowerCase();
  const acceptedish = ["accept", "accepted", "approved", "confirmed", "confirm"].includes(low);
  if (acceptedish && !hasAcceptedApplication(job) && !hasAssignedSitter(job)) {
    return "Pending";
  }
  return raw || "Pending";
};

const resolveSitterName = (job: any) => {
  const getName = (obj: any) => {
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

  const primary =
    getName(job?.nanny) ||
    getName(job?.sitter) ||
    getName(job?.syttr) ||
    String(job?.nanny_name || "").trim();
  if (primary) return primary;

  const apps = [
    ...(Array.isArray(job?.applications) ? job.applications : []),
    ...(Array.isArray(job?.application) ? job.application : []),
  ];
  const accepted = apps.find((app: any) => {
    const status = String(app?.status || app?.application_status || app?.state || "").toLowerCase();
    return ["accept", "accepted", "approved", "confirmed", "confirm"].includes(status);
  });
  return (
    getName(accepted?.nanny || accepted?.sitter || accepted?.user) ||
    "No Syttr assigned yet"
  );
};

const toArray = <T,>(value: any): T[] => {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
};

const normalizeStatusToken = (value: any) => {
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return "pending";
  if (raw.includes("cancel")) return "canceled";
  if (raw.includes("reject") || raw.includes("declin")) return "rejected";
  if (raw.includes("complete") || raw.includes("done") || raw.includes("finished")) {
    return "completed";
  }
  if (raw.includes("accept") || raw.includes("approve") || raw.includes("confirm")) {
    return "accepted";
  }
  if (raw.includes("pending") || raw.includes("wait")) return "pending";
  return raw;
};

const getStatusPriority = (value: any) => {
  const token = normalizeStatusToken(value);
  if (token === "canceled") return 5;
  if (token === "completed") return 4;
  if (token === "accepted") return 3;
  if (token === "pending") return 2;
  if (token === "rejected") return 1;
  return 0;
};

const getJobDedupKey = (job: any, index: number) => {
  const idCandidates = [
    job?.id,
    job?.job_id,
    job?.booking_id,
    job?.application_id,
    job?.notification_id,
  ];
  for (const candidate of idCandidates) {
    const id = String(candidate ?? "").trim();
    if (id && id !== "undefined" && id !== "null") {
      return `job:${id}`;
    }
  }

  const createdAt = String(job?.created_at || "").trim();
  const updatedAt = String(job?.updated_at || "").trim();
  if (createdAt || updatedAt) {
    return `ts:${createdAt}|${updatedAt}|${index}`;
  }

  return `idx:${index}`;
};

const dedupeJobs = (jobs: any[]) => {
  const byKey = new Map<string, any>();

  jobs.forEach((job, index) => {
    const key = getJobDedupKey(job, index);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        ...job,
        applications: [...toArray(job?.applications), ...toArray(job?.application)],
      });
      return;
    }

    const existingStatus = resolveDisplayStatus(existing);
    const nextStatus = resolveDisplayStatus(job);
    const keepNextStatus = getStatusPriority(nextStatus) >= getStatusPriority(existingStatus);
    const nextHasSitter = hasAssignedSitter(job);

    byKey.set(key, {
      ...existing,
      ...job,
      status: keepNextStatus ? job?.status || nextStatus : existing?.status || existingStatus,
      application_status: keepNextStatus
        ? job?.application_status || nextStatus
        : existing?.application_status || existingStatus,
      nanny: nextHasSitter ? job?.nanny || existing?.nanny : existing?.nanny || job?.nanny,
      nanny_id: nextHasSitter
        ? job?.nanny_id || existing?.nanny_id
        : existing?.nanny_id || job?.nanny_id,
      application: keepNextStatus
        ? job?.application || existing?.application
        : existing?.application || job?.application,
      applications: [
        ...toArray(existing?.applications),
        ...toArray(existing?.application),
        ...toArray(job?.applications),
        ...toArray(job?.application),
      ],
      notification_id: existing?.notification_id || job?.notification_id,
    });
  });

  return Array.from(byKey.values());
};

export default function CalendarScreen({
  navigation,
  onBack,
  onHome,
  onMessages,
  onJobRequests,
  onNotifications,
  onSettings,
  onOpenBooking,
}: Props) {
  const insets = useSafeAreaInsets();
  const bottomBarOffset = -Math.max(insets.bottom, 0);
  const today = new Date();
  const [selected, setSelected] = useState<Date>(today);
  const [eventsByDay, setEventsByDay] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [requestCount, setRequestCount] = useState(0);

  const monthLabel = useMemo(
    () =>
      selected.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      }),
    [selected]
  );

  const daysGrid = useMemo(() => buildMonthGrid(selected), [selected]);
  const selectedKey = useMemo(() => formatKey(selected), [selected]);
  const todaysEvents = useMemo(() => {
    const list = Array.isArray(eventsByDay[selectedKey]) ? [...eventsByDay[selectedKey]] : [];
    return list.sort((a: any, b: any) => {
      const statusDiff = getStatusPriority(b?.status) - getStatusPriority(a?.status);
      if (statusDiff !== 0) return statusDiff;
      return String(a?.start || "").localeCompare(String(b?.start || ""));
    });
  }, [eventsByDay, selectedKey]);
  const monthKey = `${selected.getFullYear()}-${String(
    selected.getMonth() + 1
  ).padStart(2, "0")}`;
  const monthEvents = Object.entries(eventsByDay).filter(([key]) =>
    key.startsWith(monthKey)
  );
  const monthBookings = useMemo(() => {
    const entries = monthEvents.flatMap(([dateKey, list]) =>
      (Array.isArray(list) ? list : []).map((item: any) => ({
        ...item,
        dateKey,
      }))
    );

    return entries.sort((a: any, b: any) => {
      const dateDiff = String(a?.dateKey || "").localeCompare(String(b?.dateKey || ""));
      if (dateDiff !== 0) return dateDiff;
      const statusDiff = getStatusPriority(b?.status) - getStatusPriority(a?.status);
      if (statusDiff !== 0) return statusDiff;
      return String(a?.start || "").localeCompare(String(b?.start || ""));
    });
  }, [monthEvents]);
  const monthJobs = monthEvents.reduce(
    (sum, [, list]) => sum + (Array.isArray(list) ? list.length : 0),
    0
  );
  const monthHours = monthEvents.reduce((sum, [, list]) => {
    if (!Array.isArray(list)) return sum;
    return (
      sum +
      list.reduce((inner, ev) => inner + (Number(ev.hoursValue) || 0), 0)
    );
  }, 0);

  useEffect(() => {
    loadBookings();
    loadNotificationCount();
    loadMessageCount();
    loadRequestCount();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation?.addListener?.("focus", () => {
      loadBookings();
      loadNotificationCount();
      loadMessageCount();
      loadRequestCount();
    });
    return () => unsubscribe?.();
  }, [navigation]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        loadNotificationCount();
        loadMessageCount();
        loadRequestCount();
      }
    });
    return () => sub.remove();
  }, []);

  const loadBookings = async () => {
    setLoading(true);
    try {
      const storage = await getStoredAuthData();
      const tokenRaw = storage.token;
      const token = tokenRaw ? tokenRaw.replace(/"/g, "").trim() : "";
      const apiKey =
        storage.api_key ||
        (typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_API_KEY : undefined) ||
        undefined;
      const userId = storage.user_id;
      const nannyId = storage.nanny_id || userId;
      const userType = String(storage.user_type || "").toLowerCase().trim();
      const isNannyViewer = userType === "nanny" || userType === "syttr";

      if (!userId && !nannyId) {
        setEventsByDay({});
        return;
      }

      const payload: Record<string, any> = {
        viewer: isNannyViewer ? "nanny" : "parent",
        per_page: 200,
      };
      if (isNannyViewer) {
        payload.nanny_id = String(nannyId || "");
      } else {
        payload.user_id = String(userId || "");
      }

      const json = await apiRequest<any>("calendar/bookings", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify(payload),
      });
      const rows = Array.isArray(json)
        ? json
        : Array.isArray(json?.data)
        ? json.data
        : [];
      const raw = rows
        .map((row: any) => {
          const job = row?.job && typeof row?.job === "object" && row?.job?.id ? row.job : row;
          if (!job || typeof job !== "object") return null;
          return {
            ...job,
            status:
              (!isNannyViewer ? job?.parent_display_status : null) ||
              job?.status ||
              job?.job_status ||
              job?.application_status ||
              row?.status ||
              row?.application?.status,
            application_status:
              (!isNannyViewer ? job?.parent_display_status : null) ||
              job?.application_status ||
              row?.application?.status ||
              row?.status ||
              job?.status,
            application: row?.application || job?.application || null,
            application_id: row?.application_id || row?.application?.id,
            nanny: job?.nanny || row?.nanny || null,
            nanny_id: row?.nanny_id || job?.nanny_id || row?.application?.nanny_id,
            notification_id: row?.id || row?.notification_id,
          };
        })
        .filter(Boolean);
      const dedupedRaw = dedupeJobs(raw);

      const storedCanceled = await AsyncStorage.getItem("canceled_job_ids");
      let canceledParsed: any[] = [];
      try {
        const parsed = storedCanceled ? JSON.parse(storedCanceled) : [];
        canceledParsed = Array.isArray(parsed) ? parsed : [];
      } catch {
        canceledParsed = [];
      }
      const canceledIds = new Set(canceledParsed.map((id: any) => String(id)));

      const grouped: Record<string, any[]> = {};
      dedupedRaw.forEach((job: any) => {
        if (canceledIds.has(String(job.id))) return;
        const statusRaw = resolveDisplayStatus(job);
        const normalizedStatus = String(statusRaw).toLowerCase();
        const allowedStatuses = isNannyViewer
          ? [
              "accept",
              "accepted",
              "approved",
              "confirmed",
              "complete",
              "completed",
              "pending",
              "waiting",
              "cancelled",
              "canceled",
            ]
          : [
              "accept",
              "accepted",
              "approved",
              "confirmed",
              "complete",
              "completed",
              "pending",
              "waiting",
            ];
        if (
          normalizedStatus &&
          !allowedStatuses.includes(normalizedStatus)
        ) {
          return;
        }

        const key =
          normalizeDateKey(job.start_date || job.date) ||
          formatKey(new Date());
        if (!grouped[key]) grouped[key] = [];

        const kidNames = extractKidNames(job);
        const kidAge = extractKidAge(job);
        const sitterName = resolveSitterName(job);
        const parentName =
          job.parent_name ||
          job.parent_user?.name ||
          job.parent?.name ||
          job.client?.name ||
          "Parent";
        const payRaw =
          job.rate ||
          job.pay_rate ||
          job.hourly_rate ||
          job.hourlyRate ||
          job.pay ||
          job.price;

        grouped[key].push({
          id: String(job.id),
          bookingId: String(job.id),
          status: statusRaw || "Pending",
          parent: parentName,
          sitter: sitterName,
          child: kidNames.join(", ") || "Child",
          kidAge: kidAge ?? undefined,
          hours: formatHoursValue(job.hours),
          hoursLabel: formatHoursValue(job.hours),
          hoursValue: Number(job.hours) || 0,
          start: formatTimeValue(job.start_time || job.time || ""),
          end: job.end_time || job.end || job.finish_time || "",
          pay: payRaw,
          location: job.location || "Client home",
          raw: job,
        });
      });

      setEventsByDay(grouped);
    } catch (e: any) {
      console.log("Calendar load error", e);
      setEventsByDay({});
      if (e?.message) {
        Alert.alert("Calendar", e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadNotificationCount = async () => {
    try {
      const storage = await getStoredAuthData();
      const tokenRaw = storage.token;
      const token = tokenRaw ? tokenRaw.replace(/"/g, "").trim() : "";
      const apiKey =
        storage.api_key ||
        (typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_API_KEY : undefined) ||
        undefined;
      const userId = storage.user_id;

      if (!userId) {
        setNotificationCount(0);
        return;
      }

      const json = await apiRequest<any>(
        `notifications?user_id=${encodeURIComponent(userId)}`,
        {
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
        }
      );
      const data = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : [];
      const unread = data.filter((item: any) => !isNotificationRead(item));
      setNotificationCount(unread.length);
    } catch {
      setNotificationCount(0);
    }
  };

  const loadRequestCount = async () => {
    try {
      const count = await fetchUnreadParentRequestCount();
      setRequestCount(count);
    } catch {
      setRequestCount(0);
    }
  };

  const loadMessageCount = async () => {
    try {
      const count = await fetchUnreadConversationCount();
      setMessageCount(count);
    } catch {
      setMessageCount(0);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: rs(88) + Math.max(insets.bottom, 8) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.headerSlot} />
          <Text style={styles.headerTitle}>Calendar</Text>
          <View style={styles.headerSlot} />
        </View>

        {/* SUMMARY CARD */}
        <View style={styles.summaryCard}>
          <Text style={styles.summarySmall}>This Month</Text>
          <Text style={styles.summaryDate}>{monthLabel}</Text>

          <View style={styles.summaryRow}>
            <View style={styles.summaryBox}>
              <Ionicons name="briefcase-outline" size={18} color="#C2185B" />
              <Text style={styles.summaryLabel}>Jobs</Text>
              <Text style={styles.summaryValue}>{monthJobs}</Text>
            </View>

            <View style={styles.summaryBox}>
              <Ionicons name="time-outline" size={18} color="#C2185B" />
              <Text style={styles.summaryLabel}>Hours</Text>
              <Text style={styles.summaryValue}>
                {monthHours ? monthHours.toFixed(1) : "0"}
              </Text>
            </View>
          </View>
        </View>

        {/* CALENDAR */}
        <View style={styles.calendarCard}>
          <View style={styles.monthRow}>
            <TouchableOpacity
              onPress={() => setSelected(addMonths(selected, -1))}
            >
              <Ionicons name="chevron-back" size={18} color="#C2185B" />
            </TouchableOpacity>

            <Text style={styles.monthText}>{monthLabel}</Text>

            <TouchableOpacity
              onPress={() => setSelected(addMonths(selected, 1))}
            >
              <Ionicons name="chevron-forward" size={18} color="#C2185B" />
            </TouchableOpacity>
          </View>

          {/* WEEK DAYS */}
          <View style={styles.weekRow}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <Text key={d} style={styles.weekText}>
                {d}
              </Text>
            ))}
          </View>

          {/* DAYS GRID */}
          <View style={styles.grid}>
            {daysGrid.map((cell: DayCell, idx: number) => {
              const isSelected =
                cell &&
                cell.getDate() === selected.getDate() &&
                cell.getMonth() === selected.getMonth() &&
                cell.getFullYear() === selected.getFullYear();
              const isToday = !!cell && isTodayDate(cell);
              const dayKey = cell ? formatKey(cell) : "";
              const hasEvents = !!(dayKey && eventsByDay[dayKey]?.length);

              return (
                <TouchableOpacity
                  key={idx}
                  style={styles.cell}
                  disabled={!cell}
                  onPress={() => cell && setSelected(cell)}
                >
                  {cell ? (
                    <View
                      style={[
                        styles.dayCircle,
                        isToday && styles.dayToday,
                        hasEvents && styles.dayHasEvent,
                        isSelected && styles.daySelected,
                      ]}
                    >
                      {hasEvents && <View style={styles.dayDot} />}
                      <Text
                        style={[
                          styles.dayText,
                          isToday && styles.dayTextToday,
                          isSelected && styles.dayTextSelected,
                        ]}
                      >
                        {cell.getDate()}
                      </Text>
                    </View>
                  ) : (
                    <View style={{ width: rs(36), height: rs(36) }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* BOOKINGS */}
        <View style={styles.bookingCard}>
          <Text style={styles.bookingTitle}>Bookings</Text>

          {loading ? (
            <View style={styles.emptyBox}>
              <ActivityIndicator color="#FF80AB" />
            </View>
          ) : monthBookings.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="calendar-outline" size={40} color="#FF80AB" />
              <Text style={styles.emptyText}>No bookings scheduled</Text>
            </View>
          ) : (
            monthBookings.map((ev: any, idx: number) => (
              <TouchableOpacity
                key={`booking-${String(ev.bookingId || ev.id || ev.dateKey || idx)}`}
                style={styles.eventCard}
                activeOpacity={0.9}
                disabled={!onOpenBooking}
                onPress={() => onOpenBooking?.(ev, ev.dateKey || selectedKey)}
              >
                <Text style={styles.eventTitle}>{ev.sitter}</Text>
                <Text style={styles.eventMeta}>{ev.dateKey}</Text>
                <Text style={styles.eventMeta}>{ev.child} • {ev.hoursLabel}</Text>
                {String(ev.status || "").toLowerCase().includes("cancel") && (
                  <Text style={styles.eventMeta}>Status: Cancelled</Text>
                )}
                {String(ev.status || "").toLowerCase().includes("complete") && (
                  <Text style={styles.eventMeta}>Status: Completed</Text>
                )}
                <Text style={styles.eventMeta}>{ev.start}</Text>
                <Text style={styles.eventMeta}>{ev.location}</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>

      {/* BOTTOM NAV */}
      <View
        style={[
          styles.bottomBar,
          {
            bottom: bottomBarOffset,
            paddingBottom: Math.max(8, insets.bottom),
            height: rs(60) + Math.max(8, insets.bottom),
          },
        ]}
      >
        <Tab icon="home" label="Home" onPress={onHome} />
        <Tab icon="chatbubble" label="Chat" onPress={onMessages} badgeCount={messageCount} />
        <Tab icon="briefcase" label="Requests" onPress={onJobRequests} badgeCount={requestCount} />
        <Tab
          icon="notifications"
          label="Alerts"
          onPress={onNotifications}
          badgeCount={notificationCount}
        />
        <Tab icon="calendar" label="Calendar" active />
        <Tab icon="settings" label="Settings" onPress={onSettings} />
      </View>
    </View>
  );
}

function buildMonthGrid(anchor: Date): DayCell[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const start = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: DayCell[] = [];
  for (let i = 0; i < start; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function addMonths(date: Date, delta: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + delta);
  return d;
}

function extractKidNames(job: any) {
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

  return Array.from(new Set(names.map((name) => String(name).trim()).filter(Boolean)));
}

function extractKidAge(job: any) {
  const pickAge = (child: any) => child?.age;

  const kidArray = Array.isArray(job?.kid) ? job.kid : null;
  if (kidArray?.length) {
    const entry = kidArray[0]?.kids || kidArray[0]?.kid || kidArray[0];
    const age = pickAge(entry);
    if (age !== undefined && age !== null) return age;
  }

  const directAge =
    pickAge(job?.kid) ??
    pickAge(job?.child) ??
    pickAge(job?.kids);

  return directAge !== undefined && directAge !== null ? directAge : undefined;
}

const Tab = ({
  icon,
  label,
  active = false,
  badgeCount,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  badgeCount?: number;
  onPress?: () => void;
}) => {
  const showBadge = typeof badgeCount === "number" && badgeCount > 0;
  const highlight = showBadge && !active;
  return (
    <TouchableOpacity style={styles.tabItem} onPress={onPress}>
      <View style={styles.tabIconWrap}>
        <Ionicons
          name={icon}
          size={22}
          color={active || highlight ? "#FF80AB" : "#999"}
        />
        {showBadge ? (
          <View style={styles.tabBadge}>
            <Text style={styles.tabBadgeText}>
              {badgeCount! > 9 ? "9+" : badgeCount}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.tabLabel, (active || highlight) && styles.tabActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: rs(12),
    paddingBottom: rs(140),
  },

  /* HEADER */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(14),
    backgroundColor: "rgba(255,255,255,0.9)",
    borderBottomLeftRadius: rs(18),
    borderBottomRightRadius: rs(18),
    elevation: 2,
    marginHorizontal: -rs(12),
    marginTop: -rs(12),
    marginBottom: rs(12),
  },
  headerIcon: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    backgroundColor: "#FFE89A",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: rf(20),
    fontWeight: "700",
    color: "#C77A00",
    fontFamily: "PlayfairDisplay",
    textAlign: "center",
  },
  headerSlot: {
    width: rs(32),
  },

  /* SUMMARY */
  summaryCard: {
    marginTop: rs(14),
    backgroundColor: "#FFF6E3",
    borderRadius: rs(18),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "#FFE28A",
  },
  summarySmall: {
    fontSize: rf(12),
    color: "#B07A1F",
    fontWeight: "600",
    fontFamily: "PlayfairDisplay",
  },
  summaryDate: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#8B5E00",
    marginTop: rs(4),
    fontFamily: "PlayfairDisplay",
  },
  summaryRow: {
    flexDirection: "row",
    gap: rs(10),
    marginTop: rs(12),
  },
  summaryBox: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: rs(14),
    padding: rs(12),
    gap: rs(4),
  },
  summaryLabel: {
    fontSize: rf(12),
    color: "#B07A1F",
    fontFamily: "PlayfairDisplay",
  },
  summaryValue: {
    fontSize: rf(15),
    fontWeight: "700",
    color: "#8B5E00",
    fontFamily: "PlayfairDisplay",
  },

  /* CALENDAR */
  calendarCard: {
    marginTop: rs(12),
    backgroundColor: "#FFF1D6",
    borderRadius: rs(18),
    padding: rs(12),
    borderWidth: 1,
    borderColor: "rgba(194,24,91,0.12)",
  },
  monthRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: rs(6),
  },
  monthText: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#4E2A36",
    fontFamily: "PlayfairDisplay",
  },
  weekRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: rs(10),
  },
  weekText: {
    width: rs(36),
    textAlign: "center",
    fontSize: rf(12),
    fontWeight: "600",
    color: "#4E2A36",
    fontFamily: "PlayfairDisplay",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: rs(6),
  },
  cell: {
    width: "14.28%",
    alignItems: "center",
    paddingVertical: rs(8),
  },
  dayCircle: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  dayToday: {
    backgroundColor: "#FFEB3B",
    borderWidth: 1,
    borderColor: "#FBC02D",
  },
  dayHasEvent: {
    backgroundColor: "#FFE4EC",
    borderWidth: 1,
    borderColor: "#FF80AB",
  },
  daySelected: {
    backgroundColor: "#C2185B",
    borderWidth: 0,
    borderColor: "transparent",
  },
  dayDot: {
    position: "absolute",
    top: rs(4),
    right: rs(4),
    width: rs(6),
    height: rs(6),
    borderRadius: rs(3),
    backgroundColor: "#FF80AB",
  },
  dayText: {
    color: "#4E2A36",
    fontWeight: "600",
    fontFamily: "PlayfairDisplay",
  },
  dayTextToday: {
    color: "#5D4037",
  },
  dayTextSelected: {
    color: "#fff",
  },

  /* BOOKINGS */
  bookingCard: {
    marginTop: rs(12),
    backgroundColor: "#FFE7D0",
    borderRadius: rs(18),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "rgba(194,24,91,0.10)",
  },
  bookingTitle: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#8B5E00",
    marginBottom: rs(12),
    fontFamily: "PlayfairDisplay",
  },
  emptyBox: {
    alignItems: "center",
    gap: rs(8),
    paddingVertical: rs(20),
  },
  emptyText: {
    color: "#B07A1F",
    fontSize: rf(13),
    fontFamily: "PlayfairDisplay",
  },
  eventCard: {
    marginTop: rs(10),
    backgroundColor: "#FFF5F8",
    padding: rs(12),
    borderRadius: rs(14),
  },
  eventTitle: {
    fontWeight: "700",
    color: "#880E4F",
    fontFamily: "PlayfairDisplay",
  },
  eventMeta: {
    fontSize: rf(12),
    color: "#6B4350",
    marginTop: rs(4),
  },

  /* NAVIGATION BAR */
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
