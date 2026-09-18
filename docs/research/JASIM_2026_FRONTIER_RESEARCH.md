# JASIM — 2026 FRONTIER RESEARCH

**Date of research:** 2026-09-18 · **Provider connected:** NO · **Code changed:** NONE
**Method:** 15 targeted searches across the 40 areas in the brief; primary sources
(arXiv, vendor engineering blogs, standards bodies, government guidance) preferred
over secondary summaries. Every finding is graded against JASIM's *actual* code,
traced in the gap analysis — not against its documentation.

**A note on how to read this.** The brief said not to copy fashionable
architecture blindly. The most useful result of this research is not a list of
things to build. It is that **four of JASIM's founding invariants have become
industry consensus in 2026 on independent evidence** — and that the largest
real gaps are in places nobody would call fashionable.

---

## 0. THE HEADLINE: WHERE THE FRONTIER MOVED TOWARD JASIM

| JASIM invariant (pre-existing) | 2026 independent confirmation |
|---|---|
| `LLM != Authority` | Self-correction research converged on a "verification bottleneck": models repair an error once its location is supplied but **cannot reliably find it themselves**. Intrinsic self-critique without an external grader yields limited and sometimes *negative* gains. |
| `EXECUTED != VERIFIED` | Durable-execution vendors and the saga literature both converged on external confirmation + compensation rather than trusting a call's return. SagaLLM formalizes this for LLM workflows. |
| Untrusted external content is fenced, never authority | MCP tool descriptions were formally classified by Microsoft (June 2026) as **supply-chain assets**; OWASP made tool poisoning #3 in its MCP Top 10; NSA issued MCP security guidance. |
| Model never emits executable UI | Generative-UI practice split into three tiers, and the *static* tier — agent selects a predefined component and fills it with data — is what production systems actually ship. |

**This is the single most important research finding.** JASIM did not miss the
frontier on execution truth; it arrived early. The gaps are elsewhere.

---

## 1. AGENT RUNTIMES & DURABLE EXECUTION

**SOURCE:** [Temporal — Durable Execution meets AI](https://temporal.io/blog/durable-execution-meets-ai-why-temporal-is-the-perfect-foundation-for-ai) · [Durable AI agents in 2026 (Temporal, Inngest, DBOS, Restate)](https://www.reactify-solutions.com/articles/durable-ai-agents-2026) · [Zylos — Durable Execution for Agent Runtimes](https://zylos.ai/research/2026-04-27-durable-execution-agent-runtimes/) · [Spheron — Orchestration on GPU Cloud](https://www.spheron.network/blog/ai-agent-workflow-orchestration-temporal-inngest-restate-gpu-cloud/)
**DATE:** 2026-04 → 2026-06
**IDEA:** Journal every step; resume from the last checkpoint after any crash.
Separate deterministic workflow code from non-deterministic activities. The 2026
enterprise RFP question has moved from "how do you handle a 90-second LLM
timeout" to "**which durable runtime, and what is the replay story**".
**MATURITY:** Production standard.
**WHY IT MATTERS TO JASIM:** This is the baseline JASIM is measured against.
**DOES JASIM HAVE IT?** **YES, and independently derived.** Fenced leases,
`fenceVersion`, `leaseToken`, an immutable `execution_attempts` ledger,
idempotency keys scoped `run:node:fenceVersion`, `runtime_jobs` with CAS claim,
`resumeScheduledRuntimeRun`, and `reconcileUncertainAttempt`. JASIM additionally
has something the vendors do **not** ship: a distinction between *the activity
returned* and *the effect occurred*.
**RECOMMENDATION:** **REJECT adoption of an external engine.** Replacing this
with Temporal would be an architecture rewrite that buys replay JASIM already has
and *loses* the completion policy. **ADAPT one idea:** explicit replay
determinism testing.

---

## 2. CONTEXT ENGINEERING

**SOURCE:** [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) · [Slipstream: Trajectory-Grounded Compaction Validation (arXiv 2605.08580)](https://arxiv.org/pdf/2605.08580) · [Less Context, Better Agents (arXiv 2606.10209)](https://arxiv.org/pdf/2606.10209) · [LOCA-bench (arXiv 2602.07962)](https://arxiv.org/pdf/2602.07962)
**DATE:** 2026-02 → 2026-06
**IDEA:** Three named techniques — **compaction** (summarize near the window
limit and reinitialize), **structured note-taking** (write findings to durable
storage, not to context), **subagents** (focused windows returning 1–2k-token
condensed summaries). Anthropic's Memory for Managed Agents (public beta,
2026-04-23) stores cross-session learning as files with per-write audit logs;
Rakuten reported a 97% error-rate reduction attributed to agents not re-learning.
**MATURITY:** Production (Anthropic), active research (validation of compaction).
**WHY IT MATTERS:** JASIM's turn loads history + memories + summary in parallel
and concatenates them into a prompt.
**DOES JASIM HAVE IT?** **PARTIALLY.** Compaction exists (durable conversation
summaries). Structured note-taking exists *accidentally and better than most* —
canonical run/node/attempt rows **are** the durable notes, and they are typed.
**Salience-based retrieval does not exist**: memories are loaded, not selected.
**RECOMMENDATION:** **ADAPT.** Do not adopt a file-based memory store; JASIM has
a typed relational one. Adopt **retrieval by salience** and **reference-preserving
compaction** (§7 of the gap analysis). Slipstream's finding — that compaction must
be *validated against the trajectory* — maps directly onto JASIM's stable
references: a summary that drops a reference silently breaks `ReferenceBindings`.

---

## 3. MODEL ROUTING & CASCADES

**SOURCE:** [Cluster, Route, Escalate (arXiv 2606.27457)](https://arxiv.org/pdf/2606.27457) · [UCCI: Calibrated Uncertainty for Cost-Optimal Cascade Routing (arXiv 2605.18796)](https://arxiv.org/pdf/2605.18796) · [Is Escalation Worth It? Decision-Theoretic Characterization of LLM Cascades (arXiv 2605.06350)](https://arxiv.org/pdf/2605.06350)
**DATE:** 2026-05 → 2026-06
**IDEA:** Do not pre-classify. Send everything to the cheap model, estimate
quality, escalate only what fails a threshold. UCCI calibrates token-level margin
uncertainty to a per-query error probability via isotonic regression and picks the
escalation threshold by constrained cost minimization. Reported 97–99% accuracy at
a fraction of frontier cost.
**MATURITY:** Strong research, early production.
**WHY IT MATTERS:** JASIM's Model Gateway already routes by *declared* task
profile (`complexity`, `requiresStructuredOutput`, `worldGeneration`) to semantic
tiers T0–T3, with per-tier fallbacks and a usage ledger.
**DOES JASIM HAVE IT?** **Routing YES, escalation NO.** JASIM chooses a tier
*a priori* from a profile the caller declares. There is no post-hoc quality check
and no escalation path.
**RECOMMENDATION:** **ADAPT, carefully, and later.** The cascade's escalation
signal is a *quality judgement*, and in JASIM a quality judgement must never
become an authority judgement. The safe form: escalate on **schema-validation
failure and low structured-output confidence**, which JASIM can measure without a
judge model — not on a second model grading the first. A judge model that can
promote an answer is an LLM acquiring authority by the back door.
**Requires a provider to validate.**

---

## 4. MEMORY ARCHITECTURES

**SOURCE:** [Memory in the Age of AI Agents: A Survey (paper list)](https://github.com/Shichun-Liu/Agent-Memory-Paper-List) · [CoALA: Cognitive Architectures for Language Agents (arXiv 2309.02427)](https://arxiv.org/pdf/2309.02427) · [Memanto: Typed Semantic Memory with Information-Theoretic Retrieval (arXiv 2604.22085)](https://arxiv.org/pdf/2604.22085) · [Benchmark for Procedural Memory Retrieval (arXiv 2511.21730)](https://arxiv.org/pdf/2511.21730) · [mem0 — State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
**DATE:** 2023-09 → 2026
**IDEA:** Five cognitively distinct types — working, sensory, episodic, semantic,
procedural — and five operations: store, retrieve, update, compress, forget. The
survey's sharpest criticism: **"different memory types require different
retrieval logic, and most production systems collapse them into a single
retrieval problem when they're not."** Generative Agents scores by
recency × importance × relevance.
**MATURITY:** Research consensus on taxonomy; production implementations diverge.
**DOES JASIM HAVE IT?** **Working + episodic-as-canonical only.** JASIM has one
memory table (`key`/`value` user memories) plus conversation summaries. It has
**no semantic memory, no procedural memory, and no forgetting policy**. It does
have something the survey's systems mostly lack: a hard wall between *memory* and
*canonical operational truth*, which is the failure mode mem0-style systems hit
when a remembered fact contradicts a live record.
**RECOMMENDATION:** **ADAPT the taxonomy, REJECT the storage model.** JASIM
should type its memories (preference / constraint / entity / procedure) and give
each a TTL, owner and correction path — but memory must stay advisory, never
canonical. This is one of the top-ranked advancements and needs **no provider**.

---

## 5. PROMPT INJECTION & AGENT SECURITY

**SOURCE:** [NSA — MCP Security Guidance (CSI, 2026-06)](https://media.defense.gov/2026/Jun/02/2003943289/-1/-1/0/CSI_MCP_SECURITY.PDF) · [CSA — MCP Tool Poisoning and IDE Auto-Execution (2026-07)](https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-auto-execution-20260701/) · [Microsoft — The state of MCP security in 2026](https://techcommunity.microsoft.com/blog/microsoft-security-blog/the-state-of-mcp-security-in-2026/4531327) · [Dual-LLM pattern in Google ADK (Springer, 2026)](https://link.springer.com/article/10.1007/s10015-026-01152-3) · [IPIGuard: Tool Dependency Graph Defense (arXiv 2508.15310)](https://arxiv.org/pdf/2508.15310) · [The Attack and Defense Landscape of Agentic AI (arXiv 2603.11088)](https://arxiv.org/pdf/2603.11088) · [Benchmarking Security Invariants in MCP-Style Agent Runtimes (arXiv 2606.29073)](https://arxiv.org/pdf/2606.29073)
**DATE:** 2026-03 → 2026-07
**IDEA:** Tool *descriptions* are an unsanitized attack surface — a server embeds
instructions in help text the user never reads. Leading IDEs auto-execute
project-defined MCP servers at developer privilege with no isolation. The
strongest structural defense is the **dual-LLM pattern**: a quarantined model
handles untrusted content and returns only symbolic references; a privileged
model plans and never sees the raw text. MCP servers are now OAuth 2.1 resource
servers with audience-bound tokens.
**MATURITY:** Guidance is authoritative (NSA/Microsoft/OWASP); defenses are mixed.
**DOES JASIM HAVE IT?** **Substantially, and by a different route.** JASIM's
`model-output-trust.ts` rejects authority keys and strips identity keys;
`fenceRetrievedContent` wraps external text in `<<<JASIM-DATA … JASIM-DATA>>>`;
allowlisted `ModelProposal<T>` contracts mean a model emits a *typed proposal*,
not an action; `decidePresentation` is a pure deterministic cascade the model
cannot reach. The `planLocalId` refinement refuses UUID-shaped ids so a model
cannot name a canonical row. **Effectively JASIM already implements the
dual-LLM pattern's guarantee without two models — by making the privileged side
non-LLM code.**
**GAP FOUND:** **MCP tool *descriptions* are not treated as untrusted.** JASIM
consumes `McpToolMetadata` from a provider catalog. Per the 2026 guidance this is
a supply-chain asset requiring review. Ranked in the gap analysis.
**RECOMMENDATION:** **ADOPT** tool-description fencing and an explicit
provider-catalog review gate. **REJECT** the dual-LLM two-model architecture —
JASIM's non-LLM privileged side is strictly stronger and cheaper.

---

## 6. SELF-CORRECTION & REFLECTION

**SOURCE:** [The Self-Correction Illusion: LLMs Correct Others but Not Themselves (arXiv 2606.05976)](https://arxiv.org/pdf/2606.05976) · [When Can LLMs Actually Correct Their Own Mistakes? (TACL)](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00713/125177/When-Can-LLMs-Actually-Correct-Their-Own-Mistakes) · [Beyond Output Critique: Self-Correction via Task Distillation (arXiv 2602.00871)](https://arxiv.org/pdf/2602.00871)
**DATE:** 2026-02 → 2026-06
**IDEA:** The **verification bottleneck**. Models can repair an error once its
location is supplied but cannot reliably locate it. Naive self-reflection
*degrades* accuracy: correct outcomes are talked into being wrong. Gains come
from outside the model — tool-interactive critics, execution signals, environment
feedback.
**MATURITY:** Settled negative result.
**WHY IT MATTERS:** This is the strongest external validation of `LLM != Authority`
available, and it is a *negative* result — the most trustworthy kind.
**DOES JASIM HAVE IT?** **JASIM's architecture is the recommended answer.** The
completion policy is precisely an external, non-model grader whose signal comes
from the environment (a ledger readback, an independent lookup).
**RECOMMENDATION:** **ADOPT the finding as a constraint, REJECT reflection loops.**
Specifically: JASIM must never add a "model reviews its own plan" step. If a
critic is ever added it must be **a different signal, not a second opinion** —
schema validation, constraint checking, simulation against canonical state.

---

## 7. GENERATIVE UI

**SOURCE:** [AG-UI Protocol docs](https://docs.ag-ui.com/introduction) · [OpenUI — The State of Generative UI in 2026](https://www.openui.com/blog/state-of-generative-ui-report) · [CopilotKit — Developer's Guide to Generative UI in 2026](https://www.copilotkit.ai/blog/the-developer-s-guide-to-generative-ui-in-2026) · [Zylos — Agentic UX Frontend Patterns](https://zylos.ai/research/2026-05-28-agentic-ux-frontend-design-patterns-ai-agents/)
**DATE:** 2026-04 → 2026-05
**IDEA:** Three tiers. **Static** — frontend owns components, agent selects and
fills (what production ships). **Declarative** — agent returns a UI spec.
**Open-ended** — agent returns a full surface. AG-UI standardizes a typed SSE
event stream (text deltas, tool-call events, state sync, lifecycle, **interrupt
signals**) with 40+ framework integrations as of 2026-05.
**MATURITY:** AG-UI is an emerging de-facto standard; open-ended tier is risky.
**DOES JASIM HAVE IT?** **JASIM is at the static tier and ahead of it.**
`decidePresentation` is a *deterministic* function over runtime state producing
one of 40 primitives — the model does not even select the component, which is
stronger than AG-UI's static tier. Living Objects, morph transitions
(ENTER/UPDATE/MORPH/EXIT/NO_CHANGE) and the Active Workspace have no equivalent
in the surveyed systems.
**GAP FOUND:** **No streaming.** AG-UI's whole premise is incremental events.
JASIM computes a presentation once per turn and returns it. For a long run this
means silence.
**RECOMMENDATION:** **ADAPT the transport, REJECT the authority model.** JASIM
should stream *presentation transitions* — which it already has as a typed
vocabulary — over SSE. It must not adopt AG-UI's assumption that the agent picks
the component.

---

## 8. AGENT PAYMENTS & AGENTIC COMMERCE

**SOURCE:** [AP2 Protocol documentation](https://ap2-protocol.org/) · [Agentic payments protocols compared (MPP, ACP, AP2, x402)](https://www.crossmint.com/learn/agentic-payments-protocols-compared) · [Orium — Agentic Payments Explained](https://orium.com/blog/agentic-payments-acp-ap2-x402) · [Agentic Payments in 2026: AP2, ACP and x402](https://dev.to/lusivision/agentic-payments-in-2026-ap2-acp-and-x402-explained-2pkb)
**DATE:** 2026
**IDEA:** AP2 (Google + 60 partners) defines **cryptographically signed
mandates**: a user attests to a transaction intent, with spending limits, allowed
merchants and validity periods; portable, verifiable, revocable. x402 (Coinbase)
revives HTTP 402 for machine-to-machine stablecoin microtransactions (~165M agent
transactions in its first months). Production mixes card-rail authorization with
stablecoin settlement only in research deployments.
**DOES JASIM HAVE IT?** **The concept, yes; the protocol, no.** JASIM's
`financial-mandate.ts`, approval records with `executionFingerprint`, expiry and
`consumedAt`, and the payout model already express a bounded, revocable,
fingerprint-bound authorization. AP2 is the *interoperable wire format* for
exactly that.
**RECOMMENDATION:** **ADAPT later, do not adopt now.** JASIM's mandate is
internal and stronger (it binds to an execution fingerprint, not just a merchant
list). AP2 matters when JASIM transacts with *other* agents. Note the shape now so
the internal mandate can be expressed as an AP2 mandate without a rewrite.
**Requires real payments — explicitly out of scope.**

---

## 9. EVALUATION

**SOURCE:** [τ-bench enterprise guide](https://www.automationanywhere.com/company/blog/product-insights/ai-agent-benchmark) · [Towards a Science of AI Agent Reliability (arXiv 2602.16666)](https://arxiv.org/pdf/2602.16666) · [Beyond Function Calling: Tool-Environment Unreliability (arXiv 2606.25819)](https://arxiv.org/pdf/2606.25819) · [AgentProp-Bench: Judge Reliability and Propagation Cascades (arXiv 2604.16706)](https://arxiv.org/pdf/2604.16706) · [OpenClawBench: Process-side Anomalies in Execution Trajectories (arXiv 2605.29253)](https://arxiv.org/pdf/2605.29253)
**DATE:** 2026-02 → 2026-06
**IDEA:** Final-answer pass/fail misses trajectory quality, tool-call
correctness, looping and recovery. **Trajectory-aware** evaluation catches a
right answer reached by a wrong path. ToolBench-X injects *recoverable* hazards
to measure diagnosis and recovery rather than happy-path completion. The 2026
framing: judged not on producing the right answer once but "consistently, through
the right path, at production speed".
**DOES JASIM HAVE IT?** **NO — and it has the rarest prerequisite.** JASIM has no
eval harness. But the immutable attempt ledger, run events, proposals, approvals
and verification details **are a trajectory record by construction**. Most teams
building trajectory evals must first build the trace. JASIM only has to read it.
**RECOMMENDATION:** **ADOPT.** Highest-value provider-free work available. The 30
behavioural examples become the first frozen benchmark; the ledger becomes the
trajectory; `false-success rate` is directly measurable because the completion
policy distinguishes PENDING from VERIFIED.

---

## 10. OBSERVABILITY

**SOURCE:** [OpenTelemetry — Inside the LLM Call: GenAI Observability (2026)](https://opentelemetry.io/blog/2026/genai-observability/) · [Dash0 — GenAI Semantic Conventions Explained](https://www.dash0.com/knowledge/opentelemetry-genai-semantic-conventions-explained) · [Datadog — native GenAI semconv support](https://www.datadoghq.com/blog/llm-otel-semantic-convention/) · [Fiddler — Where OTel stops](https://www.fiddler.ai/blog/opentelemetry-ai-observability-guide)
**DATE:** 2026
**IDEA:** `gen_ai.*` spans and metrics; span tree of `invoke_agent` →
`chat` / `execute_tool`; attributes including `gen_ai.request.model`,
`gen_ai.usage.input_tokens`, `gen_ai.response.finish_reasons`. Conventions cover
MCP calls. **All still marked "Development", not stable.**
**DOES JASIM HAVE IT?** **Semantically yes, in the wrong shape.** JASIM records
model, tokens, cost and a **normalized `finishReason`** in `model_usage_ledger`,
plus run events. It has richer operational facts than the conventions define —
verification status, approval lineage, provider resolution reason. It has no
trace export.
**RECOMMENDATION:** **ADAPT the vocabulary, do not restructure to it.** Emit
`gen_ai.*` attribute names from the existing ledger so standard backends can read
JASIM; keep JASIM's own richer events. Note Fiddler's point: OTel covers the call,
not the *decision*. JASIM's differentiating telemetry — *why this provider, why
this approval, why inconclusive* — is outside the standard and should stay
first-class.

---

## 11. COST OPTIMIZATION

**SOURCE:** [Prompt Caching in 2026](https://www.digitalapplied.com/blog/prompt-caching-2026-cut-llm-costs-engineering-guide) · [NeuralTrust — LLM Caching Strategies](https://neuraltrust.ai/blog/llm-caching-strategies) · [Mavik Labs — LLM Cost Optimization 2026](https://www.maviklabs.com/blog/llm-cost-optimization-2026)
**DATE:** 2026
**IDEA:** Layer three caches — exact-match, semantic, prefix. Provider prefix
caching gives 50–90% cost reduction; cache writes cost a 25% premium, reads 10%
of base, break-even at 2+ hits. Prompt caching reduces the cost of every call;
semantic caching eliminates some calls entirely.
**DOES JASIM HAVE IT?** **NO caching of any kind.** `model-gateway.ts` contains
no `cache_control`. JASIM *does* have the harder half: budget enforcement that
fails closed, per-attempt ledger rows, and cost aggregation.
**RECOMMENDATION:** **ADOPT prefix caching. REJECT semantic caching, for now.**
Prefix caching is free truth — the same request, cheaper. Semantic caching
returns a *different* question's answer on a similarity score, which in a system
whose whole claim is truthfulness is a correctness risk disguised as a saving. If
ever adopted it must never serve a cached answer across owners or across a
changed canonical state.

---

## 12. DISCOVERY, RETRIEVAL & RANKING

**SOURCE:** [OpenSearch — Reciprocal Rank Fusion for hybrid search](https://opensearch.org/blog/introducing-reciprocal-rank-fusion-hybrid-search/) · [Azure AI Search — Hybrid search scoring (RRF)](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking) · [Hybrid Search: BM25, Vector & Reranking Reference 2026](https://www.digitalapplied.com/blog/hybrid-search-bm25-vector-reranking-reference-2026) · [Supermemory — Hybrid Search Guide (2026-04)](https://supermemory.ai/blog/hybrid-search-guide/)
**DATE:** 2026-02 → 2026-04
**IDEA:** BM25 + vector + RRF reaches 91% recall@10 vs 78% vector-only and 65%
BM25-only. RRF is **normalization-free** — it fuses on rank, not score — which is
why it survives sharding. BM25 is better at exact identifiers; vectors are better
at concepts.
**DOES JASIM HAVE IT?** **No embeddings anywhere in the codebase.**
`searchInternal` is relational. JASIM *does* have the parts that are usually
missing: hard constraints applied **before** ranking, versioned immutable
`ResultSet` rows ("new search = new row, never silent reorder"), per-candidate
trust classes and provenance.
**RECOMMENDATION:** **ADAPT.** RRF is the right fusion because it needs no score
calibration across heterogeneous sources — which is exactly JASIM's situation
(internal rows vs web observations vs MCP providers). **But ranking is not the
gap** (§ gap analysis): the gap is that nothing feeds web results in at all.

---

## 13. A2A / AGENT INTEROP

**SOURCE:** [Linux Foundation — A2A Project launch](https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents) · [A2A surpasses 150 organizations (2026)](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year) · [Governance Gaps in Agent Interoperability Protocols (arXiv 2606.31498)](https://arxiv.org/pdf/2606.31498)
**DATE:** 2026-04 → 2026-06
**IDEA:** Vendor-neutral under the Linux Foundation; Agent Cards as JSON-LD
capability metadata; JSON-RPC 2.0 with an **eight-state task lifecycle**:
submitted, working, input_required, auth_required, completed, failed, canceled,
rejected. 150+ organizations.
**DOES JASIM HAVE IT?** **Yes, structurally.** `ProviderKind.A2A`,
`A2AAgentCardMetadata`, remote execution with its own state machine and
signed receipts.
**FINDING WORTH NOTING:** arXiv 2606.31498 argues MCP, A2A and ACP **cannot
express governance** — no authority, budget or verification semantics in any of
them. JASIM's trust chain is precisely the missing layer. That is a
differentiation argument, not a gap.
**RECOMMENDATION:** **ADAPT** — align remote execution states with A2A's eight so
JASIM can federate; keep JASIM's governance layer above the protocol.

---

## 14. COMPUTER USE & BROWSER AGENTS

**SOURCE:** [Securing Computer-Use Agents: Architecture-Lifecycle Framework (arXiv 2605.07110)](https://arxiv.org/pdf/2605.07110) · [ceLLMate: Sandboxing Browser AI Agents (arXiv 2512.12594)](https://arxiv.org/pdf/2512.12594) · [Untrusted Content Masking for Web Agents with Security Guarantees (arXiv 2607.05277)](https://arxiv.org/pdf/2607.05277) · [Atomicity for Agents: TOCTOU in Browser-Use Agents (arXiv 2603.00476)](https://arxiv.org/pdf/2603.00476)
**DATE:** 2025-12 → 2026-07
**IDEA:** Isolate the browser from the host; log every action for reconstruction;
mask untrusted page content before it reaches the planner. **TOCTOU is a named
class**: the page changes between the agent reading it and acting on it.
**DOES JASIM HAVE IT?** `ProviderKind.COMPUTER_USE` is declared and unimplemented.
**But `BROWSER_SUCCESS != PAID` is already a stated invariant** — JASIM named the
computer-use verification problem before having computer use.
**RECOMMENDATION:** **ADOPT when implemented, and note now:** TOCTOU maps exactly
onto JASIM's `INCONCLUSIVE` — an agent that clicked and then saw the page change
has an uncertain effect, and JASIM already forbids blind retry on those.
**Requires an external provider.**

---

## 15. HUMAN-IN-THE-LOOP & BOUNDED AUTONOMY

**SOURCE:** [Bounded Autonomy for Enterprise AI: Typed Action Contracts (arXiv 2604.14723)](https://arxiv.org/pdf/2604.14723) · [A Decoupled Human-in-the-Loop System for Controlled Autonomy (arXiv 2604.23049)](https://arxiv.org/pdf/2604.23049) · [Faramesh: Protocol-Agnostic Execution Control Plane (arXiv 2601.17744)](https://arxiv.org/pdf/2601.17744) · [Permit.io — HITL for AI agents](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo)
**DATE:** 2026-01 → 2026-04
**IDEA:** `interrupt_before` + checkpoint + webhook + resume. Different oversight
levels at different steps of one workflow. HITL as an **independent system
component** so policy is enforced centrally. High-confidence routine actions run
autonomously; low-confidence or high-risk enter an approval queue.
**DOES JASIM HAVE IT?** **YES, and as a first-class typed object rather than a
graph feature.** Proposals, approvals bound to an `executionFingerprint`, expiry,
single consumption, `awaiting_approval` run status, and a gate evaluated before
every node. Approval in JASIM cannot be replayed or reused — stronger than
checkpoint-resume.
**GAP:** oversight level is currently derived from capability risk, **not from
confidence or cumulative budget**.
**RECOMMENDATION:** **ADAPT** — extend the existing policy decision with
confidence and budget inputs. No new subsystem.

---

## 16. PROACTIVE / AMBIENT AGENTS

**SOURCE:** [Do Proactive Agents Really Need an LLM to Decide When to Wake? (arXiv 2605.30152)](https://arxiv.org/pdf/2605.30152) · [AWS — AgentWatch: proactive monitoring with ambient agents](https://aws.amazon.com/blogs/machine-learning/agentwatch-proactive-aws-monitoring-with-ambient-agents/) · [Gaia2: Benchmarking Agents on Dynamic and Asynchronous Environments (arXiv 2602.11964)](https://arxiv.org/pdf/2602.11964) · [Proactive Agents: Event-Driven and Scheduled Automation](https://tianpan.co/blog/2026-04-16-proactive-agents-event-driven-scheduled-automation)
**DATE:** 2026-02 → 2026-06
**IDEA:** The design principle from arXiv 2605.30152 is the useful one: **keep a
lightweight temporal model always on, and reserve full LLM reasoning for moments
that survive its trigger.** Alert fatigue is the dominant failure mode.
**DOES JASIM HAVE IT?** **More than expected.** `temporal_triggers` supports six
kinds — AT, AFTER, DEADLINE, RECURRING, **CONDITION**, **EVENT** — with CAS
claiming, fire counts and a canonical event bus that wakes EVENT triggers and
subscriptions. This is precisely the "lightweight always-on temporal model".
**GAP:** nothing connects a fired trigger to a *user-facing proactive
conversation turn*, and there is no notification policy governing frequency.
**RECOMMENDATION:** **ADOPT the design principle; the substrate exists.** This is
a much smaller piece of work than the roadmap assumed.

---

## 17. SAGA / COMPENSATION / REPAIR

**SOURCE:** [SagaLLM / Robust Agent Compensation (arXiv 2605.03409)](https://arxiv.org/pdf/2605.03409) · [Zylos — Saga Pattern in Multi-Agent AI Workflows](https://zylos.ai/research/2026-05-31-saga-pattern-distributed-transactions-multi-agent-ai-workflows/) · [microservices.io — Saga](https://microservices.io/patterns/data/saga.html)
**DATE:** 2026-02 → 2026-05
**IDEA:** **"Compensating transactions are not rollbacks. They are real business
operations — refunds, restocks, apology emails — written in normal code that can
fail and must be retried."** AI agents coordinating tool calls *are* distributed
transaction managers; without compensation a half-failed workflow leaves
inconsistent external state.
**DOES JASIM HAVE IT?** **NO, and this is the largest architectural gap found.**
JASIM can now say with authority that an effect occurred (completion policy) and
that a step failed. It has **no concept of undoing an effect that did occur when
a later step fails.** Block 2's multi-leg composite reservations are the one
exception, and they are transactional within one database — not compensable
across providers.
**RECOMMENDATION:** **ADOPT.** A generic `CompensationPolicy` is the natural
sibling of `CompletionPolicy` and the single most important structural
advancement identified. Crucially, **it is provider-free to design and mostly
provider-free to build**, because it is a declaration attached to a capability
plus an executor state machine.

---

## 18. MATCHING MARKETS & OPPORTUNITY (Level 7)

**SOURCE:** [Two-Sided Market Design for Goods with Perishable Utility (arXiv 2511.16357)](https://arxiv.org/pdf/2511.16357) · [Decentralized Decision Making in Two-Sided Manufacturing-as-a-Service Marketplaces (arXiv 2506.12730)](https://arxiv.org/pdf/2506.12730) · [Two-Sided Time-Independent Regret for Matching Markets with Limited Interviews (arXiv 2602.12224)](https://arxiv.org/pdf/2602.12224)
**DATE:** 2025-11 → 2026-02
**IDEA:** The perishable-utility framing is the right abstraction for JASIM:
capacity that expires unused has a utility that decays to zero at a deadline.
Welfare-optimal allocation is combinatorially intractable online; auctions add
latency and exclude small participants. Stable matching gives a tractable,
defensible alternative.
**DOES JASIM HAVE IT?** **Supply side yes, demand side no.** `AvailabilityWindow`
+ `Reservation` with `DOUBLE_BOOKING = 0`, and composite multi-leg reservations
with per-leg policy. Missing: `Opportunity` as a type, demand discovery, expected
economics.
**RECOMMENDATION:** **ADAPT.** Model `Opportunity` on perishable utility —
*unused capacity × expiry × matched need × positive expected economics* — and use
deferred-acceptance-style stable matching rather than an auction, which also
avoids the advertising-authority problem in §19.

---

## 19. SPONSORED DISCOVERY

**SOURCE:** [Sponsored is the New Organic: Implications of Sponsored Results on Quality (arXiv 2407.19099)](https://arxiv.org/pdf/2407.19099) · [Sponsored Question Answering (arXiv 2407.04471)](https://arxiv.org/pdf/2407.04471) · [Optimally Integrating Ad Auction into E-Commerce Platforms (arXiv 2007.09359)](https://arxiv.org/pdf/2007.09359)
**IDEA:** Ads rank by **bid × quality score** (estimated CTR) — monetization
criteria, explicitly not relevance estimation. Engines maintain strict separation
between advertising and algorithmic ranking. arXiv 2407.19099 measures the harm
when that separation erodes on a real marketplace.
**DOES JASIM HAVE IT?** No advertising system exists — correctly, for now.
**RECOMMENDATION:** **ADAPT the separation, REJECT the blended ranking.** JASIM's
stated invariant `SPONSORED != BEST` is stronger than industry practice and
should stay so. The design that follows: `OrganicRanking` computed with no
knowledge of money; `SponsoredRanking` computed separately with a **relevance
floor**; `FinalPresentation` interleaves with mandatory labelling and never lets
a sponsored item displace a better organic one. **A sponsored result must never
be an `actionable` candidate that an autonomous run can select without the owner
seeing the label.** That last sentence is the one that keeps ads out of the
authority chain.

---

## 20. TOOL-USE RELIABILITY

**SOURCE:** [AgentNoiseBench (arXiv 2602.11348)](https://arxiv.org/pdf/2602.11348) · [Beyond Function Calling (arXiv 2606.25819)](https://arxiv.org/pdf/2606.25819) · [A Systematic Survey of Security Threats and Defenses in LLM-Based AI Agents (arXiv 2604.23338)](https://arxiv.org/pdf/2604.23338)
**IDEA:** Benchmarks now inject *recoverable* hazards to measure whether an agent
can diagnose an unreliable tool and adapt, not whether it succeeds on a clean run.
**DOES JASIM HAVE IT?** Provider health states, staleness, bounded retries,
failover, normalized failure categories separating `retryable` from
`allowFailover`, and now completion decisions separating FAILED (retryable) from
INCONCLUSIVE (reconcile-only). **JASIM's handling is ahead of the benchmarks'
assumptions; what it lacks is the measurement.**
**RECOMMENDATION:** fold into the evaluation harness (§9).

---

## SOURCE COUNT

**46 distinct external sources** — 24 arXiv papers, 5 vendor engineering
publications (Anthropic, Temporal, OpenTelemetry, Datadog, Google Open Source),
4 standards/government documents (NSA CSI, Linux Foundation ×2, AP2 protocol),
2 cloud-security research notes (CSA), 2 Microsoft publications (Azure docs,
Security Blog), 1 TACL journal article, 1 Springer journal article, and 7
practitioner references used only for corroboration of production practice.

END OF FRONTIER RESEARCH.
