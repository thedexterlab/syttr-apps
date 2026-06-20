import { loadOptionalModule } from "./optionalNativeModules";

type FileSystemModule = typeof import("expo-file-system");

let cached: FileSystemModule | null = null;
let resolved = false;

const getModule = (): FileSystemModule | null => {
  if (resolved) return cached;
  resolved = true;
  cached =
    loadOptionalModule("FileSystemLegacy", () => require("expo-file-system/legacy") as FileSystemModule) ||
    loadOptionalModule("FileSystem", () => require("expo-file-system") as FileSystemModule);
  return cached;
};

const readAsStringWithModernApi = async (
  fileUri: string,
  options: { encoding?: string } = {}
) => {
  const modern = loadOptionalModule(
    "FileSystemModernCompat",
    () => require("expo-file-system") as FileSystemModule
  );
  const FileCtor = (modern as any)?.File;
  if (typeof FileCtor !== "function") {
    throw new Error("FileSystem unavailable");
  }

  const file = new FileCtor(fileUri);
  const encoding = String(options?.encoding || "").toLowerCase();

  if (encoding === "base64") {
    if (typeof file?.base64 !== "function") {
      throw new Error("FileSystem unavailable");
    }
    return await file.base64();
  }

  if (encoding === "" || encoding === "utf8" || encoding === "utf-8") {
    if (typeof file?.text !== "function") {
      throw new Error("FileSystem unavailable");
    }
    return await file.text();
  }

  throw new Error(`Unsupported encoding: ${String(options?.encoding || "")}`);
};

const fallback: Partial<FileSystemModule> = {
  readAsStringAsync:
    (async (fileUri: string, options: any = {}) =>
      readAsStringWithModernApi(fileUri, options)) as FileSystemModule["readAsStringAsync"],
};

export const FileSystem = new Proxy(fallback as FileSystemModule, {
  get(_target, prop) {
    const mod = getModule();
    if (prop === "readAsStringAsync") {
      const readAsString = mod ? (mod as any)[prop] : null;
      if (typeof readAsString === "function") {
        return async (fileUri: string, options: any = {}) => {
          try {
            return await readAsString(fileUri, options);
          } catch (error: any) {
            const message = String(error?.message || "").toLowerCase();
            if (message.includes("deprecated") || message.includes("expo-file-system")) {
              return readAsStringWithModernApi(fileUri, options);
            }
            throw error;
          }
        };
      }
      return (fallback as any)[prop];
    }

    if (mod && prop in mod) return (mod as any)[prop];
    return (fallback as any)[prop];
  },
}) as FileSystemModule;

export const isFileSystemAvailable = () => !!getModule();



export default function RouteShim() {
  return null as any;
}

