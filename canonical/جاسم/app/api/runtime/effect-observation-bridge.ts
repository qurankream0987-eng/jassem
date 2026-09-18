/**
 * JASIM — the effect-signal → canonical-Observation → verification bridge.
 *
 * ─── THE GAP THIS CLOSES, PROVEN BEFORE IT WAS FILLED ───────────────────────
 *
 * `completion-policy.ts` can REQUIRE an independent readback, and until now
 * nothing could produce one. Traced:
 *
 *   • `completion-policy.ts` contained ZERO references to observations.
 *   • The only registered `resolveEffect` read `notification_intents` — a
 *     ledger of JASIM's own dispatch, not an observation of the world.
 *   • Two observation systems existed (`observations`, `fulfillment_
 *     observations`) and neither was reachable from effect verification.
 *
 * So the policy's strongest evidence class was a socket with nothing plugged
 * into it. This is the plug.
 *
 * ─── THE TWO STAGES THAT MUST NOT COLLAPSE ──────────────────────────────────
 *
 *     PROVIDER CLAIM      != CANONICAL OBSERVATION
 *     CANONICAL OBSERVATION != VERIFIED EFFECT
 *
 * A provider may assert "state = OPEN". The RUNTIME decides whether that
 * assertion becomes an Observation and what trust class it carries.
 * `CompletionPolicy` then separately decides whether that Observation is
 * enough to verify the effect. Three decisions, three owners, and this module
 * only makes the middle one.
 *
 * ─── THE RULE THAT MAKES IT SAFE ────────────────────────────────────────────
 *
 * **A signal's trust class is decided by HOW IT ARRIVED, never by what it
 * says.** `submitEffectSignal` takes a `channel` — the trusted call site's
 * account of the transport — and derives the claim source from that. A payload
 * asserting `trustLevel: "authoritative"` or `independent: true` is rejected
 * outright, because a submitter that could name its own trust class would be
 * grading its own evidence, and the whole chain would be decoration.
 *
 * ─── WHY BLOCK 2's `observations` TABLE ─────────────────────────────────────
 *
 * Two existed. `observations` is the only one carrying `freshnessExpiresAt`,
 * and the brief forbids a second freshness mechanism; it is also the table the
 * Presentation pipeline already reads through track sessions, so the same
 * canonical row supports verification AND generative UI. `fulfillment_
 * observations` contributed its `PROOF_CLASSES` vocabulary, which is reused
 * here rather than replaced.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { executionAttempts, observations, type Observation } from "@db/schema";
import type { EffectAssertion, EffectClaimSource, EffectState } from "./completion-policy";

export type BridgeDb = NodePgDatabase<any>;

export class EffectSignalError extends Error {
  readonly code:
    | "INVALID"
    | "FORBIDDEN"
    | "ATTEMPT_NOT_FOUND"
    | "ATTEMPT_MISMATCH"
    | "AUTHORITY_CLAIM";
  constructor(message: string, code: EffectSignalError["code"]) {
    super(message);
    this.code = code;
    this.name = "EffectSignalError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Channels — how a signal reached the runtime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The transport a signal arrived on, as the TRUSTED CALL SITE reports it.
 *
 * This is the only input that decides trust, and it is never taken from a
 * payload. Each value corresponds to a server-side code path that has already
 * established something about the sender.
 */
export type EffectSignalChannel =
  /** A provider's own execution response. Its word about itself. */
  | "PROVIDER_RESPONSE"
  /** A person acting as a provider reported it. Still that party's word. */
  | "HUMAN_PROVIDER_REPORT"
  /** Device/agent telemetry received on an authenticated, attempt-bound route. */
  | "AUTHENTICATED_TELEMETRY"
  /** The runtime queried the owning authority itself, after the fact. */
  | "RUNTIME_READBACK"
  /** A re-read of JASIM's own durable state. */
  | "INTERNAL_STATE_READBACK"
  /** The owner confirmed it through an authenticated session. */
  | "OWNER_CONFIRMATION";

/**
 * Channel → claim source. Trusted server code, fixed here, one-way.
 *
 * Note what is NOT in this table: no channel maps to `BOUND_PROVIDER_RECEIPT`,
 * because that is established by a signature check in the executor, not by an
 * observation. And `PROVIDER_RESPONSE` maps to `SELF_REPORTED` — which no
 * effectful policy accepts — so a provider's HTTP 200 can become an Observation
 * and still never verify anything.
 */
const CHANNEL_SOURCE: Readonly<Record<EffectSignalChannel, EffectClaimSource>> = Object.freeze({
  PROVIDER_RESPONSE: "SELF_REPORTED",
  HUMAN_PROVIDER_REPORT: "SELF_REPORTED",
  AUTHENTICATED_TELEMETRY: "INDEPENDENT_READBACK",
  RUNTIME_READBACK: "INDEPENDENT_READBACK",
  INTERNAL_STATE_READBACK: "INTERNAL_READBACK",
  OWNER_CONFIRMATION: "OWNER_CONFIRMATION",
});

/** The block 3.1 proof vocabulary, reused rather than replaced. */
const CHANNEL_PROOF_CLASS: Readonly<Record<EffectSignalChannel, string>> = Object.freeze({
  PROVIDER_RESPONSE: "self_report",
  HUMAN_PROVIDER_REPORT: "self_report",
  AUTHENTICATED_TELEMETRY: "authenticated_webhook",
  RUNTIME_READBACK: "signed_proof",
  INTERNAL_STATE_READBACK: "signed_proof",
  OWNER_CONFIRMATION: "counterparty_confirm",
});

export function claimSourceForChannel(channel: EffectSignalChannel): EffectClaimSource {
  return CHANNEL_SOURCE[channel];
}

/**
 * Keys a submitted payload may never contain.
 *
 * Each is an attempt to name its own trust class, which is the one thing a
 * submitter cannot do. Rejected rather than stripped: a payload reaching for
 * these is a security event, not a formatting quirk.
 */
export const SIGNAL_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "trustlevel",
  "trustclass",
  "verified",
  "independent",
  "providerverified",
  "effectverified",
  "authoritative",
  "proofclass",
  "claimsource",
  "source",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Submitting a signal
// ─────────────────────────────────────────────────────────────────────────────

export type EffectSignalInput = {
  ownerId: string;
  /** What the observation is ABOUT. Generic: no domain field names. */
  subjectKind: string;
  subjectId: string;
  /** The property being observed, e.g. "state", "delivery", "existence". */
  observationType: string;
  /** The observed value. Data — never a trust claim. */
  payload: Record<string, unknown>;
  /** How it reached us. Supplied by the trusted call site only. */
  channel: EffectSignalChannel;
  /** The attempt whose effect this is evidence about. */
  attemptId: string;
  providerId?: string;
  /** When the WORLD was in this state, not when we heard about it. */
  observedAt?: Date;
  /** How long this observation may be treated as current. */
  freshnessTtlMs?: number;
  provenance?: Record<string, unknown>;
};

function assertNoAuthorityClaim(payload: Record<string, unknown>, label: string): void {
  for (const key of Object.keys(payload)) {
    if (SIGNAL_AUTHORITY_KEYS.has(key.toLowerCase())) {
      throw new EffectSignalError(
        `EFFECT_SIGNAL_AUTHORITY_REJECTED: ${label} contains "${key}". A signal reports what was ` +
          "observed; the runtime decides what that is worth. Nothing was stored.",
        "AUTHORITY_CLAIM",
      );
    }
  }
}

/**
 * Validate a real effect signal and record it as a canonical Observation.
 *
 * Every rejection below is a property the bridge exists to guarantee:
 *   • the payload may not grade itself
 *   • the attempt must exist and belong to this owner
 *   • evidence cannot be replayed onto an unrelated attempt
 *   • the observed time may not be in the future
 */
export async function submitEffectSignal(
  db: BridgeDb,
  input: EffectSignalInput,
  now: Date = new Date(),
): Promise<Observation> {
  if (!input.ownerId?.trim()) throw new EffectSignalError("ownerId is required", "INVALID");
  if (!input.subjectKind?.trim() || !input.subjectId?.trim()) {
    throw new EffectSignalError("A signal must name its subject", "INVALID");
  }
  if (!input.observationType?.trim()) {
    throw new EffectSignalError("A signal must name the property it observes", "INVALID");
  }
  if (!CHANNEL_SOURCE[input.channel]) {
    throw new EffectSignalError(`Unknown signal channel: ${input.channel}`, "INVALID");
  }
  assertNoAuthorityClaim(input.payload, "effect signal payload");
  if (input.provenance) assertNoAuthorityClaim(input.provenance, "effect signal provenance");

  // ── Attempt binding ────────────────────────────────────────────────────
  //
  // A callback saying "success" that is not bound to a run, node and attempt
  // is evidence about nothing. Owner-scoped so a raw attempt id from another
  // owner is not found rather than merely refused — the id is not authority.
  const [attempt] = await db
    .select()
    .from(executionAttempts)
    .where(
      and(
        eq(executionAttempts.id, input.attemptId),
        eq(executionAttempts.ownerId, input.ownerId),
      ),
    )
    .limit(1);
  if (!attempt) {
    throw new EffectSignalError(
      "No execution attempt of this owner matches the signal.",
      "ATTEMPT_NOT_FOUND",
    );
  }

  const observedAt = input.observedAt ?? now;
  if (Number.isNaN(observedAt.getTime())) {
    throw new EffectSignalError("observedAt must be a valid date", "INVALID");
  }
  if (observedAt.getTime() > now.getTime() + 60_000) {
    // A signal from the future is either a clock problem or a forged freshness
    // window. Either way it must not be able to look current forever.
    throw new EffectSignalError("observedAt cannot be in the future", "INVALID");
  }

  const freshnessExpiresAt =
    input.freshnessTtlMs !== undefined
      ? new Date(observedAt.getTime() + input.freshnessTtlMs)
      : null;

  const [row] = await db
    .insert(observations)
    .values({
      id: `obs_${randomUUID()}`,
      ownerId: input.ownerId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      observationType: input.observationType,
      observedAt,
      // The runtime's classification, from the channel — never from the payload.
      sourceKind: CHANNEL_PROOF_CLASS[input.channel],
      providerId: input.providerId ?? null,
      provenance: {
        ...(input.provenance ?? {}),
        channel: input.channel,
        claimSource: CHANNEL_SOURCE[input.channel],
        attemptId: input.attemptId,
        runId: attempt.runId,
        nodeId: attempt.nodeId,
        receivedAt: now.toISOString(),
      },
      payload: input.payload,
      freshnessExpiresAt,
    })
    .returning();
  return row!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading observations back as effect evidence
// ─────────────────────────────────────────────────────────────────────────────

export type ObservationEffectQuery = {
  ownerId: string;
  attemptId: string;
  subjectKind: string;
  subjectId: string;
  observationType: string;
  /** The payload value that means the effect occurred. */
  occurredWhen: (payload: Record<string, unknown>) => boolean;
  /** The payload value that means it definitively did not. */
  notOccurredWhen?: (payload: Record<string, unknown>) => boolean;
  /** Policy's own currency requirement, independent of the row's TTL. */
  maxAgeMs?: number;
};

export type ObservationEvidence = {
  assertion: EffectAssertion;
  /** The rows considered, newest first. */
  considered: readonly Observation[];
};

function stateOf(
  observation: Observation,
  query: ObservationEffectQuery,
): EffectState | undefined {
  const payload = observation.payload as Record<string, unknown>;
  if (query.occurredWhen(payload)) return "OCCURRED";
  if (query.notOccurredWhen?.(payload)) return "NOT_OCCURRED";
  return undefined;
}

/**
 * Turn canonical Observations into one effect assertion.
 *
 * Three rules, in this order, and the order is the design:
 *
 *   1. **Attempt binding.** Only observations whose provenance names THIS
 *      attempt count. Evidence for one attempt is not evidence for another,
 *      which is what closes replay.
 *   2. **Freshness.** An expired row, or one older than the policy's own
 *      `maxAgeMs`, is not current evidence. A device that was OPEN thirty
 *      minutes ago says nothing about a policy needing thirty seconds. This
 *      reuses `freshnessExpiresAt`; it does not add a second mechanism.
 *   3. **Conflict.** Two fresh observations that disagree produce UNCERTAIN,
 *      never a quiet win for whichever is newer. Two authorities disagreeing
 *      is a STRONGER signal than one being unsure, and `decideCompletion`
 *      turns UNCERTAIN into INCONCLUSIVE.
 *
 * The strongest surviving source wins only after all three have been applied.
 */
export async function observationEvidence(
  db: BridgeDb,
  query: ObservationEffectQuery,
  now: Date = new Date(),
): Promise<ObservationEvidence | undefined> {
  const cutoff =
    query.maxAgeMs !== undefined ? new Date(now.getTime() - query.maxAgeMs) : undefined;

  const rows = await db
    .select()
    .from(observations)
    .where(
      and(
        eq(observations.ownerId, query.ownerId),
        eq(observations.subjectKind, query.subjectKind),
        eq(observations.subjectId, query.subjectId),
        eq(observations.observationType, query.observationType),
        ...(cutoff ? [gte(observations.observedAt, cutoff)] : []),
      ),
    )
    .orderBy(desc(observations.observedAt))
    .limit(50);

  // 1. Attempt binding.
  const bound = rows.filter(
    (row) => (row.provenance as { attemptId?: unknown }).attemptId === query.attemptId,
  );
  if (bound.length === 0) return undefined;

  // 2. Freshness — the row's own horizon, reused.
  const fresh = bound.filter(
    (row) =>
      !row.freshnessExpiresAt || row.freshnessExpiresAt.getTime() > now.getTime(),
  );
  if (fresh.length === 0) {
    return {
      considered: bound,
      assertion: {
        state: "UNCERTAIN",
        source: "INTERNAL_READBACK",
        authority: "observation-ledger",
        notes: [
          `Every observation bound to this attempt is stale; the most recent was observed at ${bound[0]!.observedAt.toISOString()}.`,
        ],
      },
    };
  }

  const classified = fresh
    .map((row) => ({ row, state: stateOf(row, query) }))
    .filter((entry): entry is { row: Observation; state: EffectState } => entry.state !== undefined);
  if (classified.length === 0) {
    return {
      considered: fresh,
      assertion: {
        state: "UNCERTAIN",
        source: "INTERNAL_READBACK",
        authority: "observation-ledger",
        notes: ["Observations exist for this attempt but none reports a recognised outcome."],
      },
    };
  }

  // 3. Conflict.
  const states = new Set(classified.map((entry) => entry.state));
  if (states.size > 1) {
    return {
      considered: classified.map((entry) => entry.row),
      assertion: {
        state: "UNCERTAIN",
        source: "INTERNAL_READBACK",
        authority: "observation-ledger",
        notes: [
          `Fresh observations disagree (${[...states].join(" vs ")}). Two authorities in conflict is a stronger signal than one being unsure.`,
          ...classified.map(
            (entry) =>
              `${entry.row.sourceKind}: ${entry.state} at ${entry.row.observedAt.toISOString()}`,
          ),
        ],
      },
    };
  }

  const RANK: Readonly<Record<EffectClaimSource, number>> = {
    OWNER_CONFIRMATION: 0,
    INDEPENDENT_READBACK: 1,
    INTERNAL_READBACK: 2,
    BOUND_PROVIDER_RECEIPT: 3,
    SELF_REPORTED: 4,
    EXECUTOR_RETURN: 5,
  };
  const best = [...classified].sort((a, b) => {
    const sourceA = (a.row.provenance as { claimSource?: EffectClaimSource }).claimSource ?? "SELF_REPORTED";
    const sourceB = (b.row.provenance as { claimSource?: EffectClaimSource }).claimSource ?? "SELF_REPORTED";
    return RANK[sourceA] - RANK[sourceB] || b.row.observedAt.getTime() - a.row.observedAt.getTime();
  })[0]!;

  const claimSource =
    (best.row.provenance as { claimSource?: EffectClaimSource }).claimSource ?? "SELF_REPORTED";

  return {
    considered: classified.map((entry) => entry.row),
    assertion: {
      state: best.state,
      // The class the RUNTIME recorded when the signal arrived, read back.
      source: claimSource,
      authority: best.row.providerId ?? best.row.sourceKind,
      reference: best.row.id,
      notes: [
        `Canonical observation ${best.row.id} (${best.row.sourceKind}) observed at ${best.row.observedAt.toISOString()}.`,
      ],
    },
  };
}

/**
 * Build an `EffectResolver` that reads canonical Observations.
 *
 * A capability declares WHAT would count as its effect having occurred; the
 * bridge supplies the trusted reading. The resolver never invents an
 * assertion — `undefined` means "no bound observation exists", which leaves the
 * effect unconfirmed rather than confirmed.
 */
export function observationEffectResolver(
  db: BridgeDb,
  describe: (context: {
    ownerId: string;
    capabilityId: string;
    attemptId: string;
    result: Record<string, unknown> | null;
  }) => Omit<ObservationEffectQuery, "ownerId" | "attemptId"> | undefined,
) {
  return async (context: {
    ownerId: string;
    capabilityId: string;
    attemptId: string;
    runId: string;
    nodeId: string;
    result: Record<string, unknown> | null;
  }): Promise<EffectAssertion | undefined> => {
    const described = describe(context);
    if (!described) return undefined;
    const evidence = await observationEvidence(db, {
      ...described,
      ownerId: context.ownerId,
      attemptId: context.attemptId,
    });
    return evidence?.assertion;
  };
}
