import { describe, expect, it } from "vitest";
import {
  COMPENSATION_AUTHORITY_KEYS,
  DEFAULT_COMPENSATION_POLICY,
  planCompensation,
  recoveryOutcome,
  resolveCompensationPolicy,
  safeCompensationOrder,
  type ExecutedStep,
} from "../../api/runtime/compensation-policy";
import {
  AUTHORITY_KEYS,
  ModelOutputAuthorityError,
  sanitizeModelStructuredOutput,
} from "../../api/runtime/model-output-trust";
import { capabilityEffectContract } from "../../api/runtime/capability-registry";
import { completionPolicyFor, decideCompletion } from "../../api/runtime/completion-policy";

/**
 * COMPENSATION EVALS — the twelve cases from the brief, deterministic.
 *
 * These measure the POLICY. The end-to-end proof that a compensation runs as a
 * real Run with a real attempt and a real verdict lives in
 * `tests/block31/compensation-recovery.test.ts`, where a database exists.
 */

const ctx = { ownerId: "owner-a", sourceRunId: "run-1" };

function step(overrides: Partial<ExecutedStep> & { nodeKey: string }): ExecutedStep {
  return {
    capabilityId: "generic",
    dependsOn: [],
    effectKind: "MESSAGE_DISPATCH",
    verificationStatus: "VERIFIED",
    attemptId: `attempt-${overrides.nodeKey}`,
    result: {},
    inputs: { recipientId: "r" },
    policy: {
      reversibility: "COMPENSATABLE",
      compensationCapabilityId: "compensator",
      deriveInputs: () => ({ recipientId: "r" }),
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("C-01 — fully reversible two-step workflow", () => {
  it("both verified effects are planned for compensation, in safe order", () => {
    const plan = planCompensation({
      steps: [step({ nodeKey: "A" }), step({ nodeKey: "B", dependsOn: ["A"] })],
      context: ctx,
    });
    expect(plan.executable.map((r) => r.sourceNodeKey)).toEqual(["B", "A"]);
    expect(plan.manualInterventionRequired).toHaveLength(0);
  });

  it("order comes from the dependency graph, not from execution order", () => {
    // A diamond: D depends on B and C, which both depend on A. Reverse
    // execution order and reverse topological order differ here, and only the
    // second is safe.
    const steps = [
      step({ nodeKey: "A" }),
      step({ nodeKey: "B", dependsOn: ["A"] }),
      step({ nodeKey: "C", dependsOn: ["A"] }),
      step({ nodeKey: "D", dependsOn: ["B", "C"] }),
    ];
    const order = safeCompensationOrder(steps);
    expect(order[0]).toBe("D");
    expect(order[order.length - 1]).toBe("A");
    // Every node precedes its own upstreams in the compensation order.
    const position = new Map(order.map((key, index) => [key, index]));
    for (const entry of steps) {
      for (const upstream of entry.dependsOn) {
        expect(position.get(entry.nodeKey)!, `${entry.nodeKey} before ${upstream}`)
          .toBeLessThan(position.get(upstream)!);
      }
    }
  });
});

describe("C-02 — first effect verified, second fails", () => {
  it("the verified effect is compensated and the failed one is not", () => {
    const plan = planCompensation({
      steps: [
        step({ nodeKey: "A" }),
        step({ nodeKey: "B", dependsOn: ["A"], verificationStatus: "FAILED" }),
      ],
      context: ctx,
    });
    expect(plan.executable.map((r) => r.sourceNodeKey)).toEqual(["A"]);
    const skipped = plan.requirements.find((r) => r.sourceNodeKey === "B")!;
    expect(skipped.decision).toBe("SKIP");
    expect(skipped.reasonCode).toBe("EFFECT_NOT_VERIFIED");
  });
});

describe("C-03 — compensation verified successfully", () => {
  it("recovery is complete only when every compensation verified", () => {
    const plan = planCompensation({ steps: [step({ nodeKey: "A" })], context: ctx });
    expect(
      recoveryOutcome({ plan, compensationVerdicts: new Map([["A", "VERIFIED"]]) }).outcome,
    ).toBe("RECOVERY_COMPLETE");
  });
});

describe("C-04 — compensation provider reports success but the effect is not verified", () => {
  it("a PENDING compensation is RECOVERY_INCOMPLETE, never complete", () => {
    // The whole point: a compensation is an effect, so the same completion
    // policy applies. A provider's 200 is not a verified deletion.
    const plan = planCompensation({ steps: [step({ nodeKey: "A" })], context: ctx });
    const verdict = recoveryOutcome({ plan, compensationVerdicts: new Map([["A", "PENDING"]]) });
    expect(verdict.outcome).toBe("RECOVERY_INCOMPLETE");
    expect(verdict.unresolved.join(" ")).toContain("COMPENSATION_PENDING");
  });

  it("the completion policy refuses a compensation confirmed only by the executor", () => {
    expect(
      decideCompletion({
        policy: completionPolicyFor("REMOTE_MUTATION"),
        outputShapeValid: true,
        assertions: [{ state: "OCCURRED", source: "EXECUTOR_RETURN" }],
      }).decision,
    ).toBe("PENDING");
  });
});

describe("C-05 — compensation timeout → INCONCLUSIVE", () => {
  it("an inconclusive compensation leaves recovery incomplete and unresolved", () => {
    const plan = planCompensation({ steps: [step({ nodeKey: "A" })], context: ctx });
    const verdict = recoveryOutcome({ plan, compensationVerdicts: new Map([["A", "INCONCLUSIVE"]]) });
    expect(verdict.outcome).toBe("RECOVERY_INCOMPLETE");
    expect(verdict.unresolved.join(" ")).toContain("COMPENSATION_INCONCLUSIVE");
  });

  it("an UNCERTAIN original effect is never compensated blindly", () => {
    // Compensating something that may not have happened causes a second,
    // opposite error — refunding an uncaptured payment, cancelling a booking
    // that was never made. Uncertainty forbids compensation exactly as it
    // forbids retry.
    for (const uncertain of ["INCONCLUSIVE", "PENDING"] as const) {
      const plan = planCompensation({
        steps: [step({ nodeKey: "A", verificationStatus: uncertain })],
        context: ctx,
      });
      expect(plan.executable, uncertain).toHaveLength(0);
      expect(plan.requirements[0]!.decision, uncertain).toBe("MANUAL_INTERVENTION_REQUIRED");
      expect(plan.requirements[0]!.reasonCode, uncertain).toBe(
        "EFFECT_UNCERTAIN_COMPENSATION_UNSAFE",
      );
    }
  });
});

describe("C-06 — irreversible effect", () => {
  it("is never attempted, and never reported as recovered", () => {
    const plan = planCompensation({
      steps: [step({ nodeKey: "A", policy: { reversibility: "IRREVERSIBLE" } })],
      context: ctx,
    });
    expect(plan.executable).toHaveLength(0);
    expect(
      recoveryOutcome({ plan, compensationVerdicts: new Map() }).outcome,
    ).toBe("MANUAL_INTERVENTION_REQUIRED");
  });

  it("an effectful capability that declares nothing is irreversible, not skipped", () => {
    // Fail closed: forgetting produces "a person must look at this", never a
    // silent assumption that nothing needs doing.
    expect(DEFAULT_COMPENSATION_POLICY.reversibility).toBe("IRREVERSIBLE");
    expect(resolveCompensationPolicy("REMOTE_MUTATION").reversibility).toBe("IRREVERSIBLE");
    expect(resolveCompensationPolicy("NONE").reversibility).toBe("NO_COMPENSATION_REQUIRED");
  });

  it("a partially compensatable effect never reports full recovery", () => {
    const plan = planCompensation({
      steps: [
        step({
          nodeKey: "A",
          policy: {
            reversibility: "PARTIALLY_COMPENSATABLE",
            compensationCapabilityId: "compensator",
            residualNote: "part of this cannot be offset",
            deriveInputs: () => ({ recipientId: "r" }),
          },
        }),
      ],
      context: ctx,
    });
    // Even with the compensation VERIFIED, recovery is incomplete.
    expect(
      recoveryOutcome({ plan, compensationVerdicts: new Map([["A", "VERIFIED"]]) }).outcome,
    ).toBe("RECOVERY_INCOMPLETE");
  });
});

describe("C-07 — compensation requires approval", () => {
  it("authority for the original action does not authorize the compensation", () => {
    // The asymmetry that matters: an action costing 5 may carry a cancellation
    // penalty of 200.
    const plan = planCompensation({
      steps: [
        step({
          nodeKey: "A",
          policy: {
            reversibility: "COMPENSATABLE",
            compensationCapabilityId: "compensator",
            requiresApproval: true,
            deriveInputs: () => ({ recipientId: "r" }),
          },
        }),
      ],
      context: ctx,
    });
    expect(plan.requirements[0]!.decision).toBe("APPROVAL_REQUIRED");
    expect(plan.requirements[0]!.reasonCode).toBe("COMPENSATION_REQUIRES_APPROVAL");
    // And it does NOT execute until that approval exists.
    expect(plan.executable).toHaveLength(0);
  });
});

describe("C-08 / C-09 — duplicate attempt and process restart", () => {
  it("planning is pure and repeatable: the same input yields the same plan", () => {
    const steps = [step({ nodeKey: "A" }), step({ nodeKey: "B", dependsOn: ["A"] })];
    const first = planCompensation({ steps, context: ctx });
    const second = planCompensation({ steps, context: ctx });
    expect(JSON.stringify(second.executable.map((r) => r.sourceNodeKey)))
      .toBe(JSON.stringify(first.executable.map((r) => r.sourceNodeKey)));
  });

  it("the compensation run's identity is derived, not generated", () => {
    // `compensation:${runId}` means a restart, a duplicate job delivery and a
    // reconciliation retry all converge on ONE run rather than compensating
    // twice. Asserted at the source because it is the idempotency guarantee.
    const source = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../api/runtime/jasim-runtime.ts"),
      "utf8",
    ) as string;
    expect(source).toContain("idempotencyKey: `compensation:${input.runId}`");
    expect(source).not.toMatch(/idempotencyKey: `compensation:\$\{[^}]*randomUUID/);
  });
});

describe("C-10 — cross-owner compensation injection", () => {
  it("a model may not declare recovery finished", () => {
    for (const key of ["compensationComplete", "refundComplete", "effectReversed", "skipCompensation", "policyOverride"]) {
      expect(() =>
        sanitizeModelStructuredOutput({ label: "x", [key]: true }, { allowKeys: ["label"] }),
        key,
      ).toThrow(ModelOutputAuthorityError);
    }
  });

  it("every recovery authority key is in the runtime's rejection set", () => {
    for (const key of COMPENSATION_AUTHORITY_KEYS) {
      expect(AUTHORITY_KEYS.has(key), key).toBe(true);
    }
  });

  it("compensation is scoped to one run and one owner by construction", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../api/runtime/jasim-runtime.ts"),
      "utf8",
    ) as string;
    const body = source.slice(source.indexOf("export async function compensateFailedRun"));
    // Every read is owner-scoped; the plan cannot reach another owner's run.
    expect(body.slice(0, body.indexOf("\nexport "))).toContain("input.ownerId");
    const reader = source.slice(source.indexOf("async function executedStepsForCompensation"));
    expect(reader.slice(0, reader.indexOf("\n}"))).toContain("ownerId");
  });
});

describe("C-11 — payment compatibility", () => {
  it("the financial model keeps its own stricter path", () => {
    const payout = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../api/runtime/block3/payout.ts"),
      "utf8",
    ) as string;
    // A refund is a new immutable financial effect, and this module recognises
    // that pattern rather than replacing it. Financial truth wins on conflict.
    expect(payout).toContain("payoutReadback");
    expect(payout).toContain("blind retry forbidden");
    const compensation = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../api/runtime/compensation-policy.ts"),
      "utf8",
    ) as string;
    expect(compensation).toMatch(/financial rule\s*\n?\s*\*?\s*wins|financial rule wins/);
    // And the generic module never touches the financial tables. Asserted on
    // CODE, not prose — the module's header names `payouts` in order to say it
    // defers to it, which is the opposite of importing it.
    const compensationCode = compensation
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(compensationCode).not.toContain("payouts");
    expect(compensationCode).not.toContain("paymentIntents");
    expect(compensationCode).not.toContain("@db/schema");
  });
});

describe("C-12 — the original history is never rewritten", () => {
  it("compensation records a new effect and mutates no prior verdict", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../api/runtime/jasim-runtime.ts"),
      "utf8",
    ) as string;
    const body = source.slice(
      source.indexOf("export async function compensateFailedRun"),
    );
    const scoped = body.slice(0, body.indexOf("\nexport ") === -1 ? undefined : body.indexOf("\nexport "));
    // No update to the source run's attempts or nodes: the forward history is
    // read, never rewritten. PAYMENT_CAPTURED stays a fact after REFUND_VERIFIED.
    expect(scoped).not.toContain("update(jasimRuntimeExecutionAttempts)");
    expect(scoped).not.toContain("update(jasimRuntimeDagNodes)");
    expect(scoped).toContain("forwardEffectsPreserved: true");
  });
});

describe("the registered capability carries a real compensation policy", () => {
  it("a messaging effect is partially compensatable by a correction, not an undo", () => {
    const contract = capabilityEffectContract("notify");
    expect(contract.compensation.reversibility).toBe("PARTIALLY_COMPENSATABLE");
    // COMPENSATION != INVERSE: the compensating capability is `notify` itself.
    expect(contract.compensation.compensationCapabilityId).toBe("notify");
    expect(contract.compensation.residualNote).toMatch(/unsee|delivered/i);
  });

  it("read-only capabilities need no compensation at all", () => {
    for (const id of ["local-analysis", "local-calculation", "web-research", "image-generation"]) {
      expect(capabilityEffectContract(id).compensation.reversibility, id).toBe(
        "NO_COMPENSATION_REQUIRED",
      );
    }
  });

  it("an unknown capability fails closed on both axes", () => {
    const contract = capabilityEffectContract("nobody-registered-this");
    expect(contract.effectKind).toBe("REMOTE_MUTATION");
    expect(contract.compensation.reversibility).toBe("IRREVERSIBLE");
  });

  it("no domain-specific compensation component exists", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../api/runtime/compensation-policy.ts"),
      "utf8",
    ) as string;
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");

    // The brief's own list of what must not exist: BookingRollback, DriverUndo,
    // HotelCompensation, DoorRollback. The test is on DECLARED IDENTIFIERS,
    // because that is what a domain-specific component actually is.
    const identifiers = [
      ...code.matchAll(/(?:type|interface|const|function|class|enum)\s+([A-Za-z0-9_]+)/g),
    ].map((match) => match[1]!.toLowerCase());
    expect(identifiers.length).toBeGreaterThan(5);
    for (const domain of ["booking", "driver", "hotel", "door", "invoice", "payment", "refund"]) {
      for (const identifier of identifiers) {
        expect(identifier, `${identifier} names ${domain}`).not.toContain(domain);
      }
    }

    // "refundcomplete" DOES appear in the code — as an authority key the
    // runtime REFUSES. A word in a rejection list is not a domain component,
    // and conflating the two would have forced the module to stop naming the
    // very claim it exists to reject.
    expect(code).toContain('"refundcomplete"');
    expect(COMPENSATION_AUTHORITY_KEYS.has("refundcomplete")).toBe(true);
  });
});
