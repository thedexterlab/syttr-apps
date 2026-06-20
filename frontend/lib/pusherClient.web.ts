import Pusher from "pusher-js";

type Channel = any;
type Unsubscribe = () => void;

let pusherInstance: Pusher | null = null;

const PUSHER_KEY = process.env.EXPO_PUBLIC_PUSHER_APP_KEY || "";
const PUSHER_CLUSTER = process.env.EXPO_PUBLIC_PUSHER_APP_CLUSTER || "mt1";

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
  "App\\Events\\NotificationCreated",
];

function unwrapRealtimePayload(kind: "chat" | "notifications", payload: any) {
  if (kind === "notifications") {
    return payload?.notification ?? payload?.data ?? payload;
  }
  return payload?.data ?? payload;
}

function getPusher(): Pusher | null {
  if (!PUSHER_KEY) return null;
  if (pusherInstance) return pusherInstance;

  pusherInstance = new Pusher(PUSHER_KEY, {
    cluster: PUSHER_CLUSTER,
    forceTLS: true,
    enabledTransports: ["ws", "wss"],
  });

  return pusherInstance;
}

function bindMany(channel: Channel, names: string[], cb: (data: any) => void) {
  names.forEach((eventName) => {
    const kind = names === NOTIFICATION_EVENT_NAMES ? "notifications" : "chat";
    channel.bind(eventName, (payload: any) => cb(unwrapRealtimePayload(kind, payload)));
  });
}

function unbindMany(channel: Channel, names: string[], cb: (data: any) => void) {
  names.forEach((eventName) => channel.unbind(eventName, cb));
}

export function subscribeToChat(
  conversationId: number,
  onMessage: (data: any) => void
): { channel: Channel | null; unsubscribe: Unsubscribe } {
  const pusher = getPusher();
  if (!pusher || !conversationId) return { channel: null, unsubscribe: () => {} };

  const channels = [
    `chat.${conversationId}`,
    `private-chat.${conversationId}`,
    `conversation.${conversationId}`,
  ];
  const channel = pusher.subscribe(channels[0]);
  bindMany(channel, CHAT_EVENT_NAMES, onMessage);

  const extra = channels.slice(1).map((name) => pusher.subscribe(name));
  extra.forEach((ch) => bindMany(ch, CHAT_EVENT_NAMES, onMessage));

  const unsubscribe = () => {
    unbindMany(channel, CHAT_EVENT_NAMES, onMessage);
    pusher.unsubscribe(channels[0]);
    extra.forEach((ch, idx) => {
      unbindMany(ch, CHAT_EVENT_NAMES, onMessage);
      pusher.unsubscribe(channels[idx + 1]);
    });
  };

  return { channel, unsubscribe };
}

export function subscribeToNotifications(
  userId: string | number,
  onMessage: (data: any) => void
): { channel: Channel | null; unsubscribe: Unsubscribe } {
  const pusher = getPusher();
  const normalized = String(userId || "").trim();
  if (!pusher || !normalized) return { channel: null, unsubscribe: () => {} };

  const channels = [
    `notifications.${normalized}`,
    `private-notifications.${normalized}`,
    `user.${normalized}.notifications`,
  ];
  const channel = pusher.subscribe(channels[0]);
  bindMany(channel, NOTIFICATION_EVENT_NAMES, onMessage);

  const extra = channels.slice(1).map((name) => pusher.subscribe(name));
  extra.forEach((ch) => bindMany(ch, NOTIFICATION_EVENT_NAMES, onMessage));

  const unsubscribe = () => {
    unbindMany(channel, NOTIFICATION_EVENT_NAMES, onMessage);
    pusher.unsubscribe(channels[0]);
    extra.forEach((ch, idx) => {
      unbindMany(ch, NOTIFICATION_EVENT_NAMES, onMessage);
      pusher.unsubscribe(channels[idx + 1]);
    });
  };

  return { channel, unsubscribe };
}

export function disconnectPusher(): void {
  if (!pusherInstance) return;
  pusherInstance.disconnect();
  pusherInstance = null;
}
