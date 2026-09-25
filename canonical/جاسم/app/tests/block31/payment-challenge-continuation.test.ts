/**
 * JASIM — THE PAYER CAME BACK. THAT IS ALL THAT PROVES.
 *
 *   BROWSER_RETURN != PAYMENT_PROOF != PAYMENT_SUCCESS != PAYMENT_SETTLEMENT
 *   RECONCILIATION_RETRY != PAYMENT_RETRY
 *
 * A valid return triggers one thing: the readback the payment runtime already
 * trusted. Every verdict below comes from the provider's own state, and the
 * return that caused the look contributes nothing to it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let method: typeof import("../../api/runtime/payment-method");
let route: typeof import("../../api/runtime/payment-route");
let binding: typeof import("../../api/runtime/provider-binding");
let intents: typeof import("../../api/runtime/block3/payment-intents");
let execution: typeof import("../../api/runtime/block3/payment-execution");

const T0 = new Date("2026-09-25T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

const calls: { operation: string }[] = [];
const references = new Map<string, string>();

/** What the provider's own state says when it is read back. */
const provider: {
  readback: "CAPTURED" | "AUTHORIZED" | "FAILED" | "PENDING" | "MISSING" | "UNREACHABLE";
  amountMinor: string;
  currency: string;
  referenceOverride: string | null;
} = {
  readback: "CAPTURED",
  amountMinor: "1000",
  currency: "KWD",
  referenceOverride: null,
};

const AMOUNT = "1000";
const CURRENCY = "KWD";
const CHALLENGE_URL = "https://example.com/psp/challenge/abc";

describe("coming back from a challenge", () => {
  let payerScope: string;
  let payeeScope: string;
  let strangerScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    method = await import("../../api/runtime/payment-method");
    route = await import("../../api/runtime/payment-route");
    binding = await import("../../api/runtime/provider-binding");
    intents = await import("../../api/runtime/block3/payment-intents");
    execution = await import("../../api/runtime/block3/payment-execution");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    const adapter = {
      authenticate: async () => ({ ok: true as const, accountRef: "acct" }),
      discover: async () => ["PAY", "REFUND"] as never,
      invoke: async (
        _context: unknown,
        request: { capability: string; parameters: Record<string, unknown> },
      ) => {
        const operation = String(request.parameters.operation ?? "");
        calls.push({ operation });
        const id = "prov_1";
        if (operation === "AUTHORIZE") {
          references.set(id, String(request.parameters.reference ?? ""));
          // The provider stops and asks the payer to do something.
          return {
            status: "OK" as const,
            value: {
              id, status: method.REQUIRES_ACTION, amountMinor: AMOUNT, currency: CURRENCY,
              reference: references.get(id) ?? "",
            },
          };
        }
        if (operation === "READBACK") {
          if (provider.readback === "UNREACHABLE") {
            return { status: "UNAVAILABLE" as const, detail: "down" };
          }
          if (provider.readback === "MISSING") return { status: "OK" as const, value: null };
          return {
            status: "OK" as const,
            value: {
              id,
              status: provider.readback,
              amountMinor: provider.amountMinor,
              currency: provider.currency,
              reference: provider.referenceOverride ?? references.get(id) ?? "",
            },
          };
        }
        return {
          status: "OK" as const,
          value: {
            id, status: method.REQUIRES_ACTION, amountMinor: AMOUNT, currency: CURRENCY,
            reference: references.get(id) ?? "",
          },
        };
      },
    };
    const base = {
      authMethod: "API_KEY" as const,
      endpoint: { mode: "FIXED" as const, baseUrl: "https://example.com/psp" },
      testOnly: true, adapter, supports: ["PAY", "REFUND"] as const,
    };
    registry.register({ ...base, id: "cc.rail", displayName: "قناة" });
    registry.register({ ...base, id: "cc.other", displayName: "قناة أخرى" });
    binding.setProviderDefinitionRegistry(registry);
  });

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    calls.length = 0;
    references.clear();
    provider.readback = "CAPTURED";
    provider.amountMinor = AMOUNT;
    provider.currency = CURRENCY;
    provider.referenceOverride = null;
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, payment_intents,
        payment_method_references, external_action_sessions, economic_ledger_entries,
        fulfillment_observations, conversation_needs, scope_policies, memberships,
        organizations, events CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'cc-%'`));
    const made: string[] = [];
    for (const name of ["دافع", "مستفيد", "غريب"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `cc-${randomUUID()}`, name, preferences: {} }).returning();
      made.push(String(row!.id));
    }
    [payerScope, payeeScope, strangerScope] = made as [string, string, string];
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  async function connect(scopeId: string, definitionId: string) {
    const opened = await binding.beginProviderSetup({
      principalId: scopeId, scopeId, definitionId, requestedCapabilities: ["PAY"], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: scopeId, material: { apiKey: "k" }, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: scopeId, now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: scopeId, now: at(3 * MINUTE),
    });
    calls.length = 0;
    return opened.bindingId;
  }

  /** Pay until the provider asks for action, then open the challenge. */
  async function payUntilChallenge() {
    const created = await intents.createPaymentIntent(handle.db as never, {
      ownerId: payerScope, payerRef: payerScope, payeeRef: payeeScope,
      amountMinor: AMOUNT, currency: CURRENCY, purpose: "settlement:c1",
      idempotencyKey: `idem_${randomUUID()}`,
    } as never);
    const intent = created.intent;

    let challenge: Awaited<ReturnType<typeof method.openPaymentChallenge>> | null = null;
    const routed = await route.paymentExecutionRoute({
      payable: { payeeRef: payeeScope }, payerScopeId: payerScope,
      onRequiresAction: async (view) => {
        challenge ??= await method.openPaymentChallenge({
          paymentIntentId: intent.id, payerScopeId: payerScope, definitionId: "cc.rail",
          providerReference: view.id, url: CHALLENGE_URL, now: at(5 * MINUTE),
        });
      },
    });
    if (routed.status !== "RESOLVED") throw new Error("no route");
    await execution.executePaymentEffect(handle.db as never, routed.deps, { intentId: intent.id });
    // Stopped, not settled.
    const after = (await intents.getPaymentIntent(handle.db as never, intent.id))!;
    expect(after.status).toBe("INCONCLUSIVE");
    calls.length = 0;
    return { intent, challenge: challenge! };
  }

  const resume = (challenge: { challengeId: string; state: string }, payer = payerScope) =>
    method.resumePaymentAfterChallenge({
      challengeId: challenge.challengeId, state: challenge.state,
      payerScopeId: payer, now: at(6 * MINUTE),
    });

  const statusOf = async (id: string) =>
    (await intents.getPaymentIntent(handle.db as never, id))!.status;

  const count = async (table: string) => {
    const rows = await handle.db.execute(sql.raw(`SELECT count(*)::int n FROM ${table}`));
    return (rows.rows[0] as { n: number }).n;
  };

  // ── A · WHAT THE PROVIDER'S OWN STATE SAYS ───────────────────────────────

  it("a return reconciles, and a captured readback settles", async () => {
    await connect(payeeScope, "cc.rail");
    const { intent, challenge } = await payUntilChallenge();
    const resumed = await resume(challenge);
    expect(resumed.userLeg).toBe("RETURNED");
    expect(resumed.outcome).toBe("RESOLVED_CAPTURED");
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    // It READ. It did not pay again.
    //
    //   CHALLENGE_RETURN_SECOND_PAY_CALL = 0
    expect(calls.map((one) => one.operation)).toEqual(["READBACK"]);
  });

  it("an authorized readback is not a settled payment", async () => {
    //   AUTHORIZED_RETURN_AS_SETTLED = 0
    await connect(payeeScope, "cc.rail");
    provider.readback = "AUTHORIZED";
    const { intent, challenge } = await payUntilChallenge();
    const resumed = await resume(challenge);
    expect(resumed.outcome).toBe("RESOLVED_FAILED");
    expect(await statusOf(intent.id)).not.toBe("SETTLED");
    expect(await statusOf(intent.id)).not.toBe("CAPTURED");
  });

  it("a failed readback is a truthful failure", async () => {
    await connect(payeeScope, "cc.rail");
    provider.readback = "FAILED";
    const { intent, challenge } = await payUntilChallenge();
    expect((await resume(challenge)).outcome).toBe("RESOLVED_FAILED");
    expect(await statusOf(intent.id)).toBe("FAILED");
  });

  it("a pending or missing readback settles nothing and invents nothing", async () => {
    for (const state of ["PENDING", "MISSING"] as const) {
      await handle.db.execute(sql.raw(`TRUNCATE TABLE payment_intents, external_action_sessions,
        scope_provider_bindings, provider_credentials CASCADE`));
      await connect(payeeScope, "cc.rail");
      provider.readback = state;
      const { intent, challenge } = await payUntilChallenge();
      const resumed = await resume(challenge);
      expect(["STILL_INCONCLUSIVE", "DISCREPANCY"], state).toContain(resumed.outcome);
      expect(await statusOf(intent.id), state).toBe("INCONCLUSIVE");
    }
  });

  it("a provider that cannot be reached is not a payment that succeeded", async () => {
    await connect(payeeScope, "cc.rail");
    provider.readback = "UNREACHABLE";
    const { intent, challenge } = await payUntilChallenge();
    await expect(resume(challenge)).rejects.toBeDefined();
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
  });

  it("a readback for other money, or another payment, settles nothing", async () => {
    //   WRONG_AMOUNT_READBACK_SETTLES = 0 · WRONG_CURRENCY_READBACK_SETTLES = 0
    //   WRONG_PROVIDER_REFERENCE_SETTLES = 0
    const cases: [string, () => void][] = [
      ["amount", () => { provider.amountMinor = "1"; }],
      ["currency", () => { provider.currency = "USD"; }],
      ["reference", () => { provider.referenceOverride = "pi_somebody_else"; }],
    ];
    for (const [label, apply] of cases) {
      await handle.db.execute(sql.raw(`TRUNCATE TABLE payment_intents, external_action_sessions,
        scope_provider_bindings, provider_credentials CASCADE`));
      await connect(payeeScope, "cc.rail");
      provider.amountMinor = AMOUNT;
      provider.currency = CURRENCY;
      provider.referenceOverride = null;
      apply();
      const { intent, challenge } = await payUntilChallenge();
      const resumed = await resume(challenge);
      expect(resumed.outcome, label).toBe("DISCREPANCY");
      expect(await statusOf(intent.id), label).toBe("INCONCLUSIVE");
    }
  });

  // ── B · THE RETURN ITSELF ESTABLISHES NOTHING ────────────────────────────

  it("the continuation has nowhere to put a verdict the browser carried", async () => {
    //   RETURN_QUERY_PAYMENT_STATUS_USED = 0 · RETURN_QUERY_AMOUNT_USED = 0
    //   RETURN_QUERY_CURRENCY_USED = 0 · RETURN_QUERY_PAYEE_USED = 0
    //   RETURN_QUERY_PROVIDER_USED = 0
    //   CLIENT_CAN_SWAP_PAYMENT_INTENT_AFTER_CHALLENGE = 0
    //   CLIENT_CAN_SWAP_PROVIDER_REFERENCE_AFTER_CHALLENGE = 0
    //
    // Passing them anyway changes nothing, because nothing reads them. The
    // provider says FAILED and the answer is FAILED, whatever arrived with the
    // person.
    await connect(payeeScope, "cc.rail");
    provider.readback = "FAILED";
    const { intent, challenge } = await payUntilChallenge();
    const smuggled = method.resumePaymentAfterChallenge as unknown as (
      input: Record<string, unknown>,
    ) => Promise<{ outcome: string }>;
    const resumed = await smuggled({
      challengeId: challenge.challengeId, state: challenge.state, payerScopeId: payerScope,
      now: at(6 * MINUTE),
      success: true, status: "paid", amount: "1", currency: "USD",
      payee: strangerScope, provider: "cc.other",
      paymentIntentId: "pi_other", providerReference: "prov_other",
    });
    //   CLIENT_SUCCESS_RETURN_SETTLES = 0
    expect(resumed.outcome).toBe("RESOLVED_FAILED");
    expect(await statusOf(intent.id)).toBe("FAILED");
  });

  it("a browser saying it failed does not fail a payment the provider captured", async () => {
    //   CLIENT_FAILURE_RETURN_FORCES_FAILURE = 0
    await connect(payeeScope, "cc.rail");
    provider.readback = "CAPTURED";
    const { intent, challenge } = await payUntilChallenge();
    const smuggled = method.resumePaymentAfterChallenge as unknown as (
      input: Record<string, unknown>,
    ) => Promise<{ outcome: string }>;
    const resumed = await smuggled({
      challengeId: challenge.challengeId, state: challenge.state, payerScopeId: payerScope,
      now: at(6 * MINUTE), success: false, status: "failed",
    });
    expect(resumed.outcome).toBe("RESOLVED_CAPTURED");
    expect(await statusOf(intent.id)).toBe("CAPTURED");
  });

  it("a wrong state, a wrong payer and an expired challenge are all refused", async () => {
    await connect(payeeScope, "cc.rail");
    const { challenge } = await payUntilChallenge();
    await expect(
      method.resumePaymentAfterChallenge({
        challengeId: challenge.challengeId, state: "pch_guessed",
        payerScopeId: payerScope, now: at(6 * MINUTE),
      }),
    ).rejects.toBeDefined();
    await expect(resume(challenge, strangerScope)).rejects.toBeDefined();
    await expect(
      method.resumePaymentAfterChallenge({
        challengeId: challenge.challengeId, state: challenge.state,
        payerScopeId: payerScope, now: at(60 * MINUTE),
      }),
    ).rejects.toBeDefined();
    // Not one of them reached the provider.
    expect(calls).toHaveLength(0);
  });

  it("a replayed return does not reconcile a second time", async () => {
    //   CHALLENGE_REPLAY_TRIGGERS_SECOND_RECONCILIATION = 0
    await connect(payeeScope, "cc.rail");
    const { challenge } = await payUntilChallenge();
    await resume(challenge);
    expect(calls.filter((one) => one.operation === "READBACK")).toHaveLength(1);
    await expect(resume(challenge)).rejects.toBeDefined();
    expect(calls.filter((one) => one.operation === "READBACK")).toHaveLength(1);
  });

  // ── C · THE RETURN IS ONLY A CONVENIENCE ─────────────────────────────────

  it("truth can be established without anybody coming back", async () => {
    //   BROWSER_RETURN_REQUIRED_FOR_PAYMENT_TRUTH = NO
    await connect(payeeScope, "cc.rail");
    const { intent } = await payUntilChallenge();
    // Nobody returns. The server reconciles on its own, through the same door.
    const routed = await route.paymentExecutionRoute({
      payable: { payeeRef: payeeScope }, payerScopeId: payerScope,
    });
    if (routed.status !== "RESOLVED") throw new Error("no route");
    const reconciled = await execution.reconcilePaymentEffect(handle.db as never, routed.deps, {
      intentId: intent.id,
    });
    expect(reconciled.outcome).toBe("RESOLVED_CAPTURED");
    expect(await statusOf(intent.id)).toBe("CAPTURED");
  });

  it("a provider event that won first is not undone by a later return", async () => {
    //   RETURN_AFTER_WEBHOOK_DUPLICATES_EFFECT = 0
    //   STALE_PRE_CHALLENGE_STATE_OVERWRITES_CURRENT_PAYMENT = 0
    await connect(payeeScope, "cc.rail");
    const { intent, challenge } = await payUntilChallenge();
    // The provider settled it before the person got back.
    const routed = await route.paymentExecutionRoute({
      payable: { payeeRef: payeeScope }, payerScopeId: payerScope,
    });
    if (routed.status !== "RESOLVED") throw new Error("no route");
    await execution.reconcilePaymentEffect(handle.db as never, routed.deps, { intentId: intent.id });
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    const ledgerBefore = await count("economic_ledger_entries");
    calls.length = 0;

    const resumed = await resume(challenge);
    // Nothing to reconcile, nothing undone, and no second financial effect.
    expect(resumed.outcome).toBe("STILL_INCONCLUSIVE");
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    expect(await count("economic_ledger_entries")).toBe(ledgerBefore);
  });

  it("a route that now points elsewhere is a refusal to look, not a verdict", async () => {
    //   RETURN_PROVIDER_REFERENCE_SWAP = 0
    await connect(payeeScope, "cc.rail");
    const { intent, challenge } = await payUntilChallenge();
    // The payee swaps rails between execution and return.
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials CASCADE`),
    );
    await connect(payeeScope, "cc.other");
    const resumed = await resume(challenge);
    expect(resumed.outcome).toBe("PROVIDER_CHANGED");
    // The other provider was never read to settle this payment.
    expect(calls.filter((one) => one.operation === "READBACK")).toHaveLength(0);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
  });

  it("a revoked rail leaves the payment truthfully unresolved", async () => {
    await connect(payeeScope, "cc.rail");
    const { intent, challenge } = await payUntilChallenge();
    const [row] = (
      await handle.db.execute(sql.raw(`SELECT id FROM scope_provider_bindings LIMIT 1`))
    ).rows as { id: string }[];
    await binding.revokeBinding({ bindingId: row!.id, principalId: payeeScope, now: at(5 * MINUTE) });
    const resumed = await resume(challenge);
    expect(resumed.outcome).toBe("NO_ROUTE");
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
  });

  // ── D · SETTLING IS STILL NOT FINISHING ──────────────────────────────────

  it("a reconciled settlement fulfils no transaction and resolves no need", async () => {
    //   RECONCILED_PAYMENT_AUTO_FULFILLS_TRANSACTION = 0
    //   RECONCILED_PAYMENT_AUTO_RESOLVES_NEED = 0
    await connect(payeeScope, "cc.rail");
    const { intent, challenge } = await payUntilChallenge();
    await resume(challenge);
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    expect(await count("fulfillment_observations")).toBe(0);
    expect(await count("conversation_needs")).toBe(0);
    expect(await count("transactions")).toBe(0);
  });

  it("no new payment, and no new attempt, comes out of a return", async () => {
    //   CHALLENGE_RETURN_CREATES_NEW_PAYMENT_INTENT = 0
    //   CHALLENGE_RETURN_CREATES_NEW_EXECUTION_ATTEMPT = 0
    await connect(payeeScope, "cc.rail");
    const { intent, challenge } = await payUntilChallenge();
    const before = await count("payment_intents");
    const resumed = await resume(challenge);
    expect(await count("payment_intents")).toBe(before);
    expect(resumed.paymentIntentId).toBe(intent.id);
    expect(calls.filter((one) => one.operation === "AUTHORIZE")).toHaveLength(0);
    expect(calls.filter((one) => one.operation === "CAPTURE")).toHaveLength(0);
  });
});
