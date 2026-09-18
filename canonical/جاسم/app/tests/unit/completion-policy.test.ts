import { describe, expect, it } from "vitest";
import {
  COMPLETION_POLICIES,
  applyCompletionDecision,
  completionPolicyFor,
  decideCompletion,
  effectKindFromSideEffects,
  gatherEffectAssertions,
  mayRetryAfter,
  sanitizeEffectDeclaration,
  type EffectAssertion,
  type EffectClaimSource,
  type EffectKind,
} from "../../api/runtime/completion-policy";
import { verifyExecutionAttempt } from "../../api/runtime/execution-verifier";

/**
 * EXECUTION TRUTH CLOSURE.
 *
 *   PROVIDER_RESPONSE  != EFFECT_OCCURRED
 *   RECEIPT            != VERIFICATION
 *   EXECUTED           != VERIFIED
 *   VALID_OUTPUT_SHAPE != REAL_WORLD_COMPLETION
 *
 * The first block below is the gap as it was MEASURED before this layer
 * existed, kept as a permanent regression rather than described in a report.
 */

const attempt = {
  attemptId: "a1",
  runId: "r1",
  nodeId: "n1",
  idempotencyKey: "k1",
  executionStatus: "COMPLETED" as const,
  normalizedError: null,
};

function verify(
  capabilityId: string,
  result: Record<string, unknown>,
  completion?: { effectKind: EffectKind; assertions: readonly EffectAssertion[] },
) {
  return verifyExecutionAttempt({
    ...attempt,
    capabilityId,
    normalizedResult: { result, metadata: { capabilityId } },
    ...(completion ? { completion } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("the gap, as measured on the live path before this layer", () => {
  /**
   * Every row here returned VERIFIED from the real verifier. The notification
   * cases are the sharpest: the runtime called a notification VERIFIED while
   * the notification's own state said it had failed.
   */
  const WAS_WRONGLY_VERIFIED: ReadonlyArray<[string, Record<string, unknown>]> = [
    ["a notification still QUEUED", { kind: "notification-intent", intentId: "i1", state: "QUEUED" }],
    ["a notification a provider merely accepted", { kind: "notification-intent", intentId: "i1", state: "PROVIDER_ACCEPTED" }],
    ["a notification that FAILED", { kind: "notification-intent", intentId: "i1", state: "FAILED" }],
    ["a notification BLOCKED_BY_PROVIDER", { kind: "notification-intent", intentId: "i1", state: "BLOCKED_BY_PROVIDER" }],
    ["a notification whose own channel was INCONCLUSIVE", { kind: "notification-intent", intentId: "i1", state: "INCONCLUSIVE" }],
    ["an unidentified capability returning one junk key", { anything: "at all" }],
    ["an unidentified capability reporting its own failure", { ok: false, error: "device offline" }],
    ["an unidentified capability relaying a human's bare claim", { claimedByProvider: true, evidence: "none" }],
  ];

  it.each(WAS_WRONGLY_VERIFIED)(
    "output-shape verification alone still says VERIFIED for %s",
    (_label, result) => {
      // Unchanged and deliberately so: this file's other half is still a
      // correct output verifier. The point is that it is only that.
      expect(verify("some-capability", result).status).toBe("VERIFIED");
    },
  );

  it.each(WAS_WRONGLY_VERIFIED)(
    "an effect contract withholds VERIFIED for %s",
    (_label, result) => {
      // MESSAGE_DISPATCH with nothing asserted: executed, unconfirmed.
      const verdict = verify("some-capability", result, {
        effectKind: "MESSAGE_DISPATCH",
        assertions: [],
      });
      expect(verdict.status).not.toBe("VERIFIED");
      expect(verdict.status).toBe("PENDING");
    },
  );

  it("an unidentified capability resolves to the strictest effect class", () => {
    // Fail-closed: the runtime cannot verify the effect of something it cannot
    // identify, so it must not claim to.
    expect(effectKindFromSideEffects(undefined)).toBe("NONE");
    expect(effectKindFromSideEffects("none")).toBe("NONE");
    expect(effectKindFromSideEffects("local_test")).toBe("NONE");
    expect(effectKindFromSideEffects("external")).toBe("REMOTE_MUTATION");
    expect(effectKindFromSideEffects("external", "MESSAGE_DISPATCH")).toBe("MESSAGE_DISPATCH");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PROVIDER_RESPONSE != EFFECT_OCCURRED", () => {
  const EFFECTFUL: readonly EffectKind[] = [
    "INTERNAL_STATE",
    "MESSAGE_DISPATCH",
    "DEVICE_COMMAND",
    "REMOTE_MUTATION",
    "HUMAN_ACTION",
  ];

  it.each(EFFECTFUL)("EXECUTOR_RETURN never verifies a %s effect", (effectKind) => {
    const evaluation = decideCompletion({
      policy: completionPolicyFor(effectKind),
      outputShapeValid: true,
      assertions: [{ state: "OCCURRED", source: "EXECUTOR_RETURN" }],
    });
    expect(evaluation.decision).toBe("PENDING");
    expect(evaluation.reasonCode).toBe("EFFECT_NOT_INDEPENDENTLY_CONFIRMED");
    expect(completionPolicyFor(effectKind).sufficientSources).not.toContain("EXECUTOR_RETURN");
  });

  it("EXECUTOR_RETURN is sufficient for exactly one effect class, and that class has no effect", () => {
    const accepting = (Object.keys(COMPLETION_POLICIES) as EffectKind[]).filter((kind) =>
      COMPLETION_POLICIES[kind].sufficientSources.includes("EXECUTOR_RETURN"),
    );
    expect(accepting).toEqual(["NONE"]);
  });

  it("a pure capability is complete on a valid output, exactly as before", () => {
    const evaluation = decideCompletion({
      policy: completionPolicyFor("NONE"),
      outputShapeValid: true,
      assertions: [],
    });
    expect(evaluation.decision).toBe("VERIFIED");
    expect(evaluation.reasonCode).toBe("NO_EFFECT_TO_VERIFY");
  });
});

describe("RECEIPT != VERIFICATION", () => {
  it("no effect class accepts a bound provider receipt as verification", () => {
    const accepting = (Object.keys(COMPLETION_POLICIES) as EffectKind[]).filter((kind) =>
      COMPLETION_POLICIES[kind].sufficientSources.includes("BOUND_PROVIDER_RECEIPT"),
    );
    expect(accepting).toEqual([]);
  });

  it("a bound receipt leaves a remote mutation executed-but-unverified", () => {
    // This is `payout.ts`'s EXECUTED state, stated for every effect class:
    // the receipt proves the provider is talking about THIS request, and says
    // nothing about whether the request took effect.
    const evaluation = decideCompletion({
      policy: completionPolicyFor("REMOTE_MUTATION"),
      outputShapeValid: true,
      assertions: [{ state: "OCCURRED", source: "BOUND_PROVIDER_RECEIPT", authority: "mcp-provider" }],
    });
    expect(evaluation.decision).toBe("PENDING");
    expect(evaluation.reasonCode).toBe("EFFECT_CLAIM_SOURCE_INSUFFICIENT");
    expect(evaluation.missingEvidence).toContain("INDEPENDENT_READBACK");
  });

  it("an independent readback of the same mutation does verify it", () => {
    const evaluation = decideCompletion({
      policy: completionPolicyFor("REMOTE_MUTATION"),
      outputShapeValid: true,
      assertions: [
        { state: "OCCURRED", source: "BOUND_PROVIDER_RECEIPT" },
        { state: "OCCURRED", source: "INDEPENDENT_READBACK", authority: "provider-api" },
      ],
    });
    expect(evaluation.decision).toBe("VERIFIED");
    expect(evaluation.confirmedBy).toBe("INDEPENDENT_READBACK");
  });
});

describe("a human's claim is a claim", () => {
  it("SELF_REPORTED alone never verifies a human action", () => {
    const evaluation = decideCompletion({
      policy: completionPolicyFor("HUMAN_ACTION"),
      outputShapeValid: true,
      assertions: [{ state: "OCCURRED", source: "SELF_REPORTED", authority: "provider-person" }],
    });
    expect(evaluation.decision).toBe("PENDING");
    expect(evaluation.reasonCode).toBe("EFFECT_CLAIM_SOURCE_INSUFFICIENT");
  });

  it("the owner confirming it does verify it", () => {
    const evaluation = decideCompletion({
      policy: completionPolicyFor("HUMAN_ACTION"),
      outputShapeValid: true,
      assertions: [
        { state: "OCCURRED", source: "SELF_REPORTED", authority: "provider-person" },
        { state: "OCCURRED", source: "OWNER_CONFIRMATION", authority: "owner" },
      ],
    });
    expect(evaluation.decision).toBe("VERIFIED");
    expect(evaluation.confirmedBy).toBe("OWNER_CONFIRMATION");
  });

  it("a party saying its own effect failed is believed, from any source", () => {
    // Trust is asymmetric on purpose: claiming failure costs the claimant,
    // claiming success profits them.
    const sources: readonly EffectClaimSource[] = [
      "EXECUTOR_RETURN",
      "SELF_REPORTED",
      "BOUND_PROVIDER_RECEIPT",
      "INTERNAL_READBACK",
      "INDEPENDENT_READBACK",
      "OWNER_CONFIRMATION",
    ];
    for (const source of sources) {
      const evaluation = decideCompletion({
        policy: completionPolicyFor("DEVICE_COMMAND"),
        outputShapeValid: true,
        assertions: [{ state: "NOT_OCCURRED", source }],
      });
      expect(evaluation.decision, source).toBe("FAILED");
      expect(evaluation.reasonCode, source).toBe("EFFECT_DID_NOT_OCCUR");
    }
  });
});

describe("uncertainty is a finding, not an absence of one", () => {
  it("UNCERTAIN outranks a success claim and demands reconciliation", () => {
    const evaluation = decideCompletion({
      policy: completionPolicyFor("REMOTE_MUTATION"),
      outputShapeValid: true,
      assertions: [
        { state: "OCCURRED", source: "INDEPENDENT_READBACK" },
        { state: "UNCERTAIN", source: "INDEPENDENT_READBACK", notes: ["timed out mid-write"] },
      ],
    });
    expect(evaluation.decision).toBe("INCONCLUSIVE");
    expect(evaluation.reasonCode).toBe("EFFECT_UNCERTAIN_RECONCILIATION_REQUIRED");
  });

  it("every effectful class forbids a blind retry after uncertainty", () => {
    // `payout.ts`: "Uncertain payout requires reconciliation; blind retry
    // forbidden." Said once, for everything, instead of once for money.
    for (const kind of Object.keys(COMPLETION_POLICIES) as EffectKind[]) {
      const evaluation = decideCompletion({
        policy: completionPolicyFor(kind),
        outputShapeValid: true,
        assertions: [{ state: "UNCERTAIN", source: "INDEPENDENT_READBACK" }],
      });
      if (kind === "NONE") {
        // A pure capability has no effect to be uncertain ABOUT, so an
        // UNCERTAIN assertion about one is not information — it is a category
        // error, and the decision ignores it rather than inventing doubt.
        expect(evaluation.decision, kind).toBe("VERIFIED");
        expect(COMPLETION_POLICIES[kind].onUncertain, kind).toBe("RETRY_ALLOWED");
      } else {
        expect(COMPLETION_POLICIES[kind].onUncertain, kind).toBe("RECONCILE_ONLY");
        expect(mayRetryAfter(evaluation), kind).toBe(false);
      }
    }
  });

  it("a verified effect is never retried", () => {
    const evaluation = decideCompletion({
      policy: completionPolicyFor("MESSAGE_DISPATCH"),
      outputShapeValid: true,
      assertions: [{ state: "OCCURRED", source: "INTERNAL_READBACK" }],
    });
    expect(evaluation.decision).toBe("VERIFIED");
    expect(mayRetryAfter(evaluation)).toBe(false);
  });

  it("nothing asserted is PENDING with the requirement stated, not VERIFIED", () => {
    const evaluation = decideCompletion({
      policy: completionPolicyFor("DEVICE_COMMAND"),
      outputShapeValid: true,
      assertions: [],
    });
    expect(evaluation.decision).toBe("PENDING");
    expect(evaluation.reasonCode).toBe("EFFECT_EVIDENCE_ABSENT");
    expect(evaluation.notes.join(" ")).toMatch(/read back/i);
  });

  it("an in-flight effect is distinguished from one nobody has spoken about", () => {
    const evaluation = decideCompletion({
      policy: completionPolicyFor("MESSAGE_DISPATCH"),
      outputShapeValid: true,
      assertions: [{ state: "PENDING", source: "SELF_REPORTED" }],
    });
    expect(evaluation.reasonCode).toBe("EFFECT_STILL_IN_FLIGHT");
  });
});

describe("the layer can only withhold VERIFIED, never grant it", () => {
  it("a failed output stays failed however strong the effect evidence", () => {
    expect(applyCompletionDecision("FAILED", "VERIFIED")).toBe("FAILED");
    expect(applyCompletionDecision("INCONCLUSIVE", "VERIFIED")).toBe("INCONCLUSIVE");
  });

  it("an invalid output envelope is not the completion of anything", () => {
    const evaluation = decideCompletion({
      policy: completionPolicyFor("NONE"),
      outputShapeValid: false,
      assertions: [{ state: "OCCURRED", source: "OWNER_CONFIRMATION" }],
    });
    expect(evaluation.decision).toBe("FAILED");
    expect(evaluation.reasonCode).toBe("OUTPUT_SHAPE_NOT_VALID");
  });

  it("a tampered remote receipt stays INCONCLUSIVE and is not rescued", () => {
    // The pre-existing INCONCLUSIVE from remote evidence must survive an
    // otherwise verifying effect assertion.
    const result = { content: [{ type: "text", text: "x" }] };
    const verdict = verifyExecutionAttempt({
      ...attempt,
      capabilityId: "echo",
      normalizedResult: { result, metadata: { capabilityId: "echo" } },
      remoteEvidence: { resultDigest: "deadbeef", receiptSignature: "0".repeat(64) },
      providerReceiptSecret: "secret",
      completion: {
        effectKind: "REMOTE_MUTATION",
        assertions: [{ state: "OCCURRED", source: "INDEPENDENT_READBACK" }],
      },
    });
    expect(verdict.status).toBe("INCONCLUSIVE");
  });
});

describe("a capability reports what happened; it never grades its own word", () => {
  it("accepts a bare factual lifecycle declaration", () => {
    const outcome = sanitizeEffectDeclaration({ effect: { state: "OCCURRED", reference: "x1" } });
    expect(outcome).toEqual({ ok: true, declaration: { state: "OCCURRED", reference: "x1" } });
  });

  it.each([
    ["source", { effect: { state: "OCCURRED", source: "INDEPENDENT_READBACK" } }],
    ["claimSource", { effect: { state: "OCCURRED", claimSource: "OWNER_CONFIRMATION" } }],
    ["verified", { effect: { state: "OCCURRED", verified: true } }],
    ["verificationStatus", { effect: { state: "OCCURRED", verificationStatus: "VERIFIED" } }],
    ["sufficientSources", { effect: { state: "OCCURRED", sufficientSources: ["EXECUTOR_RETURN"] } }],
  ])("rejects a payload that tries to declare its own authority via %s", (_key, payload) => {
    const outcome = sanitizeEffectDeclaration(payload);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.violation).toMatch(/authority claim/);
  });

  it("rejects an unrecognised lifecycle value rather than guessing", () => {
    expect(sanitizeEffectDeclaration({ effect: { state: "PROBABLY_FINE" } }).ok).toBe(false);
    expect(sanitizeEffectDeclaration({ effect: ["OCCURRED"] }).ok).toBe(false);
  });

  it("no declaration at all is not a violation", () => {
    expect(sanitizeEffectDeclaration({ kind: "x" })).toEqual({ ok: true, declaration: undefined });
    expect(sanitizeEffectDeclaration(null)).toEqual({ ok: true, declaration: undefined });
  });

  it("a self-certifying payload becomes UNCERTAIN, and the attempt is not verified", async () => {
    const gathered = await gatherEffectAssertions(
      { effectKind: "REMOTE_MUTATION", effectEvidenceSource: "INDEPENDENT_READBACK" },
      {
        ownerId: "o", capabilityId: "sneaky", attemptId: "a", runId: "r", nodeId: "n",
        result: { effect: { state: "OCCURRED", source: "OWNER_CONFIRMATION" } },
      },
    );
    expect(gathered.declarationViolation).toMatch(/authority claim/);
    expect(gathered.assertions).toEqual([
      expect.objectContaining({ state: "UNCERTAIN", source: "EXECUTOR_RETURN" }),
    ]);
    const evaluation = decideCompletion({
      policy: completionPolicyFor("REMOTE_MUTATION"),
      outputShapeValid: true,
      assertions: gathered.assertions,
    });
    expect(evaluation.decision).toBe("INCONCLUSIVE");
  });

  it("a declaration's weight comes from registration, not from the payload", async () => {
    // The same payload, registered two ways. Only the registration decides.
    const payload = { effect: { state: "OCCURRED" as const } };
    const context = {
      ownerId: "o", capabilityId: "c", attemptId: "a", runId: "r", nodeId: "n", result: payload,
    };
    const weak = await gatherEffectAssertions({ effectKind: "DEVICE_COMMAND" }, context);
    expect(weak.assertions[0]!.source).toBe("EXECUTOR_RETURN");
    expect(
      decideCompletion({
        policy: completionPolicyFor("DEVICE_COMMAND"),
        outputShapeValid: true,
        assertions: weak.assertions,
      }).decision,
    ).toBe("PENDING");

    const strong = await gatherEffectAssertions(
      { effectKind: "DEVICE_COMMAND", effectEvidenceSource: "INDEPENDENT_READBACK" },
      context,
    );
    expect(strong.assertions[0]!.source).toBe("INDEPENDENT_READBACK");
    expect(
      decideCompletion({
        policy: completionPolicyFor("DEVICE_COMMAND"),
        outputShapeValid: true,
        assertions: strong.assertions,
      }).decision,
    ).toBe("VERIFIED");
  });

  it("a pure capability's payload is not searched for an effect declaration", async () => {
    const gathered = await gatherEffectAssertions(
      { effectKind: "NONE" },
      {
        ownerId: "o", capabilityId: "c", attemptId: "a", runId: "r", nodeId: "n",
        result: { effect: { state: "OCCURRED", verified: true } },
      },
    );
    expect(gathered.assertions).toEqual([]);
    expect(gathered.declarationViolation).toBeUndefined();
  });
});

describe("a resolver that cannot reach its authority has learnt that it does not know", () => {
  it("a thrown resolver becomes UNCERTAIN, never an optimistic assumption", async () => {
    const gathered = await gatherEffectAssertions(
      {
        effectKind: "DEVICE_COMMAND",
        resolveEffect: async () => {
          throw new Error("device registry unreachable");
        },
      },
      { ownerId: "o", capabilityId: "c", attemptId: "a", runId: "r", nodeId: "n", result: {} },
    );
    expect(gathered.assertions).toEqual([
      expect.objectContaining({ state: "UNCERTAIN", source: "EXECUTOR_RETURN" }),
    ]);
    expect(
      decideCompletion({
        policy: completionPolicyFor("DEVICE_COMMAND"),
        outputShapeValid: true,
        assertions: gathered.assertions,
      }).decision,
    ).toBe("INCONCLUSIVE");
  });

  it("a resolver with nothing to say leaves the effect unconfirmed", async () => {
    const gathered = await gatherEffectAssertions(
      { effectKind: "DEVICE_COMMAND", resolveEffect: async () => undefined },
      { ownerId: "o", capabilityId: "c", attemptId: "a", runId: "r", nodeId: "n", result: {} },
    );
    expect(gathered.assertions).toEqual([]);
  });

  it("a resolver's readback is what carries an effect to VERIFIED", async () => {
    const gathered = await gatherEffectAssertions(
      {
        effectKind: "DEVICE_COMMAND",
        resolveEffect: async () => ({
          state: "OCCURRED" as const,
          source: "INDEPENDENT_READBACK" as const,
          authority: "device-api",
        }),
      },
      { ownerId: "o", capabilityId: "c", attemptId: "a", runId: "r", nodeId: "n", result: {} },
    );
    expect(
      decideCompletion({
        policy: completionPolicyFor("DEVICE_COMMAND"),
        outputShapeValid: true,
        assertions: gathered.assertions,
      }).decision,
    ).toBe("VERIFIED");
  });
});

describe("no domain verifiers", () => {
  it("the policy module knows nothing about any subject matter", () => {
    const raw = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../api/runtime/completion-policy.ts"),
      "utf8",
    ) as string;
    // Assert on the CODE, not the prose. The first run of this test failed on
    // a sentence in the module's own header that named four domains in order
    // to say it does not know about them — the same trap UI-1 fell into when
    // assertions matched comment text. Strip comments and string literals, and
    // what is left is what actually executes.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
      .toLowerCase();
    // If a domain ever has to be named here, generality has failed — the
    // 30-example audit's own test for exactly that.
    // "flight" is deliberately absent: `EFFECT_STILL_IN_FLIGHT` is idiomatic
    // English about a message, not a travel domain. "airline" covers the
    // domain without catching the idiom.
    for (const domain of [
      "driver", "hotel", "restaurant", "scaffold", "truck", "airline",
      "doctor", "shipment", "courier", "booking", "invoice",
    ]) {
      expect(code, domain).not.toContain(domain);
    }
    // And the taxonomy itself must survive the same reading.
    expect(code).toContain("remote_mutation");
  });

  it("the taxonomy describes JASIM's relationship to an effect, not the effect's topic", () => {
    expect(Object.keys(COMPLETION_POLICIES).sort()).toEqual([
      "DEVICE_COMMAND",
      "HUMAN_ACTION",
      "INTERNAL_STATE",
      "MESSAGE_DISPATCH",
      "NONE",
      "REMOTE_MUTATION",
    ]);
  });

  it("every policy states what it requires, for a report a person can read", () => {
    for (const kind of Object.keys(COMPLETION_POLICIES) as EffectKind[]) {
      expect(COMPLETION_POLICIES[kind].requirement.length, kind).toBeGreaterThan(40);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("every path that can reach VERIFIED is wired to a completion policy", () => {
  const runtime = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../../api/runtime/jasim-runtime.ts"),
    "utf8",
  ) as string;

  /**
   * The three call sites, traced from `runtime.runsExecute`:
   *
   *   runsExecute → executeApprovedRun → driveRunToCompletion
   *               → executeRuntimeDagNode            (local execution)
   *   remote polling → completeRemoteRuntimeDagNode   (remote completion)
   *   reconcileUncertainAttempt                       (uncertain reconciliation)
   *
   * A fourth would reopen the gap silently, so the count is pinned too.
   */
  it("all three verifier call sites supply an effect contract", () => {
    const calls = runtime.split("verifyExecutionAttempt({").slice(1);
    expect(calls).toHaveLength(3);
    for (const [index, call] of calls.entries()) {
      const args = call.slice(0, call.indexOf("});"));
      expect(args, `call site ${index}`).toContain("completion: {");
      expect(args, `call site ${index}`).toContain("effectKind:");
      expect(args, `call site ${index}`).toContain("assertions:");
    }
  });

  it("each effect kind passed in is resolved from the registry, never hardcoded", () => {
    // A literal `effectKind: "NONE"` at a call site would be a permanent
    // exemption for every capability flowing through it.
    for (const call of runtime.split("verifyExecutionAttempt({").slice(1)) {
      const args = call.slice(0, call.indexOf("});"));
      expect(args).toMatch(/effectKind: \w+(Contract|\.effectKind)/);
      expect(args).not.toMatch(/effectKind: "(NONE|MESSAGE_DISPATCH|REMOTE_MUTATION)"/);
    }
  });

  it("a bound receipt enters as an assertion and never as a verdict", () => {
    // Both remote paths must register the receipt as BOUND_PROVIDER_RECEIPT,
    // which no policy accepts, rather than short-circuiting to success.
    const receipts = runtime.split('source: "BOUND_PROVIDER_RECEIPT"');
    expect(receipts.length - 1).toBe(2);
  });

  it("the independent readback is the only source reconciliation grants itself", () => {
    const reconcile = runtime.slice(runtime.indexOf("export async function reconcileUncertainAttempt"));
    const body = reconcile.slice(0, reconcile.indexOf("\nexport "));
    expect(body).toContain('source: "INDEPENDENT_READBACK"');
    // And a completed DAG node is only an internal readback for the one effect
    // class JASIM actually owns — see the comment at that branch.
    expect(body).toMatch(/effectKind === "INTERNAL_STATE"\s*\n?\s*\?\s*"INTERNAL_READBACK"/);
  });

  it("a PENDING attempt completes its node and withholds the receipt", () => {
    const executor = runtime.slice(runtime.indexOf("export async function executeRuntimeDagNode"));
    const body = executor.slice(0, executor.indexOf("\nexport "));
    expect(body).toContain("verification.status === 'PENDING'");
    expect(body).toContain("EFFECT_AWAITING_CONFIRMATION");
    // PENDING must NOT be routed into the INCONCLUSIVE node-failure branch:
    // the step really did execute, and failing the node would assert that
    // nothing happened when something may well have.
    const pendingAt = body.indexOf("verification.status === 'PENDING'");
    const inconclusiveAt = body.indexOf("verification.status === 'INCONCLUSIVE'");
    expect(pendingAt).toBeGreaterThan(0);
    expect(inconclusiveAt).toBeGreaterThan(pendingAt);
    expect(body.slice(pendingAt, inconclusiveAt)).not.toContain("failRuntimeDagNode");
  });

  it("PENDING is refused as success by the run-level truth helpers", () => {
    const truthfulness = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../api/runtime/truthfulness.ts"),
      "utf8",
    ) as string;
    // One PENDING attempt holds the whole run back, and a receipt is verified
    // only on VERIFIED. Both predate this layer; both are what make PENDING
    // sufficient without a new status.
    expect(truthfulness).toContain('statuses.includes("PENDING")');
    expect(truthfulness).toContain('verificationStatus === "VERIFIED"');
  });
});

describe("the payment truth model is not weakened", () => {
  it("payout still requires an authoritative readback and refuses a blind retry", () => {
    const payout = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../api/runtime/block3/payout.ts"),
      "utf8",
    ) as string;
    // The generic layer is built to AGREE with this file, not to replace it.
    // Money keeps its own stricter path: a payout reaches VERIFIED only inside
    // `reconcilePayout`, only when the readback binds, and never from a receipt.
    expect(payout).toContain("payoutReadback");
    expect(payout).toContain("blind retry forbidden");
    const execute = payout.slice(payout.indexOf("export async function executePayout"));
    expect(execute.slice(0, execute.indexOf("export async function reconcilePayout"))).not.toContain(
      'set({ status: "VERIFIED" })',
    );
  });

  it("the generic policy is no weaker than the payment model on receipts", () => {
    // If a bound receipt ever became sufficient here, the generic path would
    // be a way around the payment rule.
    for (const kind of Object.keys(COMPLETION_POLICIES) as EffectKind[]) {
      if (kind === "NONE") continue;
      expect(COMPLETION_POLICIES[kind].sufficientSources, kind).not.toContain("BOUND_PROVIDER_RECEIPT");
      expect(COMPLETION_POLICIES[kind].sufficientSources, kind).not.toContain("SELF_REPORTED");
    }
  });
});

describe("a refused effect does not complete its node", () => {
  const runtime = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../../api/runtime/jasim-runtime.ts"),
    "utf8",
  ) as string;
  const executor = (() => {
    const from = runtime.indexOf("export async function executeRuntimeDagNode");
    return runtime.slice(from, runtime.indexOf("\nexport ", from + 10));
  })();

  it("a FAILED verdict fails the node instead of completing it", () => {
    // This branch used to be nearly unreachable, so a FAILED attempt fell
    // through to `completeRuntimeDagNode` and dependent nodes could build on
    // it. Now that a refused effect reaches it, that fall-through would be the
    // sharpest form of the bug this phase closes.
    expect(executor).toContain("verification.status === 'FAILED'");
    const failedAt = executor.indexOf("verification.status === 'FAILED'");
    const completeAt = executor.indexOf("return completeRuntimeDagNode(");
    expect(failedAt).toBeGreaterThan(0);
    expect(completeAt).toBeGreaterThan(failedAt);
    expect(executor.slice(failedAt, completeAt)).toContain("failRuntimeDagNode");
  });

  it("FAILED is retryable and INCONCLUSIVE is not, which is the whole point", () => {
    // Nothing happened, so acting again is safe. Something MAY have happened,
    // so it is not. `maxAttempts` still bounds the retryable case.
    const failedBlock = executor.slice(executor.indexOf("verification.status === 'FAILED'"));
    expect(failedBlock.slice(0, failedBlock.indexOf("});"))).toContain('errorCode: "RETRYABLE"');
    const inconclusiveBlock = executor.slice(executor.indexOf("verification.status === 'INCONCLUSIVE'"));
    expect(inconclusiveBlock.slice(0, inconclusiveBlock.indexOf("});"))).toContain('errorCode: "PERMANENT"');
  });

  it("the three outcomes are ordered so none can swallow another", () => {
    const pending = executor.indexOf("verification.status === 'PENDING'");
    const inconclusive = executor.indexOf("verification.status === 'INCONCLUSIVE'");
    const failed = executor.indexOf("verification.status === 'FAILED'");
    const complete = executor.indexOf("return completeRuntimeDagNode(");
    // PENDING records and falls through; INCONCLUSIVE and FAILED both return
    // before the completion call.
    expect(pending).toBeLessThan(inconclusive);
    expect(inconclusive).toBeLessThan(failed);
    expect(failed).toBeLessThan(complete);
  });
});
