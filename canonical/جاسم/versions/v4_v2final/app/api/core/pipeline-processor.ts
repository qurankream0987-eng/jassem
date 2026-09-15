/**
 * ============================================================
 * PIPELINE PROCESSOR — Pipeline Pattern (2026)
 * JASIM Sequential Stage Processing Engine
 * ============================================================
 *
 * Implements:
 * - Sequential stage processing
 * - Each stage's output feeds next stage's input
 * - Stage failure handling with retry
 * - Parallel execution within stages where possible
 * - Zod schemas for all stage inputs/outputs
 */

import { z } from "zod";
import {
  JASIMError,
  retryWithBackoff,
  executeBatchWithErrorHandling,
  withRetry,
} from "./error-handler";

// ============================================
// ZOD SCHEMAS
// ============================================

export const PipelineStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  // The processor function takes input and returns output
  processor: z.function()
    .args(z.record(z.string(), z.unknown()))
    .returns(z.promise(z.record(z.string(), z.unknown())))
    .optional(),
  // Optional batch processor for parallel processing within stage
  batchProcessor: z.function()
    .args(z.array(z.record(z.string(), z.unknown())))
    .returns(z.promise(z.array(z.record(z.string(), z.unknown()))))
    .optional(),
  // Configuration
  maxRetries: z.number().min(0).max(10).default(2),
  timeoutMs: z.number().min(100).default(30000),
  // Dependencies: which stage outputs this stage needs
  dependencies: z.array(z.string()).default([]),
  // Whether this stage supports parallel item processing
  supportsParallelItems: z.boolean().default(false),
  maxParallelItems: z.number().min(1).default(5),
  // Skip conditions
  skipIf: z.function()
    .args(z.record(z.string(), z.unknown()))
    .returns(z.boolean().or(z.promise(z.boolean())))
    .optional(),
  // Transform output before passing to next stage
  transformOutput: z.function()
    .args(z.record(z.string(), z.unknown()))
    .returns(z.record(z.string(), z.unknown()).or(z.promise(z.record(z.string(), z.unknown()))))
    .optional(),
  // Validate stage output
  validateOutput: z.function()
    .args(z.record(z.string(), z.unknown()))
    .returns(z.boolean().or(z.promise(z.boolean())))
    .optional(),
});

export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const PipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  stages: z.array(PipelineStageSchema).min(1),
  // Global config
  maxRetries: z.number().default(2),
  enableCheckpointing: z.boolean().default(true),
  continueOnStageFailure: z.boolean().default(false),
  // Timeout for entire pipeline
  globalTimeoutMs: z.number().min(1000).default(120000),
  // Hooks
  onStageComplete: z.function()
    .args(z.string(), z.record(z.string(), z.unknown()))
    .returns(z.void().or(z.promise(z.void())))
    .optional(),
  onPipelineComplete: z.function()
    .args(z.record(z.string(), z.unknown()))
    .returns(z.void().or(z.promise(z.void())))
    .optional(),
  onError: z.function()
    .args(z.string(), z.instanceof(JASIMError))
    .returns(z.void())
    .optional(),
});

export type Pipeline = z.infer<typeof PipelineSchema>;

export const StageResultSchema = z.object({
  stageId: z.string(),
  stageName: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "skipped", "retrying"]),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).default({}),
  error: z.string().optional(),
  executionTimeMs: z.number().default(0),
  retryCount: z.number().default(0),
  itemsProcessed: z.number().default(0),
  itemsFailed: z.number().default(0),
  skipped: z.boolean().default(false),
});

export type StageResult = z.infer<typeof StageResultSchema>;

export const PipelineResultSchema = z.object({
  pipelineId: z.string(),
  status: z.enum(["completed", "failed", "partial"]),
  stageResults: z.array(StageResultSchema),
  finalOutput: z.record(z.string(), z.unknown()),
  totalExecutionTimeMs: z.number(),
  stagesCompleted: z.number(),
  stagesFailed: z.number(),
  stagesSkipped: z.number(),
  startTime: z.string(),
  endTime: z.string(),
});

export type PipelineResult = z.infer<typeof PipelineResultSchema>;

export const PipelineCheckpointSchema = z.object({
  pipelineId: z.string(),
  stageIndex: z.number(),
  stageOutputs: z.record(z.string(), z.record(z.string(), z.unknown())),
  timestamp: z.string(),
});

export type PipelineCheckpoint = z.infer<typeof PipelineCheckpointSchema>;

// ============================================
// STAGE CONTEXT — Passed between stages
// ============================================

export interface StageContext {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  shared: Record<string, unknown>;
  metadata: {
    pipelineId: string;
    stageIndex: number;
    startTime: number;
    retryCount: number;
  };
}

export const StageContextSchema = z.object({
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
  shared: z.record(z.string(), z.unknown()),
  metadata: z.object({
    pipelineId: z.string(),
    stageIndex: z.number(),
    startTime: z.number(),
    retryCount: z.number(),
  }),
});

// ============================================
// PIPELINE PROCESSOR CLASS
// ============================================

export class PipelineProcessor {
  private checkpoints = new Map<string, PipelineCheckpoint>();
  private stageResults = new Map<string, StageResult[]>();

  /**
   * Execute a pipeline with full stage-by-stage processing
   * Each stage's output feeds as input to the next stage
   */
  async execute(pipeline: Pipeline, initialInput: Record<string, unknown>): Promise<PipelineResult> {
    const validated = PipelineSchema.parse(pipeline);
    const startTime = Date.now();
    const stageResults: StageResult[] = [];
    let currentInput = { ...initialInput };
    let shared: Record<string, unknown> = { ...initialInput, _pipelineId: validated.id };

    // Global timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new JASIMError({
          code: "AGENT_TIMEOUT",
          message: `Pipeline "${validated.name}" exceeded global timeout of ${validated.globalTimeoutMs}ms`,
          context: { pipelineId: validated.id },
        }));
      }, validated.globalTimeoutMs);
    });

    try {
      const execution = this.runStages(validated, currentInput, shared, stageResults, startTime);
      const result = await Promise.race([execution, timeoutPromise]);
      return result;
    } catch (error) {
      // Handle timeout or other errors
      const isTimeout = error instanceof JASIMError && error.code === "AGENT_TIMEOUT";

      return {
        pipelineId: validated.id,
        status: isTimeout ? "partial" : "failed",
        stageResults,
        finalOutput: currentInput,
        totalExecutionTimeMs: Date.now() - startTime,
        stagesCompleted: stageResults.filter((r) => r.status === "completed").length,
        stagesFailed: stageResults.filter((r) => r.status === "failed").length,
        stagesSkipped: stageResults.filter((r) => r.status === "skipped").length,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date().toISOString(),
      };
    }
  }

  private async runStages(
    pipeline: Pipeline,
    initialInput: Record<string, unknown>,
    shared: Record<string, unknown>,
    stageResults: StageResult[],
    pipelineStartTime: number,
  ): Promise<PipelineResult> {
    let currentInput = initialInput;

    for (let i = 0; i < pipeline.stages.length; i++) {
      const stage = pipeline.stages[i];
      const stageStartTime = Date.now();

      // Restore checkpoint if available
      if (pipeline.enableCheckpointing) {
        const checkpoint = this.checkpoints.get(`${pipeline.id}_${stage.id}`);
        if (checkpoint) {
          currentInput = checkpoint.stageOutputs[stage.id] || currentInput;
          continue; // Skip this stage
        }
      }

      // Check skip condition
      if (stage.skipIf) {
        try {
          const shouldSkip = await stage.skipIf(currentInput);
          if (shouldSkip) {
            const skippedResult: StageResult = {
              stageId: stage.id,
              stageName: stage.name,
              status: "skipped",
              input: currentInput,
              output: currentInput,
              executionTimeMs: 0,
              skipped: true,
            };
            stageResults.push(skippedResult);

            if (pipeline.onStageComplete) {
              await pipeline.onStageComplete(stage.id, { skipped: true });
            }
            continue;
          }
        } catch { /* Continue with normal execution */ }
      }

      // Build stage context
      const context: StageContext = {
        input: currentInput,
        output: {},
        shared,
        metadata: {
          pipelineId: pipeline.id,
          stageIndex: i,
          startTime: stageStartTime,
          retryCount: 0,
        },
      };

      try {
        let stageOutput: Record<string, unknown>;

        // Execute stage with retry
        if (stage.processor) {
          stageOutput = await retryWithBackoff(
            () => this.executeStageProcessor(stage, context),
            {
              maxRetries: stage.maxRetries,
              onRetry: (attempt, error) => {
                context.metadata.retryCount = attempt;
                if (pipeline.onError) {
                  pipeline.onError(stage.id, error as JASIMError);
                }
              },
            },
          );
        } else if (stage.batchProcessor && Array.isArray(currentInput._items)) {
          stageOutput = await this.executeBatchProcessor(stage, context);
        } else {
          // Pass-through stage (no processor)
          stageOutput = { ...currentInput };
        }

        // Validate output if validator provided
        if (stage.validateOutput) {
          const isValid = await stage.validateOutput(stageOutput);
          if (!isValid) {
            throw new JASIMError({
              code: "VALIDATION_FAILED",
              message: `Stage "${stage.name}" output validation failed`,
              context: { stageId: stage.id, output: stageOutput },
            });
          }
        }

        // Transform output if transformer provided
        if (stage.transformOutput) {
          stageOutput = await stage.transformOutput(stageOutput);
        }

        const executionTimeMs = Date.now() - stageStartTime;

        const result: StageResult = {
          stageId: stage.id,
          stageName: stage.name,
          status: "completed",
          input: currentInput,
          output: stageOutput,
          executionTimeMs,
          retryCount: context.metadata.retryCount,
          itemsProcessed: Array.isArray(stageOutput._items) ? stageOutput._items.length : 1,
        };

        stageResults.push(result);

        // Save checkpoint
        if (pipeline.enableCheckpointing) {
          this.saveCheckpoint(pipeline.id, i, stage.id, stageOutput);
        }

        // Feed output to next stage's input
        currentInput = { ...currentInput, ...stageOutput, _stageOutput: stageOutput };
        shared = { ...shared, [`stage_${stage.id}`]: stageOutput };

        // Call hook
        if (pipeline.onStageComplete) {
          await pipeline.onStageComplete(stage.id, stageOutput);
        }

      } catch (error) {
        const jasimError = error instanceof JASIMError
          ? error
          : new JASIMError({
              code: "PIPELINE_STAGE_FAILED",
              message: error instanceof Error ? error.message : String(error),
              context: { stageId: stage.id, pipelineId: pipeline.id },
              cause: error,
            });

        if (pipeline.onError) {
          pipeline.onError(stage.id, jasimError);
        }

        const failedResult: StageResult = {
          stageId: stage.id,
          stageName: stage.name,
          status: "failed",
          input: currentInput,
          output: {},
          error: jasimError.message,
          executionTimeMs: Date.now() - stageStartTime,
          retryCount: context.metadata.retryCount,
        };

        stageResults.push(failedResult);

        if (!pipeline.continueOnStageFailure) {
          throw jasimError; // Stop pipeline
        }
        // Continue with current input unchanged
      }
    }

    const totalExecutionTimeMs = Date.now() - pipelineStartTime;
    const finalOutput = stageResults.length > 0
      ? stageResults[stageResults.length - 1].output
      : currentInput;

    const result: PipelineResult = {
      pipelineId: pipeline.id,
      status: stageResults.some((r) => r.status === "failed") ? "partial" : "completed",
      stageResults,
      finalOutput,
      totalExecutionTimeMs,
      stagesCompleted: stageResults.filter((r) => r.status === "completed").length,
      stagesFailed: stageResults.filter((r) => r.status === "failed").length,
      stagesSkipped: stageResults.filter((r) => r.status === "skipped").length,
      startTime: new Date(pipelineStartTime).toISOString(),
      endTime: new Date().toISOString(),
    };

    if (pipeline.onPipelineComplete) {
      await pipeline.onPipelineComplete(result.finalOutput);
    }

    return result;
  }

  private async executeStageProcessor(
    stage: PipelineStage,
    context: StageContext,
  ): Promise<Record<string, unknown>> {
    if (!stage.processor) return context.input;

    // Timeout wrapper
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new JASIMError({
          code: "AGENT_TIMEOUT",
          message: `Stage "${stage.name}" timed out after ${stage.timeoutMs}ms`,
          isRetryable: true,
          context: { stageId: stage.id, timeoutMs: stage.timeoutMs },
        }));
      }, stage.timeoutMs);

      stage.processor!(context.input)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Execute batch processor with parallel item processing
   */
  private async executeBatchProcessor(
    stage: PipelineStage,
    context: StageContext,
  ): Promise<Record<string, unknown>> {
    if (!stage.batchProcessor || !Array.isArray(context.input._items)) {
      return context.input;
    }

    const items = context.input._items as Array<Record<string, unknown>>;

    if (!stage.supportsParallelItems) {
      // Sequential batch processing
      const result = await stage.batchProcessor(items);
      return { ...context.input, _items: result };
    }

    // Parallel batch processing
    const chunks = this.chunkArray(items, stage.maxParallelItems);
    const allResults: Array<Record<string, unknown>> = [];

    for (const chunk of chunks) {
      const chunkResults = await executeBatchWithErrorHandling(
        chunk.map((item) => () =>
          stage.batchProcessor!([item]).then((r) => r[0]),
        ),
        { continueOnError: true },
      );

      allResults.push(...chunkResults.successful.map((s) => s.result));
    }

    return { ...context.input, _items: allResults };
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  private saveCheckpoint(
    pipelineId: string,
    stageIndex: number,
    stageId: string,
    output: Record<string, unknown>,
  ): void {
    const checkpoint: PipelineCheckpoint = {
      pipelineId,
      stageIndex,
      stageOutputs: { [stageId]: output },
      timestamp: new Date().toISOString(),
    };

    const existing = this.checkpoints.get(pipelineId);
    if (existing) {
      existing.stageOutputs[stageId] = output;
      existing.stageIndex = stageIndex;
      existing.timestamp = checkpoint.timestamp;
    } else {
      this.checkpoints.set(pipelineId, checkpoint);
    }

    // Also store in-memory stage results
    const existingResults = this.stageResults.get(pipelineId) || [];
    this.stageResults.set(pipelineId, [...existingResults]);
  }

  // ============================================
  // PUBLIC: Checkpoint management
  // ============================================

  getCheckpoint(pipelineId: string): PipelineCheckpoint | undefined {
    return this.checkpoints.get(pipelineId);
  }

  clearCheckpoint(pipelineId: string): void {
    this.checkpoints.delete(pipelineId);
    this.stageResults.delete(pipelineId);
  }

  listCheckpoints(): Array<{ pipelineId: string; stageIndex: number; timestamp: string }> {
    return Array.from(this.checkpoints.entries()).map(([id, cp]) => ({
      pipelineId: id,
      stageIndex: cp.stageIndex,
      timestamp: cp.timestamp,
    }));
  }

  // ============================================
  // PUBLIC: Pre-built pipeline templates
  // ============================================

  /**
   * Create a standard request processing pipeline
   */
  createRequestPipeline(pipelineId: string): Pipeline {
    return {
      id: pipelineId,
      name: "Request Processing Pipeline",
      description: "Standard pipeline for processing user requests",
      stages: [
        {
          id: "validate",
          name: "Input Validation",
          description: "Validate and sanitize user input",
          maxRetries: 0,
          timeoutMs: 2000,
        },
        {
          id: "intent",
          name: "Intent Detection",
          description: "Detect user intent using NLP",
          dependencies: ["validate"],
          maxRetries: 2,
          timeoutMs: 5000,
        },
        {
          id: "context",
          name: "Context Building",
          description: "Build conversation context",
          dependencies: ["intent"],
          maxRetries: 1,
          timeoutMs: 3000,
        },
        {
          id: "route",
          name: "Agent Routing",
          description: "Route to appropriate agent",
          dependencies: ["context"],
          maxRetries: 2,
          timeoutMs: 2000,
        },
        {
          id: "execute",
          name: "Agent Execution",
          description: "Execute agent logic",
          dependencies: ["route"],
          maxRetries: 3,
          timeoutMs: 15000,
        },
        {
          id: "synthesize",
          name: "Response Synthesis",
          description: "Synthesize final response",
          dependencies: ["execute"],
          maxRetries: 1,
          timeoutMs: 5000,
        },
      ],
      globalTimeoutMs: 60000,
      continueOnStageFailure: false,
      enableCheckpointing: true,
    };
  }

  /**
   * Create a data processing pipeline (parallel where possible)
   */
  createDataPipeline(pipelineId: string): Pipeline {
    return {
      id: pipelineId,
      name: "Data Processing Pipeline",
      description: "Pipeline for processing data with parallel stages",
      stages: [
        {
          id: "fetch",
          name: "Data Fetch",
          description: "Fetch raw data from sources",
          maxRetries: 2,
          timeoutMs: 10000,
          supportsParallelItems: true,
          maxParallelItems: 10,
        },
        {
          id: "clean",
          name: "Data Cleaning",
          description: "Clean and normalize data",
          dependencies: ["fetch"],
          maxRetries: 1,
          timeoutMs: 5000,
        },
        {
          id: "transform",
          name: "Data Transformation",
          description: "Transform data into required format",
          dependencies: ["clean"],
          maxRetries: 1,
          timeoutMs: 8000,
          supportsParallelItems: true,
          maxParallelItems: 5,
        },
        {
          id: "analyze",
          name: "Data Analysis",
          description: "Analyze transformed data",
          dependencies: ["transform"],
          maxRetries: 2,
          timeoutMs: 15000,
        },
        {
          id: "output",
          name: "Output Generation",
          description: "Generate final output",
          dependencies: ["analyze"],
          maxRetries: 1,
          timeoutMs: 3000,
        },
      ],
      globalTimeoutMs: 120000,
      continueOnStageFailure: true,
      enableCheckpointing: true,
    };
  }

  /**
   * Create an AI inference pipeline (with model selection)
   */
  createInferencePipeline(pipelineId: string): Pipeline {
    return {
      id: pipelineId,
      name: "AI Inference Pipeline",
      description: "Pipeline for AI model inference with fallback",
      stages: [
        {
          id: "classify",
          name: "Complexity Classification",
          description: "Classify request complexity",
          maxRetries: 1,
          timeoutMs: 1000,
        },
        {
          id: "select_model",
          name: "Model Selection",
          description: "Select appropriate AI model",
          dependencies: ["classify"],
          maxRetries: 0,
          timeoutMs: 1000,
        },
        {
          id: "inference",
          name: "Model Inference",
          description: "Run inference with selected model",
          dependencies: ["select_model"],
          maxRetries: 3,
          timeoutMs: 30000,
        },
        {
          id: "validate",
          name: "Output Validation",
          description: "Validate model output",
          dependencies: ["inference"],
          maxRetries: 2,
          timeoutMs: 2000,
        },
        {
          id: "postprocess",
          name: "Post-Processing",
          description: "Format and enhance output",
          dependencies: ["validate"],
          maxRetries: 1,
          timeoutMs: 2000,
        },
      ],
      globalTimeoutMs: 60000,
      continueOnStageFailure: false,
      enableCheckpointing: true,
    };
  }
}

// ============================================
// STAGE BUILDER HELPER
// ============================================

export class StageBuilder {
  private stage: Partial<PipelineStage> = { dependencies: [] };

  id(id: string): this {
    this.stage.id = id;
    return this;
  }

  name(name: string): this {
    this.stage.name = name;
    return this;
  }

  description(description: string): this {
    this.stage.description = description;
    return this;
  }

  processor(fn: (input: Record<string, unknown>) => Promise<Record<string, unknown>>): this {
    this.stage.processor = fn;
    return this;
  }

  batchProcessor(fn: (items: Array<Record<string, unknown>>) => Promise<Array<Record<string, unknown>>>): this {
    this.stage.batchProcessor = fn;
    return this;
  }

  retries(count: number): this {
    this.stage.maxRetries = count;
    return this;
  }

  timeout(ms: number): this {
    this.stage.timeoutMs = ms;
    return this;
  }

  dependsOn(...stageIds: string[]): this {
    this.stage.dependencies = stageIds;
    return this;
  }

  parallelItems(max: number): this {
    this.stage.supportsParallelItems = true;
    this.stage.maxParallelItems = max;
    return this;
  }

  skipIf(fn: (input: Record<string, unknown>) => boolean | Promise<boolean>): this {
    this.stage.skipIf = fn;
    return this;
  }

  validate(fn: (output: Record<string, unknown>) => boolean | Promise<boolean>): this {
    this.stage.validateOutput = fn;
    return this;
  }

  transform(fn: (output: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>): this {
    this.stage.transformOutput = fn;
    return this;
  }

  build(): PipelineStage {
    if (!this.stage.id || !this.stage.name || !this.stage.description) {
      throw new JASIMError({
        code: "VALIDATION_FAILED",
        message: "Stage must have id, name, and description",
      });
    }
    return PipelineStageSchema.parse(this.stage);
  }
}

// ============================================
// PIPELINE BUILDER HELPER
// ============================================

export class PipelineBuilder {
  private pipeline: Partial<Pipeline> = { stages: [] };
  private stageBuilders: StageBuilder[] = [];

  id(id: string): this {
    this.pipeline.id = id;
    return this;
  }

  name(name: string): this {
    this.pipeline.name = name;
    return this;
  }

  description(description: string): this {
    this.pipeline.description = description;
    return this;
  }

  addStage(stage: PipelineStage): this {
    this.pipeline.stages = [...(this.pipeline.stages || []), stage];
    return this;
  }

  addStageFrom(builder: StageBuilder): this {
    this.stageBuilders.push(builder);
    return this;
  }

  globalTimeout(ms: number): this {
    this.pipeline.globalTimeoutMs = ms;
    return this;
  }

  continueOnFailure(enabled: boolean): this {
    this.pipeline.continueOnStageFailure = enabled;
    return this;
  }

  checkpointing(enabled: boolean): this {
    this.pipeline.enableCheckpointing = enabled;
    return this;
  }

  onStageComplete(fn: (stageId: string, output: Record<string, unknown>) => void | Promise<void>): this {
    this.pipeline.onStageComplete = fn;
    return this;
  }

  onPipelineComplete(fn: (output: Record<string, unknown>) => void | Promise<void>): this {
    this.pipeline.onPipelineComplete = fn;
    return this;
  }

  onError(fn: (stageId: string, error: JASIMError) => void): this {
    this.pipeline.onError = fn;
    return this;
  }

  build(): Pipeline {
    // Build any staged stages
    for (const builder of this.stageBuilders) {
      this.pipeline.stages = [...(this.pipeline.stages || []), builder.build()];
    }

    if (!this.pipeline.id || !this.pipeline.name || !this.pipeline.description) {
      throw new JASIMError({
        code: "VALIDATION_FAILED",
        message: "Pipeline must have id, name, and description",
      });
    }

    if (!this.pipeline.stages || this.pipeline.stages.length === 0) {
      throw new JASIMError({
        code: "VALIDATION_FAILED",
        message: "Pipeline must have at least one stage",
      });
    }

    return PipelineSchema.parse(this.pipeline);
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const pipelineProcessor = new PipelineProcessor();
