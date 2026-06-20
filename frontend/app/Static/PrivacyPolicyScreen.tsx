import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hp, rf, rs, wp } from "../_utils/responsive";
// import SafeScreen from "../components/SafeScreen";

type Props = {
  navigation?: any;
};

const POLICY_SECTIONS = [
  {
    title: "INTRODUCTION",
    content: `Welcome to Syttr ("we," "us," "our"). This Privacy Policy governs the collection, use, and protection of information obtained from individuals who access and use our Platform.

We are committed to respecting your privacy and protecting your personal information. By accessing or using our Platform, you agree to the practices described in this Privacy Policy.

If you do not agree with these practices, please do not use our Platform.`,
  },
  {
    title: "TYPES OF INFORMATION COLLECTED",
    content: `- Personal Identification Information such as name, email, phone number, and profile photo.

- Financial and Transactional Information processed securely via Stripe.

- Professional Background details for nannies including certifications and experience.

- Optional Health Information voluntarily provided by users.`,
  },
  {
    title: "METHODS OF COLLECTION",
    content: `- Account creation and profile setup.

- Contact forms and support communications.

All information is collected directly and transparently.`,
  },
  {
    title: "PURPOSE OF COLLECTION",
    content: `- To provide and manage services.

- To improve platform experience.

- For marketing and communication.

- For security, fraud prevention, and legal compliance.`,
  },
  {
    title: "NO SALE OF DATA",
    content: `We do not sell, trade, or rent your personal data. Your information is never treated as a commodity.`,
  },
  {
    title: "DATA SECURITY",
    content: `- Secure SSL encryption.

- Protected servers and access controls.

- Regular security audits and monitoring.`,
  },
  {
    title: "USER RIGHTS",
    content: `You have the right to access, correct, delete, restrict, and object to processing of your data.

You may withdraw consent at any time.`,
  },
  {
    title: "CONTACT US",
    content: `If you have questions about this Privacy Policy, contact us at:

support@syttr.com`,
  },
];

export default function PrivacyPolicyScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 600,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 600,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
      colors={["#FFFFFF", "#FFFFFF"]}
      style={{ flex: 1 }}
      >
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top + rs(6), rs(18)) }]}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()}>
          <Ionicons name="chevron-back" size={22} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: rs(22) }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Header Card */}
        <Animated.View
          style={[
            styles.card,
            {
              opacity: fade,
              transform: [{ translateY: slide }, { scale }],
            },
          ]}
        >
          <View style={styles.iconCircle}>
            <Ionicons name="shield-checkmark" size={26} color="#fff" />
          </View>
          <View>
            <Text style={styles.brand}>Syttr</Text>
            <Text style={styles.subBrand}>Privacy Policy</Text>
          </View>
        </Animated.View>

        {/* Last Updated */}
        <Animated.View style={[styles.updateCard, styles.mt]}>
          <Ionicons name="time" size={18} color="#FF80AB" />
          <View style={{ marginLeft: rs(12) }}>
            <Text style={styles.updateLabel}>Last Updated</Text>
            <Text style={styles.updateDate}>April 11, 2024</Text>
          </View>
        </Animated.View>

        {/* Sections */}
        {POLICY_SECTIONS.map((sec, index) => (
          <Animated.View key={index} style={[styles.card, styles.mt]}>
            <View style={styles.headingContainer}>
              <View style={styles.sectionHeader}>
                <View style={styles.numberBox}>
                  <Text style={styles.number}>{index + 1}</Text>
                </View>
                <Text style={styles.sectionTitle}>{sec.title}</Text>
              </View>
            </View>
            <View style={styles.pointContainer}>
              <Text style={styles.sectionText}>{sec.content}</Text>
            </View>
          </Animated.View>
        ))}

        {/* Footer */}
        <Animated.View style={[styles.footer, styles.mt]}>
          <Ionicons name="mail" size={18} color="#FF80AB" />
          <View style={{ marginLeft: rs(12) }}>
            <Text style={styles.footerLabel}>Questions? Contact us at:</Text>
            <Text style={styles.footerEmail}>support@syttr.com</Text>
          </View>
        </Animated.View>

        <Text style={styles.copyright}>
          © 2024 Syttr. All rights reserved.
        </Text>
      </ScrollView>
      </LinearGradient>
    </View>
  );
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingTop: rs(1),
    paddingBottom: rs(14),
    backgroundColor: "rgba(255,255,255,0.9)",
    borderBottomLeftRadius: rs(18),
    borderBottomRightRadius: rs(18),
    elevation: 2,
  },
  headerTitle: {
    color: "#C77A00",
    fontSize: rf(20),
    fontWeight: "700",
    lineHeight: rs(24),},
  container: {
    padding: rs(16),
    paddingBottom: rs(40),
  },
  card: {
    backgroundColor: "#FFF1F6",
    borderRadius: rs(20),
    padding: rs(18),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  mt: {
    marginTop: rs(16),
  },
  iconCircle: {
    width: rs(56),
    height: rs(56),
    borderRadius: rs(28),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: rs(12),
  },
  brand: {
    fontSize: rf(20),
    fontWeight: "700",
    color: "#880E4F",
    lineHeight: rs(24),  },
  subBrand: {
    fontSize: rf(14),
    color: "#AD1457",
    lineHeight: rs(20),  },
  updateCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FF80AB20",
    borderRadius: rs(12),
    padding: rs(14),
  },
  updateLabel: {
    fontSize: rf(12),
    color: "#AD1457",
    lineHeight: rs(16),  },
  updateDate: {
    fontSize: rf(14),
    fontWeight: "600",
    color: "#880E4F",
    lineHeight: rs(20),  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: rs(0),
  },
  numberBox: {
    backgroundColor: "#FF80AB20",
    padding: rs(8),
    borderRadius: rs(8),
    marginRight: rs(12),
  },
  number: {
    fontWeight: "700",
    color: "#880E4F",
    fontSize: rf(14),
    lineHeight: rs(18),  },
  sectionTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
    lineHeight: rs(22),  },
  sectionText: {
    fontSize: rf(14),
    color: "#AD1457",
    lineHeight: rs(22),textAlign: "left",  },
  headingContainer: {
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    borderRadius: rs(12),
    paddingHorizontal: rs(10),
    paddingVertical: rs(8),
    marginBottom: rs(10),
  },
  pointContainer: {
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    borderRadius: rs(12),
    paddingHorizontal: rs(10),
    paddingVertical: rs(8),
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FF80AB10",
    borderRadius: rs(12),
    padding: rs(14),
  },
  footerLabel: {
    fontSize: rf(12),
    color: "#AD1457",
    lineHeight: rs(16),  },
  footerEmail: {
    fontSize: rf(14),
    fontWeight: "600",
    color: "#880E4F",
    lineHeight: rs(20),  },
  copyright: {
    marginTop: rs(16),
    fontSize: rf(12),
    color: "#AD1457",
    textAlign: "center",
    lineHeight: rs(16),  },
});

