/**
 * JASIM — deterministic conversation titles.
 *
 * ─── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────
 *
 * Every conversation was created with the literal string «محادثة جديدة» and
 * nothing ever renamed it, so the sidebar showed fourteen identical rows. A
 * history you cannot tell apart is not a history.
 *
 * ─── WHY THE RUNTIME OWNS THE TITLE ─────────────────────────────────────────
 *
 * The title is derived server-side, once, from the conversation's own first
 * user message. That matters for three reasons:
 *
 *   • Web, iOS and Android are projections of one runtime. A title computed on
 *     a client would differ per device, and two devices disagreeing about what
 *     a conversation is called is the same class of bug as two devices
 *     disagreeing about what happened in it.
 *   • It needs no model, so history stays usable with no provider configured.
 *     A model may improve a title later; it may never be required for one.
 *   • It cannot fabricate. The title is a TRUNCATION of what the user actually
 *     wrote — never a summary, never an inference. «رتب لي…» stays «رتب لي…»,
 *     and nothing is added that the person did not say.
 *
 * ─── NOTHING DOMAIN-SPECIFIC ────────────────────────────────────────────────
 *
 * This file reads characters. It does not know what a driver, an order or a
 * booking is, and a new domain needs no change here.
 */

import { containsCredentialShape } from "./credential-shapes";

/** Maximum characters kept. Long enough to distinguish, short enough for a row. */
const MAX_TITLE_CHARS = 48;

/**
 * The title for a conversation whose first message is credential-shaped.
 *
 * A fixed string, not a redaction of what was written. «محادثة خاصة» carries
 * no fragment of the message, so nothing about the secret survives into the
 * row — not its length, not its prefix, not the fact that a particular
 * provider was named.
 */
export const PRIVATE_TITLE_FALLBACK = "محادثة خاصة";

/** Where a first clause plausibly ends, in either script. */
const CLAUSE_BREAK = /[.!?؟۔\n]|،\s|;\s/u;

/**
 * Characters that carry no meaning in a title: control codes, bidi overrides
 * and zero-width marks. Bidi overrides are stripped specifically because a
 * title is rendered inside a list — a stray override would reorder the row
 * around it.
 */
const INVISIBLE = new RegExp(
  "[\\u0000-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]",
  "gu",
);

/**
 * Derive a title from a message, or return undefined when nothing usable
 * remains.
 *
 * `undefined` is a real answer: an empty message, or one made only of
 * punctuation and emoji, has no title in it, and inventing one would be the
 * fabrication this module exists to avoid.
 */
export function deriveConversationTitle(text: string): string | undefined {
  if (typeof text !== "string") return undefined;

  const cleaned = text.replace(INVISIBLE, " ").replace(/\s+/gu, " ").trim();
  if (!cleaned) return undefined;

  // Before anything is copied out of the message.
  //
  // The whole message is checked, not the clause that would become the title:
  // «مرحبا. كلمة المرور hunter2» has a harmless first clause, and titling it
  // «مرحبا» would be safe but would also mean the check depends on where the
  // person happened to put a full stop. A message carrying a secret anywhere
  // gets the fixed title.
  //
  // This closes the title as a second copy of a pasted credential. It does not
  // stop the credential entering the conversation — see `credential-shapes.ts`.
  if (containsCredentialShape(cleaned)) return PRIVATE_TITLE_FALLBACK;

  // The first clause, when there is one — a title is an opening, not a summary.
  const breakAt = cleaned.search(CLAUSE_BREAK);
  let candidate = breakAt > 0 ? cleaned.slice(0, breakAt).trim() : cleaned;
  if (!candidate) candidate = cleaned;

  // Something must be a letter or a digit. A row reading "!!!" distinguishes
  // nothing, which is the state we are trying to leave.
  if (!/[\p{L}\p{N}]/u.test(candidate)) return undefined;

  const characters = [...candidate];
  if (characters.length <= MAX_TITLE_CHARS) return candidate;

  // Cut on a word boundary when one is near, so a title never ends mid-word.
  const clipped = characters.slice(0, MAX_TITLE_CHARS).join("");
  const lastSpace = clipped.lastIndexOf(" ");
  const trimmed = lastSpace > MAX_TITLE_CHARS * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${trimmed.trimEnd()}…`;
}

/**
 * Whether a stored title should be replaced by a derived one.
 *
 * Only an absent title is replaced. A title a person set — or one already
 * derived — is theirs, and silently rewriting it on the next turn would make
 * the sidebar shift under them.
 */
export function shouldDeriveTitle(current: string | null | undefined): boolean {
  return !current || current.trim().length === 0;
}
