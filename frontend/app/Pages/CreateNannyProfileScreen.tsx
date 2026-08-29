import { Fonts } from "@/constants/theme";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from "react-native";
import SafeScreen from "../_utils/SafeScreen";
import { GOOGLE_MAPS_KEY, registerNannyWithProfile, updateNannyProfile } from "../Api";
import AvailableStateSelector from "@/components/AvailableStateSelector";
import { addressComponentsMatchState, findAvailableState, predictionMatchesState } from "@/lib/enabledStateLocation";
import type { AvailableState } from "../_Api";
import { rf, rs } from "../utils/responsive";
import { DocumentPicker } from "../utils/safeDocumentPicker";
import { FileSystem } from "../utils/safeFileSystem";
import { ImagePicker } from "../utils/safeImagePicker";
import { Location } from "../utils/safeLocation";
import type { SignupData } from "./SignupNannyScreen";

type Props = {
  navigation?: any;
  onBack?: () => void;
  onSuccess?: () => void;
  signupData?: SignupData | null;
};

type UploadFile = { uri: string; name?: string; type?: string };

type LocationSuggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
};

const COUNTRY_OPTIONS: string[] = [
  "United States",
  "Canada",
];

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
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
  "images";

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

const resolveDocumentMimeType = (file?: UploadFile | null): string => {
  const rawType = String(file?.type || "").trim().toLowerCase();
  if (rawType === "application/pdf" || rawType.startsWith("image/")) {
    return rawType;
  }

  const source = String(file?.name || file?.uri || "").toLowerCase();
  if (source.endsWith(".pdf")) return "application/pdf";
  if (source.endsWith(".png")) return "image/png";
  if (source.endsWith(".webp")) return "image/webp";
  if (source.endsWith(".gif")) return "image/gif";
  if (source.endsWith(".heic") || source.endsWith(".heif")) return "image/heic";
  if (source.endsWith(".jpg") || source.endsWith(".jpeg")) return "image/jpeg";
  return "application/pdf";
};

const CreateNannyProfileScreen: React.FC<Props> = ({
  navigation,
  onBack,
  onSuccess = () => {},
  signupData = null,
}) => {
  const [fallbackSignupData, setFallbackSignupData] = useState<SignupData | null>(null);
  const initialSignupDataRef = useRef<SignupData | null>(signupData);
  const iosAutofillMode: AutofillBehavior = Platform.OS === "ios" ? "disabled" : "default";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [gender, setGender] = useState("");
  const [country, setCountry] = useState("");
  const [state, setState] = useState("");
  const [availableStates, setAvailableStates] = useState<AvailableState[]>([]);
  const [experience, setExperience] = useState("");
  const [bio, setBio] = useState("");
  const [referral, setReferral] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  const [profileImg, setProfileImg] = useState<UploadFile | null>(null);
  const [resumeFile, setResumeFile] = useState<UploadFile | null>(null);
  const [certificateFile, setCertificateFile] = useState<UploadFile | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [datePickerInitialValue, setDatePickerInitialValue] = useState<Date | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [loadingLocationSuggestions, setLoadingLocationSuggestions] = useState(false);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [locationSearchError, setLocationSearchError] = useState("");

  const [loading, setLoading] = useState(false);
  const didHydrateStoredPrefill = useRef(false);
  const didStartEmailEditing = useRef(false);
  const didStartPasswordEditing = useRef(false);
  const didStartPhoneEditing = useRef(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  const applyPrefillName = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    const first = parts[0] || "";
    const last = parts.slice(1).join(" ");
    if (first) {
      setFirstName((prev) => (prev.trim() ? prev : first));
    }
    if (last) {
      setLastName((prev) => (prev.trim() ? prev : last));
    }
  };

  const applyPrefillEmail = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || didStartEmailEditing.current) return;
    setEmail((prev) => (prev.trim() ? prev : normalized));
  };

  const applyPrefillPhone = (value: string) => {
    const normalized = value.trim();
    if (!normalized || didStartPhoneEditing.current) return;
    setPhone((prev) => (prev.trim() ? prev : normalized));
  };

  const applyPrefillPassword = (value: string) => {
    if (!value || didStartPasswordEditing.current) return;
    setPassword((prev) => (prev ? prev : value));
  };

  const handleEmailChange = (value: string) => {
    didStartEmailEditing.current = true;
    setEmail(value);
  };

  const handleEmailFocus = () => {
    didStartEmailEditing.current = true;
  };

  const handlePasswordChange = (value: string) => {
    didStartPasswordEditing.current = true;
    setPassword(value);
  };

  const handlePasswordFocus = () => {
    didStartPasswordEditing.current = true;
  };

  const handlePhoneChange = (value: string) => {
    didStartPhoneEditing.current = true;
    setPhone(value);
  };

  const handlePhoneFocus = () => {
    didStartPhoneEditing.current = true;
  };

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [fadeAnim]);

  useEffect(() => {
    if (didHydrateStoredPrefill.current) return;
    didHydrateStoredPrefill.current = true;

    let cancelled = false;

    const initialSignup = initialSignupDataRef.current;
    const signupName = String(initialSignup?.fullname || "").trim();
    const signupEmail = String(initialSignup?.email || "").trim();
    const signupPassword = String(initialSignup?.password || "");

    if (signupName) applyPrefillName(signupName);
    if (signupEmail) applyPrefillEmail(signupEmail);
    if (signupPassword) applyPrefillPassword(signupPassword);

    (async () => {
      try {
        const [
          storedNameRaw,
          storedEmailRaw,
          storedAddressRaw,
          storedCityRaw,
          storedPhoneRaw,
          draftRaw,
          userNameRaw,
        ] =
          await Promise.all([
            AsyncStorage.getItem("nanny_name"),
            AsyncStorage.getItem("nanny_email"),
            AsyncStorage.getItem("nanny_address"),
            AsyncStorage.getItem("nanny_city"),
            AsyncStorage.getItem("nanny_phone"),
            AsyncStorage.getItem("signup_nanny_draft"),
            AsyncStorage.getItem("user_name"),
          ]);

        if (cancelled) return;

        let draftSignup: SignupData | null = null;

        if (draftRaw) {
          try {
            const parsed = JSON.parse(draftRaw) as SignupData | null;
            if (parsed && typeof parsed === "object") {
              draftSignup = parsed;
              setFallbackSignupData(parsed);
            }
          } catch {}
        }

        const resolvedName = String(
          signupName ||
            draftSignup?.fullname ||
            storedNameRaw ||
            userNameRaw ||
            ""
        ).trim();
        const resolvedEmail = String(
          signupEmail ||
            draftSignup?.email ||
            storedEmailRaw ||
            ""
        ).trim();
        const resolvedPassword = String(
          signupPassword ||
            draftSignup?.password ||
            ""
        );
        const storedAddress = String(storedAddressRaw || "").trim();
        const storedCity = String(storedCityRaw || "").trim();
        const storedPhone = String(storedPhoneRaw || "").trim();

        if (!cancelled && resolvedName) applyPrefillName(resolvedName);
        if (!cancelled && resolvedEmail) applyPrefillEmail(resolvedEmail);
        if (!cancelled && resolvedPassword) applyPrefillPassword(resolvedPassword);
        if (!cancelled && storedAddress) setAddress((prev) => (prev.trim() ? prev : storedAddress));
        if (!cancelled && storedCity) setCity((prev) => (prev.trim() ? prev : storedCity));
        if (!cancelled && storedPhone) applyPrefillPhone(storedPhone);
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const inferCityFromAddress = (rawAddress: string) => {
    const parts = String(rawAddress || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts[1];
    return "";
  };

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

  const ensureMediaPermission = async (forCamera?: boolean) => {
    if (forCamera) {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (!cam.granted) {
        if ((cam as any)?.canAskAgain === false) {
          promptOpenSettings(
            "Camera permission blocked",
            "Enable Camera permission in app settings to take a profile photo."
          );
          return false;
        }
        Alert.alert("Permission", "Camera access is required to take a photo.");
        return false;
      }
      return true;
    }

    const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!lib.granted) {
      if ((lib as any)?.canAskAgain === false) {
        promptOpenSettings(
          "Gallery permission blocked",
          "Enable Photos permission in app settings to select a profile photo."
        );
        return false;
      }
      Alert.alert("Permission", "Gallery access is required to pick a photo.");
      return false;
    }
    return true;
  };

  const pickImageFromLibrary = async () => {
    const ok = await ensureMediaPermission();
    if (!ok) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: IMAGE_MEDIA_TYPE,
      allowsEditing: true,
      quality: 0.8,
    });

    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (asset?.uri) {
      setProfileImg({
        uri: asset.uri,
        name: asset.fileName || "profile.jpg",
        type: resolvePickerMimeType(asset),
      });
    }
  };

  const takePhoto = async () => {
    const ok = await ensureMediaPermission(true);
    if (!ok) return;

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      mediaTypes: IMAGE_MEDIA_TYPE,
      quality: 0.8,
    });

    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (asset?.uri) {
      setProfileImg({
        uri: asset.uri,
        name: asset.fileName || "profile.jpg",
        type: resolvePickerMimeType(asset),
      });
    }
  };

  const pickProfileImage = async () => {
    if (Platform.OS === "web") {
      await pickImageFromLibrary();
      return;
    }

    Alert.alert("Upload Photo", "Choose an option", [
      { text: "Take Photo", onPress: takePhoto },
      { text: "Choose from Library", onPress: pickImageFromLibrary },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const pickDocument = async (setter: (file: UploadFile) => void) => {
    try {
      const result = (await DocumentPicker.getDocumentAsync({
        type: [
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "image/*",
          "*/*",
        ],
        multiple: false,
        copyToCacheDirectory: true,
      })) as any;

      const canceled = result?.canceled ?? result?.type === "cancel";
      if (canceled) return;

      const asset = result?.assets?.length ? result.assets[0] : result;
      if (!asset?.uri) return;

      setter({
        uri: asset.uri,
        name: asset.name || "document",
        type: asset.mimeType || asset.type || "application/octet-stream",
      });
    } catch {
      Alert.alert("Upload", "Could not pick a file right now.");
    }
  };

  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const parseDateInput = (value: string) => {
    const raw = String(value || "").trim();
    if (!raw) return null;

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const parsed = new Date(
        Number(isoMatch[1]),
        Number(isoMatch[2]) - 1,
        Number(isoMatch[3]),
        0,
        0,
        0,
        0
      );
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const getAgeFromDob = (dob: string) => {
    const parsed = new Date(dob);
    if (Number.isNaN(parsed.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - parsed.getFullYear();
    const monthDiff = today.getMonth() - parsed.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < parsed.getDate())) {
      age -= 1;
    }

    return age;
  };

  const handleDateChange = (_event: any, date?: Date) => {
    if (!date) {
      if (Platform.OS !== "ios") {
        setShowDatePicker(false);
      }
      return;
    }

    setSelectedDate(date);
    setDateOfBirth(formatDate(date));

    if (Platform.OS !== "ios") {
      setShowDatePicker(false);
    }
  };

  const openDatePicker = () => {
    const base = selectedDate || parseDateInput(dateOfBirth) || new Date();
    setDatePickerInitialValue(base);
    setSelectedDate(base);
    setShowDatePicker(true);
  };

  const closeDatePicker = () => {
    if (datePickerInitialValue) {
      setSelectedDate(datePickerInitialValue);
      setDateOfBirth(formatDate(datePickerInitialValue));
    }
    setShowDatePicker(false);
  };

  const confirmDatePicker = () => {
    if (selectedDate) {
      setDateOfBirth(formatDate(selectedDate));
    }
    setShowDatePicker(false);
  };

  const handleWebDateChange = (value: string) => {
    setDateOfBirth(value);
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) setSelectedDate(parsed);
  };

  const mapCountryOption = (country?: string | null, iso?: string | null) => {
    const code = (iso || "").toUpperCase();
    if (code === "US" || code === "USA") return "United States";
    if (code === "CA") return "Canada";
    if (code === "GB" || code === "UK") return "United Kingdom";
    if (code === "AU") return "Australia";
    if (code === "NZ") return "New Zealand";

    const normalized = (country || "").toLowerCase();
    if (normalized.includes("united states") || normalized.includes("usa")) return "United States";
    if (normalized.includes("canada")) return "Canada";
    if (normalized.includes("kingdom")) return "United Kingdom";
    if (normalized.includes("australia")) return "Australia";
    if (normalized.includes("zealand")) return "New Zealand";

    const exact = COUNTRY_OPTIONS.find((opt) => opt.toLowerCase() === normalized);
    return exact || "Other";
  };

  const selectedCountryCode = (value?: string | null) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized.includes("united states") || normalized === "usa") return "us";
    if (normalized.includes("canada")) return "ca";
    return "";
  };

  const formatAddressLine = (
    street?: string,
    cityText?: string,
    countryText?: string,
    stateText?: string,
  ) => [street, cityText, stateText, countryText].filter(Boolean).join(", ");

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
        setLocationSearchError("Address search is temporarily unavailable. Please try again later.");
        return [];
      }
      setLocationSearchError("");
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
        components.find((item: any) => Array.isArray(item?.types) && item.types.includes(type));

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
      const countryText = mapCountryOption(countryComponent?.long_name, countryComponent?.short_name);
      const formatted = formatAddressLine(
        streetText,
        cityText,
        countryText,
        stateComponent?.long_name,
      );

      return {
        address: formatted || details?.formatted_address || "",
        city: cityText || "",
        country: countryText,
      };
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
      setAddress(fallbackLabel);
      const details = await fetchLocationDetails(item.placeId);
      if (!details) {
        setAddress("");
        Alert.alert("Location", "Please select an address from the selected available state.");
        return;
      }
      const nextAddress = String(details?.address || fallbackLabel).trim();
      if (nextAddress) setAddress(nextAddress);
      if (details?.city) setCity(details.city);
      if (details?.country) setCountry(details.country);
    } catch {
      setAddress(fallbackLabel);
    }
  };

  useEffect(() => {
    const query = String(address || "").trim();
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
  }, [address, country, state, availableStates, showLocationSuggestions]);

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
      components.find((item: any) => Array.isArray(item?.types) && item.types.includes(type));

    const streetNumber = findComponent("street_number")?.long_name;
    const route = findComponent("route")?.long_name;
    const streetText = [streetNumber, route].filter(Boolean).join(" ").trim();

    const cityText =
      findComponent("locality")?.long_name ||
      findComponent("sublocality")?.long_name ||
      findComponent("administrative_area_level_2")?.long_name ||
      "";

    const countryComponent = findComponent("country");
    const countryText = mapCountryOption(countryComponent?.long_name, countryComponent?.short_name);
    const formatted = formatAddressLine(streetText, cityText, countryText);

    return {
      address: formatted || details?.formatted_address || "",
      city: cityText || "",
      country: countryText,
    };
  };

  const fetchPlacesAddress = async (latitude: number, longitude: number) => {
    if (Platform.OS === "web") {
      return fetchPlacesAddressWeb(latitude, longitude);
    }
    if (!GOOGLE_MAPS_KEY) return null;

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
      components.find((item: any) => Array.isArray(item?.types) && item.types.includes(type));

    const streetNumber = findComponent("street_number")?.long_name;
    const route = findComponent("route")?.long_name;
    const streetText = [streetNumber, route].filter(Boolean).join(" ").trim();

    const cityText =
      findComponent("locality")?.long_name ||
      findComponent("sublocality")?.long_name ||
      findComponent("administrative_area_level_2")?.long_name ||
      "";

    const countryComponent = findComponent("country");
    const countryText = mapCountryOption(countryComponent?.long_name, countryComponent?.short_name);
    const formatted = formatAddressLine(streetText, cityText, countryText);

    return {
      address: formatted || details?.formatted_address || "",
      city: cityText || "",
      country: countryText,
    };
  };

  const useCurrentLocation = async () => {
    try {
      setLocating(true);

      try {
        const enabled = await Location.hasServicesEnabledAsync();
        if (!enabled) {
          Alert.alert("Location", "Location services seem off. Please enable GPS and try again.");
        }
      } catch {}

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location", "Location access was not granted.");
        return;
      }

      let current: any;
      try {
        current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
      } catch {
        current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }

      const coordsText = `${current.coords.latitude.toFixed(6)}, ${current.coords.longitude.toFixed(6)}`;

      const reverse = await Location.reverseGeocodeAsync({
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      }).catch(() => []);

      const best = Array.isArray(reverse) && reverse.length ? reverse[0] : null;

      const reverseStreet = [best?.streetNumber, best?.street, best?.name]
        .filter(Boolean)
        .join(" ")
        .trim();

      const reverseCity = best?.city || best?.subregion || best?.region || "";
      const reverseCountry = mapCountryOption(best?.country ?? "", best?.isoCountryCode ?? "");
      const reverseAddress = formatAddressLine(reverseStreet, reverseCity, reverseCountry);

      if (reverseAddress) {
        setAddress(reverseAddress);
        if (reverseCity) setCity(reverseCity);
        if (reverseCountry) setCountry(reverseCountry);
        return;
      }

      const fallback = await fetchPlacesAddress(
        current.coords.latitude,
        current.coords.longitude
      );

      if (fallback) {
        if (fallback.address) setAddress(fallback.address);
        else setAddress(coordsText);

        if (fallback.city) {
          setCity(fallback.city);
        } else if (fallback.address) {
          const inferredCity = inferCityFromAddress(fallback.address);
          if (inferredCity) setCity(inferredCity);
        }

        if (fallback.country) setCountry(fallback.country);
      } else {
        setAddress(coordsText);
        Alert.alert("Location", "Could not read this address. Showing coordinates instead.");
      }
    } catch {
      Alert.alert("Location", "Unable to fetch current location right now.");
    } finally {
      setLocating(false);
    }
  };

  const submitProfile = async () => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!emailRegex.test(normalizedEmail)) {
      Alert.alert("Missing Information", "Please enter a valid email address.");
      return;
    }

    const resolvedCity = city.trim() || inferCityFromAddress(address);

    if (
      !firstName ||
      !lastName ||
      !normalizedEmail ||
      !phone ||
      !gender ||
      !country ||
      !state ||
      !address ||
      !experience ||
      !bio ||
      !dateOfBirth
    ) {
      Alert.alert("Missing Information", "Please fill all required fields.");
      return;
    }

    setLoading(true);

    try {
      const token = await AsyncStorage.getItem("token");
      const nannyId =
        (await AsyncStorage.getItem("nanny_id")) ||
        (await AsyncStorage.getItem("id"));

      const existingNannyEmail = ((await AsyncStorage.getItem("nanny_email")) || "")
        .trim()
        .toLowerCase();

      const payload = {
        fullname: `${firstName.trim()} ${lastName.trim()}`.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: normalizedEmail,
        phone: phone.trim(),
        address: address.trim(),
        city: resolvedCity,
        country: country.trim(),
        gender: gender.trim(),
        experience: Number(experience),
        bio: bio.trim(),
        about: bio.trim(),
        date_of_birth: dateOfBirth.trim(),
        ...(resumeFile
          ? {
              resume: {
                uri: resumeFile.uri,
                name: resumeFile.name || "resume",
                type: resumeFile.type || "application/octet-stream",
              },
            }
          : {}),
        ...(certificateFile
          ? {
              certificate: {
                uri: certificateFile.uri,
                name: certificateFile.name || "certificate",
                type: certificateFile.type || "application/octet-stream",
              },
            }
          : {}),
        ...(referral ? { referral_code: referral.trim() } : {}),
      };

      if (profileImg?.uri) {
        try {
          const base64 = await FileSystem.readAsStringAsync(profileImg.uri, {
            encoding: "base64" as any,
          });
          const mimeRaw = String(profileImg.type || "").trim().toLowerCase();
          const mime = mimeRaw.startsWith("image/") ? mimeRaw : "image/jpeg";
          (payload as any).user_image_base64 = `data:${mime};base64,${base64}`;
          delete (payload as any).user_image;
        } catch {
          throw new Error("Selected profile image could not be prepared. Please choose it again.");
        }
      }

      if (certificateFile?.uri) {
        try {
          const certificateBase64 = await FileSystem.readAsStringAsync(certificateFile.uri, {
            encoding: "base64" as any,
          });
          const certificateMime = resolveDocumentMimeType(certificateFile);
          (payload as any).certificate_base64 = `data:${certificateMime};base64,${certificateBase64}`;
        } catch {
          throw new Error("Selected certificate could not be prepared. Please choose it again.");
        }
      }

      let result: any;
      const activeSignup = initialSignupDataRef.current || fallbackSignupData;

      if (activeSignup) {
        const signupPassword = didStartPasswordEditing.current
          ? password
          : String(password || activeSignup.password || "");
        const signupPasswordConfirmation = didStartPasswordEditing.current
          ? signupPassword
          : String(activeSignup.password_confirmation || signupPassword);

        if (!signupPassword || !signupPasswordConfirmation) {
          Alert.alert("Missing Information", "Signup details are missing. Please sign up again.");
          return;
        }
        if (signupPassword.length < MIN_PASSWORD_LENGTH) {
          Alert.alert(
            "Missing Information",
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
          );
          return;
        }

        const age = getAgeFromDob(dateOfBirth.trim());
        const registerPayload = {
          first_name: payload.first_name,
          last_name: payload.last_name,
          fullname: payload.fullname,
          email: normalizedEmail,
          password: signupPassword,
          password_confirmation: signupPasswordConfirmation,
          phone: payload.phone,
          gender: payload.gender,
          date_of_birth: payload.date_of_birth,
          age: age ?? undefined,
          experience: payload.experience,
          bio: payload.bio,
          address: payload.address,
          city: payload.city,
          country: payload.country,
          state,
          user_image_base64: (payload as any).user_image_base64,
          certificate_base64: (payload as any).certificate_base64,
        };

        result = await registerNannyWithProfile({ ...registerPayload });
      } else {
        if (!nannyId) {
          Alert.alert("Missing Information", "Syttr ID not found. Please login again.");
          return;
        }

        result = await updateNannyProfile(
          { ...payload, nanny_id: nannyId, id: nannyId },
          token || undefined
        );
      }

      const derived = result?.user || result?.data?.user || result?.data || result || {};
      const derivedNannyId = String(
        nannyId ||
          result?.nanny_id ||
          result?.user_id ||
          result?.user?.user_id ||
          derived?.user_id ||
          result?.id ||
          derived?.id ||
          ""
      ).trim();

      const derivedToken = result?.token || token || "";

      await AsyncStorage.setItem("nanny_profile_payload", JSON.stringify(payload));
      await AsyncStorage.removeItem("signup_nanny_draft");

      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

      const storagePairs: [string, string][] = [
        ["nanny_id", String(derivedNannyId)],
        ["nanny_name", fullName],
        ["nanny_email", String(derived?.email || normalizedEmail || existingNannyEmail || "").trim()],
        ["nanny_phone", phone.trim()],
        ["nanny_address", address.trim()],
        ["nanny_city", resolvedCity],
        ["nanny_country", country.trim()],
        ["nanny_gender", gender.trim()],
        ["nanny_about", bio.trim()],
        ["nanny_experience", String(experience)],
        ["nanny_dob", dateOfBirth.trim()],
        ["user_type", "nanny"],
      ];

      const serverImage =
        result?.profile?.user_image_url ||
        result?.user_image_url ||
        profileImg?.uri ||
        "";

      if (serverImage) {
        storagePairs.push(["nanny_image", String(serverImage)]);
      }

      const serverCertificate =
        result?.profile?.certificate_url ||
        result?.data?.certificate_url ||
        result?.certificate_url ||
        "";

      if (serverCertificate) {
        storagePairs.push(["nanny_certificate", String(serverCertificate)]);
      }

      if (derivedToken) {
        storagePairs.push(["token", String(derivedToken)]);
      }

      await AsyncStorage.multiSet(storagePairs);

      await AsyncStorage.multiRemove([
        "user_id",
        "user_name",
        "user_email",
        "user_phone",
        "user_address",
        "user_city",
        "user_country",
        "user_gender",
        "user_about",
        "user_experience",
        "user_dob",
        "user_image",
        "user_certificate",
      ]);

      Alert.alert("Success", "Syttr profile updated successfully!");
      onSuccess();
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeScreen>
      <LinearGradient
        style={styles.container}
        colors={["#FFF7F0", "#FFF1E1", "#FFE8EE"]}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          >
            <Animated.View style={{ opacity: fadeAnim }}>
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
                <Ionicons name="chevron-back" size={rs(20)} color="#FF80AB" />
              </TouchableOpacity>

              <View style={styles.heroCard}>
                <Text style={styles.title}>Create Syttr Profile</Text>
                <Text style={styles.subtitle}>Tell us about yourself to get started</Text>

                <View style={styles.avatarWrap}>
                  <TouchableOpacity onPress={pickProfileImage} activeOpacity={0.8}>
                    <View style={styles.avatarCircle}>
                      {profileImg ? (
                        <Image source={{ uri: profileImg.uri }} style={styles.avatarImg} />
                      ) : (
                        <Ionicons name="camera-outline" size={rs(28)} color="#FF80AB" />
                      )}
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.photoHint}>Tap to add profile photo</Text>
                </View>
              </View>

              <View style={styles.formCard}>
                <FormInput
                  label="First Name *"
                  value={firstName}
                  setValue={setFirstName}
                  autofillBehavior={iosAutofillMode}
                  autoCapitalize="words"
                  autoComplete={Platform.OS === "android" ? "name-given" : undefined}
                  textContentType={Platform.OS === "ios" ? "givenName" : undefined}
                />

                <FormInput
                  label="Last Name *"
                  value={lastName}
                  setValue={setLastName}
                  autofillBehavior={iosAutofillMode}
                  autoCapitalize="words"
                  autoComplete={Platform.OS === "android" ? "name-family" : undefined}
                  textContentType={Platform.OS === "ios" ? "familyName" : undefined}
                />

                <FormInput
                  label="Email *"
                  value={email}
                  setValue={handleEmailChange}
                  onFocus={handleEmailFocus}
                  autofillBehavior={iosAutofillMode}
                  keyboard="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={Platform.OS === "android" ? "email" : undefined}
                  textContentType={Platform.OS === "ios" ? "emailAddress" : undefined}
                  editable
                />

                <FormInput
                  label="Password *"
                  value={password}
                  setValue={handlePasswordChange}
                  onFocus={handlePasswordFocus}
                  autofillBehavior={iosAutofillMode}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={Platform.OS === "android" ? "new-password" : undefined}
                  textContentType={Platform.OS === "ios" ? "newPassword" : undefined}
                  secureTextEntry
                  editable
                />

                <FormInput
                  label="Phone *"
                  value={phone}
                  setValue={handlePhoneChange}
                  onFocus={handlePhoneFocus}
                  autofillBehavior={iosAutofillMode}
                  keyboard={Platform.OS === "ios" ? "phone-pad" : "number-pad"}
                  autoCorrect={false}
                  autoComplete={Platform.OS === "android" ? "tel" : undefined}
                  textContentType={Platform.OS === "ios" ? "telephoneNumber" : undefined}
                  inputMode="tel"
                  editable
                />

                <AvailableStateSelector
                  value={state}
                  onSelect={(nextState) => {
                    if (state && nextState !== state) {
                      setAddress("");
                      setCity("");
                    }
                    setState(nextState);
                  }}
                  onStatesLoaded={setAvailableStates}
                />

                <View style={{ marginBottom: rs(14) }}>
                  <Text style={styles.label}>Address *</Text>
                  <TextInput
                    value={address}
                    onChangeText={(next) => {
                      setAddress(next);
                      setShowLocationSuggestions(true);
                    }}
                    onFocus={() => setShowLocationSuggestions(true)}
                    onBlur={() => {
                      setTimeout(() => hideLocationSuggestions(), 120);
                    }}
                    style={styles.input}
                    autoCapitalize="words"
                    autoCorrect={false}
                    autoComplete={Platform.OS === "android" ? "street-address" : undefined}
                    textContentType={Platform.OS === "ios" ? "fullStreetAddress" : undefined}
                    placeholder="Address *"
                    placeholderTextColor="#C67A93"
                  />
                  {showLocationSuggestions &&
                  (loadingLocationSuggestions ||
                    locationSuggestions.length > 0 ||
                    String(address || "").trim().length >= 2) ? (
                    <View style={styles.locationSuggestionsBox}>
                      {loadingLocationSuggestions ? (
                        <View style={styles.locationSuggestionLoadingRow}>
                          <Ionicons name="search-outline" size={16} color="#FF80AB" />
                          <Text style={styles.locationSuggestionLoadingText}>
                            Searching addresses...
                          </Text>
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
                                  <Text
                                    numberOfLines={1}
                                    style={styles.locationSuggestionSecondaryText}
                                  >
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
                  {!!locationSearchError && (
                    <Text style={styles.locationSuggestionLoadingText}>{locationSearchError}</Text>
                  )}
                </View>

                <FormInput
                  label="City *"
                  value={city}
                  setValue={setCity}
                  autofillBehavior={iosAutofillMode}
                  autoCapitalize="words"
                  autoComplete={Platform.OS === "android" ? "postal-address-locality" : undefined}
                  textContentType={Platform.OS === "ios" ? "addressCity" : undefined}
                />

                <TouchableOpacity
                  style={[styles.locationBtn, locating && { opacity: 0.7 }]}
                  onPress={useCurrentLocation}
                  disabled={locating}
                >
                  <Ionicons name="navigate" size={rs(16)} color="#FF80AB" />
                  <Text style={styles.locationText}>
                    {locating ? "Fetching location..." : "Locate me"}
                  </Text>
                </TouchableOpacity>

                <FormInput
                  label="Experience (years) *"
                  value={experience}
                  setValue={setExperience}
                  autofillBehavior={iosAutofillMode}
                  keyboard="numeric"
                  autoCorrect={false}
                  inputMode="numeric"
                />

                <FormInput
                  label="Tell us about yourself! *"
                  placeholder="Past experience, special skills/interests, certifications or training, what you enjoy most about working with children, etc."
                  value={bio}
                  setValue={setBio}
                  autofillBehavior={iosAutofillMode}
                  lines={4}
                />

                <Dropdown
                  label="Gender *"
                  value={gender}
                  options={["Female", "Male", "Other"]}
                  onSelect={setGender}
                />

                <Dropdown
                  label="Country *"
                  value={country}
                  options={COUNTRY_OPTIONS}
                  onSelect={setCountry}
                />

                <DateField
                  label="Date of Birth *"
                  value={dateOfBirth}
                  onPress={openDatePicker}
                  onChangeWeb={handleWebDateChange}
                />

                {Platform.OS === "ios" ? (
                  <Modal
                    transparent
                    animationType="fade"
                    visible={showDatePicker}
                    onRequestClose={closeDatePicker}
                  >
                    <View style={styles.pickerOverlay}>
                      <View style={styles.pickerCard}>
                        <Text style={styles.pickerTitle}>Select Date of Birth</Text>
                        <DateTimePicker
                          value={selectedDate || datePickerInitialValue || parseDateInput(dateOfBirth) || new Date()}
                          mode="date"
                          display="inline"
                          maximumDate={new Date()}
                          accentColor="#FF80AB"
                          textColor="#C2185B"
                          themeVariant="light"
                          onChange={handleDateChange}
                        />
                        <View style={styles.pickerActions}>
                          <TouchableOpacity onPress={closeDatePicker}>
                            <Text style={styles.pickerCancel}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={confirmDatePicker}>
                            <Text style={styles.pickerOk}>Done</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </Modal>
                ) : (
                  showDatePicker && (
                    <DateTimePicker
                      value={selectedDate || datePickerInitialValue || parseDateInput(dateOfBirth) || new Date()}
                      mode="date"
                      display="default"
                      maximumDate={new Date()}
                      accentColor="#FF80AB"
                      themeVariant="light"
                      onChange={handleDateChange}
                    />
                  )
                )}

                <FormInput
                  label="Referral Code (Optional)"
                  value={referral}
                  setValue={setReferral}
                  autofillBehavior={iosAutofillMode}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />

                <UploadBox
                  text={resumeFile?.name ?? "Upload Resume (Optional)"}
                  onPress={() => pickDocument(setResumeFile)}
                />

                <UploadBox
                  text={certificateFile?.name ?? "Upload Certificate (Optional)"}
                  onPress={() => pickDocument(setCertificateFile)}
                />

                <TouchableOpacity
                  style={[styles.submitBtn, loading && { opacity: 0.7 }]}
                  onPress={submitProfile}
                  disabled={loading}
                >
                  <Text style={styles.submitText}>
                    {loading ? "Submitting..." : "Create Profile"}
                  </Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </SafeScreen>
  );
};

export default CreateNannyProfileScreen;

type RenderInputParams = {
  label: string;
  placeholder?: string;
  value: string;
  setValue: (text: string) => void;
  onFocus?: () => void;
  keyboard?: KeyboardTypeOptions;
  lines?: number;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: TextInputProps["autoComplete"];
  textContentType?: TextInputProps["textContentType"];
  autoCorrect?: boolean;
  spellCheck?: boolean;
  inputMode?: TextInputProps["inputMode"];
  importantForAutofill?: TextInputProps["importantForAutofill"];
  editable?: boolean;
  autofillBehavior?: AutofillBehavior;
  secureTextEntry?: boolean;
};

type AutofillBehavior = "default" | "disabled";

const FormInput = React.memo(function FormInput({
  label,
  placeholder,
  value,
  setValue,
  onFocus,
  keyboard = "default",
  lines = 1,
  autoCapitalize = "sentences",
  autoComplete,
  textContentType,
  autoCorrect = Platform.OS === "ios" ? false : true,
  spellCheck,
  inputMode,
  importantForAutofill = "yes",
  editable = true,
  autofillBehavior = "default",
  secureTextEntry = false,
}: RenderInputParams) {
  const resolvedAutoComplete =
    autofillBehavior === "disabled" && Platform.OS === "ios" ? "off" : autoComplete;
  const resolvedTextContentType =
    autofillBehavior === "disabled" && Platform.OS === "ios" ? "none" : textContentType;
  const resolvedImportantForAutofill =
    autofillBehavior === "disabled" ? "no" : importantForAutofill;

  return (
    <View style={{ marginBottom: rs(14) }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        onFocus={onFocus}
        editable={editable}
        style={styles.input}
        keyboardType={keyboard}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        spellCheck={Platform.OS === "ios" ? (spellCheck ?? false) : undefined}
        autoComplete={resolvedAutoComplete}
        textContentType={resolvedTextContentType}
        importantForAutofill={Platform.OS === "android" ? resolvedImportantForAutofill : undefined}
        inputMode={inputMode}
        secureTextEntry={secureTextEntry}
        multiline={lines > 1}
        numberOfLines={lines}
        placeholder={placeholder ?? label}
        placeholderTextColor="#C67A93"
        clearButtonMode={Platform.OS === "ios" && lines === 1 ? "while-editing" : undefined}
      />
    </View>
  );
});

type DropdownProps = {
  label: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
};

const Dropdown: React.FC<DropdownProps> = ({ label, value, options, onSelect }) => {
  const [open, setOpen] = useState(false);

  return (
    <View style={{ marginBottom: rs(14) }}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.dropdown}
        onPress={() => setOpen((prev) => !prev)}
      >
        <Text style={styles.dropdownText}>{value || "Select"}</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={rs(18)}
          color="#FF80AB"
        />
      </TouchableOpacity>

      {open && (
        <View style={styles.dropdownMenu}>
          {options.map((option, idx) => (
            <TouchableOpacity
              key={option}
              style={[
                styles.dropdownItem,
                idx === options.length - 1 && { borderBottomWidth: 0 },
              ]}
              onPress={() => {
                onSelect(option);
                setOpen(false);
              }}
            >
              <Text style={styles.dropdownItemText}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

type UploadBoxProps = {
  text: string;
  onPress: () => void;
};

const UploadBox: React.FC<UploadBoxProps> = ({ text, onPress }) => (
  <TouchableOpacity style={styles.uploadBox} onPress={onPress}>
    <Text style={styles.uploadText}>{text}</Text>
  </TouchableOpacity>
);

type DateFieldProps = {
  label: string;
  value: string;
  onPress: () => void;
  onChangeWeb?: (value: string) => void;
};

const DateField: React.FC<DateFieldProps> = ({ label, value, onPress, onChangeWeb }) => (
  <View style={{ marginBottom: rs(14) }}>
    <Text style={styles.label}>{label}</Text>
    {Platform.OS === "web" ? (
      <input
        type="date"
        value={value}
        onChange={(e) => onChangeWeb?.(e.target.value)}
        style={{
          width: "100%",
          minHeight: rs(50),
          backgroundColor: "#fff",
          padding: rs(14),
          borderRadius: rs(12),
          borderWidth: 1,
          borderColor: "#FF80AB",
          fontSize: rf(15),
          color: "#880E4F",
          fontFamily: Fonts.display,
          outlineStyle: "none",
          outlineWidth: 0,
          outlineColor: "transparent",
          boxSizing: "border-box",
          cursor: "pointer",
        }}
      />
    ) : (
      <TouchableOpacity style={styles.dateField} onPress={onPress}>
        <Text style={styles.dropdownText}>
          {formatDobForDisplay(value) || "Select date"}
        </Text>
        <Ionicons name="calendar-outline" size={rs(18)} color="#FF80AB" />
      </TouchableOpacity>
    )}
  </View>
);

const formatDobForDisplay = (value: string) => {
  const raw = (value || "").trim();
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[2]}-${isoMatch[3]}-${isoMatch[1]}`;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${month}-${day}-${year}`;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  scroll: {
    padding: rs(18),
    flexGrow: 1,
  },

  backBtn: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    backgroundColor: "rgba(255,255,255,0.96)",
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    marginBottom: rs(12),
  },

  heroCard: {
    backgroundColor: "rgba(255,255,255,0.72)",
    borderRadius: rs(18),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,173,200,0.28)",
    marginBottom: rs(14),
  },

  formCard: {
    backgroundColor: "rgba(255,255,255,0.78)",
    borderRadius: rs(18),
    padding: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,184,206,0.26)",
  },

  title: {
    fontSize: rf(30),
    fontWeight: "700",
    color: "#9B2C63",
    textAlign: "center",
    fontFamily: Fonts.display,
  },

  subtitle: {
    fontSize: rf(16),
    color: "#BA4B7F",
    marginBottom: rs(8),
    textAlign: "center",
    fontFamily: Fonts.display,
  },

  avatarWrap: {
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

  avatarImg: {
    width: rs(110),
    height: rs(110),
    borderRadius: rs(55),
  },

  photoHint: {
    marginTop: rs(8),
    color: "#BA4B7F",
    fontSize: rf(12),
    fontFamily: Fonts.display,
  },

  label: {
    fontSize: rf(14),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(6),
    fontFamily: Fonts.display,
  },

  input: {
    backgroundColor: "#fff",
    padding: rs(14),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.55)",
    fontSize: rf(15),
    color: "#880E4F",
    fontFamily: Fonts.display,
  },

  dropdown: {
    backgroundColor: "#fff",
    padding: rs(14),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.55)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    elevation: 3,
  },

  dropdownText: {
    fontSize: rf(15),
    color: "#880E4F",
    fontFamily: Fonts.display,
  },

  dropdownMenu: {
    backgroundColor: "#fff",
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.55)",
    marginTop: rs(6),
    overflow: "hidden",
    elevation: 3,
  },

  dropdownItem: {
    paddingVertical: rs(12),
    paddingHorizontal: rs(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#F8CFE1",
  },

  dropdownItemText: {
    fontSize: rf(15),
    color: "#880E4F",
    fontFamily: Fonts.display,
  },

  dateField: {
    backgroundColor: "#fff",
    padding: rs(14),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.55)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    elevation: 3,
  },

  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.38)",
    justifyContent: "center",
    alignItems: "center",
    padding: rs(20),
  },

  pickerCard: {
    width: "100%",
    maxWidth: rs(420),
    backgroundColor: "#FFF5EA",
    borderRadius: rs(18),
    padding: rs(18),
    borderWidth: 1,
    borderColor: "rgba(194,24,91,0.14)",
    shadowColor: "#C2185B",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  pickerTitle: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#8B1E53",
    marginBottom: rs(10),
    fontFamily: Fonts.display,
    textAlign: "center",
  },

  pickerActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: rs(12),
  },

  pickerCancel: {
    color: "#8B1E53",
    fontSize: rf(14),
    fontWeight: "700",
    fontFamily: Fonts.display,
  },

  pickerOk: {
    color: "#C2185B",
    fontSize: rf(14),
    fontWeight: "700",
    fontFamily: Fonts.display,
  },

  uploadBox: {
    backgroundColor: "#fff",
    padding: rs(16),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.55)",
    marginBottom: rs(14),
  },

  uploadText: {
    color: "#AD1457",
    fontWeight: "700",
    fontFamily: Fonts.display,
  },

  submitBtn: {
    backgroundColor: "#FF9CBD",
    padding: rs(16),
    borderRadius: rs(16),
    alignItems: "center",
    marginTop: rs(20),
    elevation: 6,
  },

  submitText: {
    color: "#fff",
    fontSize: rf(16),
    fontWeight: "700",
    fontFamily: Fonts.display,
  },

  locationBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: rs(14),
    backgroundColor: "#FFF2F7",
    paddingVertical: rs(8),
    paddingHorizontal: rs(12),
    borderRadius: rs(10),
    alignSelf: "flex-start",
  },

  locationText: {
    color: "#BA4B7F",
    fontWeight: "600",
    fontFamily: Fonts.display,
    marginLeft: rs(8),
  },
  locationSuggestionsBox: {
    marginTop: rs(6),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.55)",
    backgroundColor: "#fff",
    overflow: "hidden",
    elevation: 3,
  },
  locationSuggestionLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    paddingHorizontal: rs(12),
    paddingVertical: rs(12),
  },
  locationSuggestionLoadingText: {
    color: "#BA4B7F",
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
    borderTopColor: "#F8CFE1",
  },
  locationSuggestionTextWrap: {
    flex: 1,
  },
  locationSuggestionMainText: {
    color: "#880E4F",
    fontSize: rf(13),
    fontWeight: "600",
    fontFamily: Fonts.display,
  },
  locationSuggestionSecondaryText: {
    color: "#BA4B7F",
    fontSize: rf(11),
    marginTop: rs(2),
    fontFamily: Fonts.display,
  },
});
