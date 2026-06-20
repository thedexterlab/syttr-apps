import { loadOptionalModule } from "./optionalNativeModules";

type ClipboardModule = typeof import("expo-clipboard");

let cached: ClipboardModule | null = null;
let resolved = false;

const getModule = (): ClipboardModule | null => {
  if (resolved) return cached;
  resolved = true;
  cached = loadOptionalModule("ExpoClipboard", () => require("expo-clipboard") as ClipboardModule);
  return cached;
};

const fallbackSetStringAsync: ClipboardModule["setStringAsync"] = async (
  _text: string
) => false;

const fallback: Partial<ClipboardModule> = {
  setStringAsync: fallbackSetStringAsync,
};

export const Clipboard = new Proxy(fallback as ClipboardModule, {
  get(_target, prop) {
    const mod = getModule();
    if (mod && prop in mod) return (mod as any)[prop];
    return (fallback as any)[prop];
  },
}) as ClipboardModule;

export const isClipboardAvailable = () => !!getModule();


export default function RouteShim() {
  return null as any;
}

