import { beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import {
  eventSubscriptions,
  events,
  remoteExecutions,
  runtimeJobs,
} from "@db/schema";
import { ingestExternalEvent } from "../../api/runtime/block2/events";
import { createTemporalTrigger, type ContinuationDispatcher } from "../../api/runtime/block2/temporal";
import { getTestDb, resetBlock2 } from "./helpers/pg";

const runId = "00000000-0000-4000-8000-000000000001";
const nodeId = "00000000-0000-4000-8000-000000000002";

describe("Block 2 external events", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  function recordingDispatcher(calls: Array<{ jobKind: string; idempotencyKey: string }>): ContinuationDispatcher {
    return {
      async dispatch(input) {
        calls.push({ jobKind: input.jobKind, idempotencyKey: input.idempotencyKey });
        return "enqueued";
      },
    };
  }

  it("deduplicates provider event keys and creates exactly one canonical event", async () => {
    const { db } = await getTestDb();
    const calls: Array<{ jobKind: string; idempotencyKey: string }> = [];
    const dispatcher = recordingDispatcher(calls);
    const input = {
      provider: "provider", connectorId: "connector", eventKey: "same",
      eventType: "remote.updated", reference: "ref", payload: { state: "done" },
      ownerId: "owner",
    };
    expect((await ingestExternalEvent(db, dispatcher, input)).outcome).toBe("ACCEPTED");
    expect((await ingestExternalEvent(db, dispatcher, input)).outcome).toBe("DUPLICATE");
    const [row] = await db.select({ value: count() }).from(events);
    expect(row.value).toBe(1);
  });

  it("rejects stale versions before canonical emission or wake", async () => {
    const { db } = await getTestDb();
    await db.insert(remoteExecutions).values({
      id: "rex_one", ownerId: "owner", runId, nodeId, providerId: "provider",
      protocolKind: "A2A", remoteReference: "bound", state: "RUNNING",
      requestDigest: "a".repeat(64), idempotencyKey: "remote", version: 3,
    });
    const calls: Array<{ jobKind: string; idempotencyKey: string }> = [];
    const result = await ingestExternalEvent(db, recordingDispatcher(calls), {
      provider: "provider", connectorId: "connector", eventKey: "stale",
      eventType: "remote.updated", reference: "bound", payload: {},
      ownerId: "owner", observedVersion: 2,
    });
    expect(result.outcome).toBe("STALE");
    expect(calls).toHaveLength(0);
    expect((await db.select().from(events))).toHaveLength(0);
  });

  it("fires a matching EVENT temporal trigger", async () => {
    const { db } = await getTestDb();
    await createTemporalTrigger(db, {
      ownerId: "owner", kind: "EVENT", idempotencyKey: "event-trigger",
      eventFilter: { eventType: "remote.done", match: { state: "done" } },
      continuation: { jobKind: "resume" }, maxFires: 1,
    });
    const calls: Array<{ jobKind: string; idempotencyKey: string }> = [];
    await ingestExternalEvent(db, recordingDispatcher(calls), {
      provider: "provider", connectorId: "connector", eventKey: "wake",
      eventType: "remote.done", reference: "ref", payload: { state: "done" },
      ownerId: "owner",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].jobKind).toBe("resume");
  });

  it("enqueues a durable resume-node job for a subscription", async () => {
    const { db } = await getTestDb();
    await db.insert(eventSubscriptions).values({
      eventType: "remote.done", handler: "resume-node", active: true,
      ownerId: "owner", runId, nodeId, state: "active",
    });
    const dispatcher: ContinuationDispatcher = {
      async dispatch(input) {
        const inserted = await db.insert(runtimeJobs).values({
          id: `job_${input.idempotencyKey.replaceAll(":", "_")}`,
          kind: input.jobKind, subjectType: "run", subjectId: input.runId ?? input.ownerId,
          payloadSchemaVersion: 1, payload: input.payload, idempotencyKey: input.idempotencyKey,
          status: "queued", availableAt: new Date(), createdBy: input.ownerId,
        }).onConflictDoNothing().returning();
        return inserted[0] ? "enqueued" : "duplicate";
      },
    };
    await ingestExternalEvent(db, dispatcher, {
      provider: "provider", connectorId: "connector", eventKey: "subscription",
      eventType: "remote.done", reference: "ref", payload: {}, ownerId: "owner", runId,
    });
    const rows = await db.select().from(runtimeJobs).where(eq(runtimeJobs.kind, "block2.resume-node"));
    expect(rows).toHaveLength(1);
    expect(rows[0].subjectId).toBe(runId);
  });
});