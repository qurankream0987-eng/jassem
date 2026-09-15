/**
 * ============================================================
 * ERROR HANDLER — Structured Error Types & Circuit Breaker
 * JASIM Resilient Error Management System (2026)
 * ============================================================
 *
 * Provides:
 * - Structured error types with error codes
 * - Retry with exponential backoff + jitter
 * - Circuit breaker pattern for LLM calls
 * - Graceful degradation chains
 */

import { z } from "zod";

// ============================================
// ERROR CODES ENUM
// ============================================

export const ErrorCodeSchema = z.enum([
  // Agent errors
  "AGENT_NOT_FOUND",
  "AGENT_TIMEOUT",
  "AGENT_CAPACITY_EXCEEDED",
  "AGENT_EXECUTION_FAILED",
  "AGENT_RETRY_EXHAUSTED",

  // LLM errors
  "LLM_UNAVAILABLE",
  "LLM_RATE_LIMITED",
  "LLM_CONTEXT_EXCEEDED",
  "LLM_INVALID_RESPONSE",
  "LLM_COST_LIMIT",

  // Routing errors
  "ROUTE_NOT_FOUND",
  "ROUTE_INVALID",
  "INTENT_UNRECOGNIZED",

  // Pipeline errors
  "PIPELINE_STAGE_FAILED",
  "PIPELINE_RETRY_EXHAUSTED",
  "PIPELINE_INVALID_INPUT",

  // Memory errors
  "MEMORY_STORE_FAILED",
  "MEMORY_RECALL_FAILED",
  "MEMORY_NOT_FOUND",

  // Circuit breaker errors
  "CIRCUIT_OPEN",
  "CIRCUIT_HALF_OPEN",

  // Validation errors
  "VALIDATION_FAILED",
  "SCHEMA_MISMATCH",

  // General errors
  "INTERNAL_ERROR",
  "NOT_IMPLEMENTED",
  "UNKNOWN_ERROR",
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// ============================================
// STRUCTURED ERROR CLASS
// ============================================

export interface ErrorContext {
  agentType?: string;
  taskId?: string;
  iteration?: number;
  model?: string;
  tier?: number;
  [key: string]: unknown;
}

export const ErrorContextSchema = z.object({
  agentType: z.string().optional(),
  taskId: z.string().optional(),
  iteration: z.number().optional(),
  model: z.string().optional(),
  tier: z.number().optional(),
}).passthrough();

export class JASIMError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly isRetryable: boolean;
  readonly context: ErrorContext;
  readonly timestamp: Date;
  readonly requestId: string;

  constructor(params: {
    code: ErrorCode;
    message: string;
    statusCode?: number;
    isRetryable?: boolean;
    context?: ErrorContext;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "JASIMError";
    this.code = params.code;
    this.statusCode = params.statusCode ?? 500;
    this.isRetryable = params.isRetryable ?? this.deriveRetryable(params.code);
    this.context = params.context ?? {};
    this.timestamp = new Date();
    this.requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    if (params.cause instanceof Error) {
      this.cause = params.cause;
    }
  }

  private deriveRetryable(code: ErrorCode): boolean {
    const retryableCodes: ErrorCode[] = [
      "AGENT_TIMEOUT",
      "AGENT_CAPACITY_EXCEEDED",
      "AGENT_EXECUTION_FAILED",
      "LLM_UNAVAILABLE",
      "LLM_RATE_LIMITED",
      "LLM_INVALID_RESPONSE",
      "MEMORY_STORE_FAILED",
      "MEMORY_RECALL_FAILED",
      "PIPELINE_STAGE_FAILED",
      "CIRCUIT_HALF_OPEN",
    ];
    return retryableCodes.includes(code);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      isRetryable: this.isRetryable,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      requestId: this.requestId,
      stack: this.stack,
      cause: this.cause instanceof Error
        ? { message: this.cause.message, name: this.cause.name }
        : undefined,
    };
  }
}

// ============================================
// RETRY CONFIGURATION
// ============================================

export const RetryConfigSchema = z.object({
  maxRetries: z.number().min(0).max(10).default(3),
  baseDelayMs: z.number().min(10).default(100),
  maxDelayMs: z.number().min(100).default(30000),
  jitterFactor: z.number().min(0).max(1).default(0.3),
  retryableCodes: z.array(ErrorCodeSchema).optional(),
  onRetry: z
    .function()
    .args(z.number(), JASIMError as z.ZodType<unknown>)
    .returns(z.promise(z.void()).or(z.void()))
    .optional(),
});

export type RetryConfig = z.infer<typeof RetryConfigSchema>;

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 30000,
  jitterFactor: 0.3,
};

// ============================================
// EXPONENTIAL BACKOFF WITH JITTER
// ============================================

function calculateBackoff(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, config.maxDelayMs);
  const jitter = capped * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  errorClassifier?: (error: unknown) => ErrorCode | null,
): Promise<T> {
  const resolved = { ...DEFAULT_RETRY_CONFIG, ...config };

  let lastError: JASIMError | null = null;

  for (let attempt = 0; attempt <= resolved.maxRetries; attempt++) {
    try {
      const result = await operation();
      return result;
    } catch (rawError) {
      const code = errorClassifier?.(rawError) ?? "UNKNOWN_ERROR";

      lastError = rawError instanceof JASIMError
        ? rawError
        : new JASIMError({
            code,
            message: rawError instanceof Error ? rawError.message : String(rawError),
            cause: rawError,
          });

      // Don't retry non-retryable errors
      if (!lastError.isRetryable) throw lastError;

      // Don't retry if we've exhausted attempts
      if (attempt >= resolved.maxRetries) break;

      // Calculate and apply backoff
      const delay = calculateBackoff(attempt, resolved);

      if (resolved.onRetry) {
        await resolved.onRetry(attempt + 1, lastError);
      }

      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new JASIMError({
    code: lastError?.code ?? "UNKNOWN_ERROR",
    message: `Retry exhausted after ${resolved.maxRetries} attempts. Last error: ${lastError?.message}`,
    statusCode: lastError?.statusCode,
    context: lastError?.context,
    cause: lastError,
  });
}

// ============================================
// CIRCUIT BREAKER PATTERN
// ============================================

export type CircuitState = "closed" | "open" | "half-open";

export const CircuitBreakerConfigSchema = z.object({
  failureThreshold: z.number().min(1).default(5),
  recoveryTimeoutMs: z.number().min(1000).default(30000),
  halfOpenMaxCalls: z.number().min(1).default(3),
  successThreshold: z.number().min(1).default(2),
});

export type CircuitBreakerConfig = z.infer<typeof CircuitBreakerConfigSchema>;

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private successes = 0;
  private halfOpenCalls = 0;
  private nextAttempt: number = 0;
  private config: CircuitBreakerConfig;

  readonly name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = CircuitBreakerConfigSchema.parse(config);
  }

  getState(): CircuitState {
    if (this.state === "open" && Date.now() >= this.nextAttempt) {
      this.state = "half-open";
      this.halfOpenCalls = 0;
      this.successes = 0;
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === "open") {
      throw new JASIMError({
        code: "CIRCUIT_OPEN",
        message: `Circuit breaker "${this.name}" is OPEN. Try again after ${this.nextAttempt - Date.now()}ms`,
        statusCode: 503,
        isRetryable: true,
        context: { circuitName: this.name, state: this.state },
      });
    }

    if (currentState === "half-open") {
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        throw new JASIMError({
          code: "CIRCUIT_HALF_OPEN",
          message: `Circuit breaker "${this.name}" half-open limit reached`,
          statusCode: 503,
          isRetryable: true,
          context: { circuitName: this.name },
        });
      }
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.state = "closed";
        this.failures = 0;
        this.successes = 0;
      }
    } else if (this.state === "closed") {
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  private onFailure(): void {
    this.failures++;

    if (this.state === "half-open") {
      this.state = "open";
      this.nextAttempt = Date.now() + this.config.recoveryTimeoutMs;
      return;
    }

    if (this.failures >= this.config.failureThreshold) {
      this.state = "open";
      this.nextAttempt = Date.now() + this.config.recoveryTimeoutMs;
    }
  }

  getStats(): {
    state: CircuitState;
    failures: number;
    successes: number;
    failureThreshold: number;
  } {
    return {
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
      failureThreshold: this.config.failureThreshold,
    };
  }

  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCalls = 0;
    this.nextAttempt = 0;
  }
}

// ============================================
// CIRCUIT BREAKER REGISTRY
// ============================================

const circuitRegistry = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>,
): CircuitBreaker {
  if (!circuitRegistry.has(name)) {
    circuitRegistry.set(name, new CircuitBreaker(name, config));
  }
  return circuitRegistry.get(name)!;
}

export function resetCircuitBreaker(name: string): void {
  circuitRegistry.get(name)?.reset();
}

export function getAllCircuitStats(): Array<{
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
}> {
  return Array.from(circuitRegistry.entries()).map(([name, cb]) => ({
    name,
    ...cb.getStats(),
  }));
}

// ============================================
// GRACEFUL DEGRADATION
// ============================================

export interface DegradationTier<T> {
  name: string;
  execute: () => Promise<T>;
  isAvailable?: () => Promise<boolean> | boolean;
}

export async function executeWithDegradation<T>(
  tiers: DegradationTier<T>[],
  options?: { logDegradation?: boolean },
): Promise<T> {
  const errors: Array<{ tier: string; error: unknown }> = [];

  for (const tier of tiers) {
    try {
      // Check availability if provided
      if (tier.isAvailable) {
        const available = await tier.isAvailable();
        if (!available) {
          errors.push({ tier: tier.name, error: "Not available" });
          continue;
        }
      }

      return await tier.execute();
    } catch (error) {
      errors.push({ tier: tier.name, error });

      if (options?.logDegradation) {
        console.warn(`[Degradation] Tier "${tier.name}" failed:`,
          error instanceof Error ? error.message : String(error));
      }
      // Continue to next tier
    }
  }

  // All tiers exhausted
  throw new JASIMError({
    code: "INTERNAL_ERROR",
    message: `All degradation tiers exhausted. Attempted: ${errors.map((e) => e.tier).join(" -> ")}`,
    statusCode: 503,
    context: { tierErrors: errors.map((e) => ({ tier: e.tier, error: String(e.error) })) },
  });
}

// ============================================
// ERROR CLASSIFICATION HELPER
// ============================================

export function classifyError(error: unknown): ErrorCode {
  if (error instanceof JASIMError) return error.code;

  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (lower.includes("timeout")) return "AGENT_TIMEOUT";
  if (lower.includes("rate limit") || lower.includes("too many requests")) return "LLM_RATE_LIMITED";
  if (lower.includes("context length") || lower.includes("token")) return "LLM_CONTEXT_EXCEEDED";
  if (lower.includes("not found") || lower.includes("404")) return "AGENT_NOT_FOUND";
  if (lower.includes("invalid") || lower.includes("bad request")) return "VALIDATION_FAILED";
  if (lower.includes("unavailable") || lower.includes("503")) return "LLM_UNAVAILABLE";

  return "UNKNOWN_ERROR";
}

// ============================================
// WRAP ASYNC FUNCTION WITH RETRY
// ============================================

export function withRetry<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  config: Partial<RetryConfig> = {},
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    return retryWithBackoff(() => fn(...args), config);
  };
}

// ============================================
// WRAP ASYNC FUNCTION WITH CIRCUIT BREAKER
// ============================================

export function withCircuitBreaker<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  circuitName: string,
  circuitConfig?: Partial<CircuitBreakerConfig>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs): Promise<TReturn> => {
    const breaker = getCircuitBreaker(circuitName, circuitConfig);
    return breaker.execute(() => fn(...args));
  };
}

// ============================================
// BATCH ERROR HANDLER
// ============================================

export interface BatchResult<T> {
  successful: Array<{ index: number; result: T }>;
  failed: Array<{ index: number; error: JASIMError }>;
  successRate: number;
}

export async function executeBatchWithErrorHandling<T>(
  items: Array<() => Promise<T>>,
  options?: { continueOnError?: boolean; logErrors?: boolean },
): Promise<BatchResult<T>> {
  const results: BatchResult<T> = {
    successful: [],
    failed: [],
    successRate: 0,
  };

  for (let i = 0; i < items.length; i++) {
    try {
      const result = await items[i]();
      results.successful.push({ index: i, result });
    } catch (error) {
      const jasimError = error instanceof JASIMError
        ? error
        : new JASIMError({
            code: classifyError(error),
            message: error instanceof Error ? error.message : String(error),
            cause: error,
          });

      results.failed.push({ index: i, error: jasimError });

      if (options?.logErrors) {
        console.error(`[Batch] Item ${i} failed:`, jasimError.toJSON());
      }

      if (!options?.continueOnError) break;
    }
  }

  results.successRate = items.length > 0
    ? results.successful.length / items.length
    : 0;

  return results;
}
