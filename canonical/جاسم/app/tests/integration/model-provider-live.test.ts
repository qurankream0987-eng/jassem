import { describe, expect, it } from "vitest";
import { modelGateway } from "../../api/runtime/model-gateway";
import { runWithModelCallBudget } from "../../api/runtime/model-call-budget";
import { estimateModelCost } from "../../api/runtime/model-cost";
import { semanticTier, type SemanticModelTier } from "../../api/runtime/model-policy";

/**
 * WAVE 2.1 PARTS 6–8 — real provider acceptance.
 *
 * DOUBLE-GATED, DELIBERATELY. It runs only when `JASIM_LIVE_MODEL_TESTS=1` is
 * set AND a provider credential is present. Either alone is not enough.
 *
 * The gate exists because CI must never depend on uncontrolled model spend.
 * A test suite that quietly bills on every push is a suite people start
 * skipping, and the accounting for "why did the model budget triple" ends in a
 * commit nobody remembers merging. So the default for every offline run —
 * developer laptop, CI, a fresh clone — is skipped, and a live run is something
 * somebody chose.
 *
 * Every request here is deliberately tiny: a handful of tokens in, a ceiling of
 * a few dozen out, one call per tier.
 *
 * TO RUN:
 *   JASIM_LIVE_MODEL_TESTS=1 \
 *   JASIM_MODEL_PROVIDER=<provider> <PROVIDER>_API_KEY=... \
 *   npx vitest run tests/integration/model-provider-live.test.ts
 */

const CREDENTIAL_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "GEMINI_API_KEY",
  "MODEL_GATEWAY_API_KEY",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
] as const;

const hasCredential = CREDENTIAL_VARS.some((name) => Boolean(process.env[name]));
const optedIn = process.env.JASIM_LIVE_MODEL_TESTS === "1";
const LIVE = optedIn && hasCredential;

/** Tier → the env var naming the model for it. Absent means NOT_CONFIGURED. */
const TIER_MODEL_VARS: Record<Exclude<SemanticModelTier, "DETERMINISTIC">, string> = {
  FAST_CHEAP: "JASIM_MODEL_T1",
  BALANCED: "JASIM_MODEL_T2",
  STRONG_REASONING: "JASIM_MODEL_T3",
};

describe("live provider gate", () => {
  it("reports its own state rather than passing silently", () => {
    // This one always runs. A suite that is entirely skipped looks identical to
    // a suite that does not exist, and the difference matters when a report
    // says REAL_PROVIDER_ACCEPTANCE.
    const state = !optedIn
      ? "SKIPPED_NOT_OPTED_IN"
      : !hasCredential
        ? "SKIPPED_NO_CREDENTIAL"
        : "LIVE";
    expect(["SKIPPED_NOT_OPTED_IN", "SKIPPED_NO_CREDENTIAL", "LIVE"]).toContain(state);
    if (state !== "LIVE") {
      // Visible in the run output, so a green suite is never mistaken for
      // real-provider acceptance.
      console.info(`[live-model] ${state} — real provider acceptance was NOT proven by this run.`);
    }
  });
});

describe.skipIf(!LIVE)("PART 7 — real provider smoke", () => {
  it("completes a real FAST_CHEAP call end to end", async () => {
    const response = await runWithModelCallBudget(
      { origin: "TEST", label: "live smoke FAST_CHEAP", maxModelCalls: 2 },
      () =>
        modelGateway.generate({
          prompt: "Reply with the single word: ready",
          systemPrompt: "Answer with one word. No punctuation.",
          responseFormat: "text",
          maxTokens: 16,
          taskProfile: { purpose: "CONVERSATION", complexity: 0.1, qualityRequirement: "standard" },
          usageContext: { promptVersion: "live-smoke:v1" },
        }),
    );

    expect(response.text.length).toBeGreaterThan(0);
    expect(semanticTier(response.tier)).toBe("FAST_CHEAP");
    expect(response.latencyMs).toBeGreaterThan(0);
    expect(response.finishReason).not.toBe("unknown");
    expect(response.provider).toBeTruthy();
    expect(response.model).toBeTruthy();

    // Token counts are asserted as "reported or honestly absent", never as
    // "present and therefore zero".
    if (response.inputTokens !== undefined) expect(response.inputTokens).toBeGreaterThan(0);
    if (response.outputTokens !== undefined) expect(response.outputTokens).toBeGreaterThan(0);

    // No credential may appear anywhere in what JASIM hands back or logs.
    const serialized = JSON.stringify(response);
    for (const name of CREDENTIAL_VARS) {
      const value = process.env[name];
      if (value) expect(serialized).not.toContain(value);
    }
  });

  for (const [tier, envVar] of Object.entries(TIER_MODEL_VARS) as Array<
    [Exclude<SemanticModelTier, "DETERMINISTIC">, string]
  >) {
    it(`${tier}: runs for real, or reports NOT_CONFIGURED`, async () => {
      if (!process.env[envVar]) {
        console.info(`[live-model] ${tier} = NOT_CONFIGURED (${envVar} is unset)`);
        return;
      }
      const response = await runWithModelCallBudget(
        { origin: "TEST", label: `live smoke ${tier}`, maxModelCalls: 2 },
        () =>
          modelGateway.generate({
            prompt: "Reply with the single word: ready",
            systemPrompt: "Answer with one word.",
            responseFormat: "text",
            maxTokens: 16,
            taskProfile: {
              purpose: "CONVERSATION",
              recommendedMinimumTier:
                tier === "FAST_CHEAP" ? "T1" : tier === "BALANCED" ? "T2" : "T3",
            },
            usageContext: { promptVersion: "live-smoke:v1" },
          }),
      );
      expect(semanticTier(response.tier)).toBe(tier);
      expect(response.text.length).toBeGreaterThan(0);
    });
  }
});

describe.skipIf(!LIVE)("PART 8 — real cost validation", () => {
  it("estimates cost deterministically, and says so when it cannot", async () => {
    const response = await runWithModelCallBudget(
      { origin: "TEST", label: "live cost", maxModelCalls: 2 },
      () =>
        modelGateway.generate({
          prompt: "Reply with the single word: ready",
          systemPrompt: "Answer with one word.",
          responseFormat: "text",
          maxTokens: 16,
          taskProfile: { purpose: "CONVERSATION" },
          usageContext: { promptVersion: "live-cost:v1" },
        }),
    );

    const estimate = estimateModelCost({
      provider: response.provider,
      model: response.model,
      inputTokens: response.inputTokens,
      cachedInputTokens: response.cachedInputTokens,
      outputTokens: response.outputTokens,
      reasoningTokens: response.reasoningTokens,
    });

    if (estimate.amount === undefined) {
      // A legitimate outcome: no price configured for this model, or the
      // provider reported no usage. It must stay `undefined` rather than
      // collapsing to a confident 0.
      console.info(
        `[live-model] ESTIMATED_MODEL_COST = UNKNOWN for ${response.provider}/${response.model} ` +
          "(no configured price or no reported usage)",
      );
      expect(estimate.amount).toBeUndefined();
    } else {
      expect(estimate.amount).toBeGreaterThan(0);
      // The same inputs must produce the same number. A cost that varies run to
      // run is not a cost, it is a guess.
      const again = estimateModelCost({
        provider: response.provider,
        model: response.model,
        inputTokens: response.inputTokens,
        cachedInputTokens: response.cachedInputTokens,
        outputTokens: response.outputTokens,
        reasoningTokens: response.reasoningTokens,
      });
      expect(again.amount).toBe(estimate.amount);
    }

    // PROVIDER_BILLED_COST is a separate quantity and JASIM does not have it.
    // No provider returns final billing per call, so the estimate must never be
    // presented as the bill.
    console.info(
      `[live-model] ESTIMATED_MODEL_COST=${estimate.amount ?? "UNKNOWN"} ` +
        "PROVIDER_BILLED_COST=UNAVAILABLE",
    );
  });
});
