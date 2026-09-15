---
name: Browser-safe presentation validation
description: Prevent Vite clients from requesting server-only runtime source while preserving presentation validation at the renderer boundary.
---

The Web renderer must validate Presentation IR through a browser-safe module. It may import shared presentation types, but it must not runtime-import a module under the server `api/` source tree.

**Why:** Vite preserved the runtime import path from the renderer and the browser requested `/api/runtime/presentation-fabric.ts`; the server route returned 404 and the entire Web app rendered blank.

**How to apply:** Keep pure Presentation IR validation available in a client-safe module. Treat server runtime modules as type-only dependencies from Web code unless the bundler is explicitly configured to share them.