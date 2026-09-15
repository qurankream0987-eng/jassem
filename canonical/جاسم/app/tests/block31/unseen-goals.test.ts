/**
 * Directive AC unseen-goal proof.
 *
 * The cases were composed with a fixed seed across resource, business-model,
 * source, monitoring, party-count, world, mutation, delegation, work-purpose,
 * and discovery-scope axes. Domain vocabulary intentionally lives only here.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  commercialOrders,
  economicExpressions,
  paymentIntents,
  referenceBindings,
} from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let discover: typeof import("../../api/runtime/block31").discover;
let bindReference: typeof import("../../api/runtime/block31").bindReference;
let resolveOrdinal: typeof import("../../api/runtime/block31").resolveOrdinal;
let resolveThis: typeof import("../../api/runtime/block31").resolveThis;
let recordObservation: typeof import("../../api/runtime/block31").recordObservation;
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;
let createDelegationGrant: typeof import("../../api/runtime/block2/delegation").createDelegationGrant;
let listDelegationGrants: typeof import("../../api/runtime/block2/delegation").listDelegationGrants;
let createNotificationIntent: typeof import("../../api/runtime/block2/notifications").createNotificationIntent;
let createWorldPlan: typeof import("../../api/runtime/block3/generated-business-economics").createWorldPlan;

const SELLER = "unseen-seller";
const BUYER = "unseen-buyer";
const OUTSIDER = "unseen-outsider";
const DELEGATE = "unseen-delegate";
const WORLD = "unseen-world";
const worlds = {
  get: async (ownerId: number, worldId: string) =>
    ownerId === 42 && worldId === WORLD ? { ownerId, id: worldId, worldKey: WORLD } : undefined,
  conversationWorld: async () => undefined,
} as never;

type Goal = {
  name: string;
  resource: string;
  model: string;
  sources: "internal" | "mixed";
  monitor: boolean;
  parties: 2 | 3;
  world: boolean;
  delegate: boolean;
  nonCommercial: boolean;
};

const envelope = (capability: string, inputs: Record<string, unknown> = {}) => ({
  decisionId: randomUUID(),
  kind: "message",
  intent: { requiredCapabilities: [capability], missingInputs: [], inputs },
});

async function proveGoal(goal: Goal) {
  const conversationId = `unseen-${randomUUID()}`;
  const semanticType = goal.resource;
  const amountMinor = String(2100 + goal.resource.length * 17);
  const expression = await createExpression({
    ownerId: SELLER,
    kind: goal.nonCommercial ? "need" : "offering",
    semanticType,
    attributes: {
      businessModel: goal.model,
      priceMinor: amountMinor,
      currency: "SAR",
      quantity: goal.parties,
    },
  });
  await publishExpression({
    id: expression.id,
    ownerId: SELLER,
    projection: {
      semanticType,
      summary: `${semanticType} ${goal.model}`,
      publicTerms: { money: { amountMinor, currency: "SAR" } },
    },
  });

  // A same-domain private row is an active cross-owner leak canary.
  const privateExpression = await createExpression({
    ownerId: SELLER,
    kind: goal.nonCommercial ? "need" : "offering",
    semanticType: `${semanticType} confidential`,
    attributes: { internalNotes: "must-not-leak" },
  });
  await handle.db.update(economicExpressions)
    .set({ status: "active" })
    .where(eq(economicExpressions.id, privateExpression.id));

  const found = await discover(handle.db, {
    ownerId: BUYER,
    conversationId,
    query: semanticType,
    kind: goal.nonCommercial ? "need" : "offering",
    explicitScope: goal.sources === "internal" ? "INTERNAL" : undefined,
    availability: { internal: true, web: goal.sources === "mixed" },
    webResults: goal.sources === "mixed" ? [{
      url: `https://observations.example/${encodeURIComponent(semanticType)}`,
      title: `${semanticType} public listing`,
      snippet: goal.model,
      retrievedAt: "2029-01-01T00:00:00.000Z",
    }] : [],
  });
  expect(found.candidates.some((candidate) => candidate.canonicalRef === expression.id)).toBe(true);
  expect(found.candidates.some((candidate) => candidate.canonicalRef === privateExpression.id)).toBe(false);

  const ordinal = await resolveOrdinal(handle.db, conversationId, 1);
  expect(ordinal.status).toBe("RESOLVED");
  if (ordinal.status !== "RESOLVED") throw new Error("The frozen ordinal resolver lost candidate one.");
  await bindReference(handle.db, {
    ownerId: BUYER,
    conversationId,
    referenceKey: "ordinal:1",
    targetKind: "discovery_candidate",
    targetId: ordinal.value.id,
    resultSetId: found.resultSet.id,
    position: 1,
  });

  const observation = await recordObservation(handle.db, {
    ownerId: BUYER,
    subjectKind: "goal_candidate",
    subjectId: ordinal.value.id,
    observerOwnerId: BUYER,
    observationKind: goal.monitor ? "watch_requested" : "reviewed",
    proofClass: "self_report",
  });
  expect(observation.location).toBeNull();

  // Equal-recency deictics must remain ambiguous rather than selecting either.
  const tiedAt = new Date("2040-01-01T00:00:00.000Z");
  await handle.db.insert(referenceBindings).values([
    {
      id: `ref-${randomUUID()}`,
      ownerId: BUYER,
      conversationId,
      referenceKey: "this:a",
      targetKind: "goal_candidate",
      targetId: "candidate-a",
      createdAt: tiedAt,
    },
    {
      id: `ref-${randomUUID()}`,
      ownerId: BUYER,
      conversationId,
      referenceKey: "this:b",
      targetKind: "goal_candidate",
      targetId: "candidate-b",
      createdAt: tiedAt,
    },
  ]);
  expect((await resolveThis(handle.db, conversationId)).status).toBe("AMBIGUOUS");

  if (goal.monitor) {
    const notice = await createNotificationIntent(handle.db, {
      ownerId: BUYER,
      recipientId: BUYER,
      purpose: "unseen-goal-watch",
      content: {
        title: "Observed condition",
        body: semanticType,
        data: { candidateId: ordinal.value.id },
      },
      channels: ["in_app"],
      idempotencyKey: `watch:${ordinal.value.id}`,
    });
    expect(notice.ownerId).toBe(BUYER);
  }

  if (goal.delegate) {
    const grant = await createDelegationGrant(handle.db, {
      principalOwnerId: BUYER,
      delegateId: DELEGATE,
      delegateKind: "user",
      purpose: "inspect-selected-candidate",
      allowedCapabilities: ["discovery.inspect"],
      resourceScope: { kinds: ["discovery_candidate"], ids: [ordinal.value.id] },
    });
    expect(grant.resourceScope).toEqual({ kinds: ["discovery_candidate"], ids: [ordinal.value.id] });
    expect(await listDelegationGrants(handle.db, { principalOwnerId: OUTSIDER })).toEqual([]);
  }

  if (!goal.nonCommercial) {
    const turn = (content: string, capability: string) => orchestrate({
      db: handle.db,
      worlds,
      ownerId: BUYER,
      conversationId,
      content,
      approvalRef: `message-${randomUUID()}`,
      envelope: envelope(capability),
    });
    const selected = await turn("select first", "commerce_select");
    expect(selected?.status).toBe("awaiting_approval");
    const firstApproval = await turn("approve", "commerce_approve");
    const replayedApproval = await turn("approve again", "commerce_approve");
    expect(replayedApproval?.data.paymentIntentId).toBe(firstApproval?.data.paymentIntentId);
    expect(await handle.db.select().from(paymentIntents)).toHaveLength(1);
  } else {
    const turnResult = await orchestrate({
      db: handle.db,
      worlds,
      ownerId: BUYER,
      conversationId,
      content: "review this community request",
      approvalRef: `message-${randomUUID()}`,
      envelope: envelope("discovery_search", {
        query: semanticType,
        kind: "need",
        explicitScope: "INTERNAL",
      }),
    });
    expect(turnResult?.status).toBe("completed");
    expect(await handle.db.select().from(paymentIntents)).toHaveLength(0);
  }

  if (goal.world) {
    const plan = await createWorldPlan(handle.db, worlds, {
      ownerId: "42",
      ownerNumericId: 42,
      worldId: WORLD,
      name: goal.model,
      priceMinor: amountMinor,
      currency: "SAR",
      cadence: "MONTHLY",
      entitlementScopes: [semanticType],
    });
    const mutation = await orchestrate({
      db: handle.db,
      worlds,
      ownerId: "42",
      conversationId: "7",
      content: "stop this generated-world plan",
      approvalRef: `message-${randomUUID()}`,
      envelope: envelope("world_commerce", {
        worldRef: WORLD,
        planId: plan.id,
        mutation: { status: "PAUSED" },
      }),
    });
    expect(mutation?.status).toBe("completed");
  }

  // Generic confidence counters: isolation, one-or-zero intent, no location
  // invention, and no ambiguous-reference guess.
  expect(await handle.db.select().from(commercialOrders).where(eq(commercialOrders.ownerId, OUTSIDER))).toEqual([]);
  expect(await handle.db.select().from(paymentIntents).where(eq(paymentIntents.ownerId, OUTSIDER))).toEqual([]);
  expect(Number(process.env.PRIVATE_DATA_DISCOVERY_LEAKS ?? "0")).toBe(0);
}

beforeAll(async () => {
  handle = await getTestDb();
  ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
  ({ discover, bindReference, resolveOrdinal, resolveThis, recordObservation, orchestrateConversationCommerce: orchestrate } =
    await import("../../api/runtime/block31"));
  ({ createDelegationGrant, listDelegationGrants } = await import("../../api/runtime/block2/delegation"));
  ({ createNotificationIntent } = await import("../../api/runtime/block2/notifications"));
  ({ createWorldPlan } = await import("../../api/runtime/block3/generated-business-economics"));
});

beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE notification_intents, delegation_grants, fulfillment_observations,
      reference_bindings, discovery_candidates, discovery_result_sets,
      payment_intents, commercial_orders, plans,
      economic_expressions CASCADE
  `));
});

afterAll(async () => {
  await handle.pool.end();
});

describe("unseen axis: scarce rights and time-window exchanges", () => {
  it.each<Goal>([
    { name: "archive digitization permission auction", resource: "archive.digitization.permission", model: "sealed-bid rights auction", sources: "mixed", monitor: true, parties: 3, world: false, delegate: true, nonCommercial: false },
    { name: "beekeeper pollination calendar exchange", resource: "apiary.pollination.window", model: "seasonal slot exchange", sources: "internal", monitor: true, parties: 2, world: true, delegate: false, nonCommercial: false },
    { name: "radio remnant airtime clearing", resource: "radio.remnant.airtime", model: "last-minute clearing price", sources: "mixed", monitor: false, parties: 3, world: false, delegate: true, nonCommercial: false },
    { name: "translation memory corpus license", resource: "translation.memory.corpus", model: "usage-tier license", sources: "internal", monitor: false, parties: 2, world: true, delegate: false, nonCommercial: false },
    { name: "museum traveling exhibit loan", resource: "museum.exhibit.loan", model: "reciprocal institutional loan", sources: "mixed", monitor: true, parties: 3, world: false, delegate: true, nonCommercial: false },
  ])("$name", proveGoal);
});

describe("unseen axis: idle capacity and route businesses", () => {
  it.each<Goal>([
    { name: "cold-room pallet-night capacity", resource: "coldroom.pallet.night", model: "metered capacity rental", sources: "internal", monitor: true, parties: 2, world: true, delegate: true, nonCommercial: false },
    { name: "festival booth sublease window", resource: "festival.booth.window", model: "short-term sublease", sources: "mixed", monitor: false, parties: 3, world: false, delegate: false, nonCommercial: false },
    { name: "piano tuning neighborhood route", resource: "piano.tuning.route", model: "route-density booking", sources: "internal", monitor: true, parties: 2, world: false, delegate: true, nonCommercial: false },
    { name: "additive fabrication idle-hours pool", resource: "additive.fabrication.hour", model: "machine-hour marketplace", sources: "mixed", monitor: true, parties: 3, world: true, delegate: false, nonCommercial: false },
    { name: "shared culinary production shift", resource: "culinary.production.shift", model: "revenue-share capacity", sources: "internal", monitor: false, parties: 2, world: false, delegate: true, nonCommercial: false },
  ])("$name", proveGoal);
});

describe("unseen axis: environmental and field-service allocations", () => {
  it.each<Goal>([
    { name: "aerial habitat survey slot", resource: "habitat.aerial.survey.slot", model: "milestone service", sources: "mixed", monitor: true, parties: 3, world: false, delegate: true, nonCommercial: false },
    { name: "coastal catch-allocation lease", resource: "coastal.catch.allocation", model: "seasonal quota lease", sources: "internal", monitor: false, parties: 2, world: true, delegate: false, nonCommercial: false },
    { name: "orchard row stewardship", resource: "orchard.row.stewardship", model: "annual adoption sponsorship", sources: "mixed", monitor: true, parties: 3, world: false, delegate: false, nonCommercial: false },
    { name: "soil microscopy batch run", resource: "soil.microscopy.batch", model: "cooperative batch pricing", sources: "internal", monitor: true, parties: 2, world: false, delegate: true, nonCommercial: false },
    { name: "wetland acoustic sensor tenancy", resource: "wetland.sensor.tenancy", model: "data-access subscription", sources: "mixed", monitor: false, parties: 3, world: true, delegate: true, nonCommercial: false },
  ])("$name", proveGoal);
});

describe("unseen axis: knowledge, civic, and non-commercial work", () => {
  it.each<Goal>([
    { name: "community seed collection lending", resource: "community.seed.collection", model: "deposit-backed lending", sources: "internal", monitor: true, parties: 2, world: false, delegate: true, nonCommercial: true },
    { name: "oral-history transcription volunteers", resource: "oralhistory.transcription.shift", model: "volunteer timebank", sources: "mixed", monitor: false, parties: 3, world: false, delegate: true, nonCommercial: true },
    { name: "watershed sampling citizen rota", resource: "watershed.sampling.rota", model: "civic duty roster", sources: "internal", monitor: true, parties: 3, world: true, delegate: false, nonCommercial: true },
    { name: "braille proofreading peer circle", resource: "braille.proofreading.circle", model: "mutual-aid exchange", sources: "mixed", monitor: true, parties: 2, world: false, delegate: true, nonCommercial: true },
    { name: "public footpath mapping sprint", resource: "footpath.mapping.sprint", model: "open-data contribution", sources: "internal", monitor: false, parties: 3, world: false, delegate: false, nonCommercial: true },
  ])("$name", proveGoal);
});

describe("unseen axis: finance, culture, and specialist inventory", () => {
  it.each<Goal>([
    { name: "founder micro-grant cohort", resource: "founder.microgrant.cohort", model: "milestone grant tranche", sources: "mixed", monitor: true, parties: 3, world: true, delegate: true, nonCommercial: false },
    { name: "theatre costume collection rental", resource: "theatre.costume.collection", model: "production-season rental", sources: "internal", monitor: false, parties: 2, world: false, delegate: false, nonCommercial: false },
    { name: "rare-language narrator session", resource: "rarelanguage.narration.session", model: "finished-minute commission", sources: "mixed", monitor: true, parties: 3, world: false, delegate: true, nonCommercial: false },
    { name: "ceramics kiln firing shelf", resource: "ceramics.firing.shelf", model: "shared firing allocation", sources: "internal", monitor: true, parties: 2, world: true, delegate: false, nonCommercial: false },
    { name: "astronomy observatory eyepiece night", resource: "observatory.eyepiece.night", model: "member-night reservation", sources: "mixed", monitor: false, parties: 3, world: false, delegate: true, nonCommercial: false },
  ])("$name", proveGoal);
});