---
name: Generic presentation registry
description: The trust boundary between semantic Presentation IR and reusable UI primitives.
---

Semantic Presentation IR must resolve through a static, local allowlisted
registry of generic renderer types. Provider or model data may supply validated
semantic values and references, but never a component name, dynamic import, or
business operation.

**Why:** The renderer is a projection boundary, not an authority boundary.
Allowing unknown semantic types to resolve dynamically would turn presentation
data into component injection, while inventing unsupported visual surfaces can
misrepresent canonical state.

**How to apply:** Add new semantic types to the validated IR and static
registry together. If a type has no truthful generic renderer yet, return a
safe fallback or an explicit unsupported state; keep action handling typed and
defer final dispatch to the trusted server-side path.