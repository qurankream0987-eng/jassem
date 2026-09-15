// ============================================================================
// JASIM BLOCK 3.1 — CHAT-NATIVE UNIVERSAL DISCOVERY FABRIC (generic, domain-free)
//
// Four tables, each with an independent durable reason:
//   discovery_result_sets  — result-set persistence (restart/reload identity)
//   discovery_candidates   — durable ordered identity ("الثاني" must never drift)
//   reference_bindings     — durable reference identity across turns/restart
//   fulfillment_observations — truthful real-world observations only (no fake GPS)
//
// No domain nouns anywhere: candidates carry source kind + generic attributes;
// observations carry (subjectKind, subjectId) references, never shipment types.
// Search projections reference canonical entities; canonical business truth
// stays in economic_expressions / Block 3 tables. Nothing here is a second
// source of truth.
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
  varchar,
} from "drizzle-orm/pg-core";

/** Discovery source identity. Provider-neutral; no source implies truth. */
export type DiscoverySourceKind =
  | "JASIM_INTERNAL"
  | "WEB_OBSERVATION"
  | "CONNECTED_PROVIDER"
  | "MCP_PROVIDER"
  | "A2A_PROVIDER";

/** Trust of a candidate: external results are never canonical truth. */
export type CandidateTrust =
  | "canonical_internal" // backed by a canonical entity row
  | "untrusted_external_evidence" // web/provider observation only
  | "provider_attested"; // remote provider evidence, still not JASIM VERIFIED

/**
 * One durable, immutable-as-referenced result set for a conversation goal.
 * The frontend array index is NEVER canonical identity: ordinals resolve
 * through (resultSetId, position).
 */
export const discoveryResultSets = pgTable(
  "discovery_result_sets",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    conversationId: varchar("conversationId", { length: 64 }).notNull(),
    /** Optional durable goal/run this discovery serves. */
    runId: varchar("runId", { length: 64 }),
    /** Original natural-language query, kept for audit only. */
    queryText: text("queryText").notNull(),
    /** Sources actually queried (smallest sufficient set chosen by planner). */
    sources: jsonb("sources").$type<DiscoverySourceKind[]>().notNull(),
    /** Hard constraints applied BEFORE any semantic ranking. */
    hardConstraints: jsonb("hardConstraints").$type<unknown[]>().notNull().default([]),
    /** Result-set version; new search = new row, never silent reorder. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("discovery_result_sets_owner_idx").on(table.ownerId, table.createdAt),
    index("discovery_result_sets_conversation_idx").on(table.conversationId, table.createdAt),
  ],
);

/**
 * One candidate at one durable position inside one result set.
 * A candidate is a discovery representation — never canonical economic truth.
 */
export const discoveryCandidates = pgTable(
  "discovery_candidates",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    resultSetId: varchar("resultSetId", { length: 64 }).notNull(),
    /** 1-based ordinal: what "الأول"/"الثاني" bind to, forever. */
    position: integer("position").notNull(),
    source: varchar("source", { length: 32 }).$type<DiscoverySourceKind>().notNull(),
    /** Canonical entity id when internal (e.g. economic_expressions id). */
    canonicalRef: varchar("canonicalRef", { length: 64 }),
    /** External identity (url/provider id) when not internal. */
    externalRef: text("externalRef"),
    providerId: varchar("providerId", { length: 160 }),
    title: text("title").notNull(),
    summary: text("summary"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    /** Observed price — an observation, NEVER a payment amount. */
    observedPriceMinor: numeric("observedPriceMinor", { precision: 38, scale: 0 }),
    observedCurrency: varchar("observedCurrency", { length: 8 }),
    availability: varchar("availability", { length: 24 }), // available|unavailable|unknown
    trust: varchar("trust", { length: 40 }).$type<CandidateTrust>().notNull(),
    /** Executable capability reference if a real one exists; else null. */
    capabilityRef: varchar("capabilityRef", { length: 191 }),
    actionable: jsonb("actionable").$type<string[]>().notNull().default([]),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
    observedAt: timestamp("observedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("discovery_candidates_set_position_idx").on(table.resultSetId, table.position),
    index("discovery_candidates_canonical_idx").on(table.canonicalRef),
  ],
);

/**
 * Durable binding from a conversational reference ("الثاني", "هذا العرض")
 * to an exact target. Survives turns, reload, restart, web↔mobile.
 */
export const referenceBindings = pgTable(
  "reference_bindings",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    conversationId: varchar("conversationId", { length: 64 }).notNull(),
    /** Normalized reference form, e.g. "ordinal:2", "deictic:this", "named:latest". */
    referenceKey: varchar("referenceKey", { length: 128 }).notNull(),
    targetKind: varchar("targetKind", { length: 48 }).notNull(), // discovery_candidate|economic_expression|run|world|...
    targetId: varchar("targetId", { length: 191 }).notNull(),
    resultSetId: varchar("resultSetId", { length: 64 }),
    position: integer("position"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    supersededAt: timestamp("supersededAt", { withTimezone: true }),
  },
  (table) => [
    index("reference_bindings_conversation_idx").on(table.conversationId, table.referenceKey),
    index("reference_bindings_target_idx").on(table.targetKind, table.targetId),
  ],
);

/**
 * A real-world observation about a canonical subject, reported by an
 * identified observer with an explicit proof class. Location/ETA may ONLY
 * come from a row here — never fabricated.
 */
export const fulfillmentObservations = pgTable(
  "fulfillment_observations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    subjectKind: varchar("subjectKind", { length: 48 }).notNull(), // e.g. "commercial_order" (generic ref)
    subjectId: varchar("subjectId", { length: 64 }).notNull(),
    observerOwnerId: varchar("observerOwnerId", { length: 100 }).notNull(),
    /** e.g. ready|picked_up|in_transit|delivered — generic lifecycle labels. */
    observationKind: varchar("observationKind", { length: 48 }).notNull(),
    /** self_report|counterparty_confirm|authenticated_webhook|signed_proof */
    proofClass: varchar("proofClass", { length: 40 }).notNull(),
    /** Optional real location fix; absence means location UNKNOWN. */
    location: jsonb("location").$type<{ lat: number; lng: number; accuracyM?: number }>(),
    note: text("note"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("fulfillment_observations_subject_idx").on(table.subjectKind, table.subjectId, table.createdAt),
  ],
);
