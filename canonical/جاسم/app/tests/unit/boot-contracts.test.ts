/**
 * JASIM — server route contracts for the session and health endpoints.
 *
 * Both of these were development-only divergences: behaviour that differed
 * between `pnpm dev` and production, which is the worst kind of defect because
 * local testing reports a reality the deployed system does not share.
 *
 * These tests exercise the real Hono app through `app.fetch`, so they assert
 * the contract itself rather than a mock of it.
 */

import { describe, expect, it } from "vitest";
import app from "../../api/boot";
import { Paths } from "@contracts/constants";

const BASE = "http://jasim.test";

function post(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(new Request(`${BASE}${path}`, { method: "POST", ...init }));
}

describe("session endpoint takes no input, and says so consistently", () => {
  it("accepts a request with no body at all", async () => {
    // The mobile client historically sent exactly this shape. It must not
    // depend on how a client serializes "nothing".
    const response = await post(Paths.runtimeSession, {
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token?: string };
    expect(typeof body.token).toBe("string");
    expect(body.token!.length).toBeGreaterThan(0);
  });

  it("accepts an explicit empty object", async () => {
    const response = await post(Paths.runtimeSession, {
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect((await response.json() as { token?: string }).token).toBeTruthy();
  });

  it("treats an absent body and {} as the same request", async () => {
    const [absent, empty] = await Promise.all([
      post(Paths.runtimeSession, { headers: { "content-type": "application/json" } }),
      post(Paths.runtimeSession, {
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    ]);
    expect(absent.status).toBe(empty.status);
  });

  it("accepts whitespace-only content as empty", async () => {
    const response = await post(Paths.runtimeSession, {
      headers: { "content-type": "application/json" },
      body: "   ",
    });
    expect(response.status).toBe(200);
  });

  it("rejects malformed JSON instead of ignoring it", async () => {
    const response = await post(Paths.runtimeSession, {
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
  });

  it("rejects a body carrying fields, rather than silently discarding them", async () => {
    // A client sending fields here has misunderstood the contract. Answering
    // 200 would hide the misunderstanding until it mattered.
    const response = await post(Paths.runtimeSession, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId: "99", unionId: "someone:else" }),
    });
    expect(response.status).toBe(400);
  });

  it("never lets a request body choose the principal", async () => {
    const forged = await post(Paths.runtimeSession, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unionId: "admin:root" }),
    });
    expect(forged.status).toBe(400);
    const text = await forged.text();
    expect(text).not.toContain("admin:root");
  });

  it("rejects a JSON array, which is not an empty object", async () => {
    const response = await post(Paths.runtimeSession, {
      headers: { "content-type": "application/json" },
      body: "[]",
    });
    expect(response.status).toBe(400);
  });
});

describe("health is server-owned and can never be the SPA", () => {
  it("answers JSON, not HTML", async () => {
    const response = await app.fetch(new Request(`${BASE}${Paths.health}`));
    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType).toContain("application/json");
    expect(contentType).not.toContain("text/html");
  });

  it("returns a structured readiness verdict", async () => {
    const response = await app.fetch(new Request(`${BASE}${Paths.health}`));
    const body = (await response.json()) as { status?: string; reason?: string };
    // Either outcome is legitimate; a *shape* that cannot express failure is not.
    expect(["ok", "degraded"]).toContain(body.status);
    if (body.status === "degraded") {
      expect(response.status).toBe(503);
      expect(typeof body.reason).toBe("string");
    } else {
      expect(response.status).toBe(200);
    }
  });

  it("cannot be satisfied by an HTML document", async () => {
    const response = await app.fetch(new Request(`${BASE}${Paths.health}`));
    const text = await response.text();
    expect(text).not.toContain("<!doctype html");
    expect(text).not.toContain("<html");
    expect(text.trimStart().startsWith("{")).toBe(true);
  });

  it("exposes no secrets or internal state", async () => {
    const response = await app.fetch(new Request(`${BASE}${Paths.health}`));
    const text = (await response.text()).toLowerCase();
    for (const forbidden of ["password", "secret", "token", "database_url", "postgres://", "postgresql://"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("unknown api routes stay closed", () => {
  it("answers 404 JSON for an unrouted /api path", async () => {
    const response = await app.fetch(new Request(`${BASE}/api/does-not-exist`));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type") ?? "").toContain("application/json");
  });
});
