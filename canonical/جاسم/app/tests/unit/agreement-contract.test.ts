/**
 * JASIM — the agreement contract.
 *
 * The live proof is `tests/block31/agreement-runtime.test.ts`. This file holds
 * what must be true of the contract without a database:
 *
 *   • a proposal binds nobody, and may never say that it does
 *   • TARGET != AUTHORITY, and neither ever reaches a counterparty
 *   • the module interprets no term key
 *   • EXECUTION != APPROVAL
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NEGOTIATION_AUTHORITY_KEYS,
  NEGOTIATION_VERDICTS,
  TERM_DIRECTIONS,
  TERM_KINDS,
  assertNoNegotiationAuthorityClaim,
  counterpartyProposalView,
  evaluateProposalAgainstEnvelope,
  parseEnvelopeBounds,
  parseTermSheet,
} from "../../api/runtime/agreement-runtime";
import { AUTHORITY_KEYS } from "../../api/runtime/model-output-trust";

const runtimeSource = readFileSync(
  resolve(process.cwd(), "api/runtime/agreement-runtime.ts"),
  "utf8",
);
const capabilitySource = readFileSync(
  resolve(process.cwd(), "api/runtime/agreement-capabilities.ts"),
  "utf8",
);

/**
 * Comments removed.
 *
 * Both modules name the forbidden things in comments saying they must never
 * exist. A check that cannot tell the rule from the violation would force the
 * rule to be deleted in order to pass, which is exactly backwards.
 */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const runtimeCode = strip(runtimeSource);
const capabilityCode = strip(capabilitySource);

// ── Authority ────────────────────────────────────────────────────────────────

describe("a proposal binds nobody, and cannot say otherwise", () => {
  it.each([
    "reserve", "bounds", "envelopeId", "mayConcede", "mayAcceptWithinReserve",
    "authorityBasis", "agreementId", "agreed", "accepted", "committed",
  ])("refuses «%s» rather than ignoring it", (key) => {
    // Ignoring an authority claim is how a caller comes to believe it worked.
    expect(() => assertNoNegotiationAuthorityClaim({ [key]: true }, "inputs")).toThrow();
  });

  it("is case-insensitive, because a key is a word and not a spelling", () => {
    expect(() => assertNoNegotiationAuthorityClaim({ RESERVE: 1 }, "inputs")).toThrow();
    expect(() => assertNoNegotiationAuthorityClaim({ " Agreed ": 1 }, "inputs")).toThrow();
  });

  it("every negotiation authority key is also refused in model output", () => {
    // One door closed and the other open is one open door.
    for (const key of NEGOTIATION_AUTHORITY_KEYS) {
      expect(AUTHORITY_KEYS, key).toContain(key);
    }
  });

  it("a term sheet cannot smuggle one through a term", () => {
    expect(() =>
      parseTermSheet([{ key: "price", kind: "NUMBER", value: 10, mayAccept: true }]),
    ).toThrow(/authority/i);
  });
});

// ── TARGET != AUTHORITY ──────────────────────────────────────────────────────

describe("a target is an opening position, a reserve is the line", () => {
  it("refuses a target that lies beyond its own reserve", () => {
    for (const bound of [
      { direction: "LOWER_IS_BETTER", target: 300, reserve: 250 },
      { direction: "HIGHER_IS_BETTER", target: 100, reserve: 150 },
    ]) {
      expect(() => parseEnvelopeBounds({ price: bound })).toThrow(/reserve/i);
    }
  });

  it("a counter is clamped at the reserve in both directions", () => {
    const cases = [
      { direction: "LOWER_IS_BETTER" as const, target: 200, reserve: 250, incoming: 9999, expect: 250 },
      { direction: "HIGHER_IS_BETTER" as const, target: 200, reserve: 150, incoming: 1, expect: 150 },
    ];
    for (const entry of cases) {
      const evaluation = evaluateProposalAgainstEnvelope({
        incoming: parseTermSheet([{ key: "x", kind: "NUMBER", value: entry.incoming }]),
        bounds: { x: { direction: entry.direction, target: entry.target, reserve: entry.reserve } },
        mayConcede: true,
      });
      expect(evaluation.counter![0]!.value).toBe(entry.expect);
    }
  });

  it("a concession step cannot step past the reserve", () => {
    // 200 → 240 → 250, never 280.
    const bounds = {
      x: { direction: "LOWER_IS_BETTER" as const, target: 200, reserve: 250, concessionStep: 40 },
    };
    let mine = parseTermSheet([{ key: "x", kind: "NUMBER", value: 240 }]);
    const next = evaluateProposalAgainstEnvelope({
      incoming: parseTermSheet([{ key: "x", kind: "NUMBER", value: 9999 }]),
      bounds,
      mayConcede: true,
      mine,
    });
    expect(next.counter![0]!.value).toBe(250);
  });

  it("no permission to move means no counter, whatever the numbers say", () => {
    const evaluation = evaluateProposalAgainstEnvelope({
      incoming: parseTermSheet([{ key: "x", kind: "NUMBER", value: 9999 }]),
      bounds: { x: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 } },
      mayConcede: false,
    });
    expect(evaluation.verdict).toBe("OUT_OF_AUTHORITY");
    expect(evaluation.counter).toBeUndefined();
  });
});

// ── The counterparty view ────────────────────────────────────────────────────

describe("what the other side sees is built, not filtered", () => {
  it("is assembled from named fields", () => {
    // A projection assembled by omission leaks the first field somebody
    // forgets. This one has to be extended deliberately to leak anything.
    const view = counterpartyProposalView({
      id: "p1",
      version: 3,
      proposerOwnerId: "A",
      status: "proposed",
      terms: { terms: [{ key: "price", kind: "NUMBER", value: 200 }] },
    });
    expect(Object.keys(view).sort()).toEqual(
      ["proposalId", "proposedBy", "status", "terms", "version"].sort(),
    );
  });

  it("shows no terms rather than raw storage it cannot read", () => {
    const view = counterpartyProposalView({
      id: "p1",
      version: 1,
      proposerOwnerId: "A",
      status: "proposed",
      terms: { reserve: 250, internalNote: "never go above 250" },
    });
    expect(view.terms).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("250");
  });

  it("the module never reads a bound out of a proposal row", () => {
    // Structural: the view function is the only thing that builds it, and it
    // reads five names.
    const view = runtimeCode.slice(
      runtimeCode.indexOf("export function counterpartyProposalView"),
    );
    const body = view.slice(0, view.indexOf("\n}\n") + 2);
    for (const forbidden of ["reserve", "bounds", "target", "concessionStep", "envelope"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });
});

// ── It interprets nothing ────────────────────────────────────────────────────

describe("the runtime reads no term key", () => {
  it("names no subject anywhere in its code", () => {
    for (const word of [
      '"price"', '"salary"', '"rent"', '"shipping"', '"freight"', '"wage"',
      '"currency"', '"JOD"', '"USD"', '"deliveryDate"', '"hours"',
    ]) {
      expect(runtimeCode, word).not.toContain(word);
      expect(capabilityCode, word).not.toContain(word);
    }
  });

  it("exports no name that is a negotiation subject", () => {
    const DOMAIN = [
      "Salary", "Rent", "Shipping", "Freight", "Price", "Wage", "Lease",
      "Employment", "Procurement", "Marketplace", "Agent",
    ];
    for (const source of [runtimeCode, capabilityCode]) {
      const declared = [...source.matchAll(/export (?:type|function|const|class) (\w+)/g)].map(
        (match) => match[1]!,
      );
      for (const name of declared) {
        for (const word of DOMAIN) {
          expect(name, `${name} contains ${word}`).not.toContain(word);
        }
      }
    }
  });

  it("its vocabularies are closed and contain no subject", () => {
    expect([...TERM_KINDS]).toEqual(["NUMBER", "CHOICE"]);
    expect([...TERM_DIRECTIONS]).toEqual(["LOWER_IS_BETTER", "HIGHER_IS_BETTER", "EXACT"]);
    expect([...NEGOTIATION_VERDICTS]).toEqual([
      "WITHIN_RESERVE",
      "COUNTERABLE",
      "OUT_OF_AUTHORITY",
    ]);
  });

  it("treats four unrelated keys identically", () => {
    const value = (key: string) =>
      evaluateProposalAgainstEnvelope({
        incoming: parseTermSheet([{ key, kind: "NUMBER", value: 400 }]),
        bounds: { [key]: { direction: "LOWER_IS_BETTER", target: 100, reserve: 150 } },
        mayConcede: true,
      }).counter![0]!.value;
    const results = ["price", "monthlyRent", "instrumentHours", "أجرة الشحن"].map(value);
    expect(new Set(results).size).toBe(1);
  });

  it("converts no unit", () => {
    // A runtime that converted would be deciding a rate nobody gave it.
    expect(runtimeCode).not.toMatch(/exchangeRate|convertUnit|toBaseUnit/);
  });
});

// ── EXECUTION != APPROVAL ────────────────────────────────────────────────────

describe("a capability cannot approve", () => {
  it("ownerDirect is a reserved input, so naming it is refused", () => {
    expect(capabilityCode).toContain('"ownerdirect"');
    // And the commit executor never passes it.
    const commit = capabilityCode.slice(
      capabilityCode.indexOf("export async function executeAgreementCommit"),
    );
    expect(commit.slice(0, commit.indexOf("\n}\n"))).not.toContain("ownerDirect:");
  });

  it("only a trusted path sets it", () => {
    const callers = execSync("grep -rln 'ownerDirect: true' api || true", {
      cwd: process.cwd(),
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .sort();
    // The router, where a person is actually present. Nowhere else.
    expect(callers).toEqual(["api/routers/fabric.ts"]);
  });

  it("no reserve leaves through the API surface", () => {
    const router = readFileSync(resolve(process.cwd(), "api/routers/fabric.ts"), "utf8");
    const envelope = router.slice(router.indexOf("negotiationEnvelopeSet:"));
    const body = envelope.slice(0, envelope.indexOf("negotiationEnvelopeHistory:"));
    // Bounds go IN. The row, which carries them, never comes back out.
    expect(body).toContain("boundedTerms");
    expect(body).not.toMatch(/return\s+envelope\s*;/);
  });
});

// ── AGREEMENT != TRANSACTION ─────────────────────────────────────────────────

describe("agreeing is not paying", () => {
  it("the agreement runtime creates no transaction intent", () => {
    const commit = runtimeCode.slice(runtimeCode.indexOf("export async function commitAgreement"));
    const body = commit.slice(0, commit.indexOf("\nexport "));
    expect(body).not.toMatch(/insert\(transactionIntents\)/);
    expect(body).not.toMatch(/paymentIntent|charge|capture/i);
  });

  it("no commitment is inferred from a field name", () => {
    // A Commitment exists only where the sheet declared `owedBy`.
    expect(runtimeCode).toContain("terms.filter((term) => term.owedBy)");
  });
});
