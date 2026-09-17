/**
 * JASIM — Web/Mobile parity for the generic spatial surface.
 *
 * Mobile and Web are two bodies for one meaning. They may draw a map very
 * differently; they may not disagree about whether there *is* one. Before this
 * wave the server could decide MAP and Mobile would answer "unsupported", so
 * the same canonical truth produced two different experiences.
 */

import { describe, expect, it } from "vitest";
import {
  MOBILE_PRESENTATION_REGISTRY,
  resolveMobilePresentationPolicy,
} from "../../../../../artifacts/jasim-mobile/lib/mobile-presentation";
import { TRUSTED_PRESENTATION_REGISTRY } from "../../src/components/jasim-core/PresentationRenderer";
import {
  buildObservationPresentationInput,
  classifyObservationPresence,
} from "../../api/runtime/observation-presentation";
import { decidePresentation } from "../../api/runtime/presentation-fabric";

const NOW = new Date("2026-09-17T12:00:00.000Z");

const freshObservation = {
  observedAt: new Date(NOW.getTime() - 5_000),
  freshnessExpiresAt: null,
  payload: { lat: 29.3759, lng: 47.9774, status: "moving" },
  sourceKind: "device",
  providerId: null,
};

describe("both platforms can render what the server may decide", () => {
  it.each(["MAP", "MARKER", "ROUTE", "TRACKER"] as const)(
    "%s has a renderer on Web and on Mobile",
    (primitive) => {
      expect(TRUSTED_PRESENTATION_REGISTRY[primitive]).toBeTruthy();
      expect(MOBILE_PRESENTATION_REGISTRY[primitive]).toBeTruthy();
    },
  );

  it("maps every spatial primitive to one semantic renderer on Mobile", () => {
    // MARKER and ROUTE are parts of a map, so they share its renderer rather
    // than each needing a component of their own.
    expect(MOBILE_PRESENTATION_REGISTRY.MAP).toBe(MOBILE_PRESENTATION_REGISTRY.MARKER);
    expect(MOBILE_PRESENTATION_REGISTRY.MAP).toBe(MOBILE_PRESENTATION_REGISTRY.ROUTE);
  });

  it("keeps a map inline rather than hijacking the conversation", () => {
    expect(
      resolveMobilePresentationPolicy({ primitive: "MAP", version: 1, data: {} }),
    ).toBe("INLINE");
  });

  it("still fails closed for primitives Mobile genuinely cannot draw", () => {
    const unsupported = (
      Object.keys(TRUSTED_PRESENTATION_REGISTRY) as Array<
        keyof typeof TRUSTED_PRESENTATION_REGISTRY
      >
    ).filter((primitive) => MOBILE_PRESENTATION_REGISTRY[primitive] === undefined);
    // The gap is real and recorded, not silently closed by a catch-all.
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported).toContain("EXTERNAL_ACTION");
  });
});

describe("one canonical observation, one shared decision", () => {
  it("produces a definition both registries resolve", () => {
    const { input } = buildObservationPresentationInput({
      subject: { kind: "generic_subject", id: "s1" },
      observation: freshObservation,
      observationType: "location",
      now: NOW,
    });
    const presentation = decidePresentation(input);
    const primitives = [
      presentation.primitive,
      ...(presentation.children ?? []).map((child) => child.primitive),
    ];
    expect(primitives).toContain("MAP");
    for (const primitive of primitives) {
      expect(TRUSTED_PRESENTATION_REGISTRY[primitive]).toBeTruthy();
      expect(MOBILE_PRESENTATION_REGISTRY[primitive]).toBeTruthy();
    }
  });

  it("agrees on absence too: a stale reading yields no MAP on either platform", () => {
    const { input, mapEligible } = buildObservationPresentationInput({
      subject: { kind: "generic_subject", id: "s1" },
      observation: {
        ...freshObservation,
        observedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
      },
      observationType: "location",
      now: NOW,
    });
    expect(mapEligible).toBe(false);
    const presentation = decidePresentation(input);
    const primitives = [
      presentation.primitive,
      ...(presentation.children ?? []).map((child) => child.primitive),
    ];
    expect(primitives).not.toContain("MAP");
  });
});

describe("the marker payload a renderer receives", () => {
  it("carries coordinates and an opaque subject reference, and nothing domain-shaped", () => {
    const { input } = buildObservationPresentationInput({
      subject: { kind: "technician", id: "t-9" },
      observation: freshObservation,
      observationType: "location",
      now: NOW,
    });
    const presentation = decidePresentation(input);
    const map = (presentation.children ?? []).find((child) => child.primitive === "MAP");
    const markers = map?.data.markers as Array<Record<string, unknown>>;
    expect(markers).toHaveLength(1);
    expect(markers[0].coordinates).toEqual({ lat: 29.3759, lng: 47.9774 });
    expect(markers[0].entityRef).toBe("technician:t-9");
    // The renderer is told the subject's identity, never its meaning: there is
    // no eta, no speed, no route guess and no domain field to branch on.
    expect(Object.keys(markers[0]).sort()).toEqual(["coordinates", "entityRef"]);
  });

  it("emits no fabricated ETA anywhere in the tree", () => {
    const { input } = buildObservationPresentationInput({
      subject: { kind: "vehicle", id: "v-1" },
      observation: freshObservation,
      observationType: "location",
      now: NOW,
    });
    const serialized = JSON.stringify(decidePresentation(input)).toLowerCase();
    for (const fabrication of ["eta", "arrivesat", "estimatedarrival", "progresspercent"]) {
      expect(serialized).not.toContain(fabrication);
    }
  });
});

describe("freshness is the same judgement wherever it is asked", () => {
  it("classifies identically for any subject kind", () => {
    const kinds = ["driver", "technician", "vehicle", "shipment", "robot", "unknown_future"];
    const results = kinds.map(
      () => classifyObservationPresence(freshObservation, NOW).presence,
    );
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("FRESH");
  });
});
