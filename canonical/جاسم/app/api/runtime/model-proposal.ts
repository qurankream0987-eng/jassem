import { z } from "zod";
import { inspectModelOutput } from "./model-output-trust";

/**
 * JASIM — Task-specific model output contracts.
 *
 * WHY THIS REPLACES THE BLOCKLIST AS THE PRIMARY CONTROL.
 *
 * Wave 2 shipped `model-output-trust.ts`, which rejects output containing keys
 * named after decisions (`paid`, `verified`, `policyOverride`, …), and said
 * plainly in its own report that a blocklist is incomplete by construction. It
 * is. `settlementConfirmed`, `isCleared`, `overrideReason` — none of those are
 * on the list, and enlarging the list forever is a losing race against a
 * generative system that can name a field anything.
 *
 * The fix is not a longer blocklist. It is to stop accepting fields nobody
 * asked for. Each family of model output has a *semantic contract*: the exact
 * set of fields that answer the question that was asked. A classifier answers
 * "which intent"; it does not answer "is this paid". So the contract for a
 * classifier contains no field for that, and `.strict()` makes an extra field a
 * hard parse failure rather than an ignored one.
 *
 * An allowlist is complete by construction in the way a blocklist can never be:
 * the set of things a model may say is finite and written down, so everything
 * outside it — including the field nobody has imagined yet — is refused.
 *
 * THE BLOCKLIST STAYS, AS DEFENCE IN DEPTH. A contract could be written with a
 * mistakenly permissive field; `model-output-trust` is a second, independent
 * check that a declared field is not a smuggled authority claim. Two controls
 * that fail differently are worth more than either alone.
 */

export class ModelProposalRejectedError extends Error {
  readonly code = "MODEL_PROPOSAL_REJECTED";
  readonly family: string;
  readonly reasons: readonly string[];

  constructor(input: { family: string; message: string; reasons: readonly string[] }) {
    super(input.message);
    this.name = "ModelProposalRejectedError";
    this.family = input.family;
    this.reasons = input.reasons;
  }
}

// ── The proposal brand ──────────────────────────────────────────────────────

declare const proposalBrand: unique symbol;

/**
 * A value a model produced. Structurally it is just `T`; nominally it is not,
 * because the brand makes it a type error to hand it to code that expects
 * server-decided state.
 *
 * The brand is the part that survives a refactor. Comments asking the next
 * author to remember that a value is untrusted are advice; a type that will not
 * compile is a control. Unwrapping is deliberately awkward and named
 * (`decideFromProposal`) so that the moment a proposal becomes a decision is a
 * visible line of code with a stated reason, rather than an assignment.
 */
export type ModelProposal<T> = T & { readonly [proposalBrand]: "MODEL_PROPOSAL" };

/**
 * Converts a proposal into ordinary data, at a point where the server has
 * decided to act on it. `rationale` is required because an unexplained unwrap is
 * the exact thing this type exists to make visible in review.
 */
export function decideFromProposal<T>(proposal: ModelProposal<T>, rationale: string): T {
  if (!rationale.trim()) {
    throw new ModelProposalRejectedError({
      family: "unknown",
      message: "A model proposal cannot be accepted without a stated rationale.",
      reasons: ["MISSING_RATIONALE"],
    });
  }
  return proposal as T;
}

// ── The contracts ───────────────────────────────────────────────────────────

const confidence = z.number().min(0).max(1);

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A plan-local identifier: unique within one proposal and meaningless outside
 * it. The UUID exclusion is the substantive part. `[A-Za-z0-9_-]` happily admits
 * a UUID, so without it a model could write a canonical row id into a field
 * documented as local and any code that later treated the two alike would be
 * dereferencing a model's guess.
 */
const planLocalId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,40}$/)
  .refine((value) => !UUID_SHAPE.test(value), {
    message: "a plan-local id must not have the shape of a canonical identifier",
  });
/**
 * Reference keys are opaque handles the server minted and handed to the model in
 * the prompt. Constraining the shape means a model cannot return a canonical
 * row id here by writing it where a handle belongs.
 */
const referenceKey = z.string().regex(/^[a-zA-Z0-9_:-]{1,80}$/);

/** "What kind of thing is the user asking for?" — a label and nothing else. */
export const IntentClassificationSchema = z
  .object({
    intent: z.enum([
      "INFORMATION",
      "TRACKING",
      "COMPARISON",
      "MONITORING",
      "ACTION_REQUEST",
      "CLARIFICATION_ANSWER",
      "UNKNOWN",
    ]),
    confidence,
    reasoning: z.string().max(400).optional(),
  })
  .strict();

/** "Which of the things I showed you does 'the second one' mean?" */
export const ReferenceProposalSchema = z
  .object({
    referenceKeys: z.array(referenceKey).max(20),
    interpretation: z.enum(["SINGLE", "MULTIPLE", "AMBIGUOUS", "NONE"]),
    confidence,
  })
  .strict();

/** "What steps would accomplish this?" — advisory metadata, never execution. */
export const PlanningProposalSchema = z
  .object({
    summary: z.string().min(1).max(1000),
    steps: z
      .array(
        z
          .object({
            localId: planLocalId,
            description: z.string().min(1).max(600),
            capability: z.string().min(1).max(80),
            dependsOn: z.array(planLocalId).max(20).default([]),
            risk: z.enum(["none", "low", "medium", "high", "critical"]),
            // A model may RAISE the approval requirement and never lower it —
            // see `mergeApprovalRequirement`. The literal makes that structural.
            proposesApproval: z.literal(true).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    unresolved: z.array(z.string().min(1).max(300)).max(20).default([]),
  })
  .strict();

/** "Compare the second and the fourth." */
export const ComparisonRequestSchema = z
  .object({
    referenceKeys: z.array(referenceKey).min(2).max(10),
    dimensions: z.array(z.string().min(1).max(60)).max(12).default([]),
    requiresFreshData: z.boolean().default(false),
    confidence,
  })
  .strict();

/** "Watch the price of the fourth one." */
export const MonitoringProposalSchema = z
  .object({
    referenceKey,
    attribute: z.string().min(1).max(60),
    // A *proposed* cadence. The server decides what it will actually poll, and
    // how often, against its own provider and cost policy.
    suggestedIntervalSeconds: z.number().int().min(60).max(86_400).optional(),
    condition: z
      .object({
        comparator: z.enum(["BELOW", "ABOVE", "CHANGES", "EQUALS"]),
        value: z.union([z.number(), z.string().max(80)]).optional(),
      })
      .strict()
      .optional(),
    confidence,
  })
  .strict();

/**
 * "How should this be shown?" — a *hint*, deliberately coarse.
 *
 * It names an information shape, never a primitive. Wave 1.2 established that
 * `decidePresentation` is the only thing that chooses a primitive, and that a
 * client or a model naming one is just data. This contract keeps that true at
 * the type level: there is no field here in which the word `APPROVAL` could be
 * written.
 */
export const PresentationIntentSchema = z
  .object({
    informationShape: z.enum([
      "SINGLE_FACT",
      "LIST",
      "COMPARISON",
      "LOCATION",
      "PROGRESS",
      "EXPLANATION",
      "QUESTION_TO_USER",
    ]),
    itemCount: z.number().int().min(0).max(500).optional(),
    confidence,
  })
  .strict();

export const MODEL_PROPOSAL_CONTRACTS = {
  intent_classification: IntentClassificationSchema,
  reference_proposal: ReferenceProposalSchema,
  planning_proposal: PlanningProposalSchema,
  comparison_request: ComparisonRequestSchema,
  monitoring_proposal: MonitoringProposalSchema,
  presentation_intent: PresentationIntentSchema,
} as const;

export type ModelProposalFamily = keyof typeof MODEL_PROPOSAL_CONTRACTS;
export type ModelProposalOf<F extends ModelProposalFamily> = z.infer<
  (typeof MODEL_PROPOSAL_CONTRACTS)[F]
>;

/**
 * The single entry point for turning model text into a typed proposal.
 *
 * Order matters and is not arbitrary:
 *   1. JSON parse — a model that returned prose has not answered.
 *   2. The family contract — `.strict()` at every level, so an undeclared field
 *      is a rejection rather than a silent drop. This is the control.
 *   3. The authority inspector — defence in depth over the *declared* fields,
 *      in case a contract is ever written too permissively.
 */
export function parseModelProposal<F extends ModelProposalFamily>(
  family: F,
  rawText: string,
): ModelProposal<ModelProposalOf<F>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch {
    throw new ModelProposalRejectedError({
      family,
      message: `MODEL_PROPOSAL_REJECTED: ${family} output was not valid JSON. Nothing was stored.`,
      reasons: ["INVALID_JSON"],
    });
  }

  const result = MODEL_PROPOSAL_CONTRACTS[family].safeParse(parsed);
  if (!result.success) {
    const reasons = result.error.issues.map((issue) => {
      const at = issue.path.join(".") || "(root)";
      // Name the undeclared-field case explicitly: it is the one a reviewer
      // most needs to see, and Zod's default wording buries it.
      return issue.code === "unrecognized_keys"
        ? `UNDECLARED_FIELD at ${at}: ${(issue as { keys?: string[] }).keys?.join(", ")}`
        : `${issue.code} at ${at}: ${issue.message}`;
    });
    throw new ModelProposalRejectedError({
      family,
      message:
        `MODEL_PROPOSAL_REJECTED: ${family} output does not match its semantic contract — ` +
        `${reasons.slice(0, 5).join("; ")}. Nothing was stored.`,
      reasons,
    });
  }

  const inspection = inspectModelOutput(result.data);
  if (inspection.authorityViolations.length > 0) {
    throw new ModelProposalRejectedError({
      family,
      message:
        `MODEL_PROPOSAL_REJECTED: ${family} output passed its contract but asserts privileged ` +
        `field(s): ${inspection.authorityViolations.join(", ")}. The contract is too permissive ` +
        "and should be narrowed.",
      reasons: inspection.authorityViolations.map((path) => `AUTHORITY_CLAIM at ${path}`),
    });
  }

  return result.data as ModelProposal<ModelProposalOf<F>>;
}

function stripCodeFence(text: string): string {
  return text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
}

/**
 * Approval is monotonic: a model may ask for more scrutiny, never less.
 *
 * This is why `proposesApproval` is typed `z.literal(true).optional()` rather
 * than a boolean. A boolean would let a model send `false` and, in code that
 * merged naively, lower a server requirement. Here the only two things a
 * proposal can express are "I think this needs approval" and silence, and
 * silence never overrides the server.
 */
export function mergeApprovalRequirement(
  serverRequires: boolean,
  proposesApproval: true | undefined,
): boolean {
  return serverRequires || proposesApproval === true;
}
