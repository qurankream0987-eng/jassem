# JASIM

JASIM is a general runtime that turns natural-language goals into durable worlds, staged plans, approvals, and truthful execution states.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run test:jasim-runtime` — exercise the live generic runtime flow (API workflow required)
- Required env: `DATABASE_URL` and `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `reference/jasim-source/` — preserved JASIM reference source and archive.
- `lib/api-spec/openapi.yaml` — source of truth for API contracts.
- `lib/db/src/schema/jasim-runtime.ts` — durable runtime task, event, and idempotency records.
- `artifacts/api-server/src/lib/jasim-runtime.ts` — general runtime state transitions and session ownership boundary.
- `artifacts/jasim/` — web runtime operator interface.
- `artifacts/jasim-mobile/` — native Expo app (iOS/Android): Arabic RTL soap-bubble chat UI bound to the live runtime.

## Architecture decisions

- Runtime goals are domain-neutral. Example domains are validation inputs, not first-class feature branches.
- The runtime does not report a simulated success. In the absence of a trusted assigned capability, an execution request becomes a durable `blocked` state with an explicit event.
- Action requests are scoped to a signed browser session and support idempotency receipts. This provides a safe ownership boundary until user authentication is added.
- Native clients authenticate with `POST /api/runtime/session`, which issues a signed bearer token (`actorId.issuedAt.signature`, 7-day TTL, 401 on expiry). The mobile app stores it in the platform keychain (expo-secure-store) and re-bootstraps on 401.
- The model gateway and external capabilities are deliberately unconfigured in this foundation; the world records those constraints instead of hiding them.

## Product

- Submit a natural-language objective.
- Inspect its generated world, plan, actions, and event history.
- Supply context, grant explicit approval, and see whether execution is truly ready, completed, or blocked.

## User preferences

- Preserve JASIM as a universal generative commercial runtime; never hard-code car, restaurant, hiring, or marketplace flows as the core product.
- The approved final interface will arrive later and should plug into the runtime contracts.

## Gotchas

- Regenerate the API client and Zod validators after any OpenAPI change.
- `SESSION_SECRET` is required at API startup because runtime task ownership uses a signed session cookie.
- The reference archive intentionally preserves source paths that cannot both exist on a normal filesystem; use the archive as the canonical historical copy.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
