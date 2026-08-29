import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getClientProfile, getUserKids, isVerificationRequiredApiError } from "../Api";
import { formatDateToMDY } from "../utils/dateFormat";
import { rf, rs } from "../utils/responsive";
import { resolveSessionImageUrl } from "../../lib/nannySessionProfile";

type Props = {
  parent?: any;
  onBack?: () => void;
  onRequireVerification?: () => void;
};

type ParentChild = {
  id?: string | number;
  name?: string;
  age?: string | number;
  gender?: string;
  allergies?: string;
  medicalConditions?: string;
  notes?: string;
};

type ParentProfile = {
  userId?: string | number;
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  country?: string;
  address?: string;
  about?: string;
  image?: string;
  averageRating?: number | null;
  jobsPostedCount?: number | null;
  ratingsCount?: number | null;
  createdAt?: string;
  reviews?: ParentReview[];
};

type ParentReview = {
  id?: string | number;
  rating?: number | null;
  review?: string;
  reviewerName?: string;
  reviewedAt?: string;
};

const pickText = (...values: any[]) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && text !== "null" && text !== "undefined") return text;
  }
  return "";
};

const pickNumber = (...values: any[]) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const pickParentId = (value: any): string | number | undefined => {
  const candidate =
    value?.user_id ??
    value?.parent_user_id ??
    value?.parent_profile_id ??
    value?.profile_id ??
    value?.id;
  const normalized = String(candidate ?? "").trim();
  return normalized ? candidate : undefined;
};

const pickParentImage = (value: any) =>
  resolveSessionImageUrl(
    pickText(
      value?.user_image_url,
      value?.profile_image_url,
      value?.profile_image,
      value?.user_image,
      value?.avatar,
      value?.image,
      value?.image_url,
      value?.parent_profile_image,
      value?.parent_image,
      value?.parent_image_url
    )
  );

const normalizeParentProfile = (value: any): ParentProfile => ({
  userId: pickParentId(value),
  name: pickText(
    value?.parent_name,
    value?.name,
    value?.fullname,
    [value?.first_name || value?.firstname, value?.last_name || value?.lastname]
      .filter(Boolean)
      .join(" ")
  ),
  email: pickText(value?.parent_email, value?.email),
  phone: pickText(value?.phone, value?.number),
  city: pickText(value?.city_area, value?.city),
  country: pickText(value?.country),
  address: pickText(value?.address, value?.location, value?.city_area, value?.city),
  about: pickText(value?.about_me, value?.about, value?.bio, value?.summary),
  image: pickParentImage(value),
  averageRating: pickNumber(value?.average_rating, value?.parent_average_rating),
  jobsPostedCount: pickNumber(value?.jobs_posted_count, value?.parent_jobs_posted_count),
  ratingsCount: pickNumber(
    value?.ratings_count,
    value?.raters_count,
    value?.parent_ratings_count,
    value?.parent_raters_count
  ),
  createdAt: pickText(value?.created_at),
  reviews: Array.isArray(value?.reviews)
    ? value.reviews
        .map((entry: any) => ({
          id: entry?.id,
          rating: pickNumber(entry?.rating),
          review: pickText(entry?.review),
          reviewerName: pickText(entry?.reviewer_name, entry?.nanny_name, entry?.name),
          reviewedAt: pickText(entry?.reviewed_at),
        }))
        .filter((entry: ParentReview) => entry.review || entry.rating !== null)
    : [],
});

const mergeParentProfile = (current: ParentProfile, incoming: ParentProfile): ParentProfile => ({
  ...current,
  ...incoming,
  userId: incoming.userId ?? current.userId,
  name: incoming.name || current.name,
  email: incoming.email || current.email,
  phone: incoming.phone || current.phone,
  city: incoming.city || current.city,
  country: incoming.country || current.country,
  address: incoming.address || current.address,
  about: incoming.about || current.about,
  image: incoming.image || current.image,
  averageRating:
    incoming.averageRating !== null && incoming.averageRating !== undefined
      ? incoming.averageRating
      : current.averageRating,
  jobsPostedCount:
    incoming.jobsPostedCount !== null && incoming.jobsPostedCount !== undefined
      ? incoming.jobsPostedCount
      : current.jobsPostedCount,
  ratingsCount:
    incoming.ratingsCount !== null && incoming.ratingsCount !== undefined
      ? incoming.ratingsCount
      : current.ratingsCount,
  createdAt: incoming.createdAt || current.createdAt,
  reviews: incoming.reviews && incoming.reviews.length ? incoming.reviews : current.reviews,
});

const splitLocationParts = (value?: string) =>
  String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const extractKidsArray = (payload: any): any[] => {
  const candidates = [
    payload,
    payload?.kids,
    payload?.data,
    payload?.data?.kids,
    payload?.data?.data,
    payload?.items,
    payload?.results,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
};

const normalizeChild = (value: any): ParentChild => ({
  id: value?.id ?? value?.kid_id ?? value?.parent_kid_id ?? value?.child_id,
  name: pickText(value?.name, value?.child_name),
  age: value?.age ?? value?.child_age ?? "",
  gender: pickText(value?.gender),
  allergies: pickText(value?.allergies),
  medicalConditions: pickText(value?.medical_conditions, value?.medicalConditions),
  notes: pickText(value?.notes, value?.anything_else),
});

const InfoRow = ({ label, value }: { label: string; value?: string }) => {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
};

export default function ParentProfileViewScreen({ parent, onBack, onRequireVerification }: Props) {
  const insets = useSafeAreaInsets();
  const initialProfile = useMemo(() => normalizeParentProfile(parent), [parent]);
  const [profile, setProfile] = useState<ParentProfile>(initialProfile);
  const [kids, setKids] = useState<ParentChild[]>(
    Array.isArray(parent?.kids) ? parent.kids.map(normalizeChild) : []
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setProfile(normalizeParentProfile(parent));
    setKids(Array.isArray(parent?.kids) ? parent.kids.map(normalizeChild) : []);
  }, [parent]);

  useEffect(() => {
    const parentId = pickParentId(parent);
    if (!parentId) return;

    let active = true;
    const loadProfile = async () => {
      try {
        setLoading(true);
        const token = (await AsyncStorage.getItem("token")) || undefined;
        const [profileResult, kidsResult] = await Promise.allSettled([
          getClientProfile(parentId, token),
          getUserKids(parentId, token),
        ]);

        if (!active) return;

        if (
          (profileResult.status === "rejected" && isVerificationRequiredApiError(profileResult.reason)) ||
          (kidsResult.status === "rejected" && isVerificationRequiredApiError(kidsResult.reason))
        ) {
          onRequireVerification?.();
          return;
        }

        if (profileResult.status === "fulfilled") {
          setProfile((prev) => mergeParentProfile(prev, normalizeParentProfile(profileResult.value)));
        }

        if (kidsResult.status === "fulfilled") {
          const nextKids = extractKidsArray(kidsResult.value).map(normalizeChild);
          if (nextKids.length) setKids(nextKids);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadProfile();
    return () => {
      active = false;
    };
  }, [parent, onRequireVerification]);

  const displayName = profile.name || "Parent";
  const joinedLabel = profile.createdAt ? formatDateToMDY(profile.createdAt) : "";
  const locationLabel = pickText(profile.address, [profile.city, profile.country].filter(Boolean).join(", "));
  const addressLabel = pickText(profile.address);
  const addressParts = splitLocationParts(addressLabel);
  const fallbackCity =
    addressParts.length >= 2 ? addressParts[addressParts.length - 2] : "";
  const fallbackCountry =
    addressParts.length >= 1 ? addressParts[addressParts.length - 1] : "";
  const cityLabel =
    profile.city && profile.city !== profile.address && !String(profile.city).includes(",")
      ? profile.city
      : fallbackCity;
  const countryLabel =
    profile.country && profile.country !== profile.city && profile.country !== profile.address
      ? profile.country
      : fallbackCountry;
  const avatarInitials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const reviews = profile.reviews || [];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, rs(12)) }]}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.85}>
          <Ionicons name="chevron-back" size={18} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Parent Profile</Text>
        <View style={styles.backBtnGhost} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.avatarWrap}>
            {profile.image ? (
              <Image source={{ uri: profile.image }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarInitials}>{avatarInitials || "P"}</Text>
            )}
          </View>
          <Text style={styles.name}>{displayName}</Text>
          {locationLabel ? <Text style={styles.location}>{locationLabel}</Text> : null}

          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Ionicons name="star" size={13} color="#C2185B" />
              <Text style={styles.statText}>
                {profile.averageRating !== null && profile.averageRating !== undefined
                  ? profile.averageRating.toFixed(1)
                  : "N/A"}
              </Text>
            </View>
            <View style={styles.statPill}>
              <Ionicons name="briefcase" size={13} color="#C2185B" />
              <Text style={styles.statText}>{Math.max(0, Math.round(profile.jobsPostedCount || 0))} jobs</Text>
            </View>
            <View style={styles.statPill}>
              <Ionicons name="people" size={13} color="#C2185B" />
              <Text style={styles.statText}>{Math.max(0, Math.round(profile.ratingsCount || 0))} raters</Text>
            </View>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color="#C2185B" />
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.bodyText}>
            {profile.about || "No parent bio provided."}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Details</Text>

          <InfoRow label="Address" value={addressLabel} />
          <InfoRow label="City" value={cityLabel} />
          <InfoRow label="Country" value={countryLabel} />
          <InfoRow label="Joined" value={joinedLabel} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Children</Text>
          {kids.length ? (
            kids.map((child, index) => (
              <View
                key={`${child.id || child.name || "child"}-${index}`}
                style={[styles.childCard, index > 0 && styles.childCardGap]}
              >
                <View style={styles.childAvatar}>
                  <Ionicons name="happy" size={16} color="#C2185B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.childName}>{child.name || "Child"}</Text>
                  <Text style={styles.childMeta}>
                    {[
                      child.age !== undefined && child.age !== "" ? `Age ${child.age}` : null,
                      child.gender || null,
                    ]
                      .filter(Boolean)
                      .join(" • ") || "Details not provided"}
                  </Text>
                  {child.allergies ? (
                    <Text style={styles.childExtra}>Allergies: {child.allergies}</Text>
                  ) : null}
                  {child.medicalConditions ? (
                    <Text style={styles.childExtra}>Medical: {child.medicalConditions}</Text>
                  ) : null}
                  {child.notes ? (
                    <Text style={styles.childExtra}>Notes: {child.notes}</Text>
                  ) : null}
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.bodyText}>No child details available.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Reviews</Text>
          {reviews.length ? (
            reviews.map((entry, index) => (
              <View
                key={`${entry.id || entry.reviewerName || "review"}-${index}`}
                style={[styles.reviewCard, index > 0 && styles.reviewCardGap]}
              >
                <View style={styles.reviewHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewAuthor}>{entry.reviewerName || "Syttr"}</Text>
                    <Text style={styles.reviewDate}>
                      {entry.reviewedAt ? formatDateToMDY(entry.reviewedAt) || entry.reviewedAt : "Recent review"}
                    </Text>
                  </View>
                  <View style={styles.reviewRatingPill}>
                    <Ionicons name="star" size={12} color="#C2185B" />
                    <Text style={styles.reviewRatingText}>
                      {entry.rating !== null && entry.rating !== undefined ? entry.rating.toFixed(1) : "N/A"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.reviewBody}>
                  {entry.review || "This Syttr left a star rating without written feedback."}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.bodyText}>No written reviews yet.</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFF8FB" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingBottom: rs(12),
    backgroundColor: "#FFF8FB",
  },
  backBtn: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1F6",
  },
  backBtnGhost: {
    width: rs(36),
    height: rs(36),
  },
  headerTitle: {
    fontSize: rf(17),
    fontWeight: "800",
    color: "#C2185B",
  },
  content: {
    padding: rs(16),
    paddingBottom: rs(30),
  },
  heroCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: rs(22),
    padding: rs(18),
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  avatarWrap: {
    width: rs(84),
    height: rs(84),
    borderRadius: rs(42),
    backgroundColor: "#FFE5EF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarInitials: {
    fontSize: rf(22),
    fontWeight: "800",
    color: "#C2185B",
  },
  name: {
    marginTop: rs(12),
    fontSize: rf(19),
    fontWeight: "800",
    color: "#880E4F",
    textAlign: "center",
  },
  location: {
    marginTop: rs(4),
    fontSize: rf(12),
    color: "#7A5A66",
    textAlign: "center",
  },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: rs(8),
    marginTop: rs(14),
  },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
    borderRadius: rs(14),
    backgroundColor: "#FFF1F6",
    paddingHorizontal: rs(10),
    paddingVertical: rs(8),
  },
  statText: {
    fontSize: rf(11),
    fontWeight: "700",
    color: "#C2185B",
  },
  loadingWrap: {
    paddingVertical: rs(14),
    alignItems: "center",
  },
  card: {
    marginTop: rs(12),
    backgroundColor: "#FFFFFF",
    borderRadius: rs(18),
    padding: rs(16),
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: rf(14),
    fontWeight: "800",
    color: "#880E4F",
    marginBottom: rs(8),
  },
  bodyText: {
    fontSize: rf(12),
    color: "#6B4350",
    lineHeight: rf(18),
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: rs(10),
    paddingVertical: rs(7),
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
  childCard: {
    flexDirection: "row",
    gap: rs(10),
    alignItems: "flex-start",
    padding: rs(12),
    borderRadius: rs(14),
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.15)",
  },
  childCardGap: {
    marginTop: rs(10),
  },
  childAvatar: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#FFE5EF",
    alignItems: "center",
    justifyContent: "center",
  },
  childName: {
    fontSize: rf(12),
    fontWeight: "800",
    color: "#880E4F",
  },
  childMeta: {
    marginTop: rs(2),
    fontSize: rf(11),
    color: "#7A5A66",
  },
  childExtra: {
    marginTop: rs(4),
    fontSize: rf(11),
    color: "#6B4350",
  },
  reviewCard: {
    borderRadius: rs(14),
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.15)",
    padding: rs(12),
  },
  reviewCardGap: {
    marginTop: rs(10),
  },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: rs(10),
    marginBottom: rs(8),
  },
  reviewAuthor: {
    fontSize: rf(12),
    fontWeight: "800",
    color: "#880E4F",
  },
  reviewDate: {
    marginTop: rs(2),
    fontSize: rf(10),
    color: "#8C6A77",
  },
  reviewRatingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(4),
    borderRadius: rs(12),
    backgroundColor: "#FFE8F0",
    paddingHorizontal: rs(8),
    paddingVertical: rs(6),
  },
  reviewRatingText: {
    fontSize: rf(10),
    fontWeight: "800",
    color: "#C2185B",
  },
  reviewBody: {
    fontSize: rf(11),
    lineHeight: rf(17),
    color: "#6B4350",
  },
});
