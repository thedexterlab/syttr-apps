type KeepAwakeListener = (...args: any[]) => void;

export const ExpoKeepAwakeTag = "ExpoKeepAwakeDefaultTag";

export function useKeepAwake(): void {
  // Expo uses this only in development to keep the screen awake.
  // Disable it locally because wake lock activation is failing on this setup.
}

export async function isAvailableAsync(): Promise<boolean> {
  return false;
}

export async function activateKeepAwake(): Promise<void> {}

export async function activateKeepAwakeAsync(): Promise<void> {}

export async function deactivateKeepAwake(): Promise<void> {}

export function addListener(_listener?: KeepAwakeListener) {
  return {
    remove() {},
  };
}
