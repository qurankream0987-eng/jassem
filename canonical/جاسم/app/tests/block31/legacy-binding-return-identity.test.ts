/**
 * JASIM — A RETURNED REFERENCE MUST NAME DURABLE STATE.
 *
 *   RETURNED_REFERENCE MUST NAME DURABLE_STATE
 *   UPSERT_RESULT != PREGENERATED_INPUT_ID
 *   CONFLICT_UPDATE != NEW_BINDING_IDENTITY
 *   A REFERENCE TO NOTHING != SUCCESS
 *   WRITE_SUCCEEDED != READBACK_SUCCEEDED
 *   REVOKED_HISTORY != LIVE_BINDING · RECONNECT != LEGACY_UPSERT
 *
 * `bindScopeProvider` generated `bind_<uuid>` BEFORE an upsert and returned it
 * whatever the database did. On the conflict branch Postgres updated the live row
 * that was already there, so the caller was handed an id no row carries — and
 * `provider.bind`'s readback, which looks the row up by that id, reported that
 * nothing had happened to a write that had just succeeded.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { scopeProviderBindings } from "@db/schema-block2";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let scope: typeof import("../../api/runtime/actor-scope");
let acts: typeof import("../../api/runtime/authority-acts");
let binding: typeof import("../../api/runtime/provider-binding");

const HASSAN = "9811";
const CLASS = "STORAGE";
const PROVIDER = "inventory-adapter";

describe("what a legacy bind returns", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    scope = await import("../../api/runtime/actor-scope");
    acts = await import("../../api/runtime/authority-acts");
    binding = await import("../../api/runtime/provider-binding");
  }, 60_000);

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, remote_executions,
        payment_intents, events, scope_policies, memberships, organizations CASCADE`),
    );
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  const org = async () =>
    (await scope.createOrganization({ principalId: HASSAN, displayName: "مصنع الأمل" })).id;

  const bind = (scopeId: string, credentialEnvName?: string) =>
    scope.bindScopeProvider({
      principalId: HASSAN, scopeId, providerClass: CLASS, providerId: PROVIDER,
      ...(credentialEnvName ? { credentialEnvName } : {}),
    });

  const rowsFor = (scopeId: string) =>
    handle.db.select().from(scopeProviderBindings)
      .where(eq(scopeProviderBindings.scopeId, scopeId));

  const rowById = async (id: string) => {
    const [row] = await handle.db.select().from(scopeProviderBindings)
      .where(eq(scopeProviderBindings.id, id)).limit(1);
    return row;
  };

  /** The act itself, performed and read back the way the runtime does it. */
  const performBind = async (scopeId: string, credentialEnvName?: string) => {
    const act = acts.getAuthorityAct("provider.bind")!;
    const acting = {
      kind: "ORGANIZATION" as const, scopeId, principalId: HASSAN,
      organizationId: scopeId, displayName: "مصنع الأمل",
    };
    const params = {
      providerClass: CLASS, providerId: PROVIDER,
      ...(credentialEnvName ? { credentialEnvName } : {}),
    };
    const result = await act.perform({ params, principalId: HASSAN, scope: acting });
    const readback = await act.readback({
      result, params, principalId: HASSAN, scope: acting,
    });
    return { result, readback };
  };

  // ── 1–2 · A FRESH BIND ───────────────────────────────────────────────────

  it("a fresh bind returns the id of the row it inserted", async () => {
    const scopeId = await org();
    const { id } = await bind(scopeId, "JASIM_INVENTORY_KEY");
    expect(id).toMatch(/^bind_/);
    const rows = await rowsFor(scopeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(id);
    expect(await rowById(id)).toBeDefined();
    expect(rows[0]!.credentialEnvName).toBe("JASIM_INVENTORY_KEY");
  });

  // ── 3–6 · THE CONFLICT BRANCH ────────────────────────────────────────────

  it("binding the same tuple again returns the row that already existed", async () => {
    //   UPSERT_RESULT != PREGENERATED_INPUT_ID
    //   CONFLICT_UPDATE != NEW_BINDING_IDENTITY
    const scopeId = await org();
    const first = await bind(scopeId, "JASIM_FIRST_KEY");
    const second = await bind(scopeId, "JASIM_SECOND_KEY");

    // One live row, and the SAME one.
    const rows = await rowsFor(scopeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(first.id);
    // The returned id is that row's, not the candidate generated for this call.
    expect(second.id).toBe(first.id);
    expect(await rowById(second.id)).toBeDefined();
    // And the name the second call stated is the name that is stored, because a
    // readback that reported the superseded one would be a quieter version of
    // the same untruth.
    //
    //   READBACK_REPORTS_SUPERSEDED_CREDENTIAL_NAME = 0
    expect(rows[0]!.credentialEnvName).toBe("JASIM_SECOND_KEY");
    expect(rows[0]!.state).toBe("active");
  });

  it("no candidate id ever survives without a row", async () => {
    //   A REFERENCE TO NOTHING != SUCCESS
    const scopeId = await org();
    const returned: string[] = [];
    for (let round = 0; round < 4; round += 1) {
      returned.push((await bind(scopeId, `JASIM_KEY_${round}`)).id);
    }
    // Every id handed back names a durable row, and they are all the same row.
    for (const id of returned) expect(await rowById(id)).toBeDefined();
    expect(new Set(returned).size).toBe(1);
    expect(await rowsFor(scopeId)).toHaveLength(1);
  });

  // ── 7 · THE ACT'S OWN READBACK ───────────────────────────────────────────

  it("the act reports what happened on a fresh bind and on a rebind alike", async () => {
    //   SUCCESSFUL_BIND_READBACK_OCCURRED_FALSE = 0
    //   WRITE_SUCCEEDED != READBACK_SUCCEEDED
    const scopeId = await org();
    const fresh = await performBind(scopeId, "JASIM_INVENTORY_KEY");
    expect(fresh.readback.occurred).toBe(true);
    expect(fresh.readback.detail).toContain(PROVIDER);
    expect(fresh.readback.detail).toContain("JASIM_INVENTORY_KEY");

    // The same act again — the branch that used to report nothing had happened.
    const again = await performBind(scopeId, "JASIM_REPLACEMENT_KEY");
    expect(again.readback.occurred).toBe(true);
    expect(again.readback.detail).not.toContain("No active binding");
    // It names the row that really carries the binding, and the name really on it.
    expect(again.result.bindingId).toBe(fresh.result.bindingId);
    expect(again.readback.detail).toContain("JASIM_REPLACEMENT_KEY");
    expect(again.readback.detail).not.toContain("JASIM_INVENTORY_KEY");
    expect(await rowsFor(scopeId)).toHaveLength(1);
  });

  it("a bind with no credential name says so, rather than keeping the old one", async () => {
    const scopeId = await org();
    await performBind(scopeId, "JASIM_INVENTORY_KEY");
    const bare = await performBind(scopeId);
    expect(bare.readback.occurred).toBe(true);
    // Both branches store exactly what the call said, «none» included — which is
    // what the insert branch always did.
    expect((await rowsFor(scopeId))[0]!.credentialEnvName).toBeNull();
    expect(bare.readback.detail).toContain("no credential");
  });

  // ── 8–10 · REVOKED HISTORY IS NOT A SLOT ─────────────────────────────────

  it("with only revoked history, a legacy bind creates a new live row and touches none", async () => {
    //   REVOKED_HISTORY != LIVE_BINDING
    //   ONLY_REVOKED_HISTORY_CREATES_NEW_ID
    const scopeId = await org();
    const historical = `bind_${randomUUID()}`;
    const revokedAt = new Date("2026-09-01T00:00:00Z");
    await handle.db.insert(scopeProviderBindings).values({
      id: historical, scopeId, providerClass: CLASS, providerId: PROVIDER,
      lifecycle: "REVOKED", state: "revoked", revokedAt,
      credentialEnvName: "JASIM_RETIRED_KEY", boundByPrincipalId: HASSAN,
    } as never);

    const fresh = await bind(scopeId, "JASIM_NEW_KEY");
    expect(fresh.id).not.toBe(historical);
    expect(await rowById(fresh.id)).toBeDefined();

    // The historical row is exactly as it was.
    const old = (await rowById(historical))!;
    expect(old.lifecycle).toBe("REVOKED");
    expect(old.state).toBe("revoked");
    expect(old.revokedAt?.getTime()).toBe(revokedAt.getTime());
    expect(old.credentialEnvName).toBe("JASIM_RETIRED_KEY");

    //   REVOKED_ROW_MUTATED_BY_LEGACY_REBIND = 0
    const all = await rowsFor(scopeId);
    expect(all).toHaveLength(2);
    expect(all.filter((row) => row.lifecycle !== "REVOKED")).toHaveLength(1);
  });

  it("with a revoked row beside a live one, the live one is what gets updated", async () => {
    const scopeId = await org();
    const historical = `bind_${randomUUID()}`;
    await handle.db.insert(scopeProviderBindings).values({
      id: historical, scopeId, providerClass: CLASS, providerId: PROVIDER,
      lifecycle: "REVOKED", state: "revoked", revokedAt: new Date("2026-09-01T00:00:00Z"),
      credentialEnvName: "JASIM_RETIRED_KEY", boundByPrincipalId: HASSAN,
    } as never);
    const live = await bind(scopeId, "JASIM_LIVE_KEY");
    const again = await bind(scopeId, "JASIM_ROTATED_KEY");

    expect(again.id).toBe(live.id);
    expect(again.id).not.toBe(historical);
    expect((await rowById(historical))!.credentialEnvName).toBe("JASIM_RETIRED_KEY");
    expect((await rowById(historical))!.state).toBe("revoked");
    expect((await rowById(live.id))!.credentialEnvName).toBe("JASIM_ROTATED_KEY");
    expect(await rowsFor(scopeId)).toHaveLength(2);
  });

  // ── 11–12, 14 · CONCURRENCY ──────────────────────────────────────────────

  it("concurrent binds of one tuple agree on one durable id", async () => {
    //   CONCURRENT_BIND_RETURNED_IDS_DIVERGE = 0
    //   TWO_SIMULTANEOUS_LIVE_BINDINGS = 0
    //   RAW_UNIQUE_VIOLATION_ESCAPES = 0
    const scopeId = await org();
    const settled = await Promise.allSettled([
      bind(scopeId, "JASIM_A"), bind(scopeId, "JASIM_B"),
      bind(scopeId, "JASIM_C"), bind(scopeId, "JASIM_D"),
    ]);
    // No driver error reaches a caller.
    for (const one of settled) {
      if (one.status === "rejected") {
        const reason = one.reason as Error;
        expect(reason.message).not.toMatch(/duplicate key|unique constraint|23505/i);
      }
    }
    const rows = await rowsFor(scopeId);
    expect(rows).toHaveLength(1);
    const winners = settled
      .filter((one): one is PromiseFulfilledResult<{ id: string }> => one.status === "fulfilled")
      .map((one) => one.value.id);
    expect(winners.length).toBeGreaterThan(0);
    // Whatever succeeded named the one row that exists.
    expect(new Set(winners)).toEqual(new Set([rows[0]!.id]));
    for (const id of winners) expect(await rowById(id)).toBeDefined();
  });

  // ── 13 · A LEGACY ROW IS LIVE FOR CONFLICT PURPOSES ──────────────────────

  it("a NULL-lifecycle row is what a rebind conflicts with", async () => {
    //   LEGACY_NULL_ROW_ESCAPES_LIVE_CONSTRAINT = 0
    const scopeId = await org();
    const first = await bind(scopeId, "JASIM_FIRST_KEY");
    expect((await rowById(first.id))!.lifecycle).toBeNull();
    const second = await bind(scopeId, "JASIM_SECOND_KEY");
    expect(second.id).toBe(first.id);
    expect(await rowsFor(scopeId)).toHaveLength(1);
    // Still legacy: nothing about this path invents a lifecycle.
    expect((await rowById(second.id))!.lifecycle).toBeNull();
    // And a legacy row is still not an account for the connector runtime.
    expect(
      await binding.accountBindingFor({ scopeId, definitionId: PROVIDER }),
    ).toBeNull();
  });

  // ── RESOLUTION IS UNCHANGED ──────────────────────────────────────────────

  it("resolution still finds the live binding and never the revoked history", async () => {
    const scopeId = await org();
    const historical = `bind_${randomUUID()}`;
    await handle.db.insert(scopeProviderBindings).values({
      id: historical, scopeId, providerClass: CLASS, providerId: "old-adapter",
      lifecycle: "REVOKED", state: "revoked", revokedAt: new Date("2026-09-01T00:00:00Z"),
      credentialEnvName: "JASIM_RETIRED_KEY", boundByPrincipalId: HASSAN,
    } as never);
    await bind(scopeId, "JASIM_LIVE_KEY");
    expect(await scope.resolveScopeProvider({ scopeId, providerClass: CLASS })).toEqual({
      providerId: PROVIDER, credentialEnvName: "JASIM_LIVE_KEY",
    });
  });

  // ── 15 · NO RECONNECT REGRESSION, AND NO SHARED PATH ─────────────────────

  it("the modern reconnect ceremony is untouched by any of this", async () => {
    //   RECONNECT_REUSES_REVOKED_ID = 0 · RECONNECT != LEGACY_UPSERT
    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    registry.register({
      id: "lb.own", displayName: "نظام", kind: "MCP", testOnly: true,
      authMethod: "API_KEY", endpoint: { mode: "DECLARED_AT_SETUP" },
      supports: ["SEARCH", "TRACK"],
      adapter: {
        authenticate: async () => ({ ok: true as const, accountRef: "acct" }),
        discover: async () => ["SEARCH", "TRACK"] as never,
        invoke: async () => ({ status: "OK" as const, value: {} }),
      },
    } as never);
    binding.setProviderDefinitionRegistry(registry);
    const scopeId = await org();
    const T0 = new Date("2026-09-28T10:00:00Z");
    const at = (ms: number) => new Date(T0.getTime() + ms);
    const connect = async (endpointUrl: string, t: number) => {
      const opened = await binding.beginProviderSetup({
        principalId: HASSAN, scopeId, definitionId: "lb.own",
        requestedCapabilities: ["SEARCH", "TRACK"], now: at(t),
      });
      await binding.completeProviderSetup({
        bindingId: opened.bindingId, principalId: HASSAN,
        material: { apiKey: "k" }, endpointUrl, now: at(t + 60_000),
      });
      await binding.authenticateBinding({
        bindingId: opened.bindingId, principalId: HASSAN, now: at(t + 120_000),
      });
      await binding.verifyBinding({
        bindingId: opened.bindingId, principalId: HASSAN, now: at(t + 180_000),
      });
      return opened.bindingId;
    };
    const first = await connect("https://example.com/first", 0);
    await binding.revokeBinding({ bindingId: first, principalId: HASSAN, now: at(600_000) });
    const second = await connect("https://example.org/second", 1_200_000);
    // A new identity, and the old one untouched history.
    expect(second).not.toBe(first);
    expect((await rowById(first))!.lifecycle).toBe("REVOKED");
    expect((await rowById(first))!.endpointUrl).toBe("https://example.com/first");
    expect((await rowById(second))!.endpointUrl).toBe("https://example.org/second");
    // The legacy upsert is a different path and cannot reach either of them: it
    // is keyed on a providerClass the connector runtime never writes.
    const legacy = await bind(scopeId, "JASIM_LEGACY_KEY");
    expect(legacy.id).not.toBe(first);
    expect(legacy.id).not.toBe(second);
    expect((await rowById(first))!.lifecycle).toBe("REVOKED");
    expect((await rowById(second))!.lifecycle).toBe("VERIFIED");
    expect((await rowById(second))!.credentialEnvName).toBeNull();
    binding.setProviderDefinitionRegistry(undefined);
  }, 60_000);

  // ── THE WRITE TELLS US, AND NOTHING ELSE DOES ────────────────────────────

  it("the canonical id comes from the write, not from a second lookup", async () => {
    const source = await readFile(
      new URL("../../api/runtime/actor-scope.ts", import.meta.url), "utf8",
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    const start = source.indexOf("export async function bindScopeProvider");
    const body = source.slice(start, source.indexOf("export async function", start + 1));
    // The write returns the row it wrote.
    expect(body).toContain(".returning({ id: scopeProviderBindings.id })");
    expect(body).toContain("return { id: persisted.id };");
    // The candidate is never returned, and nothing looks the row up again.
    expect(body).not.toMatch(/return \{ id \};|return \{ id: candidateId \}/);
    expect(body).not.toContain(".select()");
    expect(body).not.toMatch(/desc\(|orderBy|limit\(/);
    // The partial predicate the previous phase established is still named.
    expect(body).toContain("IS DISTINCT FROM 'REVOKED'");
    // No table and no migration: this phase changed one statement.
    expect(body).not.toMatch(/CREATE|ALTER|pgTable/);
  });
});
