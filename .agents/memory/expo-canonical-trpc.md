---
name: Expo canonical tRPC
description: Transport requirements for the JASIM Expo main chat to use the active canonical runtime.
---

The active JASIM API is canonical tRPC, not the legacy REST runtime. Expo's direct tRPC transport must wrap every non-empty input as `{ json: input }` because the server uses SuperJSON. In development, Expo Web originates from a different domain, so the canonical API allows development-only CORS for `/api/*`; native clients are not subject to browser CORS.

**Why:** Sending a raw input silently deserializes as `undefined` and produces a Zod “expected object” error even though the procedure and owner are valid. The legacy `/api/runtime/*` session flow targets an inactive API surface after the active runtime switch.

**How to apply:** Keep mobile conversations on the owner-checked procedures for list, get, create, archive, and turn creation. Preserve same-origin production behavior and do not broaden production CORS merely to support development Expo Web.