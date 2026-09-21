/**
 * JASIM — the authority-act contract.
 *
 * The live proof is `tests/block31/authority-administration.test.ts`. This file
 * holds what must be true without a database:
 *
 *   APPROVAL != CLICK
 *   MODEL PROPOSES != RUNTIME PERFORMS
 *   STATEMENT != SUMMARY
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTHORITY_ACT_KEYS,
  AUTHORITY_REQUEST_STATES,
  AUTHORITY_RESOLUTIONS,
  PARAM_KINDS,
  assertNoAuthorityActClaim,
  listAuthorityActs,
  statementDigest,
} from "../../api/runtime/authority-acts";
import { SCOPE_PERMISSIONS } from "../../api/runtime/actor-scope";
import { AUTHORITY_KEYS } from "../../api/runtime/model-output-trust";

const source = readFileSync(resolve(process.cwd(), "api/runtime/authority-acts.ts"), "utf8");
const router = readFileSync(resolve(process.cwd(), "api/routers/runtime.ts"), "utf8");

/**
 * Comments removed.
 *
 * The module names `RestaurantOnboarding` in a comment saying it must never
 * exist. A check that cannot tell the rule from the violation would force the
 * rule to be deleted in order to pass.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── The acts are general verbs ───────────────────────────────────────────────

describe("an act is a general verb over a general primitive", () => {
  it("no act id is an industry or an onboarding", () => {
    const FORBIDDEN = [
      "restaurant", "factory", "school", "clinic", "hotel", "shop", "logistics",
      "onboard", "wizard", "setup",
    ];
    for (const act of listAuthorityActs()) {
      for (const word of FORBIDDEN) {
        expect(act.id.toLowerCase(), `${act.id} contains ${word}`).not.toContain(word);
      }
    }
  });

  it("every declared permission is a verb from the closed set", () => {
    for (const act of listAuthorityActs()) {
      if (act.requiredPermission === null) continue;
      expect(SCOPE_PERMISSIONS as readonly string[], act.id).toContain(act.requiredPermission);
    }
  });

  it("every parameter has a kind from the closed set and a label", () => {
    for (const act of listAuthorityActs()) {
      expect(act.params.length, act.id).toBeGreaterThan(0);
      for (const spec of act.params) {
        expect(PARAM_KINDS, `${act.id}.${spec.key}`).toContain(spec.kind);
        // The label is what the person reads. An unlabelled parameter is a
        // parameter shown as a variable name.
        expect(spec.label.trim().length, `${act.id}.${spec.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("every act reads back what it did", () => {
    //   RECEIPT != VERIFICATION
    // An act returning an id is its own word about itself, and an act's own
    // word is worth nothing about an act.
    for (const act of listAuthorityActs()) {
      expect(act.readback, `${act.id} cannot verify itself`).toBeTypeOf("function");
    }
  });

  it("every act says what it cannot undo", () => {
    for (const act of listAuthorityActs()) {
      expect(
        ["REVERSIBLE", "PARTIALLY_COMPENSATABLE", "IRREVERSIBLE"],
        act.id,
      ).toContain(act.reversibility);
      if (act.reversibility !== "REVERSIBLE") {
        // Saying IRREVERSIBLE without saying what survives is a warning label
        // with nothing on it.
        expect(act.residualNote, act.id).toBeTruthy();
      }
    }
  });
});

// ── No opaque id may be approved ─────────────────────────────────────────────

describe("an id must be expanded into what it means", () => {
  it("every act naming a row declares how to read it", () => {
    // «وافق على العرض p_8f3a» is not something a person can consent to. This
    // is the ratchet that keeps the next act from asking them to.
    for (const act of listAuthorityActs()) {
      const namesARow = act.params.some((spec) => /Id$/.test(spec.key));
      if (!namesARow) continue;
      expect(act.expand, `${act.id} names an id and cannot say what it means`).toBeTypeOf(
        "function",
      );
    }
  });

  it("at least one act names no id at all, so the rule is not vacuous", () => {
    const plain = listAuthorityActs().filter(
      (act) => !act.params.some((spec) => /Id$/.test(spec.key)),
    );
    expect(plain.length).toBeGreaterThan(0);
  });
});

// ── The statement is rendered, never narrated ────────────────────────────────

describe("the runtime writes the statement", () => {
  it("is driven by the declared schema, not by the act", () => {
    // If the renderer asked the act what to show, an act could show less than
    // it does. It iterates `act.params` instead.
    const render = code.slice(code.indexOf("export async function renderAuthorityStatement"));
    const body = render.slice(0, render.indexOf("\n}\n"));
    expect(body).toContain("for (const spec of input.act.params)");
    expect(body).toContain("flatten(spec.key");
  });

  it("flattens rather than summarising", () => {
    // A summary is where a number goes to hide.
    expect(code).toContain("function flatten(");
    expect(code).not.toMatch(/JSON\.stringify\(value\)[^;]*into\.push/);
  });

  it("sorts nested keys, so storage order cannot change a digest", () => {
    // The walk lives in `policy-enforcement`, shared with the policy layer so
    // a rule names its field by the same dotted path a person reads. The sort
    // therefore has to hold there.
    const walker = readFileSync(
      resolve(process.cwd(), "api/runtime/policy-enforcement.ts"),
      "utf8",
    );
    const fn = walker.slice(walker.indexOf("export function scalarPaths("));
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toContain(".sort(");
    expect(code).toContain("scalarPaths(value, prefix)");
  });

  it("the same statement always digests the same, and a changed one never does", () => {
    const statement = {
      actType: "policy.set",
      headline: "h",
      onBehalfOf: { scopeId: "s", kind: "ORGANIZATION" as const, displayName: "ش" },
      lines: [{ key: "value.floor", label: "l", value: 180 }],
      reversibility: "REVERSIBLE",
    };
    const reordered = {
      onBehalfOf: { displayName: "ش", kind: "ORGANIZATION" as const, scopeId: "s" },
      headline: "h",
      reversibility: "REVERSIBLE",
      lines: [{ value: 180, label: "l", key: "value.floor" }],
      actType: "policy.set",
    };
    expect(statementDigest(reordered)).toBe(statementDigest(statement));
    const changed = { ...statement, lines: [{ key: "value.floor", label: "l", value: 181 }] };
    expect(statementDigest(changed)).not.toBe(statementDigest(statement));
  });

  it("the scope's name comes from the database", () => {
    const fn = code.slice(code.indexOf("async function scopeDisplayName"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("organizations.displayName");
    // Not from the resolution that was handed in. A caller cannot rename a
    // company for the length of one sentence.
    expect(body).not.toContain("scope.displayName");
  });
});

// ── Authority ────────────────────────────────────────────────────────────────

describe("a request may name an act, never decide one", () => {
  it.each([
    "approved", "statementDigest", "statement", "authorityRequestId",
    "performed", "principalId", "scopeId",
  ])("refuses «%s» rather than ignoring it", (key) => {
    expect(() => assertNoAuthorityActClaim({ [key]: true }, "parameters")).toThrow();
  });

  it("every authority-act key is also refused in model output", () => {
    for (const key of AUTHORITY_ACT_KEYS) {
      expect(AUTHORITY_KEYS, key).toContain(key);
    }
  });

  it("an undeclared parameter is refused, not dropped", () => {
    const validate = code.slice(code.indexOf("function validateParams("));
    expect(validate.slice(0, validate.indexOf("\n}\n"))).toContain("is not a parameter of");
  });

  it("its vocabularies are closed", () => {
    expect([...AUTHORITY_REQUEST_STATES]).toEqual(["PENDING", "PERFORMED", "REJECTED", "VOID"]);
    expect([...AUTHORITY_RESOLUTIONS]).toEqual([
      "REJECTED_BY_PRINCIPAL",
      "EXPIRED",
      "STATEMENT_CHANGED",
      "DIGEST_MISMATCH",
    ]);
  });
});

// ── APPROVAL != CLICK ────────────────────────────────────────────────────────

describe("approving cites what was read", () => {
  it("the digest is required by the API, not optional", () => {
    const procedure = router.slice(router.indexOf("authorityRequestApprove:"));
    const body = procedure.slice(0, procedure.indexOf("authorityRequestReject:"));
    expect(body).toContain("statementDigest: z.string()");
    expect(body).not.toMatch(/statementDigest[^,]*\.optional\(\)/);
  });

  it("there is no blanket approval", () => {
    // No "approve all pending", no "approve by act type", no standing
    // authorization. Each of those is an approval of something nobody read.
    for (const forbidden of [
      "approveAll", "approveAllPending", "authorityRequestApproveAll",
      "trustThisActType", "alwaysApprove",
    ]) {
      expect(router, forbidden).not.toContain(forbidden);
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("the statement is re-rendered before performing", () => {
    const approve = code.slice(code.indexOf("export async function approveAuthorityRequest"));
    const body = approve.slice(0, approve.indexOf("\nexport "));
    expect(body).toContain("renderAuthorityStatement");
    expect(body).toContain("STATEMENT_CHANGED");
    // And the permission is checked again, because membership can end between
    // reading and deciding.
    expect(body).toContain("assertPermitted");
  });

  it("performing happens only after the row moved out of PENDING", () => {
    const approve = code.slice(code.indexOf("export async function approveAuthorityRequest"));
    const body = approve.slice(0, approve.indexOf("\nexport "));
    const cas = body.indexOf('eq(authorityRequests.state, "PENDING")');
    const perform = body.indexOf("act.perform(");
    expect(cas).toBeGreaterThan(0);
    // One decision, one act: a double-click cannot be two.
    expect(perform).toBeGreaterThan(cas);
  });

  it("no capability performs an authority act", () => {
    // The whole point. A capability sees a scope id and cannot tell an
    // approved run from an unapproved one.
    const registry = readFileSync(
      resolve(process.cwd(), "api/runtime/capability-registry.ts"),
      "utf8",
    );
    expect(registry).not.toContain("authority-acts");
    expect(registry).not.toContain("requestAuthorityAct");
    expect(registry).not.toContain("approveAuthorityRequest");
  });
});
