import { beforeEach, describe, expect, it } from "vitest";
import {
  createNotificationIntent,
  deliverNotificationIntent,
  markNotificationRead,
  type ChannelAdapter,
} from "../../api/runtime/block2/notifications";
import { getTestDb, resetBlock2 } from "./helpers/pg";

const base = {
  ownerId: "owner",
  recipientId: "recipient",
  purpose: "update",
  content: { title: "Title", body: "Body" },
};

function adapter(channel: string, outcome: "PROVIDER_ACCEPTED" | "SENT" | "DELIVERED" | "FAILED" | "INCONCLUSIVE"): ChannelAdapter {
  return {
    channel,
    configured: true,
    async send() {
      return { outcome, ...(outcome === "INCONCLUSIVE" ? { error: "Adapter timed out" } : {}) };
    },
  };
}

describe("Block 2 notifications", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  it("creates intents idempotently and confines sensitive content to in_app", async () => {
    const { db } = await getTestDb();
    const first = await createNotificationIntent(db, { ...base, idempotencyKey: "same", privacyClass: "sensitive", channels: ["email"] });
    const replay = await createNotificationIntent(db, { ...base, idempotencyKey: "same", privacyClass: "sensitive" });
    expect(replay.id).toBe(first.id);
    expect(first.channels).toEqual(["in_app"]);
  });

  it("adds push to critical only when configured", async () => {
    const { db } = await getTestDb();
    const old = {
      project: process.env.FIREBASE_PROJECT_ID,
      email: process.env.FIREBASE_CLIENT_EMAIL,
      key: process.env.FIREBASE_PRIVATE_KEY,
      token: process.env.FIREBASE_ACCESS_TOKEN,
    };
    Object.assign(process.env, {
      FIREBASE_PROJECT_ID: "project", FIREBASE_CLIENT_EMAIL: "test@example.com",
      FIREBASE_PRIVATE_KEY: "key", FIREBASE_ACCESS_TOKEN: "token",
    });
    try {
      const critical = await createNotificationIntent(db, { ...base, urgency: "critical", idempotencyKey: "critical" });
      expect(critical.channels).toEqual(["in_app", "push"]);
    } finally {
      for (const [key, value] of Object.entries({
        FIREBASE_PROJECT_ID: old.project, FIREBASE_CLIENT_EMAIL: old.email,
        FIREBASE_PRIVATE_KEY: old.key, FIREBASE_ACCESS_TOKEN: old.token,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it.each([
    ["DELIVERED", "DELIVERED"],
    ["SENT", "SENT"],
    ["PROVIDER_ACCEPTED", "SENT"],
    ["INCONCLUSIVE", "INCONCLUSIVE"],
  ] as const)("truthfully aggregates adapter %s as %s", async (outcome, expected) => {
    const { db } = await getTestDb();
    const intent = await createNotificationIntent(db, { ...base, idempotencyKey: `delivery-${outcome}` });
    const delivered = await deliverNotificationIntent(db, {
      intentId: intent.id, attemptContext: { attemptId: "attempt" },
      adapters: [adapter("in_app", outcome)],
    });
    expect(delivered.state).toBe(expected);
    // SENT != DELIVERED: the aggregate never promotes without evidence.
    if (expected === "SENT") expect(delivered.state).not.toBe("DELIVERED");
    if (expected === "DELIVERED") expect(delivered.state).not.toBe("SENT");
    expect(delivered.state).not.toBe("READ");
    if (outcome === "INCONCLUSIVE") {
      expect(delivered.channelStates.in_app.error).toMatch(/timed out/);
    }
  });

  it("becomes BLOCKED_BY_PROVIDER when every selected route lacks an adapter", async () => {
    const { db } = await getTestDb();
    const intent = await createNotificationIntent(db, { ...base, idempotencyKey: "blocked" });
    const delivered = await deliverNotificationIntent(db, {
      intentId: intent.id, attemptContext: { attemptId: "attempt" }, adapters: [],
    });
    expect(delivered.state).toBe("BLOCKED_BY_PROVIDER");
  });

  it("allows only the recipient to mark a sent notification read", async () => {
    const { db } = await getTestDb();
    const intent = await createNotificationIntent(db, { ...base, idempotencyKey: "read" });
    const sent = await deliverNotificationIntent(db, {
      intentId: intent.id, attemptContext: { attemptId: "attempt" },
      adapters: [adapter("in_app", "SENT")],
    });
    await expect(markNotificationRead(db, { intentId: sent.id, recipientId: "owner" })).rejects.toThrow();
    expect((await markNotificationRead(db, { intentId: sent.id, recipientId: "recipient" })).state).toBe("READ");
  });
});