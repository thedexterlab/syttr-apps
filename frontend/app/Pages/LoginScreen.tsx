import AppLogo from "../_utils/AppLogo";
import { Fonts } from "@/constants/theme";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BASE_URL, loginNanny, login as loginRequest } from "../_Api";
import { rebindPushRegistrationForCurrentSession } from "../../lib/pushNotifications";
import { Location } from "../_utils/safeLocation";
import { rf, rs, wp } from "../_utils/responsive";
import SafeScreen from "../_utils/SafeScreen";
import { isGoogleAuthAvailable, useGoogleAuthRequest } from "../_utils/safeAuthSessionGoogle";
import { WebBrowser } from "../_utils/safeWebBrowser";
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const palette = {
  primary: "#F27C9C", // warm logo pink
  accent: "#F6BC63", // honey gold
  accentDeep: "#E38C42",
  textPrimary: "#4F2A32",
  textSecondary: "#7C4A55",
  placeholder: "#D5A8B5",
  surface: "#FFF7F0",
  surfaceAlt: "#FFEBDD",
  outline: "rgba(242, 124, 156, 0.32)",
  shadow: "rgba(242, 124, 156, 0.22)",
  glow: "rgba(242, 124, 156, 0.2)",
};
const CLIENT_STORAGE_KEYS = [
  "user_id",
  "user_name",
  "user_email",
  "user_city",
  "user_country",
  "user_gender",
  "user_about",
  "user_phone",
  "user_address",
  "user_image",
  "user_experience",
  "user_dob",
];
const NANNY_STORAGE_KEYS = [
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
];

type Props = {
  navigation?: any;
  onBack?: () => void;
  onForgotPassword?: () => void;
  onSignupClient?: () => void;
  onSignupNanny?: () => void;
  onTermsPress?: () => void;
  onPrivacyPress?: () => void;
  onClientSuccess?: () => void;
  onClientBlacklisted?: () => void;
  onNannySuccess?: () => void;
  onNannyPending?: () => void;
  onNannyRejected?: () => void;
};

type GoogleAuthButtonProps = {
  autoPrompt?: boolean;
  disabled?: boolean;
  onAccessToken: (token: string) => void;
  onError: (message: string) => void;
  onPromptStateChange?: (loading: boolean) => void;
  onAutoPromptConsumed?: () => void;
};

const GoogleAuthButton: React.FC<GoogleAuthButtonProps> = ({
  autoPrompt,
  disabled,
  onAccessToken,
  onError,
  onPromptStateChange,
  onAutoPromptConsumed,
}) => {
  useEffect(() => {
    try {
      WebBrowser.maybeCompleteAuthSession();
    } catch {
      // ignore if the module isn't available
    }
  }, []);

  const [request, response, promptAsync] = useGoogleAuthRequest({
    androidClientId:
      "409629659232-qk7mrp6vldfg5u1mhih2ipmeq1coe50u.apps.googleusercontent.com",
    expoClientId:
      "409629659232-qk7mrp6vldfg5u1mhih2ipmeq1coe50u.apps.googleusercontent.com",
  });

  const handlePrompt = useCallback(async () => {
    if (!request || disabled) return;
    onPromptStateChange?.(true);
    try {
      const result = await promptAsync();
      if (result?.type !== "success") {
        if (result?.type === "error") {
          onError(result?.error?.message || "Google sign-in failed");
        }
        onPromptStateChange?.(false);
      }
    } catch (err: any) {
      onPromptStateChange?.(false);
      onError(err?.message || "Google sign-in failed");
    }
  }, [disabled, onError, onPromptStateChange, promptAsync, request]);

  useEffect(() => {
    if (autoPrompt && request) {
      onAutoPromptConsumed?.();
      handlePrompt();
    }
  }, [autoPrompt, handlePrompt, onAutoPromptConsumed, request]);

  useEffect(() => {
    if (!response) return;
    if (response.type === "success" && response.authentication?.accessToken) {
      onAccessToken(response.authentication.accessToken);
      return;
    }
    if (response.type === "error") {
      onPromptStateChange?.(false);
      onError(response.error?.message || "Google sign-in failed");
      return;
    }
    if (response.type === "dismiss" || response.type === "cancel") {
      onPromptStateChange?.(false);
    }
  }, [onAccessToken, onError, onPromptStateChange, response]);

  return (
    <TouchableOpacity
      style={[styles.googleButton, (disabled || !request) && { opacity: 0.7 }]}
      onPress={handlePrompt}
      disabled={disabled || !request}
      activeOpacity={0.85}
    >
      <Image
        source={{ uri: "https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" }}
        style={styles.googleIcon}
      />
      <Text style={styles.googleText}>Sign in with Google</Text>
    </TouchableOpacity>
  );
};

const LoginScreen: React.FC<Props> = ({
  navigation,
  onBack,
  onForgotPassword = () => {},
  onSignupClient = () => {},
  onSignupNanny = () => {},
  onTermsPress = () => {},
  onPrivacyPress = () => {},
  onClientSuccess = () => {},
  onClientBlacklisted = () => {},
  onNannySuccess = () => {},
  onNannyPending = () => {},
  onNannyRejected = () => {},
}) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isCompact = height < 760 || width < 375;
  const contentMaxWidth = Math.min(520, width - 20);


  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [hidePassword, setHidePassword] = useState(true);
  const [remember, setRemember] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [autoPromptGoogle, setAutoPromptGoogle] = useState(false);

  const showError = (msg: string) => Alert.alert("Error", msg);
  const toStorageImageUrl = (path?: string) => {
    const raw = String(path || "").trim();
    if (!raw) return "";
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    const base = BASE_URL.replace("/api/", "/");
    const clean = raw.replace(/^\/+/, "");
    if (clean.startsWith("storage/")) {
      return `${base}${clean}`;
    }
    if (clean.startsWith("public/")) {
      return `${base}storage/${clean.slice("public/".length).replace(/^\/+/, "")}`;
    }
    return `${base}storage/${clean}`;
  };

  type AuthResponse = {
    token?: string;
    user_type?: string;
    user?: { user_type?: string };
  };

  const canUseNativeGoogleAuth =
    Platform.OS !== "web" && isGoogleAuthAvailable();

  const isBusy = loading || googleLoading;

  const requestPostLoginPermissions = useCallback(
    async (options?: { requestLocation?: boolean }) => {
      try {
        const current = await Notifications.getPermissionsAsync();
        const grantedAlready =
          current.granted ||
          current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
        const result = grantedAlready
          ? current
          : await Notifications.requestPermissionsAsync({
              ios: {
                allowAlert: true,
                allowBadge: true,
                allowSound: true,
                allowAnnouncements: true,
              },
            });
        const notificationGranted =
          result.granted ||
          result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
        if (!notificationGranted && result.canAskAgain === false) {
          Alert.alert(
            "Enable Notifications",
            "Notifications are turned off for Syttr. Please enable them in iPhone Settings so you receive parent and nanny alerts.",
            [
              { text: "Not now", style: "cancel" },
              { text: "Open Settings", onPress: () => void Linking.openSettings() },
            ]
          );
        }
      } catch {
        // ignore permission prompt failures
      }

      if (!options?.requestLocation) {
        return;
      }

      try {
        await Location.requestForegroundPermissionsAsync();
      } catch {
        // ignore location prompt failures
      }
    },
    []
  );

  const handleGoogleAccessToken = useCallback(
    async (accessToken: string) => {
      try {
        setGoogleLoading(true);
        const userInfoResp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const profile = await userInfoResp.json();

        const displayName = profile?.name || profile?.given_name || "Google User";
        const displayEmail = profile?.email || "";
        const userId = profile?.sub || "";

        await AsyncStorage.multiSet([
          ["token", accessToken],
          ["user_type", "client"],
          ["user_name", displayName],
          ["user_email", displayEmail],
          ["user_id", String(userId)],
        ]);
        await AsyncStorage.multiRemove([
          ...NANNY_STORAGE_KEYS,
        ]);
        await requestPostLoginPermissions({ requestLocation: true });
        await rebindPushRegistrationForCurrentSession().catch(() => {});

        if (navigation?.replace) {
          navigation.replace("ParentsHomeTabs");
        } else {
          onClientSuccess();
        }
      } catch (err: any) {
        showError(err?.message || "Google sign-in failed");
      } finally {
        setGoogleLoading(false);
      }
    },
    [navigation, onClientSuccess, requestPostLoginPermissions]
  );

  const handleLogin = async () => {
    if (!email || !password)
      return showError("Please enter email and password");
    if (!emailRegex.test(email))
      return showError("Invalid email address");

    setLoading(true);
    setLoginError("");
    let lastError = "Incorrect email or password";

    // ---- Client/Parent login ----
    try {
      const clientResp: AuthResponse = await loginRequest({
        email: email.trim(),
        password,
      });

      const rawType = clientResp.user_type || clientResp?.user?.user_type;
      const userType = typeof rawType === "string" ? rawType.toLowerCase() : undefined;
      const displayName =
        (clientResp as any)?.user?.name ||
        (clientResp as any)?.name ||
        email.trim();
      const displayEmail =
        (clientResp as any)?.user?.email ||
        (clientResp as any)?.email ||
        email.trim();
      const userId =
        (clientResp as any)?.user_id ||
        (clientResp as any)?.user?.user_id ||
        (clientResp as any)?.user?.id ||
        (clientResp as any)?.id ||
        "";

      if (clientResp?.token && (!userType || userType === "client" || userType === "parent")) {
        const profile = (clientResp as any)?.profile || (clientResp as any)?.data?.profile || {};
        const imagePath =
          profile?.user_image_url ||
          profile?.profile_image_url ||
          profile?.profile_image ||
          profile?.user_image ||
          profile?.avatar ||
          profile?.image_url ||
          profile?.image;
        const imageUrl = toStorageImageUrl(imagePath);
        const statusRaw =
          (clientResp as any)?.status ||
          (clientResp as any)?.approval_status ||
          ((clientResp as any)?.is_blacklisted ? "blacklisted" : "active");
        const normalizedClientStatus = String(statusRaw || "active").toLowerCase();

        const clientName =
          displayName ||
          [profile?.firstname || profile?.first_name, profile?.lastname || profile?.last_name]
            .filter(Boolean)
            .join(" ") ||
          "Unknown";

        const sets: [string, string][] = [
          ["token", clientResp.token || ""],
          ["user_type", userType || "client"],
          ["user_name", clientName || "Unknown"],
          ["user_email", displayEmail || ""],
          ["user_id", String(userId || "")],
        ];
        if (profile?.city || profile?.city_area) sets.push(["user_city", profile.city || profile.city_area]);
        if (profile?.address || profile?.location) sets.push(["user_address", profile.address || profile.location]);
        if (profile?.country) sets.push(["user_country", profile.country]);
        if (profile?.gender) sets.push(["user_gender", profile.gender]);
        if (profile?.about_me) sets.push(["user_about", profile.about_me]);
        if (profile?.number) sets.push(["user_phone", profile.number]);
        if (imageUrl) sets.push(["user_image", imageUrl]);
        sets.push(["user_verification_status", normalizedClientStatus]);
        await AsyncStorage.multiRemove([
          ...NANNY_STORAGE_KEYS,
        ]);
        await AsyncStorage.multiSet(sets);
        await requestPostLoginPermissions({ requestLocation: true });
        await rebindPushRegistrationForCurrentSession().catch(() => {});
        if (navigation?.replace) {
          navigation.replace("ParentsHomeTabs");
        } else {
          if (normalizedClientStatus.includes("blacklist")) {
            onClientBlacklisted();
          } else {
            onClientSuccess();
          }
        }
        setLoading(false);
        return;
      }
    } catch (err: any) {
      lastError =
        err?.response?.data?.message ||
        err?.message ||
        lastError;
    }

    // ---- Nanny login fallback ----
    try {
      const nannyResp: AuthResponse = await loginNanny({
        email: email.trim(),
        password,
      });

      const nannyToken = nannyResp?.token;
      const nannyType = nannyResp?.user_type || nannyResp?.user?.user_type;

      const payload = (nannyResp as any) || {};
      const profile = (payload as any)?.data?.profile || (payload as any)?.profile || {};
      const imagePath = profile?.user_image || profile?.profile_image;
      const imageUrl =
        profile?.user_image_url ||
        profile?.profile_image_url ||
        toStorageImageUrl(imagePath) ||
        profile?.avatar;

      const nannyName =
        payload?.user?.name ||
        payload?.user?.fullname ||
        [payload?.user?.first_name, payload?.user?.last_name].filter(Boolean).join(" ") ||
        payload?.fullname ||
        profile?.fullname ||
        profile?.name ||
        [profile?.firstname || profile?.first_name, profile?.lastname || profile?.last_name]
          .filter(Boolean)
          .join(" ") ||
        email.trim();
      const nannyEmail =
        payload?.user?.email ||
        payload?.email ||
        profile?.email ||
        email.trim();
      const nannyAbout = profile?.about_me || profile?.bio || profile?.about;
      const nannyExperience =
        profile?.experience ??
        profile?.years_of_experience ??
        profile?.experience_years ??
        profile?.age;
      const nannyId =
        payload?.user_id ||
        payload?.user?.user_id ||
        profile?.user_id ||
        payload?.user?.id ||
        payload?.id ||
        profile?.id ||
        "";
      const nannyDob =
        profile?.date_of_birth ||
        profile?.dob ||
        profile?.birthdate ||
        profile?.birth_date ||
        profile?.dateOfBirth;
      const rateCards =
        payload?.data?.rate_cards ??
        profile?.rate_cards ??
        payload?.rate_cards ??
        [];
      const availability =
        payload?.data?.availability ??
        profile?.availability ??
        payload?.availability ??
        [];
      const status = profile?.status ?? payload?.data?.profile?.status ?? payload?.status;
      const interviewStatus =
        payload?.interview_status ??
        payload?.data?.interview_status ??
        payload?.interview?.status ??
        payload?.data?.interview?.status ??
        "";
      const apiStatus =
        payload?.approval_status ??
        payload?.data?.approval_status ??
        payload?.user?.profile_status ??
        null;
      const mergedStatus = status ?? apiStatus;
      const normalizedStatus = mergedStatus === null || mergedStatus === undefined ? null : String(mergedStatus);
      const statusLower = normalizedStatus ? normalizedStatus.toLowerCase() : "";
      const verificationRequired =
        typeof payload?.verification_required === "boolean"
          ? payload.verification_required
          : typeof payload?.data?.verification_required === "boolean"
          ? payload.data.verification_required
          : null;
      const isVerified =
        typeof payload?.is_verified === "boolean"
          ? payload.is_verified
          : typeof payload?.data?.is_verified === "boolean"
          ? payload.data.is_verified
          : null;
      const isRejectedOrBlacklisted =
        Boolean(payload?.is_blacklisted) ||
        statusLower.includes("reject") ||
        statusLower.includes("blacklist");
      const isApprovedOrVerified =
        isVerified === true ||
        verificationRequired === false ||
        statusLower.includes("approved") ||
        statusLower.includes("verified") ||
        statusLower.includes("completed");
      const requiresVerificationGate =
        verificationRequired === true ||
        statusLower.includes("pending_verification") ||
        statusLower.includes("pending verification") ||
        (statusLower.includes("pending") && !isApprovedOrVerified);

      const nannyTypeLower = String(nannyType || "").toLowerCase();
      if (nannyToken && (nannyTypeLower === "nanny" || nannyTypeLower === "syttr" || !nannyType)) {
        const storedUserType = nannyTypeLower === "syttr" ? "nanny" : (nannyTypeLower || "nanny");
        const sets: [string, string][] = [
          ["token", nannyToken || ""],
          ["user_type", storedUserType],
          ["nanny_name", nannyName || "Unknown"],
          ["user_name", nannyName || "Unknown"],
          ["nanny_email", nannyEmail || ""],
          ["user_email", nannyEmail || ""],
          ["nanny_id", String(nannyId || "")],
          ["user_id", String(nannyId || "")],
        ];
        if (profile?.city || profile?.city_area) sets.push(["nanny_city", profile.city || profile.city_area]);
        if (profile?.address || profile?.street_address) {
          sets.push(["nanny_address", profile.address || profile.street_address]);
        }
        if (profile?.country) sets.push(["nanny_country", profile.country]);
        if (profile?.gender) sets.push(["nanny_gender", profile.gender]);
        if (nannyAbout) sets.push(["nanny_about", nannyAbout]);
        const nannyPhone = profile?.number || profile?.phone;
        if (nannyPhone) sets.push(["nanny_phone", nannyPhone]);
        if (nannyExperience !== undefined && nannyExperience !== null)
          sets.push(["nanny_experience", String(nannyExperience)]);
        if (nannyDob) sets.push(["nanny_dob", String(nannyDob)]);
        if (imageUrl) {
          sets.push(["nanny_image", imageUrl]);
          sets.push(["user_image", imageUrl]);
        }

        // Rate cards from login payload
        const normalizedRates = Array.isArray(rateCards) ? rateCards.reduce<Record<string, string>>((acc, card: any) => {
          const title = (card?.title || "").toLowerCase();
          if (title.includes("morning")) acc.morning = String(card?.rate ?? card?.value ?? "");
          if (title.includes("evening")) acc.evening = String(card?.rate ?? card?.value ?? "");
          if (title.includes("night")) acc.night = String(card?.rate ?? card?.value ?? "");
          return acc;
        }, {}) : {};
        const firstRate = Array.isArray(rateCards) && rateCards.length
          ? String(rateCards[0]?.rate ?? rateCards[0]?.value ?? "")
          : undefined;
        const rateMorning = normalizedRates.morning || firstRate;
        const rateEvening = normalizedRates.evening || firstRate;
        const rateNight = normalizedRates.night || firstRate;
        if (rateMorning) sets.push(["rate_morning", rateMorning]);
        if (rateEvening) sets.push(["rate_evening", rateEvening]);
        if (rateNight) sets.push(["rate_night", rateNight]);
        const persistedStatus = isApprovedOrVerified ? "approved" : statusLower;
        if (persistedStatus) {
          sets.push(["nanny_approval_state", persistedStatus]);
          sets.push(["user_verification_status", persistedStatus]);
        }
        if (String(interviewStatus || "").trim()) {
          sets.push(["nanny_interview_status", String(interviewStatus).toLowerCase().trim()]);
        }
        // Ensure stale client IDs are removed when switching roles
        await AsyncStorage.multiRemove(CLIENT_STORAGE_KEYS.filter((k) => k !== "user_id"));
        await AsyncStorage.multiSet(sets);
        if (Array.isArray(availability) && availability.length) {
          await AsyncStorage.setItem("nanny_availability", JSON.stringify(availability));
        }
        await requestPostLoginPermissions({ requestLocation: false });
        await rebindPushRegistrationForCurrentSession().catch(() => {});
        if (isRejectedOrBlacklisted) {
          onNannyRejected();
          setLoading(false);
          return;
        }
        if (isApprovedOrVerified) {
          if (navigation?.replace) {
            navigation.replace("NannyHome");
          } else {
            onNannySuccess();
          }
          setLoading(false);
          return;
        }
        if (requiresVerificationGate) {
          onNannyPending();
          setLoading(false);
          return;
        }
        if (normalizedStatus === null) {
          onNannyPending();
          setLoading(false);
          return;
        }
        if (navigation?.replace) {
          navigation.replace("NannyHome");
        } else {
          onNannySuccess();
        }
        setLoading(false);
        return;
      }
    } catch (err: any) {
      lastError =
        err?.response?.data?.message ||
        err?.message ||
        "Invalid credentials";
    }

    setLoginError(lastError);
    showError(lastError);
    setLoading(false);
  };

  return (
    <LinearGradient
      colors={["#FFFFFF", "#FFFFFF", "#FFFFFF"]}
      style={styles.container}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <View style={[styles.headerRow, { top: insets.top + rs(6) }]}>
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
          <LinearGradient
            colors={[palette.accentDeep, palette.primary]}
            style={styles.backBtnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Ionicons name="chevron-back" size={20} color="#FFF" />
          </LinearGradient>
        </TouchableOpacity>
        <View style={styles.headerSpacer} />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <SafeScreen
          scroll
          edges={["top", "left", "right", "bottom"]}
          scrollProps={{ showsVerticalScrollIndicator: false }}
          contentContainerStyle={[
            styles.scroll,
            {
              paddingHorizontal: wp(5),
              paddingTop: Math.max(insets.top + rs(5), rs(44)),
              paddingBottom: Math.max(24, insets.bottom + 16),
              minHeight: height,
            },
          ]}
        >
          <View style={[styles.contentWrap, { maxWidth: contentMaxWidth }]}>
          <AppLogo />

          {/* Title */}
          <Text style={[styles.title, { fontSize: isCompact ? 30 : 34 }]}>Welcome Back</Text>
          <Text style={[styles.subtitle, { fontSize: isCompact ? 15 : 16, marginBottom: isCompact ? 24 : 32 }]}>
            Login to continue using Syttr
          </Text>

          {/* Card */}
          <LinearGradient
            colors={[palette.surface, "#FFFDF9"]}
            style={[styles.card, { padding: isCompact ? 22 : 28 }]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Input
              icon="mail-outline"
              placeholder="Email Address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Input
              icon="lock-closed-outline"
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={hidePassword}
              autoCorrect={false}
              rightIcon={
                <TouchableOpacity onPress={() => setHidePassword(v => !v)}>
                  <Ionicons
                    name={hidePassword ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color={palette.primary}
                  />
                </TouchableOpacity>
              }
            />

            {/* Remember */}
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.rememberRow}
                onPress={() => setRemember(v => !v)}
              >
                <LinearGradient
                  colors={
                    remember
                      ? [palette.primary, palette.accent]
                      : ["transparent", "transparent"]
                  }
                  style={[styles.checkbox, remember && styles.checked]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  {remember && (
                    <Ionicons name="checkmark" size={12} color="#FFF" />
                  )}
                </LinearGradient>
                <Text style={styles.text}>Remember Me</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.forgotPasswordBtn}
                onPress={onForgotPassword}
              >
                <Text style={styles.link}>Forgot Password?</Text>
              </TouchableOpacity>
            </View>

            {/* Button */}
            {!!loginError && !loading && (
              <Text style={styles.errorText}>{loginError}</Text>
            )}
            <TouchableOpacity
              style={styles.buttonContainer}
              onPress={handleLogin}
              disabled={isBusy}
            >
              <LinearGradient
                colors={[palette.primary, palette.accent]}
                style={styles.button}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                {isBusy ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Text style={styles.buttonText}>Login</Text>
                    <Ionicons name="arrow-forward" size={20} color="#FFF" style={styles.buttonIcon} />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

           
          </LinearGradient>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Sign Up as Parent</Text>
            <TouchableOpacity onPress={onSignupClient}>
              <LinearGradient
                colors={[palette.accentDeep, palette.primary]}
                style={styles.linkGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Text style={styles.linkText}>Tap Here</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={styles.nannyCard} 
            onPress={onSignupNanny}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={[
                "rgba(242, 124, 156, 0.16)",
                "rgba(246, 188, 99, 0.18)",
              ]}
              style={styles.nannyCardGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Ionicons name="briefcase-outline" size={22} color="#FFF" />
              <Text style={styles.nannyText}> Are you a Syttr?</Text>
              <Ionicons name="chevron-forward" size={16} color="#FFF" />
            </LinearGradient>
          </TouchableOpacity>
          <Text style={styles.legalText}>
            By continuing, you agree to our{" "}
            <Text style={styles.legalLink} onPress={onTermsPress}>
              Terms & Conditions
            </Text>
            {" "}and{" "}
            <Text style={styles.legalLink} onPress={onPrivacyPress}>
              Privacy Policy
            </Text>
            .
          </Text>
          </View>
        </SafeScreen>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

export default LoginScreen;

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  container: { 
    flex: 1,
  },
  headerRow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerSpacer: {
    width: rs(44),
    height: rs(44),
  },

  scroll: {
    
    paddingBottom: rs(50),
    alignItems: "center",
  },
  contentWrap: {
    width: "100%",
    alignSelf: "center",
  },

  backBtn: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    overflow: 'hidden',
    alignSelf: "flex-start",
    ...Platform.select({
      web: {
        boxShadow: `0px 4px 12px ${palette.shadow}`,
      },
      default: {
        elevation: 8,
        shadowColor: palette.primary,
        shadowOffset: { width: rs(0), height: rs(4) },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
    }),
  },

  backBtnGradient: {
    width: '100%',
    height: '100%',
    alignItems: "center",
    justifyContent: "center",
  },

  logoWrap: {
    alignItems: "center",
    marginVertical: rs(18),
    position: 'relative',
  },

  logoCircle: {
    alignItems: "center",
    justifyContent: "center",
    padding: rs(10),
    borderRadius: 999,
    ...Platform.select({
      web: {
        boxShadow: `0px 10px 24px ${palette.shadow}`,
      },
      default: {
        elevation: 12,
        shadowColor: palette.primary,
        shadowOffset: { width: rs(0), height: rs(10) },
        shadowOpacity: 0.35,
        shadowRadius: 24,
      },
    }),
  },

  logoInnerCircle: {
    backgroundColor: "#FFF8F3",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: palette.outline,
    borderRadius: 999,
  },

  logo: {
    width: "70%",
    height: "70%",
  },

  title: {
    fontSize: rf(34),
    fontWeight: "800",
    color: palette.textPrimary,
    textAlign: 'center',
    marginTop: rs(2),
    marginBottom: rs(8),
    fontFamily: Fonts.display,
    ...Platform.select({
      web: {
        textShadow: '1px 1px 3px rgba(0, 0, 0, 0.1)',
      },
      default: {
        textShadowColor: 'rgba(0, 0, 0, 0.1)',
        textShadowOffset: { width: rs(1), height: rs(1) },
        textShadowRadius: 3,
      },
    }),
  },

  subtitle: {
    color: palette.textSecondary,
    marginBottom: rs(32),
    fontSize: rf(16),
    textAlign: 'center',
    opacity: 0.85,
    fontFamily: Fonts.display,
  },

  card: {
    borderRadius: rs(24),
    padding: rs(28),
    ...Platform.select({
      web: {
        boxShadow: `0px 12px 24px ${palette.shadow}`,
      },
      default: {
        elevation: 12,
        shadowColor: palette.shadow,
        shadowOffset: { width: rs(0), height: rs(12) },
        shadowOpacity: 0.2,
        shadowRadius: 24,
      },
    }),
    borderWidth: 1,
    borderColor: palette.outline,
    backgroundColor: palette.surface,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: rs(16),
  },

  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  checkbox: {
    width: rs(22),
    height: rs(22),
    borderRadius: rs(6),
    marginRight: rs(12),
    borderWidth: 2,
    borderColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  checked: {
    borderWidth: 0,
  },

  text: {
    fontSize: rf(15),
    color: palette.textPrimary,
    fontWeight: '600',
    fontFamily: Fonts.display,
  },
  errorText: {
    marginTop: rs(8),
    textAlign: "center",
    color: palette.accentDeep,
    fontSize: rf(13),
    fontWeight: "700",
    fontFamily: Fonts.display,
  },

  forgotPasswordBtn: {
    paddingVertical: rs(6),
    paddingHorizontal: rs(12),
    borderRadius: rs(8),
    backgroundColor: "rgba(246, 197, 115, 0.16)",
  },

  link: {
    fontSize: rf(14),
    color: palette.accentDeep,
    fontWeight: "700",
    fontFamily: Fonts.display,
  },

  buttonContainer: {
    marginTop: rs(20),
    ...Platform.select({
      web: {
        boxShadow: `0px 6px 12px ${palette.shadow}`,
      },
      default: {
        elevation: 6,
        shadowColor: palette.primary,
        shadowOffset: { width: rs(0), height: rs(6) },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
    }),
  },

  button: {
    height: rs(58),
    borderRadius: rs(16),
    flexDirection: 'row',
    alignItems: "center",
    justifyContent: "center",
  },

  buttonText: {
    color: "#fff",
    fontSize: rf(18),
    fontWeight: "700",
    letterSpacing: rs(0.5),
    fontFamily: Fonts.display,
  },

  buttonIcon: {
    marginLeft: rs(10),
  },

  googleButton: {
    marginTop: rs(16),
    borderRadius: rs(14),
    height: rs(52),
    borderWidth: 1.5,
    borderColor: "rgba(242, 124, 156, 0.35)",
    backgroundColor: "#FFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(10),
    ...Platform.select({
      web: {
        boxShadow: `0px 6px 10px ${palette.shadow}`,
      },
      default: {
        elevation: 3,
        shadowColor: palette.shadow,
        shadowOffset: { width: rs(0), height: rs(6) },
        shadowOpacity: 0.15,
        shadowRadius: 10,
      },
    }),
  },

  googleIcon: {
    width: rs(18),
    height: rs(18),
  },

  googleText: {
    fontSize: rf(15),
    fontWeight: "700",
    color: palette.textPrimary,
    fontFamily: Fonts.display,
  },

  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: 'center',
    marginTop: rs(28),
    gap: rs(8),
  },

  footerText: {
    fontSize: rf(15),
    color: palette.textPrimary,
    fontWeight: "700",
    fontFamily: Fonts.display,
  },

  linkGradient: {
    paddingHorizontal: rs(16),
    paddingVertical: rs(8),
    borderRadius: rs(20),
    ...Platform.select({
      web: {
        boxShadow: `0px 4px 8px ${palette.shadow}`,
      },
      default: {
        elevation: 4,
        shadowColor: palette.primary,
        shadowOffset: { width: rs(0), height: rs(4) },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
    }),
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.4)",
  },

  linkText: {
    fontSize: rf(14),
    color: "#fff",
    fontWeight: "700",
    fontFamily: Fonts.display,
  },

  nannyCard: {
    marginTop: rs(20),
    borderRadius: rs(20),
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: `0px 4px 12px ${palette.shadow}`,
      },
      default: {
        elevation: 4,
        shadowColor: palette.shadow,
        shadowOffset: { width: rs(0), height: rs(4) },
        shadowOpacity: 0.2,
        shadowRadius: 12,
      },
    }),
  },

  nannyCardGradient: {
    padding: rs(18),
    borderRadius: rs(20),
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.48)",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },

  nannyText: {
    color: palette.textPrimary,
    fontWeight: "700",
    fontSize: rf(16),
    marginHorizontal: rs(8),
    fontFamily: Fonts.display,
  },
  legalText: {
    marginTop: rs(14),
    textAlign: "center",
    color: palette.textSecondary,
    fontSize: rf(12),
    lineHeight: rs(18),
    fontFamily: Fonts.display,
  },
  legalLink: {
    color: palette.accentDeep,
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
});

/* ---------------- INPUT COMPONENT ---------------- */

type InputProps = TextInputProps & {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  rightIcon?: React.ReactNode;
};

const Input: React.FC<InputProps> = ({ icon, rightIcon, ...props }) => (
  <View style={inputStyles.inputBox}>
    <LinearGradient
      colors={[palette.accent, palette.primary]}
      style={inputStyles.iconContainer}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <Ionicons name={icon} size={20} color="#FFF" />
    </LinearGradient>
    <TextInput 
      style={inputStyles.input} 
      placeholderTextColor={palette.textSecondary}
      {...props} 
    />
    {rightIcon && (
      <View style={inputStyles.rightIconContainer}>
        {rightIcon}
      </View>
    )}
  </View>
);

const inputStyles = StyleSheet.create({
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFDF9",
    borderRadius: rs(16),
    borderWidth: 2,
    borderColor: palette.outline,
    paddingHorizontal: rs(4),
    marginBottom: rs(20),
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(255, 95, 162, 0.2)',
      },
      default: {
        elevation: 2,
        shadowColor: "rgba(255, 95, 162, 0.2)",
        shadowOffset: { width: rs(0), height: rs(2) },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
    }),
  },
  iconContainer: {
    width: rs(40),
    height: rs(40),
    borderRadius: rs(12),
    alignItems: "center",
    justifyContent: "center",
    margin: rs(4),
  },
  input: {
    flex: 1,
    paddingVertical: rs(14),
    marginHorizontal: rs(12),
    fontSize: rf(16),
    color: palette.textPrimary,
    fontWeight: '600',
    fontFamily: Platform.OS === "android" ? undefined : Fonts.display,
  },
  rightIconContainer: {
    padding: rs(8),
  },
});
