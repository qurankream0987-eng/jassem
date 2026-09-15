---
name: OpenAPI scalar codegen
description: Compatibility rules for integer and UUID-like OpenAPI fields in the workspace's Orval Zod generator.
---

Use `type: number` with `multipleOf: 1` for integer-valued OpenAPI fields instead of `type: integer`.

**Why:** The installed Orval Zod generator emits `zod.int()` for OpenAPI `integer`, but the workspace uses Zod 3, which has no module-level `int()` helper. This makes generated API code fail TypeScript validation.

**How to apply:** When adding an integer field to `lib/api-spec/openapi.yaml`, specify `type: number`, the appropriate bounds, and `multipleOf: 1`; regenerate both API client and Zod outputs afterward.

Do not use `format: uuid` in this workspace's OpenAPI schema. Keep UUID database enforcement in PostgreSQL and model the API value as `type: string`.

**Why:** The same Orval/Zod 3 combination emits a nonexistent module-level `zod.uuid()` helper for `format: uuid`.

**How to apply:** Use a string field for UUID identifiers in `lib/api-spec/openapi.yaml`; apply stricter server-side validation only when the generated contract can support it, then rerun code generation and the workspace typecheck.