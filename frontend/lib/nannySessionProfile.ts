import AppStorage from "@/lib/storage";
import { BASE_URL, getRuntimeApiKey, sanitizeToken } from "../app/Api";
import { rewriteLoopbackAbsoluteUrl } from "./urlHosts";

type NannySessionProfile = {
  nannyId: string;
  name?: string;
  email?: string;
  image?: string;
};

const API_BASE = String(BASE_URL || "").replace(/\/+$/, "");
const STORAGE_ROOT = API_BASE.replace(/\/api\/?$/, "");
const ASSET_CACHE_BUST = "asset_v=20260327_1";

const cleanStoredValue = (value: unknown): string => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  if (lower === "null" || lower === "undefined" || lower === "nan") return "";
  return normalized;
};

const sanitizeDisplayName = (value: unknown): string => {
  const normalized = cleanStoredValue(value);
  if (!normalized || normalized.includes("@")) return "";
  return normalized;
};

export const resolveSessionImageUrl = (value: unknown): string => {
  const raw = cleanStoredValue(value);
  if (!raw) return "";
  const withCacheBust = (url: string) =>
    url && /^https?:\/\//i.test(url)
      ? `${url}${url.includes("?") ? "&" : "?"}${ASSET_CACHE_BUST}`
      : url;
  if (/^(https?:|data:|blob:)/i.test(raw)) {
    return /^https?:/i.test(raw)
      ? withCacheBust(rewriteLoopbackAbsoluteUrl(raw, STORAGE_ROOT))
      : raw;
  }
  const clean = raw.replace(/^\/+/, "");
  if (clean.startsWith("storage/")) {
    return withCacheBust(rewriteLoopbackAbsoluteUrl(`${STORAGE_ROOT}/${clean}`, STORAGE_ROOT));
  }
  if (clean.startsWith("public/")) {
    const publicPath = clean.slice("public/".length).replace(/^\/+/, "");
    return withCacheBust(rewriteLoopbackAbsoluteUrl(`${STORAGE_ROOT}/storage/${publicPath}`, STORAGE_ROOT));
  }
  return withCacheBust(rewriteLoopbackAbsoluteUrl(`${STORAGE_ROOT}/storage/${clean}`, STORAGE_ROOT));
};

const extractName = (source: any): string => {
  if (!source) return "";
  return (
    sanitizeDisplayName(source?.name) ||
    sanitizeDisplayName(source?.fullname) ||
    sanitizeDisplayName(
      [source?.first_name, source?.last_name].filter(Boolean).join(" ").trim()
    ) ||
    sanitizeDisplayName(
      [source?.firstname, source?.lastname].filter(Boolean).join(" ").trim()
    )
  );
};

const extractEmail = (source: any): string => cleanStoredValue(source?.email);

const extractImage = (source: any): string =>
  resolveSessionImageUrl(
    source?.avatar ||
      source?.user_image_url ||
      source?.profile_image_url ||
      source?.profile_image ||
      source?.user_image ||
      source?.image_url ||
      source?.image ||
      source?.user?.user_image_url ||
      source?.user?.profile_image_url ||
      source?.user?.profile_image ||
      source?.user?.user_image ||
      source?.user?.avatar
  );

const extractProfileCandidate = (payload: any): any => {
  if (!payload) return null;
  if (Array.isArray(payload) && payload.length > 0) return payload[0];

  const data = payload?.data;
  if (Array.isArray(data) && data.length > 0) return data[0];
  if (Array.isArray(data?.data) && data.data.length > 0) return data.data[0];

  return data?.profile || payload?.profile || data || payload;
};

const extractIdentityFromPayload = (payload: any): Partial<NannySessionProfile> => {
  const root = payload?.data || payload;
  const profile = extractProfileCandidate(payload);

  const name =
    extractName(root?.user) ||
    extractName(profile) ||
    extractName(root);
  const email =
    extractEmail(root?.user) ||
    extractEmail(profile) ||
    extractEmail(root);
  const image =
    extractImage(profile) ||
    extractImage(root?.user) ||
    extractImage(root);

  return {
    name: name || undefined,
    email: email || undefined,
    image: image || undefined,
  };
};

const mergeProfiles = (
  base: NannySessionProfile,
  next?: Partial<NannySessionProfile> | null
): NannySessionProfile => ({
  ...base,
  name: next?.name || base.name,
  email: next?.email || base.email,
  image: next?.image || base.image,
});

const fetchJson = async (url: string, headers: HeadersInit): Promise<any | null> => {
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return res.json().catch(() => null);
};

export const hydrateNannySessionProfile = async (): Promise<NannySessionProfile | null> => {
  const [tokenRaw, nannyIdRaw, userIdRaw, apiKeyStored] = await Promise.all([
    AppStorage.getItem("token"),
    AppStorage.getItem("nanny_id"),
    AppStorage.getItem("user_id"),
    AppStorage.getItem("api_key"),
  ]);

  const token = sanitizeToken(tokenRaw || undefined);
  const apiKey = cleanStoredValue(apiKeyStored) || cleanStoredValue(getRuntimeApiKey());
  const nannyId = cleanStoredValue(nannyIdRaw) || cleanStoredValue(userIdRaw);
  if (!nannyId) return null;

  const querySuffix = apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : "";
  const profileQuery = [
    `user_id=${encodeURIComponent(nannyId)}`,
    ...(apiKey ? [`api_key=${encodeURIComponent(apiKey)}`] : []),
  ].join("&");
  const headers: HeadersInit = {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  };

  let merged: NannySessionProfile = { nannyId };

  const detailsJson = await fetchJson(`${API_BASE}/nannies/${encodeURIComponent(nannyId)}${querySuffix}`, headers);
  merged = mergeProfiles(merged, extractIdentityFromPayload(detailsJson));

  const profileJson = await fetchJson(`${API_BASE}/profiles/syttrs?${profileQuery}`, headers);
  merged = mergeProfiles(merged, extractIdentityFromPayload(profileJson));

  if (!merged.name && !merged.email && !merged.image) {
    return null;
  }

  const sets: [string, string][] = [
    ["nanny_id", nannyId],
    ["user_id", nannyId],
  ];
  if (merged.name) {
    sets.push(["nanny_name", merged.name], ["user_name", merged.name]);
  }
  if (merged.email) {
    sets.push(["nanny_email", merged.email], ["user_email", merged.email]);
  }
  if (merged.image) {
    sets.push(["nanny_image", merged.image], ["user_image", merged.image]);
  }
  await AppStorage.multiSet(sets);

  return merged;
};
