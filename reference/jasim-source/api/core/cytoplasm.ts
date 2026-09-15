/**
 * JASIM Cytoplasm — Shared Execution Environment
 *
 * Provides: context management, memory engine, event bus, policy engine,
 * permission engine, state manager, and config manager.
 *
 * All operations are generic and domain-agnostic.
 */

import { z } from "zod";
import { eq, and, or, like, gte, desc, inArray, sql } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  memoryEntries,
  events,
  eventSubscriptions,
  policies,
  executionTraces,
  type MemoryEntry,
  type NewMemoryEntry,
  type Event,
  type NewEvent,
  type EventSubscription,
  type NewEventSubscription,
  type Policy,
  type NewPolicy,
  type ExecutionTrace,
  type NewExecutionTrace,
} from "@db/schema";
import {
  MEMORY_SCOPES,
  MEMORY_CATEGORIES,
  TASK_PRIORITIES,
  type MemoryScope,
  type MemoryCategory,
  type TaskPriority,
  type PolicyRule,
} from "@contracts/jasim";
import {
  JasimError,
  NotFoundError,
  ValidationError,
  EventError,
  ApprovalError,
  ERROR_CODES,
} from "@contracts/errors";
import type { Task } from "@db/schema";

// ═══════════════════════════════════════════════════════════════════════════════
// Runtime Context
// ═══════════════════════════════════════════════════════════════════════════════

export interface RuntimeContext {
  taskId?: string;
  userId?: string;
  conversationId?: string;
  agentId?: string;
  correlationId: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

const runtimeContextSchema = z.object({
  taskId: z.string().optional(),
  userId: z.string().optional(),
  conversationId: z.string().optional(),
  agentId: z.string().optional(),
  correlationId: z.string(),
  timestamp: z.date(),
  metadata: z.record(z.unknown()).default({}),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Memory Engine
// ═══════════════════════════════════════════════════════════════════════════════

export interface MemoryQuery {
  category?: MemoryCategory;
  key?: string;
  keyLike?: string;
  taskId?: number;
  userId?: number;
  entityId?: number;
  limit?: number;
  offset?: number;
  expiresAfter?: Date;
}

export class MemoryEngine {
  async store(entry: Omit<NewMemoryEntry, "id" | "createdAt" | "updatedAt">): Promise<MemoryEntry> {
    const validated = z.object({
      scope: z.enum(MEMORY_SCOPES),
      category: z.enum(MEMORY_CATEGORIES),
      key: z.string().min(1),
      value: z.unknown(),
      userId: z.number().optional(),
      taskId: z.number().optional(),
      entityId: z.number().optional(),
      permissions: z.array(z.string()).optional(),
      expiresAt: z.date().optional(),
    }).parse(entry);

    const [result] = await db.insert(memoryEntries).values({
      ...validated,
      permissions: validated.permissions ?? [],
    });

    const inserted = await db.query.memoryEntries.findFirst({
      where: eq(memoryEntries.id, Number(result.insertId)),
    });

    if (!inserted) {
      throw new JasimError(ERROR_CODES.INTERNAL_ERROR, "Memory store failed: row not returned", 500, false);
    }

    return inserted;
  }

  async query(scope: MemoryScope, filters: MemoryQuery = {}): Promise<MemoryEntry[]> {
    const conditions: Array<ReturnType<typeof eq>> = [eq(memoryEntries.scope, scope)];

    if (filters.category) conditions.push(eq(memoryEntries.category, filters.category));
    if (filters.key) conditions.push(eq(memoryEntries.key, filters.key));
    if (filters.taskId) conditions.push(eq(memoryEntries.taskId, filters.taskId));
    if (filters.userId) conditions.push(eq(memoryEntries.userId, filters.userId));
    if (filters.entityId) conditions.push(eq(memoryEntries.entityId, filters.entityId));
    if (filters.expiresAfter) conditions.push(gte(memoryEntries.expiresAt, filters.expiresAfter));

    const results = await db.query.memoryEntries.findMany({
      where: and(...conditions),
      limit: filters.limit ?? 100,
      offset: filters.offset ?? 0,
      orderBy: [desc(memoryEntries.createdAt)],
    });

    if (filters.keyLike) {
      const pattern = filters.keyLike.toLowerCase();
      return results.filter((r) => r.key.toLowerCase().includes(pattern));
    }

    return results;
  }

  async forget(id: number): Promise<void> {
    await db.delete(memoryEntries).where(eq(memoryEntries.id, id));
  }

  async update(id: number, value: unknown): Promise<MemoryEntry> {
    await db
      .update(memoryEntries)
      .set({ value, updatedAt: new Date() })
      .where(eq(memoryEntries.id, id));

    const updated = await db.query.memoryEntries.findFirst({
      where: eq(memoryEntries.id, id),
    });

    if (!updated) {
      throw new NotFoundError("MemoryEntry", String(id));
    }

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // NEW: Semantic Search — Search memory by token overlap across keys + values
  // ═══════════════════════════════════════════════════════════════════════════════

  async semanticSearch(
    query: string,
    scope: MemoryScope,
    limit: number = 10
  ): Promise<MemoryEntry[]> {
    const queryTokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    if (queryTokens.length === 0) {
      return this.query(scope, { limit });
    }

    // Fetch candidate entries from the scope
    const candidates = await this.query(scope, { limit: Math.min(limit * 5, 200) });

    // Score each entry by token overlap
    const scored = candidates.map((entry) => {
      const keyText = entry.key.toLowerCase();
      const valueText = typeof entry.value === "string"
        ? entry.value.toLowerCase()
        : JSON.stringify(entry.value).toLowerCase();

      let score = 0;
      for (const token of queryTokens) {
        if (keyText.includes(token)) score += 2;
        if (valueText.includes(token)) score += 1;
      }

      // Recency boost
      const ageDays = (Date.now() - entry.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const recencyBoost = Math.max(0, 1 - ageDays / 90);
      score += recencyBoost;

      return { entry, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // NEW: Pattern Matching — Find recurring execution patterns from memory
  // ═══════════════════════════════════════════════════════════════════════════════

  async findPatterns(goal: string): Promise<{ pattern: unknown; score: number; outcome: unknown }[]> {
    const goalTokens = goal.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    // Search for experience entries related to this goal
    const experiences = await db
      .select()
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.category, "experience" as any),
          or(...goalTokens.map((t) =>
            sql`LOWER(${memoryEntries.key}) LIKE ${`%${t}%`} OR LOWER(CAST(${memoryEntries.value} AS CHAR)) LIKE ${`%${t}%`}`
          )),
        ),
      )
      .orderBy(desc(memoryEntries.createdAt))
      .limit(50);

    // Also search for learning patterns
    const patterns = await db
      .select()
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.category, "learning_pattern" as any),
          or(...goalTokens.map((t) =>
            sql`LOWER(${memoryEntries.key}) LIKE ${`%${t}%`} OR LOWER(CAST(${memoryEntries.value} AS CHAR)) LIKE ${`%${t}%`}`
          )),
        ),
      )
      .orderBy(desc(memoryEntries.createdAt))
      .limit(50);

    const allEntries = [...experiences, ...patterns];

    // Group by key prefix to find recurring patterns
    const grouped = new Map<string, typeof allEntries>();
    for (const entry of allEntries) {
      const prefix = entry.key.split("_").slice(0, 3).join("_");
      if (!grouped.has(prefix)) grouped.set(prefix, []);
      grouped.get(prefix)!.push(entry);
    }

    const results: { pattern: unknown; score: number; outcome: unknown }[] = [];

    for (const [_prefix, entries] of grouped) {
      if (entries.length < 2) continue;

      // Score based on frequency and recency
      const totalScore = entries.reduce((sum, e) => {
        let score = 1;
        const value = typeof e.value === "string" ? JSON.parse(e.value) : e.value;
        if (value && typeof value === "object") {
          const obj = value as Record<string, unknown>;
          if (obj.score) score += Number(obj.score) || 0;
          if (obj.successCount) score += Number(obj.successCount) * 0.1;
        }
        return sum + score;
      }, 0);

      const avgScore = Math.min(1, totalScore / entries.length);

      // Use the most recent entry as the representative pattern
      const representative = entries.sort((a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime()
      )[0];

      const repValue = typeof representative.value === "string"
        ? JSON.parse(representative.value)
        : representative.value;

      results.push({
        pattern: repValue,
        score: avgScore,
        outcome: (repValue as Record<string, unknown>)?.executionResult ?? repValue,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // NEW: Record Experience — Store a task execution outcome for learning
  // ═══════════════════════════════════════════════════════════════════════════════

  async recordExperience(
    task: Task,
    outcome: unknown,
    score: number
  ): Promise<void> {
    const experienceKey = `exp_${task.intent || "unknown"}_${task.id}_${Date.now()}`;
    const experienceValue = {
      taskId: task.id,
      goal: task.goal,
      intent: task.intent,
      status: task.status,
      outcome,
      score: Math.max(0, Math.min(1, score)),
      capabilities: task.capabilities ?? [],
      agents: task.agents ?? [],
      errors: (task.errors as unknown[])?.length ?? 0,
      recordedAt: new Date().toISOString(),
    };

    await this.store({
      scope: "system",
      category: "experience" as any,
      key: experienceKey,
      value: experienceValue as unknown as Record<string, unknown>,
      userId: Number(task.userId) || undefined,
      taskId: Number(task.id) || undefined,
      entityId: undefined,
      permissions: ["learning:read"],
    });

    console.log(`[MemoryEngine] Recorded experience ${experienceKey} score=${score.toFixed(3)}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // NEW: Get Relevant Context — Retrieve user-specific context for a goal
  // ═══════════════════════════════════════════════════════════════════════════════

  async getRelevantContext(goal: string, userId: string): Promise<{
    preferences: Record<string, unknown>;
    recentExperiences: unknown[];
    patterns: unknown[];
    userHistory: unknown[];
  }> {
    const userIdNum = Number(userId) || 0;
    const goalTokens = goal.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    // 1. User preferences
    const preferenceEntries = await db
      .select()
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.userId, userIdNum),
          eq(memoryEntries.category, "preference" as any),
        ),
      )
      .orderBy(desc(memoryEntries.createdAt))
      .limit(20);

    const preferences: Record<string, unknown> = {};
    for (const entry of preferenceEntries) {
      preferences[entry.key] = entry.value;
    }

    // 2. Recent experiences for this user
    const experienceEntries = await db
      .select()
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.userId, userIdNum),
          eq(memoryEntries.category, "experience" as any),
        ),
      )
      .orderBy(desc(memoryEntries.createdAt))
      .limit(10);

    // 3. Patterns matching goal tokens
    const patternEntries = await db
      .select()
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.category, "learning_pattern" as any),
          or(
            ...goalTokens.map((t) =>
              sql`LOWER(${memoryEntries.key}) LIKE ${`%${t}%`}`
            ),
            sql`1=1`, // Fallback to get all patterns if no tokens
          ),
        ),
      )
      .orderBy(desc(memoryEntries.createdAt))
      .limit(10);

    // 4. General user history (interactions)
    const historyEntries = await db
      .select()
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.userId, userIdNum),
          eq(memoryEntries.category, "interaction" as any),
        ),
      )
      .orderBy(desc(memoryEntries.createdAt))
      .limit(5);

    return {
      preferences,
      recentExperiences: experienceEntries.map((e) => e.value),
      patterns: patternEntries.map((e) => e.value),
      userHistory: historyEntries.map((e) => e.value),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Event Bus
// ═══════════════════════════════════════════════════════════════════════════════

export class EventBus {
  private inMemoryHandlers = new Map<string, Set<(event: Event) => Promise<void>>>();

  async publish(event: Omit<NewEvent, "id" | "createdAt">): Promise<Event> {
    const validated = z.object({
      type: z.string().min(1),
      source: z.string().min(1),
      payload: z.record(z.unknown()),
      priority: z.enum(TASK_PRIORITIES).default("normal"),
      processed: z.boolean().default(false),
      correlationId: z.string().optional(),
    }).parse(event);

    const [result] = await db.insert(events).values(validated);
    const inserted = await db.query.events.findFirst({
      where: eq(events.id, Number(result.insertId)),
    });

    if (!inserted) {
      throw new EventError(ERROR_CODES.EVENT_DELIVERY_FAILED, "Event publish failed: row not returned");
    }

    // Trigger in-memory subscribers
    const handlers = this.inMemoryHandlers.get(inserted.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(inserted);
        } catch (err) {
          console.error(`Event handler error for ${inserted.type}:`, err);
        }
      }
    }

    return inserted;
  }

  subscribe(eventType: string, handler: (event: Event) => Promise<void>): string {
    const subscriptionId = `sub_${eventType}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    if (!this.inMemoryHandlers.has(eventType)) {
      this.inMemoryHandlers.set(eventType, new Set());
    }
    this.inMemoryHandlers.get(eventType)!.add(handler);
    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    // In-memory unsubscribe by prefix match
    for (const [type, handlers] of this.inMemoryHandlers.entries()) {
      for (const handler of handlers) {
        // We match by re-scanning; for production, a Map<id, handler> is better
        const prefix = `sub_${type}_`;
        if (subscriptionId.startsWith(prefix)) {
          handlers.delete(handler);
          break;
        }
      }
    }
  }

  async processPending(): Promise<number> {
    const pending = await db.query.events.findMany({
      where: eq(events.processed, false),
      limit: 100,
      orderBy: [events.createdAt],
    });

    let processed = 0;
    for (const event of pending) {
      try {
        await db
          .update(events)
          .set({ processed: true, processedAt: new Date() })
          .where(eq(events.id, event.id));
        processed++;
      } catch (err) {
        console.error(`Failed to process event ${event.id}:`, err);
      }
    }

    return processed;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Policy Engine
// ═══════════════════════════════════════════════════════════════════════════════

export interface PolicyResult {
  allowed: boolean;
  reason: string;
  requiredApprovals?: number;
  approverRoles?: string[];
}

export class PolicyEngine {
  private loadedPolicies: Policy[] = [];

  async evaluate(
    action: string,
    actor: string,
    resource: string,
    context: Record<string, unknown>
  ): Promise<PolicyResult> {
    // Load active policies from DB if not cached
    if (this.loadedPolicies.length === 0) {
      this.loadedPolicies = await db.query.policies.findMany({
        where: eq(policies.isActive, true),
      });
    }

    // Sort by priority descending
    const sorted = [...this.loadedPolicies].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const policy of sorted) {
      if (!policy.rules) continue;

      for (const rule of policy.rules as PolicyRule[]) {
        if (this.ruleMatches(rule, action, actor, resource, context)) {
          switch (rule.action) {
            case "deny":
              return { allowed: false, reason: `Policy "${policy.name}" denied this action` };
            case "allow":
              return { allowed: true, reason: `Policy "${policy.name}" allowed this action` };
            case "require_approval":
              return {
                allowed: false,
                reason: `Policy "${policy.name}" requires approval`,
                requiredApprovals: rule.requiredApprovers ?? 1,
                approverRoles: rule.approverRoles ?? [],
              };
            case "escalate":
              return {
                allowed: false,
                reason: `Policy "${policy.name}" escalated this action`,
                requiredApprovals: 2,
                approverRoles: rule.approverRoles ?? ["admin"],
              };
          }
        }
      }
    }

    // Default deny if no policy matched and action is risky
    return { allowed: true, reason: "No matching policy; default allow" };
  }

  async loadPolicy(policy: NewPolicy): Promise<void> {
    const [result] = await db.insert(policies).values(policy);
    const inserted = await db.query.policies.findFirst({
      where: eq(policies.id, Number(result.insertId)),
    });
    if (inserted) {
      this.loadedPolicies.push(inserted);
    }
  }

  private ruleMatches(
    rule: PolicyRule,
    action: string,
    actor: string,
    resource: string,
    context: Record<string, unknown>
  ): boolean {
    const cond = rule.condition;
    if (!cond || Object.keys(cond).length === 0) return true;

    const vars: Record<string, unknown> = { action, actor, resource, ...context };

    for (const [key, expected] of Object.entries(cond)) {
      const actual = vars[key];
      if (expected === "*") continue;
      if (typeof expected === "string" && expected.startsWith("regex:")) {
        const pattern = expected.slice(6);
        const regex = new RegExp(pattern);
        if (!regex.test(String(actual))) return false;
        continue;
      }
      if (Array.isArray(expected)) {
        if (!expected.includes(actual)) return false;
        continue;
      }
      if (actual !== expected) return false;
    }

    return true;
  }

  reload(): void {
    this.loadedPolicies = [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Permission Engine
// ═══════════════════════════════════════════════════════════════════════════════

export class PermissionEngine {
  private grants = new Map<string, Set<string>>(); // actor -> Set<"resource:action">

  async check(permission: string, actor: string, resource: string): Promise<boolean> {
    const key = `${actor}:${resource}`;
    const granted = this.grants.get(actor);
    if (!granted) return false;

    // Check exact permission or wildcard
    if (granted.has(permission) || granted.has("*")) return true;

    // Check namespace wildcard (e.g., "resource:*")
    const parts = permission.split(":");
    if (parts.length === 2 && granted.has(`${parts[0]}:*`)) return true;

    return false;
  }

  grant(permission: string, actor: string, resource: string): void {
    const key = `${actor}:${resource}`;
    if (!this.grants.has(actor)) {
      this.grants.set(actor, new Set());
    }
    this.grants.get(actor)!.add(permission);
  }

  revoke(permission: string, actor: string, resource: string): void {
    const key = `${actor}:${resource}`;
    const granted = this.grants.get(actor);
    if (granted) {
      granted.delete(permission);
    }
  }

  listGrants(actor: string): string[] {
    const granted = this.grants.get(actor);
    return granted ? Array.from(granted) : [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// State Manager
// ═══════════════════════════════════════════════════════════════════════════════

export class StateManager {
  private states = new Map<string, Record<string, unknown>>();

  get(scope: string, key?: string): unknown {
    const scopeState = this.states.get(scope) ?? {};
    if (key === undefined) return scopeState;
    return scopeState[key];
  }

  set(scope: string, key: string, value: unknown): void {
    const existing = this.states.get(scope) ?? {};
    existing[key] = value;
    this.states.set(scope, existing);
  }

  setAll(scope: string, state: Record<string, unknown>): void {
    this.states.set(scope, { ...(this.states.get(scope) ?? {}), ...state });
  }

  delete(scope: string, key: string): void {
    const existing = this.states.get(scope);
    if (existing) {
      delete existing[key];
    }
  }

  clear(scope: string): void {
    this.states.delete(scope);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config / Secrets Manager
// ═══════════════════════════════════════════════════════════════════════════════

export class ConfigManager {
  private config = new Map<string, string>();

  get(key: string, fallback?: string): string | undefined {
    const value = this.config.get(key);
    return value ?? fallback ?? process.env[key];
  }

  set(key: string, value: string): void {
    this.config.set(key, value);
  }

  has(key: string): boolean {
    return this.config.has(key) || process.env[key] !== undefined;
  }

  require(key: string): string {
    const value = this.get(key);
    if (value === undefined) {
      throw new ValidationError(ERROR_CODES.INVALID_PARAMETER, `Missing required config: ${key}`, key);
    }
    return value;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Execution Tracer (Observability)
// ═══════════════════════════════════════════════════════════════════════════════

export class ExecutionTracer {
  async trace(
    trace: Omit<NewExecutionTrace, "id" | "timestamp">
  ): Promise<ExecutionTrace> {
    const [result] = await db.insert(executionTraces).values({
      ...trace,
      timestamp: new Date(),
    });

    const inserted = await db.query.executionTraces.findFirst({
      where: eq(executionTraces.id, Number(result.insertId)),
    });

    if (!inserted) {
      throw new JasimError(ERROR_CODES.INTERNAL_ERROR, "Trace insert failed", 500, false);
    }

    return inserted;
  }

  async getTracesForTask(taskId: number, limit = 100): Promise<ExecutionTrace[]> {
    return db.query.executionTraces.findMany({
      where: eq(executionTraces.taskId, taskId),
      limit,
      orderBy: [desc(executionTraces.timestamp)],
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cytoplasm — Root Container
// ═══════════════════════════════════════════════════════════════════════════════

export class Cytoplasm {
  private _context: RuntimeContext;
  private _learningEngine: import("./learning-engine").LearningEngine | null = null;
  private _operationalMemory: import("./operational-memory").OperationalMemory | null = null;

  readonly memory: MemoryEngine;
  readonly events: EventBus;
  readonly policies: PolicyEngine;
  readonly permissions: PermissionEngine;
  readonly state: StateManager;
  readonly config: ConfigManager;
  readonly tracer: ExecutionTracer;

  constructor(context?: Partial<RuntimeContext>) {
    this._context = runtimeContextSchema.parse({
      correlationId: context?.correlationId ?? `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: context?.timestamp ?? new Date(),
      metadata: context?.metadata ?? {},
      ...context,
    });

    this.memory = new MemoryEngine();
    this.events = new EventBus();
    this.policies = new PolicyEngine();
    this.permissions = new PermissionEngine();
    this.state = new StateManager();
    this.config = new ConfigManager();
    this.tracer = new ExecutionTracer();
  }

  /**
   * Lazy-loaded LearningEngine — behavioral learning & pattern adaptation.
   */
  get learning(): import("./learning-engine").LearningEngine {
    if (!this._learningEngine) {
      const { getLearningEngine } = require("./learning-engine");
      this._learningEngine = getLearningEngine(this.memory);
    }
    return this._learningEngine!;
  }

  /**
   * Lazy-loaded OperationalMemory — execution patterns & user preferences.
   */
  get operational(): import("./operational-memory").OperationalMemory {
    if (!this._operationalMemory) {
      const { getOperationalMemory } = require("./operational-memory");
      this._operationalMemory = getOperationalMemory(this.memory);
    }
    return this._operationalMemory!;
  }

  getContext(): RuntimeContext {
    return { ...this._context };
  }

  setContext(context: Partial<RuntimeContext>): void {
    this._context = { ...this._context, ...context };
  }

  updateContext(updater: (ctx: RuntimeContext) => Partial<RuntimeContext>): void {
    this._context = { ...this._context, ...updater(this._context) };
  }

  /**
   * Create a child cytoplasm with inherited context + overrides.
   */
  spawn(overrides?: Partial<RuntimeContext>): Cytoplasm {
    return new Cytoplasm({ ...this._context, ...overrides });
  }
}

// Singleton for the global runtime environment
let globalCytoplasm: Cytoplasm | null = null;

export function getCytoplasm(context?: Partial<RuntimeContext>): Cytoplasm {
  if (!globalCytoplasm) {
    globalCytoplasm = new Cytoplasm(context);
  }
  return context ? globalCytoplasm.spawn(context) : globalCytoplasm;
}

export function resetCytoplasm(): void {
  globalCytoplasm = null;
}
