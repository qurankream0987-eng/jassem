/**
 * JASIM Compensation Policy — truthful recovery from partial failure.
 *
 * ─── THE QUESTION THIS ANSWERS ──────────────────────────────────────────────
 *
 * When a verified real-world effect already happened and the larger goal later
 * cannot complete, what is the truthful and authorized recovery behaviour?
 *
 * Traced before designing, on the live path: a run whose nodes A and B complete
 * VERIFIED and whose node C fails definitively ends as
 *
 *     run.status = failed   ·   receipt = failed   ·   compensation events = 0
 *
 * That is truthful about the GOAL and silent about the EFFECTS. Two verified
 * effects still stand in the world and nothing records that, asks whether they
 * should be undone, or says they could not be.
 *
 * ─── WHAT COMPENSATION IS NOT ───────────────────────────────────────────────
 *
 * It is not a database rollback and it does not delete history.
 *
 *     ORIGINAL_EFFECT_VERIFIED stays historically true, forever, even after it
 *     is compensated.
 *
 * A captured payment is a fact. A refund is a SECOND fact. The runtime never
 * mutates the first into "never happened" — `payouts`/`paymentIntents` already
 * work this way and this module is built to agree with them, not to replace
 * them. Where a generic rule and a financial rule conflict, the financial rule
 * wins.
 *
 * And it is not an inverse operation. You cannot unsend a message by changing a
 * row. The compensation for a sent message is a *correction* message — a new
 * effect with its own truth — which is why this module talks about
 * COMPENSATION rather than UNDO throughout.
 *
 * ─── COMPENSATION IS ITSELF AN EFFECT ───────────────────────────────────────
 *
 * The load-bearing invariant. A compensation runs as an ordinary DAG node in a
 * linked compensation Run, so it gets — with no new infrastructure — an
 * immutable attempt, an idempotency key, a fenced lease, the completion policy,
 * independent verification and a receipt.
 *
 *     COMPENSATION_REQUESTED != COMPENSATION_EXECUTED != COMPENSATION_VERIFIED
 *
 * A provider returning HTTP 200 to a DELETE has not proven the resource is
 * gone, for exactly the reason a provider returning 200 to a POST has not
 * proven it was created. The same policy decides both.
 *
 * ─── WHY THERE IS NO `REVERSIBLE` MEMBER ────────────────────────────────────
 *
 * The brief lists REVERSIBLE and COMPENSATABLE as separate classes. They are
 * not, in this runtime: both produce a NEW effect that must be independently
 * verified, so they would drive identical decisions. A taxonomy member that
 * changes no behaviour is taxonomy for its own sake.
 *
 * What genuinely differs is captured by fields that already have to exist:
 * whether recovery needs its own authority (`requiresApproval`), how the
 * compensating effect is confirmed (its own capability's effect contract), and
 * whether full recovery is achievable at all — which is the one real axis, and
 * the four values below are exactly it.
 */

import type { EffectKind } from "./completion-policy";

// ─────────────────────────────────────────────────────────────────────────────
// The taxonomy — four values, each producing a different runtime decision
// ─────────────────────────────────────────────────────────────────────────────

export type Reversibility =
  /** No external effect occurred. Nothing to recover. → SKIP */
  | "NO_COMPENSATION_REQUIRED"
  /** A new effect can fully offset it. → COMPENSATE, recovery can complete */
  | "COMPENSATABLE"
  /** Something can be offset and something cannot. → COMPENSATE, and the run
   *  remains RECOVERY_INCOMPLETE even when the compensation verifies */
  | "PARTIALLY_COMPENSATABLE"
  /** Nothing can offset it. → never attempted; a person is told the truth */
  | "IRREVERSIBLE";

export type CompensationDecision =
  | "SKIP"
  | "COMPENSATE"
  | "APPROVAL_REQUIRED"
  | "MANUAL_INTERVENTION_REQUIRED";

export type CompensationReasonCode =
  | "NO_EFFECT_OCCURRED"
  | "EFFECT_NOT_VERIFIED"
  | "EFFECT_UNCERTAIN_COMPENSATION_UNSAFE"
  | "COMPENSATION_AVAILABLE"
  | "COMPENSATION_PARTIAL_ONLY"
  | "COMPENSATION_REQUIRES_APPROVAL"
  | "EFFECT_IRREVERSIBLE"
  | "NO_COMPENSATION_CAPABILITY_REGISTERED";

/** Context handed to a policy when deriving the compensating action's inputs. */
export type CompensationContext = {
  ownerId: string;
  /** The run whose failure triggered recovery. */
  sourceRunId: string;
  sourceNodeKey: string;
  sourceAttemptId: string;
  /** The original capability's canonical result payload. */
  sourceResult: Record<string, unknown> | null;
  /** The original inputs, so a compensation can address the same subject. */
  sourceInputs: Record<string, unknown>;
};

export type CompensationPolicy = {
  reversibility: Reversibility;
  /**
   * The capability that PERFORMS the recovery. It is an ordinary capability
   * with its own effect class and its own verification — never a special
   * "undo" path.
   */
  compensationCapabilityId?: string;
  /**
   * Whether recovery needs authority of its own.
   *
   * Authority does NOT carry over from the original action, and the asymmetry
   * is the reason this field exists: an action costing 5 may carry a
   * cancellation penalty of 200. Having been allowed to do the cheap thing is
   * not consent to the expensive one.
   */
  requiresApproval?: boolean;
  /** What remains unresolved even on success. Required for PARTIALLY_*. */
  residualNote?: string;
  /** Build the compensating action's inputs from the original effect. */
  deriveInputs?: (context: CompensationContext) => Record<string, unknown> | undefined;
};

/** The default for anything that has not declared one: fail closed. */
export const DEFAULT_COMPENSATION_POLICY: CompensationPolicy = {
  reversibility: "IRREVERSIBLE",
};

/**
 * Resolve a policy for a capability whose effect class is known.
 *
 * A `NONE`-effect capability never needs compensation whatever it declares —
 * there is no effect to offset — and an effectful capability that declares
 * nothing is IRREVERSIBLE, so forgetting produces a truthful "a person must
 * look at this" rather than a silent skip.
 */
export function resolveCompensationPolicy(
  effectKind: EffectKind,
  declared?: CompensationPolicy,
): CompensationPolicy {
  if (effectKind === "NONE") return { reversibility: "NO_COMPENSATION_REQUIRED" };
  return declared ?? DEFAULT_COMPENSATION_POLICY;
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning
// ─────────────────────────────────────────────────────────────────────────────

/** One executed step of the failed run, as the ledger recorded it. */
export type ExecutedStep = {
  nodeKey: string;
  capabilityId: string;
  /** Upstream node keys from the original DAG. */
  dependsOn: readonly string[];
  effectKind: EffectKind;
  /** The newest attempt's verdict. */
  verificationStatus: "VERIFIED" | "PENDING" | "INCONCLUSIVE" | "FAILED" | "PENDING_NONE";
  attemptId: string;
  result: Record<string, unknown> | null;
  inputs: Record<string, unknown>;
  policy: CompensationPolicy;
};

export type CompensationRequirement = {
  sourceNodeKey: string;
  sourceAttemptId: string;
  sourceCapabilityId: string;
  effectKind: EffectKind;
  reversibility: Reversibility;
  decision: CompensationDecision;
  reasonCode: CompensationReasonCode;
  /** Position in safe execution order. Lower runs first. */
  order: number;
  compensationCapabilityId?: string;
  compensationInputs?: Record<string, unknown>;
  requiresApproval: boolean;
  residualNote?: string;
  notes: readonly string[];
};

export type CompensationPlan = {
  requirements: readonly CompensationRequirement[];
  /** Requirements that will actually execute, already in safe order. */
  executable: readonly CompensationRequirement[];
  /** Effects that occurred and cannot be recovered by the runtime. */
  manualInterventionRequired: readonly CompensationRequirement[];
  /** True when at least one recovered effect leaves a residue. */
  residualRemains: boolean;
};

/**
 * Safe compensation order, derived from the original DAG rather than assumed.
 *
 * The rule is reverse topological order: if B consumed A's output, B's effect
 * must be offset before A's, or the world briefly holds a B that depends on an
 * A that has been withdrawn. Plain "reverse of execution order" happens to
 * agree on a linear chain and disagrees on a diamond, which is why this reads
 * the dependency edges instead.
 */
export function safeCompensationOrder(steps: readonly ExecutedStep[]): readonly string[] {
  const byKey = new Map(steps.map((step) => [step.nodeKey, step]));
  const visited = new Set<string>();
  const order: string[] = [];

  // Topological order of the original graph.
  const visit = (key: string, stack: Set<string>): void => {
    if (visited.has(key)) return;
    if (stack.has(key)) return; // a cycle cannot exist here; the DAG rejects them
    stack.add(key);
    for (const upstream of byKey.get(key)?.dependsOn ?? []) {
      if (byKey.has(upstream)) visit(upstream, stack);
    }
    stack.delete(key);
    visited.add(key);
    order.push(key);
  };
  for (const step of steps) visit(step.nodeKey, new Set());

  return order.reverse();
}

export function planCompensation(input: {
  steps: readonly ExecutedStep[];
  context: Omit<CompensationContext, "sourceNodeKey" | "sourceAttemptId" | "sourceResult" | "sourceInputs">;
}): CompensationPlan {
  const order = safeCompensationOrder(input.steps);
  const position = new Map(order.map((key, index) => [key, index]));
  const requirements: CompensationRequirement[] = [];

  for (const step of input.steps) {
    const policy = step.policy;
    const base = {
      sourceNodeKey: step.nodeKey,
      sourceAttemptId: step.attemptId,
      sourceCapabilityId: step.capabilityId,
      effectKind: step.effectKind,
      reversibility: policy.reversibility,
      order: position.get(step.nodeKey) ?? 0,
      requiresApproval: policy.requiresApproval === true,
    };

    // ── Nothing happened ───────────────────────────────────────────────────
    if (step.effectKind === "NONE" || policy.reversibility === "NO_COMPENSATION_REQUIRED") {
      requirements.push({
        ...base,
        decision: "SKIP",
        reasonCode: "NO_EFFECT_OCCURRED",
        notes: ["This step has no external effect, so there is nothing to offset."],
      });
      continue;
    }

    // ── The effect is uncertain ────────────────────────────────────────────
    //
    // The sharpest case, and the one a naive implementation gets wrong.
    // Compensating an effect that MAY not have occurred can itself cause harm:
    // refunding a payment that never captured, cancelling a booking that was
    // never made. Uncertainty forbids compensation exactly as it forbids
    // retry — the same rule, from the other side.
    if (step.verificationStatus === "INCONCLUSIVE") {
      requirements.push({
        ...base,
        decision: "MANUAL_INTERVENTION_REQUIRED",
        reasonCode: "EFFECT_UNCERTAIN_COMPENSATION_UNSAFE",
        notes: [
          "The original effect is uncertain. Compensating an effect that may not have occurred can cause a second, opposite error; reconciliation must resolve it first.",
        ],
      });
      continue;
    }

    // ── The effect did not occur ───────────────────────────────────────────
    if (step.verificationStatus === "FAILED" || step.verificationStatus === "PENDING_NONE") {
      requirements.push({
        ...base,
        decision: "SKIP",
        reasonCode: "EFFECT_NOT_VERIFIED",
        notes: ["No verified effect occurred at this step."],
      });
      continue;
    }

    // A PENDING effect is executed-but-unconfirmed: the same hazard as
    // INCONCLUSIVE, so it gets the same refusal rather than an optimistic one.
    if (step.verificationStatus === "PENDING") {
      requirements.push({
        ...base,
        decision: "MANUAL_INTERVENTION_REQUIRED",
        reasonCode: "EFFECT_UNCERTAIN_COMPENSATION_UNSAFE",
        notes: [
          "The original effect executed but was never confirmed, so it is not safe to assume it happened or that it did not.",
        ],
      });
      continue;
    }

    // ── A verified effect that cannot be recovered ─────────────────────────
    if (policy.reversibility === "IRREVERSIBLE") {
      requirements.push({
        ...base,
        decision: "MANUAL_INTERVENTION_REQUIRED",
        reasonCode: "EFFECT_IRREVERSIBLE",
        notes: ["This effect occurred and the runtime has no way to offset it."],
      });
      continue;
    }

    if (!policy.compensationCapabilityId) {
      requirements.push({
        ...base,
        decision: "MANUAL_INTERVENTION_REQUIRED",
        reasonCode: "NO_COMPENSATION_CAPABILITY_REGISTERED",
        notes: ["The policy allows recovery but names no capability to perform it."],
      });
      continue;
    }

    const inputs = policy.deriveInputs?.({
      ...input.context,
      sourceNodeKey: step.nodeKey,
      sourceAttemptId: step.attemptId,
      sourceResult: step.result,
      sourceInputs: step.inputs,
    });
    if (!inputs) {
      requirements.push({
        ...base,
        decision: "MANUAL_INTERVENTION_REQUIRED",
        reasonCode: "NO_COMPENSATION_CAPABILITY_REGISTERED",
        notes: ["The compensating action could not be derived from the recorded effect."],
      });
      continue;
    }

    const partial = policy.reversibility === "PARTIALLY_COMPENSATABLE";
    requirements.push({
      ...base,
      decision: base.requiresApproval ? "APPROVAL_REQUIRED" : "COMPENSATE",
      reasonCode: base.requiresApproval
        ? "COMPENSATION_REQUIRES_APPROVAL"
        : partial
          ? "COMPENSATION_PARTIAL_ONLY"
          : "COMPENSATION_AVAILABLE",
      compensationCapabilityId: policy.compensationCapabilityId,
      compensationInputs: inputs,
      ...(policy.residualNote ? { residualNote: policy.residualNote } : {}),
      notes: partial
        ? [
            "Recovery offsets part of this effect. The run stays incomplete even when the compensation verifies.",
            ...(policy.residualNote ? [policy.residualNote] : []),
          ]
        : ["A compensating effect is available and will be verified independently."],
    });
  }

  const executable = requirements
    .filter((requirement) => requirement.decision === "COMPENSATE")
    .sort((a, b) => a.order - b.order);

  return {
    requirements,
    executable,
    manualInterventionRequired: requirements.filter(
      (requirement) => requirement.decision === "MANUAL_INTERVENTION_REQUIRED",
    ),
    residualRemains: requirements.some(
      (requirement) =>
        requirement.reversibility === "PARTIALLY_COMPENSATABLE" &&
        requirement.decision !== "SKIP",
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcome
// ─────────────────────────────────────────────────────────────────────────────

export type RecoveryOutcome =
  | "RECOVERY_NOT_REQUIRED"
  | "RECOVERY_COMPLETE"
  | "RECOVERY_INCOMPLETE"
  | "RECOVERY_FAILED"
  | "MANUAL_INTERVENTION_REQUIRED";

/**
 * Fold the compensation run's own verdicts into one truthful outcome.
 *
 * The forward history is never collapsed: a step that was VERIFIED stays
 * VERIFIED in the ledger whatever happens here. This answers only "what became
 * of the recovery", which is a separate question with a separate answer.
 */
export function recoveryOutcome(input: {
  plan: CompensationPlan;
  /** Verification status of each executed compensation, by source node key. */
  compensationVerdicts: ReadonlyMap<string, "VERIFIED" | "PENDING" | "INCONCLUSIVE" | "FAILED">;
}): { outcome: RecoveryOutcome; unresolved: readonly string[]; notes: readonly string[] } {
  const { plan, compensationVerdicts } = input;
  const notes: string[] = [];
  const unresolved: string[] = [];

  for (const requirement of plan.manualInterventionRequired) {
    unresolved.push(`${requirement.sourceNodeKey}: ${requirement.reasonCode}`);
  }

  let anyFailed = false;
  let anyUnconfirmed = false;
  for (const requirement of plan.executable) {
    const verdict = compensationVerdicts.get(requirement.sourceNodeKey);
    if (verdict === "VERIFIED") continue;
    if (verdict === "FAILED") {
      anyFailed = true;
      unresolved.push(`${requirement.sourceNodeKey}: COMPENSATION_FAILED`);
      continue;
    }
    anyUnconfirmed = true;
    unresolved.push(`${requirement.sourceNodeKey}: COMPENSATION_${verdict ?? "NOT_RUN"}`);
  }

  if (plan.requirements.every((requirement) => requirement.decision === "SKIP")) {
    return { outcome: "RECOVERY_NOT_REQUIRED", unresolved: [], notes: [] };
  }
  if (plan.manualInterventionRequired.length > 0) {
    notes.push("At least one effect occurred that the runtime cannot offset.");
    return { outcome: "MANUAL_INTERVENTION_REQUIRED", unresolved, notes };
  }
  if (anyFailed) {
    notes.push("A compensation was attempted and definitively failed. The original effect still stands.");
    return { outcome: "RECOVERY_FAILED", unresolved, notes };
  }
  if (anyUnconfirmed) {
    notes.push("A compensation ran and was not independently confirmed.");
    return { outcome: "RECOVERY_INCOMPLETE", unresolved, notes };
  }
  if (plan.residualRemains) {
    notes.push("Every compensation verified, and part of the original effect cannot be offset.");
    return { outcome: "RECOVERY_INCOMPLETE", unresolved, notes };
  }
  return { outcome: "RECOVERY_COMPLETE", unresolved: [], notes: [] };
}

/**
 * Keys a model, client or provider may never assert about recovery.
 *
 * Each one is an attempt to end the recovery conversation by declaring it over.
 */
export const COMPENSATION_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "compensationcomplete",
  "refundcomplete",
  "effectreversed",
  "ignorepreviouseffect",
  "skipcompensation",
  "policyoverride",
  "compensated",
  "reversed",
  "rolledback",
]);
