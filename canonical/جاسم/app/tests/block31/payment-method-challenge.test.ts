/**
 * JASIM — THE PAYER'S INSTRUMENT, AND THE PROVIDER ASKING FOR MORE.
 *
 *   PROVIDER_BINDING_CREDENTIAL != CUSTOMER_PAYMENT_METHOD
 *   RAW_PAYMENT_CREDENTIAL != PAYMENT_METHOD_REFERENCE != PAYMENT_AUTHORITY
 *   CHALLENGE_CREATED != CHALLENGE_COMPLETED != PAYMENT_SETTLED
 *   BROWSER_RETURN != PAYMENT_PROOF · SURFACE_CLOSED != PAYMENT_CANCELLED
 *
 * Five structurally different providers: one that funds itself, one wanting a
 * one-time token, one allowing a saved instrument, one that stops to ask the
 * payer, and one whose challenge is shaped like nothing else. One runtime.
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
let methods: typeof import("../../api/runtime/block3/payment-methods");
let intents: typeof import("../../api/runtime/block3/payment-intents");
let execution: typeof import("../../api/runtime/block3/payment-execution");
let actions: typeof import("../../api/runtime/product-actions");

const T0 = new Date("2026-09-25T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

const calls: { operation: string; parameters: Record<string, unknown> }[] = [];
const references = new Map<string, string>();
const behaviour: { requiresAction: boolean } = { requiresAction: false };

const AMOUNT = "1000";
const CURRENCY = "KWD";
const CHALLENGE_URL = "https://example.com/psp/challenge/abc";

describe("the payer's instrument and the provider's challenge", () => {
  let payerScope: string;
  let payeeScope: string;
  let strangerScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    method = await import("../../api/runtime/payment-method");
    route = await import("../../api/runtime/payment-route");
    binding = await import("../../api/runtime/provider-binding");
    methods = await import("../../api/runtime/block3/payment-methods");
    intents = await import("../../api/runtime/block3/payment-intents");
    execution = await import("../../api/runtime/block3/payment-execution");
    actions = await import("../../api/runtime/product-actions");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    const adapter = {
      authenticate: async () => ({ ok: true as const, accountRef: "acct" }),
      discover: async () => ["PAY", "REFUND"] as never,
      invoke: async (
        _context: unknown,
        request: { capability: string; parameters: Record<string, unknown> },
      ) => {
        const operation = String(request.parameters.operation ?? "");
        calls.push({ operation, parameters: request.parameters });
        const id = "prov_1";
        if (operation === "AUTHORIZE") {
          references.set(id, String(request.parameters.reference ?? ""));
        }
        const status =
          behaviour.requiresAction && operation !== "READBACK"
            ? method.REQUIRES_ACTION
            : operation === "AUTHORIZE"
              ? "AUTHORIZED"
              : "CAPTURED";
        return {
          status: "OK" as const,
          value: {
            id, status, amountMinor: AMOUNT, currency: CURRENCY,
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
    // A · funds itself. Asks nobody for anything.
    registry.register({ ...base, id: "pm.selffunded", displayName: "رصيد" });
    // B/C · wants the payer's instrument.
    registry.register({ ...base, id: "pm.instrument", displayName: "قناة", paymentMethod: "REQUIRED" });
    // D/E · wants the instrument AND stops to ask the payer.
    registry.register({ ...base, id: "pm.asks", displayName: "قناة تسأل", paymentMethod: "REQUIRED" });
    binding.setProviderDefinitionRegistry(registry);
  });

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    calls.length = 0;
    references.clear();
    behaviour.requiresAction = false;
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, payment_intents,
        payment_method_references, external_action_sessions, economic_ledger_entries,
        product_action_sessions, scope_policies, memberships, organizations, events CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'pm-%'`));
    const made: string[] = [];
    for (const name of ["دافع", "مستفيد", "غريب"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `pm-${randomUUID()}`, name, preferences: {} }).returning();
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

  const routeFor = (definitionId: string) => ({ definitionId });

  async function saveMethod(ownerId: string, provider: string, tokenRef = `tok_${randomUUID()}`) {
    return methods.createPaymentMethodReference(handle.db as never, {
      ownerId, provider, methodType: "card", tokenRef,
      provenance: { source: "TRUSTED_SURFACE" },
    });
  }

  async function anIntent() {
    const created = await intents.createPaymentIntent(handle.db as never, {
      ownerId: payerScope, payerRef: payerScope, payeeRef: payeeScope,
      amountMinor: AMOUNT, currency: CURRENCY, purpose: "settlement:c1",
      idempotencyKey: `idem_${randomUUID()}`,
    } as never);
    return created.intent;
  }

  const resolve = (definitionId: string, requestedMethodRef?: string) =>
    method.resolveMethodForRoute({
      payerScopeId: payerScope, principalId: payerScope, route: routeFor(definitionId),
      ...(requestedMethodRef ? { requestedMethodRef } : {}), now: at(5 * MINUTE),
    });

  // ── A · NOT EVERY PROVIDER WANTS A CARD ──────────────────────────────────

  it("a provider that funds itself asks for no instrument and no surface", async () => {
    //   PAY_PROVIDER != ALWAYS_REQUIRES_CARD · NO_METHOD_PROVIDER_REGRESSION = 0
    expect(method.methodRequirementFor("pm.selffunded")).toBe("NONE");
    expect((await resolve("pm.selffunded")).status).toBe("NOT_REQUIRED");

    // And it still pays, exactly as it did before this phase existed.
    await connect(payeeScope, "pm.selffunded");
    const intent = await anIntent();
    const routed = await route.paymentExecutionRoute({
      payable: { payeeRef: payeeScope }, payerScopeId: payerScope,
    });
    if (routed.status !== "RESOLVED") throw new Error("no route");
    const done = await execution.executePaymentEffect(handle.db as never, routed.deps, {
      intentId: intent.id,
    });
    expect(done.outcome).toBe("CAPTURED");
    // Nothing was ever asked of the payer.
    expect(calls.every((one) => one.parameters.paymentMethodToken === undefined)).toBe(true);
  });

  // ── B · WHEN ONE IS NEEDED ───────────────────────────────────────────────

  it("a provider that needs an instrument says so, and nothing is charged until there is one", async () => {
    expect(method.methodRequirementFor("pm.instrument")).toBe("REQUIRED");
    const resolved = await resolve("pm.instrument");
    expect(resolved.status).toBe("SETUP_REQUIRED");
    expect(calls).toHaveLength(0);
  });

  it("one eligible instrument resolves; several is a selection, not a guess", async () => {
    const first = await saveMethod(payerScope, "pm.instrument");
    const one = await resolve("pm.instrument");
    expect(one.status === "RESOLVED" && one.methodRef).toBe(first.id);

    await saveMethod(payerScope, "pm.instrument");
    const several = await resolve("pm.instrument");
    expect(several.status).toBe("SELECTION_REQUIRED");
    // What a person is shown carries no token.
    const shown = JSON.stringify(several.status === "SELECTION_REQUIRED" ? several.options : []);
    expect(shown).not.toContain("tok_");
    expect(shown).not.toContain("tokenRef");
  });

  it("the instrument reaches the provider as an opaque token and nothing else", async () => {
    await connect(payeeScope, "pm.instrument");
    const saved = await saveMethod(payerScope, "pm.instrument", "tok_opaque_1");
    const resolved = await resolve("pm.instrument");
    if (resolved.status !== "RESOLVED") throw new Error("not resolved");
    const token = await method.tokenForMethod({
      methodRef: resolved.methodRef, payerScopeId: payerScope, definitionId: "pm.instrument",
    });
    expect(token).toBe("tok_opaque_1");

    const intent = await anIntent();
    const routed = await route.paymentExecutionRoute({
      payable: { payeeRef: payeeScope }, payerScopeId: payerScope, paymentMethodToken: token!,
    });
    if (routed.status !== "RESOLVED") throw new Error("no route");
    await execution.executePaymentEffect(handle.db as never, routed.deps, { intentId: intent.id });
    const authorize = calls.find((one) => one.operation === "AUTHORIZE")!;
    expect(authorize.parameters.paymentMethodToken).toBe("tok_opaque_1");
    // The canonical money is still canonical. The instrument changed nothing.
    expect(authorize.parameters.amountMinor).toBe(AMOUNT);
    expect(authorize.parameters.currency).toBe(CURRENCY);
    expect(saved.id).toBeTruthy();
  });

  // ── C/D · WHOSE INSTRUMENT, AND WHOSE PROVIDER ───────────────────────────

  it("another payer's instrument cannot be used by guessing its reference", async () => {
    //   CROSS_SCOPE_PAYMENT_METHOD_USE = 0
    const theirs = await saveMethod(strangerScope, "pm.instrument");
    const resolved = await resolve("pm.instrument", theirs.id);
    expect(resolved.status).toBe("SETUP_REQUIRED");
    expect(
      await method.tokenForMethod({
        methodRef: theirs.id, payerScopeId: payerScope, definitionId: "pm.instrument",
      }),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("an instrument minted by one provider is meaningless to another", async () => {
    //   CROSS_PROVIDER_PAYMENT_METHOD_USE = 0
    const mine = await saveMethod(payerScope, "pm.instrument");
    const elsewhere = await resolve("pm.asks", mine.id);
    expect(elsewhere.status).toBe("SETUP_REQUIRED");
    expect(
      await method.tokenForMethod({
        methodRef: mine.id, payerScopeId: payerScope, definitionId: "pm.asks",
      }),
    ).toBeNull();
  });

  it("a revoked or lapsed instrument is not an instrument", async () => {
    const mine = await saveMethod(payerScope, "pm.instrument");
    await methods.deactivatePaymentMethodReference(handle.db as never, {
      ownerId: payerScope, id: mine.id,
    });
    expect((await resolve("pm.instrument", mine.id)).status).toBe("SETUP_REQUIRED");

    const lapsing = await methods.createPaymentMethodReference(handle.db as never, {
      ownerId: payerScope, provider: "pm.instrument", methodType: "card",
      tokenRef: `tok_${randomUUID()}`, provenance: { source: "TRUSTED_SURFACE" },
      expiresAt: at(MINUTE),
    });
    expect((await resolve("pm.instrument", lapsing.id)).status).toBe("SETUP_REQUIRED");
  });

  // ── E · THE TRUSTED SURFACE ──────────────────────────────────────────────

  it("the surface that collects an instrument has no field for card data", async () => {
    //   CARD_NUMBER_IN_MODEL_CONTEXT = 0 · CVV_IN_MODEL_CONTEXT = 0
    const add = actions.getProductAction("payment.method.add")!;
    const keys = add.fields.map((field) => field.key);
    for (const forbidden of ["pan", "cardNumber", "cvv", "cvc", "pin", "expiry", "password"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    // The only sensitive field is the provider's own token.
    expect(actions.sensitiveFieldsOf(add)).toEqual(["providerToken"]);
    expect(add.reauthentication).toBe(true);
    expect(add.idempotency).toBe("SINGLE_USE");
    // And the presentation carries no value, so nothing prefills it.
    expect(JSON.stringify(actions.presentationFor(add))).not.toContain("value");
  });

  it("card-shaped data is refused even through the trusted surface", async () => {
    //   RAW_PAYMENT_CREDENTIAL_IN_DB = 0
    for (const attempt of ["4242424242424242", "4111 1111 1111 1111"]) {
      await expect(
        saveMethod(payerScope, "pm.instrument", attempt),
      ).rejects.toBeDefined();
    }
    const rows = await handle.db.execute(
      sql.raw(`SELECT count(*)::int n FROM payment_method_references`),
    );
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("keeping an instrument is a separate answer from paying with it once", async () => {
    //   ONE_TIME_METHOD != REUSABLE_METHOD
    //   PAYMENT_AUTHORIZATION != FUTURE_CHARGE_AUTHORIZATION
    const add = actions.getProductAction("payment.method.add")!;
    expect(add.fields.find((field) => field.key === "keepForLater")).toBeDefined();
    // Not required, so the default is NOT to keep it.
    expect(add.fields.find((field) => field.key === "keepForLater")!.required).toBe(false);
    const once = await saveMethod(payerScope, "pm.instrument");
    const [row] = (
      await handle.db.execute(
        sql.raw(`SELECT scope FROM payment_method_references WHERE id = '${once.id}'`),
      )
    ).rows as { scope: Record<string, unknown> }[];
    expect(row!.scope.reusable).not.toBe(true);
  });

  // ── F · THE PROVIDER STOPS TO ASK ────────────────────────────────────────

  it("a provider that requires action settles nothing and opens a bound challenge", async () => {
    //   CHALLENGE_CREATED != PAYMENT_SUCCESS
    behaviour.requiresAction = true;
    await connect(payeeScope, "pm.asks");
    const token = (await saveMethod(payerScope, "pm.asks")).tokenRef;
    const intent = await anIntent();

    let challenge: Awaited<ReturnType<typeof method.openPaymentChallenge>> | null = null;
    const routed = await route.paymentExecutionRoute({
      payable: { payeeRef: payeeScope }, payerScopeId: payerScope, paymentMethodToken: token,
      onRequiresAction: async (view) => {
        challenge ??= await method.openPaymentChallenge({
          paymentIntentId: intent.id, payerScopeId: payerScope, definitionId: "pm.asks",
          providerReference: view.id, url: CHALLENGE_URL, now: at(6 * MINUTE),
        });
      },
    });
    if (routed.status !== "RESOLVED") throw new Error("no route");
    const done = await execution.executePaymentEffect(handle.db as never, routed.deps, {
      intentId: intent.id,
    });
    // Not captured, not settled. The provider did not say it was.
    expect(done.outcome).not.toBe("CAPTURED");
    const after = (await intents.getPaymentIntent(handle.db as never, intent.id))!;
    expect(after.status).not.toBe("SETTLED");
    expect(after.status).not.toBe("CAPTURED");
    expect(challenge).not.toBeNull();
    expect(challenge!.paymentIntentId).toBe(intent.id);
  });

  it("coming back from a challenge proves only that somebody came back", async () => {
    //   RETURN_URL_PAYMENT_SUCCESS_AUTHORITY = 0
    //   CLIENT_CHALLENGE_SUCCESS_SETTLES = 0
    const intent = await anIntent();
    const challenge = await method.openPaymentChallenge({
      paymentIntentId: intent.id, payerScopeId: payerScope, definitionId: "pm.asks",
      providerReference: "prov_1", url: CHALLENGE_URL, now: at(6 * MINUTE),
    });
    const returned = await method.completePaymentChallenge({
      challengeId: challenge.challengeId, state: challenge.state,
      payerScopeId: payerScope, now: at(7 * MINUTE),
    });
    expect(returned.userLeg).toBe("RETURNED");
    expect(returned.paymentTruth).toBe("UNCHANGED");
    // The payment did not move, whatever the browser said on its way back.
    expect((await intents.getPaymentIntent(handle.db as never, intent.id))!.status).toBe("CREATED");
  });

  it("a challenge cannot be replayed, borrowed, or guessed", async () => {
    //   CROSS_PAYMENT_CHALLENGE_REPLAY = 0 · CROSS_SCOPE_CHALLENGE_REPLAY = 0
    const intent = await anIntent();
    const challenge = await method.openPaymentChallenge({
      paymentIntentId: intent.id, payerScopeId: payerScope, definitionId: "pm.asks",
      providerReference: "prov_1", url: CHALLENGE_URL, now: at(6 * MINUTE),
    });
    // Somebody else's return.
    await expect(
      method.completePaymentChallenge({
        challengeId: challenge.challengeId, state: challenge.state,
        payerScopeId: strangerScope, now: at(7 * MINUTE),
      }),
    ).rejects.toBeDefined();
    // A guessed state.
    await expect(
      method.completePaymentChallenge({
        challengeId: challenge.challengeId, state: "pch_guessed",
        payerScopeId: payerScope, now: at(7 * MINUTE),
      }),
    ).rejects.toBeDefined();
    // The real one, once.
    await method.completePaymentChallenge({
      challengeId: challenge.challengeId, state: challenge.state,
      payerScopeId: payerScope, now: at(7 * MINUTE),
    });
    // And never again.
    await expect(
      method.completePaymentChallenge({
        challengeId: challenge.challengeId, state: challenge.state,
        payerScopeId: payerScope, now: at(8 * MINUTE),
      }),
    ).rejects.toBeDefined();
  });

  it("an expired challenge authorizes nothing and fails nothing", async () => {
    const intent = await anIntent();
    const challenge = await method.openPaymentChallenge({
      paymentIntentId: intent.id, payerScopeId: payerScope, definitionId: "pm.asks",
      providerReference: "prov_1", url: CHALLENGE_URL, ttlMs: MINUTE, now: at(6 * MINUTE),
    });
    await expect(
      method.completePaymentChallenge({
        challengeId: challenge.challengeId, state: challenge.state,
        payerScopeId: payerScope, now: at(9 * MINUTE),
      }),
    ).rejects.toBeDefined();
    // Not settled, and not failed either — only the provider says failed.
    //
    //   SURFACE_CLOSED != PAYMENT_CANCELLED
    expect((await intents.getPaymentIntent(handle.db as never, intent.id))!.status).toBe("CREATED");
  });

  it("a challenge is never sent to an address that was not checked", async () => {
    for (const bad of ["http://example.com/c", "https://localhost/c", "not a url"]) {
      await expect(
        method.openPaymentChallenge({
          paymentIntentId: "pi_x", payerScopeId: payerScope, definitionId: "pm.asks",
          providerReference: "prov_1", url: bad, now: at(6 * MINUTE),
        }),
        bad,
      ).rejects.toBeDefined();
    }
  });

  it("resuming after a challenge does not charge a second time", async () => {
    //   CHALLENGE_RESUME_DUPLICATE_CHARGE = 0
    behaviour.requiresAction = true;
    await connect(payeeScope, "pm.asks");
    const token = (await saveMethod(payerScope, "pm.asks")).tokenRef;
    const intent = await anIntent();
    const routed = await route.paymentExecutionRoute({
      payable: { payeeRef: payeeScope }, payerScopeId: payerScope, paymentMethodToken: token,
    });
    if (routed.status !== "RESOLVED") throw new Error("no route");
    await execution.executePaymentEffect(handle.db as never, routed.deps, { intentId: intent.id });
    const authorizations = calls.filter((one) => one.operation === "AUTHORIZE").length;
    expect(authorizations).toBe(1);

    // The payer comes back. Resuming reconciles through readback; it does not
    // authorize again.
    behaviour.requiresAction = false;
    await execution.executePaymentEffect(handle.db as never, routed.deps, { intentId: intent.id });
    expect(calls.filter((one) => one.operation === "AUTHORIZE")).toHaveLength(authorizations);
  });

  // ── G · THE HANDSHAKE LABEL GRANTS NOTHING ───────────────────────────────

  it("labelling a handshake READ does not grant READ", async () => {
    //   HANDSHAKE_LABEL_GRANTS_READ = 0
    //
    // The payment phase let a PAY-only provider authenticate by labelling its
    // handshake context READ. This proves the label is a label: the binding is
    // granted PAY and nothing else, and the read door refuses it.
    const id = await connect(payeeScope, "pm.selffunded");
    const capabilities = await binding.bindingCapabilities({
      bindingId: id, principalId: payeeScope,
    });
    expect(capabilities!.granted).toEqual(["PAY"]);
    expect(capabilities!.granted).not.toContain("READ");
    expect(capabilities!.reads).toEqual([]);

    const read = await binding.readThroughBinding({
      bindingId: id, fact: { subjectKind: "offering", subjectId: "x", property: "availability" },
      capability: "READ", now: at(5 * MINUTE),
    });
    expect(read.status).toBe("REFUSED");
    // And no READ operation ever ran during the handshake itself.
    expect(calls.filter((one) => one.parameters.operation === "READ")).toHaveLength(0);
  });

  // ── H · GENERALITY ───────────────────────────────────────────────────────

  it("an unfamiliar challenge shape is the same challenge", async () => {
    // The adapter normalises whatever its provider calls it. The runtime
    // matches one word and knows nothing about 3-D Secure, wallets or banks.
    expect(method.REQUIRES_ACTION).toBe("REQUIRES_ACTION");
    const intent = await anIntent();
    for (const url of [
      "https://example.com/3ds/challenge",
      "https://example.com/wallet/approve",
      "https://example.com/بنك/تأكيد",
    ]) {
      const challenge = await method.openPaymentChallenge({
        paymentIntentId: intent.id, payerScopeId: payerScope, definitionId: "pm.asks",
        providerReference: "prov_1", url, now: at(6 * MINUTE),
      });
      expect(challenge.paymentIntentId).toBe(intent.id);
    }
  });

  it("the production registry still holds no payment provider", async () => {
    //   PRODUCTION_FAKE_PAYMENT_PROVIDER = 0 · REAL_MONEY_TEST = 0
    expect(binding.providerDefinitions.list()).toHaveLength(0);
  });
});
