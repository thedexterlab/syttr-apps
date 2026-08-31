import { Ionicons } from "@expo/vector-icons";
import AppStorage from "@/lib/storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BASE_URL, getRuntimeApiKey, sanitizeToken } from "../Api";
import { rf, rs } from "../_utils/responsive";
// import SafeScreen from "../components/SafeScreen";

type Props = {
  navigation?: any;
};

export default function RateAppScreen({ navigation }: Props) {
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(30)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

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

  const ratingText = (value: number) => {
    switch (value) {
      case 1:
        return "Poor - We're sorry to hear that";
      case 2:
        return "Fair - We'll improve";
      case 3:
        return "Good - Glad you're enjoying it";
      case 4:
        return "Very Good - Thank you!";
      case 5:
        return "Excellent - You made our day!";
      default:
        return "Tap the stars to rate";
    }
  };

  const submitFeedback = async () => {
    const entries = await AppStorage.multiGet([
      "token",
      "nanny_token",
      "api_key",
      "user_id",
      "nanny_id",
      "user_type",
      "user_name",
      "nanny_name",
      "user_email",
      "nanny_email",
      "email",
    ]);
    const map = Object.fromEntries(entries);
    const userType = String(map.user_type || "").trim().toLowerCase();
    const email =
      String(
        map.user_email ||
          map.nanny_email ||
          map.email ||
          ""
      ).trim();

    if (!email) return;

    const senderName = String(
      map.user_name ||
        map.nanny_name ||
        ""
    ).trim();
    const cleanToken = sanitizeToken(String(map.token || map.nanny_token || "").trim() || undefined);
    const cleanApiKey = String(map.api_key || "").trim() || getRuntimeApiKey();
    const messageLines = [
      `Rating: ${rating}/5`,
      `Platform: ${Platform.OS}`,
      review.trim() ? `Review: ${review.trim()}` : "Review: No written feedback provided.",
    ];

    const response = await fetch(`${BASE_URL}support/messages`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {}),
        ...(cleanApiKey ? { "x-api-key": cleanApiKey } : {}),
      },
      body: JSON.stringify({
        user_id: String(map.user_id || "").trim() || undefined,
        nanny_id: String(map.nanny_id || "").trim() || undefined,
        account_type: userType || undefined,
        name: senderName || undefined,
        email,
        category: "app_feedback",
        subject: `App rating: ${rating}/5`,
        message: messageLines.join("\n"),
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.message || "Unable to submit app feedback.");
    }
  };

  const openStoreListing = async () => {
    const reviewTargets =
      Platform.OS === "android"
        ? [
            "market://details?id=com.dexad.Syttr",
            "https://play.google.com/store/apps/details?id=com.dexad.Syttr",
          ]
        : Platform.OS === "ios"
          ? ["https://apps.apple.com/us/search?term=Syttr"]
          : ["https://play.google.com/store/apps/details?id=com.dexad.Syttr"];

    for (const target of reviewTargets) {
      try {
        const canOpen =
          target.startsWith("http") || (await Linking.canOpenURL(target));
        if (!canOpen) continue;
        await Linking.openURL(target);
        return true;
      } catch {
        // Try the next target.
      }
    }

    return false;
  };

  const submitRating = async () => {
    if (!rating) return;
    setSubmitting(true);
    try {
      await submitFeedback();
      const openedStore = rating >= 4 ? await openStoreListing() : false;
      if (!openedStore) {
        Alert.alert(
          "Thanks",
          rating >= 4
            ? "Your feedback was saved."
            : "Your feedback was submitted to the support team."
        );
      }
      navigation?.goBack?.();
    } catch (error: any) {
      Alert.alert("Feedback", error?.message || "Unable to submit feedback right now.");
    } finally {
      setSubmitting(false);
    }
  };

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
        <Text style={styles.headerTitle}>Rate Our App</Text>
        <View style={{ width: rs(22) }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={24}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
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
              <Ionicons name="star" size={26} color="#fff" />
            </View>
            <View>
              <Text style={styles.cardTitle}>Share Your Experience</Text>
              <Text style={styles.cardSub}>
                Help us improve with your feedback
              </Text>
            </View>
          </Animated.View>

          {/* Rating */}
          <Animated.View style={[styles.card, styles.mt]}>
            <Text style={styles.sectionTitle}>How would you rate our app?</Text>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => setRating(i)}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.starCircle,
                      rating >= i && styles.starActive,
                    ]}
                  >
                    <Ionicons
                      name="star"
                      size={26}
                      color={rating >= i ? "#fff" : "#FF80AB"}
                    />
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.ratingText}>{ratingText(rating)}</Text>
          </Animated.View>

          {/* Review */}
          {rating > 0 && (
            <Animated.View style={[styles.card, styles.mt]}>
              <Text style={styles.sectionTitle}>
                Share your thoughts (optional)
              </Text>

              <TextInput
                value={review}
                onChangeText={setReview}
                multiline
                numberOfLines={4}
                placeholder="What do you love? Any suggestions?"
                placeholderTextColor="#AD1457AA"
                style={styles.textArea}
              />
            </Animated.View>
          )}

          {/* Actions */}
          {rating > 0 && (
            <Animated.View style={{ marginTop: rs(24) }}>
              <LinearGradient
                colors={["#FF80AB", "#FFB6C1"]}
                style={styles.submitBtn}
              >
                <TouchableOpacity
                  disabled={submitting}
                  onPress={submitRating}
                  style={styles.submitTouch}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="create" size={20} color="#fff" />
                      <Text style={styles.submitText}>Submit Review</Text>
                    </>
                  )}
                </TouchableOpacity>
              </LinearGradient>

              <TouchableOpacity
                disabled={submitting}
                onPress={() => navigation?.goBack?.()}
              >
                <Text style={styles.skip}>Maybe Later</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
    fontSize: rf(20),
    fontWeight: "700",
    color: "#C77A00",
  },
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
    marginTop: rs(20),
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
  cardTitle: {
    fontSize: rf(20),
    fontWeight: "700",
    color: "#880E4F",
  },
  cardSub: {
    fontSize: rf(14),
    color: "#AD1457",
  },
  sectionTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
    textAlign: "center",
  },
  starsRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: rs(16),
    gap: rs(12),
  },
  starCircle: {
    padding: rs(14),
    borderRadius: rs(40),
    backgroundColor: "#FFF7FA",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
  },
  starActive: {
    backgroundColor: "#FF80AB",
    borderColor: "#FF80AB",
  },
  ratingText: {
    marginTop: rs(14),
    fontSize: rf(14),
    color: "#AD1457",
    textAlign: "center",
    fontWeight: "600",
  },
  textArea: {
    marginTop: rs(16),
    backgroundColor: "#FFF7FA",
    borderRadius: rs(12),
    padding: rs(16),
    fontSize: rf(14),
    color: "#880E4F",
    borderWidth: 1,
    borderColor: "rgba(255,128,171,0.35)",
    textAlignVertical: "top",
  },
  submitBtn: {
    borderRadius: rs(16),
    marginBottom: rs(12),
  },
  submitTouch: {
    height: rs(56),
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: rs(8),
  },
  submitText: {
    color: "#FFFFFF",
    fontSize: rf(16),
    fontWeight: "700",
  },
  skip: {
    textAlign: "center",
    fontSize: rf(14),
    color: "#AD1457",
    fontWeight: "500",
  },
});

