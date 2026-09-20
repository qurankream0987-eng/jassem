/**
 * JASIM — DataSource. Where rows come from, and how that stays replaceable.
 *
 * Internal PostgreSQL is ONE source. The architecture has to accept an ERP, a
 * CRM, a POS, a spreadsheet or a business API later without `DataNeed`,
 * `AuthorizedQuery` or `CanonicalDataset` changing — so a source is a narrow
 * contract that takes an already-authorized query and returns plain rows.
 *
 * ─── A SOURCE NEVER DECIDES WHO IS ASKING ───────────────────────────────────
 *
 * Authorization happens before a source is consulted, and the owner scope
 * arrives on the query as a value the runtime put there. A source cannot widen
 * it, cannot read a session, and is given no way to ask who the caller is. That
 * is what makes an external adapter safe to add: the worst a badly written one
 * can do is fail, not leak.
 *
 * ─── NO FAKE PROVIDERS ──────────────────────────────────────────────────────
 *
 * There is exactly one source registered, and it reads real rows out of the
 * real database. A stub that returns invented rows would make every test above
 * it meaningless — the point of this layer is that what reaches a person is
 * true.
 */

import { and, asc, desc, eq, gte, lte, ne, sql, type SQL } from "drizzle-orm";
import { db } from "../queries/connection";

/** What kind of thing is on the other end. Widens as adapters are added. */
export const DATA_SOURCE_KINDS = [
  "INTERNAL_RUNTIME",
  "EXTERNAL_API",
  "CONNECTED_DATABASE",
  "SPREADSHEET",
] as const;
export type DataSourceKind = (typeof DATA_SOURCE_KINDS)[number];

/** Why a source could not answer. Each maps to a different truthful state. */
export type SourceFailure =
  | { readonly reason: "NOT_CONFIGURED"; readonly detail: string }
  | { readonly reason: "PROVIDER_UNAVAILABLE"; readonly detail: string }
  | { readonly reason: "READ_FAILED"; readonly detail: string };

export type SourceRows = {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  /** Total matching rows when the source can say; absent when it cannot. */
  readonly totalRows?: number;
  /** When the source produced these rows. */
  readonly observedAt: string;
  /** What the source can honestly claim about how current they are. */
  readonly freshness: "CURRENT" | "STALE" | "UNKNOWN";
};

/**
 * The query a source receives.
 *
 * Already resolved, already authorized, already bounded. Note what is NOT here:
 * no SQL string, no table name chosen by a caller, no credentials, no session.
 * The `table` is a Drizzle object the RESOURCE supplied — a source never takes
 * a table name from input.
 */
export type SourceQuery = {
  readonly ownerScope: string;
  readonly ownerColumn: string;
  readonly ownerIsNumeric: boolean;
  readonly table: unknown;
  readonly columns: Readonly<Record<string, unknown>>;
  readonly fields: readonly string[];
  readonly filters: readonly {
    readonly field: string;
    readonly operator: "EQ" | "NEQ" | "GTE" | "LTE";
    readonly value: string | number | boolean;
  }[];
  readonly sort: readonly { readonly field: string; readonly direction: "ASC" | "DESC" }[];
  readonly limit: number;
  readonly offset: number;
};

export type DataSource = {
  readonly id: string;
  readonly kind: DataSourceKind;
  /** Whether this source can be used right now. Config, not opinion. */
  readonly available: () => boolean;
  readonly read: (query: SourceQuery) => Promise<SourceRows | SourceFailure>;
};

export function isSourceFailure(value: SourceRows | SourceFailure): value is SourceFailure {
  return "reason" in value;
}

// ── The one real source ──────────────────────────────────────────────────────

/**
 * JASIM's own canonical runtime state.
 *
 * Real rows, owner-scoped, from the database the runtime already writes. It is
 * registered first because it is the only data JASIM genuinely owns today —
 * business data belongs to a business, and arrives through an adapter its owner
 * connects.
 *
 * Every value that could carry an attack is bound as a parameter through
 * Drizzle's expression builders. No string is concatenated into SQL anywhere in
 * this file, and the column objects come from the resource registry rather than
 * from anything a caller said.
 */
const internalRuntimeSource: DataSource = {
  id: "internal-runtime",
  kind: "INTERNAL_RUNTIME",
  available: () => true,
  read: async (query) => {
    try {
      const column = (field: string) => query.columns[field];
      const ownerColumn = query.columns[query.ownerColumn];
      if (!ownerColumn) {
        return { reason: "NOT_CONFIGURED", detail: "The resource declares no owner column." };
      }

      // The owner predicate is not optional and is not derived from input. It
      // is the first condition on every read this source performs.
      const conditions: SQL[] = [
        eq(
          ownerColumn as never,
          query.ownerIsNumeric ? Number(query.ownerScope) : query.ownerScope,
        ),
      ];

      for (const filter of query.filters) {
        const target = column(filter.field);
        if (!target) continue;
        if (filter.operator === "EQ") conditions.push(eq(target as never, filter.value as never));
        if (filter.operator === "NEQ") conditions.push(ne(target as never, filter.value as never));
        if (filter.operator === "GTE") conditions.push(gte(target as never, filter.value as never));
        if (filter.operator === "LTE") conditions.push(lte(target as never, filter.value as never));
      }

      const selection = Object.fromEntries(
        query.fields.flatMap((field) => {
          const target = column(field);
          return target ? [[field, target]] : [];
        }),
      );

      let statement = db
        .select(selection as never)
        .from(query.table as never)
        .where(and(...conditions))
        .limit(query.limit)
        .offset(query.offset) as never as {
        orderBy: (...args: SQL[]) => Promise<Record<string, unknown>[]>;
      } & Promise<Record<string, unknown>[]>;

      const orderings = query.sort.flatMap((entry) => {
        const target = column(entry.field);
        if (!target) return [];
        return [entry.direction === "ASC" ? asc(target as never) : desc(target as never)];
      });
      const rows = orderings.length > 0 ? await statement.orderBy(...orderings) : await statement;

      const counted = (await db
        .select({ total: sql<number>`count(*)::int` })
        .from(query.table as never)
        .where(and(...conditions))) as unknown as Array<{ total: number }>;
      const totalRows = typeof counted[0]?.total === "number" ? counted[0].total : undefined;

      return {
        rows,
        totalRows,
        observedAt: new Date().toISOString(),
        // The rows were true when read and nothing pushes a change yet, so
        // `CURRENT` would be a promise this source cannot keep for longer than
        // the instant it answered. `UNKNOWN` is what it can actually say.
        freshness: "UNKNOWN",
      };
    } catch (error) {
      return {
        reason: "READ_FAILED",
        // The message, never the rows and never the query values.
        detail: error instanceof Error ? error.message.slice(0, 200) : "unknown read failure",
      };
    }
  },
};

// ── Registry ─────────────────────────────────────────────────────────────────

const SOURCES = new Map<string, DataSource>([[internalRuntimeSource.id, internalRuntimeSource]]);

export function getDataSource(id: string): DataSource | undefined {
  return SOURCES.get(id);
}

export function listDataSources(): readonly DataSource[] {
  return [...SOURCES.values()];
}

/**
 * Register an adapter.
 *
 * Exported so a future external source can be added without touching this file
 * — the provider-ready requirement. It refuses to replace an existing id,
 * because silently swapping where data comes from is exactly the change nobody
 * would notice.
 */
export function registerDataSource(source: DataSource): void {
  if (SOURCES.has(source.id)) {
    throw new Error(`A data source is already registered as «${source.id}».`);
  }
  SOURCES.set(source.id, source);
}

/**
 * Environment variable names an external source would need.
 *
 * Names only. No value is read here, nothing is logged, and nothing is ever
 * printed — this exists so an owner handoff can list what to set in Railway
 * without a secret passing through a conversation.
 */
export const EXTERNAL_SOURCE_ENV_CONTRACT: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    CONNECTED_DATABASE: ["JASIM_DATA_SOURCE_<ID>_URL"],
    EXTERNAL_API: ["JASIM_DATA_SOURCE_<ID>_BASE_URL", "JASIM_DATA_SOURCE_<ID>_API_KEY"],
    SPREADSHEET: ["JASIM_DATA_SOURCE_<ID>_DOCUMENT_ID", "JASIM_DATA_SOURCE_<ID>_API_KEY"],
  });
