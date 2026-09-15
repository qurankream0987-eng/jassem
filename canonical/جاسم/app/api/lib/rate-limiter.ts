/**
 * Lightweight sliding-window rate limiter for Hono middleware.
 *
 * Keyed by IP address extracted from the forwarded-for chain or remote addr.
 * Uses a fixed in-process Map — sufficient for a single-process server.
 * For multi-replica deployments, replace the store with Redis.
 */

type WindowEntry = { count: number; windowStart: number };

const store = new Map<string, WindowEntry>();

export interface RateLimiterOptions {
  /** Maximum number of requests allowed per window. Default: 120 */
  maxRequests?: number;
  /** Window duration in milliseconds. Default: 60_000 (1 minute) */
  windowMs?: number;
}

/**
 * Returns a Hono-compatible middleware function that rate-limits by client IP.
 * Responds with 429 when the limit is exceeded.
 */
export function createRateLimiter(opts: RateLimiterOptions = {}) {
  const maxRequests = opts.maxRequests ?? 120;
  const windowMs = opts.windowMs ?? 60_000;

  // Prune stale entries every 5 minutes to prevent unbounded memory growth.
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of store) {
        if (now - entry.windowStart >= windowMs) store.delete(key);
      }
    },
    5 * 60_000,
  ).unref();

  return async function rateLimiterMiddleware(
    c: {
      req: { header: (name: string) => string | undefined };
      json: (body: unknown, status: number) => Response;
      header: (name: string, value: string) => void;
    },
    next: () => Promise<Response | void>,
  ) {
    const ip =
      (c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown";

    const now = Date.now();
    const existing = store.get(ip);

    if (!existing || now - existing.windowStart >= windowMs) {
      store.set(ip, { count: 1, windowStart: now });
    } else {
      existing.count++;
      if (existing.count > maxRequests) {
        const retryAfter = Math.ceil((windowMs - (now - existing.windowStart)) / 1000);
        c.header("Retry-After", String(retryAfter));
        c.header("X-RateLimit-Limit", String(maxRequests));
        c.header("X-RateLimit-Remaining", "0");
        return c.json(
          { error: "Too many requests. Please slow down." },
          429,
        );
      }
    }

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header(
      "X-RateLimit-Remaining",
      String(maxRequests - (store.get(ip)?.count ?? 1)),
    );

    return next();
  };
}
