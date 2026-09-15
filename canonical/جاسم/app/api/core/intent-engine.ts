/**
 * JASIM Intent Engine V2 — Semantic Intent Classification with LLM
 *
 * Hybrid approach:
 *   1. FAST PATH: Regex pattern matching for common, unambiguous intents
 *   2. LLM PATH: Deep semantic understanding for novel, ambiguous, or complex inputs
 *   3. Entity extraction via LLM (with regex fallback)
 *   4. Constraint extraction via LLM (with regex fallback)
 *   5. Ambiguity detection for clarifying questions
 *
 * All LLM calls go through the LLM Router for cost-optimized multi-model routing.
 */

import { z } from "zod";
import { DNA_PRIMITIVES, type TaskPriority } from "@contracts/jasim";
import { ValidationError, ERROR_CODES } from "@contracts/errors";
import { llmRouter } from "./llm-router";
import type { ExecutionContext } from "./tool-runtime";
import { getCytoplasm } from "./cytoplasm";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface Entity {
  type: string;
  value: string;
  confidence: number;
  start?: number;
  end?: number;
  metadata?: Record<string, unknown>;
}

export interface Intent {
  type: string;
  confidence: number;
  entities: Entity[];
  goal: string;
  constraints: Record<string, unknown>;
  requiredCapabilities: string[];
  suggestedPrimitives: string[];
  sentiment?: "positive" | "neutral" | "negative";
  urgency?: "low" | "medium" | "high" | "critical";
}

export interface ConversationContext {
  conversationId?: string;
  userId?: string;
  previousMessages: Array<{ role: string; content: string; intent?: string }>;
  activeTaskId?: string;
  accumulatedContext: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Zod Schemas for LLM Output Validation
// ═══════════════════════════════════════════════════════════════════════════════

const LlmEntitySchema = z.object({
  type: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1).default(0.8),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const LlmIntentSchema = z.object({
  type: z.string(),
  confidence: z.number().min(0).max(1),
  goal: z.string(),
  requiredCapabilities: z.array(z.string()).default([]),
  suggestedPrimitives: z.array(z.string()).default([]),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).optional(),
});

const LlmEntityExtractionSchema = z.object({
  entities: z.array(LlmEntitySchema).default([]),
});

const LlmConstraintExtractionSchema = z.object({
  constraints: z.record(z.string(), z.unknown()).default({}),
});

const LlmAmbiguitySchema = z.object({
  ambiguous: z.boolean(),
  reason: z.string().optional(),
  questions: z.array(z.string()).default([]),
});

const LlmGoalExtractionSchema = z.object({
  goal: z.string(),
  specificity: z.number().min(0).max(1).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Generic Pattern Definitions (not domain-specific) — FAST PATH
// ═══════════════════════════════════════════════════════════════════════════════

interface IntentPattern {
  name: string;
  patterns: RegExp[];
  requiredCapabilities: string[];
  suggestedPrimitives: string[];
  weight: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    name: "create",
    patterns: [/\b(create|make|build|generate|new|produce|design|draft)\b/i],
    requiredCapabilities: ["create", "generate"],
    suggestedPrimitives: [DNA_PRIMITIVES.CREATE, DNA_PRIMITIVES.GENERATE],
    weight: 1.0,
  },
  {
    name: "find",
    patterns: [/\b(find|search|look for|seek|locate|discover|where is)\b/i],
    requiredCapabilities: ["search", "discover"],
    suggestedPrimitives: [DNA_PRIMITIVES.SEARCH, DNA_PRIMITIVES.DISCOVER],
    weight: 1.0,
  },
  {
    name: "compare",
    patterns: [/\b(compare|versus|vs|difference|better|best|or|between)\b/i],
    requiredCapabilities: ["compare", "analyze"],
    suggestedPrimitives: [DNA_PRIMITIVES.COMPARE, DNA_PRIMITIVES.ANALYZE],
    weight: 1.0,
  },
  {
    name: "calculate",
    patterns: [/\b(calculate|compute|sum|total|how much|cost of|price|math)\b/i],
    requiredCapabilities: ["calculate"],
    suggestedPrimitives: [DNA_PRIMITIVES.CALCULATE, DNA_PRIMITIVES.ANALYZE],
    weight: 1.0,
  },
  {
    name: "book",
    patterns: [/\b(book|reserve|schedule|appointment|meeting|slot)\b/i],
    requiredCapabilities: ["book", "schedule"],
    suggestedPrimitives: [DNA_PRIMITIVES.BOOK, DNA_PRIMITIVES.SCHEDULE],
    weight: 1.0,
  },
  {
    name: "buy",
    patterns: [/\b(buy|purchase|order|pay for|checkout|cart|get me)\b/i],
    requiredCapabilities: ["buy", "negotiate"],
    suggestedPrimitives: [DNA_PRIMITIVES.BUY, DNA_PRIMITIVES.NEGOTIATE],
    weight: 1.0,
  },
  {
    name: "sell",
    patterns: [/\b(sell|offer|list for sale|listing|market)\b/i],
    requiredCapabilities: ["sell", "negotiate"],
    suggestedPrimitives: [DNA_PRIMITIVES.SELL, DNA_PRIMITIVES.LIST],
    weight: 1.0,
  },
  {
    name: "track",
    patterns: [/\b(track|status of|where is my|follow|progress|update on)\b/i],
    requiredCapabilities: ["track", "monitor"],
    suggestedPrimitives: [DNA_PRIMITIVES.TRACK, DNA_PRIMITIVES.MONITOR],
    weight: 1.0,
  },
  {
    name: "modify",
    patterns: [/\b(update|change|modify|edit|delete|remove|cancel|undo)\b/i],
    requiredCapabilities: ["write", "validate"],
    suggestedPrimitives: [DNA_PRIMITIVES.WRITE, DNA_PRIMITIVES.VALIDATE],
    weight: 0.9,
  },
  {
    name: "ask",
    patterns: [/\b(what is|who is|how to|why does|when did|where is|explain|tell me)\b/i],
    requiredCapabilities: ["understand", "reason"],
    suggestedPrimitives: [DNA_PRIMITIVES.UNDERSTAND, DNA_PRIMITIVES.REASON],
    weight: 0.9,
  },
  {
    name: "delegate",
    patterns: [/\b(delegate|assign|hand off|forward|send to|escalate)\b/i],
    requiredCapabilities: ["delegate", "communicate"],
    suggestedPrimitives: [DNA_PRIMITIVES.DELEGATE, DNA_PRIMITIVES.COMMUNICATE],
    weight: 0.9,
  },
  {
    name: "verify",
    patterns: [/\b(verify|check|confirm|validate|is it true|authentic)\b/i],
    requiredCapabilities: ["verify", "validate"],
    suggestedPrimitives: [DNA_PRIMITIVES.VERIFY, DNA_PRIMITIVES.VALIDATE],
    weight: 0.9,
  },
  {
    name: "transform",
    patterns: [/\b(convert|transform|change to|turn into|reformat|translate)\b/i],
    requiredCapabilities: ["transform", "interpret"],
    suggestedPrimitives: [DNA_PRIMITIVES.TRANSFORM, DNA_PRIMITIVES.INTERPRET],
    weight: 0.9,
  },
  {
    name: "analyze",
    patterns: [/\b(analyze|examine|review|inspect|study|diagnose|assess)\b/i],
    requiredCapabilities: ["analyze", "reason"],
    suggestedPrimitives: [DNA_PRIMITIVES.ANALYZE, DNA_PRIMITIVES.REASON],
    weight: 0.9,
  },
  {
    name: "plan",
    patterns: [/\b(plan|strategy|roadmap|steps|how do I|guide me|help me)\b/i],
    requiredCapabilities: ["plan", "decompose"],
    suggestedPrimitives: [DNA_PRIMITIVES.PLAN, DNA_PRIMITIVES.DECOMPOSE],
    weight: 0.9,
  },
  {
    name: "negotiate",
    patterns: [/\b(negotiate|bargain|discount|deal|offer|counteroffer|best price)\b/i],
    requiredCapabilities: ["negotiate"],
    suggestedPrimitives: [DNA_PRIMITIVES.NEGOTIATE, DNA_PRIMITIVES.COMPARE],
    weight: 0.9,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Entity Extractor Patterns (regex fallback)
// ═══════════════════════════════════════════════════════════════════════════════

const ENTITY_PATTERNS: Array<{
  type: string;
  pattern: RegExp;
  extract: (match: RegExpMatchArray) => string;
}> = [
  {
    type: "email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    extract: (m) => m[0],
  },
  {
    type: "url",
    pattern: /https?:\/\/[^\s]+/g,
    extract: (m) => m[0],
  },
  {
    type: "number",
    pattern: /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g,
    extract: (m) => m[0].replace(/,/g, ""),
  },
  {
    type: "date",
    pattern: /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}(?:,?) \d{4}\b/gi,
    extract: (m) => m[0],
  },
  {
    type: "time",
    pattern: /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi,
    extract: (m) => m[0],
  },
  {
    type: "phone",
    pattern: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    extract: (m) => m[0],
  },
  {
    type: "price",
    pattern: /\$\s*\d+(?:\.\d{2})?|\d+(?:\.\d{2})?\s*(?:USD|EUR|GBP|CAD|AUD)/gi,
    extract: (m) => m[0],
  },
  {
    type: "percentage",
    pattern: /\b\d+(?:\.\d+)?%\b/g,
    extract: (m) => m[0],
  },
  {
    type: "quoted",
    pattern: /"([^"]+)"|'([^']+)'/g,
    extract: (m) => m[1] ?? m[2],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Intent Engine V2
// ═══════════════════════════════════════════════════════════════════════════════

export class IntentEngine {

  // ── MAIN ENTRY: Hybrid Classification ──────────────────────────────────────

  /**
   * Classify user input using MEMORY-INFLUENCED hybrid approach:
   * 1. Retrieve user memory & learned patterns (injects behavioral context)
   * 2. Fast path: regex pattern matching (if confidence > 0.7)
   * 3. LLM path: semantic understanding WITH memory context
   * 4. Blend with memory insights for behavioral adaptation
   *
   * MEMORY RULE: Every retrieval influences the final intent.
   */
  async classify(input: string, context: ConversationContext = { previousMessages: [] }): Promise<Intent> {
    if (!input || typeof input !== "string") {
      throw new ValidationError(ERROR_CODES.VALIDATION_FAILED, "Input must be a non-empty string", "input");
    }

    const trimmed = input.trim();
    if (trimmed.length === 0) {
      throw new ValidationError(ERROR_CODES.VALIDATION_FAILED, "Input cannot be empty", "input");
    }

    // ── MEMORY RETRIEVAL: Get user context & learned patterns ──────────────
    let userMemory: Record<string, unknown> = {};
    let learnedPatterns: Array<{ pattern: unknown; score: number; outcome: unknown }> = [];
    let userPreferences: Record<string, unknown> = {};

    if (context.userId) {
      try {
        const cytoplasm = getCytoplasm();
        // Parallel memory retrieval — NEVER retrieve without using
        const [memCtx, patterns, prefs] = await Promise.all([
          cytoplasm.memory.getRelevantContext(trimmed, context.userId),
          cytoplasm.memory.findPatterns(trimmed),
          cytoplasm.operational.getUserPreferences(context.userId),
        ]);

        userMemory = memCtx as Record<string, unknown>;
        learnedPatterns = patterns;
        userPreferences = prefs;
      } catch (memErr) {
        console.warn("[IntentEngine] Memory retrieval failed:", memErr instanceof Error ? memErr.message : String(memErr));
      }
    }

    // Step 2: FAST PATH — Regex-based classification
    const regexResult = this.regexClassify(trimmed, context);
    if (regexResult && regexResult.confidence > 0.7) {
      // Apply memory insights even on fast path
      return this.blendWithMemory(regexResult, userMemory, learnedPatterns, userPreferences);
    }

    // Step 3: LLM PATH — Semantic understanding WITH memory context
    try {
      const llmResult = await this.llmClassifyWithMemory(trimmed, context, userMemory, learnedPatterns, userPreferences);

      // Step 4: BLEND — Merge regex + LLM + memory insights
      let result: Intent;
      if (regexResult && regexResult.confidence > 0.4) {
        result = this.blendIntents(regexResult, llmResult, 0.35);
      } else {
        result = llmResult;
      }

      // CRITICAL: Memory must INFLENCE execution — blend with learned patterns
      result = this.blendWithMemory(result, userMemory, learnedPatterns, userPreferences);

      // Enrich with regex-extracted entities as fallback
      if (result.entities.length === 0) {
        result.entities = regexResult?.entities ?? [];
      }

      return result;
    } catch (err) {
      // LLM failed — gracefully fallback to regex + memory blend
      console.warn("[IntentEngine] LLM classification failed, falling back to regex:", err instanceof Error ? err.message : String(err));
      const fallback = regexResult ?? this.createGenericIntent(trimmed);
      return this.blendWithMemory(fallback, userMemory, learnedPatterns, userPreferences);
    }
  }

  // ── Entity Extraction ────────────────────────────────────────────────────────

  /**
   * Extract entities from input using LLM, with regex fallback.
   */
  async extractEntities(input: string): Promise<Entity[]> {
    if (!input || input.trim().length === 0) return [];

    try {
      const response = await llmRouter.route({
        prompt: `Extract all entities from the following user message. Return ONLY valid JSON.

User message: "${input.replace(/"/g, '\\"')}"

Return JSON in this exact format:
{
  "entities": [
    { "type": "person|organization|location|date|time|price|email|phone|product|service|quantity|custom", "value": "extracted value", "confidence": 0.95, "metadata": {} }
  ]
}

Rules:
- Extract specific named entities (people, companies, places, products, services)
- Extract structured data like dates, times, prices, emails, phone numbers
- Extract quantities and measurements
- Set confidence based on clarity of the mention (0.0-1.0)
- Include optional metadata for disambiguation`,
        systemPrompt: "You are a precise entity extraction engine. Extract structured entities from natural language. Return only valid JSON.",
        responseFormat: "json",
        complexity: "simple",
        maxTokens: 800,
        temperature: 0.1,
      });

      if (response.error || !response.text) {
        throw new Error(response.error ?? "Empty LLM response");
      }

      const parsed = this.safeJsonParse(response.text);
      const validated = LlmEntityExtractionSchema.safeParse(parsed);

      if (validated.success && validated.data.entities.length > 0) {
        return validated.data.entities.map((e) => ({
          type: e.type,
          value: e.value,
          confidence: e.confidence,
          metadata: e.metadata,
        }));
      }
    } catch (err) {
      console.warn("[IntentEngine] LLM entity extraction failed, using regex fallback:", err instanceof Error ? err.message : String(err));
    }

    // Fallback to regex entity extraction
    return this.regexExtractEntities(input);
  }

  // ── Constraint Extraction ────────────────────────────────────────────────────

  /**
   * Extract constraints (budget, timeline, quality, preferences) from input using LLM.
   */
  async extractConstraints(input: string): Promise<Record<string, unknown>> {
    if (!input || input.trim().length === 0) return {};

    try {
      const response = await llmRouter.route({
        prompt: `Extract constraints and preferences from the following user message. Return ONLY valid JSON.

User message: "${input.replace(/"/g, '\\"')}"

Return JSON in this exact format:
{
  "constraints": {
    "budget": { "max": number, "currency": "USD" } | null,
    "timeline": { "deadline": "description", "urgency": "low|medium|high|critical" } | null,
    "quality": "high|medium|low|economy|premium" | null,
    "quantity": number | null,
    "location": string | null,
    "preferences": ["preference1", "preference2"] | null,
    "exclusions": ["exclude1", "exclude2"] | null,
    "custom": { "key": "value" } | null
  }
}

Rules:
- Only include constraints explicitly mentioned or strongly implied
- Use null for constraints not mentioned
- Budget: extract max amounts, price ranges, cost limits
- Timeline: extract deadlines, urgency words (asap, soon, eventually)
- Quality: extract preference indicators (best, cheapest, premium, budget)
- Preferences: extract positive preferences (fast shipping, organic, local, etc.)
- Exclusions: extract negative constraints (no gluten, avoid X, not Y)`,
        systemPrompt: "You are a constraint extraction engine. Identify all limitations, requirements, and preferences in user requests. Return only valid JSON.",
        responseFormat: "json",
        complexity: "simple",
        maxTokens: 600,
        temperature: 0.1,
      });

      if (response.error || !response.text) {
        throw new Error(response.error ?? "Empty LLM response");
      }

      const parsed = this.safeJsonParse(response.text);
      const validated = LlmConstraintExtractionSchema.safeParse(parsed);

      if (validated.success) {
        // Remove null values for cleaner output
        const cleaned: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(validated.data.constraints)) {
          if (value !== null && value !== undefined) {
            cleaned[key] = value;
          }
        }
        return cleaned;
      }
    } catch (err) {
      console.warn("[IntentEngine] LLM constraint extraction failed, using regex fallback:", err instanceof Error ? err.message : String(err));
    }

    // Fallback to regex constraint extraction
    return this.regexExtractConstraints(input.toLowerCase());
  }

  // ── Goal Extraction ──────────────────────────────────────────────────────────

  /**
   * Extract the user's core goal from their message using LLM.
   */
  async extractGoal(input: string): Promise<string> {
    if (!input || input.trim().length === 0) return "";

    try {
      const response = await llmRouter.route({
        prompt: `Distill the user's core goal into a single clear sentence.

User message: "${input.replace(/"/g, '\\"')}"

Return JSON:
{
  "goal": "A single sentence describing what the user wants to achieve",
  "specificity": 0.0-1.0
}

The goal should be:
- Action-oriented (starts with a verb)
- Specific enough to guide execution
- Free of unnecessary context or pleasantries
- Capture the true intent even if the user was unclear`,
        systemPrompt: "You distill user requests into clear, actionable goals. Be concise and precise. Return only valid JSON.",
        responseFormat: "json",
        complexity: "simple",
        maxTokens: 300,
        temperature: 0.2,
      });

      if (response.error || !response.text) {
        throw new Error(response.error ?? "Empty LLM response");
      }

      const parsed = this.safeJsonParse(response.text);
      const validated = LlmGoalExtractionSchema.safeParse(parsed);

      if (validated.success) {
        return validated.data.goal;
      }
    } catch (err) {
      console.warn("[IntentEngine] LLM goal extraction failed:", err instanceof Error ? err.message : String(err));
    }

    // Fallback: use input directly
    return input.trim();
  }

  // ── Ambiguity Detection ──────────────────────────────────────────────────────

  /**
   * Detect if the user's request is ambiguous and generate clarifying questions.
   */
  async detectAmbiguity(input: string, intent: Intent): Promise<{ ambiguous: boolean; questions: string[] }> {
    if (!input || input.trim().length === 0) {
      return { ambiguous: false, questions: [] };
    }

    try {
      const response = await llmRouter.route({
        prompt: `Analyze this user request for ambiguity and missing information.

User message: "${input.replace(/"/g, '\\"')}"
Detected intent: ${intent.type}
Detected entities: ${JSON.stringify(intent.entities.map((e) => `${e.type}=${e.value}`))}
Detected constraints: ${JSON.stringify(intent.constraints)}

Return JSON:
{
  "ambiguous": true|false,
  "reason": "Brief explanation of what is unclear",
  "questions": ["What is your budget?", "When do you need this by?", "..."]
}

Rules:
- Mark ambiguous=true if ANY critical information is missing for execution
- Ask 1-3 concise, natural-sounding clarifying questions
- Focus on what is needed to act on the request, not just what would be nice to know
- If the request is perfectly clear, return ambiguous=false and empty questions`,
        systemPrompt: "You detect missing information in user requests and ask helpful clarifying questions. Return only valid JSON.",
        responseFormat: "json",
        complexity: "normal",
        maxTokens: 500,
        temperature: 0.3,
      });

      if (response.error || !response.text) {
        throw new Error(response.error ?? "Empty LLM response");
      }

      const parsed = this.safeJsonParse(response.text);
      const validated = LlmAmbiguitySchema.safeParse(parsed);

      if (validated.success) {
        return {
          ambiguous: validated.data.ambiguous,
          questions: validated.data.questions,
        };
      }
    } catch (err) {
      console.warn("[IntentEngine] LLM ambiguity detection failed:", err instanceof Error ? err.message : String(err));
    }

    // Fallback: heuristic ambiguity detection
    return this.heuristicAmbiguityCheck(input, intent);
  }

  // ── Capability Inference ─────────────────────────────────────────────────────

  async inferCapabilities(intent: Intent): Promise<string[]> {
    const caps = new Set<string>(intent.requiredCapabilities);

    for (const primitive of intent.suggestedPrimitives) {
      caps.add(primitive.toLowerCase());
    }

    const typeMap: Record<string, string[]> = {
      create: ["create", "generate", "validate"],
      find: ["search", "discover", "retrieve"],
      compare: ["compare", "rank", "filter"],
      calculate: ["calculate", "analyze"],
      book: ["book", "schedule", "confirm"],
      buy: ["buy", "negotiate", "verify"],
      sell: ["sell", "list", "negotiate"],
      track: ["track", "monitor", "retrieve"],
      modify: ["write", "validate", "verify"],
      ask: ["understand", "reason", "communicate"],
      delegate: ["delegate", "communicate", "execute"],
      verify: ["verify", "validate", "retrieve"],
      transform: ["transform", "interpret", "read"],
      analyze: ["analyze", "reason", "extract"],
      plan: ["plan", "decompose", "schedule"],
      negotiate: ["negotiate", "compare", "confirm"],
    };

    const extras = typeMap[intent.type] ?? [];
    for (const cap of extras) {
      caps.add(cap);
    }

    return Array.from(caps);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: FAST PATH — Regex Classification
  // ═══════════════════════════════════════════════════════════════════════════════

  private regexClassify(input: string, context: ConversationContext): Intent | null {
    const inputLower = input.toLowerCase();
    const entities = this.regexExtractEntities(input);
    let bestMatch: IntentPattern | null = null;
    let bestScore = 0;

    for (const pattern of INTENT_PATTERNS) {
      let matchCount = 0;
      for (const regex of pattern.patterns) {
        if (regex.test(inputLower)) {
          matchCount++;
        }
      }
      if (matchCount > 0) {
        const score = (matchCount / pattern.patterns.length) * pattern.weight;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = pattern;
        }
      }
    }

    // Context boost
    const previousIntent = context.previousMessages.at(-1)?.intent;
    if (previousIntent && bestMatch && previousIntent === bestMatch.name) {
      bestScore = Math.min(bestScore * 1.2, 1.0);
    }

    const urgency = this.detectUrgency(inputLower);
    const sentiment = this.detectSentiment(inputLower);
    const constraints = this.regexExtractConstraints(inputLower);

    if (!bestMatch) {
      return {
        type: "generic",
        confidence: 0.3,
        entities,
        goal: input,
        constraints,
        requiredCapabilities: ["understand"],
        suggestedPrimitives: [DNA_PRIMITIVES.UNDERSTAND],
        urgency,
        sentiment,
      };
    }

    return {
      type: bestMatch.name,
      confidence: Math.min(bestScore, 0.95),
      entities,
      goal: input,
      constraints,
      requiredCapabilities: bestMatch.requiredCapabilities,
      suggestedPrimitives: bestMatch.suggestedPrimitives,
      urgency,
      sentiment,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: LLM PATH — Semantic Classification WITH Memory Context
  // ═══════════════════════════════════════════════════════════════════════════════

  private async llmClassify(input: string, context: ConversationContext): Promise<Intent> {
    return this.llmClassifyWithMemory(input, context, {}, [], {});
  }

  private async llmClassifyWithMemory(
    input: string,
    context: ConversationContext,
    userMemory: Record<string, unknown>,
    patterns: Array<{ pattern: unknown; score: number; outcome: unknown }>,
    userPreferences: Record<string, unknown>,
  ): Promise<Intent> {
    const conversationHistory = context.previousMessages
      .slice(-5)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const accumulated = Object.keys(context.accumulatedContext).length > 0
      ? JSON.stringify(context.accumulatedContext, null, 2)
      : "none";

    const relevantPatterns = patterns.slice(0, 5);
    const memoryContext = JSON.stringify({
      userPreferences: Object.keys(userPreferences).length > 0 ? userPreferences : undefined,
      learnedPatterns: relevantPatterns.length > 0 ? relevantPatterns.map((p) => ({
        confidence: p.score,
        outcome: p.outcome,
      })) : undefined,
      recentExperiences: (userMemory.recentExperiences as unknown[])?.slice(0, 3),
    }, null, 2);

    const response = await llmRouter.route({
      prompt: `Analyze the user's message and classify their intent, using the provided MEMORY context to improve accuracy. Return ONLY valid JSON.

User message: "${input.replace(/"/g, '\\"')}"

Recent conversation history:
${conversationHistory || "None"}

Accumulated context:
${accumulated}

MEMORY CONTEXT (learned from past interactions):
${memoryContext}

Return JSON in this exact format:
{
  "type": "one of: create|find|compare|calculate|book|buy|sell|track|modify|ask|delegate|verify|transform|analyze|plan|negotiate|generic",
  "confidence": 0.0-1.0,
  "goal": "single sentence describing what the user wants",
  "requiredCapabilities": ["capability1", "capability2"],
  "suggestedPrimitives": ["CREATE", "SEARCH", "COMPARE", "ANALYZE", "GENERATE", "BOOK", "BUY", "SELL", "TRACK", "WRITE", "UNDERSTAND", "DELEGATE", "VERIFY", "TRANSFORM", "PLAN", "NEGOTIATE", "EXECUTE"],
  "sentiment": "positive|neutral|negative",
  "urgency": "low|medium|high|critical"
}

Rules:
- Use MEMORY CONTEXT to boost confidence when patterns match
- If user has shown preference for specific approaches (in userPreferences), factor that in
- If learned patterns show this intent often succeeds with certain capabilities, include them
- Choose the most specific intent type that matches
- Confidence should reflect clarity + memory evidence (1.0 = crystal clear + strong history)
- goal should be action-oriented and specific
- requiredCapabilities should list what capabilities are needed, informed by past successes
- suggestedPrimitives should list DNA primitive operations (use the provided enum values)
- sentiment: analyze emotional tone
- urgency: assess time pressure from the message`,
      systemPrompt: "You are JASIM's memory-aware intent classification engine. Analyze user messages and produce structured intent classifications, leveraging historical context to improve accuracy. Be precise. Return only valid JSON.",
      responseFormat: "json",
      complexity: "normal",
      maxTokens: 800,
      temperature: 0.2,
    });

    if (response.error || !response.text) {
      throw new Error(response.error ?? "Empty LLM response for intent classification");
    }

    const parsed = this.safeJsonParse(response.text);
    const validated = LlmIntentSchema.safeParse(parsed);

    if (!validated.success) {
      throw new Error(`LLM intent classification output validation failed: ${validated.error.message}`);
    }

    const data = validated.data;

    // Boost confidence based on pattern match evidence
    let boostedConfidence = data.confidence;
    if (patterns.length > 0 && patterns[0].score > 0.6) {
      boostedConfidence = Math.min(1, boostedConfidence + 0.1);
    }

    // Extract entities via LLM for the LLM path
    const llmEntities = await this.extractEntities(input).catch(() => []);

    return {
      type: data.type,
      confidence: boostedConfidence,
      entities: llmEntities,
      goal: data.goal,
      constraints: this.regexExtractConstraints(input.toLowerCase()),
      requiredCapabilities: data.requiredCapabilities,
      suggestedPrimitives: data.suggestedPrimitives,
      sentiment: data.sentiment,
      urgency: data.urgency,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Regex Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private regexExtractEntities(input: string): Entity[] {
    const entities: Entity[] = [];
    const seen = new Set<string>();

    for (const def of ENTITY_PATTERNS) {
      const matches = input.matchAll(def.pattern);
      for (const match of matches) {
        const value = def.extract(match);
        const key = `${def.type}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);

        entities.push({
          type: def.type,
          value,
          confidence: this.scoreEntityConfidence(def.type, value, input),
          start: match.index,
          end: match.index! + match[0].length,
        });
      }
    }

    // Named entities (capitalized phrases)
    const namedEntityPattern = /\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)+\b/g;
    const namedMatches = input.matchAll(namedEntityPattern);
    for (const match of namedMatches) {
      const value = match[0];
      const key = `named:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      entities.push({
        type: "named",
        value,
        confidence: 0.6,
        start: match.index,
        end: match.index! + value.length,
      });
    }

    return entities.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  }

  private scoreEntityConfidence(type: string, value: string, fullInput: string): number {
    const lengthScore = Math.min(value.length / 10, 1.0);
    const positionScore = fullInput.indexOf(value) < fullInput.length * 0.5 ? 0.9 : 0.7;

    const typeScores: Record<string, number> = {
      email: 0.95,
      url: 0.9,
      phone: 0.9,
      price: 0.85,
      date: 0.85,
      time: 0.8,
      number: 0.75,
      percentage: 0.8,
      quoted: 0.85,
      named: 0.6,
    };

    return Math.min(((typeScores[type] ?? 0.7) + lengthScore + positionScore) / 3, 1.0);
  }

  private regexExtractConstraints(inputLower: string): Record<string, unknown> {
    const constraints: Record<string, unknown> = {};

    // Time constraints
    if (/\b(asap|urgent|immediately|now|today|tomorrow)\b/.test(inputLower)) {
      constraints.timeframe = "urgent";
    }
    const deadlineMatch = inputLower.match(/\bwithin (\d+) (day|hour|minute|week)s?\b/);
    if (deadlineMatch) {
      constraints.deadline = { amount: Number(deadlineMatch[1]), unit: deadlineMatch[2] };
    }

    // Budget constraints
    const budgetMatch = inputLower.match(/(?:under|less than|max|maximum|at most)\s*\$?\s*(\d+(?:\.\d{2})?)/);
    if (budgetMatch) {
      constraints.budget = { max: Number(budgetMatch[1]) };
    }
    const priceRangeMatch = inputLower.match(/\$(\d+(?:\.\d{2})?)\s*(?:-|to)\s*\$?(\d+(?:\.\d{2})?)/);
    if (priceRangeMatch) {
      constraints.budget = { min: Number(priceRangeMatch[1]), max: Number(priceRangeMatch[2]) };
    }

    // Quality constraints
    if (/\b(best|top|highest|premium|quality|5\.star)\b/.test(inputLower)) {
      constraints.quality = "high";
    }
    if (/\b(cheapest|lowest cost|budget|cheap|affordable)\b/.test(inputLower)) {
      constraints.quality = "economy";
    }

    // Quantity
    const qtyMatch = inputLower.match(/\b(\d+)\s*(piece|item|unit|copy|set|pack)/);
    if (qtyMatch) {
      constraints.quantity = Number(qtyMatch[1]);
    }

    return constraints;
  }

  private detectUrgency(input: string): Intent["urgency"] {
    if (/\b(asap|urgent|emergency|immediately|critical|right now)\b/.test(input)) return "critical";
    if (/\b(soon|today|this week|quickly|fast)\b/.test(input)) return "high";
    if (/\b(this month|eventually|whenever|no rush)\b/.test(input)) return "low";
    return "medium";
  }

  private detectSentiment(input: string): Intent["sentiment"] {
    const positive = /\b(great|excellent|love|happy|thanks|please|appreciate|awesome)\b/.test(input);
    const negative = /\b(bad|terrible|hate|angry|frustrated|annoying|worst|broken)\b/.test(input);
    if (positive && !negative) return "positive";
    if (negative && !positive) return "negative";
    return "neutral";
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Intent Blending & Utility
  // ═══════════════════════════════════════════════════════════════════════════════

  private blendIntents(pattern: Intent, llm: Intent, patternWeight: number): Intent {
    const w1 = patternWeight;
    const w2 = 1 - patternWeight;

    const blendedType = pattern.confidence >= llm.confidence ? pattern.type : llm.type;
    const blendedConfidence = pattern.confidence * w1 + llm.confidence * w2;

    const allEntities = [...pattern.entities];
    for (const e of llm.entities) {
      if (!allEntities.some((ae) => ae.type === e.type && ae.value === e.value)) {
        allEntities.push(e);
      }
    }

    const allCaps = new Set([...pattern.requiredCapabilities, ...llm.requiredCapabilities]);
    const allPrimitives = new Set([...pattern.suggestedPrimitives, ...llm.suggestedPrimitives]);

    return {
      type: blendedType,
      confidence: Math.min(blendedConfidence, 0.99),
      entities: allEntities,
      goal: llm.goal || pattern.goal,
      constraints: { ...pattern.constraints, ...llm.constraints },
      requiredCapabilities: Array.from(allCaps),
      suggestedPrimitives: Array.from(allPrimitives),
      urgency: pattern.urgency ?? llm.urgency,
      sentiment: pattern.sentiment ?? llm.sentiment,
    };
  }

  /**
   * Blend the classified intent with memory insights.
   * This is where MEMORY INFLUENCES EXECUTION:
   * - Boosts confidence for historically successful intents
   * - Adds user-preferred capabilities
   * - Adjusts constraints from learned preferences
   * - Warns about historically problematic approaches
   */
  private blendWithMemory(
    intent: Intent,
    _userMemory: Record<string, unknown>,
    patterns: Array<{ pattern: unknown; score: number; outcome: unknown }>,
    userPreferences: Record<string, unknown>,
  ): Intent {
    const result = { ...intent };
    const modifications: string[] = [];

    // 1. Boost confidence if learned patterns support this intent type
    if (patterns.length > 0) {
      const bestMatch = patterns[0];
      if (bestMatch.score > 0.7) {
        result.confidence = Math.min(1, result.confidence + 0.08);
        modifications.push(`confidence boosted by learned pattern (score=${bestMatch.score.toFixed(2)})`);
      }
      if (bestMatch.score < 0.3) {
        result.confidence = Math.max(0.1, result.confidence - 0.1);
        modifications.push(`confidence lowered due to poor historical pattern (score=${bestMatch.score.toFixed(2)})`);
      }
    }

    // 2. Add user-preferred capabilities from learned preferences
    if (userPreferences && Object.keys(userPreferences).length > 0) {
      const preferredCaps = userPreferences["preferred_capabilities"] as string[] | undefined;
      if (preferredCaps && Array.isArray(preferredCaps)) {
        const capSet = new Set(result.requiredCapabilities);
        for (const cap of preferredCaps) {
          if (!capSet.has(cap)) {
            capSet.add(cap);
            modifications.push(`added user-preferred capability: ${cap}`);
          }
        }
        result.requiredCapabilities = Array.from(capSet);
      }

      // 3. Merge user preferences into constraints
      const userBudget = userPreferences["budget"] as Record<string, unknown> | undefined;
      if (userBudget && !result.constraints.budget) {
        result.constraints = { ...result.constraints, budget: userBudget };
        modifications.push("inherited user budget preference");
      }

      const userQuality = userPreferences["quality"] as string | undefined;
      if (userQuality && !result.constraints.quality) {
        result.constraints = { ...result.constraints, quality: userQuality };
        modifications.push(`inherited user quality preference: ${userQuality}`);
      }
    }

    // 4. Tag intent with memory-derived metadata for downstream use
    result.constraints = {
      ...result.constraints,
      _memoryInfluenced: modifications.length > 0,
      _memoryMods: modifications,
      _patternScore: patterns[0]?.score ?? 0,
    };

    if (modifications.length > 0) {
      console.log(`[IntentEngine] Memory blended: ${modifications.join("; ")}`);
    }

    return result;
  }

  private createGenericIntent(input: string): Intent {
    return {
      type: "generic",
      confidence: 0.3,
      entities: this.regexExtractEntities(input),
      goal: input,
      constraints: this.regexExtractConstraints(input.toLowerCase()),
      requiredCapabilities: ["understand"],
      suggestedPrimitives: [DNA_PRIMITIVES.UNDERSTAND],
      urgency: "medium",
      sentiment: "neutral",
    };
  }

  private heuristicAmbiguityCheck(input: string, intent: Intent): { ambiguous: boolean; questions: string[] } {
    const questions: string[] = [];
    let ambiguous = false;

    // Check for missing entities based on intent type
    if ((intent.type === "buy" || intent.type === "sell") && !intent.entities.some((e) => e.type === "price")) {
      questions.push("What is your budget or expected price range?");
      ambiguous = true;
    }

    if (intent.type === "book" && !intent.entities.some((e) => e.type === "date" || e.type === "time")) {
      questions.push("When would you like to schedule this?");
      ambiguous = true;
    }

    if (intent.type === "find" && intent.entities.length < 2) {
      questions.push("Could you provide more specific details about what you're looking for?");
      ambiguous = true;
    }

    // Check for vague language
    const vagueWords = /\b(something|anything|whatever|someone|anyone|stuff|things?)\b/i;
    if (vagueWords.test(input)) {
      questions.push("Could you be more specific about what you need?");
      ambiguous = true;
    }

    return { ambiguous, questions };
  }

  private safeJsonParse(text: string): unknown {
    // Try to extract JSON from markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    const cleanText = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

    try {
      return JSON.parse(cleanText);
    } catch {
      // Try to find JSON object bounds
      const firstBrace = cleanText.indexOf("{");
      const lastBrace = cleanText.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          return JSON.parse(cleanText.slice(firstBrace, lastBrace + 1));
        } catch {
          // Final fallback
        }
      }
      throw new Error("Failed to parse LLM response as JSON");
    }
  }
}
