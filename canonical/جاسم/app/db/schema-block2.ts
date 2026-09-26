// ============================================================================
// JASIM BLOCK 2 — OPERATIONAL FABRIC (generic, domain-free)
//
// Ten canonical tables. No domain nouns: every subject/resource is a
// (kind, id) reference; every semantic lives in typed generic columns.
// Varchar state columns with $type unions follow the schema-runtime.ts
// convention (portable, no custom PG enum types required).
// ============================================================================

import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// 1. MEMBERSHIPS — explicit authorization for SHARED visibility and
//    participation. Cross-owner access without a valid grant: DENY.
// ---------------------------------------------------------------------------

export type MembershipState = "invited" | "active" | "revoked" | "expired";

export const memberships = pgTable(
  "memberships",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /** Owner of the resource granting access. */
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    /** Participant receiving access (user/entity/agent id). */
    subjectId: varchar("subjectId", { length: 100 }).notNull(),
    subjectKind: varchar("subjectKind", { length: 24 }).notNull().default("user"),
    /** Generic resource class, e.g. "economic_expression" — never a domain noun. */
    resourceKind: varchar("resourceKind", { length: 64 }).notNull(),
    /** Concrete resource id, or "*" for the whole owner scope of resourceKind. */
    resourceId: varchar("resourceId", { length: 64 }).notNull().default("*"),
    /** Generated-world role label (data only — enforcement is generic). */
    role: varchar("role", { length: 64 }),
    permissions: text("permissions").array().notNull().default([]),
    purpose: varchar("purpose", { length: 255 }),
    state: varchar("state", { length: 16 }).notNull().$type<MembershipState>().default("active"),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    revokedAt: timestamp("revokedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("memberships_grant_idx").on(
      table.ownerId,
      table.subjectId,
      table.resourceKind,
      table.resourceId,
    ),
    index("memberships_subject_idx").on(table.subjectId, table.state),
  ],
);

// ---------------------------------------------------------------------------
// 2. DELEGATION GRANTS — principal → delegate bounded authority.
//    CHILD_DELEGATED_AUTHORITY ⊆ PARENT_AUTHORITY, enforced deterministically.
// ---------------------------------------------------------------------------

export type DelegationGrantState = "active" | "revoked" | "expired";

export const delegationGrants = pgTable(
  "delegation_grants",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    principalOwnerId: varchar("principalOwnerId", { length: 100 }).notNull(),
    delegateId: varchar("delegateId", { length: 100 }).notNull(),
    delegateKind: varchar("delegateKind", { length: 24 }).notNull().default("agent"),
    purpose: varchar("purpose", { length: 255 }).notNull(),
    allowedCapabilities: text("allowedCapabilities").array().notNull().default([]),
    deniedCapabilities: text("deniedCapabilities").array().notNull().default([]),
    resourceScope: jsonb("resourceScope")
      .$type<{ kinds?: string[]; ids?: string[] }>()
      .notNull()
      .default({}),
    constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull().default({}),
    /** Optional monetary ceiling; numeric string preserved exactly. */
    maxMonetary: numeric("maxMonetary", { precision: 24, scale: 6 }),
    currency: varchar("currency", { length: 8 }),
    validFrom: timestamp("validFrom", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    /** 0 = cannot re-delegate. Depth is monotonically bounded downward. */
    maxDepth: integer("maxDepth").notNull().default(0),
    depth: integer("depth").notNull().default(0),
    parentGrantId: varchar("parentGrantId", { length: 64 }),
    state: varchar("state", { length: 16 })
      .notNull()
      .$type<DelegationGrantState>()
      .default("active"),
    revokedAt: timestamp("revokedAt", { withTimezone: true }),
    /** sha256 over the canonical grant terms — staleness/replay protection. */
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("delegation_grants_principal_idx").on(table.principalOwnerId, table.state),
    index("delegation_grants_delegate_idx").on(table.delegateId, table.state),
  ],
);

// ---------------------------------------------------------------------------
// 3. TEMPORAL TRIGGERS — thin persisted layer over the existing durable
//    worker (availableAt claim loop). Not a scheduler engine.
// ---------------------------------------------------------------------------

export type TemporalTriggerKind =
  | "AT"
  | "AFTER"
  | "DEADLINE"
  | "RECURRING"
  | "CONDITION"
  | "EVENT";

export type TemporalTriggerState =
  | "active"
  | "paused"
  | "cancelled"
  | "fired"
  | "completed"
  | "expired";

export type RecurrenceRule = {
  /** Constrained native recurrence — no cron framework. */
  freq: "daily" | "weekly" | "weekdays";
  interval?: number;
  /** Wall-clock "HH:MM" in `timezone`. */
  timeOfDay: string;
  byWeekdays?: number[];
  until?: string;
  count?: number;
};

export const temporalTriggers = pgTable(
  "temporal_triggers",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    runId: uuid("runId"),
    nodeId: uuid("nodeId"),
    kind: varchar("kind", { length: 16 }).notNull().$type<TemporalTriggerKind>(),
    /** Next deterministic UTC fire time; the durable worker wakes on this. */
    fireAt: timestamp("fireAt", { withTimezone: true }),
    timezone: varchar("timezone", { length: 64 }),
    recurrence: jsonb("recurrence").$type<RecurrenceRule>(),
    condition: jsonb("condition").$type<Record<string, unknown>>(),
    eventFilter: jsonb("eventFilter").$type<{ eventType?: string; match?: Record<string, unknown> }>(),
    /** What happens on fire: durable-job kind + payload, or run/node wake. */
    continuation: jsonb("continuation")
      .$type<{ jobKind?: string; jobPayload?: Record<string, unknown>; resumeNode?: boolean }>()
      .notNull()
      .default({}),
    state: varchar("state", { length: 16 })
      .notNull()
      .$type<TemporalTriggerState>()
      .default("active"),
    lastFiredAt: timestamp("lastFiredAt", { withTimezone: true }),
    fireCount: integer("fireCount").notNull().default(0),
    maxFires: integer("maxFires"),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("temporal_triggers_owner_idem_idx").on(table.ownerId, table.idempotencyKey),
    index("temporal_triggers_due_idx").on(table.state, table.fireAt),
    index("temporal_triggers_run_idx").on(table.runId),
  ],
);

// ---------------------------------------------------------------------------
// 4. AVAILABILITY WINDOWS — generic capacity per resource per time window.
//    capacityHeld is mutated ONLY via conditional SQL decrement/increment.
// ---------------------------------------------------------------------------

export const availabilityWindows = pgTable(
  "availability_windows",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /** Resource owner (the side that offers capacity). */
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    resourceKind: varchar("resourceKind", { length: 64 }).notNull(),
    resourceId: varchar("resourceId", { length: 64 }).notNull(),
    startsAt: timestamp("startsAt", { withTimezone: true }).notNull(),
    endsAt: timestamp("endsAt", { withTimezone: true }).notNull(),
    timezone: varchar("timezone", { length: 64 }),
    /** Canonical unit after deterministic UNIT normalization. */
    unit: varchar("unit", { length: 32 }).notNull(),
    capacityTotal: numeric("capacityTotal", { precision: 24, scale: 6 }).notNull(),
    capacityHeld: numeric("capacityHeld", { precision: 24, scale: 6 }).notNull().default("0"),
    state: varchar("state", { length: 16 }).notNull().$type<"open" | "closed">().default("open"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("availability_windows_resource_idx").on(
      table.resourceKind,
      table.resourceId,
      table.state,
      table.startsAt,
    ),
    index("availability_windows_owner_idx").on(table.ownerId),
  ],
);

// ---------------------------------------------------------------------------
// 5. RESERVATIONS — atomic, idempotent, expiring capacity allocation.
// ---------------------------------------------------------------------------

export type ReservationStatus =
  | "HELD"
  | "CONFIRMED"
  | "RELEASED"
  | "EXPIRED"
  | "CANCELLED"
  | "FAILED";

export const reservations = pgTable(
  "reservations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /** Requester. */
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    /** Resource owner (capacity side). */
    resourceOwnerId: varchar("resourceOwnerId", { length: 100 }).notNull(),
    windowId: varchar("windowId", { length: 64 }),
    resourceKind: varchar("resourceKind", { length: 64 }).notNull(),
    resourceId: varchar("resourceId", { length: 64 }).notNull(),
    quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(),
    unit: varchar("unit", { length: 32 }).notNull(),
    startsAt: timestamp("startsAt", { withTimezone: true }),
    endsAt: timestamp("endsAt", { withTimezone: true }),
    status: varchar("status", { length: 16 })
      .notNull()
      .$type<ReservationStatus>()
      .default("HELD"),
    version: integer("version").notNull().default(1),
    /** Held capacity returns automatically after this (via TemporalTrigger). */
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    /** Links the legs of a composite (multi-resource) reservation. */
    compositeGroupId: varchar("compositeGroupId", { length: 64 }),
    matchId: varchar("matchId", { length: 64 }),
    expressionId: varchar("expressionId", { length: 64 }),
    runId: uuid("runId"),
    nodeId: uuid("nodeId"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("reservations_owner_idem_idx").on(table.ownerId, table.idempotencyKey),
    index("reservations_resource_idx").on(table.resourceKind, table.resourceId, table.status),
    index("reservations_expiry_idx").on(table.status, table.expiresAt),
    index("reservations_composite_idx").on(table.compositeGroupId),
  ],
);

// ---------------------------------------------------------------------------
// 6. OBSERVATIONS — append-only, provenance-carrying evidence.
//    An Observation is NOT eternal canonical fact.
// ---------------------------------------------------------------------------

export const observations = pgTable(
  "observations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    subjectKind: varchar("subjectKind", { length: 64 }).notNull(),
    subjectId: varchar("subjectId", { length: 64 }).notNull(),
    observationType: varchar("observationType", { length: 64 }).notNull(),
    observedAt: timestamp("observedAt", { withTimezone: true }).notNull(),
    sourceKind: varchar("sourceKind", { length: 32 }).notNull().default("system"),
    providerId: varchar("providerId", { length: 128 }),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Freshness horizon — after this the observation is STALE, never fresh. */
    freshnessExpiresAt: timestamp("freshnessExpiresAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("observations_subject_idx").on(
      table.subjectKind,
      table.subjectId,
      table.observationType,
      table.observedAt,
    ),
    index("observations_owner_idx").on(table.ownerId),
  ],
);

// ---------------------------------------------------------------------------
// 7. TRACK SESSIONS — purpose-bound, authorization-aware live tracking.
//    TRACK != MAP: a map projection requires real coordinate evidence.
// ---------------------------------------------------------------------------

export type TrackSessionState = "active" | "closed" | "expired";

export const trackSessions = pgTable(
  "track_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    subjectKind: varchar("subjectKind", { length: 64 }).notNull(),
    subjectId: varchar("subjectId", { length: 64 }).notNull(),
    purpose: varchar("purpose", { length: 255 }).notNull(),
    /** Who may see what precision until when — enforced at projection. */
    viewerScope: jsonb("viewerScope")
      .$type<{
        viewers?: Array<{ subjectId: string; precision?: "exact" | "approximate"; until?: string }>;
        defaultPrecision?: "exact" | "approximate" | "none";
      }>()
      .notNull()
      .default({}),
    latestObservationId: varchar("latestObservationId", { length: 64 }),
    state: varchar("state", { length: 16 })
      .notNull()
      .$type<TrackSessionState>()
      .default("active"),
    assignmentId: varchar("assignmentId", { length: 64 }),
    runId: uuid("runId"),
    startedAt: timestamp("startedAt", { withTimezone: true }).defaultNow().notNull(),
    endsAt: timestamp("endsAt", { withTimezone: true }),
    endedAt: timestamp("endedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("track_sessions_subject_idx").on(table.subjectKind, table.subjectId, table.state),
    index("track_sessions_owner_idx").on(table.ownerId, table.state),
  ],
);

// ---------------------------------------------------------------------------
// 8. ASSIGNMENTS — generic participant/resource commitment lifecycle.
//    Same primitive for any participant kind; no DriverAssignment etc.
// ---------------------------------------------------------------------------

export type AssignmentState =
  | "OFFERED"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED";

export const assignments = pgTable(
  "assignments",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /** Assigning owner. */
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    /** Assigned participant/resource. */
    subjectKind: varchar("subjectKind", { length: 64 }).notNull(),
    subjectId: varchar("subjectId", { length: 64 }).notNull(),
    terms: jsonb("terms").$type<Record<string, unknown>>().notNull().default({}),
    state: varchar("state", { length: 16 })
      .notNull()
      .$type<AssignmentState>()
      .default("OFFERED"),
    matchId: varchar("matchId", { length: 64 }),
    runId: uuid("runId"),
    nodeId: uuid("nodeId"),
    offerExpiresAt: timestamp("offerExpiresAt", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("assignments_owner_idem_idx").on(table.ownerId, table.idempotencyKey),
    index("assignments_subject_idx").on(table.subjectKind, table.subjectId, table.state),
    index("assignments_run_idx").on(table.runId),
  ],
);

// ---------------------------------------------------------------------------
// 9. REMOTE EXECUTIONS — ONE primitive shared by MCP and A2A.
//    REMOTE EXECUTION != JASIM RUN: the JASIM Run stays canonical above it.
// ---------------------------------------------------------------------------

export type RemoteExecutionState =
  | "INVOKED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCEL_REQUESTED"
  | "CANCEL_CONFIRMED"
  | "INCONCLUSIVE";

export const remoteExecutions = pgTable(
  "remote_executions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    runId: uuid("runId").notNull(),
    nodeId: uuid("nodeId").notNull(),
    providerId: varchar("providerId", { length: 128 }).notNull(),
    bindingId: varchar("bindingId", { length: 128 }),
    protocolKind: varchar("protocolKind", { length: 16 }).notNull().$type<"MCP" | "A2A">(),
    /** Provider-side task/reference id once the provider returns one. */
    remoteReference: varchar("remoteReference", { length: 255 }),
    state: varchar("state", { length: 24 })
      .notNull()
      .$type<RemoteExecutionState>()
      .default("INVOKED"),
    requestDigest: varchar("requestDigest", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    /** A2A bounded delegation backing; never self-granted by the remote. */
    delegationGrantId: varchar("delegationGrantId", { length: 64 }),
    lastObservedAt: timestamp("lastObservedAt", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("remote_executions_owner_idem_idx").on(table.ownerId, table.idempotencyKey),
    index("remote_executions_run_idx").on(table.runId, table.nodeId),
    index("remote_executions_remote_ref_idx").on(table.providerId, table.remoteReference),
  ],
);

// ---------------------------------------------------------------------------
// 10. NOTIFICATION INTENTS — semantic intent is identity; channel/provider
//     is implementation. Every effect flows through the Trusted Executor.
// ---------------------------------------------------------------------------

export type NotificationState =
  | "QUEUED"
  | "PROVIDER_ACCEPTED"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "INCONCLUSIVE"
  | "BLOCKED_BY_PROVIDER";

export type NotificationChannelState = {
  state: NotificationState;
  providerReference?: string;
  /** Canonical execution-attempt lineage for the provider effect. */
  attemptId?: string;
  at?: string;
  error?: string;
};

export const notificationIntents = pgTable(
  "notification_intents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /** Sending owner (Run owner). */
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    recipientId: varchar("recipientId", { length: 100 }).notNull(),
    purpose: varchar("purpose", { length: 255 }).notNull(),
    /** Safe summary content only — never protected internals. */
    content: jsonb("content")
      .$type<{ title: string; body: string; actionUrl?: string; data?: Record<string, unknown> }>()
      .notNull(),
    privacyClass: varchar("privacyClass", { length: 24 })
      .notNull()
      .$type<"public" | "standard" | "sensitive">()
      .default("standard"),
    urgency: varchar("urgency", { length: 16 })
      .notNull()
      .$type<"normal" | "high" | "critical">()
      .default("normal"),
    channels: text("channels").array().notNull().default([]),
    state: varchar("state", { length: 24 })
      .notNull()
      .$type<NotificationState>()
      .default("QUEUED"),
    /** Per-channel truthful evidence: SENT != DELIVERED != READ. */
    channelStates: jsonb("channelStates")
      .$type<Record<string, NotificationChannelState>>()
      .notNull()
      .default({}),
    runId: uuid("runId"),
    nodeId: uuid("nodeId"),
    entityRef: jsonb("entityRef").$type<{ kind: string; id: string }>(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("notification_intents_owner_idem_idx").on(table.ownerId, table.idempotencyKey),
    index("notification_intents_recipient_idx").on(table.recipientId, table.state),
  ],
);

// ---------------------------------------------------------------------------
// TYPE EXPORTS
// ---------------------------------------------------------------------------

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type DelegationGrant = typeof delegationGrants.$inferSelect;
export type NewDelegationGrant = typeof delegationGrants.$inferInsert;
export type TemporalTrigger = typeof temporalTriggers.$inferSelect;
export type NewTemporalTrigger = typeof temporalTriggers.$inferInsert;
export type AvailabilityWindow = typeof availabilityWindows.$inferSelect;
export type NewAvailabilityWindow = typeof availabilityWindows.$inferInsert;
export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;
export type Observation = typeof observations.$inferSelect;
export type NewObservation = typeof observations.$inferInsert;
export type TrackSession = typeof trackSessions.$inferSelect;
export type NewTrackSession = typeof trackSessions.$inferInsert;
export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;
export type RemoteExecution = typeof remoteExecutions.$inferSelect;
export type NewRemoteExecution = typeof remoteExecutions.$inferInsert;
export type NotificationIntent = typeof notificationIntents.$inferSelect;
export type NewNotificationIntent = typeof notificationIntents.$inferInsert;

// ---------------------------------------------------------------------------
// ACTOR SCOPE — an organization is a scope that owns things, not a second
// kind of system. Every table already keys on `ownerId`, which has always
// meant "acting scope"; an organization is another value that column can hold.
// ---------------------------------------------------------------------------

export const organizations = pgTable(
  "organizations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    displayName: varchar("displayName", { length: 200 }).notNull(),
    /** Lineage, not authority. Authority comes from membership. */
    createdByPrincipalId: varchar("createdByPrincipalId", { length: 100 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    /**
     * What this organization is, as DATA. A "restaurant" lives here and never
     * as a type in the core: a factory, a school and a clinic differ in their
     * attributes, never in their architecture.
     */
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("organizations_principal_idx").on(table.createdByPrincipalId)],
);

export const scopePolicies = pgTable(
  "scope_policies",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    scopeId: varchar("scopeId", { length: 100 }).notNull(),
    policyKey: varchar("policyKey", { length: 120 }).notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    version: integer("version").notNull().default(1),
    state: varchar("state", { length: 16 }).notNull().default("active"),
    setByPrincipalId: varchar("setByPrincipalId", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("scope_policies_scope_idx").on(table.scopeId, table.policyKey, table.version)],
);

export const scopeProviderBindings = pgTable(
  "scope_provider_bindings",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    scopeId: varchar("scopeId", { length: 100 }).notNull(),
    providerClass: varchar("providerClass", { length: 64 }).notNull(),
    providerId: varchar("providerId", { length: 120 }).notNull(),
    /** A NAME, never a secret. The value lives in the environment. */
    credentialEnvName: varchar("credentialEnvName", { length: 160 }),
    state: varchar("state", { length: 16 }).notNull().default("active"),
    boundByPrincipalId: varchar("boundByPrincipalId", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revokedAt", { withTimezone: true }),

    // ── THE CONNECTOR BINDING RUNTIME ────────────────────────────────────
    //
    //   CONNECTED != VERIFIED · READ != WRITE
    //   SETUP_LINK_CREATED != CREDENTIAL_STORED != AUTHENTICATED != VERIFIED
    //
    // A NULL `lifecycle` is a legacy environment-named binding. The connector
    // runtime refuses to use one, so nothing became usable by being migrated.

    /** Which registered PROVIDER DEFINITION this is an instance of. */
    definitionId: varchar("definitionId", { length: 120 }),
    lifecycle: varchar("lifecycle", { length: 16 }),
    /** What was asked for. A request, never a grant. */
    requestedCapabilities: jsonb("requestedCapabilities")
      .$type<string[]>()
      .notNull()
      .default([]),
    /** What the provider itself says this connection can do. */
    discoveredCapabilities: jsonb("discoveredCapabilities")
      .$type<string[]>()
      .notNull()
      .default([]),
    /** What it may actually do. Written only by verification. */
    grantedCapabilities: jsonb("grantedCapabilities").$type<string[]>().notNull().default([]),
    /** A REFERENCE into the credential vault. Never credential material. */
    credentialRef: varchar("credentialRef", { length: 64 }),
    /** Exactly one version is current, so a rotation is never ambiguous. */
    credentialVersion: integer("credentialVersion").notNull().default(0),
    /**
     * A REFERENCE to the material that authenticates this account's CALLBACKS.
     *
     * Beside `credentialRef` and never merged into it: one proves who JASIM is
     * when it calls out, the other proves the provider is who called in.
     *
     *   WEBHOOK_SECRET != PROVIDER_CREDENTIAL
     *   WEBHOOK_SECRET != PUBLIC PROVIDER METADATA
     */
    webhookCredentialRef: varchar("webhookCredentialRef", { length: 64 }),
    /** Exactly one version is current, so a rotation is never ambiguous. */
    webhookCredentialVersion: integer("webhookCredentialVersion").notNull().default(0),
    /** Non-sensitive identity of the far side, as the provider reported it. */
    accountRef: varchar("accountRef", { length: 191 }),
    accountLabel: varchar("accountLabel", { length: 191 }),
    /** Declared at setup for custom providers; checked before it is stored. */
    endpointUrl: varchar("endpointUrl", { length: 512 }),
    setupSessionId: varchar("setupSessionId", { length: 64 }),
    setupExpiresAt: timestamp("setupExpiresAt", { withTimezone: true }),
    setupConsumedAt: timestamp("setupConsumedAt", { withTimezone: true }),
    authenticatedAt: timestamp("authenticatedAt", { withTimezone: true }),
    verifiedAt: timestamp("verifiedAt", { withTimezone: true }),
    suspendedReason: varchar("suspendedReason", { length: 191 }),
  },
  (table) => [
    uniqueIndex("scope_provider_bindings_unique_idx").on(
      table.scopeId,
      table.providerClass,
      table.providerId,
    ),
    index("scope_provider_bindings_lifecycle_idx").on(table.scopeId, table.lifecycle),
  ],
);

/**
 * WHERE CREDENTIAL MATERIAL LIVES, AND THE ONLY PLACE IT LIVES.
 *
 *   RAW_PROVIDER_SECRET_IN_CANONICAL_BINDING = 0
 *   RAW_PROVIDER_SECRET_IN_EVENT_LOG = 0
 *   MODEL_SEES_PROVIDER_SECRET = 0
 *
 * Sealed with the repository's own AES-256-GCM envelope, additionally
 * authenticated over the scope, the binding and the credential version — so a
 * sealed value cannot be replayed into another binding or an older rotation.
 * No column here can be read as plaintext by anything that does not hold the
 * key, and nothing in this table is ever projected to a person or a model.
 */
export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    scopeId: varchar("scopeId", { length: 100 }).notNull(),
    bindingId: varchar("bindingId", { length: 64 }).notNull(),
    /**
     * WHICH KIND of material this envelope holds.
     *
     *   PROVIDER_AUTH — what JASIM spends to call the provider.
     *   WEBHOOK_VERIFICATION — what JASIM checks a callback's signature with.
     *
     * One store, two kinds. They are issued at different provider surfaces and
     * rotate on different days, so one may never be retired by rotating the
     * other — which is also why the unique index below counts the kind.
     */
    kind: varchar("kind", { length: 32 }).notNull().default("PROVIDER_AUTH"),
    version: integer("version").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: varchar("iv", { length: 64 }).notNull(),
    authTag: varchar("authTag", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    retiredAt: timestamp("retiredAt", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("provider_credentials_binding_kind_version_idx").on(
      table.bindingId,
      table.kind,
      table.version,
    ),
  ],
);

export type ProviderCredentialRow = typeof providerCredentials.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// THE GENERAL AGREEMENT RUNTIME
//
//   Intent != Proposal != Approval != Agreement != Transaction != Fulfillment
//
// One mechanism for every subject. No table here names what is being
// negotiated, and no column branches on it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One party's BOUNDED AUTHORITY inside one engagement.
 *
 * `bounds` carries, per term, the direction, the target and the RESERVE. The
 * reserve is the limit JASIM may act to; the target is what the person would
 * like, and `TARGET != AUTHORITY`.
 *
 * Append-only and versioned. Authority that could be edited in place would let
 * an agreement be re-explained after it was reached.
 */
export const negotiationEnvelopes = pgTable(
  "negotiation_envelopes",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    engagementId: varchar("engagementId", { length: 64 }).notNull(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    bounds: jsonb("bounds").$type<Record<string, unknown>>().notNull().default({}),
    /** Undeclared authority is NO authority. Both default to false. */
    mayConcede: boolean("mayConcede").notNull().default(false),
    mayAcceptWithinReserve: boolean("mayAcceptWithinReserve").notNull().default(false),
    version: integer("version").notNull(),
    state: varchar("state", { length: 16 }).notNull().default("active"),
    /** WHO delegated it. A scope cannot delegate to itself. */
    setByPrincipalId: varchar("setByPrincipalId", { length: 100 }).notNull(),
    supersedesId: varchar("supersedesId", { length: 64 }),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("negotiation_envelopes_scope_idx").on(table.engagementId, table.ownerId),
    uniqueIndex("negotiation_envelopes_version_idx").on(
      table.engagementId,
      table.ownerId,
      table.version,
    ),
  ],
);

/**
 * `AGREEMENT != TRANSACTION`. Nothing here moves money, books anything or tells
 * anyone. It records that two parties agreed to an exact proposal VERSION, and
 * under whose authority the acceptance happened.
 */
export const agreements = pgTable(
  "agreements",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    engagementId: varchar("engagementId", { length: 64 }).notNull(),
    proposalId: varchar("proposalId", { length: 64 }).notNull(),
    participants: jsonb("participants").$type<string[]>().notNull(),
    /** A SNAPSHOT. A later edit must not change what was agreed. */
    terms: jsonb("terms").$type<Record<string, unknown>>().notNull(),
    authorityBasis: jsonb("authorityBasis").$type<Record<string, unknown>>().notNull(),
    acceptedByOwnerId: varchar("acceptedByOwnerId", { length: 100 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("agreed"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agreements_proposal_idx").on(table.proposalId),
    index("agreements_engagement_idx").on(table.engagementId),
  ],
);

/**
 * What each party owes, as the term sheet DECLARED it — never inferred. A
 * runtime that guessed who owes what from a field name would have acquired a
 * domain in the one place it matters most.
 */
export const commitments = pgTable(
  "commitments",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    agreementId: varchar("agreementId", { length: 64 }).notNull(),
    /** Who owes it. Declared by the term, never inferred from a field name. */
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    termKey: varchar("termKey", { length: 160 }).notNull(),
    dueAt: timestamp("dueAt", { withTimezone: true }),
    /** OPEN until something OBSERVES otherwise. Never advanced by the party who owes it. */
    state: varchar("state", { length: 16 }).notNull().default("open"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    // ── The obligation, once a transaction materializes ────────────────────
    transactionId: varchar("transactionId", { length: 64 }),
    /** Who it is owed TO. With two parties, the other one — determinate. */
    beneficiaryActorId: varchar("beneficiaryActorId", { length: 100 }),
    /**
     * WHAT WOULD PROVE IT: an effect kind from the completion policy's own
     * closed set, so the evidence an obligation needs is decided by the rules
     * every capability's effect already obeys and no verifier is written per
     * domain.
     */
    evidenceKind: varchar("evidenceKind", { length: 24 }).notNull().default("HUMAN_ACTION"),
    subjectKind: varchar("subjectKind", { length: 64 }),
    subjectId: varchar("subjectId", { length: 128 }),
    /**
     * CLAIMED_COMPLETE != VERIFIED_COMPLETE.
     *
     * Two columns because they are two facts. `state` is what the world is
     * said to have done; `verification` is what JASIM can prove.
     */
    verification: varchar("verification", { length: 24 }).notNull().default("PENDING"),
    /** Exact money, when the term declared it. Never derived from a unit. */
    settlement: jsonb("settlement").$type<{ amountMinor: string; currency: string }>(),
    paymentIntentId: varchar("paymentIntentId", { length: 64 }),
    terms: jsonb("terms").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("commitments_agreement_idx").on(table.agreementId),
    index("commitments_owner_idx").on(table.ownerId),
    index("commitments_transaction_idx").on(table.transactionId),
  ],
);

/**
 * ONE transaction for every exchange there is.
 *
 *   OPPORTUNITY != PROPOSAL != AGREEMENT != COMMITMENT != TRANSACTION
 *   TRANSACTION != PAYMENT != FULFILLMENT != VERIFICATION
 *
 * No column names a buyer, a seller, a purchase or a rental. The parties are a
 * list; what each owes is an obligation; what is being exchanged lives in a
 * term key nothing in the runtime reads.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /** The acting scope: a person or an organization, resolved elsewhere. */
    scopeId: varchar("scopeId", { length: 100 }).notNull(),
    parties: jsonb("parties").$type<string[]>().notNull(),
    agreementId: varchar("agreementId", { length: 64 }).notNull(),
    proposalId: varchar("proposalId", { length: 64 }),
    engagementId: varchar("engagementId", { length: 64 }),
    /** A snapshot. A later edit must not change what was committed. */
    termsSnapshot: jsonb("termsSnapshot").$type<Record<string, unknown>>().notNull(),
    termsDigest: varchar("termsDigest", { length: 64 }).notNull(),
    /** Internal exchange, external discovery, manual proposal — it travels. */
    origin: jsonb("origin").$type<Record<string, unknown>>().notNull().default({}),
    authorityBasis: jsonb("authorityBasis").$type<Record<string, unknown>>().notNull().default({}),
    policyDecision: jsonb("policyDecision").$type<Record<string, unknown>>().notNull().default({}),
    /** DERIVED from the obligations. Nothing may write SETTLED. */
    state: varchar("state", { length: 24 }).notNull().default("OPEN"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("transactions_agreement_idx").on(table.agreementId),
    index("transactions_scope_idx").on(table.scopeId, table.state),
  ],
);

export type Transaction = typeof transactions.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// THE SECURE PRODUCT ACTION RUNTIME
//
//   CONVERSATION INITIATES · TRUSTED RUNTIME DEFINES · TRUSTED SURFACE COLLECTS
//   SERVER VALIDATES · POLICY AUTHORIZES · RUNTIME MUTATES · AUDIT RECORDS
//
//   PASSWORD · TOKEN · BIOMETRIC SECRET · PAYMENT CREDENTIAL != LLM CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One initiated product action, waiting for a trusted surface to complete it.
 *
 * Opaque, server-generated, short-lived and single-use. It names an action the
 * SERVER registered — never a schema a model invented — and it holds no
 * submitted secret: a collected value is used and discarded inside the trusted
 * boundary.
 */
export const productActionSessions = pgTable(
  "product_action_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    actionId: varchar("actionId", { length: 80 }).notNull(),
    /** A surface built for v1 may not submit into v2. */
    actionVersion: integer("actionVersion").notNull(),
    /** Null for login and signup: an anonymous person is not somebody. */
    actorId: varchar("actorId", { length: 100 }),
    /** Binds a pre-auth surface to ONE caller rather than to anyone who guesses. */
    anonymousRef: varchar("anonymousRef", { length: 128 }),
    conversationId: varchar("conversationId", { length: 64 }),
    status: varchar("status", { length: 24 }).notNull().default("INITIATED"),
    confirmed: boolean("confirmed").notNull().default(false),
    /** Rendered by the runtime from the registered schema. Never model text. */
    presentation: jsonb("presentation").$type<Record<string, unknown>>().notNull().default({}),
    /** The NON-SENSITIVE part of what was submitted. A sentinel proves it. */
    record: jsonb("record").$type<Record<string, unknown>>().notNull().default({}),
    outcome: varchar("outcome", { length: 40 }),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    completedAt: timestamp("completedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("product_action_sessions_actor_idx").on(table.actorId, table.status),
    index("product_action_sessions_expiry_idx").on(table.expiresAt),
  ],
);

/**
 * Session revocation, which did not exist.
 *
 * The session token is a stateless year-long JWT with no id of its own, so the
 * only revocation its design permits is "everything issued for this identity
 * before now". That is narrower than "log out this device", and it is recorded
 * rather than claimed.
 */
export const identitySessionRevocations = pgTable("identity_session_revocations", {
  unionId: varchar("unionId", { length: 255 }).primaryKey(),
  revokedBefore: timestamp("revokedBefore", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revokedAt", { withTimezone: true }).defaultNow().notNull(),
  reason: varchar("reason", { length: 64 }).notNull(),
});

export type ProductActionSession = typeof productActionSessions.$inferSelect;
export type IdentitySessionRevocation = typeof identitySessionRevocations.$inferSelect;

/**
 * ONE authority act, waiting for the person who must decide it.
 *
 *   APPROVAL != CLICK
 *
 * The row holds a STATEMENT the runtime wrote from canonical state and a
 * DIGEST of it. Approving cites the digest; if the statement would read
 * differently now, the approval is void. An approval that could outlive the
 * words it was given for is theatre.
 */
export const authorityRequests = pgTable(
  "authority_requests",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /** A registered act id. Never free text, never a model's sentence. */
    actType: varchar("actType", { length: 80 }).notNull(),
    /** The PERSON who must decide. A scope cannot read. */
    principalId: varchar("principalId", { length: 100 }).notNull(),
    scopeId: varchar("scopeId", { length: 100 }).notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    /** Rendered from the act's DECLARED fields, so no parameter can be hidden. */
    statement: jsonb("statement").$type<Record<string, unknown>>().notNull(),
    statementDigest: varchar("statementDigest", { length: 64 }).notNull(),
    state: varchar("state", { length: 24 }).notNull().default("PENDING"),
    resolution: varchar("resolution", { length: 40 }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    conversationId: varchar("conversationId", { length: 64 }),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decidedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("authority_requests_principal_idx").on(table.principalId, table.state),
    index("authority_requests_scope_idx").on(table.scopeId),
  ],
);

export type AuthorityRequest = typeof authorityRequests.$inferSelect;
export type NegotiationEnvelope = typeof negotiationEnvelopes.$inferSelect;
export type Agreement = typeof agreements.$inferSelect;
export type Commitment = typeof commitments.$inferSelect;

export type Organization = typeof organizations.$inferSelect;
export type ScopePolicy = typeof scopePolicies.$inferSelect;
export type ScopeProviderBinding = typeof scopeProviderBindings.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// THE GENERAL MONITORING ENGINE
//
//   CONVERSATION · STANDING CONDITION · AUTHORIZED OBSERVATION
//   DURABLE EVALUATION · STATE TRANSITION · NOTIFICATION INTENT
//
//   CONDITION_MATCHED != USER_NOTIFIED
//   UNKNOWN != ABSENT · UNKNOWN != FALSE
//   LEVEL != EDGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ONE standing condition a person asked the runtime to keep watching.
 *
 * There is no second scheduler here and no second observation system: the
 * evaluation runs inside the Block 2 sweep that already exists, and what it
 * reads is a canonical observation or an authorized query. This row is the
 * thing that did not exist — somewhere to keep WHAT is being watched, WHAT
 * counts as a match, and what the last evaluation concluded, so that a
 * repeating poll can tell "it is true" apart from "it just became true".
 */
export const standingMonitors = pgTable(
  "standing_monitors",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /** The acting scope. A person's own id, or an organization's. */
    scopeId: varchar("scopeId", { length: 64 }).notNull(),
    createdBy: varchar("createdBy", { length: 100 }).notNull(),
    conversationId: varchar("conversationId", { length: 64 }),
    /** What a person would call it. Rendered, never interpreted. */
    label: varchar("label", { length: 200 }).notNull(),
    /**
     * WHAT is watched, in the canonical observation vocabulary that already
     * exists. A property being a price or a temperature belongs to the data,
     * never to the monitor's type.
     */
    subjectKind: varchar("subjectKind", { length: 64 }).notNull(),
    subjectId: varchar("subjectId", { length: 64 }).notNull(),
    observationType: varchar("observationType", { length: 64 }).notNull(),
    /** OBSERVATION · AUTHORIZED_QUERY · WORLD_EVENT · ABSENCE. */
    sourceClass: varchar("sourceClass", { length: 24 }).notNull(),
    /** A typed condition tree the runtime validated. Never executable text. */
    condition: jsonb("condition").$type<Record<string, unknown>>().notNull(),
    /** LEVEL — it is true. EDGE — it just became true. */
    evaluationMode: varchar("evaluationMode", { length: 8 }).notNull().default("EDGE"),
    /** ONE_SHOT · REPEATING. */
    repeatPolicy: varchar("repeatPolicy", { length: 12 }).notNull().default("ONE_SHOT"),
    /** CURRENT — a stale reading may not decide. ANY — history is allowed. */
    freshnessRequirement: varchar("freshnessRequirement", { length: 8 })
      .notNull()
      .default("CURRENT"),
    /** For ABSENCE: the window an expected observation had to arrive in. */
    windowMs: integer("windowMs"),
    /** How often a scheduled evaluation runs. Never a cron string. */
    pollMs: integer("pollMs").notNull().default(60000),
    /** NOTIFY · NONE. A monitor creates no authority, so nothing else yet. */
    actionKind: varchar("actionKind", { length: 16 }).notNull().default("NOTIFY"),
    /** Channels the PERSON asked for. What is configured is a separate fact. */
    actionChannels: jsonb("actionChannels").$type<string[]>().notNull().default([]),
    /** ACTIVE · PAUSED · TRIGGERED · COMPLETED · CANCELLED · BLOCKED. */
    state: varchar("state", { length: 16 }).notNull().default("ACTIVE"),
    lastEvaluationAt: timestamp("lastEvaluationAt", { withTimezone: true }),
    /** TRUE · FALSE · UNKNOWN. Never collapsed to a boolean. */
    lastResult: varchar("lastResult", { length: 8 }),
    lastFreshness: varchar("lastFreshness", { length: 8 }),
    /** The observation id the last evaluation read. Replay is caught by it. */
    lastObservationRef: varchar("lastObservationRef", { length: 64 }),
    /** Facts the previous evaluation saw, so `changed` means something. */
    lastFacts: jsonb("lastFacts").$type<Record<string, unknown>>().notNull().default({}),
    lastMatchedAt: timestamp("lastMatchedAt", { withTimezone: true }),
    triggerCount: integer("triggerCount").notNull().default(0),
    /**
     * The `events.id` this monitor has consumed up to.
     *
     * Ordered, durable and resumable — which is what a later realtime
     * transport will subscribe from. This phase builds the cursor and none of
     * the transport.
     */
    cursor: bigint("cursor", { mode: "number" }).notNull().default(0),
    /** Bumped by every write, and every write is guarded by it. */
    version: integer("version").notNull().default(0),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("standing_monitors_scope_idx").on(table.scopeId, table.state),
    index("standing_monitors_subject_idx").on(
      table.subjectKind,
      table.subjectId,
      table.observationType,
      table.state,
    ),
    index("standing_monitors_due_idx").on(table.state, table.lastEvaluationAt),
  ],
);

/**
 * ONE evaluation, recorded.
 *
 * The ledger a person is shown and a later transport resumes from. It holds
 * the verdict, the freshness and the transition — and deliberately not the
 * payload it read, because a private row is not an audit record.
 */
export const monitorEvaluations = pgTable(
  "monitor_evaluations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /**
     * The ordered cursor. A uuid sorts by nothing, and «resume from where I
     * was» needs an ordering the database assigns rather than one a caller
     * hopes for.
     */
    cursor: bigserial("cursor", { mode: "number" }).notNull(),
    monitorId: varchar("monitorId", { length: 64 }).notNull(),
    scopeId: varchar("scopeId", { length: 64 }).notNull(),
    evaluatedAt: timestamp("evaluatedAt", { withTimezone: true }).defaultNow().notNull(),
    /** SCHEDULED · EVENT · ABSENCE_WINDOW. */
    sourceClass: varchar("sourceClass", { length: 24 }).notNull(),
    /** TRUE · FALSE · UNKNOWN. */
    result: varchar("result", { length: 8 }).notNull(),
    freshness: varchar("freshness", { length: 8 }).notNull(),
    /** NONE · RISING · FALLING · REPEAT. What changed, not what was read. */
    transition: varchar("transition", { length: 8 }).notNull().default("NONE"),
    triggered: boolean("triggered").notNull().default(false),
    observationRef: varchar("observationRef", { length: 64 }),
    /** The notification INTENT, when one was made. Not a delivery receipt. */
    notificationIntentId: varchar("notificationIntentId", { length: 64 }),
    /** What made this evaluation unique. A replay collides on it. */
    evaluationKey: varchar("evaluationKey", { length: 200 }).notNull(),
  },
  (table) => [
    uniqueIndex("monitor_evaluations_key_idx").on(table.monitorId, table.evaluationKey),
    index("monitor_evaluations_monitor_idx").on(table.monitorId, table.cursor),
    index("monitor_evaluations_scope_idx").on(table.scopeId, table.evaluatedAt),
  ],
);

export type StandingMonitor = typeof standingMonitors.$inferSelect;
export type MonitorEvaluation = typeof monitorEvaluations.$inferSelect;

// ---------------------------------------------------------------------------
// 23. LIVING OBJECTS — a durable, authorized HANDLE on a subject a scope is
//     following.
//
//     LIVING_OBJECT != CANONICAL_SUBJECT
//     LIVING_OBJECT != WORLD · != RUN · != MONITOR_EXECUTION
//     DUPLICATE_OPERATIONAL_TRUTH = 0
//
//     There is no status, title, progress or payload column here, and there
//     must never be one. Everything a follower is shown is read from the
//     canonical row at projection time, so a handle can never disagree with
//     the thing it points at. What is stored is FOLLOWER state: who follows
//     what, since when, why, whether the surface still shows it, and how far
//     this follower has been reconciled.
//
//     SURFACE_EXIT != LIVING_OBJECT_DELETE
//     HIDE != CANCEL · CANCEL != DELETE · RESOLVED != ERASED
// ---------------------------------------------------------------------------

/** FOLLOWING · RESOLVED · RELEASED. None of the three touches the subject. */
export type LivingObjectFollowState = "FOLLOWING" | "RESOLVED" | "RELEASED";

/** VISIBLE · HIDDEN. Leaving a surface is a surface fact and nothing more. */
export type LivingObjectSurfaceState = "VISIBLE" | "HIDDEN";

export const livingObjects = pgTable(
  "living_objects",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /**
     * The ACTING scope that follows it. An organization's tracked things are
     * the organization's; a person's own scope does not see them, and a
     * membership that was revoked stops seeing them too.
     */
    scopeId: varchar("scopeId", { length: 64 }).notNull(),
    /** A canonical subject kind. Never a domain noun. */
    subjectKind: varchar("subjectKind", { length: 32 }).notNull(),
    subjectId: varchar("subjectId", { length: 128 }).notNull(),
    followState: varchar("followState", { length: 16 })
      .notNull()
      .$type<LivingObjectFollowState>()
      .default("FOLLOWING"),
    surfaceState: varchar("surfaceState", { length: 16 })
      .notNull()
      .$type<LivingObjectSurfaceState>()
      .default("VISIBLE"),
    /** Where it came from, so a handle is explainable without replaying a turn. */
    originConversationId: varchar("originConversationId", { length: 64 }),
    materializedBy: varchar("materializedBy", { length: 100 }).notNull(),
    /** Why it exists, from a closed structural vocabulary. */
    reason: varchar("reason", { length: 32 }).notNull(),
    /**
     * Reconciliation cursor: what this FOLLOWER has already been shown. It is
     * follower state, not subject state — the subject's own revision is always
     * read from the subject.
     */
    lastSeenRevision: varchar("lastSeenRevision", { length: 120 }),
    lastSeenAt: timestamp("lastSeenAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Materialization is idempotent because of this constraint, not because of
    // a check somebody remembered to write.
    uniqueIndex("living_objects_scope_subject_key").on(
      table.scopeId,
      table.subjectKind,
      table.subjectId,
    ),
    index("living_objects_scope_idx").on(table.scopeId, table.followState, table.surfaceState),
    index("living_objects_subject_idx").on(table.subjectKind, table.subjectId),
    index("living_objects_updated_idx").on(table.scopeId, table.updatedAt),
  ],
);

export type LivingObjectRow = typeof livingObjects.$inferSelect;

// ---------------------------------------------------------------------------
// 24. CONVERSATIONAL NEEDS — what somebody currently wants, carried by the
//     RUNTIME rather than by the model's memory or by the chat transcript.
//
//     NEED_CONTINUITY != CHAT_HISTORY_AS_TRUTH · != MODEL_MEMORY
//     NEED_CONTINUITY != LIVING_OBJECT · != TRANSACTION · != USER_PROFILE_MEMORY
//     TOPIC_SWITCH != NEED_RESOLVED
//
//     The columns are the GoalSpec's own fields, because a conversational need
//     IS a goal that outlived its turn. No column names a kind of thing.
//
//       DOMAIN_NEED_TYPES_ADDED = 0
// ---------------------------------------------------------------------------

/** ACTIVE · BACKGROUND · RESOLVED · ABANDONED. Turning away is not finishing. */
export type ConversationNeedState = "ACTIVE" | "BACKGROUND" | "RESOLVED" | "ABANDONED";

export const conversationNeeds = pgTable(
  "conversation_needs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    conversationId: varchar("conversationId", { length: 64 }).notNull(),
    /** The ACTING scope, resolved server-side. A model never sets this. */
    scopeId: varchar("scopeId", { length: 64 }).notNull(),
    createdBy: varchar("createdBy", { length: 100 }).notNull(),
    outcome: text("outcome").notNull(),
    constraints: jsonb("constraints").$type<unknown[]>().notNull().default([]),
    preferences: jsonb("preferences").$type<string[]>().notNull().default([]),
    assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
    unknowns: jsonb("unknowns").$type<string[]>().notNull().default([]),
    state: varchar("state", { length: 16 })
      .notNull()
      .$type<ConversationNeedState>()
      .default("ACTIVE"),
    /** Compare-and-set. Two devices cannot silently overwrite one another. */
    revision: integer("revision").notNull().default(1),
    lastActivatedAt: timestamp("lastActivatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("conversation_needs_scope_idx").on(
      table.conversationId,
      table.scopeId,
      table.state,
    ),
    index("conversation_needs_current_idx").on(
      table.conversationId,
      table.scopeId,
      table.lastActivatedAt,
    ),
  ],
);

export type ConversationNeedRow = typeof conversationNeeds.$inferSelect;

// ---------------------------------------------------------------------------
// 25. COUNTERPARTY VERIFICATION REQUESTS — asking the person who knows, once.
//
//     QUESTION != PROPOSAL · COUNTERPARTY_ASSERTION != SYSTEM_OBSERVATION
//     AVAILABILITY_CONFIRMATION != RESERVATION · AVAILABILITY != AUTHORITY
//     NO_RESPONSE != YES · NO_RESPONSE != NO
//
//     A request binds an EXACT fact to the scope canonically entitled to speak
//     for it. Nothing here is a domain type: a garment, a machine's hours and
//     an interpreter's Thursday are one subject, one property and one
//     configuration.
//
//       DOMAIN_COUNTERPARTY_TYPES_ADDED = 0
// ---------------------------------------------------------------------------

export type VerificationRequestState = "PENDING" | "ANSWERED" | "EXPIRED" | "CANCELLED";
export type VerificationAssertion = "AFFIRMED" | "DENIED" | "CHANGED" | "UNKNOWN";

export const verificationRequests = pgTable(
  "verification_requests",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    subjectKind: varchar("subjectKind", { length: 64 }).notNull(),
    subjectId: varchar("subjectId", { length: 128 }).notNull(),
    subjectRevision: varchar("subjectRevision", { length: 64 }),
    property: varchar("property", { length: 64 }).notNull(),
    configuration: jsonb("configuration")
      .$type<Record<string, string | number>>()
      .notNull()
      .default({}),
    quantity: integer("quantity"),
    purpose: varchar("purpose", { length: 24 }).notNull(),
    requestingScopeId: varchar("requestingScopeId", { length: 64 }).notNull(),
    /** DERIVED from the canonical subject. A model never names it. */
    respondingScopeId: varchar("respondingScopeId", { length: 64 }).notNull(),
    state: varchar("state", { length: 16 })
      .notNull()
      .$type<VerificationRequestState>()
      .default("PENDING"),
    assertion: varchar("assertion", { length: 16 }).$type<VerificationAssertion>(),
    /** Delivery through the existing notification primitive. Presentation. */
    notificationIntentId: varchar("notificationIntentId", { length: 64 }),
    /** The evidence the answer became — when it became any. */
    observationId: varchar("observationId", { length: 64 }),
    answeredByPrincipalId: varchar("answeredByPrincipalId", { length: 100 }),
    answeredAt: timestamp("answeredAt", { withTimezone: true }),
    /** The freshness runtime's own deterministic name for this question. */
    requirementKey: varchar("requirementKey", { length: 400 }).notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("verification_requests_responder_idx").on(table.respondingScopeId, table.state),
    index("verification_requests_subject_idx").on(
      table.subjectKind,
      table.subjectId,
      table.property,
    ),
  ],
);

export type VerificationRequestRow = typeof verificationRequests.$inferSelect;
