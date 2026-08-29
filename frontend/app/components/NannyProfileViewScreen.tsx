import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { DocumentPicker } from "../utils/safeDocumentPicker";
import { ImagePicker } from "../utils/safeImagePicker";
import { FileSystem } from "../utils/safeFileSystem";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
} from "react-native";
import { apiRequest, BASE_URL, getRuntimeApiKey, isVerificationRequiredApiError, sanitizeToken, updateNannyProfile } from "../Api";
import SafeScreen from "../components/SafeScreen";
import { Location } from "../utils/safeLocation";
import { hp, rf, rs, wp } from "../utils/responsive";
import { formatDateToMDY } from "../utils/dateFormat";
import { resolveSessionImageUrl } from "../../lib/nannySessionProfile";
import { rewriteLoopbackAbsoluteUrl } from "../../lib/urlHosts";

const API_BASE = String(BASE_URL || "").replace(/\/+$/, "");
const STORAGE_BASE = API_BASE.replace(/\/api\/?$/, "");
const ASSET_CACHE_BUST = "asset_v=20260327_1";

type NannyProfile = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  gender?: string;
  experience?: string | number;
  about_me?: string;
  avatar?: string;
  certificate?: string;
  completed_jobs?: string | number;
  date_of_birth?: string;
};

type Props = {
  navigation?: any;
  onBack?: () => void;
  onEdit?: () => void;
  onRequireVerification?: () => void;
};

const NANNY_PRIMARY_KEYS = {
  name: "nanny_name",
  email: "nanny_email",
  phone: "nanny_phone",
  address: "nanny_address",
  city: "nanny_city",
  country: "nanny_country",
  gender: "nanny_gender",
  about: "nanny_about",
  image: "nanny_image",
  certificate: "nanny_certificate",
  experience: "nanny_experience",
  date_of_birth: "nanny_dob",
} as const;

const NANNY_LEGACY_KEYS = {
  name: "user_name",
  email: "user_email",
  phone: "user_phone",
  address: "user_address",
  city: "user_city",
  country: "user_country",
  gender: "user_gender",
  about: "user_about",
  image: "user_image",
  certificate: "user_certificate",
  experience: "user_experience",
  date_of_birth: "user_dob",
} as const;

const getStoredNannyValue = async (key: keyof typeof NANNY_PRIMARY_KEYS) => {
  const primary = NANNY_PRIMARY_KEYS[key];
  const legacy = NANNY_LEGACY_KEYS[key];

  const primaryValue = await AsyncStorage.getItem(primary);
  if (primaryValue !== null) return primaryValue;

  const legacyValue = await AsyncStorage.getItem(legacy);
  if (legacyValue !== null) {
    await AsyncStorage.setItem(primary, legacyValue);
  }
  return legacyValue;
};

const clearLegacyNannyKeys = () =>
  AsyncStorage.multiRemove(Object.values(NANNY_LEGACY_KEYS));

const resolveApiKey = async (): Promise<string | undefined> => {
  const stored = String((await AsyncStorage.getItem("api_key")) || "").trim();
  const runtime = String(getRuntimeApiKey() || "").trim();
  const resolved = stored || runtime;
  if (!stored && runtime) {
    try {
      await AsyncStorage.setItem("api_key", runtime);
    } catch {
      // ignore storage failures; runtime key is still returned
    }
  }
  return resolved || undefined;
};

const inferMimeFromUri = (uri: string): string => {
  const lower = String(uri || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  return "image/jpeg";
};

const inferCertificateLabel = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutQuery = raw.split("?")[0].split("#")[0];
  const parts = withoutQuery.split("/");
  return decodeURIComponent(parts[parts.length - 1] || raw);
};

const resolveProfileImage = (value?: string | null) => {
  const normalized = resolveSessionImageUrl(value);
  if (!normalized) return "";
  const rewritten = rewriteLoopbackAbsoluteUrl(normalized, STORAGE_BASE);
  return /^https?:\/\//i.test(rewritten)
    ? `${rewritten}${rewritten.includes("?") ? "&" : "?"}${ASSET_CACHE_BUST}`
    : rewritten;
};

const resolveCertificateUrl = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:)/i.test(raw)) {
    if (!/^https?:/i.test(raw)) return raw;
    const rewritten = rewriteLoopbackAbsoluteUrl(raw, STORAGE_BASE);
    return `${rewritten}${rewritten.includes("?") ? "&" : "?"}${ASSET_CACHE_BUST}`;
  }
  const clean = raw.replace(/^\/+/, "");
  if (clean.startsWith("storage/") || clean.startsWith("public/")) {
    const rewritten = rewriteLoopbackAbsoluteUrl(`${STORAGE_BASE}/${clean}`, STORAGE_BASE);
    return `${rewritten}${rewritten.includes("?") ? "&" : "?"}${ASSET_CACHE_BUST}`;
  }
  const rewritten = rewriteLoopbackAbsoluteUrl(`${STORAGE_BASE}/storage/${clean}`, STORAGE_BASE);
  return `${rewritten}${rewritten.includes("?") ? "&" : "?"}${ASSET_CACHE_BUST}`;
};

const isImageAsset = (value?: string | null) => {
  const raw = String(value || "").trim().toLowerCase();
  return !!raw && (
    raw.startsWith("data:image/") ||
    raw.includes(".png") ||
    raw.includes(".jpg") ||
    raw.includes(".jpeg") ||
    raw.includes(".gif") ||
    raw.includes(".webp") ||
    raw.includes(".heic") ||
    raw.includes(".heif")
  );
};

const NannyProfileViewScreen: React.FC<Props> = ({ navigation, onBack, onEdit, onRequireVerification }) => {
  const [profile, setProfile] = useState<NannyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const [localName, setLocalName] = useState<string | undefined>(undefined);
  const [localEmail, setLocalEmail] = useState<string | undefined>(undefined);
  const [localAddress, setLocalAddress] = useState<string | undefined>(undefined);
  const [localCity, setLocalCity] = useState<string | undefined>(undefined);
  const [localCountry, setLocalCountry] = useState<string | undefined>(undefined);
  const [localPhone, setLocalPhone] = useState<string | undefined>(undefined);
  const [localAbout, setLocalAbout] = useState<string | undefined>(undefined);
  const [localGender, setLocalGender] = useState<string | undefined>(undefined);
  const [localAvatar, setLocalAvatar] = useState<string | undefined>(undefined);
  const [localCertificate, setLocalCertificate] = useState<string | undefined>(undefined);
  const [localDob, setLocalDob] = useState<string | undefined>(undefined);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [gender, setGender] = useState("");
  const [experience, setExperience] = useState("");
  const [about, setAbout] = useState("");
  const [dob, setDob] = useState("");
  const [imageFile, setImageFile] = useState<any>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [certificateFile, setCertificateFile] = useState<any>(null);
  const [certificateLabel, setCertificateLabel] = useState<string>("");
  const [genderOpen, setGenderOpen] = useState(false);
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [showCertificatePreview, setShowCertificatePreview] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [certificatePreviewFailed, setCertificatePreviewFailed] = useState(false);
  const blobPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    hydrateFromStorage();
    loadProfile();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof URL === "undefined") return;

    const previousBlob = blobPreviewRef.current;
    if (previousBlob && previousBlob !== imagePreview && previousBlob.startsWith("blob:")) {
      URL.revokeObjectURL(previousBlob);
    }

    blobPreviewRef.current = imagePreview && imagePreview.startsWith("blob:") ? imagePreview : null;

    return () => {
      const currentBlob = blobPreviewRef.current;
      if (currentBlob && currentBlob.startsWith("blob:")) {
        URL.revokeObjectURL(currentBlob);
        blobPreviewRef.current = null;
      }
    };
  }, [imagePreview]);

  const hydrateFromStorage = async () => {
    const [name, email, phone, address, city, country, about, gender, image, certificate, exp, dobVal] = await Promise.all([
      getStoredNannyValue("name"),
      getStoredNannyValue("email"),
      getStoredNannyValue("phone"),
      getStoredNannyValue("address"),
      getStoredNannyValue("city"),
      getStoredNannyValue("country"),
      getStoredNannyValue("about"),
      getStoredNannyValue("gender"),
      getStoredNannyValue("image"),
      getStoredNannyValue("certificate"),
      getStoredNannyValue("experience"),
      getStoredNannyValue("date_of_birth"),
    ]);

    setLocalName(name || undefined);
    setLocalEmail(email || undefined);
    setLocalAddress(address || undefined);
    setLocalCity(city || undefined);
    setLocalCountry(country || undefined);
    setLocalPhone(phone || undefined);
    setLocalAbout(about || undefined);
    setLocalGender(gender || undefined);
    setLocalAvatar(image || undefined);
    setLocalCertificate(certificate || undefined);
    setLocalDob(dobVal || undefined);

    const nameParts = (name || "").trim().split(" ");
    setFirstName(nameParts.shift() || "");
    setLastName(nameParts.join(" "));
    setPhone(phone || "");
    setAddress(address || "");
    setCity(city || "");
    setCountry(country || "");
    setGender(gender || "");
    setAbout(about || "");
    setExperience(exp || "");
    setImagePreview(image || "");
    setCertificateLabel(inferCertificateLabel(certificate));
    setDob(dobVal || "");

    setProfile((prev) => {
      const base = prev || {};
      return {
        ...base,
        name: name || base.name || "Syttr",
        email: email || base.email || "-",
        phone: phone || base.phone || "-",
        address: address || base.address || "",
        city: city || base.city || "City",
        country: country || base.country || "Country",
        about_me: about || base.about_me || "",
        gender: gender || base.gender || "",
        avatar: image || base.avatar,
        certificate: certificate || base.certificate,
        completed_jobs: base.completed_jobs,
        experience: exp || base.experience || "",
        date_of_birth: dobVal || base.date_of_birth,
      };
    });
  };

  const mapApiProfile = (p: any): NannyProfile => {
    if (!p) return {};
    const fullName =
      p.name ||
      p.fullname ||
      [p.firstname || p.first_name, p.lastname || p.last_name].filter(Boolean).join(" ").trim();

    const image = resolveProfileImage(
      p.avatar ||
        p.user_image_url ||
        p.profile_image ||
        p.profile_image_url ||
        p.user_image ||
        p.user?.user_image_url ||
        p.user?.profile_image_url ||
        p.user?.profile_image ||
        p.user?.user_image ||
        p.user?.avatar
    );
    const certificateRaw =
      p.certificate_url ||
      p.certificate_file_url ||
      p.certificate ||
      p.certificate_file ||
      undefined;
    const certificate =
      certificateRaw && (/^https?:\/\//i.test(String(certificateRaw)) || /^data:/i.test(String(certificateRaw)))
        ? String(certificateRaw)
        : certificateRaw
        ? `${STORAGE_BASE}/storage/${String(certificateRaw).replace(/^\/+/, "")}`
        : undefined;

    const mapped: NannyProfile = {};
    if (fullName) mapped.name = fullName;
    if (p.email) mapped.email = p.email;
    if (p.phone || p.number) mapped.phone = p.phone || p.number;
    if (p.address || p.street_address || p.location) {
      mapped.address = p.address || p.street_address || p.location;
    }
    if (p.city || p.city_area) mapped.city = p.city || p.city_area;
    if (p.country) mapped.country = p.country;
    if (p.gender) mapped.gender = p.gender;
    const exp = p.experience || p.years_of_experience || p.experience_years || p.age;
    if (exp !== undefined && exp !== null) mapped.experience = exp;
    if (p.about_me || p.bio || p.about) mapped.about_me = p.about_me || p.bio || p.about;
    if (image) mapped.avatar = image;
    if (certificate) mapped.certificate = String(certificate);
    const completedJobs =
      p.completed_jobs ??
      p.jobs_count ??
      p.total_jobs ??
      p.completedJobs;
    if (completedJobs !== undefined && completedJobs !== null) {
      mapped.completed_jobs = completedJobs;
    }
    const dob =
      p.date_of_birth ||
      p.dob ||
      p.birthdate ||
      p.birth_date ||
      p.dateOfBirth ||
      p.date_of_birth_formatted;
    if (dob) mapped.date_of_birth = String(dob);
    return mapped;
  };

  const pickImageWeb = () => {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (event: any) => {
      const file = event.target?.files?.[0];
      if (!file) return;
      setImageFile(file);
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    };
    input.click();
  };

  const ensureMediaPermission = async (forCamera?: boolean) => {
    if (forCamera) {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (!cam.granted) {
        Alert.alert("Permission", "Camera access is required to take a photo.");
        return false;
      }
    }
    const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!lib.granted) {
      Alert.alert("Permission", "Gallery access is required to pick a photo.");
      return false;
    }
    return true;
  };

  const pickImageFromLibrary = async () => {
    const ok = await ensureMediaPermission();
    if (!ok) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: [ImagePicker.MediaType.Images] as any,
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (asset?.uri) {
      setImageFile({
        uri: asset.uri,
        name: asset.fileName || "profile.jpg",
        type: asset.type || "image/jpeg",
      });
      setImagePreview(asset.uri);
    }
  };

  const takePhoto = async () => {
    const ok = await ensureMediaPermission(true);
    if (!ok) return;
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      mediaTypes: [ImagePicker.MediaType.Images] as any,
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (asset?.uri) {
      setImageFile({
        uri: asset.uri,
        name: asset.fileName || "profile.jpg",
        type: asset.type || "image/jpeg",
      });
      setImagePreview(asset.uri);
    }
  };

  const pickImage = async () => {
    if (Platform.OS === "web") return pickImageWeb();
    Alert.alert("Profile photo", "Choose an option", [
      { text: "Take photo", onPress: takePhoto },
      { text: "Choose from gallery", onPress: pickImageFromLibrary },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const pickCertificate = async () => {
    try {
      const result = (await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        multiple: false,
        copyToCacheDirectory: true,
      })) as any;

      const canceled = result?.canceled ?? result?.type === "cancel";
      if (canceled) return;

      const asset = Array.isArray(result?.assets) && result.assets.length > 0 ? result.assets[0] : result;
      const uri = String(asset?.uri || "").trim();
      if (!uri) return;

      const name = String(asset?.name || "certificate").trim();
      const type = String(asset?.mimeType || asset?.type || inferMimeFromUri(uri)).trim();
      const isPdf = type.toLowerCase().includes("pdf") || name.toLowerCase().endsWith(".pdf");
      const isImage = type.toLowerCase().startsWith("image/");
      if (!isPdf && !isImage) {
        Alert.alert("Certificate", "Please upload a PDF or image file.");
        return;
      }

      setCertificateFile({
        uri,
        name,
        type: isPdf ? "application/pdf" : type || inferMimeFromUri(uri),
        file: asset?.file,
      });
      setCertificateLabel(name);
    } catch {
      Alert.alert("Certificate", "Could not pick a certificate file right now.");
    }
  };

  const useCurrentLocation = async () => {
    if (locating || saving) return;

    try {
      setLocating(true);

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

      const latitude = Number(current?.coords?.latitude);
      const longitude = Number(current?.coords?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("Invalid location coordinates");
      }

      const reverse = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
      const best = Array.isArray(reverse) && reverse.length > 0 ? reverse[0] : null;

      const streetLine = [best?.streetNumber, best?.street, best?.name].filter(Boolean).join(" ").trim();
      const cityLine = String(best?.city || best?.subregion || best?.region || "").trim();
      const countryLine = String(best?.country || best?.isoCountryCode || "").trim();
      const formattedAddress = [streetLine, cityLine, countryLine].filter(Boolean).join(", ");
      const coordsLabel = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

      setAddress(formattedAddress || coordsLabel);
      if (cityLine) setCity(cityLine);
      if (countryLine) setCountry(countryLine);

      if (!formattedAddress) {
        Alert.alert("Location", "Could not read full address. Coordinates added instead.");
      }
    } catch {
      Alert.alert("Location", "Unable to fetch current location right now.");
    } finally {
      setLocating(false);
    }
  };

  const saveProfile = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert("Heads up", "Please enter your first and last name.");
      return;
    }
    try {
      setSaving(true);
      const token = await AsyncStorage.getItem("token");
      const uploadApiKey = await resolveApiKey();
      const userId =
        (await AsyncStorage.getItem("nanny_id")) ||
        (await AsyncStorage.getItem("user_id")) ||
        (await AsyncStorage.getItem("id"));
      if (!userId) {
        Alert.alert("Session issue", "User ID not found. Please sign in again.");
        return;
      }

      const payload: any = {
        id: userId,
        nanny_id: userId,
        fullname: `${firstName.trim()} ${lastName.trim()}`.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        location: address.trim(),
        city: city.trim(),
        country: country.trim(),
        gender: gender.trim(),
        experience: experience ? Number(experience) : undefined,
        about: about.trim(),
        date_of_birth: dob.trim() || undefined,
      };

      if (imageFile) {
        let imageDataUrl: string | undefined;
        if (Platform.OS === "web" && typeof File !== "undefined" && imageFile instanceof File) {
          imageDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Failed to read selected image."));
            reader.readAsDataURL(imageFile);
          });
        } else {
          const imageUri = String(imageFile?.uri || "").trim();
          if (imageUri) {
            const base64 = await FileSystem.readAsStringAsync(imageUri, {
              encoding: "base64" as any,
            });
            const mime = String(imageFile?.type || inferMimeFromUri(imageUri)).trim() || "image/jpeg";
            imageDataUrl = `data:${mime};base64,${base64}`;
          }
        }

        if (imageDataUrl) {
          payload.user_image_base64 = imageDataUrl;
        }
      }

      if (certificateFile) {
        let certificateDataUrl: string | undefined;
        const webFile = certificateFile?.file;
        if (Platform.OS === "web" && typeof File !== "undefined" && webFile instanceof File) {
          certificateDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Failed to read selected certificate."));
            reader.readAsDataURL(webFile);
          });
        } else {
          const certificateUri = String(certificateFile?.uri || "").trim();
          if (certificateUri) {
            const base64 = await FileSystem.readAsStringAsync(certificateUri, {
              encoding: "base64" as any,
            });
            const mime = String(certificateFile?.type || inferMimeFromUri(certificateUri)).trim() || "application/pdf";
            certificateDataUrl = `data:${mime};base64,${base64}`;
          }
        }

        if (certificateDataUrl) {
          payload.certificate_base64 = certificateDataUrl;
        }
      }

      const json = await updateNannyProfile(payload, token || undefined, uploadApiKey);

      const merged = { ...(profile || {}), ...mapApiProfile(json?.data || json) };
      const avatarFromApi = resolveProfileImage(
        json?.user_image_url ||
        json?.data?.user_image_url ||
        json?.profile_image_url ||
        json?.data?.profile_image_url ||
        merged.avatar ||
        imagePreview ||
        localAvatar ||
        ""
      );
      merged.avatar = avatarFromApi;
      const certificateFromApi = merged.certificate || localCertificate || "";
      merged.certificate = certificateFromApi;
      setProfile(merged);

      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const avatarUrl = resolveProfileImage(avatarFromApi);
      await AsyncStorage.multiSet([
        [NANNY_PRIMARY_KEYS.name, fullName],
        [NANNY_PRIMARY_KEYS.phone, phone.trim()],
        [NANNY_PRIMARY_KEYS.address, address.trim()],
        [NANNY_PRIMARY_KEYS.experience, experience ? String(experience) : ""],
        [NANNY_PRIMARY_KEYS.city, city.trim()],
        [NANNY_PRIMARY_KEYS.country, country.trim()],
        [NANNY_PRIMARY_KEYS.gender, gender.trim()],
        [NANNY_PRIMARY_KEYS.about, about.trim()],
        [NANNY_PRIMARY_KEYS.image, avatarUrl],
        [NANNY_LEGACY_KEYS.image, avatarUrl],
        [NANNY_PRIMARY_KEYS.certificate, certificateFromApi],
        [NANNY_LEGACY_KEYS.certificate, certificateFromApi],
        [NANNY_PRIMARY_KEYS.date_of_birth, dob.trim()],
        [NANNY_LEGACY_KEYS.date_of_birth, dob.trim()],
      ]);
      setLocalName(fullName);
      setLocalPhone(phone.trim());
      setLocalAddress(address.trim());
      setLocalCity(city.trim());
      setLocalCountry(country.trim());
      setLocalGender(gender.trim());
      setLocalAbout(about.trim());
      setLocalAvatar(avatarUrl);
      setLocalCertificate(certificateFromApi || undefined);
      setExperience(experience ? String(experience) : "");
      setLocalDob(dob.trim());

      Alert.alert("Profile updated", "Your Syttr profile was saved.");
      setShowEditModal(false);
      setGenderOpen(false);
      setImageFile(null);
      setCertificateFile(null);
      setCertificateLabel(inferCertificateLabel(certificateFromApi));
    } catch (err: any) {
      if (isVerificationRequiredApiError(err)) {
        onRequireVerification?.();
        return;
      }
      Alert.alert("Oops", err?.message || "Could not save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const loadProfile = async () => {
    setLoading(true);
    try {
      const tokenRaw =
        (await AsyncStorage.getItem("token")) ||
        (await AsyncStorage.getItem("nanny_token"));
      const token = sanitizeToken(tokenRaw || undefined);
      const apiKey = await resolveApiKey();
      const nannyId = (await AsyncStorage.getItem("nanny_id")) || (await AsyncStorage.getItem("user_id"));
      if (!nannyId) {
        Alert.alert("Error", "Session expired. Please login again.");
        return;
      }

      const queryParts = [`user_id=${encodeURIComponent(nannyId)}`];
      if (apiKey) queryParts.push(`api_key=${encodeURIComponent(apiKey)}`);
      const json: any = await apiRequest(`profiles/syttrs?${queryParts.join("&")}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
      });

      const profileRows = Array.isArray(json)
        ? json
        : Array.isArray((json as any)?.data)
        ? (json as any).data
        : [];
      let mapped = mapApiProfile(profileRows[0] || (json as any)?.data?.profile || (json as any)?.profile || json);

      if (!mapped.name || !mapped.email) {
        const detailsQuery = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : "";
        const detailsJson = await apiRequest<any>(
          `nannies/${encodeURIComponent(String(nannyId))}${detailsQuery}`,
          {
            method: "GET",
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
          }
        ).catch((error) => {
          if (isVerificationRequiredApiError(error)) {
            onRequireVerification?.();
          }
          return null;
        });
        if (detailsJson) {
          const detailMapped = mapApiProfile((detailsJson as any)?.data || detailsJson);
          mapped = { ...detailMapped, ...mapped };
        }
      }

      setProfile((prev) => ({ ...(prev || {}), ...mapped }));

      // Persist mapped data for quick rehydrate
      const fullName = mapped.name;
      const avatarUrl = resolveProfileImage(mapped.avatar);
      const certificateUrl = mapped.certificate;
      const sets: [string, string][] = [];
      if (fullName) sets.push([NANNY_PRIMARY_KEYS.name, fullName]);
      if (mapped.email) sets.push([NANNY_PRIMARY_KEYS.email, mapped.email]);
      if (mapped.phone) sets.push([NANNY_PRIMARY_KEYS.phone, mapped.phone]);
      if (mapped.address) sets.push([NANNY_PRIMARY_KEYS.address, mapped.address]);
      if (mapped.city) sets.push([NANNY_PRIMARY_KEYS.city, mapped.city]);
      if (mapped.country) sets.push([NANNY_PRIMARY_KEYS.country, mapped.country]);
      if (mapped.gender) sets.push([NANNY_PRIMARY_KEYS.gender, mapped.gender]);
      if (mapped.about_me) sets.push([NANNY_PRIMARY_KEYS.about, mapped.about_me]);
      if (mapped.experience !== undefined && mapped.experience !== null)
        sets.push([NANNY_PRIMARY_KEYS.experience, String(mapped.experience)]);
      if (avatarUrl) sets.push([NANNY_PRIMARY_KEYS.image, avatarUrl]);
      if (certificateUrl) sets.push([NANNY_PRIMARY_KEYS.certificate, certificateUrl]);
      if (mapped.date_of_birth)
        sets.push([NANNY_PRIMARY_KEYS.date_of_birth, String(mapped.date_of_birth)]);
      if (sets.length > 0) {
        await AsyncStorage.multiSet(sets);
      }
      const legacySets: [string, string][] = [];
      if (fullName) legacySets.push([NANNY_LEGACY_KEYS.name, fullName]);
      if (mapped.email) legacySets.push([NANNY_LEGACY_KEYS.email, mapped.email]);
      if (mapped.phone) legacySets.push([NANNY_LEGACY_KEYS.phone, mapped.phone]);
      if (mapped.address) legacySets.push([NANNY_LEGACY_KEYS.address, mapped.address]);
      if (mapped.city) legacySets.push([NANNY_LEGACY_KEYS.city, mapped.city]);
      if (mapped.country) legacySets.push([NANNY_LEGACY_KEYS.country, mapped.country]);
      if (mapped.gender) legacySets.push([NANNY_LEGACY_KEYS.gender, mapped.gender]);
      if (mapped.about_me) legacySets.push([NANNY_LEGACY_KEYS.about, mapped.about_me]);
      if (mapped.experience !== undefined && mapped.experience !== null) {
        legacySets.push([NANNY_LEGACY_KEYS.experience, String(mapped.experience)]);
      }
      if (avatarUrl) legacySets.push([NANNY_LEGACY_KEYS.image, avatarUrl]);
      if (certificateUrl) legacySets.push([NANNY_LEGACY_KEYS.certificate, certificateUrl]);
      if (mapped.date_of_birth) {
        legacySets.push([NANNY_LEGACY_KEYS.date_of_birth, String(mapped.date_of_birth)]);
      }
      if (legacySets.length > 0) {
        await AsyncStorage.multiSet(legacySets);
      }

      if (fullName) setLocalName(fullName);
      if (mapped.email) setLocalEmail(mapped.email);
      if (mapped.phone) setLocalPhone(mapped.phone);
      if (mapped.address) {
        setLocalAddress(mapped.address);
        setAddress(mapped.address);
      }
      if (mapped.city) setLocalCity(mapped.city);
      if (mapped.country) setLocalCountry(mapped.country);
      if (mapped.gender) setLocalGender(mapped.gender);
      if (mapped.about_me) setLocalAbout(mapped.about_me);
      if (mapped.experience !== undefined && mapped.experience !== null)
        setExperience(String(mapped.experience));
      if (avatarUrl) setLocalAvatar(avatarUrl);
      if (certificateUrl) {
        setLocalCertificate(certificateUrl);
        setCertificateLabel(inferCertificateLabel(certificateUrl));
      }
      if (mapped.date_of_birth) {
        const dobStr = String(mapped.date_of_birth);
        setLocalDob(dobStr);
        setDob(dobStr);
      }
    } catch (e: any) {
      if (isVerificationRequiredApiError(e)) {
        onRequireVerification?.();
        return;
      }
      Alert.alert("Profile", e?.message || "Unable to load profile.");
    } finally {
      setLoading(false);
    }
  };

  const formattedDob =
    formatDateToMDY(profile?.date_of_birth || localDob) || "-";
  const certificateUrl = resolveCertificateUrl(profile?.certificate || localCertificate);
  const certificatePreviewUrl = certificateUrl
    ? `${certificateUrl}${certificateUrl.includes("?") ? "&" : "?"}preview=1`
    : "";
  const certificateIsImage = isImageAsset(certificateUrl);

  useEffect(() => {
    setCertificatePreviewFailed(false);
  }, [certificateUrl]);
  useEffect(() => {
    setAvatarFailed(false);
  }, [profile?.avatar, localAvatar]);

  const parseDateInput = (value: string) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const formatDateForStorage = (value: Date) => {
    const yyyy = value.getFullYear();
    const mm = `${value.getMonth() + 1}`.padStart(2, "0");
    const dd = `${value.getDate()}`.padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const toDateInputValue = (value: string) => {
    if (!value) return "";
    const parsed = parseDateInput(value);
    if (!parsed) return "";
    return formatDateForStorage(parsed);
  };

  return (
    <SafeScreen edges={["top", "left", "right"]} style={{ backgroundColor: "#FFFFFF" }}>
      <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={{ flex: 1 }}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (onBack) onBack();
            else navigation?.goBack?.();
          }}
        >
          <Ionicons name="chevron-back" size={20} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.topTitle}>My Profile</Text>
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => {
            setShowEditModal(true);
          }}
        >
          <Ionicons name="create-outline" size={18} color="#C2185B" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#FF80AB" style={{ marginTop: rs(40) }} />
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.profileCard}>
            <View style={styles.avatarWrap}>
              {resolveProfileImage(profile?.avatar || localAvatar) && !avatarFailed ? (
                <Image
                  source={{ uri: resolveProfileImage(profile?.avatar || localAvatar) }}
                  style={styles.avatar}
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <Ionicons name="person" size={40} color="#FF80AB" />
              )}
            </View>

            <Text style={styles.name}>{profile?.name || localName || "Syttr"}</Text>
            <Text style={styles.subText}>
              {profile?.city || localCity || "City"} - {profile?.country || localCountry || "Country"}
            </Text>
          </View>

          <InfoCard title="Contact Information">
            <InfoRow icon="mail-outline" label={profile?.email || localEmail || "-"} />
            <InfoRow icon="call-outline" label={profile?.phone || localPhone || "-"} />
            <InfoRow icon="location-outline" label={profile?.address || localAddress || "-"} />
          </InfoCard>

          <InfoCard title="Personal Details">
            <InfoRow icon="female-outline" label={profile?.gender || localGender || "-"} />
            <InfoRow
              icon="calendar-outline"
              label={formattedDob}
            />
            <InfoRow
              icon="briefcase-outline"
              label={`${profile?.experience ?? "0"} years experience`}
            />
            <InfoRow
              icon="checkmark-done-outline"
              label={`${profile?.completed_jobs ?? 0} completed jobs`}
            />
          </InfoCard>

          <InfoCard title="About Me">
            <Text style={styles.aboutText}>
              {profile?.about_me || localAbout ||
                "No description added yet. Tell families more about yourself."}
            </Text>
          </InfoCard>

          <InfoCard title="Certifications">
            {certificateUrl ? (
              <View style={styles.certificateCard}>
                {certificateIsImage && !certificatePreviewFailed ? (
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => setShowCertificatePreview(true)}
                  >
                    <Image
                      source={{ uri: certificatePreviewUrl }}
                      style={styles.certificatePreview}
                      onError={() => setCertificatePreviewFailed(true)}
                    />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.certificateFileBox}>
                    <Ionicons
                      name={certificateIsImage ? "image-outline" : "document-text-outline"}
                      size={26}
                      color="#C2185B"
                    />
                    <Text style={styles.certificateFileName}>
                      {inferCertificateLabel(certificateUrl) || "Certificate uploaded"}
                    </Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.certificateButton}
                  onPress={() => {
                    if (certificateIsImage) {
                      setShowCertificatePreview(true);
                      return;
                    }
                    void Linking.openURL(certificateUrl);
                  }}
                >
                  <Text style={styles.certificateButtonText}>
                    {certificateIsImage ? "View Certificate" : "Open Certificate"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.aboutText}>No certifications uploaded yet.</Text>
            )}
          </InfoCard>
        </ScrollView>
      )}

      <Modal
        visible={showEditModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (saving) return;
          setShowEditModal(false);
          setGenderOpen(false);
          setCertificateFile(null);
          setCertificateLabel(inferCertificateLabel(profile?.certificate || localCertificate));
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 40 : 0}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Profile</Text>

            <View style={styles.modalAvatarWrap}>
              {imagePreview ? (
                <Image source={{ uri: imagePreview }} style={styles.modalAvatar} />
              ) : (
                <View style={styles.modalAvatarPlaceholder}>
                  <Ionicons name="camera-outline" size={28} color="#C2185B" />
                </View>
              )}
              <TouchableOpacity style={styles.uploadBtn} onPress={pickImage} disabled={saving}>
                <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                <Text style={styles.uploadBtnText}>Upload / Take photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.uploadBtn, saving && { opacity: 0.7 }]}
                onPress={pickCertificate}
                disabled={saving}
              >
                <Ionicons name="document-attach-outline" size={16} color="#fff" />
                <Text style={styles.uploadBtnText}>Upload Certifications (PDF/Image)</Text>
              </TouchableOpacity>
              <Text style={styles.certificateMetaText}>
                {certificateLabel || inferCertificateLabel(profile?.certificate || localCertificate) || "No certifications selected"}
              </Text>
              {certificateUrl ? (
                <View style={styles.editCertificateCard}>
                  {certificateIsImage && !certificatePreviewFailed ? (
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => setShowCertificatePreview(true)}
                    >
                      <Image
                        source={{ uri: certificatePreviewUrl }}
                        style={styles.editCertificatePreview}
                        onError={() => setCertificatePreviewFailed(true)}
                      />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.editCertificateFileBox}>
                      <Ionicons
                        name={certificateIsImage ? "image-outline" : "document-text-outline"}
                        size={22}
                        color="#C2185B"
                      />
                      <Text style={styles.editCertificateFileName}>
                        {inferCertificateLabel(certificateUrl) || "Certificate uploaded"}
                      </Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={styles.editCertificateButton}
                    onPress={() => {
                      if (certificateIsImage) {
                        setShowCertificatePreview(true);
                        return;
                      }
                      void Linking.openURL(certificateUrl);
                    }}
                  >
                    <Text style={styles.editCertificateButtonText}>
                      {certificateIsImage ? "View Uploaded Certificate" : "Open Uploaded Document"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
            <ScrollView
              style={{ maxHeight: rs(460) }}
              contentContainerStyle={{ paddingBottom: rs(12) }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              <Text style={styles.fieldLabel}>First Name</Text>
              <TextInput
                style={styles.modalInput}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Enter first name"
              />

              <Text style={styles.fieldLabel}>Last Name</Text>
              <TextInput
                style={styles.modalInput}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Enter last name"
              />

              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput
                style={styles.modalInput}
                value={phone}
                onChangeText={setPhone}
                placeholder="Enter phone"
                keyboardType="phone-pad"
              />

              <Text style={styles.fieldLabel}>Street Address</Text>
              <TextInput
                style={styles.modalInput}
                value={address}
                onChangeText={setAddress}
                placeholder="Enter street address"
              />
              <TouchableOpacity
                style={[styles.locateBtn, (saving || locating) && { opacity: 0.7 }]}
                onPress={useCurrentLocation}
                disabled={saving || locating}
                activeOpacity={0.85}
              >
                {locating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="locate-outline" size={16} color="#FFFFFF" />
                )}
                <Text style={styles.locateBtnText}>{locating ? "Locating..." : "Locate Me"}</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Country</Text>
              <TextInput
                style={styles.modalInput}
                value={country}
                onChangeText={setCountry}
                placeholder="Enter country"
              />

              <Text style={styles.fieldLabel}>City</Text>
              <TextInput
                style={styles.modalInput}
                value={city}
                onChangeText={setCity}
                placeholder="Enter city"
              />

              <Text style={styles.fieldLabel}>Date of Birth</Text>
              {Platform.OS === "web" ? (
                <input
                  type="date"
                  value={toDateInputValue(dob)}
                  onChange={(e) => setDob(e.target.value)}
                  style={{
                    borderWidth: 1,
                    borderColor: "#FF80AB50",
                    borderRadius: rs(10),
                    padding: rs(10),
                    color: "#880E4F",
                    outlineStyle: "none",
                    outlineWidth: 0,
                    outlineColor: "transparent",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                />
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.modalInput}
                    onPress={() => setShowDobPicker(true)}
                  >
                    <Text style={{ color: dob ? "#000" : "#888" }}>
                      {dob ? formatDateToMDY(dob) : "Select date of birth"}
                    </Text>
                  </TouchableOpacity>
                  {showDobPicker && (
                    <DateTimePicker
                      value={
                        parseDateInput(dob) || new Date()
                      }
                      mode="date"
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={(_e, selected) => {
                        setShowDobPicker(false);
                        if (selected) {
                          setDob(formatDateForStorage(selected));
                        }
                      }}
                      maximumDate={new Date()}
                    />
                  )}
                </>
              )}

              <Text style={styles.fieldLabel}>Gender</Text>
              <TouchableOpacity style={styles.modalInput} onPress={() => setGenderOpen((p) => !p)}>
                <Text style={{ color: gender ? "#000" : "#888" }}>
                  {gender || "Select gender"}
                </Text>
              </TouchableOpacity>
              {genderOpen && (
                <View style={styles.dropdown}>
                  {["Female", "Male", "Other"].map((g) => (
                    <TouchableOpacity
                      key={g}
                      style={styles.dropdownItem}
                      onPress={() => {
                        setGender(g);
                        setGenderOpen(false);
                      }}
                    >
                      <Text style={styles.dropdownItemText}>{g}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.fieldLabel}>Experience (years)</Text>
              <TextInput
                style={styles.modalInput}
                value={experience}
                onChangeText={setExperience}
                placeholder="Enter years of experience"
                keyboardType="numeric"
              />

              <Text style={styles.fieldLabel}>About me</Text>
              <TextInput
                style={[styles.modalInput, { height: rs(80) }]}
                value={about}
                onChangeText={setAbout}
                placeholder="Write about yourself"
                multiline
              />

            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setShowEditModal(false);
                  setGenderOpen(false);
                  setCertificateFile(null);
                  setCertificateLabel(inferCertificateLabel(profile?.certificate || localCertificate));
                }}
                disabled={saving}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.7 }]}
                onPress={saveProfile}
                disabled={saving}
              >
                <Text style={styles.saveBtnText}>{saving ? "Saving..." : "Save"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={showCertificatePreview}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCertificatePreview(false)}
      >
        <View style={styles.previewBackdrop}>
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Certificate Preview</Text>
            {certificateUrl ? (
              <Image
                source={{ uri: certificatePreviewUrl }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            ) : null}
            <View style={styles.previewActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowCertificatePreview(false)}
              >
                <Text style={styles.cancelText}>Close</Text>
              </TouchableOpacity>
              {certificateUrl ? (
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={() => void Linking.openURL(certificateUrl)}
                >
                  <Text style={styles.saveBtnText}>Open</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
      </LinearGradient>
    </SafeScreen>
  );
};

export default NannyProfileViewScreen;

const InfoCard = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <View style={styles.infoCard}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={{ marginTop: rs(10) }}>{children}</View>
  </View>
);

const InfoRow = ({ icon, label }: { icon: any; label: string }) => (
  <View style={styles.infoRow}>
    <Ionicons name={icon} size={16} color="#FF80AB" />
    <Text style={styles.infoText}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(12),
  },
  backBtn: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#FFE7F0",
    alignItems: "center",
    justifyContent: "center",
  },
  editBtn: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#FFE7F0",
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
  },
  container: {
    padding: rs(20),
    paddingBottom: rs(40),
  },
  profileCard: {
    backgroundColor: "#fff",
    borderRadius: rs(20),
    padding: rs(24),
    alignItems: "center",
    marginBottom: rs(20),
    elevation: 4,
  },
  avatarWrap: {
    width: rs(96),
    height: rs(96),
    borderRadius: rs(48),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: rs(14),
  },
  avatar: {
    width: rs(96),
    height: rs(96),
    borderRadius: rs(48),
  },
  name: {
    fontSize: rf(20),
    fontWeight: "700",
    color: "#880E4F",
    textAlign: "center",
  },
  subText: {
    marginTop: rs(4),
    fontSize: rf(13),
    color: "#AD1457",
    textAlign: "center",
  },
  infoCard: {
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
    marginBottom: rs(16),
    elevation: 2,
  },
  sectionTitle: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: rs(8),
  },
  infoText: {
    marginLeft: rs(10),
    fontSize: rf(13),
    color: "#6B4350",
    fontWeight: "500",
  },
  aboutText: {
    fontSize: rf(13),
    color: "#6B4350",
    lineHeight: rs(18),
  },
  certificateCard: {
    gap: rs(12),
  },
  certificatePreview: {
    width: "100%",
    height: rs(180),
    borderRadius: rs(12),
    backgroundColor: "#FFF5F9",
  },
  certificateFileBox: {
    minHeight: rs(96),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB40",
    backgroundColor: "#FFF7FA",
    alignItems: "center",
    justifyContent: "center",
    padding: rs(14),
    gap: rs(8),
  },
  certificateFileName: {
    color: "#880E4F",
    fontWeight: "600",
    textAlign: "center",
    fontSize: rf(12),
  },
  certificateButton: {
    alignSelf: "flex-start",
    backgroundColor: "#FF80AB",
    borderRadius: rs(10),
    paddingHorizontal: rs(14),
    paddingVertical: rs(10),
  },
  certificateButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(12),
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: rs(16),
  },
  modalCard: {
    width: "100%",
    maxWidth: rs(440),
    maxHeight: "88%",
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
  },
  modalTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(8),
  },
  modalAvatarWrap: {
    alignItems: "center",
    marginBottom: rs(12),
    gap: rs(10),
  },
  modalAvatar: {
    width: rs(96),
    height: rs(96),
    borderRadius: rs(48),
  },
  modalAvatarPlaceholder: {
    width: rs(96),
    height: rs(96),
    borderRadius: rs(48),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    fontSize: rf(12),
    color: "#AD1457",
    marginTop: rs(10),
    marginBottom: rs(4),
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#FF80AB50",
    borderRadius: rs(10),
    padding: rs(10),
  },
  locateBtn: {
    marginTop: rs(8),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
    backgroundColor: "#FF80AB",
    borderRadius: rs(10),
    paddingVertical: rs(10),
    paddingHorizontal: rs(12),
  },
  locateBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  dropdown: {
    borderWidth: 1,
    borderColor: "#FF80AB50",
    borderRadius: rs(10),
    marginTop: rs(6),
    overflow: "hidden",
  },
  dropdownItem: {
    paddingVertical: rs(10),
    paddingHorizontal: rs(12),
    backgroundColor: "#fff",
  },
  dropdownItemText: {
    color: "#880E4F",
    fontWeight: "600",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: rs(12),
    gap: rs(10),
  },
  cancelBtn: {
    paddingHorizontal: rs(14),
    paddingVertical: rs(10),
    borderRadius: rs(10),
    backgroundColor: "#F3F3F3",
  },
  cancelText: {
    color: "#555",
    fontWeight: "600",
  },
  saveBtn: {
    paddingHorizontal: rs(16),
    paddingVertical: rs(12),
    borderRadius: rs(10),
    backgroundColor: "#FF80AB",
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    backgroundColor: "#FF80AB",
    paddingHorizontal: rs(14),
    paddingVertical: rs(10),
    borderRadius: rs(12),
  },
  uploadBtnText: { color: "#fff", fontWeight: "700" },
  certificateMetaText: {
    color: "#6B4350",
    fontSize: rf(12),
    textAlign: "center",
  },
  editCertificateCard: {
    width: "100%",
    marginTop: rs(12),
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "#F8BBD0",
    backgroundColor: "#FFF7FA",
    padding: rs(12),
    gap: rs(10),
  },
  editCertificatePreview: {
    width: "100%",
    height: rs(160),
    borderRadius: rs(12),
    backgroundColor: "#FCE4EC",
  },
  editCertificateFileBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(10),
    backgroundColor: "#FFFFFF",
    borderRadius: rs(12),
    paddingHorizontal: rs(12),
    paddingVertical: rs(12),
  },
  editCertificateFileName: {
    flex: 1,
    fontSize: rf(12),
    color: "#4B5563",
  },
  editCertificateButton: {
    alignSelf: "flex-start",
    backgroundColor: "#C2185B",
    borderRadius: rs(10),
    paddingHorizontal: rs(12),
    paddingVertical: rs(10),
  },
  editCertificateButtonText: { color: "#fff", fontSize: rf(12), fontWeight: "700" },
  saveBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: rs(16),
  },
  previewCard: {
    width: "100%",
    maxWidth: rs(420),
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
    gap: rs(12),
  },
  previewTitle: {
    color: "#880E4F",
    fontSize: rf(16),
    fontWeight: "700",
  },
  previewImage: {
    width: "100%",
    height: rs(360),
    borderRadius: rs(12),
    backgroundColor: "#FFF5F9",
  },
  previewActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: rs(10),
  },
});
