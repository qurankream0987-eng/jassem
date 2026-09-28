/**
 * JASIM — ONE TABLE, TWO RUNTIMES, AND NO DOOR BETWEEN THEM.
 *
 *   LEGACY_BINDING != MODERN_CONNECTOR_BINDING
 *   LEGACY_STATE != MODERN_LIFECYCLE
 *   LEGACY_AUTHORITY_ACT != MODERN_BINDING_MUTATION_AUTHORITY
 *   SAME_TABLE != SAME_RUNTIME
 *
 * `scope_provider_bindings` carries both the legacy environment-name binding and
 * the connections the provider binding runtime owns. They are told apart by
 * `lifecycle` — NULL against anything else — and the identity index arbitrates
 * on (scope, providerClass, providerId). The modern runtime writes exactly one
 * class, `"connector"`, and the legacy act took its class from the caller: so a
 * legacy bind naming that class conflicted with a real connection and UPDATED
 * it. `state` back to «active», `revokedAt` cleared, the credential NAME
 * overwritten — and `lifecycle` untouched, so a SUSPENDED connection read as
 * active to one runtime while the other went on refusing it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { scopeProviderBindings } from "@db/schema-block2";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let scope: typeof import("../../api/runtime/actor-scope");
let acts: typeof import("../../api/runtime/authority-acts");
let binding: typeof import("../../api/runtime/provider-binding");

const HASSAN = "9821";
const DEFINITION = "iso.own";
const ADDRESS = "https://example.com/iso";

const T0 = new Date("2026-09-28T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

/** Which step of the ceremony a fixture stops at. */
type Stop = "SETUP_PENDING" | "AUTHORIZED" | "AUTHENTICATED" | "VERIFIED" | "SUSPENDED" | "REVOKED";

let handshakeOk = true;

describe("what a legacy bind may touch", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    scope = await import("../../api/runtime/actor-scope");
    acts = await import("../../api/runtime/authority-acts");
    binding = await import("../../api/runtime/provider-binding");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    registry.register({
      id: DEFINITION, displayName: "نظام مسجّل", kind: "MCP", testOnly: true,
      authMethod: "API_KEY", endpoint: { mode: "DECLARED_AT_SETUP" },
      webhook: "SIGNED_HMAC", receipt: "SIGNED_HMAC",
      supports: ["SEARCH", "TRACK"],
      adapter: {
        authenticate: async () =>
          handshakeOk
            ? { ok: true as const, accountRef: "acct" }
            : { ok: false as const, detail: "refused", reached: true },
        discover: async () => ["SEARCH", "TRACK"] as never,
        invoke: async () => ({ status: "OK" as const, value: {} }),
      },
    } as never);
    binding.setProviderDefinitionRegistry(registry);
  }, 60_000);

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    handshakeOk = true;
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, remote_executions,
        payment_intents, events, scope_policies, memberships, organizations CASCADE`),
    );
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  const org = async () =>
    (await scope.createOrganization({ principalId: HASSAN, displayName: "مصنع الأمل" })).id;

  const rowById = async (id: string) => {
    const [row] = await handle.db.select().from(scopeProviderBindings)
      .where(eq(scopeProviderBindings.id, id)).limit(1);
    return row;
  };

  const rowsFor = (scopeId: string) =>
    handle.db.select().from(scopeProviderBindings)
      .where(eq(scopeProviderBindings.scopeId, scopeId));

  /** A modern connection, stopped wherever a case needs it. */
  async function connection(scopeId: string, stop: Stop) {
    const opened = await binding.beginProviderSetup({
      principalId: HASSAN, scopeId, definitionId: DEFINITION,
      requestedCapabilities: ["SEARCH", "TRACK"], now: T0,
    });
    const id = opened.bindingId;
    if (stop === "SETUP_PENDING") return id;
    await binding.completeProviderSetup({
      bindingId: id, principalId: HASSAN, material: { apiKey: "k" },
      endpointUrl: ADDRESS, now: at(MIN),
    });
    if (stop === "AUTHORIZED") return id;
    if (stop === "SUSPENDED") {
      handshakeOk = false;
      await binding.authenticateBinding({ bindingId: id, principalId: HASSAN, now: at(2 * MIN) });
      handshakeOk = true;
      return id;
    }
    await binding.authenticateBinding({ bindingId: id, principalId: HASSAN, now: at(2 * MIN) });
    if (stop === "AUTHENTICATED") return id;
    await binding.verifyBinding({ bindingId: id, principalId: HASSAN, now: at(3 * MIN) });
    await binding.configureWebhookVerification({
      bindingId: id, principalId: HASSAN, secret: "w1", now: at(4 * MIN),
    });
    await binding.configureReceiptVerification({
      bindingId: id, principalId: HASSAN, secret: "r1", now: at(5 * MIN),
    });
    if (stop === "VERIFIED") return id;
    await binding.revokeBinding({ bindingId: id, principalId: HASSAN, now: at(10 * MIN) });
    return id;
  }

  /** A legacy bind aimed at the connector namespace. */
  const legacyAtConnector = (scopeId: string, credentialEnvName = "JASIM_STOLEN_KEY") =>
    scope.bindScopeProvider({
      principalId: HASSAN, scopeId,
      providerClass: scope.CONNECTOR_PROVIDER_CLASS, providerId: DEFINITION,
      credentialEnvName,
    });

  const performBind = async (scopeId: string, providerClass: string, providerId: string) => {
    const act = acts.getAuthorityAct("provider.bind")!;
    const acting = {
      kind: "ORGANIZATION" as const, scopeId, principalId: HASSAN,
      organizationId: scopeId, displayName: "مصنع الأمل",
    };
    const params = { providerClass, providerId, credentialEnvName: "JASIM_STOLEN_KEY" };
    const result = await act.perform({ params, principalId: HASSAN, scope: acting });
    return {
      result,
      readback: await act.readback({ result, params, principalId: HASSAN, scope: acting }),
    };
  };

  // ── 4–12, 16 · EVERY LIFECYCLE, BYTE FOR BYTE ────────────────────────────

  it("a legacy bind cannot touch a connection in any lifecycle", async () => {
    //   LEGACY_BIND_MUTATES_MODERN_ROW = 0
    //   LEGACY_BIND_REACTIVATES_SUSPENDED_STATE = 0
    //   LEGACY_BIND_MODERN_COLLISION_RAW_DB_ERROR = 0
    for (const stop of [
      "SETUP_PENDING", "AUTHORIZED", "AUTHENTICATED", "VERIFIED", "SUSPENDED", "REVOKED",
    ] as const) {
      const scopeId = await org();
      const id = await connection(scopeId, stop);
      const before = await rowById(id);
      expect(before!.lifecycle, stop).toBe(stop);

      let refusal: (Error & { code?: string }) | undefined;
      await legacyAtConnector(scopeId).catch((error: Error & { code?: string }) => {
        refusal = error;
      });
      // A typed product refusal, never a driver error.
      expect(refusal?.name, stop).toBe("ActorScopeError");
      expect(refusal?.code, stop).toBe("INVALID");
      expect(refusal?.message, stop).not.toMatch(/duplicate key|unique constraint|23505/i);

      // Every field of the connection is exactly what it was.
      expect(await rowById(id), stop).toEqual(before);
      // And no legacy row appeared beside it.
      expect(await rowsFor(scopeId), stop).toHaveLength(1);
    }
  });

  it("a suspended connection is still refused, and a verified one still usable", async () => {
    const suspendedScope = await org();
    const suspended = await connection(suspendedScope, "SUSPENDED");
    await legacyAtConnector(suspendedScope).catch(() => undefined);
    expect((await rowById(suspended))!.lifecycle).toBe("SUSPENDED");
    expect((await rowById(suspended))!.state).toBe("pending");
    expect(
      await binding.authorizedConnection({
        bindingId: suspended, onBehalfOfScopeId: suspendedScope, requiresCapability: "TRACK",
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "BINDING_NOT_USABLE" });

    const liveScope = await org();
    const verified = await connection(liveScope, "VERIFIED");
    await legacyAtConnector(liveScope).catch(() => undefined);
    const usable = await binding.authorizedConnection({
      bindingId: verified, onBehalfOfScopeId: liveScope, requiresCapability: "TRACK",
    });
    expect(usable).toMatchObject({ status: "AUTHORIZED" });
    expect(usable.status === "AUTHORIZED" && usable.connection.endpoint).toBe(ADDRESS);
  });

  it("the sealed material of a connection is untouched by an attempted collision", async () => {
    const scopeId = await org();
    const verified = await connection(scopeId, "VERIFIED");
    const before = await rowById(verified);
    const envelopesBefore = await handle.db.execute(
      sql.raw(`SELECT id, kind, version, "retiredAt" FROM provider_credentials
               WHERE "bindingId" = '${verified}' ORDER BY kind`),
    );
    await legacyAtConnector(scopeId).catch(() => undefined);
    const after = (await rowById(verified))!;
    for (const field of [
      "credentialRef", "credentialVersion",
      "webhookCredentialRef", "webhookCredentialVersion",
      "receiptCredentialRef", "receiptCredentialVersion",
      "accountRef", "accountLabel", "endpointUrl", "definitionId", "lifecycle",
      "grantedCapabilities", "state", "revokedAt", "credentialEnvName", "boundByPrincipalId",
    ] as const) {
      expect(after[field], field).toEqual(before![field]);
    }
    const envelopesAfter = await handle.db.execute(
      sql.raw(`SELECT id, kind, version, "retiredAt" FROM provider_credentials
               WHERE "bindingId" = '${verified}' ORDER BY kind`),
    );
    expect(envelopesAfter.rows).toEqual(envelopesBefore.rows);
    expect(envelopesAfter.rows).toHaveLength(3);
  });

  // ── 13, 17 · THE ACT REFUSES AND CLAIMS NOTHING ──────────────────────────

  it("the act refuses the connector namespace and never claims a connection as its effect", async () => {
    //   LEGACY_BIND_MODERN_COLLISION_REPORTS_SUCCESS = 0
    //   LEGACY_READBACK_TREATS_MODERN_ROW_AS_ITS_EFFECT = 0
    const scopeId = await org();
    const verified = await connection(scopeId, "VERIFIED");
    await expect(
      performBind(scopeId, scope.CONNECTOR_PROVIDER_CLASS, DEFINITION),
    ).rejects.toMatchObject({ name: "ActorScopeError", code: "INVALID" });
    expect((await rowById(verified))!.lifecycle).toBe("VERIFIED");

    // And were the id handed to the readback directly, it still reports nothing:
    // this act reads back its own kind of row.
    const act = acts.getAuthorityAct("provider.bind")!;
    const readback = await act.readback({
      result: { bindingId: verified },
      params: { providerClass: scope.CONNECTOR_PROVIDER_CLASS, providerId: DEFINITION },
      principalId: HASSAN,
      scope: {
        kind: "ORGANIZATION", scopeId, principalId: HASSAN,
        organizationId: scopeId, displayName: "مصنع الأمل",
      },
    });
    expect(readback.occurred).toBe(false);
  });

  it("the legacy resolver never reports a connection", async () => {
    //   LEGACY_RESOLVER_RESOLVES_MODERN_ROW = 0
    //
    // A VERIFIED connection also carries `state: "active"`, and its
    // `credentialEnvName` is NULL because its credential is sealed in the vault.
    const scopeId = await org();
    const verified = await connection(scopeId, "VERIFIED");
    expect((await rowById(verified))!.state).toBe("active");
    expect((await rowById(verified))!.credentialEnvName).toBeNull();
    expect(
      await scope.resolveScopeProvider({
        scopeId, providerClass: scope.CONNECTOR_PROVIDER_CLASS,
      }),
    ).toBeUndefined();
  });

  // ── 1–3 · THE ORDINARY LEGACY PATH IS UNCHANGED ──────────────────────────

  it("ordinary legacy classes still bind, rebind and tell the truth", async () => {
    //   NORMAL_LEGACY_BIND_REGRESSION = 0
    const scopeId = await org();
    const first = await scope.bindScopeProvider({
      principalId: HASSAN, scopeId, providerClass: "MESSAGING",
      providerId: "provider-one", credentialEnvName: "JASIM_FIRST_KEY",
    });
    expect(await rowById(first.id)).toBeDefined();
    const second = await scope.bindScopeProvider({
      principalId: HASSAN, scopeId, providerClass: "MESSAGING",
      providerId: "provider-one", credentialEnvName: "JASIM_SECOND_KEY",
    });
    expect(second.id).toBe(first.id);
    expect((await rowById(second.id))!.credentialEnvName).toBe("JASIM_SECOND_KEY");
    // Omitted means none, as the contract says.
    await scope.bindScopeProvider({
      principalId: HASSAN, scopeId, providerClass: "MESSAGING", providerId: "provider-one",
    });
    expect((await rowById(first.id))!.credentialEnvName).toBeNull();
    expect(await rowsFor(scopeId)).toHaveLength(1);
    expect(
      await scope.resolveScopeProvider({ scopeId, providerClass: "MESSAGING" }),
    ).toEqual({ providerId: "provider-one", credentialEnvName: null });
    // And a legacy class that merely LOOKS like the reserved one is ordinary.
    await scope.bindScopeProvider({
      principalId: HASSAN, scopeId, providerClass: "CONNECTORS", providerId: "x",
    });
    expect(await rowsFor(scopeId)).toHaveLength(2);
  });

  it("concurrent legacy binds of one ordinary tuple still agree on one durable id", async () => {
    const scopeId = await org();
    const settled = await Promise.allSettled([
      scope.bindScopeProvider({
        principalId: HASSAN, scopeId, providerClass: "EMAIL", providerId: "mail",
        credentialEnvName: "JASIM_A",
      }),
      scope.bindScopeProvider({
        principalId: HASSAN, scopeId, providerClass: "EMAIL", providerId: "mail",
        credentialEnvName: "JASIM_B",
      }),
    ]);
    for (const one of settled) {
      if (one.status === "rejected") {
        expect((one.reason as Error).message).not.toMatch(/duplicate key|23505/i);
      }
    }
    const rows = await rowsFor(scopeId);
    expect(rows).toHaveLength(1);
    const winners = settled
      .filter((one): one is PromiseFulfilledResult<{ id: string }> => one.status === "fulfilled")
      .map((one) => one.value.id);
    expect(winners.length).toBeGreaterThan(0);
    expect(new Set(winners)).toEqual(new Set([rows[0]!.id]));
  });

  // ── 18 · THE TWO RUNTIMES RACING FOR ONE TUPLE ───────────────────────────

  it("a legacy bind and a provider setup racing for one tuple produce one identity", async () => {
    //   CONCURRENT_LEGACY_MODERN_MIXED_ROW = 0
    //   CONCURRENT_LEGACY_MODERN_TWO_LIVE_ROWS = 0
    //   RAW_UNIQUE_VIOLATION_ESCAPES = 0
    const scopeId = await org();
    const settled = await Promise.allSettled([
      binding.beginProviderSetup({
        principalId: HASSAN, scopeId, definitionId: DEFINITION,
        requestedCapabilities: ["SEARCH"], now: T0,
      }),
      legacyAtConnector(scopeId),
      binding.beginProviderSetup({
        principalId: HASSAN, scopeId, definitionId: DEFINITION,
        requestedCapabilities: ["SEARCH"], now: T0,
      }),
      legacyAtConnector(scopeId),
    ]);
    for (const one of settled) {
      if (one.status === "rejected") {
        const reason = one.reason as Error & { code?: string };
        expect(["ActorScopeError", "ProviderBindingError"]).toContain(reason.name);
        expect(reason.message).not.toMatch(/duplicate key|unique constraint|23505/i);
      }
    }
    // The legacy calls cannot have won: the class is not theirs to write.
    const rows = await rowsFor(scopeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.providerClass).toBe(scope.CONNECTOR_PROVIDER_CLASS);
    // One identity, and it is a modern one — never a row with both semantics.
    expect(rows[0]!.lifecycle).toBe("SETUP_PENDING");
    expect(rows[0]!.credentialEnvName).toBeNull();
    expect(rows[0]!.definitionId).toBe(DEFINITION);
  });

  // ── 19 · RECONNECT IDENTITY IS UNTOUCHED ─────────────────────────────────

  it("revoked history stays terminal and a reconnect is still a new identity", async () => {
    //   RECONNECT_REUSES_REVOKED_ID = 0
    const scopeId = await org();
    const first = await connection(scopeId, "REVOKED");
    const before = await rowById(first);
    // A legacy bind may not fill the gap the revocation left, either.
    await expect(legacyAtConnector(scopeId)).rejects.toMatchObject({ code: "INVALID" });
    expect(await rowById(first)).toEqual(before);
    expect(await rowsFor(scopeId)).toHaveLength(1);

    // The ceremony still works, and still makes a new identity.
    const second = await binding.beginProviderSetup({
      principalId: HASSAN, scopeId, definitionId: DEFINITION,
      requestedCapabilities: ["SEARCH", "TRACK"], now: at(20 * MIN),
    });
    expect(second.bindingId).not.toBe(first);
    expect((await rowById(first))!.lifecycle).toBe("REVOKED");
    expect(await rowsFor(scopeId)).toHaveLength(2);
  });

  // ── 20 · ONE INVARIANT, REUSED ───────────────────────────────────────────

  it("the boundary is the lifecycle column, with no second source of truth", async () => {
    const bare = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../api/runtime/actor-scope.ts", import.meta.url), "utf8"),
    ).then(bare);
    const start = source.indexOf("export async function bindScopeProvider");
    const body = source.slice(start, source.indexOf("export async function", start + 1));
    // The class is refused in this process, and the database refuses it again.
    expect(body).toContain("providerClass === CONNECTOR_PROVIDER_CLASS");
    expect(body).toContain("setWhere: isNull(scopeProviderBindings.lifecycle)");
    // No new column invented to say what `lifecycle` already says.
    for (const invented of [
      "legacyLifecycle", "bindingRuntimeOwner", "modernBinding", "isLegacy", "runtimeOwner",
    ]) {
      expect(source, invented).not.toContain(invented);
    }
    // And one literal for the reserved class, shared by both runtimes.
    const modern = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../api/runtime/provider-binding.ts", import.meta.url), "utf8"),
    ).then(bare);
    expect(modern).not.toMatch(/providerClass, "connector"|providerClass: "connector"/);
    expect(modern).toContain("CONNECTOR_PROVIDER_CLASS");
  });
});
