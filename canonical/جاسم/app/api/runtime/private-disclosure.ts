/**
 * TELLING ONE PERSON SOMETHING, BECAUSE THEY AGREED TO DO SOMETHING FOR YOU.
 *
 * ── THE GAP, TRACED ON THE LIVE PATH ────────────────────────────────────────
 *
 * «سيارتي تعطلت — ابحث عن مكانيكي، أخبره بالمشكلة، وإن وافقت أرسل له موقعي».
 *
 * A precise point never enters a public projection, and that is correct:
 *
 *   EXACT_COORDINATES_IN_A_PUBLIC_PROJECTION = 0
 *
 * But it left nothing that could ever tell the mechanic where to come. Traced
 * before this file was written: no module in the runtime released a private
 * field to a counterparty, under any authority, ever. The request ran to the
 * end of its chain — found, asked, proposed, agreed — and then stopped at the
 * one step that makes it useful.
 *
 * ── WHAT AUTHORIZES A RELEASE ───────────────────────────────────────────────
 *
 *   AGREEMENT_IS_THE_DISCLOSURE_AUTHORITY
 *
 * Not an engagement. An engagement is a CHANNEL — two parties able to speak —
 * and being able to speak to somebody has never been permission to learn where
 * they live. An accepted agreement is the thing that makes a release
 * proportionate: somebody agreed to come, so they may be told where to.
 *
 *   MODEL_DISCLOSES = 0
 *     The release is the OWNER'S act. The model may propose it, present it and
 *     word it; it cannot perform it, and nothing on a request path supplies the
 *     discloser.
 *
 *   DISCLOSED != PUBLISHED
 *     One named recipient. The subject's public projection is not touched, not
 *     widened, and not re-published.
 *
 *   DISCLOSING_WHAT_IS_NOT_THERE = 0
 *     A field the subject does not hold cannot be released. There is nothing to
 *     release, and writing a row saying otherwise would be a record of a fact
 *     that never existed.
 *
 *   AGREEMENT_ENDS != DISCLOSURE_UNHAPPENS
 *     Withdrawal stops FUTURE reads. It does not claim the recipient forgot,
 *     and the ledger keeps saying they were told. A runtime that quietly
 *     deleted the row would be lying about its own history.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 * There is no LocationSharing, no DriverDispatch and no AddressBook. The field
 * is a string, the subject is any subject, and a phone number, a door code, a
 * serial number or a site plan travel the same path as a point.
 *
 *   DOMAIN_DISCLOSURE_TYPES_ADDED = 0
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { agreements, privateDisclosures, type PrivateDisclosure } from "@db/schema-block2";
import { economicExpressions } from "@db/schema";

type Db = NodePgDatabase<any>;

export class DisclosureError extends Error {
  readonly code:
    | "NO_AGREEMENT"
    | "NOT_A_PARTY"
    | "NOT_THE_OWNER"
    | "NOTHING_TO_DISCLOSE"
    | "NO_RECIPIENT"
    | "WITHDRAWN";
  constructor(message: string, code: DisclosureError["code"]) {
    super(message);
    this.code = code;
    this.name = "DisclosureError";
  }
}

/** The only subject kind the fabric stores attributes for today. */
export const DISCLOSABLE_SUBJECT_KIND = "economic_expression";

async function liveAgreement(db: Db, agreementId: string) {
  const [row] = await db
    .select()
    .from(agreements)
    .where(eq(agreements.id, agreementId))
    .limit(1);
  if (!row) throw new DisclosureError("No such agreement.", "NO_AGREEMENT");
  // An agreement that was never accepted, or that has been undone, authorizes
  // nothing. A release is proportionate to a live commitment, not to a draft.
  if (row.status !== "agreed") {
    throw new DisclosureError(
      `The agreement is ${row.status}; a release needs a live one.`,
      "NO_AGREEMENT",
    );
  }
  return row;
}

async function subjectAttributes(
  db: Db,
  subjectKind: string,
  subjectId: string,
): Promise<{ ownerId: string; attributes: Record<string, unknown> } | null> {
  if (subjectKind !== DISCLOSABLE_SUBJECT_KIND) return null;
  const [row] = await db
    .select()
    .from(economicExpressions)
    .where(eq(economicExpressions.id, subjectId))
    .limit(1);
  if (!row) return null;
  return {
    ownerId: row.ownerId,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
  };
}

/**
 * Release one field of something you own to one counterparty you agreed with.
 *
 * Idempotent per (agreement, subject, field, recipient): telling the same
 * person the same thing under the same agreement is ONE disclosure, not a
 * second one, so a retried turn cannot inflate the ledger.
 */
export async function discloseToCounterparty(
  db: Db,
  input: {
    agreementId: string;
    discloserOwnerId: string;
    subjectKind: string;
    subjectId: string;
    field: string;
    /** Required only when the agreement has more than two parties. */
    recipientOwnerId?: string;
  },
): Promise<PrivateDisclosure> {
  const agreement = await liveAgreement(db, input.agreementId);
  if (!agreement.participants.includes(input.discloserOwnerId)) {
    throw new DisclosureError("Not a party to this agreement.", "NOT_A_PARTY");
  }

  const subject = await subjectAttributes(db, input.subjectKind, input.subjectId);
  if (!subject) throw new DisclosureError("No such subject.", "NOTHING_TO_DISCLOSE");
  //   MODEL_DISCLOSES = 0 — and neither does a counterparty. Only the owner of
  //   the thing may release what it holds.
  if (subject.ownerId !== input.discloserOwnerId) {
    throw new DisclosureError("Only the owner may release this.", "NOT_THE_OWNER");
  }
  //   DISCLOSING_WHAT_IS_NOT_THERE = 0
  if (subject.attributes[input.field] === undefined || subject.attributes[input.field] === null) {
    throw new DisclosureError(
      `The subject holds no «${input.field}» to release.`,
      "NOTHING_TO_DISCLOSE",
    );
  }

  const others = agreement.participants.filter((party) => party !== input.discloserOwnerId);
  const recipient = input.recipientOwnerId ?? (others.length === 1 ? others[0] : undefined);
  if (!recipient || !others.includes(recipient)) {
    // With three parties «the other one» is not a fact, and picking one would
    // be the runtime deciding who learns where somebody is.
    throw new DisclosureError(
      "Name which party is being told; with more than two, there is no «the other one».",
      "NO_RECIPIENT",
    );
  }

  const existing = await db
    .select()
    .from(privateDisclosures)
    .where(
      and(
        eq(privateDisclosures.agreementId, input.agreementId),
        eq(privateDisclosures.subjectKind, input.subjectKind),
        eq(privateDisclosures.subjectId, input.subjectId),
        eq(privateDisclosures.field, input.field),
        eq(privateDisclosures.recipientOwnerId, recipient),
      ),
    )
    .limit(1);
  if (existing[0]) {
    if (!existing[0].withdrawnAt) return existing[0];
    // Re-releasing what was withdrawn is a new decision by the owner, and it
    // reopens the same row rather than pretending the withdrawal never was.
    const [reopened] = await db
      .update(privateDisclosures)
      .set({ withdrawnAt: null, disclosedAt: new Date() })
      .where(eq(privateDisclosures.id, existing[0].id))
      .returning();
    return reopened!;
  }

  const [created] = await db
    .insert(privateDisclosures)
    .values({
      id: `disc_${randomUUID()}`,
      agreementId: input.agreementId,
      engagementId: agreement.engagementId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      field: input.field,
      discloserOwnerId: input.discloserOwnerId,
      recipientOwnerId: recipient,
    })
    .returning();
  return created!;
}

export type DisclosedRead =
  | { readonly status: "RELEASED"; readonly field: string; readonly value: unknown }
  | { readonly status: "NOT_DISCLOSED" }
  | { readonly status: "WITHDRAWN"; readonly withdrawnAt: Date };

/**
 * Read what you were told.
 *
 * The value is read from the subject AT READ TIME, not copied into the
 * disclosure row. A disclosure is permission to look, not a snapshot — so a
 * car that has been towed reports where it is now, and a withdrawal actually
 * stops the reading rather than leaving a stale copy behind.
 *
 *   DISCLOSURE_IS_PERMISSION_TO_LOOK, NOT A COPY
 */
export async function readDisclosedField(
  db: Db,
  input: {
    recipientOwnerId: string;
    subjectKind: string;
    subjectId: string;
    field: string;
    agreementId?: string;
  },
): Promise<DisclosedRead> {
  const [row] = await db
    .select()
    .from(privateDisclosures)
    .where(
      and(
        eq(privateDisclosures.recipientOwnerId, input.recipientOwnerId),
        eq(privateDisclosures.subjectKind, input.subjectKind),
        eq(privateDisclosures.subjectId, input.subjectId),
        eq(privateDisclosures.field, input.field),
        ...(input.agreementId ? [eq(privateDisclosures.agreementId, input.agreementId)] : []),
      ),
    )
    .orderBy(desc(privateDisclosures.disclosedAt))
    .limit(1);
  if (!row) return { status: "NOT_DISCLOSED" };
  if (row.withdrawnAt) return { status: "WITHDRAWN", withdrawnAt: row.withdrawnAt };

  const subject = await subjectAttributes(db, input.subjectKind, input.subjectId);
  if (!subject || subject.attributes[input.field] === undefined) {
    // The owner removed it. Nothing is invented and no stale copy is served.
    return { status: "NOT_DISCLOSED" };
  }
  return { status: "RELEASED", field: input.field, value: subject.attributes[input.field] };
}

/**
 * Stop a release.
 *
 *   AGREEMENT_ENDS != DISCLOSURE_UNHAPPENS
 *
 * The row stays and keeps saying they were told. Only the discloser may do
 * this: a recipient cannot erase the record that they learned something.
 */
export async function withdrawDisclosure(
  db: Db,
  input: { id: string; ownerId: string },
): Promise<PrivateDisclosure> {
  const [row] = await db
    .select()
    .from(privateDisclosures)
    .where(eq(privateDisclosures.id, input.id))
    .limit(1);
  if (!row) throw new DisclosureError("No such disclosure.", "NOTHING_TO_DISCLOSE");
  if (row.discloserOwnerId !== input.ownerId) {
    throw new DisclosureError("Only the discloser may withdraw this.", "NOT_THE_OWNER");
  }
  if (row.withdrawnAt) return row;
  const [updated] = await db
    .update(privateDisclosures)
    .set({ withdrawnAt: new Date() })
    .where(eq(privateDisclosures.id, input.id))
    .returning();
  return updated!;
}

/**
 * «من يعرف أين أنا؟»
 *
 * Answerable by construction, and only to the owner of the subject. A ledger
 * anybody could read would be a second disclosure.
 */
export async function disclosuresAbout(
  db: Db,
  input: {
    ownerId: string;
    subjectKind: string;
    subjectId: string;
    includeWithdrawn?: boolean;
  },
): Promise<readonly PrivateDisclosure[]> {
  const subject = await subjectAttributes(db, input.subjectKind, input.subjectId);
  if (!subject) return [];
  if (subject.ownerId !== input.ownerId) {
    throw new DisclosureError("Only the owner may read this ledger.", "NOT_THE_OWNER");
  }
  return db
    .select()
    .from(privateDisclosures)
    .where(
      and(
        eq(privateDisclosures.subjectKind, input.subjectKind),
        eq(privateDisclosures.subjectId, input.subjectId),
        ...(input.includeWithdrawn ? [] : [isNull(privateDisclosures.withdrawnAt)]),
      ),
    )
    .orderBy(desc(privateDisclosures.disclosedAt));
}
