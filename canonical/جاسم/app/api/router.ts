import { router } from "./trpc";
import { runtimeRouter } from "./routers/runtime";
import { fabricRouter } from "./routers/fabric";
import { block2Router } from "./routers/block2";

/**
 * JASIM Canonical App Router
 *
 * ONE active execution path: runtimeRouter → jasim-runtime.ts → @db/schema → PostgreSQL.
 *
 * All legacy routers (conversation, task, bubble, capability, entity, approval,
 * notifications, security, dna, externalActions, worlds, coreEvolution, jasim,
 * stream) have been removed. Their code remains in api/routers/ as reference but
 * is no longer compiled or registered.  Web and Mobile clients must use the
 * canonical runtime.* procedures exclusively.
 */
export const appRouter = router({
  runtime: runtimeRouter,
  fabric: fabricRouter,
  block2: block2Router,
});

export type AppRouter = typeof appRouter;
