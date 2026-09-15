---
name: Pre-materialized DAG execution
description: How the executor handles composition runs whose immutable graph exists before the user initiates execution.
---

For a run that already has persisted DAG nodes, execute the graph directly. Only materialize proposal-backed nodes when the owner-scoped run has no graph.

**Why:** Capability compositions can build a complete immutable DAG as part of planning without creating approval proposals. Inferring graph state from a materialization error makes those valid runs fail before their first node.

**How to apply:** Any future executor entry point must inspect the durable run graph first. Keep proposal materialization and graph driving separate, and do not rely on matching error-message text for idempotency.