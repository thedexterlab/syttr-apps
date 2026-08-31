import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { hp, rf, rs, wp } from "../utils/responsive";
import { BASE_URL, getNannyAvailability, updateNannyAvailability } from "../Api";
import SafeScreen from "../components/SafeScreen";

/* =========================
   CONFIG
========================= */

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const MORNING = [
  "06:00 AM",
  "07:00 AM",
  "08:00 AM",
  "09:00 AM",
  "10:00 AM",
  "11:00 AM",
];
const AFTERNOON = [
  "12:00 PM",
  "01:00 PM",
  "02:00 PM",
  "03:00 PM",
  "04:00 PM",
  "05:00 PM",
];
const EVENING = [
  "06:00 PM",
  "07:00 PM",
  "08:00 PM",
  "09:00 PM",
  "10:00 PM",
  "11:00 PM",
];

/* =========================
   TYPES
========================= */

type TimeSlot = {
  period: string;
  time: string;
};

type CalendarSlotRange = {
  start_time: string;
  end_time: string;
};

const UNAVAILABLE_TIME_SENTINEL = "__UNAVAILABLE__";

type Props = {
  onBack?: () => void;
  onSuccess?: () => void;
  onDone?: () => void;
};

/* =========================
   SCREEN
========================= */

const AvailabilityScreen: React.FC<Props> = ({ onBack, onSuccess, onDone }) => {
  const handleBack = () => {
    if (onBack) onBack();
  };

  const [mode, setMode] = useState<"weekly" | "calendar">("weekly");
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [timeSlots, setTimeSlots] = useState<Record<string, TimeSlot[]>>({});
  const [calendarSlots, setCalendarSlots] = useState<Record<string, CalendarSlotRange[]>>({});
  const [calendarClosedDates, setCalendarClosedDates] = useState<string[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [pendingDate, setPendingDate] = useState<Date | null>(null);
  const [newDate, setNewDate] = useState<Date | null>(null);
  const [newStartTime, setNewStartTime] = useState<Date | null>(null);
  const [newEndTime, setNewEndTime] = useState<Date | null>(null);
  const [calendarAnchor, setCalendarAnchor] = useState(new Date());
  const [activeDateForTimeAdd, setActiveDateForTimeAdd] = useState<string | null>(null);
  const [calendarTimeTarget, setCalendarTimeTarget] = useState<"start" | "end" | null>(null);
  const timeInputRefs = useRef<Record<string, any>>({});
  const [webDateValue, setWebDateValue] = useState("");
  const [webStartTimeValue, setWebStartTimeValue] = useState("");
  const [webEndTimeValue, setWebEndTimeValue] = useState("");
  const [loading, setLoading] = useState(false);

  const normalizedCalendarSlots = useMemo(() => {
    const mapped: Record<string, CalendarSlotRange[]> = {};
    Object.entries(calendarSlots).forEach(([key, slots]) => {
      const normalized = normalizeDateKey(key);
      if (!normalized) return;
      const merged = normalizeCalendarRanges(slots);
      if (merged.length) mapped[normalized] = merged;
    });
    return mapped;
  }, [calendarSlots]);

  const weeklyTimesByDay = useMemo(() => {
    const mapped: Record<string, string[]> = {};
    Object.entries(timeSlots).forEach(([day, slots]) => {
      const times = (slots || []).map((slot) => slot.time).filter(Boolean);
      if (times.length) {
        mapped[day] = toSortedUniqueTimes(times);
      }
    });
    return mapped;
  }, [timeSlots]);

  const monthCalendarSlots = useMemo(() => {
    const mapped: Record<string, { slots: CalendarSlotRange[]; canDelete: boolean }> = {};
    const closedDateSet = new Set(
      calendarClosedDates.map((value) => normalizeDateKey(value)).filter(Boolean)
    );
    buildMonthDates(calendarAnchor).forEach((date) => {
      const key = formatDateKey(date);
      const weeklySlots = (weeklyTimesByDay[getDayName(date)] || []).map((time) => ({
        start_time: time,
        end_time: getSlotEndTimeLabel(time),
      }));
      const explicitSlots = normalizedCalendarSlots[key] || [];
      const hasOverride = Object.prototype.hasOwnProperty.call(normalizedCalendarSlots, key);
      const isClosed = closedDateSet.has(key);
      const merged = isClosed ? [] : hasOverride ? explicitSlots : weeklySlots;
      if (!merged.length && !isClosed) return;
      mapped[key] = {
        slots: merged,
        canDelete: explicitSlots.length > 0 || isClosed || weeklySlots.length > 0,
      };
    });
    return mapped;
  }, [normalizedCalendarSlots, weeklyTimesByDay, calendarAnchor, calendarClosedDates]);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  /* ---------- INIT ---------- */
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    loadLocalAvailability();
    fetchAvailabilityFromApi();
  }, []);

  /* ---------- DAY TOGGLE ---------- */
  const toggleDay = (day: string) => {
    if (selectedDays.includes(day)) {
      const updated = selectedDays.filter((d) => d !== day);
      const updatedSlots = { ...timeSlots };
      delete updatedSlots[day];
      setSelectedDays(updated);
      setTimeSlots(updatedSlots);
    } else {
      setSelectedDays([...selectedDays, day]);
    }
  };

  /* ---------- TIME TOGGLE ---------- */
  const toggleTimeSlot = (day: string, period: string, time: string) => {
    const daySlots = timeSlots[day] || [];
    const exists = daySlots.find(
      (s) => s.period === period && s.time === time
    );

    const updated = exists
      ? daySlots.filter((s) => !(s.period === period && s.time === time))
      : [...daySlots, { period, time }];

    setTimeSlots({ ...timeSlots, [day]: updated });
  };

  /* ---------- QUICK SELECT ---------- */
  const selectPeriod = (day: string, period: string, slots: string[]) => {
    const filtered = (timeSlots[day] || []).filter(
      (s) => s.period !== period
    );

    const newSlots = slots.map((t) => ({
      period,
      time: t,
    }));

    setTimeSlots({
      ...timeSlots,
      [day]: [...filtered, ...newSlots],
    });
  };

  const clearTimes = (day: string) => {
    const updated = { ...timeSlots };
    delete updated[day];
    setTimeSlots(updated);
  };

  const triggerWebTimePickerForDate = (dateKey: string) => {
    const input = timeInputRefs.current[dateKey];
    if (input) {
      input.value = "";
      // @ts-ignore - showPicker exists on some browsers
      if (typeof input.showPicker === "function") {
        input.showPicker();
      } else {
        input.focus?.();
        input.click();
      }
    }
  };

  /* ---------- CALENDAR MODE ---------- */
  useEffect(() => {
    if (newDate) {
      setCalendarAnchor(new Date(newDate.getFullYear(), newDate.getMonth(), 1));
    }
  }, [newDate]);

  const openTimePickerForDate = (dateKey: string) => {
    if (Platform.OS === "web") {
      setActiveDateForTimeAdd(dateKey);
      triggerWebTimePickerForDate(dateKey);
      return;
    }
    if (showTimePicker && activeDateForTimeAdd === dateKey) {
      setShowTimePicker(false);
      setActiveDateForTimeAdd(null);
      return;
    }
    const base = new Date(dateKey);
    const useBase = Number.isNaN(base.getTime()) ? new Date() : base;
    setPendingDate(useBase);
    setNewDate(useBase);
    setActiveDateForTimeAdd(dateKey);
    setShowTimePicker(true);
  };

  const addCalendarSlot = (dateKey: string, startLabel: string, endLabel: string) => {
    const start = startLabel.trim();
    const end = endLabel.trim();
    if (!start || !end) return;
    if (timeToMinutes(end) <= timeToMinutes(start)) {
      Alert.alert("Add availability", "End time must be after start time.");
      return;
    }
    setCalendarSlots((prev) => {
      const existing = prev[dateKey] || getWeeklySlotsForDate(dateKey, weeklyTimesByDay);
      const nextSlots = normalizeCalendarRanges([
        ...existing,
        { start_time: start, end_time: end },
      ]);
      return {
        ...prev,
        [dateKey]: nextSlots,
      };
    });
    const normalizedDate = normalizeDateKey(dateKey);
    if (normalizedDate) {
      setCalendarClosedDates((prev) =>
        prev.filter((value) => normalizeDateKey(value) !== normalizedDate)
      );
    }
  };

  const handleCalendarDatePress = (date: Date) => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    setNewDate(normalized);
    setPendingDate(normalized);
    if (Platform.OS === "web") {
      setWebDateValue(formatDateKey(normalized));
    }
  };

  const handleDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (event.type === "dismissed") {
      setShowDatePicker(false);
      setPendingDate(null);
      return;
    }
    const picked = date || new Date();
    const normalized = new Date(picked);
    normalized.setHours(0, 0, 0, 0);
    setPendingDate(normalized);
    setNewDate(normalized);
    setShowDatePicker(false);
  };

  const handleTimeChange = (event: DateTimePickerEvent, date?: Date) => {
    if (event.type === "dismissed") {
      setShowTimePicker(false);
      setActiveDateForTimeAdd(null);
      setCalendarTimeTarget(null);
      return;
    }
    const time = date || new Date();
    if (activeDateForTimeAdd) {
      addCalendarSlot(
        activeDateForTimeAdd,
        formatTimeLabel(time),
        getSlotEndTimeLabel(formatTimeLabel(time))
      );
      setActiveDateForTimeAdd(null);
      setCalendarTimeTarget(null);
      setNewStartTime(null);
      setNewEndTime(null);
    } else if (calendarTimeTarget === "end") {
      setNewEndTime(time);
      setCalendarTimeTarget(null);
    } else {
      setNewStartTime(time);
      setCalendarTimeTarget(null);
    }
    setPendingDate(null);
    setShowTimePicker(false);
  };

  const getTimePickerValue = () => {
    if (calendarTimeTarget === "end") {
      return newEndTime || newStartTime || pendingDate || newDate || new Date();
    }
    if (calendarTimeTarget === "start") {
      return newStartTime || pendingDate || newDate || new Date();
    }
    return pendingDate || newDate || newStartTime || newEndTime || new Date();
  };

  const removeCalendarSlot = (dateKey: string, slotToRemove: CalendarSlotRange | CalendarSlotRange[]) => {
    const slotsToRemove = Array.isArray(slotToRemove) ? slotToRemove : [slotToRemove];
    const removalKeys = new Set(
      slotsToRemove.map((slot) => `${slot.start_time}|${slot.end_time}`)
    );
    setCalendarSlots((prev) => {
      const sourceSlots = prev[dateKey] || getWeeklySlotsForDate(dateKey, weeklyTimesByDay);
      const remaining = sourceSlots.filter(
        (slot) => !removalKeys.has(`${slot.start_time}|${slot.end_time}`)
      );
      const next = { ...prev };
      next[dateKey] = remaining;
      return next;
    });
    const normalizedDate = normalizeDateKey(dateKey);
    const remainingCount = (normalizedCalendarSlots[dateKey] || getWeeklySlotsForDate(dateKey, weeklyTimesByDay))
      .filter((slot) => !removalKeys.has(`${slot.start_time}|${slot.end_time}`)).length;
    if (!normalizedDate) return;
    if (remainingCount === 0) {
      setCalendarClosedDates((prev) => (prev.includes(normalizedDate) ? prev : [...prev, normalizedDate]));
      return;
    }
    setCalendarClosedDates((prev) =>
      prev.filter((value) => normalizeDateKey(value) !== normalizedDate)
    );
  };

  const addSelectedSlot = () => {
    const dateBase = pendingDate || newDate;
    if (!dateBase || !newStartTime || !newEndTime) {
      Alert.alert("Add availability", "Please pick a date, start time, and end time first.");
      return;
    }
    addCalendarSlot(formatDateKey(dateBase), formatTimeLabel(newStartTime), formatTimeLabel(newEndTime));
    setActiveDateForTimeAdd(null);
    setNewStartTime(null);
    setNewEndTime(null);
    setPendingDate(null);
    setWebStartTimeValue("");
    setWebEndTimeValue("");
  };

  const parseAvailabilityData = (payload: any) => {
    const data = payload?.data ?? payload;
    const modeValue = data?.mode || payload?.mode;
    const incomingCalendar = data?.calendar_slots || payload?.calendar_slots;
    const incomingClosedDates = data?.closed_dates || payload?.closed_dates;
    const calendarList = Array.isArray(incomingCalendar)
      ? incomingCalendar.map((item: any) => ({
          ...item,
          slots: normalizeCalendarRanges(item?.slots || item?.time_slots || item?.times || []),
          isUnavailable: hasUnavailableMarker(item?.slots || item?.time_slots || item?.times || []),
        }))
      : incomingCalendar && typeof incomingCalendar === "object"
      ? Object.entries(incomingCalendar).map(([date, times]) => ({
          date,
          slots: Array.isArray(times) ? normalizeCalendarRanges(times as any[]) : [],
          isUnavailable: hasUnavailableMarker(Array.isArray(times) ? (times as any[]) : []),
        }))
      : [];
    const incomingAvailability = data?.availability ?? data?.data ?? data;
    let availabilityList = Array.isArray(incomingAvailability) ? incomingAvailability : [];
    if (availabilityList.length && availabilityList[0]?.syttr_profile_id) {
      const grouped: Record<string, { day?: string; date?: string; time_slots: { period?: string; time?: string; start_time?: string; end_time?: string }[] }> = {};
      availabilityList.forEach((row: any) => {
        const key = row.date ? `date:${row.date}` : `day:${row.day || ""}`;
        if (!grouped[key]) {
          grouped[key] = {
            day: row.day || undefined,
            date: row.date || undefined,
            time_slots: [],
          };
        }
        if (row.time || row.start_time) {
          grouped[key].time_slots.push({
            period: row.period || undefined,
            time: row.time,
            start_time: row.start_time,
            end_time: row.end_time,
          });
        }
      });
      availabilityList = Object.values(grouped).map((entry) => ({
        day: entry.date || entry.day,
        time_slots: entry.time_slots,
      }));
    }
    const dateEntries = availabilityList.filter((item: any) => isDateLike(item?.day));
    const weeklyEntries = availabilityList.filter(
      (item: any) => !isDateLike(item?.day) && DAYS.includes(item?.day)
    );
    const closedDates = [
      ...(Array.isArray(incomingClosedDates) ? incomingClosedDates : []),
      ...calendarList.filter((item: any) => item?.isUnavailable).map((item: any) => item?.date),
      ...dateEntries
        .filter((item: any) => hasUnavailableMarker(item?.time_slots || []))
        .map((item: any) => item?.day),
    ]
      .map((value) => normalizeDateKey(value))
      .filter(Boolean);
    return {
      rawData: data,
      mode: modeValue,
      availabilityList,
      calendarList,
      dateEntries,
      weeklyEntries,
      closedDates,
    };
  };

  /* ---------- API LOAD ---------- */
  const fetchAvailabilityFromApi = async () => {
    try {
      const rawToken =
        (await AppStorage.getItem("token")) ||
        (await AppStorage.getItem("nanny_token"));
      const token = rawToken ? rawToken.replace(/"/g, "").trim() : "";
      const nannyId = await AppStorage.getItem("nanny_id");
      if (!nannyId) return;

      const json = await getNannyAvailability(token || undefined, nannyId);
      console.log("[Availability] load response", json);
      const parsed = parseAvailabilityData(json);
      const hasCalendar = parsed.calendarList.length > 0 || parsed.dateEntries.length > 0;

      if (parsed.calendarList.length) {
        applyCalendarSlots(parsed.calendarList, true);
      } else if (parsed.dateEntries.length) {
        const derivedCalendar = parsed.dateEntries.map((item: any) => ({
          date: item.day,
          slots: normalizeCalendarRanges(item.time_slots || []),
        }));
        applyCalendarSlots(derivedCalendar, true);
      }
      setCalendarClosedDates(parsed.closedDates || []);

      if (parsed.weeklyEntries.length) {
        applyAvailability(parsed.weeklyEntries, true);
      }

      if (parsed.mode === "weekly" && parsed.weeklyEntries.length) setMode("weekly");
      else if (hasCalendar) setMode("calendar");
      else setMode("weekly");

      if (parsed.rawData) {
        await AppStorage.setItem(
          "nanny_availability",
          JSON.stringify({
            availability: parsed.availabilityList,
            mode: parsed.mode,
            calendar_slots: parsed.calendarList,
            closed_dates: parsed.closedDates,
          })
        );
      }
    } catch {
      // silent fail
    }
  };

  /* ---------- APPLY ---------- */
  const applyAvailability = (list: any[], preserveCalendar = false) => {
    if (!preserveCalendar) {
      setCalendarSlots({});
    }
    const days: string[] = [];
    const slots: Record<string, TimeSlot[]> = {};

    list.forEach((item) => {
      if (!item?.day || !DAYS.includes(item.day)) return;
      days.push(item.day);
      const rawSlots = item.time_slots || item.timeSlots || [];
      slots[item.day] = rawSlots.map((s: any) => ({
        period: s.period,
        time: s.time,
      }));
    });

    setSelectedDays(days);
    setTimeSlots(slots);
  };

  const applyCalendarSlots = (
    list: { date: string; times?: string[]; slots?: CalendarSlotRange[] }[],
    preserveWeekly = false
  ) => {
    if (!preserveWeekly) {
      setSelectedDays([]);
      setTimeSlots({});
    }
    const mapped: Record<string, CalendarSlotRange[]> = {};
    list.forEach((item) => {
      if (!item?.date) return;
      const key = normalizeDateKey(item.date);
      if (!key) return;
      const incomingSlots = item.slots?.length
        ? item.slots
        : Array.isArray(item.times)
        ? item.times.map((time) => ({
            start_time: time,
            end_time: getSlotEndTimeLabel(time),
          }))
        : [];
      const existing = mapped[key] || [];
      const merged = normalizeCalendarRanges([...existing, ...incomingSlots]);
      mapped[key] = merged;
    });
    setCalendarSlots(mapped);
  };

  /* ---------- LOCAL ---------- */
  const loadLocalAvailability = async () => {
    try {
      const saved = await AppStorage.getItem("nanny_availability");
      if (!saved) return;
      const json = JSON.parse(saved);
      const parsed = parseAvailabilityData(json);
      const hasCalendar = parsed.calendarList.length > 0 || parsed.dateEntries.length > 0;

      if (parsed.calendarList.length) {
        applyCalendarSlots(parsed.calendarList, true);
      } else if (parsed.dateEntries.length) {
        const derivedCalendar = parsed.dateEntries.map((item: any) => ({
          date: item.day,
          slots: normalizeCalendarRanges(item.time_slots || []),
        }));
        applyCalendarSlots(derivedCalendar, true);
      }
      setCalendarClosedDates(parsed.closedDates || []);

      if (parsed.weeklyEntries.length) {
        applyAvailability(parsed.weeklyEntries, true);
      }

      if (parsed.mode === "weekly" && parsed.weeklyEntries.length) setMode("weekly");
      else if (hasCalendar) setMode("calendar");
      else setMode("weekly");
    } catch {}
  };

  /* ---------- SAVE ---------- */
  const saveAvailability = async () => {
    if (mode === "weekly" && selectedDays.length === 0) {
      Alert.alert("Error", "Please select at least one day.");
      return;
    }
    if (mode === "calendar" && !Object.keys(calendarSlots).length && calendarClosedDates.length === 0) {
      Alert.alert("Error", "Please add at least one date/time slot.");
      return;
    }
    if (!newDate && mode === "calendar" && !Object.keys(calendarSlots).length && calendarClosedDates.length === 0) {
      Alert.alert("Error", "Pick a date and time, then tap Add slot.");
      return;
    }

    setLoading(true);

    try {
      const rawToken =
        (await AppStorage.getItem("token")) ||
        (await AppStorage.getItem("nanny_token"));
      const token = rawToken ? rawToken.replace(/"/g, "").trim() : "";
      const nannyId = await AppStorage.getItem("nanny_id");
      if (!nannyId) {
        Alert.alert("Error", "Missing nanny id. Please log in again.");
        return;
      }

      const weeklyAvailabilityPayload = selectedDays.map((day) => ({
        day,
        time_slots: (timeSlots[day] || []).map((s) => ({
          period: s.period,
          time: s.time,
          start_time: s.time,
          end_time: getSlotEndTimeLabel(s.time),
        })),
      }));
      const calendarAvailabilityPayload = [
        ...Object.entries(calendarSlots).map(([date, slots]) => ({
          day: date,
          date,
          time_slots: (slots || []).length
            ? (slots || []).map((slot) => ({
                period: "Custom",
                time: slot.start_time,
                start_time: slot.start_time,
                end_time: slot.end_time,
              }))
            : [
                {
                  period: "Unavailable",
                  time: UNAVAILABLE_TIME_SENTINEL,
                  start_time: UNAVAILABLE_TIME_SENTINEL,
                  end_time: UNAVAILABLE_TIME_SENTINEL,
                },
              ],
        })),
        ...calendarClosedDates
          .filter((date) => !Object.prototype.hasOwnProperty.call(calendarSlots, date))
          .map((date) => ({
            day: date,
            date,
            time_slots: [
              {
                period: "Unavailable",
                time: UNAVAILABLE_TIME_SENTINEL,
                start_time: UNAVAILABLE_TIME_SENTINEL,
                end_time: UNAVAILABLE_TIME_SENTINEL,
              },
            ],
          })),
      ];
      const availabilityPayload =
        mode === "weekly" && calendarAvailabilityPayload.length === 0
          ? weeklyAvailabilityPayload
          : [...weeklyAvailabilityPayload, ...calendarAvailabilityPayload];

      if (!availabilityPayload.length) {
        Alert.alert("Error", "Please add at least one time slot before saving.");
        return;
      }

      const payload = {
        nanny_id: nannyId || undefined,
        mode: calendarAvailabilityPayload.length ? "calendar" : mode,
        availability: availabilityPayload,
        ...(calendarAvailabilityPayload.length
          ? {
              calendar_slots: Object.fromEntries(
                [
                  ...Object.entries(calendarSlots),
                  ...calendarClosedDates
                    .filter((date) => !Object.prototype.hasOwnProperty.call(calendarSlots, date))
                    .map((date) => [date, []]),
                ].map(([date, slots]) => [date, slots])
              ),
            }
          : {}),
      };

      console.log("[Availability] saving", {
        url: `${BASE_URL}nanny/availability`,
        nannyId,
        mode,
        hasToken: !!token,
        payload,
      });

      await updateNannyAvailability(payload, token || undefined);
      // Refresh from server to confirm
      await fetchAvailabilityFromApi();
      await AppStorage.setItem(
        "nanny_availability",
        JSON.stringify(payload)
      );

      const handleSuccess = onSuccess || onDone;
      if (handleSuccess) {
         
        console.log("[Availability] save success -> next step");
        handleSuccess();
      } else {
        handleBack();
      }
      Alert.alert("Success", "Availability saved.");
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Failed to save availability.");
    } finally {
      setLoading(false);
    }
  };

  /* =========================
     UI
  ========================= */

  return (
    <SafeScreen edges={["top", "right", "bottom", "left"]} style={{ backgroundColor: "#FFFFFF" }}>
      <LinearGradient colors={["#FFFFFF", "#FFFFFF", "#FFFFFF"]} style={{ flex: 1 }}>
        {/* TOP BAR */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={handleBack}
          >
            <Ionicons name="chevron-back" size={20} color="#C2185B" />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Availability & Schedule</Text>
          <View style={{ width: rs(34) }} />
        </View>

        <ScrollView contentContainerStyle={styles.container}>
          <Animated.View style={{ opacity: fadeAnim }}>
            {/* HEADER */}
            <View style={styles.headerCard}>
              <View style={styles.headerIcon}>
                <Ionicons name="time-outline" size={24} color="#fff" />
              </View>
              <View style={{ marginLeft: rs(14) }}>
                <Text style={styles.headerTitle}>Set Your Schedule</Text>
                <Text style={styles.headerDesc}>
                  Select your available days and time slots
                </Text>
              </View>
            </View>

          {/* MODE TOGGLE */}
          <View style={styles.modeToggle}>
            {(["weekly", "calendar"] as const).map((value) => {
              const active = mode === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.modeBtn, active && styles.modeBtnActive]}
                  onPress={() => setMode(value)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.modeText, active && styles.modeTextActive]}>
                    {value === "weekly" ? "Weekly View" : "Calendar View"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {mode === "weekly" ? (
            <>
              <Text style={styles.sectionTitle}>Available Days</Text>
              <View style={styles.daysGrid}>
                {DAYS.map((day) => {
                  const active = selectedDays.includes(day);
                  return (
                    <TouchableOpacity
                      key={day}
                      onPress={() => toggleDay(day)}
                      style={[styles.dayChip, active && styles.dayChipActive]}
                    >
                      <Text
                        style={[styles.dayText, active && styles.dayTextActive]}
                      >
                        {day}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* TIME SLOTS */}
              {DAYS.filter((day) => selectedDays.includes(day)).map((day) => (
                <View key={day} style={styles.dayCard}>
                  <View style={styles.dayHeader}>
                    <Text style={styles.dayTitle}>{day}</Text>
                    <View style={styles.quickRow}>
                      <QuickBtn label="M" onPress={() => selectPeriod(day, "Morning", MORNING)} />
                      <QuickBtn label="A" onPress={() => selectPeriod(day, "Afternoon", AFTERNOON)} />
                      <QuickBtn label="E" onPress={() => selectPeriod(day, "Evening", EVENING)} />
                      <QuickBtn label="X" clear onPress={() => clearTimes(day)} />
                    </View>
                  </View>

                  {renderPeriod("Morning", MORNING, day, timeSlots, toggleTimeSlot)}
                  {renderPeriod("Afternoon", AFTERNOON, day, timeSlots, toggleTimeSlot)}
                  {renderPeriod("Evening", EVENING, day, timeSlots, toggleTimeSlot)}
                </View>
              ))}
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Calendar Availability</Text>
              <View style={styles.calendarCard}>
                <Text style={styles.calendarDesc}>
                  Add specific dates and times.
                </Text>
                <View style={styles.calendarMonthRow}>
                  <TouchableOpacity
                    onPress={() => setCalendarAnchor(addMonths(calendarAnchor, -1))}
                  >
                    <Ionicons name="chevron-back" size={18} color="#C2185B" />
                  </TouchableOpacity>
                  <Text style={styles.calendarMonthText}>
                    {calendarAnchor.toLocaleDateString(undefined, {
                      month: "long",
                      year: "numeric",
                    })}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setCalendarAnchor(addMonths(calendarAnchor, 1))}
                  >
                    <Ionicons name="chevron-forward" size={18} color="#C2185B" />
                  </TouchableOpacity>
                </View>

                <View style={styles.calendarWeekRow}>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <Text key={d} style={styles.calendarWeekText}>
                      {d}
                    </Text>
                  ))}
                </View>

                <View style={styles.calendarGrid}>
                  {buildMonthGrid(calendarAnchor).map((cell, idx) => {
                    if (!cell) {
                      return <View key={`empty-${idx}`} style={styles.calendarCell} />;
                    }
                    const dateKey = formatDateKey(cell);
                    const isSelected =
                      newDate && formatDateKey(newDate) === dateKey;
                    const isToday = isTodayDate(cell);
                    const hasSlots = Object.prototype.hasOwnProperty.call(monthCalendarSlots, dateKey);
                    return (
                      <TouchableOpacity
                        key={dateKey}
                        style={styles.calendarCell}
                        onPress={() => handleCalendarDatePress(cell)}
                      >
                        <View
                          style={[
                            styles.calendarDayCircle,
                            isToday && styles.calendarDayToday,
                            hasSlots && styles.calendarDayHasSlot,
                            isSelected && styles.calendarDaySelected,
                          ]}
                        >
                          {hasSlots && <View style={styles.calendarDot} />}
                          <Text
                            style={[
                              styles.calendarDayText,
                              isToday && styles.calendarDayTextToday,
                              isSelected && styles.calendarDayTextSelected,
                            ]}
                          >
                            {cell.getDate()}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {Platform.OS === "web" ? (
                  <View style={styles.inlinePickerRow}>
                    <input
                      type="date"
                      value={webDateValue || (newDate ? formatDateKey(newDate) : "")}
                      onChange={(e: any) => {
                        const v = (e?.target as any)?.value ?? "";
                        setWebDateValue(v);
                        if (v) {
                          const parsed = new Date(`${v}T00:00:00`);
                          if (!Number.isNaN(parsed.getTime())) {
                            parsed.setHours(0, 0, 0, 0);
                          setNewDate(parsed);
                        }
                      } else {
                        setNewDate(null);
                      }
                    }}
                    style={styles.webNativeInput as any}
                  />
                    <input
                      type="time"
                      value={webStartTimeValue || toWebTimeValue(newStartTime)}
                      onChange={(e: any) => {
                        const v = (e?.target as any)?.value ?? "";
                        setWebStartTimeValue(v);
                        setNewStartTime(parseWebTimeValue(v, newDate));
                      }}
                      style={styles.webNativeInput as any}
                    />
                    <input
                      type="time"
                      value={webEndTimeValue || toWebTimeValue(newEndTime)}
                      onChange={(e: any) => {
                        const v = (e?.target as any)?.value ?? "";
                        setWebEndTimeValue(v);
                        setNewEndTime(parseWebTimeValue(v, newDate));
                      }}
                      style={styles.webNativeInput as any}
                    />
                    <TouchableOpacity
                      style={[styles.addDateBtn, (!newDate || !newStartTime || !newEndTime) && { opacity: 0.6 }]}
                      disabled={!newDate || !newStartTime || !newEndTime}
                      onPress={addSelectedSlot}
                    >
                      <Ionicons name="add-circle-outline" size={18} color="#fff" />
                      <Text style={styles.addDateText}>Add Slot</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <View style={styles.nativePickerRow}>
                      <TouchableOpacity
                        style={styles.selectorBox}
                        onPress={() => {
                          if (showDatePicker) {
                            setShowDatePicker(false);
                            return;
                          }
                          setPendingDate(new Date());
                          setShowDatePicker(true);
                        }}
                      >
                        <Text>
                          {newDate ? formatDisplayDate(formatDateKey(newDate)) : "Pick Date"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.selectorBox}
                        onPress={() => {
                          if (showTimePicker) {
                            setShowTimePicker(false);
                            setActiveDateForTimeAdd(null);
                            setCalendarTimeTarget(null);
                            return;
                          }
                          const base = newDate || new Date();
                          setPendingDate(base);
                          setNewDate(base);
                          setCalendarTimeTarget("start");
                          setShowTimePicker(true);
                        }}
                      >
                        <Text>
                          {newStartTime ? formatTimeLabel(newStartTime) : "Start Time"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.selectorBox}
                        onPress={() => {
                          if (showTimePicker) {
                            setShowTimePicker(false);
                            setActiveDateForTimeAdd(null);
                            setCalendarTimeTarget(null);
                            return;
                          }
                          const base = newDate || new Date();
                          setPendingDate(base);
                          setNewDate(base);
                          setCalendarTimeTarget("end");
                          setShowTimePicker(true);
                        }}
                      >
                        <Text>
                          {newEndTime ? formatTimeLabel(newEndTime) : "End Time"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.addDateBtn,
                          (!newDate || !newStartTime || !newEndTime) && { opacity: 0.6 },
                        ]}
                        disabled={!newDate || !newStartTime || !newEndTime}
                        onPress={addSelectedSlot}
                      >
                        <Ionicons name="add-circle-outline" size={18} color="#fff" />
                        <Text style={styles.addDateText}>Add Slot</Text>
                      </TouchableOpacity>
                    </View>
                    {showDatePicker && (
                      <DateTimePicker
                        value={pendingDate || newDate || new Date()}
                        mode="date"
                        display="default"
                        onChange={handleDateChange}
                      />
                    )}
                    {showTimePicker && (
                      <DateTimePicker
                        value={getTimePickerValue()}
                        mode="time"
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        onChange={handleTimeChange}
                      />
                    )}
                  </>
                )}

                {!!(Object.keys(calendarSlots).length || calendarClosedDates.length) && (
                  <TouchableOpacity
                    onPress={() =>
                      Alert.alert("Clear all slots", "Remove all calendar slots?", [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Clear",
                          style: "destructive",
                          onPress: () => {
                            setCalendarSlots({});
                            setCalendarClosedDates([]);
                          },
                        },
                      ])
                    }
                  >
                    <Text style={styles.clearCalendar}>Clear all</Text>
                  </TouchableOpacity>
                )}

                {Object.keys(monthCalendarSlots).length === 0 ? (
                  <Text style={styles.emptyCalendar}>No calendar slots yet.</Text>
                ) : (
                  Object.entries(monthCalendarSlots)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([dateKey, entry], dateIdx) => {
                      const ranges = buildCalendarDisplayRanges(entry.slots || []);
                      return (
                        <View key={`date-${dateIdx}-${dateKey}`} style={styles.dateCard}>
                          {Platform.OS === "web" && (
                            <input
                              type="time"
                              ref={(el) => {
                                timeInputRefs.current[dateKey] = el;
                              }}
                              onChange={(e: any) => {
                                const v = (e?.target as any)?.value ?? "";
                                if (!v) return;
                                const [h, m] = v.split(":").map((n: string) => Number.parseInt(n, 10));
                                if (Number.isNaN(h) || Number.isNaN(m)) return;
                                const base = new Date();
                                base.setHours(h, m, 0, 0);
                                setTimeout(() => {
                                  addCalendarSlot(
                                    dateKey,
                                    formatTimeLabel(base),
                                    getSlotEndTimeLabel(formatTimeLabel(base))
                                  );
                                  (e.target as any).value = "";
                                  setActiveDateForTimeAdd(null);
                                }, 0);
                              }}
                              style={styles.hiddenWebInput as any}
                            />
                          )}
                          <View style={styles.dateHeader}>
                            <Text style={styles.dateTitle}>{formatDisplayDate(dateKey)}</Text>
                            <TouchableOpacity
                              onPress={() => openTimePickerForDate(dateKey)}
                              style={styles.addTimeBtn}
                                >
                                  <Ionicons name="add" size={16} color="#FF80AB" />
                                  <Text style={styles.addTimeText}>Add Time</Text>
                                </TouchableOpacity>
                              </View>
                              <View style={styles.timeWrap}>
                            {ranges.length === 0 ? (
                              <Text style={styles.emptyCalendar}>Unavailable this day.</Text>
                            ) : (
                              ranges.map((range, timeIdx) => (
                                <View key={`time-${dateIdx}-${timeIdx}-${range.label}`} style={styles.slotChip}>
                                  <Text style={styles.slotText}>{range.label}</Text>
                                  {entry.canDelete ? (
                                    <TouchableOpacity
                                      onPress={() => removeCalendarSlot(dateKey, range.slots)}
                                      style={styles.removeChipBtn}
                                    >
                                      <Ionicons name="close" size={14} color="#880E4F" />
                                    </TouchableOpacity>
                                  ) : null}
                                </View>
                              ))
                            )}
                              </View>
                            </View>
                          );
                        })
                )}
              </View>
            </>
          )}

          {/* SAVE */}
          <TouchableOpacity
            style={[styles.saveBtn, loading && { opacity: 0.7 }]}
            onPress={saveAvailability}
            disabled={loading}
          >
            <Text style={styles.saveText}>
              {loading ? "Saving..." : "Save Availability"}
            </Text>
          </TouchableOpacity>
          </Animated.View>

        </ScrollView>
      </LinearGradient>
    </SafeScreen>
  );
};

export default AvailabilityScreen;

/* =========================
   HELPERS
========================= */

const renderPeriod = (
  title: string,
  slots: string[],
  day: string,
  timeSlots: Record<string, TimeSlot[]>,
  toggleFn: (day: string, title: string, time: string) => void
) => (
  <View style={{ marginBottom: rs(12) }}>
    <Text style={styles.periodTitle}>{title}</Text>
    <View style={styles.timeWrap}>
      {slots.map((t) => {
        const active = (timeSlots[day] || []).some(
          (s) => s.time === t && s.period === title
        );
        return (
          <TouchableOpacity
            key={t}
            onPress={() => toggleFn(day, title, t)}
            style={[styles.timeChip, active && styles.timeChipActive]}
          >
            <Text
              style={[styles.timeText, active && styles.timeTextActive]}
            >
              {t}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  </View>
);

type QuickBtnProps = {
  label: string;
  onPress: () => void;
  clear?: boolean;
};

const QuickBtn: React.FC<QuickBtnProps> = ({ label, onPress, clear }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.quickBtn, clear && styles.quickClear]}
  >
    <Text style={[styles.quickText, clear && styles.quickTextClear]}>
      {label}
    </Text>
  </TouchableOpacity>
);

const formatDateKey = (date: Date) => {
  const copy = new Date(date);
  const year = copy.getFullYear();
  const month = String(copy.getMonth() + 1).padStart(2, "0");
  const day = String(copy.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isTodayDate = (date: Date) => formatDateKey(date) === formatDateKey(new Date());

const normalizeDateKey = (value: string) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  parsed.setHours(0, 0, 0, 0);
  return formatDateKey(parsed);
};

const buildMonthGrid = (anchor: Date) => {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const start = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < start; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

const buildMonthDates = (anchor: Date) => {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: Date[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(new Date(year, month, d));
  }
  return days;
};

const getDayName = (date: Date) =>
  date.toLocaleDateString("en-US", { weekday: "long" });

const toSortedUniqueTimes = (times: string[]) =>
  Array.from(new Set(times)).sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

const addMonths = (date: Date, delta: number) =>
  new Date(date.getFullYear(), date.getMonth() + delta, 1);

const formatDisplayDate = (key: string) => {
  const parts = key.split("-");
  const d =
    parts.length === 3
      ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
      : new Date(key);
  if (Number.isNaN(d.getTime())) return key;
  return d.toDateString();
};

const formatTimeLabel = (date: Date) =>
  date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const toWebTimeValue = (date: Date | null) =>
  date
    ? `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`
    : "";

const parseWebTimeValue = (value: string, baseDate?: Date | null) => {
  if (!value) return null;
  const [h, m] = value.split(":").map((n: string) => Number.parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(baseDate || new Date());
  d.setHours(h, m, 0, 0);
  return d;
};

const timeToMinutes = (label: string) => {
  const match = label.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const hourRaw = Number(match[1]);
  const minute = Number(match[2]) || 0;
  const meridiem = (match[3] || "").toUpperCase();
  if (!Number.isFinite(hourRaw)) return Number.MAX_SAFE_INTEGER;
  if (!meridiem) {
    return hourRaw * 60 + minute;
  }
  let hour = hourRaw % 12;
  if (meridiem === "PM") hour += 12;
  return hour * 60 + minute;
};

const formatMinutesToLabel = (minutes: number) => {
  const safe = Math.max(0, minutes);
  const hour24 = Math.floor(safe / 60) % 24;
  const minute = safe % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
};

const addMinutesToTimeLabel = (label: string, delta: number) => {
  const minutes = timeToMinutes(label);
  if (!Number.isFinite(minutes)) return label;
  return formatMinutesToLabel(minutes + delta);
};

const getSlotEndTimeLabel = (label: string) => {
  const minutes = timeToMinutes(label);
  if (!Number.isFinite(minutes)) return label;
  return formatMinutesToLabel(minutes === 23 * 60 ? minutes + 59 : minutes + 60);
};

const hasUnavailableMarker = (slots: any[]) =>
  Array.isArray(slots) &&
  slots.some((slot) => {
    if (typeof slot === "string") return slot.trim() === UNAVAILABLE_TIME_SENTINEL;
    const values = [
      slot?.time,
      slot?.start_time,
      slot?.end_time,
      slot?.start,
      slot?.end,
      slot?.finish_time,
    ];
    return values.some((value) => String(value || "").trim() === UNAVAILABLE_TIME_SENTINEL);
  });

const getWeeklySlotsForDate = (
  dateKey: string,
  weeklyTimesByDay: Record<string, string[]>
): CalendarSlotRange[] => {
  const base = new Date(dateKey);
  if (Number.isNaN(base.getTime())) return [];
  return (weeklyTimesByDay[getDayName(base)] || []).map((time) => ({
    start_time: time,
    end_time: getSlotEndTimeLabel(time),
  }));
};

const normalizeCalendarRanges = (slots: any[]): CalendarSlotRange[] => {
  if (!Array.isArray(slots)) return [];
  const normalized = slots
    .map((slot) => {
      if (typeof slot === "string") {
        if (slot.trim() === UNAVAILABLE_TIME_SENTINEL) return null;
        return {
          start_time: slot,
          end_time: getSlotEndTimeLabel(slot),
        };
      }
      const start = String(slot?.start_time || slot?.start || slot?.time || "").trim();
      const end = String(slot?.end_time || slot?.end || slot?.finish_time || "").trim();
      if (start === UNAVAILABLE_TIME_SENTINEL) return null;
      if (!start) return null;
      return {
        start_time: start,
        end_time: end || getSlotEndTimeLabel(start),
      };
    })
    .filter((slot): slot is CalendarSlotRange => {
      if (!slot) return false;
      return timeToMinutes(slot.end_time) > timeToMinutes(slot.start_time);
    });

  const unique = new Map<string, CalendarSlotRange>();
  normalized.forEach((slot) => {
    unique.set(`${slot.start_time}|${slot.end_time}`, slot);
  });
  return Array.from(unique.values()).sort(
    (a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
  );
};

const formatRangeLabel = (startMinutes: number, endMinutes: number) => {
  const start = formatMinutesToLabel(startMinutes);
  const end = formatMinutesToLabel(endMinutes);

  const startMatch = start.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  const endMatch = end.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!startMatch || !endMatch) return `${start} - ${end}`;

  const [, startHour, startMinuteRaw = "00", startSuffix] = startMatch;
  const [, endHour, endMinuteRaw = "00", endSuffix] = endMatch;
  const startMinute = Number(startMinuteRaw);
  const endMinute = Number(endMinuteRaw);

  const startText = startMinute === 0 ? `${startHour}` : `${startHour}:${startMinuteRaw}`;
  const endText = endMinute === 0 ? `${endHour}` : `${endHour}:${endMinuteRaw}`;

  if (startSuffix.toUpperCase() === endSuffix.toUpperCase()) {
    return `${startText}-${endText}${endSuffix.toUpperCase()}`;
  }
  return `${startText}${startSuffix.toUpperCase()}-${endText}${endSuffix.toUpperCase()}`;
};

const buildCalendarDisplayRanges = (slots: CalendarSlotRange[]) => {
  const normalized = normalizeCalendarRanges(slots);
  if (!normalized.length) return [];

  const groups: {
    start: number;
    end: number;
    label: string;
    slots: CalendarSlotRange[];
  }[] = [];

  let currentSlots: CalendarSlotRange[] = [normalized[0]];
  let currentStart = timeToMinutes(normalized[0].start_time);
  let currentEnd = timeToMinutes(normalized[0].end_time);

  for (let i = 1; i < normalized.length; i += 1) {
    const slot = normalized[i];
    const start = timeToMinutes(slot.start_time);
    const end = timeToMinutes(slot.end_time);

    if (start === currentEnd) {
      currentSlots.push(slot);
      currentEnd = end;
      continue;
    }

    groups.push({
      start: currentStart,
      end: currentEnd,
      label: formatRangeLabel(currentStart, currentEnd),
      slots: currentSlots,
    });

    currentSlots = [slot];
    currentStart = start;
    currentEnd = end;
  }

  groups.push({
    start: currentStart,
    end: currentEnd,
    label: formatRangeLabel(currentStart, currentEnd),
    slots: currentSlots,
  });

  return groups;
};

const isDateLike = (value: string) => {
  if (!value) return false;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  // Contains digits and likely a date string
  return /\d{4}/.test(value) && (value.includes("-") || value.includes("/"));
};

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

  container: {
    padding: rs(20),
    paddingBottom: rs(40),
  },

  headerCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    padding: rs(20),
    borderRadius: rs(20),
    marginBottom: rs(20),
    elevation: 5,
  },
  headerIcon: {
    width: rs(48),
    height: rs(48),
    borderRadius: rs(24),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
  },
  headerDesc: {
    fontSize: rf(12),
    color: "#AD1457",
    flexShrink: 1,
    lineHeight: rs(18),
  },

  modeToggle: {
    flexDirection: "row",
    backgroundColor: "#FFE7F0",
    borderRadius: rs(12),
    padding: rs(4),
    marginBottom: rs(14),
  },
  modeBtn: {
    flex: 1,
    paddingVertical: rs(10),
    alignItems: "center",
    borderRadius: rs(10),
  },
  modeBtnActive: {
    backgroundColor: "#FF80AB",
  },
  modeText: {
    color: "#AD1457",
    fontWeight: "700",
  },
  modeTextActive: {
    color: "#fff",
  },

  sectionTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(10),
  },

  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: rs(20),
  },

  dayChip: {
    borderWidth: 1,
    borderColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: rs(10),
    paddingHorizontal: rs(14),
    margin: rs(5),
  },
  dayChipActive: {
    backgroundColor: "#FF80AB",
  },
  dayText: {
    color: "#880E4F",
    fontWeight: "600",
  },
  dayTextActive: {
    color: "#fff",
  },

  dayCard: {
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
    marginBottom: rs(20),
    elevation: 3,
  },
  dayHeader: {
    flexDirection: "row",
    marginBottom: rs(12),
  },
  dayTitle: {
    flex: 1,
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
  },

  quickRow: {
    flexDirection: "row",
  },
  quickBtn: {
    marginLeft: rs(6),
    padding: rs(6),
    borderRadius: rs(6),
    backgroundColor: "#FF80AB20",
  },
  quickClear: {
    backgroundColor: "#FFD1E3",
  },
  quickText: {
    color: "#FF80AB",
    fontWeight: "700",
  },
  quickTextClear: {
    color: "#880E4F",
  },

  periodTitle: {
    fontWeight: "600",
    color: "#AD1457",
    marginBottom: rs(6),
  },
  timeWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  timeChip: {
    borderWidth: 1,
    borderColor: "#FF80AB",
    borderRadius: rs(20),
    paddingVertical: rs(8),
    paddingHorizontal: rs(12),
    margin: rs(4),
  },
  timeChipActive: {
    backgroundColor: "#FF80AB",
  },
  timeText: {
    color: "#880E4F",
    fontWeight: "600",
  },
  timeTextActive: {
    color: "#fff",
  },

  calendarCard: {
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
    marginBottom: rs(20),
    elevation: 3,
    gap: rs(12),
  },
  calendarDesc: {
    color: "#AD1457",
  },
  calendarMonthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(4),
  },
  calendarMonthText: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
  },
  calendarWeekRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: rs(6),
  },
  calendarWeekText: {
    width: "14.28%",
    textAlign: "center",
    fontSize: rf(11),
    color: "#AD1457",
    fontWeight: "700",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: rs(4),
  },
  calendarCell: {
    width: "14.28%",
    alignItems: "center",
    paddingVertical: rs(6),
  },
  calendarDayCircle: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  calendarDayToday: {
    backgroundColor: "#FFEB3B",
    borderWidth: 1,
    borderColor: "#FBC02D",
  },
  calendarDayHasSlot: {
    backgroundColor: "#FFE7F0",
    borderWidth: 1,
    borderColor: "#FF80AB",
  },
  calendarDaySelected: {
    backgroundColor: "#FF80AB",
    borderWidth: 0,
  },
  calendarDayText: {
    color: "#880E4F",
    fontWeight: "700",
    fontSize: rf(12),
  },
  calendarDayTextToday: {
    color: "#5D4037",
  },
  calendarDayTextSelected: {
    color: "#fff",
  },
  calendarDot: {
    position: "absolute",
    top: rs(4),
    right: rs(4),
    width: rs(6),
    height: rs(6),
    borderRadius: rs(3),
    backgroundColor: "#FF80AB",
  },
  calendarActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  addDateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
    backgroundColor: "#FF80AB",
    paddingVertical: rs(10),
    paddingHorizontal: rs(12),
    borderRadius: rs(12),
  },
  addDateText: { color: "#fff", fontWeight: "700" },
  clearCalendar: {
    color: "#880E4F",
    fontWeight: "700",
  },
  emptyCalendar: {
    color: "#AD1457",
  },
  dateCard: {
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.3)",
    borderRadius: rs(12),
    padding: rs(12),
    marginTop: rs(6),
  },
  dateHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(10),
  },
  dateTitle: {
    fontWeight: "700",
    color: "#880E4F",
  },
  addTimeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(4),
    paddingHorizontal: rs(8),
    paddingVertical: rs(6),
    backgroundColor: "#FFE7F0",
    borderRadius: rs(8),
  },
  addTimeText: {
    color: "#FF80AB",
    fontWeight: "700",
  },
  inlinePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    flexWrap: "wrap",
  },
  nativePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(10),
    flexWrap: "wrap",
  },
  selectorBox: {
    flex: 1,
    paddingVertical: rs(12),
    paddingHorizontal: rs(12),
    backgroundColor: "#FFE7F0",
    borderRadius: rs(12),
  },
  webNativeInput: {
    width: "100%",
    padding: rs(8),
    borderWidth: 0,
    outlineWidth: 0,
    outlineColor: "transparent",
    fontSize: rf(14),
    color: "#880E4F",
    backgroundColor: "transparent",
  } as any,
  hiddenWebInput: {
    position: "absolute",
    opacity: 0,
    width: rs(1),
    height: rs(1),
    borderWidth: 0,
    padding: rs(0),
  } as any,
  slotChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFE7F0",
    paddingHorizontal: rs(10),
    paddingVertical: rs(8),
    borderRadius: rs(16),
    margin: rs(4),
    gap: rs(6),
  },
  slotText: {
    color: "#880E4F",
    fontWeight: "700",
  },
  removeChipBtn: {
    padding: rs(2),
  },

  saveBtn: {
    marginTop: rs(10),
    backgroundColor: "#FF80AB",
    padding: rs(16),
    borderRadius: rs(16),
    alignItems: "center",
    elevation: 6,
  },
  saveText: {
    color: "#fff",
    fontSize: rf(16),
    fontWeight: "700",
  },
});
