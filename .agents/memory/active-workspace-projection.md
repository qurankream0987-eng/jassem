---
name: Active Workspace projection
description: Durable boundary for projecting the current generative context without creating a second canonical state model
---

The Active Workspace is a computed, owner-scoped projection over Conversation, Goal/Task, Run, ResultSet, ReferenceBinding, Presentation, approval/action, and World records. It is not a persisted Workspace entity and it must not become a second source of business truth.

**Why:** The visual Workspace is a presentation surface; persisting it separately would duplicate state, create identity drift across web/mobile, and weaken the existing conversation/result/run continuity guarantees.

**How to apply:** Build the projection on demand from existing canonical rows, preserve the canonical ResultSet and reference IDs, derive status/attention from current lifecycle state, and omit references whose targets cannot be proven available in the authorized scope.