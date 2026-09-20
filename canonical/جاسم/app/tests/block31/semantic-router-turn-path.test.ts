/**
 * JASIM — routing CONTROLS the live turn, it does not merely label it.
 *
 * The unit tests prove the decision. This proves the consequence: that a read,
 * an account action, a standing condition and a persistent system each stop
 * producing a blocked execution run, and that nothing is executed on their
 * behalf.
 *
 * As before, only the provider call is stubbed. Everything else — routing,
 * sanitisation, validation, persistence — is the shipped code.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { dagNodes, runs } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let routeRuntimeConversationTurn: typeof import("../../api/runtime/jasim-runtime").routeRuntimeConversationTurn;
let createRuntimeConversation: typeof import("../../api/runtime/jasim-runtime").createRuntimeConversation;
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

const ownerId = "9501";

const INTENT = {
  requiredCapabilities: ["local-analysis"],
  missingInputs: [],
  inputs: {},
  risk: "low",
  persistence: "durable",
  effects: "none",
};

const GOAL = (outcome: string) => ({
  version: 1,
  outcome,
  constraints: [],
  preferences: [],
  assumptions: [],
  unknowns: [],
});

const plan = (kind: string, nodes: unknown[] = []) => ({
  version: 1,
  kind,
  nodes,
  blockers: [],
});

const DAG_NODE = {
  key: "step",
  capabilityId: "local-analysis",
  inputs: { note: "x" },
  dependsOn: [],
  bindings: [],
  enforces: [],
  authority: "NONE",
};

function envelope(extra: Record<string, unknown>): string {
  return JSON.stringify({
    version: 1,
    decisionId: randomUUID(),
    kind: "direct_action",
    label: "طلب",
    goal: "هدف",
    intent: INTENT,
    confidence: 0.8,
    ...extra,
  });
}

/** Neutral wording so the transitional commerce branch never claims the turn. */
async function turn(utterance: string, body: string) {
  const conversation = await createRuntimeConversation({ ownerId, title: "router" });
  vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
    text: body,
    provider: "openai",
    model: "stub-for-router-test",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  } as never);
  const result = await routeRuntimeConversationTurn({
    ownerId,
    conversationId: conversation.id,
    content: utterance,
  });
  const metadata = (result.assistantMessage.metadata ?? {}) as Record<string, unknown>;
  const allRuns = await handle.db.select().from(runs);
  const allNodes = await handle.db.select().from(dagNodes);
  return { result, metadata, allRuns, allNodes };
}

describe("the router controls what the live turn does", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    ({ routeRuntimeConversationTurn, createRuntimeConversation } = await import(
      "../../api/runtime/jasim-runtime"
    ));
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE events CASCADE"));
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── The four that used to become blocked execution runs ──────────────────

  it.each([
    ["أرني جدول مبيعاتي", "DIRECT_READ", "DIRECT_READ"],
    ["سجلني خروج", "IDENTITY_CHANGE", "TRUSTED_PRODUCT_ACTION"],
    ["لا ترسل لي إشعارات في الليل", "SETTING_MUTATION", "TRUSTED_PRODUCT_ACTION"],
    ["راقب مستوى الكلور ونبهني", "MONITORING", "MONITORING"],
    ["أنشئ نظام إعارة لمكتبة المسجد", "PERSISTENT_WORLD", "PERSISTENT_WORLD"],
  ])("«%s» routes to %s and creates NO run", async (utterance, planKind, expectedRoute) => {
    const { metadata, allRuns, allNodes, result } = await turn(
      utterance,
      envelope({ goalSpec: GOAL(utterance), planGraph: plan(planKind) }),
    );

    expect(metadata.semanticRoute).toBe(expectedRoute);
    // The consequence, not the label: nothing was persisted as work.
    expect(allRuns).toHaveLength(0);
    expect(allNodes).toHaveLength(0);
    expect(metadata.proposalIds).toBeUndefined();
    expect(result.output.kind).toBe("routed");
  });

  it("a read is answered truthfully, not with invented numbers", async () => {
    const { result, metadata } = await turn(
      "أرني جدول مبيعاتي",
      envelope({ goalSpec: GOAL("عرض جدول المبيعات"), planGraph: plan("DIRECT_READ") }),
    );
    const output = result.output as Record<string, unknown>;
    expect(output.state).toBe("UNAVAILABLE");
    expect(output.cause).toBe("MECHANISM_NOT_IMPLEMENTED");
    expect(result.assistantMessage.content).toMatch(/فهمت/);
    // The data need reached the boundary, carrying the goal and nothing else.
    const routed = metadata.routed as Record<string, unknown>;
    expect(routed.dataNeed).toEqual({
      kind: "AUTHORIZED_READ",
      subject: "عرض جدول المبيعات",
    });
  });

  it("«سجلني خروج» produces no AUTHENTICATE node anywhere", async () => {
    // AUTHENTICATE != DAG NODE, on the live path.
    const { allNodes, allRuns, result } = await turn(
      "سجلني خروج",
      envelope({ goalSpec: GOAL("تسجيل الخروج"), planGraph: plan("IDENTITY_CHANGE") }),
    );
    expect(allNodes).toHaveLength(0);
    expect(allRuns).toHaveLength(0);
    expect(JSON.stringify(result.output)).not.toMatch(/capabilityId|nodeKey/);
  });

  it("an identity plan carrying nodes STILL does not execute", async () => {
    // The dangerous case. Identity precedence must not depend on validity.
    const { metadata, allNodes, allRuns } = await turn(
      "سجلني خروج",
      envelope({
        goalSpec: GOAL("تسجيل الخروج"),
        planGraph: plan("IDENTITY_CHANGE", [DAG_NODE]),
      }),
    );
    expect(metadata.semanticRoute).toBe("TRUSTED_PRODUCT_ACTION");
    expect(metadata.semanticRouteReason).toBe("PLAN_IDENTITY_CHANGE");
    expect(allNodes).toHaveLength(0);
    expect(allRuns).toHaveLength(0);
  });

  // ── What must still work exactly as before ───────────────────────────────

  it("a real multi-step plan still becomes a real DAG", async () => {
    const { metadata, allNodes } = await turn(
      "جهّز لي التقرير",
      envelope({ goalSpec: GOAL("تجهيز تقرير"), planGraph: plan("DAG", [DAG_NODE]) }),
    );
    expect(metadata.semanticRoute).toBe("GENERAL_PLANGRAPH");
    expect(allNodes.map((node) => node.nodeKey)).toEqual(["step"]);
  });

  it("a turn with no plan takes the legacy path, visibly", async () => {
    const { metadata, allRuns } = await turn("جهّز لي التقرير", envelope({}));
    expect(metadata.semanticRoute).toBe("LEGACY_FLAT");
    expect(metadata.semanticRouteReason).toBe("ENVELOPE_EXECUTION_NO_PLAN");
    expect(metadata.proposalIds).toBeTruthy();
    expect(allRuns).toHaveLength(1);
  });

  it("a plain text answer still routes to TEXT and creates nothing", async () => {
    const { metadata, allRuns, result } = await turn(
      "ما هو جاسم؟",
      JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "text",
        content: "جاسم نظام عام.",
        confidence: 0.9,
      }),
    );
    expect(metadata.semanticRoute).toBe("TEXT");
    expect(allRuns).toHaveLength(0);
    expect(result.output.kind).toBe("text");
  });

  it("a presentation bubble routes to GENERATED_PRESENTATION and executes nothing", async () => {
    const { metadata, allRuns } = await turn(
      "قارن الثاني والرابع",
      JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "ephemeral_bubble",
        title: "مقارنة",
        semanticDescription: "مقارنة بين عنصرين معروضين",
        activeView: "default",
        presentationState: {},
        references: [],
        confidence: 0.8,
      }),
    );
    expect(metadata.semanticRoute).toBe("GENERATED_PRESENTATION");
    expect(allRuns).toHaveLength(0);
  });

  it("the route is recorded without the message that produced it", async () => {
    // §11: observable, but never a log of what someone typed.
    const utterance = "أرني جدول مبيعاتي السرية جدا";
    const { metadata } = await turn(
      utterance,
      envelope({ goalSpec: GOAL("عرض المبيعات"), planGraph: plan("DIRECT_READ") }),
    );
    const routeFields = JSON.stringify({
      route: metadata.semanticRoute,
      reason: metadata.semanticRouteReason,
      downstream: metadata.semanticRouteDownstream,
    });
    expect(routeFields).not.toContain(utterance);
    expect(routeFields).toBe(
      JSON.stringify({
        route: "DIRECT_READ",
        reason: "PLAN_DIRECT_READ",
        downstream: "NOT_IMPLEMENTED",
      }),
    );
  });
});
