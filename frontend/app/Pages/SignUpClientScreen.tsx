import { Fonts } from "@/constants/theme";
import AppLogo from "../_utils/AppLogo";
import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hp, rf, rs, wp } from "../_utils/responsive";
import SafeScreen from "../_utils/SafeScreen";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hasFullName = (value: string) => value.trim().split(/\s+/).filter(Boolean).length >= 2;
const fullNameHint = "Use your full name, not just your first name.";
const MIN_PASSWORD_LENGTH = 8;
const RESET_KEYS_FOR_NEW_CLIENT_SIGNUP = [
  "token",
  "id",
  "user_id",
  "user_phone",
  "user_country",
  "user_city",
  "user_address",
  "user_gender",
  "user_about",
  "user_image",
  "user_verification_status",
  "taz_order_guid",
  "taz_quickapp_link",
  "manage_children",
  "nanny_id",
  "nanny_name",
  "nanny_email",
  "nanny_phone",
  "nanny_address",
  "nanny_city",
  "nanny_country",
  "nanny_gender",
  "nanny_about",
  "nanny_experience",
  "nanny_dob",
  "nanny_image",
  "nanny_availability",
  "nanny_profile_payload",
  "rate_morning",
  "rate_evening",
  "rate_night",
] as const;

const palette = {
  primary: "#F27C9C",
  accent: "#F6BC63",
  accentDeep: "#E38C42",
  textPrimary: "#5B2E2E",
  textSecondary: "#8B5C5C",
  surface: "#FFF3EC",
  outline: "rgba(242, 124, 156, 0.2)",
  shadow: "rgba(242, 124, 156, 0.18)",
};

type Props = {
  navigation?: any;
  onBack?: () => void;
  onSuccess?: (data?: SignupData) => void;
  onTermsPress?: () => void;
  onPrivacyPress?: () => void;
  onLoginPress?: () => void;
};

type SignupData = {
  fullname: string;
  email: string;
};

const SignUpClientScreen: React.FC<Props> = ({
  navigation,
  onBack,
  onSuccess = () => {},
  onTermsPress = () => {},
  onPrivacyPress = () => {},
  onLoginPress = () => {},
}) => {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const titleSize = Math.min(Math.max(rf(24), 18), 32);
  const subtitleSize = Math.min(Math.max(rf(13), 12), 18);
  const fieldLabelSize = Math.min(Math.max(rf(12), 11), 16);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [hidePass, setHidePass] = useState(true);
  const [hideConfirm, setHideConfirm] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const showError = (msg: string) => {
    setSignupError(msg);
  };

  const onSignup = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedName || !trimmedEmail || !password || !confirm)
      return showError("Please fill all fields");
    if (!hasFullName(trimmedName))
      return showError("Please enter your full name");
    if (!emailRegex.test(trimmedEmail))
      return showError("Invalid email address");
    if (password.length < MIN_PASSWORD_LENGTH)
      return showError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    if (password !== confirm)
      return showError("Passwords do not match");
    if (!accepted)
      return showError("Please accept the Terms & Conditions and Privacy Policy.");

    setSignupError("");
    setIsLoading(true);
    try {
      // New signup must not reuse a previous logged-in session.
      await AppStorage.multiRemove([...RESET_KEYS_FOR_NEW_CLIENT_SIGNUP]);
      await AppStorage.multiSet([
        ["user_name", trimmedName],
        ["user_email", trimmedEmail],
        ["user_type", "client"],
      ]);
      await AppStorage.setItem(
        "signup_client_draft",
        JSON.stringify({
          fullname: trimmedName,
          email: trimmedEmail,
          password,
          password_confirmation: confirm,
        })
      );
      onSuccess?.({
        fullname: trimmedName,
        email: trimmedEmail,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={["#FFFFFF", "#FFFFFF", "#FFFFFF"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <View style={[styles.headerRow, { top: insets.top + rs(6) }]}>
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
          <LinearGradient
            colors={[palette.accentDeep, palette.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.backBtnGradient}
          >
            <Ionicons name="chevron-back" size={20} color="#FFF" />
          </LinearGradient>
        </TouchableOpacity>
        <View style={styles.headerSpacer} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SafeScreen
          scroll
          edges={["top", "left", "right", "bottom"]}
          contentContainerStyle={[
            styles.scroll,
            {
              minHeight: height,
              paddingTop: Math.max(insets.top + rs(5), rs(44)),
              paddingBottom: insets.bottom + hp(3),
              paddingHorizontal: wp(5),
            },
          ]}
        >
          <AppLogo />

          <Text style={[styles.title, { fontSize: titleSize }]}>Hello Parents!</Text>
          <Text style={[styles.subtitle, { fontSize: subtitleSize }]}>
            Create your account to find the perfect Syttr
          </Text>

          {/* Inputs */}
          <Input
            icon="person-outline"
            fieldLabelSize={fieldLabelSize}
            label="Full Name"
            placeholder="Enter your full name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            autoComplete="name"
            textContentType="name"
            importantForAutofill="yes"
          />
          <Text style={styles.nameHint}>{fullNameHint}</Text>

          <Input
            icon="mail-outline"
            fieldLabelSize={fieldLabelSize}
            label="Email"
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            importantForAutofill="yes"
          />

          <PasswordInput
            fieldLabelSize={fieldLabelSize}
            label="Password"
            value={password}
            onChangeText={setPassword}
            hidden={hidePass}
            toggle={() => setHidePass(!hidePass)}
            placeholder="Password"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            importantForAutofill="yes"
          />
          <Text style={styles.passwordHint}>
            {password.length >= MIN_PASSWORD_LENGTH
              ? `Password length is good (${password.length}/${MIN_PASSWORD_LENGTH})`
              : `${MIN_PASSWORD_LENGTH - password.length} more characters needed (min ${MIN_PASSWORD_LENGTH})`}
          </Text>

          <PasswordInput
            fieldLabelSize={fieldLabelSize}
            label="Confirm Password"
            value={confirm}
            onChangeText={setConfirm}
            hidden={hideConfirm}
            toggle={() => setHideConfirm(!hideConfirm)}
            placeholder="Confirm Password"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            importantForAutofill="yes"
          />

          {/* Terms */}
          <View style={styles.termsRow}>
            <TouchableOpacity
              style={[styles.checkbox, accepted && styles.checkboxChecked]}
              onPress={() => setAccepted(!accepted)}
            >
              {accepted && <Ionicons name="checkmark" size={14} color="#FFF" />}
            </TouchableOpacity>
            <Text style={styles.termsText}>
              I agree to{" "}
              <Text style={styles.link} onPress={onTermsPress}>Terms and Conditions</Text> &{" "}
              <Text style={styles.link} onPress={onPrivacyPress}>Privacy Policy</Text>
            </Text>
          </View>

          {/* Button */}
          {!!signupError && !isLoading && (
            <Text style={styles.errorText}>{signupError}</Text>
          )}
          <TouchableOpacity
            style={styles.button}
            onPress={onSignup}
            disabled={isLoading}
          >
            <LinearGradient
              colors={[palette.primary, palette.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.buttonGradient}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Create Account</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Bottom */}
          <View style={styles.bottomRow}>
            <Text style={styles.bottomText}>Already have an account?</Text>
            <Text style={styles.link} onPress={onLoginPress}> Sign In</Text>
          </View>
        </SafeScreen>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

export default SignUpClientScreen;

/* ---------- Reusable Inputs ---------- */

type InputProps = TextInputProps & {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  fieldLabelSize?: number;
};

const Input: React.FC<InputProps> = ({ icon, label, fieldLabelSize, ...props }) => {
  const { width } = useWindowDimensions();
  const iconSize = Math.min(Math.max(width * 0.04, 14), 20);
  return (
  <View style={styles.fieldGroup}>
    <Text style={[styles.fieldLabel, fieldLabelSize ? { fontSize: fieldLabelSize } : null]}>{label}</Text>
    <View style={styles.inputBox}>
      <LinearGradient
        colors={[palette.accent, palette.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.iconContainer}
      >
        <Ionicons name={icon} size={iconSize} color="#FFF" />
      </LinearGradient>
      <TextInput style={styles.input} placeholderTextColor={palette.textSecondary} {...props} />
    </View>
  </View>
);
};

type PasswordInputProps = TextInputProps & {
  hidden: boolean;
  toggle: () => void;
  label: string;
  fieldLabelSize?: number;
};

const PasswordInput: React.FC<PasswordInputProps> = ({ hidden, toggle, label, fieldLabelSize, ...props }) => {
  const { width } = useWindowDimensions();
  const iconSize = Math.min(Math.max(width * 0.04, 14), 20);
  return (
  <View style={styles.fieldGroup}>
    <Text style={[styles.fieldLabel, fieldLabelSize ? { fontSize: fieldLabelSize } : null]}>{label}</Text>
    <View style={styles.inputBox}>
      <LinearGradient
        colors={[palette.accent, palette.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.iconContainer}
      >
        <Ionicons name="lock-closed-outline" size={iconSize} color="#FFF" />
      </LinearGradient>
      <TextInput
        style={styles.input}
        secureTextEntry={hidden}
        placeholderTextColor={palette.textSecondary}
        {...props}
      />
      <TouchableOpacity onPress={toggle}>
        <Ionicons
          name={hidden ? "eye-off-outline" : "eye-outline"}
          size={iconSize}
          color={palette.primary}
        />
      </TouchableOpacity>
    </View>
  </View>
);
};

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingBottom: rs(40) },
  headerRow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerSpacer: {
    width: rs(44),
    height: rs(44),
  },

  backBtn: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    overflow: "hidden",
    alignSelf: "flex-start",
    ...Platform.select({
      web: {
        boxShadow: `0px 4px 12px ${palette.shadow}`,
      },
      default: {
        elevation: 8,
        shadowColor: palette.primary,
        shadowOffset: { width: rs(0), height: rs(4) },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
    }),
  },

  backBtnGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  logoWrapper: {
    alignItems: "center",
    marginVertical: rs(18),
  },

  logoCircle: {
    alignItems: "center",
    justifyContent: "center",
    padding: rs(10),
    ...Platform.select({
      web: {
        boxShadow: `0px 10px 24px ${palette.shadow}`,
      },
      default: {
        elevation: 12,
        shadowColor: palette.primary,
        shadowOffset: { width: rs(0), height: rs(10) },
        shadowOpacity: 0.35,
        shadowRadius: 24,
      },
    }),
  },

  logoInnerCircle: {
    backgroundColor: "#FFF8F3",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: palette.outline,
  },

  logo: {
    width: "70%",
    height: "70%",
  },

  title: {
    marginTop: rs(2),
    fontSize: rf(24),
    fontWeight: "700",
    color: palette.textPrimary,
    textAlign: "center",
    fontFamily: Fonts.display,
  },

  subtitle: {
    textAlign: "center",
    color: palette.textSecondary,
    marginBottom: rs(20),
    fontSize: rf(13),
    fontFamily: Fonts.display,
  },

  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7F2",
    borderRadius: rs(14),
    borderWidth: 1.5,
    borderColor: palette.outline,
    paddingHorizontal: wp(2.5),
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(255, 95, 162, 0.2)',
      },
      default: {
        elevation: 3,
        shadowColor: "rgba(255, 95, 162, 0.2)",
        shadowOffset: { width: rs(0), height: rs(2) },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
    }),
  },

  iconContainer: {
    width: Math.max(rs(34), wp(10)),
    height: Math.max(rs(34), wp(10)),
    borderRadius: rs(14),
    alignItems: "center",
    justifyContent: "center",
    margin: rs(4),
  },

  input: {
    flex: 1,
    paddingVertical: rs(12),
    marginHorizontal: Math.max(rs(4), wp(2)),
    fontSize: rf(14),
    color: palette.textPrimary,
    fontWeight: "600",
    fontFamily: Platform.OS === "android" ? undefined : Fonts.display,
    flexShrink: 1,
  },
  fieldGroup: {
    marginBottom: rs(16),
  },
  fieldLabel: {
    marginBottom: rs(6),
    fontSize: rf(12),
    fontWeight: "700",
    color: palette.textPrimary,
    fontFamily: Fonts.display,
  },
  nameHint: {
    marginTop: rs(-8),
    marginBottom: rs(10),
    fontSize: rf(12),
    color: palette.textSecondary,
    fontFamily: Fonts.display,
  },
  passwordHint: {
    marginTop: rs(-8),
    marginBottom: rs(10),
    fontSize: rf(12),
    color: palette.textSecondary,
    fontFamily: Fonts.display,
  },

  termsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: rs(14),
  },

  checkbox: {
    width: Math.max(rs(16), wp(5)),
    height: Math.max(rs(16), wp(5)),
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: wp(2),
    borderRadius: rs(4),
  },

  checkboxChecked: {
    backgroundColor: palette.primary,
  },

  termsText: { flex: 1, fontSize: rf(14), color: palette.textPrimary, fontFamily: Fonts.display },

  link: {
    color: palette.accentDeep,
    fontWeight: "700",
    fontFamily: Fonts.display,
  },

  button: {
    height: Math.max(rs(50), hp(6)),
    borderRadius: rs(14),
    width: "100%",
    marginTop: rs(12),
    ...Platform.select({
      web: {
        boxShadow: `0px 6px 12px ${palette.shadow}`,
      },
      default: {
        elevation: 6,
        shadowColor: palette.primary,
        shadowOffset: { width: rs(0), height: rs(6) },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
    }),
    overflow: "hidden",
    backgroundColor: "transparent",
  },

  buttonGradient: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: rs(16),
  },

  buttonText: {
    color: "#fff",
    fontSize: rf(15),
    fontWeight: "700",
    fontFamily: Fonts.display,
  },
  errorText: {
    color: palette.accentDeep,
    fontSize: Math.min(Math.max(rf(13), 12), 16),
    textAlign: "center",
    marginBottom: rs(10),
    fontFamily: Fonts.display,
  },

  bottomRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: hp(2),
  },

  bottomText: {
    color: palette.textPrimary,
    fontFamily: Fonts.display,
  },
});
