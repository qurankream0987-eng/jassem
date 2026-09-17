import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { ErrorMessages } from "@contracts/constants";
import { runWithModelCallBudget } from "./runtime/model-call-budget";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;

/**
 * Opens the per-request model call budget scope.
 *
 * This is the trusted boundary the ceiling is anchored to. It sits below the
 * transport and above every procedure, so no input a client can send reaches it,
 * and no procedure can decline it: a procedure that forgot to opt in is still
 * inside the scope, because the scope is ambient rather than passed. The limit
 * itself comes from deployment configuration, never from the request.
 *
 * Auth runs *after* this, so an unauthenticated request that somehow reached a
 * model is bounded too.
 */
const withModelCallBudget = t.middleware(async ({ path, type, next }) =>
  runWithModelCallBudget({ origin: "TRPC_REQUEST", label: `${type} ${path}` }, () => next()),
);

const base = t.procedure.use(withModelCallBudget);

export const publicQuery = base;

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }
  return next();
});

export const authedQuery = base.use(requireAuth);
