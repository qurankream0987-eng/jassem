/**
 * JASIM — A PAYMENT PROVIDER IS A PROVIDER.
 *
 *   NO_CANONICAL_SETTLEMENT_OBLIGATION → NO_EXECUTABLE_PAYMENT_PATH
 *   MODEL != PAYMENT AUTHORITY · MODEL != PAYMENT ROUTE AUTHORITY
 *   PROVIDER_PAY_CAPABILITY != AUTHORITY_TO_PAY
 *   PAYMENT_INTENT != PAYMENT_EXECUTION
 *   PROVIDER_SUCCESS != VERIFIED_PAYMENT · PAYMENT != FULFILLMENT
 *
 * No real money is moved anywhere in this file. The provider is a fixture in a
 * registry built to hold fixtures, and the production registry stays empty.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let route: typeof import("../../api/runtime/payment-route");
let binding: typeof import("../../api/runtime/provider-binding");
let intents: typeof import("../../api/runtime/block3/payment-intents");
let execution: typeof import("../../api/runtime/block3/payment-execution");
let resolution: typeof import("../../api/runtime/source-resolution");
let scopes: typeof import("../../api/runtime/actor-scope");

const T0 = new Date("2026-09-25T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

/** Every provider operation that actually happened. */
const calls: { operation: string; capability: string; parameters: Record<string, unknown> }[] = [];

/** What the fixture does next. The runtime never reads this. */
const references = new Map<string, string>();

const provider: {
  mode: "CAPTURE" | "AUTHORIZE_ONLY" | "REJECT" | "LOST" | "WRONG_AMOUNT" | "WRONG_CURRENCY";
} = { mode: "CAPTURE" };

const AMOUNT = "1000";
const CURRENCY = "KWD";

describe("paying through a general provider binding", () => {
  let payerScope: string;
  let payeeScope: string;
  let outsiderScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    route = await import("../../api/runtime/payment-route");
    binding = await import("../../api/runtime/provider-binding");
    intents = await import("../../api/runtime/block3/payment-intents");
    execution = await import("../../api/runtime/block3/payment-execution");
    resolution = await import("../../api/runtime/source-resolution");
    scopes = await import("../../api/runtime/actor-scope");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    const adapter = {
      authenticate: async () => ({ ok: true as const, accountRef: "acct" }),
      discover: async () => ["PAY", "REFUND", "READ"] as never,
      invoke: async (
        _context: unknown,
        request: { capability: string; parameters: Record<string, unknown> },
      ) => {
        const operation = String(request.parameters.operation ?? "");
        calls.push({ operation, capability: request.capability, parameters: request.parameters });
        if (provider.mode === "REJECT") {
          return { status: "ERROR" as const, detail: "card declined" };
        }
        if (provider.mode === "LOST") {
          // The dangerous one: it may have landed.
          return { status: "UNAVAILABLE" as const, detail: "transport lost" };
        }
        const amountMinor =
          provider.mode === "WRONG_AMOUNT" ? "1" : String(request.parameters.amountMinor ?? AMOUNT);
        const currency =
          provider.mode === "WRONG_CURRENCY" ? "USD" : String(request.parameters.currency ?? CURRENCY);
        const status =
          operation === "AUTHORIZE"
            ? "AUTHORIZED"
            : provider.mode === "AUTHORIZE_ONLY"
              ? "AUTHORIZED"
              : "CAPTURED";
        // A real provider echoes the reference it was given, on every later
        // view of the same payment. Without that, nothing binds a receipt to
        // the payment it is a receipt FOR.
        const id = "prov_pay_1";
        if (operation === "AUTHORIZE") {
          references.set(id, String(request.parameters.reference ?? ""));
        }
        return {
          status: "OK" as const,
          value: { id, status, amountMinor, currency, reference: references.get(id) ?? "" },
        };
      },
    };
    const base = {
      authMethod: "API_KEY" as const,
      endpoint: { mode: "FIXED" as const, baseUrl: "https://example.com/psp" },
      testOnly: true,
      adapter,
    };
    registry.register({
      ...base, id: "pp.rail", displayName: "قناة دفع", supports: ["PAY", "REFUND", "READ"],
      observes: ["availability"],
    });
    registry.register({
      ...base, id: "pp.other", displayName: "قناة أخرى", supports: ["PAY", "REFUND"],
    });
    // Supports PAY. A binding of it may still not be GRANTED pay.
    registry.register({
      ...base, id: "pp.reader", displayName: "قارئ", supports: ["PAY", "READ"],
      observes: ["availability"],
    });
    binding.setProviderDefinitionRegistry(registry);
  });

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    calls.length = 0;
    references.clear();
    provider.mode = "CAPTURE";
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, payment_intents,
        economic_ledger_entries, observations, scope_policies, memberships, organizations,
        transactions, commitments, agreements, events CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'pp-%'`));
    const made: string[] = [];
    for (const name of ["دافع", "مستفيد", "غريب"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `pp-${randomUUID()}`, name, preferences: {} }).returning();
      made.push(String(row!.id));
    }
    [payerScope, payeeScope, outsiderScope] = made as [string, string, string];
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  async function connect(scopeId: string, definitionId: string, granted: string[]) {
    const opened = await binding.beginProviderSetup({
      principalId: scopeId, scopeId, definitionId, requestedCapabilities: granted, now: T0,
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

  const payable = () => ({ payeeRef: payeeScope });

  async function anIntent(over: Record<string, unknown> = {}) {
    const created = await intents.createPaymentIntent(handle.db as never, {
      ownerId: payerScope, payerRef: payerScope, payeeRef: payeeScope,
      amountMinor: AMOUNT, currency: CURRENCY, purpose: "settlement:c1",
      idempotencyKey: `idem_${randomUUID()}`,
      ...over,
    } as never);
    return created.intent;
  }

  async function execute(intentId: string) {
    const routed = await route.paymentExecutionRoute({ payable: payable(), payerScopeId: payerScope });
    if (routed.status !== "RESOLVED") throw new Error(`no route: ${routed.status}`);
    return execution.executePaymentEffect(handle.db as never, routed.deps, { intentId });
  }

  const statusOf = async (id: string) =>
    (await intents.getPaymentIntent(handle.db as never, id))!.status;

  // ── A · NO ROUTE IS NOT A PAYMENT ────────────────────────────────────────

  it("with no verified payment provider, nothing is charged and nothing pretends", async () => {
    //   NO_PROVIDER_FAKE_PAYMENT_SUCCESS = 0
    const resolved = await route.resolvePaymentRoute({ payable: payable(), payerScopeId: payerScope });
    expect(resolved.status).toBe("NO_ROUTE");
    expect(calls).toHaveLength(0);
  });

  it("a binding that is not verified is not a route", async () => {
    //   UNVERIFIED_PAY_BINDING_USED = 0
    const opened = await binding.beginProviderSetup({
      principalId: payeeScope, scopeId: payeeScope, definitionId: "pp.rail",
      requestedCapabilities: ["PAY"], now: T0,
    });
    for (const advance of [null, "credential", "authenticate"] as const) {
      if (advance === "credential") {
        await binding.completeProviderSetup({
          bindingId: opened.bindingId, principalId: payeeScope,
          material: { apiKey: "k" }, now: at(MINUTE),
        });
      } else if (advance === "authenticate") {
        await binding.authenticateBinding({
          bindingId: opened.bindingId, principalId: payeeScope, now: at(2 * MINUTE),
        });
      }
      const resolved = await route.resolvePaymentRoute({
        payable: payable(), payerScopeId: payerScope,
      });
      expect(resolved.status, String(advance)).toBe("NO_ROUTE");
    }
  });

  it("a binding that supports PAY but was not granted PAY is not a route", async () => {
    //   SUPPORTED_PAY_EQUALS_GRANTED_PAY = NO · UNGRANTED_PAY_PROVIDER_CALL = 0
    await connect(payeeScope, "pp.reader", ["READ"]);
    const resolved = await route.resolvePaymentRoute({ payable: payable(), payerScopeId: payerScope });
    expect(resolved.status).toBe("NO_ROUTE");
    expect(calls).toHaveLength(0);
  });

  it("a revoked binding is not a route", async () => {
    //   REVOKED_PAY_BINDING_USED = 0
    const id = await connect(payeeScope, "pp.rail", ["PAY"]);
    await binding.revokeBinding({ bindingId: id, principalId: payeeScope, now: at(4 * MINUTE) });
    const resolved = await route.resolvePaymentRoute({ payable: payable(), payerScopeId: payerScope });
    expect(resolved.status).toBe("NO_ROUTE");
  });

  it("a stranger's payment provider is never a route for this settlement", async () => {
    //   CROSS_SCOPE_PAY_PROVIDER = 0
    await connect(outsiderScope, "pp.rail", ["PAY"]);
    const resolved = await route.resolvePaymentRoute({ payable: payable(), payerScopeId: payerScope });
    expect(resolved.status).toBe("NO_ROUTE");
    expect(calls).toHaveLength(0);
  });

  it("two possible rails is an ambiguity, not a race", async () => {
    //   MULTIPLE_PAYMENT_PROVIDER_LATEST_WINS = 0
    await connect(payeeScope, "pp.rail", ["PAY"]);
    await connect(payerScope, "pp.other", ["PAY"]);
    const resolved = await route.resolvePaymentRoute({ payable: payable(), payerScopeId: payerScope });
    expect(resolved.status).toBe("AMBIGUOUS_ROUTE");
    expect(calls).toHaveLength(0);

    // The payer settles which SIDE carries their money. They still change no
    // payee, no amount and no currency.
    await scopes.setScopePolicy({
      principalId: payerScope, scopeId: payerScope,
      policyKey: route.PAYMENT_ROUTE_POLICY_KEY, value: { side: "PAYEE" },
    });
    const settled = await route.resolvePaymentRoute({ payable: payable(), payerScopeId: payerScope });
    expect(settled.status).toBe("RESOLVED");
    expect(settled.status === "RESOLVED" && settled.route.side).toBe("PAYEE");
  });

  // ── B · EXECUTION ────────────────────────────────────────────────────────

  it("one settlement, one provider execution, and truth from readback", async () => {
    await connect(payeeScope, "pp.rail", ["PAY"]);
    const intent = await anIntent();
    const done = await execute(intent.id);
    expect(done.outcome).toBe("CAPTURED");
    // Authorize, capture, readback — through PAY, never through a read door.
    expect(calls.map((one) => one.operation)).toEqual(["AUTHORIZE", "CAPTURE", "READBACK"]);
    expect(calls.every((one) => one.capability === "PAY")).toBe(true);
    // The canonical amount and currency, reconstructed from the intent.
    expect(calls[0]!.parameters.amountMinor).toBe(AMOUNT);
    expect(calls[0]!.parameters.currency).toBe(CURRENCY);
  });

  it("the provider's own payment id never becomes the canonical one", async () => {
    //   PROVIDER_PAYMENT_ID != JASIM_PAYMENT_INTENT_ID
    await connect(payeeScope, "pp.rail", ["PAY"]);
    const intent = await anIntent();
    await execute(intent.id);
    const after = (await intents.getPaymentIntent(handle.db as never, intent.id))!;
    expect(after.id).toBe(intent.id);
    expect(after.providerReference).toBe("prov_pay_1");
    // And the rail is pinned by definition id, so a settlement cannot finish
    // on a different provider than it started on.
    expect(after.providerRef).toBe("pp.rail");
  });

  it("authorized is not settled", async () => {
    //   AUTHORIZED_AS_SETTLED = 0
    provider.mode = "AUTHORIZE_ONLY";
    await connect(payeeScope, "pp.rail", ["PAY"]);
    const intent = await anIntent();
    const done = await execute(intent.id);
    expect(done.outcome).not.toBe("CAPTURED");
    expect(await statusOf(intent.id)).not.toBe("SETTLED");
    expect(await statusOf(intent.id)).not.toBe("CAPTURED");
  });

  it("a receipt for another amount or another currency settles nothing", async () => {
    //   WRONG_AMOUNT_RECEIPT_SETTLES = 0 · WRONG_CURRENCY_RECEIPT_SETTLES = 0
    for (const mode of ["WRONG_AMOUNT", "WRONG_CURRENCY"] as const) {
      await handle.db.execute(sql.raw(`TRUNCATE TABLE payment_intents CASCADE`));
      await handle.db.execute(sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials CASCADE`));
      await connect(payeeScope, "pp.rail", ["PAY"]);
      provider.mode = mode;
      const intent = await anIntent();
      const done = await execute(intent.id);
      expect(done.outcome, mode).not.toBe("CAPTURED");
      expect(await statusOf(intent.id), mode).not.toBe("SETTLED");
    }
  });

  it("a definitive refusal is a truthful failure, never a success", async () => {
    //   PROVIDER_FAILURE != PAYMENT_SUCCESS
    provider.mode = "REJECT";
    await connect(payeeScope, "pp.rail", ["PAY"]);
    const intent = await anIntent();
    await expect(execute(intent.id)).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
    expect(await statusOf(intent.id)).toBe("FAILED");
  });

  it("a lost response never becomes a second charge", async () => {
    //   LOST_RESPONSE_SECOND_CHARGE = 0
    //   AMBIGUOUS_NETWORK_FAILURE_BLIND_RECHARGE = 0
    provider.mode = "LOST";
    await connect(payeeScope, "pp.rail", ["PAY"]);
    const intent = await anIntent();
    const first = await execute(intent.id).catch((error: unknown) => error);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    const authorizeCalls = calls.filter((one) => one.operation === "AUTHORIZE").length;
    expect(authorizeCalls).toBe(1);

    // Asking again does NOT authorize again. The effect is unknown, and an
    // unknown effect is reconciled, never repeated.
    provider.mode = "CAPTURE";
    await execute(intent.id);
    expect(calls.filter((one) => one.operation === "AUTHORIZE")).toHaveLength(1);
    expect(first).toBeDefined();
  });

  it("two simultaneous payments make one provider execution, through durable state", async () => {
    //   DUPLICATE_PAYMENT_EXECUTION = 0 · CROSS_PROCESS_PAYMENT_REPLAY = 0
    //
    // The claim is an optimistic-lock transition on the intent row, so it
    // holds across processes — not a map in one of them.
    //
    //   PROCESS_LOCAL_ONLY_PAYMENT_LOCK = 0
    await connect(payeeScope, "pp.rail", ["PAY"]);
    const intent = await anIntent();
    const together = await Promise.allSettled([1, 2, 3, 4, 5].map(() => execute(intent.id)));
    expect(together.some((one) => one.status === "fulfilled")).toBe(true);
    expect(calls.filter((one) => one.operation === "AUTHORIZE")).toHaveLength(1);
  });

  // ── C · WHAT A PAYMENT IS NOT ────────────────────────────────────────────

  it("a settled payment fulfils no transaction and resolves no need", async () => {
    //   PAYMENT_SETTLEMENT_AUTO_FULFILLS_TRANSACTION = 0
    //   PAYMENT_SETTLEMENT_AUTO_RESOLVES_NEED = 0
    await connect(payeeScope, "pp.rail", ["PAY"]);
    const intent = await anIntent();
    await execute(intent.id);
    // The payment moved. Nothing else did.
    const fulfilments = await handle.db.execute(
      sql.raw(`SELECT count(*)::int n FROM fulfillment_observations`),
    );
    expect((fulfilments.rows[0] as { n: number }).n).toBe(0);
    const needs = await handle.db.execute(sql.raw(`SELECT count(*)::int n FROM conversation_needs`));
    expect((needs.rows[0] as { n: number }).n).toBe(0);
  });

  it("paying is not reading, and the fact runtime cannot reach PAY", async () => {
    //   PAY_IN_SOURCE_RESOLUTION = 0 · PAY_ADDED_TO_FACT_CAPABILITIES = 0
    expect([...resolution.FACT_CAPABILITIES]).toEqual(["READ", "OBSERVE"]);
    expect(resolution.FACT_CAPABILITIES).not.toContain("PAY");
    // The mutation door refuses a reading capability, and the read door
    // refuses a mutating one. Neither can do the other's job.
    const id = await connect(payeeScope, "pp.rail", ["PAY", "READ"]);
    const wrongDoor = await binding.invokeThroughBinding({
      bindingId: id, onBehalfOfScopeId: payeeScope, capability: "READ", now: at(5 * MINUTE),
    });
    expect(wrongDoor.status).toBe("REFUSED");
    const otherDoor = await binding.readThroughBinding({
      bindingId: id, fact: { subjectKind: "offering", subjectId: "x" },
      capability: "PAY" as never, now: at(5 * MINUTE),
    });
    expect(otherDoor.status).toBe("REFUSED");
    expect(calls).toHaveLength(0);
  });

  it("the mutation door refuses a binding of a scope the caller did not derive", async () => {
    const id = await connect(outsiderScope, "pp.rail", ["PAY"]);
    const outcome = await binding.invokeThroughBinding({
      bindingId: id, onBehalfOfScopeId: payeeScope, capability: "PAY", now: at(5 * MINUTE),
    });
    expect(outcome.status).toBe("REFUSED");
    expect(outcome.status === "REFUSED" && outcome.refusal).toBe("NO_SUCH_BINDING");
    expect(calls).toHaveLength(0);
  });

  // ── D · REFUND ───────────────────────────────────────────────────────────

  it("a refund runs on the REFUND capability of the same general binding", async () => {
    //   REFUND_USES_GENERAL_PROVIDER_BINDING
    await connect(payeeScope, "pp.rail", ["PAY", "REFUND"]);
    const intent = await anIntent();
    await execute(intent.id);
    calls.length = 0;
    const routed = await route.paymentExecutionRoute({
      payable: payable(), payerScopeId: payerScope,
    });
    if (routed.status !== "RESOLVED") throw new Error("no route");
    await execution.refundPaymentEffect(handle.db as never, routed.deps, {
      intentId: intent.id, idempotencyKey: "rf_1",
    });
    expect(calls.map((one) => one.operation)).toContain("REFUND");
    expect(calls.find((one) => one.operation === "REFUND")!.capability).toBe("REFUND");
  });

  it("a binding without REFUND granted cannot refund", async () => {
    await connect(payeeScope, "pp.rail", ["PAY"]);
    const intent = await anIntent();
    await execute(intent.id);
    calls.length = 0;
    const routed = await route.paymentExecutionRoute({
      payable: payable(), payerScopeId: payerScope,
    });
    if (routed.status !== "RESOLVED") throw new Error("no route");
    await expect(
      execution.refundPaymentEffect(handle.db as never, routed.deps, {
        intentId: intent.id, idempotencyKey: "rf_2",
      }),
    ).rejects.toBeDefined();
    expect(calls.filter((one) => one.operation === "REFUND")).toHaveLength(0);
  });

  // ── E · GENERALITY ───────────────────────────────────────────────────────

  it("six unrelated settlements pay through the same runtime", async () => {
    //   DOMAIN_PAYMENT_HANDLERS_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
    await connect(payeeScope, "pp.rail", ["PAY"]);
    const purposes = [
      "settlement:offered.unit",
      "settlement:service.hour",
      "settlement:place.slot",
      "settlement:equipment.run",
      "settlement:volume.space",
      "settlement:لا.يعرفه.أحد",
    ];
    for (const purpose of purposes) {
      const intent = await anIntent({ purpose, idempotencyKey: `idem_${randomUUID()}` });
      const done = await execute(intent.id);
      expect(done.outcome, purpose).toBe("CAPTURED");
    }
    expect(calls.filter((one) => one.operation === "AUTHORIZE")).toHaveLength(purposes.length);
  });

  it("the production registry holds no payment provider", async () => {
    //   PRODUCTION_FAKE_PAYMENT_PROVIDER = 0 · REAL_MONEY_TEST_CHARGE = 0
    expect(binding.providerDefinitions.list()).toHaveLength(0);
  });
});
