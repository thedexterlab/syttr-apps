import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { rf, rs } from "../utils/responsive";
import { Kid } from "./manageChildStore";

type Props = {
  visible: boolean;
  onClose: () => void;
  child?: Kid;
  index?: number;
  addChild: (kid: Kid) => Promise<boolean>;
  editChild: (index: number, kid: Kid) => Promise<boolean>;
  removeChild: (index: number, kid?: Kid) => Promise<boolean>;
  isAdding?: boolean;
  isEditing?: boolean;
  isDeleting?: boolean;
};

type FormState = {
  name: string;
  age: string;
  gender: string;
  allergies: string;
  medicalConditions: string;
  anythingElse: string;
};

const emptyForm: FormState = {
  name: "",
  age: "",
  gender: "",
  allergies: "",
  medicalConditions: "",
  anythingElse: "",
};

export default function AddEditChildSheet({
  visible,
  onClose,
  child,
  index,
  addChild,
  editChild,
  removeChild,
  isAdding,
  isEditing,
  isDeleting,
}: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const isEditMode = useMemo(() => child !== undefined && index !== undefined, [child, index]);

  useEffect(() => {
    if (!visible) return;
    setForm({
      name: String(child?.name || ""),
      age: String(child?.age || ""),
      gender: String(child?.gender || ""),
      allergies: String(child?.allergies || ""),
      medicalConditions: String(child?.medicalConditions || ""),
      anythingElse: String(child?.anythingElse || ""),
    });
  }, [visible, child]);

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSave = async () => {
    const payload: Kid = {
      ...child,
      name: form.name.trim(),
      age: form.age.trim(),
      gender: form.gender.trim(),
      allergies: form.allergies.trim(),
      medicalConditions: form.medicalConditions.trim(),
      anythingElse: form.anythingElse.trim(),
    };

    if (!payload.name) return;

    const ok = isEditMode && index !== undefined
      ? await editChild(index, payload)
      : await addChild(payload);
    if (ok) onClose();
  };

  const onDelete = async () => {
    if (!isEditMode || index === undefined) return;
    const ok = await removeChild(index, child);
    if (ok) onClose();
  };

  const busy = Boolean(isAdding || isEditing || isDeleting);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{isEditMode ? "Edit Child" : "Add Child"}</Text>
            <TouchableOpacity onPress={onClose} disabled={busy}>
              <Ionicons name="close" size={22} color="#880E4F" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Field
              label="Name"
              value={form.name}
              onChangeText={(text) => updateField("name", text)}
              placeholder="Child name"
            />
            <Field
              label="Age"
              value={form.age}
              onChangeText={(text) => updateField("age", text.replace(/[^0-9]/g, ""))}
              placeholder="Age"
              keyboardType="number-pad"
            />
            <Field
              label="Gender"
              value={form.gender}
              onChangeText={(text) => updateField("gender", text)}
              placeholder="Gender"
            />
            <Field
              label="Allergies"
              value={form.allergies}
              onChangeText={(text) => updateField("allergies", text)}
              placeholder="Any allergies"
            />
            <Field
              label="Medical Conditions"
              value={form.medicalConditions}
              onChangeText={(text) => updateField("medicalConditions", text)}
              placeholder="Any medical conditions"
            />
            <Field
              label="Notes"
              value={form.anythingElse}
              onChangeText={(text) => updateField("anythingElse", text)}
              placeholder="Anything else"
              multiline
            />
          </ScrollView>

          <View style={styles.actions}>
            {isEditMode ? (
              <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} disabled={busy}>
                {isDeleting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.deleteText}>Delete</Text>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.saveBtn} onPress={onSave} disabled={busy || !form.name.trim()}>
              {isAdding || isEditing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveText}>{isEditMode ? "Save Changes" : "Add Child"}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  multiline,
  ...props
}: {
  label: string;
  multiline?: boolean;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "number-pad";
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline]}
        placeholderTextColor="#B07A8E"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.28)",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "90%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: rs(20),
    borderTopRightRadius: rs(20),
    paddingHorizontal: rs(16),
    paddingBottom: rs(16),
  },
  handle: {
    alignSelf: "center",
    marginTop: rs(10),
    width: rs(44),
    height: rs(5),
    borderRadius: rs(3),
    backgroundColor: "#F2D2DE",
  },
  header: {
    marginTop: rs(10),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    color: "#880E4F",
    fontSize: rf(18),
    fontWeight: "700",
  },
  content: {
    paddingTop: rs(10),
    paddingBottom: rs(6),
  },
  fieldWrap: {
    marginBottom: rs(10),
  },
  fieldLabel: {
    marginBottom: rs(4),
    color: "#8B5E00",
    fontSize: rf(12),
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: "#FFD5E5",
    borderRadius: rs(10),
    paddingHorizontal: rs(10),
    paddingVertical: rs(10),
    color: "#4A0033",
    backgroundColor: "#FFF8FB",
  },
  inputMultiline: {
    minHeight: rs(72),
    textAlignVertical: "top",
  },
  actions: {
    marginTop: rs(8),
    flexDirection: "row",
    gap: rs(8),
  },
  deleteBtn: {
    flex: 1,
    height: rs(46),
    borderRadius: rs(12),
    backgroundColor: "#D84A70",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  saveBtn: {
    flex: 2,
    height: rs(46),
    borderRadius: rs(12),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
