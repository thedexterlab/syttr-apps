import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { apiRequest, BASE_URL, getRuntimeApiKey, sanitizeToken } from "../Api";

export type PaymentMethod = {
  id: string;
  type: "card" | "apple_pay" | "venmo" | string;
  lastFour?: string;
  name?: string;
  expiry?: string;
  cvcLast?: string;
  brand?: string;
  isDefault?: boolean;
};

const getField = (item: any, keys: string[]) => {
  for (const key of keys) {
    if (item?.[key] !== undefined) return item[key];
  }
  return undefined;
};

const parseExpiry = (expiry?: string) => {
  const raw = String(expiry || "").trim();
  if (!raw) return { expMonth: undefined as number | undefined, expYear: undefined as number | undefined };
  const [monthRaw, yearRaw] = raw.split("/");
  const month = Number.parseInt(String(monthRaw || "").trim(), 10);
  const yearPart = String(yearRaw || "").trim();
  let year = Number.parseInt(yearPart, 10);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return { expMonth: undefined, expYear: undefined };
  }
  if (!Number.isFinite(year)) {
    return { expMonth: month, expYear: undefined };
  }
  if (yearPart.length === 2) {
    year += 2000;
  }
  return { expMonth: month, expYear: year };
};

const normalizePaymentType = (name?: string, type?: string) => {
  const normalizedName = name?.trim().toLowerCase();
  if (normalizedName?.includes("apple pay")) return "apple_pay";
  if (normalizedName?.startsWith("venmo")) return "venmo";
  return type || "card";
};

const normalizePaymentMethod = (item: any): PaymentMethod => {
  const name = typeof item?.name === "string" ? item.name : undefined;
  const expMonth = Number(getField(item, ["exp_month", "expMonth"]));
  const expYear = Number(getField(item, ["exp_year", "expYear"]));

  return {
    id: String(item?.id ?? ""),
    type: normalizePaymentType(name, item?.type),
    name,
    lastFour: getField(item, ["last4", "last_four", "lastFour"]),
    expiry:
      Number.isFinite(expMonth) && Number.isFinite(expYear)
        ? `${expMonth}/${expYear}`
        : getField(item, ["expiry"]),
    brand: getField(item, ["brand"]),
    cvcLast: getField(item, ["cvc_last", "cvcLast"]),
    isDefault: Boolean(getField(item, ["is_default", "isDefault"])),
  };
};

const sortPaymentMethods = (items: PaymentMethod[]) =>
  [...items].sort((a, b) => {
    if (Boolean(a.isDefault) !== Boolean(b.isDefault)) {
      return a.isDefault ? -1 : 1;
    }

    const aId = Number.parseInt(String(a.id || ""), 10);
    const bId = Number.parseInt(String(b.id || ""), 10);
    if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) {
      return bId - aId;
    }

    return String(b.id || "").localeCompare(String(a.id || ""));
  });

const cleanStoredValue = (value?: string | null) =>
  String(value || "").trim().replace(/^["']+|["']+$/g, "");

const looksLikePublicUserId = (value?: string | null) => {
  const raw = cleanStoredValue(value).toUpperCase();
  return raw.length >= 5 && /[A-Z]/.test(raw) && /\d/.test(raw);
};

const looksNumericOnly = (value?: string | null) => /^\d+$/.test(cleanStoredValue(value));

const pickBestUserId = (candidates: Array<string | null | undefined>) => {
  for (const candidate of candidates) {
    if (looksLikePublicUserId(candidate)) {
      return cleanStoredValue(candidate).toUpperCase();
    }
  }
  for (const candidate of candidates) {
    const raw = cleanStoredValue(candidate);
    if (raw) return raw;
  }
  return "";
};

export function usePaymentMethodsStore() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const getRequestContext = useCallback(async () => {
    const [
      rawToken,
      rawNannyToken,
      rawAccessToken,
      apiKeyStored,
      userTypeStored,
      userIdStored,
      nannyIdStored,
      legacyIdStored,
      userEmailStored,
      nannyEmailStored,
    ] = await Promise.all([
      AsyncStorage.getItem("token"),
      AsyncStorage.getItem("nanny_token"),
      AsyncStorage.getItem("access_token"),
      AsyncStorage.getItem("api_key"),
      AsyncStorage.getItem("user_type"),
      AsyncStorage.getItem("user_id"),
      AsyncStorage.getItem("nanny_id"),
      AsyncStorage.getItem("id"),
      AsyncStorage.getItem("user_email"),
      AsyncStorage.getItem("nanny_email"),
    ]);
    const token = sanitizeToken(rawToken || rawNannyToken || rawAccessToken || undefined);
    const apiKey =
      apiKeyStored ||
      getRuntimeApiKey() ||
      (typeof process !== "undefined" ? (process as any)?.env?.EXPO_PUBLIC_API_KEY : undefined) ||
      undefined;
    const userType = cleanStoredValue(userTypeStored).toLowerCase();
    const primaryCandidates =
      userType === "nanny" || userType === "syttr"
        ? [nannyIdStored, userIdStored, legacyIdStored]
        : [userIdStored, nannyIdStored, legacyIdStored];
    const resolvedUserId = pickBestUserId(primaryCandidates);
    const shouldTrustBodyUserId =
      looksLikePublicUserId(resolvedUserId) || (!token && looksNumericOnly(resolvedUserId));
    const userId = shouldTrustBodyUserId ? resolvedUserId : "";
    const userEmail = cleanStoredValue(
      userType === "nanny" || userType === "syttr" ? nannyEmailStored || userEmailStored : userEmailStored || nannyEmailStored
    ).toLowerCase();

    const repairSets: Array<[string, string]> = [];
    if (token && cleanStoredValue(rawToken) !== token) {
      repairSets.push(["token", token]);
    }
    if (looksLikePublicUserId(resolvedUserId)) {
      if (cleanStoredValue(userIdStored).toUpperCase() !== resolvedUserId) {
        repairSets.push(["user_id", resolvedUserId]);
      }
      if ((userType === "nanny" || userType === "syttr") && cleanStoredValue(nannyIdStored).toUpperCase() !== resolvedUserId) {
        repairSets.push(["nanny_id", resolvedUserId]);
      }
    }
    if (repairSets.length) {
      await AsyncStorage.multiSet(repairSets);
    }

    return {
      token,
      apiKey,
      userId,
      userEmail,
    };
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { token, apiKey, userId, userEmail } = await getRequestContext();
      const queryParts = [
        ...(userId ? [`user_id=${encodeURIComponent(userId)}`] : []),
        ...(!userId && userEmail ? [`user_email=${encodeURIComponent(userEmail)}`] : []),
      ];
      const query = queryParts.length ? `?${queryParts.join("&")}` : "";
      const json = await apiRequest<any>(`payment-method${query}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
      });
      const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      setMethods(sortPaymentMethods(list.map((item: any) => normalizePaymentMethod(item))));
    } catch {
      setMethods([]);
    } finally {
      setIsLoading(false);
    }
  }, [getRequestContext]);

  useEffect(() => {
    load();
  }, [load]);

  const addPaymentMethod = async (payload: {
    type: string;
    stripePaymentMethodId?: string;
    name?: string;
    brand?: string;
    lastFour?: string;
    expiry?: string;
    cvcLast?: string;
    isDefault?: boolean;
  }) => {
    if (!payload.stripePaymentMethodId) {
      throw new Error("Missing Stripe payment method id.");
    }
    const { token, apiKey, userId, userEmail } = await getRequestContext();
    if (!token && !userId && !userEmail) {
      throw new Error("Unable to resolve user. Please sign in again.");
    }
    const shouldMakeDefault = payload.isDefault ?? true;
    const { expMonth, expYear } = parseExpiry(payload.expiry);
    const json = await apiRequest<any>("payment-methods/store", {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        user_id: userId || undefined,
        user_email: userEmail || undefined,
        token: token || undefined,
        stripe_payment_method_id: payload.stripePaymentMethodId,
        type: payload.type || "card",
        brand: payload.brand,
        last4: payload.lastFour,
        exp_month: expMonth,
        exp_year: expYear,
        is_default: shouldMakeDefault,
      }),
    });
    const root = json?.data && typeof json.data === "object" ? json.data : json;
    const preferredType =
      ["apple_pay", "venmo"].includes(payload.type)
        ? payload.type
        : root?.type || payload.type;
    const normalizedRoot = normalizePaymentMethod(root);
    const next: PaymentMethod = {
      ...normalizedRoot,
      id: normalizedRoot.id || String(root?.id ?? `temp-${Date.now()}`),
      type: preferredType,
      name: normalizedRoot.name || payload.name,
      lastFour: normalizedRoot.lastFour || payload.lastFour,
      expiry: normalizedRoot.expiry || payload.expiry,
      brand: normalizedRoot.brand || payload.brand,
      cvcLast: normalizedRoot.cvcLast || payload.cvcLast,
      isDefault: normalizedRoot.isDefault || shouldMakeDefault,
    };
    setMethods((prev) =>
      sortPaymentMethods([
        next,
        ...prev
          .filter((method) => method.id !== next.id)
          .map((method) =>
            next.isDefault ? { ...method, isDefault: false } : method
          ),
      ])
    );
    return next;
  };

  const createPaymentMethodSetupIntent = async (payload?: { type?: string }) => {
    const { token, apiKey, userId, userEmail } = await getRequestContext();
    if (!token && !userId && !userEmail) {
      throw new Error("Unable to resolve user. Please sign in again.");
    }

    const json = await apiRequest<any>("payment-methods/setup-intent", {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        user_id: userId || undefined,
        user_email: userEmail || undefined,
        token: token || undefined,
        type: payload?.type || "card",
      }),
    });

    const root = json?.data && typeof json.data === "object" ? json.data : json;
    const clientSecret = String(root?.client_secret || "").trim();
    if (!clientSecret) {
      throw new Error("Unable to prepare payment method setup");
    }

    return {
      clientSecret,
      setupIntentId: String(root?.setup_intent_id || "").trim(),
      customerId: String(root?.customer_id || "").trim(),
    };
  };

  const removePaymentMethod = async (id: string) => {
    const { token, apiKey, userId, userEmail } = await getRequestContext();
    const queryParts = [
      ...(userId ? [`user_id=${encodeURIComponent(userId)}`] : []),
      ...(!userId && userEmail ? [`user_email=${encodeURIComponent(userEmail)}`] : []),
    ];
    const query = queryParts.length ? `?${queryParts.join("&")}` : "";
    await apiRequest(`payment-methods/${id}${query}`, {
      method: "DELETE",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
    });
    setMethods((prev) => prev.filter((method) => method.id !== id));
  };

  return {
    methods,
    addPaymentMethod,
    createPaymentMethodSetupIntent,
    removePaymentMethod,
    reload: load,
    isLoading,
  };
}

export default function RouteShim() {
  return null as any;
}
