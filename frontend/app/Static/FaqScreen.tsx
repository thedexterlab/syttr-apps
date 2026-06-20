import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { rf, rs } from "../_utils/responsive";
// import SafeScreen from "../components/SafeScreen";
import { PARENT_FAQS, type FaqItem } from "./_data/faqs";

export type { FaqItem };

type Props = {
  navigation?: any;
  faqs?: FaqItem[];
  title?: string;
  subtitle?: string;
};

export default function FaqScreen({
  navigation,
  faqs,
  title,
  subtitle,
}: Props) {
  const useNative = Platform.OS !== "web";
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;
  const scale = useRef(new Animated.Value(0.95)).current;
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const items = faqs && faqs.length > 0 ? faqs : PARENT_FAQS;
  const heading = title || "Parent FAQs";
  const subheading =
    subtitle || "Answers for booking, matching, and payments.";

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 600,
        useNativeDriver: useNative,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 600,
        useNativeDriver: useNative,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        useNativeDriver: useNative,
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()}>
          <Ionicons name="chevron-back" size={22} color="#C2185B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{heading}</Text>
        <View style={{ width: rs(22) }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Intro Card */}
        <Animated.View
          style={[
            styles.introCard,
            {
              opacity: fade,
              transform: [{ translateY: slide }, { scale }],
            },
          ]}
        >
          <View style={styles.introTopContainer}>
            <View style={styles.iconCircle}>
              <Ionicons name="help-outline" size={26} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.introTitle}>{heading}</Text>
              <Text style={styles.introSubtitle}>{subheading}</Text>
            </View>
          </View>
        </Animated.View>

        {/* FAQ LIST */}
        {items.map((item, index) => {
          const isOpen = openIndex === index;
          const cardTranslateY = slide.interpolate({
            inputRange: [0, 20],
            outputRange: [0, 20 + index * 5],
          });
          return (
            <Animated.View
              key={`${item.q}-${index}`}
              style={[
                styles.faqCard,
                {
                  opacity: fade,
                  transform: [{ translateY: cardTranslateY }],
                },
              ]}
            >
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setOpenIndex(isOpen ? null : index)}
                style={styles.row}
                accessibilityRole="button"
                accessibilityLabel={`Toggle FAQ ${index + 1}`}
                accessibilityState={{ expanded: isOpen }}
              >
                <View style={styles.indexBox}>
                  <Text style={styles.indexText}>{index + 1}</Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.question}>{item.q}</Text>
                  {isOpen && (
                    <Text style={styles.answer}>
                      {item.a.split("\n").map((line, i) => (
                        <Text key={`${item.q}-line-${i}`}>
                          {line}
                          {"\n"}
                        </Text>
                      ))}
                    </Text>
                  )}
                </View>
                <Ionicons
                  name={isOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color="#880E4F"
                />
              </TouchableOpacity>
            </Animated.View>
          );
        })}

        {/* CTA */}
        <Animated.View
          style={[
            styles.cta,
            { opacity: fade, transform: [{ translateY: slide }] },
          ]}
        >
          <Text style={styles.ctaTitle}>Still need help?</Text>
          <TouchableOpacity style={styles.ctaButton} onPress={() => navigation?.navigate?.("contactUs")}>
            <LinearGradient colors={["#FF80AB", "#FFB6C1"]} style={styles.ctaGradient}>
              <Text style={styles.ctaButtonText}>Contact Support</Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
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
  },
  container: {
    padding: rs(16),
    paddingBottom: rs(40),
  },
  introCard: {
    flexDirection: "column",
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: rs(20),
    padding: rs(18),
    alignItems: "stretch",
    marginBottom: rs(20),
  },
  introTopContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FFF1F6",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    borderRadius: rs(12),
    paddingHorizontal: rs(10),
    paddingVertical: rs(8),
  },
  iconCircle: {
    width: rs(56),
    height: rs(56),
    borderRadius: rs(28),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(12),
  },
  introTitle: {
    fontSize: rf(20),
    fontWeight: "700",
    color: "#880E4F",
  },
  introSubtitle: {
    fontSize: rf(14),
    color: "#AD1457",
    marginTop: rs(6),
  },
  faqCard: {
    backgroundColor: "#FFF1F6",
    borderRadius: rs(20),
    padding: rs(18),
    marginBottom: rs(16),
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  indexBox: {
    width: rs(32),
    height: rs(32),
    borderRadius: rs(8),
    backgroundColor: "#FF80AB20",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(12),
  },
  indexText: {
    fontWeight: "700",
    color: "#880E4F",
  },
  question: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(6),
  },
  answer: {
    fontSize: rf(14),
    color: "#AD1457",
    lineHeight: rs(22),
  },
  cta: {
    alignItems: "center",
    marginTop: rs(30),
    width: "100%",
  },
  ctaTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(8),
  },
  ctaButton: {
    width: "100%",
    marginTop: rs(10),
  },
  ctaGradient: {
    paddingVertical: rs(14),
    borderRadius: rs(14),
    alignItems: "center",
  },
  ctaButtonText: {
    color: "#C77A00",
    fontWeight: "700",
    fontSize: rf(15),
  },
});


