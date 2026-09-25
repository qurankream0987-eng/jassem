/**
 * JASIM — WHOSE POLICY MAY CHOOSE WHICH SOURCE?
 *
 *   WHO WANTS TO KNOW != WHO OWNS THE SOURCE
 *   REQUESTING_SCOPE  != AUTHORITATIVE_SOURCE_SCOPE
 *   REQUESTER_POLICY  != SOURCE_OWNER_POLICY
 *
 * A buyer may say «for COMMIT I want a person to confirm it». A buyer may not
 * say «when you check the seller's stock, use the seller's second system».
 *
 * Three authorities, never collapsed:
 *   the requester chooses the confidence they require;
 *   the authoritative scope chooses among ITS OWN sources;
 *   canonical state chooses who is authoritative at all.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let resolver: typeof import("../../api/runtime/source-resolution");
let binding: typeof import("../../api/runtime/provider-binding");
let fabric: typeof import("../../api/runtime/economic-fabric");
let scopes: typeof import("../../api/runtime/actor-scope");

const T0 = new Date("2026-09-25T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

const reads: { bindingId: string; definitionId: string }[] = [];
const bindingOf = new Map<string, string>();

describe("whose policy chooses the source", () => {
  let sellerScope: string;
  let buyerScope: string;
  let thirdScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    resolver = await import("../../api/runtime/source-resolution");
    binding = await import("../../api/runtime/provider-binding");
    fabric = await import("../../api/runtime/economic-fabric");
    scopes = await import("../../api/runtime/actor-scope");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    const adapter = {
      authenticate: async () => ({ ok: true as const, accountRef: "acct" }),
      discover: async () => ["READ", "OBSERVE", "SEARCH"] as never,
      invoke: async (context: { bindingId: string }) => {
        reads.push({
          bindingId: context.bindingId,
          definitionId: bindingOf.get(context.bindingId) ?? "?",
        });
        return { status: "OK" as const, value: true };
      },
    };
    const base = {
      authMethod: "API_KEY" as const,
      endpoint: { mode: "FIXED" as const, baseUrl: "https://example.com/api" },
      testOnly: true,
      adapter,
    };
    // Two equally capable systems. Nothing canonical distinguishes them.
    for (const id of ["spa.first", "spa.second"]) {
      registry.register({
        ...base, id, displayName: id,
        supports: ["READ", "OBSERVE"], observes: ["availability", "attendance", "capacity"],
      });
    }
    // Capable of looking things up only. Never a source for a fact.
    registry.register({
      ...base, id: "spa.finder", displayName: "بحث",
      supports: ["SEARCH"], observes: ["availability"],
    });
    binding.setProviderDefinitionRegistry(registry);
  });

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    reads.length = 0;
    bindingOf.clear();
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, observations,
        verification_requests, notification_intents, economic_expressions,
        availability_windows, reservations, transactions, commitments, agreements,
        memberships, organizations, scope_policies, events CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'spa-%'`));
    const made: string[] = [];
    for (const name of ["بائع", "مشترٍ", "ثالث"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `spa-${randomUUID()}`, name, preferences: {} }).returning();
      made.push(String(row!.id));
    }
    [sellerScope, buyerScope, thirdScope] = made as [string, string, string];
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  async function anOffering(ownerId: string) {
    const expression = await fabric.createExpression({
      ownerId, kind: "offering", semanticType: "generic.unit", attributes: {},
    });
    await fabric.publishExpression({
      id: expression.id, ownerId, projection: { semanticType: "generic.unit", summary: "س" },
    });
    return expression.id;
  }

  async function connect(scopeId: string, definitionId: string, granted: string[]) {
    const opened = await binding.beginProviderSetup({
      principalId: scopeId, scopeId, definitionId,
      requestedCapabilities: granted, now: T0,
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
    bindingOf.set(opened.bindingId, definitionId);
    reads.length = 0;
    return opened.bindingId;
  }

  const prefer = (scopeId: string, definitionIds: string[]) =>
    scopes.setScopePolicy({
      principalId: scopeId, scopeId, policyKey: resolver.SOURCE_POLICY_KEY,
      value: { preferredProviders: definitionIds },
    });

  const ask = (
    subjectKind: string,
    subjectId: string,
    property: string,
    requestingScopeId: string,
  ) =>
    resolver.resolveFactSource({
      fact: { subjectKind, subjectId, property },
      purpose: "COMMIT", requestingScopeId, now: at(10 * MINUTE),
    });

  // ── A · MY OWN SYSTEMS, MY OWN PREFERENCE ────────────────────────────────

  it("a scope asking about its own subject ranks its own systems", async () => {
    //   AUTHORITATIVE_SCOPE_CONTROLS_PROVIDER_PREFERENCE — here they coincide.
    const subject = await anOffering(buyerScope);
    await connect(buyerScope, "spa.first", ["READ"]);
    await connect(buyerScope, "spa.second", ["READ"]);
    await prefer(buyerScope, ["spa.second"]);

    const resolved = await ask("offering", subject, "availability", buyerScope);
    expect(resolved.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect(reads).toHaveLength(1);
    expect(reads[0]!.definitionId).toBe("spa.second");
  });

  // ── B · THE DECISIVE ONE ─────────────────────────────────────────────────

  it("a buyer cannot choose which of the seller's systems is read", async () => {
    //   REQUESTER_SELECTS_FOREIGN_PROVIDER = 0
    const subject = await anOffering(sellerScope);
    await connect(sellerScope, "spa.first", ["READ"]);
    await connect(sellerScope, "spa.second", ["READ"]);
    // The buyer says which of somebody else's systems to use. It is not theirs
    // to say, so the tie stands.
    await prefer(buyerScope, ["spa.second"]);

    const resolved = await ask("offering", subject, "availability", buyerScope);
    expect(resolved.outcome).toBe("AMBIGUOUS_SOURCE");
    expect(reads).toHaveLength(0);
    expect(await count("observations")).toBe(0);
  });

  // ── C · THE OWNER'S PREFERENCE SETTLES IT ────────────────────────────────

  it("the seller's own preference settles which of the seller's systems is read", async () => {
    //   AUTHORITATIVE_SCOPE_CONTROLS_PROVIDER_PREFERENCE = PASS
    const subject = await anOffering(sellerScope);
    await connect(sellerScope, "spa.first", ["READ"]);
    await connect(sellerScope, "spa.second", ["READ"]);
    await prefer(sellerScope, ["spa.first"]);
    // And the buyer's contrary wish changes nothing.
    await prefer(buyerScope, ["spa.second"]);

    const resolved = await ask("offering", subject, "availability", buyerScope);
    expect(resolved.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect(reads).toHaveLength(1);
    expect(reads[0]!.definitionId).toBe("spa.first");
  });

  // ── D · WHAT THE REQUESTER MAY STILL DEMAND ──────────────────────────────

  it("a requester may still demand a person, and still cannot pick which person", async () => {
    //   REQUESTER_CAN_REQUIRE_STRONGER_HUMAN_CONFIRMATION = PASS
    //   REQUESTER_POLICY_CHANGES_HUMAN_AUTHORITY = 0
    const subject = await anOffering(sellerScope);
    await connect(sellerScope, "spa.first", ["READ"]);
    await scopes.setScopePolicy({
      principalId: buyerScope, scopeId: buyerScope, policyKey: resolver.SOURCE_POLICY_KEY,
      value: { humanRequiredFor: ["COMMIT"] },
    });
    const resolved = await ask("offering", subject, "availability", buyerScope);
    expect(resolved.outcome).toBe("AWAITING_HUMAN");
    expect(reads).toHaveLength(0);
    // The person asked is the subject's authority, derived canonically — the
    // buyer named nobody and could not have.
    const [request] = (
      await handle.db.execute(sql.raw(`SELECT "respondingScopeId" AS s FROM verification_requests`))
    ).rows as { s: string }[];
    expect(request!.s).toBe(sellerScope);
  });

  // ── E/F · A PREFERENCE RANKS; IT NEVER REVIVES ───────────────────────────

  it("no preference makes a revoked binding eligible", async () => {
    //   POLICY_REVIVES_UNVERIFIED_BINDING = 0
    const subject = await anOffering(sellerScope);
    const revoked = await connect(sellerScope, "spa.first", ["READ"]);
    await binding.revokeBinding({ bindingId: revoked, principalId: sellerScope, now: at(4 * MINUTE) });
    // Both sides name it. Neither can bring it back.
    await prefer(sellerScope, ["spa.first"]);
    await prefer(buyerScope, ["spa.first"]);

    const resolved = await ask("offering", subject, "availability", buyerScope);
    expect(resolved.outcome).toBe("AWAITING_HUMAN");
    expect(reads).toHaveLength(0);
  });

  it("no preference grants a capability the binding was never given", async () => {
    //   POLICY_GRANTS_MISSING_CAPABILITY = 0
    const subject = await anOffering(sellerScope);
    await connect(sellerScope, "spa.finder", ["SEARCH"]);
    await prefer(sellerScope, ["spa.finder"]);

    const resolved = await ask("offering", subject, "availability", buyerScope);
    expect(resolved.outcome).toBe("AWAITING_HUMAN");
    expect(reads).toHaveLength(0);
  });

  it("no preference widens what a system says it observes", async () => {
    //   POLICY_EXPANDS_OBSERVED_PROPERTIES = 0
    const subject = await anOffering(sellerScope);
    await connect(sellerScope, "spa.first", ["READ"]);
    await prefer(sellerScope, ["spa.first"]);
    // «condition» is not in this definition's manifest.
    const resolved = await ask("offering", subject, "condition", buyerScope);
    expect(resolved.outcome).toBe("AWAITING_HUMAN");
    expect(reads).toHaveLength(0);
  });

  // ── G/H · THE PROPERTY DECIDES WHICH SIDE OWNS THE TRUTH ─────────────────

  async function aReservation() {
    const id = `res_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO reservations (id, "ownerId", "resourceOwnerId", "resourceKind",
        "resourceId", quantity, unit, status, version, "idempotencyKey", "createdAt", "updatedAt")
        VALUES ('${id}', '${buyerScope}', '${sellerScope}', 'capacity', 'r1',
        1, 'unit', 'HELD', 1, 'idem_${randomUUID().slice(0, 8)}', now(), now())`),
    );
    return id;
  }

  it("availability on a held claim follows the capacity owner's preference", async () => {
    const subject = await aReservation();
    await connect(sellerScope, "spa.first", ["READ"]);
    await connect(sellerScope, "spa.second", ["READ"]);
    await connect(buyerScope, "spa.first", ["READ"]);
    await prefer(sellerScope, ["spa.second"]);
    await prefer(buyerScope, ["spa.first"]);

    const resolved = await ask("reservation", subject, "availability", thirdScope);
    expect(resolved.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect(reads).toHaveLength(1);
    expect(reads[0]!.definitionId).toBe("spa.second");
  });

  it("attendance on the same claim follows the other side's preference", async () => {
    const subject = await aReservation();
    await connect(sellerScope, "spa.first", ["READ"]);
    await connect(buyerScope, "spa.first", ["READ"]);
    await connect(buyerScope, "spa.second", ["READ"]);
    await prefer(buyerScope, ["spa.second"]);
    await prefer(sellerScope, ["spa.first"]);

    // The same subject, a different property, a different owner of the truth.
    const resolved = await ask("reservation", subject, "attendance", thirdScope);
    expect(resolved.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect(reads).toHaveLength(1);
    expect(reads[0]!.definitionId).toBe("spa.second");
  });

  // ── I · TWO SIDES BOTH AUTHORITATIVE ─────────────────────────────────────

  it("two authoritative scopes that both could answer is an ambiguity", async () => {
    //   MULTI_AUTHORITY_ARBITRARY_WINNER = 0
    //   REQUESTER_POLICY_SELECTS_AUTHORITY_SIDE = 0
    const id = `txn_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO transactions (id, "scopeId", parties, "agreementId",
        "termsSnapshot", "termsDigest", state, version, "createdAt", "updatedAt")
        VALUES ('${id}', '${sellerScope}', '${JSON.stringify([buyerScope])}'::jsonb,
        'agr_x', '{}'::jsonb, 'd', 'OPEN', 1, now(), now())`),
    );
    // Each side has exactly one system, and each has settled its own ranking.
    await connect(sellerScope, "spa.first", ["READ"]);
    await connect(buyerScope, "spa.second", ["READ"]);
    await prefer(sellerScope, ["spa.first"]);
    await prefer(buyerScope, ["spa.second"]);

    const resolved = await ask("transaction", id, "availability", thirdScope);
    // Local ranking settled each side. Nothing settles WHICH SIDE, and the
    // asker's wish is not allowed to.
    expect(resolved.outcome).toBe("AMBIGUOUS_SOURCE");
    expect(reads).toHaveLength(0);
  });

  async function count(table: string): Promise<number> {
    const result = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
    return (result.rows[0] as { n: number }).n;
  }
});
