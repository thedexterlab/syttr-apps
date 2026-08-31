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
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { rf, rs } from "../_utils/responsive";
// import SafeScreen from "../components/SafeScreen";

type Props = {
  navigation?: any;
};

export default function TermsConditionsScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(30)).current;
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
  }, [fade, scale, slide]);

  const AnimatedCard = ({ children }: any) => (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: fade,
          transform: [{ translateY: slide }, { scale }],
  },
      ]}
    >
      {children}
    </Animated.View>
  );

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
        <Text style={styles.headerTitle}>Terms & Conditions</Text>
        <View style={{ width: rs(22) }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Header Card */}
        <AnimatedCard>
          <View style={styles.headingContainer}>
            <View style={styles.row}>
              <View style={styles.iconCircle}>
                <Ionicons name="document-text" size={26} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Legal Terms</Text>
                <Text style={styles.cardSub}>
                  Please read our terms carefully
                </Text>
              </View>
            </View>
          </View>
        </AnimatedCard>

        {/* Last Updated */}
        <AnimatedCard>
          <View style={styles.pointCard}>
            <View style={styles.row}>
              <Ionicons
                name="time-outline"
                size={18}
                color="#FF80AB"
              />
              <View style={{ marginLeft: rs(12) }}>
                <Text style={styles.smallLabel}>Last Updated</Text>
                <Text style={styles.boldText}>April 15, 2024</Text>
              </View>
            </View>
          </View>
        </AnimatedCard>

        {/* Introduction */}
        <AnimatedCard>
          <View style={styles.headingContainer}>
            <Text style={styles.sectionTitle}>INTRODUCTION</Text>
          </View>
          <View style={styles.pointCard}>
            <Text style={styles.paragraph}>
              Thank you for choosing to visit Syttr (Company,
              We, Us). These Terms govern your access, interaction,
              and use of our website, mobile applications, and services
              (collectively, the Platform).
            </Text>
          </View>
          <View style={styles.pointCard}>
            <Text style={styles.paragraph}>
              By accessing or using the Platform, you agree to be bound
              by these Terms. If you do not agree, you must refrain from
              using our services.
            </Text>
          </View>
        </AnimatedCard>

        {/* Key Terms */}
        <AnimatedCard>
          <View style={styles.headingContainer}>
            <Text style={styles.sectionTitle}>Key Terms</Text>
          </View>
          {termItem(
            "ACCOUNT CREATION",
            "Users must create an account and provide accurate information."
          )}
          {termItem(
            "PROHIBITED CONDUCT",
            "Illegal activity, abuse, impersonation, and unauthorized access are prohibited."
          )}
          {termItem(
            "NO CONTACT SHARING",
            "Do not share phone numbers or email addresses between parents and sitters."
          )}
          {termItem(
            "SUBSCRIPTION CANCELLATION",
            "Parent subscription cancellations require 30 days' notice."
          )}
          {termItem(
            "USER CONTENT",
            "You retain ownership but grant us permission to use your content."
          )}
          {termItem(
            "INTELLECTUAL PROPERTY",
            "All platform content belongs to Syttr."
          )}
          {termItem(
            "LIMITATION OF LIABILITY",
            "Our total liability shall not exceed $100."
          )}
        </AnimatedCard>

        {/* Additional Terms */}
        <AnimatedCard>
          <View style={styles.headingContainer}>
            <Text style={styles.sectionTitle}>Additional Terms</Text>
          </View>
          {timelineItem(
            "INDEMNIFICATION",
            "You agree to indemnify Syttr."
          )}
          {timelineItem(
            "DISPUTE RESOLUTION",
            "Disputes resolved via mediation then arbitration."
          )}
          {timelineItem(
            "GOVERNING LAW",
            "Illinois law governs these Terms."
          )}
          {timelineItem(
            "AMENDMENTS",
            "Continued use constitutes acceptance of changes."
          )}
          {timelineItem(
            "DATA PRIVACY",
            "Handled as outlined in our Privacy Policy."
          )}
        </AnimatedCard>

        {/* Addendums */}
        <AnimatedCard>
          <Text style={styles.sectionTitle}>
            Role-Specific Addendums
          </Text>

          <View
            style={[
              styles.addendumWrap,
              width > 600 && { flexDirection: "row" },
            ]}
          >
            {addendumCard("Addendum A: Nannies", [
              "Background checks required",
              "No guaranteed work",
              "ACH payment processing",
              "Professional conduct required",
              "No phone/email sharing between sitters and parents",
              "24-hour cancellation policy",
            ])}

            {addendumCard("Addendum B: Customers", [
              "Background checks required",
              "Booking and hiring rules",
              "Automatic payments",
              "30-day notice for subscription cancellation",
              "Health info disclosure",
              "No performance guarantees",
              "Rescheduling rules",
            ])}
          </View>
        </AnimatedCard>

        {/* Acceptance */}
        <AnimatedCard>
          <Text style={styles.sectionTitle}>Acceptance of Terms</Text>
          <Text style={styles.paragraph}>
            By using our Platform, you acknowledge that you have read,
            understood, and agree to these Terms.
          </Text>

          <View style={styles.contactBox}>
            <Ionicons
              name="mail-outline"
              size={18}
              color="#FF80AB"
            />
            <View style={{ marginLeft: rs(12) }}>
              <Text style={styles.boldText}>
                Contact Information
              </Text>
              <Text style={styles.smallText}>
                support@syttr.com{"\n"}(847) 814-2883
              </Text>
            </View>
          </View>
        </AnimatedCard>

        {/* Footer */}
        <Text style={styles.footer}>
          © 2024 Syttr. All rights reserved.
        </Text>
      </ScrollView>
      </LinearGradient>
    </View>
  );
}

/* ---------------- HELPERS ---------------- */

const termItem = (title: string, desc: string) => (
  <View style={styles.pointCard} key={title}>
    <View style={styles.termItem}>
      <View style={styles.dot} />
      <View style={{ flex: 1 }}>
        <Text style={styles.termTitle}>{title}</Text>
        <Text style={styles.termDesc}>{desc}</Text>
      </View>
    </View>
  </View>
);

const timelineItem = (title: string, desc: string) => (
  <View style={styles.pointCard} key={title}>
    <View style={styles.timelineItem}>
      <View style={styles.timelineDot} />
      <View style={{ flex: 1 }}>
        <Text style={styles.termTitle}>{title}</Text>
        <Text style={styles.smallText}>{desc}</Text>
      </View>
    </View>
  </View>
);

const addendumCard = (title: string, items: string[]) => (
  <View style={styles.addendumCard} key={title}>
    <Text style={styles.addendumTitle}>{title}</Text>
    {items.map((i) => (
      <View key={i} style={styles.bulletRow}>
        <View style={styles.bullet} />
        <Text style={styles.smallText}>{i}</Text>
      </View>
    ))}
  </View>
);

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
    fontSize: rf(20),
    fontWeight: "700",
    color: "#C77A00",
    lineHeight: rs(24),
  },
  container: {
    padding: rs(16),
    paddingBottom: rs(40),
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: rs(20),
    padding: rs(18),
    marginBottom: rs(20),
  },
  pointCard: {
    backgroundColor: "#FFF1F6",
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    paddingHorizontal: rs(10),
    paddingVertical: rs(8),
    marginBottom: rs(8),
  },
  headingContainer: {
    backgroundColor: "#FFF1F6",
    borderRadius: rs(12),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    paddingHorizontal: rs(10),
    paddingVertical: rs(8),
    marginBottom: rs(10),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconCircle: {
    width: rs(52),
    height: rs(52),
    borderRadius: rs(26),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(16),
  },
  cardTitle: {
    fontSize: rf(20),
    fontWeight: "700",
    color: "#880E4F",
    lineHeight: rs(24),
  },
  cardSub: {
    fontSize: rf(14),
    color: "#AD1457",
    lineHeight: rs(20),
  },
  sectionTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(12),
    lineHeight: rs(22),
  },
  paragraph: {
    fontSize: rf(14),
    color: "#AD1457",
    lineHeight: rs(22),
    marginBottom: rs(12),
    textAlign: "left",
  },
  smallLabel: {
    fontSize: rf(12),
    color: "#AD1457",
    lineHeight: rs(16),
  },
  boldText: {
    fontSize: rf(14),
    fontWeight: "600",
    color: "#880E4F",
    lineHeight: rs(20),
  },
  smallText: {
    fontSize: rf(14),
    color: "#AD1457",
    lineHeight: rs(20),
  },
  termItem: {
    flexDirection: "row",
    marginBottom: rs(12),
  },
  dot: {
    width: rs(8),
    height: rs(8),
    backgroundColor: "#FF80AB",
    borderRadius: rs(4),
    marginTop: rs(6),
    marginRight: rs(12),
  },
  termTitle: {
    fontSize: rf(14),
    fontWeight: "600",
    color: "#880E4F",
    lineHeight: rs(20),
  },
  termDesc: {
    fontSize: rf(14),
    color: "#AD1457",
    lineHeight: rs(22),
  },
  timelineItem: {
    flexDirection: "row",
    marginBottom: rs(12),
  },
  timelineDot: {
    width: rs(8),
    height: rs(8),
    backgroundColor: "#FF80AB",
    borderRadius: rs(4),
    marginTop: rs(6),
    marginRight: rs(12),
  },
  addendumWrap: {
    gap: rs(16),
  },
  addendumCard: {
    flex: 1,
    padding: rs(16),
    borderRadius: rs(12),
    backgroundColor: "#FF80AB10",
    marginBottom: rs(12),
  },
  addendumTitle: {
    fontSize: rf(16),
    fontWeight: "600",
    color: "#880E4F",
    marginBottom: rs(8),
    lineHeight: rs(20),
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: rs(6),
  },
  bullet: {
    width: rs(6),
    height: rs(6),
    borderRadius: rs(3),
    backgroundColor: "#FF80AB",
    marginTop: rs(7),
    marginRight: rs(8),
  },
  contactBox: {
    flexDirection: "row",
    marginTop: rs(12),
    padding: rs(12),
    borderRadius: rs(12),
    backgroundColor: "#FF80AB10",
  },
  footer: {
    fontSize: rf(12),
    color: "#AD1457",
    textAlign: "center",
    marginTop: rs(16),
    lineHeight: rs(16),
  },
});
