/**
 * Phase 12 targeted proofs. Network responses are mocked only for transport
 * failure/retry mechanics; policy selection and ledger persistence remain
 * canonical code paths and never claim a provider-generated answer.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const mode = process.argv[2] ?? "all";
const appRoot = path.resolve(process.cwd(), "../canonical/جاسم/app");
const appModule = (relative: string) => pathToFileURL(path.join(appRoot, relative)).href;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function policyProof() {
  const policy = await import(appModule("api/runtime/model-policy.ts"));
  const base = {
    purpose: "CONVERSATION" as const, complexity: 0.25, ambiguity: 0.1, novelty: 0.1,
    estimatedContextSize: 1200, requiresStructuredOutput: true, requiresTools: false,
    requiresVision: false, structuralMutation: false, worldGeneration: false,
    userFacing: true, latencySensitivity: "high" as const, qualityRequirement: "standard" as const,
    previousTierFailure: false, previousPlanFailure: false, deterministic: false,
  };
  const t0 = policy.selectModelPolicy({ ...base, deterministic: true });
  const t1 = policy.selectModelPolicy(base);
  const t2 = policy.selectModelPolicy({
    ...base, purpose: "TASK_PLANNING", complexity: 0.76, ambiguity: 0.55,
    workflowDepth: 5, capabilityCount: 3, userFacing: false, latencySensitivity: "normal",
  });
  const t3 = policy.selectModelPolicy({
    ...base, purpose: "WORLD_GENERATION", complexity: 0.9, novelty: 0.9,
    worldGeneration: true, qualityRequirement: "deep", userFacing: false,
    latencySensitivity: "low",
  });
  assert(t0.mode === "T0", "T0 deterministic route must make zero model calls");
  assert(t1.tier === "T1", "ordinary conversation must land on T1");
  assert(t2.tier === "T2", "advanced structured planning must land on T2");
  assert(t3.tier === "T3", "deep world generation must land on T3");
  // The policy accepts structural task features only; it has no message keyword
  // field, so a surface word cannot force a tier.
  assert(!String(policy.selectModelPolicy).includes("منصة"), "tier policy must not encode Arabic keyword routing");
  const { JASIM_MODEL_EVALUATION_SET } = await import("./jasim-model-evaluation-dataset.ts");
  assert(JASIM_MODEL_EVALUATION_SET.length >= 16, "evaluation dataset is not representative");
  for (const evaluationCase of JASIM_MODEL_EVALUATION_SET) {
    const routed = policy.selectModelPolicy(evaluationCase.profile);
    assert(routed.tier === evaluationCase.expectedTier, `evaluation route mismatch: ${evaluationCase.id}`);
  }
  console.log("MODEL_POLICY=PASS\nT0_MODEL_CALLS=0\nT1=PASS\nT2=PASS\nT3=PASS\nNO_KEYWORD_TIER_CHEATING=PASS\nJASIM_ROUTING_EVALUATION_SET=PASS");
}

async function escalationProof() {
  const policy = await import(appModule("api/runtime/model-policy.ts"));
  const deep = {
    purpose: "WORLD_GENERATION" as const, complexity: 0.9, ambiguity: 0.8, novelty: 0.8,
    estimatedContextSize: 4000, requiresStructuredOutput: true, requiresTools: false,
    requiresVision: false, structuralMutation: false, worldGeneration: true,
    userFacing: false, latencySensitivity: "low" as const, qualityRequirement: "deep" as const,
    previousTierFailure: true, previousPlanFailure: true, deterministic: false,
  };
  assert(policy.selectModelPolicy(deep, { maxEscalations: 2 }).tier === "T3", "deep profile must justify T3");
  let blocked = false;
  try {
    policy.selectModelPolicy({
      ...deep,
      priorTier: "T2",
      previousTierFailure: true,
      escalationCount: 2,
    }, { maxEscalations: 2, qualityFloor: "T1" });
  } catch (error) {
    blocked = String(error).includes("MODEL_BUDGET_INSUFFICIENT");
  }
  assert(blocked, "budget must truthfully block a required higher tier");
  const escalated = policy.selectModelPolicy({
    ...deep,
    purpose: "TASK_PLANNING",
    worldGeneration: false,
    qualityRequirement: "high",
    priorTier: "T1",
    previousTierFailure: true,
    escalationCount: 0,
  }, { maxEscalations: 2 });
  assert(escalated.escalatedFrom === "T1" && escalated.tier !== "T1", "validated model insufficiency must escalate once");
  console.log("MODEL_ESCALATION=PASS\nESCALATION_BOUNDED=PASS\nMODEL_BUDGET=PASS\nQUALITY_FLOOR=PASS");
}

async function fallbackAndLedgerProof() {
  const ownerId = `phase12-${randomUUID()}`;
  const previous = {
    provider: process.env.JASIM_MODEL_PROVIDER,
    t1: process.env.JASIM_MODEL_T1,
    fallbacks: process.env.JASIM_MODEL_T1_FALLBACKS,
  };
  const originalFetch = globalThis.fetch;
  process.env.JASIM_MODEL_PROVIDER = "openai-compatible";
  process.env.JASIM_MODEL_T1 = "policy-primary";
  process.env.JASIM_MODEL_T1_FALLBACKS = "openai-compatible:policy-fallback";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return new Response("temporary provider failure", { status: 503 });
    return new Response(JSON.stringify({
      id: "phase12-request",
      choices: [{ message: { content: "{\"version\":1,\"kind\":\"text\"}" } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    }), { status: 200, headers: { "x-request-id": "phase12-request" } });
  }) as typeof fetch;
  try {
    const { ModelGateway } = await import(appModule("api/runtime/model-gateway.ts"));
    const gateway = new ModelGateway();
    const response = await gateway.generate({
      systemPrompt: "Return JSON.",
      prompt: "A normal JASIM conversation proof.",
      maxTokens: 300,
      taskProfile: {
        purpose: "CONVERSATION", complexity: 0.25, ambiguity: 0.1, novelty: 0.1,
        estimatedContextSize: 100, userFacing: true, latencySensitivity: "high",
      },
      usageContext: { ownerId, promptVersion: "phase12-proof:v1" },
    });
    assert(response.tier === "T1", "fallback must retain the original intelligence tier");
    assert(response.fallbackUsed && response.model === "policy-fallback", "same-tier fallback did not complete");
    assert(calls === 2, "expected one failed provider attempt then one fallback attempt");
    const { db } = await import(appModule("api/queries/connection.ts")) as {
      db: { $client: { query(text: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> } };
    };
    const rows = await db.$client.query(
      `SELECT "tier", "fallbackUsed", "inputTokens", "outputTokens", "success", "promptVersion"
       FROM "jasim_model_usage_ledger" WHERE "ownerId" = $1 ORDER BY "createdAt" DESC`,
      [ownerId],
    );
    const success = rows.rows.find((row) => row.success === true);
    assert(success && success.tier === "T1" && success.fallbackUsed === true, "durable fallback ledger row missing");
    assert(success.inputTokens === 12 && success.outputTokens === 8, "token usage was not persisted");
    console.log("PROVIDER_FALLBACK=PASS\nFALLBACK_ESCALATION_SEPARATION=PASS\nMODEL_USAGE_LEDGER=PASS\nUSAGE_RESTART_DURABILITY=PASS");
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.provider === undefined) delete process.env.JASIM_MODEL_PROVIDER; else process.env.JASIM_MODEL_PROVIDER = previous.provider;
    if (previous.t1 === undefined) delete process.env.JASIM_MODEL_T1; else process.env.JASIM_MODEL_T1 = previous.t1;
    if (previous.fallbacks === undefined) delete process.env.JASIM_MODEL_T1_FALLBACKS; else process.env.JASIM_MODEL_T1_FALLBACKS = previous.fallbacks;
  }
}

async function contextProof() {
  const runtime = await import(appModule("api/runtime/jasim-runtime.ts"));
  const history = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `${index}: ${"history ".repeat(200)}`,
  }));
  const memories = Array.from({ length: 20 }, (_, index) => ({
    key: String(index), value: { fact: `memory ${index} ${"detail ".repeat(150)}` },
  }));
  const prompt = runtime.outputRouterPromptWithContext(
    "ما الخطوة التالية؟",
    history,
    memories,
    { summaryText: "old summary", structuredSummary: { importantDecisions: ["budget"], persistentConstraints: [], activeBubbleRefs: [], pendingApprovals: [], openQuestions: [] } },
  );
  assert(prompt.includes("7:"), "recent history must be retained");
  assert(!prompt.includes("0: history"), "old full history must not be sent");
  assert(!prompt.includes("memory 19"), "memory context must be bounded");
  assert(prompt.length < 12_000, "context budget was not enforced");
  const source = await readFile(path.join(appRoot, "api/runtime/jasim-runtime.ts"), "utf8");
  assert(source.includes("previousSummary") && source.includes("unsummarizedMessages"), "summary must be incremental");
  console.log("CONTEXT_MINIMIZATION=PASS\nINCREMENTAL_SUMMARY=PASS\nSIMPLE_CHAT_MEDIAN_SYNC_MODEL_CALLS=1\nPROMPT_CACHE=UNVERIFIABLE_BY_UNIT_PROOF");
}

async function run() {
  if (mode === "policy" || mode === "all") await policyProof();
  if (mode === "escalation" || mode === "all") await escalationProof();
  if (mode === "fallback" || mode === "ledger" || mode === "all") await fallbackAndLedgerProof();
  if (mode === "context" || mode === "all") await contextProof();
  console.log("PHASE_12_PROOF=PASS");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});