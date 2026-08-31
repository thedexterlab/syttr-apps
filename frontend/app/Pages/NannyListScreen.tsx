import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { hp, rf, rs, wp } from "../utils/responsive";
import SafeScreen from "../components/SafeScreen";
import { apiRequest, isVerificationRequiredApiError, sanitizeToken } from "../Api";
import { resolveSessionImageUrl } from "../../lib/nannySessionProfile";

/* ----------------------------- TYPES ----------------------------- */

type Nanny = {
  id: number | string;
  fullname?: string;
  name?: string;
  city?: string;
  state?: string;
  state_code?: string;
  province?: string;
  region?: string;
  country?: string;
  address?: string;
  experience?: number | string;
  years_experience?: number | string;
  experience_years?: number | string;
  years_of_experience?: number | string;
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
  lon?: number | string;
  location_lat?: number | string;
  location_lon?: number | string;
  age?: number | string;
  profile_image?: string | null;
  profile_photo?: string | null;
  avatar?: string | null;
  user_image?: string | null;
  nanny_image?: string | null;
  image?: string | null;
  photo?: string | null;
  rating?: number | string | null;
  avg_rating?: number | string | null;
  average_rating?: number | string | null;
};

type Props = {
  navigation?: any;
  onBack?: () => void;
  onOpenProfile?: (nanny: Nanny) => void;
  onRequireVerification?: () => void;
};

/* ----------------------------- CONFIG ----------------------------- */

const RADIUS_OPTIONS = [5, 10, 25, 50];
const CITY_FACET_LIMIT = 10;
type Coords = { lat: number; lon: number };

const parseNumeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const parseCoordsFromCity = (city?: string): Coords | null => {
  const match = String(city || "")
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
};
const parseExperienceRange = (minText: string, maxText: string) => {
  const min = minText.trim() === "" ? null : Number(minText);
  const max = maxText.trim() === "" ? null : Number(maxText);
  if (min !== null && !Number.isFinite(min)) {
    return { min, max, error: "Minimum experience must be a number." };
  }
  if (max !== null && !Number.isFinite(max)) {
    return { min, max, error: "Maximum experience must be a number." };
  }
  if (min !== null && max !== null && min > max) {
    return { min, max, error: "Minimum experience cannot be greater than maximum." };
  }
  return { min, max, error: null as string | null };
};
const cleanStatePart = (value?: string) =>
  String(value || "")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, "")
    .trim();
const STREET_TOKEN_REGEX =
  /\b(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|court|ct|circle|cir|trail|trl|parkway|pkwy|place|pl|terrace|ter|highway|hwy)\b/i;
const STREET_SUFFIX_REGEX =
  /\b(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|court|ct|circle|cir|trail|trl|parkway|pkwy|place|pl|terrace|ter|highway|hwy)\.?$/i;
const COUNTRY_PART_REGEX = /^(?:usa|us|united states|united states of america|canada)$/i;
const isLikelyStateCode = (value?: string) =>
  /^[A-Za-z]{2}$/.test(String(value || "").trim());
const isStreetLikeSegment = (value?: string) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^p\.?\s*o\.?\s*box\b/i.test(raw)) return true;
  if (STREET_SUFFIX_REGEX.test(raw)) return true;
  return /\d/.test(raw) && STREET_TOKEN_REGEX.test(raw);
};
const normalizeLocationPart = (value?: string) => cleanStatePart(value);
const firstNonEmpty = (...values: (string | undefined | null)[]) =>
  values.map((value) => String(value || "").trim()).find(Boolean) || "";
const joinUniqueParts = (parts: string[]) => {
  const out: string[] = [];
  parts.forEach((part) => {
    const value = String(part || "").trim();
    if (!value) return;
    if (!out.some((seen) => seen.toLowerCase() === value.toLowerCase())) {
      out.push(value);
    }
  });
  return out.join(", ");
};
const extractCityStateFromText = (value?: string) => {
  const raw = String(value || "").trim();
  if (!raw || parseCoordsFromCity(raw)) return { city: "", state: "" };

  const parts = raw
    .split(",")
    .map((part) => normalizeLocationPart(part))
    .filter((part) => part && !COUNTRY_PART_REGEX.test(part));

  if (!parts.length) return { city: "", state: "" };

  const nonStreetParts = parts.filter((part) => !isStreetLikeSegment(part));
  if (!nonStreetParts.length) return { city: "", state: "" };

  let city = nonStreetParts[0] || "";
  let state = cleanStatePart(nonStreetParts[1] || "");

  if (!state && city) {
    const cityStateMatch = city.match(/^(.*?)[\s,]+([A-Z]{2})$/);
    if (cityStateMatch) {
      city = cityStateMatch[1].trim();
      state = cleanStatePart(cityStateMatch[2]);
    }
  }

  return { city, state };
};
const toPublicLocationLabel = (n: Nanny) => {
  const rawCity = String(n.city || "").trim();
  const rawAddress = String(n.address || "").trim();
  if (!rawCity && !rawAddress) return "City not set";
  if (parseCoordsFromCity(rawCity)) return "Location available";

  const parsedCity = extractCityStateFromText(rawCity);
  const parsedAddress = extractCityStateFromText(rawAddress);
  const parsedStateField = extractCityStateFromText(n.state);
  const cityCandidate = firstNonEmpty(
    parsedCity.city,
    parsedAddress.city,
    parsedStateField.city
  );
  const city = isLikelyStateCode(cityCandidate) ? "" : cityCandidate;
  const state = cleanStatePart(
    firstNonEmpty(
      parsedCity.state,
      parsedAddress.state,
      parsedStateField.state,
      n.state_code,
      n.state,
      n.province,
      n.region
    )
  );

  if (city && !isStreetLikeSegment(city)) {
    return joinUniqueParts([city, state]) || city;
  }

  return "Location available";
};
const getNannyCoords = (n: Nanny): Coords | null => {
  const lat =
    parseNumeric(n.latitude) ??
    parseNumeric(n.lat) ??
    parseNumeric(n.location_lat);
  const lon =
    parseNumeric(n.longitude) ??
    parseNumeric(n.lng) ??
    parseNumeric(n.lon) ??
    parseNumeric(n.location_lon);
  if (lat !== null && lon !== null) return { lat, lon };
  return parseCoordsFromCity(n.city);
};
const toRadians = (value: number) => (value * Math.PI) / 180;
const milesBetween = (a: Coords, b: Coords) => {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(x));
};

/* ----------------------------- COMPONENT ----------------------------- */

export default function NannyListScreen({
  navigation,
  onBack,
  onOpenProfile,
  onRequireVerification,
}: Props) {
  const [nannies, setNannies] = useState<Nanny[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [nearMeOnly, setNearMeOnly] = useState<boolean>(false);
  const [radiusMiles, setRadiusMiles] = useState<number>(25);
  const [selectedCityKeys, setSelectedCityKeys] = useState<string[]>([]);
  const [experienceMin, setExperienceMin] = useState<string>("");
  const [experienceMax, setExperienceMax] = useState<string>("");
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [draftNearMeOnly, setDraftNearMeOnly] = useState<boolean>(false);
  const [draftRadiusMiles, setDraftRadiusMiles] = useState<number>(25);
  const [draftSelectedCityKeys, setDraftSelectedCityKeys] = useState<string[]>([]);
  const [draftExperienceMin, setDraftExperienceMin] = useState<string>("");
  const [draftExperienceMax, setDraftExperienceMax] = useState<string>("");
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);

  /* ----------------------------- LOAD NANNIES ----------------------------- */

  const loadNannies = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const token = sanitizeToken((await AppStorage.getItem("token")) || undefined);
      const json = await apiRequest<any>("nannies?page=1&per_page=20", {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const list: Nanny[] =
        Array.isArray(json?.data?.data)
          ? json.data.data
          : Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json)
          ? json
          : [];

      setNannies(list);
    } catch (e) {
      if (isVerificationRequiredApiError(e)) {
        onRequireVerification?.();
        setNannies([]);
        return;
      }
      console.log("load nannies error", e instanceof Error ? e.message : e);
      setNannies([]);
    } finally {
      setLoading(false);
    }
  }, [onRequireVerification]);

  /* ----------------------------- SEARCH FILTER ----------------------------- */

  const loadSavedLocation = useCallback(async (): Promise<{ lat: number; lon: number } | null> => {
    try {
      const [[, latText], [, lonText]] = await AppStorage.multiGet([
        "last_location_lat",
        "last_location_lon",
      ]);
      const lat = latText ? Number(latText) : NaN;
      const lon = lonText ? Number(lonText) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon };
      }
    } catch {
      // ignore storage read errors
    }
    return null;
  }, []);
  const hydrateSavedLocation = useCallback(async () => {
    const coords = await loadSavedLocation();
    setUserCoords(coords);
    return coords;
  }, [loadSavedLocation]);
  const handleDraftNearMeToggle = async () => {
    if (draftNearMeOnly) {
      setDraftNearMeOnly(false);
      return;
    }
    const coords = userCoords || (await hydrateSavedLocation());
    if (!coords) {
      Alert.alert(
        "Location needed",
        "Set your location on the home map first, then enable Near Me."
      );
      return;
    }
    setDraftNearMeOnly(true);
  };
  const openFilters = () => {
    setDraftNearMeOnly(nearMeOnly);
    setDraftRadiusMiles(radiusMiles);
    setDraftSelectedCityKeys([...selectedCityKeys]);
    setDraftExperienceMin(experienceMin);
    setDraftExperienceMax(experienceMax);
    setShowFilters(true);
  };
  const closeFilters = () => setShowFilters(false);
  const applyFilters = () => {
    const parsed = parseExperienceRange(draftExperienceMin, draftExperienceMax);
    if (parsed.error) {
      Alert.alert("Invalid range", parsed.error);
      return;
    }
    setNearMeOnly(draftNearMeOnly);
    setRadiusMiles(draftRadiusMiles);
    setSelectedCityKeys([...draftSelectedCityKeys]);
    setExperienceMin(draftExperienceMin.trim());
    setExperienceMax(draftExperienceMax.trim());
    setShowFilters(false);
  };
  const clearDraftFilters = () => {
    setDraftNearMeOnly(false);
    setDraftRadiusMiles(25);
    setDraftSelectedCityKeys([]);
    setDraftExperienceMin("");
    setDraftExperienceMax("");
  };
  const toggleDraftCity = (key: string) => {
    setDraftSelectedCityKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  useEffect(() => {
    loadNannies();
    hydrateSavedLocation();
  }, [loadNannies, hydrateSavedLocation]);

  useEffect(() => {
    if (Platform.OS === "web" || typeof Keyboard?.addListener !== "function") {
      return;
    }
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e?.endCoordinates?.height || 0);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const getName = useCallback((n: Nanny) => String(n.fullname || n.name || "").trim(), []);
  const getCity = useCallback((n: Nanny) => {
    return toPublicLocationLabel(n);
  }, []);
  const getCityKey = useCallback((n: Nanny) => getCity(n).toLowerCase(), [getCity]);
  const getExperience = useCallback((n: Nanny) => {
    const raw =
      n.experience ??
      n.years_experience ??
      n.experience_years ??
      n.years_of_experience;
    return raw === undefined || raw === null ? "" : String(raw).trim();
  }, []);
  const getExperienceNumber = useCallback((n: Nanny): number | null => {
    const raw = Number(getExperience(n));
    return Number.isFinite(raw) ? raw : null;
  }, [getExperience]);
  const cityFacets = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    nannies.forEach((n) => {
      const label = getCity(n);
      const key = label.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { key, label, count: 1 });
      }
    });
    return Array.from(map.values()).sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label)
    );
  }, [nannies, getCity]);
  const visibleCityFacets = cityFacets.slice(0, CITY_FACET_LIMIT);
  const appliedRange = useMemo(
    () => parseExperienceRange(experienceMin, experienceMax),
    [experienceMin, experienceMax]
  );
  const rangeMin = appliedRange.min;
  const rangeMax = appliedRange.max;
  const draftRange = useMemo(
    () => parseExperienceRange(draftExperienceMin, draftExperienceMax),
    [draftExperienceMin, draftExperienceMax]
  );

  const searchPlaceholder = "Search by name, city, or years exp";
  const activeFilterCount =
    (selectedCityKeys.length ? 1 : 0) +
    (nearMeOnly ? 1 : 0) +
    (rangeMin !== null || rangeMax !== null ? 1 : 0);
  const activeFilterLabel = [
    selectedCityKeys.length
      ? `City: ${selectedCityKeys.length} selected`
      : null,
    rangeMin !== null || rangeMax !== null
      ? `Experience: ${rangeMin ?? "Any"}-${rangeMax ?? "Any"} yrs`
      : null,
    nearMeOnly ? `Near me (${radiusMiles} mi)` : null,
  ]
    .filter(Boolean)
    .join(" • ");

  const filtered = useMemo(() => {
    let list = nannies;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((n) => {
        const name = getName(n).toLowerCase();
        const city = getCity(n).toLowerCase();
        const experience = getExperience(n).toLowerCase();
        const expLabel = `${experience} yrs exp`;
        return name.includes(q) || city.includes(q) || experience.includes(q) || expLabel.includes(q);
      });
    }

    if (selectedCityKeys.length) {
      list = list.filter((n) => selectedCityKeys.includes(getCityKey(n)));
    }

    if (rangeMin !== null || rangeMax !== null) {
      list = list.filter((n) => {
        const exp = getExperienceNumber(n);
        if (exp === null) return false;
        if (rangeMin !== null && exp < rangeMin) return false;
        if (rangeMax !== null && exp > rangeMax) return false;
        return true;
      });
    }

    if (nearMeOnly) {
      if (!userCoords) return [];
      list = list.filter((n) => {
        const coords = getNannyCoords(n);
        if (!coords) return false;
        return milesBetween(userCoords, coords) <= radiusMiles;
      });
    }

    return list;
  }, [
    nannies,
    query,
    nearMeOnly,
    radiusMiles,
    userCoords,
    selectedCityKeys,
    rangeMin,
    rangeMax,
    getName,
    getCity,
    getCityKey,
    getExperience,
    getExperienceNumber,
  ]);

  /* ----------------------------- RENDER ITEM ----------------------------- */

  const renderItem = ({ item }: { item: Nanny }) => {
    const displayName = item.fullname || item.name || "Syttr";
    const displayCity = getCity(item);
    const expValue = getExperience(item);
    const ratingValue =
      parseNumeric(item.avg_rating) ??
      parseNumeric(item.average_rating) ??
      parseNumeric(item.rating);
    const imagePath = firstNonEmpty(
      item.profile_image,
      item.profile_photo,
      item.avatar,
      item.user_image,
      item.nanny_image,
      item.photo,
      item.image
    );
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
              name: displayName,
            });
        }}
      >
        <View style={styles.avatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Image source={require("../../assets/app-logo.png")} style={styles.avatarLogo} resizeMode="contain" />
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{displayName}</Text>
          <Text style={styles.cardSubtitle}>
            {displayCity}
          </Text>
          <Text style={styles.cardMeta}>
            {ratingValue !== null ? `${ratingValue.toFixed(1)} rating` : "No ratings yet"}
          </Text>
          <Text style={styles.cardMeta}>
            {expValue
              ? `${expValue} yrs exp`
              : "Experience N/A"}{" "}
            •{" "}
            {item.age }
          </Text>
        </View>

        <Ionicons
          name="chevron-forward"
          size={18}
          color="#C2185B"
        />
      </TouchableOpacity>
    );
  };

  /* ----------------------------- UI ----------------------------- */

  return (
    <SafeScreen edges={["left", "right", "bottom"]}>
      <View style={styles.root}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (onBack) onBack();
            else navigation?.goBack?.();
          }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={18} color="#C2185B" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Find Syttr</Text>

        <View style={{ width: rs(40) }} />
      </View>

      {/* BODY */}
      <View style={styles.body}>
        {/* SEARCH */}
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color="#C2185B" />
            <TextInput
              placeholder={searchPlaceholder}
              placeholderTextColor="rgba(194,24,91,0.6)"
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
            />
          </View>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={openFilters}
            activeOpacity={0.85}
          >
            <Ionicons name="options-outline" size={18} color="#C2185B" />
            <Text style={styles.filterButtonText}>
              {activeFilterCount ? `Filters (${activeFilterCount})` : "Filters"}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.activeFilterText}>
          {activeFilterLabel || "All results"}
        </Text>

        {/* LIST */}
        {loading ? (
          <ActivityIndicator color="#FF80AB" />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item, idx) =>
              item.id?.toString() || `n-${idx}`
            }
            renderItem={renderItem}
            ItemSeparatorComponent={() => (
              <View style={{ height: rs(10) }} />
            )}
            contentContainerStyle={{ paddingVertical: rs(10) }}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Ionicons
                  name="people-outline"
                  size={48}
                  color="#FF80AB"
                />
                <Text style={styles.emptyText}>
                  No Syttrs found
                </Text>
              </View>
            }
          />
        )}
      </View>

      <Modal
        transparent
        visible={showFilters}
        animationType="fade"
        onRequestClose={closeFilters}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalBackdropDismiss} activeOpacity={1} onPress={closeFilters} />
          <KeyboardAvoidingView
            style={styles.modalKeyboardWrap}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
          >

            <View
              style={[
                styles.modalCard,
                Platform.OS === "android" && keyboardHeight > 0
                  ? { marginBottom: Math.max(12, keyboardHeight - 24) }
                  : null,
              ]}
            >
            <View style={styles.modalHandle} />
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Filters</Text>
              <TouchableOpacity onPress={closeFilters} style={styles.closeBtn} activeOpacity={0.8}>
                <Ionicons name="close" size={18} color="#C2185B" />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={styles.modalBodyContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              <Text style={styles.modalSection}>Location</Text>
              <TouchableOpacity
                style={styles.nearMeRow}
                onPress={handleDraftNearMeToggle}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={draftNearMeOnly ? "checkbox-outline" : "square-outline"}
                  size={20}
                  color="#C2185B"
                />
                <Text style={styles.nearMeText}>Near Me</Text>
              </TouchableOpacity>
              {draftNearMeOnly ? (
                <>
                  <Text style={styles.locationHint}>
                    {userCoords
                      ? `Using saved location (${userCoords.lat.toFixed(3)}, ${userCoords.lon.toFixed(3)})`
                      : "No saved location found"}
                  </Text>
                  <View style={styles.searchFilters}>
                    {RADIUS_OPTIONS.map((radius) => {
                      const isActive = draftRadiusMiles === radius;
                      return (
                        <TouchableOpacity
                          key={radius}
                          style={[
                            styles.filterChip,
                            isActive && styles.filterChipActive,
                          ]}
                          onPress={() => setDraftRadiusMiles(radius)}
                          activeOpacity={0.85}
                        >
                          <Text
                            style={[
                              styles.filterChipText,
                              isActive && styles.filterChipTextActive,
                            ]}
                          >
                            {radius} mi
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <Text style={styles.modalSubSection}>City</Text>
              <View style={styles.cityQuickActions}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setDraftSelectedCityKeys(visibleCityFacets.map((f) => f.key))}
                >
                  <Text style={styles.quickActionText}>Select All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setDraftSelectedCityKeys([])}
                >
                  <Text style={styles.quickActionText}>Deselect All</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.optionList}>
                {visibleCityFacets.map((facet) => {
                  const isActive = draftSelectedCityKeys.includes(facet.key);
                  return (
                    <TouchableOpacity
                      key={facet.key}
                      style={[
                        styles.optionRow,
                        isActive && styles.optionRowActive,
                      ]}
                      onPress={() => toggleDraftCity(facet.key)}
                      activeOpacity={0.85}
                    >
                      <Ionicons
                        name={isActive ? "checkbox-outline" : "square-outline"}
                        size={18}
                        color="#C2185B"
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.optionTitle,
                            isActive && styles.optionTitleActive,
                          ]}
                        >
                          {facet.label}
                        </Text>
                      </View>
                      <Text style={styles.facetCount}>[{facet.count}]</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {cityFacets.length > CITY_FACET_LIMIT ? (
                <Text style={styles.moreHint}>
                  Showing top {CITY_FACET_LIMIT} cities
                </Text>
              ) : null}

              <Text style={styles.modalSection}>Experience (Years)</Text>
              <View style={styles.rangeRow}>
                <TextInput
                  value={draftExperienceMin}
                  onChangeText={setDraftExperienceMin}
                  placeholder="Min"
                  keyboardType="numeric"
                  placeholderTextColor="rgba(194,24,91,0.55)"
                  style={styles.rangeInput}
                  returnKeyType="next"
                />
                <Text style={styles.rangeTo}>to</Text>
                <TextInput
                  value={draftExperienceMax}
                  onChangeText={setDraftExperienceMax}
                  placeholder="Max"
                  keyboardType="numeric"
                  placeholderTextColor="rgba(194,24,91,0.55)"
                  style={styles.rangeInput}
                  returnKeyType="done"
                  onSubmitEditing={applyFilters}
                />
              </View>
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSecondary}
                onPress={clearDraftFilters}
              >
                <Text style={styles.modalSecondaryText}>Clear All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalPrimary,
                  draftRange.error ? styles.modalPrimaryDisabled : null,
                ]}
                onPress={applyFilters}
                disabled={Boolean(draftRange.error)}
              >
                <Text style={styles.modalPrimaryText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
            </View>
          </KeyboardAvoidingView>

        </View>
      </Modal>
      </View>
    </SafeScreen>
  );
}

/* ----------------------------- STYLES ----------------------------- */

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingTop: rs(18),
    paddingBottom: rs(14),
    backgroundColor: "#FFFFFF",
    borderBottomLeftRadius: rs(18),
    borderBottomRightRadius: rs(18),
    elevation: 2,
    marginBottom: rs(10),
  },

  backBtn: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(21),
    backgroundColor: "#FFF1F6",
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: {
    color: "#C2185B",
    fontSize: rf(18),
    fontWeight: "700",
    fontFamily: "PlayfairDisplay",
  },

  body: {
    flex: 1,
    paddingHorizontal: rs(12),
    paddingTop: rs(12),
  },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: rs(12),
    paddingHorizontal: rs(10),
    paddingVertical: rs(8),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.25)",
  },
  filterButton: {
    height: rs(44),
    minWidth: rs(100),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.4)",
    backgroundColor: "#FFF5F9",
    paddingHorizontal: rs(10),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(6),
  },
  filterButtonText: {
    color: "#C2185B",
    fontSize: rf(12),
    fontWeight: "700",
  },

  searchInput: {
    flex: 1,
    marginLeft: rs(8),
    fontSize: rf(14),
    color: "#880E4F",
  },
  activeFilterText: {
    marginTop: rs(8),
    marginBottom: rs(12),
    color: "#AD1457",
    fontSize: rf(12),
    fontWeight: "600",
  },

  searchFilters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: rs(8),
    marginBottom: rs(12),
  },
  optionList: {
    gap: rs(8),
    marginBottom: rs(12),
  },
  cityQuickActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: rs(8),
  },
  quickActionText: {
    color: "#C2185B",
    fontSize: rf(11),
    fontWeight: "700",
  },
  optionRow: {
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    borderRadius: rs(12),
    paddingHorizontal: rs(12),
    paddingVertical: rs(10),
    backgroundColor: "#FFF9FC",
    flexDirection: "row",
    alignItems: "center",
    gap: rs(10),
  },
  optionRowActive: {
    borderColor: "#FF80AB",
    backgroundColor: "#FFF1F6",
  },
  optionTitle: {
    color: "#880E4F",
    fontSize: rf(13),
    fontWeight: "700",
  },
  optionTitleActive: {
    color: "#C2185B",
  },
  facetCount: {
    color: "#AD1457",
    fontSize: rf(11),
    fontWeight: "700",
  },
  moreHint: {
    color: "#AD1457",
    fontSize: rf(11),
    marginBottom: rs(12),
  },
  filterChip: {
    paddingHorizontal: rs(12),
    paddingVertical: rs(8),
    borderRadius: rs(999),
    backgroundColor: "#FFF5F9",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  filterChipActive: {
    backgroundColor: "#FF80AB",
    borderColor: "#FF80AB",
  },
  filterChipText: {
    color: "#C2185B",
    fontSize: rf(12),
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: "#fff",
  },
  nearMeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    marginBottom: rs(8),
  },
  nearMeText: {
    color: "#880E4F",
    fontSize: rf(13),
    fontWeight: "700",
  },
  modalSubSection: {
    color: "#880E4F",
    fontSize: rf(12),
    fontWeight: "700",
    marginBottom: rs(8),
  },
  locationHint: {
    color: "#AD1457",
    fontSize: rf(11),
    marginBottom: rs(8),
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  modalKeyboardWrap: {
    justifyContent: "flex-end",
  },
  modalBackdropDismiss: {
    flex: 1,
  },
  modalCard: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: rs(18),
    borderTopRightRadius: rs(18),
    paddingHorizontal: rs(14),
    paddingTop: rs(8),
    paddingBottom: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.3)",
    maxHeight: "82%",
  },
  modalBody: {
    maxHeight: rs(430),
  },
  modalBodyContent: {
    paddingBottom: rs(10),
  },
  modalHandle: {
    width: rs(42),
    height: rs(5),
    borderRadius: rs(999),
    backgroundColor: "rgba(194,24,91,0.25)",
    alignSelf: "center",
    marginBottom: rs(10),
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(10),
  },
  closeBtn: {
    width: rs(30),
    height: rs(30),
    borderRadius: rs(15),
    backgroundColor: "#FFF1F6",
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    color: "#C2185B",
    fontSize: rf(17),
    fontWeight: "800",
  },
  modalSection: {
    color: "#880E4F",
    fontSize: rf(13),
    fontWeight: "700",
    marginBottom: rs(8),
    marginTop: rs(4),
  },
  rangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    marginBottom: rs(12),
  },
  rangeInput: {
    flex: 1,
    height: rs(42),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    borderRadius: rs(10),
    paddingHorizontal: rs(10),
    fontSize: rf(14),
    color: "#880E4F",
    backgroundColor: "#FFF9FC",
  },
  rangeTo: {
    color: "#AD1457",
    fontWeight: "700",
    fontSize: rf(12),
  },
  modalActions: {
    marginTop: rs(8),
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: rs(8),
  },
  modalSecondary: {
    paddingVertical: rs(10),
    paddingHorizontal: rs(14),
    borderRadius: rs(10),
    borderWidth: 1,
    borderColor: "#FF80AB",
    backgroundColor: "#FFF1F6",
  },
  modalSecondaryText: {
    color: "#C2185B",
    fontSize: rf(12),
    fontWeight: "700",
  },
  modalPrimary: {
    paddingVertical: rs(10),
    paddingHorizontal: rs(14),
    borderRadius: rs(10),
    backgroundColor: "#FF80AB",
  },
  modalPrimaryDisabled: {
    opacity: 0.55,
  },
  modalPrimaryText: {
    color: "#fff",
    fontSize: rf(12),
    fontWeight: "700",
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: rs(12),
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
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
  avatarLogo: {
    width: rs(30),
    height: rs(30),
  },

  avatarText: {
    fontSize: rf(18),
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

  emptyBox: {
    alignItems: "center",
    marginTop: rs(40),
    gap: rs(10),
  },

  emptyText: {
    fontSize: rf(14),
    color: "#AD1457",
    fontWeight: "600",
  },
});
