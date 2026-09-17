import { describe, expect, it } from "vitest";
import {
  MODEL_PROPOSAL_CONTRACTS,
  ModelProposalRejectedError,
  decideFromProposal,
  mergeApprovalRequirement,
  parseModelProposal,
  type ModelProposalFamily,
} from "../../api/runtime/model-proposal";

/**
 * WAVE 2.1 PART 4 — allowlisted semantic contracts replace the blocklist as the
 * primary control.
 *
 * The tests below are deliberately exhaustive rather than illustrative. The
 * claim being made is "a model cannot authoritatively set any of these fields,
 * anywhere in the structure" — a claim that one example does not support.
 */

/** A minimal valid payload per family, so injection is the only variable. */
const VALID: Record<ModelProposalFamily, Record<string, unknown>> = {
  intent_classification: { intent: "TRACKING", confidence: 0.9 },
  reference_proposal: {
    referenceKeys: ["ref-1", "ref-2"],
    interpretation: "AMBIGUOUS",
    confidence: 0.8,
  },
  planning_proposal: {
    summary: "Deliver the package",
    steps: [
      {
        localId: "step-1",
        description: "Notify the recipient",
        capability: "notify",
        dependsOn: [],
        risk: "low",
      },
    ],
    unresolved: [],
  },
  comparison_request: {
    referenceKeys: ["ref-2", "ref-4"],
    dimensions: ["price"],
    requiresFreshData: false,
    confidence: 0.7,
  },
  monitoring_proposal: {
    referenceKey: "ref-4",
    attribute: "price",
    suggestedIntervalSeconds: 3_600,
    confidence: 0.75,
  },
  presentation_intent: { informationShape: "LOCATION", confidence: 0.9 },
};

const FAMILIES = Object.keys(MODEL_PROPOSAL_CONTRACTS) as ModelProposalFamily[];

/** Every field Wave 2.1 named, plus the ones a blocklist would have missed. */
const FORBIDDEN_FIELDS = [
  "ownerId",
  "userId",
  "accountId",
  "paid",
  "verified",
  "settled",
  "approved",
  "policyOverride",
  "providerUrl",
  "handler",
  "executionStatus",
  "paymentStatus",
  "apiKey",
  "credentials",
  "mandate",
  "authorizationScope",
  // Not on any blocklist anywhere. That is the point: an allowlist does not
  // need to have heard of a field to refuse it.
  "settlementConfirmed",
  "isCleared",
  "overrideReason",
  "trustMeBro",
];

describe("PART 4 — every family accepts its own valid output", () => {
  for (const family of FAMILIES) {
    it(`${family} parses a well-formed proposal`, () => {
      const proposal = parseModelProposal(family, JSON.stringify(VALID[family]));
      expect(proposal).toBeTruthy();
    });
  }

  it("tolerates a fenced code block, which models emit constantly", () => {
    const proposal = parseModelProposal(
      "intent_classification",
      "```json\n" + JSON.stringify(VALID.intent_classification) + "\n```",
    );
    expect(proposal.intent).toBe("TRACKING");
  });

  it("rejects prose instead of JSON", () => {
    expect(() => parseModelProposal("intent_classification", "I think it's tracking!")).toThrow(
      /INVALID_JSON|MODEL_PROPOSAL_REJECTED/,
    );
  });
});

describe("PART 4 — a privileged field is refused at the ROOT of every family", () => {
  for (const family of FAMILIES) {
    for (const field of FORBIDDEN_FIELDS) {
      it(`${family} rejects a root-level "${field}"`, () => {
        const payload = { ...VALID[family], [field]: true };
        expect(() => parseModelProposal(family, JSON.stringify(payload))).toThrow(
          ModelProposalRejectedError,
        );
      });
    }
  }
});

describe("PART 4 — a privileged field is refused inside NESTED objects", () => {
  for (const field of FORBIDDEN_FIELDS) {
    it(`planning_proposal rejects "${field}" inside a step`, () => {
      const payload = structuredClone(VALID.planning_proposal);
      (payload.steps as Array<Record<string, unknown>>)[0]![field] = "smuggled";
      expect(() => parseModelProposal("planning_proposal", JSON.stringify(payload))).toThrow(
        ModelProposalRejectedError,
      );
    });

    it(`monitoring_proposal rejects "${field}" inside the condition object`, () => {
      const payload = {
        ...VALID.monitoring_proposal,
        condition: { comparator: "BELOW", value: 10, [field]: "smuggled" },
      };
      expect(() => parseModelProposal("monitoring_proposal", JSON.stringify(payload))).toThrow(
        ModelProposalRejectedError,
      );
    });
  }
});

describe("PART 4 — a privileged field is refused inside ARRAYS", () => {
  it("rejects an object smuggled into a string array", () => {
    const payload = {
      ...VALID.comparison_request,
      dimensions: ["price", { paid: true }],
    };
    expect(() => parseModelProposal("comparison_request", JSON.stringify(payload))).toThrow(
      ModelProposalRejectedError,
    );
  });

  it("rejects an object smuggled into a reference key array", () => {
    const payload = {
      ...VALID.reference_proposal,
      referenceKeys: ["ref-1", { ownerId: "someone-else" }],
    };
    expect(() => parseModelProposal("reference_proposal", JSON.stringify(payload))).toThrow(
      ModelProposalRejectedError,
    );
  });

  it("rejects a second step that carries an authority field", () => {
    const payload = structuredClone(VALID.planning_proposal);
    (payload.steps as unknown[]).push({
      localId: "step-2",
      description: "Charge the customer",
      capability: "payment",
      dependsOn: ["step-1"],
      risk: "critical",
      paymentStatus: "SETTLED",
    });
    expect(() => parseModelProposal("planning_proposal", JSON.stringify(payload))).toThrow(
      ModelProposalRejectedError,
    );
  });
});

describe("PART 4 — the rejection explains itself", () => {
  it("names the undeclared field and where it was", () => {
    const payload = structuredClone(VALID.planning_proposal);
    (payload.steps as Array<Record<string, unknown>>)[0]!.policyOverride = true;
    try {
      parseModelProposal("planning_proposal", JSON.stringify(payload));
      expect.unreachable("should have thrown");
    } catch (error) {
      const typed = error as ModelProposalRejectedError;
      expect(typed.code).toBe("MODEL_PROPOSAL_REJECTED");
      expect(typed.family).toBe("planning_proposal");
      expect(typed.reasons.join(" ")).toContain("UNDECLARED_FIELD");
      expect(typed.reasons.join(" ")).toContain("policyOverride");
      expect(typed.message).toContain("Nothing was stored");
    }
  });
});

describe("PART 4 — canonical identity cannot be written where a handle belongs", () => {
  it("a reference key may look like a UUID, and that is not a hole", () => {
    // Stated so nobody reads the next test and assumes symmetry. Reference keys
    // are handles the SERVER minted and put in the prompt; the resolver looks
    // them up owner-scoped (Wave 1.2), so a made-up one resolves to nothing
    // whatever its shape. Constraining the characters here is hygiene, not the
    // control — the control is that the model's string is a lookup key, never a
    // row identity.
    const payload = {
      ...VALID.reference_proposal,
      referenceKeys: ["3f3f4d1a-0000-4000-8000-000000000000"],
    };
    expect(() => parseModelProposal("reference_proposal", JSON.stringify(payload))).not.toThrow();
  });

  it("refuses a canonical UUID as a plan step id", () => {
    const payload = structuredClone(VALID.planning_proposal);
    (payload.steps as Array<Record<string, unknown>>)[0]!.localId =
      "3f3f4d1a-0000-4000-8000-000000000000";
    expect(() => parseModelProposal("planning_proposal", JSON.stringify(payload))).toThrow(
      ModelProposalRejectedError,
    );
  });

  it("refuses an over-long reference key", () => {
    const payload = { ...VALID.reference_proposal, referenceKeys: ["r".repeat(200)] };
    expect(() => parseModelProposal("reference_proposal", JSON.stringify(payload))).toThrow(
      ModelProposalRejectedError,
    );
  });
});

describe("PART 4 — a model may raise the approval requirement, never lower it", () => {
  it("accepts a proposal asking for approval", () => {
    const payload = structuredClone(VALID.planning_proposal);
    (payload.steps as Array<Record<string, unknown>>)[0]!.proposesApproval = true;
    const proposal = parseModelProposal("planning_proposal", JSON.stringify(payload));
    expect(proposal.steps[0]!.proposesApproval).toBe(true);
  });

  it("refuses a proposal trying to say approval is NOT needed", () => {
    const payload = structuredClone(VALID.planning_proposal);
    (payload.steps as Array<Record<string, unknown>>)[0]!.proposesApproval = false;
    expect(() => parseModelProposal("planning_proposal", JSON.stringify(payload))).toThrow(
      ModelProposalRejectedError,
    );
  });

  it("merges monotonically", () => {
    expect(mergeApprovalRequirement(true, undefined)).toBe(true);
    expect(mergeApprovalRequirement(true, true)).toBe(true);
    expect(mergeApprovalRequirement(false, true)).toBe(true);
    expect(mergeApprovalRequirement(false, undefined)).toBe(false);
  });
});

describe("PART 4 — presentation intent cannot name a primitive", () => {
  it("has no field in which a privileged primitive could be written", () => {
    for (const attempt of [
      { primitive: "APPROVAL" },
      { presentation: "APPROVAL" },
      { informationShape: "APPROVAL" },
    ]) {
      expect(() =>
        parseModelProposal(
          "presentation_intent",
          JSON.stringify({ ...VALID.presentation_intent, ...attempt }),
        ),
      ).toThrow(ModelProposalRejectedError);
    }
  });

  it("names an information shape, which the decision layer is free to ignore", () => {
    const proposal = parseModelProposal(
      "presentation_intent",
      JSON.stringify(VALID.presentation_intent),
    );
    expect(proposal.informationShape).toBe("LOCATION");
    expect(Object.keys(proposal)).toEqual(["informationShape", "confidence"]);
  });
});

describe("PART 4 — the proposal brand makes the trust boundary a compile-time fact", () => {
  it("requires a stated rationale to unwrap", () => {
    const proposal = parseModelProposal("intent_classification", JSON.stringify(VALID.intent_classification));
    expect(() => decideFromProposal(proposal, "   ")).toThrow(ModelProposalRejectedError);
    expect(decideFromProposal(proposal, "server confirmed the intent against a stored binding"))
      .toEqual(VALID.intent_classification);
  });
});
