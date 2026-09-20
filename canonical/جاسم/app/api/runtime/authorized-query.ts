/**
 * JASIM — AuthorizedQuery. The only way a read reaches a source.
 *
 *   DataNeed → resource resolution → AUTHORIZATION → AuthorizedQuery → source
 *
 * The arrow that matters is the capitalised one. Authorization happens BEFORE
 * a query exists, not while it runs and not after it returns, so there is no
 * moment at which an unauthorized read is in flight.
 *
 * ─── THE MODEL NEVER TOUCHES A DATABASE ─────────────────────────────────────
 *
 *   never:  LLM → raw SQL → database
 *
 * A `DataNeed` names a resource semantically and names fields by key. Both are
 * resolved against closed registries here. The owner scope is added HERE, from
 * the session the runtime already holds, and nothing in the need can influence
 * it — there is no field for it and `.strict()` rejects one.
 *
 * ─── NEVER SILENTLY REMOVE A RESTRICTION ────────────────────────────────────
 *
 * A request for a sensitive field is DENIED. It is not dropped from the
 * projection and answered anyway: quietly returning the other columns teaches a
 * person the field does not exist, which is a different fact and a false one.
 * The same goes for an unknown field, which is `NEEDS_INPUT` — the runtime
 * cannot tell a typo from a column it has never heard of, and guessing which
 * is which is how a typo becomes a wrong answer.
 */

import { randomUUID } from "node:crypto";
import {
  effectiveWindow,
  type DataNeed,
  type FilterOperator,
} from "./data-need";
import {
  findColumn,
  listCanonicalResources,
  readableColumns,
  resolveCanonicalResource,
  type CanonicalResource,
} from "./canonical-resource";
import { getDataSource, isSourceFailure, type SourceQuery } from "./data-source";
import type { CanonicalDataset, DatasetColumn, DatasetRow } from "./canonical-dataset";

/**
 * A read that has been resolved, authorized and bounded.
 *
 * Constructed only by `authorizeDataNeed`. Note the owner scope is a field on
 * the query rather than an argument to the source call: it travels WITH the
 * query, so there is no path that executes one without it.
 */
export type AuthorizedQuery = {
  readonly queryId: string;
  readonly ownerScope: string;
  readonly resource: CanonicalResource;
  readonly fields: readonly string[];
  readonly filters: readonly {
    readonly field: string;
    readonly operator: FilterOperator;
    readonly value: string | number | boolean;
  }[];
  readonly sort: readonly { readonly field: string; readonly direction: "ASC" | "DESC" }[];
  readonly limit: number;
  readonly offset: number;
  /**
   * True when the identity field was added by this authorizer rather than
   * asked for.
   *
   * It still travels and is still read — the runtime needs it. It just is not
   * a COLUMN of the answer: a person who asked for «الهدف والحالة» and got a
   * column of UUIDs pushing «الحالة» off the edge of the table was shown
   * something they did not ask for instead of something they did.
   */
  readonly identityImplicit: boolean;
  /** Present only when every grouped and measured column authorised it. */
  readonly aggregate?: {
    readonly groupBy: readonly string[];
    readonly measures: readonly { readonly field: string; readonly fn: string }[];
  };
};

/** Every way a read can end. Each is a different fact and stays distinct. */
export type DataOutcome =
  | { readonly status: "OK"; readonly dataset: CanonicalDataset }
  /** The resource does not exist. Nothing was consulted. */
  | { readonly status: "UNAVAILABLE"; readonly detail: string; readonly message: string }
  /** It exists and this owner may not read it, or may not read that field. */
  | { readonly status: "DENIED"; readonly detail: string; readonly message: string }
  /** The request is not answerable as written. */
  | { readonly status: "NEEDS_INPUT"; readonly detail: string; readonly message: string }
  /** An external source is required and is not reachable. */
  | { readonly status: "BLOCKED_BY_PROVIDER"; readonly detail: string; readonly message: string }
  /** A source exists but is not configured. */
  | { readonly status: "BLOCKED_BY_CONFIGURATION"; readonly detail: string; readonly message: string };

export type AuthorizationOutcome =
  | { readonly status: "AUTHORIZED"; readonly query: AuthorizedQuery }
  | Exclude<DataOutcome, { status: "OK" }>;

// Listed so an UNAVAILABLE answer can say what DOES exist, which turns a dead
// end into a next step.
const knownResourceTitles = (): string[] =>
  listCanonicalResources().map((resource) => resource.title);

/**
 * Resolve, authorize, and bound. Pure except for reading the registries.
 *
 * `ownerScope` is supplied by the caller from the session. It is deliberately a
 * separate argument rather than part of the need, so that forgetting it is a
 * type error rather than a silent read of everybody's rows.
 */
export function authorizeDataNeed(input: {
  need: DataNeed;
  ownerScope: string;
}): AuthorizationOutcome {
  const { need, ownerScope } = input;

  if (!ownerScope) {
    return {
      status: "DENIED",
      detail: "No owner scope was supplied for this read.",
      message: "لا يمكن قراءة بيانات دون جلسة معروفة.",
    };
  }

  const resource = resolveCanonicalResource(need.resource);
  if (!resource) {
    const available = knownResourceTitles();
    return {
      status: "UNAVAILABLE",
      detail: `No readable resource matches «${need.resource}».`,
      message: `لا يوجد مصدر بيانات مسجّل بهذا الاسم. المتاح حالياً: ${available.join("، ")}.`,
    };
  }

  // ── The scope must be able to OWN this resource ───────────────────────────
  //
  // A resource whose owner column is numeric is keyed to a person. An
  // organization scope is not a number, so the owner predicate would match
  // nothing — and returning zero rows would be a FALSE EMPTY: it would say the
  // company has no conversations when the truth is that a company cannot hold
  // one at all. The two are different answers and only one of them is honest.
  //
  // This is the seam a business data source arrives at. An adapter an owner
  // connects registers its resource with its own owner column, and reads
  // through this same path with no new branch here.
  if (resource.ownerIsNumeric && !/^\d+$/u.test(ownerScope)) {
    return {
      status: "UNAVAILABLE",
      detail: `Resource «${resource.id}» is keyed to a personal owner; this scope is not one.`,
      message: `«${resource.title}» مرتبط بحساب شخصي، ولا توجد صفوف تخص هذا النطاق. لم أعرض أي بيانات.`,
    };
  }

  const readable = readableColumns(resource);
  const readableKeys = new Set(readable.map((column) => column.key));

  // ── Projection ────────────────────────────────────────────────────────────
  const requestedFields = need.fields.length > 0 ? need.fields : readable.map((c) => c.key);
  for (const field of requestedFields) {
    const column = findColumn(resource, field);
    if (!column) {
      return {
        status: "NEEDS_INPUT",
        detail: `«${field}» is not a field of «${resource.id}».`,
        message: `لا أعرف الحقل «${field}» في ${resource.title}. الحقول المتاحة: ${readable
          .map((c) => c.label)
          .join("، ")}.`,
      };
    }
    if (column.sensitive) {
      // Denied, and said. Not dropped.
      return {
        status: "DENIED",
        detail: `«${field}» is not readable on «${resource.id}».`,
        message: `الحقل «${column.label}» غير متاح للقراءة.`,
      };
    }
  }

  // The identity field always travels, because a row without a stable
  // reference cannot be pointed at later.
  const fields = [...new Set([resource.identityField, ...requestedFields])].filter((field) =>
    readableKeys.has(field),
  );
  const identityImplicit = need.fields.length > 0 && !need.fields.includes(resource.identityField);

  // ── Filters ───────────────────────────────────────────────────────────────
  for (const filter of need.filters) {
    const column = findColumn(resource, filter.field);
    if (!column || column.sensitive) {
      return {
        status: column?.sensitive ? "DENIED" : "NEEDS_INPUT",
        detail: `«${filter.field}» cannot be filtered on «${resource.id}».`,
        message: column?.sensitive
          ? `لا يمكن التصفية على الحقل «${column.label}».`
          : `لا أعرف الحقل «${filter.field}» للتصفية.`,
      };
    }
    if (!column.capabilities.includes("FILTER")) {
      return {
        status: "NEEDS_INPUT",
        detail: `«${filter.field}» does not support filtering.`,
        message: `الحقل «${column.label}» لا يدعم التصفية.`,
      };
    }
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  for (const entry of need.sort) {
    const column = findColumn(resource, entry.field);
    if (!column || column.sensitive || !column.capabilities.includes("SORT")) {
      return {
        status: column?.sensitive ? "DENIED" : "NEEDS_INPUT",
        detail: `«${entry.field}» cannot be sorted on «${resource.id}».`,
        message: column?.sensitive
          ? `لا يمكن الترتيب حسب الحقل «${column.label}».`
          : `لا أعرف الحقل «${entry.field}» للترتيب.`,
      };
    }
  }

  // ── Time range folds into filters, so there is one thing to authorize ─────
  const filters = [...need.filters];
  if (need.timeRange) {
    const column = findColumn(resource, need.timeRange.field);
    if (!column || column.sensitive || !column.capabilities.includes("FILTER")) {
      return {
        status: "NEEDS_INPUT",
        detail: `«${need.timeRange.field}» cannot bound a time range on «${resource.id}».`,
        message: `لا يمكن تحديد مدة زمنية على الحقل «${need.timeRange.field}».`,
      };
    }
    if (need.timeRange.from) {
      filters.push({ field: need.timeRange.field, operator: "GTE", value: need.timeRange.from });
    }
    if (need.timeRange.to) {
      filters.push({ field: need.timeRange.field, operator: "LTE", value: need.timeRange.to });
    }
  }

  // ── Grouping and measures ─────────────────────────────────────────────────
  //
  // Checked with the same strictness as a projection, because an aggregate
  // reads the same rows. A column that may not be read may not be summed.
  for (const field of need.groupBy) {
    const column = findColumn(resource, field);
    if (!column || column.sensitive) {
      return {
        status: column?.sensitive ? "DENIED" : "NEEDS_INPUT",
        detail: `«${field}» cannot group «${resource.id}».`,
        message: column?.sensitive
          ? `لا يمكن التجميع حسب الحقل «${column.label}».`
          : `لا أعرف الحقل «${field}» للتجميع.`,
      };
    }
    if (!column.capabilities.includes("GROUP")) {
      return {
        status: "NEEDS_INPUT",
        detail: `«${field}» does not support grouping.`,
        message: `الحقل «${column.label}» لا يدعم التجميع.`,
      };
    }
  }
  for (const measure of need.aggregate) {
    // COUNT measures rows, not a column, so it needs no measurable field.
    if (measure.fn === "COUNT") continue;
    const column = findColumn(resource, measure.field);
    if (!column || column.sensitive) {
      return {
        status: column?.sensitive ? "DENIED" : "NEEDS_INPUT",
        detail: `«${measure.field}» cannot be aggregated on «${resource.id}».`,
        message: column?.sensitive
          ? `لا يمكن حساب الحقل «${column.label}».`
          : `لا أعرف الحقل «${measure.field}» للحساب.`,
      };
    }
    if (column.type !== "NUMBER" && column.type !== "INTEGER") {
      return {
        status: "NEEDS_INPUT",
        detail: `«${measure.field}» is not numeric.`,
        message: `الحقل «${column.label}» ليس رقمياً، ولا يمكن حسابه.`,
      };
    }
  }
  // An aggregate needs something to group by; measures alone would reduce the
  // whole resource to one row, which is a different request and is not this one.
  const aggregate =
    need.groupBy.length > 0 && need.aggregate.length > 0
      ? { groupBy: need.groupBy, measures: need.aggregate }
      : undefined;

  const window = effectiveWindow(need);

  return {
    status: "AUTHORIZED",
    query: {
      queryId: `q_${randomUUID()}`,
      // From the session. Nothing in `need` reached this line.
      ownerScope,
      resource,
      fields,
      filters,
      sort: need.sort,
      limit: window.limit,
      offset: window.offset,
      identityImplicit,
      ...(aggregate ? { aggregate } : {}),
    },
  };
}

/**
 * Run an authorized query and normalise whatever comes back.
 *
 * The source returns plain rows. Positions, stable references, typed columns,
 * provenance and freshness are all added HERE, so every source produces the
 * same shape and a new adapter cannot invent its own.
 */
export async function executeAuthorizedQuery(query: AuthorizedQuery): Promise<DataOutcome> {
  const source = getDataSource(query.resource.sourceId);
  if (!source) {
    return {
      status: "BLOCKED_BY_CONFIGURATION",
      detail: `No data source is registered as «${query.resource.sourceId}».`,
      message: "مصدر البيانات لهذا المورد غير مُعدّ.",
    };
  }
  if (!source.available()) {
    return {
      status: "BLOCKED_BY_PROVIDER",
      detail: `Data source «${source.id}» is not available.`,
      message: "مصدر البيانات غير متاح حالياً. لم أعرض أي بيانات.",
    };
  }

  const sourceQuery: SourceQuery = {
    ownerScope: query.ownerScope,
    ownerColumn: query.resource.ownerColumn,
    ownerIsNumeric: query.resource.ownerIsNumeric,
    table: query.resource.table,
    columns: query.resource.sourceColumns,
    fields: query.fields,
    filters: query.filters,
    sort: query.sort,
    limit: query.limit,
    offset: query.offset,
    ...(query.aggregate ? { aggregate: query.aggregate } : {}),
  };

  const result = await source.read(sourceQuery);
  if (isSourceFailure(result)) {
    if (result.reason === "NOT_CONFIGURED") {
      return {
        status: "BLOCKED_BY_CONFIGURATION",
        detail: result.detail,
        message: "مصدر البيانات غير مكتمل الإعداد.",
      };
    }
    if (result.reason === "PROVIDER_UNAVAILABLE") {
      return {
        status: "BLOCKED_BY_PROVIDER",
        detail: result.detail,
        message: "مصدر البيانات غير متاح حالياً. لم أعرض أي بيانات.",
      };
    }
    return {
      status: "BLOCKED_BY_PROVIDER",
      detail: result.detail,
      message: "تعذّرت قراءة البيانات. لم أعرض أرقاماً غير مؤكدة.",
    };
  }

  // An aggregate's columns are its groups and its measures — not the resource's
  // record columns, which no longer describe what a row is.
  const columns: DatasetColumn[] = query.aggregate
    ? [
        ...query.aggregate.groupBy.flatMap((field) => {
          const column = findColumn(query.resource, field);
          return column ? [{ key: column.key, label: column.label, type: column.type }] : [];
        }),
        ...query.aggregate.measures.map((measure) => {
          const column = findColumn(query.resource, measure.field);
          return {
            key: `${measure.fn}_${measure.field}`,
            label:
              measure.fn === "COUNT"
                ? "العدد"
                : `${AGGREGATION_LABEL[measure.fn] ?? measure.fn} ${column?.label ?? measure.field}`,
            type: "NUMBER" as const,
          };
        }),
      ]
    : query.fields
        .filter(
          (field) => !(query.identityImplicit && field === query.resource.identityField),
        )
        .flatMap((field) => {
          const column = findColumn(query.resource, field);
          return column ? [{ key: column.key, label: column.label, type: column.type }] : [];
        });

  const rows: DatasetRow[] = result.rows.map((values, index) => ({
    // Runtime-assigned and opaque. A caller quotes one back; it cannot build one.
    ref: `r_${query.queryId}_${index + 1}`,
    position: index + 1,
    values,
  }));

  const now = new Date().toISOString();
  return {
    status: "OK",
    dataset: {
      datasetId: `ds_${randomUUID()}`,
      revision: 1,
      columns,
      rows,
      view: {
        fields: query.fields,
        sort: query.sort,
        filters: query.filters,
        window: { limit: query.limit, offset: query.offset },
        ...(result.totalRows !== undefined ? { totalRows: result.totalRows } : {}),
      },
      provenance: {
        resourceId: query.resource.id,
        sourceId: source.id,
        sourceKind: source.kind,
        observedAt: result.observedAt,
        generatedAt: now,
      },
      freshness: result.freshness,
      ...(query.aggregate
        ? {
            aggregation: {
              // Earned, not claimed: the source ran a GROUP BY over the whole
              // authorized set, so this is the real number.
              scope: "SOURCE" as const,
              groupBy: query.aggregate.groupBy,
              measures: query.aggregate.measures,
              coverage: { counted: result.totalRows ?? rows.length, total: result.totalRows },
            },
          }
        : {}),
      ownerScope: query.ownerScope,
    },
  };
}

const AGGREGATION_LABEL: Readonly<Record<string, string>> = Object.freeze({
  SUM: "مجموع",
  AVG: "متوسط",
  MIN: "أدنى",
  MAX: "أعلى",
});

/** Resolve, authorize and execute in one call. The only entry point callers need. */
export async function readCanonicalData(input: {
  need: DataNeed;
  ownerScope: string;
}): Promise<DataOutcome> {
  const authorization = authorizeDataNeed(input);
  if (authorization.status !== "AUTHORIZED") return authorization;
  return executeAuthorizedQuery(authorization.query);
}

/**
 * What may safely be recorded about a read.
 *
 * Shape and counts, never contents. No row payload, no filter VALUES (a filter
 * value is user data — «status = مرفوض» says something about them), no owner
 * id, no credentials.
 */
export function readObservation(input: {
  outcome: DataOutcome;
  query?: AuthorizedQuery;
  latencyMs: number;
}): Readonly<Record<string, unknown>> {
  const { outcome, query, latencyMs } = input;

  // A successful read describes itself: the dataset carries its own provenance
  // and the view that produced it. Taking the shape from there rather than
  // from the query means an observation is complete even when the caller did
  // not keep the query around — which is every caller that only wanted rows.
  const dataset = outcome.status === "OK" ? outcome.dataset : undefined;
  const view = dataset?.view;

  return Object.freeze({
    resource: query?.resource.id ?? dataset?.provenance.resourceId ?? null,
    sourceKind:
      (query ? getDataSource(query.resource.sourceId)?.kind : undefined) ??
      dataset?.provenance.sourceKind ??
      null,
    operations: query
      ? {
          projected: query.fields.length,
          filtered: query.filters.length,
          sorted: query.sort.length,
          limit: query.limit,
        }
      : view
        ? {
            projected: view.fields.length,
            filtered: view.filters.length,
            sorted: view.sort.length,
            limit: view.window.limit,
          }
        : null,
    status: outcome.status,
    rowCount: outcome.status === "OK" ? outcome.dataset.rows.length : 0,
    freshness: outcome.status === "OK" ? outcome.dataset.freshness : null,
    latencyMs,
  });
}
