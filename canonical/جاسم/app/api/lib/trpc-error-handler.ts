/**
 * tRPC production error handler.
 *
 * In production: masks internal errors (INTERNAL_SERVER_ERROR code) so that
 * stack traces and implementation details never reach the client.
 *
 * In development: passes errors through unchanged for debugging.
 *
 * Usage in fetchRequestHandler: `onError: trpcOnError`
 */

import type { TRPCError } from "@trpc/server";

// Read at call time (not module load time) so tests can override NODE_ENV.
const isProd = () => process.env.NODE_ENV === "production";

interface TrpcErrorContext {
  error: TRPCError;
  type: string;
  path?: string;
  input?: unknown;
}

export function trpcOnError({ error, type, path }: TrpcErrorContext): void {
  // Always log server-side with full detail
  if (error.code === "INTERNAL_SERVER_ERROR") {
    console.error(
      `[tRPC] INTERNAL_SERVER_ERROR — type=${type} path=${path ?? "?"}`,
      isProd() ? error.message : error,
    );
  }
}

/**
 * Transforms tRPC errors before they are serialised and sent to the client.
 * Strips message and data fields on INTERNAL_SERVER_ERROR in production.
 */
export function trpcErrorFormatter({
  shape,
  error,
}: {
  shape: {
    message: string;
    code: number;
    data: { code: string; httpStatus: number; path?: string; stack?: string };
  };
  error: { code: string };
}) {
  if (isProd() && error.code === "INTERNAL_SERVER_ERROR") {
    return {
      ...shape,
      message: "An internal error occurred. Please try again later.",
      data: {
        code: shape.data.code,
        httpStatus: shape.data.httpStatus,
        path: shape.data.path,
        // stack intentionally omitted in production
      },
    };
  }
  return shape;
}
