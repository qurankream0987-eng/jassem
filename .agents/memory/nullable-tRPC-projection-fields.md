---
name: Nullable tRPC projection fields
description: Shared runtime projection contracts must match nullable wire values produced by the canonical API.
---

Canonical runtime projections may encode an absent optional field as `null` at
the tRPC/SuperJSON boundary, even when the server builder represents it as
`undefined`. Shared client-safe schemas must accept that wire representation
and keep the field semantically optional.

**Why:** Mobile validation failed closed on real `activeLivingObjects` rows
whose action-derived progress was absent and arrived as `null`; this made the
entire projection appear invalid even though the canonical data was valid.

**How to apply:** When adding or changing an optional field in a shared
server/mobile projection, test the exact serialized response shape, including
`null`, rather than validating only the in-process TypeScript shape.