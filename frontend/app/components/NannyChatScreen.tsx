/// <reference types="react" />
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiRequest, BASE_URL, sanitizeToken } from "../Api";
import { getPusherDiagnostics, reconnectPusher, subscribeToChat } from "../../lib/pusherClient";
import { resolveSessionImageUrl } from "../../lib/nannySessionProfile";
import { rewriteLoopbackAbsoluteUrl } from "../../lib/urlHosts";
import { rf, rs } from "../utils/responsive";
import { DocumentPicker } from "../utils/safeDocumentPicker";
import { FileSystem, isFileSystemAvailable } from "../utils/safeFileSystem";
import { ImagePicker } from "../utils/safeImagePicker";

const API_BASE = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}`;
const STORAGE_ROOT = API_BASE.replace(/\/api\/?$/, "");

const normalizeSender = (value: any) => String(value || "").trim().toLowerCase();

const isTrueLike = (value: any) =>
  value === true ||
  value === 1 ||
  value === "1" ||
  String(value || "").toLowerCase() === "true";

const toAbsoluteAttachmentUrl = (raw: string): string => {
  const value = String(raw || "").trim().replace(/\\/g, "/");
  if (!value) return "";
  if (/^(https?:)/i.test(value)) {
    return rewriteLoopbackAbsoluteUrl(value, STORAGE_ROOT);
  }
  if (/^(blob:|file:|data:)/i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${STORAGE_ROOT}${value}`;
  if (value.startsWith("storage/") || value.startsWith("public/")) return `${STORAGE_ROOT}/${value}`;
  return `${STORAGE_ROOT}/storage/${value.replace(/^\/+/, "")}`;
};

const extractAttachment = (m: any) => {
  const urlCandidates = [
    m?.attachment_url,
    m?.attachmentUrl,
    m?.file_url,
    m?.fileUrl,
    m?.media_url,
    m?.image_url,
    m?.video_url,
    m?.document_url,
    m?.attachmentPath,
    m?.filePath,
    m?.attachment_path,
    m?.file_path,
    m?.path,
    m?.url,
    typeof m?.attachment === "string" ? m.attachment : null,
    typeof m?.file === "string" ? m.file : null,
    m?.attachment?.url,
    m?.attachment?.path,
    m?.attachment?.file_path,
    m?.file?.url,
    m?.file?.path,
    m?.file?.file_path,
  ].filter(Boolean);

  const rawUrl = urlCandidates.length ? String(urlCandidates[0]) : "";
  const attachmentUrl = rawUrl ? toAbsoluteAttachmentUrl(rawUrl) : undefined;
  const attachmentName =
    m?.attachment_name ||
    m?.file_name ||
    m?.original_name ||
    m?.attachment?.name ||
    m?.file?.name ||
    (rawUrl ? rawUrl.split("/").pop()?.split("?")[0] : undefined);
  const attachmentMime =
    m?.attachment_mime ||
    m?.attachment_type ||
    m?.mime_type ||
    m?.attachment?.type ||
    m?.file?.type;

  if (!attachmentUrl) return null;
  return { attachmentUrl, attachmentName, attachmentMime };
};

const extractMessageList = (payload: any): any[] => {
  const candidates = [
    payload?.messages,
    payload?.data?.messages,
    payload?.data?.data?.messages,
    payload?.data?.data,
    payload?.data,
    payload?.conversation?.messages,
    payload?.message?.messages,
    payload,
  ];

  for (const item of candidates) {
    if (Array.isArray(item)) return item;
  }
  return [];
};

const URL_REGEX = /((?:https?:\/\/|www\.)[^\s]+)/gi;

const isLikelyImageAttachment = (mime?: string, url?: string, name?: string) => {
  const lowerMime = String(mime || "").toLowerCase();
  if (lowerMime.startsWith("image/")) return true;
  const candidate = String(url || name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)(\?|$)/i.test(candidate);
};

const isLikelyVideoAttachment = (mime?: string, url?: string, name?: string) => {
  const lowerMime = String(mime || "").toLowerCase();
  if (lowerMime.startsWith("video/")) return true;
  const candidate = String(url || name || "").toLowerCase();
  return /\.(mp4|mov|m4v|avi|mkv|webm)(\?|$)/i.test(candidate);
};

const isLikelyDocumentAttachment = (mime?: string, url?: string, name?: string) => {
  const lowerMime = String(mime || "").toLowerCase();
  if (
    lowerMime.includes("pdf") ||
    lowerMime.includes("msword") ||
    lowerMime.includes("officedocument") ||
    lowerMime.includes("text/")
  ) {
    return true;
  }
  const candidate = String(url || name || "").toLowerCase();
  return /\.(pdf|docx?|xlsx?|pptx?|txt|rtf)(\?|$)/i.test(candidate);
};

const extractLinksFromMessage = (value?: string) => {
  const matches = String(value || "").match(URL_REGEX) || [];
  return matches.map((match) =>
    /^(https?:\/\/)/i.test(match) ? match : `https://${match}`
  );
};

const shouldHideMediaLabel = (
  message?: string,
  attachmentName?: string,
  mime?: string,
  url?: string
) => {
  const raw = String(message || "").trim();
  if (!raw) return true;
  const isMedia =
    isLikelyImageAttachment(mime, url, attachmentName) ||
    isLikelyVideoAttachment(mime, url, attachmentName);
  if (!isMedia) return false;
  const normalized = raw.toLowerCase();
  const attachmentNormalized = String(attachmentName || "").trim().toLowerCase();
  return (
    normalized === "attachment" ||
    normalized === "[attachment]" ||
    (attachmentNormalized !== "" && normalized === attachmentNormalized)
  );
};

type RouteParams = {
  conversationId?: number | string;
  nannyId?: number | string;
  userId?: number | string;
  name?: string;
  avatar?: string;
  userImage?: string;
};

type Message = {
  id?: number | string;
  message: string;
  isMe: boolean;
  time?: string;
  senderUserId?: number | string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentMime?: string;
};

type SharedItem = {
  key: string;
  kind: "media" | "doc" | "link";
  url: string;
  name: string;
  mime?: string;
  time?: string;
};

type OutgoingAttachment = {
  uri: string;
  name: string;
  mimeType?: string;
  kind: "image" | "video" | "file";
  file?: any; // used on web
};

type Props = {
  route?: { params?: RouteParams };
  navigation?: any;
  onBack?: () => void;
  onCloseChat?: () => void;
  onViewProfile?: (params: {
    nannyId?: number | string;
    userId?: number | string;
    name?: string;
  }) => void;
};

export default function NannyChatScreen({
  route,
  navigation,
  onBack,
  onCloseChat,
  onViewProfile,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isVerySmall = width <= 320;
  const isTablet = width >= 768;
  const headerIconSize = isVerySmall ? rs(30) : rs(36);
  const chatColumnMaxWidth = isTablet ? 920 : 680;
  const bubbleMaxWidth = isTablet || isLandscape ? Math.min(Math.round(width * 0.68), 500) : isVerySmall ? Math.round(width * 0.88) : "85%";
  const attachmentWidth = Math.min(isTablet ? 420 : isLandscape ? 320 : 260, Math.max(180, Math.round(width * (isTablet ? 0.42 : 0.62))));
  const attachmentHeight = Math.round(attachmentWidth * 0.68);
  const attachBtnSize = isVerySmall ? rs(32) : rs(36);
  const sendBtnSize = isVerySmall ? rs(38) : rs(42);
  const composerPadding = isVerySmall ? rs(8) : isLandscape ? rs(10) : rs(12);
  const previewTopPad = isLandscape ? rs(56) : rs(96);
  const previewBottomPad = isLandscape ? rs(16) : rs(34);
  const {
    conversationId,
    nannyId,
    userId,
    name = "Chat",
    avatar,
    userImage,
  } = route?.params || {};

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>("");
  const [attachment, setAttachment] = useState<OutgoingAttachment | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [showAttachMenu, setShowAttachMenu] = useState<boolean>(false);
  const [showChatMenu, setShowChatMenu] = useState<boolean>(false);
  const [showSharedItems, setShowSharedItems] = useState<boolean>(false);
  const [showProfilePreview, setShowProfilePreview] = useState<boolean>(false);
  const [showImagePreview, setShowImagePreview] = useState<boolean>(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string>("");
  const [convId, setConvId] = useState<number | string | undefined>(conversationId);
  const [resolvedUserId, setResolvedUserId] = useState<number | string | undefined>(
    userId
  );
  const [headerName, setHeaderName] = useState<string>(name || "Chat");
  const [resolving, setResolving] = useState<boolean>(false);
  const [role, setRole] = useState<"user" | "nanny" | null>("nanny");

  const listRef = useRef<FlatList<Message>>(null);
  const lastSendTimestamp = useRef<number>(0);
  const loadingRef = useRef<boolean>(false);
  const resolveAttemptRef = useRef<string | null>(null);

  const displayName = headerName || name || "Chat";
  const avatarSource = avatar || userImage;
  const avatarUrl = resolveSessionImageUrl(avatarSource);
  const activeConvId = convId ?? conversationId;
  const sharedItems = useMemo<SharedItem[]>(() => {
    const items: SharedItem[] = [];
    const seen = new Set<string>();

    messages.forEach((message, index) => {
      if (message.attachmentUrl) {
        const kind = isLikelyImageAttachment(
          message.attachmentMime,
          message.attachmentUrl,
          message.attachmentName
        ) || isLikelyVideoAttachment(
          message.attachmentMime,
          message.attachmentUrl,
          message.attachmentName
        )
          ? "media"
          : "doc";
        const url = message.attachmentUrl;
        const key = `${kind}:${url}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push({
            key: `${key}:${index}`,
            kind,
            url,
            name: kind === "media" ? "" : message.attachmentName || "Document",
            mime: message.attachmentMime,
            time: message.time,
          });
        }
      }

      extractLinksFromMessage(message.message).forEach((url, linkIndex) => {
        const key = `link:${url.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push({
          key: `${key}:${index}:${linkIndex}`,
          kind: "link",
          url,
          name: url,
          time: message.time,
        });
      });
    });

    return items.reverse();
  }, [messages]);
  const sharedMediaCount = sharedItems.filter((item) => item.kind === "media").length;
  const sharedDocsCount = sharedItems.filter((item) => item.kind === "doc").length;
  const sharedLinksCount = sharedItems.filter((item) => item.kind === "link").length;
  const sharedMediaItems = sharedItems.filter((item) => item.kind === "media");
  const sharedDocItems = sharedItems.filter((item) => item.kind === "doc");
  const sharedLinkItems = sharedItems.filter((item) => item.kind === "link");

  const normalizeId = (value: any): number | string | undefined => {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    if (!text || text === "undefined" || text === "null") return undefined;
    const num = Number(text);
    if (Number.isFinite(num) && num > 0) return num;
    return text;
  };

  const buildAuthHeaders = (token?: string, apiKey?: string) => ({
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  });

  const buildJsonHeaders = (token?: string, apiKey?: string) => ({
    ...buildAuthHeaders(token, apiKey),
    "Content-Type": "application/json",
  });

  const clearAttachment = (next?: OutgoingAttachment | null) => {
    setAttachment((prev) => {
      if (Platform.OS === "web" && prev?.uri && prev.uri.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(prev.uri);
        } catch {}
      }
      return next ?? null;
    });
  };

  const openAttachment = async (url?: string, name?: string, mime?: string) => {
    if (!url) return;
    const resolvedUrl = toAbsoluteAttachmentUrl(url);
    if (!resolvedUrl) return;

    if (isLikelyImageAttachment(mime, resolvedUrl, name)) {
      openImagePreview(resolvedUrl);
      return;
    }

    try {
      const shouldOpenDirectly =
        Platform.OS === "web" ||
        isLikelyDocumentAttachment(mime, resolvedUrl, name) ||
        isLikelyVideoAttachment(mime, resolvedUrl, name);
      if (shouldOpenDirectly) {
        await Linking.openURL(resolvedUrl);
        return;
      }

      if (Platform.OS !== "web" && isFileSystemAvailable()) {
        const fileName =
          String(name || resolvedUrl.split("/").pop() || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
        const baseDir =
          ((FileSystem as any)?.cacheDirectory as string | undefined) ||
          ((FileSystem as any)?.documentDirectory as string | undefined);
        const downloadAsync = (FileSystem as any)?.downloadAsync;
        if (baseDir && typeof downloadAsync === "function") {
          const fileUri = `${baseDir}${Date.now()}-${fileName}`;
          const downloaded = await downloadAsync(resolvedUrl, fileUri);
          if (downloaded?.uri) {
            try {
              await Linking.openURL(downloaded.uri);
              return;
            } catch {
              await Share.share({
                title: name || "Attachment",
                message: name || "Attachment",
                url: downloaded.uri,
              });
              return;
            }
          }
        }
      }
      await Linking.openURL(resolvedUrl);
    } catch {
      Alert.alert("Attachment", "Couldn't open that attachment.");
    }
  };

  const openImagePreview = (url?: string) => {
    const resolvedUrl = toAbsoluteAttachmentUrl(url || "");
    if (!resolvedUrl) return;
    setPreviewImageUrl(resolvedUrl);
    setShowImagePreview(true);
  };

  const closeImagePreview = () => {
    setShowImagePreview(false);
    setPreviewImageUrl("");
  };

  const openExternalUrl = async (rawUrl: string) => {
    const value = String(rawUrl || "").trim();
    if (!value) return;
    const target = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      await Linking.openURL(target);
    } catch {
      Alert.alert("Link", "Couldn't open that link.");
    }
  };

  const normalizeText = (value?: string) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  const messageFingerprint = (message: Message) =>
    [
      normalizeText(message.message),
      String(message.attachmentUrl || "").split("?")[0].toLowerCase(),
      message.isMe ? "me" : "other",
    ].join("|");

  const mergeMessage = (base: Message, incoming: Message): Message => ({
    ...base,
    ...incoming,
    id: incoming.id ?? base.id,
    message: incoming.message || base.message,
    time: incoming.time || base.time,
    attachmentUrl: incoming.attachmentUrl || base.attachmentUrl,
    attachmentName: incoming.attachmentName || base.attachmentName,
    attachmentMime: incoming.attachmentMime || base.attachmentMime,
  });

  const upsertMessage = (prev: Message[], incoming: Message) => {
    if (incoming.id !== undefined && incoming.id !== null) {
      const idIndex = prev.findIndex((m) => m.id !== undefined && String(m.id) === String(incoming.id));
      if (idIndex >= 0) {
        const existing = prev[idIndex];
        const sameFingerprint = messageFingerprint(existing) === messageFingerprint(incoming);
        const sameTimestamp =
          !incoming.time || !existing.time || incoming.time === existing.time;

        if (sameFingerprint && sameTimestamp) {
          const next = [...prev];
          next[idIndex] = mergeMessage(existing, incoming);
          return next;
        }

        return [...prev, incoming];
      }
    }

    const incomingFingerprint = messageFingerprint(incoming);
    const duplicateIndex = prev.findIndex((m) => {
      const sameFingerprint = messageFingerprint(m) === incomingFingerprint;
      if (!sameFingerprint) return false;
      if (incoming.time && m.time) return incoming.time === m.time;
      return true;
    });

    if (duplicateIndex >= 0) {
      const next = [...prev];
      next[duplicateIndex] = mergeMessage(next[duplicateIndex], incoming);
      return next;
    }

    return [...prev, incoming];
  };

  /* ----------------------------- LOAD MESSAGES ----------------------------- */

  const loadMessages = async (options?: { silent?: boolean }) => {
    if (!activeConvId) {
      setMessages([]);
      loadingRef.current = false;
      setLoading(false);
      return;
    }

    if (loadingRef.current) return;

    loadingRef.current = true;
    setLoading(true);

    try {
      const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
      const apiKey = String((await AsyncStorage.getItem("api_key")) || "").trim() || undefined;
      const currentNannyId = normalizeId(
        nannyId || (await AsyncStorage.getItem("nanny_id"))
      );
      const targetUserId = normalizeId(resolvedUserId || userId);

      if (!currentNannyId) {
        console.error("[NannyChat] Missing nanny_id");
        Alert.alert("Error", "Nanny ID not found");
        return;
      }

      const body: any = {
        id: activeConvId,
        conversation_id: activeConvId,
        nanny_id: currentNannyId,
      };

      if (targetUserId) body.user_id = targetUserId;

      console.log("[NannyChat LOAD] Sending payload:", body);

      const json = await apiRequest<any>("chat/messages", {
        method: "POST",
        headers: buildJsonHeaders(token, apiKey),
        body: JSON.stringify(body),
      });
      const raw: any[] = extractMessageList(json);

      const normalized = raw.map((m) =>
        normalizeMessage(m, currentNannyId, role ?? "nanny")
      );
      // Preserve full server history order; older payloads can contain
      // repeated/non-unique ids which would collapse valid messages.
      setMessages(normalized);
      if (!targetUserId) {
        const inferredEntry = raw.find(
          (m) => m?.user_id || m?.sender_user_id || m?.client_id
        );
        const inferredUserId = normalizeId(
          inferredEntry?.user_id ||
            inferredEntry?.sender_user_id ||
            inferredEntry?.client_id
        );
        if (inferredUserId) {
          setResolvedUserId(inferredUserId);
        }
      }
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e) {
      console.error("[NannyChat] load error", e instanceof Error ? e.message : e);
      if (!options?.silent) {
        Alert.alert("Chat", "Unable to load messages.");
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMessages();
  }, [activeConvId, nannyId, resolvedUserId, role]);

  useEffect(() => {
    if (conversationId && !convId) {
      setConvId(conversationId);
    }
  }, [conversationId]);

  useEffect(() => {
    if (userId) {
      setResolvedUserId(userId);
    }
  }, [userId]);

  useEffect(() => {
    setHeaderName(name || "Chat");
  }, [name]);

  useEffect(() => {
    (async () => {
      try {
        const typeRaw = await AsyncStorage.getItem("user_type");
        const type = typeRaw ? typeRaw.toLowerCase() : "";
        if (type === "nanny") {
          setRole("nanny");
          return;
        }
        if (type) {
          setRole("user");
          return;
        }
        const [storedUserId, storedNannyId] = await Promise.all([
          AsyncStorage.getItem("user_id"),
          AsyncStorage.getItem("nanny_id"),
        ]);
        if (storedNannyId && !storedUserId) {
          setRole("nanny");
        } else if (storedUserId) {
          setRole("user");
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    void resolveConversationId();
  }, [convId, conversationId, nannyId, userId, resolvedUserId]);

  const resolveConversationId = async (): Promise<void> => {
    try {
      const token = sanitizeToken((await AsyncStorage.getItem("token")) || undefined);
      const currentNannyId = normalizeId(
        nannyId || (await AsyncStorage.getItem("nanny_id"))
      );
      if (!currentNannyId) return;

      const targetUserId = normalizeId(resolvedUserId || userId);
      const requestedConversationId = normalizeId(convId ?? conversationId);
      const resolveKey = `${String(currentNannyId)}-${String(
        targetUserId || ""
      )}-${String(requestedConversationId || "")}`;
      if (resolveAttemptRef.current === resolveKey) return;
      resolveAttemptRef.current = resolveKey;

      setResolving(true);
      const payload: Record<string, any> = { nanny_id: currentNannyId };
      if (targetUserId) {
        payload.user_id = targetUserId;
      }

      const json = await apiRequest<any>("chat/conversations/list", {
        method: "POST",
        headers: buildJsonHeaders(token),
        body: JSON.stringify(payload),
      });
      const list: any[] = Array.isArray(json?.data?.data)
        ? json.data.data
        : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.conversations)
        ? json.conversations
        : Array.isArray(json)
        ? json
        : [];
      const validList = list.filter((c) => {
        const u = normalizeId(c?.user_id || c?.userId || c?.user?.id);
        const n = normalizeId(c?.nanny_id || c?.nannyId || c?.nanny?.id);
        return !(u && n && String(u) === String(n));
      });

      const match = targetUserId
        ? validList.find(
            (c) =>
              normalizeId(c?.user_id || c?.userId || c?.user?.id) === targetUserId &&
              normalizeId(c?.nanny_id || c?.nannyId || c?.nanny?.id) ===
                currentNannyId
          )
        : null;
      const fallback =
        match ||
        (targetUserId
          ? validList.find(
              (c) =>
                normalizeId(c?.user_id || c?.userId || c?.user?.id) ===
                targetUserId
            )
          : null) ||
        (!targetUserId && validList.length === 1 ? validList[0] : null);

      const nextConversationId = normalizeId(
        fallback?.conversation_id || fallback?.id || fallback?.chat_id
      );
      const nextUserId = normalizeId(
        fallback?.user_id || fallback?.userId || fallback?.user?.id
      );
      const fallbackName = String(
        fallback?.name ||
          fallback?.contact_name ||
          fallback?.user?.fullname ||
          fallback?.user?.name ||
          fallback?.parent?.fullname ||
          fallback?.parent?.name ||
          ""
      ).trim();
      if (fallbackName) {
        setHeaderName(fallbackName);
      }
      if (nextUserId) {
        setResolvedUserId(nextUserId);
      }
      if (
        nextConversationId &&
        String(nextConversationId) !== String(requestedConversationId || "")
      ) {
        setConvId(nextConversationId);
      }
    } catch (e) {
      console.log("[NannyChat] resolve conversation error", e);
    } finally {
      setResolving(false);
    }
  };

  /* ----------------------------- PUSHER ----------------------------- */

  useEffect(() => {
    if (!activeConvId) return;

    const convIdNum = Number(activeConvId);
    if (!Number.isFinite(convIdNum)) return;

    let unsubscribe: (() => void) | undefined;

    (async () => {
      const currentNannyId = nannyId || (await AsyncStorage.getItem("nanny_id"));
      if (!currentNannyId) return;

      const { unsubscribe: off } = subscribeToChat(convIdNum, (chat) => {
        if (!chat) return;

        const incoming = normalizeMessage(chat, currentNannyId, role ?? "nanny");

        setMessages((prev) => upsertMessage(prev, incoming));

        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 40);
      });

      unsubscribe = off;
    })();

    return () => unsubscribe?.();
  }, [activeConvId, nannyId, role]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        console.log("[NannyChat] app resumed, forcing Pusher reconnect", getPusherDiagnostics());
        reconnectPusher("nanny_chat_resumed");
      }
    });
    return () => sub.remove();
  }, []);

  /* ----------------------------- SEND MESSAGE ----------------------------- */

  const send = async () => {
    const text = input.trim();
    if (!text && !attachment) return;
    if (sending) return;

    const now = Date.now();
    if (now - lastSendTimestamp.current < 800) return;
    lastSendTimestamp.current = now;

    setSending(true);

    try {
      const token = (await AsyncStorage.getItem("token")) || undefined;
      const apiKey = await AsyncStorage.getItem("api_key") || undefined;
      const currentNannyId = normalizeId(
        nannyId || (await AsyncStorage.getItem("nanny_id"))
      );
      const targetUserId = normalizeId(resolvedUserId || userId);

      if (!currentNannyId) throw new Error("Missing nanny id");
      if (!targetUserId) throw new Error("Missing user id");
      if (String(currentNannyId) === String(targetUserId)) {
        throw new Error("Cannot start chat with the same account.");
      }

      const commonPayload = {
        conversation_id: activeConvId,
        user_id: targetUserId,
        nanny_id: currentNannyId,
        sender: "nanny",   // nanny screen hai to sender hamesha nanny
        message: text,
      };

      if (attachment) {
        const form = new FormData();
        Object.entries(commonPayload).forEach(([key, value]) => {
          form.append(key, String(value));
        });
        form.append("message", text);

        const fileName = attachment.name || "attachment";
        const mimeType = attachment.mimeType || "application/octet-stream";

        if (Platform.OS === "web") {
          let file: any = attachment.file;
          if (!file && attachment.uri) {
            const blob = await fetch(attachment.uri).then((r) => r.blob());
            file = new File([blob], fileName, { type: mimeType });
          }
          if (file) form.append("file", file);
        } else {
          form.append("file", { uri: attachment.uri, name: fileName, type: mimeType } as any);
        }

        const json = await apiRequest<any>("chat/messages/send", {
          method: "POST",
          headers: buildAuthHeaders(token, apiKey),
          body: form as any,
        });
        if (json?.success === false) {
          throw new Error(json?.message || json?.error || "Failed to send");
        }

        if (json?.conversation_id && !convId) {
          setConvId(json.conversation_id);
        }

        const payload = json?.message || json?.data || json;
        const sent = normalizeMessage(payload, currentNannyId, role ?? "nanny");
        const sentWithFallback =
          !sent.attachmentUrl && attachment
            ? {
                ...sent,
                attachmentUrl: attachment.uri,
                attachmentName: attachment.name,
                attachmentMime: attachment.mimeType,
              }
            : sent;

        setMessages((prev) => upsertMessage(prev, sentWithFallback));
      } else {
        const json = await apiRequest<any>("chat/messages/send", {
          method: "POST",
          headers: buildJsonHeaders(token, apiKey),
          body: JSON.stringify(commonPayload),
        });
        if (json?.success === false) {
          throw new Error(json?.message || json?.error || "Failed to send");
        }

        if (json?.conversation_id && !convId) {
          setConvId(json.conversation_id);
        }

        const payload = json?.message || json?.data || json;
        const sent = normalizeMessage(payload, currentNannyId, role ?? "nanny");
        setMessages((prev) => upsertMessage(prev, sent));
      }

      setInput("");
      clearAttachment(null);

      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      console.error("[NannyChat] send error", e instanceof Error ? e.message : e);
      Alert.alert("Chat", "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  /* ----------------------------- ATTACHMENT PICKERS ----------------------------- */

  const pickMedia = async (): Promise<void> => {
    if (Platform.OS === "web") {
      if (typeof document === "undefined") {
        Alert.alert("Attachment", "Not supported on this platform yet.");
        return;
      }
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,video/*";
      input.onchange = (event: any) => {
        const file = event.target?.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const kind: OutgoingAttachment["kind"] = String(file.type).startsWith("video/")
          ? "video"
          : "image";
        clearAttachment({
          uri: url,
          name: file.name || (kind === "video" ? "video.mp4" : "image.jpg"),
          mimeType: file.type || undefined,
          kind,
          file,
        });
      };
      input.click();
      return;
    }

    const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!lib.granted) {
      Alert.alert("Permission", "Gallery access is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: [ImagePicker.MediaType.Images, ImagePicker.MediaType.Videos] as any,
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    const kind: OutgoingAttachment["kind"] =
      (asset as any).type === "video" ? "video" : "image";
    clearAttachment({
      uri: asset.uri,
      name: (asset as any).fileName || (kind === "video" ? "video.mp4" : "image.jpg"),
      mimeType: (asset as any).mimeType || (kind === "video" ? "video/mp4" : "image/jpeg"),
      kind,
    });
  };

  const pickFile = async (): Promise<void> => {
    if (Platform.OS === "web") {
      if (typeof document === "undefined") {
        Alert.alert("Attachment", "Not supported on this platform yet.");
        return;
      }
      const input = document.createElement("input");
      input.type = "file";
      input.onchange = (event: any) => {
        const file = event.target?.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        clearAttachment({
          uri: url,
          name: file.name || "attachment",
          mimeType: file.type || undefined,
          kind: "file",
          file,
        });
      };
      input.click();
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: "*/*",
      });
      const canceled = result?.canceled ?? (result as any)?.type === "cancel";
      if (canceled) return;
      const asset = (result as any)?.assets?.[0] || result;
      if (!asset?.uri) return;
      clearAttachment({
        uri: asset.uri,
        name: asset?.name || "attachment",
        mimeType: asset?.mimeType || asset?.type || undefined,
        kind: "file",
      });
    } catch {
      Alert.alert("Attachment", "Could not open file picker.");
    }
  };

  const handleAttach = (): void => setShowAttachMenu(true);
  const closeAttachMenu = (): void => setShowAttachMenu(false);
  const runAttachAction = (fn: () => void) => {
    setShowAttachMenu(false);
    if (Platform.OS === "web") return fn();
    setTimeout(fn, 60);
  };

  const closeChatMenu = (): void => setShowChatMenu(false);
  const openChatMenu = (): void => {
    if (showChatMenu) return;
    setTimeout(() => setShowChatMenu(true), 0);
  };

  const runChatAction = (fn: () => void) => {
    setShowChatMenu(false);
    if (Platform.OS === "web") return fn();
    setTimeout(fn, 60);
  };

  const handleCloseChat = () => {
    if (onCloseChat) return onCloseChat();
    if (onBack) return onBack();
    navigation?.goBack?.();
  };

  const handleViewProfile = () => {
    if (onViewProfile) {
      onViewProfile({
        nannyId,
        userId,
        name: displayName,
      });
      return;
    }
    setShowProfilePreview(true);
  };

  const openSharedItem = (item: SharedItem) => {
    if (item.kind === "link") {
      void openExternalUrl(item.url);
      return;
    }
    if (item.kind === "media" && isLikelyImageAttachment(item.mime, item.url, item.name)) {
      openImagePreview(item.url);
      return;
    }
    void openAttachment(item.url, item.name, item.mime);
  };

  const renderSharedItem = ({ item }: { item: SharedItem }) => (
    <TouchableOpacity
      style={styles.sharedItemRow}
      activeOpacity={0.88}
      onPress={() => openSharedItem(item)}
    >
      <View style={styles.sharedItemIcon}>
        <Ionicons
          name={
            item.kind === "link"
              ? "link-outline"
              : item.kind === "media"
              ? isLikelyVideoAttachment(item.mime, item.url, item.name)
                ? "videocam-outline"
                : "image-outline"
              : "document-outline"
          }
          size={18}
          color="#AD1457"
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.sharedItemTitle} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.sharedItemMeta} numberOfLines={1}>
          {item.kind === "media" ? "Media" : item.kind === "doc" ? "Document" : "Link"}
          {item.time ? ` • ${item.time}` : ""}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderSharedMediaTile = ({ item }: { item: SharedItem }) => {
    const isVideo = isLikelyVideoAttachment(item.mime, item.url, item.name);
    const tileSize = Math.max(92, Math.floor((Math.min(width, chatColumnMaxWidth) - rs(56)) / 3));
    return (
      <TouchableOpacity
        style={[styles.sharedMediaTile, { width: tileSize, height: tileSize }]}
        activeOpacity={0.88}
        onPress={() => openSharedItem(item)}
      >
        {isVideo ? (
          <View style={styles.sharedMediaVideoTile}>
            <Ionicons name="videocam" size={24} color="#fff" />
          </View>
        ) : (
          <Image source={{ uri: item.url }} style={styles.sharedMediaImage} resizeMode="cover" />
        )}
        <View style={styles.sharedMediaBadge}>
          <Text style={styles.sharedMediaBadgeText}>{isVideo ? "Video" : "Image"}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const exportChatAsDoc = async () => {
    try {
      const safeName = String(displayName || "chat")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "chat";
      const fileName = `${safeName}-chat-${new Date().toISOString().slice(0, 10)}.doc`;

      const transcript = [
        "SYTTR Chat Transcript",
        `Contact: ${displayName || "Chat"}`,
        `Exported: ${new Date().toLocaleString()}`,
        "",
        ...(messages.length
          ? messages.map((m, index) => {
              const sender = m.isMe ? "You" : displayName || "Contact";
              const text =
                (m.message || "").trim() ||
                (m.attachmentName ? `[Attachment] ${m.attachmentName}` : "[No text]");
              const stamp = m.time ? `[${m.time}] ` : "";
              return `${index + 1}. ${stamp}${sender}: ${text}`;
            })
          : ["No messages in this chat yet."]),
      ].join("\n");

      if (Platform.OS === "web") {
        const blob = new Blob([transcript], { type: "application/msword;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
        return;
      }

      const writeFn = (FileSystem as any)?.writeAsStringAsync;
      const baseDir =
        ((FileSystem as any)?.cacheDirectory as string | undefined) ||
        ((FileSystem as any)?.documentDirectory as string | undefined);
      if (isFileSystemAvailable() && typeof writeFn === "function" && baseDir) {
        const fileUri = `${baseDir}${fileName}`;
        const encodingValue = (FileSystem as any)?.EncodingType?.UTF8;
        await writeFn(
          fileUri,
          transcript,
          encodingValue ? { encoding: encodingValue } : undefined
        );
        await Share.share({
          title: "Export Chat",
          message: `Exported chat: ${fileName}`,
          url: fileUri,
        });
        return;
      }

      await Share.share({
        title: "Export Chat",
        message: transcript,
      });
    } catch (e: any) {
      Alert.alert("Export failed", e?.message || "Could not export chat right now.");
    }
  };

  /* ----------------------------- RENDER MESSAGE ----------------------------- */

  const renderLinkedMessage = (text: string, isMe: boolean) => {
    const raw = String(text || "");
    const segments = raw.split(URL_REGEX);
    if (segments.length <= 1) {
      return (
        <Text style={[styles.bubbleText, styles.bubbleTextWeb, { color: isMe ? "#fff" : "#880E4F" }]}>
          {raw}
        </Text>
      );
    }

    return (
      <Text style={[styles.bubbleText, styles.bubbleTextWeb, { color: isMe ? "#fff" : "#880E4F" }]}>
        {segments.map((segment, idx) => {
          const isLink = /^(?:https?:\/\/|www\.)/i.test(segment);
          if (!isLink) return segment;
          return (
            <Text
              key={`link-${idx}`}
              style={[
                styles.linkText,
                isMe ? styles.linkTextMe : styles.linkTextOther,
              ]}
              onPress={() => void openExternalUrl(segment)}
            >
              {segment}
            </Text>
          );
        })}
      </Text>
    );
  };

  const renderItem = useCallback(({ item }: { item: Message }) => {
    const isMe = item.isMe;

    return (
      <View
        style={[
          styles.bubbleRow,
          { justifyContent: isMe ? "flex-end" : "flex-start" },
        ]}
      >
        <View
          style={[
            styles.bubble,
            isMe ? styles.bubbleMe : styles.bubbleOther,
            { alignSelf: isMe ? "flex-end" : "flex-start" },
            { maxWidth: bubbleMaxWidth as any },
          ]}
        >
          {item.message &&
          !shouldHideMediaLabel(
            item.message,
            item.attachmentName,
            item.attachmentMime,
            item.attachmentUrl
          ) ? (
            renderLinkedMessage(item.message, isMe)
          ) : null}

          {item.attachmentUrl ? (
            isLikelyImageAttachment(item.attachmentMime, item.attachmentUrl, item.attachmentName) ? (
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.attachmentImageWrap}
                onPress={() => openImagePreview(item.attachmentUrl)}
              >
                <Image
                  source={{ uri: item.attachmentUrl }}
                  style={[styles.attachmentImage, { width: attachmentWidth, height: attachmentHeight }]}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.attachmentRow}
                onPress={() =>
                  openAttachment(item.attachmentUrl, item.attachmentName, item.attachmentMime)
                }
              >
                <Ionicons
                  name={
                    isLikelyVideoAttachment(item.attachmentMime, item.attachmentUrl, item.attachmentName)
                      ? "videocam"
                      : "document-attach"
                  }
                  size={16}
                  color={isMe ? "#fff" : "#AD1457"}
                />
                <Text
                  style={[
                    styles.attachmentText,
                    { color: isMe ? "#fff" : "#AD1457" },
                  ]}
                  numberOfLines={1}
                >
                  {item.attachmentName || "Attachment"}
                </Text>
              </TouchableOpacity>
            )
          ) : null}

          {item.time ? (
            <Text
              style={[
                styles.time,
                { color: isMe ? "#fff" : "#AD1457" },
              ]}
            >
              {item.time}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }, [openImagePreview, openAttachment, openExternalUrl, bubbleMaxWidth, attachmentWidth, attachmentHeight]);

  /* ----------------------------- UI ----------------------------- */

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={[styles.header, { paddingTop: rs(4) }]}>
        <TouchableOpacity
          onPress={() => {
            if (onBack) onBack();
            else navigation?.goBack?.();
          }}
          style={[styles.headerIcon, { width: headerIconSize, height: headerIconSize, borderRadius: headerIconSize / 2 }]}
        >
          <Ionicons name="chevron-back" size={20} color="#AD1457" />
        </TouchableOpacity>

        <View style={[styles.avatarCircle, { width: headerIconSize, height: headerIconSize, borderRadius: headerIconSize / 2 }]}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={[styles.headerAvatarImage, { width: headerIconSize, height: headerIconSize, borderRadius: headerIconSize / 2 }]} />
          ) : (
            <Ionicons name="person" size={20} color="#FF80AB" />
          )}
        </View>

        <View style={{ flex: 1, marginLeft: rs(10) }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayName}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.headerIcon, { width: headerIconSize, height: headerIconSize, borderRadius: headerIconSize / 2 }]}
          onPress={openChatMenu}
        >
          <Ionicons
            name="ellipsis-vertical"
            size={18}
            color="#AD1457"
          />
        </TouchableOpacity>
      </View>

      <Modal
        visible={showChatMenu}
        transparent
        animationType="fade"
        onRequestClose={closeChatMenu}
      >
        <Pressable style={[styles.chatMenuOverlay, { paddingTop: Math.max(56, insets.top + 16) }]} onPress={closeChatMenu}>
          <Pressable style={[styles.chatMenuSheet, { width: Math.min(width * 0.9, isTablet ? 320 : rs(230)) }]} onPress={() => {}}>
            <TouchableOpacity
              style={styles.chatMenuOption}
              activeOpacity={0.9}
              onPress={() => runChatAction(() => void exportChatAsDoc())}
            >
              <View style={styles.chatMenuIcon}>
                <Ionicons name="document-text-outline" size={18} color="#AD1457" />
              </View>
              <Text style={styles.chatMenuText}>Export Chat (DOC)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.chatMenuOption}
              activeOpacity={0.9}
              onPress={() => runChatAction(handleViewProfile)}
            >
              <View style={styles.chatMenuIcon}>
                <Ionicons name="person-circle-outline" size={18} color="#AD1457" />
              </View>
              <Text style={styles.chatMenuText}>View Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.chatMenuOption}
              activeOpacity={0.9}
              onPress={() => runChatAction(() => setShowSharedItems(true))}
            >
              <View style={styles.chatMenuIcon}>
                <Ionicons name="images-outline" size={18} color="#AD1457" />
              </View>
              <Text style={styles.chatMenuText}>Media, Links & Docs</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.chatMenuOption, styles.chatMenuDanger]}
              activeOpacity={0.9}
              onPress={() => runChatAction(handleCloseChat)}
            >
              <View style={styles.chatMenuIcon}>
                <Ionicons name="close-circle-outline" size={18} color="#D32F2F" />
              </View>
              <Text style={[styles.chatMenuText, styles.chatMenuDangerText]}>
                Close Chat
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.chatMenuOption, styles.chatMenuCancel]}
              activeOpacity={0.9}
              onPress={closeChatMenu}
            >
              <Text style={styles.chatMenuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showSharedItems}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSharedItems(false)}
      >
        <View style={styles.sharedModalOverlay}>
          <View style={styles.sharedModalCard}>
            <View style={styles.sharedModalHeader}>
              <Text style={styles.sharedModalTitle}>Media, Links & Docs</Text>
              <TouchableOpacity
                style={styles.sharedModalClose}
                onPress={() => setShowSharedItems(false)}
              >
                <Ionicons name="close" size={18} color="#AD1457" />
              </TouchableOpacity>
            </View>
            <View style={styles.sharedSummaryRow}>
              <View style={styles.sharedSummaryPill}>
                <Text style={styles.sharedSummaryText}>Media {sharedMediaCount}</Text>
              </View>
              <View style={styles.sharedSummaryPill}>
                <Text style={styles.sharedSummaryText}>Docs {sharedDocsCount}</Text>
              </View>
              <View style={styles.sharedSummaryPill}>
                <Text style={styles.sharedSummaryText}>Links {sharedLinksCount}</Text>
              </View>
            </View>
            {!sharedItems.length ? (
              <View style={styles.sharedEmptyWrap}>
                <View style={styles.sharedEmptyBox}>
                  <Ionicons name="albums-outline" size={34} color="#FF80AB" />
                  <Text style={styles.sharedEmptyTitle}>No shared items yet</Text>
                  <Text style={styles.sharedEmptyText}>Images, videos, files and links from this chat will appear here.</Text>
                </View>
              </View>
            ) : (
              <FlatList
                data={sharedDocItems.concat(sharedLinkItems)}
                keyExtractor={(item) => item.key}
                renderItem={renderSharedItem}
                contentContainerStyle={styles.sharedList}
                ListHeaderComponent={
                  <View>
                    <Text style={styles.sharedSectionTitle}>Media</Text>
                    <FlatList
                      data={sharedMediaItems}
                      keyExtractor={(item) => item.key}
                      renderItem={renderSharedMediaTile}
                      numColumns={3}
                      scrollEnabled={false}
                      columnWrapperStyle={styles.sharedMediaRow}
                      contentContainerStyle={styles.sharedMediaGrid}
                      ListEmptyComponent={
                        <Text style={styles.sharedSectionEmpty}>No media shared yet.</Text>
                      }
                    />
                    <Text style={styles.sharedSectionTitle}>Docs & Links</Text>
                  </View>
                }
                ListEmptyComponent={
                  <Text style={styles.sharedSectionEmpty}>No documents or links shared yet.</Text>
                }
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showImagePreview}
        transparent
        animationType="fade"
        onRequestClose={closeImagePreview}
      >
        <View style={styles.imagePreviewOverlay}>
          <TouchableOpacity
            style={styles.imagePreviewClose}
            onPress={closeImagePreview}
            activeOpacity={0.85}
          >
            <Ionicons name="close" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.imagePreviewContent, { paddingTop: previewTopPad, paddingBottom: previewBottomPad }]}
            activeOpacity={1}
            onPress={closeImagePreview}
          >
            {previewImageUrl ? (
              <Image
                source={{ uri: previewImageUrl }}
                style={styles.imagePreviewImage}
                resizeMode="contain"
              />
            ) : null}
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal
        visible={showProfilePreview}
        transparent
        animationType="fade"
        onRequestClose={() => setShowProfilePreview(false)}
      >
        <Pressable
          style={styles.profilePreviewOverlay}
          onPress={() => setShowProfilePreview(false)}
        >
          <Pressable style={styles.profilePreviewCard} onPress={() => {}}>
            <View style={styles.profilePreviewAvatar}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.profilePreviewAvatarImage} />
              ) : (
                <Ionicons name="person" size={28} color="#FF80AB" />
              )}
            </View>
            <Text style={styles.profilePreviewName}>{displayName || "Parent"}</Text>
            <Text style={styles.profilePreviewMeta}>
              {userId ? `User ID: ${String(userId)}` : "Profile details unavailable in this chat"}
            </Text>
            <TouchableOpacity
              style={styles.profilePreviewCloseBtn}
              onPress={() => setShowProfilePreview(false)}
            >
              <Text style={styles.profilePreviewCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {loading || resolving ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FF80AB" />
          <Text style={styles.loadingText}>Loading chat...</Text>
        </View>
      ) : (
        <FlatList
          style={{ width: "100%", alignSelf: "center", maxWidth: chatColumnMaxWidth }}
          ref={listRef}
          data={messages}
          keyExtractor={(item, idx) =>
            [
              item.id?.toString() || "noid",
              item.time || "notime",
              item.isMe ? "me" : "other",
              String(item.message || "").trim().toLowerCase().slice(0, 40) || "empty",
              idx,
            ].join("-")
          }
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: rs(16),
            paddingTop: rs(12),
            paddingBottom: rs(28),
            flexGrow: 1,
            justifyContent: messages.length ? "flex-end" : "center",
            gap: rs(10),
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <Ionicons
                  name="chatbox-ellipses-outline"
                  size={36}
                  color="#FF80AB"
                />
              </View>
              <Text style={styles.emptyTitle}>Start the conversation</Text>
              <Text style={styles.emptySub}>
                Send your first message to get started
              </Text>
            </View>
          }
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: true })
          }
          ListFooterComponent={<View style={{ height: rs(6) }} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      <View style={[styles.composer, { padding: composerPadding, width: "100%", alignSelf: "center", maxWidth: chatColumnMaxWidth }]}>
        <Modal
          visible={showAttachMenu}
          transparent
          animationType="fade"
          onRequestClose={closeAttachMenu}
        >
          <Pressable
            style={[styles.attachOverlay, isTablet ? { justifyContent: "center", alignItems: "center" } : null]}
            onPress={closeAttachMenu}
          >
            <Pressable
              style={[styles.attachSheet, { width: isTablet ? Math.min(width * 0.72, 420) : "100%", maxWidth: 420 }]}
              onPress={() => {}}
            >
              <TouchableOpacity
                style={styles.attachOption}
                activeOpacity={0.9}
                onPress={() => runAttachAction(() => void pickMedia())}
              >
                <View style={styles.attachOptionIcon}>
                  <Ionicons name="image" size={18} color="#AD1457" />
                </View>
                <Text style={styles.attachOptionText}>Photo/Video</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.attachOption}
                activeOpacity={0.9}
                onPress={() => runAttachAction(() => void pickFile())}
              >
                <View style={styles.attachOptionIcon}>
                  <Ionicons name="document-attach" size={18} color="#AD1457" />
                </View>
                <Text style={styles.attachOptionText}>File</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.attachOption, styles.attachCancel]}
                activeOpacity={0.9}
                onPress={closeAttachMenu}
              >
                <Text style={styles.attachCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        {attachment ? (
          <View style={styles.attachmentPreview}>
            {attachment.kind === "image" ? (
              <Image source={{ uri: attachment.uri }} style={styles.previewThumb} />
            ) : (
              <View style={styles.previewIcon}>
                <Ionicons
                  name={attachment.kind === "video" ? "videocam" : "document-attach"}
                  size={16}
                  color="#AD1457"
                />
              </View>
            )}
            <Text style={styles.previewName} numberOfLines={1}>
              {attachment.name}
            </Text>
            <TouchableOpacity
              onPress={() => clearAttachment(null)}
              style={styles.previewRemove}
              accessibilityLabel="Remove attachment"
            >
              <Ionicons name="close" size={18} color="#AD1457" />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <TouchableOpacity
            style={[styles.attachBtn, { width: attachBtnSize, height: attachBtnSize, borderRadius: attachBtnSize / 2 }]}
            onPress={handleAttach}
            disabled={sending}
          >
            <Ionicons name="attach" size={18} color="#FF80AB" />
          </TouchableOpacity>

          <TextInput
            placeholder="Type a message..."
            placeholderTextColor="#AD1457"
            multiline
            scrollEnabled={false}
            value={input}
            onChangeText={setInput}
            style={styles.textInput}
          />

          <TouchableOpacity
            style={[
              styles.sendBtn,
              { width: sendBtnSize, height: sendBtnSize, borderRadius: sendBtnSize / 2 },
              (!input.trim() && !attachment) || sending
                ? styles.sendBtnDisabled
                : null,
            ]}
            onPress={send}
            disabled={(!input.trim() && !attachment) || sending}
          >
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ----------------------------- HELPERS ----------------------------- */

function normalizeMessage(
  m: any,
  currentNannyId: string | number,
  _role?: "user" | "nanny" | null
): Message {
  const nested =
    (m && typeof m.message === "object" && m.message) ||
    (m && typeof m.data === "object" && m.data) ||
    (m && typeof m.chat === "object" && m.chat) ||
    null;
  const msg = nested ? { ...m, ...nested } : m;

  const text = msg.message || msg.text || "";
  const ts =
    msg.created_at ||
    msg.updated_at ||
    msg.sent_at ||
    msg.timestamp ||
    msg.createdAt ||
    msg.updatedAt ||
    msg.time;
  const sender = normalizeSender(msg.sender || msg.sender_type || msg.from || msg.user_type);
  const hasIsMeFlag =
    Object.prototype.hasOwnProperty.call(msg || {}, "is_me") ||
    Object.prototype.hasOwnProperty.call(msg || {}, "isMe");
  let isMe = false;

  const senderUserId =
    msg.sender_user_id ||
    (sender === "user" || sender === "parent" || sender === "client"
      ? msg.user_id || msg.sender_id || msg.client_id
      : null);
  const senderNannyId =
    msg.sender_nanny_id ||
    (sender === "nanny" || sender === "sitter" || sender === "syttr"
      ? msg.nanny_id
      : null);

  const senderLooksLikeNanny =
    sender === "nanny" || sender === "sitter" || sender === "syttr";
  const senderLooksLikeUser =
    sender === "user" || sender === "parent" || sender === "client";
  const nannyIdMatches = String(senderNannyId) === String(currentNannyId);
  const userIdMatches = String(senderUserId) === String(currentNannyId);

  if (senderLooksLikeNanny) {
    isMe = true;
  } else if (senderLooksLikeUser) {
    isMe = false;
  } else if (nannyIdMatches) {
    isMe = true;
  } else if (userIdMatches) {
    isMe = false;
  } else if (hasIsMeFlag) {
    // Last fallback only when sender labels are missing.
    isMe = isTrueLike(msg.is_me ?? msg.isMe);
  } else {
    isMe = false;
  }

  if (__DEV__) {
    console.log("MSG DEBUG:", {
      text,
      sender,
      user_id: msg.user_id,
      nanny_id: msg.nanny_id,
      senderUserId,
      senderNannyId,
      currentNannyId,
      role: _role,
      hasIsMeFlag,
      isMe,
    });
  }

  const attachment = extractAttachment(msg);

  return {
    id: msg.id || msg.message_id,
    message: String(text),
    isMe,
    time: formatMessageTimestamp(ts),
    senderUserId: msg.user_id || msg.sender_id || msg.sender_user_id || msg.client_id,
    ...(attachment || {}),
  };
}

function parseMessageDate(value: any): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  const raw = String(value || "").trim();
  if (!raw) return null;

  const localLike = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/
  );
  if (localLike) {
    const [, y, mo, d, h = "00", mi = "00", s = "00"] = localLike;
    const localParsed = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s)
    );
    if (!Number.isFinite(localParsed.getTime())) return null;

    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    if (hasZone) {
      const zoned = new Date(raw);
      if (Number.isFinite(zoned.getTime())) return zoned;
    }

    const utcParsed = new Date(
      Date.UTC(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h),
        Number(mi),
        Number(s)
      )
    );
    if (!Number.isFinite(utcParsed.getTime())) return localParsed;

    // Heuristic: when backend returns timezone-less UTC strings, pick the interpretation
    // that is closer to "now" so both chat sides stay aligned.
    const now = Date.now();
    const localDiff = Math.abs(now - localParsed.getTime());
    const utcDiff = Math.abs(now - utcParsed.getTime());
    return utcDiff + 60_000 < localDiff ? utcParsed : localParsed;
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function formatMessageTimestamp(value: any): string {
  const parsed = parseMessageDate(value);
  if (!parsed) return String(value || "").trim();

  const now = new Date();
  const isToday =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();

  const dateLabel = isToday
    ? "Today"
    : parsed.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
  const timeLabel = parsed.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return `${dateLabel}, ${timeLabel}`;
}

/* ----------------------------- STYLES ----------------------------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: rs(14),
    paddingTop: rs(14),
    paddingBottom: rs(12),
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#FFE0EB",
  },
  headerIcon: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    backgroundColor: "#FFE7EF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarCircle: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    backgroundColor: "#FFE7EF",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: rs(10),
  },
  headerAvatarImage: { width: rs(36), height: rs(36), borderRadius: rs(18) },
  chatMenuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.2)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: rs(70),
    paddingHorizontal: rs(12),
  },
  chatMenuSheet: {
    width: rs(230),
    backgroundColor: "#fff",
    borderRadius: rs(14),
    padding: rs(8),
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: rs(0), height: rs(4) },
    elevation: 4,
  },
  chatMenuOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: rs(10),
    paddingHorizontal: rs(10),
    borderRadius: rs(10),
  },
  chatMenuIcon: {
    width: rs(28),
    height: rs(28),
    borderRadius: rs(10),
    backgroundColor: "#FFF4F8",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(10),
  },
  chatMenuText: {
    fontSize: rf(14),
    fontWeight: "700",
    color: "#880E4F",
  },
  chatMenuDanger: {
    backgroundColor: "#FFF3F3",
  },
  chatMenuDangerText: {
    color: "#C62828",
  },
  chatMenuCancel: {
    justifyContent: "center",
    marginTop: rs(4),
    backgroundColor: "#FFF4F8",
  },
  chatMenuCancelText: {
    textAlign: "center",
    fontSize: rf(14),
    fontWeight: "800",
    color: "#AD1457",
    width: "100%",
  },
  headerTitle: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
  },
  headerSub: {
    fontSize: rf(12),
    color: "#AD1457",
    marginTop: rs(2),
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: rs(8),
    fontSize: rf(12),
    color: "#AD1457",
    fontWeight: "600",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: rs(40),
    gap: rs(10),
  },
  emptyIconCircle: {
    width: rs(72),
    height: rs(72),
    borderRadius: rs(36),
    backgroundColor: "#FFE7EF",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
  },
  emptySub: {
    fontSize: rf(13),
    color: "#AD1457",
  },
  bubbleRow: {
    marginBottom: rs(8),
    paddingHorizontal: rs(4),
  },
  bubble: {
    maxWidth: "85%",
    paddingHorizontal: rs(14),
    paddingVertical: rs(10),
    borderRadius: rs(16),
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  bubbleMe: {
    backgroundColor: "#FF7FA8",
    borderTopRightRadius: rs(10),
    borderTopLeftRadius: rs(16),
    borderBottomLeftRadius: rs(16),
  },
  bubbleOther: {
    backgroundColor: "#fff",
    borderTopLeftRadius: rs(10),
    borderTopRightRadius: rs(16),
    borderBottomRightRadius: rs(16),
  },
  bubbleText: {
    fontSize: rf(14),
    fontWeight: "500",
    lineHeight: rs(20),
  },
  bubbleTextWeb: Platform.OS === "web" ? ({ wordBreak: "break-word", overflowWrap: "anywhere" } as any) : {},
  linkText: {
    textDecorationLine: "underline",
  },
  linkTextMe: {
    color: "#D6F2FF",
  },
  linkTextOther: {
    color: "#1976D2",
  },
  time: {
    fontSize: rf(10),
    marginTop: rs(4),
  },
  composer: {
    padding: rs(12),
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#FF80AB20",
  },
  attachOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
    padding: rs(14),
  },
  attachSheet: {
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(10),
  },
  attachOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: rs(12),
    paddingHorizontal: rs(10),
    borderRadius: rs(12),
  },
  attachOptionIcon: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(12),
    backgroundColor: "#FFF4F8",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(10),
  },
  attachOptionText: {
    fontSize: rf(14),
    fontWeight: "700",
    color: "#880E4F",
  },
  attachCancel: {
    justifyContent: "center",
    backgroundColor: "#FFF4F8",
    marginTop: rs(6),
  },
  attachCancelText: {
    textAlign: "center",
    fontSize: rf(14),
    fontWeight: "800",
    color: "#AD1457",
  },
  attachmentPreview: {
    flexDirection: "row",
    alignItems: "center",
    padding: rs(8),
    borderRadius: rs(14),
    backgroundColor: "#FFF4F8",
    marginBottom: rs(8),
  },
  previewThumb: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(10),
    marginRight: rs(10),
    backgroundColor: "#FFE4EC",
  },
  previewIcon: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(10),
    marginRight: rs(10),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  previewName: {
    flex: 1,
    fontSize: rf(12),
    fontWeight: "700",
    color: "#880E4F",
  },
  previewRemove: {
    paddingLeft: rs(6),
    paddingVertical: rs(4),
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  attachBtn: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(8),
  },
  textInput: {
    flex: 1,
    minHeight: rs(44),
    maxHeight: rs(120),
    borderRadius: rs(18),
    paddingHorizontal: rs(12),
    paddingVertical: rs(8),
    backgroundColor: "#FFF4F8",
    color: "#880E4F",
    lineHeight: rs(20),
    textAlignVertical: "top",
  },
  sendBtn: {
    width: rs(42),
    height: rs(42),
    borderRadius: rs(21),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: rs(8),
  },
  sendBtnDisabled: {
    opacity: 0.6,
  },
  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: rs(8),
  },
  attachmentText: {
    marginLeft: rs(6),
    fontSize: rf(12),
    fontWeight: "700",
    flexShrink: 1,
  },
  attachmentImageWrap: {
    marginTop: rs(8),
    borderRadius: rs(12),
    overflow: "hidden",
  },
  attachmentImage: {
    width: rs(220),
    height: rs(150),
    backgroundColor: "#FFE4EC",
  },
  imagePreviewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    justifyContent: "center",
    alignItems: "center",
  },
  imagePreviewClose: {
    position: "absolute",
    top: rs(48),
    right: rs(16),
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  imagePreviewContent: {
    width: "100%",
    height: "100%",
    paddingTop: rs(96),
    paddingBottom: rs(34),
    paddingHorizontal: rs(14),
    alignItems: "center",
    justifyContent: "center",
  },
  imagePreviewImage: {
    width: "100%",
    height: "100%",
  },
  sharedModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "flex-end",
  },
  sharedModalCard: {
    maxHeight: "82%",
    backgroundColor: "#fff",
    borderTopLeftRadius: rs(18),
    borderTopRightRadius: rs(18),
    paddingHorizontal: rs(14),
    paddingTop: rs(14),
    paddingBottom: rs(18),
  },
  sharedModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(10),
  },
  sharedModalTitle: {
    fontSize: rf(16),
    fontWeight: "800",
    color: "#880E4F",
  },
  sharedModalClose: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(16),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  sharedSummaryRow: {
    flexDirection: "row",
    gap: rs(8),
    marginBottom: rs(12),
  },
  sharedSummaryPill: {
    paddingHorizontal: rs(10),
    paddingVertical: rs(7),
    borderRadius: rs(999),
    backgroundColor: "#FFF5F9",
  },
  sharedSummaryText: {
    color: "#AD1457",
    fontSize: rf(11),
    fontWeight: "700",
  },
  sharedList: {
    paddingBottom: rs(16),
    gap: rs(8),
  },
  sharedSectionTitle: {
    fontSize: rf(13),
    fontWeight: "800",
    color: "#880E4F",
    marginBottom: rs(8),
  },
  sharedSectionEmpty: {
    fontSize: rf(12),
    color: "#AD1457",
    marginBottom: rs(12),
  },
  sharedMediaGrid: {
    paddingBottom: rs(12),
    gap: rs(8),
  },
  sharedMediaRow: {
    justifyContent: "flex-start",
    gap: rs(8),
    marginBottom: rs(8),
  },
  sharedMediaTile: {
    borderRadius: rs(14),
    overflow: "hidden",
    backgroundColor: "#FFE4EC",
    position: "relative",
  },
  sharedMediaImage: {
    width: "100%",
    height: "100%",
  },
  sharedMediaVideoTile: {
    flex: 1,
    backgroundColor: "#C2185B",
    alignItems: "center",
    justifyContent: "center",
  },
  sharedMediaBadge: {
    position: "absolute",
    left: rs(6),
    bottom: rs(6),
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: rs(999),
    paddingHorizontal: rs(7),
    paddingVertical: rs(4),
  },
  sharedMediaBadgeText: {
    color: "#fff",
    fontSize: rf(10),
    fontWeight: "700",
  },
  sharedItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(10),
    backgroundColor: "#FFF9FC",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    borderRadius: rs(14),
    paddingHorizontal: rs(12),
    paddingVertical: rs(11),
  },
  sharedItemIcon: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(12),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
  },
  sharedItemTitle: {
    fontSize: rf(13),
    fontWeight: "700",
    color: "#880E4F",
  },
  sharedItemMeta: {
    marginTop: rs(2),
    fontSize: rf(11),
    color: "#AD1457",
  },
  sharedEmptyWrap: {
    flexGrow: 1,
    justifyContent: "center",
  },
  sharedEmptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: rs(40),
    gap: rs(8),
  },
  sharedEmptyTitle: {
    fontSize: rf(14),
    fontWeight: "700",
    color: "#880E4F",
  },
  sharedEmptyText: {
    fontSize: rf(12),
    color: "#AD1457",
    textAlign: "center",
    paddingHorizontal: rs(18),
  },
  profilePreviewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: rs(18),
  },
  profilePreviewCard: {
    width: "100%",
    maxWidth: rs(340),
    backgroundColor: "#fff",
    borderRadius: rs(18),
    paddingVertical: rs(20),
    paddingHorizontal: rs(16),
    alignItems: "center",
  },
  profilePreviewAvatar: {
    width: rs(72),
    height: rs(72),
    borderRadius: rs(36),
    backgroundColor: "#FFE7EF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: rs(10),
    overflow: "hidden",
  },
  profilePreviewAvatarImage: {
    width: rs(72),
    height: rs(72),
    borderRadius: rs(36),
  },
  profilePreviewName: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
    textAlign: "center",
  },
  profilePreviewMeta: {
    marginTop: rs(8),
    fontSize: rf(12),
    color: "#6B4350",
    textAlign: "center",
  },
  profilePreviewCloseBtn: {
    marginTop: rs(16),
    backgroundColor: "#FF80AB",
    paddingHorizontal: rs(16),
    paddingVertical: rs(10),
    borderRadius: rs(12),
  },
  profilePreviewCloseText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(13),
  },
});

