/**
 * JASIM — THE UNIVERSAL TRUSTED CONNECTION LAYER.
 *
 *   CONNECTED != VERIFIED · AUTHORIZED != AUTHENTICATED != VERIFIED
 *   READ != WRITE · PROVIDER_WRITE_PERMISSION != JASIM_ACTION_AUTHORITY
 *   SETUP_LINK != AUTHORIZATION · SETUP_LINK != CONNECTED_PROVIDER
 *   PROVIDER_UNAVAILABLE != BUSINESS_FACT
 *
 * Seven provider definitions here stand for seven genuinely different kinds of
 * external system. They differ in what they can do, how they authenticate and
 * where they live. They go through ONE runtime, and no branch anywhere knows
 * which of them is which.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let binding: typeof import("../../api/runtime/provider-binding");
let scopes: typeof import("../../api/runtime/actor-scope");
let sufficiency: typeof import("../../api/runtime/evidence-sufficiency");

const T0 = new Date("2026-09-24T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

/** What a fixture adapter was asked to do. The proof that a gate held. */
const calls: {
  via: "authenticate" | "discover" | "invoke";
  capability: string;
  bindingId: string;
  credential: Record<string, string>;
}[] = [];

describe("connecting an external system", () => {
  let owner: typeof users.$inferSelect;
  let colleague: typeof users.$inferSelect;
  let outsider: typeof users.$inferSelect;
  let ownerScope: string;
  let outsiderScope: string;
  let orgScope: string;
  let registry: InstanceType<typeof import("../../api/runtime/provider-binding").ProviderDefinitionRegistry>;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    binding = await import("../../api/runtime/provider-binding");
    scopes = await import("../../api/runtime/actor-scope");
    sufficiency = await import("../../api/runtime/evidence-sufficiency");

    // ── THE SEVEN HOLDOUTS ────────────────────────────────────────────────
    //
    // Registered into a registry BUILT to hold fixtures. The production
    // registry refuses every one of them, which is asserted below.
    registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    for (const [id, displayName, authMethod, supports, endpoint] of HOLDOUTS) {
      registry.register({
        id,
        displayName,
        authMethod,
        supports,
        endpoint,
        testOnly: true,
        adapter: adapterFor(id),
      });
    }
    binding.setProviderDefinitionRegistry(registry);
  });

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    calls.length = 0;
    behaviour.authenticate = "OK";
    behaviour.discover = undefined;
    behaviour.invoke = "OK";
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, observations,
        memberships, organizations, events, scope_policies CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'pb-%'`));
    const made = [] as (typeof users.$inferSelect)[];
    for (const name of ["مالك", "زميل", "غريب"]) {
      const [row] = await handle.db
        .insert(users)
        .values({ unionId: `pb-${randomUUID()}`, name, preferences: {} })
        .returning();
      made.push(row!);
    }
    [owner, colleague, outsider] = made as [typeof owner, typeof colleague, typeof outsider];
    ownerScope = String(owner.id);
    outsiderScope = String(outsider.id);
    const organization = await scopes.createOrganization({
      principalId: ownerScope,
      displayName: "شركة",
    });
    orgScope = scopes.organizationScopeId(organization.id);
  });

  // ── The whole lifecycle, in one place, so the arrows are visible ─────────

  async function connect(
    definitionId: string,
    options: { scopeId?: string; principalId?: string; capabilities?: string[]; endpointUrl?: string } = {},
  ) {
    const scopeId = options.scopeId ?? ownerScope;
    const principalId = options.principalId ?? ownerScope;
    const opening = await binding.beginProviderSetup({
      principalId,
      scopeId,
      definitionId,
      requestedCapabilities: options.capabilities ?? ["READ"],
      now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opening.bindingId,
      principalId,
      material: MATERIAL,
      // The address goes in with the credential, at the trusted surface, or
      // it does not go in at all.
      ...(options.endpointUrl ? { endpointUrl: options.endpointUrl } : {}),
      now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opening.bindingId,
      principalId,
      now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opening.bindingId,
      principalId,
      now: at(3 * MINUTE),
    });
    return opening.bindingId;
  }

  // ── A · GENERALITY ───────────────────────────────────────────────────────

  it("seven different kinds of external system bind through one runtime", async () => {
    //   DOMAIN_PROVIDER_BINDING_TYPES = 0 · NEW_PROVIDER != NEW_CORE
    for (const [id, , , supports, endpoint] of HOLDOUTS) {
      const bindingId = await connect(id, {
        capabilities: [...supports],
        ...(endpoint.mode === "DECLARED_AT_SETUP"
          ? { endpointUrl: "https://example.com/api" }
          : {}),
      });
      const capabilities = await binding.bindingCapabilities({
        bindingId,
        principalId: ownerScope,
      });
      expect(capabilities!.granted.length, id).toBeGreaterThan(0);
    }
  });

  it("a payment-capable provider is an ordinary binding, not a runtime of its own", async () => {
    //   PAYMENT_PROVIDER_SPECIAL_BINDING_RUNTIME = 0
    const bindingId = await connect("holdout.payments", { capabilities: ["READ", "PAY", "REFUND"] });
    const capabilities = await binding.bindingCapabilities({ bindingId, principalId: ownerScope });
    expect(capabilities!.writes).toContain("PAY");
    // PAY was GRANTED at the binding layer. Nothing in this phase executes one,
    // and the general gate is what a payment runtime will later have to pass.
    expect(binding.capabilityMutates("PAY")).toBe(true);
  });

  // ── B · THE ARROWS ARE SEPARATE FACTS ────────────────────────────────────

  it("a setup link is not a credential, a credential is not a connection", async () => {
    //   SETUP_LINK_CREATED != CREDENTIAL_STORED != AUTHENTICATED != VERIFIED
    const opening = await binding.beginProviderSetup({
      principalId: ownerScope,
      scopeId: ownerScope,
      definitionId: "holdout.inventory",
      requestedCapabilities: ["READ"],
      now: T0,
    });
    expect(opening.lifecycle).toBe("SETUP_PENDING");
    const seen = async () =>
      (await binding.projectBindings({ principalId: ownerScope, scopeId: ownerScope }))[0]!;
    expect((await seen()).lifecycle).toBe("SETUP_PENDING");
    expect((await seen()).capabilities).toEqual([]);

    await binding.completeProviderSetup({
      bindingId: opening.bindingId,
      principalId: ownerScope,
      material: MATERIAL,
      now: at(MINUTE),
    });
    expect((await seen()).lifecycle).toBe("AUTHORIZED");
    //   FALSE_CONNECTED_STATE = 0 — a stored credential grants nothing.
    expect((await seen()).capabilities).toEqual([]);
    expect(calls).toHaveLength(0);

    await binding.authenticateBinding({
      bindingId: opening.bindingId,
      principalId: ownerScope,
      now: at(2 * MINUTE),
    });
    expect((await seen()).lifecycle).toBe("AUTHENTICATED");
    expect((await seen()).capabilities).toEqual([]);

    const verified = await binding.verifyBinding({
      bindingId: opening.bindingId,
      principalId: ownerScope,
      now: at(3 * MINUTE),
    });
    expect(verified.status).toBe("VERIFIED");
    expect((await seen()).lifecycle).toBe("VERIFIED");
    expect((await seen()).capabilities).toEqual(["READ"]);
  });

  it("nothing but a verified binding may be used", async () => {
    const opening = await binding.beginProviderSetup({
      principalId: ownerScope,
      scopeId: ownerScope,
      definitionId: "holdout.inventory",
      requestedCapabilities: ["READ"],
      now: T0,
    });
    for (const step of ["SETUP_PENDING", "AUTHORIZED", "AUTHENTICATED"]) {
      const outcome = await binding.callProvider({
        bindingId: opening.bindingId,
        principalId: ownerScope,
        capability: "READ",
        now: at(4 * MINUTE),
      });
      expect(outcome.status, step).toBe("REFUSED");
      expect(outcome.status === "REFUSED" && outcome.refusal).toBe("BINDING_NOT_USABLE");
      if (step === "SETUP_PENDING") {
        await binding.completeProviderSetup({
          bindingId: opening.bindingId,
          principalId: ownerScope,
          material: MATERIAL,
          now: at(MINUTE),
        });
      } else if (step === "AUTHORIZED") {
        await binding.authenticateBinding({
          bindingId: opening.bindingId,
          principalId: ownerScope,
          now: at(2 * MINUTE),
        });
      }
    }
    // Not one of the refusals reached the adapter as a call. The handshakes
    // that authentication and discovery make are a different thing and are
    // counted separately.
    expect(calls.filter((call) => call.via === "invoke")).toHaveLength(0);
  });

  // ── C · SUPPORTED IS NOT GRANTED ─────────────────────────────────────────

  it("the grant is what the account can do, never what was asked for", async () => {
    //   PROVIDER_SUPPORTS_CAPABILITY != BINDING_GRANTED_CAPABILITY
    //   VERIFIED != FULL ACCESS
    behaviour.discover = ["READ"]; // the account turns out to be read-only
    const opening = await binding.beginProviderSetup({
      principalId: ownerScope,
      scopeId: ownerScope,
      definitionId: "holdout.inventory",
      requestedCapabilities: ["READ", "UPDATE"],
      now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opening.bindingId, principalId: ownerScope, material: MATERIAL, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opening.bindingId, principalId: ownerScope, now: at(2 * MINUTE),
    });
    const verified = await binding.verifyBinding({
      bindingId: opening.bindingId, principalId: ownerScope, now: at(3 * MINUTE),
    });
    expect(verified.status === "VERIFIED" && verified.granted).toEqual(["READ"]);
    expect(verified.status === "VERIFIED" && verified.withheld).toEqual(["UPDATE"]);

    //   READ_GRANT_IMPLIES_WRITE = 0 · UNGRANTED_CAPABILITY_PROVIDER_CALL = 0
    const write = await binding.callProvider({
      bindingId: opening.bindingId, principalId: ownerScope, capability: "UPDATE", now: at(4 * MINUTE),
    });
    expect(write.status).toBe("REFUSED");
    expect(write.status === "REFUSED" && write.refusal).toBe("CAPABILITY_NOT_GRANTED");
    expect(calls.some((call) => call.capability === "UPDATE")).toBe(false);
  });

  it("provider permission is not authority to act", async () => {
    //   PROVIDER_WRITE_PERMISSION != JASIM_ACTION_AUTHORITY
    //   UNAUTHORIZED_WRITE_PROVIDER_CALL = 0
    const bindingId = await connect("holdout.calendar", {
      scopeId: orgScope,
      capabilities: ["READ", "SCHEDULE"],
    });
    // A member who may look but not act. The binding itself grants SCHEDULE.
    await grant(colleague, ["view"]);
    const capabilities = await binding.bindingCapabilities({
      bindingId,
      principalId: String(colleague.id),
    });
    expect(capabilities!.writes).toContain("SCHEDULE");

    const attempted = await binding.callProvider({
      bindingId,
      principalId: String(colleague.id),
      capability: "SCHEDULE",
      now: at(5 * MINUTE),
    });
    expect(attempted.status).toBe("REFUSED");
    expect(attempted.status === "REFUSED" && attempted.refusal).toBe("NOT_AUTHORIZED_TO_ACT");
    expect(calls.some((call) => call.capability === "SCHEDULE")).toBe(false);

    // The same person reading is fine, which is what makes the refusal above
    // about the ACT rather than about them.
    const read = await binding.callProvider({
      bindingId, principalId: String(colleague.id), capability: "READ", now: at(5 * MINUTE),
    });
    expect(read.status).toBe("OK");
  });

  // ── D · THE SETUP SURFACE ────────────────────────────────────────────────

  it("an expired setup connects nothing", async () => {
    //   EXPIRED_SETUP_LINK_ACCEPTED = 0
    const opening = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: ownerScope, definitionId: "holdout.inventory",
      requestedCapabilities: ["READ"], ttlMs: MINUTE, now: T0,
    });
    await expect(
      binding.completeProviderSetup({
        bindingId: opening.bindingId, principalId: ownerScope, material: MATERIAL,
        now: at(2 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "STATE" });
    expect(await credentialCount()).toBe(0);
  });

  it("a replayed setup connects nothing a second time", async () => {
    //   SETUP_LINK_REPLAY_ACCEPTED = 0
    //   CALLBACK_REPLAY_CREATES_DUPLICATE_BINDING = 0
    const opening = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: ownerScope, definitionId: "holdout.inventory",
      requestedCapabilities: ["READ"], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opening.bindingId, principalId: ownerScope, material: MATERIAL, now: at(MINUTE),
    });
    await expect(
      binding.completeProviderSetup({
        bindingId: opening.bindingId, principalId: ownerScope, material: MATERIAL,
        now: at(2 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "STATE" });
    expect(await bindingCount()).toBe(1);
  });

  it("a setup link from another scope is refused the way a guess is", async () => {
    //   CROSS_SCOPE_SETUP_LINK_ACCEPTED = 0 · CROSS_SCOPE_BINDING = 0
    const opening = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: ownerScope, definitionId: "holdout.inventory",
      requestedCapabilities: ["READ"], now: T0,
    });
    const stranger = binding.completeProviderSetup({
      bindingId: opening.bindingId, principalId: outsiderScope, material: MATERIAL, now: at(MINUTE),
    });
    await expect(stranger).rejects.toMatchObject({ code: "NOT_FOUND" });
    const guessed = binding.completeProviderSetup({
      bindingId: `bind_${randomUUID()}`, principalId: outsiderScope, material: MATERIAL, now: at(MINUTE),
    });
    // Identical refusal: an id that exists elsewhere and an id that exists
    // nowhere must be indistinguishable, or guessing becomes an oracle.
    await expect(guessed).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await credentialCount()).toBe(0);
  });

  it("connecting the same system twice surfaces the first rather than duplicating it", async () => {
    await connect("holdout.inventory");
    await expect(
      binding.beginProviderSetup({
        principalId: ownerScope, scopeId: ownerScope, definitionId: "holdout.inventory",
        requestedCapabilities: ["READ"], now: at(10 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "STATE" });
    expect(await bindingCount()).toBe(1);
  });

  // ── E · THE SECRET ───────────────────────────────────────────────────────

  it("no credential material reaches the binding row, a projection or an event", async () => {
    //   RAW_PROVIDER_SECRET_IN_CANONICAL_BINDING = 0
    //   RAW_PROVIDER_SECRET_IN_EVENT_LOG = 0 · SECRET_RETURNED_IN_BINDING_READ = 0
    const bindingId = await connect("holdout.inventory");
    const sentinel = MATERIAL.apiKey;

    const rows = await handle.db.execute(
      sql.raw(`SELECT row_to_json(t) AS body FROM scope_provider_bindings t`),
    );
    const eventRows = await handle.db.execute(sql.raw(`SELECT row_to_json(t) AS body FROM events t`));
    const credentialRows = await handle.db.execute(
      sql.raw(`SELECT row_to_json(t) AS body FROM provider_credentials t`),
    );
    const projection = await binding.projectBindings({ principalId: ownerScope, scopeId: ownerScope });
    const capabilities = await binding.bindingCapabilities({ bindingId, principalId: ownerScope });

    for (const [label, body] of [
      ["binding row", JSON.stringify(rows.rows)],
      ["event log", JSON.stringify(eventRows.rows)],
      ["vault row", JSON.stringify(credentialRows.rows)],
      ["projection", JSON.stringify(projection)],
      ["capabilities", JSON.stringify(capabilities)],
    ] as const) {
      expect(body, `${label} carries the secret`).not.toContain(sentinel);
    }
    // The vault row exists and is sealed, so the absence above is encryption
    // rather than the credential never having been stored.
    expect(credentialRows.rows).toHaveLength(1);
    // And no projection carries even the REFERENCE.
    expect(JSON.stringify(projection)).not.toContain("pcr_");
    expect(calls.every((call) => call.credential.apiKey === sentinel)).toBe(true);
  });

  it("a sealed credential cannot be moved to another binding", async () => {
    const first = await connect("holdout.inventory");
    const second = await connect("holdout.calendar", { capabilities: ["READ"] });
    const [row] = (
      await handle.db.execute(
        sql.raw(`SELECT "credentialRef" AS ref FROM scope_provider_bindings WHERE id = '${first}'`),
      )
    ).rows as { ref: string }[];
    const vault = await import("../../api/runtime/provider-credential-vault");
    await expect(
      vault.providerCredentialVault().open(row!.ref, {
        scopeId: ownerScope,
        bindingId: second,
        version: 1,
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  // ── F · REVOCATION ───────────────────────────────────────────────────────

  it("a revoked connection is not used again", async () => {
    //   REVOKED_BINDING_USED = 0
    const bindingId = await connect("holdout.inventory");
    expect(
      (await binding.callProvider({
        bindingId, principalId: ownerScope, capability: "READ", now: at(4 * MINUTE),
      })).status,
    ).toBe("OK");
    const before = calls.filter((call) => call.via === "invoke").length;

    const revoked = await binding.revokeBinding({
      bindingId, principalId: ownerScope, now: at(5 * MINUTE),
    });
    expect(revoked.lifecycle).toBe("REVOKED");
    // Local revocation is enough on its own: a provider that could not be told
    // is never a reason to keep acting.
    expect(revoked.remoteRevocation).toBe("NOT_SUPPORTED");

    const after = await binding.callProvider({
      bindingId, principalId: ownerScope, capability: "READ", now: at(6 * MINUTE),
    });
    expect(after.status).toBe("REFUSED");
    expect(after.status === "REFUSED" && after.refusal).toBe("BINDING_NOT_USABLE");
    expect(calls.filter((call) => call.via === "invoke")).toHaveLength(before);
  });

  // ── G · ORGANIZATIONS ────────────────────────────────────────────────────

  it("an organization's connection belongs to the organization, not the person", async () => {
    const bindingId = await connect("holdout.erp", {
      scopeId: orgScope, capabilities: ["READ", "UPDATE"],
    });
    const personal = await binding.projectBindings({
      principalId: ownerScope, scopeId: ownerScope,
    });
    expect(personal).toHaveLength(0);
    const organizational = await binding.projectBindings({
      principalId: ownerScope, scopeId: orgScope,
    });
    expect(organizational.map((row) => row.bindingId)).toEqual([bindingId]);
  });

  it("a former member manages nothing the organization owns", async () => {
    //   FORMER_MEMBER_MANAGES_ORG_BINDING = 0
    const bindingId = await connect("holdout.erp", {
      scopeId: orgScope, capabilities: ["READ", "UPDATE"],
    });
    const membershipId = await grant(colleague, ["view", "mutate", "manage_providers"]);
    // While they are a member, they may manage it.
    expect(
      (await binding.bindingCapabilities({ bindingId, principalId: String(colleague.id) }))!.granted,
    ).toContain("READ");

    // Through the membership runtime, because that is what revocation is. An
    // UPDATE of my own guessing would have proven only that my UPDATE ran.
    const memberships = await import("../../api/runtime/block2/membership");
    await memberships.revokeMembership(handle.db as never, {
      membershipId,
      actorOwnerId: orgScope,
    });
    await expect(
      binding.revokeBinding({
        bindingId, principalId: String(colleague.id), now: at(8 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await binding.bindingCapabilities({ bindingId, principalId: String(colleague.id) })).toBeNull();
    // And it is still there for the organization.
    const still = await binding.projectBindings({ principalId: ownerScope, scopeId: orgScope });
    expect(still[0]!.lifecycle).toBe("VERIFIED");
  });

  it("an unauthorized member cannot connect anything for the organization", async () => {
    await grant(colleague, ["view"]);
    await expect(
      binding.beginProviderSetup({
        principalId: String(colleague.id), scopeId: orgScope, definitionId: "holdout.erp",
        requestedCapabilities: ["READ"], now: T0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await bindingCount()).toBe(0);
  });

  it("somebody else's connection is not visible and not readable", async () => {
    //   CROSS_SCOPE_BINDING = 0
    const bindingId = await connect("holdout.inventory");
    expect(
      await binding.projectBindings({ principalId: outsiderScope, scopeId: ownerScope }),
    ).toHaveLength(0);
    expect(
      await binding.bindingCapabilities({ bindingId, principalId: outsiderScope }),
    ).toBeNull();
    const used = await binding.callProvider({
      bindingId, principalId: outsiderScope, capability: "READ", now: at(4 * MINUTE),
    });
    expect(used.status === "REFUSED" && used.refusal).toBe("NO_SUCH_BINDING");
    expect(calls.filter((call) => call.via === "invoke")).toHaveLength(0);
  });

  // ── H · THE PROVIDER FAILING IS NOT A FACT ───────────────────────────────

  it("a provider that cannot be reached says nothing about the world", async () => {
    //   PROVIDER_UNAVAILABLE != BUSINESS_FACT · PROVIDER_ERROR != UNAVAILABLE
    const bindingId = await connect("holdout.inventory");
    behaviour.invoke = "UNAVAILABLE";
    const down = await binding.callProvider({
      bindingId, principalId: ownerScope, capability: "READ", now: at(4 * MINUTE),
    });
    expect(down.status).toBe("PROVIDER_UNAVAILABLE");
    behaviour.invoke = "ERROR";
    const errored = await binding.callProvider({
      bindingId, principalId: ownerScope, capability: "READ", now: at(5 * MINUTE),
    });
    // Two different states, kept different. Neither is `false`, `unavailable`
    // or `out of stock`, and neither wrote an observation.
    expect(errored.status).toBe("PROVIDER_ERROR");
    expect(await observationCount()).toBe(0);
  });

  it("authentication failing suspends rather than connects", async () => {
    behaviour.authenticate = "FAIL";
    const opening = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: ownerScope, definitionId: "holdout.inventory",
      requestedCapabilities: ["READ"], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opening.bindingId, principalId: ownerScope, material: MATERIAL, now: at(MINUTE),
    });
    const attempted = await binding.authenticateBinding({
      bindingId: opening.bindingId, principalId: ownerScope, now: at(2 * MINUTE),
    });
    expect(attempted.status).toBe("FAILED");
    await expect(
      binding.verifyBinding({
        bindingId: opening.bindingId, principalId: ownerScope, now: at(3 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "STATE" });
  });

  it("verification fails when the account is not the one expected", async () => {
    const opening = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: ownerScope, definitionId: "holdout.inventory",
      requestedCapabilities: ["READ"], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opening.bindingId, principalId: ownerScope, material: MATERIAL, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opening.bindingId, principalId: ownerScope, now: at(2 * MINUTE),
    });
    //   AUTHENTICATION_SUCCESS != FULL_PROVIDER_VERIFICATION
    const verified = await binding.verifyBinding({
      bindingId: opening.bindingId, principalId: ownerScope,
      expectedAccountRef: "somebody-else", now: at(3 * MINUTE),
    });
    expect(verified.status).toBe("FAILED");
    const seen = await binding.projectBindings({ principalId: ownerScope, scopeId: ownerScope });
    expect(seen[0]!.lifecycle).toBe("SUSPENDED");
    expect(seen[0]!.capabilities).toEqual([]);
  });

  it("verification fails when the account grants none of what was asked for", async () => {
    behaviour.discover = [];
    const opening = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: ownerScope, definitionId: "holdout.inventory",
      requestedCapabilities: ["READ"], now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opening.bindingId, principalId: ownerScope, material: MATERIAL, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opening.bindingId, principalId: ownerScope, now: at(2 * MINUTE),
    });
    const verified = await binding.verifyBinding({
      bindingId: opening.bindingId, principalId: ownerScope, now: at(3 * MINUTE),
    });
    expect(verified.status).toBe("FAILED");
  });

  it("a connection test never writes anything", async () => {
    //   CONNECTION_TEST_CAUSES_BUSINESS_MUTATION = 0
    await connect("holdout.calendar", { capabilities: ["READ", "CREATE", "SCHEDULE"] });
    // The provider supports CREATE and SCHEDULE and the binding was granted
    // both. Setting it up touched neither.
    expect(calls).not.toHaveLength(0);
    expect(calls.every((call) => !binding.capabilityMutates(call.capability))).toBe(true);
  });

  // ── I · THE NETWORK BOUNDARY ─────────────────────────────────────────────

  it("a custom endpoint cannot reach the inside of the network", async () => {
    //   UNTRUSTED_ENDPOINT_CAN_ACCESS_INTERNAL_NETWORK = 0
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: an unsafe address is refused by `beginProviderSetup`.
    // WHY_IT_IS_WRONG: not the refusal — the BOUNDARY. `beginProviderSetup` is
    //   reached from a conversation, so an address it accepted was an address
    //   the model chose. Passing this test proved the network check worked and
    //   said nothing about who picked the destination.
    // NEW_EXPECTATION: the same addresses are refused at
    //   `completeProviderSetup`, the trusted surface, where a person types
    //   them — and `beginProviderSetup` has nowhere to put one at all.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: the old boundary let an SSRF-safe
    //   public address through on the model's say-so. This one requires both:
    //   technically safe, AND chosen by the authorized person.
    //
    const opening = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: ownerScope, definitionId: "holdout.custom",
      requestedCapabilities: ["READ"], now: T0,
    });
    for (const endpoint of [
      "http://example.com/api",
      "https://127.0.0.1/api",
      "https://localhost/api",
      "https://sub.localhost/api",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.5/api",
      "https://192.168.1.1/api",
      "https://172.16.0.9/api",
      "https://100.64.0.1/api",
      "https://[::1]/api",
      "https://[fd00::1]/api",
      "https://[fe80::1]/api",
      // Not a network problem: a base endpoint carrying a query or an
      // authority credential is where a secret would sit if one reached a URL.
      "https://api.example.com/v1?token=abc",
      "https://user:pass@api.example.com/v1",
      "file:///etc/passwd",
      "not a url",
    ]) {
      await expect(
        binding.completeProviderSetup({
          bindingId: opening.bindingId, principalId: ownerScope,
          material: MATERIAL, endpointUrl: endpoint, now: at(MINUTE),
        }),
        endpoint,
      ).rejects.toMatchObject({ code: "INVALID" });
    }
    // Nothing was sealed and nothing was bound by any of them.
    expect(await credentialCount()).toBe(0);
    const [row] = (
      await handle.db.execute(
        sql.raw(`SELECT "endpointUrl" AS url, lifecycle FROM scope_provider_bindings`),
      )
    ).rows as { url: string | null; lifecycle: string }[];
    expect(row!.url).toBeNull();
    expect(row!.lifecycle).toBe("SETUP_PENDING");
  });

  // ── J · PROVIDER OUTPUT IS EVIDENCE, NOT A VERDICT ───────────────────────

  it("what a verified provider read becomes evidence the freshness runtime judges", async () => {
    //   PROVIDER_RESPONSE != CANONICAL_TRUTH
    //   PROVIDER_BINDING_DECLARES_BUSINESS_TRUTH = 0
    //   PROVIDER_RESPONSE_BYPASSES_FRESHNESS = 0
    const bindingId = await connect("holdout.inventory");
    const read = await binding.callProvider({
      bindingId, principalId: ownerScope, capability: "READ", now: at(4 * MINUTE),
    });
    expect(read.status).toBe("OK");
    await binding.recordProviderEvidence({
      bindingId, principalId: ownerScope,
      subjectKind: "offering", subjectId: "off_x", property: "availability",
      value: true, observedAt: at(4 * MINUTE),
    });

    const fact = { subjectKind: "offering", subjectId: "off_x", property: "availability" } as const;
    // Fresh: a bound provider receipt is strong enough to commit on.
    const fresh = await sufficiency.assessSufficiency({
      fact, purpose: "COMMIT", scopeId: ownerScope, now: at(5 * MINUTE),
    });
    expect(fresh.verdict).toBe("SUFFICIENT");
    expect(fresh.evidence?.source).toBe("BOUND_PROVIDER_RECEIPT");

    // Stale: the SAME reading, later. The provider did not decide this — age
    // did, and the binding runtime never had a vote.
    const stale = await sufficiency.assessSufficiency({
      fact, purpose: "COMMIT", scopeId: ownerScope, now: at(60 * MINUTE),
    });
    expect(stale.verdict).toBe("STRONGER_EVIDENCE_REQUIRED");
  });

  it("a human answer still works where no binding exists", async () => {
    //   HUMAN_FALLBACK_PRESERVED — the phase before this one is not displaced.
    const fact = { subjectKind: "offering", subjectId: "off_y", property: "availability" } as const;
    const nothing = await sufficiency.assessSufficiency({
      fact, purpose: "COMMIT", scopeId: ownerScope, now: T0,
    });
    expect(nothing.verdict).toBe("UNKNOWN");
    // The counterparty runtime's own source is untouched and still accepted.
    const observations = await import("../../api/runtime/block2/observations");
    await observations.recordObservation(handle.db as never, {
      ownerId: ownerScope, subjectKind: "offering", subjectId: "off_y",
      observationType: "availability", observedAt: at(MINUTE),
      sourceKind: "counterparty_confirm", payload: { value: true },
    });
    const answered = await sufficiency.assessSufficiency({
      fact, purpose: "COMMIT", scopeId: ownerScope, now: at(2 * MINUTE),
    });
    expect(answered.verdict).toBe("SUFFICIENT");
    expect(answered.evidence?.source).toBe("OWNER_CONFIRMATION");
  });

  it("an unverified binding cannot write evidence at all", async () => {
    const opening = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: ownerScope, definitionId: "holdout.inventory",
      requestedCapabilities: ["READ"], now: T0,
    });
    await expect(
      binding.recordProviderEvidence({
        bindingId: opening.bindingId, principalId: ownerScope,
        subjectKind: "offering", subjectId: "off_z", property: "availability",
        value: true, observedAt: at(MINUTE),
      }),
    ).rejects.toMatchObject({ code: "STATE" });
    expect(await observationCount()).toBe(0);
  });

  // ── K · NO FIXTURE IS A PRODUCTION PROVIDER ──────────────────────────────

  it("the production registry is empty and refuses every fixture", async () => {
    //   PRODUCTION_FAKE_PROVIDER = 0
    expect(binding.providerDefinitions.list()).toHaveLength(0);
    expect(() =>
      binding.providerDefinitions.register({
        id: "holdout.inventory", displayName: "x", authMethod: "API_KEY",
        supports: ["READ"], endpoint: { mode: "FIXED", baseUrl: "https://example.com" },
        testOnly: true, adapter: adapterFor("holdout.inventory"),
      }),
    ).toThrowError(/test fixture/);
    expect(binding.providerDefinitions.list()).toHaveLength(0);
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Through the membership runtime, so no column list here can be wrong. */
  async function grant(user: typeof users.$inferSelect, permissions: string[]): Promise<string> {
    const memberships = await import("../../api/runtime/block2/membership");
    const granted = await memberships.grantMembership(handle.db as never, {
      ownerId: orgScope,
      subjectId: String(user.id),
      resourceKind: "organization",
      resourceId: "*",
      permissions,
    });
    return granted.membership.id;
  }
  async function bindingCount(): Promise<number> {
    const result = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM scope_provider_bindings`));
    return (result.rows[0] as { n: number }).n;
  }
  async function credentialCount(): Promise<number> {
    const result = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM provider_credentials`));
    return (result.rows[0] as { n: number }).n;
  }
  async function observationCount(): Promise<number> {
    const result = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM observations`));
    return (result.rows[0] as { n: number }).n;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The fixtures. Test code, and only test code.
// ─────────────────────────────────────────────────────────────────────────────

const MATERIAL = Object.freeze({
  apiKey: "SENTINEL-c0ffee-do-not-store-me",
  username: "u",
  password: "SENTINEL-c0ffee-do-not-store-me",
  token: "SENTINEL-c0ffee-do-not-store-me",
  accessToken: "SENTINEL-c0ffee-do-not-store-me",
  certificate: "SENTINEL-c0ffee-do-not-store-me",
});

/** What the fixtures do next. Set per test, never read by the runtime. */
const behaviour: {
  authenticate: "OK" | "FAIL";
  discover: string[] | undefined;
  invoke: "OK" | "UNAVAILABLE" | "ERROR";
} = { authenticate: "OK", discover: undefined, invoke: "OK" };

type Holdout = [
  string,
  string,
  "API_KEY" | "BASIC_CREDENTIAL" | "SIGNED_TOKEN" | "OAUTH_AUTHORIZATION_CODE" | "CERTIFICATE",
  readonly ("READ" | "SEARCH" | "DISCOVER" | "OBSERVE" | "TRACK" | "CREATE" | "UPDATE" | "DELETE" | "BOOK" | "SCHEDULE" | "MESSAGE" | "PAY" | "REFUND")[],
  { mode: "FIXED"; baseUrl: string } | { mode: "DECLARED_AT_SETUP" },
];

/**
 * Seven kinds of external system, described only by what they DO.
 *
 * The ids are opaque to the runtime, which never reads one. They differ in
 * capability manifest, authentication method and endpoint policy — the three
 * axes a real provider actually differs on.
 */
const HOLDOUTS: readonly Holdout[] = [
  ["holdout.inventory", "نظام المخزون", "API_KEY", ["READ", "SEARCH", "UPDATE"], { mode: "FIXED", baseUrl: "https://example.com/inventory" }],
  ["holdout.calendar", "التقويم", "OAUTH_AUTHORIZATION_CODE", ["READ", "CREATE", "SCHEDULE"], { mode: "FIXED", baseUrl: "https://example.com/calendar" }],
  ["holdout.erp", "نظام الموارد", "BASIC_CREDENTIAL", ["READ", "UPDATE", "CREATE"], { mode: "FIXED", baseUrl: "https://example.com/erp" }],
  ["holdout.documents", "مستودع الوثائق", "SIGNED_TOKEN", ["READ", "SEARCH"], { mode: "FIXED", baseUrl: "https://example.com/docs" }],
  ["holdout.telemetry", "أجهزة القياس", "CERTIFICATE", ["OBSERVE", "TRACK"], { mode: "FIXED", baseUrl: "https://example.com/telemetry" }],
  ["holdout.custom", "واجهة خاصة", "API_KEY", ["READ", "CREATE"], { mode: "DECLARED_AT_SETUP" }],
  ["holdout.payments", "بوابة دفع", "API_KEY", ["READ", "PAY", "REFUND"], { mode: "FIXED", baseUrl: "https://example.com/payments" }],
];

function adapterFor(id: string) {
  const supports = HOLDOUTS.find(([candidate]) => candidate === id)![3];
  return {
    authenticate: async (context: { bindingId: string; capability: string; credential: Readonly<Record<string, string>> }) => {
      calls.push({ via: "authenticate", capability: context.capability, bindingId: context.bindingId, credential: { ...context.credential } });
      return behaviour.authenticate === "OK"
        ? { ok: true as const, accountRef: `acct_${id}`, accountLabel: `حساب ${id}` }
        : { ok: false as const, detail: "The credential was not accepted." };
    },
    discover: async (context: { bindingId: string; capability: string; credential: Readonly<Record<string, string>> }) => {
      calls.push({ via: "discover", capability: context.capability, bindingId: context.bindingId, credential: { ...context.credential } });
      return (behaviour.discover ?? supports) as never;
    },
    invoke: async (
      context: { bindingId: string; capability: string; credential: Readonly<Record<string, string>> },
      request: { capability: string },
    ) => {
      calls.push({ via: "invoke", capability: request.capability, bindingId: context.bindingId, credential: { ...context.credential } });
      if (behaviour.invoke === "UNAVAILABLE") {
        return { status: "UNAVAILABLE" as const, detail: "unreachable" };
      }
      if (behaviour.invoke === "ERROR") return { status: "ERROR" as const, detail: "refused" };
      return { status: "OK" as const, value: { answered: true } };
    },
  };
}
