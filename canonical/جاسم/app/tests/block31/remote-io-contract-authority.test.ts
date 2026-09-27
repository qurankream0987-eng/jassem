/**
 * JASIM — A REQUIREMENT IS NOT PROOF OF A CONTRACT.
 *
 *   OBSERVED_SCHEMA_AUTHORITY MUST_MATCH OBSERVATION_SUBJECT
 *   REMOTE_TOOL_DESCRIPTION_IS_AUTHORITY = 0
 *   MODEL_DECLARED_SCHEMA_AUTHORITY = 0
 *   REQUIREMENT_SPEC_COPIED_INTO_OFFERED_SPEC = 0
 *   SELECTED != AUTHORIZED · FAIL_CLOSED > FALSE_COMPATIBILITY
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

const T0 = new Date("2026-09-27T19:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;
const CUSTOMERS = "customers.search";
const ORDERS = "orders.search";
const FIXED = "https://contract.provider.example/mcp";

/**
 * Two routes at one definition, each with its own tool and its own declared
 * contract; one route with no declared contract at all; and a second definition
 * that exposes the SAME tool name with a different contract.
 */
const CONFIG = JSON.stringify([
  {
    id: "io.shared", displayName: "نظام مشترك", authMethod: "API_KEY",
    endpoint: FIXED, tools: { SEARCH: "searchCustomers", OBSERVE: "searchOrders", TRACK: "job" },
    freshnessSeconds: 600,
    candidates: {
      [CUSTOMERS]: {
        invoke: "SEARCH",
        inputSpec: [{ name: "query", type: "string", required: true }],
      },
      [ORDERS]: {
        invoke: "OBSERVE",
        inputSpec: [{ name: "orderId", type: "string", required: true }],
      },
      "nothing.declared": { invoke: "TRACK" },
    },
  },
  {
    id: "io.other", displayName: "نظام آخر", authMethod: "API_KEY",
    endpoint: "https://other.provider.example/mcp", tools: { SEARCH: "searchCustomers" },
    freshnessSeconds: 600,
    candidates: {
      [CUSTOMERS]: {
        invoke: "SEARCH",
        inputSpec: [{ name: "customerNumber", type: "number", required: true }],
      },
    },
  },
]);

const capabilities = {
  getTrustedCapability(name: string) {
    return [CUSTOMERS, ORDERS, "nothing.declared"].includes(name) ? { id: name } : undefined;
  },
};

/** What each account's handshake does, keyed by the credential it presents. */
const handshakeByKey = new Map<string, { ok: boolean; reached?: boolean }>();
/** What each account's `listTools` would report, keyed by the same credential. */
const toolsByKey = new Map<string, readonly string[]>();

describe("what makes a remote contract true", () => {
  let scopesMade = 0;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    binding = await import("../../api/runtime/provider-binding");
    configured = await import("../../api/runtime/providers/configured-providers");
    providers = await import("../../api/runtime/capability-provider");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    for (const definition of configured.parseConfiguredMcpProviders(CONFIG)) {
      registry.register({
        ...definition,
        testOnly: true,
        adapter: {
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
          // The account's OWN tool surface — different accounts may see
          // different tools, which is the whole reason a schema seen by one
          // cannot speak for another.
          discover: async (context) => {
            const visible = toolsByKey.get(context.credential.apiKey ?? "") ?? [
              "searchCustomers", "searchOrders", "job",
            ];
            return (["SEARCH", "OBSERVE", "TRACK"] as const).filter((verb) =>
              visible.includes(
                { SEARCH: "searchCustomers", OBSERVE: "searchOrders", TRACK: "job" }[verb],
              ),
            ) as never;
          },
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
    toolsByKey.clear();
    binding.setProviderHandshakeObserver(undefined);
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, remote_executions,
        capability_provider_catalog, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'io-%'`));
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

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

  /** Make the shared candidates selectable the only way there is: a handshake. */
  async function connect(input: { definitionId: string; apiKey: string; verbs?: string[] }) {
    scopesMade += 1;
    const [row] = await handle.db.insert(users)
      .values({ unionId: `io-${randomUUID()}`, name: `صاحب ${scopesMade}`, preferences: {} })
      .returning();
    const scopeId = String(row!.id);
    const opened = await binding.beginProviderSetup({
      principalId: scopeId, scopeId, definitionId: input.definitionId,
      requestedCapabilities: input.verbs ?? ["SEARCH"], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: scopeId,
      material: { apiKey: input.apiKey }, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: scopeId, now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: scopeId, now: at(3 * MINUTE),
    });
    return { bindingId: opened.bindingId, scopeId };
  }

  const resolve = (
    registry: providers.CapabilityProviderRegistry,
    capabilityId: string,
    requirement?: {
      requirementInputSpec?: import("../../api/runtime/capability-registry").TypedFieldSpec[];
      requirementOutputSpec?: import("../../api/runtime/capability-registry").TypedFieldSpec[];
    },
  ) =>
    providers.resolveProvider({
      capabilityId, registry, now: at(4 * MINUTE), ...(requirement ?? {}),
    });

  /** Every candidate available, without lying about how that happened. */
  function available(registry: providers.CapabilityProviderRegistry) {
    for (const candidate of registry.list()) {
      registry.observe(candidate.id, {
        state: "AVAILABLE", at: T0, freshUntil: at(60 * MINUTE),
      });
    }
  }

  // ── 1 · NO CONTRACT MEANS NO CLAIM ───────────────────────────────────────

  it("a route with no declared contract resolves bare and refuses any requirement", () => {
    const registry = bridged();
    available(registry);
    const candidate = registry.get("cfg:io.shared:nothing.declared")!;
    expect(candidate.inputSpec).toBeUndefined();
    expect(candidate.outputSpec).toBeUndefined();
    // No requirement: nothing is being claimed, so nothing is refused.
    expect(resolve(registry, "nothing.declared").status).toBe("SELECTED");
    // A requirement that actually asks for a field: no evidence, no compatibility.
    expect(
      resolve(registry, "nothing.declared", {
        requirementInputSpec: [{ name: "query", type: "string", required: true }],
      }).status,
    ).toBe("INCOMPATIBLE");
  });

  // ── 2–5 · WHAT A DECLARED CONTRACT DOES AND DOES NOT SATISFY ─────────────

  it("a declared contract satisfies exactly what it declares", () => {
    const registry = bridged();
    available(registry);
    expect(registry.get(`cfg:io.shared:${CUSTOMERS}`)!.inputSpec).toEqual([
      { name: "query", type: "string", required: true },
    ]);
    // Exactly what it offers.
    expect(
      resolve(registry, CUSTOMERS, {
        requirementInputSpec: [{ name: "query", type: "string", required: true }],
      }).status,
    ).toBe("SELECTED");
    // A different TYPE for the same name.
    expect(
      resolve(registry, CUSTOMERS, {
        requirementInputSpec: [{ name: "query", type: "number", required: true }],
      }).status,
    ).toBe("INCOMPATIBLE");
    // A required field it never offered.
    expect(
      resolve(registry, CUSTOMERS, {
        requirementInputSpec: [
          { name: "query", type: "string", required: true },
          { name: "tenantId", type: "string", required: true },
        ],
      }).status,
    ).toBe("INCOMPATIBLE");
    // An OPTIONAL requirement imposes nothing — `specCompatible` weighs only the
    // required ones, which is the inherited semantics and not this phase's to
    // change. Recorded so the boundary is visible rather than assumed.
    expect(
      resolve(registry, CUSTOMERS, {
        requirementInputSpec: [{ name: "somethingElse", type: "string" }],
      }).status,
    ).toBe("SELECTED");
  });

  // ── 6 · INPUT AND OUTPUT ARE INDEPENDENT ─────────────────────────────────

  it("a declared input proves nothing about output", () => {
    //   OUTPUT_SCHEMA_INVENTED_WHEN_REMOTE_DOES_NOT_PROVIDE_ONE = 0
    const registry = bridged();
    available(registry);
    expect(registry.get(`cfg:io.shared:${CUSTOMERS}`)!.outputSpec).toBeUndefined();
    expect(
      resolve(registry, CUSTOMERS, {
        requirementInputSpec: [{ name: "query", type: "string", required: true }],
      }).status,
    ).toBe("SELECTED");
    expect(
      resolve(registry, CUSTOMERS, {
        requirementOutputSpec: [{ name: "results", type: "array", required: true }],
      }).status,
    ).toBe("INCOMPATIBLE");
  });

  // ── 7 · A REQUIREMENT IS NOT PROOF ───────────────────────────────────────

  it("resolving with a requirement never writes that requirement onto the candidate", () => {
    //   REQUIREMENT_SPEC_COPIED_INTO_OFFERED_SPEC = 0
    const registry = bridged();
    available(registry);
    const before = JSON.stringify(registry.get("cfg:io.shared:nothing.declared"));
    resolve(registry, "nothing.declared", {
      requirementInputSpec: [{ name: "query", type: "string", required: true }],
      requirementOutputSpec: [{ name: "results", type: "array", required: true }],
    });
    const after = registry.get("cfg:io.shared:nothing.declared")!;
    expect(after.inputSpec).toBeUndefined();
    expect(after.outputSpec).toBeUndefined();
    expect(JSON.stringify(after)).toBe(before);
    // And the same requirement still fails on the next attempt.
    expect(
      resolve(registry, "nothing.declared", {
        requirementInputSpec: [{ name: "query", type: "string", required: true }],
      }).status,
    ).toBe("INCOMPATIBLE");
  });

  // ── 8–9 · DISCOVERY GIVES NO CONTRACT AND NO ROUTE ───────────────────────

  it("prose and extra remote tools create nothing", async () => {
    //   REMOTE_TOOL_DESCRIPTION_IS_AUTHORITY = 0
    //   DISCOVERY_CREATES_SEMANTIC_CAPABILITY = 0
    const registry = bridged();
    // A discovered tool describing itself in the friendliest possible terms.
    const described = providers.normalizeMcpToolMetadata({
      name: "delete_everything", serverIdentity: "contract.provider.example",
      description: "accepts a query string and returns results",
      endpoint: FIXED,
    } as never);
    expect(described.inputSpec).toBeUndefined();
    expect(described.capabilityId).toBeUndefined();
    expect(described.definitionId).toBeUndefined();
    // A real handshake happens, and the account's tool surface includes the
    // extra tool. No candidate and no contract come of it.
    toolsByKey.set("k", ["searchCustomers", "searchOrders", "job", "delete_everything"]);
    handshakeByKey.set("k", { ok: true });
    await connect({ definitionId: "io.shared", apiKey: "k" });
    expect(registry.list().map((one) => one.id).sort()).toEqual(
      [
        `cfg:io.other:${CUSTOMERS}`,
        `cfg:io.shared:${CUSTOMERS}`,
        "cfg:io.shared:nothing.declared",
        `cfg:io.shared:${ORDERS}`,
      ].sort(),
    );
    expect(registry.forCapability("delete.everything")).toEqual([]);
    for (const candidate of registry.list()) {
      expect(candidate.implementationId, candidate.id).not.toBe("delete_everything");
    }
  });

  // ── 10–11 · A CONTRACT BELONGS TO ITS OWN ROUTE ──────────────────────────

  it("a contract never crosses to another tool or another definition", () => {
    const registry = bridged();
    available(registry);
    // Two routes at ONE definition, each with its own tool and contract.
    expect(registry.get(`cfg:io.shared:${CUSTOMERS}`)!.implementationId).toBe("searchCustomers");
    expect(registry.get(`cfg:io.shared:${ORDERS}`)!.implementationId).toBe("searchOrders");
    expect(
      resolve(registry, ORDERS, {
        requirementInputSpec: [{ name: "query", type: "string", required: true }],
      }).status,
    ).toBe("INCOMPATIBLE");
    expect(
      resolve(registry, ORDERS, {
        requirementInputSpec: [{ name: "orderId", type: "string", required: true }],
      }).status,
    ).toBe("SELECTED");
    // Two DEFINITIONS exposing the same tool name with different contracts.
    const shared = registry.get(`cfg:io.shared:${CUSTOMERS}`)!;
    const other = registry.get(`cfg:io.other:${CUSTOMERS}`)!;
    expect(shared.implementationId).toBe(other.implementationId);
    expect(shared.inputSpec).not.toEqual(other.inputSpec);
    // Only ONE of the two can satisfy a `query: string` requirement, so the
    // resolution is not «some candidate for this capability matches».
    const selected = resolve(registry, CUSTOMERS, {
      requirementInputSpec: [{ name: "query", type: "string", required: true }],
    });
    expect(selected.status === "SELECTED" && selected.binding.providerId).toBe(
      `cfg:io.shared:${CUSTOMERS}`,
    );
    const otherSelected = resolve(registry, CUSTOMERS, {
      requirementInputSpec: [{ name: "customerNumber", type: "number", required: true }],
    });
    expect(otherSelected.status === "SELECTED" && otherSelected.binding.providerId).toBe(
      `cfg:io.other:${CUSTOMERS}`,
    );
  });

  // ── 12–16 · NO ACCOUNT MAY WRITE A SHARED CONTRACT ───────────────────────

  it("no handshake of any account ever changes a declared contract", async () => {
    //   ACCOUNT_SPECIFIC_SCHEMA_CAN_POISON_OTHER_BINDINGS = 0
    //   ONE_ACCOUNT_DISCOVERY_WIDENS_ANOTHER_ACCOUNT_AUTHORITY = 0
    const registry = bridged();
    const before = registry.list().map((one) => JSON.stringify([one.inputSpec, one.outputSpec]));

    // A: sees a narrow surface and authenticates.
    handshakeByKey.set("k_a", { ok: true });
    toolsByKey.set("k_a", ["searchCustomers"]);
    const a = await connect({ definitionId: "io.shared", apiKey: "k_a" });
    // B: at the same FIXED address, sees a DIFFERENT surface.
    handshakeByKey.set("k_b", { ok: true });
    toolsByKey.set("k_b", ["searchCustomers", "searchOrders", "job"]);
    const b = await connect({ definitionId: "io.shared", apiKey: "k_b", verbs: ["SEARCH", "OBSERVE"] });
    // C: refused credential. D: silence.
    handshakeByKey.set("k_c", { ok: false, reached: true });
    handshakeByKey.set("k_d", { ok: false, reached: false });
    await connect({ definitionId: "io.shared", apiKey: "k_c" }).catch(() => null);
    await connect({ definitionId: "io.shared", apiKey: "k_d" }).catch(() => null);

    // Not one contract moved, in either direction.
    expect(registry.list().map((one) => JSON.stringify([one.inputSpec, one.outputSpec]))).toEqual(
      before,
    );
    // What DID differ is each account's own grant, which is where account-
    // specific discovery belongs.
    const grants = async (bindingId: string) =>
      (
        (
          await handle.db.execute(
            sql.raw(`SELECT "grantedCapabilities" g FROM scope_provider_bindings WHERE id = '${bindingId}'`),
          )
        ).rows[0] as { g: string[] }
      ).g;
    expect(await grants(a.bindingId)).toEqual(["SEARCH"]);
    expect((await grants(b.bindingId)).sort()).toEqual(["OBSERVE", "SEARCH"]);
  });

  it("a per-connection address publishes no shared contract either", () => {
    //   DECLARED_AT_SETUP_SCHEMA_PROMOTED_GLOBALLY = 0
    //
    // Nothing observes a contract at all, so there is nothing for a declared
    // address to publish — and the observer that DOES exist writes only health,
    // and only for a FIXED address.
    const source = readSource("api/runtime/providers/configured-providers.ts");
    const observer = source.slice(source.indexOf("export function configuredCandidateHandshakeObserver"));
    expect(observer).toMatch(/observation\.endpointMode !== "FIXED"\) return;/);
    expect(observer).not.toMatch(/inputSpec|outputSpec|schema|listTools/i);
    // And the registry's one mutation cannot carry a contract.
    const registrySource = readSource("api/runtime/capability-provider.ts");
    const observe = registrySource.slice(
      registrySource.indexOf("  observe("),
      registrySource.indexOf("  clear()"),
    );
    expect(observe).not.toMatch(/inputSpec|outputSpec|capabilityId|implementationId|trustClass/);
  });

  // ── 17–18 · UNREPRESENTABLE IS NOT PERMISSIVE ────────────────────────────

  it("a contract that cannot be expressed is refused at boot, never flattened", () => {
    //   UNSUPPORTED_JSON_SCHEMA_FAILS_OPEN = 0
    const base = JSON.parse(CONFIG) as any[];
    const variant = (spec: unknown) => {
      const next = JSON.parse(JSON.stringify(base));
      next[0].candidates = { [CUSTOMERS]: { invoke: "SEARCH", inputSpec: spec } };
      return JSON.stringify(next);
    };
    const refused: [string, unknown][] = [
      ["empty", []],
      ["not a list", { name: "query" }],
      ["no name", [{ type: "string" }]],
      ["duplicate name", [{ name: "q", type: "string" }, { name: "q", type: "number" }]],
      ["unknown type", [{ name: "q", type: "uuid" }]],
      ["nested properties", [{ name: "filters", type: "object", properties: { category: {} } }]],
      ["array items", [{ name: "tags", type: "array", items: { type: "string" } }]],
      ["enum", [{ name: "q", type: "string", enum: ["a", "b"] }]],
      ["oneOf", [{ name: "q", type: "string", oneOf: [] }]],
      ["$ref", [{ name: "q", type: "string", $ref: "#/x" }]],
      ["non-boolean required", [{ name: "q", type: "string", required: "yes" }]],
    ];
    for (const [why, spec] of refused) {
      expect(
        () => configured.parseConfiguredCandidates(variant(spec), capabilities),
        why,
      ).toThrow();
    }
    // And a REMOTE schema with an unrepresentable property yields no spec at all
    // rather than defaulting a missing type to `string`.
    const unknownType = providers.normalizeMcpToolMetadata({
      name: "x", serverIdentity: "s", endpoint: FIXED,
      inputSchema: { properties: { q: { type: "string" }, weird: {} }, required: ["q"] },
    } as never);
    expect(unknownType.inputSpec).toBeUndefined();
    // A wholly representable one still maps.
    const flat = providers.normalizeMcpToolMetadata({
      name: "x", serverIdentity: "s", endpoint: FIXED,
      inputSchema: { properties: { q: { type: "string" } }, required: ["q"] },
    } as never);
    expect(flat.inputSpec).toEqual([{ name: "q", type: "string", required: true }]);
  });

  // ── 19 · FORGETTING IS CONSERVATIVE ──────────────────────────────────────

  it("a restart keeps the declared contract and loses the selectability", () => {
    //   RESTART_WIDENS_AUTHORITY = 0
    const registry = bridged();
    available(registry);
    expect(
      resolve(registry, CUSTOMERS, {
        requirementInputSpec: [{ name: "query", type: "string", required: true }],
      }).status,
    ).toBe("SELECTED");
    const restarted = new providers.CapabilityProviderRegistry();
    configured.registerConfiguredCandidates({
      providers: restarted, capabilities, raw: CONFIG, now: at(6 * MINUTE),
    });
    // The contract came from configuration, so it is back. The observation did
    // not, so it is not — and nothing is selectable until a handshake happens.
    expect(restarted.get(`cfg:io.shared:${CUSTOMERS}`)!.inputSpec).toEqual([
      { name: "query", type: "string", required: true },
    ]);
    expect(
      providers.resolveProvider({
        capabilityId: CUSTOMERS, registry: restarted, now: at(6 * MINUTE),
        requirementInputSpec: [{ name: "query", type: "string", required: true }],
      }).status,
    ).toBe("STALE");
  });

  // ── 20–22 · COMPATIBILITY IS NOT AUTHORITY ───────────────────────────────

  it("a perfectly compatible candidate still executes nothing by itself", async () => {
    //   SELECTED_EQUALS_AUTHORIZED = 0 · CANDIDATE_SCHEMA_BYPASSES_BINDING_GATE = 0
    const registry = bridged();
    handshakeByKey.set("k", { ok: true });
    const owner = await connect({ definitionId: "io.shared", apiKey: "k" });
    expect(
      resolve(registry, CUSTOMERS, {
        requirementInputSpec: [{ name: "query", type: "string", required: true }],
      }).status,
    ).toBe("SELECTED");
    // Another scope, with the contract matching perfectly.
    const [row] = await handle.db.insert(users)
      .values({ unionId: `io-${randomUUID()}`, name: "غريب", preferences: {} }).returning();
    const stranger = String(row!.id);
    expect(
      await binding.authorizedConnection({
        bindingId: owner.bindingId, onBehalfOfScopeId: stranger,
        definitionId: "io.shared", requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "NO_SUCH_BINDING" });
    // The owner's own, revoked.
    await binding.revokeBinding({
      bindingId: owner.bindingId, principalId: owner.scopeId, now: at(5 * MINUTE),
    });
    expect(
      await binding.authorizedConnection({
        bindingId: owner.bindingId, onBehalfOfScopeId: owner.scopeId,
        definitionId: "io.shared", requiresCapability: "SEARCH",
      }),
    ).toMatchObject({ refusal: "BINDING_NOT_USABLE" });
    // A verb the contract says nothing about is still refused on its own terms.
    expect(
      await binding.authorizedConnection({
        bindingId: owner.bindingId, onBehalfOfScopeId: owner.scopeId,
        definitionId: "io.shared", requiresCapability: "OBSERVE",
      }),
    ).toMatchObject({ status: "REFUSED" });
  });

  // ── 23–24 · NOTHING IS NAMED ─────────────────────────────────────────────

  it("no provider and no domain decides a contract", () => {
    const source = readSource("api/runtime/providers/configured-providers.ts");
    for (const name of [
      "Stripe", "Shopify", "Moyasar", "Restaurant", "Car", "Hotel", "invoice", "booking",
    ]) {
      expect(source, name).not.toContain(name);
    }
    // The contract path reads only the deployment's own words.
    expect(source).toMatch(/entry\[key\]/);
    expect(source).not.toMatch(/description/);
  });
});

function readSource(relative: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(resolve(process.cwd(), relative), "utf8").replace(
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    "",
  );
}
