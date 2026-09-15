---
name: Client-safe workspace packages
description: Workspace linking and dependency rules for shared browser/Mobile contract packages.
---

Shared client-safe packages must be declared as `workspace:*` dependencies in every app that imports them, including Expo and canonical Web/Server consumers. A package that merely exists under `lib/*` is not automatically linked into consumer `node_modules`; TypeScript may still appear to pass in some project references while Vite or Metro fails to resolve it. Keep their runtime helpers platform-neutral: do not require DOM or Node globals such as `URL` in the shared source.

**Why:** Vite/Metro kept stale or missing-module resolution errors until the new contract package was linked into each consumer and the affected workflows were restarted. A direct `URL` global also made the shared contract fail its own non-DOM TypeScript target.

**How to apply:** When adding a shared contract package, update each consumer package manifest, run the workspace install, restart affected workflows once, and check fresh logs rather than relying on pre-install errors. Use environment-independent parsing or explicit adapters for shared runtime policies.