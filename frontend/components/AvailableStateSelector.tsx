import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getAvailableStates, type AvailableState } from "../app/_Api";

type Props = {
  value: string;
  onSelect: (code: string) => void;
  label?: string;
  onStatesLoaded?: (states: AvailableState[]) => void;
};

export default function AvailableStateSelector({
  value,
  onSelect,
  label = "State *",
  onStatesLoaded,
}: Props) {
  const [states, setStates] = useState<AvailableState[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const initialValue = useRef(value).current;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onStatesLoadedRef = useRef(onStatesLoaded);
  onStatesLoadedRef.current = onStatesLoaded;

  useEffect(() => {
    let active = true;
    getAvailableStates()
      .then((items) => {
        if (!active) return;
        setStates(items);
        onStatesLoadedRef.current?.(items);
        setError(items.length ? "" : "Signup is not currently available in any state.");
        if (items.length === 1 && !initialValue) onSelectRef.current(items[0].code);
      })
      .catch((requestError: any) => {
        if (active) setError(requestError?.message || "Unable to load available states.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [initialValue]);

  const visibleStates = useMemo(
    () => (expanded || states.length <= 3 ? states : states.slice(0, 3)),
    [expanded, states],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#FF80AB" />
          <Text style={styles.helpText}>Loading available states...</Text>
        </View>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <>
          <View style={styles.options}>
            {visibleStates.map((state) => {
              const selected = state.code === value;
              return (
                <TouchableOpacity
                  key={state.code}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => onSelect(state.code)}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {state.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {states.length > 3 ? (
            <TouchableOpacity onPress={() => setExpanded((current) => !current)}>
              <Text style={styles.moreText}>{expanded ? "See Less" : "See More"}</Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 14 },
  label: { color: "#7A2947", fontWeight: "600", marginBottom: 8 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  helpText: { color: "#8A6673" },
  errorText: { color: "#B42318" },
  options: { gap: 8 },
  option: {
    borderWidth: 1,
    borderColor: "#F2B6C9",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
  },
  optionSelected: { borderColor: "#FF80AB", backgroundColor: "#FFF0F5" },
  optionText: { color: "#532637" },
  optionTextSelected: { color: "#C2185B", fontWeight: "700" },
  moreText: { color: "#C2185B", fontWeight: "700", marginTop: 10 },
});
