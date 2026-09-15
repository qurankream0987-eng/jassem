---
name: Phase K-N completion
description: Phases K through N complete — openai-chat provider, adversarial hardening, production hardening, E2E integration proof.
---

## What was built

### Phase K — One Real Provider
- `openai-chat` registered in `capability-registry.ts` with aliases (ai-chat, ai-generate, etc.)
- Uses `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`; graceful stub if env vars missing
- Model: `gpt-5.6-luna`; required input: `prompt`; returns `{ kind, completion, model, usage, finishReason, taskId, stepId }`
- Full pipeline proof passes with real Arabic OpenAI completion

### Phase L — Adversarial Generalization (10/10 tests)
- Oversized inputs (>64KB) rejected by `validateTrustedCapabilityInputs`
- Missing required inputs rejected by input contract
- Unregistered capabilities fail `executeTrustedCapability`
- Double-resume of consumed approval throws
- Re-executing completed run is idempotent (returns `completed`)
- Reconciling non-terminal run rejected
- Cross-owner run access rejected (owner isolation)
- Prompt injection passes validation (content is opaque to registry)

### Phase M — Production Hardening
- `api/lib/rate-limiter.ts` — sliding-window in-memory rate limiter; 120 req/min prod, 600 dev
- `api/lib/trpc-error-handler.ts` — masks INTERNAL_SERVER_ERROR messages + strips stack traces in prod
  - **Critical**: `isProd()` reads `process.env.NODE_ENV` at call time (not module load), so tests can override it
- `boot.ts` wires: rate limiter on `/api/trpc/*`, 2MB body cap for tRPC, `trpcOnError` + `trpcErrorFormatter` in `fetchRequestHandler`

### Phase N — End-to-End Integration (8/8 layers)
- Full pipeline verified: conversation → run → seed → resume → execute → receipt → reconcile → message
- Idempotency: same `idempotencyKey` returns same run
- Owner isolation: User B cannot access User A's run

**Why:** All phases of the CANONICAL COMPLETION DIRECTIVE (A–N) are now proven and hardened.

## New proof scripts
- `scripts/src/jasim-openai-capability-proof.ts` → `test:jasim-openai-capability`
- `scripts/src/jasim-adversarial-proof.ts` → `test:jasim-adversarial`
- `scripts/src/jasim-production-hardening-proof.ts` → `test:jasim-production-hardening`
- `scripts/src/jasim-e2e-integration-proof.ts` → `test:jasim-e2e`
