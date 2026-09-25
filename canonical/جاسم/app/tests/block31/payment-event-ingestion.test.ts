/**
 * JASIM — THE PROVIDER SAID SOMETHING.
 *
 *   PROVIDER_EVENT != PAYMENT_TRUTH · AUTHENTICATED_EVENT != SETTLED
 *   EVENT_RECEIVED != EVENT_VERIFIED · WEBHOOK != PAY
 *   DUPLICATE_EVENT != DUPLICATE_EFFECT
 *
 * A signature authenticates WHO spoke. It never authenticates WHAT they said —
 * that is decided by reading the provider's own state, and by nothing else.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { capabilityProviderCatalog, users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";
import type { ContinuationDispatcher } from "../../api/runtime/block2/temporal";

let handle: TestDbHandle;
let events: typeof import("../../api/runtime/payment-event");
let route: typeof import("../../api/runtime/payment-route");
let method: typeof import("../../api/runtime/payment-method");
let binding: typeof import("../../api/runtime/provider-binding");
let intents: typeof import("../../api/runtime/block3/payment-intents");
let execution: typeof import("../../api/runtime/block3/payment-execution");

const T0 = new Date("2026-09-25T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

const SECRET = "webhook-secret-for-the-proof-only";
const AMOUNT = "1000";
const CURRENCY = "KWD";

const calls: { operation: string }[] = [];
const references = new Map<string, string>();
const provider: {
  readback: "CAPTURED" | "SETTLED" | "AUTHORIZED" | "FAILED" | "MISSING";
  amountMinor: string;
  currency: string;
} = { readback: "CAPTURED", amountMinor: AMOUNT, currency: CURRENCY };

const dispatcher: ContinuationDispatcher = {
  async dispatch() {
    return "enqueued";
  },
};

const sign = (rawBody: string, secret = SECRET) =>
  createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

describe("a provider event reaching a payment", () => {
  let payerScope: string;
  let payeeScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    events = await import("../../api/runtime/payment-event");
    route = await import("../../api/runtime/payment-route");
    method = await import("../../api/runtime/payment-method");
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
          // The provider takes it and finishes later, out of band.
          return {
            status: "OK" as const,
            value: {
              id, status: method.REQUIRES_ACTION, amountMinor: AMOUNT, currency: CURRENCY,
              reference: references.get(id) ?? "",
            },
          };
        }
        if (operation === "READBACK") {
          if (provider.readback === "MISSING") return { status: "OK" as const, value: null };
          return {
            status: "OK" as const,
            value: {
              id, status: provider.readback, amountMinor: provider.amountMinor,
              currency: provider.currency, reference: references.get(id) ?? "",
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
    // Two, and the runtime never reads which is which.
    registry.register({ ...base, id: "ev.rail", displayName: "قناة" });
    registry.register({ ...base, id: "ev.unfamiliar", displayName: "نظام غير مألوف" });
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
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, payment_intents,
        external_webhook_events, capability_provider_catalog, external_action_sessions,
        economic_ledger_entries, fulfillment_observations, conversation_needs,
        transactions, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'ev-%'`));
    const made: string[] = [];
    for (const name of ["دافع", "مستفيد"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `ev-${randomUUID()}`, name, preferences: {} }).returning();
      made.push(String(row!.id));
    }
    [payerScope, payeeScope] = made as [string, string];
    // The catalog row is the ONLY place the secret comes from.
    for (const id of ["ev.rail", "ev.unfamiliar"]) {
      await handle.db.insert(capabilityProviderCatalog).values({
        id, kind: "PSP", implementationId: "controlled-v1",
        ioMetadata: { webhookSecret: SECRET }, provenance: { source: "boot" },
      });
    }
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  async function connect(definitionId: string) {
    const opened = await binding.beginProviderSetup({
      principalId: payeeScope, scopeId: payeeScope, definitionId,
      requestedCapabilities: ["PAY"], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: payeeScope, material: { apiKey: "k" }, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: payeeScope, now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: payeeScope, now: at(3 * MINUTE),
    });
    calls.length = 0;
    return opened.bindingId;
  }

  /** Pay until the provider takes it and goes quiet. Nobody returns. */
  async function payAsync() {
    const created = await intents.createPaymentIntent(handle.db as never, {
      ownerId: payerScope, payerRef: payerScope, payeeRef: payeeScope,
      amountMinor: AMOUNT, currency: CURRENCY, purpose: "settlement:c1",
      idempotencyKey: `idem_${randomUUID()}`,
    } as never);
    const routed = await route.paymentExecutionRoute({
      payable: { payeeRef: payeeScope }, payerScopeId: payerScope,
    });
    if (routed.status !== "RESOLVED") throw new Error("no route");
    await execution.executePaymentEffect(handle.db as never, routed.deps, {
      intentId: created.intent.id,
    });
    expect((await intents.getPaymentIntent(handle.db as never, created.intent.id))!.status)
      .toBe("INCONCLUSIVE");
    calls.length = 0;
    return created.intent;
  }

  function body(intentId: string, over: Record<string, unknown> = {}) {
    return JSON.stringify({
      eventType: "payment.settled",
      reference: intentId,
      status: "CAPTURED",
      amountMinor: AMOUNT,
      currency: CURRENCY,
      id: `evt_${randomUUID()}`,
      ...over,
    });
  }

  const deliver = (
    intentId: string,
    raw: string,
    over: Record<string, unknown> = {},
  ) =>
    events.ingestPaymentEvent(dispatcher, {
      provider: "ev.rail", connectorId: "conn-1",
      eventKey: `key_${randomUUID()}`, eventType: "payment.settled",
      reference: intentId, rawBody: raw, signature: sign(raw),
      ownerId: payerScope, now: at(10 * MINUTE),
      ...over,
    });

  const statusOf = async (id: string) =>
    (await intents.getPaymentIntent(handle.db as never, id))!.status;

  const count = async (table: string) => {
    const rows = await handle.db.execute(sql.raw(`SELECT count(*)::int n FROM ${table}`));
    return (rows.rows[0] as { n: number }).n;
  };

  // ── A · THE DECISIVE CASE ────────────────────────────────────────────────

  it("an async payment settles with nobody ever coming back", async () => {
    //   ASYNC_PAYMENT_CAN_SETTLE_WITHOUT_BROWSER_RETURN = PASS
    await connect("ev.rail");
    const intent = await payAsync();
    const result = await deliver(intent.id, body(intent.id));
    expect(result.outcome).toBe("APPLIED");
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    // It READ the provider. It never paid it.
    //
    //   EVENT_PATH_PAY_CALLS = 0 · CAPTURE = 0 · REFUND = 0
    expect(new Set(calls.map((one) => one.operation))).toEqual(new Set(["READBACK"]));
  });

  it("an unfamiliar provider works with no branch naming it", async () => {
    await connect("ev.unfamiliar");
    const intent = await payAsync();
    const raw = body(intent.id);
    const result = await events.ingestPaymentEvent(dispatcher, {
      provider: "ev.unfamiliar", connectorId: "conn-1", eventKey: `key_${randomUUID()}`,
      eventType: "payment.settled", reference: intent.id, rawBody: raw,
      signature: sign(raw), ownerId: payerScope, now: at(10 * MINUTE),
    });
    expect(result.outcome).toBe("APPLIED");
  });

  // ── B · AUTHENTICATION IS THE FLOOR ──────────────────────────────────────

  it("a bad signature, an unknown provider and a wrong secret all change nothing", async () => {
    //   UNAUTHENTICATED_EVENT_CAN_CHANGE_PAYMENT = 0
    await connect("ev.rail");
    const intent = await payAsync();
    const raw = body(intent.id);
    const attempts = [
      { label: "no signature", over: { signature: undefined } },
      { label: "bad signature", over: { signature: "a".repeat(64) } },
      { label: "wrong secret", over: { signature: sign(raw, "another-secret-entirely") } },
      { label: "unknown provider", over: { provider: "ev.nobody" } },
    ];
    for (const attempt of attempts) {
      const result = await deliver(intent.id, raw, attempt.over);
      expect(result.outcome, attempt.label).toBe("REJECTED");
      expect(await statusOf(intent.id), attempt.label).toBe("INCONCLUSIVE");
    }
    // Not one of them reached the provider or the ledger.
    expect(calls).toHaveLength(0);
    expect(await count("external_webhook_events")).toBe(0);
  });

  it("an event correlating to no payment of this owner changes nothing", async () => {
    await connect("ev.rail");
    const intent = await payAsync();
    // Right signature, wrong owner.
    const raw = body(intent.id);
    const result = await deliver(intent.id, raw, { ownerId: payeeScope });
    expect(result.outcome).toBe("REJECTED");
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
  });

  // ── C · ONE EVENT, ONE EFFECT ────────────────────────────────────────────

  it("the same authenticated bytes arriving many times have one effect", async () => {
    //   DUPLICATE_EVENT_CAN_DUPLICATE_EFFECT = 0
    await connect("ev.rail");
    const intent = await payAsync();
    const raw = body(intent.id);
    const first = await deliver(intent.id, raw);
    expect(first.outcome).toBe("APPLIED");
    const ledgerAfterFirst = await count("economic_ledger_entries");

    // Ten more, each with a FRESH caller-supplied eventKey — the dedupe
    // identity comes from the signed body, so a caller cannot mint a new one.
    for (let index = 0; index < 10; index += 1) {
      const again = await deliver(intent.id, raw);
      expect(again.outcome).toBe("DUPLICATE");
    }
    expect(await count("economic_ledger_entries")).toBe(ledgerAfterFirst);
    expect(await statusOf(intent.id)).toBe("CAPTURED");
  });

  it("the same bytes delivered concurrently, as separate processes would, have one effect", async () => {
    //   CROSS_PROCESS_EVENT_REPLAY = 0
    //
    // The dedupe is a unique index, so this holds wherever the callers run.
    await connect("ev.rail");
    const intent = await payAsync();
    const raw = body(intent.id);
    const together = await Promise.all([1, 2, 3, 4, 5].map(() => deliver(intent.id, raw)));
    const applied = together.filter((one) => one.outcome === "APPLIED");
    expect(applied).toHaveLength(1);
    expect(together.filter((one) => one.outcome === "DUPLICATE")).toHaveLength(4);
  });

  // ── D · THE SIGNATURE DOES NOT AUTHENTICATE THE CLAIM ────────────────────

  it("an event claiming success settles nothing when the provider disagrees", async () => {
    //   EVENT_SUCCESS_BYPASSES_VERIFICATION = 0
    await connect("ev.rail");
    provider.readback = "FAILED";
    const intent = await payAsync();
    const result = await deliver(intent.id, body(intent.id));
    expect(result.outcome).toBe("UNVERIFIED");
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
  });

  it("an event claiming success invents nothing when there is nothing to read", async () => {
    //   UNKNOWN != SUCCESS
    await connect("ev.rail");
    provider.readback = "MISSING";
    const intent = await payAsync();
    const result = await deliver(intent.id, body(intent.id));
    expect(result.outcome).toBe("UNVERIFIED");
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
  });

  it("other money, in the body or in the readback, settles nothing", async () => {
    //   WRONG_AMOUNT_EVENT_SETTLES = 0 · WRONG_CURRENCY_EVENT_SETTLES = 0
    await connect("ev.rail");
    const intent = await payAsync();
    // Signed body disagreeing with the mandate is refused at the boundary.
    for (const over of [{ amountMinor: "1" }, { currency: "USD" }]) {
      const raw = body(intent.id, over);
      const result = await deliver(intent.id, raw);
      expect(result.outcome, JSON.stringify(over)).toBe("REJECTED");
      expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    }
    // And a body that agrees while the PROVIDER's own state does not.
    provider.amountMinor = "1";
    const result = await deliver(intent.id, body(intent.id));
    expect(result.outcome).toBe("UNVERIFIED");
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
  });

  it("an event about somebody else's provider reference settles nothing", async () => {
    //   WRONG_PROVIDER_REFERENCE_EVENT_SETTLES = 0
    //   WRONG_PROVIDER_ACCOUNT_EVENT_SETTLES = 0
    await connect("ev.rail");
    const intent = await payAsync();
    // The provider's readback names a payment that is not this one.
    references.set("prov_1", "pi_somebody_else");
    const result = await deliver(intent.id, body(intent.id));
    expect(result.outcome).toBe("UNVERIFIED");
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
  });

  // ── E · ORDER, AND RACES ─────────────────────────────────────────────────

  it("a later event describing an older moment does not walk a settlement back", async () => {
    //   OUT_OF_ORDER_EVENT_DOWNGRADES_TERMINAL_STATE = 0
    await connect("ev.rail");
    const intent = await payAsync();
    await deliver(intent.id, body(intent.id));
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    const ledgerBefore = await count("economic_ledger_entries");

    provider.readback = "AUTHORIZED";
    const stale = await deliver(intent.id, body(intent.id, {
      status: "AUTHORIZED", id: `evt_${randomUUID()}`,
    }));
    expect(stale.outcome).toBe("NO_EFFECT");
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    expect(await count("economic_ledger_entries")).toBe(ledgerBefore);
  });

  it("an event and a browser return reach the same end, once, in either order", async () => {
    //   WEBHOOK_AND_RETURN_DUPLICATE_EFFECT = 0
    //
    // Event first, return second.
    await connect("ev.rail");
    const first = await payAsync();
    const challenge = await method.openPaymentChallenge({
      paymentIntentId: first.id, payerScopeId: payerScope, definitionId: "ev.rail",
      providerReference: "prov_1", url: "https://example.com/psp/c", now: at(9 * MINUTE),
    });
    await deliver(first.id, body(first.id));
    expect(await statusOf(first.id)).toBe("CAPTURED");
    const ledger = await count("economic_ledger_entries");
    const resumed = await method.resumePaymentAfterChallenge({
      challengeId: challenge.challengeId, state: challenge.state,
      payerScopeId: payerScope, now: at(11 * MINUTE),
    });
    expect(resumed.outcome).toBe("STILL_INCONCLUSIVE");
    expect(await statusOf(first.id)).toBe("CAPTURED");
    expect(await count("economic_ledger_entries")).toBe(ledger);

    // Return first, event second.
    await handle.db.execute(sql.raw(`TRUNCATE TABLE payment_intents, external_action_sessions,
      external_webhook_events CASCADE`));
    const second = await payAsync();
    const challenge2 = await method.openPaymentChallenge({
      paymentIntentId: second.id, payerScopeId: payerScope, definitionId: "ev.rail",
      providerReference: "prov_1", url: "https://example.com/psp/c", now: at(9 * MINUTE),
    });
    await method.resumePaymentAfterChallenge({
      challengeId: challenge2.challengeId, state: challenge2.state,
      payerScopeId: payerScope, now: at(11 * MINUTE),
    });
    expect(await statusOf(second.id)).toBe("CAPTURED");
    const ledger2 = await count("economic_ledger_entries");
    const late = await deliver(second.id, body(second.id));
    expect(late.outcome).toBe("NO_EFFECT");
    expect(await statusOf(second.id)).toBe("CAPTURED");
    expect(await count("economic_ledger_entries")).toBe(ledger2);
  });

  // ── F · WHAT AN EVENT MAY NEVER DO ───────────────────────────────────────

  it("a revoked binding authorizes no new provider operation from an event", async () => {
    //   REVOKED_BINDING_NEW_MUTATION_FROM_EVENT = 0
    const bindingId = await connect("ev.rail");
    const intent = await payAsync();
    await binding.revokeBinding({ bindingId, principalId: payeeScope, now: at(9 * MINUTE) });
    const result = await deliver(intent.id, body(intent.id));
    expect(result.outcome).toBe("NO_EFFECT");
    expect(calls).toHaveLength(0);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
  });

  it("a settled payment fulfils no transaction and resolves no need", async () => {
    //   PAYMENT_EVENT_AUTO_FULFILLS_TRANSACTION = 0
    //   PAYMENT_EVENT_AUTO_RESOLVES_NEED = 0
    await connect("ev.rail");
    const intent = await payAsync();
    await deliver(intent.id, body(intent.id));
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    expect(await count("fulfillment_observations")).toBe(0);
    expect(await count("conversation_needs")).toBe(0);
    expect(await count("transactions")).toBe(0);
  });

  it("the production registry still holds no payment provider", async () => {
    //   PRODUCTION_FAKE_PROVIDER = 0 · REAL_MONEY_TEST = 0
    expect(binding.providerDefinitions.list()).toHaveLength(0);
  });
});
