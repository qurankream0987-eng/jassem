---
name: Living Object Rail boundary
description: Durable client/server boundary for presenting generic Living Objects on Web.
---

The Active Objects Rail is a presentation index over the server-owned Living Object projection. It may own collapse, hover, focus, and temporary open animation, but it must not own status, attention, progress, eligibility, identity, or lifecycle actions.

**Why:** Treating Rail state as canonical creates stale object identities, duplicate approval/process items, and client-only lifecycle transitions that disagree after reload or across devices.

**How to apply:** Query the bounded owner-scoped projection, preserve server order, render one generic item component, and focus the existing Conversation/Workspace context on open. Add no domain-specific Rail components or client lifecycle reducers.