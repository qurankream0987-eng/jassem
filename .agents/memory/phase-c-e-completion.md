---
name: Phase C-E completion
description: What was built in Phases C (Bubble Mutation), D (Conversation Intelligence), E (Semantic Events), F (Approval Resume), G (Trusted Executor)
---

# Phases C through G — Completed

## Phase C — Smart Bubble Generative Mutation
- New DB table: `jasim_runtime_bubble_versions` (migration 0002)
- Functions: `generateBubbleMutation`, `previewBubbleMutation`, `applyBubbleMutation`, `listBubbleContentVersions`
- tRPC: `bubblesMutateGenerate`, `bubblesMutatePreview`, `bubblesMutateApply`, `bubblesMutateVersionsList`
- Optimistic lock via fromVersion matching
- Proof: `scripts/src/jasim-bubble-mutation-proof.ts`

## Phase D — Conversation Intelligence
- `buildConversationHistory` — loads last 8 messages for prompt enrichment
- `retrieveUserMemories` — loads recent memories from `memory_entries` table
- `extractAndStoreConversationMemories` — fire-and-forget LLM extraction
- Flag: `JASIM_DISABLE_MEMORY_EXTRACTION=1` disables extraction in test contexts (world-runtime proof sets this)
- messages.ownerId is PgVarchar (string) — never pass toNumId() to eq() for this column

## Phase E — Runtime Semantic Events
- Functions: `createRuntimeSemanticEvent`, `listRuntimeSemanticEvents`
- Event types: CONVERSATION_TURN_ROUTED, BUBBLE_MUTATION_GENERATED, BUBBLE_MUTATION_APPLIED, BUBBLE_MUTATION_PREVIEWED, CONVERSATION_MEMORY_STORED, PLAN_RESUMED, PLAN_APPROVAL_CONSUMED
- Events table: no conversationId column; use correlationId (varchar 100) to store it
- BUBBLE_MUTATION_APPLIED emitted atomically inside applyBubbleMutation transaction
- tRPC: `eventsListSemantic`
- Proof: `scripts/src/jasim-semantic-events-proof.ts`

## Phase F — Approval Resume
- `resumeApprovedPlan(proposalId, ownerId)` — blocked/awaiting_input → "ready", consumes approval
- `seedAuthorizedProposalApproval(...)` — test/dev helper to seed proposal+approval state with capabilityId
- RuntimeRunStatus valid values: created, awaiting_input, ready, awaiting_approval, scheduled, running, waiting, blocked, verifying, completed, failed, cancelled — NO "approved"
- tRPC: `proposalsResume`
- Proof: `scripts/src/jasim-approval-resume-proof.ts`

## Phase G — Trusted Executor
- `materializeApprovedRunDag(runId, ownerId)` — creates DAG nodes from run's authorized proposals
- `driveRunToCompletion(runId, ownerId, workerId?)` — loops executeRuntimeDagNode until terminal
- `executeApprovedRun(runId, ownerId)` — materialize + drive, idempotent
- Gate insight: `evaluateDagNodeGate` allows nodes WITHOUT proposalId if capability is trusted (local-analysis / local-calculation)
- tRPC: `runsMaterializeDag`, `runsExecute`
- Proof: `scripts/src/jasim-trusted-executor-proof.ts`

**Why:** Fire-and-forget memory extraction must never intercept mocked fetch in proofs. The JASIM_DISABLE_MEMORY_EXTRACTION flag is the correct pattern. All new proofs should use this flag by default to avoid mock fetch sequence corruption.

**How to apply:** Any new routing test proof must set JASIM_DISABLE_MEMORY_EXTRACTION=1. Always use seedAuthorizedProposalApproval for Phase F/G state setup. evaluateDagNodeGate allows non-proposal nodes for safe capabilities.
