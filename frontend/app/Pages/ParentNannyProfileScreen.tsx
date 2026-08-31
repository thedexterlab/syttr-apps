import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { rf, rs } from "../utils/responsive";

type Props = {
  nanny?: any;
  onBack?: () => void;
};

const hasValue = (value: any) =>
  value !== undefined && value !== null && String(value).trim() !== "";

const InfoRow = ({ label, value }: { label: string; value: any }) => {
  if (!hasValue(value)) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{String(value)}</Text>
    </View>
  );
};

const formatAvailabilitySlot = (slot: any) => {
  const start = String(slot?.start_time || slot?.start || slot?.time || "").trim();
  const end = String(slot?.end_time || slot?.end || "").trim();
  if (start && end) return `${start} - ${end}`;
  return start || end;
};

const normalizeAvailability = (profile: any) => {
  const raw = profile?.availability_slots || profile?.availability || [];
  return Array.isArray(raw)
    ? raw
        .map((entry: any) => {
          const day = String(entry?.day || entry?.date || "").trim();
          const slots = Array.isArray(entry?.slots)
            ? entry.slots
            : Array.isArray(entry?.time_slots)
            ? entry.time_slots
            : [];
          const labels = slots.map(formatAvailabilitySlot).filter(Boolean);
          return day && labels.length ? { day, labels } : null;
        })
        .filter(Boolean)
    : [];
};

export default function ParentNannyProfileScreen({ nanny, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [selfNanny, setSelfNanny] = useState<any | null>(null);
  const profile = useMemo(() => nanny || selfNanny || {}, [nanny, selfNanny]);

  useEffect(() => {
    if (nanny) return;
    const loadSelf = async () => {
      const entries = await AppStorage.multiGet([
        "nanny_id",
        "nanny_name",
        "user_name",
        "nanny_city",
        "nanny_country",
        "nanny_experience",
        "nanny_bio",
        "nanny_hourly_rate",
      ]);
      const map = Object.fromEntries(entries);
      setSelfNanny({
        id: map.nanny_id || undefined,
        fullname: map.nanny_name || map.user_name || undefined,
        city: map.nanny_city || undefined,
        country: map.nanny_country || undefined,
        experience: map.nanny_experience || undefined,
        bio: map.nanny_bio || undefined,
        hourly_rate: map.nanny_hourly_rate || undefined,
      });
    };
    void loadSelf();
  }, [nanny]);

  const name =
    profile?.fullname ||
    profile?.name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    (profile?.id ? `Syttr ${profile.id}` : "Syttr Profile");
  const availability = useMemo(() => normalizeAvailability(profile), [profile]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, rs(12)) }]}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Ionicons name="chevron-back" size={18} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Syttr Profile</Text>
        <View style={styles.backBtnGhost} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.name}>{name}</Text>
          <InfoRow label="Syttr ID" value={profile?.id || profile?.nanny_id} />
          <InfoRow label="City" value={profile?.city || profile?.city_area} />
          <InfoRow label="Country" value={profile?.country} />
          <InfoRow
            label="Experience"
            value={profile?.experience ? `${profile.experience} yrs` : null}
          />
          <InfoRow
            label="Hourly Rate"
            value={profile?.hourly_rate ? `$${profile.hourly_rate}/hr` : null}
          />
          <InfoRow label="Bio" value={profile?.bio} />
          {availability.length > 0 && (
            <View style={styles.availabilitySection}>
              <Text style={styles.availabilityTitle}>Availability</Text>
              {availability.map((entry: any) => (
                <View key={entry.day} style={styles.availabilityRow}>
                  <Text style={styles.availabilityDay}>{entry.day}</Text>
                  <Text style={styles.availabilityValue}>{entry.labels.join(", ")}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingBottom: rs(10),
  },
  backBtn: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(12),
    backgroundColor: "rgba(255,128,171,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnGhost: {
    width: rs(36),
    height: rs(36),
  },
  headerTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#C2185B",
  },
  content: {
    padding: rs(16),
  },
  card: {
    backgroundColor: "#FFF5F9",
    borderRadius: rs(16),
    borderWidth: 1,
    borderColor: "rgba(194,24,91,0.2)",
    padding: rs(14),
  },
  name: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(6),
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: rs(8),
    gap: rs(10),
  },
  infoLabel: {
    fontSize: rf(12),
    fontWeight: "700",
    color: "#AD1457",
  },
  infoValue: {
    flex: 1,
    textAlign: "right",
    fontSize: rf(12),
    color: "#6B4350",
    fontWeight: "600",
  },
  availabilitySection: {
    marginTop: rs(14),
    paddingTop: rs(12),
    borderTopWidth: 1,
    borderTopColor: "rgba(194,24,91,0.16)",
  },
  availabilityTitle: {
    fontSize: rf(13),
    fontWeight: "800",
    color: "#AD1457",
    marginBottom: rs(6),
  },
  availabilityRow: {
    marginTop: rs(6),
  },
  availabilityDay: {
    fontSize: rf(12),
    fontWeight: "800",
    color: "#880E4F",
  },
  availabilityValue: {
    marginTop: rs(2),
    fontSize: rf(12),
    color: "#6B4350",
    fontWeight: "600",
  },
});
