---
name: Discovery follow-up truth
description: Truth constraints for ordinal follow-ups and unavailable external Discovery.
---

Every multi-result follow-up must resolve all ordinal references through canonical bindings and require one shared ResultSet before presenting a comparison.

**Why:** Separate tests for references and presentation can pass while a conversational comparison bypasses the canonical ResultSet path.

**How to apply:** For generic comparison follow-ups, fail with clarification if any reference is missing, ambiguous, or belongs to another ResultSet. Never reconstruct candidates client-side.

An explicit external-only Discovery request with no configured source must return a provider blocker, not a completed empty search.

**Why:** A completed empty result can imply that a live search occurred even when no provider was available.

**How to apply:** Return no candidates, no fabricated commercial fields, no external/live provenance, and no effects.
