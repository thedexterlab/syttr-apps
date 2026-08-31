import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import SafeScreen from "../components/SafeScreen";
import { rf, rs } from "../utils/responsive";
import { changePassword, sendPasswordResetCode } from "../Api";

type Props = {
  navigation: any;
  showLoginLink?: boolean;
  onBack?: () => void;
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const MIN_PASSWORD_LENGTH = 6;

export default function ForgotPasswordScreen({ navigation, showLoginLink, onBack }: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const goBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    navigation.goBack();
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (email.trim()) return;
      const [userEmail, nannyEmail, genericEmail] = await Promise.all([
        AppStorage.getItem("user_email"),
        AppStorage.getItem("nanny_email"),
        AppStorage.getItem("email"),
      ]);
      const resolved = String(userEmail || nannyEmail || genericEmail || "").trim();
      if (mounted && resolved) {
        setEmail(resolved);
      }
    })().catch(() => {});
    return () => {
      mounted = false;
    };
  }, [email]);

  const handleSend = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      Alert.alert("Error", "Please enter your email address.");
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      Alert.alert("Error", "Invalid email address.");
      return;
    }
    setLoading(true);
    try {
      const token = await AppStorage.getItem("token");
      const response = await sendPasswordResetCode(
        { email: trimmedEmail },
        token || undefined
      );

      if (response?.success === false) {
        throw new Error(response?.message || "Unable to send verification code.");
      }

      const debugCode = String(response?.debug_code || "").trim();
      if (debugCode) {
        Alert.alert(
          "Verification Code",
          `Use this code: ${debugCode}`
        );
      } else {
        Alert.alert(
          "Verification Code Sent",
          response?.message || "Please check your email inbox and spam folder."
        );
      }

      setCode("");
      setNewPass("");
      setStep(2);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Unable to send verification code.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!code.trim() || !newPass.trim()) {
      Alert.alert("Error", "Please enter code and new password");
      return;
    }
    if (newPass.trim().length < MIN_PASSWORD_LENGTH) {
      Alert.alert("Error", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    try {
      setLoading(true);
      const token = await AppStorage.getItem("token");
      const targetEmail = email.trim();
      if (!isValidEmail(targetEmail)) {
        throw new Error("Please enter a valid email address.");
      }

      await changePassword(
        {
          email: targetEmail,
          new_password: newPass.trim(),
          code: code.trim(),
        },
        token || undefined
      );

      Alert.alert("Success", "Your password has been updated");
      goBack();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Unable to update password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeScreen edges={["left", "right"]}>
      <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={{ flex: 1 }}>

      {/* HEADER */}
      <LinearGradient colors={["#FFFFFF", "#FFFFFF"]} style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={18} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Forgot Password</Text>
        <View style={{ width: rs(40) }} />
      </LinearGradient>

      {/* CARD */}
      <View style={styles.card}>
        <Text style={styles.title}>
          {step === 1 ? "Reset your password" : "Set new password"}
        </Text>

        <Text style={styles.subtitle}>
          {step === 1
            ? "Enter your registered email. We'll send you a verification code."
            : "Enter the code you received and choose a new password."}
        </Text>

        {step === 1 ? (
          <>
            <Input
              icon="mail"
              placeholder="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <InfoBox />

            <PrimaryButton
              label={loading ? "Sending..." : "Send verification code"}
              onPress={handleSend}
              disabled={loading}
            />

          </>
        ) : (
          <>
            <Input
              icon="mail"
              placeholder="Email address"
              value={email}
              editable={false}
              selectTextOnFocus={false}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Input
              icon="key"
              placeholder="Verification code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
            />

            <Input
              icon="lock-closed"
              placeholder="New password"
              value={newPass}
              onChangeText={setNewPass}
              secureTextEntry
            />
            <Text style={styles.passwordHint}>
              {newPass.trim().length >= MIN_PASSWORD_LENGTH
                ? `Password length is good (${newPass.trim().length}/${MIN_PASSWORD_LENGTH})`
                : `${MIN_PASSWORD_LENGTH - newPass.trim().length} more characters needed (min ${MIN_PASSWORD_LENGTH})`}
            </Text>

            <PrimaryButton
              label={loading ? "Updating..." : "Update password"}
              onPress={handleReset}
              disabled={loading}
            />
          </>
        )}
      </View>
      </LinearGradient>
    </SafeScreen>
  );
}

/* ---------------- COMPONENTS ---------------- */

function Input({ icon, ...props }: any) {
  return (
    <View style={styles.inputWrap}>
      <Ionicons
        name={icon}
        size={18}
        color="#FF80AB"
        style={{ marginHorizontal: rs(8) }}
      />
      <TextInput
        {...props}
        style={styles.input}
        placeholderTextColor="rgba(173,20,87,0.5)"
      />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.btn, disabled && { opacity: 0.7 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.9}
    >
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function InfoBox() {
  return (
    <View style={styles.infoBox}>
      <Text style={styles.infoTitle}>Security Notice</Text>
      <Text style={styles.infoBody}>
         Use the email linked to your account{"\n"}
         Code expires in 10 minutes{"\n"}
         Contact support if you do not receive it
      </Text>
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
    width: rs(38),
    height: rs(38),
    borderRadius: rs(19),
    backgroundColor: "#FFE89A",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#C77A00",
    fontSize: rf(18),
    fontWeight: "700",
  },
  card: {
    margin: rs(20),
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.2)",
    ...Platform.select({
      web: {
        boxShadow: "0px 3px 8px rgba(0, 0, 0, 0.05)",
      },
      default: {
        shadowColor: "#000",
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: rs(0), height: rs(3) },
        elevation: 2,
      },
    }),
  },
  title: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
  },
  subtitle: {
    marginTop: rs(6),
    fontSize: rf(13),
    color: "#6B4350",
    lineHeight: rs(18),
  },
  inputWrap: {
    marginTop: rs(14),
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF5F8",
    borderRadius: rs(12),
    paddingHorizontal: rs(8),
    borderColor: "rgba(255,128,171,0.25)",
    borderWidth: 1,
  },
  input: {
    flex: 1,
    paddingVertical: rs(12),
    fontSize: rf(14),
    color: "#880E4F",
  },
  btn: {
    marginTop: rs(18),
    backgroundColor: "#FF80AB",
    borderRadius: rs(12),
    paddingVertical: rs(12),
    alignItems: "center",
    ...Platform.select({
      web: {
        boxShadow: "0px 3px 8px rgba(255, 128, 171, 0.35)",
      },
      default: {
        shadowColor: "#FF80AB",
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: rs(0), height: rs(3) },
        elevation: 3,
      },
    }),
  },
  lockedHint: {
    marginTop: rs(8),
    fontSize: rf(12),
    color: "#AD1457",
    fontWeight: "600",
  },
  passwordHint: {
    marginTop: rs(8),
    fontSize: rf(12),
    color: "#AD1457",
    fontWeight: "600",
  },
  btnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(14),
  },
  infoBox: {
    marginTop: rs(14),
    backgroundColor: "#FFF0F5",
    borderRadius: rs(12),
    padding: rs(12),
    borderColor: "rgba(255,128,171,0.2)",
    borderWidth: 1,
  },
  infoTitle: {
    fontSize: rf(13),
    fontWeight: "700",
    color: "#880E4F",
  },
  infoBody: {
    marginTop: rs(6),
    fontSize: rf(12),
    color: "#6B4350",
    lineHeight: rs(18),
  },
});
