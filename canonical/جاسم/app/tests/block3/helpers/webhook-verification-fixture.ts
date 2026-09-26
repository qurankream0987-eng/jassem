/**
 * TEST-ONLY webhook verification material.
 *
 * ─── WHY THIS EXISTS, AND WHY IT IS NOT A PROVISIONING PATH ─────────────────
 *
 * These Block 3 suites prove properties of the authenticated boundary itself:
 * that the HMAC covers the exact raw bytes, that an unsigned timestamp cannot
 * refresh an old signed body, that the replay ledger is durable, that a callback
 * whose money disagrees with the mandate is refused. None of them is about where
 * the secret came from.
 *
 * They used to state the secret by writing plaintext into
 * `capability_provider_catalog.ioMetadata.webhookSecret` — a discovery table, at
 * trust class UNTRUSTED_CANDIDATE, in ordinary jsonb. That read is gone from
 * production, so the fixture states the same fact through the resolver seam
 * instead: trusted server code installs a resolver, and no request path can.
 *
 * This is NOT how a secret enters JASIM in production. The only production path
 * is the `provider.webhook.configure` product action → `configureWebhookVerification`
 * → the credential vault, and `tests/block31/provider-webhook-secret.test.ts`
 * proves the whole chain end to end through that path with nothing injected.
 *
 *   WEBHOOK_SECRET_PLAINTEXT_CANONICAL_STORAGE = 0
 *   FIXTURE_IS_A_PRODUCTION_PROVISIONING_PATH = NO
 */

import { eq } from "drizzle-orm";
import { paymentIntents } from "@db/schema";
import { setWebhookVerificationResolver } from "../../../api/runtime/webhook-verification";

/** Material per provider DEFINITION, as a fixture states it. */
export function installFixtureWebhookVerification(secrets: Readonly<Record<string, string>>): void {
  setWebhookVerificationResolver(async ({ definitionId }) => {
    const secret = secrets[definitionId];
    return secret ? { secret } : null;
  });
}

export function clearFixtureWebhookVerification(): void {
  setWebhookVerificationResolver(undefined);
}

/**
 * State that a payment was executed at a provider ACCOUNT.
 *
 * Exactly the pair `executePaymentAuthorization` writes in its binding ceremony
 * (`providerRef` + `providerBindingRef`, one statement, never one without the
 * other). Used by suites whose subject is the callback boundary rather than
 * execution, so that a refusal they assert is the refusal they are about — a
 * callback about a payment that reached no provider account is now refused
 * before a signature is even checked, which would otherwise make those
 * assertions pass for the wrong reason.
 */
export async function bindIntentToProviderAccount(
  db: { update: (table: typeof paymentIntents) => any },
  intentId: string,
  account: { providerRef: string; bindingRef: string },
): Promise<void> {
  await db
    .update(paymentIntents)
    .set({ providerRef: account.providerRef, providerBindingRef: account.bindingRef })
    .where(eq(paymentIntents.id, intentId));
}
