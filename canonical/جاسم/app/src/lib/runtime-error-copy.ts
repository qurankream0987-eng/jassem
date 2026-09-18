import { RUNTIME_STATE_COPY, runtimeStateCopy } from "./runtime-state-copy";

/**
 * Turns a thrown runtime error into something a person should read.
 *
 * FOUND BY LOOKING AT THE RUNNING PRODUCT. A turn with no model provider
 * configured put this into the conversation, verbatim:
 *
 *   "No model service is configured. Configure JASIM_MODEL_PROVIDER with its
 *    provider API key before creating a task."
 *
 * English, addressed to an operator, and naming an environment variable to
 * somebody who will never set one. UI-1 built the Arabic vocabulary for exactly
 * these states; nothing routed this path through it.
 *
 * MATCHING IS ON CODES, NOT PROSE. The runtime's normalized categories —
 * `MODEL_GATEWAY_UNAVAILABLE`, `BLOCKED_BY_PROVIDER`, `MODEL_BUDGET_EXCEEDED` —
 * travel in the error's `code`, or inside a tRPC message. Matching those is
 * stable; matching English sentences would break the first time one is reworded.
 *
 * AN UNRECOGNISED ERROR GETS A HONEST SENTENCE, NOT A GUESS. It says something
 * went wrong and that nothing was saved — both of which are true of every
 * failed turn — and it does not invent a cause. The raw text is not discarded;
 * it goes to the console for whoever is debugging, where an environment
 * variable name belongs.
 */

const CODE_PATTERN = /\b(MODEL_[A-Z_]+|PROVIDER_[A-Z_]+|BLOCKED_BY_[A-Z_]+|REQUIRES_[A-Z_]+|INSUFFICIENT_[A-Z_]+|MISSING_GENERIC_CAPABILITY|INCONCLUSIVE|STALE|UNAVAILABLE)\b/;

/** Sentences the gateway emits when nothing is configured at all. */
const NOT_CONFIGURED =
  /no model service is configured|is not configured|requires MODEL_GATEWAY credentials/i;

export function userFacingRuntimeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const code =
    (typeof (error as { code?: unknown })?.code === "string"
      ? String((error as { code: string }).code)
      : undefined) ?? raw.match(CODE_PATTERN)?.[1];

  const known = runtimeStateCopy(code);
  if (known) {
    // Diagnostics stay available to whoever is debugging, and only there.
    if (raw) console.warn("[runtime] %s — %s", code, raw);
    return known.guidance ? `${known.label}. ${known.guidance}` : known.label;
  }

  if (NOT_CONFIGURED.test(raw)) {
    const fallback = RUNTIME_STATE_COPY.MODEL_GATEWAY_UNAVAILABLE!;
    console.warn("[runtime] model provider not configured — %s", raw);
    return `${fallback.label}. ${fallback.guidance}`;
  }

  if (raw) console.warn("[runtime] unrecognised failure — %s", raw);
  return "تعذّر إكمال هذا الطلب. لم يُحفَظ شيء، ويمكنك إعادة المحاولة.";
}
