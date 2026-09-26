import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { Server as NodeHttpServer } from "node:http";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createRateLimiter } from "./lib/rate-limiter";
import { trpcOnError, trpcErrorFormatter } from "./lib/trpc-error-handler";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { signSessionToken } from "./kimi/session";
import { setCookie } from "hono/cookie";
import { getSessionCookieOptions } from "./lib/cookies";
import { upsertUser } from "./queries/users";
import { Paths, Session } from "@contracts/constants";
import { logger } from "./lib/observability";
import { getRuntimeRun } from "./runtime/jasim-runtime";
import { readGeneratedImageArtifact } from "./runtime/phase11-artifacts";
import { checkRuntimeReadiness } from "./core/runtime-readiness";
import { initWebSocket } from "./core/websocket";
import { configureExternalActionProvidersFromConfig } from "./runtime/external-action-session";
import { createPaymentWebhookRoutes } from "./http/payment-webhook";

// ── Block 1: Server-owned External Action provider trust ────────────────────
// JASIM_EXTERNAL_PROVIDERS is a JSON map:
//   { "provider": { "origins": [...], "purposes": [...], "pathPrefixes": [...] } }
// Only this boot-time configuration may bind providers to approved origins,
// purposes, and path prefixes; request paths can never nominate them. In
// production a provider without explicit purposes and path prefixes aborts boot.
{
  const raw = process.env.JASIM_EXTERNAL_PROVIDERS;
  if (raw) {
    try {
      const configured = configureExternalActionProvidersFromConfig(raw, {
        strict: env.isProduction,
      });
      logger.info("boot.external_providers_configured", { providers: configured });
    } catch (error) {
      logger.error("boot.external_providers_config_invalid", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (env.isProduction) process.exit(1);
    }
  }
}

// ── Phase 8: Startup secret validation ────────────────────────────────────────
// Fail fast in production if SESSION_SECRET is missing or too short.
if (env.isProduction) {
  const secret = process.env.SESSION_SECRET ?? "";
  if (!secret || secret.length < 32) {
    logger.error("boot.secret_validation_failed", {
      error: "SESSION_SECRET is absent or has insufficient entropy (< 32 chars). Aborting.",
    });
    process.exit(1);
  }
  logger.info("boot.secret_validation_passed");
}

// NOTE (Tranche 1): Legacy core runtime initialisation
// (initializeRuntime, getConnectorHealthMonitor, getExternalActionReconciler,
//  ExternalReliabilityWorker, handleMoyasarWebhook, handleShipdayWebhook) has
// been removed from the canonical boot path.  All active traffic is served by
// the canonical tRPC runtimeRouter.  Legacy connectors and webhook handlers
// will be restored when the legacy-isolation task completes.

const app = new Hono<{ Bindings: HttpBindings }>();

// ── Phase M: Production Hardening ─────────────────────────────────────────────
// Global body limit (50 MB covers multipart uploads; tRPC has a tighter cap below).
//
// One route is exempt, and only because it consumes no request body at all.
// When a request carries a body stream but declares no content-length, the
// limiter buffers it and rebuilds the request with `new Request(raw, init)`.
// Under the Vite dev server — which replaces the global fetch objects — that
// rebuild throws, so a bodyless POST to the session endpoint answered 500 in
// development while the same request answered correctly in production. Skipping
// a route that reads nothing removes the divergence without raising the cap for
// any route that actually accepts input.
const globalBodyLimit = bodyLimit({ maxSize: 50 * 1024 * 1024 });
const BODYLESS_ROUTES: ReadonlySet<string> = new Set<string>([Paths.runtimeSession]);
app.use(async (c, next) => {
  if (BODYLESS_ROUTES.has(c.req.path)) return next();
  return globalBodyLimit(c, next);
});

// Rate-limit tRPC API: 120 req/min per IP in production, 600/min in dev.
const trpcRateLimiter = createRateLimiter({
  maxRequests: env.isProduction ? 120 : 600,
  windowMs: 60_000,
});
app.use("/api/trpc/*", trpcRateLimiter as Parameters<typeof app.use>[1]);
if (!env.isProduction) {
  // Expo Web runs on a dedicated development origin. Native builds are not
  // constrained by browser CORS, and production keeps its same-origin policy.
  app.use(
    "/api/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );
}
app.get(Paths.oauthCallback, createOAuthCallbackHandler());
// tRPC: 2 MB body cap (protects LLM prompt inputs from abuse)
app.use("/api/trpc/*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
    onError: trpcOnError,
    // @ts-expect-error — tRPC v11 formatError signature is compatible
    formatError: trpcErrorFormatter,
  });
});
// Development-only local login: issues a canonical session for a deterministic
// dev user so the runtime can be exercised without the external OAuth provider.
if (!env.isProduction) {
  app.get("/api/auth/dev-login", async (c) => {
    await upsertUser({
      unionId: "dev:local",
      name: "JASIM Dev",
    });
    const token = await signSessionToken({
      unionId: "dev:local",
      clientId: env.appId || "dev-local",
    });
    setCookie(c, Session.cookieName, token, {
      ...getSessionCookieOptions(c.req.raw.headers),
      maxAge: Session.maxAgeMs / 1000,
    });
    return c.redirect("/", 302);
  });
}

// Mobile session endpoint: issues a bearer token for Expo clients.
// In development: always returns a token for the dev:local user.
// In production: requires a valid session cookie and re-issues as a bearer token.
app.post(Paths.runtimeSession, async (c) => {
  try {
    // The endpoint takes no caller-supplied fields. An absent body and `{}`
    // are the same request, so neither may depend on how a client happens to
    // serialize "nothing". Anything else is rejected instead of silently
    // ignored: a client sending fields here has misunderstood the contract,
    // and answering 200 would hide that.
    const rawBody = (await c.req.text()).trim();
    if (rawBody.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return c.json({ error: "Request body must be empty or an empty JSON object." }, 400);
      }
      const isEmptyObject =
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        Object.keys(parsed as Record<string, unknown>).length === 0;
      if (!isEmptyObject) {
        return c.json({ error: "Request body must be empty or an empty JSON object." }, 400);
      }
    }

    if (!env.isProduction) {
      // Dev mode — issue dev:local bearer token for mobile
      await upsertUser({ unionId: "dev:local", name: "JASIM Dev" });
      const token = await signSessionToken({
        unionId: "dev:local",
        clientId: env.appId || "dev-local",
      });
      return c.json({ token });
    }
    // Production mode — require existing cookie session, re-issue as bearer
    const { verifySessionToken: verifySession } = await import("./kimi/session");
    const { findUserByUnionId: findUser } = await import("./queries/users");
    const cookies = (await import("cookie")).parse(c.req.header("cookie") || "");
    const cookieToken = cookies[Session.cookieName];
    if (!cookieToken) {
      return c.json({ error: "Not authenticated. Please log in first." }, 401);
    }
    const claim = await verifySession(cookieToken);
    if (!claim) {
      return c.json({ error: "Session expired. Please log in again." }, 401);
    }
    const user = await findUser(claim.unionId);
    if (!user) {
      return c.json({ error: "User not found." }, 403);
    }
    const bearerToken = await signSessionToken({
      unionId: claim.unionId,
      clientId: claim.clientId,
    });
    return c.json({ token: bearerToken });
  } catch (err) {
    console.error("[session] Mobile session endpoint failed:", err);
    return c.json({ error: "Session creation failed." }, 500);
  }
});

// Owner-scoped generated-image streaming. The durable receipt contains only the
// artifact reference; this route resolves and serves bytes after authentication,
// so a private object path is never a public asset URL.
app.get("/api/runtime/generated-image/:runId/:artifactId", async (c) => {
  try {
    const context = await createContext({ req: c.req.raw, resHeaders: new Headers() } as never);
    if (!context.user) return c.json({ error: "Not authenticated." }, 401);
    const run = await getRuntimeRun(c.req.param("runId"), String(context.user.id));
    const artifactId = c.req.param("artifactId");
    const output = run.dag
      .map((node) => node.output)
      .find((node) =>
        Array.isArray((node as Record<string, unknown> | null)?.images) &&
        ((node as Record<string, unknown>).images as Array<Record<string, unknown>>)
          .some((image) => image.artifactId === artifactId),
      ) as Record<string, unknown> | undefined;
    const image = Array.isArray(output?.images)
      ? (output.images as Array<Record<string, unknown>>).find((item) => item.artifactId === artifactId)
      : undefined;
    if (!image || typeof image.objectPath !== "string") return c.json({ error: "Image not found." }, 404);
    const artifact = await readGeneratedImageArtifact(image.objectPath);
    return c.body(Uint8Array.from(artifact.bytes), 200, {
      "Content-Type": artifact.contentType,
      "Cache-Control": "private, max-age=300",
    });
  } catch {
    return c.json({ error: "Image not found." }, 404);
  }
});

// ── Provider payment callbacks ─────────────────────────────────────────────
//
// Machine-to-machine, and mounted BEFORE the catch-all below so a provider's
// POST is answered rather than 404'd. Its authority is the catalog-bound
// signature over the exact bytes it sent — not a session, not a bearer token,
// and never the provider name in the path.
//
//   WEBHOOK_REQUIRES_BROWSER_SESSION = NO
//   DEV_LOGIN_CAN_AUTHORIZE_WEBHOOK = NO — this route reads no cookie and no
//   Authorization header, so the development login has nothing to grant it.
//
// The dispatcher is the Block 2 continuation dispatcher the ingestion path
// already uses for every other external event.
app.route(
  "/api/webhooks/payment",
  createPaymentWebhookRoutes({
    async dispatch(input) {
      const { getBlock2Worker } = await import("./runtime/block2/worker");
      return getBlock2Worker().dispatcher.dispatch(input);
    },
  }),
);

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

// ── Phase 8: Health endpoint ───────────────────────────────────────────────────
// Returns ready only after the DB and the canonical runtime schema are verified.
// Intentionally returns NO secrets, tokens, or internal state.
app.get(Paths.health, async (c) => {
  const readiness = await checkRuntimeReadiness();
  if (readiness.ready) {
    return c.json({ status: "ok", ts: new Date().toISOString() });
  }
  logger.error("health.not_ready", { reason: readiness.reason, missing: readiness.missing });
  return c.json(
    { status: "degraded", reason: readiness.reason },
    503,
  );
});

export default app;

// ── Block 2: durable operational fabric driver ─────────────────────────────
// The canonical executor stays request-driven; the Block 2 worker reuses the
// existing durable job queue (leases + recovery) so temporal triggers,
// reservation expiry, and notification delivery survive restarts. Started in
// both dev (vite middleware) and production; guarded against double-start
// under module re-import. Disabled under test runners.
const BLOCK2_WORKER_FLAG = "__jasimBlock2WorkerStarted";
const globalFlags = globalThis as unknown as Record<string, unknown>;
if (
  !globalFlags[BLOCK2_WORKER_FLAG] &&
  process.env.VITEST !== "true" &&
  process.env.NODE_ENV !== "test" &&
  process.env.JASIM_BLOCK2_WORKER !== "0"
) {
  globalFlags[BLOCK2_WORKER_FLAG] = true;
  void (async () => {
    try {
      const [{ getBlock2Worker }, { resumeScheduledRuntimeRun }] = await Promise.all([
        import("./runtime/block2/worker"),
        import("./runtime/jasim-runtime"),
      ]);
      const handle = getBlock2Worker({
        resumeNode: async ({ runId, ownerId }) => {
          await resumeScheduledRuntimeRun({ runId, ownerId });
        },
      });
      await handle.bootstrap();
      void handle.worker.run().catch((error) => {
        logger.error("boot.block2_worker_error", { error: String(error) });
      });
      logger.info("boot.block2_worker_started", {});
    } catch (error) {
      logger.error("boot.block2_worker_start_failed", { error: String(error) });
    }
  })();
}

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  const server = serve({ fetch: app.fetch, port }, () => {
    logger.info("boot.server_started", { port });
  });
  if (server instanceof NodeHttpServer) {
    initWebSocket(server);
  } else {
    logger.error("boot.websocket_unavailable", {
      error: "The selected HTTP server implementation does not support WebSocket upgrades.",
    });
  }

  // ── Phase 8: Graceful shutdown ────────────────────────────────────────────
  // On SIGTERM or SIGINT: stop accepting new requests, release leases, close
  // the DB connection pool, then exit cleanly.
  let isShuttingDown = false;
  async function gracefulShutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info("boot.graceful_shutdown_started", { signal });

    // Stop the Block 2 worker loop (in-flight jobs keep their leases; the
    // claim loop's recovery path re-homes them on the next boot).
    try {
      const { getBlock2Worker } = await import("./runtime/block2/worker");
      getBlock2Worker().worker.stop();
    } catch {
      // Worker was never started in this process.
    }

    // Stop accepting new connections
    server.close();

    try {
      // Release any outstanding DAG leases and close DB pool
      const { db } = await import("./queries/connection");
      // Close pool — drizzle-orm/node-postgres exposes the underlying pool
      const pool = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
      if (pool?.end) await pool.end();
      logger.info("boot.graceful_shutdown_complete");
    } catch (err) {
      logger.error("boot.graceful_shutdown_error", { error: String(err) });
    } finally {
      process.exit(0);
    }
  }

  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
}
