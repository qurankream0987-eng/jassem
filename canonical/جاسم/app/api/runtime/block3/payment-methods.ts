/**
 * Block 3 §18–§20 — tokenized payment-method references.
 *
 * JASIM stores ONLY provider/vault token references. Raw PAN, CVV, or any
 * credential material is rejected at the boundary — including material
 * hidden inside metadata. Credentials never appear in prompts, logs,
 * outputs, tables, receipts, or artifacts; the reference is the only shape
 * money-touching code may carry.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { paymentMethodReferences, type PaymentMethodReferenceRecord } from "@db/schema";
import type { Block2Db } from "../block2/temporal";

export class PaymentMethodError extends Error {
  readonly code: "CREDENTIAL_MATERIAL" | "INVALID_TOKEN_REF" | "NOT_FOUND" | "INACTIVE";
constructor(
    message: string,
    code: "CREDENTIAL_MATERIAL" | "INVALID_TOKEN_REF" | "NOT_FOUND" | "INACTIVE",
  ) {
    super(message);
    this.code = code;
  }
}

const TOKEN_REF_FORMAT = /^[A-Za-z0-9_\-.:]{4,191}$/;
const FORBIDDEN_KEYS = /^(pan|cardnumber|card_number|cardnumberfull|cvv|cvc|cvn|securitycode|security_code|pin)$/i;
const DIGIT_RUN = /\b\d{13,19}\b/g;

/** Luhn check — a Luhn-valid digit run is credential material, not a token. */
export function isLuhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (doubleDigit) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

/** Deep-scan a value for credential material (PANs, CVV-shaped fields). */
export function containsCredentialMaterial(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    DIGIT_RUN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DIGIT_RUN.exec(value)) !== null) {
      if (isLuhnValid(match[0])) return true;
    }
    return false;
  }
  if (typeof value === "number" || typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.some(containsCredentialMaterial);
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.test(key)) return true;
      if (containsCredentialMaterial(entry)) return true;
    }
  }
  return false;
}

/** Register a tokenized payment-method reference. Credential material fails closed. */
export async function createPaymentMethodReference(
  db: Block2Db,
  input: {
    ownerId: string;
    provider: string;
    methodType: string;
    tokenRef: string;
    scope?: Record<string, unknown>;
    provenance: { source: string; reference?: string };
    expiresAt?: Date | null;
    now?: Date;
  },
): Promise<PaymentMethodReferenceRecord> {
  if (!TOKEN_REF_FORMAT.test(input.tokenRef)) {
    throw new PaymentMethodError("tokenRef must be an opaque provider token, not card data", "INVALID_TOKEN_REF");
  }
  if (containsCredentialMaterial(input.tokenRef) || containsCredentialMaterial(input.scope ?? {})) {
    throw new PaymentMethodError(
      "Credential material (PAN/CVV-shaped data) is forbidden — only token references may be stored",
      "CREDENTIAL_MATERIAL",
    );
  }
  const [method] = await db
    .insert(paymentMethodReferences)
    .values({
      id: `pmr_${randomUUID()}`,
      ownerId: input.ownerId,
      provider: input.provider,
      methodType: input.methodType,
      tokenRef: input.tokenRef,
      scope: input.scope ?? {},
      provenance: input.provenance,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  return method;
}

/** Resolve an ACTIVE reference owned by the caller (used before execution). */
export async function resolvePaymentMethodReference(
  db: Block2Db,
  input: { ownerId: string; id: string },
): Promise<PaymentMethodReferenceRecord> {
  const [method] = await db
    .select()
    .from(paymentMethodReferences)
    .where(and(eq(paymentMethodReferences.id, input.id), eq(paymentMethodReferences.ownerId, input.ownerId)))
    .limit(1);
  if (!method) throw new PaymentMethodError(`Payment method reference not found: ${input.id}`, "NOT_FOUND");
  if (method.status !== "ACTIVE") throw new PaymentMethodError("Payment method reference is not active", "INACTIVE");
  if (method.expiresAt && method.expiresAt.getTime() <= Date.now()) {
    throw new PaymentMethodError("Payment method reference is expired", "INACTIVE");
  }
  return method;
}

export async function deactivatePaymentMethodReference(db: Block2Db, input: { ownerId: string; id: string }) {
  const [updated] = await db
    .update(paymentMethodReferences)
    .set({ status: "REVOKED", updatedAt: new Date() })
    .where(and(eq(paymentMethodReferences.id, input.id), eq(paymentMethodReferences.ownerId, input.ownerId)))
    .returning();
  if (!updated) throw new PaymentMethodError(`Payment method reference not found: ${input.id}`, "NOT_FOUND");
  return updated;
}
