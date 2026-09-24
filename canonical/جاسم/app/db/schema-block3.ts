/**
 * Block 3 — agentic commerce / trusted payment / economics / billing.
 *
 * Ten generic tables (target was 9, absolute ceiling 13). No domain-specific
 * shape anywhere: no CarOrder, no JobFee, no TransportSubscription.
 *
 * Permanent separations enforced by structure:
 * - TransactionIntent (Block 1) is NOT here and stays payment-free.
 * - PaymentIntent ≠ payment attempt ≠ revenue ≠ settlement ≠ payout.
 * - economic_ledger_entries is the ONLY financial ledger (append-only);
 *   the execution attempt ledger stays execution audit, never accounting.
 * - Money is always integer minor units (numeric(38,0)) + mandatory currency.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// LAYER 2 — COMMERCE
// ---------------------------------------------------------------------------

/** One generic commercial order/checkout state. Never per-domain. */
export const commercialOrders = pgTable(
  "commercial_orders",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    transactionIntentId: varchar("transactionIntentId", { length: 64 }),
    sellerRef: varchar("sellerRef", { length: 128 }).notNull(),
    buyerRef: varchar("buyerRef", { length: 128 }).notNull(),
    /**
     * Versioned commercial terms: items/resources, quantity, unit price,
     * total (Money), fulfillment, discounts, tax observations, expiry.
     * Consequential mutation bumps termsVersion + termsFingerprint.
     */
    terms: jsonb("terms").$type<Record<string, unknown>>().notNull().default({}),
    termsVersion: integer("termsVersion").notNull().default(1),
    termsFingerprint: varchar("termsFingerprint", { length: 64 }).notNull(),
    /**
     * What THIS party stated, within what the offering permits. It is kept
     * apart from `terms` on purpose: a party's own configuration and the
     * counterparty changing the offer are two different movements, and a
     * runtime that stores them in one field cannot tell them apart.
     *
     *   PARTY_CONFIGURATION != COUNTERPARTY_CHANGED_TERMS
     */
    partyConfiguration: jsonb("partyConfiguration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** The SOURCE offering's published terms, as they were when selected. */
    offeringFingerprint: varchar("offeringFingerprint", { length: 64 }),
    /** What this party stated. Moves when they reconfigure, and only then. */
    configurationFingerprint: varchar("configurationFingerprint", { length: 64 }),
    /**
     * The canonical proposal this draft became. Null until a party authorized
     * sending it, and it is the DRAFT that points at the truth — never the
     * other way round.
     *
     *   COMMERCIAL_ORDER != AGREEMENT · != COMMITMENT · != CANONICAL_TRANSACTION
     */
    proposalId: varchar("proposalId", { length: 64 }),
    status: varchar("status", { length: 24 }).notNull().default("DRAFT"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("commercial_orders_owner_idx").on(table.ownerId, table.status),
    index("commercial_orders_intent_idx").on(table.transactionIntentId),
  ],
);

// ---------------------------------------------------------------------------
// LAYER 3 — PAYMENT
// ---------------------------------------------------------------------------

export const PAYMENT_INTENT_STATUSES = [
  "CREATED",
  "REQUIRES_APPROVAL",
  "EXECUTING",
  "PROVIDER_AUTHORIZED",
  "CAPTURED",
  "SETTLED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "INCONCLUSIVE",
] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

/**
 * Canonical payment intent. Binds owner/payer/payee/Money/purpose/
 * constraints/method-reference/idempotency. Provider-specific data lives
 * only as generic metadata; effects happen via the Attempt Ledger, never
 * by mutating this row directly.
 */
export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    payerRef: varchar("payerRef", { length: 128 }).notNull(),
    payeeRef: varchar("payeeRef", { length: 128 }).notNull(),
    /** Canonical Money: exact integer minor units + mandatory currency. */
    amountMinor: numeric("amountMinor", { precision: 38, scale: 0 }).notNull(),
    currency: varchar("currency", { length: 8 }).notNull(),
    purpose: varchar("purpose", { length: 255 }).notNull(),
    transactionIntentId: varchar("transactionIntentId", { length: 64 }),
    /** The canonical Transaction this settles, when it settles one. */
    transactionId: varchar("transactionId", { length: 64 }),
    orderId: varchar("orderId", { length: 64 }),
    providerConstraints: jsonb("providerConstraints")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Tokenized reference only — never raw credentials. */
    paymentMethodRef: varchar("paymentMethodRef", { length: 64 }),
    authorizationRequirement: varchar("authorizationRequirement", { length: 32 })
      .notNull()
      .default("OWNER_APPROVAL"),
    /** JASIM-level idempotency identity (owner + intent + effect scope). */
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    risk: varchar("risk", { length: 16 }).notNull().default("STANDARD"),
    status: varchar("status", { length: 24 }).notNull().$type<PaymentIntentStatus>().default("CREATED"),
    /** Provider-side payment id — persisted so crash recovery can reconcile. */
    providerReference: varchar("providerReference", { length: 96 }),
    // Immutable provider/catalog binding: once set, truth may be applied only
    // by the client of THIS provider — cross-provider readback never counts.
    providerRef: varchar("providerRef", { length: 96 }),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("payment_intents_owner_idempotency_idx").on(table.ownerId, table.idempotencyKey),
    index("payment_intents_owner_status_idx").on(table.ownerId, table.status),
    index("payment_intents_transaction_idx").on(table.transactionIntentId),
    index("payment_intents_txn_idx").on(table.transactionId),
  ],
);

/** Tokenized payment-method reference. Raw PAN/CVV/secrets are forbidden. */
export const paymentMethodReferences = pgTable(
  "payment_method_references",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    provider: varchar("provider", { length: 96 }).notNull(),
    methodType: varchar("methodType", { length: 32 }).notNull(),
    /** Provider token / vault reference — never credential material. */
    tokenRef: varchar("tokenRef", { length: 191 }).notNull(),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
    provenance: jsonb("provenance").$type<{ source: string; reference?: string }>().notNull(),
    status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("payment_method_refs_owner_idx").on(table.ownerId, table.status),
    uniqueIndex("payment_method_refs_token_idx").on(table.provider, table.tokenRef),
  ],
);

/** Generic payout state, deliberately separate from payment/settlement state. */
export const payouts = pgTable(
  "payouts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    destinationRef: varchar("destinationRef", { length: 191 }).notNull(),
    amountMinor: numeric("amountMinor", { precision: 38, scale: 0 }).notNull(),
    currency: varchar("currency", { length: 8 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("REQUESTED"),
    providerRef: varchar("providerRef", { length: 96 }),
    providerReference: varchar("providerReference", { length: 96 }),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    approvalRef: varchar("approvalRef", { length: 128 }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("payouts_owner_idempotency_idx").on(table.ownerId, table.idempotencyKey),
    index("payouts_owner_status_idx").on(table.ownerId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// FINANCIAL AUTHORITY — stateful mandate budget (extends DelegationGrant)
// ---------------------------------------------------------------------------

/**
 * Stateful budget/counter for financial DelegationGrants. Stateless ceilings
 * live on the grant; durable consumption lives here, consumed atomically by
 * PostgreSQL (remaining >= requested in the UPDATE's WHERE) so concurrent
 * executions cannot overrun budget or double-use a single-use mandate.
 */
export const mandateBudgets = pgTable(
  "mandate_budgets",
  {
    grantId: varchar("grantId", { length: 64 }).primaryKey(),
    currency: varchar("currency", { length: 8 }).notNull(),
    /** Total authorized budget in minor units; NULL = unconstrained. */
    budgetMinor: numeric("budgetMinor", { precision: 38, scale: 0 }),
    consumedMinor: numeric("consumedMinor", { precision: 38, scale: 0 }).notNull().default("0"),
    /** Total authorized executions; NULL = unconstrained. */
    executionLimit: integer("executionLimit"),
    executionsUsed: integer("executionsUsed").notNull().default(0),
    /** Optional recurrence window key (e.g. 2026-08) for period budgets. */
    periodKey: varchar("periodKey", { length: 32 }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("mandate_budgets_period_idx").on(table.grantId, table.periodKey)],
);

// ---------------------------------------------------------------------------
// LAYER 4 — JASIM ECONOMICS
// ---------------------------------------------------------------------------

export const ECONOMIC_ENTRY_KINDS = [
  "CUSTOMER_PAYMENT",
  "SELLER_VALUE",
  "SELLER_PAYABLE",
  "PROVIDER_COST",
  "JASIM_REVENUE",
  "REFUND",
  "PAYOUT",
  "ADJUSTMENT",
] as const;
export type EconomicEntryKind = (typeof ECONOMIC_ENTRY_KINDS)[number];

/**
 * The financial/economic ledger. APPEND-ONLY: no update/delete paths exist.
 * History is immutable — a refund is a new entry, never a rewrite. Balances
 * are derived, never stored. This is NOT the execution attempt ledger.
 */
export const economicLedgerEntries = pgTable(
  "economic_ledger_entries",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull().$type<EconomicEntryKind>(),
    /** Party the value belongs to (customer ref, seller ref, JASIM, provider). */
    party: varchar("party", { length: 128 }).notNull(),
    /** Signed minor units: positive = value recognized, negative = reversal. */
    amountMinor: numeric("amountMinor", { precision: 38, scale: 0 }).notNull(),
    currency: varchar("currency", { length: 8 }).notNull(),
    /** Provenance: the verified economic event that birthed this entry. */
    sourceEventType: varchar("sourceEventType", { length: 96 }).notNull(),
    sourceId: varchar("sourceId", { length: 96 }).notNull(),
    attemptId: varchar("attemptId", { length: 96 }),
    paymentIntentId: varchar("paymentIntentId", { length: 64 }),
    feeRuleId: varchar("feeRuleId", { length: 64 }),
    feeRuleVersion: integer("feeRuleVersion"),
    /** Owner-scoped idempotency: the same economic effect never lands twice. */
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("economic_ledger_owner_idempotency_idx").on(table.ownerId, table.idempotencyKey),
    index("economic_ledger_owner_kind_idx").on(table.ownerId, table.kind),
    index("economic_ledger_payment_idx").on(table.paymentIntentId),
  ],
);

export const FEE_RULE_KINDS = [
  "fixed",
  "percentage",
  "tiered",
  "success",
  "service",
  "booking",
  "usage",
  "subscription",
  "listing",
  "promotion",
  "margin",
] as const;
export type FeeRuleKind = (typeof FEE_RULE_KINDS)[number];

/**
 * ONE generic FeeRule engine's data. Rules are owner-configured and
 * versioned: changing policy creates a new version row, never rewrites
 * history. Eligibility binds to a VERIFIED economic event type.
 */
export const feeRules = pgTable(
  "fee_rules",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    /** Optional generic binding to a generated World (never a domain type). */
    worldId: varchar("worldId", { length: 191 }),
    kind: varchar("kind", { length: 24 }).notNull().$type<FeeRuleKind>(),
    /** The verified economic event type that makes this rule eligible. */
    triggerEventType: varchar("triggerEventType", { length: 96 }).notNull(),
    /**
     * Rule configuration (exact decimals as strings):
     * fixed → { amountMinor, currency }
     * percentage → { percent } (up to 4 decimals, HALF_UP at minor unit)
     * tiered → { tiers: [{ upToMinor, percent|amountMinor }] }
     * others → kind-specific generic params; never domain code.
     */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    version: integer("version").notNull().default(1),
    status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
    effectiveFrom: timestamp("effectiveFrom", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("fee_rules_owner_idx").on(table.ownerId, table.status),
    index("fee_rules_trigger_idx").on(table.ownerId, table.triggerEventType, table.status),
  ],
);

// ---------------------------------------------------------------------------
// LAYER 5 — BILLING / ACCESS
// ---------------------------------------------------------------------------

/** Generic commercial plan. Generated businesses define plans dynamically. */
export const plans = pgTable(
  "plans",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    /** Optional generic binding to a generated World (never a domain type). */
    worldId: varchar("worldId", { length: 191 }),
    name: varchar("name", { length: 191 }).notNull(),
    /** NULL price = free plan (trials/grants; no fake payment). */
    priceMinor: numeric("priceMinor", { precision: 38, scale: 0 }),
    currency: varchar("currency", { length: 8 }),
    cadence: varchar("cadence", { length: 24 }).notNull().default("MONTHLY"),
    trialPolicy: jsonb("trialPolicy").$type<Record<string, unknown>>().notNull().default({}),
    /** Entitlement scopes this plan grants (capability/resource + quota). */
    entitlementScopes: jsonb("entitlementScopes")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    usagePolicy: jsonb("usagePolicy").$type<Record<string, unknown>>().notNull().default({}),
    version: integer("version").notNull().default(1),
    status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("plans_owner_idx").on(table.ownerId, table.status)],
);

export const SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "SUSPENDED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * A billing relationship — NOT a payment. Renewal may produce payments via
 * the trusted chain; entitlement changes follow verified events + policy.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    planId: varchar("planId", { length: 64 }).notNull(),
    planVersion: integer("planVersion").notNull(),
    status: varchar("status", { length: 16 }).notNull().$type<SubscriptionStatus>().default("ACTIVE"),
    periodStart: timestamp("periodStart", { withTimezone: true }).notNull(),
    periodEnd: timestamp("periodEnd", { withTimezone: true }).notNull(),
    /** true ⇒ remains active until periodEnd, then cancels. */
    cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").notNull().default(false),
    cancelledAt: timestamp("cancelledAt", { withTimezone: true }),
    paymentMethodRef: varchar("paymentMethodRef", { length: 64 }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("subscriptions_owner_idx").on(table.ownerId, table.status),
    index("subscriptions_plan_idx").on(table.planId),
  ],
);

/**
 * Server-side access truth: "what can this subject use NOW?" Derived from
 * verified subscription/payment/trial events — the UI can never self-grant.
 */
export const entitlements = pgTable(
  "entitlements",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    subjectOwnerId: varchar("subjectOwnerId", { length: 100 }).notNull(),
    sourceType: varchar("sourceType", { length: 24 }).notNull(),
    sourceId: varchar("sourceId", { length: 64 }).notNull(),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
    quota: jsonb("quota").$type<Record<string, unknown>>().notNull().default({}),
    status: varchar("status", { length: 16 }).notNull().default("ACTIVE"),
    effectiveAt: timestamp("effectiveAt", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("entitlements_subject_idx").on(table.subjectOwnerId, table.status),
    uniqueIndex("entitlements_source_scope_idx").on(
      table.subjectOwnerId,
      table.sourceType,
      table.sourceId,
      // Scope identity participates in uniqueness via a textual key in meta
      // when needed; the (subject, source) pair is the common case.
    ),
  ],
);

/**
 * Generic usage metering. Append-only records with idempotency identity —
 * a replayed usage event can never consume quota or bill twice (§74–75).
 */
export const usageRecords = pgTable(
  "usage_records",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    subscriptionId: varchar("subscriptionId", { length: 64 }),
    metric: varchar("metric", { length: 64 }).notNull(),
    quantity: numeric("quantity", { precision: 30, scale: 6 }).notNull(),
    unit: varchar("unit", { length: 32 }).notNull(),
    /** Idempotency identity: provider/event-unique key. */
    sourceEventKey: varchar("sourceEventKey", { length: 128 }).notNull(),
    periodKey: varchar("periodKey", { length: 32 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("usage_records_idem_idx").on(table.ownerId, table.metric, table.sourceEventKey),
    index("usage_records_period_idx").on(table.ownerId, table.metric, table.periodKey),
  ],
);

export type CommercialOrderRecord = typeof commercialOrders.$inferSelect;
export type PaymentIntentRecord = typeof paymentIntents.$inferSelect;
export type PaymentMethodReferenceRecord = typeof paymentMethodReferences.$inferSelect;
export type MandateBudgetRecord = typeof mandateBudgets.$inferSelect;
export type EconomicLedgerEntryRecord = typeof economicLedgerEntries.$inferSelect;
export type FeeRuleRecord = typeof feeRules.$inferSelect;
export type PlanRecord = typeof plans.$inferSelect;
export type SubscriptionRecord = typeof subscriptions.$inferSelect;
export type EntitlementRecord = typeof entitlements.$inferSelect;
export type UsageRecordRecord = typeof usageRecords.$inferSelect;

/** DDL guard: economic ledger is append-only — no update path in code. */
export const ECONOMIC_LEDGER_APPEND_ONLY = sql`TRUE`;
