/**
 * JASIM — observation → presentation bridge.
 *
 * The invariant under test is not "a map renders". It is that a map renders
 * ONLY from a trusted, fresh, finite coordinate, and that every other case
 * degrades to a truthful surface instead of a convincing one. A stale point
 * shown as a live point is the failure this file exists to prevent.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_OBSERVATION_PRESENTATION_POLICY,
  buildObservationPresentationInput,
  classifyObservationPresence,
  coordinatesFromPayload,
} from "../../api/runtime/observation-presentation";
import { decidePresentation } from "../../api/runtime/presentation-fabric";

const NOW = new Date("2026-09-17T12:00:00.000Z");
const SUBJECT = { kind: "generic_subject", id: "subject-1" };

function observation(overrides: Partial<{
  observedAt: Date;
  freshnessExpiresAt: Date | null;
  payload: Record<string, unknown>;
  sourceKind: string;
  providerId: string | null;
}> = {}) {
  return {
    observedAt: overrides.observedAt ?? new Date(NOW.getTime() - 5_000),
    freshnessExpiresAt:
      overrides.freshnessExpiresAt === undefined ? null : overrides.freshnessExpiresAt,
    payload: overrides.payload ?? { lat: 29.3759, lng: 47.9774, status: "moving" },
    sourceKind: overrides.sourceKind ?? "device",
    providerId: overrides.providerId ?? null,
  };
}

function build(input: Parameters<typeof buildObservationPresentationInput>[0]) {
  const result = buildObservationPresentationInput(input);
  return { ...result, presentation: decidePresentation(result.input) };
}

function findPrimitive(
  presentation: ReturnType<typeof decidePresentation>,
  primitive: string,
): boolean {
  if (presentation.primitive === primitive) return true;
  return (presentation.children ?? []).some((child) => findPrimitive(child, primitive));
}

describe("presence classification", () => {
  it("reports UNAVAILABLE when nothing was ever observed", () => {
    const assessment = classifyObservationPresence(undefined, NOW);
    expect(assessment.presence).toBe("UNAVAILABLE");
    expect(assessment.reason).toBe("NO_OBSERVATION");
  });

  it("is FRESH inside a declared horizon", () => {
    const assessment = classifyObservationPresence(
      observation({ freshnessExpiresAt: new Date(NOW.getTime() + 60_000) }),
      NOW,
    );
    expect(assessment.presence).toBe("FRESH");
    expect(assessment.reason).toBe("WITHIN_DECLARED_HORIZON");
  });

  it("is STALE once the declared horizon has passed, however recent the reading", () => {
    const assessment = classifyObservationPresence(
      observation({
        observedAt: new Date(NOW.getTime() - 1_000),
        freshnessExpiresAt: new Date(NOW.getTime() - 1),
      }),
      NOW,
    );
    expect(assessment.presence).toBe("STALE");
    expect(assessment.reason).toBe("DECLARED_HORIZON_PASSED");
  });

  it("does not treat an undeclared horizon as eternal freshness", () => {
    // This is the gap the bridge closes: Block 2's own freshnessOf answers
    // FRESH forever when the column is null, because a null there means the
    // provider never committed to a horizon — not that the reading never ages.
    const threeHoursOld = classifyObservationPresence(
      observation({
        observedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
        freshnessExpiresAt: null,
      }),
      NOW,
    );
    expect(threeHoursOld.presence).toBe("STALE");
    expect(threeHoursOld.reason).toBe("EXCEEDS_DEFAULT_MAX_AGE");
  });

  it("is FRESH inside the default max age when no horizon is declared", () => {
    const assessment = classifyObservationPresence(
      observation({
        observedAt: new Date(
          NOW.getTime() - DEFAULT_OBSERVATION_PRESENTATION_POLICY.defaultMaxAgeMs + 1_000,
        ),
        freshnessExpiresAt: null,
      }),
      NOW,
    );
    expect(assessment.presence).toBe("FRESH");
  });

  it("treats a reading timestamped in the future as STALE, not fresh", () => {
    // A clock that disagrees with ours is not evidence of currency, and
    // trusting it would pin a subject as permanently live.
    const assessment = classifyObservationPresence(
      observation({ observedAt: new Date(NOW.getTime() + 60_000) }),
      NOW,
    );
    expect(assessment.presence).toBe("STALE");
    expect(assessment.reason).toBe("OBSERVED_IN_FUTURE");
  });

  it("honours a caller-widened policy without any subject-specific rule", () => {
    const old = observation({
      observedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
      freshnessExpiresAt: null,
    });
    expect(classifyObservationPresence(old, NOW).presence).toBe("STALE");
    expect(
      classifyObservationPresence(old, NOW, { defaultMaxAgeMs: 30 * 60 * 1000 }).presence,
    ).toBe("FRESH");
  });
});

describe("coordinate extraction refuses to coerce", () => {
  it("accepts two finite numbers in range", () => {
    expect(coordinatesFromPayload({ lat: 1.5, lng: -2.5 })).toEqual({ lat: 1.5, lng: -2.5 });
  });

  it.each([
    ["string latitude", { lat: "29.3", lng: 47.9 }],
    ["null longitude", { lat: 29.3, lng: null }],
    ["missing longitude", { lat: 29.3 }],
    ["NaN", { lat: Number.NaN, lng: 47.9 }],
    ["Infinity", { lat: Number.POSITIVE_INFINITY, lng: 47.9 }],
    ["latitude out of range", { lat: 91, lng: 47.9 }],
    ["longitude out of range", { lat: 29.3, lng: 181 }],
    ["empty payload", {}],
  ])("refuses %s rather than coercing a point", (_label, payload) => {
    expect(coordinatesFromPayload(payload as Record<string, unknown>)).toBeUndefined();
  });
});

describe("fresh observation produces a live map", () => {
  it("emits TRACKER with a MAP child carrying the observed coordinates", () => {
    const { presentation, presence, mapEligible } = build({
      subject: SUBJECT,
      observation: observation(),
      observationType: "location",
      now: NOW,
    });
    expect(presence).toBe("FRESH");
    expect(mapEligible).toBe(true);
    expect(presentation.primitive).toBe("TRACKER");
    expect(findPrimitive(presentation, "MAP")).toBe(true);

    const map = (presentation.children ?? []).find((child) => child.primitive === "MAP");
    const markers = map?.data.markers as Array<Record<string, unknown>>;
    expect(markers[0].coordinates).toEqual({ lat: 29.3759, lng: 47.9774 });
    expect(markers[0].entityRef).toBe("generic_subject:subject-1");
  });

  it("works for any subject kind without a subject-specific branch", () => {
    for (const kind of ["driver", "technician", "vehicle", "shipment", "robot", "kiln"]) {
      const { presentation } = build({
        subject: { kind, id: "x" },
        observation: observation(),
        observationType: "location",
        now: NOW,
      });
      expect(findPrimitive(presentation, "MAP")).toBe(true);
    }
  });
});

describe("stale observation never renders as live", () => {
  it("withholds coordinates so no MAP can be built", () => {
    const { presentation, presence, mapEligible } = build({
      subject: SUBJECT,
      observation: observation({
        observedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
        freshnessExpiresAt: null,
      }),
      observationType: "location",
      now: NOW,
    });
    expect(presence).toBe("STALE");
    expect(mapEligible).toBe(false);
    expect(presentation.primitive).toBe("TRACKER");
    expect(findPrimitive(presentation, "MAP")).toBe(false);
  });

  it("keeps the surface truthful rather than empty", () => {
    const { presentation } = build({
      subject: SUBJECT,
      observation: observation({
        observedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
        freshnessExpiresAt: null,
      }),
      observationType: "location",
      now: NOW,
    });
    expect(presentation.data.observationPresence).toBe("STALE");
    expect(presentation.data.observationReason).toBe("EXCEEDS_DEFAULT_MAX_AGE");
    expect(presentation.data.observationAgeMs).toBeGreaterThan(0);
    const tracker = (presentation.children ?? []).find((c) => c.primitive === "TRACKER");
    expect(String(tracker?.data.status)).toContain("stale");
    // The timestamp survives, so the person can see how old the reading is.
    expect(tracker?.data.observedAt).toBeTruthy();
  });

  it("withholds coordinates when the declared horizon has just passed", () => {
    const { presentation, mapEligible } = build({
      subject: SUBJECT,
      observation: observation({
        observedAt: new Date(NOW.getTime() - 1_000),
        freshnessExpiresAt: new Date(NOW.getTime() - 1),
      }),
      observationType: "location",
      now: NOW,
    });
    expect(mapEligible).toBe(false);
    expect(findPrimitive(presentation, "MAP")).toBe(false);
  });
});

describe("missing observation is truthful, not blank", () => {
  it("produces a tracking surface that says the position is unavailable", () => {
    const { presentation, presence, mapEligible } = build({
      subject: SUBJECT,
      observation: undefined,
      observationType: "location",
      now: NOW,
    });
    expect(presence).toBe("UNAVAILABLE");
    expect(mapEligible).toBe(false);
    expect(findPrimitive(presentation, "MAP")).toBe(false);
    expect(presentation.data.observationPresence).toBe("UNAVAILABLE");
    const tracker = (presentation.children ?? []).find((c) => c.primitive === "TRACKER");
    expect(tracker?.data.status).toBe("unavailable");
  });

  it("emits no coordinates anywhere in the tree", () => {
    const { presentation } = build({
      subject: SUBJECT,
      observation: undefined,
      observationType: "location",
      now: NOW,
    });
    expect(JSON.stringify(presentation)).not.toContain("coordinates");
  });
});

describe("fresh observation without coordinates", () => {
  it("tracks status only — a subject can be current without being locatable", () => {
    const { presentation, presence, mapEligible } = build({
      subject: SUBJECT,
      observation: observation({ payload: { status: "en route" } }),
      observationType: "location",
      now: NOW,
    });
    expect(presence).toBe("FRESH");
    expect(mapEligible).toBe(false);
    expect(findPrimitive(presentation, "MAP")).toBe(false);
    const tracker = (presentation.children ?? []).find((c) => c.primitive === "TRACKER");
    expect(tracker?.data.status).toBe("en route");
  });
});

describe("map lifecycle: enter, update, exit", () => {
  const fresh = (at: Date, lat: number) =>
    build({
      subject: SUBJECT,
      observation: observation({
        observedAt: at,
        payload: { lat, lng: 47.9774, status: "moving" },
      }),
      observationType: "location",
      now: new Date(at.getTime() + 1_000),
    });

  it("ENTER: the first fresh observation brings a map into being", () => {
    expect(findPrimitive(fresh(NOW, 29.1).presentation, "MAP")).toBe(true);
  });

  it("UPDATE: a newer fresh observation replaces the position in the same surface", () => {
    const first = fresh(NOW, 29.1).presentation;
    const second = fresh(new Date(NOW.getTime() + 30_000), 29.2).presentation;
    expect(first.primitive).toBe(second.primitive);
    const coordinatesOf = (p: typeof first) =>
      ((p.children ?? []).find((c) => c.primitive === "MAP")?.data.markers as
        Array<Record<string, unknown>>)[0].coordinates;
    expect(coordinatesOf(first)).not.toEqual(coordinatesOf(second));
    expect(coordinatesOf(second)).toEqual({ lat: 29.2, lng: 47.9774 });
  });

  it("EXIT: once the subject stops being observed the map is gone, not frozen", () => {
    const last = fresh(NOW, 29.1);
    expect(findPrimitive(last.presentation, "MAP")).toBe(true);
    const later = build({
      subject: SUBJECT,
      observation: observation({ observedAt: NOW, payload: { lat: 29.1, lng: 47.9, status: "moving" } }),
      observationType: "location",
      now: new Date(NOW.getTime() + 60 * 60 * 1000),
    });
    expect(findPrimitive(later.presentation, "MAP")).toBe(false);
  });

  it("a claim alone cannot close the map — only the observation record decides", () => {
    // A provider or human saying "done" is a receipt, not a verification, and
    // the bridge has no input through which such a claim could arrive.
    const { presentation } = build({
      subject: SUBJECT,
      observation: observation({ payload: { lat: 29.1, lng: 47.9, status: "delivered" } }),
      observationType: "location",
      now: NOW,
    });
    expect(findPrimitive(presentation, "MAP")).toBe(true);
    const tracker = (presentation.children ?? []).find((c) => c.primitive === "TRACKER");
    expect(tracker?.data.status).toBe("delivered");
  });
});

describe("the bridge cannot be fed a fabricated position", () => {
  it("exposes no caller channel for coordinates outside the observation record", () => {
    const { presentation } = build({
      subject: SUBJECT,
      observation: undefined,
      observationType: "location",
      now: NOW,
      data: {
        // A caller trying to smuggle a location through projection data.
        coordinates: { lat: 1, lng: 2 },
        observation: { coordinates: { lat: 3, lng: 4 } },
      },
    });
    expect(findPrimitive(presentation, "MAP")).toBe(false);
    const tracker = (presentation.children ?? []).find((c) => c.primitive === "TRACKER");
    expect(tracker?.data.status).toBe("unavailable");
  });
});
