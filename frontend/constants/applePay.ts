import Constants from "expo-constants";

const runtimeExtra =
  ((Constants as any)?.expoConfig?.extra as Record<string, any> | undefined) ||
  ((Constants as any)?.manifest2?.extra as Record<string, any> | undefined) ||
  ((Constants as any)?.manifest?.extra as Record<string, any> | undefined) ||
  {};

const readApplePayConfigValue = (...keys: string[]) => {
  for (const key of keys) {
    const fromProcess =
      typeof process !== "undefined" ? (process as any)?.env?.[key] : undefined;
    const fromExtra = runtimeExtra?.[key];
    const value = String(fromProcess || fromExtra || "").trim();
    if (value) return value;
  }

  return "";
};

export const DEFAULT_APPLE_PAY_MERCHANT_ID = "merchant.com.syttr.app";
export const DEFAULT_APPLE_PAY_CERTIFICATE_PATH = "assets/ApplePay/apple_pay.cer";

export const APPLE_PAY_MERCHANT_ID =
  readApplePayConfigValue(
    "EXPO_PUBLIC_STRIPE_MERCHANT_ID",
    "EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID",
    "EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER",
    "APPLE_PAY_MERCHANT_ID"
  ) || DEFAULT_APPLE_PAY_MERCHANT_ID;

export const APPLE_PAY_CERTIFICATE_PATH =
  readApplePayConfigValue(
    "APPLE_PAY_CERT_PATH",
    "EXPO_PUBLIC_APPLE_PAY_CERT_PATH"
  ) || DEFAULT_APPLE_PAY_CERTIFICATE_PATH;

// Keep a static require so Metro includes the Apple Pay certificate in native bundles.
export const APPLE_PAY_CERTIFICATE_ASSET = require("../assets/ApplePay/apple_pay.cer");
