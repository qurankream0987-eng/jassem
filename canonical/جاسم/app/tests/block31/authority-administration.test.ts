/**
 * JASIM — AN AUTHORITY ACT IS A DECISION, NOT A CLICK.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   APPROVAL != CLICK
 *   MODEL PROPOSES != RUNTIME PERFORMS
 *   STATEMENT != SUMMARY
 *
 * Two phases arrived at this gap from opposite directions — a business scope
 * nobody could administer by talking, and a negotiating limit nobody could
 * delegate by talking. One mechanism closes both, and the difficulty was never
 * the mechanism: it is that the obvious implementation, a capability plus a
 * run summary somebody clicks «موافق» on, is an authority they never read.
 *
 * So the tests below are mostly about what a person is SHOWN, and about what
 * happens when the world moves between showing and deciding.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { authorityRequests, memberships, organizations } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let authority: typeof import("../../api/runtime/authority-acts");
let scope: typeof import("../../api/runtime/actor-scope");
let fabric: typeof import("../../api/runtime/economic-fabric");
let agreement: typeof import("../../api/runtime/agreement-runtime");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

const HASSAN = "9701";
const LAYLA = "9702";

describe("a person performs an authority act by reading it, not by clicking", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    authority = await import("../../api/runtime/authority-acts");
    scope = await import("../../api/runtime/actor-scope");
    fabric = await import("../../api/runtime/economic-fabric");
    agreement = await import("../../api/runtime/agreement-runtime");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE events, authority_requests, organizations, memberships,
        scope_policies, scope_provider_bindings, economic_expressions, economic_matches,
        economic_engagements, economic_proposals, negotiation_envelopes,
        agreements, commitments CASCADE`),
    );
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  const personal = (principalId: string) =>
    ({ kind: "PERSONAL", scopeId: principalId, principalId }) as const;

  async function orgScope(principalId: string, displayName = "شركة النور") {
    const created = await scope.createOrganization({ principalId, displayName });
    return {
      created,
      acting: {
        kind: "ORGANIZATION",
        scopeId: created.id,
        principalId,
        organizationId: created.id,
        displayName: created.displayName,
      } as const,
    };
  }

  const ask = (actType: string, params: Record<string, unknown>, acting: unknown, principalId = HASSAN) =>
    authority.requestAuthorityAct({
      actType,
      principalId,
      scope: acting as never,
      params,
    });

  const approve = (requestId: string, digest: string, principalId = HASSAN) =>
    authority.approveAuthorityRequest({ requestId, principalId, statementDigest: digest });

  // ── 1. Asking is not doing ────────────────────────────────────────────────

  it("a request performs nothing at all", async () => {
    await ask("organization.create", { displayName: "شركة النور" }, personal(HASSAN));
    expect(await handle.db.select().from(organizations)).toHaveLength(0);
    const [row] = await handle.db.select().from(authorityRequests);
    expect(row!.state).toBe("PENDING");
    expect(row!.result).toBeNull();
  });

  it("approving performs it, once", async () => {
    const { request, statement } = await ask(
      "organization.create",
      { displayName: "شركة النور" },
      personal(HASSAN),
    );
    const outcome = await approve(request.id, authority.statementDigest(statement));
    expect(outcome.state).toBe("PERFORMED");
    expect(await handle.db.select().from(organizations)).toHaveLength(1);

    // A second approval is not a second organization. One decision, one act.
    await expect(approve(request.id, authority.statementDigest(statement))).rejects.toThrow();
    expect(await handle.db.select().from(organizations)).toHaveLength(1);
  });

  it("rejecting performs nothing and says so", async () => {
    const { request } = await ask("organization.create", { displayName: "ش" }, personal(HASSAN));
    const rejected = await authority.rejectAuthorityRequest({
      requestId: request.id,
      principalId: HASSAN,
    });
    expect(rejected.state).toBe("REJECTED");
    expect(rejected.resolution).toBe("REJECTED_BY_PRINCIPAL");
    expect(await handle.db.select().from(organizations)).toHaveLength(0);
  });

  it("the decision belongs to the person named on it", async () => {
    const { request, statement } = await ask(
      "organization.create",
      { displayName: "شركة النور" },
      personal(HASSAN),
    );
    await expect(
      approve(request.id, authority.statementDigest(statement), LAYLA),
    ).rejects.toThrow(/not yours/i);
    await expect(
      authority.rejectAuthorityRequest({ requestId: request.id, principalId: LAYLA }),
    ).rejects.toThrow(/not yours/i);
  });

  // ── 2. The statement shows every number ───────────────────────────────────

  it("a number three levels inside an object gets its own line", async () => {
    // The whole anti-theatre guarantee. «bounds: {…}» hides a reserve.
    const { engagement } = await negotiation();
    const { statement } = await ask(
      "negotiation.envelope.set",
      {
        engagementId: engagement.id,
        bounds: {
          price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250, concessionStep: 25 },
        },
        mayConcede: true,
      },
      personal(HASSAN),
    );
    const byKey = new Map(statement.lines.map((line) => [line.key, line.value]));
    expect(byKey.get("bounds.price.reserve")).toBe(250);
    expect(byKey.get("bounds.price.target")).toBe(200);
    expect(byKey.get("bounds.price.concessionStep")).toBe(25);
    expect(byKey.get("mayConcede")).toBe(true);
  });

  it("every scalar in the parameters appears somewhere in the statement", async () => {
    // Structural, over several acts: the renderer walks the value rather than
    // asking the act what to show, so an act cannot omit a number.
    const { created } = await orgScope(HASSAN);
    const cases: Array<[string, Record<string, unknown>, unknown]> = [
      ["organization.create", { displayName: "ش", attributes: { kind: "factory", staff: 40 } }, personal(HASSAN)],
      [
        "policy.set",
        { policyKey: "pricing", value: { floor: 180, currency: "JOD", nested: { cap: 9 } } },
        (await orgScope(LAYLA, "شركة ليلى")).acting,
      ],
    ];
    for (const [actType, params, acting] of cases) {
      const principalId = actType === "policy.set" ? LAYLA : HASSAN;
      const { statement } = await ask(actType, params, acting, principalId);
      const shown = new Set(statement.lines.map((line) => String(line.value)));
      for (const leaf of leaves(params)) {
        expect(shown, `${actType}: ${leaf}`).toContain(leaf);
      }
    }
    expect(created).toBeTruthy();
  });

  it("names the scope from the database, not from what anybody called it", async () => {
    const { created, acting } = await orgScope(HASSAN, "شركة النور");
    // A model handing in a flattering name for the same id changes nothing:
    // the statement reads the row.
    const lying = { ...acting, displayName: "شركتك المعتادة" };
    const { statement } = await ask("policy.set", { policyKey: "k", value: { a: 1 } }, lying);
    expect(statement.onBehalfOf.displayName).toBe("شركة النور");
    expect(statement.onBehalfOf.scopeId).toBe(created.id);
    expect(JSON.stringify(statement)).not.toContain("المعتادة");
  });

  it("an id is expanded into what it means", async () => {
    // «وافق على العرض p_8f3a» is not something a person can consent to.
    const { proposalId } = await proposal();
    const { statement } = await ask("agreement.commit", { proposalId }, personal(HASSAN));
    const byKey = new Map(statement.lines.map((line) => [line.key, line.value]));
    expect(byKey.get("terms.price")).toBe(240);
    expect(byKey.get("units.price")).toBe("JOD");
    expect(byKey.get("terms.deliveryDays")).toBe(5);
    expect(byKey.get("proposedBy")).toBe(LAYLA);
  });

  it("says what cannot be undone", async () => {
    const { proposalId } = await proposal();
    const { statement } = await ask("agreement.commit", { proposalId }, personal(HASSAN));
    expect(statement.reversibility).toBe("IRREVERSIBLE");
    expect(statement.residualNote).toContain("separate act");
  });

  it("no sentence a model wrote reaches the statement", async () => {
    const { statement } = await ask(
      "organization.create",
      { displayName: "شركة النور" },
      personal(HASSAN),
    );
    // The headline is fixed in trusted code, and the lines come from typed
    // parameters. There is nowhere for a narration to enter.
    const act = authority.getAuthorityAct("organization.create")!;
    expect(statement.headline).toBe(act.headline);
    for (const line of statement.lines) {
      // Every line is either a declared parameter or an expansion of one, and
      // both come from typed values rather than from a sentence.
      expect(typeof line.value !== "object", line.key).toBe(true);
      expect(act.params.some((spec) => line.key.startsWith(spec.key)), line.key).toBe(true);
    }
  });

  // ── 3. An approval binds to the words that were read ──────────────────────

  it("citing a different digest performs nothing", async () => {
    const { request } = await ask(
      "organization.create",
      { displayName: "شركة النور" },
      personal(HASSAN),
    );
    const outcome = await approve(request.id, "0".repeat(64));
    expect(outcome.state).toBe("VOID");
    expect(outcome.state === "VOID" && outcome.resolution).toBe("DIGEST_MISMATCH");
    expect(await handle.db.select().from(organizations)).toHaveLength(0);
  });

  it("if the world moved, the approval is void", async () => {
    // The terms changed between reading and deciding. The person agreed to a
    // sentence that is no longer true, so nothing happens.
    const { proposalId, engagement } = await proposal();
    const { request, statement } = await ask("agreement.commit", { proposalId }, personal(HASSAN));
    await handle.db.execute(
      sql.raw(
        `UPDATE economic_proposals SET terms = '{"terms":[{"key":"price","kind":"NUMBER","value":999,"unit":"JOD"}]}'::jsonb WHERE id = '${proposalId}'`,
      ),
    );
    const outcome = await approve(request.id, authority.statementDigest(statement));
    expect(outcome.state).toBe("VOID");
    expect(outcome.state === "VOID" && outcome.resolution).toBe("STATEMENT_CHANGED");
    expect(engagement).toBeTruthy();
    const agreements = await handle.db.execute(sql.raw("SELECT id FROM agreements"));
    expect(agreements.rows).toHaveLength(0);
  });

  it("renaming the scope voids a pending approval in its name", async () => {
    const { created, acting } = await orgScope(HASSAN, "شركة النور");
    const { request, statement } = await ask("policy.set", { policyKey: "k", value: { a: 1 } }, acting);
    await handle.db
      .update(organizations)
      .set({ displayName: "شركة أخرى تمامًا" })
      .where(eq(organizations.id, created.id));
    const outcome = await approve(request.id, authority.statementDigest(statement));
    expect(outcome.state).toBe("VOID");
    expect(outcome.state === "VOID" && outcome.resolution).toBe("STATEMENT_CHANGED");
  });

  it("a revoked membership voids a pending approval", async () => {
    const membershipModule = await import("../../api/runtime/block2/membership");
    const { created, acting } = await orgScope(HASSAN);
    const { request, statement } = await ask("policy.set", { policyKey: "k", value: { a: 1 } }, acting);
    const [grant] = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.ownerId, created.id));
    await membershipModule.revokeMembership(handle.db, {
      membershipId: grant!.id,
      actorOwnerId: created.id,
    });
    // Not void — DENIED. The authority ended, and that is a different fact
    // from the words having changed.
    await expect(approve(request.id, authority.statementDigest(statement))).rejects.toThrow(
      /permitted/i,
    );
  });

  it("an expired request is not decided late", async () => {
    const { request, statement } = await ask(
      "organization.create",
      { displayName: "ش" },
      personal(HASSAN),
    );
    await handle.db
      .update(authorityRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(authorityRequests.id, request.id));
    const outcome = await approve(request.id, authority.statementDigest(statement));
    expect(outcome.state).toBe("VOID");
    expect(outcome.state === "VOID" && outcome.resolution).toBe("EXPIRED");
  });

  // ── 4. Permission, checked twice ──────────────────────────────────────────

  it("refuses at request time what it would refuse at approval time", async () => {
    // Asking somebody to approve something that was never going to work is
    // its own kind of dishonesty.
    const { acting } = await orgScope(LAYLA, "شركة ليلى");
    await expect(
      ask("policy.set", { policyKey: "k", value: { a: 1 } }, acting, HASSAN),
    ).rejects.toThrow(/permitted/i);
    expect(await handle.db.select().from(authorityRequests)).toHaveLength(0);
  });

  it("a member who may only view cannot ask for a policy either", async () => {
    const membershipModule = await import("../../api/runtime/block2/membership");
    const { created, acting } = await orgScope(HASSAN);
    const [grant] = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.ownerId, created.id));
    await membershipModule.revokeMembership(handle.db, {
      membershipId: grant!.id,
      actorOwnerId: created.id,
    });
    await membershipModule.grantMembership(handle.db, {
      ownerId: created.id,
      subjectId: HASSAN,
      resourceKind: scope.ORGANIZATION_RESOURCE_KIND,
      resourceId: "*",
      permissions: ["view"],
      purpose: undefined,
    });
    await expect(
      ask("policy.set", { policyKey: "k", value: { a: 1 } }, acting),
    ).rejects.toThrow(/permitted/i);
  });

  it("a person's own act cannot be done in an organization's name", async () => {
    const { acting } = await orgScope(HASSAN);
    await expect(ask("organization.create", { displayName: "ف" }, acting)).rejects.toThrow(
      /person's own act/i,
    );
  });

  // ── 5. Parameters are typed and closed ────────────────────────────────────

  it("an undeclared parameter is refused, never dropped", async () => {
    // Silently discarding a parameter means the person was never shown it and
    // the runtime never used it, and both are worse than an error.
    await expect(
      ask("organization.create", { displayName: "ش", secretlyAlso: "something" }, personal(HASSAN)),
    ).rejects.toThrow(/not a parameter/i);
  });

  it("refuses a parameter that states an authority", async () => {
    for (const key of ["approved", "statementDigest", "principalId", "scopeId"]) {
      await expect(
        ask("organization.create", { displayName: "ش", [key]: "x" }, personal(HASSAN)),
        key,
      ).rejects.toThrow();
    }
  });

  it("refuses a wrong type and a missing requirement", async () => {
    await expect(ask("organization.create", {}, personal(HASSAN))).rejects.toThrow(/required/i);
    await expect(
      ask("organization.create", { displayName: 7 }, personal(HASSAN)),
    ).rejects.toThrow(/STRING/);
  });

  it("a permission is a verb from the closed set, never a role", async () => {
    const { acting } = await orgScope(HASSAN);
    const { request, statement } = await ask(
      "membership.grant",
      { subjectId: LAYLA, permissions: ["FactoryManager"] },
      acting,
    );
    // It gets as far as the person, and then trusted code refuses it. A role
    // name reaching a membership row is how a `FactoryManager` gets born.
    await expect(approve(request.id, authority.statementDigest(statement))).rejects.toThrow(
      /not a permission/i,
    );
  });

  // ── 6. The whole path, through the live turn ──────────────────────────────

  async function turn(content: string, extra: Record<string, unknown>, principalId = HASSAN) {
    const conversation = await runtime.createRuntimeConversation({
      ownerId: principalId,
      title: "authority",
    });
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "direct_action",
        label: "تفويض",
        goal: "فعل صلاحية",
        intent: {
          requiredCapabilities: [],
          missingInputs: [],
          inputs: {},
          risk: "high",
          persistence: "ephemeral",
          effects: "none",
        },
        confidence: 0.9,
        ...extra,
      }),
      provider: "openai",
      model: "stub-for-authority-turn",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: principalId,
      conversationId: conversation.id,
      content,
    });
    return {
      result,
      output: result.output as Record<string, unknown>,
      metadata: (result.assistantMessage.metadata ?? {}) as Record<string, unknown>,
    };
  }

  it("«أنشئ حساب شركتي» asks, and nothing is created until it is read", async () => {
    const { output } = await turn("أنشئ حساب شركتي", {
      authorityRequest: {
        actType: "organization.create",
        params: { displayName: "شركة النور", attributes: { kind: "restaurant" } },
      },
    });
    expect(output.state).toBe("NEEDS_APPROVAL");
    expect(await handle.db.select().from(organizations)).toHaveLength(0);

    const carried = output.authority as {
      requestId: string;
      statementDigest: string;
      statement: { lines: Array<{ key: string; value: unknown }> };
    };
    // The person is shown the kind they asked for, as data — and the runtime
    // still branches on none of it.
    const byKey = new Map(carried.statement.lines.map((line) => [line.key, line.value]));
    expect(byKey.get("attributes.kind")).toBe("restaurant");

    const outcome = await approve(carried.requestId, carried.statementDigest);
    expect(outcome.state).toBe("PERFORMED");
    // VERIFIED by JASIM reading the row back, never by the act's own return.
    expect(outcome.state === "PERFORMED" && outcome.result.verified).toBe(true);
    const [created] = await handle.db.select().from(organizations);
    expect(created!.displayName).toBe("شركة النور");
    // And the creator is a member through the ordinary grant mechanism.
    const grants = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.ownerId, created!.id));
    expect(grants).toHaveLength(1);
  });

  it("«لا تتجاوز 250 ولا تخبره» shows the 250 before anyone can agree to it", async () => {
    const { engagement } = await negotiation();
    const { output } = await turn("فاوض نيابةً عني ولا تتجاوز 250", {
      authorityRequest: {
        actType: "negotiation.envelope.set",
        params: {
          engagementId: engagement.id,
          bounds: { price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 } },
          mayConcede: true,
        },
      },
    });
    expect(output.state).toBe("NEEDS_APPROVAL");
    const carried = output.authority as {
      requestId: string;
      statementDigest: string;
      statement: { lines: Array<{ key: string; value: unknown }> };
    };
    // The reserve is on the screen. This is the one place in the entire
    // runtime where it is supposed to be.
    expect(carried.statement.lines.some((line) => line.value === 250)).toBe(true);

    const outcome = await approve(carried.requestId, carried.statementDigest);
    expect(outcome.state).toBe("PERFORMED");
    const envelope = await agreement.getNegotiationEnvelope({
      engagementId: engagement.id,
      ownerId: HASSAN,
    });
    expect(envelope!.mayConcede).toBe(true);
    // And still false by default: the act asked for one permission, not both.
    expect(envelope!.mayAcceptWithinReserve).toBe(false);
  });

  it("a turn naming an act the person may not do is DENIED and writes nothing", async () => {
    const { acting } = await orgScope(LAYLA, "شركة ليلى");
    const { output } = await turn("ضع سياسة لشركة ليلى", {
      actingScope: { intent: "ORGANIZATION", organizationId: acting.organizationId },
      authorityRequest: {
        actType: "policy.set",
        params: { policyKey: "pricing", value: { floor: 1 } },
      },
    });
    expect(output.state).toBe("DENIED");
    expect(await handle.db.select().from(authorityRequests)).toHaveLength(0);
  });

  it("a turn naming an act that does not exist says so rather than improvising", async () => {
    const { output } = await turn("افعل شيئًا إداريًا", {
      authorityRequest: { actType: "restaurant.onboard", params: {} },
    });
    expect(output.state).toBe("UNAVAILABLE");
    expect(output.cause).toBe("UNKNOWN_ACT");
  });

  it("an act that did not take says NOT_OCCURRED rather than reporting success", async () => {
    // RECEIPT != VERIFICATION, made falsifiable: the row disappears between
    // performing and reading back, and the result says so.
    const act = authority.getAuthorityAct("organization.create")!;
    const spy = vi.spyOn(act, "readback" as never);
    spy.mockImplementation((async () => ({
      occurred: false,
      detail: "The organization exists and grants its creator nothing.",
    })) as never);
    const { request, statement } = await ask(
      "organization.create",
      { displayName: "شركة الوهم" },
      personal(HASSAN),
    );
    const outcome = await approve(request.id, authority.statementDigest(statement));
    expect(outcome.state).toBe("PERFORMED");
    expect(outcome.state === "PERFORMED" && outcome.result.verified).toBe(false);
    const [row] = await handle.db
      .select()
      .from(authorityRequests)
      .where(eq(authorityRequests.id, request.id));
    expect((row!.result as { verification: { state: string } }).verification.state).toBe(
      "NOT_OCCURRED",
    );
  });

  it("every act's readback confirms it on the real database", async () => {
    // One per act, so a readback that always returned true would have to do it
    // seven times in a row against seven different tables.
    const { engagement, proposalId } = await proposal();
    const { created, acting } = await orgScope(HASSAN);
    const [founderGrant] = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.ownerId, created.id));

    const cases: Array<[string, Record<string, unknown>, unknown]> = [
      ["organization.create", { displayName: "جهة ثانية" }, personal(HASSAN)],
      ["membership.grant", { subjectId: LAYLA, permissions: ["view"] }, acting],
      ["policy.set", { policyKey: "k", value: { a: 1 } }, acting],
      ["provider.bind", { providerClass: "STORAGE", providerId: "p" }, acting],
      [
        "negotiation.envelope.set",
        {
          engagementId: engagement.id,
          bounds: { price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 } },
          mayAcceptWithinReserve: true,
        },
        personal(HASSAN),
      ],
      ["agreement.commit", { proposalId }, personal(HASSAN)],
      ["membership.revoke", { membershipId: founderGrant!.id }, acting],
    ];
    for (const [actType, params, target] of cases) {
      const { request, statement } = await ask(actType, params, target);
      const outcome = await approve(request.id, authority.statementDigest(statement));
      expect(outcome.state, actType).toBe("PERFORMED");
      expect(outcome.state === "PERFORMED" && outcome.result.verified, actType).toBe(true);
    }
  });

  // ── 7. The two gaps, closed through one mechanism ─────────────────────────

  it("all seven acts go through the same request, statement and digest", async () => {
    const acts = authority.listAuthorityActs().map((act) => act.id).sort();
    expect(acts).toEqual([
      "agreement.commit",
      "membership.grant",
      "membership.revoke",
      "negotiation.envelope.set",
      "organization.create",
      "policy.set",
      "provider.bind",
    ]);
  });

  it("a business is administered end to end by talking", async () => {
    // create → grant → policy → bind, all through the same one mechanism.
    const create = await turn("أنشئ شركتي", {
      authorityRequest: {
        actType: "organization.create",
        params: { displayName: "مصنع الأمل" },
      },
    });
    const createdId = await performFromTurn(create.output);

    const acting = { intent: "ORGANIZATION", organizationId: createdId };
    const grant = await turn("أضف ليلى بصلاحية النشر", {
      actingScope: acting,
      authorityRequest: {
        actType: "membership.grant",
        params: { subjectId: LAYLA, permissions: ["view", "publish"] },
      },
    });
    await performFromTurn(grant.output);

    const policy = await turn("ضع سياسة: لا تبيع بأقل من التكلفة", {
      actingScope: acting,
      authorityRequest: {
        actType: "policy.set",
        params: { policyKey: "minimum_margin", value: { floorPercent: 0 } },
      },
    });
    await performFromTurn(policy.output);

    const bind = await turn("اربط نظام المخزون عندي", {
      actingScope: acting,
      authorityRequest: {
        actType: "provider.bind",
        params: {
          providerClass: "STORAGE",
          providerId: "inventory-adapter",
          credentialEnvName: "JASIM_INVENTORY_KEY",
        },
      },
    });
    await performFromTurn(bind.output);

    const stored = await handle.db.execute(
      sql.raw(`SELECT "policyKey" FROM scope_policies WHERE "scopeId" = '${createdId}'`),
    );
    expect(stored.rows).toHaveLength(1);
    const bindings = await handle.db.execute(
      sql.raw(`SELECT "credentialEnvName" FROM scope_provider_bindings WHERE "scopeId" = '${createdId}'`),
    );
    // A NAME, never a secret — and the person read the name before it was bound.
    expect((bindings.rows[0] as { credentialEnvName: string }).credentialEnvName).toBe(
      "JASIM_INVENTORY_KEY",
    );
    const laylasGrant = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.subjectId, LAYLA));
    expect(laylasGrant[0]!.permissions.sort()).toEqual(["publish", "view"]);
  });

  it("a negotiation is authorized, run and agreed without a plan approving anything", async () => {
    const { engagement, proposalId } = await proposal();

    // The limit, read and delegated.
    const delegate = await turn("فوّضني للتفاوض حتى 250 ووافق ضمنه", {
      authorityRequest: {
        actType: "negotiation.envelope.set",
        params: {
          engagementId: engagement.id,
          bounds: { price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 } },
          mayConcede: true,
          mayAcceptWithinReserve: true,
        },
      },
    });
    await performFromTurn(delegate.output);

    // JASIM now negotiates inside that limit, through the ordinary capability
    // and the ordinary executor. Nothing here is an authority act, because
    // countering inside a limit somebody set is not a new decision.
    const run = await runtime.createRuntimeRun({
      ownerId: HASSAN,
      goal: "counter",
      idempotencyKey: `aut-${randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId: HASSAN,
      runId: run.id,
      nodes: [
        {
          nodeKey: "respond",
          capabilityId: "agreement-respond",
          inputs: { proposalId },
          maxAttempts: 1,
        },
      ],
    });
    await runtime.executeRuntimeDagNode({
      ownerId: HASSAN,
      runId: run.id,
      workerId: "authority-worker",
    });
    const counters = await handle.db.execute(
      sql.raw(
        `SELECT terms FROM economic_proposals WHERE "proposerOwnerId" = '${HASSAN}' ORDER BY version DESC LIMIT 1`,
      ),
    );
    // 240 is already inside 250, so there is nothing to counter — and saying
    // so is the right answer rather than haggling for its own sake.
    expect(counters.rows).toHaveLength(0);

    // The agreement, read term by term and agreed.
    const agree = await turn("اتفقنا — ثبّت الاتفاق", {
      authorityRequest: { actType: "agreement.commit", params: { proposalId } },
    });
    const carried = agree.output.authority as {
      statement: { lines: Array<{ key: string; value: unknown }> };
    };
    expect(carried.statement.lines.some((line) => line.value === 240)).toBe(true);
    await performFromTurn(agree.output);

    const rows = await handle.db.execute(
      sql.raw(`SELECT "authorityBasis" FROM agreements`),
    );
    expect(rows.rows).toHaveLength(1);
    // The person decided, and the record says so.
    expect((rows.rows[0] as { authorityBasis: { kind: string } }).authorityBasis.kind).toBe(
      "OWNER_DIRECT",
    );
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function performFromTurn(output: Record<string, unknown>): Promise<string> {
    expect(output.state).toBe("NEEDS_APPROVAL");
    const carried = output.authority as { requestId: string; statementDigest: string };
    const outcome = await approve(carried.requestId, carried.statementDigest);
    expect(outcome.state).toBe("PERFORMED");
    const result = outcome.state === "PERFORMED" ? outcome.result : {};
    return String(result.organizationId ?? result.membershipId ?? result.policyId ?? result.bindingId ?? result.agreementId ?? result.envelopeId ?? "");
  }

  async function negotiation() {
    const offering = await fabric.createExpression({
      ownerId: LAYLA,
      kind: "offering",
      semanticType: "unit X",
      attributes: { quantity: 300 },
    });
    await fabric.publishExpression({
      id: offering.id,
      ownerId: LAYLA,
      projection: { semanticType: "unit X", summary: "عرض" },
    });
    const need = await fabric.createExpression({
      ownerId: HASSAN,
      kind: "need",
      semanticType: "unit X",
      attributes: { quantity: 300 },
    });
    await fabric.publishExpression({
      id: need.id,
      ownerId: HASSAN,
      projection: { semanticType: "unit X", summary: "احتياج" },
    });
    const match = await fabric.matchNeedToOffering({
      needId: need.id,
      offeringId: offering.id,
      createdByOwnerId: HASSAN,
    });
    const engagement = await fabric.createEngagement({
      matchId: match.id,
      initiatorOwnerId: HASSAN,
      participants: await fabric.participantsForMatch(match.id),
    });
    return { engagement };
  }

  async function proposal() {
    const { engagement } = await negotiation();
    const created = await agreement.proposeTermSheet({
      engagementId: engagement.id,
      proposerOwnerId: LAYLA,
      terms: [
        { key: "price", kind: "NUMBER", value: 240, unit: "JOD" },
        { key: "deliveryDays", kind: "NUMBER", value: 5 },
      ],
    });
    return { engagement, proposalId: created.id };
  }

  /** Every scalar in a value, as strings — what a person must be able to read. */
  function leaves(value: unknown, into: string[] = []): string[] {
    if (value === null || value === undefined) return into;
    if (typeof value === "object") {
      for (const entry of Object.values(value as Record<string, unknown>)) leaves(entry, into);
      return into;
    }
    into.push(String(value));
    return into;
  }
});
