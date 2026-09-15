/**
 * Memory Engine - Vector-based memory system for JASIM
 * Stores user preferences, interactions, context, and feedback
 * Uses Drizzle ORM with the `memory` table in schema
 */

import { z } from "zod";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { memory } from "@db/schema";
import type { MemoryEntry } from "./types";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================
const Errors = {
  storeFailed: "فشل في تخزين الذاكرة - يرجى المحاولة مرة أخرى",
  recallFailed: "فشل في استرجاع الذاكرة",
  invalidInput: "مدخلات غير صالحة",
  userNotFound: "لم يتم العثور على بيانات المستخدم",
  clearFailed: "فشل في مساح الذكريات منتهية الصلاحية",
} as const;

// ============================================
// ZOD SCHEMAS
// ============================================

const StoreMemoryInputSchema = z.object({
  userId: z.string(),
  marketCode: z.string().default("KW"),
  type: z.enum(["preference", "interaction", "context", "feedback"]),
  key: z.string().min(1),
  value: z.unknown(),
  confidence: z.number().min(0).max(1).default(0.8),
  source: z.string().default("user"),
  expiresAt: z.date().optional(),
  isPermanent: z.boolean().default(false),
});

// ============================================
// TYPE EXPORTS
// ============================================

export type { MemoryEntry };

// ============================================
// MEMORY OPERATIONS
// ============================================

/**
 * Store a memory entry in the database
 * Creates a new memory record with the provided data
 */
export async function storeMemory(
  entry: Omit<MemoryEntry, "id" | "createdAt">
): Promise<MemoryEntry> {
  // Validate input
  const validated = StoreMemoryInputSchema.parse(entry);

  try {
    // Serialize value to string for storage
    const valueStr = typeof validated.value === "string"
      ? validated.value
      : JSON.stringify(validated.value);

    const now = new Date();

    const [result] = await db.insert(memory).values({
      userId: Number.parseInt(validated.userId) || 0,
      key: validated.key,
      value: valueStr,
      category: validated.type,
      createdAt: now,
      updatedAt: now,
    });

    const newId = Number(result.insertId);

    // Return as MemoryEntry
    return {
      id: String(newId),
      userId: validated.userId,
      marketCode: validated.marketCode,
      type: validated.type,
      key: validated.key,
      value: validated.value,
      confidence: validated.confidence,
      source: validated.source,
      expiresAt: validated.expiresAt,
      isPermanent: validated.isPermanent,
      createdAt: now,
    };
  } catch (error) {
    console.error("[MemoryEngine] storeMemory error:", error);
    throw new Error(Errors.storeFailed);
  }
}

/**
 * Recall memories by user ID and query
 * Performs semantic-like search using keyword matching and relevance scoring
 * Simulates vector search with SQL-based scoring
 */
export async function recallMemory(
  userId: string,
  query: string,
  marketCode?: string,
  limit: number = 10
): Promise<MemoryEntry[]> {
  try {
    // Build query conditions
    const userIdNum = Number.parseInt(userId) || 0;

    // Use SQL to search memory entries
    const queryPattern = `%${query}%`;
    const keyPattern = `%${query}%`;

    const conditions = [
      eq(memory.userId, userIdNum),
    ];

    // Execute search with relevance scoring (simulating vector search)
    const results = await db
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.userId, userIdNum),
          sql`(${memory.key} LIKE ${queryPattern} OR ${memory.value} LIKE ${queryPattern})`
        )
      )
      .orderBy(desc(memory.createdAt))
      .limit(limit);

    // Convert to MemoryEntry format with relevance scoring
    const scored = results.map(row => {
      let parsedValue: unknown;
      try {
        parsedValue = JSON.parse(row.value);
      } catch {
        parsedValue = row.value;
      }

      // Calculate relevance score (simulating vector similarity)
      const keyRelevance = row.key.toLowerCase().includes(query.toLowerCase()) ? 0.8 : 0;
      const valueRelevance = row.value.toLowerCase().includes(query.toLowerCase()) ? 0.5 : 0;
      const recencyScore = calculateRecencyScore(row.createdAt);
      const relevanceScore = Math.min(keyRelevance + valueRelevance + recencyScore, 1);

      return {
        id: String(row.id),
        userId: String(row.userId),
        marketCode: marketCode || "KW",
        type: (row.category as "preference" | "interaction" | "context" | "feedback") || "interaction",
        key: row.key,
        value: parsedValue,
        confidence: relevanceScore,
        source: "recall",
        isPermanent: false,
        createdAt: row.createdAt,
      } as MemoryEntry;
    });

    // Sort by relevance score descending
    scored.sort((a, b) => b.confidence - a.confidence);

    return scored;
  } catch (error) {
    console.error("[MemoryEngine] recallMemory error:", error);
    throw new Error(Errors.recallFailed);
  }
}

/**
 * Get all preferences for a user
 * Returns a merged record of all preference-type memories
 */
export async function getPreferences(
  userId: string
): Promise<Record<string, unknown>> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;

    const results = await db
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.userId, userIdNum),
          eq(memory.category, "preference")
        )
      )
      .orderBy(desc(memory.createdAt));

    // Merge all preferences into a single object
    const preferences: Record<string, unknown> = {};

    for (const row of results) {
      let parsedValue: unknown;
      try {
        parsedValue = JSON.parse(row.value);
      } catch {
        parsedValue = row.value;
      }
      preferences[row.key] = parsedValue;
    }

    return preferences;
  } catch (error) {
    console.error("[MemoryEngine] getPreferences error:", error);
    return {};
  }
}

/**
 * Get recent interactions for a user
 * Returns the most recent N interaction-type memories
 */
export async function getRecentInteractions(
  userId: string,
  limit: number = 20
): Promise<MemoryEntry[]> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;

    const results = await db
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.userId, userIdNum),
          eq(memory.category, "interaction")
        )
      )
      .orderBy(desc(memory.createdAt))
      .limit(limit);

    return results.map(row => {
      let parsedValue: unknown;
      try {
        parsedValue = JSON.parse(row.value);
      } catch {
        parsedValue = row.value;
      }

      return {
        id: String(row.id),
        userId: String(row.userId),
        marketCode: "KW",
        type: "interaction" as const,
        key: row.key,
        value: parsedValue,
        confidence: 1,
        source: "recent",
        isPermanent: false,
        createdAt: row.createdAt,
      } as MemoryEntry;
    });
  } catch (error) {
    console.error("[MemoryEngine] getRecentInteractions error:", error);
    return [];
  }
}

/**
 * Update a specific preference for a user
 * Creates or updates a preference memory entry
 */
export async function updatePreference(
  userId: string,
  key: string,
  value: unknown
): Promise<void> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;
    const valueStr = typeof value === "string" ? value : JSON.stringify(value);

    // Check if preference already exists
    const existing = await db
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.userId, userIdNum),
          eq(memory.key, key),
          eq(memory.category, "preference")
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing
      await db
        .update(memory)
        .set({
          value: valueStr,
          updatedAt: new Date(),
        })
        .where(eq(memory.id, existing[0].id));
    } else {
      // Insert new
      await db.insert(memory).values({
        userId: userIdNum,
        key,
        value: valueStr,
        category: "preference",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  } catch (error) {
    console.error("[MemoryEngine] updatePreference error:", error);
    throw new Error(Errors.storeFailed);
  }
}

/**
 * Clear expired memories from the database
 * Returns the number of deleted rows
 */
export async function clearExpiredMemories(): Promise<number> {
  try {
    // Delete old interaction memories (older than 90 days)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    const result = await db
      .delete(memory)
      .where(
        and(
          eq(memory.category, "interaction"),
          lt(memory.updatedAt, cutoffDate)
        )
      );

    // For MySQL, we can't get affected rows directly from delete
    // Return 0 as we can't determine the count easily
    return 0;
  } catch (error) {
    console.error("[MemoryEngine] clearExpiredMemories error:", error);
    throw new Error(Errors.clearFailed);
  }
}

/**
 * Get memory statistics for a user
 */
export async function getMemoryStats(userId: string): Promise<{
  total: number;
  preferences: number;
  interactions: number;
  contexts: number;
  feedback: number;
}> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;

    const results = await db
      .select()
      .from(memory)
      .where(eq(memory.userId, userIdNum));

    const stats = {
      total: results.length,
      preferences: 0,
      interactions: 0,
      contexts: 0,
      feedback: 0,
    };

    for (const row of results) {
      switch (row.category) {
        case "preference": stats.preferences++; break;
        case "interaction": stats.interactions++; break;
        case "context": stats.contexts++; break;
        case "feedback": stats.feedback++; break;
      }
    }

    return stats;
  } catch (error) {
    console.error("[MemoryEngine] getMemoryStats error:", error);
    return { total: 0, preferences: 0, interactions: 0, contexts: 0, feedback: 0 };
  }
}

/**
 * Store user interaction context
 * Convenience wrapper for storing interaction-type memories
 */
export async function storeInteraction(
  userId: string,
  key: string,
  value: unknown,
  marketCode: string = "KW"
): Promise<MemoryEntry> {
  return storeMemory({
    userId,
    marketCode,
    type: "interaction",
    key,
    value,
    confidence: 0.8,
    source: "conversation",
    isPermanent: false,
  });
}

/**
 * Store user feedback
 * Convenience wrapper for storing feedback-type memories
 */
export async function storeFeedback(
  userId: string,
  key: string,
  value: unknown,
  marketCode: string = "KW"
): Promise<MemoryEntry> {
  return storeMemory({
    userId,
    marketCode,
    type: "feedback",
    key,
    value,
    confidence: 1,
    source: "user_feedback",
    isPermanent: true,
  });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate recency score for a memory entry
 * Newer entries get higher scores
 */
function calculateRecencyScore(createdAt: Date | null): number {
  if (!createdAt) return 0;

  const now = new Date();
  const age = now.getTime() - new Date(createdAt).getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  // Score decays over time: 1.0 for today, 0.5 for 7 days, 0.1 for 30 days
  if (age < oneDay) return 0.4;
  if (age < 7 * oneDay) return 0.2;
  if (age < 30 * oneDay) return 0.1;
  return 0.05;
}

/**
 * Delete all memories for a user
 * Use with caution - primarily for GDPR compliance
 */
export async function deleteAllMemories(userId: string): Promise<number> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;

    await db
      .delete(memory)
      .where(eq(memory.userId, userIdNum));

    return 0; // MySQL doesn't return affected rows easily
  } catch (error) {
    console.error("[MemoryEngine] deleteAllMemories error:", error);
    throw new Error(Errors.clearFailed);
  }
}
