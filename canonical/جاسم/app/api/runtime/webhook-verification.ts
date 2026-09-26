/**
 * JASIM — WHICH ACCOUNT'S MATERIAL AUTHENTICATES THIS CALLBACK.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   WEBHOOK_SECRET != PUBLIC PROVIDER METADATA · != EVENT PAYLOAD · != LOG
 *   PROVIDER_DEFINITION != PROVIDER_BINDING · PROVIDER_TYPE != PROVIDER_ACCOUNT
 *   ROUTE_PROVIDER_NAME != SECRET AUTHORITY
 *   VALID_SIGNATURE != VERIFIED · SECRET_PROVISIONED != PROVIDER_VERIFIED
 *   CLIENT_CAN_OVERRIDE_WEBHOOK_SECRET = 0
 *
 * ─── WHAT THE TRACE FOUND ───────────────────────────────────────────────────
 *
 * Webhook authentication read its secret out of
 * `capability_provider_catalog.ioMetadata.webhookSecret`. Three facts about
 * that, all from the repository:
 *
 *   1. That table's own header says it persists "normalized external
 *      candidates (MCP/A2A/…)" — DISCOVERY output, defaulting to trust class
 *      UNTRUSTED_CANDIDATE.
 *   2. `ioMetadata` is ordinary jsonb. The secret was PLAINTEXT.
 *   3. Nothing in production ever wrote it. Every writer was a test fixture, so
 *      the mounted webhook route could not authenticate anything at all.
 *
 * And the shape was wrong even had something written it: a catalog row has no
 * account, so ONE string would have authenticated callbacks naming EVERY
 * scope's payments. Company A and company B may both hold their own account at
 * the same provider, and each has its own signing secret.
 *
 * ─── SO THE MATERIAL BELONGS TO THE BINDING ─────────────────────────────────
 *
 * `scope_provider_bindings` is unique on (scope, class, provider) and carries
 * the `accountRef` the provider itself reported. That row is the account. The
 * material lives sealed in the credential vault that already existed, as a
 * second KIND beside the outbound credential — one store, two kinds.
 *
 *   SECOND_SECRET_STORE_ADDED = 0
 *
 * ─── AND RESOLUTION IS NOT A CHOICE ANYBODY OUTSIDE MAKES ───────────────────
 *
 * A resolver takes three things, and a caller supplies none of them: the
 * provider DEFINITION the route was registered under, and the binding and scope
 * DERIVED from the payment the callback correlates to. There is no parameter
 * here for a secret, a credential reference, a vault, or a database — pointing
 * the secret boundary at a caller-chosen connection would make the source of
 * truth selectable, which is the whole thing that must not be.
 *
 *   BODY_SECRET_USED = 0 · QUERY_SECRET_USED = 0
 *   CALLER_CHOOSES_SECRET_SOURCE = 0
 */

import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "../queries/connection";
import { scopeProviderBindings } from "@db/schema-block2";
import { ProviderCredentialError, providerCredentialVault } from "./provider-credential-vault";

/**
 * WHAT is being authenticated, as far as the server can establish it before a
 * single byte of the callback has been believed.
 *
 * `bindingId` is the account that EXECUTED the payment this callback is about,
 * read from the payment. `scopeId` is the fallback for a non-financial callback,
 * which has no payment to derive an account from and therefore arrives only
 * from trusted server-side code that already knows whose it is.
 */
export type WebhookVerificationSelector = {
  /** The provider DEFINITION the route belongs to. A selector, never a claim. */
  readonly definitionId: string;
  /** The binding whose account this callback concerns, when one is recorded. */
  readonly bindingId: string | null;
  /** The scope that owns it, when no binding was recorded. */
  readonly scopeId: string | null;
};

/** Material, and nothing that hints at where it came from. */
export type WebhookVerificationMaterial = { readonly secret: string };

export type WebhookVerificationResolver = (
  selector: WebhookVerificationSelector,
) => Promise<WebhookVerificationMaterial | null>;

/**
 * The one production resolver.
 *
 * Every refusal returns `null` — the same `null` for a provider that was never
 * connected, a binding that is somebody else's, one that was revoked, and one
 * whose material was never configured. A caller learns "this did not
 * authenticate" and never which of those it was, because a refusal that
 * distinguishes them is an oracle for whoever is probing.
 *
 *   MISSING_SECRET_AUTHENTICATES = 0
 *   REVOKED_BINDING_AUTHENTICATES_NEW_CALLBACK = 0
 */
export const bindingWebhookVerification: WebhookVerificationResolver = async (selector) => {
  const row = selector.bindingId
    ? // The account the payment was executed on. The route's provider name must
      // agree with it: a callback signed by provider P's account can never
      // authenticate a payment made at provider Q, whoever posted it.
      //
      //   CROSS_PROVIDER_SECRET_AUTHENTICATES = 0
      (
        await db
          .select()
          .from(scopeProviderBindings)
          .where(
            and(
              eq(scopeProviderBindings.id, selector.bindingId),
              eq(scopeProviderBindings.definitionId, selector.definitionId),
              ne(scopeProviderBindings.lifecycle, "REVOKED"),
              isNotNull(scopeProviderBindings.webhookCredentialRef),
            ),
          )
          .limit(1)
      )[0]
    : selector.scopeId
      ? // No payment to derive an account from, so the trusted caller's scope
        // decides — and only within that scope. One row per scope per provider
        // is a database invariant here, so this is never a choice between two.
        //
        //   CROSS_SCOPE_SECRET_AUTHENTICATES = 0
        (
          await db
            .select()
            .from(scopeProviderBindings)
            .where(
              and(
                eq(scopeProviderBindings.scopeId, selector.scopeId),
                eq(scopeProviderBindings.definitionId, selector.definitionId),
                ne(scopeProviderBindings.lifecycle, "REVOKED"),
                isNotNull(scopeProviderBindings.webhookCredentialRef),
              ),
            )
            .limit(2)
        ).at(0)
      : undefined;
  if (!row || !row.webhookCredentialRef) return null;
  try {
    const material = await providerCredentialVault().open(row.webhookCredentialRef, {
      scopeId: row.scopeId,
      bindingId: row.id,
      kind: "WEBHOOK_VERIFICATION",
      version: row.webhookCredentialVersion,
    });
    // A retired envelope is already `UNAVAILABLE` inside the vault, so an old
    // rotation cannot arrive here. There is no overlap window.
    const secret = material.secret;
    return typeof secret === "string" && secret.length > 0 ? { secret } : null;
  } catch (error) {
    // Unavailable, retired, moved, or the authentication tag did not check:
    // indistinguishable on purpose, and all of them mean NO material.
    if (error instanceof ProviderCredentialError) return null;
    // Anything else is infrastructure. An outage is not a provider failing to
    // authenticate, and swallowing one would turn it into a flood of refusals
    // that look exactly like forgeries.
    //
    //   INFRASTRUCTURE_FAILURE_REPORTED_AS_REFUSAL = 0
    throw error;
  }
};

let resolver: WebhookVerificationResolver | undefined;

/**
 * Trusted server code only. No request path may install a resolver, and none
 * does: the HTTP ingress reaches `ingestPaymentEvent`, which takes bytes and a
 * route name.
 *
 * This is the seam a deployment substitutes when verification material should
 * come from a key-management service rather than the application vault, which
 * is the same open item `JASIM_PROVIDER_BINDING.md` records for the outbound
 * credential.
 *
 *   KMS_HSM_HARDENING = DEFERRED_TO_PRODUCTION_HARDENING
 */
export function setWebhookVerificationResolver(next: WebhookVerificationResolver | undefined): void {
  resolver = next;
}

export function webhookVerificationResolver(): WebhookVerificationResolver {
  return resolver ?? bindingWebhookVerification;
}
