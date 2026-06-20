import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
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
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { STRIPE_PUBLISHABLE_KEY } from "../app/Api";
import { rf, rs } from "../app/utils/responsive";

type Props = {
  visible: boolean;
  amount: number;
  onCancel: () => void;
  onConfirm: (stripePaymentMethodId: string) => Promise<boolean>;
};

export default function VerificationOneTimePayment(props: Props) {
  const stripePromise = useMemo(
    () => (STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null),
    []
  );

  if (!props.visible) return null;

  if (!STRIPE_PUBLISHABLE_KEY || !stripePromise) {
    return (
      <UnsupportedModal
        visible={props.visible}
        onCancel={props.onCancel}
        message="Stripe is not configured in this build, so one-time card entry is unavailable."
      />
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <VerificationOneTimePaymentBody {...props} />
    </Elements>
  );
}

function VerificationOneTimePaymentBody({ amount, onCancel, onConfirm, visible }: Props) {
  const stripe = useStripe();
  const elements = useElements();

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
      const cardElement = elements?.getElement(CardElement);
      if (!stripe || !cardElement) {
        throw new Error("Stripe is not ready yet.");
      }

      const result = await stripe.createPaymentMethod({
        type: "card",
        card: cardElement,
        billing_details: {
          name: holderName.trim(),
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
            <CardElement
              options={{
                hidePostalCode: true,
                style: {
                  base: {
                    color: "#6B4350",
                    fontSize: `${rf(13)}px`,
                    "::placeholder": {
                      color: "#C2185B99",
                    },
                  },
                },
              }}
              onChange={(event) => setCardComplete(!!event.complete)}
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
    paddingHorizontal: rs(12),
    paddingVertical: rs(14),
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
