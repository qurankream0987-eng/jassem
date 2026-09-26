/**
 * JASIM — WHOSE RECEIPT IS THIS.
 *
 *   RECEIPT != VERIFICATION · VALID_RECEIPT_SIGNATURE != BUSINESS_TRUTH
 *   PROVIDER_CANDIDATE != PROVIDER_ACCOUNT · SAME_PROVIDER != SAME_ACCOUNT
 *   REMOTE_EXECUTION != LATEST_BINDING · UNKNOWN_BINDING != ANY_BINDING
 *   RECEIPT_SECRET != WEBHOOK_SECRET
 *
 * Every secret here enters through the one production path — the trusted
 * product action and `configureReceiptVerification` — and nothing is injected
 * into the verification path anywhere.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let binding: typeof import("../../api/runtime/provider-binding");
let receipts: typeof import("../../api/runtime/receipt-verification");
let remote: typeof import("../../api/runtime/block2/remote-execution");
let verifier: typeof import("../../api/runtime/execution-verifier");
let actions: typeof import("../../api/runtime/product-actions");

const T0 = new Date("2026-09-26T11:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

const SECRET = "rcpt_the_only_one_this_account_agreed";
const OTHER = "rcpt_a_completely_different_account";

const RESULT = Object.freeze({ content: [{ type: "text", text: "تم" }] });

describe("where a provider receipt secret lives", () => {
  let ownerScope: string;
  let strangerScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    binding = await import("../../api/runtime/provider-binding");
    receipts = await import("../../api/runtime/receipt-verification");
    remote = await import("../../api/runtime/block2/remote-execution");
    verifier = await import("../../api/runtime/execution-verifier");
    actions = await import("../../api/runtime/product-actions");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    const adapter = {
      authenticate: async () => ({ ok: true as const, accountRef: "acct" }),
      discover: async () => ["READ"] as never,
      invoke: async () => ({ status: "OK" as const, value: {} }),
    };
    const base = {
      authMethod: "API_KEY" as const,
      endpoint: { mode: "FIXED" as const, baseUrl: "https://example.com/remote" },
      testOnly: true, adapter, supports: ["READ"] as const,
    };
    // One KIND of remote system signs its receipts. One does not, and one
    // signs CALLBACKS instead — so that no purpose can borrow another's.
    registry.register({ ...base, id: "rx.remote", displayName: "نظام بعيد", receipt: "SIGNED_HMAC" });
    registry.register({ ...base, id: "rx.quiet", displayName: "نظام صامت" });
    registry.register({ ...base, id: "rx.callbacks", displayName: "نظام إشعارات", webhook: "SIGNED_HMAC" });
    // And one that does both, which is the only way to check that rotating one
    // purpose leaves the other exactly where it was.
    registry.register({
      ...base, id: "rx.both", displayName: "نظام يفعل الاثنين",
      webhook: "SIGNED_HMAC", receipt: "SIGNED_HMAC",
    });
    binding.setProviderDefinitionRegistry(registry);
  });

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, remote_executions,
        capability_provider_catalog, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'rx-%'`));
    const made: string[] = [];
    for (const name of ["صاحب", "غريب"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `rx-${randomUUID()}`, name, preferences: {} }).returning();
      made.push(String(row!.id));
    }
    [ownerScope, strangerScope] = made as [string, string];
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  /** The whole trusted lifecycle. Receipt material is optional, as it is. */
  async function connect(
    definitionId: string,
    opts: { scope?: string; secret?: string | null; webhookSecret?: string } = {},
  ) {
    const scope = opts.scope ?? ownerScope;
    const opened = await binding.beginProviderSetup({
      principalId: scope, scopeId: scope, definitionId,
      requestedCapabilities: ["READ"], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: scope, material: { apiKey: "k" }, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: scope, now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: scope, now: at(3 * MINUTE),
    });
    if (opts.secret !== null) {
      await binding.configureReceiptVerification({
        bindingId: opened.bindingId, principalId: scope,
        secret: opts.secret ?? SECRET, now: at(4 * MINUTE),
      });
    }
    if (opts.webhookSecret) {
      await binding.configureWebhookVerification({
        bindingId: opened.bindingId, principalId: scope,
        secret: opts.webhookSecret, now: at(5 * MINUTE),
      });
    }
    return { bindingId: opened.bindingId, opened };
  }

  /** A remote execution that pinned the account it ran through. */
  async function execute(providerId: string, bindingId: string | null) {
    return remote.createRemoteExecution(handle.db as never, {
      ownerId: ownerScope,
      runId: randomUUID(),
      nodeId: randomUUID(),
      providerId,
      // The SELECTION record `resolveProvider` mints. It identifies no account.
      bindingId: randomUUID(),
      providerBindingRef: bindingId,
      protocolKind: "MCP",
      requestDigest: "a".repeat(64),
      idempotencyKey: `idem_${randomUUID()}`,
    } as never);
  }

  const digest = (result: Record<string, unknown> = RESULT as never) =>
    verifier.canonicalResultDigest(result);
  const sign = (value: string, secret = SECRET) =>
    createHmac("sha256", secret).update(value).digest("hex");

  /** The existing verification layer, with the material this phase resolves. */
  async function weigh(
    execution: { providerId: string; providerBindingRef: string | null },
    evidence: { resultDigest: string; receiptSignature: string },
    result: Record<string, unknown> = RESULT as never,
  ) {
    const secret = await receipts.receiptSecretFor({
      providerId: execution.providerId,
      bindingId: execution.providerBindingRef,
    });
    return verifier.verifyExecutionAttempt({
      attemptId: `attempt_${randomUUID()}`,
      runId: randomUUID(),
      nodeId: randomUUID(),
      capabilityId: "remote.read",
      executionStatus: "COMPLETED",
      normalizedResult: { result, metadata: { capabilityId: "remote.read" } },
      normalizedError: null,
      idempotencyKey: `idem_${randomUUID()}`,
      remoteEvidence: evidence,
      ...(secret ? { providerReceiptSecret: secret } : {}),
    } as never);
  }

  const CANONICAL_TABLES = [
    "events", "provider_credentials", "scope_provider_bindings", "remote_executions",
    "capability_provider_catalog", "scope_policies",
  ];
  async function whereItLeaked(needle: string): Promise<string[]> {
    const found: string[] = [];
    for (const table of CANONICAL_TABLES) {
      const rows = await handle.db.execute(
        sql.raw(
          `SELECT count(*)::int n FROM ${table} WHERE CAST(to_jsonb(${table}.*) AS text) LIKE '%${needle}%'`,
        ),
      );
      if ((rows.rows[0] as { n: number }).n > 0) found.push(table);
    }
    return found;
  }

  // ── 1–3 · WHERE IT ENDED UP ──────────────────────────────────────────────

  it("the trusted path seals it, and the raw secret is nowhere in canonical state", async () => {
    //   RECEIPT_SECRET_PLAINTEXT_CANONICAL_STORAGE = 0
    //   RECEIPT_SECRET_IN_EVENT = 0 · RECEIPT_SECRET_LOGGED = 0
    const { bindingId } = await connect("rx.remote");
    expect(await whereItLeaked(SECRET)).toEqual([]);
    const rows = (
      await handle.db.execute(
        sql.raw(`SELECT kind, version, "retiredAt" IS NULL AS live FROM provider_credentials
                 WHERE "bindingId" = '${bindingId}' ORDER BY kind`),
      )
    ).rows as { kind: string; version: number; live: boolean }[];
    expect(rows.map((r) => r.kind)).toEqual(["PROVIDER_AUTH", "RECEIPT_VERIFICATION"]);
    expect(rows.every((r) => r.live)).toBe(true);
    // The projection reports a STATUS and carries no reference.
    const [projection] = await binding.projectBindings({
      principalId: ownerScope, scopeId: ownerScope, now: at(10 * MINUTE),
    });
    expect(projection!.receiptVerification).toBe("CONFIGURED");
    expect(projection!.webhookVerification).toBe("NOT_REQUIRED");
    expect(JSON.stringify(projection)).not.toContain(SECRET);
    expect(JSON.stringify(projection)).not.toContain("receiptCredentialRef");
    // The audit row says the fact and the version, and has no field for more.
    const audit = (
      await handle.db.execute(
        sql.raw(`SELECT type, CAST(payload AS text) p FROM events
                 WHERE type = 'PROVIDER_RECEIPT_VERIFICATION_CONFIGURED'`),
      )
    ).rows as { type: string; p: string }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]!.p).not.toContain(SECRET);
  });

  it("the completion says configured, and never the secret", async () => {
    //   RECEIPT_SECRET_RETURNED_AFTER_STORAGE = 0
    const { bindingId } = await connect("rx.remote", { secret: null });
    const done = await binding.configureReceiptVerification({
      bindingId, principalId: ownerScope, secret: SECRET, now: at(6 * MINUTE),
    });
    expect(done).toEqual({ configured: true, version: 1 });
    expect(JSON.stringify(done)).not.toContain(SECRET);
  });

  it("a string the model produced cannot become receipt material", async () => {
    //   MODEL_CAN_PROVISION_RECEIPT_SECRET = NO
    //   MODEL_CAN_SEE_RECEIPT_SECRET = NO · CHAT_CAN_TRANSPORT_RECEIPT_SECRET = NO
    const action = actions.getProductAction("provider.receipt.configure")!;
    expect(action.fields.find((field) => field.key === "receiptSecret")!.kind).toBe("SENSITIVE");
    expect(action.reauthentication).toBe(true);
    expect(action.confirmation).toBe("EXPLICIT");
    const presentation = actions.presentationFor(action);
    expect(presentation.fields.every((field) => !("value" in field))).toBe(true);
    expect(
      presentation.fields.filter((field) => field.kind !== "SENSITIVE").map((field) => field.key),
    ).toEqual(["bindingId"]);
    // And exactly one place in the whole server provisions it.
    const callers = filesMentioning("configureReceiptVerification", resolve(__dirname, "../../api"));
    expect(callers.sort()).toEqual([
      "runtime/product-actions.ts",
      "runtime/provider-binding.ts",
    ]);
  });

  // ── 4 · THE WHOLE POINT ──────────────────────────────────────────────────

  it("the pinned account's material lets a genuine receipt pass the verifier", async () => {
    const { bindingId } = await connect("rx.remote");
    const execution = await execute("rx.remote", bindingId);
    expect(execution.providerBindingRef).toBe(bindingId);
    const resultDigest = digest();
    const verdict = await weigh(execution, {
      resultDigest,
      receiptSignature: sign(resultDigest),
    });
    expect(verdict.status).not.toBe("INCONCLUSIVE");
    // The receipt layer ran and was satisfied — which is a statement about the
    // EVIDENCE SOURCE and nothing else. Every other assertion in this suite is
    // about what it refuses.
    //
    //   VALID_RECEIPT_SIGNATURE != BUSINESS_TRUTH
    expect(verdict.notes.join(" ")).not.toMatch(/receipt (is )?(invalid|unverified|missing)/i);
  });

  // ── 5–6 · WRONG AND MISSING ──────────────────────────────────────────────

  it("a wrong secret and absent material both fail to verify", async () => {
    //   WRONG_RECEIPT_SECRET_VERIFIES = 0 · MISSING_RECEIPT_SECRET_VERIFIES = 0
    const { bindingId } = await connect("rx.remote");
    const execution = await execute("rx.remote", bindingId);
    const resultDigest = digest();
    const wrong = await weigh(execution, {
      resultDigest,
      receiptSignature: sign(resultDigest, OTHER),
    });
    expect(wrong.status).toBe("INCONCLUSIVE");
    expect(wrong.notes.join(" ")).toMatch(/receipt/i);

    // A connection that never configured any. Nothing to weigh it against.
    const bare = await connect("rx.remote", { scope: strangerScope, secret: null });
    const other = await execute("rx.remote", bare.bindingId);
    expect(
      await receipts.receiptSecretFor({
        providerId: "rx.remote", bindingId: other.providerBindingRef,
      }),
    ).toBeUndefined();
    const missing = await weigh(other, { resultDigest, receiptSignature: sign(resultDigest) });
    expect(missing.status).toBe("INCONCLUSIVE");
  });

  // ── 7–8 · ONE ACCOUNT'S SECRET IS ONE ACCOUNT'S SECRET ───────────────────

  it("another account's receipt secret authenticates nothing here", async () => {
    //   CROSS_BINDING_RECEIPT_SECRET_AUTHENTICATES = 0
    //   CROSS_SCOPE_RECEIPT_SECRET_AUTHENTICATES = 0
    //   CROSS_PROVIDER_RECEIPT_SECRET_AUTHENTICATES = 0
    const mine = await connect("rx.remote");
    // A different scope, the same provider definition, its own account.
    const theirs = await connect("rx.remote", { scope: strangerScope, secret: OTHER });
    expect(theirs.bindingId).not.toBe(mine.bindingId);
    const execution = await execute("rx.remote", mine.bindingId);
    const resultDigest = digest();
    const crossScope = await weigh(execution, {
      resultDigest, receiptSignature: sign(resultDigest, OTHER),
    });
    expect(crossScope.status).toBe("INCONCLUSIVE");
    // And naming the other account on an execution at a provider it is not an
    // account at resolves nothing at all.
    const mismatched = await execute("rx.quiet", mine.bindingId);
    expect(
      await receipts.receiptSecretFor({
        providerId: "rx.quiet", bindingId: mismatched.providerBindingRef,
      }),
    ).toBeUndefined();
  });

  it("a callback secret is not a receipt secret, even on the same connection", async () => {
    //   RECEIPT_SECRET != WEBHOOK_SECRET
    const { bindingId } = await connect("rx.remote", { secret: SECRET });
    // The same connection cannot even hold callback material: its definition
    // never said it sends callbacks.
    await expect(
      binding.configureWebhookVerification({
        bindingId, principalId: ownerScope, secret: OTHER, now: at(7 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    // And a connection that signs callbacks cannot be handed receipt material.
    const callbacks = await connect("rx.callbacks", {
      secret: null, webhookSecret: OTHER, scope: strangerScope,
    });
    await expect(
      binding.configureReceiptVerification({
        bindingId: callbacks.bindingId, principalId: strangerScope,
        secret: SECRET, now: at(8 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  // ── 9–10 · THE SIGNATURE IS NOT THE TRUTH ────────────────────────────────

  it("a valid signature over the wrong digest, or over a since-changed result, fails", async () => {
    //   WRONG_DIGEST_VERIFIES = 0
    //   SIGNED_RECEIPT_AUTO_PROVES_BUSINESS_EFFECT = 0
    const { bindingId } = await connect("rx.remote");
    const execution = await execute("rx.remote", bindingId);
    // Correctly signed — over something else.
    const elsewhere = digest({ content: [{ type: "text", text: "شيء آخر" }] } as never);
    const wrongDigest = await weigh(execution, {
      resultDigest: elsewhere,
      receiptSignature: sign(elsewhere),
    });
    expect(wrongDigest.status).toBe("INCONCLUSIVE");
    // The receipt was genuine for the result as issued; the result then changed.
    const issued = digest();
    const tampered = await weigh(
      execution,
      { resultDigest: issued, receiptSignature: sign(issued) },
      { content: [{ type: "text", text: "تم — مع إضافة" }] } as never,
    );
    expect(tampered.status).toBe("INCONCLUSIVE");
  });

  // ── 11–12 · UNKNOWN IS NOT ANY ───────────────────────────────────────────

  it("an execution that pinned no account cannot be rescued by any lookup", async () => {
    //   NULL_BINDING_REMOTE_RECEIPT_VERIFIED = 0 · UNKNOWN_BINDING != ANY_BINDING
    await connect("rx.remote");
    const legacy = await execute("rx.remote", null);
    expect(legacy.providerBindingRef).toBeNull();
    expect(
      await receipts.receiptSecretFor({
        providerId: "rx.remote", bindingId: legacy.providerBindingRef,
      }),
    ).toBeUndefined();
    const resultDigest = digest();
    // Signed with the one secret that exists for this provider and this owner.
    const verdict = await weigh(legacy, {
      resultDigest, receiptSignature: sign(resultDigest),
    });
    expect(verdict.status).toBe("INCONCLUSIVE");
  });

  it("what changes after the execution cannot change what verifies it", async () => {
    //   MUTABLE_POLICY_CHANGES_RECEIPT_SECRET_SOURCE = 0
    //   REMOTE_EXECUTION != LATEST_BINDING
    const mine = await connect("rx.remote");
    const execution = await execute("rx.remote", mine.bindingId);
    const resultDigest = digest();
    // Afterwards: a preference is written, and another account appears at the
    // same provider in another scope.
    await handle.db.execute(
      sql.raw(`INSERT INTO scope_policies ("id","scopeId","policyKey","value","setByPrincipalId")
               VALUES ('pol_${randomUUID()}','${ownerScope}','source.resolution',
                       '{"preferredProviders":["rx.quiet"]}'::jsonb,'${ownerScope}')`),
    );
    await connect("rx.remote", { scope: strangerScope, secret: OTHER });
    // The account pinned at execution is still the one that decides.
    const verdict = await weigh(execution, {
      resultDigest, receiptSignature: sign(resultDigest),
    });
    expect(verdict.status).not.toBe("INCONCLUSIVE");
    const theirs = await weigh(execution, {
      resultDigest, receiptSignature: sign(resultDigest, OTHER),
    });
    expect(theirs.status).toBe("INCONCLUSIVE");
  });

  // ── 13–17 · ROTATION IS PER PURPOSE ──────────────────────────────────────

  it("rotating the receipt secret retires the old one and touches no other kind", async () => {
    //   RECEIPT_ROTATION_RETIRES_PROVIDER_AUTH = 0
    //   RECEIPT_ROTATION_RETIRES_WEBHOOK_SECRET = 0
    const { bindingId } = await connect("rx.remote");
    const execution = await execute("rx.remote", bindingId);
    const rotated = await binding.configureReceiptVerification({
      bindingId, principalId: ownerScope, secret: OTHER, now: at(9 * MINUTE),
    });
    expect(rotated.version).toBe(2);
    const resultDigest = digest();
    // The retired secret is retired. There is no overlap window.
    const old = await weigh(execution, {
      resultDigest, receiptSignature: sign(resultDigest, SECRET),
    });
    expect(old.status).toBe("INCONCLUSIVE");
    const fresh = await weigh(execution, {
      resultDigest, receiptSignature: sign(resultDigest, OTHER),
    });
    expect(fresh.status).not.toBe("INCONCLUSIVE");
    // The outbound credential is untouched, at its own version.
    const live = (
      await handle.db.execute(
        sql.raw(`SELECT kind, version FROM provider_credentials
                 WHERE "bindingId" = '${bindingId}' AND "retiredAt" IS NULL ORDER BY kind`),
      )
    ).rows as { kind: string; version: number }[];
    expect(live).toEqual([
      { kind: "PROVIDER_AUTH", version: 1 },
      { kind: "RECEIPT_VERIFICATION", version: 2 },
    ]);
  });

  it("a webhook rotation leaves receipt material usable, and the reverse", async () => {
    //   WEBHOOK_ROTATION_RETIRES_RECEIPT_SECRET = 0
    //   OUTBOUND_ROTATION_RETIRES_RECEIPT_SECRET = 0
    //
    // One connection holds both purposes, which is what makes this checkable:
    // its definition declares that it signs callbacks AND receipts.
    const { bindingId } = await connect("rx.both", { secret: SECRET, webhookSecret: OTHER });
    // Rotate the CALLBACK material. The receipt material must not move.
    await binding.configureWebhookVerification({
      bindingId, principalId: ownerScope, secret: `${OTHER}_2`, now: at(6 * MINUTE),
    });
    const execution = await execute("rx.both", bindingId);
    const resultDigest = digest();
    const verdict = await weigh(execution, {
      resultDigest, receiptSignature: sign(resultDigest, SECRET),
    });
    expect(verdict.status).not.toBe("INCONCLUSIVE");
    const live = (
      await handle.db.execute(
        sql.raw(`SELECT kind, version FROM provider_credentials
                 WHERE "bindingId" = '${bindingId}' AND "retiredAt" IS NULL ORDER BY kind`),
      )
    ).rows as { kind: string; version: number }[];
    expect(live).toEqual([
      { kind: "PROVIDER_AUTH", version: 1 },
      { kind: "RECEIPT_VERIFICATION", version: 1 },
      { kind: "WEBHOOK_VERIFICATION", version: 2 },
    ]);
  });

  // ── 18–19 · REVOCATION ───────────────────────────────────────────────────

  it("revocation closes the door and erases nothing that already happened", async () => {
    //   REVOKED_BINDING_AUTHENTICATES_NEW_RECEIPT = 0
    //   REVOCATION_ERASES_HISTORICAL_VERIFIED_EVIDENCE = 0
    const { bindingId } = await connect("rx.remote");
    const execution = await execute("rx.remote", bindingId);
    const resultDigest = digest();
    const before = await weigh(execution, {
      resultDigest, receiptSignature: sign(resultDigest),
    });
    expect(before.status).not.toBe("INCONCLUSIVE");

    await binding.revokeBinding({ bindingId, principalId: ownerScope, now: at(9 * MINUTE) });
    const after = await weigh(execution, {
      resultDigest, receiptSignature: sign(resultDigest),
    });
    expect(after.status).toBe("INCONCLUSIVE");
    // The execution row, and the audit of what was configured, both stand.
    const rows = (
      await handle.db.execute(
        sql.raw(`SELECT count(*)::int n FROM remote_executions WHERE id = '${execution.id}'`),
      )
    ).rows[0] as { n: number };
    expect(rows.n).toBe(1);
    const audit = (
      await handle.db.execute(
        sql.raw(`SELECT count(*)::int n FROM events
                 WHERE type = 'PROVIDER_RECEIPT_VERIFICATION_CONFIGURED'`),
      )
    ).rows[0] as { n: number };
    expect(audit.n).toBe(1);
    // Nothing of this binding's is openable any more.
    const live = (
      await handle.db.execute(
        sql.raw(`SELECT count(*)::int n FROM provider_credentials
                 WHERE "bindingId" = '${bindingId}' AND "retiredAt" IS NULL`),
      )
    ).rows[0] as { n: number };
    expect(live.n).toBe(0);
  });

  // ── 20 · A REMOTE SYSTEM THAT DOES NOT SIGN RECEIPTS ─────────────────────

  it("a provider that never signs receipts connects normally and is asked for nothing", async () => {
    const opened = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: ownerScope, definitionId: "rx.quiet",
      requestedCapabilities: ["READ"], now: T0,
    });
    expect(opened.receiptVerification).toBe("NONE");
    expect(opened.webhookVerification).toBe("NONE");
    expect(opened.collects.map((field) => field.key)).toEqual(["apiKey"]);
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: ownerScope, material: { apiKey: "k" }, now: at(MINUTE),
    });
    await binding.authenticateBinding({ bindingId: opened.bindingId, principalId: ownerScope, now: at(2 * MINUTE) });
    const verified = await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: ownerScope, now: at(3 * MINUTE),
    });
    expect(verified.status).toBe("VERIFIED");
    const [projection] = await binding.projectBindings({
      principalId: ownerScope, scopeId: ownerScope, now: at(10 * MINUTE),
    });
    expect(projection!.receiptVerification).toBe("NOT_REQUIRED");
    await expect(
      binding.configureReceiptVerification({
        bindingId: opened.bindingId, principalId: ownerScope, secret: SECRET, now: at(4 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});

/** Every file under `root` whose source mentions `needle`, relative to root. */
function filesMentioning(needle: string, root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith(".ts")) continue;
      if (readFileSync(full, "utf8").includes(needle)) found.push(full.slice(root.length + 1));
    }
  };
  walk(root);
  return found;
}
