/**
 * JASIM mobile — the one place the runtime's address is decided.
 *
 * ─── THE PROBLEM ────────────────────────────────────────────────────────────
 *
 * Two modules independently built `https://${EXPO_PUBLIC_DOMAIN}` with the
 * scheme hardcoded. That is correct for production and makes local development
 * impossible: a dev runtime on `127.0.0.1:5731` speaks HTTP, so the mobile
 * client could not reach it at all, and nobody could see the mobile product
 * against a live runtime without deploying first.
 *
 * ─── THE RULE ───────────────────────────────────────────────────────────────
 *
 *   Production is HTTPS. Always. No flag, no override, no env var.
 *
 * Development may use HTTP, and only to a LOCAL address. That second half
 * matters as much as the first: "dev builds may use http" would let a debug
 * build talk plaintext to a real host over a real network, which is the actual
 * risk. Restricting it to loopback and private ranges means the only thing a
 * dev build can reach in the clear is a machine on the same desk.
 *
 * ─── ONE CONFIG SYSTEM, NOT TWO ─────────────────────────────────────────────
 *
 * `session.tsx` and `runtime-trpc.ts` both call in here. Neither builds a URL
 * of its own, so the rule above cannot be true in one and false in the other.
 */

declare const __DEV__: boolean;

export class RuntimeConfigError extends Error {
  /** Safe to show a person. Says what is wrong without naming internals. */
  readonly userMessage: string;

  constructor(message: string, userMessage: string) {
    super(message);
    this.name = "RuntimeConfigError";
    this.userMessage = userMessage;
  }
}

const USER_MESSAGE = "لم تُضبط وجهة الخادم لهذا التطبيق. تواصل مع المسؤول.";

/** Loopback and private ranges — a machine on the same desk or LAN. */
function isLocalHost(host: string): boolean {
  const bare = host.split(":")[0]!.toLowerCase();
  if (bare === "localhost" || bare === "127.0.0.1" || bare === "::1") return true;
  if (bare.endsWith(".local")) return true;
  if (bare.startsWith("10.") || bare.startsWith("192.168.")) return true;
  // 172.16.0.0 – 172.31.255.255
  const parts = bare.split(".");
  if (parts.length === 4 && parts[0] === "172") {
    const second = Number(parts[1]);
    if (Number.isInteger(second) && second >= 16 && second <= 31) return true;
  }
  return false;
}

function isDevelopment(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__ === true;
}

/**
 * The runtime's base URL, with no trailing slash.
 *
 * `EXPO_PUBLIC_DOMAIN` may carry an explicit scheme. Without one, HTTPS is
 * assumed — the safe default when the configuration is ambiguous.
 */
export function runtimeBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (!raw) {
    throw new RuntimeConfigError("EXPO_PUBLIC_DOMAIN is not configured.", USER_MESSAGE);
  }

  const hasScheme = /^https?:\/\//i.test(raw);
  const scheme = hasScheme ? raw.slice(0, raw.indexOf(":")).toLowerCase() : "https";
  const authority = (hasScheme ? raw.slice(raw.indexOf("://") + 3) : raw).replace(/\/+$/, "");

  if (!authority) {
    throw new RuntimeConfigError("EXPO_PUBLIC_DOMAIN has no host.", USER_MESSAGE);
  }

  if (scheme === "http") {
    if (!isDevelopment()) {
      // The line this module exists for.
      throw new RuntimeConfigError(
        "A production build refuses a plaintext runtime endpoint.",
        USER_MESSAGE,
      );
    }
    if (!isLocalHost(authority)) {
      throw new RuntimeConfigError(
        "A development build may use http only for a local runtime address.",
        USER_MESSAGE,
      );
    }
  }

  return `${scheme}://${authority}`;
}

/**
 * The scheme the resolver settled on, as a URL-policy protocol string.
 *
 * Callers that hand a URL to a presentation allow-list need to state which
 * scheme is permitted. They must not guess "https:" — in a development build
 * against a local runtime that is wrong — and they must not widen the list to
 * both, which would let a payload-supplied URL slip through as http. Asking
 * here means the single rule in `runtimeBaseUrl` decides this too.
 */
export function runtimeScheme(): "http:" | "https:" {
  return runtimeBaseUrl().startsWith("http://") ? "http:" : "https:";
}

/** An absolute runtime URL for an already-validated absolute path. */
export function runtimeUrl(path: string): string {
  return `${runtimeBaseUrl()}${path}`;
}

/** A tRPC procedure endpoint on the configured runtime. */
export function runtimeEndpoint(procedure: string): string {
  return `${runtimeBaseUrl()}/api/trpc/${procedure}`;
}

/** Whether a base URL can be resolved at all, without throwing. */
export function hasRuntimeEndpoint(): boolean {
  try {
    runtimeBaseUrl();
    return true;
  } catch {
    return false;
  }
}
