import { loadOptionalModule } from "./optionalNativeModules";

type MailComposerModule = typeof import("expo-mail-composer");

let cached: MailComposerModule | null = null;
let resolved = false;

const getModule = (): MailComposerModule | null => {
  if (resolved) return cached;
  resolved = true;
  cached = loadOptionalModule(
    "ExpoMailComposer",
    () => require("expo-mail-composer") as MailComposerModule
  );
  return cached;
};

const fallback: Partial<MailComposerModule> = {
  isAvailableAsync: (async () => false) as MailComposerModule["isAvailableAsync"],
  composeAsync: (async () => ({ status: "sent" } as any)) as MailComposerModule["composeAsync"],
};

export const MailComposer = new Proxy(fallback as MailComposerModule, {
  get(_target, prop) {
    const mod = getModule();
    if (mod && prop in mod) return (mod as any)[prop];
    return (fallback as any)[prop];
  },
}) as MailComposerModule;

export const isMailComposerAvailable = () => !!getModule();



export default function RouteShim() {
  return null as any;
}

