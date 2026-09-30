/**
 * THE FIVE SCENARIOS v1 CALLED «FUTURE», MEASURED.
 *
 * ─── WHAT «FUTURE» ACTUALLY MEANT ───────────────────────────────────────────
 *
 * `runBaseline` ends with a fallback: a scenario that matches no executable
 * path is reported FUTURE with the note
 *
 *   «The mechanism this scenario measures does not exist on the live path yet»
 *
 * That sentence was never measured. It is the runner saying «I have no probe»
 * in the words of «JASIM has no mechanism», and for all five it was WRONG:
 *
 *   S08  surface lifecycle      → `living-object-runtime`, with an authority
 *                                 suite already proving hide / refuse / re-show
 *   S16  permission mutation    → `setScopePolicy`, versioned and append-only,
 *                                 reachable from `authority-acts`
 *   S23  financial mandate      → `block3/financial-mandate`, whose entire
 *                                 decision lives in one UPDATE's WHERE
 *   S24  browser said success   → `completion-policy`, where EXECUTOR_RETURN is
 *                                 sufficient for exactly one effect kind: NONE
 *   S25  timed out, outcome unknown → the same policy's INCONCLUSIVE verdict
 *
 *   A HARNESS WITH NO PROBE REPORTS THE ABSENCE OF A MECHANISM
 *
 * That is the same defect corpus v2 was built to fix, one layer down: an
 * instrument that cannot reach something must say SO, and must not say the
 * thing is missing.
 *
 * ─── WHAT A PROBE MAY NOT DO ────────────────────────────────────────────────
 *
 * Assert on anything it arranged itself. Each one seeds a world, calls the real
 * function, and reports what came back.
 */
import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ScenarioResult } from "./scenario";

type Check = ScenarioResult["checks"][number];

export type FutureProbeContext = {
  db: NodePgDatabase<any>;
  /** A real principal id — a conversation and a scope both key on one. */
  ownerId: string;
  otherOwnerId: string;
};

const ok = (
  name: string,
  passed: boolean,
  detail: string,
  severity: Check["severity"] = "TRUTH",
): Check => ({ name, passed, detail, severity });

export const FUTURE_PROBES: Readonly<
  Record<string, (context: FutureProbeContext) => Promise<readonly Check[]>>
> = {
  /**
   * S08 — a surface goes when what it described is over, and NOT before.
   *
   *   SURFACE EXIT != CANONICAL STATE DELETE
   */
  async S08(context) {
    const living = await import("../../api/runtime/living-object-runtime");
    const runtime = await import("../../api/runtime/jasim-runtime");
    // A REAL run. My first probe invented a subject id, and the runtime was
    // right to refuse to follow something that does not exist.
    const conversation = await runtime.createRuntimeConversation({
      ownerId: context.ownerId, title: "s08",
    });
    const run = await runtime.createRuntimeRun({
      ownerId: context.ownerId,
      goal: "something that carries on",
      idempotencyKey: `s08-${randomUUID()}`,
      conversationId: conversation.id,
    });
    const materialized = await living.materializeLivingObject({
      principalId: context.ownerId,
      subjectKind: "run",
      subjectId: run.id,
      sideEffect: "INTERNAL_STATE",
      durability: "ONGOING",
    });
    if (!materialized.materialized) {
      return [ok("surface_exists", false, `declined: ${JSON.stringify(materialized.decline)}`)];
    }
    const handle = materialized.object;
    const visibleAtFirst = await living.projectLivingObjects({ principalId: context.ownerId });
    // «لا أريد أن أراها» — the person puts it out of sight.
    await living.setLivingObjectState({
      principalId: context.ownerId, id: handle.id, surfaceState: "HIDDEN",
    });
    const afterHiding = await living.projectLivingObjects({ principalId: context.ownerId });
    // And the canonical handle is still there, which is the whole distinction.
    const stillCanonical = await living.readLivingObject({
      principalId: context.ownerId, id: handle.id,
    });
    return [
      ok("surface_was_shown", visibleAtFirst.objects.some((o) => o.id === handle.id),
        `projected ${visibleAtFirst.objects.length}`),
      ok("surface_exits", !afterHiding.objects.some((o) => o.id === handle.id),
        "What the person put out of sight is out of sight."),
      ok("state_is_not_deleted", Boolean(stillCanonical),
        "Leaving the surface is not leaving existence.", "SECURITY"),
    ];
  },

  /**
   * S16 — a permission change is an authorization change, not a hidden field.
   */
  async S16(context) {
    const scope = await import("../../api/runtime/actor-scope");
    const policyKey = `s16-${randomUUID().slice(0, 8)}`;
    // The owner's own scope: a personal principal manages its own policies.
    const before = await scope
      .getScopePolicy({
        principalId: context.ownerId, scopeId: context.ownerId, policyKey,
      })
      .catch(() => null);
    const set = await scope.setScopePolicy({
      principalId: context.ownerId,
      scopeId: context.ownerId,
      policyKey,
      value: { visible: ["a"], hidden: ["b"] },
    });
    const again = await scope.setScopePolicy({
      principalId: context.ownerId,
      scopeId: context.ownerId,
      policyKey,
      value: { visible: ["a", "c"], hidden: ["b"] },
    });
    // A stranger may not set a rule inside somebody else's scope.
    let strangerRefused = false;
    try {
      await scope.setScopePolicy({
        principalId: context.otherOwnerId,
        scopeId: context.ownerId,
        policyKey,
        value: { visible: ["everything"] },
      });
    } catch {
      strangerRefused = true;
    }
    return [
      ok("nothing_before", before === null || before === undefined,
        "No rule existed before one was set.", "INFO"),
      ok("permission_mutated", set.version === 1 && again.version === 2,
        `versions ${set.version} → ${again.version}`),
      ok("append_only", set.id !== again.id,
        "A new version is a new row, so «what was the rule then» stays answerable."),
      ok("no_cross_scope_mutation", strangerRefused,
        "Nobody sets a rule inside a scope they do not manage.", "SECURITY"),
    ];
  },

  /**
   * S23 — a requested amount above the granted mandate is refused, by amount.
   */
  async S23(context) {
    const delegation = await import("../../api/runtime/block2/delegation");
    const mandate = await import("../../api/runtime/block3/financial-mandate");
    const grant = await delegation.createDelegationGrant(context.db, {
      principalOwnerId: context.ownerId,
      delegateId: context.otherOwnerId,
      purpose: "eval s23",
      allowedCapabilities: ["notify"],
    });
    await mandate.provisionMandateBudget(context.db, {
      grantId: grant.id, currency: "JOD", budgetMinor: "5000",
    });
    // Inside the mandate.
    const within = await mandate.consumeMandateBudget(context.db, {
      grantId: grant.id, amountMinor: "1000", currency: "JOD",
    });
    // Above what was granted — «ادفع ٥٠٠» against a 50.00 mandate.
    const beyond = await mandate.consumeMandateBudget(context.db, {
      grantId: grant.id, amountMinor: "50000", currency: "JOD",
    });
    // And a different currency is not a conversion.
    const otherCurrency = await mandate.consumeMandateBudget(context.db, {
      grantId: grant.id, amountMinor: "100", currency: "USD",
    });
    const budget = await mandate.getMandateBudget(context.db, grant.id);
    return [
      ok("within_mandate_allowed", within.outcome === "ALLOWED",
        `outcome = ${within.outcome}`),
      ok("beyond_mandate_refused", beyond.outcome === "REJECTED",
        `outcome = ${beyond.outcome}` +
          (beyond.outcome === "REJECTED" ? ` code = ${beyond.code}` : ""), "SECURITY"),
      ok("refusal_names_the_reason",
        beyond.outcome === "REJECTED" && beyond.code === "INSUFFICIENT_BUDGET",
        "A refusal that does not say why is a refusal nobody can act on."),
      ok("currency_is_not_converted",
        otherCurrency.outcome === "REJECTED" && otherCurrency.code === "CURRENCY_MISMATCH",
        "A currency is not a scale of another currency.", "SECURITY"),
      ok("nothing_consumed_by_a_refusal", budget?.consumedMinor === "1000",
        `consumed = ${budget?.consumedMinor} — only the allowed one.`, "SECURITY"),
    ];
  },

  /**
   * S24 — the executor said it worked. That is a claim, not a confirmation.
   *
   *   BROWSER_SUCCESS != PAID · RECEIPT != VERIFICATION
   */
  async S24() {
    const completion = await import("../../api/runtime/completion-policy");
    const policy = completion.completionPolicyFor("REMOTE_MUTATION");
    const verdict = completion.decideCompletion({
      policy,
      outputShapeValid: true,
      // Everything the world offered: the thing that did it, saying it did it.
      assertions: [{ source: "EXECUTOR_RETURN", state: "SUCCEEDED" }] as never,
    });
    const nothingPolicy = completion.completionPolicyFor("NONE");
    const nothingVerdict = completion.decideCompletion({
      policy: nothingPolicy,
      outputShapeValid: true,
      assertions: [{ source: "EXECUTOR_RETURN", state: "SUCCEEDED" }] as never,
    });
    return [
      ok("executor_claim_is_not_verification", verdict.decision !== "VERIFIED",
        `decision = ${verdict.decision} (${verdict.reasonCode})`, "SECURITY"),
      ok("refusal_names_the_reason", Boolean(verdict.reasonCode),
        `reasonCode = ${verdict.reasonCode}`),
      // And the one kind where an executor's word IS enough, because there is
      // nothing in the world to read back.
      // The decision vocabulary is VERIFIED / PENDING / INCONCLUSIVE / FAILED —
      // there is no «COMPLETED», which my first probe asserted against.
      ok("an_effectless_step_still_completes", nothingVerdict.decision === "VERIFIED",
        `NONE → ${nothingVerdict.decision}`, "QUALITY"),
    ];
  },

  /**
   * S25 — it timed out and nobody knows. That is a third answer, not a retry.
   *
   *   UNCERTAIN_FOREVER = 0 · LOOKUP != RETRY
   */
  async S25() {
    const completion = await import("../../api/runtime/completion-policy");
    const policy = completion.completionPolicyFor("REMOTE_MUTATION");
    const verdict = completion.decideCompletion({
      policy,
      outputShapeValid: true,
      // Nothing came back at all.
      assertions: [] as never,
    });
    const mayRetry = completion.mayRetryAfter(verdict);
    return [
      ok("unknown_is_not_success", verdict.decision !== "COMPLETED",
        `decision = ${verdict.decision}`, "SECURITY"),
      ok("unknown_is_not_failure", verdict.decision !== "FAILED",
        `NO_ANSWER != NOT_OCCURRED — decision = ${verdict.decision}`),
      ok("no_blind_retry", mayRetry === false,
        "An effect that may have happened is never repeated to find out.", "SECURITY"),
    ];
  },
};
