import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import {
  getConnectorHealthMonitor,
  getExternalActionReconciler,
  initializeRuntime,
} from "./core/runtime";
import { ExternalReliabilityWorker } from "./core/external-reliability-worker";
import { handleMoyasarWebhook, handleShipdayWebhook } from "./webhook-handlers";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get(Paths.oauthCallback, createOAuthCallbackHandler());
app.post("/api/webhooks/moyasar", handleMoyasarWebhook);
app.post("/api/webhooks/shipday", handleShipdayWebhook);
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  void initializeRuntime().catch((error) => {
    console.error("[JASIM runtime initialization]", error instanceof Error ? error.message : "unknown error");
  });
  const reliabilityWorker = new ExternalReliabilityWorker(
    getExternalActionReconciler(),
    getConnectorHealthMonitor(),
    {
      reconciliationIntervalMs: Number(process.env.JASIM_RECONCILIATION_INTERVAL_MS) || 30_000,
      healthIntervalMs: Number(process.env.JASIM_CONNECTOR_HEALTH_INTERVAL_MS) || 5 * 60_000,
      onError: (phase, error) => console.error(`[JASIM external ${phase}]`, error instanceof Error ? error.message : "unknown error"),
    },
  );
  reliabilityWorker.start();
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
