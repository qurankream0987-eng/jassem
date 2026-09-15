import { describe, expect, it } from "vitest";
import {
  MOBILE_PRESENTATION_REGISTRY,
  resolveMobilePresentationPolicy,
} from "../../../../../artifacts/jasim-mobile/lib/mobile-presentation";
import {
  createMobileTrustedAction,
  parseLivingObjectsProjection,
} from "../../../../../artifacts/jasim-mobile/lib/semantic-runtime";

describe("Smart UI Task 8B1 — native mobile semantic renderer", () => {
  it("uses one static allowlisted registry for the required semantic primitives", () => {
    expect(MOBILE_PRESENTATION_REGISTRY.TEXT).toBe("text");
    expect(MOBILE_PRESENTATION_REGISTRY.DETAIL).toBe("entity");
    expect(MOBILE_PRESENTATION_REGISTRY.SEARCH_RESULTS).toBe("collection");
    expect(MOBILE_PRESENTATION_REGISTRY.COMPARISON).toBe("comparison");
    expect(MOBILE_PRESENTATION_REGISTRY.FORM).toBe("form");
    expect(MOBILE_PRESENTATION_REGISTRY.CHOICE).toBe("choice");
    expect(MOBILE_PRESENTATION_REGISTRY.APPROVAL).toBe("approval");
    expect(MOBILE_PRESENTATION_REGISTRY.STATUS).toBe("status");
    expect(MOBILE_PRESENTATION_REGISTRY.TIMELINE).toBe("timeline");
    expect(MOBILE_PRESENTATION_REGISTRY.WARNING).toBe("state");
    expect(MOBILE_PRESENTATION_REGISTRY.ERROR_STATE).toBe("state");
    expect(MOBILE_PRESENTATION_REGISTRY.EMPTY_STATE).toBe("state");
    expect(MOBILE_PRESENTATION_REGISTRY.DOCUMENT).toBe("document");
  });

  it("fails closed for primitives without a native renderer", () => {
    expect(MOBILE_PRESENTATION_REGISTRY.WORKSPACE).toBeUndefined();
    expect(MOBILE_PRESENTATION_REGISTRY.MAP).toBeUndefined();
    expect(MOBILE_PRESENTATION_REGISTRY.EXTERNAL_ACTION).toBeUndefined();
  });

  it("assigns mobile presentation policy without using domain-specific branches", () => {
    expect(resolveMobilePresentationPolicy({
      primitive: "TEXT",
      version: 1,
      data: { text: "hello" },
    })).toBe("INLINE");
    expect(resolveMobilePresentationPolicy({
      primitive: "FORM",
      version: 1,
      data: {},
    })).toBe("BOTTOM_SHEET");
    expect(resolveMobilePresentationPolicy({
      primitive: "COMPARISON",
      version: 1,
      data: { items: [] },
    })).toBe("EXPANDED");
    expect(resolveMobilePresentationPolicy({
      primitive: "MEDIA",
      version: 1,
      data: {},
    })).toBe("FULL_SCREEN_TEMPORARY");
  });

  it("keeps unrelated entity fixtures on the same generic collection path", () => {
    const fixture = {
      primitive: "SEARCH_RESULTS" as const,
      version: 1 as const,
      data: {
        candidates: [
          { id: "car-1", title: "سيارة", attributes: { year: 2024 } },
          { id: "job-1", title: "وظيفة", attributes: { location: "الرياض" } },
        ],
      },
    };
    expect(MOBILE_PRESENTATION_REGISTRY[fixture.primitive]).toBe("collection");
    expect(fixture.data.candidates).toHaveLength(2);
  });

  it("keeps form, choice, and approval actions on the version-bound dispatcher contract", () => {
    for (const [actionType, intent] of [
      ["SUBMIT_INPUT", "submit"],
      ["SELECT_ENTITY", "select"],
      ["APPROVE_PROPOSAL", "approve"],
    ] as const) {
      const action = createMobileTrustedAction({
        actionId: `mobile-8b1-${intent}`,
        actionType,
        intent,
        source: "PRESENTATION",
        targetReference: { kind: "runtime_run", id: "run-1" },
        presentationReference: { kind: "workspace", id: "workspace-1" },
        expectedPresentationVersion: "presentation:1",
        payload: { values: { choice: "accepted" } },
      });
      expect(action.actionType).toBe(actionType);
      expect(action.presentationReference?.kind).toBe("workspace");
    }
  });

  it("rejects protected truth fields from native presentation payloads", () => {
    expect(() => createMobileTrustedAction({
      actionId: "mobile-8b1-protected",
      actionType: "SUBMIT_INPUT",
      intent: "submit",
      source: "PRESENTATION",
      targetReference: { kind: "runtime_task", id: "task-1" },
      presentationReference: { kind: "workspace", id: "workspace-1" },
      expectedPresentationVersion: "presentation:1",
      payload: { ownerId: "forbidden" },
    })).toThrow("ownerId");
  });

  it("accepts living objects whose progress is absent in canonical output", () => {
    const projection = parseLivingObjectsProjection({
      kind: "living_objects_projection",
      version: 1,
      limit: 1,
      generatedAt: "2026-09-12T07:32:07.025Z",
      objects: [{
        id: "living:runtime_run:run-1",
        underlyingReference: { kind: "runtime_run", id: "run-1" },
        relatedReferences: [{ kind: "runtime_run", id: "run-1" }],
        semanticType: "process",
        title: "Process",
        summary: "A process",
        status: "FAILED",
        attention: { level: "FAILED", reason: "Failed" },
        progress: null,
        primaryAction: {
          intent: "review",
          label: "Review",
          reference: { kind: "runtime_run", id: "run-1" },
        },
        secondaryActions: [],
        updatedAt: "2026-09-12T07:32:07.025Z",
        createdAt: "2026-09-12T07:32:07.025Z",
        presentationVersion: "living:2026-09-12T07:32:07.025Z",
        durability: "ongoing",
        completion: "failed",
      }],
    });
    expect(projection.objects).toHaveLength(1);
    expect(projection.objects[0]?.progress).toBeNull();
  });
});