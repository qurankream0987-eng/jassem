/**
 * JASIM — WHO IS USING JASIM, and ON WHOSE AUTHORITY.
 *
 * ─── THE DISTINCTION THIS MODULE EXISTS FOR ─────────────────────────────────
 *
 *   AUTHENTICATED PRINCIPAL  !=  ACTING SCOPE
 *
 * Authentication answers "who is at the keyboard". Acting scope answers "on
 * whose behalf are they acting". Hassan is one principal; «شخصياً» and
 * «باسم شركة النور» are two scopes, and the same sentence means different
 * things under each.
 *
 * Collapsing them is the mistake that makes a personal account and a business
 * account two different products. JASIM keeps one runtime and one identity,
 * and changes only what the identity is acting AS.
 *
 * ─── WHY NO MIGRATION ───────────────────────────────────────────────────────
 *
 * Every durable table already keys on `ownerId`, and that column has always
 * meant the acting scope — the thing that owns the row — rather than the
 * person who typed. Introducing organizations therefore adds a new VALUE that
 * column can hold, not a new column. Renaming `ownerId` to `businessId`
 * everywhere would have been a migration wearing an architecture's clothes.
 *
 * ─── WHAT NATURAL LANGUAGE MAY NOT DO ───────────────────────────────────────
 *
 * «باسم شركتي» is a REQUEST for a scope, never a grant of one. The runtime
 * resolves it against durable membership, and:
 *
 *   • naming an organization the principal does not belong to  → DENIED
 *   • naming "my company" when two are plausible               → NEEDS_INPUT
 *
 * Never a silent choice. Picking one of two employers on the person's behalf
 * is the kind of helpfulness that publishes a price list under the wrong name.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  memberships,
  organizations,
  scopePolicies,
  scopeProviderBindings,
  type Organization,
  type ScopePolicy,
} from "../../db/schema";
import { checkMembershipAccess, grantMembership } from "./block2/membership";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a member may do in a scope. Generic verbs, never industry roles.
 *
 * There is no `FactoryManager` and no `RestaurantOwner`. A role is at most a
 * convenience bundle of these; the permissions are the authority.
 */
export const SCOPE_PERMISSIONS = [
  "view",
  "publish",
  "mutate",
  "approve",
  "manage_members",
  "manage_policies",
  "manage_providers",
  "act_financially",
] as const;
export type ScopePermission = (typeof SCOPE_PERMISSIONS)[number];

/** The membership grant's resource class. One string, no domain in it. */
export const ORGANIZATION_RESOURCE_KIND = "organization";

/**
 * THE `providerClass` THE PROVIDER BINDING RUNTIME OWNS.
 *
 * `scope_provider_bindings` carries two runtimes, told apart by `lifecycle`:
 * NULL is a legacy environment-name binding, anything else is a connection made
 * through the trusted setup ceremony. The modern runtime writes this one class,
 * so the name is its identity namespace and the legacy path may not write it.
 *
 *   LEGACY_BINDING != MODERN_CONNECTOR_BINDING · SAME_TABLE != SAME_RUNTIME
 *
 * Declared here rather than in `provider-binding.ts` because that module already
 * imports this one; one literal, one direction, no cycle.
 */
export const CONNECTOR_PROVIDER_CLASS = "connector";

export type ActingScope =
  | { readonly kind: "PERSONAL"; readonly scopeId: string; readonly principalId: string }
  | {
      readonly kind: "ORGANIZATION";
      readonly scopeId: string;
      readonly principalId: string;
      readonly organizationId: string;
      readonly displayName: string;
    };

export type ScopeResolution =
  | { readonly status: "RESOLVED"; readonly scope: ActingScope }
  /** Named a scope they have no standing in. */
  | { readonly status: "DENIED"; readonly reason: string; readonly message: string }
  /** Meant an organization; more than one fits, or none was named. */
  | {
      readonly status: "NEEDS_INPUT";
      readonly reason: string;
      readonly message: string;
      readonly candidates: readonly { readonly organizationId: string; readonly displayName: string }[];
    };

export class ActorScopeError extends Error {
  readonly code: "INVALID" | "FORBIDDEN" | "NOT_FOUND";
  constructor(message: string, code: ActorScopeError["code"]) {
    super(message);
    this.code = code;
    this.name = "ActorScopeError";
  }
}

/**
 * Keys a caller may never supply when requesting a scope.
 *
 * Each one is the request trying to BE the answer. A model may say which
 * organization it believes is meant; it may not say that the principal belongs
 * to it, nor what they may do there.
 */
export const SCOPE_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "principalid",
  "actingscopeid",
  "scopeid",
  "organizationid",
  "businessid",
  "membershipid",
  "ownerid",
  "role",
  "roles",
  "permission",
  "permissions",
  "authority",
  "member",
  "ismember",
  "authorized",
  "granted",
]);

export function assertNoScopeAuthorityClaim(
  value: Record<string, unknown>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (SCOPE_AUTHORITY_KEYS.has(key.toLowerCase())) {
      throw new ActorScopeError(
        `SCOPE_AUTHORITY_REJECTED: ${label}.${key} is decided by the runtime from durable ` +
          "membership. A request may name a scope; it may not grant itself one.",
        "FORBIDDEN",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Organizations and membership
// ─────────────────────────────────────────────────────────────────────────────

/** The scope id an organization owns rows under. Stable and opaque. */
export function organizationScopeId(organizationId: string): string {
  return organizationId;
}

/**
 * Create an organization, with its creator as its first full member.
 *
 * The founder grant is written through the SAME membership mechanism every
 * other member uses — there is no implicit "creator can do anything" branch,
 * so revoking the founder's membership revokes the founder's authority.
 */
export async function createOrganization(input: {
  principalId: string;
  displayName: string;
  attributes?: Record<string, unknown>;
}): Promise<Organization> {
  const displayName = input.displayName?.trim();
  if (!input.principalId?.trim()) throw new ActorScopeError("A principal is required.", "INVALID");
  if (!displayName) throw new ActorScopeError("An organization needs a name.", "INVALID");
  if (input.attributes) assertNoScopeAuthorityClaim(input.attributes, "attributes");

  const id = `org_${randomUUID()}`;
  const [row] = await db
    .insert(organizations)
    .values({
      id,
      displayName,
      createdByPrincipalId: input.principalId,
      attributes: input.attributes ?? {},
    })
    .returning();

  await grantMembership(db, {
    ownerId: organizationScopeId(id),
    subjectId: input.principalId,
    resourceKind: ORGANIZATION_RESOURCE_KIND,
    resourceId: "*",
    permissions: [...SCOPE_PERMISSIONS],
    purpose: undefined,
  });
  return row!;
}

/** Every organization this principal may currently act for. */
export async function listActingScopes(principalId: string): Promise<{
  personal: ActingScope;
  organizations: readonly { organizationId: string; displayName: string }[];
}> {
  const rows = await db
    .select({
      organizationId: organizations.id,
      displayName: organizations.displayName,
      state: memberships.state,
      status: organizations.status,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.ownerId))
    .where(
      and(
        eq(memberships.subjectId, principalId),
        eq(memberships.resourceKind, ORGANIZATION_RESOURCE_KIND),
      ),
    )
    .orderBy(desc(organizations.createdAt));

  return {
    personal: { kind: "PERSONAL", scopeId: principalId, principalId },
    organizations: rows
      .filter((row) => row.state === "active" && row.status === "active")
      .map((row) => ({ organizationId: row.organizationId, displayName: row.displayName })),
  };
}

/**
 * Does this principal hold this permission in this scope, right now?
 *
 * Personal scope is the principal's own: they hold everything in it and need
 * no grant. Every other scope is a membership lookup, which is where
 * revocation and expiry take effect — leaving an organization removes future
 * authority without touching a single historical record.
 */
export async function authorizeScopeAction(input: {
  principalId: string;
  scopeId: string;
  permission: ScopePermission;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; reason: string; code: string }> {
  if (input.scopeId === input.principalId) return { ok: true };
  const access = await checkMembershipAccess(db, {
    ownerId: input.scopeId,
    subjectId: input.principalId,
    resourceKind: ORGANIZATION_RESOURCE_KIND,
    resourceId: "*",
    permission: input.permission,
    ...(input.now ? { now: input.now } : {}),
  });
  return access.ok ? { ok: true } : { ok: false, reason: access.reason, code: access.code };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolving what a person meant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A REQUEST for an acting scope. Never a grant.
 *
 * `organizationId` is an exact reference; `organizationHint` is what the person
 * called it («شركة النور»), matched against organizations they actually belong
 * to. Neither can create standing that membership does not already give.
 */
export type ActingScopeRequest = {
  readonly intent: "PERSONAL" | "ORGANIZATION";
  readonly organizationId?: string;
  readonly organizationHint?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Continuity across turns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A conversation remembers WHICH SCOPE IT IS BEING CONDUCTED FOR. It never
 * remembers that the person may act there.
 *
 *   ESTABLISHED SCOPE != STANDING AUTHORITY
 *
 * So what is carried forward is an ordinary `ActingScopeRequest` — exactly the
 * thing a model is allowed to produce — and it goes through `resolveActingScope`
 * on every single turn. A membership revoked between two turns of one
 * conversation stops working on the next turn, because the remembered value
 * was never the permission.
 *
 * The key lives under `metadata.actingScope` on the conversation, which is
 * written by trusted server code after a resolution and by nothing else.
 */
export const CONVERSATION_SCOPE_KEY = "actingScope";

/**
 * What the conversation has established, as a request to re-resolve.
 *
 * Deliberately only `organizationId`: a hint is what somebody said once, and
 * re-matching stale words against a changed membership list is how a
 * conversation silently moves to a different organization. An exact reference
 * either still resolves or is denied.
 */
export function conversationScopeRequest(
  metadata: unknown,
): ActingScopeRequest | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const carried = (metadata as Record<string, unknown>)[CONVERSATION_SCOPE_KEY];
  if (!carried || typeof carried !== "object") return undefined;
  const organizationId = (carried as Record<string, unknown>).organizationId;
  if (typeof organizationId !== "string" || !organizationId.trim()) return undefined;
  return { intent: "ORGANIZATION", organizationId: organizationId.trim() };
}

/**
 * What the conversation should remember after a turn resolved.
 *
 * `null` means FORGET, and it is the answer for every outcome but an
 * organization that actually resolved:
 *
 *   PERSONAL     the person said personally; the conversation is personal now
 *   DENIED       the authority is gone — a remembered scope that can only be
 *                denied would lock the conversation out of the person's own
 *                work forever, and the denial itself is what tells them
 *   NEEDS_INPUT  nothing was established, so there is nothing to carry
 *
 * The one thing this never does is keep a scope that stopped resolving.
 */
export function conversationScopeMemory(
  resolution: ScopeResolution,
): { readonly organizationId: string } | null {
  if (resolution.status !== "RESOLVED") return null;
  if (resolution.scope.kind !== "ORGANIZATION") return null;
  return { organizationId: resolution.scope.organizationId };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

export async function resolveActingScope(input: {
  principalId: string;
  request?: ActingScopeRequest;
}): Promise<ScopeResolution> {
  const principalId = input.principalId?.trim();
  if (!principalId) throw new ActorScopeError("A principal is required.", "INVALID");

  // No request, or an explicitly personal one: the person's own scope. This is
  // the default, and it is the safe one — acting personally can never exceed
  // what the person themselves may do.
  if (!input.request || input.request.intent === "PERSONAL") {
    return {
      status: "RESOLVED",
      scope: { kind: "PERSONAL", scopeId: principalId, principalId },
    };
  }

  const available = await listActingScopes(principalId);

  // An exact reference. Membership decides, not the fact that they named it.
  if (input.request.organizationId) {
    const match = available.organizations.find(
      (entry) => entry.organizationId === input.request!.organizationId,
    );
    if (!match) {
      return {
        status: "DENIED",
        reason: "NO_MEMBERSHIP",
        message: "لا تملك صلاحية التصرف باسم هذه الجهة.",
      };
    }
    return {
      status: "RESOLVED",
      scope: {
        kind: "ORGANIZATION",
        scopeId: organizationScopeId(match.organizationId),
        principalId,
        organizationId: match.organizationId,
        displayName: match.displayName,
      },
    };
  }

  // A name, as the person said it.
  if (input.request.organizationHint) {
    const hint = normalize(input.request.organizationHint);
    const exact = available.organizations.filter(
      (entry) => normalize(entry.displayName) === hint,
    );
    const partial =
      exact.length > 0
        ? exact
        : available.organizations.filter(
            (entry) =>
              normalize(entry.displayName).includes(hint) ||
              hint.includes(normalize(entry.displayName)),
          );
    if (partial.length === 1) {
      const match = partial[0]!;
      return {
        status: "RESOLVED",
        scope: {
          kind: "ORGANIZATION",
          scopeId: organizationScopeId(match.organizationId),
          principalId,
          organizationId: match.organizationId,
          displayName: match.displayName,
        },
      };
    }
    if (partial.length === 0) {
      // Named something real to them and unknown to us, or something they have
      // no standing in. Both are DENIED rather than "did you mean": listing
      // organizations they are not in would leak who exists.
      return {
        status: "DENIED",
        reason: "NO_MATCHING_MEMBERSHIP",
        message: "لا أجد جهة بهذا الاسم تملك صلاحية التصرف باسمها.",
      };
    }
    return {
      status: "NEEDS_INPUT",
      reason: "AMBIGUOUS_ORGANIZATION",
      message: "أي جهة تقصد؟",
      candidates: partial,
    };
  }

  // «باسم شركتي» with nothing named.
  if (available.organizations.length === 1) {
    const only = available.organizations[0]!;
    return {
      status: "RESOLVED",
      scope: {
        kind: "ORGANIZATION",
        scopeId: organizationScopeId(only.organizationId),
        principalId,
        organizationId: only.organizationId,
        displayName: only.displayName,
      },
    };
  }
  if (available.organizations.length === 0) {
    return {
      status: "DENIED",
      reason: "NO_ORGANIZATION",
      message: "لا توجد جهة مسجّلة تملك صلاحية التصرف باسمها.",
    };
  }
  return {
    status: "NEEDS_INPUT",
    reason: "AMBIGUOUS_ORGANIZATION",
    message: "تنتمي إلى أكثر من جهة. أي واحدة تقصد؟",
    candidates: available.organizations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope-owned policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set a policy for a scope. Append-only and versioned.
 *
 * A new version is a NEW ROW, so "what was the rule when that decision was
 * made" stays answerable. Nothing here is commerce-shaped: a minimum price, a
 * maximum response time and an approved-vendor list are the same two columns.
 */
export async function setScopePolicy(input: {
  principalId: string;
  scopeId: string;
  policyKey: string;
  value: Record<string, unknown>;
}): Promise<ScopePolicy> {
  const policyKey = input.policyKey?.trim();
  if (!policyKey) throw new ActorScopeError("A policy needs a key.", "INVALID");
  assertNoScopeAuthorityClaim(input.value, "policy value");

  const allowed = await authorizeScopeAction({
    principalId: input.principalId,
    scopeId: input.scopeId,
    permission: "manage_policies",
  });
  if (!allowed.ok) {
    throw new ActorScopeError("Not permitted to set policy in this scope.", "FORBIDDEN");
  }

  const [latest] = await db
    .select({ version: scopePolicies.version })
    .from(scopePolicies)
    .where(and(eq(scopePolicies.scopeId, input.scopeId), eq(scopePolicies.policyKey, policyKey)))
    .orderBy(desc(scopePolicies.version))
    .limit(1);

  const [row] = await db
    .insert(scopePolicies)
    .values({
      id: `pol_${randomUUID()}`,
      scopeId: input.scopeId,
      policyKey,
      value: input.value,
      version: (latest?.version ?? 0) + 1,
      setByPrincipalId: input.principalId,
    })
    .returning();
  return row!;
}

/**
 * Read a scope's own policy. A private bound never leaves its scope.
 *
 * Authorisation is required for a READ, not only a write: «لا تنزل تحت 180» is
 * exactly the sentence a competitor must never obtain, and a policy readable
 * by anyone who knows a scope id would be a policy in name only.
 */
export async function getScopePolicy(input: {
  principalId: string;
  scopeId: string;
  policyKey: string;
}): Promise<ScopePolicy | undefined> {
  const allowed = await authorizeScopeAction({
    principalId: input.principalId,
    scopeId: input.scopeId,
    permission: "view",
  });
  if (!allowed.ok) {
    throw new ActorScopeError("Not permitted to read policy in this scope.", "FORBIDDEN");
  }
  const [row] = await db
    .select()
    .from(scopePolicies)
    .where(
      and(
        eq(scopePolicies.scopeId, input.scopeId),
        eq(scopePolicies.policyKey, input.policyKey.trim()),
        eq(scopePolicies.state, "active"),
      ),
    )
    .orderBy(desc(scopePolicies.version))
    .limit(1);
  return row;
}

/** Every version of one policy, oldest first. The audit trail. */
export async function scopePolicyHistory(input: {
  principalId: string;
  scopeId: string;
  policyKey: string;
}): Promise<readonly ScopePolicy[]> {
  const allowed = await authorizeScopeAction({
    principalId: input.principalId,
    scopeId: input.scopeId,
    permission: "view",
  });
  if (!allowed.ok) {
    throw new ActorScopeError("Not permitted to read policy in this scope.", "FORBIDDEN");
  }
  return db
    .select()
    .from(scopePolicies)
    .where(
      and(
        eq(scopePolicies.scopeId, input.scopeId),
        eq(scopePolicies.policyKey, input.policyKey.trim()),
      ),
    )
    .orderBy(scopePolicies.version);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope-owned provider bindings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bind a provider to a scope.
 *
 * `credentialEnvName` is a NAME. The secret lives in the environment and never
 * in this table, in a log, in a model prompt or in a Presentation IR.
 */
export async function bindScopeProvider(input: {
  principalId: string;
  scopeId: string;
  providerClass: string;
  providerId: string;
  credentialEnvName?: string;
}): Promise<{ id: string }> {
  const allowed = await authorizeScopeAction({
    principalId: input.principalId,
    scopeId: input.scopeId,
    permission: "manage_providers",
  });
  if (!allowed.ok) {
    throw new ActorScopeError("Not permitted to bind providers in this scope.", "FORBIDDEN");
  }
  // ── THE CLASS THE MODERN RUNTIME OWNS ────────────────────────────────────
  //
  //   LEGACY_BINDING != MODERN_CONNECTOR_BINDING
  //   LEGACY_STATE != MODERN_LIFECYCLE
  //   SAME_TABLE != SAME_RUNTIME
  //
  // Two runtimes share this table and are told apart by `lifecycle`: NULL is a
  // legacy environment-name binding, anything else is a connection the provider
  // binding runtime owns through its own ceremony. The modern runtime writes
  // exactly one `providerClass`, `"connector"` — so that string is its identity
  // namespace, and a legacy bind naming it would have conflicted with a real
  // connection and updated it: `state` back to «active», `revokedAt` cleared,
  // the credential NAME overwritten, and `lifecycle` left untouched. A SUSPENDED
  // connection would have read as active to this path while the connector
  // runtime went on refusing it.
  //
  //   LEGACY_AUTHORITY_ACT != MODERN_BINDING_MUTATION_AUTHORITY
  //
  // Refused here, before any statement runs, because the tuple is what the
  // identity index arbitrates on: a legacy row that can never carry this class
  // can never be the same row as a connection.
  const providerClass = input.providerClass.trim();
  if (providerClass === CONNECTOR_PROVIDER_CLASS) {
    throw new ActorScopeError(
      "Connections to registered systems are made through provider setup, not here.",
      "INVALID",
    );
  }
  const credentialEnvName = input.credentialEnvName?.trim() ?? null;
  // A CANDIDATE id, not the answer.
  //
  // This is an upsert, so one of two rows ends up carrying this binding and only
  // the database knows which: the one inserted under this candidate id, or the
  // live one that was already there. Returning the candidate regardless meant
  // that on the conflict path the caller was handed an id no row carries — and
  // `provider.bind`'s own readback, which looks the row up BY that id, then
  // reported `occurred: false` for a write that had just succeeded.
  //
  //   RETURNED_REFERENCE MUST NAME DURABLE_STATE
  //   UPSERT_RESULT != PREGENERATED_INPUT_ID
  //   CONFLICT_UPDATE != NEW_BINDING_IDENTITY
  //   WRITE_SUCCEEDED != READBACK_SUCCEEDED
  const candidateId = `bind_${randomUUID()}`;
  const [persisted] = await db
    .insert(scopeProviderBindings)
    .values({
      id: candidateId,
      scopeId: input.scopeId,
      providerClass,
      providerId: input.providerId.trim(),
      credentialEnvName,
      boundByPrincipalId: input.principalId,
    })
    .onConflictDoUpdate({
      target: [
        scopeProviderBindings.scopeId,
        scopeProviderBindings.providerClass,
        scopeProviderBindings.providerId,
      ],
      // The identity index is PARTIAL — it constrains live rows only, so that a
      // revoked connection stays as history instead of being a slot somebody
      // reconnects into. Postgres infers a partial index as the arbiter only
      // when the statement repeats its predicate, so this names the same one.
      // Without it this upsert would stop finding any arbiter at all.
      //
      //   REVOKED_BINDING_IDENTITY_IS_TERMINAL
      targetWhere: sql`${scopeProviderBindings.lifecycle} IS DISTINCT FROM 'REVOKED'`,
      // THE DATABASE'S OWN COPY OF THE SAME BOUNDARY.
      //
      // The check above is a string comparison in this process; this is the
      // invariant itself, applied by the statement that would do the damage. A
      // row the connector runtime owns carries a lifecycle, so this UPDATE
      // cannot touch one — and Postgres then returns no row, which the guard
      // below reads as a refusal rather than as success.
      //
      //   LEGACY_BIND_MUTATES_MODERN_ROW = 0
      setWhere: isNull(scopeProviderBindings.lifecycle),
      set: {
        state: "active",
        revokedAt: null,
        boundByPrincipalId: input.principalId,
        // THE NAME THE CALLER ACTUALLY STATED.
        //
        // The conflict branch used not to write this, so re-binding with a new
        // variable kept the old one — and `provider.bind`'s readback, which
        // reports «reading <name>», would have stated a name the person had just
        // replaced. That was invisible while the readback could not find the row
        // at all; fixing the id above is what makes it observable, so it is
        // fixed in the same breath rather than turned into a quiet one.
        //
        //   READBACK_REPORTS_SUPERSEDED_CREDENTIAL_NAME = 0
        //
        // Both paths now store exactly what this call said, including «none».
        credentialEnvName,
      },
    })
    // Postgres RETURNING on `DO UPDATE` yields the row as written, whichever
    // branch ran. So the canonical id comes from the write itself — not from a
    // second lookup, a «latest» heuristic or an approximate search.
    .returning({ id: scopeProviderBindings.id });
  if (!persisted) {
    // `DO UPDATE` returns its row, so the only way here is the `setWhere` above
    // declining: the live row for this tuple belongs to the connector runtime.
    // Nothing was written, and nothing is reported as though it had been.
    //
    //   A REFERENCE TO NOTHING != SUCCESS
    //   LEGACY_BIND_MODERN_COLLISION_REPORTS_SUCCESS = 0
    throw new ActorScopeError(
      "That system is connected through provider setup, and is not this binding's to change.",
      "INVALID",
    );
  }
  return { id: persisted.id };
}

/**
 * The binding a scope may use, or nothing.
 *
 * Scoped by construction: there is no fallback to another scope's binding and
 * no inheritance from a person to their employer. A business that has not
 * connected a provider does not have one, however many its members have.
 */
export async function resolveScopeProvider(input: {
  scopeId: string;
  providerClass: string;
}): Promise<{ providerId: string; credentialEnvName: string | null } | undefined> {
  const [row] = await db
    .select()
    .from(scopeProviderBindings)
    .where(
      and(
        eq(scopeProviderBindings.scopeId, input.scopeId),
        eq(scopeProviderBindings.providerClass, input.providerClass),
        eq(scopeProviderBindings.state, "active"),
        // LEGACY ROWS ONLY. A VERIFIED connection also carries `state: "active"`,
        // so without this the legacy resolver would report a connector row — and
        // `credentialEnvName` is NULL on one, because a real connection's
        // credential is sealed in the vault and was never an environment name.
        //
        //   LEGACY_RESOLVER_RESOLVES_MODERN_ROW = 0
        isNull(scopeProviderBindings.lifecycle),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  return { providerId: row.providerId, credentialEnvName: row.credentialEnvName };
}
