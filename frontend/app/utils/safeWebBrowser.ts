import { loadOptionalModule } from "./optionalNativeModules";

type WebBrowserModule = typeof import("expo-web-browser");

let cached: WebBrowserModule | null = null;
let resolved = false;

const getModule = (): WebBrowserModule | null => {
  if (resolved) return cached;
  resolved = true;
  cached = loadOptionalModule("ExpoWebBrowser", () => require("expo-web-browser") as WebBrowserModule);
  return cached;
};

const fallback: Partial<WebBrowserModule> = {
  maybeCompleteAuthSession:
    (() => ({ type: "dismiss" } as any)) as WebBrowserModule["maybeCompleteAuthSession"],
  openAuthSessionAsync:
    (async () => ({ type: "dismiss" } as any)) as WebBrowserModule["openAuthSessionAsync"],
  openBrowserAsync:
    (async () => ({ type: "dismiss" } as any)) as WebBrowserModule["openBrowserAsync"],
  dismissBrowser: (() => {}) as WebBrowserModule["dismissBrowser"],
};

export const WebBrowser = new Proxy(fallback as WebBrowserModule, {
  get(_target, prop) {
    const mod = getModule();
    if (mod && prop in mod) return (mod as any)[prop];
    return (fallback as any)[prop];
  },
}) as WebBrowserModule;

export const isWebBrowserAvailable = () => !!getModule();


export default function RouteShim() {
  return null as any;
}

