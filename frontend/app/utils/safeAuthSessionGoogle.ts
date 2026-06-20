import React from "react";
import { loadOptionalModule } from "./optionalNativeModules";

type GoogleModule = typeof import("expo-auth-session/providers/google");

let cached: GoogleModule | null = null;
let resolved = false;

const getModule = (): GoogleModule | null => {
  if (resolved) return cached;
  resolved = true;
  cached = loadOptionalModule("ExpoWebBrowser", () =>
    require("expo-auth-session/providers/google") as GoogleModule
  );
  return cached;
};

const useFallbackAuthRequest = (_config: any) => {
  const promptAsync = React.useCallback(async () => ({ type: "dismiss" }), []);
  return [null, null, promptAsync] as const;
};

export const useGoogleAuthRequest = (config: any) => {
  const mod = getModule();
  const hook = (mod?.useAuthRequest ?? useFallbackAuthRequest) as (
    cfg: any
  ) => readonly [any, any, () => Promise<any>];
  return hook(config);
};

export const isGoogleAuthAvailable = () => !!getModule();


export default function RouteShim() {
  return null as any;
}

