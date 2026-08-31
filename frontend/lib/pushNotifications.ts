import AppStorage from "@/lib/storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import {
  registerPushToken,
  sanitizeToken,
  triggerNotificationHeartbeat,
  unregisterPushToken,
} from "../app/_Api";

const PUSH_TOKEN_KEY = "expo_push_token";
const PUSH_DEVICE_ID_KEY = "expo_push_device_id";
const PUSH_LAST_SYNCED_USER_KEY = "expo_push_last_user_id";
const PUSH_PERMISSION_STATUS_KEY = "expo_push_permission_status";
const LAST_NOTIFICATION_RESPONSE_KEY = "expo_last_notification_response";

let listenersBound = false;
let appStateSubscription: { remove: () => void } | null = null;
let syncingPromise: Promise<void> | null = null;
let receivedNotificationSubscription: Notifications.EventSubscription | null = null;
let responseNotificationSubscription: Notifications.EventSubscription | null = null;
const notificationResponseListeners = new Set<() => void>();
let reminderHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
let reminderHeartbeatInFlight: Promise<void> | null = null;

const REMINDER_HEARTBEAT_INTERVAL_MS = 60_000;

const isMissingPushRouteError = (error: unknown): boolean => {
  const status = Number((error as any)?.status || 0);
  const message = String((error as any)?.message || "").toLowerCase();
  return (
    status === 404 ||
    message.includes("push-tokens") ||
    message.includes("route api/push-tokens could not be found") ||
    message.includes("not found")
  );
};

const logPushWarning = (message: string, error?: unknown) => {
  const detail = String((error as any)?.message || "").trim();
  console.warn(`[push] ${message}${detail ? `: ${detail}` : ""}`);
};

const isMissingHeartbeatRouteError = (error: unknown): boolean => {
  const status = Number((error as any)?.status || 0);
  const message = String((error as any)?.message || "").toLowerCase();
  return (
    status === 404 ||
    message.includes("notifications/heartbeat") ||
    message.includes("route api/notifications/heartbeat could not be found") ||
    message.includes("not found")
  );
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const getProjectId = (): string => {
  const projectId =
    (Constants?.expoConfig as any)?.extra?.eas?.projectId ||
    (Constants?.easConfig as any)?.projectId ||
    "";
  return String(projectId || "").trim();
};

const getBundleIdentifier = (): string => {
  const expoConfig = (Constants?.expoConfig as any) || {};
  return String(expoConfig?.ios?.bundleIdentifier || expoConfig?.android?.package || "").trim();
};

const getEnvironment = (): string => {
  const ownership = String((Constants as any)?.appOwnership || "").trim().toLowerCase();
  if (ownership === "expo") return "expo-go";
  if (__DEV__) return "development";
  if (Platform.OS === "ios") return "production";
  return "release";
};

const isAndroidExpoGo = (): boolean =>
  Platform.OS === "android" &&
  String((Constants as any)?.appOwnership || "").trim().toLowerCase() === "expo";

const normalizeStoredId = (value: unknown): string => {
  if (value === undefined || value === null) return "";

  const raw = String(value).trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw);
    const candidate =
      parsed?.user_id ||
      parsed?.nanny_id ||
      parsed?.id ||
      parsed?.data?.user_id ||
      parsed?.data?.nanny_id ||
      parsed?.data?.id;
    if (candidate !== undefined && candidate !== null) {
      return String(candidate).replace(/"/g, "").trim();
    }
  } catch {
    // keep raw fallback
  }

  return raw.replace(/"/g, "").trim();
};

const getDeviceName = (): string =>
  String((Constants as any)?.deviceName || (Constants as any)?.deviceModelName || "").trim();

async function ensureNotificationPermissions(): Promise<Notifications.NotificationPermissionsStatus | null> {
  if (Platform.OS === "web") {
    return null;
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    await AppStorage.setItem(PUSH_PERMISSION_STATUS_KEY, existing.status);
    return existing;
  }

  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  await AppStorage.setItem(PUSH_PERMISSION_STATUS_KEY, requested.status);
  return requested;
}

async function getOrCreateDeviceId(): Promise<string> {
  const existing = String((await AppStorage.getItem(PUSH_DEVICE_ID_KEY)) || "").trim();
  if (existing) return existing;

  const generated = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AppStorage.setItem(PUSH_DEVICE_ID_KEY, generated);
  return generated;
}

async function getCurrentSessionUserId(): Promise<string> {
  const [[, userType], [, userId], [, nannyId]] = await AppStorage.multiGet([
    "user_type",
    "user_id",
    "nanny_id",
  ]);
  const normalizedType = String(userType || "").trim().toLowerCase();
  const normalizedUserId = normalizeStoredId(userId);
  const normalizedNannyId = normalizeStoredId(nannyId);

  if (normalizedType === "nanny" || normalizedType === "syttr") {
    return normalizedNannyId || normalizedUserId;
  }

  return normalizedUserId || normalizedNannyId;
}

async function buildRegistrationPayload(expoPushToken: string) {
  const deviceId = await getOrCreateDeviceId();
  const userId = await getCurrentSessionUserId();

  return {
    userId,
    payload: {
      expo_push_token: expoPushToken,
      platform: Platform.OS,
      device_id: deviceId,
      device_name: getDeviceName(),
      app_ownership: String((Constants as any)?.appOwnership || "").trim() || null,
      project_id: getProjectId() || null,
      bundle_identifier: getBundleIdentifier() || null,
      environment: getEnvironment(),
      meta: {
        executionEnvironment: String((Constants as any)?.executionEnvironment || "").trim() || null,
      },
    },
  };
}

export async function getExpoPushTokenForCurrentDevice(): Promise<string | null> {
  if (Platform.OS === "web" || !Notifications.getExpoPushTokenAsync) {
    return null;
  }

  // Expo Go on Android does not support remote push registration in SDK 53+.
  // Skip registration there to avoid noisy runtime warnings; keep iOS behavior unchanged.
  if (isAndroidExpoGo()) {
    return null;
  }

  const permissionStatus = await ensureNotificationPermissions();
  const granted =
    permissionStatus?.granted ||
    permissionStatus?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  if (!granted) {
    return null;
  }

  const projectId = getProjectId();
  if (!projectId) {
    throw new Error("Missing EAS projectId for Expo push registration.");
  }

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  const expoPushToken = String(tokenResponse?.data || "").trim();
  if (!expoPushToken) {
    return null;
  }

  await AppStorage.setItem(PUSH_TOKEN_KEY, expoPushToken);
  return expoPushToken;
}

export async function syncPushRegistration(force = false): Promise<void> {
  if (Platform.OS === "web") {
    return;
  }

  if (!force && syncingPromise) {
    return syncingPromise;
  }

  syncingPromise = (async () => {
    const [[, authToken], [, storedPushToken], [, lastSyncedUserId]] = await AppStorage.multiGet([
      "token",
      PUSH_TOKEN_KEY,
      PUSH_LAST_SYNCED_USER_KEY,
    ]);
    const normalizedAuthToken = sanitizeToken(String(authToken || "").trim());
    const currentUserId = await getCurrentSessionUserId();

    if (!normalizedAuthToken || !currentUserId) {
      if (storedPushToken) {
        await unregisterDevicePushToken().catch(() => {});
      }
      return;
    }

    const expoPushToken = force
      ? await getExpoPushTokenForCurrentDevice()
      : String(storedPushToken || "").trim() || (await getExpoPushTokenForCurrentDevice());
    if (!expoPushToken) {
      return;
    }

    const { userId, payload } = await buildRegistrationPayload(expoPushToken);
    if (!userId) {
      return;
    }

    if (!force && lastSyncedUserId === userId && storedPushToken === expoPushToken) {
      return;
    }

    try {
      await registerPushToken(payload, normalizedAuthToken || undefined);
    } catch (error) {
      if (isMissingPushRouteError(error)) {
        logPushWarning("Push registration endpoint is not deployed on the current API", error);
        return;
      }
      throw error;
    }
    await AppStorage.multiSet([
      [PUSH_TOKEN_KEY, expoPushToken],
      [PUSH_LAST_SYNCED_USER_KEY, userId],
    ]);
  })();

  try {
    await syncingPromise;
  } finally {
    syncingPromise = null;
  }
}

export async function unregisterDevicePushToken(): Promise<void> {
  const [[, authToken], [, expoPushToken], [, deviceId]] = await AppStorage.multiGet([
    "token",
    PUSH_TOKEN_KEY,
    PUSH_DEVICE_ID_KEY,
  ]);

  const normalizedToken = sanitizeToken(String(authToken || "").trim());
  const normalizedPushToken = String(expoPushToken || "").trim();
  const normalizedDeviceId = String(deviceId || "").trim();

  if (normalizedToken && (normalizedPushToken || normalizedDeviceId)) {
    await unregisterPushToken(
      {
        expo_push_token: normalizedPushToken || undefined,
        device_id: normalizedDeviceId || undefined,
      },
      normalizedToken || undefined
    ).catch((error) => {
      if (!isMissingPushRouteError(error)) {
        logPushWarning("Push token unregister failed", error);
      }
    });
  }

  await AppStorage.multiRemove([PUSH_TOKEN_KEY, PUSH_LAST_SYNCED_USER_KEY]);
}

export async function rebindPushRegistrationForCurrentSession(): Promise<void> {
  await AppStorage.removeItem(PUSH_LAST_SYNCED_USER_KEY).catch(() => {});
  await syncPushRegistration(true);
}

async function runReminderHeartbeat(force = false): Promise<void> {
  if (Platform.OS === "web") {
    return;
  }

  if (AppState.currentState !== "active") {
    return;
  }

  if (!force && reminderHeartbeatInFlight) {
    return reminderHeartbeatInFlight;
  }

  reminderHeartbeatInFlight = (async () => {
    const [[, token], [, nannyToken]] = await AppStorage.multiGet(["token", "nanny_token"]);
    const cleanToken = sanitizeToken(String(token || nannyToken || "").trim());
    const currentUserId = await getCurrentSessionUserId();

    if (!cleanToken || !currentUserId) {
      return;
    }

    try {
      await triggerNotificationHeartbeat(cleanToken);
    } catch (error) {
      if (!isMissingHeartbeatRouteError(error)) {
        logPushWarning("Notification heartbeat failed", error);
      }
    }
  })();

  try {
    await reminderHeartbeatInFlight;
  } finally {
    reminderHeartbeatInFlight = null;
  }
}

function startReminderHeartbeat(): void {
  if (reminderHeartbeatInterval) {
    return;
  }

  void runReminderHeartbeat(true);
  reminderHeartbeatInterval = setInterval(() => {
    void runReminderHeartbeat(false);
  }, REMINDER_HEARTBEAT_INTERVAL_MS);
}

function stopReminderHeartbeat(): void {
  if (!reminderHeartbeatInterval) {
    return;
  }

  clearInterval(reminderHeartbeatInterval);
  reminderHeartbeatInterval = null;
}

export function bindPushNotificationLifecycle(): void {
  if (listenersBound) {
    return;
  }
  listenersBound = true;

  receivedNotificationSubscription = Notifications.addNotificationReceivedListener(() => {
    // Foreground delivery is not a navigation intent. Only tap responses should
    // populate LAST_NOTIFICATION_RESPONSE_KEY, otherwise the app can route from
    // a notification the user never opened.
  });

  responseNotificationSubscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
    await AppStorage.setItem(
      LAST_NOTIFICATION_RESPONSE_KEY,
      JSON.stringify({
        kind: "response",
        actionIdentifier: response.actionIdentifier,
        notification: response.notification.request.content.data ?? {},
        respondedAt: new Date().toISOString(),
      })
    ).catch(() => {});
    notificationResponseListeners.forEach((listener) => listener());
  });

  appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void syncPushRegistration(false).catch((error) => {
        if (!isMissingPushRouteError(error)) {
          logPushWarning("Push registration refresh failed", error);
        }
      });
      startReminderHeartbeat();
    } else {
      stopReminderHeartbeat();
    }
  });

  if (AppState.currentState === "active") {
    startReminderHeartbeat();
  }
}

export function unbindPushNotificationLifecycle(): void {
  receivedNotificationSubscription?.remove();
  receivedNotificationSubscription = null;
  responseNotificationSubscription?.remove();
  responseNotificationSubscription = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  stopReminderHeartbeat();
  listenersBound = false;
}

export function subscribeNotificationResponses(listener: () => void): () => void {
  notificationResponseListeners.add(listener);
  return () => notificationResponseListeners.delete(listener);
}

export async function consumeStoredNotificationResponse(): Promise<any | null> {
  try {
    const raw = await AppStorage.getItem(LAST_NOTIFICATION_RESPONSE_KEY);
    if (!raw) return null;
    await AppStorage.removeItem(LAST_NOTIFICATION_RESPONSE_KEY).catch(() => {});
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
