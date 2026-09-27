/**
 * JASIM — AN OBSERVATION MAY ONLY SPEAK FOR ITS OWN SUBJECT.
 *
 *   PROVIDER_DEFINITION != PROVIDER_ACCOUNT
 *   ACCOUNT_A_REACHABLE != ACCOUNT_B_REACHABLE
 *   ACCOUNT_A_AUTHENTICATES != ACCOUNT_B_AUTHENTICATES
 *   BAD_CREDENTIAL != PROVIDER_GLOBALLY_DOWN
 *   ONE_BINDING_FAILURE != ALL_BINDINGS_UNAVAILABLE
 *   OBSERVATION_AUTHORITY_MUST_MATCH_OBSERVATION_SUBJECT
 *   SELECTED != AUTHORIZED
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let binding: typeof import("../../api/runtime/provider-binding");
let configured: typeof import("../../api/runtime/providers/configured-providers");
let providers: typeof import("../../api/runtime/capability-provider");
let mcp: typeof import("../../api/runtime/providers/mcp-provider");

const T0 = new Date("2026-09-27T17:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;
const SEMANTIC = "inventory.search";
const FIXED_ENDPOINT = "https://shared.provider.example/mcp";

/** Two definitions: one address for everybody, and one address per connection. */
const CONFIG = JSON.stringify([
  {
    id: "ob.shared", displayName: "عنوان مشترك", authMethod: "API_KEY",
    endpoint: FIXED_ENDPOINT, tools: { SEARCH: "find_items" },
    freshnessSeconds: 600, candidates: { [SEMANTIC]: { invoke: "SEARCH" } },
  },
  {
    id: "ob.own", displayName: "عنوان لكل ربط", authMethod: "API_KEY",
    endpoint: "DECLARED_AT_SETUP", tools: { SEARCH: "find_items" },
    freshnessSeconds: 600, candidates: { [SEMANTIC]: { invoke: "SEARCH" } },
  },
]);

const capabilities = {
  getTrustedCapability(name: string) {
    return name === SEMANTIC ? { id: SEMANTIC } : undefined;
  },
};

/** What each binding's handshake will do, keyed by the credential it presents. */
const handshakeByKey = new Map<string, { ok: boolean; reached?: boolean }>();
const seen: { bindingId: string; endpointMode: string; service: string; account: string }[] = [];

describe("whose handshake it was", () => {
  let scopesMade = 0;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    binding = await import("../../api/runtime/provider-binding");
    configured = await import("../../api/runtime/providers/configured-providers");
    providers = await import("../../api/runtime/capability-provider");
    mcp = await import("../../api/runtime/providers/mcp-provider");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    for (const definition of configured.parseConfiguredMcpProviders(CONFIG)) {
      registry.register({
        ...definition,
        testOnly: true,
        adapter: {
          // The outcome depends on WHICH ACCOUNT is calling, which is the whole
          // point: one credential may be refused while another is accepted at
          // the very same address.
          authenticate: async (context) => {
            const planned = handshakeByKey.get(context.credential.apiKey ?? "") ?? { ok: true };
            return planned.ok
              ? { ok: true as const, accountRef: "acct" }
              : {
                  ok: false as const,
                  detail: "refused",
                  ...(planned.reached === undefined ? {} : { reached: planned.reached }),
                };
          },
          discover: async () => ["SEARCH"] as const,
          invoke: async () => ({ status: "OK" as const, value: {} }),
        },
      });
    }
    binding.setProviderDefinitionRegistry(registry);
  }, 60_000);

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    binding.setProviderHandshakeObserver(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    handshakeByKey.clear();
    seen.length = 0;
    binding.setProviderHandshakeObserver(undefined);
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, remote_executions,
        capability_provider_catalog, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'ob-%'`));
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  async function scope() {
    scopesMade += 1;
    const [row] = await handle.db.insert(users)
      .values({ unionId: `ob-${randomUUID()}`, name: `صاحب ${scopesMade}`, preferences: {} })
      .returning();
    return String(row!.id);
  }

  /** Connect one account. Its own credential, and its own address when declared. */
  async function connect(input: {
    definitionId: string;
    apiKey: string;
    endpointUrl?: string;
    stopAfterAuthenticate?: boolean;
  }) {
    const scopeId = await scope();
    const opened = await binding.beginProviderSetup({
      principalId: scopeId, scopeId, definitionId: input.definitionId,
      requestedCapabilities: ["SEARCH"], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: scopeId,
      material: { apiKey: input.apiKey },
      ...(input.endpointUrl ? { endpointUrl: input.endpointUrl } : {}),
      now: at(MINUTE),
    });
    const authenticated = await binding
      .authenticateBinding({ bindingId: opened.bindingId, principalId: scopeId, now: at(2 * MINUTE) })
      .catch((error: Error) => ({ status: "THREW" as const, detail: error.message }));
    if (input.stopAfterAuthenticate) {
      return { bindingId: opened.bindingId, scopeId, authenticated };
    }
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: scopeId, now: at(3 * MINUTE),
    });
    return { bindingId: opened.bindingId, scopeId, authenticated };
  }

  function bridged() {
    const registry = new providers.CapabilityProviderRegistry();
    configured.registerConfiguredCandidates({
      providers: registry, capabilities, raw: CONFIG, now: T0,
    });
    binding.setProviderHandshakeObserver((observation) => {
      seen.push({
        bindingId: observation.bindingId,
        endpointMode: observation.endpointMode,
        service: observation.service,
        account: observation.account,
      });
      configured.configuredCandidateHandshakeObserver({
        providers: registry, capabilities, raw: CONFIG,
      })(observation);
    });
    return registry;
  }

  const lifecycleOf = async (bindingId: string) =>
    (
      (
        await handle.db.execute(
          sql.raw(`SELECT lifecycle FROM scope_provider_bindings WHERE id = '${bindingId}'`),
        )
      ).rows[0] as { lifecycle: string }
    ).lifecycle;

  // ── 1–5, 9–10 · ONE ACCOUNT'S CREDENTIAL IS ONE ACCOUNT'S BUSINESS ───────

  it("a refused credential at a shared address is not an outage for anybody else", async () => {
    //   BAD_CREDENTIAL != PROVIDER_GLOBALLY_DOWN
    //   BINDING_B_AUTH_FAILURE_POISONS_BINDING_A = 0
    const registry = bridged();
    handshakeByKey.set("k_good", { ok: true });
    // Answered, and refused this one's key.
    handshakeByKey.set("k_bad", { ok: false, reached: true });

    const a = await connect({ definitionId: "ob.shared", apiKey: "k_good" });
    expect(await lifecycleOf(a.bindingId)).toBe("VERIFIED");
    const candidate = registry.get(`cfg:ob.shared:${SEMANTIC}`)!;
    expect(candidate.availability.state).toBe("AVAILABLE");
    const lease = candidate.freshness?.expiresAt?.getTime();
    expect(lease).toBe(at(2 * MINUTE).getTime() + 600_000);

    const b = await connect({
      definitionId: "ob.shared", apiKey: "k_bad", stopAfterAuthenticate: true,
    });
    // B's own connection is suspended, which is a fact about B.
    expect(await lifecycleOf(b.bindingId)).toBe("SUSPENDED");
    // A's canonical authority is untouched, and so is the shared candidate.
    expect(await lifecycleOf(a.bindingId)).toBe("VERIFIED");
    const after = registry.get(`cfg:ob.shared:${SEMANTIC}`)!;
    expect(after.availability.state).toBe("AVAILABLE");
    expect(after.freshness?.expiresAt?.getTime()).toBe(lease);
    // The observation arrived, and said what it really observed.
    expect(seen).toEqual([
      { bindingId: a.bindingId, endpointMode: "FIXED", service: "ANSWERED", account: "ACCEPTED" },
      { bindingId: b.bindingId, endpointMode: "FIXED", service: "ANSWERED", account: "REFUSED" },
    ]);
  });

  it("A's success authenticates nothing for B, and grants B nothing", async () => {
    //   BINDING_A_SUCCESS_MARKS_BINDING_B_AUTHENTICATED = 0
    //   BINDING_A_SUCCESS_MARKS_BINDING_B_VERIFIED = 0
    const registry = bridged();
    handshakeByKey.set("k_good", { ok: true });
    handshakeByKey.set("k_bad", { ok: false, reached: true });
    const a = await connect({ definitionId: "ob.shared", apiKey: "k_good" });
    const b = await connect({
      definitionId: "ob.shared", apiKey: "k_bad", stopAfterAuthenticate: true,
    });
    // The candidate is selectable, because the SERVICE is up.
    expect(
      providers.resolveProvider({ capabilityId: SEMANTIC, registry, now: at(4 * MINUTE) }).status,
    ).toBe("SELECTED");
    // And B can still do nothing: selection is not authority.
    //
    //   CANDIDATE_AVAILABILITY_BYPASSES_BINDING_GATE = 0 · SELECTED != AUTHORIZED
    expect(
      await binding.authorizedConnection({
        bindingId: b.bindingId, onBehalfOfScopeId: b.scopeId,
        definitionId: "ob.shared", requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "BINDING_NOT_USABLE" });
    // Nor may B borrow A's connection.
    expect(
      await binding.authorizedConnection({
        bindingId: a.bindingId, onBehalfOfScopeId: b.scopeId,
        definitionId: "ob.shared", requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ refusal: "NO_SUCH_BINDING" });
    // And B's grant list is its own, which is empty.
    const granted = (
      await handle.db.execute(
        sql.raw(`SELECT "grantedCapabilities" g FROM scope_provider_bindings WHERE id = '${b.bindingId}'`),
      )
    ).rows[0] as { g: string[] };
    expect(granted.g).toEqual([]);
  });

  // ── 6–8 · A DECLARED ADDRESS IS NOBODY ELSE'S ────────────────────────────

  it("a handshake at a per-connection address speaks for no shared candidate", async () => {
    //   ACCOUNT_A_REACHABLE != ACCOUNT_B_REACHABLE
    const registry = bridged();
    handshakeByKey.set("k_a", { ok: true });
    handshakeByKey.set("k_b", { ok: false, reached: false });
    // Two addresses that really resolve, because a declared address is checked
    // for real before it is stored — which is the endpoint-authority rule, not
    // something this phase may skip.
    const a = await connect({
      definitionId: "ob.own", apiKey: "k_a", endpointUrl: "https://example.com/a-mcp",
    });
    // A reached its own address, and the shared candidate learned nothing.
    const candidate = registry.get(`cfg:ob.own:${SEMANTIC}`)!;
    expect(candidate.availability.state).toBe("UNKNOWN");
    expect(candidate.freshness?.expiresAt).toBeUndefined();
    expect(
      providers.resolveProvider({ capabilityId: SEMANTIC, registry, now: at(4 * MINUTE) }).status,
    ).toBe("STALE");
    // B's address is silent, and that is B's address.
    const b = await connect({
      definitionId: "ob.own", apiKey: "k_b", endpointUrl: "https://example.org/b-mcp",
      stopAfterAuthenticate: true,
    });
    expect(await lifecycleOf(b.bindingId)).toBe("SUSPENDED");
    expect(await lifecycleOf(a.bindingId)).toBe("VERIFIED");
    expect(registry.get(`cfg:ob.own:${SEMANTIC}`)!.availability.state).toBe("UNKNOWN");
    // Both observations carried their own subject and their own address mode.
    expect(seen.map((one) => one.endpointMode)).toEqual([
      "DECLARED_AT_SETUP", "DECLARED_AT_SETUP",
    ]);
    expect(seen.map((one) => one.bindingId)).toEqual([a.bindingId, b.bindingId]);
  });

  it("silence at the shared address is the one thing that unselects it", async () => {
    const registry = bridged();
    handshakeByKey.set("k_good", { ok: true });
    handshakeByKey.set("k_silent", { ok: false, reached: false });
    await connect({ definitionId: "ob.shared", apiKey: "k_good" });
    expect(registry.get(`cfg:ob.shared:${SEMANTIC}`)!.availability.state).toBe("AVAILABLE");
    await connect({
      definitionId: "ob.shared", apiKey: "k_silent", stopAfterAuthenticate: true,
    });
    const after = registry.get(`cfg:ob.shared:${SEMANTIC}`)!;
    expect(after.availability.state).toBe("UNAVAILABLE");
    expect(after.freshness?.expiresAt).toBeUndefined();
  });

  it("an adapter that cannot tell a refusal from silence writes nothing", async () => {
    //   OBSERVATION_AUTHORITY_MUST_MATCH_OBSERVATION_SUBJECT
    const registry = bridged();
    handshakeByKey.set("k_good", { ok: true });
    // No `reached`: the adapter does not know which fact failed.
    handshakeByKey.set("k_unknown", { ok: false });
    await connect({ definitionId: "ob.shared", apiKey: "k_good" });
    const lease = registry.get(`cfg:ob.shared:${SEMANTIC}`)!.freshness?.expiresAt?.getTime();
    await connect({
      definitionId: "ob.shared", apiKey: "k_unknown", stopAfterAuthenticate: true,
    });
    const after = registry.get(`cfg:ob.shared:${SEMANTIC}`)!;
    expect(after.availability.state).toBe("AVAILABLE");
    expect(after.freshness?.expiresAt?.getTime()).toBe(lease);
    expect(seen.at(-1)).toMatchObject({ service: "UNKNOWN", account: "REFUSED" });
  });

  // ── 11–12 · DISCOVERY IS THE MOST ACCOUNT-SPECIFIC FACT OF ALL ───────────

  it("discovery reports nothing to a shared candidate, in either direction", async () => {
    //   BINDING_B_DISCOVERY_FAILURE_POISONS_BINDING_A = 0
    //   ACCOUNT_A_DISCOVERY_SUCCEEDS != ACCOUNT_B_DISCOVERY_SUCCEEDS
    const registry = bridged();
    handshakeByKey.set("k_good", { ok: true });
    const a = await connect({ definitionId: "ob.shared", apiKey: "k_good" });
    // Exactly one observation for the whole lifecycle: the handshake. Verifying
    // — which is where discovery happens — reports nothing at all.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ bindingId: a.bindingId, account: "ACCEPTED" });
    // The lease therefore dates from the handshake, not from discovery.
    expect(registry.get(`cfg:ob.shared:${SEMANTIC}`)!.freshness?.expiresAt?.getTime()).toBe(
      at(2 * MINUTE).getTime() + 600_000,
    );
    // And what A discovered is A's grant, not a shared claim.
    const granted = (
      await handle.db.execute(
        sql.raw(`SELECT "grantedCapabilities" g FROM scope_provider_bindings WHERE id = '${a.bindingId}'`),
      )
    ).rows[0] as { g: string[] };
    expect(granted.g).toEqual(["SEARCH"]);
  });

  // ── 13–16 · THE GATE IS UNCHANGED ────────────────────────────────────────

  it("availability changes nothing about who may execute", async () => {
    //   UNVERIFIED_BINDING_EXECUTES = 0 · REVOKED = 0 · WRONG_SCOPE = 0
    const registry = bridged();
    handshakeByKey.set("k_good", { ok: true });
    const a = await connect({ definitionId: "ob.shared", apiKey: "k_good" });
    expect(registry.get(`cfg:ob.shared:${SEMANTIC}`)!.availability.state).toBe("AVAILABLE");
    const stranger = await scope();
    for (const [why, call] of [
      ["wrong scope", { bindingId: a.bindingId, onBehalfOfScopeId: stranger }],
      ["no binding", { bindingId: null, onBehalfOfScopeId: stranger }],
    ] as const) {
      expect(
        await binding.authorizedConnection({
          ...call, definitionId: "ob.shared", requiresCapability: "SEARCH",
        }),
        why,
      ).toMatchObject({ status: "REFUSED" });
    }
    await binding.revokeBinding({
      bindingId: a.bindingId, principalId: a.scopeId, now: at(5 * MINUTE),
    });
    expect(
      await binding.authorizedConnection({
        bindingId: a.bindingId, onBehalfOfScopeId: a.scopeId,
        definitionId: "ob.shared", requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ refusal: "BINDING_NOT_USABLE" });
    // Revoking one account does not take the SERVICE down for everyone either.
    expect(registry.get(`cfg:ob.shared:${SEMANTIC}`)!.availability.state).toBe("AVAILABLE");
  });

  // ── 18 · A RESTART FORGETS, AND FORGETTING IS SAFE ───────────────────────

  it("a restart loses selectability and no authority", async () => {
    //   RESTART_WIDENS_AUTHORITY = 0
    const registry = bridged();
    handshakeByKey.set("k_good", { ok: true });
    const a = await connect({ definitionId: "ob.shared", apiKey: "k_good" });
    expect(
      providers.resolveProvider({ capabilityId: SEMANTIC, registry, now: at(4 * MINUTE) }).status,
    ).toBe("SELECTED");
    // A fresh process: the selection registry is memory and starts empty of
    // observations, so nothing is selectable until a handshake happens again.
    const restarted = new providers.CapabilityProviderRegistry();
    configured.registerConfiguredCandidates({
      providers: restarted, capabilities, raw: CONFIG, now: at(6 * MINUTE),
    });
    expect(
      providers.resolveProvider({ capabilityId: SEMANTIC, registry: restarted, now: at(6 * MINUTE) })
        .status,
    ).toBe("STALE");
    // And the account's authority — which lives in the database — is untouched.
    expect(await lifecycleOf(a.bindingId)).toBe("VERIFIED");
    expect(
      await binding.authorizedConnection({
        bindingId: a.bindingId, onBehalfOfScopeId: a.scopeId,
        definitionId: "ob.shared", requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ status: "AUTHORIZED" });
  });

  // ── 17/19 · NOTHING FAKED, NOTHING NAMED ─────────────────────────────────

  it("the two facts are separated at the transport, over real HTTP", async () => {
    //   SERVICE_ANSWERED != CREDENTIAL_ACCEPTED · FAKE_GLOBAL_HEALTH_CHECK_ADDED = 0
    const refusing = await startStatusServer(401);
    const silent = { url: "http://127.0.0.1:1" };
    try {
      const adapter = mcp.createMcpProviderAdapter({
        authMethod: "API_KEY", tools: { SEARCH: "find_items" }, timeoutMs: 1_000,
      });
      const context = (endpoint: string) => ({
        scopeId: "s", bindingId: "b", endpoint,
        capability: "SEARCH" as const, credential: { apiKey: "k" },
      });
      // A service that answered and refused the key: reached.
      const refused = await adapter.authenticate(context(refusing.url) as never);
      expect(refused).toMatchObject({ ok: false, reached: true });
      // Nothing at the address at all: not reached.
      const nothing = await adapter.authenticate(context(silent.url) as never);
      expect(nothing).toMatchObject({ ok: false, reached: false });
    } finally {
      await refusing.close();
    }
    // And no provider or domain name decides any of it.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(process.cwd(), "api/runtime/providers/configured-providers.ts"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const name of ["Stripe", "Shopify", "Restaurant", "Car", "Hotel", "mcp:", "a2a:"]) {
      expect(source, name).not.toContain(name);
    }
  }, 30_000);
});

/** A server that answers every request with one status and no body. */
async function startStatusServer(status: number) {
  const server: Server = createServer((_request, response) => {
    response.statusCode = status;
    response.end("nope");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
