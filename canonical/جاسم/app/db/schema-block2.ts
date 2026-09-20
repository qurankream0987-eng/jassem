// ============================================================================
// JASIM BLOCK 2 — OPERATIONAL FABRIC (generic, domain-free)
//
// Ten canonical tables. No domain nouns: every subject/resource is a
// (kind, id) reference; every semantic lives in typed generic columns.
// Varchar state columns with $type unions follow the schema-runtime.ts
// convention (portable, no custom PG enum types required).
// ============================================================================

import {
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
  },
  (table) => [
    uniqueIndex("scope_provider_bindings_unique_idx").on(
      table.scopeId,
      table.providerClass,
      table.providerId,
    ),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type ScopePolicy = typeof scopePolicies.$inferSelect;
export type ScopeProviderBinding = typeof scopeProviderBindings.$inferSelect;
