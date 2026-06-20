import React from "react";
// import { loadOptionalModule } from "./optionalNativeModules";

// type GoogleModule = typeof import("expo-auth-session/build/providers/Google");
type GoogleModule = {
  useAuthRequest?: (cfg: any) => readonly [any, any, () => Promise<any>];
};

let cached: GoogleModule | null = null;
// let resolved = false;

const getModule = (): GoogleModule | null => {
  // Expo Auth Session disabled temporarily to keep bundling stable.
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

