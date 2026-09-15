---
name: Workspace morphing continuity
description: Logical replacement of the current Workspace presentation while preserving server-owned operational context.
---

Workspace morphing must be a deterministic presentation projection: compare semantic primitive plus canonical context identity, replace the current surface, and retain only presentation metadata locally. Older same-conversation projections must not replace newer context; an older response should be ignored or shown as a safe refresh state rather than cached as client truth.

**Why:** Workspace history is already represented by Conversation, while goal, ResultSet, references, approval, run, transaction, and World continuity belong to the server projection. Duplicating them in React creates identity drift and stale follow-up behavior.

**How to apply:** Build identity from the existing projection and presentation version, use canonical freshness for same-conversation stale protection, reset metadata on conversation changes, and never create domain-specific morph maps.