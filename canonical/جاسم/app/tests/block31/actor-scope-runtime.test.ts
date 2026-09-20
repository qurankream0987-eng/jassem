/**
 * JASIM — WHO IS USING JASIM, and ON WHOSE AUTHORITY.
 *
 * ─── THE DISTINCTION UNDER TEST ─────────────────────────────────────────────
 *
 *   AUTHENTICATED PRINCIPAL  !=  ACTING SCOPE
 *
 * One person, two scopes. «شخصياً» and «باسم شركة النور» are the same identity
 * acting as different owners, and the rows they write belong to different
 * scopes. There is no personal account and no business account.
 *
 * ─── ONE RUNTIME, ONE MARKET ────────────────────────────────────────────────
 *
 * Person→Business, Business→Business and Business→Person all go through the
 * SAME exchange and the SAME two capabilities. A `BusinessMarketplace` beside
 * a `PersonalMarketplace` would be the failure this file exists to catch.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { economicExpressions, executionAttempts, memberships, runs } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let scope: typeof import("../../api/runtime/actor-scope");
let membership: typeof import("../../api/runtime/block2/membership");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

/** Conversation rows key their owner numerically; scope ids are opaque. */
const HASSAN = "9801";
const LAYLA = "9802";

describe("a person acts personally or on an organization's authority", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    scope = await import("../../api/runtime/actor-scope");
    membership = await import("../../api/runtime/block2/membership");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE events, economic_expressions, economic_matches,
        organizations, memberships, scope_policies, scope_provider_bindings CASCADE`),
    );
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  const org = (principalId: string, displayName: string, attributes?: Record<string, unknown>) =>
    scope.createOrganization({ principalId, displayName, ...(attributes ? { attributes } : {}) });

  /** One node through the real executor, owned by a given scope. */
  async function runNode(input: {
    capabilityId: string;
    inputs: Record<string, unknown>;
    ownerId: string;
  }) {
    const run = await runtime.createRuntimeRun({
      ownerId: input.ownerId,
      goal: `scope: ${input.capabilityId}`,
      idempotencyKey: `scope-${randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId: input.ownerId,
      runId: run.id,
      nodes: [
        { nodeKey: "act", capabilityId: input.capabilityId, inputs: input.inputs, maxAttempts: 1 },
      ],
    });
    await runtime.executeRuntimeDagNode({
      ownerId: input.ownerId,
      runId: run.id,
      workerId: "scope-worker",
    });
    const [attempt] = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id));
    const envelope = (attempt!.normalizedResult ?? {}) as { result?: Record<string, unknown> };
    return { attempt: attempt!, result: (envelope.result ?? {}) as Record<string, unknown> };
  }

  const publishAs = (ownerId: string, over: Record<string, unknown> = {}) =>
    runNode({
      capabilityId: "opportunity-publish",
      ownerId,
      inputs: {
        kind: "OFFERING",
        semanticType: "generic unit",
        summary: "عرض",
        visibility: "PUBLIC",
        attributes: { quantity: 100, unitPrice: 1 },
        ...over,
      },
    });

  // ── 1. Organizations and membership ───────────────────────────────────────

  it("creating an organization makes its creator a member, not a special case", async () => {
    const created = await org(HASSAN, "شركة النور");
    // The founder's authority comes through the same grant mechanism as anyone
    // else's, so revoking it revokes their authority.
    const rows = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.ownerId, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subjectId).toBe(HASSAN);
    expect(rows[0]!.permissions).toEqual(expect.arrayContaining(["publish", "manage_policies"]));
  });

  it("a person may belong to none, one, or many organizations", async () => {
    expect((await scope.listActingScopes(LAYLA)).organizations).toHaveLength(0);
    const first = await org(LAYLA, "مؤسسة أ");
    expect((await scope.listActingScopes(LAYLA)).organizations).toHaveLength(1);
    await org(LAYLA, "مؤسسة ب");
    expect((await scope.listActingScopes(LAYLA)).organizations).toHaveLength(2);
    expect(first.createdByPrincipalId).toBe(LAYLA);
  });

  it("an organization may contain many people", async () => {
    const created = await org(HASSAN, "شركة النور");
    await membership.grantMembership(handle.db, {
      ownerId: created.id,
      subjectId: LAYLA,
      resourceKind: scope.ORGANIZATION_RESOURCE_KIND,
      permissions: ["view", "publish"],
    });
    expect((await scope.listActingScopes(LAYLA)).organizations).toHaveLength(1);
  });

  // ── 2. Permissions are generic ────────────────────────────────────────────

  it("a member holds only what was granted", async () => {
    const created = await org(HASSAN, "شركة النور");
    await membership.grantMembership(handle.db, {
      ownerId: created.id,
      subjectId: LAYLA,
      resourceKind: scope.ORGANIZATION_RESOURCE_KIND,
      permissions: ["view"],
    });
    const view = await scope.authorizeScopeAction({
      principalId: LAYLA,
      scopeId: created.id,
      permission: "view",
    });
    expect(view.ok).toBe(true);

    const publish = await scope.authorizeScopeAction({
      principalId: LAYLA,
      scopeId: created.id,
      permission: "publish",
    });
    expect(publish.ok).toBe(false);
  });

  it("a person always holds everything in their own scope", async () => {
    for (const permission of scope.SCOPE_PERMISSIONS) {
      const allowed = await scope.authorizeScopeAction({
        principalId: HASSAN,
        scopeId: HASSAN,
        permission,
      });
      expect(allowed.ok, permission).toBe(true);
    }
  });

  // ── 3. Resolution: never a silent choice ──────────────────────────────────

  it("no request means the person's own scope", async () => {
    const resolved = await scope.resolveActingScope({ principalId: HASSAN });
    expect(resolved.status).toBe("RESOLVED");
    if (resolved.status !== "RESOLVED") return;
    expect(resolved.scope).toEqual({ kind: "PERSONAL", scopeId: HASSAN, principalId: HASSAN });
  });

  it("naming an organization they belong to resolves it", async () => {
    const created = await org(HASSAN, "شركة النور");
    const resolved = await scope.resolveActingScope({
      principalId: HASSAN,
      request: { intent: "ORGANIZATION", organizationHint: "شركة النور" },
    });
    expect(resolved.status).toBe("RESOLVED");
    if (resolved.status !== "RESOLVED" || resolved.scope.kind !== "ORGANIZATION") return;
    expect(resolved.scope.organizationId).toBe(created.id);
  });

  it("naming an organization they do NOT belong to is DENIED", async () => {
    const other = await org(LAYLA, "شركة ليلى");
    const byId = await scope.resolveActingScope({
      principalId: HASSAN,
      request: { intent: "ORGANIZATION", organizationId: other.id },
    });
    expect(byId.status).toBe("DENIED");

    const byName = await scope.resolveActingScope({
      principalId: HASSAN,
      request: { intent: "ORGANIZATION", organizationHint: "شركة ليلى" },
    });
    // DENIED, not "did you mean": listing organizations they are not in would
    // leak who exists.
    expect(byName.status).toBe("DENIED");
  });

  it("two plausible organizations is NEEDS_INPUT, never a guess", async () => {
    await org(HASSAN, "شركة النور للتجارة");
    await org(HASSAN, "شركة النور للنقل");
    const resolved = await scope.resolveActingScope({
      principalId: HASSAN,
      request: { intent: "ORGANIZATION", organizationHint: "شركة النور" },
    });
    expect(resolved.status).toBe("NEEDS_INPUT");
    if (resolved.status !== "NEEDS_INPUT") return;
    expect(resolved.candidates).toHaveLength(2);
  });

  it("«باسم شركتي» with one membership resolves, with two it asks", async () => {
    await org(HASSAN, "الوحيدة");
    const one = await scope.resolveActingScope({
      principalId: HASSAN,
      request: { intent: "ORGANIZATION" },
    });
    expect(one.status).toBe("RESOLVED");

    await org(HASSAN, "الثانية");
    const two = await scope.resolveActingScope({
      principalId: HASSAN,
      request: { intent: "ORGANIZATION" },
    });
    expect(two.status).toBe("NEEDS_INPUT");
  });

  it("«باسم شركتي» with no membership is DENIED", async () => {
    const resolved = await scope.resolveActingScope({
      principalId: HASSAN,
      request: { intent: "ORGANIZATION" },
    });
    expect(resolved.status).toBe("DENIED");
  });

  // ── 4. Revocation ─────────────────────────────────────────────────────────

  it("leaving an organization revokes future authority and keeps the record", async () => {
    const created = await org(HASSAN, "شركة النور");
    const published = await publishAs(created.id, { summary: "نُشر قبل المغادرة" });
    expect(published.attempt.verificationStatus).toBe("VERIFIED");

    const [grant] = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.ownerId, created.id));
    await membership.revokeMembership(handle.db, { membershipId: grant!.id, actorOwnerId: created.id });

    // Future authority is gone.
    const resolved = await scope.resolveActingScope({
      principalId: HASSAN,
      request: { intent: "ORGANIZATION", organizationId: created.id },
    });
    expect(resolved.status).toBe("DENIED");
    const allowed = await scope.authorizeScopeAction({
      principalId: HASSAN,
      scopeId: created.id,
      permission: "publish",
    });
    expect(allowed.ok).toBe(false);

    // The record of what was done is untouched. Revoking authority is not
    // rewriting history.
    const rows = await handle.db
      .select()
      .from(economicExpressions)
      .where(eq(economicExpressions.ownerId, created.id));
    expect(rows).toHaveLength(1);
    expect(grant!.id).toBeTruthy();
  });

  // ── 5. One market, four participants ──────────────────────────────────────

  async function matchFor(ownerId: string, needId: string) {
    const { result } = await runNode({
      capabilityId: "opportunity-match",
      ownerId,
      inputs: { needId },
    });
    return result;
  }

  async function needFor(ownerId: string, semanticType: string) {
    const { result } = await runNode({
      capabilityId: "opportunity-publish",
      ownerId,
      inputs: {
        kind: "NEED",
        semanticType,
        summary: `أحتاج ${semanticType}`,
        hardConstraints: [{ field: "unitPrice", operator: "lte", value: 5 }],
      },
    });
    return String(result.expressionId);
  }

  it("business ↔ business goes through the same exchange", async () => {
    const factory = await org(HASSAN, "مصنع الأغذية");
    const grocery = await org(LAYLA, "بقالة الحي");
    await publishAs(factory.id, { semanticType: "tuna", attributes: { unitPrice: 1 } });
    const need = await needFor(grocery.id, "tuna");
    expect((await matchFor(grocery.id, need)).matchCount).toBe(1);
  });

  it("person ↔ business goes through the same exchange", async () => {
    const business = await org(LAYLA, "ورشة الصيانة");
    await publishAs(business.id, { semanticType: "repair", attributes: { unitPrice: 3 } });
    const need = await needFor(HASSAN, "repair");
    expect((await matchFor(HASSAN, need)).matchCount).toBe(1);
  });

  it("business ↔ person goes through the same exchange", async () => {
    // A company hiring an individual's spare capacity. Same primitives.
    await publishAs(HASSAN, { semanticType: "translation", attributes: { unitPrice: 2 } });
    const company = await org(LAYLA, "مكتب المحاماة");
    const need = await needFor(company.id, "translation");
    expect((await matchFor(company.id, need)).matchCount).toBe(1);
  });

  it("one person's personal and business expressions are separately owned", async () => {
    const created = await org(HASSAN, "شركة النور");
    await publishAs(HASSAN, { summary: "شخصي" });
    await publishAs(created.id, { summary: "باسم الشركة" });

    const personal = await handle.db
      .select()
      .from(economicExpressions)
      .where(eq(economicExpressions.ownerId, HASSAN));
    const business = await handle.db
      .select()
      .from(economicExpressions)
      .where(eq(economicExpressions.ownerId, created.id));
    expect(personal).toHaveLength(1);
    expect(business).toHaveLength(1);
    expect(personal[0]!.id).not.toBe(business[0]!.id);
  });

  // ── 6. Cross-scope isolation ──────────────────────────────────────────────

  it("a member of one business cannot read another's private expression", async () => {
    const a = await org(HASSAN, "أ");
    const b = await org(LAYLA, "ب");
    await publishAs(a.id, { visibility: "PRIVATE", summary: "سرّي جدًا" });

    const { result } = await runNode({
      capabilityId: "opportunity-discover",
      ownerId: b.id,
      inputs: { kind: "OFFERING" },
    });
    expect(result.resultCount).toBe(0);
    expect(JSON.stringify(result)).not.toContain("سرّي");
  });

  it("one business's private constraints never appear in another's match result", async () => {
    const seller = await org(HASSAN, "البائع");
    const buyer = await org(LAYLA, "المشتري");
    await runNode({
      capabilityId: "opportunity-publish",
      ownerId: seller.id,
      inputs: {
        kind: "OFFERING",
        semanticType: "widget",
        summary: "عرض",
        visibility: "PUBLIC",
        attributes: { unitPrice: 4 },
        // The seller's own floor. It must never leave this scope.
        hardConstraints: [{ field: "unitPrice", operator: "gte", value: 3.5 }],
      },
    });
    const need = await needFor(buyer.id, "widget");
    const result = await matchFor(buyer.id, need);
    expect(result.matchCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("3.5");
  });

  // ── 7. Private, versioned, scope-owned policy ─────────────────────────────

  it("a policy is private to its scope and versioned", async () => {
    const created = await org(HASSAN, "شركة النور");
    await scope.setScopePolicy({
      principalId: HASSAN,
      scopeId: created.id,
      policyKey: "minimum_unit_price",
      value: { amount: 180, currency: "JOD" },
    });
    await scope.setScopePolicy({
      principalId: HASSAN,
      scopeId: created.id,
      policyKey: "minimum_unit_price",
      value: { amount: 200, currency: "JOD" },
    });

    const current = await scope.getScopePolicy({
      principalId: HASSAN,
      scopeId: created.id,
      policyKey: "minimum_unit_price",
    });
    expect(current!.version).toBe(2);
    expect((current!.value as { amount: number }).amount).toBe(200);

    // The earlier rule survives, so «what was the rule then» is answerable.
    const history = await scope.scopePolicyHistory({
      principalId: HASSAN,
      scopeId: created.id,
      policyKey: "minimum_unit_price",
    });
    expect(history.map((entry) => entry.version)).toEqual([1, 2]);
  });

  it("another business cannot read a policy, even knowing the scope id", async () => {
    const a = await org(HASSAN, "أ");
    await scope.setScopePolicy({
      principalId: HASSAN,
      scopeId: a.id,
      policyKey: "minimum_unit_price",
      value: { amount: 180 },
    });
    await expect(
      scope.getScopePolicy({ principalId: LAYLA, scopeId: a.id, policyKey: "minimum_unit_price" }),
    ).rejects.toThrow(/Not permitted/);
  });

  it("setting a policy needs the permission, not merely membership", async () => {
    const created = await org(HASSAN, "شركة النور");
    await membership.grantMembership(handle.db, {
      ownerId: created.id,
      subjectId: LAYLA,
      resourceKind: scope.ORGANIZATION_RESOURCE_KIND,
      permissions: ["view", "publish"],
    });
    await expect(
      scope.setScopePolicy({
        principalId: LAYLA,
        scopeId: created.id,
        policyKey: "minimum_unit_price",
        value: { amount: 1 },
      }),
    ).rejects.toThrow(/Not permitted/);
  });

  // ── 8. Provider bindings are scoped ───────────────────────────────────────

  it("one business's provider binding is not another's, and not the person's", async () => {
    const a = await org(HASSAN, "أ");
    const b = await org(LAYLA, "ب");
    await scope.bindScopeProvider({
      principalId: HASSAN,
      scopeId: a.id,
      providerClass: "MESSAGING",
      providerId: "provider-one",
      credentialEnvName: "JASIM_A_MESSAGING_KEY",
    });

    expect(await scope.resolveScopeProvider({ scopeId: a.id, providerClass: "MESSAGING" }))
      .toEqual({ providerId: "provider-one", credentialEnvName: "JASIM_A_MESSAGING_KEY" });
    // No fallback and no inheritance.
    expect(
      await scope.resolveScopeProvider({ scopeId: b.id, providerClass: "MESSAGING" }),
    ).toBeUndefined();
    expect(
      await scope.resolveScopeProvider({ scopeId: HASSAN, providerClass: "MESSAGING" }),
    ).toBeUndefined();
  });

  it("a personal binding does not become the employer's", async () => {
    const created = await org(HASSAN, "شركة النور");
    await scope.bindScopeProvider({
      principalId: HASSAN,
      scopeId: HASSAN,
      providerClass: "EMAIL",
      providerId: "personal-mail",
    });
    expect(
      await scope.resolveScopeProvider({ scopeId: created.id, providerClass: "EMAIL" }),
    ).toBeUndefined();
  });

  it("binding a provider needs the permission", async () => {
    const created = await org(HASSAN, "شركة النور");
    await membership.grantMembership(handle.db, {
      ownerId: created.id,
      subjectId: LAYLA,
      resourceKind: scope.ORGANIZATION_RESOURCE_KIND,
      permissions: ["view"],
    });
    await expect(
      scope.bindScopeProvider({
        principalId: LAYLA,
        scopeId: created.id,
        providerClass: "EMAIL",
        providerId: "x",
      }),
    ).rejects.toThrow(/Not permitted/);
  });

  it("a binding records a credential NAME, never a secret", async () => {
    const created = await org(HASSAN, "شركة النور");
    await scope.bindScopeProvider({
      principalId: HASSAN,
      scopeId: created.id,
      providerClass: "PAYMENT",
      providerId: "psp",
      credentialEnvName: "JASIM_PSP_KEY",
    });
    const rows = await handle.db.execute(
      sql.raw("SELECT * FROM scope_provider_bindings"),
    );
    const serialized = JSON.stringify(rows.rows);
    expect(serialized).toContain("JASIM_PSP_KEY");
    expect(serialized).not.toMatch(/sk_|secret|password/i);
  });

  // ── 9. The live turn ──────────────────────────────────────────────────────

  async function turn(
    principalId: string,
    content: string,
    envelopeExtra: Record<string, unknown>,
    existingConversationId?: string,
  ) {
    const conversation = existingConversationId
      ? { id: existingConversationId }
      : await runtime.createRuntimeConversation({
          ownerId: principalId,
          title: "scope turn",
        });
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "workflow",
        label: "سوق",
        goal: "نشر احتياج",
        intent: {
          requiredCapabilities: ["opportunity-publish"],
          missingInputs: [],
          inputs: {},
          risk: "low",
          persistence: "durable",
          effects: "none",
        },
        confidence: 0.8,
        ...envelopeExtra,
      }),
      provider: "openai",
      model: "stub-for-scope-turn",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: principalId,
      conversationId: conversation.id,
      content,
    });
    return {
      result,
      conversationId: conversation.id,
      output: result.output as Record<string, unknown>,
      metadata: (result.assistantMessage.metadata ?? {}) as Record<string, unknown>,
    };
  }

  const PUBLISH_PLAN = (summary: string) => ({
    planGraph: {
      version: 1,
      kind: "DAG",
      nodes: [
        {
          key: "publish",
          capabilityId: "opportunity-publish",
          inputs: {
            kind: "NEED",
            semanticType: "unit X",
            summary,
            visibility: "PUBLIC",
            attributes: { quantity: 300 },
          },
          dependsOn: [],
          bindings: [],
          enforces: [],
          authority: "NONE",
        },
      ],
      blockers: [],
    },
  });

  it("A · «باسم شركتي» opens the run under the organization, not the person", async () => {
    const created = await org(HASSAN, "شركة النور");
    const { metadata } = await turn(HASSAN, "باسم شركتي انشر أننا نحتاج 300 وحدة", {
      ...PUBLISH_PLAN("نحتاج 300 وحدة"),
      actingScope: { intent: "ORGANIZATION", organizationHint: "شركة النور" },
    });

    expect((metadata.actingScope as { kind: string }).kind).toBe("ORGANIZATION");
    const runId = metadata.runId as string;
    expect(runId).toBeTruthy();
    const runs = await handle.db.execute(
      sql.raw(`SELECT "ownerId" FROM runs WHERE id = '${runId}'`),
    );
    // The company owns the run, so the company will own what it writes.
    expect((runs.rows[0] as { ownerId: string }).ownerId).toBe(created.id);
  });

  it("C · the same person switching to personal opens the run under themselves", async () => {
    await org(HASSAN, "شركة النور");
    const { metadata } = await turn(HASSAN, "انشر لي شخصياً", {
      ...PUBLISH_PLAN("احتياج شخصي"),
      actingScope: { intent: "PERSONAL" },
    });
    expect((metadata.actingScope as { kind: string }).kind).toBe("PERSONAL");
    const runs = await handle.db.execute(
      sql.raw(`SELECT "ownerId" FROM runs WHERE id = '${metadata.runId as string}'`),
    );
    expect((runs.rows[0] as { ownerId: string }).ownerId).toBe(HASSAN);
  });

  it("D · acting for an organization they do not belong to is DENIED", async () => {
    const other = await org(LAYLA, "شركة ليلى");
    const { output } = await turn(HASSAN, "تصرف باسم شركة لا أملكها", {
      ...PUBLISH_PLAN("محاولة"),
      actingScope: { intent: "ORGANIZATION", organizationId: other.id },
    });
    expect(output.kind).toBe("routed");
    expect(output.state).toBe("DENIED");
    // Nothing was written under that scope.
    const rows = await handle.db
      .select()
      .from(economicExpressions)
      .where(eq(economicExpressions.ownerId, other.id));
    expect(rows).toHaveLength(0);
  });

  it("E · an ambiguous «باسم شركتي» asks instead of choosing", async () => {
    await org(HASSAN, "شركة النور للتجارة");
    await org(HASSAN, "شركة النور للنقل");
    const { output, result } = await turn(HASSAN, "باسم شركتي انشر الطلب", {
      ...PUBLISH_PLAN("طلب"),
      actingScope: { intent: "ORGANIZATION", organizationHint: "شركة النور" },
    });
    expect(output.state).toBe("NEEDS_INPUT");
    // Both are named, so the person can answer without guessing.
    expect(result.assistantMessage.content).toContain("للتجارة");
    expect(result.assistantMessage.content).toContain("للنقل");
  });

  const DISCOVER_PLAN = {
    planGraph: {
      version: 1,
      kind: "DAG",
      nodes: [
        {
          key: "discover",
          capabilityId: "opportunity-discover",
          inputs: { kind: "OFFERING", semanticType: "unit X" },
          dependsOn: [],
          bindings: [],
          enforces: [],
          authority: "NONE",
        },
      ],
      blockers: [],
    },
  };

  it("B · «ابحث باسم شركتي» discovers as the organization, not as the person", async () => {
    const buyer = await org(HASSAN, "شركة النور");
    // A third party publishes something public, and Hassan publishes something
    // private under his OWN name. The company must see the first and not the
    // second: the scope decides what a search can see.
    await publishAs(LAYLA, { semanticType: "unit X", summary: "عرض ليلى العام" });
    await publishAs(HASSAN, {
      semanticType: "unit X",
      summary: "عرض حسن الخاص",
      visibility: "PRIVATE",
    });

    const { metadata } = await turn(HASSAN, "ابحث باسم شركتي عن عرض مناسب", {
      ...DISCOVER_PLAN,
      actingScope: { intent: "ORGANIZATION", organizationId: buyer.id },
    });
    expect((metadata.actingScope as { kind: string }).kind).toBe("ORGANIZATION");

    const runId = metadata.runId as string;
    const runs = await handle.db.execute(
      sql.raw(`SELECT "ownerId" FROM runs WHERE id = '${runId}'`),
    );
    expect((runs.rows[0] as { ownerId: string }).ownerId).toBe(buyer.id);

    // The search itself ran under the company. Nothing the person owns
    // privately leaked into what the company can see.
    const found = await runtime.executeRuntimeDagNode({
      ownerId: buyer.id,
      runId,
      workerId: "scope-worker",
    });
    expect(found).toBeTruthy();
    const [attempt] = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, runId));
    const envelope = (attempt!.normalizedResult ?? {}) as { result?: Record<string, unknown> };
    const serialized = JSON.stringify(envelope.result ?? {});
    expect(serialized).toContain("عرض ليلى العام");
    expect(serialized).not.toContain("عرض حسن الخاص");
  });

  // ── 9·0. The verbs come from registration ─────────────────────────────────

  /**
   * A capability declares WHICH VERB it needs. It cannot declare that it needs
   * none, and forgetting to declare cannot make it cheaper: the fallback is
   * derived from the effect kind, and an unidentified capability is charged the
   * write verb.
   */
  it("an undeclared or unknown capability needs the write verb", async () => {
    const registry = await import("../../api/runtime/capability-registry");
    expect(registry.capabilityScopePermission("no-such-capability-at-all")).toBe("mutate");
    expect(registry.capabilityScopePermission("opportunity-publish")).toBe("publish");
    expect(registry.capabilityScopePermission("opportunity-discover")).toBe("view");
    expect(registry.capabilityScopePermission("opportunity-match")).toBe("mutate");
    // Every registered capability answers with a verb from the closed set, and
    // never with a role.
    for (const entry of registry.getRuntimeCapabilityRegistry().list()) {
      expect(scope.SCOPE_PERMISSIONS as readonly string[], entry.id).toContain(
        registry.capabilityScopePermission(entry.id),
      );
    }
  });

  // ── 9a. Membership is not permission ──────────────────────────────────────

  /** Re-grant the founder's membership with only the verbs named. */
  async function narrowTo(organizationId: string, subjectId: string, permissions: string[]) {
    const [grant] = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.ownerId, organizationId));
    await membership.revokeMembership(handle.db, {
      membershipId: grant!.id,
      actorOwnerId: organizationId,
    });
    await membership.grantMembership(handle.db, {
      ownerId: organizationId,
      subjectId,
      resourceKind: scope.ORGANIZATION_RESOURCE_KIND,
      resourceId: "*",
      permissions,
      purpose: undefined,
    });
  }

  it("a member who may only view cannot publish in the company's name", async () => {
    const created = await org(HASSAN, "شركة النور");
    await narrowTo(created.id, HASSAN, ["view"]);

    const { output } = await turn(HASSAN, "باسم شركتي انشر الطلب", {
      ...PUBLISH_PLAN("طلب"),
      actingScope: { intent: "ORGANIZATION", organizationId: created.id },
    });
    expect(output.state).toBe("DENIED");
    const opened = await handle.db.execute(
      sql.raw(`SELECT id FROM runs WHERE "ownerId" = '${created.id}'`),
    );
    expect(opened.rows).toHaveLength(0);
  });

  it("the same member may still read — the verb decides, not the membership", async () => {
    const created = await org(HASSAN, "شركة النور");
    await narrowTo(created.id, HASSAN, ["view"]);
    await handle.db.insert(runs).values({
      ownerId: created.id,
      goal: "عملية الشركة",
      status: "blocked",
      idempotencyKey: `scope-read-${randomUUID()}`,
    });

    const { output, metadata } = await turn(HASSAN, "أرني عمليات شركتي", {
      intent: {
        requiredCapabilities: [],
        missingInputs: [],
        inputs: {},
        risk: "none",
        persistence: "ephemeral",
        effects: "none",
      },
      planGraph: { version: 1, kind: "DIRECT_READ", nodes: [], blockers: [] },
      dataNeed: { version: 1, resource: "runs", fields: ["goal", "status"] },
      actingScope: { intent: "ORGANIZATION", organizationId: created.id },
    });
    expect(metadata.semanticRoute).toBe("DIRECT_READ");
    expect(output.kind).toBe("dataset");
    expect(output.rowCount).toBe(1);
  });

  // ── 9c. The data path reads the SCOPE's rows ──────────────────────────────

  const READ_TURN = (organizationId?: string, resource = "runs") => ({
    intent: {
      requiredCapabilities: [],
      missingInputs: [],
      inputs: {},
      risk: "none",
      persistence: "ephemeral",
      effects: "none",
    },
    planGraph: { version: 1, kind: "DIRECT_READ", nodes: [], blockers: [] },
    dataNeed: { version: 1, resource },
    ...(organizationId
      ? { actingScope: { intent: "ORGANIZATION", organizationId } }
      : { actingScope: { intent: "PERSONAL" } }),
  });

  it("«أرني عملياتي» acting for a company reads the company's rows, not the person's", async () => {
    const created = await org(HASSAN, "شركة النور");
    await handle.db.insert(runs).values({
      ownerId: created.id,
      goal: "عملية الشركة",
      status: "blocked",
      idempotencyKey: `co-${randomUUID()}`,
    });
    await handle.db.insert(runs).values({
      ownerId: HASSAN,
      goal: "عمليتي الشخصية",
      status: "blocked",
      idempotencyKey: `me-${randomUUID()}`,
    });

    const asCompany = await turn(HASSAN, "أرني عملياتي", READ_TURN(created.id));
    const asPerson = await turn(HASSAN, "أرني عملياتي", READ_TURN());
    expect(JSON.stringify(asCompany.output)).toContain("عملية الشركة");
    expect(JSON.stringify(asCompany.output)).not.toContain("عمليتي الشخصية");
    expect(JSON.stringify(asPerson.output)).toContain("عمليتي الشخصية");
    expect(JSON.stringify(asPerson.output)).not.toContain("عملية الشركة");
  });

  it("a resource a scope cannot own answers UNAVAILABLE, never an empty table", async () => {
    // FALSE EMPTY: «لا توجد محادثات» would say the company has none, when a
    // company cannot hold one at all. That is a different answer.
    const created = await org(HASSAN, "شركة النور");
    const { output } = await turn(HASSAN, "أرني محادثات شركتي", READ_TURN(created.id, "conversations"));
    expect(output.kind).toBe("routed");
    expect(output.state).toBe("UNAVAILABLE");
    expect(String(output.message)).toContain("لم أعرض أي بيانات");
  });

  // ── 9b. Continuity across turns ───────────────────────────────────────────

  /**
   * A conversation carries the scope it is being conducted FOR. It never
   * carries the authority to act there — that is re-resolved every turn.
   */
  it("a second turn saying nothing about scope continues the same organization", async () => {
    const created = await org(HASSAN, "شركة النور");
    const first = await turn(HASSAN, "باسم شركتي انشر الطلب", {
      ...PUBLISH_PLAN("طلب أول"),
      actingScope: { intent: "ORGANIZATION", organizationId: created.id },
    });
    expect((first.metadata.actingScope as { kind: string }).kind).toBe("ORGANIZATION");

    // No actingScope in this envelope at all: the person simply kept talking.
    const second = await turn(
      HASSAN,
      "وانشر هذا أيضاً",
      PUBLISH_PLAN("طلب ثانٍ"),
      first.conversationId,
    );
    expect((second.metadata.actingScope as { scopeId: string }).scopeId).toBe(created.id);
    const runs = await handle.db.execute(
      sql.raw(`SELECT "ownerId" FROM runs WHERE id = '${second.metadata.runId as string}'`),
    );
    expect((runs.rows[0] as { ownerId: string }).ownerId).toBe(created.id);
  });

  it("continuity is a request, not a grant: revocation denies the very next turn", async () => {
    const created = await org(HASSAN, "شركة النور");
    const first = await turn(HASSAN, "باسم شركتي انشر الطلب", {
      ...PUBLISH_PLAN("طلب"),
      actingScope: { intent: "ORGANIZATION", organizationId: created.id },
    });
    const [grant] = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.ownerId, created.id));
    await membership.revokeMembership(handle.db, {
      membershipId: grant!.id,
      actorOwnerId: created.id,
    });

    // The remembered scope is re-resolved, not trusted. Silently continuing
    // under an authority that ended is the failure this asserts against.
    const second = await turn(HASSAN, "وانشر هذا أيضاً", PUBLISH_PLAN("طلب ثانٍ"), first.conversationId);
    expect(second.output.state).toBe("DENIED");
    // The denial happens before anything is opened under that scope: the
    // company still owns only the first turn's run.
    const runs = await handle.db.execute(
      sql.raw(`SELECT id FROM runs WHERE "ownerId" = '${created.id}'`),
    );
    expect(runs.rows).toHaveLength(1);
  });

  it("a scope that stopped resolving is forgotten, not retried forever", async () => {
    const created = await org(HASSAN, "شركة النور");
    const first = await turn(HASSAN, "باسم شركتي انشر الطلب", {
      ...PUBLISH_PLAN("طلب"),
      actingScope: { intent: "ORGANIZATION", organizationId: created.id },
    });
    const [grant] = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.ownerId, created.id));
    await membership.revokeMembership(handle.db, {
      membershipId: grant!.id,
      actorOwnerId: created.id,
    });
    await turn(HASSAN, "وانشر هذا أيضاً", PUBLISH_PLAN("ثانٍ"), first.conversationId);

    // Denied once and told so. A memory that could only ever be denied would
    // lock the person out of their own work in this conversation.
    const third = await turn(HASSAN, "انشر لنفسي", PUBLISH_PLAN("ثالث"), first.conversationId);
    expect((third.metadata.actingScope as { kind: string }).kind).toBe("PERSONAL");
    expect((third.metadata.actingScope as { scopeId: string }).scopeId).toBe(HASSAN);
  });

  it("saying «شخصياً» ends the conversation's organization scope", async () => {
    const created = await org(HASSAN, "شركة النور");
    const first = await turn(HASSAN, "باسم شركتي انشر", {
      ...PUBLISH_PLAN("طلب"),
      actingScope: { intent: "ORGANIZATION", organizationId: created.id },
    });
    await turn(
      HASSAN,
      "لا، شخصياً",
      { ...PUBLISH_PLAN("شخصي"), actingScope: { intent: "PERSONAL" } },
      first.conversationId,
    );
    // And it stays personal — an explicit switch is not one turn's exception.
    const third = await turn(HASSAN, "وهذا أيضاً", PUBLISH_PLAN("شخصي ثانٍ"), first.conversationId);
    expect((third.metadata.actingScope as { scopeId: string }).scopeId).toBe(HASSAN);
  });

  it("one person's two conversations hold two different scopes at once", async () => {
    const created = await org(HASSAN, "شركة النور");
    const business = await turn(HASSAN, "باسم شركتي", {
      ...PUBLISH_PLAN("عمل"),
      actingScope: { intent: "ORGANIZATION", organizationId: created.id },
    });
    const personal = await turn(HASSAN, "لنفسي", PUBLISH_PLAN("شخصي"));

    const again = await turn(HASSAN, "وأيضاً", PUBLISH_PLAN("عمل ثانٍ"), business.conversationId);
    const stillPersonal = await turn(
      HASSAN,
      "وأيضاً",
      PUBLISH_PLAN("شخصي ثانٍ"),
      personal.conversationId,
    );
    expect((again.metadata.actingScope as { scopeId: string }).scopeId).toBe(created.id);
    expect((stillPersonal.metadata.actingScope as { scopeId: string }).scopeId).toBe(HASSAN);
  });

  it("another person's conversation cannot lend them its scope", async () => {
    const created = await org(HASSAN, "شركة النور");
    const hassans = await turn(HASSAN, "باسم شركتي", {
      ...PUBLISH_PLAN("عمل"),
      actingScope: { intent: "ORGANIZATION", organizationId: created.id },
    });
    // Layla naming Hassan's conversation gets nothing: the row is loaded by
    // (conversation, owner), so it is not hers to read and not hers to inherit.
    await expect(
      turn(LAYLA, "أكمل", PUBLISH_PLAN("محاولة"), hassans.conversationId),
    ).rejects.toThrow();
  });

  it("a revoked membership stops working on the very next turn", async () => {
    const created = await org(HASSAN, "شركة النور");
    const [grant] = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.ownerId, created.id));
    await membership.revokeMembership(handle.db, { membershipId: grant!.id, actorOwnerId: created.id });

    const { output } = await turn(HASSAN, "باسم شركتي انشر الطلب", {
      ...PUBLISH_PLAN("طلب"),
      actingScope: { intent: "ORGANIZATION", organizationId: created.id },
    });
    // Acting scope is re-resolved every turn, so stale authority cannot be
    // carried forward from an earlier one.
    expect(output.state).toBe("DENIED");
  });

  // ── 10. Holdout organizations ─────────────────────────────────────────────

  /**
   * Familiar and unfamiliar organizations through the SAME runtime. What kind
   * of organization each is lives in `attributes` — as data — and no
   * production code reads it.
   */
  const ORGANIZATIONS = [
    "factory", "hotel", "logistics company", "consultancy", "school",
    "beekeeping cooperative", "desalination operator", "calibration laboratory",
    "community tool library", "falconry club", "grain silo operator",
  ] as const;

  it.each(ORGANIZATIONS)("an organization of kind '%s' needs no new code", async (kind) => {
    const created = await org(HASSAN, `جهة ${kind}`, { kind });
    const published = await publishAs(created.id, { semanticType: kind, summary: `عرض ${kind}` });
    expect(published.attempt.verificationStatus).toBe("VERIFIED");

    const rows = await handle.db
      .select()
      .from(economicExpressions)
      .where(eq(economicExpressions.ownerId, created.id));
    expect(rows).toHaveLength(1);
    // The kind is DATA on the organization, never a type in the core.
    expect((created.attributes as { kind?: string }).kind).toBe(kind);
  });
});
