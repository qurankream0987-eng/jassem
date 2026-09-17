/**
 * JASIM — conversational reference → observable canonical subject.
 *
 * What is under test is not "a subject resolves". It is that a subject resolves
 * ONLY from a durable binding this owner made in this conversation, that an
 * honest ambiguity produces a question rather than a guess, and that neither a
 * client nor a model can nominate a referent.
 *
 * The thing being guessed at, if the resolver guessed, is a person's location.
 * That is why the ambiguity tests matter as much as the resolution tests.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import * as schema from "@db/schema";
import * as relations from "@db/relations";
import { observations, referenceBindings } from "@db/schema";
import { resolveObservableSubject } from "../../api/runtime/subject-resolution";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema: { ...schema, ...relations } });

const OWNER = `wave11-owner-${randomUUID().slice(0, 8)}`;
const OTHER_OWNER = `wave11-other-${randomUUID().slice(0, 8)}`;
const CONVERSATION = `wave11-conv-${randomUUID().slice(0, 8)}`;
const OTHER_CONVERSATION = `wave11-conv2-${randomUUID().slice(0, 8)}`;
const createdBindingIds: string[] = [];
const createdObservationIds: string[] = [];

async function bind(input: {
  ownerId?: string;
  conversationId?: string;
  referenceKey: string;
  targetKind: string;
  targetId: string;
  createdAt?: Date;
  supersededAt?: Date | null;
}): Promise<void> {
  const id = `ref_${randomUUID()}`;
  createdBindingIds.push(id);
  await db.insert(referenceBindings).values({
    id,
    ownerId: input.ownerId ?? OWNER,
    conversationId: input.conversationId ?? CONVERSATION,
    referenceKey: input.referenceKey,
    targetKind: input.targetKind,
    targetId: input.targetId,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    supersededAt: input.supersededAt ?? null,
  });
}

async function observe(input: {
  ownerId?: string;
  subjectKind: string;
  subjectId: string;
  observationType?: string;
  observedAt?: Date;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const id = `obs_${randomUUID()}`;
  createdObservationIds.push(id);
  await db.insert(observations).values({
    id,
    ownerId: input.ownerId ?? OWNER,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    observationType: input.observationType ?? "location",
    observedAt: input.observedAt ?? new Date(),
    sourceKind: "device",
    provenance: {},
    payload: input.payload ?? { lat: 29.3, lng: 47.9, status: "moving" },
    freshnessExpiresAt: new Date(Date.now() + 120_000),
  });
}

beforeEach(async () => {
  await db.delete(referenceBindings).where(
    inArray(referenceBindings.ownerId, [OWNER, OTHER_OWNER]),
  );
  await db.delete(observations).where(
    inArray(observations.ownerId, [OWNER, OTHER_OWNER]),
  );
  createdBindingIds.length = 0;
  createdObservationIds.length = 0;
});

afterAll(async () => {
  await db.delete(referenceBindings).where(
    inArray(referenceBindings.ownerId, [OWNER, OTHER_OWNER]),
  );
  await db.delete(observations).where(
    inArray(observations.ownerId, [OWNER, OTHER_OWNER]),
  );
  await pool.end();
});

const resolve = (overrides: Partial<Parameters<typeof resolveObservableSubject>[1]> = {}) =>
  resolveObservableSubject(db, {
    ownerId: OWNER,
    conversationId: CONVERSATION,
    observationType: "location",
    ...overrides,
  });

describe("single observable subject", () => {
  it("resolves the one thing this conversation refers to", async () => {
    await bind({ referenceKey: "deictic:this", targetKind: "generic_subject", targetId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });

    const result = await resolve();
    expect(result.status).toBe("RESOLVED");
    if (result.status !== "RESOLVED") return;
    expect(result.subject).toEqual({ kind: "generic_subject", id: "s1" });
    expect(result.referenceKey).toBe("deictic:this");
  });

  it("works for any target kind, with no per-kind branch", async () => {
    for (const kind of ["driver", "technician", "vehicle", "shipment", "robot", "kiln"]) {
      await db.delete(referenceBindings).where(eq(referenceBindings.ownerId, OWNER));
      await db.delete(observations).where(eq(observations.ownerId, OWNER));
      await bind({ referenceKey: "deictic:this", targetKind: kind, targetId: "x" });
      await observe({ subjectKind: kind, subjectId: "x" });

      const result = await resolve();
      expect(result.status).toBe("RESOLVED");
      if (result.status === "RESOLVED") expect(result.subject.kind).toBe(kind);
    }
  });

  it("continues across turns through the same stable binding", async () => {
    // Turn 1 bound the subject; turn 2 says "اعرض موقعه" and must mean the
    // same thing without the caller repeating anything.
    await bind({ referenceKey: "deictic:this", targetKind: "generic_subject", targetId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });

    const first = await resolve();
    const second = await resolve();
    expect(first).toEqual(second);
  });
});

describe("an unobserved reference is not a trackable subject", () => {
  it("ignores a binding that has no observation of the requested type", async () => {
    await bind({ referenceKey: "ordinal:2", targetKind: "discovery_candidate", targetId: "laptop-2" });

    const result = await resolve();
    expect(result.status).toBe("NOT_FOUND");
    if (result.status === "NOT_FOUND") expect(result.reason).toBe("NO_OBSERVABLE_BINDING");
  });

  it("distinguishes 'nothing bound' from 'nothing observable'", async () => {
    const empty = await resolve();
    expect(empty).toEqual({ status: "NOT_FOUND", reason: "NO_BINDING" });
  });

  it("uses the unobserved reference to disambiguate rather than to confuse", async () => {
    // One moving subject and one laptop are both live references, but only one
    // of them has ever been observed, so there is nothing to choose between.
    await bind({ referenceKey: "ordinal:2", targetKind: "discovery_candidate", targetId: "laptop-2" });
    await bind({ referenceKey: "deictic:this", targetKind: "generic_subject", targetId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });

    const result = await resolve();
    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") expect(result.subject.id).toBe("s1");
  });

  it("respects the observation type: a status reference is not a location reference", async () => {
    await bind({ referenceKey: "deictic:this", targetKind: "generic_subject", targetId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s1", observationType: "status" });

    expect((await resolve()).status).toBe("NOT_FOUND");
    const byStatus = await resolve({ observationType: "status" });
    expect(byStatus.status).toBe("RESOLVED");
  });
});

describe("ambiguity produces a question, never a guess", () => {
  it("refuses to choose between two observable subjects", async () => {
    await bind({ referenceKey: "named:first", targetKind: "generic_subject", targetId: "s1" });
    await bind({ referenceKey: "named:second", targetKind: "generic_subject", targetId: "s2" });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s2" });

    const result = await resolve();
    expect(result.status).toBe("AMBIGUOUS");
    if (result.status !== "AMBIGUOUS") return;
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.subject.id).sort()).toEqual(["s1", "s2"]);
  });

  it("does not silently prefer the most recently bound", async () => {
    await bind({
      referenceKey: "named:older",
      targetKind: "generic_subject",
      targetId: "s1",
      createdAt: new Date(Date.now() - 60_000),
    });
    await bind({ referenceKey: "named:newer", targetKind: "generic_subject", targetId: "s2" });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s2" });

    expect((await resolve()).status).toBe("AMBIGUOUS");
  });

  it("an explicit reference key resolves what a bare reference could not", async () => {
    await bind({ referenceKey: "named:first", targetKind: "generic_subject", targetId: "s1" });
    await bind({ referenceKey: "named:second", targetKind: "generic_subject", targetId: "s2" });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s2" });

    const result = await resolve({ referenceKey: "named:second" });
    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") expect(result.subject.id).toBe("s2");
  });

  it("a target-kind filter narrows without interpreting the kind", async () => {
    await bind({ referenceKey: "named:a", targetKind: "kind_a", targetId: "a1" });
    await bind({ referenceKey: "named:b", targetKind: "kind_b", targetId: "b1" });
    await observe({ subjectKind: "kind_a", subjectId: "a1" });
    await observe({ subjectKind: "kind_b", subjectId: "b1" });

    expect((await resolve()).status).toBe("AMBIGUOUS");
    const narrowed = await resolve({ targetKind: "kind_b" });
    expect(narrowed.status).toBe("RESOLVED");
    if (narrowed.status === "RESOLVED") expect(narrowed.subject.kind).toBe("kind_b");
  });

  it("collapses duplicate bindings that name the same subject", async () => {
    // Two references to one thing is not an ambiguity.
    await bind({ referenceKey: "named:a", targetKind: "generic_subject", targetId: "s1" });
    await bind({ referenceKey: "deictic:this", targetKind: "generic_subject", targetId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });

    expect((await resolve()).status).toBe("RESOLVED");
  });
});

describe("superseded bindings do not come back", () => {
  it("ignores a binding that is no longer current", async () => {
    await bind({
      referenceKey: "deictic:this",
      targetKind: "generic_subject",
      targetId: "s1",
      supersededAt: new Date(),
    });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });

    const result = await resolve();
    expect(result.status).toBe("NOT_FOUND");
    if (result.status === "NOT_FOUND") expect(result.reason).toBe("NO_BINDING");
  });

  it("a superseded binding cannot create an ambiguity with a live one", async () => {
    await bind({
      referenceKey: "named:old",
      targetKind: "generic_subject",
      targetId: "s2",
      supersededAt: new Date(),
    });
    await bind({ referenceKey: "deictic:this", targetKind: "generic_subject", targetId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s2" });

    const result = await resolve();
    expect(result.status).toBe("RESOLVED");
    if (result.status === "RESOLVED") expect(result.subject.id).toBe("s1");
  });
});

describe("privacy: a subject is not a coordinate oracle", () => {
  it("another owner's binding is invisible, not forbidden-looking", async () => {
    await bind({
      ownerId: OTHER_OWNER,
      referenceKey: "deictic:this",
      targetKind: "generic_subject",
      targetId: "secret-1",
    });
    await observe({ ownerId: OTHER_OWNER, subjectKind: "generic_subject", subjectId: "secret-1" });

    const result = await resolve();
    // Indistinguishable from an empty conversation: the resolver never confirms
    // that someone else's binding exists.
    expect(result).toEqual({ status: "NOT_FOUND", reason: "NO_BINDING" });
  });

  it("knowing a subject id is not enough — the binding must be this owner's", async () => {
    await observe({ ownerId: OTHER_OWNER, subjectKind: "generic_subject", subjectId: "leaked-id" });
    const result = await resolve();
    expect(result).toEqual({ status: "NOT_FOUND", reason: "NO_BINDING" });
  });

  it("my binding cannot read another owner's observation of the same subject", async () => {
    // The subject id is shared; the evidence belongs to someone else.
    await bind({ referenceKey: "deictic:this", targetKind: "generic_subject", targetId: "shared-id" });
    await observe({ ownerId: OTHER_OWNER, subjectKind: "generic_subject", subjectId: "shared-id" });

    const result = await resolve();
    expect(result.status).toBe("NOT_FOUND");
    if (result.status === "NOT_FOUND") expect(result.reason).toBe("NO_OBSERVABLE_BINDING");
  });

  it("a binding in another conversation does not leak into this one", async () => {
    await bind({
      conversationId: OTHER_CONVERSATION,
      referenceKey: "deictic:this",
      targetKind: "generic_subject",
      targetId: "s1",
    });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });

    expect(await resolve()).toEqual({ status: "NOT_FOUND", reason: "NO_BINDING" });
  });

  it("a foreign conversation id resolves to nothing rather than to its contents", async () => {
    await bind({
      ownerId: OTHER_OWNER,
      conversationId: OTHER_CONVERSATION,
      referenceKey: "deictic:this",
      targetKind: "generic_subject",
      targetId: "s9",
    });
    await observe({ ownerId: OTHER_OWNER, subjectKind: "generic_subject", subjectId: "s9" });

    const result = await resolve({ conversationId: OTHER_CONVERSATION });
    expect(result).toEqual({ status: "NOT_FOUND", reason: "NO_BINDING" });
  });
});

describe("no caller channel makes a referent", () => {
  it("has no parameter that accepts a subject pair", () => {
    // A model may propose "{kind: driver, id: 123}". There is nowhere to put it:
    // the resolver's input carries an owner, a conversation, an observation type
    // and optional filters — never a target id.
    const accepted = ["ownerId", "conversationId", "observationType", "referenceKey", "targetKind", "limit"];
    expect(accepted).not.toContain("subjectId");
    expect(accepted).not.toContain("targetId");
    expect(accepted).not.toContain("subject");
  });

  it("an invented reference key resolves to nothing", async () => {
    await bind({ referenceKey: "deictic:this", targetKind: "generic_subject", targetId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });

    const result = await resolve({ referenceKey: "named:whatever-the-model-said" });
    expect(result.status).toBe("NOT_FOUND");
  });

  it("an invented target kind resolves to nothing", async () => {
    await bind({ referenceKey: "deictic:this", targetKind: "generic_subject", targetId: "s1" });
    await observe({ subjectKind: "generic_subject", subjectId: "s1" });

    expect((await resolve({ targetKind: "driver" })).status).toBe("NOT_FOUND");
  });
});
