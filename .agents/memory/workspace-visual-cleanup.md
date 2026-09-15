---
name: Workspace visual cleanup
description: Prevent stale visual transition cleanup from restoring an older Workspace surface.
---

Disposable Workspace transition cleanup must be scoped by conversation identity, presentation identity, and transition classification. A delayed timer or effect cleanup may remove only the visual state it created; it must never restore an older presentation.

**Why:** Workspace truth remains server-owned and can change again while an EXIT or MORPH animation is still running. Unscoped cleanup can make an obsolete surface reappear after a newer projection has already won.

**How to apply:** Use a transition token plus effect cleanup for temporary DOM shells, include conversation and presentation identity in the lifecycle dependencies, and render the current projection rather than caching outgoing content.