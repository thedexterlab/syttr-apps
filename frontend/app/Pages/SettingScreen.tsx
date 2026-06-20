import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  apiRequest,
  deactivateAccount,
  getClientProfile,
  getRuntimeApiKey,
  getSubscriptionStatus,
  isUserRejectedFromSources,
  isUserVerifiedFromSources,
} from "../Api";
import { resolveSessionImageUrl } from "../../lib/nannySessionProfile";
import { fetchUnreadParentRequestCount } from "../../lib/parentRequestNotifications";
import { fetchUnreadConversationCount } from "../../lib/chatUnreadCount";
import { syncPushRegistration, unregisterDevicePushToken } from "../../lib/pushNotifications";
import { hp, rf, rs, wp } from "../utils/responsive";

type Item = {
  title: string;
  icon: string;
  danger?: boolean;
  onPress?: () => void;
};

type Props = {
  navigation?: any;
  onBack?: () => void;
  onLogout?: () => void;
  onAboutUs?: () => void;
  onContactUs?: () => void;
  onSupportTickets?: () => void;
  onPrivacyPolicy?: () => void;
  onTerms?: () => void;
  onFaq?: () => void;
  onInviteFriends?: () => void;
  onRateApp?: () => void;
  onFavorites?: () => void;
  onSubscription?: () => void;
  onJobStatus?: () => void;
  onParentProfile?: () => void;
  onManageChild?: () => void;
  onPaymentMethods?: () => void;
  onTransactionHistory?: () => void;
  onGetVerified?: () => void;
  onChangePassword?: () => void;
  onHome?: () => void;
  onMessages?: () => void;
  onJobRequests?: () => void;
  onNotifications?: () => void;
  onCalendar?: () => void;
  onSettings?: () => void;
  onBlacklisted?: () => void;
};

export default function SettingsScreen({
  navigation,
  onBack,
  onLogout,
  onAboutUs,
  onContactUs,
  onSupportTickets,
  onPrivacyPolicy,
  onTerms,
  onFaq,
  onInviteFriends,
  onRateApp,
  onFavorites,
  onSubscription,
  onJobStatus,
  onParentProfile,
  onManageChild,
  onPaymentMethods,
  onTransactionHistory,
  onGetVerified,
  onChangePassword,
  onHome,
  onMessages,
  onJobRequests,
  onNotifications,
  onCalendar,
  onSettings,
  onBlacklisted,
}: Props) {
  const insets = useSafeAreaInsets();
  const bottomBarOffset = -Math.max(insets.bottom, 0);
  const { width } = useWindowDimensions();
  const headerTitleSize = Math.min(Math.max(rf(20), 16), 28);
  const headerIconSize = Math.min(Math.max(width * 0.06, 18), 26);
  const avatarSize = width * 0.16;
  const listIconSize = Math.min(Math.max(width * 0.045, 14), 22);
  const [userName, setUserName] = useState<string>("Unknown");
  const [userEmail, setUserEmail] = useState<string>("");
  const [userImage, setUserImage] = useState<string>("");
  const [verificationStatus, setVerificationStatus] = useState<string>("unverified");
  const [tazStatus, setTazStatus] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [requestCount, setRequestCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);

  const resolveProfileImage = React.useCallback((value?: string) => {
    return resolveSessionImageUrl(value);
  }, []);

  const pickProfileImageValue = React.useCallback((profile?: Record<string, any> | null) => {
    if (!profile || typeof profile !== "object") return "";
    return String(
      profile.user_image_url ||
      profile.profile_image_url ||
      profile.profile_image ||
      profile.user_image ||
      profile.avatar ||
      profile.user?.user_image_url ||
      profile.user?.profile_image_url ||
      profile.user?.profile_image ||
      profile.user?.user_image ||
      profile.user?.avatar ||
      profile.parent_profile?.user_image_url ||
      profile.parent_profile?.profile_image_url ||
      profile.parent_profile?.profile_image ||
      profile.parent_profile?.user_image ||
      profile.parent_profile?.avatar ||
      profile.image_url ||
      profile.image ||
      ""
    ).trim();
  }, []);

  const loadSessionProfile = React.useCallback(async () => {
    const [name, email, image, status, subscriptionPlan] = await Promise.all([
      AsyncStorage.getItem("user_name"),
      AsyncStorage.getItem("user_email"),
      AsyncStorage.getItem("user_image"),
      AsyncStorage.getItem("user_verification_status"),
      AsyncStorage.getItem("subscription_plan"),
    ]);
    setUserName(name || "Unknown");
    setUserEmail(email || "Unknown");
    setUserImage(resolveProfileImage(image || ""));
    setVerificationStatus(normalizeStatus(status));
    if ((status || "").toLowerCase().trim() === "blacklisted") {
      onBlacklisted?.();
    }
    setIsSubscribed(!!subscriptionPlan);
  }, [onBlacklisted]);

  const syncSubscriptionStatus = async () => {
    try {
      const [token, userId] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("user_id"),
      ]);
      const data = await getSubscriptionStatus(
        token || undefined,
        userId || undefined
      );
      const root = data?.data || data || {};
      const subscribed =
        Boolean(root?.subscribed) ||
        Boolean(root?.is_subscribed) ||
        Boolean(root?.active) ||
        String(root?.status || "").toLowerCase() === "active";
      const plan = String(root?.plan || root?.subscription_plan || "").trim();

      setIsSubscribed(subscribed);
      if (subscribed && plan) {
        await AsyncStorage.setItem("subscription_plan", plan);
      } else if (!subscribed) {
        await AsyncStorage.removeItem("subscription_plan");
      }
    } catch {
      // keep local fallback
    }
  };

  const normalizeStatus = (raw?: string | null) => {
    const val = (raw || "").toLowerCase().trim();
    if (
      val === "verified" ||
      val === "approved" ||
      val === "completed" ||
      val === "quickapp-completed" ||
      val.includes("accept")
    ) {
      return "verified";
    }
    if (
      val === "app-pending" ||
      val === "pending" ||
      val.includes("quickapp.created") ||
      val.includes("order.quickapp.completed")
    ) {
      return "pending";
    }
    return "unverified";
  };

  const syncRemoteProfile = React.useCallback(async () => {
    try {
      const [userId, token] = await Promise.all([
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("token"),
      ]);
      const normalizedUserId = String(userId || "").trim();
      if (!normalizedUserId) return;

      const remote: any = await getClientProfile(normalizedUserId, token || undefined);
      const profile = remote?.profile || remote?.data?.profile || remote?.data || remote;
      if (!profile || typeof profile !== "object") return;

      const fullName = String(
        profile.name ||
          profile.fullname ||
          [profile.first_name || profile.firstname, profile.last_name || profile.lastname]
            .filter(Boolean)
            .join(" ") ||
          ""
      ).trim();
      const nextEmail = String(profile.email || "").trim();
      const nextImage = resolveProfileImage(pickProfileImageValue(profile));

      if (fullName) setUserName(fullName);
      if (nextEmail) setUserEmail(nextEmail);
      if (nextImage) setUserImage(nextImage);

      const pairs: [string, string][] = [];
      if (fullName) pairs.push(["user_name", fullName]);
      if (nextEmail) pairs.push(["user_email", nextEmail]);
      if (nextImage) pairs.push(["user_image", nextImage]);
      if (pairs.length) {
        await AsyncStorage.multiSet(pairs);
      }
    } catch (error: any) {
      const status = Number(error?.status || 0);
      if (status >= 500 || !status) {
        return;
      }
      console.warn("[Settings] remote profile sync failed", error);
    }
  }, [pickProfileImageValue, resolveProfileImage]);

  useEffect(() => {
    (async () => {
      await loadSessionProfile();
      await syncPushRegistration(false).catch(() => {});
      await syncRemoteProfile();
      fetchTazStatus();
      await syncSubscriptionStatus();
      await loadRequestCount();
      await loadMessageCount();
      await loadNotificationCount();
    })();
  }, [loadSessionProfile, syncRemoteProfile]);

  useEffect(() => {
    const unsubscribe = navigation?.addListener?.("focus", () => {
      void loadSessionProfile();
      void syncRemoteProfile();
      void loadRequestCount();
      void loadMessageCount();
      void loadNotificationCount();
    });
    return () => unsubscribe?.();
  }, [loadSessionProfile, navigation, syncRemoteProfile]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void loadSessionProfile();
        void syncRemoteProfile();
        void loadRequestCount();
        void loadMessageCount();
        void loadNotificationCount();
      }
    });
    return () => sub.remove();
  }, [loadSessionProfile, syncRemoteProfile]);

  useEffect(() => {
    if ((tazStatus || "").toLowerCase().trim() === "blacklisted") {
      onBlacklisted?.();
    }
  }, [tazStatus, onBlacklisted]);

  const fetchTazStatus = async () => {
    try {
      const [userId, tokenRaw] = await Promise.all([
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("token"),
      ]);
      if (!userId) return;

      let profileStatus = "";
      let profileVerifiedFlag: boolean | null = null;
      let profileVerificationRequired: boolean | null = null;
      try {
        const profileData = await apiRequest<any>("profile-status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(tokenRaw ? { Authorization: `Bearer ${String(tokenRaw).replace(/"/g, "").trim()}` } : {}),
          },
          body: JSON.stringify({ user_id: String(userId) }),
        }).catch(() => null);
        profileVerifiedFlag =
          typeof profileData?.is_verified === "boolean"
            ? profileData.is_verified
            : typeof profileData?.data?.is_verified === "boolean"
            ? profileData.data.is_verified
            : null;
        profileVerificationRequired =
          typeof profileData?.verification_required === "boolean"
            ? profileData.verification_required
            : typeof profileData?.data?.verification_required === "boolean"
            ? profileData.data.verification_required
            : null;
        profileStatus = String(profileData?.status || profileData?.approval_status || "")
          .trim()
          .toLowerCase();
      } catch {
        profileStatus = "";
      }
      const profileIsVerified =
        isUserVerifiedFromSources({
          profileStatus,
          isVerified: profileVerifiedFlag,
          verificationRequired: profileVerificationRequired,
        });
      if (profileIsVerified) {
        setTazStatus("approved");
        await AsyncStorage.setItem("user_verification_status", "approved");
        setVerificationStatus("verified");
        return;
      }

      const data = await apiRequest<any>("taz/status", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ user_id: String(userId) }),
      }).catch(() => null);
      if (!data?.success) return;
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
      const hasBlacklisted = isUserRejectedFromSources({
        tazDecisionStatus: decisionStatus,
        tazEventStatus: eventStatus,
        tazStatus: String(data?.status || "").toLowerCase(),
      });
      const hasVerified = isUserVerifiedFromSources({
        tazDecisionStatus: decisionStatus,
        tazEventStatus: eventStatus,
        tazStatus: String(data?.status || "").toLowerCase(),
      });
      const statusFromApi = String(data?.status || "").toLowerCase();
      if (hasBlacklisted || statusFromApi === "blacklisted") {
        setTazStatus("blacklisted");
        await AsyncStorage.setItem("user_verification_status", "blacklisted");
        onBlacklisted?.();
        return;
      }
      const hasPending =
        eventStatus.includes("order.quickapp.created") ||
        eventStatus.includes("order.quickapp.completed") ||
        eventStatus.includes("app-pending") ||
        eventStatus === "pending";
      const resolvedStatus = String(
        (hasVerified && "verified") ||
          (hasPending && "pending") ||
          (statusFromApi && statusFromApi !== "unknown" ? statusFromApi : "") ||
          (profileStatus && profileStatus !== "unknown" ? profileStatus : "") ||
          ""
      ).trim();
      if (resolvedStatus) {
        setTazStatus(resolvedStatus);
        await AsyncStorage.setItem("user_verification_status", resolvedStatus);
        setVerificationStatus(normalizeStatus(resolvedStatus));
      }
    } catch {
      // ignore status failures
    }
  };

  const loadRequestCount = async () => {
    try {
      const count = await fetchUnreadParentRequestCount();
      setRequestCount(count);
    } catch {
      setRequestCount(0);
    }
  };

  const loadMessageCount = async () => {
    try {
      const count = await fetchUnreadConversationCount();
      setMessageCount(count);
    } catch {
      setMessageCount(0);
    }
  };

  const isNotificationRead = (item?: { isRead?: unknown; is_read?: unknown } | null) => {
    if (!item) return false;
    if (item.isRead === true) return true;

    const raw = item.is_read;
    if (raw === true || raw === 1 || raw === "1") return true;
    if (typeof raw === "string" && raw.toLowerCase() === "true") return true;
    return false;
  };

  const loadNotificationCount = async () => {
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
      const cleanToken = String(token || "").replace(/^Bearer\s+/i, "").replace(/"/g, "").trim();
      const cleanApiKey = String(apiKey || "").trim() || getRuntimeApiKey();

      if (cleanToken) headers.Authorization = `Bearer ${cleanToken}`;
      if (cleanApiKey) headers["x-api-key"] = cleanApiKey;

      const json = await apiRequest<any>(
        `notifications?user_id=${encodeURIComponent(String(userId))}`,
        { headers: headers as Record<string, string> }
      );
      const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      const unread = data.filter((item: any) => !isNotificationRead(item));
      setNotificationCount(unread.length);
    } catch {
      setNotificationCount(0);
    }
  };

  const formatStatusLabel = (raw?: string | null) => {
    if (!raw) return "";
    const normalized = raw.toLowerCase().trim();
    if (
      normalized === "completed" ||
      normalized === "quickapp-completed" ||
      normalized === "verified" ||
      normalized === "approved"
    ) {
      return "Verified";
    }
    if (
      normalized === "app-pending" ||
      normalized === "pending"
    ) {
      return "Pending";
    }
    return raw
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const statusLabelBase =
    verificationStatus === "verified"
      ? "Verified"
      : verificationStatus === "pending"
      ? "Pending"
      : "Unverified";
  const statusLabel = tazStatus ? formatStatusLabel(tazStatus) : statusLabelBase;
  const statusTone =
    verificationStatus === "verified"
      ? { bg: "#E8F5E9", border: "#A5D6A7", text: "#1B5E20", icon: "checkmark-circle" }
      : verificationStatus === "pending"
      ? { bg: "#FFF4E5", border: "#FFD29A", text: "#C77700", icon: "time" }
      : { bg: "#FDECEF", border: "#F5B5C8", text: "#C2185B", icon: "alert-circle" };

  const showGetVerified = !!onGetVerified && verificationStatus !== "verified";
  const doLogout = async () => {
    await unregisterDevicePushToken().catch(() => {});
    if (onLogout) {
      await onLogout();
    } else {
      await AsyncStorage.clear();
    }
    if (navigation?.reset) {
      navigation.reset({ index: 0, routes: [{ name: "Login" }] });
    } else if (navigation?.replace) {
      navigation.replace("Login");
    } else {
      navigation?.navigate?.("Login");
    }
  };


  const confirmLogout = () => {
    if (Platform.OS === "web") {
      const ok = window.confirm(
        "Log out?\n\nYou will need to sign in again to access your account."
      );
      if (ok) void doLogout();
      return;
    }
    Alert.alert(
      "Log out?",
      "You will need to sign in again to access your account.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log out",
          style: "destructive",
          onPress: () => {
            void doLogout();
          },
        },
      ]
    );
  };

  const deactivateAccountMessage =
    "Are you sure you want to deactivate your account?\n\nYour profile will no longer be visible on Syttr, and you will no longer be able to log in.";

  const doDeactivateAccount = async () => {
    try {
      const token = await AsyncStorage.getItem("token");
      await deactivateAccount(token || undefined);
      if (Platform.OS === "web") {
        window.alert(
          "Your account has been deactivated."
        );
      } else {
        Alert.alert(
          "Account Deactivated",
          "Your account has been deactivated."
        );
      }
      await doLogout();
    } catch (error: any) {
      const message = String(error?.message || "Unable to deactivate your account right now.");
      if (Platform.OS === "web") {
        window.alert(message);
      } else {
        Alert.alert("Deactivate Account", message);
      }
    }
  };

  const confirmDeactivateAccount = () => {
    if (Platform.OS === "web") {
      const ok = window.confirm(`Deactivate Account\n\n${deactivateAccountMessage}`);
      if (ok) void doDeactivateAccount();
      return;
    }

    Alert.alert("Deactivate Account", deactivateAccountMessage, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Deactivate Account",
        style: "destructive",
        onPress: () => {
          void doDeactivateAccount();
        },
      },
    ]);
  };

  const sections: Item[] = [
    ...(showGetVerified
      ? [{ title: "Get Verified", icon: "shield-checkmark-outline", onPress: onGetVerified }]
      : []),
    // Parent profile is accessed via the profile card above
    { title: "Payment Methods", icon: "card-outline", onPress: onPaymentMethods },
    { title: "Transaction History", icon: "receipt-outline", onPress: onTransactionHistory },
    { title: "Manage Children", icon: "people-outline", onPress: onManageChild },
    { title: "Favorites", icon: "heart-outline", onPress: onFavorites },
    { title: "Subscription", icon: "wallet-outline", onPress: onSubscription },
    { title: "Job Status", icon: "briefcase-outline", onPress: onJobStatus },
    { title: "Change Password", icon: "lock-closed-outline", onPress: onChangePassword },
    { title: "About Us", icon: "information-circle-outline", onPress: onAboutUs },
    { title: "Invite Friends", icon: "share-social-outline", onPress: onInviteFriends },
    { title: "Rate App", icon: "star-outline", onPress: onRateApp },
    { title: "FAQ", icon: "help-circle-outline", onPress: onFaq },
    { title: "Contact Us", icon: "mail-outline", onPress: onContactUs },
    { title: "My Support Tickets", icon: "document-text-outline", onPress: onSupportTickets },
    { title: "Terms & Conditions", icon: "document-text-outline", onPress: onTerms },
    { title: "Privacy Policy", icon: "shield-checkmark-outline", onPress: onPrivacyPolicy },
    {
      title: "Logout",
      icon: "log-out-outline",
      danger: true,
      onPress: confirmLogout,
    },
    {
      title: "Deactivate Account",
      icon: "trash-outline",
      danger: true,
      onPress: confirmDeactivateAccount,
    },
  ];

  return (
    <LinearGradient
      colors={["#FFFFFF", "#FFFFFF"]}
      style={{ flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingBottom: rs(88) + Math.max(insets.bottom, 8) },
        ]}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { fontSize: headerTitleSize }]}>Settings</Text>
          <View style={styles.headerRight} />
        </View>

        {/* PROFILE CARD */}
        <TouchableOpacity
          style={styles.profileCard}
          onPress={onParentProfile}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={["#FFF5E1", "#FFEFF7"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.profileGradient}
          >
            <View style={styles.profileGlowTop} />
            <View style={styles.profileGlowBottom} />
            <View style={styles.profileHeaderRow}>
              <Text style={styles.profileLabel}>Your profile</Text>
              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: statusTone.bg, borderColor: statusTone.border },
                  ]}
                >
                  <Ionicons
                    name={statusTone.icon as keyof typeof Ionicons.glyphMap}
                    size={12}
                    color={statusTone.text}
                  />
                  <Text style={[styles.statusText, { color: statusTone.text }]}>
                    {statusLabel}
                  </Text>
                </View>
                {isSubscribed && (
                  <View style={styles.subscriptionBadge}>
                    <Ionicons name="sparkles" size={12} color="#fff" />
                    <Text style={styles.subscriptionText}>Premium</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.profileRow}>
              <View style={[styles.avatar, isSubscribed && styles.avatarPremium]}>
                {userImage ? (
                  <Image
                    source={{ uri: userImage }}
                    style={{ width: avatarSize, height: avatarSize, borderRadius: width * 0.045 }}
                  />
                ) : (
                  <Ionicons name="person" size={Math.min(Math.max(width * 0.07, 20), 32)} color="#C77A00" />
                )}
                {isSubscribed && (
                  <View style={styles.subscriptionIcon}>
                    <Ionicons name="star" size={12} color="#fff" />
                  </View>
                )}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{userName || "Unknown"}</Text>
                <Text style={styles.email}>{userEmail || "Unknown"}</Text>
              </View>

              <View style={styles.profileArrow}>
                <Ionicons name="chevron-forward" size={18} color="#C2185B" />
              </View>
            </View>

          </LinearGradient>
        </TouchableOpacity>

        {/* SETTINGS LIST */}
        <View style={styles.list}>
          {sections.map((item, index) => {
            const isDanger = item.danger;

            return (
              <TouchableOpacity
                key={index}
                style={styles.item}
                onPress={item.onPress}
                activeOpacity={0.8}
              >
                <View style={styles.left}>
                  <View
                    style={[
                      styles.iconCircle,
                      isDanger && styles.iconDanger,
                    ]}
                  >
                    <Ionicons
                      name={item.icon as keyof typeof Ionicons.glyphMap}
                      size={listIconSize}
                      color={isDanger ? "#E53935" : "#D81B60"}
                    />
                  </View>

                  <Text
                    style={[
                      styles.itemText,
                      isDanger && styles.dangerText,
                    ]}
                  >
                    {item.title}
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={listIconSize}
                  color={isDanger ? "#E53935" : "#C2185B"}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
      <View
        style={[
          styles.bottomBar,
          {
            bottom: bottomBarOffset,
            paddingBottom: Math.max(8, insets.bottom),
            height: rs(60) + Math.max(8, insets.bottom),
            pointerEvents: "auto" as any,
          },
        ]}
      >
        <Tab icon="home" label="Home" onPress={onHome || (() => {})} />
        <Tab icon="chatbubble" label="Chat" badgeCount={messageCount} onPress={onMessages || (() => {})} />
        <Tab
          icon="briefcase"
          label="Requests"
          badgeCount={requestCount}
          onPress={onJobRequests || (() => {})}
        />
        <Tab
          icon="notifications"
          label="Alerts"
          badgeCount={notificationCount}
          onPress={onNotifications || (() => {})}
        />
        <Tab icon="calendar" label="Calendar" onPress={onCalendar || (() => {})} />
        <Tab icon="settings" label="Settings" active onPress={onSettings || (() => {})} />
      </View>
    </LinearGradient>
  );
}

const Tab = ({
  icon,
  label,
  active = false,
  badgeCount,
  onPress,
}: {
  icon: any;
  label: string;
  active?: boolean;
  badgeCount?: number;
  onPress?: () => void;
}) => {
  const { width } = useWindowDimensions();
  const tabIconSize = Math.min(Math.max(width * 0.06, 18), 26);
  const showBadge = typeof badgeCount === "number" && badgeCount > 0;
  return (
    <TouchableOpacity style={styles.tabItem} onPress={onPress}>
      <View style={styles.tabIconWrap}>
        <Ionicons
          name={icon}
          size={tabIconSize}
          color={active ? "#FF80AB" : "#999"}
        />
        {showBadge ? (
          <View style={styles.tabBadge}>
            <Text style={styles.tabBadgeText}>
              {badgeCount! > 9 ? "9+" : badgeCount}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.tabLabel, active && styles.tabActive]}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: rs(16),
    paddingBottom: rs(120),
  },

  /* HEADER */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(14),
    backgroundColor: "rgba(255,255,255,0.9)",
    borderBottomLeftRadius: rs(18),
    borderBottomRightRadius: rs(18),
    elevation: 2,
    marginHorizontal: -rs(16),
    marginTop: -rs(16),
    marginBottom: rs(18),
  },
  headerLeft: {
    position: "absolute",
    left: 0,
    width: rs(22),
    alignItems: "flex-start",
  },
  headerRight: {
    position: "absolute",
    right: 0,
    width: rs(22),
  },
  headerTitle: {
    fontSize: rf(20),
    fontWeight: "700",
    color: "#C77A00",
    textAlign: "center",
  },

  /* PROFILE */
  profileCard: {
    borderRadius: rs(22),
    overflow: "hidden",
    marginBottom: rs(20),
    elevation: 3,
  },
  profileGradient: {
    paddingHorizontal: wp(4),
    paddingVertical: hp(1.8),
    borderRadius: rs(22),
    borderWidth: 1,
    borderColor: "rgba(255,214,140,0.7)",
    position: "relative",
  },
  profileGlowTop: {
    position: "absolute",
    width: wp(35),
    height: wp(35),
    borderRadius: wp(17.5),
    backgroundColor: "rgba(255,182,193,0.35)",
    top: hp(-6),
    right: wp(-5),
  },
  profileGlowBottom: {
    position: "absolute",
    width: wp(40),
    height: wp(40),
    borderRadius: wp(20),
    backgroundColor: "rgba(255,238,169,0.45)",
    bottom: hp(-6),
    left: wp(-5),
  },
  profileLabel: {
    fontSize: Math.min(Math.max(rf(11), 10), 14),
    letterSpacing: rs(1),
    textTransform: "uppercase",
    color: "#C77A00",
    fontWeight: "700",
    marginBottom: rs(0),
  },
  profileHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(10),
    gap: Math.max(rs(8), wp(2)),
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Math.max(rs(8), wp(2)),
  },
  profileArrow: {
    width: rs(30),
    height: rs(30),
    borderRadius: rs(15),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: wp(16),
    height: wp(16),
    borderRadius: wp(4.5),
    backgroundColor: "#FFE89A",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPremium: {
    borderWidth: 2,
    borderColor: "#FFB300",
  },
  subscriptionIcon: {
    position: "absolute",
    right: rs(-6),
    bottom: rs(-6),
    backgroundColor: "#FFB300",
    borderRadius: rs(10),
    width: rs(20),
    height: rs(20),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  name: {
    fontSize: Math.min(Math.max(rf(18), 14), 24),
    fontWeight: "700",
    color: "#C77A00",
  },
  email: {
    fontSize: Math.min(Math.max(rf(13), 11), 18),
    color: "#B07A1F",
    marginTop: rs(2),
  },
  badgeRow: {
    marginTop: rs(0),
    flexDirection: "row",
    alignItems: "center",
    gap: Math.max(rs(6), wp(1.5)),
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  statusBadge: {
    paddingHorizontal: wp(2),
    paddingVertical: hp(0.5),
    borderRadius: rs(12),
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
  },
  statusText: {
    color: "#6A1B9A",
    fontSize: Math.min(Math.max(rf(12), 10), 16),
    fontWeight: "700",
  },
  subscriptionBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#C2185B",
    paddingHorizontal: wp(2),
    paddingVertical: hp(0.5),
    borderRadius: rs(12),
    gap: rs(6),
  },
  subscriptionText: {
    color: "#fff",
    fontSize: Math.min(Math.max(rf(12), 10), 16),
    fontWeight: "700",
  },

  /* LIST */
  list: {
    gap: rs(12),
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFF",
    paddingVertical: rs(14),
    paddingHorizontal: rs(14),
    borderRadius: rs(16),
    elevation: 2,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(12),
  },
  iconCircle: {
    width: wp(12),
    height: wp(12),
    borderRadius: rs(12),
    backgroundColor: "#FFE89A",
    alignItems: "center",
    justifyContent: "center",
  },
  iconDanger: {
    backgroundColor: "#FFE5E5",
  },
  itemText: {
    fontSize: Math.min(Math.max(rf(16), 12), 22),
    fontWeight: "600",
    color: "#8B5E00",
  },
  dangerText: {
    color: "#D32F2F",
  },
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
  tabItem: {
    flex: 1,
    minWidth: rs(0),
    alignItems: "center",
    justifyContent: "center",
  },
  tabIconWrap: {
    position: "relative",
  },
  tabBadge: {
    position: "absolute",
    top: hp(-0.8),
    right: wp(-2),
    minWidth: wp(4),
    height: wp(4),
    borderRadius: wp(2),
    backgroundColor: "#FF3B7B",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: rs(4),
  },
  tabBadgeText: {
    color: "#fff",
    fontSize: rf(9),
    fontWeight: "700",
  },
  tabLabel: {
    fontSize: rf(11),
    color: "#999",
    marginTop: hp(0.45),
    fontFamily: "PlayfairDisplay",
  },
  tabActive: {
    color: "#FF80AB",
    fontWeight: "700",
    fontFamily: "PlayfairDisplay",
  },
});
