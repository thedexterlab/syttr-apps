import type * as ExpoLocation from "expo-location";
import { loadOptionalModule } from "./optionalNativeModules";

type LocationModule = typeof import("expo-location");

let cached: LocationModule | null = null;
let resolved = false;

const getModule = (): LocationModule | null => {
  if (resolved) return cached;
  resolved = true;
  cached = loadOptionalModule("ExpoLocation", () => require("expo-location") as LocationModule);
  return cached;
};

const fallbackAccuracy = {
  Low: 1,
  Balanced: 3,
  High: 5,
  Highest: 6,
};

const fallback: Partial<LocationModule> = {
  Accuracy: fallbackAccuracy as any,
  requestForegroundPermissionsAsync:
    (async () =>
      ({
        status: "denied",
        granted: false,
        canAskAgain: true,
        expires: "never",
      }) as any) as LocationModule["requestForegroundPermissionsAsync"],
  hasServicesEnabledAsync: (async () => false) as LocationModule["hasServicesEnabledAsync"],
  getCurrentPositionAsync:
    (async () => {
      throw new Error("Location services unavailable");
    }) as LocationModule["getCurrentPositionAsync"],
  geocodeAsync: (async () => []) as LocationModule["geocodeAsync"],
  reverseGeocodeAsync: (async () => []) as LocationModule["reverseGeocodeAsync"],
  watchPositionAsync:
    (async () =>
      ({
        remove: () => {},
      }) as ExpoLocation.LocationSubscription) as LocationModule["watchPositionAsync"],
};

export const Location = new Proxy(fallback as LocationModule, {
  get(_target, prop) {
    const mod = getModule();
    if (mod && prop in mod) return (mod as any)[prop];
    return (fallback as any)[prop];
  },
}) as LocationModule;

export const isLocationAvailable = () => !!getModule();



export default function RouteShim() {
  return null as any;
}

