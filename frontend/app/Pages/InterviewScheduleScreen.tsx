import { Fonts } from "@/constants/theme";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { hp, rf, rs, wp } from "../utils/responsive";
import { getRuntimeApiKey, scheduleNannyInterview } from "../Api";
import SafeScreen from "../components/SafeScreen";

type Props = {
  onBack?: () => void;
  onSuccess?: () => void;
  nannyId?: string | number;
};

const InterviewScheduleScreen: React.FC<Props> = ({ onBack, onSuccess, nannyId }) => {
  const [dateValue, setDateValue] = useState("");
  const [timeValue, setTimeValue] = useState("");
  const [pendingDate, setPendingDate] = useState<Date | null>(null);
  const [pendingTime, setPendingTime] = useState<Date | null>(null);
  const [draftDate, setDraftDate] = useState<Date>(new Date());
  const [draftTime, setDraftTime] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scheduledLabel, setScheduledLabel] = useState("");

  const formatDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;

  const formatTime = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  const formatDateDisplay = (value: string) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const localDate = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
      );
      return localDate.toLocaleDateString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  };

  const formatTimeDisplay = (value: string) => {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return value;
    const hour24 = Number(match[1]);
    const minute = match[2];
    if (!Number.isFinite(hour24)) return value;
    const suffix = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${minute} ${suffix}`;
  };

  const buildInterviewDateTime = () => {
    if (!dateValue || !timeValue) return null;
    const dateMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatch = timeValue.match(/^(\d{1,2}):(\d{2})$/);
    if (!dateMatch || !timeMatch) return null;
    const combined = new Date(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      Number(timeMatch[1]),
      Number(timeMatch[2]),
      0,
      0
    );
    return Number.isFinite(combined.getTime()) ? combined : null;
  };

  const parseStoredDate = () => {
    const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const parsed = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      0,
      0,
      0,
      0
    );
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };

  const parseStoredTime = () => {
    const match = timeValue.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const parsed = new Date();
    parsed.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };

  const openDatePicker = () => {
    setDraftDate(pendingDate || parseStoredDate() || new Date());
    setShowDatePicker(true);
  };

  const openTimePicker = () => {
    setDraftTime(pendingTime || parseStoredTime() || new Date());
    setShowTimePicker(true);
  };

  const applySelectedDate = (date?: Date) => {
    if (!date) return;

    setPendingDate(date);
    setDateValue(formatDate(date));

    // Reset time when date changes (important)
    setPendingTime(null);
    setTimeValue("");
  };

  const applySelectedTime = (date?: Date) => {
    if (!date) return;
    const selectedDate =
      pendingDate ||
      (dateValue
        ? (() => {
            const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) return null;
            return new Date(
              Number(match[1]),
              Number(match[2]) - 1,
              Number(match[3])
            );
          })()
        : null);
    const now = new Date();
    if (selectedDate && selectedDate.toDateString() === now.toDateString()) {
      const candidate = new Date(now);
      candidate.setHours(date.getHours(), date.getMinutes(), 0, 0);
      if (candidate <= now) {
        Alert.alert("Invalid time", "Please choose a future time.");
        return;
      }
    }

    setPendingTime(date);
    setTimeValue(formatTime(date));
  };

  const handleDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "ios") {
      if (date) setDraftDate(date);
      return;
    }

    setShowDatePicker(false);
    if (event.type === "dismissed") return;
    applySelectedDate(date);
  };

  const handleTimeChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "ios") {
      if (date) setDraftTime(date);
      return;
    }

    setShowTimePicker(false);
    if (event.type === "dismissed") return;
    applySelectedTime(date);
  };

  const submit = async () => {
    if (!dateValue || !timeValue) {
      Alert.alert("Missing info", "Please select both a date and time.");
      return;
    }

    const interviewDateTime = buildInterviewDateTime();
    const now = new Date();

    if (!interviewDateTime || interviewDateTime <= now) {
      Alert.alert(
        "Invalid time",
        "Please select a future date and time for the interview."
      );
      return;
    }

    if (loading) return;
    setLoading(true);

    try {
      const tokenRaw = await AsyncStorage.getItem("token");
      const token = tokenRaw ? tokenRaw.replace(/^Bearer\s+/i, "").replace(/"/g, "").trim() : "";
      const storedApiKey = await AsyncStorage.getItem("api_key");
      const apiKey = (storedApiKey ? String(storedApiKey).replace(/"/g, "").trim() : "") || getRuntimeApiKey();

      const [storedNannyId, storedUserId] = await Promise.all([
        AsyncStorage.getItem("nanny_id"),
        AsyncStorage.getItem("user_id"),
      ]);
      const effectiveNannyId = String(nannyId || storedNannyId || storedUserId || "").trim();
      if (!effectiveNannyId) {
        Alert.alert("Missing info", "Nanny ID not found. Please log in again.");
        return;
      }

      await scheduleNannyInterview(
        {
          nanny_id: effectiveNannyId,
          interview_date: dateValue,
          interview_time: timeValue,
        },
        token || undefined,
        apiKey || undefined
      );

      const label = `${formatDateDisplay(dateValue)} at ${formatTimeDisplay(timeValue)}`;
      setScheduledLabel(label);
      Alert.alert("Saved", `Interview scheduled for ${label}.`);

      onSuccess?.();
    } catch (err: any) {
      console.error("Interview scheduling failed:", err);
      Alert.alert("Error", err?.message || "Could not schedule interview.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeScreen edges={["top", "right", "bottom", "left"]} style={{ backgroundColor: "#FFFFFF" }}>
      <LinearGradient
      colors={["#FFFFFF", "#FFFFFF", "#FFFFFF"]}
      style={styles.container}
      >
      <View style={styles.topHeader}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={rs(20)} color="#FF80AB" />
        </TouchableOpacity>
        <View style={styles.titleCenter}>
          <Text style={styles.title}>Schedule Interview</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.subtitle}>
          Pick a date and time that works for you.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Date</Text>

          {Platform.OS === "web" ? (
            <input
              type="date"
              value={dateValue}
              min={formatDate(new Date())}
              onChange={(e) => {
                setDateValue(e.target.value);
                setTimeValue("");
              }}
              style={styles.webInput as any}
            />
          ) : (
            <TouchableOpacity
              style={styles.input}
              onPress={openDatePicker}
              accessibilityRole="button"
              accessibilityLabel="Select interview date"
            >
              <Text style={styles.inputText}>
                {dateValue ? formatDateDisplay(dateValue) : "Select date"}
              </Text>
              <Ionicons
                name="calendar-outline"
                size={rs(18)}
                color="#FF80AB"
              />
            </TouchableOpacity>
          )}

          <Text style={[styles.label, { marginTop: rs(16) }]}>Time</Text>

          {Platform.OS === "web" ? (
            <input
              type="time"
              value={timeValue}
              min={
                dateValue === formatDate(new Date())
                  ? formatTime(new Date())
                  : undefined
              }
              onChange={(e) => setTimeValue(e.target.value)}
              style={styles.webInput as any}
            />
          ) : (
            <TouchableOpacity
              style={styles.input}
              onPress={openTimePicker}
              accessibilityRole="button"
              accessibilityLabel="Select interview time"
            >
              <Text style={styles.inputText}>
                {timeValue ? formatTimeDisplay(timeValue) : "Select time"}
              </Text>
              <Ionicons name="time-outline" size={rs(18)} color="#FF80AB" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.button, loading && { opacity: 0.7 }]}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel="Save interview schedule"
        >
          <Text style={styles.buttonText}>
            {loading ? "Saving..." : "Save Interview"}
          </Text>
        </TouchableOpacity>

        {scheduledLabel ? (
          <Text style={styles.scheduledText}>Interview scheduled on {scheduledLabel}</Text>
        ) : null}
      </ScrollView>

      {showDatePicker && Platform.OS !== "web" && (
        Platform.OS === "ios" ? (
          <Modal
            transparent
            animationType="fade"
            visible={showDatePicker}
            onRequestClose={() => setShowDatePicker(false)}
          >
            <View style={styles.pickerOverlay}>
              <View style={styles.pickerCard}>
                <Text style={styles.pickerTitle}>Select Date</Text>
                <DateTimePicker
                  value={draftDate}
                  mode="date"
                  minimumDate={new Date()}
                  display="spinner"
                  onChange={handleDateChange}
                />
                <View style={styles.pickerActions}>
                  <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                    <Text style={styles.pickerCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      applySelectedDate(draftDate);
                      setShowDatePicker(false);
                    }}
                  >
                    <Text style={styles.pickerOk}>OK</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={pendingDate || parseStoredDate() || new Date()}
            mode="date"
            minimumDate={new Date()}
            display="default"
            onChange={handleDateChange}
          />
        )
      )}

      {showTimePicker && Platform.OS !== "web" && (
        Platform.OS === "ios" ? (
          <Modal
            transparent
            animationType="fade"
            visible={showTimePicker}
            onRequestClose={() => setShowTimePicker(false)}
          >
            <View style={styles.pickerOverlay}>
              <View style={styles.pickerCard}>
                <Text style={styles.pickerTitle}>Select Time</Text>
                <DateTimePicker
                  value={draftTime}
                  mode="time"
                  display="spinner"
                  onChange={handleTimeChange}
                />
                <View style={styles.pickerActions}>
                  <TouchableOpacity onPress={() => setShowTimePicker(false)}>
                    <Text style={styles.pickerCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      applySelectedTime(draftTime);
                      setShowTimePicker(false);
                    }}
                  >
                    <Text style={styles.pickerOk}>OK</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={pendingTime || parseStoredTime() || new Date()}
            mode="time"
            display="default"
            onChange={handleTimeChange}
          />
        )
      )}
      </LinearGradient>
    </SafeScreen>
  );
};

export default InterviewScheduleScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: wp(5),
    paddingTop: rs(12),
    paddingBottom: hp(2),
  },
  topHeader: {
    backgroundColor: "#FFF3F8",
    borderBottomWidth: 1,
    borderBottomColor: "#FF80AB55",
    paddingHorizontal: wp(5),
    paddingVertical: rs(8),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerSpacer: {
    width: rs(44),
    height: rs(44),
  },
  backBtn: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  title: {
    fontSize: rf(24),
    fontWeight: "700",
    color: "#880E4F",
    fontFamily: Fonts.display,
  },
  titleCenter: {
    flex: 1,
    alignItems: "center",
  },
  subtitle: {
    fontSize: rf(13),
    color: "#AD1457",
    textAlign: "center",
    marginBottom: hp(2.2),
    fontFamily: Fonts.display,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: rs(14),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "#FF80AB",
  },
  label: {
    fontSize: rf(13),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(6),
    fontFamily: Fonts.display,
  },
  input: {
    backgroundColor: "#FFF7F2",
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB",
    padding: rs(14),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inputText: {
    color: "#4A0033",
    fontSize: rf(14),
    fontFamily: Fonts.display,
  },
  webInput: {
    width: "100%",
    backgroundColor: "#FFF7F2",
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB",
    padding: rs(14),
    fontSize: rf(14),
    color: "#4A0033",
    fontFamily: Fonts.display,
    outlineStyle: "none",
    boxSizing: "border-box",
  } as any,
  button: {
    marginTop: hp(2.2),
    backgroundColor: "#FF80AB",
    borderRadius: rs(14),
    paddingVertical: rs(14),
    alignItems: "center",
    elevation: 4,
  },
  buttonText: {
    color: "#fff",
    fontSize: rf(15),
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
  scheduledText: {
    marginTop: rs(12),
    color: "#880E4F",
    textAlign: "center",
    fontSize: rf(13),
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: rs(20),
  },
  pickerCard: {
    backgroundColor: "#fff",
    borderRadius: rs(18),
    padding: rs(16),
  },
  pickerTitle: {
    textAlign: "center",
    color: "#880E4F",
    fontSize: rf(16),
    fontWeight: "700",
    marginBottom: rs(8),
    fontFamily: Fonts.display,
  },
  pickerActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: rs(10),
  },
  pickerCancel: {
    color: "#AD1457",
    fontSize: rf(14),
    fontWeight: "600",
    fontFamily: Fonts.display,
  },
  pickerOk: {
    color: "#FF80AB",
    fontSize: rf(14),
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
});

