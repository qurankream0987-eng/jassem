/**
 * JASIM Learning Engine — Behavioral Learning & Pattern Adaptation
 *
 * Core Principle: LEARNING = BEHAVIORAL CHANGE OVER TIME
 *
 * - Records successful execution patterns
 * - Retrieves best patterns for goal types
 * - Adapts plans based on past experiences
 * - Scores plan quality from historical outcomes
 * - Learns from failures to avoid repetition
 *
 * CRITICAL RULES:
 * 1. NEVER store without retrieval
 * 2. NEVER retrieve without using the data
 * 3. Patterns must be scored and ranked
 * 4. Memory must INFLUENCE execution
 */

import { z } from "zod";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { db } from "../queries/connection";
import { memoryEntries } from "@db/schema";
import type { MemoryEntry, NewMemoryEntry } from "@db/schema";
import type { PlanNode, DAG, Task } from "@contracts/jasim";
import type { MemoryEngine } from "./cytoplasm";
import { llmRouter } from "./llm-router";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface LearnedPattern {
  id: string;
  goalType: string;
  plan: PlanNode[];
  executionResult: unknown;
  userFeedback: number; // -1 to 1
  score: number; // 0 to 1, computed from success rate
  successCount: number;
  failureCount: number;
  avgExecutionTime: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatternRecord {
  goalType: string;
  planNodes: PlanNode[];
  executionResult: unknown;
  userFeedback: number;
}

export interface PlanScore {
  plan: PlanNode[];
  predictedScore: number;
  factors: {
    historicalSuccess: number;
    complexityPenalty: number;
    riskBonus: number;
    capabilityCoverage: number;
  };
}

export interface FailureRecord {
  taskId: string;
  goalType: string;
  errorType: string;
  errorMessage: string;
  failedStep?: string;
  recoveryStrategy?: string;
  timestamp: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Zod Schemas
// ═══════════════════════════════════════════════════════════════════════════════

const LearnedPatternSchema = z.object({
  id: z.string(),
  goalType: z.string(),
  plan: z.array(z.record(z.unknown())),
  executionResult: z.unknown(),
  userFeedback: z.number().min(-1).max(1),
  score: z.number().min(0).max(1),
  successCount: z.number().default(0),
  failureCount: z.number().default(0),
  avgExecutionTime: z.number().default(0),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
});

const PlanAdaptationSchema = z.object({
  adaptedPlan: z.array(z.record(z.unknown())),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Learning Engine
// ═══════════════════════════════════════════════════════════════════════════════

export class LearningEngine {
  private memoryEngine: MemoryEngine;
  private inMemoryPatterns: Map<string, LearnedPattern[]> = new Map();
  private readonly PATTERN_CATEGORY = "learning_pattern";
  private readonly FAILURE_CATEGORY = "learning_failure";
  private readonly MIN_PATTERN_SCORE = 0.3;
  private readonly SCORE_DECAY = 0.95; // Decay old patterns slightly

  constructor(memoryEngine: MemoryEngine) {
    this.memoryEngine = memoryEngine;
  }

  // ── Record Successful Execution Pattern ────────────────────────────────────

  /**
   * Record a successful execution pattern for future retrieval.
   * Stores in DB AND in-memory cache for fast retrieval.
   */
  async recordPattern(
    goalType: string,
    plan: PlanNode[],
    executionResult: unknown,
    userFeedback: number,
  ): Promise<void> {
    const validatedFeedback = Math.max(-1, Math.min(1, userFeedback));
    const patternId = `pattern_${goalType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const pattern: LearnedPattern = {
      id: patternId,
      goalType,
      plan,
      executionResult,
      userFeedback: validatedFeedback,
      score: this.computeInitialScore(validatedFeedback, executionResult),
      successCount: validatedFeedback > 0 ? 1 : 0,
      failureCount: validatedFeedback < 0 ? 1 : 0,
      avgExecutionTime: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Store in DB via memory engine
    await this.memoryEngine.store({
      scope: "system",
      category: this.PATTERN_CATEGORY as any,
      key: patternId,
      value: pattern as unknown as Record<string, unknown>,
      userId: undefined,
      taskId: undefined,
      entityId: undefined,
      permissions: ["learning:read", "learning:write"],
    });

    // Update in-memory cache
    const existing = this.inMemoryPatterns.get(goalType) ?? [];
    existing.push(pattern);
    this.inMemoryPatterns.set(goalType, existing);

    // Sort by score descending
    this.sortPatterns(goalType);

    console.log(`[LearningEngine] Recorded pattern ${patternId} for goalType=${goalType} score=${pattern.score.toFixed(3)}`);
  }

  // ── Retrieve Best Pattern ──────────────────────────────────────────────────

  /**
   * Get the best learned pattern for a goal type.
   * Returns null if no suitable pattern exists (score < threshold).
   */
  async getBestPattern(goalType: string): Promise<{ plan: PlanNode[]; score: number } | null> {
    // Check in-memory cache first
    const cached = this.inMemoryPatterns.get(goalType);
    if (cached && cached.length > 0) {
      const best = cached[0];
      if (best.score >= this.MIN_PATTERN_SCORE) {
        return { plan: best.plan, score: best.score };
      }
    }

    // Fetch from DB
    const dbPatterns = await this.fetchPatternsFromDB(goalType);
    if (dbPatterns.length === 0) {
      return null;
    }

    // Update cache
    this.inMemoryPatterns.set(goalType, dbPatterns);

    const best = dbPatterns[0];
    if (best.score >= this.MIN_PATTERN_SCORE) {
      return { plan: best.plan, score: best.score };
    }

    return null;
  }

  // ── Adapt Plan Based on Past Experiences ───────────────────────────────────

  /**
   * Adapt a plan using learned patterns and failure records.
   * This is where BEHAVIORAL CHANGE happens.
   */
  async adaptPlan(plan: PlanNode[], goalType: string): Promise<PlanNode[]> {
    const patterns = this.inMemoryPatterns.get(goalType) ?? await this.fetchPatternsFromDB(goalType);

    if (patterns.length === 0) {
      return plan; // No learning to apply yet
    }

    // Update cache
    this.inMemoryPatterns.set(goalType, patterns);

    // Get failure records for this goal type
    const failures = await this.getFailurePatterns(goalType);

    let adapted = [...plan];
    let modifications: string[] = [];

    // 1. Remove/modify steps that historically failed
    for (const failure of failures) {
      if (failure.failedStep) {
        const idx = adapted.findIndex((n) =>
          n.name.toLowerCase().includes(failure.failedStep!.toLowerCase()) ||
          n.capability.toLowerCase().includes(failure.failedStep!.toLowerCase())
        );
        if (idx >= 0) {
          // Mark node with failure warning and add fallback
          adapted[idx] = {
            ...adapted[idx],
            metadata: {
              ...adapted[idx].metadata,
              historicalFailures: (adapted[idx].metadata?.historicalFailures as number ?? 0) + 1,
              failureWarning: `This step previously failed: ${failure.errorMessage}`,
              requiresExtraValidation: true,
            },
          };
          modifications.push(`Flagged step "${adapted[idx].name}" due to historical failure`);
        }
      }
    }

    // 2. Reorder steps based on best pattern success order
    const bestPattern = patterns[0];
    if (bestPattern && bestPattern.score > 0.6) {
      const reordered = this.reorderByPattern(adapted, bestPattern.plan);
      if (reordered.length === adapted.length) {
        const orderChanged = reordered.some((n, i) => n.id !== adapted[i].id);
        if (orderChanged) {
          adapted = reordered;
          modifications.push("Reordered steps based on historically successful pattern");
        }
      }
    }

    // 3. Add learned capability substitutions for historically problematic caps
    const problematicCaps = this.identifyProblematicCapabilities(failures);
    for (let i = 0; i < adapted.length; i++) {
      const node = adapted[i];
      const capLower = node.capability.toLowerCase();
      if (problematicCaps.has(capLower)) {
        const alternative = this.findAlternativeCapability(capLower, patterns);
        if (alternative) {
          adapted[i] = {
            ...node,
            metadata: {
              ...node.metadata,
              fallbackCapability: alternative,
              fallbackReason: `Original capability "${node.capability}" had historical failures`,
            },
          };
          modifications.push(`Added fallback "${alternative}" for "${node.capability}"`);
        }
      }
    }

    if (modifications.length > 0) {
      console.log(`[LearningEngine] Adapted plan for goalType=${goalType}: ${modifications.join("; ")}`);
    }

    return adapted;
  }

  // ── Score Plan Quality ─────────────────────────────────────────────────────

  /**
   * Score a plan based on past outcomes of similar plans.
   * Higher score = more likely to succeed.
   */
  async scorePlan(plan: PlanNode[]): Promise<number> {
    const capabilities = plan.map((n) => n.capability.toLowerCase());
    const uniqueCaps = [...new Set(capabilities)];

    // Gather all patterns that share capabilities with this plan
    const allPatterns = await this.getAllPatterns();
    const relevantPatterns = allPatterns.filter((p) =>
      p.plan.some((n) => uniqueCaps.includes(n.capability.toLowerCase()))
    );

    if (relevantPatterns.length === 0) {
      return 0.5; // Neutral score with no history
    }

    // Calculate historical success rate for these capabilities
    let totalSuccess = 0;
    let totalWeight = 0;

    for (const pattern of relevantPatterns) {
      const overlapCount = pattern.plan.filter((n) =>
        uniqueCaps.includes(n.capability.toLowerCase())
      ).length;
      const weight = overlapCount / uniqueCaps.length;
      totalSuccess += pattern.score * weight;
      totalWeight += weight;
    }

    const historicalSuccess = totalWeight > 0 ? totalSuccess / totalWeight : 0.5;

    // Complexity penalty (more steps = harder to execute)
    const complexityPenalty = Math.min(plan.length * 0.03, 0.15);

    // Risk bonus/penalty based on parallelizability
    const parallelSteps = plan.filter((n) => n.parallel).length;
    const parallelRatio = plan.length > 0 ? parallelSteps / plan.length : 0;
    const riskBonus = parallelRatio * 0.1; // Parallel execution is slightly riskier

    // Capability coverage bonus
    const capabilityCoverage = Math.min(uniqueCaps.length / plan.length, 1.0);

    const finalScore = Math.max(0, Math.min(1,
      historicalSuccess - complexityPenalty - riskBonus + (capabilityCoverage * 0.1)
    ));

    console.log(`[LearningEngine] Scored plan: historical=${historicalSuccess.toFixed(3)} complexity=-${complexityPenalty.toFixed(3)} coverage=+${(capabilityCoverage * 0.1).toFixed(3)} final=${finalScore.toFixed(3)}`);

    return finalScore;
  }

  // ── Learn from Failure ─────────────────────────────────────────────────────

  /**
   * Record a failure to avoid repeating it.
   * Updates pattern scores and stores failure context.
   */
  async learnFromFailure(task: Task, error: Error): Promise<void> {
    const goalType = task.intent || "unknown";
    const errorType = this.classifyError(error);
    const failedStep = this.identifyFailedStep(task, error);

    const failureRecord: FailureRecord = {
      taskId: task.id,
      goalType,
      errorType,
      errorMessage: error.message,
      failedStep,
      recoveryStrategy: (task.metadata?.recoveryStrategy as string) ?? undefined,
      timestamp: new Date(),
    };

    // Store failure in DB
    await this.memoryEngine.store({
      scope: "system",
      category: this.FAILURE_CATEGORY as any,
      key: `failure_${task.id}_${Date.now()}`,
      value: failureRecord as unknown as Record<string, unknown>,
      userId: undefined,
      taskId: Number(task.id) || undefined,
      entityId: undefined,
      permissions: ["learning:read"],
    });

    // Decay scores for patterns of this goal type
    const patterns = this.inMemoryPatterns.get(goalType) ?? await this.fetchPatternsFromDB(goalType);
    for (const pattern of patterns) {
      pattern.failureCount += 1;
      pattern.score = this.computeInitialScore(pattern.userFeedback, pattern.executionResult) * this.SCORE_DECAY;
      pattern.updatedAt = new Date();
    }
    this.inMemoryPatterns.set(goalType, patterns);
    this.sortPatterns(goalType);

    console.log(`[LearningEngine] Learned from failure: goalType=${goalType} error=${errorType} step=${failedStep ?? "unknown"}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Pattern Management
  // ═══════════════════════════════════════════════════════════════════════════════

  private async fetchPatternsFromDB(goalType: string): Promise<LearnedPattern[]> {
    try {
      const results = await db
        .select()
        .from(memoryEntries)
        .where(
          and(
            eq(memoryEntries.category, this.PATTERN_CATEGORY),
            sql`${memoryEntries.value}->>'$.goalType' = ${goalType}`,
          ),
        )
        .orderBy(desc(memoryEntries.createdAt))
        .limit(50);

      const patterns: LearnedPattern[] = [];
      for (const row of results) {
        try {
          const parsed = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
          const validated = LearnedPatternSchema.safeParse(parsed);
          if (validated.success) {
            patterns.push({
              ...validated.data,
              plan: validated.data.plan as unknown as PlanNode[],
              createdAt: new Date(validated.data.createdAt),
              updatedAt: new Date(validated.data.updatedAt),
            });
          }
        } catch {
          // Skip invalid patterns
        }
      }

      return patterns.sort((a, b) => b.score - a.score);
    } catch (err) {
      console.error("[LearningEngine] fetchPatternsFromDB error:", err);
      return [];
    }
  }

  private async getAllPatterns(): Promise<LearnedPattern[]> {
    try {
      const results = await db
        .select()
        .from(memoryEntries)
        .where(eq(memoryEntries.category, this.PATTERN_CATEGORY))
        .orderBy(desc(memoryEntries.createdAt))
        .limit(200);

      const patterns: LearnedPattern[] = [];
      for (const row of results) {
        try {
          const parsed = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
          const validated = LearnedPatternSchema.safeParse(parsed);
          if (validated.success) {
            patterns.push({
              ...validated.data,
              plan: validated.data.plan as unknown as PlanNode[],
              createdAt: new Date(validated.data.createdAt),
              updatedAt: new Date(validated.data.updatedAt),
            });
          }
        } catch {
          // Skip invalid
        }
      }
      return patterns;
    } catch (err) {
      console.error("[LearningEngine] getAllPatterns error:", err);
      return [];
    }
  }

  private async getFailurePatterns(goalType: string): Promise<FailureRecord[]> {
    try {
      const results = await db
        .select()
        .from(memoryEntries)
        .where(
          and(
            eq(memoryEntries.category, this.FAILURE_CATEGORY),
            sql`${memoryEntries.value}->>'$.goalType' = ${goalType}`,
          ),
        )
        .orderBy(desc(memoryEntries.createdAt))
        .limit(20);

      return results.map((row) => {
        const parsed = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
        return {
          ...parsed,
          timestamp: new Date(parsed.timestamp),
        } as FailureRecord;
      });
    } catch (err) {
      console.error("[LearningEngine] getFailurePatterns error:", err);
      return [];
    }
  }

  private computeInitialScore(userFeedback: number, executionResult: unknown): number {
    let score = (userFeedback + 1) / 2; // Normalize -1..1 to 0..1

    // Boost for structured success results
    if (executionResult && typeof executionResult === "object") {
      const result = executionResult as Record<string, unknown>;
      if (result.success === true) score += 0.1;
      if (result.error) score -= 0.2;
      if (result.warnings && Array.isArray(result.warnings) && result.warnings.length > 0) {
        score -= 0.05 * result.warnings.length;
      }
    }

    return Math.max(0, Math.min(1, score));
  }

  private sortPatterns(goalType: string): void {
    const patterns = this.inMemoryPatterns.get(goalType);
    if (patterns) {
      patterns.sort((a, b) => b.score - a.score);
    }
  }

  private reorderByPattern(plan: PlanNode[], patternPlan: PlanNode[]): PlanNode[] {
    // Create a scoring map based on position in successful pattern
    const positionMap = new Map<string, number>();
    for (let i = 0; i < patternPlan.length; i++) {
      const key = `${patternPlan[i].capability.toLowerCase()}_${patternPlan[i].name.toLowerCase()}`;
      positionMap.set(key, i);
    }

    // Sort plan nodes by their position in the successful pattern
    const sorted = [...plan].sort((a, b) => {
      const keyA = `${a.capability.toLowerCase()}_${a.name.toLowerCase()}`;
      const keyB = `${b.capability.toLowerCase()}_${b.name.toLowerCase()}`;
      const posA = positionMap.get(keyA) ?? 999;
      const posB = positionMap.get(keyB) ?? 999;
      return posA - posB;
    });

    // Only return reordered if all dependencies can still be satisfied
    return this.isValidReorder(plan, sorted) ? sorted : plan;
  }

  private isValidReorder(original: PlanNode[], candidate: PlanNode[]): boolean {
    const idToDeps = new Map<string, string[]>();
    for (const node of original) {
      idToDeps.set(node.id, node.dependencies);
    }

    const seen = new Set<string>();
    for (const node of candidate) {
      for (const dep of node.dependencies) {
        if (!seen.has(dep)) {
          return false; // Dependency would execute after dependent
        }
      }
      seen.add(node.id);
    }
    return true;
  }

  private identifyProblematicCapabilities(failures: FailureRecord[]): Set<string> {
    const capFailures = new Map<string, number>();
    for (const failure of failures) {
      if (failure.failedStep) {
        const count = capFailures.get(failure.failedStep.toLowerCase()) ?? 0;
        capFailures.set(failure.failedStep.toLowerCase(), count + 1);
      }
    }

    const problematic = new Set<string>();
    for (const [cap, count] of capFailures) {
      if (count >= 2) {
        problematic.add(cap);
      }
    }
    return problematic;
  }

  private findAlternativeCapability(capability: string, patterns: LearnedPattern[]): string | null {
    // Find what capability was used in successful patterns where this one failed
    const alternativeCounts = new Map<string, number>();
    for (const pattern of patterns) {
      if (pattern.score < 0.5) continue; // Skip low-scoring patterns
      for (const node of pattern.plan) {
        const nodeCap = node.capability.toLowerCase();
        if (nodeCap !== capability) {
          const count = alternativeCounts.get(nodeCap) ?? 0;
          alternativeCounts.set(nodeCap, count + 1);
        }
      }
    }

    if (alternativeCounts.size === 0) return null;

    // Return most common alternative
    return [...alternativeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  private classifyError(error: Error): string {
    const msg = error.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("timed out")) return "timeout";
    if (msg.includes("network") || msg.includes("connection") || msg.includes("fetch")) return "network";
    if (msg.includes("permission") || msg.includes("unauthorized") || msg.includes("forbidden")) return "permission";
    if (msg.includes("not found") || msg.includes("404")) return "not_found";
    if (msg.includes("rate limit") || msg.includes("too many")) return "rate_limit";
    if (msg.includes("validation") || msg.includes("invalid")) return "validation";
    if (msg.includes("capability") || msg.includes("not available")) return "capability_missing";
    return "unknown";
  }

  private identifyFailedStep(task: Task, _error: Error): string | undefined {
    // Try to find which step was being executed when failure occurred
    if (task.currentStepId) {
      return task.currentStepId;
    }
    const failedStep = task.steps.find((s) => s.status === "failed" || s.error);
    return failedStep?.name;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

let globalLearningEngine: LearningEngine | null = null;

export function getLearningEngine(memoryEngine: MemoryEngine): LearningEngine {
  if (!globalLearningEngine) {
    globalLearningEngine = new LearningEngine(memoryEngine);
  }
  return globalLearningEngine;
}

export function resetLearningEngine(): void {
  globalLearningEngine = null;
}
