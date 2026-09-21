/**
 * JASIM — THE AUTHORITY ADMINISTRATION PATH.
 *
 * ─── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────
 *
 * A person must be able to perform an AUTHORITY ACT by speaking: create an
 * organization, grant a verb, set a policy, bind a provider, delegate a
 * negotiating limit, agree. Two phases arrived at this same gap from opposite
 * directions, which is what made it one gap rather than two missing features.
 *
 * And the whole difficulty is that the obvious implementation is worse than
 * not building it. A capability that sets an envelope, plus a run summary the
 * person clicks «موافق» on, is an authority they never read:
 *
 *   APPROVAL != CLICK
 *   MODEL PROPOSES != RUNTIME PERFORMS
 *
 * ─── HOW IT IS CLOSED ───────────────────────────────────────────────────────
 *
 * 1. A model may REQUEST an act. It names a registered act type and typed
 *    parameters, and it performs nothing.
 * 2. The RUNTIME writes the statement — from the act's DECLARED parameter
 *    schema, so an act cannot choose what to leave out, and from canonical
 *    state, so a scope's name is what the database says and not what the model
 *    called it. No sentence a model produced enters it.
 * 3. Every scalar in the parameters appears in that statement. A reserve of 250
 *    buried three levels inside `bounds` is rendered as its own line, because
 *    the renderer flattens rather than summarising. A summary is where a number
 *    goes to hide.
 * 4. The person approves by citing the DIGEST of what they read. Before
 *    performing, the runtime re-renders from current canonical state: if the
 *    statement would read differently now, the approval is void. An approval
 *    that outlives the words it was given for is the theatre this file exists
 *    to prevent.
 *
 * ─── WHY A REGISTRY AND NOT ONE ENDPOINT PER ACT ────────────────────────────
 *
 * Seven acts today, all general verbs over general primitives. There is no
 * `RestaurantOnboarding` act and there never will be:
 *
 *   DOMAIN_AUTHORITY_ACTS_ADDED = 0
 *
 * A new act is a new row in one registry, and it inherits the statement, the
 * digest, the expiry and the re-render for free. An act that wanted its own
 * approval flow would be an act that wanted its own rules.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  agreements,
  authorityRequests,
  economicEngagements,
  scopePolicies,
  scopeProviderBindings,
  economicProposals,
  memberships,
  organizations,
  type AuthorityRequest,
} from "../../db/schema";
import {
  SCOPE_PERMISSIONS,
  authorizeScopeAction,
  bindScopeProvider,
  createOrganization,
  setScopePolicy,
  type ActingScope,
  type ScopePermission,
} from "./actor-scope";
import {
  commitAgreement,
  getNegotiationEnvelope,
  setNegotiationEnvelope,
  termSheetOf,
} from "./agreement-runtime";
import { grantMembership, revokeMembership } from "./block2/membership";
import {
  classifyPolicyBody,
  disclosableDecision,
  evaluatePolicies,
  parseEnforcementPolicy,
  scalarPaths,
} from "./policy-enforcement";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

export const AUTHORITY_REQUEST_STATES = [
  "PENDING",
  "PERFORMED",
  "REJECTED",
  "VOID",
] as const;
export type AuthorityRequestState = (typeof AUTHORITY_REQUEST_STATES)[number];

export const AUTHORITY_RESOLUTIONS = [
  /** The person said no. */
  "REJECTED_BY_PRINCIPAL",
  /** Nobody decided in time. */
  "EXPIRED",
  /** The world moved: the statement would read differently now. */
  "STATEMENT_CHANGED",
  /** They cited words other than the ones on the row. */
  "DIGEST_MISMATCH",
] as const;
export type AuthorityResolution = (typeof AUTHORITY_RESOLUTIONS)[number];

/** How a parameter is shown. Not what it MEANS. */
export const PARAM_KINDS = ["STRING", "NUMBER", "BOOLEAN", "STRING_LIST", "OBJECT"] as const;
export type ParamKind = (typeof PARAM_KINDS)[number];

export type AuthorityActErrorCode =
  | "UNKNOWN_ACT"
  | "INVALID"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STATE";

export class AuthorityActError extends Error {
  readonly code: AuthorityActErrorCode;
  constructor(message: string, code: AuthorityActErrorCode) {
    super(message);
    this.code = code;
    this.name = "AuthorityActError";
  }
}

/**
 * Words a caller may never say about an authority act.
 *
 * Each is a fact the runtime establishes. A model that could set `approved`
 * would approve by describing; one that could set `statementDigest` would
 * approve words nobody rendered.
 */
export const AUTHORITY_ACT_KEYS: ReadonlySet<string> = new Set([
  "approved",
  "ownerapproved",
  "statementdigest",
  "statement",
  "authorityrequestid",
  "performed",
  "decidedat",
  "principalid",
  "scopeid",
]);

export function assertNoAuthorityActClaim(value: Record<string, unknown>, label: string): void {
  for (const key of Object.keys(value)) {
    if (AUTHORITY_ACT_KEYS.has(key.trim().toLowerCase())) {
      throw new AuthorityActError(
        `«${key}» states an authority the runtime establishes; it cannot be supplied in ${label}.`,
        "INVALID",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// An act
// ─────────────────────────────────────────────────────────────────────────────

export type ParamSpec = {
  readonly key: string;
  /** Shown to the person, in their language. Fixed here, never by a model. */
  readonly label: string;
  readonly kind: ParamKind;
  readonly required: boolean;
};

export type AuthorityAct = {
  readonly id: string;
  /** The fixed sentence the person reads. Owned here; no model text reaches it. */
  readonly headline: string;
  readonly params: readonly ParamSpec[];
  /**
   * The verb the scope must hold, or `null` when the act is the principal's
   * own — creating an organization needs no permission in an organization that
   * does not exist yet.
   */
  readonly requiredPermission: ScopePermission | null;
  /** Acts that can only ever be a person's own. */
  readonly personalOnly?: boolean;
  readonly reversibility: "REVERSIBLE" | "PARTIALLY_COMPENSATABLE" | "IRREVERSIBLE";
  readonly residualNote?: string;
  /**
   * What an id MEANS, read from canonical state.
   *
   * «وافق على العرض p_8f3a» is not something a person can consent to. An act
   * that names a row must say what that row says, so this returns the terms,
   * the counterparty, the permissions being removed — whatever the id stands
   * for — and the renderer flattens all of it into the statement.
   *
   * It is read at render time AND again at approval, which is what makes the
   * digest catch a proposal whose terms changed while somebody was reading.
   *
   * Required of any act with an id parameter; a test enforces that.
   */
  readonly expand?: (params: Record<string, unknown>, scope: ActingScope) => Promise<Record<string, unknown>>;
  readonly perform: (context: {
    params: Record<string, unknown>;
    principalId: string;
    scope: ActingScope;
  }) => Promise<Record<string, unknown>>;
  /**
   * JASIM reading back what it just did.
   *
   *   RECEIPT != VERIFICATION
   *
   * `perform` returning an id is the act's own word about itself, and an
   * act's own word is worth nothing about an act. Required of every act, for
   * the same reason every effectful capability has an `effectContract`: an
   * unverified write is a write nobody can be told about honestly.
   */
  readonly readback: (context: {
    result: Record<string, unknown>;
    params: Record<string, unknown>;
    principalId: string;
    scope: ActingScope;
  }) => Promise<{ occurred: boolean; detail: string }>;
};

const ACTS = new Map<string, AuthorityAct>();

export function registerAuthorityAct(act: AuthorityAct): void {
  if (ACTS.has(act.id)) throw new Error(`Authority act «${act.id}» is already registered.`);
  ACTS.set(act.id, act);
}

export function getAuthorityAct(id: string): AuthorityAct | undefined {
  return ACTS.get(id);
}

export function listAuthorityActs(): readonly AuthorityAct[] {
  return [...ACTS.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateParams(act: AuthorityAct, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AuthorityActError(`«${act.id}» needs parameters.`, "INVALID");
  }
  const input = raw as Record<string, unknown>;
  assertNoAuthorityActClaim(input, "parameters");

  const declared = new Set(act.params.map((spec) => spec.key));
  for (const key of Object.keys(input)) {
    // Refused rather than dropped. A parameter silently discarded is a
    // parameter the person was never shown and the runtime never used, and
    // both of those are worse than an error.
    if (!declared.has(key)) {
      throw new AuthorityActError(`«${key}» is not a parameter of «${act.id}».`, "INVALID");
    }
  }

  const params: Record<string, unknown> = {};
  for (const spec of act.params) {
    const value = input[spec.key];
    if (value === undefined || value === null) {
      if (spec.required) {
        throw new AuthorityActError(`«${spec.key}» is required by «${act.id}».`, "INVALID");
      }
      continue;
    }
    const ok =
      spec.kind === "STRING"
        ? typeof value === "string" && value.trim().length > 0
        : spec.kind === "NUMBER"
          ? typeof value === "number" && Number.isFinite(value)
          : spec.kind === "BOOLEAN"
            ? typeof value === "boolean"
            : spec.kind === "STRING_LIST"
              ? Array.isArray(value) && value.every((entry) => typeof entry === "string")
              : typeof value === "object" && !Array.isArray(value);
    if (!ok) {
      throw new AuthorityActError(`«${spec.key}» is not a ${spec.kind}.`, "INVALID");
    }
    params[spec.key] = value;
  }
  return params;
}

// ─────────────────────────────────────────────────────────────────────────────
// The statement
// ─────────────────────────────────────────────────────────────────────────────

export type StatementLine = {
  /** The path, so a nested number is addressable rather than summarised away. */
  readonly key: string;
  readonly label: string;
  readonly value: string | number | boolean;
};

export type AuthorityStatement = {
  readonly actType: string;
  readonly headline: string;
  readonly onBehalfOf: {
    readonly scopeId: string;
    readonly kind: "PERSONAL" | "ORGANIZATION";
    /** From the database. Never what a model called it. */
    readonly displayName: string;
  };
  readonly lines: readonly StatementLine[];
  readonly reversibility: string;
  readonly residualNote?: string;
  /**
   * What this scope's own rules say about it — ids, versions, effects and
   * reason codes, never a payload.
   *
   * Carried IN the statement rather than beside it, so a policy change moves
   * the digest and voids a pending approval with no new machinery. A rule that
   * changed what an act means while somebody was reading is exactly the case
   * `STATEMENT_CHANGED` exists for.
   */
  readonly policy: Record<string, unknown>;
};

const MAX_LINES = 200;

/**
 * Flatten a parameter to the scalars a person can actually read.
 *
 * This is the anti-theatre guarantee. «bounds: {…}» hides a reserve; three
 * lines reading `bounds.price.reserve = 250` do not. The renderer walks the
 * value rather than asking the act what to show, so an act cannot omit a
 * number even by accident.
 */
/**
 * Flatten a parameter to the scalars a person can actually read.
 *
 * This is the anti-theatre guarantee. «bounds: {…}» hides a reserve; a line
 * reading `bounds.price.reserve = 250` does not. The walk itself lives in
 * `policy-enforcement`, deliberately: a policy names its fields by the same
 * dotted path, so a rule about `bounds.price.reserve` is a rule about exactly
 * the line the person read. Two path conventions would be two meanings of one
 * sentence.
 */
function flatten(prefix: string, value: unknown, into: StatementLine[], label: string): void {
  for (const entry of scalarPaths(value, prefix)) {
    if (into.length >= MAX_LINES) return;
    const suffix = entry.path.slice(prefix.length).replace(/^\./, "");
    into.push({
      key: entry.path,
      label: suffix ? `${label} · ${suffix}` : label,
      value: entry.value,
    });
  }
}

async function scopeDisplayName(scope: ActingScope): Promise<string> {
  if (scope.kind === "PERSONAL") return "نفسك";
  // Read from canonical state, not from the resolution that was handed in: the
  // name on the screen has to be the name in the database.
  const [row] = await db
    .select({ displayName: organizations.displayName, status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, scope.organizationId))
    .limit(1);
  if (!row) throw new AuthorityActError("That organization no longer exists.", "NOT_FOUND");
  if (row.status !== "active") {
    throw new AuthorityActError("That organization is not active.", "FORBIDDEN");
  }
  return row.displayName;
}

export async function renderAuthorityStatement(input: {
  act: AuthorityAct;
  params: Record<string, unknown>;
  scope: ActingScope;
}): Promise<AuthorityStatement> {
  const lines: StatementLine[] = [];
  // Driven by the DECLARED schema, in its declared order. An act cannot choose
  // what appears here, and a parameter it forgot to declare could not have
  // been supplied in the first place.
  for (const spec of input.act.params) {
    flatten(spec.key, input.params[spec.key], lines, spec.label);
  }
  // What the ids MEAN, from canonical state. Flattened by the same walker, so
  // an expansion is no more able to hide a number than a parameter is — and
  // rendered at the TOP level rather than under a prefix, because these paths
  // are also the facts a policy names. «terms.price» has to be one path: the
  // line a person reads and the field a rule bounds.
  const declared = new Set(input.act.params.map((spec) => spec.key));
  const expanded = input.act.expand ? await input.act.expand(input.params, input.scope) : {};
  for (const [key, value] of Object.entries(expanded)) {
    if (declared.has(key)) {
      // A collision would mean one path with two meanings, which is how a rule
      // comes to bound something other than what it names.
      throw new AuthorityActError(
        `«${key}» is both a parameter and an expansion of «${input.act.id}».`,
        "INVALID",
      );
    }
    flatten(key, value, lines, key);
  }
  const decision = await evaluatePolicies({
    scopeId: input.scope.scopeId,
    action: input.act.id,
    // Parameters AND what their ids stand for. A rule about the price in a
    // proposal must see the price, not the proposal's id.
    parameters: { ...input.params, ...expanded },
  });
  return {
    actType: input.act.id,
    headline: input.act.headline,
    onBehalfOf: {
      scopeId: input.scope.scopeId,
      kind: input.scope.kind,
      displayName: await scopeDisplayName(input.scope),
    },
    lines: Object.freeze(lines),
    reversibility: input.act.reversibility,
    ...(input.act.residualNote ? { residualNote: input.act.residualNote } : {}),
    policy: disclosableDecision(decision),
  };
}

/**
 * A stable digest of exactly what was read.
 *
 * Key order is normalised so that re-serialising the same statement gives the
 * same hash; nothing else is normalised, because two statements that differ by
 * a single digit must differ here.
 */
export function statementDigest(statement: AuthorityStatement): string {
  return createHash("sha256").update(canonical(statement)).digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return "null";
}

// ─────────────────────────────────────────────────────────────────────────────
// The lifecycle
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * The scope's own rules, separately from the person's permission.
 *
 * `REQUIRES_APPROVAL` passes, because an authority request IS the approval the
 * policy asked for. `DENIED` and `UNSUPPORTED_POLICY` do not, and neither can
 * be approved past: `APPROVAL != POLICY OVERRIDE`.
 */
function assertPolicyPermits(statement: AuthorityStatement): void {
  const decision = statement.policy as { outcome?: string };
  if (decision.outcome === "DENIED") {
    throw new AuthorityActError(
      "A policy of this scope forbids this. It is not something an approval can override.",
      "FORBIDDEN",
    );
  }
  if (decision.outcome === "UNSUPPORTED_POLICY") {
    throw new AuthorityActError(
      "This scope carries a policy the runtime cannot evaluate, so nothing may proceed under it.",
      "FORBIDDEN",
    );
  }
}

async function assertPermitted(act: AuthorityAct, principalId: string, scope: ActingScope) {
  if (act.personalOnly && scope.kind !== "PERSONAL") {
    throw new AuthorityActError(
      `«${act.id}» is a person's own act and cannot be done in an organization's name.`,
      "FORBIDDEN",
    );
  }
  if (act.requiredPermission === null) return;
  if (scope.kind !== "ORGANIZATION") return;
  const allowed = await authorizeScopeAction({
    principalId,
    scopeId: scope.scopeId,
    permission: act.requiredPermission,
  });
  if (!allowed.ok) {
    throw new AuthorityActError(
      `Not permitted to «${act.requiredPermission}» in this scope.`,
      "FORBIDDEN",
    );
  }
}

/**
 * Ask. Never do.
 *
 * The permission is checked HERE as well as at approval, so nobody is asked to
 * approve something that was never going to work. Asking for a decision that
 * cannot be carried out is its own kind of dishonesty.
 */
export async function requestAuthorityAct(input: {
  actType: string;
  principalId: string;
  scope: ActingScope;
  params: unknown;
  conversationId?: string;
  ttlMs?: number;
  now?: Date;
}): Promise<{ request: AuthorityRequest; statement: AuthorityStatement }> {
  const act = ACTS.get(input.actType);
  if (!act) {
    throw new AuthorityActError(`«${input.actType}» is not an authority act.`, "UNKNOWN_ACT");
  }
  if (!input.principalId?.trim()) {
    throw new AuthorityActError("An authority act records who must decide it.", "INVALID");
  }
  const params = validateParams(act, input.params);
  await assertPermitted(act, input.principalId, input.scope);

  // Rendered first, and the policy gate reads the decision the statement
  // already carries. One evaluation, so the words a person reads and the rule
  // that let them read them can never be two different facts.
  const statement = await renderAuthorityStatement({ act, params, scope: input.scope });
  assertPolicyPermits(statement);
  const digest = statementDigest(statement);
  const now = input.now ?? new Date();

  const [row] = await db
    .insert(authorityRequests)
    .values({
      id: `aut_${randomUUID()}`,
      actType: act.id,
      principalId: input.principalId,
      scopeId: input.scope.scopeId,
      params,
      statement: statement as unknown as Record<string, unknown>,
      statementDigest: digest,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS)),
    })
    .returning();
  return { request: row!, statement };
}

export type ApprovalOutcome =
  | { readonly state: "PERFORMED"; readonly request: AuthorityRequest; readonly result: Record<string, unknown> }
  | { readonly state: "VOID"; readonly request: AuthorityRequest; readonly resolution: AuthorityResolution; readonly message: string };

async function voidRequest(
  row: AuthorityRequest,
  resolution: AuthorityResolution,
  message: string,
  state: AuthorityRequestState = "VOID",
): Promise<ApprovalOutcome> {
  const [updated] = await db
    .update(authorityRequests)
    .set({ state, resolution, decidedAt: new Date() })
    .where(and(eq(authorityRequests.id, row.id), eq(authorityRequests.state, "PENDING")))
    .returning();
  return { state: "VOID", request: updated ?? row, resolution, message };
}

/**
 * Approve the exact words that were read, and only those.
 *
 * `statementDigest` is not a formality. Between rendering and deciding, a
 * membership can be revoked, an organization renamed, an envelope superseded —
 * and each of those changes what the sentence MEANS. So the statement is
 * rendered again from current canonical state and compared. A mismatch is not
 * an error to retry past; it is the runtime refusing to act on words nobody
 * agreed to.
 */
export async function approveAuthorityRequest(input: {
  requestId: string;
  principalId: string;
  statementDigest: string;
  now?: Date;
}): Promise<ApprovalOutcome> {
  const [row] = await db
    .select()
    .from(authorityRequests)
    .where(eq(authorityRequests.id, input.requestId))
    .limit(1);
  if (!row) throw new AuthorityActError("No such authority request.", "NOT_FOUND");
  // Not "not yours to see" — not yours to DECIDE. A scope cannot read; the
  // person named on the row is the only one whose approval means anything.
  if (row.principalId !== input.principalId) {
    throw new AuthorityActError("This decision is not yours to make.", "FORBIDDEN");
  }
  if (row.state !== "PENDING") {
    throw new AuthorityActError(`This request is ${row.state}.`, "STATE");
  }
  const now = input.now ?? new Date();
  if (row.expiresAt.getTime() <= now.getTime()) {
    return voidRequest(row, "EXPIRED", "The request expired before it was decided.");
  }

  const act = ACTS.get(row.actType);
  if (!act) throw new AuthorityActError(`«${row.actType}» is no longer registered.`, "UNKNOWN_ACT");

  // Re-resolve the scope from canonical state. Membership can end between
  // rendering and deciding, and an approval must not survive that.
  const scope = await rehydrateScope(row);
  await assertPermitted(act, row.principalId, scope);

  const fresh = await renderAuthorityStatement({
    act,
    params: row.params as Record<string, unknown>,
    scope,
  });
  const freshDigest = statementDigest(fresh);
  if (freshDigest !== row.statementDigest) {
    return voidRequest(
      row,
      "STATEMENT_CHANGED",
      "What this would do has changed since it was shown. Ask again to see the current version.",
    );
  }
  if (input.statementDigest !== row.statementDigest) {
    return voidRequest(
      row,
      "DIGEST_MISMATCH",
      "The approval cites different words than the ones on this request.",
    );
  }

  // Again, because a rule can be written between reading and deciding. The
  // re-render above already voids on a changed decision; this refuses the case
  // where the digest happened to survive.
  assertPolicyPermits(fresh);

  // One approval, one act: the CAS is what makes a double-click a single act.
  const [claimed] = await db
    .update(authorityRequests)
    .set({ state: "PERFORMED", decidedAt: now })
    .where(and(eq(authorityRequests.id, row.id), eq(authorityRequests.state, "PENDING")))
    .returning();
  if (!claimed) throw new AuthorityActError("This request was already decided.", "STATE");

  const performContext = {
    params: row.params as Record<string, unknown>,
    principalId: row.principalId,
    scope,
  };
  const result = await act.perform(performContext);
  // The act's own word, and then JASIM's reading of the world. Only the second
  // one is evidence.
  const verification = await act.readback({ ...performContext, result });
  const [finished] = await db
    .update(authorityRequests)
    .set({
      result: {
        ...result,
        verification: {
          state: verification.occurred ? "VERIFIED" : "NOT_OCCURRED",
          source: "INTERNAL_READBACK",
          detail: verification.detail,
        },
      },
    })
    .where(eq(authorityRequests.id, row.id))
    .returning();
  return {
    state: "PERFORMED",
    request: finished ?? claimed,
    result: {
      ...result,
      verified: verification.occurred,
      verificationDetail: verification.detail,
    },
  };
}

export async function rejectAuthorityRequest(input: {
  requestId: string;
  principalId: string;
}): Promise<AuthorityRequest> {
  const [row] = await db
    .select()
    .from(authorityRequests)
    .where(eq(authorityRequests.id, input.requestId))
    .limit(1);
  if (!row) throw new AuthorityActError("No such authority request.", "NOT_FOUND");
  if (row.principalId !== input.principalId) {
    throw new AuthorityActError("This decision is not yours to make.", "FORBIDDEN");
  }
  const outcome = await voidRequest(
    row,
    "REJECTED_BY_PRINCIPAL",
    "Declined.",
    "REJECTED",
  );
  return outcome.request;
}

/** The scope the row was created under, rebuilt from canonical state. */
async function rehydrateScope(row: AuthorityRequest): Promise<ActingScope> {
  if (row.scopeId === row.principalId) {
    return { kind: "PERSONAL", scopeId: row.principalId, principalId: row.principalId };
  }
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, row.scopeId))
    .limit(1);
  if (!org) throw new AuthorityActError("That organization no longer exists.", "NOT_FOUND");
  return {
    kind: "ORGANIZATION",
    scopeId: org.id,
    principalId: row.principalId,
    organizationId: org.id,
    displayName: org.displayName,
  };
}

export async function listAuthorityRequests(input: {
  principalId: string;
  state?: AuthorityRequestState;
  limit?: number;
}): Promise<readonly AuthorityRequest[]> {
  const where = input.state
    ? and(
        eq(authorityRequests.principalId, input.principalId),
        eq(authorityRequests.state, input.state),
      )
    : eq(authorityRequests.principalId, input.principalId);
  return db
    .select()
    .from(authorityRequests)
    .where(where)
    .orderBy(desc(authorityRequests.createdAt))
    .limit(Math.min(input.limit ?? 20, 100));
}

// ─────────────────────────────────────────────────────────────────────────────
// The acts
//
// Seven general verbs over general primitives. There is no
// `RestaurantOnboarding` act, and adding one would be the failure:
//
//   DOMAIN_AUTHORITY_ACTS_ADDED = 0
// ─────────────────────────────────────────────────────────────────────────────

registerAuthorityAct({
  id: "organization.create",
  headline: "إنشاء جهة جديدة تتصرف باسمها",
  params: [
    { key: "displayName", label: "اسم الجهة", kind: "STRING", required: true },
    { key: "attributes", label: "وصف الجهة", kind: "OBJECT", required: false },
  ],
  requiredPermission: null,
  personalOnly: true,
  reversibility: "PARTIALLY_COMPENSATABLE",
  residualNote: "Closing an organization later does not unsay what was published in its name.",
  perform: async ({ params, principalId }) => {
    const created = await createOrganization({
      principalId,
      displayName: params.displayName as string,
      ...(params.attributes ? { attributes: params.attributes as Record<string, unknown> } : {}),
    });
    return { organizationId: created.id, displayName: created.displayName };
  },
  readback: async ({ result, principalId }) => {
    const [row] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, result.organizationId as string))
      .limit(1);
    if (!row) return { occurred: false, detail: "No organization with that id exists." };
    // Not merely that it exists: that the person can actually act as it. An
    // organization nobody is a member of is a row, not a scope.
    const grants = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.ownerId, row.id),
          eq(memberships.subjectId, principalId),
          eq(memberships.state, "active"),
        ),
      );
    if (grants.length === 0) {
      return { occurred: false, detail: "The organization exists and grants its creator nothing." };
    }
    return { occurred: true, detail: `«${row.displayName}» exists and its creator may act as it.` };
  },
});

registerAuthorityAct({
  id: "membership.grant",
  headline: "منح شخص صلاحيات للتصرف باسم هذه الجهة",
  params: [
    { key: "subjectId", label: "الشخص", kind: "STRING", required: true },
    { key: "permissions", label: "الأفعال الممنوحة", kind: "STRING_LIST", required: true },
  ],
  requiredPermission: "manage_members",
  reversibility: "REVERSIBLE",
  residualNote: "Revoking ends future authority; it rewrites nothing they already did.",
  expand: async (params, scope) => {
    // «امنح 9802» tells nobody anything. What they hold already is what turns
    // this into a decision: granting `approve` to someone who has nothing is a
    // different act from adding it to someone who already publishes.
    const existing = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.ownerId, scope.scopeId),
          eq(memberships.subjectId, params.subjectId as string),
          eq(memberships.state, "active"),
        ),
      );
    return {
      alreadyHolds:
        existing.length === 0
          ? "لا شيء"
          : [...new Set(existing.flatMap((row) => row.permissions))].join("، "),
    };
  },
  perform: async ({ params, scope }) => {
    const permissions = params.permissions as string[];
    // Verbs, and only the closed set. A role name reaching this line is how a
    // `FactoryManager` gets born.
    for (const permission of permissions) {
      if (!(SCOPE_PERMISSIONS as readonly string[]).includes(permission)) {
        throw new AuthorityActError(`«${permission}» is not a permission.`, "INVALID");
      }
    }
    const { membership } = await grantMembership(db, {
      ownerId: scope.scopeId,
      subjectId: params.subjectId as string,
      resourceKind: "organization",
      resourceId: "*",
      permissions,
      purpose: undefined,
    });
    return { membershipId: membership.id, subjectId: membership.subjectId };
  },
  readback: async ({ result, params }) => {
    const [row] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, result.membershipId as string))
      .limit(1);
    if (!row || row.state !== "active") {
      return { occurred: false, detail: "No active grant with that id exists." };
    }
    const asked = new Set(params.permissions as string[]);
    const held = new Set(row.permissions);
    const missing = [...asked].filter((permission) => !held.has(permission));
    if (missing.length > 0) {
      return { occurred: false, detail: `The grant is missing: ${missing.join("، ")}.` };
    }
    return { occurred: true, detail: `${row.subjectId} holds ${row.permissions.join("، ")}.` };
  },
});

registerAuthorityAct({
  id: "membership.revoke",
  headline: "سحب صلاحيات شخص من هذه الجهة",
  params: [{ key: "membershipId", label: "المنح المسحوب", kind: "STRING", required: true }],
  requiredPermission: "manage_members",
  reversibility: "REVERSIBLE",
  expand: async (params) => {
    const [row] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, params.membershipId as string))
      .limit(1);
    if (!row) throw new AuthorityActError("No such grant.", "NOT_FOUND");
    return { person: row.subjectId, losing: row.permissions.join("، "), state: row.state };
  },
  perform: async ({ params, scope }) => {
    const revoked = await revokeMembership(db, {
      membershipId: params.membershipId as string,
      actorOwnerId: scope.scopeId,
    });
    return { membershipId: revoked.id, state: revoked.state };
  },
  readback: async ({ result }) => {
    const [row] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, result.membershipId as string))
      .limit(1);
    if (!row) return { occurred: false, detail: "That grant no longer exists at all." };
    return row.state === "revoked"
      ? { occurred: true, detail: "The grant is revoked." }
      : { occurred: false, detail: `The grant is still ${row.state}.` };
  },
});

registerAuthorityAct({
  id: "policy.set",
  headline: "وضع سياسة تلزم هذه الجهة",
  params: [
    { key: "policyKey", label: "السياسة", kind: "STRING", required: true },
    { key: "value", label: "المحتوى", kind: "OBJECT", required: true },
  ],
  requiredPermission: "manage_policies",
  reversibility: "REVERSIBLE",
  residualNote: "A policy is versioned: a later one supersedes it and neither is erased.",
  expand: async (params) => {
    //   POLICY STORED != POLICY ENFORCED
    //
    // The single most important line in this act. A person who asked for a
    // rule and is about to get a note must be able to SEE that, so the
    // classification is rendered as its own line — and when it is a rule, its
    // effect and every condition are rendered too, because a rule nobody read
    // is the thing this whole path exists to prevent.
    const classification = classifyPolicyBody(params.value);
    if (classification !== "ENFORCED") {
      return {
        enforcement: classification,
        note:
          classification === "MALFORMED"
            ? "يدّعي أنه سياسة قابلة للتنفيذ ولا يمكن قراءته — لن يُنفَّذ، وسيمنع كل تصرّف في هذا النطاق."
            : "يُحفَظ ولا يُنفَّذ: لا شيء في وقت التشغيل يقرؤه.",
      };
    }
    const rule = parseEnforcementPolicy(params.value);
    return {
      enforcement: "ENFORCED",
      effect: rule.effect,
      actions: rule.actions.join("، "),
      conditions: rule.conditions.map(
        (condition) => `${condition.field} ${condition.operator} ${condition.value}`,
      ),
      requires: rule.requires.map(
        (requirement) => `${requirement.field} ${requirement.operator} ${requirement.value}`,
      ),
    };
  },
  perform: async ({ params, principalId, scope }) => {
    const policy = await setScopePolicy({
      principalId,
      scopeId: scope.scopeId,
      policyKey: params.policyKey as string,
      value: params.value as Record<string, unknown>,
    });
    return { policyId: policy.id, policyKey: policy.policyKey, version: policy.version };
  },
  readback: async ({ result, scope }) => {
    const [row] = await db
      .select()
      .from(scopePolicies)
      .where(
        and(
          eq(scopePolicies.id, result.policyId as string),
          eq(scopePolicies.scopeId, scope.scopeId),
        ),
      )
      .limit(1);
    if (!row) return { occurred: false, detail: "No policy of this scope has that id." };
    return { occurred: true, detail: `«${row.policyKey}» stands at version ${row.version}.` };
  },
});

registerAuthorityAct({
  id: "provider.bind",
  headline: "ربط مزوّد خارجي بهذه الجهة",
  params: [
    { key: "providerClass", label: "نوع المزوّد", kind: "STRING", required: true },
    { key: "providerId", label: "المزوّد", kind: "STRING", required: true },
    {
      // A NAME, never a secret. The value lives in the environment, and the
      // person is shown which variable will be read rather than its contents.
      key: "credentialEnvName",
      label: "اسم متغيّر الاعتماد",
      kind: "STRING",
      required: false,
    },
  ],
  requiredPermission: "manage_providers",
  reversibility: "REVERSIBLE",
  expand: async (params, scope) => {
    // What is already bound for this class. Binding a second inventory adapter
    // and replacing the first are different decisions, and a person cannot
    // tell them apart from the parameters alone.
    const existing = await db
      .select()
      .from(scopeProviderBindings)
      .where(
        and(
          eq(scopeProviderBindings.scopeId, scope.scopeId),
          eq(scopeProviderBindings.providerClass, params.providerClass as string),
          eq(scopeProviderBindings.state, "active"),
        ),
      );
    return {
      alreadyBound:
        existing.length === 0 ? "لا شيء" : existing.map((row) => row.providerId).join("، "),
      // Said out loud, because the difference is the whole security model.
      credentialIsAName: true,
    };
  },
  perform: async ({ params, principalId, scope }) => {
    const bound = await bindScopeProvider({
      principalId,
      scopeId: scope.scopeId,
      providerClass: params.providerClass as string,
      providerId: params.providerId as string,
      ...(params.credentialEnvName
        ? { credentialEnvName: params.credentialEnvName as string }
        : {}),
    });
    return { bindingId: bound.id };
  },
  readback: async ({ result, scope }) => {
    const [row] = await db
      .select()
      .from(scopeProviderBindings)
      .where(
        and(
          eq(scopeProviderBindings.id, result.bindingId as string),
          eq(scopeProviderBindings.scopeId, scope.scopeId),
        ),
      )
      .limit(1);
    if (!row || row.state !== "active") {
      return { occurred: false, detail: "No active binding of this scope has that id." };
    }
    return {
      occurred: true,
      // The NAME, because that is all that is stored. Reading back a secret
      // would mean a secret was there to read.
      detail: `«${row.providerId}» is bound, reading ${row.credentialEnvName ?? "no credential"}.`,
    };
  },
});

registerAuthorityAct({
  id: "negotiation.envelope.set",
  headline: "تفويض جاسم بالتفاوض ضمن حدود",
  params: [
    { key: "engagementId", label: "التفاوض", kind: "STRING", required: true },
    // Flattened into one line per number, which is the entire point: a reserve
    // inside an object is a reserve nobody read.
    { key: "bounds", label: "الحدود", kind: "OBJECT", required: true },
    { key: "mayConcede", label: "السماح بالمقابلة", kind: "BOOLEAN", required: false },
    { key: "mayAcceptWithinReserve", label: "السماح بالاتفاق ضمن الحد", kind: "BOOLEAN", required: false },
  ],
  requiredPermission: "approve",
  reversibility: "REVERSIBLE",
  residualNote:
    "A later envelope supersedes this one; it does not undo an agreement already reached under it.",
  expand: async (params, scope) => {
    const [engagement] = await db
      .select()
      .from(economicEngagements)
      .where(eq(economicEngagements.id, params.engagementId as string))
      .limit(1);
    if (!engagement) throw new AuthorityActError("No such negotiation.", "NOT_FOUND");
    if (!engagement.participants.includes(scope.scopeId)) {
      throw new AuthorityActError("Not a participant in that negotiation.", "FORBIDDEN");
    }
    return {
      // Delegating a limit without knowing who it will be used against is not
      // a decision anyone can make.
      counterparty: engagement.participants.filter((party) => party !== scope.scopeId).join("، "),
    };
  },
  perform: async ({ params, principalId, scope }) => {
    const envelope = await setNegotiationEnvelope({
      engagementId: params.engagementId as string,
      ownerId: scope.scopeId,
      principalId,
      bounds: params.bounds,
      mayConcede: params.mayConcede === true,
      mayAcceptWithinReserve: params.mayAcceptWithinReserve === true,
    });
    return { envelopeId: envelope.id, version: envelope.version };
  },
  readback: async ({ result, params, scope }) => {
    const current = await getNegotiationEnvelope({
      engagementId: params.engagementId as string,
      ownerId: scope.scopeId,
    });
    if (!current || current.id !== result.envelopeId) {
      return { occurred: false, detail: "The current envelope is not the one this created." };
    }
    return {
      occurred: true,
      // The FLAGS, never the bounds. This string is read by whoever asked, and
      // a reserve does not belong in a confirmation any more than anywhere else.
      detail: `Version ${current.version} stands: concede=${current.mayConcede}, accept=${current.mayAcceptWithinReserve}.`,
    };
  },
});

registerAuthorityAct({
  id: "agreement.commit",
  headline: "الموافقة على اتفاق بشروطه كما هي",
  params: [{ key: "proposalId", label: "العرض", kind: "STRING", required: true }],
  requiredPermission: "approve",
  reversibility: "IRREVERSIBLE",
  residualNote:
    "An agreement is a fact between two parties. Releasing one is a separate act they both take.",
  expand: async (params) => {
    // The terms themselves, every one of them. «وافق على العرض p_8f3a» is not
    // something a person can consent to, and this is the act where that
    // matters most: agreeing is irreversible.
    const [proposal] = await db
      .select()
      .from(economicProposals)
      .where(eq(economicProposals.id, params.proposalId as string))
      .limit(1);
    if (!proposal) throw new AuthorityActError("No such proposal.", "NOT_FOUND");
    const terms = termSheetOf(proposal.terms, "proposed terms");
    return {
      proposedBy: proposal.proposerOwnerId,
      version: proposal.version,
      status: proposal.status,
      // One entry per term, so a price change between reading and approving
      // moves the digest.
      //
      // The VALUE and the unit are separate lines, deliberately. These paths
      // are also the facts a policy compares against, and «225 JOD» is a
      // string: formatting a number for display makes it incomparable, and a
      // rule that silently fails to match is worse than one that errors.
      //
      //   A FACT THAT IS DISPLAYED MUST BE THE FACT THAT IS COMPARED.
      terms: Object.fromEntries(terms.map((term) => [term.key, term.value])),
      units: Object.fromEntries(
        terms.filter((term) => term.unit).map((term) => [term.key, term.unit!]),
      ),
      owes: Object.fromEntries(
        terms.filter((term) => term.owedBy).map((term) => [term.key, term.owedBy!]),
      ),
    };
  },
  perform: async ({ params, principalId, scope }) => {
    // OWNER_DIRECT, and legitimately so: a person read the terms and said yes.
    // This is the one path on which that is true.
    const { agreement, commitments } = await commitAgreement({
      proposalId: params.proposalId as string,
      ownerId: scope.scopeId,
      principalId,
      ownerDirect: true,
    });
    return { agreementId: agreement.id, commitmentCount: commitments.length };
  },
  readback: async ({ result, scope }) => {
    const [row] = await db
      .select()
      .from(agreements)
      .where(eq(agreements.id, result.agreementId as string))
      .limit(1);
    if (!row) return { occurred: false, detail: "No agreement with that id exists." };
    if (!row.participants.includes(scope.scopeId)) {
      return { occurred: false, detail: "The agreement does not list this party." };
    }
    return {
      occurred: true,
      detail: `Agreed under ${(row.authorityBasis as { kind: string }).kind}.`,
    };
  },
});
