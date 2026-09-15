---
name: Block 3.1 mapping status
description: Outcome of the Block 3.1 canonical reality mapping and the non-obvious structural facts future work must respect.
---

Report: `.local/tasks/block3-1-canonical-mapping.md` (verdict PARTIAL).

Non-obvious durable facts:
- Only `runtime`/`fabric`/`block2` routers are registered (`api/router.ts`); `jasim`/`conversation` routers and `core/planner.ts` are LEGACY/DEAD — never treat their features as live capability.
- Block 3 commerce stack (orders/payments/ledger/subscriptions/payout) is complete but completely unwired from the live conversation path — tests pass, no runtime caller exists. Gap is wiring, not primitives.
- `resumeNode` seam in Block2 worker is never supplied in `boot.ts` — durable DAG resume is intentionally PARTIAL until wired.
- `getPartyLedger` returns aggregated `{currency, kind, totalMinor}` rows (not raw entries) and takes an `{ownerId, party, kind?}` object — subagents repeatedly wrote tests against a guessed positional/row shape.

**Why:** prevents future agents from re-auditing the same ground or trusting legacy paths.
**How to apply:** before claiming a capability exists, trace from a registered router; before writing ledger assertions, read `economic-ledger.ts` signature.
