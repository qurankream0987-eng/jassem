/**
 * JASIM — A CONTROL IS BACKED, OR IT IS NOT DRAWN.
 *
 * Once a draft review took the host, the discovery grid returned to its own
 * message, and its six select controls went to `handleActionClick` — which
 * needs a REGISTERED SMART BUBBLE and otherwise answers «لا يملك سطحًا موثوقًا
 * متاحًا الآن». They looked exactly as pressable as before, and were not.
 *
 *   VISIBLE_CONTROL != EXECUTION_PERMISSION
 *   VISIBLE_SELECT_WITH_NO_TRUSTED_PATH = 0
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessage } from "../../src/components/chat/ChatMessage";
import {
  candidateActionTarget,
  presentationActionsAreDispatchable,
} from "../../src/components/jasim-core/candidateActionTarget";

const candidate = (ref: string, over: Record<string, unknown> = {}) => ({
  ref, id: ref, title: "عنصر",
  provenance: { canonicalKind: "economic_expression", version: 2 },
  actions: [{ intent: "select", label: "select" }],
  ...over,
});

const surface = (...candidates: unknown[]) => ({
  primitive: "ENTITY_GRID", version: 1, data: { candidates },
});

const message = (presentation: unknown) =>
  ({ id: "m1", role: "assistant", content: "نتيجة.", createdAt: "2026-10-01T00:00:00.000Z",
     metadata: { presentation } }) as never;

const render = (presentation: unknown, handler?: (intent: string, p: unknown) => void) =>
  renderToStaticMarkup(
    <ChatMessage message={message(presentation)} onPresentationAction={handler} />,
  );

describe("a select control in the conversation is backed or absent", () => {
  it("a canonically addressable surface draws its controls", () => {
    const markup = render(surface(candidate("expr_1"), candidate("expr_2")), () => {});
    expect(markup).toContain('data-action-intent="select"');
    expect(markup).toContain('data-reference="expr_1"');
    expect(markup).toContain('data-reference="expr_2"');
  });

  it("with no handler at all, the card draws no button — the existing condition", () => {
    const markup = render(surface(candidate("expr_1")));
    expect(markup).not.toContain("data-action-intent");
    // The card itself is still there; only the control is gone.
    expect(markup).toContain("عنصر");
  });

  it("a card with an action but nothing canonical to act on draws no control", () => {
    //   MESSAGE_METADATA != EXECUTION_AUTHORITY
    //
    // A stored surface somebody tampered with, or one written before actions
    // carried provenance, must not present an enabled button. It presents none.
    for (const broken of [
      candidate("expr_1", { provenance: {} }),
      candidate("expr_1", { provenance: { canonicalKind: "economic_expression" } }),
      candidate("expr_1", { provenance: undefined }),
      candidate("expr_1", { ref: undefined, id: undefined }),
    ]) {
      expect(render(surface(broken), () => {}), JSON.stringify(broken))
        .not.toContain("data-action-intent");
    }
  });

  it("one unbacked card disables the whole surface's controls, never half of them", () => {
    // A renderer takes ONE callback, so «some pressable, some not» is not a
    // state this can express honestly. All or none.
    const mixed = surface(candidate("expr_1"), candidate("expr_2", { provenance: {} }));
    expect(presentationActionsAreDispatchable(mixed)).toBe(false);
    expect(render(mixed, () => {})).not.toContain("data-action-intent");
  });

  it("a surface with no actions asks for no handler", () => {
    const review = { primitive: "DETAIL", version: 1, data: { entity: { ref: "ord_1", title: "ط" } } };
    expect(presentationActionsAreDispatchable(review)).toBe(false);
    expect(presentationActionsAreDispatchable(surface())).toBe(false);
    expect(presentationActionsAreDispatchable(null)).toBe(false);
  });

  it("the press names the card's own thing, never its place", () => {
    //   SELECT_BY_POSITION = 0 · SELECT_BY_CARD_INDEX = 0 · SELECT_BY_TITLE = 0
    const first = candidate("expr_a");
    const fifth = candidate("expr_e");
    const forward = candidateActionTarget(surface(first, fifth), "select:expr_e");
    const reversed = candidateActionTarget(surface(fifth, first), "select:expr_e");
    expect(forward).toEqual(reversed);
    expect(forward!.reference.id).toBe("expr_e");
    // An ordinal is not an identity and resolves to nothing.
    for (const press of ["select:5", "select:الخامس", "select:عنصر"]) {
      expect(candidateActionTarget(surface(first, fifth), press), press).toBeNull();
    }
  });

  it("the conversation press does not route through the smart-bubble path", () => {
    //   MESSAGE != SMART_BUBBLE
    const chat = readFileSync("src/components/chat/ChatMessage.tsx", "utf8");
    const block = chat.slice(chat.indexOf("shouldRenderPresentation ? ("), chat.indexOf("Inline Actions"));
    expect(block).toContain("onPresentationAction");
    // The old route needed `message.bubbleData` and a registered bubble.
    expect(block).not.toContain("bubbleData");
    expect(block).not.toContain("onActionClick");
  });

  it("the conversation press reaches the SAME dispatch as the host", () => {
    //   EXISTING_SERVER_SELECTION_RUNTIME_REUSED · NEW_GENERIC_UI_EXECUTOR = NO
    const home = readFileSync("src/pages/Home.tsx", "utf8");
    const handler = home.slice(
      home.indexOf("const dispatchConversationPresentationAction"),
      home.indexOf("const dispatchWorkspaceSubmit"),
    );
    // One dispatch function, called with a truthful source.
    expect(handler).toContain("dispatchWorkspaceAction(");
    expect(handler).toContain("'CONVERSATION'");
    // And it builds no envelope of its own, names no procedure, and invents
    // no action type — the three shapes of a generic UI executor.
    expect(handler).not.toContain("createTrustedActionEnvelope");
    expect(handler).not.toContain("actionType");
    expect(handler).not.toContain("trpc");
  });

  it("no approval control was added to the draft review", () => {
    //   DRAFT_REVIEW_APPROVAL_CONTROLS_ADDED = 0
    const fabric = readFileSync("api/runtime/presentation-fabric.ts", "utf8");
    const builder = fabric.slice(
      fabric.indexOf("export function projectDraftOrderForReview"),
      fabric.indexOf("export function projectStructuredResult"),
    );
    expect(builder).not.toContain("actions");
    for (const verb of ["approve", "confirm", "buy", "pay", "send"]) {
      expect(builder.toLowerCase(), verb).not.toContain(verb);
    }
  });
});
