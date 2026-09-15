/**
 * Block 2 — DelegationGrant: bounded, purpose-bound authority from a
 * principal to a delegate.
 *
 * Permanent invariant: CHILD_DELEGATED_AUTHORITY ⊆ PARENT_AUTHORITY.
 * Subset validation is fully deterministic — an LLM never approves an
 * authority expansion. Revalidation happens at EXECUTION time (not only at
 * creation): scheduled work re-checks state, expiry, revocation, scope,
 * purpose, and fingerprint before any effect.
 *
 * Revocation affects future effects only; it never rewrites Attempt history.
 */

import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  delegationGrants,
  type DelegationGrant,
} from "@db/schema";
import type { Block2Db } from "./temporal";

export type DelegationErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "EXPIRED"
  | "REVOKED"
  | "NOT_YET_VALID"
  | "CAPABILITY_NOT_DELEGATED"
  | "CAPABILITY_DENIED"
  | "PURPOSE_MISMATCH"
  | "RESOURCE_OUT_OF_SCOPE"
  | "MONETARY_LIMIT_EXCEEDED"
  | "CURRENCY_REQUIRED"
  | "CURRENCY_MISMATCH"
  | "CONSTRAINT_VIOLATION"
  | "CONSTRAINT_UNVERIFIABLE"
  | "QUANTITY_EXCEEDED"
  | "DEPTH_EXCEEDED"
  | "AUTHORITY_EXPANSION"
  | "FINGERPRINT_MISMATCH"
  | "INVALID";

export class DelegationError extends Error {
  readonly code: DelegationErrorCode;

  constructor(message: string, code: DelegationErrorCode) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Canonical fingerprint — staleness/replay protection
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/**
 * Canonicalize a monetary string across the numeric(24,6) DB round-trip
 * ("100" stores and returns as "100.000000"). Trailing-zero strip keeps the
 * fingerprint stable between create-time terms and row-time terms.
 */
function canonicalMonetary(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const normalized = trimmed.includes(".")
    ? trimmed.replace(/0+$/, "").replace(/\.$/, "")
    : trimmed;
  return normalized === "" || normalized === "-" ? "0" : normalized;
}

export function delegationFingerprint(terms: {
  principalOwnerId: string;
  delegateId: string;
  purpose: string;
  allowedCapabilities: string[];
  deniedCapabilities: string[];
  resourceScope: { kinds?: string[]; ids?: string[] };
  maxMonetary: string | null;
  currency: string | null;
  validFrom: string;
  expiresAt: string | null;
  maxDepth: number;
  parentGrantId: string | null;
}): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        ...terms,
        allowedCapabilities: [...terms.allowedCapabilities].sort(),
        deniedCapabilities: [...terms.deniedCapabilities].sort(),
        maxMonetary: canonicalMonetary(terms.maxMonetary),
      }),
    )
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Subset validation (CHILD ⊆ PARENT) — deterministic, no model involved
// ---------------------------------------------------------------------------

function isSubset(child: string[], parent: string[]): boolean {
  const parentSet = new Set(parent);
  return child.every((item) => parentSet.has(item));
}

function scopeSubset(
  child: { kinds?: string[]; ids?: string[] },
  parent: { kinds?: string[]; ids?: string[] },
): boolean {
  // Empty list = unconstrained (whole dimension). A child may only be
  // unconstrained where the parent is unconstrained.
  const childKinds = child.kinds ?? [];
  const parentKinds = parent.kinds ?? [];
  const childIds = child.ids ?? [];
  const parentIds = parent.ids ?? [];
  if (childKinds.length === 0 && parentKinds.length > 0) return false;
  if (childIds.length === 0 && parentIds.length > 0) return false;
  return isSubset(childKinds, parentKinds) && isSubset(childIds, parentIds);
}

/**
 * Exact decimal comparison without float conversion. Both sides normalize to
 * the numeric(24,6) column scale and compare as integers — money never goes
 * through Number() on the authority path.
 */
const MONETARY_COMPARE_SCALE = 6;

function parseScaledDecimal(value: string, scale = MONETARY_COMPARE_SCALE): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const fracRaw = match[3] ?? "";
  if (fracRaw.length > scale) return null; // precision beyond the column scale
  const frac = fracRaw.padEnd(scale, "0");
  const scaled = BigInt(match[2]) * 10n ** BigInt(scale) + BigInt(frac);
  return match[1] === "-" ? -scaled : scaled;
}

function monetaryWithin(child: string | null, parent: string | null): boolean {
  if (parent === null) return true; // parent unconstrained
  if (child === null) return false; // child unconstrained ⊄ bounded parent
  const childScaled = parseScaledDecimal(child);
  const parentScaled = parseScaledDecimal(canonicalMonetary(parent) ?? parent);
  if (childScaled === null || parentScaled === null) return false; // fail closed
  return childScaled <= parentScaled;
}

function asStringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export type CreateDelegationGrantInput = {
  principalOwnerId: string;
  delegateId: string;
  delegateKind?: "user" | "agent" | "remote_agent";
  purpose: string;
  allowedCapabilities: string[];
  deniedCapabilities?: string[];
  resourceScope?: { kinds?: string[]; ids?: string[] };
  constraints?: Record<string, unknown>;
  /** Exact decimal string preferred; a number is accepted but stringified as-is. */
  maxMonetary?: number | string | null;
  currency?: string | null;
  validFrom?: Date;
  expiresAt?: Date | null;
  maxDepth?: number;
  /** Present ⇒ this is a sub-delegation requiring CHILD ⊆ PARENT proof. */
  parentGrantId?: string | null;
  now?: Date;
};

export async function createDelegationGrant(
  db: Block2Db,
  input: CreateDelegationGrantInput,
): Promise<DelegationGrant> {
  const now = input.now ?? new Date();
  if (input.allowedCapabilities.length === 0) {
    throw new DelegationError("A grant must delegate at least one capability", "INVALID");
  }
  const validFrom = input.validFrom ?? now;
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt && expiresAt.getTime() <= validFrom.getTime()) {
    throw new DelegationError("expiresAt must be after validFrom", "INVALID");
  }
  const maxDepth = Math.max(0, input.maxDepth ?? 0);
  let depth = 0;

  // INC-1: monetary authority is meaningless without a currency — creation
  // fails closed. Currency is normalized so fingerprint/storage agree.
  const currency =
    typeof input.currency === "string" && input.currency.trim() !== ""
      ? input.currency.trim().toUpperCase()
      : null;
  if (input.maxMonetary !== undefined && input.maxMonetary !== null) {
    if (!currency) {
      throw new DelegationError(
        "Monetary authority requires an explicit currency (no money without currency)",
        "CURRENCY_REQUIRED",
      );
    }
    if (parseScaledDecimal(String(input.maxMonetary)) === null) {
      throw new DelegationError("maxMonetary must be an exact decimal within numeric(24,6)", "INVALID");
    }
  }
  if (currency !== null && !/^[A-Z0-9]{3,8}$/.test(currency)) {
    throw new DelegationError("Currency must be a 3-8 character uppercase code", "INVALID");
  }

  if (input.parentGrantId) {
    const parent = await getDelegationGrant(db, input.parentGrantId);
    if (!parent) throw new DelegationError("Parent grant not found", "NOT_FOUND");
    // Only the parent's delegate may sub-delegate its (bounded) authority.
    if (parent.delegateId !== input.principalOwnerId) {
      throw new DelegationError(
        "Sub-delegation principal must be the parent delegate (cross-owner delegation blocked)",
        "FORBIDDEN",
      );
    }
    assertGrantUsable(parent, now);
    depth = parent.depth + 1;
    if (depth > parent.maxDepth) {
      throw new DelegationError("Delegation depth overflow", "DEPTH_EXCEEDED");
    }
    if (depth + maxDepth > parent.maxDepth) {
      throw new DelegationError("Child maxDepth exceeds remaining parent depth", "DEPTH_EXCEEDED");
    }
    // Monotonicity: every dimension of the child must be a subset.
    const denied = input.deniedCapabilities ?? [];
    const effectiveChild = input.allowedCapabilities.filter((c) => !denied.includes(c));
    if (!isSubset(effectiveChild, parent.allowedCapabilities)) {
      throw new DelegationError("Child capabilities are not a subset of parent", "AUTHORITY_EXPANSION");
    }
    if (input.purpose !== parent.purpose) {
      throw new DelegationError("Child purpose must equal parent purpose", "PURPOSE_MISMATCH");
    }
    if (!scopeSubset(input.resourceScope ?? {}, parent.resourceScope)) {
      throw new DelegationError("Child resource scope exceeds parent scope", "AUTHORITY_EXPANSION");
    }
    const childMonetary = input.maxMonetary !== undefined && input.maxMonetary !== null ? String(input.maxMonetary) : null;
    if (!monetaryWithin(childMonetary, parent.maxMonetary)) {
      throw new DelegationError("Child monetary limit exceeds parent limit", "MONETARY_LIMIT_EXCEEDED");
    }
    // INC-2: currency belongs to the authority subset relation. A child of a
    // currency-bound parent must carry exactly that currency — an absent or
    // different currency is an authority expansion.
    if (parent.currency) {
      if (!currency) {
        throw new DelegationError("Child must inherit the parent's currency", "CURRENCY_MISMATCH");
      }
      if (currency !== parent.currency) {
        throw new DelegationError("Child currency differs from parent", "AUTHORITY_EXPANSION");
      }
    }
    // Constraints subset: the child must carry every parent constraint with an
    // equal value (it may ADD stricter keys, never relax or drop parent ones).
    const parentConstraints = (parent.constraints ?? {}) as Record<string, unknown>;
    const childConstraints = (input.constraints ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parentConstraints)) {
      if (
        !(key in childConstraints) ||
        JSON.stringify(childConstraints[key]) !== JSON.stringify(value)
      ) {
        throw new DelegationError("Child constraints relax parent constraints", "AUTHORITY_EXPANSION");
      }
    }
    if (validFrom.getTime() < parent.validFrom.getTime()) {
      throw new DelegationError("Child validFrom precedes parent validFrom", "AUTHORITY_EXPANSION");
    }
    if (parent.expiresAt && (!expiresAt || expiresAt.getTime() > parent.expiresAt.getTime())) {
      throw new DelegationError("Child time scope exceeds parent", "AUTHORITY_EXPANSION");
    }
  }

  const fingerprint = delegationFingerprint({
    principalOwnerId: input.principalOwnerId,
    delegateId: input.delegateId,
    purpose: input.purpose,
    allowedCapabilities: input.allowedCapabilities,
    deniedCapabilities: input.deniedCapabilities ?? [],
    resourceScope: input.resourceScope ?? {},
    maxMonetary: canonicalMonetary(input.maxMonetary != null ? String(input.maxMonetary) : null),
    currency,
    validFrom: validFrom.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    maxDepth,
    parentGrantId: input.parentGrantId ?? null,
  });

  const rows = await db
    .insert(delegationGrants)
    .values({
      id: `dlg_${randomUUID()}`,
      principalOwnerId: input.principalOwnerId,
      delegateId: input.delegateId,
      delegateKind: input.delegateKind ?? "agent",
      purpose: input.purpose,
      allowedCapabilities: input.allowedCapabilities,
      deniedCapabilities: input.deniedCapabilities ?? [],
      resourceScope: input.resourceScope ?? {},
      constraints: input.constraints ?? {},
      maxMonetary: input.maxMonetary != null ? String(input.maxMonetary) : null,
      currency,
      validFrom,
      expiresAt,
      maxDepth,
      depth,
      parentGrantId: input.parentGrantId ?? null,
      state: "active",
      fingerprint,
    })
    .returning();
  return rows[0]!;
}

// ---------------------------------------------------------------------------
// Execution-time revalidation
// ---------------------------------------------------------------------------

function assertGrantUsable(grant: DelegationGrant, now: Date): void {
  if (grant.state === "revoked") throw new DelegationError("Grant revoked", "REVOKED");
  if (grant.state === "expired") throw new DelegationError("Grant expired", "EXPIRED");
  if (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime()) {
    throw new DelegationError("Grant expired", "EXPIRED");
  }
  if (grant.validFrom.getTime() > now.getTime()) {
    throw new DelegationError("Grant not yet valid", "NOT_YET_VALID");
  }
  // Fingerprint staleness: recomputed terms must match the stored digest.
  const recomputed = delegationFingerprint({
    principalOwnerId: grant.principalOwnerId,
    delegateId: grant.delegateId,
    purpose: grant.purpose,
    allowedCapabilities: grant.allowedCapabilities,
    deniedCapabilities: grant.deniedCapabilities,
    resourceScope: grant.resourceScope,
    maxMonetary: canonicalMonetary(grant.maxMonetary),
    currency: grant.currency,
    validFrom: grant.validFrom.toISOString(),
    expiresAt: grant.expiresAt ? grant.expiresAt.toISOString() : null,
    maxDepth: grant.maxDepth,
    parentGrantId: grant.parentGrantId,
  });
  if (recomputed !== grant.fingerprint) {
    throw new DelegationError("Grant fingerprint mismatch", "FINGERPRINT_MISMATCH");
  }
}

export type DelegationCheck = {
  ok: boolean;
  reason?: string;
  code?: DelegationError["code"];
};

/**
 * INC-3 execution-time financial context. Known financial constraint keys
 * (allowedPayees/deniedPayees, allowedProviders/deniedProviders,
 * allowedPaymentMethods/deniedPaymentMethods, allowedCategories/
 * deniedCategories, maxQuantity) are re-evaluated against this context at
 * execution time — fail closed when a constraint cannot be verified. Unknown
 * constraint keys remain creation-time-only (creation already enforces
 * non-relaxation), so non-financial constraints keep Block 2 behavior.
 */
export type DelegationExecutionContext = {
  /** Currency of the attempted effect; must equal the grant currency. */
  currency?: string;
  payeeRef?: string;
  providerRef?: string;
  paymentMethodRef?: string;
  category?: string;
  quantity?: number;
};

/**
 * Revalidate at execution time. Scheduled execution MUST call this at wake —
 * creation-time approval is never sufficient.
 */
export async function revalidateDelegationGrant(
  db: Block2Db,
  input: {
    grantId: string;
    delegateId: string;
    capability: string;
    purpose: string;
    resourceRef?: { kind: string; id: string };
    /** Legacy numeric amount; prefer monetaryAmountExact (decimal string). */
    monetaryAmount?: number;
    /** Exact decimal-string amount for the financial check. */
    monetaryAmountExact?: string;
    context?: DelegationExecutionContext;
    now?: Date;
  },
): Promise<DelegationCheck> {
  const now = input.now ?? new Date();
  const grant = await getDelegationGrant(db, input.grantId);
  if (!grant) return { ok: false, reason: "Grant not found", code: "NOT_FOUND" };
  if (grant.delegateId !== input.delegateId) {
    return { ok: false, reason: "Delegate mismatch", code: "FORBIDDEN" };
  }
  try {
    assertGrantUsable(grant, now);
    // Ancestor-chain authority: a grant is usable only while EVERY ancestor
    // is usable — revoking/expiring a root must block the whole subtree at
    // execution time, not just future sub-delegation.
    let ancestorId = grant.parentGrantId;
    const visited = new Set<string>([grant.id]);
    while (ancestorId) {
      if (visited.has(ancestorId)) {
        return { ok: false, reason: "Delegation chain cycle detected", code: "INVALID" };
      }
      visited.add(ancestorId);
      const ancestor = await getDelegationGrant(db, ancestorId);
      if (!ancestor) {
        return { ok: false, reason: "Delegation ancestor missing", code: "NOT_FOUND" };
      }
      assertGrantUsable(ancestor, now);
      ancestorId = ancestor.parentGrantId;
    }
  } catch (error) {
    if (error instanceof DelegationError) {
      return { ok: false, reason: error.message, code: error.code };
    }
    throw error;
  }
  if (grant.deniedCapabilities.includes(input.capability)) {
    return { ok: false, reason: "Capability explicitly denied", code: "CAPABILITY_DENIED" };
  }
  if (!grant.allowedCapabilities.includes(input.capability)) {
    return { ok: false, reason: "Capability not delegated", code: "CAPABILITY_NOT_DELEGATED" };
  }
  if (grant.purpose !== input.purpose) {
    return { ok: false, reason: "Purpose mismatch", code: "PURPOSE_MISMATCH" };
  }
  if (input.resourceRef) {
    const kinds = grant.resourceScope.kinds ?? [];
    const ids = grant.resourceScope.ids ?? [];
    if (kinds.length > 0 && !kinds.includes(input.resourceRef.kind)) {
      return { ok: false, reason: "Resource kind out of scope", code: "RESOURCE_OUT_OF_SCOPE" };
    }
    if (ids.length > 0 && !ids.includes(input.resourceRef.id)) {
      return { ok: false, reason: "Resource id out of scope", code: "RESOURCE_OUT_OF_SCOPE" };
    }
  }
  // INC-3: financial terms re-evaluated at execution time.
  const context = input.context;
  const amountExact =
    input.monetaryAmountExact ??
    (input.monetaryAmount !== undefined ? String(input.monetaryAmount) : undefined);
  if (grant.currency) {
    if (context?.currency !== undefined && context.currency !== grant.currency) {
      return {
        ok: false,
        reason: "Execution currency differs from grant currency",
        code: "CURRENCY_MISMATCH",
      };
    }
    if (amountExact !== undefined && context?.currency === undefined) {
      return {
        ok: false,
        reason: "Monetary execution requires an explicit currency context",
        code: "CURRENCY_MISMATCH",
      };
    }
  }
  if (amountExact !== undefined && grant.maxMonetary !== null) {
    const amount = parseScaledDecimal(amountExact);
    const limit = parseScaledDecimal(canonicalMonetary(grant.maxMonetary) ?? grant.maxMonetary);
    if (amount === null || limit === null) {
      return { ok: false, reason: "Unparseable monetary amount", code: "INVALID" };
    }
    if (amount > limit) {
      return { ok: false, reason: "Monetary limit exceeded", code: "MONETARY_LIMIT_EXCEEDED" };
    }
  }
  const constraints = (grant.constraints ?? {}) as Record<string, unknown>;
  const dimensions = [
    { allowKey: "allowedPayees", denyKey: "deniedPayees", value: context?.payeeRef, label: "payee" },
    { allowKey: "allowedProviders", denyKey: "deniedProviders", value: context?.providerRef, label: "provider" },
    { allowKey: "allowedPaymentMethods", denyKey: "deniedPaymentMethods", value: context?.paymentMethodRef, label: "payment method" },
    { allowKey: "allowedCategories", denyKey: "deniedCategories", value: context?.category, label: "category" },
  ] as const;
  for (const dimension of dimensions) {
    const denied = asStringList(constraints[dimension.denyKey]);
    if (denied && dimension.value !== undefined && denied.includes(dimension.value)) {
      return {
        ok: false,
        reason: `${dimension.label} is denied by grant constraints`,
        code: "CONSTRAINT_VIOLATION",
      };
    }
    const allowed = asStringList(constraints[dimension.allowKey]);
    if (allowed && allowed.length > 0) {
      if (dimension.value === undefined) {
        return {
          ok: false,
          reason: `${dimension.label} constraint cannot be verified without execution context`,
          code: "CONSTRAINT_UNVERIFIABLE",
        };
      }
      if (!allowed.includes(dimension.value)) {
        return {
          ok: false,
          reason: `${dimension.label} outside grant constraints`,
          code: "CONSTRAINT_VIOLATION",
        };
      }
    }
  }
  if (constraints.maxQuantity !== undefined) {
    const maxQuantity = constraints.maxQuantity;
    if (typeof maxQuantity !== "number" || !Number.isFinite(maxQuantity) || maxQuantity < 0) {
      return { ok: false, reason: "Malformed maxQuantity constraint", code: "CONSTRAINT_VIOLATION" };
    }
    if (context?.quantity === undefined) {
      return {
        ok: false,
        reason: "Quantity constraint cannot be verified without execution context",
        code: "CONSTRAINT_UNVERIFIABLE",
      };
    }
    if (context.quantity > maxQuantity) {
      return { ok: false, reason: "Quantity exceeds grant constraint", code: "QUANTITY_EXCEEDED" };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Revocation + queries
// ---------------------------------------------------------------------------

export async function revokeDelegationGrant(
  db: Block2Db,
  input: { grantId: string; actorOwnerId: string; now?: Date },
): Promise<DelegationGrant> {
  const now = input.now ?? new Date();
  const grant = await getDelegationGrant(db, input.grantId);
  if (!grant) throw new DelegationError("Grant not found", "NOT_FOUND");
  if (grant.principalOwnerId !== input.actorOwnerId) {
    throw new DelegationError("Only the principal may revoke", "FORBIDDEN");
  }
  if (grant.state !== "active") return grant;
  const rows = await db
    .update(delegationGrants)
    .set({ state: "revoked", revokedAt: now })
    .where(and(eq(delegationGrants.id, grant.id), eq(delegationGrants.state, "active")))
    .returning();
  return rows[0] ?? grant;
}

export async function getDelegationGrant(
  db: Block2Db,
  grantId: string,
): Promise<DelegationGrant | undefined> {
  const rows = await db.select().from(delegationGrants).where(eq(delegationGrants.id, grantId)).limit(1);
  return rows[0];
}

export async function listDelegationGrants(
  db: Block2Db,
  filter: { principalOwnerId?: string; delegateId?: string },
): Promise<DelegationGrant[]> {
  const conditions = [];
  if (filter.principalOwnerId) conditions.push(eq(delegationGrants.principalOwnerId, filter.principalOwnerId));
  if (filter.delegateId) conditions.push(eq(delegationGrants.delegateId, filter.delegateId));
  return db
    .select()
    .from(delegationGrants)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
}
