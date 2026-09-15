/**
 * Block 3 §15–§16 (versioned commercial terms) and §18–§20 (tokenized
 * payment methods; credential material forbidden everywhere).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  CommercialOrderError,
  createCommercialOrder,
  termsFingerprint,
  transitionCommercialOrder,
  updateCommercialTerms,
} from "../../api/runtime/block3/commercial-orders";
import {
  containsCredentialMaterial,
  createPaymentMethodReference,
  isLuhnValid,
  PaymentMethodError,
  resolvePaymentMethodReference,
} from "../../api/runtime/block3/payment-methods";
import { getTestDb, resetBlock3 } from "./helpers/pg";

describe("commercial orders — versioned, fingerprinted terms", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  const termsV1 = {
    items: [{ ref: "laptop-2", quantity: 1, unitPrice: { minor: "249500", currency: "KWD" } }],
    total: { minor: "249500", currency: "KWD" },
    fulfillment: { kind: "delivery" },
  };

  it("fingerprints terms deterministically regardless of key order", () => {
    const a = termsFingerprint({ x: 1, y: [2, { b: true, a: null }] });
    const b = termsFingerprint({ y: [2, { a: null, b: true }], x: 1 });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("consequential mutation bumps version + fingerprint under CAS", async () => {
    const { db } = await getTestDb();
    const order = await createCommercialOrder(db, {
      ownerId: "owner-1", sellerRef: "seller-1", buyerRef: "buyer-1", terms: termsV1,
    });
    const fp1 = order.termsFingerprint;
    const termsV2 = { ...termsV1, total: { minor: "239500", currency: "KWD" } };
    const updated = await updateCommercialTerms(db, { id: order.id, terms: termsV2, expectedVersion: 1 });
    expect(updated.termsVersion).toBe(2);
    expect(updated.termsFingerprint).not.toBe(fp1);
    // A payment bound to the OLD fingerprint detects the change.
    await expect(updateCommercialTerms(db, { id: order.id, terms: termsV2, expectedVersion: 1 }))
      .rejects.toThrow(CommercialOrderError);
  });

  it("enforces the order lifecycle (DRAFT → CONFIRMED → FULFILLED)", async () => {
    const { db } = await getTestDb();
    const order = await createCommercialOrder(db, {
      ownerId: "owner-1", sellerRef: "s", buyerRef: "b", terms: termsV1,
    });
    await expect(transitionCommercialOrder(db, { id: order.id, to: "FULFILLED" })).rejects.toThrow(/Invalid/);
    await transitionCommercialOrder(db, { id: order.id, to: "CONFIRMED" });
    const done = await transitionCommercialOrder(db, { id: order.id, to: "FULFILLED" });
    expect(done.status).toBe("FULFILLED");
    await expect(transitionCommercialOrder(db, { id: order.id, to: "DRAFT" })).rejects.toThrow(/terminal/i);
  });
});

describe("payment method references — credential hygiene (§98)", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("accepts an opaque provider token", async () => {
    const { db } = await getTestDb();
    const method = await createPaymentMethodReference(db, {
      ownerId: "owner-1", provider: "psp-controlled", methodType: "card",
      tokenRef: "tok_ctrl_abc123", provenance: { source: "boot" },
    });
    expect(method.status).toBe("ACTIVE");
    const resolved = await resolvePaymentMethodReference(db, { ownerId: "owner-1", id: method.id });
    expect(resolved.tokenRef).toBe("tok_ctrl_abc123");
  });

  it("rejects a raw PAN as tokenRef (Luhn-valid digit run)", async () => {
    const { db } = await getTestDb();
    await expect(createPaymentMethodReference(db, {
      ownerId: "o", provider: "p", methodType: "card",
      tokenRef: "4111111111111111", provenance: { source: "boot" },
    })).rejects.toThrow(PaymentMethodError);
  });

  it("rejects credential material hidden in metadata", async () => {
    const { db } = await getTestDb();
    await expect(createPaymentMethodReference(db, {
      ownerId: "o", provider: "p", methodType: "card",
      tokenRef: "tok_ok_123", scope: { card: { cvv: "123" } }, provenance: { source: "boot" },
    })).rejects.toThrow(/credential/i);
    await expect(createPaymentMethodReference(db, {
      ownerId: "o", provider: "p", methodType: "card",
      tokenRef: "tok_ok_124", scope: { note: "card 4242424242424242 expires soon" }, provenance: { source: "boot" },
    })).rejects.toThrow(PaymentMethodError);
  });

  it("deep-scan detects Luhn PANs but not benign numbers", () => {
    expect(isLuhnValid("4111111111111111")).toBe(true);
    expect(isLuhnValid("1234567890123")).toBe(false);
    expect(containsCredentialMaterial({ ref: "order 1234567890123" })).toBe(false);
    expect(containsCredentialMaterial({ nested: [{ pan: "4111" }] })).toBe(true);
    expect(containsCredentialMaterial({ cvc: 999 })).toBe(true);
  });

  it("isolates references per owner", async () => {
    const { db } = await getTestDb();
    const method = await createPaymentMethodReference(db, {
      ownerId: "owner-1", provider: "p", methodType: "card",
      tokenRef: "tok_owned_1", provenance: { source: "boot" },
    });
    await expect(resolvePaymentMethodReference(db, { ownerId: "owner-2", id: method.id }))
      .rejects.toThrow(/not found/i);
  });
});
