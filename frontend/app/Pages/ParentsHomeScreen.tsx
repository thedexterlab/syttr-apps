import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LocationObjectCoords, LocationSubscription } from "expo-location";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BASE_URL,
  apiRequest,
  getFavoriteSyttrs,
  isUserRejectedFromSources,
  isUserVerifiedFromSources,
} from "../Api";
import { resolveSessionImageUrl } from "../../lib/nannySessionProfile";
import { geocodeAddress } from "../utils/geocodeAddress";
import { fetchUnreadParentRequestCount } from "../../lib/parentRequestNotifications";
import { fetchUnreadConversationCount } from "../../lib/chatUnreadCount";
import { hp, rf, rs, wp } from "../utils/responsive";
import { Location } from "../utils/safeLocation";
import { MapView, Marker } from "../../lib/WebSafeMap";

type Props = {
  onLogout?: () => void;
  onCalendarPress?: () => void;
  onSettings?: () => void;
  onPostJobPress?: () => void;
  onNotifications?: () => void;
  onJobRequests?: () => void;
  onChat?: () => void;
  onFindNanny?: (nanny?: FavoriteNanny) => void;
  onGetVerified?: () => void;
  onBlacklisted?: () => void;
};

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type FavoriteNanny = {
  id: number | string;
  favorite_id?: number | string;
  syttr_user_id?: number | string;
  fullname?: string;
  name?: string;
  city?: string;
  address?: string;
  experience?: number | string;
  age?: number | string;
  profile_image?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  rating?: number;
  is_available?: boolean;
  skills?: string | null;
  hourly_rate?: number | string | null;
  verification_status?: string | null;
};

const FAVORITES_KEY = "favorite_nannies";

const normalizeFavoriteList = (rows: any[]): FavoriteNanny[] =>
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
      } as FavoriteNanny;
    })
    .filter((item) => String(item.id || "").trim() !== "");

const isNotificationRead = (item?: { isRead?: unknown; is_read?: unknown } | null): boolean => {
  if (!item) return false;
  if (item.isRead === true) return true;

  const raw = item.is_read;
  if (raw === true || raw === 1 || raw === "1") return true;
  if (typeof raw === "string" && raw.toLowerCase() === "true") return true;
  return false;
};

const ParentHomeScreen: React.FC<Props> = ({
  onLogout,
  onCalendarPress,
  onSettings,
  onPostJobPress,
  onNotifications,
  onJobRequests,
  onChat,
  onFindNanny,
  onGetVerified,
  onBlacklisted,
}) => {
  const insets = useSafeAreaInsets();
  const baseDelta = 0.08;
  const [locationLabel, setLocationLabel] = useState("Search for Syttrs near you");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [webMapQuery, setWebMapQuery] = useState<string | null>(null);
  const [notificationCount, setNotificationCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [verificationStatus, setVerificationStatus] = useState<"verified" | "pending" | "unverified">("unverified");
  const [tazStatus, setTazStatus] = useState<string | null>(null);
  const [region, setRegion] = useState<Region>({
    latitude: 39.809734,
    longitude: -98.55562,
    latitudeDelta: 8,
    longitudeDelta: 8,
  });
  const [isLocating, setIsLocating] = useState(false);
  const watcher = useRef<LocationSubscription | null>(null);
  const locateRequestId = useRef(0);
  const nannyGeoCacheRef = useRef<Record<string, { latitude: number; longitude: number }>>({});
  const reverseGeocodeCacheRef = useRef<Record<string, string>>({});
  const lastReverseGeocodeKeyRef = useRef<string | null>(null);
  const lastReverseGeocodeAtRef = useRef(0);

  const [favorites, setFavorites] = useState<FavoriteNanny[]>([]);
  const [nearbyNannies, setNearbyNannies] = useState<FavoriteNanny[]>([]);
  const [distanceMiles, setDistanceMiles] = useState<number>(25);
  const [minRating, setMinRating] = useState<number>(0);
  const [availableOnly, setAvailableOnly] = useState<boolean>(true);
  const [skillsFilter, setSkillsFilter] = useState<string>("");
  const [showFavorites, setShowFavorites] = useState(false);
  const bottomBarPadding = Math.max(8, insets.bottom);
  const bottomBarHeight = rs(60) + bottomBarPadding;
  const bottomBarOffset = 0;
  const cardsBottom = bottomBarHeight + rs(4);
  const verifyBottom = Math.max(rs(220), cardsBottom + rs(136));
  const isActionDisabled = verificationStatus !== "verified";
  const tazStatusLabel = String(tazStatus || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

  useEffect(() => {
    return () => {
      watcher.current?.remove?.();
    };
  }, []);

  const normalizeStatus = (raw?: string | null): "verified" | "pending" | "unverified" => {
    const val = (raw || "").toLowerCase().trim();
    if (
      val === "verified" ||
      val === "approved" ||
      val.includes("accept")
    ) {
      return "verified";
    }
    if (
      val === "app-pending" ||
      val === "pending" ||
      val === "completed" ||
      val === "quickapp-completed" ||
      val.includes("background_check") ||
      val.includes("background check") ||
      val.includes("admin_approval_pending") ||
      val.includes("admin approval pending") ||
      val.includes("payment_required") ||
      val.includes("payment required") ||
      val.includes("quickapp.created") ||
      val.includes("order.quickapp.completed")
    )
      return "pending";
    return "unverified";
  };

  const fetchTazStatus = async (): Promise<boolean> => {
    try {
      const [userId, token] = await Promise.all([
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("token"),
      ]);
      if (!userId) return false;

      const authHeaders: Record<string, string> = {};
      if (token) {
        authHeaders.Authorization = `Bearer ${token.replace(/"/g, "").trim()}`;
      }

      // First check local profile status (blacklist/admin state).
      const profileData = await apiRequest<any>("profile-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ user_id: String(userId) }),
      }).catch(() => null);
      const profileVerifiedFlag =
        typeof profileData?.is_verified === "boolean"
          ? profileData.is_verified
          : typeof profileData?.data?.is_verified === "boolean"
          ? profileData.data.is_verified
          : null;
      const profileVerificationRequired =
        typeof profileData?.verification_required === "boolean"
          ? profileData.verification_required
          : typeof profileData?.data?.verification_required === "boolean"
          ? profileData.data.verification_required
          : null;
      const profileStatus = String(
        profileData?.status || profileData?.approval_status || ""
      )
        .trim()
        .toLowerCase();
      const profileIsVerified =
        isUserVerifiedFromSources({
          profileStatus,
          isVerified: profileVerifiedFlag,
          verificationRequired: profileVerificationRequired,
        });

      if (profileStatus === "blacklisted") {
        setTazStatus("blacklisted");
        await AsyncStorage.setItem("user_verification_status", "blacklisted");
        onBlacklisted?.();
        return true;
      }
      if (
        profileVerificationRequired === true ||
        (profileVerificationRequired !== false && profileVerifiedFlag === false)
      ) {
        const pendingStatus = profileStatus && profileStatus !== "unknown" ? profileStatus : "pending";
        setTazStatus(pendingStatus);
        setVerificationStatus(normalizeStatus(pendingStatus));
        await AsyncStorage.setItem("user_verification_status", pendingStatus);
        onGetVerified?.();
        return true;
      }
      if (profileIsVerified) {
        setTazStatus("approved");
        setVerificationStatus("verified");
        await AsyncStorage.setItem("user_verification_status", "approved");
        return true;
      }

      const data = await apiRequest<any>("taz/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ user_id: String(userId) }),
      }).catch(() => null);
      const orders = Array.isArray(data?.orders) ? data.orders : [];
      const latestOrder = orders[0] || null;
      const eventStatus = String(
        latestOrder?.normalized_status ||
          latestOrder?.status ||
          data?.status ||
          ""
      )
        .trim()
        .toLowerCase();
      const decisionStatus = String(
        latestOrder?.response_order_status ||
          latestOrder?.decision_status ||
          ""
      )
        .trim()
        .toLowerCase();

      if (
        isUserRejectedFromSources({
          tazDecisionStatus: decisionStatus,
          tazEventStatus: eventStatus,
          tazStatus: String(data?.status || "").trim().toLowerCase(),
        })
      ) {
        setTazStatus("blacklisted");
        await AsyncStorage.setItem("user_verification_status", "blacklisted");
        onBlacklisted?.();
        return true;
      }

      if (
        isUserVerifiedFromSources({
          tazDecisionStatus: decisionStatus,
          tazEventStatus: eventStatus,
          tazStatus: String(data?.status || "").trim().toLowerCase(),
        })
      ) {
        setTazStatus("approved");
        setVerificationStatus("verified");
        await AsyncStorage.setItem("user_verification_status", "approved");
        return true;
      }

      if (!data?.success || !orders.length) {
        const fallbackStatus =
          profileStatus && profileStatus !== "unknown" ? profileStatus : "unverified";
        setTazStatus(fallbackStatus === "unverified" ? null : fallbackStatus);
        setVerificationStatus(normalizeStatus(fallbackStatus));
        await AsyncStorage.setItem("user_verification_status", fallbackStatus);
        return true;
      }

      const latestStatus =
        eventStatus && eventStatus !== "unknown"
          ? eventStatus
          : profileStatus && profileStatus !== "unknown"
          ? profileStatus
          : "";

      if (latestStatus === "blacklisted") {
        setTazStatus("blacklisted");
        await AsyncStorage.setItem("user_verification_status", "blacklisted");
        onBlacklisted?.();
        return true;
      }

      if (latestStatus) {
        const nextStatus =
          latestStatus.includes("order.quickapp.completed") ||
          latestStatus.includes("quickapp.completed")
            ? "pending"
            : latestStatus;
        setTazStatus(nextStatus);
        await AsyncStorage.setItem("user_verification_status", nextStatus);
        setVerificationStatus(normalizeStatus(nextStatus));
        return true;
      } else if (profileStatus) {
        await AsyncStorage.setItem("user_verification_status", profileStatus);
        setVerificationStatus(normalizeStatus(profileStatus));
        return true;
      }
    } catch {
      // silent fail
    }

    return false;
  };

  const normalizeAddressPart = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

  const buildLocationLabel = (loc: {
    name?: string | null;
    street?: string | null;
    city?: string | null;
    postalCode?: string | null;
  }) => {
    const parts = [loc.name, loc.street, loc.city, loc.postalCode];
    const dedupedRaw: string[] = [];
    const dedupedNorm: string[] = [];

    for (const part of parts) {
      const raw = String(part || "").trim();
      if (!raw) continue;

      const normalized = normalizeAddressPart(raw);
      if (!normalized) continue;

      const duplicateIndex = dedupedNorm.findIndex(
        (seen) => seen === normalized || seen.includes(normalized) || normalized.includes(seen)
      );

      if (duplicateIndex === -1) {
        dedupedRaw.push(raw);
        dedupedNorm.push(normalized);
        continue;
      }

      if (normalized.length > dedupedNorm[duplicateIndex].length) {
        dedupedRaw[duplicateIndex] = raw;
        dedupedNorm[duplicateIndex] = normalized;
      }
    }

    return dedupedRaw.join(", ");
  };

  const updateAddressLabel = async (coords: LocationObjectCoords, fallbackLabel?: string) => {
    if (!coords?.latitude || !coords?.longitude) return;

    const cacheKey = `${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)}`;
    const cachedLabel = reverseGeocodeCacheRef.current[cacheKey];
    if (cachedLabel) {
      setLocationLabel(cachedLabel);
      await AsyncStorage.multiSet([
        ["last_location_label", cachedLabel],
        ["last_location_lat", String(coords.latitude)],
        ["last_location_lon", String(coords.longitude)],
      ]).catch(() => {});
      return;
    }

    const now = Date.now();
    const isSameArea = lastReverseGeocodeKeyRef.current === cacheKey;
    const isRateLimitedWindow = now - lastReverseGeocodeAtRef.current < 15000;
    if (isSameArea || isRateLimitedWindow) {
      if (fallbackLabel?.trim()) {
        setLocationLabel(fallbackLabel.trim());
        await AsyncStorage.setItem("last_location_label", fallbackLabel.trim()).catch(() => {});
      }
      return;
    }

    lastReverseGeocodeKeyRef.current = cacheKey;
    lastReverseGeocodeAtRef.current = now;

    try {
      const res = await Location.reverseGeocodeAsync({
        latitude: coords.latitude,
        longitude: coords.longitude,
      });

      if (res?.[0]) {
        const loc = res[0];
        const label = buildLocationLabel(loc);
        if (label) {
          reverseGeocodeCacheRef.current[cacheKey] = label;
          setLocationLabel(label);
          await AsyncStorage.multiSet([
            ["last_location_label", label],
            ["last_location_lat", String(coords.latitude)],
            ["last_location_lon", String(coords.longitude)],
          ]);
          return;
        }
      }
    } catch (e) {
      console.warn("Reverse geocoding failed:", e);
    }

    if (fallbackLabel?.trim()) {
      setLocationLabel(fallbackLabel.trim());
      await AsyncStorage.setItem("last_location_label", fallbackLabel.trim()).catch(() => {});
    }
  };

  const centerOnCoords = (coords: LocationObjectCoords, zoomed = false) => {
    if (!coords?.latitude || !coords?.longitude) return;

    setRegion((prev) => ({
      latitude: coords.latitude,
      longitude: coords.longitude,
      latitudeDelta: zoomed ? baseDelta : Math.max(Math.min(prev.latitudeDelta * 0.6, baseDelta), 0.02),
      longitudeDelta: zoomed ? baseDelta : Math.max(Math.min(prev.longitudeDelta * 0.6, baseDelta), 0.02),
    }));
  };

  const hydrateLastLocation = async () => {
    try {
      const [[, label], [, lat], [, lon]] = await AsyncStorage.multiGet([
        "last_location_label",
        "last_location_lat",
        "last_location_lon",
      ]);

      if (label) setLocationLabel(label);
      const latNum = lat ? Number(lat) : NaN;
      const lonNum = lon ? Number(lon) : NaN;

      if (Number.isFinite(latNum) && Number.isFinite(lonNum)) {
        setRegion((prev) => ({ ...prev, latitude: latNum, longitude: lonNum }));
      }
    } catch {}
  };

  const ensureLocationPermission = async () => {
    if (Platform.OS === "web") return true;

    try {
      const getForegroundPermissionsAsync = (Location as any).getForegroundPermissionsAsync;
      if (typeof getForegroundPermissionsAsync === "function") {
        const current = await getForegroundPermissionsAsync();
        if (current?.status === "granted") return true;
      }
    } catch {
      // fall through to explicit request
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      return false;
    }

    try {
      const hasServicesEnabledAsync = (Location as any).hasServicesEnabledAsync;
      if (typeof hasServicesEnabledAsync === "function") {
        const servicesEnabled = await hasServicesEnabledAsync();
        if (!servicesEnabled) {
          Alert.alert("Location services off", "Turn on device location services and try again.");
          return false;
        }
      }
    } catch {
      // ignore service checks if unsupported
    }

    // Android: request high-accuracy network provider when available.
    if (Platform.OS === "android") {
      try {
        const enableNetworkProviderAsync = (Location as any).enableNetworkProviderAsync;
        if (typeof enableNetworkProviderAsync === "function") {
          await enableNetworkProviderAsync();
        }
      } catch {
        // non-blocking
      }
    }

    return true;
  };

  const handleLocateMe = async (options?: { silent?: boolean }) => {
    const requestId = ++locateRequestId.current;
    const isSilent = !!options?.silent;
    if (!isSilent) setIsLocating(true);
    if (!isSilent) setSearchQuery("");

    try {
      const allowed = await ensureLocationPermission();
      if (!allowed) return;

      if (requestId !== locateRequestId.current) return;
      let hasAnyFix = false;

      if (Platform.OS !== "web") {
        try {
          const getLastKnownPositionAsync = (Location as any).getLastKnownPositionAsync;
          if (typeof getLastKnownPositionAsync === "function") {
            const lastKnown = await getLastKnownPositionAsync({
              maxAge: 24 * 60 * 60 * 1000,
            });
            if (requestId === locateRequestId.current && lastKnown?.coords) {
              setWebMapQuery(null);
              centerOnCoords(lastKnown.coords, true);
              updateAddressLabel(lastKnown.coords).catch(() => {});
              hasAnyFix = true;
            }
          }
        } catch {
          // ignore stale cache issues and continue to live location
        }
      }

      let current: { coords: LocationObjectCoords } | null = null;
      try {
        current = (await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          maximumAge: 60_000,
          timeout: 12_000,
        } as any)) as { coords: LocationObjectCoords };
      } catch {
        try {
          current = (await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
            timeout: 18_000,
          } as any)) as { coords: LocationObjectCoords };
        } catch {
          current = (await Location.getCurrentPositionAsync({
            accuracy: (Location as any)?.Accuracy?.Low ?? Location.Accuracy.Balanced,
            timeout: 20_000,
          } as any)) as { coords: LocationObjectCoords };
        }
      }
      if (requestId !== locateRequestId.current) return;

      if (current?.coords) {
        setWebMapQuery(null);
        centerOnCoords(current.coords, true);
        await updateAddressLabel(current.coords);
        hasAnyFix = true;
      }

      if (Platform.OS !== "web") {
        try {
          watcher.current?.remove?.();
          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, timeInterval: 7000, distanceInterval: 20 },
            (pos) => {
              if (requestId !== locateRequestId.current) return;
              centerOnCoords(pos.coords);
              updateAddressLabel(pos.coords).catch(() => {});
            }
          );
          watcher.current = sub;
        } catch {
          // non-blocking
        }
      }

      if (!hasAnyFix && !isSilent) {
        Alert.alert("Location Error", "Unable to get current location.");
      }
    } catch {
      if (!isSilent) {
        Alert.alert("Location Error", "Unable to get current location.");
      }
    } finally {
      if (!isSilent) setIsLocating(false);
    }
  };

  const handleSearchLocation = async () => {
    const query = searchQuery.trim();
    if (!query) return handleLocateMe();

    setIsSearching(true);
    Keyboard.dismiss();
    ++locateRequestId.current;
    watcher.current?.remove?.();
    watcher.current = null;

    try {
      if (Platform.OS === "web") {
        setWebMapQuery(query);
        setLocationLabel(query);

        const found = await geocodeAddress(query);
        if (found?.latitude && found?.longitude) {
          const coords: LocationObjectCoords = {
            latitude: found.latitude,
            longitude: found.longitude,
            altitude: null,
            accuracy: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          };
          centerOnCoords(coords, true);
          await updateAddressLabel(coords, found.formattedAddress || query);
        }
        setSearchQuery("");
        return;
      }

      // Native path
      const found = await geocodeAddress(query);
      const lat = Number(found?.latitude);
      const lon = Number(found?.longitude);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        Alert.alert("Not found", "Try a city, ZIP, or full address.");
        return;
      }

      const coords: LocationObjectCoords = {
        latitude: lat,
        longitude: lon,
        altitude: null,
        accuracy: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      };

      setWebMapQuery(null);
      centerOnCoords(coords, true);
      await updateAddressLabel(coords, found?.formattedAddress || query);
      setSearchQuery("");
    } catch {
      Alert.alert("Search failed", "Couldn't find that location.");
    } finally {
      setIsSearching(false);
    }
  };

  const loadFavorites = async () => {
    const [userId, token] = await Promise.all([
      AsyncStorage.getItem("user_id"),
      AsyncStorage.getItem("token"),
    ]);

    try {
      const remote = await getFavoriteSyttrs(userId || undefined, token || undefined);
      const rows = Array.isArray((remote as any)?.data)
        ? (remote as any).data
        : Array.isArray(remote)
          ? remote
          : [];
      const normalized = normalizeFavoriteList(rows);
      setFavorites(normalized);
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(normalized));
      return;
    } catch {
      // fallback to cache
    }

    try {
      const raw = await AsyncStorage.getItem(FAVORITES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const normalized = normalizeFavoriteList(Array.isArray(parsed) ? parsed : []);
      setFavorites(normalized);
    } catch {
      setFavorites([]);
    }
  };

  const fetchNotificationCount = async () => {
    try {
      const [token, apiKey, userId] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("api_key"),
        AsyncStorage.getItem("user_id"),
      ]);

      if (!userId) {
        setNotificationCount(0);
        return;
      }

      const headers: HeadersInit = { Accept: "application/json" };
      if (token) headers.Authorization = `Bearer ${token.replace(/"/g, "").trim()}`;
      if (apiKey) headers["x-api-key"] = apiKey;

      const res = await fetch(`${BASE_URL}notifications?user_id=${encodeURIComponent(userId)}`, { headers });
      const json = await res.json().catch(() => ({}));

      const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      const unread = data.filter((item: any) => !isNotificationRead(item));
      setNotificationCount(unread.length);
    } catch {
      setNotificationCount(0);
    }
  };

  const fetchRequestCount = async () => {
    try {
      const count = await fetchUnreadParentRequestCount();
      setRequestCount(count);
    } catch {
      setRequestCount(0);
    }
  };

  const loadNearbyNannies = async () => {
    try {
      const token = await AsyncStorage.getItem("token");
      const params = new URLSearchParams({
        page: "1",
        per_page: "100",
        latitude: String(region.latitude),
        longitude: String(region.longitude),
        radius_miles: String(distanceMiles),
      });
      const res = await fetch(`${BASE_URL}nannies?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token.replace(/"/g, "").trim()}` } : {}),
        },
      });
      const json = await res.json().catch(() => ({}));
      const rows = Array.isArray(json?.data?.data)
        ? json.data.data
        : Array.isArray(json?.data)
          ? json.data
          : [];

      const normalized: FavoriteNanny[] = rows
        .map((row: any) => ({
          id: row?.id ?? row?.nanny_id,
          syttr_user_id: row?.nanny_id ?? row?.id,
          fullname: row?.fullname ?? row?.name ?? "",
          name: row?.name ?? row?.fullname ?? "",
          city: row?.city ?? "",
          address: row?.address ?? "",
          experience: row?.experience ?? row?.experience_years,
          profile_image: row?.profile_image ?? row?.user_image_url ?? null,
          latitude: row?.latitude ?? null,
          longitude: row?.longitude ?? null,
          rating: Number(row?.avg_rating ?? row?.rating ?? 0) || 0,
          is_available: !!row?.is_available,
          skills: row?.skills ?? row?.bio ?? "",
          hourly_rate: row?.hourly_rate ?? null,
          verification_status: row?.verification_status ?? null,
        }))
        .filter((n: FavoriteNanny) => String(n.id || "").trim() !== "");

      let geocodeBudget = 30;
      const enriched = await Promise.all(
        normalized.map(async (nanny) => {
          const lat = Number(nanny.latitude);
          const lon = Number(nanny.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lon)) return nanny;

          const locationText = String((nanny as any).address || nanny.city || "").trim();
          if (!locationText) return nanny;

          const cacheKey = locationText.toLowerCase();
          const cached = nannyGeoCacheRef.current[cacheKey];
          if (cached) {
            return {
              ...nanny,
              latitude: cached.latitude,
              longitude: cached.longitude,
            };
          }

          if (geocodeBudget <= 0) return nanny;
          geocodeBudget -= 1;

          const found = await geocodeAddress(locationText).catch(() => null);
          const foundLat = Number(found?.latitude);
          const foundLon = Number(found?.longitude);
          if (!Number.isFinite(foundLat) || !Number.isFinite(foundLon)) {
            return nanny;
          }

          nannyGeoCacheRef.current[cacheKey] = {
            latitude: foundLat,
            longitude: foundLon,
          };

          return {
            ...nanny,
            latitude: foundLat,
            longitude: foundLon,
          };
        })
      );

      setNearbyNannies(enriched);
    } catch {
      setNearbyNannies([]);
    }
  };

  const fetchMessageBadgeCount = async () => {
    try {
      const count = await fetchUnreadConversationCount();
      setMessageCount(count);
    } catch {
      setMessageCount(0);
    }
  };

  useEffect(() => {
    hydrateLastLocation().finally(() => handleLocateMe({ silent: true }));
    loadFavorites();
    fetchNotificationCount();
    fetchRequestCount();
    fetchMessageBadgeCount();

    let active = true;
    const refreshVerificationStatus = async () => {
      const resolved = await fetchTazStatus();
      if (!active || resolved) return;

      const stored = await AsyncStorage.getItem("user_verification_status");
      if (active) {
        setVerificationStatus(normalizeStatus(stored));
      }
    };

    void refreshVerificationStatus();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        fetchTazStatus();
        fetchNotificationCount();
        fetchRequestCount();
        fetchMessageBadgeCount();
        loadFavorites();
      }
    });

    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || webMapQuery) return;
    const interval = setInterval(() => handleLocateMe({ silent: true }), 120000);
    return () => clearInterval(interval);
  }, [webMapQuery]);

  useEffect(() => {
    loadNearbyNannies();
  }, [region.latitude, region.longitude, distanceMiles, minRating, availableOnly, skillsFilter]);

  return (
    <View style={styles.container}>
      <View style={styles.map}>
        <MapView
          style={StyleSheet.absoluteFillObject}
          region={region}
          showsUserLocation
          showsMyLocationButton={false}
        >
          <Marker
            coordinate={{ latitude: region.latitude, longitude: region.longitude }}
          />
          {nearbyNannies.map((nanny, idx) => {
            const lat = Number(nanny.latitude);
            const lon = Number(nanny.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            const imageUri = resolveSessionImageUrl(nanny.profile_image);
            return (
              <Marker
                key={`${String(nanny.id)}-${idx}`}
                coordinate={{ latitude: lat, longitude: lon }}
                onPress={() => onFindNanny?.(nanny)}
              >
                <View style={styles.markerAvatarWrap}>
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.markerAvatar} />
                  ) : (
                    <View style={styles.markerAvatarFallback}>
                      <Ionicons name="person" size={14} color="#FF80AB" />
                    </View>
                  )}
                </View>
              </Marker>
            );
          })}
        </MapView>
      </View>

      <View
        style={[
          styles.searchBar,
          { top: Math.max(insets.top + rs(8), Math.min(Math.max(hp(7), 40), 88)) },
        ]}
      >
        <Ionicons name="search" size={20} color="#FF80AB" />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={locationLabel}
          placeholderTextColor="#999"
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={handleSearchLocation}
          editable={!isLocating && !isSearching}
        />
        <TouchableOpacity
          style={styles.searchIconBtn}
          onPress={searchQuery.trim() ? handleSearchLocation : () => void handleLocateMe()}
          disabled={isLocating || isSearching}
        >
          {isLocating || isSearching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name={searchQuery.trim() ? "search" : "navigate"} size={20} color="#fff" />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.searchIconBtnPink}
          onPress={async () => {
            if (!showFavorites) await loadFavorites();
            setShowFavorites((p) => !p);
          }}
          accessibilityLabel="View favorite Syttrs"
        >
          <Ionicons name="heart" size={20} color="#FF80AB" />
        </TouchableOpacity>
      </View>

     

      {showFavorites && (
        <View
          style={[
            styles.kidsDropdown,
            { top: Math.max(insets.top + rs(64), Math.min(Math.max(hp(13), 88), 156)) },
          ]}
        >
          {favorites.length ? (
            favorites.map((nanny, idx) => {
              const displayName = nanny.fullname || nanny.name || "Syttr";
                return (
                  <TouchableOpacity
                  key={`${String(nanny.id ?? "nanny")}-${idx}`}
                    style={styles.kidRow}
                    onPress={() => {
                    setShowFavorites(false);
                    onFindNanny?.(nanny);
                  }}
                >
                  <View style={styles.kidAvatar}>
                    <Ionicons name="heart" size={16} color="#FF80AB" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kidName}>{displayName}</Text>
                    <Text style={styles.kidMeta}>{nanny.city || "Tap to view profile"}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <Text style={styles.kidEmpty}>No favorite Syttrs yet</Text>
          )}
        </View>
      )}

      {verificationStatus !== "verified" && (
          <View
            style={[
              styles.verifyBanner,
              { bottom: verifyBottom },
            ]}
          >
            <View style={styles.verifyIcon}>
              <Ionicons name="shield-checkmark" size={16} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.verifyTitle}>
                {verificationStatus === "pending" ? "Verification in progress" : "Unverified account"}
              </Text>
              <Text style={styles.verifySub}>
                {verificationStatus === "pending"
                  ? tazStatusLabel
                    ? `Status: ${tazStatusLabel}. We are reviewing your verification.`
                    : "We are reviewing your verification."
                  : "Complete a background check to become verified."}
              </Text>
            </View>
            <TouchableOpacity style={styles.verifyBtn} onPress={onGetVerified} disabled={!onGetVerified}>
              <Text style={styles.verifyBtnText}>
                {verificationStatus === "pending" ? "Details" : "Get verified"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

      <View
        style={[
          styles.cardsRow,
          { bottom: cardsBottom },
        ]}
      >
        <TouchableOpacity
          style={[styles.card, isActionDisabled && styles.cardDisabled]}
          onPress={onPostJobPress}
          disabled={isActionDisabled}
        >
          <View style={styles.cardIconPink}>
            <Ionicons name="add" size={24} color="#FF80AB" />
          </View>
          <Text style={styles.cardTitle}>Post a Job</Text>
          <Text style={styles.cardSub}>Find the perfect Syttr</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.card, isActionDisabled && styles.cardDisabled]}
          onPress={() => onFindNanny?.()}
          disabled={isActionDisabled}
        >
          <View style={styles.cardIconBlue}>
            <Ionicons name="search" size={24} color="#4FC3F7" />
          </View>
          <Text style={styles.cardTitleBlue}>Find a Syttr</Text>
          <Text style={styles.cardSub}>Browse Syttrs</Text>
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.bottomBar,
          {
            bottom: bottomBarOffset,
            paddingBottom: bottomBarPadding,
            height: bottomBarHeight,
          },
        ]}
      >
        <Tab icon="home" label="Home" active />
        <Tab icon="chatbubble" label="Chat" onPress={onChat} badgeCount={messageCount} />
        <Tab icon="briefcase" label="Requests" onPress={onJobRequests} badgeCount={requestCount} />
        <Tab icon="notifications" label="Alerts" onPress={onNotifications} badgeCount={notificationCount} />
        <Tab icon="calendar" label="Calendar" onPress={onCalendarPress} />
        <Tab icon="settings" label="Settings" onPress={onSettings} />
      </View>
    </View>
  );
};

export default ParentHomeScreen;

// Tab Component
const Tab = ({
  icon,
  label,
  active = false,
  badgeCount,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  badgeCount?: number;
  onPress?: () => void;
}) => {
  const showBadge = typeof badgeCount === "number" && badgeCount > 0;
  const highlight = showBadge && !active;

  return (
    <TouchableOpacity style={styles.tabItem} onPress={onPress}>
      <View style={styles.tabIconWrap}>
        <Ionicons name={icon} size={22} color={active || highlight ? "#FF80AB" : "#999"} />
        {showBadge && (
          <View style={styles.tabBadge}>
            <Text style={styles.tabBadgeText}>{badgeCount! > 9 ? "9+" : badgeCount}</Text>
          </View>
        )}
      </View>
      <Text numberOfLines={1} style={[styles.tabLabel, (active || highlight) && styles.tabActive]}>{label}</Text>
    </TouchableOpacity>
  );
};

// Styles (added web placeholder styles)
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", margin: 0, padding: 0 },
  map: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#E3F2FD",
    margin: 0,
    padding: 0,
  },
  markerAvatarWrap: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  markerAvatar: {
    width: "100%",
    height: "100%",
  },
  markerAvatarFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  webPlaceholder: {
    flex: 1,
    backgroundColor: "#E3F2FD",
    justifyContent: "center",
    alignItems: "center",
    padding: rs(20),
  },
  webPlaceholderText: {
    fontSize: rf(18),
    fontWeight: "600",
    color: "#333",
    textAlign: "center",
    marginBottom: rs(12),
  },
  webPlaceholderSub: {
    fontSize: rf(14),
    color: "#666",
    textAlign: "center",
  },
  // ... rest of your styles remain unchanged
  searchBar: {
    position: "absolute",
    top: Math.min(Math.max(hp(7), 40), 88),
    left: wp(4),
    right: wp(4),
    backgroundColor: "#fff",
    borderRadius: rs(30),
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: wp(4),
    paddingVertical: hp(1.4),
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  searchInput: { flex: 1, marginLeft: wp(2.5), fontSize: rf(15), fontFamily: "PlayfairDisplay" },
  searchIconBtn: {
    backgroundColor: "#4FC3F7",
    padding: rs(8),
    borderRadius: rs(20),
    marginLeft: wp(2),
    width: wp(8.5),
    height: wp(8.5),
    alignItems: "center",
    justifyContent: "center",
  },
  searchIconBtnPink: {
    backgroundColor: "#FFEFF5",
    padding: rs(8),
    borderRadius: rs(20),
    marginLeft: wp(2),
    width: wp(8.5),
    height: wp(8.5),
    alignItems: "center",
    justifyContent: "center",
  },
  kidsDropdown: {
    position: "absolute",
    top: Math.min(Math.max(hp(13), 88), 156),
    left: wp(4),
    right: wp(4),
    backgroundColor: "#fff",
    borderRadius: rs(14),
    padding: rs(12),
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: rs(0), height: rs(2) },
    elevation: 6,
  },
  filterRow: {
    position: "absolute",
    left: wp(4),
    right: wp(4),
    flexDirection: "row",
    alignItems: "center",
    gap: wp(2),
  },
  filterChip: {
    backgroundColor: "#fff",
    borderRadius: rs(14),
    paddingHorizontal: wp(2.8),
    paddingVertical: hp(0.8),
    borderWidth: 1,
    borderColor: "#E6D5DB",
  },
  filterChipActive: {
    borderColor: "#FF80AB",
    backgroundColor: "#FFF1F6",
  },
  filterChipText: {
    color: "#A03A6A",
    fontSize: rf(11),
    fontWeight: "700",
    fontFamily: "PlayfairDisplay",
  },
  skillsInput: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "#E6D5DB",
    paddingHorizontal: wp(3),
    paddingVertical: hp(0.8),
    fontSize: rf(11),
    color: "#4A0033",
    fontFamily: "PlayfairDisplay",
  },
  kidRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: hp(1),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#F3E0E7",
  },
  kidAvatar: {
    width: wp(7),
    height: wp(7),
    borderRadius: rs(14),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
    marginRight: wp(2.5),
  },
  kidName: { color: "#4A0033", fontWeight: "700", fontSize: rf(14) },
  kidMeta: { color: "#AD1457", fontSize: rf(12) },
  kidEmpty: { textAlign: "center", color: "#AD1457", paddingVertical: rs(8) },
  loadingText: { color: "#fff", fontWeight: "700", fontSize: rf(12) },

  cardsRow: { position: "absolute", bottom: hp(11.5), left: wp(4), right: wp(4), flexDirection: "row", gap: wp(3.5) },
  verifyBanner: {
    position: "absolute",
    left: wp(4),
    right: wp(4),
    bottom: hp(27.5),
    backgroundColor: "#FFF3F8",
    borderRadius: rs(18),
    padding: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.3)",
    flexDirection: "row",
    alignItems: "center",
    gap: wp(2.5),
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: rs(0), height: rs(2) },
    elevation: 6,
  },
  verifyIcon: {
    width: wp(8.5),
    height: wp(8.5),
    borderRadius: rs(17),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
  },
  verifyTitle: { fontSize: rf(14), fontWeight: "700", color: "#C2185B", fontFamily: "PlayfairDisplay" },
  verifySub: { fontSize: rf(12), color: "#6B4350", marginTop: hp(0.2), fontFamily: "PlayfairDisplay" },
  verifyBtn: { backgroundColor: "#FFE4EC", paddingVertical: hp(0.95), paddingHorizontal: wp(3), borderRadius: rs(12) },
  verifyBtnText: { color: "#C2185B", fontWeight: "700", fontSize: rf(11), fontFamily: "PlayfairDisplay" },
  card: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: rs(20),
    padding: rs(16),
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  cardDisabled: { opacity: 0.6 },
  cardIconPink: {
    width: wp(12),
    height: wp(12),
    borderRadius: rs(24),
    backgroundColor: "#FFEFF5",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: hp(1.2),
  },
  cardIconBlue: {
    width: wp(12),
    height: wp(12),
    borderRadius: rs(24),
    backgroundColor: "#E1F5FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: hp(1.2),
  },
  cardTitle: { fontSize: rf(16), fontWeight: "700", color: "#FF80AB", fontFamily: "PlayfairDisplay" },
  cardTitleBlue: { fontSize: rf(16), fontWeight: "700", color: "#0277BD", fontFamily: "PlayfairDisplay" },
  cardSub: { fontSize: rf(13), color: "#777", marginTop: hp(0.45), fontFamily: "PlayfairDisplay" },

  bottomBar: {
    position: "absolute",
    bottom: rs(0),
    left: rs(0),
    right: rs(0),
    backgroundColor: "#fff",
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: wp(2),
    paddingTop: hp(1.2),
    borderTopLeftRadius: rs(20),
    borderTopRightRadius: rs(20),
    elevation: 20,
  },
  tabItem: { flex: 1, minWidth: rs(0), alignItems: "center", justifyContent: "center" },
  tabIconWrap: { position: "relative" },
  tabBadge: {
    position: "absolute",
    top: -hp(0.7),
    right: -wp(2.5),
    minWidth: wp(4),
    height: wp(4),
    borderRadius: rs(8),
    backgroundColor: "#FF3B7B",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: wp(1),
  },
  tabBadgeText: { color: "#fff", fontSize: rf(9), fontWeight: "700" },
  tabLabel: { fontSize: rf(11), color: "#999", marginTop: hp(0.45), fontFamily: "PlayfairDisplay" },
  tabActive: { color: "#FF80AB", fontWeight: "700", fontFamily: "PlayfairDisplay" },
});
