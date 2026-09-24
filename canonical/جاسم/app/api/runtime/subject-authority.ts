/**
 * WHO MAY SPEAK FOR A FACT ABOUT THIS THING?
 *
 *   NEW SUBJECT KIND != NEW DOMAIN
 *   ARBITRARY SUBJECT ID != AUTHORITY
 *   MODEL-NAMED ACTOR   != AUTHORITY
 *   LATEST PARTICIPANT  != AUTHORITY
 *
 *   AUTHORITY_TO_ANSWER  != AUTHORITY_TO_MUTATE
 *   AUTHORITY_TO_CONFIRM != AUTHORITY_TO_ACCEPT
 *
 * The answer comes from the CANONICAL ROW and from nowhere else — not from a
 * conversation, not from a model, not from whoever spoke most recently.
 *
 * WHY THIS IS A REGISTRY AND NOT A SWITCH. JASIM's canonical subjects do not
 * share one ownership shape, and pretending they do would be the lie. Four
 * genuinely different shapes exist:
 *
 *   ONE OWNER      an offering belongs to somebody
 *   CAPACITY OWNER a window of availability is offered BY somebody
 *   TWO SIDES      a reservation has a requester AND a capacity owner, and
 *                  which of them may answer depends on WHAT is asked
 *   MANY PARTIES   an exchange has parties, none of them privileged
 *
 * So the registry is keyed by CANONICAL SUBJECT KIND, which is a structural
 * fact, and never by a business noun. There is no `car`, no `garment` and no
 * `venue` here, and adding one would not be an extension of this design but an
 * abandonment of it.
 *
 *   DOMAIN_SUBJECT_AUTHORITY_HANDLERS_ADDED = 0
 *
 * WHAT THIS DOES NOT DECIDE. Whether their answer is TRUE. That stays with the
 * observation and verification runtimes, exactly as before. This module says
 * only who may be asked.
 */

import { eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { availabilityWindows, reservations, transactions } from "@db/schema-block2";
import { economicExpressions } from "@db/schema";

/**
 * The standing somebody has toward a subject.
 *
 * Three relations, each a structural fact about a canonical row. A role is not
 * a permission and not a job title: it is «what this row says you are to it».
 */
export const SUBJECT_ROLES = ["SUBJECT_OWNER", "CAPACITY_OWNER", "PARTICIPANT"] as const;
export type SubjectRole = (typeof SUBJECT_ROLES)[number];

export type SubjectStanding = {
  /** Every scope in each role, read from the subject's own row. */
  readonly roles: Readonly<Partial<Record<SubjectRole, readonly string[]>>>;
  /** The subject's revision, when it versions. */
  readonly revision: string | null;
};

/**
 * ONE ADAPTER PER CANONICAL SUBJECT KIND.
 *
 * `roles` reads the row. `propertyAuthority` names the roles entitled to speak
 * for a particular property WHERE THE SHAPE REQUIRES IT — which is the point of
 * a two-sided subject: the side that supplies capacity knows whether capacity
 * remains, and the side that requested it knows their own intent. Neither can
 * answer for the other.
 *
 *   AUTHORITY DEPENDS ON THE FACT, not only on the thing.
 */
type SubjectAdapter = {
  readonly read: (subjectId: string) => Promise<SubjectStanding | null>;
  /** Roles that may answer a named property. Absent → `defaultRoles`. */
  readonly propertyAuthority?: Readonly<Record<string, readonly SubjectRole[]>>;
  readonly defaultRoles: readonly SubjectRole[];
};

const unique = (values: readonly (string | null | undefined)[]): readonly string[] =>
  [...new Set(values.filter((value): value is string => Boolean(value)).map(String))];

/**
 * The registry.
 *
 * Deliberately NOT exhaustive over every canonical table. A kind is here only
 * when a person can honestly answer a question about it, and leaving one out is
 * a decision rather than an oversight — see `NOT_VERIFIABLE_BY_DESIGN` below.
 */
const CANONICAL_SUBJECTS: Readonly<Record<string, SubjectAdapter>> = Object.freeze({
  // ONE OWNER. Somebody published it; they speak for it.
  offering: {
    read: async (subjectId) => {
      const [row] = await db
        .select({
          ownerId: economicExpressions.ownerId,
          version: economicExpressions.version,
          status: economicExpressions.status,
        })
        .from(economicExpressions)
        .where(eq(economicExpressions.id, subjectId))
        .limit(1);
      if (!row || row.status === "closed") return null;
      return {
        roles: { SUBJECT_OWNER: unique([String(row.ownerId)]) },
        revision: String(row.version),
      };
    },
    defaultRoles: ["SUBJECT_OWNER"],
  },

  // CAPACITY OWNER. A window of availability is offered BY somebody, and they
  // are the one who knows whether it still stands.
  availability_window: {
    read: async (subjectId) => {
      const [row] = await db
        .select({ ownerId: availabilityWindows.ownerId, state: availabilityWindows.state })
        .from(availabilityWindows)
        .where(eq(availabilityWindows.id, subjectId))
        .limit(1);
      if (!row || row.state === "closed") return null;
      return { roles: { CAPACITY_OWNER: unique([String(row.ownerId)]) }, revision: null };
    },
    defaultRoles: ["CAPACITY_OWNER"],
  },

  // TWO SIDES, and which of them may answer depends on WHAT is asked. This is
  // the shape that makes property-specific authority necessary rather than
  // decorative.
  reservation: {
    read: async (subjectId) => {
      const [row] = await db
        .select({
          ownerId: reservations.ownerId,
          resourceOwnerId: reservations.resourceOwnerId,
          status: reservations.status,
          version: reservations.version,
        })
        .from(reservations)
        .where(eq(reservations.id, subjectId))
        .limit(1);
      if (!row) return null;
      return {
        roles: {
          // The party who asked for it.
          SUBJECT_OWNER: unique([String(row.ownerId)]),
          // The party whose capacity it holds.
          CAPACITY_OWNER: unique([String(row.resourceOwnerId)]),
        },
        revision: String(row.version),
      };
    },
    propertyAuthority: {
      // Whether the capacity is still there is the supplying side's to say.
      availability: ["CAPACITY_OWNER"],
      // Whether they still intend to use it is the requesting side's.
      attendance: ["SUBJECT_OWNER"],
    },
    defaultRoles: ["CAPACITY_OWNER"],
  },

  // MANY PARTIES, none privileged. Any party may be ASKED about the exchange
  // they are in — which says nothing whatever about whether they are right.
  //
  //   TRANSACTION_PARTICIPANT_RESPONSE_AUTO_VERIFIED = 0
  transaction: {
    read: async (subjectId) => {
      const [row] = await db
        .select({
          scopeId: transactions.scopeId,
          parties: transactions.parties,
          state: transactions.state,
        })
        .from(transactions)
        .where(eq(transactions.id, subjectId))
        .limit(1);
      if (!row || row.state !== "OPEN") return null;
      return {
        roles: { PARTICIPANT: unique([String(row.scopeId), ...(row.parties ?? [])]) },
        revision: null,
      };
    },
    defaultRoles: ["PARTICIPANT"],
  },
});

/**
 * Kinds deliberately absent, and why.
 *
 * Each one is a place where asking a person would be a BACKDOOR around a
 * runtime that already owns the decision. Listing them makes the omission a
 * statement rather than a gap somebody forgot to fill.
 */
export const NOT_VERIFIABLE_BY_DESIGN: Readonly<Record<string, string>> = Object.freeze({
  // «Do you accept?» is an acceptance, and acceptance belongs to the agreement
  // runtime, with its envelope, its authority basis and its record. Routing it
  // through a question would be negotiation through the verification channel.
  //
  //   VERIFICATION_AUTHORITY_BYPASSES_AGREEMENT_RUNTIME = 0
  agreement: "Acceptance is the agreement runtime's, not a question's.",
  proposal: "Accepting or countering a proposal is the agreement runtime's.",
  commitment: "Whether an obligation was discharged is verification's, not an assertion's.",
  // A handle is a way of pointing at something. It confers nothing.
  //
  //   LIVING_OBJECT != SUBJECT_AUTHORITY
  living_object: "A handle points at a subject; resolve the subject and ask about that.",
});

/**
 * Who may answer this question about this thing.
 *
 * Returns the scopes entitled to speak, or none. A kind nobody canonically
 * speaks for produces no source — never a guess at the requester, the latest
 * participant, or whoever the model had in mind.
 *
 *   UNKNOWN_SUBJECT_KIND_GUESSES_AUTHORITY = 0
 *   MODEL_CAN_CHOOSE_SUBJECT_AUTHORITY = NO
 */
export async function subjectAuthority(input: {
  subjectKind: string;
  subjectId: string;
  /** The fact being asked about. Two-sided subjects answer differently by it. */
  property?: string;
}): Promise<{
  readonly scopeIds: readonly string[];
  readonly roles: readonly SubjectRole[];
  readonly revision: string | null;
} | null> {
  const adapter = CANONICAL_SUBJECTS[input.subjectKind];
  if (!adapter) return null;
  const standing = await adapter.read(input.subjectId.trim());
  if (!standing) return null;

  const entitled =
    (input.property ? adapter.propertyAuthority?.[input.property] : undefined) ??
    adapter.defaultRoles;

  const scopeIds = unique(entitled.flatMap((role) => standing.roles[role] ?? []));
  if (scopeIds.length === 0) return null;
  return { scopeIds, roles: entitled, revision: standing.revision };
}

/** The canonical subject kinds a person may be asked about. Data, not prose. */
export function verifiableSubjectKinds(): readonly string[] {
  return Object.keys(CANONICAL_SUBJECTS).sort();
}
