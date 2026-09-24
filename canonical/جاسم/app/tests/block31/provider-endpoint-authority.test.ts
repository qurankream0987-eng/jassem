/**
 * JASIM — WHO CHOOSES WHERE A CREDENTIAL IS SENT?
 *
 *   MODEL != CREDENTIAL DESTINATION AUTHORITY
 *   MODEL_SUGGESTED_ENDPOINT != TRUSTED_ENDPOINT
 *   CONVERSATION_URL != CREDENTIAL_TARGET
 *   SSRF_SAFE != AUTHORIZED_DESTINATION
 *
 * The binding runtime's network boundary was already good, and that was never
 * the question. A public HTTPS address that passes every check can still be
 * the wrong address, and until this phase the model could pick it.
 *
 * Network safety answers «is this safe to contact».
 * Trusted setup answers «did the authorized person actually choose this».
 * Both are required, and the decisive test below is the second one.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let binding: typeof import("../../api/runtime/provider-binding");
let scopes: typeof import("../../api/runtime/actor-scope");

const T0 = new Date("2026-09-24T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

/** Where the adapter was actually pointed. The only thing that settles this. */
const reached: string[] = [];

/** Resolvable, so the real network boundary is exercised, not stubbed. */
const CHOSEN = "https://example.com/v1";
/** Public. HTTPS. Resolvable. Perfectly SSRF-safe. And not the person's. */
const ATTACKER = "https://example.org/v1";

const MATERIAL = Object.freeze({ apiKey: "SENTINEL-endpoint-authority" });

describe("who chooses where a credential is sent", () => {
  let owner: typeof users.$inferSelect;
  let colleague: typeof users.$inferSelect;
  let outsider: typeof users.$inferSelect;
  let ownerScope: string;
  let outsiderScope: string;
  let orgScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    binding = await import("../../api/runtime/provider-binding");
    scopes = await import("../../api/runtime/actor-scope");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    const adapter = {
      authenticate: async (context: { endpoint: string }) => {
        reached.push(context.endpoint);
        return { ok: true as const, accountRef: "acct", accountLabel: "حساب" };
      },
      discover: async (context: { endpoint: string }) => {
        reached.push(context.endpoint);
        return ["READ"] as never;
      },
      invoke: async (context: { endpoint: string }) => {
        reached.push(context.endpoint);
        return { status: "OK" as const, value: null };
      },
    };
    // One provider whose address is registry code, one whose address the
    // person declares. Same runtime, same lifecycle, same vault.
    registry.register({
      id: "ea.fixed", displayName: "نظام ثابت", authMethod: "API_KEY",
      supports: ["READ"], endpoint: { mode: "FIXED", baseUrl: "https://fixed-example.com/api" },
      testOnly: true, adapter,
    });
    registry.register({
      id: "ea.custom", displayName: "واجهة خاصة", authMethod: "API_KEY",
      supports: ["READ"], endpoint: { mode: "DECLARED_AT_SETUP" },
      testOnly: true, adapter,
    });
    binding.setProviderDefinitionRegistry(registry);
  });

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    reached.length = 0;
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, observations,
        memberships, organizations, events, product_action_sessions CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'ea-%'`));
    const made = [] as (typeof users.$inferSelect)[];
    for (const name of ["مالك", "زميل", "غريب"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `ea-${randomUUID()}`, name, preferences: {} }).returning();
      made.push(row!);
    }
    [owner, colleague, outsider] = made as [typeof owner, typeof colleague, typeof outsider];
    ownerScope = String(owner.id);
    outsiderScope = String(outsider.id);
    const organization = await scopes.createOrganization({
      principalId: ownerScope, displayName: "شركة",
    });
    orgScope = scopes.organizationScopeId(organization.id);
  });

  const open = (over: { scopeId?: string; principalId?: string; definitionId?: string; ttlMs?: number } = {}) =>
    binding.beginProviderSetup({
      principalId: over.principalId ?? ownerScope,
      scopeId: over.scopeId ?? ownerScope,
      definitionId: over.definitionId ?? "ea.custom",
      requestedCapabilities: ["READ"],
      ...(over.ttlMs ? { ttlMs: over.ttlMs } : {}),
      now: T0,
    });

  async function endpointOf(bindingId: string): Promise<string | null> {
    const result = await handle.db.execute(
      sql.raw(`SELECT "endpointUrl" AS url FROM scope_provider_bindings WHERE id = '${bindingId}'`),
    );
    return (result.rows[0] as { url: string | null }).url;
  }

  // ── A · THE DECISIVE TEST ────────────────────────────────────────────────

  it("the model cannot name the address, even a perfectly valid public one", async () => {
    //   MODEL_CHOSEN_PUBLIC_ENDPOINT_ACCEPTED = 0
    //
    // This is the whole phase. The attacker's address is HTTPS, public, and
    // would pass every network check that exists. It is refused because
    // nobody authorized it — and there is nowhere for the model to put it.
    const { ProviderBindingRequestSchema } = await import("../../api/runtime/jasim-runtime");
    const attempted = ProviderBindingRequestSchema.safeParse({
      intent: "CONNECT",
      definitionId: "ea.custom",
      capabilities: ["READ"],
      endpointUrl: ATTACKER,
    });
    expect(attempted.success).toBe(false);

    // And the runtime behind it has no parameter for one either — so a caller
    // that smuggles the field past the schema still changes nothing. This is
    // the second path, closed: refusing the field and ignoring the value are
    // different guarantees, and both hold.
    const withUrl = binding.beginProviderSetup as unknown as (
      input: Record<string, unknown>,
    ) => Promise<{ bindingId: string }>;
    const opened = await withUrl({
      principalId: ownerScope, scopeId: ownerScope, definitionId: "ea.custom",
      requestedCapabilities: ["READ"], endpointUrl: ATTACKER, now: T0,
    });
    expect(await endpointOf(opened.bindingId)).toBeNull();
    // Nothing was contacted, so nothing could have received a credential.
    expect(reached).toHaveLength(0);
  });

  it("a URL somebody typed in the conversation does not become the destination", async () => {
    //   CHAT_URL_AUTOMATICALLY_BECOMES_CREDENTIAL_DESTINATION = 0
    //
    // «موقعي API هو https://api.example.com» is a sentence. The model may
    // understand it. Understanding is not deciding.
    const opened = await open();
    expect(opened.lifecycle).toBe("SETUP_PENDING");
    // The opening does not carry an address, and it SAYS one is wanted.
    expect(JSON.stringify(opened)).not.toContain("api.example.com");
    expect(opened.collects.map((field) => field.key)).toContain("endpoint");
    // And the field it names is not sensitive — it is the one thing on that
    // surface a person reads back to check before submitting.
    expect(opened.collects.find((field) => field.key === "endpoint")!.sensitive).toBe(false);
    expect(await endpointOf(opened.bindingId)).toBeNull();
  });

  it("the trusted presentation offers no prefill for anybody to accept silently", async () => {
    // The reason there is no «suggestion» path at all: the contract a surface
    // renders carries no value, ever. There is nowhere to put a hint.
    const actions = await import("../../api/runtime/product-actions");
    const connect = actions.getProductAction("provider.connect")!;
    const presentation = actions.presentationFor(connect);
    expect(JSON.stringify(presentation)).not.toContain("value");
    expect(presentation.fields.every((field) => !("value" in field))).toBe(true);
    // The endpoint is collected there, and it is the only non-sensitive field
    // besides the binding it targets.
    expect(presentation.fields.map((field) => field.key)).toContain("endpoint");
    expect(
      presentation.fields.filter((field) => field.kind !== "SENSITIVE").map((field) => field.key),
    ).toEqual(["bindingId", "endpoint"]);
  });

  // ── B · THE TRUSTED SURFACE DECIDES ──────────────────────────────────────

  it("the address the person typed is the address the credential is used against", async () => {
    const opened = await open();
    const done = await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: ownerScope,
      material: MATERIAL, endpointUrl: CHOSEN, now: at(MINUTE),
    });
    expect(done.lifecycle).toBe("AUTHORIZED");
    expect(done.endpointHost).toBe("example.com");
    expect(await endpointOf(opened.bindingId)).toBe(`${CHOSEN}`);

    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: ownerScope, now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: ownerScope, now: at(3 * MINUTE),
    });
    await binding.callProvider({
      bindingId: opened.bindingId, principalId: ownerScope, capability: "READ",
      now: at(4 * MINUTE),
    });
    // Every single contact went to the address from the trusted surface.
    expect(reached).not.toHaveLength(0);
    expect(new Set(reached)).toEqual(new Set([CHOSEN]));
  });

  it("a connection with no address is never sealed and never usable", async () => {
    const opened = await open();
    await expect(
      binding.completeProviderSetup({
        bindingId: opened.bindingId, principalId: ownerScope,
        material: MATERIAL, now: at(MINUTE),
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    const credentials = await handle.db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM provider_credentials`),
    );
    //   TRUSTED_CREDENTIAL + UNTRUSTED_DESTINATION = INVALID CONNECTION
    // Neither half is kept when the other is missing.
    expect((credentials.rows[0] as { n: number }).n).toBe(0);
    expect(await endpointOf(opened.bindingId)).toBeNull();
  });

  // ── C · A FIXED PROVIDER'S ADDRESS IS NOBODY'S TO SET ────────────────────

  it("a fixed provider asks for no address and accepts none", async () => {
    //   MODEL_OVERRIDES_FIXED_PROVIDER_ENDPOINT = 0
    //   FIXED_PROVIDER_ENDPOINT_FROM_DEFINITION = PASS
    const opened = await open({ definitionId: "ea.fixed" });
    expect(opened.collects.map((field) => field.key)).not.toContain("endpoint");

    // Supplying one is REFUSED, not ignored — dropping it silently would leave
    // whoever sent it believing it took effect.
    await expect(
      binding.completeProviderSetup({
        bindingId: opened.bindingId, principalId: ownerScope,
        material: MATERIAL, endpointUrl: ATTACKER, now: at(MINUTE),
      }),
    ).rejects.toMatchObject({ code: "INVALID" });

    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: ownerScope, material: MATERIAL, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: ownerScope, now: at(2 * MINUTE),
    });
    expect(reached).toEqual(["https://fixed-example.com/api"]);
    expect(await endpointOf(opened.bindingId)).toBeNull();
  });

  // ── D · THE ADDRESS IS BOUND TO THIS SETUP AND NO OTHER ──────────────────

  it("an address cannot be submitted against somebody else's connection", async () => {
    //   CROSS_SCOPE_ENDPOINT_SUBMISSION = 0
    const opened = await open();
    await expect(
      binding.completeProviderSetup({
        bindingId: opened.bindingId, principalId: outsiderScope,
        material: MATERIAL, endpointUrl: ATTACKER, now: at(MINUTE),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await endpointOf(opened.bindingId)).toBeNull();
  });

  it("an address cannot be moved between two of this scope's own connections", async () => {
    //   CROSS_BINDING_ENDPOINT_SWAP = 0
    //
    // Structural rather than checked: the address and the credential arrive in
    // ONE submission naming ONE binding, so there is no pair to mismatch.
    const first = await open();
    await binding.completeProviderSetup({
      bindingId: first.bindingId, principalId: ownerScope,
      material: MATERIAL, endpointUrl: CHOSEN, now: at(MINUTE),
    });
    const second = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: orgScope, definitionId: "ea.custom",
      requestedCapabilities: ["READ"], now: at(2 * MINUTE),
    });
    await binding.completeProviderSetup({
      bindingId: second.bindingId, principalId: ownerScope,
      material: MATERIAL, endpointUrl: "https://example.net/v1", now: at(3 * MINUTE),
    });
    expect(await endpointOf(first.bindingId)).toBe(CHOSEN);
    expect(await endpointOf(second.bindingId)).toBe("https://example.net/v1");
    // And a second submission against the first cannot repoint it, because
    // the setup was consumed.
    await expect(
      binding.completeProviderSetup({
        bindingId: first.bindingId, principalId: ownerScope,
        material: MATERIAL, endpointUrl: ATTACKER, now: at(4 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "STATE" });
    expect(await endpointOf(first.bindingId)).toBe(CHOSEN);
  });

  it("an expired setup binds no address", async () => {
    const opened = await open({ ttlMs: MINUTE });
    await expect(
      binding.completeProviderSetup({
        bindingId: opened.bindingId, principalId: ownerScope,
        material: MATERIAL, endpointUrl: CHOSEN, now: at(2 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: "STATE" });
    expect(await endpointOf(opened.bindingId)).toBeNull();
  });

  it("an unauthorized organization member cannot set the address", async () => {
    const memberships = await import("../../api/runtime/block2/membership");
    await memberships.grantMembership(handle.db as never, {
      ownerId: orgScope, subjectId: String(colleague.id),
      resourceKind: "organization", resourceId: "*", permissions: ["view"],
    });
    const opened = await binding.beginProviderSetup({
      principalId: ownerScope, scopeId: orgScope, definitionId: "ea.custom",
      requestedCapabilities: ["READ"], now: T0,
    });
    await expect(
      binding.completeProviderSetup({
        bindingId: opened.bindingId, principalId: String(colleague.id),
        material: MATERIAL, endpointUrl: ATTACKER, now: at(MINUTE),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await endpointOf(opened.bindingId)).toBeNull();
  });

  // ── E · WHAT IS REMEMBERED, AND WHAT IS NOT ──────────────────────────────

  it("the credential stays secret and the audit keeps only the host", async () => {
    const opened = await open();
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: ownerScope,
      material: MATERIAL, endpointUrl: CHOSEN, now: at(MINUTE),
    });
    const events = await handle.db.execute(sql.raw(`SELECT row_to_json(t) AS body FROM events t`));
    const body = JSON.stringify(events.rows);
    expect(body).not.toContain(MATERIAL.apiKey);
    // The host is recorded. The path is not, and there is no query to record
    // because one is refused before it reaches here.
    expect(body).toContain("example.com");
    expect(body).not.toContain("/v1");
  });

  it("revoking still stops the connection being used against that address", async () => {
    const opened = await open();
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: ownerScope,
      material: MATERIAL, endpointUrl: CHOSEN, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: ownerScope, now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: ownerScope, now: at(3 * MINUTE),
    });
    await binding.revokeBinding({
      bindingId: opened.bindingId, principalId: ownerScope, now: at(4 * MINUTE),
    });
    const before = reached.length;
    const used = await binding.callProvider({
      bindingId: opened.bindingId, principalId: ownerScope, capability: "READ",
      now: at(5 * MINUTE),
    });
    expect(used.status).toBe("REFUSED");
    expect(reached).toHaveLength(before);
  });

  // ── F · A DESTINATION DOES NOT AUTHORIZE WHAT IT POINTS AT ───────────────

  it("a credential may not follow a redirect off its own origin", async () => {
    //   CREDENTIAL_REDIRECT_TO_UNTRUSTED_ORIGIN = 0
    //
    // No transport exists yet, so this is the contract an adapter calls before
    // following anything — tested rather than only written down.
    expect(() => binding.assertWithinEndpoint(CHOSEN, `${CHOSEN}/accounts`)).not.toThrow();
    expect(() => binding.assertWithinEndpoint(CHOSEN, "/accounts")).not.toThrow();
    for (const elsewhere of [
      ATTACKER,
      // A suffix match is not an origin match.
      "https://example.com.attacker-example.org/v1",
      "https://evil.example.com/v1",
      "https://sub.example.com/v1",
      // Same host, other scheme. Same host, other port.
      "http://example.com/v1",
      "https://example.com:8443/v1",
    ]) {
      expect(() => binding.assertWithinEndpoint(CHOSEN, elsewhere), elsewhere).toThrowError(
        /another origin/,
      );
    }
  });
});
