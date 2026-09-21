/**
 * JASIM — A WORLD OUTLIVES THE CONVERSATION THAT ASKED FOR IT.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   CONVERSATION -> SEMANTIC ROUTER -> PERSISTENT_WORLD
 *     -> VALIDATED DEFINITION -> SCOPE -> POLICY -> ATOMIC COMMIT
 *       -> worldId · version · durable event · canonical projection
 *
 *   ROUTED != MATERIALIZED
 *   MATERIALIZED != CONFIGURED
 *   CONFIGURED != EXTERNALLY_CONNECTED
 *
 * Everything here runs against a real PostgreSQL database with the real
 * migrations. "Persisted" means read back through a fresh query after the turn
 * that wrote it has returned — never a value still sitting in a response.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let world: typeof import("../../api/runtime/world-runtime");
let scopes: typeof import("../../api/runtime/actor-scope");
let acts: typeof import("../../api/runtime/authority-acts");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

type Proposal = import("../../api/runtime/world-runtime").WorldDefinitionProposal;
type ActingScope = import("../../api/runtime/actor-scope").ActingScope;

/**
 * Five operational contexts nothing in the implementation anticipated, plus a
 * sixth that is not even a business. If any of them needed a branch, a type or
 * a renderer of its own, generality has failed.
 *
 *   DOMAIN_WORLD_TYPES_ADDED = 0
 */
const HOLDOUTS: readonly { id: string; goal: string; definition: Proposal }[] = [
  {
    id: "laboratory_instrument_pool",
    goal: "أنشئ نظاماً دائماً لإدارة ساعات أجهزة المختبر",
    definition: {
      title: "مجمع أجهزة المختبر",
      entities: [
        { key: "instrument", label: "جهاز", fields: [{ key: "hours_free", label: "ساعات متاحة", type: "number" }] },
        { key: "booking", label: "حجز", fields: [{ key: "starts_at", label: "يبدأ", type: "datetime" }] },
      ],
      relations: [{ key: "booked", label: "محجوز", from: "booking", to: "instrument", cardinality: "many_to_one" }],
      policies: [{ key: "long_booking", label: "حجز طويل", target: "booking", condition: "hours > 4", effect: "require_approval" }],
      workflows: [],
      participants: [{ key: "operator", label: "مشغّل", capacity: "operates" }],
    },
  },
  {
    id: "community_lending_cooperative",
    goal: "أنشئ نظاماً دائماً لتعاونية إعارة",
    definition: {
      title: "تعاونية الإعارة",
      entities: [
        { key: "item", label: "غرض", fields: [{ key: "condition", label: "الحالة", type: "string" }] },
        { key: "member", label: "عضو", fields: [{ key: "joined_at", label: "انضم", type: "date" }] },
      ],
      relations: [{ key: "borrowed", label: "استعار", from: "member", to: "item", cardinality: "many_to_many" }],
      policies: [],
      workflows: [{ key: "return_check", label: "فحص الإرجاع", steps: [{ key: "inspect", label: "يُفحص" }] }],
      participants: [],
    },
  },
  {
    id: "temporary_event_operation",
    goal: "أنشئ نظاماً دائماً لتشغيل فعالية",
    definition: {
      title: "تشغيل فعالية",
      entities: [{ key: "station", label: "موقع", fields: [{ key: "capacity", label: "السعة", type: "number" }] }],
      relations: [],
      policies: [{ key: "overflow", label: "تجاوز السعة", target: "station", condition: "load > capacity", effect: "deny" }],
      workflows: [],
      participants: [{ key: "volunteer", label: "متطوع", capacity: "staffs" }],
    },
  },
  {
    id: "shared_agricultural_capacity",
    goal: "أنشئ نظاماً دائماً لمشاركة طاقة زراعية",
    definition: {
      title: "طاقة زراعية مشتركة",
      entities: [
        { key: "plot", label: "قطعة", fields: [{ key: "area", label: "المساحة", type: "number" }] },
        { key: "window", label: "نافذة", fields: [{ key: "opens_at", label: "تفتح", type: "date" }] },
      ],
      relations: [{ key: "allocated", label: "مخصصة", from: "window", to: "plot", cardinality: "many_to_one" }],
      policies: [],
      workflows: [],
      participants: [],
    },
  },
  {
    id: "industrial_maintenance_coordination",
    goal: "أنشئ نظاماً دائماً لتنسيق الصيانة",
    definition: {
      title: "تنسيق الصيانة",
      entities: [{ key: "asset", label: "أصل", fields: [{ key: "last_serviced", label: "آخر صيانة", type: "date" }] }],
      relations: [],
      policies: [{ key: "overdue", label: "متأخر", target: "asset", condition: "days_since > 90", effect: "warn" }],
      workflows: [{ key: "dispatch", label: "إرسال فني", steps: [{ key: "assign", label: "يُسنَد" }] }],
      participants: [{ key: "technician", label: "فني", capacity: "services" }],
    },
  },
  {
    id: "blind_falconry_stand_rota",
    // Not in the implementation, not in the brief's examples, and not a
    // business. If the runtime needs to know what this is, it is not general.
    goal: "أنشئ نظاماً دائماً لتناوب مقاعد الصقور",
    definition: {
      title: "تناوب مقاعد الصقور",
      entities: [
        { key: "stand", label: "مقعد", fields: [{ key: "shade", label: "ظل", type: "boolean" }] },
        { key: "turn", label: "دور", fields: [{ key: "night", label: "الليلة", type: "date" }] },
      ],
      relations: [{ key: "rota", label: "تناوب", from: "turn", to: "stand", cardinality: "many_to_one" }],
      policies: [],
      workflows: [],
      participants: [{ key: "keeper", label: "حاضن", capacity: "keeps" }],
    },
  },
];

describe("a persistent world is canonical state, not a routed intention", () => {
  let actor: typeof users.$inferSelect;
  let scope: ActingScope;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    world = await import("../../api/runtime/world-runtime");
    scopes = await import("../../api/runtime/actor-scope");
    acts = await import("../../api/runtime/authority-acts");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE events, system_versions, generated_systems,
        scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'pw-%'`));
    const [row] = await handle.db
      .insert(users)
      .values({ unionId: `pw-${randomUUID()}`, name: "سلمى", preferences: {} })
      .returning();
    actor = row!;
    scope = { kind: "PERSONAL", scopeId: String(actor.id), principalId: String(actor.id) };
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const materialize = (definition: Proposal, requestKey = randomUUID(), as: ActingScope = scope) =>
    world.materializeWorld({ proposal: definition, scope: as, requestKey, statedAs: "test" });

  /** A real turn, with the model saying only what a model is allowed to say. */
  async function turn(
    content: string,
    payload: Record<string, unknown>,
    inConversation?: string,
    actingScope?: { intent: "PERSONAL" | "ORGANIZATION"; organizationId?: string },
  ) {
    const conversation = inConversation
      ? { id: inConversation }
      : await runtime.createRuntimeConversation({ ownerId: String(actor.id), title: "worlds" });
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "direct_action",
        label: "نظام",
        goal: "نظام دائم",
        intent: {
          requiredCapabilities: [],
          missingInputs: [],
          inputs: {},
          risk: "medium",
          persistence: "durable",
          effects: "none",
        },
        confidence: 0.9,
        ...(actingScope ? { actingScope } : {}),
        world: payload,
      }),
      provider: "openai",
      model: "stub-for-persistent-world",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: String(actor.id),
      conversationId: conversation.id,
      content,
    });
    return {
      conversationId: conversation.id,
      result,
      output: result.output as Record<string, unknown>,
    };
  }

  /** Reading the database directly. Not a service, not a cache, not a response. */
  async function rowsFor(worldKey: string) {
    const systems = await handle.db.execute(
      sql.raw(`SELECT "worldKey", "scopeId", version, status FROM generated_systems WHERE "worldKey" = '${worldKey}'`),
    );
    const versions = await handle.db.execute(
      sql.raw(`SELECT v.version, v.status FROM system_versions v
        JOIN generated_systems g ON g.id = v."systemId"
        WHERE g."worldKey" = '${worldKey}' ORDER BY v.id`),
    );
    return { systems: systems.rows, versions: versions.rows };
  }

  // ── 1. Materialization from a conversation ────────────────────────────────

  it("«أنشئ لي نظاماً دائماً» creates a world, a version and a durable event", async () => {
    const { output } = await turn(HOLDOUTS[0]!.goal, {
      intent: "MATERIALIZE",
      definition: HOLDOUTS[0]!.definition,
    });
    expect(output.state).toBe("MATERIALIZED");
    expect(output.cause).toBe("WORLD_MATERIALIZED");
    const projected = output.world as { worldId: string; version: string; counts: { entities: number } };
    expect(projected.version).toBe("1.0.0");
    expect(projected.counts.entities).toBe(2);

    const stored = await rowsFor(projected.worldId);
    expect(stored.systems).toHaveLength(1);
    expect((stored.systems[0] as { version: string; status: string }).version).toBe("1.0.0");
    expect((stored.systems[0] as { status: string }).status).toBe("active");
    expect(stored.versions).toHaveLength(1);

    const ledger = await handle.db.execute(
      sql.raw(`SELECT type, payload FROM events WHERE type LIKE 'WORLD_%' ORDER BY id`),
    );
    expect(ledger.rows.map((entry) => (entry as { type: string }).type)).toEqual(["WORLD_MATERIALIZED"]);
  });

  it("the surface it returns is a canonical projection, not a generated application", async () => {
    //   UI != WORLD · UI != CANONICAL STATE
    const { output } = await turn(HOLDOUTS[0]!.goal, {
      intent: "MATERIALIZE",
      definition: HOLDOUTS[0]!.definition,
    });
    const presentation = output.presentation as { primitive: string; data: Record<string, unknown> };
    expect(presentation.primitive).toBe("WORLD_SUMMARY");
    expect(presentation.data.externallyConnected).toBe(false);
    // No code of any kind reaches a surface.
    expect(JSON.stringify(presentation)).not.toMatch(/<script|function\s*\(|=>/);
  });

  // ── 2. Persistence, proven past the process that wrote it ─────────────────

  it("survives the turn, the response and the runtime context that made it", async () => {
    const { output } = await turn(HOLDOUTS[1]!.goal, {
      intent: "MATERIALIZE",
      definition: HOLDOUTS[1]!.definition,
    });
    const worldId = (output.world as { worldId: string }).worldId;

    // A read that shares nothing with the turn: a fresh call, a fresh query,
    // no React state, no response metadata, no run.
    const reread = await world.readWorld({ worldId, scope });
    expect(reread?.version).toBe("1.0.0");
    expect(reread?.definition.entities.map((entity) => entity.key)).toEqual(["item", "member"]);
    expect(reread?.definition.workflows[0]!.steps[0]!.key).toBe("inspect");
  });

  // ── 3. Versioning, and history that is not erased ─────────────────────────

  it("a change set makes a new version and leaves the old one readable", async () => {
    const { record } = await materialize(HOLDOUTS[2]!.definition);
    const applied = await world.applyWorldChangeSet({
      worldId: record.worldId,
      scope,
      changes: [
        { operation: "add", target: "entity", key: "shift", value: { label: "وردية", fields: [] } },
      ],
      expectedVersion: record.version,
      requestKey: randomUUID(),
    });
    expect(applied.record.version).not.toBe(record.version);

    const history = await world.worldHistory({ worldId: record.worldId, scope });
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.status).sort()).toEqual(["active", "retired"]);

    // The superseded version is not a tombstone. It still says what it said.
    const old = await world.readWorldVersion({
      worldId: record.worldId,
      scope,
      version: record.version,
    });
    expect(old!.entities.map((entity) => entity.key)).not.toContain("shift");
    const current = await world.readWorldVersion({
      worldId: record.worldId,
      scope,
      version: applied.record.version,
    });
    expect(current!.entities.map((entity) => entity.key)).toContain("shift");
  });

  it("restoring an earlier shape creates a new version instead of erasing history", async () => {
    const { record } = await materialize(HOLDOUTS[2]!.definition);
    const added = await world.applyWorldChangeSet({
      worldId: record.worldId,
      scope,
      changes: [{ operation: "add", target: "entity", key: "shift", value: { label: "وردية", fields: [] } }],
      expectedVersion: record.version,
      requestKey: randomUUID(),
    });
    const removed = await world.applyWorldChangeSet({
      worldId: record.worldId,
      scope,
      changes: [{ operation: "remove", target: "entity", key: "shift" }],
      expectedVersion: added.record.version,
      requestKey: randomUUID(),
    });
    // Back to the same shape, and forward to a third version.
    expect(removed.record.definition.entities.map((entity) => entity.key)).toEqual(
      record.definition.entities.map((entity) => entity.key),
    );
    const history = await world.worldHistory({ worldId: record.worldId, scope });
    expect(history.length).toBeGreaterThanOrEqual(3);
  });

  // ── 4. Atomicity, against the real database ───────────────────────────────

  it("a change set with one bad change writes none of the others", async () => {
    //   NO PARTIALLY MATERIALIZED WORLD
    const { record } = await materialize(HOLDOUTS[3]!.definition);
    await expect(
      world.applyWorldChangeSet({
        worldId: record.worldId,
        scope,
        changes: [
          { operation: "add", target: "entity", key: "one", value: { label: "١", fields: [] } },
          { operation: "add", target: "entity", key: "two", value: { label: "٢", fields: [] } },
          { operation: "add", target: "entity", key: "three", value: { label: "٣", fields: [] } },
          { operation: "remove", target: "entity", key: "ghost" },
          { operation: "add", target: "entity", key: "five", value: { label: "٥", fields: [] } },
        ],
        expectedVersion: record.version,
        requestKey: randomUUID(),
      }),
    ).rejects.toThrow(/change 4 of 5/);

    const stored = await rowsFor(record.worldId);
    expect((stored.systems[0] as { version: string }).version).toBe(record.version);
    expect(stored.versions).toHaveLength(1);
    const reread = await world.readWorld({ worldId: record.worldId, scope });
    for (const key of ["one", "two", "three", "five"]) {
      expect(reread!.definition.entities.map((entity) => entity.key)).not.toContain(key);
    }
  });

  // ── 5. Concurrency ────────────────────────────────────────────────────────

  it("a mutation built on a stale version is refused, and the newer one survives", async () => {
    //   NO LAST-WRITE-WINS FOR AUTHORITY-BEARING STRUCTURAL STATE
    const { record } = await materialize(HOLDOUTS[4]!.definition);
    const staleVersion = record.version;

    const winner = await world.applyWorldChangeSet({
      worldId: record.worldId,
      scope,
      changes: [{ operation: "add", target: "entity", key: "crew", value: { label: "طاقم", fields: [] } }],
      expectedVersion: staleVersion,
      requestKey: randomUUID(),
    });

    let conflict: unknown;
    try {
      await world.applyWorldChangeSet({
        worldId: record.worldId,
        scope,
        changes: [{ operation: "add", target: "entity", key: "depot", value: { label: "مستودع", fields: [] } }],
        // Built on what was read BEFORE the winner landed.
        expectedVersion: staleVersion,
        requestKey: randomUUID(),
      });
    } catch (error) {
      conflict = error;
    }
    expect((conflict as { code: string }).code).toBe("CONFLICT");
    // And it says what to rebase onto rather than only that something failed.
    expect((conflict as { currentVersion: string }).currentVersion).toBe(winner.record.version);

    const reread = await world.readWorld({ worldId: record.worldId, scope });
    expect(reread!.version).toBe(winner.record.version);
    const keys = reread!.definition.entities.map((entity) => entity.key);
    expect(keys).toContain("crew");
    expect(keys).not.toContain("depot");
  });

  // ── 6. Idempotency and replay ─────────────────────────────────────────────

  it("the same materialization request retried makes one world, not two", async () => {
    const requestKey = randomUUID();
    const first = await materialize(HOLDOUTS[0]!.definition, requestKey);
    const second = await materialize(HOLDOUTS[0]!.definition, requestKey);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.worldId).toBe(first.record.worldId);
    const all = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM generated_systems`));
    expect((all.rows[0] as { n: number }).n).toBe(1);
  });

  it("the same change set replayed is one semantic mutation", async () => {
    const { record } = await materialize(HOLDOUTS[1]!.definition);
    const key = randomUUID();
    const changes = [
      { operation: "add" as const, target: "entity" as const, key: "shelf", value: { label: "رف", fields: [] } },
    ];
    const first = await world.applyWorldChangeSet({
      worldId: record.worldId, scope, changes, expectedVersion: record.version, requestKey: key,
    });
    const again = await world.applyWorldChangeSet({
      worldId: record.worldId, scope, changes, expectedVersion: record.version, requestKey: key,
    });
    expect(again.unchanged).toBe(true);
    expect(again.record.version).toBe(first.record.version);
    const stored = await rowsFor(record.worldId);
    expect(stored.versions).toHaveLength(2);
  });

  it("the same change arriving under a different key is still one mutation", async () => {
    // The request key catches a retry. The semantic digest catches the same
    // decision arriving twice by another road, which is the case a key cannot
    // see — and neither of them writes a second version.
    const { record } = await materialize(HOLDOUTS[1]!.definition);
    const changes = [
      { operation: "add" as const, target: "entity" as const, key: "crate", value: { label: "صندوق", fields: [] } },
    ];
    const first = await world.applyWorldChangeSet({
      worldId: record.worldId, scope, changes, expectedVersion: record.version, requestKey: randomUUID(),
    });
    const other = await world.applyWorldChangeSet({
      worldId: record.worldId,
      scope,
      // Re-derived from the CURRENT world, so it is a no-op change set rather
      // than a repeat of the one above: the same final shape either way.
      changes: [{ operation: "replace", target: "entity", key: "crate", value: { label: "صندوق", fields: [] } }],
      expectedVersion: first.record.version,
      requestKey: randomUUID(),
    });
    expect(other.unchanged).toBe(true);
    expect(other.record.version).toBe(first.record.version);
    const stored = await rowsFor(record.worldId);
    expect(stored.versions).toHaveLength(2);
  });

  // ── 7. Ownership and scope ────────────────────────────────────────────────

  it("another owner cannot read or change this world", async () => {
    const { record } = await materialize(HOLDOUTS[0]!.definition);
    const [other] = await handle.db
      .insert(users)
      .values({ unionId: `pw-${randomUUID()}`, name: "خالد", preferences: {} })
      .returning();
    const intruder: ActingScope = {
      kind: "PERSONAL",
      scopeId: String(other!.id),
      principalId: String(other!.id),
    };
    // Not found and not permitted are the same answer across scopes.
    expect(await world.readWorld({ worldId: record.worldId, scope: intruder })).toBeUndefined();
    await expect(
      world.applyWorldChangeSet({
        worldId: record.worldId,
        scope: intruder,
        changes: [{ operation: "add", target: "entity", key: "x", value: { label: "X", fields: [] } }],
        expectedVersion: record.version,
        requestKey: randomUUID(),
      }),
    ).rejects.toThrow(/No such world/);
    expect(await world.listWorlds(intruder)).toHaveLength(0);
  });

  it("a scope cannot be smuggled through the definition or a change", async () => {
    await expect(
      materialize({ ...HOLDOUTS[0]!.definition, ownerId: "1" } as never),
    ).rejects.toThrow(/runtime's word/);
    const { record } = await materialize(HOLDOUTS[0]!.definition);
    await expect(
      world.applyWorldChangeSet({
        worldId: record.worldId,
        scope,
        changes: [
          { operation: "add", target: "entity", key: "x", value: { label: "X", scopeId: "999" } },
        ],
        expectedVersion: record.version,
        requestKey: randomUUID(),
      }),
    ).rejects.toThrow(/runtime's word/);
  });

  it("an organization owns a world through the membership that already exists", async () => {
    const organization = await scopes.createOrganization({
      principalId: String(actor.id),
      displayName: "مختبر النور",
    });
    const orgScope: ActingScope = {
      kind: "ORGANIZATION",
      scopeId: scopes.organizationScopeId(organization.id),
      principalId: String(actor.id),
      organizationId: organization.id,
      displayName: "مختبر النور",
    };
    const { record } = await materialize(HOLDOUTS[0]!.definition, randomUUID(), orgScope);
    expect(record.scopeId).toBe(orgScope.scopeId);
    // The person's own scope is a different scope, and does not see it.
    expect(await world.readWorld({ worldId: record.worldId, scope })).toBeUndefined();
    expect(await world.readWorld({ worldId: record.worldId, scope: orgScope })).toBeTruthy();

    // A member with no standing cannot change it.
    const [outsider] = await handle.db
      .insert(users)
      .values({ unionId: `pw-${randomUUID()}`, name: "غريب", preferences: {} })
      .returning();
    await expect(
      world.applyWorldChangeSet({
        worldId: record.worldId,
        scope: { ...orgScope, principalId: String(outsider!.id) },
        changes: [{ operation: "add", target: "entity", key: "x", value: { label: "X", fields: [] } }],
        expectedVersion: record.version,
        requestKey: randomUUID(),
      }),
    ).rejects.toThrow(/may not make that change/);
  });

  // ── 8. Policy and authority ───────────────────────────────────────────────

  it("a rule of the scope can forbid a world change, and nothing proceeds past it", async () => {
    const { record } = await materialize(HOLDOUTS[0]!.definition);
    await scopes.setScopePolicy({
      principalId: String(actor.id),
      scopeId: scope.scopeId,
      policyKey: "world_freeze",
      value: {
        policySchema: "jasim.policy/1",
        actions: ["world.structural"],
        conditions: [],
        effect: "DENY",
      },
    });
    await expect(
      world.applyWorldChangeSet({
        worldId: record.worldId,
        scope,
        changes: [{ operation: "add", target: "entity", key: "x", value: { label: "X", fields: [] } }],
        expectedVersion: record.version,
        requestKey: randomUUID(),
      }),
    ).rejects.toThrow(/forbids/);
    const reread = await world.readWorld({ worldId: record.worldId, scope });
    expect(reread!.version).toBe(record.version);
  });

  it("a policy change is an authority act, not a sentence in a conversation", async () => {
    //   APPROVAL != CLICK
    const { record } = await materialize(HOLDOUTS[0]!.definition);
    let refused: unknown;
    try {
      await world.applyWorldChangeSet({
        worldId: record.worldId,
        scope,
        changes: [
          {
            operation: "add",
            target: "policy",
            key: "cap",
            value: { label: "حد", target: "instrument", condition: "hours > 8", effect: "deny" },
          },
        ],
        expectedVersion: record.version,
        requestKey: randomUUID(),
      });
    } catch (error) {
      refused = error;
    }
    expect((refused as { code: string }).code).toBe("NEEDS_AUTHORITY");
    expect(await world.worldHistory({ worldId: record.worldId, scope })).toHaveLength(1);
  });

  it("the act renders what the change actually is, and applies it once cited", async () => {
    const { record } = await materialize(HOLDOUTS[0]!.definition);
    const changes = [
      {
        operation: "add",
        target: "policy",
        key: "cap",
        // No class is stated. The RUNTIME decides what this is, and the
        // statement a person reads says POLICY because that is what it does.
        value: { label: "حد", target: "instrument", condition: "hours > 8", effect: "deny" },
      },
    ];
    const act = acts.getAuthorityAct("world.evolve")!;
    const expanded = await act.expand!(
      { worldId: record.worldId, expectedVersion: record.version, changeSet: { changes } },
      scope,
    );
    expect(expanded.mutationClass).toBe("POLICY");
    expect(String(expanded.residual)).toContain("لا يُحذف");

    const performed = await act.perform({
      params: {
        worldId: record.worldId,
        expectedVersion: record.version,
        changeSet: { changes },
      },
      principalId: String(actor.id),
      scope,
    });
    const verified = await act.readback({
      result: performed,
      params: {},
      principalId: String(actor.id),
      scope,
    });
    expect(verified.occurred).toBe(true);
    const reread = await world.readWorld({ worldId: record.worldId, scope });
    expect(reread!.definition.policies.map((policy) => policy.key)).toContain("cap");
  });

  it("a policy change runs through the request-and-cite path, and asking performs nothing", async () => {
    // The same door every other authority act uses: the runtime renders a
    // statement, the person reads it, and the digest of what they read is what
    // authorizes. Asking is not doing.
    const { record } = await materialize(HOLDOUTS[0]!.definition);
    const changes = [
      {
        operation: "add",
        target: "policy",
        key: "cap",
        value: { label: "حد", target: "instrument", condition: "hours > 8", effect: "deny" },
      },
    ];
    const asked = await acts.requestAuthorityAct({
      actType: "world.evolve",
      principalId: String(actor.id),
      scope,
      params: {
        worldId: record.worldId,
        expectedVersion: record.version,
        changeSet: { changes },
      },
    });
    // Nothing happened yet, and the statement says what it will do.
    expect((await world.worldHistory({ worldId: record.worldId, scope }))).toHaveLength(1);
    expect(JSON.stringify(asked.statement)).toContain("POLICY");

    const performed = await acts.approveAuthorityRequest({
      requestId: asked.request.id,
      principalId: String(actor.id),
      statementDigest: acts.statementDigest(asked.statement),
    });
    expect(performed.state).toBe("PERFORMED");
    const reread = await world.readWorld({ worldId: record.worldId, scope });
    expect(reread!.definition.policies.map((policy) => policy.key)).toContain("cap");
    expect(await world.worldHistory({ worldId: record.worldId, scope })).toHaveLength(2);
  });

  it("a turn acting for an organization materializes the organization's world", async () => {
    const organization = await scopes.createOrganization({
      principalId: String(actor.id),
      displayName: "شركة النور",
    });
    const { output } = await turn(
      "أنشئ نظاماً دائماً لشركتي",
      { intent: "MATERIALIZE", definition: HOLDOUTS[2]!.definition },
      undefined,
      { intent: "ORGANIZATION", organizationId: organization.id },
    );
    expect(output.cause).toBe("WORLD_MATERIALIZED");
    const worldId = (output.world as { worldId: string }).worldId;
    const stored = await rowsFor(worldId);
    // Owned by the SCOPE, which is not the person.
    expect((stored.systems[0] as { scopeId: string }).scopeId).toBe(
      scopes.organizationScopeId(organization.id),
    );
    expect(await world.readWorld({ worldId, scope })).toBeUndefined();
  });

  // ── 9. False success ──────────────────────────────────────────────────────

  it("a routed world request with no definition creates nothing", async () => {
    //   ROUTED != MATERIALIZED
    const { output } = await turn("أنشئ لي نظاماً دائماً", { intent: "MATERIALIZE" });
    expect(output.state).toBe("NEEDS_INPUT");
    expect(output.cause).toBe("WORLD_DEFINITION_MISSING");
    const all = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM generated_systems`));
    expect((all.rows[0] as { n: number }).n).toBe(0);
  });

  it("a malformed definition creates nothing and says what was wrong", async () => {
    const { output } = await turn("أنشئ نظاماً", {
      intent: "MATERIALIZE",
      definition: {
        title: "نظام",
        entities: [{ key: "a", label: "A", fields: [] }],
        relations: [{ key: "r", label: "R", from: "a", to: "ghost", cardinality: "many_to_one" }],
      },
    });
    expect(output.state).toBe("DENIED");
    expect(output.cause).toBe("INVALID");
    const all = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM generated_systems`));
    expect((all.rows[0] as { n: number }).n).toBe(0);
  });

  it("naming a provider connects nothing", async () => {
    //   CONFIGURED != EXTERNALLY_CONNECTED
    const { record } = await materialize({
      title: "نظام يذكر مزوّدات",
      purpose: "يذكر بريداً ومدفوعات وخرائط",
      entities: [{ key: "invoice", label: "فاتورة", fields: [{ key: "total", label: "الإجمالي", type: "currency" }] }],
      relations: [],
      policies: [],
      workflows: [],
      participants: [],
    });
    const projection = world.projectWorld(record);
    expect(projection.externallyConnected).toBe(false);
    expect(projection.providerBindings).toBe(0);
    // And nothing was bound behind the mention.
    const bindings = await handle.db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM scope_provider_bindings WHERE "scopeId" = '${scope.scopeId}'`),
    );
    expect((bindings.rows[0] as { n: number }).n).toBe(0);
  });

  it("an executable definition is refused outright", async () => {
    const { output } = await turn("أنشئ نظاماً", {
      intent: "MATERIALIZE",
      definition: {
        title: "نظام",
        purpose: "<script>fetch('/steal')</script>",
        entities: [],
      },
    });
    expect(output.state).toBe("DENIED");
    const all = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM generated_systems`));
    expect((all.rows[0] as { n: number }).n).toBe(0);
  });

  // ── 10. Reference continuity ──────────────────────────────────────────────

  it("«أضف له» finds the world this conversation made", async () => {
    const created = await turn(HOLDOUTS[0]!.goal, {
      intent: "MATERIALIZE",
      definition: HOLDOUTS[0]!.definition,
    });
    const worldId = (created.output.world as { worldId: string }).worldId;

    const followUp = await turn(
      "أضف له كياناً للصيانة",
      {
        intent: "MUTATE",
        // No worldRef: the reference comes from the conversation, not from a
        // position on a screen.
        changes: [{ operation: "add", target: "entity", key: "upkeep", value: { label: "صيانة", fields: [] } }],
      },
      created.conversationId,
    );
    expect(followUp.output.cause).toBe("WORLD_VERSION_CREATED");
    expect((followUp.output.world as { worldId: string }).worldId).toBe(worldId);
    const reread = await world.readWorld({ worldId, scope });
    expect(reread!.definition.entities.map((entity) => entity.key)).toContain("upkeep");
  });

  // ── 11. The ledger, prepared for a transport it does not build ────────────

  it("world events are ordered, scoped and resumable from a cursor", async () => {
    const { record } = await materialize(HOLDOUTS[0]!.definition);
    await world.applyWorldChangeSet({
      worldId: record.worldId,
      scope,
      changes: [{ operation: "add", target: "entity", key: "bay", value: { label: "خانة", fields: [] } }],
      expectedVersion: record.version,
      requestKey: randomUUID(),
    });
    const all = await world.worldEventsSince({ scope, worldId: record.worldId });
    expect(all.map((entry) => entry.type)).toEqual(["WORLD_MATERIALIZED", "WORLD_VERSION_CREATED"]);
    const resumed = await world.worldEventsSince({
      scope,
      worldId: record.worldId,
      after: all[0]!.cursor,
    });
    expect(resumed.map((entry) => entry.type)).toEqual(["WORLD_VERSION_CREATED"]);
    // A ledger carries no definition body and therefore no smuggled program.
    expect(JSON.stringify(all)).not.toMatch(/<script|condition/);
  });

  // ── 12. Holdout generality ────────────────────────────────────────────────

  it("six unrelated operational contexts run through one world runtime", async () => {
    //   WORLD_HOLDOUT_REQUIRING_DOMAIN_BRANCH = 0
    for (const holdout of HOLDOUTS) {
      const { record, created } = await materialize(holdout.definition);
      expect(created, holdout.id).toBe(true);
      expect(record.version, holdout.id).toBe("1.0.0");
      // And each one MUTATES through the same change set, with no branch.
      const applied = await world.applyWorldChangeSet({
        worldId: record.worldId,
        scope,
        changes: [{ operation: "add", target: "entity", key: "note", value: { label: "ملاحظة", fields: [] } }],
        expectedVersion: record.version,
        requestKey: randomUUID(),
      });
      expect(applied.mutationClass, holdout.id).toBe("STRUCTURAL");
      const reread = await world.readWorld({ worldId: record.worldId, scope });
      expect(reread!.definition.entities.map((entity) => entity.key), holdout.id).toContain("note");
    }
    const all = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM generated_systems`));
    expect((all.rows[0] as { n: number }).n).toBe(HOLDOUTS.length);
  });

  // ── 13. A world is not the default ────────────────────────────────────────

  it("an ordinary turn creates no world at all", async () => {
    //   IDEA != WORLD · GOAL != WORLD
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "text",
        content: "الفرق بين العقد والاتفاق هو الإلزام.",
        confidence: 0.9,
      }),
      provider: "openai",
      model: "stub-for-persistent-world",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const conversation = await runtime.createRuntimeConversation({
      ownerId: String(actor.id),
      title: "no world",
    });
    await runtime.routeRuntimeConversationTurn({
      ownerId: String(actor.id),
      conversationId: conversation.id,
      content: "عندي فكرة أن الناس يؤجرون ساعات معداتهم الفارغة",
    });
    const all = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM generated_systems`));
    expect((all.rows[0] as { n: number }).n).toBe(0);
  });
});
