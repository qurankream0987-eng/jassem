/**
 * LLM Tool Adapter — Real LLM Chat Completion
 *
 * Routes to the JASIM LLM Router for cost-optimized multi-model generation.
 * Supports all models: Groq/Llama, GPT-4o-mini, Gemini, DeepSeek, Claude.
 */

import { getLLMRouter, type LLMRequest } from "../llm-router";
import { ToolError, ERROR_CODES } from "@contracts/errors";
import type { ExecutionContext, ToolResult } from "../tool-runtime";

export interface LLMInputs {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  preferredModel?: string;
  requireJson?: boolean;
}

/**
 * Execute LLM chat completion via the JASIM LLM Router.
 */
export async function executeLLM(
  inputs: LLMInputs,
  _ctx: ExecutionContext
): Promise<ToolResult> {
  const start = Date.now();
  const sideEffects: string[] = ["resource_consumption"];

  try {
    if (!inputs.prompt || typeof inputs.prompt !== "string") {
      throw new ToolError(
        ERROR_CODES.VALIDATION_FAILED,
        "LLM tool requires a 'prompt' string",
        "llm_chat"
      );
    }

    const request: LLMRequest = {
      prompt: inputs.prompt,
      complexity: "normal",
      systemPrompt: inputs.system,
      temperature: inputs.temperature ?? 0.7,
      maxTokens: inputs.maxTokens ?? 2048,
      responseFormat: inputs.responseFormat ?? "text",
      preferredModel: inputs.preferredModel,
      requireJson: inputs.requireJson ?? inputs.responseFormat === "json",
      streaming: false,
    };

    const router = getLLMRouter();
    const response = await router.route(request);

    if (response.error) {
      return {
        success: false,
        output: null,
        error: response.error,
        duration: Date.now() - start,
        sideEffects,
      };
    }

    return {
      success: true,
      output: {
        content: response.text,
        model: response.model,
        tier: response.tier,
        tokensUsed: response.tokensUsed,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        cost: response.cost,
        latency: response.latency,
        confidence: response.confidence,
        wasFallback: response.wasFallback,
      },
      duration: Date.now() - start,
      sideEffects,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: null,
      error: msg,
      duration: Date.now() - start,
      sideEffects,
    };
  }
}
