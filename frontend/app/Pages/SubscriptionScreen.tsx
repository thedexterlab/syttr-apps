import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BASE_URL,
  apiRequest,
  cancelSubscription,
  getSubscriptionPlans,
  getSubscriptionStatus,
  isVerificationRequiredApiError,
  pauseSubscription,
  resumeSubscription,
  sanitizeToken
} from "../Api";
import SafeScreen from "../components/SafeScreen";
import { usePaymentMethodsStore, type PaymentMethod } from "../components/paymentMethodsStore";
import { hp, rf, rs, wp } from "../utils/responsive";

type Props = {
  navigation?: any;
  onBack?: () => void;
  onAddPaymentMethod?: () => void;
  onRequireVerification?: () => void;
};

type BillingHistoryItem = {
  id: string;
  description: string;
  category: "background_check" | "subscription" | "job" | "other";
  amountLabel: string;
  statusLabel: string;
  dateLabel: string;
  createdAtRaw: string;
};

type SubscriptionStatus = "active" | "paused" | "canceled" | "inactive";

type SubscriptionPlanConfig = {
  id?: number | null;
  slug: string;
  name: string;
  description: string;
  amount: number;
  currency: string;
  interval_unit: string;
  interval_count: number;
  billing_label: string;
  trial_days: number;
  renewal_mode: string;
  cancellation_notice_days: number;
  stripe_price_id?: string | null;
  features: string[];
  is_default?: boolean;
  is_active?: boolean;
};

const normalizeSubscriptionStatus = (value: any): SubscriptionStatus => {
  const status = String(value || "").trim().toLowerCase();
  if (status === "active") return "active";
  if (status === "paused") return "paused";
  if (status === "canceled" || status === "cancelled") return "canceled";
  return "inactive";
};

const getSubscriptionStatusLabel = (status: SubscriptionStatus) => {
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  if (status === "canceled") return "Canceled";
  return "Inactive";
};

const parseBillingDateMs = (value?: string) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatBillingDateLabel = (value?: string) => {
  if (!value) return "Date unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatBillingAmount = (value: any) => {
  if (value === undefined || value === null || value === "") return "--";
  const raw = String(value).trim();
  if (!raw) return "--";
  const num = Number(raw.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(num)) {
    const normalized = raw.replace(/\$/g, "").trim();
    return normalized ? `$${normalized}` : raw;
  }
  const abs = Math.abs(num).toFixed(2);
  return num < 0 ? `-$${abs}` : `$${abs}`;
};

const resolveBillingCategory = (description: string, typeRaw: string) => {
  const hay = `${description} ${typeRaw}`.toLowerCase();
  if (hay.includes("background") || hay.includes("verification")) return "background_check";
  if (
    hay.includes("subscription") ||
    hay.includes("monthly") ||
    hay.includes("premium") ||
    hay.includes("plan")
  ) {
    return "subscription";
  }
  if (
    hay.includes("job") ||
    hay.includes("booking") ||
    hay.includes("babysitting") ||
    hay.includes("earnings")
  ) {
    return "job";
  }
  return "other";
};

const getBillingArrayFromPayload = (payload: any): any[] | null => {
  const candidates = [
    payload,
    payload?.data,
    payload?.data?.data,
    payload?.transactions,
    payload?.data?.transactions,
    payload?.history,
    payload?.data?.history,
    payload?.billing,
    payload?.data?.billing,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
};

const normalizeBillingHistory = (rows: any[]): BillingHistoryItem[] => {
  const mapped = rows
    .map((row: any, index: number) => {
      const createdAt = String(
        row?.created_at ||
          row?.date ||
          row?.paid_at ||
          row?.updated_at ||
          ""
      ).trim();
      const description = String(
        row?.description ||
          row?.title ||
          row?.reason ||
          row?.note ||
          row?.name ||
          row?.transaction_name ||
          row?.label ||
          ""
      ).trim();
      const typeRaw = String(
        row?.type ||
          row?.transaction_type ||
          row?.category ||
          row?.kind ||
          ""
      ).trim();
      const category = resolveBillingCategory(description, typeRaw);
      const statusLabel = String(
        row?.status || row?.payment_status || row?.state || "Processed"
      ).trim();

      const fallbackDescription =
        category === "background_check"
          ? "Background Check Charge"
          : category === "subscription"
          ? "Subscription Charge"
          : category === "job"
          ? "Job Charge"
          : "Billing Charge";
      const id = String(
        row?.id ||
          row?.transaction_id ||
          row?.invoice_id ||
          row?.payment_id ||
          `${createdAt || "billing"}-${index}`
      );
      return {
        id,
        description: description || fallbackDescription,
        category,
        amountLabel: formatBillingAmount(
          row?.amount ??
            row?.charge_amount ??
            row?.total ??
            row?.value ??
            row?.price
        ),
        statusLabel: statusLabel || "Processed",
        dateLabel: formatBillingDateLabel(createdAt),
        createdAtRaw: createdAt,
      } as BillingHistoryItem;
    })
    .filter((item) => item.description);

  const deduped = new Map<string, BillingHistoryItem>();
  mapped.forEach((item) => {
    const key = `${item.id}-${item.amountLabel}-${item.dateLabel}`;
    if (!deduped.has(key)) deduped.set(key, item);
  });

  return Array.from(deduped.values()).sort(
    (a, b) => parseBillingDateMs(b.createdAtRaw) - parseBillingDateMs(a.createdAtRaw)
  );
};

const DEFAULT_PLAN: SubscriptionPlanConfig = {
  id: null,
  slug: "premium-family",
  name: "Premium Family",
  description: "Unlimited posts, priority matches, and concierge support.",
  amount: 19.99,
  currency: "USD",
  interval_unit: "month",
  interval_count: 1,
  billing_label: "Every month",
  trial_days: 0,
  renewal_mode: "auto",
  cancellation_notice_days: 30,
  stripe_price_id: null,
  features: [
    "Unlimited job posts & edits",
    "Priority Syttr matching",
    "Concierge chat support",
  ],
};

const normalizePlanString = (value: any, fallback = "") =>
  String(value || fallback).trim();

const normalizePlanNumber = (value: any, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeSubscriptionPlan = (value: any): SubscriptionPlanConfig => {
  if (!value || typeof value !== "object") return DEFAULT_PLAN;

  return {
    id: value?.id ?? null,
    slug: normalizePlanString(value?.slug, DEFAULT_PLAN.slug),
    name: normalizePlanString(value?.name, DEFAULT_PLAN.name),
    description: normalizePlanString(value?.description, DEFAULT_PLAN.description),
    amount: normalizePlanNumber(value?.amount, DEFAULT_PLAN.amount),
    currency: normalizePlanString(value?.currency, DEFAULT_PLAN.currency).toUpperCase() || "USD",
    interval_unit: normalizePlanString(value?.interval_unit, DEFAULT_PLAN.interval_unit).toLowerCase() || "month",
    interval_count: Math.max(1, normalizePlanNumber(value?.interval_count, DEFAULT_PLAN.interval_count)),
    billing_label: normalizePlanString(value?.billing_label, DEFAULT_PLAN.billing_label),
    trial_days: Math.max(0, normalizePlanNumber(value?.trial_days, DEFAULT_PLAN.trial_days)),
    renewal_mode: normalizePlanString(value?.renewal_mode, DEFAULT_PLAN.renewal_mode),
    cancellation_notice_days: Math.max(
      0,
      normalizePlanNumber(
        value?.cancellation_notice_days,
        DEFAULT_PLAN.cancellation_notice_days
      )
    ),
    stripe_price_id: normalizePlanString(value?.stripe_price_id) || null,
    features: Array.isArray(value?.features)
      ? value.features
          .map((item: any) => String(item || "").trim())
          .filter(Boolean)
      : DEFAULT_PLAN.features,
    is_default: Boolean(value?.is_default),
    is_active: value?.is_active === undefined ? true : Boolean(value?.is_active),
  };
};

const resolveSubscriptionPlans = (payload: any): SubscriptionPlanConfig[] => {
  const root = payload?.data || payload || {};
  const plans: SubscriptionPlanConfig[] = Array.isArray(root?.plans)
    ? root.plans.map((item: any) => normalizeSubscriptionPlan(item)).filter(Boolean)
    : [];
  const explicitDefault = root?.default_plan ? normalizeSubscriptionPlan(root.default_plan) : null;

  if (explicitDefault) {
    const exists = plans.some(
      (item) =>
        (explicitDefault.id && item.id === explicitDefault.id) ||
        (explicitDefault.slug && item.slug === explicitDefault.slug)
    );
    return exists ? plans : [explicitDefault, ...plans];
  }

  return plans.length ? plans : [DEFAULT_PLAN];
};

const resolveDefaultSubscriptionPlan = (plans: SubscriptionPlanConfig[]): SubscriptionPlanConfig =>
  plans.find((item) => item.is_default) || plans[0] || DEFAULT_PLAN;

const resolvePlanByIdentifier = (
  plans: SubscriptionPlanConfig[],
  identifiers: (string | number | null | undefined)[],
  fallback?: SubscriptionPlanConfig
) => {
  for (const identifier of identifiers) {
    const raw = String(identifier || "").trim().toLowerCase();
    if (!raw) continue;

    const match = plans.find((item) => {
      const id = item.id !== null && item.id !== undefined ? String(item.id).trim().toLowerCase() : "";
      return (
        id === raw ||
        item.slug.trim().toLowerCase() === raw ||
        item.name.trim().toLowerCase() === raw
      );
    });
    if (match) return match;
  }

  return fallback || resolveDefaultSubscriptionPlan(plans);
};

const formatSubscriptionPlanPrice = (plan: SubscriptionPlanConfig) => {
  const amount = Number(plan.amount || 0);
  const currency = normalizePlanString(plan.currency, "USD").toUpperCase() || "USD";
  const label = `${Math.max(1, Number(plan.interval_count || 1)) > 1 ? `${Math.max(1, Number(plan.interval_count || 1))} ${plan.interval_unit}s` : plan.interval_unit}`;

  try {
    const formattedAmount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    return `${formattedAmount} / ${label}`;
  } catch {
    return `$${amount.toFixed(2)} / ${label}`;
  }
};

const showPopup = (title: string, message: string) => {
  const resolvedMessage = String(message || "").trim();
  const resolvedTitle = String(title || "").trim();
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.alert([resolvedTitle, resolvedMessage].filter(Boolean).join("\n\n"));
    return;
  }
  Alert.alert(resolvedTitle || "Message", resolvedMessage || "Something went wrong.");
};

export default function SubscriptionScreen({ navigation, onBack, onAddPaymentMethod, onRequireVerification }: Props) {
  const { methods, reload, isLoading: loadingPaymentMethods } = usePaymentMethodsStore();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const iconSize = Math.max(12, Math.min(18, wp(4)));
  const headerIconSize = Math.max(16, Math.min(20, wp(4.6)));
  const headerTitleSize = Math.min(Math.max(rf(20), 14), 24);
  const contentBottomPad = Math.max(hp(5), insets.bottom + rs(16));
  const isNarrow = width < 360;
  const [availablePlans, setAvailablePlans] = useState<SubscriptionPlanConfig[]>([DEFAULT_PLAN]);
  const [planConfig, setPlanConfig] = useState<SubscriptionPlanConfig>(DEFAULT_PLAN);
  const [selectedPlanSlug, setSelectedPlanSlug] = useState(DEFAULT_PLAN.slug);
  const [subscriptionPlanName, setSubscriptionPlanName] = useState("");
  const [loadingPlanConfig, setLoadingPlanConfig] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>("inactive");
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const [billingHistory, setBillingHistory] = useState<BillingHistoryItem[]>([]);
  const [loadingBillingHistory, setLoadingBillingHistory] = useState(false);
  const [lastBillingDate, setLastBillingDate] = useState("");
  const [cancelScheduledFor, setCancelScheduledFor] = useState("");
  const availablePlansRef = useRef<SubscriptionPlanConfig[]>([DEFAULT_PLAN]);
  const planConfigRef = useRef<SubscriptionPlanConfig>(DEFAULT_PLAN);

  useEffect(() => {
    availablePlansRef.current = availablePlans;
  }, [availablePlans]);

  useEffect(() => {
    planConfigRef.current = planConfig;
  }, [planConfig]);

  const loadPlanConfig = useCallback(async () => {
    setLoadingPlanConfig(true);
    try {
      const token = await AsyncStorage.getItem("token");
      const payload = await getSubscriptionPlans(token || undefined);
      const resolvedPlans = resolveSubscriptionPlans(payload);
      const resolvedPlan = resolveDefaultSubscriptionPlan(resolvedPlans);
      availablePlansRef.current = resolvedPlans;
      planConfigRef.current = resolvedPlan;
      setAvailablePlans(resolvedPlans);
      setPlanConfig(resolvedPlan);
      setSelectedPlanSlug(resolvedPlan.slug);
      return resolvedPlan;
    } catch (error: any) {
      if (isVerificationRequiredApiError(error)) {
        onRequireVerification?.();
      }
      availablePlansRef.current = [DEFAULT_PLAN];
      planConfigRef.current = DEFAULT_PLAN;
      setAvailablePlans([DEFAULT_PLAN]);
      setPlanConfig(DEFAULT_PLAN);
      setSelectedPlanSlug(DEFAULT_PLAN.slug);
      return DEFAULT_PLAN;
    } finally {
      setLoadingPlanConfig(false);
    }
  }, [onRequireVerification]);

  const syncSubscriptionStatus = useCallback(async (fallbackPlan?: SubscriptionPlanConfig) => {
    try {
      const [token, userId] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("user_id"),
      ]);
      const data = await getSubscriptionStatus(
        token || undefined,
        userId || undefined
      );
      const root = data?.data || data || {};
      const candidatePlans = availablePlansRef.current.length
        ? availablePlansRef.current
        : [DEFAULT_PLAN];
      const activePlan = fallbackPlan || planConfigRef.current || DEFAULT_PLAN;
      const status = normalizeSubscriptionStatus(root?.status || data?.status || data?.data?.status);
      const subscribed =
        Boolean(root?.subscribed) ||
        Boolean(root?.is_subscribed) ||
        Boolean(root?.active) ||
        status === "active";
      const plan = String(root?.plan || root?.subscription_plan || "").trim();
      const meta = root?.meta && typeof root.meta === "object" ? root.meta : {};
      const planDetails =
        root?.plan_details && typeof root.plan_details === "object"
          ? normalizeSubscriptionPlan(root.plan_details)
          : data?.data?.plan_details && typeof data.data.plan_details === "object"
          ? normalizeSubscriptionPlan(data.data.plan_details)
          : null;
      const updatedAtRaw = String(
        root?.updated_at || data?.updated_at || data?.data?.updated_at || ""
      ).trim();
      const cancelEffectiveRaw = String(
        meta?.cancel_effective_at || ""
      ).trim();

      setSubscriptionStatus(status);
      setLastBillingDate(updatedAtRaw ? formatBillingDateLabel(updatedAtRaw) : "");
      setCancelScheduledFor(cancelEffectiveRaw ? formatBillingDateLabel(cancelEffectiveRaw) : "");
      if (planDetails) {
        planConfigRef.current = planDetails;
        setPlanConfig(planDetails);
        if (planDetails.slug) {
          setSelectedPlanSlug(planDetails.slug);
          setAvailablePlans((current) => {
            const currentPlans = current.length ? current : [DEFAULT_PLAN];
            const exists = currentPlans.some(
              (item) =>
                (planDetails.id && item.id === planDetails.id) || item.slug === planDetails.slug
            );
            const nextPlans = exists ? currentPlans : [planDetails, ...currentPlans];
            availablePlansRef.current = nextPlans;
            return nextPlans;
          });
        }
      } else if (plan) {
        const matchedPlan = resolvePlanByIdentifier(
          candidatePlans,
          [meta?.plan_slug, plan],
          activePlan
        );
        planConfigRef.current = matchedPlan;
        setPlanConfig(matchedPlan);
        setSelectedPlanSlug(matchedPlan.slug);
      }
      if (subscribed || status === "paused") {
        const resolvedPlanName =
          planDetails?.name || plan || activePlan.name || DEFAULT_PLAN.name;
        setSubscriptionPlanName(resolvedPlanName);
        if (subscribed) {
          await AsyncStorage.setItem("subscription_plan", resolvedPlanName);
        }
      } else {
        setSubscriptionPlanName("");
        await AsyncStorage.removeItem("subscription_plan");
      }
    } catch (error: any) {
      if (isVerificationRequiredApiError(error)) {
        onRequireVerification?.();
        return;
      }
      // Keep the last known subscription state instead of incorrectly rolling back the UI.
    }
  }, [onRequireVerification]);

  const loadBillingHistory = useCallback(async () => {
    setLoadingBillingHistory(true);
    try {
      const [token, userId, storedApiKey] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("api_key"),
      ]);
      const apiKey =
        storedApiKey ||
        (typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_API_KEY : undefined) ||
        undefined;
      const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
      const endpoints = [
        `${BASE_URL}billing/history${query}`,
        `${BASE_URL}billing/transactions${query}`,
        `${BASE_URL}subscription/history${query}`,
        `${BASE_URL}subscription/transactions${query}`,
        `${BASE_URL}wallet/transactions${query}`,
      ];

      let chosenRows: any[] = [];
      let fallbackRows: any[] | null = null;

      for (const url of endpoints) {
        try {
          const res = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(apiKey ? { "x-api-key": apiKey } : {}),
            },
          });
          const payload = await res.json().catch(() => null);
          if (
            !res.ok &&
            isVerificationRequiredApiError({ status: res.status, payload, message: payload?.message })
          ) {
            setBillingHistory([]);
            onRequireVerification?.();
            return;
          }
          if (!res.ok) continue;
          const rows = getBillingArrayFromPayload(payload);
          if (rows === null) continue;
          if (fallbackRows === null) fallbackRows = rows;
          if (rows.length > 0) {
            chosenRows = rows;
            break;
          }
        } catch (error) {
          if (isVerificationRequiredApiError(error)) {
            setBillingHistory([]);
            onRequireVerification?.();
            return;
          }
          // try next endpoint
        }
      }

      const sourceRows = chosenRows.length ? chosenRows : fallbackRows || [];
      const normalized = normalizeBillingHistory(sourceRows);
      const prioritized = normalized.filter(
        (item) =>
          item.category === "background_check" ||
          item.category === "subscription" ||
          item.category === "job"
      );
      setBillingHistory(prioritized.length ? prioritized : normalized);
    } catch (error: any) {
      if (isVerificationRequiredApiError(error)) {
        onRequireVerification?.();
        return;
      }
      setBillingHistory([]);
    } finally {
      setLoadingBillingHistory(false);
    }
  }, [onRequireVerification]);

  const initializeScreen = useCallback(async () => {
    try {
      const livePlan = await loadPlanConfig();
      await Promise.all([
        syncSubscriptionStatus(livePlan),
        loadBillingHistory(),
        reload(),
      ]);
    } catch (error: any) {
      if (isVerificationRequiredApiError(error)) {
        onRequireVerification?.();
      }
      // keep screen usable even if one of the startup requests fails
    }
  }, [loadBillingHistory, loadPlanConfig, onRequireVerification, reload, syncSubscriptionStatus]);

  useEffect(() => {
    void initializeScreen();
  }, [initializeScreen]);

  useEffect(() => {
    if (!methods.length) {
      if (selectedMethodId !== null) setSelectedMethodId(null);
      return;
    }
    if (!selectedMethodId || !methods.some((method) => String(method.id) === String(selectedMethodId))) {
      setSelectedMethodId(String(methods[0].id));
    }
  }, [methods, selectedMethodId]);

  useEffect(() => {
    if (!availablePlans.length) return;
    const selectedPlan = resolvePlanByIdentifier(availablePlans, [selectedPlanSlug], availablePlans[0]);
    if (selectedPlan.slug !== planConfig.slug || selectedPlan.id !== planConfig.id) {
      setPlanConfig(selectedPlan);
    }
  }, [availablePlans, planConfig.id, planConfig.slug, selectedPlanSlug]);

  const getMethodLabel = (method: PaymentMethod) => {
    if (method.name?.trim()) return method.name;
    if (method.type === "apple_pay") return "Apple Pay";
    if (method.type === "venmo") return "Venmo";
    return "Card";
  };

  const getMethodMeta = (method: PaymentMethod) => {
    if (method.lastFour?.trim()) return `**** ${method.lastFour}`;
    if (method.brand?.trim()) return method.brand;
    return method.type.replace("_", " ");
  };

  const getRequestContext = useCallback(async () => {
    const [tokenRaw, userIdRaw, storedApiKey] = await Promise.all([
      AsyncStorage.getItem("token"),
      AsyncStorage.getItem("user_id"),
      AsyncStorage.getItem("api_key"),
    ]);
    return {
      token: sanitizeToken(tokenRaw || undefined),
      userId: String(userIdRaw || "").trim(),
      apiKey:
        storedApiKey ||
        (typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_API_KEY : undefined) ||
        undefined,
    };
  }, []);

  const handleActivate = async () => {
    if (isProcessing || subscriptionStatus === "active") return;
    if (!selectedMethodId) {
      showPopup("Subscription", "Please select a payment method first.");
      return;
    }
    setIsProcessing(true);
    try {
      const { token, userId, apiKey } = await getRequestContext();

      const payload = {
        user_id: userId || undefined,
        payment_method_id: selectedMethodId,
        plan: planConfig.slug || planConfig.name,
        price_id: planConfig.stripe_price_id || undefined,
      };

      const json = await apiRequest<any>("subscribe", {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (json?.success !== true) {
        if (isVerificationRequiredApiError({ payload: json, message: json?.message })) {
          onRequireVerification?.();
          return;
        }
        const message = json?.message || "Unable to start subscription.";
        throw new Error(message);
      }

      setSubscriptionStatus("active");
      setSubscriptionPlanName(planConfig.name);
      await AsyncStorage.setItem("subscription_plan", planConfig.name);
      await Promise.allSettled([
        syncSubscriptionStatus(planConfig),
        loadBillingHistory(),
      ]);
      showPopup(
        "Thank You",
        `Your ${planConfig.name} subscription is active now.`
      );
    } catch (e: any) {
      if (isVerificationRequiredApiError(e)) {
        onRequireVerification?.();
        return;
      }
      showPopup("Subscription", e?.message || "Unable to start subscription.");
    } finally {
      setIsProcessing(false);
    }
  };

  const performSubscriptionAction = useCallback(
    async (action: "pause" | "resume" | "cancel", reason?: string) => {
      if (isProcessing) return;
      setIsProcessing(true);
      try {
        const { token, userId } = await getRequestContext();
        const payload = {
          user_id: userId || undefined,
          ...(reason ? { reason } : {}),
        };

        let response: any;
        if (action === "pause") {
          response = await pauseSubscription(payload, token || undefined);
        } else if (action === "resume") {
          response = await resumeSubscription(payload, token || undefined);
        } else {
          response = await cancelSubscription(payload, token || undefined);
        }

        if (response?.success === false) {
          if (isVerificationRequiredApiError({ payload: response, message: response?.message })) {
            onRequireVerification?.();
            return;
          }
          throw new Error(response?.message || `Unable to ${action} subscription.`);
        }

        await syncSubscriptionStatus(planConfig);
        await loadBillingHistory();
      } catch (error: any) {
        if (isVerificationRequiredApiError(error)) {
          onRequireVerification?.();
          return;
        }
        showPopup("Subscription", error?.message || "Unable to update subscription.");
      } finally {
        setIsProcessing(false);
      }
    },
    [getRequestContext, isProcessing, loadBillingHistory, onRequireVerification, planConfig, syncSubscriptionStatus]
  );

  const confirmPause = () => {
    Alert.alert("Pause Subscription", "You can resume your plan anytime.", [
      { text: "Keep Active", style: "cancel" },
      { text: "Pause", onPress: () => void performSubscriptionAction("pause") },
    ]);
  };

  const confirmCancel = () => {
    Alert.alert(
      "Cancel Subscription",
      cancelScheduledFor
        ? `Cancellation is already scheduled for ${cancelScheduledFor}.`
        : planConfig.cancellation_notice_days > 0
        ? `Parent subscriptions require ${planConfig.cancellation_notice_days} days' notice. Your plan will stay active until the scheduled end date.`
        : "Cancellation takes effect immediately.",
      [
        { text: "Keep Plan", style: "cancel" },
        ...(cancelScheduledFor
          ? []
          : [
              {
                text: "Request Cancellation",
                style: "destructive" as const,
                onPress: () => void performSubscriptionAction("cancel"),
              },
            ]),
      ]
    );
  };

  const isActiveSubscription = subscriptionStatus === "active";
  const isPausedSubscription = subscriptionStatus === "paused";
  const currentPlan =
    isActiveSubscription || isPausedSubscription || subscriptionStatus === "canceled"
      ? subscriptionPlanName || planConfig.name
      : "Free Plan";
  const planPriceLabel = formatSubscriptionPlanPrice(planConfig);
  const planTrialLabel =
    planConfig.trial_days > 0
      ? `${planConfig.trial_days}-day trial`
      : "No trial period";
  const renewalLabel =
    planConfig.renewal_mode === "manual"
      ? "Manual renewal"
      : planConfig.renewal_mode === "fixed_term"
      ? "Fixed term"
      : "Auto renew";
  const cancellationNoticeText =
    planConfig.cancellation_notice_days > 0
      ? `Parent subscriptions require ${planConfig.cancellation_notice_days} days' notice before cancellation takes effect.`
      : "Cancellation takes effect immediately.";
  const canResume = isPausedSubscription;
  const canActivate = !isActiveSubscription && !isPausedSubscription;
  const primaryDisabled =
    isProcessing ||
    loadingPlanConfig ||
    isActiveSubscription ||
    (canActivate && !selectedMethodId);
  const primaryLabel = isProcessing
    ? canActivate
      ? "Activating..."
      : "Updating..."
    : loadingPlanConfig
    ? "Loading plan..."
    : canResume
    ? "Resume Subscription"
    : isActiveSubscription
    ? "Active"
    : `Activate ${planConfig.name}`;

  return (
    <SafeScreen edges={["left", "right"]}>
      <LinearGradient
        colors={["#FFFFFF", "#FFFFFF"]}
        style={{ flex: 1 }}
      >

      {/* HEADER */}
      <LinearGradient
        colors={["#FFFFFF", "#FFFFFF"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <TouchableOpacity
          onPress={() => {
            if (onBack) {
              onBack();
              return;
            }
            navigation?.goBack?.();
          }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={headerIconSize} color="#C2185B" />
        </TouchableOpacity>

        <Text style={[styles.headerTitle, { fontSize: headerTitleSize }]} numberOfLines={1}>
          Subscription
        </Text>
        <View style={styles.backBtnGhost} />
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.body, { paddingBottom: contentBottomPad }]}
      >
        {/* CURRENT PLAN */}
          <View style={styles.currentCard}>
            <Text style={styles.currentLabel}>Current Plan</Text>
            <Text style={styles.currentName}>{currentPlan}</Text>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Status</Text>
              <View
                style={[
                  styles.statusPill,
                  isActiveSubscription && styles.statusPillActive,
                  isPausedSubscription && styles.statusPillPaused,
                  subscriptionStatus === "canceled" && styles.statusPillCanceled,
                ]}
              >
                <Text style={styles.statusPillText}>{getSubscriptionStatusLabel(subscriptionStatus)}</Text>
              </View>
            </View>
            <Text style={styles.lastBillingLabel}>Last billing date</Text>
            <Text style={styles.lastBillingValue}>
              {lastBillingDate || "Not available"}
            </Text>
            <Text style={styles.noticeText}>
              {cancellationNoticeText}
            </Text>
            {cancelScheduledFor ? (
              <Text style={styles.noticeMeta}>
                Cancellation scheduled for {cancelScheduledFor}. Premium access remains active until then.
              </Text>
            ) : null}

            <View style={styles.chipRow}>
              <PlanChip icon="shield-checkmark" label="Secure billing" iconSize={iconSize} />
            </View>
            <Text style={styles.billingSyncText}>
              {loadingBillingHistory
                ? "Syncing billing history..."
                : `Billing records: ${billingHistory.length}`}
            </Text>
          </View>

          

        {/* PREMIUM PLAN */}
        <View style={styles.planCard}>
          <Text style={styles.sectionTitle}>Choose Plan</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.planSelectorRow}
            style={styles.planSelectorScroll}
          >
            {availablePlans.map((plan) => {
              const isSelected = selectedPlanSlug === plan.slug;
              const priceLabel = formatSubscriptionPlanPrice(plan);
              return (
                <TouchableOpacity
                  key={`${plan.id ?? plan.slug}-${plan.slug}`}
                  activeOpacity={0.9}
                  style={[styles.planOptionCard, isSelected && styles.planOptionCardActive]}
                  onPress={() => {
                    setSelectedPlanSlug(plan.slug);
                    setPlanConfig(plan);
                  }}
                  disabled={isProcessing}
                >
                  <View style={styles.planOptionHeader}>
                    <Text style={styles.planOptionTitle} numberOfLines={2}>{plan.name}</Text>
                    {plan.is_default ? (
                      <View style={styles.planOptionBadge}>
                        <Text style={styles.planOptionBadgeText}>Default</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.planOptionPrice}>{priceLabel}</Text>
                  <Text style={styles.planOptionMeta}>
                    {plan.trial_days > 0 ? `${plan.trial_days}-day trial` : "No trial"} •{" "}
                    {plan.renewal_mode === "manual"
                      ? "Manual"
                      : plan.renewal_mode === "fixed_term"
                      ? "Fixed"
                      : "Auto"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.sectionTitle}>Payment Method</Text>
          {loadingPaymentMethods && methods.length === 0 ? (
            <View style={styles.methodLoadingState}>
              <ActivityIndicator size="small" color="#C2185B" />
              <Text style={styles.emptyText}>Loading payment methods...</Text>
            </View>
          ) : methods.length === 0 ? (
            <View style={styles.emptyPaymentState}>
              <Text style={styles.emptyText}>Add a payment method to continue.</Text>
              <TouchableOpacity
                style={styles.addPaymentButton}
                onPress={onAddPaymentMethod}
                activeOpacity={0.85}
              >
                <Ionicons name="card-outline" size={16} color="#C2185B" />
                <Text style={styles.addPaymentButtonText}>Add payment method</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.methodList}>
              {methods.map((method) => {
                const isActive = selectedMethodId === method.id;
                return (
                  <TouchableOpacity
                    key={method.id}
                    style={[
                      styles.methodRow,
                      isActive && styles.methodRowActive,
                    ]}
                    onPress={() => setSelectedMethodId(method.id)}
                    activeOpacity={0.85}
                  >
                    <View>
                      <Text style={styles.methodName} numberOfLines={1}>{getMethodLabel(method)}</Text>
                      <Text style={styles.methodMeta} numberOfLines={1}>{getMethodMeta(method)}</Text>
                    </View>
                    <Ionicons
                      name={isActive ? "checkmark-circle" : "ellipse-outline"}
                      size={iconSize}
                      color={isActive ? "#FF80AB" : "#B07A8F"}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <View style={styles.planHeader}>
              <Text style={[styles.planTitle, isNarrow && { flexShrink: 1 }]} numberOfLines={2}>
              {planConfig.name}
            </Text>
            <View style={styles.popularBadge}>
              <Text style={styles.popularText}>
                Recommended
              </Text>
            </View>
          </View>

          <Text style={styles.planPrice}>
            {planPriceLabel}
          </Text>
          <Text style={styles.planDesc}>
            {planConfig.description}
          </Text>

          <View style={styles.planMetaRow}>
            <View style={styles.planMetaPill}>
              <Text style={styles.planMetaText}>{planTrialLabel}</Text>
            </View>
            <View style={styles.planMetaPill}>
              <Text style={styles.planMetaText}>{renewalLabel}</Text>
            </View>
          </View>

          <View style={{ marginTop: rs(14) }}>
            {planConfig.features.map((perk, idx) => (
              <View key={idx} style={styles.perkRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={iconSize}
                  color="#FF80AB"
                />
                <Text style={styles.perkText}>{perk}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            activeOpacity={0.9}
            disabled={primaryDisabled}
            onPress={canResume ? () => void performSubscriptionAction("resume") : handleActivate}
            style={[
              styles.ctaBtn,
              isActiveSubscription && styles.ctaSuccess,
              isPausedSubscription && styles.ctaPaused,
              primaryDisabled && {
                opacity: 0.75,
              },
            ]}
          >
            <Text style={styles.ctaText}>{primaryLabel}</Text>
          </TouchableOpacity>

          {(isActiveSubscription || isPausedSubscription) && (
            <View style={styles.manageActionsWrap}>
              {!isPausedSubscription ? (
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={[styles.secondaryActionBtn, styles.pauseBtn]}
                  disabled={isProcessing}
                  onPress={confirmPause}
                >
                  <Ionicons name="pause-circle-outline" size={iconSize} color="#7A4E00" />
                  <Text style={[styles.secondaryActionText, styles.pauseBtnText]}>Pause</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={[styles.secondaryActionBtn, styles.resumeBtn]}
                  disabled={isProcessing}
                  onPress={() => void performSubscriptionAction("resume")}
                >
                  <Ionicons name="play-circle-outline" size={iconSize} color="#0F7F4A" />
                  <Text style={[styles.secondaryActionText, styles.resumeBtnText]}>Resume</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                activeOpacity={0.9}
                style={[styles.secondaryActionBtn, styles.cancelSubscriptionBtn]}
                disabled={isProcessing || !!cancelScheduledFor}
                onPress={confirmCancel}
              >
                <Ionicons name="close-circle-outline" size={iconSize} color="#AD1457" />
                <Text style={[styles.secondaryActionText, styles.cancelSubscriptionText]}>
                  {cancelScheduledFor ? "Cancellation Requested" : "Cancel Subscription"}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
      </LinearGradient>
    </SafeScreen>
  );
}

/* ---------------- COMPONENTS ---------------- */

function PlanChip({
  icon,
  label,
  iconSize,
}: {
  icon: any;
  label: string;
  iconSize: number;
}) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={iconSize} color="#fff" />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(14),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomLeftRadius: rs(18),
    borderBottomRightRadius: rs(18),
    backgroundColor: "rgba(255,255,255,0.9)",
    elevation: 2,
  },
  backBtn: {
    width: Math.max(rs(36), wp(10)),
    height: Math.max(rs(36), wp(10)),
    borderRadius: rs(22),
    backgroundColor: "#FFE89A",
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnGhost: {
    width: Math.max(rs(36), wp(10)),
  },
  headerTitle: {
    color: "#C77A00",
    fontWeight: "700",
    flex: 1,
    textAlign: "center",
    maxWidth: "70%",
  },
  body: {
    paddingHorizontal: Math.max(rs(12), wp(4)),
    paddingTop: Math.max(rs(12), hp(1.5)),
  },
  currentCard: {
    backgroundColor: "#FFE7F1",
    borderRadius: rs(20),
    padding: rs(18),
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: rs(0), height: rs(4) },
    elevation: 3,
  },
  currentLabel: {
    color: "#C2185B",
    fontSize: rf(12),
    fontWeight: "600",
  },
  currentName: {
    marginTop: rs(6),
    fontSize: rf(20),
    fontWeight: "700",
    color: "#880E4F",
  },
  statusRow: {
    marginTop: rs(10),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: rs(8),
  },
  statusLabel: {
    fontSize: rf(11),
    color: "#8B5E00",
    fontWeight: "700",
  },
  statusPill: {
    borderRadius: rs(999),
    paddingHorizontal: rs(10),
    paddingVertical: rs(4),
    backgroundColor: "#FFE6EE",
    borderWidth: 1,
    borderColor: "rgba(194,24,91,0.2)",
  },
  statusPillActive: {
    backgroundColor: "#E8F5E9",
    borderColor: "rgba(46,125,50,0.35)",
  },
  statusPillPaused: {
    backgroundColor: "#FFF8E1",
    borderColor: "rgba(255,160,0,0.45)",
  },
  statusPillCanceled: {
    backgroundColor: "#FFEBEE",
    borderColor: "rgba(183,28,28,0.35)",
  },
  statusPillText: {
    fontSize: rf(11),
    fontWeight: "700",
    color: "#6B4350",
  },
  lastBillingLabel: {
    marginTop: rs(8),
    fontSize: rf(11),
    fontWeight: "600",
    color: "#A84E72",
  },
  lastBillingValue: {
    marginTop: rs(2),
    fontSize: rf(13),
    fontWeight: "700",
    color: "#6B4350",
  },
  noticeText: {
    marginTop: rs(10),
    fontSize: rf(11.5),
    color: "#8B5E00",
    lineHeight: rs(16),
  },
  noticeMeta: {
    marginTop: rs(4),
    fontSize: rf(11),
    color: "#6B4350",
    fontWeight: "600",
  },
  chipRow: {
    flexDirection: "row",
    marginTop: rs(12),
    gap: rs(10),
    flexWrap: "wrap",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFE89A",
    paddingHorizontal: rs(10),
    paddingVertical: rs(6),
    borderRadius: rs(12),
  },
  chipText: {
    marginLeft: rs(6),
    color: "#8B5E00",
    fontSize: rf(11),
    fontWeight: "600",
  },
  billingSyncText: {
    marginTop: rs(8),
    fontSize: rf(11),
    color: "#8B5E00",
    fontWeight: "600",
  },
  billingCard: {
    marginTop: rs(14),
    backgroundColor: "#FFF9FB",
    borderRadius: rs(18),
    padding: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
  },
  billingHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: rs(4),
  },
  billingRefreshBtn: {
    width: rs(30),
    height: rs(30),
    borderRadius: rs(15),
    backgroundColor: "#FFE7F1",
    alignItems: "center",
    justifyContent: "center",
  },
  billingHint: {
    fontSize: rf(11.5),
    color: "#6B4350",
    marginBottom: rs(10),
  },
  billingLoadingWrap: {
    paddingVertical: rs(12),
    alignItems: "center",
    justifyContent: "center",
  },
  billingList: {
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    borderRadius: rs(12),
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
  },
  billingRow: {
    paddingHorizontal: rs(10),
    paddingVertical: rs(10),
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,128,171,0.15)",
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
  },
  billingRowLast: {
    borderBottomWidth: 0,
  },
  billingInfo: {
    flex: 1,
    minWidth: 0,
  },
  billingTitle: {
    fontSize: rf(12.5),
    fontWeight: "700",
    color: "#880E4F",
  },
  billingMeta: {
    marginTop: rs(2),
    fontSize: rf(10.5),
    color: "#6B4350",
  },
  billingTag: {
    paddingHorizontal: rs(8),
    paddingVertical: rs(4),
    borderRadius: rs(999),
    borderWidth: 1,
  },
  billingTagBackground: {
    backgroundColor: "#FFF3CD",
    borderColor: "#F2C94C",
  },
  billingTagSubscription: {
    backgroundColor: "#FDECF5",
    borderColor: "#FF80AB",
  },
  billingTagOther: {
    backgroundColor: "#F5F5F5",
    borderColor: "#C7C7C7",
  },
  billingTagText: {
    fontSize: rf(9.5),
    color: "#6B4350",
    fontWeight: "700",
  },
  billingAmount: {
    fontSize: rf(12),
    fontWeight: "700",
    color: "#C2185B",
  },
  planCard: {
    marginTop: rs(18),
    backgroundColor: "#FFF7E8",
    borderRadius: rs(22),
    padding: rs(18),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: rs(0), height: rs(4) },
    elevation: 3,
  },
  planSelectorScroll: {
    marginBottom: rs(12),
  },
  planSelectorRow: {
    gap: rs(10),
    paddingRight: rs(4),
  },
  planOptionCard: {
    width: Math.max(wp(58), rs(220)),
    backgroundColor: "#FFF9FB",
    borderRadius: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.18)",
    padding: rs(12),
  },
  planOptionCardActive: {
    backgroundColor: "#FFE4EC",
    borderColor: "#FF80AB",
  },
  planOptionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: rs(8),
  },
  planOptionTitle: {
    flex: 1,
    fontSize: rf(13),
    fontWeight: "700",
    color: "#880E4F",
  },
  planOptionBadge: {
    backgroundColor: "#FFE89A",
    borderRadius: rs(999),
    paddingHorizontal: rs(8),
    paddingVertical: rs(4),
  },
  planOptionBadgeText: {
    color: "#8B5E00",
    fontSize: rf(10),
    fontWeight: "700",
  },
  planOptionPrice: {
    marginTop: rs(8),
    fontSize: rf(14),
    fontWeight: "700",
    color: "#AD1457",
  },
  planOptionMeta: {
    marginTop: rs(6),
    fontSize: rf(11),
    color: "#6B4350",
    lineHeight: rs(16),
  },
  sectionTitle: {
    fontSize: rf(14),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(10),
  },
  emptyText: {
    fontSize: rf(12),
    color: "#6B4350",
    marginBottom: rs(12),
  },
  emptyPaymentState: {
    marginBottom: rs(12),
  },
  addPaymentButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    paddingHorizontal: Math.max(rs(12), wp(3.2)),
    paddingVertical: Math.max(rs(10), hp(1.2)),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB",
    backgroundColor: "#FFF1F6",
  },
  addPaymentButtonText: {
    fontSize: rf(12),
    fontWeight: "700",
    color: "#C2185B",
  },
  methodLoadingState: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(10),
    marginBottom: rs(12),
  },
  methodList: {
    gap: rs(10),
    marginBottom: rs(12),
  },
  methodRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Math.max(rs(10), wp(3)),
    paddingVertical: Math.max(rs(10), hp(1.2)),
    borderRadius: rs(14),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    backgroundColor: "#FFF9FB",
    flexWrap: "wrap",
  },
  methodRowActive: {
    borderColor: "#FF80AB",
    backgroundColor: "#FFE4EC",
  },
  methodName: {
    fontSize: rf(13),
    fontWeight: "700",
    color: "#880E4F",
  },
  methodMeta: {
    fontSize: rf(11),
    color: "#6B4350",
    marginTop: rs(2),
  },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  planTitle: {
    fontSize: rf(19),
    fontWeight: "700",
    color: "#880E4F",
  },
  popularBadge: {
    marginLeft: rs(8),
    backgroundColor: "#FFC107",
    paddingHorizontal: rs(10),
    paddingVertical: rs(4),
    borderRadius: rs(12),
    maxWidth: "60%",
  },
  popularText: {
    color: "#8B5E00",
    fontSize: rf(11),
    fontWeight: "700",
  },
  planPrice: {
    marginTop: rs(10),
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
  },
  planDesc: {
    marginTop: rs(4),
    fontSize: rf(13),
    color: "#6B4350",
    lineHeight: rs(18),
  },
  planMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: rs(8),
    marginTop: rs(10),
  },
  planMetaPill: {
    backgroundColor: "#FFF1F6",
    borderRadius: rs(999),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.22)",
    paddingHorizontal: rs(10),
    paddingVertical: rs(6),
  },
  planMetaText: {
    color: "#AD1457",
    fontSize: rf(11),
    fontWeight: "700",
  },
  perkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: rs(8),
  },
  perkText: {
    marginLeft: rs(8),
    fontSize: rf(12),
    color: "#6B4350",
    flexShrink: 1,
  },
  ctaBtn: {
    marginTop: rs(16),
    backgroundColor: "#FF80AB",
    borderRadius: rs(14),
    paddingVertical: rs(14),
    alignItems: "center",
    width: "100%",
    shadowColor: "#FF80AB",
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: rs(0), height: rs(4) },
    elevation: 4,
  },
  ctaSuccess: {
    backgroundColor: "#4CAF50",
  },
  ctaPaused: {
    backgroundColor: "#2E7D32",
  },
  ctaText: {
    color: "#fff",
    fontSize: rf(15),
    fontWeight: "700",
    textAlign: "center",
  },
  manageActionsWrap: {
    marginTop: rs(12),
    gap: rs(10),
  },
  secondaryActionBtn: {
    borderRadius: rs(12),
    borderWidth: 1,
    paddingVertical: rs(11),
    paddingHorizontal: rs(12),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(8),
  },
  secondaryActionText: {
    fontSize: rf(12),
    fontWeight: "700",
  },
  pauseBtn: {
    backgroundColor: "#FFF8E1",
    borderColor: "#FFCC80",
  },
  pauseBtnText: {
    color: "#7A4E00",
  },
  resumeBtn: {
    backgroundColor: "#E8F5E9",
    borderColor: "#81C784",
  },
  resumeBtnText: {
    color: "#0F7F4A",
  },
  cancelSubscriptionBtn: {
    backgroundColor: "#FFF0F5",
    borderColor: "#F8BBD0",
  },
  cancelSubscriptionText: {
    color: "#AD1457",
  },
});
