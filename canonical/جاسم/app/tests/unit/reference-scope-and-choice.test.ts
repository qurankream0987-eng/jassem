/**
 * JASIM — owner-scoped reference primitives, and the CHOICE clarification.
 *
 * Two things are under test, and they are related. The first is that a
 * reference resolver is safe *by contract* rather than by caller discipline:
 * "safe because everyone has been careful so far" is not an invariant, and the
 * next caller inherits no warning. The second is that when the runtime has to
 * ask which of several things a person meant, it asks with the list it already
 * holds instead of an empty text box.
 *
 * No error here may reveal that another owner's target exists. Absence and
 * "belongs to someone else" have to look identical from outside.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import * as schema from "@db/schema";
import * as relations from "@db/relations";
import { discoveryCandidates, discoveryResultSets, referenceBindings } from "@db/schema";
import { resolveOrdinal, resolveThis } from "../../api/runtime/block31/reference-bindings";
import { decidePresentation } from "../../api/runtime/presentation-fabric";
import { TRUSTED_PRESENTATION_REGISTRY } from "../../src/components/jasim-core/PresentationRenderer";
import { MOBILE_PRESENTATION_REGISTRY } from "../../../../../artifacts/jasim-mobile/lib/mobile-presentation";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema: { ...schema, ...relations } });

const OWNER_A = `w12-a-${randomUUID().slice(0, 8)}`;
const OWNER_B = `w12-b-${randomUUID().slice(0, 8)}`;
// Deliberately the SAME conversation id for both owners: the isolation must
// come from the owner condition, not from an unguessable conversation id.
const SHARED_CONVERSATION = `w12-conv-${randomUUID().slice(0, 8)}`;
const setIds: string[] = [];

async function seedResultSet(ownerId: string, positions: number[]): Promise<string> {
  const setId = `rs_${randomUUID()}`;
  setIds.push(setId);
  await db.insert(discoveryResultSets).values({
    id: setId,
    ownerId,
    conversationId: SHARED_CONVERSATION,
    queryText: "probe",
    sources: ["JASIM_INTERNAL"],
    hardConstraints: [],
  });
  for (const position of positions) {
    await db.insert(discoveryCandidates).values({
      id: `dc_${randomUUID()}`,
      resultSetId: setId,
      position,
      source: "JASIM_INTERNAL",
      title: `${ownerId}-candidate-${position}`,
      trust: "canonical_internal",
      attributes: {},
      provenance: {},
    });
  }
  return setId;
}

async function seedBinding(ownerId: string, referenceKey: string, targetId: string) {
  await db.insert(referenceBindings).values({
    id: `ref_${randomUUID()}`,
    ownerId,
    conversationId: SHARED_CONVERSATION,
    referenceKey,
    targetKind: "sample",
    targetId,
  });
}

async function cleanup() {
  await db.delete(referenceBindings).where(
    inArray(referenceBindings.ownerId, [OWNER_A, OWNER_B]),
  );
  if (setIds.length) {
    await db.delete(discoveryCandidates).where(
      inArray(discoveryCandidates.resultSetId, setIds),
    );
    await db.delete(discoveryResultSets).where(inArray(discoveryResultSets.id, setIds));
    setIds.length = 0;
  }
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("resolveThis is owner-scoped by contract", () => {
  it("resolves the asking owner's own binding", async () => {
    await seedBinding(OWNER_A, "deictic:this", "a-1");
    const result = await resolveThis(db, {
      ownerId: OWNER_A,
      conversationId: SHARED_CONVERSATION,
    });
    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") expect(result.value.targetId).toBe("a-1");
  });

  it("does not see another owner's binding in the same conversation id", async () => {
    await seedBinding(OWNER_B, "deictic:this", "b-secret");
    const result = await resolveThis(db, {
      ownerId: OWNER_A,
      conversationId: SHARED_CONVERSATION,
    });
    expect(result).toEqual({ status: "NOT_FOUND" });
  });

  it("isolates the same referenceKey held by two owners", async () => {
    await seedBinding(OWNER_A, "deictic:this", "a-1");
    await seedBinding(OWNER_B, "deictic:this", "b-1");

    const a = await resolveThis(db, { ownerId: OWNER_A, conversationId: SHARED_CONVERSATION });
    const b = await resolveThis(db, { ownerId: OWNER_B, conversationId: SHARED_CONVERSATION });
    expect(a.status).toBe("RESOLVED");
    expect(b.status).toBe("RESOLVED");
    if (a.status !== "RESOLVED" || b.status !== "RESOLVED") return;
    expect(a.value.targetId).toBe("a-1");
    expect(b.value.targetId).toBe("b-1");
  });

  it("another owner's bindings cannot manufacture an ambiguity", async () => {
    // Without the owner condition these three rows would look like one
    // conversation holding three live references.
    await seedBinding(OWNER_A, "deictic:this", "a-1");
    await seedBinding(OWNER_B, "named:x", "b-1");
    await seedBinding(OWNER_B, "named:y", "b-2");

    const result = await resolveThis(db, {
      ownerId: OWNER_A,
      conversationId: SHARED_CONVERSATION,
    });
    expect(result.status).toBe("RESOLVED");
  });

  it("a superseded binding does not come back", async () => {
    await seedBinding(OWNER_A, "deictic:this", "a-1");
    await db
      .update(referenceBindings)
      .set({ supersededAt: new Date() })
      .where(inArray(referenceBindings.ownerId, [OWNER_A]));

    expect(await resolveThis(db, {
      ownerId: OWNER_A,
      conversationId: SHARED_CONVERSATION,
    })).toEqual({ status: "NOT_FOUND" });
  });

  it("says nothing about whether another owner's target exists", async () => {
    await seedBinding(OWNER_B, "deictic:this", "b-secret");
    const foreign = await resolveThis(db, {
      ownerId: OWNER_A,
      conversationId: SHARED_CONVERSATION,
    });
    const empty = await resolveThis(db, {
      ownerId: OWNER_A,
      conversationId: `w12-empty-${randomUUID().slice(0, 8)}`,
    });
    // Byte-identical: "not yours" and "does not exist" are the same answer.
    expect(foreign).toEqual(empty);
    expect(JSON.stringify(foreign)).not.toContain("b-secret");
  });
});

describe("resolveOrdinal is owner-scoped by contract", () => {
  it("resolves the asking owner's own ordinal", async () => {
    await seedResultSet(OWNER_A, [1, 2]);
    const result = await resolveOrdinal(
      db,
      { ownerId: OWNER_A, conversationId: SHARED_CONVERSATION },
      2,
    );
    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") expect(result.value.title).toContain(OWNER_A);
  });

  it("does not reach another owner's result set in the same conversation id", async () => {
    await seedResultSet(OWNER_B, [1, 2]);
    const result = await resolveOrdinal(
      db,
      { ownerId: OWNER_A, conversationId: SHARED_CONVERSATION },
      2,
    );
    expect(result).toEqual({ status: "NOT_FOUND" });
  });

  it("isolates the same ordinal across two owners", async () => {
    await seedResultSet(OWNER_A, [1, 2]);
    await seedResultSet(OWNER_B, [1, 2]);

    const a = await resolveOrdinal(db, { ownerId: OWNER_A, conversationId: SHARED_CONVERSATION }, 1);
    const b = await resolveOrdinal(db, { ownerId: OWNER_B, conversationId: SHARED_CONVERSATION }, 1);
    expect(a.status).toBe("RESOLVED");
    expect(b.status).toBe("RESOLVED");
    if (a.status !== "RESOLVED" || b.status !== "RESOLVED") return;
    expect(a.value.title).toContain(OWNER_A);
    expect(b.value.title).toContain(OWNER_B);
    expect(a.value.id).not.toBe(b.value.id);
  });

  it("another owner's result set cannot manufacture an ordinal ambiguity", async () => {
    // Two sets created at the same moment used to tie regardless of owner.
    await seedResultSet(OWNER_A, [1]);
    await seedResultSet(OWNER_B, [1]);
    const result = await resolveOrdinal(
      db,
      { ownerId: OWNER_A, conversationId: SHARED_CONVERSATION },
      1,
    );
    expect(result.status).toBe("RESOLVED");
  });

  it("a mismatched owner cannot resolve even with the exact conversation id", async () => {
    await seedResultSet(OWNER_A, [1, 2]);
    const result = await resolveOrdinal(
      db,
      { ownerId: OWNER_B, conversationId: SHARED_CONVERSATION },
      2,
    );
    expect(result).toEqual({ status: "NOT_FOUND" });
  });
});

describe("CHOICE is a selection, FORM is data entry", () => {
  const candidates = [
    { referenceKey: "named:first", entityRef: "generic_subject:s1" },
    { referenceKey: "named:second", entityRef: "generic_subject:s2" },
  ];

  it("emits CHOICE when the alternatives are already known", () => {
    const presentation = decidePresentation({
      interactionNeed: "collect_input",
      data: { candidates },
    });
    expect(presentation.primitive).toBe("CHOICE");
    expect((presentation.data.candidates as unknown[]).length).toBe(2);
    expect(presentation.actions?.map((action) => action.intent)).toEqual(["select"]);
  });

  it("still emits FORM when values have to be supplied", () => {
    const presentation = decidePresentation({
      interactionNeed: "collect_input",
      data: {},
      missingFields: [{ name: "quantity", type: "number", requiredNow: true }],
    });
    expect(presentation.primitive).toBe("FORM");
    expect(presentation.fields?.[0].name).toBe("quantity");
  });

  it("prefers FORM when both are present, because a choice cannot supply a value", () => {
    const presentation = decidePresentation({
      interactionNeed: "collect_input",
      data: { candidates },
      missingFields: [{ name: "quantity", type: "number", requiredNow: true }],
    });
    expect(presentation.primitive).toBe("FORM");
  });

  it("does not turn an empty candidate list into a choice with nothing to choose", () => {
    const presentation = decidePresentation({
      interactionNeed: "collect_input",
      data: { candidates: [] },
    });
    expect(presentation.primitive).toBe("FORM");
  });

  it("leaves every other interaction need untouched", () => {
    expect(decidePresentation({ interactionNeed: "inform", data: { candidates } }).primitive)
      .not.toBe("CHOICE");
    expect(decidePresentation({ interactionNeed: "compare", data: { candidates } }).primitive)
      .toBe("COMPARISON");
    // Authority still outranks a selection: an approval is never a CHOICE.
    expect(
      decidePresentation({
        interactionNeed: "collect_input",
        actionability: "consequential",
        data: { candidates },
      }).primitive,
    ).toBe("APPROVAL");
  });

  it("the client cannot ask for CHOICE — only the decision layer emits it", () => {
    // A caller naming a primitive in `data` is just data. The cascade decides
    // from the interaction need, and an informational turn carrying candidates
    // is a result list, not a clarification.
    const presentation = decidePresentation({
      interactionNeed: "inform",
      semanticOutput: "structured",
      data: { primitive: "CHOICE", candidates },
    });
    expect(presentation.primitive).not.toBe("CHOICE");
    expect(presentation.primitive).toBe("SEARCH_RESULTS");
  });
});

describe("CHOICE renders on both platforms from one definition", () => {
  it("has a renderer on Web and on Mobile", () => {
    expect(TRUSTED_PRESENTATION_REGISTRY.CHOICE).toBeTruthy();
    expect(MOBILE_PRESENTATION_REGISTRY.CHOICE).toBeTruthy();
  });

  it("carries no privileged identifier or coordinate into the clarification", () => {
    const presentation = decidePresentation({
      interactionNeed: "collect_input",
      data: {
        candidates: [
          { referenceKey: "named:first", entityRef: "generic_subject:s1" },
          { referenceKey: "named:second", entityRef: "generic_subject:s2" },
        ],
      },
    });
    const serialized = JSON.stringify(presentation).toLowerCase();
    for (const term of ["lat", "lng", "coordinates", "ownerid", "observedat"]) {
      expect(serialized).not.toContain(term);
    }
  });
});
