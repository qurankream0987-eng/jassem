/**
 * JASIM — THE PERMANENT GENERALITY ACCEPTANCE CATALOG.
 *
 * ─── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * Every scenario JASIM's development has produced, recorded as a TEST rather
 * than as a feature. None of these is a domain, a branch, or an instruction to
 * build something. The catalog exists to answer one question permanently:
 *
 *   Can ONE JASIM compose general primitives and capabilities to handle this,
 *   WITHOUT a new domain branch?
 *
 * ─── WHAT IT IS NOT ─────────────────────────────────────────────────────────
 *
 * It is not a roadmap and not a score to improve. A scenario moves from
 * NOT_YET_IMPLEMENTED to PASS when the GENERAL capability behind it is built —
 * never because someone wrote code for the scenario.
 *
 * ─── WHY EIGHT GATES AND NOT ONE NUMBER ─────────────────────────────────────
 *
 * "JASIM can do X" is the sentence this file exists to prevent. Representing a
 * goal, routing it, planning it, executing it, observing what happened,
 * verifying it, presenting it and persisting it are eight independent facts.
 * Collapsing them into one percentage is how a system comes to believe it can
 * do things it has never done.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The gates
// ─────────────────────────────────────────────────────────────────────────────

export const GATES = [
  /** The core can express the goal with no domain-specific type. */
  "REPRESENTABLE",
  /** The semantic router sends it to the correct mechanism. */
  "ROUTABLE",
  /** The needed capabilities/plan can be composed. */
  "PLANNABLE",
  /** A real capability and a real provider can carry it out today. */
  "EXECUTABLE",
  /** What happened in the world can be learnt. */
  "OBSERVABLE",
  /** The outcome can be independently proven. */
  "VERIFIABLE",
  /** The state can be shown through a real generative surface. */
  "PRESENTABLE",
  /** If it is ongoing, its state survives and updates. */
  "PERSISTENT",
] as const;
export type Gate = (typeof GATES)[number];

/**
 * A gate's truth. There is no "partial" and no "probably".
 *
 * `BLOCKED_BY_PROVIDER` is the distinction the whole catalog turns on: a
 * generic boundary that is correct and simply unplugged is NOT a generality
 * failure, and it is NOT a pass either.
 */
export const GATE_STATUSES = [
  "PASS",
  /** A general capability is missing. Named in `currentBlocker`. */
  "NOT_YET_IMPLEMENTED",
  /** The generic contract exists; no live provider is connected. */
  "BLOCKED_BY_PROVIDER",
  /** The contract and provider exist; this environment cannot run it. */
  "BLOCKED_BY_ENVIRONMENT",
  /** The gate does not apply — a one-shot read has nothing to persist. */
  "NOT_APPLICABLE",
] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// General primitives — §8. A noun from an industry is never one of these.
// ─────────────────────────────────────────────────────────────────────────────

export const PRIMITIVES = [
  "Actor", "Goal", "Need", "Offering", "Resource", "Capacity", "Constraint",
  "Preference", "Economics", "Availability", "Opportunity", "Proposal", "Term",
  "Authority", "Agreement", "Commitment", "Transaction", "Fulfillment",
  "Observation", "Verification", "Policy", "Event", "Dataset", "Reference",
  "Location", "Time",
] as const;
export type Primitive = (typeof PRIMITIVES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// General capabilities — §9. Behaviours, not registered capability ids.
// ─────────────────────────────────────────────────────────────────────────────

export const CAPABILITIES = [
  "UNDERSTAND", "REFERENCE_RESOLUTION", "ROUTE", "READ", "SEARCH", "DISCOVER",
  "FILTER", "RANK", "COMPARE", "CONTACT", "MESSAGE", "PROPOSE",
  "COUNTER_PROPOSE", "AGREE", "COMMIT", "TRANSACT", "PAY", "BOOK", "SCHEDULE",
  "EXECUTE", "MONITOR", "TRACK", "OBSERVE", "VERIFY", "NOTIFY", "MUTATE",
  "PERSIST", "PRESENT", "SECURE_PRODUCT_ACTION",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Provider CLASSES, never vendors. A vendor name here would be a domain leak. */
export const PROVIDER_CLASSES = [
  "NONE", "MODEL", "SEARCH", "MESSAGING", "EMAIL", "PAYMENT", "MAPS",
  "CALENDAR", "DEVICE", "STORAGE", "HUMAN", "EXTERNAL_MARKETPLACE",
  "TELEMETRY", "MCP", "A2A",
  /**
   * Whoever can mint or retire a credential. JASIM stores no password and
   * verifies none: it exchanges an external identity for a session. Naming
   * the class is what keeps "no identity provider is connected" from being
   * mistaken for "JASIM cannot sign anybody in".
   */
  "IDENTITY",
] as const;
export type ProviderClass = (typeof PROVIDER_CLASSES)[number];

/**
 * The GENERAL gaps. A scenario may only blame one of these.
 *
 * "Supplier negotiation does not work" is never a blocker. The blocker is
 * GENERAL_AGREEMENT_RUNTIME, and closing it closes salary, rent, shipping and
 * every holdout at the same time.
 */
export const GENERAL_GAPS = [
  // OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH was here and is closed: the
  // exchange is reached as two ordinary capabilities a plan can name.
  // GENERAL_TRANSACTION_FULFILLMENT was here and is closed: a committed
  // agreement becomes one transaction with obligations both ways, verified by
  // the same completion policy every effect uses. What reaches OUTSIDE JASIM
  // is a provider gap, which is a different thing and says so.
  "REALTIME_RUNTIME",
  // MONITORING_ENGINE was here and is closed: a turn creates a durable
  // standing condition, it is evaluated by the duty cycle that already
  // existed, and the difference between «it is true» and «it just became
  // true» is kept so a poll cannot notify forever. What it was covering
  // separately is below.
  /**
   * A standing condition can DETECT. It cannot ACT.
   *
   * «إذا نزل تحت ٢٠٠ اشترِ» is two things — watching, and buying — and the
   * second needs an authority envelope evaluated at trigger time, which
   * nothing issues. A monitor's only actions are NOTIFY and NONE, and
   * widening that without the envelope would be a monitor granting itself
   * authority nobody gave it.
   */
  "STANDING_ACTION_AUTHORITY",
  "LIVING_OBJECT_RUNTIME",
  // PERSISTENT_WORLD_MATERIALIZATION was here and is closed: a turn validates
  // a definition, authorizes it against the acting scope, commits it in one
  // transaction with a version precondition, records a durable event and reads
  // the world back before anybody is told it exists. What that ONE name was
  // covering turns out to be three different missing things, and the other two
  // are below under their own names rather than inside it.
  /**
   * A grant is scope-wide or it does not exist. `membership.grant` gives a
   * person verbs across an organization; nothing issues or checks a grant on
   * ONE resource, so «اعطِ فريقي صلاحية القراءة فقط على هذا النظام» has no
   * mechanism. The membership row already carries `resourceKind` and
   * `resourceId`; nothing writes anything but `organization`/`*` into them.
   */
  "RESOURCE_SCOPED_PERMISSION_GRANT",
  /**
   * A scope's name, logo and palette are not driven from its canonical state.
   * A world carries a theme and a scope has a display name, and no surface
   * reads either — so «اجعل اسمه وشعاره لمطعمي» is a presentation gap, not a
   * world gap, and calling it one would have hidden it inside a closed name.
   */
  "SCOPE_BRANDING_SURFACE",
  // SECURE_PRODUCT_ACTION_RUNTIME was here and is closed: a conversation
  // opens a trusted surface the RUNTIME described, the surface collects what
  // the registry declared, and one server boundary validates, authorizes,
  // mutates and records it. What a credential still needs is an identity
  // provider, which is a different thing and says so.
  /**
   * Nothing in this repository says what happens to the rows a person owns
   * when they leave. There is no erasure policy, no retention rule and no
   * tombstone. Closing an account is real; deleting one is not, and inventing
   * the deletion would be the worst false success this codebase could make.
   */
  "DATA_ERASURE_POLICY",
  /**
   * A person's authority inside a scope is granted and revoked today, as an
   * authority act with a statement and a digest. An outside APPLICATION
   * holding delegated access is a grant this repository never issues, so
   * there is nothing to show a person and nothing to withdraw.
   */
  "DELEGATED_ACCESS_RUNTIME",
  // BUSINESS_SCOPE_RUNTIME was here and is closed: an organization is a value
  // the ownerId column holds, and a turn can act on its authority.
  //
  // GENERAL_AGREEMENT_RUNTIME was here and is closed: one evaluator, one
  // envelope and one agreement for every subject there is.
  //
  // AUTHORITY_ADMINISTRATION_PATH was here and is closed: a person performs an
  // authority act by reading a statement the runtime rendered and citing its
  // digest. A plan still performs none of them.
  //
  // POLICY_ENFORCEMENT was here and is closed: a typed rule is read at the
  // turn, at the executor immediately before the effect, and at the
  // commitment — one function, and no capability reading a rule of its own.
  "EXTERNAL_DISCOVERY_PROVIDER",
  "BUSINESS_DATA_SOURCE_ADAPTER",
  "LOCATION_OBSERVATION",
  "SPONSORED_DISCOVERY_RUNTIME",
  "SUBSCRIPTION_RUNTIME",
  "DEVICE_PROVIDER",
  "PRESENTATION_SURFACE_MOUNT",
] as const;
export type GeneralGap = (typeof GENERAL_GAPS)[number];

export const SIDE_EFFECT_CLASSES = [
  "NONE", "INTERNAL_STATE", "MESSAGE_DISPATCH", "DEVICE_COMMAND",
  "REMOTE_MUTATION", "HUMAN_ACTION",
] as const;
export type SideEffectClass = (typeof SIDE_EFFECT_CLASSES)[number];

export const ROUTES = [
  "TEXT", "DIRECT_READ", "GENERATED_PRESENTATION", "TRUSTED_PRODUCT_ACTION",
  "GENERAL_PLANGRAPH", "MONITORING", "PERSISTENT_LIVING_OBJECT",
  "PERSISTENT_WORLD", "LEGACY_FLAT",
] as const;
export type Route = (typeof ROUTES)[number];

export const FAMILIES = [
  "CONVERSATION_ROUTING", "DATA", "SECURE_PRODUCT_ACTIONS", "MULTI_STEP",
  "DISCOVERY", "OPEN_MARKET", "AGREEMENT", "TRANSACTIONS",
  "OBSERVATION_VERIFICATION", "MONITORING", "REALTIME_LIVING_OBJECTS",
  "WORLDS", "PHYSICAL_EXTERNAL", "BUSINESS", "MONETIZATION", "JASIM_OS",
  "HOLDOUT", "IDEA_INTAKE",
] as const;
export type Family = (typeof FAMILIES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// A scenario
// ─────────────────────────────────────────────────────────────────────────────

export type Scenario = {
  readonly id: string;
  /** What a person would actually say. Arabic where that is what they'd say. */
  readonly goal: string;
  readonly family: Family;
  readonly route: Route;
  readonly primitives: readonly Primitive[];
  readonly capabilities: readonly Capability[];
  readonly providers: readonly ProviderClass[];
  readonly sideEffect: SideEffectClass;
  /** Whether a person's approval is required before anything happens. */
  readonly requiresApproval: boolean;
  readonly gates: Readonly<Record<Gate, GateStatus>>;
  /** The ONE general gap holding this back, or null when nothing does. */
  readonly currentBlocker: GeneralGap | null;
  /** What the runtime honestly does today when asked this. */
  readonly truthfulRuntimeState: string;
  /** Always 0. A non-zero value here is the catalog reporting its own failure. */
  readonly domainBranchesRequired: 0;
};

/**
 * Gate defaults are PESSIMISTIC on purpose.
 *
 * A gate nobody thought about reads NOT_YET_IMPLEMENTED, never PASS. Forgetting
 * must not be the permissive path — the same rule the completion policy uses
 * for an undeclared effect kind.
 */
function gates(spec: Partial<Record<Gate, GateStatus>>): Readonly<Record<Gate, GateStatus>> {
  return Object.freeze({
    REPRESENTABLE: "NOT_YET_IMPLEMENTED",
    ROUTABLE: "NOT_YET_IMPLEMENTED",
    PLANNABLE: "NOT_YET_IMPLEMENTED",
    EXECUTABLE: "NOT_YET_IMPLEMENTED",
    OBSERVABLE: "NOT_YET_IMPLEMENTED",
    VERIFIABLE: "NOT_YET_IMPLEMENTED",
    PRESENTABLE: "NOT_YET_IMPLEMENTED",
    PERSISTENT: "NOT_YET_IMPLEMENTED",
    ...spec,
  } as Record<Gate, GateStatus>);
}

/** A read or a pure answer: nothing is executed, nothing is observed. */
const READ_GATES = (over: Partial<Record<Gate, GateStatus>> = {}) =>
  gates({
    REPRESENTABLE: "PASS",
    ROUTABLE: "PASS",
    PLANNABLE: "PASS",
    EXECUTABLE: "PASS",
    OBSERVABLE: "NOT_APPLICABLE",
    VERIFIABLE: "NOT_APPLICABLE",
    PRESENTABLE: "PASS",
    PERSISTENT: "NOT_APPLICABLE",
    ...over,
  });

/**
 * Understood and correctly routed; the mechanism behind the route is not built.
 *
 * This is the most common honest state in the catalog, and the most important
 * one not to confuse with PASS.
 */
const ROUTED_ONLY = (over: Partial<Record<Gate, GateStatus>> = {}) =>
  gates({ REPRESENTABLE: "PASS", ROUTABLE: "PASS", ...over });

const SCENARIOS_A_E: readonly Scenario[] = Object.freeze([
  // ══ A · CONVERSATION / ROUTING ═══════════════════════════════════════════
  {
    id: "route.text",
    goal: "ما هو الفرق بين العقد والاتفاق؟",
    family: "CONVERSATION_ROUTING",
    route: "TEXT",
    primitives: ["Actor", "Goal"],
    capabilities: ["UNDERSTAND", "ROUTE", "PRESENT"],
    providers: ["MODEL"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES({ EXECUTABLE: "BLOCKED_BY_ENVIRONMENT" }),
    currentBlocker: null,
    truthfulRuntimeState:
      "Routed to TEXT and answered. The model call itself has no provider credentials in this environment.",
    domainBranchesRequired: 0,
  },
  {
    id: "route.direct_read",
    goal: "أرني عملياتي",
    family: "CONVERSATION_ROUTING",
    route: "DIRECT_READ",
    primitives: ["Actor", "Goal", "Dataset", "Policy"],
    capabilities: ["UNDERSTAND", "ROUTE", "READ", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    currentBlocker: null,
    truthfulRuntimeState: "DataNeed → AuthorizedQuery → CanonicalDataset → TABLE, proven on the live turn.",
    domainBranchesRequired: 0,
  },
  {
    id: "route.generated_presentation",
    goal: "اعرض لي هذا كبطاقة",
    family: "CONVERSATION_ROUTING",
    route: "GENERATED_PRESENTATION",
    primitives: ["Goal", "Dataset"],
    capabilities: ["UNDERSTAND", "ROUTE", "PRESENT"],
    providers: ["MODEL"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES({ EXECUTABLE: "BLOCKED_BY_ENVIRONMENT" }),
    currentBlocker: null,
    truthfulRuntimeState: "Presentation IR is decided by the runtime and validated before rendering.",
    domainBranchesRequired: 0,
  },
  {
    id: "route.product_action",
    goal: "سجّلني خروج",
    family: "CONVERSATION_ROUTING",
    route: "TRUSTED_PRODUCT_ACTION",
    primitives: ["Actor", "Goal", "Authority", "Policy"],
    capabilities: ["UNDERSTAND", "ROUTE", "SECURE_PRODUCT_ACTION"],
    providers: ["NONE"],
    sideEffect: "INTERNAL_STATE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "The router names TRUSTED_PRODUCT_ACTION and the turn now opens a trusted action session behind it. It still never falls back to a DAG.",
    domainBranchesRequired: 0,
  },
  {
    id: "route.plangraph",
    goal: "رتب لي مؤتمرًا الشهر القادم",
    family: "CONVERSATION_ROUTING",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Goal", "Constraint", "Preference", "Authority", "Time"],
    capabilities: ["UNDERSTAND", "ROUTE", "EXECUTE", "PRESENT"],
    providers: ["MODEL"],
    sideEffect: "NONE",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "GoalSpec → PlanGraph → dependency-ordered DAG with authority per node. Individual steps need their own providers.",
    domainBranchesRequired: 0,
  },
  {
    id: "route.monitoring",
    goal: "راقب السعر وأخبرني إذا نزل",
    family: "CONVERSATION_ROUTING",
    route: "MONITORING",
    primitives: ["Goal", "Constraint", "Observation", "Event", "Time"],
    capabilities: ["UNDERSTAND", "ROUTE", "MONITOR", "NOTIFY"],
    providers: ["NONE"],
    // Watching writes durable rows of JASIM's own, and those rows are read
    // back. A scenario that called this a pure read would be the false pure
    // read this catalog refuses.
    sideEffect: "INTERNAL_STATE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "Routed to MONITORING, which reports NOT_IMPLEMENTED. Durable temporal triggers exist; no standing-condition engine consumes them.",
    domainBranchesRequired: 0,
  },
  {
    id: "route.living_object",
    goal: "أين وصل طلبي؟",
    family: "CONVERSATION_ROUTING",
    route: "PERSISTENT_LIVING_OBJECT",
    primitives: ["Reference", "Observation", "Event"],
    capabilities: ["UNDERSTAND", "ROUTE", "TRACK", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: ROUTED_ONLY({ PRESENTABLE: "PASS", PERSISTENT: "PASS" }),
    currentBlocker: "LIVING_OBJECT_RUNTIME",
    truthfulRuntimeState:
      "A living-objects projection exists and is read-only; nothing keeps it live.",
    domainBranchesRequired: 0,
  },
  {
    id: "route.persistent_world",
    goal: "أنشئ نظامًا دائمًا لشركتي",
    family: "CONVERSATION_ROUTING",
    route: "PERSISTENT_WORLD",
    primitives: ["Actor", "Resource", "Policy", "Event"],
    capabilities: ["UNDERSTAND", "ROUTE", "PERSIST", "MUTATE"],
    providers: ["NONE"],
    sideEffect: "INTERNAL_STATE",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "Routed to PERSISTENT_WORLD, and the mechanism behind the route now exists: the turn validates the definition, authorizes it against the acting scope, commits it atomically and reads the world back before reporting it. It still creates no run and no DAG.",
    domainBranchesRequired: 0,
  },

  // ══ B · DATA ═════════════════════════════════════════════════════════════
  {
    id: "data.read_runs",
    goal: "أرني عملياتي",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Dataset", "Policy", "Actor"],
    capabilities: ["READ", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    currentBlocker: null,
    truthfulRuntimeState: "Real rows, owner-scoped, windowed, with freshness stated.",
    domainBranchesRequired: 0,
  },
  {
    id: "data.read_tasks",
    goal: "أرني مهامي",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Dataset", "Policy"],
    capabilities: ["READ", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    currentBlocker: null,
    truthfulRuntimeState: "The same one read path; `tasks` is a registered canonical resource.",
    domainBranchesRequired: 0,
  },
  {
    id: "data.read_conversations",
    goal: "أرني محادثاتي",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Dataset", "Policy"],
    capabilities: ["READ", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    currentBlocker: null,
    truthfulRuntimeState: "The same one read path; `conversations` is a registered canonical resource.",
    domainBranchesRequired: 0,
  },
  {
    id: "data.sort",
    goal: "رتبها من الأعلى",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Dataset", "Preference"],
    capabilities: ["READ", "FILTER", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    currentBlocker: null,
    truthfulRuntimeState: "The same dataset re-sorted with no second read; positions renumbered.",
    domainBranchesRequired: 0,
  },
  {
    id: "data.filter",
    goal: "أرني المعلّقة فقط",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Dataset", "Constraint"],
    capabilities: ["READ", "FILTER", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    currentBlocker: null,
    truthfulRuntimeState: "Filters are authorized per field and bound, never interpolated.",
    domainBranchesRequired: 0,
  },
  {
    id: "data.ordinal_reference",
    goal: "اعرض الصف الثاني",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Reference", "Dataset"],
    capabilities: ["REFERENCE_RESOLUTION", "READ"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    currentBlocker: null,
    truthfulRuntimeState:
      "Rows are enumerated by PRESENTED position, so the ordinal follows a re-sort. Out of range is refused, not clamped.",
    domainBranchesRequired: 0,
  },
  {
    id: "data.table",
    goal: "أرني جدولًا",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Dataset"],
    capabilities: ["READ", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    currentBlocker: null,
    truthfulRuntimeState: "TABLE is a trusted surface mounted on the assistant's own turn.",
    domainBranchesRequired: 0,
  },
  {
    id: "data.chart",
    goal: "حولها إلى رسم",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Dataset"],
    capabilities: ["READ", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    currentBlocker: null,
    truthfulRuntimeState: "CHART carries its aggregation scope and says so when the window was partial.",
    domainBranchesRequired: 0,
  },
  {
    id: "data.morph_table_chart",
    goal: "حولها إلى رسم ثم رجّعها جدول",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Dataset"],
    capabilities: ["READ", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    currentBlocker: null,
    truthfulRuntimeState: "Both directions, same dataset id and revision, no re-query.",
    domainBranchesRequired: 0,
  },
  {
    id: "data.missing_resource",
    goal: "أرني مبيعاتي",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Dataset", "Policy"],
    capabilities: ["READ"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    // Nothing is blocked: answering «لا يوجد مصدر بيانات» to a resource that
    // does not exist is the complete, correct behaviour. The gap belongs to
    // `data.business_source`, which is about actually having the data.
    currentBlocker: null,
    truthfulRuntimeState:
      "UNAVAILABLE, naming what does exist. No sales are invented. Connecting a business source is an adapter, not a branch.",
    domainBranchesRequired: 0,
  },
  {
    id: "data.denied_field",
    goal: "أرني مفاتيح عملياتي",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Dataset", "Policy", "Authority"],
    capabilities: ["READ"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: READ_GATES(),
    currentBlocker: null,
    truthfulRuntimeState: "DENIED, and the denied values never reach the page.",
    domainBranchesRequired: 0,
  },
  {
    id: "data.business_source",
    goal: "أرني مبيعات متجري من نظامي المربوط",
    family: "DATA",
    route: "DIRECT_READ",
    primitives: ["Dataset", "Policy", "Actor"],
    capabilities: ["READ", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE", PRESENTABLE: "PASS", PERSISTENT: "NOT_APPLICABLE",
    }),
    currentBlocker: "BUSINESS_DATA_SOURCE_ADAPTER",
    truthfulRuntimeState:
      "The DataSource contract and registry exist; only the internal runtime source is registered.",
    domainBranchesRequired: 0,
  },

  // ══ C · SECURE PRODUCT ACTIONS ═══════════════════════════════════════════
  //
  // These eight were one block with one status while the mechanism did not
  // exist. It exists now, and they stop being one block: each is graded on
  // what its own registered action actually does today. Three run, three wait
  // on an identity provider this repository has never had, and two are held
  // by a general gap that is NOT the secure-surface gap and says which.
  //
  // The uniform shape stays: ONE registry, ONE submission boundary, ONE audit
  // record. A per-scenario gate is a measurement, not a branch.
  ...([
    {
      id: "login",
      goal: "سجّلني دخول",
      action: "session.establish",
      providers: ["IDENTITY"] as const,
      requiresApproval: false,
      gates: gates({
        REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
        EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "BLOCKED_BY_PROVIDER",
        VERIFIABLE: "BLOCKED_BY_PROVIDER", PRESENTABLE: "PASS", PERSISTENT: "PASS",
      }),
      currentBlocker: null,
      truthfulRuntimeState:
        "The trusted surface, the action session and the one submission boundary are real and anonymous-capable. JASIM stores no password and verifies none — it exchanges an external identity for a session — so the action says it is blocked instead of pretending.",
    },
    {
      id: "logout",
      goal: "سجّلني خروج",
      action: "session.revoke",
      providers: ["NONE"] as const,
      requiresApproval: false,
      gates: gates({
        REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
        EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
        PRESENTABLE: "PASS", PERSISTENT: "PASS",
      }),
      currentBlocker: null,
      truthfulRuntimeState:
        "Every token minted for the identity before now stops being accepted, at the server, on both the Bearer and the cookie path. A client erasing its own storage is not what is being claimed here.",
    },
    {
      id: "signup",
      goal: "أنشئ لي حسابًا",
      action: "account.create",
      providers: ["IDENTITY"] as const,
      requiresApproval: false,
      gates: gates({
        REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
        EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "BLOCKED_BY_PROVIDER",
        VERIFIABLE: "BLOCKED_BY_PROVIDER", PRESENTABLE: "PASS", PERSISTENT: "PASS",
      }),
      currentBlocker: null,
      truthfulRuntimeState:
        "A person with no identity yet can reach the surface — the action is declared ANONYMOUS_ALLOWED and proven to be. Creating the identity itself needs the provider that issues it.",
    },
    {
      id: "password_change",
      goal: "غيّر كلمة المرور",
      action: "credential.rotate",
      providers: ["IDENTITY"] as const,
      requiresApproval: true,
      gates: gates({
        REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
        EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "BLOCKED_BY_PROVIDER",
        VERIFIABLE: "BLOCKED_BY_PROVIDER", PRESENTABLE: "PASS", PERSISTENT: "PASS",
      }),
      currentBlocker: null,
      truthfulRuntimeState:
        "Three SENSITIVE fields, re-authentication the caller may supply but never assert, and a proof that the typed secret reaches no table, no event and no model context. There is no password in this repository to rotate.",
    },
    {
      id: "account_deletion",
      goal: "احذف حسابي",
      action: "account.close",
      providers: ["NONE"] as const,
      requiresApproval: true,
      gates: gates({
        REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
        EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "PASS",
        VERIFIABLE: "NOT_YET_IMPLEMENTED", PRESENTABLE: "PASS", PERSISTENT: "PASS",
      }),
      currentBlocker: "DATA_ERASURE_POLICY" as const,
      truthfulRuntimeState:
        "Typing the exact phrase «أغلق حسابي» suspends the account and revokes its sessions, and the runtime says in the same breath that it deleted nothing. The person asked for deletion, so this gate is not a pass: there is no erasure policy to carry out.",
    },
    {
      id: "settings",
      goal: "غيّر اسمي في الحساب",
      action: "settings.update",
      providers: ["NONE"] as const,
      requiresApproval: false,
      gates: gates({
        REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
        EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
        PRESENTABLE: "PASS", PERSISTENT: "PASS",
      }),
      currentBlocker: null,
      truthfulRuntimeState:
        "One action for every preference there is. The key is a closed choice the registry supplies, the write lands under the signed-in actor only, and repeating it leaves the same final state.",
    },
    {
      id: "privacy",
      goal: "أوقف مشاركة موقعي",
      action: "settings.update",
      providers: ["DEVICE"] as const,
      requiresApproval: false,
      gates: gates({
        REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
        EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "BLOCKED_BY_PROVIDER",
        VERIFIABLE: "BLOCKED_BY_PROVIDER", PRESENTABLE: "PASS", PERSISTENT: "PASS",
      }),
      currentBlocker: null,
      truthfulRuntimeState:
        "«privacy» is one of the registry's closed preference keys and the write is the same general action. But JASIM shares no device location today, so recording the preference is not withdrawing a live grant, and the catalog will not call it one.",
    },
    {
      id: "permissions",
      goal: "امنع هذا التطبيق من الوصول",
      action: null,
      providers: ["NONE"] as const,
      requiresApproval: true,
      gates: gates({
        REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
        EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "NOT_YET_IMPLEMENTED",
        VERIFIABLE: "NOT_YET_IMPLEMENTED", PRESENTABLE: "PASS", PERSISTENT: "PASS",
      }),
      currentBlocker: "DELEGATED_ACCESS_RUNTIME" as const,
      truthfulRuntimeState:
        "A PERSON's authority in a scope is revoked today through `membership.revoke`, an authority act with a statement and a digest — deliberately not duplicated as a product action. An outside application's delegated access is a grant JASIM never issues, so there is nothing to list and nothing to withdraw.",
    },
  ] as const).map((entry) => ({
    id: `product.${entry.id}`,
    goal: entry.goal,
    family: "SECURE_PRODUCT_ACTIONS" as const,
    route: "TRUSTED_PRODUCT_ACTION" as const,
    primitives: ["Actor", "Authority", "Policy", "Event"] as const,
    capabilities: ["UNDERSTAND", "ROUTE", "SECURE_PRODUCT_ACTION", "MUTATE"] as const,
    providers: entry.providers,
    sideEffect: "INTERNAL_STATE" as const,
    requiresApproval: entry.requiresApproval,
    gates: entry.gates,
    currentBlocker: entry.currentBlocker,
    truthfulRuntimeState: entry.truthfulRuntimeState,
    domainBranchesRequired: 0 as const,
  })),

  // ══ D · MULTI-STEP EXECUTION ═════════════════════════════════════════════
  {
    id: "plan.conference",
    goal: "رتب مؤتمرًا: قاعة، مترجم، دعوات",
    family: "MULTI_STEP",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Goal", "Constraint", "Authority", "Time", "Opportunity"],
    capabilities: ["UNDERSTAND", "EXECUTE", "SCHEDULE", "MESSAGE"],
    providers: ["MODEL", "CALENDAR", "MESSAGING"],
    sideEffect: "MESSAGE_DISPATCH",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "The plan, its dependency order and its authority per node are real. Venue, calendar and messaging each need a provider.",
    domainBranchesRequired: 0,
  },
  {
    id: "plan.output_binding",
    goal: "احجز القاعة ثم أرسل العنوان للمدعوين",
    family: "MULTI_STEP",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Goal", "Reference", "Authority"],
    capabilities: ["EXECUTE", "MESSAGE"],
    providers: ["MESSAGING"],
    sideEffect: "MESSAGE_DISPATCH",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState: "Node output → node input bindings are validated and ordered by the plan.",
    domainBranchesRequired: 0,
  },
  {
    id: "plan.calendar",
    goal: "ضعه في تقويمي",
    family: "MULTI_STEP",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Goal", "Time", "Authority"],
    capabilities: ["SCHEDULE"],
    providers: ["CALENDAR"],
    sideEffect: "REMOTE_MUTATION",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "BLOCKED_BY_PROVIDER",
      VERIFIABLE: "BLOCKED_BY_PROVIDER", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState: "Generic boundary is correct; no calendar provider is connected.",
    domainBranchesRequired: 0,
  },
  {
    id: "plan.messaging",
    goal: "أرسل لهم رسالة",
    family: "MULTI_STEP",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Goal", "Authority", "Event"],
    capabilities: ["MESSAGE", "NOTIFY"],
    providers: ["MESSAGING"],
    sideEffect: "MESSAGE_DISPATCH",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "`notify` runs and its delivery is verified from the notification lifecycle, not from the executor's return.",
    domainBranchesRequired: 0,
  },

  // ══ E · DISCOVERY ════════════════════════════════════════════════════════
  {
    id: "discovery.internal",
    goal: "ابحث داخل جاسم عن مورد",
    family: "DISCOVERY",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Need", "Offering", "Opportunity", "Constraint"],
    capabilities: ["DISCOVER", "SEARCH", "FILTER", "RANK", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "NOT_APPLICABLE", VERIFIABLE: "NOT_APPLICABLE",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "`planSources` honours «فقط داخل جاسم» and `searchInternal` reads published expressions with hard-constraint filtering.",
    domainBranchesRequired: 0,
  },
  {
    id: "discovery.external",
    goal: "ابحث في الإنترنت",
    family: "DISCOVERY",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Need", "Opportunity", "Constraint"],
    capabilities: ["DISCOVER", "SEARCH", "RANK"],
    providers: ["SEARCH"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "EXTERNAL_DISCOVERY_PROVIDER",
    truthfulRuntimeState:
      "The WEB_OBSERVATION source class exists and is planned for; no live search provider is connected.",
    domainBranchesRequired: 0,
  },
  {
    id: "discovery.blended",
    goal: "ابحث لي عن الأفضل",
    family: "DISCOVERY",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Need", "Opportunity", "Preference"],
    capabilities: ["DISCOVER", "RANK", "COMPARE"],
    providers: ["SEARCH"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "EXTERNAL_DISCOVERY_PROVIDER",
    truthfulRuntimeState:
      "Both source classes are planned in one pass. Internal results must never hide a better external one.",
    domainBranchesRequired: 0,
  },
  {
    id: "discovery.hard_constraints",
    goal: "أقل من 250 دينار فقط",
    family: "DISCOVERY",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Constraint", "Economics"],
    capabilities: ["FILTER", "RANK"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS", EXECUTABLE: "PASS",
      OBSERVABLE: "NOT_APPLICABLE", VERIFIABLE: "NOT_APPLICABLE",
      PRESENTABLE: "PASS", PERSISTENT: "NOT_APPLICABLE",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "Hard constraints filter with unit normalisation, and UNKNOWN stays UNKNOWN rather than passing.",
    domainBranchesRequired: 0,
  },
  {
    id: "discovery.compare",
    goal: "قارن الأول والثالث",
    family: "DISCOVERY",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Reference", "Opportunity"],
    capabilities: ["REFERENCE_RESOLUTION", "COMPARE", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS", EXECUTABLE: "PASS",
      OBSERVABLE: "NOT_APPLICABLE", VERIFIABLE: "NOT_APPLICABLE",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState: "Stable reference bindings resolve ordinals against the presented result set.",
    domainBranchesRequired: 0,
  },
]);

// ── F · OPEN MARKET ─────────────────────────────────────────────────────────
//
// The market is the clearest generality test in the catalog: every row below
// is the SAME Need/Offering/Opportunity machinery. A row that needed its own
// marketplace core would be the failure, not the feature.

const MARKET_PAIRS = [
  ["factory_grocery", "مصنع لديه تونة ↔ بقالة تحتاج تونة", "Offering", "Need"],
  ["restaurant_customer", "مطعم ينشر قائمته ↔ زبون يطلب وجبة بتعديلات", "Offering", "Need"],
  ["company_candidate", "شركة تحتاج موظفًا ↔ شخص لديه وقت ومهارة", "Need", "Capacity"],
  ["shipment_driver", "شحنة تحتاج نقلًا ↔ شاحنتان فارغتان اليوم", "Need", "Capacity"],
  ["warehouse_renter", "شركة تحتاج مستودعًا أسبوعًا ↔ مستودع لديه مساحة", "Need", "Capacity"],
  ["machine_production", "طلب تصنيع ↔ مخرطة متاحة 6 ساعات", "Need", "Capacity"],
  ["translator_requester", "محكمة تحتاج مترجمًا ↔ مترجم لديه ساعتان", "Need", "Capacity"],
  ["technician_company", "شركة تحتاج فنيًا ↔ فني متاح", "Need", "Capacity"],
  ["farmer_buyer", "مزارع لديه محصول ↔ مشترٍ بالجملة", "Offering", "Need"],
  ["hotel_supplier", "فندق يحتاج مورد غسيل ↔ مغسلة لديها طاقة", "Need", "Capacity"],
] as const;

const MARKET_SCENARIOS: readonly Scenario[] = Object.freeze([
  ...([
    ["business_publishes_need", "شركتي تحتاج 300 حبة بأقل من 250 دينار", "Need"],
    ["business_publishes_offering", "انشر منتجاتي وأسعاري وكمياتي", "Offering"],
    ["person_publishes_need", "أحتاج من يصلح مكيفي", "Need"],
    ["person_publishes_offering", "أعرض خدمة تصميم بالساعة", "Offering"],
    ["resource_capacity", "عندي مولد لديه قدرة فائضة", "Capacity"],
    ["human_capacity", "عندي ساعتان متاحتان اليوم", "Capacity"],
    ["machine_capacity", "مخرطتي متاحة 6 ساعات", "Capacity"],
  ] as const).map(([id, goal, primitive]) => ({
    id: `market.${id}`,
    goal,
    family: "OPEN_MARKET" as const,
    route: "GENERAL_PLANGRAPH" as const,
    primitives: ["Actor", primitive, "Constraint", "Economics", "Availability", "Policy"] as const,
    capabilities: ["UNDERSTAND", "PERSIST", "DISCOVER", "PRESENT"] as const,
    providers: ["NONE"] as const,
    sideEffect: "INTERNAL_STATE" as const,
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      EXECUTABLE: "PASS",
      // Publishing writes JASIM's own record, so JASIM's own readback is what
      // verifies it — and does.
      OBSERVABLE: "PASS",
      VERIFIABLE: "PASS",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "`opportunity-publish` is a registered capability: a plan names it, the real executor runs it, and the expression is verified by an internal readback. Identity comes from the session and the public projection is built by the runtime.",
    domainBranchesRequired: 0 as const,
  })),
  ...MARKET_PAIRS.map(([id, goal, left, right]) => ({
    id: `market.pair.${id}`,
    goal,
    family: "OPEN_MARKET" as const,
    route: "GENERAL_PLANGRAPH" as const,
    primitives: ["Actor", left, right, "Opportunity", "Constraint", "Economics"] as const,
    capabilities: ["DISCOVER", "FILTER", "RANK", "COMPARE", "PRESENT"] as const,
    providers: ["NONE"] as const,
    sideEffect: "NONE" as const,
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      EXECUTABLE: "PASS",
      OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "`opportunity-discover` matches a Need the caller owns against published Offerings, with per-constraint results and composite matches. Every pair here is the same matcher with different strings, proven through the live executor.",
    domainBranchesRequired: 0 as const,
  })),
  {
    id: "market.actor_is_both",
    goal: "مصنعي يشتري مواد خام ويبيع منتجات في الوقت نفسه",
    family: "OPEN_MARKET",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Actor", "Need", "Offering", "Resource", "Capacity"],
    capabilities: ["DISCOVER", "PERSIST"],
    providers: ["NONE"],
    sideEffect: "INTERNAL_STATE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS",
      // Holding both is an INTERNAL_STATE effect, and JASIM's own readback is
      // what verifies it.
      OBSERVABLE: "PASS",
      VERIFIABLE: "PASS", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "Buyer and seller are contextual roles of one Actor: proven live, one owner holding a Need and an Offering at once. There is no buyer account and no seller account.",
    domainBranchesRequired: 0,
  },
  {
    id: "market.internal_must_not_hide_external",
    goal: "ابحث لي عن الأفضل حتى لو كان خارج جاسم",
    family: "OPEN_MARKET",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Need", "Opportunity", "Preference", "Policy"],
    capabilities: ["DISCOVER", "RANK"],
    providers: ["SEARCH"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "EXTERNAL_DISCOVERY_PROVIDER",
    truthfulRuntimeState:
      "PLATFORM_INTEREST != USER_ANSWER_AUTHORITY. Source planning is driven by the person's restriction, never by where the transaction would settle.",
    domainBranchesRequired: 0,
  },
  {
    id: "market.claim_is_not_availability",
    goal: "البائع يقول عنده 100 حبة",
    family: "OPEN_MARKET",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Offering", "Availability", "Observation", "Verification"],
    capabilities: ["DISCOVER", "OBSERVE", "VERIFY"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS",
      // Downgraded by doing the work: the verification runtime is ready, and
      // nothing OBSERVES a seller's stock. Claiming otherwise would be the
      // exact false confidence this catalog exists to prevent.
      OBSERVABLE: "BLOCKED_BY_PROVIDER",
      VERIFIABLE: "BLOCKED_BY_PROVIDER",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "OPEN_MARKET != UNVERIFIED_MARKET. The claim can now be published and is stored as a claim. Turning it into a verified availability needs an observation of the seller's stock, and no source produces one.",
    domainBranchesRequired: 0,
  },
]);

// ── G · AGREEMENT / NEGOTIATION ─────────────────────────────────────────────

const NEGOTIATION_SUBJECTS = [
  ["price", "فاوضه على السعر"],
  ["delivery", "فاوضه على موعد التسليم"],
  ["payment_terms", "فاوضه على الدفع بعد 30 يومًا"],
  ["salary", "فاوضه على الراتب"],
  ["rent", "فاوضه على الإيجار"],
  ["shipping", "فاوضه على أجرة الشحن"],
  ["service", "فاوضه على نطاق الخدمة"],
  ["equipment", "فاوضه على أجرة المعدة"],
] as const;

const AGREEMENT_SCENARIOS: readonly Scenario[] = Object.freeze([
  ...NEGOTIATION_SUBJECTS.map(([id, goal]) => ({
    id: `agreement.${id}`,
    goal,
    family: "AGREEMENT" as const,
    route: "GENERAL_PLANGRAPH" as const,
    primitives: ["Actor", "Proposal", "Term", "Constraint", "Authority", "Agreement"] as const,
    capabilities: ["PROPOSE", "COUNTER_PROPOSE", "AGREE", "COMMIT"] as const,
    providers: ["NONE"] as const,
    // Negotiating inside JASIM writes JASIM's own rows. Reaching a
    // counterparty who is not in JASIM is messaging, and a different scenario.
    sideEffect: "INTERNAL_STATE" as const,
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      // Earned: a turn plans `agreement-open` → `agreement-propose` as two
      // dependent nodes, and the router gained nothing.
      PLANNABLE: "PASS",
      // Earned: «لا تتجاوز 250» becomes an authority act whose statement puts
      // the 250 on its own line, and once it is read and approved JASIM
      // negotiates inside it through the ordinary executor.
      EXECUTABLE: "PASS",
      OBSERVABLE: "PASS",
      VERIFIABLE: "PASS",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "All eight negotiate through ONE evaluator and the same four capabilities, and a counter never passes the reserve. The limit is delegated by saying it and reading it back: the person sees the number on its own line before anything can be agreed inside it. Reaching a counterparty who is not in JASIM is messaging, and a different scenario.",
    domainBranchesRequired: 0 as const,
  })),
  {
    id: "agreement.buyer_private_maximum",
    goal: "لا تتجاوز 250 دينارًا ولا تخبره بذلك",
    family: "AGREEMENT",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Constraint", "Authority", "Policy", "Proposal"],
    capabilities: ["PROPOSE", "COUNTER_PROPOSE"],
    providers: ["NONE"],
    sideEffect: "INTERNAL_STATE",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "PASS",
      VERIFIABLE: "PASS", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "TARGET != AUTHORITY, and both halves hold: a counter is clamped at the reserve over any number of rounds, and the reserve is structurally absent from what the counterparty sees. The one screen it appears on is the person's own approval — which is the only place it is supposed to be. NOT_DISCLOSED != NOT_INFERABLE, and the runtime claims no more.",
    domainBranchesRequired: 0,
  },
  {
    id: "agreement.seller_private_minimum",
    goal: "لا تنزل تحت 180 ولا تكشف الحد",
    family: "AGREEMENT",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Constraint", "Authority", "Policy"],
    capabilities: ["PROPOSE", "COUNTER_PROPOSE"],
    providers: ["NONE"],
    sideEffect: "INTERNAL_STATE",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "PASS",
      VERIFIABLE: "PASS", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "The mirror of the buyer's maximum, and literally the same code: HIGHER_IS_BETTER is the other value of one field, not a second branch.",
    domainBranchesRequired: 0,
  },
  {
    id: "agreement.commitment",
    goal: "اتفقنا — ثبّت الاتفاق",
    family: "AGREEMENT",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Agreement", "Commitment", "Authority", "Event"],
    capabilities: ["AGREE", "COMMIT", "PERSIST"],
    providers: ["NONE"],
    sideEffect: "INTERNAL_STATE",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "«اتفقنا» renders every term on its own line — price, unit, who owes what — and agreeing cites the digest of exactly that, so a proposal edited while somebody was reading voids the approval. AGREEMENT != TRANSACTION: it creates no payment, and a Commitment exists only where the sheet DECLARED who owes what.",
    domainBranchesRequired: 0,
  },
]);

// ── H · TRANSACTIONS ────────────────────────────────────────────────────────

const TRANSACTION_SCENARIOS: readonly Scenario[] = Object.freeze([
  ...([
    // The four that reach OUTSIDE JASIM, and the one that does not.
    ["buy", "اشترِ لي هذا", "REMOTE_MUTATION"],
    ["sell", "بع لي هذا", "REMOTE_MUTATION"],
    ["book", "احجز لي هذه", "REMOTE_MUTATION"],
    ["reserve", "احجز المساحة لأسبوع", "REMOTE_MUTATION"],
    ["cancel", "ألغِ الطلب", "INTERNAL_STATE"],
  ] as const).map(([id, goal, effect]) => ({
    id: `transaction.${id}`,
    goal,
    family: "TRANSACTIONS" as const,
    route: "GENERAL_PLANGRAPH" as const,
    primitives: ["Actor", "Opportunity", "Agreement", "Transaction", "Authority", "Economics"] as const,
    capabilities: ["TRANSACT", "COMMIT", "PRESENT"] as const,
    providers: ["NONE"] as const,
    sideEffect: effect,
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      // Cancelling is canonical state JASIM owns, so it runs. The other four
      // reach a counterparty outside JASIM, and no provider is connected:
      // GENERALITY FAILURE != PROVIDER NOT CONNECTED.
      EXECUTABLE: id === "cancel" ? "PASS" : "BLOCKED_BY_PROVIDER",
      OBSERVABLE: id === "cancel" ? "PASS" : "BLOCKED_BY_PROVIDER",
      VERIFIABLE: id === "cancel" ? "PASS" : "BLOCKED_BY_PROVIDER",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      id === "cancel"
        ? "Cancelling runs before anything irreversible; once an obligation is VERIFIED it becomes COMPENSATING instead, because an effect that happened did not stop happening. Compensating an EXTERNAL effect still needs the provider that produced it."
        : "A committed Agreement becomes exactly one Transaction with obligations both ways, each verified by observation through the same completion policy every effect uses, and partial fulfillment stays partial. What is missing is the counterparty: no payment provider and no external marketplace is connected, so the outward half cannot run or be read back.",
    domainBranchesRequired: 0 as const,
  })),
  {
    id: "transaction.pay",
    goal: "ادفع",
    family: "TRANSACTIONS",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Transaction", "Economics", "Authority", "Verification"],
    capabilities: ["PAY", "VERIFY"],
    providers: ["PAYMENT"],
    sideEffect: "REMOTE_MUTATION",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "BLOCKED_BY_PROVIDER",
      VERIFIABLE: "BLOCKED_BY_PROVIDER", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "PaymentIntent has a real lifecycle and a mandate budget. No PSP is connected, and a PaymentIntent is not a payment.",
    domainBranchesRequired: 0,
  },
  {
    id: "transaction.refund",
    goal: "أرجع لي المبلغ",
    family: "TRANSACTIONS",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Transaction", "Economics", "Authority", "Verification"],
    capabilities: ["PAY", "VERIFY"],
    providers: ["PAYMENT"],
    sideEffect: "REMOTE_MUTATION",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "BLOCKED_BY_PROVIDER",
      VERIFIABLE: "BLOCKED_BY_PROVIDER", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "A refund is a new financial effect with its own verification, not the reversal of a record. Block 3 models it that way.",
    domainBranchesRequired: 0,
  },
  {
    id: "transaction.fulfillment",
    goal: "هل وصل الطلب؟",
    family: "TRANSACTIONS",
    route: "PERSISTENT_LIVING_OBJECT",
    primitives: ["Fulfillment", "Observation", "Verification", "Reference"],
    capabilities: ["TRACK", "OBSERVE", "VERIFY"],
    providers: ["TELEMETRY", "HUMAN"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "TRANSACTION = CREATED still does not make FULFILLMENT = VERIFIED, and the answer says so: the projection shows what was agreed, what is committed, what is paid, what is verified and what remains — per obligation, with CLAIMED and VERIFIED as two columns. An unobserved delivery reads PENDING rather than a guess.",
    domainBranchesRequired: 0,
  },
]);

// ── I · OBSERVATION / VERIFICATION ──────────────────────────────────────────
//
// The one family that is PASS end to end, because it is what the previous
// phase built. Its scenarios are the regression guard for that.

const VERIFIED_GATES = gates({
  REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS", EXECUTABLE: "PASS",
  OBSERVABLE: "PASS", VERIFIABLE: "PASS", PRESENTABLE: "PASS", PERSISTENT: "PASS",
});

const OBSERVATION_SCENARIOS: readonly Scenario[] = Object.freeze([
  ...([
    ["message_delivery", "هل وصلت الرسالة؟", "MESSAGE_DISPATCH"],
    ["device_state", "هل اشتغل الجهاز فعلاً؟", "DEVICE_COMMAND"],
    ["human_report", "هل أنجز الفني العمل؟", "HUMAN_ACTION"],
    ["remote_mutation", "هل تم إنشاء الطلب في نظامهم؟", "REMOTE_MUTATION"],
  ] as const).map(([id, goal, effect]) => ({
    id: `observation.${id}`,
    goal,
    family: "OBSERVATION_VERIFICATION" as const,
    route: "GENERAL_PLANGRAPH" as const,
    primitives: ["Observation", "Verification", "Event", "Time"] as const,
    capabilities: ["OBSERVE", "VERIFY"] as const,
    providers: ["NONE"] as const,
    sideEffect: effect,
    requiresApproval: false,
    gates: VERIFIED_GATES,
    currentBlocker: null,
    truthfulRuntimeState:
      "Proven on the live executor: an effect reaches VERIFIED only through an independent readback or the owner's confirmation, and never through the executor's return.",
    domainBranchesRequired: 0 as const,
  })),
  {
    id: "observation.receipt_is_not_verification",
    goal: "المزود أعطانا إيصالًا",
    family: "OBSERVATION_VERIFICATION",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Observation", "Verification"],
    capabilities: ["OBSERVE", "VERIFY"],
    providers: ["NONE"],
    sideEffect: "REMOTE_MUTATION",
    requiresApproval: false,
    gates: VERIFIED_GATES,
    currentBlocker: null,
    truthfulRuntimeState:
      "BOUND_PROVIDER_RECEIPT appears in no policy's sufficient sources. A receipt binds a request; it does not verify an effect.",
    domainBranchesRequired: 0,
  },
  {
    id: "observation.conflict",
    goal: "المزود يقول تم والقراءة تقول لا",
    family: "OBSERVATION_VERIFICATION",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Observation", "Verification"],
    capabilities: ["OBSERVE", "VERIFY"],
    providers: ["NONE"],
    sideEffect: "DEVICE_COMMAND",
    requiresApproval: false,
    gates: VERIFIED_GATES,
    currentBlocker: null,
    truthfulRuntimeState:
      "Two fresh authorities disagreeing is UNCERTAIN, blind retry is forbidden, and nothing is verified.",
    domainBranchesRequired: 0,
  },
  {
    id: "observation.missing",
    goal: "نُفِّذ ولم تصل أي قراءة",
    family: "OBSERVATION_VERIFICATION",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Observation", "Verification"],
    capabilities: ["OBSERVE", "VERIFY"],
    providers: ["NONE"],
    sideEffect: "DEVICE_COMMAND",
    requiresApproval: false,
    gates: VERIFIED_GATES,
    currentBlocker: null,
    truthfulRuntimeState: "INCONCLUSIVE != FAILED, and neither is SUCCESS. The attempt stays unconfirmed.",
    domainBranchesRequired: 0,
  },
  {
    id: "observation.replay",
    goal: "المزود أعاد إرسال نفس الإشعار",
    family: "OBSERVATION_VERIFICATION",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Observation", "Event"],
    capabilities: ["OBSERVE"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: VERIFIED_GATES,
    currentBlocker: null,
    truthfulRuntimeState: "Idempotent on a correlation id: one observation, one event.",
    domainBranchesRequired: 0,
  },
]);

// ── J · MONITORING ──────────────────────────────────────────────────────────

const MONITORING_SCENARIOS: readonly Scenario[] = Object.freeze(
  //
  // These five shared one verdict while a standing condition could be routed
  // to and never evaluated. They stop being one block: three run end to end,
  // one waits on a provider to read from, and one is held by the half of it
  // that a monitor deliberately cannot do.
  //
  // All five go through ONE engine. A price and a temperature differ in an
  // observation's payload and in nothing the engine knows about.
  //
  //   DOMAIN_MONITOR_TYPES_ADDED = 0 · DOMAIN_WATCHERS_ADDED = 0
  ([
    {
      id: "price",
      goal: "راقب السعر وأخبرني إذا نزل",
      providers: ["NONE"] as const,
      executable: "PASS" as const,
      blocker: null,
      state:
        "A durable standing condition over the canonical observation for that subject. It fires on the transition and not on the fact, so a poll every minute on an unchanged price notifies once.",
    },
    {
      id: "state",
      goal: "راقب حالة الطلب",
      providers: ["NONE"] as const,
      executable: "PASS" as const,
      blocker: null,
      state:
        "`changed`, `entered_state` and `left_state` are operators of the same condition language, and each is UNKNOWN rather than false until there is a previous reading to compare against.",
    },
    {
      id: "standing_condition",
      goal: "إذا نزل تحت 200 اشترِ",
      providers: ["NONE"] as const,
      executable: "NOT_YET_IMPLEMENTED" as const,
      blocker: "STANDING_ACTION_AUTHORITY" as const,
      state:
        "The watching half runs: the condition is detected, recorded and notified. The buying half does not, and deliberately — a monitor's only actions are NOTIFY and NONE, because acting on a trigger needs an authority envelope evaluated at trigger time that nothing issues yet. MONITORING AUTHORITY != EXECUTION AUTHORITY.",
    },
    {
      id: "notify_on_condition",
      goal: "نبّهني إذا تأخر",
      providers: ["NONE"] as const,
      executable: "PASS" as const,
      blocker: null,
      state:
        "Lateness is an ABSENCE, and it is claimed only with an expected observation and the window it had to arrive in — UNKNOWN != ABSENT. A match makes a notification INTENT and delivers nothing: CONDITION_MATCHED != USER_NOTIFIED, and the projection says which channels have no provider.",
    },
    {
      id: "repeated_observation",
      goal: "اقرأ الحرارة كل ساعة",
      providers: ["DEVICE"] as const,
      executable: "BLOCKED_BY_PROVIDER" as const,
      blocker: null,
      state:
        "The hourly evaluation is real and durable — it survives a restart because it is a step in a duty cycle that re-enqueues itself. READING the temperature is the part with nothing plugged in; the engine evaluates what is there and never invents a number.",
    },
  ] as const).map((entry) => ({
    id: `monitoring.${entry.id}`,
    goal: entry.goal,
    family: "MONITORING" as const,
    route: "MONITORING" as const,
    primitives: ["Goal", "Constraint", "Observation", "Event", "Time", "Authority"] as const,
    capabilities: ["MONITOR", "OBSERVE", "NOTIFY"] as const,
    providers: entry.providers,
    // A monitor writes rows of JASIM's own and reads them back.
    sideEffect: "INTERNAL_STATE" as const,
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      EXECUTABLE: entry.executable,
      // The verdict, the freshness and the transition are written to a ledger
      // and read back. What is NOT observable is a reading nobody can take.
      OBSERVABLE: entry.executable === "BLOCKED_BY_PROVIDER" ? "BLOCKED_BY_PROVIDER" : "PASS",
      VERIFIABLE: entry.executable === "BLOCKED_BY_PROVIDER" ? "BLOCKED_BY_PROVIDER" : "PASS",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: entry.blocker,
    truthfulRuntimeState: entry.state,
    domainBranchesRequired: 0 as const,
  })),
);

// ── K · REALTIME / LIVING OBJECTS ───────────────────────────────────────────

const REALTIME_SCENARIOS: readonly Scenario[] = Object.freeze(
  ([
    ["order_status", "أين وصل طلبي؟"],
    ["delivery_tracker", "أرني السائق على الخريطة"],
    ["negotiation_session", "أين وصل التفاوض؟"],
    ["application", "أين وصل طلب التوظيف؟"],
    ["booking", "أين وصل الحجز؟"],
    ["price_monitor", "أرني مراقبة السعر"],
  ] as const).map(([id, goal]) => ({
    id: `realtime.${id}`,
    goal,
    family: "REALTIME_LIVING_OBJECTS" as const,
    route: "PERSISTENT_LIVING_OBJECT" as const,
    // Found by the idea holdouts: «أرني السائق على الخريطة» is the one scenario
    // in the catalog whose blocker is LOCATION_OBSERVATION, and it was not
    // declaring the primitive it is blocked on.
    primitives:
      id === "delivery_tracker"
        ? (["Reference", "Observation", "Event", "Location", "Time"] as const)
        : (["Reference", "Observation", "Event", "Time"] as const),
    capabilities: ["TRACK", "OBSERVE", "PRESENT"] as const,
    providers: id === "delivery_tracker" ? (["MAPS", "TELEMETRY"] as const) : (["NONE"] as const),
    sideEffect: "NONE" as const,
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      EXECUTABLE: "NOT_YET_IMPLEMENTED",
      OBSERVABLE: id === "delivery_tracker" ? "BLOCKED_BY_PROVIDER" : "PASS",
      // A location that cannot be observed cannot be verified either, and a
      // MAP must never invent one.
      VERIFIABLE: id === "delivery_tracker" ? "BLOCKED_BY_PROVIDER" : "PASS",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker:
      id === "delivery_tracker"
        ? ("LOCATION_OBSERVATION" as const)
        : ("REALTIME_RUNTIME" as const),
    truthfulRuntimeState:
      "Canonical observations and durable events with a resume cursor exist. No client subscribes, so the surface polls and never claims «مباشر». A MAP must never invent a location.",
    domainBranchesRequired: 0 as const,
  })),
);

// ── L · WORLDS ──────────────────────────────────────────────────────────────

const WORLD_SCENARIOS: readonly Scenario[] = Object.freeze(
  //
  // These six shared one verdict while a world could be routed to and not
  // made. Five of them now run end to end; the sixth is held by a gap that was
  // hiding inside the closed one and is named rather than absorbed.
  //
  // Every one of them goes through ONE registry of mutation classes and ONE
  // commit. A warehouse world and a laboratory world differ in the entities
  // somebody declared and in nothing else.
  //
  //   DOMAIN_WORLD_TYPES_ADDED = 0
  ([
    {
      id: "business_world",
      goal: "أنشئ نظامًا دائمًا لشركتي",
      blocker: null,
      state:
        "A turn materializes it under the ACTING scope — an organization's world is the organization's, and the person's own scope does not see it. Version 1.0.0, a durable event, and a read-back before it is reported.",
    },
    {
      id: "warehouse_world",
      goal: "أنشئ نظام مستودع",
      blocker: null,
      state:
        "The same runtime, the same registry, the same commit. A warehouse differs from a laboratory in the entities somebody declared, and in nothing the runtime knows about.",
    },
    {
      id: "operational_world",
      goal: "أنشئ نظام تشغيل يومي",
      blocker: null,
      state:
        "Six unrelated operational contexts — including one nothing in the implementation anticipated — materialize and then mutate through one change set with no branch.",
    },
    {
      id: "policy_mutation",
      goal: "غيّر سياسة الموافقات في نظامي",
      blocker: null,
      state:
        "A POLICY change is refused as a sentence in a conversation and performed as an authority act: the runtime renders the statement, says which class the change actually is whatever it called itself, and the digest of what was read is what authorizes. APPROVAL != CLICK.",
    },
    {
      id: "data_mutation",
      goal: "أضف حقلاً جديدًا في نظامي",
      blocker: null,
      state:
        "One change set, all of it or none of it: five changes with the fourth invalid leave the world on its old version with no new row. A stale version is a CONFLICT that names what to rebase onto, never a silent overwrite.",
    },
    {
      id: "permission_mutation",
      goal: "اعطِ فريقي صلاحية القراءة فقط",
      blocker: "RESOURCE_SCOPED_PERMISSION_GRANT" as const,
      state:
        "Read-only ACROSS the scope runs today, as `membership.grant` — an authority act with a statement and a digest. Read-only on ONE world does not: nothing issues or checks a grant scoped to a resource, and the world runtime deliberately did not build a second permission system to fake it.",
    },
  ] as const).map((entry) => ({
    id: `world.${entry.id}`,
    goal: entry.goal,
    family: "WORLDS" as const,
    route: "PERSISTENT_WORLD" as const,
    primitives: ["Actor", "Resource", "Policy", "Authority", "Event"] as const,
    capabilities: ["PERSIST", "MUTATE", "PRESENT"] as const,
    providers: ["NONE"] as const,
    sideEffect: "INTERNAL_STATE" as const,
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      EXECUTABLE: entry.blocker === null ? "PASS" : "NOT_YET_IMPLEMENTED",
      // A world write is read back — from the database, after the turn that
      // wrote it returned. A scenario that called that a pure read would be
      // the false pure read this catalog refuses.
      OBSERVABLE: entry.blocker === null ? "PASS" : "NOT_YET_IMPLEMENTED",
      VERIFIABLE: entry.blocker === null ? "PASS" : "NOT_YET_IMPLEMENTED",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: entry.blocker,
    truthfulRuntimeState: entry.state,
    domainBranchesRequired: 0 as const,
  })),
);

// ── M · PHYSICAL / EXTERNAL CAPABILITIES ────────────────────────────────────
//
// Every row is a PROVIDER question, not an architecture question. The generic
// boundary is the capability contract; what is missing is something plugged
// into it. That distinction is the reason this family is BLOCKED_BY_PROVIDER
// rather than NOT_YET_IMPLEMENTED.

const PROVIDER_SCENARIOS: readonly Scenario[] = Object.freeze(
  ([
    ["iot_device", "شغّل المكيف على 22 درجة", "DEVICE", "DEVICE_COMMAND", ["EXECUTE", "OBSERVE", "VERIFY"]],
    ["robot", "حرّك الذراع إلى الموضع الثاني", "DEVICE", "DEVICE_COMMAND", ["EXECUTE", "OBSERVE", "VERIFY"]],
    ["industrial_machine", "شغّل المخرطة على البرنامج الثاني", "DEVICE", "DEVICE_COMMAND", ["EXECUTE", "OBSERVE"]],
    ["vehicle", "افتح باب السيارة", "DEVICE", "DEVICE_COMMAND", ["EXECUTE", "VERIFY"]],
    ["maps", "أرني الطريق إلى المستودع", "MAPS", "NONE", ["OBSERVE", "PRESENT"]],
    ["calendar", "احجز لي الموعد", "CALENDAR", "REMOTE_MUTATION", ["SCHEDULE"]],
    ["messaging", "أرسل له رسالة واتساب", "MESSAGING", "MESSAGE_DISPATCH", ["MESSAGE"]],
    ["email", "أرسل له بريدًا", "EMAIL", "MESSAGE_DISPATCH", ["MESSAGE"]],
    ["storage", "احفظ هذا الملف", "STORAGE", "REMOTE_MUTATION", ["PERSIST"]],
    ["files", "افتح لي الملف الثاني", "STORAGE", "NONE", ["READ", "PRESENT"]],
    ["images", "أنشئ لي صورة", "MODEL", "NONE", ["EXECUTE", "PRESENT"]],
    ["video", "لخّص لي هذا الفيديو", "STORAGE", "NONE", ["READ", "PRESENT"]],
    ["audio", "فرّغ لي هذا التسجيل", "STORAGE", "NONE", ["READ", "PRESENT"]],
    ["mcp", "استخدم أداة MCP المربوطة", "MCP", "REMOTE_MUTATION", ["EXECUTE"]],
    ["a2a", "كلّم الوكيل الآخر", "A2A", "REMOTE_MUTATION", ["CONTACT"]],
    ["human_provider", "ابعث مندوبًا يشتري لي", "HUMAN", "HUMAN_ACTION", ["CONTACT", "OBSERVE", "VERIFY"]],
  ] as const).map(([id, goal, provider, effect, caps]) => ({
    id: `provider.${id}`,
    goal,
    family: "PHYSICAL_EXTERNAL" as const,
    route: "GENERAL_PLANGRAPH" as const,
    primitives: ["Goal", "Resource", "Authority", "Observation", "Verification"] as const,
    capabilities: caps,
    providers: [provider] as const,
    sideEffect: effect,
    requiresApproval: effect !== "NONE",
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER",
      // The mechanism can consume telemetry; nothing emits any.
      OBSERVABLE: effect === "NONE" ? "NOT_APPLICABLE" : "BLOCKED_BY_PROVIDER",
      VERIFIABLE: effect === "NONE" ? "NOT_APPLICABLE" : "BLOCKED_BY_PROVIDER",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "The capability/provider boundary is generic and the verification runtime is ready to receive this class of evidence. No live provider is connected, which is a provider gap and not a generality failure.",
    domainBranchesRequired: 0 as const,
  })),
);

// ── N · BUSINESS ────────────────────────────────────────────────────────────

/**
 * A Business is an Actor SCOPE. Everything here is the same mechanism a person
 * uses, with a different owner — which is why the split below is not between
 * "business features" that work and ones that do not, but between ACTING in a
 * scope (which a turn can do) and ADMINISTERING one (which it cannot yet).
 */
const BUSINESS_SCENARIOS: readonly Scenario[] = Object.freeze(
  ([
    // Acting in a scope: proven on the live turn, owned by the organization.
    ["offerings", "انشر عروضي", "ACT"],
    ["needs", "انشر احتياجاتي", "ACT"],
    ["resources", "سجّل معداتي", "ACT"],
    ["capacity", "سجّل طاقتي المتاحة", "ACT"],
    // Administering a scope: an authority act the person reads and decides.
    ["scope", "أنشئ حساب شركتي", "ADMIN"],
    ["team", "أضف موظفًا إلى فريقي", "ADMIN"],
    ["permissions", "اعطه صلاحية العروض فقط", "ADMIN"],
    ["policies", "ضع سياسة: لا تبيع بأقل من التكلفة", "ADMIN"],
    ["provider_bindings", "اربط نظام المخزون عندي", "ADMIN"],
    // Waiting on something else entirely.
    ["analytics", "أرني أداء المبيعات", "DATA"],
    // Left the WORLD group when the world runtime landed: an organization owns
    // a durable system through the same scopeId every other scoped write uses,
    // and the conversation that made it is attached to it.
    ["world_association", "اربط نظام شركتي بهذا الحساب", "ACT"],
  ] as const).map(([id, goal, group]) => ({
    id: `business.${id}`,
    goal,
    family: "BUSINESS" as const,
    route: (group === "DATA" ? "DIRECT_READ" : "GENERAL_PLANGRAPH") as Route,
    primitives:
      group === "ACT"
        ? (["Actor", "Offering", "Need", "Resource", "Capacity", "Authority"] as const)
        : (["Actor", "Policy", "Authority", "Resource", "Capacity"] as const),
    capabilities:
      group === "ACT"
        ? (["UNDERSTAND", "ROUTE", "PERSIST", "OBSERVE", "VERIFY", "PRESENT"] as const)
        : (["PERSIST", "MUTATE", "PRESENT"] as const),
    providers: ["NONE"] as const,
    sideEffect: "INTERNAL_STATE" as const,
    requiresApproval: group !== "ACT",
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      // Earned: `actor-scope-runtime.test.ts` opens the run under the
      // organization, publishes through the same capability a person uses, and
      // verifies it by internal readback.
      // ADMIN joined ACT: an authority act runs end to end from a turn, and
      // every one of them is read back before it is reported.
      EXECUTABLE: group === "ACT" || group === "ADMIN" ? "PASS" : "NOT_YET_IMPLEMENTED",
      OBSERVABLE: group === "ACT" || group === "ADMIN" ? "PASS" : "NOT_APPLICABLE",
      VERIFIABLE: group === "ACT" || group === "ADMIN" ? "PASS" : "NOT_APPLICABLE",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: group === "DATA" ? ("BUSINESS_DATA_SOURCE_ADAPTER" as const) : null,
    truthfulRuntimeState:
      group === "ACT"
        ? "«باسم شركتي» resolves to a durable, revocable membership, the run opens under the organization, and the declared verb is checked before anything is written. The organization itself is created through the API rather than by talking, which is `business.scope`."
        : group === "DATA"
          ? "A read now runs under the ACTING scope and sees only its rows; a resource a scope cannot own answers UNAVAILABLE rather than an empty table. «أداء المبيعات» needs business data nobody has connected."
          : group === "WORLD"
            ? "Unreachable: no business scenario is in the WORLD group any more."
            : "Said in a turn, it becomes a PENDING authority request carrying a statement the runtime rendered — every parameter on its own line — which the person approves by citing its digest. Nothing is performed until then, a plan performs none of it, and what was done is read back before it is reported. A policy set this way is a TYPED rule the executor consults before every effect; a note is stored as a note, and the statement says which one it is.",
    domainBranchesRequired: 0 as const,
  })),
);

// ── O · MONETIZATION ────────────────────────────────────────────────────────

const MONETIZATION_SCENARIOS: readonly Scenario[] = Object.freeze([
  ...([
    ["user_subscription", "اشترك لي في الخطة الشهرية", "SUBSCRIPTION_RUNTIME"],
    ["business_subscription", "اشترك لشركتي", "SUBSCRIPTION_RUNTIME"],
  ] as const).map(([id, goal, blocker]) => ({
    id: `monetization.${id}`,
    goal,
    family: "MONETIZATION" as const,
    route: "GENERAL_PLANGRAPH" as const,
    primitives: ["Actor", "Economics", "Authority", "Transaction"] as const,
    capabilities: ["TRANSACT", "PAY", "PERSIST"] as const,
    providers: ["PAYMENT"] as const,
    sideEffect: "REMOTE_MUTATION" as const,
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "BLOCKED_BY_PROVIDER",
      VERIFIABLE: "BLOCKED_BY_PROVIDER", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: blocker,
    truthfulRuntimeState:
      "Plans, subscriptions and entitlements exist as durable records. Nothing drives them from a conversation, and PRICE != CODE CONSTANT.",
    domainBranchesRequired: 0 as const,
  })),
  {
    id: "monetization.commission",
    goal: "خذ عمولتك من الصفقة",
    family: "MONETIZATION",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Transaction", "Economics", "Policy"],
    capabilities: ["TRANSACT", "PERSIST"],
    providers: ["PAYMENT"],
    sideEffect: "REMOTE_MUTATION",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER", OBSERVABLE: "BLOCKED_BY_PROVIDER",
      VERIFIABLE: "BLOCKED_BY_PROVIDER", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "A commission is one more obligation with its own declared settlement — generic transaction economics, never a marketplace of its own. Taking it needs a payment provider, and none is connected.",
    domainBranchesRequired: 0,
  },
  {
    id: "monetization.sponsored",
    goal: "روّج لعرضي",
    family: "MONETIZATION",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Offering", "Economics", "Policy"],
    capabilities: ["DISCOVER", "RANK", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "INTERNAL_STATE",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "SPONSORED_DISCOVERY_RUNTIME",
    truthfulRuntimeState:
      "SPONSORED != BEST and BUSINESS_SUBSCRIPTION != ORGANIC_RANK. A sponsored candidate must be labelled and must never displace a better organic one.",
    domainBranchesRequired: 0,
  },
  {
    id: "monetization.sponsored_never_wins",
    goal: "لماذا هذا العرض أولًا؟",
    family: "MONETIZATION",
    route: "DIRECT_READ",
    primitives: ["Offering", "Policy", "Preference"],
    capabilities: ["RANK", "PRESENT"],
    providers: ["NONE"],
    sideEffect: "NONE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE", PRESENTABLE: "PASS", PERSISTENT: "NOT_APPLICABLE",
    }),
    currentBlocker: "SPONSORED_DISCOVERY_RUNTIME",
    truthfulRuntimeState:
      "PLATFORM_REVENUE != ANSWER_AUTHORITY. The invariant is recorded as law; nothing enforces it yet because no sponsored candidate exists.",
    domainBranchesRequired: 0,
  },
]);

// ── P · JASIM OS ────────────────────────────────────────────────────────────

const JASIM_OS_SCENARIOS: readonly Scenario[] = Object.freeze(
  ([
    ["same_core", "شغّل جاسم لمطعمي", null],
    ["business_data", "اجعله يرى بيانات مطعمي فقط", "BUSINESS_DATA_SOURCE_ADAPTER"],
    // Not a world gap and never was. A durable system exists now and carries a
    // theme; no surface reads it, and no surface reads the scope's own name
    // either. Naming it precisely is what stops it disappearing into a closed
    // gap's shadow.
    ["branding", "اجعل اسمه وشعاره لمطعمي", "SCOPE_BRANDING_SURFACE"],
    ["policies", "طبّق سياسات مطعمي", null],
    ["permissions", "حدد ما يراه الموظفون", null],
    ["providers", "اربط مزوداتي", null],
  ] as const).map(([id, goal, blocker]) => ({
    id: `jasimos.${id}`,
    goal,
    family: "JASIM_OS" as const,
    route: "GENERAL_PLANGRAPH" as const,
    primitives: ["Actor", "Policy", "Authority", "Dataset"] as const,
    capabilities: ["PERSIST", "MUTATE", "PRESENT", "READ"] as const,
    providers: ["NONE"] as const,
    sideEffect: "INTERNAL_STATE" as const,
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      EXECUTABLE: blocker === null ? "PASS" : "NOT_YET_IMPLEMENTED",
      OBSERVABLE: blocker === null ? "PASS" : "NOT_APPLICABLE",
      VERIFIABLE: blocker === null ? "PASS" : "NOT_APPLICABLE",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: blocker,
    truthfulRuntimeState:
      blocker === null
        ? "The same core, with a business scope: the organization is created, staffed, bound to its providers and governed by its own rules through talking — each an authority act the person read — and every run, row and read belongs to it. A rule it wrote is consulted before every effect. There is no second intelligence, and building one would have been the failure."
        : "The scope, its team, its providers, its rules and now its durable systems are all set by talking, and the rules are read before anything effectful runs. What remains is its OWN data and its branding — two different gaps, neither of them a second intelligence.",
    domainBranchesRequired: 0 as const,
  })),
);

// ─────────────────────────────────────────────────────────────────────────────
// BLIND HOLDOUTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Domains that did NOT shape the implementation.
 *
 * No production code mentions a valve, an apiary or a desalination plant, and
 * none ever should. These exist to answer one question: can what is already
 * built REPRESENT and ROUTE a goal from a world nobody had in mind?
 *
 * Their later gates are deliberately left at the same honest statuses as the
 * general mechanisms they depend on. A holdout that scored better than the
 * subsystem it needs would be measuring nothing.
 */
const HOLDOUT_CASES = [
  ["laboratory_instrument_time", "جهاز مختبر متاح 6 ساعات والجامعة تريد 10", "Capacity"],
  ["temporary_generator", "مولد احتياطي ليومين بشرط استجابة خلال 15 دقيقة", "Capacity"],
  ["cold_storage", "غرفة تبريد فارغة 3 أيام", "Capacity"],
  ["apiary_pollination", "منحل يحتاج تلقيح بستان", "Need"],
  ["industrial_valve_service", "صيانة صمام صناعي قبل الخميس", "Need"],
  ["desalination_maintenance", "صيانة وحدة تحلية", "Need"],
  ["court_interpretation", "مترجم محكمة لجلسة الثلاثاء", "Need"],
  ["community_lending", "إعارة معدة من مكتبة الحي", "Offering"],
  ["specialized_fabrication", "طاقة تصنيع دقيقة متاحة", "Capacity"],
  ["event_equipment", "معدات فعالية لليلة واحدة", "Offering"],
  ["scientific_calibration", "معايرة جهاز قياس", "Need"],
  ["temporary_workspace", "مساحة عمل لأسبوعين", "Need"],
  ["agricultural_service", "رش محصول قبل المطر", "Need"],
  ["energy_storage", "سعة تخزين طاقة فائضة", "Capacity"],
  ["falconry_competition", "تجهيز مسابقة صقور", "Need"],
  ["mosque_library", "فهرسة مكتبة مسجد", "Need"],
] as const;

export const HOLDOUTS: readonly Scenario[] = Object.freeze(
  HOLDOUT_CASES.map(([id, goal, primitive]) => ({
    id: `holdout.${id}`,
    goal,
    family: "HOLDOUT" as const,
    route: "GENERAL_PLANGRAPH" as const,
    primitives: [
      "Actor", primitive, "Resource", "Constraint", "Availability", "Economics",
      "Opportunity", "Time",
    ] as const,
    capabilities: ["UNDERSTAND", "ROUTE", "DISCOVER", "PERSIST", "OBSERVE", "VERIFY"] as const,
    providers: ["NONE"] as const,
    // Publishing writes a durable row. FALSE_PURE_READ = 0 applies to the
    // catalog's own declarations as much as to the capability registry's.
    sideEffect: "INTERNAL_STATE" as const,
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      // Earned, not generalised: all sixteen are published and matched through
      // the live executor in `opportunity-exchange-turn-path.test.ts`, each
      // with a bound that must hold and a counter-case that must not match.
      EXECUTABLE: "PASS",
      OBSERVABLE: "PASS",
      VERIFIABLE: "PASS",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "Published and matched through the same two capabilities and the same four constraint fields as every named scenario. Negotiating one is a different scenario family and still waits on the agreement runtime.",
    domainBranchesRequired: 0 as const,
  })),
);

// ─────────────────────────────────────────────────────────────────────────────
// BLIND IDEA HOLDOUTS — the Idea Intake Law
// ─────────────────────────────────────────────────────────────────────────────

/**
 * These are not domains. They are IDEAS — things somebody thought of that match
 * no industry, no marketplace, no application, no business category and no
 * workflow anybody has written down.
 *
 *   UNKNOWN IDEA != UNSUPPORTED DOMAIN
 *
 * The measurement is whether an idea can enter JASIM at all: whether it
 * decomposes into the primitives that already exist, routes to a mechanism
 * that already exists, and comes back with an ANSWER. Two answers are correct
 * and different, and both appear below:
 *
 *   "this needs a capability that does not exist yet"  → NOT_YET_IMPLEMENTED
 *   "this needs a provider nobody has connected"       → BLOCKED_BY_PROVIDER
 *
 * "JASIM does not support that kind of thing" is the only wrong answer,
 * because there are no kinds of thing.
 *
 * Deliberately NOT one route: forcing every idea down one path would be its own
 * domain branch. What is ratcheted is that no idea reaches for a route, a
 * primitive or a capability that the named scenarios do not already use.
 */
const IDEA_CASES: readonly Omit<Scenario, "family" | "domainBranchesRequired">[] = [
  {
    id: "idea.skill_hour_bank",
    goal: "عندي فكرة: بنك وقت، الناس يتبادلون ساعات مهارة بدل النقود",
    route: "GENERAL_PLANGRAPH",
    primitives: [
      "Actor", "Goal", "Need", "Offering", "Capacity", "Availability",
      "Economics", "Constraint", "Opportunity", "Time",
    ],
    capabilities: ["UNDERSTAND", "ROUTE", "DISCOVER", "PERSIST", "OBSERVE", "VERIFY"],
    providers: ["NONE"],
    sideEffect: "INTERNAL_STATE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "An hour of a skill is a Capacity with a unit and a price; the exchange never learns that the unit is an hour rather than a dinar. Published and matched through the same two capabilities as everything else.",
  },
  {
    id: "idea.rainwater_surplus_ring",
    goal: "فكرة: الجيران يتشاركون فائض ماء المطر المجمّع من أسطحهم",
    route: "GENERAL_PLANGRAPH",
    primitives: [
      "Actor", "Goal", "Resource", "Capacity", "Availability", "Need",
      "Constraint", "Economics", "Opportunity", "Location",
    ],
    capabilities: ["UNDERSTAND", "ROUTE", "DISCOVER", "PERSIST", "OBSERVE", "VERIFY"],
    providers: ["NONE"],
    sideEffect: "INTERNAL_STATE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "A roof with surplus is a Resource holding Capacity with an Availability window; a neighbour wanting it is a Need with a quantity bound. Published and matched with no water, roof or neighbourhood anywhere in the runtime.",
  },
  {
    id: "idea.elder_companionship_rota",
    goal: "فكرة: دوام تناوب لمرافقة كبار السن الوحيدين في الحي",
    route: "GENERAL_PLANGRAPH",
    primitives: [
      "Actor", "Goal", "Need", "Capacity", "Availability", "Commitment",
      "Agreement", "Term", "Time",
    ],
    capabilities: ["UNDERSTAND", "ROUTE", "DISCOVER", "PROPOSE", "AGREE", "COMMIT", "SCHEDULE"],
    providers: ["HUMAN"],
    sideEffect: "HUMAN_ACTION",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      // Earned: the obligations exist, and the person the turn was owed to is
      // the only one whose confirmation closes it.
      EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "A turn slot is a Term with a holder and a due time; agreeing makes it an obligation in a transaction; and it closes when the person it was owed to confirms it — never on the word of whoever owed it. A rota with one slot kept and one pending is an OPEN transaction, which is the honest state.",
  },
  {
    id: "idea.rare_seed_lending_ring",
    goal: "فكرة: حلقة إعارة بذور نادرة، تُرجَع بضعف الكمية بعد الموسم",
    route: "GENERAL_PLANGRAPH",
    primitives: [
      "Actor", "Goal", "Offering", "Need", "Resource", "Term", "Agreement",
      "Constraint", "Economics", "Time",
    ],
    capabilities: ["UNDERSTAND", "ROUTE", "DISCOVER", "PROPOSE", "AGREE", "COMMIT"],
    providers: ["NONE"],
    sideEffect: "HUMAN_ACTION",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "PASS", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "«ضعف الكمية بعد الموسم» is a Term with a quantity, a holder and a deadline that becomes an obligation in a transaction. Returning the seed is a HUMAN_ACTION, so only the lender's own confirmation closes it — the borrower saying so does not, which is the whole point.",
  },
  {
    id: "idea.vanishing_dialect_archive",
    goal: "فكرة: أرشيف للهجات التي تنقرض، يسجّله كبار السن وتُفهرس مقاطعه",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Actor", "Goal", "Dataset", "Reference", "Event", "Policy", "Time"],
    capabilities: ["UNDERSTAND", "ROUTE", "PERSIST", "READ", "PRESENT"],
    providers: ["STORAGE"],
    sideEffect: "INTERNAL_STATE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER",
      OBSERVABLE: "BLOCKED_BY_PROVIDER",
      VERIFIABLE: "BLOCKED_BY_PROVIDER",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "A recording is a Reference with an owner and a Policy; an index over them is a Dataset. No media storage provider is bound, so nothing can be stored or read back. PROVIDER_READY = PASS, LIVE_EXECUTION = BLOCKED_BY_PROVIDER.",
  },
  {
    id: "idea.dark_sky_map",
    goal: "فكرة: خريطة لأماكن الظلام الصالحة لرصد النجوم يحدّثها الراصدون",
    route: "GENERAL_PLANGRAPH",
    primitives: ["Actor", "Goal", "Observation", "Location", "Dataset", "Event", "Time"],
    capabilities: ["UNDERSTAND", "ROUTE", "OBSERVE", "PERSIST", "PRESENT"],
    providers: ["MAPS"],
    sideEffect: "INTERNAL_STATE",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "LOCATION_OBSERVATION",
    truthfulRuntimeState:
      "A darkness reading is an Observation with a Location, a claim source and a freshness horizon — the same shape as any other. Nothing can observe a place, and a MAP that invented one would be the false success this catalog exists to prevent.",
  },
  {
    id: "idea.flood_channel_watch",
    goal: "فكرة: أهل الوادي يتابعون مجرى السيل ويُنبَّهون قبل الفيضان",
    route: "MONITORING",
    primitives: ["Actor", "Goal", "Observation", "Constraint", "Event", "Policy", "Time"],
    capabilities: ["UNDERSTAND", "ROUTE", "MONITOR", "OBSERVE", "NOTIFY"],
    providers: ["TELEMETRY"],
    sideEffect: "MESSAGE_DISPATCH",
    requiresApproval: false,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "PASS",
      EXECUTABLE: "BLOCKED_BY_PROVIDER",
      OBSERVABLE: "BLOCKED_BY_PROVIDER",
      VERIFIABLE: "BLOCKED_BY_PROVIDER",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: null,
    truthfulRuntimeState:
      "The standing condition, the window, the transition and the notification intent are all real now — and the same engine «راقب السعر» uses. What is missing is a telemetry provider that knows the water level, which is a different fact and says so.",
  },
];

/**
 * An idea is not a family of one. It is catalogued the same way as everything
 * else, and its `domainBranchesRequired` is 0 by construction — a number that
 * would have to be edited by hand to become a lie.
 */
export const IDEA_HOLDOUTS: readonly Scenario[] = Object.freeze(
  IDEA_CASES.map((idea) => ({
    ...idea,
    family: "IDEA_INTAKE" as const,
    domainBranchesRequired: 0 as const,
  })),
);

// ─────────────────────────────────────────────────────────────────────────────
// The catalog
// ─────────────────────────────────────────────────────────────────────────────

export const SCENARIOS: readonly Scenario[] = Object.freeze([
  ...SCENARIOS_A_E,
  ...MARKET_SCENARIOS,
  ...AGREEMENT_SCENARIOS,
  ...TRANSACTION_SCENARIOS,
  ...OBSERVATION_SCENARIOS,
  ...MONITORING_SCENARIOS,
  ...REALTIME_SCENARIOS,
  ...WORLD_SCENARIOS,
  ...PROVIDER_SCENARIOS,
  ...BUSINESS_SCENARIOS,
  ...MONETIZATION_SCENARIOS,
  ...JASIM_OS_SCENARIOS,
  ...HOLDOUTS,
  ...IDEA_HOLDOUTS,
]);

// ─────────────────────────────────────────────────────────────────────────────
// The scoreboard
// ─────────────────────────────────────────────────────────────────────────────

export type Scoreboard = {
  readonly totalScenarios: number;
  /** Per gate, a count per status. Never summed into one number. */
  readonly gates: Readonly<Record<Gate, Readonly<Record<GateStatus, number>>>>;
  readonly blockedByProvider: number;
  readonly blockedByEnvironment: number;
  readonly notYetImplemented: number;
  readonly generalGaps: readonly GeneralGap[];
  readonly holdouts: number;
  readonly holdoutsRequiringDomainBranch: number;
  /** Blind IDEAS — §4.4. Counted apart, because they measure a different law. */
  readonly blindIdeaHoldouts: number;
  readonly ideasRequiringDomainBranch: number;
  readonly domainBranchesRequired: number;
};

/**
 * Count, and refuse to average.
 *
 * There is deliberately no `overallPercent`. Eight gates answer eight
 * questions, and one number answering all of them would be the single most
 * misleading thing this file could produce.
 */
export function scoreboard(scenarios: readonly Scenario[] = SCENARIOS): Scoreboard {
  const counts = Object.fromEntries(
    GATES.map((gate) => [
      gate,
      Object.fromEntries(GATE_STATUSES.map((status) => [status, 0])) as Record<GateStatus, number>,
    ]),
  ) as Record<Gate, Record<GateStatus, number>>;

  let blockedByProvider = 0;
  let blockedByEnvironment = 0;
  let notYetImplemented = 0;
  const gapsSeen = new Set<GeneralGap>();

  for (const scenario of scenarios) {
    let sawProvider = false;
    let sawEnvironment = false;
    let sawMissing = false;
    for (const gate of GATES) {
      const status = scenario.gates[gate];
      counts[gate][status] += 1;
      if (status === "BLOCKED_BY_PROVIDER") sawProvider = true;
      if (status === "BLOCKED_BY_ENVIRONMENT") sawEnvironment = true;
      if (status === "NOT_YET_IMPLEMENTED") sawMissing = true;
    }
    // Counted per SCENARIO, not per gate: a scenario blocked at three gates by
    // one absent provider is one blocked scenario, not three.
    if (sawProvider) blockedByProvider += 1;
    if (sawEnvironment) blockedByEnvironment += 1;
    if (sawMissing) notYetImplemented += 1;
    if (scenario.currentBlocker) gapsSeen.add(scenario.currentBlocker);
  }

  const holdouts = scenarios.filter((scenario) => scenario.family === "HOLDOUT");
  const ideas = scenarios.filter((scenario) => scenario.family === "IDEA_INTAKE");
  return Object.freeze({
    totalScenarios: scenarios.length,
    gates: Object.freeze(counts),
    blockedByProvider,
    blockedByEnvironment,
    notYetImplemented,
    generalGaps: Object.freeze([...gapsSeen].sort()),
    holdouts: holdouts.length,
    holdoutsRequiringDomainBranch: holdouts.filter((s) => s.domainBranchesRequired > 0).length,
    blindIdeaHoldouts: ideas.length,
    ideasRequiringDomainBranch: ideas.filter((s) => s.domainBranchesRequired > 0).length,
    domainBranchesRequired: scenarios.reduce((total, s) => total + s.domainBranchesRequired, 0),
  });
}

/** `PASS` count for one gate. The only figure allowed to stand alone. */
export function passCount(gate: Gate, scenarios: readonly Scenario[] = SCENARIOS): number {
  return scenarios.filter((scenario) => scenario.gates[gate] === "PASS").length;
}
