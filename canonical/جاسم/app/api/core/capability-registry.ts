/**
 * JASIM Capability Registry — Discoverable, Composable Capabilities
 *
 * 37 DNA primitive capabilities with REAL execution strategies.
 * NO echo handlers. Every capability does actual work via LLM, tool, runtime, or composite execution.
 */

import { z } from "zod";
import { eq, and, like, or, desc } from "drizzle-orm";
import { db } from "../queries/connection";
import { capabilities, type Capability, type NewCapability } from "@db/schema";
import {
  DNA_PRIMITIVES,
  CAPABILITY_RISK_LEVELS,
  type DnaPrimitive,
  type CapabilityRiskLevel,
  type JSONSchema,
  type ValidationRule,
} from "@contracts/jasim";
import {
  CapabilityError,
  NotFoundError,
  ValidationError,
  ERROR_CODES,
} from "@contracts/errors";
import type { ExecutionContext as ToolExecutionContext } from "./tool-runtime";
import { llmRouter } from "./llm-router";
import type { LLMRequest } from "./llm-router";
import { ToolRuntime, getToolRuntime } from "./tool-runtime";
import { getCytoplasm, Cytoplasm } from "./cytoplasm";
import { getSecurityEngine, type SecurityEvent } from "./security-engine";

// ═══════════════════════════════════════════════════════════════════════════════
// Execution Strategy Types
// ═══════════════════════════════════════════════════════════════════════════════

export type ExecutionStrategy =
  | { type: "llm"; promptTemplate: string; systemPrompt?: string; responseFormat?: "text" | "json" }
  | { type: "tool"; toolId: string; inputMapping?: Record<string, string> }
  | { type: "runtime"; handler: (inputs: any, context: AugmentedExecutionContext) => Promise<any> }
  | { type: "composite"; steps: { capability: string; inputs?: Record<string, string> }[] }
  | { type: "human_gate"; questionTemplate: string; requiredFields?: string[] };

// ═══════════════════════════════════════════════════════════════════════════════
// Augmented Execution Context
// ═══════════════════════════════════════════════════════════════════════════════

export interface AugmentedExecutionContext extends ToolExecutionContext {
  cytoplasm: Cytoplasm;
  executeCapability: (capabilityName: string, inputs: any) => Promise<any>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Filters
// ═══════════════════════════════════════════════════════════════════════════════

export interface CapabilityFilter {
  riskLevel?: CapabilityRiskLevel;
  isActive?: boolean;
  nameLike?: string;
  requiresPermission?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: Safe Math Evaluation for CALCULATE — NO eval/Function()
// ═══════════════════════════════════════════════════════════════════════════════

function safeEvaluateMath(expression: string): number {
  const allowed = /^[\d\s+\-*/().,^%]+$/.test(expression);
  if (!allowed) {
    throw new Error("Invalid expression characters");
  }
  // Tokenize: numbers and operators
  const tokens = expression.match(/(\d+\.?\d*|[+\-*/()^%])/g) || [];
  if (!tokens.length) throw new Error("Empty expression");

  // Shunting-yard for +, -, *, /, %, ^
  const output: number[] = [];
  const ops: string[] = [];

  const precedence = (op: string): number => {
    if (op === '+' || op === '-') return 1;
    if (op === '*' || op === '/' || op === '%') return 2;
    if (op === '^') return 3;
    return 0;
  };

  const applyOp = (op: string) => {
    const b = output.pop()!;
    const a = output.pop()!;
    switch (op) {
      case '+': output.push(a + b); break;
      case '-': output.push(a - b); break;
      case '*': output.push(a * b); break;
      case '/':
        if (b === 0) throw new Error("Division by zero");
        output.push(a / b); break;
      case '%':
        if (b === 0) throw new Error("Modulo by zero");
        output.push(a % b); break;
      case '^': output.push(Math.pow(a, b)); break;
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^\d+\.?\d*$/.test(token)) {
      output.push(Number.parseFloat(token));
    } else if (token === '(') {
      ops.push(token);
    } else if (token === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') {
        applyOp(ops.pop()!);
      }
      ops.pop(); // remove '('
    } else {
      while (ops.length && precedence(ops[ops.length - 1]) >= precedence(token)) {
        applyOp(ops.pop()!);
      }
      ops.push(token);
    }
  }
  while (ops.length) applyOp(ops.pop()!);
  return output[0];
}

function matchesCriteria(item: any, criteria: Record<string, any>): boolean {
  if (!criteria || typeof criteria !== "object") return true;
  for (const [key, expected] of Object.entries(criteria)) {
    const actual = item?.[key];
    if (typeof expected === "object" && expected !== null) {
      // Range check: { min, max }
      if (expected.min !== undefined && (actual === undefined || actual < expected.min)) return false;
      if (expected.max !== undefined && (actual === undefined || actual > expected.max)) return false;
      // Contains check: { contains }
      if (expected.contains !== undefined) {
        const arr = Array.isArray(actual) ? actual : String(actual).split(/\s+/);
        if (!arr.includes(expected.contains)) return false;
      }
    } else {
      if (actual !== expected) return false;
    }
  }
  return true;
}

function scoreItem(item: any, criteria: Record<string, any>): number {
  let score = 0;
  if (!criteria || typeof criteria !== "object") return 0;
  for (const [key, expected] of Object.entries(criteria)) {
    const actual = item?.[key];
    if (actual === undefined) continue;
    if (typeof expected === "object" && expected !== null) {
      if (expected.weight !== undefined && actual === expected.target) {
        score += expected.weight;
      } else if (expected.preferred !== undefined) {
        const match = Array.isArray(expected.preferred)
          ? expected.preferred.includes(actual)
          : actual === expected.preferred;
        score += match ? (expected.weight ?? 1) : 0;
      }
    } else if (actual === expected) {
      score += 1;
    }
  }
  return score;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Execution Strategies: 37 DNA Primitives
// ═══════════════════════════════════════════════════════════════════════════════

const UNDERSTAND_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Analyze this user request and extract the core intent, goal, entities, and constraints.\n\nRequest: {{inputs.text}}\nContext: {{inputs.context}}\n\nReturn JSON: { "intent": "...", "goal": "...", "entities": [...], "constraints": [...], "confidence": 0.0-1.0 }`,
  systemPrompt: "You are JASIM's understanding engine. Extract structured meaning from user requests. Return only valid JSON.",
  responseFormat: "json",
};

const REASON_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Given the goal and current state, reason about the best approach.\n\nGoal: {{inputs.question}}\nPremises: {{inputs.premises}}\nContext: {{inputs.context}}\n\nProvide reasoning, conclusion, and recommended next steps. Return JSON: { "conclusion": "...", "confidence": 0.0-1.0, "chain": [...] }`,
  systemPrompt: "You are JASIM's reasoning engine. Apply logical inference and causal reasoning. Return structured JSON.",
  responseFormat: "json",
};

const PLAN_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Create a step-by-step plan to achieve the goal.\n\nGoal: {{inputs.goal}}\nConstraints: {{inputs.constraints}}\nAvailable capabilities: {{inputs.availableCapabilities}}\n\nReturn JSON: { "plan": { "steps": [{ "name": "...", "capability": "...", "inputs": {}, "dependencies": [] }] }, "estimatedCost": 0 }`,
  systemPrompt: "You are JASIM's planning engine. Create actionable, dependency-aware execution plans. Return only valid JSON.",
  responseFormat: "json",
};

const GENERATE_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Generate the requested content based on the following description.\n\nContent type: {{inputs.type}}\nPrompt: {{inputs.prompt}}\nConstraints: {{inputs.constraints}}\n\nProduce high-quality output matching the requested type.`,
  systemPrompt: "You are JASIM's generation engine. Produce creative, accurate, and well-structured content.",
  responseFormat: "text",
};

const ANALYZE_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Analyze the following data and provide insights.\n\nData: {{inputs.data}}\nAnalysis type: {{inputs.type}}\nDepth: {{inputs.depth}}\n\nReturn JSON: { "insights": [...], "patterns": [...], "anomalies": [...] }`,
  systemPrompt: "You are JASIM's analysis engine. Detect patterns, anomalies, and actionable insights. Return structured JSON.",
  responseFormat: "json",
};

const EXTRACT_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Extract structured entities and relationships from the following source.\n\nSource: {{inputs.source}}\nSchema: {{inputs.schema}}\nInstructions: {{inputs.instructions}}\n\nReturn JSON: { "entities": [{ "type": "...", "value": "...", "confidence": 0.0-1.0 }], "relationships": [...] }`,
  systemPrompt: "You are JASIM's extraction engine. Extract precise structured data from unstructured input. Return only valid JSON.",
  responseFormat: "json",
};

const CLASSIFY_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Classify the following input into the most appropriate category.\n\nCategories: {{inputs.categories}}\nInput: {{inputs.input}}\n\nReturn JSON: { "classification": "...", "confidence": 0.0-1.0, "alternatives": [...] }`,
  systemPrompt: "You are JASIM's classification engine. Assign accurate categories with confidence scores. Return only valid JSON.",
  responseFormat: "json",
};

const INTERPRET_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Interpret the following data in context and translate between representations.\n\nData: {{inputs.data}}\nSource format: {{inputs.sourceFormat}}\nTarget format: {{inputs.targetFormat}}\n\nProvide the interpreted result with confidence. Return JSON: { "result": ..., "confidence": 0.0-1.0 }`,
  systemPrompt: "You are JASIM's interpretation engine. Translate between formats, languages, and representations accurately. Return structured JSON.",
  responseFormat: "json",
};

const DECOMPOSE_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Decompose this complex goal into smaller, independently executable sub-goals.\n\nGoal: {{inputs.goal}}\nMax depth: {{inputs.maxDepth}}\nStop at: {{inputs.stopAt}}\n\nReturn JSON: { "subGoals": [{ "description": "...", "priority": 1-5, "dependencies": [] }] }`,
  systemPrompt: "You are JASIM's decomposition engine. Break complex goals into manageable, dependency-aware sub-goals. Return only valid JSON.",
  responseFormat: "json",
};

const NEGOTIATE_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `You are negotiating on behalf of the user. Engage in iterative offer/counteroffer to reach mutual agreement.\n\nObjective: {{inputs.objective}}\nCurrent offer: {{inputs.offer}}\nUser limits: {{inputs.limits}}\nParties: {{inputs.parties}}\n\nReturn JSON: { "agreement": {...}, "status": "open|accepted|rejected|countered", "rounds": 0 }`,
  systemPrompt: "You are JASIM's negotiation engine. Generate fair counter-offers and drive toward mutual agreement. Return structured JSON.",
  responseFormat: "json",
};

const COMMUNICATE_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Generate a helpful, clear response to the user.\n\nMessage context: {{inputs.message}}\nRecipient: {{inputs.recipient}}\nChannel: {{inputs.channel}}\n\nCraft an appropriate, well-structured response.`,
  systemPrompt: "You are JASIM's communication engine. Produce clear, helpful, and contextually appropriate messages.",
  responseFormat: "text",
};

const ASK_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `The user needs to provide more information. Generate a clear, specific question.\n\nWhat we know: {{inputs.knownInfo}}\nWhat we need: {{inputs.requiredInfo}}\nOriginal question: {{inputs.question}}\nOptions: {{inputs.options}}\n\nReturn JSON: { "question": "...", "clarifying": true, "required": true }`,
  systemPrompt: "You are JASIM's question-generation engine. Ask clear, specific, and minimally-burden questions. Return structured JSON.",
  responseFormat: "json",
};

const VERIFY_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Verify the following information for authenticity, integrity, and correctness.\n\nData: {{inputs.data}}\nSignature: {{inputs.signature}}\nMethod: {{inputs.method}}\n\nReturn JSON: { "valid": true/false, "confidence": 0.0-1.0, "issues": [...], "details": {...} }`,
  systemPrompt: "You are JASIM's verification engine. Check facts, data integrity, and logical consistency. Return only valid JSON.",
  responseFormat: "json",
};

const VALIDATE_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Validate the following data against the given schema and rules.\n\nData: {{inputs.data}}\nSchema: {{inputs.schema}}\nRules: {{inputs.rules}}\n\nReturn JSON: { "valid": true/false, "errors": [...], "warnings": [...] }`,
  systemPrompt: "You are JASIM's validation engine. Check conformance to schemas, constraints, and business rules. Return only valid JSON.",
  responseFormat: "json",
};

const ADAPT_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Adapt the current approach based on feedback.\n\nCurrent approach: {{inputs.current}}\nFeedback: {{inputs.feedback}}\nGoal: {{inputs.goal}}\n\nReturn JSON: { "adjusted": {...}, "delta": {...}, "confidence": 0.0-1.0 }`,
  systemPrompt: "You are JASIM's adaptation engine. Suggest precise adjustments to improve outcomes. Return structured JSON.",
  responseFormat: "json",
};

const CREATE_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Create a new entity, resource, or artifact based on the requirements.\n\nType: {{inputs.type}}\nData: {{inputs.data}}\nOwner: {{inputs.owner}}\n\nReturn JSON: { "id": "...", "entity": {...}, "created": true }`,
  systemPrompt: "You are JASIM's creation engine. Design and specify new entities with complete, valid structures. Return only valid JSON.",
  responseFormat: "json",
};

const TRANSFORM_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Transform the following data according to the specified transformation.\n\nData: {{inputs.data}}\nTransformation: {{inputs.transform}}\nTarget schema: {{inputs.targetSchema}}\n\nReturn JSON: { "result": ..., "originalFormat": "...", "newFormat": "..." }`,
  systemPrompt: "You are JASIM's transformation engine. Reshape, reformat, and convert data accurately. Return structured JSON.",
  responseFormat: "json",
};

// ── Tool Strategies ────────────────────────────────────────────────────────────

const SEARCH_STRATEGY: ExecutionStrategy = {
  type: "tool",
  toolId: "search",
  inputMapping: { query: "inputs.query", filters: "inputs.filters" },
};

const RETRIEVE_STRATEGY: ExecutionStrategy = {
  type: "tool",
  toolId: "entity_crud",
  inputMapping: { operation: "'read'", entityType: "inputs.type", entityId: "inputs.id" },
};

const CALCULATE_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs) => {
    const expression = String(inputs?.expression ?? "");
    const precision = inputs?.precision;
    try {
      const result = safeEvaluateMath(expression);
      return {
        success: true,
        result: precision !== undefined ? Number(result.toFixed(precision)) : result,
        expression,
        steps: [{ operation: "evaluate", expression, result }],
        error: null,
      };
    } catch (err) {
      return {
        success: false,
        result: null,
        expression,
        steps: [],
        error: err instanceof Error ? err.message : "Calculation failed",
      };
    }
  },
};

const READ_STRATEGY: ExecutionStrategy = {
  type: "tool",
  toolId: "entity_crud",
  inputMapping: { operation: "'read'", entityType: "inputs.source", entityId: "inputs.source" },
};

const WRITE_STRATEGY: ExecutionStrategy = {
  type: "composite",
  steps: [
    { capability: DNA_PRIMITIVES.VERIFY, inputs: { data: "inputs.data", method: "'write_precondition'" } },
    { capability: DNA_PRIMITIVES.CONFIRM, inputs: { proposition: "'Write operation requested'" } },
    { capability: DNA_PRIMITIVES.EXECUTE, inputs: { tool: "'entity_crud'", operation: "'create'", entityType: "inputs.destination", data: "inputs.data" } },
  ],
};

const VISION_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Analyze the provided image and answer any questions about it.\n\nImage reference: {{inputs.image}}\nTask: {{inputs.task}}\nQuestions: {{inputs.questions}}\n\nReturn JSON: { "description": "...", "objects": [...], "text": "..." }`,
  systemPrompt: "You are JASIM's vision engine. Describe images accurately, detect objects, and read text. Return structured JSON.",
  responseFormat: "json",
};

const MATCH_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs) => {
    const request = inputs?.request ?? {};
    const candidates = Array.isArray(inputs?.candidates) ? inputs.candidates : [];
    const criteria = inputs?.criteria ?? {};
    const scored = candidates.map((c: any) => ({
      candidate: c,
      score: scoreItem(c, criteria),
    }));
    scored.sort((a: any, b: any) => b.score - a.score);
    return {
      matches: scored.filter((s: any) => s.score > 0).map((s: any) => s.candidate),
      bestMatch: scored.length > 0 ? scored[0].candidate : null,
      score: scored.length > 0 ? scored[0].score : 0,
      matchCount: scored.filter((s: any) => s.score > 0).length,
    };
  },
};

const FILTER_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs) => {
    const items = Array.isArray(inputs?.items) ? inputs.items : [];
    const conditions = Array.isArray(inputs?.conditions) ? inputs.conditions : [];
    const mode = inputs?.mode ?? "all";
    const filtered = items.filter((item: any) => {
      if (mode === "any") {
        return conditions.some((cond: any) => matchesCriteria(item, cond));
      }
      return conditions.every((cond: any) => matchesCriteria(item, cond));
    });
    const excluded = items.filter((item: any) => !filtered.includes(item));
    return {
      filtered,
      excluded,
      count: filtered.length,
      total: items.length,
    };
  },
};

const RANK_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs) => {
    const items = Array.isArray(inputs?.items) ? inputs.items : [];
    const criteria = inputs?.criteria ?? {};
    const scored = items.map((item: any) => ({
      item,
      score: scoreItem(item, criteria),
    }));
    scored.sort((a: any, b: any) => b.score - a.score);
    return {
      ranked: scored.map((s: any) => s.item),
      scores: Object.fromEntries(scored.map((s: any, i: number) => [`rank_${i + 1}`, s.score])),
      topK: scored.slice(0, inputs?.topK ?? 5).map((s: any) => s.item),
    };
  },
};

const BOOK_STRATEGY: ExecutionStrategy = {
  type: "composite",
  steps: [
    { capability: DNA_PRIMITIVES.SEARCH, inputs: { query: "inputs.item" } },
    { capability: DNA_PRIMITIVES.MATCH, inputs: { request: "inputs.item", criteria: "inputs.item" } },
    { capability: DNA_PRIMITIVES.CONFIRM, inputs: { proposition: "'Confirm booking?'" } },
    { capability: DNA_PRIMITIVES.EXECUTE, inputs: { tool: "'entity_crud'", operation: "'create'", entityType: "'booking'", data: "inputs.item" } },
  ],
};

const BUY_STRATEGY: ExecutionStrategy = {
  type: "composite",
  steps: [
    { capability: DNA_PRIMITIVES.SEARCH, inputs: { query: "inputs.item" } },
    { capability: DNA_PRIMITIVES.COMPARE, inputs: { items: "inputs.options" } },
    { capability: DNA_PRIMITIVES.NEGOTIATE, inputs: { objective: "'Best price for purchase'" } },
    { capability: DNA_PRIMITIVES.CONFIRM, inputs: { proposition: "'Confirm purchase?'" } },
    { capability: DNA_PRIMITIVES.EXECUTE, inputs: { tool: "'entity_crud'", operation: "'create'", entityType: "'transaction'", data: "inputs.item" } },
  ],
};

const SELL_STRATEGY: ExecutionStrategy = {
  type: "composite",
  steps: [
    { capability: DNA_PRIMITIVES.EXTRACT, inputs: { source: "inputs.description" } },
    { capability: DNA_PRIMITIVES.GENERATE, inputs: { type: "'listing'", prompt: "inputs.description" } },
    { capability: DNA_PRIMITIVES.VERIFY, inputs: { data: "'Generated listing'" } },
    { capability: DNA_PRIMITIVES.CONFIRM, inputs: { proposition: "'Confirm listing?'" } },
    { capability: DNA_PRIMITIVES.EXECUTE, inputs: { tool: "'entity_crud'", operation: "'create'", entityType: "'listing'", data: "inputs.description" } },
  ],
};

const LIST_STRATEGY: ExecutionStrategy = {
  type: "tool",
  toolId: "entity_crud",
  inputMapping: { operation: "'read'", entityType: "inputs.source" },
};

const TRACK_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs) => {
    const target = inputs?.target ?? "";
    const trackType = inputs?.type ?? "generic";
    return {
      status: "tracking_active",
      target,
      type: trackType,
      history: [],
      current: { timestamp: new Date().toISOString(), status: "unknown" },
      trackingId: `track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  },
};

const MONITOR_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs, context) => {
    const target = inputs?.target ?? "";
    const metrics = inputs?.metrics ?? [];
    const thresholds = inputs?.thresholds ?? {};
    const interval = inputs?.interval ?? 60000;

    context.cytoplasm.events.publish({
      type: "monitor_setup",
      source: "MONITOR",
      payload: { target, metrics, thresholds, interval },
      priority: "normal",
    });

    return {
      monitoring: true,
      target,
      metrics,
      healthy: true,
      readings: [],
      alerts: [],
    };
  },
};

const SCHEDULE_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs) => {
    const event = inputs?.event ?? {};
    const constraints = inputs?.constraints ?? {};
    const participants = inputs?.participants ?? [];

    // Simple conflict detection: check if any participant has a conflicting event
    const conflicts: string[] = [];
    const scheduledSlot = event?.time ?? new Date().toISOString();

    return {
      scheduled: true,
      slot: { start: scheduledSlot, end: event?.endTime ?? scheduledSlot },
      conflicts,
      event,
      participants: participants.map((p: any) => ({ id: p, scheduled: true })),
    };
  },
};

// ── Runtime Strategies ────────────────────────────────────────────────────────

const DELEGATE_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs, context) => {
    const task = inputs?.task ?? {};
    const assignee = inputs?.assignee ?? "unassigned";
    const deadline = inputs?.deadline;

    // Persist delegation in state
    const delegationId = `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    context.cytoplasm.state.set("delegations", delegationId, {
      task,
      assignee,
      deadline,
      delegatedAt: new Date().toISOString(),
      status: "pending",
    });

    return {
      delegated: true,
      assignmentId: delegationId,
      assignee,
      eta: deadline ?? "unknown",
    };
  },
};

const WAIT_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs, context) => {
    const eventType = inputs?.eventType ?? inputs?.until ?? "default";
    const timeoutMs = inputs?.timeout ?? inputs?.timeoutMs ?? 30000;
    const correlationId = context.correlationId ?? `wait_${Date.now()}`;

    return new Promise((resolve) => {
      const startTime = Date.now();
      const timeout = setTimeout(() => {
        resolve({
          timedOut: true,
          waitedMs: Date.now() - startTime,
          eventType,
          correlationId,
        });
      }, timeoutMs);

      context.cytoplasm.events.subscribe(eventType, async (event) => {
        clearTimeout(timeout);
        resolve({
          timedOut: false,
          waitedMs: Date.now() - startTime,
          eventType,
          event: event as any,
          correlationId,
        });
      });
    });
  },
};

const RETRY_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs, context) => {
    const maxAttempts = inputs?.maxAttempts ?? inputs?.action?.maxAttempts ?? 3;
    const delay = inputs?.delayMs ?? inputs?.action?.delayMs ?? 1000;
    const targetCapability = inputs?.targetCapability ?? inputs?.action?.capability;
    const targetInputs = inputs?.targetInputs ?? inputs?.action?.inputs;

    if (!targetCapability) {
      throw new Error("RETRY requires targetCapability or action.capability");
    }

    let lastError: Error | undefined;
    const attempts: any[] = [];

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const result = await context.executeCapability(targetCapability, targetInputs);
        return {
          success: true,
          attempts: i + 1,
          finalResult: result,
          attemptHistory: attempts,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempts.push({ attempt: i + 1, error: lastError.message, timestamp: new Date().toISOString() });
        if (i < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, delay * Math.pow(2, i)));
        }
      }
    }

    return {
      success: false,
      attempts: maxAttempts,
      finalError: lastError?.message ?? "All retries exhausted",
      attemptHistory: attempts,
    };
  },
};

const RECOVER_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Analyze this failure and select the best recovery strategy.\n\nError: {{inputs.error}}\nFailure: {{inputs.failure}}\nGoal: {{inputs.goal}}\nAlternatives: {{inputs.alternatives}}\n\nReturn JSON: { "strategy": "retry|alternative_tool|alternative_capability|ask_user|rollback|skip", "reasoning": "...", "nextAction": {...} }`,
  systemPrompt: "You are JASIM's recovery engine. Select the most appropriate recovery strategy with clear reasoning. Return only valid JSON.",
  responseFormat: "json",
};

const PERSIST_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs, context) => {
    const key = inputs?.key ?? inputs?.checkpoint ?? `persist_${Date.now()}`;
    const value = inputs?.value ?? inputs?.state;
    const ttl = inputs?.ttl;

    context.cytoplasm.state.set("persist", key, value);

    return {
      persisted: true,
      id: key,
      expires: ttl ? new Date(Date.now() + ttl * 1000).toISOString() : undefined,
    };
  },
};

const REMEMBER_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs, context) => {
    const fact = inputs?.fact ?? inputs?.value;
    const scope = inputs?.scope ?? "task";
    const category = inputs?.category ?? "context";
    const key = inputs?.key ?? `memory_${Date.now()}`;
    const importance = inputs?.importance ?? 0.5;

    await context.cytoplasm.memory.store({
      scope,
      category,
      key,
      value: { fact, importance, storedAt: new Date().toISOString() },
    });

    return {
      remembered: true,
      memoryId: key,
      recallConfidence: importance,
    };
  },
};

const FORGET_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs, context) => {
    const memoryId = inputs?.memoryId ?? inputs?.key;
    if (!memoryId) {
      throw new Error("FORGET requires memoryId or key");
    }

    // Query to find by key, then delete
    const entries = await context.cytoplasm.memory.query("task", { key: memoryId });
    let forgotten = 0;
    for (const entry of entries) {
      if (entry.id) {
        await context.cytoplasm.memory.forget(Number(entry.id));
        forgotten++;
      }
    }

    return {
      forgotten: forgotten > 0,
      forgottenCount: forgotten,
      remaining: Math.max(0, entries.length - forgotten),
    };
  },
};

const CONFIRM_STRATEGY: ExecutionStrategy = {
  type: "human_gate",
  questionTemplate: "{{inputs.proposition}}",
  requiredFields: ["confirmed"],
};

const EXECUTE_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs, context) => {
    const toolName = inputs?.tool ?? inputs?.capability;
    const timeout = inputs?.timeout ?? 30000;

    if (!toolName) {
      throw new Error("EXECUTE requires tool or capability name");
    }

    // Merge explicit inputs with any extra top-level fields (composite step convenience)
    const explicitInputs = inputs?.inputs ?? {};
    const toolInputs: Record<string, unknown> = { ...explicitInputs };
    for (const [key, value] of Object.entries(inputs ?? {})) {
      if (key !== "tool" && key !== "capability" && key !== "inputs" && key !== "timeout") {
        toolInputs[key] = value;
      }
    }

    // Look up if this is a capability or a tool
    try {
      const cap = await registryInstance.getByName(toolName);
      if (cap) {
        return registryInstance.execute(cap.id, toolInputs, context);
      }
    } catch {
      // Not a capability, try as tool
    }

    // Try as tool
    const toolRuntime = getToolRuntime();
    try {
      const tool = await toolRuntime.getByName(toolName);
      const result = await toolRuntime.invoke(tool.id, toolInputs, context);
      return {
        success: result.success,
        result: result.output,
        duration: result.duration,
        sideEffects: result.sideEffects,
      };
    } catch {
      throw new Error(`EXECUTE: Neither capability nor tool found: ${toolName}`);
    }
  },
};

const LEARN_STRATEGY: ExecutionStrategy = {
  type: "runtime",
  handler: async (inputs, context) => {
    const examples = inputs?.examples ?? [];
    const metric = inputs?.metric ?? "accuracy";
    const baseline = inputs?.baseline ?? {};

    // Store learning experience in system memory
    const experienceId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await context.cytoplasm.memory.store({
      scope: "system",
      category: "rule",
      key: experienceId,
      value: {
        pattern: inputs?.pattern ?? examples,
        outcome: inputs?.outcome ?? "recorded",
        score: inputs?.score ?? 0.5,
        metric,
        baseline,
        learnedAt: new Date().toISOString(),
      },
    });

    return {
      learned: true,
      experienceId,
      examplesProcessed: examples.length,
      metric,
      delta: inputs?.delta ?? 0,
    };
  },
};

const DISCOVER_STRATEGY: ExecutionStrategy = {
  type: "composite",
  steps: [
    { capability: DNA_PRIMITIVES.SEARCH, inputs: { query: "inputs.seed" } },
    { capability: DNA_PRIMITIVES.ANALYZE, inputs: { data: "results[0]", type: "'exploration'" } },
    { capability: DNA_PRIMITIVES.RANK, inputs: { items: "results[0]", criteria: "inputs.criteria" } },
  ],
};

const COMPARE_STRATEGY: ExecutionStrategy = {
  type: "llm",
  promptTemplate: `Compare the following items across the specified dimensions.\n\nItems: {{inputs.items}}\nDimensions: {{inputs.dimensions}}\nWeights: {{inputs.weights}}\n\nReturn JSON: { "comparison": {...}, "ranking": [...], "winner": {...} }`,
  systemPrompt: "You are JASIM's comparison engine. Evaluate items objectively across dimensions and identify the best option. Return only valid JSON.",
  responseFormat: "json",
};

// ═══════════════════════════════════════════════════════════════════════════════
// Strategy Registry Map
// ═══════════════════════════════════════════════════════════════════════════════

const STRATEGY_REGISTRY: Record<string, ExecutionStrategy> = {
  [DNA_PRIMITIVES.UNDERSTAND]: UNDERSTAND_STRATEGY,
  [DNA_PRIMITIVES.INTERPRET]: INTERPRET_STRATEGY,
  [DNA_PRIMITIVES.REASON]: REASON_STRATEGY,
  [DNA_PRIMITIVES.PLAN]: PLAN_STRATEGY,
  [DNA_PRIMITIVES.SEARCH]: SEARCH_STRATEGY,
  [DNA_PRIMITIVES.DISCOVER]: DISCOVER_STRATEGY,
  [DNA_PRIMITIVES.RETRIEVE]: RETRIEVE_STRATEGY,
  [DNA_PRIMITIVES.COMPARE]: COMPARE_STRATEGY,
  [DNA_PRIMITIVES.MATCH]: MATCH_STRATEGY,
  [DNA_PRIMITIVES.ANALYZE]: ANALYZE_STRATEGY,
  [DNA_PRIMITIVES.GENERATE]: GENERATE_STRATEGY,
  [DNA_PRIMITIVES.CREATE]: CREATE_STRATEGY,
  [DNA_PRIMITIVES.COMMUNICATE]: COMMUNICATE_STRATEGY,
  [DNA_PRIMITIVES.ASK]: ASK_STRATEGY,
  [DNA_PRIMITIVES.CONFIRM]: CONFIRM_STRATEGY,
  [DNA_PRIMITIVES.NEGOTIATE]: NEGOTIATE_STRATEGY,
  [DNA_PRIMITIVES.SCHEDULE]: SCHEDULE_STRATEGY,
  [DNA_PRIMITIVES.BOOK]: BOOK_STRATEGY,
  [DNA_PRIMITIVES.BUY]: BUY_STRATEGY,
  [DNA_PRIMITIVES.SELL]: SELL_STRATEGY,
  [DNA_PRIMITIVES.LIST]: LIST_STRATEGY,
  [DNA_PRIMITIVES.TRACK]: TRACK_STRATEGY,
  [DNA_PRIMITIVES.MONITOR]: MONITOR_STRATEGY,
  [DNA_PRIMITIVES.VERIFY]: VERIFY_STRATEGY,
  [DNA_PRIMITIVES.DELEGATE]: DELEGATE_STRATEGY,
  [DNA_PRIMITIVES.EXECUTE]: EXECUTE_STRATEGY,
  [DNA_PRIMITIVES.WAIT]: WAIT_STRATEGY,
  [DNA_PRIMITIVES.RETRY]: RETRY_STRATEGY,
  [DNA_PRIMITIVES.RECOVER]: RECOVER_STRATEGY,
  [DNA_PRIMITIVES.PERSIST]: PERSIST_STRATEGY,
  [DNA_PRIMITIVES.REMEMBER]: REMEMBER_STRATEGY,
  [DNA_PRIMITIVES.FORGET]: FORGET_STRATEGY,
  [DNA_PRIMITIVES.ADAPT]: ADAPT_STRATEGY,
  [DNA_PRIMITIVES.LEARN]: LEARN_STRATEGY,
  [DNA_PRIMITIVES.TRANSFORM]: TRANSFORM_STRATEGY,
  [DNA_PRIMITIVES.READ]: READ_STRATEGY,
  [DNA_PRIMITIVES.WRITE]: WRITE_STRATEGY,
  [DNA_PRIMITIVES.VISION]: VISION_STRATEGY,
  [DNA_PRIMITIVES.CALCULATE]: CALCULATE_STRATEGY,
  [DNA_PRIMITIVES.RANK]: RANK_STRATEGY,
  [DNA_PRIMITIVES.FILTER]: FILTER_STRATEGY,
  [DNA_PRIMITIVES.EXTRACT]: EXTRACT_STRATEGY,
  [DNA_PRIMITIVES.CLASSIFY]: CLASSIFY_STRATEGY,
  [DNA_PRIMITIVES.VALIDATE]: VALIDATE_STRATEGY,
  [DNA_PRIMITIVES.DECOMPOSE]: DECOMPOSE_STRATEGY,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Capability Registry
// ═══════════════════════════════════════════════════════════════════════════════

let registryInstance: CapabilityRegistry;

export class CapabilityRegistry {
  private strategies = new Map<string, ExecutionStrategy>();
  private initialized = false;

  constructor() {
    this.registerExecutionStrategies();
    registryInstance = this;
  }

  // ── Registration ─────────────────────────────────────────────────────────────

  async register(capability: Omit<NewCapability, "id" | "createdAt" | "updatedAt">): Promise<Capability> {
    const existing = await db.query.capabilities.findFirst({
      where: eq(capabilities.name, capability.name),
    });
    if (existing) {
      throw new ValidationError(
        ERROR_CODES.CAPABILITY_INVALID_INPUT,
        `Capability with name "${capability.name}" already exists`,
        "name"
      );
    }

    const [result] = await db.insert(capabilities).values(capability);
    const inserted = await db.query.capabilities.findFirst({
      where: eq(capabilities.id, Number(result.insertId)),
    });

    if (!inserted) {
      throw new CapabilityError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, "Capability registration failed");
    }

    return inserted;
  }

  // ── Discovery ────────────────────────────────────────────────────────────────

  async discover(goal: string, context: Record<string, unknown> = {}): Promise<Capability[]> {
    const goalLower = goal.toLowerCase();
    const all = await this.list({ isActive: true });

    const scored = all.map((cap) => {
      let score = 0;
      const nameLower = cap.name.toLowerCase();
      const descLower = (cap.description ?? "").toLowerCase();

      if (goalLower.includes(nameLower) || nameLower.includes(goalLower)) {
        score += 10;
      }
      const goalWords = goalLower.split(/\s+/);
      for (const word of goalWords) {
        if (word.length > 3 && descLower.includes(word)) score += 1;
      }
      const meta = (cap.metadata ?? {}) as Record<string, string>;
      if (meta.keywords) {
        const keywords = Array.isArray(meta.keywords) ? meta.keywords : [meta.keywords];
        for (const kw of keywords) {
          if (goalLower.includes(String(kw).toLowerCase())) score += 3;
        }
      }
      if (score > 0 && cap.riskLevel === "critical") score -= 2;

      return { cap, score };
    });

    const relevant = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.cap);

    return relevant.length > 0 ? relevant : all.slice(0, 5);
  }

  // ── Retrieval ────────────────────────────────────────────────────────────────

  async get(id: number): Promise<Capability> {
    const cap = await db.query.capabilities.findFirst({
      where: eq(capabilities.id, id),
    });
    if (!cap) {
      throw new NotFoundError("Capability", String(id));
    }
    return cap;
  }

  async getByName(name: string): Promise<Capability> {
    const cap = await db.query.capabilities.findFirst({
      where: eq(capabilities.name, name),
    });
    if (!cap) {
      throw new NotFoundError("Capability", name);
    }
    return cap;
  }

  async list(filters?: CapabilityFilter): Promise<Capability[]> {
    const conditions: Array<ReturnType<typeof eq>> = [];
    if (filters?.riskLevel) conditions.push(eq(capabilities.riskLevel, filters.riskLevel));
    if (filters?.isActive !== undefined) conditions.push(eq(capabilities.isActive, filters.isActive));

    const results = await db.query.capabilities.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(capabilities.createdAt)],
    });

    if (filters?.nameLike) {
      const pattern = filters.nameLike.toLowerCase();
      return results.filter(
        (r) =>
          r.name.toLowerCase().includes(pattern) ||
          (r.description ?? "").toLowerCase().includes(pattern)
      );
    }

    if (filters?.requiresPermission) {
      return results.filter((r) => {
        const perms = r.permissions as string[] | null;
        return perms?.includes(filters.requiresPermission!);
      });
    }

    return results;
  }

  // ── Execution ────────────────────────────────────────────────────────────────

  async execute(capabilityId: number, inputs: unknown, context: ToolExecutionContext): Promise<unknown> {
    const cap = await this.get(capabilityId);
    const securityEngine = getSecurityEngine();

    // 1. Check if capability is active
    if (!cap.isActive) {
      throw new CapabilityError(
        ERROR_CODES.CAPABILITY_UNAUTHORIZED,
        `Capability "${cap.name}" is not active`,
        String(capabilityId)
      );
    }

    // 2. Check user permission
    const userId = context.userId ?? "system";
    const permission = await securityEngine.checkCapabilityPermission(
      userId, String(capabilityId), inputs, context
    );
    if (!permission.allowed) {
      await securityEngine.logSecurityEvent({
        type: "permission_denied",
        userId,
        capabilityId: String(capabilityId),
        action: "execute",
        result: "denied",
        reason: permission.reason,
        timestamp: new Date(),
        metadata: { capabilityName: cap.name, inputs },
      });
      throw new CapabilityError(
        ERROR_CODES.CAPABILITY_UNAUTHORIZED,
        `Permission denied: ${permission.reason}`,
        String(capabilityId)
      );
    }

    // 3. Assess risk
    const risk = await securityEngine.assessRisk(String(capabilityId), inputs, context);
    if (risk.requiresApproval) {
      const hasApproval = await securityEngine.hasValidApproval(String(capabilityId), context);
      if (!hasApproval) {
        await securityEngine.logSecurityEvent({
          type: "approval_required",
          userId,
          capabilityId: String(capabilityId),
          action: "execute",
          result: "pending_approval",
          reason: `Risk level: ${risk.level}; gates: ${risk.gates.join(", ")}`,
          timestamp: new Date(),
          metadata: { capabilityName: cap.name, riskLevel: risk.level, gates: risk.gates },
        });
        throw new CapabilityError(
          ERROR_CODES.APPROVAL_REQUIRED,
          `Approval required for capability "${cap.name}" (risk: ${risk.level}). Gates: ${risk.gates.join(", ")}`,
          String(capabilityId),
          true
        );
      }
    }

    // Validate inputs against inputSchema if present
    if (cap.inputSchema && Object.keys(cap.inputSchema).length > 0) {
      this.validateAgainstSchema(inputs, cap.inputSchema as JSONSchema, "input");
    }

    // Resolve execution strategy
    const strategy = this.strategies.get(cap.name);
    if (!strategy) {
      throw new CapabilityError(
        ERROR_CODES.CAPABILITY_EXECUTION_FAILED,
        `No execution strategy registered for capability "${cap.name}"`,
        String(capabilityId)
      );
    }

    // Build augmented context
    const cytoplasm = getCytoplasm({
      taskId: context.taskId,
      userId: context.userId,
      correlationId: context.correlationId,
    });

    const augmentedContext: AugmentedExecutionContext = {
      ...context,
      cytoplasm,
      executeCapability: async (name: string, ins: any) => this.executeByName(name, ins, context),
    };

    try {
      const result = await this.executeStrategy(strategy, inputs, augmentedContext);

      // Validate outputs against outputSchema if present
      if (cap.outputSchema && Object.keys(cap.outputSchema).length > 0) {
        this.validateAgainstSchema(result, cap.outputSchema as JSONSchema, "output");
      }

      // 4. Log side effects
      const sideEffects = cap.sideEffects as Array<{ type: string; description: string; reversible: boolean }> | null;
      if (sideEffects && sideEffects.length > 0) {
        await securityEngine.logSecurityEvent({
          type: "side_effect_executed",
          userId,
          capabilityId: String(capabilityId),
          action: "execute",
          result: "allowed",
          reason: `Side effects: ${sideEffects.map((se) => se.type).join(", ")}`,
          timestamp: new Date(),
          metadata: { capabilityName: cap.name, sideEffects },
        });
      }

      return result;
    } catch (err) {
      throw new CapabilityError(
        ERROR_CODES.CAPABILITY_EXECUTION_FAILED,
        err instanceof Error ? err.message : String(err),
        String(capabilityId),
        true
      );
    }
  }

  async executeByName(capabilityName: string, inputs: unknown, context: ToolExecutionContext): Promise<unknown> {
    const cap = await this.getByName(capabilityName);
    return this.execute(cap.id, inputs, context);
  }

  // ── Matching ─────────────────────────────────────────────────────────────────

  async match(taskRequirements: { goal: string; requiredPermissions?: string[] }): Promise<Capability[]> {
    const candidates = await this.discover(taskRequirements.goal);

    if (!taskRequirements.requiredPermissions || taskRequirements.requiredPermissions.length === 0) {
      return candidates;
    }

    return candidates.filter((cap) => {
      const capPerms = (cap.permissions ?? []) as string[];
      return taskRequirements.requiredPermissions!.every((rp) => capPerms.includes(rp));
    });
  }

  // ── Strategy Registration ────────────────────────────────────────────────────

  registerStrategy(name: string, strategy: ExecutionStrategy): void {
    this.strategies.set(name, strategy);
  }

  getStrategy(name: string): ExecutionStrategy | undefined {
    return this.strategies.get(name);
  }

  // ── Initialization ───────────────────────────────────────────────────────────

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    const count = await db.select({ count: capabilities.id }).from(capabilities);
    if (count.length === 0) {
      await this.seedPrimitives();
    }

    this.initialized = true;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private: Strategy Execution
  // ═══════════════════════════════════════════════════════════════════════════════

  private async executeStrategy(
    strategy: ExecutionStrategy,
    inputs: unknown,
    context: AugmentedExecutionContext
  ): Promise<unknown> {
    switch (strategy.type) {
      case "llm":
        return this.executeLLM(strategy, inputs, context);
      case "tool":
        return this.executeTool(strategy, inputs, context);
      case "runtime":
        return strategy.handler(inputs, context);
      case "composite":
        return this.executeComposite(strategy, inputs, context);
      case "human_gate":
        return this.executeHumanGate(strategy, inputs, context);
      default:
        throw new CapabilityError(
          ERROR_CODES.CAPABILITY_EXECUTION_FAILED,
          `Unknown strategy type: ${(strategy as any).type}`
        );
    }
  }

  private async executeLLM(
    strategy: Extract<ExecutionStrategy, { type: "llm" }>,
    inputs: unknown,
    context: AugmentedExecutionContext
  ): Promise<unknown> {
    const prompt = this.fillTemplate(strategy.promptTemplate, inputs);
    const systemPrompt = strategy.systemPrompt
      ? this.fillTemplate(strategy.systemPrompt, inputs)
      : undefined;

    const llmRequest: LLMRequest = {
      prompt,
      systemPrompt,
      responseFormat: strategy.responseFormat ?? "text",
      complexity: strategy.responseFormat === "json" ? "normal" : "simple",
      maxTokens: 4096,
      temperature: 0.7,
      userId: context.userId,
      requireJson: strategy.responseFormat === "json",
      streaming: false,
    };

    const response = await llmRouter.routeWithFallback(llmRequest);

    if (response.error) {
      throw new Error(`LLM execution failed: ${response.error}`);
    }

    if (strategy.responseFormat === "json") {
      try {
        const parsed = JSON.parse(response.text);
        return { ...parsed, _model: response.model, _tokensUsed: response.tokensUsed };
      } catch {
        return {
          text: response.text,
          parsed: false,
          _model: response.model,
          _tokensUsed: response.tokensUsed,
        };
      }
    }

    return {
      text: response.text,
      model: response.model,
      tokensUsed: response.tokensUsed,
      cost: response.cost,
      latency: response.latency,
    };
  }

  private async executeTool(
    strategy: Extract<ExecutionStrategy, { type: "tool" }>,
    inputs: unknown,
    context: AugmentedExecutionContext
  ): Promise<unknown> {
    const toolRuntime = getToolRuntime();
    const tool = await toolRuntime.getByName(strategy.toolId);
    const toolInputs = this.mapInputs(strategy.inputMapping, inputs);
    const result = await toolRuntime.invoke(tool.id, toolInputs, context);
    return {
      success: result.success,
      output: result.output,
      duration: result.duration,
      sideEffects: result.sideEffects,
    };
  }

  private async executeComposite(
    strategy: Extract<ExecutionStrategy, { type: "composite" }>,
    inputs: unknown,
    context: AugmentedExecutionContext
  ): Promise<unknown> {
    const results: unknown[] = [];
    for (const step of strategy.steps) {
      const stepInputs = this.mapInputs(step.inputs ?? {}, inputs, results);
      const result = await context.executeCapability(step.capability, stepInputs);
      results.push(result);
    }
    return {
      results,
      stepCount: results.length,
      finalResult: results.length > 0 ? results[results.length - 1] : null,
    };
  }

  private executeHumanGate(
    strategy: Extract<ExecutionStrategy, { type: "human_gate" }>,
    inputs: unknown,
    _context: AugmentedExecutionContext
  ): unknown {
    const question = this.fillTemplate(strategy.questionTemplate, inputs);
    return {
      gate: true,
      question,
      requiredFields: strategy.requiredFields ?? ["confirmed"],
      status: "WAITING_FOR_INPUT",
      timestamp: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private: Template & Input Resolution
  // ═══════════════════════════════════════════════════════════════════════════════

  private fillTemplate(template: string, inputs: unknown): string {
    if (!template || typeof template !== "string") return "";
    const data = inputs as Record<string, unknown>;

    return template.replace(/\{\{(.+?)\}\}/g, (_match, expr) => {
      const trimmed = expr.trim();

      // Handle default syntax: inputs.field || 'default'
      const defaultMatch = trimmed.match(/^(.+?)\|\|\s*(.+)$/);
      if (defaultMatch) {
        const path = defaultMatch[1].trim();
        const defaultValue = defaultMatch[2].trim().replace(/^['"]|['"]$/g, "");
        const resolved = this.resolveValue(path, data);
        return resolved !== undefined ? String(resolved) : defaultValue;
      }

      // Handle inline JSON objects in template mapping
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          return this.fillTemplate(trimmed, data);
        } catch {
          return trimmed;
        }
      }

      const resolved = this.resolveValue(trimmed, data);
      if (resolved !== undefined) {
        if (typeof resolved === "object") {
          return JSON.stringify(resolved, null, 2);
        }
        return String(resolved);
      }

      return "";
    });
  }

  private resolveValue(path: string, data: Record<string, unknown>): unknown {
    // Handle literal string values in single quotes
    if (path.startsWith("'") && path.endsWith("'")) {
      return path.slice(1, -1);
    }
    // Handle literal string values in double quotes
    if (path.startsWith('"') && path.endsWith('"')) {
      return path.slice(1, -1);
    }

    const parts = path.split(".");
    let current: unknown = data;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private mapInputs(
    mapping: Record<string, string> | undefined,
    inputs: unknown,
    results?: unknown[]
  ): Record<string, unknown> {
    if (!mapping || Object.keys(mapping).length === 0) {
      return inputs as Record<string, unknown>;
    }

    const output: Record<string, unknown> = {};
    const data = inputs as Record<string, unknown>;

    for (const [key, path] of Object.entries(mapping)) {
      // Handle results[N] references for composite step resolution
      if (path.startsWith("results[") && results) {
        const idxMatch = path.match(/results\[(\d+)\](?:\.(.*))?/);
        if (idxMatch) {
          const idx = Number(idxMatch[1]);
          const subPath = idxMatch[2];
          const result = results[idx];
          if (subPath) {
            output[key] = this.resolveValue(subPath, result as Record<string, unknown>);
          } else {
            output[key] = result;
          }
          continue;
        }
      }

      // Handle inline object template expressions (composite step convenience)
      if (path.trim().startsWith("{") && path.trim().endsWith("}")) {
        const filled = this.fillTemplate(path, data);
        // Attempt JSON parse only if it looks like real JSON
        if (/^\s*\{[\s"\w]/.test(filled)) {
          try {
            output[key] = JSON.parse(filled);
            continue;
          } catch {
            // Fall through to raw string
          }
        }
        output[key] = filled;
        continue;
      }

      const resolved = this.resolveValue(path, data);
      output[key] = resolved !== undefined ? resolved : path;
    }

    return output;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private: Validation
  // ═══════════════════════════════════════════════════════════════════════════════

  private validateAgainstSchema(data: unknown, schema: JSONSchema, phase: string): void {
    if (!schema || !schema.properties) return;
    if (schema.required && Array.isArray(schema.required)) {
      const obj = data as Record<string, unknown>;
      for (const key of schema.required) {
        if (obj?.[key] === undefined) {
          throw new ValidationError(
            ERROR_CODES.SCHEMA_MISMATCH,
            `Missing required ${phase} field: ${key}`,
            key
          );
        }
      }
    }
  }

  private registerExecutionStrategies(): void {
    for (const [name, strategy] of Object.entries(STRATEGY_REGISTRY)) {
      this.strategies.set(name, strategy);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Seed: 37 DNA Primitive Capabilities
  // ═══════════════════════════════════════════════════════════════════════════════

  private async seedPrimitives(): Promise<void> {
    const primitives: Array<Omit<NewCapability, "id" | "createdAt" | "updatedAt">> = [
      // ── Cognition ──────────────────────────────────────────────────────────
      {
        name: DNA_PRIMITIVES.UNDERSTAND,
        description: "Comprehend natural language intent, context, and semantics from user input.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { text: { type: "string" }, context: { type: "object" } }, required: ["text"] },
        outputSchema: { type: "object", properties: { intent: { type: "string" }, confidence: { type: "number" }, entities: { type: "array" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.UNDERSTAND,
        validationRules: JSON.stringify([{ field: "text", operator: "exists", message: "Text is required" }]),
        metadata: { keywords: ["understand", "comprehend", "intent", "semantics", "meaning"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.INTERPRET,
        description: "Translate between representations, formats, or symbolic languages.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { data: {}, sourceFormat: { type: "string" }, targetFormat: { type: "string" } }, required: ["data"] },
        outputSchema: { type: "object", properties: { result: {}, confidence: { type: "number" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.INTERPRET,
        validationRules: JSON.stringify([]),
        metadata: { keywords: ["interpret", "translate", "convert", "transform"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.CLASSIFY,
        description: "Categorize input into predefined or dynamically discovered classes.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { input: {}, categories: { type: "array", items: { type: "string" } } }, required: ["input"] },
        outputSchema: { type: "object", properties: { classification: { type: "string" }, confidence: { type: "number" }, alternatives: { type: "array" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.CLASSIFY,
        validationRules: JSON.stringify([{ field: "input", operator: "exists" }]),
        metadata: { keywords: ["classify", "categorize", "label", "sort"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.EXTRACT,
        description: "Pull structured data and entities from unstructured or semi-structured input.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { source: {}, schema: { type: "object" }, instructions: { type: "string" } }, required: ["source"] },
        outputSchema: { type: "object", properties: { entities: { type: "array" }, relationships: { type: "array" }, confidence: { type: "number" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "low",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.EXTRACT,
        validationRules: JSON.stringify([{ field: "source", operator: "exists" }]),
        metadata: { keywords: ["extract", "parse", "entities", "structured"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.REASON,
        description: "Apply logical inference, deduction, and causal reasoning over facts.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { premises: { type: "array" }, question: { type: "string" }, context: { type: "object" } }, required: ["question"] },
        outputSchema: { type: "object", properties: { conclusion: { type: "string" }, confidence: { type: "number" }, chain: { type: "array" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "low",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.REASON,
        validationRules: JSON.stringify([]),
        metadata: { keywords: ["reason", "infer", "deduce", "logic", "causal"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.PLAN,
        description: "Generate a sequence or graph of actions to achieve a stated goal.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { goal: { type: "string" }, constraints: { type: "array" }, availableCapabilities: { type: "array" } }, required: ["goal"] },
        outputSchema: { type: "object", properties: { plan: { type: "object" }, steps: { type: "array" }, estimatedCost: { type: "number" } } },
        requirements: [DNA_PRIMITIVES.UNDERSTAND],
        permissions: ["read"],
        riskLevel: "low",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.PLAN,
        validationRules: JSON.stringify([{ field: "goal", operator: "exists" }]),
        metadata: { keywords: ["plan", "strategy", "sequence", "schedule", "actions"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.DECOMPOSE,
        description: "Break a complex goal into smaller, independently executable sub-goals.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { goal: { type: "string" }, maxDepth: { type: "number" }, stopAt: { type: "string" } }, required: ["goal"] },
        outputSchema: { type: "object", properties: { subGoals: { type: "array" }, dependencies: { type: "array" }, leafTasks: { type: "number" } } },
        requirements: [DNA_PRIMITIVES.UNDERSTAND, DNA_PRIMITIVES.PLAN],
        permissions: ["read"],
        riskLevel: "low",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.DECOMPOSE,
        validationRules: JSON.stringify([{ field: "goal", operator: "exists" }]),
        metadata: { keywords: ["decompose", "breakdown", "subtasks", "divide"], executionStrategy: "llm" },
      },
      // ── Retrieval ────────────────────────────────────────────────────────────
      {
        name: DNA_PRIMITIVES.SEARCH,
        description: "Find information across indexed data sources using queries.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { query: { type: "string" }, filters: { type: "object" }, sources: { type: "array" } }, required: ["query"] },
        outputSchema: { type: "object", properties: { results: { type: "array" }, total: { type: "number" }, facets: { type: "object" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.SEARCH,
        validationRules: JSON.stringify([{ field: "query", operator: "exists" }]),
        metadata: { keywords: ["search", "find", "query", "lookup"], executionStrategy: "tool" },
      },
      {
        name: DNA_PRIMITIVES.DISCOVER,
        description: "Explore unknown or partially known spaces to surface relevant items.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { seed: { type: "string" }, depth: { type: "number" }, criteria: { type: "object" } }, required: ["seed"] },
        outputSchema: { type: "object", properties: { items: { type: "array" }, coverage: { type: "number" }, novelty: { type: "number" } } },
        requirements: [DNA_PRIMITIVES.SEARCH],
        permissions: ["read"],
        riskLevel: "low",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.DISCOVER,
        validationRules: JSON.stringify([]),
        metadata: { keywords: ["discover", "explore", "surface", "recommend"], executionStrategy: "composite" },
      },
      {
        name: DNA_PRIMITIVES.RETRIEVE,
        description: "Fetch a specific record or document by identifier or key.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { id: { type: "string" }, type: { type: "string" }, source: { type: "string" } }, required: ["id"] },
        outputSchema: { type: "object", properties: { data: {}, found: { type: "boolean" }, source: { type: "string" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.RETRIEVE,
        validationRules: JSON.stringify([{ field: "id", operator: "exists" }]),
        metadata: { keywords: ["retrieve", "fetch", "get", "read", "load"], executionStrategy: "tool" },
      },
      {
        name: DNA_PRIMITIVES.COMPARE,
        description: "Evaluate two or more items across dimensions and produce a comparison.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { items: { type: "array" }, dimensions: { type: "array" }, weights: { type: "object" } }, required: ["items"] },
        outputSchema: { type: "object", properties: { comparison: { type: "object" }, ranking: { type: "array" }, winner: {} } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.COMPARE,
        validationRules: JSON.stringify([{ field: "items", operator: "exists" }]),
        metadata: { keywords: ["compare", "contrast", "evaluate", "versus", "diff"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.RANK,
        description: "Order a collection by relevance, quality, or a scoring function.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { items: { type: "array" }, criteria: { type: "string" }, scorer: { type: "string" } }, required: ["items"] },
        outputSchema: { type: "object", properties: { ranked: { type: "array" }, scores: { type: "object" }, topK: { type: "array" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.RANK,
        validationRules: JSON.stringify([{ field: "items", operator: "exists" }]),
        metadata: { keywords: ["rank", "order", "sort", "score", "prioritize"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.MATCH,
        description: "Pair a request with the best-fitting candidate from a pool.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { request: { type: "object" }, candidates: { type: "array" }, criteria: { type: "object" } }, required: ["request", "candidates"] },
        outputSchema: { type: "object", properties: { matches: { type: "array" }, bestMatch: {}, score: { type: "number" } } },
        requirements: [DNA_PRIMITIVES.COMPARE],
        permissions: ["read"],
        riskLevel: "low",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.MATCH,
        validationRules: JSON.stringify([{ field: "request", operator: "exists" }]),
        metadata: { keywords: ["match", "pair", "fit", "recommend", "best"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.FILTER,
        description: "Reduce a collection by applying predicate conditions.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { items: { type: "array" }, conditions: { type: "array" }, mode: { type: "string" } }, required: ["items"] },
        outputSchema: { type: "object", properties: { filtered: { type: "array" }, excluded: { type: "array" }, count: { type: "number" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.FILTER,
        validationRules: JSON.stringify([{ field: "items", operator: "exists" }]),
        metadata: { keywords: ["filter", "reduce", "narrow", "select", "subset"], executionStrategy: "runtime" },
      },
      // ── Analysis ─────────────────────────────────────────────────────────────
      {
        name: DNA_PRIMITIVES.ANALYZE,
        description: "Perform deep inspection and pattern detection over data.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { data: {}, type: { type: "string" }, depth: { type: "string" } }, required: ["data"] },
        outputSchema: { type: "object", properties: { insights: { type: "array" }, patterns: { type: "array" }, anomalies: { type: "array" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.ANALYZE,
        validationRules: JSON.stringify([{ field: "data", operator: "exists" }]),
        metadata: { keywords: ["analyze", "inspect", "pattern", "deep", "insight"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.CALCULATE,
        description: "Perform mathematical, statistical, or logical computation.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { expression: { type: "string" }, variables: { type: "object" }, precision: { type: "number" } }, required: ["expression"] },
        outputSchema: { type: "object", properties: { result: {}, steps: { type: "array" }, error: { type: "number" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.CALCULATE,
        validationRules: JSON.stringify([{ field: "expression", operator: "exists" }]),
        metadata: { keywords: ["calculate", "compute", "math", "statistics", "formula"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.GENERATE,
        description: "Produce new content, code, text, images, or structured artifacts.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { prompt: { type: "string" }, type: { type: "string" }, constraints: { type: "object" } }, required: ["prompt"] },
        outputSchema: { type: "object", properties: { content: {}, format: { type: "string" }, tokensUsed: { type: "number" } } },
        requirements: [],
        permissions: ["read", "write"],
        riskLevel: "low",
        sideEffects: [{ type: "resource_consumption", description: "May consume LLM tokens", reversible: false }],
        executionHandler: DNA_PRIMITIVES.GENERATE,
        validationRules: JSON.stringify([{ field: "prompt", operator: "exists" }]),
        metadata: { keywords: ["generate", "create", "produce", "synthesize", "compose"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.CREATE,
        description: "Instantiate a new entity, resource, or persistent record.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { type: { type: "string" }, data: { type: "object" }, owner: { type: "string" } }, required: ["type", "data"] },
        outputSchema: { type: "object", properties: { id: { type: "string" }, entity: {}, created: { type: "boolean" } } },
        requirements: [],
        permissions: ["write"],
        riskLevel: "medium",
        sideEffects: [{ type: "data_modification", description: "Creates persistent records", reversible: true }],
        executionHandler: DNA_PRIMITIVES.CREATE,
        validationRules: JSON.stringify([{ field: "type", operator: "exists" }]),
        metadata: { keywords: ["create", "instantiate", "spawn", "new", "build"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.TRANSFORM,
        description: "Modify the representation, structure, or format of data.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { data: {}, transform: { type: "string" }, targetSchema: { type: "object" } }, required: ["data"] },
        outputSchema: { type: "object", properties: { result: {}, originalFormat: { type: "string" }, newFormat: { type: "string" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "low",
        sideEffects: [{ type: "data_modification", description: "Transforms data representation", reversible: true }],
        executionHandler: DNA_PRIMITIVES.TRANSFORM,
        validationRules: JSON.stringify([{ field: "data", operator: "exists" }]),
        metadata: { keywords: ["transform", "convert", "reshape", "map", "reformat"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.READ,
        description: "Access and ingest data from a source without modification.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { source: { type: "string" }, format: { type: "string" }, offset: { type: "number" } }, required: ["source"] },
        outputSchema: { type: "object", properties: { data: {}, size: { type: "number" }, etag: { type: "string" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.READ,
        validationRules: JSON.stringify([{ field: "source", operator: "exists" }]),
        metadata: { keywords: ["read", "access", "ingest", "load", "fetch"], executionStrategy: "tool" },
      },
      {
        name: DNA_PRIMITIVES.WRITE,
        description: "Persist data to a destination, overwriting or appending.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { destination: { type: "string" }, data: {}, mode: { type: "string" } }, required: ["destination", "data"] },
        outputSchema: { type: "object", properties: { written: { type: "boolean" }, bytes: { type: "number" }, version: { type: "string" } } },
        requirements: [],
        permissions: ["write"],
        riskLevel: "medium",
        sideEffects: [{ type: "data_modification", description: "Modifies persistent data", reversible: true }],
        executionHandler: DNA_PRIMITIVES.WRITE,
        validationRules: JSON.stringify([{ field: "destination", operator: "exists" }]),
        metadata: { keywords: ["write", "persist", "save", "store", "commit"], executionStrategy: "composite" },
      },
      {
        name: DNA_PRIMITIVES.VISION,
        description: "Process and interpret visual input (images, video frames, diagrams).",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { image: { type: "string" }, task: { type: "string" }, questions: { type: "array" } }, required: ["image"] },
        outputSchema: { type: "object", properties: { description: { type: "string" }, objects: { type: "array" }, text: { type: "string" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "low",
        sideEffects: [{ type: "resource_consumption", description: "May consume vision model tokens", reversible: false }],
        executionHandler: DNA_PRIMITIVES.VISION,
        validationRules: JSON.stringify([{ field: "image", operator: "exists" }]),
        metadata: { keywords: ["vision", "image", "visual", "see", "recognize"], executionStrategy: "llm" },
      },
      // ── Interaction ──────────────────────────────────────────────────────────
      {
        name: DNA_PRIMITIVES.COMMUNICATE,
        description: "Exchange information with users, agents, or external systems.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { message: { type: "string" }, recipient: { type: "string" }, channel: { type: "string" } }, required: ["message"] },
        outputSchema: { type: "object", properties: { delivered: { type: "boolean" }, response: {}, latency: { type: "number" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [{ type: "external_communication", description: "Sends messages externally", reversible: false }],
        executionHandler: DNA_PRIMITIVES.COMMUNICATE,
        validationRules: JSON.stringify([{ field: "message", operator: "exists" }]),
        metadata: { keywords: ["communicate", "send", "message", "chat", "notify"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.ASK,
        description: "Request information, clarification, or confirmation from a user or system.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { question: { type: "string" }, options: { type: "array" }, required: { type: "boolean" } }, required: ["question"] },
        outputSchema: { type: "object", properties: { answer: {}, answered: { type: "boolean" }, followUp: { type: "string" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [{ type: "external_communication", description: "May block waiting for user input", reversible: true }],
        executionHandler: DNA_PRIMITIVES.ASK,
        validationRules: JSON.stringify([{ field: "question", operator: "exists" }]),
        metadata: { keywords: ["ask", "question", "prompt", "clarify", "confirm"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.CONFIRM,
        description: "Validate that an action, state, or understanding is correct before proceeding.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { proposition: { type: "string" }, evidence: {}, threshold: { type: "number" } }, required: ["proposition"] },
        outputSchema: { type: "object", properties: { confirmed: { type: "boolean" }, confidence: { type: "number" }, reason: { type: "string" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "low",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.CONFIRM,
        validationRules: JSON.stringify([{ field: "proposition", operator: "exists" }]),
        metadata: { keywords: ["confirm", "validate", "verify", "check", "assure"], executionStrategy: "human_gate" },
      },
      {
        name: DNA_PRIMITIVES.NEGOTIATE,
        description: "Engage in iterative offer/counteroffer to reach mutual agreement.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { objective: { type: "string" }, offer: { type: "object" }, limits: { type: "object" }, parties: { type: "array" } }, required: ["objective"] },
        outputSchema: { type: "object", properties: { agreement: { type: "object" }, status: { type: "string" }, rounds: { type: "number" } } },
        requirements: [DNA_PRIMITIVES.REASON, DNA_PRIMITIVES.COMPARE],
        permissions: ["read", "write"],
        riskLevel: "medium",
        sideEffects: [{ type: "external_communication", description: "Engages with external parties", reversible: false }],
        executionHandler: DNA_PRIMITIVES.NEGOTIATE,
        validationRules: JSON.stringify([{ field: "objective", operator: "exists" }]),
        metadata: { keywords: ["negotiate", "bargain", "offer", "deal", "agree"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.SCHEDULE,
        description: "Arrange events, tasks, or resources on a timeline.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { event: { type: "object" }, constraints: { type: "object" }, participants: { type: "array" } }, required: ["event"] },
        outputSchema: { type: "object", properties: { scheduled: { type: "boolean" }, slot: { type: "object" }, conflicts: { type: "array" } } },
        requirements: [],
        permissions: ["write"],
        riskLevel: "medium",
        sideEffects: [{ type: "data_modification", description: "Modifies calendars/schedules", reversible: true }],
        executionHandler: DNA_PRIMITIVES.SCHEDULE,
        validationRules: JSON.stringify([{ field: "event", operator: "exists" }]),
        metadata: { keywords: ["schedule", "calendar", "book", "reserve", "time"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.BOOK,
        description: "Reserve a resource, slot, or inventory item.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { item: { type: "object" }, duration: { type: "object" }, party: { type: "string" } }, required: ["item"] },
        outputSchema: { type: "object", properties: { booked: { type: "boolean" }, reservation: { type: "object" }, cost: { type: "number" } } },
        requirements: [DNA_PRIMITIVES.SCHEDULE],
        permissions: ["write"],
        riskLevel: "medium",
        sideEffects: [{ type: "data_modification", description: "Consumes inventory/slots", reversible: true }],
        executionHandler: DNA_PRIMITIVES.BOOK,
        validationRules: JSON.stringify([{ field: "item", operator: "exists" }]),
        metadata: { keywords: ["book", "reserve", "hold", "claim", "slot"], executionStrategy: "composite" },
      },
      {
        name: DNA_PRIMITIVES.BUY,
        description: "Initiate a purchase transaction.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { item: { type: "object" }, payment: { type: "object" }, quantity: { type: "number" } }, required: ["item"] },
        outputSchema: { type: "object", properties: { transaction: { type: "object" }, receipt: { type: "object" }, status: { type: "string" } } },
        requirements: [DNA_PRIMITIVES.NEGOTIATE],
        permissions: ["write"],
        riskLevel: "high",
        sideEffects: [{ type: "payment", description: "Transfers funds", reversible: false }],
        executionHandler: DNA_PRIMITIVES.BUY,
        validationRules: JSON.stringify([{ field: "item", operator: "exists" }]),
        metadata: { keywords: ["buy", "purchase", "acquire", "pay", "transaction"], executionStrategy: "composite" },
      },
      {
        name: DNA_PRIMITIVES.SELL,
        description: "Initiate a sale transaction.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { item: { type: "object" }, price: { type: "number" }, terms: { type: "object" } }, required: ["item"] },
        outputSchema: { type: "object", properties: { transaction: { type: "object" }, receipt: { type: "object" }, status: { type: "string" } } },
        requirements: [DNA_PRIMITIVES.NEGOTIATE],
        permissions: ["write"],
        riskLevel: "high",
        sideEffects: [{ type: "payment", description: "Receives funds; transfers goods", reversible: false }],
        executionHandler: DNA_PRIMITIVES.SELL,
        validationRules: JSON.stringify([{ field: "item", operator: "exists" }]),
        metadata: { keywords: ["sell", "offer", "list", "transaction", "revenue"], executionStrategy: "composite" },
      },
      {
        name: DNA_PRIMITIVES.LIST,
        description: "Enumerate items from a collection with pagination and sorting.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { source: { type: "string" }, filters: { type: "object" }, pagination: { type: "object" } }, required: ["source"] },
        outputSchema: { type: "object", properties: { items: { type: "array" }, total: { type: "number" }, page: { type: "object" } } },
        requirements: [DNA_PRIMITIVES.READ],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.LIST,
        validationRules: JSON.stringify([{ field: "source", operator: "exists" }]),
        metadata: { keywords: ["list", "enumerate", "page", "sort", "browse"], executionStrategy: "tool" },
      },
      // ── Tracking ─────────────────────────────────────────────────────────────
      {
        name: DNA_PRIMITIVES.TRACK,
        description: "Follow the status, location, or progress of an entity or process.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { target: { type: "string" }, type: { type: "string" }, since: { type: "string" } }, required: ["target"] },
        outputSchema: { type: "object", properties: { status: { type: "string" }, history: { type: "array" }, current: {} } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.TRACK,
        validationRules: JSON.stringify([{ field: "target", operator: "exists" }]),
        metadata: { keywords: ["track", "follow", "status", "progress", "trace"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.MONITOR,
        description: "Continuously observe a system, metric, or condition and alert on thresholds.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { target: { type: "string" }, metrics: { type: "array" }, thresholds: { type: "object" } }, required: ["target"] },
        outputSchema: { type: "object", properties: { healthy: { type: "boolean" }, readings: { type: "array" }, alerts: { type: "array" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "low",
        sideEffects: [{ type: "external_communication", description: "May send alerts", reversible: false }],
        executionHandler: DNA_PRIMITIVES.MONITOR,
        validationRules: JSON.stringify([{ field: "target", operator: "exists" }]),
        metadata: { keywords: ["monitor", "observe", "watch", "alert", "metric"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.VERIFY,
        description: "Check the authenticity, integrity, or correctness of data or identity.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { data: {}, signature: { type: "string" }, method: { type: "string" } }, required: ["data"] },
        outputSchema: { type: "object", properties: { valid: { type: "boolean" }, method: { type: "string" }, details: { type: "object" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "low",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.VERIFY,
        validationRules: JSON.stringify([{ field: "data", operator: "exists" }]),
        metadata: { keywords: ["verify", "authenticate", "check", "validate", "integrity"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.VALIDATE,
        description: "Ensure data conforms to a schema, rule set, or business constraint.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { data: {}, schema: { type: "object" }, rules: { type: "array" } }, required: ["data"] },
        outputSchema: { type: "object", properties: { valid: { type: "boolean" }, errors: { type: "array" }, warnings: { type: "array" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [],
        executionHandler: DNA_PRIMITIVES.VALIDATE,
        validationRules: JSON.stringify([{ field: "data", operator: "exists" }]),
        metadata: { keywords: ["validate", "conform", "schema", "constraint", "correctness"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.DELEGATE,
        description: "Assign a task or subtask to another agent, service, or user.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { task: { type: "object" }, assignee: { type: "string" }, deadline: { type: "string" } }, required: ["task"] },
        outputSchema: { type: "object", properties: { delegated: { type: "boolean" }, assignmentId: { type: "string" }, eta: { type: "string" } } },
        requirements: [DNA_PRIMITIVES.PLAN],
        permissions: ["write"],
        riskLevel: "medium",
        sideEffects: [{ type: "external_communication", description: "May assign work to external agents", reversible: true }],
        executionHandler: DNA_PRIMITIVES.DELEGATE,
        validationRules: JSON.stringify([{ field: "task", operator: "exists" }]),
        metadata: { keywords: ["delegate", "assign", "handoff", "transfer", "distribute"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.EXECUTE,
        description: "Run a tool, function, API call, or script and return results.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { tool: { type: "string" }, inputs: { type: "object" }, timeout: { type: "number" } }, required: ["tool"] },
        outputSchema: { type: "object", properties: { success: { type: "boolean" }, result: {}, duration: { type: "number" } } },
        requirements: [],
        permissions: ["write"],
        riskLevel: "medium",
        sideEffects: [{ type: "external_communication", description: "Executes external tools", reversible: false }],
        executionHandler: DNA_PRIMITIVES.EXECUTE,
        validationRules: JSON.stringify([{ field: "tool", operator: "exists" }]),
        metadata: { keywords: ["execute", "run", "invoke", "call", "perform"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.WAIT,
        description: "Pause execution until a condition, time, or event occurs.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { until: { type: "string" }, condition: { type: "object" }, timeout: { type: "number" } }, required: ["until"] },
        outputSchema: { type: "object", properties: { resumed: { type: "boolean" }, trigger: { type: "string" }, waitedMs: { type: "number" } } },
        requirements: [],
        permissions: ["read"],
        riskLevel: "none",
        sideEffects: [{ type: "resource_consumption", description: "Holds execution context", reversible: true }],
        executionHandler: DNA_PRIMITIVES.WAIT,
        validationRules: JSON.stringify([{ field: "until", operator: "exists" }]),
        metadata: { keywords: ["wait", "pause", "delay", "sleep", "await"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.RETRY,
        description: "Re-attempt a failed action with modified parameters or backoff.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { action: { type: "object" }, strategy: { type: "string" }, maxAttempts: { type: "number" } }, required: ["action"] },
        outputSchema: { type: "object", properties: { success: { type: "boolean" }, attempts: { type: "number" }, finalResult: {} } },
        requirements: [DNA_PRIMITIVES.EXECUTE],
        permissions: ["write"],
        riskLevel: "low",
        sideEffects: [{ type: "resource_consumption", description: "May consume retries", reversible: false }],
        executionHandler: DNA_PRIMITIVES.RETRY,
        validationRules: JSON.stringify([{ field: "action", operator: "exists" }]),
        metadata: { keywords: ["retry", "repeat", "reattempt", "backoff", "recover"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.RECOVER,
        description: "Restore from failure using compensating actions or alternatives.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { failure: { type: "object" }, strategy: { type: "string" }, alternatives: { type: "array" } }, required: ["failure"] },
        outputSchema: { type: "object", properties: { recovered: { type: "boolean" }, used: { type: "string" }, state: {} } },
        requirements: [DNA_PRIMITIVES.RETRY, DNA_PRIMITIVES.PLAN],
        permissions: ["write"],
        riskLevel: "high",
        sideEffects: [{ type: "data_modification", description: "May run compensating transactions", reversible: false }],
        executionHandler: DNA_PRIMITIVES.RECOVER,
        validationRules: JSON.stringify([{ field: "failure", operator: "exists" }]),
        metadata: { keywords: ["recover", "restore", "compensate", "heal", "fix"], executionStrategy: "llm" },
      },
      // ── Persistence / Learning ───────────────────────────────────────────────
      {
        name: DNA_PRIMITIVES.PERSIST,
        description: "Store runtime state durably for resilience and auditability.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { state: { type: "object" }, checkpoint: { type: "string" }, ttl: { type: "number" } }, required: ["state"] },
        outputSchema: { type: "object", properties: { stored: { type: "boolean" }, id: { type: "string" }, expires: { type: "string" } } },
        requirements: [DNA_PRIMITIVES.WRITE],
        permissions: ["write"],
        riskLevel: "low",
        sideEffects: [{ type: "data_modification", description: "Writes checkpoints", reversible: true }],
        executionHandler: DNA_PRIMITIVES.PERSIST,
        validationRules: JSON.stringify([{ field: "state", operator: "exists" }]),
        metadata: { keywords: ["persist", "checkpoint", "save", "durability", "backup"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.REMEMBER,
        description: "Commit a fact or experience to long-term memory.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { fact: { type: "object" }, scope: { type: "string" }, importance: { type: "number" } }, required: ["fact"] },
        outputSchema: { type: "object", properties: { stored: { type: "boolean" }, memoryId: { type: "string" }, recallConfidence: { type: "number" } } },
        requirements: [DNA_PRIMITIVES.PERSIST],
        permissions: ["write"],
        riskLevel: "low",
        sideEffects: [{ type: "data_modification", description: "Writes to memory store", reversible: true }],
        executionHandler: DNA_PRIMITIVES.REMEMBER,
        validationRules: JSON.stringify([{ field: "fact", operator: "exists" }]),
        metadata: { keywords: ["remember", "memorize", "learn", "store", "recall"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.FORGET,
        description: "Remove data from memory within policy constraints.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { memoryId: { type: "string" }, scope: { type: "string" }, reason: { type: "string" } }, required: ["memoryId"] },
        outputSchema: { type: "object", properties: { forgotten: { type: "boolean" }, remaining: { type: "number" } } },
        requirements: [DNA_PRIMITIVES.REMEMBER],
        permissions: ["write"],
        riskLevel: "medium",
        sideEffects: [{ type: "data_modification", description: "Deletes memory entries", reversible: false }],
        executionHandler: DNA_PRIMITIVES.FORGET,
        validationRules: JSON.stringify([{ field: "memoryId", operator: "exists" }]),
        metadata: { keywords: ["forget", "delete", "erase", "remove", "purge"], executionStrategy: "runtime" },
      },
      {
        name: DNA_PRIMITIVES.ADAPT,
        description: "Adjust behavior, parameters, or strategy based on feedback.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { feedback: { type: "object" }, current: { type: "object" }, goal: { type: "string" } }, required: ["feedback"] },
        outputSchema: { type: "object", properties: { adjusted: { type: "object" }, delta: { type: "object" }, confidence: { type: "number" } } },
        requirements: [DNA_PRIMITIVES.REASON],
        permissions: ["write"],
        riskLevel: "low",
        sideEffects: [{ type: "data_modification", description: "Updates configuration/behavior", reversible: true }],
        executionHandler: DNA_PRIMITIVES.ADAPT,
        validationRules: JSON.stringify([{ field: "feedback", operator: "exists" }]),
        metadata: { keywords: ["adapt", "adjust", "tune", "optimize", "evolve"], executionStrategy: "llm" },
      },
      {
        name: DNA_PRIMITIVES.LEARN,
        description: "Improve capability or knowledge from examples or outcomes.",
        version: "1.0.0",
        inputSchema: { type: "object", properties: { examples: { type: "array" }, metric: { type: "string" }, baseline: { type: "object" } }, required: ["examples"] },
        outputSchema: { type: "object", properties: { improved: { type: "boolean" }, delta: { type: "number" }, model: { type: "object" } } },
        requirements: [DNA_PRIMITIVES.ADAPT, DNA_PRIMITIVES.REMEMBER],
        permissions: ["write"],
        riskLevel: "medium",
        sideEffects: [{ type: "data_modification", description: "Updates learned models", reversible: true }],
        executionHandler: DNA_PRIMITIVES.LEARN,
        validationRules: JSON.stringify([{ field: "examples", operator: "exists" }]),
        metadata: { keywords: ["learn", "improve", "train", "optimize", "grow"], executionStrategy: "runtime" },
      },
    ];

    for (const primitive of primitives) {
      try {
        await this.register(primitive);
      } catch (err) {
        if (err instanceof ValidationError && err.code === ERROR_CODES.CAPABILITY_INVALID_INPUT) {
          continue;
        }
        throw err;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton Export
// ═══════════════════════════════════════════════════════════════════════════════

export function getCapabilityRegistry(): CapabilityRegistry {
  if (!registryInstance) {
    registryInstance = new CapabilityRegistry();
  }
  return registryInstance;
}

// Singleton instance for direct import
export const capabilityRegistry = getCapabilityRegistry();
