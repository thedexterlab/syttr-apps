import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { getFavoriteSyttrs, isVerificationRequiredApiError, removeFavoriteSyttr } from "../Api";
import { resolveSessionImageUrl } from "../../lib/nannySessionProfile";
import { hp, rf, rs, wp } from "../utils/responsive";

type Nanny = {
  id: number | string;
  favorite_id?: number | string;
  syttr_user_id?: number | string;
  fullname?: string;
  name?: string;
  city?: string;
  experience?: number | string;
  age?: number | string;
  profile_image?: string | null;
};

type Props = {
  navigation?: any;
  onBack?: () => void;
  onOpenProfile?: (nanny: Nanny) => void;
  onRequireVerification?: () => void;
};

const FAVORITES_KEY = "favorite_nannies";
const normalizeFavorites = (rows: any[]): Nanny[] =>
  rows
    .map((item: any) => {
      const syttrUserId = item?.syttr_user_id ?? item?.id;
      return {
        id: syttrUserId,
        favorite_id: item?.favorite_id ?? item?.id,
        syttr_user_id: syttrUserId,
        fullname: item?.fullname || item?.name || "",
        name: item?.name || item?.fullname || "",
        city: item?.city || "",
        experience: item?.experience,
        age: item?.age,
        profile_image: item?.profile_image || null,
      } as Nanny;
    })
    .filter((item) => String(item.id || "").trim() !== "");

export default function FavoriteNanniesScreen({
  navigation,
  onBack,
  onOpenProfile,
  onRequireVerification,
}: Props) {
  const [favorites, setFavorites] = useState<Nanny[]>([]);

  const loadFavorites = useCallback(async () => {
    const [userId, token] = await Promise.all([
      AppStorage.getItem("user_id"),
      AppStorage.getItem("token"),
    ]);

    try {
      const remote = await getFavoriteSyttrs(userId || undefined, token || undefined);
      const rows = Array.isArray((remote as any)?.data)
        ? (remote as any).data
        : Array.isArray(remote)
          ? remote
          : [];
      const normalized = normalizeFavorites(rows);
      setFavorites(normalized);
      await AppStorage.setItem(FAVORITES_KEY, JSON.stringify(normalized));
      return;
    } catch (error) {
      if (isVerificationRequiredApiError(error)) {
        setFavorites([]);
        onRequireVerification?.();
        return;
      }
      // fallback to cache
    }

    try {
      const raw = await AppStorage.getItem(FAVORITES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const normalized = normalizeFavorites(Array.isArray(parsed) ? parsed : []);
      setFavorites(normalized);
    } catch {
      setFavorites([]);
    }
  }, [onRequireVerification]);

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  const removeFavorite = async (item: Nanny) => {
    const next = favorites.filter((row) => String(row.id) !== String(item.id));
    setFavorites(next);
    try {
      await AppStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      // ignore local cache write failures
    }

    try {
      const userId = await AppStorage.getItem("user_id");
      const token = await AppStorage.getItem("token");
      const targetId = item.favorite_id || item.syttr_user_id || item.id;
      if (targetId) {
        await removeFavoriteSyttr(
          targetId,
          userId ? { user_id: userId } : undefined,
          token || undefined
        );
      }
    } catch (error) {
      if (isVerificationRequiredApiError(error)) {
        onRequireVerification?.();
      }
      // server delete failure is ignored; local cache is already updated
    }
  };

  const renderItem = ({ item }: { item: Nanny }) => {
    const displayName = item.fullname || item.name || "Syttr";
    const initials = displayName.slice(0, 1).toUpperCase();
    const imagePath = item.profile_image || "";
    const avatarUrl = resolveSessionImageUrl(imagePath);

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.9}
        onPress={() => {
          if (onOpenProfile) onOpenProfile(item);
          else
            navigation?.navigate?.("NannyProfile", {
              id: item.id,
              nanny: item,
            });
        }}
      >
        <View style={styles.avatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{displayName}</Text>
          <Text style={styles.cardSubtitle}>
            {item.city || "City not set"}
          </Text>
          <Text style={styles.cardMeta}>
            {item.experience
              ? `${item.experience} yrs exp`
              : "Experience N/A"}{" "}
            - {item.age || "Age N/A"}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => removeFavorite(item)}
          style={styles.removeBtn}
        >
          <Ionicons name="heart" size={rs(18)} color="#FF80AB" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={styles.root}>
      <LinearGradient
        colors={["#FFFFFF", "#FFFFFF"]}
        style={styles.header}
      >
        <TouchableOpacity
          onPress={() => {
            if (onBack) onBack();
            else navigation?.goBack?.();
          }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={rs(18)} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Favorite Syttrs</Text>
        <View style={{ width: rs(40) }} />
      </LinearGradient>

      <View style={styles.body}>
        <FlatList
          data={favorites}
          keyExtractor={(item, idx) =>
            String(item.favorite_id || item.id || `f-${idx}`)
          }
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={{ height: rs(10) }} />}
          contentContainerStyle={{ paddingVertical: rs(10) }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="heart-outline" size={rs(48)} color="#FF80AB" />
              <Text style={styles.emptyText}>
                No favorite Syttr yet
              </Text>
            </View>
          }
        />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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
  },
  backBtn: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(21),
    backgroundColor: "#FFE89A",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#C77A00",
    fontSize: rf(18),
    fontWeight: "700",
    fontFamily: "PlayfairDisplay",
  },
  body: {
    flex: 1,
    paddingHorizontal: wp(3.5),
    paddingTop: hp(1.4),
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFEAF2",
    padding: rs(12),
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    shadowColor: "rgba(0,0,0,0.04)",
    shadowOpacity: 1,
    shadowOffset: { width: rs(0), height: rs(2) },
    shadowRadius: 6,
    elevation: 2,
  },
  avatar: {
    width: rs(48),
    height: rs(48),
    borderRadius: rs(16),
    backgroundColor: "#FFE1EC",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(12),
  },
  avatarImage: {
    width: rs(48),
    height: rs(48),
    borderRadius: rs(16),
  },
  avatarText: {
    fontSize: Math.min(rf(18), 16),
    fontWeight: "700",
    color: "#C2185B",
  },
  cardTitle: {
    fontSize: rf(15),
    fontWeight: "700",
    color: "#880E4F",
  },
  cardSubtitle: {
    fontSize: rf(12),
    color: "#AD1457",
  },
  cardMeta: {
    fontSize: rf(11),
    color: "#C2185B",
    marginTop: rs(4),
  },
  removeBtn: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#FFE7F0",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyBox: {
    alignItems: "center",
    marginTop: hp(3),
    gap: rs(10),
  },
  emptyText: {
    fontSize: rf(14),
    color: "#AD1457",
    fontWeight: "600",
  },
});
