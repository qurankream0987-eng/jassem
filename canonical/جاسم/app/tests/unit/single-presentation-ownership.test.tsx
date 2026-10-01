/**
 * JASIM — ONE SEMANTIC PRESENTATION, ONE VISIBLE OWNER, ONE VISIBLE INSTANCE.
 *
 * ─── THE DUPLICATION, TRACED ────────────────────────────────────────────────
 *
 * A clean real turn showed six canonical offerings becoming ONE result set and
 * TWO visible grids of six cards each. Not two stored surfaces — ONE:
 * `getActiveWorkspaceProjection` builds `currentPresentation` by calling
 * `presentationFromMessage(latestMessage.metadata)`. The workspace host and the
 * message bubble were reading the same stored bytes out of the same row.
 *
 *   CANONICAL_PRESENTATION_STATE != VISIBLE_RENDER_INSTANCE
 *
 * ─── WHY IDENTITY AND NOT SHAPE ─────────────────────────────────────────────
 *
 * Two genuinely different turns may produce byte-identical surfaces, and both
 * must still appear. So nothing here compares titles, card counts or JSON.
 *
 *   VISUAL_EQUALITY_USED_FOR_DEDUPE = 0 · JSON_EQUALITY_USED_FOR_DEDUPE = 0
 *
 * ─── AND WHY THE HOST KEEPS THE LIVE ONE ────────────────────────────────────
 *
 * The workspace host is the one with a trusted action path: `source:
 * 'WORKSPACE'`, an expected presentation version that refuses an action aimed
 * at a stale surface, and submit. The bubble's path needs a registered smart
 * bubble and otherwise resolves to a toast. Leaving the live surface in the
 * bubble would leave buttons that do nothing.
 *
 * So the host owns the CURRENT presentation and the conversation owns every
 * other turn's — history is untouched, and nothing is deleted anywhere.
 *
 *   CANONICAL_PRESENTATION_DELETED_TO_FIX_UI = 0
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessage } from "../../src/components/chat/ChatMessage";

const render = (node: React.ReactElement) => renderToStaticMarkup(node);

/** A canonical surface, under the names the card reads. */
const grid = (primitive = "ENTITY_GRID") => ({
  primitive,
  version: 1,
  data: {
    candidates: [
      { ref: "e1", id: "e1", title: "عنصر", attributes: { ratedDepth: "450 m" } },
    ],
  },
});

const message = (id: string, presentation: unknown) =>
  ({
    id,
    role: "assistant",
    content: "نتيجة.",
    createdAt: "2026-10-01T00:00:00.000Z",
    metadata: { presentation },
  }) as never;

/**
 * Every primitive a host may present. The rule may not know any of them apart:
 * one branch per kind is the thing this phase exists not to build.
 */
const PRIMITIVES = [
  "ENTITY_GRID", "ENTITY_CARD", "SEARCH_RESULTS", "TABLE", "CHART", "MAP",
  "FORM", "TRACKER", "TIMELINE", "COMPARISON", "STATUS",
] as const;

describe("one semantic presentation, one visible instance", () => {
  it("a record a host is presenting is not drawn a second time by its own message", () => {
    const markup = render(
      <ChatMessage message={message("m1", grid())} presentedByHostRecordId="m1" />,
    );
    expect(markup).not.toContain("ratedDepth");
    // The turn's WORDS are untouched: the host owns the instrument, not the
    // conversation. A reply that lost its text would be a worse bug.
    expect(markup).toContain("نتيجة.");
  });

  it("and is drawn by its own message whenever no host is presenting it", () => {
    for (const claim of [undefined, null, "", "m2", "different"]) {
      const markup = render(
        <ChatMessage message={message("m1", grid())} presentedByHostRecordId={claim} />,
      );
      expect(markup, String(claim)).toContain("ratedDepth");
    }
  });

  it("history is untouched: an earlier turn keeps its own surface", () => {
    // The host presents the LATEST record, so every earlier turn still draws
    // its own. Three turns, the last claimed: three surfaces, each once.
    const claimed = "m3";
    const drawn = ["m1", "m2", "m3"].map((id) =>
      render(<ChatMessage message={message(id, grid())} presentedByHostRecordId={claimed} />)
        .includes("ratedDepth"),
    );
    expect(drawn).toEqual([true, true, false]);
  });

  it("IDENTITY, NOT SHAPE — byte-identical surfaces on two records both appear", () => {
    //   VISUAL_EQUALITY_USED_FOR_DEDUPE = 0 · JSON_EQUALITY_USED_FOR_DEDUPE = 0
    const identical = grid();
    const claimedMarkup = render(
      <ChatMessage message={message("m1", identical)} presentedByHostRecordId="m1" />,
    );
    const otherMarkup = render(
      <ChatMessage message={message("m2", identical)} presentedByHostRecordId="m1" />,
    );
    expect(claimedMarkup).not.toContain("ratedDepth");
    // Same bytes, same title, same card count — and still shown, because it is
    // a different record.
    expect(otherMarkup).toContain("ratedDepth");
  });

  it("the rule cannot tell one presentation kind from another", () => {
    //   PRESENTATION_KIND_DEDUPE_BRANCHES = 0
    //
    // Asserted on `jasim-surface` — the wrapper `PresentationRenderer` puts
    // around EVERY primitive — rather than on any one primitive's content. The
    // first version asserted on a card's attribute text and failed on
    // ENTITY_CARD, which reads `data.entity` and not `data.candidates`: that
    // was my fixture speaking a card's dialect, not the rule knowing a kind.
    // The invariant is the same for all of them: claiming removes the surface,
    // not claiming keeps it.
    for (const primitive of PRIMITIVES) {
      const claimed = render(
        <ChatMessage message={message("m1", grid(primitive))} presentedByHostRecordId="m1" />,
      );
      const unclaimed = render(
        <ChatMessage message={message("m1", grid(primitive))} presentedByHostRecordId="other" />,
      );
      // Whatever the renderer decides to DO with a presentation — draw it, or
      // refuse it as an invalid contract, which is what CHART does with this
      // deliberately generic payload — claiming removes all of it. Asserting
      // only on the drawn case would have let a refusal notice render twice.
      const mounted = (markup: string) =>
        markup.includes("jasim-surface") || markup.includes("presentation-blocked");
      expect(mounted(claimed), primitive).toBe(false);
      expect(mounted(unclaimed), primitive).toBe(true);
      // And the turn's words survive either way.
      expect(claimed, primitive).toContain("نتيجة.");
    }
  });

  it("a claim is not a licence to hide a DIFFERENT turn's words or surface", () => {
    // A user turn and a plain reply are unaffected by any claim.
    const user = { id: "m1", role: "user", content: "ابحث", createdAt: "2026-10-01T00:00:00.000Z" } as never;
    expect(render(<ChatMessage message={user} presentedByHostRecordId="m1" />)).toContain("ابحث");
  });

  it("nothing is hidden rather than not drawn — a screen reader sees one too", () => {
    //   ACCESSIBILITY_TREE_DUPLICATE_PRESENTATION = 0
    //
    // The claimed surface is NOT RENDERED. Hiding it with CSS would leave it in
    // the accessibility tree and in the tab order, which is the failure this
    // phase was told not to ship.
    const claimed = render(
      <ChatMessage message={message("m1", grid())} presentedByHostRecordId="m1" />,
    );
    const unclaimed = render(
      <ChatMessage message={message("m1", grid())} presentedByHostRecordId={null} />,
    );
    //
    // ── WHY NOT A BARE `not.toContain("aria-hidden")` ────────────────────
    //
    // That was this assertion's first form, and it fired on the decorative
    // icons every message bubble already draws — markup that has nothing to do
    // with a duplicated surface. A guard that cannot tell the thing it forbids
    // from ordinary page furniture is a guard nobody can keep.
    //
    // So: the surface is ABSENT, not hidden. No card element, no hiding
    // mechanism around one, and the only difference from the unclaimed render
    // is the surface itself.
    expect(claimed).not.toContain("<article");
    expect(claimed).not.toContain("ratedDepth");
    expect(unclaimed).toContain("<article");
    for (const hide of ["display:none", "visibility:hidden", "sr-only", "hidden=\"\"", "opacity:0"]) {
      expect(claimed, hide).not.toContain(hide);
    }
    // Nothing else about the turn changed.
    expect(claimed.length).toBeLessThan(unclaimed.length);
    expect(claimed).toContain("نتيجة.");
  });

  it("no production file decides ownership by kind, shape or domain", () => {
    //   PRESENTATION_KIND_DEDUPE_BRANCHES = 0 · DOMAIN_DEDUPE_BRANCHES = 0
    //
    // Comments stripped: prose ABOUT the rule is not an encoding of it.
    const files = [
      "src/components/chat/ChatMessage.tsx",
      "src/components/chat/JasimChat.tsx",
      "src/components/jasim-core/ActiveGenerativeWorkspace.tsx",
      "api/runtime/active-workspace-projection.ts",
    ];
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");
      // The ownership decision may not read a primitive name...
      for (const primitive of ["ENTITY_GRID", "SEARCH_RESULTS", "resultSetId", "candidates"]) {
        expect(
          new RegExp(`presentedByHost[\\s\\S]{0,400}${primitive}`).test(code),
          `${file} :: ${primitive}`,
        ).toBe(false);
      }
      // ...nor a domain.
      for (const domain of ["car", "hotel", "product", "search", "restaurant", "job"]) {
        expect(
          new RegExp(`(?<![\\p{L}\\p{N}])${domain}(?![\\p{L}\\p{N}])[\\s\\S]{0,120}presentedByHost`, "iu").test(code),
          `${file} :: ${domain}`,
        ).toBe(false);
      }
    }
  });

  it("the claim is announced, never computed during another component's render", () => {
    // A host that is collapsed, stale, erroring, loading or empty draws nothing
    // and so must claim nothing — otherwise the record's own copy is hidden and
    // the person is left with neither.
    const code = readFileSync("src/components/jasim-core/ActiveGenerativeWorkspace.tsx", "utf8");
    const claim = code.slice(code.indexOf("const presentingRecordId"), code.indexOf("if (!conversationId) return null;"));
    for (const guard of ["isLoading", "isError", "isStale", "meaningful", "isCollapsed", "currentPresentation"]) {
      expect(claim, guard).toContain(guard);
    }
    // Released on unmount, so a host that goes away gives the record back.
    expect(code).toContain("return () => onPresentingRecord?.(null);");
  });
});
