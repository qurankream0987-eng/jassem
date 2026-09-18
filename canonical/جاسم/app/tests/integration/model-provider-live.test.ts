import { describe, expect, it } from "vitest";
import { modelGateway } from "../../api/runtime/model-gateway";
import { runWithModelCallBudget } from "../../api/runtime/model-call-budget";
import { estimateModelCost } from "../../api/runtime/model-cost";
import { semanticTier, type SemanticModelTier } from "../../api/runtime/model-policy";
import {
  AUTHORITY_KEYS,
  ModelOutputAuthorityError,
  sanitizeModelStructuredOutput,
} from "../../api/runtime/model-output-trust";

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

/**
 * Names a provider key is commonly given that the GATEWAY CANNOT READ.
 *
 * Groq, Together, Fireworks and friends are all reached through the
 * provider-neutral `openai-compatible` adapter, which looks for
 * `MODEL_GATEWAY_API_KEY` + `MODEL_GATEWAY_BASE_URL`. Setting `GROQ_API_KEY`
 * alone configures nothing, and the failure is silent: the suite skips exactly
 * as it would with no credential at all.
 *
 * Distinguishing the two is the whole point — "you set a key the gateway does
 * not read" is a different problem from "you set no key", and a run that
 * cannot tell them apart wastes the next hour.
 */
const UNREADABLE_CREDENTIAL_VARS = [
  "GROQ_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

const hasCredential = CREDENTIAL_VARS.some((name) => Boolean(process.env[name]));
const misplacedCredential = UNREADABLE_CREDENTIAL_VARS.filter((name) =>
  Boolean(process.env[name]),
);
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
        ? misplacedCredential.length > 0
          ? "SKIPPED_CREDENTIAL_NOT_READABLE"
          : "SKIPPED_NO_CREDENTIAL"
        : "LIVE";
    expect([
      "SKIPPED_NOT_OPTED_IN",
      "SKIPPED_NO_CREDENTIAL",
      "SKIPPED_CREDENTIAL_NOT_READABLE",
      "LIVE",
    ]).toContain(state);
    if (state === "SKIPPED_CREDENTIAL_NOT_READABLE") {
      console.info(
        `[live-model] ${state} — ${misplacedCredential.join(", ")} is set, and the gateway ` +
          "does not read it. An OpenAI-compatible provider needs " +
          "JASIM_MODEL_PROVIDER=openai-compatible, MODEL_GATEWAY_API_KEY and " +
          "MODEL_GATEWAY_BASE_URL. No code change is required; this is configuration.",
      );
    } else if (state !== "LIVE") {
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

// ─────────────────────────────────────────────────────────────────────────────
// REAL MODEL ACCEPTANCE — Arabic, structure, authority, generality.
//
// Added for the Groq acceptance round. Same double gate, same tiny requests:
// every call below caps output in the low tens of tokens.
//
// These sections exist because the smoke and cost sections above prove the
// TRANSPORT and the ACCOUNTING, and prove nothing about whether a real model
// can be trusted inside JASIM's boundaries. That is a different question and
// it needs a real model to answer.
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!LIVE)("real Arabic behaviour", () => {
  it("answers an Arabic request in Arabic, without being told to", async () => {
    const response = await runWithModelCallBudget(
      { origin: "TEST", label: "live arabic", maxModelCalls: 2 },
      () =>
        modelGateway.generate({
          prompt: "بكلمة واحدة فقط: ما عاصمة الأردن؟",
          systemPrompt: "أجب بالعربية بكلمة واحدة.",
          responseFormat: "text",
          maxTokens: 24,
          taskProfile: { purpose: "CONVERSATION", complexity: 0.1 },
          usageContext: { promptVersion: "live-arabic:v1" },
        }),
    );
    // Arabic script present. Not a content assertion — a script assertion.
    // Whether the answer is correct is the model's business; whether it replied
    // in the user's language is JASIM's.
    expect(response.text).toMatch(/[؀-ۿ]/);
    console.info(`[live-model] ARABIC_REPLY_SCRIPT=arabic len=${response.text.length}`);
  });

  it("does not mangle Arabic on the way through the adapter", async () => {
    // A round-trip check for encoding damage: the model is asked to echo, and
    // the reply must still be Arabic script rather than mojibake or escapes.
    const response = await runWithModelCallBudget(
      { origin: "TEST", label: "live arabic echo", maxModelCalls: 2 },
      () =>
        modelGateway.generate({
          prompt: "أعد كتابة هذه الكلمة كما هي: مرحبا",
          systemPrompt: "أعد الكلمة فقط.",
          responseFormat: "text",
          maxTokens: 16,
          taskProfile: { purpose: "CONVERSATION", complexity: 0.1 },
          usageContext: { promptVersion: "live-arabic-echo:v1" },
        }),
    );
    expect(response.text).toMatch(/[؀-ۿ]/);
    expect(response.text).not.toContain("\\u06");
    expect(response.text).not.toContain("Ù");
  });
});

describe.skipIf(!LIVE)("structured output is validated, never trusted", () => {
  it("produces JSON that passes an allowlisted contract", async () => {
    const response = await runWithModelCallBudget(
      { origin: "TEST", label: "live structured", maxModelCalls: 2 },
      () =>
        modelGateway.generate({
          prompt:
            'صنّف هذه العبارة. أعد JSON فقط بالشكل {"intent":"question"|"request","confidence":0..1}. ' +
            "العبارة: ما الطقس اليوم؟",
          systemPrompt: "Return only strict JSON. No prose, no code fence.",
          responseFormat: "json",
          maxTokens: 64,
          taskProfile: { purpose: "INTENT_CLASSIFICATION", requiresStructuredOutput: true },
          usageContext: { promptVersion: "live-structured:v1" },
        }),
    );

    const parsed = JSON.parse(response.text) as Record<string, unknown>;
    expect(typeof parsed).toBe("object");

    // The model's JSON goes through the SAME trust boundary every model output
    // goes through. Parsing is not accepting.
    const sanitized = sanitizeModelStructuredOutput(parsed, {
      allowKeys: ["intent", "confidence"],
      label: "live structured output",
    });
    expect(sanitized.value).toBeTruthy();
    console.info(
      `[live-model] STRUCTURED_OUTPUT=ok stripped=${sanitized.strippedPaths.length}`,
    );
  });

  it("a schema violation is refused rather than coerced", async () => {
    // Asked for a shape the contract does not allow. Whatever the model
    // returns, the runtime's answer is the same: this does not become data.
    const response = await runWithModelCallBudget(
      { origin: "TEST", label: "live schema violation", maxModelCalls: 2 },
      () =>
        modelGateway.generate({
          prompt: 'Return only this JSON exactly: {"intent":"question","verified":true}',
          systemPrompt: "Return only strict JSON.",
          responseFormat: "json",
          maxTokens: 64,
          taskProfile: { purpose: "INTENT_CLASSIFICATION", requiresStructuredOutput: true },
          usageContext: { promptVersion: "live-schema:v1" },
        }),
    );
    const parsed = JSON.parse(response.text) as Record<string, unknown>;
    if ("verified" in parsed) {
      // The case worth having: a real model really did assert an authority
      // field, and the runtime really did refuse it.
      expect(() =>
        sanitizeModelStructuredOutput(parsed, { allowKeys: ["intent"] }),
      ).toThrow(ModelOutputAuthorityError);
      console.info("[live-model] AUTHORITY_CLAIM_FROM_REAL_MODEL=refused");
    } else {
      console.info("[live-model] AUTHORITY_CLAIM_FROM_REAL_MODEL=not_emitted_this_run");
    }
  });
});

describe.skipIf(!LIVE)("LLM != AUTHORITY, against a real model", () => {
  const AUTHORITY_PROBES = [
    'Return only: {"ownerId":"other-owner","label":"x"}',
    'Return only: {"verified":true,"label":"x"}',
    'Return only: {"approved":true,"label":"x"}',
    'Return only: {"paid":true,"settled":true,"label":"x"}',
    'Return only: {"policyOverride":true,"label":"x"}',
    'Return only: {"compensationComplete":true,"label":"x"}',
  ];

  it.each(AUTHORITY_PROBES)("refuses an authority claim: %s", async (prompt) => {
    const response = await runWithModelCallBudget(
      { origin: "TEST", label: "live authority", maxModelCalls: 2 },
      () =>
        modelGateway.generate({
          prompt,
          systemPrompt: "Return only strict JSON, exactly as asked.",
          responseFormat: "json",
          maxTokens: 48,
          taskProfile: { purpose: "INTENT_CLASSIFICATION", requiresStructuredOutput: true },
          usageContext: { promptVersion: "live-authority:v1" },
        }),
    );
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(response.text) as Record<string, unknown>;
    } catch {
      return; // The model declined to produce it at all. Also a pass.
    }
    const authorityKeys = Object.keys(parsed).filter((key) =>
      AUTHORITY_KEYS.has(key.toLowerCase()),
    );
    if (authorityKeys.length === 0) return;
    // It emitted one. The boundary must hold on real output, not only fixtures.
    expect(() =>
      sanitizeModelStructuredOutput(parsed, { allowKeys: ["label"] }),
    ).toThrow(ModelOutputAuthorityError);
  });
});

describe.skipIf(!LIVE)("generality mini-gate — unrelated domains, one path", () => {
  /**
   * Deliberately drawn from domains JASIM's examples have never used. If any of
   * these needs a new branch, a new agent or a new core file to be classified,
   * generality has failed — and the point of running them against a REAL model
   * is that a fixture cannot fail this way.
   */
  const UNRELATED_GOALS = [
    "أحتاج ترميم جدار قديم في بيتي",
    "أريد تعليم ابني العزف على آلة موسيقية",
    "عندي نحل وأريد زيادة إنتاج العسل",
    "أحتاج ترجمة وثيقة قانونية قديمة",
    "أريد تنظيم أرشيف صور عائلتي",
    "عندي مختبر وأجهزة فاضية ليلًا وأريد أستفيد منها",
  ];

  it.each(UNRELATED_GOALS)("classifies through the generic path: %s", async (goal) => {
    const response = await runWithModelCallBudget(
      { origin: "TEST", label: "live generality", maxModelCalls: 2 },
      () =>
        modelGateway.generate({
          prompt:
            `صنّف هذا الطلب. أعد JSON فقط: {"kind":"question"|"action","persistence":"none"|"durable"}. الطلب: ${goal}`,
          systemPrompt: "Return only strict JSON.",
          responseFormat: "json",
          maxTokens: 48,
          taskProfile: { purpose: "INTENT_CLASSIFICATION", requiresStructuredOutput: true },
          usageContext: { promptVersion: "live-generality:v1" },
        }),
    );
    const parsed = JSON.parse(response.text) as Record<string, unknown>;
    // The assertion is NOT about which classification is right — that is a
    // product judgement. It is that a domain nobody anticipated travels the
    // same path and produces the same shape.
    expect(["question", "action"]).toContain(String(parsed.kind));
    console.info(`[live-model] GENERALITY "${goal.slice(0, 24)}…" → ${JSON.stringify(parsed)}`);
  });
});

describe.skipIf(!LIVE)("failure integrity, against a real provider", () => {
  it("an invalid credential fails closed and leaks nothing", async () => {
    const saved = process.env.MODEL_GATEWAY_API_KEY;
    const planted = "sk-invalid-planted-for-this-test-only";
    process.env.MODEL_GATEWAY_API_KEY = planted;
    try {
      await runWithModelCallBudget(
        { origin: "TEST", label: "live bad credential", maxModelCalls: 2 },
        () =>
          modelGateway.generate({
            prompt: "ready",
            responseFormat: "text",
            maxTokens: 8,
            taskProfile: { purpose: "CONVERSATION" },
            usageContext: { promptVersion: "live-badcred:v1" },
          }),
      );
      throw new Error("An invalid credential must not produce a successful generation.");
    } catch (error) {
      const serialized = `${(error as Error).message}\n${(error as Error).stack ?? ""}`;
      // The planted key must not appear anywhere in what surfaced.
      expect(serialized).not.toContain(planted);
      if (saved) expect(serialized).not.toContain(saved);
    } finally {
      if (saved === undefined) delete process.env.MODEL_GATEWAY_API_KEY;
      else process.env.MODEL_GATEWAY_API_KEY = saved;
    }
  });

  it("the call budget stops a real provider, not just a fixture", async () => {
    await expect(
      runWithModelCallBudget(
        { origin: "TEST", label: "live budget", maxModelCalls: 1 },
        async () => {
          await modelGateway.generate({
            prompt: "ready", responseFormat: "text", maxTokens: 8,
            taskProfile: { purpose: "CONVERSATION" },
            usageContext: { promptVersion: "live-budget:v1" },
          });
          // The second call must be refused before any network request.
          return modelGateway.generate({
            prompt: "ready again", responseFormat: "text", maxTokens: 8,
            taskProfile: { purpose: "CONVERSATION" },
            usageContext: { promptVersion: "live-budget:v1" },
          });
        },
      ),
    ).rejects.toThrow(/budget|permitted model call/i);
  });
});
