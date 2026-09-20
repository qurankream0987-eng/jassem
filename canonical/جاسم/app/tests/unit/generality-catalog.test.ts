/**
 * JASIM — the generality catalog, as CI sees it.
 *
 * This file does not test features. It tests that the CATALOG is honest and
 * that the architecture it measures has not quietly acquired a domain.
 *
 * ─── WHAT A RATCHET CAN AND CANNOT PROVE ────────────────────────────────────
 *
 * A grep for "RestaurantAgent" proves that one name is absent. It does not
 * prove the logic is domain-free. So the ratchets here are paired with the
 * behavioural holdout proof in
 * `tests/block31/effect-observation-verification.test.ts`, which runs five
 * unfamiliar domains through one capability and one declaration. Neither alone
 * is sufficient and the document says so.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  FAMILIES,
  GATES,
  GATE_STATUSES,
  GENERAL_GAPS,
  HOLDOUTS,
  IDEA_HOLDOUTS,
  PRIMITIVES,
  PROVIDER_CLASSES,
  ROUTES,
  SCENARIOS,
  SIDE_EFFECT_CLASSES,
  passCount,
  scoreboard,
} from "../generality/catalog";
import { BEGIN, END, renderGenerated, withGenerated } from "../generality/render";
import { SEMANTIC_ROUTES } from "../../api/runtime/semantic-router";

const REPO = resolve(process.cwd(), "../../..");
const DOC = resolve(REPO, "docs/master/JASIM_GENERALITY_ACCEPTANCE_CATALOG.md");
const LAW = resolve(REPO, "docs/master/JASIM_GENERALITY_MAXIMUM_SPEC.md");

// ── The catalog is well formed ───────────────────────────────────────────────

describe("every scenario refers to things that exist", () => {
  it("has a unique id", () => {
    const ids = SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names only general primitives", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.primitives.length, scenario.id).toBeGreaterThan(0);
      for (const primitive of scenario.primitives) {
        expect(PRIMITIVES, `${scenario.id}: ${primitive}`).toContain(primitive);
      }
    }
  });

  it("names only general capabilities", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.capabilities.length, scenario.id).toBeGreaterThan(0);
      for (const capability of scenario.capabilities) {
        expect(CAPABILITIES, `${scenario.id}: ${capability}`).toContain(capability);
      }
    }
  });

  it("names only provider CLASSES, never vendors", () => {
    for (const scenario of SCENARIOS) {
      for (const provider of scenario.providers) {
        expect(PROVIDER_CLASSES, `${scenario.id}: ${provider}`).toContain(provider);
      }
    }
  });

  it("uses only recognised statuses, on every gate", () => {
    for (const scenario of SCENARIOS) {
      for (const gate of GATES) {
        expect(GATE_STATUSES, `${scenario.id}.${gate}`).toContain(scenario.gates[gate]);
      }
    }
  });

  it("routes only to routes the router actually has", () => {
    // The catalog cannot invent a destination. If a route is renamed in the
    // runtime, this is what notices.
    for (const scenario of SCENARIOS) {
      expect(SEMANTIC_ROUTES as readonly string[], scenario.id).toContain(scenario.route);
      expect(ROUTES as readonly string[]).toContain(scenario.route);
    }
  });

  it("uses recognised families and effect classes", () => {
    for (const scenario of SCENARIOS) {
      expect(FAMILIES, scenario.id).toContain(scenario.family);
      expect(SIDE_EFFECT_CLASSES, scenario.id).toContain(scenario.sideEffect);
    }
  });

  it("blames only a GENERAL gap, never a scenario", () => {
    for (const scenario of SCENARIOS) {
      if (scenario.currentBlocker === null) continue;
      expect(GENERAL_GAPS, scenario.id).toContain(scenario.currentBlocker);
    }
  });

  it("says what the runtime actually does today", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.truthfulRuntimeState.length, scenario.id).toBeGreaterThan(30);
    }
  });
});

// ── No false end-to-end claims ───────────────────────────────────────────────

describe("the catalog cannot report a pass it has not earned", () => {
  it("an unblocked scenario is one with nothing missing", () => {
    // The inverse is the dangerous direction: a scenario with every gate PASS
    // while still naming a blocker would be claiming both at once.
    for (const scenario of SCENARIOS) {
      const anyMissing = GATES.some(
        (gate) => scenario.gates[gate] === "NOT_YET_IMPLEMENTED",
      );
      if (!anyMissing && scenario.currentBlocker !== null) {
        // Allowed only when the blocker explains a PROVIDER or ENVIRONMENT gate.
        const anyBlocked = GATES.some((gate) =>
          scenario.gates[gate].startsWith("BLOCKED_"),
        );
        expect(anyBlocked, `${scenario.id} names a blocker but nothing is blocked`).toBe(true);
      }
    }
  });

  it("a missing general capability is always named", () => {
    for (const scenario of SCENARIOS) {
      const missing = GATES.filter((gate) => scenario.gates[gate] === "NOT_YET_IMPLEMENTED");
      if (missing.length === 0) continue;
      expect(scenario.currentBlocker, `${scenario.id} is missing ${missing.join(",")}`).not.toBeNull();
    }
  });

  it("nothing is EXECUTABLE without being REPRESENTABLE, ROUTABLE and PLANNABLE", () => {
    // Executing something the core cannot represent would mean the execution
    // came from somewhere other than the core.
    for (const scenario of SCENARIOS) {
      if (scenario.gates.EXECUTABLE !== "PASS") continue;
      for (const gate of ["REPRESENTABLE", "ROUTABLE", "PLANNABLE"] as const) {
        expect(scenario.gates[gate], `${scenario.id}.${gate}`).toBe("PASS");
      }
    }
  });

  it("nothing is VERIFIABLE while its observation is missing", () => {
    for (const scenario of SCENARIOS) {
      if (scenario.gates.VERIFIABLE !== "PASS") continue;
      expect(
        ["PASS", "NOT_APPLICABLE"],
        `${scenario.id} claims verifiable with OBSERVABLE=${scenario.gates.OBSERVABLE}`,
      ).toContain(scenario.gates.OBSERVABLE);
    }
  });

  it("an effectful scenario never treats observation as inapplicable", () => {
    for (const scenario of SCENARIOS) {
      if (scenario.sideEffect === "NONE") continue;
      if (scenario.gates.EXECUTABLE !== "PASS") continue;
      expect(scenario.gates.OBSERVABLE, scenario.id).not.toBe("NOT_APPLICABLE");
    }
  });
});

// ── Ratchets ─────────────────────────────────────────────────────────────────

describe("the architectural ratchets", () => {
  it("no catalogued scenario requires a domain branch", () => {
    expect(scoreboard().domainBranchesRequired).toBe(0);
  });

  it("no scenario id is an industry", () => {
    // An id is a handle, and a handle named after an industry is how a test
    // turns into a feature request.
    const FORBIDDEN = ["Agent", "Marketplace", "Vertical", "Module", "Plugin"];
    for (const scenario of SCENARIOS) {
      for (const word of FORBIDDEN) {
        expect(scenario.id, scenario.id).not.toContain(word);
      }
    }
  });

  it("the runtime exports no domain agent, planner, verifier or marketplace", () => {
    // What this proves: no EXPORTED runtime name is an industry noun.
    // What it does not prove: that the logic inside is domain-free. The
    // behavioural holdouts are what test that.
    const files = [
      "api/runtime/semantic-router.ts",
      "api/runtime/plan-graph.ts",
      "api/runtime/capability-registry.ts",
      "api/runtime/completion-policy.ts",
      "api/runtime/effect-observation-bridge.ts",
      "api/runtime/economic-fabric.ts",
      "api/runtime/canonical-dataset.ts",
      "api/runtime/dataset-presentation.ts",
    ];
    const DOMAIN = [
      "Restaurant", "Jobs", "Factory", "Driver", "Wholesale", "Sales",
      "Inventory", "Laboratory", "Generator", "Apiary", "Valve", "Desalination",
      "Falconry", "Mosque", "Hotel", "Warehouse", "Grocery", "Marketplace",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      const declared = [...source.matchAll(/export (?:type|function|const|class) (\w+)/g)].map(
        (match) => match[1]!,
      );
      for (const name of declared) {
        for (const word of DOMAIN) {
          expect(name, `${file}: ${name}`).not.toContain(word);
        }
      }
    }
  });

  it("the catalog itself introduces no production module", () => {
    // Acceptance infrastructure that shipped code imported would stop being
    // a measurement and become part of what it measures.
    const catalog = readFileSync(resolve(process.cwd(), "tests/generality/catalog.ts"), "utf8");
    expect(catalog).not.toMatch(/from "\.\.\/\.\.\/api\//);
    expect(catalog).not.toMatch(/from "@db\//);
  });
});

// ── Holdouts ─────────────────────────────────────────────────────────────────

const BLIND_FAMILIES = new Set(["HOLDOUT", "IDEA_INTAKE"]);

/** The primitives the scenarios that DID shape the implementation reach for. */
function namedPrimitives(): Set<string> {
  return new Set(
    SCENARIOS.filter((scenario) => !BLIND_FAMILIES.has(scenario.family)).flatMap(
      (scenario) => scenario.primitives,
    ),
  );
}


describe("the blind holdouts", () => {
  it("there are at least fifteen", () => {
    expect(HOLDOUTS.length).toBeGreaterThanOrEqual(15);
  });

  it("none requires a domain branch", () => {
    expect(scoreboard().holdoutsRequiringDomainBranch).toBe(0);
  });

  it("every one is representable and routable with what already exists", () => {
    for (const holdout of HOLDOUTS) {
      expect(holdout.gates.REPRESENTABLE, holdout.id).toBe("PASS");
      expect(holdout.gates.ROUTABLE, holdout.id).toBe("PASS");
    }
  });

  it("none uses a primitive invented for it", () => {
    // A holdout reaching for a primitive no named scenario uses would mean the
    // core had been widened to accommodate an unfamiliar domain.
    // Both blind families are excluded from the "named" set. A blind case that
    // licensed itself, or licensed another blind case, would measure nothing.
    const named = namedPrimitives();
    for (const holdout of HOLDOUTS) {
      for (const primitive of holdout.primitives) {
        expect(named, `${holdout.id}: ${primitive}`).toContain(primitive);
      }
    }
  });

  it("none scores above the subsystem it depends on", () => {
    // A holdout that claimed EXECUTABLE while the exchange it needs does not
    // exist would be the catalog flattering itself.
    for (const holdout of HOLDOUTS) {
      if (holdout.currentBlocker === null) continue;
      expect(holdout.gates.EXECUTABLE, holdout.id).not.toBe("PASS");
    }
  });
});

// ── The Idea Intake Law ──────────────────────────────────────────────────────

/**
 * §4.4. An idea is not a domain, and an unfamiliar one is not an unsupported
 * one. What is measured here is that an idea nobody anticipated ENTERS —
 * decomposing into primitives, routes and capabilities that already existed
 * before anyone thought of it.
 */
describe("any lawful idea may enter", () => {
  it("there are at least five blind ideas", () => {
    expect(IDEA_HOLDOUTS.length).toBeGreaterThanOrEqual(5);
  });

  it("every one is representable and routable with what already exists", () => {
    // This is the whole law. An idea that could not even be stated would be
    // the runtime saying "JASIM does not support that kind of thing".
    for (const idea of IDEA_HOLDOUTS) {
      expect(idea.gates.REPRESENTABLE, idea.id).toBe("PASS");
      expect(idea.gates.ROUTABLE, idea.id).toBe("PASS");
    }
  });

  it("IDEA_DOMAIN_BRANCHES = 0", () => {
    expect(scoreboard().ideasRequiringDomainBranch).toBe(0);
  });

  it("none reaches for a primitive, capability or route invented for it", () => {
    const named = namedPrimitives();
    const namedCapabilities = new Set(
      SCENARIOS.filter((scenario) => !BLIND_FAMILIES.has(scenario.family)).flatMap(
        (scenario) => scenario.capabilities,
      ),
    );
    const namedRoutes = new Set(
      SCENARIOS.filter((scenario) => !BLIND_FAMILIES.has(scenario.family)).map(
        (scenario) => scenario.route,
      ),
    );
    for (const idea of IDEA_HOLDOUTS) {
      for (const primitive of idea.primitives) {
        expect(named, `${idea.id}: ${primitive}`).toContain(primitive);
      }
      for (const capability of idea.capabilities) {
        expect(namedCapabilities, `${idea.id}: ${capability}`).toContain(capability);
      }
      expect(namedRoutes, `${idea.id}: ${idea.route}`).toContain(idea.route);
    }
  });

  it("is not forced down one path", () => {
    // The opposite failure. Answering every idea with the same route would be
    // a domain branch wearing the costume of generality.
    expect(new Set(IDEA_HOLDOUTS.map((idea) => idea.route)).size).toBeGreaterThan(1);
  });

  it("answers with a named capability or a named provider, never a refusal", () => {
    // The two correct answers, and the proof that both actually occur. A
    // catalog where every idea were blocked the same way would be measuring
    // one gap, not the intake law.
    const byCapability = IDEA_HOLDOUTS.filter((idea) => idea.currentBlocker !== null);
    const byProvider = IDEA_HOLDOUTS.filter((idea) =>
      GATES.some((gate) => idea.gates[gate] === "BLOCKED_BY_PROVIDER"),
    );
    const carried = IDEA_HOLDOUTS.filter((idea) => idea.gates.EXECUTABLE === "PASS");
    expect(byCapability.length, "an idea blocked by a missing capability").toBeGreaterThan(0);
    expect(byProvider.length, "an idea blocked by an unbound provider").toBeGreaterThan(0);
    expect(carried.length, "an idea that runs today").toBeGreaterThan(0);
    for (const idea of IDEA_HOLDOUTS) {
      if (idea.currentBlocker === null) continue;
      expect(GENERAL_GAPS, `${idea.id} blames ${idea.currentBlocker}`).toContain(
        idea.currentBlocker,
      );
    }
  });

  it("IDEA_AGENTS_ADDED = 0 — the runtime has no idea machinery", () => {
    // `Idea` is not a primitive, not a capability, not a route and not a name
    // anywhere in the runtime. If persisting ideas ever needs a type, that is
    // a separate decision with its own evidence, and this is what forces it to
    // be one.
    for (const vocabulary of [PRIMITIVES, CAPABILITIES, ROUTES] as readonly (readonly string[])[]) {
      for (const entry of vocabulary) {
        expect(entry.toLowerCase(), entry).not.toContain("idea");
      }
    }
    const runtime = execSync(
      "grep -rlE 'IdeaAgent|IdeaMarketplace|IdeaRegistry|IdeaCategory|IDEA_CATEGOR' api src || true",
      { cwd: process.cwd(), encoding: "utf8" },
    ).trim();
    expect(runtime, "the runtime names no idea machinery").toBe("");
  });

  it("the governing law records the Idea Intake Law", () => {
    const law = readFileSync(LAW, "utf8");
    for (const clause of [
      "THE IDEA INTAKE LAW",
      "UNKNOWN IDEA != UNSUPPORTED DOMAIN",
      "IDEA_DOMAIN_BRANCHES = 0",
      "IDEA_AGENTS_ADDED    = 0",
      "IdeaAgent",
      "IdeaMarketplace",
      "there are no kinds of thing",
    ]) {
      expect(law, clause).toContain(clause);
    }
  });
});

// ── The open market ──────────────────────────────────────────────────────────

describe("the open market is one market", () => {
  const market = SCENARIOS.filter((scenario) => scenario.family === "OPEN_MARKET");

  it("has scenarios from unrelated economic domains", () => {
    expect(market.length).toBeGreaterThanOrEqual(15);
  });

  it("every one uses the same general economic primitives", () => {
    const ALLOWED = new Set([
      "Actor", "Need", "Offering", "Resource", "Capacity", "Availability",
      "Constraint", "Preference", "Economics", "Opportunity", "Policy",
      "Observation", "Verification", "Proposal", "Term", "Authority",
    ]);
    for (const scenario of market) {
      for (const primitive of scenario.primitives) {
        expect(ALLOWED, `${scenario.id}: ${primitive}`).toContain(primitive);
      }
    }
  });

  it("every one routes through the same mechanism", () => {
    // Not one route per category. NEW MARKET CATEGORY != NEW MARKETPLACE.
    expect(new Set(market.map((scenario) => scenario.route)).size).toBe(1);
  });

  it("blames one exchange gap, not one gap per category", () => {
    const blockers = new Set(
      market.map((scenario) => scenario.currentBlocker).filter(Boolean),
    );
    // One gap, and it is a PROVIDER gap: reaching outside JASIM. The exchange
    // itself is no longer a blocker for any market category.
    expect([...blockers].sort()).toEqual(["EXTERNAL_DISCOVERY_PROVIDER"]);
  });

  it("records that a claim is not a verified fact", () => {
    const claim = market.find((scenario) => scenario.id === "market.claim_is_not_availability");
    expect(claim).toBeTruthy();
    expect(claim!.truthfulRuntimeState).toContain("OPEN_MARKET != UNVERIFIED_MARKET");
  });
});

// ── Negotiation stays general ────────────────────────────────────────────────

describe("negotiation is one mechanism, not one per subject", () => {
  const agreement = SCENARIOS.filter((scenario) => scenario.family === "AGREEMENT");

  it("covers unrelated subjects", () => {
    expect(agreement.length).toBeGreaterThanOrEqual(10);
  });

  it("names one general gap for all of them", () => {
    const blockers = new Set(agreement.map((scenario) => scenario.currentBlocker));
    expect([...blockers]).toEqual(["GENERAL_AGREEMENT_RUNTIME"]);
  });

  it("keeps the private bound private", () => {
    for (const id of ["agreement.buyer_private_maximum", "agreement.seller_private_minimum"]) {
      const scenario = SCENARIOS.find((entry) => entry.id === id)!;
      expect(scenario.primitives).toContain("Authority");
      expect(scenario.primitives).toContain("Policy");
    }
    const buyer = SCENARIOS.find((s) => s.id === "agreement.buyer_private_maximum")!;
    expect(buyer.truthfulRuntimeState).toContain("TARGET != AUTHORITY");
  });
});

// ── A business is a scope ────────────────────────────────────────────────────

describe("a business is a scope, not an app", () => {
  const business = SCENARIOS.filter((scenario) => scenario.family === "BUSINESS");
  const jasimos = SCENARIOS.filter((scenario) => scenario.family === "JASIM_OS");

  it("no scenario names a KIND of business", () => {
    // A restaurant, a factory and a school differ in their attributes. If one
    // of them were a scenario id, it would soon be a branch.
    const KINDS = ["restaurant", "factory", "school", "hotel", "clinic", "shop", "logistics"];
    for (const scenario of [...business, ...jasimos]) {
      for (const kind of KINDS) {
        expect(scenario.id.toLowerCase(), scenario.id).not.toContain(kind);
      }
    }
  });

  it("uses the same primitives a person uses", () => {
    const personal = namedPrimitives();
    for (const scenario of [...business, ...jasimos]) {
      for (const primitive of scenario.primitives) {
        expect(personal, `${scenario.id}: ${primitive}`).toContain(primitive);
      }
    }
  });

  it("acting in a scope and administering one are different facts", () => {
    // The whole point of not bulk-promoting a family: publishing as a company
    // runs today, and creating the company by talking does not.
    const acting = business.filter((scenario) => scenario.gates.EXECUTABLE === "PASS");
    const administering = business.filter(
      (scenario) => scenario.currentBlocker === "SCOPE_ADMINISTRATION_PATH",
    );
    expect(acting.length).toBeGreaterThan(0);
    expect(administering.length).toBeGreaterThan(0);
    for (const scenario of acting) {
      expect(scenario.currentBlocker, scenario.id).toBeNull();
      // Writing under a scope is INTERNAL_STATE, and internal state is read
      // back. A business write that claimed to need no observation would be
      // the false pure read this catalog refuses.
      expect(scenario.sideEffect, scenario.id).not.toBe("NONE");
      expect(scenario.gates.OBSERVABLE, scenario.id).toBe("PASS");
    }
  });

  it("JASIM OS blames no runtime of its own", () => {
    // `BUSINESS_SCOPE_RUNTIME` is closed and must not come back as a second
    // intelligence under another name.
    expect(GENERAL_GAPS as readonly string[]).not.toContain("BUSINESS_SCOPE_RUNTIME");
    for (const scenario of jasimos) {
      expect(GENERAL_GAPS, scenario.id).toContain(scenario.currentBlocker!);
    }
  });

  it("the governing law records that a scope is not a second intelligence", () => {
    const law = readFileSync(LAW, "utf8");
    for (const clause of [
      "AUTHENTICATED PRINCIPAL  !=  ACTING SCOPE",
      "DOMAIN_BUSINESS_TYPES_ADDED = 0",
      "DOMAIN_ROLES_ADDED          = 0",
      "FactoryManager",
      "RestaurantOwner",
      "There is no second intelligence",
    ]) {
      expect(law, clause).toContain(clause);
    }
  });
});

// ── The scoreboard, pinned ───────────────────────────────────────────────────

describe("no scenario changes status silently", () => {
  it("the counts are exactly these", () => {
    // Not a style assertion: this is what makes a status change a visible diff
    // in review rather than a number nobody noticed moving.
    const board = scoreboard();
    expect({
      total: board.totalScenarios,
      holdouts: board.holdouts,
      ideas: board.blindIdeaHoldouts,
      pass: Object.fromEntries(GATES.map((gate) => [gate, passCount(gate)])),
      blockedByProvider: board.blockedByProvider,
      blockedByEnvironment: board.blockedByEnvironment,
      notYetImplemented: board.notYetImplemented,
      generalGaps: board.generalGaps.length,
    }).toEqual({
      total: 162,
      holdouts: 16,
      ideas: 7,
      pass: {
        REPRESENTABLE: 162,
        ROUTABLE: 162,
        PLANNABLE: 122,
        EXECUTABLE: 65,
        OBSERVABLE: 67,
        VERIFIABLE: 62,
        PRESENTABLE: 160,
        PERSISTENT: 128,
      },
      blockedByProvider: 31,
      blockedByEnvironment: 2,
      notYetImplemented: 69,
      generalGaps: 13,
    });
  });

  it("publishes no single generality percentage", () => {
    const board = scoreboard() as unknown as Record<string, unknown>;
    for (const forbidden of ["percent", "score", "overall", "ratio"]) {
      expect(Object.keys(board).map((key) => key.toLowerCase())).not.toContain(forbidden);
    }
  });
});

// ── The document cannot drift ────────────────────────────────────────────────

describe("the catalog document is generated from the catalog", () => {
  it("matches the data, or JASIM_WRITE_CATALOG=1 regenerates it", () => {
    const generated = renderGenerated();
    const current = readFileSync(DOC, "utf8");
    if (process.env.JASIM_WRITE_CATALOG === "1") {
      writeFileSync(DOC, withGenerated(current, generated), "utf8");
      return;
    }
    const start = current.indexOf(BEGIN);
    const end = current.indexOf(END);
    expect(start, "the document has a generated region").toBeGreaterThanOrEqual(0);
    expect(current.slice(start, end + END.length)).toBe(generated);
  });

  it("the governing law records the open market law", () => {
    const law = readFileSync(LAW, "utf8");
    for (const clause of [
      "JASIM OPEN MARKET LAW",
      "NEW MARKET CATEGORY != NEW MARKETPLACE",
      "SPONSORED             != BEST",
      "PLATFORM_REVENUE      != ANSWER_AUTHORITY",
      "BUSINESS_SUBSCRIPTION != ORGANIC_RANK",
      "SELLER CLAIM",
      "contextual roles",
      "INTERNAL_ONLY",
      "EXTERNAL_ONLY",
    ]) {
      expect(law, clause).toContain(clause);
    }
  });

  it("the governing law forbids the domain agents by name", () => {
    const law = readFileSync(LAW, "utf8");
    for (const forbidden of ["RestaurantAgent", "JobsAgent", "FactoryAgent", "DriverAgent"]) {
      expect(law, forbidden).toContain(forbidden);
    }
  });
});
