/**
 * Block 3 §10–§13 / §95 — authenticated webhook ingestion.
 * Unauthenticated, stale, replayed, or mismatched financial callbacks must
 * fail closed with zero canonical effects.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { externalWebhookEvents, events } from "@db/schema";
import { eq } from "drizzle-orm";
import {
  ingestAuthenticatedExternalEvent,
  verifyRawBodyHmacSha256,
} from "../../api/runtime/block3/webhook-auth";
import type { ContinuationDispatcher } from "../../api/runtime/block2/temporal";
import { getTestDb, resetBlock3 } from "./helpers/pg";
import {
  clearFixtureWebhookVerification,
  installFixtureWebhookVerification,
} from "./helpers/webhook-verification-fixture";

const SECRET = "whsec_controlled_test";
const PROVIDER = "psp-controlled";

function recordingDispatcher(calls: Array<{ jobKind: string }>): ContinuationDispatcher {
  return {
    async dispatch(input) {
      calls.push({ jobKind: input.jobKind });
      return "enqueued";
    },
  };
}

function sign(rawBody: string, secret: string = SECRET): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

//
// ── AN INHERITED EXPECTATION THAT CHANGED ────────────────────────────────────
//
// OLD_EXPECTATION: a provider "has" a webhook secret when a row exists in
//   `capability_provider_catalog` with `ioMetadata.webhookSecret` set.
// WHY_IT_IS_WRONG: that table persists DISCOVERED candidates at trust class
//   UNTRUSTED_CANDIDATE, and `ioMetadata` is ordinary jsonb — so the secret was
//   plaintext in a discovery row, and one string would have authenticated
//   callbacks naming EVERY scope's payments. Nothing in production ever wrote
//   it, so the mounted webhook route could authenticate nothing at all.
// NEW_EXPECTATION: material is resolved server-side from the provider BINDING
//   whose account the callback is about. This suite states it through the
//   trusted resolver seam, because its subject is the boundary and not the
//   provisioning; the production path is proved end to end, with nothing
//   injected, in `tests/block31/provider-webhook-secret.test.ts`.
// WHY_THE_NEW_EXPECTATION_IS_STRICTER: a secret now belongs to one account
//   rather than to a provider's name, and the catalog read that could never have
//   worked in production is gone rather than documented.
//
async function seedProvider(secrets: Readonly<Record<string, string>> = { [PROVIDER]: SECRET }) {
  installFixtureWebhookVerification(secrets);
}

function callbackInput(rawBody: string, patch: Record<string, unknown> = {}) {
  return {
    provider: PROVIDER,
    connectorId: "conn-1",
    eventKey: "evt-1",
    eventType: "resource.updated",
    reference: "pay_ref_1",
    rawBody,
    ownerId: "owner-1",
    ...patch,
  };
}

describe("authenticated webhook ingestion (§95 matrix)", () => {
  beforeEach(async () => {
    clearFixtureWebhookVerification();
    await resetBlock3((await getTestDb()).db);
  });

  it("rejects a missing signature", async () => {
    await seedProvider();
    const { db } = await getTestDb();
    const body = JSON.stringify({ status: "captured" });
    const result = await ingestAuthenticatedExternalEvent(db, recordingDispatcher([]), callbackInput(body));
    expect(result.outcome).toBe("REJECTED");
  });

  it("rejects an invalid signature and a tampered body", async () => {
    await seedProvider();
    const { db } = await getTestDb();
    const body = JSON.stringify({ status: "captured" });
    expect(
      (await ingestAuthenticatedExternalEvent(db, recordingDispatcher([]), callbackInput(body, { signature: sign(body, "wrong-secret") }))).outcome,
    ).toBe("REJECTED");
    // Sign one body, deliver another (parse→reserialize attacks fail too).
    const original = JSON.stringify({ status: "captured", amount: "100" });
    const tampered = JSON.stringify({ status: "captured", amount: "999" });
    expect(
      (await ingestAuthenticatedExternalEvent(db, recordingDispatcher([]), callbackInput(tampered, { signature: sign(original) }))).outcome,
    ).toBe("REJECTED");
  });

  it("rejects unknown providers and providers with no verification material", async () => {
    const { db } = await getTestDb();
    const body = JSON.stringify({ status: "captured" });
    // One provider is provisioned. A callback posted to a DIFFERENT provider's
    // name resolves nothing, so holding this secret buys nothing there.
    //
    //   CROSS_PROVIDER_SECRET_AUTHENTICATES = 0
    await seedProvider();
    expect(
      (await ingestAuthenticatedExternalEvent(db, recordingDispatcher([]), callbackInput(body, { provider: "psp-unknown", signature: sign(body) }))).outcome,
    ).toBe("REJECTED");
    await seedProvider({}); // nothing provisioned at all
    expect(
      (await ingestAuthenticatedExternalEvent(db, recordingDispatcher([]), callbackInput(body, { signature: sign(body) }))).outcome,
    ).toBe("REJECTED");
  });

  it("rejects stale timestamps", async () => {
    await seedProvider();
    const { db } = await getTestDb();
    const now = new Date("2026-01-01T00:00:00Z");
    const body = JSON.stringify({ status: "captured" });
    const result = await ingestAuthenticatedExternalEvent(db, recordingDispatcher([]), callbackInput(body, {
      signature: sign(body),
      timestamp: now.getTime() - 10 * 60 * 1000,
      now,
    }));
    expect(result.outcome).toBe("REJECTED");
    expect(result).toMatchObject({ reason: expect.stringMatching(/stale/i) });
  });

  it("accepts a valid authenticated callback exactly once (replay has zero effects)", async () => {
    await seedProvider();
    const { db } = await getTestDb();
    const now = new Date("2026-01-01T00:00:00Z");
    const body = JSON.stringify({ status: "captured", amount: "100.000", currency: "KWD" });
    const input = callbackInput(body, { signature: sign(body), timestamp: now.getTime(), now });
    const first = await ingestAuthenticatedExternalEvent(db, recordingDispatcher([]), input);
    expect(first.outcome).toBe("ACCEPTED");
    const second = await ingestAuthenticatedExternalEvent(db, recordingDispatcher([]), input);
    expect(second.outcome).toBe("DUPLICATE");

    const intakeRows = await db.select().from(externalWebhookEvents).where(eq(externalWebhookEvents.provider, PROVIDER));
    expect(intakeRows).toHaveLength(1);
    const eventRows = await db.select().from(events).where(eq(events.type, "resource.updated"));
    expect(eventRows).toHaveLength(1);
  });

  it("verifyRawBodyHmacSha256 is strict about format and constant-time", () => {
    const body = '{"a":1}';
    const good = sign(body);
    expect(verifyRawBodyHmacSha256(body, good, SECRET)).toBe(true);
    expect(verifyRawBodyHmacSha256(body, `sha256=${good}`, SECRET)).toBe(true);
    expect(verifyRawBodyHmacSha256(body, good.toUpperCase(), SECRET)).toBe(true);
    expect(verifyRawBodyHmacSha256(body, undefined, SECRET)).toBe(false);
    expect(verifyRawBodyHmacSha256(body, "not-hex", SECRET)).toBe(false);
    expect(verifyRawBodyHmacSha256(`${body} `, good, SECRET)).toBe(false); // whitespace changes bytes
  });
});
