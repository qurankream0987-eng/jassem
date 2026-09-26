/**
 * JASIM — WHERE A PROVIDER CREDENTIAL LIVES, AND WHAT HOLDS A REFERENCE TO IT.
 *
 *   MODEL != SECRET STORE
 *   MODEL != CREDENTIAL TRANSPORT
 *   RAW_PROVIDER_SECRET_IN_CANONICAL_BINDING = 0
 *   RAW_PROVIDER_SECRET_IN_EVENT_LOG = 0
 *   RAW_PROVIDER_SECRET_IN_NOTIFICATION = 0
 *   RAW_PROVIDER_SECRET_IN_MODEL_CONTEXT = 0
 *
 * ─── THIS IS NOT A NEW CIPHER ───────────────────────────────────────────────
 *
 * The repository already seals runtime input with AES-256-GCM, a random 12-byte
 * IV, and additional authenticated data binding each envelope to the exact
 * context it was written for (`api/core/generated-input-secret-vault.ts`). That
 * construction is reused here verbatim. Inventing a second one would mean two
 * places to get wrong.
 *
 * What could NOT be reused is that vault's TABLE. It is keyed by task and
 * request and carries a mandatory expiry, because its secrets are inputs to one
 * run. A provider credential belongs to a SCOPE and outlives every run. So the
 * envelope is the same and the binding of it is different: this AAD names the
 * scope, the binding and the credential VERSION.
 *
 *   A sealed value cannot be replayed into another binding.
 *   A sealed value cannot be replayed into an older rotation.
 *   A sealed value cannot be opened as a different KIND of material.
 *
 * ─── WHAT THIS BACKEND HONESTLY IS ──────────────────────────────────────────
 *
 * Application-level envelope encryption with a key derived from the process
 * secret. It is what this repository has. It is NOT a KMS or an HSM: an
 * attacker holding both the database and the process secret holds the
 * credentials. The interface exists precisely so that a deployment may
 * substitute a real key-management backend without any caller changing, and
 * `docs/architecture/JASIM_PROVIDER_BINDING.md` records that as the open item
 * rather than pretending it is closed.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { providerCredentials } from "@db/schema-block2";

/**
 * WHICH KIND of material an envelope holds.
 *
 * One binding holds three: what JASIM spends to CALL the provider, what JASIM
 * checks an inbound CALLBACK's signature with, and what JASIM authenticates a
 * completed remote RESULT's receipt with. They are issued at different provider
 * surfaces — an API-key page, a webhook-endpoint registration, a remote
 * execution agreement — and rotate on different days. So they are three
 * envelopes in ONE store, never one envelope with three meanings and never a
 * second store.
 *
 *   SECOND_SECRET_STORE = FORBIDDEN
 *   WEBHOOK_SECRET != PROVIDER_CREDENTIAL
 *   RECEIPT_SECRET != WEBHOOK_SECRET
 *
 * They are separate because nothing in this repository says a provider issues
 * one value for two of them, and merging on the grounds that all three are
 * bytes called «secret» would make a rotation of one silently retire another.
 */
export const CREDENTIAL_KINDS = [
  "PROVIDER_AUTH",
  "WEBHOOK_VERIFICATION",
  "RECEIPT_VERIFICATION",
] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** What a credential is sealed FOR. Every field is authenticated, not stored. */
export type CredentialContext = {
  readonly scopeId: string;
  readonly bindingId: string;
  /** Absent means PROVIDER_AUTH, which is what every envelope was before. */
  readonly kind?: CredentialKind;
  readonly version: number;
};

/**
 * The boundary.
 *
 * `seal` returns a REFERENCE. `open` takes one and returns the material to a
 * trusted caller that is about to spend it on one provider call. Nothing here
 * returns a credential to a projection, and nothing accepts a callback that
 * could be handed one.
 */
export interface ProviderCredentialVault {
  seal(context: CredentialContext, material: Readonly<Record<string, string>>): Promise<string>;
  open(reference: string, context: CredentialContext): Promise<Readonly<Record<string, string>>>;
  /**
   * Retire material. A KIND retires only its own kind, because rotating an API
   * key must not silently destroy the material that authenticates callbacks —
   * a binding whose verification material vanished would fail every callback
   * closed, and nobody would know why.
   *
   * No kind means ALL of it, which is what revocation means.
   */
  retire(bindingId: string, kind?: CredentialKind): Promise<void>;
}

export class ProviderCredentialError extends Error {
  readonly code: "UNAVAILABLE" | "INVALID";
  constructor(message: string, code: ProviderCredentialError["code"]) {
    super(message);
    this.code = code;
    this.name = "ProviderCredentialError";
  }
}

/**
 * The kind is AUTHENTICATED, not merely stored beside the envelope.
 *
 * Otherwise somebody holding the database could move a credential reference
 * into `webhookCredentialRef` and have an outbound API key accepted as the
 * material that authenticates inbound callbacks.
 *
 *   ENVELOPE_OPENED_AS_THE_WRONG_KIND = 0
 */
function aad(reference: string, context: CredentialContext): string {
  const kind: CredentialKind = context.kind ?? "PROVIDER_AUTH";
  return `jasim-provider-credential:${reference}:${context.scopeId}:${context.bindingId}:${kind}:${context.version}`;
}

/** Every value must be a string. A credential is material, never a structure. */
function assertMaterial(material: Readonly<Record<string, string>>): void {
  const entries = Object.entries(material);
  if (entries.length === 0) {
    throw new ProviderCredentialError("A credential cannot be empty.", "INVALID");
  }
  for (const [key, value] of entries) {
    if (typeof value !== "string" || value.length === 0) {
      throw new ProviderCredentialError(`Credential field «${key}» is not material.`, "INVALID");
    }
  }
}

export class EncryptedProviderCredentialVault implements ProviderCredentialVault {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 16) {
      throw new ProviderCredentialError(
        "The process secret is too short to seal provider credentials.",
        "INVALID",
      );
    }
    this.key = createHash("sha256").update(`jasim-provider-credential:${secret}`).digest();
  }

  async seal(
    context: CredentialContext,
    material: Readonly<Record<string, string>>,
  ): Promise<string> {
    assertMaterial(material);
    const reference = `pcr_${randomUUID()}`;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad(reference, context)));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(material), "utf8"),
      cipher.final(),
    ]);
    await db.insert(providerCredentials).values({
      id: reference,
      scopeId: context.scopeId,
      bindingId: context.bindingId,
      kind: context.kind ?? "PROVIDER_AUTH",
      version: context.version,
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    });
    return reference;
  }

  async open(
    reference: string,
    context: CredentialContext,
  ): Promise<Readonly<Record<string, string>>> {
    const [row] = await db
      .select()
      .from(providerCredentials)
      .where(
        and(
          eq(providerCredentials.id, reference),
          eq(providerCredentials.scopeId, context.scopeId),
          eq(providerCredentials.bindingId, context.bindingId),
          eq(providerCredentials.kind, context.kind ?? "PROVIDER_AUTH"),
          eq(providerCredentials.version, context.version),
        ),
      )
      .limit(1);
    // A retired credential is gone even though its row survives for audit. An
    // old rotation must never still be able to act.
    if (!row || row.retiredAt) {
      throw new ProviderCredentialError("That credential is unavailable.", "UNAVAILABLE");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(row.iv, "base64"));
    decipher.setAAD(Buffer.from(aad(reference, context)));
    decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
    let plaintext: Buffer;
    try {
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext, "base64")),
        decipher.final(),
      ]);
    } catch {
      // The tag did not check. Something was moved, edited or replayed.
      throw new ProviderCredentialError("That credential is unavailable.", "UNAVAILABLE");
    }
    const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ProviderCredentialError("That credential is unavailable.", "UNAVAILABLE");
    }
    return Object.freeze(parsed as Record<string, string>);
  }

  /** Revocation and rotation both end here. Nothing left behind can be opened. */
  async retire(bindingId: string, kind?: CredentialKind): Promise<void> {
    await db
      .update(providerCredentials)
      .set({ retiredAt: new Date() })
      .where(
        kind
          ? and(eq(providerCredentials.bindingId, bindingId), eq(providerCredentials.kind, kind))
          : eq(providerCredentials.bindingId, bindingId),
      );
  }
}

let vault: ProviderCredentialVault | undefined;

/** Trusted server code only. No request path may install a vault. */
export function setProviderCredentialVault(next: ProviderCredentialVault | undefined): void {
  vault = next;
}

/**
 * The vault in force.
 *
 * Deliberately NOT lazily constructed from a guessed default: a binding that
 * cannot seal its credential must fail to connect rather than quietly store
 * one somewhere weaker.
 */
export function providerCredentialVault(): ProviderCredentialVault {
  if (vault) return vault;
  const secret = process.env.APP_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) {
    throw new ProviderCredentialError(
      "No process secret is configured, so no provider credential can be sealed.",
      "UNAVAILABLE",
    );
  }
  vault = new EncryptedProviderCredentialVault(secret);
  return vault;
}
