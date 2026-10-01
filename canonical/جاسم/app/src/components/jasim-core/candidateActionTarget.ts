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


/**
 * MAY A CONTROL BE DRAWN FOR THIS SURFACE AT ALL?
 *
 * ─── THE DEAD CONTROL LAW ───────────────────────────────────────────────────
 *
 *   VISIBLE_CONTROL != EXECUTION_PERMISSION
 *
 * A control must be backed by a trusted path, or not be drawn. The one thing
 * it may never be is enabled, inviting, and incapable — which is what a
 * historical grid became once its host handed its surface to something else.
 *
 * So a surface whose action-bearing cards cannot ALL be resolved to a
 * canonical target gets no handler, and the card's own existing condition
 * (`onAction &&`) then draws no buttons. Nothing in the renderer changes, and
 * no half-dead row is possible: it is all of them or none.
 *
 *   MESSAGE_METADATA != EXECUTION_AUTHORITY
 *
 * This decides only whether to DRAW. What may actually happen is decided by
 * the server, which re-reads the thing under this owner and compares its
 * version — so a stored surface somebody tampered with buys nothing here.
 */
export function presentationActionsAreDispatchable(presentation: unknown): boolean {
  const data = record(record(presentation)?.data);
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const withActions = candidates
    .map(record)
    .filter((candidate): candidate is Record<string, unknown> =>
      Boolean(candidate && Array.isArray(candidate.actions) && candidate.actions.length > 0));
  if (withActions.length === 0) return false;
  // Each card's OWN declared intents, never a name this file supplies. A kind
  // of press nobody has declared yet is covered without an edit here, and this
  // module still knows no intent, no kind and no domain.
  return withActions.every((candidate) => {
    const reference = typeof candidate.ref === 'string' ? candidate.ref : undefined;
    if (!reference) return false;
    const intents = (candidate.actions as unknown[])
      .map(record)
      .map((action) => (typeof action?.intent === 'string' ? action.intent : null))
      .filter((intent): intent is string => Boolean(intent));
    if (intents.length === 0) return false;
    return intents.every(
      (intent) => candidateActionTarget(presentation, `${intent}:${reference}`) !== null,
    );
  });
}
