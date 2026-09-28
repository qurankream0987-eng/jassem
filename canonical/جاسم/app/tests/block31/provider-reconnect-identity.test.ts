/**
 * JASIM — A REVOKED CONNECTION IS HISTORY, NOT A SLOT TO REUSE.
 *
 *   REVOKED_BINDING_IDENTITY_IS_TERMINAL
 *   RECONNECT != UNREVOKE · RECONNECT != ROTATION
 *   PINNED_BINDING_IDENTITY != CURRENT_CONNECTION_FOR_PROVIDER
 *   RAW_DATABASE_ERROR_AS_PRODUCT_BEHAVIOR = 0
 *
 * Reconnecting a disconnected provider reused the revoked row: same binding id,
 * lifecycle reset, address cleared, credential version back to zero. It could
 * not work — the retired credential audit keeps collided with the new version 1
 * — and had it worked it would have silently re-pointed every canonical record
 * that pins that id at a different account and a different address.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { users } from "@db/schema";
import { providerCredentials, scopeProviderBindings } from "@db/schema-block2";
import { paymentIntents } from "@db/schema-block3";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let binding: typeof import("../../api/runtime/provider-binding");
let remote: typeof import("../../api/runtime/block2/remote-execution");

const T0 = new Date("2026-09-28T09:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

const OLD_ADDRESS = "https://example.com/first";
const NEW_ADDRESS = "https://example.org/second";
const FIXED_ADDRESS = "https://fixed.provider.example/mcp";

/** Every handshake succeeds; this phase is about identity, not reachability. */
const adapter = {
  authenticate: async () => ({ ok: true as const, accountRef: "acct" }),
  discover: async () => ["SEARCH", "TRACK", "CANCEL"] as never,
  invoke: async () => ({ status: "OK" as const, value: {} }),
};

describe("what a reconnect is", () => {
  let scopesMade = 0;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    binding = await import("../../api/runtime/provider-binding");
    remote = await import("../../api/runtime/block2/remote-execution");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    // An unfamiliar TEST provider, named nothing anybody's code knows.
    registry.register({
      id: "rc.own", displayName: "نظام بعنوانه", kind: "MCP", testOnly: true,
      authMethod: "API_KEY", endpoint: { mode: "DECLARED_AT_SETUP" },
      // All three purposes, so a reconnect can be shown not to resurrect any.
      webhook: "SIGNED_HMAC", receipt: "SIGNED_HMAC",
      supports: ["SEARCH", "TRACK", "CANCEL"], adapter,
    } as never);
    registry.register({
      id: "rc.fixed", displayName: "نظام بعنوان ثابت", kind: "MCP", testOnly: true,
      authMethod: "API_KEY", endpoint: { mode: "FIXED", baseUrl: FIXED_ADDRESS },
      supports: ["SEARCH", "TRACK"], adapter,
    } as never);
    binding.setProviderDefinitionRegistry(registry);
  }, 60_000);

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, remote_executions,
        payment_intents, capability_provider_catalog, events, scope_policies,
        memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'rc-%'`));
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  async function scope() {
    scopesMade += 1;
    const [row] = await handle.db.insert(users)
      .values({ unionId: `rc-${randomUUID()}`, name: `صاحب ${scopesMade}`, preferences: {} })
      .returning();
    return String(row!.id);
  }

  /** One whole connection ceremony: setup, credential, handshake, verification. */
  async function connect(input: {
    scopeId: string;
    definitionId: string;
    endpointUrl?: string;
    apiKey?: string;
    t?: number;
    verbs?: string[];
  }) {
    const t = input.t ?? 0;
    const opened = await binding.beginProviderSetup({
      principalId: input.scopeId, scopeId: input.scopeId, definitionId: input.definitionId,
      requestedCapabilities: input.verbs ?? ["SEARCH", "TRACK", "CANCEL"], now: at(t),
    });
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: input.scopeId,
      material: { apiKey: input.apiKey ?? "k" },
      ...(input.endpointUrl ? { endpointUrl: input.endpointUrl } : {}),
      now: at(t + MIN),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: input.scopeId, now: at(t + 2 * MIN),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: input.scopeId, now: at(t + 3 * MIN),
    });
    return opened.bindingId;
  }

  const rowOf = async (bindingId: string) => {
    const [row] = await handle.db.select().from(scopeProviderBindings)
      .where(eq(scopeProviderBindings.id, bindingId)).limit(1);
    return row!;
  };

  const credentialsOf = async (bindingId: string) =>
    handle.db.select().from(providerCredentials)
      .where(eq(providerCredentials.bindingId, bindingId));

  const bare = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const sourceOf = (path: string) =>
    readFile(new URL(path, import.meta.url), "utf8").then(bare);

  // ── 1–5 · THE CEREMONY, AND THE IDENTITY IT PRODUCES ─────────────────────

  it("a disconnected provider can be reconnected, as a new connection beside the old one", async () => {
    const scopeId = await scope();
    const first = await connect({ scopeId, definitionId: "rc.own", endpointUrl: OLD_ADDRESS });
    expect((await rowOf(first)).lifecycle).toBe("VERIFIED");
    expect((await rowOf(first)).endpointUrl).toBe(OLD_ADDRESS);

    await binding.revokeBinding({ bindingId: first, principalId: scopeId, now: at(10 * MIN) });

    // The reconnect completes at all, which it could not before.
    const second = await connect({
      scopeId, definitionId: "rc.own", endpointUrl: NEW_ADDRESS, t: 20 * MIN,
    });

    // A NEW identity.
    expect(second).not.toBe(first);
    expect(second).toMatch(/^bind_/);
    expect((await rowOf(second)).lifecycle).toBe("VERIFIED");
    expect((await rowOf(second)).endpointUrl).toBe(NEW_ADDRESS);

    // And the old one is untouched history: still revoked, still at its own
    // address, still stripped of the authority revocation took away.
    const old = await rowOf(first);
    expect(old.lifecycle).toBe("REVOKED");
    expect(old.endpointUrl).toBe(OLD_ADDRESS);
    expect(old.revokedAt).not.toBeNull();
    expect(old.credentialRef).toBeNull();
    expect(old.grantedCapabilities).toEqual([]);
    // Two rows for one provider in one scope: one live, one historical.
    const all = await handle.db.select().from(scopeProviderBindings)
      .where(eq(scopeProviderBindings.scopeId, scopeId));
    expect(all).toHaveLength(2);
    expect(all.filter((row) => row.lifecycle !== "REVOKED")).toHaveLength(1);
  });

  it("the live connection is still one, and a second is refused while it lives", async () => {
    const scopeId = await scope();
    await connect({ scopeId, definitionId: "rc.own", endpointUrl: OLD_ADDRESS });
    await expect(
      binding.beginProviderSetup({
        principalId: scopeId, scopeId, definitionId: "rc.own",
        requestedCapabilities: ["SEARCH"], now: at(5 * MIN),
      }),
    ).rejects.toMatchObject({ code: "STATE" });
  });

  // ── 6–7, 21 · CREDENTIAL VERSIONS BELONG TO AN IDENTITY ──────────────────

  it("the new connection's version 1 is not the old connection's version 1", async () => {
    //   RECONNECT_CREDENTIAL_VERSION_COLLISION = 0
    //   HISTORICAL_RETIRED_CREDENTIAL_DELETED = 0
    //   RECONNECT_REUSES_RETIRED_CREDENTIAL_REFERENCE = 0
    const scopeId = await scope();
    const first = await connect({ scopeId, definitionId: "rc.own", endpointUrl: OLD_ADDRESS });
    await binding.configureWebhookVerification({
      bindingId: first, principalId: scopeId, secret: "w1", now: at(4 * MIN),
    });
    await binding.configureReceiptVerification({
      bindingId: first, principalId: scopeId, secret: "r1", now: at(5 * MIN),
    });
    const firstRefs = (await credentialsOf(first)).map((row) => row.id);
    expect(firstRefs).toHaveLength(3);

    await binding.revokeBinding({ bindingId: first, principalId: scopeId, now: at(10 * MIN) });
    // Revocation retires all three kinds and deletes none of them.
    const retired = await credentialsOf(first);
    expect(retired).toHaveLength(3);
    expect(retired.map((row) => row.kind).sort()).toEqual(
      ["PROVIDER_AUTH", "RECEIPT_VERIFICATION", "WEBHOOK_VERIFICATION"],
    );
    for (const row of retired) expect(row.retiredAt).not.toBeNull();

    const second = await connect({
      scopeId, definitionId: "rc.own", endpointUrl: NEW_ADDRESS, t: 20 * MIN,
    });
    const fresh = await credentialsOf(second);
    // Its own version 1, under its own identity, with its own envelope.
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ kind: "PROVIDER_AUTH", version: 1, retiredAt: null });
    expect(firstRefs).not.toContain(fresh[0]!.id);
    // The old envelopes are all still there, still retired.
    expect((await credentialsOf(first)).map((row) => row.id).sort()).toEqual(firstRefs.sort());
    // And no reconnect resurrected any of them.
    for (const row of await credentialsOf(first)) expect(row.retiredAt).not.toBeNull();
  });

  // ── 9–12 · NO HISTORICAL REFERENCE MIGRATES ──────────────────────────────

  it("an execution and a payment stay attached to the connection that carried them", async () => {
    //   OLD_REMOTE_EXECUTION_REBOUND_TO_NEW_BINDING = 0
    //   OLD_PAYMENT_INTENT_REBOUND_TO_NEW_BINDING = 0
    const scopeId = await scope();
    const first = await connect({ scopeId, definitionId: "rc.own", endpointUrl: OLD_ADDRESS });
    expect(await binding.accountBindingFor({ scopeId, definitionId: "rc.own" })).toBe(first);

    const execution = await remote.createRemoteExecution(handle.db as never, {
      ownerId: scopeId, runId: randomUUID(), nodeId: randomUUID(),
      providerId: "mcp:first.example:find", protocolKind: "MCP",
      providerBindingRef: first, providerDefinitionId: "rc.own",
      authorizedOperations: { invoke: "SEARCH", readback: "TRACK", cancel: "CANCEL" },
      requestDigest: "digest-old", idempotencyKey: "exec-old",
    });
    const [intent] = await handle.db.insert(paymentIntents).values({
      id: `pi_${randomUUID()}`, ownerId: scopeId, payerRef: "scope", payeeRef: "merchant",
      amountMinor: "1000", currency: "SAR", purpose: "proof",
      idempotencyKey: `pay-${randomUUID()}`, providerBindingRef: first,
    }).returning();

    await binding.revokeBinding({ bindingId: first, principalId: scopeId, now: at(10 * MIN) });
    const second = await connect({
      scopeId, definitionId: "rc.own", endpointUrl: NEW_ADDRESS, t: 20 * MIN,
    });

    // Both historical records still name the account that actually ran them.
    const [executionNow] = await handle.db.execute(
      sql.raw(`SELECT "providerBindingRef" FROM remote_executions WHERE id = '${execution.id}'`),
    ).then((result) => result.rows as Array<{ providerBindingRef: string }>);
    expect(executionNow!.providerBindingRef).toBe(first);
    expect(executionNow!.providerBindingRef).not.toBe(second);
    const [intentNow] = await handle.db.select().from(paymentIntents)
      .where(eq(paymentIntents.id, intent!.id)).limit(1);
    expect(intentNow!.providerBindingRef).toBe(first);

    // And the account a NEW effect would pin is the new one.
    //
    //   NEW_REMOTE_EXECUTION_USES_REVOKED_BINDING = 0
    expect(await binding.accountBindingFor({ scopeId, definitionId: "rc.own" })).toBe(second);
    const after = await remote.createRemoteExecution(handle.db as never, {
      ownerId: scopeId, runId: randomUUID(), nodeId: randomUUID(),
      providerId: "mcp:second.example:find", protocolKind: "MCP",
      providerBindingRef: await binding.accountBindingFor({ scopeId, definitionId: "rc.own" }),
      providerDefinitionId: "rc.own",
      authorizedOperations: { invoke: "SEARCH", readback: "TRACK", cancel: "CANCEL" },
      requestDigest: "digest-new", idempotencyKey: "exec-new",
    });
    expect(after.providerBindingRef).toBe(second);
  });

  it("the old execution's authorized destination is still the old address", async () => {
    //   PINNED_EXECUTION_ENDPOINT_IDENTITY_CHANGES_AFTER_RECONNECT = 0
    //   RECONNECT_MUTATES_REVOKED_ENDPOINT = 0
    //
    // The endpoint is not copied onto the execution, and it does not have to be:
    // the pinned binding id resolves to one row, and that row's address is
    // write-once and now unreachable by any reconnect.
    const scopeId = await scope();
    const first = await connect({ scopeId, definitionId: "rc.own", endpointUrl: OLD_ADDRESS });
    const reachable = await binding.authorizedConnection({
      bindingId: first, onBehalfOfScopeId: scopeId, requiresCapability: "TRACK",
    });
    expect(reachable).toMatchObject({ status: "AUTHORIZED" });
    expect(reachable.status === "AUTHORIZED" && reachable.connection.endpoint).toBe(OLD_ADDRESS);

    await binding.revokeBinding({ bindingId: first, principalId: scopeId, now: at(10 * MIN) });
    const second = await connect({
      scopeId, definitionId: "rc.own", endpointUrl: NEW_ADDRESS, t: 20 * MIN,
    });

    // The pinned row's address did not move to the new one.
    expect((await rowOf(first)).endpointUrl).toBe(OLD_ADDRESS);
    // The pinned connection is refused now — revocation, not redirection. The
    // historical readback policy is unchanged by this phase.
    expect(
      await binding.authorizedConnection({
        bindingId: first, onBehalfOfScopeId: scopeId, requiresCapability: "TRACK",
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "BINDING_NOT_USABLE" });
    // And the new connection reaches only its own address.
    const now = await binding.authorizedConnection({
      bindingId: second, onBehalfOfScopeId: scopeId, requiresCapability: "TRACK",
    });
    expect(now.status === "AUTHORIZED" && now.connection.endpoint).toBe(NEW_ADDRESS);
  });

  // ── 12 · ACCOUNT RESOLUTION NEVER READS HISTORY ──────────────────────────

  it("account resolution ignores revoked history however much of it there is", async () => {
    //   ACCOUNT_BINDING_RESOLVES_REVOKED_HISTORY = 0
    //   ACCOUNT_BINDING_AMBIGUOUS_LIVE_SELECTION = 0
    const scopeId = await scope();
    const ids: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const id = await connect({
        scopeId, definitionId: "rc.own",
        endpointUrl: `https://example.com/round-${round}`, t: round * 60 * MIN,
      });
      ids.push(id);
      expect(await binding.accountBindingFor({ scopeId, definitionId: "rc.own" })).toBe(id);
      await binding.revokeBinding({
        bindingId: id, principalId: scopeId, now: at(round * 60 * MIN + 30 * MIN),
      });
      // With nothing live, there is no account — never the latest history.
      expect(await binding.accountBindingFor({ scopeId, definitionId: "rc.own" })).toBeNull();
    }
    expect(new Set(ids).size).toBe(3);
    const all = await handle.db.select().from(scopeProviderBindings)
      .where(eq(scopeProviderBindings.scopeId, scopeId));
    expect(all).toHaveLength(3);
    expect(all.every((row) => row.lifecycle === "REVOKED")).toBe(true);
  });

  // ── 13–15 · THE DATABASE SETTLES A RACE, AND THE PRODUCT ANSWERS IT ──────

  it("two setups at once produce one live connection and one product refusal", async () => {
    //   TWO_SIMULTANEOUS_LIVE_BINDINGS = 0
    //   RECONNECT_UNIQUE_VIOLATION_ESCAPES_RUNTIME = 0
    const scopeId = await scope();
    const open = () =>
      binding.beginProviderSetup({
        principalId: scopeId, scopeId, definitionId: "rc.own",
        requestedCapabilities: ["SEARCH"], now: T0,
      });
    const settled = await Promise.allSettled([open(), open()]);
    const won = settled.filter((one) => one.status === "fulfilled");
    const lost = settled.filter((one) => one.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    // The product's own words and the product's own error type — not a driver's.
    const reason = (lost[0] as PromiseRejectedResult).reason as Error & { code?: string };
    expect(reason.name).toBe("ProviderBindingError");
    expect(reason.code).toBe("STATE");
    expect(reason.message).not.toMatch(/duplicate key|unique constraint|23505|relation "/i);
    expect(reason.message).toContain("already connected");
    const rows = await handle.db.select().from(scopeProviderBindings)
      .where(eq(scopeProviderBindings.scopeId, scopeId));
    expect(rows).toHaveLength(1);
  });

  it("two reconnects at once do the same", async () => {
    //   CONCURRENT_RECONNECT_DUPLICATES = 0
    const scopeId = await scope();
    const first = await connect({ scopeId, definitionId: "rc.own", endpointUrl: OLD_ADDRESS });
    await binding.revokeBinding({ bindingId: first, principalId: scopeId, now: at(10 * MIN) });
    const open = () =>
      binding.beginProviderSetup({
        principalId: scopeId, scopeId, definitionId: "rc.own",
        requestedCapabilities: ["SEARCH"], now: at(20 * MIN),
      });
    const settled = await Promise.allSettled([open(), open()]);
    expect(settled.filter((one) => one.status === "fulfilled")).toHaveLength(1);
    const reason = (settled.find((one) => one.status === "rejected") as PromiseRejectedResult)
      .reason as Error & { code?: string };
    expect(reason.name).toBe("ProviderBindingError");
    expect(reason.code).toBe("STATE");
    const rows = await handle.db.select().from(scopeProviderBindings)
      .where(eq(scopeProviderBindings.scopeId, scopeId));
    // The revoked row plus exactly one new live one.
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.lifecycle !== "REVOKED")).toHaveLength(1);
    expect(rows.find((row) => row.id === first)!.lifecycle).toBe("REVOKED");
  });

  // ── 16 · THE SAME LAW FOR A FIXED ADDRESS ────────────────────────────────

  it("a fixed-address provider reconnects to the same address under a new identity", async () => {
    const scopeId = await scope();
    const first = await connect({ scopeId, definitionId: "rc.fixed", verbs: ["SEARCH", "TRACK"] });
    const a = await binding.authorizedConnection({
      bindingId: first, onBehalfOfScopeId: scopeId, requiresCapability: "TRACK",
    });
    expect(a.status === "AUTHORIZED" && a.connection.endpoint).toBe(FIXED_ADDRESS);
    // Its address is registry code, so nobody may name one for it.
    await binding.revokeBinding({ bindingId: first, principalId: scopeId, now: at(10 * MIN) });
    const second = await connect({
      scopeId, definitionId: "rc.fixed", verbs: ["SEARCH", "TRACK"], t: 20 * MIN,
    });
    expect(second).not.toBe(first);
    const b = await binding.authorizedConnection({
      bindingId: second, onBehalfOfScopeId: scopeId, requiresCapability: "TRACK",
    });
    expect(b.status === "AUTHORIZED" && b.connection.endpoint).toBe(FIXED_ADDRESS);
    expect((await rowOf(first)).endpointUrl).toBeNull();
    expect((await rowOf(second)).endpointUrl).toBeNull();
    expect((await rowOf(first)).lifecycle).toBe("REVOKED");
  });

  // ── 17–19 · ROTATION IS NOT RECONNECT ────────────────────────────────────

  it("rotating verification material is the same connection, version by version", async () => {
    //   WEBHOOK_ROTATION_BECOMES_RECONNECT = 0
    //   RECEIPT_ROTATION_BECOMES_RECONNECT = 0
    const scopeId = await scope();
    const live = await connect({ scopeId, definitionId: "rc.own", endpointUrl: OLD_ADDRESS });
    const before = await rowOf(live);

    expect(await binding.configureWebhookVerification({
      bindingId: live, principalId: scopeId, secret: "w1", now: at(4 * MIN),
    })).toMatchObject({ version: 1 });
    expect(await binding.configureWebhookVerification({
      bindingId: live, principalId: scopeId, secret: "w2", now: at(5 * MIN),
    })).toMatchObject({ version: 2 });
    expect(await binding.configureReceiptVerification({
      bindingId: live, principalId: scopeId, secret: "r1", now: at(6 * MIN),
    })).toMatchObject({ version: 1 });

    const after = await rowOf(live);
    // Same identity, same address, same lifecycle. Only the versions moved, and
    // each purpose moved on its own.
    expect(after.id).toBe(before.id);
    expect(after.endpointUrl).toBe(OLD_ADDRESS);
    expect(after.lifecycle).toBe("VERIFIED");
    expect(after.webhookCredentialVersion).toBe(2);
    expect(after.receiptCredentialVersion).toBe(1);
    expect(after.credentialVersion).toBe(before.credentialVersion);
    // One live envelope per kind; the rotated-out one is retired, not deleted.
    const held = await credentialsOf(live);
    const alive = held.filter((row) => row.retiredAt === null);
    expect(alive.map((row) => row.kind).sort()).toEqual(
      ["PROVIDER_AUTH", "RECEIPT_VERIFICATION", "WEBHOOK_VERIFICATION"],
    );
    expect(held.filter((row) => row.kind === "WEBHOOK_VERIFICATION")).toHaveLength(2);
    // And exactly one row exists for this provider: rotation created no identity.
    const rows = await handle.db.select().from(scopeProviderBindings)
      .where(eq(scopeProviderBindings.scopeId, scopeId));
    expect(rows).toHaveLength(1);
  });

  it("there is no outbound-credential rotation on a live connection, and none was added", async () => {
    // STATED HONESTLY rather than proved by a test that would have to invent it:
    // PROVIDER_AUTH material is sealed in exactly one place, `completeProviderSetup`,
    // which requires a SETUP_PENDING one-time setup. A VERIFIED connection has no
    // rotation path for it at HEAD, and this phase did not build one — reconnect is
    // a new identity, and that is a different thing again.
    const source = await sourceOf("../../api/runtime/provider-binding.ts");
    const sealers = source.match(/kind: "PROVIDER_AUTH", version/g) ?? [];
    expect(sealers).toHaveLength(1);
    const start = source.indexOf("export async function completeProviderSetup");
    const complete = source.slice(start);
    const body = complete.slice(0, complete.indexOf("export async function", 1));
    expect(body).toContain('row.lifecycle !== "SETUP_PENDING"');
    expect(body).toContain("row.setupConsumedAt");
    expect(Object.keys(binding)).not.toContain("rotateProviderCredential");
  });

  // ── 22 · WHAT A PERSON SEES DID NOT CHANGE ───────────────────────────────

  it("the projection still shows one line per provider, and still shows a disconnection", async () => {
    const scopeId = await scope();
    // Nothing connected, nothing shown.
    expect(await binding.projectBindings({ principalId: scopeId, scopeId })).toEqual([]);

    const first = await connect({ scopeId, definitionId: "rc.own", endpointUrl: OLD_ADDRESS });
    const live = await binding.projectBindings({ principalId: scopeId, scopeId });
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ bindingId: first, lifecycle: "VERIFIED" });

    // Disconnected, and the person can still see that they did it.
    await binding.revokeBinding({ bindingId: first, principalId: scopeId, now: at(10 * MIN) });
    const gone = await binding.projectBindings({ principalId: scopeId, scopeId });
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ bindingId: first, lifecycle: "REVOKED" });

    // Reconnected twice over, and it is still ONE line — the live connection,
    // not a growing history of every connection ever made.
    const second = await connect({
      scopeId, definitionId: "rc.own", endpointUrl: NEW_ADDRESS, t: 20 * MIN,
    });
    const again = await binding.projectBindings({ principalId: scopeId, scopeId });
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ bindingId: second, lifecycle: "VERIFIED" });

    // A different provider is its own line, as it always was.
    await connect({ scopeId, definitionId: "rc.fixed", verbs: ["SEARCH"], t: 40 * MIN });
    expect(await binding.projectBindings({ principalId: scopeId, scopeId })).toHaveLength(2);
  });

  // ── LEGACY ROWS COUNT AS LIVE ────────────────────────────────────────────

  it("a legacy environment-named row is not history and is not a slot", async () => {
    //   LEGACY_NULL_LIFECYCLE_ROW_ESCAPES_LIVE_UNIQUENESS = 0
    //   LEGACY_ROW_SILENTLY_BECOMES_CONNECTOR_BINDING = 0
    const scopeId = await scope();
    const legacyId = `bind_${randomUUID()}`;
    await handle.db.insert(scopeProviderBindings).values({
      id: legacyId, scopeId, providerClass: "connector", providerId: "rc.own",
      credentialEnvName: "RC_OWN_KEY", boundByPrincipalId: scopeId,
    } as never);
    expect((await rowOf(legacyId)).lifecycle).toBeNull();
    // It blocks a setup rather than being quietly turned into a credentialled
    // connection, and it is never projected or resolved as an account.
    await expect(
      binding.beginProviderSetup({
        principalId: scopeId, scopeId, definitionId: "rc.own",
        requestedCapabilities: ["SEARCH"], now: T0,
      }),
    ).rejects.toMatchObject({ code: "STATE" });
    expect((await rowOf(legacyId)).lifecycle).toBeNull();
    expect((await rowOf(legacyId)).credentialEnvName).toBe("RC_OWN_KEY");
    expect(await binding.accountBindingFor({ scopeId, definitionId: "rc.own" })).toBeNull();
    expect(await binding.projectBindings({ principalId: scopeId, scopeId })).toEqual([]);
  });

  // ── 23 · NO DOMAIN AND NO PROTOCOL BRANCHES ──────────────────────────────

  it("reconnect identity names no provider, no domain and no protocol", async () => {
    const source = await sourceOf("../../api/runtime/provider-binding.ts");
    const begin = source.slice(source.indexOf("export async function beginProviderSetup"));
    const body = begin.slice(0, begin.indexOf("export async function completeProviderSetup"));
    for (const forbidden of [
      "mcp", "a2a", "stripe", "shopify", "payment", "booking", "inventory",
      "travel", "rc.own", "rc.fixed",
    ]) {
      expect(body.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    // One identity rule, and it reads the lifecycle rather than the provider.
    expect(body).toContain("IS DISTINCT FROM 'REVOKED'");
    expect(body).toContain("const id = `bind_${randomUUID()}`");
    expect(body).not.toContain("existing?.id");
    // The migration narrowed a constraint and deleted nothing.
    const migration = await readFile(
      new URL("../../db/migrations-pg/0031_reconnect_binding_identity.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("IS DISTINCT FROM 'REVOKED'");
    expect(migration).not.toMatch(/\bDELETE\b|\bDROP TABLE\b|\bUPDATE\b|\bTRUNCATE\b/i);
  });
});
