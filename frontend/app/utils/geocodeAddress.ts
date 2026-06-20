import { Platform } from "react-native";
import { GOOGLE_MAPS_KEY } from "../Api";
import { Location } from "./safeLocation";

export type GeocodeAddressResult = {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
};

let googleMapsLoader: Promise<void> | null = null;

const loadGoogleMapsScript = (apiKey: string) => {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Google Maps script loader is web-only."));
  }
  const maps = (globalThis as any)?.google?.maps;
  if (maps) return Promise.resolve();
  if (googleMapsLoader) return googleMapsLoader;

  googleMapsLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      `${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps script."));
    document.head.appendChild(script);
  });

  return googleMapsLoader;
};

const parseCoordsQuery = (query: string): GeocodeAddressResult | null => {
  const m = String(query || "")
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;
  return { latitude, longitude, formattedAddress: query.trim() };
};

const geocodeWithExpo = async (query: string): Promise<GeocodeAddressResult | null> => {
  try {
    const geocode = (Location as any).geocodeAsync;
    if (typeof geocode !== "function") return null;
    const results = await geocode(query);
    const first = Array.isArray(results) ? results[0] : null;
    const latitude = Number(first?.latitude);
    const longitude = Number(first?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude, formattedAddress: query.trim() };
  } catch {
    return null;
  }
};

const geocodeWithGoogleWeb = async (query: string): Promise<GeocodeAddressResult | null> => {
  if (!GOOGLE_MAPS_KEY) return null;
  if (typeof document === "undefined") return null;

  await loadGoogleMapsScript(GOOGLE_MAPS_KEY);
  const maps = (globalThis as any)?.google?.maps;
  if (!maps?.Geocoder) return null;

  const result = await new Promise<any[] | null>((resolve) => {
    const geocoder = new maps.Geocoder();
    geocoder.geocode({ address: query }, (results: any[], status: string) => {
      if (status === "OK" && results?.length) {
        resolve(results);
      } else {
        resolve(null);
      }
    });
  });

  const first = result?.[0];
  const location = first?.geometry?.location;
  if (!location?.lat || !location?.lng) return null;

  const latitude = Number(location.lat());
  const longitude = Number(location.lng());
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    formattedAddress: String(first?.formatted_address || query).trim(),
  };
};

const geocodeWithGoogleNative = async (query: string): Promise<GeocodeAddressResult | null> => {
  if (!GOOGLE_MAPS_KEY) return null;

  try {
    const url =
      "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
      `${encodeURIComponent(query)}&key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const first = json?.results?.[0];
    const latitude = Number(first?.geometry?.location?.lat);
    const longitude = Number(first?.geometry?.location?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      formattedAddress: String(first?.formatted_address || query).trim(),
    };
  } catch {
    return null;
  }
};

const geocodeWithGoogleHttp = async (query: string): Promise<GeocodeAddressResult | null> => {
  if (!GOOGLE_MAPS_KEY) return null;

  try {
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      `${encodeURIComponent(query)}&key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (String(json?.status || "").toUpperCase() !== "OK") return null;
    const first = Array.isArray(json?.results) ? json.results[0] : null;
    const latitude = Number(first?.geometry?.location?.lat);
    const longitude = Number(first?.geometry?.location?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      formattedAddress: String(first?.formatted_address || query).trim(),
    };
  } catch {
    return null;
  }
};

export const geocodeAddress = async (
  query: string
): Promise<GeocodeAddressResult | null> => {
  const trimmed = String(query || "").trim();
  if (!trimmed) return null;

  const asCoords = parseCoordsQuery(trimmed);
  if (asCoords) return asCoords;

  if (Platform.OS !== "web") {
    const expo = await geocodeWithExpo(trimmed);
    if (expo) return expo;
    const googleHttp = await geocodeWithGoogleHttp(trimmed);
    if (googleHttp) return googleHttp;
    return geocodeWithGoogleNative(trimmed);
  }

  const web = await geocodeWithGoogleWeb(trimmed);
  if (web) return web;
  return geocodeWithGoogleHttp(trimmed);
};



export default function RouteShim() {
  return null as any;
}

