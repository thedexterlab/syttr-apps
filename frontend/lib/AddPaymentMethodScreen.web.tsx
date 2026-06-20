import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { rf, rs } from "../app/utils/responsive";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { STRIPE_PUBLISHABLE_KEY } from "../app/Api";
import { usePaymentMethodsStore, type PaymentMethod } from "../app/components/paymentMethodsStore";

type PaymentType = "card";

type Props = {
  navigation?: { goBack?: () => void };
  onBack?: () => void;
};

const STEPS = {
  SELECT: 1,
  CONFIGURE: 2,
};

export default function AddPaymentMethodScreen({ navigation, onBack }: Props) {
  const stripePromise = useMemo(() => loadStripe(STRIPE_PUBLISHABLE_KEY), []);
  return (
    <Elements stripe={stripePromise}>
      <AddPaymentMethodBody navigation={navigation} onBack={onBack} />
    </Elements>
  );
}

function AddPaymentMethodBody({ navigation, onBack }: Props) {
  const { width, fontScale } = useWindowDimensions();
  const isVerySmallScreen = width <= 320;
  const isSmallScreen = width <= 360;
  const isTablet = width >= 768;
  const contentMaxWidth = isTablet ? 760 : 640;
  const bodyHorizontalPadding = isVerySmallScreen ? rs(10) : isSmallScreen ? rs(12) : isTablet ? rs(24) : rs(16);
  const cardFieldHeight = Math.max(44, Math.round(44 * Math.max(1, fontScale * 0.95) + (isTablet ? 6 : 0)));
  const buttonVerticalPadding = isTablet ? rs(16) : rs(14);
  const savedIconSize = isTablet ? rs(38) : isSmallScreen ? rs(28) : rs(32);

  const {
    methods,
    addPaymentMethod,
    removePaymentMethod,
    isLoading: loadingMethods,
  } = usePaymentMethodsStore();
  const stripe = useStripe();
  const elements = useElements();

  const [step, setStep] = useState<number>(STEPS.SELECT);
  const [type, setType] = useState<PaymentType>("card");
  const [holderName, setHolderName] = useState<string>("");
  const [cardComplete, setCardComplete] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const resetForm = () => {
    setStep(STEPS.SELECT);
    setType("card");
    setHolderName("");
    setCardComplete(false);
  };

  const getMethodIcon = (
    method: PaymentMethod
  ): React.ComponentProps<typeof Ionicons>["name"] => {
    if (method.type === "apple_pay") return "logo-apple";
    if (method.type === "venmo") return "wallet";
    return "card";
  };

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

  const getDeleteMessage = (method: PaymentMethod) => {
    const lines = [
      `Name: ${getMethodLabel(method)}`,
      `Last 4: ${method.lastFour || "N/A"}`,
      `Expiry: ${method.expiry || "N/A"}`,
      `CVV last: ${method.cvcLast || "N/A"}`,
    ];
    return `Are you sure you want to remove this payment method?\n\n${lines.join("\n")}`;
  };

  const handleDelete = async (method: PaymentMethod) => {
    const message = getDeleteMessage(method);

    const ok = window.confirm(message);
    if (!ok) return;
    try {
      await removePaymentMethod(method.id);
    } catch (e: any) {
      window.alert(e?.message || "Unable to delete payment method");
    }
  };

  const proceed = () => setStep(STEPS.CONFIGURE);

  const handleSave = async () => {
    try {
      setLoading(true);

      if (type === "card") {
        if (!holderName.trim()) {
          Alert.alert("Error", "Enter card holder name");
          return;
        }
        if (!cardComplete) {
          Alert.alert("Error", "Enter full card details");
          return;
        }
        const cardElement = elements?.getElement(CardElement);
        if (!stripe || !cardElement) {
          Alert.alert("Error", "Stripe not ready");
          return;
        }
        const result = await stripe.createPaymentMethod({
          type: "card",
          card: cardElement,
          billing_details: { name: holderName.trim() },
        });
        if (result?.error) throw new Error(result.error.message);
        const paymentMethod = result?.paymentMethod;
        if (!paymentMethod?.id) throw new Error("Unable to create Stripe payment method.");

        const card = paymentMethod.card;
        await addPaymentMethod({
          type: "card",
          stripePaymentMethodId: paymentMethod.id,
          name: holderName.trim(),
          brand: card?.brand,
          lastFour: card?.last4,
          expiry:
            card?.exp_month && card?.exp_year
              ? `${card.exp_month}/${card.exp_year}`
              : undefined,
        });
        Alert.alert("Success", "Card added successfully");
        resetForm();
        return;
      }

      Alert.alert("Payment method", "Card payments are currently supported on web.");
      resetForm();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={styles.root}>
      <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={[styles.header]}>
        <TouchableOpacity
          onPress={() => {
            if (onBack) onBack();
            else navigation?.goBack?.();
          }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={18} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Payment</Text>
        <View style={{ width: rs(40) }} />
      </LinearGradient>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.body,
          { paddingHorizontal: bodyHorizontalPadding, paddingBottom: rs(32) },
        ]}
      >
        <View style={[styles.bodyInner, { maxWidth: contentMaxWidth }]}>
        {step === STEPS.SELECT && (
          <>
            <Text style={styles.sectionTitle}>Saved methods</Text>
            {loadingMethods && methods.length === 0 ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="small" color="#C2185B" />
                <Text style={styles.loadingText}>Loading saved payment methods...</Text>
              </View>
            ) : methods.length === 0 ? (
              <Text style={styles.emptyState}>No payment methods saved yet.</Text>
            ) : (
              <View style={styles.savedList}>
                {methods.map((method) => (
                  <View key={method.id} style={[styles.savedMethod, isSmallScreen && styles.savedMethodCompact]}>
                    <View style={styles.savedLeft}>
                      <View style={[styles.savedIcon, { width: savedIconSize, height: savedIconSize }]}>
                        <Ionicons name={getMethodIcon(method)} size={18} color="#C2185B" />
                      </View>
                      <View style={styles.savedTextWrap}>
                        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.savedName}>{getMethodLabel(method)}</Text>
                        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.savedMeta}>{getMethodMeta(method)}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={[styles.deleteBtn, isSmallScreen && styles.deleteBtnCompact]}
                      onPress={() => {
                        void handleDelete(method);
                      }}
                    >
                      <Ionicons name="trash-outline" size={16} color="#C2185B" />
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>Choose payment method</Text>

            <View style={styles.row}>
              <MethodCard label="Card" icon="card" active={type === "card"} onPress={() => setType("card")} />
            </View>
            <Text style={styles.infoText}>Web checkout currently supports card payments only.</Text>

            <PrimaryButton label="Continue" onPress={proceed} />
          </>
        )}

        {step === STEPS.CONFIGURE && (
          <>
            <Text style={styles.sectionTitle}>Setup {type.replace("_", " ")}</Text>

            {type === "card" && (
              <>
                <Input
                  placeholder="Card Name"
                  value={holderName}
                  onChangeText={setHolderName}
                  icon="person"
                />
                <View style={styles.cardElementWrap}>
                  <CardElement
                    options={{
                      style: {
                        base: {
                          fontSize: "14px",
                          color: "#880E4F",
                          "::placeholder": { color: "#C2185B99" },
                        },
                      },
                    }}
                    onChange={(event: any) => setCardComplete(!!event?.complete)}
                  />
                </View>
              </>
            )}

            <PrimaryButton
              label={loading ? "Saving..." : "Add Payment Method"}
              onPress={handleSave}
              disabled={loading}
              buttonStyle={{ paddingVertical: buttonVerticalPadding, minHeight: cardFieldHeight }}
            />
          </>
        )}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

function MethodCard({
  label,
  icon,
  active,
  muted,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  active: boolean;
  muted?: boolean;
  onPress: () => void;
}) {
  const { width } = useWindowDimensions();
  const isVerySmallScreen = width <= 320;
  const isSmallScreen = width <= 360;
  const methodsPerRow = isVerySmallScreen ? 1 : isSmallScreen ? 2 : 3;
  const cardBasis = methodsPerRow === 3 ? "31%" : methodsPerRow === 2 ? "48%" : "100%";
  const isTablet = width >= 768;
  return (
    <TouchableOpacity
      style={[
        styles.methodCard,
        { flexBasis: cardBasis, minHeight: isTablet ? rs(90) : rs(82), paddingVertical: isTablet ? rs(16) : rs(12) },
        active && styles.methodCardActive,
        muted && { opacity: 0.45 },
      ]}
      onPress={onPress}
      activeOpacity={0.9}
    >
      <Ionicons name={icon} size={22} color={active ? "#fff" : "#C2185B"} />
      <Text numberOfLines={1} style={[styles.methodLabel, isVerySmallScreen && styles.methodLabelCompact, active && { color: "#C77A00" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Input({
  icon,
  ...props
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: any;
}) {
  return (
    <View style={styles.inputWrap}>
      <Ionicons name={icon} size={18} color="#FF80AB" />
      <TextInput {...props} style={styles.input} placeholderTextColor="#C2185B99" />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  buttonStyle,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  buttonStyle?: any;
}) {
  return (
    <TouchableOpacity style={[styles.btn, buttonStyle, disabled && { opacity: 0.7 }]} onPress={onPress} disabled={disabled} activeOpacity={0.9}>
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    height: rs(70),
    paddingHorizontal: rs(16),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  backBtn: {
    width: rs(38),
    height: rs(38),
    borderRadius: rs(19),
    backgroundColor: "#FFE89A",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: "#C77A00", fontSize: rf(18), fontWeight: "700" },
  body: { alignItems: "center" },
  bodyInner: { width: "100%" },
  sectionTitle: { fontSize: rf(16), fontWeight: "700", color: "#880E4F", marginBottom: rs(12) },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: rs(20) },
  methodCard: {
    paddingHorizontal: rs(8),
    backgroundColor: "#C77A00",
    borderRadius: rs(14),
    alignItems: "center",
    marginBottom: rs(10),
    borderWidth: 1,
    borderColor: "#FF80AB40",
  },
  methodCardActive: { backgroundColor: "#FF80AB", borderColor: "#FF80AB" },
  methodLabel: { fontWeight: "700", color: "#880E4F" },
  methodLabelCompact: { fontSize: rf(12) },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#C77A00",
    borderRadius: rs(12),
    paddingHorizontal: rs(12),
    paddingVertical: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB30",
    marginBottom: rs(12),
  },
  input: { flex: 1, color: "#880E4F" },
  cardElementWrap: {
    backgroundColor: "#C77A00",
    borderRadius: rs(12),
    paddingHorizontal: rs(12),
    paddingVertical: rs(16),
    borderWidth: 1,
    borderColor: "#FF80AB30",
    marginBottom: rs(12),
  },
  infoText: { color: "#AD1457", marginBottom: rs(12) },
  btn: {
    marginTop: rs(12),
    backgroundColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: rs(14),
    alignItems: "center",
    shadowColor: "#FF80AB",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: rs(0), height: rs(3) },
    elevation: 3,
  },
  btnText: { color: "#C77A00", fontWeight: "700", fontSize: rf(14) },
  emptyState: { color: "#AD1457", marginBottom: rs(12) },
  loadingState: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(10),
    marginBottom: rs(12),
  },
  loadingText: { color: "#AD1457" },
  savedList: { marginBottom: rs(16) },
  savedMethod: {
    backgroundColor: "#C77A00",
    borderRadius: rs(12),
    padding: rs(12),
    borderWidth: 1,
    borderColor: "#FF80AB30",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(10),
  },
  savedMethodCompact: { alignItems: "flex-start" },
  savedLeft: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: rs(8), minWidth: 0 },
  savedTextWrap: { flex: 1, minWidth: 0 },
  savedIcon: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(10),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(10),
  },
  savedName: { fontWeight: "700", color: "#880E4F" },
  savedMeta: { fontSize: rf(12), color: "#AD1457", marginTop: rs(2) },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: rs(10),
    paddingVertical: rs(6),
    borderRadius: rs(10),
    backgroundColor: "#FFE4EC",
  },
  deleteText: { color: "#C2185B", fontSize: rf(12), fontWeight: "700", marginLeft: rs(6) },
  deleteBtnCompact: { alignSelf: "flex-end" },
});

