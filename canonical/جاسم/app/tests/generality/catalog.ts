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
  "GENERAL_AGREEMENT_RUNTIME",
  "GENERAL_TRANSACTION_FULFILLMENT",
  "OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH",
  "REALTIME_RUNTIME",
  "MONITORING_ENGINE",
  "LIVING_OBJECT_RUNTIME",
  "PERSISTENT_WORLD_MATERIALIZATION",
  "SECURE_PRODUCT_ACTION_RUNTIME",
  "BUSINESS_SCOPE_RUNTIME",
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
  "HOLDOUT",
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
    gates: ROUTED_ONLY({ PRESENTABLE: "PASS" }),
    currentBlocker: "SECURE_PRODUCT_ACTION_RUNTIME",
    truthfulRuntimeState:
      "The router names TRUSTED_PRODUCT_ACTION and says the mechanism is not implemented. It never falls back to a DAG.",
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
    sideEffect: "NONE",
    requiresApproval: false,
    gates: ROUTED_ONLY(),
    currentBlocker: "MONITORING_ENGINE",
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
    gates: ROUTED_ONLY(),
    currentBlocker: "PERSISTENT_WORLD_MATERIALIZATION",
    truthfulRuntimeState: "Routed to PERSISTENT_WORLD, which reports NOT_IMPLEMENTED.",
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
  ...([
    ["login", "سجّلني دخول"],
    ["logout", "سجّلني خروج"],
    ["signup", "أنشئ لي حسابًا"],
    ["password_change", "غيّر كلمة المرور"],
    ["account_deletion", "احذف حسابي"],
    ["settings", "غيّر اسمي في الحساب"],
    ["privacy", "أوقف مشاركة موقعي"],
    ["permissions", "امنع هذا التطبيق من الوصول"],
  ] as const).map(([id, goal]) => ({
    id: `product.${id}`,
    goal,
    family: "SECURE_PRODUCT_ACTIONS" as const,
    route: "TRUSTED_PRODUCT_ACTION" as const,
    primitives: ["Actor", "Authority", "Policy", "Event"] as const,
    capabilities: ["UNDERSTAND", "ROUTE", "SECURE_PRODUCT_ACTION", "MUTATE"] as const,
    providers: ["NONE"] as const,
    sideEffect: "INTERNAL_STATE" as const,
    requiresApproval: true,
    gates: ROUTED_ONLY({ PRESENTABLE: "PASS" }),
    currentBlocker: "SECURE_PRODUCT_ACTION_RUNTIME" as const,
    truthfulRuntimeState:
      "Routed correctly and refused honestly. Credentials must never reach the model context, which is why this is a secure surface and not a DAG node.",
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
      // The primitive and its publishing exist; nothing routes a CONVERSATION
      // into them. That is the gap, and it is one gap for all of these.
      EXECUTABLE: "NOT_YET_IMPLEMENTED",
      OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: "OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH" as const,
    truthfulRuntimeState:
      "EconomicExpression carries Need and Offering in one generic core with private constraints and a public projection; publishing, access grants and matching are implemented. No conversational turn reaches them.",
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
      EXECUTABLE: "NOT_YET_IMPLEMENTED",
      OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: "OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH" as const,
    truthfulRuntimeState:
      "Deterministic matching of Need to Offering exists, including composite matches. Every pair here is the same matcher with different strings.",
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
      EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH",
    truthfulRuntimeState:
      "Buyer and seller are contextual roles of one Actor: an owner holds Needs and Offerings on the same identity. There is no buyer account and no seller account.",
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
      EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH",
    truthfulRuntimeState:
      "OPEN_MARKET != UNVERIFIED_MARKET. A seller's claim is a claim; the Effect → Observation → Verification runtime is what turns a claim into a verified fact, and it does not accept self-report.",
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
    sideEffect: "REMOTE_MUTATION" as const,
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "NOT_YET_IMPLEMENTED",
      EXECUTABLE: "NOT_YET_IMPLEMENTED",
      OBSERVABLE: "PASS",
      VERIFIABLE: "PASS",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: "GENERAL_AGREEMENT_RUNTIME" as const,
    truthfulRuntimeState:
      "Versioned proposal terms and acceptance into a TransactionIntent exist. A negotiable-term model with a bounded authority envelope and counter-proposals does not. One runtime closes all eight of these at once.",
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
    sideEffect: "NONE",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "NOT_YET_IMPLEMENTED",
      EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "GENERAL_AGREEMENT_RUNTIME",
    truthfulRuntimeState:
      "TARGET != AUTHORITY. The private projection that keeps a counterparty from reading constraints already exists on expressions; the authority envelope a negotiation would act within does not.",
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
    sideEffect: "NONE",
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "NOT_YET_IMPLEMENTED",
      EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "GENERAL_AGREEMENT_RUNTIME",
    truthfulRuntimeState: "The mirror of the buyer's maximum, and the same one runtime.",
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
      REPRESENTABLE: "PASS", ROUTABLE: "PASS", PLANNABLE: "NOT_YET_IMPLEMENTED",
      EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "GENERAL_AGREEMENT_RUNTIME",
    truthfulRuntimeState: "Acceptance creates a TransactionIntent — never a payment. Commitment as a primitive does not exist yet.",
    domainBranchesRequired: 0,
  },
]);

// ── H · TRANSACTIONS ────────────────────────────────────────────────────────

const TRANSACTION_SCENARIOS: readonly Scenario[] = Object.freeze([
  ...([
    ["buy", "اشترِ لي هذا", "REMOTE_MUTATION"],
    ["sell", "بع لي هذا", "REMOTE_MUTATION"],
    ["book", "احجز لي هذه", "REMOTE_MUTATION"],
    ["reserve", "احجز المساحة لأسبوع", "REMOTE_MUTATION"],
    ["cancel", "ألغِ الطلب", "REMOTE_MUTATION"],
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
      PLANNABLE: "NOT_YET_IMPLEMENTED",
      EXECUTABLE: "NOT_YET_IMPLEMENTED",
      OBSERVABLE: "PASS",
      VERIFIABLE: "PASS",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: "GENERAL_TRANSACTION_FULFILLMENT" as const,
    truthfulRuntimeState:
      "Commercial orders, payment intents and an economic ledger exist in Block 3. A generic Agreement → Transaction → Fulfillment path a conversation can drive does not.",
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
      EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "PASS", VERIFIABLE: "PASS",
      PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "GENERAL_TRANSACTION_FULFILLMENT",
    truthfulRuntimeState:
      "TRANSACTION = CREATED does not make FULFILLMENT = VERIFIED. The verification runtime is ready to receive the observation; nothing produces one for a delivery yet.",
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
  ([
    ["price", "راقب السعر وأخبرني إذا نزل"],
    ["state", "راقب حالة الطلب"],
    ["standing_condition", "إذا نزل تحت 200 اشترِ"],
    ["notify_on_condition", "نبّهني إذا تأخر"],
    ["repeated_observation", "اقرأ الحرارة كل ساعة"],
  ] as const).map(([id, goal]) => ({
    id: `monitoring.${id}`,
    goal,
    family: "MONITORING" as const,
    route: "MONITORING" as const,
    primitives: ["Goal", "Constraint", "Observation", "Event", "Time", "Authority"] as const,
    capabilities: ["MONITOR", "OBSERVE", "NOTIFY"] as const,
    providers: ["NONE"] as const,
    sideEffect: "NONE" as const,
    requiresApproval: false,
    gates: ROUTED_ONLY({ OBSERVABLE: "PASS", PRESENTABLE: "PASS", PERSISTENT: "PASS" }),
    currentBlocker: "MONITORING_ENGINE" as const,
    truthfulRuntimeState:
      "Routed to MONITORING, which reports NOT_IMPLEMENTED. Durable temporal triggers and canonical observations both exist; nothing evaluates a standing condition over them.",
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
    primitives: ["Reference", "Observation", "Event", "Time"] as const,
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
  ([
    ["business_world", "أنشئ نظامًا دائمًا لشركتي"],
    ["warehouse_world", "أنشئ نظام مستودع"],
    ["operational_world", "أنشئ نظام تشغيل يومي"],
    ["policy_mutation", "غيّر سياسة الموافقات في نظامي"],
    ["data_mutation", "أضف حقلاً جديدًا في نظامي"],
    ["permission_mutation", "اعطِ فريقي صلاحية القراءة فقط"],
  ] as const).map(([id, goal]) => ({
    id: `world.${id}`,
    goal,
    family: "WORLDS" as const,
    route: "PERSISTENT_WORLD" as const,
    primitives: ["Actor", "Resource", "Policy", "Authority", "Event"] as const,
    capabilities: ["PERSIST", "MUTATE", "PRESENT"] as const,
    providers: ["NONE"] as const,
    sideEffect: "INTERNAL_STATE" as const,
    requiresApproval: true,
    gates: ROUTED_ONLY({ PRESENTABLE: "PASS" }),
    currentBlocker: "PERSISTENT_WORLD_MATERIALIZATION" as const,
    truthfulRuntimeState:
      "Routed to PERSISTENT_WORLD, which reports NOT_IMPLEMENTED. World records exist in the schema; materialisation and mutation from a conversation do not.",
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

const BUSINESS_SCENARIOS: readonly Scenario[] = Object.freeze(
  ([
    ["scope", "أنشئ حساب شركتي"],
    ["team", "أضف موظفًا إلى فريقي"],
    ["permissions", "اعطه صلاحية العروض فقط"],
    ["offerings", "انشر عروضي"],
    ["needs", "انشر احتياجاتي"],
    ["resources", "سجّل معداتي"],
    ["capacity", "سجّل طاقتي المتاحة"],
    ["policies", "ضع سياسة: لا تبيع بأقل من التكلفة"],
    ["provider_bindings", "اربط نظام المخزون عندي"],
    ["analytics", "أرني أداء المبيعات"],
    ["world_association", "اربط نظام شركتي بهذا الحساب"],
  ] as const).map(([id, goal]) => ({
    id: `business.${id}`,
    goal,
    family: "BUSINESS" as const,
    route: "GENERAL_PLANGRAPH" as const,
    primitives: ["Actor", "Policy", "Authority", "Resource", "Capacity"] as const,
    capabilities: ["PERSIST", "MUTATE", "PRESENT"] as const,
    providers: ["NONE"] as const,
    sideEffect: "INTERNAL_STATE" as const,
    requiresApproval: true,
    gates: gates({
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      EXECUTABLE: "NOT_YET_IMPLEMENTED",
      OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: "BUSINESS_SCOPE_RUNTIME" as const,
    truthfulRuntimeState:
      "Memberships, delegation grants and owner-scoped expressions exist. A Business as a first-class scope that owns data, offerings, policies and provider bindings does not. A Business is a scope, never a domain app.",
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
      EXECUTABLE: "NOT_YET_IMPLEMENTED", OBSERVABLE: "BLOCKED_BY_PROVIDER",
      VERIFIABLE: "BLOCKED_BY_PROVIDER", PRESENTABLE: "PASS", PERSISTENT: "PASS",
    }),
    currentBlocker: "GENERAL_TRANSACTION_FULFILLMENT",
    truthfulRuntimeState:
      "Fee rules and an economic ledger exist. A commission is generic transaction economics, never a marketplace of its own.",
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
    ["same_core", "شغّل جاسم لمطعمي"],
    ["business_data", "اجعله يرى بيانات مطعمي فقط"],
    ["branding", "اجعل اسمه وشعاره لمطعمي"],
    ["policies", "طبّق سياسات مطعمي"],
    ["permissions", "حدد ما يراه الموظفون"],
    ["providers", "اربط مزوداتي"],
  ] as const).map(([id, goal]) => ({
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
      EXECUTABLE: "NOT_YET_IMPLEMENTED",
      OBSERVABLE: "NOT_APPLICABLE",
      VERIFIABLE: "NOT_APPLICABLE",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: "BUSINESS_SCOPE_RUNTIME" as const,
    truthfulRuntimeState:
      "JASIM OS is the same core with a business scope, its data, its policies and its branding. There is no second intelligence, and building one would be the failure.",
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
    capabilities: ["UNDERSTAND", "ROUTE", "DISCOVER", "PROPOSE", "AGREE", "OBSERVE", "VERIFY"] as const,
    providers: ["NONE"] as const,
    sideEffect: "NONE" as const,
    requiresApproval: false,
    gates: gates({
      // What the holdout suite actually tests today.
      REPRESENTABLE: "PASS",
      ROUTABLE: "PASS",
      PLANNABLE: "PASS",
      // Everything below waits on the same general subsystems as the named
      // scenarios. A holdout may never score above the mechanism it needs.
      EXECUTABLE: "NOT_YET_IMPLEMENTED",
      OBSERVABLE: "PASS",
      VERIFIABLE: "PASS",
      PRESENTABLE: "PASS",
      PERSISTENT: "PASS",
    }),
    currentBlocker: "OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH" as const,
    truthfulRuntimeState:
      "Represented and routed with existing primitives and no new branch. Its effect, once one exists, verifies through the same observation runtime the named scenarios use.",
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
  return Object.freeze({
    totalScenarios: scenarios.length,
    gates: Object.freeze(counts),
    blockedByProvider,
    blockedByEnvironment,
    notYetImplemented,
    generalGaps: Object.freeze([...gapsSeen].sort()),
    holdouts: holdouts.length,
    holdoutsRequiringDomainBranch: holdouts.filter((s) => s.domainBranchesRequired > 0).length,
    domainBranchesRequired: scenarios.reduce((total, s) => total + s.domainBranchesRequired, 0),
  });
}

/** `PASS` count for one gate. The only figure allowed to stand alone. */
export function passCount(gate: Gate, scenarios: readonly Scenario[] = SCENARIOS): number {
  return scenarios.filter((scenario) => scenario.gates[gate] === "PASS").length;
}
