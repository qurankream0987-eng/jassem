import { describe, expect, it } from "vitest";
import {
  projectStructuredResult,
  routePresentation,
  validatePresentationDefinition,
} from "../../api/runtime/presentation-fabric";
import {
  presentationForConversationEnvelope,
  type ConversationOutputEnvelope,
} from "../../api/runtime/jasim-runtime";

const decisionId = "00000000-0000-4000-8000-000000000001";

describe("Smart UI Task 1 presentation boundary", () => {
  it("projects a valid structured result through the live conversation seam", () => {
    const envelope: ConversationOutputEnvelope = {
      version: 1,
      decisionId,
      kind: "structured_result",
      label: "Search result",
      summary: "One verified result",
      data: { candidates: [{ id: "candidate-1", title: "Result" }] },
      confidence: 0.9,
    };

    const presentation = presentationForConversationEnvelope(envelope);

    expect(["SEARCH_RESULTS", "ENTITY_LIST", "ENTITY_GRID"]).toContain(
      presentation.primitive,
    );
    expect(validatePresentationDefinition(presentation)).toEqual(presentation);
  });

  it("rejects an invalid presentation schema before rendering", () => {
    expect(() =>
      validatePresentationDefinition({
        primitive: "CARD",
        version: 2,
        data: {},
      }),
    ).toThrow();
  });

  it("blocks unknown presentation types instead of resolving arbitrary components", () => {
    expect(() =>
      validatePresentationDefinition({
        primitive: "EVAL",
        version: 1,
        data: {},
      }),
    ).toThrow();
  });

  it("blocks malformed or unknown privileged actions", () => {
    expect(() =>
      validatePresentationDefinition({
        primitive: "APPROVAL",
        version: 1,
        data: { action: "Change state" },
        actions: [{ intent: "execute arbitrary code", label: "Run" }],
      }),
    ).toThrow();
  });

  it("keeps plain text on the existing text path", () => {
    const presentation = routePresentation({
      interactionNeed: "inform",
      data: { content: "A plain answer" },
    });

    expect(presentation.primitive).toBe("TEXT");
    expect(presentation.data.content).toBe("A plain answer");
  });

  it("keeps Smart Bubble output on the existing bubble presentation primitive", () => {
    const presentation = routePresentation({
      interactionNeed: "operate_persistent",
      data: { title: "Existing bubble" },
    });
    const structured = projectStructuredResult({
      label: "Bubble regression",
      summary: "Legacy bubbles remain separate from the new projection.",
      data: { presentation },
    });

    expect(presentation.primitive).toBe("SMART_BUBBLE");
    expect(["DETAIL", "TEXT"]).toContain(structured.primitive);
    expect(validatePresentationDefinition(structured)).toEqual(structured);
  });
});