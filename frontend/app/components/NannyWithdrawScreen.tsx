import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import {
  AppState,
  AppStateStatus,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { rf, rs } from "../utils/responsive";
import { addStripeExternalAccount, createStripeConnectAccount, createStripeToken, getPlatformCommission, getWalletBalance, getWalletTransactions, withdrawFromWallet } from "../Api";

type Props = {
  navigation?: any;
  onBack?: () => void;
};

type PayoutMethod = "bank" | "card" | "stripe";

type StripeConnectState = {
  accountId: string | null;
  onboardingUrl: string | null;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  externalAccount: any | null;
};

const payoutLabels: Record<PayoutMethod, string> = {
  bank: "Bank account",
  card: "Debit card",
  stripe: "Stripe",
};

const roundMoney = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
};

const parseMoneyValue = (value: unknown) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? roundMoney(value) : null;
  }

  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
};

const getTransactionsArrayFromPayload = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.transactions)) return payload.transactions;
  if (Array.isArray(payload?.data?.transactions)) return payload.data.transactions;
  if (Array.isArray(payload?.history)) return payload.history;
  if (Array.isArray(payload?.data?.history)) return payload.data.history;
  return [];
};

const NannyWithdrawScreen: React.FC<Props> = ({ navigation, onBack }) => {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayoutMethod>("bank");
  const [note, setNote] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [savingPayout, setSavingPayout] = useState(false);
  const [accountHolderName, setAccountHolderName] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountType, setAccountType] = useState<"checking" | "savings">("checking");
  const [cardNumber, setCardNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [billingZip, setBillingZip] = useState("");
  const [commissionRate, setCommissionRate] = useState<number | null>(null);
  const [commissionType, setCommissionType] = useState<"percentage" | "flat" | null>(null);
  const [stripeState, setStripeState] = useState<StripeConnectState>({
    accountId: null,
    onboardingUrl: null,
    detailsSubmitted: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    externalAccount: null,
  });
  const [loadingStripeStatus, setLoadingStripeStatus] = useState(false);

  const handleBack = () => {
    if (onBack) onBack();
    else navigation?.goBack?.();
  };

  const cleanValue = (value?: string | null) =>
    value ? value.replace(/"/g, "").trim() : "";

  const showError = (title: string, message?: string) => {
    const msg = message || "Something went wrong";
    Alert.alert(title, msg);
    setErrorMessage(msg);
  };

  const openExternalUrl = React.useCallback(async (url: string) => {
    const targetUrl = String(url || "").trim();
    if (!targetUrl) {
      throw new Error("Missing Stripe onboarding link.");
    }

    if (Platform.OS === "web" && typeof window !== "undefined") {
      const openedWindow = window.open(targetUrl, "_blank", "noopener,noreferrer");
      if (!openedWindow) {
        window.location.assign(targetUrl);
      }
      return;
    }

    await Linking.openURL(targetUrl);
  }, []);

  const getAuthContext = React.useCallback(async () => {
    const [token1, token2, nannyRaw, apiRaw] = await Promise.all([
      AsyncStorage.getItem("token"),
      AsyncStorage.getItem("nanny_token"),
      AsyncStorage.getItem("nanny_id"),
      AsyncStorage.getItem("api_key"),
    ]);
    const rawToken = token1 || token2;
    const token = cleanValue(rawToken);
    const nannyId = cleanValue(nannyRaw);
    const apiKey =
      cleanValue(apiRaw) ||
      (typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_API_KEY : "") ||
      "";
    return {
      token: token || undefined,
      nannyId: nannyId || undefined,
      apiKey: apiKey || undefined,
    };
  }, []);

  const fetchBalance = React.useCallback(async () => {
    setLoadingBalance(true);
    try {
      const { token } = await getAuthContext();
      if (!token) {
        setBalance(0);
        return;
      }
      const response = await getWalletBalance(token);
      const rawBalance = response?.balance;
      const parsed =
        typeof rawBalance === "number"
          ? rawBalance
          : Number.parseFloat(String(rawBalance ?? "").replace(/[^0-9.-]/g, ""));
      setBalance(Number.isFinite(parsed) ? parsed : 0);
    } catch {
      setBalance(0);
    } finally {
      setLoadingBalance(false);
    }
  }, [getAuthContext]);

  const fetchTransactions = React.useCallback(async () => {
    setLoadingTransactions(true);
    try {
      const { token } = await getAuthContext();
      if (!token) {
        setTransactions([]);
        return;
      }
      const response = await getWalletTransactions(token);
      setTransactions(getTransactionsArrayFromPayload(response));
    } catch {
      setTransactions([]);
    } finally {
      setLoadingTransactions(false);
    }
  }, [getAuthContext]);

  const fetchCommission = React.useCallback(async () => {
    try {
      const { token, apiKey, nannyId } = await getAuthContext();
      if (!token && !nannyId) {
        setCommissionRate(null);
        return;
      }
      const response = await getPlatformCommission(token, apiKey, nannyId);
      const raw =
        response?.value ??
        response?.commission ??
        response?.percentage ??
        response?.platform_fee ??
        response?.data?.commission ??
        response?.data?.value ??
        response?.data?.percentage ??
        response?.data?.platform_fee;
      const typeRaw =
        response?.type ??
        response?.fee_type ??
        response?.data?.type ??
        response?.data?.fee_type;
      const parsed = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
      setCommissionRate(Number.isFinite(parsed) ? parsed : null);
      if (typeRaw) {
        const normalized = String(typeRaw).toLowerCase();
        setCommissionType(normalized === "flat" ? "flat" : "percentage");
      } else {
        setCommissionType(null);
      }
    } catch {
      setCommissionRate(null);
      setCommissionType(null);
    }
  }, [getAuthContext]);

  const syncStripeState = React.useCallback(async (openOnboarding = false) => {
    setLoadingStripeStatus(true);
    try {
      const { token, nannyId } = await getAuthContext();
      if (!token || !nannyId) {
        setStripeState({
          accountId: null,
          onboardingUrl: null,
          detailsSubmitted: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          externalAccount: null,
        });
        return null;
      }

      const response = await createStripeConnectAccount(token);
      const nextState = {
        accountId: response?.account_id ?? null,
        onboardingUrl:
          response?.onboarding_url || response?.url || response?.data?.onboarding_url || null,
        detailsSubmitted: Boolean(response?.details_submitted),
        chargesEnabled: Boolean(response?.charges_enabled),
        payoutsEnabled: Boolean(response?.payouts_enabled),
        externalAccount: response?.external_account ?? null,
      };
      setStripeState(nextState);

      if (openOnboarding && nextState.onboardingUrl && !nextState.payoutsEnabled) {
        await Linking.openURL(nextState.onboardingUrl);
      }

      return nextState;
    } catch (error: any) {
      if (openOnboarding) {
        throw error;
      }
      return null;
    } finally {
      setLoadingStripeStatus(false);
    }
  }, [getAuthContext]);

  React.useEffect(() => {
    void fetchBalance();
    void fetchTransactions();
    void fetchCommission();
    void syncStripeState();
  }, [fetchBalance, fetchTransactions, fetchCommission, syncStripeState]);

  React.useEffect(() => {
    let lastState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const cameBackToApp =
        (lastState === "background" || lastState === "inactive") && nextState === "active";
      lastState = nextState;
      if (cameBackToApp) {
        void syncStripeState();
        void fetchBalance();
        void fetchTransactions();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [fetchBalance, fetchTransactions, syncStripeState]);

  const handleStripeConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    setErrorMessage("");
    try {
      if (stripeState.onboardingUrl && !stripeState.payoutsEnabled) {
        await openExternalUrl(stripeState.onboardingUrl);
        return;
      }

      const { token, nannyId } = await getAuthContext();
      if (!token) {
        showError("Stripe Connect", "Missing session token. Please log in again.");
        return;
      }
      if (!nannyId) {
        showError(
          "Stripe Connect",
          "Nanny profile not found. Please complete your profile before connecting Stripe."
        );
        return;
      }

      const nextState = await syncStripeState(true);
      if (!nextState?.onboardingUrl) {
        throw new Error("Missing Stripe onboarding link.");
      }
    } catch (e: any) {
      showError("Stripe Connect", e?.message || "Unable to start Stripe onboarding.");
    } finally {
      setConnecting(false);
    }
  };

  const handleWithdraw = async () => {
    if (withdrawing) return;
    const cleanAmount = amount.replace(/[^0-9.]/g, "");
    const numericAmount = Number.parseFloat(cleanAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      showError("Withdraw", "Please enter a valid amount to withdraw.");
      return;
    }
    if (balance !== null && numericAmount > balance) {
      showError("Withdraw", "Amount exceeds your available balance.");
      return;
    }
    setWithdrawing(true);
    setErrorMessage("");
    try {
      const { token } = await getAuthContext();
      if (!token) {
        throw new Error("Missing session token. Please log in again.");
      }
      const response = await withdrawFromWallet(numericAmount, token, {
        note: note.trim() || undefined,
        payoutMethod: method,
      });
      await fetchBalance();
      await fetchTransactions();
      const grossAmount =
        parseMoneyValue(response?.gross_amount) ??
        parseMoneyValue(response?.withdrawal?.gross_amount) ??
        roundMoney(numericAmount);
      const deductedCommission =
        parseMoneyValue(response?.commission_amount) ??
        parseMoneyValue(response?.withdrawal?.commission_amount) ??
        0;
      const payoutAmount =
        parseMoneyValue(response?.net_amount) ??
        parseMoneyValue(response?.withdrawal?.net_amount) ??
        roundMoney(Math.max(0, grossAmount - deductedCommission));
      const responseMessage = String(response?.message || "Withdrawal request sent.").trim();
      Alert.alert(
        "Withdraw",
        `${responseMessage}\n\nRequested ${formatCurrency(grossAmount)}\nCommission ${formatCurrency(deductedCommission)}\nPayout ${formatCurrency(payoutAmount)}`
      );
      setAmount("");
      setNote("");
    } catch (e: any) {
      const grossAmount =
        parseMoneyValue(e?.payload?.gross_amount) ??
        parseMoneyValue(e?.payload?.withdrawal?.gross_amount);
      const deductedCommission =
        parseMoneyValue(e?.payload?.commission_amount) ??
        parseMoneyValue(e?.payload?.withdrawal?.commission_amount);
      const payoutAmount =
        parseMoneyValue(e?.payload?.net_amount) ??
        parseMoneyValue(e?.payload?.withdrawal?.net_amount);
      const detailLines = [
        grossAmount !== null ? `Requested ${formatCurrency(grossAmount)}` : null,
        deductedCommission !== null ? `Commission ${formatCurrency(deductedCommission)}` : null,
        payoutAmount !== null ? `Payout ${formatCurrency(payoutAmount)}` : null,
      ].filter(Boolean);
      const errorMessage = String(e?.message || "Unable to withdraw right now.").trim();
      showError(
        "Withdraw",
        detailLines.length > 0
          ? `${errorMessage}\n\n${detailLines.join("\n")}`
          : errorMessage
      );
    } finally {
      setWithdrawing(false);
    }
  };

  const handleSavePayoutMethod = async () => {
    if (savingPayout) return;
    setSavingPayout(true);
    setErrorMessage("");
    try {
      const { token } = await getAuthContext();
      if (!token) {
        throw new Error("Missing session token. Please log in again.");
      }
      if (isBank) {
        if (!accountHolderName || !routingNumber || !accountNumber) {
          throw new Error("Please fill all bank account fields.");
        }
        const tokenResponse = await createStripeToken({
          "bank_account[country]": "US",
          "bank_account[currency]": "usd",
          "bank_account[routing_number]": routingNumber.trim(),
          "bank_account[account_number]": accountNumber.trim(),
          "bank_account[account_holder_name]": accountHolderName.trim(),
          "bank_account[account_holder_type]": "individual",
        });
        if (!tokenResponse?.id) {
          throw new Error("Unable to tokenize bank account.");
        }
        const response = await addStripeExternalAccount({ type: "bank", token_id: tokenResponse.id }, token);
        setStripeState((current) => ({
          ...current,
          accountId: response?.account_id ?? current.accountId,
          detailsSubmitted: Boolean(response?.details_submitted ?? current.detailsSubmitted),
          chargesEnabled: Boolean(response?.charges_enabled ?? current.chargesEnabled),
          payoutsEnabled: Boolean(response?.payouts_enabled ?? current.payoutsEnabled),
          externalAccount: response?.external_account ?? current.externalAccount,
        }));
      } else {
        if (!cardNumber || !expMonth || !expYear || !cvc) {
          throw new Error("Please fill all card fields.");
        }
        const tokenResponse = await createStripeToken({
          "card[number]": cardNumber.trim(),
          "card[exp_month]": expMonth.trim(),
          "card[exp_year]": expYear.trim(),
          "card[cvc]": cvc.trim(),
          ...(billingZip.trim() ? { "card[address_zip]": billingZip.trim() } : {}),
        });
        if (!tokenResponse?.id) {
          throw new Error("Unable to tokenize card.");
        }
        const response = await addStripeExternalAccount({ type: "card", token_id: tokenResponse.id }, token);
        setStripeState((current) => ({
          ...current,
          accountId: response?.account_id ?? current.accountId,
          detailsSubmitted: Boolean(response?.details_submitted ?? current.detailsSubmitted),
          chargesEnabled: Boolean(response?.charges_enabled ?? current.chargesEnabled),
          payoutsEnabled: Boolean(response?.payouts_enabled ?? current.payoutsEnabled),
          externalAccount: response?.external_account ?? current.externalAccount,
        }));
      }
      Alert.alert("Payout method", "Saved successfully.");
    } catch (e: any) {
      const message = e?.message || "Unable to save payout method.";
      showError("Payout method", message);
    } finally {
      setSavingPayout(false);
    }
  };

  const isBank = method === "bank";
  const isCard = method === "card";
  const isStripe = method === "stripe";
  const primaryLabel = withdrawing ? "Withdrawing..." : "Withdraw now";
  const formatCurrency = (value?: number | string) => {
    const parsed =
      typeof value === "number"
        ? value
        : Number.parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
    const safe = Number.isFinite(parsed) ? parsed : 0;
    return `$${Math.abs(safe).toFixed(2)}`;
  };
  const formatAmount = (value?: number | string, isCredit?: boolean) => {
    const sign = isCredit ? "+" : "-";
    return `${sign}${formatCurrency(value)}`;
  };
  const formatType = (value?: string) => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "Transaction";
    if (raw === "credit") return "Credit";
    if (raw === "debit") return "Debit";
    return raw
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };
  const formatDate = (value?: string) => {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const isDebitTransaction = (tx: any) => {
    const direction = String(tx?.direction || "").trim().toLowerCase();
    if (direction === "debit") return true;
    if (direction === "credit") return false;

    const type = String(tx?.type || tx?.category || "").trim().toLowerCase();
    return (
      type.includes("debit") ||
      type.includes("withdraw") ||
      type.includes("refund") ||
      type.includes("reversal") ||
      type.includes("fee")
    );
  };
  const getTransactionTitle = (tx: any) => {
    const description = String(tx?.description || "").trim();
    if (description) return description;
    return formatType(tx?.type || tx?.category || tx?.direction);
  };
  const getTransactionMetric = (tx: any, key: string) => {
    const raw = tx?.[key] ?? tx?.meta?.[key];
    if (raw === null || raw === undefined || raw === "") return null;
    const parsed =
      typeof raw === "number"
        ? raw
        : Number.parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const totalEarned = React.useMemo(
    () =>
      transactions.reduce((sum, tx) => {
        if (isDebitTransaction(tx)) return sum;
        const amountValue = getTransactionMetric(tx, "net_amount") ?? getTransactionMetric(tx, "amount") ?? 0;
        return sum + amountValue;
      }, 0),
    [transactions]
  );
  const totalWithdrawn = React.useMemo(
    () =>
      transactions.reduce((sum, tx) => {
        if (!isDebitTransaction(tx)) return sum;
        const amountValue = getTransactionMetric(tx, "gross_amount") ?? getTransactionMetric(tx, "amount") ?? 0;
        return sum + amountValue;
      }, 0),
    [transactions]
  );
  const numericAmount = Number.parseFloat(amount.replace(/[^0-9.]/g, ""));
  const hasAmount = Number.isFinite(numericAmount) && numericAmount > 0;
  const effectiveCommissionType = commissionType ?? "percentage";
  const effectiveCommissionRate = commissionRate ?? 5;
  const commissionFee = hasAmount
    ? effectiveCommissionType === "flat"
      ? roundMoney(Math.min(effectiveCommissionRate, numericAmount))
      : roundMoney((numericAmount * effectiveCommissionRate) / 100)
    : 0;
  const netAmount =
    hasAmount ? roundMoney(Math.max(0, numericAmount - commissionFee)) : null;
  const stripeReady = stripeState.payoutsEnabled;
  const stripeStatusLabel = stripeReady
    ? "Ready for payouts"
    : stripeState.detailsSubmitted
      ? "Stripe connected, waiting for payouts"
      : stripeState.accountId
        ? "Onboarding incomplete"
        : "Not connected";
  const externalAccountLabel = stripeState.externalAccount
    ? stripeState.externalAccount.bank_name || stripeState.externalAccount.brand || stripeState.externalAccount.type
    : null;

  return (
    <LinearGradient colors={["#FFFFFF", "#FFFFFF", "#FFFFFF"]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: rs(2), paddingBottom: rs(60) }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#C2185B" />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Withdraw Earnings</Text>
          <View style={{ width: rs(34) }} />
        </View>

        <View style={styles.headerCard}>
          <View style={styles.headerIcon}>
            <Ionicons name="wallet-outline" size={26} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Withdraw earnings</Text>
            <Text style={styles.headerSubtitle}>
              Move your available balance to your payout method.
            </Text>
          </View>
        </View>

        <View style={styles.balanceCard}>
          <View style={styles.balanceHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.balanceLabel}>Available balance</Text>
              <Text style={styles.balanceValue}>
                {loadingBalance ? "Loading..." : `$${(balance ?? 0).toFixed(2)}`}
              </Text>
            </View>
          </View>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total earned</Text>
              <Text style={[styles.summaryValue, styles.summaryValuePositive]}>
                {loadingTransactions ? "..." : formatCurrency(totalEarned)}
              </Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Total withdrawn</Text>
              <Text style={[styles.summaryValue, styles.summaryValueNegative]}>
                {loadingTransactions ? "..." : formatCurrency(totalWithdrawn)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.stripeStatusCard}>
          <View style={styles.stripeStatusHeader}>
            <Text style={styles.stripeStatusTitle}>Stripe payout status</Text>
            <TouchableOpacity onPress={() => void syncStripeState()} disabled={loadingStripeStatus}>
              <Text style={styles.stripeRefreshText}>
                {loadingStripeStatus ? "Checking..." : "Refresh"}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.stripeStatusValue, stripeReady && styles.stripeStatusValueReady]}>
            {stripeStatusLabel}
          </Text>
          <Text style={styles.stripeStatusMeta}>
            {stripeState.accountId ? `Account: ${stripeState.accountId}` : "No Stripe account connected yet."}
          </Text>
          <Text style={styles.stripeStatusMeta}>
            {stripeState.externalAccount
              ? `Payout method: ${externalAccountLabel}${stripeState.externalAccount.last4 ? ` •••• ${stripeState.externalAccount.last4}` : ""}`
              : "No payout method saved yet."}
          </Text>
          {!stripeReady && stripeState.onboardingUrl ? (
            <TouchableOpacity
              style={[styles.connectBtn, connecting && { opacity: 0.7 }]}
              onPress={handleStripeConnect}
              disabled={connecting}
            >
              <Text style={styles.connectBtnText}>
                {connecting ? "Opening Stripe..." : stripeState.accountId ? "Continue onboarding" : "Connect Stripe"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Amount</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="$0.00"
          placeholderTextColor="#B26A86"
          style={styles.input}
          editable={!withdrawing}
        />
        <View style={styles.commissionCard}>
          <Text style={styles.commissionTitle}>Commission</Text>
          <View style={styles.commissionRow}>
            <Text style={styles.commissionLabel}>
              Platform fee{" "}
              {effectiveCommissionType === "flat"
                ? `($${effectiveCommissionRate.toFixed(2)})`
                : `(${effectiveCommissionRate}%)`}
            </Text>
            <Text style={styles.commissionValue}>
              {commissionFee !== null ? `-$${commissionFee.toFixed(2)}` : "-$0.00"}
            </Text>
          </View>
          <View style={styles.commissionRow}>
            <Text style={styles.commissionLabel}>You will receive</Text>
            <Text style={styles.commissionValue}>
              {netAmount !== null ? `$${netAmount.toFixed(2)}` : "$0.00"}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Payout method</Text>
        <View style={styles.methodRow}>
          {(["bank", "card", "stripe"] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.methodChip, method === m && styles.methodChipActive]}
              onPress={() => setMethod(m)}
            >
              <Text style={[styles.methodText, method === m && styles.methodTextActive]}>
                {payoutLabels[m]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {isStripe && !stripeReady && (
          <TouchableOpacity
            style={[styles.connectBtn, connecting && { opacity: 0.7 }]}
            onPress={handleStripeConnect}
            disabled={connecting}
          >
            <Text style={styles.connectBtnText}>
              {connecting ? "Connecting..." : "Connect Stripe"}
            </Text>
          </TouchableOpacity>
        )}
        {isBank && (
          <View style={styles.formCard}>
            <TextInput
              placeholder="Account holder name"
              placeholderTextColor="#B26A86"
              style={styles.input}
              value={accountHolderName}
              onChangeText={setAccountHolderName}
              editable={!withdrawing}
            />
            <TextInput
              placeholder="Routing number"
              placeholderTextColor="#B26A86"
              keyboardType="number-pad"
              style={styles.input}
              value={routingNumber}
              onChangeText={setRoutingNumber}
              editable={!withdrawing}
            />
            <TextInput
              placeholder="Account number"
              placeholderTextColor="#B26A86"
              keyboardType="number-pad"
              style={styles.input}
              value={accountNumber}
              onChangeText={setAccountNumber}
              editable={!withdrawing}
            />
            <View style={styles.methodRow}>
              {(["checking", "savings"] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.accountTypeChip,
                    accountType === type && styles.accountTypeChipActive,
                  ]}
                onPress={() => setAccountType(type)}
                disabled={withdrawing}
              >
                  <Text
                    style={[
                      styles.accountTypeText,
                      accountType === type && styles.accountTypeTextActive,
                    ]}
                  >
                    {type === "checking" ? "Checking" : "Savings"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Country</Text>
              <Text style={styles.metaValue}>US</Text>
            </View>
          </View>
        )}
        {isCard && (
          <View style={styles.formCard}>
            <TextInput
              placeholder="Card number"
              placeholderTextColor="#B26A86"
              keyboardType="number-pad"
              style={styles.input}
              value={cardNumber}
              onChangeText={setCardNumber}
              editable={!withdrawing}
            />
            <View style={styles.rowSplit}>
              <TextInput
                placeholder="MM"
                placeholderTextColor="#B26A86"
                keyboardType="number-pad"
                style={[styles.input, styles.halfInput]}
                value={expMonth}
                onChangeText={setExpMonth}
                editable={!withdrawing}
              />
              <TextInput
                placeholder="YY"
                placeholderTextColor="#B26A86"
                keyboardType="number-pad"
                style={[styles.input, styles.halfInput]}
                value={expYear}
                onChangeText={setExpYear}
                editable={!withdrawing}
              />
            </View>
            <TextInput
              placeholder="CVC"
              placeholderTextColor="#B26A86"
              keyboardType="number-pad"
              style={styles.input}
              value={cvc}
              onChangeText={setCvc}
              editable={!withdrawing}
            />
            <TextInput
              placeholder="Billing ZIP"
              placeholderTextColor="#B26A86"
              keyboardType="number-pad"
              style={styles.input}
              value={billingZip}
              onChangeText={setBillingZip}
              editable={!withdrawing}
            />
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Country</Text>
              <Text style={styles.metaValue}>US</Text>
            </View>
          </View>
        )}
        {(isBank || isCard) && (
          <TouchableOpacity
            style={[styles.connectBtn, savingPayout && { opacity: 0.7 }]}
            onPress={handleSavePayoutMethod}
            disabled={savingPayout}
          >
            <Text style={styles.connectBtnText}>
              {savingPayout ? "Saving..." : "Save payout method"}
            </Text>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>Note (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add a note for your records"
          placeholderTextColor="#B26A86"
          multiline
          style={[styles.input, { height: rs(90), textAlignVertical: "top" }]}
          editable={!withdrawing}
        />

        <Text style={styles.sectionTitle}>Transaction history</Text>
        <View style={styles.transactionsCard}>
          {loadingTransactions ? (
            <Text style={styles.mutedText}>Loading...</Text>
          ) : transactions.length === 0 ? (
            <Text style={styles.mutedText}>No transactions yet.</Text>
          ) : (
            transactions.map((tx, index) => (
              (() => {
                const isDebit = isDebitTransaction(tx);
                const grossAmount = getTransactionMetric(tx, "gross_amount");
                const commissionAmount = getTransactionMetric(tx, "commission_amount");
                const netAmountValue = getTransactionMetric(tx, "net_amount");
                const stripeFee = getTransactionMetric(tx, "stripe_fee_amount");
                const stripeTax = getTransactionMetric(tx, "stripe_tax_amount");
                const processingFee = getTransactionMetric(tx, "stripe_processing_fee_amount");
                const displayAmount = isDebit ? grossAmount ?? getTransactionMetric(tx, "amount") : getTransactionMetric(tx, "amount");
                const showBreakdown =
                  [grossAmount, commissionAmount, netAmountValue, stripeFee, stripeTax, processingFee].some(
                    (value) => value !== null
                  );

                return (
                  <View
                    key={tx?.id ? String(tx.id) : `tx-${index}`}
                    style={[
                      styles.transactionRow,
                      index === transactions.length - 1 && { borderBottomWidth: 0 },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.transactionTitle}>
                        {getTransactionTitle(tx)}
                      </Text>
                      <Text style={styles.transactionMeta}>
                        {formatDate(tx?.created_at)} {tx?.status ? `- ${tx.status}` : ""}
                        {tx?.job_id ? ` - Job #${tx.job_id}` : ""}
                      </Text>
                      {showBreakdown ? (
                        <View style={styles.breakdownWrap}>
                          {grossAmount !== null ? (
                            <View style={styles.breakdownChip}>
                              <Text style={styles.breakdownChipText}>Gross {formatCurrency(grossAmount)}</Text>
                            </View>
                          ) : null}
                          {commissionAmount !== null ? (
                            <View style={styles.breakdownChip}>
                              <Text style={styles.breakdownChipText}>Commission {formatCurrency(commissionAmount)}</Text>
                            </View>
                          ) : null}
                          {stripeFee !== null ? (
                            <View style={styles.breakdownChip}>
                              <Text style={styles.breakdownChipText}>Fee {formatCurrency(stripeFee)}</Text>
                            </View>
                          ) : null}
                          {stripeTax !== null ? (
                            <View style={styles.breakdownChip}>
                              <Text style={styles.breakdownChipText}>Tax {formatCurrency(stripeTax)}</Text>
                            </View>
                          ) : null}
                          {processingFee !== null ? (
                            <View style={styles.breakdownChip}>
                              <Text style={styles.breakdownChipText}>Proc. {formatCurrency(processingFee)}</Text>
                            </View>
                          ) : null}
                          {netAmountValue !== null ? (
                            <View style={[styles.breakdownChip, styles.breakdownChipHighlight]}>
                              <Text style={styles.breakdownChipText}>
                                {isDebit ? "Payout" : "Net"} {formatCurrency(netAmountValue)}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.transactionAmount,
                        isDebit
                          ? styles.transactionAmountDebit
                          : styles.transactionAmountCredit,
                      ]}
                    >
                      {formatAmount(displayAmount ?? tx?.amount, !isDebit)}
                    </Text>
                  </View>
                );
              })()
            ))
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (connecting || withdrawing) && { opacity: 0.7 },
          ]}
          onPress={handleWithdraw}
          disabled={connecting || withdrawing}
        >
          <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
        </TouchableOpacity>
        {!!errorMessage && (
          <Text style={styles.errorText}>{errorMessage}</Text>
        )}
      </ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: rs(1),
    paddingBottom: rs(12),
  },
  backBtn: {
    width: rs(34),
    height: rs(34),
    borderRadius: rs(17),
    backgroundColor: "#FFE8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
  },
  headerCard: {
    flexDirection: "row",
    padding: rs(20),
    borderRadius: rs(24),
    backgroundColor: "rgba(255,255,255,0.95)",
    shadowColor: "rgba(255,128,171,0.25)",
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: rs(0), height: rs(8) },
    marginBottom: rs(16),
  },
  headerIcon: {
    width: rs(54),
    height: rs(54),
    borderRadius: rs(27),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(18),
  },
  headerTitle: {
    fontSize: rf(22),
    fontWeight: "700",
    color: "#880E4F",
  },
  headerSubtitle: {
    fontSize: rf(12),
    color: "#AD1457",
    marginTop: rs(6),
  },
  balanceCard: {
    backgroundColor: "#FFF",
    padding: rs(18),
    borderRadius: rs(18),
    shadowColor: "rgba(255,128,171,0.12)",
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: rs(0), height: rs(6) },
    marginBottom: rs(20),
  },
  balanceHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  balanceLabel: {
    color: "#6B4350",
    fontSize: rf(12),
  },
  balanceValue: {
    fontSize: rf(26),
    fontWeight: "700",
    color: "#880E4F",
    marginTop: rs(6),
  },
  summaryRow: {
    flexDirection: "row",
    gap: rs(10),
    marginTop: rs(16),
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "#FFF6FA",
    borderRadius: rs(14),
    padding: rs(12),
    borderWidth: 1,
    borderColor: "#F6D8E4",
  },
  summaryLabel: {
    color: "#B26A86",
    fontSize: rf(11),
  },
  summaryValue: {
    marginTop: rs(6),
    fontSize: rf(15),
    fontWeight: "700",
  },
  summaryValuePositive: {
    color: "#2E7D32",
  },
  summaryValueNegative: {
    color: "#C2185B",
  },
  sectionTitle: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(8),
  },
  input: {
    backgroundColor: "#FFF",
    borderRadius: rs(14),
    padding: rs(14),
    marginBottom: rs(16),
    color: "#6B4350",
    shadowColor: "rgba(255,128,171,0.12)",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: rs(0), height: rs(4) },
  },
  methodRow: {
    flexDirection: "row",
    marginBottom: rs(16),
  },
  methodChip: {
    paddingVertical: rs(10),
    paddingHorizontal: rs(14),
    borderRadius: rs(14),
    backgroundColor: "#FFE8F0",
    marginRight: rs(10),
  },
  methodChipActive: {
    backgroundColor: "#FF80AB",
  },
  methodText: {
    color: "#B26A86",
    fontWeight: "600",
  },
  methodTextActive: {
    color: "#fff",
  },
  connectBtn: {
    alignSelf: "flex-start",
    paddingVertical: rs(8),
    paddingHorizontal: rs(12),
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB",
    backgroundColor: "#FFF",
    marginBottom: rs(16),
  },
  connectBtnText: {
    color: "#FF80AB",
    fontWeight: "700",
    fontSize: rf(12),
  },
  formCard: {
    backgroundColor: "#FFF",
    borderRadius: rs(14),
    padding: rs(12),
    marginBottom: rs(16),
    shadowColor: "rgba(255,128,171,0.12)",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: rs(0), height: rs(4) },
  },
  accountTypeChip: {
    paddingVertical: rs(8),
    paddingHorizontal: rs(12),
    borderRadius: rs(12),
    backgroundColor: "#FFE8F0",
    marginRight: rs(10),
  },
  accountTypeText: {
    color: "#B26A86",
    fontWeight: "600",
    fontSize: rf(12),
  },
  accountTypeChipActive: {
    backgroundColor: "#FF80AB",
  },
  accountTypeTextActive: {
    color: "#fff",
  },
  rowSplit: {
    flexDirection: "row",
    gap: rs(10),
    marginBottom: rs(16),
    flexWrap: "wrap",
  },
  halfInput: {
    flex: 1,
    marginBottom: rs(0),
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: rs(6),
  },
  metaLabel: {
    color: "#B26A86",
    fontSize: rf(12),
  },
  metaValue: {
    color: "#880E4F",
    fontSize: rf(12),
    fontWeight: "700",
  },
  primaryBtn: {
    backgroundColor: "#FF80AB",
    borderRadius: rs(16),
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: rs(16),
    shadowColor: "rgba(255,128,171,0.25)",
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: rs(0), height: rs(6) },
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(16),
  },
  transactionsCard: {
    backgroundColor: "#FFF",
    borderRadius: rs(14),
    padding: rs(12),
    marginBottom: rs(16),
    shadowColor: "rgba(255,128,171,0.12)",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: rs(0), height: rs(4) },
  },
  transactionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: rs(10),
    borderBottomWidth: 1,
    borderBottomColor: "#F5D7E4",
    gap: rs(8),
  },
  transactionTitle: {
    color: "#880E4F",
    fontWeight: "700",
    fontSize: rf(13),
  },
  transactionMeta: {
    color: "#B26A86",
    fontSize: rf(11),
    marginTop: rs(2),
  },
  stripeStatusCard: {
    backgroundColor: "#FFF4F8",
    borderRadius: rs(20),
    borderWidth: 1,
    borderColor: "#F4C8D8",
    padding: rs(16),
    marginBottom: rs(18),
  },
  stripeStatusHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(8),
  },
  stripeStatusTitle: {
    fontSize: rf(15),
    fontWeight: "800",
    color: "#6F1D3B",
  },
  stripeRefreshText: {
    fontSize: rf(12),
    fontWeight: "700",
    color: "#C2185B",
  },
  stripeStatusValue: {
    fontSize: rf(18),
    fontWeight: "800",
    color: "#9C274D",
    marginBottom: rs(6),
  },
  stripeStatusValueReady: {
    color: "#138A52",
  },
  stripeStatusMeta: {
    fontSize: rf(12),
    color: "#7D455B",
    marginBottom: rs(4),
  },
  breakdownWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: rs(6),
    marginTop: rs(8),
  },
  breakdownChip: {
    paddingHorizontal: rs(8),
    paddingVertical: rs(5),
    borderRadius: rs(999),
    backgroundColor: "#FFF4F8",
    borderWidth: 1,
    borderColor: "#F3D6E2",
  },
  breakdownChipHighlight: {
    backgroundColor: "#EEF8F0",
    borderColor: "#CBE8D1",
  },
  breakdownChipText: {
    color: "#880E4F",
    fontSize: rf(10.5),
    fontWeight: "600",
  },
  transactionAmount: {
    color: "#AD1457",
    fontWeight: "700",
    fontSize: rf(13),
  },
  transactionAmountCredit: {
    color: "#2E7D32",
  },
  transactionAmountDebit: {
    color: "#C2185B",
  },
  mutedText: {
    color: "#B26A86",
    fontSize: rf(12),
  },
  commissionCard: {
    backgroundColor: "#FFF",
    borderRadius: rs(14),
    padding: rs(12),
    marginTop: rs(-6),
    marginBottom: rs(16),
    shadowColor: "rgba(255,128,171,0.12)",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: rs(0), height: rs(4) },
  },
  commissionTitle: {
    color: "#880E4F",
    fontSize: rf(13),
    fontWeight: "700",
    marginBottom: rs(6),
  },
  commissionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: rs(4),
  },
  commissionLabel: {
    color: "#B26A86",
    fontSize: rf(12),
  },
  commissionValue: {
    color: "#880E4F",
    fontSize: rf(12),
    fontWeight: "700",
  },
  errorText: {
    color: "#C2185B",
    fontSize: rf(12),
    marginTop: rs(10),
    textAlign: "center",
  },
});

export default NannyWithdrawScreen;
