/** Short-lived authenticated HTTP control plane for asynchronous lab jobs. */
import { createHash, timingSafeEqual } from "node:crypto";
import type { CoreEvolutionLabJobService } from "./job-service";

export interface CoreEvolutionLabHttpOptions {
  service: CoreEvolutionLabJobService;
  token: string;
  maxRequestBytes?: number;
}
export type CoreEvolutionLabHttpHandler = (request: Request) => Promise<Response>;

function secureTokenMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(createHash("sha256").update(provided).digest(), createHash("sha256").update(expected).digest());
}
function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...extraHeaders } });
}
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

async function readJson(request: Request, maxRequestBytes: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "application/json required");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxRequestBytes) throw new HttpError(413, "request too large");
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxRequestBytes) throw new HttpError(413, "request too large");
  try { return JSON.parse(raw) as unknown; } catch { throw new HttpError(400, "invalid json"); }
}

export function createCoreEvolutionLabHandler(options: CoreEvolutionLabHttpOptions): CoreEvolutionLabHttpHandler {
  if (options.token.length < 24) throw new Error("Core Evolution Lab token is too short");
  const maxRequestBytes = Math.min(options.maxRequestBytes ?? 4_194_304, 16_777_216);
  return async (request) => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") return json({ status: "alive", queueReady: true, isolationReady: "checked-per-job" });
    const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
    if (!match || !secureTokenMatch(match[1], options.token)) return json({ error: "unauthorized" }, 401);
    const actor = (request.headers.get("x-jasim-actor") ?? "remote-core-runtime").slice(0, 100);
    try {
      if (request.method === "POST" && url.pathname === "/v1/core-evolution-jobs") {
        const idempotencyKey = request.headers.get("idempotency-key")?.trim();
        if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) throw new HttpError(400, "valid Idempotency-Key required");
        const job = await options.service.submit(await readJson(request, maxRequestBytes), idempotencyKey, actor);
        return json({ job }, 202, { location: `/v1/core-evolution-jobs/${job.id}` });
      }
      if (request.method === "POST" && url.pathname === "/v1/evaluate-core-patch") {
        return json({ error: "synchronous evaluation retired; submit a durable job" }, 410);
      }
      const route = /^\/v1\/core-evolution-jobs\/([^/]+)(?:\/(report|cancel))?$/.exec(url.pathname);
      if (!route) return json({ error: "not found" }, 404);
      const id = decodeURIComponent(route[1]);
      if (id.length > 100) return json({ error: "not found" }, 404);
      if (request.method === "GET" && !route[2]) {
        const job = await options.service.get(id);
        return job ? json({ job }) : json({ error: "not found" }, 404);
      }
      if (request.method === "GET" && route[2] === "report") {
        const job = await options.service.get(id);
        if (!job) return json({ error: "not found" }, 404);
        if (job.status !== "succeeded") return json({ job, error: "report not ready" }, 409, { "retry-after": "2" });
        const result = await options.service.report(id);
        return result ? json(result) : json({ error: "not found" }, 404);
      }
      if (request.method === "POST" && route[2] === "cancel") {
        const job = await options.service.cancel(id, actor);
        return job ? json({ job }, 202) : json({ error: "not found" }, 404);
      }
      return json({ error: "not found" }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error("[JASIM Core Lab] request rejected", error instanceof Error ? error.message : "unknown error");
      return json({ error: "request rejected" }, 422);
    }
  };
}

