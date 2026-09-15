import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  economicExpressions,
  notificationIntents,
  temporalTriggers,
} from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let discover: typeof import("../../api/runtime/block31/discovery").discover;
let createTemporalTrigger: typeof import("../../api/runtime/block2/temporal").createTemporalTrigger;
let fireDueTemporalTriggers: typeof import("../../api/runtime/block2/temporal").fireDueTemporalTriggers;
let createNotificationIntent: typeof import("../../api/runtime/block2/notifications").createNotificationIntent;

const OWNER = "monitor-owner";
const SOURCE_OWNER = "monitor-source";
const NOW = new Date("2025-02-01T00:00:00.000Z");

beforeAll(async () => {
  handle = await getTestDb();
  ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
  ({ discover } = await import("../../api/runtime/block31/discovery"));
  ({ createTemporalTrigger, fireDueTemporalTriggers } = await import("../../api/runtime/block2/temporal"));
  ({ createNotificationIntent } = await import("../../api/runtime/block2/notifications"));
});

beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE notification_intents, temporal_triggers, discovery_candidates,
      discovery_result_sets, economic_expressions CASCADE
  `));
});

describe("search to durable monitoring", () => {
  it("persists a candidate-bound condition watch and composes a truthful notification when met", async () => {
    const expression = await createExpression({
      ownerId: SOURCE_OWNER,
      kind: "offering",
      semanticType: "resource.capability",
      attributes: { priceMinor: "4200", currency: "SAR" },
    });
    await publishExpression({
      id: expression.id,
      ownerId: SOURCE_OWNER,
      projection: {
        semanticType: "resource.capability",
        summary: "resource.capability",
        publicTerms: { money: { amountMinor: "4200", currency: "SAR" } },
      },
    });
    const found = await discover(handle.db, {
      ownerId: OWNER,
      conversationId: `conversation-${randomUUID()}`,
      query: "resource.capability",
      availability: { internal: true, web: false },
    });
    const candidate = found.candidates[0]!;
    const watch = await createTemporalTrigger(handle.db, {
      ownerId: OWNER,
      kind: "CONDITION",
      conditionPollMs: 0,
      now: NOW,
      idempotencyKey: `candidate-watch:${candidate.id}`,
      condition: {
        candidateId: candidate.id,
        expressionId: candidate.canonicalRef,
        maximumMinor: "5000",
        currency: "SAR",
      },
      continuation: {
        jobKind: "compose-watch-notification",
        jobPayload: { candidateId: candidate.id, expressionId: candidate.canonicalRef },
      },
    });

    const [persisted] = await handle.db.select().from(temporalTriggers)
      .where(eq(temporalTriggers.id, watch.trigger.id));
    expect(persisted.condition).toMatchObject({ candidateId: candidate.id, expressionId: expression.id });

    const scan = await fireDueTemporalTriggers(handle.db, {
      async dispatch(input) {
        const [current] = await handle.db.select().from(economicExpressions)
          .where(eq(economicExpressions.id, String(input.payload.expressionId)));
        const projection = current.publicProjection as Record<string, unknown>;
        const terms = projection.publicTerms as { money: { amountMinor: string; currency: string } };
        await createNotificationIntent(handle.db, {
          ownerId: input.ownerId,
          recipientId: input.ownerId,
          purpose: "candidate-watch-condition-met",
          content: {
            title: "Watch condition met",
            body: `${projection.summary}: ${terms.money.amountMinor} ${terms.money.currency}`,
            data: {
              candidateId: input.payload.candidateId,
              expressionId: current.id,
              expressionVersion: current.version,
            },
          },
          idempotencyKey: input.idempotencyKey,
        });
        return "enqueued";
      },
    }, {
      async evaluate(condition, context) {
        const [current] = await handle.db.select().from(economicExpressions)
          .where(eq(economicExpressions.id, String(condition.expressionId)));
        if (!current || context.ownerId !== OWNER) return undefined;
        const price = BigInt(String(current.attributes.priceMinor));
        return current.attributes.currency === condition.currency &&
          price <= BigInt(String(condition.maximumMinor));
      },
    }, { now: NOW });

    expect(scan.fired).toBe(1);
    const [notification] = await handle.db.select().from(notificationIntents);
    expect(notification.content.body).toBe("resource.capability: 4200 SAR");
    expect(notification.content.data).toMatchObject({
      candidateId: candidate.id,
      expressionId: expression.id,
    });
  });
});