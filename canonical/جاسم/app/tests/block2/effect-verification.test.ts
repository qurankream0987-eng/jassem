import { beforeEach, describe, expect, it } from "vitest";
import {
  createNotificationIntent,
  deliverNotificationIntent,
  getConfiguredChannelAdapters,
  resolveNotificationEffect,
  type ChannelAdapter,
} from "../../api/runtime/block2/notifications";
import {
  completionPolicyFor,
  decideCompletion,
  gatherEffectAssertions,
} from "../../api/runtime/completion-policy";
import { capabilityEffectContract } from "../../api/runtime/capability-registry";
import { getTestDb, resetBlock2 } from "./helpers/pg";

/**
 * EFFECT VERIFICATION AGAINST A REAL LEDGER.
 *
 * `completion-policy.test.ts` proves the decision function. This proves the
 * part that can only be proven against a database: that a real notification,
 * delivered through the real adapters, is read back and graded honestly.
 *
 * The case that matters most is the one the runtime used to get wrong — a
 * notification no channel could deliver, which came out VERIFIED.
 */

const base = {
  ownerId: "owner",
  recipientId: "recipient",
  purpose: "update",
  content: { title: "Title", body: "Body" },
};

function adapter(
  channel: string,
  outcome: "PROVIDER_ACCEPTED" | "SENT" | "DELIVERED" | "FAILED" | "INCONCLUSIVE",
): ChannelAdapter {
  return { channel, configured: true, async send() { return { outcome }; } };
}

const attemptContext = { runId: "run-1", nodeId: "node-1", attemptId: "attempt-1" };

describe("a notification's effect is read back, not taken on trust", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  it("only JASIM's own in-app channel can ever report DELIVERED", () => {
    // The claim the INTERNAL_READBACK mapping rests on. `inAppAdapter` returns
    // DELIVERED only when `isOnline(recipient)` was true — JASIM's own socket,
    // JASIM's own observation. If an external adapter ever starts claiming
    // delivery, this fails and the mapping must be revisited rather than
    // silently inheriting an authority it no longer has.
    const adapters = getConfiguredChannelAdapters();
    expect(adapters.map((entry) => entry.channel)).toContain("in_app");
    const source = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../api/runtime/block2/notifications.ts"),
      "utf8",
    ) as string;
    const externalAdapters = source.slice(
      source.indexOf("function pushAdapter"),
      source.indexOf("function inAppAdapter"),
    );
    expect(externalAdapters.length).toBeGreaterThan(500);
    expect(externalAdapters).not.toContain('outcome: "DELIVERED"');
    expect(externalAdapters).not.toContain("outcome: 'DELIVERED'");
  });

  it("a delivered notification verifies, by internal readback", async () => {
    const { db } = await getTestDb();
    const intent = await createNotificationIntent(db, { ...base, idempotencyKey: "delivered" });
    await deliverNotificationIntent(db, {
      intentId: intent.id,
      attemptContext,
      adapters: [adapter("in_app", "DELIVERED")],
    });

    const assertion = await resolveNotificationEffect(db, { ownerId: base.ownerId, intentId: intent.id });
    expect(assertion).toMatchObject({ state: "OCCURRED", source: "INTERNAL_READBACK" });
    expect(
      decideCompletion({
        policy: completionPolicyFor("MESSAGE_DISPATCH"),
        outputShapeValid: true,
        assertions: [assertion!],
      }).decision,
    ).toBe("VERIFIED");
  });

  /**
   * The four states the runtime used to call VERIFIED, each now getting the
   * verdict its own ledger entry deserves.
   */
  const LEDGER_TRUTH: ReadonlyArray<
    [string, "PROVIDER_ACCEPTED" | "SENT" | "FAILED" | "INCONCLUSIVE", string]
  > = [
    ["a provider merely accepted it", "PROVIDER_ACCEPTED", "PENDING"],
    ["it was sent but not seen to arrive", "SENT", "PENDING"],
    ["no channel delivered it", "FAILED", "FAILED"],
    ["the channel could not say", "INCONCLUSIVE", "INCONCLUSIVE"],
  ];

  it.each(LEDGER_TRUTH)("%s → %s → %s", async (_label, outcome, expected) => {
    const { db } = await getTestDb();
    const intent = await createNotificationIntent(db, { ...base, idempotencyKey: `k-${outcome}` });
    await deliverNotificationIntent(db, {
      intentId: intent.id,
      attemptContext,
      adapters: [adapter("in_app", outcome)],
    });

    const assertion = await resolveNotificationEffect(db, { ownerId: base.ownerId, intentId: intent.id });
    expect(assertion).toBeDefined();
    const decision = decideCompletion({
      policy: completionPolicyFor("MESSAGE_DISPATCH"),
      outputShapeValid: true,
      assertions: [assertion!],
    }).decision;
    expect(decision).toBe(expected);
    expect(decision).not.toBe("VERIFIED");
  });

  it("a notification blocked because nothing is configured did not occur", async () => {
    const { db } = await getTestDb();
    const intent = await createNotificationIntent(db, { ...base, idempotencyKey: "blocked" });
    await deliverNotificationIntent(db, {
      intentId: intent.id,
      attemptContext,
      adapters: [{ channel: "in_app", configured: false, async send() { return { outcome: "FAILED" as const }; } }],
    });

    const assertion = await resolveNotificationEffect(db, { ownerId: base.ownerId, intentId: intent.id });
    expect(assertion!.state).toBe("NOT_OCCURRED");
    expect(
      decideCompletion({
        policy: completionPolicyFor("MESSAGE_DISPATCH"),
        outputShapeValid: true,
        assertions: [assertion!],
      }).decision,
    ).toBe("FAILED");
  });

  it("the readback is owner-scoped: another owner learns nothing and gets no verdict", async () => {
    const { db } = await getTestDb();
    const intent = await createNotificationIntent(db, { ...base, idempotencyKey: "scoped" });
    await deliverNotificationIntent(db, {
      intentId: intent.id,
      attemptContext,
      adapters: [adapter("in_app", "DELIVERED")],
    });

    const foreign = await resolveNotificationEffect(db, { ownerId: "someone-else", intentId: intent.id });
    // Not found is UNCERTAIN, never OCCURRED — a readback that cannot see the
    // row has learnt that it does not know.
    expect(foreign).toMatchObject({ state: "UNCERTAIN" });
    expect(
      decideCompletion({
        policy: completionPolicyFor("MESSAGE_DISPATCH"),
        outputShapeValid: true,
        assertions: [foreign!],
      }).decision,
    ).toBe("INCONCLUSIVE");
  });

  it("an intent that cannot be read back at all is uncertain, not absent", async () => {
    const { db } = await getTestDb();
    const missing = await resolveNotificationEffect(db, {
      ownerId: base.ownerId,
      intentId: "00000000-0000-0000-0000-000000000000",
    });
    expect(missing).toMatchObject({ state: "UNCERTAIN" });
  });
});

describe("the registered notify capability carries a real effect contract", () => {
  it("declares a message dispatch and supplies a readback", () => {
    const contract = capabilityEffectContract("notify");
    expect(contract.effectKind).toBe("MESSAGE_DISPATCH");
    expect(contract.resolveEffect).toBeTypeOf("function");
    // Its own returned snapshot is worth no more than the executor's word,
    // because it is taken before any redelivery runs.
    expect(contract.effectEvidenceSource).toBe("EXECUTOR_RETURN");
  });

  it("every read-only capability still resolves to NONE and behaves as before", () => {
    for (const id of ["local-analysis", "local-calculation", "openai-chat", "web-research", "image-generation", "research-context"]) {
      expect(capabilityEffectContract(id).effectKind, id).toBe("NONE");
    }
  });

  it("an unknown capability id fails closed to the strictest class", () => {
    const contract = capabilityEffectContract("something-nobody-registered");
    expect(contract.effectKind).toBe("REMOTE_MUTATION");
    expect(contract.resolveEffect).toBeUndefined();
    // Which means it cannot reach VERIFIED on the executor's word.
    expect(
      decideCompletion({
        policy: completionPolicyFor(contract.effectKind),
        outputShapeValid: true,
        assertions: [{ state: "OCCURRED", source: "EXECUTOR_RETURN" }],
      }).decision,
    ).toBe("PENDING");
  });

  it("the resolver follows the ledger, not the payload it is handed", async () => {
    const { db } = await getTestDb();
    await resetBlock2(db);
    const intent = await createNotificationIntent(db, { ...base, idempotencyKey: "resolver" });
    await deliverNotificationIntent(db, {
      intentId: intent.id,
      attemptContext,
      adapters: [adapter("in_app", "FAILED")],
    });

    // The capability's returned payload claims the notification is QUEUED —
    // which is what its pre-delivery snapshot genuinely said. The ledger says
    // it failed. The composed contract must follow the ledger.
    //
    // `resolveNotificationEffect` is given this test's database explicitly,
    // because the registered resolver closes over the runtime connection. The
    // structural test below pins that the registration composes these same two
    // pieces, so what is proven here is the composition, not a lookalike.
    const gathered = await gatherEffectAssertions(
      {
        effectKind: "MESSAGE_DISPATCH",
        effectEvidenceSource: "EXECUTOR_RETURN",
        resolveEffect: async (context) =>
          resolveNotificationEffect(db, {
            ownerId: context.ownerId,
            intentId: String(context.result?.intentId ?? ""),
          }),
      },
      {
        ownerId: base.ownerId,
        capabilityId: "notify",
        attemptId: "attempt-1",
        runId: "run-1",
        nodeId: "node-1",
        result: { kind: "notification-intent", intentId: intent.id, state: "QUEUED" },
      },
    );
    // Two assertions: the payload's own word (weighted EXECUTOR_RETURN, and
    // PENDING because QUEUED is not an outcome) and the ledger's readback.
    expect(gathered.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "NOT_OCCURRED", source: "INTERNAL_READBACK" }),
      ]),
    );
    expect(
      decideCompletion({
        policy: completionPolicyFor("MESSAGE_DISPATCH"),
        outputShapeValid: true,
        assertions: gathered.assertions,
      }).decision,
    ).toBe("FAILED");
  });

  it("the registration composes exactly those two pieces", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../api/runtime/capability-registry.ts"),
      "utf8",
    ) as string;
    const notifyBlock = source.slice(
      source.indexOf("const notifyCapability"),
      source.indexOf("inputContract", source.indexOf("const notifyCapability")),
    );
    expect(notifyBlock).toContain('effectKind: "MESSAGE_DISPATCH"');
    expect(notifyBlock).toContain("resolveNotificationEffect(db, {");
    expect(notifyBlock).toContain("ownerId: context.ownerId");
  });
});
