/**
 * Block 3 §14–§16 — the ONE generic commercial order/checkout primitive.
 *
 * One order shape for every domain (buy, book, employ, subscribe…). Terms
 * are versioned and fingerprinted: any consequential mutation (price,
 * quantity, payee, currency) bumps termsVersion + termsFingerprint, so a
 * PaymentIntent can bind to the exact terms it pays for.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { commercialOrders, type CommercialOrderRecord } from "@db/schema";
import type { Block2Db } from "../block2/temporal";

export type CommercialOrderStatus = "DRAFT" | "CONFIRMED" | "FULFILLED" | "CANCELLED";

const ORDER_TRANSITIONS: Record<CommercialOrderStatus, readonly CommercialOrderStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

export class CommercialOrderError extends Error {
  readonly code: "NOT_FOUND" | "INVALID_TRANSITION" | "VERSION_CONFLICT" | "TERMINAL";
constructor(
    message: string,
    code: "NOT_FOUND" | "INVALID_TRANSITION" | "VERSION_CONFLICT" | "TERMINAL",
  ) {
    super(message);
    this.code = code;
  }
}

/** Deterministic fingerprint of terms (key-sorted canonical JSON, SHA-256). */
export function termsFingerprint(terms: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(terms), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
}

export async function createCommercialOrder(
  db: Block2Db,
  input: {
    ownerId: string;
    sellerRef: string;
    buyerRef: string;
    terms: Record<string, unknown>;
    transactionIntentId?: string | null;
    now?: Date;
  },
): Promise<CommercialOrderRecord> {
  const [order] = await db
    .insert(commercialOrders)
    .values({
      id: `ord_${randomUUID()}`,
      ownerId: input.ownerId,
      sellerRef: input.sellerRef,
      buyerRef: input.buyerRef,
      transactionIntentId: input.transactionIntentId ?? null,
      terms: input.terms,
      termsVersion: 1,
      termsFingerprint: termsFingerprint(input.terms),
      status: "DRAFT",
    })
    .returning();
  return order;
}

/**
 * Consequential terms mutation: new terms + bumped version + new fingerprint
 * under a CAS on the expected version. Callers paying an order MUST bind to
 * the fingerprint they approved.
 */
export async function updateCommercialTerms(
  db: Block2Db,
  input: { id: string; terms: Record<string, unknown>; expectedVersion: number; now?: Date },
): Promise<CommercialOrderRecord> {
  const updated = await db
    .update(commercialOrders)
    .set({
      terms: input.terms,
      termsFingerprint: termsFingerprint(input.terms),
      termsVersion: sql`${commercialOrders.termsVersion} + 1`,
      updatedAt: input.now ?? new Date(),
    })
    .where(and(eq(commercialOrders.id, input.id), eq(commercialOrders.termsVersion, input.expectedVersion)))
    .returning();
  if (!updated[0]) {
    const [existing] = await db.select().from(commercialOrders).where(eq(commercialOrders.id, input.id)).limit(1);
    if (!existing) throw new CommercialOrderError(`Order not found: ${input.id}`, "NOT_FOUND");
    throw new CommercialOrderError("Order terms changed concurrently — re-read and re-approve", "VERSION_CONFLICT");
  }
  return updated[0];
}

export async function transitionCommercialOrder(
  db: Block2Db,
  input: { id: string; to: CommercialOrderStatus; now?: Date },
): Promise<CommercialOrderRecord> {
  const [current] = await db.select().from(commercialOrders).where(eq(commercialOrders.id, input.id)).limit(1);
  if (!current) throw new CommercialOrderError(`Order not found: ${input.id}`, "NOT_FOUND");
  const from = current.status as CommercialOrderStatus;
  if (ORDER_TRANSITIONS[from]?.length === 0) {
    throw new CommercialOrderError(`Order is terminal (${from})`, "TERMINAL");
  }
  if (!ORDER_TRANSITIONS[from]?.includes(input.to)) {
    throw new CommercialOrderError(`Invalid order transition ${from} → ${input.to}`, "INVALID_TRANSITION");
  }
  const [updated] = await db
    .update(commercialOrders)
    .set({ status: input.to, updatedAt: input.now ?? new Date() })
    .where(eq(commercialOrders.id, input.id))
    .returning();
  return updated;
}

export async function getCommercialOrder(db: Block2Db, id: string) {
  const [order] = await db.select().from(commercialOrders).where(eq(commercialOrders.id, id)).limit(1);
  return order ?? null;
}
