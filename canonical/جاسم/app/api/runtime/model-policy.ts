import { z } from "zod";

/**
 * Phase 12 provider-neutral intelligence policy.
 * It selects semantic capability, never execution authority.
 */
export const ModelTierSchema = z.enum(["T0", "T1", "T2", "T3"]);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const ModelProfileSchema = z.object({
  tier: z.enum(["T1", "T2", "T3"]),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(160),
  maxOutputTokens: z.number().int().positive(),
  supportsStructuredOutputs: z.boolean(),
  promptCache: z.enum(["UNSUPPORTED", "IMPLICIT_PROVIDER_CACHE"]),
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

export const ModelPurposeSchema = z.enum([
  "CONVERSATION",
  "OUTPUT_ROUTING",
  "TASK_PLANNING",
  "WORLD_GENERATION",
  "BUBBLE_MUTATION",
  "CONVERSATION_SUMMARY",
  "MEMORY_EXTRACTION",
  "RESEARCH_SYNTHESIS",
  "RECOVERY",
  "VERIFICATION",
  "CAPABILITY_EXECUTION",
]);
export type ModelPurpose = z.infer<typeof ModelPurposeSchema>;

export const ModelTaskProfileSchema = z.object({
  purpose: ModelPurposeSchema,
  complexity: z.number().min(0).max(1).default(0.35),
  ambiguity: z.number().min(0).max(1).default(0.15),
  novelty: z.number().min(0).max(1).default(0.15),
  estimatedContextSize: z.number().int().nonnegative().default(0),
  requiresStructuredOutput: z.boolean().default(true),
  requiresTools: z.boolean().default(false),
  requiresVision: z.boolean().default(false),
  workflowDepth: z.number().int().nonnegative().optional(),
  entityCount: z.number().int().nonnegative().optional(),
  capabilityCount: z.number().int().nonnegative().optional(),
  policyCount: z.number().int().nonnegative().optional(),
  structuralMutation: z.boolean().default(false),
  worldGeneration: z.boolean().default(false),
  userFacing: z.boolean().default(false),
  latencySensitivity: z.enum(["low", "normal", "high"]).default("normal"),
  qualityRequirement: z.enum(["standard", "high", "deep"]).default("standard"),
  previousTierFailure: z.boolean().default(false),
  previousPlanFailure: z.boolean().default(false),
  priorTier: z.enum(["T1", "T2"]).optional(),
  escalationCount: z.number().int().min(0).max(2).default(0),
  deterministic: z.boolean().default(false),
  recommendedMinimumTier: z.enum(["T1", "T2", "T3"]).optional(),
  escalationReason: z.string().max(120).optional(),
});
export type ModelTaskProfile = z.infer<typeof ModelTaskProfileSchema>;

export const ModelBudgetSchema = z.object({
  maxModelCalls: z.number().int().min(0).default(1),
  maxInputTokens: z.number().int().positive().default(16_000),
  maxOutputTokens: z.number().int().positive().default(4_000),
  maxEscalations: z.number().int().min(0).max(2).default(2),
  maxEstimatedCost: z.number().nonnegative().optional(),
  qualityFloor: z.enum(["T1", "T2", "T3"]).default("T1"),
});
export type ModelBudget = z.infer<typeof ModelBudgetSchema>;

export type ModelSelectionDecision = {
  mode: "T0" | "LLM";
  tier: ModelTier;
  maxOutputTokens: number;
  timeoutMs: number;
  cachePolicy: "UNSUPPORTED" | "IMPLICIT_PROVIDER_CACHE";
  escalationAllowed: boolean;
  escalatedFrom?: Exclude<ModelTier, "T0" | "T3">;
  decisionReasons: string[];
};

const tierRank: Record<ModelTier, number> = { T0: 0, T1: 1, T2: 2, T3: 3 };

function maxTier(left: ModelTier, right: ModelTier): ModelTier {
  return tierRank[left] >= tierRank[right] ? left : right;
}

function nextTier(tier: "T1" | "T2"): "T2" | "T3" {
  return tier === "T1" ? "T2" : "T3";
}

function purposeDefault(profile: ModelTaskProfile): ModelTier {
  if (profile.worldGeneration) return "T3";
  if (profile.structuralMutation && profile.complexity >= 0.7) return "T3";
  if (
    profile.purpose === "TASK_PLANNING" ||
    profile.purpose === "RESEARCH_SYNTHESIS" ||
    profile.purpose === "RECOVERY" ||
    profile.purpose === "BUBBLE_MUTATION"
  ) {
    return "T2";
  }
  return "T1";
}

export function selectModelPolicy(
  rawProfile: ModelTaskProfile,
  rawBudget?: Partial<ModelBudget>,
): ModelSelectionDecision {
  const profile = ModelTaskProfileSchema.parse(rawProfile);
  const budget = ModelBudgetSchema.parse(rawBudget ?? {});
  if (profile.deterministic) {
    return {
      mode: "T0",
      tier: "T0",
      maxOutputTokens: 0,
      timeoutMs: 0,
      cachePolicy: "UNSUPPORTED",
      escalationAllowed: false,
      decisionReasons: ["DETERMINISTIC_CALLER_PATH"],
    };
  }

  let tier = purposeDefault(profile);
  const reasons: string[] = [`PURPOSE_${profile.purpose}`];
  if (
    profile.complexity >= 0.68 ||
    profile.ambiguity >= 0.7 ||
    profile.novelty >= 0.72 ||
    (profile.capabilityCount ?? 0) >= 3 ||
    (profile.policyCount ?? 0) >= 3 ||
    (profile.workflowDepth ?? 0) >= 5
  ) {
    tier = maxTier(tier, "T2");
    reasons.push("ADVANCED_TASK_PROFILE");
  }
  if (
    profile.worldGeneration ||
    (profile.structuralMutation && profile.complexity >= 0.8) ||
    (profile.workflowDepth ?? 0) >= 8 ||
    (profile.policyCount ?? 0) >= 5 ||
    (profile.previousTierFailure && profile.previousPlanFailure) ||
    profile.qualityRequirement === "deep"
  ) {
    tier = "T3";
    reasons.push("DEEP_GENERATIVE_PROFILE");
  }
  let escalatedFrom: "T1" | "T2" | undefined;
  if (profile.previousTierFailure) {
    const priorTier = profile.priorTier ?? "T1";
    if (profile.escalationCount >= budget.maxEscalations) {
      throw new Error("MODEL_BUDGET_INSUFFICIENT: maximum intelligence escalations reached.");
    }
    const escalatedTier = nextTier(priorTier);
    if (tierRank[escalatedTier] > tierRank[tier]) tier = escalatedTier;
    escalatedFrom = priorTier;
    reasons.push(`MODEL_INSUFFICIENCY_ESCALATION_FROM_${priorTier}`);
  }
  if (profile.recommendedMinimumTier) {
    tier = maxTier(tier, profile.recommendedMinimumTier);
    reasons.push(`MINIMUM_${profile.recommendedMinimumTier}`);
  }
  if (tierRank[tier] < tierRank[budget.qualityFloor]) {
    tier = budget.qualityFloor;
    reasons.push(`QUALITY_FLOOR_${budget.qualityFloor}`);
  }
  const purposeCeiling =
    profile.purpose === "MEMORY_EXTRACTION" ? 600 :
    profile.purpose === "OUTPUT_ROUTING" ? 2_000 :
    profile.purpose === "CONVERSATION_SUMMARY" ? 1_500 :
    tier === "T3" ? 8_000 :
    tier === "T2" ? 4_000 : 2_500;

  return {
    mode: "LLM",
    tier,
    maxOutputTokens: Math.min(budget.maxOutputTokens, purposeCeiling),
    timeoutMs: tier === "T3" ? 60_000 : 45_000,
    cachePolicy: "UNSUPPORTED",
    escalationAllowed: tier !== "T3" && profile.escalationCount < budget.maxEscalations,
    escalatedFrom,
    decisionReasons: reasons,
  };
}

export function tierFromPurpose(purpose: ModelPurpose): ModelTaskProfile {
  return ModelTaskProfileSchema.parse({
    purpose,
    userFacing: purpose === "CONVERSATION" || purpose === "OUTPUT_ROUTING",
    complexity:
      purpose === "WORLD_GENERATION" ? 0.85 :
      purpose === "BUBBLE_MUTATION" ? 0.62 :
      purpose === "TASK_PLANNING" ? 0.65 : 0.3,
    worldGeneration: purpose === "WORLD_GENERATION",
    structuralMutation: purpose === "BUBBLE_MUTATION",
  });
}
// ── Semantic tier names ─────────────────────────────────────────────────────

/**
 * `T1`/`T2`/`T3` say where a model sits in a ladder; they do not say what the
 * ladder is *for*, and a reader of a plan or a report cannot tell whether T2 is
 * cheap or expensive without reading this file. The semantic names do say it,
 * and they say it without naming a vendor or a model — the whole point of the
 * provider-neutral contract is that JASIM asks for a capability and a
 * deployment decides which model provides it.
 *
 * Both spellings denote exactly the same tier. This is an alias, not a second
 * scale: a second scale would eventually disagree with the first.
 */
export const SemanticModelTierSchema = z.enum([
  "DETERMINISTIC",
  "FAST_CHEAP",
  "BALANCED",
  "STRONG_REASONING",
]);
export type SemanticModelTier = z.infer<typeof SemanticModelTierSchema>;

const semanticByTier: Record<ModelTier, SemanticModelTier> = {
  T0: "DETERMINISTIC",
  T1: "FAST_CHEAP",
  T2: "BALANCED",
  T3: "STRONG_REASONING",
};

const tierBySemantic: Record<SemanticModelTier, ModelTier> = {
  DETERMINISTIC: "T0",
  FAST_CHEAP: "T1",
  BALANCED: "T2",
  STRONG_REASONING: "T3",
};

export function semanticTier(tier: ModelTier): SemanticModelTier {
  return semanticByTier[tier];
}

export function tierFromSemantic(tier: SemanticModelTier): ModelTier {
  return tierBySemantic[tier];
}

/**
 * The cheapest tier that can be expected to satisfy the profile.
 *
 * `selectModelPolicy` already routes this way — every rule in it moves *up* from
 * a purpose default and none moves down — but that intent is spread across a
 * dozen conditions. This states it as one answer a caller or a test can read,
 * and returns the reasons alongside it so a routing decision is never a number
 * without a justification.
 */
export function cheapestSufficientTier(
  profile: ModelTaskProfile,
  budget?: Partial<ModelBudget>,
): { tier: ModelTier; semantic: SemanticModelTier; reasons: string[] } {
  const decision = selectModelPolicy(profile, budget);
  return {
    tier: decision.tier,
    semantic: semanticTier(decision.tier),
    reasons: decision.decisionReasons,
  };
}
