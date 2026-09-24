/**
 * JASIM — WEIGHED AGAINST WHAT IS ACTUALLY STORED.
 *
 *   USE EXISTING EVIDENCE WHEN IT IS SUFFICIENT FOR THE NEXT ACTION.
 *   REQUEST STRONGER EVIDENCE ONLY WHEN THE NEXT ACTION REQUIRES IT.
 *   NEVER FABRICATE THE MISSING TRUTH.
 *
 * Real PostgreSQL, real observations written through the canonical bridge, and
 * an injected clock. Nothing waits and nothing is contacted.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let sufficiency: typeof import("../../api/runtime/evidence-sufficiency");

const T0 = new Date("2026-09-24T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

describe("evidence already stored, weighed against what comes next", () => {
  let scope: string;
  let other: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    sufficiency = await import("../../api/runtime/evidence-sufficiency");
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE observations, scope_policies, economic_expressions CASCADE`),
    );
    scope = `scope-${randomUUID().slice(0, 8)}`;
    other = `other-${randomUUID().slice(0, 8)}`;
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  /** One observation, exactly as the canonical bridge shapes one. */
  async function observe(input: {
    ownerId?: string;
    subjectId?: string;
    property?: string;
    sourceKind: string;
    observedAt: Date;
    configuration?: Record<string, string | number>;
    quantity?: number;
    subjectRevision?: string;
    freshnessExpiresAt?: Date;
    value?: string;
  }) {
    const id = `obs_${randomUUID().slice(0, 16)}`;
    const payload = JSON.stringify({
      value: input.value ?? "AVAILABLE",
      ...(input.configuration ? { configuration: input.configuration } : {}),
      ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
    });
    const provenance = JSON.stringify(
      input.subjectRevision ? { subjectRevision: input.subjectRevision } : {},
    );
    await handle.db.execute(
      sql.raw(`INSERT INTO observations (id, "ownerId", "subjectKind", "subjectId",
        "observationType", "observedAt", "sourceKind", provenance, payload,
        "freshnessExpiresAt", "createdAt")
        VALUES ('${id}', '${input.ownerId ?? scope}', 'offering',
        '${input.subjectId ?? "o1"}', '${input.property ?? "availability"}',
        '${input.observedAt.toISOString()}', '${input.sourceKind}',
        '${provenance}'::jsonb, '${payload}'::jsonb,
        ${input.freshnessExpiresAt ? `'${input.freshnessExpiresAt.toISOString()}'` : "NULL"},
        now())`),
    );
    return id;
  }

  const ask = (purpose: Parameters<typeof sufficiency.assessSufficiency>[0]["purpose"], now: Date,
    over: Partial<Parameters<typeof sufficiency.assessSufficiency>[0]["fact"]> = {},
    scopeId = scope) =>
    sufficiency.assessSufficiency({
      fact: { subjectKind: "offering", subjectId: "o1", property: "availability", ...over },
      purpose, scopeId, now,
    });

  // ── §25 · THE JOURNEY, WITHOUT BOTHERING ANYBODY ──────────────────────────

  it("a listing published minutes ago is shown, compared and answered with — and nobody is asked", async () => {
    //   FRESH_DECLARATION_DISCOVERY · DISCOVERY_UNNECESSARY_VERIFICATION = 0
    //   COMPARE_UNNECESSARY_VERIFICATION = 0
    await observe({ sourceKind: "self_report", observedAt: T0 });
    const now = at(5 * MINUTE);

    for (const purpose of ["DISCOVER", "COMPARE", "ANSWER_INFORMATION"] as const) {
      const out = await ask(purpose, now);
      expect(out.verdict, purpose).toBe("SUFFICIENT");
      expect(out.requirementKey, purpose).toBeNull();
      // …and the answer must keep saying whose word it is.
      expect(sufficiency.attributionFor(out.evidence), purpose).toBe("ATTRIBUTED");
    }
  });

  it("wanting to buy it is a different question about the same listing", async () => {
    //   TRANSACTION_GRADE_VERIFICATION_REQUIREMENT
    await observe({ sourceKind: "self_report", observedAt: T0 });
    const out = await ask("COMMIT", at(5 * MINUTE));
    expect(out.verdict).toBe("STRONGER_EVIDENCE_REQUIRED");
    expect(out.reason).toBe("SOURCE_NOT_ACCEPTED_FOR_PURPOSE");
    // Named, so the next phase knows exactly what to go and establish.
    expect(out.requirementKey).toContain("COMMIT");
  });

  it("a confirmation moments old is reused rather than asked for again", async () => {
    //   FRESH_CONFIRMATION_REUSED · DUPLICATE_VERIFICATION_REQUIREMENT = 0
    await observe({ sourceKind: "self_report", observedAt: T0 });
    const confirmed = await observe({
      sourceKind: "counterparty_confirm", observedAt: at(4 * MINUTE),
      configuration: { colour: "black", size: "L" }, quantity: 1,
    });
    const out = await ask("COMMIT", at(5 * MINUTE), {
      configuration: { colour: "black", size: "L" }, quantity: 1,
    });
    expect(out.verdict).toBe("SUFFICIENT");
    expect(out.evidence!.id).toBe(confirmed);
    expect(out.requirementKey).toBeNull();
    expect(sufficiency.attributionFor(out.evidence)).toBe("VERIFIED");
  });

  it("the same confirmation for a different configuration proves nothing", async () => {
    //   CONFIGURATION_MISMATCH_REUSES_EVIDENCE = 0
    await observe({
      sourceKind: "counterparty_confirm", observedAt: at(4 * MINUTE),
      configuration: { colour: "black", size: "L" }, quantity: 1,
    });
    const out = await ask("COMMIT", at(5 * MINUTE), {
      configuration: { colour: "white", size: "XL" }, quantity: 1,
    });
    expect(out.verdict).toBe("UNKNOWN");
    expect(out.reason).toBe("CONFIGURATION_MISMATCH");
  });

  it("a fact nobody ever recorded is UNKNOWN, never guessed either way", async () => {
    //   MISSING_FACT_FABRICATED = 0
    await observe({ sourceKind: "self_report", observedAt: T0 });
    const out = await ask("ANSWER_INFORMATION", at(MINUTE), { property: "material" });
    expect(out.verdict).toBe("UNKNOWN");
    expect(out.reason).toBe("NO_EVIDENCE");
    expect(out.evidence).toBeNull();
  });

  it("an image attached to a listing is not evidence that it is still there", async () => {
    //   MEDIA_AS_AVAILABILITY_TRUTH = 0
    await observe({ sourceKind: "counterparty_confirm", observedAt: T0, property: "media" });
    const out = await ask("DISCOVER", at(MINUTE));
    // Plenty is stored about this subject. None of it is about availability.
    expect(out.verdict).toBe("UNKNOWN");
    expect(out.reason).toBe("NO_EVIDENCE");
  });

  // ── POLICY IS DECLARED, NOT COMPILED IN ───────────────────────────────────

  it("a scope may declare its own sufficiency, in the ordinary policy store", async () => {
    await observe({ sourceKind: "self_report", observedAt: T0 });
    // This scope says a declaration goes stale for discovery after one minute.
    await handle.db.execute(
      sql.raw(`INSERT INTO scope_policies (id, "scopeId", "policyKey", value, version,
        state, "setByPrincipalId", "createdAt")
        VALUES ('pol_${randomUUID().slice(0, 12)}', '${scope}', 'evidence.sufficiency',
        '{"DISCOVER":{"maxAgeMs":60000,"acceptedSources":["SELF_REPORTED"]}}'::jsonb,
        1, 'active', 'setter', now())`),
    );
    expect((await ask("DISCOVER", at(30_000))).verdict).toBe("SUFFICIENT");
    const stale = await ask("DISCOVER", at(2 * MINUTE));
    expect(stale.verdict).toBe("STRONGER_EVIDENCE_REQUIRED");
    expect(stale.reason).toBe("EVIDENCE_TOO_OLD");
    // Another scope keeps the default and is unaffected.
    await observe({ ownerId: other, sourceKind: "self_report", observedAt: T0 });
    expect((await ask("DISCOVER", at(2 * MINUTE), {}, other)).verdict).toBe("SUFFICIENT");
  });

  it("a declared policy cannot widen the source vocabulary", async () => {
    //   MODEL_CAN_DECLARE_VERIFIED = NO
    await observe({ sourceKind: "self_report", observedAt: T0 });
    await handle.db.execute(
      sql.raw(`INSERT INTO scope_policies (id, "scopeId", "policyKey", value, version,
        state, "setByPrincipalId", "createdAt")
        VALUES ('pol_${randomUUID().slice(0, 12)}', '${scope}', 'evidence.sufficiency',
        '{"COMMIT":{"maxAgeMs":600000,"acceptedSources":["ANYTHING_GOES","TRUST_ME"]}}'::jsonb,
        1, 'active', 'setter', now())`),
    );
    const policy = await sufficiency.evidencePolicyFor({ scopeId: scope, purpose: "COMMIT" });
    // The invented names were dropped, and the declaration is read FAITHFULLY
    // rather than generously: somebody who named only sources that do not
    // exist has accepted no source, so nothing satisfies this purpose. Falling
    // back to the defaults here would honour something they never said, and
    // would silently be the LESS safe of the two readings.
    expect(policy.acceptedSources).toEqual([]);
    expect((await ask("COMMIT", at(MINUTE))).verdict).toBe("STRONGER_EVIDENCE_REQUIRED");
  });

  // ── SECURITY ──────────────────────────────────────────────────────────────

  it("another scope's evidence is not evidence here", async () => {
    //   CROSS_SCOPE_EVIDENCE_LEAK = 0
    await observe({
      ownerId: other, sourceKind: "counterparty_confirm", observedAt: at(4 * MINUTE),
    });
    const out = await ask("COMMIT", at(5 * MINUTE));
    expect(out.verdict).toBe("UNKNOWN");
    expect(out.reason).toBe("NO_EVIDENCE");
    // And it is perfectly good evidence inside the scope that holds it.
    expect((await ask("COMMIT", at(5 * MINUTE), {}, other)).verdict).toBe("SUFFICIENT");
  });

  it("a payload claiming to be verified changes nothing", async () => {
    //   FORGED_EVIDENCE_ACCEPTED = 0
    const id = `obs_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO observations (id, "ownerId", "subjectKind", "subjectId",
        "observationType", "observedAt", "sourceKind", provenance, payload, "createdAt")
        VALUES ('${id}', '${scope}', 'offering', 'o1', 'availability',
        '${T0.toISOString()}', 'self_report', '{}'::jsonb,
        '{"value":"AVAILABLE","verified":true,"source":"OWNER_CONFIRMATION","sourceKind":"counterparty_confirm"}'::jsonb,
        now())`),
    );
    const out = await ask("COMMIT", at(MINUTE));
    // The row IS evidence — it is simply not the kind it claimed to be. Its
    // source came from the ROW's own classification, set by the channel a
    // trusted call site named, and the payload's opinion of itself was never
    // consulted.
    expect(out.evidence!.source).toBe("SELF_REPORTED");
    expect(out.verdict).toBe("STRONGER_EVIDENCE_REQUIRED");
    expect(out.reason).toBe("SOURCE_NOT_ACCEPTED_FOR_PURPOSE");
    // And the presentation still attributes it rather than calling it verified.
    expect(sufficiency.attributionFor(out.evidence)).toBe("ATTRIBUTED");
  });

  // ── SEVEN UNRELATED SUBJECTS ──────────────────────────────────────────────

  it("seven unrelated subjects cross the identical boundary", async () => {
    //   DOMAIN_FRESHNESS_HANDLERS_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
    const subjects = ["garment", "vehicle", "interpreter_hour", "machine_time",
      "venue_slot", "storage_m3", "seabed_survey_line"];
    for (const subjectId of subjects) {
      await observe({ subjectId, sourceKind: "self_report", observedAt: T0 });
    }
    for (const subjectId of subjects) {
      expect((await ask("DISCOVER", at(MINUTE), { subjectId })).verdict, subjectId)
        .toBe("SUFFICIENT");
      expect((await ask("COMMIT", at(MINUTE), { subjectId })).verdict, subjectId)
        .toBe("STRONGER_EVIDENCE_REQUIRED");
    }
  });

  it("and nothing was written, reserved or sent while deciding all of that", async () => {
    //   FRESHNESS_CREATES_RESERVATION = 0 · HUMAN_MESSAGES_SENT = 0
    await observe({ sourceKind: "self_report", observedAt: T0 });
    const before = await handle.db.execute(
      sql.raw(`SELECT
        (SELECT count(*)::int FROM observations) o,
        (SELECT count(*)::int FROM reservations) r,
        (SELECT count(*)::int FROM notification_intents) n,
        (SELECT count(*)::int FROM events) e`),
    );
    for (const purpose of ["DISCOVER", "COMPARE", "PROPOSE", "RESERVE", "COMMIT"] as const) {
      await ask(purpose, at(MINUTE));
    }
    const after = await handle.db.execute(
      sql.raw(`SELECT
        (SELECT count(*)::int FROM observations) o,
        (SELECT count(*)::int FROM reservations) r,
        (SELECT count(*)::int FROM notification_intents) n,
        (SELECT count(*)::int FROM events) e`),
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
