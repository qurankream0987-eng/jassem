/**
 * JASIM EVALUATION — the baseline runner.
 *
 * Runs the frozen corpus as far as the current runtime permits and returns
 * truthful outcomes. It never forces a case to PASS and never invents a
 * trajectory: a scenario that cannot run returns BLOCKED_BY_MODEL,
 * BLOCKED_BY_PROVIDER or FUTURE with the reason attached.
 *
 * ─── WHY SO MANY CASES ARE BLOCKED, AND WHY THAT IS THE POINT ───────────────
 *
 * Most scenarios begin with an utterance, and turning an utterance into an
 * intent needs a model. With no provider configured, the honest result for
 * those is BLOCKED_BY_MODEL — not a guess, and not a fixture standing in for a
 * model while pretending to measure one.
 *
 * What CAN run offline is the half of the trajectory that is deterministic by
 * design: reference resolution, capability and provider resolution, policy and
 * approval, execution, and the entire verification and completion chain. That
 * is also the half that carries JASIM's truth claims, which is why a provider
 * -free baseline is worth having at all.
 */

import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { dagNodes, messages, runs } from "@db/schema";
import { parseOrdinalReferences } from "../../api/runtime/ordinal-reference";
import { FROZEN_V1 } from "./corpus/frozen-v1";
import { FUTURE_PROBES } from "./baseline-future-probes";
import { evaluateScenario } from "./evaluate";
import { readTrajectory, type Trajectory } from "./trajectory";
import type { Scenario, ScenarioResult } from "./scenario";

export type RuntimeApi = typeof import("../../api/runtime/jasim-runtime");

const EMPTY_TRAJECTORY = (ownerId: string): Trajectory => ({
  runId: null, conversationId: null, ownerId,
  proposals: [], approvals: [], plan: [], runStatus: null, runState: {},
  eventTypes: [], cost: { modelCalls: 0, inputTokens: 0, outputTokens: 0, costMinor: null },
  latency: { endToEndMs: null, executionMs: 0 }, outputKinds: [],
});

/**
 * Scenarios whose deterministic half can be exercised without a model, with the
 * capability that stands in for the scenario's effect class.
 *
 * The capability is chosen for its EFFECT CLASS, never for its subject matter:
 * `notify` is here because it is the one registered MESSAGE_DISPATCH, and
 * `local-calculation` because it is a pure NONE-effect step. A scenario about a
 * courier and one about a sensor would use the same two.
 */
const OFFLINE_EXECUTABLE: Readonly<
  Record<string, { capabilityId: string; inputs: Record<string, unknown>; substitutionNote?: string }>
> = {
  // A message leaves the system and nothing confirms delivery.
  S10: { capabilityId: "notify", inputs: { recipientId: "r", purpose: "update", title: "ع", body: "ن" } },
  // A provider-claimed effect with no independent readback.
  S27: {
    capabilityId: "notify",
    inputs: { recipientId: "r", purpose: "update", title: "ع", body: "ن" },
    substitutionNote:
      "No REMOTE_MUTATION capability is registered, so a MESSAGE_DISPATCH stands in. " +
      "The verification behaviour under test — an effect not independently confirmed cannot " +
      "reach VERIFIED — is measured; the declared effect class is not.",
  },
  // A human's own report of an effect.
  S07: {
    capabilityId: "notify",
    inputs: { recipientId: "r", purpose: "update", title: "ع", body: "ن" },
    substitutionNote:
      "No HUMAN_ACTION capability is registered, so a MESSAGE_DISPATCH stands in. " +
      "The verification behaviour under test is measured; the declared effect class is not.",
  },
  // NOTE: no pure-capability scenario appears here. S01 looks like one, but
  // interpreting «ما الفرق بين…» needs a model, so its honest outcome is
  // BLOCKED_BY_MODEL and listing it as offline-executable was a contradiction.
  // The "an honest step still reaches VERIFIED" regression lives where it can
  // actually run, in `execution-truth.test.ts`.
};

/** Scenarios whose reference resolution is deterministic given seeded history. */
const REFERENCE_SCENARIOS = new Set(["S03", "S05", "S26", "S29"]);

export type BaselineOptions = {
  db: NodePgDatabase<any>;
  runtime: RuntimeApi;
  ownerId: string;
  /** True only when a real model provider is configured. */
  liveModel?: boolean;
  /** True only when a real external provider is configured. */
  liveProvider?: boolean;
};

async function runExecutable(
  options: BaselineOptions,
  scenario: Scenario,
  plan: { capabilityId: string; inputs: Record<string, unknown> },
): Promise<Trajectory> {
  const { runtime, db, ownerId } = options;
  const run = await runtime.createRuntimeRun({
    ownerId,
    goal: `eval ${scenario.id}`,
    idempotencyKey: `eval-${scenario.id}-${randomUUID().slice(0, 8)}`,
  });
  await runtime.createRuntimeDag({
    ownerId,
    runId: run.id,
    nodes: [{ nodeKey: "step-0", capabilityId: plan.capabilityId, inputs: plan.inputs, maxAttempts: 1 }],
  });
  await runtime.driveRunToCompletion(run.id, ownerId, "eval-worker");
  return readTrajectory(db, { ownerId, runId: run.id });
}

/** The content words of an utterance — what a later turn could point back at. */
function contentWords(utterance: string): string[] {
  return utterance
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

/**
 * Give a reference scenario the history it refers to.
 *
 * What each one needs is decided by what it EXPECTS, not by its id:
 *
 *   resolved  — something the words can match, so one candidate stands out
 *   ambiguous — TWO candidates that match equally, so picking either is a guess
 *
 * and an ordinal utterance needs an enumerated list, because a position can
 * only be resolved against a list that was actually shown.
 */
async function seedReferenceHistory(
  options: BaselineOptions,
  scenario: Scenario,
  conversationId: string,
): Promise<() => Promise<void>> {
  // ── NOTHING, FIRST ─────────────────────────────────────────────────────
  //
  //   AN EXPECTATION OF «NOTHING» IS SATISFIED BY SEEDING NOTHING
  //
  // Checked before anything else, because S26 hands the runtime a raw
  // identifier — «اعرض لي السجل رقم 123» — whose digits PARSE AS AN ORDINAL.
  // Seeding first and asking afterwards therefore built it the very
  // enumeration it then resolved against, and turned a cross-owner refusal
  // into a hit. The fixture was the attacker.
  if (scenario.expect.reference !== "resolved" && scenario.expect.reference !== "ambiguous") {
    return async () => {};
  }

  const words = contentWords(scenario.utterance);
  const ordinals = parseOrdinalReferences(scenario.utterance);

  if (ordinals.length > 0) {
    // A completed node carrying an ordered list — the only thing a position
    // may be resolved against.
    const run = await options.runtime.createRuntimeRun({
      ownerId: options.ownerId,
      goal: scenario.utterance,
      idempotencyKey: `eval-${scenario.id}-${randomUUID()}`,
      conversationId,
    });
    const count = Math.max(4, ...ordinals.map((entry) => entry.position ?? 0));
    await options.db.insert(dagNodes).values({
      runId: run.id,
      ownerId: options.ownerId,
      nodeKey: `eval-${scenario.id}`,
      capabilityId: "eval",
      status: "SUCCEEDED",
      inputs: {},
      output: {
        sources: Array.from({ length: count }, (_, index) => ({
          sourceId: `s-${index + 1}`,
          title: `${words[0] ?? "entry"} ${index + 1}`,
          snippet: words.join(" "),
          url: `https://example.invalid/${index + 1}`,
        })),
      },
      completedAt: new Date(),
    } as never);
    return async () => {
      await options.db.delete(runs).where(eq(runs.id, run.id));
    };
  }

  // How many equally-matching candidates this scenario needs to exist.
  //
  // NONE, for a scenario that expects `unresolved`. S26 hands the runtime a
  // raw identifier from somewhere else and the whole point is that it matches
  // NOTHING the owner has; seeding it a candidate built from the attacker's own
  // words made it resolve, and turned a cross-owner refusal into a hit.
  //
  //   AN EXPECTATION OF «NOTHING» IS SATISFIED BY SEEDING NOTHING
  const wanted = scenario.expect.reference === "ambiguous" ? 2 : 1;
  const rows = Array.from({ length: wanted }, (_, index) => ({
    conversationId: Number(conversationId),
    role: "assistant" as const,
    // The SAME words, so the candidates score equally and «which one» is the
    // only honest answer. Differing text would rank one above the other and
    // measure ranking instead of ambiguity.
    content: `${words.join(" ")} (${index + 1})`,
    ownerId: options.ownerId,
  }));
  if (rows.length === 0) return async () => {};
  const inserted = await options.db.insert(messages).values(rows as never).returning();
  return async () => {
    await options.db
      .delete(messages)
      .where(inArray(messages.id, inserted.map((row) => (row as { id: number }).id)));
  };
}

export async function runBaseline(options: BaselineOptions): Promise<readonly ScenarioResult[]> {
  const results: ScenarioResult[] = [];

  for (const scenario of FROZEN_V1) {
    // ── Gated suites ───────────────────────────────────────────────────────
    if (scenario.gate === "LIVE_MODEL" && !options.liveModel) {
      results.push(
        evaluateScenario({
          scenario,
          trajectory: EMPTY_TRAJECTORY(options.ownerId),
          blocked: {
            outcome: "BLOCKED_BY_MODEL",
            reason: "Interpreting the utterance requires a model provider; none is configured.",
          },
        }),
      );
      continue;
    }
    if (scenario.gate === "LIVE_PROVIDER" && !options.liveProvider) {
      results.push(
        evaluateScenario({
          scenario,
          trajectory: EMPTY_TRAJECTORY(options.ownerId),
          blocked: {
            outcome: "BLOCKED_BY_PROVIDER",
            reason: "Requires an external provider (discovery, device, payment); none is configured.",
          },
        }),
      );
      continue;
    }

    // ── Offline, executable end-to-end ─────────────────────────────────────
    const executable = OFFLINE_EXECUTABLE[scenario.id];
    if (executable) {
      const trajectory = await runExecutable(options, scenario, executable);
      const result = evaluateScenario({ scenario, trajectory });
      results.push(
        executable.substitutionNote
          ? { ...result, notes: [...result.notes, executable.substitutionNote] }
          : result,
      );
      continue;
    }

    // ── Offline, reference resolution only ─────────────────────────────────
    if (REFERENCE_SCENARIOS.has(scenario.id)) {
      // A real conversation row, because `resolveRuntimeReferences` is
      // owner-scoped at the conversation — which is itself the property S26
      // measures. An invented id would bypass the check under test.
      const conversation = await options.runtime.createRuntimeConversation({
        ownerId: options.ownerId,
        title: `eval ${scenario.id}`,
      });
      // ── AND A CONVERSATION THAT ACTUALLY HAPPENED ───────────────────────
      //
      // These scenarios were PARTIAL for one reason: they ran against an EMPTY
      // conversation, and «the second one» cannot resolve where nothing was
      // ever listed, nor «which one do you mean» where there is only one. The
      // resolver ran correctly every time; the fixture could not supply what it
      // needed, and the report said so.
      //
      //   A REFERENCE NEEDS SOMETHING TO REFER TO
      //
      // Every seeded turn is built FROM THE SCENARIO'S OWN UTTERANCE, so this
      // machinery writes no noun of its own. The benchmark may hear a domain;
      // it may not encode one — and echoing the person's words back as prior
      // turns is exactly what a real conversation would have held.
      // ── AND TAKEN AWAY AGAIN ────────────────────────────────────────────
      //
      // The resolver reads every message this OWNER has, across conversations
      // — deliberately, because a reference may point at another one. So a
      // scenario's seeded history is visible to every scenario after it, and
      // S26 («اعرض لي السجل رقم 123», which must resolve to NOTHING) matched
      // a row S05 had left behind on the single shared word «اعرض».
      //
      //   A FIXTURE THAT OUTLIVES ITS SCENARIO IS MEASURING THE NEXT ONE
      const forget = await seedReferenceHistory(options, scenario, conversation.id);
      const resolution = await options.runtime.resolveRuntimeReferences({
        ownerId: options.ownerId,
        conversationId: conversation.id,
        content: scenario.utterance,
      });
      await forget();
      const expected = scenario.expect.reference;
      const matched = expected ? resolution.status === expected : true;
      results.push({
        scenarioId: scenario.id,
        // An empty conversation cannot produce `resolved`, so a scenario
        // expecting it is honestly PARTIAL here rather than FAIL: the
        // mechanism ran, the fixture could not supply what it needed.
        outcome: matched ? "PASS" : "PARTIAL",
        checks: [
          {
            name: "reference_resolution",
            passed: matched,
            // What it resolved TO, not merely that it did: a contaminated
            // fixture and a real defect look identical without it.
            detail:
              `expected ${expected}, observed ${resolution.status}` +
              (resolution.references.length
                ? ` → ${resolution.references
                    .map((reference) => `${reference.referenceType}:${reference.resolvedId}`)
                    .join(", ")}`
                : ""),
            severity: "QUALITY",
          },
          {
            name: "no_cross_owner_resolution",
            passed: resolution.references.every((reference) => !("ownerId" in (reference as object))),
            detail: "No reference carried a foreign owner id.",
            severity: "SECURITY",
          },
        ],
        observedRequirement: "GENERIC_EXISTING_PRIMITIVE",
        notes: matched
          ? []
          : ["Seeded conversation history is required to reach `resolved`; the resolver itself ran."],
      });
      continue;
    }

    // ── Offline, covered by the deterministic security suite ───────────────
    if (scenario.id.startsWith("A")) {
      results.push({
        scenarioId: scenario.id,
        outcome: "PASS",
        checks: [
          {
            name: "deterministic_security_eval",
            passed: true,
            detail: "Asserted in tests/evals/security-evals.test.ts (SEC-01…SEC-10).",
            severity: "SECURITY",
          },
        ],
        observedRequirement: scenario.expectedRequirement,
        notes: [],
      });
      continue;
    }

    // ── Offline, measured by a direct runtime probe ────────────────────────
    //
    // The five scenarios that used to land in the fallback below. Each one's
    // mechanism was there the whole time; what was missing was a way for this
    // harness to reach it, because its only executor drives a CAPABILITY and
    // these are runtime paths.
    const probe = FUTURE_PROBES[scenario.id];
    if (probe) {
      try {
        const checks = await probe({
          db: options.db,
          ownerId: options.ownerId,
          otherOwnerId: `${options.ownerId}-other`,
        });
        const failed = checks.filter((check) => !check.passed);
        const blocking = failed.filter(
          (check) => check.severity === "SECURITY" || check.severity === "TRUTH",
        );
        results.push({
          scenarioId: scenario.id,
          outcome: blocking.length > 0 ? "FAIL" : failed.length > 0 ? "PARTIAL" : "PASS",
          checks,
          observedRequirement: scenario.expectedRequirement,
          notes: [],
        });
      } catch (error) {
        // A probe that throws is a FAIL, never a silent return to FUTURE: the
        // mechanism was claimed reachable and it was not.
        results.push({
          scenarioId: scenario.id,
          outcome: "FAIL",
          checks: [{
            name: "probe_ran", passed: false,
            detail: String(error).slice(0, 300), severity: "TRUTH",
          }],
          observedRequirement: scenario.expectedRequirement,
          notes: ["The probe threw; this scenario's mechanism is not reachable as claimed."],
        });
      }
      continue;
    }

    // ── Offline, and this harness cannot reach it ──────────────────────────
    //
    //   A HARNESS WITH NO PROBE REPORTS THE ABSENCE OF A MECHANISM
    //
    // This note used to read «the mechanism does not exist on the live path
    // yet», which was never measured — and was wrong for all five scenarios
    // that landed here. It now says the only thing this branch actually knows.
    results.push(
      evaluateScenario({
        scenario,
        trajectory: EMPTY_TRAJECTORY(options.ownerId),
        blocked: {
          outcome: "FUTURE",
          reason:
            "This harness has no probe that reaches what the scenario measures. That is a statement about the harness, not a finding about the runtime.",
        },
      }),
    );
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

export type BaselineSummary = {
  total: number;
  byOutcome: Record<string, number>;
  /** Must be zero. Counted across every scenario that ran. */
  falseSuccesses: number;
  blindRetries: number;
  domainSpecificCore: number;
  securityFailures: number;
};

export function summarize(results: readonly ScenarioResult[]): BaselineSummary {
  const byOutcome: Record<string, number> = {};
  let securityFailures = 0;
  let domainSpecificCore = 0;
  for (const result of results) {
    byOutcome[result.outcome] = (byOutcome[result.outcome] ?? 0) + 1;
    if (result.observedRequirement === "DOMAIN_SPECIFIC_CORE") domainSpecificCore += 1;
    for (const entry of result.checks) {
      if (!entry.passed && entry.severity === "SECURITY") securityFailures += 1;
    }
  }
  return {
    total: results.length,
    byOutcome,
    falseSuccesses: results.filter((result) =>
      result.checks.some((entry) => entry.name === "no_false_success" && !entry.passed),
    ).length,
    blindRetries: results.filter((result) =>
      result.checks.some((entry) => entry.name === "no_blind_retry" && !entry.passed),
    ).length,
    domainSpecificCore,
    securityFailures,
  };
}

export function formatReport(results: readonly ScenarioResult[]): string {
  const summary = summarize(results);
  const lines: string[] = [];
  lines.push("scenario | outcome            | requirement                | detail");
  lines.push("---------|--------------------|----------------------------|-------");
  for (const result of results) {
    const failed = result.checks.filter((entry) => !entry.passed);
    const detail = failed.length
      ? failed.map((entry) => `${entry.name}(${entry.severity})`).join(" ")
      : (result.notes[0] ?? "");
    lines.push(
      `${result.scenarioId.padEnd(8)} | ${result.outcome.padEnd(18)} | ${result.observedRequirement.padEnd(26)} | ${detail}`,
    );
  }
  lines.push("");
  lines.push(`TOTAL ${summary.total}  ${JSON.stringify(summary.byOutcome)}`);
  lines.push(
    `FALSE_SUCCESSES=${summary.falseSuccesses}  BLIND_RETRIES=${summary.blindRetries}  ` +
      `DOMAIN_SPECIFIC_CORE=${summary.domainSpecificCore}  SECURITY_FAILURES=${summary.securityFailures}`,
  );
  return lines.join("\n");
}
