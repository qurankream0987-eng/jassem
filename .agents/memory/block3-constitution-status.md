---
name: Block 3 constitution status
description: Block 3 (agentic commerce/payment/economics/billing) implementation state and its hard boundaries.
---

Block 3 was EXECUTED under the owner's FINAL EXECUTION ORDER (mapping at `.local/tasks/block3-canonical-mapping.md`, report at `.local/tasks/block3-report.md`).

**Why:** the constitution forbids Block 3 code/migrations/SDKs without an explicit owner execution order; that order arrived and has been implemented, so the "mapping-only" restriction no longer applies — but the boundaries below remain permanent.

**How to apply:**
- Production PSP access stays BLOCKED_BY_PROVIDER: only the CONTROLLED_TEST_PROVIDER (real HTTP, test-scoped) exists. No live PSP, no real money without a NEW owner order.
- ACP/AP2 remain DEFERRED (adapter-compatible seams only).
- Money is canonical integer minor units + currency (KWD=3); never reintroduce float money paths.
- The economic ledger is append-only; refunds/adjustments are new entries, never rewrites.
- Payment truth requires a mandatory durable provider identity plus provider-payment id/reference binding; unidentified or cross-provider readbacks fail closed.
- Schema changes after a shipped migration must use a new forward migration; never amend an already-recorded migration.
- The Block 3 fabric currently uses 0009 plus the forward provider-binding migration; any new financial table needs owner justification against the 13-table ceiling.
