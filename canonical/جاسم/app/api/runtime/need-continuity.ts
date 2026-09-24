/**
 * NEED CONTINUITY — the runtime carries what somebody wants, not the model.
 *
 *   NEED_CONTINUITY != CHAT_HISTORY_AS_TRUTH
 *   NEED_CONTINUITY != MODEL_MEMORY
 *   NEED_CONTINUITY != LIVING_OBJECT · != WORLD · != RUN · != TRANSACTION
 *   NEED_CONTINUITY != USER_PROFILE_MEMORY
 *   MODEL != NEED_AUTHORITY
 *
 * A conversational need is a GoalSpec that outlived its turn. That is not a
 * metaphor: the stored fields ARE the GoalSpec's fields, and every merge is
 * re-validated by `evaluateGoalSpec`, so the honesty rules that governed a goal
 * inside one turn keep governing it across many — including the one that
 * matters most, that an inference may guide but may not exclude.
 *
 * THE CENTRAL LAW. The model says what CHANGED. It never says what was already
 * true. A patch that carried the whole prior goal would make the model the
 * keeper of continuity, and a model that mis-remembers would silently rewrite
 * what somebody asked for:
 *
 *   MODEL_MUST_RESTATE_FULL_PRIOR_GOAL = NO
 *   RUNTIME_OWNS_NEED_MERGE = PASS
 *
 * NO DOMAIN. There is no need type, no need handler and no branch on a noun. A
 * meal, a used car, a court interpreter, two weeks of storage and an idle
 * machine differ in the VALUES of their constraints and in nothing else.
 *
 *   DOMAIN_NEED_TYPES_ADDED = 0 · DOMAIN_NEED_HANDLERS_ADDED = 0
 */

import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../queries/connection";
import {
  conversationNeeds,
  type ConversationNeedRow,
  type ConversationNeedState,
} from "@db/schema-block2";
import {
  GOAL_DIMENSIONS,
  GoalSpecSchema,
  evaluateGoalSpec,
  type GoalConstraint,
  type GoalEvaluation,
  type GoalSpec,
} from "./goal-spec";
import { sanitizeModelStructuredOutput } from "./model-output-trust";

export class NeedError extends Error {
  readonly code: "INVALID" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "AMBIGUOUS";
  constructor(message: string, code: NeedError["code"]) {
    super(message);
    this.name = "NeedError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// What a model may say
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keys a need patch may never carry.
 *
 * Each one ends a question the model is not entitled to end: whose need it is,
 * which scope is acting, how many revisions there have been, whether it is
 * finished, and whether anyone outside this conversation may see it. They join
 * the shared authority screen rather than being checked one by one.
 *
 *   MODEL_CAN_SET_NEED_SCOPE = NO
 *   MODEL_CAN_SET_NEED_REVISION = NO
 *   MODEL_CAN_MARK_NEED_SATISFIED = NO
 */
export const NEED_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "ownerid", "scopeid", "actingscope", "principalid", "createdby",
  "revision", "version", "expectedrevision",
  "state", "resolved", "satisfied", "needsatisfied", "fulfilled", "complete",
  "publish", "published", "visibility", "market", "public",
  "conversationid", "createdat", "updatedat",
]);

const ConstraintPatchSchema = z
  .object({
    dimension: z.enum(GOAL_DIMENSIONS),
    operator: z.enum(["AT_MOST", "AT_LEAST", "EQUALS", "MINIMIZE", "MAXIMIZE"]),
    value: z.union([z.number(), z.string().trim().min(1).max(120)]).optional(),
    unit: z.string().trim().min(1).max(40).optional(),
    hardness: z.enum(["HARD", "SOFT"]),
    source: z.enum(["STATED", "INFERRED"]),
    evidence: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

/**
 * A DELTA, and only a delta.
 *
 * There is deliberately no `constraints` field that replaces the list wholesale
 * and no `outcome` outside a NEW need: a patch that could restate everything
 * would be a patch that could silently erase everything.
 */
export const NeedPatchSchema = z
  .object({
    /** What the model read this utterance as. The runtime decides what happens. */
    intent: z.enum(["NEW", "REFINE", "RESUME", "CORRECT"]),
    /** For NEW only. Ignored elsewhere, because an outcome is not a refinement. */
    outcome: z.string().trim().min(1).max(2_000).optional(),
    /**
     * A canonical need this conversation already carries. A model may POINT; it
     * may not conjure — the id is checked against this conversation and scope.
     */
    needRef: z.string().trim().min(1).max(80).optional(),
    addConstraints: z.array(ConstraintPatchSchema).max(10).optional(),
    /** Dimensions the person is no longer bounding. */
    clearDimensions: z.array(z.enum(GOAL_DIMENSIONS)).max(10).optional(),
    addPreferences: z.array(z.enum(GOAL_DIMENSIONS)).max(6).optional(),
    addAssumptions: z.array(z.string().trim().min(1).max(400)).max(10).optional(),
    addUnknowns: z.array(z.string().trim().min(1).max(400)).max(10).optional(),
    /** Questions this utterance answered. */
    resolveUnknowns: z.array(z.string().trim().min(1).max(400)).max(10).optional(),
  })
  .strict();

export type NeedPatch = z.infer<typeof NeedPatchSchema>;

/**
 * Parse a model's proposed patch, refusing authority and unexpected shape.
 *
 * Two screens, in this order. The shared one catches the words no model output
 * anywhere may carry. The need-specific one catches words that are perfectly
 * ordinary elsewhere — `version`, `state`, `conversationId` — and are claims
 * when they appear HERE. The schema is `.strict()` besides, so an undeclared
 * key is refused three times over rather than dropped.
 */
export function parseNeedPatch(value: unknown): NeedPatch {
  const sanitized = sanitizeModelStructuredOutput(value, { label: "need patch" });
  if (sanitized.value && typeof sanitized.value === "object" && !Array.isArray(sanitized.value)) {
    for (const key of Object.keys(sanitized.value as Record<string, unknown>)) {
      if (NEED_AUTHORITY_KEYS.has(key.toLowerCase())) {
        throw new NeedError(
          `A need patch may not carry «${key}»: that is the runtime's to decide.`,
          "FORBIDDEN",
        );
      }
    }
  }
  return NeedPatchSchema.parse(sanitized.value);
}

// ─────────────────────────────────────────────────────────────────────────────
// The merge — the one place canonical need state changes
// ─────────────────────────────────────────────────────────────────────────────

function specOf(row: ConversationNeedRow): GoalSpec {
  return GoalSpecSchema.parse({
    version: 1,
    outcome: row.outcome,
    constraints: row.constraints,
    preferences: row.preferences,
    assumptions: row.assumptions,
    unknowns: row.unknowns,
  });
}

/**
 * Apply a delta to a spec.
 *
 * ONE CONSTRAINT PER DIMENSION PER UNIT. A new bound on a dimension REPLACES
 * the old one rather than joining it, which is what makes «أقل من ٥» followed
 * by «لا، خلها ٧» a correction instead of a contradiction nobody can satisfy:
 *
 *   CONTRADICTORY_ACTIVE_CONSTRAINTS_FROM_SIMPLE_CORRECTION = 0
 *
 * A STATED constraint always displaces an INFERRED one on the same dimension.
 * The reverse is refused: an inference may not overwrite something somebody
 * actually said.
 *
 *   INFERRED_AS_USER_STATED = 0 · INFERENCE_STICKINESS = SAFE
 */
export function applyNeedPatch(current: GoalSpec, patch: NeedPatch): GoalSpec {
  const constraints: GoalConstraint[] = [...current.constraints];

  for (const dimension of patch.clearDimensions ?? []) {
    for (let index = constraints.length - 1; index >= 0; index -= 1) {
      if (constraints[index]!.dimension === dimension) constraints.splice(index, 1);
    }
  }

  for (const incoming of patch.addConstraints ?? []) {
    const existingIndex = constraints.findIndex(
      (entry) => entry.dimension === incoming.dimension,
    );
    if (existingIndex === -1) {
      constraints.push(incoming as GoalConstraint);
      continue;
    }
    const existing = constraints[existingIndex]!;
    // An inference never overwrites something the person said. It may still be
    // recorded as a softer preference elsewhere; it may not take this slot.
    if (incoming.source === "INFERRED" && existing.source === "STATED") continue;
    constraints[existingIndex] = incoming as GoalConstraint;
  }

  const resolved = new Set(patch.resolveUnknowns ?? []);
  const unknowns = current.unknowns
    .filter((question) => !resolved.has(question))
    .concat(patch.addUnknowns ?? []);

  return {
    version: 1,
    // Only a NEW need states an outcome. A refinement cannot rewrite what the
    // conversation is about while calling itself a refinement.
    outcome: current.outcome,
    constraints,
    preferences: [...new Set([...current.preferences, ...(patch.addPreferences ?? [])])],
    assumptions: [...new Set([...current.assumptions, ...(patch.addAssumptions ?? [])])],
    unknowns: [...new Set(unknowns)],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

/** Every live need this scope carries in this conversation, current first. */
export async function liveNeeds(input: {
  conversationId: string;
  scopeId: string;
}): Promise<readonly ConversationNeedRow[]> {
  return db
    .select()
    .from(conversationNeeds)
    .where(
      and(
        eq(conversationNeeds.conversationId, input.conversationId),
        eq(conversationNeeds.scopeId, input.scopeId),
        ne(conversationNeeds.state, "RESOLVED"),
        ne(conversationNeeds.state, "ABANDONED"),
      ),
    )
    .orderBy(desc(conversationNeeds.lastActivatedAt));
}

/** The one that is current, or none. Never a guess among several ACTIVE ones. */
export async function currentNeed(input: {
  conversationId: string;
  scopeId: string;
}): Promise<ConversationNeedRow | null> {
  const [row] = await db
    .select()
    .from(conversationNeeds)
    .where(
      and(
        eq(conversationNeeds.conversationId, input.conversationId),
        eq(conversationNeeds.scopeId, input.scopeId),
        eq(conversationNeeds.state, "ACTIVE"),
      ),
    )
    .orderBy(desc(conversationNeeds.lastActivatedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve a need a patch names.
 *
 * Scoped by conversation AND acting scope, so a model naming a need from
 * another conversation, another person or another organization finds nothing:
 *
 *   CROSS_OWNER_NEED_LEAK = 0 · CROSS_SCOPE_NEED_LEAK = 0
 *   CROSS_CONVERSATION_NEED_LEAK = 0
 */
async function needByRef(input: {
  needRef: string;
  conversationId: string;
  scopeId: string;
}): Promise<ConversationNeedRow | null> {
  const [row] = await db
    .select()
    .from(conversationNeeds)
    .where(
      and(
        eq(conversationNeeds.id, input.needRef),
        eq(conversationNeeds.conversationId, input.conversationId),
        eq(conversationNeeds.scopeId, input.scopeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing
// ─────────────────────────────────────────────────────────────────────────────

export type NeedOutcome = {
  readonly need: ConversationNeedRow;
  readonly evaluation: GoalEvaluation;
  readonly created: boolean;
  /** What the runtime did, which is not always what the model proposed. */
  readonly action: "CREATED" | "REFINED" | "RESUMED";
};

/** How many times a contended write rebases before giving up. */
const MAX_MERGE_ATTEMPTS = 4;

/**
 * Apply a patch to this conversation's canonical need state.
 *
 * The runtime decides what happens, using the model's reading as a proposal:
 *
 *   NEW     → a new need; the previous current one becomes BACKGROUND, not
 *             resolved, because turning to something else is not finishing it.
 *   RESUME  → an existing need becomes current again; every other one steps
 *             back. Resuming requires a reference or exactly one candidate.
 *   REFINE  → the current need takes the delta. With no current need, a
 *             refinement with an outcome becomes a new need rather than an
 *             error, because somebody saying what they want is never a fault.
 *   CORRECT → the same as REFINE. Correction is a property of the merge (one
 *             constraint per dimension), not a separate operation.
 */
export async function applyNeedTurn(input: {
  conversationId: string;
  scopeId: string;
  principalId: string;
  patch: NeedPatch;
}): Promise<NeedOutcome> {
  const { conversationId, scopeId, patch } = input;

  if (patch.intent === "NEW") {
    if (!patch.outcome) {
      throw new NeedError("A new need states what should become true.", "INVALID");
    }
    return createNeed(input, patch.outcome);
  }

  // A named need, checked against this conversation and scope. A model may
  // point; pointing is not permission.
  if (patch.needRef) {
    const named = await needByRef({ needRef: patch.needRef, conversationId, scopeId });
    if (!named) throw new NeedError("No such need in this conversation.", "NOT_FOUND");
    return mergeInto(named, input, patch.intent === "RESUME");
  }

  if (patch.intent === "RESUME") {
    const live = await liveNeeds({ conversationId, scopeId });
    const background = live.filter((row) => row.state === "BACKGROUND");
    if (background.length === 0) {
      throw new NeedError("There is nothing set aside to come back to.", "NOT_FOUND");
    }
    // Coming back to «one of them» is not coming back.
    //   AMBIGUOUS_NEED_GUESS = 0
    if (background.length > 1) {
      throw new NeedError("More than one thing was set aside.", "AMBIGUOUS");
    }
    return mergeInto(background[0]!, input, true);
  }

  const current = await currentNeed({ conversationId, scopeId });
  if (current) return mergeInto(current, input, false);

  const live = await liveNeeds({ conversationId, scopeId });
  //   LATEST_NEED_ALWAYS_WINS = NO · FIRST_NEED_ALWAYS_WINS = NO
  if (live.length > 1) {
    throw new NeedError("It is not clear which of these that changes.", "AMBIGUOUS");
  }
  if (live.length === 1) return mergeInto(live[0]!, input, false);
  if (patch.outcome) return createNeed(input, patch.outcome);
  throw new NeedError("There is nothing here yet to refine.", "NOT_FOUND");
}

async function createNeed(
  input: { conversationId: string; scopeId: string; principalId: string; patch: NeedPatch },
  outcome: string,
): Promise<NeedOutcome> {
  // Everything else steps back. TOPIC_SWITCH != NEED_RESOLVED, so nothing is
  // finished and nothing is erased.
  await db
    .update(conversationNeeds)
    .set({ state: "BACKGROUND", updatedAt: new Date() })
    .where(
      and(
        eq(conversationNeeds.conversationId, input.conversationId),
        eq(conversationNeeds.scopeId, input.scopeId),
        eq(conversationNeeds.state, "ACTIVE"),
      ),
    );

  const merged = applyNeedPatch(
    { version: 1, outcome, constraints: [], preferences: [], assumptions: [], unknowns: [] },
    input.patch,
  );
  // The same evaluation a goal inside one turn gets. An inferred HARD bound is
  // downgraded here exactly as it always was.
  const evaluation = evaluateGoalSpec(merged);
  const [row] = await db
    .insert(conversationNeeds)
    .values({
      id: `need_${randomUUID().replace(/-/g, "").slice(0, 26)}`,
      conversationId: input.conversationId,
      scopeId: input.scopeId,
      createdBy: input.principalId,
      outcome: evaluation.goal.outcome,
      constraints: evaluation.goal.constraints,
      preferences: evaluation.goal.preferences,
      assumptions: evaluation.goal.assumptions,
      unknowns: evaluation.goal.unknowns,
      state: "ACTIVE",
      revision: 1,
    })
    .returning();
  return { need: row!, evaluation, created: true, action: "CREATED" };
}

/**
 * Merge a delta into one need, under compare-and-set.
 *
 * A contended write REBASES rather than retrying blindly: the delta is
 * re-applied to whatever the other writer left behind. That is a safe merge
 * precisely because a patch is a delta — re-applying it loses nothing, which a
 * last write of a whole reconstructed goal could never claim.
 *
 *   LOST_NEED_UPDATE = 0 · STALE_NEED_WRITE_SILENTLY_ACCEPTED = 0
 */
async function mergeInto(
  target: ConversationNeedRow,
  input: { conversationId: string; scopeId: string; principalId: string; patch: NeedPatch },
  activate: boolean,
): Promise<NeedOutcome> {
  let row = target;
  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt += 1) {
    const merged = applyNeedPatch(specOf(row), input.patch);
    const evaluation = evaluateGoalSpec(merged);

    if (activate) {
      await db
        .update(conversationNeeds)
        .set({ state: "BACKGROUND", updatedAt: new Date() })
        .where(
          and(
            eq(conversationNeeds.conversationId, input.conversationId),
            eq(conversationNeeds.scopeId, input.scopeId),
            eq(conversationNeeds.state, "ACTIVE"),
            ne(conversationNeeds.id, row.id),
          ),
        );
    }

    const [updated] = await db
      .update(conversationNeeds)
      .set({
        constraints: evaluation.goal.constraints,
        preferences: evaluation.goal.preferences,
        assumptions: evaluation.goal.assumptions,
        unknowns: evaluation.goal.unknowns,
        revision: row.revision + 1,
        ...(activate
          ? { state: "ACTIVE" as const, lastActivatedAt: new Date() }
          : {}),
        updatedAt: new Date(),
      })
      // The compare-and-set. Somebody else's write in between loses this
      // predicate, and we rebase onto what they wrote.
      .where(
        and(eq(conversationNeeds.id, row.id), eq(conversationNeeds.revision, row.revision)),
      )
      .returning();

    if (updated) {
      return {
        need: updated,
        evaluation,
        created: false,
        action: activate ? "RESUMED" : "REFINED",
      };
    }

    const fresh = await needByRef({
      needRef: row.id,
      conversationId: input.conversationId,
      scopeId: input.scopeId,
    });
    if (!fresh) throw new NeedError("That need is no longer there.", "NOT_FOUND");
    row = fresh;
  }
  throw new NeedError("That need is being changed from somewhere else.", "CONFLICT");
}

/**
 * Mark a need finished.
 *
 * Deliberately NOT reachable from a model patch, and deliberately not called
 * by anything that merely completed a transaction: nothing in this repository
 * yet carries provenance from a need to the exchange that came out of it, so
 * resolving one automatically would be a guess about which need a payment
 * satisfied.
 *
 *   FALSE_NEED_SATISFACTION = 0
 */
export async function setNeedState(input: {
  needRef: string;
  conversationId: string;
  scopeId: string;
  state: ConversationNeedState;
}): Promise<ConversationNeedRow> {
  const row = await needByRef(input);
  if (!row) throw new NeedError("No such need in this conversation.", "NOT_FOUND");
  const [updated] = await db
    .update(conversationNeeds)
    .set({ state: input.state, updatedAt: new Date() })
    .where(eq(conversationNeeds.id, row.id))
    .returning();
  return updated!;
}

/** What a surface shows. Ids, a vocabulary and the person's own words. */
export function projectNeed(row: ConversationNeedRow, evaluation?: GoalEvaluation) {
  return {
    needId: row.id,
    outcome: row.outcome,
    revision: row.revision,
    state: row.state,
    constraints: row.constraints,
    preferences: row.preferences,
    unknowns: row.unknowns,
    ...(evaluation ? { readiness: evaluation.readiness, adjustments: evaluation.adjustments } : {}),
  };
}

/**
 * The current need as DISCOVERY consumes it.
 *
 * Discovery reads canonical state rather than re-deriving constraints from the
 * transcript, which is the whole point:
 *
 *   DISCOVERY_RECONSTRUCTS_NEED_FROM_CHAT_HISTORY = NO
 */
export async function hardConstraintsForDiscovery(input: {
  conversationId: string;
  scopeId: string;
}): Promise<readonly GoalConstraint[]> {
  const row = await currentNeed(input);
  if (!row) return [];
  return evaluateGoalSpec(specOf(row)).hardConstraints;
}
