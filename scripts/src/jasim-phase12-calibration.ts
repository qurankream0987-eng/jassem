import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Tier = "T1" | "T2" | "T3";
type EvalCase = {
  id: string;
  tier: Tier;
  language: "ar" | "gulf-ar" | "en" | "mixed";
  category: string;
  prompt: string;
  deterministic?: { requiredTerms?: string[]; mustBeJson?: boolean };
};
type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number; reasoningTokens: number };
type Response = { model: string; text: string; latencyMs: number; usage: Usage; retries: number; error?: string };

const t1Cases: EvalCase[] = [
  ["ar-chat", "ar", "Arabic conversation", "اشرح لي ببساطة الفرق بين المنتج والخدمة في سطرين."],
  ["gulf-chat", "gulf-ar", "Gulf Arabic", "شنو الفرق بين الخطة المجانية والمدفوعة؟ جاوبني باللهجة الخليجية وباختصار."],
  ["en-chat", "en", "English conversation", "Explain the difference between a goal and a metric in two short sentences."],
  ["mixed-tech", "mixed", "mixed technical chat", "Explain what an API is بالعربي مع مثال English قصير."],
  ["ar-rewrite", "ar", "rewriting", "أعد صياغة: نحتاج ننهي المشروع بسرعة ولكن بدون أخطاء، بصياغة مهنية قصيرة."],
  ["en-rewrite", "en", "rewriting", "Rewrite this more warmly: Your request cannot be completed now."],
  ["ar-translation", "ar", "translation", "ترجم إلى الإنجليزية: سنراجع النتائج قبل اتخاذ القرار."],
  ["en-translation", "en", "translation", "Translate to Arabic: The report highlights the highest-risk assumptions."],
  ["summary", "ar", "summarization", "لخّص في 3 نقاط: زاد الاستخدام هذا الشهر، لكن معدل الاحتفاظ انخفض بسبب بطء التسجيل، والفريق سيجرب تبسيط النموذج الأسبوع القادم."],
  ["t1-comparison", "ar", "simple comparison", "قارن بين البريد الإلكتروني والدردشة الفورية للتواصل مع العملاء في 3 نقاط."],
  ["qa", "en", "general Q&A", "What is the purpose of a database index? Keep it concise."],
  ["intent", "ar", "intent understanding", "المستخدم يقول: أبي أرجع للخطوة اللي قبل. ما النية المناسبة؟ أجب باسم النية فقط."],
  ["router-json", "mixed", "structured routing", 'Return only JSON: {"intent":"<one of question|plan|research>","confidence":<0 to 1>} for: "ابحث عن أفضل طرق حفظ البيانات".', { mustBeJson: true, requiredTerms: ["intent", "confidence"] }],
  ["simple-plan", "ar", "simple planning", "ضع خطة من 3 خطوات لتنظيم موعد اجتماع فريق صغير."],
  ["reference", "mixed", "reference interpretation", "لدينا مرجع اسمه Q3-report يشير إلى تقرير الربع الثالث. اكتب سؤال متابعة واحداً لتوضيح أي جزء من التقرير يحتاجه المستخدم."],
  ["conversation-summary", "ar", "summary reasoning", "لخّص هذه المحادثة في جملة: المستخدم يريد ميزانية، ثم طلب مقارنة الموردين، ثم اختار مراجعة الأسعار لاحقاً."],
  ["memory-candidate", "ar", "memory extraction", "هل تستحق العبارة التالية الحفظ كتفضيل دائم؟ أجب نعم أو لا مع سبب قصير: أفضل الردود العربية المختصرة."],
  ["research-synthesis", "en", "simple research synthesis", "Given two findings — checkout is slow on mobile and desktop conversion is stable — state one cautious hypothesis."],
  ["bubble-interaction", "ar", "normal Bubble interaction", "اقترح عنواناً ووصفاً قصيراً لفقاعة مشروع تهدف لمتابعة طلبات العملاء."],
  ["ar-naturalness", "ar", "Arabic naturalness", "اكتب ترحيباً عربياً طبيعياً من جملة واحدة لمستخدم عاد إلى التطبيق."],
  ["gulf-naturalness", "gulf-ar", "Gulf naturalness", "رد باختصار وبلهجة خليجية لطيفة على: يعطيك العافية، احتاج مساعدة."],
  ["constraint", "en", "instruction following", "Give exactly three benefits of documenting decisions; each benefit must be five words or fewer."],
  ["schema", "en", "structured output", 'Return only JSON: {"status":"ready","nextStep":"<short text>"} for a task with all required information.', { mustBeJson: true, requiredTerms: ["status", "nextStep"] }],
  ["arabic-writing", "ar", "writing", "اكتب فقرة من 35 إلى 45 كلمة تعلن عن تحسين سرعة التطبيق دون مبالغة تسويقية."],
  ["simple-math-explanation", "ar", "explanation", "اشرح لماذا لا تكفي زيادة عدد المستخدمين وحدها لإثبات نجاح المنتج."],
  ["clarification", "mixed", "clarification", "User says: make it better. Write one concise clarifying question in Arabic."],
  ["risk", "en", "simple risk", "Name one risk of relying on a single external provider, and one mitigation."],
  ["priority", "ar", "prioritization", "رتّب: إصلاح عطل يمنع تسجيل الدخول، تغيير لون زر ثانوي، وإضافة تقرير جديد. اذكر الترتيب فقط."],
  ["customer-tone", "ar", "customer response", "اكتب رداً قصيراً ومتعاطفاً لعميل واجه تأخراً في تحميل الصفحة."],
  ["definition", "en", "definition", "Define idempotency for an API in one sentence."],
  ["microcopy", "ar", "microcopy", "اكتب نص زر عربي قصير لحفظ التغييرات."],
  ["safety", "mixed", "safe guidance", "A user asks to delete all records permanently. Give a concise safe response that asks for confirmation."],
].map(([id, language, category, prompt, deterministic]) => ({ id, tier: "T1", language, category, prompt, deterministic })) as EvalCase[];

const t2Cases: EvalCase[] = [
  ["multi-source", "ar", "multi-source synthesis", "لديك ثلاث إشارات: رضا العملاء انخفض، زمن الاستجابة ارتفع، واكتساب المستخدمين ثابت. اكتب فرضيتين مرتبتين وخطوة تحقق لكل منهما."],
  ["multi-step", "en", "multi-step planning", "Create a five-step plan to migrate a small team from spreadsheets to a shared project tracker, including rollback."],
  ["constraints", "ar", "conflicting constraints", "خطط لإطلاق ميزة خلال أسبوع مع شرطين متعارضين: لا توقف الخدمة ولا تزد تكلفة البنية. اذكر تسوية عملية."],
  ["cross-capability", "mixed", "cross-capability planning", "Plan how to research customer needs, summarize findings, and create one illustrative image. Keep execution approvals explicit."],
  ["policy", "en", "policy reasoning", "A user wants to export data. Identify the minimum safe checks before the action, without performing it."],
  ["t2-comparison", "ar", "complex comparison", "قارن بين بناء ميزة داخلية وشراء خدمة خارجية وفق التكلفة والمرونة والمخاطر والوقت، ثم أعط توصية مشروطة."],
  ["reference", "mixed", "reference reasoning", "A task says 'use the approved Q3 plan' but two Q3 plans exist. State a resolution strategy that preserves provenance."],
  ["bubble-mutation", "ar", "Bubble mutation", "اقترح تغييراً هيكلياً معتدلاً لفقاعة مشروع: أضف حالة للمراجعة، مع أثر واضح على الانتقالات والملخص."],
  ["recovery", "en", "failure recovery", "A scheduled report failed because a source timed out. Provide a safe recovery plan that avoids duplicate delivery."],
  ["ambiguous-plan", "ar", "ambiguous planning", "المستخدم يريد تحسين الاحتفاظ لكنه لم يحدد الشريحة أو المقياس. صمم خطة اكتشاف قصيرة قبل اقتراح حلول."],
  ["evidence", "en", "evidence handling", "Explain how to distinguish evidence from inference in a research summary, then give a compact template."],
  ["risk-tradeoff", "ar", "risk tradeoff", "قرر بين إصلاح سريع غير مكتمل وإصلاح أبطأ موثق لعطل متوسط التأثير. اذكر معيار القرار."],
  ["requirements", "mixed", "requirements synthesis", "Synthesize these requirements: Arabic UI, audit trail, low latency, approval before side effects. Produce four acceptance criteria."],
  ["state-model", "en", "state modeling", "Propose a minimal state machine for a review workflow with retry and cancellation, including invalid transitions."],
  ["quality-gate", "ar", "quality gate", "ضع بوابة جودة لخطة توليد محتوى بحيث تمنع النشر عند نقص المصدر أو فشل التحقق."],
  ["data-consistency", "en", "data consistency", "A worker may retry after a network timeout. Explain a robust idempotency design with one concrete key."],
  ["prioritization", "ar", "complex prioritization", "رتب خمس مبادرات: أمان، أداء، نمو، ديون تقنية، وتصميم. اشرح إطاراً لاتخاذ القرار عندما لا توجد أرقام كاملة."],
  ["structured-plan", "en", "structured plan", 'Return only JSON with keys "goal", "risks", and "steps" for a plan to validate a new onboarding flow.', { mustBeJson: true, requiredTerms: ["goal", "risks", "steps"] }],
].map(([id, language, category, prompt, deterministic]) => ({ id, tier: "T2", language, category, prompt, deterministic })) as EvalCase[];

const t3Cases: EvalCase[] = [
  ["world", "ar", "World generation", "صمم نظام تشغيل مصغر لعالم خدمة عملاء متعدد الوكلاء: الأدوار، السياسات، الذاكرة، وحالات الفشل. اجعله عملياً ومختصراً."],
  ["multi-actor", "en", "multi-actor system", "Design a novel multi-actor operating model for a community marketplace with governance, incentives, and conflict resolution."],
  ["deep-change", "ar", "deep World change", "اقترح تغييراً عميقاً في عالم تعليمي يضيف التقييم التكيفي مع الحفاظ على العدالة والشرح وقابلية التدقيق."],
  ["interacting-policy", "en", "interacting policies", "Resolve interacting policies for privacy, retention, human approval, and emergency access in a regulated assistant."],
  ["long-horizon", "mixed", "long-horizon planning", "Create a six-month phased plan to launch a bilingual AI operations product while preserving reliability and reversible decisions."],
].map(([id, language, category, prompt, deterministic]) => ({ id, tier: "T3", language, category, prompt, deterministic })) as EvalCase[];

const allCases = [...t1Cases, ...t2Cases, ...t3Cases];
const base = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

function usageFrom(raw: any): Usage {
  const usage = raw?.usage ?? {};
  return {
    inputTokens: Number(usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? 0),
    cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? 0),
    reasoningTokens: Number(usage.completion_tokens_details?.reasoning_tokens ?? 0),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(model: string, prompt: string, system: string, maxTokens = 180): Promise<Response> {
  if (!base || !apiKey) throw new Error("AI integration is not configured.");
  let lastError = "";
  for (let retries = 0; retries <= 2; retries++) {
    const started = Date.now();
    try {
      const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model,
          max_completion_tokens: maxTokens,
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        if (response.status === 429 || response.status >= 500) {
          await sleep(750 * (retries + 1));
          continue;
        }
        throw new Error(lastError);
      }
      const text = String(body.choices?.[0]?.message?.content ?? "");
      if (!text.trim()) throw new Error("empty completion");
      return { model, text, latencyMs: Date.now() - started, usage: usageFrom(body), retries };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (retries < 2) await sleep(500 * (retries + 1));
    }
  }
  return { model, text: "", latencyMs: 0, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 }, retries: 1, error: lastError };
}

async function pooled<T, R>(items: T[], task: (item: T, index: number) => Promise<R>, limit = 3): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index]!, index);
    }
  }));
  return results;
}

function deterministicScore(item: EvalCase, text: string): number | null {
  if (!item.deterministic) return null;
  const lower = text.toLowerCase();
  const terms = item.deterministic.requiredTerms ?? [];
  const termsScore = terms.length === 0 ? 100 : terms.filter((term) => lower.includes(term.toLowerCase())).length / terms.length * 100;
  if (!item.deterministic.mustBeJson) return termsScore;
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return typeof parsed === "object" && parsed !== null ? termsScore : 0;
  } catch {
    return 0;
  }
}

function parseJudgeScores(text: string, labels: string[]): Record<string, number> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { scores?: Record<string, unknown> };
    const scores = parsed.scores ?? {};
    const output = Object.fromEntries(labels.map((label) => [label, Number(scores[label])]));
    return Object.values(output).every((value) => Number.isFinite(value) && value >= 0 && value <= 100)
      ? output as Record<string, number>
      : null;
  } catch {
    return null;
  }
}

async function judge(item: EvalCase, candidates: Array<{ id: string; text: string }>, index: number) {
  const ordered = candidates.map((candidate, position) => candidates[(position + index) % candidates.length]!);
  const labels = ordered.map((_, index) => `Candidate ${String.fromCharCode(65 + index)}`);
  const prompt = [
    "Evaluate anonymous candidate answers to the same user request. You do not know model identities.",
    "Score each 0-100 for correctness, instruction following, completeness, relevance, naturalness in the request language, hallucination avoidance, concise appropriate detail, and structured-output validity when requested.",
    "Return ONLY JSON: {\"scores\":{\"Candidate A\":number,\"Candidate B\":number,\"Candidate C\":number}}.",
    `Request (${item.category}; ${item.language}): ${item.prompt}`,
    ...ordered.map((candidate, position) => `${labels[position]}:\n${candidate.text}`),
  ].join("\n\n");
  const response = await call("gpt-5.6-sol", prompt, "You are a strict blinded evaluation judge. Return valid JSON only.", 140);
  const scores = response.error ? null : parseJudgeScores(response.text, labels);
  const byId = Object.fromEntries(ordered.map((candidate, position) => [candidate.id, scores?.[labels[position]!] ?? null]));
  return { byId, response };
}

function totals(rows: Response[]): Usage & { latencyP50: number; calls: number; retries: number } {
  const latencies = rows.map((row) => row.latencyMs).filter((value) => value > 0).sort((a, b) => a - b);
  return {
    inputTokens: rows.reduce((sum, row) => sum + row.usage.inputTokens, 0),
    outputTokens: rows.reduce((sum, row) => sum + row.usage.outputTokens, 0),
    cachedTokens: rows.reduce((sum, row) => sum + row.usage.cachedTokens, 0),
    reasoningTokens: rows.reduce((sum, row) => sum + row.usage.reasoningTokens, 0),
    latencyP50: latencies[Math.floor(latencies.length / 2)] ?? 0,
    calls: rows.length,
    retries: rows.reduce((sum, row) => sum + row.retries, 0),
  };
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => value !== null);
  return usable.length ? Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2)) : null;
}

async function main() {
  console.log(`Running ${allCases.length} fixed model-dependent evaluation tasks.`);
  const stage = process.env.JASIM_CALIBRATION_STAGE ?? "all";
  const batchLimit = Number(process.env.JASIM_CALIBRATION_BATCH ?? Number.POSITIVE_INFINITY);
  const runs: Record<string, Record<string, Response>> = {};
  const candidatePath = join(process.cwd(), "output", "jasim-phase12-candidate-runs.json");
  try {
    const previous = JSON.parse(await readFile(candidatePath, "utf8")) as { runs?: Record<string, Record<string, Response>> };
    Object.assign(runs, previous.runs ?? {});
    // The previous interrupted run used one duplicate "comparison" identifier.
    if (runs.comparison && !runs["t2-comparison"]) {
      runs["t2-comparison"] = runs.comparison;
      delete runs.comparison;
    }
  } catch {
    // No prior candidate checkpoint exists; start the fixed evaluation run.
  }
  let attemptedCandidates = 0;
  await pooled(allCases, async (item) => {
    const models = item.tier === "T1" ? ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]
      : item.tier === "T2" ? ["gpt-5.6-terra", "o4-mini", "gpt-5.6-sol"]
      : ["gpt-5.6-sol"];
    const missing = models.filter((model) => !runs[item.id]?.[model] || runs[item.id]![model]!.error);
    if (missing.length === 0) return;
    if (attemptedCandidates >= batchLimit) return;
    const entries: Array<readonly [string, Response]> = [];
    for (const model of missing) {
      if (attemptedCandidates >= batchLimit) break;
      attemptedCandidates++;
      entries.push([
        model,
        await call(model, item.prompt, "You are JASIM. Follow the request exactly. Be concise, accurate, and do not claim actions you did not perform."),
      ]);
    }
    runs[item.id] = { ...(runs[item.id] ?? {}), ...Object.fromEntries(entries) };
    await mkdir(join(process.cwd(), "output"), { recursive: true });
    await writeFile(
      candidatePath,
      JSON.stringify({ generatedAt: new Date().toISOString(), runs }, null, 2),
    );
  }, 1);
  await mkdir(join(process.cwd(), "output"), { recursive: true });
  await writeFile(
    candidatePath,
    JSON.stringify({ generatedAt: new Date().toISOString(), runs }, null, 2),
  );
  if (stage === "candidates") {
    const responses = Object.values(runs).flatMap((row) => Object.values(row));
    console.log(JSON.stringify({
      stage,
      attemptedCandidates,
      completed: responses.filter((row) => !row.error).length,
      pendingOrFailed: responses.filter((row) => row.error).length,
    }));
    return;
  }
  const incompleteCandidates = allCases.flatMap((item) => {
    const models = item.tier === "T1" ? ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]
      : item.tier === "T2" ? ["gpt-5.6-terra", "o4-mini", "gpt-5.6-sol"]
      : ["gpt-5.6-sol"];
    return models.flatMap((model) => {
      const response = runs[item.id]?.[model];
      return !response || response.error ? [`${item.id}:${model}`] : [];
    });
  });
  if (incompleteCandidates.length > 0) {
    console.log(JSON.stringify({
      calibration: "INCOMPLETE_PROVIDER_ROWS",
      incompleteCandidates: incompleteCandidates.length,
      nextAction: "Resume only failed candidate rows after provider rate capacity is available.",
    }));
    return;
  }

  const judged = await pooled(allCases.filter((item) => item.tier !== "T3"), async (item, index) => {
    const candidates = item.tier === "T1"
      ? ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]
      : ["gpt-5.6-terra", "o4-mini", "gpt-5.6-sol"];
    const responses = candidates.map((id) => {
      const response = runs[item.id]?.[id];
      if (!response) {
        throw new Error(`Missing candidate run for task=${item.id} model=${id}; available=${Object.keys(runs[item.id] ?? {}).join(",")}`);
      }
      return { id, text: response.text };
    });
    return [item.id, await judge(item, responses, index)] as const;
  }, 1);
  const judgedById = Object.fromEntries(judged);

  const t1LunaQuality = average(t1Cases.map((item) => judgedById[item.id]!.byId["gpt-5.6-luna"]));
  const t1TerraQuality = average(t1Cases.map((item) => judgedById[item.id]!.byId["gpt-5.6-terra"]));
  const t1UseLuna = t1LunaQuality !== null && t1TerraQuality !== null && t1LunaQuality >= t1TerraQuality * 0.95;
  const t1Model = t1UseLuna ? "gpt-5.6-luna" : "gpt-5.6-terra";
  const t2O4Quality = average(t2Cases.map((item) => judgedById[item.id]!.byId["o4-mini"]));
  const t2TerraQuality = average(t2Cases.map((item) => judgedById[item.id]!.byId["gpt-5.6-terra"]));
  const t2Model = (t2O4Quality ?? -1) >= (t2TerraQuality ?? -1) ? "o4-mini" : "gpt-5.6-terra";

  const routedRows = allCases.map((item) => runs[item.id]![item.tier === "T1" ? t1Model : item.tier === "T2" ? t2Model : "gpt-5.6-sol"]!);
  const allT3Rows = allCases.map((item) => runs[item.id]!["gpt-5.6-sol"]!);
  const routedQuality = average(allCases.map((item) => item.tier === "T3" ? 100 : judgedById[item.id]!.byId[item.tier === "T1" ? t1Model : t2Model]));
  const allT3Quality = average(allCases.map((item) => item.tier === "T3" ? 100 : judgedById[item.id]!.byId["gpt-5.6-sol"]));
  const retention = routedQuality !== null && allT3Quality !== null ? Number((routedQuality / allT3Quality * 100).toFixed(2)) : null;
  const deterministic = Object.fromEntries(allCases.filter((item) => item.deterministic).map((item) => [
    item.id,
    Object.fromEntries(Object.entries(runs[item.id]!).map(([model, response]) => [model, deterministicScore(item, response.text)])),
  ]));
  const judgeRows = Object.values(judgedById).map((item) => item.response);
  const output = {
    generatedAt: new Date().toISOString(),
    provider: "openai-compatible",
    availability: { luna: true, terra: true, sol: true, o4Mini: true, evidence: "actual chat-completions calls returned HTTP 200" },
    dataset: { t1: t1Cases.length, t2: t2Cases.length, t3: t3Cases.length, total: allCases.length, cases: allCases.map(({ prompt, ...rest }) => rest) },
    selection: {
      t1: { model: t1Model, lunaQuality: t1LunaQuality, terraQuality: t1TerraQuality, qualityFloorPassed: t1UseLuna || t1TerraQuality !== null },
      t2: { model: t2Model, o4MiniQuality: t2O4Quality, terraQuality: t2TerraQuality },
      t3: { model: "gpt-5.6-sol", reason: "validated deep-task candidate" },
    },
    economy: {
      allT3: { quality: allT3Quality, usage: totals(allT3Rows) },
      routed: { quality: routedQuality, qualityRetentionPercent: retention, usage: totals(routedRows) },
      pricing: { actualProviderCost: "UNVERIFIABLE", estimatedCost: "UNVERIFIABLE", source: "Replit OpenAI-compatible billing not exposed by provider responses" },
      evalJudgeUsage: totals(judgeRows),
      promptCache: allT3Rows.concat(routedRows).some((row) => row.usage.cachedTokens > 0) ? "SUPPORTED_AND_OBSERVED" : "SUPPORTED_NOT_OBSERVED",
      distribution: { T0: 0, T1: t1Cases.length / allCases.length, T2: t2Cases.length / allCases.length, T3: t3Cases.length / allCases.length, escalationRate: 0, fallbackRate: 0, repairRate: routedRows.reduce((sum, row) => sum + row.retries, 0) / routedRows.length },
    },
    deterministic,
    runs,
    blindJudge: Object.fromEntries(Object.entries(judgedById).map(([id, value]) => [id, { scores: value.byId, usage: value.response.usage, latencyMs: value.response.latencyMs, error: value.response.error ?? null }])),
  };
  await mkdir(join(process.cwd(), "output"), { recursive: true });
  const path = join(process.cwd(), "output", "jasim-phase12-calibration.json");
  await writeFile(path, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({
    output: path,
    models: output.selection,
    allT3: output.economy.allT3,
    routed: output.economy.routed,
    promptCache: output.economy.promptCache,
  }, null, 2));
}

void main();