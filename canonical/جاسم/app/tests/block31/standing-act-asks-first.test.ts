/**
 * JASIM — AN ACT NOBODY IS WATCHING ASKS FIRST.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * Approval was decided by RISK ALONE:
 *
 *     input.risk === "high" || input.risk === "critical"
 *       ? "require_approval"
 *       : "allow";
 *
 * That is right for an act a person authored a moment ago and is watching
 * happen. It is not right for one that fires at three in the morning because a
 * number moved — the same «low risk» does not mean the same thing when nobody
 * is there.
 *
 *   A STANDING ACT IS NOT A WATCHED ACT
 *
 * And the chain that makes such an act possible was just completed: a condition
 * can become true, and a fired trigger can wake the run it names. So the moment
 * a standing act exists, a low-risk one would have executed unattended. The
 * rule is fixed before the door that needs it opens — which is «لا تنفّذ بدون
 * موافقتي» holding by construction rather than by the person remembering to say
 * it.
 *
 * ─── HOW «STANDING» IS KNOWN ────────────────────────────────────────────────
 *
 *   A RUN A TRIGGER NAMES IS A STANDING RUN
 *
 * Read from canonical state, not from a flag — the SAME evidence that decides
 * whether a fired trigger may wake the run. One fact, one place, and nothing to
 * forget to set. A standing run cannot be one thing to the waker and another to
 * the approval gate.
 *
 * ─── AND IT NEVER LOOSENS ───────────────────────────────────────────────────
 *
 * This can only turn «allow» into «require_approval». A high-risk act still
 * asks, a denied one stays denied, and one missing inputs still asks for them.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { temporalTriggers } from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");

/** `createRuntimeConversation` maps the owner through `toNumId`. */
const OWNER = "9001";
const OTHER = "9002";

beforeAll(async () => {
  handle = await getTestDb();
  runtime = await import("../../api/runtime/jasim-runtime");
});

beforeEach(async () => {
  await handle.db.execute(
    sql.raw("TRUNCATE TABLE temporal_triggers, execution_proposals, runs, events CASCADE"),
  );
});

describe("an act nobody is watching asks first", () => {
  async function conversation(owner = OWNER) {
    return runtime.createRuntimeConversation({ ownerId: owner, title: "standing" });
  }

  async function run(owner = OWNER) {
    return runtime.createRuntimeRun({
      ownerId: owner,
      goal: "something that will happen later",
      idempotencyKey: `standing-${randomUUID()}`,
    });
  }

  /** A trigger that NAMES the run on its own row. */
  async function triggerNaming(runId: string, owner = OWNER) {
    await handle.db.insert(temporalTriggers).values({
      id: `trg_${randomUUID()}`,
      ownerId: owner,
      kind: "CONDITION",
      state: "active",
      fireAt: new Date(),
      runId,
      condition: {},
      continuation: { jobKind: "block2.resume_node" },
      idempotencyKey: `standing-${randomUUID()}`,
    } as never);
  }

  async function propose(input: {
    runId?: string;
    risk?: "none" | "low" | "medium" | "high" | "critical";
    capability?: string | null;
    missingInputs?: string[];
    owner?: string;
  }) {
    const owner = input.owner ?? OWNER;
    const conv = await conversation(owner);
    const message = await runtime.createRuntimeMessage({
      ownerId: owner,
      conversationId: conv.id,
      role: "user",
      content: "do it later",
    });
    return runtime.createExecutionProposal({
      ownerId: owner,
      conversationId: conv.id,
      ...(input.runId ? { runId: input.runId } : {}),
      sourceMessageId: message.id,
      intentType: "durable_run",
      capability: input.capability === undefined ? "notify" : input.capability,
      inputs: { recipientId: owner, purpose: "standing", title: "t", body: "b" },
      missingInputs: input.missingInputs ?? [],
      risk: input.risk ?? "low",
      targetReferences: [],
      referenceResolution: { status: "not_requested" } as never,
    });
  }

  // ── 1. THE RULE AS IT WAS, UNCHANGED ───────────────────────────────────────

  it("a low-risk act a person is watching still proceeds", async () => {
    const ordinary = await run();
    const proposal = await propose({ runId: ordinary.id, risk: "low" });
    expect(proposal.policyDecision).toBe("allow");
    expect(proposal.approvalRequired).toBe(false);
  });

  it("a high-risk act still asks, standing or not", async () => {
    const ordinary = await run();
    const watched = await propose({ runId: ordinary.id, risk: "high" });
    expect(watched.approvalRequired).toBe(true);

    const later = await run();
    await triggerNaming(later.id);
    const standing = await propose({ runId: later.id, risk: "high" });
    expect(standing.approvalRequired).toBe(true);
  });

  // ── 2. THE GAP ─────────────────────────────────────────────────────────────

  it("the SAME low-risk act, on a run a trigger names, asks first", async () => {
    //   A STANDING ACT IS NOT A WATCHED ACT
    const later = await run();
    await triggerNaming(later.id);
    const proposal = await propose({ runId: later.id, risk: "low" });
    expect(proposal.policyDecision).toBe("require_approval");
    expect(proposal.approvalRequired).toBe(true);
    expect(proposal.status).toBe("awaiting_approval");
  });

  it("and so does one whose risk is none at all", async () => {
    const later = await run();
    await triggerNaming(later.id);
    const proposal = await propose({ runId: later.id, risk: "none" });
    expect(proposal.approvalRequired).toBe(true);
  });

  // ── 3. WHOSE TRIGGER, AND WHICH RUN ────────────────────────────────────────

  it("a trigger that names a DIFFERENT run leaves this one watched", async () => {
    const mine = await run();
    const unrelated = await run();
    await triggerNaming(unrelated.id);
    const proposal = await propose({ runId: mine.id, risk: "low" });
    expect(proposal.approvalRequired).toBe(false);
  });

  it("a trigger owned by somebody else does not make your run standing", async () => {
    //   The same scoping the wake uses. Somebody else's row is not evidence
    //   about your run — and if it were, the only effect would be to ask more
    //   often, never less.
    const mine = await run();
    await triggerNaming(mine.id, OTHER);
    const proposal = await propose({ runId: mine.id, risk: "low" });
    expect(proposal.approvalRequired).toBe(false);
  });

  it("an act with no run at all is judged exactly as before", async () => {
    const proposal = await propose({ risk: "low" });
    expect(proposal.approvalRequired).toBe(false);
  });

  // ── 4. IT NEVER LOOSENS ────────────────────────────────────────────────────

  it("standing never turns a refusal into a request", async () => {
    const later = await run();
    await triggerNaming(later.id);

    // Nothing to run at all is still denied, not «ask them about it».
    const denied = await propose({ runId: later.id, capability: null, risk: "low" });
    expect(denied.policyDecision).toBe("deny");
    expect(denied.status).toBe("blocked");

    // Missing inputs still ask for the inputs, not for approval of a gap.
    const needsInput = await propose({
      runId: later.id,
      missingInputs: ["recipientId"],
      risk: "low",
    });
    expect(needsInput.policyDecision).toBe("require_input");
    expect(needsInput.status).toBe("awaiting_input");
  });

  // ── 5. ONE FACT, ONE PLACE ─────────────────────────────────────────────────

  it("standing is read from the same evidence the wake reads", () => {
    //   A RUN A TRIGGER NAMES IS A STANDING RUN
    const source = readFileSync("api/runtime/jasim-runtime.ts", "utf8");
    const helper = source.slice(source.indexOf("async function runIsStanding"));
    const body = helper.slice(0, helper.indexOf("\n}"));
    expect(body).toContain("temporalTriggers.runId");
    expect(body).toContain("temporalTriggers.ownerId");
    // Canonical state, not a column somebody has to remember to set.
    expect(source).not.toMatch(/runs\.isStanding|standing:\s*true/);
  });

  it("no domain decides who must ask", () => {
    const source = readFileSync("api/runtime/jasim-runtime.ts", "utf8");
    // The helper's CODE, comments stripped: the rule must not know what kind
    // of act it is gating.
    const helper = source.slice(source.indexOf("async function runIsStanding"));
    const body = helper
      .slice(0, helper.indexOf("\n}"))
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const word of ["payment", "purchase", "stock", "price", "vehicle", "invoice"]) {
      expect(body, word).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
    }
  });
});
