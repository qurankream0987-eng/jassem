/**
 * JASIM — ENOUGH FOR THIS, NOT ENOUGH FOR THAT.
 *
 *   FRESH_ENOUGH_FOR_DISCOVERY != FRESH_ENOUGH_FOR_TRANSACTION
 *   LISTED != CURRENTLY_AVAILABLE · DECLARED != VERIFIED
 *   CONFIRMED_ONCE != TRUE_FOREVER
 *   UNKNOWN != AVAILABLE · UNKNOWN != UNAVAILABLE
 *
 * Time is injected, never waited for.
 *
 *   REAL_TIME_SLEEP_TESTS = 0
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_EVIDENCE_POLICIES,
  EVIDENCE_PURPOSES,
  attributionFor,
  decideSufficiency,
  requirementKeyFor,
  type EvidenceRecord,
  type EvidencePurpose,
  type FactRef,
} from "../../api/runtime/evidence-sufficiency";
import type { EffectClaimSource } from "../../api/runtime/completion-policy";

const T0 = new Date("2026-09-24T12:00:00Z");
const at = (msAfter: number) => new Date(T0.getTime() + msAfter);
const MINUTE = 60_000;

const fact = (over: Partial<FactRef> = {}): FactRef => ({
  subjectKind: "offering", subjectId: "o1", property: "availability", ...over,
});

const evidence = (over: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  id: "ev1", source: "SELF_REPORTED", observedAt: T0, freshnessExpiresAt: null,
  configuration: {}, quantity: null, subjectRevision: null, value: "AVAILABLE", ...over,
});

const decide = (
  purpose: EvidencePurpose,
  records: readonly EvidenceRecord[],
  now: Date,
  over: Partial<FactRef> = {},
) =>
  decideSufficiency({
    fact: fact(over), purpose, evidence: records,
    policy: DEFAULT_EVIDENCE_POLICIES[purpose], now,
  });

// ── A · THE SAME EVIDENCE, TWO ANSWERS ──────────────────────────────────────

describe("purpose decides, not the thing", () => {
  it("a listing five minutes old is enough to show and not enough to commit", () => {
    //   PURPOSE_SPECIFIC_SUFFICIENCY · FRESH_DECLARATION_DISCOVERY
    const declared = [evidence({ source: "SELF_REPORTED", observedAt: T0 })];
    const now = at(5 * MINUTE);

    for (const purpose of ["DISCOVER", "PRESENT", "COMPARE", "ANSWER_INFORMATION"] as const) {
      const out = decide(purpose, declared, now);
      expect(out.verdict, purpose).toBe("SUFFICIENT");
      // Nothing is being asked for, so nothing can be asked twice.
      expect(out.requirementKey, purpose).toBeNull();
    }

    for (const purpose of ["RESERVE", "COMMIT", "EXECUTE"] as const) {
      const out = decide(purpose, declared, now);
      expect(out.verdict, purpose).toBe("STRONGER_EVIDENCE_REQUIRED");
      expect(out.reason, purpose).toBe("SOURCE_NOT_ACCEPTED_FOR_PURPOSE");
    }
  });

  it("a fresh counterparty confirmation is enough to commit on", () => {
    //   FRESH_CONFIRMATION_REUSED · DUPLICATE_VERIFICATION_REQUIREMENT = 0
    const confirmed = [evidence({ source: "OWNER_CONFIRMATION", observedAt: at(MINUTE) })];
    const out = decide("COMMIT", confirmed, at(2 * MINUTE));
    expect(out.verdict).toBe("SUFFICIENT");
    expect(out.evidence!.id).toBe("ev1");
    // Asked again seconds later: still sufficient, still no requirement.
    const again = decide("COMMIT", confirmed, at(2 * MINUTE + 30_000));
    expect(again.verdict).toBe("SUFFICIENT");
    expect(again.requirementKey).toBeNull();
  });

  it("the same confirmation goes stale for commit while staying fine for discovery", () => {
    //   PURPOSE_DIFFERENTIATED_STALENESS · STALE_TRANSACTION_EVIDENCE_ACCEPTED = 0
    const confirmed = [evidence({ source: "OWNER_CONFIRMATION", observedAt: T0 })];
    const later = at(60 * MINUTE);
    expect(decide("COMMIT", confirmed, later).verdict).toBe("STRONGER_EVIDENCE_REQUIRED");
    expect(decide("COMMIT", confirmed, later).reason).toBe("EVIDENCE_TOO_OLD");
    expect(decide("DISCOVER", confirmed, later).verdict).toBe("SUFFICIENT");
  });

  it("the boundary is exact on both sides", () => {
    const max = DEFAULT_EVIDENCE_POLICIES.COMMIT.maxAgeMs!;
    const confirmed = [evidence({ source: "OWNER_CONFIRMATION", observedAt: T0 })];
    // Exactly at the limit is still within it; one millisecond past is not.
    expect(decide("COMMIT", confirmed, at(max)).verdict).toBe("SUFFICIENT");
    expect(decide("COMMIT", confirmed, at(max + 1)).verdict).toBe("STRONGER_EVIDENCE_REQUIRED");
  });

  it("an observer's own horizon outranks any policy", () => {
    //   The one who recorded it said how long it was good for.
    const expiring = [evidence({
      source: "OWNER_CONFIRMATION", observedAt: T0, freshnessExpiresAt: at(MINUTE),
    })];
    const out = decide("DISCOVER", expiring, at(2 * MINUTE));
    expect(out.verdict).toBe("STRONGER_EVIDENCE_REQUIRED");
    expect(out.reason).toBe("EVIDENCE_EXPIRED");
  });
});

// ── B · WHAT IS NOT KNOWN ───────────────────────────────────────────────────

describe("nothing known is not a no", () => {
  it("an absent fact is UNKNOWN and is never invented", () => {
    //   MISSING_FACT_FABRICATED = 0
    //   UNKNOWN_COLLAPSED_TO_FALSE = 0 · UNKNOWN_COLLAPSED_TO_TRUE = 0
    const out = decide("ANSWER_INFORMATION", [], at(0), { property: "material" });
    expect(out.verdict).toBe("UNKNOWN");
    expect(out.reason).toBe("NO_EVIDENCE");
    expect(out.evidence).toBeNull();
    // The unanswered question is named so it can be asked later.
    expect(out.requirementKey).toContain("material");
  });

  it("evidence that does not speak to the question is set aside, and said so", () => {
    const black = evidence({ configuration: { colour: "black", size: "L" } });
    const out = decide("DISCOVER", [black], at(0), {
      configuration: { colour: "white", size: "XL" },
    });
    //   CONFIGURATION_MISMATCH_REUSES_EVIDENCE = 0
    expect(out.verdict).toBe("UNKNOWN");
    expect(out.reason).toBe("CONFIGURATION_MISMATCH");
  });

  it("one of something is not ten of something", () => {
    //   QUANTITY_OVERCLAIM = 0
    const one = evidence({ quantity: 1 });
    expect(decide("DISCOVER", [one], at(0), { quantity: 1 }).verdict).toBe("SUFFICIENT");
    const ten = decide("DISCOVER", [one], at(0), { quantity: 10 });
    expect(ten.verdict).toBe("UNKNOWN");
    expect(ten.reason).toBe("QUANTITY_EXCEEDS_EVIDENCE");
    // Evidence carrying no quantity answers no question about quantity.
    expect(decide("DISCOVER", [evidence()], at(0), { quantity: 2 }).verdict).toBe("UNKNOWN");
  });

  it("evidence for one revision does not follow the subject into the next", () => {
    //   STALE_OFFERING_REVISION_EVIDENCE_REUSED = 0
    const v3 = evidence({ subjectRevision: "3", source: "OWNER_CONFIRMATION" });
    expect(decide("COMMIT", [v3], at(0), { subjectRevision: 3 }).verdict).toBe("SUFFICIENT");
    const v4 = decide("COMMIT", [v3], at(0), { subjectRevision: 4 });
    expect(v4.verdict).toBe("UNKNOWN");
    expect(v4.reason).toBe("SUBJECT_REVISED_SINCE");
  });
});

// ── C · WHAT A VERDICT IS NOT ───────────────────────────────────────────────

describe("deciding is not doing", () => {
  it("the module writes nothing, sends nothing and reserves nothing", () => {
    //   FRESHNESS_CREATES_RESERVATION = 0 · FRESHNESS_CREATES_ACCEPTANCE_AUTHORITY = 0
    //   HUMAN_MESSAGES_SENT = 0 · NEW_MESSAGING_RUNTIME = 0 · NEW_PROVIDER_ADAPTERS = 0
    const source = readFileSync(
      resolve(process.cwd(), "api/runtime/evidence-sufficiency.ts"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(source).not.toMatch(/fetch\(|notification|sendMessage|reservation/i);
    expect(source).not.toMatch(/pgTable\(/);
  });

  it("a verdict creates no fact: the value is carried, never interpreted", () => {
    //   FRESHNESS_EVALUATION_CREATES_FACT = 0
    const unavailable = [evidence({ source: "OWNER_CONFIRMATION", value: "UNAVAILABLE" })];
    const out = decide("COMMIT", unavailable, at(MINUTE));
    // Sufficient EVIDENCE that the answer is no. Sufficiency is about the
    // evidence, never about which way it points.
    expect(out.verdict).toBe("SUFFICIENT");
    expect(out.evidence!.value).toBe("UNAVAILABLE");
  });

  it("a declaration stays attributed to whoever declared it", () => {
    //   DECLARATION_PRESENTED_AS_VERIFIED = 0
    expect(attributionFor(evidence({ source: "SELF_REPORTED" }))).toBe("ATTRIBUTED");
    expect(attributionFor(evidence({ source: "EXECUTOR_RETURN" }))).toBe("ATTRIBUTED");
    expect(attributionFor(evidence({ source: "OWNER_CONFIRMATION" }))).toBe("VERIFIED");
    expect(attributionFor(null)).toBe("NONE");
  });

  it("code returning without throwing never binds anybody", () => {
    for (const purpose of ["RESERVE", "COMMIT", "EXECUTE"] as const) {
      expect(DEFAULT_EVIDENCE_POLICIES[purpose].acceptedSources, purpose)
        .not.toContain("EXECUTOR_RETURN" as EffectClaimSource);
      expect(DEFAULT_EVIDENCE_POLICIES[purpose].acceptedSources, purpose)
        .not.toContain("SELF_REPORTED" as EffectClaimSource);
    }
  });
});

// ── D · LOOKING IS NOT ASKING ───────────────────────────────────────────────

describe("being looked at changes nothing", () => {
  it("a hundred views and a hundred searches produce no requirement", () => {
    //   VIEW_COUNT_TRIGGERS_VERIFICATION = 0 · SEARCH_COUNT_TRIGGERS_VERIFICATION = 0
    //   DISCOVERY_UNNECESSARY_VERIFICATION = 0 · COMPARE_UNNECESSARY_VERIFICATION = 0
    const declared = [evidence({ observedAt: T0 })];
    const requirements = new Set<string>();
    for (let view = 0; view < 100; view += 1) {
      for (const purpose of ["DISCOVER", "PRESENT", "COMPARE"] as const) {
        const out = decide(purpose, declared, at(view * 1000));
        expect(out.verdict).toBe("SUFFICIENT");
        if (out.requirementKey) requirements.add(out.requirementKey);
      }
    }
    expect(requirements.size).toBe(0);
  });

  it("identical questions name one requirement, not many", () => {
    //   DUPLICATE_PENDING_REQUIREMENTS = 0
    const asked = fact({ configuration: { size: "L", colour: "black" }, quantity: 1 });
    const reordered = fact({ configuration: { colour: "black", size: "L" }, quantity: 1 });
    expect(requirementKeyFor(asked, "COMMIT")).toBe(requirementKeyFor(reordered, "COMMIT"));
    // A different configuration, quantity or purpose is a different question.
    expect(requirementKeyFor(asked, "COMMIT")).not.toBe(requirementKeyFor(asked, "RESERVE"));
    expect(requirementKeyFor(asked, "COMMIT"))
      .not.toBe(requirementKeyFor(fact({ configuration: { size: "M" } }), "COMMIT"));
  });
});

// ── E · NO DOMAIN ANYWHERE ──────────────────────────────────────────────────

describe("nothing here knows what is being sold", () => {
  it("seven unrelated subjects take the identical decision", () => {
    //   DOMAIN_FRESHNESS_TYPES_ADDED = 0 · UNFAMILIAR_FRESHNESS_REQUIRES_DOMAIN_BRANCH = 0
    const declared = [evidence({ observedAt: T0 })];
    for (const subjectKind of ["garment.listing", "used.vehicle", "professional.hour",
      "machine.time", "venue.slot", "storage.capacity", "seabed.survey_line"]) {
      const shown = decide("DISCOVER", declared, at(MINUTE), { subjectKind });
      const bound = decide("COMMIT", declared, at(MINUTE), { subjectKind });
      expect(shown.verdict, subjectKind).toBe("SUFFICIENT");
      expect(bound.verdict, subjectKind).toBe("STRONGER_EVIDENCE_REQUIRED");
    }
  });

  it("no noun and no per-thing lifetime appears in the source", () => {
    //   DOMAIN_TTLS_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
    const source = readFileSync(
      resolve(process.cwd(), "api/runtime/evidence-sufficiency.ts"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const noun of ["car", "vehicle", "shirt", "garment", "food", "restaurant",
      "hotel", "venue", "machine", "storage"]) {
      expect(source.toLowerCase(), `branches on ${noun}`)
        .not.toMatch(new RegExp(`\\b${noun}s?\\b`));
    }
    // Every lifetime is keyed by a PURPOSE and by nothing else.
    for (const purpose of EVIDENCE_PURPOSES) {
      expect(DEFAULT_EVIDENCE_POLICIES[purpose]).toBeDefined();
    }
    expect(Object.keys(DEFAULT_EVIDENCE_POLICIES).sort()).toEqual([...EVIDENCE_PURPOSES].sort());
  });
});
