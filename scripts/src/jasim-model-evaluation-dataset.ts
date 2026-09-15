import type { ModelTaskProfile, ModelTier } from "../../canonical/جاسم/app/api/runtime/model-policy";

export type JasimModelEvaluationCase = {
  id: string;
  language: "ar" | "gulf-ar" | "en" | "mixed";
  category: string;
  expectedTier: ModelTier;
  profile: ModelTaskProfile;
};

const normal = {
  complexity: 0.3, ambiguity: 0.15, novelty: 0.15, estimatedContextSize: 1200,
  requiresStructuredOutput: true, requiresTools: false, requiresVision: false,
  structuralMutation: false, worldGeneration: false, userFacing: true,
  latencySensitivity: "high" as const, qualityRequirement: "standard" as const,
  previousTierFailure: false, previousPlanFailure: false, escalationCount: 0, deterministic: false,
};

/** Representative routing data; it evaluates policy selection, not invented model quality. */
export const JASIM_MODEL_EVALUATION_SET: JasimModelEvaluationCase[] = [
  { id: "ar-qa", language: "ar", category: "normal chat", expectedTier: "T1", profile: { ...normal, purpose: "CONVERSATION" } },
  { id: "gulf-qa", language: "gulf-ar", category: "Kuwaiti/Gulf Arabic", expectedTier: "T1", profile: { ...normal, purpose: "CONVERSATION" } },
  { id: "en-writing", language: "en", category: "writing", expectedTier: "T1", profile: { ...normal, purpose: "CONVERSATION" } },
  { id: "mixed-translation", language: "mixed", category: "translation", expectedTier: "T1", profile: { ...normal, purpose: "CONVERSATION" } },
  { id: "summary", language: "ar", category: "summary", expectedTier: "T1", profile: { ...normal, purpose: "CONVERSATION_SUMMARY", userFacing: false, latencySensitivity: "low" } },
  { id: "routing", language: "ar", category: "routing", expectedTier: "T1", profile: { ...normal, purpose: "OUTPUT_ROUTING" } },
  { id: "references", language: "mixed", category: "reference interpretation", expectedTier: "T1", profile: { ...normal, purpose: "OUTPUT_ROUTING", ambiguity: 0.55 } },
  { id: "memory", language: "ar", category: "memory extraction", expectedTier: "T1", profile: { ...normal, purpose: "MEMORY_EXTRACTION", userFacing: false, latencySensitivity: "low" } },
  { id: "research", language: "ar", category: "research synthesis", expectedTier: "T2", profile: { ...normal, purpose: "RESEARCH_SYNTHESIS", complexity: 0.65, userFacing: false, latencySensitivity: "normal" } },
  { id: "simple-plan", language: "en", category: "simple plan", expectedTier: "T2", profile: { ...normal, purpose: "TASK_PLANNING", complexity: 0.6, userFacing: false, latencySensitivity: "normal" } },
  { id: "bubble", language: "ar", category: "Bubble mutation", expectedTier: "T2", profile: { ...normal, purpose: "BUBBLE_MUTATION", complexity: 0.62, structuralMutation: true, userFacing: false, latencySensitivity: "normal" } },
  { id: "policy", language: "mixed", category: "policy reasoning", expectedTier: "T2", profile: { ...normal, purpose: "TASK_PLANNING", complexity: 0.8, policyCount: 3, workflowDepth: 5, userFacing: false, latencySensitivity: "normal" } },
  { id: "world", language: "ar", category: "World generation", expectedTier: "T3", profile: { ...normal, purpose: "WORLD_GENERATION", complexity: 0.9, novelty: 0.9, worldGeneration: true, userFacing: false, latencySensitivity: "low", qualityRequirement: "deep" } },
  { id: "novel-system", language: "en", category: "novel business system", expectedTier: "T3", profile: { ...normal, purpose: "TASK_PLANNING", complexity: 0.9, novelty: 0.9, workflowDepth: 8, policyCount: 5, userFacing: false, latencySensitivity: "low", qualityRequirement: "deep" } },
  { id: "recovery", language: "mixed", category: "recovery/replanning", expectedTier: "T2", profile: { ...normal, purpose: "RECOVERY", complexity: 0.75, previousTierFailure: true, priorTier: "T1", userFacing: false, latencySensitivity: "normal" } },
  { id: "adversarial", language: "ar", category: "adversarial policy reasoning", expectedTier: "T2", profile: { ...normal, purpose: "TASK_PLANNING", complexity: 0.78, ambiguity: 0.78, userFacing: false, latencySensitivity: "normal" } },
];