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
 * What a scope may say, in ONE policy key read from TWO different scopes.
 *
 * ─── THE TWO FIELDS ARE NOT THE SAME KIND OF THING ──────────────────────────
 *
 *   WHO WANTS TO KNOW != WHO OWNS THE SOURCE
 *   REQUESTER_POLICY  != SOURCE_OWNER_POLICY
 *
 * `humanRequiredFor` is a REQUESTER's trust requirement. «Whatever a machine
 * says, I want a person to confirm this before I commit» is a statement about
 * what evidence that scope is willing to rely on, and it is theirs to make.
 * It is read from the scope that ASKED.
 *
 * `preferredProviders` is a SOURCE OWNER's statement about its own systems.
 * «When something reads our stock, read the second one» is a fact about whose
 * machines those are, and it belongs to whoever owns them. It is read from
 * each AUTHORITATIVE scope, and the asker's copy of it is never consulted for
 * somebody else's systems.
 *
 *   REQUESTER_SELECTS_FOREIGN_PROVIDER = 0
 *
 * When a scope asks about its own subject the two coincide, and nothing
 * special happens — it is the authoritative scope, so its ranking applies
 * because it owns the systems, not because it asked.
 *
 * ─── AND NEITHER MAY WIDEN ANYTHING ─────────────────────────────────────────
 *
 * No declaration here makes evidence sufficient, revives an unverified
 * binding, grants a capability, extends what a system observes, or names who
 * the human authority is. A preference RANKS what is already eligible.
 * Sufficiency stays the freshness runtime's and authority stays the subject's.
 */
export type SourcePolicy = {
  /** REQUESTER: purposes a person must confirm, machine evidence or not. */
  readonly humanRequiredFor: readonly string[];
  /** SOURCE OWNER: which of ITS OWN systems to prefer, in order. */
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

  // ── 2 · DOES THE ASKER RESERVE THIS FOR A PERSON? ───────────────────────
  //
  // The requester's own policy, and the ONLY field of it this resolution
  // reads. What they may decide is how much confidence they need; which of
  // somebody else's machines answers is not theirs to decide.
  const requesterPolicy = await sourcePolicyFor(input.requestingScopeId);
  const humanOnly = requesterPolicy.humanRequiredFor.includes(input.purpose);
  if (humanOnly) {
    steps.push({
      step: "POLICY",
      detail: `The asking scope reserves ${input.purpose} for a person.`,
    });
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
    const chosen = await chooseSource(authority.scopeIds, input.fact.property, steps);
    if (chosen === "AMBIGUOUS") {
      // Either one authoritative scope has two systems it never ranked, or two
      // authoritative scopes each have one and nothing says which side owns
      // this truth. Reading one anyway would make the answer depend on a row
      // ordering — or worse, on what the asker wanted.
      //
      //   MULTIPLE_PROVIDER_LATEST_WINS = 0
      //   MULTI_AUTHORITY_ARBITRARY_WINNER = 0
      //   REQUESTER_POLICY_SELECTS_AUTHORITY_SIDE = 0
      return { outcome: "AMBIGUOUS_SOURCE", decision, steps };
    }

    if (chosen) {
      const outcome = await readThroughBinding({
        bindingId: chosen.bindingId,
        // The fact, not a scope. The read derives authority for itself, so
        // this module cannot assert one even by mistake.
        fact: {
          subjectKind: input.fact.subjectKind,
          subjectId: input.fact.subjectId,
          property: input.fact.property,
        },
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
 * One authoritative scope's own eligible systems.
 *
 * Eligible means: this scope's, VERIFIED, granted a capability that can
 * establish a fact, and declared to observe this property. A preference ranks
 * what this returns; it can never add to it.
 *
 *   POLICY_REVIVES_UNVERIFIED_BINDING = 0
 *   POLICY_GRANTS_MISSING_CAPABILITY = 0
 *   POLICY_EXPANDS_OBSERVED_PROPERTIES = 0
 *
 * Nothing here knows what the property MEANS. It is matched as a string
 * against what each definition declares it observes, which is why an
 * unfamiliar fact needs no new branch to be answerable.
 *
 *   DOMAIN_SOURCE_HANDLERS_ADDED = 0
 */
async function eligibleWithin(scopeId: string, property: string): Promise<readonly Candidate[]> {
  const found: Candidate[] = [];
  for (const capability of FACT_CAPABILITIES) {
    const bindings = await verifiedBindingsFor({ scopeId, capability, property });
    for (const one of bindings) {
      if (found.some((existing) => existing.bindingId === one.bindingId)) continue;
      found.push({ scopeId, bindingId: one.bindingId, definitionId: one.definitionId, capability });
    }
  }
  return found;
}

/**
 * WHICH SYSTEM, AND WHOSE SAY IT IS.
 *
 * Two rounds, and the order of them is the whole correction.
 *
 * FIRST, within each authoritative scope, using THAT SCOPE'S OWN policy. A
 * business with two systems able to answer the same question is the only party
 * who can say which it trusts, and it says so in its own policy row. The scope
 * that asked has no vote here even when it has an opinion on file.
 *
 * SECOND, across scopes, using nothing at all. If two authoritative scopes each
 * end up with a system, the question is no longer «which machine» but «which
 * side owns this truth», and that is a canonical question the property either
 * answered already or did not. Breaking it here — by order, by recency, or by
 * what the asker preferred — would be inventing an authority.
 *
 * An internally unranked scope is ambiguous too. A business that never chose
 * between its own two systems has not chosen, and guessing on its behalf is
 * the same mistake in miniature.
 */
async function chooseSource(
  scopeIds: readonly string[],
  property: string,
  steps: SourceStep[],
): Promise<Candidate | "AMBIGUOUS" | null> {
  const perScope: Candidate[] = [];
  const seen: string[] = [];
  let ambiguousWithin = false;

  for (const scopeId of scopeIds) {
    const eligible = await eligibleWithin(scopeId, property);
    seen.push(...eligible.map((one) => one.bindingId));
    if (eligible.length === 0) continue;
    if (eligible.length === 1) {
      perScope.push(eligible[0]!);
      continue;
    }
    // Its systems, its ranking. Read from the scope that OWNS them.
    const owner = await sourcePolicyFor(scopeId);
    const preferred = owner.preferredProviders
      .map((definitionId) => eligible.find((one) => one.definitionId === definitionId))
      .find((match): match is Candidate => match !== undefined);
    if (preferred) perScope.push(preferred);
    else ambiguousWithin = true;
  }

  steps.push({ step: "PROVIDER_CANDIDATES", bindingIds: seen });
  if (ambiguousWithin) return "AMBIGUOUS";
  if (perScope.length === 0) return null;
  if (perScope.length === 1) return perScope[0]!;
  return "AMBIGUOUS";
}
