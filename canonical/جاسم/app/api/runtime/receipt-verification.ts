/**
 * JASIM — WHOSE RECEIPT IS THIS, AND WHAT AUTHENTICATES IT.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   RECEIPT != VERIFICATION · VALID_RECEIPT_SIGNATURE != BUSINESS_TRUTH
 *   PROVIDER_RECEIPT_SECRET != PUBLIC DISCOVERY METADATA
 *   PROVIDER_CANDIDATE != PROVIDER_ACCOUNT · SAME_PROVIDER != SAME_ACCOUNT
 *   REMOTE_EXECUTION != LATEST_BINDING · UNKNOWN_BINDING != ANY_BINDING
 *   RECEIPT_SECRET != WEBHOOK_SECRET
 *   CLIENT_CAN_OVERRIDE_RECEIPT_SECRET = 0
 *
 * ─── WHAT THE TRACE FOUND ───────────────────────────────────────────────────
 *
 * Remote receipt verification read a PLAINTEXT string out of
 * `capability_provider_catalog.ioMetadata.receiptSecret` on the polling path,
 * and a `receiptSecret` field on an in-memory `CapabilityProvider` on the
 * in-line path. Four facts, all from the repository:
 *
 *   1. That table persists DISCOVERED candidates, at trust class
 *      UNTRUSTED_CANDIDATE, by its own header.
 *   2. `ioMetadata` is ordinary jsonb, so the material was plaintext.
 *   3. Nothing in production wrote the catalog field, and NOTHING ANYWHERE
 *      assigned the in-memory one — every normalizer that builds a remote
 *      candidate leaves it unset by construction. So receipt verification
 *      could not succeed in production at all.
 *   4. A candidate is not an account. One string would have authenticated
 *      receipts for every owner that ever used that candidate.
 *
 * And `remote_executions.bindingId` did not help: `resolveProvider` mints a
 * fresh id for every resolution, so that column records WHICH DECISION chose a
 * provider — not which account executed. Nothing read it.
 *
 * ─── SO THE MATERIAL BELONGS TO THE BINDING ─────────────────────────────────
 *
 * A receipt secret is shared between JASIM and one remote ENDPOINT identity.
 * The canonical row that owns a trusted remote endpoint is the scope's provider
 * binding: it carries `endpointUrl` for a provider whose address is declared at
 * setup, so two scopes running their own remote systems have different
 * endpoints and therefore different receipt secrets. A definition-scoped secret
 * could not express that, and a catalog-scoped one expresses nothing at all.
 *
 * One scope holds at most ONE binding per provider — `scope_provider_bindings`
 * is unique on (scope, class, provider) — so the account is exact rather than
 * chosen, and there is no "latest", "first" or "any" to fall back to.
 *
 * ─── AND THE ACCOUNT IS PINNED, NOT RE-DERIVED ──────────────────────────────
 *
 * `remote_executions.providerBindingRef` is written when the execution is
 * created. Verification reads it. Nothing that changes afterwards — a provider
 * preference, a policy, another account, a rotation elsewhere — can redirect a
 * receipt to other material.
 *
 *   MUTABLE_POLICY_CHANGES_RECEIPT_SECRET_SOURCE = 0
 *   NULL_BINDING_REMOTE_RECEIPT_VERIFIED = 0
 */

import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "../queries/connection";
import { scopeProviderBindings } from "@db/schema-block2";
import { ProviderCredentialError, providerCredentialVault } from "./provider-credential-vault";

/**
 * WHAT is being authenticated, as far as canonical state can establish it.
 *
 * Both fields come from the remote execution row. Neither comes from a caller,
 * a model, a request body or a provider's own message.
 */
export type ReceiptVerificationSelector = {
  /** The provider the execution ran at, as the execution recorded it. */
  readonly providerId: string;
  /** The ACCOUNT it ran through, pinned at execution. NULL means unknown. */
  readonly bindingId: string | null;
};

/** Material, and nothing that hints at where it came from. */
export type ReceiptVerificationMaterial = { readonly secret: string };

export type ReceiptVerificationResolver = (
  selector: ReceiptVerificationSelector,
) => Promise<ReceiptVerificationMaterial | null>;

/**
 * The one production resolver.
 *
 * Every refusal returns `null` — the same `null` for an execution with no
 * recorded account, a binding that was revoked, one bound to a different
 * provider, and one whose material was never configured. What the caller learns
 * is that this receipt cannot be independently verified, and never which of
 * those it was.
 *
 *   MISSING_RECEIPT_SECRET_VERIFIES = 0
 *   REVOKED_BINDING_AUTHENTICATES_NEW_RECEIPT = 0
 *   CROSS_PROVIDER_RECEIPT_SECRET_AUTHENTICATES = 0
 */
export const bindingReceiptVerification: ReceiptVerificationResolver = async (selector) => {
  // No account was pinned. There is nothing to look up, and looking for one by
  // scope, provider, recency or endpoint would be choosing a secret rather than
  // reading one.
  if (!selector.bindingId) return null;
  const [row] = await db
    .select()
    .from(scopeProviderBindings)
    .where(
      and(
        eq(scopeProviderBindings.id, selector.bindingId),
        // The provider the execution recorded must be the provider this account
        // is an account AT. A receipt signed by one system can never
        // authenticate a result produced at another.
        eq(scopeProviderBindings.definitionId, selector.providerId),
        ne(scopeProviderBindings.lifecycle, "REVOKED"),
        isNotNull(scopeProviderBindings.receiptCredentialRef),
      ),
    )
    .limit(1);
  if (!row || !row.receiptCredentialRef) return null;
  try {
    const material = await providerCredentialVault().open(row.receiptCredentialRef, {
      scopeId: row.scopeId,
      bindingId: row.id,
      kind: "RECEIPT_VERIFICATION",
      version: row.receiptCredentialVersion,
    });
    // A retired envelope is already `UNAVAILABLE` inside the vault, so an old
    // rotation cannot arrive here. There is no overlap window.
    const secret = material.secret;
    return typeof secret === "string" && secret.length > 0 ? { secret } : null;
  } catch (error) {
    if (error instanceof ProviderCredentialError) return null;
    // Infrastructure. An outage is not a provider failing to authenticate, and
    // swallowing one would turn it into a flood of unverifiable receipts.
    //
    //   INFRASTRUCTURE_FAILURE_REPORTED_AS_REFUSAL = 0
    throw error;
  }
};

let resolver: ReceiptVerificationResolver | undefined;

/**
 * Trusted server code only. No request path may install a resolver, and none
 * does: the remote execution path reaches this with a row it read itself.
 *
 * This is the seam a deployment substitutes when verification material should
 * come from a key-management service rather than the application vault.
 *
 *   KMS_HSM_HARDENING = DEFERRED_TO_PRODUCTION_HARDENING
 */
export function setReceiptVerificationResolver(next: ReceiptVerificationResolver | undefined): void {
  resolver = next;
}

export function receiptVerificationResolver(): ReceiptVerificationResolver {
  return resolver ?? bindingReceiptVerification;
}

/** The secret for one remote execution, or nothing. Never a guess. */
export async function receiptSecretFor(selector: ReceiptVerificationSelector): Promise<string | undefined> {
  const material = await receiptVerificationResolver()(selector);
  return material?.secret;
}
