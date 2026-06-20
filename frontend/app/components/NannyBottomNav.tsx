import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchUnreadConversationCount } from "../../lib/chatUnreadCount";
import { apiRequest, BASE_URL, getRuntimeApiKey, sanitizeToken } from "../Api";

export type NannyNavKey =
  | "Home"
  | "Jobs"
  | "Calendar"
  | "Messages"
  | "Notifications"
  | "Settings";

type Props = {
  active?: NannyNavKey;
  onPress?: (key: NannyNavKey) => void;
  onHome?: () => void;
  onJobs?: () => void;
  onCalendar?: () => void;
  onMessages?: () => void;
  onNotifications?: () => void;
  onSettings?: () => void;
  navigation?: any;
  notificationCount?: number;
  messageCount?: number;
};

const HIDDEN_NOTIFICATIONS_KEY = "hidden_notifications_nanny";

const isNotificationRead = (
  item?: { isRead?: unknown; is_read?: unknown } | null
) => {
  if (!item) return false;
  if (item.isRead === true) return true;

  const raw = item.is_read;
  if (raw === true || raw === 1 || raw === "1") return true;
  if (typeof raw === "string" && raw.toLowerCase() === "true") return true;
  return false;
};

const toNotificationRows = (payload: any): any[] => {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
};

const toStoredIdSet = (raw: string | null): Set<string> => {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((id) => String(id || "").trim()).filter(Boolean));
  } catch {
    return new Set();
  }
};

const fetchUnreadNotificationCount = async (): Promise<number> => {
  const [tokenRaw, nannyTokenRaw, apiKeyStored, userIdRaw, nannyIdRaw, hiddenRaw] =
    await Promise.all([
      AsyncStorage.getItem("token"),
      AsyncStorage.getItem("nanny_token"),
      AsyncStorage.getItem("api_key"),
      AsyncStorage.getItem("user_id"),
      AsyncStorage.getItem("nanny_id"),
      AsyncStorage.getItem(HIDDEN_NOTIFICATIONS_KEY),
    ]);

  const token = sanitizeToken(tokenRaw || nannyTokenRaw || undefined);
  const apiKey = String(apiKeyStored || getRuntimeApiKey() || "").trim() || undefined;
  const nannyId = String(nannyIdRaw || userIdRaw || "").trim();

  if (!token && !nannyId) return 0;

  const queryParts: string[] = [];
  if (nannyId) queryParts.push(`nanny_id=${encodeURIComponent(nannyId)}`);
  if (apiKey) queryParts.push(`api_key=${encodeURIComponent(apiKey)}`);
  const query = queryParts.length ? `?${queryParts.join("&")}` : "";

  const json = await apiRequest<any>(`nanny/notifications${query}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(nannyId ? { "nanny-id": nannyId, nanny_id: nannyId } : {}),
    },
  });

  const hiddenIds = toStoredIdSet(hiddenRaw);

  return toNotificationRows(json).filter((item: any) => {
    const id = String(item?.id || "").trim();
    if (id && hiddenIds.has(id)) return false;
    return !isNotificationRead(item);
  }).length;
};

const NAV_ITEMS: Array<{
  key: NannyNavKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { key: "Home", label: "Home", icon: "home-outline" },
  { key: "Jobs", label: "Jobs", icon: "briefcase-outline" },
  { key: "Calendar", label: "Calendar", icon: "calendar-outline" },
  { key: "Messages", label: "Messages", icon: "chatbubble-ellipses-outline" },
  { key: "Notifications", label: "Alerts", icon: "notifications-outline" },
  { key: "Settings", label: "Settings", icon: "settings-outline" },
];

export default function NannyBottomNav({
  active = "Home",
  onPress,
  onHome,
  onJobs,
  onCalendar,
  onMessages,
  onNotifications,
  onSettings,
  navigation,
  notificationCount,
  messageCount,
}: Props) {
  const insets = useSafeAreaInsets();
  const [localMessageCount, setLocalMessageCount] = useState<number>(0);
  const [localNotificationCount, setLocalNotificationCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    const syncBadges = async () => {
      try {
        const [conversationCount, unreadNotificationCount] = await Promise.all([
          fetchUnreadConversationCount().catch(() => 0),
          fetchUnreadNotificationCount().catch(() => 0),
        ]);
        if (!mounted) return;
        setLocalMessageCount(conversationCount);
        setLocalNotificationCount(unreadNotificationCount);
      } catch {
        if (!mounted) return;
        setLocalMessageCount(0);
        setLocalNotificationCount(0);
      }
    };

    void syncBadges();
    const interval = setInterval(() => {
      void syncBadges();
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [active]);

  const effectiveMessageCount =
    typeof messageCount === "number" ? messageCount : localMessageCount;
  const effectiveNotificationCount =
    typeof notificationCount === "number" ? notificationCount : localNotificationCount;

  const handlePress = (key: NannyNavKey) => {
    if (onPress) {
      onPress(key);
      return;
    }

    const callbackMap: Partial<Record<NannyNavKey, (() => void) | undefined>> = {
      Home: onHome,
      Jobs: onJobs,
      Calendar: onCalendar,
      Messages: onMessages,
      Notifications: onNotifications,
      Settings: onSettings,
    };
    const callback = callbackMap[key];
    if (callback) {
      callback();
      return;
    }

    const routeMap: Record<NannyNavKey, string> = {
      Home: "NannyHome",
      Jobs: "NannyJobs",
      Calendar: "NannyCalendar",
      Messages: "NannyMessages",
      Notifications: "NannyNotifications",
      Settings: "NannySettings",
    };
    navigation?.navigate?.(routeMap[key]);
  };

  return (
    <View
      style={[
        styles.root,
        {
          paddingBottom: Math.max(8, insets.bottom > 0 ? 6 : 8),
        },
      ]}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = item.key === active;
        const showBadge = item.key === "Notifications" && effectiveNotificationCount > 0;
        const showMessageBadge = item.key === "Messages" && effectiveMessageCount > 0;
        return (
          <TouchableOpacity
            key={item.key}
            style={styles.item}
            onPress={() => handlePress(item.key)}
            accessibilityRole="button"
            accessibilityLabel={item.key}
          >
            <View style={styles.iconWrap}>
              <Ionicons
                name={item.icon}
                size={20}
                color={isActive ? "#FF80AB" : "#8A7A80"}
              />
              {showBadge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {effectiveNotificationCount > 9
                      ? "9+"
                      : String(effectiveNotificationCount)}
                  </Text>
                </View>
              ) : null}
              {showMessageBadge ? (
                <View style={[styles.badge, styles.messageBadge]}>
                  <Text style={styles.badgeText}>
                    {effectiveMessageCount > 9 ? "9+" : String(effectiveMessageCount)}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.label, isActive && styles.labelActive]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#F5D7E2",
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 10,
    elevation: 20,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrap: {
    position: "relative",
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#FF3D7B",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  messageBadge: {
    top: -6,
    right: -10,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },
  label: {
    marginTop: 2,
    fontSize: 10,
    color: "#8A7A80",
    fontWeight: "600",
    maxWidth: "100%",
    textAlign: "center",
  },
  labelActive: {
    color: "#FF80AB",
  },
});
