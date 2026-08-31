import { Fonts } from '@/constants/theme';
import AppLogo from '../_utils/AppLogo';
import { Ionicons } from '@expo/vector-icons';
import AppStorage from "@/lib/storage";
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hp, rf, rs, wp } from "../_utils/responsive";
import SafeScreen from "../_utils/SafeScreen";

const palette = {
  primary: '#F27C9C',
  accent: '#F6BC63',
  accentDeep: '#E38C42',
  textPrimary: '#4F2A32',
  textSecondary: '#7C4A55',
  surface: '#FFF7F0',
  outline: 'rgba(242, 124, 156, 0.2)',
  shadow: 'rgba(242, 124, 156, 0.18)',
};

const initialForm = {
  fullname: '',
  email: '',
  password: '',
  confirm: '',
};

const RESET_KEYS_FOR_NEW_NANNY_SIGNUP = [
  "token",
  "id",
  "user_id",
  "user_name",
  "user_email",
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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hasFullName = (value: string) => value.trim().split(/\s+/).filter(Boolean).length >= 2;
const fullNameHint = "Use your full name, not just your first name.";
const MIN_PASSWORD_LENGTH = 8;

type Props = {
  navigation?: any;
  onBack?: () => void;
  onSuccess?: (data?: SignupData) => void;
  onLoginPress?: () => void;
  onTermsPress?: () => void;
  onPrivacyPress?: () => void;
};

export type SignupData = {
  fullname: string;
  email: string;
  password: string;
  password_confirmation: string;
};

const SignupNannyScreen: React.FC<Props> = ({
  navigation,
  onBack,
  onSuccess = () => {},
  onLoginPress = () => {},
  onTermsPress = () => {},
  onPrivacyPress = () => {},
}) => {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const titleSize = Math.min(Math.max(rf(24), 18), 32);
  const subtitleSize = Math.min(Math.max(rf(13), 12), 18);

  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const isValid = useMemo(() => {
    return (
      hasFullName(form.fullname) &&
      emailRegex.test(form.email.trim()) &&
      form.password.length >= MIN_PASSWORD_LENGTH &&
      form.password === form.confirm &&
      accepted
    );
  }, [form, accepted]);

  const update = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    const fullName = form.fullname.trim();
    const email = form.email.trim().toLowerCase();

    if (!fullName || !email || !form.password || !form.confirm) {
      Alert.alert("Error", "Please fill in all required fields.");
      return;
    }
    if (!hasFullName(fullName)) {
      Alert.alert("Error", "Please enter your full name.");
      return;
    }
    if (!emailRegex.test(email)) {
      Alert.alert("Error", "Invalid email address.");
      return;
    }
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      Alert.alert("Error", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (form.password !== form.confirm) {
      Alert.alert("Error", "Passwords do not match.");
      return;
    }
    if (!accepted) {
      Alert.alert("Error", "Please accept the Terms & Conditions and Privacy Policy.");
      return;
    }

    setLoading(true);
    try {
      await AppStorage.multiRemove([...RESET_KEYS_FOR_NEW_NANNY_SIGNUP]);
      await AppStorage.multiSet([
        ["nanny_name", fullName],
        ["nanny_email", email],
        ["user_type", "nanny"],
      ]);
      await AppStorage.setItem(
        "signup_nanny_draft",
        JSON.stringify({
          fullname: fullName,
          email,
          password: form.password,
          password_confirmation: form.confirm,
        })
      );

      Keyboard.dismiss();
      await new Promise((resolve) => setTimeout(resolve, 300));

      onSuccess?.({
        fullname: fullName,
        email,
        password: form.password,
        password_confirmation: form.confirm,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={['#FFFFFF', '#FFFFFF', '#FFFFFF']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <StatusBar style="dark" />

      <View style={[styles.headerRow, { top: insets.top + rs(6) }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (onBack) onBack();
            else if (navigation?.canGoBack?.()) navigation.goBack();
          }}
        >
          <LinearGradient
            colors={[palette.accentDeep, palette.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.backButtonGradient}
          >
            <Ionicons name="chevron-back" size={22} color="#FFF" />
          </LinearGradient>
        </TouchableOpacity>
        <View style={styles.headerSpacer} />
      </View>

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

        <Text style={[styles.title, { fontSize: titleSize }]}>Join as a Syttr</Text>
        <Text style={[styles.subtitle, { fontSize: subtitleSize }]}>
          Create your professional Syttr account and start your journey
        </Text>

        <Input
          icon="person-outline"
          label="Full Name"
          value={form.fullname}
          onChangeText={t => update('fullname', t)}
          placeholder="Enter your full name"
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete={Platform.OS === "android" ? "name" : undefined}
          textContentType={Platform.OS === "ios" ? "name" : undefined}
          importantForAutofill={Platform.OS === "android" ? "yes" : undefined}
          returnKeyType="next"
        />
        <Text style={styles.nameHint}>{fullNameHint}</Text>

        <Input
          icon="mail-outline"
          label="Email Address"
          value={form.email}
          onChangeText={t => update('email', t)}
          placeholder="Enter your email"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={Platform.OS === "android" ? "email" : undefined}
          textContentType={Platform.OS === "ios" ? "emailAddress" : undefined}
          importantForAutofill={Platform.OS === "android" ? "yes" : undefined}
          returnKeyType="next"
        />

        <PasswordInput
          label="Password"
          value={form.password}
          onChangeText={t => update('password', t)}
          secure={!showPass}
          toggle={() => setShowPass(v => !v)}
          placeholder="Create a password"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={Platform.OS === "android" ? "new-password" : undefined}
          textContentType={Platform.OS === "ios" ? "newPassword" : undefined}
          importantForAutofill={Platform.OS === "android" ? "yes" : undefined}
          returnKeyType="next"
        />
        <Text style={styles.passwordHint}>
          {form.password.length >= MIN_PASSWORD_LENGTH
            ? `Password length is good (${form.password.length}/${MIN_PASSWORD_LENGTH})`
            : `${MIN_PASSWORD_LENGTH - form.password.length} more characters needed (min ${MIN_PASSWORD_LENGTH})`}
        </Text>

        <PasswordInput
          label="Confirm Password"
          value={form.confirm}
          onChangeText={t => update('confirm', t)}
          secure={!showConfirm}
          toggle={() => setShowConfirm(v => !v)}
          placeholder="Re-enter password"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={Platform.OS === "android" ? "off" : undefined}
          textContentType={Platform.OS === "ios" ? "none" : undefined}
          importantForAutofill={Platform.OS === "android" ? "no" : undefined}
          returnKeyType="done"
        />

        <TouchableOpacity
          style={styles.termsRow}
          onPress={() => setAccepted(v => !v)}
        >
          <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
            {accepted && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Text style={styles.termsText}>
            I agree to the{' '}
            <Text style={styles.link} onPress={onTermsPress}>
              Terms & Conditions
            </Text>{' '}
            and{' '}
            <Text style={styles.link} onPress={onPrivacyPress}>
              Privacy Policy
            </Text>
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            !isValid && { opacity: 0.6 },
          ]}
          disabled={!isValid || loading}
          onPress={submit}
        >
          <LinearGradient
            colors={[palette.primary, palette.accent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.buttonGradient}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Create Account</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <View style={styles.bottomRow}>
          <Text style={styles.bottomText}>Already have an account?</Text>
          <Text style={styles.link} onPress={onLoginPress}> Sign In</Text>
        </View>
      </SafeScreen>
    </LinearGradient>
  );
};

export default SignupNannyScreen;

type InputProps = TextInputProps & {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
};

const Input: React.FC<InputProps> = ({ icon, label, ...props }) => {
  const { width } = useWindowDimensions();
  const iconSize = Math.min(Math.max(width * 0.04, 14), 20);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputBox}>
        <LinearGradient
          colors={[palette.accent, palette.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.iconContainer}
        >
          <Ionicons name={icon} size={iconSize} color="#FFF" />
        </LinearGradient>
        <TextInput
          style={styles.input}
          placeholderTextColor={palette.textSecondary}
          {...props}
        />
      </View>
    </View>
  );
};

type PasswordInputProps = TextInputProps & {
  label: string;
  secure: boolean;
  toggle: () => void;
};

const PasswordInput: React.FC<PasswordInputProps> = ({ label, secure, toggle, ...props }) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.inputBox}>
      <LinearGradient
        colors={[palette.accent, palette.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.iconContainer}
      >
        <Ionicons name="lock-closed-outline" size={18} color="#FFF" />
      </LinearGradient>
      <TextInput
        style={styles.input}
        secureTextEntry={secure}
        placeholderTextColor={palette.textSecondary}
        {...props}
      />
      <PasswordToggle secure={secure} onPress={toggle} />
    </View>
  </View>
);

function PasswordToggle({ secure, onPress }: { secure: boolean; onPress: () => void }) {
  const { width } = useWindowDimensions();
  const iconSize = Math.max(14, Math.min(18, width * 0.04));

  return (
    <TouchableOpacity onPress={onPress}>
      <Ionicons
        name={secure ? 'eye-outline' : 'eye-off-outline'}
        size={iconSize}
        color={palette.primary}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },

  scroll: {},

  headerRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  headerSpacer: {
    width: Math.max(rs(44), wp(12)),
    height: Math.max(rs(44), wp(12)),
  },

  backButton: {
    width: Math.max(rs(44), wp(12)),
    height: Math.max(rs(44), wp(12)),
    borderRadius: Math.max(rs(22), wp(6)),
    overflow: 'hidden',
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
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

  backButtonGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  logoWrap: {
    alignItems: 'center',
    marginVertical: rs(18),
  },

  logoCircle: {
    justifyContent: 'center',
    alignItems: 'center',
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
    backgroundColor: '#FFF8F3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: palette.outline,
  },

  logo: {
    width: '70%',
    height: '70%',
  },

  title: {
    fontSize: rf(32),
    fontWeight: '700',
    color: palette.textPrimary,
    textAlign: 'center',
    fontFamily: Fonts.display,
    marginTop: rs(2),
  },

  subtitle: {
    marginTop: rs(0),
    fontSize: rf(13),
    color: palette.textSecondary,
    marginBottom: rs(20),
    textAlign: 'center',
    fontFamily: Fonts.display,
  },

  field: {
    marginBottom: rs(16),
  },

  label: {
    fontSize: rf(12),
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: rs(6),
    fontFamily: Fonts.display,
  },

  nameHint: {
    marginTop: rs(-10),
    marginBottom: rs(8),
    fontSize: rf(12),
    color: palette.textSecondary,
    fontFamily: Fonts.display,
  },

  passwordHint: {
    marginTop: rs(-10),
    marginBottom: rs(8),
    fontSize: rf(12),
    color: palette.textSecondary,
    fontFamily: Fonts.display,
  },

  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7F2',
    borderRadius: rs(14),
    paddingHorizontal: wp(2.5),
    borderWidth: 1.5,
    borderColor: palette.outline,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(255, 95, 162, 0.2)',
      },
      default: {
        elevation: 3,
        shadowColor: 'rgba(255, 95, 162, 0.2)',
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
    alignItems: 'center',
    justifyContent: 'center',
    margin: rs(4),
  },

  input: {
    flex: 1,
    fontSize: rf(14),
    color: palette.textPrimary,
    paddingVertical: rs(12),
    marginHorizontal: Math.max(rs(4), wp(2)),
    fontWeight: '600',
    flexShrink: 1,
    fontFamily: Platform.OS === "android" ? undefined : Fonts.display,
  },

  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: rs(16),
  },

  checkbox: {
    width: Math.max(rs(16), wp(5)),
    height: Math.max(rs(16), wp(5)),
    borderRadius: rs(4),
    borderWidth: 1.5,
    borderColor: palette.primary,
    marginRight: wp(2),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },

  checkboxChecked: {
    backgroundColor: palette.primary,
  },

  termsText: {
    flex: 1,
    fontSize: rf(14),
    color: palette.textPrimary,
    fontFamily: Fonts.display,
  },

  link: {
    color: palette.accentDeep,
    fontWeight: '700',
    fontFamily: Fonts.display,
  },

  button: {
    height: Math.max(rs(56), hp(6)),
    borderRadius: rs(14),
    width: '100%',
    marginTop: rs(10),
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
    overflow: 'hidden',
  },

  buttonGradient: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: rs(14),
  },

  buttonText: {
    color: '#fff',
    fontSize: rf(16),
    fontWeight: '700',
    fontFamily: Fonts.display,
  },

  bottomRow: {
    marginTop: hp(2),
    flexDirection: 'row',
    justifyContent: 'center',
  },

  bottomText: {
    fontSize: rf(14),
    color: palette.textPrimary,
    fontFamily: Fonts.display,
  },
});
