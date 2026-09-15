/**
 * Block 1 — External Action foundation.
 *
 * The trusted server creates short-lived, owner- and purpose-bound sessions
 * that transition the user into an approved external provider experience.
 * The browser is presentation, never transaction truth. The LLM can never
 * mint a trusted URL: every session URL is validated against approved
 * provider origins before persistence.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  externalActionSessions,
  transactionIntents,
  type ExternalActionSession,
} from "../../db/schema";

export class UntrustedExternalUrlError extends Error {
  override name = "UntrustedExternalUrlError";
}

export class ExternalActionSessionError extends Error {
  override name = "ExternalActionSessionError";
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const REDIRECT_PARAMS = new Set(["redirect", "redirect_uri", "return", "return_url", "next", "continue", "callback"]);

/**
 * Server-owned provider trust registry. Only trusted server configuration may
 * bind a provider to its approved origins; request-path callers can never
 * nominate or widen origins.
 */
type PurposePolicy = {
  origins: string[];
  pathPrefixes: string[];
};

/**
 * Trust is purpose-bound: each purpose maps to its OWN approved origins and
 * path prefixes. A caller can never combine one purpose with another
 * purpose's paths.
 */
type ProviderTrust = {
  purposes: Record<string, PurposePolicy>;
};

const providerTrust = new Map<string, ProviderTrust>();

function normalizeApprovedOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new UntrustedExternalUrlError(`Invalid approved origin ${origin}`);
  }
  const isLocalHttp =
    url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new UntrustedExternalUrlError(`Approved origin must be https: ${origin}`);
  }
  return url.origin;
}

export function configureExternalActionProvider(
  provider: string,
  purposes: Record<string, { origins: string[]; pathPrefixes: string[] }>,
): void {
  const normalized: Record<string, PurposePolicy> = {};
  for (const [purpose, policy] of Object.entries(purposes)) {
    if (!policy.origins || policy.origins.length === 0) {
      throw new UntrustedExternalUrlError(
        `Purpose ${purpose} requires at least one approved origin.`,
      );
    }
    normalized[purpose] = {
      origins: policy.origins.map(normalizeApprovedOrigin),
      pathPrefixes: policy.pathPrefixes ?? [],
    };
  }
  if (Object.keys(normalized).length === 0) {
    throw new UntrustedExternalUrlError("A provider requires at least one purpose policy.");
  }
  providerTrust.set(provider, { purposes: normalized });
}

/** Test-only reset; production configuration happens once at server boot. */
export function resetExternalActionProviders(): void {
  providerTrust.clear();
}

/** Server-side read of the configured trust policy (Block 3 checkout reuse). */
export function getExternalActionPolicy(
  provider: string,
  purpose: string,
): { origins: string[]; pathPrefixes: string[] } {
  const policy = providerTrust.get(provider)?.purposes[purpose];
  if (!policy) {
    throw new UntrustedExternalUrlError(
      `No configured trust policy for provider ${provider} purpose ${purpose}.`,
    );
  }
  return policy;
}

/**
 * THE boot configuration path (also the tested path). Parses the
 * JASIM_EXTERNAL_PROVIDERS JSON map:
 *   { "provider": { "origins": [...], "purposes": [...], "pathPrefixes": [...] } }
 * In strict mode (production), a provider without explicit purposes AND path
 * prefixes is rejected — the guards must never be silently inactive.
 */
export function configureExternalActionProvidersFromConfig(
  raw: string,
  options?: { strict?: boolean },
): string[] {
  let parsed: Record<
    string,
    {
      purposes?: Record<string, { origins?: string[]; pathPrefixes?: string[] }>;
    }
  >;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UntrustedExternalUrlError("Invalid external provider configuration JSON.");
  }
  const configured: string[] = [];
  for (const [provider, policy] of Object.entries(parsed)) {
    const purposes = policy.purposes ?? {};
    if (options?.strict) {
      const entries = Object.entries(purposes);
      if (
        entries.length === 0 ||
        entries.some(
          ([, p]) => !p.origins?.length || !p.pathPrefixes?.length,
        )
      ) {
        throw new UntrustedExternalUrlError(
          `Provider ${provider} must declare purpose policies with origins and pathPrefixes in production.`,
        );
      }
    }
    configureExternalActionProvider(
      provider,
      Object.fromEntries(
        Object.entries(purposes).map(([purpose, p]) => [
          purpose,
          { origins: p.origins ?? [], pathPrefixes: p.pathPrefixes ?? [] },
        ]),
      ),
    );
    configured.push(provider);
  }
  return configured;
}

export function validateExternalActionUrl(
  rawUrl: string,
  policy: PurposePolicy,
): { url: URL; origin: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UntrustedExternalUrlError("Invalid URL.");
  }
  const isLocalHttp =
    url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new UntrustedExternalUrlError(`Rejected scheme ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UntrustedExternalUrlError("Credential-bearing URLs are rejected.");
  }
  const origin = url.origin;
  if (!policy.origins.includes(origin)) {
    throw new UntrustedExternalUrlError(`Origin ${origin} is not an approved provider origin.`);
  }
  const pathAllowed = (pathname: string): boolean =>
    policy.pathPrefixes.length === 0 ||
    policy.pathPrefixes.some((prefix) => pathname.startsWith(prefix));
  if (!pathAllowed(url.pathname)) {
    throw new UntrustedExternalUrlError(
      `Path ${url.pathname} is outside the permitted prefixes for this purpose.`,
    );
  }
  // Open redirect guard: every redirect-like target must satisfy the SAME
  // purpose policy — approved origin AND permitted path prefix. A same-origin
  // redirect to a different action is rejected.
  for (const [key, value] of url.searchParams) {
    if (!REDIRECT_PARAMS.has(key.toLowerCase())) continue;
    try {
      const target = new URL(value);
      if (!policy.origins.includes(target.origin)) {
        throw new UntrustedExternalUrlError("Open redirect to unapproved origin rejected.");
      }
      if (!pathAllowed(target.pathname)) {
        throw new UntrustedExternalUrlError(
          "Redirect target escapes the purpose's permitted paths.",
        );
      }
    } catch (error) {
      if (error instanceof UntrustedExternalUrlError) throw error;
      throw new UntrustedExternalUrlError("Unparseable redirect parameter rejected.");
    }
  }
  return { url, origin };
}

export async function createExternalActionSession(input: {
  ownerId: string;
  provider: string;
  purpose: string;
  url: string;
  runId?: string;
  transactionIntentId?: string;
  ttlMs?: number;
  now?: Date;
}): Promise<ExternalActionSession> {
  const trust = providerTrust.get(input.provider);
  if (!trust) {
    throw new UntrustedExternalUrlError(
      `Provider ${input.provider} is not configured in the trusted server registry.`,
    );
  }
  // Purpose binding: the declared purpose selects ONE server-configured
  // policy (origins + path prefixes). An unknown purpose is rejected, and the
  // URL — including any redirect target — is validated against exactly that
  // purpose's policy.
  const policy = trust.purposes[input.purpose];
  if (!policy) {
    throw new UntrustedExternalUrlError(
      `Purpose "${input.purpose}" is not permitted for provider ${input.provider}.`,
    );
  }
  const { url, origin } = validateExternalActionUrl(input.url, policy);
  // A referenced TransactionIntent must exist and belong to this owner.
  if (input.transactionIntentId) {
    const [intent] = await db
      .select()
      .from(transactionIntents)
      .where(eq(transactionIntents.id, input.transactionIntentId))
      .limit(1);
    if (!intent || !intent.participants.includes(input.ownerId)) {
      throw new ExternalActionSessionError(
        "Referenced transaction intent is not bound to this owner.",
      );
    }
  }
  const now = input.now ?? new Date();
  const [row] = await db
    .insert(externalActionSessions)
    .values({
      id: randomUUID(),
      ownerId: input.ownerId,
      provider: input.provider,
      purpose: input.purpose,
      url: url.toString(),
      origin,
      nonce: randomUUID(),
      state: randomUUID(),
      runId: input.runId,
      transactionIntentId: input.transactionIntentId,
      status: "active",
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS)),
    })
    .returning();
  return row;
}

/**
 * Resolve a session for its bound owner. Enforces owner binding, purpose
 * presence, nonce match, and expiry. Does not consume the session.
 */
export async function resolveExternalActionSession(input: {
  id: string;
  nonce: string;
  ownerId: string;
  now?: Date;
}): Promise<ExternalActionSession> {
  const [row] = await db
    .select()
    .from(externalActionSessions)
    .where(
      and(
        eq(externalActionSessions.id, input.id),
        eq(externalActionSessions.nonce, input.nonce),
      ),
    )
    .limit(1);
  if (!row) throw new ExternalActionSessionError("Unknown session.");
  if (row.ownerId !== input.ownerId) {
    throw new ExternalActionSessionError("Cross-owner session reuse rejected.");
  }
  const now = input.now ?? new Date();
  if (row.status !== "active") {
    throw new ExternalActionSessionError(`Session is ${row.status}.`);
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db
      .update(externalActionSessions)
      .set({ status: "expired" })
      .where(eq(externalActionSessions.id, row.id));
    throw new ExternalActionSessionError("Session expired.");
  }
  return row;
}

/** Single-use consumption: a used session can never be replayed. */
export async function consumeExternalActionSession(input: {
  id: string;
  nonce: string;
  ownerId: string;
  now?: Date;
}): Promise<ExternalActionSession> {
  const row = await resolveExternalActionSession(input);
  const [updated] = await db
    .update(externalActionSessions)
    .set({ status: "used", usedAt: input.now ?? new Date() })
    .where(
      and(
        eq(externalActionSessions.id, row.id),
        eq(externalActionSessions.status, "active"),
      ),
    )
    .returning();
  if (!updated) throw new ExternalActionSessionError("Session already used.");
  return updated;
}
