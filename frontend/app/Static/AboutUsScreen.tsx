import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { rf, rs } from "../_utils/responsive";
// import SafeScreen from "../components/SafeScreen";

type Props = {
  navigation?: { goBack?: () => void };
};

type SectionProps = {
  index: number;
  title: string;
  content: string;
};

function Section({ index, title, content }: SectionProps) {
  const localFade = useRef(new Animated.Value(0)).current;
  const localSlide = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(localFade, {
        toValue: 1,
        duration: 500,
        delay: index * 120,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(localSlide, {
        toValue: 0,
        duration: 500,
        delay: index * 120,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start();
  }, [index, localFade, localSlide]);

  return (
    <Animated.View
      style={[
        styles.sectionCard,
        { opacity: localFade, transform: [{ translateY: localSlide }] },
      ]}
    >
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIndex}>
          <Text style={styles.sectionIndexText}>{index}</Text>
        </View>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      </View>

      <Text style={styles.sectionText}>{content}</Text>
    </Animated.View>
  );
}

export default function AboutUsScreen({ navigation }: Props) {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 700,
        useNativeDriver: Platform.OS !== "web",
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 700,
        useNativeDriver: Platform.OS !== "web",
      }),
    ]).start();
  }, [fade, slide]);

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
      colors={["#FFFFFF", "#FFFFFF"]}
      style={{ flex: 1 }}
      >
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => navigation?.goBack?.()}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={22} color="#C2185B" />
        </Pressable>
        <Text accessibilityRole="header" style={styles.headerTitle}>About Us</Text>
        <View style={{ width: rs(22) }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Top Card */}
        <Animated.View
          accessible
          accessibilityLabel="About Syttr"
          style={[
            styles.topCard,
            { opacity: fade, transform: [{ translateY: slide }] },
          ]}
        >
          <View style={styles.logoCircle}>
            <Ionicons name="people" size={28} color="#fff" />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>Syttr</Text>
            <Text style={styles.tagline}>
              Connecting families with trusted local Syttrs.
            </Text>
          </View>
        </Animated.View>

        {/* Mission */}
        <Animated.View
          style={[
            styles.missionCard,
            { opacity: fade, transform: [{ translateY: slide }] },
          ]}
        >
          <Ionicons name="heart" size={18} color="#FF80AB" />
          <View style={{ marginLeft: rs(10), flex: 1 }}>
            <Text style={styles.missionLabel}>Our Mission</Text>
            <Text style={styles.missionText}>
              To make trusted childcare feel simple, personal, and close to home.
            </Text>
          </View>
        </Animated.View>

        {/* Sections */}
        <Section
          index={1}
          title="OUR STORY"
          content="Welcome to Syttr, a family-owned and operated app founded by three little sisters and a big brother with a passion for helping local families connect with exceptional BabySyttr. Growing up together taught us how essential reliable childcare is and how challenging it can be for families to find trustworthy caregivers. That inspired us to build a platform that makes the process simpler and gives peace of mind to both parents and Syttrs."
        />

        <Section
          index={2}
          title="COMMUNITY FIRST"
          content="At Syttr, we believe in the power of family and the impact of quality care on children's lives. Our app is designed to make discovering top-notch local BabySyttr quick and stress-free, so you can focus on what matters most: your family. Rooted in our community, we are committed to helping families access the best childcare solutions while supporting the Syttrs who serve them."
        />

        <Section
          index={3}
          title="VALUES WE LIVE BY"
          content="Our family business is built on trust, integrity, and personalized service. Every BabySyttr on our platform is handpicked to reflect those values, creating nurturing and safe environments for children. Each Syttr is carefully screened and vetted, so you know your little ones are in capable, caring hands."
        />

        <Section
          index={4}
          title="JOIN THE SYTTR FAMILY"
          content="Syttr is more than an app; it is our promise to support families and help them thrive. We know every household is unique, and our mission is to match you with the Syttr who fits your family's needs. Join the Syttr family today and experience the difference of a team that genuinely cares about your family's well-being."
        />

        {/* Footer */}
        <Animated.View
          style={[
            styles.footerCard,
            { opacity: fade, transform: [{ translateY: slide }] },
          ]}
        >
          <Ionicons name="mail" size={18} color="#FF80AB" />
          <View style={{ marginLeft: rs(10) }}>
            <Text style={styles.footerLabel}>
              Have questions? Reach out to us at:
            </Text>
            <Text style={styles.footerEmail}>care@syttr.com</Text>
          </View>
        </Animated.View>

        <Text style={styles.copyright}>
          {`Copyright ${currentYear} Syttr. All rights reserved.`}
        </Text>
      </ScrollView>
      </LinearGradient>
    </View>
  );
}

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
  },
  container: {
    padding: rs(16),
    paddingBottom: rs(40),
  },
  topCard: {
    backgroundColor: "#FFF1F6",
    borderRadius: rs(20),
    padding: rs(18),
    flexDirection: "row",
    alignItems: "center",
    marginBottom: rs(20),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  logoCircle: {
    width: rs(54),
    height: rs(54),
    borderRadius: rs(27),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(14),
  },
  brand: {
    fontSize: rf(20),
    fontWeight: "700",
    color: "#880E4F",
  },
  tagline: {
    fontSize: rf(13),
    color: "#AD1457",
    marginTop: rs(4),
  },
  missionCard: {
    flexDirection: "row",
    backgroundColor: "#FFF1F6",
    borderRadius: rs(14),
    padding: rs(14),
    marginBottom: rs(20),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  missionLabel: {
    fontSize: rf(18),
    fontWeight: "700",  // make it bold
    marginBottom: rs(4),    // add a little spacing from the paragraph
    color: "#AD1457",
  },
  missionText: {
    fontSize: rf(14),
    fontWeight: "600",
    color: "#880E4F",
  },
  sectionCard: {
    backgroundColor: "#FFF1F6",
    borderRadius: rs(20),
    padding: rs(18),
    marginBottom: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: rs(12),
  },
  sectionIndex: {
    width: rs(30),
    height: rs(30),
    borderRadius: rs(8),
    backgroundColor: "#FFE4EC",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(12),
  },
  sectionIndexText: {
    fontWeight: "700",
    color: "#880E4F",
  },
  sectionTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
  },
  sectionText: {
    fontSize: rf(14),
    color: "#AD1457",
    lineHeight: rs(22),
  },
  footerCard: {
    flexDirection: "row",
    backgroundColor: "#FFF1F6",
    borderRadius: rs(14),
    padding: rs(14),
    marginTop: rs(10),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  footerLabel: {
    fontSize: rf(12),
    color: "#AD1457",
  },
  footerEmail: {
    fontSize: rf(14),
    fontWeight: "700",
    color: "#880E4F",
  },
  copyright: {
    textAlign: "center",
    fontSize: rf(12),
    color: "#AD1457",
    marginTop: rs(20),
  },
  pressed: {
    opacity: 0.7,
  },
});

