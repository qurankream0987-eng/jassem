/**
 * Vision Tool Adapter — Real Image Analysis via LLM Vision
 *
 * Uses Gemini 2.0 Flash (multimodal capable) to analyze images.
 * Accepts image URLs, base64 data URIs, or local file paths.
 * Returns structured analysis with descriptions, objects, text, and labels.
 */

import { ToolError, ERROR_CODES } from "@contracts/errors";
import type { ExecutionContext, ToolResult } from "../tool-runtime";

export interface VisionInputs {
  image: string; // URL, base64 data URI, or local path
  prompt?: string; // Analysis instruction
  detail?: "low" | "high" | "auto";
  responseFormat?: "text" | "json";
}

export interface VisionOutput {
  description: string;
  objects: string[];
  textInImage?: string;
  labels: string[];
  confidence: number;
  model: string;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash-lite";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const VISION_TIMEOUT = 30000;

/**
 * Execute vision analysis on an image.
 */
export async function executeVision(
  inputs: VisionInputs,
  _ctx: ExecutionContext
): Promise<ToolResult> {
  const start = Date.now();
  const sideEffects: string[] = ["external_communication", "resource_consumption"];

  try {
    const imageSource = inputs.image;
    if (!imageSource) {
      throw new ToolError(
        ERROR_CODES.VALIDATION_FAILED,
        "Vision tool requires an 'image' field (URL, base64, or path)",
        "vision_analyze"
      );
    }

    // Resolve image data
    const imageData = await resolveImage(imageSource);

    // Build prompt
    const analysisPrompt = inputs.prompt ||
      "Describe this image in detail. List any visible objects, text, and provide a brief summary.";

    // Call Gemini vision API
    const result = await callGeminiVision(imageData, analysisPrompt, inputs.detail ?? "auto");

    return {
      success: true,
      output: result,
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

// ─────────────────────────────────────────────────────────────────────────────
// Image Resolution
// ─────────────────────────────────────────────────────────────────────────────

async function resolveImage(source: string): Promise<{ mimeType: string; data: string }> {
  // Base64 data URI
  if (source.startsWith("data:")) {
    const match = source.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
    throw new Error("Invalid base64 data URI format");
  }

  // HTTP(S) URL — fetch and convert to base64
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT);

    try {
      const res = await fetch(source, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Failed to fetch image: HTTP ${res.status}`);
      }

      const blob = await res.arrayBuffer();
      const contentType = res.headers.get("content-type") || "image/jpeg";
      const base64 = Buffer.from(blob).toString("base64");
      return { mimeType: contentType, data: base64 };
    } catch {
      clearTimeout(timer);
      throw new Error("Failed to fetch image from URL");
    }
  }

  // Local file path — read and encode
  try {
    const { readFile } = await import("fs/promises");
    const { resolve } = await import("path");
    const buf = await readFile(resolve(source));
    const ext = source.split(".").pop()?.toLowerCase() || "jpeg";
    const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { mimeType, data: buf.toString("base64") };
  } catch {
    throw new Error(`Failed to read local image: ${source}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini Vision API
// ─────────────────────────────────────────────────────────────────────────────

async function callGeminiVision(
  image: { mimeType: string; data: string },
  prompt: string,
  _detail: string
): Promise<VisionOutput> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured for vision analysis");
  }

  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Vision HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const candidates = (data.candidates as Array<Record<string, unknown>>) || [];
    const content = (candidates[0]?.content as Record<string, unknown>) || {};
    const parts = (content.parts as Array<Record<string, unknown>>) || [];
    const text = (parts[0]?.text as string) || "";
    const usage = (data.usageMetadata as Record<string, number>) || {};

    // Parse structured output from the response
    const parsed = parseVisionResponse(text);

    return {
      description: parsed.description || text,
      objects: parsed.objects || [],
      textInImage: parsed.textInImage,
      labels: parsed.labels || [],
      confidence: 0.9,
      model: GEMINI_MODEL,
    };
  } catch {
    clearTimeout(timer);
    throw new Error("Gemini Vision API call failed");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Response Parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseVisionResponse(text: string): Partial<VisionOutput> {
  const result: Partial<VisionOutput> = {};

  // Try to extract structured sections
  const descriptionMatch = text.match(/(?:Description|Summary):\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
  if (descriptionMatch) {
    result.description = descriptionMatch[1].trim();
  } else {
    result.description = text.slice(0, 500);
  }

  const objectsMatch = text.match(/(?:Objects?|Items?):\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
  if (objectsMatch) {
    result.objects = objectsMatch[1]
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const textMatch = text.match(/(?:Text|OCR):\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
  if (textMatch) {
    result.textInImage = textMatch[1].trim();
  }

  const labelsMatch = text.match(/(?:Labels?|Tags?):\s*([^]*?)(?=\n\n|\n[A-Z]|$)/i);
  if (labelsMatch) {
    result.labels = labelsMatch[1]
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return result;
}
