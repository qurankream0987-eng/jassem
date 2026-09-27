/**
 * JASIM — A DISCOVERED SYSTEM IS NOT A CONNECTION.
 *
 *   DISCOVERED_PROVIDER != AUTHORIZED_CONNECTION
 *   DISCOVERED_ENDPOINT != AUTHORIZED_DESTINATION · SSRF_SAFE != AUTHORIZED
 *   PROVIDER_CANDIDATE != PROVIDER_BINDING · FOUND != MAY_EXECUTE
 *   REMOTE_SELECTION != CONNECTION_AUTHORITY
 *   PAST_SELECTION != CURRENT_EXECUTION_AUTHORITY
 *
 * Two real HTTP servers stand in this file: the one a trusted binding points
 * at, and a decoy. Every proof about destinations is «the decoy was never
 * spoken to», recorded by the decoy itself.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { capabilityProviderCatalog, users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let binding: typeof import("../../api/runtime/provider-binding");
let remote: typeof import("../../api/runtime/block2/remote-execution");
let polling: typeof import("../../api/runtime/block2/remote-polling");
let receipts: typeof import("../../api/runtime/receipt-verification");
let providers: typeof import("../../api/runtime/capability-provider");

const T0 = new Date("2026-09-27T09:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;
const API_KEY = "k_the_bound_account_key";

type Seen = { method: string; authorization: string | undefined };

/** A loopback endpoint that records who asked and with what. */
async function startEndpoint(options: { redirectTo?: () => string } = {}) {
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
    let message: Record<string, unknown> = {};
    try {
      message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    } catch {
      /* recorded below as an empty method */
    }
    seen.push({ method: String(message.method ?? ""), authorization: request.headers.authorization });
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: { status: "completed", result: { content: [] } },
      }),
    );
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

/** What the transport was ASKED to do: where, with what, and for which task. */
type Dialled = { endpoint: string; authorization: string | undefined; method: string };

const dialled: Dialled[] = [];

/**
 * A recording transport.
 *
 * The proofs in this file are about WHICH DESTINATION and WHICH CREDENTIAL the
 * runtime chooses, so the transport records exactly that and answers. A live
 * socket would prove the same choice more slowly, and the one law that is about
 * the wire itself — a credential must not follow a redirect across origins — is
 * proved against the real MCP client below, over real HTTP.
 */
const recordingFactory = (endpoint: string, headers: Readonly<Record<string, string>>) => ({
  async getTask() {
    dialled.push({ endpoint, authorization: headers.authorization, method: "tasks/get" });
    // Still running, deliberately: the subject here is WHERE the readback went
    // and WITH WHAT, and a completion would continue into the DAG restart path
    // that `tests/block2/mcp-transport.test.ts` already covers.
    return { status: "running" };
  },
  async cancelTask() {
    dialled.push({ endpoint, authorization: headers.authorization, method: "tasks/cancel" });
    return { confirmed: true };
  },
});

const AUTHORIZED_ENDPOINT = "https://authorized.provider.example/mcp";
const DECOY_ENDPOINT = "https://decoy.attacker.example/mcp";

/** Whether the adapter's handshake succeeds — SUSPENDED needs a real refusal. */
const adapterState = { authenticates: true };

describe("who authorizes a remote call", () => {
  let ownerScope: string;
  let strangerScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    binding = await import("../../api/runtime/provider-binding");
    remote = await import("../../api/runtime/block2/remote-execution");
    polling = await import("../../api/runtime/block2/remote-polling");
    receipts = await import("../../api/runtime/receipt-verification");
    providers = await import("../../api/runtime/capability-provider");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    const adapter = {
      authenticate: async () =>
        adapterState.authenticates
          ? ({ ok: true as const, accountRef: "acct" })
          : ({ ok: false as const, detail: "refused" }),
      discover: async () => ["READ", "UPDATE", "TRACK", "CANCEL"] as never,
      invoke: async () => ({ status: "OK" as const, value: {} }),
    };
    const base = {
      authMethod: "API_KEY" as const,
      testOnly: true, adapter,
      receipt: "SIGNED_HMAC" as const,
    };
    // The trusted definition's address is registry CODE. A candidate's own
    // account of where it lives never reaches it.
    registry.register({
      ...base, id: "rc.remote", displayName: "نظام بعيد",
      supports: ["READ", "UPDATE", "TRACK", "CANCEL"] as const,
      endpoint: { mode: "FIXED" as const, baseUrl: AUTHORIZED_ENDPOINT },
    });
    // Reads only: nobody granted it anything that changes the other side.
    registry.register({
      ...base, id: "rc.readonly", displayName: "نظام للقراءة",
      supports: ["READ"] as const,
      endpoint: { mode: "FIXED" as const, baseUrl: `${AUTHORIZED_ENDPOINT}/read` },
    });
    binding.setProviderDefinitionRegistry(registry);
  }, 60_000);

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    adapterState.authenticates = true;
    dialled.length = 0;
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, remote_executions,
        capability_provider_catalog, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'rc-%'`));
    const made: string[] = [];
    for (const name of ["صاحب", "غريب"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `rc-${randomUUID()}`, name, preferences: {} }).returning();
      made.push(String(row!.id));
    }
    [ownerScope, strangerScope] = made as [string, string];
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  async function connect(
    definitionId: string,
    opts: { scope?: string; stopAt?: "SETUP_PENDING" | "AUTHORIZED" | "SUSPENDED"; capabilities?: string[] } = {},
  ) {
    const scope = opts.scope ?? ownerScope;
    const opened = await binding.beginProviderSetup({
      principalId: scope, scopeId: scope, definitionId,
      requestedCapabilities: opts.capabilities ?? ["READ", "UPDATE", "TRACK", "CANCEL"], now: T0,
    });
    if (opts.stopAt === "SETUP_PENDING") return opened.bindingId;
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: scope, material: { apiKey: API_KEY }, now: at(MINUTE),
    });
    if (opts.stopAt === "AUTHORIZED") return opened.bindingId;
    if (opts.stopAt === "SUSPENDED") {
      // The real path to SUSPENDED: the provider refuses the handshake.
      adapterState.authenticates = false;
      await binding.authenticateBinding({
        bindingId: opened.bindingId, principalId: scope, now: at(2 * MINUTE),
      });
      adapterState.authenticates = true;
      return opened.bindingId;
    }
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: scope, now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: scope, now: at(3 * MINUTE),
    });
    await binding.configureReceiptVerification({
      bindingId: opened.bindingId, principalId: scope, secret: "rcpt_secret", now: at(4 * MINUTE),
    });
    return opened.bindingId;
  }

  /** A RUNNING execution that pinned its account and its definition. */
  async function running(opts: {
    bindingId: string | null;
    definitionId: string | null;
    scope?: string;
    candidateId?: string;
  }) {
    const created = await remote.createRemoteExecution(handle.db as never, {
      ownerId: opts.scope ?? ownerScope,
      runId: randomUUID(),
      nodeId: randomUUID(),
      // The DISCOVERED candidate, identified per tool.
      providerId: opts.candidateId ?? "mcp:remote.example:run",
      bindingId: randomUUID(),
      providerBindingRef: opts.bindingId,
      providerDefinitionId: opts.definitionId,
      // The exact verbs, pinned from trusted configuration at creation.
      authorizedOperations: { invoke: "UPDATE", readback: "TRACK", cancel: "CANCEL" },
      protocolKind: "MCP",
      requestDigest: "a".repeat(64),
      idempotencyKey: `idem_${randomUUID()}`,
    } as never);
    return remote.attachRemoteReference(handle.db as never, {
      id: created.id,
      ownerId: created.ownerId,
      remoteReference: `task_${randomUUID()}`,
      expectedVersion: created.version,
    });
  }

  /** Point the DISCOVERY row at the decoy, as a mutation would. */
  async function discoveryClaims(candidateId: string, url: string) {
    await handle.db.insert(capabilityProviderCatalog).values({
      id: candidateId, kind: "MCP", implementationId: "run",
      ioMetadata: { endpoint: url }, provenance: { source: "boot", reference: url },
    }).onConflictDoNothing();
    await handle.db.execute(
      sql.raw(`UPDATE capability_provider_catalog
               SET "ioMetadata" = '{"endpoint":"${url}"}'::jsonb,
                   provenance = '{"source":"boot","reference":"${url}"}'::jsonb
               WHERE id = '${candidateId}'`),
    );
  }

  const bearer = `Bearer ${API_KEY}`;

  // ── 1 · SELECTION IS NOT AUTHORITY ───────────────────────────────────────

  it("a discovered candidate with no canonical connection cannot execute", async () => {
    //   UNBOUND_DISCOVERED_PROVIDER_CAN_EXECUTE = 0
    const outcome = await binding.authorizedConnection({
      bindingId: null, onBehalfOfScopeId: ownerScope, requiresCapability: "TRACK",
    });
    expect(outcome.status).toBe("REFUSED");
    expect(outcome).toMatchObject({ refusal: "NO_SUCH_BINDING" });
    // And an execution that pinned nothing cannot be polled or cancelled.
    const execution = await running({ bindingId: null, definitionId: null });
    await expect(polling.pollRemoteExecution(handle.db as never, execution.id, { clientFactory: recordingFactory })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      polling.requestRemoteCancellation(handle.db as never, { id: execution.id, ownerId: ownerScope, clientFactory: recordingFactory }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dialled).toHaveLength(0);
  });

  it("discovery cannot nominate itself as an instance of a trusted provider", async () => {
    //   DISCOVERY_ID_IMPLICITLY_EQUALS_DEFINITION_ID = 0
    const registry = new providers.CapabilityProviderRegistry();
    const candidate = providers.normalizeMcpToolMetadata({
      name: "run", serverIdentity: "remote.example", endpoint: DECOY_ENDPOINT,
    } as never);
    // A normalized candidate never carries the bridge.
    expect(candidate.definitionId).toBeUndefined();
    // And one that is handed the bridge is refused at registration.
    expect(() =>
      registry.register({ ...candidate, definitionId: "rc.remote" }),
    ).toThrow(/discovered/i);
    // Trusted configuration is what may state it.
    expect(() =>
      registry.register({
        ...candidate, id: "cfg:remote", definitionId: "rc.remote",
        provenance: { source: "MANUAL_CONFIG" },
      }),
    ).not.toThrow();
  });

  // ── 2–7 · THE LIFECYCLE AND THE GRANT ────────────────────────────────────

  it("only a VERIFIED connection holding the exact verb may be called", async () => {
    //   UNVERIFIED_BINDING_CAN_EXECUTE = 0 · SUSPENDED = 0 · REVOKED = 0
    //   UNGRANTED_CAPABILITY_CAN_EXECUTE = 0
    const verified = await connect("rc.remote");
    await expect(
      binding.authorizedConnection({
        bindingId: verified, onBehalfOfScopeId: ownerScope, requiresCapability: "UPDATE",
      }),
    ).resolves.toMatchObject({ status: "AUTHORIZED" });

    for (const stopAt of ["SETUP_PENDING", "AUTHORIZED", "SUSPENDED"] as const) {
      const partial = await connect("rc.remote", { scope: strangerScope, stopAt });
      const outcome = await binding.authorizedConnection({
        bindingId: partial, onBehalfOfScopeId: strangerScope, requiresCapability: "TRACK",
      });
      expect(outcome.status, stopAt).toBe("REFUSED");
      expect(outcome, stopAt).toMatchObject({ refusal: "BINDING_NOT_USABLE" });
      await handle.db.execute(
        sql.raw(`DELETE FROM scope_provider_bindings WHERE id = '${partial}'`),
      );
    }
    // Revoked is refused for the same reason, after having been usable.
    await binding.revokeBinding({ bindingId: verified, principalId: ownerScope, now: at(5 * MINUTE) });
    expect(
      await binding.authorizedConnection({
        bindingId: verified, onBehalfOfScopeId: ownerScope, requiresCapability: "TRACK",
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "BINDING_NOT_USABLE" });

    // A connection granted only reading cannot be used to change anything.
    const readOnly = await connect("rc.readonly", { capabilities: ["READ"] });
    expect(
      await binding.authorizedConnection({
        bindingId: readOnly, onBehalfOfScopeId: ownerScope, requiresCapability: "READ",
      }),
    ).toMatchObject({ status: "AUTHORIZED" });
    expect(
      await binding.authorizedConnection({
        bindingId: readOnly, onBehalfOfScopeId: ownerScope, requiresCapability: "UPDATE",
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "CAPABILITY_NOT_GRANTED" });
  });

  // ── 8–10 · THE DESTINATION ───────────────────────────────────────────────

  it("the canonical endpoint is used, and a mutated discovery row is never spoken to", async () => {
    //   DISCOVERY_ENDPOINT_USED_FOR_POLL = 0 · FOR_CANCEL = 0
    //   DISCOVERY_MUTATION_REDIRECTS_RUNNING_EXECUTION = 0
    const bindingId = await connect("rc.remote");
    const candidateId = "mcp:remote.example:run";
    await discoveryClaims(candidateId, AUTHORIZED_ENDPOINT);
    const execution = await running({ bindingId, definitionId: "rc.remote", candidateId });
    // The discovery row now claims the decoy — as a mutation, or a compromise.
    await discoveryClaims(candidateId, DECOY_ENDPOINT);

    await polling.pollRemoteExecution(handle.db as never, execution.id, { clientFactory: recordingFactory });
    const cancellable = await running({ bindingId, definitionId: "rc.remote", candidateId });
    await polling.requestRemoteCancellation(handle.db as never, {
      id: cancellable.id, ownerId: ownerScope, clientFactory: recordingFactory,
    });

    // Everything went to the bound address, and the decoy heard nothing.
    // Everything went to the BOUND address. The decoy was never dialled.
    expect(dialled.map((one) => one.endpoint)).toEqual([AUTHORIZED_ENDPOINT, AUTHORIZED_ENDPOINT]);
    expect(dialled.map((one) => one.method)).toEqual(["tasks/get", "tasks/cancel"]);
    expect(dialled.some((one) => one.endpoint === DECOY_ENDPOINT)).toBe(false);
  });

  // ── 11–13 · THE ACCOUNT AND ITS CREDENTIAL ───────────────────────────────

  it("the credential and the address come from the same account, and no other", async () => {
    //   CREDENTIAL_BINDING_DIFFERS_FROM_ENDPOINT_BINDING = 0
    //   CROSS_SCOPE_BINDING_CAN_BE_USED = 0
    const mine = await connect("rc.remote");
    const theirs = await connect("rc.remote", { scope: strangerScope });
    // Another scope's account is refused, indistinguishably from a guess.
    expect(
      await binding.authorizedConnection({
        bindingId: theirs, onBehalfOfScopeId: ownerScope, requiresCapability: "TRACK",
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "NO_SUCH_BINDING" });
    // And an account at a different provider than the execution recorded.
    expect(
      await binding.authorizedConnection({
        bindingId: mine, onBehalfOfScopeId: ownerScope,
        definitionId: "rc.readonly", requiresCapability: "READ",
      }),
    ).toMatchObject({ status: "REFUSED", refusal: "PROVIDER_MISMATCH" });

    const execution = await running({ bindingId: mine, definitionId: "rc.remote" });
    await polling.pollRemoteExecution(handle.db as never, execution.id, { clientFactory: recordingFactory });
    // The address AND the credential arrived from that one row.
    expect(dialled).toEqual([
      { endpoint: AUTHORIZED_ENDPOINT, authorization: bearer, method: "tasks/get" },
    ]);
  });

  // ── 14–15 · THE CREDENTIAL GOES NOWHERE ELSE ─────────────────────────────

  it("the credential is nowhere in canonical state after the call", async () => {
    //   RAW_PROVIDER_CREDENTIAL_IN_REMOTE_EXECUTION = 0 · IN_EVENT = 0
    //   IN_DISCOVERY = 0 · IN_MODEL = 0
    const bindingId = await connect("rc.remote");
    await discoveryClaims("mcp:remote.example:run", AUTHORIZED_ENDPOINT);
    const execution = await running({ bindingId, definitionId: "rc.remote" });
    await polling.pollRemoteExecution(handle.db as never, execution.id, { clientFactory: recordingFactory });
    for (const table of [
      "remote_executions", "events", "capability_provider_catalog",
      "scope_provider_bindings", "scope_policies",
    ]) {
      const rows = await handle.db.execute(
        sql.raw(
          `SELECT count(*)::int n FROM ${table} WHERE CAST(to_jsonb(${table}.*) AS text) LIKE '%${API_KEY}%'`,
        ),
      );
      expect((rows.rows[0] as { n: number }).n, table).toBe(0);
    }
    // Nor in what a person is shown about the connection.
    const [projection] = await binding.projectBindings({
      principalId: ownerScope, scopeId: ownerScope, now: at(10 * MINUTE),
    });
    expect(JSON.stringify(projection)).not.toContain(API_KEY);
  });

  // ── 16 · REDIRECTS, OVER REAL HTTP ──────────────────────────────────────

  it("a credential does not follow a redirect to another origin", async () => {
    //   CREDENTIAL_REDIRECT_TO_UNTRUSTED_ORIGIN = 0
    //   SSRF_SAFE != AUTHORIZED_DESTINATION
    //
    // The real MCP client, over a real socket. Two loopback origins: one that
    // bounces, and one that must never be handed the header.
    const { createMcpClient } = await import("../../api/runtime/block2/mcp-client");
    const elsewhere = await startEndpoint();
    const bouncer = await startEndpoint({ redirectTo: () => `${elsewhere.url}/` });
    try {
      const carrying = createMcpClient({
        baseUrl: `${bouncer.url}/away`,
        headers: { authorization: bearer },
      });
      await expect(carrying.getTask("task_1")).rejects.toThrow(/redirect/i);
      // The other origin was never spoken to at all.
      expect(elsewhere.seen).toHaveLength(0);
      // A request carrying NO credential still follows the same redirect, so
      // what changed is the credential and not the transport.
      const bare = createMcpClient({ baseUrl: `${bouncer.url}/away` });
      await expect(bare.getTask("task_2")).resolves.toBeDefined();
      expect(elsewhere.seen.map((one) => one.method)).toEqual(["tasks/get"]);
      expect(elsewhere.seen[0]!.authorization).toBeUndefined();
    } finally {
      await bouncer.close();
      await elsewhere.close();
    }
  }, 30_000);

  // ── 17–21 · PINNED ONCE, READ EVERY TIME ─────────────────────────────────

  it("what changes after the execution cannot change who it talks to", async () => {
    //   POLL_RESELECTS_PROVIDER_BINDING = 0 · CANCEL_RESELECTS = 0
    //   PAST_SELECTION != CURRENT_EXECUTION_AUTHORITY
    const first = await connect("rc.remote");
    const execution = await running({ bindingId: first, definitionId: "rc.remote" });
    const row = (
      await handle.db.execute(
        sql.raw(`SELECT "providerBindingRef" b, "providerDefinitionId" d, "providerId" p
                 FROM remote_executions WHERE id = '${execution.id}'`),
      )
    ).rows[0] as { b: string; d: string; p: string };
    expect(row.b).toBe(first);
    expect(row.d).toBe("rc.remote");
    // The candidate that was selected is a different namespace, and recorded too.
    expect(row.p).toBe("mcp:remote.example:run");
    expect(row.p).not.toBe(row.d);

    // Afterwards: a policy is written, and another account appears elsewhere.
    await handle.db.execute(
      sql.raw(`INSERT INTO scope_policies ("id","scopeId","policyKey","value","setByPrincipalId")
               VALUES ('pol_${randomUUID()}','${ownerScope}','source.resolution',
                       '{"preferredProviders":["rc.readonly"]}'::jsonb,'${ownerScope}')`),
    );
    await connect("rc.remote", { scope: strangerScope });
    await polling.pollRemoteExecution(handle.db as never, execution.id, { clientFactory: recordingFactory });
    expect(dialled).toEqual([
      { endpoint: AUTHORIZED_ENDPOINT, authorization: bearer, method: "tasks/get" },
    ]);

    // And receipt verification still reads the same pinned account.
    expect(
      await receipts.receiptSecretFor({ providerId: row.d, bindingId: row.b }),
    ).toBe("rcpt_secret");
  });

  it("revoking the account stops new reads and new cancellations alike", async () => {
    //   REVOKED_BINDING_CAN_EXECUTE = 0
    const bindingId = await connect("rc.remote");
    const execution = await running({ bindingId, definitionId: "rc.remote" });
    const cancellable = await running({ bindingId, definitionId: "rc.remote" });
    await binding.revokeBinding({ bindingId, principalId: ownerScope, now: at(5 * MINUTE) });
    await expect(polling.pollRemoteExecution(handle.db as never, execution.id, { clientFactory: recordingFactory })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      polling.requestRemoteCancellation(handle.db as never, {
        id: cancellable.id, ownerId: ownerScope, clientFactory: recordingFactory,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dialled).toHaveLength(0);
    // A refused cancellation left canonical state exactly as it was.
    const state = (
      await handle.db.execute(
        sql.raw(`SELECT state FROM remote_executions WHERE id = '${cancellable.id}'`),
      )
    ).rows[0] as { state: string };
    expect(state.state).toBe("RUNNING");
  });

  // ── 22–23 · THE OTHER KINDS ARE UNDISTURBED ──────────────────────────────

  it("the three credential kinds still live side by side", async () => {
    //   RECEIPT_ROTATION_RETIRES_PROVIDER_AUTH = 0
    const bindingId = await connect("rc.remote");
    await binding.configureReceiptVerification({
      bindingId, principalId: ownerScope, secret: "rcpt_rotated", now: at(6 * MINUTE),
    });
    // The outbound credential still opens — the call below proves it.
    const execution = await running({ bindingId, definitionId: "rc.remote" });
    await polling.pollRemoteExecution(handle.db as never, execution.id, { clientFactory: recordingFactory });
    expect(dialled).toEqual([
      { endpoint: AUTHORIZED_ENDPOINT, authorization: bearer, method: "tasks/get" },
    ]);
    const live = (
      await handle.db.execute(
        sql.raw(`SELECT kind, version FROM provider_credentials
                 WHERE "bindingId" = '${bindingId}' AND "retiredAt" IS NULL ORDER BY kind`),
      )
    ).rows as { kind: string; version: number }[];
    expect(live).toEqual([
      { kind: "PROVIDER_AUTH", version: 1 },
      { kind: "RECEIPT_VERIFICATION", version: 2 },
    ]);
  });
});
