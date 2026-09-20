/**
 * JASIM — THE DOOR INTO THE AGREEMENT RUNTIME.
 *
 * Four capabilities, for every subject there is. «فاوضه على السعر»,
 * «فاوضه على الراتب» and «فاوض على تقسيم وقت الجهاز» are the same four nodes
 * with different strings inside them.
 *
 * ─── WHY A CAPABILITY MAY NEVER AGREE ON THE OWNER'S OWN AUTHORITY ──────────
 *
 *   EXECUTION != APPROVAL
 *
 * A capability sees a scope id. It does not see the person, and it cannot tell
 * an approved run from an unapproved one — the run it executes inside was
 * approved by something it has no handle on. So `agreement-commit` can only
 * ever act on an ENVELOPE the owner signed in advance. Accepting on the owner's
 * direct authority happens on a trusted path where the person is present.
 *
 * A capability that could say "the owner approved this" would make every
 * approval gate in the runtime decorative.
 */

import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "../queries/connection";
import { economicEngagements, economicProposals } from "../../db/schema";
import {
  AgreementAuthorityError,
  AgreementInputError,
  assertNoNegotiationAuthorityClaim,
  commitAgreement,
  counterpartyProposalView,
  evaluateProposalAgainstEnvelope,
  getNegotiationEnvelope,
  proposeTermSheet,
  termSheetOf,
  type EnvelopeBounds,
} from "./agreement-runtime";
import { createEngagement, participantsForMatch } from "./economic-fabric";
import type { EffectAssertion } from "./completion-policy";

/**
 * Keys a caller may not supply at the TOP LEVEL either.
 *
 * The lesson from the opportunity capabilities: screening the nested payload
 * and not the inputs themselves let an identity claim through unnoticed. An
 * owner comes from the execution context, always.
 */
const RESERVED_INPUT_KEYS: ReadonlySet<string> = new Set([
  "ownerid",
  "owner",
  "principalid",
  "actingscopeid",
  "proposerownerid",
  "initiatorownerid",
  "acceptedbyownerid",
  "participants",
  "ownerdirect",
]);

function assertNoReservedKeys(inputs: Record<string, unknown>): void {
  for (const key of Object.keys(inputs)) {
    if (RESERVED_INPUT_KEYS.has(key.trim().toLowerCase())) {
      throw new AgreementInputError(
        `«${key}» is decided by the runtime and cannot be supplied in inputs.`,
      );
    }
  }
  assertNoNegotiationAuthorityClaim(inputs, "inputs");
}

function requiredId(inputs: Record<string, unknown>, key: string): string {
  const value = inputs[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new AgreementInputError(`«${key}» is required.`);
  }
  return value.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// agreement-open
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a negotiation from an authorized match.
 *
 * Participants are DERIVED from the match by the economic fabric and can never
 * be named by a caller: nominating a counterparty would let anyone start a
 * negotiation with a stranger who never offered anything.
 */
export async function executeAgreementOpen(
  inputs: Record<string, unknown>,
  ownerId: string,
): Promise<Record<string, unknown>> {
  assertNoReservedKeys(inputs);
  const matchId = requiredId(inputs, "matchId");

  const engagement = await createEngagement({
    matchId,
    initiatorOwnerId: ownerId,
    // Read server-side from the match. Never taken from inputs.
    participants: await participantsForMatch(matchId),
    ...(inputs.context && typeof inputs.context === "object" && !Array.isArray(inputs.context)
      ? { context: inputs.context as Record<string, unknown> }
      : {}),
  });

  return {
    mode: "OPEN",
    engagementId: engagement.id,
    participantCount: engagement.participants.length,
    state: engagement.state,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// agreement-propose
// ─────────────────────────────────────────────────────────────────────────────

export async function executeAgreementPropose(
  inputs: Record<string, unknown>,
  ownerId: string,
): Promise<Record<string, unknown>> {
  assertNoReservedKeys(inputs);
  const engagementId = requiredId(inputs, "engagementId");
  const expiresAt =
    typeof inputs.expiresAt === "string" && !Number.isNaN(Date.parse(inputs.expiresAt))
      ? new Date(inputs.expiresAt)
      : undefined;

  const proposal = await proposeTermSheet({
    engagementId,
    proposerOwnerId: ownerId,
    terms: inputs.terms,
    ...(expiresAt ? { expiresAt } : {}),
  });

  return {
    mode: "PROPOSE",
    engagementId,
    proposalId: proposal.id,
    version: proposal.version,
    status: proposal.status,
    // What the other side will see. Returned so a surface can show exactly
    // what was disclosed, rather than the row.
    disclosed: counterpartyProposalView(proposal),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// agreement-respond
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate the other side's proposal against this party's envelope, and counter
 * when — and only when — the envelope permits it.
 *
 * Three outcomes, three different truths:
 *
 *   WITHIN_RESERVE    nothing is outside. This does NOT accept.
 *   COUNTERABLE       a counter inside the declared authority was proposed.
 *   OUT_OF_AUTHORITY  the owner has to decide. Nothing was written.
 *
 * The reserve appears in none of them.
 */
export async function executeAgreementRespond(
  inputs: Record<string, unknown>,
  ownerId: string,
): Promise<Record<string, unknown>> {
  assertNoReservedKeys(inputs);
  const proposalId = requiredId(inputs, "proposalId");

  const [proposal] = await db
    .select()
    .from(economicProposals)
    .where(eq(economicProposals.id, proposalId))
    .limit(1);
  if (!proposal) throw new AgreementInputError("Proposal not found.");

  const [engagement] = await db
    .select()
    .from(economicEngagements)
    .where(eq(economicEngagements.id, proposal.engagementId))
    .limit(1);
  if (!engagement || !engagement.participants.includes(ownerId)) {
    throw new AgreementAuthorityError("Not a participant in this engagement.");
  }
  if (proposal.proposerOwnerId === ownerId) {
    throw new AgreementAuthorityError("A party does not respond to its own proposal.");
  }

  const envelope = await getNegotiationEnvelope({
    engagementId: proposal.engagementId,
    ownerId,
  });
  if (!envelope) {
    // No delegated authority is not an error and not a refusal to work — it is
    // the honest answer that this decision is the owner's.
    return {
      mode: "RESPOND",
      proposalId,
      verdict: "OUT_OF_AUTHORITY",
      reason: "No active envelope delegates authority in this engagement.",
      countered: false,
    };
  }

  const incoming = termSheetOf(proposal.terms, "incoming terms");
  const [mine] = await db
    .select()
    .from(economicProposals)
    .where(
      and(
        eq(economicProposals.engagementId, proposal.engagementId),
        eq(economicProposals.proposerOwnerId, ownerId),
      ),
    )
    .orderBy(desc(economicProposals.version))
    .limit(1);

  const evaluation = evaluateProposalAgainstEnvelope({
    incoming,
    bounds: envelope.bounds as unknown as EnvelopeBounds,
    mayConcede: envelope.mayConcede,
    ...(mine ? { mine: termSheetOf(mine.terms, "own terms") } : {}),
  });

  if (evaluation.verdict !== "COUNTERABLE") {
    return {
      mode: "RESPOND",
      proposalId,
      verdict: evaluation.verdict,
      reason: evaluation.reason,
      countered: false,
      // The per-term states, never the bounds that produced them.
      terms: evaluation.terms.map((term) => ({ key: term.key, state: term.state })),
    };
  }

  const counter = await proposeTermSheet({
    engagementId: proposal.engagementId,
    proposerOwnerId: ownerId,
    terms: evaluation.counter!,
  });
  return {
    mode: "RESPOND",
    proposalId,
    verdict: evaluation.verdict,
    reason: evaluation.reason,
    countered: true,
    counterProposalId: counter.id,
    version: counter.version,
    terms: evaluation.terms.map((term) => ({ key: term.key, state: term.state })),
    disclosed: counterpartyProposalView(counter),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// agreement-commit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agree, on the authority of an envelope and nothing else.
 *
 * `ownerDirect` is not reachable from here by construction: it is a reserved
 * input key, so a caller naming it is refused rather than obeyed.
 */
export async function executeAgreementCommit(
  inputs: Record<string, unknown>,
  ownerId: string,
): Promise<Record<string, unknown>> {
  assertNoReservedKeys(inputs);
  const proposalId = requiredId(inputs, "proposalId");

  const { agreement, commitments } = await commitAgreement({ proposalId, ownerId });
  return {
    mode: "COMMIT",
    agreementId: agreement.id,
    proposalId,
    engagementId: agreement.engagementId,
    authorityKind: (agreement.authorityBasis as { kind?: string }).kind,
    commitmentCount: commitments.length,
    // AGREEMENT != TRANSACTION. Stated in the result so a surface cannot
    // present agreeing as having paid.
    transaction: "NOT_CREATED",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Readback — the only thing that makes any of the above VERIFIED
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nothing to read back.
 *
 * `undefined` rather than a state: an assertion that said anything here would
 * be an opinion about an effect the runtime cannot identify, and the completion
 * policy's default for no assertion is already the strict one.
 */
const ABSENT = undefined;

function readback(state: "OCCURRED" | "NOT_OCCURRED", note: string): EffectAssertion {
  return {
    state,
    source: "INTERNAL_READBACK",
    authority: "agreement-runtime",
    notes: [note],
  };
}

export async function resolveOpenEffect(context: {
  ownerId: string;
  result: unknown;
}): Promise<EffectAssertion | undefined> {
  const engagementId = (context.result as { engagementId?: unknown } | undefined)?.engagementId;
  if (typeof engagementId !== "string") return ABSENT;
  const [row] = await db
    .select()
    .from(economicEngagements)
    .where(eq(economicEngagements.id, engagementId))
    .limit(1);
  if (!row) return readback("NOT_OCCURRED", "No engagement with that id exists.");
  if (!row.participants.includes(context.ownerId)) {
    return readback("NOT_OCCURRED", "The engagement does not list this owner as a participant.");
  }
  return readback("OCCURRED", `Engagement ${row.id} exists and lists this owner.`);
}

export async function resolveProposeEffect(context: {
  ownerId: string;
  result: unknown;
}): Promise<EffectAssertion | undefined> {
  const proposalId = (context.result as { proposalId?: unknown } | undefined)?.proposalId;
  if (typeof proposalId !== "string") return ABSENT;
  const [row] = await db
    .select()
    .from(economicProposals)
    .where(eq(economicProposals.id, proposalId))
    .limit(1);
  if (!row) return readback("NOT_OCCURRED", "No proposal with that id exists.");
  if (row.proposerOwnerId !== context.ownerId) {
    return readback("NOT_OCCURRED", "The proposal was not made by this owner.");
  }
  return readback("OCCURRED", `Proposal v${row.version} stands as this owner's.`);
}

/**
 * Both branches of a response are read back, because both are claims.
 *
 * Saying "I did not counter" is as much a statement about the world as saying
 * "I did": a run that quietly created a version while reporting it had not
 * would be exactly the false success the completion policy exists to catch.
 */
export async function resolveRespondEffect(context: {
  ownerId: string;
  result: unknown;
}): Promise<EffectAssertion | undefined> {
  const result = context.result as
    | { countered?: unknown; counterProposalId?: unknown; proposalId?: unknown }
    | undefined;
  if (!result || typeof result.proposalId !== "string") return ABSENT;

  if (result.countered === true) {
    if (typeof result.counterProposalId !== "string") return ABSENT;
    const [row] = await db
      .select()
      .from(economicProposals)
      .where(eq(economicProposals.id, result.counterProposalId))
      .limit(1);
    if (!row) return readback("NOT_OCCURRED", "No counter-proposal with that id exists.");
    if (row.proposerOwnerId !== context.ownerId) {
      return readback("NOT_OCCURRED", "The counter was not made by this owner.");
    }
    return readback("OCCURRED", `Counter v${row.version} stands as this owner's.`);
  }

  const [evaluated] = await db
    .select()
    .from(economicProposals)
    .where(eq(economicProposals.id, result.proposalId))
    .limit(1);
  if (!evaluated) return ABSENT;
  const newer = await db
    .select({ id: economicProposals.id })
    .from(economicProposals)
    .where(
      and(
        eq(economicProposals.engagementId, evaluated.engagementId),
        eq(economicProposals.proposerOwnerId, context.ownerId),
        gt(economicProposals.version, evaluated.version),
      ),
    );
  if (newer.length > 0) {
    return readback(
      "NOT_OCCURRED",
      "A version was created by this owner after the one it reported not countering.",
    );
  }
  return readback("OCCURRED", "No counter exists, which is what was reported.");
}

export async function resolveCommitEffect(context: {
  ownerId: string;
  result: unknown;
}): Promise<EffectAssertion | undefined> {
  const agreementId = (context.result as { agreementId?: unknown } | undefined)?.agreementId;
  if (typeof agreementId !== "string") return ABSENT;
  const { agreements } = await import("../../db/schema");
  const [row] = await db
    .select()
    .from(agreements)
    .where(eq(agreements.id, agreementId))
    .limit(1);
  if (!row) return readback("NOT_OCCURRED", "No agreement with that id exists.");
  if (!row.participants.includes(context.ownerId)) {
    return readback("NOT_OCCURRED", "The agreement does not list this owner as a party.");
  }
  return readback("OCCURRED", `Agreement ${row.id} stands, accepted by ${row.acceptedByOwnerId}.`);
}
