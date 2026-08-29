import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
} from "react-native";
import { rf, rs } from "../_utils/responsive";
import { FileSystem } from "../_utils/safeFileSystem";
import SafeScreen from "../_utils/SafeScreen";
import { ImagePicker } from "../_utils/safeImagePicker";
import { Location } from "../_utils/safeLocation";

import { Fonts } from "@/constants/theme";
import AvailableStateSelector from "@/components/AvailableStateSelector";
import { GOOGLE_MAPS_KEY, login as loginRequest, signupClient, updateClientProfile, type AvailableState } from "../_Api";
import { addressComponentsMatchState, findAvailableState, predictionMatchesState } from "@/lib/enabledStateLocation";

/* ---------- ICON HELPER ---------- */

type IconProps = {
  name: React.ComponentProps<typeof Ionicons>["name"];
  size?: number;
  color?: string;
};

const Icon: React.FC<IconProps> = ({ name, size = 20, color = "#FF80AB" }) => (
  <Ionicons name={name} size={size} color={color} />
);

const COUNTRY_OPTIONS: string[] = [
  "United States",
  "Canada",
  
];
const STORAGE_KEYS = {
  userName: "user_name",
  userEmail: "user_email",
  signupClientDraft: "signup_client_draft",
  token: "token",
  userId: "user_id",
  legacyId: "id",
} as const;

type LocationSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

const LOCATION_AUTOCOMPLETE_DEBOUNCE_MS = 280;
const LOCATION_AUTOCOMPLETE_LIMIT = 5;

let googleMapsLoader: Promise<void> | null = null;

const loadGoogleMapsScript = (apiKey: string) => {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Google Maps script loader is web-only."));
  }
  const maps = (globalThis as any)?.google?.maps;
  if (maps) return Promise.resolve();
  if (googleMapsLoader) return googleMapsLoader;

  googleMapsLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      `${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps script."));
    document.head.appendChild(script);
  });

  return googleMapsLoader;
};

const IMAGE_MEDIA_TYPE =
  (ImagePicker as any)?.MediaType?.Images ||
  (ImagePicker as any)?.MediaTypeOptions?.Images ||
  "Images";

const resolvePickerMimeType = (asset: any): string => {
  const direct = String(asset?.mimeType || asset?.type || "").trim().toLowerCase();
  if (direct.startsWith("image/")) return direct;

  const source = String(asset?.fileName || asset?.uri || "").toLowerCase();
  if (source.endsWith(".png")) return "image/png";
  if (source.endsWith(".webp")) return "image/webp";
  if (source.endsWith(".gif")) return "image/gif";
  if (source.endsWith(".heic") || source.endsWith(".heif")) return "image/heic";

  return "image/jpeg";
};

/* ---------- SCREEN ---------- */

type Props = {
  navigation?: any;
  onBack?: () => void;
  onNext?: () => void;
  onSuccess?: () => void;
  signupData?: SignupData | null;
};

type SignupData = {
  fullname?: string;
  name?: string;
  email?: string;
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const resolveAuthToken = (payload: any): string =>
  String(
    payload?.token ||
      payload?.access_token ||
      payload?.data?.token ||
      payload?.data?.access_token ||
      ""
  ).trim();
const resolveAuthUserId = (payload: any): string =>
  String(
    payload?.user_id ||
      payload?.data?.user_id ||
      payload?.user?.user_id ||
      payload?.data?.user?.user_id ||
      payload?.user?.id ||
      payload?.data?.user?.id ||
      payload?.id ||
      payload?.data?.id ||
      ""
  ).trim();

const CreateClientProfileScreen: React.FC<Props> = ({
  navigation,
  onBack,
  onNext = () => {},
  onSuccess = () => {},
  signupData = null,
}) => {
  type ProfileImage = { uri: string; name?: string; type?: string };
  const [signupMeta, setSignupMeta] = useState<SignupData | null>(signupData);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [state, setState] = useState("");
  const [availableStates, setAvailableStates] = useState<AvailableState[]>([]);
  const [city, setCity] = useState("");
  const [gender, setGender] = useState("");
  const [kids, setKids] = useState("");
  const [referral, setReferral] = useState("");
  const [about, setAbout] = useState("");
  const [profileImage, setProfileImage] = useState<ProfileImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [loadingLocationSuggestions, setLoadingLocationSuggestions] = useState(false);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const handleKidsInput = (text: string) => {
    setKids(text.replace(/\D/g, ""));
  };

  useEffect(() => {
    if (signupData) setSignupMeta(signupData);
  }, [signupData]);

  useEffect(() => {
    let cancelled = false;

    const applyPrefillName = (fullName: string) => {
      const parts = fullName.trim().split(/\s+/).filter(Boolean);
      const first = parts[0] || "";
      const last = parts.slice(1).join(" ");
      if (!first && !last) return;
      if (first) {
        setFirstName((prev) => (prev.trim() ? prev : first));
      }
      if (last) {
        setLastName((prev) => (prev.trim() ? prev : last));
      }
    };

    const applyPrefillEmail = (value: string) => {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return;
      setEmail((prev) => (prev.trim() ? prev : normalized));
    };
    const applyPrefillPasswords = (pwd?: string, confirm?: string) => {
      const nextPassword = String(pwd || "").trim();
      const nextConfirm = String(confirm || "").trim();
      if (nextPassword) {
        setPassword((prev) => (prev ? prev : nextPassword));
      }
      if (nextConfirm) {
        setConfirmPassword((prev) => (prev ? prev : nextConfirm));
      }
    };

    const activeSignup = signupMeta || signupData;
    const signupName = String(activeSignup?.fullname || activeSignup?.name || "").trim();
    if (signupName) applyPrefillName(signupName);
    const signupEmail = String(activeSignup?.email || "").trim();
    if (signupEmail) applyPrefillEmail(signupEmail);

    (async () => {
      try {
        const [storedName, storedEmail, draftRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.userName),
          AsyncStorage.getItem(STORAGE_KEYS.userEmail),
          AsyncStorage.getItem(STORAGE_KEYS.signupClientDraft),
        ]);
        if (!cancelled && storedName) {
          applyPrefillName(String(storedName).trim());
        }
        if (!cancelled && storedEmail) {
          applyPrefillEmail(String(storedEmail).trim());
        }
        if (!cancelled && !activeSignup && draftRaw) {
          try {
            const parsed = JSON.parse(draftRaw);
            if (parsed && typeof parsed === "object") {
              setSignupMeta(parsed);
              const draftName = String(parsed?.fullname || parsed?.name || "").trim();
              const draftEmail = String(parsed?.email || "").trim();
              const draftPassword = String(parsed?.password || "").trim();
              const draftPasswordConfirmation = String(
                parsed?.password_confirmation || parsed?.confirm || draftPassword
              ).trim();
              if (draftName) applyPrefillName(draftName);
              if (draftEmail) applyPrefillEmail(draftEmail);
              if (draftPassword) applyPrefillPasswords(draftPassword, draftPasswordConfirmation);
            }
          } catch {
            // ignore invalid draft payloads
          }
        }
      } catch {
        // no-op
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signupData, signupMeta]);

  const showError = (msg: string) => Alert.alert("Error", msg);
  const showNotice = (title: string, msg: string) => Alert.alert(title, msg);
  const promptOpenSettings = (title: string, message: string) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Open Settings",
        onPress: () => {
          Linking.openSettings().catch(() => {});
        },
      },
    ]);
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if ((perm as any)?.canAskAgain === false) {
        promptOpenSettings(
          "Gallery permission blocked",
          "Enable Photos permission in app settings to select a profile photo."
        );
        return;
      }
      showNotice("Permission needed", "Gallery access is required to add a photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: IMAGE_MEDIA_TYPE,
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (asset?.uri) {
      setProfileImage({
        uri: asset.uri,
        name: asset.fileName || "avatar.jpg",
        type: resolvePickerMimeType(asset),
      });
    }
  };

  const takePhoto = async () => {
    if (Platform.OS === "web") {
      return pickFromLibrary();
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      if ((perm as any)?.canAskAgain === false) {
        promptOpenSettings(
          "Camera permission blocked",
          "Enable Camera permission in app settings to take a profile photo."
        );
        return;
      }
      showNotice("Permission needed", "Camera access is required to take a photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (asset?.uri) {
      setProfileImage({
        uri: asset.uri,
        name: asset.fileName || "avatar.jpg",
        type: resolvePickerMimeType(asset),
      });
    }
  };

  const choosePhoto = async () => {
    Alert.alert(
      "Profile photo",
      "Add a profile picture",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Take Photo", onPress: takePhoto },
        { text: "Choose from Gallery", onPress: pickFromLibrary },
      ],
      { cancelable: true }
    );
  };

  const mapCountryOption = (country?: string | null, iso?: string | null) => {
    const code = (iso || "").toUpperCase();
    if (code === "US" || code === "USA") return "United States";
    if (code === "CA") return "Canada";
    if (code === "GB" || code === "UK") return "United Kingdom";
    if (code === "AU") return "Australia";
    if (code === "NZ") return "New Zealand";

    const normalized = (country || "").toLowerCase();
    if (normalized.includes("united states") || normalized.includes("usa"))
      return "United States";
    if (normalized.includes("canada")) return "Canada";
    if (normalized.includes("kingdom")) return "United Kingdom";
    if (normalized.includes("australia")) return "Australia";
    if (normalized.includes("zealand")) return "New Zealand";

    return country || "";
  };

  const selectedCountryCode = (value?: string | null) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized.includes("united states") || normalized === "usa") return "us";
    if (normalized.includes("canada")) return "ca";
    return "";
  };

  const formatAddressLine = (
    street?: string,
    city?: string,
    countryName?: string,
    stateName?: string,
  ) => [street, city, stateName, countryName].filter(Boolean).join(", ");

  const extractBestCity = (value: any): string =>
    String(
      value?.city ||
        value?.subregion ||
        value?.region ||
        value?.district ||
        value?.postalCode ||
        ""
    ).trim();

  const applyLocation = (
    addressText?: string,
    countryText?: string,
    coordsText?: string
  ) => {
    const nextAddress = (addressText || "").trim();
    const nextCountry = (countryText || "").trim();
    const fallbackAddress = coordsText?.trim() || "";
    const finalAddress = nextAddress || fallbackAddress;
    if (finalAddress) setCity(finalAddress);
    if (nextCountry) setCountry(nextCountry);
    return Boolean(finalAddress || nextCountry);
  };

  const fetchLocationSuggestions = async (
    query: string,
    countryText?: string
  ): Promise<LocationSuggestion[]> => {
    if (!GOOGLE_MAPS_KEY) return [];
    const trimmed = String(query || "").trim();
    if (trimmed.length < 2) return [];
    const selectedState = findAvailableState(availableStates, state);
    if (!selectedState) return [];

    try {
      const countryCode = selectedCountryCode(countryText) || "us";
      const components = countryCode ? `&components=country:${countryCode}` : "";
      const buildUrl = (types?: string) =>
        "https://maps.googleapis.com/maps/api/place/autocomplete/json?input=" +
        `${encodeURIComponent(`${trimmed}, ${selectedState.name}`)}` +
        "&language=en" +
        components +
        (types ? `&types=${encodeURIComponent(types)}` : "") +
        `&key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`;

      const addressRes = await fetch(buildUrl("address"), {
        headers: { Accept: "application/json" },
      });
      if (!addressRes.ok) return [];
      const addressJson = await addressRes.json().catch(() => null);
      if (addressJson?.status === "REQUEST_DENIED") {
        setLocationError("Address search is temporarily unavailable. Please try again later.");
        return [];
      }
      setLocationError("");
      let predictions = Array.isArray(addressJson?.predictions) ? addressJson.predictions : [];

      if (predictions.length === 0) {
        const geocodeRes = await fetch(buildUrl("geocode"), {
          headers: { Accept: "application/json" },
        });
        if (geocodeRes.ok) {
          const geocodeJson = await geocodeRes.json().catch(() => null);
          predictions = Array.isArray(geocodeJson?.predictions) ? geocodeJson.predictions : [];
        }
      }

      return predictions
        .filter((item: any) => predictionMatchesState(item, selectedState))
        .slice(0, LOCATION_AUTOCOMPLETE_LIMIT)
        .map((item: any) => ({
          placeId: String(item?.place_id || ""),
          description: String(item?.description || "").trim(),
          mainText: String(item?.structured_formatting?.main_text || item?.description || "").trim(),
          secondaryText: String(item?.structured_formatting?.secondary_text || "").trim(),
        }))
        .filter((item: LocationSuggestion) => item.placeId && item.description);
    } catch {
      return [];
    }
  };

  const fetchLocationDetails = async (placeId: string) => {
    if (!GOOGLE_MAPS_KEY || !placeId) return null;
    try {
      const url =
        "https://maps.googleapis.com/maps/api/place/details/json?place_id=" +
        `${encodeURIComponent(placeId)}` +
        "&fields=formatted_address,address_component&key=" +
        encodeURIComponent(GOOGLE_MAPS_KEY);
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      const details = json?.result;
      if (!details) return null;

      const components = details?.address_components || [];
      const selectedState = findAvailableState(availableStates, state);
      if (!addressComponentsMatchState(components, selectedState)) return null;
      const findComponent = (type: string) =>
        components.find(
          (item: any) => Array.isArray(item?.types) && item.types.includes(type)
        );
      const streetNumber = findComponent("street_number")?.long_name;
      const route = findComponent("route")?.long_name;
      const streetText = [streetNumber, route].filter(Boolean).join(" ").trim();
      const cityText =
        findComponent("locality")?.long_name ||
        findComponent("sublocality")?.long_name ||
        findComponent("administrative_area_level_2")?.long_name ||
        "";
      const countryComponent = findComponent("country");
      const stateComponent = findComponent("administrative_area_level_1");
      const countryText = mapCountryOption(
        countryComponent?.long_name,
        countryComponent?.short_name
      );
      const formatted = formatAddressLine(
        streetText,
        cityText,
        countryText,
        stateComponent?.long_name,
      );
      return { address: formatted || details?.formatted_address || "", country: countryText };
    } catch {
      return null;
    }
  };

  const hideLocationSuggestions = () => {
    setShowLocationSuggestions(false);
    setLocationSuggestions([]);
    setLoadingLocationSuggestions(false);
  };

  const applyLocationSuggestion = async (item: LocationSuggestion) => {
    const fallbackLabel = String(item.description || "").trim();
    if (!fallbackLabel) return;

    try {
      hideLocationSuggestions();
      setCity(fallbackLabel);
      const details = await fetchLocationDetails(item.placeId);
      if (!details) {
        setCity("");
        setLocationError("Please select an address from the selected available state.");
        return;
      }
      const nextAddress = String(details?.address || fallbackLabel).trim();
      if (nextAddress) setCity(nextAddress);
      if (details?.country) setCountry(details.country);
    } catch {
      setCity(fallbackLabel);
    }
  };

  useEffect(() => {
    const query = String(city || "").trim();
    if (!showLocationSuggestions || query.length < 2 || !GOOGLE_MAPS_KEY) {
      setLocationSuggestions([]);
      setLoadingLocationSuggestions(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingLocationSuggestions(true);
      const next = await fetchLocationSuggestions(query, country);
      if (cancelled) return;
      setLocationSuggestions(next);
      setLoadingLocationSuggestions(false);
    }, LOCATION_AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [city, country, state, availableStates, showLocationSuggestions]);

  const fetchNativeReverseAddress = async (latitude: number, longitude: number) => {
    try {
      if (typeof (Location as any)?.reverseGeocodeAsync !== "function") return null;
      const rows: any[] = await (Location as any).reverseGeocodeAsync({
        latitude,
        longitude,
      });
      if (!Array.isArray(rows) || !rows.length) return null;

      const first = rows[0] || {};
      const street = [first?.name, first?.street].filter(Boolean).join(" ").trim();
      const cityText = extractBestCity(first);
      const countryText = mapCountryOption(first?.country, first?.isoCountryCode);
      const formatted = formatAddressLine(street, cityText, countryText);

      return {
        address: formatted || [cityText, countryText].filter(Boolean).join(", "),
        country: countryText,
      };
    } catch {
      return null;
    }
  };

  const fetchPlacesAddressWeb = async (latitude: number, longitude: number) => {
    if (!GOOGLE_MAPS_KEY || typeof document === "undefined") return null;
    await loadGoogleMapsScript(GOOGLE_MAPS_KEY);
    const maps = (globalThis as any)?.google?.maps;
    if (!maps?.places?.PlacesService) return null;

    const container = document.createElement("div");
    const service = new maps.places.PlacesService(container);

    const placeId = await new Promise<string | null>((resolve) => {
      service.nearbySearch(
        { location: { lat: latitude, lng: longitude }, radius: 120 },
        (results: any, status: string) => {
          if (status === maps.places.PlacesServiceStatus.OK && results?.length) {
            resolve(results[0]?.place_id || null);
          } else {
            resolve(null);
          }
        }
      );
    });
    if (!placeId) return null;

    const details = await new Promise<any | null>((resolve) => {
      service.getDetails(
        { placeId, fields: ["formatted_address", "address_components"] },
        (result: any, status: string) => {
          if (status === maps.places.PlacesServiceStatus.OK && result) {
            resolve(result);
          } else {
            resolve(null);
          }
        }
      );
    });
    if (!details) return null;

    const components = details?.address_components || [];
    const findComponent = (type: string) =>
      components.find(
        (item: any) => Array.isArray(item?.types) && item.types.includes(type)
      );
    const streetNumber = findComponent("street_number")?.long_name;
    const route = findComponent("route")?.long_name;
    const streetText = [streetNumber, route].filter(Boolean).join(" ").trim();
    const cityText =
      findComponent("locality")?.long_name ||
      findComponent("sublocality")?.long_name ||
      findComponent("administrative_area_level_2")?.long_name ||
      "";
    const countryComponent = findComponent("country");
    const countryText = mapCountryOption(
      countryComponent?.long_name,
      countryComponent?.short_name
    );
    const formatted = formatAddressLine(streetText, cityText, countryText);
    return { address: formatted || details?.formatted_address || "", country: countryText };
  };

  const fetchPlacesAddress = async (latitude: number, longitude: number) => {
    if (Platform.OS === "web") {
      return fetchPlacesAddressWeb(latitude, longitude);
    }
    if (!GOOGLE_MAPS_KEY) return null;
    try {
      const nearbyUrl =
        "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=" +
        `${latitude},${longitude}` +
        `&radius=120&key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`;
      const nearbyRes = await fetch(nearbyUrl);
      if (!nearbyRes.ok) return null;
      const nearbyJson = await nearbyRes.json();
      const placeId = nearbyJson?.results?.[0]?.place_id;
      if (!placeId) return null;

      const detailsUrl =
        "https://maps.googleapis.com/maps/api/place/details/json?place_id=" +
        `${encodeURIComponent(placeId)}` +
        `&fields=formatted_address,address_component&key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`;
      const detailsRes = await fetch(detailsUrl);
      if (!detailsRes.ok) return null;
      const detailsJson = await detailsRes.json();
      const details = detailsJson?.result;
      if (!details) return null;

      const components = details?.address_components || [];
      const findComponent = (type: string) =>
        components.find(
          (item: any) => Array.isArray(item?.types) && item.types.includes(type)
        );
      const streetNumber = findComponent("street_number")?.long_name;
      const route = findComponent("route")?.long_name;
      const streetText = [streetNumber, route].filter(Boolean).join(" ").trim();
      const cityText =
        findComponent("locality")?.long_name ||
        findComponent("sublocality")?.long_name ||
        findComponent("administrative_area_level_2")?.long_name ||
        "";
      const countryComponent = findComponent("country");
      const countryText = mapCountryOption(
        countryComponent?.long_name,
        countryComponent?.short_name
      );
      const formatted = formatAddressLine(streetText, cityText, countryText);
      return { address: formatted || details?.formatted_address || "", country: countryText };
    } catch {
      return null;
    }
  };

  const autofillLocation = async () => {
    try {
      setLocating(true);
      setLocationError("");
      try {
        const enabled = await Location.hasServicesEnabledAsync();
        if (!enabled) {
          setLocationError("Location services appear off. Trying anyway...");
        }
      } catch {
        // Continue; some runtimes may not reliably report this.
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationError("Location access was not granted.");
        return;
      }
      let pos: any;
      try {
        pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
      } catch {
        pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }
      const { latitude, longitude } = pos.coords;
      const coordsText = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      let applied = false;

      if (!applied) {
        const nativeReverse = await fetchNativeReverseAddress(latitude, longitude);
        if (nativeReverse) {
          applied = applyLocation(nativeReverse.address, nativeReverse.country, coordsText);
        }
      }

      if (!applied) {
        const fallback = await fetchPlacesAddress(latitude, longitude);
        if (fallback) {
          applied = applyLocation(fallback.address, fallback.country, coordsText);
        }
      }

      if (!applied) {
        applied = applyLocation("", "", coordsText);
      }

      if (!applied) {
        setLocationError("Could not read your address. Try again.");
      }
    } catch {
      setLocationError("Unable to fetch location right now.");
    } finally {
      setLocating(false);
    }
  };

  const handleSubmit = async () => {
    if (loading) return;

    if (!firstName.trim() || !lastName.trim()) {
      showError("Please enter first and last name");
      return;
    }
    if (email.trim() && !emailRegex.test(email.trim().toLowerCase())) {
      showError("Please enter a valid email address");
      return;
    }
    if ((password || confirmPassword) && password.length < MIN_PASSWORD_LENGTH) {
      showError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if ((password || confirmPassword) && password !== confirmPassword) {
      showError("Passwords do not match");
      return;
    }
    if (!state) {
      showError("Please select an available state");
      return;
    }

    setLoading(true);
    try {
      let token = await AsyncStorage.getItem(STORAGE_KEYS.token);
      let userId =
        (await AsyncStorage.getItem(STORAGE_KEYS.userId)) ||
        (await AsyncStorage.getItem(STORAGE_KEYS.legacyId));
      const storedEmail = ((await AsyncStorage.getItem(STORAGE_KEYS.userEmail)) || "").trim().toLowerCase();
      const activeSignup = signupMeta || signupData;
      const draftRaw = await AsyncStorage.getItem(STORAGE_KEYS.signupClientDraft);
      let draft: any = null;
      try {
        draft = draftRaw ? JSON.parse(draftRaw) : null;
      } catch {
        draft = null;
      }
      const draftEmail = String(draft?.email || activeSignup?.email || "").trim().toLowerCase();
      const draftPassword = String(draft?.password || "").trim();
      const draftPasswordConfirmation = String(
        draft?.password_confirmation || draft?.confirm || draftPassword
      ).trim();
      const effectivePassword = String(password || draftPassword || "");
      const effectivePasswordConfirmation = String(
        confirmPassword || draftPasswordConfirmation || effectivePassword
      );
      const draftName = String(
        draft?.fullname || draft?.name || activeSignup?.fullname || activeSignup?.name || ""
      ).trim();

      if (userId && draftEmail && draftEmail !== storedEmail) {
        // Signup email changed, so the previous session is stale and must not be reused.
        await AsyncStorage.multiRemove([
          STORAGE_KEYS.token,
          STORAGE_KEYS.userId,
          STORAGE_KEYS.legacyId,
        ]);
        token = "";
        userId = "";
      }

      const effectiveEmail = (email.trim().toLowerCase() || draftEmail || storedEmail).trim();
      const kidsCount = kids.trim();

      const body: any = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        ...(effectiveEmail ? { email: effectiveEmail } : {}),
        phone: phone.trim(),
        country: country.trim(),
        city: city.trim(),
        address: city.trim(),
        gender: gender.trim(),
        kids: kidsCount,
        ...(kidsCount ? { children_count: Number.parseInt(kidsCount, 10) } : {}),
        about_me: about.trim(),
        bio: about.trim(),
      };

      if (profileImage?.uri) {
        try {
          const base64 = await FileSystem.readAsStringAsync(profileImage.uri, {
            encoding: "base64" as any,
          });
          const mimeRaw = String(profileImage.type || "").trim().toLowerCase();
          const mime = mimeRaw.startsWith("image/") ? mimeRaw : "image/jpeg";
          body.user_image_base64 = `data:${mime};base64,${base64}`;
          delete body.user_image;
        } catch (e) {
          console.warn("[CreateClientProfile] image base64 failed, skipping image", e);
        }
      }

      console.log("[CreateClientProfile] submitting", {
        bodyKeys: Object.keys(body),
        hasImage: !!profileImage?.uri,
        userId,
      });

      if (!userId) {
        const bootstrapEmail = String(draftEmail || effectiveEmail || "").trim().toLowerCase();
        const bootstrapPassword = String(effectivePassword || "");
        const bootstrapPasswordConfirmation = String(
          effectivePasswordConfirmation || bootstrapPassword
        );
        const bootstrapName = String(
          draftName || `${firstName} ${lastName}`.trim()
        ).trim();

        if (!bootstrapEmail || !bootstrapPassword || !bootstrapName) {
          showError("No user session found. Please sign up first.");
          return;
        }

        const signupResp: any = await signupClient({
          name: bootstrapName,
          email: bootstrapEmail,
          password: bootstrapPassword,
          password_confirmation: bootstrapPasswordConfirmation || bootstrapPassword,
          state,
        });

        const signupToken = resolveAuthToken(signupResp);
        const signupUserId = resolveAuthUserId(signupResp);
        if (signupToken) token = signupToken;
        if (signupUserId) userId = signupUserId;

        if (!userId) {
          const loginResp: any = await loginRequest({
            email: bootstrapEmail,
            password: bootstrapPassword,
          });
          const loginToken = resolveAuthToken(loginResp);
          const loginUserId = resolveAuthUserId(loginResp);
          if (loginToken) token = loginToken;
          if (loginUserId) userId = loginUserId;
        }

        if (!userId) {
          throw new Error("Signup completed but user_id was not returned.");
        }

        if (token) await AsyncStorage.setItem(STORAGE_KEYS.token, token);
        await AsyncStorage.setItem(STORAGE_KEYS.userId, userId);
        await AsyncStorage.setItem(STORAGE_KEYS.userEmail, bootstrapEmail);
        await AsyncStorage.setItem(STORAGE_KEYS.userName, bootstrapName);
      }
      const submitProfile = async (authToken?: string | null, uid?: string | null) =>
        updateClientProfile(
          { ...body, user_id: uid || userId },
          authToken || token || undefined
        );

      let result: any;
      try {
        result = await submitProfile(token, userId);
      } catch (firstErr: any) {
        const msg = String(firstErr?.message || "");
        const needsContactBootstrap = msg.toLowerCase().includes("ghl contact not found");
        if (!needsContactBootstrap) throw firstErr;

        if (!draftEmail || !effectivePassword || !draftName) {
          throw firstErr;
        }

        const signupResp: any = await signupClient({
          name: draftName,
          email: draftEmail,
          password: effectivePassword,
          password_confirmation: effectivePasswordConfirmation || effectivePassword,
          state,
        });
        let freshToken = resolveAuthToken(signupResp) || token || "";
        let freshUserId = resolveAuthUserId(signupResp) || userId || "";
        if (!freshUserId) {
          const loginResp: any = await loginRequest({
            email: draftEmail,
            password: effectivePassword,
          });
          freshToken = resolveAuthToken(loginResp) || freshToken;
          freshUserId = resolveAuthUserId(loginResp) || freshUserId;
        }
        if (freshToken) await AsyncStorage.setItem(STORAGE_KEYS.token, freshToken);
        if (freshUserId) await AsyncStorage.setItem(STORAGE_KEYS.userId, freshUserId);

        result = await submitProfile(freshToken, freshUserId);
      }
      const derivedUser =
        result?.user || result?.data?.user || {};
      const derivedId = String(userId || resolveAuthUserId(result) || "").trim();
      const derivedToken = result?.token || token || "";
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const serverImage =
        result?.profile?.user_image_url ||
        result?.user_image_url ||
        profileImage?.uri ||
        "";
      const storagePairs: [string, string][] = [
        ["user_id", String(derivedId)],
        ["user_name", fullName],
        ["user_email", String(derivedUser?.email || effectiveEmail || "").trim()],
        ["user_phone", phone.trim()],
        ["user_country", country.trim()],
        ["user_city", city.trim()],
        ["user_address", city.trim()],
        ["user_gender", gender.trim()],
        ["user_about", about.trim()],
        ["user_image", serverImage],
        ["user_type", "client"],
      ];
      if (derivedToken) {
        storagePairs.push(["token", String(derivedToken)]);
      }
      await AsyncStorage.multiSet(storagePairs);
      await AsyncStorage.removeItem(STORAGE_KEYS.signupClientDraft);
      await AsyncStorage.multiRemove([
        "nanny_id",
        "nanny_name",
        "nanny_email",
        "nanny_phone",
        "nanny_address",
        "nanny_city",
        "nanny_country",
        "nanny_gender",
        "nanny_about",
        "nanny_experience",
        "nanny_dob",
        "nanny_image",
        "nanny_availability",
        "nanny_profile_payload",
        "rate_morning",
        "rate_evening",
        "rate_night",
      ]);
      showNotice("Success", "Profile saved successfully");
      onNext?.();
      onSuccess?.();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("[CreateClientProfile] submit failed", err);
      const msg = String(err?.message || "");
      const lowerMsg = msg.toLowerCase();
      const invalidUserId =
        (lowerMsg.includes("user_id") && lowerMsg.includes("invalid")) ||
        lowerMsg.includes("selected user id is invalid");
      if (invalidUserId) {
        await AsyncStorage.multiRemove([
          STORAGE_KEYS.token,
          STORAGE_KEYS.userId,
          STORAGE_KEYS.legacyId,
        ]);
        showError("Session mismatch detected. Please login or sign up again.");
        return;
      }
      if (msg.toLowerCase().includes("ghl contact not found")) {
        // Backend CRM contact sync issue should not block onboarding flow.
        await AsyncStorage.multiSet([
          ["user_name", `${firstName.trim()} ${lastName.trim()}`.trim()],
          ["user_email", (email.trim().toLowerCase() || "").trim()],
          ["user_phone", phone.trim()],
          ["user_country", country.trim()],
          ["user_city", city.trim()],
          ["user_address", city.trim()],
          ["user_gender", gender.trim()],
          ["user_about", about.trim()],
          ["user_type", "client"],
        ]);
        onNext?.();
        onSuccess?.();
        return;
      }
      showError(msg || "Could not save profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeScreen>
      <LinearGradient
      style={styles.container}
      colors={["#FFFFFF", "#FFFFFF", "#FFFFFF"]}
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
          {/* Back */}
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              if (onBack) {
                onBack();
                return;
              }
              navigation?.goBack?.();
            }}
          >
            <Icon name="chevron-back" />
          </TouchableOpacity>

          <View style={styles.heroCard}>
            {/* Title */}
            <Text style={styles.header}>Create Parent Profile</Text>
            <Text style={styles.subheader}>
              Tell us about yourself to get started
            </Text>

            {/* Avatar */}
            <View style={styles.avatarWrapper}>
              <TouchableOpacity onPress={choosePhoto} activeOpacity={0.8}>
                <View style={styles.avatarCircle}>
                  {profileImage?.uri ? (
                    <Image source={{ uri: profileImage.uri }} style={styles.avatar} />
                  ) : (
                    <Icon name="camera-outline" size={28} />
                  )}
                </View>
              </TouchableOpacity>
              <Text style={styles.photoHint}>Tap to add profile photo</Text>
            </View>
          </View>

          <View style={styles.formCard}>
          {/* Fields */}
          <Input icon="person-outline" placeholder="First Name" value={firstName} onChangeText={setFirstName} />
          <Input icon="person-outline" placeholder="Last Name" value={lastName} onChangeText={setLastName} />
          <Input
            icon="mail-outline"
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Input
            icon="lock-closed-outline"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          
          <Input icon="call-outline" placeholder="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          {/* Country dropdown */}
          <View style={styles.dropdownWrapper}>
            <TouchableOpacity
              style={[styles.inputBox, country ? styles.inputBoxFilled : undefined]}
              onPress={() => setCountryOpen((prev) => !prev)}
              activeOpacity={0.8}
            >
              <Icon name="home-outline" />
              <Text style={[styles.input, { paddingVertical: rs(0) }]}>
                {country || "Country (optional)"}
              </Text>
              <Ionicons
                name={countryOpen ? "chevron-up" : "chevron-down"}
                size={18}
                color="#FF80AB"
              />
            </TouchableOpacity>
            {countryOpen && (
              <View style={styles.dropdown}>
                {COUNTRY_OPTIONS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={styles.dropdownItem}
                    onPress={() => {
                      setCountry(c);
                      setCountryOpen(false);
                    }}
                  >
                    <Text style={styles.dropdownText}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          <AvailableStateSelector
            value={state}
            onSelect={(nextState) => {
              if (state && nextState !== state) setCity("");
              setState(nextState);
            }}
            onStatesLoaded={setAvailableStates}
          />
          <View>
            <View style={styles.inputBox}>
              <Icon name="business-outline" />
              <TextInput
                style={styles.input}
                placeholder="Address (optional)"
                value={city}
                onChangeText={(next) => {
                  setCity(next);
                  setShowLocationSuggestions(true);
                }}
                onFocus={() => setShowLocationSuggestions(true)}
                onBlur={() => {
                  setTimeout(() => hideLocationSuggestions(), 120);
                }}
              />
            </View>
            {showLocationSuggestions &&
            (loadingLocationSuggestions ||
              locationSuggestions.length > 0 ||
              String(city || "").trim().length >= 2) ? (
              <View style={styles.locationSuggestionsBox}>
                {loadingLocationSuggestions ? (
                  <View style={styles.locationSuggestionLoadingRow}>
                    <ActivityIndicator size="small" color="#FF80AB" />
                    <Text style={styles.locationSuggestionLoadingText}>Searching addresses...</Text>
                  </View>
                ) : (
                  <>
                    {locationSuggestions.map((item) => (
                      <TouchableOpacity
                        key={item.placeId}
                        style={styles.locationSuggestionRow}
                        activeOpacity={0.85}
                        onPress={() => {
                          void applyLocationSuggestion(item);
                        }}
                      >
                        <Ionicons name="location-outline" size={16} color="#FF80AB" />
                        <View style={styles.locationSuggestionTextWrap}>
                          <Text numberOfLines={1} style={styles.locationSuggestionMainText}>
                            {item.mainText}
                          </Text>
                          {!!item.secondaryText && (
                            <Text numberOfLines={1} style={styles.locationSuggestionSecondaryText}>
                              {item.secondaryText}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </View>
            ) : null}
          </View>
          <View style={styles.locationInline}>
            <TouchableOpacity
              onPress={autofillLocation}
              style={[styles.locateBtnInline, locating && { opacity: 0.7 }]}
              disabled={locating}
            >
              {locating ? (
                <ActivityIndicator size="small" color="#FF80AB" />
              ) : (
                <Ionicons name="locate-outline" size={18} color="#FF80AB" />
              )}
              <Text style={styles.locateText}>
                {locating ? "Fetching location..." : "Auto-fetch address"}
              </Text>
            </TouchableOpacity>
            {!!locationError && !locating && (
              <Text style={styles.locationError}>{locationError}</Text>
            )}
          </View>

          {/* Gender dropdown */}
          <View style={styles.dropdownWrapper}>
            <TouchableOpacity
              style={[styles.inputBox, gender ? styles.inputBoxFilled : undefined]}
              onPress={() => setGenderOpen((p) => !p)}
              activeOpacity={0.8}
            >
              <Icon name="male-female-outline" />
              <Text style={styles.dropdownValue}>
                {gender || "Gender (optional)"}
              </Text>
              <Ionicons name={genderOpen ? "chevron-up" : "chevron-down"} size={18} color="#FF80AB" />
            </TouchableOpacity>
            {genderOpen && (
              <View style={styles.dropdown}>
                {["Male", "Female", "Other"].map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={styles.dropdownItem}
                    onPress={() => {
                      setGender(g);
                      setGenderOpen(false);
                    }}
                  >
                    <Text style={styles.dropdownText}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          <Input icon="people-outline" placeholder="Number of kids (optional)" value={kids} onChangeText={handleKidsInput} keyboardType="numeric" />
          <Input
            icon="book-outline"
            placeholder="About Our Family (optional)"
            value={about}
            onChangeText={setAbout}
            multiline
            style={[styles.input, styles.textArea]}
          />
          <Text style={styles.helperText}>
            Children’s interests, what you’re looking for in a babysitter, routines/expectations,
            anything important sitters should know.
          </Text>

          {/* Button */}
          <TouchableOpacity
            style={[styles.button, loading && { opacity: 0.7 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? "Please wait..." : "Save & Continue"}
            </Text>
          </TouchableOpacity>
          </View>

          <View style={{ height: rs(40) }} />
        </ScrollView>
      </KeyboardAvoidingView>
      </LinearGradient>
    </SafeScreen>
  );
};

export default CreateClientProfileScreen;

/* ---------- REUSABLE INPUT ---------- */

type InputProps = TextInputProps & {
  icon: React.ComponentProps<typeof Ionicons>["name"];
};

const Input: React.FC<InputProps> = ({ icon, ...props }) => (
  <View style={styles.inputBox}>
    <Icon name={icon} />
    <TextInput style={styles.input} {...props} />
  </View>
);

/* ---------- STYLES ---------- */

const styles = StyleSheet.create({
  container: { flex: 1 },

  scroll: {
    paddingHorizontal: rs(18),
    paddingTop: rs(8),
    paddingBottom: rs(18),
  },

  backBtn: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    marginBottom: rs(12),
  },
  heroCard: {
    backgroundColor: "rgba(255,255,255,0.42)",
    borderRadius: rs(18),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.25)",
    marginBottom: rs(14),
  },
  formCard: {
    backgroundColor: "rgba(255,255,255,0.35)",
    borderRadius: rs(18),
    padding: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },

  avatarWrapper: {
    alignItems: "center",
    marginTop: rs(10),
  },

  avatarCircle: {
    width: rs(110),
    height: rs(110),
    borderRadius: rs(55),
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },

  avatar: {
    width: rs(110),
    height: rs(110),
    borderRadius: rs(55),
  },
  photoHint: {
    marginTop: rs(8),
    color: "#AD1457",
    fontSize: rf(12),
    fontFamily: Fonts.display,
  },

  photoBtn: {
    marginTop: rs(10),
    paddingHorizontal: rs(14),
    paddingVertical: rs(8),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB",
  },

  photoText: {
    color: "#FF80AB",
    fontWeight: "700",
  },

  header: {
    fontSize: rf(30),
    fontWeight: "700",
    color: "#880E4F",
    textAlign: "center",
    fontFamily: Fonts.display,
  },

  subheader: {
    marginTop: rs(6),
    fontSize: rf(15),
    color: "#AD1457",
    marginBottom: rs(8),
    textAlign: "center",
    fontFamily: Fonts.display,
  },

  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: rs(12),
    paddingHorizontal: rs(12),
    marginBottom: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.55)",
    elevation: 3,
  },

  input: {
    flex: 1,
    paddingVertical: rs(12),
    marginLeft: rs(8),
    fontSize: rf(15),
    color: "#4A0033",
    fontFamily: Fonts.display,
  },
  dropdownValue: {
    flex: 1,
    paddingVertical: rs(12),
    marginLeft: rs(8),
    fontSize: rf(15),
    color: "#4A0033",
    fontFamily: Fonts.display,
  },
  inputBoxFilled: {
    borderColor: "#FF80AB",
  },
  dropdown: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#FF80AB",
    borderRadius: rs(12),
    marginTop: rs(6),
    marginBottom: rs(10),
    overflow: "hidden",
  },
  dropdownItem: {
    paddingVertical: rs(12),
    paddingHorizontal: rs(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#FFD5E6",
  },
  dropdownText: {
    color: "#4A0033",
    fontFamily: Fonts.display,
  },
  textArea: {
    minHeight: rs(100),
    textAlignVertical: "top",
  },
  locateBtnInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
    paddingVertical: rs(8),
    paddingHorizontal: rs(12),
    borderRadius: rs(10),
    backgroundColor: "#FFE6F0",
    alignSelf: "flex-start",
  },
  locateText: {
    color: "#AD1457",
    fontWeight: "600",
    fontFamily: Fonts.display,
  },
  locationInline: {
    marginBottom: rs(8),
  },
  locationError: {
    color: "#C2185B",
    fontSize: rf(12),
    marginTop: rs(2),
    fontFamily: Fonts.display,
  },
  helperText: {
    color: "#AD1457",
    fontSize: rf(12),
    marginTop: rs(-4),
    marginBottom: rs(10),
    fontFamily: Fonts.display,
  },
  dropdownWrapper: {
    marginBottom: rs(8),
  },
  locationSuggestionsBox: {
    marginTop: rs(-6),
    marginBottom: rs(10),
    borderWidth: 1,
    borderColor: "#FF80AB30",
    borderRadius: rs(12),
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  locationSuggestionLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    paddingHorizontal: rs(12),
    paddingVertical: rs(12),
  },
  locationSuggestionLoadingText: {
    color: "#AD1457",
    fontSize: rf(12),
    fontFamily: Fonts.display,
  },
  locationSuggestionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: rs(10),
    paddingHorizontal: rs(12),
    paddingVertical: rs(11),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#FFD5E6",
  },
  locationSuggestionTextWrap: {
    flex: 1,
  },
  locationSuggestionMainText: {
    color: "#4A0033",
    fontSize: rf(13),
    fontWeight: "600",
    fontFamily: Fonts.display,
  },
  locationSuggestionSecondaryText: {
    color: "#AD1457",
    fontSize: rf(11),
    marginTop: rs(2),
    fontFamily: Fonts.display,
  },

  button: {
    height: rs(55),
    borderRadius: rs(15),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    marginTop: rs(16),
  },

  buttonText: {
    color: "#fff",
    fontSize: rf(16),
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
});
