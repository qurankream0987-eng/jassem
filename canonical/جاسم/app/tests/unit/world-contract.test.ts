/**
 * JASIM — A WORLD IS CANONICAL STATE, NOT A GENERATED APPLICATION.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   ROUTED != MATERIALIZED
 *   MATERIALIZED != CONFIGURED
 *   CONFIGURED != EXTERNALLY_CONNECTED
 *   UI != WORLD
 *
 * The contract half: what a model may propose, what the runtime refuses, and
 * what a change set is allowed to be. The live half — a conversation creating
 * a durable world in a real database and reading it back — is
 * `tests/block31/persistent-world.test.ts`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WORLD_AUTHORITY_KEYS,
  WORLD_CHANGE_OPERATIONS,
  WORLD_CHANGE_TARGETS,
  WORLD_MUTATION_CLASSES,
  WorldDefinitionProposalSchema,
  WorldError,
  applyChangeSet,
  assertNoExecutableCode,
  assertNoWorldAuthorityClaim,
  classOf,
  dominantClass,
  projectWorld,
  proposalOf,
  validateWorldDefinition,
  worldKeyFor,
  type WorldChange,
  type WorldDefinitionProposal,
} from "../../api/runtime/world-runtime";
import { AUTHORITY_KEYS } from "../../api/runtime/model-output-trust";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

/** A world nobody in this repository anticipated. Deliberately unfamiliar. */
const LAB: WorldDefinitionProposal = {
  title: "تشغيل مختبر مشترك",
  purpose: "تنظيم ساعات الأجهزة والحجوزات والسياسات",
  entities: [
    {
      key: "instrument",
      label: "جهاز",
      fields: [
        { key: "name", label: "الاسم", type: "string" },
        { key: "hourly_rate", label: "سعر الساعة", type: "currency" },
      ],
    },
    { key: "booking", label: "حجز", fields: [{ key: "starts_at", label: "يبدأ", type: "datetime" }] },
  ],
  relations: [
    {
      key: "booking_instrument",
      label: "حجز لجهاز",
      from: "booking",
      to: "instrument",
      cardinality: "many_to_one",
    },
  ],
  policies: [
    {
      key: "approval_required",
      label: "موافقة قبل الحجز",
      target: "booking",
      condition: "hours > 4",
      effect: "require_approval",
    },
  ],
  workflows: [
    { key: "intake", label: "استقبال طلب", steps: [{ key: "check", label: "تحقق" }] },
  ],
  participants: [{ key: "operator", label: "مشغّل", capacity: "operates" }],
};

const define = (proposal: unknown) =>
  validateWorldDefinition({ proposal, worldKey: "wld_test", scopeId: "7" });

// ── The runtime owns the vocabulary ──────────────────────────────────────────

describe("the world vocabulary is closed and names no industry", () => {
  it("has seven mutation classes and not one of them is a domain", () => {
    expect([...WORLD_MUTATION_CLASSES].sort()).toEqual(
      ["COMMERCIAL", "DATA", "PERMISSION", "POLICY", "STRUCTURAL", "VIEW", "WORKFLOW"].sort(),
    );
    const DOMAIN = [
      "SCHOOL", "FACTORY", "RESTAURANT", "WAREHOUSE", "HOTEL", "CLINIC",
      "PROPERTY", "LAB", "FARM", "SHOP",
    ];
    for (const entry of [...WORLD_MUTATION_CLASSES, ...WORLD_CHANGE_TARGETS, ...WORLD_CHANGE_OPERATIONS]) {
      for (const word of DOMAIN) {
        expect(entry.toUpperCase(), entry).not.toContain(word);
      }
    }
  });

  it("exports no per-domain world, renderer or agent", () => {
    //   DOMAIN_WORLD_TYPES_ADDED = 0 · DOMAIN_WORLD_RENDERERS_ADDED = 0
    const text = source("api/runtime/world-runtime.ts");
    const declared = [...text.matchAll(/export (?:type|function|const|class|async function) (\w+)/g)]
      .map((match) => match[1]!);
    for (const name of declared) {
      for (const word of ["School", "Factory", "Restaurant", "Warehouse", "Hotel", "Clinic", "Laboratory", "Agriculture", "Maintenance", "Renderer", "Agent", "Dashboard", "Marketplace"]) {
        expect(name, `${name} names ${word}`).not.toContain(word);
      }
    }
  });

  it("builds no second world system", () => {
    //   PARALLEL_WORLD_SYSTEMS_ADDED = 0 · WORLD_MARKETPLACE_CORES_ADDED = 0
    const text = source("api/runtime/world-runtime.ts");
    // It commits through the service and tables that already existed.
    expect(text).toContain("GeneratedWorldService");
    expect(text).toContain("DrizzleGeneratedWorldRepository");
    // And declares no table of its own.
    expect(text).not.toMatch(/pgTable\(/);
    for (const forbidden of ["worlds_v2", "world_entities", "world_state", "worldMarketplace", "exchange"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("every world authority key is also refused in model output", () => {
    for (const key of WORLD_AUTHORITY_KEYS) {
      expect(AUTHORITY_KEYS, key).toContain(key);
    }
  });
});

// ── Untrusted until validated ────────────────────────────────────────────────

describe("a proposed definition is untrusted", () => {
  it("cannot say whose world it is", () => {
    for (const claim of [
      { ownerId: "9" },
      { scopeId: "org_1" },
      { entities: [{ key: "a", label: "A", permissions: ["*"] }] },
      { policies: [{ key: "p", label: "P", approved: true }] },
    ]) {
      expect(() => assertNoWorldAuthorityClaim(claim), JSON.stringify(claim)).toThrow(WorldError);
    }
  });

  it("cannot say that somebody approved it or what version is current", () => {
    expect(() => assertNoWorldAuthorityClaim({ approved: true })).toThrow(/runtime's word/);
    expect(() => assertNoWorldAuthorityClaim({ currentVersion: "9.9.9" })).toThrow(/runtime's word/);
    expect(() => assertNoWorldAuthorityClaim({ expectedVersion: "1.0.0" })).toThrow(/runtime's word/);
  });

  it("cannot carry anything executable", () => {
    //   MODEL -> generated executable code  ==  never
    for (const program of [
      "<script>alert(1)</script>",
      "javascript:fetch('/x')",
      "eval('1+1')",
      "() => { return 1 }",
      "require('fs')",
      "SELECT name FROM users",
      "DROP TABLE generated_systems",
      "process.env.SESSION_SECRET",
      "${world.secret}",
    ]) {
      expect(() => assertNoExecutableCode({ purpose: program }), program).toThrow(WorldError);
    }
  });

  it("lets an ordinary Arabic description through", () => {
    expect(() => assertNoExecutableCode(LAB)).not.toThrow();
    expect(() => assertNoWorldAuthorityClaim(LAB)).not.toThrow();
  });

  it("refuses an undeclared key rather than dropping it", () => {
    // Silently dropping is how a caller learns which names are magic.
    const parsed = WorldDefinitionProposalSchema.safeParse({ ...LAB, capabilities: ["payment.charge"] });
    expect(parsed.success).toBe(false);
  });

  it("refuses a relation to an entity nobody declared", () => {
    expect(() =>
      define({ ...LAB, relations: [{ key: "r", label: "R", from: "booking", to: "ghost", cardinality: "many_to_one" }] }),
    ).toThrow(/does not declare/);
  });

  it("refuses a policy guarding a target nobody declared", () => {
    expect(() =>
      define({ ...LAB, policies: [{ key: "p", label: "P", target: "ghost", condition: "x > 1", effect: "deny" }] }),
    ).toThrow(/does not declare/);
  });

  it("refuses the same key twice", () => {
    expect(() => define({ ...LAB, entities: [...LAB.entities, LAB.entities[0]!] })).toThrow(/twice/);
  });

  it("never lets a definition bind its own capabilities", () => {
    // A binding is the right to ACT. A world that could grant itself one
    // would be a generated application with authority.
    const world = define(LAB);
    expect(world.capabilities).toEqual([]);
  });

  it("is durable by construction — a world is never ephemeral", () => {
    expect(define(LAB).continuity).toBe("evolving");
  });

  it("survives a round trip through canonical state", () => {
    const world = define(LAB);
    const back = proposalOf(world);
    expect(back.title).toBe(LAB.title);
    expect(back.entities.map((entity) => entity.key)).toEqual(["instrument", "booking"]);
    expect(back.policies[0]!.effect).toBe("require_approval");
    expect(back.workflows[0]!.steps).toHaveLength(1);
  });
});

// ── A change set is all of it, or none of it ─────────────────────────────────

describe("a change set", () => {
  const change = (over: Partial<WorldChange>): WorldChange => ({
    operation: "add",
    target: "entity",
    key: "thing",
    value: { label: "شيء", fields: [] },
    ...over,
  }) as WorldChange;

  it("derives its class from what it touches, not from what it says", () => {
    expect(classOf(change({ target: "entity" }))).toBe("STRUCTURAL");
    expect(classOf(change({ target: "policy" }))).toBe("POLICY");
    expect(classOf(change({ target: "participant" }))).toBe("PERMISSION");
    expect(classOf(change({ target: "workflow" }))).toBe("WORKFLOW");
  });

  it("refuses a change that calls itself something milder", () => {
    // Mislabelling is how a POLICY change would take a DATA change's permission.
    expect(() =>
      applyChangeSet(LAB, [
        change({
          target: "policy",
          class: "DATA",
          key: "p2",
          value: { label: "P", target: "*", condition: "x > 1", effect: "deny" },
        }),
      ]),
    ).toThrow(/runtime decides which it is/);
  });

  it("is as consequential as its worst change", () => {
    expect(
      dominantClass([
        change({ target: "entity", key: "a" }),
        change({ target: "policy", key: "b" }),
      ]),
    ).toBe("POLICY");
  });

  it("applies nothing when any one change is invalid", () => {
    //   NO PARTIALLY MATERIALIZED WORLD
    const before = structuredClone(LAB);
    expect(() =>
      applyChangeSet(LAB, [
        change({ target: "entity", key: "one", value: { label: "١", fields: [] } }),
        change({ target: "entity", key: "two", value: { label: "٢", fields: [] } }),
        change({ target: "entity", key: "three", value: { label: "٣", fields: [] } }),
        // #4 removes something that is not there.
        change({ operation: "remove", target: "entity", key: "ghost" }),
        change({ target: "entity", key: "five", value: { label: "٥", fields: [] } }),
      ]),
    ).toThrow(/change 4 of 5/);
    // The input is untouched: the draft the first three landed on is gone.
    expect(LAB).toEqual(before);
  });

  it("refuses an empty change set", () => {
    expect(() => applyChangeSet(LAB, [])).toThrow(/changes nothing/);
  });

  it("refuses an unknown target rather than guessing", () => {
    expect(() => applyChangeSet(LAB, [change({ target: "galaxy" as never })])).toThrow();
  });

  it("adds, replaces and removes a field of a named entity", () => {
    const added = applyChangeSet(LAB, [
      change({ target: "field", parentKey: "instrument", key: "serial", value: { label: "الرقم", type: "string" } }),
    ]);
    expect(added.entities[0]!.fields.map((field) => field.key)).toContain("serial");
    const removed = applyChangeSet(added, [
      change({ operation: "remove", target: "field", parentKey: "instrument", key: "serial" }),
    ]);
    expect(removed.entities[0]!.fields.map((field) => field.key)).not.toContain("serial");
  });

  it("refuses a field change that does not say of which entity", () => {
    expect(() => applyChangeSet(LAB, [change({ target: "field", key: "x" })])).toThrow(/of which entity/);
  });

  it("refuses adding what is already there and replacing what is not", () => {
    expect(() => applyChangeSet(LAB, [change({ target: "entity", key: "instrument" })])).toThrow(/already/);
    expect(() =>
      applyChangeSet(LAB, [change({ operation: "replace", target: "entity", key: "ghost" })]),
    ).toThrow(/not there/);
  });

  it("says a view is not canonical state", () => {
    //   UI != WORLD
    expect(() => applyChangeSet(LAB, [change({ target: "view", key: "board" })])).toThrow(/UI != WORLD/);
  });

  it("cannot smuggle authority through a change value", () => {
    expect(() =>
      applyChangeSet(LAB, [change({ target: "entity", key: "x", value: { label: "X", ownerId: "9" } })]),
    ).toThrow(/runtime's word/);
  });

  it("cannot smuggle a program through a change value", () => {
    expect(() =>
      applyChangeSet(LAB, [
        change({ target: "policy", key: "x", value: { label: "X", target: "*", condition: "<script>x</script>", effect: "deny" } }),
      ]),
    ).toThrow(/executable/);
  });
});

// ── Identity and projection ──────────────────────────────────────────────────

describe("a world's identity and its surface", () => {
  it("is derived from the scope and the request, so a retry finds the same world", () => {
    expect(worldKeyFor("7", "msg_1")).toBe(worldKeyFor("7", "msg_1"));
    expect(worldKeyFor("7", "msg_1")).not.toBe(worldKeyFor("7", "msg_2"));
    // And two scopes asking the same thing get two worlds, never one shared.
    expect(worldKeyFor("7", "msg_1")).not.toBe(worldKeyFor("8", "msg_1"));
  });

  it("projects counts and names, and claims no connection", () => {
    //   CONFIGURED != EXTERNALLY_CONNECTED
    const projection = projectWorld({
      worldId: "wld_1",
      scopeId: "7",
      title: LAB.title,
      status: "active",
      version: "1.0.0",
      definition: LAB,
      entityCount: 2,
      policyCount: 1,
      workflowCount: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(projection.externallyConnected).toBe(false);
    expect(projection.providerBindings).toBe(0);
    expect((projection.counts as { entities: number }).entities).toBe(2);
    // No HTML, no component, no code. A projection is data.
    expect(JSON.stringify(projection)).not.toMatch(/<|function|=>/);
  });

  it("is read by both surfaces through the same procedures", () => {
    //   No WebWorldRuntime. No MobileWorldRuntime.
    const router = source("api/routers/runtime.ts");
    const mobile = source("../../../artifacts/jasim-mobile/lib/runtime-trpc.ts");
    for (const procedure of ["worldRead", "worldList", "worldHistory", "worldEvents"]) {
      expect(router, procedure).toContain(`${procedure}:`);
      expect(mobile, procedure).toContain(`runtime.${procedure}`);
    }
    // And the mutation door is not one of them: a world changes through the
    // conversation or through `world.evolve`, never through a second path.
    expect(router).not.toContain("worldMutate");
    expect(mobile).not.toContain("runtime.worldMutate");
  });

  it("is rendered through a primitive both surfaces already have", () => {
    // Presentation may adapt; semantics may not. Neither app has a world
    // runtime, and neither gained a renderer for one.
    const web = source("src/components/jasim-core/PresentationRenderer.tsx");
    const mobile = source("../../../artifacts/jasim-mobile/lib/mobile-presentation.ts");
    expect(web).toMatch(/WORLD_SUMMARY:\s*'detail'/);
    expect(mobile).toMatch(/WORLD_SUMMARY:\s*'entity'/);
    for (const text of [web, mobile]) {
      expect(text).not.toContain("WorldRuntime");
    }
  });
});

// ── The conversational boundary ──────────────────────────────────────────────

describe("the turn's world branch", () => {
  const runtime = source("api/runtime/jasim-runtime.ts");

  it("lets a model name a structure and nothing else", () => {
    const schema = runtime.slice(
      runtime.indexOf("const WorldRequestSchema"),
      runtime.indexOf("const WorldRequestSchema") + 400,
    );
    expect(schema).toContain(".strict()");
    for (const key of ["ownerId", "scopeId", "expectedVersion", "approved"] as const) {
      expect(schema, key).not.toContain(key);
    }
  });

  it("creates no run, no DAG and no node", () => {
    //   A DURABLE SYSTEM IS NOT AN EXECUTION GRAPH
    const start = runtime.indexOf("// ── A PERSISTENT WORLD: MATERIALIZE, OR SAY WHY NOT");
    const end = runtime.indexOf("// ── AN AUTHORITY ACT: ASK, NEVER DO");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = runtime.slice(start, end);
    expect(block).toContain("respondRouted(");
    expect(block).not.toContain("createRuntimeRun(");
    expect(block).not.toContain("createRuntimeDag(");
  });

  it("supplies the precondition itself rather than taking the model's word", () => {
    const start = runtime.indexOf("// ── A PERSISTENT WORLD: MATERIALIZE, OR SAY WHY NOT");
    const end = runtime.indexOf("// ── AN AUTHORITY ACT: ASK, NEVER DO");
    const block = runtime.slice(start, end);
    expect(block).toContain("expectedVersion: current.version");
  });

  it("is reached by the route alone, so a world plan never falls into execution", () => {
    const start = runtime.indexOf("// ── A PERSISTENT WORLD: MATERIALIZE, OR SAY WHY NOT");
    const end = runtime.indexOf("// ── AN AUTHORITY ACT: ASK, NEVER DO");
    expect(runtime.slice(start, end)).toContain('routeDecision.route === "PERSISTENT_WORLD"');
  });
});
