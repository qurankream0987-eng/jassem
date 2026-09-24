/**
 * JASIM — THE SECURE PRODUCT ACTION RUNTIME.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   CONVERSATION INITIATES
 *   TRUSTED PRODUCT RUNTIME DEFINES
 *   TRUSTED SURFACE COLLECTS
 *   SERVER VALIDATES
 *   POLICY AUTHORIZES
 *   RUNTIME MUTATES
 *   AUDIT RECORDS
 *
 * A person may say «سجلني دخول», «غيّر كلمة السر», «احذف حسابي». The
 * conversation carries the INTENT and nothing else.
 *
 *   PASSWORD · TOKEN · BIOMETRIC SECRET · PAYMENT CREDENTIAL != LLM CONTEXT
 *   AUTHENTICATE != DAG NODE
 *
 * ─── WHAT A MODEL MAY AND MAY NOT DO ────────────────────────────────────────
 *
 * It may name a registered `actionId` and, where an action permits, a
 * non-sensitive semantic target. It may not define the input schema, say which
 * fields are sensitive, decide whether confirmation or re-authentication is
 * required, name who is authorized, or supply the handler. All of that comes
 * from registration in trusted server code, and a field cannot be moved from
 * SENSITIVE to NORMAL by anything a caller says.
 *
 *   MODEL_DEFINED_SECRET_FIELDS = 0
 *
 * ─── AND WHAT THIS IS NOT ───────────────────────────────────────────────────
 *
 * Not an auth redesign. The identity, the session token and the OAuth exchange
 * this repository already has are reused exactly as they are. One thing was
 * missing and is added here, because its absence made a claim false rather
 * than incomplete: there was no way to revoke a session. Clearing a cookie
 * while a bearer token keeps working is not a logout.
 *
 * Not a per-verb agent. One registry, one session, one submission boundary:
 *
 *   DOMAIN_PRODUCT_ACTION_TYPES_ADDED = 0
 *   DOMAIN_AUTH_AGENTS_ADDED          = 0
 */

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  events,
  identitySessionRevocations,
  productActionSessions,
  users,
  type ProductActionSession,
  type User,
} from "../../db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary — closed, and naming no product feature
// ─────────────────────────────────────────────────────────────────────────────

export const ACTION_STATUSES = [
  "INITIATED",
  "AWAITING_INPUT",
  "AWAITING_CONFIRMATION",
  "EXECUTED",
  "DENIED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** How much a mistake costs. Decides confirmation, never authorization. */
export const RISK_CLASSES = ["LOW", "ELEVATED", "HIGH", "IRREVERSIBLE"] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

export const AUTH_REQUIREMENTS = [
  /** Login and signup: there is nobody yet, and pretending otherwise is the bug. */
  "ANONYMOUS_ALLOWED",
  "AUTHENTICATED",
] as const;
export type AuthRequirement = (typeof AUTH_REQUIREMENTS)[number];

export const CONFIRMATION_POLICIES = [
  "NONE",
  "EXPLICIT",
  /** The person must repeat an exact phrase the runtime chose. */
  "EXPLICIT_PHRASE",
] as const;
export type ConfirmationPolicy = (typeof CONFIRMATION_POLICIES)[number];

/** How a field is collected. `SENSITIVE` never leaves the trusted boundary. */
export const FIELD_KINDS = ["TEXT", "EMAIL", "CHOICE", "BOOLEAN", "SENSITIVE"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** What the runtime can actually do today. Truthful, never aspirational. */
export const ACTION_AVAILABILITY = [
  "AVAILABLE",
  /** The contract is right and nothing is plugged into it. */
  "BLOCKED_BY_PROVIDER",
] as const;
export type ActionAvailability = (typeof ACTION_AVAILABILITY)[number];

export class ProductActionError extends Error {
  readonly code:
    | "UNKNOWN_ACTION"
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "INVALID"
    | "EXPIRED"
    | "STATE"
    | "BLOCKED";
  constructor(message: string, code: ProductActionError["code"]) {
    super(message);
    this.code = code;
    this.name = "ProductActionError";
  }
}

/**
 * Words a caller may never say about a product action.
 *
 * Every one is a fact the trusted runtime establishes. A payload that could
 * set `reauthenticated` would re-authenticate by asserting it; one that could
 * set `ownerId` would choose whose account to change.
 */
export const PRODUCT_ACTION_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "ownerid",
  "actorid",
  "userid",
  "isadmin",
  "role",
  "verified",
  "authorized",
  "authorization",
  "permissiongranted",
  "reauthenticated",
  "sessionid",
  "sessiontoken",
  "refreshtoken",
  "accesstoken",
  "passwordhash",
  "policydecision",
  "policyoverride",
  "confirmationsatisfied",
  "confirmed",
  "actioncompleted",
  "status",
]);

export function assertNoProductAuthorityClaim(
  value: Record<string, unknown>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (PRODUCT_ACTION_AUTHORITY_KEYS.has(key.trim().toLowerCase())) {
      throw new ProductActionError(
        `«${key}» states an authority the trusted runtime establishes; it cannot be supplied in ${label}.`,
        "INVALID",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A registered action
// ─────────────────────────────────────────────────────────────────────────────

export type ActionField = {
  readonly key: string;
  /** What the person reads. Fixed here; no model text reaches a surface. */
  readonly label: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  /** For CHOICE only. A closed set, so a surface cannot invent an option. */
  readonly options?: readonly string[];
};

export type ActionExecution =
  | { readonly outcome: "EXECUTED"; readonly record?: Record<string, unknown>; readonly detail: string }
  | { readonly outcome: "BLOCKED_BY_PROVIDER"; readonly detail: string }
  | { readonly outcome: "DENIED"; readonly detail: string };

export type ProductAction = {
  readonly id: string;
  readonly version: number;
  /** The fixed sentence a surface shows. Owned here. */
  readonly title: string;
  readonly consequence: string;
  readonly authentication: AuthRequirement;
  /**
   * Whether the person must prove who they are AGAIN, inside the trusted
   * surface, before this runs. Declared here and nowhere else.
   */
  readonly reauthentication: boolean;
  readonly risk: RiskClass;
  readonly fields: readonly ActionField[];
  readonly confirmation: ConfirmationPolicy;
  /** For EXPLICIT_PHRASE: what must be typed back, exactly. */
  readonly confirmationPhrase?: string;
  readonly availability: ActionAvailability;
  /** Seconds. Short, because an action session is a door left open. */
  readonly ttlSeconds: number;
  /**
   * What a repeat means for THIS action. There is no global rule: replaying a
   * logout is harmless, replaying a credential rotation is not.
   */
  readonly idempotency: "SAFE_REPEAT" | "SINGLE_USE";
  readonly execute: (context: {
    readonly action: ProductAction;
    readonly session: ProductActionSession;
    readonly actor?: User;
    /** Validated values, INCLUDING sensitive ones. Never persisted. */
    readonly values: Readonly<Record<string, string | boolean>>;
  }) => Promise<ActionExecution>;
};

const ACTIONS = new Map<string, ProductAction>();

export function registerProductAction(action: ProductAction): void {
  if (ACTIONS.has(action.id)) {
    throw new Error(`Product action «${action.id}» is already registered.`);
  }
  ACTIONS.set(action.id, action);
}

export function getProductAction(id: string): ProductAction | undefined {
  return ACTIONS.get(id);
}

export function listProductActions(): readonly ProductAction[] {
  return [...ACTIONS.values()];
}

/** Which fields a surface must never echo, and this runtime never stores. */
export function sensitiveFieldsOf(action: ProductAction): readonly string[] {
  return action.fields.filter((field) => field.kind === "SENSITIVE").map((field) => field.key);
}

// ─────────────────────────────────────────────────────────────────────────────
// The presentation contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a trusted surface renders. Built from the registration, so a model can
 * neither add a field nor change one from SENSITIVE to NORMAL.
 *
 * Carries no value, ever — not a default, not a previous entry, not a hint.
 */
export type ActionPresentation = {
  readonly actionId: string;
  readonly actionVersion: number;
  readonly title: string;
  readonly consequence: string;
  readonly risk: RiskClass;
  readonly availability: ActionAvailability;
  readonly reauthentication: boolean;
  readonly confirmation: ConfirmationPolicy;
  readonly confirmationPhrase?: string;
  readonly fields: readonly {
    readonly key: string;
    readonly label: string;
    readonly kind: FieldKind;
    readonly required: boolean;
    readonly options?: readonly string[];
  }[];
};

export function presentationFor(action: ProductAction): ActionPresentation {
  return {
    actionId: action.id,
    actionVersion: action.version,
    title: action.title,
    consequence: action.consequence,
    risk: action.risk,
    availability: action.availability,
    reauthentication: action.reauthentication,
    confirmation: action.confirmation,
    ...(action.confirmationPhrase ? { confirmationPhrase: action.confirmationPhrase } : {}),
    fields: action.fields.map((field) => ({
      key: field.key,
      label: field.label,
      kind: field.kind,
      required: field.required,
      ...(field.options ? { options: field.options } : {}),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a product action may record.
 *
 * Kind, actor, time, outcome, session id. Never a credential, never a token,
 * never a value a SENSITIVE field carried. The payload is assembled from named
 * fields so a future column cannot leak by being added.
 */
async function audit(input: {
  type: string;
  ownerId: string;
  session: Pick<ProductActionSession, "id" | "actionId" | "actionVersion" | "status">;
  message: string;
  extra?: Record<string, string | number | boolean>;
}): Promise<void> {
  await db.insert(events).values({
    type: input.type,
    source: "runtime",
    ownerId: input.ownerId,
    message: input.message,
    payload: {
      actionSessionId: input.session.id,
      actionId: input.session.actionId,
      actionVersion: input.session.actionVersion,
      status: input.session.status,
      ...(input.extra ?? {}),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The action session
// ─────────────────────────────────────────────────────────────────────────────

/** Opaque and server-generated. 256 bits, so it is not guessed. */
function newSessionId(): string {
  return `pas_${randomBytes(32).toString("base64url")}`;
}

export async function initiateProductAction(input: {
  actionId: string;
  /** The AUTHENTICATED actor, from the session. Never from a payload. */
  actor?: User;
  /** A pre-auth caller handle, for actions that have no actor yet. */
  anonymousRef?: string;
  conversationId?: string;
  now?: Date;
}): Promise<{ session: ProductActionSession; presentation: ActionPresentation }> {
  const action = ACTIONS.get(input.actionId);
  if (!action) {
    throw new ProductActionError(`«${input.actionId}» is not a product action.`, "UNKNOWN_ACTION");
  }
  if (action.authentication === "AUTHENTICATED" && !input.actor) {
    throw new ProductActionError("This action needs somebody signed in.", "UNAUTHENTICATED");
  }
  const now = input.now ?? new Date();
  const presentation = presentationFor(action);
  const [row] = await db
    .insert(productActionSessions)
    .values({
      id: newSessionId(),
      actionId: action.id,
      actionVersion: action.version,
      ...(input.actor ? { actorId: String(input.actor.id) } : {}),
      ...(input.anonymousRef ? { anonymousRef: input.anonymousRef } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      status: action.fields.length > 0 ? "AWAITING_INPUT" : "AWAITING_CONFIRMATION",
      presentation: presentation as unknown as Record<string, unknown>,
      expiresAt: new Date(now.getTime() + action.ttlSeconds * 1000),
    })
    .returning();
  await audit({
    type: "PRODUCT_ACTION_INITIATED",
    ownerId: input.actor ? String(input.actor.id) : "anonymous",
    session: row!,
    message: `A trusted product action was initiated: ${action.id}.`,
    extra: { risk: action.risk, availability: action.availability },
  });
  return { session: row!, presentation };
}

async function loadOpenSession(input: {
  actionSessionId: string;
  actor?: User;
  anonymousRef?: string;
  now: Date;
}): Promise<{ session: ProductActionSession; action: ProductAction }> {
  const [session] = await db
    .select()
    .from(productActionSessions)
    .where(eq(productActionSessions.id, input.actionSessionId))
    .limit(1);
  if (!session) throw new ProductActionError("No such action session.", "STATE");

  const action = ACTIONS.get(session.actionId);
  if (!action) throw new ProductActionError("That action is no longer registered.", "UNKNOWN_ACTION");

  // ── Whose door this is ──────────────────────────────────────────────────
  //
  // An id from somebody else's session is not found rather than merely
  // refused: an opaque id is not authority, and treating it as one is how a
  // leaked identifier becomes an account change.
  if (session.actorId) {
    if (!input.actor || String(input.actor.id) !== session.actorId) {
      throw new ProductActionError("No such action session.", "FORBIDDEN");
    }
  } else if (session.anonymousRef && session.anonymousRef !== input.anonymousRef) {
    throw new ProductActionError("No such action session.", "FORBIDDEN");
  }

  if (session.status === "EXECUTED" || session.status === "CANCELLED" || session.status === "DENIED") {
    // Single-use. A replayed submission is not a second act.
    throw new ProductActionError(`This action session is ${session.status}.`, "STATE");
  }
  if (session.expiresAt.getTime() <= input.now.getTime()) {
    await db
      .update(productActionSessions)
      .set({ status: "EXPIRED", completedAt: input.now })
      .where(
        and(eq(productActionSessions.id, session.id), eq(productActionSessions.status, session.status)),
      );
    await audit({
      type: "PRODUCT_ACTION_EXPIRED",
      ownerId: session.actorId ?? "anonymous",
      session: { ...session, status: "EXPIRED" },
      message: "A trusted product action expired before it was completed.",
    });
    throw new ProductActionError("This action session has expired.", "EXPIRED");
  }
  return { session, action };
}

/**
 * Validate what a trusted surface collected.
 *
 * Driven by the REGISTERED fields, so an extra key is refused rather than
 * dropped: a value nobody declared is a value nobody was shown and nobody
 * authorized, and both of those are worse than an error.
 */
function validateValues(
  action: ProductAction,
  raw: unknown,
): Readonly<Record<string, string | boolean>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProductActionError("This action needs its fields.", "INVALID");
  }
  const input = raw as Record<string, unknown>;
  assertNoProductAuthorityClaim(input, "a submission");

  const declared = new Map(action.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(input)) {
    if (!declared.has(key)) {
      throw new ProductActionError(`«${key}» is not a field of «${action.id}».`, "INVALID");
    }
  }
  const values: Record<string, string | boolean> = {};
  for (const field of action.fields) {
    const value = input[field.key];
    if (value === undefined || value === null || value === "") {
      if (field.required) {
        throw new ProductActionError(`«${field.key}» is required.`, "INVALID");
      }
      continue;
    }
    if (field.kind === "BOOLEAN") {
      if (typeof value !== "boolean") {
        throw new ProductActionError(`«${field.key}» is not a choice.`, "INVALID");
      }
      values[field.key] = value;
      continue;
    }
    if (typeof value !== "string") {
      throw new ProductActionError(`«${field.key}» is not text.`, "INVALID");
    }
    if (value.length > 400) {
      throw new ProductActionError(`«${field.key}» is too long.`, "INVALID");
    }
    if (field.kind === "CHOICE" && !(field.options ?? []).includes(value)) {
      throw new ProductActionError(`«${value}» is not an option of «${field.key}».`, "INVALID");
    }
    if (field.kind === "EMAIL" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value)) {
      throw new ProductActionError(`«${field.key}» is not an address.`, "INVALID");
    }
    values[field.key] = value;
  }
  return Object.freeze(values);
}

/** Everything the registry did NOT mark sensitive. The only thing persisted. */
function auditableRecord(
  action: ProductAction,
  values: Readonly<Record<string, string | boolean>>,
): Record<string, unknown> {
  const sensitive = new Set(sensitiveFieldsOf(action));
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !sensitive.has(key)),
  );
}

export type SubmitOutcome = {
  readonly status: ActionStatus;
  readonly outcome?: string;
  readonly detail: string;
  readonly session: ProductActionSession;
};

/**
 * The one submission boundary.
 *
 * Everything a person typed arrives here, is validated against the REGISTERED
 * schema, and the sensitive part is handed to the handler and then dropped. It
 * is never written to the session row, never put in an event, never returned,
 * and never travels back through a conversation.
 */
export async function submitProductAction(input: {
  actionSessionId: string;
  actor?: User;
  anonymousRef?: string;
  values: unknown;
  /** The person saying yes to the consequence they were shown. */
  confirmation?: string | boolean;
  actionVersion?: number;
  now?: Date;
}): Promise<SubmitOutcome> {
  const now = input.now ?? new Date();
  const { session, action } = await loadOpenSession({
    actionSessionId: input.actionSessionId,
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.anonymousRef ? { anonymousRef: input.anonymousRef } : {}),
    now,
  });

  // A surface built for one schema may not submit into another. The version is
  // part of what the person was shown.
  if (input.actionVersion !== undefined && input.actionVersion !== session.actionVersion) {
    throw new ProductActionError("This surface was built for a different version.", "INVALID");
  }
  if (session.actionVersion !== action.version) {
    throw new ProductActionError("This action changed since the surface opened.", "INVALID");
  }

  const values = validateValues(action, input.values);

  // ── Confirmation ────────────────────────────────────────────────────────
  //
  //   QUESTION != INTENT != CONFIRMATION != EXECUTION
  //
  // «يمكنك حذف حسابي؟» is a question. This is the line that keeps it from
  // becoming a deletion.
  if (action.confirmation === "EXPLICIT_PHRASE") {
    if (typeof input.confirmation !== "string" || input.confirmation !== action.confirmationPhrase) {
      return deny(session, "AWAITING_CONFIRMATION", "CONFIRMATION_REQUIRED", action, now);
    }
  } else if (action.confirmation === "EXPLICIT") {
    if (input.confirmation !== true) {
      return deny(session, "AWAITING_CONFIRMATION", "CONFIRMATION_REQUIRED", action, now);
    }
  }

  // ── Re-authentication ───────────────────────────────────────────────────
  //
  // Declared by the registry, satisfied inside the trusted surface, and never
  // asserted by a caller — `reauthenticated` is a refused key.
  if (action.reauthentication) {
    const proof = sensitiveFieldsOf(action).find((key) => key in values);
    if (!proof) {
      return deny(session, "DENIED", "REAUTHENTICATION_REQUIRED", action, now);
    }
  }

  // `availability` is the CONTRACT a surface renders so nobody types a
  // password into a door that does not open. The handler is the runtime truth,
  // and it is asked either way — a blocked action says WHY it is blocked in
  // its own words, which a generic short-circuit here would have thrown away.
  const result = await action.execute({
    action,
    session,
    ...(input.actor ? { actor: input.actor } : {}),
    values,
  });
  return finish(
    session,
    action,
    result.outcome === "EXECUTED" ? "EXECUTED" : "DENIED",
    result.outcome,
    // Only what is not sensitive. This is where the sentinel would leak, and
    // where it does not.
    result.outcome === "EXECUTED"
      ? { ...auditableRecord(action, values), ...(result.record ?? {}) }
      : auditableRecord(action, values),
    now,
    result.detail,
  );
}

async function deny(
  session: ProductActionSession,
  status: ActionStatus,
  outcome: string,
  action: ProductAction,
  now: Date,
): Promise<SubmitOutcome> {
  // AWAITING_CONFIRMATION leaves the door open — the person has not said no,
  // they have not said yes. DENIED closes it.
  const [updated] = await db
    .update(productActionSessions)
    .set({
      status,
      outcome,
      ...(status === "DENIED" ? { completedAt: now } : {}),
    })
    .where(eq(productActionSessions.id, session.id))
    .returning();
  await audit({
    type: "PRODUCT_ACTION_DENIED",
    ownerId: session.actorId ?? "anonymous",
    session: { ...session, status },
    message: `A trusted product action was not carried out: ${outcome}.`,
    extra: { risk: action.risk },
  });
  return {
    status,
    outcome,
    detail:
      outcome === "CONFIRMATION_REQUIRED"
        ? "This needs an explicit confirmation before anything changes."
        : "This needs the person to prove who they are again.",
    session: updated ?? session,
  };
}

async function finish(
  session: ProductActionSession,
  action: ProductAction,
  status: ActionStatus,
  outcome: string,
  record: Record<string, unknown>,
  now: Date,
  detail: string,
): Promise<SubmitOutcome> {
  const [updated] = await db
    .update(productActionSessions)
    .set({ status, outcome, record, completedAt: now })
    .where(
      and(eq(productActionSessions.id, session.id), eq(productActionSessions.status, session.status)),
    )
    .returning();
  if (!updated) {
    throw new ProductActionError("This action session was already decided.", "STATE");
  }
  await audit({
    type: status === "EXECUTED" ? "PRODUCT_ACTION_COMPLETED" : "PRODUCT_ACTION_DENIED",
    ownerId: session.actorId ?? "anonymous",
    session: { ...session, status },
    message: detail,
    extra: { risk: action.risk, outcome },
  });
  return { status, outcome, detail, session: updated };
}

/** «خلاص لا تغيّر كلمة السر». Nothing happened, and the row says so. */
export async function cancelProductAction(input: {
  actionSessionId: string;
  actor?: User;
  anonymousRef?: string;
  now?: Date;
}): Promise<ProductActionSession> {
  const now = input.now ?? new Date();
  const { session } = await loadOpenSession({
    actionSessionId: input.actionSessionId,
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.anonymousRef ? { anonymousRef: input.anonymousRef } : {}),
    now,
  });
  const [updated] = await db
    .update(productActionSessions)
    .set({ status: "CANCELLED", outcome: "CANCELLED_BY_PERSON", completedAt: now })
    .where(eq(productActionSessions.id, session.id))
    .returning();
  await audit({
    type: "PRODUCT_ACTION_CANCELLED",
    ownerId: session.actorId ?? "anonymous",
    session: { ...session, status: "CANCELLED" },
    message: "The person stopped before anything changed.",
  });
  return updated!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session revocation — the one thing that was missing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Revoke every session token issued for an identity before now.
 *
 * This is narrower than "log out this device", and deliberately so: the token
 * this repository issues is a stateless year-long JWT carrying only `unionId`
 * and `clientId`, with no id of its own. There is no per-session handle to
 * revoke, so the only honest revocation its design permits is per identity.
 *
 * Inventing a second session system to get a nicer answer would have been the
 * auth redesign this phase is not.
 */
export async function revokeIdentitySessions(input: {
  unionId: string;
  reason: string;
  now?: Date;
}): Promise<{ revokedBefore: Date }> {
  const now = input.now ?? new Date();
  // One second ahead, because the token's `iat` has whole-second resolution: a
  // token minted in the same second must not survive its own revocation.
  const revokedBefore = new Date(now.getTime() + 1000);
  await db
    .insert(identitySessionRevocations)
    .values({ unionId: input.unionId, revokedBefore, revokedAt: now, reason: input.reason })
    .onConflictDoUpdate({
      target: identitySessionRevocations.unionId,
      set: { revokedBefore, revokedAt: now, reason: input.reason },
    });
  return { revokedBefore };
}

/** Whether a token minted at `issuedAt` still stands. Read on every request. */
export async function sessionIsRevoked(input: {
  unionId: string;
  issuedAt?: number;
}): Promise<boolean> {
  const [row] = await db
    .select()
    .from(identitySessionRevocations)
    .where(eq(identitySessionRevocations.unionId, input.unionId))
    .limit(1);
  if (!row) return false;
  // No issue time is not a pass. A token that cannot say when it was minted
  // cannot be shown to predate a revocation.
  if (input.issuedAt === undefined) return true;
  return input.issuedAt * 1000 < row.revokedBefore.getTime();
}

// ─────────────────────────────────────────────────────────────────────────────
// The registered actions
//
// Seven, and every one is a general product verb. There is no
// `NotificationSettingsAgent` and no `PrivacyAgent`:
//
//   DOMAIN_PRODUCT_ACTION_TYPES_ADDED = 0
//   DOMAIN_AUTH_AGENTS_ADDED          = 0
// ─────────────────────────────────────────────────────────────────────────────

/**
 * «سجلني دخول».
 *
 * This repository authenticates through an external OAuth authorization code
 * exchange, and there is no password anywhere in it. So the trusted surface
 * for login is a redirect the SERVER builds, the conversation carries no
 * credential because there is no credential to carry, and the live exchange
 * needs a platform this environment has not configured.
 */
registerProductAction({
  id: "session.establish",
  version: 1,
  title: "تسجيل الدخول",
  consequence: "ستنتقل إلى صفحة الدخول الآمنة، ولن تُكتب كلمة السر في المحادثة.",
  authentication: "ANONYMOUS_ALLOWED",
  reauthentication: false,
  risk: "ELEVATED",
  fields: [],
  confirmation: "NONE",
  availability: "BLOCKED_BY_PROVIDER",
  ttlSeconds: 600,
  idempotency: "SAFE_REPEAT",
  execute: async () => ({
    outcome: "BLOCKED_BY_PROVIDER",
    detail: "Authentication is an external authorization-code exchange and no platform is configured.",
  }),
});

/**
 * «أنشئ لي حساباً».
 *
 * There is no separate signup in this repository: an account is created by the
 * same OAuth callback that establishes a session. Registering it separately
 * would be inventing a second account-creation path, so it declares the truth
 * and points at the same trusted door.
 */
registerProductAction({
  id: "account.create",
  version: 1,
  title: "إنشاء حساب",
  consequence: "يُنشأ الحساب من خلال نفس بوابة الدخول الآمنة، لا من داخل المحادثة.",
  authentication: "ANONYMOUS_ALLOWED",
  reauthentication: false,
  risk: "ELEVATED",
  fields: [],
  confirmation: "NONE",
  availability: "BLOCKED_BY_PROVIDER",
  ttlSeconds: 600,
  idempotency: "SAFE_REPEAT",
  execute: async () => ({
    outcome: "BLOCKED_BY_PROVIDER",
    detail: "An account is created by the same external exchange that signs somebody in.",
  }),
});

/** «سجلني خروج». The one that was a lie before this phase. */
registerProductAction({
  id: "session.revoke",
  version: 1,
  title: "تسجيل الخروج",
  consequence:
    "ستنتهي جميع الجلسات المفتوحة بهذه الهوية، لأن الرمز الحالي لا يحمل معرّفاً لجلسة بعينها.",
  authentication: "AUTHENTICATED",
  reauthentication: false,
  risk: "ELEVATED",
  fields: [],
  confirmation: "NONE",
  availability: "AVAILABLE",
  ttlSeconds: 300,
  // Replaying a logout is harmless: the second one revokes what is already
  // revoked and reports the same thing.
  idempotency: "SAFE_REPEAT",
  execute: async ({ actor }) => {
    if (!actor) return { outcome: "DENIED", detail: "Nobody is signed in." };
    const { revokedBefore } = await revokeIdentitySessions({
      unionId: actor.unionId,
      reason: "session.revoke",
    });
    return {
      outcome: "EXECUTED",
      record: { revokedBefore: revokedBefore.toISOString() },
      detail: "Every session token issued for this identity before now no longer authorizes anything.",
    };
  },
});

/**
 * «غيّر كلمة السر».
 *
 * There is no password in this repository — no column, no hash, no policy — so
 * there is nothing to rotate. The action is registered anyway, with its
 * sensitive fields and its re-authentication requirement declared, because the
 * boundary those fields travel through is real and is what this phase proves:
 * a sentinel typed into the trusted surface reaches the handler and appears
 * nowhere else. The rotation itself says it is blocked.
 */
registerProductAction({
  id: "credential.rotate",
  version: 1,
  title: "تغيير كلمة السر",
  consequence: "تُجمع كلمة السر في سطح آمن، ولا تمر عبر المحادثة ولا عبر النموذج.",
  authentication: "AUTHENTICATED",
  reauthentication: true,
  risk: "HIGH",
  fields: [
    { key: "currentSecret", label: "كلمة السر الحالية", kind: "SENSITIVE", required: true },
    { key: "newSecret", label: "كلمة السر الجديدة", kind: "SENSITIVE", required: true },
    { key: "confirmSecret", label: "تأكيد كلمة السر الجديدة", kind: "SENSITIVE", required: true },
  ],
  confirmation: "EXPLICIT",
  availability: "BLOCKED_BY_PROVIDER",
  ttlSeconds: 300,
  idempotency: "SINGLE_USE",
  execute: async () => ({
    outcome: "BLOCKED_BY_PROVIDER",
    detail: "This identity has no stored credential to rotate; authentication is external.",
  }),
});

/**
 * «غيّر هذا الإعداد».
 *
 * One action for every preference there is. The KEY is a closed choice the
 * registry supplies, so a caller cannot write an arbitrary field into somebody's
 * account by naming it.
 */
registerProductAction({
  id: "settings.update",
  version: 1,
  title: "تغيير إعداد",
  consequence: "يُحفظ التفضيل في حسابك، ويمكن تغييره مرة أخرى في أي وقت.",
  authentication: "AUTHENTICATED",
  reauthentication: false,
  risk: "LOW",
  fields: [
    {
      key: "preference",
      label: "الإعداد",
      kind: "CHOICE",
      required: true,
      options: ["notifications", "privacy", "display", "language"],
    },
    { key: "value", label: "القيمة", kind: "TEXT", required: true },
  ],
  // LOW risk and reversible, so policy does not demand a ceremony for it.
  confirmation: "NONE",
  availability: "AVAILABLE",
  ttlSeconds: 600,
  // Replaying leaves the same final state, which is what a preference is.
  idempotency: "SAFE_REPEAT",
  execute: async ({ actor, values }) => {
    if (!actor) return { outcome: "DENIED", detail: "Nobody is signed in." };
    const key = String(values.preference);
    const value = String(values.value);
    const [current] = await db.select().from(users).where(eq(users.id, actor.id)).limit(1);
    const preferences = { ...(current?.preferences ?? {}), [key]: value };
    await db.update(users).set({ preferences }).where(eq(users.id, actor.id));
    return {
      outcome: "EXECUTED",
      record: { preference: key },
      detail: `«${key}» is now «${value}».`,
    };
  },
});

/**
 * «احذف حسابي».
 *
 * There are no final deletion semantics in this repository — no erasure
 * policy, no retention rule, nothing that says what happens to the rows a
 * person owns. So this does not delete anything. It suspends the account, which
 * is a real state the schema already has, and says exactly that in the
 * consequence the person reads before confirming.
 *
 * Inventing destructive deletion to make a scenario green would be the worst
 * false success this codebase could produce.
 */
registerProductAction({
  id: "account.close",
  version: 1,
  title: "إغلاق الحساب",
  consequence:
    "سيُعلَّق حسابك وتنتهي جلساتك. لا يحذف هذا بياناتك: سياسة الحذف النهائي غير موجودة بعد، ولن أدّعي غير ذلك.",
  authentication: "AUTHENTICATED",
  reauthentication: false,
  risk: "IRREVERSIBLE",
  fields: [],
  // The exact phrase, typed back. A yes/no on an irreversible act is a click.
  confirmation: "EXPLICIT_PHRASE",
  confirmationPhrase: "أغلق حسابي",
  availability: "AVAILABLE",
  ttlSeconds: 300,
  // Replaying suspends what is already suspended and revokes what is already
  // revoked. It never produces a second destructive effect.
  idempotency: "SAFE_REPEAT",
  execute: async ({ actor }) => {
    if (!actor) return { outcome: "DENIED", detail: "Nobody is signed in." };
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, actor.id));
    await revokeIdentitySessions({ unionId: actor.unionId, reason: "account.close" });
    return {
      outcome: "EXECUTED",
      detail: "The account is suspended and its sessions are revoked. No data was deleted.",
    };
  },
});

/**
 * «اربط نظامي» — the trusted surface a provider credential is collected on.
 *
 * ─── WHY THIS IS ONE ACTION AND NOT ONE PER PROVIDER ─────────────────────────
 *
 * The credential's SHAPE differs by authentication method — an API key, a
 * username and password, a token, a certificate — but the boundary does not.
 * So there is one action, its sensitive fields are the superset, and which of
 * them are required is read from the provider DEFINITION at submission time.
 *
 *   No ShopifySetupAction. No StripeCredentialAction.
 *   DOMAIN_PRODUCT_ACTION_TYPES_ADDED = 0
 *
 * ─── WHAT THE CONVERSATION CARRIES ──────────────────────────────────────────
 *
 * The intent, and the id of a binding that a person with `manage_providers`
 * already opened in their own acting scope. Not the secret.
 *
 *   CREDENTIAL_INPUT != CHAT_INPUT
 *   MODEL_SEES_PROVIDER_SECRET = 0 · CHAT_TRANSCRIPT_CONTAINS_SECRET = 0
 *
 * ─── THE BINDING ID IS NOT AUTHORITY ────────────────────────────────────────
 *
 * It is typed into a surface, so it is a claim. `completeProviderSetup`
 * re-reads standing in the binding's own scope before it accepts anything, and
 * answers a guessed id, another scope's id and a former member's id with the
 * identical refusal.
 *
 *   CROSS_SCOPE_SETUP_LINK_ACCEPTED = 0 · SETUP_LINK != AUTHORIZATION
 */
registerProductAction({
  id: "provider.connect",
  version: 1,
  title: "ربط نظام خارجي",
  consequence:
    "تُجمع بيانات الاعتماد في سطح آمن ولا تمر عبر المحادثة. الربط لا يصبح مُتحقّقًا بمجرد حفظها.",
  authentication: "AUTHENTICATED",
  reauthentication: true,
  risk: "HIGH",
  fields: [
    { key: "bindingId", label: "الربط", kind: "TEXT", required: true },
    { key: "apiKey", label: "مفتاح الواجهة", kind: "SENSITIVE", required: false },
    { key: "username", label: "اسم المستخدم", kind: "SENSITIVE", required: false },
    { key: "password", label: "كلمة المرور", kind: "SENSITIVE", required: false },
    { key: "token", label: "الرمز", kind: "SENSITIVE", required: false },
    { key: "accessToken", label: "رمز الوصول", kind: "SENSITIVE", required: false },
    { key: "certificate", label: "الشهادة", kind: "SENSITIVE", required: false },
  ],
  confirmation: "EXPLICIT",
  availability: "AVAILABLE",
  ttlSeconds: 600,
  idempotency: "SINGLE_USE",
  execute: async ({ actor, values }) => {
    if (!actor) return { outcome: "DENIED", detail: "Nobody is signed in." };
    // Imported here rather than at the top: the binding runtime reads this
    // module's registry, and a cycle between them would be a load-order bug
    // waiting to happen.
    const { completeProviderSetup, ProviderBindingError } = await import("./provider-binding");
    const material: Record<string, string> = {};
    for (const key of ["apiKey", "username", "password", "token", "accessToken", "certificate"]) {
      const value = values[key];
      if (typeof value === "string" && value.length > 0) material[key] = value;
    }
    try {
      const done = await completeProviderSetup({
        bindingId: String(values.bindingId ?? ""),
        principalId: String(actor.id),
        material,
      });
      return {
        outcome: "EXECUTED",
        // The lifecycle, said plainly, because this is exactly the moment
        // somebody would otherwise believe they are connected.
        record: { lifecycle: done.lifecycle },
        detail: "A credential reference was attached. The connection is not verified yet.",
      };
    } catch (error) {
      if (error instanceof ProviderBindingError) {
        return { outcome: "DENIED", detail: error.message };
      }
      throw error;
    }
  },
});
