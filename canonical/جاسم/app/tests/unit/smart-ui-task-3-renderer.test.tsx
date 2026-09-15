import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { decidePresentation } from "../../api/runtime/presentation-fabric";
import { PresentationRenderer } from "../../src/components/jasim-core/PresentationRenderer";
import { TRUSTED_PRESENTATION_REGISTRY } from "../../src/components/jasim-core/PresentationRenderer";

function render(presentation: unknown): string {
  return renderToStaticMarkup(<PresentationRenderer presentation={presentation} />);
}

describe("Smart UI Task 3 generic schema renderer primitives", () => {
  it("renders TEXT through the trusted registry", () => {
    expect(render({ primitive: "TEXT", version: 1, data: { text: "Hello JASIM" } })).toContain(
      "Hello JASIM",
    );
  });

  it("renders a generic EntityCard with semantic attributes", () => {
    const markup = render({
      primitive: "ENTITY_CARD",
      version: 1,
      data: {
        entity: {
          ref: "laptop-1",
          title: "Portable device",
          attributes: { memory: "32 GB", price: "399 KWD" },
        },
      },
    });
    expect(markup).toContain("Portable device");
    expect(markup).toContain("32 GB");
    expect(markup).toContain("399 KWD");
  });

  it("renders SEARCH_RESULTS as a generic collection without domain components", () => {
    const markup = render({
      primitive: "SEARCH_RESULTS",
      version: 1,
      data: {
        candidates: [
          { ref: "candidate-1", title: "First candidate", attributes: { kind: "alpha" } },
          { ref: "candidate-2", title: "Second candidate", attributes: { kind: "beta" } },
        ],
      },
    });
    expect(markup).toContain("First candidate");
    expect(markup).toContain("Second candidate");
    expect(markup).toContain("alpha");
    expect(markup).not.toContain("CarCard");
    expect(markup).not.toContain("JobCard");
  });

  it("renders COMPARISON for multiple generic entities", () => {
    const markup = render({
      primitive: "COMPARISON",
      version: 1,
      data: {
        candidates: [
          { ref: "one", title: "One", attributes: { score: "A" } },
          { ref: "two", title: "Two", attributes: { score: "B" } },
        ],
      },
    });
    expect(markup).toContain("One");
    expect(markup).toContain("Two");
    expect(markup).toContain("score");
  });

  it("renders DETAIL for a structured entity", () => {
    const markup = render({
      primitive: "DETAIL",
      version: 1,
      data: {
        entity: {
          title: "A structured resource",
          summary: "A safe summary",
          attributes: { availability: "Known" },
        },
      },
    });
    expect(markup).toContain("A structured resource");
    expect(markup).toContain("A safe summary");
    expect(markup).toContain("Known");
  });

  it("renders validated FORM fields without executing business operations", () => {
    const markup = render({
      primitive: "FORM",
      version: 1,
      data: {},
      fields: [
        { name: "name", label: "Name", type: "string", requiredNow: true },
        { name: "count", label: "Count", type: "number" },
        { name: "enabled", label: "Enabled", type: "boolean" },
      ],
    });
    expect(markup).toContain("Name");
    expect(markup).toContain("Count");
    expect(markup).toContain("Enabled");
    expect(markup).toContain("Submit");
  });

  it("renders CHOICE with a stable trusted reference, not only an array index", () => {
    const markup = render({
      primitive: "CHOICE",
      version: 1,
      data: {
        options: [{ ref: "entity-stable-7", label: "Choose this entity" }],
      },
    });
    expect(markup).toContain("Choose this entity");
    expect(markup).toContain('data-reference="entity-stable-7"');
    expect(markup).toContain('data-action-intent="select"');
  });

  it("renders APPROVAL summary and only the validated typed actions", () => {
    const markup = render({
      primitive: "APPROVAL",
      version: 1,
      data: {
        action: "Apply change",
        target: "entity-1",
        stateChanges: ["Status becomes active"],
      },
      actions: [
        { intent: "approve", label: "Approve", requiresApproval: true },
        { intent: "reject", label: "Reject" },
      ],
    });
    expect(markup).toContain("Apply change");
    expect(markup).toContain("entity-1");
    expect(markup).toContain("Approve");
    expect(markup).toContain("Reject");
  });

  it("renders STATUS truthfully without inventing progress", () => {
    const markup = render({
      primitive: "STATUS",
      version: 1,
      data: { status: "PROCESSING", summary: "Work is in progress." },
    });
    expect(markup).toContain("PROCESSING");
    expect(markup).toContain("Work is in progress.");
    expect(markup).not.toContain("%");
  });

  it("renders TIMELINE events supplied by runtime only", () => {
    const markup = render({
      primitive: "TIMELINE",
      version: 1,
      data: {
        events: [{ at: "2026-09-11", semantics: "started", state: "current" }],
      },
    });
    expect(markup).toContain("started");
    expect(markup).toContain("2026-09-11");
    expect(markup).not.toContain("shipped");
  });

  it("keeps unknown primitives fail-closed", () => {
    expect(render({ primitive: "UNKNOWN", version: 1, data: {} })).toContain(
      "blocked because its runtime contract was invalid",
    );
  });

  it("keeps malformed definitions rejected by the Task 1 validator", () => {
    expect(render({ primitive: "TEXT", version: 2, data: {} })).toContain(
      "blocked because its runtime contract was invalid",
    );
  });

  it("does not render or execute unsupported actions", () => {
    expect(render({
      primitive: "TEXT",
      version: 1,
      data: { text: "safe" },
      actions: [{ intent: "delete_everything", label: "Delete everything" }],
    })).toContain("blocked because its runtime contract was invalid");
  });

  it("uses the same generic card architecture for unrelated entity shapes", () => {
    const laptop = render({
      primitive: "ENTITY_CARD",
      version: 1,
      data: { entity: { ref: "laptop", title: "Device", attributes: { memory: "32 GB" } } },
    });
    const service = render({
      primitive: "ENTITY_CARD",
      version: 1,
      data: { entity: { ref: "service", title: "Repair", attributes: { duration: "2 hours" } } },
    });
    expect(laptop).toContain("memory");
    expect(service).toContain("duration");
    expect(laptop).not.toContain("DeviceCard");
    expect(service).not.toContain("ServiceCard");
  });

  it("uses the same generic comparison architecture for unrelated entities", () => {
    const first = render({
      primitive: "COMPARISON",
      version: 1,
      data: { candidates: [{ title: "Device", attributes: { memory: "32 GB" } }] },
    });
    const second = render({
      primitive: "COMPARISON",
      version: 1,
      data: { candidates: [{ title: "Role", attributes: { location: "Remote" } }] },
    });
    expect(first).toContain("memory");
    expect(second).toContain("location");
  });

  it("preserves plain text and Smart Bubble regressions", () => {
    expect(render({ primitive: "TEXT", version: 1, data: { text: "plain" } })).toContain("plain");
    expect(render({ primitive: "SMART_BUBBLE", version: 1, data: { title: "Bubble" } })).toContain(
      "Bubble",
    );
  });

  it("integrates Task 2 decision output with the Task 3 renderer", () => {
    const decision = decidePresentation({
      interactionNeed: "show_result",
      semanticOutput: "candidates",
      resultSetPresent: true,
      resultCount: 2,
      candidates: [
        { ref: "a", title: "Generic A", attributes: { type: "one" } },
        { ref: "b", title: "Generic B", attributes: { type: "two" } },
      ],
      data: {},
    });
    const markup = render(decision);
    expect(decision.primitive).toBe("SEARCH_RESULTS");
    expect(markup).toContain("Generic A");
    expect(markup).toContain("Generic B");
  });

  it("keeps every supported core primitive behind the local registry", () => {
    expect(TRUSTED_PRESENTATION_REGISTRY.SEARCH_RESULTS).toBe("entity_list");
    expect(TRUSTED_PRESENTATION_REGISTRY.COMPARISON).toBe("comparison");
    expect(TRUSTED_PRESENTATION_REGISTRY.WORKSPACE).toBeNull();
  });
});