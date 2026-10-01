/**
 * JASIM — WHAT A CARD'S CONTROL ACTS ON, AND WHY IT IS NEVER A POSITION.
 *
 * A press arrives as `"<intent>:<reference>"`. Before this, the workspace sent
 * its OWN target with it — the conversation, or the active run — so an action
 * would have been aimed at whatever the workspace happened to be about rather
 * than at the thing on the card.
 *
 *   CARD_POSITION_IS_ACTION_AUTHORITY = 0
 *   STALE_CARD_ACTION_EXECUTES = 0
 *   DOMAIN NOUN != ACTION MAPPING
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  candidateActionTarget,
  referenceFromPress,
} from "../../src/components/jasim-core/candidateActionTarget";

const candidate = (ref: string, version: number, kind = "economic_expression") => ({
  ref,
  id: ref,
  title: "عنصر",
  provenance: { canonicalKind: kind, version },
  actions: [{ intent: "select", label: "select" }],
});

const surface = (...candidates: unknown[]) => ({
  primitive: "ENTITY_GRID",
  version: 1,
  data: { candidates },
});

describe("a card's control acts on the card's own canonical thing", () => {
  it("resolves the pressed reference to its canonical kind and version", () => {
    const target = candidateActionTarget(surface(candidate("expr_1", 2)), "select:expr_1");
    expect(target).toEqual({
      reference: { kind: "economic_expression", id: "expr_1" },
      expectedPresentationVersion: "economic_expression:2",
    });
  });

  it("position is not identity — reordering the surface changes nothing", () => {
    const a = candidate("expr_a", 2);
    const b = candidate("expr_b", 5);
    const forward = candidateActionTarget(surface(a, b), "select:expr_b");
    const reversed = candidateActionTarget(surface(b, a), "select:expr_b");
    expect(forward).toEqual(reversed);
    expect(forward!.reference.id).toBe("expr_b");
  });

  it("two cards that look identical resolve to their own references", () => {
    //   IDENTICAL_VISUAL_CARDS_CROSS_TARGET = 0
    const first = { ...candidate("expr_1", 2), title: "نفس العنوان" };
    const second = { ...candidate("expr_2", 2), title: "نفس العنوان" };
    expect(candidateActionTarget(surface(first, second), "select:expr_1")!.reference.id)
      .toBe("expr_1");
    expect(candidateActionTarget(surface(first, second), "select:expr_2")!.reference.id)
      .toBe("expr_2");
  });

  it("the version is the THING's own, so a republished offering makes the card stale", () => {
    // The card was drawn at version 2; the runtime will hold 3 after the
    // holder republishes, and the dispatcher compares the two exactly.
    expect(candidateActionTarget(surface(candidate("expr_1", 2)), "select:expr_1")!
      .expectedPresentationVersion).toBe("economic_expression:2");
    expect(candidateActionTarget(surface(candidate("expr_1", 3)), "select:expr_1")!
      .expectedPresentationVersion).toBe("economic_expression:3");
  });

  it("a press naming something this surface does not carry resolves to nothing", () => {
    // Never to the nearest thing: a surface the person is not looking at is
    // not a target, and «closest match» is how an action lands on the wrong row.
    for (const press of ["select:expr_absent", "select:", "select", "", "open:expr_absent"]) {
      expect(candidateActionTarget(surface(candidate("expr_1", 2)), press), press).toBeNull();
    }
    expect(candidateActionTarget(null, "select:expr_1")).toBeNull();
    expect(candidateActionTarget(surface(), "select:expr_1")).toBeNull();
  });

  it("a candidate with no canonical provenance resolves to nothing", () => {
    //   An external observation carries no canonical kind and no version, so
    //   there is nothing for an action to be aimed at — which is the same
    //   answer the declaration side gives by declaring no intent at all.
    const external = { ref: "https://example.com/a", id: "https://example.com/a",
      provenance: { url: "https://example.com/a", domain: "example.com" } };
    expect(candidateActionTarget(surface(external), "select:https://example.com/a")).toBeNull();
  });

  it("the canonical kind is read, never listed", () => {
    //   A kind nobody has added here still resolves: it comes from the
    //   runtime's own `provenance.canonicalKind`, not from a table to extend.
    const target = candidateActionTarget(
      surface(candidate("thing_1", 7, "some_future_canonical_kind")),
      "select:thing_1",
    );
    expect(target).toEqual({
      reference: { kind: "some_future_canonical_kind", id: "thing_1" },
      expectedPresentationVersion: "some_future_canonical_kind:7",
    });
  });

  it("a reference containing a colon survives the press encoding", () => {
    expect(referenceFromPress("select:https://example.com/a?x=1")).toBe("https://example.com/a?x=1");
  });

  it("the resolver names no domain and no kind of its own", () => {
    //   DOMAIN_NOUN_ACTION_BRANCHES = 0
    const code = readFileSync("src/components/jasim-core/candidateActionTarget.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .toLowerCase();
    for (const word of ["economic_expression", "runtime_run", "entity_grid", "car", "hotel",
      "product", "job", "buy", "book", "select"]) {
      expect(code, word).not.toContain(word);
    }
  });
});
