/**
 * JASIM — «سيارتي تعطلت. ابحث عن مكانيكي، وإن وافقتُ أرسل له موقعي.»
 *
 * ─── WHY THIS FILE IS ONE STORY AND NOT A FEATURE ───────────────────────────
 *
 * It is an ACCEPTANCE PROBE, not a specification. Nothing below adds a
 * MechanicAgent, a RoadsideRuntime or a LocationSharing service. Every step
 * runs through the same primitives a storage request, a seabed survey or a
 * wedding photographer would use — and the last test proves exactly that by
 * running the whole chain again for five unrelated subjects.
 *
 *   NEW EXAMPLE != NEW FEATURE FAMILY · DOMAIN_DISCLOSURE_TYPES_ADDED = 0
 *
 * ─── THE TWO GAPS IT FOUND ──────────────────────────────────────────────────
 *
 * **1. «قريب» never reached the search.**
 * Proximity lived on the MATCHING side alone: `withDerivedDistance` computed a
 * great-circle distance between a need and an offering, and `discover` had no
 * idea where anybody was. So «ابحث عن مكانيكي» could not prefer, let alone
 * require, one who is actually close. Discovery is where the candidate list
 * comes from, so the filter that mattered was the one that did not exist.
 *
 *   PROXIMITY_IS_A_NEW_CONSTRAINT_KIND = 0 — «within 25 km» is a bound on the
 *   derived `distance`, in the same evaluator, through the same unit table.
 *
 * **2. Nothing could tell the mechanic where to come.**
 * A precise point never enters a public projection, and that is correct:
 *
 *   EXACT_COORDINATES_IN_A_PUBLIC_PROJECTION = 0
 *
 * But traced before this phase, NO module released a private field to a
 * counterparty under any authority. The chain ran to its end — found, asked,
 * proposed, agreed — and stopped at the step that makes it useful.
 *
 *   AGREEMENT_IS_THE_DISCLOSURE_AUTHORITY
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { economicExpressions } from "@db/schema";
import { privateDisclosures } from "@db/schema-block2";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let agreementRuntime: typeof import("../../api/runtime/agreement-runtime");
let disclosure: typeof import("../../api/runtime/private-disclosure");
let discover: typeof import("../../api/runtime/block31").discover;
let translateConstraints: typeof import("../../api/runtime/need-continuity").translateConstraints;

const DRIVER = "stranded-driver";
const NEAR = "mechanic-near";
const FAR = "mechanic-far";
const SILENT = "mechanic-no-location";
const OUTSIDER = "passer-by";

/** Where the car stopped, and three workshops. Strings live only in this file. */
const ROADSIDE = { lat: 31.9539, lng: 35.9106 };
const NEARBY = { lat: 31.9800, lng: 35.9400 };   // ~4 km
const DISTANT = { lat: 32.5556, lng: 35.8500 };  // ~68 km

const SERVICE = "mobile repair call-out";

describe("a stranded driver, end to end, with no runtime of their own", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    fabric = await import("../../api/runtime/economic-fabric");
    agreementRuntime = await import("../../api/runtime/agreement-runtime");
    disclosure = await import("../../api/runtime/private-disclosure");
    ({ discover } = await import("../../api/runtime/block31"));
    ({ translateConstraints } = await import("../../api/runtime/need-continuity"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  async function workshop(input: {
    ownerId: string;
    at?: { lat: number; lng: number };
    inferredLocation?: boolean;
    semanticType?: string;
  }) {
    const expression = await fabric.createExpression({
      ownerId: input.ownerId,
      kind: "offering",
      semanticType: input.semanticType ?? SERVICE,
      attributes: {
        ...(input.at ? { location: input.at } : {}),
        responseWindow: 2,
        responseWindowUnit: "hour",
      },
      ...(input.inferredLocation ? { attributeProvenance: { location: "INFERRED" as const } } : {}),
    });
    await fabric.publishExpression({
      id: expression.id,
      ownerId: input.ownerId,
      projection: {
        semanticType: input.semanticType ?? SERVICE,
        summary: input.semanticType ?? SERVICE,
      },
    });
    return expression;
  }

  /** The driver's own need, holding the point that must not leak. */
  async function breakdown(semanticType = SERVICE) {
    return fabric.createExpression({
      ownerId: DRIVER,
      kind: "need",
      semanticType,
      attributes: {
        location: ROADSIDE,
        symptom: "will not start after a noise",
      },
      hardConstraints: [{ field: "distance", operator: "lte", value: 25, unit: "km" }],
    });
  }

  const search = async (
    constraints: Array<Record<string, unknown>>,
    semanticType = SERVICE,
    origin: { lat: number; lng: number; inferred?: boolean } | undefined = ROADSIDE,
  ) =>
    discover(handle.db, {
      ownerId: DRIVER,
      conversationId: `breakdown-${randomUUID()}`,
      query: semanticType,
      kind: "offering",
      explicitScope: "INTERNAL",
      availability: { internal: true, web: false },
      hardConstraints: constraints as never,
      ...(origin ? { origin } : {}),
    });

  const within = (km: number) =>
    translateConstraints([
      {
        dimension: "LOCATION", operator: "AT_MOST", value: km, unit: "km",
        hardness: "HARD", source: "STATED",
      },
    ] as never).applied as Array<Record<string, unknown>>;

  // ── 1. «ابحث عن مكانيكي» MEANS A NEARBY ONE ────────────────────────────────

  it("«within 25 km» is a bound on a distance, not on a coordinate pair", () => {
    //   PROXIMITY_IS_A_NEW_CONSTRAINT_KIND = 0
    //
    // Naming the field `location` would have compared 25 against a {lat,lng},
    // which is not a comparison. It becomes the derived quantity instead.
    expect(within(25)).toEqual([
      { field: "distance", operator: "max", value: 25, unit: "km" },
    ]);
  });

  it("the search returns the nearby workshop and not the distant one", async () => {
    const near = await workshop({ ownerId: NEAR, at: NEARBY });
    const far = await workshop({ ownerId: FAR, at: DISTANT });

    const found = await search(within(25));
    const refs = found.candidates.map((candidate) => candidate.canonicalRef);
    expect(refs).toContain(near.id);
    expect(refs).not.toContain(far.id);
  });

  it("a workshop that never said where it is stays unknown, not far", async () => {
    //   MISSING_POINT_IS_UNKNOWN_NOT_FAR
    //
    // No distance is derived at all — never a large one — so the silence is
    // not read as «68 km away». UNKNOWN is simply not a hard match, and the
    // brokering path is where somebody asks.
    const silent = await workshop({ ownerId: SILENT });
    const found = await search(within(25));
    expect(found.candidates.map((entry) => entry.canonicalRef)).not.toContain(silent.id);

    // And with no distance bound at all it is an ordinary candidate again —
    // proving it was the missing point that was unknown, not the workshop.
    const unbounded = await search([]);
    expect(unbounded.candidates.map((entry) => entry.canonicalRef)).toContain(silent.id);
  });

  it("a point a model read off a photo decides no proximity", async () => {
    //   INFERRED_LOCATION_DECIDES_PROXIMITY = 0
    const guessedNearby = await workshop({ ownerId: NEAR, at: NEARBY, inferredLocation: true });
    const found = await search(within(25));
    // It would have PASSED. A guess that admits is as wrong as one that
    // excludes, and it costs the person who was never asked.
    expect(found.candidates.map((entry) => entry.canonicalRef)).not.toContain(guessedNearby.id);
  });

  it("searching near somebody tells nobody where they are", async () => {
    //   SEARCHING_NEAR_SOMEBODY_DISCLOSES_NOTHING = 0
    const near = await workshop({ ownerId: NEAR, at: NEARBY });
    const found = await search(within(25));
    const serialized = JSON.stringify(found);
    expect(serialized).not.toContain(String(ROADSIDE.lat));
    expect(serialized).not.toContain(String(ROADSIDE.lng));
    // Nor the workshop's own point back to the driver.
    expect(serialized).not.toContain(String(NEARBY.lat));
    expect(found.candidates.map((entry) => entry.canonicalRef)).toContain(near.id);
  });

  // ── 2. ASK, AGREE, AND ONLY THEN SAY WHERE ─────────────────────────────────

  /** need → match → engagement → proposal → agreement. All existing. */
  async function agreeWith(mechanicOwnerId: string, offeringId: string, needId: string) {
    const match = await fabric.matchNeedToOffering({
      needId, offeringId, createdByOwnerId: DRIVER,
    });
    const engagement = await fabric.createEngagement({
      matchId: match.id,
      initiatorOwnerId: DRIVER,
      participants: [DRIVER, mechanicOwnerId],
    });
    // The mechanic states what they will do and how long it takes. JASIM
    // carries it; it does not invent it.
    const proposal = await agreementRuntime.proposeTermSheet({
      engagementId: engagement.id,
      proposerOwnerId: mechanicOwnerId,
      terms: [
        { key: "callOutFee", kind: "NUMBER", value: 25, unit: "KWD", direction: "LOWER_IS_BETTER" },
        { key: "arrivalWithin", kind: "NUMBER", value: 2, unit: "hour", direction: "LOWER_IS_BETTER" },
      ],
    });
    // The DRIVER accepts. A party cannot agree to its own proposal.
    const committed = await agreementRuntime.commitAgreement({
      proposalId: proposal.id,
      ownerId: DRIVER,
      // A direct acceptance records the person who made it. JASIM never
      // accepts on somebody's behalf without saying whose act it was.
      ownerDirect: true,
      principalId: DRIVER,
    });
    return { engagement, proposal, agreement: committed.agreement };
  }

  it("before any agreement, nobody can be told where the car is", async () => {
    const near = await workshop({ ownerId: NEAR, at: NEARBY });
    const need = await breakdown();

    // An engagement exists — they are talking — and talking is not permission.
    const match = await fabric.matchNeedToOffering({
      needId: need.id, offeringId: near.id, createdByOwnerId: DRIVER,
    });
    const engagement = await fabric.createEngagement({
      matchId: match.id, initiatorOwnerId: DRIVER, participants: [DRIVER, NEAR],
    });
    expect(engagement.id).toBeTruthy();

    const read = await disclosure.readDisclosedField(handle.db, {
      recipientOwnerId: NEAR,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      field: "location",
    });
    expect(read.status).toBe("NOT_DISCLOSED");
  });

  it("once the driver accepts, the driver releases the point — and only then", async () => {
    const near = await workshop({ ownerId: NEAR, at: NEARBY });
    const need = await breakdown();
    const { agreement } = await agreeWith(NEAR, near.id, need.id);

    const released = await disclosure.discloseToCounterparty(handle.db, {
      agreementId: agreement.id,
      discloserOwnerId: DRIVER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      field: "location",
    });
    expect(released.recipientOwnerId).toBe(NEAR);

    const read = await disclosure.readDisclosedField(handle.db, {
      recipientOwnerId: NEAR,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      field: "location",
    });
    expect(read.status).toBe("RELEASED");
    expect(read.status === "RELEASED" && read.value).toEqual(ROADSIDE);
  });

  it("a release tells one person, and changes nothing public", async () => {
    //   DISCLOSED != PUBLISHED
    const near = await workshop({ ownerId: NEAR, at: NEARBY });
    const need = await breakdown();
    const { agreement } = await agreeWith(NEAR, near.id, need.id);
    const [before] = await handle.db
      .select().from(economicExpressions).where(eq(economicExpressions.id, need.id));

    await disclosure.discloseToCounterparty(handle.db, {
      agreementId: agreement.id,
      discloserOwnerId: DRIVER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      field: "location",
    });

    const [after] = await handle.db
      .select().from(economicExpressions).where(eq(economicExpressions.id, need.id));
    expect(after!.publicProjection).toEqual(before!.publicProjection);
    expect(after!.visibility).toBe(before!.visibility);
    expect(JSON.stringify(after!.publicProjection ?? {})).not.toContain(String(ROADSIDE.lat));

    // And somebody who agreed to nothing learns nothing.
    const outsider = await disclosure.readDisclosedField(handle.db, {
      recipientOwnerId: OUTSIDER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      field: "location",
    });
    expect(outsider.status).toBe("NOT_DISCLOSED");
  });

  it("only the owner releases, and only what is actually there", async () => {
    const near = await workshop({ ownerId: NEAR, at: NEARBY });
    const need = await breakdown();
    const { agreement } = await agreeWith(NEAR, near.id, need.id);

    //   MODEL_DISCLOSES = 0 — and so does the counterparty.
    await expect(
      disclosure.discloseToCounterparty(handle.db, {
        agreementId: agreement.id,
        discloserOwnerId: NEAR,
        subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
        subjectId: need.id,
        field: "location",
      }),
    ).rejects.toThrow(/owner/i);

    //   DISCLOSING_WHAT_IS_NOT_THERE = 0
    await expect(
      disclosure.discloseToCounterparty(handle.db, {
        agreementId: agreement.id,
        discloserOwnerId: DRIVER,
        subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
        subjectId: need.id,
        field: "doorCode",
      }),
    ).rejects.toThrow(/holds no/i);

    // And a stranger to the agreement releases nothing at all.
    await expect(
      disclosure.discloseToCounterparty(handle.db, {
        agreementId: agreement.id,
        discloserOwnerId: OUTSIDER,
        subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
        subjectId: need.id,
        field: "location",
      }),
    ).rejects.toThrow(/party/i);
  });

  it("telling the same person twice is one disclosure, not two", async () => {
    const near = await workshop({ ownerId: NEAR, at: NEARBY });
    const need = await breakdown();
    const { agreement } = await agreeWith(NEAR, near.id, need.id);
    const args = {
      agreementId: agreement.id,
      discloserOwnerId: DRIVER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      field: "location",
    };
    const first = await disclosure.discloseToCounterparty(handle.db, args);
    const again = await disclosure.discloseToCounterparty(handle.db, args);
    expect(again.id).toBe(first.id);
    const rows = await handle.db
      .select().from(privateDisclosures).where(eq(privateDisclosures.subjectId, need.id));
    expect(rows).toHaveLength(1);
  });

  it("a disclosure is permission to look, not a copy taken at the time", async () => {
    //   DISCLOSURE_IS_PERMISSION_TO_LOOK, NOT A COPY
    //
    // The car gets towed. The mechanic reads where it is NOW, because nothing
    // was snapshotted — and a withdrawal can therefore really stop the reading.
    const near = await workshop({ ownerId: NEAR, at: NEARBY });
    const need = await breakdown();
    const { agreement } = await agreeWith(NEAR, near.id, need.id);
    await disclosure.discloseToCounterparty(handle.db, {
      agreementId: agreement.id,
      discloserOwnerId: DRIVER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      field: "location",
    });

    const moved = { lat: 31.9000, lng: 35.8000 };
    await handle.db
      .update(economicExpressions)
      .set({ attributes: { location: moved, symptom: "will not start after a noise" } })
      .where(eq(economicExpressions.id, need.id));

    const read = await disclosure.readDisclosedField(handle.db, {
      recipientOwnerId: NEAR,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      field: "location",
    });
    expect(read.status === "RELEASED" && read.value).toEqual(moved);
  });

  it("withdrawing stops the reading and never claims they forgot", async () => {
    //   AGREEMENT_ENDS != DISCLOSURE_UNHAPPENS
    const near = await workshop({ ownerId: NEAR, at: NEARBY });
    const need = await breakdown();
    const { agreement } = await agreeWith(NEAR, near.id, need.id);
    const released = await disclosure.discloseToCounterparty(handle.db, {
      agreementId: agreement.id,
      discloserOwnerId: DRIVER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      field: "location",
    });

    // A recipient cannot erase the record that they were told.
    await expect(
      disclosure.withdrawDisclosure(handle.db, { id: released.id, ownerId: NEAR }),
    ).rejects.toThrow(/discloser/i);

    await disclosure.withdrawDisclosure(handle.db, { id: released.id, ownerId: DRIVER });
    const read = await disclosure.readDisclosedField(handle.db, {
      recipientOwnerId: NEAR,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      field: "location",
    });
    expect(read.status).toBe("WITHDRAWN");

    // The ledger still says it happened.
    const ledger = await disclosure.disclosuresAbout(handle.db, {
      ownerId: DRIVER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      includeWithdrawn: true,
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.recipientOwnerId).toBe(NEAR);
    expect(ledger[0]!.withdrawnAt).not.toBeNull();
  });

  it("«who knows where I am» is answerable, and only to the person asking about themselves", async () => {
    const near = await workshop({ ownerId: NEAR, at: NEARBY });
    const need = await breakdown();
    const { agreement } = await agreeWith(NEAR, near.id, need.id);
    await disclosure.discloseToCounterparty(handle.db, {
      agreementId: agreement.id,
      discloserOwnerId: DRIVER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
      field: "location",
    });

    const mine = await disclosure.disclosuresAbout(handle.db, {
      ownerId: DRIVER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: need.id,
    });
    expect(mine.map((row) => row.recipientOwnerId)).toEqual([NEAR]);

    // A ledger anybody could read would be a second disclosure.
    await expect(
      disclosure.disclosuresAbout(handle.db, {
        ownerId: NEAR,
        subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
        subjectId: need.id,
      }),
    ).rejects.toThrow(/owner/i);
  });

  // ── 3. THE SAME CHAIN, FIVE UNRELATED WORLDS ───────────────────────────────

  it("the identical chain runs for five subjects that share nothing", async () => {
    //   NEW DOMAIN != NEW AGENT · DOMAIN_DISCLOSURE_TYPES_ADDED = 0
    //
    // Not one line below branches on what is being asked for. What changes is
    // the semanticType and the field being released — both data.
    const worlds: Array<{ semanticType: string; field: string; value: unknown }> = [
      { semanticType: "seabed survey line", field: "siteAccessNote", value: "gate 4, south jetty" },
      { semanticType: "artifact conservation", field: "humidityWindow", value: "45-50" },
      { semanticType: "on-site interpreting", field: "meetingPoint", value: { lat: 31.1, lng: 35.1 } },
      { semanticType: "machine hire", field: "yardCode", value: "8821" },
      { semanticType: "wedding coverage", field: "venueContact", value: "ask for Samir" },
    ];

    for (const world of worlds) {
      await resetBlock31(handle.db);
      const provider = await workshop({ ownerId: NEAR, at: NEARBY, semanticType: world.semanticType });
      const need = await fabric.createExpression({
        ownerId: DRIVER,
        kind: "need",
        semanticType: world.semanticType,
        attributes: { location: ROADSIDE, [world.field]: world.value },
      });

      // It is found because it is near.
      const found = await search(within(25), world.semanticType);
      expect(found.candidates.map((entry) => entry.canonicalRef), world.semanticType)
        .toContain(provider.id);

      // It is told, because an agreement says so.
      const { agreement } = await agreeWith(NEAR, provider.id, need.id);
      await disclosure.discloseToCounterparty(handle.db, {
        agreementId: agreement.id,
        discloserOwnerId: DRIVER,
        subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
        subjectId: need.id,
        field: world.field,
      });
      const read = await disclosure.readDisclosedField(handle.db, {
        recipientOwnerId: NEAR,
        subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
        subjectId: need.id,
        field: world.field,
      });
      expect(read.status, world.semanticType).toBe("RELEASED");
      expect(read.status === "RELEASED" && read.value).toEqual(world.value);
    }
  });

  it("no domain entered the disclosure module", () => {
    const source = readFileSync("api/runtime/private-disclosure.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .toLowerCase();
    for (const word of [
      "mechanic", "driver", "car", "vehicle", "roadside", "tow",
      "doctor", "courier", "restaurant", "hotel", "wedding",
    ]) {
      expect(source, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
    // And the field it releases is data, never an enumerated kind.
    expect(source).not.toMatch(/\bgps\b|\blatitude\b|\bcoordinates\b/);
  });
});
