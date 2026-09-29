/**
 * JASIM — ENDING AN AGREEMENT IS AN ACT THE TWO PARTIES TAKE.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * `agreements` was APPEND-ONLY. One insert, in `commitAgreement`; `status` set
 * to `agreed` at birth and never written again ANYWHERE in the runtime. Traced
 * across every module: one `insert(agreements)`, zero `update(agreements)`.
 *
 *     AN AGREEMENT COULD NOT END
 *
 * Two phases named this without closing it. The note on the `agreement-commit`
 * capability said it in as many words —
 *
 *   «An agreement is a fact between two parties. Releasing one is a separate
 *    act they both take, not a deletion.»
 *
 * — and the previous phase's purpose verdict stopped exactly here: «this part
 * is intact, the decision is yours, and here is who is on the other side»,
 * with nothing the person could then do.
 *
 * `cancelTransaction` is not this act. It is one actor and a reason, and it
 * refuses once anything is verified. That refusal is correct and it leaves the
 * only case that matters unanswered: an agreement that is INTACT, partly
 * performed, and now pointless.
 *
 * ─── SO IT IS SHAPED LIKE THE AGREEMENT IT ENDS ─────────────────────────────
 *
 * A proposal and a response. One party offers, the other accepts, and neither
 * can do both sides — the same rule that already governs `commitAgreement`
 * («a party cannot agree to its own proposal»), because it is the same
 * question asked in the other direction.
 *
 *   RELEASING_IS_NOT_UNDOING
 *     A release ends what is still OWED. It does not reach into what happened.
 *
 *   WHAT_WAS_VERIFIED_STAYS_VERIFIED
 *     An obligation somebody performed is a fact, and naming it for discharge
 *     is refused rather than obeyed. What is owed for a performed obligation
 *     may be discharged — the obligation itself may not be unperformed. That
 *     is compensation's question, and compensation answers it.
 *
 *   AN_ENVELOPE_AGREES_IT_DOES_NOT_UNDO
 *     An envelope delegates authority to reach agreements within bounds.
 *     Nothing in those bounds is authority to end one, so both sides of a
 *     release require the person. There is no envelope path here at all.
 *
 *   AMBIGUOUS_YES_TAKES_THE_CHEAPEST_MEANING = 0
 *     «نتفارق» can mean «nobody owes anybody» or «stop the future work and pay
 *     me for what is done». Those are materially different agreements to
 *     reach, so the proposal NAMES the obligations it discharges and the
 *     acceptance is acceptance of exactly that list. An obligation nobody
 *     named survives untouched, and the result says so rather than implying it.
 *
 *   A_RELEASE_IS_NOT_A_JUDGEMENT
 *     Nothing here decides whose fault anything was, and no column records it.
 *     Two parties ending something is not a finding about either of them.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  agreementReleases,
  agreements,
  commitments,
  type AgreementRelease,
  type Commitment,
} from "@db/schema";

export class ReleaseInputError extends Error {
  override name = "ReleaseInputError";
}

export class ReleaseAuthorityError extends Error {
  override name = "ReleaseAuthorityError";
}

export const RELEASE_STATES = ["PROPOSED", "ACCEPTED", "DECLINED", "WITHDRAWN"] as const;
export type ReleaseState = (typeof RELEASE_STATES)[number];

/** What an agreement's status becomes once both parties ended it. */
export const RELEASED_AGREEMENT_STATUS = "released";
/** What a discharged obligation's state becomes. Never `met`: nobody did it. */
export const RELEASED_OBLIGATION_STATE = "RELEASED";

/**
 * Words a caller may never assert. A model, a client or a provider that could
 * say «released» would make both parties' consent decorative.
 */
export const RELEASE_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "state",
  "released",
  "accepted",
  "respondedbyownerid",
  "respondedbyprincipalid",
  "respondedat",
  "proposedbyownerid",
  "proposedbyprincipalid",
]);

export function assertNoReleaseAuthorityClaim(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (RELEASE_AUTHORITY_KEYS.has(key.trim().toLowerCase())) {
      throw new ReleaseAuthorityError(`«${key}» is not something a caller may assert.`);
    }
  }
}

async function requireParty(agreementId: string, ownerId: string) {
  const [agreement] = await db
    .select()
    .from(agreements)
    .where(eq(agreements.id, agreementId))
    .limit(1);
  if (!agreement) throw new ReleaseInputError("Agreement not found.");
  if (!agreement.participants.includes(ownerId)) {
    throw new ReleaseAuthorityError("Not a party to this agreement.");
  }
  return agreement;
}

export type ProposedRelease = {
  readonly release: AgreementRelease;
  /** The obligations this offer would end, as they stand right now. */
  readonly discharging: readonly Commitment[];
  /** The obligations it leaves alone. Named, so «the rest» is never a guess. */
  readonly untouched: readonly Commitment[];
};

/**
 * Offer to end an agreement.
 *
 * Nothing changes state here: an offer is an offer. The agreement stands, every
 * obligation stands, and the other party has been asked a question.
 */
export async function proposeRelease(input: {
  agreementId: string;
  ownerId: string;
  /** The person offering. Required: an envelope cannot reach this function. */
  principalId: string;
  reason: string;
  /** Which open obligations this would end. An empty list ends none of them. */
  discharges?: readonly string[];
}): Promise<ProposedRelease> {
  const agreement = await requireParty(input.agreementId, input.ownerId);
  if (agreement.status === RELEASED_AGREEMENT_STATUS) {
    throw new ReleaseAuthorityError("This agreement has already been released.");
  }
  const principalId = input.principalId?.trim();
  if (!principalId) {
    //   AN_ENVELOPE_AGREES_IT_DOES_NOT_UNDO
    throw new ReleaseAuthorityError("Ending an agreement needs the person who is ending it.");
  }
  const reason = input.reason?.trim();
  if (!reason) {
    // Whoever is asked to accept this is entitled to know what they are
    // accepting, and a blank reason is not a reason.
    throw new ReleaseInputError("A release must say why.");
  }

  const existing = await db
    .select()
    .from(agreementReleases)
    .where(
      and(
        eq(agreementReleases.agreementId, agreement.id),
        eq(agreementReleases.state, "PROPOSED"),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    throw new ReleaseAuthorityError("An offer to end this agreement is already open.");
  }

  const obligations = await db
    .select()
    .from(commitments)
    .where(eq(commitments.agreementId, agreement.id));

  const named = [...new Set(input.discharges ?? [])];
  const byId = new Map(obligations.map((row) => [row.id, row]));
  for (const id of named) {
    const obligation = byId.get(id);
    if (!obligation) {
      throw new ReleaseInputError(`Obligation ${id} does not belong to this agreement.`);
    }
    if (obligation.verification === "VERIFIED") {
      //   WHAT_WAS_VERIFIED_STAYS_VERIFIED
      throw new ReleaseInputError(
        `Obligation ${id} was performed. A release does not unperform it; compensation is the question for that.`,
      );
    }
    if (obligation.state === RELEASED_OBLIGATION_STATE) {
      throw new ReleaseInputError(`Obligation ${id} was already released.`);
    }
  }

  const [release] = await db
    .insert(agreementReleases)
    .values({
      id: `rel_${randomUUID()}`,
      agreementId: agreement.id,
      proposedByOwnerId: input.ownerId,
      proposedByPrincipalId: principalId,
      reason,
      discharges: named,
    })
    .returning();

  return {
    release: release!,
    discharging: obligations.filter((row) => named.includes(row.id)),
    untouched: obligations.filter((row) => !named.includes(row.id)),
  };
}

export type ReleaseOutcome = {
  readonly release: AgreementRelease;
  /** The agreement's status now. `agreed` still, when the offer was declined. */
  readonly agreementStatus: string;
  readonly discharged: readonly Commitment[];
  /** Still owed, by whoever owed them, exactly as before. */
  readonly stillOwed: readonly Commitment[];
};

/**
 * The other party answers.
 *
 * Accepting is the only thing in this module that writes anything, and it
 * writes exactly what was offered: the agreement ends and the NAMED
 * obligations end with it. Nothing else moves.
 */
export async function respondToRelease(input: {
  releaseId: string;
  ownerId: string;
  principalId: string;
  decision: "accept" | "decline";
  now?: Date;
}): Promise<ReleaseOutcome> {
  const [release] = await db
    .select()
    .from(agreementReleases)
    .where(eq(agreementReleases.id, input.releaseId))
    .limit(1);
  if (!release) throw new ReleaseInputError("Release not found.");
  if (release.state !== "PROPOSED") {
    throw new ReleaseAuthorityError(`This offer is ${release.state}, not open.`);
  }
  const agreement = await requireParty(release.agreementId, input.ownerId);
  if (release.proposedByOwnerId === input.ownerId) {
    // The same rule `commitAgreement` already enforces, asked in the other
    // direction: a party cannot accept its own offer.
    throw new ReleaseAuthorityError("A party cannot accept its own offer to end an agreement.");
  }
  const principalId = input.principalId?.trim();
  if (!principalId) {
    throw new ReleaseAuthorityError("Ending an agreement needs the person who is accepting it.");
  }
  const now = input.now ?? new Date();

  if (input.decision === "decline") {
    const [declined] = await db
      .update(agreementReleases)
      .set({
        state: "DECLINED",
        respondedByOwnerId: input.ownerId,
        respondedByPrincipalId: principalId,
        respondedAt: now,
      })
      .where(
        and(eq(agreementReleases.id, release.id), eq(agreementReleases.state, "PROPOSED")),
      )
      .returning();
    const obligations = await db
      .select()
      .from(commitments)
      .where(eq(commitments.agreementId, agreement.id));
    return {
      release: declined ?? release,
      // Nothing happened. The agreement is exactly what it was.
      agreementStatus: agreement.status,
      discharged: [],
      stillOwed: obligations,
    };
  }

  const named = release.discharges ?? [];
  const outcome = await db.transaction(async (tx) => {
    const [accepted] = await tx
      .update(agreementReleases)
      .set({
        state: "ACCEPTED",
        respondedByOwnerId: input.ownerId,
        respondedByPrincipalId: principalId,
        respondedAt: now,
      })
      // The state guard is the idempotency: a second acceptance updates
      // nothing and therefore discharges nothing.
      .where(
        and(eq(agreementReleases.id, release.id), eq(agreementReleases.state, "PROPOSED")),
      )
      .returning();
    if (!accepted) throw new ReleaseAuthorityError("This offer is no longer open.");

    await tx
      .update(agreements)
      .set({ status: RELEASED_AGREEMENT_STATUS })
      .where(eq(agreements.id, agreement.id));

    if (named.length > 0) {
      await tx
        .update(commitments)
        .set({ state: RELEASED_OBLIGATION_STATE, updatedAt: now })
        .where(
          and(
            eq(commitments.agreementId, agreement.id),
            inArray(commitments.id, named),
          ),
        );
    }
    return accepted;
  });

  const obligations = await db
    .select()
    .from(commitments)
    .where(eq(commitments.agreementId, agreement.id));
  return {
    release: outcome,
    agreementStatus: RELEASED_AGREEMENT_STATUS,
    discharged: obligations.filter((row) => named.includes(row.id)),
    //   An obligation nobody named survives the release. Said, not implied.
    stillOwed: obligations.filter((row) => !named.includes(row.id)),
  };
}

/** Withdraw your own offer, while it is still open. */
export async function withdrawRelease(input: {
  releaseId: string;
  ownerId: string;
}): Promise<AgreementRelease> {
  const [release] = await db
    .select()
    .from(agreementReleases)
    .where(eq(agreementReleases.id, input.releaseId))
    .limit(1);
  if (!release) throw new ReleaseInputError("Release not found.");
  if (release.proposedByOwnerId !== input.ownerId) {
    throw new ReleaseAuthorityError("Only the party who offered it may withdraw it.");
  }
  if (release.state !== "PROPOSED") {
    throw new ReleaseAuthorityError(`This offer is ${release.state}, not open.`);
  }
  const [withdrawn] = await db
    .update(agreementReleases)
    .set({ state: "WITHDRAWN" })
    .where(and(eq(agreementReleases.id, release.id), eq(agreementReleases.state, "PROPOSED")))
    .returning();
  return withdrawn ?? release;
}

/** Every offer ever made on this agreement, newest first. Append-only history. */
export async function releasesForAgreement(input: {
  agreementId: string;
  ownerId: string;
}): Promise<readonly AgreementRelease[]> {
  await requireParty(input.agreementId, input.ownerId);
  return db
    .select()
    .from(agreementReleases)
    .where(eq(agreementReleases.agreementId, input.agreementId))
    .orderBy(desc(agreementReleases.createdAt));
}
