/**
 * JASIM EVALUATION — running frozen corpus v2 against the live runtime.
 *
 * ─── WHY THE PROBES LIVE HERE AND NOT IN THE CORPUS ─────────────────────────
 *
 * `frozen-v2.ts` is purely declarative and names no domain, and
 * `frozen-corpus.test.ts` enforces both by reading it. Code that drives the
 * runtime would put fixtures — and therefore nouns — into a file whose whole
 * value is that it has none. So the corpus says WHAT must be true and this
 * file says HOW it is observed, keyed by id, exactly as `OFFLINE_EXECUTABLE`
 * already does for v1.
 *
 * ─── AND WHY THESE PROBES CALL RUNTIME FUNCTIONS DIRECTLY ───────────────────
 *
 * v1's runner has exactly one way to execute a scenario: drive a CAPABILITY
 * through a run. Every capability built since v1 froze is not a capability at
 * all — joint satisfiability, composition, mutual release, waiting, standing
 * intent, bounded disclosure and the partial-purpose verdict are runtime paths
 * a turn reaches, not registry entries. The v1 runner therefore cannot reach
 * any of them, which is the mechanical reason its number could not move.
 *
 *   A HARNESS THAT CAN ONLY RUN CAPABILITIES CANNOT MEASURE A RUNTIME
 *
 * What a probe MAY NOT do is assert on anything it arranged itself. Each one
 * seeds a world, calls the real function, and reports structural facts from
 * what came back — never from what it hoped for.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { FROZEN_V2 } from "./corpus/frozen-v2";
import type { ScenarioResult } from "./scenario";

type Check = ScenarioResult["checks"][number];

export type ProbeContext = {
  db: NodePgDatabase<any>;
  ownerId: string;
  /** A second owner, for everything that crosses a boundary. */
  otherOwnerId: string;
};

type Probe = (context: ProbeContext) => Promise<readonly Check[]>;

/** Neutral strings. A probe needs a name for a thing; it may not need a noun. */
const KIND_A = "kind.alpha";
const KIND_B = "kind.beta";

async function fabric() {
  return import("../../api/runtime/economic-fabric");
}

async function offering(input: {
  ownerId: string;
  semanticType: string;
  attributes: Record<string, unknown>;
  provenance?: Record<string, "STATED" | "INFERRED" | "OBSERVED">;
}) {
  const f = await fabric();
  const expression = await f.createExpression({
    ownerId: input.ownerId,
    kind: "offering",
    semanticType: input.semanticType,
    attributes: input.attributes,
    ...(input.provenance ? { attributeProvenance: input.provenance } : {}),
  });
  return f.publishExpression({
    id: expression.id,
    ownerId: input.ownerId,
    projection: { semanticType: input.semanticType, summary: input.semanticType },
  });
}

async function need(input: {
  ownerId: string;
  semanticType: string;
  attributes?: Record<string, unknown>;
  hardConstraints?: unknown[];
}) {
  const f = await fabric();
  return f.createExpression({
    ownerId: input.ownerId,
    kind: "need",
    semanticType: input.semanticType,
    attributes: input.attributes ?? {},
    hardConstraints: (input.hardConstraints ?? []) as never,
  });
}

const ok = (name: string, passed: boolean, detail: string, severity: Check["severity"] = "TRUTH"): Check =>
  ({ name, passed, detail, severity });

export const V2_PROBES: Readonly<Record<string, Probe>> = {
  /** Two bounds must hold in the SAME declared configuration. */
  async V01(context) {
    const f = await fabric();
    await offering({
      ownerId: context.otherOwnerId,
      semanticType: KIND_A,
      attributes: {
        alpha: 35, alphaUnit: "m", beta: 20, betaUnit: "tonne",
        capabilityPoints: [
          { alpha: 20, alphaUnit: "m", beta: 20, betaUnit: "tonne" },
          { alpha: 35, alphaUnit: "m", beta: 8, betaUnit: "tonne" },
        ],
      },
    });
    const subject = await need({
      ownerId: context.ownerId,
      semanticType: KIND_A,
      hardConstraints: [
        { field: "alpha", operator: "gte", value: 32, unit: "m" },
        { field: "beta", operator: "gte", value: 11, unit: "tonne" },
      ],
    });
    const result = await f.matchNeed({ needId: subject.id, requesterOwnerId: context.ownerId });
    return [
      ok("jointly_satisfiable", result.matches.length === 0,
        `headline numbers satisfy both bounds; no declared configuration does — matches=${result.matches.length}`,
        "TRUTH"),
      ok("no_false_success", result.matches.length === 0,
        "A match here would be a match that looks right.", "SECURITY"),
    ];
  },

  /** One purpose, two declared parts, only one covered — the gap is NAMED. */
  async V02(context) {
    const f = await fabric();
    await offering({ ownerId: context.otherOwnerId, semanticType: KIND_A, attributes: { alpha: 20 } });
    const subject = await need({
      ownerId: context.ownerId,
      semanticType: "purpose.composite",
      attributes: {
        requiredComponents: [
          { key: "one", semantics: KIND_A, constraints: [{ field: "alpha", operator: "gte", value: 9 }] },
          { key: "two", semantics: KIND_B, constraints: [{ field: "beta", operator: "gte", value: 12 }] },
        ],
      },
    });
    const result = await f.matchNeed({ needId: subject.id, requesterOwnerId: context.ownerId });
    const coverage = result.coverage;
    return [
      ok("partial_coverage_is_not_a_match", result.composite === undefined && result.matches.length === 0,
        "Half a purpose recorded nothing."),
      ok("uncovered_part_is_named", (coverage?.uncovered ?? []).join(",") === "two",
        `uncovered=${JSON.stringify(coverage?.uncovered ?? null)} — silence is the failure this replaces.`),
      ok("covered_part_is_reported", coverage?.components.some((c) => c.key === "one" && c.covered) === true,
        "What WAS covered is reported too, not merely what was missing.", "QUALITY"),
    ];
  },

  /** Every declared part covered — one composite, both parties named. */
  async V03(context) {
    const f = await fabric();
    await offering({ ownerId: context.otherOwnerId, semanticType: KIND_A, attributes: { alpha: 20 } });
    await offering({ ownerId: `${context.otherOwnerId}-2`, semanticType: KIND_B, attributes: { beta: 18 } });
    const subject = await need({
      ownerId: context.ownerId,
      semanticType: "purpose.composite",
      attributes: {
        requiredComponents: [
          { key: "one", semantics: KIND_A, constraints: [{ field: "alpha", operator: "gte", value: 9 }] },
          { key: "two", semantics: KIND_B, constraints: [{ field: "beta", operator: "gte", value: 12 }] },
        ],
      },
    });
    const result = await f.matchNeed({ needId: subject.id, requesterOwnerId: context.ownerId });
    const parties = result.composite
      ? await f.participantsForMatch(result.composite.id)
      : [];
    return [
      ok("all_parts_covered", result.coverage?.viable === true,
        `uncovered=${JSON.stringify(result.coverage?.uncovered ?? null)}`),
      ok("one_composite_recorded", Boolean(result.composite) && result.composite?.offeringId === null,
        "A composite is not an offering."),
      ok("every_party_reachable", parties.length === 3,
        `parties=${parties.length} — somebody must be reachable on each part.`, "QUALITY"),
    ];
  },

  /** An agreement ends only when the OTHER party accepts. */
  async V04(context) {
    const release = await import("../../api/runtime/agreement-release");
    const seeded = await seedAgreement(context);
    const offered = await release.proposeRelease({
      agreementId: seeded.agreementId,
      ownerId: context.ownerId,
      principalId: context.ownerId,
      reason: "the purpose it served is gone",
      discharges: seeded.openObligationIds,
    });
    const statusAfterOffer = await seeded.status();
    let unilateral = false;
    try {
      await release.respondToRelease({
        releaseId: offered.release.id,
        ownerId: context.ownerId,
        principalId: context.ownerId,
        decision: "accept",
      });
      unilateral = true;
    } catch {
      // Refused, which is the behaviour under test.
    }
    await release.respondToRelease({
      releaseId: offered.release.id,
      ownerId: context.otherOwnerId,
      principalId: context.otherOwnerId,
      decision: "accept",
    });
    const statusAfterAccept = await seeded.status();
    return [
      ok("offer_changes_nothing", statusAfterOffer === "agreed",
        `status after an offer = ${statusAfterOffer}`),
      ok("no_unilateral_end", !unilateral,
        "A party cannot accept its own offer to end an agreement.", "SECURITY"),
      ok("both_parties_end_it", statusAfterAccept === "released",
        `status after the other party accepted = ${statusAfterAccept}`),
    ];
  },

  /** A performed obligation cannot be discharged by ending what is owed. */
  async V05(context) {
    const release = await import("../../api/runtime/agreement-release");
    const seeded = await seedAgreement(context);
    await seeded.markPerformed(seeded.openObligationIds[0]!);
    let refused = false;
    try {
      await release.proposeRelease({
        agreementId: seeded.agreementId,
        ownerId: context.otherOwnerId,
        principalId: context.otherOwnerId,
        reason: "ending it",
        discharges: [seeded.openObligationIds[0]!],
      });
    } catch {
      refused = true;
    }
    const verification = await seeded.verificationOf(seeded.openObligationIds[0]!);
    return [
      ok("performed_cannot_be_discharged", refused,
        "Releasing ends what is owed; it does not unperform what happened.", "SECURITY"),
      ok("verified_stays_verified", verification === "VERIFIED",
        `verification = ${verification}`),
    ];
  },

  /** A request nothing answers now can wait, bounded, and be answered later. */
  async V06(context) {
    const waiting = await import("../../api/runtime/waiting-needs");
    const f = await fabric();
    const subject = await need({
      ownerId: context.ownerId,
      semanticType: KIND_A,
      hardConstraints: [{ field: "alpha", operator: "gte", value: 9 }],
    });
    const before = await f.matchNeed({ needId: subject.id, requesterOwnerId: context.ownerId });
    const wait = await waiting.waitForMatch(context.db, {
      needId: subject.id, ownerId: context.ownerId,
    });
    const read = await waiting.readWait(context.db, { needId: subject.id, ownerId: context.ownerId });
    // The answer arrives after the asking.
    await offering({ ownerId: context.otherOwnerId, semanticType: KIND_A, attributes: { alpha: 20 } });
    const swept = await waiting.sweepWaitingNeeds(context.db, { now: new Date() });
    return [
      ok("nothing_now", before.matches.length === 0, "Nothing answered it at the time of asking."),
      ok("waiting_is_recorded", Boolean(wait) && read?.state === "WAITING", `state = ${read?.state}`),
      ok("waiting_is_bounded", Boolean(read?.expiresAt),
        "An unbounded standing scan is a resource nobody authorized.", "SECURITY"),
      ok("a_later_answer_is_found", swept.swept > 0,
        `sweep returned ${JSON.stringify(swept)}`, "QUALITY"),
    ];
  },

  /** An act behind a condition prepares once, and waits for the person. */
  async V07(context) {
    const standing = await import("../../api/runtime/standing-intent");
    const runtime = await import("../../api/runtime/jasim-runtime");
    const conversation = await runtime.createRuntimeConversation({
      ownerId: context.ownerId, title: "v2",
    });
    const intent = await standing.createStandingIntent({
      ownerId: context.ownerId,
      conversationId: conversation.id,
      goal: "prepare it when the moment comes",
      capability: "notify",
      inputs: { recipientId: context.ownerId, purpose: "standing", title: "t", body: "b" },
      subjectKind: "tracked_quantity",
      subjectId: `v2-${randomUUID()}`,
      observationType: "level",
      when: { op: "less_than", field: "quantity", value: 50 },
    });
    const { executionProposals } = await import("@db/schema");
    const { and, eq } = await import("drizzle-orm");
    const proposals = await context.db
      .select().from(executionProposals)
      .where(and(eq(executionProposals.runId, intent.runRef), eq(executionProposals.ownerId, context.ownerId)));
    return [
      ok("parked_not_started", Boolean(intent.runRef) && Boolean(intent.triggerRef),
        "A run carries the act and a trigger names it."),
      ok("nothing_prepared_before_the_condition", proposals.length === 0,
        `proposals before the condition held = ${proposals.length}`, "SECURITY"),
    ];
  },

  /**
   * A private value crosses only under an agreement, and is read live.
   *
   * This probe asserts on the READ'S STATUS, not on whether it threw. My first
   * version wrapped every read in try/catch and read «did not throw» as «the
   * value came out» — so it reported two security failures that did not exist.
   * `readDisclosedField` returns NOT_DISCLOSED and WITHDRAWN rather than
   * raising, which is the better design: a status is a fact the caller can act
   * on, and the runtime's own law already says so.
   *
   *   NO_READING != FALSE
   */
  async V08(context) {
    const disclosure = await import("../../api/runtime/private-disclosure");
    //   AGREEMENT_IS_THE_DISCLOSURE_AUTHORITY — so there must be one first.
    const seeded = await seedAgreement(context);
    const where = {
      recipientOwnerId: context.ownerId,
      subjectKind: "economic_expression",
      subjectId: seeded.offeringId,
      field: "secret",
    };

    const before = await disclosure.readDisclosedField(context.db, where);
    const granted = await disclosure.discloseToCounterparty(context.db, {
      agreementId: seeded.agreementId,
      discloserOwnerId: context.otherOwnerId,
      subjectKind: where.subjectKind,
      subjectId: where.subjectId,
      field: where.field,
    });
    const during = await disclosure.readDisclosedField(context.db, where);
    await disclosure.withdrawDisclosure(context.db, {
      id: granted.id, ownerId: context.otherOwnerId,
    });
    const after = await disclosure.readDisclosedField(context.db, where);

    const f = await fabric();
    const projection = (await f.getExpression(where.subjectId, context.ownerId))?.projection ?? {};
    return [
      ok("no_read_without_an_agreement", before.status === "NOT_DISCLOSED",
        `before the owner said so: ${before.status}`, "SECURITY"),
      ok("granted_read_works", during.status === "RELEASED" && during.value === 7,
        `under the agreement: ${JSON.stringify(during)}`),
      ok("withdrawn_read_stops", after.status === "WITHDRAWN",
        `after withdrawal: ${after.status} — permission to look, not a copy.`, "SECURITY"),
      ok("never_published", !(where.field in (projection as Record<string, unknown>)),
        "Disclosed is not published.", "SECURITY"),
    ];
  },

  /** One part done, one failed: neither achieved nor merely failed. */
  async V09(context) {
    const composition = await import("../../api/runtime/component-composition");
    const verdict = composition.purposeVerdict({
      standings: [
        { key: "one", outcome: "VERIFIED", counterpartyOwnerId: context.otherOwnerId },
        { key: "two", outcome: "FAILED", counterpartyOwnerId: `${context.otherOwnerId}-2` },
      ],
    });
    const serialized = JSON.stringify(verdict);
    return [
      ok("part_succeeded_is_not_purpose_achieved", verdict.purpose === "PARTIAL",
        `purpose = ${verdict.purpose}`),
      ok("intact_part_is_not_void", verdict.standing.map((s) => s.key).join(",") === "one",
        `standing = ${JSON.stringify(verdict.standing.map((s) => s.key))}`, "SECURITY"),
      ok("counterparty_is_named", Boolean(verdict.standing[0]?.counterpartyOwnerId),
        "Somebody must be reachable to be told."),
      ok("runtime_releases_nothing", !/released|void|cancelled|discharged/i.test(serialized),
        "The verdict reports; it does not decide.", "SECURITY"),
    ];
  },

  /** A bound compares correctly across scales, or refuses — never silently. */
  async V10(context) {
    const f = await fabric();
    await offering({
      ownerId: context.otherOwnerId, semanticType: KIND_A,
      attributes: { alpha: 20000, alphaUnit: "kg" },
    });
    const subject = await need({
      ownerId: context.ownerId,
      semanticType: KIND_A,
      hardConstraints: [{ field: "alpha", operator: "gte", value: 9, unit: "tonne" }],
    });
    const result = await f.matchNeed({ needId: subject.id, requesterOwnerId: context.ownerId });
    return [
      ok("bound_survives_translation", result.matches.length === 1,
        `20000 kg satisfies a 9 tonne bound — matches=${result.matches.length}`),
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture: a real agreement, reached the way every agreement is
// ─────────────────────────────────────────────────────────────────────────────

async function seedAgreement(context: ProbeContext) {
  const f = await fabric();
  const agreementRuntime = await import("../../api/runtime/agreement-runtime");
  const { agreements, commitments } = await import("@db/schema");
  const { eq } = await import("drizzle-orm");

  const offer = await offering({
    ownerId: context.otherOwnerId, semanticType: KIND_A,
    attributes: { quantity: 300, secret: 7 },
  });
  const subject = await need({
    ownerId: context.ownerId, semanticType: KIND_A, attributes: { quantity: 300 },
  });
  await f.publishExpression({
    id: subject.id, ownerId: context.ownerId,
    projection: { semanticType: KIND_A, summary: KIND_A },
  });
  const match = await f.matchNeedToOffering({
    needId: subject.id, offeringId: offer.id, createdByOwnerId: context.ownerId,
  });
  const engagement = await f.createEngagement({
    matchId: match.id,
    initiatorOwnerId: context.ownerId,
    participants: await f.participantsForMatch(match.id),
  });
  await agreementRuntime.setNegotiationEnvelope({
    engagementId: engagement.id, ownerId: context.ownerId, principalId: context.ownerId,
    bounds: { inbound: { direction: "LOWER_IS_BETTER", target: 9000, reserve: 10000 } },
    mayConcede: true, mayAcceptWithinReserve: true,
  });
  const proposal = await agreementRuntime.proposeTermSheet({
    engagementId: engagement.id,
    proposerOwnerId: context.otherOwnerId,
    terms: [
      { key: "inbound", kind: "NUMBER", value: 9500, unit: "minor",
        owedBy: context.ownerId, owedTo: context.otherOwnerId, evidence: "INTERNAL_STATE",
        subjectKind: "obligation", subjectId: "inbound-1",
        settlement: { amountMinor: "9500", currency: "KWD" } },
      { key: "outbound", kind: "NUMBER", value: 100, unit: "unit",
        owedBy: context.otherOwnerId, owedTo: context.ownerId, evidence: "HUMAN_ACTION",
        subjectKind: "obligation", subjectId: "outbound-1" },
    ] as never,
  });
  const committed = await agreementRuntime.commitAgreement({
    proposalId: proposal.id, ownerId: context.ownerId,
  });

  return {
    agreementId: committed.agreement.id,
    offeringId: offer.id,
    openObligationIds: committed.commitments.map((row) => row.id),
    async status() {
      const [row] = await context.db
        .select().from(agreements).where(eq(agreements.id, committed.agreement.id));
      return (row as { status?: string } | undefined)?.status;
    },
    async markPerformed(id: string) {
      await context.db
        .update(commitments)
        .set({ verification: "VERIFIED", state: "CLAIMED" })
        .where(eq(commitments.id, id));
    },
    async verificationOf(id: string) {
      const [row] = await context.db.select().from(commitments).where(eq(commitments.id, id));
      return (row as { verification?: string } | undefined)?.verification;
    },
  };
}

/**
 * Run every v2 scenario.
 *
 * A probe that THROWS is a FAIL, never a skip: the capability was supposed to
 * be reachable offline, and an exception is the loudest possible evidence that
 * it is not.
 */
/**
 * Every probe seeds its own world, so every probe must START from an empty one.
 *
 * Without this the probes shared one database and measured each other's
 * leftovers: V10 asked for exactly one match and saw the offerings V01, V02 and
 * V03 had published. The scenario was right and the harness was wrong, which is
 * the worse of the two failures because it looks like a finding.
 *
 *   A PROBE THAT CAN SEE ANOTHER PROBE'S WORLD MEASURES NOTHING
 */
const ISOLATION = `TRUNCATE TABLE economic_matches, economic_engagements,
  economic_proposals, economic_expressions, negotiation_envelopes, agreements,
  commitments, transactions, agreement_releases, waiting_needs,
  private_disclosures, execution_proposals, temporal_triggers, observations,
  notification_intents, messages, conversations, runs CASCADE`;

export async function runBaselineV2(context: ProbeContext): Promise<readonly ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of FROZEN_V2) {
    await context.db.execute(sql.raw(ISOLATION));
    const probe = V2_PROBES[scenario.id];
    if (!probe) {
      results.push({
        scenarioId: scenario.id,
        outcome: "FUTURE",
        checks: [],
        observedRequirement: scenario.expectedRequirement,
        notes: ["No probe observes this scenario yet."],
      });
      continue;
    }
    try {
      const checks = await probe(context);
      const failed = checks.filter((check) => !check.passed);
      const blocking = failed.filter(
        (check) => check.severity === "SECURITY" || check.severity === "TRUTH",
      );
      results.push({
        scenarioId: scenario.id,
        outcome: blocking.length > 0 ? "FAIL" : failed.length > 0 ? "PARTIAL" : "PASS",
        checks,
        observedRequirement: scenario.expectedRequirement,
        notes: [],
      });
    } catch (error) {
      results.push({
        scenarioId: scenario.id,
        outcome: "FAIL",
        checks: [ok("probe_ran", false, String(error).slice(0, 300), "TRUTH")],
        observedRequirement: scenario.expectedRequirement,
        notes: ["The probe threw; the capability is not reachable as the corpus claims."],
      });
    }
  }
  return results;
}
