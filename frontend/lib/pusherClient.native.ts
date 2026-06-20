import { AppState, AppStateStatus } from "react-native";
import Constants from "expo-constants";
import Pusher from "pusher-js/react-native";

type Channel = any;
type Unsubscribe = () => void;
type SubscriptionKind = "chat" | "notifications";
type SubscriptionEntry = {
  channelName: string;
  eventNames: string[];
  callback: (data: any) => void;
  boundHandlers: Map<string, (payload: any) => void>;
  kind: SubscriptionKind;
};

let pusherInstance: Pusher | null = null;
let appStateListenerAttached = false;
let connectionListenersBound = false;
let lastAppState: AppStateStatus = AppState.currentState;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let recreateTimer: ReturnType<typeof setTimeout> | null = null;
let recreateInFlight = false;

const runtimeExtra =
  ((Constants as any)?.expoConfig?.extra as Record<string, any> | undefined) ||
  ((Constants as any)?.manifest2?.extra as Record<string, any> | undefined) ||
  ((Constants as any)?.manifest?.extra as Record<string, any> | undefined) ||
  {};

const subscriptionRegistry = new Map<string, SubscriptionEntry>();

const CHAT_EVENT_NAMES = [
  "chat.message.sent",
  "message.sent",
  "chat.message",
  "new-message",
  "App\\Events\\ChatMessageSent",
];

const NOTIFICATION_EVENT_NAMES = [
  "notification.sent",
  "notification.created",
  "new-notification",
  "App\\Events\\UserNotificationCreated",
  "App\\Events\\NotificationCreated",
];

const readRuntimeEnv = (key: string): string => {
  const fromProcess =
    typeof process !== "undefined" ? String((process as any)?.env?.[key] || "").trim() : "";
  const fromExtra = String(runtimeExtra?.[key] || "").trim();
  return fromProcess || fromExtra;
};

const readRuntimeFlag = (key: string, fallback = false): boolean => {
  const raw = readRuntimeEnv(key);
  if (!raw) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
};

const PUSHER_KEY = readRuntimeEnv("EXPO_PUBLIC_PUSHER_APP_KEY");
const PUSHER_CLUSTER = readRuntimeEnv("EXPO_PUBLIC_PUSHER_APP_CLUSTER") || "mt1";
const PUSHER_HOST = readRuntimeEnv("EXPO_PUBLIC_PUSHER_HOST");
const PUSHER_WS_HOST = readRuntimeEnv("EXPO_PUBLIC_PUSHER_WS_HOST");
const PUSHER_WS_PORT = Number(readRuntimeEnv("EXPO_PUBLIC_PUSHER_WS_PORT") || 80);
const PUSHER_WSS_PORT = Number(readRuntimeEnv("EXPO_PUBLIC_PUSHER_WSS_PORT") || 443);
const PUSHER_FORCE_TLS = readRuntimeFlag("EXPO_PUBLIC_PUSHER_FORCE_TLS", true);
const PUSHER_AUTH_ENDPOINT =
  readRuntimeEnv("EXPO_PUBLIC_PUSHER_AUTH_ENDPOINT") ||
  (() => {
    const apiBase = readRuntimeEnv("EXPO_PUBLIC_API_BASE_URL");
    if (!apiBase) return "";
    return `${apiBase.replace(/\/+$/, "").replace(/\/api$/i, "")}/broadcasting/auth`;
  })();
const PUSHER_LOG = readRuntimeFlag("EXPO_PUBLIC_LOG_PUSHER", true);

const logPusher = (event: string, payload?: Record<string, unknown>) => {
  if (!PUSHER_LOG) return;
  console.log(`[Pusher] ${event}`, payload || {});
};

const unwrapRealtimePayload = (kind: SubscriptionKind, payload: any) => {
  if (kind === "notifications") {
    return payload?.notification ?? payload?.data ?? payload;
  }
  return payload?.data ?? payload;
};

const getConnectionState = () => {
  try {
    return (pusherInstance as any)?.connection?.state || "unknown";
  } catch {
    return "unknown";
  }
};

const describeConfig = () => ({
  keyPresent: !!PUSHER_KEY,
  cluster: PUSHER_CLUSTER,
  host: PUSHER_HOST || null,
  wsHost: PUSHER_WS_HOST || null,
  wsPort: PUSHER_WS_PORT,
  wssPort: PUSHER_WSS_PORT,
  forceTLS: PUSHER_FORCE_TLS,
  authEndpoint: PUSHER_AUTH_ENDPOINT || null,
});

const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
  if (timer) clearTimeout(timer);
};

const bindChannelEvents = (channel: Channel, entry: SubscriptionEntry) => {
  entry.eventNames.forEach((eventName) => {
    const handler = (payload: any) => {
      logPusher("event.received", {
        kind: entry.kind,
        channel: entry.channelName,
        event: eventName,
        keys: payload && typeof payload === "object" ? Object.keys(payload) : [],
      });
      entry.callback(unwrapRealtimePayload(entry.kind, payload));
    };
    entry.boundHandlers.set(eventName, handler);
    channel.bind(eventName, handler);
  });
};

const unbindChannelEvents = (channel: Channel, entry: SubscriptionEntry) => {
  entry.boundHandlers.forEach((handler, eventName) => {
    channel.unbind(eventName, handler);
  });
  entry.boundHandlers.clear();
};

const subscribeRegistryEntry = (entry: SubscriptionEntry) => {
  if (!pusherInstance) return;
  const channel = pusherInstance.subscribe(entry.channelName);
  bindChannelEvents(channel, entry);
  logPusher("subscription.requested", {
    kind: entry.kind,
    channel: entry.channelName,
    connectionState: getConnectionState(),
  });
};

const resubscribeAll = () => {
  if (!pusherInstance) return;
  subscriptionRegistry.forEach((entry) => {
    try {
      const existing = pusherInstance?.channel(entry.channelName);
      if (existing) {
        unbindChannelEvents(existing, entry);
        pusherInstance?.unsubscribe(entry.channelName);
      }
      subscribeRegistryEntry(entry);
    } catch (error: any) {
      logPusher("subscription.resubscribe_failed", {
        channel: entry.channelName,
        error: error?.message || String(error),
      });
    }
  });
};

const recreatePusher = (reason: string) => {
  if (recreateInFlight) return;
  recreateInFlight = true;
  clearTimer(recreateTimer);
  recreateTimer = setTimeout(() => {
    try {
      logPusher("recreate.begin", { reason, previousState: getConnectionState() });
      if (pusherInstance) {
        try {
          pusherInstance.disconnect();
        } catch {
          // ignore disconnect errors
        }
      }
      pusherInstance = null;
      connectionListenersBound = false;
      const instance = getPusher();
      if (instance) {
        resubscribeAll();
        try {
          instance.connect();
        } catch {
          // ignore connect errors
        }
      }
    } finally {
      recreateInFlight = false;
    }
  }, 250);
};

const scheduleReconnect = (reason: string) => {
  clearTimer(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!pusherInstance) {
      recreatePusher(`${reason}:missing_instance`);
      return;
    }
    const state = getConnectionState();
    logPusher("reconnect.attempt", { reason, state });
    if (state === "connected" || state === "connecting") return;
    try {
      pusherInstance.connect();
      resubscribeAll();
    } catch (error: any) {
      logPusher("reconnect.failed", {
        reason,
        state,
        error: error?.message || String(error),
      });
      recreatePusher(`${reason}:connect_failed`);
    }
  }, 150);
};

const bindConnectionListeners = (instance: Pusher) => {
  if (connectionListenersBound) return;
  connectionListenersBound = true;

  instance.connection.bind("state_change", (states: any) => {
    logPusher("connection.state_change", {
      previous: states?.previous,
      current: states?.current,
      subscriptions: subscriptionRegistry.size,
    });
    if (states?.current === "connected") {
      resubscribeAll();
    }
  });

  instance.connection.bind("connected", () => {
    logPusher("connection.connected", { subscriptions: subscriptionRegistry.size });
  });

  instance.connection.bind("connecting", () => {
    logPusher("connection.connecting", {});
  });

  instance.connection.bind("disconnected", () => {
    logPusher("connection.disconnected", {});
    if (AppState.currentState === "active") {
      scheduleReconnect("disconnected");
    }
  });

  instance.connection.bind("unavailable", () => {
    logPusher("connection.unavailable", {});
    if (AppState.currentState === "active") {
      scheduleReconnect("unavailable");
    }
  });

  instance.connection.bind("error", (error: any) => {
    logPusher("connection.error", {
      type: error?.type || null,
      data: error?.data || null,
      message: error?.error?.message || error?.message || null,
    });
  });
};

const ensureAppStateListener = () => {
  if (appStateListenerAttached) return;
  appStateListenerAttached = true;

  AppState.addEventListener("change", (nextState) => {
    logPusher("app_state.change", { previous: lastAppState, current: nextState });
    const becameActive =
      (lastAppState === "background" || lastAppState === "inactive") && nextState === "active";
    lastAppState = nextState;

    if (becameActive) {
      scheduleReconnect("app_resumed");
    }
  });
};

function getPusher(): Pusher | null {
  if (!PUSHER_KEY) {
    logPusher("config.missing_key", describeConfig());
    return null;
  }

  ensureAppStateListener();

  if (pusherInstance) return pusherInstance;

  logPusher("init", describeConfig());
  pusherInstance = new Pusher(PUSHER_KEY, {
    cluster: PUSHER_CLUSTER,
    forceTLS: PUSHER_FORCE_TLS,
    enabledTransports: ["ws", "wss"],
    wsHost: PUSHER_WS_HOST || PUSHER_HOST || undefined,
    httpHost: PUSHER_HOST || undefined,
    wsPort: Number.isFinite(PUSHER_WS_PORT) ? PUSHER_WS_PORT : 80,
    wssPort: Number.isFinite(PUSHER_WSS_PORT) ? PUSHER_WSS_PORT : 443,
    authEndpoint: PUSHER_AUTH_ENDPOINT || undefined,
    activityTimeout: 30000,
    pongTimeout: 15000,
    unavailableTimeout: 10000,
  });

  bindConnectionListeners(pusherInstance);
  return pusherInstance;
}

const registerSubscription = (
  channelName: string,
  eventNames: string[],
  callback: (data: any) => void,
  kind: SubscriptionKind
): { channel: Channel | null; unsubscribe: Unsubscribe } => {
  const pusher = getPusher();
  if (!pusher || !channelName) {
    logPusher("subscription.skipped", { kind, channel: channelName || null, config: describeConfig() });
    return { channel: null, unsubscribe: () => {} };
  }

  const key = `${kind}:${channelName}:${eventNames.join("|")}`;
  const entry: SubscriptionEntry = {
    channelName,
    eventNames,
    callback,
    boundHandlers: new Map<string, (payload: any) => void>(),
    kind,
  };
  subscriptionRegistry.set(key, entry);
  subscribeRegistryEntry(entry);

  return {
    channel: pusher.channel(channelName) || null,
    unsubscribe: () => {
      const current = subscriptionRegistry.get(key);
      if (!current) return;
      const channel = pusher.channel(channelName);
      if (channel) {
        unbindChannelEvents(channel, current);
        pusher.unsubscribe(channelName);
      }
      subscriptionRegistry.delete(key);
      logPusher("subscription.removed", {
        kind,
        channel: channelName,
        remainingSubscriptions: subscriptionRegistry.size,
      });
    },
  };
};

export function subscribeToChat(
  conversationId: number,
  onMessage: (data: any) => void
): { channel: Channel | null; unsubscribe: Unsubscribe } {
  const normalized = Number(conversationId);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    logPusher("chat.invalid_conversation", { conversationId });
    return { channel: null, unsubscribe: () => {} };
  }

  // Primary backend broadcast channel.
  return registerSubscription(`chat.${normalized}`, CHAT_EVENT_NAMES, onMessage, "chat");
}

export function subscribeToNotifications(
  userId: string | number,
  onMessage: (data: any) => void
): { channel: Channel | null; unsubscribe: Unsubscribe } {
  const normalized = String(userId || "").trim();
  if (!normalized) {
    logPusher("notifications.invalid_user", { userId });
    return { channel: null, unsubscribe: () => {} };
  }

  return registerSubscription(
    `notifications.${normalized}`,
    NOTIFICATION_EVENT_NAMES,
    onMessage,
    "notifications"
  );
}

export function reconnectPusher(reason = "manual"): void {
  scheduleReconnect(reason);
}

export function getPusherDiagnostics() {
  return {
    connectionState: getConnectionState(),
    subscriptions: Array.from(subscriptionRegistry.values()).map((entry) => ({
      channel: entry.channelName,
      kind: entry.kind,
      events: entry.eventNames,
    })),
    config: describeConfig(),
  };
}

export function disconnectPusher(): void {
  clearTimer(reconnectTimer);
  clearTimer(recreateTimer);
  reconnectTimer = null;
  recreateTimer = null;

  if (!pusherInstance) return;
  logPusher("disconnect.manual", { connectionState: getConnectionState() });

  subscriptionRegistry.forEach((entry) => {
    const channel = pusherInstance?.channel(entry.channelName);
    if (channel) {
      unbindChannelEvents(channel, entry);
      pusherInstance?.unsubscribe(entry.channelName);
    }
  });

  pusherInstance.disconnect();
  pusherInstance = null;
  connectionListenersBound = false;
}
