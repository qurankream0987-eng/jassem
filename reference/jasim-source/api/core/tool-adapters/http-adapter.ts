/**
 * HTTP Tool Adapter — Generic HTTP Request Tool
 *
 * Makes real HTTP requests with configurable method, headers, auth,
 * timeout, and retry logic. Supports GET, POST, PUT, DELETE, PATCH.
 */

import { ToolError, ERROR_CODES, retryWithBackoff } from "@contracts/errors";
import type { ExecutionContext, ToolResult } from "../tool-runtime";

export interface HttpInputs {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  params?: Record<string, string>;
  timeout?: number;
  retries?: number;
  auth?: {
    type: "bearer" | "basic" | "apiKey";
    token?: string;
    username?: string;
    password?: string;
    keyName?: string;
    keyValue?: string;
    keyIn?: "header" | "query";
  };
  responseType?: "json" | "text" | "binary";
}

export interface HttpOutput {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  url: string;
  duration: number;
  size: number;
}

const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Execute a generic HTTP request.
 */
export async function executeHttpRequest(
  inputs: HttpInputs,
  _ctx: ExecutionContext
): Promise<ToolResult> {
  const start = Date.now();
  const sideEffects: string[] = ["external_communication"];

  try {
    // Validate URL
    if (!inputs.url) {
      throw new ToolError(
        ERROR_CODES.VALIDATION_FAILED,
        "HTTP tool requires a 'url' field",
        "http_request"
      );
    }

    let url: URL;
    try {
      url = new URL(inputs.url);
    } catch {
      throw new ToolError(
        ERROR_CODES.VALIDATION_FAILED,
        `Invalid URL: ${inputs.url}`,
        "http_request"
      );
    }

    // Security: block internal/private IP ranges
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("172.16.") ||
      hostname.startsWith("172.17.") ||
      hostname.startsWith("172.18.") ||
      hostname.startsWith("172.19.") ||
      hostname.startsWith("172.2") ||
      hostname.startsWith("172.30.") ||
      hostname.startsWith("172.31.") ||
      hostname.startsWith("169.254.")
    ) {
      throw new ToolError(
        ERROR_CODES.TOOL_UNAUTHORIZED,
        `Access to internal addresses is blocked: ${hostname}`,
        "http_request"
      );
    }

    // Build query params
    if (inputs.params) {
      for (const [key, value] of Object.entries(inputs.params)) {
        url.searchParams.set(key, value);
      }
    }

    // Build headers
    const headers = new Headers();
    headers.set("Accept", "application/json, text/plain, */*");
    headers.set("User-Agent", "JASIM-HTTP-Tool/1.0");

    if (inputs.headers) {
      for (const [key, value] of Object.entries(inputs.headers)) {
        headers.set(key, value);
      }
    }

    // Apply authentication
    if (inputs.auth) {
      applyAuth(headers, url, inputs.auth);
    }

    // Build body
    let body: string | undefined;
    if (inputs.body) {
      if (typeof inputs.body === "string") {
        body = inputs.body;
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "text/plain");
        }
      } else {
        body = JSON.stringify(inputs.body);
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
      }
    }

    const method = inputs.method || "GET";
    const timeout = Math.min(inputs.timeout ?? DEFAULT_TIMEOUT, 120000);
    const retries = Math.min(inputs.retries ?? MAX_RETRIES, 5);

    // Execute with retry
    const response = await executeWithRetry(
      () => fetchWithTimeout(url.toString(), { method, headers, body }, timeout),
      retries
    );

    const duration = Date.now() - start;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Parse response body
    const responseType = inputs.responseType || detectResponseType(responseHeaders);
    const bodyText = await response.text();
    const size = bodyText.length;

    if (size > MAX_BODY_SIZE) {
      throw new ToolError(
        ERROR_CODES.TOOL_INVOCATION_FAILED,
        `Response body exceeds ${MAX_BODY_SIZE} bytes`,
        "http_request"
      );
    }

    let parsedBody: unknown = bodyText;
    if (responseType === "json" && bodyText.trim()) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        // Leave as text if not valid JSON
      }
    }

    const output: HttpOutput = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: parsedBody,
      url: response.url,
      duration,
      size,
    };

    const success = response.status >= 200 && response.status < 300;

    return {
      success,
      output,
      error: success ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      duration,
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
// Fetch with Timeout
// ─────────────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: { method: string; headers: Headers; body?: string },
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry Logic
// ─────────────────────────────────────────────────────────────────────────────

async function executeWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on client errors (4xx except 429)
      if (err instanceof Response) {
        const status = (err as Response).status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw lastError;
        }
      }

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error("All retry attempts failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication
// ─────────────────────────────────────────────────────────────────────────────

function applyAuth(
  headers: Headers,
  url: URL,
  auth: HttpInputs["auth"]
): void {
  if (!auth) return;

  switch (auth.type) {
    case "bearer":
      if (auth.token) {
        headers.set("Authorization", `Bearer ${auth.token}`);
      }
      break;
    case "basic":
      if (auth.username && auth.password) {
        const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
        headers.set("Authorization", `Basic ${encoded}`);
      }
      break;
    case "apiKey":
      if (auth.keyName && auth.keyValue) {
        if (auth.keyIn === "query") {
          url.searchParams.set(auth.keyName, auth.keyValue);
        } else {
          headers.set(auth.keyName, auth.keyValue);
        }
      }
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Response Type Detection
// ─────────────────────────────────────────────────────────────────────────────

function detectResponseType(headers: Record<string, string>): "json" | "text" | "binary" {
  const contentType = (headers["content-type"] || "").toLowerCase();
  if (contentType.includes("application/json")) return "json";
  if (contentType.includes("text/")) return "text";
  if (contentType.includes("image/") || contentType.includes("application/octet-stream")) return "binary";
  return "text";
}
