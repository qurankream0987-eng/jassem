---
name: Generated artifact delivery
description: Durable rules for storing and presenting private generated images.
---

Generated image bytes must be saved through Replit App Storage's local sidecar credentials, not ambient Google Application Default Credentials. Receipt data persists only the object reference and integrity metadata; a temporary signed URL may be added when available, but presentation must not depend on it.

**Why:** standard Replit processes do not expose Google ADC. A signed-read request can also be transiently unavailable even when an object was written successfully. Treating either condition as a successful-looking fallback would undermine durable evidence and owner isolation.

**How to apply:** configure `@google-cloud/storage` with the Replit sidecar external-account credential shape. For web preview, resolve an artifact only through an authenticated, owner-scoped route that first validates the run and artifact reference. Keep external search content untrusted, never persist short-lived URLs as durable data, and keep native clients capable of using their authenticated runtime request headers for the same route.