/**
 * JASIM — Context budgeting.
 *
 * A model call can fail in two very different ways when the context is too
 * large. Either the provider rejects it, which costs a round trip and produces a
 * vendor-specific error JASIM would have to guess at, or — worse — the provider
 * silently truncates, answers confidently from half the context, and JASIM has
 * no way to know the answer was formed without the part that mattered.
 *
 * The second failure is the dangerous one, because it is indistinguishable from
 * success. So the size check happens here, before dispatch, and an oversized
 * request is refused with a specific error rather than sent and hoped for.
 *
 * TOKEN COUNTS ARE ESTIMATES, AND SAID TO BE.
 *
 * JASIM does not ship a tokenizer for four provider families whose tokenizers
 * change without notice. `estimateInputTokens` is a heuristic with a stated
 * safety margin, not provider truth, and everything it returns is named
 * `estimated`. The heuristic errs high: under-estimating would let an oversized
 * prompt through, which is precisely the failure this module exists to prevent.
 */

export class ModelContextTooLargeError extends Error {
  readonly code = "MODEL_CONTEXT_TOO_LARGE";
  readonly estimatedInputTokens: number;
  readonly maxInputTokens: number;

  constructor(input: { message: string; estimatedInputTokens: number; maxInputTokens: number }) {
    super(input.message);
    this.name = "ModelContextTooLargeError";
    this.estimatedInputTokens = input.estimatedInputTokens;
    this.maxInputTokens = input.maxInputTokens;
  }
}

/**
 * Absolute ceiling for any single request, independent of what a caller asks
 * for. This is the runaway guard: it bounds a planner that concatenates its own
 * growing history into a prompt. Deployments set it to their smallest deployed
 * context window through `JASIM_MODEL_MAX_INPUT_TOKENS`.
 */
export const DEFAULT_ABSOLUTE_MAX_INPUT_TOKENS = 200_000;

export function configuredAbsoluteMaxInputTokens(): number {
  const raw = process.env.JASIM_MODEL_MAX_INPUT_TOKENS?.trim();
  if (!raw) return DEFAULT_ABSOLUTE_MAX_INPUT_TOKENS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_ABSOLUTE_MAX_INPUT_TOKENS;
}

/**
 * Chars-per-token divisors. Latin script packs roughly four characters into a
 * token in every current BPE vocabulary; Arabic, Hebrew, CJK and emoji pack far
 * fewer, often one or two, and JASIM is an Arabic-first runtime — treating
 * Arabic at the Latin rate would under-count by a factor of two or more on
 * exactly the prompts that matter most here.
 */
const ASCII_CHARS_PER_TOKEN = 4;
const NON_ASCII_CHARS_PER_TOKEN = 2;

/** Per-message framing every chat API adds (role, separators). Deliberately generous. */
const PER_SEGMENT_OVERHEAD_TOKENS = 8;

export function estimateInputTokens(...segments: string[]): number {
  let total = 0;
  for (const segment of segments) {
    let ascii = 0;
    let other = 0;
    for (const char of segment) {
      if (char.codePointAt(0)! < 128) ascii += 1;
      else other += 1;
    }
    total +=
      Math.ceil(ascii / ASCII_CHARS_PER_TOKEN) +
      Math.ceil(other / NON_ASCII_CHARS_PER_TOKEN) +
      PER_SEGMENT_OVERHEAD_TOKENS;
  }
  return total;
}

export type ContextBudgetAssessment = {
  estimatedInputTokens: number;
  /** The ceiling actually applied: the stricter of the declared and absolute limits. */
  effectiveMaxInputTokens: number;
  source: "DECLARED_BUDGET" | "ABSOLUTE_CEILING";
};

/**
 * Throws `ModelContextTooLargeError` when the request cannot honestly be sent.
 *
 * A declared budget narrows the ceiling; it can never widen it past the absolute
 * limit, so a caller cannot opt out of the runaway guard by asking for more.
 */
export function enforceContextBudget(input: {
  segments: string[];
  declaredMaxInputTokens?: number;
  label?: string;
}): ContextBudgetAssessment {
  const absolute = configuredAbsoluteMaxInputTokens();
  const declared = input.declaredMaxInputTokens;
  const effectiveMaxInputTokens =
    declared !== undefined && declared > 0 ? Math.min(declared, absolute) : absolute;
  const source: ContextBudgetAssessment["source"] =
    declared !== undefined && declared > 0 && declared <= absolute
      ? "DECLARED_BUDGET"
      : "ABSOLUTE_CEILING";

  const estimatedInputTokens = estimateInputTokens(...input.segments);
  if (estimatedInputTokens > effectiveMaxInputTokens) {
    throw new ModelContextTooLargeError({
      message:
        `MODEL_CONTEXT_TOO_LARGE: ${input.label ?? "request"} is an estimated ` +
        `${estimatedInputTokens} input tokens, above the ${effectiveMaxInputTokens}-token ` +
        `limit (${source}). The request was not sent, so nothing was truncated silently.`,
      estimatedInputTokens,
      maxInputTokens: effectiveMaxInputTokens,
    });
  }
  return { estimatedInputTokens, effectiveMaxInputTokens, source };
}

// ── Stable reference preservation ───────────────────────────────────────────

/**
 * When context has to be reduced, the parts that carry identity must survive.
 * A summary that drops the reference keys a later turn will be asked to resolve
 * has not compressed the conversation, it has corrupted it: the next
 * "the second one" resolves against nothing, or worse, against the wrong thing.
 *
 * `selectWithinTokenBudget` keeps every pinned segment and then fills the
 * remaining space with the most recent of the rest, newest first. It returns the
 * segments it dropped rather than hiding them, so a caller can say that the
 * context was reduced instead of pretending it was complete.
 */
export type ContextSegment = {
  id: string;
  text: string;
  /** Pinned segments are never dropped. If they alone exceed the budget, this throws. */
  pinned?: boolean;
};

export type ContextSelection = {
  kept: ContextSegment[];
  droppedIds: string[];
  estimatedInputTokens: number;
  reduced: boolean;
};

export function selectWithinTokenBudget(
  segments: ContextSegment[],
  maxInputTokens: number,
): ContextSelection {
  const pinned = segments.filter((segment) => segment.pinned);
  const optional = segments.filter((segment) => !segment.pinned);

  let used = estimateInputTokens(...pinned.map((segment) => segment.text));
  if (used > maxInputTokens) {
    throw new ModelContextTooLargeError({
      message:
        `MODEL_CONTEXT_TOO_LARGE: the segments that must be preserved are an estimated ` +
        `${used} tokens, above the ${maxInputTokens}-token limit. Dropping them would ` +
        `change what the request means, so the request was refused instead.`,
      estimatedInputTokens: used,
      maxInputTokens,
    });
  }

  const keptOptionalIds = new Set<string>();
  for (let index = optional.length - 1; index >= 0; index -= 1) {
    const cost = estimateInputTokens(optional[index]!.text);
    if (used + cost > maxInputTokens) continue;
    used += cost;
    keptOptionalIds.add(optional[index]!.id);
  }

  // Original order is preserved: a conversation reordered by size is a different
  // conversation.
  const kept = segments.filter(
    (segment) => segment.pinned || keptOptionalIds.has(segment.id),
  );
  const droppedIds = segments
    .filter((segment) => !segment.pinned && !keptOptionalIds.has(segment.id))
    .map((segment) => segment.id);

  return {
    kept,
    droppedIds,
    estimatedInputTokens: used,
    reduced: droppedIds.length > 0,
  };
}
