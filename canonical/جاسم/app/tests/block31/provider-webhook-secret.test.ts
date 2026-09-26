/**
 * JASIM — WHO OWNS A WEBHOOK SECRET, AND WHERE IT LIVES.
 *
 *   WEBHOOK_SECRET != PUBLIC PROVIDER METADATA · != EVENT PAYLOAD · != LOG
 *   PROVIDER_DEFINITION != PROVIDER_BINDING · PROVIDER_TYPE != PROVIDER_ACCOUNT
 *   MODEL != SECRET PROVISIONING AUTHORITY
 *   SECRET_PROVISIONED != PROVIDER_VERIFIED != PAYMENT_SUCCESS
 *   VALID_SIGNATURE != VERIFIED
 *
 * Every secret in this file enters through the one production path — the
 * trusted product action and `configureWebhookVerification` — and nothing is
 * injected into the webhook runtime anywhere.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";
import type { ContinuationDispatcher } from "../../api/runtime/block2/temporal";

let handle: TestDbHandle;
let routes: import("hono").Hono;
let route: typeof import("../../api/runtime/payment-route");
let binding: typeof import("../../api/runtime/provider-binding");
let intents: typeof import("../../api/runtime/block3/payment-intents");
let execution: typeof import("../../api/runtime/block3/payment-execution");
let actions: typeof import("../../api/runtime/product-actions");

const T0 = new Date("2026-09-26T09:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

const SECRET = "whsec_the_only_one_the_provider_issued";
const OTHER = "whsec_a_completely_different_account";
const AMOUNT = "1000";
const CURRENCY = "KWD";

const calls: { operation: string }[] = [];
const references = new Map<string, string>();
const dispatcher: ContinuationDispatcher = { async dispatch() { return "enqueued"; } };

const sign = (raw: string, secret = SECRET) =>
  createHmac("sha256", secret).update(raw, "utf8").digest("hex");

describe("where a provider webhook secret lives", () => {
  let payerScope: string;
  let payeeScope: string;
  let strangerScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    route = await import("../../api/runtime/payment-route");
    binding = await import("../../api/runtime/provider-binding");
    intents = await import("../../api/runtime/block3/payment-intents");
    execution = await import("../../api/runtime/block3/payment-execution");
    actions = await import("../../api/runtime/product-actions");
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
              id, status: "REQUIRES_ACTION", amountMinor: AMOUNT, currency: CURRENCY,
              reference: references.get(id) ?? "",
            },
          };
        }
        return {
          status: "OK" as const,
          value: {
            id, status: operation === "READBACK" ? "CAPTURED" : "REQUIRES_ACTION",
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
    // One KIND of system signs its callbacks. The other never calls back at
    // all, and is here so that nothing forces a webhook step on it.
    registry.register({ ...base, id: "wv.rail", displayName: "قناة", webhook: "SIGNED_HMAC" });
    registry.register({ ...base, id: "wv.quiet", displayName: "نظام صامت" });
    binding.setProviderDefinitionRegistry(registry);
  });

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    vi.useRealTimers();
    await handle.pool.end();
  });

  beforeEach(async () => {
    calls.length = 0;
    references.clear();
    vi.useFakeTimers();
    vi.setSystemTime(at(10 * MINUTE));
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, payment_intents,
        external_webhook_events, capability_provider_catalog, external_action_sessions,
        economic_ledger_entries, fulfillment_observations, conversation_needs,
        transactions, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'wv-%'`));
    const made: string[] = [];
    for (const name of ["دافع", "مستفيد", "غريب"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `wv-${randomUUID()}`, name, preferences: {} }).returning();
      made.push(String(row!.id));
    }
    [payerScope, payeeScope, strangerScope] = made as [string, string, string];
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  /** The whole trusted lifecycle. Verification material is optional, as it is. */
  async function connect(
    definitionId: string,
    opts: { scope?: string; secret?: string | null; capabilities?: string[] } = {},
  ) {
    const scope = opts.scope ?? payeeScope;
    const opened = await binding.beginProviderSetup({
      principalId: scope, scopeId: scope, definitionId,
      requestedCapabilities: opts.capabilities ?? ["PAY"], now: T0,
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
      await binding.configureWebhookVerification({
        bindingId: opened.bindingId, principalId: scope,
        secret: opts.secret ?? SECRET, now: at(4 * MINUTE),
      });
    }
    calls.length = 0;
    return { bindingId: opened.bindingId, opened };
  }

  /** Pay until the provider takes it and goes quiet. Nobody returns. */
  async function payAsync() {
    const created = await intents.createPaymentIntent(handle.db as never, {
      ownerId: payerScope, payerRef: payerScope, payeeRef: payeeScope,
      amountMinor: AMOUNT, currency: CURRENCY, purpose: "settlement:wv",
      idempotencyKey: `idem_${randomUUID()}`,
    } as never);
    const routed = await route.paymentExecutionRoute({
      payable: { payeeRef: payeeScope }, payerScopeId: payerScope,
    });
    if (routed.status !== "RESOLVED") throw new Error("no route");
    await execution.executePaymentEffect(handle.db as never, routed.deps, {
      intentId: created.intent.id,
    });
    calls.length = 0;
    return created.intent;
  }

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
    over: { signature?: string | null; path?: string; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(over.headers ?? {}),
    };
    if (over.signature !== null) headers["x-jasim-signature"] = over.signature ?? sign(raw);
    return routes.fetch(
      new Request(`http://local${over.path ?? `/${providerId}`}`, {
        method: "POST", headers, body: raw,
      }),
    );
  };

  const statusOf = async (id: string) =>
    (await intents.getPaymentIntent(handle.db as never, id))!.status;

  const count = async (table: string) => {
    const rows = await handle.db.execute(sql.raw(`SELECT count(*)::int n FROM ${table}`));
    return (rows.rows[0] as { n: number }).n;
  };

  /** Every column of every table JASIM writes, as text. */
  const CANONICAL_TABLES = [
    "events", "external_webhook_events", "provider_credentials", "scope_provider_bindings",
    "payment_intents", "economic_ledger_entries", "external_action_sessions",
    "capability_provider_catalog", "scope_policies", "transactions",
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

  // ── A · NOTHING PROVISIONED, AND A PERFECTLY SHAPED CALLBACK ─────────────

  it("a provider that needs verification and has none authenticates nothing", async () => {
    //   MISSING_SECRET_AUTHENTICATES = 0
    await connect("wv.rail", { secret: null });
    const intent = await payAsync();
    const raw = bodyFor(intent.id);
    // Signed with the secret the provider would really use. JASIM holds none.
    const response = await post("wv.rail", raw);
    expect(response.status).toBe(400);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    // Zero ledger row, zero canonical event, zero provider round trip.
    expect(await count("external_webhook_events")).toBe(0);
    expect(calls).toHaveLength(0);
    // And the binding says so, in a status rather than a secret.
    const [projection] = await binding.projectBindings({
      principalId: payeeScope, scopeId: payeeScope, now: at(10 * MINUTE),
    });
    expect(projection!.webhookVerification).toBe("REQUIRED_NOT_CONFIGURED");
  });

  // ── B · WHERE IT ENDED UP ────────────────────────────────────────────────

  it("the trusted path stores it, and the raw secret is nowhere in canonical state", async () => {
    //   WEBHOOK_SECRET_PLAINTEXT_CANONICAL_STORAGE = 0
    //   WEBHOOK_SECRET_IN_EVENT = 0 · WEBHOOK_SECRET_LOGGED = 0
    const { bindingId } = await connect("wv.rail");
    expect(await whereItLeaked(SECRET)).toEqual([]);
    // It IS there — sealed, as one envelope of one kind.
    const rows = (
      await handle.db.execute(
        sql.raw(`SELECT kind, version, "retiredAt" IS NULL AS live FROM provider_credentials
                 WHERE "bindingId" = '${bindingId}' ORDER BY kind`),
      )
    ).rows as { kind: string; version: number; live: boolean }[];
    expect(rows.map((r) => r.kind)).toEqual(["PROVIDER_AUTH", "WEBHOOK_VERIFICATION"]);
    expect(rows.every((r) => r.live)).toBe(true);
    // The projection reports a STATUS and no reference.
    const [projection] = await binding.projectBindings({
      principalId: payeeScope, scopeId: payeeScope, now: at(10 * MINUTE),
    });
    expect(projection!.webhookVerification).toBe("CONFIGURED");
    expect(JSON.stringify(projection)).not.toContain(SECRET);
    expect(JSON.stringify(projection)).not.toContain("webhookCredentialRef");
    // And configuring it is not verifying anything and not paying anything.
    //
    //   SECRET_PROVISIONED != PROVIDER_VERIFIED != PAYMENT_SUCCESS
    expect(await count("payment_intents")).toBe(0);
  });

  it("the completion says configured, and never the secret", async () => {
    //   WEBHOOK_SECRET_RETURNED_AFTER_STORAGE = 0
    const { bindingId } = await connect("wv.rail", { secret: null });
    const done = await binding.configureWebhookVerification({
      bindingId, principalId: payeeScope, secret: SECRET, now: at(5 * MINUTE),
    });
    expect(done).toEqual({ configured: true, version: 1 });
    expect(JSON.stringify(done)).not.toContain(SECRET);
  });

  // ── C · THE WHOLE POINT ──────────────────────────────────────────────────

  it("provisioned through the trusted path, the mounted route authenticates the provider", async () => {
    await connect("wv.rail");
    const intent = await payAsync();
    const response = await post("wv.rail", bodyFor(intent.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, outcome: "APPLIED" });
    // The signed body said `payment.settled`. The provider's own readback said
    // CAPTURED, and the readback is what decides.
    //
    //   RECEIPT != VERIFICATION · EVENT_CLAIM != PROVIDER_STATE
    expect(await statusOf(intent.id)).toBe("CAPTURED");
    expect(await count("external_webhook_events")).toBe(1);
    // A readback happened. Nothing else did.
    expect(calls.map((c) => c.operation)).toEqual(["READBACK", "READBACK"]);
  });

  // ── D · THE WRONG SECRET ─────────────────────────────────────────────────

  it("a wrong secret is refused before the ledger and before the payment", async () => {
    //   WRONG_SECRET_AUTHENTICATES = 0
    await connect("wv.rail");
    const intent = await payAsync();
    const raw = bodyFor(intent.id);
    const response = await post("wv.rail", raw, { signature: sign(raw, "whsec_guessed") });
    expect(response.status).toBe(400);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    expect(await count("external_webhook_events")).toBe(0);
    expect(calls).toHaveLength(0);
  });

  // ── E · THE MODEL ────────────────────────────────────────────────────────

  it("a string the model produced cannot become verification material", async () => {
    //   MODEL_CAN_PROVISION_WEBHOOK_SECRET = NO
    //   MODEL_CAN_SEE_WEBHOOK_SECRET = NO · CHAT_CAN_TRANSPORT_WEBHOOK_SECRET = NO
    const action = actions.getProductAction("provider.webhook.configure")!;
    // The field is SENSITIVE, so no transcript and no model context carries it.
    expect(action.fields.find((field) => field.key === "webhookSecret")!.kind).toBe("SENSITIVE");
    expect(action.reauthentication).toBe(true);
    expect(action.confirmation).toBe("EXPLICIT");
    // The presentation a surface renders carries NO value, so there is nowhere
    // to put a model's suggestion for somebody to accept without reading.
    const presentation = actions.presentationFor(action);
    expect(presentation.fields.every((field) => !("value" in field))).toBe(true);
    expect(
      presentation.fields.filter((field) => field.kind !== "SENSITIVE").map((field) => field.key),
    ).toEqual(["bindingId"]);
    // And there is exactly ONE place in the whole server that provisions it.
    const callers = filesMentioning("configureWebhookVerification", resolve(__dirname, "../../api"));
    expect(callers.sort()).toEqual([
      "runtime/product-actions.ts",
      "runtime/provider-binding.ts",
    ]);
  });

  // ── F · WHAT A CALLER SENDS ──────────────────────────────────────────────

  it("no body field, query parameter or header can choose the material", async () => {
    //   CLIENT_CAN_OVERRIDE_WEBHOOK_SECRET = 0
    //   BODY_SECRET_USED = 0 · QUERY_SECRET_USED = 0
    await connect("wv.rail");
    const first = await payAsync();
    // The real secret handed over in every channel a caller controls, while the
    // signature is computed with a secret JASIM does not hold.
    const forged = bodyFor(first.id, { webhookSecret: SECRET, secret: SECRET });
    const refused = await post("wv.rail", forged, {
      signature: sign(forged, "whsec_not_ours"),
      path: `/wv.rail?webhookSecret=${SECRET}&secret=${SECRET}&credentialRef=pcr_x&bindingId=whatever`,
      headers: { "x-webhook-secret": SECRET, "x-jasim-webhook-secret": SECRET },
    });
    expect(refused.status).toBe(400);
    expect(await statusOf(first.id)).toBe("INCONCLUSIVE");
    expect(await count("external_webhook_events")).toBe(0);
    // The same smuggling alongside a signature that IS correct changes nothing
    // about the outcome either: it succeeded on its own merits.
    const honest = bodyFor(first.id, { webhookSecret: "ignored", secret: "ignored" });
    const accepted = await post("wv.rail", honest, {
      path: `/wv.rail?webhookSecret=${OTHER}&credentialRef=pcr_y`,
      headers: { "x-webhook-secret": OTHER },
    });
    expect(accepted.status).toBe(200);
    expect(await statusOf(first.id)).toBe("CAPTURED");
  });

  // ── G/H · ONE ACCOUNT'S SECRET IS ONE ACCOUNT'S SECRET ───────────────────

  it("another binding's secret authenticates nothing here, same provider or not", async () => {
    //   CROSS_BINDING_SECRET_AUTHENTICATES = 0
    //   CROSS_SCOPE_SECRET_AUTHENTICATES = 0
    //   CROSS_PROVIDER_SECRET_AUTHENTICATES = 0
    await connect("wv.rail");
    const intent = await payAsync();
    // A DIFFERENT SCOPE, the SAME provider definition, its own account, its own
    // secret. Structurally ordinary — it is what a binding is for.
    await connect("wv.rail", { scope: strangerScope, secret: OTHER });
    const raw = bodyFor(intent.id);
    const crossScope = await post("wv.rail", raw, { signature: sign(raw, OTHER) });
    expect(crossScope.status).toBe(400);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    // A different provider DEFINITION in the same scope fares no better.
    await connect("wv.quiet", { scope: strangerScope, secret: null, capabilities: ["REFUND"] });
    const crossProvider = await post("wv.quiet", raw);
    expect(crossProvider.status).toBe(400);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    expect(await count("external_webhook_events")).toBe(0);
    // And the payee's own secret still works, so none of this broke the account
    // that actually owns the callback.
    expect((await post("wv.rail", raw)).status).toBe(200);
    expect(await statusOf(intent.id)).toBe("CAPTURED");
  });

  // ── I · ROTATION AND REVOCATION ──────────────────────────────────────────

  it("a rotated secret replaces the old one with no overlap, and revocation closes the door", async () => {
    //   RETIRED_WEBHOOK_MATERIAL_AUTHENTICATES_NEW_CALLBACK = 0
    //   REVOKED_BINDING_AUTHENTICATES_NEW_CALLBACK = 0
    const { bindingId } = await connect("wv.rail");
    const first = await payAsync();
    // The provider re-issued its endpoint secret.
    const rotated = await binding.configureWebhookVerification({
      bindingId, principalId: payeeScope, secret: OTHER, now: at(6 * MINUTE),
    });
    expect(rotated.version).toBe(2);
    const raw = bodyFor(first.id);
    // The retired one is retired. There is no overlap window, and none was
    // invented: a deployment that needs one must model it explicitly.
    expect((await post("wv.rail", raw, { signature: sign(raw, SECRET) })).status).toBe(400);
    expect(await statusOf(first.id)).toBe("INCONCLUSIVE");
    const accepted = await post("wv.rail", raw, { signature: sign(raw, OTHER) });
    expect(accepted.status).toBe(200);
    expect(await statusOf(first.id)).toBe("CAPTURED");
    const ledger = await count("external_webhook_events");
    expect(ledger).toBe(1);

    // Disconnect. Nothing NEW authenticates afterwards…
    await binding.revokeBinding({ bindingId, principalId: payeeScope, now: at(7 * MINUTE) });
    const second = bodyFor(first.id, { id: `evt_${randomUUID()}` });
    expect((await post("wv.rail", second, { signature: sign(second, OTHER) })).status).toBe(400);
    // …and the evidence already ingested is still there. Revocation does not
    // erase facts; it removes future authority.
    expect(await count("external_webhook_events")).toBe(ledger);
    expect(await statusOf(first.id)).toBe("CAPTURED");
    const live = (
      await handle.db.execute(
        sql.raw(`SELECT count(*)::int n FROM provider_credentials
                 WHERE "bindingId" = '${bindingId}' AND "retiredAt" IS NULL`),
      )
    ).rows[0] as { n: number };
    expect(live.n).toBe(0);
  });

  // ── J · A PROVIDER THAT DOES NOT CALL BACK ───────────────────────────────

  it("a provider that never signs callbacks connects normally and is asked for nothing", async () => {
    //   PROVIDER_WITHOUT_WEBHOOK_REQUIREMENT_REGRESSION = 0
    const opened = await binding.beginProviderSetup({
      principalId: payeeScope, scopeId: payeeScope, definitionId: "wv.quiet",
      requestedCapabilities: ["PAY"], now: T0,
    });
    expect(opened.webhookVerification).toBe("NONE");
    expect(opened.collects.map((field) => field.key)).toEqual(["apiKey"]);
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: payeeScope, material: { apiKey: "k" }, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: payeeScope, now: at(2 * MINUTE),
    });
    const verified = await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: payeeScope, now: at(3 * MINUTE),
    });
    expect(verified.status).toBe("VERIFIED");
    const [projection] = await binding.projectBindings({
      principalId: payeeScope, scopeId: payeeScope, now: at(10 * MINUTE),
    });
    expect(projection!.webhookVerification).toBe("NOT_REQUIRED");
    // And material offered for it is refused rather than stored somewhere
    // nothing will ever read.
    await expect(
      binding.configureWebhookVerification({
        bindingId: opened.bindingId, principalId: payeeScope, secret: SECRET, now: at(4 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    // It pays exactly as before, and no callback is owed.
    const intent = await payAsync();
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
  });

  // ── K · THE LAWS THE LAST PHASE CLOSED STILL HOLD ────────────────────────

  it("the exact raw bytes are still what is authenticated", async () => {
    //   PARSED_JSON != SIGNED_RAW_BYTES
    //   SEMANTICALLY_SAME_RESERIALIZED_BODY_ACCEPTED_WITH_OLD_SIGNATURE = 0
    await connect("wv.rail");
    const intent = await payAsync();
    const raw = bodyFor(intent.id);
    const reserialized = JSON.stringify(JSON.parse(raw), null, 2);
    expect(reserialized).not.toBe(raw);
    expect((await post("wv.rail", reserialized, { signature: sign(raw) })).status).toBe(400);
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    // A signed timestamp is still what freshness is judged by.
    const stale = bodyFor(intent.id, { timestamp: at(-60 * MINUTE).getTime() });
    expect((await post("wv.rail", stale)).status).toBe(400);
    expect(await count("external_webhook_events")).toBe(0);
  });

  // ── L · THE GENERAL PROVIDER CREDENTIAL IS UNTOUCHED ─────────────────────

  it("rotating one kind of material leaves the other exactly as it was", async () => {
    //   WEBHOOK_ROTATION_RETIRES_PROVIDER_AUTH = 0
    //
    // The reachable direction. A live VERIFIED binding cannot re-open its setup
    // — `beginProviderSetup` refuses a connection that already exists — so
    // rotating the OUTBOUND credential means disconnecting and reconnecting,
    // which is the repository's existing behaviour and not this phase's to
    // change. What this phase added is a second kind of material beside it, and
    // this is the proof that adding it took nothing away.
    const { bindingId } = await connect("wv.rail");
    // Rotate the WEBHOOK material on the live binding.
    await binding.configureWebhookVerification({
      bindingId, principalId: payeeScope, secret: OTHER, now: at(5 * MINUTE),
    });
    // The OUTBOUND credential still opens: a payment executes through this
    // binding, which cannot happen unless the vault returned the API key.
    const intent = await payAsync();
    // INCONCLUSIVE means the provider was actually called and took it, which
    // cannot happen unless the vault returned the API key for this binding.
    expect(await statusOf(intent.id)).toBe("INCONCLUSIVE");
    const executed = (
      await handle.db.execute(
        sql.raw(`SELECT "providerBindingRef" AS b FROM payment_intents WHERE id = '${intent.id}'`),
      )
    ).rows[0] as { b: string };
    expect(executed.b).toBe(bindingId);
    // Two live envelopes, one of each kind, each at its own version.
    const rows = (
      await handle.db.execute(
        sql.raw(`SELECT kind, version FROM provider_credentials
                 WHERE "bindingId" = '${bindingId}' AND "retiredAt" IS NULL ORDER BY kind`),
      )
    ).rows as { kind: string; version: number }[];
    expect(rows).toEqual([
      { kind: "PROVIDER_AUTH", version: 1 },
      { kind: "WEBHOOK_VERIFICATION", version: 2 },
    ]);
    // And the callback authenticates with the new material, against the same
    // account, with the same connection.
    const raw = bodyFor(intent.id);
    expect((await post("wv.rail", raw, { signature: sign(raw, OTHER) })).status).toBe(200);
    expect(await statusOf(intent.id)).toBe("CAPTURED");
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
      if (readFileSync(full, "utf8").includes(needle)) {
        found.push(full.slice(root.length + 1));
      }
    }
  };
  walk(root);
  return found;
}
