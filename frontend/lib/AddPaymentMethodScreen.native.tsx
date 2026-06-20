import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { STRIPE_PUBLISHABLE_KEY } from "../app/Api";
import { usePaymentMethodsStore, type PaymentMethod } from "../app/components/paymentMethodsStore";
import { rf, rs } from "../app/utils/responsive";

type Props = {
  navigation?: { goBack?: () => void };
  onBack?: () => void;
};

type StripeModule = any;

const STEPS = {
  SELECT: 1,
  CONFIGURE: 2,
} as const;

let stripeModuleCache: StripeModule | null = null;
let stripeModuleResolved = false;

const getStripeModule = (): StripeModule | null => {
  if (stripeModuleResolved) return stripeModuleCache;
  stripeModuleResolved = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    stripeModuleCache = require("@stripe/stripe-react-native") as StripeModule;
  } catch {
    stripeModuleCache = null;
  }
  return stripeModuleCache;
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

export default function AddPaymentMethodScreen(props: Props) {
  const stripeModule = getStripeModule();
  const isExpoGo = (Constants as any)?.appOwnership === "expo";
  const hasNativeStripeRuntime =
    !!stripeModule &&
    typeof stripeModule?.StripeProvider === "function" &&
    typeof stripeModule?.useStripe === "function" &&
    typeof stripeModule?.CardField !== "undefined" &&
    !isExpoGo;

  if (!hasNativeStripeRuntime || !STRIPE_PUBLISHABLE_KEY) {
    return (
      <UnsupportedScreen
        onBack={props.onBack || props.navigation?.goBack}
        message={
          !STRIPE_PUBLISHABLE_KEY
            ? "Stripe is not configured in this build."
            : "This build does not support native Stripe card entry. Use a development build instead of Expo Go."
        }
      />
    );
  }

  const StripeProvider = stripeModule.StripeProvider as React.ComponentType<any>;

  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY} urlScheme="syttr">
      <AddPaymentMethodBody {...props} stripeModule={stripeModule} />
    </StripeProvider>
  );
}

function AddPaymentMethodBody({
  navigation,
  onBack,
  stripeModule,
}: Props & { stripeModule: StripeModule }) {
  const useStripe = stripeModule.useStripe as () => any;
  const CardField = stripeModule.CardField as React.ComponentType<any>;
  const stripe = useStripe();
  const {
    methods,
    addPaymentMethod,
    removePaymentMethod,
    isLoading: loadingMethods,
  } = usePaymentMethodsStore();

  const [step, setStep] = useState<number>(STEPS.SELECT);
  const [holderName, setHolderName] = useState("");
  const [cardComplete, setCardComplete] = useState(false);
  const [loading, setLoading] = useState(false);

  const canSave = useMemo(
    () => holderName.trim().length > 0 && cardComplete && !loading,
    [holderName, cardComplete, loading]
  );

  const resetForm = () => {
    setStep(STEPS.SELECT);
    setHolderName("");
    setCardComplete(false);
  };

  const handleDelete = (method: PaymentMethod) => {
    Alert.alert(
      "Remove payment method",
      `Delete ${getMethodLabel(method)}${method.lastFour ? ` ending in ${method.lastFour}` : ""}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await removePaymentMethod(method.id);
            } catch (error: any) {
              Alert.alert("Payment method", error?.message || "Unable to delete payment method.");
            }
          },
        },
      ]
    );
  };

  const handleSave = async () => {
    if (!canSave) return;

    try {
      setLoading(true);
      const result = await stripe.createPaymentMethod({
        paymentMethodType: "Card",
        paymentMethodData: {
          billingDetails: {
            name: holderName.trim(),
          },
        },
      });

      if (result?.error) {
        throw new Error(result.error.message);
      }

      const paymentMethod = result?.paymentMethod;
      const paymentMethodId = String(paymentMethod?.id || "").trim();
      if (!paymentMethodId) {
        throw new Error("Unable to create Stripe payment method.");
      }

      const card = paymentMethod?.card || {};
      await addPaymentMethod({
        type: "card",
        stripePaymentMethodId: paymentMethodId,
        name: holderName.trim(),
        brand: card?.brand,
        lastFour: card?.last4,
        expiry:
          card?.expMonth && card?.expYear
            ? `${card.expMonth}/${card.expYear}`
            : undefined,
      });

      Alert.alert("Success", "Card added successfully.");
      resetForm();
    } catch (error: any) {
      Alert.alert("Payment method", error?.message || "Unable to add payment method.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
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
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {step === STEPS.SELECT ? (
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
                  <View key={method.id} style={styles.savedMethod}>
                    <View style={styles.savedLeft}>
                      <View style={styles.savedIcon}>
                        <Ionicons name={getMethodIcon(method)} size={18} color="#C2185B" />
                      </View>
                      <View style={styles.savedTextWrap}>
                        <Text numberOfLines={1} style={styles.savedName}>
                          {getMethodLabel(method)}
                        </Text>
                        <Text numberOfLines={1} style={styles.savedMeta}>
                          {getMethodMeta(method)}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(method)}>
                      <Ionicons name="trash-outline" size={16} color="#C2185B" />
                      <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>Add a card</Text>
            <Text style={styles.infoText}>
              Save a card to use for future bookings and charges.
            </Text>

            <TouchableOpacity style={styles.primaryButton} onPress={() => setStep(STEPS.CONFIGURE)}>
              <Text style={styles.primaryText}>Continue</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Card details</Text>

            <TextInput
              value={holderName}
              onChangeText={setHolderName}
              placeholder="Name on card"
              placeholderTextColor="#C2185B99"
              style={styles.input}
            />

            <View style={styles.cardFieldWrap}>
              <CardField
                postalCodeEnabled
                placeholders={{ number: "4242 4242 4242 4242" }}
                onCardChange={(details: any) => setCardComplete(!!details?.complete)}
                style={styles.cardField}
                cardStyle={{
                  backgroundColor: "#FFF6FA",
                  textColor: "#2C1A22",
                  borderColor: "#F5B5CB",
                  borderWidth: 1,
                  borderRadius: 16,
                  placeholderColor: "#C77A98",
                }}
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, !canSave && styles.primaryButtonDisabled]}
              onPress={() => {
                void handleSave();
              }}
              disabled={!canSave}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryText}>Save card</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={resetForm} disabled={loading}>
              <Text style={styles.secondaryText}>Back</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function UnsupportedScreen({
  message,
  onBack,
}: {
  message: string;
  onBack?: (() => void) | undefined;
}) {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={18} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Payment</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.unsupportedWrap}>
        <Text style={styles.unsupportedTitle}>Payment Unavailable</Text>
        <Text style={styles.unsupportedText}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFDFE",
  },
  header: {
    paddingTop: rs(2),
    paddingHorizontal: rs(16),
    paddingBottom: rs(12),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
  },
  backBtn: {
    width: rs(40),
    height: rs(40),
    borderRadius: rs(20),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1F6",
  },
  headerTitle: {
    fontSize: rf(18),
    fontWeight: "800",
    color: "#2C1A22",
  },
  headerSpacer: {
    width: rs(40),
  },
  body: {
    padding: rs(16),
    paddingBottom: rs(32),
  },
  sectionTitle: {
    fontSize: rf(17),
    fontWeight: "800",
    color: "#2C1A22",
    marginBottom: rs(10),
    marginTop: rs(6),
  },
  infoText: {
    fontSize: rf(13),
    lineHeight: rf(18),
    color: "#7A5C69",
    marginBottom: rs(16),
  },
  loadingState: {
    paddingVertical: rs(18),
    alignItems: "center",
    gap: rs(8),
  },
  loadingText: {
    color: "#7A5C69",
    fontSize: rf(13),
  },
  emptyState: {
    fontSize: rf(13),
    color: "#7A5C69",
    marginBottom: rs(18),
  },
  savedList: {
    gap: rs(10),
    marginBottom: rs(20),
  },
  savedMethod: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#F4D7E2",
    borderRadius: rs(18),
    padding: rs(14),
    gap: rs(12),
  },
  savedLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: rs(12),
  },
  savedIcon: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1F6",
  },
  savedTextWrap: {
    flex: 1,
  },
  savedName: {
    fontSize: rf(14),
    fontWeight: "700",
    color: "#2C1A22",
  },
  savedMeta: {
    fontSize: rf(12),
    color: "#7A5C69",
    marginTop: rs(2),
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(4),
  },
  deleteText: {
    color: "#C2185B",
    fontSize: rf(12),
    fontWeight: "700",
  },
  input: {
    height: rs(50),
    borderWidth: 1,
    borderColor: "#F5B5CB",
    borderRadius: rs(16),
    paddingHorizontal: rs(14),
    backgroundColor: "#FFF6FA",
    color: "#2C1A22",
    marginBottom: rs(14),
  },
  cardFieldWrap: {
    borderWidth: 1,
    borderColor: "#F5B5CB",
    borderRadius: rs(16),
    backgroundColor: "#FFF6FA",
    paddingHorizontal: rs(12),
    paddingVertical: rs(6),
    marginBottom: rs(18),
  },
  cardField: {
    width: "100%",
    height: rs(48),
  },
  primaryButton: {
    height: rs(52),
    borderRadius: rs(18),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#C2185B",
    marginTop: rs(4),
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryText: {
    color: "#FFFFFF",
    fontSize: rf(15),
    fontWeight: "800",
  },
  secondaryButton: {
    height: rs(48),
    borderRadius: rs(18),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#F5B5CB",
    backgroundColor: "#FFFFFF",
    marginTop: rs(12),
  },
  secondaryText: {
    color: "#C2185B",
    fontSize: rf(14),
    fontWeight: "700",
  },
  unsupportedWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: rs(24),
  },
  unsupportedTitle: {
    fontSize: rf(18),
    fontWeight: "800",
    color: "#2C1A22",
    marginBottom: rs(10),
  },
  unsupportedText: {
    textAlign: "center",
    fontSize: rf(14),
    lineHeight: rf(20),
    color: "#7A5C69",
  },
});
