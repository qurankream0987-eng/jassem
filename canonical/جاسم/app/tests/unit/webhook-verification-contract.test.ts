/**
 * JASIM — THE WEBHOOK VERIFICATION CONTRACT.
 *
 * Checked without a database, a provider or a callback: where the material
 * lives, who may name it, and what the boundary cannot be handed.
 *
 *   WEBHOOK_SECRET != PUBLIC PROVIDER METADATA · != EVENT PAYLOAD · != LOG
 *   SECOND_SECRET_STORE = FORBIDDEN
 *   CLIENT_CAN_OVERRIDE_WEBHOOK_SECRET = 0
 *   BODY_SECRET_USED = 0 · QUERY_SECRET_USED = 0
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDENTIAL_KINDS } from "../../api/runtime/provider-credential-vault";

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const RESOLVER_SOURCE = read("api/runtime/webhook-verification.ts");
const RESOLVER = strip(RESOLVER_SOURCE);
const AUTH = strip(read("api/runtime/block3/webhook-auth.ts"));
const INGRESS = strip(read("api/http/payment-webhook.ts"));
const VAULT = strip(read("api/runtime/provider-credential-vault.ts"));
const BINDING = strip(read("api/runtime/provider-binding.ts"));
const SCHEMA = read("db/schema.ts");

describe("the webhook verification contract", () => {
  it("the plaintext catalog field is gone from the runtime and from the schema", () => {
    //   WEBHOOK_SECRET_PLAINTEXT_CANONICAL_STORAGE = 0
    //
    // Not deprecated, not commented as unused: absent. The read is gone from the
    // boundary, and the field is gone from the type, so writing one would not
    // typecheck and reading one would find nothing.
    expect(AUTH).not.toMatch(/capabilityProviderCatalog/);
    expect(AUTH).not.toMatch(/ioMetadata/);
    expect(RESOLVER).not.toMatch(/capabilityProviderCatalog|ioMetadata/);
    // The declared shape of that jsonb column no longer has the field at all.
    const ioMetadata = SCHEMA.slice(SCHEMA.indexOf('ioMetadata: jsonb("ioMetadata")'));
    const declared = strip(ioMetadata.slice(0, ioMetadata.indexOf(".notNull()")));
    expect(declared).not.toMatch(/webhookSecret/);
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: `receiptSecret` is still declared on that jsonb type.
    // WHY_IT_IS_WRONG: it was not wrong then — it recorded, deliberately, that
    //   one plaintext secret survived the webhook phase, so its survival was a
    //   stated fact rather than an oversight. It is what named the next gap.
    // NEW_EXPECTATION: neither secret is declared there. Receipt verification
    //   material is now sealed in the same vault, under its own kind, bound to
    //   the account the remote execution recorded.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: the discovery row can no longer
    //   carry ANY verification material, so writing one would not typecheck
    //   rather than merely being discouraged by a comment.
    //
    expect(declared).not.toMatch(/receiptSecret/);
  });

  it("there is one store, and this file adds no cipher and no table", () => {
    //   SECOND_SECRET_STORE_ADDED = 0 · NEW_SECRET_TABLE_ADDED = NO
    expect(RESOLVER).toMatch(/from "\.\/provider-credential-vault"/);
    // No key, no cipher, no digest of its own.
    expect(RESOLVER).not.toMatch(/createCipheriv|createDecipheriv|createHmac|createHash|randomBytes/);
    // It reads. It never writes anything, anywhere.
    expect(RESOLVER).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    // And it defines no table.
    expect(RESOLVER).not.toMatch(/pgTable/);
    // Exactly one vault class exists, and its name is the one that already did.
    expect(VAULT.match(/class \w+Vault/g)).toEqual(["class EncryptedProviderCredentialVault"]);
    expect(VAULT).not.toMatch(/WebhookSecretVault|PaymentWebhookVault|HmacSecretStore/);
  });

  it("the material is one KIND beside the credential, not a merge of the two", () => {
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: exactly two kinds, and the webhook rotation names its
    //   own kind literally at the retire call.
    // WHY_IT_IS_WRONG: it is not wrong — it is the lock that says a kind cannot
    //   appear unnoticed, and it flagged the third. Receipt verification is a
    //   third purpose: it authenticates a digest of a completed remote result,
    //   not the raw bytes of an inbound callback.
    // NEW_EXPECTATION: three kinds, and the retire call names the PURPOSE's
    //   kind — because the ceremony is now written once and the purposes are
    //   data, rather than copied per purpose.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: the per-kind retire is now asserted
    //   through the purpose table, which is the thing that would have to be
    //   wrong for one rotation to retire another — and both purposes are
    //   checked, instead of one being a copy nobody pinned.
    //
    expect([...CREDENTIAL_KINDS]).toEqual([
      "PROVIDER_AUTH",
      "WEBHOOK_VERIFICATION",
      "RECEIPT_VERIFICATION",
    ]);
    // The kind is authenticated by the envelope, not merely stored beside it.
    expect(VAULT).toMatch(/function aad\([\s\S]*?\$\{kind\}/);
    // Retiring one kind retires that kind. Revocation passes none, so it takes
    // everything — and rotation of the outbound credential names its own.
    expect(VAULT).toMatch(/retire\(bindingId: string, kind\?: CredentialKind\)/);
    expect(BINDING).toMatch(/retire\(row\.id, "PROVIDER_AUTH"\)/);
    expect(BINDING).toMatch(/retire\(row\.id, spec\.kind\)/);
    // Each purpose names its own kind, its own reference and its own version,
    // so no rotation can reach another purpose's material.
    expect(BINDING).toMatch(/kind: "WEBHOOK_VERIFICATION" as const/);
    expect(BINDING).toMatch(/kind: "RECEIPT_VERIFICATION" as const/);
    expect(BINDING).toMatch(/webhookCredentialRef: reference/);
    expect(BINDING).toMatch(/receiptCredentialRef: reference/);
    // Revocation, and only revocation, retires the lot.
    const revoke = BINDING.slice(BINDING.indexOf("export async function revokeBinding"));
    expect(revoke).toMatch(/retire\(row\.id\)/);
  });

  it("nothing a caller sends can name the material", () => {
    //   CLIENT_CAN_OVERRIDE_WEBHOOK_SECRET = 0
    //   BODY_SECRET_USED = 0 · QUERY_SECRET_USED = 0
    //
    // The boundary's own input type is the proof: it has no field for a secret,
    // a reference, a binding or a vault, so there is nothing for a body, a query
    // string or a header to arrive through.
    const input = AUTH.slice(AUTH.indexOf("input: {"), AUTH.indexOf("): Promise<AuthenticatedIngestResult>"));
    for (const field of ["secret", "webhookSecret", "credentialRef", "bindingId", "vault", "resolver"]) {
      expect(input, field).not.toContain(field);
    }
    // The HTTP door reads a body, a signature header and a path parameter. It
    // names no secret at all.
    expect(INGRESS).not.toMatch(/secret/i);
    // And the resolver takes no database, so the source of truth is not
    // selectable by whoever is calling.
    expect(RESOLVER).toMatch(/export type WebhookVerificationResolver = \(\s*selector: WebhookVerificationSelector,?\s*\) =>/);
  });

  it("every refusal is the same refusal, and infrastructure is not a refusal", () => {
    //   MISSING_SECRET_AUTHENTICATES = 0
    //
    // One `throw` in the whole file, and it is the rethrow of something that
    // was not a credential problem. Every other path returns null, so a caller
    // cannot tell "never connected" from "revoked" from "never configured".
    expect(RESOLVER.match(/throw [^;]*;/g)).toEqual(["throw error;"]);
    expect(RESOLVER).toMatch(/error instanceof ProviderCredentialError\) return null/);
    // A revoked binding resolves nothing, in the query itself.
    expect(RESOLVER).toMatch(/ne\(scopeProviderBindings\.lifecycle, "REVOKED"\)/);
    // And the definition in the route must match the binding, so a route name
    // is a selector rather than a claim.
    expect(RESOLVER).toMatch(/eq\(scopeProviderBindings\.definitionId, selector\.definitionId\)/);
  });

  it("no provider is named anywhere in the material path", () => {
    //   PROVIDER_NAME_BRANCHES = 0
    for (const name of ["stripe", "Stripe", "paypal", "PayPal", "moyasar", "Moyasar", "whsec_"]) {
      expect(RESOLVER, name).not.toContain(name);
      expect(AUTH, name).not.toContain(name);
      expect(INGRESS, name).not.toContain(name);
    }
    // The declaration of how a system signs is definition metadata, with two
    // values and no room for a third meaning.
    expect(BINDING).toMatch(/readonly webhook\?: "NONE" \| "SIGNED_HMAC";/);
    // How a system signs is read from the DEFINITION, through the purpose
    // table, and a provider that declared nothing is refused rather than
    // defaulted into one.
    expect(BINDING).toMatch(/definition\.webhook \?\? "NONE"/);
    expect(BINDING).toMatch(/spec\.declared\(definition\) !== "SIGNED_HMAC"/);
  });

  it("a payment records the ACCOUNT it was executed at, not only the kind", () => {
    //   PROVIDER_DEFINITION != PROVIDER_BINDING
    const execution = strip(read("api/runtime/block3/payment-execution.ts"));
    // Bound in the same statement as the provider, by the same ceremony.
    expect(execution).toMatch(/providerBindingRef: deps\.bindingRef/);
    expect(execution).toMatch(/deps\.bindingRef !== intent\.providerBindingRef/);
    // The route is what supplies it, from the binding it resolved.
    expect(strip(read("api/runtime/payment-route.ts"))).toMatch(/bindingRef: resolved\.route\.bindingId/);
    // And the boundary reads it from the payment rather than re-resolving a
    // route, so a policy edit can never change who may authenticate.
    expect(AUTH).toMatch(/bindingId: intent\?\.providerBindingRef \?\? null/);
    expect(AUTH).not.toMatch(/paymentExecutionRoute|resolvePaymentRoute/);
  });

  it("the secret never leaves through a return value, an audit row or a projection", () => {
    //   WEBHOOK_SECRET_RETURNED_AFTER_STORAGE = 0 · WEBHOOK_SECRET_IN_EVENT = 0
    // The ceremony, written once. Both purposes return through it.
    const configure = BINDING.slice(
      BINDING.indexOf("async function configureVerificationMaterial"),
      BINDING.indexOf("export async function authenticateBinding"),
    );
    expect(configure).toMatch(/Promise<\{ configured: true; version: number \}>/);
    expect(configure).toMatch(/return \{ configured: true, version \};/);
    expect(configure).toMatch(/return configureVerificationMaterial\("WEBHOOK", input\);/);
    // The audit row carries a message and a version. Nothing interpolates the
    // material, and the audit helper has no field that could hold it.
    expect(configure).not.toMatch(/detail:/);
    expect(configure).not.toMatch(/\$\{secret\}|secret\.slice|createHash\(/);
    // The projection reports a status, assembled from whether a reference
    // exists — never the reference and never what it points at.
    const projection = BINDING.slice(BINDING.indexOf("function project("), BINDING.indexOf("export async function projectBindings"));
    expect(projection).toMatch(/webhookVerification:/);
    expect(projection).not.toMatch(/webhookCredentialRef: row/);
  });
});
