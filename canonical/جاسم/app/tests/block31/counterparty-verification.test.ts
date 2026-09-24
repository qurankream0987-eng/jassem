/**
 * JASIM — ASK THE PERSON WHO KNOWS, ONCE, ABOUT ONE EXACT THING.
 *
 *   NO API != NO CAPABILITY · HUMAN RESPONSE != MAGIC TRUTH
 *   COUNTERPARTY_ASSERTION != SYSTEM_OBSERVATION · != VERIFIED_FACT
 *   QUESTION != PROPOSAL · AVAILABILITY_CONFIRMATION != RESERVATION
 *   AVAILABILITY != AUTHORITY · NO_RESPONSE != YES · NO_RESPONSE != NO
 *
 * Real PostgreSQL, real acting scopes, injected time. Nothing sleeps.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let verification: typeof import("../../api/runtime/counterparty-verification");
let sufficiency: typeof import("../../api/runtime/evidence-sufficiency");
let fabric: typeof import("../../api/runtime/economic-fabric");
let scopes: typeof import("../../api/runtime/actor-scope");
let membership: typeof import("../../api/runtime/block2/membership");

const T0 = new Date("2026-09-24T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

/** Seven structurally unrelated things. One of them appears nowhere else. */
const HOLDOUTS = [
  "garment.listing", "used.vehicle", "professional.hour", "machine.time",
  "venue.slot", "storage.capacity", "apiary.pollination_window",
] as const;

describe("asking the person who knows", () => {
  let owner: typeof users.$inferSelect;
  let stranger: typeof users.$inferSelect;
  let buyerScope: string;
  let ownerScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    verification = await import("../../api/runtime/counterparty-verification");
    sufficiency = await import("../../api/runtime/evidence-sufficiency");
    fabric = await import("../../api/runtime/economic-fabric");
    scopes = await import("../../api/runtime/actor-scope");
    membership = await import("../../api/runtime/block2/membership");
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE verification_requests, observations, economic_expressions,
        notification_intents, reservations, agreements, commitments, transactions,
        scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'cpv-%'`));
    const [one] = await handle.db.insert(users)
      .values({ unionId: `cpv-${randomUUID()}`, name: "البائع", preferences: {} }).returning();
    const [two] = await handle.db.insert(users)
      .values({ unionId: `cpv-${randomUUID()}`, name: "غريب", preferences: {} }).returning();
    owner = one!;
    stranger = two!;
    ownerScope = String(owner.id);
    buyerScope = `buyer-${randomUUID().slice(0, 8)}`;
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  /** A generic offering owned by a real principal. No domain column anywhere. */
  async function offering(semanticType: string, ownerId = ownerScope) {
    const expression = await fabric.createExpression({
      ownerId, kind: "offering", semanticType, attributes: { priceMinor: "2500" },
    });
    await fabric.publishExpression({
      id: expression.id, ownerId,
      projection: { semanticType, summary: "عرض", publicTerms: { label: "x" } },
    });
    return expression.id;
  }

  const fact = (subjectId: string, over: Record<string, unknown> = {}) => ({
    subjectKind: "offering", subjectId, property: "availability",
    configuration: { optionA: "black", optionB: "L" }, quantity: 1,
    subjectRevision: "2", ...over,
  }) as Parameters<typeof verification.requireCounterpartyEvidence>[0]["fact"];

  const need = (
    subjectId: string,
    purpose: Parameters<typeof verification.requireCounterpartyEvidence>[0]["purpose"],
    now: Date,
    over: Record<string, unknown> = {},
  ) =>
    verification.requireCounterpartyEvidence({
      fact: fact(subjectId, over), purpose, requestingScopeId: buyerScope, now,
    });

  /** A seller's own declaration, recorded the way any declaration is. */
  async function declare(subjectId: string, observedAt: Date, over: Record<string, unknown> = {}) {
    await handle.db.execute(
      sql.raw(`INSERT INTO observations (id, "ownerId", "subjectKind", "subjectId",
        "observationType", "observedAt", "sourceKind", provenance, payload, "createdAt")
        VALUES ('obs_${randomUUID().slice(0, 16)}', '${buyerScope}', 'offering', '${subjectId}',
        'availability', '${observedAt.toISOString()}', 'self_report',
        '${JSON.stringify({ subjectRevision: "2", ...over })}'::jsonb,
        '${JSON.stringify({ value: "AFFIRMED", configuration: { optionA: "black", optionB: "L" }, quantity: 1 })}'::jsonb,
        now())`),
    );
  }

  const count = async (table: string) => {
    const rows = await handle.db.execute(sql.raw(`SELECT count(*)::int n FROM ${table}`));
    return (rows.rows[0] as { n: number }).n;
  };

  // ── A · NOBODY IS BOTHERED UNNECESSARILY ──────────────────────────────────

  it("a fresh declaration is shown and compared without anybody being asked", async () => {
    //   FRESH_CONFIRMATION_CAUSES_NEW_PING = 0 · DUPLICATE_HUMAN_PINGS = 0
    const subject = await offering("garment.listing");
    await declare(subject, T0);

    for (const purpose of ["DISCOVER", "COMPARE", "ANSWER_INFORMATION"] as const) {
      const out = await need(subject, purpose, at(5 * MINUTE));
      expect(out.status, purpose).toBe("ALREADY_SUFFICIENT");
    }
    expect(await count("verification_requests")).toBe(0);
    expect(await count("notification_intents")).toBe(0);
  });

  it("a hundred views open no questions at all", async () => {
    //   VIEW_COUNT_TRIGGERS_VERIFICATION = 0
    const subject = await offering("garment.listing");
    await declare(subject, T0);
    for (let view = 0; view < 100; view += 1) {
      await need(subject, "DISCOVER", at(view * 1000));
    }
    expect(await count("verification_requests")).toBe(0);
  });

  it("wanting to proceed opens exactly one question to the canonical owner", async () => {
    //   COUNTERPARTY_SOURCE_DERIVED_CANONICALLY
    const subject = await offering("garment.listing");
    await declare(subject, T0);

    const out = await need(subject, "COMMIT", at(5 * MINUTE));
    expect(out.status).toBe("REQUESTED");
    const request = out.status === "REQUESTED" ? out.request : null;
    expect(request!.respondingScopeId).toBe(ownerScope);
    // The exact fact, every part of it.
    expect(request!.subjectRevision).toBe("2");
    expect(request!.configuration).toEqual({ optionA: "black", optionB: "L" });
    expect(request!.quantity).toBe(1);
    expect(request!.purpose).toBe("COMMIT");
    expect(await count("verification_requests")).toBe(1);
  });

  it("five people wanting one answer is one question", async () => {
    //   DUPLICATE_HUMAN_PINGS = 0 · CROSS_BUYER_IDENTITY_LEAK = 0
    const subject = await offering("garment.listing");
    const asks = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        verification.requireCounterpartyEvidence({
          fact: fact(subject), purpose: "COMMIT",
          requestingScopeId: buyerScope, now: at(MINUTE),
        }),
      ),
    );
    expect(asks.every((out) => out.status === "REQUESTED")).toBe(true);
    expect(await count("verification_requests")).toBe(1);

    // And what the owner is told says nothing about who is asking.
    const request = asks[0]!.status === "REQUESTED" ? asks[0]!.request : null;
    const content = JSON.stringify(verification.questionContentFor(request!));
    expect(content).not.toContain(buyerScope);
    expect(content).not.toContain("requestingScope");
  });

  it("a subject nobody canonically speaks for has nobody to ask", async () => {
    const out = await need("not-a-real-subject", "COMMIT", at(0));
    expect(out.status).toBe("NO_AUTHORIZED_SOURCE");
    expect(await count("verification_requests")).toBe(0);
  });

  // ── B · THE ANSWER IS WHAT THEY SAID ──────────────────────────────────────

  it("an owner's yes becomes an attributed assertion, and then is re-evaluated", async () => {
    //   COUNTERPARTY_RESPONSE_RECORDED_AS_ASSERTION · FRESHNESS_RUNTIME_REUSED
    //   COUNTERPARTY_RESPONSE_BYPASSES_SUFFICIENCY = 0
    const subject = await offering("garment.listing");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    const request = asked.status === "REQUESTED" ? asked.request : null;

    const answered = await verification.answerVerificationRequest({
      requestId: request!.id, respondingPrincipalId: ownerScope,
      assertion: "AFFIRMED", now: at(2 * MINUTE),
    });
    expect(answered.request.state).toBe("ANSWERED");
    expect(answered.observationId).toBeTruthy();
    // The runtime classified the source; the answer did not.
    const rows = await handle.db.execute(
      sql.raw(`SELECT "sourceKind", payload, provenance, "ownerId" FROM observations`),
    );
    const row = rows.rows[0] as {
      sourceKind: string; payload: Record<string, unknown>;
      provenance: Record<string, unknown>; ownerId: string;
    };
    expect(row.sourceKind).toBe("counterparty_confirm");
    expect(row.payload.value).toBe("AFFIRMED");
    //   COUNTERPARTY_RESPONSE_AUTO_VERIFIED = 0
    expect(JSON.stringify(row.payload)).not.toContain("verified");
    expect(row.provenance.requestId).toBe(request!.id);
    expect(row.provenance.answeredByPrincipalId).toBe(ownerScope);

    // Asked again, now — and only now is it enough.
    expect(answered.decision.verdict).toBe("SUFFICIENT");
    expect(sufficiency.attributionFor(answered.decision.evidence)).toBe("VERIFIED");
  });

  it("confirming availability creates nothing else whatsoever", async () => {
    //   CONFIRMATION_CREATES_RESERVATION = 0 · _AGREEMENT = 0 · _TRANSACTION = 0
    //   CONFIRMATION_CREATES_STANDING_AUTHORITY = 0
    const subject = await offering("garment.listing");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    const request = asked.status === "REQUESTED" ? asked.request : null;
    await verification.answerVerificationRequest({
      requestId: request!.id, respondingPrincipalId: ownerScope,
      assertion: "AFFIRMED", now: at(2 * MINUTE),
    });
    for (const table of ["reservations", "agreements", "commitments", "transactions",
      "scope_policies"]) {
      expect(await count(table), table).toBe(0);
    }
  });

  it("a no is also evidence, and a good one", async () => {
    const subject = await offering("used.vehicle");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    const request = asked.status === "REQUESTED" ? asked.request : null;
    const answered = await verification.answerVerificationRequest({
      requestId: request!.id, respondingPrincipalId: ownerScope,
      assertion: "DENIED", now: at(2 * MINUTE),
    });
    // Sufficiency is about the evidence, never about which way it points.
    expect(answered.decision.verdict).toBe("SUFFICIENT");
    expect(answered.decision.evidence!.value).toBe("DENIED");
  });

  it("«I don't know» is recorded as a reply and is evidence of nothing", async () => {
    const subject = await offering("garment.listing");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    const request = asked.status === "REQUESTED" ? asked.request : null;
    const answered = await verification.answerVerificationRequest({
      requestId: request!.id, respondingPrincipalId: ownerScope,
      assertion: "UNKNOWN", now: at(2 * MINUTE),
    });
    expect(answered.request.assertion).toBe("UNKNOWN");
    expect(answered.observationId).toBeNull();
    expect(answered.decision.verdict).toBe("UNKNOWN");
    expect(verification.pendingAnswerFor(answered.request).state).toBe("UNKNOWN");
  });

  it("«it changed» does not confirm what was asked", async () => {
    //   CHANGED_TERMS_SILENTLY_ACCEPTED = 0 · OLD_PROPOSAL_AUTO_UPDATED = 0
    const subject = await offering("garment.listing");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    const request = asked.status === "REQUESTED" ? asked.request : null;
    const answered = await verification.answerVerificationRequest({
      requestId: request!.id, respondingPrincipalId: ownerScope,
      assertion: "CHANGED", now: at(2 * MINUTE),
    });
    expect(answered.observationId).toBeNull();
    expect(answered.decision.verdict).not.toBe("SUFFICIENT");
    expect(verification.pendingAnswerFor(answered.request).state).toBe("CHANGED");
  });

  // ── C · SILENCE ───────────────────────────────────────────────────────────

  it("nobody answering is never a yes, a no, or a refusal", async () => {
    //   NO_RESPONSE_AS_AVAILABLE = 0 · _UNAVAILABLE = 0 · _REJECTION = 0
    const subject = await offering("garment.listing");
    const asked = await need(subject, "COMMIT", at(MINUTE), {});
    const request = asked.status === "REQUESTED" ? asked.request : null;

    const waiting = verification.pendingAnswerFor(request!);
    expect(waiting.state).toBe("AWAITING_CONFIRMATION");
    // And the fact itself is still simply not known.
    const still = await sufficiency.assessSufficiency({
      fact: fact(subject), purpose: "COMMIT", scopeId: buyerScope, now: at(2 * MINUTE),
    });
    expect(still.verdict).not.toBe("SUFFICIENT");

    // Time passes and nobody answers.
    const expired = await verification.expireDueRequests(at(48 * 60 * MINUTE));
    expect(expired).toBe(1);
    const after = await handle.db.execute(
      sql.raw(`SELECT state, assertion FROM verification_requests WHERE id = '${request!.id}'`),
    );
    const row = after.rows[0] as { state: string; assertion: string | null };
    expect(row.state).toBe("EXPIRED");
    expect(row.assertion).toBeNull();
    expect(verification.pendingAnswerFor({ ...request!, state: "EXPIRED" } as never).state)
      .toBe("UNKNOWN");
  });

  // ── D · WHO MAY ANSWER ────────────────────────────────────────────────────

  it("a stranger cannot answer, and is told nothing about whether it exists", async () => {
    const subject = await offering("garment.listing");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    const request = asked.status === "REQUESTED" ? asked.request : null;
    await expect(
      verification.answerVerificationRequest({
        requestId: request!.id, respondingPrincipalId: String(stranger.id),
        assertion: "AFFIRMED", now: at(2 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await count("observations")).toBe(0);
  });

  it("authority is re-checked when they answer, not when they were asked", async () => {
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: after the subject changed hands, the NEW owner was
    //   refused, because the scope stored when the question was sent was the
    //   only one allowed to answer it.
    // WHY_IT_IS_WRONG: that made authority a SNAPSHOT. It refused the person
    //   who genuinely speaks for the thing now, and — worse — it would have
    //   kept accepting the previous owner, who no longer does. A stored scope
    //   is a record of who was asked, not a standing entitlement.
    // NEW_EXPECTATION: entitlement is re-read from the SUBJECT at answer time.
    //   The former owner can no longer answer; the current owner can.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: it closes a direction the old one
    //   left open. Under the old rule a party who had lost the subject kept
    //   answering for it indefinitely; under this one nobody answers for
    //   anything they do not presently own, which is the same rule that
    //   refuses a revoked member below.
    //
    const subject = await offering("garment.listing");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    const request = asked.status === "REQUESTED" ? asked.request : null;
    expect(request!.respondingScopeId).toBe(ownerScope);

    // The subject changes hands after the question was sent.
    await handle.db.execute(
      sql.raw(`UPDATE economic_expressions SET "ownerId" = '${stranger.id}' WHERE id = '${subject}'`),
    );
    const reresolved = await verification.authorityFor("offering", subject, "availability");
    expect(reresolved!.scopeId).toBe(String(stranger.id));

    // The person who was asked no longer speaks for it, and is refused.
    await expect(
      verification.answerVerificationRequest({
        requestId: request!.id, respondingPrincipalId: ownerScope,
        assertion: "AFFIRMED", now: at(2 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await count("observations")).toBe(0);

    // The party who does speak for it now may answer it.
    const answered = await verification.answerVerificationRequest({
      requestId: request!.id, respondingPrincipalId: String(stranger.id),
      assertion: "AFFIRMED", now: at(3 * MINUTE),
    });
    expect(answered.request.state).toBe("ANSWERED");
    expect(answered.request.answeredByPrincipalId).toBe(String(stranger.id));
  });

  it("a member whose standing was revoked cannot confirm afterwards", async () => {
    //   REVOKED_MEMBER_CONFIRMATION_ACCEPTED = 0
    //   AUTHENTICATED_PRINCIPAL != ACTING_SCOPE
    const organization = await scopes.createOrganization({
      principalId: ownerScope, displayName: "شركة",
    });
    // The offering belongs to the ORGANIZATION, not to a person.
    const subject = await offering("machine.time", organization.id);
    const asked = await need(subject, "COMMIT", at(MINUTE));
    const request = asked.status === "REQUESTED" ? asked.request : null;
    expect(request!.respondingScopeId).toBe(organization.id);

    // While a member, they may answer for it.
    expect(
      (await scopes.resolveActingScope({
        principalId: ownerScope,
        request: { intent: "ORGANIZATION", organizationId: organization.id },
      })).status,
    ).toBe("RESOLVED");

    // Then they leave.
    const rows = await handle.db.execute(
      sql.raw(`SELECT id FROM memberships WHERE "ownerId" = '${organization.id}'`),
    );
    await membership.revokeMembership(handle.db, {
      membershipId: (rows.rows[0] as { id: string }).id,
      actorOwnerId: organization.id,
    });

    // The question is unchanged; who may answer it is not. Checked NOW.
    await expect(
      verification.answerVerificationRequest({
        requestId: request!.id, respondingPrincipalId: ownerScope,
        organizationId: organization.id, assertion: "AFFIRMED", now: at(2 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await count("observations")).toBe(0);
  });

  it("an expired question cannot be answered late", async () => {
    const subject = await offering("garment.listing");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    const request = asked.status === "REQUESTED" ? asked.request : null;
    await expect(
      verification.answerVerificationRequest({
        requestId: request!.id, respondingPrincipalId: ownerScope,
        assertion: "AFFIRMED", now: at(48 * 60 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "STATE" });
    expect(await count("observations")).toBe(0);
  });

  it("the same question cannot be answered twice", async () => {
    const subject = await offering("garment.listing");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    const request = asked.status === "REQUESTED" ? asked.request : null;
    await verification.answerVerificationRequest({
      requestId: request!.id, respondingPrincipalId: ownerScope,
      assertion: "AFFIRMED", now: at(2 * MINUTE),
    });
    await expect(
      verification.answerVerificationRequest({
        requestId: request!.id, respondingPrincipalId: ownerScope,
        assertion: "DENIED", now: at(3 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "STATE" });
    expect(await count("observations")).toBe(1);
  });

  // ── E · AN ANSWER COVERS ONLY WHAT WAS ASKED ──────────────────────────────

  it("a yes about one configuration verifies no other", async () => {
    //   CROSS_CONFIGURATION_CONFIRMATION = 0
    const subject = await offering("garment.listing");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    await verification.answerVerificationRequest({
      requestId: (asked.status === "REQUESTED" ? asked.request : null)!.id,
      respondingPrincipalId: ownerScope, assertion: "AFFIRMED", now: at(2 * MINUTE),
    });
    const other = await sufficiency.assessSufficiency({
      fact: fact(subject, { configuration: { optionA: "white", optionB: "XL" } }),
      purpose: "COMMIT", scopeId: buyerScope, now: at(3 * MINUTE),
    });
    expect(other.verdict).toBe("UNKNOWN");
    expect(other.reason).toBe("CONFIGURATION_MISMATCH");
  });

  it("a yes about one is not a yes about twenty", async () => {
    //   CROSS_QUANTITY_CONFIRMATION = 0
    const subject = await offering("storage.capacity");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    await verification.answerVerificationRequest({
      requestId: (asked.status === "REQUESTED" ? asked.request : null)!.id,
      respondingPrincipalId: ownerScope, assertion: "AFFIRMED", now: at(2 * MINUTE),
    });
    const more = await sufficiency.assessSufficiency({
      fact: fact(subject, { quantity: 20 }), purpose: "COMMIT",
      scopeId: buyerScope, now: at(3 * MINUTE),
    });
    expect(more.verdict).toBe("UNKNOWN");
    expect(more.reason).toBe("QUANTITY_EXCEEDS_EVIDENCE");
  });

  it("a yes about one revision does not follow the subject into the next", async () => {
    //   OLD_REQUEST_VERIFIES_NEW_REVISION = 0
    const subject = await offering("used.vehicle");
    const asked = await need(subject, "COMMIT", at(MINUTE));
    await verification.answerVerificationRequest({
      requestId: (asked.status === "REQUESTED" ? asked.request : null)!.id,
      respondingPrincipalId: ownerScope, assertion: "AFFIRMED", now: at(2 * MINUTE),
    });
    const newer = await sufficiency.assessSufficiency({
      fact: fact(subject, { subjectRevision: "3" }), purpose: "COMMIT",
      scopeId: buyerScope, now: at(3 * MINUTE),
    });
    expect(newer.verdict).toBe("UNKNOWN");
    expect(newer.reason).toBe("SUBJECT_REVISED_SINCE");
  });

  // ── F · IT IS NOT A NEGOTIATION CHANNEL ───────────────────────────────────

  it("a question carries no terms, because there is nowhere to put them", async () => {
    //   QUESTION_PROMOTED_TO_PROPOSAL = 0
    //   PROPOSAL_SENT_AS_PLAIN_VERIFICATION_MESSAGE = 0
    //   VERIFICATION_CHANNEL_USED_FOR_NEGOTIATION = 0
    const columns = await handle.db.execute(
      sql.raw(`SELECT column_name FROM information_schema.columns
        WHERE table_name = 'verification_requests'`),
    );
    const names = columns.rows.map((row) => String((row as { column_name: string }).column_name));
    for (const forbidden of ["price", "amount", "terms", "offer", "money", "settlement",
      "proposalId", "agreementId"]) {
      expect(names, `carries ${forbidden}`).not.toContain(forbidden);
    }
    // And the module never reaches the agreement path.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/counterparty-verification.ts", "utf8"),
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    expect(source).not.toMatch(/proposeTermSheet|commitAgreement|createProposal/);
  });

  it("the module builds no messaging system and no second transport", async () => {
    //   NEW_MESSAGING_RUNTIME = 0 · SECOND_REALTIME_SYSTEM = 0
    //   NEW_PROVIDER_ADAPTERS = 0 · PRIVATE_CONTACT_EXPOSED_TO_MODEL = 0
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/counterparty-verification.ts", "utf8"),
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    expect(source).not.toMatch(/WebSocketServer|new Server\(|fetch\(/);
    expect(source).not.toMatch(/\bemail\b|\bphone\b|\bsms\b|smtp/i);
  });

  // ── G · SEVEN UNRELATED SUBJECTS ──────────────────────────────────────────

  it("seven unrelated things take the identical path", async () => {
    //   DOMAIN_COUNTERPARTY_TYPES_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
    for (const semanticType of HOLDOUTS) {
      const subject = await offering(semanticType);
      await declare(subject, T0);
      // Shown without asking…
      expect((await need(subject, "DISCOVER", at(MINUTE))).status, semanticType)
        .toBe("ALREADY_SUFFICIENT");
      // …asked once before binding…
      const asked = await need(subject, "COMMIT", at(MINUTE));
      expect(asked.status, semanticType).toBe("REQUESTED");
      // …and the answer settles it.
      const answered = await verification.answerVerificationRequest({
        requestId: (asked.status === "REQUESTED" ? asked.request : null)!.id,
        respondingPrincipalId: ownerScope, assertion: "AFFIRMED", now: at(2 * MINUTE),
      });
      expect(answered.decision.verdict, semanticType).toBe("SUFFICIENT");
    }
    expect(await count("verification_requests")).toBe(HOLDOUTS.length);
  });

  it("and no noun appears in the runtime at all", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/counterparty-verification.ts", "utf8"),
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    for (const noun of ["garment", "shirt", "vehicle", "car", "venue", "machine",
      "storage", "apiary", "seller", "buyer", "restaurant"]) {
      expect(source.toLowerCase(), `branches on ${noun}`)
        .not.toMatch(new RegExp(`\\b${noun}s?\\b`));
    }
  });
});
