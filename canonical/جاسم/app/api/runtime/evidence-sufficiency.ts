/**
 * IS WHAT JASIM ALREADY KNOWS GOOD ENOUGH FOR WHAT IT IS ABOUT TO DO?
 *
 *   FRESH_ENOUGH_FOR_DISCOVERY != FRESH_ENOUGH_FOR_TRANSACTION
 *   LISTED != CURRENTLY_AVAILABLE · DECLARED != VERIFIED
 *   CONFIRMED_ONCE != TRUE_FOREVER
 *   NO_RESPONSE != YES · NO_RESPONSE != NO
 *   UNKNOWN != AVAILABLE · UNKNOWN != UNAVAILABLE
 *
 * This module DECIDES AND NOTHING ELSE. It reads evidence that already exists,
 * weighs it against what the next action needs, and returns one of three
 * words. It contacts nobody, calls no provider, reserves nothing, authorizes
 * nothing, and — above all — never turns an absence of evidence into a fact.
 *
 *   FRESHNESS_EVALUATION_CREATES_FACT = 0
 *
 * WHY THIS IS NOT «ASK THE SELLER BEFORE EVERY ACTION». Asking costs somebody's
 * attention, and a listing published four minutes ago is perfectly good reason
 * to SHOW it. The same listing is not good enough reason to let someone commit
 * to buying it. The difference is the purpose, not the thing:
 *
 *   VERIFY WHEN THE COST OF BEING WRONG BECOMES MATERIAL.
 *
 * NOTHING HERE KNOWS WHAT IS BEING SOLD. A shirt, a used vehicle, an
 * interpreter's Thursday, a machine's idle hours and a warehouse's cubic
 * metres are one subject, one property, one configuration and one timestamp.
 *
 *   DOMAIN_FRESHNESS_TYPES_ADDED = 0 · DOMAIN_TTLS_ADDED = 0
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { observations, scopePolicies } from "@db/schema-block2";
import type { EffectClaimSource } from "./completion-policy";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHAT THE EVIDENCE IS FOR.
 *
 * Every entry names a kind of act, never a kind of thing. The list is ordered
 * by how much it costs to be wrong, and that ordering is the whole idea.
 */
export const EVIDENCE_PURPOSES = [
  "DISCOVER",
  "PRESENT",
  "COMPARE",
  "ANSWER_INFORMATION",
  "PROPOSE",
  "RESERVE",
  "COMMIT",
  "EXECUTE",
] as const;
export type EvidencePurpose = (typeof EVIDENCE_PURPOSES)[number];

export const SUFFICIENCY_VERDICTS = [
  /** Act on what is already known. */
  "SUFFICIENT",
  /** Something is known and it is not good enough for THIS act. */
  "STRONGER_EVIDENCE_REQUIRED",
  /** Nothing is known. Not false, not true. */
  "UNKNOWN",
] as const;
export type SufficiencyVerdict = (typeof SUFFICIENCY_VERDICTS)[number];

/** Why a verdict came out the way it did. A refusal people act on is explained. */
export const SUFFICIENCY_REASONS = [
  "WITHIN_POLICY",
  "NO_EVIDENCE",
  "EVIDENCE_TOO_OLD",
  "EVIDENCE_EXPIRED",
  "SOURCE_NOT_ACCEPTED_FOR_PURPOSE",
  "CONFIGURATION_MISMATCH",
  "QUANTITY_EXCEEDS_EVIDENCE",
  "SUBJECT_REVISED_SINCE",
] as const;
export type SufficiencyReason = (typeof SUFFICIENCY_REASONS)[number];

/**
 * WHAT IS BEING ASKED ABOUT.
 *
 * A property of a subject, optionally at an exact configuration and quantity,
 * as of an exact revision of that subject. Every one of those narrows what a
 * piece of evidence can honestly be said to cover.
 */
export type FactRef = {
  readonly subjectKind: string;
  readonly subjectId: string;
  /** The observation type. «availability», «material» — a word, not a schema. */
  readonly property: string;
  /** Black / L. Thursday 19:00. 18:00–21:00. Compared exactly, never loosely. */
  readonly configuration?: Readonly<Record<string, string | number>>;
  readonly quantity?: number;
  /** Which revision of the subject the question is about. */
  readonly subjectRevision?: string | number;
};

/**
 * ONE PIECE OF EVIDENCE, as this module weighs it.
 *
 * `source` is the runtime's own classification of where it came from — never
 * anything a payload said about itself.
 */
export type EvidenceRecord = {
  readonly id: string;
  readonly source: EffectClaimSource;
  readonly observedAt: Date;
  /** Beyond this it is STALE whatever a policy says. */
  readonly freshnessExpiresAt: Date | null;
  readonly configuration: Readonly<Record<string, string | number>>;
  readonly quantity: number | null;
  readonly subjectRevision: string | null;
  /** What was observed. Carried through; never interpreted here. */
  readonly value: unknown;
};

/**
 * WHAT THIS PURPOSE NEEDS.
 *
 * An age and a set of sources. No entry names a thing, and a scope may replace
 * any of it — a policy is a declaration, not a constant of nature.
 */
export type EvidencePolicy = {
  /** Null means age alone never disqualifies. */
  readonly maxAgeMs: number | null;
  readonly acceptedSources: readonly EffectClaimSource[];
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Every source there is. Used where a purpose excludes nothing. */
const ANY_SOURCE: readonly EffectClaimSource[] = Object.freeze([
  "EXECUTOR_RETURN",
  "SELF_REPORTED",
  "BOUND_PROVIDER_RECEIPT",
  "INTERNAL_READBACK",
  "INDEPENDENT_READBACK",
  "OWNER_CONFIRMATION",
]);

/**
 * Sources that speak for the party who actually knows.
 *
 * `SELF_REPORTED` is deliberately absent, and this is the phase's central
 * judgement: a listing is its owner saying something once, and a consequential
 * act needs somebody to say it NOW. It is not that a declaration is worthless —
 * it is enough to search on, compare on and answer with — it is that it is not
 * enough to bind anybody.
 *
 * `EXECUTOR_RETURN` is absent everywhere: code returning without throwing is
 * evidence that code ran, and nothing else.
 */
const CONSEQUENTIAL_SOURCES: readonly EffectClaimSource[] = Object.freeze([
  "BOUND_PROVIDER_RECEIPT",
  "INTERNAL_READBACK",
  "INDEPENDENT_READBACK",
  "OWNER_CONFIRMATION",
]);

/**
 * The defaults, keyed BY PURPOSE and by nothing else.
 *
 * There is no CAR_TTL and no SHIRT_TTL here, and there must never be one: the
 * numbers say how long evidence stays good enough for a KIND OF ACT, which is
 * a property of the act. A scope that knows its own subjects move faster
 * replaces them.
 */
export const DEFAULT_EVIDENCE_POLICIES: Readonly<Record<EvidencePurpose, EvidencePolicy>> =
  Object.freeze({
    // Showing something is cheap to be wrong about, and a listing is a reason
    // to show a listing.
    DISCOVER: { maxAgeMs: 7 * DAY, acceptedSources: ANY_SOURCE },
    PRESENT: { maxAgeMs: 7 * DAY, acceptedSources: ANY_SOURCE },
    COMPARE: { maxAgeMs: 7 * DAY, acceptedSources: ANY_SOURCE },
    // Repeating what somebody said, attributed to them, is also cheap — as
    // long as the answer keeps saying who said it.
    ANSWER_INFORMATION: { maxAgeMs: 7 * DAY, acceptedSources: ANY_SOURCE },
    // Sending a proposal spends the other party's attention.
    PROPOSE: { maxAgeMs: 1 * DAY, acceptedSources: ANY_SOURCE },
    // From here on, being wrong costs somebody something real.
    RESERVE: { maxAgeMs: 30 * MINUTE, acceptedSources: CONSEQUENTIAL_SOURCES },
    COMMIT: { maxAgeMs: 15 * MINUTE, acceptedSources: CONSEQUENTIAL_SOURCES },
    EXECUTE: { maxAgeMs: 5 * MINUTE, acceptedSources: CONSEQUENTIAL_SOURCES },
  });

export const EVIDENCE_POLICY_KEY = "evidence.sufficiency";

/**
 * The policy a scope actually uses.
 *
 * A scope may declare its own in the ordinary policy store — the same one
 * every other scope rule lives in. What it may not do is widen the vocabulary:
 * an unknown source name in a declaration is dropped rather than honoured.
 */
export async function evidencePolicyFor(input: {
  scopeId: string;
  purpose: EvidencePurpose;
}): Promise<EvidencePolicy> {
  const fallback = DEFAULT_EVIDENCE_POLICIES[input.purpose];
  const [row] = await db
    .select({ value: scopePolicies.value })
    .from(scopePolicies)
    .where(
      and(
        eq(scopePolicies.scopeId, input.scopeId),
        eq(scopePolicies.policyKey, EVIDENCE_POLICY_KEY),
        eq(scopePolicies.state, "active"),
      ),
    )
    .orderBy(desc(scopePolicies.version))
    .limit(1);
  if (!row) return fallback;

  const declared = (row.value as Record<string, unknown>)[input.purpose];
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) return fallback;
  const record = declared as Record<string, unknown>;

  const maxAgeMs =
    record.maxAgeMs === null
      ? null
      : typeof record.maxAgeMs === "number" && Number.isFinite(record.maxAgeMs) && record.maxAgeMs >= 0
        ? record.maxAgeMs
        : fallback.maxAgeMs;
  const acceptedSources = Array.isArray(record.acceptedSources)
    ? record.acceptedSources.filter(
        (entry): entry is EffectClaimSource =>
          typeof entry === "string" && (ANY_SOURCE as readonly string[]).includes(entry),
      )
    : fallback.acceptedSources;

  return { maxAgeMs, acceptedSources };
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching — what a piece of evidence honestly covers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Does this evidence speak to THIS question?
 *
 * Evidence that a black shirt in L is there says nothing about a white one in
 * XL. Evidence that a hall is free on Thursday says nothing about Friday. The
 * comparison is exact, in both directions on every key the question names:
 *
 *   CONFIGURATION_MISMATCH_REUSES_EVIDENCE = 0
 */
function coversConfiguration(evidence: EvidenceRecord, fact: FactRef): boolean {
  const asked = fact.configuration ?? {};
  for (const [key, value] of Object.entries(asked)) {
    if (evidence.configuration[key] !== value) return false;
  }
  return true;
}

/**
 * One of something is not ten of something.
 *
 * Evidence with no quantity speaks to no quantity, so a question that names
 * one is not answered by it.
 *
 *   QUANTITY_OVERCLAIM = 0
 */
function coversQuantity(evidence: EvidenceRecord, fact: FactRef): boolean {
  if (fact.quantity === undefined) return true;
  if (evidence.quantity === null) return false;
  return evidence.quantity >= fact.quantity;
}

/**
 * Evidence gathered about one version of a subject does not follow it into the
 * next one. What survives a revision is a question about what changed, and the
 * safe answer without that knowledge is: it does not.
 *
 *   STALE_OFFERING_REVISION_EVIDENCE_REUSED = 0
 */
function coversRevision(evidence: EvidenceRecord, fact: FactRef): boolean {
  if (fact.subjectRevision === undefined) return true;
  if (evidence.subjectRevision === null) return false;
  return evidence.subjectRevision === String(fact.subjectRevision);
}

// ─────────────────────────────────────────────────────────────────────────────
// The decision
// ─────────────────────────────────────────────────────────────────────────────

export type SufficiencyDecision = {
  readonly verdict: SufficiencyVerdict;
  readonly reason: SufficiencyReason;
  /** The evidence relied on, when any was. Ids and provenance, not a verdict. */
  readonly evidence: EvidenceRecord | null;
  readonly purpose: EvidencePurpose;
  readonly policy: EvidencePolicy;
  /**
   * A stable name for the stronger evidence this act would need. Identical
   * questions produce an identical key, so a later phase can recognise that it
   * is already asking rather than asking again.
   *
   *   DUPLICATE_PENDING_REQUIREMENTS = 0
   */
  readonly requirementKey: string | null;
};

/** A deterministic name for one question. Sorted, so key order cannot matter. */
export function requirementKeyFor(fact: FactRef, purpose: EvidencePurpose): string {
  const configuration = Object.keys(fact.configuration ?? {})
    .sort()
    .map((key) => `${key}=${fact.configuration![key]}`)
    .join(",");
  return [
    fact.subjectKind,
    fact.subjectId,
    fact.property,
    configuration,
    fact.quantity ?? "",
    fact.subjectRevision ?? "",
    purpose,
  ].join("|");
}

/**
 * Weigh what is known against what is about to be done.
 *
 * The order matters. Evidence that does not speak to this question is not weak
 * evidence — it is not evidence, and is set aside before anything is judged
 * old or weak. Of what remains, the most recent is considered.
 */
export function decideSufficiency(input: {
  fact: FactRef;
  purpose: EvidencePurpose;
  evidence: readonly EvidenceRecord[];
  policy: EvidencePolicy;
  now: Date;
}): SufficiencyDecision {
  const { fact, purpose, policy, now } = input;
  const key = requirementKeyFor(fact, purpose);

  const applicable = input.evidence
    .filter((entry) => coversConfiguration(entry, fact))
    .filter((entry) => coversQuantity(entry, fact))
    .filter((entry) => coversRevision(entry, fact))
    .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime());

  if (applicable.length === 0) {
    // Nothing is known. That is not «no», and it is not «yes».
    //
    //   UNKNOWN_COLLAPSED_TO_FALSE = 0 · UNKNOWN_COLLAPSED_TO_TRUE = 0
    //   MISSING_FACT_FABRICATED = 0
    const anyAtAll = input.evidence.length > 0;
    return {
      verdict: "UNKNOWN",
      reason: anyAtAll ? narrowestMismatch(input.evidence, fact) : "NO_EVIDENCE",
      evidence: null,
      purpose,
      policy,
      requirementKey: key,
    };
  }

  const best = applicable[0]!;

  // The observer's own horizon comes first. Whoever recorded it said how long
  // it was good for, and a policy cannot extend somebody else's claim.
  if (best.freshnessExpiresAt && best.freshnessExpiresAt.getTime() <= now.getTime()) {
    return {
      verdict: "STRONGER_EVIDENCE_REQUIRED",
      reason: "EVIDENCE_EXPIRED",
      evidence: best,
      purpose,
      policy,
      requirementKey: key,
    };
  }

  if (!policy.acceptedSources.includes(best.source)) {
    //   A listing is its owner saying something once. For a consequential act
    //   somebody has to say it now.
    return {
      verdict: "STRONGER_EVIDENCE_REQUIRED",
      reason: "SOURCE_NOT_ACCEPTED_FOR_PURPOSE",
      evidence: best,
      purpose,
      policy,
      requirementKey: key,
    };
  }

  if (policy.maxAgeMs !== null && now.getTime() - best.observedAt.getTime() > policy.maxAgeMs) {
    //   CONFIRMED_ONCE != TRUE_FOREVER
    return {
      verdict: "STRONGER_EVIDENCE_REQUIRED",
      reason: "EVIDENCE_TOO_OLD",
      evidence: best,
      purpose,
      policy,
      requirementKey: key,
    };
  }

  return {
    verdict: "SUFFICIENT",
    reason: "WITHIN_POLICY",
    evidence: best,
    purpose,
    policy,
    // Nothing more is needed, so nothing is being asked for.
    requirementKey: null,
  };
}

/** Which narrowing left nothing applicable. Said precisely, not as «no data». */
function narrowestMismatch(
  evidence: readonly EvidenceRecord[],
  fact: FactRef,
): SufficiencyReason {
  if (evidence.some((entry) => !coversRevision(entry, fact))) return "SUBJECT_REVISED_SINCE";
  if (evidence.some((entry) => !coversConfiguration(entry, fact))) return "CONFIGURATION_MISMATCH";
  if (evidence.some((entry) => !coversQuantity(entry, fact))) return "QUANTITY_EXCEEDS_EVIDENCE";
  return "NO_EVIDENCE";
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading evidence that already exists
// ─────────────────────────────────────────────────────────────────────────────

/** The runtime's own classification of where an observation came from. */
const SOURCE_BY_PROOF_CLASS: Readonly<Record<string, EffectClaimSource>> = Object.freeze({
  self_report: "SELF_REPORTED",
  counterparty_confirm: "OWNER_CONFIRMATION",
  authenticated_webhook: "INDEPENDENT_READBACK",
  signed_proof: "INTERNAL_READBACK",
  system: "INTERNAL_READBACK",
});

/**
 * Evidence this scope may actually see.
 *
 * Scoped by owner, so an observation recorded inside somebody else's scope is
 * not evidence here however much it concerns the same subject:
 *
 *   CROSS_SCOPE_EVIDENCE_LEAK = 0
 *
 * The source is read from the row's own `sourceKind`, which the observation
 * bridge set from the CHANNEL a trusted call site named. A payload claiming to
 * be verified is just a payload:
 *
 *   MODEL_CAN_DECLARE_VERIFIED = NO · FORGED_EVIDENCE_ACCEPTED = 0
 */
export async function evidenceFor(input: {
  fact: FactRef;
  scopeId: string;
  limit?: number;
}): Promise<readonly EvidenceRecord[]> {
  const rows = await db
    .select()
    .from(observations)
    .where(
      and(
        eq(observations.ownerId, input.scopeId),
        eq(observations.subjectKind, input.fact.subjectKind),
        eq(observations.subjectId, input.fact.subjectId),
        // Only observations ABOUT this property. A photograph attached to a
        // listing is not an observation of availability.
        //
        //   MEDIA_AS_AVAILABILITY_TRUTH = 0
        eq(observations.observationType, input.fact.property),
      ),
    )
    .orderBy(desc(observations.observedAt))
    .limit(Math.min(Math.max(input.limit ?? 20, 1), 100));

  return rows.map((row) => {
    const payload = row.payload as Record<string, unknown>;
    const provenance = row.provenance as Record<string, unknown>;
    const configuration =
      payload.configuration && typeof payload.configuration === "object"
        ? (payload.configuration as Record<string, string | number>)
        : {};
    return {
      id: row.id,
      source: SOURCE_BY_PROOF_CLASS[row.sourceKind] ?? "SELF_REPORTED",
      observedAt: row.observedAt,
      freshnessExpiresAt: row.freshnessExpiresAt,
      configuration,
      quantity: typeof payload.quantity === "number" ? payload.quantity : null,
      subjectRevision:
        typeof provenance.subjectRevision === "string"
          ? provenance.subjectRevision
          : typeof provenance.subjectRevision === "number"
            ? String(provenance.subjectRevision)
            : null,
      value: payload.value,
    };
  });
}

/**
 * The whole question, answered from what is already stored.
 *
 * Reads evidence this scope may see, reads the policy this scope declared, and
 * decides. It writes nothing, sends nothing and reserves nothing:
 *
 *   FRESHNESS_CREATES_RESERVATION = 0
 *   FRESHNESS_CREATES_ACCEPTANCE_AUTHORITY = 0
 *   HUMAN_MESSAGES_SENT = 0
 */
export async function assessSufficiency(input: {
  fact: FactRef;
  purpose: EvidencePurpose;
  scopeId: string;
  now?: Date;
}): Promise<SufficiencyDecision> {
  const [evidence, policy] = await Promise.all([
    evidenceFor({ fact: input.fact, scopeId: input.scopeId }),
    evidencePolicyFor({ scopeId: input.scopeId, purpose: input.purpose }),
  ]);
  return decideSufficiency({
    fact: input.fact,
    purpose: input.purpose,
    evidence,
    policy,
    now: input.now ?? new Date(),
  });
}

/**
 * How an answer must be worded, given what it rests on.
 *
 * A declaration stays attributed to whoever declared it. Saying «it is
 * available» about something only its owner once claimed would be JASIM
 * lending its own certainty to somebody else's word.
 *
 *   DECLARATION_PRESENTED_AS_VERIFIED = 0
 */
export function attributionFor(evidence: EvidenceRecord | null): "NONE" | "ATTRIBUTED" | "VERIFIED" {
  if (!evidence) return "NONE";
  return evidence.source === "SELF_REPORTED" || evidence.source === "EXECUTOR_RETURN"
    ? "ATTRIBUTED"
    : "VERIFIED";
}
