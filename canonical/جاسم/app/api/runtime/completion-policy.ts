/**
 * JASIM Completion Policy — generic effect verification.
 *
 * ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * `execution-verifier.ts` judges whether an execution attempt produced a VALID
 * OUTPUT. It does not, and cannot, judge whether the EFFECT the step described
 * actually happened in the world. Before this module those two questions had
 * one answer, so:
 *
 *   a notification whose own state was QUEUED            → VERIFIED
 *   a notification whose own state was FAILED            → VERIFIED
 *   a notification whose own state was BLOCKED_BY_PROVIDER → VERIFIED
 *   an unknown capability returning `{ anything: "at all" }` → VERIFIED
 *
 * All four were reachable on the live path, and all four are measured in
 * `tests/unit/completion-policy.test.ts`. The cause is one line of the generic
 * branch of DATABASE_READBACK: "output non-empty" → VERIFIED. A non-empty
 * object is evidence that code ran. It is not evidence that anything occurred.
 *
 * The four distinctions, stated as this module states them:
 *
 *   PROVIDER_RESPONSE      != EFFECT_OCCURRED
 *   RECEIPT                != VERIFICATION
 *   EXECUTED               != VERIFIED
 *   VALID_OUTPUT_SHAPE     != REAL_WORLD_COMPLETION
 *
 * ─── WHY THERE IS NO NEW STATUS ─────────────────────────────────────────────
 *
 * "Executed but not yet verified" needs a name. It already had one:
 * `executionStatus = COMPLETED` with `verificationStatus = PENDING`. Both
 * values predate this module, `summarizeLatestVerification` already lets a
 * single PENDING attempt hold a whole run back from VERIFIED, `isVerifiedReceipt`
 * already refuses it, and the conversation already has truthful Arabic copy for
 * it («التحقق ما زال معلّقًا»). Adding a status would have been an
 * architecture change that bought nothing.
 *
 * This is the same shape as the payment model in `block3/payout.ts`, which is
 * the strongest truth model in the codebase and the one this module is built to
 * agree with: REQUESTED → EXECUTED (a bound provider receipt exists) → VERIFIED
 * (an independent authoritative readback agrees). A receipt moves a payout to
 * EXECUTED and never to VERIFIED. A receipt moves an attempt to PENDING here,
 * and never to VERIFIED, for exactly the same reason.
 *
 * ─── WHY IT IS GENERIC ──────────────────────────────────────────────────────
 *
 * There are no domain verifiers here and no room for one: nothing in this file
 * knows what a driver, a hotel, a scaffold or a truck is. A capability declares
 * WHAT CLASS OF EFFECT it has, and the policy for that class is fixed in
 * trusted server code. Adding a domain does not add a verifier.
 *
 * ─── THE TRUST SPLIT, WHICH IS THE WHOLE DESIGN ─────────────────────────────
 *
 * A capability's output is allowed to say WHAT HAPPENED (`effect.state`). It is
 * never allowed to say HOW MUCH THAT IS WORTH (`source`). The weight of a
 * capability's own word is fixed when the capability is REGISTERED — in code,
 * by a human — and a proposal, a model or a provider response cannot reach it.
 *
 * Without that split the layer would be theatre: any provider could return
 * `{ effect: { state: "OCCURRED", source: "INDEPENDENT_READBACK" } }` and
 * certify itself. `sanitizeEffectDeclaration` rejects exactly that.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The generic taxonomy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What class of effect a capability has on the world. Six kinds, chosen to
 * cover every execution shape the runtime actually has, and deliberately
 * describing the RELATIONSHIP between JASIM and the effect rather than any
 * subject matter.
 */
export type EffectKind =
  /** Pure computation or a read. The output IS the completion; there is nothing else to confirm. */
  | "NONE"
  /** Mutates JASIM's own durable state. JASIM is the authority, so its own readback is authoritative. */
  | "INTERNAL_STATE"
  /** Something leaves the system towards a recipient: a message, a notification, an alert. */
  | "MESSAGE_DISPATCH"
  /** A command is issued to a device or actuator that JASIM does not own. */
  | "DEVICE_COMMAND"
  /** A mutation in a remote system JASIM does not own: an API write, a booking, an order. */
  | "REMOTE_MUTATION"
  /** A human was asked to do something in the world, and a party reports on it. */
  | "HUMAN_ACTION";

/**
 * WHO says the effect occurred, ordered by how little it is worth.
 *
 * This is the axis that was missing. Everything the runtime had was
 * EXECUTOR_RETURN, and EXECUTOR_RETURN was treated as proof.
 */
export type EffectClaimSource =
  /** The capability's `execute` returned without throwing. Evidence that code ran. Nothing more. */
  | "EXECUTOR_RETURN"
  /** The acting party — a human, a remote agent, a provider — asserts it. Uncorroborated. */
  | "SELF_REPORTED"
  /** A receipt that cryptographically binds to this exact request. Strong, and still the provider's own claim. */
  | "BOUND_PROVIDER_RECEIPT"
  /** A re-read of JASIM's own durable state. Authoritative only where JASIM owns the effect. */
  | "INTERNAL_READBACK"
  /** A re-read from the authority that owns the effect, correlated to this request. */
  | "INDEPENDENT_READBACK"
  /** The owner states that the effect occurred. A human with standing, not an inference. */
  | "OWNER_CONFIRMATION";

/** The factual lifecycle of an effect. A capability's output may declare this. */
export type EffectState =
  /** It happened. */
  | "OCCURRED"
  /** It definitively did not happen, and will not without a new attempt. */
  | "NOT_OCCURRED"
  /** Accepted and in flight. Not yet an outcome. */
  | "PENDING"
  /** It may or may not have happened, and we cannot currently tell. */
  | "UNCERTAIN";

/** What the runtime should do with the attempt. */
export type CompletionDecision =
  /** Independent evidence confirms the effect. */
  | "VERIFIED"
  /** The step executed; the effect is not yet confirmed. Reconciliation must resolve it. */
  | "PENDING"
  /** The effect may have occurred. Blind retry is forbidden. */
  | "INCONCLUSIVE"
  /** The effect definitively did not occur. */
  | "FAILED";

/** Machine-readable reasons, so a caller never has to parse prose. */
export type CompletionReasonCode =
  | "NO_EFFECT_TO_VERIFY"
  | "EFFECT_CONFIRMED"
  | "EFFECT_DID_NOT_OCCUR"
  | "EFFECT_NOT_INDEPENDENTLY_CONFIRMED"
  | "EFFECT_CLAIM_SOURCE_INSUFFICIENT"
  | "EFFECT_STILL_IN_FLIGHT"
  | "EFFECT_UNCERTAIN_RECONCILIATION_REQUIRED"
  | "EFFECT_EVIDENCE_ABSENT"
  | "OUTPUT_SHAPE_NOT_VALID"
  | "EFFECT_DECLARATION_REJECTED";

/**
 * One party's assertion about one effect.
 *
 * `source` is supplied by the trusted call site, never lifted from a payload.
 */
export type EffectAssertion = {
  state: EffectState;
  source: EffectClaimSource;
  /** Correlation handle in the asserting authority's namespace. */
  reference?: string;
  /** Who is asserting — a provider id, a channel, `owner`. */
  authority?: string;
  notes?: readonly string[];
};

export type CompletionPolicy = {
  effectKind: EffectKind;
  /**
   * The sources that, on their own, are enough to call the effect verified.
   *
   * EXECUTOR_RETURN appears here for exactly one kind — NONE — and that single
   * fact is the closure of `PROVIDER_RESPONSE != EFFECT_OCCURRED`.
   */
  sufficientSources: readonly EffectClaimSource[];
  /**
   * What may happen to an attempt whose effect is UNCERTAIN.
   *
   * Every effectful kind is RECONCILE_ONLY, which is `payout.ts`'s rule —
   * "Uncertain payout requires reconciliation; blind retry forbidden" — stated
   * once for everything rather than once for money.
   */
  onUncertain: "RECONCILE_ONLY" | "RETRY_ALLOWED";
  /** Human-readable statement of what this kind needs. Reported, never parsed. */
  requirement: string;
};

/**
 * THE POLICY TABLE. Trusted server code, keyed by effect class.
 *
 * A bound provider receipt is deliberately absent from every
 * `sufficientSources` list. That is `RECEIPT != VERIFICATION`, and it is what
 * keeps this layer consistent with the payment model instead of quietly weaker
 * than it.
 */
export const COMPLETION_POLICIES: Readonly<Record<EffectKind, CompletionPolicy>> = Object.freeze({
  NONE: {
    effectKind: "NONE",
    sufficientSources: ["EXECUTOR_RETURN", "INTERNAL_READBACK", "INDEPENDENT_READBACK", "OWNER_CONFIRMATION"],
    onUncertain: "RETRY_ALLOWED",
    requirement: "A pure or read-only step is complete when its output is valid; there is no external effect to confirm.",
  },
  INTERNAL_STATE: {
    effectKind: "INTERNAL_STATE",
    sufficientSources: ["INTERNAL_READBACK", "INDEPENDENT_READBACK", "OWNER_CONFIRMATION"],
    onUncertain: "RECONCILE_ONLY",
    requirement: "JASIM owns this state, so a readback of JASIM's own durable record verifies it — but the executor's return value does not.",
  },
  MESSAGE_DISPATCH: {
    effectKind: "MESSAGE_DISPATCH",
    sufficientSources: ["INTERNAL_READBACK", "INDEPENDENT_READBACK", "OWNER_CONFIRMATION"],
    onUncertain: "RECONCILE_ONLY",
    requirement: "Dispatching is not delivering. The message's own lifecycle must have reached a terminal delivered state.",
  },
  DEVICE_COMMAND: {
    effectKind: "DEVICE_COMMAND",
    sufficientSources: ["INDEPENDENT_READBACK", "OWNER_CONFIRMATION"],
    onUncertain: "RECONCILE_ONLY",
    requirement: "A command accepted is not a command performed. The device's own state must be read back.",
  },
  REMOTE_MUTATION: {
    effectKind: "REMOTE_MUTATION",
    sufficientSources: ["INDEPENDENT_READBACK", "OWNER_CONFIRMATION"],
    onUncertain: "RECONCILE_ONLY",
    requirement: "Only the owning system can confirm its own mutation. A receipt binds the request; it does not verify the effect.",
  },
  HUMAN_ACTION: {
    effectKind: "HUMAN_ACTION",
    sufficientSources: ["INDEPENDENT_READBACK", "OWNER_CONFIRMATION"],
    onUncertain: "RECONCILE_ONLY",
    requirement: "A person saying they did it is a claim. Verification needs the owner's confirmation or an independent reading of the result.",
  },
});

export function completionPolicyFor(effectKind: EffectKind): CompletionPolicy {
  return COMPLETION_POLICIES[effectKind];
}

/**
 * The fail-closed bridge from the registry's existing `sideEffects` field.
 *
 * `"external"` with no declared `effectKind` resolves to REMOTE_MUTATION — the
 * strictest kind — so a capability that acquires a real effect and forgets to
 * say what class it is becomes harder to verify, not easier. Forgetting must
 * never be the permissive path.
 */
export function effectKindFromSideEffects(
  sideEffects: "none" | "local_test" | "external" | undefined,
  declared?: EffectKind,
): EffectKind {
  if (declared) return declared;
  return sideEffects === "external" ? "REMOTE_MUTATION" : "NONE";
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a capability's own declaration, without letting it grade itself
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keys a capability's output must never contain. Each one is an attempt to
 * assert authority rather than report a fact.
 */
export const EFFECT_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "source",
  "claimsource",
  "verified",
  "verification",
  "verificationstatus",
  "sufficientsources",
  "completiondecision",
]);

const EFFECT_STATES: ReadonlySet<string> = new Set<EffectState>([
  "OCCURRED",
  "NOT_OCCURRED",
  "PENDING",
  "UNCERTAIN",
]);

export type EffectDeclaration = {
  state: EffectState;
  reference?: string;
};

export type EffectDeclarationOutcome =
  | { ok: true; declaration: EffectDeclaration | undefined }
  | { ok: false; violation: string };

/**
 * Extract the `effect` block a capability may place in its canonical result.
 *
 * Accepted: `{ effect: { state, reference? } }` — a factual lifecycle value.
 * Rejected: any attempt to also declare the weight of that value.
 *
 * Rejection is a violation rather than a silent strip, because a payload
 * reaching for `source` is not a formatting mistake: something tried to
 * certify itself, and the run should say so out loud.
 */
export function sanitizeEffectDeclaration(
  result: Record<string, unknown> | null | undefined,
): EffectDeclarationOutcome {
  if (!result || typeof result !== "object") return { ok: true, declaration: undefined };
  const raw = (result as { effect?: unknown }).effect;
  if (raw === undefined || raw === null) return { ok: true, declaration: undefined };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, violation: "effect must be an object declaring a lifecycle state." };
  }

  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (EFFECT_AUTHORITY_KEYS.has(key.toLowerCase())) {
      return {
        ok: false,
        violation: `effect.${key} is an authority claim: a capability reports what happened, never how much its word is worth.`,
      };
    }
  }

  const state = record.state;
  if (typeof state !== "string" || !EFFECT_STATES.has(state)) {
    return {
      ok: false,
      violation: `effect.state must be one of ${[...EFFECT_STATES].join(", ")}.`,
    };
  }

  return {
    ok: true,
    declaration: {
      state: state as EffectState,
      ...(typeof record.reference === "string" && record.reference ? { reference: record.reference } : {}),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The decision
// ─────────────────────────────────────────────────────────────────────────────

export type CompletionEvaluation = {
  decision: CompletionDecision;
  reasonCode: CompletionReasonCode;
  effectKind: EffectKind;
  /** The strongest source that actually asserted OCCURRED, if any. */
  confirmedBy?: EffectClaimSource;
  /** What is still missing, when the decision is not VERIFIED. */
  missingEvidence?: readonly EffectClaimSource[];
  retryPermitted: boolean;
  notes: readonly string[];
};

/**
 * Decide whether an effect may be called verified.
 *
 * Order matters and is deliberate:
 *   1. An invalid output shape is not a completion of anything.
 *   2. A definitive NOT_OCCURRED from any source is believed — a party is
 *      always trusted to say its own effect failed. Trust is asymmetric:
 *      claiming failure costs the claimant, claiming success profits them.
 *   3. UNCERTAIN from any source blocks everything below it, because
 *      uncertainty is a finding, not an absence of one.
 *   4. OCCURRED counts only from a source this policy accepts.
 *   5. Anything else is executed-and-unconfirmed.
 */
export function decideCompletion(input: {
  policy: CompletionPolicy;
  /** The existing verifier's judgement of the output envelope. */
  outputShapeValid: boolean;
  assertions: readonly EffectAssertion[];
}): CompletionEvaluation {
  const { policy, assertions } = input;
  const notes: string[] = [];
  const retryPermitted = policy.onUncertain === "RETRY_ALLOWED";
  const base = { effectKind: policy.effectKind, retryPermitted };

  if (!input.outputShapeValid) {
    return {
      ...base,
      decision: "FAILED",
      reasonCode: "OUTPUT_SHAPE_NOT_VALID",
      notes: ["The output envelope is not valid, so no effect can be read from it."],
    };
  }

  if (policy.effectKind === "NONE") {
    return {
      ...base,
      decision: "VERIFIED",
      reasonCode: "NO_EFFECT_TO_VERIFY",
      confirmedBy: "EXECUTOR_RETURN",
      notes: ["No external effect is declared for this capability; a valid output is its completion."],
    };
  }

  const denied = assertions.find((entry) => entry.state === "NOT_OCCURRED");
  if (denied) {
    return {
      ...base,
      decision: "FAILED",
      reasonCode: "EFFECT_DID_NOT_OCCUR",
      notes: [
        `${denied.source} reports the effect did not occur${denied.authority ? ` (${denied.authority})` : ""}.`,
        ...(denied.notes ?? []),
      ],
    };
  }

  const uncertain = assertions.find((entry) => entry.state === "UNCERTAIN");
  if (uncertain) {
    return {
      ...base,
      decision: "INCONCLUSIVE",
      reasonCode: "EFFECT_UNCERTAIN_RECONCILIATION_REQUIRED",
      missingEvidence: policy.sufficientSources,
      notes: [
        `${uncertain.source} cannot determine whether the effect occurred; ${
          retryPermitted ? "a retry is permitted" : "reconciliation is required and a blind retry is forbidden"
        }.`,
        ...(uncertain.notes ?? []),
      ],
    };
  }

  const occurred = assertions.filter((entry) => entry.state === "OCCURRED");
  const sufficient = occurred.find((entry) => policy.sufficientSources.includes(entry.source));
  if (sufficient) {
    return {
      ...base,
      decision: "VERIFIED",
      reasonCode: "EFFECT_CONFIRMED",
      confirmedBy: sufficient.source,
      notes: [
        `The effect is confirmed by ${sufficient.source}${sufficient.authority ? ` (${sufficient.authority})` : ""}.`,
        ...(sufficient.notes ?? []),
      ],
    };
  }

  if (occurred.length > 0) {
    // Somebody claims success, and nobody who counts has agreed. This is the
    // case the runtime used to call VERIFIED.
    const claimants = [...new Set(occurred.map((entry) => entry.source))];
    return {
      ...base,
      decision: "PENDING",
      reasonCode: claimants.every((source) => source === "EXECUTOR_RETURN")
        ? "EFFECT_NOT_INDEPENDENTLY_CONFIRMED"
        : "EFFECT_CLAIM_SOURCE_INSUFFICIENT",
      missingEvidence: policy.sufficientSources,
      notes: [
        `The effect is claimed by ${claimants.join(", ")}, which this policy does not accept as verification.`,
        policy.requirement,
        `Still required: one of ${policy.sufficientSources.join(", ")}.`,
      ],
    };
  }

  const inFlight = assertions.some((entry) => entry.state === "PENDING");
  notes.push(
    inFlight
      ? "The effect has been accepted and is still in flight; no outcome has been reported yet."
      : "No party has asserted anything about this effect.",
    policy.requirement,
  );
  return {
    ...base,
    decision: "PENDING",
    reasonCode: inFlight ? "EFFECT_STILL_IN_FLIGHT" : "EFFECT_EVIDENCE_ABSENT",
    missingEvidence: policy.sufficientSources,
    notes,
  };
}

/**
 * Fold a completion decision into a verification status.
 *
 * DOWNGRADE ONLY. The completion layer exists to withhold VERIFIED, never to
 * grant it: if the output verifier already said FAILED or INCONCLUSIVE, no
 * effect assertion can talk it up. Without this the layer would become a route
 * to launder a bad result into a good one.
 */
export function applyCompletionDecision(
  outputVerdict: "VERIFIED" | "FAILED" | "INCONCLUSIVE",
  decision: CompletionDecision,
): "VERIFIED" | "FAILED" | "INCONCLUSIVE" | "PENDING" {
  if (outputVerdict !== "VERIFIED") return outputVerdict;
  return decision;
}

/**
 * The single question the executor needs answered before it retries.
 *
 * `payout.ts` refuses to dispatch an INCONCLUSIVE payout again. This is the
 * same refusal for every effect class.
 */
export function mayRetryAfter(evaluation: CompletionEvaluation): boolean {
  if (evaluation.decision === "VERIFIED") return false;
  if (evaluation.decision === "FAILED") return true;
  return evaluation.retryPermitted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gathering evidence
// ─────────────────────────────────────────────────────────────────────────────

export type EffectResolutionContext = {
  ownerId: string;
  capabilityId: string;
  attemptId: string;
  runId: string;
  nodeId: string;
  /** The canonical result envelope's `result`, as the capability produced it. */
  result: Record<string, unknown> | null;
};

/**
 * Trusted code that reads an effect back from the authority that owns it.
 *
 * Returning `undefined` means "this resolver has nothing to say", which leaves
 * the attempt unconfirmed rather than confirmed. THROWING is also safe:
 * `gatherEffectAssertions` converts a thrown resolver into UNCERTAIN, because a
 * verifier that cannot reach its authority has learnt that it does not know —
 * not that everything is fine.
 */
export type EffectResolver = (
  context: EffectResolutionContext,
) => Promise<EffectAssertion | undefined>;

export type EffectContract = {
  effectKind: EffectKind;
  /** The weight of the capability's own `effect.state` declaration, if it makes one. */
  effectEvidenceSource?: EffectClaimSource;
  resolveEffect?: EffectResolver;
};

export type GatheredEvidence = {
  assertions: EffectAssertion[];
  /** Set when a payload tried to grade itself. Recorded, never ignored. */
  declarationViolation?: string;
};

/**
 * Collect every assertion available about one attempt's effect.
 *
 * Two sources, in increasing order of worth:
 *
 *   1. The capability's own `effect.state` declaration, weighted by the
 *      `effectEvidenceSource` fixed at registration. A capability that has no
 *      declared source contributes EXECUTOR_RETURN — which no effectful policy
 *      accepts, which is the point.
 *   2. A trusted resolver's readback, which states its own source.
 *
 * Nothing here inspects the subject matter of the effect. A delivery, a device
 * command and a booking travel through the same four lines.
 */
export async function gatherEffectAssertions(
  contract: EffectContract,
  context: EffectResolutionContext,
): Promise<GatheredEvidence> {
  const assertions: EffectAssertion[] = [];
  let declarationViolation: string | undefined;

  if (contract.effectKind !== "NONE") {
    const declared = sanitizeEffectDeclaration(context.result);
    if (!declared.ok) {
      declarationViolation = declared.violation;
      // A payload reaching for authority does not get the benefit of the doubt.
      assertions.push({
        state: "UNCERTAIN",
        source: "EXECUTOR_RETURN",
        authority: context.capabilityId,
        notes: [`Effect declaration rejected: ${declared.violation}`],
      });
    } else if (declared.declaration) {
      assertions.push({
        state: declared.declaration.state,
        source: contract.effectEvidenceSource ?? "EXECUTOR_RETURN",
        authority: context.capabilityId,
        ...(declared.declaration.reference ? { reference: declared.declaration.reference } : {}),
      });
    }
  }

  if (contract.resolveEffect) {
    try {
      const resolved = await contract.resolveEffect(context);
      if (resolved) assertions.push(resolved);
    } catch (error) {
      assertions.push({
        state: "UNCERTAIN",
        source: "EXECUTOR_RETURN",
        authority: context.capabilityId,
        notes: [
          `The effect resolver could not reach its authority: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      });
    }
  }

  return { assertions, ...(declarationViolation ? { declarationViolation } : {}) };
}
