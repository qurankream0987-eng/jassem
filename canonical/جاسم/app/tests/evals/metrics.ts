/**
 * JASIM EVALUATION — the metric registry.
 *
 * Every metric in the brief appears here exactly once, with an honest
 * availability class. A metric that cannot be measured today is listed and
 * marked, not quietly computed from something adjacent — a benchmark whose
 * numbers come from a proxy is worse than one with holes, because the holes
 * are visible.
 *
 * ─── WHY AVAILABILITY IS A FIELD AND NOT A COMMENT ──────────────────────────
 *
 * `baseline.test.ts` prints the availability class beside every number. A
 * reader can therefore tell, without trusting the prose, which figures are
 * real measurements and which are structurally zero because the thing they
 * measure does not exist yet. `REPLAN_SUCCESS_RATE = 0` means "there is no
 * replanning", not "replanning always fails", and the class is what says so.
 */

export type MetricAvailability =
  /** Computable now, offline, with no model and no external provider. */
  | "MEASURABLE_NOW"
  /** Needs a model to produce the artefact being measured. */
  | "MEASURABLE_AFTER_MODEL_PROVIDER"
  /** Needs a real external provider (search, payment, device). */
  | "MEASURABLE_AFTER_REAL_PROVIDER"
  /** The mechanism being measured does not exist yet. */
  | "FUTURE";

export type MetricKind =
  /** Computed from canonical rows by code. No judgement involved. */
  | "DETERMINISTIC"
  /** Requires a semantic judgement a deterministic check cannot make. */
  | "MODEL_JUDGED";

export type MetricDirection = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER" | "MUST_BE_ZERO";

export type MetricDefinition = {
  id: string;
  /** What it counts, precisely enough to reimplement. */
  definition: string;
  kind: MetricKind;
  availability: MetricAvailability;
  direction: MetricDirection;
  /** The canonical evidence it is computed from. Empty means "not yet". */
  evidence: readonly string[];
  /** Why it is not measurable yet, when it is not. */
  blocker?: string;
};

/**
 * A model judge may never be the sole authority for these. The brief states it;
 * this array is the enforceable form, asserted in `metrics.test.ts`.
 */
export const DETERMINISTIC_ONLY_DOMAINS = [
  "security",
  "payments",
  "execution truth",
  "authorization",
  "effect verification",
] as const;

export const METRICS: readonly MetricDefinition[] = [
  // ── Understanding ────────────────────────────────────────────────────────
  {
    id: "GOAL_UNDERSTANDING_ACCURACY",
    definition:
      "Fraction of scenarios whose produced intent envelope names the expected generic capability class and persistence level.",
    kind: "MODEL_JUDGED",
    availability: "MEASURABLE_AFTER_MODEL_PROVIDER",
    direction: "HIGHER_IS_BETTER",
    evidence: ["messages.metadata", "execution_proposals.capabilityId", "runs.currentState"],
    blocker: "The intent envelope is produced by the model gateway; no provider is configured.",
  },
  {
    id: "CONSTRAINT_COMPLIANCE",
    definition:
      "Fraction of declared HARD constraints that the produced plan structurally satisfies, measured before execution.",
    kind: "DETERMINISTIC",
    availability: "FUTURE",
    direction: "HIGHER_IS_BETTER",
    evidence: [],
    blocker:
      "There is no typed constraint. GoalSpec does not exist, so a constraint has nowhere to live and nothing to check it against. Discovery's hardConstraints are the only typed constraints today and cover one stage.",
  },
  {
    id: "AMBIGUITY_HANDLING_ACCURACY",
    definition:
      "Fraction of genuinely ambiguous scenarios answered with CHOICE rather than an arbitrary selection.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "HIGHER_IS_BETTER",
    evidence: ["reference resolution status", "decidePresentation output kind"],
  },

  // ── References ───────────────────────────────────────────────────────────
  {
    id: "REFERENCE_RESOLUTION_ACCURACY",
    definition:
      "Fraction of scenarios whose reference resolution status equals the expected status (resolved / ambiguous / unresolved / not_requested).",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "HIGHER_IS_BETTER",
    evidence: ["resolveRuntimeReferences", "reference_bindings"],
  },

  // ── Selection ────────────────────────────────────────────────────────────
  {
    id: "CAPABILITY_SELECTION_ACCURACY",
    definition:
      "Fraction of scenarios whose authorized proposals carry the expected capability ids.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_AFTER_MODEL_PROVIDER",
    direction: "HIGHER_IS_BETTER",
    evidence: ["execution_proposals.capabilityId"],
    blocker: "The capability list comes from the model's intent envelope.",
  },
  {
    id: "PROVIDER_SELECTION_ACCURACY",
    definition:
      "Fraction of executed attempts whose recorded provider equals the one the deterministic resolution cascade should select for that capability and policy.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "HIGHER_IS_BETTER",
    evidence: ["execution_attempts.provider", "resolveProvider"],
  },

  // ── Authority ────────────────────────────────────────────────────────────
  {
    id: "AUTHORITY_COMPLIANCE",
    definition:
      "Count of turns in which a model output asserted ownership, verification or authorization and the runtime accepted it. Must be zero.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "MUST_BE_ZERO",
    evidence: ["model-output-trust AUTHORITY_KEYS", "EFFECT_AUTHORITY_KEYS", "security_events"],
  },
  {
    id: "APPROVAL_CORRECTNESS",
    definition:
      "Fraction of scenarios where approvalRequired on the proposal matches the scenario's declared expectation, and no execution occurred without a consumed approval when one was required.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "HIGHER_IS_BETTER",
    evidence: ["execution_proposals.approvalRequired", "proposal_approvals.consumedAt"],
  },

  // ── Execution and truth ──────────────────────────────────────────────────
  {
    id: "EXECUTION_SUCCESS_RATE",
    definition:
      "Fraction of attempted DAG nodes reaching executionStatus COMPLETED. Deliberately NOT a quality metric — an execution can complete and still not verify.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "HIGHER_IS_BETTER",
    evidence: ["execution_attempts.executionStatus"],
  },
  {
    id: "VERIFICATION_ACCURACY",
    definition:
      "Fraction of scenarios whose final verificationStatus equals the scenario's expected verification state.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "HIGHER_IS_BETTER",
    evidence: ["execution_attempts.verificationStatus", "verificationDetail.completion"],
  },
  {
    id: "FALSE_SUCCESS_RATE",
    definition:
      "Fraction of attempts reported VERIFIED whose effect was NOT confirmed by a source the completion policy accepts. The headline metric.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "MUST_BE_ZERO",
    evidence: ["execution_attempts.verificationDetail.completion.confirmedBy", "COMPLETION_POLICIES"],
  },
  {
    id: "FALSE_FAILURE_RATE",
    definition:
      "Fraction of attempts reported FAILED whose effect a later readback shows did occur. The mirror of false success, and the reason FAILED is retryable while INCONCLUSIVE is not.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_AFTER_REAL_PROVIDER",
    direction: "MUST_BE_ZERO",
    evidence: ["execution_attempts.verificationDetail", "reconciliation lookups"],
    blocker:
      "Detecting a false failure requires a readback that contradicts the recorded failure, and no UncertainAttemptLookup is registered against a real authority.",
  },
  {
    id: "INCONCLUSIVE_CORRECTNESS",
    definition:
      "Fraction of genuinely uncertain effects recorded as INCONCLUSIVE rather than collapsed to FAILED or VERIFIED.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "HIGHER_IS_BETTER",
    evidence: ["decideCompletion reasonCode", "execution_attempts.verificationStatus"],
  },
  {
    id: "BLIND_RETRY_RATE",
    definition:
      "Count of retries issued against an attempt whose effect was INCONCLUSIVE. Must be zero — repeating something that may already have taken effect is the one forbidden recovery.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "MUST_BE_ZERO",
    evidence: ["completion policy onUncertain", "mayRetryAfter", "dag_nodes.attemptCount"],
  },

  // ── Recovery ─────────────────────────────────────────────────────────────
  {
    id: "REPLAN_SUCCESS_RATE",
    definition:
      "Fraction of failed nodes whose replan produced a plan that then completed.",
    kind: "DETERMINISTIC",
    availability: "FUTURE",
    direction: "HIGHER_IS_BETTER",
    evidence: [],
    blocker:
      "There is no replanning on the live path. A value of 0 here means the mechanism is absent, not that it fails.",
  },
  {
    id: "USER_INTERVENTION_RATE",
    definition:
      "Fraction of scenarios requiring a user turn beyond the initial utterance to reach a terminal state.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_AFTER_MODEL_PROVIDER",
    direction: "LOWER_IS_BETTER",
    evidence: ["messages", "runs.status awaiting_input"],
    blocker: "Requires a model to produce the turns being counted.",
  },

  // ── Cost and latency ─────────────────────────────────────────────────────
  {
    id: "MODEL_CALL_COUNT",
    definition:
      "Model calls per scenario, from the reserve-before-spend budget and the usage ledger. Offline this is structurally 0.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "LOWER_IS_BETTER",
    evidence: ["model_usage_ledger", "ModelCallBudget"],
  },
  {
    id: "MODEL_TOKEN_COST",
    definition: "Input+output tokens and their costed total per scenario.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_AFTER_MODEL_PROVIDER",
    direction: "LOWER_IS_BETTER",
    evidence: ["model_usage_ledger"],
    blocker: "No model calls occur offline, so there is nothing to cost.",
  },
  {
    id: "PROVIDER_COST",
    definition:
      "Cost charged by non-model providers, kept separate from model cost and from the payment ledger.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_AFTER_REAL_PROVIDER",
    direction: "LOWER_IS_BETTER",
    evidence: [],
    blocker:
      "No provider cost ledger exists. Model cost, provider cost, the payment ledger and JASIM's own economics are four separate things and only the first is recorded.",
  },
  {
    id: "END_TO_END_LATENCY",
    definition:
      "Wall-clock from the user message row to the terminal run state, and the runtime-only portion excluding provider waits.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "LOWER_IS_BETTER",
    evidence: ["messages.createdAt", "runs.updatedAt", "execution_attempts.startedAt/finishedAt"],
  },

  // ── Generality ───────────────────────────────────────────────────────────
  {
    id: "DOMAIN_SPECIFIC_PATCH_COUNT",
    definition:
      "Count of scenarios whose observed pass requirement is DOMAIN_SPECIFIC_CORE, plus any domain noun appearing in runtime core modules. Must be zero.",
    kind: "DETERMINISTIC",
    availability: "MEASURABLE_NOW",
    direction: "MUST_BE_ZERO",
    evidence: ["ScenarioResult.observedRequirement", "static scan of api/runtime"],
  },
] as const;

export function metric(id: string): MetricDefinition {
  const found = METRICS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown metric ${id}`);
  return found;
}

export function metricsByAvailability(availability: MetricAvailability): readonly MetricDefinition[] {
  return METRICS.filter((entry) => entry.availability === availability);
}
