/**
 * JASIM — WHO MAY SPEAK FOR THIS THING?
 *
 *   NEW SUBJECT KIND != NEW DOMAIN
 *   ARBITRARY SUBJECT ID != AUTHORITY · MODEL-NAMED ACTOR != AUTHORITY
 *   AUTHORITY_TO_ANSWER != AUTHORITY_TO_MUTATE
 *   LIVING_OBJECT != SUBJECT_AUTHORITY
 *
 * The previous phase proved a person can answer about any SEMANTIC kind of
 * offering. This proves the stronger thing: authority is derived from the
 * canonical subject itself, across kinds whose ownership shapes genuinely
 * differ — one owner, a capacity owner, two sides, and many parties.
 *
 * Nothing here is wrapped in an offering to make it work.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let authority: typeof import("../../api/runtime/subject-authority");
let verification: typeof import("../../api/runtime/counterparty-verification");
let fabric: typeof import("../../api/runtime/economic-fabric");

const T0 = new Date("2026-09-24T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

describe("authority comes from the canonical subject", () => {
  let supplier: typeof users.$inferSelect;
  let requester: typeof users.$inferSelect;
  let outsider: typeof users.$inferSelect;
  let supplierScope: string;
  let requesterScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    authority = await import("../../api/runtime/subject-authority");
    verification = await import("../../api/runtime/counterparty-verification");
    fabric = await import("../../api/runtime/economic-fabric");
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE verification_requests, observations, economic_expressions,
        availability_windows, reservations, transactions, commitments, agreements,
        living_objects, memberships, organizations, scope_policies CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'sa-%'`));
    const made = [] as (typeof users.$inferSelect)[];
    for (const name of ["مورد", "طالب", "خارجي"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `sa-${randomUUID()}`, name, preferences: {} }).returning();
      made.push(row!);
    }
    [supplier, requester, outsider] = made as [typeof supplier, typeof requester, typeof outsider];
    supplierScope = String(supplier.id);
    requesterScope = String(requester.id);
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Canonical subjects, each built through ITS OWN table ──────────────────

  async function anOffering() {
    const expression = await fabric.createExpression({
      ownerId: supplierScope, kind: "offering", semanticType: "generic.unit",
      attributes: { priceMinor: "2500" },
    });
    await fabric.publishExpression({
      id: expression.id, ownerId: supplierScope,
      projection: { semanticType: "generic.unit", summary: "عرض" },
    });
    return expression.id;
  }

  /** A window of capacity. No offering anywhere near it. */
  async function aCapacityWindow() {
    const id = `awn_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO availability_windows (id, "ownerId", "resourceKind", "resourceId",
        "startsAt", "endsAt", "capacityTotal", unit, state, "createdAt", "updatedAt")
        VALUES ('${id}', '${supplierScope}', 'capacity', 'r1',
        '${T0.toISOString()}', '${at(3600_000).toISOString()}', 5, 'unit', 'open', now(), now())`),
    );
    return id;
  }

  /** A held claim: a requester on one side, a capacity owner on the other. */
  async function aReservation() {
    const id = `res_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO reservations (id, "ownerId", "resourceOwnerId", "resourceKind",
        "resourceId", quantity, unit, status, version, "idempotencyKey", "createdAt", "updatedAt")
        VALUES ('${id}', '${requesterScope}', '${supplierScope}', 'capacity', 'r1',
        1, 'unit', 'HELD', 1, 'idem_${randomUUID().slice(0, 8)}', now(), now())`),
    );
    return id;
  }

  /** An exchange with parties, none of them privileged. */
  async function aTransaction() {
    const id = `txn_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO transactions (id, "scopeId", parties, "agreementId",
        "termsSnapshot", "termsDigest", state, "createdAt", "updatedAt")
        VALUES ('${id}', '${requesterScope}',
        '["${requesterScope}","${supplierScope}"]', 'agr_x', '{}', 'digest',
        'OPEN', now(), now())`),
    );
    return id;
  }

  const count = async (table: string) => {
    const rows = await handle.db.execute(sql.raw(`SELECT count(*)::int n FROM ${table}`));
    return (rows.rows[0] as { n: number }).n;
  };

  // ── A · FOUR OWNERSHIP SHAPES, ONE MECHANISM ──────────────────────────────

  it("one owner: an offering is spoken for by whoever published it", async () => {
    const subject = await anOffering();
    const resolved = await authority.subjectAuthority({
      subjectKind: "offering", subjectId: subject, property: "availability",
    });
    expect(resolved!.scopeIds).toEqual([supplierScope]);
    expect(resolved!.roles).toEqual(["SUBJECT_OWNER"]);
  });

  it("a capacity owner: a window is spoken for by whoever offers it", async () => {
    //   RESOURCE_VERIFICATION_REQUIRES_FAKE_OFFERING = 0
    const subject = await aCapacityWindow();
    const resolved = await authority.subjectAuthority({
      subjectKind: "availability_window", subjectId: subject, property: "availability",
    });
    expect(resolved!.scopeIds).toEqual([supplierScope]);
    expect(resolved!.roles).toEqual(["CAPACITY_OWNER"]);
    // Nothing was published to make this work.
    expect(await count("economic_expressions")).toBe(0);
  });

  it("two sides: who may answer depends on WHICH fact is asked", async () => {
    //   AUTHORITY DEPENDS ON THE FACT · RESERVATION_VERIFICATION_REQUIRES_FAKE_OFFERING = 0
    const subject = await aReservation();
    // Whether the capacity still stands is the supplying side's to say…
    const supply = await authority.subjectAuthority({
      subjectKind: "reservation", subjectId: subject, property: "availability",
    });
    expect(supply!.scopeIds).toEqual([supplierScope]);
    // …and whether they still intend to use it is the requesting side's.
    const intent = await authority.subjectAuthority({
      subjectKind: "reservation", subjectId: subject, property: "attendance",
    });
    expect(intent!.scopeIds).toEqual([requesterScope]);
    // Neither can answer for the other.
    expect(supply!.scopeIds).not.toEqual(intent!.scopeIds);
    expect(await count("economic_expressions")).toBe(0);
  });

  it("many parties: an exchange may be asked of any party to it", async () => {
    const subject = await aTransaction();
    const resolved = await authority.subjectAuthority({
      subjectKind: "transaction", subjectId: subject, property: "fulfillment",
    });
    expect([...resolved!.scopeIds].sort()).toEqual([requesterScope, supplierScope].sort());
    expect(resolved!.roles).toEqual(["PARTICIPANT"]);
  });

  it("a party may be ASKED without their answer being true", async () => {
    //   TRANSACTION_PARTICIPANT_RESPONSE_AUTO_VERIFIED = 0
    const subject = await aTransaction();
    const asked = await verification.requireCounterpartyEvidence({
      fact: { subjectKind: "transaction", subjectId: subject, property: "fulfillment" },
      purpose: "COMMIT", requestingScopeId: requesterScope, now: at(MINUTE),
    });
    expect(asked.status).toBe("REQUESTED");
    const request = asked.status === "REQUESTED" ? asked.request : null;
    const answered = await verification.answerVerificationRequest({
      requestId: request!.id, respondingPrincipalId: request!.respondingScopeId,
      assertion: "AFFIRMED", now: at(2 * MINUTE),
    });
    // It is recorded as what THEY said. Nothing about the transaction moved.
    const rows = await handle.db.execute(sql.raw(`SELECT "sourceKind" FROM observations`));
    expect((rows.rows[0] as { sourceKind: string }).sourceKind).toBe("counterparty_confirm");
    const txn = await handle.db.execute(
      sql.raw(`SELECT state FROM transactions WHERE id = '${subject}'`),
    );
    expect((txn.rows[0] as { state: string }).state).toBe("OPEN");
    expect(await count("commitments")).toBe(0);
    expect(answered.request.state).toBe("ANSWERED");
  });

  // ── B · THE WHOLE PATH, WITHOUT AN OFFERING ANYWHERE ──────────────────────

  it("a capacity window is asked about end to end, with no offering created", async () => {
    const subject = await aCapacityWindow();
    const asked = await verification.requireCounterpartyEvidence({
      fact: { subjectKind: "availability_window", subjectId: subject, property: "availability",
        quantity: 2 },
      purpose: "COMMIT", requestingScopeId: requesterScope, now: at(MINUTE),
    });
    expect(asked.status).toBe("REQUESTED");
    const request = asked.status === "REQUESTED" ? asked.request : null;
    expect(request!.respondingScopeId).toBe(supplierScope);

    const answered = await verification.answerVerificationRequest({
      requestId: request!.id, respondingPrincipalId: supplierScope,
      assertion: "AFFIRMED", now: at(2 * MINUTE),
    });
    expect(answered.decision.verdict).toBe("SUFFICIENT");
    expect(await count("economic_expressions")).toBe(0);
  });

  // ── C · WHAT CONFERS NOTHING ──────────────────────────────────────────────

  it("holding a handle to something does not let you answer for it", async () => {
    //   LIVING_OBJECT_REFERENCE_GRANTS_ANSWER_AUTHORITY = 0
    const subject = await aTransaction();
    await handle.db.execute(
      sql.raw(`INSERT INTO living_objects (id, "scopeId", "subjectKind", "subjectId",
        "followState", "surfaceState", "materializedBy", reason, "createdAt", "updatedAt")
        VALUES ('lo_${randomUUID().slice(0, 16)}', '${outsider.id}', 'transaction',
        '${subject}', 'FOLLOWING', 'VISIBLE', '${outsider.id}', 'OBLIGATION_CREATED',
        now(), now())`),
    );
    // A handle is not a subject anybody speaks for…
    expect(await authority.subjectAuthority({
      subjectKind: "living_object", subjectId: "lo_anything", property: "availability",
    })).toBeNull();
    // …and holding one over a transaction confers nothing about the transaction.
    const resolved = await authority.subjectAuthority({
      subjectKind: "transaction", subjectId: subject, property: "fulfillment",
    });
    expect(resolved!.scopeIds).not.toContain(String(outsider.id));
  });

  it("acceptance is never a question, so those kinds have no source at all", async () => {
    //   VERIFICATION_AUTHORITY_BYPASSES_AGREEMENT_RUNTIME = 0
    for (const kind of ["agreement", "proposal", "commitment", "living_object"]) {
      expect(await authority.subjectAuthority({
        subjectKind: kind, subjectId: "anything", property: "availability",
      }), kind).toBeNull();
      expect(authority.NOT_VERIFIABLE_BY_DESIGN[kind], kind).toBeTruthy();
    }
    // And the registry lists only structural kinds — never a business noun.
    for (const kind of authority.verifiableSubjectKinds()) {
      for (const noun of ["car", "shirt", "garment", "restaurant", "translator",
        "machine", "storage", "venue", "food"]) {
        expect(kind, `${kind} names ${noun}`).not.toContain(noun);
      }
    }
  });

  it("a subject kind nobody speaks for is refused rather than guessed", async () => {
    //   UNKNOWN_SUBJECT_KIND_GUESSES_AUTHORITY = 0
    const out = await verification.requireCounterpartyEvidence({
      fact: { subjectKind: "something.unheard.of", subjectId: "x", property: "availability" },
      purpose: "COMMIT", requestingScopeId: requesterScope, now: at(MINUTE),
    });
    expect(out.status).toBe("NO_AUTHORIZED_SOURCE");
    expect(await count("verification_requests")).toBe(0);
  });

  it("a subject id that names nothing produces no authority", async () => {
    //   ARBITRARY SUBJECT ID != AUTHORITY
    for (const kind of authority.verifiableSubjectKinds()) {
      expect(await authority.subjectAuthority({
        subjectKind: kind, subjectId: `made-up-${randomUUID()}`, property: "availability",
      }), kind).toBeNull();
    }
  });

  // ── D · CROSS-SCOPE ───────────────────────────────────────────────────────

  it("somebody with no standing in the subject cannot answer any of them", async () => {
    //   CROSS_SCOPE_SUBJECT_AUTHORITY = 0
    const cases: [string, string][] = [
      ["offering", await anOffering()],
      ["availability_window", await aCapacityWindow()],
      ["reservation", await aReservation()],
      ["transaction", await aTransaction()],
    ];
    for (const [subjectKind, subjectId] of cases) {
      const asked = await verification.requireCounterpartyEvidence({
        fact: { subjectKind, subjectId, property: "availability" },
        purpose: "COMMIT", requestingScopeId: requesterScope, now: at(MINUTE),
      });
      if (asked.status !== "REQUESTED") continue;
      await expect(
        verification.answerVerificationRequest({
          requestId: asked.request.id, respondingPrincipalId: String(outsider.id),
          assertion: "AFFIRMED", now: at(2 * MINUTE),
        }),
        subjectKind,
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await count("observations")).toBe(0);
  });

  it("the requesting side of a reservation cannot answer for the supplying side", async () => {
    //   AUTHORITY_TO_ANSWER != AUTHORITY_TO_MUTATE — and not each other's either.
    const subject = await aReservation();
    const asked = await verification.requireCounterpartyEvidence({
      fact: { subjectKind: "reservation", subjectId: subject, property: "availability" },
      purpose: "COMMIT", requestingScopeId: requesterScope, now: at(MINUTE),
    });
    const request = asked.status === "REQUESTED" ? asked.request : null;
    expect(request!.respondingScopeId).toBe(supplierScope);
    // The requester holds the reservation and still may not say whether the
    // capacity stands.
    await expect(
      verification.answerVerificationRequest({
        requestId: request!.id, respondingPrincipalId: requesterScope,
        assertion: "AFFIRMED", now: at(2 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── E · ANSWERING IS NOT MUTATING ─────────────────────────────────────────

  it("the resolver grants nothing and changes nothing", async () => {
    //   AUTHORITY_TO_ANSWER != AUTHORITY_TO_MUTATE
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/subject-authority.ts", "utf8"),
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    // It reads. It never writes, and it never consults a mutation permission.
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(source).not.toMatch(/authorizeScopeAction|evaluatePolicies|requirePermission/);
    for (const noun of ["car", "shirt", "garment", "restaurant", "translator",
      "machine", "storage", "venue"]) {
      expect(source.toLowerCase(), `branches on ${noun}`)
        .not.toMatch(new RegExp(`\\b${noun}s?\\b`));
    }
  });

  it("confirming capacity reserves, agrees and commits nothing", async () => {
    const subject = await aCapacityWindow();
    const asked = await verification.requireCounterpartyEvidence({
      fact: { subjectKind: "availability_window", subjectId: subject, property: "availability" },
      purpose: "COMMIT", requestingScopeId: requesterScope, now: at(MINUTE),
    });
    await verification.answerVerificationRequest({
      requestId: (asked.status === "REQUESTED" ? asked.request : null)!.id,
      respondingPrincipalId: supplierScope, assertion: "AFFIRMED", now: at(2 * MINUTE),
    });
    for (const table of ["reservations", "agreements", "commitments", "transactions"]) {
      expect(await count(table), table).toBe(0);
    }
  });
});
