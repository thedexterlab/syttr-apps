import { loadOptionalModule } from "./optionalNativeModules";

type ImagePickerModule = typeof import("expo-image-picker");
type ImagePickerCompat = ImagePickerModule & {
  MediaType: {
    Images: string;
    Videos: string;
  };
};

let cached: ImagePickerModule | null = null;
let resolved = false;

const getModule = (): ImagePickerModule | null => {
  if (resolved) return cached;
  resolved = true;
  cached = loadOptionalModule(
    "ExponentImagePicker",
    () => require("expo-image-picker") as ImagePickerModule
  );
  return cached;
};

const deniedPermission = {
  status: "denied",
  granted: false,
  canAskAgain: false,
  expires: "never",
} as any;

const fallbackPickResult = { canceled: true, assets: null } as any;

const fallback: Partial<ImagePickerCompat> = {
  MediaType: {
    Images: "images",
    Videos: "videos",
  } as any,
  MediaTypeOptions: {
    Images: "Images",
  } as any,
  requestCameraPermissionsAsync:
    (async () => deniedPermission) as ImagePickerModule["requestCameraPermissionsAsync"],
  requestMediaLibraryPermissionsAsync:
    (async () => deniedPermission) as ImagePickerModule["requestMediaLibraryPermissionsAsync"],
  launchImageLibraryAsync:
    (async () => fallbackPickResult) as ImagePickerModule["launchImageLibraryAsync"],
  launchCameraAsync:
    (async () => fallbackPickResult) as ImagePickerModule["launchCameraAsync"],
};

export const ImagePicker = new Proxy(fallback as ImagePickerCompat, {
  get(_target, prop) {
    const mod = getModule();
    if (mod && prop in mod) return (mod as any)[prop];
    return (fallback as any)[prop];
  },
}) as ImagePickerCompat;

export const isImagePickerAvailable = () => !!getModule();


export default function RouteShim() {
  return null as any;
}

