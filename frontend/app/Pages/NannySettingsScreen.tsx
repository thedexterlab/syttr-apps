import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NannyBottomNav from "../components/NannyBottomNav";
import { syncPushRegistration, unregisterDevicePushToken } from "../../lib/pushNotifications";
import { hp, rf, rs, wp } from "../utils/responsive";
import { hydrateNannySessionProfile, resolveSessionImageUrl } from "../../lib/nannySessionProfile";
import { deactivateAccount } from "../Api";

const cleanStoredValue = (value: unknown): string => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  if (lower === "null" || lower === "undefined" || lower === "nan") return "";
  return normalized;
};

const sanitizeDisplayName = (value: unknown): string => {
  const normalized = cleanStoredValue(value);
  if (!normalized) return "";
  if (normalized.includes("@")) return "";
  return normalized;
};

const resolveStoredProfile = (map: Record<string, string | null>) => {
  const firstName =
    cleanStoredValue(map.nanny_first_name) ||
    cleanStoredValue(map.first_name) ||
    cleanStoredValue(map.firstname);
  const lastName =
    cleanStoredValue(map.nanny_last_name) ||
    cleanStoredValue(map.last_name) ||
    cleanStoredValue(map.lastname);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  const name =
    sanitizeDisplayName(map.nanny_name) ||
    sanitizeDisplayName(map.user_name) ||
    sanitizeDisplayName(map.fullname) ||
    sanitizeDisplayName(map.full_name) ||
    sanitizeDisplayName(map.name) ||
    fullName;

  const email =
    cleanStoredValue(map.nanny_email) ||
    cleanStoredValue(map.user_email) ||
    cleanStoredValue(map.email);

  const image =
    resolveSessionImageUrl(map.nanny_image) ||
    resolveSessionImageUrl(map.user_image) ||
    resolveSessionImageUrl(map.profile_image_url) ||
    resolveSessionImageUrl(map.user_image_url) ||
    resolveSessionImageUrl(map.profile_image) ||
    resolveSessionImageUrl(map.avatar);

  return { name, email, image };
};

type Props = {
  navigation?: any;
  onBack?: () => void;
  onLogout?: () => void;
  onAvailability?: () => void;
  onWithdraw?: () => void;
  onAboutUs?: () => void;
  onFaq?: () => void;
  onTerms?: () => void;
  onPrivacy?: () => void;
  onContact?: () => void;
  onInviteFriends?: () => void;
  onRateApp?: () => void;
  onFavoriteJobs?: () => void;
  onProfileView?: () => void;
  onChangePassword?: () => void;
  onHome?: () => void;
  onJobs?: () => void;
  onCalendar?: () => void;
  onMessages?: () => void;
  onNotifications?: () => void;
  onSettings?: () => void;
};

export default function NannySettingsScreen({
  navigation,
  onBack,
  onLogout,
  onAvailability,
  onWithdraw,
  onAboutUs,
  onFaq,
  onTerms,
  onPrivacy,
  onContact,
  onInviteFriends,
  onRateApp,
  onFavoriteJobs,
  onProfileView,
  onChangePassword,
  onHome,
  onJobs,
  onCalendar,
  onMessages,
  onNotifications,
  onSettings,
}: Props) {
  const insets = useSafeAreaInsets();
  const [userName, setUserName] = useState<string>("Nanny");
  const [userEmail, setUserEmail] = useState<string>("user@example.com");
  const [userImage, setUserImage] = useState<string>("");

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [instantBooking, setInstantBooking] = useState(false);
  const [weeklyDigest, setWeeklyDigest] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const entries = await AsyncStorage.multiGet([
          "nanny_name",
          "user_name",
          "fullname",
          "full_name",
          "name",
          "nanny_first_name",
          "first_name",
          "firstname",
          "nanny_last_name",
          "last_name",
          "lastname",
          "nanny_email",
          "user_email",
          "email",
          "nanny_image",
          "user_image",
          "profile_image_url",
          "user_image_url",
          "profile_image",
          "avatar",
        ]);
        const map = Object.fromEntries(entries) as Record<string, string | null>;
        let profile = resolveStoredProfile(map);

        if (!profile.name || !profile.image || !profile.email) {
          try {
            const sessionProfile = await hydrateNannySessionProfile();
            if (sessionProfile) {
              profile = {
                name: sessionProfile.name || profile.name,
                email: sessionProfile.email || profile.email,
                image: sessionProfile.image || profile.image,
              };
            }
          } catch {
            // ignore api fetch errors
          }
        }

        setUserName(profile.name || "Nanny");
        setUserEmail(profile.email || "user@example.com");
        setUserImage(profile.image || "");
      } catch {
        setUserName("Nanny");
        setUserEmail("user@example.com");
        setUserImage("");
      }
    };
    void loadProfile();
    void syncPushRegistration(false).catch(() => {});
    const unsubscribe = navigation?.addListener?.("focus", loadProfile);
    return () => unsubscribe?.();
  }, [navigation]);

  const displayName = sanitizeDisplayName(userName) || "Nanny";
  const displayEmail = cleanStoredValue(userEmail) || "user@example.com";

  /* ---------------- ACTIONS ---------------- */

  const logout = async () => {
    try {
      await unregisterDevicePushToken().catch(() => {});
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

  const confirmLogout = () => {
    logout();
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
      await logout();
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

  /* ---------------- DATA ---------------- */

  const accountItems = [
    { icon: "heart-outline", label: "Favorite Jobs", route: "NannyFavoriteJobs" },
    { icon: "calendar-outline", label: "Availability & Schedule", route: "Availability" },
    { icon: "wallet-outline", label: "Withdraw Earnings", route: "NannyWithdraw" },
    { icon: "lock-closed-outline", label: "Change Password", route: "ChangePassword" },
  ];

  const supportItems = [
    { icon: "information-circle-outline", label: "About Us", route: "AboutUs" },
    { icon: "share-social-outline", label: "Invite Friends", route: "InviteFriends" },
    { icon: "star-outline", label: "Rate App", route: "RateApp" },
    { icon: "help-circle-outline", label: "FAQs", route: "FAQ" },
    { icon: "document-text-outline", label: "Terms & Conditions", route: "Terms" },
    { icon: "shield-checkmark-outline", label: "Privacy Policy", route: "Privacy" },
    { icon: "headset-outline", label: "Contact Support", route: "ContactSupport" },
  ];

  /* ---------------- UI ---------------- */

  return (
    <LinearGradient
      colors={["#FFFFFF", "#FFFFFF", "#FFFFFF"]}
      style={{ flex: 1 }}
    >
        <ScrollView
          contentContainerStyle={{ paddingBottom: rs(88) + Math.max(insets.bottom, rs(16)) }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.contentWrap}>
          {/* HEADER */}
          <View style={styles.topBar}>
            <View style={styles.topSide} />
            <Text style={styles.topTitle}>Settings</Text>
            <View style={styles.topSide} />
          </View>

          <TouchableOpacity
            style={styles.profileCard}
            onPress={() => {
              if (onProfileView) onProfileView();
              else navigation?.navigate?.("NannyProfileView");
            }}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={["#FFF5E1", "#FFEFF7"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.profileGradient}
            >
              <View style={styles.profileHeaderRow}>
                <Text style={styles.profileLabel}>Your profile</Text>
              </View>

              <View style={styles.profileRow}>
                <View style={styles.avatar}>
                  {userImage ? (
                    <Image source={{ uri: userImage }} style={{ width: wp(16), height: wp(16), borderRadius: wp(4.5) }} />
                  ) : (
                    <Ionicons name="person" size={24} color="#C77A00" />
                  )}
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{displayName}</Text>
                  <Text style={styles.email}>{displayEmail}</Text>
                </View>

                <View style={styles.profileArrow}>
                  <Ionicons name="chevron-forward" size={18} color="#C2185B" />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>
          
          <View style={styles.sectionCard}>
            <Section title="Account">
              {accountItems.map((item, idx) => (
                  <SettingsTile
                    key={idx}
                    icon={item.icon}
                    label={item.label}
                  onPress={() => {
                    if (item.route === "Availability" && onAvailability) {
                      onAvailability();
                    } else if (item.route === "NannyFavoriteJobs" && onFavoriteJobs) {
                      onFavoriteJobs();
                    } else if (item.route === "NannyWithdraw" && onWithdraw) {
                      onWithdraw();
  	                  } else if (item.route === "NannyProfileView" && onProfileView) {
  	                    onProfileView();
                    } else if (item.route === "ChangePassword" && onChangePassword) {
                      onChangePassword();
                    } else {
                      navigation?.navigate?.(item.route);
                    }
                  }}
                />
              ))}
            </Section>
          </View>

          <View style={styles.sectionCard}>
            <Section title="Support & Policies">
              {supportItems.map((item, idx) => (
                <SettingsTile
                  key={idx}
                  icon={item.icon}
                  label={item.label}
                  onPress={() => {
                    if (item.route === "AboutUs" && onAboutUs) return onAboutUs();
                    if (item.route === "InviteFriends" && onInviteFriends) return onInviteFriends();
                    if (item.route === "RateApp" && onRateApp) return onRateApp();
                    if (item.route === "FAQ" && onFaq) return onFaq();
                    if (item.route === "Terms" && onTerms) return onTerms();
                    if (item.route === "Privacy" && onPrivacy) return onPrivacy();
                    if (item.route === "ContactSupport" && onContact) return onContact();
                    navigation?.navigate?.(item.route);
                  }}
                />
              ))}
            </Section>
          </View>

          {/* LOGOUT */}
          <View style={styles.logoutCard}>
            <Text style={styles.logoutTitle}>Session</Text>
            <Text style={styles.logoutText}>
              Sign out from this account on this device.
            </Text>
            <View style={{ flexDirection: "row", marginTop: rs(14) }}>
              <TouchableOpacity
                style={styles.logoutBtn}
                onPress={confirmLogout}
              >
                <Text style={styles.logoutBtnText}>Log out</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", marginTop: rs(12) }}>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={confirmDeactivateAccount}
              >
                <Text style={styles.deleteBtnText}>Deactivate Account</Text>
              </TouchableOpacity>
            </View>
          </View>
          </View>
        </ScrollView>
        <NannyBottomNav
          active="Settings"
          onPress={(key) => {
          if (key === "Home") {
            if (onHome) onHome();
            else navigation?.navigate?.("NannyHome");
            return;
          }
          if (key === "Jobs") {
            if (onJobs) onJobs();
            else navigation?.navigate?.("NannyJobs");
            return;
          }
          if (key === "Calendar") {
            if (onCalendar) onCalendar();
            else navigation?.navigate?.("NannyCalendar");
            return;
          }
          if (key === "Messages") {
            if (onMessages) onMessages();
            else navigation?.navigate?.("NannyMessages");
            return;
          }
          if (key === "Notifications") {
            if (onNotifications) onNotifications();
            else navigation?.navigate?.("NannyNotifications");
            return;
          }
          if (key === "Settings") {
            if (onSettings) onSettings();
            else navigation?.navigate?.("NannySettings");
          }
          }}
        />
    </LinearGradient>
  );
}

/* ---------------- COMPONENTS ---------------- */

function ToggleTile({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleCard}>
      <View style={styles.toggleIcon}>
        <MaterialIcons name="tune" size={rs(20)} color="#FF80AB" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleSubtitle}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        thumbColor="#fff"
        trackColor={{ true: "#FF80AB", false: "#E0E0E0" }}
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: rs(16) }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={{ marginTop: rs(8) }}>{children}</View>
    </View>
  );
}

function SettingsTile({
  icon,
  label,
  onPress,
}: {
  icon: any;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.settingsTile} onPress={onPress}>
      <View style={styles.settingsIcon}>
        <Ionicons name={icon} size={rs(20)} color="#FF80AB" />
      </View>
      <Text numberOfLines={1} ellipsizeMode="tail" style={styles.settingsLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={rs(18)} color="#AD1457" />
    </TouchableOpacity>
  );
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  contentWrap: {
    paddingHorizontal: rs(16),
    paddingTop: 0,
    paddingBottom: rs(8),
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: rs(1),
    paddingBottom: rs(14),
  },
  topSide: { width: rs(34), height: rs(34) },
  topTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
  },
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
  },
  profileHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(10),
  },
  profileLabel: {
    fontSize: Math.min(Math.max(rf(11), 10), 14),
    letterSpacing: rs(1),
    textTransform: "uppercase",
    color: "#C77A00",
    fontWeight: "700",
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

  toggleCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: rs(18),
    borderRadius: rs(18),
    marginBottom: rs(12),
    shadowColor: "rgba(255,128,171,0.12)",
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: rs(0), height: rs(6) },
  },
  toggleIcon: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(14),
    backgroundColor: "rgba(255,128,171,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(14),
  },
  toggleTitle: {
    fontSize: rf(15),
    fontWeight: "600",
    color: "#880E4F",
  },
  toggleSubtitle: {
    fontSize: rf(12),
    color: "#6B4350",
    marginTop: rs(4),
  },

  sectionTitle: {
    fontSize: rf(15),
    fontWeight: "700",
    color: "#C77A00",
    marginLeft: rs(2),
  },
  sectionCard: {
    backgroundColor: "transparent",
    borderRadius: rs(0),
    paddingHorizontal: rs(0),
    paddingVertical: rs(0),
    borderWidth: 0,
    marginBottom: rs(8),
  },

  settingsTile: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    paddingVertical: rs(14),
    paddingHorizontal: rs(14),
    borderRadius: rs(16),
    marginBottom: rs(12),
    elevation: 2,
  },
  settingsIcon: {
    width: wp(12),
    height: wp(12),
    borderRadius: rs(12),
    backgroundColor: "#FFE89A",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(12),
  },
  settingsLabel: {
    flex: 1,
    fontSize: Math.min(Math.max(rf(16), 12), 22),
    fontWeight: "600",
    color: "#8B5E00",
  },

  logoutCard: {
    marginTop: rs(18),
    backgroundColor: "#FFF",
    padding: rs(16),
    borderRadius: rs(18),
    elevation: 2,
  },
  logoutTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
  },
  logoutText: {
    fontSize: rf(12),
    color: "#6B4350",
    marginTop: rs(8),
  },
  pauseBtn: {
    paddingVertical: rs(12),
    paddingHorizontal: rs(14),
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "#FF80AB",
    marginRight: rs(12),
  },
  pauseText: {
    color: "#880E4F",
    fontWeight: "600",
  },
  logoutBtn: {
    width: "100%",
    backgroundColor: "#FF80AB",
    borderRadius: rs(14),
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: rs(12),
  },
  logoutBtnText: {
    color: "#FFF",
    fontWeight: "600",
  },
  deleteBtn: {
    width: "100%",
    backgroundColor: "#FFF1F1",
    borderRadius: rs(14),
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: rs(12),
    borderWidth: 1,
    borderColor: "#E57373",
  },
  deleteBtnText: {
    color: "#C62828",
    fontWeight: "700",
  },
});
