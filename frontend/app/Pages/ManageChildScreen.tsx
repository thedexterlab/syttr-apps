import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { rf, rs } from "../utils/responsive";
import AddEditChildSheet from "./AddEditChildSheet";
import { Kid, useManageChildStore } from "./manageChildStore";

type Props = {
  navigation?: { goBack?: () => void };
  onBack?: () => void;
  onRequireVerification?: () => void;
};

export default function ManageChildScreen({ navigation, onBack, onRequireVerification }: Props) {
  const {
    kids,
    addChild,
    editChild,
    removeChild,
    isLoading,
    isAdding,
    isEditing,
    isDeleting,
  } = useManageChildStore(onRequireVerification);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [selected, setSelected] = useState<{ kid?: Kid; index?: number }>({});
  const childList = useMemo(() => (Array.isArray(kids) ? kids : []), [kids]);

  const openAdd = () => {
    setSelected({});
    setSheetVisible(true);
  };

  const openEdit = (kid: Kid, index: number) => {
    setSelected({ kid, index });
    setSheetVisible(true);
  };

  const closeSheet = () => {
    setSheetVisible(false);
    setSelected({});
  };

  const renderChild = useCallback(
    ({ item, index }: { item: Kid; index: number }) => (
      <TouchableOpacity
        style={styles.childCard}
        activeOpacity={0.8}
        onPress={() => openEdit(item, index)}
      >
        <View style={styles.childAvatar}>
          <Text style={styles.childInitial}>
            {(item.name?.trim()?.[0] || "K").toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.childName}>{item.name || "Child"}</Text>
          <Text style={styles.childMeta}>
            {item.gender || "N/A"} - {item.age || "Age N/A"}
          </Text>
          {!!item.allergies && (
            <Text style={styles.childNote}>Allergies: {item.allergies}</Text>
          )}
          {!!item.medicalConditions && (
            <Text style={styles.childNote}>
              Medical: {item.medicalConditions}
            </Text>
          )}
        </View>
        <Ionicons name="create-outline" size={18} color="#C2185B" />
      </TouchableOpacity>
    ),
    []
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (onBack) {
              onBack();
              return;
            }
            navigation?.goBack?.();
          }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={20} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Children</Text>
        <View style={{ width: rs(36) }} />
      </View>

      <FlatList
        contentContainerStyle={[
          styles.list,
          childList.length === 0 && styles.listEmpty,
        ]}
        data={childList}
        keyExtractor={(item, idx) =>
          item.id !== undefined ? String(item.id) : String(idx)
        }
        renderItem={renderChild}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.feedbackState}>
              <ActivityIndicator size="small" color="#C2185B" />
              <Text style={styles.feedbackText}>Loading children...</Text>
            </View>
          ) : (
            <Text style={styles.empty}>No children added yet.</Text>
          )
        }
      />

      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Ionicons name="add" size={22} color="#fff" />
        <Text style={styles.addText}>Add Child</Text>
      </TouchableOpacity>

      <AddEditChildSheet
        visible={sheetVisible}
        onClose={closeSheet}
        child={selected.kid}
        index={selected.index}
        addChild={addChild}
        editChild={editChild}
        removeChild={removeChild}
        isAdding={isAdding}
        isEditing={isEditing}
        isDeleting={isDeleting}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  header: {
    backgroundColor: "rgba(255,255,255,0.9)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(14),
    borderBottomLeftRadius: rs(18),
    borderBottomRightRadius: rs(18),
    elevation: 2,
  },
  backBtn: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    backgroundColor: "#FFE89A",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: "#C77A00", fontSize: rf(18), fontWeight: "700" },
  list: {
    padding: rs(16),
  },
  listEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },
  childCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: rs(14),
    borderRadius: rs(14),
    marginBottom: rs(10),
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: rs(0), height: rs(3) },
    elevation: 2,
  },
  childAvatar: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(21),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(12),
  },
  childInitial: { color: "#fff", fontWeight: "700" },
  childName: { fontSize: rf(15), fontWeight: "700", color: "#880E4F" },
  childMeta: { fontSize: rf(12), color: "#AD1457" },
  childNote: { fontSize: rf(11), color: "#9B3F67", marginTop: rs(2) },
  empty: {
    textAlign: "center",
    color: "#AD1457",
  },
  feedbackState: {
    alignItems: "center",
    justifyContent: "center",
    gap: rs(10),
  },
  feedbackText: {
    color: "#AD1457",
    fontSize: rf(13),
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF80AB",
    paddingVertical: rs(14),
    margin: rs(16),
    borderRadius: rs(14),
    gap: rs(8),
    shadowColor: "#FF80AB",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: rs(0), height: rs(4) },
    elevation: 4,
  },
  addText: { color: "#fff", fontWeight: "700", fontSize: rf(15) },
});
