import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  BASE_URL,
  sanitizeToken,
} from "../Api";
import SafeScreen from "../_utils/SafeScreen";
import { rf, rs } from "../utils/responsive";
import VerificationOneTimePayment from "../../lib/VerificationOneTimePayment";

// Conditionally import DateTimePicker only for native platforms
let DateTimePicker: any = null;
if (Platform.OS !== 'web') {
  DateTimePicker = require('@react-native-community/datetimepicker').default;
}

type Props = {
  navigation?: any;
  onBack?: () => void;
  onStart?: () => void;
  onNext?: () => void;
  onRejected?: () => void;
  onAddPaymentMethod?: () => void;
  onContactSupport?: () => void;
  onSkip?: () => void;
  onLogout?: () => void;
};

const NANNY_BACKGROUND_CHECK_FEE = 19.99;
const VERIFICATION_PAYMENT_DONE_KEY = "verification_payment_completed";
const STORAGE_KEYS = {
  userType: "user_type",
  token: "token",
  nannyId: "nanny_id",
  userId: "user_id",
  nannyName: "nanny_name",
  userName: "user_name",
  nannyEmail: "nanny_email",
  userEmail: "user_email",
} as const;

const normalizeIsoDate = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const y = parsed.getUTCFullYear();
  const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const d = String(parsed.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const VERIFICATION_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_REMOTE_API_BASE_URL = "https://api.syttr.zyronexlab.com/api/";

const normalizeApiBase = (value?: string | null) =>
  `${String(value || "").trim().replace(/\/+$/, "")}/`;

const buildApiCandidates = (path: string) => {
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const primary = normalizeApiBase(BASE_URL);
  const fallback = normalizeApiBase(DEFAULT_REMOTE_API_BASE_URL);
  return Array.from(
    new Set([
      `${primary}${cleanPath}`,
      ...(primary === fallback ? [] : [`${fallback}${cleanPath}`]),
    ])
  );
};

const fetchApiWithFallback = async (
  path: string,
  init?: RequestInit,
  timeoutMs = VERIFICATION_REQUEST_TIMEOUT_MS
) => {
  const urls = buildApiCandidates(path);
  let lastNetworkError: any = null;
  let firstTimeoutError: Error | null = null;

  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);
      const raw = await response.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      return { response, raw, data, url };
    } catch (error: any) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error(
          `Request timed out after ${Math.ceil(timeoutMs / 1000)}s for ${url}.`
        );
        if (!firstTimeoutError) firstTimeoutError = timeoutError;
        lastNetworkError = timeoutError;
        continue;
      }
      lastNetworkError = error;
    }
  }

  if (firstTimeoutError) {
    throw new Error(`${firstTimeoutError.message} Tried: ${urls.join(", ")}`);
  }
  if (lastNetworkError) {
    throw new Error(
      `Network request failed. Tried: ${urls.join(", ")}. Ensure the API is reachable and EXPO_PUBLIC_API_BASE_URL is correct, for example ${DEFAULT_REMOTE_API_BASE_URL}.`
    );
  }
  throw new Error("Network request failed");
};

const fetchWithTimeout = async (input: RequestInfo | URL, init?: RequestInit, timeoutMs = VERIFICATION_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const normalizeVerificationStatus = (status?: string | null) => {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "unknown";
  if (value.includes("pend")) return "app-pending";
  if (
    value.includes("clear") ||
    value.includes("complete") ||
    value.includes("approved") ||
    value.includes("verified")
  ) {
    return "completed";
  }
  if (value.includes("fail") || value.includes("reject") || value.includes("deny")) {
    return "failed";
  }
  return value;
};

const getStoredUserData = async () => {
  const entries = await AsyncStorage.multiGet([
    STORAGE_KEYS.userType,
    STORAGE_KEYS.token,
    STORAGE_KEYS.nannyId,
    STORAGE_KEYS.userId,
    STORAGE_KEYS.nannyName,
    STORAGE_KEYS.userName,
    STORAGE_KEYS.nannyEmail,
    STORAGE_KEYS.userEmail,
  ]);
  const map = Object.fromEntries(entries);
  const userType = String(map[STORAGE_KEYS.userType] || "client").toLowerCase();
  const isNanny = userType === "nanny" || userType === "syttr";
  const id = map[isNanny ? STORAGE_KEYS.nannyId : STORAGE_KEYS.userId] || "";
  const name = map[isNanny ? STORAGE_KEYS.nannyName : STORAGE_KEYS.userName] || "";
  const email = map[isNanny ? STORAGE_KEYS.nannyEmail : STORAGE_KEYS.userEmail] || "";
  const token = map[STORAGE_KEYS.token] || "";
  return { userType, isNanny, id, name, email, token };
};

export default function GetVerifiedScreen({
  navigation,
  onBack,
  onStart,
  onNext,
  onRejected,
  onAddPaymentMethod,
  onContactSupport,
  onLogout,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [quickappLink, setQuickappLink] = useState<string | null>(null);
  const [tazStatus, setTazStatus] = useState<string | null>(null);
  const [userType, setUserType] = useState<string>("");
  const [includeMvr, setIncludeMvr] = useState(false);
  const [driversLicenseNumber, setDriversLicenseNumber] = useState("");
  const [driversLicenseState, setDriversLicenseState] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [webDateInput, setWebDateInput] = useState("");
  const [paying, setPaying] = useState(false);
  const [hasExistingVerification, setHasExistingVerification] = useState(false);
  const [oneTimePaymentVisible, setOneTimePaymentVisible] = useState(false);
  const [hasSavedPaymentMethod, setHasSavedPaymentMethod] = useState(false);
  const [checkingSavedPaymentMethod, setCheckingSavedPaymentMethod] = useState(true);
  const [configuredVerificationFee, setConfiguredVerificationFee] = useState(NANNY_BACKGROUND_CHECK_FEE);
  const [pendingVerificationAction, setPendingVerificationAction] = useState<
    "start" | "resume" | null
  >(null);
  const advancedToReviewRef = useRef(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const type = ((await AsyncStorage.getItem("user_type")) || "client").toLowerCase();
        if (active) setUserType(type);
        const role = type === "nanny" || type === "syttr" ? "syttr" : "parent";
        const feeResponse = await fetch(`${BASE_URL}verification/config?role=${role}`);
        const feeJson = await feeResponse.json().catch(() => ({}));
        const fee = Number(feeJson?.data?.amount);
        if (active && feeResponse.ok && Number.isFinite(fee) && fee > 0) {
          setConfiguredVerificationFee(fee);
        }
        const dobKey = type === "nanny" ? "nanny_dob" : "user_dob";
        const storedDob = await AsyncStorage.getItem(dobKey);
        if (active && storedDob) {
          const normalized = normalizeIsoDate(storedDob);
          if (normalized) {
            // Convert ISO string to Date object
            const [year, month, day] = normalized.split('-').map(Number);
            const date = new Date(year, month - 1, day);
            setDateOfBirth(date);
            setWebDateInput(normalized);
          }
        }
      } catch {
        if (active) setUserType("client");
      } finally {
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const formatDobForApi = (date: Date | null) => {
    if (!date) return "";
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    
    return `${year}-${month}-${day}`;
  };

  const openQuickApp = async (link?: string | null) => {
    if (!link) return;
    router.push({ pathname: "/background-check" as any, params: { url: link } });
  };

  const fetchTazStatus = async () => {
    try {
      const { isNanny, id, token } = await getStoredUserData();
      if (!id) return null;
      const idKey = isNanny ? "nanny_id" : "user_id";
      const cleanToken = sanitizeToken(token || undefined);
      const { response: res, data } = await fetchApiWithFallback("taz/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
        },
        body: JSON.stringify({ [idKey]: String(id) }),
      });
      if (!res.ok || !data?.success) return null;
      const latestOrder = Array.isArray(data?.orders) && data.orders.length > 0 ? data.orders[0] : {};
      const orderStatus = String(
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
      const decisionIsRejected =
        decisionStatus.includes("reject") ||
        decisionStatus.includes("declin") ||
        decisionStatus.includes("blacklist") ||
        decisionStatus.includes("fail") ||
        decisionStatus.includes("deny");
      const decisionIsAccepted =
        decisionStatus.includes("accept") ||
        decisionStatus.includes("approved") ||
        decisionStatus.includes("verified") ||
        decisionStatus.includes("complete");
      const statusIsQuickappCompleted =
        orderStatus.includes("order.quickapp.completed") ||
        orderStatus.includes("quickapp.completed");
      const statusIsPending =
        orderStatus.includes("order.quickapp.created") ||
        orderStatus.includes("app-pending") ||
        orderStatus === "pending";
      const status = decisionIsRejected
        ? "failed"
        : decisionIsAccepted
        ? "completed"
        : statusIsQuickappCompleted
        ? "completed"
        : normalizeVerificationStatus(data.status);
      const statusIsCompleted = status === "completed" || orderStatus === "completed";
      const nextQuickappLink = String(data.quickapp_link || "").trim();
      const nextOrderGuid = String(
        data.taz_order_guid ||
          data.orders?.[0]?.order_guid ||
          data.orders?.[0]?.taz_order_guid ||
          ""
      ).trim();
      const backendOrderFound = Boolean(data.order_found);
      const paymentCompleted =
        typeof data?.payment_completed === "boolean" ? data.payment_completed : null;
      const verificationExists =
        backendOrderFound ||
        ["app-pending", "completed", "failed"].includes(status.toLowerCase()) ||
        !!nextQuickappLink ||
        !!nextOrderGuid ||
        (Array.isArray(data.orders) && data.orders.length > 0);
      setTazStatus(status && status !== "unknown" ? status : null);
      setHasExistingVerification(verificationExists);
      if (nextQuickappLink) {
        setQuickappLink(nextQuickappLink);
        await AsyncStorage.setItem("taz_quickapp_link", nextQuickappLink);
      } else {
        setQuickappLink(null);
        await AsyncStorage.removeItem("taz_quickapp_link");
      }
      if (isNanny && paymentCompleted === true) {
        await AsyncStorage.setItem(VERIFICATION_PAYMENT_DONE_KEY, "true");
      } else if (isNanny && paymentCompleted === false) {
        await AsyncStorage.removeItem(VERIFICATION_PAYMENT_DONE_KEY);
      }

      const shouldAdvanceToReview =
        statusIsCompleted || statusIsQuickappCompleted || decisionIsAccepted;

      if (decisionIsRejected) {
        advancedToReviewRef.current = false;
        onRejected?.();
      } else if (shouldAdvanceToReview) {
        if (!advancedToReviewRef.current) {
          advancedToReviewRef.current = true;
          onNext?.();
        }
      } else if (statusIsPending) {
        advancedToReviewRef.current = false;
      }

      return {
        status,
        quickappLink: nextQuickappLink,
        orderFound: verificationExists,
      };
    } catch {
      return null;
    }
  };

  const normalizedTazStatus = normalizeVerificationStatus(tazStatus);
  const isPending = normalizedTazStatus === "app-pending";
  const isCompleted = normalizedTazStatus === "completed";
  const isFailed = normalizedTazStatus === "failed";

  const goToContact = () => {
    if (onContactSupport) {
      onContactSupport();
      return;
    }
    Alert.alert("Contact support", "Please reach out to support for help.");
  };

  const handleLogout = async () => {
    try {
      if (onLogout) {
        await onLogout();
      }
    } finally {
      await AsyncStorage.clear();
      if (navigation?.reset) {
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
      }
    }
  };

  const handleRegenerate = async () => {
    if (submitting) return;
    try {
      setSubmitting(true);
      const { isNanny, id, token } = await getStoredUserData();
      if (!id) {
        Alert.alert("Missing info", "Missing: user_id");
        return;
      }

      const idKey = isNanny ? "nanny_id" : "user_id";
      const cleanToken = sanitizeToken(token || undefined);
      const { response: resp, raw, data } = await fetchApiWithFallback("taz/regenerate-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
        },
        body: JSON.stringify({ [idKey]: String(id) }),
      });

      if (!resp.ok || !data?.success) {
        const statusLabel = resp.ok ? "" : ` (${resp.status})`;
        Alert.alert("Verification", data?.message || raw || `Could not regenerate link${statusLabel}.`);
        return;
      }

      if (data?.taz_order_guid) {
        await AsyncStorage.setItem("taz_order_guid", String(data.taz_order_guid));
      }
      if (data?.quickapp_link) {
        await AsyncStorage.setItem("taz_quickapp_link", String(data.quickapp_link));
        setQuickappLink(String(data.quickapp_link));
      }
    } catch (e: any) {
      Alert.alert("Verification", e?.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (selectedDate) {
      validateAndSetDate(selectedDate);
    }

    if (Platform.OS !== "ios") {
      setShowDatePicker(false);
    }
  };

  const validateAndSetDate = (selectedDate: Date) => {
    // Age validation - must be at least 18
    const today = new Date();
    let age = today.getFullYear() - selectedDate.getFullYear();
    const m = today.getMonth() - selectedDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < selectedDate.getDate())) {
      age--;
    }

    if (age < 18) {
      Alert.alert("Age restriction", "You must be at least 18 years old to get verified.");
      return;
    }

    setDateOfBirth(selectedDate);
    setWebDateInput(formatDobForApi(selectedDate));
  };

  const handleWebDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dateStr = e.target.value;
    setWebDateInput(dateStr);
    
    if (dateStr) {
      const selectedDate = new Date(dateStr);
      if (!isNaN(selectedDate.getTime())) {
        validateAndSetDate(selectedDate);
      }
    }
    setShowDatePicker(false);
  };

  const handleStart = async (options?: { openQuickAppModal?: boolean }) => {
    const shouldOpenQuickAppModal = options?.openQuickAppModal ?? true;
    if (submitting) return;
    try {
      setSubmitting(true);
      const { isNanny, id, name, email, token } = await getStoredUserData();

      if (!id || !email) {
        const missing = [
          !id ? "user_id" : null,
          !email ? "email" : null,
          !name ? "name" : null,
        ].filter(Boolean);
        console.log("[GetVerified] Missing fields:", missing.join(", "));
        Alert.alert("Missing info", `Missing: ${missing.join(", ")}`);
        return { success: false, orderFound: false, quickappLink: "" };
      }
      const nameParts = (name || "").trim().split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || "User";
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Profile";

      const idKey = isNanny ? "nanny_id" : "user_id";
      const cleanToken = sanitizeToken(token || undefined);
      const verificationType = isNanny && includeMvr ? "mvr_employment" : "employment";
      const payload: Record<string, any> = {
        [idKey]: String(id),
        first_name: firstName,
        last_name: lastName,
        email: String(email).trim(),
        verification_type: verificationType,
      };
      if (isNanny) {
        payload.verification_fee = Number(verificationFee.toFixed(2));
      }
      
      if (isNanny && includeMvr) {
        const normalizedDob = formatDobForApi(dateOfBirth);
        const normalizedState = driversLicenseState.trim().toUpperCase();
        const normalizedLicense = driversLicenseNumber.trim();
        const missing = [
          !normalizedLicense ? "drivers_license_number" : null,
          !normalizedState ? "drivers_license_state" : null,
          !normalizedDob ? "Please select date of birth" : null,
        ].filter(Boolean);
        
        if (missing.length) {
          Alert.alert("Missing info", `Missing: ${missing.join(", ")}`);
          return { success: false, orderFound: false, quickappLink: "" };
        }
        if (normalizedState.length !== 2) {
          Alert.alert("Invalid state", "drivers_license_state must be a 2-letter state code.");
          return { success: false, orderFound: false, quickappLink: "" };
        }
        
        payload.mvr = true;
        payload.drivers_license_number = normalizedLicense;
        payload.drivers_license_state = normalizedState;
        payload.date_of_birth = normalizedDob;
      }

      console.log("[GetVerified] Payload", payload);

      const { response: resp, raw, data: initialData } = await fetchApiWithFallback(
        "taz/create-order",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
          },
          body: JSON.stringify(payload),
        }
      );
      let data: any = initialData;
      console.log("[GetVerified] Response", resp.status, raw);

      if (!resp.ok || !data?.success) {
        const statusLabel = resp.ok ? "" : ` (${resp.status})`;
        const backendCode = String(data?.code || "").trim().toLowerCase();
        const backendMessage = String(data?.message || raw || "").trim();
        const isProviderUnauthorized =
          backendCode === "taz_provider_unauthorized" ||
          backendMessage.toLowerCase().includes("credentials were rejected") ||
          backendMessage.toLowerCase() === "unauthorized";
        const isPermissiblePurposeRequired =
          backendCode === "taz_permissible_purpose_required" ||
          backendMessage.toLowerCase().includes("permissible purpose") ||
          backendMessage.toLowerCase().includes("quickapp order");

        if (isProviderUnauthorized) {
          Alert.alert(
            "Verification unavailable",
            backendMessage ||
              "TAZ provider returned an unauthorized response. Please ask support to check the live backend configuration."
          );
          return { success: false, orderFound: false, quickappLink: "" };
        }

        if (isPermissiblePurposeRequired) {
          Alert.alert(
            "Verification setup required",
            backendMessage ||
              "TAZ requires permissible purpose certification before this QuickApp order can be submitted."
          );
          return { success: false, orderFound: false, quickappLink: "" };
        }

        console.log("[GetVerified] create-order failed, trying regenerate-link");

        const {
          response: regenResp,
          raw: regenRaw,
          data: regenDataRaw,
        } = await fetchApiWithFallback("taz/regenerate-link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
          },
          body: JSON.stringify({ [idKey]: String(id) }),
        });
        let regenData: any = regenDataRaw;

        const regenCode = String(regenData?.code || "").trim().toLowerCase();
        const regenMessage = String(regenData?.message || regenRaw || "").trim();
        const regenUnauthorized =
          regenCode === "taz_provider_unauthorized" ||
          regenMessage.toLowerCase().includes("credentials were rejected") ||
          regenMessage.toLowerCase() === "unauthorized";
        const regenPermissiblePurposeRequired =
          regenCode === "taz_permissible_purpose_required" ||
          regenMessage.toLowerCase().includes("permissible purpose") ||
          regenMessage.toLowerCase().includes("quickapp order");

        console.log("[GetVerified] regenerate-link response", regenResp.status, regenRaw);

        if (!regenResp.ok || !regenData?.success) {
          if (regenUnauthorized) {
            Alert.alert(
              "Verification unavailable",
              regenMessage ||
                "TAZ provider returned an unauthorized response. Please ask support to check the live backend configuration."
            );
            return { success: false, orderFound: false, quickappLink: "" };
          }
          if (regenPermissiblePurposeRequired) {
            Alert.alert(
              "Verification setup required",
              regenMessage ||
                "TAZ requires permissible purpose certification before this QuickApp order can be submitted."
            );
            return { success: false, orderFound: false, quickappLink: "" };
          }
          Alert.alert(
            "Verification",
            regenData?.message || data?.message || raw || `Could not start verification${statusLabel}.`
          );
          return { success: false, orderFound: false, quickappLink: "" };
        }

        data = regenData;
      }

      if (data?.taz_order_guid) {
        await AsyncStorage.setItem("taz_order_guid", String(data.taz_order_guid));
      }
      if (data?.quickapp_link) {
        await AsyncStorage.setItem("taz_quickapp_link", String(data.quickapp_link));
      }

      const nextQuickappLink = String(data?.quickapp_link || "").trim();
      if (nextQuickappLink && shouldOpenQuickAppModal) {
        setQuickappLink(nextQuickappLink);
      }
      return {
        success: true,
        orderFound: true,
        quickappLink: nextQuickappLink,
      };
    } catch (e: any) {
      const message =
        e?.name === "AbortError"
          ? "Verification request timed out. Please try again."
          : e?.message || "Something went wrong.";
      Alert.alert("Verification", message);
      return { success: false, orderFound: false, quickappLink: "" };
    } finally {
      setSubmitting(false);
    }
  };

  const resumeExistingVerification = async () => {
    const latest = await fetchTazStatus();
    const latestStatus = normalizeVerificationStatus(latest?.status || tazStatus || "");
    const latestQuickappLink = String(
      latest ? latest.quickappLink || "" : quickappLink || ""
    ).trim();

    if (latestStatus === "completed") {
      onNext?.();
      return;
    }

    if (latestStatus === "failed") {
      onRejected?.();
      return;
    }

    if (latestQuickappLink) {
      setQuickappLink(latestQuickappLink);
      return;
    }

    await handleRegenerate();
  };

  const hasStoredPaymentMethod = async () => {
    try {
      const localPaymentDone = await AsyncStorage.getItem(VERIFICATION_PAYMENT_DONE_KEY);
      if (String(localPaymentDone || "").toLowerCase() === "true") {
        return true;
      }
      const rawToken = await AsyncStorage.getItem("token");
      const token = sanitizeToken(rawToken || undefined);
      const res = await fetch(`${BASE_URL}payment-method`, {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json().catch(() => ({}));
      const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      return res.ok && list.length > 0;
    } catch {
      return false;
    }
  };

  const refreshSavedPaymentMethod = async () => {
    try {
      setCheckingSavedPaymentMethod(true);
      const hasMethod = await hasStoredPaymentMethod();
      setHasSavedPaymentMethod(hasMethod);
      return hasMethod;
    } finally {
      setCheckingSavedPaymentMethod(false);
    }
  };

  const chargeVerification = async (options?: { stripePaymentMethodId?: string }) => {
    if (paying) return;

    try {
      setPaying(true);
      const { id } = await getStoredUserData();
      const rawToken = await AsyncStorage.getItem("token");
      const token = sanitizeToken(rawToken || undefined);
      const amount = Number(verificationFee.toFixed(2));
      const directStripePaymentMethodId = String(options?.stripePaymentMethodId || "").trim();
      let paymentMethodId = "";

      if (!directStripePaymentMethodId) {
        const methodsRes = await fetch(`${BASE_URL}payment-method`, {
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        const methodsJson = await methodsRes.json().catch(() => ({}));
        const methods = Array.isArray(methodsJson)
          ? methodsJson
          : Array.isArray(methodsJson?.data)
          ? methodsJson.data
          : [];
        const defaultMethod =
          methods.find((entry: any) => entry?.is_default) ||
          methods[0] ||
          null;
        paymentMethodId = defaultMethod?.id ? String(defaultMethod.id) : "";
        if (!paymentMethodId) {
          throw new Error("Please add a payment method first.");
        }
      }

      const paymentRes = await fetch(`${BASE_URL}stripe/verification/charge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          amount,
          currency: "usd",
          ...(directStripePaymentMethodId
            ? { stripe_payment_method_id: directStripePaymentMethodId }
            : { payment_method_id: paymentMethodId }),
          user_id: String(id || ""),
          verification_type: isNannyUser && includeMvr ? "mvr_employment" : "employment",
          description: `Syttr verification (${isNannyUser && includeMvr ? "employment + driving" : "employment"})`,
        }),
      });

      const paymentJson = await paymentRes.json().catch(() => ({}));
      if (paymentRes.status === 409) {
        const conflictMessage = String(paymentJson?.message || "").toLowerCase();
        if (conflictMessage.includes("already completed")) {
          await AsyncStorage.setItem(VERIFICATION_PAYMENT_DONE_KEY, "true");
          return true;
        }
      }
      if (!paymentRes.ok || !paymentJson?.success) {
        throw new Error(paymentJson?.message || "Payment failed.");
      }

      await AsyncStorage.setItem(VERIFICATION_PAYMENT_DONE_KEY, "true");
      await AsyncStorage.setItem("user_verification_status", "pending");
      return true;
    } catch (e: any) {
      Alert.alert("Payment failed", e?.message || "Unable to process payment.");
      return false;
    } finally {
      setPaying(false);
    }
  };

  const promptOneTimePayment = () => {
    setOneTimePaymentVisible(true);
  };

  const handleOneTimePaymentCancel = () => {
    setPendingVerificationAction(null);
    setOneTimePaymentVisible(false);
  };

  const handleOneTimePaymentConfirm = async (stripePaymentMethodId: string) => {
    const paid = await chargeVerification({ stripePaymentMethodId });
    if (!paid) {
      return false;
    }

    const nextAction = pendingVerificationAction;
    setPendingVerificationAction(null);
    setOneTimePaymentVisible(false);
    if (nextAction === "start") {
      const startResult = await handleStart({ openQuickAppModal: false });
      if (!startResult?.success) {
        return false;
      }
      if (startResult.quickappLink) {
        setQuickappLink(startResult.quickappLink);
      } else {
        await resumeExistingVerification();
      }
      return true;
    }

    await resumeExistingVerification();
    return true;
  };

  const ensureVerificationPayment = async (nextAction: "start" | "resume") => {
    const hasPaymentMethod = await hasStoredPaymentMethod();
    if (hasPaymentMethod) {
      return chargeVerification();
    }

    setPendingVerificationAction(nextAction);
    promptOneTimePayment();
    return false;
  };

  const handleStartPress = async () => {
    const latest = await fetchTazStatus();
    const latestStatus = normalizeVerificationStatus(latest?.status || tazStatus || "");
    const latestQuickappLink = String(
      latest ? latest.quickappLink || "" : quickappLink || ""
    ).trim();
    const latestOrderFound =
      latest && typeof latest?.orderFound === "boolean"
        ? latest.orderFound
        : hasExistingVerification;
    const paymentAlreadyDone =
      String((await AsyncStorage.getItem(VERIFICATION_PAYMENT_DONE_KEY)) || "").toLowerCase() ===
      "true";

    if (latestOrderFound || latestQuickappLink || ["app-pending", "completed", "failed"].includes(latestStatus)) {
      if (!paymentAlreadyDone && !["completed", "failed"].includes(latestStatus) && verificationFee > 0) {
        const paid = await ensureVerificationPayment("resume");
        if (!paid) {
          return;
        }
      }
      await resumeExistingVerification();
      return;
    }
    if (verificationFee > 0) {
      if (paymentAlreadyDone) {
        const startResult = await handleStart({ openQuickAppModal: false });
        if (!startResult?.success) {
          return;
        }
        if (startResult.quickappLink) {
          setQuickappLink(startResult.quickappLink);
        } else {
          await resumeExistingVerification();
        }
        return;
      }
      const paid = await ensureVerificationPayment("start");
      if (!paid) {
        return;
      }
      const startResult = await handleStart({ openQuickAppModal: false });
      if (!startResult?.success) {
        return;
      }
      if (startResult.quickappLink) {
        setQuickappLink(startResult.quickappLink);
      } else {
        await resumeExistingVerification();
      }
      return;
    }
    await handleStart();
  };

  const handleModalClose = async () => {
    setQuickappLink(null);
  };

  const handleModalOpen = async () => {
    await openQuickApp(quickappLink);
  };

  useEffect(() => {
    void fetchTazStatus();
    void refreshSavedPaymentMethod();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void fetchTazStatus();
    }, 5000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshSavedPaymentMethod();
      }
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  const isNannyUser = userType === "nanny" || userType === "syttr";
  const verificationFee = configuredVerificationFee;

  useEffect(() => {
    if (!isNannyUser && includeMvr) {
      setIncludeMvr(false);
    }
  }, [includeMvr, isNannyUser]);

  return (
    <SafeScreen edges={["top", "left", "right", "bottom"]}>
      <LinearGradient colors={["#ffffff", "#ffffff"]} style={styles.container}>
      <View style={styles.header}>
        {isNannyUser ? (
          <View style={styles.backBtnSpacer} />
        ) : (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              if (onBack) onBack();
              else navigation?.goBack?.();
            }}
          >
            <Ionicons name="chevron-back" size={18} color="#C2185B" />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Get Verified</Text>
        <View style={{ width: rs(32) }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => void handleLogout()}
          activeOpacity={0.85}
        >
          <Ionicons name="log-out-outline" size={16} color="#C2185B" />
          <Text style={styles.logoutBtnText}>Log out</Text>
        </TouchableOpacity>

        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons name="shield-checkmark" size={24} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>
            {isNannyUser ? "Build trust with families" : "Become a verified parent"}
          </Text>
          <Text style={styles.heroSub}>
            {isNannyUser
              ? "We run a background check to help families feel safe. This improves your profile visibility and helps you stand out."
              : "We run a background check to help Syttrs feel safe. Verified parents can book with more confidence."}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What we check</Text>
          <InfoRow
            icon="person-circle-outline"
            title="Identity verification"
            text="Confirm your name and date of birth."
          />
          <InfoRow
            icon="document-text-outline"
            title="Background screening"
            text="Criminal history and watchlist checks."
          />
          <InfoRow
            icon="home-outline"
            title="Address history"
            text="Recent address confirmation."
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>How it works</Text>
          <StepRow
            step="1"
            title="Submit your details"
            text="Provide legal name and email. Add license details only if MVR driving verification is needed."
          />
          <StepRow
            step="2"
            title="Background check"
            text="We verify your information securely."
          />
          <StepRow
            step="3"
            title="Get your status"
            text="We will email you once the check is complete."
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Verification type</Text>
          <Text style={styles.cardText}>
            {isNannyUser
              ? `One-time payment: background check $${configuredVerificationFee.toFixed(
                  2
                )}.`
              : `One-time parent verification: $${verificationFee.toFixed(2)}.`}
          </Text>
          {verificationFee > 0 ? (
            <View style={styles.feeBox}>
              <Text style={styles.feeTitle}>Verification Fee</Text>
              <Text style={styles.feeValue}>${verificationFee.toFixed(2)}</Text>
            </View>
          ) : null}
          {isNannyUser ? (
            <View style={styles.verificationTypeRow}>
            <TouchableOpacity
              style={[
                styles.verificationTypeButton,
                !includeMvr && styles.verificationTypeButtonActive,
              ]}
              onPress={() => setIncludeMvr(false)}
              activeOpacity={0.9}
            >
              <Ionicons
                name="briefcase-outline"
                size={14}
                color={!includeMvr ? "#fff" : "#C2185B"}
              />
              <Text
                style={[
                  styles.verificationTypeText,
                  !includeMvr && styles.verificationTypeTextActive,
                ]}
              >
                Employment only
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.verificationTypeButton,
                includeMvr && styles.verificationTypeButtonActive,
              ]}
              onPress={() => setIncludeMvr(true)}
              activeOpacity={0.9}
            >
              <Ionicons
                name="car-outline"
                size={14}
                color={includeMvr ? "#fff" : "#C2185B"}
              />
              <Text
                style={[
                  styles.verificationTypeText,
                  includeMvr && styles.verificationTypeTextActive,
                ]}
              >
                Employment + Driving
              </Text>
            </TouchableOpacity>
          </View>
          ) : null}

          {isNannyUser && includeMvr ? (
            <View style={styles.mvrForm}>
              <Text style={styles.inputLabel}>{"Driver's license number"}</Text>
              <TextInput
                value={driversLicenseNumber}
                onChangeText={setDriversLicenseNumber}
                placeholder="D1234567"
                autoCapitalize="characters"
                placeholderTextColor="#C2185B99"
                style={styles.input}
              />

              <Text style={styles.inputLabel}>{"Driver's license state"}</Text>
              <TextInput
                value={driversLicenseState}
                onChangeText={(t) =>
                  setDriversLicenseState(t.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))
                }
                placeholder="CA"
                autoCapitalize="characters"
                placeholderTextColor="#C2185B99"
                style={styles.input}
                maxLength={2}
              />

              <Text style={styles.inputLabel}>Date of birth</Text>
              
              {/* Web-specific date input */}
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={webDateInput}
                  onChange={handleWebDateChange}
                  max={formatDobForApi(new Date())}
                  style={{
                    width: '100%',
                    height: rs(44),
                    borderWidth: 1,
                    borderColor: 'rgba(255,128,171,0.45)',
                    backgroundColor: '#ffffff',
                    borderRadius: rs(10),
                    paddingHorizontal: rs(12),
                    color: '#6B4350',
                    marginBottom: rs(10),
                    fontSize: rf(13),
                    fontFamily: 'inherit',
                  } as any}
                />
              ) : (
                /* Native touchable for iOS/Android */
              <TouchableOpacity
                style={styles.input}
                onPress={() => setShowDatePicker((prev) => !prev)}
                activeOpacity={0.8}
              >
                  <Text style={{ color: dateOfBirth ? "#6B4350" : "#C2185B99" }}>
                    {dateOfBirth
                      ? formatDobForApi(dateOfBirth)
                      : "Tap to select date"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Privacy note</Text>
          <Text style={styles.cardText}>
            {isNannyUser
              ? "Your information is only used for verification and is not shared with families."
              : "Your information is only used for verification and is not shared with Syttrs."}
          </Text>
        </View>

        {isPending ? (
          <View style={styles.pendingCard}>
            <Text style={styles.pendingTitle}>Verification pending</Text>
            <Text style={styles.pendingText}>
              Your verification is already in progress. Use the button below to continue with the same verification.
            </Text>
            <TouchableOpacity style={styles.pendingBtn} onPress={goToContact}>
              <Ionicons name="mail-outline" size={16} color="#C2185B" />
              <Text style={styles.pendingBtnText}>Contact Support</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <TouchableOpacity
          style={[styles.ctaButton, isCompleted && styles.ctaButtonDisabled]}
          activeOpacity={0.85}
          onPress={handleStartPress}
          disabled={submitting || isCompleted}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="sparkles" size={16} color="#fff" />
              <Text style={styles.ctaText}>
                {isCompleted
                  ? "Verification Completed"
                  : isPending
                  ? "Continue Verification"
                  : isFailed
                  ? "Contact Support"
                  : `Start Verification - $${verificationFee.toFixed(2)}`}
              </Text>
            </>
          )}
        </TouchableOpacity>
        {verificationFee > 0 && !hasSavedPaymentMethod ? (
          <TouchableOpacity
            style={styles.paymentMethodButton}
            activeOpacity={0.85}
            onPress={onAddPaymentMethod}
            disabled={checkingSavedPaymentMethod}
          >
            <Ionicons name="card-outline" size={16} color="#C2185B" />
            <Text style={styles.paymentMethodButtonText}>
              {checkingSavedPaymentMethod ? "Checking payment..." : "Add payment method"}
            </Text>
          </TouchableOpacity>
        ) : null}
        {isPending ? (
          <TouchableOpacity
            style={styles.secondaryButton}
            activeOpacity={0.85}
            onPress={() => {
              if (onNext) onNext();
            }}
          >
            <Text style={styles.secondaryText}>Next</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {/* Native DateTimePicker for iOS/Android only */}
      {Platform.OS !== 'web' && showDatePicker && DateTimePicker && (
        <DateTimePicker
          value={dateOfBirth || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleDateChange}
          maximumDate={new Date()}
          accentColor="#FF80AB"
          textColor="#C2185B"
          themeVariant="light"
        />
      )}
      <Modal transparent visible={!!quickappLink} animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Complete your verification</Text>
            <Text style={styles.modalText}>
              Tap the link below to open the background check form in your browser.
            </Text>
            <TouchableOpacity onPress={() => openQuickApp(quickappLink)}>
              <Text style={styles.modalLink}>{quickappLink}</Text>
            </TouchableOpacity>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalButtonSecondary}
                onPress={handleModalClose}
              >
                <Text style={styles.modalButtonSecondaryText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonSecondary}
                onPress={handleRegenerate}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#C2185B" />
                ) : (
                  <Text style={styles.modalButtonSecondaryText}>Regenerate Link</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonPrimary}
                onPress={handleModalOpen}
              >
                <Text style={styles.modalButtonPrimaryText}>Open</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <VerificationOneTimePayment
        visible={oneTimePaymentVisible}
        amount={verificationFee}
        onCancel={handleOneTimePaymentCancel}
        onConfirm={handleOneTimePaymentConfirm}
      />
      </LinearGradient>
    </SafeScreen>
  );
}

function InfoRow({
  icon,
  title,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={16} color="#C2185B" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={styles.infoText}>{text}</Text>
      </View>
    </View>
  );
}

function StepRow({
  step,
  title,
  text,
}: {
  step: string;
  title: string;
  text: string;
}) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepCircle}>
        <Text style={styles.stepText}>{step}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepSub}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingTop: rs(18),
    paddingBottom: rs(14),
    backgroundColor: "rgba(255,255,255,0.9)",
    borderBottomLeftRadius: rs(18),
    borderBottomRightRadius: rs(18),
    elevation: 2,
  },
  backBtn: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    backgroundColor: "#FFF1F6",
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnSpacer: {
    width: rs(32),
    height: rs(32),
  },
  headerTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#C2185B",
    fontFamily: "PlayfairDisplay",
  },
  skipBtn: {
    paddingHorizontal: rs(10),
    paddingVertical: rs(6),
    borderRadius: rs(8),
    backgroundColor: "rgba(255,128,171,0.15)",
  },
  skipBtnText: {
    color: "#C2185B",
    fontSize: rf(13),
    fontWeight: "700",
    fontFamily: "PlayfairDisplay",
  },
  logoutBtn: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
    paddingHorizontal: rs(12),
    paddingVertical: rs(8),
    borderRadius: rs(999),
    borderWidth: 1,
    borderColor: "rgba(194,24,91,0.18)",
    backgroundColor: "#FFF5F8",
    marginBottom: rs(12),
  },
  logoutBtnText: {
    color: "#C2185B",
    fontSize: rf(12),
    fontWeight: "700",
    fontFamily: "PlayfairDisplay",
  },
  content: {
    padding: rs(16),
    paddingBottom: rs(32),
  },
  heroCard: {
    backgroundColor: "#FFFDF7",
    borderRadius: rs(18),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.25)",
    marginBottom: rs(14),
  },
  heroIcon: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(21),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: rs(12),
  },
  heroTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#C2185B",
    marginBottom: rs(6),
    fontFamily: "PlayfairDisplay",
  },
  heroSub: {
    fontSize: rf(13),
    color: "#6B4350",
    lineHeight: rs(18),
  },
  card: {
    backgroundColor: "#FFF5F9",
    borderRadius: rs(16),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    marginBottom: rs(12),
  },
  cardTitle: {
    fontSize: rf(15),
    fontWeight: "700",
    color: "#C2185B",
    marginBottom: rs(10),
    fontFamily: "PlayfairDisplay",
  },
  cardText: {
    fontSize: rf(13),
    color: "#6B4350",
    lineHeight: rs(18),
  },
  feeBox: {
    marginTop: rs(10),
    marginBottom: rs(2),
    padding: rs(10),
    borderRadius: rs(10),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    backgroundColor: "#FFF1F6",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  feeTitle: {
    fontSize: rf(12),
    color: "#A0124A",
    fontWeight: "700",
  },
  feeValue: {
    fontSize: rf(15),
    color: "#C2185B",
    fontWeight: "800",
  },
  verificationTypeRow: {
    marginTop: rs(12),
    gap: rs(8),
  },
  verificationTypeButton: {
    borderWidth: 1,
    borderColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: rs(10),
    paddingHorizontal: rs(12),
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    backgroundColor: "#FFF1F6",
  },
  verificationTypeButtonActive: {
    backgroundColor: "#FF80AB",
    borderColor: "#FF80AB",
  },
  verificationTypeText: {
    color: "#C2185B",
    fontSize: rf(13),
    fontWeight: "700",
  },
  verificationTypeTextActive: {
    color: "#fff",
  },
  mvrForm: {
    marginTop: rs(12),
  },
  inputLabel: {
    color: "#A0124A",
    fontSize: rf(12),
    fontWeight: "700",
    marginBottom: rs(6),
  },
  input: {
    height: rs(44),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.45)",
    backgroundColor: "#fff",
    borderRadius: rs(10),
    paddingHorizontal: rs(12),
    color: "#6B4350",
    marginBottom: rs(10),
    fontSize: rf(13),
    justifyContent: "center",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: rs(10),
    marginBottom: rs(12),
  },
  infoIcon: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  infoTitle: {
    fontSize: rf(13),
    fontWeight: "700",
    color: "#C2185B",
  },
  infoText: {
    fontSize: rf(12),
    color: "#6B4350",
    marginTop: rs(2),
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: rs(12),
    marginBottom: rs(12),
  },
  stepCircle: {
    width: rs(28),
    height: rs(28),
    borderRadius: rs(14),
    backgroundColor: "#FFE4A7",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: {
    fontWeight: "700",
    color: "#C77700",
    fontSize: rf(12),
  },
  stepTitle: {
    fontSize: rf(13),
    fontWeight: "700",
    color: "#C2185B",
  },
  stepSub: {
    fontSize: rf(12),
    color: "#6B4350",
    marginTop: rs(2),
  },
  ctaButton: {
    marginTop: rs(8),
    backgroundColor: "#FF80AB",
    borderRadius: rs(14),
    paddingVertical: rs(14),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
  },
  ctaButtonDisabled: {
    opacity: 0.7,
  },
  ctaText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(14),
  },
  paymentMethodButton: {
    marginTop: rs(10),
    borderRadius: rs(14),
    paddingVertical: rs(12),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
    borderWidth: 1,
    borderColor: "#FF80AB",
    backgroundColor: "#FFF1F6",
  },
  paymentMethodButtonText: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(13),
  },
  pendingCard: {
    marginTop: rs(8),
    backgroundColor: "#FFF3F8",
    borderRadius: rs(14),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.3)",
  },
  pendingTitle: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(14),
  },
  pendingText: {
    marginTop: rs(6),
    color: "#6B4350",
    fontSize: rf(12),
  },
  pendingBtn: {
    marginTop: rs(10),
    borderRadius: rs(12),
    paddingVertical: rs(10),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
    borderWidth: 1,
    borderColor: "#FF80AB",
    backgroundColor: "#FFF1F6",
  },
  pendingBtnText: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(13),
  },
  secondaryButton: {
    marginTop: rs(10),
    borderRadius: rs(14),
    paddingVertical: rs(12),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
    borderWidth: 1,
    borderColor: "#FF80AB",
    backgroundColor: "#FFF1F6",
  },
  secondaryText: {
    color: "#C2185B",
    fontWeight: "700",
    fontSize: rf(13),
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: rs(20),
  },
  modalCard: {
    width: "100%",
    maxWidth: rs(420),
    backgroundColor: "#FFF",
    borderRadius: rs(18),
    padding: rs(18),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.3)",
  },
  modalTitle: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#C2185B",
    marginBottom: rs(6),
  },
  modalText: {
    fontSize: rf(13),
    color: "#6B4350",
    marginBottom: rs(10),
  },
  modalLink: {
    color: "#C2185B",
    textDecorationLine: "underline",
    fontSize: rf(12),
    marginBottom: rs(12),
  },
  modalActions: {
    flexDirection: "row",
    gap: rs(10),
    justifyContent: "flex-end",
  },
  modalButtonSecondary: {
    paddingVertical: rs(10),
    paddingHorizontal: rs(16),
    borderRadius: rs(10),
    borderWidth: 1,
    borderColor: "#FF80AB",
  },
  modalButtonSecondaryText: {
    color: "#C2185B",
    fontWeight: "700",
  },
  modalButtonPrimary: {
    paddingVertical: rs(10),
    paddingHorizontal: rs(16),
    borderRadius: rs(10),
    backgroundColor: "#FF80AB",
  },
  modalButtonPrimaryText: {
    color: "#fff",
    fontWeight: "700",
  },
});
