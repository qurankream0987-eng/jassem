/**
 * LIVING OBJECT RUNTIME
 *
 * A living object is a DURABLE, AUTHORIZED HANDLE on a subject a scope is
 * following. It is not the subject, and it is not a second place where the
 * subject's truth lives.
 *
 *   LIVING_OBJECT != CANONICAL_SUBJECT
 *   LIVING_OBJECT != WORLD · != RUN · != MONITOR_EXECUTION
 *   DUPLICATE_OPERATIONAL_TRUTH = 0
 *
 * Before this module, JASIM had a living-objects RAIL: a read-only derivation
 * recomputed on every query over four of its own execution artifacts (task,
 * run, generated system, bubble). That rail is preserved — its shape, its
 * grouping, its attention ordering — and four things it could not do are added
 * here:
 *
 *   1. SUBJECT BREADTH. An agreement, a commitment, a transaction and a
 *      standing monitor are things a person follows. None of them could be a
 *      living object, because the reference vocabulary was closed over
 *      execution artifacts. «أين وصل طلبي؟» is a question about an obligation,
 *      and the rail could only point at a run.
 *   2. A DURABLE HANDLE. Nothing recorded THAT a scope follows a subject, so
 *      hiding, resolving and releasing had nowhere to live and
 *      SURFACE_EXIT != LIVING_OBJECT_DELETE was not expressible.
 *   3. ACTING SCOPE. The rail was owner-id scoped while every closed runtime
 *      beside it resolves an acting scope.
 *   4. RECONCILIATION. A follower had no cursor, so nothing could say what had
 *      changed since they last looked.
 *
 * WHAT IS STORED, AND WHAT IS NOT. The handle stores follower state only: who
 * follows what, since when, why, whether the surface still shows it, and how
 * far that follower has been reconciled. Status, title, progress and payload
 * are read from the canonical row on every projection, so a handle can never
 * drift from, contradict, or outlive the truth of the thing it points at.
 *
 * NO DOMAIN BRANCH. There is no `if (noun === "order")` here and there must
 * never be one. A delivery, a job application, a booking and a gold-price watch
 * are the same four primitives — an obligation, an execution, a standing
 * condition, a persistent surface — and they differ in the terms somebody
 * declared and in nothing else.
 *
 *   DOMAIN_LIVING_OBJECT_TYPES_ADDED = 0
 */

import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  agreements,
  commitments,
  negotiationEnvelopes,
  reservations,
  livingObjects,
  standingMonitors,
  transactions,
  type LivingObjectFollowState,
  type LivingObjectRow,
  type LivingObjectSurfaceState,
} from "@db/schema-block2";
import {
  bubbles,
  economicEngagements,
  events,
  generatedSystems,
  runs,
  runtimeTasks,
} from "@db/schema";
import { resolveActingScope } from "./actor-scope";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The canonical subjects a living object may point at.
 *
 * Every entry is one of JASIM's own primitives. None is a domain noun: there is
 * no `order`, no `delivery`, no `booking`, no `application` and no `driver`
 * here, because those are not kinds of thing — they are terms inside an
 * obligation.
 */
export const LIVING_OBJECT_SUBJECT_KINDS = [
  "run",
  "task",
  "world",
  "bubble",
  "agreement",
  "commitment",
  "transaction",
  "monitor",
  "reservation",
  "engagement",
  "negotiation",
] as const;
export type LivingObjectSubjectKind = (typeof LIVING_OBJECT_SUBJECT_KINDS)[number];

/**
 * WHY a handle exists, from a closed structural vocabulary. Each names a shape
 * of commitment the runtime made, never a topic somebody talked about.
 */
export const LIVING_OBJECT_REASONS = [
  "DURABLE_EXECUTION_STARTED",
  "OBLIGATION_CREATED",
  "STANDING_CONDITION_CREATED",
  "PERSISTENT_SURFACE_CREATED",
  "EXPLICIT_FOLLOW",
] as const;
export type LivingObjectReason = (typeof LIVING_OBJECT_REASONS)[number];

/** Why a turn produced NO living object. A refusal is explainable too. */
export const LIVING_OBJECT_DECLINES = [
  "NO_DURABLE_SUBJECT",
  "EPHEMERAL_RESULT",
  "READ_ONLY_TURN",
  "NOT_AUTHORIZED",
  "SUBJECT_ALREADY_TERMINAL",
] as const;
export type LivingObjectDecline = (typeof LIVING_OBJECT_DECLINES)[number];

export const LIVING_OBJECT_FOLLOW_STATES = ["FOLLOWING", "RESOLVED", "RELEASED"] as const;
export const LIVING_OBJECT_SURFACE_STATES = ["VISIBLE", "HIDDEN"] as const;

/**
 * The presentation vocabulary a projected handle reports. It is the SAME closed
 * set the existing rail already speaks, so one surface renders both.
 */
export const LIVING_OBJECT_STATUSES = [
  "ACTIVE",
  "WAITING",
  "RUNNING",
  "MONITORING",
  "WAITING_USER",
  "WAITING_APPROVAL",
  "VERIFYING",
  "BLOCKED",
  "FAILED",
  "COMPLETED",
  "CANCELLED",
  "UNKNOWN",
] as const;
export type LivingObjectRuntimeStatus = (typeof LIVING_OBJECT_STATUSES)[number];

/**
 * A subject whose own life has ended. A terminal subject may still be READ —
 * RESOLVED != ERASED — but it never materializes a new handle, because
 * following something that already finished is not following.
 */
const TERMINAL_STATUSES: ReadonlySet<LivingObjectRuntimeStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export class LivingObjectError extends Error {
  readonly code: "INVALID" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "STATE";
  constructor(message: string, code: LivingObjectError["code"]) {
    super(message);
    this.name = "LivingObjectError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subject snapshots — the ONE place a subject's truth is read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a canonical subject says about itself right now.
 *
 * `authorizedScopes` is the subject's OWN answer to who may see it. A handle
 * never grants visibility; it only records that somebody who was already
 * allowed to look is following. Authorization is therefore re-asked on every
 * read, and a revoked membership stops a projection the moment it is revoked.
 */
export type SubjectSnapshot = {
  readonly exists: boolean;
  readonly authorizedScopes: readonly string[];
  readonly status: LivingObjectRuntimeStatus;
  readonly title: string;
  readonly updatedAt: Date;
  /** The subject's own revision. Opaque; compared, never parsed. */
  readonly revision: string;
};

const ABSENT: SubjectSnapshot = Object.freeze({
  exists: false,
  authorizedScopes: Object.freeze([]) as readonly string[],
  status: "UNKNOWN" as const,
  title: "",
  updatedAt: new Date(0),
  revision: "",
});

function text(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

/**
 * ONE normalization, shared by every subject kind.
 *
 * A vocabulary is a vocabulary whichever table it came from, so the mapping is
 * written once over the words the canonical tables actually use, and not once
 * per subject. An unrecognized word becomes UNKNOWN and never a guess:
 *
 *   UNKNOWN != FALSE · UNKNOWN != ABSENT
 */
function normalizeStatus(raw: string): LivingObjectRuntimeStatus {
  switch (raw.toLowerCase()) {
    case "awaiting_input":
    case "waiting_input":
      return "WAITING_USER";
    case "awaiting_approval":
    case "waiting_approval":
    case "proposed":
    case "offered":
      return "WAITING_APPROVAL";
    case "blocked":
      return "BLOCKED";
    case "failed":
    case "declined":
    case "expired":
      return "FAILED";
    case "completed":
    case "complete":
    case "fulfilled":
    case "settled":
    case "closed":
      return "COMPLETED";
    case "cancelled":
    case "canceled":
    case "released":
    case "revoked":
      return "CANCELLED";
    case "verifying":
    case "verification_pending":
      return "VERIFYING";
    case "monitoring":
    case "triggered":
      return "MONITORING";
    case "running":
    case "created":
    case "ready":
    case "scheduled":
    case "generating":
      return "RUNNING";
    case "pending":
    case "planning":
    case "paused":
    case "waiting":
    case "open":
    case "draft":
      return "WAITING";
    case "active":
    case "agreed":
    case "accepted":
    case "confirmed":
      return "ACTIVE";
    // A capacity claim that is held but not confirmed is still waiting on
    // somebody, which is what WAITING means everywhere else in this vocabulary.
    case "held":
      return "WAITING";
    default:
      return "UNKNOWN";
  }
}

function revisionOf(updatedAt: Date, status: string): string {
  return `${updatedAt.toISOString()}:${status}`;
}

/**
 * One reader per canonical subject kind. Each reads the canonical table and
 * nothing else — there is no cache, no mirror and no copy, which is what makes
 * DUPLICATE_OPERATIONAL_TRUTH = 0 true rather than merely intended.
 */
type SubjectReader = (subjectId: string) => Promise<SubjectSnapshot>;

function numericId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

const SUBJECT_READERS: Readonly<Record<LivingObjectSubjectKind, SubjectReader>> = Object.freeze({
  run: async (subjectId) => {
    const [row] = await db.select().from(runs).where(eq(runs.id, subjectId)).limit(1);
    if (!row) return ABSENT;
    return {
      exists: true,
      authorizedScopes: [String(row.ownerId)],
      status: normalizeStatus(row.status),
      title: text(row.goal, "Ongoing process"),
      updatedAt: row.updatedAt,
      revision: revisionOf(row.updatedAt, row.status),
    };
  },

  task: async (subjectId) => {
    const [row] = await db
      .select()
      .from(runtimeTasks)
      .where(eq(runtimeTasks.id, subjectId))
      .limit(1);
    if (!row) return ABSENT;
    return {
      exists: true,
      authorizedScopes: [String(row.userId)],
      status: normalizeStatus(row.status),
      title: text(row.goal, "Ongoing process"),
      updatedAt: row.updatedAt,
      revision: revisionOf(row.updatedAt, row.status),
    };
  },

  world: async (subjectId) => {
    // A world is identified by its worldKey — the derived, scope-stable id the
    // world runtime hands out — and not by the row's serial. Following the
    // serial would follow a storage detail rather than the world.
    const [row] = await db
      .select()
      .from(generatedSystems)
      .where(eq(generatedSystems.worldKey, subjectId))
      .limit(1);
    if (!row) return ABSENT;
    // A world carries its own acting scope since the world phase; the owner is
    // kept beside it so a personal world stays readable by the person.
    const scopes = [String(row.ownerId), ...(row.scopeId ? [String(row.scopeId)] : [])];
    return {
      exists: true,
      authorizedScopes: [...new Set(scopes)],
      status: normalizeStatus(row.status),
      title: text(row.name, "Persistent world"),
      updatedAt: row.updatedAt,
      revision: revisionOf(row.updatedAt, row.status),
    };
  },

  bubble: async (subjectId) => {
    const id = numericId(subjectId);
    if (id === null) return ABSENT;
    const [row] = await db.select().from(bubbles).where(eq(bubbles.id, id)).limit(1);
    if (!row) return ABSENT;
    return {
      exists: true,
      authorizedScopes: [String(row.userId)],
      status: normalizeStatus(row.status),
      title: text(row.label, "Persistent surface"),
      updatedAt: row.updatedAt,
      revision: revisionOf(row.updatedAt, row.status),
    };
  },

  agreement: async (subjectId) => {
    const [row] = await db.select().from(agreements).where(eq(agreements.id, subjectId)).limit(1);
    if (!row) return ABSENT;
    // Every party to an agreement may follow it. A party is a party; none of
    // them is privileged by a column name.
    const scopes = [...(row.participants ?? []), String(row.acceptedByOwnerId)].map(String);
    return {
      exists: true,
      authorizedScopes: [...new Set(scopes)],
      status: normalizeStatus(row.status),
      title: "Agreement",
      updatedAt: row.createdAt,
      revision: revisionOf(row.createdAt, row.status),
    };
  },

  commitment: async (subjectId) => {
    const [row] = await db.select().from(commitments).where(eq(commitments.id, subjectId)).limit(1);
    if (!row) return ABSENT;
    // Who owes it AND who it is owed to. «أين وصل طلبي؟» is asked by the
    // beneficiary at least as often as by the party who owes.
    const scopes = [
      String(row.ownerId),
      ...(row.beneficiaryActorId ? [String(row.beneficiaryActorId)] : []),
    ];
    // CLAIMED_COMPLETE != VERIFIED_COMPLETE. A commitment that says it is done
    // and has not been verified is VERIFYING, never COMPLETED.
    const claimed = normalizeStatus(row.state);
    const status =
      claimed === "COMPLETED" && row.verification !== "VERIFIED" ? "VERIFYING" : claimed;
    return {
      exists: true,
      authorizedScopes: [...new Set(scopes)],
      status,
      title: text(row.termKey, "Obligation"),
      updatedAt: row.updatedAt,
      revision: revisionOf(row.updatedAt, `${row.state}:${row.verification}`),
    };
  },

  transaction: async (subjectId) => {
    const [row] = await db.select().from(transactions).where(eq(transactions.id, subjectId)).limit(1);
    if (!row) return ABSENT;
    const scopes = [String(row.scopeId), ...(row.parties ?? []).map(String)];
    return {
      exists: true,
      authorizedScopes: [...new Set(scopes)],
      status: normalizeStatus(row.state),
      title: "Exchange",
      updatedAt: row.updatedAt,
      revision: revisionOf(row.updatedAt, row.state),
    };
  },

  /**
   * A held claim on a resource. Structurally an obligation with a deadline —
   * which is why it needs a reader and not a type.
   */
  reservation: async (subjectId) => {
    const [row] = await db.select().from(reservations).where(eq(reservations.id, subjectId)).limit(1);
    if (!row) return ABSENT;
    return {
      exists: true,
      authorizedScopes: [String(row.ownerId)],
      status: normalizeStatus(row.status),
      title: text(row.resourceKind, "Reservation"),
      updatedAt: row.updatedAt,
      revision: revisionOf(row.updatedAt, row.status),
    };
  },

  /** Two or more parties still working out whether there will be an agreement. */
  engagement: async (subjectId) => {
    const [row] = await db
      .select()
      .from(economicEngagements)
      .where(eq(economicEngagements.id, subjectId))
      .limit(1);
    if (!row) return ABSENT;
    return {
      exists: true,
      // The initiator is a party too, whatever the participants list holds.
      authorizedScopes: [
        ...new Set([String(row.initiatorOwnerId), ...(row.participants ?? []).map(String)]),
      ],
      status: normalizeStatus(row.state),
      title: "Engagement",
      updatedAt: row.updatedAt,
      revision: revisionOf(row.updatedAt, row.state),
    };
  },

  /** One party's side of an engagement. Their own, and nobody else's. */
  negotiation: async (subjectId) => {
    const [row] = await db
      .select()
      .from(negotiationEnvelopes)
      .where(eq(negotiationEnvelopes.id, subjectId))
      .limit(1);
    if (!row) return ABSENT;
    return {
      exists: true,
      authorizedScopes: [String(row.ownerId)],
      status: normalizeStatus(row.state),
      title: "Negotiation",
      updatedAt: row.createdAt,
      revision: revisionOf(row.createdAt, row.state),
    };
  },

  monitor: async (subjectId) => {
    const [row] = await db
      .select()
      .from(standingMonitors)
      .where(eq(standingMonitors.id, subjectId))
      .limit(1);
    if (!row) return ABSENT;
    return {
      exists: true,
      authorizedScopes: [String(row.scopeId)],
      status: normalizeStatus(row.state),
      title: text(row.label, "Standing condition"),
      updatedAt: row.updatedAt,
      revision: revisionOf(row.updatedAt, `${row.state}:${row.lastResult ?? "NONE"}`),
    };
  },
});

/** Read one canonical subject. The ONLY door to subject truth in this module. */
export async function readSubject(
  subjectKind: LivingObjectSubjectKind,
  subjectId: string,
): Promise<SubjectSnapshot> {
  const reader = SUBJECT_READERS[subjectKind];
  if (!reader) return ABSENT;
  const id = subjectId.trim();
  if (!id) return ABSENT;
  return reader(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Materialization policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHAT A TURN OFFERS, structurally.
 *
 * Every field is a shape, not a topic. Nothing here can be read as «this was
 * about food» or «this was about a car», because nothing here carries a noun.
 * That is the whole reason the policy generalizes:
 *
 *   EVERY_TURN_BECOMES_LIVING_OBJECT = NO
 */
export type MaterializationInput = {
  readonly subjectKind: LivingObjectSubjectKind;
  readonly subjectId: string;
  /** Did the turn change anything outside the conversation? */
  readonly sideEffect: "NONE" | "INTERNAL_STATE" | "EXTERNAL";
  /** How long the subject is meant to outlive the turn. */
  readonly durability: "EPHEMERAL" | "ONGOING" | "PERSISTENT";
};

export type MaterializationDecision =
  | { readonly materialize: true; readonly reason: LivingObjectReason }
  | { readonly materialize: false; readonly decline: LivingObjectDecline };

/**
 * Which structural shape each canonical subject has. Discovery, comparison and
 * selection produce none of these, which is exactly why they materialize
 * nothing: a search that found ten restaurants created no obligation, started
 * no execution, armed no condition and built no surface.
 */
const REASON_BY_KIND: Readonly<Record<LivingObjectSubjectKind, LivingObjectReason>> = Object.freeze({
  run: "DURABLE_EXECUTION_STARTED",
  task: "DURABLE_EXECUTION_STARTED",
  world: "PERSISTENT_SURFACE_CREATED",
  bubble: "PERSISTENT_SURFACE_CREATED",
  agreement: "OBLIGATION_CREATED",
  commitment: "OBLIGATION_CREATED",
  transaction: "OBLIGATION_CREATED",
  monitor: "STANDING_CONDITION_CREATED",
  reservation: "OBLIGATION_CREATED",
  engagement: "OBLIGATION_CREATED",
  negotiation: "OBLIGATION_CREATED",
});

/**
 * The generic materialization policy.
 *
 * A turn earns a living object when it left something behind that keeps
 * running, keeps owing, keeps watching or keeps existing. Reading, ranking and
 * choosing leave nothing behind, however long the answer was and however much
 * the person cared about it.
 */
export function materializationDecision(
  input: MaterializationInput,
  snapshot: SubjectSnapshot,
): MaterializationDecision {
  if (!snapshot.exists) return { materialize: false, decline: "NO_DURABLE_SUBJECT" };
  // A read that changed nothing is a read. This is the branch that keeps a
  // discovery turn — «أين ألاقي شاورما؟» — from leaving a tracked thing behind.
  if (input.sideEffect === "NONE" && input.durability === "EPHEMERAL") {
    return { materialize: false, decline: "READ_ONLY_TURN" };
  }
  if (input.durability === "EPHEMERAL") {
    return { materialize: false, decline: "EPHEMERAL_RESULT" };
  }
  if (TERMINAL_STATUSES.has(snapshot.status)) {
    return { materialize: false, decline: "SUBJECT_ALREADY_TERMINAL" };
  }
  return { materialize: true, reason: REASON_BY_KIND[input.subjectKind] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Authorization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the scope a principal is acting as. A client may REQUEST an
 * organization; whether it may act as one is decided by membership, here, and
 * never by anything the client said about itself.
 */
export async function actingScopeFor(input: {
  principalId: string;
  organizationId?: string;
}): Promise<{ scopeId: string; principalId: string }> {
  const principalId = input.principalId?.trim();
  if (!principalId) throw new LivingObjectError("A principal is required.", "INVALID");
  const resolution = await resolveActingScope({
    principalId,
    ...(input.organizationId
      ? { request: { intent: "ORGANIZATION" as const, organizationId: input.organizationId } }
      : {}),
  });
  if (resolution.status !== "RESOLVED") {
    throw new LivingObjectError(
      resolution.status === "DENIED"
        ? resolution.message
        : "That reference does not identify one scope you may act as.",
      "FORBIDDEN",
    );
  }
  return { scopeId: resolution.scope.scopeId, principalId };
}

/**
 * May this scope see this subject?
 *
 * The subject answers, not the handle. A handle that exists for a scope whose
 * standing was revoked stops projecting the moment the revocation lands,
 * because this is re-asked on every read rather than trusted from the row.
 */
function subjectVisibleTo(snapshot: SubjectSnapshot, scopeId: string): boolean {
  return snapshot.exists && snapshot.authorizedScopes.includes(scopeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Materialize · lifecycle
// ─────────────────────────────────────────────────────────────────────────────

function handleId(): string {
  return `lo_${crypto.randomUUID().replace(/-/g, "").slice(0, 26)}`;
}

/**
 * Create the handle, or return the one that is already there.
 *
 * Idempotent on (scope, subject) by a unique index, so a turn that repeats —
 * a retry, a replay, a reconnect — never produces a second handle on the same
 * thing.
 */
export async function materializeLivingObject(input: {
  principalId: string;
  organizationId?: string;
  subjectKind: LivingObjectSubjectKind;
  subjectId: string;
  sideEffect: MaterializationInput["sideEffect"];
  durability: MaterializationInput["durability"];
  conversationId?: string | null;
}): Promise<
  | { readonly materialized: true; readonly object: LivingObjectRow; readonly created: boolean }
  | { readonly materialized: false; readonly decline: LivingObjectDecline }
> {
  if (!LIVING_OBJECT_SUBJECT_KINDS.includes(input.subjectKind)) {
    throw new LivingObjectError("That is not a subject JASIM can follow.", "INVALID");
  }
  const { scopeId, principalId } = await actingScopeFor(input);
  const subjectId = input.subjectId.trim();
  if (!subjectId) throw new LivingObjectError("A subject is required.", "INVALID");

  const snapshot = await readSubject(input.subjectKind, subjectId);

  // Authorization BEFORE the decision, and the same refusal whether the subject
  // is forbidden or absent: a guessed id must not be able to tell the two
  // apart, or guessing becomes an existence oracle.
  if (!subjectVisibleTo(snapshot, scopeId)) {
    return { materialized: false, decline: snapshot.exists ? "NOT_AUTHORIZED" : "NO_DURABLE_SUBJECT" };
  }

  const decision = materializationDecision(
    {
      subjectKind: input.subjectKind,
      subjectId,
      sideEffect: input.sideEffect,
      durability: input.durability,
    },
    snapshot,
  );
  if (!decision.materialize) return { materialized: false, decline: decision.decline };

  const existing = await findHandle(scopeId, input.subjectKind, subjectId);
  if (existing) {
    // A handle somebody released or resolved comes back when the subject gives
    // them a new reason to follow it. Nothing is duplicated and nothing is lost.
    if (existing.followState === "FOLLOWING" && existing.surfaceState === "VISIBLE") {
      return { materialized: true, object: existing, created: false };
    }
    const [revived] = await db
      .update(livingObjects)
      .set({ followState: "FOLLOWING", surfaceState: "VISIBLE", updatedAt: new Date() })
      .where(eq(livingObjects.id, existing.id))
      .returning();
    await appendLivingObjectEvent({
      type: "LIVING_OBJECT_RESUMED",
      scopeId,
      object: revived!,
      message: "A followed subject became active again.",
    });
    return { materialized: true, object: revived!, created: false };
  }

  const [created] = await db
    .insert(livingObjects)
    .values({
      id: handleId(),
      scopeId,
      subjectKind: input.subjectKind,
      subjectId,
      followState: "FOLLOWING",
      surfaceState: "VISIBLE",
      originConversationId: input.conversationId ?? null,
      materializedBy: principalId,
      reason: decision.reason,
      lastSeenRevision: snapshot.revision,
      lastSeenAt: new Date(),
    })
    .onConflictDoNothing({
      target: [livingObjects.scopeId, livingObjects.subjectKind, livingObjects.subjectId],
    })
    .returning();

  if (!created) {
    // Lost the race. The winner's row is the answer; a race must not produce a
    // second handle or an error.
    const raced = await findHandle(scopeId, input.subjectKind, subjectId);
    if (!raced) throw new LivingObjectError("That handle could not be created.", "CONFLICT");
    return { materialized: true, object: raced, created: false };
  }

  await appendLivingObjectEvent({
    type: "LIVING_OBJECT_MATERIALIZED",
    scopeId,
    object: created,
    message: "A durable subject is now followed.",
  });
  return { materialized: true, object: created, created: true };
}

async function findHandle(
  scopeId: string,
  subjectKind: string,
  subjectId: string,
): Promise<LivingObjectRow | null> {
  const [row] = await db
    .select()
    .from(livingObjects)
    .where(
      and(
        eq(livingObjects.scopeId, scopeId),
        eq(livingObjects.subjectKind, subjectKind),
        eq(livingObjects.subjectId, subjectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Change what the SURFACE does with a handle, or what the FOLLOWER says about
 * it. Neither ever touches the subject:
 *
 *   HIDE != CANCEL · CANCEL != DELETE · RESOLVED != ERASED
 *   SURFACE_EXIT != LIVING_OBJECT_DELETE
 *
 * Hiding an order does not cancel it. Resolving a tracked obligation does not
 * fulfil it. Releasing a handle does not erase what happened. Cancelling the
 * subject itself is the subject's own runtime's business and is not reachable
 * from here — which is why there is no `cancel` in this function.
 */
export async function setLivingObjectState(input: {
  principalId: string;
  organizationId?: string;
  id: string;
  surfaceState?: LivingObjectSurfaceState;
  followState?: LivingObjectFollowState;
}): Promise<LivingObjectRow> {
  const { scopeId } = await actingScopeFor(input);
  const [row] = await db
    .select()
    .from(livingObjects)
    .where(and(eq(livingObjects.id, input.id), eq(livingObjects.scopeId, scopeId)))
    .limit(1);
  // A handle belonging to another scope is NOT FOUND, never FORBIDDEN: a
  // refusal that distinguishes them tells a guesser the handle exists.
  if (!row) throw new LivingObjectError("No such living object.", "NOT_FOUND");

  if (input.surfaceState === undefined && input.followState === undefined) {
    throw new LivingObjectError("Nothing to change.", "INVALID");
  }

  const [updated] = await db
    .update(livingObjects)
    .set({
      ...(input.surfaceState ? { surfaceState: input.surfaceState } : {}),
      ...(input.followState ? { followState: input.followState } : {}),
      updatedAt: new Date(),
    })
    .where(eq(livingObjects.id, row.id))
    .returning();

  await appendLivingObjectEvent({
    type: "LIVING_OBJECT_STATE_CHANGED",
    scopeId,
    object: updated!,
    message: "A follower changed what their surface does with a tracked subject.",
  });
  return updated!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Projection — subject truth, read live, every time
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectedLivingObject = {
  readonly id: string;
  readonly subject: { readonly kind: LivingObjectSubjectKind; readonly id: string };
  readonly title: string;
  readonly status: LivingObjectRuntimeStatus;
  readonly followState: LivingObjectFollowState;
  readonly surfaceState: LivingObjectSurfaceState;
  readonly reason: LivingObjectReason;
  /** TRUE when the subject moved since this follower last saw it. */
  readonly changedSinceLastSeen: boolean;
  /**
   * PRESENT when the subject can no longer be read under this scope — it was
   * deleted, or the standing that made it visible was revoked. The handle is
   * kept and says so; it never invents a status for a thing it cannot see.
   *
   *   UNKNOWN != FALSE · UNKNOWN != ABSENT
   */
  readonly unreadable: boolean;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly originConversationId: string | null;
};

/**
 * Project the handles a scope holds.
 *
 * Every projected field but the follower's own state is read from the canonical
 * row in this call. There is no cached status to go stale and no mirrored title
 * to drift, so a projection cannot report something the subject would deny.
 */
export async function projectLivingObjects(input: {
  principalId: string;
  organizationId?: string;
  includeHidden?: boolean;
  includeResolved?: boolean;
  limit?: number;
}): Promise<{
  readonly kind: "living_objects";
  readonly version: 1;
  readonly objects: readonly ProjectedLivingObject[];
  readonly generatedAt: string;
}> {
  const { scopeId } = await actingScopeFor(input);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  const conditions = [eq(livingObjects.scopeId, scopeId)];
  if (!input.includeHidden) conditions.push(eq(livingObjects.surfaceState, "VISIBLE"));
  if (!input.includeResolved) conditions.push(eq(livingObjects.followState, "FOLLOWING"));

  const rows = await db
    .select()
    .from(livingObjects)
    .where(and(...conditions))
    .orderBy(desc(livingObjects.updatedAt))
    .limit(limit);

  const projected = await Promise.all(rows.map((row) => projectOne(row, scopeId)));
  return {
    kind: "living_objects",
    version: 1,
    objects: projected,
    generatedAt: new Date().toISOString(),
  };
}

async function projectOne(row: LivingObjectRow, scopeId: string): Promise<ProjectedLivingObject> {
  const kind = row.subjectKind as LivingObjectSubjectKind;
  const snapshot = await readSubject(kind, row.subjectId);
  // Re-asked here, not trusted from the row. A membership revoked a second ago
  // closes this projection now.
  const readable = subjectVisibleTo(snapshot, scopeId);
  return {
    id: row.id,
    subject: { kind, id: row.subjectId },
    title: readable ? snapshot.title : "",
    status: readable ? snapshot.status : "UNKNOWN",
    followState: row.followState,
    surfaceState: row.surfaceState,
    reason: row.reason as LivingObjectReason,
    changedSinceLastSeen: readable && snapshot.revision !== (row.lastSeenRevision ?? ""),
    unreadable: !readable,
    updatedAt: (readable ? snapshot.updatedAt : row.updatedAt).toISOString(),
    createdAt: row.createdAt.toISOString(),
    originConversationId: row.originConversationId,
  };
}

/** Read one handle. Same refusal for forbidden and absent, for the same reason. */
export async function readLivingObject(input: {
  principalId: string;
  organizationId?: string;
  id: string;
}): Promise<ProjectedLivingObject> {
  const { scopeId } = await actingScopeFor(input);
  const [row] = await db
    .select()
    .from(livingObjects)
    .where(and(eq(livingObjects.id, input.id), eq(livingObjects.scopeId, scopeId)))
    .limit(1);
  if (!row) throw new LivingObjectError("No such living object.", "NOT_FOUND");
  return projectOne(row, scopeId);
}

/**
 * Mark how far this follower has been reconciled.
 *
 * This is the ONLY write that records anything about the subject, and what it
 * records is the follower's position, not the subject's state — the difference
 * between «what I have seen» and «what is true», which is why a stale cursor
 * can only ever under-report, never contradict.
 */
export async function acknowledgeLivingObject(input: {
  principalId: string;
  organizationId?: string;
  id: string;
}): Promise<ProjectedLivingObject> {
  const { scopeId } = await actingScopeFor(input);
  const [row] = await db
    .select()
    .from(livingObjects)
    .where(and(eq(livingObjects.id, input.id), eq(livingObjects.scopeId, scopeId)))
    .limit(1);
  if (!row) throw new LivingObjectError("No such living object.", "NOT_FOUND");
  const snapshot = await readSubject(row.subjectKind as LivingObjectSubjectKind, row.subjectId);
  if (!subjectVisibleTo(snapshot, scopeId)) return projectOne(row, scopeId);
  const [updated] = await db
    .update(livingObjects)
    .set({ lastSeenRevision: snapshot.revision, lastSeenAt: new Date() })
    .where(eq(livingObjects.id, row.id))
    .returning();
  return projectOne(updated!, scopeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation against the canonical subjects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk a scope's handles, compare each against its subject, and emit an event
 * for the ones that moved.
 *
 * This is the DERIVED · VERSIONED · RECONCILABLE part: nothing is pushed into
 * the handle, the subject is asked. A handle whose subject reached a terminal
 * state resolves itself — RESOLVED, which is not erased and not cancelled — so
 * a surface stops showing finished things without anybody deleting history.
 */
export async function reconcileLivingObjects(input: {
  scopeId: string;
  limit?: number;
}): Promise<{
  readonly examined: number;
  readonly changed: number;
  readonly resolved: number;
  readonly unreadable: number;
}> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rows = await db
    .select()
    .from(livingObjects)
    .where(
      and(eq(livingObjects.scopeId, input.scopeId), eq(livingObjects.followState, "FOLLOWING")),
    )
    .orderBy(asc(livingObjects.updatedAt))
    .limit(limit);

  let changed = 0;
  let resolved = 0;
  let unreadable = 0;

  for (const row of rows) {
    const kind = row.subjectKind as LivingObjectSubjectKind;
    const snapshot = await readSubject(kind, row.subjectId);
    if (!subjectVisibleTo(snapshot, input.scopeId)) {
      // The subject went away or the standing did. Neither is a status, and
      // neither deletes the handle.
      unreadable += 1;
      continue;
    }
    const moved = snapshot.revision !== (row.lastSeenRevision ?? "");
    if (!moved) continue;
    changed += 1;

    const terminal = TERMINAL_STATUSES.has(snapshot.status);
    const [updated] = await db
      .update(livingObjects)
      .set({
        ...(terminal ? { followState: "RESOLVED" as const } : {}),
        updatedAt: new Date(),
      })
      .where(eq(livingObjects.id, row.id))
      .returning();
    if (terminal) resolved += 1;

    await appendLivingObjectEvent({
      type: terminal ? "LIVING_OBJECT_RESOLVED" : "LIVING_OBJECT_CHANGED",
      scopeId: input.scopeId,
      object: updated!,
      message: terminal
        ? "A followed subject reached a terminal state."
        : "A followed subject changed.",
    });
  }

  return { examined: rows.length, changed, resolved, unreadable };
}

/** Every scope that holds at least one followed handle. Drives the sweep. */
export async function scopesWithLivingObjects(limit = 200): Promise<readonly string[]> {
  const rows = await db
    .selectDistinct({ scopeId: livingObjects.scopeId })
    .from(livingObjects)
    .where(eq(livingObjects.followState, "FOLLOWING"))
    .limit(limit);
  return rows.map((row) => row.scopeId);
}

/** One pass over every scope. Called by the EXISTING sweep; adds no scheduler. */
export async function sweepLivingObjects(): Promise<{
  readonly scopes: number;
  readonly changed: number;
  readonly resolved: number;
}> {
  const scopes = await scopesWithLivingObjects();
  let changed = 0;
  let resolved = 0;
  for (const scopeId of scopes) {
    const result = await reconcileLivingObjects({ scopeId });
    changed += result.changed;
    resolved += result.resolved;
  }
  return { scopes: scopes.length, changed, resolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// The event ledger — the EXISTING one
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append to the canonical `events` ledger, the same one the world and
 * monitoring runtimes write to and the same one realtime already tails.
 *
 *   SECOND_EVENT_LEDGERS_ADDED = 0 · SECOND_CURSOR_MODELS_ADDED = 0
 *
 * The payload carries IDS AND A CLOSED VOCABULARY ONLY. There is no title, no
 * status text, no terms and no payload passthrough, because an event says that
 * something changed and never what it now says.
 */
async function appendLivingObjectEvent(input: {
  type: string;
  scopeId: string;
  object: LivingObjectRow;
  message: string;
}): Promise<void> {
  await db.insert(events).values({
    type: input.type,
    source: "runtime",
    ownerId: input.scopeId,
    correlationId: input.object.id,
    message: input.message,
    payload: {
      livingObjectId: input.object.id,
      subjectKind: input.object.subjectKind,
      followState: input.object.followState,
      surfaceState: input.object.surfaceState,
    },
  });
}

/** Canonical event types this runtime emits. Nothing else may claim them. */
export const LIVING_OBJECT_EVENT_TYPES = [
  "LIVING_OBJECT_MATERIALIZED",
  "LIVING_OBJECT_CHANGED",
  "LIVING_OBJECT_RESOLVED",
  "LIVING_OBJECT_RESUMED",
  "LIVING_OBJECT_STATE_CHANGED",
] as const;

/**
 * What changed for this scope since a cursor, from the canonical ledger.
 * Used by the existing realtime catch-up; it opens no socket of its own.
 */
export async function livingObjectEventsSince(input: {
  scopeId: string;
  cursor: number;
  limit?: number;
}): Promise<readonly { id: number; type: string; livingObjectId: string }[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rows = await db
    .select({ id: events.id, type: events.type, payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.ownerId, input.scopeId),
        gt(events.id, input.cursor),
        inArray(events.type, [...LIVING_OBJECT_EVENT_TYPES]),
      ),
    )
    .orderBy(asc(events.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    livingObjectId: String((row.payload as Record<string, unknown>).livingObjectId ?? ""),
  }));
}

/** Counts for an operator. Ids and totals; never contents. */
export async function livingObjectMetrics(scopeId: string): Promise<{
  readonly following: number;
  readonly resolved: number;
  readonly hidden: number;
}> {
  const [row] = await db
    .select({
      following: sql<number>`COUNT(*) FILTER (WHERE ${livingObjects.followState} = 'FOLLOWING')::int`,
      resolved: sql<number>`COUNT(*) FILTER (WHERE ${livingObjects.followState} = 'RESOLVED')::int`,
      hidden: sql<number>`COUNT(*) FILTER (WHERE ${livingObjects.surfaceState} = 'HIDDEN')::int`,
    })
    .from(livingObjects)
    .where(eq(livingObjects.scopeId, scopeId));
  return { following: row?.following ?? 0, resolved: row?.resolved ?? 0, hidden: row?.hidden ?? 0 };
}
