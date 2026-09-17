import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  economicExpressions,
  referenceBindings,
} from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let grantExpressionAccess: typeof import("../../api/runtime/economic-fabric").grantExpressionAccess;
let revokeExpressionAccess: typeof import("../../api/runtime/economic-fabric").revokeExpressionAccess;
let getExpression: typeof import("../../api/runtime/economic-fabric").getExpression;
let discover: typeof import("../../api/runtime/block31").discover;
let planSources: typeof import("../../api/runtime/block31").planSources;
let bindReference: typeof import("../../api/runtime/block31").bindReference;
let resolveOrdinal: typeof import("../../api/runtime/block31").resolveOrdinal;
let resolveThis: typeof import("../../api/runtime/block31").resolveThis;
let recordObservation: typeof import("../../api/runtime/block31").recordObservation;

const owner = "sample-owner";
const requester = "sample-requester";

async function seedPublished(input: {
  ownerId?: string;
  semanticType: string;
  summary?: string;
  attributes?: Record<string, unknown>;
}) {
  const expression = await createExpression({
    ownerId: input.ownerId ?? owner,
    kind: "offering",
    semanticType: input.semanticType,
    attributes: input.attributes,
  });
  return publishExpression({
    id: expression.id,
    ownerId: input.ownerId ?? owner,
    projection: {
      semanticType: input.semanticType,
      summary: input.summary ?? input.semanticType,
    },
  });
}

async function runSearch(
  query: string,
  overrides: Partial<Parameters<typeof discover>[1]> = {},
) {
  return discover(handle.db, {
    ownerId: requester,
    conversationId: `conversation-${randomUUID()}`,
    query,
    explicitScope: "INTERNAL",
    kind: "offering",
    ...overrides,
  });
}

describe("Block 3.1 discovery core", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    ({
      createExpression,
      publishExpression,
      grantExpressionAccess,
      revokeExpressionAccess,
      getExpression,
    } = await import("../../api/runtime/economic-fabric"));
    ({
      discover,
      planSources,
      bindReference,
      resolveOrdinal,
      resolveThis,
      recordObservation,
    } = await import("../../api/runtime/block31"));
  });

  beforeEach(async () => {
    await handle.db.execute(sql.raw(`
      TRUNCATE TABLE fulfillment_observations, reference_bindings,
        discovery_candidates, discovery_result_sets, memberships,
        economic_expressions CASCADE
    `));
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("finds a published cross-owner public active Offering", async () => {
    const expression = await seedPublished({ semanticType: "sample ceramic lamp" });

    const result = await runSearch("ceramic lamp");

    expect(result.candidates.map((candidate) => candidate.canonicalRef)).toContain(expression.id);
    const candidate = result.candidates.find((row) => row.canonicalRef === expression.id)!;
    expect(candidate.source).toBe("JASIM_INTERNAL");
    expect(candidate.trust).toBe("canonical_internal");
  });

  it("never discovers a private expression across owners", async () => {
    const expression = await createExpression({
      ownerId: owner,
      kind: "offering",
      semanticType: "sample private archive",
    });
    await handle.db
      .update(economicExpressions)
      .set({ status: "active" })
      .where(eq(economicExpressions.id, expression.id));

    const result = await runSearch("private archive");

    expect(result.candidates.some((row) => row.canonicalRef === expression.id)).toBe(false);
    expect(Number(process.env.PRIVATE_DATA_DISCOVERY_LEAKS ?? "0")).toBe(0);
  });

  it("requires an active membership grant for shared visibility and hides it after revocation", async () => {
    const expression = await createExpression({
      ownerId: owner,
      kind: "offering",
      semanticType: "sample shared record",
    });
    const grant = await grantExpressionAccess({
      expressionId: expression.id,
      actorOwnerId: owner,
      subjectId: requester,
      permissions: ["read"],
    });
    await handle.db
      .update(economicExpressions)
      .set({ status: "active" })
      .where(eq(economicExpressions.id, expression.id));

    expect(grant.membership.state).toBe("active");
    const withGrant = await getExpression(expression.id, requester);
    expect(withGrant?.id).toBe(expression.id);

    await revokeExpressionAccess({
      expressionId: expression.id,
      actorOwnerId: owner,
      subjectId: requester,
    });
    await expect(getExpression(expression.id, requester)).rejects.toThrow("Cross-owner access denied");
  });

  it("excludes draft, paused, and closed expressions", async () => {
    const draft = await createExpression({
      ownerId: owner,
      kind: "offering",
      semanticType: "sample lifecycle draft",
    });
    const paused = await seedPublished({ semanticType: "sample lifecycle paused" });
    const closed = await seedPublished({ semanticType: "sample lifecycle sold" });
    await handle.db
      .update(economicExpressions)
      .set({ status: "paused" })
      .where(eq(economicExpressions.id, paused.id));
    await handle.db
      .update(economicExpressions)
      .set({ status: "closed" })
      .where(eq(economicExpressions.id, closed.id));

    const result = await runSearch("sample lifecycle");
    const ids = result.candidates.map((row) => row.canonicalRef);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(paused.id);
    expect(ids).not.toContain(closed.id);
  });

  it("applies maximum price before lexical ranking", async () => {
    const expensiveExact = await seedPublished({
      semanticType: "rare blue sample widget",
      summary: "rare blue sample widget rare blue sample widget",
      attributes: { priceMinor: "12001", currency: "SAR" },
    });
    const affordableWeak = await seedPublished({
      semanticType: "sample object",
      summary: "blue alternative",
      attributes: { priceMinor: "9000", currency: "SAR" },
    });

    const result = await runSearch("rare blue sample widget", {
      hardConstraints: [{ field: "price", maxMinor: "10000", currency: "SAR" }],
    });
    const ids = result.candidates.map((row) => row.canonicalRef);
    expect(ids).not.toContain(expensiveExact.id);
    expect(ids).toContain(affordableWeak.id);
  });

  it("excludes currency mismatches and treats missing price as UNKNOWN, not zero", async () => {
    const mismatch = await seedPublished({
      semanticType: "sample priced foreign",
      attributes: { priceMinor: "100", currency: "USD" },
    });
    const missing = await seedPublished({ semanticType: "sample price unknown" });
    const match = await seedPublished({
      semanticType: "sample priced local",
      attributes: { priceMinor: "100", currency: "SAR" },
    });

    const result = await runSearch("sample priced", {
      hardConstraints: [{ field: "price", maxMinor: "500", currency: "SAR" }],
    });
    const ids = result.candidates.map((row) => row.canonicalRef);
    expect(ids).toContain(match.id);
    expect(ids).not.toContain(mismatch.id);
    expect(ids).not.toContain(missing.id);
  });

  it("plans only user-authorized and configured sources", () => {
    const available = { internal: true, web: true };
    expect(planSources("فقط داخل جاسم", undefined, available)).toEqual(["JASIM_INTERNAL"]);
    expect(planSources("only internet", undefined, available)).toEqual(["WEB_OBSERVATION"]);
    expect(planSources("find a sample", undefined, available)).toEqual([
      "JASIM_INTERNAL",
      "WEB_OBSERVATION",
    ]);
    expect(planSources("find a sample", undefined, {
      ...available,
      connectedProviders: [],
      mcpProviders: [],
      a2aProviders: [],
    })).not.toEqual(expect.arrayContaining([
      "CONNECTED_PROVIDER",
      "MCP_PROVIDER",
      "A2A_PROVIDER",
    ]));
  });

  it("binds an ordinal to position two without rebinding it after a new search", async () => {
    await seedPublished({ semanticType: "sample ordinal alpha" });
    await seedPublished({ semanticType: "sample ordinal beta" });
    const conversationId = `conversation-${randomUUID()}`;
    const first = await runSearch("sample ordinal", { conversationId });
    expect(first.candidates).toHaveLength(2);

    const ordinal = await resolveOrdinal(
      handle.db,
      { ownerId: requester, conversationId },
      2,
    );
    expect(ordinal.status).toBe("RESOLVED");
    if (ordinal.status !== "RESOLVED") throw new Error("Expected the second candidate.");
    await bindReference(handle.db, {
      ownerId: requester,
      conversationId,
      referenceKey: "الثاني",
      targetKind: "discovery_candidate",
      targetId: ordinal.value.id,
      resultSetId: first.resultSet.id,
      position: 2,
    });

    await runSearch("a new unrelated search", { conversationId });
    const historic = await resolveThis(handle.db, { ownerId: requester, conversationId });
    expect(historic.status).toBe("RESOLVED");
    if (historic.status !== "RESOLVED") throw new Error("Expected the historic binding.");
    expect(historic.value.targetId).toBe(ordinal.value.id);
    expect(historic.value.resultSetId).toBe(first.resultSet.id);
  });

  it("returns AMBIGUOUS for a context-free deictic reference instead of guessing", async () => {
    const createdAt = new Date("2025-01-01T00:00:00.000Z");
    await handle.db.insert(referenceBindings).values([
      {
        id: `ref-${randomUUID()}`,
        ownerId: requester,
        conversationId: "ambiguous-conversation",
        referenceKey: "هذا",
        targetKind: "sample",
        targetId: "sample-a",
        createdAt,
      },
      {
        id: `ref-${randomUUID()}`,
        ownerId: requester,
        conversationId: "ambiguous-conversation",
        referenceKey: "ذلك",
        targetKind: "sample",
        targetId: "sample-b",
        createdAt,
      },
    ]);

    const resolution = await resolveThis(handle.db, {
      ownerId: requester,
      conversationId: "ambiguous-conversation",
    });
    expect(resolution.status).toBe("AMBIGUOUS");
    if (resolution.status === "AMBIGUOUS") expect(resolution.candidates).toHaveLength(2);
  });

  it("records self-report proof with UNKNOWN location and rejects invalid proof classes", async () => {
    const observation = await recordObservation(handle.db, {
      ownerId: owner,
      subjectKind: "sample_subject",
      subjectId: "sample-subject-1",
      observerOwnerId: requester,
      observationKind: "sample_state",
      proofClass: "self_report",
    });
    expect(observation.proofClass).toBe("self_report");
    expect(observation.location).toBeNull();

    await expect(recordObservation(handle.db, {
      ownerId: owner,
      subjectKind: "sample_subject",
      subjectId: "sample-subject-1",
      observerOwnerId: requester,
      observationKind: "sample_state",
      proofClass: "verified",
    })).rejects.toThrow("Invalid proofClass");
  });
});