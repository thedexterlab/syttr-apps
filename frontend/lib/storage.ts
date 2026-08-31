import NativeAsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

type StoragePair = readonly [string, string];
type StoredPair = [string, string | null];

const SECURE_STORAGE_KEYS = [
  "token",
  "nanny_token",
  "access_token",
  "refresh_token",
  "auth_token",
  "jwt",
  "session_token",
  "api_key",
  "signup_client_draft",
  "signup_nanny_draft",
] as const;

const secureStorageKeys = new Set<string>(SECURE_STORAGE_KEYS);
const inMemorySecureStorage = new Map<string, string>();

const secureStoreAvailable =
  Platform.OS === "web"
    ? Promise.resolve(false)
    : SecureStore.isAvailableAsync().catch(() => false);

const isSecureStorageKey = (key: string) => secureStorageKeys.has(key);

async function readSecureItem(key: string): Promise<string | null> {
  if (await secureStoreAvailable) {
    return SecureStore.getItemAsync(key);
  }

  return inMemorySecureStorage.get(key) ?? null;
}

async function writeSecureItem(key: string, value: string): Promise<void> {
  if (await secureStoreAvailable) {
    await SecureStore.setItemAsync(key, value);
    return;
  }

  inMemorySecureStorage.set(key, value);
}

async function deleteSecureItem(key: string): Promise<void> {
  inMemorySecureStorage.delete(key);
  if (await secureStoreAvailable) {
    await SecureStore.deleteItemAsync(key);
  }
}

async function migrateLegacySecureItems(): Promise<void> {
  const legacyItems = await NativeAsyncStorage.multiGet(SECURE_STORAGE_KEYS);

  await Promise.all(
    legacyItems.map(async ([key, legacyValue]) => {
      if (legacyValue === null) return;

      const currentSecureValue = await readSecureItem(key);
      if (currentSecureValue === null) {
        await writeSecureItem(key, legacyValue);
      }
      await NativeAsyncStorage.removeItem(key);
    })
  );
}

let legacyMigration: Promise<void> | null = null;

const ensureLegacyMigration = () => {
  if (legacyMigration === null) {
    legacyMigration = migrateLegacySecureItems();
  }
  return legacyMigration;
};

async function getItem(key: string): Promise<string | null> {
  if (!isSecureStorageKey(key)) {
    return NativeAsyncStorage.getItem(key);
  }

  await ensureLegacyMigration();
  return readSecureItem(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (!isSecureStorageKey(key)) {
    await NativeAsyncStorage.setItem(key, value);
    return;
  }

  await ensureLegacyMigration();
  await writeSecureItem(key, value);
  await NativeAsyncStorage.removeItem(key);
}

async function removeItem(key: string): Promise<void> {
  if (!isSecureStorageKey(key)) {
    await NativeAsyncStorage.removeItem(key);
    return;
  }

  await ensureLegacyMigration();
  await Promise.all([
    deleteSecureItem(key),
    NativeAsyncStorage.removeItem(key),
  ]);
}

async function multiGet(keys: readonly string[]): Promise<StoredPair[]> {
  return Promise.all(
    keys.map(async (key): Promise<StoredPair> => [key, await getItem(key)])
  );
}

async function multiSet(pairs: readonly StoragePair[]): Promise<void> {
  await Promise.all(pairs.map(([key, value]) => setItem(key, value)));
}

async function multiRemove(keys: readonly string[]): Promise<void> {
  await Promise.all(keys.map((key) => removeItem(key)));
}

async function clear(): Promise<void> {
  await ensureLegacyMigration();
  await Promise.all([
    NativeAsyncStorage.clear(),
    ...SECURE_STORAGE_KEYS.map((key) => deleteSecureItem(key)),
  ]);
}

const Storage = {
  clear,
  getItem,
  multiGet,
  multiRemove,
  multiSet,
  removeItem,
  setItem,
};

export default Storage;
