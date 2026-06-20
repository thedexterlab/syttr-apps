export const DEFAULT_LOOPBACK_HOST = "127.0.0.1";

const LOOPBACK_HOSTS = [
  "localhost",
  DEFAULT_LOOPBACK_HOST,
  "0.0.0.0",
  "::1",
  "[::1]",
] as const;

export const isLoopbackHost = (value?: string): boolean => {
  const host = String(value || "").trim().toLowerCase();
  if (!host) return false;
  return (LOOPBACK_HOSTS as readonly string[]).includes(host);
};

export const rewriteLoopbackAbsoluteUrl = (
  rawUrl: string,
  storageRoot: string
): string => {
  const value = String(rawUrl || "").trim();
  const baseRoot = String(storageRoot || "").trim();
  if (!value || !baseRoot || !/^https?:\/\//i.test(value)) return value;

  try {
    const parsed = new URL(value);
    if (!isLoopbackHost(parsed.hostname)) {
      return value;
    }

    const base = new URL(baseRoot);
    if (isLoopbackHost(base.hostname)) {
      return value;
    }

    return `${base.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return value;
  }
};
