import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import {
  SIGNAL_AUTHORITY_KEYS,
  claimSourceForChannel,
  type EffectSignalChannel,
} from "../../api/runtime/effect-observation-bridge";
import { COMPLETION_POLICIES } from "../../api/runtime/completion-policy";

/**
 * BRIDGE INVARIANTS — the properties that hold without a database.
 *
 * The behavioural cases live in `tests/block31/observation-bridge.test.ts`,
 * where real attempt rows exist. These are the structural guarantees, kept in
 * the main suite so they are checked on every run.
 */

const root = resolve(__dirname, "../..");
const bridge = readFileSync(resolve(root, "api/runtime/effect-observation-bridge.ts"), "utf8");
const code = bridge.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const CHANNELS: EffectSignalChannel[] = [
  "PROVIDER_RESPONSE", "HUMAN_PROVIDER_REPORT", "AUTHENTICATED_TELEMETRY",
  "RUNTIME_READBACK", "INTERNAL_STATE_READBACK", "OWNER_CONFIRMATION",
];

describe("trust is decided by how a signal arrived, never by what it says", () => {
  it("every channel maps to exactly one claim source", () => {
    for (const channel of CHANNELS) {
      expect(claimSourceForChannel(channel), channel).toBeTruthy();
    }
  });

  it("a party's own word never maps to a source any effectful policy accepts", () => {
    for (const channel of ["PROVIDER_RESPONSE", "HUMAN_PROVIDER_REPORT"] as const) {
      const source = claimSourceForChannel(channel);
      expect(source).toBe("SELF_REPORTED");
      for (const kind of Object.keys(COMPLETION_POLICIES) as Array<keyof typeof COMPLETION_POLICIES>) {
        if (kind === "NONE") continue;
        expect(COMPLETION_POLICIES[kind].sufficientSources, `${channel} → ${kind}`)
          .not.toContain(source);
      }
    }
  });

  it("no channel can mint a bound provider receipt or an executor return", () => {
    // Those two are established by a signature check and by a function
    // returning — neither is something an observation can assert into being.
    for (const channel of CHANNELS) {
      expect(claimSourceForChannel(channel), channel).not.toBe("BOUND_PROVIDER_RECEIPT");
      expect(claimSourceForChannel(channel), channel).not.toBe("EXECUTOR_RETURN");
    }
  });

  it("the channel→source table is frozen, so it cannot be widened at runtime", () => {
    expect(code).toContain("Object.freeze");
  });

  it("the trust class is written from the channel, never read from the payload", () => {
    // The single most important line in the module.
    expect(code).toContain("claimSource: CHANNEL_SOURCE[input.channel]");
    expect(code).toContain("sourceKind: CHANNEL_PROOF_CLASS[input.channel]");
    // And the payload is never consulted for it.
    expect(code).not.toMatch(/sourceKind:\s*input\.payload/);
    expect(code).not.toMatch(/claimSource:\s*input\.(payload|provenance)/);
  });
});

describe("no client authority", () => {
  it("every self-grading key is refused", () => {
    for (const key of [
      "trustlevel", "trustclass", "verified", "independent",
      "providerverified", "effectverified", "authoritative", "proofclass",
      "claimsource", "source",
    ]) {
      expect(SIGNAL_AUTHORITY_KEYS.has(key), key).toBe(true);
    }
  });

  it("both the payload and the provenance are screened, not just the payload", () => {
    expect(code).toContain('assertNoAuthorityClaim(input.payload');
    expect(code).toContain("assertNoAuthorityClaim(input.provenance");
  });

  it("the bridge is not exposed through any registered router", () => {
    // Its current state, asserted deliberately: there is no client-facing
    // submission endpoint. When one is added it must supply the channel
    // server-side, and changing this line is how that becomes a visible
    // decision rather than a quiet one.
    const hits = execSync(
      `grep -rln "effect-observation-bridge" ${root}/api/routers ${root}/src || true`,
      { encoding: "utf8" },
    ).trim();
    expect(hits).toBe("");
  });
});

describe("the bridge reuses rather than duplicates", () => {
  it("writes into the existing observations table and its freshness column", () => {
    expect(code).toContain("insert(observations)");
    expect(code).toContain("freshnessExpiresAt");
    // No second freshness mechanism, no private evidence table.
    expect(code).not.toMatch(/pgTable|CREATE TABLE/);
  });

  it("reuses the existing proof-class vocabulary", () => {
    for (const proofClass of ["self_report", "counterparty_confirm", "authenticated_webhook", "signed_proof"]) {
      expect(code, proofClass).toContain(proofClass);
    }
  });

  it("binds evidence to an attempt and rejects unbound rows", () => {
    expect(code).toContain("attemptId: input.attemptId");
    expect(code).toContain(".attemptId === query.attemptId");
  });

  it("names no domain in its declared identifiers", () => {
    const identifiers = [
      ...code.matchAll(/(?:type|interface|const|function|class|enum)\s+([A-Za-z0-9_]+)/g),
    ].map((match) => match[1]!.toLowerCase());
    expect(identifiers.length).toBeGreaterThan(5);
    for (const domain of ["driver", "door", "hotel", "booking", "location", "message", "device"]) {
      for (const identifier of identifiers) {
        expect(identifier, `${identifier} names ${domain}`).not.toContain(domain);
      }
    }
  });

  it("conflict resolves to uncertainty, never to whichever reading is newer", () => {
    expect(code).toContain("states.size > 1");
    const conflictBlock = code.slice(code.indexOf("states.size > 1"));
    expect(conflictBlock.slice(0, 600)).toContain('state: "UNCERTAIN"');
  });
});
