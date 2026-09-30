/**
 * JASIM — the v2 acceptance baseline.
 *
 * ─── WHAT THIS EXISTS TO CATCH ──────────────────────────────────────────────
 *
 * v1 was frozen before any of these capabilities existed, so eighty-six commits
 * moved its score by one. That is a defect in the instrument, and this is the
 * instrument that can see them.
 *
 * Every scenario here is OFFLINE by construction: each measures a deterministic
 * runtime path that needs no model and no vendor. So unlike v1 — where 18 of 42
 * are blocked on credentials nobody has written — a red number here is always
 * about JASIM and never about this environment.
 *
 *   A PROBE THAT THROWS IS A FAIL, NOT A SKIP
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { FROZEN_V2 } from "../evals/corpus/frozen-v2";
import { runBaselineV2 } from "../evals/baseline-v2";
import { summarize, formatReport } from "../evals/baseline";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
/**
 * REAL user rows, not invented strings.
 *
 * A conversation carries a foreign key to `users`, so an owner id this test
 * made up failed the insert and the probe reported the capability unreachable.
 * The runtime was right to refuse an owner that does not exist.
 */
let OWNER = "";
let OTHER = "";

describe("JASIM baseline — frozen corpus v2, the capabilities v1 cannot see", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    const inserted = await handle.db
      .insert(users)
      .values([
        { unionId: `v2-${randomUUID()}`, name: "أ", preferences: {} },
        { unionId: `v2-${randomUUID()}`, name: "ب", preferences: {} },
      ] as never)
      .returning();
    OWNER = String(inserted[0]!.id);
    OTHER = String(inserted[1]!.id);
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE events, observations, notification_intents,
        economic_expressions, economic_matches, economic_engagements,
        economic_proposals, negotiation_envelopes, agreements, commitments,
        transactions, agreement_releases, waiting_needs, private_disclosures,
        execution_proposals, temporal_triggers, messages, conversations CASCADE`),
    );
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("runs every v2 scenario and reports truthfully", async () => {
    const results = await runBaselineV2({
      db: handle.db, ownerId: OWNER, otherOwnerId: OTHER,
    });
    console.log(`\n${formatReport(results)}\n`);
    // `formatReport` prints check NAMES. A red baseline nobody can act on is
    // barely better than no baseline, so the detail is printed here too.
    for (const result of results) {
      for (const check of result.checks.filter((entry) => !entry.passed)) {
        console.log(`  ${result.scenarioId} ${check.name}: ${check.detail}`);
      }
    }

    expect(results).toHaveLength(FROZEN_V2.length);
    const summary = summarize(results);

    // The gate that holds at any score, inherited from v1 unchanged.
    expect(summary.domainSpecificCore, "no scenario may pass via a domain-specific core").toBe(0);

    // And the one v2 adds: a SECURITY check is never outweighed by anything.
    for (const result of results) {
      for (const check of result.checks) {
        if (check.severity === "SECURITY") {
          expect(check.passed, `${result.scenarioId} :: ${check.name} — ${check.detail}`).toBe(true);
        }
      }
    }
  });

  it("every scenario is offline, so a red number is never about this environment", () => {
    for (const scenario of FROZEN_V2) {
      expect(scenario.gate, scenario.id).toBe("OFFLINE");
    }
  });

  it("v2 never reuses a v1 id, and v1 is untouched", async () => {
    const { FROZEN_V1 } = await import("../evals/corpus/frozen-v1");
    const v1 = new Set(FROZEN_V1.map((scenario) => scenario.id));
    for (const scenario of FROZEN_V2) {
      expect(v1.has(scenario.id), scenario.id).toBe(false);
      expect(scenario.id, scenario.id).toMatch(/^V\d\d$/);
    }
    // A corpus is edited by adding a version, never by changing one.
    expect(FROZEN_V1).toHaveLength(42);
  });

  it("the corpus names no domain, exactly as v1 may not", () => {
    //
    // ── THE RULE, AS v1 ALREADY STATES IT ──────────────────────────────────
    //
    //   THE BENCHMARK MAY HEAR A DOMAIN; IT MAY NOT ENCODE ONE.
    //
    // So this reads the CODE, the same way `frozen-corpus.test.ts` does: with
    // comments stripped and utterances blanked. My first version checked the
    // raw file and fired on the word «property» — inside a comment, in its
    // programming sense. That is prose about the rule, not an encoding of a
    // domain, and a check that cannot tell the two apart would force the rule
    // to be deleted in order to pass.
    const code = readFileSync("tests/evals/corpus/frozen-v2.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/utterance:\s*"[^"]*"/g, 'utterance:""')
      .toLowerCase();
    for (const domain of ["crane", "truck", "hotel", "driver", "restaurant", "invoice",
      "property", "vehicle", "shipment", "flight", "warehouse", "رافعة", "شاحنة", "فندق", "سائق"]) {
      expect(code, domain).not.toContain(domain);
    }
    // And the probes may not encode one either — they are machinery.
    const probes = readFileSync("tests/evals/baseline-v2.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .toLowerCase();
    for (const domain of ["crane", "truck", "hotel", "driver", "restaurant",
      "property", "vehicle", "shipment", "flight", "warehouse"]) {
      expect(probes, `baseline-v2 :: ${domain}`).not.toContain(domain);
    }
  });
});
