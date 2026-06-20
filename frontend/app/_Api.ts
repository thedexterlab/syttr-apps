import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const runtimeExtra =
  ((Constants as any)?.expoConfig?.extra as Record<string, any> | undefined) ||
  ((Constants as any)?.manifest2?.extra as Record<string, any> | undefined) ||
  ((Constants as any)?.manifest?.extra as Record<string, any> | undefined) ||
  {};

const readRuntimeEnv = (key: string): string => {
  const fromProcess =
    typeof process !== "undefined" ? (process as any)?.env?.[key] : undefined;
  const fromExtra = runtimeExtra?.[key];
  return String(fromProcess || fromExtra || "").trim();
};

const readRuntimeFlag = (key: string): boolean =>
  /^(1|true|yes|on)$/i.test(readRuntimeEnv(key));

export const getRuntimeApiKey = () => {
  return (
    readRuntimeEnv("EXPO_PUBLIC_API_KEY") ||
    readRuntimeEnv("API_KEY") ||
    ""
  );
};

export async function getResolvedApiKey(explicitApiKey?: string): Promise<string> {
  const cleanExplicitApiKey = String(explicitApiKey || "").trim();
  if (cleanExplicitApiKey) {
    return cleanExplicitApiKey;
  }

  const storedApiKey = String((await AsyncStorage.getItem("api_key")) || "").trim();
  if (storedApiKey) {
    return storedApiKey;
  }

  const processApiKey =
    typeof process !== "undefined"
      ? String(process.env?.EXPO_PUBLIC_API_KEY || "").trim()
      : "";

  return processApiKey || getRuntimeApiKey();
}

const DEFAULT_REMOTE_API_BASE_URL = "https://syttr.zyronexlab.com/api/";
const DEV_LOCAL_API_BASE_URL_OVERRIDE = readRuntimeEnv("EXPO_PUBLIC_LOCAL_API_BASE_URL");
const FORCE_REMOTE_API_IN_DEV = readRuntimeFlag("EXPO_PUBLIC_FORCE_REMOTE_API");

const configuredBaseUrl = readRuntimeEnv("EXPO_PUBLIC_API_BASE_URL");
const runtimeBaseUrl = configuredBaseUrl || DEFAULT_REMOTE_API_BASE_URL;

const stripWrappingQuotes = (value: string) =>
  String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "");

const normalizeBase = (value: string) =>
  stripWrappingQuotes(value).replace(/\/+$/, "") + "/";

const coerceApiRootBase = (value: string) => {
  const normalized = normalizeBase(value);
  if (normalized === "/") return normalized;
  const trimmedToApiRoot = normalized.replace(/(\/api)\/.*$/i, "$1/");
  if (trimmedToApiRoot !== normalized) {
    return trimmedToApiRoot;
  }
  if (!/^https?:\/\//i.test(normalized)) return normalized;

  try {
    const parsed = new URL(normalized);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const apiIndex = segments.findIndex((segment) => segment.toLowerCase() === "api");
    if (apiIndex >= 0) {
      parsed.pathname = `/${segments.slice(0, apiIndex + 1).join("/")}/`;
    } else {
      parsed.pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
};

const resolvePreferredBaseUrl = () => {
  const normalizedConfigured = coerceApiRootBase(
    runtimeBaseUrl || DEFAULT_REMOTE_API_BASE_URL
  );
  const explicitLocalBaseUrl = coerceApiRootBase(DEV_LOCAL_API_BASE_URL_OVERRIDE || "");

  if (__DEV__ && !FORCE_REMOTE_API_IN_DEV && explicitLocalBaseUrl !== "/") {
    return explicitLocalBaseUrl;
  }

  return normalizedConfigured;
};

const BASE_URL = resolvePreferredBaseUrl();

type RequestOptions = RequestInit & {
  // Keep headers optional but merge-friendly.
  headers?: Record<string, string>;
  timeoutMs?: number;
  useSessionAuth?: boolean;
};

const normalizePath = (path: string) =>
  path.startsWith('/') ? path.slice(1) : path;

export const sanitizeToken = (value?: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw);
    const nested =
      parsed?.token ||
      parsed?.access_token ||
      parsed?.data?.token ||
      parsed?.data?.access_token ||
      "";
    if (nested) {
      return String(nested).replace(/^Bearer\s+/i, "").replace(/"/g, "").trim();
    }
  } catch {
    // keep raw fallback
  }

  return raw.replace(/^Bearer\s+/i, "").replace(/"/g, "").trim();
};

async function getAuthHeaders(): Promise<{ Authorization: string }> {
  const storedToken =
    (await AsyncStorage.getItem("token")) ||
    (await AsyncStorage.getItem("nanny_token"));
  const cleanToken = sanitizeToken(storedToken || undefined);
  return { Authorization: cleanToken ? `Bearer ${cleanToken}` : "" };
}

// Google Maps API key used for Places/Geocoding lookups
export const GOOGLE_MAPS_KEY =
  (typeof process !== 'undefined'
    ? process.env?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env?.GOOGLE_MAPS_API_KEY
    : undefined) ||
  readRuntimeEnv("EXPO_PUBLIC_GOOGLE_MAPS_API_KEY") ||
  "";
// Stripe publishable key for client-side usage only (never store the secret in the app)
export const STRIPE_PUBLISHABLE_KEY = readRuntimeEnv("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY");
export const STRIPE_VERIFICATION_PRODUCT_ID =
  readRuntimeEnv("EXPO_PUBLIC_STRIPE_BG_VERIFICATION_PRODUCT_ID") ||
  readRuntimeEnv("EXPO_PUBLIC_STRIPE_VERIFICATION_PRODUCT_ID");
export const STRIPE_VERIFICATION_PRICE_ID =
  readRuntimeEnv("EXPO_PUBLIC_STRIPE_BG_VERIFICATION_PRICE_ID") ||
  readRuntimeEnv("EXPO_PUBLIC_STRIPE_VERIFICATION_PRICE_ID");
export const STRIPE_BG_VERIFICATION_PRODUCT_ID = STRIPE_VERIFICATION_PRODUCT_ID;
export const STRIPE_BG_VERIFICATION_PRICE_ID = STRIPE_VERIFICATION_PRICE_ID;
export const STRIPE_BG_VERIFICATION_WITH_DRIVING_PRODUCT_ID = readRuntimeEnv(
  "EXPO_PUBLIC_STRIPE_BG_VERIFICATION_WITH_DRIVING_PRODUCT_ID"
);
export const STRIPE_BG_VERIFICATION_WITH_DRIVING_PRICE_ID = readRuntimeEnv(
  "EXPO_PUBLIC_STRIPE_BG_VERIFICATION_WITH_DRIVING_PRICE_ID"
);
export const STRIPE_FAMILY_SUBSCRIPTION_PRODUCT_ID = readRuntimeEnv(
  "EXPO_PUBLIC_STRIPE_FAMILY_SUBSCRIPTION_PRODUCT_ID"
);
export const STRIPE_FAMILY_SUBSCRIPTION_PRICE_ID = readRuntimeEnv(
  "EXPO_PUBLIC_STRIPE_FAMILY_SUBSCRIPTION_PRICE_ID"
);
export const STRIPE_DESTINATION_ID = readRuntimeEnv("EXPO_PUBLIC_STRIPE_DESTINATION_ID");

const LOG_API = readRuntimeEnv("EXPO_PUBLIC_LOG_API") === "1";
const REQUEST_TIMEOUT_MS = 15000;
const SUBSCRIPTION_REQUEST_TIMEOUT_MS = 120000;
const PROFILE_UPLOAD_REQUEST_TIMEOUT_MS = 120000;
const logApi = (event: string, payload: Record<string, unknown>) => {
  if (!LOG_API) return;
  // eslint-disable-next-line no-console
  console.log(`[API] ${event}`, payload);
};

async function request<TResponse = any>(path: string, options: RequestOptions = {}) {
  const isAbsolute = /^https?:\/\//i.test(path);
  const normalizedPath = normalizePath(path).toLowerCase();
  const timeoutMs =
    options.timeoutMs ??
    (normalizedPath.includes("subscribe") ||
    normalizedPath.includes("subscription/") ||
    normalizedPath.includes("stripe/")
      ? SUBSCRIPTION_REQUEST_TIMEOUT_MS
      : REQUEST_TIMEOUT_MS);
  const urls = isAbsolute
    ? [path]
    : Array.from(
        new Set([
          `${BASE_URL}${normalizePath(path)}`,
          ...(BASE_URL === DEFAULT_REMOTE_API_BASE_URL
            ? []
            : [`${DEFAULT_REMOTE_API_BASE_URL}${normalizePath(path)}`]),
        ])
      );

  let lastNetworkError: any = null;
  let firstTimeoutError: Error | null = null;

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    logApi("request", { url, method: options.method || "GET" });

    const isForm = options.body instanceof FormData;
    const method = (options.method || "GET").toUpperCase();
    const hasBody = typeof options.body !== "undefined" && options.body !== null;

    let response: Response;
    const controller = !options.signal ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const mergedHeaders = {
        Accept: "application/json",
        ...(isForm || method === "GET" || !hasBody ? {} : { "Content-Type": "application/json" }),
        ...(options.headers ?? {}),
      };
      const { useSessionAuth, ...fetchOptions } = options;
      response = await fetch(url, {
        ...fetchOptions,
        ...(controller ? { signal: controller.signal } : {}),
        credentials: useSessionAuth ? "include" : "omit",
        headers: mergedHeaders,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        const timeoutError = new Error(
          `Request timed out after ${Math.ceil(timeoutMs / 1000)}s for ${url}.`
        );
        if (!firstTimeoutError) firstTimeoutError = timeoutError;
        lastNetworkError = timeoutError;
        continue;
      }
      lastNetworkError = err;
      continue;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    let data: any = null;
    let rawText = "";
    try {
      rawText = await response.text();
      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = rawText;
        }
      }
    } catch {
      // ignore body parse errors; will throw below if !ok
    }

    logApi("response", {
      url,
      status: response.status,
      ok: response.ok,
      data,
    });

    if (response.ok && !isAbsolute && i < urls.length - 1) {
      const isHtmlByContentType = contentType.includes("text/html");
      const isHtmlByBody =
        typeof data === "string" &&
        /<!doctype html|<html[\s>]/i.test(data);
      const isNonJsonStringPayload =
        typeof data === "string" &&
        !contentType.includes("application/json");

      if (isHtmlByContentType || isHtmlByBody || isNonJsonStringPayload) {
        continue;
      }
    }

    if (!response.ok) {
      if (!isAbsolute && response.status === 404 && i < urls.length - 1) {
        continue;
      }

      const errorPayload =
        data && typeof data === "object" && !Array.isArray(data) ? data : null;
      const primary = errorPayload?.message;
      const detail = errorPayload?.error;
      const errors = errorPayload?.errors;
      const errorList =
        errors && typeof errors === "object"
          ? Object.entries(errors as Record<string, unknown>)
              .flatMap(([field, messages]) => {
                const items = Array.isArray(messages) ? messages : [messages];
                return items
                  .filter(Boolean)
                  .map((item) => `${field}: ${String(item)}`);
              })
          : [];
      const message =
        (primary === "Something went wrong" && detail) ||
        detail ||
        primary ||
        (typeof data === "string" ? data : "") ||
        (errorList.length ? errorList.join("\n") : "") ||
        `Request failed with status ${response.status}`;
      const error = new Error(message) as Error & {
        status?: number;
        payload?: any;
      };
      error.status = response.status;
      error.payload = errorPayload ?? data;
      throw error;
    }

    return data as TResponse;
  }

  if (lastNetworkError) {
    if (firstTimeoutError) {
      throw new Error(`${firstTimeoutError.message} Tried: ${urls.join(", ")}`);
    }
    const tried = urls.join(", ");
    throw new Error(
      `Network request failed. Tried: ${tried}. Ensure the API is reachable and EXPO_PUBLIC_API_BASE_URL is correct, for example ${DEFAULT_REMOTE_API_BASE_URL}.`
    );
  }
  throw new Error("Network request failed");
}

export async function apiRequest<TResponse = any>(
  path: string,
  options: RequestOptions = {}
) {
  return request<TResponse>(path, options);
}

export async function registerPushToken(
  payload: {
    expo_push_token: string;
    platform?: string;
    device_id?: string;
    device_name?: string | null;
    app_ownership?: string | null;
    project_id?: string | null;
    bundle_identifier?: string | null;
    environment?: string | null;
    meta?: Record<string, any> | null;
    user_id?: string | number;
  },
  token?: string
) {
  const cleanToken = sanitizeToken(token || undefined);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();

  return request("push-tokens", {
    method: "POST",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(payload),
  });
}

export async function unregisterPushToken(
  payload: {
    expo_push_token?: string;
    device_id?: string;
    user_id?: string | number;
  },
  token?: string
) {
  const cleanToken = sanitizeToken(token || undefined);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();

  return request("push-tokens", {
    method: "DELETE",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(payload),
  });
}

export async function triggerNotificationHeartbeat(token?: string) {
  const cleanToken = sanitizeToken(token || undefined);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();

  return request("notifications/heartbeat", {
    method: "POST",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({}),
  });
}

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

const toFormBody = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

type StripeTokenResponse = {
  id?: string;
  [key: string]: any;
};

export async function createStripeToken(
  fields: Record<string, string>
): Promise<StripeTokenResponse> {
  if (!STRIPE_PUBLISHABLE_KEY) {
    throw new Error(
      "Missing Stripe publishable key. Set EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY in frontend/.env.local."
    );
  }
  const response = await fetch(`${STRIPE_API_BASE}/tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: toFormBody(fields),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || "Unable to tokenize payout method.";
    throw new Error(message);
  }
  return data as StripeTokenResponse;
}

type LoginPayload = {
  email: string;
  password: string;
};

type LoginResponse = {
  token?: string;
  user_type?: string;
  [key: string]: any;
};

export async function login(payload: LoginPayload) {
  const cleanApiKey = await getResolvedApiKey();
  return request<LoginResponse>('login', {
    method: 'POST',
    headers: {
      ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(payload),
  });
}

export async function scheduleAccountDeletion(token?: string) {
  const cleanToken = sanitizeToken(token);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();

  return request('account/delete', {
    method: 'POST',
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({}),
  });
}

export async function deactivateAccount(token?: string) {
  const cleanToken = sanitizeToken(token);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();

  return request('account/deactivate', {
    method: 'POST',
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({}),
  });
}

export async function getReferralReference(
  payload: { user_id?: string | number; regenerate?: boolean } = {},
  token?: string
) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();

  const queryParts: string[] = [];
  const userId = String(payload?.user_id ?? "").trim();
  if (userId) {
    queryParts.push(`user_id=${encodeURIComponent(userId)}`);
  }
  if (payload?.regenerate) {
    queryParts.push("regenerate=1");
  }

  const suffix = queryParts.length ? `?${queryParts.join("&")}` : "";
  return request(`referrals/reference${suffix}`, {
    method: "GET",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
    },
  });
}

export async function changePassword(payload: {
  email?: string;
  user_id?: string | number;
  current_password?: string;
  new_password: string;
  code?: string;
}, token?: string) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  const storedApiKey = await AsyncStorage.getItem("api_key");
  const cleanApiKey =
    String(storedApiKey || "").trim() ||
    (typeof process !== "undefined" ? String(process.env?.EXPO_PUBLIC_API_KEY || "").trim() : "") ||
    getRuntimeApiKey();

  return request('change-password', {
    method: 'POST',
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(payload),
  });
}

export async function sendPasswordResetCode(
  payload: { email: string },
  token?: string
) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  const storedApiKey = await AsyncStorage.getItem("api_key");
  const cleanApiKey =
    String(storedApiKey || "").trim() ||
    (typeof process !== "undefined" ? String(process.env?.EXPO_PUBLIC_API_KEY || "").trim() : "") ||
    getRuntimeApiKey();

  return request('forgot-password/send-code', {
    method: 'POST',
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({
      email: String(payload?.email || '').trim(),
    }),
  });
}

type SignupNannyPayload = {
  fullname: string;
  email: string;
  password: string;
  password_confirmation: string;
};

export async function signupNanny(payload: SignupNannyPayload) {
  const full = payload.fullname?.trim() || '';
  return request('signup/syttr', {
    method: 'POST',
    body: JSON.stringify({
      name: full || payload.email,
      email: payload.email,
      password: payload.password,
    }),
  });
}

type SignupClientPayload = {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
};

export async function signupClient(payload: SignupClientPayload) {
  return request('signup/parent', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.name,
      email: payload.email,
      password: payload.password,
    }),
  });
}

type ProfilePayload = Record<string, any>;

export async function registerClientWithProfile(
  payload: ProfilePayload
) {
  const name = String(payload?.name || payload?.fullname || "").trim();
  const email = String(payload?.email || "").trim().toLowerCase();
  const password = String(payload?.password || "").trim();
  const passwordConfirmation = String(
    payload?.password_confirmation || payload?.confirm || password
  ).trim();

  if (!name || !email || !password || !passwordConfirmation) {
    throw new Error("Missing signup fields (name/email/password)");
  }

  return request('signup/parent', {
    method: 'POST',
    body: JSON.stringify({
      name,
      email,
      password,
      password_confirmation: passwordConfirmation,
    }),
  });
}

export async function updateClientProfile(
  payload: ProfilePayload,
  token?: string
) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();

  try {
    const userId = payload?.user_id ? String(payload.user_id) : "";
    if (!userId) throw new Error("user_id is required");

    const rawChildrenCount = payload.children_count ?? payload.kids;
    const parsedChildrenCount =
      rawChildrenCount === undefined || rawChildrenCount === null || String(rawChildrenCount).trim() === ""
        ? undefined
        : Number.parseInt(String(rawChildrenCount), 10);
    const childrenCount =
      Number.isFinite(parsedChildrenCount as number) && (parsedChildrenCount as number) > 0
        ? parsedChildrenCount
        : undefined;

    const mappedPayload: Record<string, any> = {
      user_id: userId,
      first_name: payload.first_name || undefined,
      last_name: payload.last_name || undefined,
      name:
        payload.name ||
        [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim() ||
        undefined,
      phone: payload.phone || payload.number || undefined,
      city: payload.city || payload.city_area || undefined,
      address: payload.address || payload.location || payload.city || undefined,
      country: payload.country || undefined,
      gender: payload.gender || undefined,
      bio: payload.about_me || payload.bio || undefined,
      children_count: childrenCount,
      user_image_base64: payload.user_image_base64 || undefined,
      user_image: payload.user_image || undefined,
    };

    return request("update-client-profile", {
      method: "POST",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mappedPayload),
    });
  } catch (error: any) {
    throw error;
  }
}

export async function getClientProfile(
  userId: string | number,
  token?: string
) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new Error("user_id is required");
  }

  const getHeaders = {
    ...(authHeaders.Authorization ? authHeaders : {}),
    Accept: "application/json",
  };

  try {
    const profiles = await request<any>(
      `profiles/parents?user_id=${encodeURIComponent(normalizedUserId)}`,
      {
        method: "GET",
        headers: getHeaders,
      }
    );

    const profile =
      (Array.isArray(profiles?.data) ? profiles.data[0] : null) ||
      (Array.isArray(profiles) ? profiles[0] : null) ||
      profiles?.profile ||
      profiles?.data?.profile ||
      profiles?.data ||
      profiles;

    if (profile) {
      return profile;
    }
  } catch (error: any) {
    if (error?.status !== 404) {
      throw error;
    }
  }

  const fallback = await request<any>("profile-status", {
    method: "POST",
    headers: {
      ...getHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: normalizedUserId }),
  });

  return (
    fallback?.profile ||
    fallback?.data?.profile ||
    fallback?.data ||
    fallback
  );
}

type NannyLoginPayload = {
  email: string;
  password: string;
};

export async function loginNanny(payload: NannyLoginPayload): Promise<LoginResponse> {
  const cleanApiKey = await getResolvedApiKey();
  return request<LoginResponse>('nanny/login', {
    method: 'POST',
    headers: {
      ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(payload),
  });
}

export async function updateNannyProfile(
  payload: ProfilePayload,
  token?: string,
  apiKey?: string
) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  const cleanApiKey = String(apiKey || "").trim() || getRuntimeApiKey();
  const userId = String(payload?.nanny_id || payload?.user_id || payload?.id || "").trim();
  if (!userId) {
    throw new Error("user_id is required");
  }
  const certificatePath =
    typeof payload.certificate === "string" && payload.certificate.trim() !== ""
      ? payload.certificate
      : undefined;
  const certificateBase64 =
    typeof payload.certificate_base64 === "string" && payload.certificate_base64.trim() !== ""
      ? payload.certificate_base64
      : undefined;

  const mappedPayload: Record<string, any> = {
    user_id: userId,
    phone: payload.phone || payload.number || undefined,
    city: payload.city || payload.city_area || undefined,
    address: payload.address || payload.location || undefined,
    country: payload.country || undefined,
    gender: payload.gender || undefined,
    date_of_birth: payload.date_of_birth || payload.dob || undefined,
    experience_years:
      payload.experience_years ??
      (payload.experience !== undefined && payload.experience !== null
        ? Number.parseInt(String(payload.experience), 10)
        : undefined),
    hourly_rate:
      payload.hourly_rate !== undefined && payload.hourly_rate !== null
        ? Number(payload.hourly_rate)
        : undefined,
    bio: payload.bio || payload.about || payload.about_me || undefined,
    user_image_base64: payload.user_image_base64 || undefined,
    user_image: payload.user_image || undefined,
    certificate_base64: certificateBase64,
    certificate: certificatePath,
  };
  const hasBinaryUpload = Boolean(
    mappedPayload.user_image_base64 || mappedPayload.certificate_base64
  );

  const profiles = await request<any[]>(
    `profiles/syttrs?user_id=${encodeURIComponent(String(userId))}`,
    {
      method: "GET",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
        ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
      },
    }
  );

  if (Array.isArray(profiles) && profiles.length && profiles[0]?.id) {
    return request(`profiles/syttrs/${profiles[0].id}`, {
      method: "PATCH",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
        ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
        "Content-Type": "application/json",
      },
      timeoutMs: hasBinaryUpload ? PROFILE_UPLOAD_REQUEST_TIMEOUT_MS : undefined,
      body: JSON.stringify({
        phone: mappedPayload.phone,
        city: mappedPayload.city,
        address: mappedPayload.address,
        country: mappedPayload.country,
        gender: mappedPayload.gender,
        date_of_birth: mappedPayload.date_of_birth,
        experience_years: mappedPayload.experience_years,
        hourly_rate: mappedPayload.hourly_rate,
        bio: mappedPayload.bio,
        user_image_base64: mappedPayload.user_image_base64,
        user_image: mappedPayload.user_image,
        certificate_base64: mappedPayload.certificate_base64,
        certificate: mappedPayload.certificate,
      }),
    });
  }

  return request("profiles/syttrs", {
    method: "POST",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
      "Content-Type": "application/json",
    },
    timeoutMs: hasBinaryUpload ? PROFILE_UPLOAD_REQUEST_TIMEOUT_MS : undefined,
    body: JSON.stringify(mappedPayload),
  });
}

export async function registerNannyWithProfile(
  payload: ProfilePayload
) {
  const fullName = String(
    payload?.fullname ||
      payload?.name ||
      `${String(payload?.first_name || "").trim()} ${String(payload?.last_name || "").trim()}`.trim()
  ).trim();
  const email = String(payload?.email || "").trim().toLowerCase();
  const password = String(payload?.password || "").trim();
  const passwordConfirmation = String(
    payload?.password_confirmation || payload?.confirm || password
  ).trim();

  if (!fullName || !email || !password || !passwordConfirmation) {
    throw new Error("Missing signup fields (name/email/password)");
  }

  const extractAuthFields = (response: any) => ({
    token: String(
      response?.token ||
        response?.access_token ||
        response?.data?.token ||
        response?.data?.access_token ||
        ""
    ).trim(),
    userId: String(
      response?.user_id ||
        response?.data?.user_id ||
        response?.user?.user_id ||
        response?.data?.user?.user_id ||
        response?.user?.id ||
        response?.data?.user?.id ||
        response?.id ||
        response?.data?.id ||
        ""
    ).trim(),
    user: response?.user || response?.data?.user || null,
  });

  const shouldFallbackToLogin = (error: any) => {
    const message = String(error?.message || "").toLowerCase();
    return (
      error?.status === 422 ||
      message.includes("timed out") ||
      message.includes("already been taken") ||
      message.includes("already exists") ||
      message.includes("duplicate")
    );
  };

  const loginWithRetries = async (attempts = 3) => {
    let lastError: any = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      try {
        return await loginNanny({
          email,
          password,
        });
      } catch (error: any) {
        lastError = error;
      }
    }

    throw lastError || new Error("Unable to log in after signup.");
  };

  let authToken = "";
  let userId = "";
  let authUser: any = null;
  try {
    const signupResp: any = await request("signup/syttr", {
      method: "POST",
      body: JSON.stringify({
        name: fullName,
        email,
        password,
      }),
    });
    const extracted = extractAuthFields(signupResp);
    authToken = extracted.token;
    userId = extracted.userId;
    authUser = extracted.user;
  } catch (error: any) {
    if (!shouldFallbackToLogin(error)) {
      throw error;
    }
    const loginResp: any = await loginWithRetries();
    const extracted = extractAuthFields(loginResp);
    authToken = extracted.token;
    userId = extracted.userId;
    authUser = extracted.user;
  }

  if (!userId) {
    throw new Error("Signup completed but user_id was not returned.");
  }

  const profileResp = await updateNannyProfile(
    {
      ...payload,
      user_id: userId,
      nanny_id: userId,
    },
    authToken || undefined
  );

  return {
    ...(typeof profileResp === "object" && profileResp ? profileResp : {}),
    token: authToken,
    user_id: userId,
    user: authUser || (profileResp as any)?.user || undefined,
  };
}

type AvailabilityPayload = {
  availability: Array<{
    day: string;
    date?: string;
    time_slots: Array<{ period: string; time?: string; start_time?: string; end_time?: string }>;
  }>;
};

type CalendarSlot = {
  date: string;
  times?: string[];
  slots?: Array<{ start_time: string; end_time: string }>;
};

export async function getNannyAvailability(token?: string, nannyId?: string) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  try {
    const profiles = await request<any[]>(
      `profiles/syttrs?user_id=${encodeURIComponent(String(nannyId || ""))}`,
      {
        method: "GET",
        headers: {
          ...(authHeaders.Authorization ? authHeaders : {}),
        },
      }
    );
    const profileId = Array.isArray(profiles) && profiles.length ? profiles[0]?.id : undefined;
    if (!profileId) throw new Error("Syttr profile not found");
    return request(`syttrs/availabilities?syttr_profile_id=${encodeURIComponent(String(profileId))}`, {
      method: "GET",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
      },
    });
  } catch {
    const query = nannyId ? `?nanny_id=${encodeURIComponent(nannyId as string)}` : "";
    return request(`nanny/getavailability${query}`, {
      method: "GET",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
      },
    });
  }
}

export async function updateNannyAvailability(
  payload: AvailabilityPayload & {
    nanny_id?: string;
    mode?: 'weekly' | 'calendar';
    calendar_slots?: CalendarSlot[] | Record<string, string[] | Array<{ start_time: string; end_time: string }>>;
  },
  token?: string
) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  const { nanny_id, availability, mode, calendar_slots } = payload;
  const bodyPayload: Record<string, any> = {
    ...(nanny_id ? { nanny_id } : {}),
    ...(mode ? { mode } : {}),
    ...(calendar_slots ? { calendar_slots } : {}),
    availability: availability ?? [],
  };
  try {
    const profiles = await request<any[]>(
      `profiles/syttrs?user_id=${encodeURIComponent(String(nanny_id || ""))}`,
      {
        method: "GET",
        headers: {
          ...(authHeaders.Authorization ? authHeaders : {}),
        },
      }
    );
    const profileId = Array.isArray(profiles) && profiles.length ? profiles[0]?.id : undefined;
    if (!profileId) throw new Error("Syttr profile not found");

    const normalizedAvailability = (availability || []).map((entry: any) => ({
      day: entry.day,
      date: entry.date,
      time_slots: entry.time_slots || [],
    }));

    return request(`syttrs/availabilities`, {
      method: "POST",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        syttr_profile_id: profileId,
        mode: mode || "weekly",
        calendar_slots,
        availability: normalizedAvailability,
      }),
    });
  } catch {
    const query = payload.nanny_id ? `?nanny_id=${encodeURIComponent(payload.nanny_id)}` : "";
    return request(`nanny/availability${query}`, {
      method: "POST",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
        ...(payload.nanny_id ? { "nanny-id": payload.nanny_id, nanny_id: payload.nanny_id } : {}),
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(bodyPayload),
    });
  }
}

export async function getNannyRatingSummary(
  nannyId: string | number,
  token?: string,
  apiKey?: string
) {
  const cleanApiKey = String(apiKey || "").trim() || getRuntimeApiKey();
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  const normalizedNannyId = String(nannyId).trim();

  const query = `?nanny_id=${encodeURIComponent(normalizedNannyId)}`;
  const candidatePaths = [
    `nanny/rating-summary${query}`,
    `nanny/ratings/summary${query}`,
    `ratings/nanny-summary${query}`,
    `ratings/summary${query}`,
  ];
  const postCandidatePaths = [
    "nanny/rating-summary",
    "nanny/ratings/summary",
    "ratings/nanny-summary",
    "ratings/summary",
  ];

  let lastError: any = null;
  for (const path of candidatePaths) {
    try {
      return await request(path, {
        method: "GET",
        headers: {
          ...(authHeaders.Authorization ? authHeaders : {}),
          ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
          "X-Requested-With": "XMLHttpRequest",
        },
      });
    } catch (error: any) {
      if (error?.status === 404 || error?.status === 405) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  for (const path of postCandidatePaths) {
    try {
      return await request(path, {
        method: "POST",
        headers: {
          ...(authHeaders.Authorization ? authHeaders : {}),
          ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          nanny_id: normalizedNannyId,
          user_id: normalizedNannyId,
        }),
      });
    } catch (error: any) {
      if (error?.status === 404 || error?.status === 405) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("Unable to load rating summary.");
}

type StripeConnectResponse = {
  onboarding_url?: string;
  url?: string;
  [key: string]: any;
};

export async function createStripeConnectAccount(
  token?: string
) {
  const cleanToken = sanitizeToken(token);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();
  return request<StripeConnectResponse>('stripe/connect', {
    method: 'POST',
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
}

type WalletWithdrawResponse = {
  success?: boolean;
  message?: string;
  balance?: number;
  gross_amount?: number;
  commission_amount?: number;
  net_amount?: number;
  commission_type?: "percentage" | "flat" | string;
  commission_value?: number;
  withdrawal?: {
    gross_amount?: number;
    commission_amount?: number;
    net_amount?: number;
    commission_type?: "percentage" | "flat" | string;
    commission_value?: number;
    currency?: string;
  };
  transaction?: WalletTransaction;
  [key: string]: any;
};

type WalletBalanceResponse = {
  balance?: number;
  [key: string]: any;
};

type WalletTransaction = {
  id?: string | number;
  amount?: number | string;
  type?: string;
  status?: string;
  created_at?: string;
  [key: string]: any;
};

type WalletTransactionsResponse = {
  success?: boolean;
  data?: WalletTransaction[];
  transactions?: WalletTransaction[];
  [key: string]: any;
};

export async function getWalletBalance(token?: string) {
  const cleanToken = sanitizeToken(token);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();
  return request<WalletBalanceResponse>('wallet', {
    method: 'GET',
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
}

export async function getWalletTransactions(token?: string) {
  const cleanToken = sanitizeToken(token);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();
  return request<WalletTransactionsResponse>('wallet/transactions', {
    method: 'GET',
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
}

export async function getPlatformCommission(
  token?: string,
  apiKey?: string,
  nannyId?: string | number
) {
  const cleanApiKey = String(apiKey || "").trim() || getRuntimeApiKey();
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  const normalizedNannyId = String(nannyId || "").trim();
  const query = normalizedNannyId
    ? `?nanny_id=${encodeURIComponent(normalizedNannyId)}&user_id=${encodeURIComponent(normalizedNannyId)}`
    : "";

  const candidatePaths = [
    `nanny/platform-fee/commission${query}`,
    `platform-fee/commission${query}`,
    `nanny/commission${query}`,
    `commission${query}`,
  ];
  const postCandidatePaths = [
    "nanny/platform-fee/commission",
    "platform-fee/commission",
    "nanny/commission",
    "commission",
  ];

  let lastError: any = null;
  for (const path of candidatePaths) {
    try {
      return await request<any>(path, {
        method: "GET",
        headers: {
          ...(authHeaders.Authorization ? authHeaders : {}),
          ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
          "X-Requested-With": "XMLHttpRequest",
        },
      });
    } catch (error: any) {
      if (error?.status === 404 || error?.status === 405) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  for (const path of postCandidatePaths) {
    try {
      return await request<any>(path, {
        method: "POST",
        headers: {
          ...(authHeaders.Authorization ? authHeaders : {}),
          ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          nanny_id: normalizedNannyId || undefined,
          user_id: normalizedNannyId || undefined,
        }),
      });
    } catch (error: any) {
      if (error?.status === 404 || error?.status === 405) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("Unable to load platform commission.");
}

export async function withdrawFromWallet(
  amount: number,
  token?: string,
  options?: {
    note?: string;
    payoutMethod?: string;
  }
) {
  const cleanToken = sanitizeToken(token);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();
  return request<WalletWithdrawResponse>('wallet/withdraw', {
    method: 'POST',
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount,
      note: options?.note,
      payout_method: options?.payoutMethod,
    }),
  });
}

type PayoutMethodPayload = {
  type: "bank" | "card";
  token_id: string;
};

export async function addStripeExternalAccount(payload: PayoutMethodPayload, token?: string) {
  const cleanToken = sanitizeToken(token);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();
  return request('stripe/external-account', {
    method: 'POST',
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function scheduleNannyInterview(
  payload: { nanny_id: string | number; interview_date: string; interview_time: string },
  token?: string,
  apiKey?: string
) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  const cleanApiKey = String(apiKey || "").trim() || getRuntimeApiKey();
  const form = new FormData();
  form.append("nanny_id", String(payload.nanny_id));
  form.append("interview_date", payload.interview_date);
  form.append("interview_time", payload.interview_time);

  return request("interview-schedule", {
    method: "POST",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
      "X-Requested-With": "XMLHttpRequest",
    },
    body: form as any,
  });
}

export async function checkNannyApprovalStatus(
  payload: { nanny_id: string | number },
  token?: string,
  apiKey?: string
) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  const cleanApiKey = String(apiKey || "").trim() || getRuntimeApiKey();
  const form = new FormData();
  form.append("nanny_id", String(payload.nanny_id));
  return request("profile-status", {
    method: "POST",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
      "X-Requested-With": "XMLHttpRequest",
    },
    body: form as any,
  });
}

export async function checkAdminNannyProfileStatus(
  payload: { nanny_id: string | number },
  token?: string,
  apiKey?: string
) {
  return checkNannyApprovalStatus(payload, token, apiKey);
}

type KidPayload = {
  name?: string;
  age?: number;
  gender?: string;
  allergies?: string;
  medical_conditions?: string;
  notes?: string;
};

const extractParentProfileId = (payload: any): string | number | undefined => {
  if (payload === null || payload === undefined) return undefined;

  const pickId = (value: any): string | number | undefined => {
    const candidate =
      value?.user_id ??
      value?.profile_id ??
      value?.parent_profile_id ??
      value?.parentProfileId ??
      value?.id;
    if (candidate === null || candidate === undefined) return undefined;
    const normalized = String(candidate).trim();
    return normalized ? candidate : undefined;
  };

  const queue: any[] = [];
  if (Array.isArray(payload)) queue.push(...payload);
  if (Array.isArray(payload?.data)) queue.push(...payload.data);
  if (Array.isArray(payload?.profiles)) queue.push(...payload.profiles);
  if (Array.isArray(payload?.items)) queue.push(...payload.items);
  if (Array.isArray(payload?.results)) queue.push(...payload.results);
  if (payload?.profile) queue.push(payload.profile);
  if (payload?.parent_profile) queue.push(payload.parent_profile);
  if (payload?.parentProfile) queue.push(payload.parentProfile);
  if (payload?.data && !Array.isArray(payload.data)) queue.push(payload.data);

  const directId = pickId(payload);
  if (directId) return directId;

  for (const item of queue) {
    const profileId = pickId(item);
    if (profileId) return profileId;
  }
  return undefined;
};

async function getOrCreateParentProfileId(
  userId: string | number,
  authHeaders: { Authorization: string }
): Promise<string | number> {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    throw new Error("user_id is required");
  }

  const profiles = await request<any[]>(
    `profiles/parents?user_id=${encodeURIComponent(normalizedUserId)}`,
    {
      method: "GET",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
      },
    }
  );
  const existingProfileId = extractParentProfileId(profiles);
  if (existingProfileId) return existingProfileId;

  const createdProfile = await request<any>("profiles/parents", {
    method: "POST",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: normalizedUserId }),
  });
  let createdProfileId = extractParentProfileId(createdProfile);
  if (!createdProfileId) {
    const profilesAfterCreate = await request<any>(
      `profiles/parents?user_id=${encodeURIComponent(normalizedUserId)}`,
      {
        method: "GET",
        headers: {
          ...(authHeaders.Authorization ? authHeaders : {}),
        },
      }
    );
    createdProfileId = extractParentProfileId(profilesAfterCreate);
  }
  if (!createdProfileId) {
    throw new Error("Parent profile not found");
  }
  return createdProfileId;
}

export async function addKid(payload: KidPayload, token?: string) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  try {
    const userId = (payload as any).user_id;
    const parentProfileId = await getOrCreateParentProfileId(userId, authHeaders);
    return request("parents/kids", {
      method: "POST",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent_profile_id: parentProfileId,
        name: payload.name,
        age: payload.age,
        gender: payload.gender,
        allergies: payload.allergies,
        medical_conditions: payload.medical_conditions,
        notes: payload.notes,
      }),
    });
  } catch (error: any) {
    throw error;
  }
}

export async function viewKid(payload: { user_id: string | number }, token?: string) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  return request(`user/${encodeURIComponent(String(payload.user_id))}/kids`, {
    method: 'GET',
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
    },
  });
}

export async function deleteKid(id: string | number, token?: string) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  return request(`parents/kids/${id}`, {
    method: "DELETE",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
    },
  });
}

export async function getUserKids(userId: string | number, token?: string) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();
  try {
    const parentProfileId = await getOrCreateParentProfileId(userId, authHeaders);
    return request(`parents/kids?parent_profile_id=${encodeURIComponent(String(parentProfileId))}`, {
      method: "GET",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
      },
    });
  } catch (error: any) {
    if (error?.status !== 404) {
      throw error;
    }
    return request(`user/${userId}/kids`, {
      method: "GET",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
      },
    });
  }
}

export async function updateKid(
  payload: {
    name?: string;
    age?: number;
    gender?: string;
    allergies?: string;
    medical_conditions?: string;
    notes?: string;
  },
  kidId: string | number,
  token?: string
) {
  const authHeaders = token
    ? { Authorization: `Bearer ${sanitizeToken(token)}` }
    : await getAuthHeaders();

  return request(`parents/kids/${kidId}`, {
    method: "PATCH",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteJob(
  jobId: string | number,
  userId: string | number,
  token?: string,
  apiKey?: string
) {
  const cleanToken = sanitizeToken(token || undefined);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();
  const cleanApiKey = String(apiKey || "").trim() || getRuntimeApiKey();

  try {
    return request(`job/${encodeURIComponent(String(jobId))}`, {
      method: "DELETE",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
        ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
      },
      body: JSON.stringify({
        user_id: String(userId),
      }),
    });
  } catch (error: any) {
    if (error?.status !== 404 && error?.status !== 405) {
      throw error;
    }
    return request(`job/delete/${encodeURIComponent(String(jobId))}`, {
      method: "POST",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
        ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: String(userId),
      }),
    });
  }
}

export async function getSubscriptionStatus(
  token?: string,
  userId?: string | number
) {
  const cleanToken = sanitizeToken(token || undefined);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();
  const query =
    userId !== undefined && userId !== null && String(userId).trim() !== ""
      ? `?user_id=${encodeURIComponent(String(userId).trim())}`
      : "";

  try {
    return request(`subscription/status${query}`, {
      method: "GET",
      headers: {
        ...(authHeaders.Authorization ? authHeaders : {}),
      },
    });
  } catch (error: any) {
    if (error?.status === 404) {
      return {
        success: true,
        subscribed: false,
        status: "inactive",
      };
    }
    throw error;
  }
}

export async function getSubscriptionPlans(token?: string) {
  const cleanToken = sanitizeToken(token || undefined);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();

  return request("subscription/plans", {
    method: "GET",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
    },
  });
}

type SubscriptionActionPayload = {
  user_id?: string | number;
  reason?: string;
};

const postSubscriptionAction = async (
  action: "pause" | "resume" | "cancel",
  payload?: SubscriptionActionPayload,
  token?: string
) => {
  const cleanToken = sanitizeToken(token || undefined);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();

  return request(`subscription/${action}`, {
    method: "POST",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
};

export async function pauseSubscription(
  payload?: SubscriptionActionPayload,
  token?: string
) {
  return postSubscriptionAction("pause", payload, token);
}

export async function resumeSubscription(
  payload?: SubscriptionActionPayload,
  token?: string
) {
  return postSubscriptionAction("resume", payload, token);
}

export async function cancelSubscription(
  payload?: SubscriptionActionPayload,
  token?: string
) {
  return postSubscriptionAction("cancel", payload, token);
}

type FavoriteSyttrPayload = {
  user_id?: string | number;
  syttr_user_id?: string | number;
  nanny_id?: string | number;
  syttr_id?: string | number;
};

const normalizeVerificationSignal = (value?: string | null) =>
  String(value || "").trim().toLowerCase();

export const isRejectedVerificationStatus = (value?: string | null) => {
  const raw = normalizeVerificationSignal(value);
  if (!raw) return false;
  return (
    raw.includes("reject") ||
    raw.includes("declin") ||
    raw.includes("blacklist") ||
    raw.includes("fail") ||
    raw.includes("deny")
  );
};

export const isApprovedVerificationStatus = (value?: string | null) => {
  const raw = normalizeVerificationSignal(value);
  if (!raw) return false;
  if (isRejectedVerificationStatus(raw)) return false;

  // QuickApp milestones indicate the applicant flow, not final verification approval.
  if (
    raw.includes("order.quickapp.created") ||
    raw.includes("order.quickapp.completed") ||
    raw.includes("quickapp.created") ||
    raw.includes("quickapp.completed")
  ) {
    return false;
  }

  if (
    raw.includes("accept") ||
    raw.includes("approved") ||
    raw.includes("verified") ||
    raw.includes("clear") ||
    raw.includes("passed")
  ) {
    return true;
  }

  return raw === "completed" || raw === "complete";
};

type VerificationSourcePayload = {
  adminStatus?: string | null;
  profileStatus?: string | null;
  tazDecisionStatus?: string | null;
  tazEventStatus?: string | null;
  tazStatus?: string | null;
  isVerified?: boolean | null;
  verificationRequired?: boolean | null;
};

export const isUserRejectedFromSources = (payload: VerificationSourcePayload) => {
  const statusValues = [
    payload.adminStatus,
    payload.profileStatus,
    payload.tazDecisionStatus,
    payload.tazEventStatus,
    payload.tazStatus,
  ];
  return statusValues.some((value) => isRejectedVerificationStatus(value));
};

export const isUserVerifiedFromSources = (payload: VerificationSourcePayload) => {
  if (payload.isVerified === true) {
    return true;
  }
  const statusValues = [
    payload.adminStatus,
    payload.profileStatus,
    payload.tazDecisionStatus,
    payload.tazEventStatus,
    payload.tazStatus,
  ];
  return statusValues.some((value) => isApprovedVerificationStatus(value));
};

export async function getFavoriteSyttrs(
  userId?: string | number,
  token?: string
) {
  const cleanToken = sanitizeToken(token || undefined);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();
  const query =
    userId !== undefined && userId !== null && String(userId).trim() !== ""
      ? `?user_id=${encodeURIComponent(String(userId))}`
      : "";
  return request(`favorite-syttrs${query}`, {
    method: "GET",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
    },
  });
}

export async function addFavoriteSyttr(
  payload: FavoriteSyttrPayload,
  token?: string
) {
  const cleanToken = sanitizeToken(token || undefined);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();
  return request("favorite-syttrs/store", {
    method: "POST",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function removeFavoriteSyttr(
  id: string | number,
  payload?: { user_id?: string | number },
  token?: string
) {
  const cleanToken = sanitizeToken(token || undefined);
  const authHeaders = cleanToken
    ? { Authorization: `Bearer ${cleanToken}` }
    : await getAuthHeaders();
  return request(`favorite-syttrs/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
    headers: {
      ...(authHeaders.Authorization ? authHeaders : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
}


export { BASE_URL };



export default function RouteShim() {
  return null as any;
}
