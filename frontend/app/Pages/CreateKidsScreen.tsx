import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hp, rf, rs, wp } from "../utils/responsive";

/* =========================
   CONFIG
========================= */

import { useManageChildStore } from "./manageChildStore";

/* =========================
   SCREEN
========================= */

const CreateKidsScreen = ({
  onBack = () => {},
  onDone,
  onSuccess,
}: {
  onBack?: () => void;
  onDone?: () => void;
  onSuccess?: () => void;
}) => {
  const insets = useSafeAreaInsets();
  const { addChild, loadChildren, kids } = useManageChildStore();
  const [name, setName] = useState("");
  const [ageText, setAgeText] = useState("");
  const [gender, setGender] = useState("");
  const [allergies, setAllergies] = useState("");
  const [medical, setMedical] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingMode, setSavingMode] = useState<"continue" | "another" | null>(null);

  const showError = (msg: string) => Alert.alert("Error", msg);
  const showNotice = (title: string, msg: string) =>
    Alert.alert(title, msg);

  const clearForm = () => {
    setName("");
    setAgeText("");
    setGender("");
    setAllergies("");
    setMedical("");
    setNotes("");
  };

  const handleAgeInput = (text: string) => {
    const numeric = text.replace(/\D/g, "");
    setAgeText(numeric);
  };

  /* ---------- SAVE ---------- */
  const saveChild = async () => {
    const trimmedName = name.trim();
    const trimmedAge = ageText.trim();
    const trimmedGender = gender.trim();
    const trimmedAllergies = allergies.trim();
    const trimmedMedical = medical.trim();
    const trimmedNotes = notes.trim();

    const hasAnyData =
      trimmedName ||
      trimmedAge ||
      trimmedGender ||
      trimmedAllergies ||
      trimmedMedical ||
      trimmedNotes;

    if (!hasAnyData) {
      showNotice("Saved", "No child info added, continuing.");
      return true;
    }

    let ageNum: number | undefined;
    if (trimmedAge) {
      const parsed = Number.parseInt(trimmedAge, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        showError("Please enter a valid age");
        return false;
      }
      ageNum = parsed;
    }

    setLoading(true);
    try {
      const ok = await addChild({
        name: trimmedName,
        age: ageNum,
        gender: trimmedGender,
        allergies: trimmedAllergies,
        medicalConditions: trimmedMedical,
        anythingElse: trimmedNotes,
      });
      if (!ok) {
        showError("Could not save child profile");
        return false;
      }
      await loadChildren();
      showNotice("Success", "Child profile saved");
      return true;
    } catch (err: any) {
      showError(err?.message || "Could not save child profile");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAndContinue = async () => {
    if (loading) return;
    setSavingMode("continue");
    const ok = await saveChild();
    setSavingMode(null);
    if (ok) {
      if (onDone) onDone();
      else if (onSuccess) onSuccess();
    }
  };

  const handleAddAnother = async () => {
    if (loading) return;
    setSavingMode("another");
    const ok = await saveChild();
    setSavingMode(null);
    if (ok) {
      clearForm();
      showNotice("Success", "Child added. You can add another.");
    }
  };

  /* =========================
     UI
  ========================= */

  return (
    <LinearGradient
      colors={["#FFFFFF", "#FFFFFF", "#FFFFFF"]}
      style={styles.container}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          <View style={[styles.headerRow, { paddingTop: insets.top }]}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={22} color="#FF80AB" />
            </TouchableOpacity>
            <Text style={styles.title}>Add Child Profile</Text>
            <View style={styles.headerSpacer} />
          </View>

          <Text style={styles.subtitle}>
            All fields are optional - you can add children later
          </Text>
          <Text style={styles.subtitleSmall}>Current kids: {kids.length}</Text>

          {/* Name */}
          <Input
            icon="person-outline"
            placeholder="Child name (optional)"
            value={name}
            onChangeText={setName}
            accessibilityLabel="Child name"
          />

          {/* Age */}
          <Input
            icon="calendar-outline"
            placeholder="Age (optional)"
            value={ageText}
            onChangeText={handleAgeInput}
            keyboardType="numeric"
            accessibilityLabel="Child age"
          />

          {/* Gender */}
          <View style={styles.genderRow}>
            <Ionicons
              name="male-female-outline"
              size={20}
              color="#FF80AB"
              style={{ marginRight: rs(6) }}
            />
            {["Male", "Female", "Other"].map((g) => {
              const active = gender === g;
              return (
                <TouchableOpacity
                  key={g}
                  style={[styles.genderChip, active && styles.genderChipActive]}
                  onPress={() => setGender(g)}
                  accessibilityRole="button"
                  accessibilityLabel={`Select gender ${g}`}
                >
                  <Text
                    style={[
                      styles.genderText,
                      active && styles.genderTextActive,
                    ]}
                  >
                    {g}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Allergies */}
          <Input
            icon="restaurant-outline"
            placeholder="Allergies / diet (optional)"
            value={allergies}
            onChangeText={setAllergies}
            accessibilityLabel="Allergies or diet"
          />

          {/* Medical */}
          <Input
            icon="medkit-outline"
            placeholder="Medical conditions (optional)"
            value={medical}
            onChangeText={setMedical}
            accessibilityLabel="Medical conditions"
          />

          {/* Notes */}
          <Input
            icon="create-outline"
            placeholder="Additional notes (optional)"
            value={notes}
            onChangeText={setNotes}
            multiline
            height={90}
            accessibilityLabel="Additional notes"
          />

          {/* Buttons */}
          <TouchableOpacity
            style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
            onPress={handleSaveAndContinue}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Save child and continue"
          >
            {loading && savingMode === "continue" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>Save & Continue</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, loading && { opacity: 0.7 }]}
            onPress={handleAddAnother}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Save child and add another"
          >
            {loading && savingMode === "another" ? (
              <ActivityIndicator color="#FF80AB" />
            ) : (
              <Text style={styles.secondaryText}>Add Child & Add Another</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: rs(40) }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

export default CreateKidsScreen;

/* =========================
   INPUT COMPONENT
========================= */

const Input = ({
  icon,
  placeholder,
  value,
  onChangeText,
  keyboardType = "default",
  multiline = false,
  height = 54,
  accessibilityLabel,
}: any) => (
  <View style={[styles.inputWrap, { height }]}>
    <Ionicons
      name={icon}
      size={20}
      color="#FF80AB"
      style={{ marginHorizontal: rs(12) }}
    />
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#AD1457"
      keyboardType={keyboardType}
      multiline={multiline}
      style={styles.input}
      accessibilityLabel={accessibilityLabel}
    />
  </View>
);

/* =========================
   STYLES
========================= */

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: rs(24), paddingBottom: rs(24), paddingTop: rs(4) },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(10),
  },
  headerSpacer: {
    width: rs(42),
    height: rs(42),
  },

  backBtn: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(21),
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },

  title: {
    fontSize: rf(26),
    fontWeight: "700",
    color: "#880E4F",
    textAlign: "center",
  },

  subtitle: {
    marginTop: rs(6),
    fontSize: rf(14),
    color: "#AD1457",
    marginBottom: rs(20),
  },
  subtitleSmall: {
    fontSize: rf(12),
    color: "#AD1457",
    marginBottom: rs(12),
  },

  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB",
    marginBottom: rs(14),
  },

  input: {
    flex: 1,
    fontSize: rf(15),
    color: "#4A0033",
  },

  genderRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB",
    padding: rs(10),
    marginBottom: rs(14),
    flexWrap: "wrap",
  },

  genderChip: {
    paddingHorizontal: rs(12),
    paddingVertical: rs(8),
    borderRadius: rs(20),
    backgroundColor: "#FF80AB20",
    marginRight: rs(8),
    marginTop: rs(6),
  },

  genderChipActive: {
    backgroundColor: "#FF80AB",
  },

  genderText: {
    color: "#FF80AB",
    fontWeight: "600",
  },

  genderTextActive: {
    color: "#fff",
  },

  primaryBtn: {
    height: rs(56),
    borderRadius: rs(16),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    marginTop: rs(10),
  },

  primaryText: {
    color: "#fff",
    fontSize: rf(16),
    fontWeight: "700",
  },

  secondaryBtn: {
    height: rs(56),
    borderRadius: rs(16),
    borderWidth: 2,
    borderColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: rs(14),
    backgroundColor: "#fff",
  },

  secondaryText: {
    color: "#FF80AB",
    fontSize: rf(16),
    fontWeight: "700",
  },
});
