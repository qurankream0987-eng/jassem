/**
 * JASIM — «خلصنا، تعال نفكّها» — وفعلُ الفكّ لم يكن موجوداً.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * `agreements` was APPEND-ONLY. Grepped across every module: ONE
 * `insert(agreements)` in `commitAgreement`, and ZERO `update(agreements)`
 * anywhere. `status` was set to `agreed` at birth and never written again.
 *
 *     AN AGREEMENT COULD NOT END
 *
 * Two phases named this without closing it. The note on the `agreement-commit`
 * capability said it in as many words — «releasing one is a separate act they
 * both take, not a deletion» — and the purpose verdict of the phase before this
 * one stopped exactly here: «this part is intact, the decision is yours, here
 * is who is on the other side», with nothing the person could then do.
 *
 * `cancelTransaction` is not this act: one actor, a reason, and a refusal once
 * anything is verified. That refusal is right, and it leaves the only case that
 * matters unanswered — an agreement INTACT, partly performed, and now pointless.
 *
 * ─── AND THE RESIDUE THAT MADE IT WORTH BUILDING ────────────────────────────
 *
 * Without this, a transaction whose obligations nobody would ever perform sat
 * OPEN forever, because `deriveTransactionState` waits for VERIFIED and there
 * was no third answer.
 *
 *   RELEASING_IS_NOT_UNDOING · WHAT_WAS_VERIFIED_STAYS_VERIFIED
 *   AN_ENVELOPE_AGREES_IT_DOES_NOT_UNDO
 *   AMBIGUOUS_YES_TAKES_THE_CHEAPEST_MEANING = 0
 *   A_RELEASE_IS_NOT_A_JUDGEMENT
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { agreements, commitments, transactions } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let agreement: typeof import("../../api/runtime/agreement-runtime");
let txn: typeof import("../../api/runtime/transaction-runtime");
let release: typeof import("../../api/runtime/agreement-release");

const A = "9601";
const B = "9602";
const STRANGER = "9603";

describe("ending an agreement is an act the two parties take", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    fabric = await import("../../api/runtime/economic-fabric");
    agreement = await import("../../api/runtime/agreement-runtime");
    txn = await import("../../api/runtime/transaction-runtime");
    release = await import("../../api/runtime/agreement-release");
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE events, observations, economic_expressions,
        economic_matches, economic_engagements, economic_proposals,
        negotiation_envelopes, agreements, commitments, transactions,
        agreement_releases, payment_intents CASCADE`),
    );
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Fixtures: a real agreement, reached the way every agreement is ────────

  async function engagement(semanticType: string) {
    const offering = await fabric.createExpression({
      ownerId: B, kind: "offering", semanticType, attributes: { quantity: 300 },
    });
    await fabric.publishExpression({
      id: offering.id, ownerId: B, projection: { semanticType, summary: "عرض" },
    });
    const need = await fabric.createExpression({
      ownerId: A, kind: "need", semanticType, attributes: { quantity: 300 },
    });
    await fabric.publishExpression({
      id: need.id, ownerId: A, projection: { semanticType, summary: "احتياج" },
    });
    const match = await fabric.matchNeedToOffering({
      needId: need.id, offeringId: offering.id, createdByOwnerId: A,
    });
    return fabric.createEngagement({
      matchId: match.id,
      initiatorOwnerId: A,
      participants: await fabric.participantsForMatch(match.id),
    });
  }

  /** One obligation each way. Neither party is a buyer. */
  const TWO_SIDED = [
    {
      key: "inbound", kind: "NUMBER", value: 9500, unit: "minor",
      owedBy: A, owedTo: B, evidence: "INTERNAL_STATE",
      subjectKind: "obligation", subjectId: "inbound-1",
      settlement: { amountMinor: "9500", currency: "KWD" },
    },
    {
      key: "outbound", kind: "NUMBER", value: 100, unit: "unit",
      owedBy: B, owedTo: A, evidence: "HUMAN_ACTION",
      subjectKind: "obligation", subjectId: "outbound-1",
    },
  ];

  /** The whole chain, ending in a committed agreement with two obligations. */
  async function committed(semanticType = "unit X") {
    const engaged = await engagement(semanticType);
    await agreement.setNegotiationEnvelope({
      engagementId: engaged.id, ownerId: A, principalId: A,
      bounds: { inbound: { direction: "LOWER_IS_BETTER", target: 9000, reserve: 10000 } },
      mayConcede: true, mayAcceptWithinReserve: true,
    });
    const proposal = await agreement.proposeTermSheet({
      engagementId: engaged.id, proposerOwnerId: B, terms: TWO_SIDED,
    });
    const result = await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    return result;
  }

  const obligationOf = (list: readonly { termKey: string; id: string }[], key: string) =>
    list.find((row) => row.termKey === key)!;

  const statusOf = async (agreementId: string) => {
    const [row] = await handle.db.select().from(agreements).where(eq(agreements.id, agreementId));
    return row!.status;
  };
  const transactionOf = async (agreementId: string) => {
    const [row] = await handle.db
      .select().from(transactions).where(eq(transactions.agreementId, agreementId));
    return row!;
  };

  // ── 1. THE GAP ─────────────────────────────────────────────────────────────

  it("an agreement is born `agreed`, and nothing but a release ever moves it", async () => {
    const { agreement: reached } = await committed();
    expect(reached.status).toBe("agreed");
    // The trace this phase started from: one insert, no updates.
    const sources = ["api/runtime/agreement-runtime.ts", "api/runtime/transaction-runtime.ts"];
    for (const path of sources) {
      expect(readFileSync(path, "utf8"), path).not.toContain("update(agreements)");
    }
    expect(readFileSync("api/runtime/agreement-release.ts", "utf8")).toContain("update(agreements)");
  });

  it("an offer to end it changes NOTHING on its own", async () => {
    const { agreement: reached, commitments: owed } = await committed();
    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A,
      reason: "the purpose it served is gone",
      discharges: [obligationOf(owed, "outbound").id],
    });
    expect(offered.release.state).toBe("PROPOSED");
    // An offer is a question, not an event in the agreement.
    expect(await statusOf(reached.id)).toBe("agreed");
    const rows = await handle.db.select().from(commitments).where(eq(commitments.agreementId, reached.id));
    expect(rows.every((row) => row.state !== "RELEASED")).toBe(true);
    // And it names both sides of what it would do.
    expect(offered.discharging.map((row) => row.termKey)).toEqual(["outbound"]);
    expect(offered.untouched.map((row) => row.termKey)).toEqual(["inbound"]);
  });

  // ── 2. BOTH PARTIES, OR NOBODY ─────────────────────────────────────────────

  it("a party cannot accept its own offer", async () => {
    const { agreement: reached } = await committed();
    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A, reason: "done",
    });
    await expect(
      release.respondToRelease({
        releaseId: offered.release.id, ownerId: A, principalId: A, decision: "accept",
      }),
    ).rejects.toThrow(/own offer/i);
    expect(await statusOf(reached.id)).toBe("agreed");
  });

  it("a stranger can neither offer nor accept", async () => {
    const { agreement: reached } = await committed();
    await expect(
      release.proposeRelease({
        agreementId: reached.id, ownerId: STRANGER, principalId: STRANGER, reason: "mine now",
      }),
    ).rejects.toThrow(/not a party/i);
    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A, reason: "done",
    });
    await expect(
      release.respondToRelease({
        releaseId: offered.release.id, ownerId: STRANGER, principalId: STRANGER, decision: "accept",
      }),
    ).rejects.toThrow(/not a party/i);
  });

  it("the other party accepting is what ends it", async () => {
    const { agreement: reached, commitments: owed } = await committed();
    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A,
      reason: "neither of us needs this now",
      discharges: owed.map((row) => row.id),
    });
    const outcome = await release.respondToRelease({
      releaseId: offered.release.id, ownerId: B, principalId: B, decision: "accept",
    });
    expect(outcome.release.state).toBe("ACCEPTED");
    expect(outcome.agreementStatus).toBe("released");
    expect(await statusOf(reached.id)).toBe("released");
    expect(outcome.discharged.map((row) => row.termKey).sort()).toEqual(["inbound", "outbound"]);
    expect(outcome.stillOwed).toEqual([]);
  });

  it("declining leaves the agreement exactly as it was", async () => {
    const { agreement: reached, commitments: owed } = await committed();
    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A, reason: "let us stop",
      discharges: owed.map((row) => row.id),
    });
    const outcome = await release.respondToRelease({
      releaseId: offered.release.id, ownerId: B, principalId: B, decision: "decline",
    });
    expect(outcome.release.state).toBe("DECLINED");
    expect(outcome.agreementStatus).toBe("agreed");
    expect(outcome.discharged).toEqual([]);
    expect(outcome.stillOwed).toHaveLength(2);
    expect(await statusOf(reached.id)).toBe("agreed");
  });

  it("and a declined offer cannot be answered again, nor an accepted one", async () => {
    const { agreement: reached } = await committed();
    for (const first of ["decline", "accept"] as const) {
      await handle.db.execute(sql.raw("TRUNCATE TABLE agreement_releases CASCADE"));
      await handle.db.update(agreements).set({ status: "agreed" }).where(eq(agreements.id, reached.id));
      const offered = await release.proposeRelease({
        agreementId: reached.id, ownerId: A, principalId: A, reason: "r",
      });
      await release.respondToRelease({
        releaseId: offered.release.id, ownerId: B, principalId: B, decision: first,
      });
      await expect(
        release.respondToRelease({
          releaseId: offered.release.id, ownerId: B, principalId: B, decision: "accept",
        }),
        first,
      ).rejects.toThrow(/not open/i);
    }
  });

  it("only one offer may be open at a time", async () => {
    const { agreement: reached } = await committed();
    await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A, reason: "first",
    });
    // Two live offers would let a party accept the cheaper one while the other
    // still looked open.
    await expect(
      release.proposeRelease({
        agreementId: reached.id, ownerId: B, principalId: B, reason: "second",
      }),
    ).rejects.toThrow(/already open/i);
  });

  it("the party who offered may withdraw it; the other may not", async () => {
    const { agreement: reached } = await committed();
    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A, reason: "changed my mind coming",
    });
    await expect(
      release.withdrawRelease({ releaseId: offered.release.id, ownerId: B }),
    ).rejects.toThrow(/offered it/i);
    const withdrawn = await release.withdrawRelease({
      releaseId: offered.release.id, ownerId: A,
    });
    expect(withdrawn.state).toBe("WITHDRAWN");
    // And the slot is free again.
    await expect(
      release.proposeRelease({
        agreementId: reached.id, ownerId: B, principalId: B, reason: "mine then",
      }),
    ).resolves.toBeTruthy();
  });

  // ── 3. WHAT A RELEASE MAY NOT REACH ────────────────────────────────────────

  it("an obligation somebody PERFORMED cannot be discharged by a release", async () => {
    //   WHAT_WAS_VERIFIED_STAYS_VERIFIED — a release ends what is owed; it does
    //   not unperform what happened. That is compensation's question.
    const { agreement: reached, commitments: owed } = await committed();
    const performed = obligationOf(owed, "inbound");
    await handle.db
      .update(commitments)
      .set({ verification: "VERIFIED", state: "CLAIMED" })
      .where(eq(commitments.id, performed.id));

    await expect(
      release.proposeRelease({
        agreementId: reached.id, ownerId: B, principalId: B,
        reason: "let us end it", discharges: [performed.id],
      }),
    ).rejects.toThrow(/performed/i);
  });

  it("an obligation from another agreement cannot be named", async () => {
    const mine = await committed("unit X");
    const theirs = await committed("unit Y");
    await expect(
      release.proposeRelease({
        agreementId: mine.agreement.id, ownerId: A, principalId: A, reason: "r",
        discharges: [theirs.commitments[0]!.id],
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("an envelope agrees; it does not undo", async () => {
    //   AN_ENVELOPE_AGREES_IT_DOES_NOT_UNDO — the envelope authorised reaching
    //   this agreement. Nothing in those bounds is authority to end one, so
    //   both sides of a release need the person, and there is no envelope path.
    const { agreement: reached } = await committed();
    await expect(
      release.proposeRelease({
        agreementId: reached.id, ownerId: A, principalId: "  ", reason: "r",
      }),
    ).rejects.toThrow(/person/i);
    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A, reason: "r",
    });
    await expect(
      release.respondToRelease({
        releaseId: offered.release.id, ownerId: B, principalId: "", decision: "accept",
      }),
    ).rejects.toThrow(/person/i);
    // And the module has no envelope path at all to reach: it never reads one,
    // and it has no basis kind that could stand in for a person.
    const source = readFileSync("api/runtime/agreement-release.ts", "utf8");
    expect(source).not.toContain("getNegotiationEnvelope");
    expect(source).not.toContain("negotiationEnvelopes");
    expect(source).not.toMatch(/"ENVELOPE"|ownerDirect/);
  });

  it("a release must say why", async () => {
    const { agreement: reached } = await committed();
    // Whoever is asked to accept is entitled to know what they are accepting.
    await expect(
      release.proposeRelease({
        agreementId: reached.id, ownerId: A, principalId: A, reason: "   ",
      }),
    ).rejects.toThrow(/why/i);
  });

  it("an already released agreement cannot be released again", async () => {
    const { agreement: reached } = await committed();
    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A, reason: "r",
    });
    await release.respondToRelease({
      releaseId: offered.release.id, ownerId: B, principalId: B, decision: "accept",
    });
    await expect(
      release.proposeRelease({
        agreementId: reached.id, ownerId: A, principalId: A, reason: "again",
      }),
    ).rejects.toThrow(/already been released/i);
  });

  it("nothing may claim a release", () => {
    for (const key of ["state", "released", "accepted", "respondedByOwnerId",
      "proposedByPrincipalId"]) {
      expect(() => release.assertNoReleaseAuthorityClaim({ [key]: true }), key).toThrow();
    }
    expect(() => release.assertNoReleaseAuthorityClaim({ reason: "fine" })).not.toThrow();
  });

  // ── 4. AN OBLIGATION NOBODY NAMED SURVIVES ─────────────────────────────────

  it("«stop the future work and pay me for what is done» is a different release", async () => {
    //   AMBIGUOUS_YES_TAKES_THE_CHEAPEST_MEANING = 0 — «نتفارق» can mean
    //   «nobody owes anybody» or this. The proposal names which, and the
    //   acceptance is acceptance of exactly that.
    const { agreement: reached, commitments: owed } = await committed();
    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: B, principalId: B,
      reason: "I will not be delivering, and what you owe for so far stands",
      discharges: [obligationOf(owed, "outbound").id],
    });
    const outcome = await release.respondToRelease({
      releaseId: offered.release.id, ownerId: A, principalId: A, decision: "accept",
    });
    expect(outcome.discharged.map((row) => row.termKey)).toEqual(["outbound"]);
    // Said, not implied.
    expect(outcome.stillOwed.map((row) => row.termKey)).toEqual(["inbound"]);
    const [inbound] = await handle.db
      .select().from(commitments).where(eq(commitments.id, obligationOf(owed, "inbound").id));
    expect(inbound!.state).not.toBe("RELEASED");
    expect(inbound!.ownerId).toBe(A);
  });

  it("a release naming nothing ends the agreement and discharges nobody", async () => {
    const { agreement: reached } = await committed();
    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A, reason: "no more proposals from me",
    });
    const outcome = await release.respondToRelease({
      releaseId: offered.release.id, ownerId: B, principalId: B, decision: "accept",
    });
    expect(outcome.agreementStatus).toBe("released");
    expect(outcome.discharged).toEqual([]);
    expect(outcome.stillOwed).toHaveLength(2);
  });

  // ── 5. THE RESIDUE THIS CLOSES ─────────────────────────────────────────────

  it("a transaction whose obligations were all released is RELEASED, not SETTLED", async () => {
    //   RELEASING_IS_NOT_UNDOING — SETTLED means every obligation was VERIFIED,
    //   and nothing about a release says anybody performed anything.
    const { agreement: reached, commitments: owed } = await committed();
    expect((await transactionOf(reached.id)).state).toBe("OPEN");

    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A, reason: "both of us are out",
      discharges: owed.map((row) => row.id),
    });
    await release.respondToRelease({
      releaseId: offered.release.id, ownerId: B, principalId: B, decision: "accept",
    });

    const obligations = await txn.obligationsOf((await transactionOf(reached.id)).id);
    expect(txn.deriveTransactionState(obligations, "OPEN")).toBe("RELEASED");
  });

  it("one performed and the rest released is RELEASED, never SETTLED", async () => {
    const { agreement: reached, commitments: owed } = await committed();
    const performed = obligationOf(owed, "inbound");
    await handle.db
      .update(commitments)
      .set({ verification: "VERIFIED", state: "CLAIMED" })
      .where(eq(commitments.id, performed.id));

    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: B, principalId: B,
      reason: "I cannot deliver", discharges: [obligationOf(owed, "outbound").id],
    });
    await release.respondToRelease({
      releaseId: offered.release.id, ownerId: A, principalId: A, decision: "accept",
    });
    const obligations = await txn.obligationsOf((await transactionOf(reached.id)).id);
    expect(txn.deriveTransactionState(obligations, "OPEN")).toBe("RELEASED");
  });

  it("a release never hides a failure", async () => {
    const { agreement: reached, commitments: owed } = await committed();
    await handle.db
      .update(commitments)
      .set({ verification: "FAILED" })
      .where(eq(commitments.id, obligationOf(owed, "outbound").id));
    const offered = await release.proposeRelease({
      agreementId: reached.id, ownerId: B, principalId: B, reason: "ending it",
      discharges: [obligationOf(owed, "inbound").id],
    });
    await release.respondToRelease({
      releaseId: offered.release.id, ownerId: A, principalId: A, decision: "accept",
    });
    const obligations = await txn.obligationsOf((await transactionOf(reached.id)).id);
    // The failure still decides, and the release did not paper over it.
    expect(txn.deriveTransactionState(obligations, "OPEN")).toBe("FAILED");
  });

  it("nothing released leaves every derivation exactly as it was", () => {
    // The inherited behaviour, unchanged: no release, no new answer.
    const none = [
      { state: "open", verification: "VERIFIED" },
      { state: "open", verification: "VERIFIED" },
    ] as never;
    expect(txn.deriveTransactionState(none, "OPEN")).toBe("SETTLED");
    const open = [
      { state: "open", verification: "VERIFIED" },
      { state: "open", verification: "PENDING" },
    ] as never;
    expect(txn.deriveTransactionState(open, "OPEN")).toBe("OPEN");
  });

  // ── 6. WHAT A RELEASE IS NOT ───────────────────────────────────────────────

  it("no fault is recorded anywhere", () => {
    //   A_RELEASE_IS_NOT_A_JUDGEMENT — two parties ending something is not a
    //   finding about either of them.
    const source = readFileSync("api/runtime/agreement-release.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const word of ["fault", "blame", "breach", "guilty", "liable", "penalty",
      "damages", "defaulted"]) {
      expect(source, word).not.toMatch(new RegExp(`\\b${word}`, "i"));
    }
  });

  it("the history of every offer survives, including the refused ones", async () => {
    const { agreement: reached } = await committed();
    const first = await release.proposeRelease({
      agreementId: reached.id, ownerId: A, principalId: A, reason: "one",
    });
    await release.respondToRelease({
      releaseId: first.release.id, ownerId: B, principalId: B, decision: "decline",
    });
    const second = await release.proposeRelease({
      agreementId: reached.id, ownerId: B, principalId: B, reason: "two",
    });
    await release.respondToRelease({
      releaseId: second.release.id, ownerId: A, principalId: A, decision: "accept",
    });
    const history = await release.releasesForAgreement({
      agreementId: reached.id, ownerId: A,
    });
    expect(history).toHaveLength(2);
    expect(history.map((row) => row.state).sort()).toEqual(["ACCEPTED", "DECLINED"]);
    // The reason travels with each one, so «why did we end this» is answerable.
    expect(history.map((row) => row.reason).sort()).toEqual(["one", "two"]);
  });

  it("no domain entered the release", () => {
    const source = readFileSync("api/runtime/agreement-release.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      // `orderBy` is the query builder's, not a noun about commerce. Stripping
      // the one identifier keeps the check a PREFIX check, so `orderId` and
      // `orderTotal` still fail — which switching to a whole-word check would
      // have quietly allowed.
      .replace(/\.orderBy\(/g, ".sortedBy(");
    for (const word of ["order", "booking", "rental", "lease", "subscription",
      "invoice", "refund", "buyer", "seller", "tenant", "customer"]) {
      expect(source, word).not.toMatch(new RegExp(`\\b${word}`, "i"));
    }
    expect(source).not.toMatch(/switch\s*\(/);
  });
});
