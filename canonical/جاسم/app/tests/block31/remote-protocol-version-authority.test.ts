/**
 * JASIM — A PROTOCOL CLAIM NEEDS AN AUTHORITY.
 *
 *   PROVIDER_IS_NOT_ITS_OWN_PROTOCOL_AUTHORITY
 *   REMOTE_DECLARED_VERSION_SATISFIES_ITSELF = 0
 *   SERVER_INFO_VERSION_IS_PROTOCOL_VERSION = 0
 *   REQUESTED_VERSION_IS_PROVIDER_EVIDENCE = 0
 *   NEGOTIATED_VERSION_BECOMES_SHARED_CANDIDATE_CONFIGURATION = 0
 *   SELECTED != AUTHORIZED · FAIL_CLOSED > FALSE_COMPATIBILITY
 *
 * The question «which protocol versions can be spoken here?» has exactly one
 * honest authority: the code that does the speaking. A candidate answering it
 * about itself is a claim with no evidence behind it, and until this phase the
 * DAG built its list of supported versions BY READING THE CANDIDATES — so every
 * candidate satisfied the filter that was meant to check it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let binding: typeof import("../../api/runtime/provider-binding");
let configured: typeof import("../../api/runtime/providers/configured-providers");
let providers: typeof import("../../api/runtime/capability-provider");
let mcp: typeof import("../../api/runtime/block2/mcp-client");

const T0 = new Date("2026-09-27T20:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

const SHARED = "inventory.search";
const TWIN = "catalogue.search";
const OWN = "parcels.search";
/** One address, two definitions: A's handshake must not speak for B. */
const FIXED = "https://protocol.provider.example/mcp";

const CONFIG = JSON.stringify([
  {
    id: "pv.shared", displayName: "نظام مشترك", authMethod: "API_KEY",
    endpoint: FIXED, tools: { SEARCH: "find_items" },
    freshnessSeconds: 600, candidates: { [SHARED]: { invoke: "SEARCH" } },
  },
  {
    id: "pv.twin", displayName: "نظام توأم", authMethod: "API_KEY",
    endpoint: FIXED, tools: { SEARCH: "find_items" },
    freshnessSeconds: 600, candidates: { [TWIN]: { invoke: "SEARCH" } },
  },
  {
    id: "pv.own", displayName: "عنوان لكل ربط", authMethod: "API_KEY",
    endpoint: "DECLARED_AT_SETUP", tools: { SEARCH: "find_items" },
    freshnessSeconds: 600, candidates: { [OWN]: { invoke: "SEARCH" } },
  },
]);

const capabilities = {
  getTrustedCapability(name: string) {
    return [SHARED, TWIN, OWN].includes(name) ? { id: name } : undefined;
  },
};

const bare = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const sourceOf = (path: string) =>
  readFile(new URL(path, import.meta.url), "utf8").then(bare);

/** What each account's handshake does, keyed by the credential it presents. */
const handshakeByKey = new Map<string, { ok: boolean; reached?: boolean }>();

describe("what makes a protocol version true", () => {
  let scopesMade = 0;
  const servers: Server[] = [];

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    binding = await import("../../api/runtime/provider-binding");
    configured = await import("../../api/runtime/providers/configured-providers");
    providers = await import("../../api/runtime/capability-provider");
    mcp = await import("../../api/runtime/block2/mcp-client");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    for (const definition of configured.parseConfiguredMcpProviders(CONFIG)) {
      registry.register({
        ...definition,
        testOnly: true,
        adapter: {
          authenticate: async (context) => {
            const planned = handshakeByKey.get(context.credential.apiKey ?? "") ?? { ok: true };
            return planned.ok
              ? { ok: true as const, accountRef: "acct", accountLabel: "acct 9.4.2" }
              : {
                  ok: false as const,
                  detail: "refused",
                  ...(planned.reached === undefined ? {} : { reached: planned.reached }),
                };
          },
          discover: async () => ["SEARCH"] as never,
          invoke: async () => ({ status: "OK" as const, value: {} }),
        },
      });
    }
    binding.setProviderDefinitionRegistry(registry);
  }, 60_000);

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    binding.setProviderHandshakeObserver(undefined);
    await Promise.all(servers.map((one) => new Promise((done) => one.close(done))));
    await handle.pool.end();
  });

  beforeEach(async () => {
    handshakeByKey.clear();
    binding.setProviderHandshakeObserver(undefined);
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, remote_executions,
        capability_provider_catalog, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'pv-%'`));
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  /** A loopback MCP server whose `initialize` result is whatever a test says. */
  async function serve(result: (requested: unknown) => Record<string, unknown>) {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        const sent = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          id: number;
          params?: { protocolVersion?: unknown };
        };
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: sent.id,
          result: result(sent.params?.protocolVersion),
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(body);
      });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const port = (server.address() as { port: number }).port;
    return `http://127.0.0.1:${port}/`;
  }

  function bridged() {
    const registry = new providers.CapabilityProviderRegistry();
    configured.registerConfiguredCandidates({
      providers: registry, capabilities, raw: CONFIG, now: T0,
    });
    binding.setProviderHandshakeObserver(
      configured.configuredCandidateHandshakeObserver({
        providers: registry, capabilities, raw: CONFIG,
      }),
    );
    return registry;
  }

  async function connect(input: {
    definitionId: string;
    apiKey: string;
    endpointUrl?: string;
  }) {
    scopesMade += 1;
    const [row] = await handle.db.insert(users)
      .values({ unionId: `pv-${randomUUID()}`, name: `صاحب ${scopesMade}`, preferences: {} })
      .returning();
    const scopeId = String(row!.id);
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
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: scopeId, now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: scopeId, now: at(3 * MINUTE),
    });
    return { bindingId: opened.bindingId, scopeId };
  }

  /**
   * A candidate that says whatever a test wants it to say about itself, with
   * every OTHER gate already satisfied so the protocol filter is the only thing
   * left that can refuse it.
   */
  function claiming(claim: { protocol?: string; protocolVersion?: string }) {
    const registry = new providers.CapabilityProviderRegistry();
    registry.register({
      id: "claim:one",
      kind: "MCP",
      capabilityId: SHARED,
      implementationId: "find_items",
      ...claim,
      trustClass: "TRUSTED_CONFIGURED",
      availability: { state: "AVAILABLE", observedAt: T0 },
      costClass: "UNKNOWN",
      latencyClass: "UNKNOWN",
      freshness: { discoveredAt: T0, expiresAt: at(60 * MINUTE) },
      provenance: { source: "MANUAL_CONFIG" },
    });
    return registry;
  }

  /** The policy the DAG now passes: a statement about this process. */
  const processPolicy = () => ({
    supportedProtocols: { [mcp.MCP_PROTOCOL]: [...mcp.MCP_PROTOCOL_VERSIONS] },
  });

  const resolveWith = (
    registry: providers.CapabilityProviderRegistry,
    policy: { supportedProtocols?: Record<string, string[]> },
    capabilityId = SHARED,
  ) =>
    providers.resolveProvider({
      capabilityId, registry, policy, now: at(4 * MINUTE),
    });

  // ── 1 · THE AUTHORITY IS THE TRANSPORT, AND IT IS SINGLE-VALUED ──────────

  it("the exported version list is exactly what initialize sends and accepts", async () => {
    // Not a second copy of a constant: the same one the handshake enforces. If
    // these could differ, the filter would be describing a transport that does
    // not exist.
    expect(mcp.MCP_PROTOCOL_VERSIONS).toHaveLength(1);
    expect(mcp.MCP_PROTOCOL).toBe("mcp");
    const version = mcp.MCP_PROTOCOL_VERSIONS[0]!;

    let requested: unknown;
    const url = await serve((asked) => {
      requested = asked;
      return { protocolVersion: asked, serverInfo: { name: "loopback", version: "9.4.2" } };
    });
    await expect(mcp.createMcpClient({ baseUrl: url }).initialize()).resolves.toMatchObject({
      protocolVersion: version,
    });
    expect(requested).toBe(version);

    // And the list is frozen: nothing downstream can widen what this process
    // speaks by pushing onto the array it was handed.
    expect(Object.isFrozen(mcp.MCP_PROTOCOL_VERSIONS)).toBe(true);
    expect(() => (mcp.MCP_PROTOCOL_VERSIONS as string[]).push("1999-01-01")).toThrowError();
    expect(mcp.MCP_PROTOCOL_VERSIONS).toEqual([version]);
  });

  it("the version JASIM sends is not by itself evidence of what the server speaks", async () => {
    //   REQUESTED_VERSION_IS_PROVIDER_EVIDENCE = 0
    //
    // A real socket, and a server that answers with a DIFFERENT selection than
    // the one it was offered. The handshake fails: what JASIM asked for never
    // stands in for what the far side agreed to.
    const url = await serve(() => ({
      protocolVersion: "2099-01-01",
      serverInfo: { name: "loopback", version: "1.0.0" },
    }));
    await expect(mcp.createMcpClient({ baseUrl: url }).initialize()).rejects.toSatisfy(
      (error: unknown) => error instanceof mcp.McpClientError && error.code === "PROTOCOL",
    );
    // A server that omits the field entirely is refused for the same reason —
    // silence is not agreement.
    const silent = await serve(() => ({ serverInfo: { name: "loopback" } }));
    await expect(mcp.createMcpClient({ baseUrl: silent }).initialize()).rejects.toSatisfy(
      (error: unknown) => error instanceof mcp.McpClientError && error.code === "PROTOCOL",
    );
  });

  it("serverInfo.version is a product version and never becomes a protocol version", async () => {
    //   SERVER_INFO_VERSION_IS_PROTOCOL_VERSION = 0
    const version = mcp.MCP_PROTOCOL_VERSIONS[0]!;
    const url = await serve(() => ({
      protocolVersion: version,
      serverInfo: { name: "loopback", version: "9.4.2" },
    }));
    const hello = await mcp.createMcpClient({ baseUrl: url }).initialize();
    expect(hello).toMatchObject({ protocolVersion: version, serverInfo: { version: "9.4.2" } });
    // The two live in different fields and are never conflated: 9.4.2 is not in
    // the list of versions this process speaks, and asking for it is refused.
    expect(mcp.MCP_PROTOCOL_VERSIONS).not.toContain("9.4.2");
    expect(
      resolveWith(claiming({ protocol: "mcp", protocolVersion: "9.4.2" }), processPolicy()).status,
    ).toBe("INCOMPATIBLE");
    // The adapter reads it as a LABEL, which is the only thing it is for.
    const adapter = await sourceOf("../../api/runtime/providers/mcp-provider.ts");
    const authenticate = adapter.slice(adapter.indexOf("async authenticate(context)"));
    expect(authenticate).toContain("accountLabel");
    expect(authenticate.slice(0, authenticate.indexOf("async discover"))).not.toContain(
      "protocolVersion",
    );
  });

  it("a handshake has no channel to report a protocol version at all", async () => {
    //   NEGOTIATED_VERSION_BECOMES_SHARED_CANDIDATE_CONFIGURATION = 0
    //
    // Structural, not a convention an adapter is trusted to keep: the outcome
    // type an adapter returns carries an account reference and a label, and the
    // one mutation the provider registry has carries a health state. Neither has
    // a place to put a version, so no handshake can write one.
    const contract = await sourceOf("../../api/runtime/provider-binding.ts");
    const outcome = contract.slice(
      contract.indexOf("export type AuthenticationOutcome"),
      contract.indexOf("export type DiscoveryOutcome") === -1
        ? contract.indexOf("export type AuthenticationOutcome") + 1_400
        : contract.indexOf("export type DiscoveryOutcome"),
    );
    expect(outcome).toContain("accountRef");
    expect(outcome).not.toContain("protocol");
    const registryCode = await sourceOf("../../api/runtime/capability-provider.ts");
    const observe = registryCode.slice(registryCode.indexOf("  observe(\n"));
    expect(observe.slice(0, observe.indexOf("): boolean"))).toBe(
      "  observe(\n    id: string,\n    observed: { state: OperationalHealth; at?: Date; freshUntil?: Date },\n  ",
    );
  });

  // ── 2 · THE FILTER'S TRUTH TABLE, AGAINST THE PROCESS'S OWN LIST ─────────

  it("ten protocol claims, one authority", () => {
    const version = mcp.MCP_PROTOCOL_VERSIONS[0]!;
    const table: Array<[string, { protocol?: string; protocolVersion?: string }, string]> = [
      // 1 · No claim at all. Unconstrained, because nothing was asserted — this
      //     is what every NATIVE provider is, and narrowing it here would refuse
      //     the local providers the filter was never about.
      ["no protocol, no version", {}, "SELECTED"],
      // 2 · A version with no protocol is not a protocol claim. Inherited
      //     semantics, recorded so the boundary is visible rather than assumed.
      ["version without protocol", { protocolVersion: version }, "SELECTED"],
      // 3 · The one thing this process actually speaks.
      ["mcp, the spoken version", { protocol: "mcp", protocolVersion: version }, "SELECTED"],
      // 4 · A protocol named with no version is AMBIGUOUS, and ambiguity fails
      //     closed rather than being read as «probably the current one».
      ["mcp, no version", { protocol: "mcp" }, "INCOMPATIBLE"],
      // 5–7 · A version this process does not implement, in either direction.
      ["mcp, an older version", { protocol: "mcp", protocolVersion: "2024-11-05" }, "INCOMPATIBLE"],
      ["mcp, a future version", { protocol: "mcp", protocolVersion: "2099-01-01" }, "INCOMPATIBLE"],
      ["mcp, an empty version", { protocol: "mcp", protocolVersion: "" }, "INCOMPATIBLE"],
      // 8 · A product version where a protocol version belongs.
      ["mcp, a product version", { protocol: "mcp", protocolVersion: "9.4.2" }, "INCOMPATIBLE"],
      // 9 · A protocol this process speaks none of. No adapter, no claim.
      ["a2a, any version", { protocol: "a2a", protocolVersion: version }, "INCOMPATIBLE"],
      // 10 · A near-miss on the protocol key. Nothing normalizes it, and
      //      nothing should: a case-folded match would be a guess.
      ["MCP in capitals", { protocol: "MCP", protocolVersion: version }, "INCOMPATIBLE"],
    ];
    for (const [name, claim, expected] of table) {
      expect(resolveWith(claiming(claim), processPolicy()).status, name).toBe(expected);
    }
    // Every refusal says the same thing, and none of them names a domain.
    const refused = resolveWith(claiming({ protocol: "mcp" }), processPolicy());
    expect(refused).toMatchObject({ status: "INCOMPATIBLE" });
    expect("reason" in refused && refused.reason).toContain("supported protocol version");
  });

  it("with no supported-protocol statement at all, every protocol claim fails closed", () => {
    // A deployment that says nothing about what it speaks does not thereby
    // accept everything. The one case that still passes is the one that made no
    // claim to check.
    for (const claim of [
      { protocol: "mcp", protocolVersion: mcp.MCP_PROTOCOL_VERSIONS[0]! },
      { protocol: "mcp" },
      { protocol: "a2a", protocolVersion: "1.0" },
    ]) {
      expect(resolveWith(claiming(claim), {}).status).toBe("INCOMPATIBLE");
    }
    expect(resolveWith(claiming({}), {}).status).toBe("SELECTED");
  });

  // ── 3 · THE SELF-SATISFYING FILTER IS CLOSED ─────────────────────────────

  it("a candidate's own declaration no longer satisfies the filter that checks it", () => {
    //   REMOTE_DECLARED_VERSION_SATISFIES_ITSELF = 0
    //
    // The defect, demonstrated rather than described. A list built BY READING
    // THE CANDIDATES contains whatever they claimed, so the check passes for
    // every one of them — including a version nothing in this process can speak.
    const invented = { protocol: "mcp", protocolVersion: "1999-01-01" };
    const registry = claiming(invented);
    const derivedFromCandidates = registry.list().reduce<Record<string, string[]>>(
      (all, provider) => {
        if (provider.protocol && provider.protocolVersion) {
          all[provider.protocol] = [
            ...new Set([...(all[provider.protocol] ?? []), provider.protocolVersion]),
          ];
        }
        return all;
      },
      {},
    );
    expect(derivedFromCandidates).toEqual({ mcp: ["1999-01-01"] });
    expect(
      resolveWith(registry, { supportedProtocols: derivedFromCandidates }).status,
    ).toBe("SELECTED");
    // The same candidate, against what this process actually speaks.
    expect(resolveWith(claiming(invented), processPolicy()).status).toBe("INCOMPATIBLE");
  });

  it("the DAG builds its supported-protocol list from the transport, not from the candidates", async () => {
    const runtime = await sourceOf("../../api/runtime/jasim-runtime.ts");
    const executor = runtime.slice(runtime.indexOf("export async function executeRuntimeDagNode"));
    const body = executor.slice(0, executor.indexOf("const providerResolution"));
    expect(body).toContain("const supportedProtocols: Record<string, string[]> = {");
    expect(body).toContain("[MCP_PROTOCOL]: [...MCP_PROTOCOL_VERSIONS]");
    // The reduce over the candidate list is gone, and no candidate field is read
    // on the way to the policy.
    expect(body).not.toContain("reduce");
    expect(body).not.toContain("provider.protocolVersion");
    expect(body).not.toContain("provider.protocol");
    // And the constant comes from the module that does the speaking.
    expect(runtime).toContain(
      'import { createMcpClient, MCP_PROTOCOL, MCP_PROTOCOL_VERSIONS } from "./block2/mcp-client";',
    );
    // Nothing was configured into existence: the version is not read from the
    // environment, where a deployment could assert a transport it does not have.
    expect(executor).not.toMatch(/JASIM_[A-Z_]*PROTOCOL/);
  });

  // ── 4 · A BRIDGED CANDIDATE DECLARES NEITHER FIELD, EVER ─────────────────

  it("configured candidates declare no protocol and no version, and a handshake changes neither", async () => {
    const registry = bridged();
    const before = registry.get(`cfg:pv.shared:${SHARED}`)!;
    expect(before.protocol).toBeUndefined();
    expect(before.protocolVersion).toBeUndefined();
    expect(before.availability.state).toBe("UNKNOWN");

    // A real handshake at the shared address, which is the one observation that
    // is allowed to reach a shared candidate at all.
    handshakeByKey.set("k", { ok: true });
    await connect({ definitionId: "pv.shared", apiKey: "k" });

    const after = registry.get(`cfg:pv.shared:${SHARED}`)!;
    // The one field an observation may write moved.
    expect(after.availability.state).toBe("AVAILABLE");
    // And these did not.
    expect(after.protocol).toBeUndefined();
    expect(after.protocolVersion).toBeUndefined();
    // So the candidate passes the filter by making no claim, not by having one
    // accepted — and it would pass with any supported list, including none.
    expect(resolveWith(registry, processPolicy()).status).toBe("SELECTED");
    expect(resolveWith(registry, {}).status).toBe("SELECTED");
  });

  it("no configuration key can declare a protocol version onto a shared candidate", async () => {
    // A deployment writing one in is not silently honoured: the parser knows a
    // fixed set of keys, and a version is not among them. The alternative — a
    // configurable version — could only restate the constant the client already
    // enforces, or contradict it and produce a candidate this process cannot
    // call.
    const registry = new providers.CapabilityProviderRegistry();
    configured.registerConfiguredCandidates({
      providers: registry, capabilities, now: T0,
      raw: JSON.stringify([
        {
          id: "pv.claimed", displayName: "يدّعي نسخة", authMethod: "API_KEY",
          endpoint: FIXED, tools: { SEARCH: "find_items" }, freshnessSeconds: 600,
          protocol: "mcp", protocolVersion: "1999-01-01",
          candidates: {
            [SHARED]: { invoke: "SEARCH", protocol: "mcp", protocolVersion: "1999-01-01" },
          },
        },
      ]),
    });
    const candidate = registry.get(`cfg:pv.claimed:${SHARED}`)!;
    expect(candidate.protocol).toBeUndefined();
    expect(candidate.protocolVersion).toBeUndefined();
    // Nothing in the registration reads a version, so there is no key to find.
    const source = await sourceOf("../../api/runtime/providers/configured-providers.ts");
    const register = source.slice(source.indexOf("export function registerConfiguredCandidates"));
    expect(register.slice(0, register.indexOf("export function"))).not.toContain("protocolVersion");
  });

  it("a remote tool listing may declare a version, and it stays untrusted and unsupported", async () => {
    //   REMOTE_METADATA_IS_PROTOCOL_AUTHORITY = 0
    //
    // Normalization records what a remote catalogue said, which is the honest
    // thing to do with a self-description. Two gates then hold: the candidate is
    // UNTRUSTED_CANDIDATE, and the version it declared is not one this process
    // speaks.
    const declared = providers.normalizeMcpToolMetadata({
      name: "find_items",
      serverIdentity: "protocol.provider.example",
      endpoint: FIXED,
      protocolVersion: "1999-01-01",
    } as never);
    expect(declared.protocol).toBe("mcp");
    expect(declared.protocolVersion).toBe("1999-01-01");
    expect(declared.trustClass).toBe("UNTRUSTED_CANDIDATE");
    const registry = new providers.CapabilityProviderRegistry();
    registry.register({ ...declared, capabilityId: SHARED });
    registry.observe(declared.id, {
      state: "AVAILABLE", at: T0, freshUntil: at(60 * MINUTE),
    });
    // Untrusted: refused before the protocol is even reached.
    expect(resolveWith(registry, processPolicy()).status).toBe("UNTRUSTED");
    // And with trust granted by hand, the version is still not spoken here.
    expect(
      providers.resolveProvider({
        capabilityId: SHARED, registry, now: at(4 * MINUTE),
        policy: { ...processPolicy(), trustApprovals: new Set([declared.id]) },
      }).status,
    ).toBe("INCOMPATIBLE");
  });

  // ── 5 · ONE CONNECTION'S HANDSHAKE SPEAKS FOR ONE SUBJECT ────────────────

  it("A's handshake at a shared address makes B compatible with nothing", async () => {
    //   OBSERVATION_AUTHORITY MUST_MATCH OBSERVATION_SUBJECT
    const registry = bridged();
    handshakeByKey.set("k", { ok: true });
    await connect({ definitionId: "pv.shared", apiKey: "k" });

    // Both definitions are configured at the SAME address, and B's candidate is
    // still untouched: the observation carried A's definition, and a definition
    // is the subject it is true of — not an address two of them happen to share.
    const twin = registry.get(`cfg:pv.twin:${TWIN}`)!;
    expect(twin.availability.state).toBe("UNKNOWN");
    expect(twin.protocol).toBeUndefined();
    expect(twin.protocolVersion).toBeUndefined();
    // STALE, not BLOCKED: freshness is filtered before health, and a candidate
    // nobody observed has no lease to be fresh under. Either way it is refused.
    expect(resolveWith(registry, processPolicy(), TWIN).status).toBe("STALE");
    // A's own candidate did move, which is what makes the contrast a real one.
    expect(resolveWith(registry, processPolicy(), SHARED).status).toBe("SELECTED");
  });

  it("a per-binding address promotes nothing to the shared candidate", async () => {
    const registry = bridged();
    handshakeByKey.set("k", { ok: true });
    await connect({
      definitionId: "pv.own", apiKey: "k", endpointUrl: "https://example.com/mcp",
    });
    const own = registry.get(`cfg:pv.own:${OWN}`)!;
    expect(own.availability.state).toBe("UNKNOWN");
    expect(own.protocol).toBeUndefined();
    expect(own.protocolVersion).toBeUndefined();
    expect(resolveWith(registry, processPolicy(), OWN).status).toBe("STALE");
  });

  // ── 6 · A REQUIREMENT IS NOT A PROVIDER CLAIM ────────────────────────────

  it("nothing on the requirement side can state a protocol, and resolving writes nothing", async () => {
    //   REQUIREMENT_PROTOCOL_COPIED_INTO_OFFERED_PROTOCOL = 0
    const source = await sourceOf("../../api/runtime/capability-provider.ts");
    const resolveInput = source.slice(
      source.indexOf("export function resolveProvider"),
      source.indexOf("export function resolveProvider") + 400,
    );
    // The only protocol statement resolution accepts is the policy's, which is
    // about the process. There is no requirementProtocol to copy from.
    expect(source).not.toContain("requirementProtocol");
    expect(resolveInput).toContain("policy?: ProviderSelectionPolicy");

    const registry = claiming({ protocol: "mcp" });
    const snapshot = JSON.stringify(registry.get("claim:one"));
    expect(resolveWith(registry, processPolicy()).status).toBe("INCOMPATIBLE");
    // A refusal is not a repair: the candidate is unchanged and refused again.
    expect(JSON.stringify(registry.get("claim:one"))).toBe(snapshot);
    expect(resolveWith(registry, processPolicy()).status).toBe("INCOMPATIBLE");
    // And a policy that lists a version does not write it onto the candidate.
    expect(
      resolveWith(registry, { supportedProtocols: { mcp: ["1999-01-01"] } }).status,
    ).toBe("INCOMPATIBLE");
    expect(registry.get("claim:one")!.protocolVersion).toBeUndefined();
  });

  // ── 7 · COMPATIBILITY IS NOT AUTHORITY ───────────────────────────────────

  it("a protocol-compatible candidate still executes nothing without its own binding", async () => {
    //   SELECTED != AUTHORIZED
    //   PROTOCOL_COMPATIBILITY_BYPASSES_BINDING_GATE = 0
    const registry = bridged();
    handshakeByKey.set("k", { ok: true });
    const owner = await connect({ definitionId: "pv.shared", apiKey: "k" });
    expect(resolveWith(registry, processPolicy()).status).toBe("SELECTED");

    // A stranger, for whom the candidate is equally «compatible».
    scopesMade += 1;
    const [row] = await handle.db.insert(users)
      .values({ unionId: `pv-${randomUUID()}`, name: "غريب", preferences: {} })
      .returning();
    const stranger = String(row!.id);
    expect(
      await binding.authorizedConnection({
        bindingId: null, onBehalfOfScopeId: stranger, requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "NO_SUCH_BINDING" });
    // The owner's own binding cannot be borrowed by the stranger either.
    expect(
      await binding.authorizedConnection({
        bindingId: owner.bindingId, onBehalfOfScopeId: stranger, requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ status: "REFUSED" });
    // And a verb the connection was never granted stays refused for the owner.
    expect(
      await binding.authorizedConnection({
        bindingId: owner.bindingId, onBehalfOfScopeId: owner.scopeId, requiresCapability: "DELETE",
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "CAPABILITY_NOT_GRANTED" });
    expect(
      await binding.authorizedConnection({
        bindingId: owner.bindingId, onBehalfOfScopeId: owner.scopeId, requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ status: "AUTHORIZED" });
  });

  // ── 8 · A RESTART WIDENS NOTHING ─────────────────────────────────────────

  it("rebuilding from the same configuration restores no negotiated version", async () => {
    const first = bridged();
    handshakeByKey.set("k", { ok: true });
    await connect({ definitionId: "pv.shared", apiKey: "k" });
    expect(first.get(`cfg:pv.shared:${SHARED}`)!.availability.state).toBe("AVAILABLE");

    // A new process, the same configuration. Nothing a handshake observed
    // survives, because nothing about it was ever written down as configuration.
    const second = bridged();
    const candidate = second.get(`cfg:pv.shared:${SHARED}`)!;
    expect(candidate.availability.state).toBe("UNKNOWN");
    expect(candidate.protocol).toBeUndefined();
    expect(candidate.protocolVersion).toBeUndefined();
    expect(resolveWith(second, processPolicy()).status).toBe("STALE");
    // And what this process speaks is the same as it was, because it is code.
    expect([...mcp.MCP_PROTOCOL_VERSIONS]).toEqual([mcp.MCP_PROTOCOL_VERSIONS[0]]);
  });

  // ── 9 · NO DOMAIN AND NO PROVIDER NAMES ──────────────────────────────────

  it("the protocol authority names no domain and no provider", async () => {
    const client = await sourceOf("../../api/runtime/block2/mcp-client.ts");
    const declaration = client.slice(
      client.indexOf("export const MCP_PROTOCOL_VERSIONS"),
      client.indexOf("function isRecord"),
    );
    expect(declaration).toContain("Object.freeze");
    const runtime = await sourceOf("../../api/runtime/jasim-runtime.ts");
    const executor = runtime.slice(runtime.indexOf("export async function executeRuntimeDagNode"));
    const policy = executor.slice(
      executor.indexOf("const supportedProtocols"),
      executor.indexOf("const providerResolution"),
    );
    for (const forbidden of [
      "inventory", "catalogue", "parcels", "booking", "payment", "travel", "health",
      "pv.shared", "stripe", "github", "slack", "google",
    ]) {
      expect(policy.toLowerCase(), forbidden).not.toContain(forbidden);
      expect(declaration.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    // One statement, no branches: nothing chooses a version per provider.
    expect(policy).not.toContain("if (");
    expect(policy).not.toContain("?");
  });
});
