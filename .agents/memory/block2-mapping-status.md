---
name: Block 2 canonical mapping status
description: Block 2 pre-implementation mapping delivered; STOP instruction active until owner issues final execution order.
---

The Block 2 canonical pre-implementation mapping is complete at `.local/tasks/block2-canonical-mapping.md` (format A–X + §57 counters, per the owner's mapping-instruction document).

**Status (2026-08-23):** The owner's Final Block 2 Execution Order HAS ARRIVED (attached file `Pasted--JASIM-BLOCK-2-FINAL--*.txt`, 123 sections). Implementation is authorized from the accepted mapping — do not re-map, do not reopen Blocks 0/1/1.1, do not write more planning reports.

**Rule:** Implement Phases 4→5→6 exactly per the execution order; deliver ONE final report at `.local/tasks/block2-report.md` (sections A–R + §120 counters), then STOP. Block 3 (payments/ACP/AP2/commissions) is forbidden. Computer Use / AG-UI / OpenTelemetry stay deferred (not failures). Hard fail rules: notification bypass, double-booking, authority expansion, DurableWait restart failure, event-replay double effects, second runtime from MCP/A2A, forged VERIFIED, fabricated location, untrusted URL execution, domain patches for unseen scenarios, fake success.

**Why:** Owner-mandated workflow completed UNDERSTAND → INSPECT → MAP → OWNER REVIEW → EXECUTION ORDER → IMPLEMENT. The execution order is now the governing authority together with the mapping.

**How to apply:** Key targets: ≤8 new tables (10 hard max with justification), ~9 generic primitives max, NEW_EXTERNAL_SDKS=0, one consolidated `test:jasim-block-2` suite on real PostgreSQL, ≥12 unseen operational goals after architecture freeze. Key conclusions from mapping (details in `.local/tasks/block2-canonical-mapping.md`): no new workflow engine/event bus/auth system; thin temporal layer over the existing durable worker (`availableAt` claim loop); MCP+A2A share one `remote_executions` primitive; notifications router dispatch is a legacy side-effect path that must be re-wired behind the executor chain (NOTIFY → resolver → executor → receipt).
