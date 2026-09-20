/**
 * JASIM — the generic effect-verification contract.
 *
 * The live proof is in `tests/block31/effect-observation-verification.test.ts`;
 * this file holds the properties that must be true of the CONTRACT itself,
 * independently of any database:
 *
 *   • an effect declaration is a claim, never a verdict
 *   • freshness is established, never assumed from recency
 *   • no capability, model or payload can name its own trust class
 *   • nothing in the mechanism knows what a device, a message or a person is
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPLETION_POLICIES,
  decideCompletion,
  completionPolicyFor,
  sanitizeEffectDeclaration,
  type EffectAssertion,
  type EffectClaimSource,
  type EffectKind,
} from "../../api/runtime/completion-policy";
import {
  SIGNAL_AUTHORITY_KEYS,
  claimSourceForChannel,
  observationFreshness,
} from "../../api/runtime/effect-observation-bridge";
import { AUTHORITY_KEYS } from "../../api/runtime/model-output-trust";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const bridgeSource = source("api/runtime/effect-observation-bridge.ts");
const registrySource = source("api/runtime/capability-registry.ts");

const decide = (effectKind: EffectKind, assertions: EffectAssertion[]) =>
  decideCompletion({
    policy: completionPolicyFor(effectKind),
    outputShapeValid: true,
    assertions,
  });

// ── The shape of a claim ─────────────────────────────────────────────────────

describe("an effect assertion is a claim, and a claim is not a verdict", () => {
  it("a capability may report a lifecycle state", () => {
    const outcome = sanitizeEffectDeclaration({ effect: { state: "OCCURRED", reference: "r1" } });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.declaration).toEqual({ state: "OCCURRED", reference: "r1" });
  });

  it("a capability may not report how much its own word is worth", () => {
    for (const key of ["source", "verified", "trustLevel", "confirmed"]) {
      const outcome = sanitizeEffectDeclaration({ effect: { state: "OCCURRED", [key]: true } });
      expect(outcome.ok, key).toBe(false);
    }
  });

  it("an executor's own return value verifies nothing that has an effect", () => {
    for (const kind of ["MESSAGE_DISPATCH", "DEVICE_COMMAND", "REMOTE_MUTATION", "HUMAN_ACTION"] as const) {
      const outcome = decide(kind, [
        { state: "OCCURRED", source: "EXECUTOR_RETURN", authority: "x" },
      ]);
      expect(outcome.decision, kind).not.toBe("VERIFIED");
    }
  });

  it("a bound provider receipt verifies nothing on its own, for any effect class", () => {
    // RECEIPT != VERIFICATION, stated once for everything rather than once for money.
    for (const kind of Object.keys(COMPLETION_POLICIES) as EffectKind[]) {
      if (kind === "NONE") continue;
      expect(COMPLETION_POLICIES[kind].sufficientSources, kind).not.toContain(
        "BOUND_PROVIDER_RECEIPT" satisfies EffectClaimSource,
      );
    }
  });

  it("a definitive negative fails the attempt; an uncertain one forbids blind retry", () => {
    expect(decide("DEVICE_COMMAND", [{ state: "NOT_OCCURRED", source: "INDEPENDENT_READBACK" }]).decision).toBe("FAILED");
    const uncertain = decide("DEVICE_COMMAND", [{ state: "UNCERTAIN", source: "INDEPENDENT_READBACK" }]);
    expect(uncertain.decision).toBe("INCONCLUSIVE");
    expect(uncertain.retryPermitted).toBe(false);
  });

  it("no evidence at all is never success", () => {
    const outcome = decide("REMOTE_MUTATION", []);
    expect(outcome.decision).not.toBe("VERIFIED");
    expect(["PENDING", "INCONCLUSIVE"]).toContain(outcome.decision);
  });
});

// ── Trust comes from the channel, never the payload ──────────────────────────

describe("how a signal arrived decides what it is worth", () => {
  it("a provider talking about itself is self-reported, whatever it says", () => {
    expect(claimSourceForChannel("PROVIDER_RESPONSE")).toBe("SELF_REPORTED");
    expect(claimSourceForChannel("HUMAN_PROVIDER_REPORT")).toBe("SELF_REPORTED");
  });

  it("only a reading of the owning authority is independent", () => {
    expect(claimSourceForChannel("AUTHENTICATED_TELEMETRY")).toBe("INDEPENDENT_READBACK");
    expect(claimSourceForChannel("RUNTIME_READBACK")).toBe("INDEPENDENT_READBACK");
    expect(claimSourceForChannel("OWNER_CONFIRMATION")).toBe("OWNER_CONFIRMATION");
  });

  it("no channel can produce a bound receipt", () => {
    // A receipt is established by a signature check in the executor, not by
    // something arriving through an observation channel.
    for (const channel of [
      "PROVIDER_RESPONSE",
      "HUMAN_PROVIDER_REPORT",
      "AUTHENTICATED_TELEMETRY",
      "RUNTIME_READBACK",
      "INTERNAL_STATE_READBACK",
      "OWNER_CONFIRMATION",
    ] as const) {
      expect(claimSourceForChannel(channel)).not.toBe("BOUND_PROVIDER_RECEIPT");
    }
  });

  it("every self-grading key a signal could carry is refused", () => {
    for (const key of ["verified", "trustlevel", "claimsource", "independent", "authoritative", "proofclass"]) {
      expect(SIGNAL_AUTHORITY_KEYS.has(key), key).toBe(true);
    }
  });

  it("a model cannot smuggle a verification authority through its output", () => {
    for (const key of ["verified", "effectverified", "observationverified", "claimsource", "proofclass", "trustscore", "providertrust", "executionverified"]) {
      expect(AUTHORITY_KEYS.has(key), key).toBe(true);
    }
  });
});

// ── Freshness ────────────────────────────────────────────────────────────────

describe("freshness is established, not assumed", () => {
  const observedAt = new Date(NOW.getTime() - 1_000);

  it("a declared horizon in the future is CURRENT", () => {
    expect(
      observationFreshness({ observedAt, freshnessExpiresAt: new Date(NOW.getTime() + 1) }, NOW),
    ).toBe("CURRENT");
  });

  it("a passed horizon is STALE", () => {
    expect(
      observationFreshness({ observedAt, freshnessExpiresAt: new Date(NOW.getTime() - 1) }, NOW),
    ).toBe("STALE");
  });

  it("a reading one second old with no horizon is UNKNOWN, not CURRENT", () => {
    // Receiving something recently is a fact about us, not about the world.
    // A temperature and a door state decay at completely different rates.
    expect(observationFreshness({ observedAt, freshnessExpiresAt: null }, NOW)).toBe("UNKNOWN");
  });

  it("it speaks the same three words the datasets do", () => {
    const states = new Set(
      [
        observationFreshness({ observedAt, freshnessExpiresAt: new Date(NOW.getTime() + 1) }, NOW),
        observationFreshness({ observedAt, freshnessExpiresAt: new Date(NOW.getTime() - 1) }, NOW),
        observationFreshness({ observedAt, freshnessExpiresAt: null }, NOW),
      ],
    );
    expect([...states].sort()).toEqual(["CURRENT", "STALE", "UNKNOWN"]);
  });
});

// ── Generality ───────────────────────────────────────────────────────────────

describe("nothing in the mechanism knows what it is observing", () => {
  const DOMAIN_WORDS = [
    "Driver", "Restaurant", "Payment", "Robot", "Delivery", "Message",
    "IoT", "Device", "Vehicle", "Order", "Invoice", "Valve", "Generator",
    "Laboratory", "Storage",
  ];

  it("the bridge declares no domain identifier", () => {
    // Only DECLARED names — a comment naming an example is how the reasoning is
    // explained, and forbidding that would push the explanations out instead.
    const declared = [...bridgeSource.matchAll(/export (?:type|function|const) (\w+)/g)].map(
      (match) => match[1]!,
    );
    for (const name of declared) {
      for (const word of DOMAIN_WORDS) {
        expect(name, name).not.toContain(word);
      }
    }
  });

  it("there is no per-domain verifier registry", () => {
    for (const forbidden of [
      "MessagingVerifier",
      "IoTVerifier",
      "DriverVerifier",
      "HumanVerifier",
      "PaymentVerifier",
      "VERIFIERS",
      "OBSERVATION_TYPES",
    ]) {
      expect(bridgeSource, forbidden).not.toContain(forbidden);
      expect(registrySource, forbidden).not.toContain(forbidden);
    }
  });

  it("the effect classes are a closed set of six, and none of them is an industry", () => {
    expect(Object.keys(COMPLETION_POLICIES).sort()).toEqual([
      "DEVICE_COMMAND",
      "HUMAN_ACTION",
      "INTERNAL_STATE",
      "MESSAGE_DISPATCH",
      "NONE",
      "REMOTE_MUTATION",
    ]);
  });

  it("a capability declares what would convince it, never what its evidence is worth", () => {
    // `effectExpectation` carries a subject, a property and two predicates.
    // If it could also carry a claim source, a capability could certify itself.
    const block = bridgeSource.slice(bridgeSource.indexOf("export type EffectExpectation = {"));
    const body = block.slice(0, block.indexOf("\n};"));
    for (const forbidden of ["source", "claimSource", "trust", "verified", "sufficient"]) {
      expect(body.toLowerCase(), forbidden).not.toContain(`${forbidden.toLowerCase()}:`);
    }
  });

  it("the registry composes a declaration into the same resolver shape", () => {
    // One path, so the completion policy cannot tell a declaration from
    // hand-written trusted code — and neither form can widen what verifies.
    expect(registrySource).toContain("expectationEffectResolver(db, capability.effectExpectation)");
  });
});
