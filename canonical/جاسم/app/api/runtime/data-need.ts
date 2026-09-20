/**
 * JASIM — DataNeed. What a person wants to see, stated semantically.
 *
 * The thin boundary the semantic router shipped with — `{ kind, subject }` —
 * was a placeholder that could point at a data layer without describing
 * anything. This is the real one.
 *
 * ─── WHAT A MODEL MAY SAY, AND WHAT IT MAY NOT ──────────────────────────────
 *
 * A model proposes SEMANTIC intent: which resource, which fields, which
 * filters, what order, how many. It may not say who is asking, what they are
 * allowed to see, or how to fetch it.
 *
 *   The model proposes intent.
 *   The runtime owns authorization and source resolution.
 *
 * So there is no field here for `ownerId`, `role`, `admin`, `permission` or
 * `authorizationScope`, and `.strict()` means a proposal carrying one is
 * REJECTED rather than trimmed — a trimmed injection looks like a normal
 * request, and the one that mattered would be the one nobody saw.
 *
 * There is also no field for SQL, no field for a table name, and no field for
 * anything executable. `resource` is a semantic word resolved against a closed
 * registry; it is not a table and cannot become one.
 */

import { z } from "zod";
import { sanitizeModelStructuredOutput } from "./model-output-trust";

/** Comparisons a filter may make. Deliberately four. */
export const FILTER_OPERATORS = ["EQ", "NEQ", "GTE", "LTE"] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** How a measure is reduced over a group. */
export const AGGREGATIONS = ["COUNT", "SUM", "AVG", "MIN", "MAX"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

/** What the person appears to want to look at. A hint, never an instruction. */
export const PRESENTATION_INTENTS = ["TABLE", "CHART", "METRIC", "LIST", "TIMELINE"] as const;
export type PresentationIntent = (typeof PRESENTATION_INTENTS)[number];

/** Ceilings, so an unbounded read cannot be asked for in the first place. */
export const MAX_WINDOW = 200;
export const MAX_FILTERS = 10;
export const MAX_SORT = 3;
export const MAX_FIELDS = 30;
export const DEFAULT_WINDOW = 50;

const FilterSchema = z
  .object({
    field: z.string().trim().min(1).max(80),
    operator: z.enum(FILTER_OPERATORS),
    // Scalars only. An object or an array here is the shape an injection takes
    // when a driver is asked to interpret it.
    value: z.union([z.string().max(300), z.number(), z.boolean()]),
  })
  .strict();

const SortSchema = z
  .object({
    field: z.string().trim().min(1).max(80),
    direction: z.enum(["ASC", "DESC"]),
  })
  .strict();

export const DataNeedSchema = z
  .object({
    version: z.literal(1),
    /** A semantic name, resolved against the resource registry. Not a table. */
    resource: z.string().trim().min(1).max(120),
    /** Empty means every readable column. */
    fields: z.array(z.string().trim().min(1).max(80)).max(MAX_FIELDS).default([]),
    filters: z.array(FilterSchema).max(MAX_FILTERS).default([]),
    sort: z.array(SortSchema).max(MAX_SORT).default([]),
    groupBy: z.array(z.string().trim().min(1).max(80)).max(3).default([]),
    aggregate: z
      .array(
        z
          .object({
            field: z.string().trim().min(1).max(80),
            fn: z.enum(AGGREGATIONS),
          })
          .strict(),
      )
      .max(5)
      .default([]),
    timeRange: z
      .object({
        field: z.string().trim().min(1).max(80),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      })
      .strict()
      .optional(),
    window: z
      .object({
        limit: z.number().int().min(1).max(MAX_WINDOW),
        offset: z.number().int().min(0).max(10_000),
      })
      .strict()
      .optional(),
    presentationIntent: z.enum(PRESENTATION_INTENTS).optional(),
    /** The person's own words, kept so an answer can quote what was asked. */
    subject: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

export type DataNeed = z.infer<typeof DataNeedSchema>;

/**
 * Keys a data need may never carry.
 *
 * Every one of them is an attempt to be the runtime. Mirrored into the shared
 * `AUTHORITY_KEYS` so one sanitiser covers every model output, and tested
 * against it.
 */
export const DATA_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "authorizationscope",
  "permission",
  "permissions",
  "bypassauthorization",
  "allrows",
  "allowners",
  "rawsql",
  "sqlquery",
  "tablename",
  "unsafe",
]);

/**
 * Parse a model's proposed data need.
 *
 * Throws `ModelOutputAuthorityError` on an authority claim and a `ZodError` on
 * a bad shape. Both loud: a malformed first link should not be repaired into a
 * plausible one.
 */
export function parseProposedDataNeed(value: unknown): DataNeed {
  const sanitized = sanitizeModelStructuredOutput(value, { label: "data need" });
  return DataNeedSchema.parse(sanitized.value);
}

/** The window a need asked for, bounded whether or not it asked. */
export function effectiveWindow(need: DataNeed): { limit: number; offset: number } {
  return {
    limit: Math.min(need.window?.limit ?? DEFAULT_WINDOW, MAX_WINDOW),
    offset: Math.max(0, need.window?.offset ?? 0),
  };
}
