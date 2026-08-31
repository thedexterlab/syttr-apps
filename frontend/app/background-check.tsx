import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

const BACKGROUND_CHECK_HOSTS = new Set([
  "hire-safe.instascreen.net",
  "lightning.instascreen.net",
]);

// react-native-webview opens URLs outside originWhitelist in the system browser
// before onShouldStartLoadWithRequest can reject them. Let every attempted
// navigation reach our stricter URL validator instead.
const INTERCEPT_ALL_ORIGINS = ["*"];

const getAllowedBackgroundCheckUrl = (value?: string): string | null => {
  if (!value) return null;

  try {
    const parsedUrl = new URL(value);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.port !== "" ||
      parsedUrl.username !== "" ||
      parsedUrl.password !== "" ||
      !BACKGROUND_CHECK_HOSTS.has(hostname)
    ) {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
};

export default function BackgroundCheckWebView() {
  const router = useRouter();
  const { url } = useLocalSearchParams<{ url?: string | string[] }>();
  const routeUrl = Array.isArray(url) ? url[0] : url;
  const backgroundCheckUrl = getAllowedBackgroundCheckUrl(routeUrl);
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const goBack = useCallback(() => {
    if (canGoBack) {
      webViewRef.current?.goBack();
    } else {
      router.back();
    }
    return true;
  }, [canGoBack, router]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;
      const subscription = BackHandler.addEventListener("hardwareBackPress", goBack);
      return () => subscription.remove();
    }, [goBack])
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color="#111" />
        </TouchableOpacity>
        <Text style={styles.title}>Background Check</Text>
        <View style={styles.headerSpacer} />
      </View>

      {!backgroundCheckUrl ? (
        <View style={styles.centered}>
          <Text>Unable to load the background check.</Text>
        </View>
      ) : Platform.OS === "web" ? (
        <View style={styles.centered}>
          <Text>The background check is available inside the iOS and Android app.</Text>
        </View>
      ) : (
        <>
          <WebView
            ref={webViewRef}
            source={{ uri: backgroundCheckUrl }}
            onShouldStartLoadWithRequest={(request) => {
              const isAllowed = getAllowedBackgroundCheckUrl(request.url) !== null;

              if (!isAllowed) {
                setLoading(false);
                setError("Unable to open an untrusted background-check link.");
              }

              return isAllowed;
            }}
            originWhitelist={INTERCEPT_ALL_ORIGINS}
            mixedContentMode="never"
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={false}
            // The provider's QuickApp is an interactive JavaScript form.
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled={false}
            onNavigationStateChange={(state) => setCanGoBack(state.canGoBack)}
            onLoadStart={() => {
              setLoading(true);
              setError("");
            }}
            onLoadEnd={() => setLoading(false)}
            onError={(event) => {
              setLoading(false);
              setError(event.nativeEvent.description || "Unable to load the background check.");
            }}
          />
          {loading && (
            <View style={styles.loading} pointerEvents="none">
              <ActivityIndicator size="large" color="#FF80AB" />
            </View>
          )}
          {!!error && (
            <View style={styles.error}>
              <Text>{error}</Text>
            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  backButton: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600" },
  headerSpacer: { width: 56 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  loading: {
    ...StyleSheet.absoluteFillObject,
    top: 56,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.75)",
  },
  error: { padding: 16, backgroundColor: "#fff1f1" },
});
