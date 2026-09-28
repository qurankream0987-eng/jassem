/**
 * JASIM — WHAT A SELLER SAID, AND NOT WHAT A MODEL UNDERSTOOD.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   MODEL_EXTRACTION != SELLER_DECLARATION
 *   IMAGE_INTERPRETATION != SELLER_DECLARATION
 *   DRAFT != PUBLISHED
 *   PUBLISH_CONFIRMS_EXACT_CONTENT
 *   STALE_CONFIRMATION_PUBLISHES = 0
 *
 * ─── WHAT THE TRACE FOUND ───────────────────────────────────────────────────
 *
 * `publishTurn` took `envelope.intent.inputs` — a model's reading of a
 * sentence — and wrote it straight into a PUBLIC offering attributed to the
 * seller, in one step. It refused only when a subject or a price was missing.
 *
 * So a seller who said «انشر عرضي» published whatever the model decided the
 * offering says. Every other place in this repository already refuses that
 * shape:
 *
 *   LLM != Authority
 *
 * and this is the place where it costs the most, because a public listing
 * BINDS ITS OWNER. A colour the model inferred from a photo, a year it read
 * out of a filename, a condition it summarised generously — the seller answers
 * for all of it, to a buyer, and later to whoever adjudicates the sale.
 *
 * ─── SO A DRAFT IS A THING, AND CONFIRMING IS AN ACT ────────────────────────
 *
 * A seller composes across as many turns as they like. Nothing is public. What
 * they get back is the EXACT text that will be published and a fingerprint of
 * it, and publishing quotes that fingerprint back.
 *
 * Confirming «publish» is not the same as confirming WHAT. If anything changed
 * between seeing and confirming — one more sentence from the seller, one amended
 * value — the fingerprint moved and the confirmation is refused rather than
 * applied to words nobody read.
 *
 * ─── PHOTOS ARE NOT STATEMENTS ──────────────────────────────────────────────
 *
 * Attachments are carried as REFERENCES and never interpreted here. This module
 * calls no model, and an image cannot become an attribute: a picture of a white
 * car is evidence that there is a picture, and the seller is the one who says
 * the car is white.
 *
 * ─── WHAT THIS DOES NOT DECIDE ──────────────────────────────────────────────
 *
 * What a KIND of thing ought to state. There is no schema registry here and none
 * is invented: `schemaRef` exists on the row and is still unread. A missing
 * detail surfaces the honest way — a buyer asks about it, through the brokering
 * that phase closed, and the seller answers in their own words.
 *
 *   MISSING_DETAIL_INVENTED_FROM_A_DOMAIN_TEMPLATE = 0
 */

import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../queries/connection";
import { economicExpressions, type EconomicExpression } from "../../db/schema";
import {
  EconomicAuthorizationError,
  EconomicNotFoundError,
  createExpression,
  publishExpression,
} from "./economic-fabric";
import { canonicalJson } from "./capability-registry";

/**
 * WHAT THE SELLER WILL BE SAYING, AND WHAT CONFIRMING IT MEANS.
 *
 * `statement` is the whole of it — the kind, the stated values, the attachments
 * and the exact public words — and `fingerprint` names that whole. Nothing is
 * summarised away, because a confirmation over a summary confirms a summary.
 */
export type DraftStatement = {
  readonly expressionId: string;
  readonly semanticType: string;
  /** EXACTLY what the seller stated. Never a model's reading of it. */
  readonly stated: Readonly<Record<string, unknown>>;
  /** References only. Nothing here is read, described or interpreted. */
  readonly attachments: readonly string[];
  /** The exact words that would become public. */
  readonly willPublish: Readonly<Record<string, unknown>>;
  readonly version: number;
  /** What `publishComposedOffering` must quote back. */
  readonly fingerprint: string;
};

function fingerprintOf(row: EconomicExpression): string {
  // The version is part of it, so an amendment cannot leave an old
  // confirmation valid by coincidence of content.
  return createHash("sha256")
    .update(
      canonicalJson({
        id: row.id,
        semanticType: row.semanticType,
        attributes: row.attributes ?? {},
        projection: row.publicProjection ?? {},
        version: row.version,
      }),
      "utf8",
    )
    .digest("hex");
}

function statementOf(row: EconomicExpression): DraftStatement {
  const attributes = { ...(row.attributes ?? {}) } as Record<string, unknown>;
  const attachments = Array.isArray(attributes.attachments)
    ? attributes.attachments.filter((one): one is string => typeof one === "string")
    : [];
  delete attributes.attachments;
  return {
    expressionId: row.id,
    semanticType: row.semanticType,
    stated: attributes,
    attachments,
    willPublish: (row.publicProjection ?? {}) as Record<string, unknown>,
    version: row.version,
    fingerprint: fingerprintOf(row),
  };
}

async function draftOwnedBy(
  expressionId: string,
  ownerId: string,
): Promise<EconomicExpression> {
  const [row] = await db
    .select()
    .from(economicExpressions)
    .where(
      and(eq(economicExpressions.id, expressionId), eq(economicExpressions.ownerId, ownerId)),
    )
    .limit(1);
  // ONE refusal for «no such thing» and «not yours». Telling them apart is an
  // existence oracle over other people's drafts.
  if (!row) throw new EconomicNotFoundError("Draft not found.");
  return row;
}

/**
 * COMPOSE, OR AMEND. Nothing here becomes public.
 *
 * `stated` is what the SELLER states. Whatever produced it — a form, a parsed
 * sentence, a model's proposal the seller accepted — it arrives having been
 * stated, and this module stores it without adding to it.
 */
export async function composeOffering(input: {
  ownerId: string;
  /** Absent creates a new draft; present amends that draft. */
  expressionId?: string;
  semanticType?: string;
  /** Replaces the stated values wholesale, so removing one is possible. */
  stated?: Record<string, unknown>;
  attachments?: readonly string[];
  /** The exact words that would become public, if the seller publishes. */
  willPublish?: Record<string, unknown>;
}): Promise<DraftStatement> {
  if (!input.expressionId) {
    const semanticType = input.semanticType?.trim();
    if (!semanticType) {
      throw new EconomicAuthorizationError("An offering with no kind is not an offering.");
    }
    const created = await createExpression({
      ownerId: input.ownerId,
      kind: "offering",
      semanticType,
      attributes: {
        ...(input.stated ?? {}),
        ...(input.attachments?.length ? { attachments: [...input.attachments] } : {}),
      },
    });
    if (input.willPublish) {
      return composeOffering({ ...input, expressionId: created.id });
    }
    return statementOf(created);
  }

  const row = await draftOwnedBy(input.expressionId, input.ownerId);
  // PUBLISHED IS NOT A DRAFT. Amending in place would change what buyers are
  // already looking at without anybody publishing anything.
  //
  //   DRAFT != PUBLISHED
  if (row.visibility !== "private" || row.status !== "draft") {
    throw new EconomicAuthorizationError(
      "That offering is published; composing again is a new statement, not an edit.",
    );
  }
  const stated =
    input.stated !== undefined
      ? { ...input.stated }
      : ({ ...(row.attributes ?? {}) } as Record<string, unknown>);
  delete (stated as Record<string, unknown>).attachments;
  const attachments =
    input.attachments !== undefined
      ? [...input.attachments]
      : Array.isArray(row.attributes?.attachments)
        ? (row.attributes.attachments as unknown[]).filter(
            (one): one is string => typeof one === "string",
          )
        : [];
  const [updated] = await db
    .update(economicExpressions)
    .set({
      ...(input.semanticType?.trim() ? { semanticType: input.semanticType.trim() } : {}),
      attributes: { ...stated, ...(attachments.length ? { attachments } : {}) },
      ...(input.willPublish !== undefined ? { publicProjection: input.willPublish } : {}),
      // EVERY AMENDMENT MOVES THE VERSION, so every earlier confirmation is
      // void by construction rather than by comparison.
      version: row.version + 1,
    })
    .where(eq(economicExpressions.id, row.id))
    .returning();
  return statementOf(updated!);
}

/** What this draft currently says. The seller's own read, before confirming. */
export async function readDraft(input: {
  expressionId: string;
  ownerId: string;
}): Promise<DraftStatement> {
  return statementOf(await draftOwnedBy(input.expressionId, input.ownerId));
}

/**
 * PUBLISH WHAT WAS READ, AND ONLY THAT.
 *
 * The fingerprint is the whole point: it says WHICH statement is being
 * published, not merely that publishing was requested. A draft that moved since
 * the seller read it is refused, because the alternative is publishing words in
 * somebody's name that they never saw.
 *
 *   PUBLISH_CONFIRMS_EXACT_CONTENT · STALE_CONFIRMATION_PUBLISHES = 0
 */
export async function publishComposedOffering(input: {
  expressionId: string;
  ownerId: string;
  confirmFingerprint: string;
}): Promise<{ readonly expressionId: string; readonly version: number }> {
  const row = await draftOwnedBy(input.expressionId, input.ownerId);
  if (row.visibility !== "private" || row.status !== "draft") {
    throw new EconomicAuthorizationError("That offering is already published.");
  }
  const current = fingerprintOf(row);
  if (current !== input.confirmFingerprint) {
    throw new EconomicAuthorizationError(
      "This statement changed since it was read; read it again before publishing.",
    );
  }
  const projection = (row.publicProjection ?? {}) as Record<string, unknown>;
  if (Object.keys(projection).length === 0) {
    // A published offering that says nothing is not a listing; it is a row.
    throw new EconomicAuthorizationError("There is nothing here to publish yet.");
  }
  // The existing owner-gated publish, with its authorized-keys check. This adds
  // no second path to public.
  const published = await publishExpression({
    id: row.id,
    ownerId: input.ownerId,
    projection,
  });
  return { expressionId: published.id, version: published.version };
}
