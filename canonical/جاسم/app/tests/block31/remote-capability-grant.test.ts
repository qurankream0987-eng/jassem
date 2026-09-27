/**
 * JASIM — THE EXACT VERB, NOT THE SIDE.
 *
 *   PROVIDER_SUPPORTS != BINDING_GRANTED != THIS_OPERATION_REQUIRES
 *   SAME_EFFECT_SIDE != SAME_AUTHORITY
 *   GRANTED_SOME_MUTATION != GRANTED_THIS_MUTATION
 *   GRANTED_SOME_READ != GRANTED_THIS_READ
 *   AUTHORITY_TO_EXECUTE != AUTHORITY_TO_READ_BACK
 *   AUTHORITY_TO_CREATE  != AUTHORITY_TO_CANCEL
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { capabilityProviderCatalog, users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let binding: typeof import("../../api/runtime/provider-binding");
let remote: typeof import("../../api/runtime/block2/remote-execution");
let polling: typeof import("../../api/runtime/block2/remote-polling");
let providers: typeof import("../../api/runtime/capability-provider");

const T0 = new Date("2026-09-27T11:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;
const ENDPOINT = "https://exact.provider.example/mcp";

const dialled: { endpoint: string; method: string }[] = [];
const recordingFactory = (endpoint: string) => ({
  async getTask() {
    dialled.push({ endpoint, method: "tasks/get" });
    return { status: "running" };
  },
  async cancelTask() {
    dialled.push({ endpoint, method: "tasks/cancel" });
    return { confirmed: true };
  },
});

/** What the provider's manifest says it can do at all. */
const SUPPORTS = ["READ", "SEARCH", "OBSERVE", "TRACK", "PAY", "DELETE", "CANCEL"] as const;

describe("which exact operation was granted", () => {
  let ownerScope: string;
  let scopesMade = 0;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    binding = await import("../../api/runtime/provider-binding");
    remote = await import("../../api/runtime/block2/remote-execution");
    polling = await import("../../api/runtime/block2/remote-polling");
    providers = await import("../../api/runtime/capability-provider");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    registry.register({
      id: "xc.remote",
      displayName: "نظام بعيد",
      authMethod: "API_KEY",
      supports: SUPPORTS,
      // The provider says it can do all of these. What any one CONNECTION may
      // do is a different question, answered by its grant.
      endpoint: { mode: "FIXED", baseUrl: ENDPOINT },
      testOnly: true,
      adapter: {
        authenticate: async () => ({ ok: true as const, accountRef: "acct" }),
        // Whatever the account itself turns out to be able to do.
        discover: async () => [...SUPPORTS] as never,
        invoke: async () => ({ status: "OK" as const, value: {} }),
      },
    });
    // A manifest that does NOT include DELETE, for the supported≠granted proof.
    registry.register({
      id: "xc.narrow",
      displayName: "نظام محدود",
      authMethod: "API_KEY",
      supports: ["READ", "TRACK"] as const,
      endpoint: { mode: "FIXED", baseUrl: ENDPOINT },
      testOnly: true,
      adapter: {
        authenticate: async () => ({ ok: true as const, accountRef: "acct" }),
        discover: async () => ["READ", "TRACK", "DELETE"] as never,
        invoke: async () => ({ status: "OK" as const, value: {} }),
      },
    });
    binding.setProviderDefinitionRegistry(registry);
  }, 60_000);

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    dialled.length = 0;
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, remote_executions,
        capability_provider_catalog, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'xc-%'`));
    const [row] = await handle.db.insert(users)
      .values({ unionId: `xc-${randomUUID()}`, name: "صاحب", preferences: {} }).returning();
    ownerScope = String(row!.id);
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  /**
   * A VERIFIED connection granted exactly the verbs asked for.
   *
   * Each gets its OWN scope, because a scope holds at most one connection per
   * provider — which is itself the invariant that makes an account exact.
   */
  async function connect(granted: readonly string[], definitionId = "xc.remote") {
    scopesMade += 1;
    const [row] = await handle.db.insert(users)
      .values({ unionId: `xc-${randomUUID()}`, name: `صاحب ${scopesMade}`, preferences: {} })
      .returning();
    const scope = String(row!.id);
    const opened = await binding.beginProviderSetup({
      principalId: scope, scopeId: scope, definitionId,
      requestedCapabilities: [...granted], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: scope, material: { apiKey: "k" }, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: scope, now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: scope, now: at(3 * MINUTE),
    });
    return { bindingId: opened.bindingId, scope };
  }

  const gate = (
    connection: { bindingId: string; scope: string },
    requiresCapability: string | null,
  ) =>
    binding.authorizedConnection({
      bindingId: connection.bindingId,
      onBehalfOfScopeId: connection.scope,
      definitionId: "xc.remote",
      requiresCapability: requiresCapability as never,
    });

  async function running(
    operations: Record<string, string> | null,
    connection: { bindingId: string; scope: string },
  ) {
    const created = await remote.createRemoteExecution(handle.db as never, {
      ownerId: connection.scope,
      runId: randomUUID(),
      nodeId: randomUUID(),
      providerId: "mcp:exact.example:run",
      bindingId: randomUUID(),
      providerBindingRef: connection.bindingId,
      providerDefinitionId: "xc.remote",
      authorizedOperations: operations,
      protocolKind: "MCP",
      requestDigest: "a".repeat(64),
      idempotencyKey: `idem_${randomUUID()}`,
    } as never);
    return remote.attachRemoteReference(handle.db as never, {
      id: created.id, ownerId: created.ownerId,
      remoteReference: `task_${randomUUID()}`, expectedVersion: created.version,
    });
  }

  // ── 1–4 · ONE SIDE IS NOT ONE AUTHORITY ──────────────────────────────────

  it("a mutating grant authorizes its own verb and no other", async () => {
    //   PAY_GRANT_AUTHORIZES_DELETE = 0 · DELETE_GRANT_AUTHORIZES_PAY = 0
    //   ANY_MUTATING_GRANT_AUTHORIZES_ANY_MUTATION = 0
    const payer = await connect(["PAY"]);
    expect(await gate(payer, "PAY")).toMatchObject({ status: "AUTHORIZED" });
    expect(await gate(payer, "DELETE")).toMatchObject({
      status: "REFUSED", refusal: "CAPABILITY_NOT_GRANTED",
    });
    expect(await gate(payer, "CANCEL")).toMatchObject({ refusal: "CAPABILITY_NOT_GRANTED" });

    const deleter = await connect(["DELETE"]);
    expect(await gate(deleter, "DELETE")).toMatchObject({ status: "AUTHORIZED" });
    expect(await gate(deleter, "PAY")).toMatchObject({
      status: "REFUSED", refusal: "CAPABILITY_NOT_GRANTED",
    });
    // Both are mutations. Neither is the other.
    expect(binding.capabilityMutates("PAY")).toBe(true);
    expect(binding.capabilityMutates("DELETE")).toBe(true);
  });

  it("a reading grant authorizes its own verb and no other", async () => {
    //   OBSERVE_GRANT_AUTHORIZES_SEARCH = 0 · SEARCH_GRANT_AUTHORIZES_OBSERVE = 0
    //   ANY_READING_GRANT_AUTHORIZES_ANY_READ = 0
    const observer = await connect(["OBSERVE"]);
    expect(await gate(observer, "OBSERVE")).toMatchObject({ status: "AUTHORIZED" });
    for (const other of ["SEARCH", "READ", "TRACK"]) {
      expect(await gate(observer, other), other).toMatchObject({
        status: "REFUSED", refusal: "CAPABILITY_NOT_GRANTED",
      });
    }
    const searcher = await connect(["SEARCH"]);
    expect(await gate(searcher, "SEARCH")).toMatchObject({ status: "AUTHORIZED" });
    expect(await gate(searcher, "OBSERVE")).toMatchObject({ refusal: "CAPABILITY_NOT_GRANTED" });
    // The reading verbs are a SET, not a ladder: READ does not contain TRACK.
    const reader = await connect(["READ"]);
    expect(await gate(reader, "TRACK")).toMatchObject({ refusal: "CAPABILITY_NOT_GRANTED" });
  });

  // ── 5–7 · SUPPORTED, GRANTED, REQUIRED ───────────────────────────────────

  it("supported is not granted, and a grant cannot exceed the manifest", async () => {
    //   DEFINITION_SUPPORT_WITHOUT_BINDING_GRANT_EXECUTES = 0
    //   UNSUPPORTED_CAPABILITY_CAN_BE_GRANTED = 0
    //
    // The definition supports DELETE. This connection asked for PAY only.
    expect(SUPPORTS).toContain("DELETE");
    const payer = await connect(["PAY"]);
    expect(await gate(payer, "DELETE")).toMatchObject({ refusal: "CAPABILITY_NOT_GRANTED" });

    // And a connection cannot be granted what the manifest does not support.
    // The refusal comes at the moment it is ASKED for, before a credential is
    // ever collected — so an unsupported verb never becomes a pending request
    // that somebody might later approve.
    await expect(
      binding.beginProviderSetup({
        principalId: ownerScope, scopeId: ownerScope, definitionId: "xc.narrow",
        requestedCapabilities: ["READ", "DELETE"], now: T0,
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    // What the ACCOUNT reports is no wider either: this adapter discovers
    // DELETE, and the manifest does not have it, so the grant cannot.
    const narrow = await connect(["READ", "TRACK"], "xc.narrow");
    const stored = (
      await handle.db.execute(
        sql.raw(`SELECT "grantedCapabilities" g FROM scope_provider_bindings
                 WHERE id = '${narrow.bindingId}'`),
      )
    ).rows[0] as { g: string[] };
    expect(stored.g).toEqual(["READ", "TRACK"]);
    expect(stored.g).not.toContain("DELETE");
  });

  // ── 8–10 · WHO MAY NAME THE VERB ─────────────────────────────────────────

  it("discovery cannot declare the operation it would be authorized as", async () => {
    //   DISCOVERY_CAN_SELF_DECLARE_EXECUTION_CAPABILITY = 0
    //   MODEL_SELECTS_PROVIDER_CAPABILITY = 0
    const registry = new providers.CapabilityProviderRegistry();
    const mcp = providers.normalizeMcpToolMetadata({
      name: "transfer_funds", serverIdentity: "remote.example", endpoint: ENDPOINT,
    } as never);
    expect(mcp.operations).toBeUndefined();
    expect(() => registry.register({ ...mcp, operations: { invoke: "PAY" } })).toThrow(/discovered/i);
    const [a2a] = providers.normalizeAgentCardMetadata({
      agentId: "agent.example", endpoint: ENDPOINT,
      skills: [{ id: "book", description: "books things" }],
    } as never);
    expect(a2a!.operations).toBeUndefined();
    expect(() =>
      registry.register({ ...a2a!, operations: { invoke: "BOOK" } }),
    ).toThrow(/discovered/i);
    // Trusted server configuration is what may say it.
    expect(() =>
      registry.register({
        ...mcp, id: "cfg:remote", definitionId: "xc.remote",
        operations: { invoke: "PAY", readback: "TRACK", cancel: "CANCEL" },
        provenance: { source: "MANUAL_CONFIG" },
      }),
    ).not.toThrow();
  });

  it("a call that names no operation is refused rather than defaulted", async () => {
    const granted = await connect([...SUPPORTS]);
    expect(await gate(granted, "")).toMatchObject({ refusal: "CAPABILITY_NOT_GRANTED" });
    expect(await gate(granted, "WHATEVER")).toMatchObject({ refusal: "CAPABILITY_NOT_GRANTED" });
    expect(await gate(granted, null)).toMatchObject({ refusal: "CAPABILITY_NOT_GRANTED" });
  });

  // ── 11–16 · THE FOLLOW-UPS ARE THEIR OWN OPERATIONS ──────────────────────

  it("a readback needs the verb pinned for it, and no other reading grant will do", async () => {
    //   AUTHORITY_TO_EXECUTE != AUTHORITY_TO_READ_BACK
    //   OTHER_READ_GRANT_AUTHORIZES_POLL = 0
    //
    // Granted PAY and READ — but not TRACK, which is what this execution's
    // readback was pinned as.
    const partial = await connect(["PAY", "READ"]);
    const execution = await running({ invoke: "PAY", readback: "TRACK", cancel: "CANCEL" }, partial);
    await expect(
      polling.pollRemoteExecution(handle.db as never, execution.id, { clientFactory: recordingFactory }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dialled).toHaveLength(0);

    // Granted TRACK: the same readback is authorized.
    const tracker = await connect(["PAY", "TRACK"]);
    const ok = await running({ invoke: "PAY", readback: "TRACK", cancel: "CANCEL" }, tracker);
    await polling.pollRemoteExecution(handle.db as never, ok.id, { clientFactory: recordingFactory });
    expect(dialled).toEqual([{ endpoint: ENDPOINT, method: "tasks/get" }]);
  });

  it("a cancellation needs its own verb, and the verb that started the work is not it", async () => {
    //   AUTHORITY_TO_CREATE != AUTHORITY_TO_CANCEL
    //   OTHER_MUTATING_GRANT_AUTHORIZES_CANCEL = 0 · REFUSED_CANCEL_MOVES_CANONICAL_STATE = 0
    const payer = await connect(["PAY", "TRACK"]);
    const execution = await running({ invoke: "PAY", readback: "TRACK", cancel: "CANCEL" }, payer);
    await expect(
      polling.requestRemoteCancellation(handle.db as never, {
        id: execution.id, ownerId: payer.scope, clientFactory: recordingFactory,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dialled).toHaveLength(0);
    // Nothing moved.
    const state = (
      await handle.db.execute(
        sql.raw(`SELECT state FROM remote_executions WHERE id = '${execution.id}'`),
      )
    ).rows[0] as { state: string };
    expect(state.state).toBe("RUNNING");

    // Granted CANCEL: authorized.
    const canceller = await connect(["PAY", "TRACK", "CANCEL"]);
    const ok = await running({ invoke: "PAY", readback: "TRACK", cancel: "CANCEL" }, canceller);
    await polling.requestRemoteCancellation(handle.db as never, {
      id: ok.id, ownerId: canceller.scope, clientFactory: recordingFactory,
    });
    expect(dialled).toEqual([{ endpoint: ENDPOINT, method: "tasks/cancel" }]);
  });

  it("an execution that pinned no operation has no authorized follow-up", async () => {
    const granted = await connect([...SUPPORTS]);
    // Every verb this provider has is granted. The execution still pinned none.
    const execution = await running(null, granted);
    await expect(
      polling.pollRemoteExecution(handle.db as never, execution.id, { clientFactory: recordingFactory }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      polling.requestRemoteCancellation(handle.db as never, {
        id: execution.id, ownerId: granted.scope, clientFactory: recordingFactory,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // And an invoke-only pin authorizes the invoke and nothing after it.
    const invokeOnly = await running({ invoke: "PAY" }, granted);
    await expect(
      polling.pollRemoteExecution(handle.db as never, invokeOnly.id, { clientFactory: recordingFactory }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dialled).toHaveLength(0);
  });

  it("nothing that changes afterwards changes which verb was required", async () => {
    //   MUTABLE_POLICY_CHANGES_REQUIRED_CAPABILITY = 0
    const granted = await connect(["PAY", "TRACK", "CANCEL"]);
    const execution = await running({ invoke: "PAY", readback: "TRACK", cancel: "CANCEL" }, granted);
    // Discovery now claims a different provider and a different verb, and a
    // policy prefers something else entirely.
    await handle.db.insert(capabilityProviderCatalog).values({
      id: "mcp:exact.example:run", kind: "MCP", implementationId: "run",
      ioMetadata: { endpoint: "https://elsewhere.example/mcp" },
      provenance: { source: "boot" },
    });
    await handle.db.execute(
      sql.raw(`INSERT INTO scope_policies ("id","scopeId","policyKey","value","setByPrincipalId")
               VALUES ('pol_${randomUUID()}','${granted.scope}','source.resolution',
                       '{"preferredProviders":["xc.narrow"]}'::jsonb,'${granted.scope}')`),
    );
    const pinned = (
      await handle.db.execute(
        sql.raw(`SELECT "authorizedOperations" o FROM remote_executions WHERE id = '${execution.id}'`),
      )
    ).rows[0] as { o: { invoke: string; readback: string; cancel: string } };
    expect(pinned.o).toEqual({ invoke: "PAY", readback: "TRACK", cancel: "CANCEL" });
    await polling.pollRemoteExecution(handle.db as never, execution.id, { clientFactory: recordingFactory });
    expect(dialled).toEqual([{ endpoint: ENDPOINT, method: "tasks/get" }]);
  });

  // ── 18–19 · THE OLDER GATES STILL HOLD ───────────────────────────────────

  it("the lifecycle and the single-binding rules are unchanged", async () => {
    const granted = await connect([...SUPPORTS]);
    expect(await gate(granted, "TRACK")).toMatchObject({ status: "AUTHORIZED" });
    await binding.revokeBinding({
      bindingId: granted.bindingId, principalId: granted.scope, now: at(5 * MINUTE),
    });
    expect(await gate(granted, "TRACK")).toMatchObject({
      status: "REFUSED", refusal: "BINDING_NOT_USABLE",
    });
    // The endpoint and the credential still arrive together, from that row.
    const other = await connect([...SUPPORTS]);
    const authorized = await gate(other, "TRACK");
    expect(authorized.status === "AUTHORIZED" && authorized.connection.endpoint).toBe(ENDPOINT);
    expect(authorized.status === "AUTHORIZED" && authorized.connection.credential.apiKey).toBe("k");
  });
});
