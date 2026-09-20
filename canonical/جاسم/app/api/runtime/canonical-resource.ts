/**
 * JASIM — the readable-resource registry.
 *
 * A resource is a thing that can be READ: its columns, their types, which of
 * them may be filtered or sorted, whose data it is, and which source holds it.
 *
 * ─── A REGISTERED RESOURCE IS NOT A DOMAIN BRANCH ───────────────────────────
 *
 * `runs`, `tasks` and `conversations` are registered here; a connected business
 * would register `sales` or `stock` the same way. That is data, not
 * architecture: nothing in this file, in `authorized-query.ts` or in
 * `canonical-dataset.ts` knows what any of them MEAN. There is no SalesQuery
 * and nowhere to put one — adding a resource is adding a row to a list.
 *
 * ─── WHY ONLY JASIM'S OWN DATA IS REGISTERED TODAY ──────────────────────────
 *
 * Business data belongs to a business and arrives through an adapter its owner
 * connects. So «أرني مبيعاتي» resolves to no resource and answers UNAVAILABLE,
 * truthfully, while «أرني عملياتي» returns real rows. Registering a `sales`
 * resource backed by invented rows would make every proof above it worthless.
 */

import { conversations, runs, runtimeTasks } from "@db/schema";
import type { ColumnType } from "./canonical-dataset";

/** What a caller may do with a column. Absent means no. */
export type ColumnCapability = "FILTER" | "SORT" | "GROUP" | "AGGREGATE";

export type ResourceColumn = {
  readonly key: string;
  readonly label: string;
  readonly type: ColumnType;
  readonly capabilities: readonly ColumnCapability[];
  /**
   * A column that exists and may not be read.
   *
   * Requesting one is DENIED, never quietly dropped: silently removing a field
   * somebody asked for teaches them the data is not there, which is a
   * different and false fact.
   */
  readonly sensitive?: boolean;
};

export type CanonicalResource = {
  readonly id: string;
  /** Arabic, for a person. */
  readonly title: string;
  /** Words a person might use for this resource, for resolution. */
  readonly aliases: readonly string[];
  readonly columns: readonly ResourceColumn[];
  /** The column whose value gives each row its stable identity. */
  readonly identityField: string;
  readonly sourceId: string;
  /** The column the owner predicate is applied to. Never optional. */
  readonly ownerColumn: string;
  /** Whether the owner column stores a number. */
  readonly ownerIsNumeric: boolean;
  /** The source's own handle on the rows. Not a name any caller supplies. */
  readonly table: unknown;
  readonly sourceColumns: Readonly<Record<string, unknown>>;
};

// ── The registry ─────────────────────────────────────────────────────────────

const RESOURCES: readonly CanonicalResource[] = Object.freeze([
  {
    id: "runs",
    title: "العمليات",
    aliases: ["عملية", "عمليات", "عملياتي", "run", "runs", "operations"],
    columns: [
      { key: "id", label: "المعرّف", type: "IDENTIFIER", capabilities: [] },
      { key: "goal", label: "الهدف", type: "TEXT", capabilities: ["FILTER", "SORT"] },
      { key: "status", label: "الحالة", type: "ENUM", capabilities: ["FILTER", "SORT", "GROUP"] },
      { key: "createdAt", label: "أُنشئت", type: "TIMESTAMP", capabilities: ["FILTER", "SORT"] },
      { key: "updatedAt", label: "آخر تحديث", type: "TIMESTAMP", capabilities: ["FILTER", "SORT"] },
      // Present, and not readable. A caller asking for it gets DENIED.
      { key: "idempotencyKey", label: "مفتاح التكرار", type: "TEXT", capabilities: [], sensitive: true },
    ],
    identityField: "id",
    sourceId: "internal-runtime",
    ownerColumn: "ownerId",
    ownerIsNumeric: false,
    table: runs,
    sourceColumns: {
      id: runs.id,
      goal: runs.goal,
      status: runs.status,
      createdAt: runs.createdAt,
      updatedAt: runs.updatedAt,
      ownerId: runs.ownerId,
      idempotencyKey: runs.idempotencyKey,
    },
  },
  {
    id: "tasks",
    title: "المهام",
    aliases: ["مهمة", "مهام", "مهامي", "task", "tasks"],
    columns: [
      { key: "id", label: "المعرّف", type: "IDENTIFIER", capabilities: [] },
      { key: "goal", label: "الهدف", type: "TEXT", capabilities: ["FILTER", "SORT"] },
      { key: "status", label: "الحالة", type: "ENUM", capabilities: ["FILTER", "SORT", "GROUP"] },
      { key: "createdAt", label: "أُنشئت", type: "TIMESTAMP", capabilities: ["FILTER", "SORT"] },
      { key: "updatedAt", label: "آخر تحديث", type: "TIMESTAMP", capabilities: ["FILTER", "SORT"] },
    ],
    identityField: "id",
    sourceId: "internal-runtime",
    ownerColumn: "userId",
    ownerIsNumeric: true,
    table: runtimeTasks,
    sourceColumns: {
      id: runtimeTasks.id,
      goal: runtimeTasks.goal,
      status: runtimeTasks.status,
      createdAt: runtimeTasks.createdAt,
      updatedAt: runtimeTasks.updatedAt,
      userId: runtimeTasks.userId,
    },
  },
  {
    id: "conversations",
    title: "المحادثات",
    aliases: ["محادثة", "محادثات", "محادثاتي", "conversation", "conversations"],
    columns: [
      { key: "id", label: "المعرّف", type: "IDENTIFIER", capabilities: [] },
      { key: "title", label: "العنوان", type: "TEXT", capabilities: ["FILTER", "SORT"] },
      { key: "status", label: "الحالة", type: "ENUM", capabilities: ["FILTER", "SORT", "GROUP"] },
      { key: "createdAt", label: "أُنشئت", type: "TIMESTAMP", capabilities: ["FILTER", "SORT"] },
      { key: "updatedAt", label: "آخر تحديث", type: "TIMESTAMP", capabilities: ["FILTER", "SORT"] },
    ],
    identityField: "id",
    sourceId: "internal-runtime",
    ownerColumn: "userId",
    ownerIsNumeric: true,
    table: conversations,
    sourceColumns: {
      id: conversations.id,
      title: conversations.title,
      status: conversations.status,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      userId: conversations.userId,
    },
  },
]);

export function listCanonicalResources(): readonly CanonicalResource[] {
  return RESOURCES;
}

/**
 * Find the resource a person named.
 *
 * Exact id first, then aliases, then a contained alias — «أرني عملياتي» and
 * «اعرض لي المهام» both land. A request that matches nothing returns
 * `undefined`, and the caller answers UNAVAILABLE: guessing the nearest
 * resource would answer a question nobody asked.
 */
export function resolveCanonicalResource(requested: string): CanonicalResource | undefined {
  if (typeof requested !== "string" || !requested.trim()) return undefined;
  const needle = requested.trim().toLocaleLowerCase("ar");

  const exact = RESOURCES.find((resource) => resource.id === needle);
  if (exact) return exact;

  const aliased = RESOURCES.find((resource) =>
    resource.aliases.some((alias) => bare(alias) === bare(needle)),
  );
  if (aliased) return aliased;

  // Whole words only.
  //
  // A substring rule was the first version and it was wrong: «ساعات تشغيل
  // المخرطة» — a lathe's operating hours — matched the runs resource because
  // «تشغيل» appeared inside it. Resolving an unrelated subject to a real
  // resource is worse than resolving nothing, because it answers confidently
  // with somebody else's question. A generality test caught it.
  const words = new Set(needle.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(bare));
  return RESOURCES.find((resource) =>
    resource.aliases.some((alias) => words.has(bare(alias))),
  );
}

/**
 * A word without its definite article.
 *
 * «المهام» and «مهام» are the same word, and whole-word matching would treat
 * them as different without this. The length guard stops «الآن» collapsing to
 * «آن» and matching something it should not.
 */
function bare(word: string): string {
  const lower = word.toLocaleLowerCase("ar");
  return lower.startsWith("ال") && lower.length > 4 ? lower.slice(2) : lower;
}

/** The columns a caller may actually read. */
export function readableColumns(resource: CanonicalResource): readonly ResourceColumn[] {
  return resource.columns.filter((column) => !column.sensitive);
}

export function findColumn(
  resource: CanonicalResource,
  key: string,
): ResourceColumn | undefined {
  return resource.columns.find((column) => column.key === key);
}
