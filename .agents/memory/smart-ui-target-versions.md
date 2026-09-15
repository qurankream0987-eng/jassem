---
name: Smart UI target versions
description: Generated UI actions must carry the canonical version of their actual target, not the surrounding presentation version.
---

The trusted action envelope must use the version belonging to the referenced canonical object: proposal version for approval/resume, run updated-at lease version for execution/reconciliation, task world version for input, and bubble presentation version for bubble mutations.

**Why:** A single Workspace presentation version can be fresh while the proposal, run, task, or bubble target has changed independently; reusing it creates false stale accepts or false stale rejects.

**How to apply:** Add target-specific versions to the server projection/context before wiring a client action. Keep the dispatcher’s owner-scoped resolver as the final authority and refresh projections after mutation.