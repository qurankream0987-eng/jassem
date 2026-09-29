/**
 * Asking the system that owns an effect what became of it.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────
 *
 * JASIM refuses to retry an effect it is not sure about. That refusal is
 * correct and it is proven — `BLIND_RETRY = 0` holds across the corpus. But a
 * refusal is only half of an answer. Traced on the live path before this file
 * was written:
 *
 *   findUncertainExecutionAttempts   → 0 callers, anywhere, including tests
 *   reconcileUncertainAttempt        → 0 production callers
 *   a capability declaring a lookup  → impossible; `lookup` was a parameter
 *
 * So an uncertain effect stayed uncertain forever, and nothing in the runtime
 * could ever ask. The one path that can carry an effect to VERIFIED through
 * INDEPENDENT_READBACK was unreachable from anything JASIM does on its own.
 *
 *   UNCERTAIN_FOREVER = 0
 *
 * Not knowing is honest. Having no way to find out is not.
 *
 * ── THE LAWS THIS FILE ENFORCES ──────────────────────────────────────────────
 *
 *   LOOKUP_AUTHORITY_IS_THE_EFFECT_OWNING_SYSTEM
 *     Asking is only worth something when the thing answering is the system
 *     the effect happened in. Extends
 *     OBSERVATION_AUTHORITY MUST MATCH OBSERVATION_SUBJECT.
 *
 *   EXECUTOR_RETURN != INDEPENDENT_READBACK
 *     Before this file, the assertion built from a lookup took its authority
 *     from `attempt.providerReference` — the executor's OWN return value — or,
 *     failing that, from the capability id, which is the executor itself. An
 *     "independent" readback whose authority is named by the claim under
 *     examination is the conflation this whole layer exists to break.
 *
 *   NO_ANSWER != NOT_OCCURRED
 *     Before this file the answer shape was `occurred | not_occurred`, so an
 *     authority that could not tell had to say "it did not happen" — and the
 *     runtime wrote FAILED. That is a manufactured false failure. UNKNOWN is a
 *     first-class answer here and it leaves the attempt uncertain.
 *
 *   OCCURRED_WITHOUT_A_REFERENCE = 0
 *     An authority that says "yes, it happened" and cannot name WHAT happened
 *     is repeating the claim, not confirming it. The type makes it impossible:
 *     `OCCURRED` carries a `reference` and an `authority` or it does not
 *     compile.
 *
 *   CONFIRMED_WITHOUT_A_RECORD = 0
 *     Found while proving this file: an OCCURRED answer carrying no record
 *     produced an empty canonical payload, the output half of the verifier
 *     read OUTPUT_SHAPE_NOT_VALID, and the effect stayed INCONCLUSIVE — the
 *     same "uncertain forever" one layer down, and silent. `result` is
 *     therefore required too. A system that confirms an effect can say what it
 *     now holds about it; one that cannot is answering UNKNOWN.
 *
 *   LOOKUP != RETRY
 *     Asking what happened must never cause it to happen. Registration refuses
 *     a capability whose lookup is its own executor.
 *
 *   MODEL_SUPPLIES_A_LOOKUP = 0
 *     A lookup is trusted server code, registered by a person, exactly like
 *     `resolveEffect`. Nothing on a request path nominates one.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 *
 * There is no ShippingReconciler, no PaymentReconciler and no
 * WarehouseReconciler. A lookup is one function on a capability that already
 * exists, in the same trusted registration that already declares
 * `effectKind`, `effectEvidenceSource` and `compensation`.
 *
 *   DOMAIN_RECONCILERS_ADDED = 0
 */

/** What an attempt is, as far as the system being asked is concerned. */
export type ReconciliationSubject = {
  readonly attemptId: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly capabilityId: string;
  /**
   * The reference the EXECUTOR returned. Handed over so the owning system can
   * be asked about the right row — never so it can be quoted back as the
   * authority that answered.
   */
  readonly providerReference: string | null;
  readonly idempotencyKey: string | null;
};

/**
 * What the owning system said.
 *
 * `authority` NAMES THE SYSTEM, not the row: «stripe», «the warehouse ERP»,
 * «the hospital scheduler». `reference` names the row inside it.
 */
export type ReconciliationAnswer =
  | {
      readonly outcome: "OCCURRED";
      readonly authority: string;
      readonly reference: string;
      /**
       * What the owning system now holds about the effect. Required: see
       * CONFIRMED_WITHOUT_A_RECORD = 0 above. An EMPTY record still fails the
       * verifier's output half, loudly and by its own rule, rather than being
       * padded here into something that looks like a record.
       */
      readonly result: Record<string, unknown>;
      readonly notes?: readonly string[];
    }
  | {
      readonly outcome: "NOT_OCCURRED";
      readonly authority: string;
      readonly notes?: readonly string[];
    }
  | {
      /** Asked, and it could not say. The truthful answer, and not a failure. */
      readonly outcome: "UNKNOWN";
      readonly notes?: readonly string[];
    };

export type ReconciliationLookup = (
  subject: ReconciliationSubject,
) => Promise<ReconciliationAnswer>;

/** The authority recorded when nobody could answer. Never a capability id. */
export const NO_ANSWERING_AUTHORITY = "reconciliation-lookup";

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Is the thing that answered actually independent of the thing that claimed?
 *
 * Three ways it is not, and each was reachable before this function existed:
 *
 *   1. It named nothing at all.
 *   2. It named the capability — the executor answering about itself.
 *   3. It named the executor's own returned reference, which is the claim
 *      under examination wearing the authority's clothes.
 *
 * A non-independent answer is not discarded. It is recorded as SELF_REPORTED,
 * which no effectful completion policy accepts — so the effect stays
 * unverified and says why, rather than being quietly promoted.
 */
export function answerIsIndependent(
  answer: ReconciliationAnswer,
  subject: ReconciliationSubject,
): boolean {
  if (answer.outcome === "UNKNOWN") return false;
  const authority = normalize(answer.authority);
  if (authority.length === 0) return false;
  if (authority === normalize(subject.capabilityId)) return false;
  if (subject.providerReference && authority === normalize(subject.providerReference)) {
    return false;
  }
  return true;
}

export class ReconciliationLookupError extends Error {
  override name = "ReconciliationLookupError";
}

/**
 * The registration-time guard for LOOKUP != RETRY.
 *
 * A lookup that IS the executor would make every reconciliation pass a second
 * execution — the precise thing `BLIND_RETRY = 0` forbids, arrived at from the
 * one direction nobody would be watching.
 */
export function assertLookupIsNotTheExecutor(
  capabilityId: string,
  lookup: unknown,
  execute: unknown,
): void {
  if (lookup !== undefined && lookup === execute) {
    throw new ReconciliationLookupError(
      `Capability «${capabilityId}» declares its own executor as its reconciliation lookup. Asking what happened must never cause it to happen.`,
    );
  }
}
