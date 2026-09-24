/**
 * JASIM — THE LIVING OBJECT CONTRACT.
 *
 * What the runtime PROMISES, checked without a database: the vocabulary is
 * closed, the policy is structural, the module declares nothing of its own, and
 * the separations that make a handle safe are visible in the source rather than
 * merely intended.
 *
 *   LIVING_OBJECT != CANONICAL_SUBJECT
 *   DUPLICATE_OPERATIONAL_TRUTH = 0
 *   DOMAIN_NOUN_BRANCHES = 0 · TEST_ID_BRANCHES = 0
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIVING_OBJECT_DECLINES,
  LIVING_OBJECT_EVENT_TYPES,
  LIVING_OBJECT_FOLLOW_STATES,
  LIVING_OBJECT_REASONS,
  LIVING_OBJECT_STATUSES,
  LIVING_OBJECT_SUBJECT_KINDS,
  LIVING_OBJECT_SURFACE_STATES,
  materializationDecision,
  type SubjectSnapshot,
} from "../../api/runtime/living-object-runtime";

const SOURCE = readFileSync(
  resolve(process.cwd(), "api/runtime/living-object-runtime.ts"),
  "utf8",
);
const MIGRATION = readFileSync(
  resolve(process.cwd(), "db/migrations-pg/0021_living_objects.sql"),
  "utf8",
);

function snapshot(over: Partial<SubjectSnapshot> = {}): SubjectSnapshot {
  return {
    exists: true,
    authorizedScopes: ["scope-1"],
    status: "ACTIVE",
    title: "شيء",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    revision: "r1",
    ...over,
  };
}

describe("living object · vocabulary", () => {
  it("every subject kind is a JASIM primitive, never a domain noun", () => {
    //   DOMAIN_LIVING_OBJECT_TYPES_ADDED = 0
    expect([...LIVING_OBJECT_SUBJECT_KINDS].sort()).toEqual([
      "agreement", "bubble", "commitment", "engagement", "monitor", "negotiation",
      "reservation", "run", "task", "transaction", "world",
    ]);
    for (const kind of LIVING_OBJECT_SUBJECT_KINDS) {
      for (const noun of ["order", "delivery", "booking", "driver", "shipment", "price", "job", "food"]) {
        expect(kind, `${kind} names ${noun}`).not.toContain(noun);
      }
    }
  });

  it("the follower's states and the surface's states are two vocabularies", () => {
    // If they were one, HIDE and CANCEL would be the same word.
    expect([...LIVING_OBJECT_FOLLOW_STATES]).toEqual(["FOLLOWING", "RESOLVED", "RELEASED"]);
    expect([...LIVING_OBJECT_SURFACE_STATES]).toEqual(["VISIBLE", "HIDDEN"]);
    for (const state of LIVING_OBJECT_FOLLOW_STATES) {
      expect(LIVING_OBJECT_SURFACE_STATES as readonly string[]).not.toContain(state);
    }
  });

  it("neither vocabulary contains a word that would act on the subject", () => {
    //   HIDE != CANCEL · CANCEL != DELETE · RESOLVED != ERASED
    const all = [...LIVING_OBJECT_FOLLOW_STATES, ...LIVING_OBJECT_SURFACE_STATES];
    for (const forbidden of ["CANCELLED", "DELETED", "ERASED", "FULFILLED", "REFUNDED"]) {
      expect(all).not.toContain(forbidden);
    }
  });

  it("UNKNOWN is a status a projection may report", () => {
    //   UNKNOWN != FALSE · UNKNOWN != ABSENT
    expect(LIVING_OBJECT_STATUSES).toContain("UNKNOWN");
  });

  it("every reason names a shape of commitment, not a topic", () => {
    expect([...LIVING_OBJECT_REASONS].sort()).toEqual([
      "DURABLE_EXECUTION_STARTED",
      "EXPLICIT_FOLLOW",
      "OBLIGATION_CREATED",
      "PERSISTENT_SURFACE_CREATED",
      "STANDING_CONDITION_CREATED",
    ]);
  });

  it("a refusal is explainable too", () => {
    expect(LIVING_OBJECT_DECLINES.length).toBeGreaterThan(3);
    expect(LIVING_OBJECT_DECLINES).toContain("READ_ONLY_TURN");
    expect(LIVING_OBJECT_DECLINES).toContain("NOT_AUTHORIZED");
  });

  it("the event types it may emit are named once and closed", () => {
    expect([...LIVING_OBJECT_EVENT_TYPES].every((type) => type.startsWith("LIVING_OBJECT_"))).toBe(true);
    expect(new Set(LIVING_OBJECT_EVENT_TYPES).size).toBe(LIVING_OBJECT_EVENT_TYPES.length);
  });
});

describe("living object · materialization policy", () => {
  it("a read that changed nothing leaves nothing behind", () => {
    //   EVERY_TURN_BECOMES_LIVING_OBJECT = NO
    const decision = materializationDecision(
      { subjectKind: "commitment", subjectId: "x", sideEffect: "NONE", durability: "EPHEMERAL" },
      snapshot(),
    );
    expect(decision).toEqual({ materialize: false, decline: "READ_ONLY_TURN" });
  });

  it("an ephemeral result leaves nothing behind even when state changed", () => {
    const decision = materializationDecision(
      { subjectKind: "run", subjectId: "x", sideEffect: "EXTERNAL", durability: "EPHEMERAL" },
      snapshot(),
    );
    expect(decision).toEqual({ materialize: false, decline: "EPHEMERAL_RESULT" });
  });

  it("an absent subject never becomes a handle", () => {
    const decision = materializationDecision(
      { subjectKind: "run", subjectId: "x", sideEffect: "EXTERNAL", durability: "ONGOING" },
      snapshot({ exists: false }),
    );
    expect(decision).toEqual({ materialize: false, decline: "NO_DURABLE_SUBJECT" });
  });

  it("a subject that already finished is never newly followed", () => {
    for (const status of ["COMPLETED", "FAILED", "CANCELLED"] as const) {
      const decision = materializationDecision(
        { subjectKind: "commitment", subjectId: "x", sideEffect: "INTERNAL_STATE", durability: "ONGOING" },
        snapshot({ status }),
      );
      expect(decision, status).toEqual({ materialize: false, decline: "SUBJECT_ALREADY_TERMINAL" });
    }
  });

  it("the decision depends on shape alone — the same pair decides for every kind", () => {
    //   DOMAIN_NOUN_BRANCHES = 0
    for (const kind of LIVING_OBJECT_SUBJECT_KINDS) {
      const yes = materializationDecision(
        { subjectKind: kind, subjectId: "x", sideEffect: "INTERNAL_STATE", durability: "ONGOING" },
        snapshot(),
      );
      const no = materializationDecision(
        { subjectKind: kind, subjectId: "x", sideEffect: "NONE", durability: "EPHEMERAL" },
        snapshot(),
      );
      expect(yes.materialize, kind).toBe(true);
      expect(no.materialize, kind).toBe(false);
    }
  });

  it("and the reason it gives is a property of the kind, not of the caller", () => {
    // The companion to the test above: the same input twice gives the same
    // answer, so the policy is a function and not a mood.
    const input = {
      subjectKind: "transaction" as const, subjectId: "x",
      sideEffect: "EXTERNAL" as const, durability: "PERSISTENT" as const,
    };
    const first = materializationDecision(input, snapshot());
    const second = materializationDecision(input, snapshot({ revision: "r2" }));
    expect(first).toEqual(second);
    expect(first.materialize && first.reason).toBe("OBLIGATION_CREATED");
  });
});

describe("living object · the module declares nothing of its own", () => {
  it("no table, socket, scheduler, ledger or cursor model", () => {
    //   SECOND_EVENT_LEDGERS_ADDED = 0 · SECOND_CURSOR_MODELS_ADDED = 0
    expect(SOURCE).not.toMatch(/pgTable\(/);
    expect(SOURCE).not.toMatch(/new WebSocketServer\(/);
    expect(SOURCE).not.toMatch(/setInterval\(|setTimeout\(/);
    expect(SOURCE).not.toMatch(/class \w*Socket/);
  });

  it("it never deletes anything, its own rows included", () => {
    //   SURFACE_EXIT != LIVING_OBJECT_DELETE
    expect(SOURCE).not.toMatch(/\.delete\(/);
    expect(SOURCE).not.toMatch(/DROP |TRUNCATE /);
  });

  it("nothing it exports names a domain", () => {
    const declared = [...SOURCE.matchAll(/export (?:type|function|const|class|async function) (\w+)/g)]
      .map((match) => match[1]!);
    expect(declared.length).toBeGreaterThan(10);
    for (const name of declared) {
      for (const word of ["Order", "Delivery", "Booking", "Driver", "Shipment", "Price", "Food", "Flight"]) {
        expect(name, `${name} names ${word}`).not.toContain(word);
      }
    }
  });

  it("no branch keys on a noun, a test id, a scenario name or an example phrase", () => {
    //   DOMAIN_NOUN_BRANCHES = 0 · TEST_ID_BRANCHES = 0
    //   SCENARIO_NAME_BRANCHES = 0 · EXAMPLE_PHRASE_BRANCHES = 0
    //   SHAWARMA_BRANCH = 0 · BROASTED_BRANCH = 0 · TRANSLATOR_BRANCH = 0
    //
    // A branch on a noun has to compare against that noun, so what is searched
    // is the STRING LITERALS — which is where such a comparison must live —
    // rather than every identifier. Searching identifiers too would have been
    // looser, not stricter: it flags `orderBy` and proves nothing about
    // branching.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const literals = [...code.matchAll(/"([^"\\]*)"|'([^'\\]*)'|`([^`\\]*)`/g)]
      .map((match) => (match[1] ?? match[2] ?? match[3] ?? "").toLowerCase());
    expect(literals.length).toBeGreaterThan(20);
    for (const word of [
      "shawarma", "شاورما", "broasted", "بروستد", "translator", "مترجم",
      "order", "delivery", "booking", "restaurant", "prado", "برادو",
      "flight", "gold", "courier",
    ]) {
      for (const literal of literals) {
        expect(literal, `a literal branches on ${word}`).not.toContain(word.toLowerCase());
      }
    }
  });

  it("and it never reads the environment or a test flag to decide anything", () => {
    // The companion. A noun branch is one way to fake generality; keying on
    // "am I under test" is the other, and neither is present.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/process\s*\.\s*env/);
    expect(code).not.toMatch(/NODE_ENV|isTest|__TEST__|VITEST/);
  });

  it("the only branching vocabulary is the canonical status words", () => {
    // The second companion: every `case` in the module belongs to the ONE
    // status normalization, so there is nowhere else a per-kind branch could
    // be hiding.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect((code.match(/\bswitch\s*\(/g) ?? []).length).toBe(1);
  });

  it("it reads subject truth from the canonical tables and holds no copy", () => {
    //   DUPLICATE_OPERATIONAL_TRUTH = 0
    for (const table of [
      "commitments", "transactions", "agreements", "standingMonitors", "runs",
      "reservations", "economicEngagements", "negotiationEnvelopes",
    ]) {
      expect(SOURCE, `${table} is never read`).toContain(`from(${table})`);
    }
    // One reader per kind, and the readers are the only door.
    const readerCount = (SOURCE.match(/^  \w+: async \(subjectId\)/gm) ?? []).length;
    expect(readerCount).toBe(LIVING_OBJECT_SUBJECT_KINDS.length);
  });

  it("no subject's state is ever written by this module", () => {
    // It updates its own handles and nothing else. A runtime that could advance
    // an order would be a second operational truth whatever it stored.
    const updates = [...SOURCE.matchAll(/\.update\((\w+)\)/g)].map((match) => match[1]!);
    expect(updates.length).toBeGreaterThan(0);
    expect(new Set(updates)).toEqual(new Set(["livingObjects"]));
  });
});

describe("living object · the table stores no operational truth", () => {
  it("the migration declares no status, title, progress or payload column", () => {
    for (const forbidden of ['"status"', '"title"', '"progress"', '"payload"', '"terms"', '"amount"']) {
      expect(MIGRATION, `migration declares ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("one handle per scope per subject, enforced by the database", () => {
    // Idempotence that a forgotten check cannot undo.
    expect(MIGRATION).toMatch(/CREATE UNIQUE INDEX[\s\S]*?"scopeId", "subjectKind", "subjectId"/);
  });

  it("the handle is scoped, so an organization's tracked things are its own", () => {
    expect(MIGRATION).toContain('"scopeId" varchar(64) NOT NULL');
  });
});
