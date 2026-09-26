/**
 * JASIM — THE RECEIPT VERIFICATION CONTRACT.
 *
 * Checked without a database, a provider or a remote call: where the material
 * lives, which account owns it, and what the verification path cannot be
 * handed.
 *
 *   RECEIPT != VERIFICATION · VALID_RECEIPT_SIGNATURE != BUSINESS_TRUTH
 *   PROVIDER_CANDIDATE != PROVIDER_ACCOUNT · RECEIPT_SECRET != WEBHOOK_SECRET
 *   SECOND_SECRET_STORE = FORBIDDEN
 *   CLIENT_CAN_OVERRIDE_RECEIPT_SECRET = 0
 *   PROTOCOL_SECRET_RUNTIME_BRANCHES = 0 · DOMAIN_RECEIPT_SECRET_HANDLERS = 0
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CREDENTIAL_KINDS } from "../../api/runtime/provider-credential-vault";

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const RESOLVER = strip(read("api/runtime/receipt-verification.ts"));
const POLLING = strip(read("api/runtime/block2/remote-polling.ts"));
const RUNTIME = strip(read("api/runtime/jasim-runtime.ts"));
const BINDING = strip(read("api/runtime/provider-binding.ts"));
const CANDIDATE = strip(read("api/runtime/capability-provider.ts"));
const VERIFIER = strip(read("api/runtime/execution-verifier.ts"));
const SCHEMA = read("db/schema.ts");

describe("the receipt verification contract", () => {
  it("the plaintext field is gone from discovery metadata and from the candidate", () => {
    //   RECEIPT_SECRET_PLAINTEXT_CANONICAL_STORAGE = 0
    //
    // Both readers are gone, and both declarations are gone — so writing one
    // would not typecheck rather than merely being discouraged by a comment.
    expect(POLLING).not.toMatch(/receiptSecret/);
    expect(CANDIDATE).not.toMatch(/receiptSecret/);
    const ioMetadata = SCHEMA.slice(SCHEMA.indexOf('ioMetadata: jsonb("ioMetadata")'));
    const declared = strip(ioMetadata.slice(0, ioMetadata.indexOf(".notNull()")));
    expect(declared).not.toMatch(/receiptSecret|webhookSecret/);
    // The endpoint is NOT touched: whose address a remote system is at is a
    // separate question this phase deliberately did not widen into.
    expect(declared).toMatch(/endpoint/);
    expect(POLLING).toMatch(/ioMetadata\.endpoint/);
  });

  it("there is one store, and this file adds no cipher, no table and no kind of its own", () => {
    //   SECOND_SECRET_STORE_ADDED = 0 · NEW_SECRET_TABLE_ADDED = NO
    expect([...CREDENTIAL_KINDS]).toContain("RECEIPT_VERIFICATION");
    expect(RESOLVER).toMatch(/from "\.\/provider-credential-vault"/);
    expect(RESOLVER).not.toMatch(/createCipheriv|createDecipheriv|createHmac|createHash|randomBytes/);
    expect(RESOLVER).not.toMatch(/\.insert\(|\.update\(|\.delete\(|pgTable/);
    // And no vault of its own, under any of the names this would have grown.
    for (const name of ["ReceiptSecretVault", "RemoteExecutionSecretStore", "McpReceiptVault", "A2ASecretTable"]) {
      expect(RESOLVER, name).not.toContain(name);
      expect(BINDING, name).not.toContain(name);
    }
  });

  it("the account is pinned at execution and never re-derived afterwards", () => {
    //   MUTABLE_POLICY_CHANGES_RECEIPT_SECRET_SOURCE = 0
    //   REMOTE_EXECUTION != LATEST_BINDING
    //
    // Written once, when the execution is created.
    expect(RUNTIME).toMatch(/providerBindingRef: providerAccountRef/);
    expect(RUNTIME).toMatch(/providerAccountRef = await accountBindingFor\(/);
    // Read from the execution row afterwards — never resolved again.
    expect(RUNTIME).toMatch(/bindingId: execution\.providerBindingRef/);
    // The lookup itself is exact: one scope, one provider, no ordering and no
    // "first" to pick.
    const lookup = BINDING.slice(
      BINDING.indexOf("export async function accountBindingFor"),
      BINDING.indexOf("export async function credentialRowsForAudit"),
    );
    expect(lookup).toMatch(/eq\(scopeProviderBindings\.scopeId, input\.scopeId\)/);
    expect(lookup).toMatch(/eq\(scopeProviderBindings\.definitionId, input\.definitionId\)/);
    expect(lookup).toMatch(/ne\(scopeProviderBindings\.lifecycle, "REVOKED"\)/);
    expect(lookup).not.toMatch(/orderBy|desc\(|createdAt/);
    // And the resolver refuses to look anything up without an account.
    expect(RESOLVER).toMatch(/if \(!selector\.bindingId\) return null;/);
    expect(RESOLVER).not.toMatch(/orderBy|desc\(|scopeId, selector|latest/i);
  });

  it("nothing a caller supplies can name the material", () => {
    //   CLIENT_CAN_OVERRIDE_RECEIPT_SECRET = 0
    //
    // The completion path used to take the secret as a parameter from whoever
    // called it. Its input type no longer has one, and the polling loop no
    // longer has one to give.
    const complete = RUNTIME.slice(
      RUNTIME.indexOf("export async function completeRemoteRuntimeDagNode"),
      RUNTIME.indexOf("export async function completeRemoteRuntimeDagNode") + 2000,
    );
    expect(complete).not.toMatch(/providerReceiptSecret\?: string/);
    expect(complete).toMatch(/const providerReceiptSecret = await receiptSecretFor\(/);
    expect(POLLING).not.toMatch(/providerReceiptSecret/);
    // The resolver takes no database and no secret, so the source of truth is
    // not selectable by whoever is calling.
    expect(RESOLVER).toMatch(
      /export type ReceiptVerificationResolver = \(\s*selector: ReceiptVerificationSelector,?\s*\) =>/,
    );
    const selector = RESOLVER.slice(
      RESOLVER.indexOf("export type ReceiptVerificationSelector"),
      RESOLVER.indexOf("export type ReceiptVerificationMaterial"),
    );
    for (const field of ["secret", "credentialRef", "db", "vault", "scopeId"]) {
      expect(selector, field).not.toContain(field);
    }
  });

  it("every refusal is the same refusal, and infrastructure is not a refusal", () => {
    //   MISSING_RECEIPT_SECRET_VERIFIES = 0
    //   REVOKED_BINDING_AUTHENTICATES_NEW_RECEIPT = 0
    expect(RESOLVER.match(/throw [^;]*;/g)).toEqual(["throw error;"]);
    expect(RESOLVER).toMatch(/error instanceof ProviderCredentialError\) return null/);
    expect(RESOLVER).toMatch(/ne\(scopeProviderBindings\.lifecycle, "REVOKED"\)/);
    // The provider the execution recorded must be the provider the account is
    // an account AT.
    expect(RESOLVER).toMatch(/eq\(scopeProviderBindings\.definitionId, selector\.providerId\)/);
  });

  it("a receipt is weighed, never believed", () => {
    //   WRONG_DIGEST_VERIFIES = 0 · SIGNED_RECEIPT_AUTO_PROVES_BUSINESS_EFFECT = 0
    //
    // The signature is checked against a digest JASIM computed itself, and the
    // completion path re-computes that digest from the output it holds before
    // it will call the receipt valid.
    expect(VERIFIER).toMatch(/createHmac\("sha256", input\.receiptSecret\)\s*\.update\(input\.resultDigest\)/);
    expect(RUNTIME).toMatch(/resultDigest === remoteOutputDigest\(input\.output\)/);
    // And a valid receipt is one input to the verdict, never the verdict.
    expect(RESOLVER).not.toMatch(/VERIFIED|verdict|status/);
  });

  it("no protocol and no domain appears in the material path", () => {
    //   PROTOCOL_SECRET_RUNTIME_BRANCHES = 0 · DOMAIN_RECEIPT_SECRET_HANDLERS = 0
    for (const name of ["MCP", "A2A", "mcp", "a2a", "Restaurant", "Car", "Payment"]) {
      expect(RESOLVER, name).not.toContain(name);
    }
    // The purposes are a table of vocabulary, not a per-protocol handler.
    expect(BINDING).toMatch(/readonly receipt\?: "NONE" \| "SIGNED_HMAC";/);
    expect(BINDING).toMatch(/spec\.declared\(definition\) !== "SIGNED_HMAC"/);
    // One ceremony. The two public entry points are thin.
    expect(BINDING).toMatch(/return configureVerificationMaterial\("WEBHOOK", input\);/);
    expect(BINDING).toMatch(/return configureVerificationMaterial\("RECEIPT", input\);/);
  });
});
