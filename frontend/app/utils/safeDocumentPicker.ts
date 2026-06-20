import { loadOptionalModule } from "./optionalNativeModules";

type DocumentPickerModule = typeof import("expo-document-picker");

let cached: DocumentPickerModule | null = null;
let resolved = false;

const getModule = (): DocumentPickerModule | null => {
  if (resolved) return cached;
  resolved = true;
  cached = loadOptionalModule(
    "ExpoDocumentPicker",
    () => require("expo-document-picker") as DocumentPickerModule
  );
  return cached;
};

const fallbackGetDocumentAsync: DocumentPickerModule["getDocumentAsync"] = async () =>
  ({ canceled: true, assets: null } as any);

const fallback: Partial<DocumentPickerModule> = {
  getDocumentAsync: fallbackGetDocumentAsync,
};

export const DocumentPicker = new Proxy(fallback as DocumentPickerModule, {
  get(_target, prop) {
    const mod = getModule();
    if (mod && prop in mod) return (mod as any)[prop];
    return (fallback as any)[prop];
  },
}) as DocumentPickerModule;

export const isDocumentPickerAvailable = () => !!getModule();


export default function RouteShim() {
  return null as any;
}

