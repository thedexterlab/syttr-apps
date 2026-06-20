import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { STRIPE_PUBLISHABLE_KEY } from "../app/Api";
import { rf, rs } from "../app/utils/responsive";

type Props = {
  visible: boolean;
  amount: number;
  onCancel: () => void;
  onConfirm: (stripePaymentMethodId: string) => Promise<boolean>;
};

type StripeModule = any;

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

export default function VerificationOneTimePayment(props: Props) {
  const stripeModule = getStripeModule();
  const isExpoGo = (Constants as any)?.appOwnership === "expo";
  const hasNativeStripeRuntime =
    !!stripeModule &&
    typeof stripeModule?.StripeProvider === "function" &&
    typeof stripeModule?.useStripe === "function" &&
    typeof stripeModule?.CardField !== "undefined" &&
    !isExpoGo;

  if (!props.visible) return null;

  if (!hasNativeStripeRuntime || !STRIPE_PUBLISHABLE_KEY) {
    return (
      <UnsupportedModal
        visible={props.visible}
        onCancel={props.onCancel}
        message={
          !STRIPE_PUBLISHABLE_KEY
            ? "Stripe is not configured in this build, so one-time card entry is unavailable."
            : "This build does not support Stripe card entry. Use a development build to pay without saving the card."
        }
      />
    );
  }

  const StripeProvider = stripeModule.StripeProvider as React.ComponentType<any>;

  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY} urlScheme="syttr">
      <VerificationOneTimePaymentBody {...props} stripeModule={stripeModule} />
    </StripeProvider>
  );
}

function VerificationOneTimePaymentBody({
  amount,
  onCancel,
  onConfirm,
  stripeModule,
  visible,
}: Props & { stripeModule: StripeModule }) {
  const useStripe = stripeModule.useStripe as () => any;
  const CardField = stripeModule.CardField as React.ComponentType<any>;
  const stripe = useStripe();

  const [holderName, setHolderName] = useState("");
  const [cardComplete, setCardComplete] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) {
      setHolderName("");
      setCardComplete(false);
      setLoading(false);
    }
  }, [visible]);

  const handlePay = async () => {
    if (!holderName.trim() || !cardComplete || loading) {
      return;
    }

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

      const stripePaymentMethodId = String(result?.paymentMethod?.id || "").trim();
      if (!stripePaymentMethodId) {
        throw new Error("Unable to prepare the card for payment.");
      }

      const paid = await onConfirm(stripePaymentMethodId);
      if (paid) {
        setHolderName("");
        setCardComplete(false);
      }
    } catch (error: any) {
      Alert.alert("Payment failed", error?.message || "Unable to process payment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.headerIcon}>
              <Ionicons name="card-outline" size={16} color="#C2185B" />
            </View>
            <Text style={styles.title}>Pay Without Saving Card</Text>
          </View>
          <Text style={styles.text}>
            Enter card details to pay {`$${amount.toFixed(2)}`} for verification. This card will not be saved.
          </Text>

          <Text style={styles.label}>Cardholder name</Text>
          <TextInput
            value={holderName}
            onChangeText={setHolderName}
            placeholder="Name on card"
            placeholderTextColor="#C2185B99"
            style={styles.input}
          />

          <Text style={styles.label}>Card details</Text>
          <View style={styles.cardFieldWrap}>
            <CardField
              postalCodeEnabled={false}
              placeholders={{ number: "4242 4242 4242 4242" }}
              cardStyle={{
                backgroundColor: "#FFFFFF",
                textColor: "#6B4350",
                placeholderColor: "#C2185B99",
                borderColor: "#EFC7D4",
                borderWidth: 0,
                textErrorColor: "#C62828",
                fontSize: rf(13),
              }}
              onCardChange={(details: any) => setCardComplete(!!details?.complete)}
              style={styles.cardField}
            />
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={onCancel} disabled={loading}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (!holderName.trim() || !cardComplete || loading) && styles.primaryButtonDisabled,
              ]}
              onPress={() => {
                void handlePay();
              }}
              disabled={!holderName.trim() || !cardComplete || loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryText}>{`Pay $${amount.toFixed(2)}`}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function UnsupportedModal({
  message,
  onCancel,
  visible,
}: {
  message: string;
  onCancel: () => void;
  visible: boolean;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Payment Unavailable</Text>
          <Text style={styles.text}>{message}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.primaryButton} onPress={onCancel}>
              <Text style={styles.primaryText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: rs(20),
  },
  card: {
    width: "100%",
    maxWidth: rs(420),
    backgroundColor: "#FFF",
    borderRadius: rs(18),
    padding: rs(18),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.3)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    marginBottom: rs(8),
  },
  headerIcon: {
    width: rs(28),
    height: rs(28),
    borderRadius: rs(14),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1F6",
  },
  title: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#C2185B",
  },
  text: {
    fontSize: rf(13),
    color: "#6B4350",
    marginBottom: rs(12),
    lineHeight: rs(18),
  },
  label: {
    color: "#A0124A",
    fontSize: rf(12),
    fontWeight: "700",
    marginBottom: rs(6),
  },
  input: {
    height: rs(44),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.45)",
    backgroundColor: "#fff",
    borderRadius: rs(10),
    paddingHorizontal: rs(12),
    color: "#6B4350",
    marginBottom: rs(12),
    fontSize: rf(13),
  },
  cardFieldWrap: {
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.45)",
    backgroundColor: "#fff",
    borderRadius: rs(10),
    paddingHorizontal: rs(10),
    paddingVertical: rs(8),
  },
  cardField: {
    width: "100%",
    minHeight: rs(44),
    height: rs(44),
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: rs(10),
    marginTop: rs(16),
  },
  secondaryButton: {
    paddingVertical: rs(10),
    paddingHorizontal: rs(16),
    borderRadius: rs(10),
    borderWidth: 1,
    borderColor: "#FF80AB",
  },
  secondaryText: {
    color: "#C2185B",
    fontWeight: "700",
  },
  primaryButton: {
    minWidth: rs(132),
    paddingVertical: rs(10),
    paddingHorizontal: rs(16),
    borderRadius: rs(10),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryText: {
    color: "#fff",
    fontWeight: "700",
  },
});
