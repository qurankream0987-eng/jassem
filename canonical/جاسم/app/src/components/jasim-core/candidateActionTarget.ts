/**
 * WHICH CANONICAL THING A CARD'S CONTROL ACTS ON.
 *
 * ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * A press arrives as the string `"<intent>:<reference>"`, and the workspace was
 * sending its OWN target with it — the conversation, or the active run. So even
 * once a candidate declared an intent, the action would have been aimed at
 * whatever the workspace happened to be about, not at the thing on the card.
 *
 * ─── REFERENCE, NEVER POSITION ──────────────────────────────────────────────
 *
 *   CARD_POSITION_IS_ACTION_AUTHORITY = 0
 *
 * The reference in the press is matched against the candidates in the CANONICAL
 * PROJECTION — not against the DOM, not against an array index, and not against
 * a title. Reordering the surface cannot change what a control acts on, and two
 * cards that look identical act on their own references because the reference
 * is what is matched.
 *
 * ─── AND THE VERSION IS THE THING'S OWN ─────────────────────────────────────
 *
 *   STALE_CARD_ACTION_EXECUTES = 0
 *
 * The canonical kind and version come from the candidate's own `provenance`,
 * which the runtime wrote when it normalized the candidate. A card drawn
 * against version 3 of an offering, pressed after its holder republished at
 * version 4, carries `expression:3` while the runtime holds `expression:4` —
 * and the dispatcher refuses it before any route runs.
 *
 * ─── AND IT KNOWS NOTHING ABOUT WHAT ANYTHING IS ────────────────────────────
 *
 *   DOMAIN NOUN != ACTION MAPPING
 *
 * The kind is read from `provenance.canonicalKind`, a value the runtime
 * supplied. Nothing here reads a semantic type, a title or a summary, and there
 * is no list of kinds to extend when a new one appears.
 */

export type CandidateActionTarget = {
  reference: { kind: string; id: string };
  expectedPresentationVersion: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `select:expr_1` → `expr_1`. A press with no reference targets nothing. */
export function referenceFromPress(intent: string): string | null {
  const separator = intent.indexOf(':');
  if (separator < 0) return null;
  const reference = intent.slice(separator + 1).trim();
  return reference || null;
}

export function candidateActionTarget(
  presentation: unknown,
  intent: string,
): CandidateActionTarget | null {
  const reference = referenceFromPress(intent);
  if (!reference) return null;
  const data = record(record(presentation)?.data);
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

  // Matched by reference against canonical state. A press naming something the
  // current surface does not carry resolves to nothing rather than to the
  // nearest thing — a surface the person is not looking at is not a target.
  const candidate = candidates
    .map(record)
    .find((entry) => entry && (entry.ref === reference || entry.id === reference));
  if (!candidate) return null;

  const provenance = record(candidate.provenance);
  const kind = typeof provenance?.canonicalKind === 'string' ? provenance.canonicalKind : null;
  const version = provenance?.version;
  if (!kind || (typeof version !== 'string' && typeof version !== 'number')) return null;

  // `<kind>:<version>`, formed identically here and in the dispatcher's own
  // reference resolution, so neither side carries a table of the other's
  // spellings and a new canonical kind needs no edit on either.
  return {
    reference: { kind, id: reference },
    expectedPresentationVersion: `${kind}:${version}`,
  };
}
