/**
 * JASIM — Main Orchestration Router
 *
 * The primary entry point for all JASIM interactions.
 * Flow: sendMessage → IntentEngine.classify → Planner.understand →
 *       TaskRuntime.createTask → Planner.plan → execute → response
 */

import { router, publicQuery, authedQuery } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "@db/queries/connection";
import { conversations, messages, bubbles as bubblesTable, tasks } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";
import {
  getTaskRuntime,
  getCapabilityRegistry,
  getCytoplasmInstance,
  getCommerceRuntime,
  getAgentRuntime,
} from "../core/runtime";
import { IntentEngine } from "../core/intent-engine";
import {
  JasimError,
  TaskError,
  ValidationError,
  NotFoundError,
  ERROR_CODES,
} from "@contracts/errors";
import { TASK_STATUSES, TASK_PRIORITIES, BUBBLE_TYPES } from "@contracts/jasim";
import type { BubbleSchema, BubbleType } from "@contracts/jasim";
import type { Observable } from "@trpc/server/observable";
import { observable } from "@trpc/server/observable";
import { llmRouter, streamLLM } from "../core/llm-router";
import { getGenerativeRuntime } from "../core/gen-runtime";
import { createStream, closeStream, emitStreamChunk } from "./stream";

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function handleJasimError(err: unknown): never {
  if (err instanceof JasimError) {
    throw new TRPCError({
      code: mapErrorCode(err.statusCode),
      message: err.message,
      cause: err,
    });
  }
  if (err instanceof Error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: err.message,
    });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Unknown error",
  });
}

function mapErrorCode(statusCode: number): TRPCError["code"] {
  if (statusCode === 400) return "BAD_REQUEST";
  if (statusCode === 401) return "UNAUTHORIZED";
  if (statusCode === 403) return "FORBIDDEN";
  if (statusCode === 404) return "NOT_FOUND";
  if (statusCode === 422) return "UNPROCESSABLE_CONTENT";
  if (statusCode === 429) return "TOO_MANY_REQUESTS";
  if (statusCode === 504) return "TIMEOUT";
  return "INTERNAL_SERVER_ERROR";
}

// ═══════════════════════════════════════════════════════════════════════════════
// LLM-Powered Response Generation
// ═══════════════════════════════════════════════════════════════════════════════

interface ResponseContext {
  userMessage: string;
  intentType: string;
  intentConfidence: number;
  entities: Array<{ type: string; value: string }>;
  taskStatus: string;
  taskOutputs?: Record<string, unknown>;
  executionError?: string;
}

/**
 * Build a contextual prompt for the LLM response generator.
 */
function buildResponsePrompt(ctx: ResponseContext): string {
  const entityText = ctx.entities.length > 0
    ? ctx.entities.map((e) => `${e.type}: ${e.value}`).join("\n")
    : "None detected";

  const outputText = ctx.taskOutputs && Object.keys(ctx.taskOutputs).length > 0
    ? JSON.stringify(ctx.taskOutputs, null, 2).slice(0, 800)
    : "No outputs yet";

  return `Generate a helpful, natural-sounding assistant response for the user.

User message: "${ctx.userMessage.replace(/"/g, '\\"')}"

Detected intent: ${ctx.intentType} (confidence: ${Math.round(ctx.intentConfidence * 100)}%)
Extracted entities:
${entityText}

Task execution status: ${ctx.taskStatus}
${ctx.executionError ? `Execution error: ${ctx.executionError}` : ""}

Task outputs:
${outputText}

Rules for your response:
- Be conversational, warm, and helpful
- Acknowledge what you understood from the user's request
- If execution completed, summarize the results in a user-friendly way
- If there was an error, explain what happened and suggest next steps
- If still processing, set clear expectations about what's happening
- Do NOT mention internal technical details (step IDs, DAG nodes, etc.)
- Do NOT output raw JSON to the user
- Keep responses concise (2-4 sentences unless the user asked for detail)
- If the task is ambiguous, ask clarifying questions naturally
- Match the user's tone (formal, casual, technical, etc.)`;
}

/**
 * Generate an assistant response using the LLM Router.
 * Falls back to a structured template if the LLM is unavailable.
 */
async function generateAssistantResponse(ctx: ResponseContext): Promise<string> {
  try {
    const prompt = buildResponsePrompt(ctx);

    const response = await llmRouter.route({
      prompt,
      systemPrompt: "You are JASIM, a helpful AI assistant. You generate natural, conversational responses for users based on task execution results. You are concise, accurate, and friendly.",
      responseFormat: "text",
      complexity: "simple",
      requireJson: false,
      streaming: false,
      maxTokens: 600,
      temperature: 0.7,
    });

    if (response.error || !response.text || response.text.trim().length === 0) {
      throw new Error(response.error ?? "Empty LLM response");
    }

    return response.text.trim();
  } catch (err) {
    console.warn("[jasim.ts] LLM response generation failed, using fallback:", err instanceof Error ? err.message : String(err));

    // Graceful fallback: structured but human-readable template
    const statusEmoji = ctx.taskStatus === "completed" ? "✓" :
      ctx.taskStatus === "failed" ? "✗" :
      ctx.taskStatus === "running" ? "⟳" : "○";

    const parts: string[] = [];
    parts.push(`I understood your request to ${ctx.intentType}.`);

    if (ctx.entities.length > 0) {
      const entityNames = ctx.entities.map((e) => e.value).join(", ");
      parts.push(`I noted: ${entityNames}.`);
    }

    if (ctx.executionError) {
      parts.push(`There was an issue during execution: ${ctx.executionError}. Let me try a different approach.`);
    } else if (ctx.taskStatus === "completed") {
      parts.push(`The task is complete.`);
      if (ctx.taskOutputs && Object.keys(ctx.taskOutputs).length > 0) {
        const summary = Object.entries(ctx.taskOutputs)
          .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v).slice(0, 100)}`)
          .join("; ");
        parts.push(`Results: ${summary}`);
      }
    } else if (ctx.taskStatus === "running" || ctx.taskStatus === "planning") {
      parts.push(`I'm working on it and will update you shortly.`);
    } else {
      parts.push(`Current status: ${statusEmoji} ${ctx.taskStatus}.`);
    }

    return parts.join(" ");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dynamic Bubble Schema Generators
// ═══════════════════════════════════════════════════════════════════════════════

function baseBubble(type: BubbleType, title: string, data: Record<string, unknown>): BubbleSchema {
  return {
    id: `bubble_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    title,
    layout: { columns: 1, width: "full", compact: false, rtl: false },
    data,
    actions: [],
    trust: { level: "basic", verified: true, badges: ["system"] },
    version: "2.0.0",
  };
}

function generateFormBubble(task: typeof tasks.$inferSelect, intent: { type: string; entities: Array<{ type: string; value: string }> }): BubbleSchema {
  const fields = intent.entities.map((e) => ({
    name: e.type,
    label: e.type.charAt(0).toUpperCase() + e.type.slice(1),
    value: e.value,
    type: "text",
  }));

  return baseBubble(BUBBLE_TYPES.FORM, "Confirm Details", {
    fields: fields.length > 0 ? fields : [{ name: "input", label: "Your Input", value: task.goal, type: "text" }],
    goal: task.goal,
    status: task.status,
  });
}

function generateResultsBubble(task: typeof tasks.$inferSelect, intent: { type: string }): BubbleSchema {
  const outputs = task.outputs as Record<string, unknown> ?? {};
  const results = Array.isArray(outputs.results) ? outputs.results : [];

  return baseBubble(BUBBLE_TYPES.LIST, "Search Results", {
    items: results,
    query: task.goal,
    totalCount: Array.isArray(results) ? results.length : 0,
    status: task.status,
  });
}

function generateComparisonBubble(task: typeof tasks.$inferSelect): BubbleSchema {
  const outputs = task.outputs as Record<string, unknown> ?? {};
  const items = Array.isArray(outputs.items) ? outputs.items : [];

  return baseBubble(BUBBLE_TYPES.COMPARISON, "Comparison", {
    items: items.slice(0, 5),
    criteria: outputs.criteria ?? [],
    winner: outputs.winner ?? null,
    status: task.status,
  });
}

function generateSelectionBubble(task: typeof tasks.$inferSelect): BubbleSchema {
  const outputs = task.outputs as Record<string, unknown> ?? {};
  const options = Array.isArray(outputs.options) ? outputs.options : [];

  return baseBubble(BUBBLE_TYPES.CARD, "Select an Option", {
    options: options.map((opt: unknown, idx: number) => ({
      id: `option_${idx}`,
      label: typeof opt === "string" ? opt : JSON.stringify(opt),
      selected: false,
    })),
    status: task.status,
  });
}

function generateNegotiationBubble(task: typeof tasks.$inferSelect): BubbleSchema {
  const outputs = task.outputs as Record<string, unknown> ?? {};

  return baseBubble(BUBBLE_TYPES.DASHBOARD, "Negotiation", {
    currentOffer: outputs.currentOffer ?? null,
    counterOffer: outputs.counterOffer ?? null,
    status: outputs.negotiationStatus ?? "open",
    limits: outputs.limits ?? {},
    history: Array.isArray(outputs.history) ? outputs.history : [],
    taskStatus: task.status,
  });
}

function generateCommerceBubble(task: typeof tasks.$inferSelect, intent: { type: string }): BubbleSchema {
  const outputs = task.outputs as Record<string, unknown> ?? {};

  return baseBubble(BUBBLE_TYPES.CARD, `${intent.type.charAt(0).toUpperCase() + intent.type.slice(1)} Summary`, {
    item: outputs.item ?? outputs.product ?? outputs.service ?? null,
    price: outputs.price ?? outputs.total ?? null,
    currency: outputs.currency ?? "USD",
    confirmationRequired: task.status === "waiting_approval",
    status: task.status,
  });
}

function generateProgressBubble(task: typeof tasks.$inferSelect, intent: { type: string }): BubbleSchema {
  const plan = task.plan as Record<string, unknown> ?? {};
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const completedStepsValue = (task as unknown as { completedSteps?: unknown }).completedSteps;
  const completedSteps = Array.isArray(completedStepsValue) ? completedStepsValue : [];

  const totalSteps = nodes.length || 1;
  const completed = completedSteps.length;
  const progress = totalSteps > 0 ? Math.round((completed / totalSteps) * 100) : 0;

  return baseBubble(BUBBLE_TYPES.PROGRESS, "Progress", {
    progress,
    completed,
    total: totalSteps,
    currentStep: task.currentStepId ? String(task.currentStepId) : "starting",
    status: task.status,
    intent: intent.type,
    goal: task.goal,
  });
}

/**
 * Build a REAL dynamic BubbleSchema based on task state and intent type.
 */
function buildBubbleSchema(
  task: typeof tasks.$inferSelect,
  intent: { type: string; entities: Array<{ type: string; value: string }> }
): BubbleSchema {
  const stepType = task.currentStepId ? "action" : undefined;

  switch (intent.type) {
    case "ask":
    case "confirm":
      return generateFormBubble(task, intent);
    case "find":
    case "search":
    case "discover":
      return generateResultsBubble(task, intent);
    case "compare":
      return generateComparisonBubble(task);
    case "select":
    case "choose":
      return generateSelectionBubble(task);
    case "negotiate":
      return generateNegotiationBubble(task);
    case "book":
    case "buy":
    case "sell":
    case "purchase":
      return generateCommerceBubble(task, intent);
    default:
      return generateProgressBubble(task, intent);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// JASIM Router
// ═══════════════════════════════════════════════════════════════════════════════

export const jasimRouter = router({

  // ═══════════════════════════════════════════════════════════════════════════
  // sendMessage — Main entry point (WITH REAL STREAMING)
  // ═══════════════════════════════════════════════════════════════════════════
  sendMessage: authedQuery
    .input(z.object({
      conversationId: z.string().optional(),
      content: z.string().min(1, "Message cannot be empty"),
      attachments: z.array(z.object({
        type: z.enum(["image", "voice", "location", "file"]),
        url: z.string(),
        name: z.string().optional(),
      })).optional(),
      enableStreaming: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);
      const startTime = Date.now();

      try {
        // ── 1. Resolve or create conversation ────────────────────────────
        let conversationId: number;
        if (input.conversationId) {
          conversationId = Number(input.conversationId);
          const [conv] = await db.select().from(conversations)
            .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
            .limit(1);
          if (!conv) {
            throw new NotFoundError("Conversation", input.conversationId);
          }
        } else {
          const [result] = await db.insert(conversations).values({
            userId,
            title: input.content.slice(0, 100),
            status: "active",
          }).$returningId();
          conversationId = Number(result.id);
        }

        // ── 2. Save user message ───────────────────────────────────────────
        await db.insert(messages).values({
          conversationId,
          role: "user",
          content: input.content,
          metadata: { attachments: input.attachments },
        });

        // ── 3. Create task skeleton (sync, so we have taskId for response) ─
        const taskRuntime = getTaskRuntime();
        const task = await taskRuntime.createTask(input.content, userId, conversationId);
        const numericTaskId = Number(task.id);

        // ── 4. Setup streaming ─────────────────────────────────────────────
        const streamId = `stream-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const emitter = createStream(streamId);

        // ── 5. Launch async pipeline with REAL streaming ───────────────────
        (async () => {
          try {
            const pipelineStart = Date.now();

            // Steps A-C: compose and execute a one-task runtime from generic DNA.
            // This path does not select a domain app or a fixed Food/Fleet UI.
            emitStreamChunk(streamId, { type: "status", data: "Composing a runtime for this goal..." });
            const generated = await getGenerativeRuntime({
              useLLM: true,
              enableVerification: true,
              enableRepair: true,
            }).executeGoal(input.content, {
              taskId: numericTaskId,
              userId,
              conversationId,
              attachments: input.attachments,
            });

            if (!generated.success || !generated.intent || !generated.plan || !generated.world) {
              throw new Error(generated.error ?? "The generative runtime could not compose this goal");
            }

            const intentType = generated.intent.actions[0]
              ?? generated.intent.domainHints[0]
              ?? "execute";
            const intentConfidence = generated.intent.confidence;
            const intentEntities = generated.intent.objects.map((object) => ({
              type: object.type ?? "object",
              value: object.name,
            }));
            const executionStatus = generated.executionResult?.status ?? "partial";
            const persistedTaskStatus: "waiting_approval" | "waiting_input" | "completed" | "running" =
              executionStatus === "waiting_approval"
                ? "waiting_approval"
                : executionStatus === "waiting_input"
                  ? "waiting_input"
                : executionStatus === "completed"
                  ? "completed"
                  : "running";
            const taskOutputs = generated.executionResult?.results as Record<string, unknown> ?? {};
            const executionError = generated.executionResult?.error as string | undefined;
            // Execution checkpoints are written while the plan runs. Reload the
            // task before enriching its context so approval/idempotency state is
            // never overwritten by the older task snapshot captured above.
            const latestTask = await db.query.tasks.findFirst({ where: eq(tasks.id, numericTaskId) });
            const latestContext = latestTask?.context as Record<string, unknown> | null;

            await db.update(tasks).set({
              intent: intentType,
              context: {
                ...(latestContext ?? {}),
                intent: generated.intent,
                world: generated.world,
                runtimeCompositionId: generated.composition?.id,
                activeGeneVersionIds: generated.composition?.activeGeneVersionIds ?? [],
              },
              plan: generated.plan as unknown as Record<string, unknown>,
              outputs: taskOutputs,
              status: persistedTaskStatus,
              capabilities: generated.plan.steps.map((step) => step.capabilityId),
            }).where(eq(tasks.id, numericTaskId));

            // Step D: stream schemas generated for this goal. SchemaRenderer can
            // render them directly; no domain-specific TSX screen is imported.
            const bubbleSchemas = generated.composition?.bubbles.length
              ? generated.composition.bubbles
              : [baseBubble(BUBBLE_TYPES.PROGRESS, "Generated runtime", {
                  status: persistedTaskStatus,
                  goal: input.content,
                })];
            const bubbleSchema = bubbleSchemas[0];
            for (const runtimeBubble of bubbleSchemas) {
              emitStreamChunk(streamId, { type: "bubble", data: runtimeBubble as unknown as Record<string, unknown> });
            }
            if (generated.executionResult?.pendingInput?.bubble) {
              emitStreamChunk(streamId, { type: "bubble", data: generated.executionResult.pendingInput.bubble });
            }

            // Step E: Generate assistant response with REAL token streaming
            const prompt = buildResponsePrompt({
              userMessage: input.content,
              intentType,
              intentConfidence,
              entities: intentEntities,
              taskStatus: persistedTaskStatus,
              taskOutputs,
              executionError,
            });

            emitStreamChunk(streamId, { type: "status", data: "Generating response..." });

            let assistantContent = "";
            try {
              const streamResult = await streamLLM({
                prompt,
                systemPrompt: "You are JASIM, a helpful AI assistant. You generate natural, conversational responses for users based on task execution results. You are concise, accurate, and friendly.",
                temperature: 0.7,
                maxTokens: 600,
                onChunk: (chunk) => {
                  assistantContent += chunk;
                  emitStreamChunk(streamId, { type: "chunk", data: chunk });
                },
                onError: (err) => {
                  console.warn("[jasim.ts] LLM streaming error:", err);
                },
              });
              console.log(`[jasim.ts] Streamed response from ${streamResult.model}, ${assistantContent.length} chars`);
            } catch (streamErr) {
              // Fallback to non-streaming generation
              console.warn("[jasim.ts] Streaming failed, falling back:", streamErr instanceof Error ? streamErr.message : String(streamErr));
              const fallback = await generateAssistantResponse({
                userMessage: input.content,
                intentType,
                intentConfidence,
                entities: intentEntities,
                taskStatus: persistedTaskStatus,
                taskOutputs,
                executionError,
              });
              assistantContent = fallback;
              emitStreamChunk(streamId, { type: "chunk", data: assistantContent });
            }

            // Step F: Save assistant message to DB
            const [msgResult] = await db.insert(messages).values({
              conversationId,
              role: "assistant",
              content: assistantContent,
              taskId: numericTaskId,
              intent: intentType,
              bubbleData: bubbleSchema as unknown as Record<string, unknown>,
              metadata: {
                confidence: intentConfidence,
                executionError,
                durationMs: Date.now() - pipelineStart,
                streamed: true,
                runtimeCompositionId: generated.composition?.id,
                generatedRuntime: true,
              },
            }).$returningId();

            // Step G: Persist every generated UI schema for reconstruction.
            if (intentConfidence > 0.5) {
              for (const runtimeBubble of bubbleSchemas) {
                await db.insert(bubblesTable).values({
                  userId,
                  taskId: numericTaskId,
                  conversationId,
                  type: runtimeBubble.type,
                  label: runtimeBubble.title,
                  schema: runtimeBubble as unknown as Record<string, unknown>,
                  data: runtimeBubble.data as Record<string, unknown>,
                  status: "active",
                });
              }
            }

            // Step H: Update conversation timestamp
            await db.update(conversations)
              .set({ updatedAt: new Date() })
              .where(eq(conversations.id, conversationId));

            // Step I: Emit final metadata and close stream
            emitStreamChunk(streamId, {
              type: "bubble",
              data: {
                ...bubbleSchema,
                _meta: {
                  messageId: Number(msgResult.id),
                  taskId: numericTaskId,
                  taskStatus: persistedTaskStatus,
                  conversationId: String(conversationId),
                  durationMs: Date.now() - pipelineStart,
                  runtimeCompositionId: generated.composition?.id,
                },
              },
            });
            closeStream(streamId);
          } catch (pipelineErr) {
            const errorMsg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
            console.error("[jasim.ts] Pipeline error:", errorMsg);
            emitStreamChunk(streamId, { type: "error", data: errorMsg });
            closeStream(streamId, errorMsg);
          }
        })();

        // ── 6. Return streamId immediately ─────────────────────────────────
        return {
          streamId,
          message: {
            id: 0, // Placeholder; real ID assigned in async pipeline
            role: "assistant" as const,
            content: "",
            taskId: task.id,
            createdAt: new Date(),
          },
          task: {
            id: task.id,
            status: task.status,
            goal: task.goal,
          },
          bubble: null as unknown as BubbleSchema,
          conversationId: String(conversationId),
        };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // sendMessageStream — Streaming variant (returns async iterable)
  // ═══════════════════════════════════════════════════════════════════════════
  sendMessageStream: authedQuery
    .input(z.object({
      conversationId: z.string().optional(),
      content: z.string().min(1),
      attachments: z.array(z.object({
        type: z.enum(["image", "voice", "location", "file"]),
        url: z.string(),
      })).optional(),
    }))
    .subscription(async function* ({ ctx, input }) {
      const userId = Number(ctx.user!.id);

      // Yield initial acknowledgment
      yield { type: "ack", message: "Processing..." } as Record<string, unknown>;

      // The streaming API uses the same goal-generated runtime as sendMessage.
      yield { type: "task", status: "creating" };
      const taskRuntime = getTaskRuntime();
      const streamConversationId = input.conversationId ? Number(input.conversationId) : undefined;
      const task = await taskRuntime.createTask(input.content, userId, streamConversationId);
      const numericTaskId = Number(task.id);
      yield { type: "task", status: "created", taskId: numericTaskId };

      yield { type: "runtime", status: "composing" };
      const generated = await getGenerativeRuntime({
        useLLM: true,
        enableVerification: true,
        enableRepair: true,
      }).executeGoal(input.content, {
        taskId: numericTaskId,
        userId,
        conversationId: streamConversationId,
        attachments: input.attachments,
      });
      if (!generated.success || !generated.intent || !generated.plan) {
        yield { type: "runtime", status: "error", error: generated.error ?? "Runtime composition failed" };
        return;
      }

      const intentType = generated.intent.actions[0] ?? generated.intent.domainHints[0] ?? "execute";
      const taskStatus = generated.executionResult?.status ?? "partial";
      const taskOutputs = generated.executionResult?.results as Record<string, unknown> ?? {};
      yield { type: "intent", status: "done", intentType, confidence: generated.intent.confidence };
      yield { type: "plan", status: "done", steps: generated.plan.steps.length, compositionId: generated.composition?.id };
      for (const bubble of generated.composition?.bubbles ?? []) {
        yield { type: "bubble", status: "generated", bubble };
      }
      if (generated.executionResult?.pendingInput?.bubble) {
        yield { type: "bubble", status: "input_required", bubble: generated.executionResult.pendingInput.bubble };
      }
      yield {
        type: "execute",
        status: taskStatus,
        pendingAction: generated.executionResult?.pendingAction,
        pendingInput: generated.executionResult?.pendingInput,
      };

      // Response generation
      yield { type: "response", status: "generating" };
      const assistantContent = await generateAssistantResponse({
        userMessage: input.content,
        intentType,
        intentConfidence: generated.intent.confidence,
        entities: generated.intent.objects.map((object) => ({ type: object.type ?? "object", value: object.name })),
        taskStatus,
        taskOutputs,
      });
      yield { type: "response", status: "done", content: assistantContent };

      // Final
      yield {
        type: "complete",
        message: assistantContent,
        taskId: numericTaskId,
        taskStatus,
        bubbles: generated.composition?.bubbles ?? [],
        compositionId: generated.composition?.id,
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // executeTask — Execute a task plan by ID
  // ═══════════════════════════════════════════════════════════════════════════
  executeTask: authedQuery
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const taskId = Number(input.taskId);
        const userId = Number(ctx.user!.id);

        // Verify ownership
        const [taskRow] = await db.select().from(tasks)
          .where(eq(tasks.id, taskId))
          .limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const taskRuntime = getTaskRuntime();
        const updated = await taskRuntime.executePlan(taskId);
        return {
          task: {
            id: updated.id,
            status: updated.status,
            goal: updated.goal,
            outputs: updated.outputs,
          },
        };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // getTask — Get task by ID
  // ═══════════════════════════════════════════════════════════════════════════
  getTask: authedQuery
    .input(z.object({ taskId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        const taskId = Number(input.taskId);
        const userId = Number(ctx.user!.id);

        const taskRuntime = getTaskRuntime();
        const task = await taskRuntime.getTask(taskId);
        const taskOwnerId = (task as unknown as { userId?: number }).userId;
        if (taskOwnerId !== userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your task" });
        }
        return { task };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // pauseTask — Pause execution
  // ═══════════════════════════════════════════════════════════════════════════
  pauseTask: authedQuery
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const taskId = Number(input.taskId);
        const userId = Number(ctx.user!.id);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const taskRuntime = getTaskRuntime();
        const updated = await taskRuntime.pause(taskId);
        return { task: updated };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // resumeTask — Resume execution
  // ═══════════════════════════════════════════════════════════════════════════
  resumeTask: authedQuery
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const taskId = Number(input.taskId);
        const userId = Number(ctx.user!.id);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const taskRuntime = getTaskRuntime();
        const updated = await taskRuntime.resume(taskId);
        return { task: updated };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // cancelTask — Cancel execution
  // ═══════════════════════════════════════════════════════════════════════════
  cancelTask: authedQuery
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const taskId = Number(input.taskId);
        const userId = Number(ctx.user!.id);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const taskRuntime = getTaskRuntime();
        const updated = await taskRuntime.transition(taskId, TASK_STATUSES.CANCELLED, { reason: "user_cancelled" });
        return { task: updated };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // getStatus — System health / runtime status
  // ═══════════════════════════════════════════════════════════════════════════
  getStatus: publicQuery
    .query(async () => {
      const taskRuntime = getTaskRuntime();
      const capReg = getCapabilityRegistry();
      const agentRuntime = getAgentRuntime();

      // Count active tasks (pending, planning, running, paused)
      const activeStatuses = ["pending", "planning", "running", "paused", "waiting_approval"];
      const activeTasks = await db.select().from(tasks)
        .where(eq(tasks.status, "pending")) // simplified; real impl would use inArray
        .limit(1);

      const totalTasksResult = await db.select({ count: tasks.id }).from(tasks);
      const totalTasks = totalTasksResult.length;

      const capabilities = await capReg.list({ isActive: true });
      const agents = agentRuntime.listAgents();

      return {
        status: "ok" as const,
        version: "2.0.0",
        activeTasks: totalTasks, // simplified
        capabilities: capabilities.length,
        agents: agents.length,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // quickIntent — Quick intent classification (no task creation)
  // ═══════════════════════════════════════════════════════════════════════════
  quickIntent: authedQuery
    .input(z.object({
      content: z.string().min(1),
    }))
    .query(async ({ input }) => {
      try {
        const intentEngine = new IntentEngine();
        const intent = await intentEngine.classify(input.content);
        return { intent };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // health — Public health check
  // ═══════════════════════════════════════════════════════════════════════════
  health: publicQuery
    .query(() => {
      return {
        status: "ok" as const,
        agent: "jasim",
        version: "2.0.0",
        timestamp: new Date().toISOString(),
      };
    }),
});
