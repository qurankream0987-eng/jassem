---
name: Living Object canonical links
description: Rules for reconstructing generic Living Objects from existing durable runtime records without inventing cross-domain identity.
---

Living Object projections must deduplicate records only through explicit keys that share the same canonical runtime identity. A legacy `sourceTaskId` or another numeric foreign key must not be treated as a Runtime Task UUID merely because both are called “task.”

**Why:** JASIM contains legacy and canonical runtime persistence with different ID domains. Guessing a relationship can merge unrelated objects, leak misleading references, and make reload/device reconstruction unstable.

**How to apply:** Prefer explicit runtime `taskId`, `worldId`, `bubbleId`, or `runId` relationships. If a legacy relationship cannot be proven against the canonical runtime table, keep the object separate and expose only its own owner-scoped reference.