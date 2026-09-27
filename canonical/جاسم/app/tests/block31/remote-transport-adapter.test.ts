/**
 * JASIM — A REMOTE SYSTEM THAT CAN ACTUALLY BE CALLED.
 *
 *   TRANSPORT != AUTHORITY · PROTOCOL != DOMAIN
 *   DISCOVERED_TOOL != AUTHORIZED_TOOL · REMOTE_TOOL_NAME != PROVIDER_CAPABILITY
 *   PROVIDER_UNAVAILABLE != BUSINESS_FACT
 *
 * ─── WHY THE PROOFS SPLIT IN TWO ────────────────────────────────────────────
 *
 * A provider definition's address must be public HTTPS and must not be local —
 * a rule `TRUSTED_PROVIDER_ENDPOINT_AUTHORITY` established and this phase does
 * not weaken. A loopback test server therefore cannot be a definition's address,
 * so the two halves are proved where each is真:
 *
 *   the AUTHORITY chain, through the real gate against a real definition whose
 *   address is a public one, with an adapter that records the context it was
 *   handed — which is how «the credential reaches only the bound endpoint»
 *   becomes an assertion rather than a hope;
 *
 *   the TRANSPORT, by calling the real adapter against real loopback HTTP
 *   servers — a genuine round trip, a genuine redirect, a genuine timeout, a
 *   genuine malformed answer.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let binding: typeof import("../../api/runtime/provider-binding");
let mcp: typeof import("../../api/runtime/providers/mcp-provider");
let configured: typeof import("../../api/runtime/providers/configured-providers");
let providers: typeof import("../../api/runtime/capability-provider");

const T0 = new Date("2026-09-27T13:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;
const API_KEY = "k_bound_account_key";
const PUBLIC_ENDPOINT = "https://remote.provider.example/mcp";

/** The tools a deployment bound JASIM's verbs to. Configuration, one direction. */
const TOOLS = Object.freeze({ SEARCH: "find_items", TRACK: "job_status", CANCEL: "stop_job" });

type Seen = { method: string; tool?: string; authorization?: string };

/** A controlled MCP server, and a record of what it was actually asked. */
async function startServer(options: {
  tools?: readonly string[];
  redirectTo?: () => string;
  malformed?: boolean;
  hang?: boolean;
  toolIsError?: boolean;
} = {}) {
  const seen: Seen[] = [];
  const server: Server = createServer(async (request, response) => {
    if (options.redirectTo && request.url === "/away") {
      response.statusCode = 302;
      response.setHeader("location", options.redirectTo());
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let message: Record<string, any> = {};
    try {
      message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      /* recorded as an empty method below */
    }
    seen.push({
      method: String(message.method ?? ""),
      ...(message.params?.name ? { tool: String(message.params.name) } : {}),
      ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
    });
    if (options.hang) return; // never answers; the client must time out
    response.setHeader("content-type", "application/json");
    if (options.malformed) {
      response.end("{ not-json-at-all");
      return;
    }
    const reply = (result: unknown) =>
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    if (message.method === "initialize") {
      reply({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "controlled-remote", version: "3" },
      });
      return;
    }
    if (message.method === "tools/list") {
      reply({
        tools: (options.tools ?? ["find_items", "job_status", "stop_job"]).map((name) => ({
          name, inputSchema: { type: "object" },
        })),
      });
      return;
    }
    if (message.method === "tools/call") {
      reply({
        content: [{ type: "text", text: "وجدنا" }],
        ...(options.toolIsError ? { isError: true } : {}),
      });
      return;
    }
    reply({});
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** What the gate handed the adapter. The proof that it handed the right thing. */
const handed: { endpoint: string; capability: string; credential: Record<string, string> }[] = [];

describe("a remote system that can actually be called", () => {
  let ownerScope: string;
  let scopesMade = 0;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    binding = await import("../../api/runtime/provider-binding");
    mcp = await import("../../api/runtime/providers/mcp-provider");
    configured = await import("../../api/runtime/providers/configured-providers");
    providers = await import("../../api/runtime/capability-provider");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    // A definition built exactly as a configured one is, at a public address —
    // with an adapter that records the context instead of dialling, so what the
    // gate produced can be asserted.
    const real = mcp.mcpProviderDefinition({
      id: "tx.remote", displayName: "نظام بعيد", authMethod: "API_KEY",
      endpoint: { mode: "FIXED", baseUrl: PUBLIC_ENDPOINT }, tools: TOOLS,
    });
    registry.register({
      ...real,
      testOnly: true,
      adapter: {
        authenticate: async (context) => {
          handed.push({ endpoint: context.endpoint, capability: context.capability, credential: { ...context.credential } });
          return { ok: true, accountRef: "controlled-remote" };
        },
        discover: async () => ["SEARCH", "TRACK", "CANCEL"] as const,
        invoke: async (context, request) => {
          handed.push({ endpoint: context.endpoint, capability: request.capability, credential: { ...context.credential } });
          return { status: "OK", value: {} };
        },
      },
    });
    binding.setProviderDefinitionRegistry(registry);
  }, 60_000);

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    handed.length = 0;
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, remote_executions,
        capability_provider_catalog, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'tx-%'`));
    const [row] = await handle.db.insert(users)
      .values({ unionId: `tx-${randomUUID()}`, name: "صاحب", preferences: {} }).returning();
    ownerScope = String(row!.id);
  });

  async function connect(granted: readonly string[] = ["SEARCH", "TRACK", "CANCEL"]) {
    scopesMade += 1;
    const [row] = await handle.db.insert(users)
      .values({ unionId: `tx-${randomUUID()}`, name: `صاحب ${scopesMade}`, preferences: {} }).returning();
    const scope = String(row!.id);
    const opened = await binding.beginProviderSetup({
      principalId: scope, scopeId: scope, definitionId: "tx.remote",
      requestedCapabilities: [...granted], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: scope, material: { apiKey: API_KEY }, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: scope, now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: scope, now: at(3 * MINUTE),
    });
    return { bindingId: opened.bindingId, scope };
  }

  /**
   * A context of the exact shape the gate produces, for transport proofs.
   *
   * Built here rather than by the gate because a definition's address must be
   * public and non-local, so no loopback server can ever be one — the gate's own
   * output is asserted separately, above.
   */
  const contextAt = (
    endpoint: string,
    capability: import("../../api/runtime/provider-binding").ProviderCapability = "SEARCH",
  ): import("../../api/runtime/provider-binding").ProviderCallContext => ({
    scopeId: "scope", bindingId: "bind", endpoint, capability,
    credential: { apiKey: API_KEY },
  });

  const adapter = () => mcp.createMcpProviderAdapter({ authMethod: "API_KEY", tools: TOOLS });

  // ── A · THE DEFINITION'S MANIFEST IS ITS TOOL MAP ────────────────────────

  it("a definition supports exactly the verbs it has a tool for", () => {
    const definition = mcp.mcpProviderDefinition({
      id: "tx.example", displayName: "مثال", authMethod: "API_KEY",
      endpoint: { mode: "FIXED", baseUrl: PUBLIC_ENDPOINT },
      tools: { SEARCH: "find_items", PAY: "charge" },
    });
    expect([...definition.supports]).toEqual(["SEARCH", "PAY"]);
    // A verb with no tool cannot be supported, so the manifest and the transport
    // cannot disagree.
    expect(definition.supports).not.toContain("DELETE");
  });

  it("trusted deployment configuration is the only thing that registers one", () => {
    //   DISCOVERY_CREATES_PROVIDER_DEFINITION = 0
    //   MODEL_CREATES_PROVIDER_DEFINITION = 0
    //   REMOTE_METADATA_CREATES_PROVIDER_DEFINITION = 0 · PRODUCTION_FAKE_PROVIDER = 0
    //
    // Nothing configured, nothing registered — which is what production is.
    const empty = new binding.ProviderDefinitionRegistry();
    expect(configured.registerConfiguredMcpProviders(empty, undefined)).toEqual([]);
    expect(configured.registerConfiguredMcpProviders(empty, "  ")).toEqual([]);
    expect(empty.list()).toEqual([]);

    // A configured one registers, with its manifest derived from its tool map.
    const registry = new binding.ProviderDefinitionRegistry();
    const ids = configured.registerConfiguredMcpProviders(
      registry,
      JSON.stringify([{
        id: "cfg.remote", displayName: "نظام", authMethod: "API_KEY",
        endpoint: PUBLIC_ENDPOINT, tools: { SEARCH: "find_items", CANCEL: "stop_job" },
        receipt: "SIGNED_HMAC",
      }]),
    );
    expect(ids).toEqual(["cfg.remote"]);
    expect([...registry.get("cfg.remote")!.supports]).toEqual(["SEARCH", "CANCEL"]);
    expect(registry.get("cfg.remote")!.receipt).toBe("SIGNED_HMAC");

    // And a mistake is a boot failure, not a request-time surprise.
    for (const bad of [
      "not json",
      JSON.stringify({ id: "x" }),
      JSON.stringify([{ id: "x", displayName: "y", authMethod: "MAGIC", endpoint: PUBLIC_ENDPOINT, tools: { SEARCH: "s" } }]),
      JSON.stringify([{ id: "x", displayName: "y", authMethod: "API_KEY", endpoint: PUBLIC_ENDPOINT, tools: {} }]),
      JSON.stringify([{ id: "x", displayName: "y", authMethod: "API_KEY", endpoint: PUBLIC_ENDPOINT, tools: { WHATEVER: "s" } }]),
      JSON.stringify([{ id: "x", displayName: "y", authMethod: "API_KEY", endpoint: "http://insecure.example", tools: { SEARCH: "s" } }]),
      JSON.stringify([{ id: "x", displayName: "y", authMethod: "API_KEY", endpoint: "https://127.0.0.1/mcp", tools: { SEARCH: "s" } }]),
    ]) {
      expect(() =>
        configured.registerConfiguredMcpProviders(new binding.ProviderDefinitionRegistry(), bad),
        bad.slice(0, 40),
      ).toThrow();
    }
  });

  it("a discovered candidate still cannot name a definition or an operation", () => {
    const registry = new providers.CapabilityProviderRegistry();
    const candidate = providers.normalizeMcpToolMetadata({
      name: "charge_card", serverIdentity: "remote.example", endpoint: PUBLIC_ENDPOINT,
    } as never);
    expect(candidate.definitionId).toBeUndefined();
    expect(candidate.operations).toBeUndefined();
    expect(() => registry.register({ ...candidate, definitionId: "tx.remote" })).toThrow(/discovered/i);
    expect(() => registry.register({ ...candidate, operations: { invoke: "PAY" } })).toThrow(/discovered/i);
  });

  // ── B · THE GATE HANDS THE ADAPTER THE BOUND THINGS ──────────────────────

  it("the adapter receives the bound endpoint and the sealed credential, and nothing else", async () => {
    //   DISCOVERY_ENDPOINT_RECEIVES_BOUND_CREDENTIAL = 0
    //   MODEL_ENDPOINT_RECEIVES_BOUND_CREDENTIAL = 0
    const connection = await connect();
    // `authenticateBinding` and `verifyBinding` already ran through the adapter.
    expect(handed.length).toBeGreaterThan(0);
    for (const call of handed) {
      expect(call.endpoint).toBe(PUBLIC_ENDPOINT);
      expect(call.credential).toEqual({ apiKey: API_KEY });
    }
    // An exact invoke goes the same way.
    handed.length = 0;
    const outcome = await binding.invokeThroughBinding({
      bindingId: connection.bindingId, onBehalfOfScopeId: connection.scope,
      capability: "CANCEL", parameters: { jobId: "j1" }, now: at(4 * MINUTE),
    });
    expect(outcome.status).toBe("OK");
    expect(handed).toEqual([
      { endpoint: PUBLIC_ENDPOINT, capability: "CANCEL", credential: { apiKey: API_KEY } },
    ]);
  });

  it("a verb this connection was not granted never reaches the adapter", async () => {
    //   EXACT_CAPABILITY_GATE_REUSED · UNGRANTED_CAPABILITY_CAN_EXECUTE = 0
    const connection = await connect(["SEARCH"]);
    handed.length = 0;
    const refused = await binding.invokeThroughBinding({
      bindingId: connection.bindingId, onBehalfOfScopeId: connection.scope,
      capability: "CANCEL", parameters: {}, now: at(4 * MINUTE),
    });
    expect(refused).toMatchObject({ status: "REFUSED", refusal: "CAPABILITY_NOT_GRANTED" });
    expect(handed).toHaveLength(0);
    // And a revoked connection reaches it no more, for a verb it DID hold.
    const holder = await connect(["SEARCH", "CANCEL"]);
    handed.length = 0;
    await binding.revokeBinding({
      bindingId: holder.bindingId, principalId: holder.scope, now: at(5 * MINUTE),
    });
    expect(
      await binding.invokeThroughBinding({
        bindingId: holder.bindingId, onBehalfOfScopeId: holder.scope,
        capability: "CANCEL", parameters: {}, now: at(6 * MINUTE),
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "BINDING_NOT_USABLE" });
    expect(handed).toHaveLength(0);
  });

  it("the raw credential is in no row, event or projection after a real call", async () => {
    //   RAW_PROVIDER_CREDENTIAL_IN_REMOTE_EXECUTION = 0 · IN_EVENT = 0
    //   RAW_PROVIDER_CREDENTIAL_IN_PROVIDER_CANDIDATE = 0
    const connection = await connect();
    await binding.invokeThroughBinding({
      bindingId: connection.bindingId, onBehalfOfScopeId: connection.scope,
      capability: "SEARCH", parameters: {}, now: at(4 * MINUTE),
    });
    for (const table of [
      "remote_executions", "events", "capability_provider_catalog",
      "scope_provider_bindings", "scope_policies",
    ]) {
      const rows = await handle.db.execute(
        sql.raw(`SELECT count(*)::int n FROM ${table}
                 WHERE CAST(to_jsonb(${table}.*) AS text) LIKE '%${API_KEY}%'`),
      );
      expect((rows.rows[0] as { n: number }).n, table).toBe(0);
    }
    const [projection] = await binding.projectBindings({
      principalId: connection.scope, scopeId: connection.scope, now: at(7 * MINUTE),
    });
    expect(JSON.stringify(projection)).not.toContain(API_KEY);
  });

  // ── C · THE TRANSPORT, OVER REAL HTTP ────────────────────────────────────

  it("authenticate is a handshake: it names the account and calls no tool", async () => {
    //   AUTHENTICATE_CAUSES_BUSINESS_MUTATION = 0 · AUTHENTICATED != VERIFIED
    const server = await startServer();
    try {
      const outcome = await adapter().authenticate(contextAt(server.url));
      expect(outcome).toMatchObject({ ok: true, accountRef: "controlled-remote" });
      // One handshake. No tools/call, ever.
      expect(server.seen.map((one) => one.method)).toEqual(["initialize"]);
      // And the bound credential arrived as one header.
      expect(server.seen[0]!.authorization).toBe(`Bearer ${API_KEY}`);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("discover narrows to the configured verbs whose tool is really there", async () => {
    //   REMOTE_DISCOVERY_WIDENS_DEFINITION_SUPPORT = 0
    //   REMOTE_TOOL_NAME != PROVIDER_CAPABILITY
    //
    // The server lists one configured tool and two the configuration never
    // named — one of which is called `charge_card`.
    const server = await startServer({ tools: ["find_items", "charge_card", "delete_all"] });
    try {
      const discovered = await adapter().discover(contextAt(server.url));
      expect([...discovered]).toEqual(["SEARCH"]);
      // Nothing became PAY or DELETE by being named that.
      expect(discovered).not.toContain("PAY");
      expect(discovered).not.toContain("DELETE");
    } finally {
      await server.close();
    }
  }, 30_000);

  it("a real invoke calls exactly the configured tool, once", async () => {
    //   REAL_CONTROLLED_HTTP_ROUNDTRIP · MODEL_ARBITRARY_TOOL_SELECTION = 0
    const server = await startServer();
    try {
      const result = await adapter().invoke(contextAt(server.url), {
        capability: "SEARCH", parameters: { query: "قميص" },
      });
      expect(result.status).toBe("OK");
      expect(result.status === "OK" && result.value).toMatchObject({
        content: [{ type: "text", text: "وجدنا" }],
      });
      expect(server.seen).toEqual([
        { method: "tools/call", tool: "find_items", authorization: `Bearer ${API_KEY}` },
      ]);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("a verb with no configured tool is refused before any request", async () => {
    const server = await startServer();
    try {
      const result = await adapter().invoke(contextAt(server.url), {
        capability: "PAY", parameters: {},
      });
      expect(result).toMatchObject({ status: "ERROR" });
      expect(server.seen).toHaveLength(0);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("a provider that fails is never a business fact", async () => {
    //   PROVIDER_UNAVAILABLE != BUSINESS_FACT · NO_FAKE_SUCCESSFUL_OUTPUT
    const malformed = await startServer({ malformed: true });
    const rejecting = await startServer({ toolIsError: true });
    const silent = await startServer({ hang: true });
    try {
      // An answer that is not the protocol: the provider spoke and made no sense.
      const bad = await adapter().invoke(contextAt(malformed.url), {
        capability: "SEARCH", parameters: {},
      });
      expect(bad.status).toBe("ERROR");
      // The provider ran it and declined.
      const declined = await adapter().invoke(contextAt(rejecting.url), {
        capability: "SEARCH", parameters: {},
      });
      expect(declined.status).toBe("ERROR");
      // Nobody answered at all: unknown, which is not failure and not success.
      const timedOut = await mcp
        .createMcpProviderAdapter({ authMethod: "API_KEY", tools: TOOLS, timeoutMs: 250 })
        .invoke(contextAt(silent.url), { capability: "SEARCH", parameters: {} });
      expect(timedOut.status).toBe("UNAVAILABLE");
      for (const result of [bad, declined, timedOut]) {
        expect(result.status).not.toBe("OK");
      }
    } finally {
      await malformed.close();
      await rejecting.close();
      await silent.close();
    }
  }, 30_000);

  it("the bound credential does not follow a redirect to another origin", async () => {
    //   CREDENTIAL_CROSS_ORIGIN_REDIRECT = 0
    const elsewhere = await startServer();
    const bouncer = await startServer({ redirectTo: () => `${elsewhere.url}/` });
    try {
      const result = await adapter().invoke(contextAt(`${bouncer.url}/away`), {
        capability: "SEARCH", parameters: {},
      });
      expect(result.status).not.toBe("OK");
      // The other origin was never spoken to, so it never saw the header.
      expect(elsewhere.seen).toHaveLength(0);
    } finally {
      await bouncer.close();
      await elsewhere.close();
    }
  }, 30_000);

  it("no protocol or domain name appears where a verb is turned into a call", async () => {
    //   MCP_DOMAIN_RUNTIME = 0 · A2A_DOMAIN_RUNTIME = 0
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(process.cwd(), "api/runtime/providers/mcp-provider.ts"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const name of ["Restaurant", "Car", "Hotel", "Stripe", "Shopify", "invoice", "booking"]) {
      expect(source, name).not.toContain(name);
    }
    // It decides no authority: no lifecycle, no grant list, no vault.
    for (const name of ["grantedCapabilities", "lifecycle", "providerCredentialVault", "VERIFIED"]) {
      expect(source, name).not.toContain(name);
    }
  });
});
