/**
 * JASIM — WHICH SOURCE SHOULD ESTABLISH THIS FACT?
 *
 *   SOURCE_RESOLUTION != TRUTH · PROVIDER_AVAILABLE != PROVIDER_SHOULD_BE_USED
 *   PROVIDER_ERROR != BUSINESS_FACT · NO_PROVIDER != NO_CAPABILITY
 *   UNKNOWN != FALSE · UNKNOWN != TRUE
 *
 * Two merchants, one JASIM. One has no API and is asked when stronger evidence
 * is needed. One has a verified connected system and is not bothered at all.
 * Same Need, same Offering, same Freshness runtime, same Human Verification
 * runtime, same Provider Binding runtime. Only the available source changed.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let resolver: typeof import("../../api/runtime/source-resolution");
let binding: typeof import("../../api/runtime/provider-binding");
let fabric: typeof import("../../api/runtime/economic-fabric");
let scopes: typeof import("../../api/runtime/actor-scope");
let verification: typeof import("../../api/runtime/counterparty-verification");

const T0 = new Date("2026-09-25T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

/** Every provider read that actually happened. The proof of every gate. */
const reads: { bindingId: string; capability: string; property: unknown }[] = [];

/** What the fixtures answer next. Set per test; the runtime never reads it. */
const answer: { mode: "OK" | "FALSE" | "UNAVAILABLE" | "ERROR" | "THROW" } = { mode: "OK" };

describe("choosing the source for a fact", () => {
  let seller: typeof users.$inferSelect;
  let buyer: typeof users.$inferSelect;
  let sellerScope: string;
  let buyerScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    resolver = await import("../../api/runtime/source-resolution");
    binding = await import("../../api/runtime/provider-binding");
    fabric = await import("../../api/runtime/economic-fabric");
    scopes = await import("../../api/runtime/actor-scope");
    verification = await import("../../api/runtime/counterparty-verification");

    const registry = new binding.ProviderDefinitionRegistry({ allowTestOnly: true });
    const adapter = {
      authenticate: async () => ({ ok: true as const, accountRef: "acct" }),
      discover: async () => ["READ", "OBSERVE", "SEARCH"] as never,
      invoke: async (
        context: { bindingId: string; capability: string },
        request: { capability: string; parameters: Record<string, unknown> },
      ) => {
        reads.push({
          bindingId: context.bindingId,
          capability: request.capability,
          property: request.parameters.property,
        });
        if (answer.mode === "THROW") throw new Error("socket closed");
        if (answer.mode === "UNAVAILABLE") {
          return { status: "UNAVAILABLE" as const, detail: "unreachable" };
        }
        if (answer.mode === "ERROR") return { status: "ERROR" as const, detail: "refused" };
        return {
          status: "OK" as const,
          value: answer.mode === "FALSE" ? false : true,
          observedAt: undefined,
        };
      },
    };
    const base = {
      authMethod: "API_KEY" as const,
      endpoint: { mode: "FIXED" as const, baseUrl: "https://example.com/api" },
      testOnly: true,
      adapter,
    };
    // A system that reports on the state of things, whatever things they are.
    // `observes` is a list of PROPERTY names — no noun anywhere.
    registry.register({
      ...base, id: "sr.observer", displayName: "نظام قارئ",
      supports: ["READ", "OBSERVE", "SEARCH"],
      observes: ["availability", "capacity", "state", "condition", "شاغر"],
    });
    // A second, equally capable system. Two of these is an ambiguity.
    registry.register({
      ...base, id: "sr.second", displayName: "نظام آخر",
      supports: ["READ", "OBSERVE"], observes: ["availability"],
    });
    // Can look things up. Cannot tell you the state of one.
    registry.register({
      ...base, id: "sr.finder", displayName: "نظام بحث",
      supports: ["SEARCH"], observes: ["availability"],
    });
    // Capable, and says nothing about what it observes. Answers nothing.
    registry.register({
      ...base, id: "sr.silent", displayName: "نظام صامت", supports: ["READ", "OBSERVE"],
    });
    binding.setProviderDefinitionRegistry(registry);
  });

  afterAll(async () => {
    binding.setProviderDefinitionRegistry(undefined);
    await handle.pool.end();
  });

  beforeEach(async () => {
    reads.length = 0;
    answer.mode = "OK";
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE scope_provider_bindings, provider_credentials, observations,
        verification_requests, notification_intents, economic_expressions,
        availability_windows, reservations, transactions, commitments, agreements,
        memberships, organizations, scope_policies, events CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'sr-%'`));
    const made = [] as (typeof users.$inferSelect)[];
    for (const name of ["بائع", "مشترٍ"]) {
      const [row] = await handle.db.insert(users)
        .values({ unionId: `sr-${randomUUID()}`, name, preferences: {} }).returning();
      made.push(row!);
    }
    [seller, buyer] = made as [typeof seller, typeof buyer];
    sellerScope = String(seller.id);
    buyerScope = String(buyer.id);
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  async function anOffering(ownerId = sellerScope) {
    const expression = await fabric.createExpression({
      ownerId, kind: "offering", semanticType: "generic.unit",
      attributes: { priceMinor: "2500" },
    });
    await fabric.publishExpression({
      id: expression.id, ownerId,
      projection: { semanticType: "generic.unit", summary: "عرض" },
    });
    return expression.id;
  }

  /** A verified binding of `scopeId`, granted exactly these capabilities. */
  async function connect(scopeId: string, definitionId: string, granted: string[]) {
    const opened = await binding.beginProviderSetup({
      principalId: scopeId, scopeId, definitionId,
      requestedCapabilities: granted, now: T0,
    });
    await binding.completeProviderSetup({
      bindingId: opened.bindingId, principalId: scopeId,
      material: { apiKey: "k" }, now: at(MINUTE),
    });
    await binding.authenticateBinding({
      bindingId: opened.bindingId, principalId: scopeId, now: at(2 * MINUTE),
    });
    await binding.verifyBinding({
      bindingId: opened.bindingId, principalId: scopeId, now: at(3 * MINUTE),
    });
    reads.length = 0; // setup handshakes are not source reads
    return opened.bindingId;
  }

  const ask = (subjectId: string, over: Record<string, unknown> = {}) =>
    resolver.resolveFactSource({
      fact: { subjectKind: "offering", subjectId, property: "availability", ...(over.fact ?? {}) },
      purpose: (over.purpose as never) ?? "COMMIT",
      requestingScopeId: (over.scopeId as string) ?? buyerScope,
      now: (over.now as Date) ?? at(10 * MINUTE),
    });

  async function count(table: string): Promise<number> {
    const result = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
    return (result.rows[0] as { n: number }).n;
  }

  // ── A · NOTHING IS NEEDED ────────────────────────────────────────────────

  it("what is already known well enough calls nobody and asks nobody", async () => {
    //   SUFFICIENT_EVIDENCE_PROVIDER_CALLS = 0
    //   SUFFICIENT_EVIDENCE_HUMAN_PINGS = 0
    const subject = await anOffering();
    await connect(sellerScope, "sr.observer", ["READ"]);
    const observations = await import("../../api/runtime/block2/observations");
    await observations.recordObservation(handle.db as never, {
      ownerId: buyerScope, subjectKind: "offering", subjectId: subject,
      observationType: "availability", observedAt: at(9 * MINUTE),
      sourceKind: "counterparty_confirm", payload: { value: true },
    });

    const resolved = await ask(subject);
    expect(resolved.outcome).toBe("SUFFICIENT_EXISTING");
    expect(reads).toHaveLength(0);
    expect(await count("verification_requests")).toBe(0);
  });

  // ── B · THE CONNECTED MERCHANT ───────────────────────────────────────────

  it("a connected merchant is read, not messaged", async () => {
    //   PROVIDER_SUCCESS_CAUSES_HUMAN_PING = 0
    const subject = await anOffering();
    const bindingId = await connect(sellerScope, "sr.observer", ["READ"]);

    const resolved = await ask(subject);
    expect(resolved.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect(resolved.decision.evidence?.source).toBe("BOUND_PROVIDER_RECEIPT");
    // Exactly one read, through the seller's binding.
    expect(reads).toHaveLength(1);
    expect(reads[0]!.bindingId).toBe(bindingId);
    // Nobody was messaged.
    expect(await count("verification_requests")).toBe(0);
    expect(await count("notification_intents")).toBe(0);
    // Reading created no claim on anything.
    //
    //   PROVIDER_AVAILABILITY_CREATES_RESERVATION = 0
    for (const table of ["reservations", "agreements", "commitments", "transactions"]) {
      expect(await count(table), table).toBe(0);
    }
    // The answer is an observation the freshness runtime judged, not a verdict
    // the provider handed down.
    //
    //   PROVIDER_RESULT_BYPASSES_OBSERVATION = 0
    expect(await count("observations")).toBe(1);
  });

  it("the simple merchant path is untouched", async () => {
    //   NO_PROVIDER_BREAKS_HUMAN_FALLBACK = 0
    const subject = await anOffering();
    const resolved = await ask(subject);
    expect(resolved.outcome).toBe("AWAITING_HUMAN");
    expect(reads).toHaveLength(0);
    expect(await count("verification_requests")).toBe(1);

    // And when the seller answers, it settles exactly as it did before.
    const request = (
      await handle.db.execute(sql.raw(`SELECT id FROM verification_requests`))
    ).rows[0] as { id: string };
    await verification.answerVerificationRequest({
      requestId: request.id, respondingPrincipalId: sellerScope,
      assertion: "AFFIRMED", now: at(12 * MINUTE),
    });
    const again = await ask(subject, { now: at(13 * MINUTE) });
    expect(again.outcome).toBe("SUFFICIENT_EXISTING");
    expect(again.decision.evidence?.source).toBe("OWNER_CONFIRMATION");
  });

  // ── C · A PROVIDER THAT FAILS SAYS NOTHING ───────────────────────────────

  it("a provider that cannot answer creates no fact and falls back to a person", async () => {
    //   PROVIDER_FAILURE_CREATES_NEGATIVE_FACT = 0
    //   PROVIDER_FAILURE_HUMAN_FALLBACK = PASS
    const subject = await anOffering();
    await connect(sellerScope, "sr.observer", ["READ"]);
    for (const mode of ["UNAVAILABLE", "ERROR", "THROW"] as const) {
      await handle.db.execute(sql.raw(`TRUNCATE TABLE observations, verification_requests CASCADE`));
      answer.mode = mode;
      const resolved = await ask(subject);
      expect(resolved.outcome, mode).toBe("AWAITING_HUMAN");
      // Not one observation. Not «unavailable», not «false», not anything.
      expect(await count("observations"), mode).toBe(0);
      expect(await count("verification_requests"), mode).toBe(1);
    }
  });

  it("a provider saying NO is a fact; a provider failing is not", async () => {
    //   NEGATIVE_FACT_DISTINCT_FROM_PROVIDER_FAILURE = PASS
    const subject = await anOffering();
    await connect(sellerScope, "sr.observer", ["READ"]);
    answer.mode = "FALSE";
    const resolved = await ask(subject);
    // A read that succeeded. Its content happens to be «no».
    expect(resolved.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect(await count("observations")).toBe(1);
    expect(await count("verification_requests")).toBe(0);
    const [row] = (
      await handle.db.execute(sql.raw(`SELECT payload FROM observations`))
    ).rows as { payload: { value: unknown } }[];
    expect(row!.payload.value).toBe(false);
  });

  // ── D · WHICH BINDINGS MAY BE A SOURCE ───────────────────────────────────

  it("only a verified binding is a source", async () => {
    //   UNVERIFIED_BINDING_USED_AS_SOURCE = 0
    const subject = await anOffering();
    const opened = await binding.beginProviderSetup({
      principalId: sellerScope, scopeId: sellerScope, definitionId: "sr.observer",
      requestedCapabilities: ["READ"], now: T0,
    });
    // SETUP_PENDING, then AUTHORIZED, then AUTHENTICATED — none of them usable.
    for (const advance of [null, "credential", "authenticate"] as const) {
      if (advance === "credential") {
        await binding.completeProviderSetup({
          bindingId: opened.bindingId, principalId: sellerScope,
          material: { apiKey: "k" }, now: at(MINUTE),
        });
      } else if (advance === "authenticate") {
        await binding.authenticateBinding({
          bindingId: opened.bindingId, principalId: sellerScope, now: at(2 * MINUTE),
        });
      }
      await handle.db.execute(sql.raw(`TRUNCATE TABLE verification_requests CASCADE`));
      reads.length = 0;
      const resolved = await ask(subject);
      expect(resolved.outcome, String(advance)).toBe("AWAITING_HUMAN");
      expect(reads.filter((read) => read.property === "availability")).toHaveLength(0);
    }
  });

  it("a revoked binding is not a source and does not block the fallback", async () => {
    //   REVOKED_BINDING_USED_AS_SOURCE = 0 · REVOKED_PROVIDER_BLOCKS_FALLBACK = 0
    const subject = await anOffering();
    const bindingId = await connect(sellerScope, "sr.observer", ["READ"]);
    await binding.revokeBinding({ bindingId, principalId: sellerScope, now: at(4 * MINUTE) });
    const resolved = await ask(subject);
    expect(resolved.outcome).toBe("AWAITING_HUMAN");
    expect(reads).toHaveLength(0);
    expect(await count("verification_requests")).toBe(1);
  });

  it("a binding granted only SEARCH is never called to establish a fact", async () => {
    //   UNGRANTED_PROVIDER_CAPABILITY_CALL = 0
    const subject = await anOffering();
    await connect(sellerScope, "sr.finder", ["SEARCH"]);
    const resolved = await ask(subject);
    expect(resolved.outcome).toBe("AWAITING_HUMAN");
    expect(reads).toHaveLength(0);
  });

  it("a system that does not say it observes this property answers nothing about it", async () => {
    //   PROVIDER_USED_FOR_UNSUPPORTED_FACT = 0
    const subject = await anOffering();
    await connect(sellerScope, "sr.silent", ["READ", "OBSERVE"]);
    const resolved = await ask(subject);
    expect(resolved.outcome).toBe("AWAITING_HUMAN");
    expect(reads).toHaveLength(0);

    // And a system that DOES observe some properties is still not asked about
    // one it never claimed.
    await handle.db.execute(sql.raw(`TRUNCATE TABLE scope_provider_bindings, verification_requests,
      provider_credentials CASCADE`));
    await connect(sellerScope, "sr.observer", ["READ"]);
    const other = await resolver.resolveFactSource({
      fact: { subjectKind: "offering", subjectId: subject, property: "acceptance" },
      purpose: "COMMIT", requestingScopeId: buyerScope, now: at(10 * MINUTE),
    });
    expect(reads).toHaveLength(0);
    expect(other.outcome).not.toBe("SUFFICIENT_AFTER_PROVIDER");
  });

  // ── E · WHOSE SYSTEM ─────────────────────────────────────────────────────

  it("the buyer's own system is never read to answer a question about the seller's thing", async () => {
    //   BUYER_PROVIDER_USED_FOR_SELLER_FACT = 0 · CROSS_SCOPE_PROVIDER_SOURCE = 0
    //
    // The decisive one. The buyer has a perfectly good connected system. It
    // knows nothing about the seller's shelf, and it is not asked.
    const subject = await anOffering();
    await connect(buyerScope, "sr.observer", ["READ", "OBSERVE"]);
    const resolved = await ask(subject);
    expect(reads).toHaveLength(0);
    expect(resolved.outcome).toBe("AWAITING_HUMAN");
    // The authority step named the seller, never the asker.
    const authority = resolved.steps.find((step) => step.step === "AUTHORITY");
    expect(authority && "scopeIds" in authority && authority.scopeIds).toEqual([sellerScope]);
  });

  it("evidence written for one scope is not evidence for another", async () => {
    //   CROSS_SCOPE_EVIDENCE_SOURCE = 0
    const subject = await anOffering();
    await connect(sellerScope, "sr.observer", ["READ"]);
    await ask(subject);
    // The buyer asked, so the buyer has the answer.
    expect((await ask(subject)).outcome).toBe("SUFFICIENT_EXISTING");
    // A third party who never asked has nothing, and their own question starts
    // from the beginning.
    const [third] = await handle.db.insert(users)
      .values({ unionId: `sr-${randomUUID()}`, name: "ثالث", preferences: {} }).returning();
    reads.length = 0;
    const other = await ask(subject, { scopeId: String(third!.id) });
    expect(other.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect(reads).toHaveLength(1);
  });

  // ── F · CHOOSING BETWEEN SYSTEMS ─────────────────────────────────────────

  it("two systems that could both answer is an ambiguity, not a race", async () => {
    //   MULTIPLE_PROVIDER_LATEST_WINS = 0
    const subject = await anOffering();
    await connect(sellerScope, "sr.observer", ["READ"]);
    await connect(sellerScope, "sr.second", ["READ"]);
    const resolved = await ask(subject);
    expect(resolved.outcome).toBe("AMBIGUOUS_SOURCE");
    // Nothing was read, nothing was recorded, and nobody was messaged on a
    // guess. The scope is the one that can settle it.
    expect(reads).toHaveLength(0);
    expect(await count("observations")).toBe(0);
    expect(await count("verification_requests")).toBe(0);
  });

  it("the scope that OWNS the systems settles which of them to prefer", async () => {
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: the buyer writes `preferredProviders` into the BUYER's
    //   own policy, and that choice selects which of the SELLER's two systems
    //   JASIM reads. The test passed, and its title said «the scope's own
    //   policy», which was true of neither scope in it.
    // WHY_IT_IS_WRONG: it is an authority inversion. A buyer may decide what
    //   strength of evidence they require; they may not decide which of
    //   somebody else's machines speaks for that somebody else's fact. The
    //   test did not merely permit that — it PROVED it, and locked it in.
    // NEW_EXPECTATION: the preference is written into the SELLER's policy,
    //   because the systems are the seller's. The buyer's contrary preference
    //   is set too, and changes nothing.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: the old one asserted only that
    //   SOME policy was read. This asserts WHOSE, and asserts that the other
    //   scope's opinion on file is ignored — which the old expectation could
    //   never have failed on, because it was the inversion.
    //
    //   REQUESTER_POLICY != SOURCE_OWNER_POLICY
    //
    const subject = await anOffering();
    const first = await connect(sellerScope, "sr.observer", ["READ"]);
    await connect(sellerScope, "sr.second", ["READ"]);
    await scopes.setScopePolicy({
      principalId: sellerScope, scopeId: sellerScope,
      policyKey: resolver.SOURCE_POLICY_KEY,
      value: { preferredProviders: ["sr.observer"] },
    });
    // The buyer wants the other one. It is not theirs to want.
    await scopes.setScopePolicy({
      principalId: buyerScope, scopeId: buyerScope,
      policyKey: resolver.SOURCE_POLICY_KEY,
      value: { preferredProviders: ["sr.second"] },
    });
    const resolved = await ask(subject);
    expect(resolved.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect(reads).toHaveLength(1);
    expect(reads[0]!.bindingId).toBe(first);
  });

  it("a scope may reserve a purpose for a person even where a machine could answer", async () => {
    const subject = await anOffering();
    await connect(sellerScope, "sr.observer", ["READ"]);
    await scopes.setScopePolicy({
      principalId: buyerScope, scopeId: buyerScope,
      policyKey: resolver.SOURCE_POLICY_KEY,
      value: { humanRequiredFor: ["COMMIT"] },
    });
    const resolved = await ask(subject);
    expect(resolved.outcome).toBe("AWAITING_HUMAN");
    expect(reads).toHaveLength(0);
    // And a cheaper purpose is unaffected — the policy named one purpose, and
    // the machine is still read for the others.
    const cheap = await ask(subject, { purpose: "PRESENT" });
    expect(cheap.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect(reads).toHaveLength(1);
  });

  // ── G · NOT ASKING TWICE ─────────────────────────────────────────────────

  it("a fresh provider reading answers the next caller without a second read", async () => {
    //   FRESH_PROVIDER_OBSERVATION_REQUERIED = 0
    const subject = await anOffering();
    await connect(sellerScope, "sr.observer", ["READ"]);
    expect((await ask(subject)).outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect((await ask(subject, { now: at(11 * MINUTE) })).outcome).toBe("SUFFICIENT_EXISTING");
    expect(reads).toHaveLength(1);
  });

  it("five callers wanting one answer make one read and one request", async () => {
    //   DUPLICATE_PROVIDER_READS = 0 · DUPLICATE_HUMAN_PINGS = 0
    const subject = await anOffering();
    await connect(sellerScope, "sr.observer", ["READ"]);
    const together = await Promise.all([1, 2, 3, 4, 5].map(() => ask(subject)));
    expect(together.every((one) => one.outcome === "SUFFICIENT_AFTER_PROVIDER")).toBe(true);
    expect(reads).toHaveLength(1);
    expect(await count("observations")).toBe(1);

    // And the human path, which was already deduplicated durably.
    await handle.db.execute(sql.raw(`TRUNCATE TABLE scope_provider_bindings, observations,
      provider_credentials CASCADE`));
    const asked = await Promise.all([1, 2, 3, 4, 5].map(() => ask(subject, { now: at(20 * MINUTE) })));
    expect(asked.every((one) => one.outcome === "AWAITING_HUMAN")).toBe(true);
    expect(await count("verification_requests")).toBe(1);
  });

  // ── H · EVIDENCE MUST ANSWER THE QUESTION ASKED ──────────────────────────

  it("a reading of one revision does not answer about another", async () => {
    //   PROVIDER_EVIDENCE_CROSSES_SUBJECT_REVISION = 0
    const subject = await anOffering();
    await connect(sellerScope, "sr.observer", ["READ"]);
    const three = await ask(subject, { fact: { property: "availability", subjectRevision: 3 } });
    expect(three.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    // The same subject, a later revision. The reading does not carry over.
    const four = await ask(subject, {
      fact: { property: "availability", subjectRevision: 4 }, now: at(11 * MINUTE),
    });
    expect(four.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect(reads).toHaveLength(2);
    // Two readings, each covering its own revision.
    expect(await count("observations")).toBe(2);
  });

  // ── I · NOTHING CAN ANSWER ───────────────────────────────────────────────

  it("when nothing can establish it, nothing is invented", async () => {
    //   NO_SOURCE_FABRICATES_FACT = 0 · UNKNOWN != FALSE
    const resolved = await resolver.resolveFactSource({
      fact: { subjectKind: "offering", subjectId: "off_nothing", property: "availability" },
      purpose: "COMMIT", requestingScopeId: buyerScope, now: at(10 * MINUTE),
    });
    expect(resolved.outcome).toBe("NO_SOURCE");
    expect(resolved.decision.verdict).not.toBe("SUFFICIENT");
    expect(await count("observations")).toBe(0);
    expect(await count("verification_requests")).toBe(0);
  });

  it("a question that is really a negotiation finds no source here", async () => {
    //   SOURCE_RESOLUTION_USED_FOR_NEGOTIATION = 0
    //
    // «Would you accept 8500» is not a fact about a subject. The kinds that
    // carry acceptance have no answering authority at all, by design.
    for (const subjectKind of ["agreement", "proposal", "commitment", "living_object"]) {
      const resolved = await resolver.resolveFactSource({
        fact: { subjectKind, subjectId: "x_1", property: "acceptance" },
        purpose: "COMMIT", requestingScopeId: buyerScope, now: at(10 * MINUTE),
      });
      expect(resolved.outcome, subjectKind).toBe("NO_SOURCE");
    }
    expect(reads).toHaveLength(0);
    expect(await count("observations")).toBe(0);
  });

  // ── J · READING IS NOT ACTING ────────────────────────────────────────────

  it("no source resolution can reach a capability that changes something", async () => {
    //   SOURCE_RESOLUTION_MUTATING_PROVIDER_CALLS = 0 · PAYMENT_EXECUTION_ADDED = 0
    expect([...resolver.FACT_CAPABILITIES]).toEqual(["READ", "OBSERVE"]);
    expect(resolver.FACT_CAPABILITIES.every((one) => !binding.capabilityMutates(one))).toBe(true);
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: `readThroughBinding` takes `authoritativeScopeId`, and
    //   this test names the seller's scope to reach the door.
    // WHY_IT_IS_WRONG: not the assertion — the SIGNATURE it asserted through.
    //   Naming the authoritative scope made it a caller-trust boundary on an
    //   exported function: safe through the one resolver that called it, and
    //   open to a second caller naming a scope nothing made authoritative.
    // NEW_EXPECTATION: the call passes the FACT, and the function derives the
    //   authoritative scopes itself. The refusal asserted here is unchanged.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: it now proves the same refusal
    //   through a door that cannot be told who is authoritative, and the case
    //   below proves a caller naming a real binding of a scope the subject
    //   does not make authoritative is refused too.
    //
    const subject = await anOffering();
    const bindingId = await connect(sellerScope, "sr.observer", ["READ"]);
    const fact = { subjectKind: "offering", subjectId: subject, property: "availability" };
    for (const capability of ["CREATE", "BOOK", "SCHEDULE", "PAY", "REFUND", "DELETE"] as const) {
      const outcome = await binding.readThroughBinding({
        bindingId, fact, capability, now: at(10 * MINUTE),
      });
      expect(outcome.status, capability).toBe("REFUSED");
    }
    // And a caller cannot assert authority it does not have: the buyer's own
    // real, verified binding is refused for the seller's subject.
    //
    //   CALLER_CANNOT_ASSERT_SOURCE_AUTHORITY
    const buyers = await connect(buyerScope, "sr.observer", ["READ"]);
    const wrong = await binding.readThroughBinding({
      bindingId: buyers, fact, capability: "READ", now: at(10 * MINUTE),
    });
    expect(wrong.status).toBe("REFUSED");
    expect(wrong.status === "REFUSED" && wrong.refusal).toBe("NO_SUCH_BINDING");
    expect(reads).toHaveLength(0);
  });

  // ── K · GENERALITY ───────────────────────────────────────────────────────

  it("seven unrelated facts resolve through the same runtime with no branch", async () => {
    //   DOMAIN_SOURCE_HANDLERS_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
    //   UNFAMILIAR_SOURCE_REQUIRES_DOMAIN_BRANCH = 0
    //
    // An offered unit, a translator's hour, a machine's capacity, a venue
    // slot, storage space, a sensor reading, and a fact in a language the
    // runtime has never seen. The runtime matches property names as strings
    // and knows what none of them mean.
    const facts: [string, string][] = [
      ["generic.unit", "availability"],
      ["service.hour", "availability"],
      ["equipment.run", "capacity"],
      ["place.slot", "availability"],
      ["volume.space", "capacity"],
      ["sensor.reading", "state"],
      ["لا.يعرفه.أحد", "شاغر"],
    ];
    await connect(sellerScope, "sr.observer", ["READ", "OBSERVE"]);
    for (const [semanticType, property] of facts) {
      const expression = await fabric.createExpression({
        ownerId: sellerScope, kind: "offering", semanticType, attributes: {},
      });
      await fabric.publishExpression({
        id: expression.id, ownerId: sellerScope,
        projection: { semanticType, summary: "س" },
      });
      const resolved = await resolver.resolveFactSource({
        fact: { subjectKind: "offering", subjectId: expression.id, property },
        purpose: "COMMIT", requestingScopeId: buyerScope, now: at(10 * MINUTE),
      });
      expect(resolved.outcome, `${semanticType}/${property}`).toBe("SUFFICIENT_AFTER_PROVIDER");
    }
    expect(reads).toHaveLength(facts.length);
  });

  it("a capacity window resolves the same way, through its own capacity owner", async () => {
    // A different canonical subject kind entirely — no offering involved.
    const id = `awn_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO availability_windows (id, "ownerId", "resourceKind", "resourceId",
        "startsAt", "endsAt", "capacityTotal", unit, state, "createdAt", "updatedAt")
        VALUES ('${id}', '${sellerScope}', 'capacity', 'r1',
        '${T0.toISOString()}', '${at(3600_000).toISOString()}', 5, 'unit', 'open', now(), now())`),
    );
    await connect(sellerScope, "sr.observer", ["OBSERVE"]);
    const resolved = await resolver.resolveFactSource({
      fact: { subjectKind: "availability_window", subjectId: id, property: "capacity" },
      purpose: "COMMIT", requestingScopeId: buyerScope, now: at(10 * MINUTE),
    });
    expect(resolved.outcome).toBe("SUFFICIENT_AFTER_PROVIDER");
    expect(reads[0]!.capability).toBe("OBSERVE");
  });

  // ── L · THE DECISION EXPLAINS ITSELF ─────────────────────────────────────

  it("the steps say what happened, and carry nothing that should not travel", async () => {
    const subject = await anOffering();
    await connect(sellerScope, "sr.observer", ["READ"]);
    const resolved = await ask(subject);
    expect(resolved.steps.map((step) => step.step)).toEqual([
      "EXISTING_EVIDENCE", "AUTHORITY", "PROVIDER_CANDIDATES",
      "PROVIDER_READ", "PROVIDER_EVIDENCE", "EXISTING_EVIDENCE",
    ]);
    // Ids, states and reasons. Never a payload, a credential, a vault
    // reference or an endpoint.
    const body = JSON.stringify(resolved.steps);
    for (const word of ["apiKey", "pcr_", "https://", "credential"]) {
      expect(body, word).not.toContain(word);
    }
  });
});
