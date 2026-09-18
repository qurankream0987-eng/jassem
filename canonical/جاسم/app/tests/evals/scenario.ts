/**
 * JASIM EVALUATION — the generic scenario specification.
 *
 * ─── WHY THIS FILE HAS NO DOMAIN WORDS IN IT ────────────────────────────────
 *
 * The 30 behavioural examples mention scaffolding, trucks, CNC machines,
 * translators and hotels. A benchmark that encoded those as fields —
 * `expectedDriverStatus`, `expectedHotelBooking` — would quietly become the
 * domain-specific core the architecture exists to avoid, and the benchmark
 * would then certify the very thing it is supposed to forbid.
 *
 * So a scenario declares only what JASIM's own vocabulary already knows how to
 * say: an output kind, a capability class, an effect class, a verification
 * state, a reference outcome, an authority requirement. A truck and a hotel
 * room are the same scenario shape — which is the claim under test.
 *
 * `frozen-corpus.test.ts` enforces this by reading THIS FILE and the corpus and
 * failing if either names a domain.
 *
 * ─── WHAT A SCENARIO IS NOT ─────────────────────────────────────────────────
 *
 * It is not an expected string. A benchmark that asserts prose measures the
 * model's wording and calls it correctness. Every expectation here is a
 * structural property of the trajectory that a person could verify from the
 * database without reading a single sentence JASIM produced.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary — all of it borrowed from the runtime, none of it invented here
// ─────────────────────────────────────────────────────────────────────────────

/** The generic primitives a scenario needs. Part 3's classification axis. */
export type GenericPrimitive =
  | "EXPLAIN"
  | "COMPARE"
  | "SEARCH"
  | "NORMALIZE"
  | "RANK"
  | "REFERENCE_RESOLUTION"
  | "MONITOR"
  | "OBSERVE"
  | "NOTIFY"
  | "TRACK"
  | "VERIFY"
  | "DECIDE"
  | "PLAN"
  | "COMPOSE"
  | "CONTROL_DEVICE"
  | "AUTHORIZE"
  | "PERMISSION_MUTATE"
  | "WORLD_CREATE"
  | "WORLD_MUTATE"
  | "MATCH"
  | "OPPORTUNITY"
  | "PAY"
  | "RECONCILE"
  | "PROJECT"
  | "DETECT_GAP";

/** The 20 benchmark categories the brief requires coverage of. */
export type ScenarioCategory =
  | "SIMPLE_KNOWLEDGE"
  | "DISCOVERY"
  | "STABLE_REFERENCES"
  | "AMBIGUITY"
  | "MONITORING"
  | "TRACKING"
  | "HUMAN_PROVIDER"
  | "DEVICE_EFFECT"
  | "MULTI_PROVIDER_COMPOSITION"
  | "PERSISTENT_WORLD"
  | "PERMISSIONS"
  | "CAPACITY"
  | "ECONOMIC_OPPORTUNITY"
  | "PAYMENTS"
  | "RECONCILIATION"
  | "CROSS_OWNER_ATTACK"
  | "PROVIDER_CLAIM"
  | "ADVERTISING_SEMANTICS"
  | "CROSS_DEVICE_CONTINUITY"
  | "CORE_EVOLUTION";

/**
 * What a scenario needed in order to pass. The generality score is computed
 * from this field and nothing else, because it is the only honest place to
 * record "we made it pass by adding a domain".
 */
export type PassRequirement =
  | "GENERIC_EXISTING_PRIMITIVE"
  | "GENERIC_NEW_PRIMITIVE"
  | "NEW_PROVIDER"
  | "DOMAIN_SPECIFIC_CORE";

/** Where a scenario can run. Offline must never touch a paid provider. */
export type ScenarioGate = "OFFLINE" | "LIVE_MODEL" | "LIVE_PROVIDER";

/** What the runtime is allowed to conclude about an effect. */
export type VerificationExpectation =
  | "VERIFIED"
  | "PENDING"
  | "INCONCLUSIVE"
  | "FAILED"
  | "NOT_APPLICABLE"
  /** Anything except VERIFIED. The honest expectation for an unconfirmed effect. */
  | "NOT_VERIFIED";

export type ReferenceExpectation =
  | "resolved"
  | "ambiguous"
  | "unresolved"
  | "not_requested";

/** The smallest-sufficient-output question, in the runtime's own vocabulary. */
export type PersistenceExpectation = "none" | "run" | "world";

// ─────────────────────────────────────────────────────────────────────────────
// The scenario
// ─────────────────────────────────────────────────────────────────────────────

export type Scenario = {
  /** Stable id. Frozen: an id is never reused for a different scenario. */
  id: string;
  /** Neutral one-line description. Never a domain noun. */
  title: string;
  category: ScenarioCategory;
  /** The generic primitives this scenario requires of the runtime. */
  primitives: readonly GenericPrimitive[];
  gate: ScenarioGate;
  /** Provenance: which of the 30 acceptance examples this encodes, if any. */
  source?: string;

  /** The user's words. Data under test, never matched as a string. */
  utterance: string;

  /** The world before the turn. Everything absent means "not available". */
  given: {
    /** Authority classes the owner has granted for this turn. */
    authority?: readonly ("owner" | "human" | "regulatory")[];
    budget?: {
      modelCalls?: number;
      amountMinor?: string;
      currency?: string;
    };
    /** Provider kinds configured. An empty list is the honest default here. */
    providers?: readonly ("NATIVE" | "MCP" | "A2A" | "AGENT_HARNESS" | "COMPUTER_USE" | "HUMAN")[];
    /** Generic resource classes present in the fixture world. */
    resources?: readonly string[];
    /** How many prior turns of context the scenario assumes. */
    priorTurns?: number;
    /** A second owner exists, for isolation scenarios. */
    otherOwnerPresent?: boolean;
  };

  /** What must be true of the trajectory. Absent fields are not asserted. */
  expect: {
    outputKind?: readonly string[];
    capability?: readonly string[];
    effectClass?: readonly ("NONE" | "INTERNAL_STATE" | "MESSAGE_DISPATCH" | "DEVICE_COMMAND" | "REMOTE_MUTATION" | "HUMAN_ACTION")[];
    verification?: VerificationExpectation;
    reference?: ReferenceExpectation;
    approvalRequired?: boolean;
    persistence?: PersistenceExpectation;
    /** The run must end blocked with this code rather than pretending. */
    blockedReason?: string;
  };

  /**
   * What must NOT happen. These are the assertions that matter: a benchmark
   * measured only on `expect` rewards optimism.
   */
  forbid: {
    /** A model output asserting ownership, verification or authorization. */
    authorityClaims?: boolean;
    /** Classes of value that must never be invented. Generic class names only. */
    fabricated?: readonly ("price" | "coordinates" | "eta" | "source" | "demand" | "receipt" | "availability")[];
    outputKind?: readonly string[];
    crossOwnerAccess?: boolean;
    blindRetry?: boolean;
    /** Reported success for an effect that was not independently confirmed. */
    falseSuccess?: boolean;
    /** A domain-specific handler was needed to make this pass. */
    domainSpecificCore?: boolean;
  };

  /**
   * What passing ACTUALLY required, recorded per run rather than declared.
   * The declared value is the *expectation*; `evaluate.ts` records the
   * observed one, and a divergence is the architectural regression signal.
   */
  expectedRequirement: PassRequirement;
};

/** A scenario's outcome. Truthful values only — there is no "probably". */
export type ScenarioOutcome =
  | "PASS"
  | "PARTIAL"
  | "FAIL"
  | "BLOCKED_BY_MODEL"
  | "BLOCKED_BY_PROVIDER"
  | "FUTURE";

export type ScenarioResult = {
  scenarioId: string;
  outcome: ScenarioOutcome;
  /** Per-assertion detail, so a PARTIAL says which half held. */
  checks: readonly {
    name: string;
    passed: boolean;
    detail: string;
    /** A failed security or false-success check can never be outweighed. */
    severity: "INFO" | "QUALITY" | "TRUTH" | "SECURITY";
  }[];
  observedRequirement: PassRequirement;
  notes: readonly string[];
};
