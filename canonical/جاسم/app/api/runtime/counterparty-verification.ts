/**
 * WHEN NOBODY'S MACHINE KNOWS, THE PERSON WHO KNOWS MAY BE ASKED.
 *
 *   NO API != NO CAPABILITY
 *   HUMAN RESPONSE != MAGIC TRUTH
 *
 *   COUNTERPARTY_ASSERTION != SYSTEM_OBSERVATION
 *   COUNTERPARTY_ASSERTION != VERIFIED_FACT
 *   QUESTION != PROPOSAL
 *   AVAILABILITY_CONFIRMATION != RESERVATION
 *   AVAILABILITY != AUTHORITY
 *   NO_RESPONSE != YES · NO_RESPONSE != NO
 *
 * JASIM does not stop being useful because a shop has no API. It asks the
 * person who owns the fact — once, about one exact thing, and only when the
 * next act actually needs a stronger answer than what is already known.
 *
 * WHAT THIS MODULE IS NOT. It is not a messaging system: delivery goes through
 * the notification intent primitive that already exists. It is not a second
 * evidence store: an answer becomes an ordinary observation. It is not a
 * decision: whether the answer is now enough is the freshness runtime's
 * question, asked again afterwards.
 *
 *   NEW_MESSAGING_RUNTIME = 0 · SECOND_REALTIME_SYSTEM = 0
 *   COUNTERPARTY_RESPONSE_BYPASSES_SUFFICIENCY = 0
 *
 * AND IT IS NOT A BACKDOOR. «Ask him whether he accepts an inspection» is a
 * question. «Tell him I offer 8500» is a proposal, and a proposal goes through
 * the agreement runtime like every other proposal. Nothing here carries terms,
 * because nothing here has anywhere to put them.
 *
 *   VERIFICATION_CHANNEL_USED_FOR_NEGOTIATION = 0
 */

import { and, eq, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../queries/connection";
import {
  observations,
  verificationRequests,
  type VerificationAssertion,
  type VerificationRequestRow,
} from "@db/schema-block2";
import { resolveActingScope } from "./actor-scope";
import { subjectAuthority } from "./subject-authority";
import {
  assessSufficiency,
  requirementKeyFor,
  type EvidencePurpose,
  type FactRef,
  type SufficiencyDecision,
} from "./evidence-sufficiency";

export class VerificationError extends Error {
  readonly code: "INVALID" | "FORBIDDEN" | "NOT_FOUND" | "STATE" | "NO_SOURCE";
  constructor(message: string, code: VerificationError["code"]) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
  }
}

/** How long an unanswered question stays open before it is simply unanswered. */
export const DEFAULT_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Who may speak for a fact
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHERE THE AUTHORITY TO ANSWER COMES FROM.
 *
 * Not from here. `subject-authority` reads the canonical row of whatever kind
 * of thing this is and says which scopes may speak for THIS property of it —
 * across subject kinds whose ownership shapes genuinely differ.
 *
 *   MODEL_CAN_CHOOSE_AUTHORITATIVE_COUNTERPARTY = NO
 *   COUNTERPARTY_SOURCE_DERIVED_CANONICALLY = PASS
 *
 * A subject nobody canonically speaks for has nobody to ask, and that is the
 * answer rather than a fallback.
 */
export async function authorityFor(
  subjectKind: string,
  subjectId: string,
  property?: string,
): Promise<{ scopeId: string; revision: string | null } | null> {
  const authority = await subjectAuthority({
    subjectKind,
    subjectId,
    ...(property ? { property } : {}),
  });
  if (!authority) return null;
  // One question goes to one place. Where several scopes are entitled, the
  // first canonical one is asked — and every other entitled scope may still
  // answer it, because entitlement is re-checked when somebody does.
  return { scopeId: authority.scopeIds[0]!, revision: authority.revision };
}

// ─────────────────────────────────────────────────────────────────────────────
// Asking
// ─────────────────────────────────────────────────────────────────────────────

export type VerificationOutcome =
  /** Already known well enough. Nobody was asked, and nobody should be. */
  | { readonly status: "ALREADY_SUFFICIENT"; readonly decision: SufficiencyDecision }
  /** A question is open — this one, newly asked or already waiting. */
  | {
      readonly status: "REQUESTED";
      readonly request: VerificationRequestRow;
      /** False when an identical question was already waiting for an answer. */
      readonly created: boolean;
    }
  /** Nobody canonically speaks for this fact, so there is nobody to ask. */
  | { readonly status: "NO_AUTHORIZED_SOURCE" };

/**
 * Ask for stronger evidence — but only if it is actually needed.
 *
 * The order is the whole point. What is already known is weighed FIRST, so a
 * listing published minutes ago is shown without anybody's phone buzzing, and
 * a confirmation given moments ago is reused instead of asked for again.
 *
 *   FRESH_CONFIRMATION_CAUSES_NEW_PING = 0
 *   VIEW_COUNT_TRIGGERS_VERIFICATION = 0
 *
 * When a question IS needed, it is one question. The unique index on the
 * requirement key makes that true under concurrency rather than by hoping.
 */
export async function requireCounterpartyEvidence(input: {
  fact: FactRef;
  purpose: EvidencePurpose;
  requestingScopeId: string;
  now?: Date;
  ttlMs?: number;
}): Promise<VerificationOutcome> {
  const now = input.now ?? new Date();

  // FIRST: is anything even needed? Asking a person is the expensive branch.
  const decision = await assessSufficiency({
    fact: input.fact,
    purpose: input.purpose,
    scopeId: input.requestingScopeId,
    now,
  });
  if (decision.verdict === "SUFFICIENT") {
    return { status: "ALREADY_SUFFICIENT", decision };
  }

  const authority = await authorityFor(
    input.fact.subjectKind,
    input.fact.subjectId,
    input.fact.property,
  );
  if (!authority) return { status: "NO_AUTHORIZED_SOURCE" };

  const requirementKey = requirementKeyFor(input.fact, input.purpose);
  const existing = await pendingRequestFor(requirementKey, now);
  // Somebody already asked this exact question and is still waiting. Five
  // people wanting one answer is one question.
  if (existing) return { status: "REQUESTED", request: existing, created: false };

  const [created] = await db
    .insert(verificationRequests)
    .values({
      id: `vrq_${randomUUID().replace(/-/g, "").slice(0, 26)}`,
      subjectKind: input.fact.subjectKind,
      subjectId: input.fact.subjectId,
      subjectRevision:
        input.fact.subjectRevision === undefined ? null : String(input.fact.subjectRevision),
      property: input.fact.property,
      configuration: input.fact.configuration ?? {},
      quantity: input.fact.quantity ?? null,
      purpose: input.purpose,
      requestingScopeId: input.requestingScopeId,
      respondingScopeId: authority.scopeId,
      state: "PENDING",
      requirementKey,
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_REQUEST_TTL_MS)),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (!created) {
    // Lost the race to an identical question. The winner's row is the answer.
    const raced = await pendingRequestFor(requirementKey, now);
    if (!raced) throw new VerificationError("That question could not be opened.", "STATE");
    return { status: "REQUESTED", request: raced, created: false };
  }
  return { status: "REQUESTED", request: created, created: true };
}

async function pendingRequestFor(
  requirementKey: string,
  now: Date,
): Promise<VerificationRequestRow | null> {
  const [row] = await db
    .select()
    .from(verificationRequests)
    .where(
      and(
        eq(verificationRequests.requirementKey, requirementKey),
        eq(verificationRequests.state, "PENDING"),
      ),
    )
    .limit(1);
  if (!row) return null;
  // An expired question is not a waiting one.
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  return row;
}

/**
 * WHAT THE PERSON BEING ASKED IS TOLD.
 *
 * The subject, the property, the configuration and the quantity — and nothing
 * whatever about who is asking. The other party's identity, their conversation,
 * their budget and their other searches are none of this question's business.
 *
 *   UNNECESSARY_REQUESTER_DATA_DISCLOSED = 0 · CROSS_BUYER_IDENTITY_LEAK = 0
 *
 * Which matters twice over, because one question may stand for several people
 * who each asked it — and none of them learns that the others exist.
 */
export function questionContentFor(request: VerificationRequestRow): Record<string, unknown> {
  return {
    subjectKind: request.subjectKind,
    subjectId: request.subjectId,
    ...(request.subjectRevision ? { subjectRevision: request.subjectRevision } : {}),
    property: request.property,
    configuration: request.configuration,
    ...(request.quantity === null ? {} : { quantity: request.quantity }),
    requestId: request.id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Answering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the person said, from a closed set the runtime owns.
 *
 * A model may READ «نعم موجودة» and propose that it means AFFIRMED. It cannot
 * decide that it does: the trusted handler below validates which request, which
 * scope and which of these four words, and only then is anything stored.
 *
 *   MODEL_INTERPRETATION_AS_AUTHORITY = 0
 */
export const VERIFICATION_ASSERTIONS = ["AFFIRMED", "DENIED", "CHANGED", "UNKNOWN"] as const;

/**
 * Only these two say something about the fact AS ASKED.
 *
 * «It changed» is not an answer to the question that was put — it is news that
 * the question no longer fits, and letting it stand as confirmation of the old
 * configuration is exactly the silent mutation that must not happen.
 *
 *   CHANGED_TERMS_SILENTLY_ACCEPTED = 0 · CROSS_CONFIGURATION_CONFIRMATION = 0
 *
 * «I don't know» is worth recording as a reply and is evidence of nothing.
 *
 *   NO_RESPONSE_AS_AVAILABLE = 0
 */
const ASSERTIONS_ABOUT_THE_FACT: ReadonlySet<VerificationAssertion> = new Set([
  "AFFIRMED",
  "DENIED",
]);

export type AnswerOutcome = {
  readonly request: VerificationRequestRow;
  /** The evidence it became, or none when they asserted nothing about the fact. */
  readonly observationId: string | null;
  /** Asked again, now. Answering is never the same as being allowed to proceed. */
  readonly decision: SufficiencyDecision;
};

/**
 * Record what the authorized person actually said.
 *
 * AUTHORITY IS RE-CHECKED HERE, not trusted from when the question was sent.
 * Somebody may have left the organization in between:
 *
 *   AUTHORIZED_AT_REQUEST != AUTHORIZED_FOREVER
 *   REVOKED_MEMBER_CONFIRMATION_ACCEPTED = 0
 *
 * And what is stored is what THEY SAID, attributed to them. Nothing here marks
 * anything verified: a person clicking «yes» is a person saying yes.
 *
 *   COUNTERPARTY_RESPONSE_AUTO_VERIFIED = 0
 *   RESPONDER_CAN_SELF_PROMOTE_EVIDENCE = 0
 */
export async function answerVerificationRequest(input: {
  requestId: string;
  respondingPrincipalId: string;
  organizationId?: string;
  assertion: VerificationAssertion;
  now?: Date;
}): Promise<AnswerOutcome> {
  const now = input.now ?? new Date();
  if (!(VERIFICATION_ASSERTIONS as readonly string[]).includes(input.assertion)) {
    throw new VerificationError("That is not an answer this runtime accepts.", "INVALID");
  }

  const [request] = await db
    .select()
    .from(verificationRequests)
    .where(eq(verificationRequests.id, input.requestId))
    .limit(1);
  if (!request) throw new VerificationError("No such question.", "NOT_FOUND");
  if (request.state !== "PENDING") {
    throw new VerificationError(`That question is ${request.state}.`, "STATE");
  }
  if (request.expiresAt.getTime() <= now.getTime()) {
    await db
      .update(verificationRequests)
      .set({ state: "EXPIRED", updatedAt: now })
      .where(eq(verificationRequests.id, request.id));
    throw new VerificationError("That question expired unanswered.", "STATE");
  }

  // The scope this person may act as RIGHT NOW. Membership decides, and it
  // decides again every time.
  const resolution = await resolveActingScope({
    principalId: input.respondingPrincipalId,
    ...(input.organizationId
      ? { request: { intent: "ORGANIZATION" as const, organizationId: input.organizationId } }
      : {}),
  });
  if (resolution.status !== "RESOLVED") {
    throw new VerificationError("You are not who may answer this.", "FORBIDDEN");
  }
  // ENTITLEMENT IS RE-READ FROM THE SUBJECT, not taken from the row written
  // when the question was sent. Somebody may have lost standing in between, and
  // somebody else entitled all along may be the one who actually answers.
  //
  //   AUTHORIZED_AT_REQUEST != AUTHORIZED_FOREVER
  const entitled = await subjectAuthority({
    subjectKind: request.subjectKind,
    subjectId: request.subjectId,
    property: request.property,
  });
  if (!entitled || !entitled.scopeIds.includes(resolution.scope.scopeId)) {
    // The same refusal for a stranger and for somebody whose standing was taken
    // away, so neither learns anything from being told no.
    throw new VerificationError("You are not who may answer this.", "FORBIDDEN");
  }

  let observationId: string | null = null;
  if (ASSERTIONS_ABOUT_THE_FACT.has(input.assertion)) {
    observationId = `obs_${randomUUID().replace(/-/g, "").slice(0, 26)}`;
    await db.insert(observations).values({
      id: observationId,
      // Recorded in the ASKING scope, because that is who needed to know. The
      // answer does not become a public fact about somebody's stock.
      ownerId: request.requestingScopeId,
      subjectKind: request.subjectKind,
      subjectId: request.subjectId,
      observationType: request.property,
      observedAt: now,
      // THE RUNTIME classifies the source, from the fact that an authorized
      // counterparty answered a trusted question. No payload chooses this.
      sourceKind: "counterparty_confirm",
      provenance: {
        ...(request.subjectRevision ? { subjectRevision: request.subjectRevision } : {}),
        requestId: request.id,
        answeredByPrincipalId: input.respondingPrincipalId,
        respondingScopeId: request.respondingScopeId,
      },
      payload: {
        // What they asserted — not a verdict about it.
        value: input.assertion,
        configuration: request.configuration,
        ...(request.quantity === null ? {} : { quantity: request.quantity }),
      },
    });
  }

  const [updated] = await db
    .update(verificationRequests)
    .set({
      state: "ANSWERED",
      assertion: input.assertion,
      observationId,
      answeredByPrincipalId: input.respondingPrincipalId,
      answeredAt: now,
      updatedAt: now,
    })
    .where(
      and(eq(verificationRequests.id, request.id), eq(verificationRequests.state, "PENDING")),
    )
    .returning();
  if (!updated) throw new VerificationError("That question was already answered.", "STATE");

  // ASKED AGAIN, NOW. An answer is not permission to proceed — whether what is
  // known is now enough is the freshness runtime's question, and it is put to
  // it rather than assumed.
  const decision = await assessSufficiency({
    fact: {
      subjectKind: updated.subjectKind,
      subjectId: updated.subjectId,
      property: updated.property,
      configuration: updated.configuration,
      ...(updated.quantity === null ? {} : { quantity: updated.quantity }),
      ...(updated.subjectRevision ? { subjectRevision: updated.subjectRevision } : {}),
    },
    purpose: updated.purpose as EvidencePurpose,
    scopeId: updated.requestingScopeId,
    now,
  });

  return { request: updated, observationId, decision };
}

/** Questions nobody answered in time. Silence becomes EXPIRED, never an answer. */
export async function expireDueRequests(now: Date = new Date()): Promise<number> {
  const rows = await db
    .update(verificationRequests)
    .set({ state: "EXPIRED", updatedAt: now })
    .where(
      and(
        eq(verificationRequests.state, "PENDING"),
        lte(verificationRequests.expiresAt, now),
      ),
    )
    .returning({ id: verificationRequests.id });
  return rows.length;
}

/**
 * What to say to the person who asked, while nobody has answered.
 *
 *   NO_RESPONSE_AS_AVAILABLE = 0 · NO_RESPONSE_AS_UNAVAILABLE = 0
 *   NO_RESPONSE_AS_REJECTION = 0
 */
export function pendingAnswerFor(request: VerificationRequestRow): {
  state: string;
  message: string;
} {
  if (request.state === "PENDING") {
    return { state: "AWAITING_CONFIRMATION", message: "ما زلت بانتظار تأكيد الطرف الآخر." };
  }
  if (request.state === "EXPIRED") {
    return { state: "UNKNOWN", message: "لم يصل رد، فما زلت لا أعرف." };
  }
  if (request.assertion === "UNKNOWN") {
    return { state: "UNKNOWN", message: "ردّ الطرف الآخر بأنه لا يعرف." };
  }
  if (request.assertion === "CHANGED") {
    return {
      state: "CHANGED",
      message: "أفاد الطرف الآخر بأن المعطيات تغيّرت عمّا سألت عنه.",
    };
  }
  return { state: "ANSWERED", message: "وصل رد الطرف الآخر." };
}
