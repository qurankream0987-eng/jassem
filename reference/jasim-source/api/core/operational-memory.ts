/**
 * JASIM Operational Memory — Execution Pattern Storage & User Preference Learning
 *
 * Stores and retrieves operational patterns that drive execution decisions.
 * Captures user preferences and adapts behavior over time.
 *
 * CRITICAL RULES:
 * 1. NEVER store without retrieval
 * 2. NEVER retrieve without using the data
 * 3. Patterns must be scored and ranked
 * 4. Memory must INFLUENCE execution behavior
 */

import { z } from "zod";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { db } from "../queries/connection";
import { memoryEntries } from "@db/schema";
import type { MemoryEngine } from "./cytoplasm";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface OperationalPattern {
  id: string;
  goalType: string;
  capabilities: string[];
  toolSequence: string[];
  contextConditions: Record<string, unknown>;
  successRate: number;
  executionCount: number;
  avgDurationMs: number;
  lastUsedAt: Date;
  createdAt: Date;
}

export interface PreferenceEntry {
  key: string;
  value: unknown;
  confidence: number;
  source: string; // 'explicit', 'inferred', 'learned'
  lastUpdated: Date;
}

export interface PatternMatch {
  pattern: OperationalPattern;
  matchScore: number;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Zod Schemas
// ═══════════════════════════════════════════════════════════════════════════════

const OperationalPatternSchema = z.object({
  id: z.string(),
  goalType: z.string(),
  capabilities: z.array(z.string()),
  toolSequence: z.array(z.string()),
  contextConditions: z.record(z.unknown()).default({}),
  successRate: z.number().min(0).max(1).default(0),
  executionCount: z.number().default(0),
  avgDurationMs: z.number().default(0),
  lastUsedAt: z.string().or(z.date()),
  createdAt: z.string().or(z.date()),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Operational Memory
// ═══════════════════════════════════════════════════════════════════════════════

export class OperationalMemory {
  private memoryEngine: MemoryEngine;
  private readonly PATTERN_CATEGORY = "operational_pattern";
  private readonly PREFERENCE_CATEGORY = "user_preference";
  private inMemoryPatterns: Map<string, OperationalPattern[]> = new Map();
  private inMemoryPreferences: Map<string, Map<string, PreferenceEntry>> = new Map();

  constructor(memoryEngine: MemoryEngine) {
    this.memoryEngine = memoryEngine;
  }

  // ── Store a Successful Execution Pattern ───────────────────────────────────

  /**
   * Store an operational pattern derived from successful execution.
   */
  async storePattern(pattern: Omit<OperationalPattern, "id" | "createdAt" | "lastUsedAt">): Promise<void> {
    const fullPattern: OperationalPattern = {
      ...pattern,
      id: `op_pattern_${pattern.goalType}_${Date.now()}`,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    };

    // Store in DB
    await this.memoryEngine.store({
      scope: "system",
      category: this.PATTERN_CATEGORY as any,
      key: fullPattern.id,
      value: fullPattern as unknown as Record<string, unknown>,
      userId: undefined,
      taskId: undefined,
      entityId: undefined,
      permissions: ["operational:read", "operational:write"],
    });

    // Update in-memory cache
    const cached = this.inMemoryPatterns.get(pattern.goalType) ?? [];
    cached.push(fullPattern);
    this.inMemoryPatterns.set(pattern.goalType, cached);

    console.log(`[OperationalMemory] Stored pattern ${fullPattern.id} for goalType=${pattern.goalType} successRate=${fullPattern.successRate}`);
  }

  // ── Retrieve Matching Patterns ─────────────────────────────────────────────

  /**
   * Retrieve patterns that match a goal and required capabilities.
   * Returns patterns ranked by match score.
   */
  async retrievePatterns(goal: string, capabilities: string[]): Promise<OperationalPattern[]> {
    const goalType = this.inferGoalType(goal);

    // Check in-memory cache first
    const cached = this.inMemoryPatterns.get(goalType);
    if (cached) {
      const matches = this.rankPatternMatches(cached, goal, capabilities);
      if (matches.length > 0) return matches;
    }

    // Fetch from DB
    const dbPatterns = await this.fetchPatternsFromDB(goalType);
    this.inMemoryPatterns.set(goalType, dbPatterns);

    const matches = this.rankPatternMatches(dbPatterns, goal, capabilities);
    return matches;
  }

  // ── Update Pattern Success Rate ────────────────────────────────────────────

  /**
   * Update a pattern's success statistics after execution.
   */
  async updateSuccessRate(patternId: string, success: boolean): Promise<void> {
    // Update in-memory
    for (const [goalType, patterns] of this.inMemoryPatterns) {
      const idx = patterns.findIndex((p) => p.id === patternId);
      if (idx >= 0) {
        const pattern = patterns[idx];
        const newCount = pattern.executionCount + 1;
        const newSuccessRate = ((pattern.successRate * pattern.executionCount) + (success ? 1 : 0)) / newCount;

        patterns[idx] = {
          ...pattern,
          successRate: newSuccessRate,
          executionCount: newCount,
          lastUsedAt: new Date(),
        };

        // Update DB via memory engine
        await this.memoryEngine.update(
          await this.findPatternDbId(patternId),
          patterns[idx] as unknown as Record<string, unknown>,
        );

        console.log(`[OperationalMemory] Updated pattern ${patternId}: successRate=${newSuccessRate.toFixed(3)} executions=${newCount}`);
        return;
      }
    }

    // If not in cache, try to find and update in DB
    const dbId = await this.findPatternDbId(patternId);
    if (dbId > 0) {
      const existing = await db.query.memoryEntries.findFirst({
        where: eq(memoryEntries.id, dbId),
      });
      if (existing) {
        const parsed = typeof existing.value === "string" ? JSON.parse(existing.value) : existing.value;
        const pattern = OperationalPatternSchema.parse(parsed);
        const newCount = pattern.executionCount + 1;
        const newSuccessRate = ((pattern.successRate * pattern.executionCount) + (success ? 1 : 0)) / newCount;

        await this.memoryEngine.update(dbId, {
          ...pattern,
          successRate: newSuccessRate,
          executionCount: newCount,
          lastUsedAt: new Date(),
        } as unknown as Record<string, unknown>);
      }
    }
  }

  // ── Get User Preferences ───────────────────────────────────────────────────

  /**
   * Get all learned preferences for a user.
   */
  async getUserPreferences(userId: string): Promise<Record<string, unknown>> {
    // Check cache
    const cached = this.inMemoryPreferences.get(userId);
    if (cached) {
      const prefs: Record<string, unknown> = {};
      for (const [key, entry] of cached) {
        if (entry.confidence > 0.5) {
          prefs[key] = entry.value;
        }
      }
      return prefs;
    }

    // Fetch from DB
    const entries = await this.fetchPreferencesFromDB(userId);
    const prefMap = new Map<string, PreferenceEntry>();
    const prefs: Record<string, unknown> = {};

    for (const entry of entries) {
      prefMap.set(entry.key, entry);
      if (entry.confidence > 0.5) {
        prefs[entry.key] = entry.value;
      }
    }

    this.inMemoryPreferences.set(userId, prefMap);
    return prefs;
  }

  // ── Update User Preferences ──────────────────────────────────────────────

  /**
   * Update or create a user preference.
   * Confidence increases with repeated observation.
   */
  async updateUserPreferences(userId: string, preferences: Record<string, unknown>): Promise<void> {
    const prefMap = this.inMemoryPreferences.get(userId) ?? new Map<string, PreferenceEntry>();

    for (const [key, value] of Object.entries(preferences)) {
      const existing = prefMap.get(key);

      const entry: PreferenceEntry = {
        key,
        value,
        confidence: existing ? Math.min(existing.confidence + 0.1, 1.0) : 0.6,
        source: existing ? "learned" : "inferred",
        lastUpdated: new Date(),
      };

      prefMap.set(key, entry);

      // Store in DB
      const prefKey = `pref_${userId}_${key}`;
      await this.memoryEngine.store({
        scope: "user",
        category: this.PREFERENCE_CATEGORY as any,
        key: prefKey,
        value: entry as unknown as Record<string, unknown>,
        userId: Number(userId) || undefined,
        taskId: undefined,
        entityId: undefined,
        permissions: [],
      });
    }

    this.inMemoryPreferences.set(userId, prefMap);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async fetchPatternsFromDB(goalType: string): Promise<OperationalPattern[]> {
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
        .limit(100);

      const patterns: OperationalPattern[] = [];
      for (const row of results) {
        try {
          const parsed = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
          const validated = OperationalPatternSchema.safeParse(parsed);
          if (validated.success) {
            patterns.push({
              ...validated.data,
              lastUsedAt: new Date(validated.data.lastUsedAt),
              createdAt: new Date(validated.data.createdAt),
            });
          }
        } catch {
          // Skip invalid
        }
      }

      return patterns;
    } catch (err) {
      console.error("[OperationalMemory] fetchPatternsFromDB error:", err);
      return [];
    }
  }

  private async fetchPreferencesFromDB(userId: string): Promise<PreferenceEntry[]> {
    try {
      const userIdNum = Number(userId) || 0;
      const results = await db
        .select()
        .from(memoryEntries)
        .where(
          and(
            eq(memoryEntries.category, this.PREFERENCE_CATEGORY),
            eq(memoryEntries.userId, userIdNum),
          ),
        )
        .orderBy(desc(memoryEntries.createdAt))
        .limit(200);

      return results.map((row) => {
        const parsed = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
        return {
          key: parsed.key ?? row.key.replace(`pref_${userId}_`, ""),
          value: parsed.value,
          confidence: parsed.confidence ?? 0.5,
          source: parsed.source ?? "inferred",
          lastUpdated: new Date(parsed.lastUpdated ?? row.createdAt),
        } as PreferenceEntry;
      });
    } catch (err) {
      console.error("[OperationalMemory] fetchPreferencesFromDB error:", err);
      return [];
    }
  }

  private rankPatternMatches(
    patterns: OperationalPattern[],
    goal: string,
    requiredCapabilities: string[],
  ): OperationalPattern[] {
    const goalLower = goal.toLowerCase();
    const reqCapsLower = requiredCapabilities.map((c) => c.toLowerCase());

    const scored = patterns.map((pattern) => {
      let score = 0;
      const reasons: string[] = [];

      // 1. Success rate (0-0.4 weight)
      score += pattern.successRate * 0.4;

      // 2. Goal similarity (0-0.3 weight)
      const goalWords = goalLower.split(/\s+/);
      const patternGoalWords = pattern.goalType.toLowerCase().split(/[_\s]+/);
      const overlap = goalWords.filter((w) => patternGoalWords.some((pw) => pw.includes(w) || w.includes(pw))).length;
      const goalSim = goalWords.length > 0 ? overlap / goalWords.length : 0;
      score += goalSim * 0.3;
      if (goalSim > 0.5) reasons.push("high goal similarity");

      // 3. Capability coverage (0-0.2 weight)
      const patternCaps = pattern.capabilities.map((c) => c.toLowerCase());
      const covered = reqCapsLower.filter((rc) => patternCaps.some((pc) => pc.includes(rc) || rc.includes(pc)));
      const coverage = reqCapsLower.length > 0 ? covered.length / reqCapsLower.length : 0;
      score += coverage * 0.2;
      if (coverage === 1) reasons.push("full capability coverage");

      // 4. Experience bonus (0-0.1 weight)
      const expBonus = Math.min(pattern.executionCount / 10, 1) * 0.1;
      score += expBonus;

      // 5. Recency bonus
      const daysSinceUse = (Date.now() - pattern.lastUsedAt.getTime()) / (1000 * 60 * 60 * 24);
      const recencyBonus = Math.max(0, 1 - daysSinceUse / 30) * 0.05;
      score += recencyBonus;

      return {
        pattern,
        matchScore: Math.min(1, score),
        reason: reasons.join(", ") || "general match",
      };
    });

    return scored
      .filter((s) => s.matchScore > 0.2)
      .sort((a, b) => b.matchScore - a.matchScore)
      .map((s) => s.pattern);
  }

  private inferGoalType(goal: string): string {
    const lower = goal.toLowerCase();
    if (lower.includes("buy") || lower.includes("order") || lower.includes("purchase")) return "buy";
    if (lower.includes("search") || lower.includes("find") || lower.includes("look for")) return "find";
    if (lower.includes("book") || lower.includes("schedule") || lower.includes("reserve")) return "book";
    if (lower.includes("track") || lower.includes("status") || lower.includes("where")) return "track";
    if (lower.includes("compare") || lower.includes("versus") || lower.includes("difference")) return "compare";
    if (lower.includes("create") || lower.includes("build") || lower.includes("make")) return "create";
    if (lower.includes("analyze") || lower.includes("review") || lower.includes("check")) return "analyze";
    return "general";
  }

  private async findPatternDbId(patternId: string): Promise<number> {
    try {
      const result = await db
        .select({ id: memoryEntries.id })
        .from(memoryEntries)
        .where(
          and(
            eq(memoryEntries.category, this.PATTERN_CATEGORY),
            eq(memoryEntries.key, patternId),
          ),
        )
        .limit(1);

      return result[0]?.id ?? 0;
    } catch {
      return 0;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

let globalOperationalMemory: OperationalMemory | null = null;

export function getOperationalMemory(memoryEngine: MemoryEngine): OperationalMemory {
  if (!globalOperationalMemory) {
    globalOperationalMemory = new OperationalMemory(memoryEngine);
  }
  return globalOperationalMemory;
}

export function resetOperationalMemory(): void {
  globalOperationalMemory = null;
}
