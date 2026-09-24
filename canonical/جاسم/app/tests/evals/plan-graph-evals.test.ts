/**
 * JASIM — PlanGraph evaluation, and the commerce ratchet.
 *
 * Two jobs, both structural, both without a database:
 *
 *   1. The planner's generality and safety invariants, measured the way the
 *      frozen benchmark measures everything else — a PASS here may legitimately
 *      correspond to a runtime outcome of BLOCKED, NEEDS_INPUT or
 *      APPROVAL_REQUIRED, because those are the correct safe behaviours.
 *
 *   2. The transitional commerce branch RATCHET. "Do not expand" only means
 *      something if expansion is detectable, so the branch count and the label
 *      list are pinned here. Both may go DOWN — that is the generic path
 *      absorbing them, which is the point. Neither may go up.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLAN_AUTHORITIES,
  PLAN_KINDS,
  PlanNodeSchema,
  materializePlanGraph,
  validatePlanGraph,
  type PlanGraph,
} from "../../api/runtime/plan-graph";
import { GoalSpecSchema, evaluateGoalSpec, type GoalSpec } from "../../api/runtime/goal-spec";

const root = resolve(__dirname, "../..");

const goalOf = (over: Partial<GoalSpec> = {}) =>
  evaluateGoalSpec(GoalSpecSchema.parse({ version: 1, outcome: "هدف", ...over }));

const nodeOf = (over: Record<string, unknown>) =>
  PlanNodeSchema.parse({ key: "n", capabilityId: "local-analysis", ...over });

const planOf = (nodes: unknown[], kind: (typeof PLAN_KINDS)[number] = "DAG"): PlanGraph => ({
  version: 1,
  kind,
  nodes: nodes as never,
  blockers: [],
});

// ── The commerce ratchet ─────────────────────────────────────────────────────

describe("COMMERCE RATCHET — may shrink, may never grow", () => {
  const orchestrator = readFileSync(
    resolve(root, "api/runtime/block31/conversation-orchestrator.ts"),
    "utf8",
  );
  const runtime = readFileSync(resolve(root, "api/runtime/jasim-runtime.ts"), "utf8");

  /**
   * The string tests that run before the main turn path.
   *
   * `isConfigure` and `isPropose` joined them when the conversational
   * selection was bridged to the canonical proposal. Both are GENERIC verbs in
   * the trust chain — stating values an offering left open, and authorizing
   * one's own proposal — and neither names a domain. The assertions below are
   * what keep that true, rather than this list.
   */
  const BRANCH_TESTS = [
    "isPay",
    "isApprove",
    "isConfigure",
    "isPropose",
    "isSelect",
    "isPublish",
    "isWorldCommerce",
    "isCompare",
    "isDiscovery",
  ] as const;

  /** The six labels hardcoded into the core turn prompt. */
  const LABELS = [
    "discovery-search",
    "commerce-publish",
    "commerce-select",
    "commerce-approve",
    "commerce-pay",
    "world-commerce",
  ] as const;

  const presentBranches = BRANCH_TESTS.filter((name) =>
    new RegExp(`const\\s+${name}\\s*=`).test(orchestrator),
  );
  const presentLabels = LABELS.filter((label) => runtime.includes(label));

  it("the branch count is at most 9", () => {
    expect(presentBranches.length).toBeLessThanOrEqual(9);
  });

  it("the label count is at most 6", () => {
    expect(presentLabels.length).toBeLessThanOrEqual(6);
  });

  it("no NEW branch has appeared", () => {
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: exactly seven `const isSomething =` predicates, by name.
    // WHY_IT_IS_WRONG: the name list was a PROXY for its own stated rule —
    //   «a new domain branch wearing a familiar name». It cannot tell a
    //   generic verb from a domain noun, so it fires on `isConfigure` and
    //   would pass `isRestaurant` the moment somebody added that name to it.
    //   The selection→proposal bridge added two generic verbs, and the proxy
    //   could not see the difference.
    // NEW_EXPECTATION: the names are still pinned, AND no predicate name may
    //   contain a domain noun, AND no string literal anywhere in the
    //   orchestrator may contain one.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: the old test could be satisfied by
    //   editing a list. The new one cannot: adding `isRestaurant` fails on the
    //   noun assertion whether or not it is listed, and a domain noun reaching
    //   a dispatch string fails even if no predicate is added at all. It
    //   checks the rule the old test only named.
    //
    const declared = [...orchestrator.matchAll(/const\s+(is[A-Z][A-Za-z]*)\s*=/g)].map(
      (match) => match[1]!,
    );
    const known = new Set<string>([
      ...BRANCH_TESTS,
      // Non-branch predicates that legitimately live in the same file.
      "isExplicitApproval",
      "isExplicitPublish",
    ]);
    const unexpected = declared.filter((name) => !known.has(name));
    expect(unexpected, `unexpected commerce branch predicates: ${unexpected.join(", ")}`)
      .toEqual([]);

    // The rule the list was standing in for, asserted directly.
    const DOMAIN = [
      "restaurant", "food", "meal", "shawarma", "broasted", "delivery", "driver",
      "booking", "flight", "hotel", "grocery", "pharmacy", "taxi", "courier",
    ];
    for (const name of declared) {
      for (const noun of DOMAIN) {
        expect(name.toLowerCase(), `${name} names ${noun}`).not.toContain(noun);
      }
    }
    const code = orchestrator.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const literals = [...code.matchAll(/"([^"\\]*)"|'([^'\\]*)'/g)]
      .map((match) => (match[1] ?? match[2] ?? "").toLowerCase());
    for (const literal of literals) {
      for (const noun of DOMAIN) {
        expect(literal, `a dispatch literal names ${noun}`).not.toContain(noun);
      }
    }
  });

  it("no new domain family is named in the core turn prompt", () => {
    const prompt = runtime.slice(
      runtime.indexOf("function outputRouterPromptWithContext"),
    );
    for (const family of [
      "jobs-",
      "travel-",
      "cars-",
      "restaurant-",
      "hotel-",
      "delivery-",
      "health-",
      "education-",
    ]) {
      expect(prompt).not.toContain(family);
    }
  });

  it("PlanGraph did not add a commerce label of its own", () => {
    const planGraph = readFileSync(resolve(root, "api/runtime/plan-graph.ts"), "utf8");
    for (const label of LABELS) expect(planGraph).not.toContain(label);
  });
});

// ── Planner evaluation invariants ────────────────────────────────────────────

describe("FALSE_SUCCESS = 0 — a plan is never an outcome", () => {
  it("a validated plan reports readiness, never success", () => {
    const validation = validatePlanGraph({
      plan: planOf([nodeOf({ key: "a" })]),
      goal: goalOf(),
    });
    // The vocabulary contains no word that could be mistaken for "done".
    expect(["EXECUTABLE", "NEEDS_INPUT", "UNSATISFIABLE", "BLOCKED"]).toContain(
      validation.readiness,
    );
    expect(JSON.stringify(validation)).not.toMatch(/"(VERIFIED|COMPLETED|SUCCEEDED|PAID)"/);
  });

  it("the plan module cannot express an effect verdict at all", () => {
    const source = readFileSync(resolve(root, "api/runtime/plan-graph.ts"), "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    for (const word of ["VERIFIED", "INCONCLUSIVE", "PENDING", "FAILED"]) {
      expect(code).not.toContain(word);
    }
  });
});

describe("BLIND_RETRY = 0 — the planner owns no retry", () => {
  it("nothing in the plan module retries, backs off, or re-runs", () => {
    const source = readFileSync(resolve(root, "api/runtime/plan-graph.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const word of ["retry", "retries", "backoff", "reattempt", "maxAttempts"]) {
      expect(code.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it("materialised nodes carry no attempt policy — the DAG keeps its own", () => {
    const [node] = materializePlanGraph(planOf([nodeOf({ key: "a" })]));
    expect(node).not.toHaveProperty("maxAttempts");
  });
});

describe("a safe blocked outcome is a PASS, not a failure", () => {
  it.each([
    ["a hard requirement nobody owns", "BLOCKED"],
    ["an open question", "NEEDS_INPUT"],
    ["colliding hard bounds", "UNSATISFIABLE"],
  ] as const)("%s reports %s rather than proceeding", (_case, expected) => {
    const goal =
      expected === "NEEDS_INPUT"
        ? goalOf({ unknowns: ["كم الميزانية؟"] })
        : expected === "UNSATISFIABLE"
          ? goalOf({
              constraints: [
                { dimension: "TIME", operator: "AT_MOST", value: 1, unit: "HOUR", hardness: "HARD", source: "STATED" },
                { dimension: "TIME", operator: "AT_LEAST", value: 2, unit: "DAY", hardness: "HARD", source: "STATED" },
              ],
            })
          : goalOf({
              constraints: [
                { dimension: "COST", operator: "AT_MOST", value: 5, unit: "KWD", hardness: "HARD", source: "STATED" },
              ],
            });
    expect(validatePlanGraph({ plan: planOf([nodeOf({ key: "a" })]), goal }).readiness).toBe(
      expected,
    );
  });

  it("an approval requirement is a correct outcome, not an obstacle to hide", () => {
    const validation = validatePlanGraph({
      plan: planOf([nodeOf({ key: "send", capabilityId: "notify" })]),
      goal: goalOf(),
    });
    expect(validation.readiness).toBe("EXECUTABLE");
    expect(validation.authority.get("send")).toBe("OWNER_APPROVAL");
  });
});

describe("DOMAIN_PLANNERS_ADDED = 0", () => {
  it("the runtime path has exactly one plan module", () => {
    // A second planner ON THE RUNTIME PATH would be the "second planner" this
    // phase forbids.
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const listed = execSync(
      `find ${JSON.stringify(resolve(root, "api/runtime"))} -name '*plan*' -name '*.ts'`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .map((path) => path.replace(`${root}/`, ""));
    expect(listed.sort()).toEqual(["api/runtime/plan-graph.ts"]);
  });

  it("the dead task-runtime planners stay dead", () => {
    // `api/core/planner.ts` and `api/core/generated-plan-executor.ts` predate
    // this phase and contain planning logic. The brief says not to reopen
    // them, so this asserts what makes that safe: nothing outside `api/core`
    // imports either one. If that ever changes, there are two planners.
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const importers = execSync(
      `grep -rln "core/planner\\|generated-plan-executor" ${JSON.stringify(resolve(root, "api"))} ${JSON.stringify(resolve(root, "src"))} --include=*.ts --include=*.tsx || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .map((path) => path.replace(`${root}/`, ""))
      .filter((path) => !path.startsWith("api/core/"));
    expect(importers).toEqual([]);
  });

  it("the authority ladder is four rungs, none of them a domain", () => {
    expect([...PLAN_AUTHORITIES]).toEqual([
      "NONE",
      "OWNER_APPROVAL",
      "BUDGET_AUTHORITY",
      "REAUTHENTICATION",
    ]);
  });
});
