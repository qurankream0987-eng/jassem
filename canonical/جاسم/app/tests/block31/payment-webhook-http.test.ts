/**
 * JASIM — AN ADDRESS A PROVIDER CAN POST TO.
 *
 *   HTTP_RECEIPT != PAYMENT_TRUTH · HTTP_2XX != PAYMENT_SETTLED
 *   ROUTE_PARAM != AUTHORITY · PARSED_JSON != SIGNED_RAW_BYTES
 *   DUPLICATE_HTTP_DELIVERY != DUPLICATE_EFFECT
 *
 * Every request below goes through the REAL mounted Hono route — the same
 * handler `boot.ts` mounts, with the same raw-body handling, the same
 * route-scoped size cap and the same status mapping. Nothing here calls the
 * ingestion function directly.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { capabilityProviderCatalog, users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";
import type { ContinuationDispatcher } from "../../api/runtime/block2/temporal";

let handle: TestDbHandle;
let routes: import("hono").Hono;
let route: typeof import("../../api/runtime/payment-route");
let method: typeof import("../../api/runtime/payment-method");
let binding: typeof import("../../api/runtime/provider-binding");
let intents: typeof import("../../api/runtime/block3/payment-intents");
let execution: typeof import("../../api/runtime/block3/payment-execution");

const T0 = new Date("2026-09-26T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

const SECRET = "http-ingress-webhook-secret-proof-only";
const AMOUNT = "1000";
const CURRENCY = "KWD";

const calls: { operation: string }[] = [];
const references = new Map<string, string>();
const provider: { readback: "CAPTURED" | "FAILED" | "AUTHORIZED" } = { readback: "CAPTURED" };

const dispatcher: ContinuationDispatcher = { async dispatch() { return "enqueued"; } };

const sign = (raw: string, secret = SECRET) =>
  createHmac("sha256", secret).update(raw, "utf8").digest("hex");

describe("the payment webhook over HTTP", () => {
  let payerScope: string;
  let payeeScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    route = await import("../../api/runtime/payment-route");
    method = await import("../../api/runtime/payment-method");
    binding = await import("../../api/runtime/provider-binding");
    intents = await import("../../api/runtime/block3/payment-intents");
    execution = await import("../../api/runtime/block3/payment-execution");
    const { createPaymentWebhookRoutes } = await import("../../api/http/payment-webhook");
    routes = createPaymentWebhookRoutes(dispatcher);

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
          return {
            status: "OK" as const,
            value: {
              id, status: method.REQUIRES_ACTION, amountMinor: AMOUNT, currency: CURRENCY,
              reference: references.get(id) ?? "",
            },
          };
        }
        return {
          status: "OK" as const,
          value: {
            id, status: operation === "READBACK" ? provider.readback : method.REQUIRES_ACTION,
            amountMinor: AMOUNT, currency: CURRENCY, reference: references.get(id) ?? "",
          },
        };
      },
    };
    const base = {
      authMethod: "API_KEY" as const,
      endpoint: { mode: "FIXED" as const, baseUrl: "https://example.com/psp" },
      testOnly: true, adapter, supports: ["PAY", "REFUND"] as const,
    };
    registry.register({ ...base, id: "wh.rail", displayName: "قناة" });
    registry.register({ ...base, id: "wh.unfamiliar", displayName: "نظام غير مألوف" });
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
    vi.useFakeTimers();
    vi.setSystemTime(at(10 * MINUTE));
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, payment_intents,
        external_webhook_events, capability_provider_catalog, external_action_sessions,
        economic_ledger_entries, fulfillment_observations, conversation_needs,
        transactions, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'wh-%'`));
    const made: string[] = [];
    for (const name of ["دافع", "مستفيد"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `wh-${randomUUID()}`, name, preferences: {} }).returning();
      made.push(String(row!.id));
    }
    [payerScope, payeeScope] = made as [string, string];
    for (const id of ["wh.rail", "wh.unfamiliar"]) {
      await handle.db.insert(capabilityProviderCatalog).values({
        id, kind: "PSP", implementationId: "controlled-v1",
        ioMetadata: { webhookSecret: SECRET }, provenance: { source: "boot" },
      });
    }
  });

  afterAll(() => vi.useRealTimers());

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

  /** The signed body a provider would send. Built once, signed as-is. */
  const bodyFor = (intentId: string, over: Record<string, unknown> = {}) =>
    JSON.stringify({
      eventType: "payment.settled",
      reference: intentId,
      status: "CAPTURED",
      amountMinor: AMOUNT,
      currency: CURRENCY,
      id: `evt_${randomUUID()}`,
      timestamp: at(10 * MINUTE).getTime(),
      ...over,
    });

  /** THE REAL MOUNTED ROUTE. */
  const post = (
    providerId: string,
    raw: string,
    over: { signature?: string | null; path?: string; method?: string; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(over.headers ?? {}),
    };
    if (over.signature !== null) {
      headers["x-jasim-signature"] = over.signature ?? sign(raw);
    }
    return routes.fetch(
      new Request(`http://local${over.path ?? `/${providerId}`}`, {
        method: over.method ?? "POST",
        headers,
        ...(over.method && over.method !== "POST" ? {} : { body: raw }),
      }),
    );
  };

  const statusOf = async (id: string) =>
    (await intents.getPaymentIntent(handle.db as never, id))!.status;

  const count = async (table: string) => {
    const rows = await handle.db.execute(sql.raw(`SELECT count(*)::int n FROM ${table}`));
    return (rows.rows[0] as { n: number }).n;
  };

  // ── A · THE WHOLE POINT ──────────────────────────────────────────────────

  it("a provider POSTs, and the payment settles", async () => {
    await connect("wh.rail");
    const intent = await payAsync();
    const raw = bodyFor(intent.id);
    const response = await post("wh.rail", raw);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "APPLIED" });
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    // It read the provider. It never paid it.
    //
    //   HTTP_EVENT_PROVIDER_MUTATING_CALLS = 0
    expect(new Set(calls.map((one) => one.operation))).toEqual(new Set(["READBACK"]));
  });

  it("an unfamiliar provider works through the same route", async () => {
    await connect("wh.unfamiliar");
    const intent = await payAsync();
    const response = await post("wh.unfamiliar", bodyFor(intent.id));
    expect(response.status).toBe(200);
    expect(await statusOf(intent.id)).toBe("CAPTURED");
  });

  // ── B · THE BYTES ARE THE BYTES ──────────────────────────────────────────

  it("a signature for other bytes does not cover these", async () => {
    //   SEMANTICALLY_SAME_RESERIALIZED_BODY_ACCEPTED_WITH_OLD_SIGNATURE = 0
    await connect("wh.rail");
    const intent = await payAsync();
    const original = bodyFor(intent.id);
    const parsed = JSON.parse(original) as Record<string, unknown>;

    const variants: [string, string][] = [
      // Same meaning, different whitespace.
      ["whitespace", JSON.stringify(parsed, null, 2)],
      // Same meaning, different key order.
      [
        "key order",
        JSON.stringify(
          Object.fromEntries(Object.entries(parsed).reverse()),
        ),
      ],
    ];
    for (const [label, variant] of variants) {
      expect(variant, label).not.toBe(original);
      expect(JSON.parse(variant), label).toEqual(parsed);
      // The OLD signature, over the ORIGINAL bytes.
      const response = await post("wh.rail", variant, { signature: sign(original) });
      expect(response.status, label).toBe(400);
      expect(await statusOf(intent.id), label).toBe("INCONCLUSIVE");
    }
    expect(await count("external_webhook_events")).toBe(0);
    expect(calls).toHaveLength(0);
  });

  // ── C · AUTHENTICATION IS THE FLOOR ──────────────────────────────────────

  it("no signature, a bad one, a wrong secret and an unknown provider all do nothing", async () => {
    //   UNAUTHENTICATED_HTTP_EVENT_LEDGER_ROWS = 0
    //   UNAUTHENTICATED_HTTP_EVENT_PROVIDER_CALLS = 0
    //   UNKNOWN_PROVIDER_REACHES_LEDGER = 0
    await connect("wh.rail");
    const intent = await payAsync();
    const raw = bodyFor(intent.id);
    const attempts: [string, Parameters<typeof post>[2]][] = [
      ["no signature", { signature: null }],
      ["bad signature", { signature: "a".repeat(64) }],
      ["wrong secret", { signature: sign(raw, "a-different-secret-entirely") }],
    ];
    for (const [label, over] of attempts) {
      const response = await post("wh.rail", raw, over);
      expect(response.status, label).toBe(400);
      expect(await statusOf(intent.id), label).toBe("INCONCLUSIVE");
    }
    // An unknown provider route, correctly signed for a secret nobody holds.
    const unknown = await post("wh.nobody", raw);
    expect(unknown.status).toBe(400);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    expect(await count("external_webhook_events")).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("the provider in the path proves nothing without that provider's secret", async () => {
    //   ROUTE_PROVIDER_NAME_GRANTS_AUTHORITY = NO
    await connect("wh.rail");
    const intent = await payAsync();
    // A catalog entry whose secret differs from every other.
    await handle.db.insert(capabilityProviderCatalog).values({
      id: "wh.other", kind: "PSP", implementationId: "controlled-v1",
      ioMetadata: { webhookSecret: "another-provider-entirely" }, provenance: { source: "boot" },
    });
    const raw = bodyFor(intent.id);
    // Signed for wh.other, posted to wh.rail.
    const response = await post("wh.rail", raw, { signature: sign(raw, "another-provider-entirely") });
    expect(response.status).toBe(400);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
  });

  // ── D · WHAT A CALLER CANNOT ESTABLISH ───────────────────────────────────

  it("unsigned metadata cannot name an owner, a connector, a provider or a payment", async () => {
    //   HTTP_CALLER_CAN_CHOOSE_OWNER = 0
    //   HTTP_CALLER_CAN_CHOOSE_CONNECTOR_AUTHORITY = 0
    //   HTTP_CALLER_CAN_SWAP_PAYMENT_INTENT = 0
    //   BODY_QUERY_PROVIDER_OVERRIDE = 0 · BODY_QUERY_PAYMENT_IDENTITY_OVERRIDE = 0
    await connect("wh.rail");
    const victim = await payAsync();
    const raw = bodyFor(victim.id);

    // A query string full of authority claims, and a header too. The signature
    // covers the BODY, so none of this is part of what was signed — and none of
    // it is read.
    const response = await post("wh.rail", raw, {
      path: `/wh.rail?provider=wh.other&ownerId=${payeeScope}&connectorId=mine` +
        `&bindingId=whatever&reference=pi_other&amountMinor=1&currency=USD&webhookSecret=${SECRET}`,
      headers: { "x-owner-id": payeeScope, "x-connector-id": "mine", "x-timestamp": "0" },
    });
    // It succeeded on its own merits, and every smuggled field was ignored.
    expect(response.status).toBe(200);
    expect(await statusOf(victim.id)).toBe("CAPTURED");
    // The ledger row records the route-derived connector, not the caller's.
    const [ledgerRow] = (
      await handle.db.execute(sql.raw(`SELECT "connectorId" AS c FROM external_webhook_events`))
    ).rows as { c: string }[];
    expect(ledgerRow!.c).toBe("route:wh.rail");
    // And the canonical event's owner is the PAYMENT's, never the one the
    // caller named — derived inside the authenticated boundary.
    const [eventRow] = (
      await handle.db.execute(
        sql.raw(`SELECT "ownerId" AS o FROM events WHERE type = 'payment.settled' ORDER BY id DESC LIMIT 1`),
      )
    ).rows as { o: string }[];
    expect(eventRow!.o).toBe(payerScope);
  });

  it("changing the money inside the signed body only breaks the signature", async () => {
    await connect("wh.rail");
    const intent = await payAsync();
    for (const over of [{ amountMinor: "1" }, { currency: "USD" }, { reference: "pi_other" }]) {
      const raw = bodyFor(intent.id, over);
      // Correctly signed for the tampered body — and now the mandate refuses it.
      const response = await post("wh.rail", raw);
      expect(response.status, JSON.stringify(over)).toBe(400);
      expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    }
  });

  it("an old signed body cannot be made fresh by an unsigned timestamp", async () => {
    //   UNSIGNED_TIMESTAMP_CAN_REFRESH_OLD_SIGNED_BODY = 0
    await connect("wh.rail");
    const intent = await payAsync();
    // Signed an hour ago, and it says so in the bytes that were signed.
    const stale = bodyFor(intent.id, { timestamp: at(-60 * MINUTE).getTime() });
    const response = await post("wh.rail", stale, {
      // A fresh unsigned header, which this route does not read at all.
      headers: { "x-timestamp": String(at(10 * MINUTE).getTime()) },
    });
    expect(response.status).toBe(400);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    expect(await count("external_webhook_events")).toBe(0);
  });

  // ── E · ONE EFFECT ───────────────────────────────────────────────────────

  it("the same HTTP callback delivered twice is acknowledged twice and applied once", async () => {
    //   DUPLICATE_HTTP_DELIVERY_DUPLICATE_EFFECT = 0
    await connect("wh.rail");
    const intent = await payAsync();
    const raw = bodyFor(intent.id);
    const first = await post("wh.rail", raw);
    expect(first.status).toBe(200);
    expect((await first.json() as { outcome: string }).outcome).toBe("APPLIED");
    const ledger = await count("economic_ledger_entries");

    const second = await post("wh.rail", raw);
    // Acknowledged — so the provider stops resending — and it changed nothing.
    expect(second.status).toBe(200);
    expect((await second.json() as { outcome: string }).outcome).toBe("DUPLICATE");
    expect(await count("economic_ledger_entries")).toBe(ledger);
    expect(await statusOf(intent.id)).toBe("CAPTURED");
  });

  it("five concurrent HTTP deliveries apply once, through the durable ledger", async () => {
    //   CONCURRENT_HTTP_DUPLICATE_EFFECT = 0 · SECOND_REPLAY_RUNTIME_ADDED = 0
    await connect("wh.rail");
    const intent = await payAsync();
    const raw = bodyFor(intent.id);
    const responses = await Promise.all([1, 2, 3, 4, 5].map(() => post("wh.rail", raw)));
    const outcomes = await Promise.all(
      responses.map(async (one) => (await one.json() as { outcome: string }).outcome),
    );
    expect(outcomes.filter((one) => one === "APPLIED")).toHaveLength(1);
    expect(outcomes.filter((one) => one === "DUPLICATE")).toHaveLength(4);
    expect(responses.every((one) => one.status === 200)).toBe(true);
  });

  it("a webhook and a browser return reach the same end, once, in either order", async () => {
    await connect("wh.rail");
    const intent = await payAsync();
    const challenge = await method.openPaymentChallenge({
      paymentIntentId: intent.id, payerScopeId: payerScope, definitionId: "wh.rail",
      providerReference: "prov_1", url: "https://example.com/psp/c", now: at(9 * MINUTE),
    });
    await post("wh.rail", bodyFor(intent.id));
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    const ledger = await count("economic_ledger_entries");
    const resumed = await method.resumePaymentAfterChallenge({
      challengeId: challenge.challengeId, state: challenge.state,
      payerScopeId: payerScope, now: at(11 * MINUTE),
    });
    expect(resumed.outcome).toBe("STILL_INCONCLUSIVE");
    expect(await count("economic_ledger_entries")).toBe(ledger);
  });

  // ── F · THE NUMBER ANSWERED IS NOT THE PAYMENT'S STATE ───────────────────

  it("an authentic event the provider does not bear out is acknowledged, not 500", async () => {
    //   EXPECTED_REFUSAL_RETURNS_500 = 0 · HTTP_ACK_EQUALS_PAYMENT_SUCCESS = NO
    await connect("wh.rail");
    provider.readback = "FAILED";
    const intent = await payAsync();
    const response = await post("wh.rail", bodyFor(intent.id));
    expect(response.status).toBe(202);
    const body = await response.json() as { outcome: string };
    expect(body.outcome).toBe("UNVERIFIED");
    // Acknowledged, and the payment did not move.
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    // And the body does not pretend otherwise.
    expect(JSON.stringify(body)).not.toContain("SETTLED");
  });

  it("an authentic event with nothing left to change is acknowledged", async () => {
    await connect("wh.rail");
    const intent = await payAsync();
    await post("wh.rail", bodyFor(intent.id));
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    // A different event id, so it is not a duplicate — and there is nothing
    // left to do.
    const response = await post("wh.rail", bodyFor(intent.id, { id: `evt_${randomUUID()}` }));
    expect(response.status).toBe(200);
    expect((await response.json() as { outcome: string }).outcome).toBe("NO_EFFECT");
  });

  it("malformed JSON is refused deterministically and throws nothing", async () => {
    await connect("wh.rail");
    await payAsync();
    for (const raw of ["{not json", "[]", '"a string"', ""]) {
      const response = await post("wh.rail", raw);
      expect(response.status, raw).toBe(400);
      expect(await response.json()).toHaveProperty("received", false);
    }
    expect(await count("external_webhook_events")).toBe(0);
  });

  it("a callback without its own event type or reference is refused", async () => {
    await connect("wh.rail");
    await payAsync();
    for (const raw of [JSON.stringify({ status: "CAPTURED" }), JSON.stringify({ eventType: "payment.settled" })]) {
      expect((await post("wh.rail", raw)).status).toBe(400);
    }
  });

  it("an oversized callback is refused before anything reads it", async () => {
    //   OVERSIZED_WEBHOOK_BODY_ACCEPTED = 0
    const { WEBHOOK_MAX_BODY_BYTES } = await import("../../api/http/payment-webhook");
    await connect("wh.rail");
    const intent = await payAsync();
    const huge = JSON.stringify({
      eventType: "payment.settled", reference: intent.id, status: "CAPTURED",
      amountMinor: AMOUNT, currency: CURRENCY, id: "evt_1",
      padding: "x".repeat(WEBHOOK_MAX_BODY_BYTES + 1_000),
    });
    expect(huge.length).toBeGreaterThan(WEBHOOK_MAX_BODY_BYTES);
    const response = await post("wh.rail", huge);
    expect(response.status).toBe(413);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    expect(await count("external_webhook_events")).toBe(0);
  });

  it("anything but a POST is not a callback", async () => {
    for (const verb of ["GET", "PUT", "PATCH", "DELETE"]) {
      const response = await post("wh.rail", "", { method: verb });
      expect(response.status, verb).toBe(405);
    }
  });

  // ── G · WHAT IT NEVER DOES ───────────────────────────────────────────────

  it("settling through HTTP fulfils no transaction and resolves no need", async () => {
    await connect("wh.rail");
    const intent = await payAsync();
    await post("wh.rail", bodyFor(intent.id));
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    expect(await count("fulfillment_observations")).toBe(0);
    expect(await count("conversation_needs")).toBe(0);
    expect(await count("transactions")).toBe(0);
  });

  it("boot mounts this route before the catch-all, and asks for no session", () => {
    //   WEBHOOK_REQUIRES_BROWSER_SESSION = NO · DEV_LOGIN_CAN_AUTHORIZE_WEBHOOK = NO
    const boot = readFileSync(resolve(process.cwd(), "api/boot.ts"), "utf8");
    const mount = boot.indexOf('app.route(\n  "/api/webhooks/payment"');
    const catchAll = boot.indexOf('app.all("/api/*"');
    expect(mount).toBeGreaterThan(-1);
    expect(catchAll).toBeGreaterThan(-1);
    expect(mount).toBeLessThan(catchAll);
    // The global 50 MB cap is untouched.
    //
    //   GLOBAL_JSON_BODY_PARSER_WEAKENED = NO
    expect(boot).toContain("bodyLimit({ maxSize: 50 * 1024 * 1024 })");

    // The route reads no cookie, no Authorization header and no session.
    const source = readFileSync(resolve(process.cwd(), "api/http/payment-webhook.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const word of ["getCookie", "createContext", "Authorization", "session", "dev-login"]) {
      expect(code, word).not.toContain(word);
    }
    // The bytes handed to the boundary are the ones that arrived: read with
    // `text()`, and never re-serialised anywhere in this file.
    expect(code).toMatch(/rawBody = await c\.req\.text\(\)/);
    expect(code).toMatch(/rawBody,/);
    expect(code).not.toMatch(/JSON\.stringify/);
    // Nothing mutating at the provider, and no provider named.
    expect(code).not.toMatch(/authorize|capture|refund|executePaymentEffect/i);
    for (const named of ["stripe", "moyasar", "paypal", "adyen"]) {
      expect(code.toLowerCase(), named).not.toContain(named);
    }
    // And nothing is logged from it at all.
    //
    //   RAW_WEBHOOK_BODY_LOGGED = 0 · SIGNATURE = 0 · SECRET = 0
    expect(code).not.toMatch(/logger|console\./);
  });
});
