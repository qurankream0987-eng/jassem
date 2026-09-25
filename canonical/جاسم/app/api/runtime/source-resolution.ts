/**
 * JASIM — WHAT SOURCE SHOULD ESTABLISH THIS FACT?
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   SOURCE_RESOLUTION != TRUTH · SOURCE_RESOLUTION != AUTHORITY
 *   PROVIDER_AVAILABLE != PROVIDER_SHOULD_BE_USED
 *   HUMAN_AVAILABLE    != HUMAN_SHOULD_BE_ASKED
 *   PROVIDER_ERROR     != BUSINESS_FACT
 *   NO_PROVIDER        != NO_CAPABILITY
 *   NO_MACHINE_SOURCE  != FAILURE
 *   UNKNOWN != FALSE · UNKNOWN != TRUE
 *
 * ─── WHAT THIS IS, AND WHAT IT IS NOT ───────────────────────────────────────
 *
 * Every source already existed. Canonical evidence, a verified provider
 * binding, an authorized human counterparty — each reachable only by a caller
 * that had already decided which one it wanted. Nothing chose.
 *
 * This module chooses, and does nothing else. It establishes no fact, decides
 * no verdict, mutates no external system, and owns no state. Its entire output
 * is a decision plus the reasons for it, and every fact it returns was judged
 * by the freshness runtime exactly as it would have been without this module.
 *
 *   NO NEW TABLE. Source selection has no durable business truth: what is
 *   durable is the evidence, the request and the binding, all of which already
 *   have somewhere to live.
 *
 * ─── THE ORDER IS NOT A PRIORITY LIST ───────────────────────────────────────
 *
 * It is emphatically not «provider, then human, then local». The first
 * question is whether anything is needed at all:
 *
 *   1  Is what we already know enough for THIS purpose?   → stop. Ask nobody.
 *   2  Does this scope's policy reserve this for a person? → skip machines.
 *   3  Who is canonically authoritative for this fact?     → their systems.
 *   4  Does one of their verified bindings observe it?     → read it, record
 *                                                            it, re-judge it.
 *   5  Otherwise, may an authorized person be asked?       → ask, once.
 *   6  Otherwise say so. UNKNOWN is an answer.
 *
 * Step 1 is what keeps JASIM quiet. A sufficient answer already in hand causes
 * no call and no message:
 *
 *   SUFFICIENT_EVIDENCE_PROVIDER_CALLS = 0
 *   SUFFICIENT_EVIDENCE_HUMAN_PINGS = 0
 *
 * ─── WHOSE SYSTEM ───────────────────────────────────────────────────────────
 *
 * The decisive thing, and the one easy to get wrong. A buyer asking whether a
 * seller's thing is still available is asking about the SELLER's subject, and
 * the system that knows is the SELLER's. Looking for a provider attached to
 * whoever asked would read the wrong company's inventory.
 *
 *   BUYER_PROVIDER_USED_FOR_SELLER_FACT = 0
 *   MODEL_CAN_CHOOSE_SOURCE_SCOPE = NO
 *
 * So the candidate scopes come from `subjectAuthority` — the same canonical
 * derivation the human path already uses to decide who may be asked. One
 * derivation, two kinds of source.
 */

import {
  assessSufficiency,
  requirementKeyFor,
  type EvidencePurpose,
  type FactRef,
  type SufficiencyDecision,
} from "./evidence-sufficiency";
import { requireCounterpartyEvidence, type VerificationOutcome } from "./counterparty-verification";
import { subjectAuthority } from "./subject-authority";
import {
  readThroughBinding,
  recordProviderEvidence,
  verifiedBindingsFor,
  type ProviderCapability,
} from "./provider-binding";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { scopePolicies } from "@db/schema-block2";

// ─────────────────────────────────────────────────────────────────────────────
// What may establish a fact
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The capabilities that answer «what is the state of this known thing».
 *
 * Both are existing vocabulary and neither is new. The other verbs mean other
 * acts: SEARCH and DISCOVER find candidates rather than report on one, TRACK
 * follows something over time. A binding granted only SEARCH can look things
 * up and still cannot tell you whether this one is available.
 *
 *   DOMAIN_SOURCE_CAPABILITIES_ADDED = 0
 *
 * There is no READ_INVENTORY here and there must never be one. WHICH facts a
 * particular kind of system can establish is adapter contract metadata —
 * `ProviderDefinition.observes` — not a capability and not a branch.
 */
export const FACT_CAPABILITIES: readonly ProviderCapability[] = Object.freeze(["READ", "OBSERVE"]);

/** How the question was settled, or why it was not. */
export const SOURCE_OUTCOMES = [
  /** Already known well enough. Nobody was called and nobody was asked. */
  "SUFFICIENT_EXISTING",
  /** A verified system was read, and what it said is enough. */
  "SUFFICIENT_AFTER_PROVIDER",
  /** An authorized person was asked. The answer is not in yet. */
  "AWAITING_HUMAN",
  /** More than one system could answer and nothing canonical chooses. */
  "AMBIGUOUS_SOURCE",
  /** Nothing can establish this. Not false, not true. */
  "NO_SOURCE",
] as const;
export type SourceOutcome = (typeof SOURCE_OUTCOMES)[number];

/**
 * Why each step went the way it did.
 *
 * Enough to explain the decision out loud, and nothing more: ids, states and
 * reasons. No payload, no credential, no endpoint, and nothing persisted —
 * the durable record is the evidence and the request, which already exist.
 */
export type SourceStep =
  | { readonly step: "EXISTING_EVIDENCE"; readonly verdict: string; readonly reason: string }
  | { readonly step: "POLICY"; readonly detail: string }
  | { readonly step: "AUTHORITY"; readonly scopeIds: readonly string[] }
  | { readonly step: "PROVIDER_CANDIDATES"; readonly bindingIds: readonly string[] }
  | { readonly step: "PROVIDER_READ"; readonly bindingId: string; readonly status: string }
  | { readonly step: "PROVIDER_EVIDENCE"; readonly observationId: string }
  | { readonly step: "HUMAN"; readonly status: string };

export type SourceResolution = {
  readonly outcome: SourceOutcome;
  /** The freshness runtime's own last word. This module never overrides it. */
  readonly decision: SufficiencyDecision;
  /** Present only when a person was asked. */
  readonly verification?: VerificationOutcome;
  readonly steps: readonly SourceStep[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Policy — the same store every other scope rule lives in
// ─────────────────────────────────────────────────────────────────────────────

export const SOURCE_POLICY_KEY = "source.resolution";

/**
 * What a scope may say about how its facts are established.
 *
 * Deliberately small, and deliberately only able to make JASIM ask a PERSON
 * where it would otherwise have read a machine. A scope can reserve a purpose
 * for human confirmation however good the machine evidence would be — because
 * «a person looked at it» is sometimes the point — and a scope can name which
 * of its own systems to prefer when two could answer.
 *
 * What it cannot do is the reverse: no declaration here makes evidence
 * sufficient, widens a capability, or skips a person who is the only source.
 * Sufficiency stays the freshness runtime's, entirely.
 */
export type SourcePolicy = {
  /** Purposes that a person must confirm, machine evidence notwithstanding. */
  readonly humanRequiredFor: readonly string[];
  /** Definition ids to prefer, in order, when several could answer. */
  readonly preferredProviders: readonly string[];
};

const NO_POLICY: SourcePolicy = Object.freeze({
  humanRequiredFor: Object.freeze([]),
  preferredProviders: Object.freeze([]),
});

export async function sourcePolicyFor(scopeId: string): Promise<SourcePolicy> {
  const [row] = await db
    .select({ value: scopePolicies.value })
    .from(scopePolicies)
    .where(
      and(
        eq(scopePolicies.scopeId, scopeId),
        eq(scopePolicies.policyKey, SOURCE_POLICY_KEY),
        eq(scopePolicies.state, "active"),
      ),
    )
    .orderBy(desc(scopePolicies.version))
    .limit(1);
  if (!row) return NO_POLICY;
  const value = row.value as Record<string, unknown>;
  const strings = (input: unknown): readonly string[] =>
    Array.isArray(input) ? input.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    humanRequiredFor: strings(value.humanRequiredFor),
    preferredProviders: strings(value.preferredProviders),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapsing simultaneous reads of the same thing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Five callers wanting one answer.
 *
 * The human path is deduplicated durably — a pending question is a row, and a
 * second asker joins it. A machine read had no equivalent, and needed less of
 * one: a read changes nothing, so two of them are wasteful rather than wrong.
 *
 * So this is an in-process collapse and is labelled as exactly that. It is NOT
 * canonical coordination: two Node processes asking at the same instant will
 * both read, and that is safe because neither mutates anything and the second
 * writes an observation the first would have written. A durable in-flight row
 * would be a table, and a table for a harmless duplicate read is not a trade
 * this phase should make.
 *
 * Sequential callers never reach here at all — the first read's observation is
 * fresh, so the second is answered by step 1.
 *
 *   FRESH_PROVIDER_OBSERVATION_REQUERIED = 0
 */
const inFlight = new Map<string, Promise<SourceResolution>>();

// ─────────────────────────────────────────────────────────────────────────────
// The resolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Establish this fact, for this purpose, by whatever source is right.
 *
 * `requestingScopeId` is WHO WANTS TO KNOW. It is where evidence is read from
 * and written to, and it is never where the answering system is looked for.
 */
export async function resolveFactSource(input: {
  fact: FactRef;
  purpose: EvidencePurpose;
  requestingScopeId: string;
  now?: Date;
  /** Provider observations expire like any other. The purpose decides. */
  freshnessTtlMs?: number;
}): Promise<SourceResolution> {
  const key = `${input.requestingScopeId}|${requirementKeyFor(input.fact, input.purpose)}`;
  const running = inFlight.get(key);
  if (running) return running;
  const attempt = resolve(input).finally(() => inFlight.delete(key));
  inFlight.set(key, attempt);
  return attempt;
}

async function resolve(input: {
  fact: FactRef;
  purpose: EvidencePurpose;
  requestingScopeId: string;
  now?: Date;
  freshnessTtlMs?: number;
}): Promise<SourceResolution> {
  const now = input.now ?? new Date();
  const steps: SourceStep[] = [];

  // ── 1 · IS ANYTHING NEEDED AT ALL? ──────────────────────────────────────
  //
  // The step that keeps JASIM quiet. Everything below is the expensive branch.
  let decision = await assessSufficiency({
    fact: input.fact,
    purpose: input.purpose,
    scopeId: input.requestingScopeId,
    now,
  });
  steps.push({ step: "EXISTING_EVIDENCE", verdict: decision.verdict, reason: decision.reason });
  if (decision.verdict === "SUFFICIENT") {
    return { outcome: "SUFFICIENT_EXISTING", decision, steps };
  }

  // ── 2 · DOES THIS SCOPE RESERVE THIS FOR A PERSON? ──────────────────────
  const policy = await sourcePolicyFor(input.requestingScopeId);
  const humanOnly = policy.humanRequiredFor.includes(input.purpose);
  if (humanOnly) {
    steps.push({ step: "POLICY", detail: `${input.purpose} is reserved for a person here.` });
  }

  // ── 3 · WHOSE SYSTEM WOULD KNOW? ────────────────────────────────────────
  //
  // Canonically, from the subject. Never from who is asking, and never from
  // anything a model said.
  const authority = await subjectAuthority({
    subjectKind: input.fact.subjectKind,
    subjectId: input.fact.subjectId,
    property: input.fact.property,
  });
  steps.push({ step: "AUTHORITY", scopeIds: authority?.scopeIds ?? [] });

  // ── 4 · READ IT, IF ONE OF THEIR SYSTEMS OBSERVES THIS ──────────────────
  if (!humanOnly && authority) {
    const candidates = await candidatesFor(authority.scopeIds, input.fact.property);
    steps.push({ step: "PROVIDER_CANDIDATES", bindingIds: candidates.map((one) => one.bindingId) });

    const chosen = chooseCandidate(candidates, policy);
    if (chosen === "AMBIGUOUS") {
      // Two systems could answer and nothing canonical says which. Reading one
      // arbitrarily would make the answer depend on a row ordering.
      //
      //   MULTIPLE_PROVIDER_LATEST_WINS = 0
      return { outcome: "AMBIGUOUS_SOURCE", decision, steps };
    }

    if (chosen) {
      const outcome = await readThroughBinding({
        bindingId: chosen.bindingId,
        authoritativeScopeId: chosen.scopeId,
        capability: chosen.capability,
        parameters: {
          subjectKind: input.fact.subjectKind,
          subjectId: input.fact.subjectId,
          property: input.fact.property,
          ...(input.fact.configuration ? { configuration: input.fact.configuration } : {}),
          ...(input.fact.quantity === undefined ? {} : { quantity: input.fact.quantity }),
          ...(input.fact.subjectRevision === undefined
            ? {}
            : { subjectRevision: input.fact.subjectRevision }),
        },
        now,
      });
      steps.push({ step: "PROVIDER_READ", bindingId: chosen.bindingId, status: outcome.status });

      // A provider that could not answer has said NOTHING about the world.
      // No observation is written, and the question stays open for a person.
      //
      //   PROVIDER_FAILURE_CREATES_NEGATIVE_FACT = 0
      if (outcome.status === "OK") {
        // What it DID say becomes evidence — including «no», which is a real
        // reading and not a failure.
        //
        //   PROVIDER_RESULT_BYPASSES_OBSERVATION = 0
        const recorded = await recordProviderEvidence({
          bindingId: chosen.bindingId,
          principalId: chosen.scopeId,
          subjectKind: input.fact.subjectKind,
          subjectId: input.fact.subjectId,
          property: input.fact.property,
          value: outcome.value,
          observedAt: outcome.observedAt,
          ...(input.fact.configuration ? { configuration: input.fact.configuration } : {}),
          ...(input.fact.quantity === undefined ? {} : { quantity: input.fact.quantity }),
          ...(input.fact.subjectRevision === undefined
            ? {}
            : { subjectRevision: input.fact.subjectRevision }),
          ...(input.freshnessTtlMs === undefined ? {} : { freshnessTtlMs: input.freshnessTtlMs }),
          // Evidence for whoever asked, attributed to the system that produced
          // it. The same shape the human path writes.
          forScopeId: input.requestingScopeId,
        });
        steps.push({ step: "PROVIDER_EVIDENCE", observationId: recorded.observationId });

        // And then it is judged, by the runtime that judges everything else.
        // A provider answering is not a provider being believed.
        //
        //   PROVIDER_RESULT_BYPASSES_SUFFICIENCY = 0
        decision = await assessSufficiency({
          fact: input.fact,
          purpose: input.purpose,
          scopeId: input.requestingScopeId,
          now,
        });
        steps.push({
          step: "EXISTING_EVIDENCE",
          verdict: decision.verdict,
          reason: decision.reason,
        });
        if (decision.verdict === "SUFFICIENT") {
          // The whole point of the phase: nobody was messaged.
          //
          //   PROVIDER_SUCCESS_CAUSES_HUMAN_PING = 0
          return { outcome: "SUFFICIENT_AFTER_PROVIDER", decision, steps };
        }
        // It answered and it is STILL not enough. That is not «done».
      }
    }
  }

  // ── 5 · ASK THE PERSON WHO KNOWS ────────────────────────────────────────
  //
  // Entirely the counterparty runtime's: its authority derivation, its
  // deduplication, its notification, its expiry, its re-evaluation. This
  // module adds none of them and duplicates none of them.
  //
  //   SECOND_HUMAN_VERIFICATION_RUNTIME = 0
  const asked = await requireCounterpartyEvidence({
    fact: input.fact,
    purpose: input.purpose,
    requestingScopeId: input.requestingScopeId,
    now,
  });
  steps.push({ step: "HUMAN", status: asked.status });

  if (asked.status === "ALREADY_SUFFICIENT") {
    return { outcome: "SUFFICIENT_EXISTING", decision: asked.decision, verification: asked, steps };
  }
  if (asked.status === "REQUESTED") {
    return { outcome: "AWAITING_HUMAN", decision, verification: asked, steps };
  }
  // Nothing could establish it. Nothing is invented to fill the gap.
  //
  //   NO_SOURCE_FABRICATES_FACT = 0 · UNKNOWN != FALSE
  return { outcome: "NO_SOURCE", decision, verification: asked, steps };
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidates
// ─────────────────────────────────────────────────────────────────────────────

type Candidate = {
  readonly scopeId: string;
  readonly bindingId: string;
  readonly definitionId: string;
  readonly capability: ProviderCapability;
};

/**
 * Every verified binding, of every authoritative scope, that says it observes
 * this property and was granted a capability that can establish a fact.
 *
 * Nothing here knows what the property MEANS. It is matched as a string
 * against what each definition declares it observes, which is why an
 * unfamiliar fact needs no new branch to be answerable.
 *
 *   DOMAIN_SOURCE_HANDLERS_ADDED = 0
 */
async function candidatesFor(
  scopeIds: readonly string[],
  property: string,
): Promise<readonly Candidate[]> {
  const found: Candidate[] = [];
  for (const scopeId of scopeIds) {
    for (const capability of FACT_CAPABILITIES) {
      const bindings = await verifiedBindingsFor({ scopeId, capability, property });
      for (const one of bindings) {
        if (found.some((existing) => existing.bindingId === one.bindingId)) continue;
        found.push({
          scopeId,
          bindingId: one.bindingId,
          definitionId: one.definitionId,
          capability,
        });
      }
    }
  }
  return found;
}

/**
 * Which one, or none, or an honest admission that there is no reason to prefer
 * either.
 *
 * A scope that has two systems able to answer the same question can say which
 * it trusts, in its own policy. Absent that, this returns AMBIGUOUS rather
 * than picking — because every tiebreak available here is arbitrary. The
 * newest verification is not the better system, the first row is a database
 * ordering, and alphabetical is nothing at all.
 */
function chooseCandidate(
  candidates: readonly Candidate[],
  policy: SourcePolicy,
): Candidate | "AMBIGUOUS" | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  for (const preferred of policy.preferredProviders) {
    const match = candidates.find((one) => one.definitionId === preferred);
    if (match) return match;
  }
  return "AMBIGUOUS";
}
