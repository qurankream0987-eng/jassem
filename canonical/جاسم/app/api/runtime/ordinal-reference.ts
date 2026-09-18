/**
 * JASIM — «الثاني» means the second thing you showed me.
 *
 * ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * Three separate ordinal parsers already existed, each owned by one feature
 * and each with its own vocabulary:
 *
 *   • `research-composition.ts` — الأول…الثامن, but only for research sources.
 *   • `block31/conversation-orchestrator.ts` — الأول…الخامس, for its own flow.
 *   • `jasim-runtime.ts` — the single word «الثاني», and nothing else.
 *
 * So the *generic* reference resolver understood exactly one ordinal. Worse,
 * «قارن الثاني والرابع» contained no cue the generic resolver recognised at
 * all, so it returned `not_requested` — the runtime did not merely fail to
 * resolve the reference, it never noticed one had been made.
 *
 * This module is the one vocabulary. It knows nothing about sources, results,
 * offers, drivers or products: it reads positions out of a sentence. What a
 * position points *at* is the caller's business, and stays so.
 *
 * ─── ORDER IS POSITION, NOT RANK ────────────────────────────────────────────
 *
 * The old line resolved «الثاني» by indexing a list sorted by semantic score.
 * That is a different sentence: a person who says "the second" means the one
 * that appeared second, and a runtime that answers with its own second-best
 * guess has quietly substituted its opinion for their instruction. Positions
 * here are 1-based positions in the order something was presented, and a
 * caller that has no presented order has no ordinal to resolve.
 *
 * ─── OUT OF RANGE IS NOT A NEAREST MATCH ────────────────────────────────────
 *
 * «الخامس» against a list of three is unresolved, never the third. Clamping
 * would turn a question the runtime cannot answer into a confident wrong one,
 * which is the whole failure this codebase exists to refuse.
 */

/** A position a person named, in the form they named it. */
export type OrdinalReference =
  /** «الثاني», «the second», «رقم ٣» — counted from the start, 1-based. */
  | { readonly kind: "POSITION"; readonly position: number }
  /** «الأخير» (back 0), «الذي قبله» (back 1) — counted from the end. */
  | { readonly kind: "FROM_END"; readonly back: number };

/** The most positions one utterance may name. Beyond this it is not a reference. */
const MAX_REFERENCES = 8;

/** The largest position that can be written in words or digits. */
const MAX_POSITION = 20;

/**
 * Arabic letters have no `\b`, so word edges are asserted against letters
 * directly. Without this «أول» matches inside «الأولوية» and «first» inside
 * «firstly».
 *
 * The optional letter is the other half. Arabic attaches its conjunctions and
 * prepositions — و، ف، ب، ل، ك — straight onto the next word, so «قارن الثاني
 * والرابع» contains «والرابع», not « الرابع». A lookbehind that demands a
 * non-letter reads the fourth item as absent, which is precisely the sentence
 * this module exists to understand. The proclitic is consumed rather than
 * asserted so the match still begins at a word edge.
 */
const EDGE_BEFORE = "(?<![\\p{L}\\p{N}])[\u0648\u0641\u0628\u0644\u0643]?";
const EDGE_AFTER = "(?![\\p{L}])";

/**
 * Arabic ordinals, masculine and feminine, with or without the article and in
 * both hamza spellings. Longest alternatives come first so «الثالثة» is not
 * consumed as «الثالث» with a stray ة left behind.
 */
const ARABIC_ORDINALS: ReadonlyArray<readonly [string, number]> = [
  ["(?:ال)?[أا]ول(?:ى|ة)?", 1],
  ["(?:ال)?ثاني(?:ة)?", 2],
  ["(?:ال)?ثالث(?:ة)?", 3],
  ["(?:ال)?رابع(?:ة)?", 4],
  ["(?:ال)?خامس(?:ة)?", 5],
  ["(?:ال)?سادس(?:ة)?", 6],
  ["(?:ال)?سابع(?:ة)?", 7],
  ["(?:ال)?ثامن(?:ة)?", 8],
  ["(?:ال)?تاسع(?:ة)?", 9],
  ["(?:ال)?عاشر(?:ة)?", 10],
];

const ENGLISH_ORDINALS: ReadonlyArray<readonly [string, number]> = [
  ["first|1st", 1],
  ["second|2nd", 2],
  ["third|3rd", 3],
  ["fourth|4th", 4],
  ["fifth|5th", 5],
  ["sixth|6th", 6],
  ["seventh|7th", 7],
  ["eighth|8th", 8],
  ["ninth|9th", 9],
  ["tenth|10th", 10],
];

/**
 * «الأخير» and «الذي قبله».
 *
 * «السابق» is deliberately absent. It already means "the previous thing" to
 * the recency path in the reference resolver, and redefining a word that is
 * live in another mechanism would change answers nobody asked to change.
 * «الذي قبله» — "the one before it" — carries the same meaning without the
 * collision, and is what a person says when they mean a position.
 */
const FROM_END_PATTERNS: ReadonlyArray<readonly [string, number]> = [
  // Before the last. Listed first: it contains «الأخير» and must win.
  ["(?:ما\\s*)?قبل\\s*(?:ال)?[أا]خير(?:ة)?|(?:ال|ما\\s*)?(?:ذي|تي)\\s*قبل(?:ه|ها)|second\\s*to\\s*last|next\\s*to\\s*last|penultimate", 1],
  ["(?:ال)?[أا]خير(?:ة)?|\\blast\\b|\\bfinal\\b", 0],
];

/** Arabic-Indic digits, so «رقم ٣» reads the same as «رقم 3». */
function westernDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/gu, (digit) => {
    const code = digit.codePointAt(0)!;
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

type Token = {
  readonly index: number;
  readonly end: number;
  readonly reference: OrdinalReference;
};

/**
 * Longer phrases are collected first and claim their span, so a shorter
 * pattern inside one is never read as a second reference.
 *
 * «ما قبل الأخير» contains «الأخير»; «second to last» contains both «second»
 * and «last». Without this the parser answers "the one before the last, and
 * also the last" — two references where the person made one, and one of them
 * is the item they explicitly ruled out.
 */
function overlaps(token: { index: number; end: number }, taken: readonly Token[]): boolean {
  return taken.some((other) => token.index < other.end && other.index < token.end);
}

function collect(
  text: string,
  source: ReadonlyArray<readonly [string, number]>,
  build: (value: number) => OrdinalReference,
  into: Token[],
): void {
  for (const [body, value] of source) {
    const pattern = new RegExp(`${EDGE_BEFORE}(?:${body})${EDGE_AFTER}`, "giu");
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const span = { index, end: index + match[0].length };
      if (overlaps(span, into)) continue;
      into.push({ ...span, reference: build(value) });
    }
  }
}

/**
 * Every position an utterance names, in the order it names them.
 *
 * Order matters: «قارن الثاني والرابع» must stay [2, 4] rather than becoming a
 * set, because a caller comparing two things is entitled to the pairing the
 * person wrote. Duplicates collapse — «الثاني ثم الثاني» is one position.
 */
export function parseOrdinalReferences(text: string): readonly OrdinalReference[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const normalized = westernDigits(text);
  const tokens: Token[] = [];

  // "From the end" first, because its phrases contain the plain ordinals —
  // see `overlaps`. Collection order is precedence order.
  collect(normalized, FROM_END_PATTERNS, (back) => ({ kind: "FROM_END", back }), tokens);
  collect(normalized, ARABIC_ORDINALS, (position) => ({ kind: "POSITION", position }), tokens);
  collect(normalized, ENGLISH_ORDINALS, (position) => ({ kind: "POSITION", position }), tokens);

  // Explicit numbers, but only when a person marked them as a position.
  // A bare "3" in «أريد 3 نتائج» is a quantity, and reading it as a position
  // would invent a reference out of arithmetic.
  for (const match of normalized.matchAll(
    /(?:رقم|العنصر|البند|position|ordinal|item|no\.?|#)\s*(\d{1,2})/giu,
  )) {
    const position = Number(match[1]);
    if (!Number.isInteger(position) || position < 1 || position > MAX_POSITION) continue;
    const index = match.index ?? 0;
    const span = { index, end: index + match[0].length };
    if (overlaps(span, tokens)) continue;
    tokens.push({ ...span, reference: { kind: "POSITION", position } });
  }

  tokens.sort((left, right) => left.index - right.index);

  const seen = new Set<string>();
  const ordered: OrdinalReference[] = [];
  for (const token of tokens) {
    const key =
      token.reference.kind === "POSITION"
        ? `p${token.reference.position}`
        : `e${token.reference.back}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(token.reference);
    if (ordered.length === MAX_REFERENCES) break;
  }
  return ordered;
}

/** Whether an utterance names any position at all. */
export function hasOrdinalReference(text: string): boolean {
  return parseOrdinalReferences(text).length > 0;
}

/**
 * A cue fragment callers can fold into their own "is this a reference?" test.
 *
 * Exported as source rather than as a compiled RegExp so a caller can compose
 * it into a larger alternation. It is deliberately looser than the parser —
 * its job is to decide whether parsing is worth doing, and the parser decides
 * what is actually there.
 */
export const ORDINAL_CUE_SOURCE =
  "(?:ال)?(?:[أا]ول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|[أا]خير)" +
  "|قبل\\s*(?:ال)?[أا]خير|(?:ذي|تي)\\s*قبل(?:ه|ها)" +
  "|\\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final|penultimate)\\b" +
  "|\\b\\d{1,2}(?:st|nd|rd|th)\\b" +
  "|(?:رقم|العنصر|البند|position|ordinal|item)\\s*[\\d\\u0660-\\u0669\\u06F0-\\u06F9]";

export type OrdinalResolution =
  /** The utterance named no position. */
  | { readonly status: "NONE" }
  /** Every named position exists. 1-based, in the order they were named. */
  | { readonly status: "RESOLVED"; readonly positions: readonly number[] }
  /** At least one named position does not exist. Nothing is returned. */
  | {
      readonly status: "OUT_OF_RANGE";
      readonly requested: readonly number[];
      readonly available: number;
    };

/**
 * Turn named positions into positions in a list of known length.
 *
 * All-or-nothing on purpose. «قارن الثاني والخامس» against a list of three is
 * not a request to compare the second with something: answering with the part
 * that happened to fit would silently drop half of what was asked, and the
 * person would have no way to see that it had been dropped.
 */
export function resolveOrdinalPositions(
  references: readonly OrdinalReference[],
  listLength: number,
): OrdinalResolution {
  if (references.length === 0) return { status: "NONE" };

  const requested = references.map((reference) =>
    reference.kind === "POSITION" ? reference.position : listLength - reference.back,
  );

  const available = Number.isInteger(listLength) && listLength > 0 ? listLength : 0;
  const missing = requested.some((position) => position < 1 || position > available);
  if (missing) return { status: "OUT_OF_RANGE", requested, available };

  return { status: "RESOLVED", positions: requested };
}

/** What to say when a named position does not exist. Arabic, and specific. */
export function outOfRangeClarification(resolution: {
  requested: readonly number[];
  available: number;
}): string {
  if (resolution.available === 0) {
    return "لا توجد قائمة معروضة لأرجع إليها بهذا الترتيب.";
  }
  const named = resolution.requested.join("، ");
  return `طلبت الموضع ${named}، والقائمة المعروضة تحتوي على ${resolution.available} عنصراً فقط.`;
}
