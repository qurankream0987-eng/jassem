/**
 * JASIM — the policy contract.
 *
 * The live proof is `tests/block31/policy-enforcement.test.ts`. This file holds
 * what must be true without a database:
 *
 *   POLICY TEXT != EXECUTABLE POLICY
 *   MODEL INTERPRETATION != AUTHORITY
 *   UNKNOWN POLICY SEMANTICS != ALLOW
 *   POLICY ABSENCE != POLICY DENIAL
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POLICY_AUTHORITY_KEYS,
  POLICY_BODY_CLASSES,
  POLICY_DECISIONS,
  POLICY_EFFECTS,
  POLICY_OPERATORS,
  POLICY_SCHEMA_ID,
  assertNoPolicyAuthorityClaim,
  classifyPolicyBody,
  disclosableDecision,
  parseEnforcementPolicy,
  permitsExecution,
  policyFacts,
  scalarPaths,
} from "../../api/runtime/policy-enforcement";
import { AUTHORITY_KEYS } from "../../api/runtime/model-output-trust";

const source = readFileSync(resolve(process.cwd(), "api/runtime/policy-enforcement.ts"), "utf8");

/**
 * Comments removed.
 *
 * The module names `FactoryPolicy` and `ShippingPolicyEvaluator` in comments
 * saying they must never exist. A check that cannot tell the rule from the
 * violation would force the rule to be deleted in order to pass.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const RULE = (over: Record<string, unknown>) => ({
  policySchema: POLICY_SCHEMA_ID,
  actions: ["*"],
  effect: "ALLOW",
  ...over,
});

// ── One evaluator, no domains ────────────────────────────────────────────────

describe("one evaluator for every rule there is", () => {
  it("exports no domain policy type or evaluator", () => {
    const DOMAIN = [
      "Factory", "Restaurant", "Shipping", "Negotiation", "Wholesale", "Payment",
      "Salary", "Rent", "Laboratory", "Warehouse", "Generator", "Agent",
    ];
    const declared = [...code.matchAll(/export (?:type|function|const|class) (\w+)/g)].map(
      (match) => match[1]!,
    );
    for (const name of declared) {
      for (const word of DOMAIN) {
        expect(name, `${name} contains ${word}`).not.toContain(word);
      }
    }
  });

  it("names no field, unit or subject anywhere", () => {
    // A rule's fields are data. The evaluator reads none of them.
    for (const word of ['"price"', '"amount"', '"quantity"', '"JOD"', '"currency"', '"salary"']) {
      expect(code, word).not.toContain(word);
    }
  });

  it("its vocabularies are closed", () => {
    expect([...POLICY_EFFECTS]).toEqual(["ALLOW", "DENY", "REQUIRE_APPROVAL", "CONSTRAIN"]);
    expect([...POLICY_DECISIONS]).toEqual([
      "ALLOWED",
      "DENIED",
      "REQUIRES_APPROVAL",
      "UNSUPPORTED_POLICY",
    ]);
    expect([...POLICY_BODY_CLASSES]).toEqual(["ENFORCED", "RECORDED_ONLY", "MALFORMED"]);
    // Reused from the fabric's own set; `within_time` and `compatible` are
    // deliberately absent because both need context to evaluate.
    expect([...POLICY_OPERATORS]).toEqual(["eq", "neq", "gte", "lte", "gt", "lt", "contains"]);
  });

  it("treats four unrelated fields identically", () => {
    const decide = (field: string) =>
      parseEnforcementPolicy(
        RULE({ effect: "CONSTRAIN", requires: [{ field, operator: "lte", value: 10 }] }),
      ).requires[0]!.operator;
    const results = ["price", "instrumentHours", "kilowatts", "عدد الخلايا"].map(decide);
    expect(new Set(results).size).toBe(1);
  });
});

// ── POLICY TEXT != EXECUTABLE POLICY ─────────────────────────────────────────

describe("prose cannot masquerade as a rule", () => {
  it("a body that claims nothing is a setting", () => {
    expect(classifyPolicyBody({ text: "لا تبيع بأقل من التكلفة" })).toBe("RECORDED_ONLY");
    expect(classifyPolicyBody({ colour: "أزرق", floor: 180 })).toBe("RECORDED_ONLY");
  });

  it("a body that claims the schema and fails is MALFORMED, never a setting", () => {
    // The difference that matters: a note enforces nothing and never claimed
    // to; a broken rule claimed to and cannot, so it fails closed.
    for (const body of [
      { policySchema: POLICY_SCHEMA_ID },
      { policySchema: POLICY_SCHEMA_ID, effect: "SOMETIMES", actions: ["*"] },
      { policySchema: POLICY_SCHEMA_ID, effect: "DENY", actions: [] },
      { policySchema: POLICY_SCHEMA_ID, effect: "CONSTRAIN", actions: ["*"] },
      { policySchema: "jasim.policy/99", effect: "DENY", actions: ["*"] },
    ]) {
      expect(classifyPolicyBody(body), JSON.stringify(body)).toBe("MALFORMED");
    }
  });

  it("a CONSTRAIN with nothing to satisfy is not a constraint", () => {
    expect(() => parseEnforcementPolicy(RULE({ effect: "CONSTRAIN" }))).toThrow(/requires/i);
  });

  it("refuses an operator, a value or a window it does not recognise", () => {
    const bad: Array<Record<string, unknown>> = [
      RULE({ conditions: [{ field: "x", operator: "roughly", value: 1 }] }),
      RULE({ conditions: [{ field: "x", operator: "eq", value: { nested: 1 } }] }),
      RULE({ conditions: [{ field: "", operator: "eq", value: 1 }] }),
      RULE({ conditions: [{ field: "x", operator: "eq", value: Number.POSITIVE_INFINITY }] }),
      RULE({ effectiveFrom: "soon" }),
      RULE({ actions: [""] }),
    ];
    for (const body of bad) {
      expect(() => parseEnforcementPolicy(body), JSON.stringify(body)).toThrow();
    }
  });
});

// ── MODEL INTERPRETATION != AUTHORITY ────────────────────────────────────────

describe("no model is consulted at enforcement time", () => {
  it("the module cannot reach one", () => {
    // Structural, not a promise: there is no import to call.
    for (const forbidden of ["model-gateway", "modelGateway", "ModelGateway", "generate("]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("nothing else asks a model what a policy means", () => {
    const callers = execSync(
      "grep -rln 'policy-enforcement' api || true",
      { cwd: process.cwd(), encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .sort();
    // One boundary, named in exactly four places: the three that ACT — the
    // turn, the executor and the commitment — and one comment recording that
    // the refused-keys set is mirrored. Nothing interprets.
    expect(callers).toEqual([
      "api/runtime/agreement-runtime.ts",
      "api/runtime/authority-acts.ts",
      "api/runtime/jasim-runtime.ts",
      "api/runtime/model-output-trust.ts",
    ]);
  });

  it("no capability reads a policy of its own", () => {
    const registry = readFileSync(
      resolve(process.cwd(), "api/runtime/capability-registry.ts"),
      "utf8",
    );
    // Do not make every capability implement its own policy reading.
    expect(registry).not.toContain("policy-enforcement");
    expect(registry).not.toContain("evaluatePolicies");
  });
});

// ── The two defaults ─────────────────────────────────────────────────────────

describe("absence and ignorance are different answers", () => {
  it("permitsExecution is true for ALLOWED and nothing else", () => {
    for (const outcome of POLICY_DECISIONS) {
      expect(
        permitsExecution({ outcome, reasons: [], consulted: [] }),
        outcome,
      ).toBe(outcome === "ALLOWED");
    }
  });

  it("the outcome is resolved narrowest-first, in code", () => {
    // Read from the module so a future edit that reorders it is a visible diff.
    const resolution = code.slice(code.indexOf("const outcome: PolicyDecisionClass"));
    const body = resolution.slice(0, resolution.indexOf(";"));
    expect(body.indexOf("unsupported")).toBeLessThan(body.indexOf("denied"));
    expect(body.indexOf("denied")).toBeLessThan(body.indexOf("requiresApproval"));
    expect(body).toContain('"ALLOWED"');
  });

  it("an ALLOW effect sets nothing that could raise an outcome", () => {
    const evaluate = code.slice(code.indexOf("export async function evaluatePolicies"));
    const allowBranch = evaluate.slice(evaluate.indexOf('policy.effect === "ALLOW"'));
    const block = allowBranch.slice(0, allowBranch.indexOf("continue;"));
    for (const forbidden = ["denied = false", "requiresApproval = false", "unsupported = false"] as const;;) {
      for (const entry of forbidden) expect(block, entry).not.toContain(entry);
      break;
    }
  });
});

// ── Authority ────────────────────────────────────────────────────────────────

describe("a caller may propose a rule, never a decision", () => {
  it.each(["policyDecision", "policyVersion", "policyOverride", "bypass", "trusted", "exempt"])(
    "refuses «%s» rather than ignoring it",
    (key) => {
      expect(() => assertNoPolicyAuthorityClaim({ [key]: true }, "a policy body")).toThrow();
    },
  );

  it("every policy authority key is also refused in model output", () => {
    // One door closed and the other open is one open door.
    for (const key of POLICY_AUTHORITY_KEYS) {
      expect(AUTHORITY_KEYS, key).toContain(key);
    }
  });
});

// ── Private policy ───────────────────────────────────────────────────────────

describe("a rule steers a decision without being disclosed", () => {
  it("what may be recorded carries no payload", () => {
    const disclosed = disclosableDecision({
      outcome: "DENIED",
      reasons: [
        {
          policyId: "pol_1",
          policyKey: "floor",
          version: 3,
          effect: "CONSTRAIN",
          code: "REQUIREMENT_UNSATISFIED",
          field: "terms.price",
        },
      ],
      consulted: [{ policyId: "pol_1", version: 3 }],
    });
    const serialized = JSON.stringify(disclosed);
    expect(serialized).toContain("pol_1");
    expect(serialized).toContain('"version":3');
    // Attributable, explainable, and silent about the bound itself.
    expect(Object.keys(disclosed).sort()).toEqual(["outcome", "policies"]);
  });

  it("a reason carries a field name and never a bound", () => {
    const reason = code.slice(code.indexOf("export type PolicyReason"));
    const body = reason.slice(0, reason.indexOf("};"));
    expect(body).toContain("field?");
    for (const forbidden = ["value", "conditions", "requires", "body"] as const;;) {
      for (const entry of forbidden) {
        expect(body, entry).not.toMatch(new RegExp(`readonly ${entry}[?:]`));
      }
      break;
    }
  });
});

// ── One path convention ──────────────────────────────────────────────────────

describe("a rule names the field a person reads", () => {
  it("flattens by dotted path, sorted", () => {
    const paths = scalarPaths({ b: 2, a: { d: 4, c: 3 } }).map((entry) => entry.path);
    expect(paths).toEqual(["a.c", "a.d", "b"]);
  });

  it("indexes arrays so a list entry is addressable", () => {
    expect(policyFacts({ terms: [{ price: 1 }, { price: 2 }] })).toEqual({
      "terms[0].price": 1,
      "terms[1].price": 2,
    });
  });

  it("the authority statement renders its lines from the same walk", () => {
    const acts = readFileSync(resolve(process.cwd(), "api/runtime/authority-acts.ts"), "utf8");
    expect(acts).toContain('from "./policy-enforcement"');
    expect(acts).toContain("scalarPaths(value, prefix)");
  });
});
