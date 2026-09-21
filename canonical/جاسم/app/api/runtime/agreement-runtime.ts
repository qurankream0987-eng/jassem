/**
 * JASIM — THE GENERAL AGREEMENT RUNTIME.
 *
 * ─── ONE MECHANISM, NO SUBJECTS ─────────────────────────────────────────────
 *
 * A salary, a rent, a shipping fee, a service scope and six hours of
 * laboratory time negotiate through the same three tables and the same four
 * capabilities. Nothing in this module knows what is being negotiated: a term
 * key is an opaque string, and `price`, `startDate` and `hoursPerWeek` are
 * three identical fields to it.
 *
 * A `SalaryNegotiation` beside a `RentNegotiation` would be the failure.
 *
 * ─── THE CHAIN THIS MODULE SITS IN ──────────────────────────────────────────
 *
 *   Intent != Proposal != Approval != Agreement != Transaction != Fulfillment
 *
 * Reaching an Agreement moves no money, books nothing and tells nobody. It
 * records that two parties agreed to an exact proposal VERSION and under whose
 * authority. What happens next is a different runtime that does not exist yet.
 *
 * ─── TARGET != AUTHORITY ────────────────────────────────────────────────────
 *
 * «لا تتجاوز 250 دينارًا ولا تخبره بذلك» is two different facts:
 *
 *   a LIMIT   JASIM may act within        → the envelope's `reserve`
 *   a SECRET  the counterparty may not see → what the projection omits
 *
 * The target is what someone would like. The reserve is what they may go to.
 * Treating the first as the second is how an agent gives away the whole margin
 * on its first counter.
 *
 * ─── WHAT A MODEL MAY DO HERE ───────────────────────────────────────────────
 *
 *   LLM != Authority
 *
 * A model may propose term VALUES — that is a proposal, and a proposal binds
 * nobody. It may never set an envelope, widen a reserve, accept, agree or
 * commit. Those keys are refused rather than ignored, because silently
 * ignoring an authority claim is how a caller comes to believe it worked.
 *
 * And the reserve NEVER enters a model context. It is treated exactly like a
 * credential:
 *
 *   RESERVE != LLM CONTEXT
 *
 * ─── WHAT THIS MODULE DOES NOT CLAIM ────────────────────────────────────────
 *
 *   NOT_DISCLOSED != NOT_INFERABLE
 *
 * The runtime guarantees a reserve is never STATED — not in a projection, not
 * in a message, not in a model context. It cannot guarantee that a counterparty
 * is unable to INFER one from a sequence of counters, and pretending otherwise
 * would be a false guarantee of the kind this project exists to refuse. Moving
 * in declared steps is a concession policy the owner sets; it is not a promise
 * the runtime makes.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../queries/connection";
import { createProposal } from "./economic-fabric";
import { evaluatePolicies } from "./policy-enforcement";
import {
  agreements,
  commitments,
  economicEngagements,
  economicProposals,
  negotiationEnvelopes,
  transactionIntents,
  type Agreement,
  type Commitment,
  type EconomicProposal,
  type NegotiationEnvelope,
} from "../../db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary — closed, and containing no subject
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a value is compared. Not what it MEANS.
 *
 * `NUMBER` covers a price, a weight, a duration in whatever unit the parties
 * chose and a date expressed as an instant. `CHOICE` covers anything compared
 * by equality against a declared set. There is deliberately no `CURRENCY` and
 * no `DATE`: both would be this module learning a subject.
 */
export const TERM_KINDS = ["NUMBER", "CHOICE"] as const;
export type TermKind = (typeof TERM_KINDS)[number];

/** Which way is better FOR THE PARTY THAT DECLARED IT. */
export const TERM_DIRECTIONS = ["LOWER_IS_BETTER", "HIGHER_IS_BETTER", "EXACT"] as const;
export type TermDirection = (typeof TERM_DIRECTIONS)[number];

/** What an evaluation can conclude. There is no "probably acceptable". */
export const NEGOTIATION_VERDICTS = [
  /** Every bounded term is at or inside the reserve. */
  "WITHIN_RESERVE",
  /** Something is outside, and a counter inside this party's authority exists. */
  "COUNTERABLE",
  /** Something is outside and JASIM may not move. The owner decides. */
  "OUT_OF_AUTHORITY",
] as const;
export type NegotiationVerdict = (typeof NEGOTIATION_VERDICTS)[number];

export class AgreementInputError extends Error {
  readonly code = "AGREEMENT_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "AgreementInputError";
  }
}

export class AgreementAuthorityError extends Error {
  readonly code = "AGREEMENT_AUTHORITY";
  constructor(message: string) {
    super(message);
    this.name = "AgreementAuthorityError";
  }
}

/**
 * Words a caller may never say about a negotiation.
 *
 * Every one of these is a fact the RUNTIME establishes. A model that could set
 * `reserve` could widen its own limit; one that could set `agreed` could end a
 * negotiation by describing it as ended.
 */
export const NEGOTIATION_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "reserve",
  "reservevalue",
  "bounds",
  "envelopeid",
  "mayconcede",
  "mayaccept",
  "mayacceptwithinreserve",
  "authoritybasis",
  "agreementid",
  "agreed",
  "accepted",
  "committed",
  "commitmentid",
  "bindingauthority",
  "approved",
  "ownerapproved",
]);

/** Refuse, rather than ignore. An ignored authority claim reads as an accepted one. */
export function assertNoNegotiationAuthorityClaim(
  value: Record<string, unknown>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (NEGOTIATION_AUTHORITY_KEYS.has(key.trim().toLowerCase())) {
      throw new AgreementInputError(
        `«${key}» states an authority the runtime establishes; it cannot be supplied in ${label}.`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Term sheets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One negotiable term.
 *
 * `key` is opaque. `unit` is carried and never interpreted — the runtime will
 * not convert dinars to dollars or hours to days, because a runtime that
 * converted units would be deciding an exchange rate nobody gave it.
 */
export type Term = {
  readonly key: string;
  readonly kind: TermKind;
  readonly value: number | string;
  readonly unit?: string;
  /**
   * Who owes this, if anyone. DECLARED, never inferred: a runtime that guessed
   * the payer from a field called `price` would have acquired a domain in the
   * one place it matters most.
   */
  readonly owedBy?: string;
  readonly dueAt?: string;
};

export type TermSheet = readonly Term[];

const MAX_TERMS = 40;

function normalizeKey(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AgreementInputError(`${label} needs a term key.`);
  }
  const key = value.trim();
  if (key.length > 160) throw new AgreementInputError(`«${key}» is too long for a term key.`);
  return key;
}

/**
 * Validate a term sheet without understanding it.
 *
 * Everything checked here is structural: the kind is in the closed set, a
 * NUMBER is finite, a key appears once. Nothing asks what the key means.
 */
export function parseTermSheet(input: unknown, label = "terms"): TermSheet {
  if (!Array.isArray(input)) throw new AgreementInputError(`${label} must be a list of terms.`);
  if (input.length === 0) throw new AgreementInputError(`${label} is empty.`);
  if (input.length > MAX_TERMS) throw new AgreementInputError(`${label} has too many terms.`);

  const seen = new Set<string>();
  const terms: Term[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new AgreementInputError(`${label} contains something that is not a term.`);
    }
    const entry = raw as Record<string, unknown>;
    assertNoNegotiationAuthorityClaim(entry, label);
    const key = normalizeKey(entry.key, label);
    if (seen.has(key)) throw new AgreementInputError(`«${key}» appears twice in ${label}.`);
    seen.add(key);

    const kind = String(entry.kind ?? "NUMBER").toUpperCase() as TermKind;
    if (!TERM_KINDS.includes(kind)) {
      throw new AgreementInputError(`«${entry.kind}» is not a term kind.`);
    }
    if (kind === "NUMBER") {
      if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
        throw new AgreementInputError(`«${key}» is a NUMBER and needs a finite numeric value.`);
      }
    } else if (typeof entry.value !== "string" || !entry.value.trim()) {
      throw new AgreementInputError(`«${key}» is a CHOICE and needs a value.`);
    }
    if (entry.unit !== undefined && typeof entry.unit !== "string") {
      throw new AgreementInputError(`«${key}» has a unit that is not a string.`);
    }
    if (entry.owedBy !== undefined && typeof entry.owedBy !== "string") {
      throw new AgreementInputError(`«${key}» names an obligation holder that is not an id.`);
    }
    if (entry.dueAt !== undefined) {
      if (typeof entry.dueAt !== "string" || Number.isNaN(Date.parse(entry.dueAt))) {
        throw new AgreementInputError(`«${key}» has a due time that is not a timestamp.`);
      }
    }
    terms.push({
      key,
      kind,
      value: entry.value as number | string,
      ...(typeof entry.unit === "string" ? { unit: entry.unit } : {}),
      ...(typeof entry.owedBy === "string" ? { owedBy: entry.owedBy } : {}),
      ...(typeof entry.dueAt === "string" ? { dueAt: entry.dueAt } : {}),
    });
  }
  return Object.freeze(terms);
}

/**
 * What the OTHER side sees of a proposal.
 *
 * Built from four named fields, so a bound, an envelope or an owner's note
 * cannot reach a counterparty by being added to the row later. The same
 * construction the public expression projection uses, and for the same reason:
 * a projection assembled by omission leaks the first field somebody forgets.
 */
/**
 * How a term sheet is STORED.
 *
 * Wrapped in an object rather than written as a bare array, because the column
 * is a record everywhere else in the fabric and a shape that differs per row is
 * how a reader comes to guess. Reading it back is the only place that knows.
 */
export function termSheetOf(terms: unknown, label = "terms"): TermSheet {
  const carrier =
    terms && typeof terms === "object" && !Array.isArray(terms)
      ? (terms as Record<string, unknown>).terms
      : terms;
  return parseTermSheet(carrier, label);
}

/**
 * Put a validated sheet on the table.
 *
 * Versioning, the CAS that counters the previous proposal and the unique
 * (engagement, version) index all stay in the economic fabric: two places that
 * could each create a version would eventually create two v3s.
 */
export async function proposeTermSheet(input: {
  engagementId: string;
  proposerOwnerId: string;
  terms: unknown;
  expiresAt?: Date;
}): Promise<EconomicProposal> {
  const sheet = parseTermSheet(
    Array.isArray(input.terms)
      ? input.terms
      : (input.terms as Record<string, unknown> | undefined)?.terms,
  );
  return createProposal({
    engagementId: input.engagementId,
    proposerOwnerId: input.proposerOwnerId,
    terms: { terms: sheet } as unknown as Record<string, unknown>,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  });
}

export function counterpartyProposalView(proposal: {
  id: string;
  version: number;
  proposerOwnerId: string;
  terms: unknown;
  status: string;
  expiresAt?: Date | null;
}): Record<string, unknown> {
  let terms: TermSheet = [];
  try {
    terms = termSheetOf(proposal.terms);
  } catch {
    // A sheet that cannot be read is shown as no terms rather than as raw
    // storage: handing a counterparty an unparsed blob is how a bound escapes.
    terms = [];
  }
  return {
    proposalId: proposal.id,
    version: proposal.version,
    proposedBy: proposal.proposerOwnerId,
    status: proposal.status,
    ...(proposal.expiresAt ? { expiresAt: proposal.expiresAt.toISOString() } : {}),
    terms: terms.map((term) => ({
      key: term.key,
      kind: term.kind,
      value: term.value,
      ...(term.unit ? { unit: term.unit } : {}),
      ...(term.owedBy ? { owedBy: term.owedBy } : {}),
      ...(term.dueAt ? { dueAt: term.dueAt } : {}),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The authority envelope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One term's limit.
 *
 * `target` is an opening position and binds nothing. `reserve` is the line.
 * `concessionStep` is how far the owner permits one move — absent means JASIM
 * may go straight to the reserve, which is a decision the owner made by not
 * declaring a step rather than a default the runtime chose for them.
 */
export type TermBound = {
  readonly direction: TermDirection;
  readonly target: number | string;
  readonly reserve: number | string;
  readonly concessionStep?: number;
  /** Only for EXACT/CHOICE: the values this party will accept. */
  readonly acceptable?: readonly string[];
};

export type EnvelopeBounds = Readonly<Record<string, TermBound>>;

function parseBound(key: string, raw: unknown): TermBound {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AgreementInputError(`«${key}» has no bound.`);
  }
  const entry = raw as Record<string, unknown>;
  const direction = String(entry.direction ?? "").toUpperCase() as TermDirection;
  if (!TERM_DIRECTIONS.includes(direction)) {
    throw new AgreementInputError(`«${key}» needs a direction from the closed set.`);
  }
  if (direction === "EXACT") {
    const acceptable = entry.acceptable;
    if (!Array.isArray(acceptable) || acceptable.length === 0) {
      throw new AgreementInputError(`«${key}» is EXACT and needs the values it accepts.`);
    }
    for (const value of acceptable) {
      if (typeof value !== "string" || !value.trim()) {
        throw new AgreementInputError(`«${key}» accepts a value that is not a choice.`);
      }
    }
    const target = typeof entry.target === "string" ? entry.target : acceptable[0] as string;
    return Object.freeze({
      direction,
      target,
      reserve: target,
      acceptable: Object.freeze([...(acceptable as string[])]),
    });
  }
  if (typeof entry.target !== "number" || !Number.isFinite(entry.target)) {
    throw new AgreementInputError(`«${key}» needs a finite numeric target.`);
  }
  if (typeof entry.reserve !== "number" || !Number.isFinite(entry.reserve)) {
    throw new AgreementInputError(`«${key}» needs a finite numeric reserve.`);
  }
  // A target beyond the reserve is not a preference, it is a contradiction: it
  // would open at a position the owner has already said they cannot hold.
  const worseThanReserve =
    direction === "LOWER_IS_BETTER" ? entry.target > entry.reserve : entry.target < entry.reserve;
  if (worseThanReserve) {
    throw new AgreementInputError(
      `«${key}» opens beyond its own reserve. TARGET != AUTHORITY, but a target outside the authority is a contradiction.`,
    );
  }
  if (entry.concessionStep !== undefined) {
    if (typeof entry.concessionStep !== "number" || !(entry.concessionStep > 0)) {
      throw new AgreementInputError(`«${key}» has a concession step that is not a positive number.`);
    }
  }
  return Object.freeze({
    direction,
    target: entry.target,
    reserve: entry.reserve,
    ...(typeof entry.concessionStep === "number" ? { concessionStep: entry.concessionStep } : {}),
  });
}

export function parseEnvelopeBounds(input: unknown): EnvelopeBounds {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgreementInputError("An envelope needs bounds.");
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) throw new AgreementInputError("An envelope with no bound bounds nothing.");
  if (entries.length > MAX_TERMS) throw new AgreementInputError("Too many bounds.");
  const bounds: Record<string, TermBound> = {};
  for (const [key, raw] of entries) {
    bounds[normalizeKey(key, "bounds")] = parseBound(key, raw);
  }
  return Object.freeze(bounds);
}

async function requireParticipant(engagementId: string, ownerId: string) {
  const [engagement] = await db
    .select()
    .from(economicEngagements)
    .where(eq(economicEngagements.id, engagementId))
    .limit(1);
  if (!engagement) throw new AgreementInputError("Engagement not found.");
  if (!engagement.participants.includes(ownerId)) {
    throw new AgreementAuthorityError("Not a participant in this engagement.");
  }
  return engagement;
}

/**
 * Delegate bounded authority. Versioned, append-only, and never widened in place.
 *
 * `setByPrincipalId` records WHO delegated, separately from the scope that
 * holds the authority: a company does not delegate to itself, a person in it
 * does, and an agreement later has to be able to say which person.
 */
export async function setNegotiationEnvelope(input: {
  engagementId: string;
  ownerId: string;
  principalId: string;
  bounds: unknown;
  mayConcede?: boolean;
  mayAcceptWithinReserve?: boolean;
  expiresAt?: Date;
}): Promise<NegotiationEnvelope> {
  await requireParticipant(input.engagementId, input.ownerId);
  if (!input.principalId?.trim()) {
    throw new AgreementInputError("An envelope records who delegated it.");
  }
  const bounds = parseEnvelopeBounds(input.bounds);

  const [latest] = await db
    .select()
    .from(negotiationEnvelopes)
    .where(
      and(
        eq(negotiationEnvelopes.engagementId, input.engagementId),
        eq(negotiationEnvelopes.ownerId, input.ownerId),
      ),
    )
    .orderBy(desc(negotiationEnvelopes.version))
    .limit(1);

  const [row] = await db
    .insert(negotiationEnvelopes)
    .values({
      id: `env_${randomUUID()}`,
      engagementId: input.engagementId,
      ownerId: input.ownerId,
      bounds: bounds as unknown as Record<string, unknown>,
      mayConcede: input.mayConcede === true,
      mayAcceptWithinReserve: input.mayAcceptWithinReserve === true,
      version: (latest?.version ?? 0) + 1,
      setByPrincipalId: input.principalId,
      ...(latest ? { supersedesId: latest.id } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    })
    .returning();
  return row!;
}

/** The current envelope, or none. An expired one is none. */
export async function getNegotiationEnvelope(input: {
  engagementId: string;
  ownerId: string;
  now?: Date;
}): Promise<NegotiationEnvelope | undefined> {
  const [row] = await db
    .select()
    .from(negotiationEnvelopes)
    .where(
      and(
        eq(negotiationEnvelopes.engagementId, input.engagementId),
        eq(negotiationEnvelopes.ownerId, input.ownerId),
      ),
    )
    .orderBy(desc(negotiationEnvelopes.version))
    .limit(1);
  if (!row || row.state !== "active") return undefined;
  const now = input.now ?? new Date();
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return undefined;
  return row;
}

export async function negotiationEnvelopeHistory(input: {
  engagementId: string;
  ownerId: string;
}): Promise<readonly NegotiationEnvelope[]> {
  return db
    .select()
    .from(negotiationEnvelopes)
    .where(
      and(
        eq(negotiationEnvelopes.engagementId, input.engagementId),
        eq(negotiationEnvelopes.ownerId, input.ownerId),
      ),
    )
    .orderBy(negotiationEnvelopes.version);
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────────────────────

export type TermEvaluation = {
  readonly key: string;
  /** Inside the reserve, outside it, or not bounded at all. */
  readonly state: "WITHIN" | "OUTSIDE" | "UNBOUNDED";
  /** What this party would counter with, when it may. Never past the reserve. */
  readonly counterValue?: number | string;
};

export type NegotiationEvaluation = {
  readonly verdict: NegotiationVerdict;
  readonly terms: readonly TermEvaluation[];
  /** Present only for COUNTERABLE. A complete sheet, ready to be proposed. */
  readonly counter?: TermSheet;
  readonly reason: string;
};

function withinNumeric(direction: TermDirection, value: number, reserve: number): boolean {
  return direction === "LOWER_IS_BETTER" ? value <= reserve : value >= reserve;
}

/**
 * How far this party may move, from where it stands now.
 *
 * Deterministic and explainable: one declared step from its own last position,
 * clamped at the reserve — and the clamp is the whole point. There is no
 * heuristic, no model and no "split the difference", because a concession
 * nobody can explain is a concession nobody authorized.
 */
function concede(bound: TermBound, mine: number | undefined): number {
  const reserve = bound.reserve as number;
  const from = mine ?? (bound.target as number);
  if (bound.concessionStep === undefined) return reserve;
  const moved =
    bound.direction === "LOWER_IS_BETTER" ? from + bound.concessionStep : from - bound.concessionStep;
  if (bound.direction === "LOWER_IS_BETTER") return Math.min(moved, reserve);
  return Math.max(moved, reserve);
}

/**
 * Compare an incoming proposal against one party's envelope.
 *
 * Pure. It reads no database, decides nothing about acceptance and writes
 * nothing — `evaluate` answers what is true, and acting on it is a separate
 * act with its own authority.
 */
export function evaluateProposalAgainstEnvelope(input: {
  incoming: TermSheet;
  bounds: EnvelopeBounds;
  mayConcede: boolean;
  /** This party's own last sheet, when it has proposed before. */
  mine?: TermSheet;
}): NegotiationEvaluation {
  const mineByKey = new Map((input.mine ?? []).map((term) => [term.key, term]));
  const evaluations: TermEvaluation[] = [];
  let anyOutside = false;

  for (const term of input.incoming) {
    const bound = input.bounds[term.key];
    if (!bound) {
      // A term nobody bounded is not a violation. It is an unanswered question,
      // and answering it as though it were agreed would be the false pass.
      evaluations.push({ key: term.key, state: "UNBOUNDED" });
      continue;
    }
    if (bound.direction === "EXACT") {
      const ok =
        typeof term.value === "string" && (bound.acceptable ?? []).includes(term.value);
      if (ok) {
        evaluations.push({ key: term.key, state: "WITHIN" });
      } else {
        anyOutside = true;
        evaluations.push({
          key: term.key,
          state: "OUTSIDE",
          counterValue: bound.target,
        });
      }
      continue;
    }
    if (typeof term.value !== "number") {
      anyOutside = true;
      evaluations.push({ key: term.key, state: "OUTSIDE", counterValue: bound.target });
      continue;
    }
    if (withinNumeric(bound.direction, term.value, bound.reserve as number)) {
      evaluations.push({ key: term.key, state: "WITHIN" });
      continue;
    }
    anyOutside = true;
    const previous = mineByKey.get(term.key);
    evaluations.push({
      key: term.key,
      state: "OUTSIDE",
      counterValue: concede(bound, typeof previous?.value === "number" ? previous.value : undefined),
    });
  }

  if (!anyOutside) {
    return {
      verdict: "WITHIN_RESERVE",
      terms: Object.freeze(evaluations),
      reason: "Every bounded term is at or inside the reserve.",
    };
  }
  if (!input.mayConcede) {
    return {
      verdict: "OUT_OF_AUTHORITY",
      terms: Object.freeze(evaluations),
      reason: "A term is outside the reserve and this envelope permits no counter.",
    };
  }

  // The counter is the incoming sheet with the outside terms moved — so the
  // parts already agreed are carried forward verbatim rather than reopened.
  const counter: Term[] = input.incoming.map((term) => {
    const evaluation = evaluations.find((entry) => entry.key === term.key);
    if (!evaluation || evaluation.state !== "OUTSIDE" || evaluation.counterValue === undefined) {
      return term;
    }
    return { ...term, value: evaluation.counterValue };
  });
  return {
    verdict: "COUNTERABLE",
    terms: Object.freeze(evaluations),
    counter: Object.freeze(counter),
    reason: "A counter inside this party's declared authority exists.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agreement
// ─────────────────────────────────────────────────────────────────────────────

export type AuthorityBasis =
  | { readonly kind: "OWNER_DIRECT"; readonly principalId: string }
  | {
      readonly kind: "ENVELOPE";
      readonly envelopeId: string;
      readonly version: number;
      readonly setByPrincipalId: string;
    };

/**
 * Turn an accepted proposal into an Agreement.
 *
 * Three things this deliberately does NOT do:
 *
 *   • it does not accept on anyone's behalf without a basis — either the owner
 *     acted, or an envelope they signed permits it AND the sheet is inside it
 *   • it does not create a payment; `AGREEMENT != TRANSACTION`
 *   • it does not infer obligations; a Commitment exists only where the term
 *     sheet declared `owedBy`
 */
export async function commitAgreement(input: {
  proposalId: string;
  ownerId: string;
  principalId?: string;
  /** True only when the OWNER themselves is accepting, now. */
  ownerDirect?: boolean;
  now?: Date;
}): Promise<{ agreement: Agreement; commitments: readonly Commitment[] }> {
  const [proposal] = await db
    .select()
    .from(economicProposals)
    .where(eq(economicProposals.id, input.proposalId))
    .limit(1);
  if (!proposal) throw new AgreementInputError("Proposal not found.");
  const engagement = await requireParticipant(proposal.engagementId, input.ownerId);
  if (proposal.proposerOwnerId === input.ownerId) {
    throw new AgreementAuthorityError("A party cannot agree to its own proposal.");
  }
  if (proposal.status !== "proposed") {
    throw new AgreementAuthorityError(
      `Proposal v${proposal.version} is ${proposal.status}, not open.`,
    );
  }
  const now = input.now ?? new Date();
  if (proposal.expiresAt && proposal.expiresAt.getTime() <= now.getTime()) {
    throw new AgreementAuthorityError(`Proposal v${proposal.version} has expired.`);
  }

  const terms = termSheetOf(proposal.terms, "agreed terms");

  // ── The scope's own rules ────────────────────────────────────────────────
  //
  //   PERMISSION != POLICY != ENVELOPE
  //
  // Three different restrictions, and they compose rather than override. A
  // business may cap what it commits to regardless of how far anybody was
  // authorized to negotiate, so the policy is consulted here and the envelope
  // below — and the narrower of the two wins.
  //
  // The facts are the term sheet itself, by the same dotted paths the
  // authority statement renders, so a rule about `terms.price` is a rule about
  // the line a person would read.
  const policy = await evaluatePolicies({
    scopeId: input.ownerId,
    action: "agreement.commit",
    parameters: {
      terms: Object.fromEntries(terms.map((term) => [term.key, term.value])),
      proposalVersion: proposal.version,
    },
    now,
  });
  if (policy.outcome === "DENIED" || policy.outcome === "UNSUPPORTED_POLICY") {
    throw new AgreementAuthorityError(
      "A policy of this scope forbids agreeing to these terms.",
    );
  }
  if (policy.outcome === "REQUIRES_APPROVAL" && input.ownerDirect !== true) {
    // The envelope may be wide enough and the policy still says a person
    // decides this one. Broader authority never erases a narrower rule.
    throw new AgreementAuthorityError(
      "A policy of this scope requires a person to approve these terms; an envelope cannot.",
    );
  }

  // ── Whose authority ──────────────────────────────────────────────────────
  let basis: AuthorityBasis;
  if (input.ownerDirect === true) {
    if (!input.principalId?.trim()) {
      throw new AgreementInputError("A direct acceptance records the person who made it.");
    }
    basis = { kind: "OWNER_DIRECT", principalId: input.principalId };
  } else {
    const envelope = await getNegotiationEnvelope({
      engagementId: proposal.engagementId,
      ownerId: input.ownerId,
      now,
    });
    if (!envelope) {
      throw new AgreementAuthorityError(
        "Nobody authorized this acceptance. An agreement needs the owner or an envelope that permits it.",
      );
    }
    if (!envelope.mayAcceptWithinReserve) {
      throw new AgreementAuthorityError(
        "This envelope permits negotiating, not agreeing. The owner decides.",
      );
    }
    const evaluation = evaluateProposalAgainstEnvelope({
      incoming: terms,
      bounds: envelope.bounds as unknown as EnvelopeBounds,
      mayConcede: envelope.mayConcede,
    });
    if (evaluation.verdict !== "WITHIN_RESERVE") {
      throw new AgreementAuthorityError(
        "The proposal is outside the reserve. An envelope may never agree past its own limit.",
      );
    }
    basis = {
      kind: "ENVELOPE",
      envelopeId: envelope.id,
      version: envelope.version,
      setByPrincipalId: envelope.setByPrincipalId,
    };
  }

  return db.transaction(async (tx) => {
    // CAS: the proposal moves out of `proposed` or nothing happens. Two
    // simultaneous acceptances cannot both produce an agreement, and the
    // unique index on proposalId is the second lock.
    const [updated] = await tx
      .update(economicProposals)
      .set({ status: "accepted" })
      .where(
        and(
          eq(economicProposals.id, proposal.id),
          eq(economicProposals.status, "proposed"),
        ),
      )
      .returning();
    if (!updated) {
      throw new AgreementAuthorityError(`Proposal v${proposal.version} is no longer open.`);
    }

    const [agreement] = await tx
      .insert(agreements)
      .values({
        id: `agr_${randomUUID()}`,
        engagementId: proposal.engagementId,
        proposalId: proposal.id,
        participants: engagement.participants,
        terms: { terms } as unknown as Record<string, unknown>,
        authorityBasis: basis as unknown as Record<string, unknown>,
        acceptedByOwnerId: input.ownerId,
      })
      .returning();

    const owed = terms.filter((term) => term.owedBy);
    const created =
      owed.length === 0
        ? []
        : await tx
            .insert(commitments)
            .values(
              owed.map((term) => ({
                id: `cmt_${randomUUID()}`,
                agreementId: agreement!.id,
                ownerId: term.owedBy!,
                termKey: term.key,
                ...(term.dueAt ? { dueAt: new Date(term.dueAt) } : {}),
              })),
            )
            .returning();
    return { agreement: agreement!, commitments: created };
  });
}

export async function getAgreement(
  agreementId: string,
  requesterOwnerId: string,
): Promise<{ agreement: Agreement; commitments: readonly Commitment[] } | undefined> {
  const [agreement] = await db
    .select()
    .from(agreements)
    .where(eq(agreements.id, agreementId))
    .limit(1);
  if (!agreement) return undefined;
  if (!agreement.participants.includes(requesterOwnerId)) {
    throw new AgreementAuthorityError("Not a party to this agreement.");
  }
  const rows = await db
    .select()
    .from(commitments)
    .where(eq(commitments.agreementId, agreement.id));
  return { agreement, commitments: rows };
}

/**
 * Whether an accepted proposal produced a payment. It never does here.
 *
 * Exported so a test can assert the absence rather than trust the comment:
 * `AGREEMENT != TRANSACTION` is only worth saying if something checks it.
 */
export async function transactionIntentsForProposals(
  proposalIds: readonly string[],
): Promise<number> {
  if (proposalIds.length === 0) return 0;
  const rows = await db
    .select({ id: transactionIntents.id })
    .from(transactionIntents)
    .where(inArray(transactionIntents.proposalId, [...proposalIds]));
  return rows.length;
}

export type { EconomicProposal };
