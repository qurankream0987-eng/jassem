/**
 * JASIM — A DEFINITION IS NOT YET A PROVIDER.
 *
 *   PROVIDER_DEFINITION != CAPABILITY_PROVIDER
 *   SEMANTIC_CAPABILITY != PROVIDER_VERB != REMOTE_TOOL_NAME
 *   CONFIGURED_CANDIDATE != GRANTED_CONNECTION
 *   SELECTED_PROVIDER != AUTHORIZED_CONNECTION · FOUND != MAY_EXECUTE
 *   CONFIGURED != REACHABLE
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let binding: typeof import("../../api/runtime/provider-binding");
let configured: typeof import("../../api/runtime/providers/configured-providers");
let providers: typeof import("../../api/runtime/capability-provider");
let mcp: typeof import("../../api/runtime/providers/mcp-provider");

const T0 = new Date("2026-09-27T15:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;
const API_KEY = "k_bridge_account_key";
const ENDPOINT = "https://bridge.provider.example/mcp";
const SEMANTIC = "inventory.search";

/** The deployment's statement. Two explicit mappings, nothing inferred. */
const CONFIG = JSON.stringify([
  {
    id: "br.remote",
    displayName: "نظام المخزون",
    authMethod: "API_KEY",
    endpoint: ENDPOINT,
    tools: { SEARCH: "search_inventory", TRACK: "job_status", CANCEL: "stop_job" },
    freshnessSeconds: 900,
    candidates: { [SEMANTIC]: { invoke: "SEARCH", readback: "TRACK", cancel: "CANCEL" } },
  },
]);

/** A capability registry stand-in with exactly the semantic ids this build has. */
const capabilities = {
  getTrustedCapability(name: string) {
    if (name === SEMANTIC) return { id: SEMANTIC };
    if (name === "test.only.thing") return { id: "test.only.thing", testOnly: true };
    return undefined;
  },
};

describe("what makes a configured definition selectable", () => {
  let ownerScope: string;
  let scopesMade = 0;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    binding = await import("../../api/runtime/provider-binding");
    configured = await import("../../api/runtime/providers/configured-providers");
    providers = await import("../../api/runtime/capability-provider");
    mcp = await import("../../api/runtime/providers/mcp-provider");
  }, 60_000);

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    binding.setProviderHandshakeObserver(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    // No observer survives between tests: each installs the one it is about.
    binding.setProviderHandshakeObserver(undefined);
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, remote_executions,
        capability_provider_catalog, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'br-%'`));
    const [row] = await handle.db.insert(users)
      .values({ unionId: `br-${randomUUID()}`, name: "صاحب", preferences: {} }).returning();
    ownerScope = String(row!.id);
  });

  /** The definition registry a deployment would have, with a recording adapter. */
  function definitionRegistry(reachable = true) {
    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    const [definition] = configured.parseConfiguredMcpProviders(CONFIG);
    registry.register({
      ...definition!,
      testOnly: true,
      adapter: {
        authenticate: async () =>
          reachable
            ? ({ ok: true as const, accountRef: "acct" })
            : ({ ok: false as const, detail: "unreachable" }),
        discover: async () => ["SEARCH", "TRACK", "CANCEL"] as const,
        invoke: async () => ({ status: "OK" as const, value: {} }),
      },
    });
    binding.setProviderDefinitionRegistry(registry);
    return registry;
  }

  async function connect(granted: readonly string[] = ["SEARCH", "TRACK", "CANCEL"]) {
    scopesMade += 1;
    const [row] = await handle.db.insert(users)
      .values({ unionId: `br-${randomUUID()}`, name: `صاحب ${scopesMade}`, preferences: {} }).returning();
    const scope = String(row!.id);
    const opened = await binding.beginProviderSetup({
      principalId: scope, scopeId: scope, definitionId: "br.remote",
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

  /** A fresh provider registry, bridged from the same configuration. */
  function bridged(raw: string | undefined) {
    const registry = new providers.CapabilityProviderRegistry();
    const ids = configured.registerConfiguredCandidates({
      providers: registry, capabilities, raw, now: T0,
    });
    return { registry, ids };
  }

  const resolve = (registry: providers.CapabilityProviderRegistry, now = at(4 * MINUTE)) =>
    providers.resolveProvider({ capabilityId: SEMANTIC, registry, now });

  // ── 1–2 · NOTHING CONFIGURED, NOTHING BRIDGED ────────────────────────────

  it("no configuration means no candidate and no change in behaviour", () => {
    const { registry, ids } = bridged(undefined);
    expect(ids).toEqual([]);
    expect(registry.list()).toEqual([]);
    expect(resolve(registry).status).toBe("NO_PROVIDER");
    // A definition on its own is not a provider either.
    const definitions = new binding.ProviderDefinitionRegistry();
    configured.registerConfiguredMcpProviders(definitions, CONFIG);
    expect(definitions.get("br.remote")).toBeDefined();
    const bare = new providers.CapabilityProviderRegistry();
    expect(resolve(bare).status).toBe("NO_PROVIDER");
  });

  // ── 13–14 · CONFIGURED IS NOT REACHABLE ──────────────────────────────────

  it("a bridged candidate is not selectable until a real handshake reached it", async () => {
    //   CONFIG_FILE_EQUALS_LIVE_AVAILABILITY = NO
    //   FAKE_AVAILABLE_TO_PASS_RESOLUTION = 0 · MISSING_FRESHNESS_LEASE_EXECUTES = 0
    const { registry, ids } = bridged(CONFIG);
    expect(ids).toEqual([`cfg:br.remote:${SEMANTIC}`]);
    const candidate = registry.get(ids[0]!)!;
    // Known about, and unusable: unknown health, no lease.
    expect(candidate.availability.state).toBe("UNKNOWN");
    expect(candidate.freshness?.expiresAt).toBeUndefined();
    expect(providers.isProviderStale(candidate, at(4 * MINUTE))).toBe(true);
    expect(resolve(registry).status).toBe("STALE");

    // A real handshake happens: the binding lifecycle's own round trip.
    definitionRegistry();
    binding.setProviderHandshakeObserver(
      configured.configuredCandidateHandshakeObserver({ providers: registry, capabilities, raw: CONFIG }),
    );
    await connect();
    const observed = registry.get(ids[0]!)!;
    expect(observed.availability.state).toBe("AVAILABLE");
    expect(observed.freshness?.expiresAt?.getTime()).toBe(at(3 * MINUTE).getTime() + 900_000);
    const selected = resolve(registry);
    expect(selected.status).toBe("SELECTED");
    expect(selected.status === "SELECTED" && selected.binding.providerId).toBe(ids[0]);

    // And the lease runs out rather than standing forever.
    expect(resolve(registry, new Date(at(3 * MINUTE).getTime() + 900_001)).status).toBe("STALE");
  });

  it("a handshake that failed makes it unselectable again", async () => {
    const { registry, ids } = bridged(CONFIG);
    registry.observe(ids[0]!, { state: "AVAILABLE", at: T0, freshUntil: at(60 * MINUTE) });
    expect(resolve(registry).status).toBe("SELECTED");
    // The provider stopped answering. The old success does not coast.
    definitionRegistry(false);
    binding.setProviderHandshakeObserver(
      configured.configuredCandidateHandshakeObserver({ providers: registry, capabilities, raw: CONFIG }),
    );
    const scope = await handle.db.insert(users)
      .values({ unionId: `br-${randomUUID()}`, name: "غريب", preferences: {} }).returning();
    const scopeId = String(scope[0]!.id);
    const opened = await binding.beginProviderSetup({
      principalId: scopeId, scopeId, definitionId: "br.remote",
      requestedCapabilities: ["SEARCH"], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: scopeId, material: { apiKey: API_KEY }, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: scopeId, now: at(2 * MINUTE),
    });
    // The registry is the proof: the observer installed above is the bridge's
    // own, so what it recorded is what the candidate now says.
    expect(registry.get(ids[0]!)!.availability.state).toBe("UNAVAILABLE");
    expect(registry.get(ids[0]!)!.freshness?.expiresAt).toBeUndefined();
    // STALE rather than BLOCKED: clearing the lease is what a failed
    // observation does, and freshness is refused before health is even read.
    // Either way it is not selectable.
    expect(resolve(registry).status).toBe("STALE");
  });

  // ── 10 · THE TWO TOOLS ARE ONE TOOL ──────────────────────────────────────

  it("the tool the DAG names is the tool the adapter would call", () => {
    //   DAG_TOOL_DIFFERS_FROM_ADAPTER_TOOL_FOR_SAME_OPERATION = 0
    const { registry, ids } = bridged(CONFIG);
    const candidate = registry.get(ids[0]!)!;
    expect(candidate.implementationId).toBe("search_inventory");
    expect(candidate.operations).toEqual({ invoke: "SEARCH", readback: "TRACK", cancel: "CANCEL" });
    // Derived from the same map the adapter reads, so they cannot drift.
    const [definition] = configured.parseConfiguredMcpProviders(CONFIG);
    expect(definition!.supports).toContain(candidate.operations!.invoke);
    const definitionFromHelper = mcp.mcpProviderDefinition({
      id: "x", displayName: "x", authMethod: "API_KEY",
      endpoint: { mode: "FIXED", baseUrl: ENDPOINT },
      tools: { SEARCH: "search_inventory" },
    });
    expect([...definitionFromHelper.supports]).toEqual(["SEARCH"]);
  });

  // ── 11 · NAMES DO NOT CARRY MEANING ──────────────────────────────────────

  it("a remote name or description never selects a verb or a capability", () => {
    //   REMOTE_TOOL_NAME_SELECTS_PROVIDER_VERB = 0
    //   PROVIDER_VERB_SELECTS_SEMANTIC_CAPABILITY = 0
    //   DESCRIPTION_SELECTS_SEMANTIC_CAPABILITY = 0
    //
    // The same remote tool renamed to something alarming maps to the same verb,
    // because the deployment's statement decides and the name says nothing.
    const renamed = JSON.parse(CONFIG) as any[];
    renamed[0].tools = { SEARCH: "delete_everything", TRACK: "job_status", CANCEL: "stop_job" };
    const { registry, ids } = bridged(JSON.stringify(renamed));
    const candidate = registry.get(ids[0]!)!;
    expect(candidate.capabilityId).toBe(SEMANTIC);
    expect(candidate.operations!.invoke).toBe("SEARCH");
    expect(candidate.implementationId).toBe("delete_everything");
    // And nothing consults a description: there is none on a bridged candidate.
    expect(candidate.description).toBeUndefined();
    // Nor is the semantic mapper involved — it refuses remote auto-mapping and
    // was not asked.
    expect(candidate.semanticKeys).toBeUndefined();
  });

  // ── 8–9 · DISCOVERY AND THE MODEL CANNOT REACH THE BRIDGE ────────────────

  it("a discovered candidate with identical strings cannot become the bridge", () => {
    //   DISCOVERY_CREATES_TRUSTED_BRIDGE = 0 · MODEL_CREATES_TRUSTED_BRIDGE = 0
    //   DISCOVERY_BECOMES_TRUSTED_CONFIGURED_AUTOMATICALLY = 0
    const { registry } = bridged(CONFIG);
    const impostor = providers.normalizeMcpToolMetadata({
      name: "search_inventory", serverIdentity: "bridge.provider.example", endpoint: ENDPOINT,
      declaredSemantics: [SEMANTIC],
    } as never);
    // Every string matches, and it is still untrusted and still nameless.
    expect(impostor.trustClass).toBe("UNTRUSTED_CANDIDATE");
    expect(impostor.definitionId).toBeUndefined();
    expect(impostor.operations).toBeUndefined();
    expect(impostor.capabilityId).toBeUndefined();
    expect(() => registry.register({ ...impostor, definitionId: "br.remote" })).toThrow(/discovered/i);
    expect(() =>
      registry.register({ ...impostor, operations: { invoke: "SEARCH" } }),
    ).toThrow(/discovered/i);
    // Registered as what it is, it is not selectable: untrusted, and it claims
    // a semantic id it was not given.
    registry.register(impostor);
    expect(registry.get(impostor.id)!.trustClass).toBe("UNTRUSTED_CANDIDATE");
    expect(registry.forCapability(SEMANTIC).map((one) => one.id)).toEqual([
      `cfg:br.remote:${SEMANTIC}`,
    ]);
  });

  // ── BOOT VALIDATION ──────────────────────────────────────────────────────

  it("every malformed trusted mapping is a boot failure, not a skipped line", () => {
    const base = JSON.parse(CONFIG) as any[];
    const variant = (change: (entry: any) => void) => {
      const next = JSON.parse(JSON.stringify(base));
      change(next[0]);
      return JSON.stringify(next);
    };
    const bad: [string, string][] = [
      ["unknown semantic capability", variant((e) => { e.candidates = { "nope.nothing": { invoke: "SEARCH" } }; })],
      ["test-only capability", variant((e) => { e.candidates = { "test.only.thing": { invoke: "SEARCH" } }; })],
      ["no invoke", variant((e) => { e.candidates = { [SEMANTIC]: { readback: "TRACK" } }; })],
      ["unknown verb", variant((e) => { e.candidates = { [SEMANTIC]: { invoke: "TELEPORT" } }; })],
      ["verb the definition cannot do", variant((e) => { e.candidates = { [SEMANTIC]: { invoke: "PAY" } }; })],
      ["no freshness lease", variant((e) => { delete e.freshnessSeconds; })],
      ["malformed candidates", variant((e) => { e.candidates = "yes please"; })],
      ["operations that are not an object", variant((e) => { e.candidates = { [SEMANTIC]: "SEARCH" }; })],
    ];
    for (const [why, raw] of bad) {
      expect(
        () => configured.parseConfiguredCandidates(raw, capabilities),
        why,
      ).toThrow();
    }
    // A duplicate identity is refused rather than silently last-wins.
    const doubled = JSON.stringify([...base, JSON.parse(JSON.stringify(base[0]))]);
    expect(() => configured.parseConfiguredCandidates(doubled, capabilities)).toThrow(/duplicate/i);
  });

  // ── 3–7 · SELECTED IS NOT AUTHORIZED ─────────────────────────────────────

  it("being selected authorizes nothing: the binding still decides", async () => {
    //   CONFIGURED_CANDIDATE_AUTO_CREATES_BINDING = 0
    //   CONFIGURED_CANDIDATE_AUTO_GRANTS_CAPABILITY = 0
    //   UNVERIFIED_BINDING_EXECUTES = 0 · REVOKED_BINDING_EXECUTES = 0
    //   WRONG_SCOPE_BINDING_EXECUTES = 0
    const { registry, ids } = bridged(CONFIG);
    registry.observe(ids[0]!, { state: "AVAILABLE", at: T0, freshUntil: at(60 * MINUTE) });
    expect(resolve(registry).status).toBe("SELECTED");
    definitionRegistry();

    // Selected, and this scope holds no account at all.
    expect(
      await binding.accountBindingFor({ scopeId: ownerScope, definitionId: "br.remote" }),
    ).toBeNull();
    expect(
      await binding.authorizedConnection({
        bindingId: null, onBehalfOfScopeId: ownerScope, definitionId: "br.remote",
        requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "NO_SUCH_BINDING" });

    // A connection that exists but was never verified.
    const pending = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: ownerScope, definitionId: "br.remote",
      requestedCapabilities: ["SEARCH"], now: T0,
    });
    expect(
      await binding.authorizedConnection({
        bindingId: pending.bindingId, onBehalfOfScopeId: ownerScope,
        definitionId: "br.remote", requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ refusal: "BINDING_NOT_USABLE" });

    // Somebody else's verified connection.
    const theirs = await connect();
    expect(
      await binding.authorizedConnection({
        bindingId: theirs.bindingId, onBehalfOfScopeId: ownerScope,
        definitionId: "br.remote", requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ refusal: "NO_SUCH_BINDING" });

    // Their own, without the invoke verb granted.
    const partial = await connect(["TRACK"]);
    expect(
      await binding.authorizedConnection({
        bindingId: partial.bindingId, onBehalfOfScopeId: partial.scope,
        definitionId: "br.remote", requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ refusal: "CAPABILITY_NOT_GRANTED" });

    // Their own, granted, and then revoked.
    await binding.revokeBinding({
      bindingId: theirs.bindingId, principalId: theirs.scope, now: at(5 * MINUTE),
    });
    expect(
      await binding.authorizedConnection({
        bindingId: theirs.bindingId, onBehalfOfScopeId: theirs.scope,
        definitionId: "br.remote", requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ refusal: "BINDING_NOT_USABLE" });
  });

  // ── 16 · NO CREDENTIAL ANYWHERE NEAR A CANDIDATE ─────────────────────────

  it("a bridged candidate carries no address and no credential", async () => {
    //   CONFIGURED_CANDIDATE_ENDPOINT_BYPASSES_BINDING = 0
    const { registry, ids } = bridged(CONFIG);
    const candidate = registry.get(ids[0]!)!;
    expect(candidate.endpoint).toBeUndefined();
    expect(JSON.stringify(candidate)).not.toContain(API_KEY);
    expect(JSON.stringify(candidate)).not.toContain("bridge.provider.example");
    // The address comes from the binding, as it has since the endpoint phase.
    definitionRegistry();
    const connection = await connect();
    const authorized = await binding.authorizedConnection({
      bindingId: connection.bindingId, onBehalfOfScopeId: connection.scope,
      definitionId: "br.remote", requiresCapability: "SEARCH",
    });
    expect(authorized.status === "AUTHORIZED" && authorized.connection.endpoint).toBe(ENDPOINT);
    // And nothing about the candidate appears in canonical state.
    for (const table of ["remote_executions", "events", "scope_provider_bindings"]) {
      const rows = await handle.db.execute(
        sql.raw(`SELECT count(*)::int n FROM ${table}
                 WHERE CAST(to_jsonb(${table}.*) AS text) LIKE '%${API_KEY}%'`),
      );
      expect((rows.rows[0] as { n: number }).n, table).toBe(0);
    }
  });

  // ── 12/15 · THE FILTERS THIS BRIDGE DOES NOT WEAKEN ──────────────────────

  it("the I/O and protocol filters still refuse what they always refused", () => {
    const { registry, ids } = bridged(CONFIG);
    registry.observe(ids[0]!, { state: "AVAILABLE", at: T0, freshUntil: at(60 * MINUTE) });
    // A requirement the candidate does not declare it can accept: refused. The
    // bridge declares NO I/O contract, because it has no trustworthy source for
    // one — so anything the requirement side actually asks for fails closed.
    expect(
      providers.resolveProvider({
        capabilityId: SEMANTIC, registry, now: at(4 * MINUTE),
        requirementInputSpec: [{ name: "query", type: "string", required: true } as never],
      }).status,
    ).toBe("INCOMPATIBLE");
    // A protocol the server does not speak: a candidate that DECLARED one is
    // filtered on it. The bridge declares none, which is why it is not.
    const declaring = new providers.CapabilityProviderRegistry();
    declaring.register({
      ...registry.get(ids[0]!)!, id: "cfg:declaring", protocol: "mcp", protocolVersion: "1999-01-01",
    });
    declaring.observe("cfg:declaring", { state: "AVAILABLE", at: T0, freshUntil: at(60 * MINUTE) });
    expect(
      providers.resolveProvider({
        capabilityId: SEMANTIC, registry: declaring, now: at(4 * MINUTE),
        policy: { supportedProtocols: { mcp: ["2025-06-18"] } },
      }).status,
    ).toBe("INCOMPATIBLE");
  });
});
