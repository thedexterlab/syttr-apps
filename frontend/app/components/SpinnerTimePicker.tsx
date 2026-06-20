import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import React, { useEffect, useState } from "react";
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

type Props = {
  visible: boolean;
  value: Date;
  title?: string;
  is24Hour?: boolean;
  inline?: boolean;
  onCancel: () => void;
  onConfirm: (value: Date) => void;
};

export default function SpinnerTimePicker({
  visible,
  value,
  title = "Select Time",
  is24Hour = false,
  inline = false,
  onCancel,
  onConfirm,
}: Props) {
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    if (visible) {
      setDraftValue(value);
    }
  }, [value, visible]);

  const handleChange = (event: DateTimePickerEvent, nextValue?: Date) => {
    if (Platform.OS === "ios") {
      if (nextValue) setDraftValue(nextValue);
      return;
    }

    if (event.type === "dismissed") {
      onCancel();
      return;
    }

    if (nextValue) {
      onConfirm(nextValue);
      return;
    }

    onCancel();
  };

  if (!visible || Platform.OS === "web") return null;

  if (Platform.OS !== "ios") {
    return (
      <DateTimePicker
        value={value}
        mode="time"
        display="default"
        is24Hour={is24Hour}
        themeVariant="light"
        accentColor="#C2185B"
        onChange={handleChange}
      />
    );
  }

  const content = (
    <View style={inline ? styles.inlineCard : styles.card}>
      <Text style={styles.title}>{title}</Text>
      <DateTimePicker
        value={draftValue}
        mode="time"
        display="spinner"
        is24Hour={is24Hour}
        themeVariant="light"
        textColor="#C2185B"
        accentColor="#C2185B"
        style={styles.picker}
        onChange={handleChange}
      />
      <View style={styles.actions}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onConfirm(draftValue)}>
          <Text style={styles.ok}>OK</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (inline) return content;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <View style={styles.overlay}>{content}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
  },
  inlineCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: "#F5B5C8",
  },
  title: {
    textAlign: "center",
    color: "#880E4F",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  picker: {
    height: 180,
    backgroundColor: "#FFFFFF",
    alignSelf: "stretch",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    paddingHorizontal: 10,
  },
  cancel: {
    color: "#C2185B",
    fontSize: 16,
    fontWeight: "600",
  },
  ok: {
    color: "#C2185B",
    fontSize: 16,
    fontWeight: "800",
  },
});
