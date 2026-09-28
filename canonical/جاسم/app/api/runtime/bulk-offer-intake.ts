/**
 * JASIM — صفوف كثيرة تُقترَح، ولا شيء منها يَصير حقيقة وحده.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   BULK_ROW_PUBLISHES_ITSELF = 0
 *   SPREADSHEET_ROW != TRUSTED_LIVE_STOCK
 *   BATCH_CONFIRMATION_COVERS_EXACT_ROWS
 *   ONE_CHANGED_ROW_VOIDS_THE_BATCH
 *   GAP_DETECTION_USES_A_DOMAIN_TEMPLATE = 0
 *
 * ─── WHAT THIS IS, AND WHAT IT IS NOT ───────────────────────────────────────
 *
 * An owner with a thousand things should not have to say them a thousand times.
 * But a thousand rows arriving at once must not become a thousand public
 * promises either, and the previous phase's law does not bend for volume:
 *
 *   PUBLISH_CONFIRMS_EXACT_CONTENT
 *
 * So this is intake, not import. Every row becomes a DRAFT through the one
 * composition path that already exists, nothing reaches the public, and what
 * the owner confirms is a batch fingerprint over the exact statements they read.
 * Change one row and the batch confirmation is void — for the same reason
 * changing one value voids a single one.
 *
 * ─── AND IT KNOWS NOTHING ABOUT WHAT THE ROWS MEAN ──────────────────────────
 *
 * There is no file format here, no spreadsheet, no catalogue and no API. Those
 * are edges: something out there turns bytes into rows. This takes rows that
 * have already been read and knows nothing about whether they are cars, meals,
 * machine hours or lake surveys.
 *
 *   FORMAT_BRANCHES = 0 · DOMAIN_BRANCHES = 0
 *
 * ─── HOW A GAP IS FOUND WITHOUT A TEMPLATE ──────────────────────────────────
 *
 * The previous phase refused to build a registry saying what a KIND of thing
 * ought to state, because that is a template per domain. That refusal stands.
 *
 * What is reported here is narrower and comes only from primitives this
 * repository already has — a value that is STRUCTURALLY unusable, whatever it
 * describes:
 *
 *   NO_KIND                      `composeOffering` already refuses this.
 *   MONEY_WITHOUT_CURRENCY       `assertCurrency` refuses money with no
 *                                currency. An amount alone is not an amount.
 *   QUANTITY_UNIT_DECLARED_BUT_EMPTY
 *                                The row said a quantity has a unit and then
 *                                supplied none. It contradicts itself.
 *   NOTHING_TO_PUBLISH           `publishComposedOffering` already refuses this.
 *
 * Not one of those says «a car needs a mileage». Each says «this value cannot
 * be used by machinery that already exists», which is a fact about the runtime
 * and not about the world.
 */

import { createHash } from "node:crypto";
import { CURRENCY_CODE } from "./block3/money";
import { canonicalJson } from "./capability-registry";
import { EconomicAuthorizationError } from "./economic-fabric";
import type { ValueProvenance } from "./economic-fabric";
import {
  composeOffering,
  publishComposedOffering,
  readDraft,
  type DraftStatement,
} from "./seller-composition";

/** One row an owner is proposing. The `ref` is theirs, so a gap is addressable. */
export type ProposedRow = {
  /** The channel's own reference for this row, echoed back in every report. */
  readonly ref: string;
  readonly semanticType?: string;
  readonly stated?: Record<string, unknown>;
  readonly provenance?: Record<string, ValueProvenance>;
  readonly attachments?: readonly string[];
  readonly willPublish?: Record<string, unknown>;
};

/** Why one row cannot be published as it stands. Structural, never a template. */
export const ROW_GAPS = [
  "NO_KIND",
  "MONEY_WITHOUT_CURRENCY",
  "QUANTITY_UNIT_DECLARED_BUT_EMPTY",
  "NOTHING_TO_PUBLISH",
] as const;
export type RowGapReason = (typeof ROW_GAPS)[number];

export type RowGap = {
  readonly ref: string;
  readonly reason: RowGapReason;
  /** Which value, when the gap is about one. */
  readonly field?: string;
};

export type IntakeReport = {
  /** Drafted and publishable as they stand. Private, every one of them. */
  readonly ready: readonly { readonly ref: string; readonly expressionId: string }[];
  /** Drafted where possible, and not publishable until the owner fills them. */
  readonly gaps: readonly RowGap[];
  /**
   * WHAT CONFIRMING THE BATCH MEANS: these exact statements, as they are now.
   *
   * Built from each draft's own fingerprint, so one amended row moves it — the
   * single-offering law at scale rather than a weaker version of it.
   */
  readonly batchFingerprint: string;
};

/** The money convention this repository already uses: minor units + a currency. */
function moneyGaps(ref: string, stated: Record<string, unknown>): RowGap[] {
  const minorFields = Object.keys(stated).filter(
    (field) => field.endsWith("Minor") && typeof stated[field] === "number",
  );
  const currency = stated.currency;
  if (minorFields.length === 0) {
    // A currency with nothing to denominate is not a gap; it says nothing.
    return [];
  }
  if (typeof currency !== "string" || !CURRENCY_CODE.test(currency.trim().toUpperCase())) {
    return minorFields.map((field) => ({ ref, reason: "MONEY_WITHOUT_CURRENCY" as const, field }));
  }
  return [];
}

/**
 * The quantity convention this repository already uses: a number and a sibling
 * `<field>Unit`.
 *
 * ─── AND A RULE THAT WAS TRIED AND WITHDRAWN ────────────────────────────────
 *
 * The first version of this reported a gap when `normalizeUnit` could not place
 * the unit — «hectare», «m3» — on the reasoning that an unplaceable unit makes
 * the number unusable. Tracing `evaluateConstraint` showed that is FALSE:
 * normalization is only reached when the two unit strings DIFFER, so a need in
 * `m3` against an offering in `m3` compares its numbers directly and works
 * perfectly. The rule would have flagged rows that function.
 *
 *   A GAP NOBODY HAS IS A GAP NOBODY SHOULD BE ASKED TO FILL.
 *
 * What is left is only self-contradiction: the row declared that a quantity has
 * a unit and then supplied nothing for it. That is structural, and needs no
 * template to see.
 *
 * (The unit table covers mass, time and count only — no volume and no area — so
 * cross-unit conversion in those dimensions is genuinely missing. That is a
 * separate gap in `semantic-fabric`, recorded rather than patched from here.)
 */
function unitGaps(ref: string, stated: Record<string, unknown>): RowGap[] {
  const gaps: RowGap[] = [];
  for (const field of Object.keys(stated)) {
    if (!field.endsWith("Unit")) continue;
    const quantityField = field.slice(0, -"Unit".length);
    if (typeof stated[quantityField] !== "number") continue;
    const declared = stated[field];
    if (typeof declared !== "string" || declared.trim().length === 0) {
      gaps.push({ ref, reason: "QUANTITY_UNIT_DECLARED_BUT_EMPTY", field: quantityField });
    }
  }
  return gaps;
}

function batchFingerprintOf(
  drafts: readonly { readonly ref: string; readonly fingerprint: string }[],
): string {
  return createHash("sha256")
    .update(
      canonicalJson(
        [...drafts]
          .map((one) => ({ ref: one.ref, fingerprint: one.fingerprint }))
          .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)),
      ),
      "utf8",
    )
    .digest("hex");
}

/**
 * TAKE THE ROWS IN AS DRAFTS, AND REPORT WHAT IS MISSING.
 *
 * Nothing here publishes. Every row that can be drafted is drafted through the
 * same owner-gated composition path a single offering uses, so provenance,
 * attachments and the draft/published boundary all behave identically whether
 * one row arrived or a thousand.
 */
export async function intakeOfferedRows(input: {
  ownerId: string;
  rows: readonly ProposedRow[];
}): Promise<IntakeReport> {
  const seen = new Set<string>();
  for (const row of input.rows) {
    const ref = row.ref?.trim();
    if (!ref) {
      throw new EconomicAuthorizationError("Every proposed row needs its own reference.");
    }
    if (seen.has(ref)) {
      // Two rows with one reference cannot both be corrected, and a report that
      // named the same row twice would be unusable.
      throw new EconomicAuthorizationError(`Row reference «${ref}» appears more than once.`);
    }
    seen.add(ref);
  }

  const ready: { ref: string; expressionId: string }[] = [];
  const drafted: { ref: string; fingerprint: string }[] = [];
  const gaps: RowGap[] = [];

  for (const row of input.rows) {
    const ref = row.ref.trim();
    const stated = row.stated ?? {};
    const rowGaps = [...moneyGaps(ref, stated), ...unitGaps(ref, stated)];
    if (!row.semanticType?.trim()) {
      // Without a kind there is nothing to draft at all, so this row produces a
      // gap and no expression — the owner names it and sends it again.
      gaps.push({ ref, reason: "NO_KIND" });
      continue;
    }
    if (!row.willPublish || Object.keys(row.willPublish).length === 0) {
      rowGaps.push({ ref, reason: "NOTHING_TO_PUBLISH" });
    }

    const draft = await composeOffering({
      ownerId: input.ownerId,
      semanticType: row.semanticType,
      stated,
      ...(row.provenance ? { provenance: row.provenance } : {}),
      ...(row.attachments ? { attachments: row.attachments } : {}),
      ...(row.willPublish ? { willPublish: row.willPublish } : {}),
    });

    if (rowGaps.length > 0) {
      // Drafted so it can be corrected, and out of the publishable set until it
      // is. A gap is reported, never filled in on somebody's behalf.
      gaps.push(...rowGaps);
      continue;
    }
    ready.push({ ref, expressionId: draft.expressionId });
    drafted.push({ ref, fingerprint: draft.fingerprint });
  }

  return { ready, gaps, batchFingerprint: batchFingerprintOf(drafted) };
}

/**
 * PUBLISH EXACTLY WHAT WAS READ, ALL OF IT OR NONE.
 *
 * The batch fingerprint is recomputed from the drafts as they are NOW. If any
 * one of them moved — or if the set named here is not the set that was read —
 * nothing is published.
 *
 *   BATCH_CONFIRMATION_COVERS_EXACT_ROWS · ONE_CHANGED_ROW_VOIDS_THE_BATCH
 */
export async function publishIntakeBatch(input: {
  ownerId: string;
  /** The exact set that was read, by the references the report gave back. */
  entries: readonly { readonly ref: string; readonly expressionId: string }[];
  confirmBatchFingerprint: string;
}): Promise<{ readonly published: readonly string[] }> {
  if (input.entries.length === 0) {
    throw new EconomicAuthorizationError("There is nothing here to publish.");
  }
  // Read every draft first. A batch that is only half valid publishes nothing,
  // so the owner is never left with a partial statement they did not choose.
  const current: { ref: string; fingerprint: string; draft: DraftStatement }[] = [];
  for (const entry of input.entries) {
    const draft = await readDraft({ expressionId: entry.expressionId, ownerId: input.ownerId });
    current.push({ ref: entry.ref, fingerprint: draft.fingerprint, draft });
  }
  if (batchFingerprintOf(current) !== input.confirmBatchFingerprint) {
    throw new EconomicAuthorizationError(
      "These statements changed since they were read; read them again before publishing.",
    );
  }
  const published: string[] = [];
  for (const one of current) {
    // The single-offering door, once per statement, with its own confirmation.
    await publishComposedOffering({
      expressionId: one.draft.expressionId,
      ownerId: input.ownerId,
      confirmFingerprint: one.fingerprint,
    });
    published.push(one.draft.expressionId);
  }
  return { published };
}
