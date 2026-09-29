/**
 * «إذا نزل تحت خمسين، جهّز لي طلباً — ولا تنفّذ بدون موافقتي».
 *
 * ── THE DOOR, AND WHY IT COMES LAST ─────────────────────────────────────────
 *
 * Three phases built the chain this opens onto, in this order and deliberately:
 *
 *   1. a condition can become true          (the evaluator was never wired)
 *   2. a fired trigger can wake what it names (the wake knew only clocks)
 *   3. an act nobody is watching asks first  (approval was risk alone)
 *
 * The rule came BEFORE the door on purpose. Opening this first would have made
 * a low-risk standing act execute unattended the moment somebody used it.
 *
 * ── WHAT A STANDING INTENT IS ───────────────────────────────────────────────
 *
 * A run that carries an act and has not started, plus a condition trigger that
 * NAMES that run. Nothing else. No new table, no new job kind, no second
 * proposal system — the act is the same intent shape a turn already produces,
 * and it becomes an ordinary execution proposal when the condition holds.
 *
 *   A RUN A TRIGGER NAMES IS A STANDING RUN
 *
 * That naming is what the approval gate reads, so a standing act cannot reach
 * execution without a person, and it is what the wake reads, so the trigger
 * cannot wake a run it does not name. One fact serving both.
 *
 * ── WHAT FIRING DOES, AND DOES NOT ──────────────────────────────────────────
 *
 *   PREPARING IS NOT DOING
 *
 * When the condition holds, the act is PREPARED: an execution proposal is
 * created, it lands at `awaiting_approval` because the run is standing, and the
 * person is told. Nothing runs. «جهّز» is the whole of what was promised, and
 * it is the whole of what happens.
 *
 *   TARGET / CONDITION != EXECUTION AUTHORITY
 *
 *   PREPARED_ONCE — a condition that holds on three consecutive sweeps has not
 *   asked for three purchases. The act is prepared once per standing run, and
 *   the check is the proposal ledger itself rather than a flag.
 *
 * ── AND IT IS NOT A DOMAIN ──────────────────────────────────────────────────
 *
 * A condition, a capability and its inputs. What the act buys, books, sends or
 * cancels is the act's business.
 *
 *   DOMAIN_STANDING_INTENTS_ADDED = 0
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { executionProposals, runs } from "@db/schema";
import { createTemporalTrigger } from "./block2/temporal";
import { validateCondition } from "./monitoring-runtime";

export class StandingIntentError extends Error {
  readonly code: "INVALID" | "NOT_FOUND";
  constructor(message: string, code: StandingIntentError["code"]) {
    super(message);
    this.code = code;
    this.name = "StandingIntentError";
  }
}

export type StandingIntentInput = {
  ownerId: string;
  conversationId: string;
  /** Who must be able to see the conversation, when it is not the run's owner. */
  conversationPrincipalId?: string;
  goal: string;
  /** The act: one capability and the inputs it will run with. */
  capability: string;
  inputs: Record<string, unknown>;
  /** What must become true. The monitor vocabulary, and no other. */
  subjectKind: string;
  subjectId: string;
  observationType: string;
  when: unknown;
  conditionPollMs?: number;
};

export type StandingIntent = {
  readonly runRef: string;
  readonly triggerRef: string;
  readonly capability: string;
};

/**
 * Park an act behind a condition.
 *
 * The run is created and NOT started: it carries the act and waits to be named
 * by something that has not happened yet. The trigger is written second and on
 * purpose — until it exists the run is an ordinary unstarted run, and the
 * moment it exists the run is standing to every reader at once.
 */
export async function createStandingIntent(
  input: StandingIntentInput,
): Promise<StandingIntent> {
  const capability = input.capability.trim();
  if (!capability) {
    throw new StandingIntentError("A standing act needs something to do.", "INVALID");
  }
  const subjectKind = input.subjectKind.trim();
  const subjectId = input.subjectId.trim();
  const observationType = input.observationType.trim();
  if (!subjectKind || !subjectId || !observationType) {
    throw new StandingIntentError(
      "A condition needs something to be about: «if it drops below fifty» is not a question until something says fifty of what, on which thing.",
      "INVALID",
    );
  }
  // The SAME validation a monitor's condition passes, including the screen for
  // executable text. A condition this runtime cannot read is refused HERE,
  // while somebody is present to be told — rather than becoming a standing
  // intent that quietly answers «unknown» forever.
  //
  //   TWO_CONDITION_LANGUAGES = 0
  let condition;
  try {
    condition = validateCondition(input.when);
  } catch (error) {
    throw new StandingIntentError(
      error instanceof Error ? error.message : "That is not a condition I can read.",
      "INVALID",
    );
  }

  const { createRuntimeRun } = await import("./jasim-runtime");
  const run = await createRuntimeRun({
    ownerId: input.ownerId,
    goal: input.goal,
    idempotencyKey: `standing:${randomUUID()}`,
    conversationId: input.conversationId,
    ...(input.conversationPrincipalId
      ? { conversationPrincipalId: input.conversationPrincipalId }
      : {}),
    // Created, not started. There is no DAG and nothing to drive: the act
    // becomes a proposal when the condition holds, not before.
    status: "created",
    requiredCapabilities: [capability],
    inputs: input.inputs,
  });

  const { trigger } = await createTemporalTrigger(db as never, {
    ownerId: input.ownerId,
    kind: "CONDITION",
    idempotencyKey: `standing:${run.id}`,
    // NAMED ON THE ROW. A run mentioned only inside a continuation payload is
    // not one this trigger may wake, and not one the approval gate counts as
    // standing.
    runId: run.id,
    condition: {
      subjectKind,
      subjectId,
      observationType,
      when: condition as unknown as Record<string, unknown>,
      ...(input.conditionPollMs ? { pollMs: input.conditionPollMs } : {}),
    },
    ...(input.conditionPollMs ? { conditionPollMs: input.conditionPollMs } : {}),
    continuation: { jobKind: "block2.resume_node", jobPayload: { runId: run.id } },
  });

  return { runRef: run.id, triggerRef: trigger.id, capability };
}

/** Has this standing act already been prepared? The ledger says, not a flag. */
async function alreadyPrepared(runId: string, ownerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: executionProposals.id })
    .from(executionProposals)
    .where(and(eq(executionProposals.runId, runId), eq(executionProposals.ownerId, ownerId)))
    .limit(1);
  return Boolean(row);
}

export type PreparationOutcome =
  | { readonly status: "PREPARED"; readonly proposalId: string; readonly approvalRequired: boolean }
  | { readonly status: "ALREADY_PREPARED" }
  | { readonly status: "NOT_A_STANDING_ACT" };

/**
 * The condition held. Prepare the act and ask.
 *
 * This creates an ORDINARY execution proposal. It lands at
 * `awaiting_approval` because the run is standing — that is the rule from the
 * phase before this one doing its work, not a special case written here.
 */
export async function prepareStandingAct(input: {
  runId: string;
  ownerId: string;
}): Promise<PreparationOutcome> {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, input.runId), eq(runs.ownerId, input.ownerId)))
    .limit(1);
  if (!run) return { status: "NOT_A_STANDING_ACT" };

  const capability = (run.requiredCapabilities ?? [])[0];
  const conversationId = run.conversationId;
  // A run with no act and no conversation is not a standing intent; it is some
  // other kind of run this wake has no business preparing.
  if (!capability || !conversationId) return { status: "NOT_A_STANDING_ACT" };

  //   PREPARED_ONCE — a condition that holds on three sweeps has not asked for
  //   three purchases.
  if (await alreadyPrepared(input.runId, input.ownerId)) {
    return { status: "ALREADY_PREPARED" };
  }

  const { createExecutionProposal, createRuntimeMessage } = await import("./jasim-runtime");
  // The act is attributed to a message JASIM writes in the conversation,
  // because a proposal has to come from somewhere a person can read.
  const message = await createRuntimeMessage({
    ownerId: input.ownerId,
    conversationId,
    role: "assistant",
    content: "تحقّق الشرط الذي ذكرتَه، فجهّزتُ ما طلبتَ. لم يُنفَّذ شيء.",
  });

  const proposal = await createExecutionProposal({
    ownerId: input.ownerId,
    conversationId,
    runId: input.runId,
    sourceMessageId: message.id,
    intentType: "durable_run",
    capability,
    inputs: (run.inputs ?? {}) as Record<string, unknown>,
    missingInputs: [],
    // The act's own risk. Standing raises the gate by itself; claiming a risk
    // level here would be this module deciding something that is not its to
    // decide.
    risk: "low",
    targetReferences: [],
    referenceResolution: { status: "not_requested" } as never,
  });

  return {
    status: "PREPARED",
    proposalId: proposal.id,
    approvalRequired: proposal.approvalRequired,
  };
}
