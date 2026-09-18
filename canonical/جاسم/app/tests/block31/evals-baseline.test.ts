import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";
import { runBaseline, summarize, formatReport } from "../evals/baseline";
import { FROZEN_V1 } from "../evals/corpus/frozen-v1";

/**
 * THE BASELINE.
 *
 * It lives in the Block 3.1 suite because it needs an isolated proof database
 * and the runtime's own connection repointed at it — the same harness the
 * execution-truth tests use. The evaluation FRAMEWORK lives in `tests/evals`;
 * this file only supplies it a database and records what came back.
 *
 * The number this produces is not meant to be flattering. It is meant to be
 * comparable after GoalSpec, PlanGraph, Discovery, providers and compensation.
 */

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");

/** The runtime maps ownerId onto users.id, so it must be numeric. */
const BASELINE_OWNER = "9001";

describe("JASIM baseline — frozen corpus v1, no provider", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    runtime = await import("../../api/runtime/jasim-runtime");
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE events, notification_intents CASCADE"));
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("runs every frozen scenario and reports truthfully", async () => {
    const results = await runBaseline({
      db: handle.db,
      runtime,
      ownerId: BASELINE_OWNER,
      liveModel: false,
      liveProvider: false,
    });

    console.log(`\n${formatReport(results)}\n`);

    expect(results).toHaveLength(FROZEN_V1.length);
    const summary = summarize(results);

    // ── The gates that must hold at ANY score ────────────────────────────
    //
    // A low baseline is acceptable. A dishonest one is not — so these four
    // are asserted even though the overall pass count is not.
    expect(summary.falseSuccesses, "FALSE_SUCCESS_RATE must be zero").toBe(0);
    expect(summary.blindRetries, "BLIND_RETRY_RATE must be zero").toBe(0);
    expect(summary.domainSpecificCore, "no scenario may pass via a domain-specific core").toBe(0);
    expect(summary.securityFailures, "no security check may fail").toBe(0);

    // Every scenario has a truthful outcome — none is left unclassified.
    for (const result of results) {
      expect(
        ["PASS", "PARTIAL", "FAIL", "BLOCKED_BY_MODEL", "BLOCKED_BY_PROVIDER", "FUTURE"],
        result.scenarioId,
      ).toContain(result.outcome);
    }
  });

  it("a real messaging effect is not reported as verified", async () => {
    // The single most important behaviour the baseline measures, asserted
    // directly rather than inferred from a count.
    const results = await runBaseline({
      db: handle.db, runtime, ownerId: BASELINE_OWNER, liveModel: false, liveProvider: false,
    });
    const messaging = results.find((result) => result.scenarioId === "S10")!;
    expect(messaging.outcome).not.toBe("FAIL");
    expect(messaging.checks.find((entry) => entry.name === "no_false_success")?.passed).toBe(true);
  });

  it("every blocked scenario states which dependency blocks it", async () => {
    // The property that keeps a mostly-blocked baseline honest: a blocked
    // scenario must name the missing dependency, so nobody can read the score
    // as "JASIM cannot do this" when it means "nothing was configured".
    const results = await runBaseline({
      db: handle.db, runtime, ownerId: BASELINE_OWNER, liveModel: false, liveProvider: false,
    });
    for (const result of results) {
      if (result.outcome === "BLOCKED_BY_MODEL") {
        expect(result.notes.join(" "), result.scenarioId).toMatch(/model provider/i);
      }
      if (result.outcome === "BLOCKED_BY_PROVIDER") {
        expect(result.notes.join(" "), result.scenarioId).toMatch(/external provider/i);
      }
      if (result.outcome === "FUTURE") {
        expect(result.notes.join(" "), result.scenarioId).toMatch(/does not exist/i);
      }
    }
  });
});
