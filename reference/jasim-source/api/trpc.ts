import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { ErrorMessages } from "@contracts/constants";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicQuery = t.procedure;

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

export const authedQuery = t.procedure.use(requireAuth);
