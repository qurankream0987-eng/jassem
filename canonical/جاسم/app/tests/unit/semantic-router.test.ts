/**
 * JASIM — the semantic router.
 *
 * Precedence is a VALUE here (`ROUTING_RULES`), so these tests read it rather
 * than re-deriving it. The brief asks for deterministic precedence in one
 * place; a test that has to trace branches across files would be evidence it
 * is not in one place.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROUTING_RULES,
  SEMANTIC_ROUTES,
  decideSemanticRoute,
  routeUnavailable,
  type RoutableEnvelopeKind,
} from "../../api/runtime/semantic-router";
import { PlanGraphSchema, type PlanGraph, type PlanValidation } from "../../api/runtime/plan-graph";

const planOf = (kind: PlanGraph["kind"], nodes: unknown[] = []): PlanGraph =>
  PlanGraphSchema.parse({ version: 1, kind, nodes, blockers: [] });

const validation = (over: Partial<PlanValidation> = {}): PlanValidation => ({
  readiness: "EXECUTABLE",
  violations: [],
  dispositions: [],
  authority: new Map(),
  order: [],
  ...over,
});

const DAG_NODE = {
  key: "a",
  capabilityId: "local-analysis",
  inputs: {},
  dependsOn: [],
  bindings: [],
  enforces: [],
  authority: "NONE",
};

const route = (input: {
  envelopeKind: RoutableEnvelopeKind;
  plan?: PlanGraph;
  planValidation?: PlanValidation;
  goalOutcome?: string;
}) => decideSemanticRoute(input);

describe("the envelope kind no longer decides mechanism", () => {
  // The bug this phase closes. All four arrive as `direct_action` — the same
  // envelope kind that used to mean "make execution proposals".
  it.each([
    ["DIRECT_READ", "DIRECT_READ"],
    ["IDENTITY_CHANGE", "TRUSTED_PRODUCT_ACTION"],
    ["SETTING_MUTATION", "TRUSTED_PRODUCT_ACTION"],
    ["MONITORING", "MONITORING"],
    ["PERSISTENT_WORLD", "PERSISTENT_WORLD"],
  ] as const)("a %s plan on a direct_action envelope routes to %s", (planKind, expected) => {
    expect(route({ envelopeKind: "direct_action", plan: planOf(planKind) }).route).toBe(expected);
  });

  it("an executable DAG plan is the only thing that routes to real work", () => {
    expect(
      route({
        envelopeKind: "direct_action",
        plan: planOf("DAG", [DAG_NODE]),
        planValidation: validation(),
      }).route,
    ).toBe("GENERAL_PLANGRAPH");
  });
});

describe("precedence, deterministically", () => {
  it("identity comes first, even when the plan is malformed", () => {
    // The dangerous case: a broken identity plan is where routing it as
    // ordinary execution would do the most harm, not the least.
    const decision = route({
      envelopeKind: "workflow",
      plan: planOf("IDENTITY_CHANGE", [DAG_NODE]),
      planValidation: validation({
        readiness: "BLOCKED",
        violations: [{ code: "NODES_ON_NON_DAG_PLAN", detail: "x" }],
      }),
    });
    expect(decision.route).toBe("TRUSTED_PRODUCT_ACTION");
    expect(decision.reason).toBe("PLAN_IDENTITY_CHANGE");
  });

  it("a read does not become a plan because it mentions a capability", () => {
    const decision = route({ envelopeKind: "workflow", plan: planOf("DIRECT_READ") });
    expect(decision.route).toBe("DIRECT_READ");
  });

  it("monitoring is decided before any one-shot execution", () => {
    const monitoringIndex = ROUTING_RULES.findIndex((r) => r.reason === "PLAN_MONITORING");
    const dagIndex = ROUTING_RULES.findIndex((r) => r.reason === "PLAN_DAG_EXECUTABLE");
    expect(monitoringIndex).toBeLessThan(dagIndex);
  });

  it("every plan-derived rule precedes every envelope-derived rule", () => {
    // This ordering IS the fix. If it ever inverts, the envelope decides again.
    const lastPlanRule = ROUTING_RULES.map((r) => r.reason).lastIndexOf("PLAN_NOT_ROUTABLE");
    const firstEnvelopeRule = ROUTING_RULES.findIndex((r) => r.reason.startsWith("ENVELOPE_"));
    expect(lastPlanRule).toBeLessThan(firstEnvelopeRule);
  });

  it("the first matching rule wins, and only the first", () => {
    const decision = route({ envelopeKind: "text", plan: planOf("MONITORING") });
    // `text` would route to TEXT on its own; the plan rule precedes it.
    expect(decision.route).toBe("MONITORING");
    expect(decision.reason).toBe("PLAN_MONITORING");
  });

  it("a plan that is not routable falls to the flat path, visibly", () => {
    const decision = route({
      envelopeKind: "direct_action",
      plan: planOf("DAG", [DAG_NODE]),
      planValidation: validation({ readiness: "BLOCKED" }),
    });
    expect(decision.route).toBe("LEGACY_FLAT");
    expect(decision.reason).toBe("PLAN_NOT_ROUTABLE");
  });

  it("a DAG plan with violations never reaches GENERAL_PLANGRAPH", () => {
    const decision = route({
      envelopeKind: "direct_action",
      plan: planOf("DAG", [DAG_NODE]),
      planValidation: validation({ violations: [{ code: "CYCLE", detail: "x" }] }),
    });
    expect(decision.route).toBe("LEGACY_FLAT");
  });
});

describe("with no plan, the envelope still decides — unchanged", () => {
  it.each([
    ["text", "TEXT"],
    ["ephemeral_bubble", "GENERATED_PRESENTATION"],
    ["interactive_bubble", "GENERATED_PRESENTATION"],
    ["structured_result", "GENERATED_PRESENTATION"],
    ["persistent_smart_bubble", "PERSISTENT_LIVING_OBJECT"],
    ["direct_action", "LEGACY_FLAT"],
    ["workflow", "LEGACY_FLAT"],
    ["durable_run", "LEGACY_FLAT"],
  ] as const)("%s → %s", (envelopeKind, expected) => {
    expect(route({ envelopeKind }).route).toBe(expected);
  });

  it("the legacy path is visible, never silent", () => {
    const decision = route({ envelopeKind: "direct_action" });
    expect(decision.route).toBe("LEGACY_FLAT");
    expect(decision.reason).toBe("ENVELOPE_EXECUTION_NO_PLAN");
  });
});

describe("an unbuilt mechanism says so", () => {
  it.each(["TRUSTED_PRODUCT_ACTION", "MONITORING"] as const)(
    "%s reports NOT_IMPLEMENTED",
    (planKind) => {
      const map = {
        TRUSTED_PRODUCT_ACTION: "IDENTITY_CHANGE",
        MONITORING: "MONITORING",
      } as const;
      const decision = route({
        envelopeKind: "direct_action",
        plan: planOf(map[planKind] as PlanGraph["kind"]),
      });
      expect(decision.downstream).toBe("NOT_IMPLEMENTED");
    },
  );

  it("PERSISTENT_WORLD is AVAILABLE now that the world runtime exists", () => {
    // It left NOT_IMPLEMENTED for the same reason DIRECT_READ did: the
    // mechanism behind the route was built. A turn validates the definition,
    // authorizes it against the acting scope, commits it in one transaction
    // and reads it back — and its refusals (NEEDS_INPUT, DENIED, CONFLICT)
    // are that runtime's own, which say far more than "not built".
    const decision = route({ envelopeKind: "direct_action", plan: planOf("PERSISTENT_WORLD") });
    expect(decision.route).toBe("PERSISTENT_WORLD");
    expect(decision.downstream).toBe("AVAILABLE");
    // And it still routes AWAY from execution: a durable system is not a DAG.
    expect(decision.reason).toBe("PLAN_PERSISTENT_WORLD");
  });

  it("DIRECT_READ is AVAILABLE now that the data layer exists", () => {
    // It left NOT_IMPLEMENTED when `readCanonicalData` landed. Its unavailable
    // cases are the data layer's own — UNAVAILABLE for an unregistered
    // resource, DENIED for a field — which are far more specific than
    // "not built".
    const decision = route({ envelopeKind: "direct_action", plan: planOf("DIRECT_READ") });
    expect(decision.route).toBe("DIRECT_READ");
    expect(decision.downstream).toBe("AVAILABLE");
  });

  it.each(["TEXT", "GENERATED_PRESENTATION", "GENERAL_PLANGRAPH", "LEGACY_FLAT"] as const)(
    "%s is AVAILABLE",
    (expected) => {
      const decision =
        expected === "GENERAL_PLANGRAPH"
          ? route({
              envelopeKind: "direct_action",
              plan: planOf("DAG", [DAG_NODE]),
              planValidation: validation(),
            })
          : route({
              envelopeKind:
                expected === "TEXT"
                  ? "text"
                  : expected === "GENERATED_PRESENTATION"
                    ? "ephemeral_bubble"
                    : "direct_action",
            });
      expect(decision.downstream).toBe("AVAILABLE");
    },
  );

  it("the unavailable state is UNAVAILABLE, not FAILED and not BLOCKED_BY_PROVIDER", () => {
    // Nothing was attempted, so nothing failed. And no provider is missing —
    // the part JASIM has not built is missing, which is a different fact.
    const unavailable = routeUnavailable("DIRECT_READ");
    expect(unavailable.state).toBe("UNAVAILABLE");
    expect(unavailable.cause).toBe("MECHANISM_NOT_IMPLEMENTED");
    expect(unavailable.cause).not.toContain("PROVIDER");
  });

  it("each message says what was understood and what is missing", () => {
    for (const r of ["DIRECT_READ", "TRUSTED_PRODUCT_ACTION", "MONITORING", "PERSISTENT_WORLD"] as const) {
      const message = routeUnavailable(r).message;
      expect(message).toMatch(/فهمت/);
      expect(message.length).toBeGreaterThan(20);
    }
  });

  it("a DIRECT_READ carries a data need, and it is not a query", () => {
    const decision = route({
      envelopeKind: "direct_action",
      plan: planOf("DIRECT_READ"),
      goalOutcome: "عرض مبيعات هذا الشهر",
    });
    expect(decision.dataNeed).toEqual({
      kind: "AUTHORIZED_READ",
      subject: "عرض مبيعات هذا الشهر",
    });
    // No SQL, no table, no connection. The model never gets one.
    expect(JSON.stringify(decision)).not.toMatch(/select|from |where |table/i);
  });

  it("only DIRECT_READ carries a data need", () => {
    expect(route({ envelopeKind: "direct_action", plan: planOf("MONITORING") }).dataNeed)
      .toBeUndefined();
    expect(route({ envelopeKind: "text" }).dataNeed).toBeUndefined();
  });
});

describe("GENERALITY — the same nine routes for every domain", () => {
  /**
   * Nine requests, five of them from domains this codebase has never modelled:
   * archaeological survey logging, sign-language interpreting, apiary
   * contracts, desalination chemistry, and a mosque lending library.
   *
   * Each maps to a route by MECHANISM. If any needed a tenth route, or a route
   * named after its subject, this block could not be written.
   */
  const cases = [
    { utterance: "أرني جدول مبيعاتي", planKind: "DIRECT_READ", expect: "DIRECT_READ" },
    { utterance: "أرني سجل المسح الأثري لهذا الموقع", planKind: "DIRECT_READ", expect: "DIRECT_READ" },
    { utterance: "شغل لي الخريطة", planKind: "DIRECT_READ", expect: "DIRECT_READ" },
    { utterance: "سجلني خروج", planKind: "IDENTITY_CHANGE", expect: "TRUSTED_PRODUCT_ACTION" },
    { utterance: "لا ترسل لي إشعارات في الليل", planKind: "SETTING_MUTATION", expect: "TRUSTED_PRODUCT_ACTION" },
    { utterance: "رتب لي مسابقة صقور", planKind: "DAG", expect: "GENERAL_PLANGRAPH" },
    { utterance: "دبر لي مترجم لغة إشارة للمحكمة", planKind: "DAG", expect: "GENERAL_PLANGRAPH" },
    { utterance: "راقب مستوى الكلور في المحطة ونبهني", planKind: "MONITORING", expect: "MONITORING" },
    { utterance: "راقب عقود تأجير خلايا النحل", planKind: "MONITORING", expect: "MONITORING" },
    { utterance: "أنشئ نظام إعارة لمكتبة المسجد", planKind: "PERSISTENT_WORLD", expect: "PERSISTENT_WORLD" },
  ] as const;

  it.each(cases)("«$utterance» → $expect", ({ planKind, expect: expected }) => {
    const decision = route({
      envelopeKind: "direct_action",
      plan: planOf(planKind as PlanGraph["kind"], planKind === "DAG" ? [DAG_NODE] : []),
      planValidation: validation(),
    });
    expect(decision.route).toBe(expected);
  });

  it("ten different requests used at most five distinct routes", () => {
    const routes = new Set(
      cases.map(
        ({ planKind }) =>
          route({
            envelopeKind: "direct_action",
            plan: planOf(planKind as PlanGraph["kind"], planKind === "DAG" ? [DAG_NODE] : []),
            planValidation: validation(),
          }).route,
      ),
    );
    expect(routes.size).toBeLessThanOrEqual(5);
  });
});

describe("DOMAIN_ROUTES_ADDED = 0", () => {
  const source = readFileSync(join(__dirname, "../../api/runtime/semantic-router.ts"), "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .replace(/`[^`]*`/g, '""')
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, '""');

  it.each([
    "sales", "inventory", "jobs", "restaurant", "driver", "travel", "hotel",
    "shopping", "recruitment", "hiring", "car", "flight", "delivery",
  ])("the router's code names no «%s»", (word) => {
    expect(code.toLowerCase()).not.toContain(word);
  });

  it("the route vocabulary is exactly nine generic mechanisms", () => {
    expect([...SEMANTIC_ROUTES].sort()).toEqual(
      [
        "DIRECT_READ",
        "GENERAL_PLANGRAPH",
        "GENERATED_PRESENTATION",
        "LEGACY_FLAT",
        "MONITORING",
        "PERSISTENT_LIVING_OBJECT",
        "PERSISTENT_WORLD",
        "TEXT",
        "TRUSTED_PRODUCT_ACTION",
      ].sort(),
    );
  });

  it("every rule resolves to a route in the vocabulary", () => {
    for (const rule of ROUTING_RULES) {
      expect(SEMANTIC_ROUTES).toContain(rule.route);
    }
  });

  it("the rules cover every envelope kind the output router can emit", () => {
    const kinds: RoutableEnvelopeKind[] = [
      "text", "ephemeral_bubble", "interactive_bubble", "structured_result",
      "direct_action", "workflow", "durable_run", "persistent_smart_bubble",
    ];
    for (const envelopeKind of kinds) {
      expect(ROUTING_RULES.some((rule) => rule.when({ envelopeKind }))).toBe(true);
    }
  });
});
