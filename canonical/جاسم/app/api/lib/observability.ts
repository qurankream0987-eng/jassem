/**
 * JASIM Structured Observability Logger (Phase 8)
 *
 * Emits JSON-structured log lines with correlation IDs.
 * No secrets, tokens, or raw user data are ever logged.
 *
 * Log format (one JSON line per event):
 * {
 *   ts: ISO timestamp,
 *   level: "info"|"warn"|"error",
 *   event: string,
 *   requestId?: string,
 *   conversationId?: string,
 *   runId?: string,
 *   nodeId?: string,
 *   bubbleId?: string,
 *   capabilityId?: string,
 *   providerRequestId?: string,
 *   durationMs?: number,
 *   status?: number | string,
 *   verificationStatus?: string,
 *   error?: string,
 *   [key: string]: unknown
 * }
 */

export interface ObservabilityContext {
  requestId?: string;
  conversationId?: string;
  runId?: string;
  nodeId?: string;
  bubbleId?: string;
  capabilityId?: string;
  providerRequestId?: string;
  verificationStatus?: string;
  durationMs?: number;
  status?: number | string;
  error?: string;
  [key: string]: unknown;
}

type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, event: string, ctx: ObservabilityContext = {}): void {
  // Strip undefined values for clean JSON output
  const payload: Record<string, unknown> = { ts: new Date().toISOString(), level, event };
  for (const [k, v] of Object.entries(ctx)) {
    if (v !== undefined && v !== null) payload[k] = v;
  }
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (event: string, ctx?: ObservabilityContext) => emit('info', event, ctx),
  warn: (event: string, ctx?: ObservabilityContext) => emit('warn', event, ctx),
  error: (event: string, ctx?: ObservabilityContext) => emit('error', event, ctx),

  /** Log a request with timing. Returns the requestId for correlation. */
  request(method: string, path: string, status: number, durationMs: number, ctx?: ObservabilityContext): string {
    const requestId = ctx?.requestId ?? Math.random().toString(36).slice(2, 10);
    emit(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'http.request', {
      ...ctx,
      requestId,
      method,
      path,
      status,
      durationMs,
    });
    return requestId;
  },

  /** Log a capability execution. */
  capability(
    capabilityId: string,
    status: 'started' | 'completed' | 'failed' | 'inconclusive',
    ctx?: ObservabilityContext,
  ): void {
    emit(status === 'failed' || status === 'inconclusive' ? 'warn' : 'info', 'capability.execution', {
      ...ctx,
      capabilityId,
      status,
    });
  },

  /** Log a run lifecycle transition. */
  run(runId: string, fromStatus: string, toStatus: string, ctx?: ObservabilityContext): void {
    emit('info', 'run.transition', { ...ctx, runId, fromStatus, toStatus });
  },

  /** Log a verification result. */
  verification(attemptId: string, verificationStatus: string, ctx?: ObservabilityContext): void {
    emit(verificationStatus === 'FAILED' || verificationStatus === 'INCONCLUSIVE' ? 'warn' : 'info', 'verification.result', {
      ...ctx,
      attemptId,
      verificationStatus,
    });
  },
};

/**
 * Hono middleware that adds request-level structured logging.
 * Assigns a requestId and logs each request with timing.
 */
export function createObservabilityMiddleware() {
  return async function observabilityMiddleware(
    c: {
      req: { method: string; path: string; header: (name: string) => string | undefined };
      res: { status?: number };
      header: (name: string, value: string) => void;
    },
    next: () => Promise<void>,
  ) {
    const start = Date.now();
    const requestId = c.req.header('x-request-id') ?? randomId();
    c.header('x-request-id', requestId);
    await next();
    logger.request(c.req.method, c.req.path, (c.res as { status?: number }).status ?? 200, Date.now() - start, { requestId });
  };
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
