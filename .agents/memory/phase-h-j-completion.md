---
name: Phases H-J completion
description: What was built in Phases H (Receipt/Reconciliation), I (Frontend Lifecycle UI), J (Mobile Auth)
---

# Phases H through J — Completed

## Phase H — Receipt + Verifier + Reconciliation
- `buildRunReceipt(runId, ownerId)` — aggregates DAG node outputs into a typed `RunReceipt`
- `persistRunOutputs(runId, ownerId, outputs)` — writes aggregated outputs to `runs.outputs`
- `reconcileRunToConversation(runId, ownerId)` — buildReceipt → persist → post assistant message → emit events
- `listRuntimeMessages(input)` — lists messages for a conversation, filtered by conversationId
- Message posted with `role: "assistant", outputKind: "run_receipt"`, metadata includes runId + receiptStatus
- Events: RUN_OUTPUTS_PERSISTED + RUN_RECONCILED
- tRPC: `runsReceipt` (query), `runsReconcile` (mutation)
- Proof: `scripts/src/jasim-receipt-verifier-proof.ts`

## Phase I — Frontend Runtime Lifecycle UI
- `src/hooks/useRunLifecycle.ts` — polls run status, exposes approve/resume/execute/reconcile mutations
- `src/components/runtime/RunLifecycleCard.tsx` — run status card with RTL-native approval/execute/reconcile buttons
- `useJasimChat` — extracts `durable_run` from turn output, stores `activeRuns: ActiveRun[]` in state
- `ChatMessage.tsx` — renders `RunLifecycleCard` for assistant messages with `metadata.runId`
- Proof: visual (screenshot) + typecheck

## Phase J — Mobile Session Auth
- `authenticateRequest` updated — accepts `Authorization: Bearer {token}` FIRST, cookie as fallback
- `/api/runtime/session` POST endpoint added to `boot.ts`:
  - Dev: always returns bearer token for dev:local user
  - Prod: requires valid session cookie, re-issues as bearer
- `runtime-trpc.ts` — `setCallToken(token)` function + `buildHeaders()` adds Bearer to all calls
- `session.tsx` — updated to call `setCallToken` on bootstrap/clear; uses `applyToken()` helper
- `_layout.tsx` — `SessionProvider` now mounted as root wrapper
- Proof: typecheck (Server + App + Mobile = 0 errors)

**Why:**
- Cookie-only auth blocked all native mobile requests (no cookie jar in Expo)
- SessionProvider was defined but never mounted — mobile had no auth bootstrap
- Bearer token flow: POST /api/runtime/session → store in SecureStore → send as Authorization header

**How to apply:**
- All new tRPC procedures remain `authedQuery` — auth is now transparent for mobile via bearer
- New server endpoints should prefer cookie-then-bearer pattern (already in authenticateRequest)
- Never call setCallToken directly from mobile screen code — always via SessionProvider lifecycle
