import { describe, expect, it } from "vitest";
import {
  decidePresentation,
  validatePresentationDefinition,
} from "../../api/runtime/presentation-fabric";

const base = {
  interactionNeed: "inform" as const,
  data: {},
};

describe("Smart UI Task 2 presentation decision layer", () => {
  it("chooses TEXT for a simple factual response", () => {
    expect(
      decidePresentation({ ...base, semanticOutput: "text", data: { answer: "42" } }).primitive,
    ).toBe("TEXT");
  });

  it("chooses a search-result family for a generic candidate collection", () => {
    const presentation = decidePresentation({
      ...base,
      semanticOutput: "candidates",
      interactionNeed: "show_result",
      resultSetPresent: true,
      resultCount: 3,
      candidates: [{ id: "a" }, { id: "b" }, { id: "c" }],
      data: {},
    });
    expect(["SEARCH_RESULTS", "ENTITY_LIST", "ENTITY_GRID"]).toContain(presentation.primitive);
  });

  it("chooses COMPARISON for explicit comparison semantics", () => {
    expect(
      decidePresentation({
        ...base,
        interactionNeed: "compare",
        semanticOutput: "comparison",
        referencedEntityCount: 2,
        candidates: [{ id: "a" }, { id: "b" }],
        data: {},
      }).primitive,
    ).toBe("COMPARISON");
  });

  it("chooses FORM when multiple structured inputs are required", () => {
    expect(
      decidePresentation({
        ...base,
        interactionNeed: "collect_input",
        semanticOutput: "input",
        requiresStructuredInput: true,
        missingFields: [
          { name: "date", type: "string" },
          { name: "time", type: "string" },
          { name: "partySize", type: "number" },
        ],
        data: {},
      }).primitive,
    ).toBe("FORM");
  });

  it("chooses APPROVAL for a consequential action", () => {
    expect(
      decidePresentation({
        ...base,
        actionability: "consequential",
        actionRisk: "high",
        approvalSummary: { action: "Apply change" },
        data: {},
      }).primitive,
    ).toBe("APPROVAL");
  });

  it("chooses CHECKOUT for a financial approval state", () => {
    expect(
      decidePresentation({
        ...base,
        actionability: "consequential",
        actionRisk: "high",
        transactionState: "checkout_ready",
        hasFinancialEffect: true,
        approvalSummary: { action: "Confirm payment" },
        data: {},
      }).primitive,
    ).toBe("CHECKOUT");
  });

  it("chooses a status family for an ongoing process", () => {
    expect(
      decidePresentation({
        ...base,
        ongoing: true,
        transactionState: "ongoing",
        data: { state: "running" },
      }).primitive,
    ).toBe("STATUS");
  });

  it("chooses timeline for history and tracker for tracking", () => {
    expect(
      decidePresentation({
        ...base,
        interactionNeed: "show_history",
        events: [{ at: "now", semantics: "started" }],
        data: {},
      }).primitive,
    ).toBe("TIMELINE");
    expect(
      decidePresentation({
        ...base,
        interactionNeed: "track",
        ongoing: true,
        data: {},
      }).primitive,
    ).toBe("TRACKER");
  });

  it("does not select MAP without trusted real coordinates", () => {
    const presentation = decidePresentation({
      ...base,
      interactionNeed: "track",
      ongoing: true,
      observation: { status: "moving" },
      data: {},
    });
    expect(presentation.primitive).toBe("TRACKER");
    expect(presentation.children?.some((child) => child.primitive === "MAP")).toBe(false);
  });

  it("uses DOCUMENT semantics for a document summary, never a World", () => {
    const presentation = decidePresentation({
      ...base,
      semanticOutput: "document",
      documentSummary: true,
      data: { summary: "A document summary" },
    });
    expect(presentation.primitive).toBe("DOCUMENT");
    expect(presentation.primitive).not.toBe("WORLD_SUMMARY");
  });

  it("changes presentation with intent while keeping the same generic entity shape", () => {
    const entityData = { entity: { id: "same-shape", attributes: { value: 1 } } };
    expect(
      decidePresentation({ ...base, semanticOutput: "text", data: entityData }).primitive,
    ).toBe("TEXT");
    expect(
      decidePresentation({
        ...base,
        interactionNeed: "compare",
        semanticOutput: "comparison",
        referencedEntityCount: 2,
        candidates: [{ id: "a" }, { id: "b" }],
        data: entityData,
      }).primitive,
    ).toBe("COMPARISON");
    expect(
      decidePresentation({
        ...base,
        actionability: "consequential",
        approvalSummary: { action: "Change entity" },
        data: entityData,
      }).primitive,
    ).toBe("APPROVAL");
  });

  it("uses the same candidate decision for different domain-shaped payloads", () => {
    const first = decidePresentation({
      ...base,
      interactionNeed: "show_result",
      semanticOutput: "candidates",
      resultSetPresent: true,
      resultCount: 2,
      candidates: [{ id: "one", category: "alpha" }, { id: "two", category: "alpha" }],
      data: {},
    });
    const second = decidePresentation({
      ...base,
      interactionNeed: "show_result",
      semanticOutput: "candidates",
      resultSetPresent: true,
      resultCount: 2,
      candidates: [{ id: "one", category: "beta" }, { id: "two", category: "beta" }],
      data: {},
    });
    expect(second.primitive).toBe(first.primitive);
  });

  it("falls back safely to TEXT for an unknown/non-rich semantic output", () => {
    expect(
      decidePresentation({ ...base, semanticOutput: "unknown", data: { value: "plain" } }).primitive,
    ).toBe("TEXT");
  });

  it("keeps Task 1 validation active for a selected definition", () => {
    const selected = decidePresentation({ ...base, semanticOutput: "text", data: {} });
    expect(validatePresentationDefinition(selected)).toEqual(selected);
    expect(() =>
      validatePresentationDefinition({
        primitive: "WORKSPACE",
        version: 2,
        data: {},
      }),
    ).toThrow();
  });

  it("preserves plain text and Smart Bubble regressions", () => {
    expect(
      decidePresentation({ ...base, interactionNeed: "inform", semanticOutput: "text", data: {} })
        .primitive,
    ).toBe("TEXT");
    expect(
      decidePresentation({
        ...base,
        interactionNeed: "operate_persistent",
        persistent: true,
        data: { title: "Existing bubble" },
      }).primitive,
    ).toBe("SMART_BUBBLE");
  });
});