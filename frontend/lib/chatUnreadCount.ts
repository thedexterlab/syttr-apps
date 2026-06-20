import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest, sanitizeToken } from "../app/Api";

const toRows = (payload: any): any[] => {
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.conversations)) return payload.conversations;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
};

export async function fetchUnreadConversationCount(): Promise<number> {
  const [tokenRaw, userIdRaw, nannyIdRaw] = await Promise.all([
    AsyncStorage.getItem("token"),
    AsyncStorage.getItem("user_id"),
    AsyncStorage.getItem("nanny_id"),
  ]);

  const token = sanitizeToken(tokenRaw || undefined);
  const userId = String(userIdRaw || "").trim();
  const nannyId = String(nannyIdRaw || "").trim();

  const payloads: Record<string, any>[] = [];
  if (token) payloads.push({});
  if (userId) payloads.push({ user_id: userId });
  if (nannyId) payloads.push({ nanny_id: nannyId });
  if (!payloads.length) payloads.push({});

  let rows: any[] = [];
  for (let i = 0; i < payloads.length; i += 1) {
    try {
      const json = await apiRequest<any>("chat/conversations/list", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payloads[i]),
      });
      const nextRows = toRows(json);
      rows = nextRows;
      if (nextRows.length > 0 || i === payloads.length - 1) break;
    } catch {
      if (i === payloads.length - 1) throw new Error("Unable to fetch unread conversations.");
    }
  }

  return rows.reduce((sum, item) => {
    const unread = Number(item?.unread ?? item?.unread_count ?? item?.unreadCount ?? 0);
    return sum + (Number.isFinite(unread) && unread > 0 ? unread : 0);
  }, 0);
}
