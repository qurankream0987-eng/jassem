/**
 * ============================================================
 * MEMORY ENGINE V2 — Harness Pattern (2026)
 * JASIM Persistent Markdown-Based Memory System
 * ============================================================
 *
 * Implements the Harness pattern:
 * - Persistent markdown-based memory
 * - Session state that compounds over time
 * - Hooks for event-driven automation
 * - Skills packaging system
 * - Zod schemas for all operations
 */

import { z } from "zod";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { memory } from "@db/schema";
import {
  JASIMError,
  retryWithBackoff,
  executeBatchWithErrorHandling,
} from "./error-handler";

// ============================================
// ZOD SCHEMAS — All memory operations validated
// ============================================

export const MemoryCategorySchema = z.enum([
  "preference",
  "interaction",
  "context",
  "feedback",
  "skill",
  "session_state",
  "harness_hook",
  "markdown_note",
]);

export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

export const MemoryEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  marketCode: z.string().default("KW"),
  type: MemoryCategorySchema,
  key: z.string().min(1),
  value: z.unknown(),
  confidence: z.number().min(0).max(1).default(0.8),
  source: z.string().default("user"),
  expiresAt: z.date().optional(),
  isPermanent: z.boolean().default(false),
  createdAt: z.date(),
  // V2 Harness fields
  markdownContent: z.string().optional(),
  sessionId: z.string().optional(),
  compoundScore: z.number().default(0),
  tags: z.array(z.string()).default([]),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export const StoreMemoryInputSchema = z.object({
  userId: z.string(),
  marketCode: z.string().default("KW"),
  type: MemoryCategorySchema,
  key: z.string().min(1),
  value: z.unknown(),
  confidence: z.number().min(0).max(1).default(0.8),
  source: z.string().default("user"),
  expiresAt: z.date().optional(),
  isPermanent: z.boolean().default(false),
  // V2
  markdownContent: z.string().optional(),
  sessionId: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export type StoreMemoryInput = z.infer<typeof StoreMemoryInputSchema>;

export const MemoryQuerySchema = z.object({
  userId: z.string(),
  query: z.string(),
  marketCode: z.string().optional(),
  category: MemoryCategorySchema.optional(),
  limit: z.number().min(1).max(100).default(10),
  minConfidence: z.number().min(0).max(1).default(0),
  sortBy: z.enum(["relevance", "recency", "confidence", "compound"]).default("relevance"),
});

export type MemoryQuery = z.infer<typeof MemoryQuerySchema>;

// ============================================
// HARNESS PATTERN — Persistent Markdown Memory
// ============================================

export const HarnessNoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(), // Markdown content
  tags: z.array(z.string()),
  userId: z.string(),
  sessionId: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  references: z.array(z.string()).default([]), // IDs of related notes
  compoundScore: z.number().default(0), // Increases with each access
});

export type HarnessNote = z.infer<typeof HarnessNoteSchema>;

// ============================================
// SESSION STATE — Compounding over time
// ============================================

export const SessionStateSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  startedAt: z.string(), // ISO date
  lastAccessedAt: z.string(),
  interactions: z.number().default(0),
  intents: z.array(z.string()).default([]),
  preferences: z.record(z.string(), z.unknown()).default({}),
  // Compounding state
  contextMemory: z.array(z.record(z.string(), z.unknown())).default([]),
  agentHistory: z.array(z.object({
    agent: z.string(),
    timestamp: z.string(),
    result: z.string(),
  })).default([]),
  compoundScore: z.number().default(0),
  // Harness fields
  harnessNotes: z.array(z.string()).default([]), // Note IDs
  skills: z.array(z.string()).default([]),
});

export type SessionState = z.infer<typeof SessionStateSchema>;

// ============================================
// SKILL PACKAGE
// ============================================

export const SkillPackageSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string().default("1.0"),
  skills: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()).default({}),
    examples: z.array(z.string()).default([]),
  })),
  createdAt: z.string(),
  updatedAt: z.string(),
  usageCount: z.number().default(0),
  successRate: z.number().default(0),
});

export type SkillPackage = z.infer<typeof SkillPackageSchema>;

// ============================================
// HARNESS HOOK — Event-driven automation
// ============================================

export type HarnessHookType =
  | "on_memory_stored"
  | "on_memory_recalled"
  | "on_session_compound"
  | "on_skill_invoked"
  | "on_markdown_created"
  | "on_state_changed";

export interface HarnessHook {
  id: string;
  type: HarnessHookType;
  condition: (payload: Record<string, unknown>) => boolean;
  action: (payload: Record<string, unknown>) => Promise<void>;
  enabled: boolean;
  priority: number;
}

export const HarnessHookSchema = z.object({
  id: z.string(),
  type: z.enum([
    "on_memory_stored",
    "on_memory_recalled",
    "on_session_compound",
    "on_skill_invoked",
    "on_markdown_created",
    "on_state_changed",
  ]),
  enabled: z.boolean().default(true),
  priority: z.number().default(5),
  condition: z.string().optional(), // Stored as string for serialization
});

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================

const Errors = {
  storeFailed: "فشل في تخزين الذاكرة - يرجى المحاولة مرة أخرى",
  recallFailed: "فشل في استرجاع الذاكرة",
  invalidInput: "مدخلات غير صالحة",
  userNotFound: "لم يتم العثور على بيانات المستخدم",
  clearFailed: "فشل في مسح الذكريات منتهية الصلاحية",
  harnessFailed: "فشل في عملية الـ Harness",
  sessionNotFound: "الجلسة غير موجودة",
  skillNotFound: "المهارة غير موجودة",
} as const;

// ============================================
// HARNESS ENGINE — Persistent Memory Manager
// ============================================

export class MemoryHarness {
  private hooks: Map<string, HarnessHook> = new Map();
  private sessions: Map<string, SessionState> = new Map();
  private skills: Map<string, SkillPackage> = new Map();
  private noteCounter = 0;

  constructor() {
    this.registerDefaultHooks();
  }

  // ============================================
  // MARKDOWN-BASED MEMORY
  // ============================================

  /**
   * Store a memory entry as markdown
   * Enables rich, formatted memory that compounds over time
   */
  async storeMarkdownNote(
    userId: string,
    title: string,
    content: string,
    options?: {
      tags?: string[];
      sessionId?: string;
      references?: string[];
    },
  ): Promise<HarnessNote> {
    const validatedUserId = z.string().parse(userId);
    const validatedTitle = z.string().min(1).parse(title);
    const validatedContent = z.string().parse(content);

    this.noteCounter++;
    const now = new Date();

    const note: HarnessNote = {
      id: `note_${Date.now()}_${this.noteCounter}`,
      title: validatedTitle,
      content: validatedContent,
      tags: options?.tags || [],
      userId: validatedUserId,
      sessionId: options?.sessionId,
      createdAt: now,
      updatedAt: now,
      references: options?.references || [],
      compoundScore: 1, // Starts at 1, compounds with each access
    };

    // Also store in DB as memory entry
    try {
      const valueStr = JSON.stringify({
        title: note.title,
        content: note.content,
        tags: note.tags,
      });

      await db.insert(memory).values({
        userId: Number.parseInt(validatedUserId) || 0,
        key: `harness_note_${note.id}`,
        value: valueStr,
        category: "markdown_note",
        createdAt: now,
        updatedAt: now,
      });

      // Trigger hooks
      await this.triggerHooks("on_markdown_created", { note });

      return note;
    } catch (error) {
      console.error("[MemoryHarness] storeMarkdownNote error:", error);
      throw new JASIMError({
        code: "MEMORY_STORE_FAILED",
        message: Errors.harnessFailed,
        cause: error,
        context: { userId, title },
      });
    }
  }

  /**
   * Recall markdown notes with compounding scores
   * Each recall increases the compoundScore, making frequently accessed notes rank higher
   */
  async recallMarkdownNotes(
    userId: string,
    query?: string,
    options?: {
      tags?: string[];
      limit?: number;
      minCompoundScore?: number;
    },
  ): Promise<HarnessNote[]> {
    try {
      const userIdNum = Number.parseInt(userId) || 0;
      const limit = options?.limit || 20;

      // Query from DB
      const results = await db
        .select()
        .from(memory)
        .where(
          and(
            eq(memory.userId, userIdNum),
            sql`${memory.category} = 'markdown_note'`,
          ),
        )
        .orderBy(desc(memory.createdAt))
        .limit(limit);

      const notes: HarnessNote[] = results.map((row) => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(row.value);
        } catch { parsed = { content: row.value }; }

        return {
          id: row.key.replace("harness_note_", ""),
          title: (parsed.title as string) || row.key,
          content: (parsed.content as string) || row.value,
          tags: (parsed.tags as string[]) || [],
          userId,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          references: [],
          compoundScore: 1,
        };
      });

      // Filter by query if provided
      let filtered = notes;
      if (query) {
        const lowerQuery = query.toLowerCase();
        filtered = notes.filter(
          (n) =>
            n.title.toLowerCase().includes(lowerQuery) ||
            n.content.toLowerCase().includes(lowerQuery) ||
            n.tags.some((t) => t.toLowerCase().includes(lowerQuery)),
        );
      }

      // Filter by tags
      if (options?.tags && options.tags.length > 0) {
        filtered = filtered.filter((n) =>
          options.tags!.some((tag) => n.tags.includes(tag)),
        );
      }

      // Compound scoring: increase score for recalled notes
      filtered.forEach((note) => {
        note.compoundScore += 1;
      });

      // Sort by compound score (descending) — most accessed first
      filtered.sort((a, b) => b.compoundScore - a.compoundScore);

      // Trigger hooks
      await this.triggerHooks("on_memory_recalled", { userId, noteCount: filtered.length });

      return filtered;
    } catch (error) {
      console.error("[MemoryHarness] recallMarkdownNotes error:", error);
      return [];
    }
  }

  // ============================================
  // SESSION STATE — Compounding over time
  // ============================================

  /**
   * Initialize or retrieve a session state
   */
  getOrCreateSession(userId: string, sessionId?: string): SessionState {
    const sid = sessionId || `session_${userId}_${Date.now()}`;

    if (this.sessions.has(sid)) {
      const existing = this.sessions.get(sid)!;
      existing.lastAccessedAt = new Date().toISOString();
      existing.interactions += 1;
      existing.compoundScore += 1; // Compounds with each access
      return existing;
    }

    const newSession: SessionState = {
      sessionId: sid,
      userId,
      startedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      interactions: 1,
      intents: [],
      preferences: {},
      contextMemory: [],
      agentHistory: [],
      compoundScore: 1,
      harnessNotes: [],
      skills: [],
    };

    this.sessions.set(sid, newSession);
    return newSession;
  }

  /**
   * Update session state with new context
   * State compounds: new context is merged with existing
   */
  async compoundSession(
    sessionId: string,
    update: Partial<SessionState>,
  ): Promise<SessionState> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new JASIMError({
        code: "MEMORY_NOT_FOUND",
        message: Errors.sessionNotFound,
        context: { sessionId },
      });
    }

    // Merge update into existing session
    if (update.intents) {
      session.intents = [...new Set([...session.intents, ...update.intents])];
    }
    if (update.preferences) {
      session.preferences = { ...session.preferences, ...update.preferences };
    }
    if (update.contextMemory) {
      session.contextMemory = [...session.contextMemory, ...update.contextMemory];
    }
    if (update.agentHistory) {
      session.agentHistory = [...session.agentHistory, ...update.agentHistory];
    }
    if (update.harnessNotes) {
      session.harnessNotes = [...new Set([...session.harnessNotes, ...update.harnessNotes])];
    }
    if (update.skills) {
      session.skills = [...new Set([...session.skills, ...update.skills])];
    }

    session.interactions += 1;
    session.compoundScore += 1;
    session.lastAccessedAt = new Date().toISOString();

    // Persist to DB
    try {
      await db.insert(memory).values({
        userId: Number.parseInt(session.userId) || 0,
        key: `session_state_${sessionId}`,
        value: JSON.stringify(session),
        category: "session_state",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch {
      // Non-critical
    }

    // Trigger hooks
    await this.triggerHooks("on_session_compound", { sessionId, compoundScore: session.compoundScore });

    return session;
  }

  /**
   * Get session state
   */
  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all active sessions for a user
   */
  getUserSessions(userId: string): SessionState[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.compoundScore - a.compoundScore);
  }

  // ============================================
  // HOOKS — Event-driven automation
  // ============================================

  registerHook(hook: HarnessHook): void {
    this.hooks.set(hook.id, hook);
    // Sort by priority
    const sorted = new Map(
      Array.from(this.hooks.entries()).sort((a, b) => a[1].priority - b[1].priority),
    );
    this.hooks = sorted;
  }

  unregisterHook(hookId: string): void {
    this.hooks.delete(hookId);
  }

  private async triggerHooks(
    type: HarnessHookType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const relevant = Array.from(this.hooks.values())
      .filter((h) => h.type === type && h.enabled);

    for (const hook of relevant) {
      try {
        if (hook.condition(payload)) {
          await hook.action(payload);
        }
      } catch (error) {
        console.warn(`[MemoryHarness] Hook ${hook.id} failed:`, error);
      }
    }
  }

  private registerDefaultHooks(): void {
    // Auto-compound on memory recall
    this.registerHook({
      id: "auto-compound",
      type: "on_memory_recalled",
      condition: () => true,
      action: async (payload) => {
        const sessionId = payload.sessionId as string;
        if (sessionId && this.sessions.has(sessionId)) {
          const session = this.sessions.get(sessionId)!;
          session.compoundScore += 0.5;
        }
      },
      enabled: true,
      priority: 1,
    });

    // Log skill usage
    this.registerHook({
      id: "skill-logger",
      type: "on_skill_invoked",
      condition: () => true,
      action: async (payload) => {
        const skillId = payload.skillId as string;
        const skill = this.skills.get(skillId);
        if (skill) {
          skill.usageCount += 1;
        }
      },
      enabled: true,
      priority: 2,
    });
  }

  // ============================================
  // SKILL PACKAGING
  // ============================================

  registerSkill(pkg: SkillPackage): void {
    this.skills.set(pkg.id, pkg);
  }

  getSkill(skillId: string): SkillPackage | undefined {
    return this.skills.get(skillId);
  }

  listSkills(): SkillPackage[] {
    return Array.from(this.skills.values());
  }

  async invokeSkill(
    skillId: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new JASIMError({
        code: "AGENT_NOT_FOUND",
        message: Errors.skillNotFound,
        context: { skillId },
      });
    }

    await this.triggerHooks("on_skill_invoked", { skillId, params });

    // Return skill metadata and parameters
    return {
      skill: skill.name,
      version: skill.version,
      parameters: params,
      invokedAt: new Date().toISOString(),
    };
  }

  /**
   * Package a session's learnings into a skill
   */
  packageSessionSkills(sessionId: string, name: string, description: string): SkillPackage {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new JASIMError({
        code: "MEMORY_NOT_FOUND",
        message: Errors.sessionNotFound,
        context: { sessionId },
      });
    }

    const pkg: SkillPackage = {
      id: `skill_${Date.now()}`,
      name,
      description,
      version: "1.0",
      skills: session.agentHistory.map((h) => ({
        name: h.agent,
        description: `Learned from interaction: ${h.result}`,
        parameters: {},
        examples: [h.result],
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
      successRate: 0,
    };

    this.skills.set(pkg.id, pkg);
    return pkg;
  }

  // ============================================
  // UTILITIES
  // ============================================

  /**
   * Export session as markdown document
   */
  exportSessionAsMarkdown(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return "# Session Not Found\n";

    let md = `# Session Report\n\n`;
    md += `**Session ID:** ${session.sessionId}\n`;
    md += `**User:** ${session.userId}\n`;
    md += `**Started:** ${session.startedAt}\n`;
    md += `**Interactions:** ${session.interactions}\n`;
    md += `**Compound Score:** ${session.compoundScore.toFixed(2)}\n\n`;

    md += `## Intents\n`;
    session.intents.forEach((i) => { md += `- ${i}\n`; });

    md += `\n## Agent History\n`;
    session.agentHistory.forEach((h) => {
      md += `- **${h.agent}** (${h.timestamp}): ${h.result}\n`;
    });

    md += `\n## Preferences\n`;
    md += `\`\`\`json\n${JSON.stringify(session.preferences, null, 2)}\n\`\`\`\n`;

    return md;
  }

  /**
   * Get harness statistics
   */
  getStats(): {
    sessions: number;
    notes: number;
    skills: number;
    hooks: number;
  } {
    return {
      sessions: this.sessions.size,
      notes: this.noteCounter,
      skills: this.skills.size,
      hooks: this.hooks.size,
    };
  }
}

// ============================================
// LEGACY MEMORY FUNCTIONS (Backward Compatible)
// ============================================

export async function storeMemory(
  entry: Omit<MemoryEntry, "id" | "createdAt" | "compoundScore" | "markdownContent" | "sessionId" | "tags">,
): Promise<MemoryEntry> {
  const validated = StoreMemoryInputSchema.parse(entry);

  try {
    const valueStr = typeof validated.value === "string"
      ? validated.value
      : JSON.stringify(validated.value);

    const now = new Date();

    await db.insert(memory).values({
      userId: Number.parseInt(validated.userId) || 0,
      key: validated.key,
      value: valueStr,
      category: validated.type,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: `mem_${Date.now()}`,
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
      compoundScore: 1,
      tags: validated.tags || [],
    };
  } catch (error) {
    console.error("[MemoryEngine] storeMemory error:", error);
    throw new JASIMError({
      code: "MEMORY_STORE_FAILED",
      message: Errors.storeFailed,
      cause: error,
    });
  }
}

export async function recallMemory(
  userId: string,
  query: string,
  marketCode?: string,
  limit: number = 10,
): Promise<MemoryEntry[]> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;
    const queryPattern = `%${query}%`;

    const results = await db
      .select()
      .from(memory)
      .where(
        and(
          eq(memory.userId, userIdNum),
          sql`(${memory.key} LIKE ${queryPattern} OR ${memory.value} LIKE ${queryPattern})`,
        ),
      )
      .orderBy(desc(memory.createdAt))
      .limit(limit);

    return results.map((row) => {
      let parsedValue: unknown;
      try { parsedValue = JSON.parse(row.value); } catch { parsedValue = row.value; }

      return {
        id: String(row.id),
        userId: String(row.userId),
        marketCode: marketCode || "KW",
        type: (row.category as MemoryCategory) || "interaction",
        key: row.key,
        value: parsedValue,
        confidence: 0.8,
        source: "recall",
        isPermanent: false,
        createdAt: row.createdAt,
        compoundScore: 1,
        tags: [],
      };
    });
  } catch (error) {
    console.error("[MemoryEngine] recallMemory error:", error);
    return [];
  }
}

export async function getPreferences(userId: string): Promise<Record<string, unknown>> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;
    const results = await db
      .select()
      .from(memory)
      .where(and(eq(memory.userId, userIdNum), eq(memory.category, "preference")))
      .orderBy(desc(memory.createdAt));

    const preferences: Record<string, unknown> = {};
    for (const row of results) {
      let parsedValue: unknown;
      try { parsedValue = JSON.parse(row.value); } catch { parsedValue = row.value; }
      preferences[row.key] = parsedValue;
    }
    return preferences;
  } catch (error) {
    console.error("[MemoryEngine] getPreferences error:", error);
    return {};
  }
}

export async function updatePreference(userId: string, key: string, value: unknown): Promise<void> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;
    const valueStr = typeof value === "string" ? value : JSON.stringify(value);

    const existing = await db
      .select()
      .from(memory)
      .where(and(eq(memory.userId, userIdNum), eq(memory.key, key), eq(memory.category, "preference")))
      .limit(1);

    if (existing.length > 0) {
      await db.update(memory).set({ value: valueStr, updatedAt: new Date() }).where(eq(memory.id, existing[0].id));
    } else {
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
    throw new JASIMError({ code: "MEMORY_STORE_FAILED", message: Errors.storeFailed, cause: error });
  }
}

export async function getRecentInteractions(userId: string, limit: number = 20): Promise<MemoryEntry[]> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;
    const results = await db
      .select()
      .from(memory)
      .where(and(eq(memory.userId, userIdNum), eq(memory.category, "interaction")))
      .orderBy(desc(memory.createdAt))
      .limit(limit);

    return results.map((row) => ({
      id: String(row.id),
      userId: String(row.userId),
      marketCode: "KW",
      type: "interaction" as MemoryCategory,
      key: row.key,
      value: row.value,
      confidence: 1,
      source: "recent",
      isPermanent: false,
      createdAt: row.createdAt,
      compoundScore: 1,
      tags: [],
    }));
  } catch (error) {
    console.error("[MemoryEngine] getRecentInteractions error:", error);
    return [];
  }
}

export async function clearExpiredMemories(): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    await db.delete(memory).where(
      and(eq(memory.category, "interaction"), lt(memory.updatedAt, cutoffDate)),
    );

    return 0;
  } catch (error) {
    console.error("[MemoryEngine] clearExpiredMemories error:", error);
    throw new JASIMError({ code: "INTERNAL_ERROR", message: Errors.clearFailed, cause: error });
  }
}

export async function getMemoryStats(userId: string): Promise<{
  total: number;
  preferences: number;
  interactions: number;
  contexts: number;
  feedback: number;
  harnessNotes: number;
  sessionStates: number;
}> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;
    const results = await db.select().from(memory).where(eq(memory.userId, userIdNum));

    const stats = {
      total: results.length,
      preferences: 0,
      interactions: 0,
      contexts: 0,
      feedback: 0,
      harnessNotes: 0,
      sessionStates: 0,
    };

    for (const row of results) {
      switch (row.category) {
        case "preference": stats.preferences++; break;
        case "interaction": stats.interactions++; break;
        case "context": stats.contexts++; break;
        case "feedback": stats.feedback++; break;
        case "markdown_note": stats.harnessNotes++; break;
        case "session_state": stats.sessionStates++; break;
      }
    }

    return stats;
  } catch (error) {
    console.error("[MemoryEngine] getMemoryStats error:", error);
    return { total: 0, preferences: 0, interactions: 0, contexts: 0, feedback: 0, harnessNotes: 0, sessionStates: 0 };
  }
}

export async function storeInteraction(
  userId: string,
  key: string,
  value: unknown,
  marketCode: string = "KW",
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

export async function storeFeedback(
  userId: string,
  key: string,
  value: unknown,
  marketCode: string = "KW",
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

export async function deleteAllMemories(userId: string): Promise<number> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;
    await db.delete(memory).where(eq(memory.userId, userIdNum));
    return 0;
  } catch (error) {
    console.error("[MemoryEngine] deleteAllMemories error:", error);
    throw new JASIMError({ code: "INTERNAL_ERROR", message: Errors.clearFailed, cause: error });
  }
}

// ============================================
// SINGLETON EXPORTS
// ============================================

export const memoryHarness = new MemoryHarness();
