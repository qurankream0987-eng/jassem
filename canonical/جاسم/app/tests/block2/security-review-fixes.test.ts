/**
 * Regression tests for the six severe code-review findings (Block 2 hardening).
 * Each test names the finding it closes.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetBlock2 } from "./helpers/pg";
import { openAvailabilityWindow, reserveCapacity } from "../../api/runtime/block2/capacity";
import {
  createTemporalTrigger,
  fireDueTemporalTriggers,
  type ContinuationDispatcher,
} from "../../api/runtime/block2/temporal";
import { McpClient, assertTrustedRemoteEndpoint } from "../../api/runtime/block2/mcp-client";
import {
  createNotificationIntent,
  deliverNotificationIntent,
} from "../../api/runtime/block2/notifications";
import { createDelegationGrant } from "../../api/runtime/block2/delegation";
import { assertA2AConstraintBindings } from "../../api/runtime/jasim-runtime";

const START = new Date("2026-03-01T09:00:00.000Z");
const END = new Date("2026-03-01T17:00:00.000Z");

describe("Block 2 security-review fixes", () => {
  beforeEach(async () => {
    const { db } = await getTestDb();
    await resetBlock2(db);
  });

  it("finding 1: a windowId cannot be substituted to spend another resource's capacity", async () => {
    const { db } = await getTestDb();
    const window = await openAvailabilityWindow(db, {
      ownerId: "owner-x",
      resourceKind: "resource",
      resourceId: "res-B",
      startsAt: START,
      endsAt: END,
      capacity: 5,
      unit: "units",
    });
    await expect(
      reserveCapacity(db, {
        ownerId: "owner-x", // even the owner cannot alias resources
        resourceKind: "resource",
        resourceId: "res-A", // caller claims A…
        windowId: window.id, // …but the window belongs to B
        quantity: 1,
        unit: "units",
        idempotencyKey: "window-substitution",
      }),
    ).rejects.toThrow(/does not belong to the requested resource/i);
  });

  it("finding 2: a crash between dispatch and claim cannot double-fire a trigger", async () => {
    const { db } = await getTestDb();
    const seen = new Set<string>();
    const crashing: ContinuationDispatcher = {
      async dispatch(input) {
        seen.add(input.idempotencyKey);
        throw new Error("simulated crash after durable enqueue");
      },
    };
    const idempotent: ContinuationDispatcher = {
      async dispatch(input) {
        if (seen.has(input.idempotencyKey)) return "duplicate";
        seen.add(input.idempotencyKey);
        return "enqueued";
      },
    };
    await createTemporalTrigger(db, {
      ownerId: "owner",
      kind: "AT",
      fireAt: new Date(START.getTime() - 1000),
      continuation: { jobKind: "block2.resume-node", jobPayload: { x: 1 } },
      idempotencyKey: "crash-mid-fire",
    });
    // First sweep: dispatch commits, then the "process dies" before the claim.
    await expect(
      fireDueTemporalTriggers(db, crashing, undefined, { now: START }),
    ).rejects.toThrow("simulated crash");
    // Restart: the second sweep must reuse the SAME continuation key.
    const second = await fireDueTemporalTriggers(db, idempotent, undefined, { now: START });
    expect(second.fired).toBe(1);
    expect(seen.size).toBe(1); // exactly one continuation effect across the crash
  });

  it("finding 6: remote endpoints reject plain-HTTP and private-network targets", () => {
    expect(() => assertTrustedRemoteEndpoint("http://10.0.0.5/mcp")).toThrow(/HTTPS|private/i);
    expect(() => assertTrustedRemoteEndpoint("http://192.168.1.10")).toThrow(/HTTPS|private/i);
    expect(() => assertTrustedRemoteEndpoint("https://169.254.169.254/latest")).toThrow(/private/i);
    expect(() => assertTrustedRemoteEndpoint("https://mcp.provider.example")).not.toThrow();
    // Loopback HTTP stays available for the local controlled test fixture.
    expect(() => new McpClient({ baseUrl: "http://127.0.0.1:8123/mcp" })).not.toThrow();
  });

  it("finding 3: delivery rejects synthetic job: attempt contexts", async () => {
    const { db } = await getTestDb();
    const intent = await createNotificationIntent(db, {
      ownerId: "owner",
      recipientId: "recipient",
      purpose: "security check",
      content: { title: "t", body: "b" },
      idempotencyKey: "synthetic-attempt",
    });
    await expect(
      deliverNotificationIntent(db, {
        intentId: intent.id,
        attemptContext: { attemptId: "job:fabricated" },
        adapters: [],
      }),
    ).rejects.toThrow(/synthetic|attempt|lineage/i);
  });

  it("finding 5: sub-delegation cannot relax constraints or switch currency", async () => {
    const { db } = await getTestDb();
    const root = await createDelegationGrant(db, {
      principalOwnerId: "principal",
      delegateId: "middle",
      purpose: "operate",
      allowedCapabilities: ["read"],
      constraints: { region: "riyadh" },
      maxMonetary: 100,
      currency: "USD",
      maxDepth: 2,
      expiresAt: END,
      now: START,
    });
    await expect(
      createDelegationGrant(db, {
        principalOwnerId: "middle",
        delegateId: "leaf",
        purpose: "operate",
        allowedCapabilities: ["read"],
        constraints: {}, // drops the parent's region constraint
        maxMonetary: 50,
        currency: "USD",
        maxDepth: 1,
        parentGrantId: root.id,
        expiresAt: END,
        now: START,
      }),
    ).rejects.toThrow(/constraints/i);
    await expect(
      createDelegationGrant(db, {
        principalOwnerId: "middle",
        delegateId: "leaf",
        purpose: "operate",
        allowedCapabilities: ["read"],
        constraints: { region: "riyadh" },
        maxMonetary: 50,
        currency: "EUR", // currency switch under a USD parent
        maxDepth: 1,
        parentGrantId: root.id,
        expiresAt: END,
        now: START,
      }),
    ).rejects.toThrow(/currency/i);
  });

  it("A2A constrained grants reject missing runtime resource and monetary bindings", () => {
    expect(() =>
      assertA2AConstraintBindings(
        { resourceScope: { kinds: ["resource"] }, maxMonetary: null },
        {},
      ),
    ).toThrow("A2A grant is resource-constrained; resourceRef binding required");
    expect(() =>
      assertA2AConstraintBindings(
        { resourceScope: {}, maxMonetary: "100" },
        { monetaryAmount: Number.NaN },
      ),
    ).toThrow("A2A grant is monetary-constrained; monetaryAmount binding required");
  });
});
