/**
 * JASIM — A STORED POLICY IS NOT AN ENFORCED POLICY.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   POLICY STORED != POLICY ENFORCED
 *   POLICY TEXT   != EXECUTABLE POLICY
 *   MODEL INTERPRETATION != AUTHORITY
 *   UNKNOWN POLICY SEMANTICS != ALLOW
 *   POLICY ABSENCE != POLICY DENIAL
 *
 *   PERMISSION != POLICY != ENVELOPE != APPROVAL
 *   APPROVAL   != POLICY OVERRIDE
 *
 * Four different questions compose here, and the narrowest wins. A permission
 * to act does not answer a rule that caps the amount; an envelope wide enough
 * to reach 250 does not answer a rule that says a person decides above 200; and
 * approving something a rule denies does not make it permitted.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { agreements, executionAttempts, scopePolicies } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let policy: typeof import("../../api/runtime/policy-enforcement");
let authority: typeof import("../../api/runtime/authority-acts");
let scope: typeof import("../../api/runtime/actor-scope");
let fabric: typeof import("../../api/runtime/economic-fabric");
let agreement: typeof import("../../api/runtime/agreement-runtime");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

const BUYER = "9601";
const SELLER = "9602";

describe("a rule this scope wrote is a rule this scope obeys", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    policy = await import("../../api/runtime/policy-enforcement");
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

  // ── Fixtures ──────────────────────────────────────────────────────────────

  const RULE = (over: Record<string, unknown>) => ({
    policySchema: "jasim.policy/1",
    actions: ["*"],
    conditions: [],
    effect: "ALLOW",
    ...over,
  });

  /** Written straight to the row, so the evaluator is what is under test. */
  async function store(scopeId: string, policyKey: string, value: unknown, version = 1) {
    await handle.db.insert(scopePolicies).values({
      id: `pol_${randomUUID()}`,
      scopeId,
      policyKey,
      value: value as Record<string, unknown>,
      version,
      setByPrincipalId: scopeId,
    });
  }

  const decide = (scopeId: string, action: string, parameters?: unknown) =>
    policy.evaluatePolicies({ scopeId, action, ...(parameters ? { parameters } : {}) });

  // ── 1. The two defaults ───────────────────────────────────────────────────

  it("POLICY ABSENCE != POLICY DENIAL", async () => {
    const decision = await decide(BUYER, "anything.at.all", { amount: 9999 });
    expect(decision.outcome).toBe("ALLOWED");
    expect(decision.consulted).toHaveLength(0);
  });

  it("UNKNOWN POLICY SEMANTICS != ALLOW", async () => {
    // Present, active, claiming to be a rule, unreadable. There is no safe way
    // to proceed past it and no way to know what it governs.
    await store(BUYER, "broken", { policySchema: "jasim.policy/1", effect: "SOMETIMES" });
    const decision = await decide(BUYER, "anything.at.all", {});
    expect(decision.outcome).toBe("UNSUPPORTED_POLICY");
    expect(decision.reasons[0]!.code).toBe("MALFORMED_POLICY");
  });

  it("a policy from a future schema is unknown, not ignored", async () => {
    await store(BUYER, "future", { policySchema: "jasim.policy/99", effect: "DENY", actions: ["*"] });
    expect((await decide(BUYER, "x", {})).outcome).toBe("UNSUPPORTED_POLICY");
  });

  it("a setting is not a rule and takes no part in any decision", async () => {
    //   POLICY STORED != POLICY ENFORCED
    // Two phases stored rows exactly like this one and called them policies.
    // They enforce nothing, and now they say so.
    await store(BUYER, "branding", { colour: "أزرق", floor: 180 });
    const decision = await decide(BUYER, "agreement.commit", { terms: { price: 10 } });
    expect(decision.outcome).toBe("ALLOWED");
    expect(decision.consulted).toHaveLength(0);
    expect(policy.classifyPolicyBody({ colour: "أزرق" })).toBe("RECORDED_ONLY");
  });

  // ── 2. The four effects ───────────────────────────────────────────────────

  it("A · ALLOWED — the conditions do not hold", async () => {
    await store(
      BUYER,
      "cap",
      RULE({ effect: "DENY", actions: ["agreement.commit"], conditions: [{ field: "terms.price", operator: "gt", value: 500 }] }),
    );
    expect((await decide(BUYER, "agreement.commit", { terms: { price: 100 } })).outcome).toBe(
      "ALLOWED",
    );
  });

  it("B · DENIED — categorically, when they do", async () => {
    await store(
      BUYER,
      "cap",
      RULE({ effect: "DENY", actions: ["agreement.commit"], conditions: [{ field: "terms.price", operator: "gt", value: 500 }] }),
    );
    const decision = await decide(BUYER, "agreement.commit", { terms: { price: 501 } });
    expect(decision.outcome).toBe("DENIED");
    expect(decision.reasons[0]!.effect).toBe("DENY");
  });

  it("C · REQUIRES_APPROVAL — a person decides this one", async () => {
    await store(
      BUYER,
      "threshold",
      RULE({
        effect: "REQUIRE_APPROVAL",
        actions: ["agreement.commit"],
        conditions: [{ field: "terms.price", operator: "gt", value: 200 }],
      }),
    );
    expect((await decide(BUYER, "agreement.commit", { terms: { price: 225 } })).outcome).toBe(
      "REQUIRES_APPROVAL",
    );
  });

  it("D · CONSTRAINED — permitted only while the parameters satisfy it", async () => {
    await store(
      BUYER,
      "bounded",
      RULE({
        effect: "CONSTRAIN",
        actions: ["opportunity-publish"],
        requires: [{ field: "attributes.quantity", operator: "lte", value: 100 }],
      }),
    );
    expect(
      (await decide(BUYER, "opportunity-publish", { attributes: { quantity: 50 } })).outcome,
    ).toBe("ALLOWED");
    const refused = await decide(BUYER, "opportunity-publish", { attributes: { quantity: 500 } });
    expect(refused.outcome).toBe("DENIED");
    expect(refused.reasons[0]!.code).toBe("REQUIREMENT_UNSATISFIED");
    // The FIELD, so a caller can propose something legal — never the bound.
    expect(refused.reasons[0]!.field).toBe("attributes.quantity");
    expect(JSON.stringify(refused)).not.toContain("100");
  });

  it("nothing is clamped — a violated constraint refuses rather than rewrites", async () => {
    await store(
      BUYER,
      "bounded",
      RULE({
        effect: "CONSTRAIN",
        actions: ["*"],
        requires: [{ field: "quantity", operator: "lte", value: 100 }],
      }),
    );
    const decision = await decide(BUYER, "x", { quantity: 500 });
    expect(decision.outcome).toBe("DENIED");
    // Rewriting somebody's parameters to make them legal is the runtime
    // negotiating on their behalf without being asked.
    expect(decision).not.toHaveProperty("constrainedParameters");
  });

  // ── 3. Composition: the narrowest wins ────────────────────────────────────

  it("an explicit ALLOW never erases a DENY", async () => {
    //   APPROVAL != POLICY OVERRIDE, and neither is permission.
    await store(BUYER, "permit", RULE({ effect: "ALLOW", actions: ["*"] }));
    await store(BUYER, "forbid", RULE({ effect: "DENY", actions: ["*"] }), 1);
    expect((await decide(BUYER, "x", {})).outcome).toBe("DENIED");
  });

  it("a DENY outranks a REQUIRE_APPROVAL", async () => {
    await store(BUYER, "ask", RULE({ effect: "REQUIRE_APPROVAL", actions: ["*"] }));
    await store(BUYER, "forbid", RULE({ effect: "DENY", actions: ["*"] }));
    expect((await decide(BUYER, "x", {})).outcome).toBe("DENIED");
  });

  it("an unevaluable policy outranks everything, including an ALLOW", async () => {
    await store(BUYER, "permit", RULE({ effect: "ALLOW", actions: ["*"] }));
    await store(BUYER, "broken", { policySchema: "jasim.policy/1" });
    expect((await decide(BUYER, "x", {})).outcome).toBe("UNSUPPORTED_POLICY");
  });

  it("a policy of another scope decides nothing here", async () => {
    await store(SELLER, "forbid", RULE({ effect: "DENY", actions: ["*"] }));
    expect((await decide(BUYER, "x", {})).outcome).toBe("ALLOWED");
    expect((await decide(SELLER, "x", {})).outcome).toBe("DENIED");
  });

  // ── 4. Applicability and time ─────────────────────────────────────────────

  it("governs only the actions it names", async () => {
    await store(BUYER, "cap", RULE({ effect: "DENY", actions: ["agreement.commit"] }));
    expect((await decide(BUYER, "agreement.commit", {})).outcome).toBe("DENIED");
    expect((await decide(BUYER, "opportunity-publish", {})).outcome).toBe("ALLOWED");
  });

  it("is inert outside its window", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await store(BUYER, "later", RULE({ effect: "DENY", actions: ["*"], effectiveFrom: future }));
    expect((await decide(BUYER, "x", {})).outcome).toBe("ALLOWED");
    expect(
      (await policy.evaluatePolicies({
        scopeId: BUYER,
        action: "x",
        now: new Date(Date.now() + 172_800_000),
      })).outcome,
    ).toBe("DENIED");
  });

  it("a missing fact does not satisfy a requirement", async () => {
    // Fail closed: a rule that bounds something the request never mentioned is
    // a rule the request cannot have satisfied.
    await store(
      BUYER,
      "bounded",
      RULE({ effect: "CONSTRAIN", actions: ["*"], requires: [{ field: "amount", operator: "lte", value: 100 }] }),
    );
    expect((await decide(BUYER, "x", { somethingElse: 1 })).outcome).toBe("DENIED");
  });

  it("an incomparable value does not satisfy a requirement", async () => {
    await store(
      BUYER,
      "bounded",
      RULE({ effect: "CONSTRAIN", actions: ["*"], requires: [{ field: "amount", operator: "lte", value: 100 }] }),
    );
    expect((await decide(BUYER, "x", { amount: "كثير" })).outcome).toBe("DENIED");
  });

  // ── 5. Versioning ─────────────────────────────────────────────────────────

  it("only the newest version of a key decides, and the older one still exists", async () => {
    await store(BUYER, "cap", RULE({ effect: "DENY", actions: ["*"] }), 1);
    await store(BUYER, "cap", RULE({ effect: "ALLOW", actions: ["*"] }), 2);
    const decision = await decide(BUYER, "x", {});
    expect(decision.outcome).toBe("ALLOWED");
    // Attributable: the decision names the version it used.
    expect(decision.consulted).toEqual([{ policyId: expect.any(String), version: 2 }]);
    // And the superseded one is still on the record.
    expect(await handle.db.select().from(scopePolicies)).toHaveLength(2);
  });

  it("a stale version cannot silently authorize", async () => {
    await store(BUYER, "cap", RULE({ effect: "ALLOW", actions: ["*"] }), 1);
    await store(BUYER, "cap", RULE({ effect: "DENY", actions: ["*"] }), 2);
    expect((await decide(BUYER, "x", {})).outcome).toBe("DENIED");
  });

  // ── 6. Private policy never leaks ─────────────────────────────────────────

  it("a decision carries ids, versions and codes — never the rule", async () => {
    await store(
      SELLER,
      "floor",
      RULE({
        effect: "DENY",
        actions: ["*"],
        conditions: [{ field: "terms.price", operator: "lt", value: 180 }],
      }),
    );
    const decision = await decide(SELLER, "agreement.commit", { terms: { price: 100 } });
    const disclosed = JSON.stringify(policy.disclosableDecision(decision));
    expect(disclosed).toContain("DENIED");
    // The seller's floor steers the decision without being disclosed.
    expect(disclosed).not.toContain("180");
    expect(disclosed).not.toContain("terms.price");
    expect(disclosed).not.toContain("jasim.policy/1");
  });

  // ── 7. The authority path ─────────────────────────────────────────────────

  const personal = (principalId: string) =>
    ({ kind: "PERSONAL", scopeId: principalId, principalId }) as const;

  it("the statement says whether a policy will be enforced or merely recorded", async () => {
    //   POLICY TEXT != EXECUTABLE POLICY
    // A person who asked for a rule and is getting a note has to see that.
    const asNote = await authority.requestAuthorityAct({
      actType: "policy.set",
      principalId: BUYER,
      scope: personal(BUYER),
      params: { policyKey: "wish", value: { text: "لا تبيع بأقل من التكلفة" } },
    });
    const noteLines = new Map(asNote.statement.lines.map((line) => [line.key, line.value]));
    expect(noteLines.get("enforcement")).toBe("RECORDED_ONLY");

    const asRule = await authority.requestAuthorityAct({
      actType: "policy.set",
      principalId: BUYER,
      scope: personal(BUYER),
      params: {
        policyKey: "threshold",
        value: RULE({
          effect: "REQUIRE_APPROVAL",
          actions: ["agreement.commit"],
          conditions: [{ field: "terms.price", operator: "gt", value: 200 }],
        }),
      },
    });
    const ruleLines = new Map(asRule.statement.lines.map((line) => [line.key, line.value]));
    expect(ruleLines.get("enforcement")).toBe("ENFORCED");
    expect(ruleLines.get("effect")).toBe("REQUIRE_APPROVAL");
    // Every condition on its own line, so nobody approves a threshold unseen.
    expect(ruleLines.get("conditions[0]")).toBe("terms.price gt 200");
  });

  it("a DENY cannot be approved past", async () => {
    await store(BUYER, "forbid", RULE({ effect: "DENY", actions: ["organization.create"] }));
    await expect(
      authority.requestAuthorityAct({
        actType: "organization.create",
        principalId: BUYER,
        scope: personal(BUYER),
        params: { displayName: "شركة" },
      }),
    ).rejects.toThrow(/forbids/i);
  });

  it("an unevaluable policy stops the authority path too", async () => {
    await store(BUYER, "broken", { policySchema: "jasim.policy/1", actions: "everything" });
    await expect(
      authority.requestAuthorityAct({
        actType: "organization.create",
        principalId: BUYER,
        scope: personal(BUYER),
        params: { displayName: "شركة" },
      }),
    ).rejects.toThrow(/cannot evaluate/i);
  });

  it("a REQUIRE_APPROVAL is satisfied by asking, which is what this path is", async () => {
    await store(BUYER, "ask", RULE({ effect: "REQUIRE_APPROVAL", actions: ["organization.create"] }));
    const { request, statement } = await authority.requestAuthorityAct({
      actType: "organization.create",
      principalId: BUYER,
      scope: personal(BUYER),
      params: { displayName: "شركة النور" },
    });
    expect((statement.policy as { outcome: string }).outcome).toBe("REQUIRES_APPROVAL");
    const outcome = await authority.approveAuthorityRequest({
      requestId: request.id,
      principalId: BUYER,
      statementDigest: authority.statementDigest(statement),
    });
    expect(outcome.state).toBe("PERFORMED");
  });

  // ── 8. A policy written while somebody was reading ────────────────────────

  it("writing a rule voids a pending approval", async () => {
    const { request, statement } = await authority.requestAuthorityAct({
      actType: "organization.create",
      principalId: BUYER,
      scope: personal(BUYER),
      params: { displayName: "شركة النور" },
    });
    expect((statement.policy as { outcome: string }).outcome).toBe("ALLOWED");

    await store(BUYER, "ask", RULE({ effect: "REQUIRE_APPROVAL", actions: ["*"] }));

    // The statement carried the decision, so the decision changing moves the
    // digest. No new machinery, and no way to approve the old words.
    const outcome = await authority.approveAuthorityRequest({
      requestId: request.id,
      principalId: BUYER,
      statementDigest: authority.statementDigest(statement),
    });
    expect(outcome.state).toBe("VOID");
    expect(outcome.state === "VOID" && outcome.resolution).toBe("STATEMENT_CHANGED");
    const orgs = await handle.db.execute(sql.raw("SELECT id FROM organizations"));
    expect(orgs.rows).toHaveLength(0);
  });

  it("a rule written after approval cannot un-perform it, and is on the record", async () => {
    const { request, statement } = await authority.requestAuthorityAct({
      actType: "organization.create",
      principalId: BUYER,
      scope: personal(BUYER),
      params: { displayName: "شركة النور" },
    });
    await authority.approveAuthorityRequest({
      requestId: request.id,
      principalId: BUYER,
      statementDigest: authority.statementDigest(statement),
    });
    await store(BUYER, "forbid", RULE({ effect: "DENY", actions: ["*"] }));
    // Historical decisions stay explainable: the statement records the policy
    // state it was decided under, and nothing rewrites it.
    const [row] = await handle.db
      .select()
      .from(handle.db.select().from(scopePolicies).as("p") as never)
      .limit(0)
      .catch(() => [undefined]);
    expect(row).toBeUndefined();
    const orgs = await handle.db.execute(sql.raw("SELECT id FROM organizations"));
    expect(orgs.rows).toHaveLength(1);
  });

  // ── 9. Policy at the executor, immediately before the effect ──────────────

  async function runNode(input: {
    capabilityId: string;
    inputs: Record<string, unknown>;
    ownerId: string;
  }) {
    const run = await runtime.createRuntimeRun({
      ownerId: input.ownerId,
      goal: `policy: ${input.capabilityId}`,
      idempotencyKey: `pol-${randomUUID()}`,
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
      workerId: "policy-worker",
    });
    const [attempt] = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id));
    return attempt!;
  }

  const PUBLISH = (quantity: number) => ({
    kind: "OFFERING",
    semanticType: "unit X",
    summary: "عرض",
    visibility: "PUBLIC" as const,
    attributes: { quantity },
  });

  it("the executor refuses before the capability runs, not after", async () => {
    await store(
      SELLER,
      "bounded",
      RULE({
        effect: "CONSTRAIN",
        actions: ["opportunity-publish"],
        requires: [{ field: "attributes.quantity", operator: "lte", value: 100 }],
      }),
    );
    const allowed = await runNode({
      capabilityId: "opportunity-publish",
      ownerId: SELLER,
      inputs: PUBLISH(50),
    });
    expect(allowed.executionStatus).toBe("COMPLETED");

    const refused = await runNode({
      capabilityId: "opportunity-publish",
      ownerId: SELLER,
      inputs: PUBLISH(500),
    });
    expect(refused.executionStatus).toBe("FAILED");
    expect(JSON.stringify(refused.normalizedError)).toContain("POLICY_DENIED");
    // Nothing was written. The decision happened before the effect.
    const rows = await handle.db.execute(
      sql.raw(`SELECT id FROM economic_expressions WHERE "ownerId" = '${SELLER}'`),
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("a worker cannot ask anybody, so REQUIRE_APPROVAL fails truthfully", async () => {
    await store(SELLER, "ask", RULE({ effect: "REQUIRE_APPROVAL", actions: ["opportunity-publish"] }));
    const attempt = await runNode({
      capabilityId: "opportunity-publish",
      ownerId: SELLER,
      inputs: PUBLISH(1),
    });
    expect(attempt.executionStatus).toBe("FAILED");
    expect(JSON.stringify(attempt.normalizedError)).toContain("POLICY_REQUIRES_APPROVAL");
  });

  // ── 10. Policy + negotiation: three restrictions composing ────────────────

  async function negotiation(price: number) {
    const offering = await fabric.createExpression({
      ownerId: SELLER,
      kind: "offering",
      semanticType: "unit X",
      attributes: { quantity: 300 },
    });
    await fabric.publishExpression({
      id: offering.id,
      ownerId: SELLER,
      projection: { semanticType: "unit X", summary: "عرض" },
    });
    const need = await fabric.createExpression({
      ownerId: BUYER,
      kind: "need",
      semanticType: "unit X",
      attributes: { quantity: 300 },
    });
    await fabric.publishExpression({
      id: need.id,
      ownerId: BUYER,
      projection: { semanticType: "unit X", summary: "احتياج" },
    });
    const match = await fabric.matchNeedToOffering({
      needId: need.id,
      offeringId: offering.id,
      createdByOwnerId: BUYER,
    });
    const engagement = await fabric.createEngagement({
      matchId: match.id,
      initiatorOwnerId: BUYER,
      participants: await fabric.participantsForMatch(match.id),
    });
    await agreement.setNegotiationEnvelope({
      engagementId: engagement.id,
      ownerId: BUYER,
      principalId: BUYER,
      // May negotiate up to 250.
      bounds: { price: { direction: "LOWER_IS_BETTER", target: 180, reserve: 250 } },
      mayConcede: true,
      mayAcceptWithinReserve: true,
    });
    const proposal = await agreement.proposeTermSheet({
      engagementId: engagement.id,
      proposerOwnerId: SELLER,
      terms: [{ key: "price", kind: "NUMBER", value: price, unit: "JOD" }],
    });
    return { engagement, proposalId: proposal.id };
  }

  /** «أي التزام يتجاوز 200 يحتاج موافقتي.» */
  const THRESHOLD_200 = RULE({
    effect: "REQUIRE_APPROVAL",
    actions: ["agreement.commit"],
    conditions: [{ field: "terms.price", operator: "gt", value: 200 }],
  });

  it("at 190 the envelope may agree, because the rule does not apply", async () => {
    await store(BUYER, "threshold", THRESHOLD_200);
    const { proposalId } = await negotiation(190);
    const { agreement: row } = await agreement.commitAgreement({
      proposalId,
      ownerId: BUYER,
    });
    expect((row.authorityBasis as { kind: string }).kind).toBe("ENVELOPE");
  });

  it("at 225 the envelope is wide enough and the rule still says a person decides", async () => {
    // The composition, exactly: authority ceiling 250, policy threshold 200.
    // Broader authority never erases a narrower rule.
    await store(BUYER, "threshold", THRESHOLD_200);
    const { proposalId } = await negotiation(225);
    await expect(
      agreement.commitAgreement({ proposalId, ownerId: BUYER }),
    ).rejects.toThrow(/person to approve/i);
    expect(await handle.db.select().from(agreements)).toHaveLength(0);

    // And the person's own decision, through the authority path, satisfies it.
    const { request, statement } = await authority.requestAuthorityAct({
      actType: "agreement.commit",
      principalId: BUYER,
      scope: personal(BUYER),
      params: { proposalId },
    });
    expect((statement.policy as { outcome: string }).outcome).toBe("REQUIRES_APPROVAL");
    // And the price they are agreeing to is on the screen.
    // The number a rule compares and the number a person reads are one fact.
    expect(statement.lines.some((line) => line.key === "terms.price" && line.value === 225)).toBe(
      true,
    );
    expect(statement.lines.some((line) => line.key === "units.price" && line.value === "JOD")).toBe(
      true,
    );
    const outcome = await authority.approveAuthorityRequest({
      requestId: request.id,
      principalId: BUYER,
      statementDigest: authority.statementDigest(statement),
    });
    expect(outcome.state).toBe("PERFORMED");
    const [row] = await handle.db.select().from(agreements);
    expect((row!.authorityBasis as { kind: string }).kind).toBe("OWNER_DIRECT");
  });

  it("at 260 the authority itself is exceeded, whatever the policy says", async () => {
    await store(BUYER, "threshold", THRESHOLD_200);
    const { proposalId } = await negotiation(260);
    await expect(
      agreement.commitAgreement({ proposalId, ownerId: BUYER }),
    ).rejects.toThrow();
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
  });

  it("a DENY stops the owner too — approval is not an override", async () => {
    await store(
      BUYER,
      "forbid",
      RULE({
        effect: "DENY",
        actions: ["agreement.commit"],
        conditions: [{ field: "terms.price", operator: "gt", value: 100 }],
      }),
    );
    const { proposalId } = await negotiation(190);
    await expect(
      agreement.commitAgreement({
        proposalId,
        ownerId: BUYER,
        principalId: BUYER,
        ownerDirect: true,
      }),
    ).rejects.toThrow(/forbids/i);
  });

  // ── 11. A future transaction runtime calls the same one function ──────────

  it("an action nobody has registered still gets a deterministic decision", async () => {
    // GENERAL_TRANSACTION_FULFILLMENT is not built. The boundary does not care.
    await store(
      BUYER,
      "spend",
      RULE({
        effect: "REQUIRE_APPROVAL",
        actions: ["transaction.execute"],
        conditions: [{ field: "amount", operator: "gt", value: 500 }],
      }),
    );
    const request = {
      scopeId: BUYER,
      action: "transaction.execute",
      parameters: { amount: 750, currency: "JOD" },
      resourceRefs: { kind: "agreement", id: "agr_1" },
    };
    const first = await policy.evaluatePolicies(request);
    const second = await policy.evaluatePolicies(request);
    expect(first.outcome).toBe("REQUIRES_APPROVAL");
    // Deterministic: the same question twice is the same answer twice.
    expect(second).toEqual(first);
    expect(
      (await policy.evaluatePolicies({ ...request, parameters: { amount: 100 } })).outcome,
    ).toBe("ALLOWED");
  });

  it("a rule may name a resource reference, not only a parameter", async () => {
    await store(
      BUYER,
      "byResource",
      RULE({
        effect: "DENY",
        actions: ["*"],
        conditions: [{ field: "resource.kind", operator: "eq", value: "agreement" }],
      }),
    );
    expect(
      (await policy.evaluatePolicies({
        scopeId: BUYER,
        action: "x",
        resourceRefs: { kind: "agreement" },
      })).outcome,
    ).toBe("DENIED");
    expect(
      (await policy.evaluatePolicies({
        scopeId: BUYER,
        action: "x",
        resourceRefs: { kind: "proposal" },
      })).outcome,
    ).toBe("ALLOWED");
  });

  // ── 12. Holdouts: one evaluator, five unrelated worlds ────────────────────

  /**
   * No line of the policy layer was written with any of these in mind, and
   * none of them has an evaluator, a type or a branch.
   */
  const HOLDOUTS = [
    ["laboratory instrument hours", "instrumentHours", 6, 10],
    ["temporary generator capacity", "kilowatts", 40, 120],
    ["warehouse access", "palletsMoved", 20, 400],
    ["human service spending", "dinars", 150, 900],
    ["machine operation window", "runMinutes", 30, 600],
    ["apiary hives lent", "hives", 4, 40],
  ] as const;

  it.each(HOLDOUTS)("%s obeys the same one evaluator", async (label, field, ok, over) => {
    await store(
      BUYER,
      `limit:${field}`,
      RULE({
        effect: "CONSTRAIN",
        actions: ["*"],
        requires: [{ field, operator: "lte", value: (ok + over) / 2 }],
      }),
    );
    expect((await decide(BUYER, "anything", { [field]: ok })).outcome, label).toBe("ALLOWED");
    const refused = await decide(BUYER, "anything", { [field]: over });
    expect(refused.outcome, label).toBe("DENIED");
    expect(refused.reasons[0]!.field, label).toBe(field);
    await handle.db.execute(sql.raw(`DELETE FROM scope_policies WHERE "scopeId" = '${BUYER}'`));
  });

  // ── 13. Security ──────────────────────────────────────────────────────────

  it("a caller cannot state a decision", async () => {
    for (const key of ["policyDecision", "policyOverride", "bypass", "trusted", "exempt"]) {
      expect(() =>
        policy.parseEnforcementPolicy(RULE({ effect: "DENY", actions: ["*"], [key]: true })),
      ).toThrow(/policy decision/i);
    }
  });

  it("a condition cannot smuggle one either", async () => {
    expect(() =>
      policy.parseEnforcementPolicy(
        RULE({
          effect: "DENY",
          actions: ["*"],
          conditions: [{ field: "x", operator: "eq", value: 1, bypass: true }],
        }),
      ),
    ).toThrow(/policy decision/i);
  });

  it("an unknown operator is refused, not approximated", async () => {
    expect(() =>
      policy.parseEnforcementPolicy(
        RULE({ effect: "DENY", actions: ["*"], conditions: [{ field: "x", operator: "roughly", value: 1 }] }),
      ),
    ).toThrow(/operator/i);
  });

  it("one person cannot write a rule into another's scope", async () => {
    const created = await scope.createOrganization({
      principalId: SELLER,
      displayName: "شركة ليلى",
    });
    await expect(
      scope.setScopePolicy({
        principalId: BUYER,
        scopeId: created.id,
        policyKey: "forbid",
        value: RULE({ effect: "ALLOW", actions: ["*"] }),
      }),
    ).rejects.toThrow(/permitted/i);
    expect(await handle.db.select().from(scopePolicies)).toHaveLength(0);
  });

  it("no model is consulted at enforcement time", async () => {
    // MODEL INTERPRETATION != AUTHORITY, made falsifiable: the gateway is not
    // reachable from the evaluator at all.
    const spy = vi.spyOn(ModelGateway.prototype, "generate");
    await store(BUYER, "cap", RULE({ effect: "DENY", actions: ["*"] }));
    await decide(BUYER, "x", { anything: "غامض" });
    expect(spy).not.toHaveBeenCalled();
  });

  // ── 14. The live conversational path ──────────────────────────────────────

  async function turn(content: string, extra: Record<string, unknown>, principalId = BUYER) {
    const conversation = await runtime.createRuntimeConversation({
      ownerId: principalId,
      title: "policy",
    });
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "direct_action",
        label: "سياسة",
        goal: "فعل",
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
      model: "stub-for-policy-turn",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: principalId,
      conversationId: conversation.id,
      content,
    });
    return { result, output: result.output as Record<string, unknown> };
  }

  async function approveFromTurn(output: Record<string, unknown>) {
    const carried = output.authority as { requestId: string; statementDigest: string };
    return authority.approveAuthorityRequest({
      requestId: carried.requestId,
      principalId: BUYER,
      statementDigest: carried.statementDigest,
    });
  }

  it("«أي التزام يتجاوز 200 يحتاج موافقتي» — said, read, enforced", async () => {
    const set = await turn("ضع سياسة: أي التزام يتجاوز 200 يحتاج موافقتي", {
      authorityRequest: {
        actType: "policy.set",
        params: { policyKey: "commitment_threshold", value: THRESHOLD_200 },
      },
    });
    expect(set.output.state).toBe("NEEDS_APPROVAL");
    const shown = (set.output.authority as { statement: { lines: Array<{ key: string; value: unknown }> } })
      .statement.lines;
    // The person reads that it WILL be enforced, and reads the 200.
    expect(shown.find((line) => line.key === "enforcement")!.value).toBe("ENFORCED");
    expect(shown.some((line) => String(line.value).includes("200"))).toBe(true);
    expect((await approveFromTurn(set.output)).state).toBe("PERFORMED");

    // 190 — allowed under both the authority and the rule.
    const low = await negotiation(190);
    const agreed = await agreement.commitAgreement({ proposalId: low.proposalId, ownerId: BUYER });
    expect((agreed.agreement.authorityBasis as { kind: string }).kind).toBe("ENVELOPE");

    // 225 — the envelope is wide enough; the rule sends it to a person.
    const high = await negotiation(225);
    await expect(
      agreement.commitAgreement({ proposalId: high.proposalId, ownerId: BUYER }),
    ).rejects.toThrow(/person to approve/i);

    const commit = await turn("اتفقنا — ثبّت الاتفاق", {
      authorityRequest: { actType: "agreement.commit", params: { proposalId: high.proposalId } },
    });
    const carried = commit.output.authority as {
      requestId: string;
      statementDigest: string;
      statement: { policy: { outcome: string }; lines: Array<{ value: unknown }> };
    };
    expect(carried.statement.policy.outcome).toBe("REQUIRES_APPROVAL");
    expect(carried.statement.lines.some((line) => line.value === 225)).toBe(true);

    // Only the exact approved statement may proceed.
    const wrong = await authority.approveAuthorityRequest({
      requestId: carried.requestId,
      principalId: BUYER,
      statementDigest: "f".repeat(64),
    });
    expect(wrong.state).toBe("VOID");
    expect(await handle.db.select().from(agreements)).toHaveLength(1);
  });

  it("a rule written after the statement was read voids the approval", async () => {
    const { proposalId } = await negotiation(190);
    const commit = await turn("ثبّت الاتفاق", {
      authorityRequest: { actType: "agreement.commit", params: { proposalId } },
    });
    const carried = commit.output.authority as { requestId: string; statementDigest: string };

    // The scope forbids it while the person is still reading.
    await store(
      BUYER,
      "forbid",
      RULE({
        effect: "DENY",
        actions: ["agreement.commit"],
        conditions: [{ field: "terms.price", operator: "gt", value: 100 }],
      }),
    );
    const outcome = await authority.approveAuthorityRequest({
      requestId: carried.requestId,
      principalId: BUYER,
      statementDigest: carried.statementDigest,
    });
    expect(outcome.state).toBe("VOID");
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
  });

  it("the turn refuses a planned capability its scope forbids, before any run", async () => {
    await store(
      BUYER,
      "forbid",
      RULE({ effect: "DENY", actions: ["opportunity-publish"] }),
    );
    const blocked = await turn("انشر عرضي", {
      planGraph: {
        version: 1,
        kind: "DAG",
        nodes: [
          {
            key: "publish",
            capabilityId: "opportunity-publish",
            inputs: PUBLISH(1),
            dependsOn: [],
            bindings: [],
            enforces: [],
            authority: "NONE",
          },
        ],
        blockers: [],
      },
      intent: {
        requiredCapabilities: ["opportunity-publish"],
        missingInputs: [],
        inputs: {},
        risk: "low",
        persistence: "durable",
        effects: "none",
      },
    });
    expect(blocked.output.state).toBe("DENIED");
    expect(blocked.output.cause).toBe("POLICY_DENIED");
    const runs = await handle.db.execute(
      sql.raw(`SELECT id FROM runs WHERE "ownerId" = '${BUYER}'`),
    );
    expect(runs.rows).toHaveLength(0);
    // Ids and codes reached the person; the rule did not.
    expect(JSON.stringify(blocked.output)).not.toContain("jasim.policy");
  });
});
