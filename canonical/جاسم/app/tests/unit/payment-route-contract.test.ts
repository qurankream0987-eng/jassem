/**
 * JASIM — THE PAYMENT ROUTE CONTRACT.
 *
 * Checked without a database, a provider or money: the bridge chooses a rail
 * and nothing else, and every financial value on it came from canonical state.
 *
 *   MODEL != PAYMENT ROUTE AUTHORITY · MODEL != PAYEE AUTHORITY
 *   PAYMENT_SPECIAL_BINDING_RUNTIME = 0 · PAYMENT_SPECIAL_SECRET_STORE = 0
 *   PAY_IN_SOURCE_RESOLUTION = 0
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PAYMENT_CAPABILITY,
  PAYMENT_OPERATIONS,
  REFUND_CAPABILITY,
} from "../../api/runtime/payment-route";
import { FACT_CAPABILITIES } from "../../api/runtime/source-resolution";
import { capabilityMutates } from "../../api/runtime/provider-binding";

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const ROUTE = read("api/runtime/payment-route.ts");
const CODE = strip(ROUTE);
const BINDING = strip(read("api/runtime/provider-binding.ts"));
const ORCHESTRATOR = strip(read("api/runtime/block31/conversation-orchestrator.ts"));

describe("the payment route contract", () => {
  it("paying is a mutation, and the fact runtime cannot reach it", () => {
    //   PAY_ADDED_TO_FACT_CAPABILITIES = 0
    expect(capabilityMutates(PAYMENT_CAPABILITY)).toBe(true);
    expect(capabilityMutates(REFUND_CAPABILITY)).toBe(true);
    expect(FACT_CAPABILITIES).not.toContain(PAYMENT_CAPABILITY);
    expect(FACT_CAPABILITIES).not.toContain(REFUND_CAPABILITY);
    // And the source resolver names neither.
    const source = strip(read("api/runtime/source-resolution.ts"));
    expect(source).not.toMatch(/"PAY"|"REFUND"/);
  });

  it("the four operations run on a granted capability, never a borrowed one", () => {
    expect([...PAYMENT_OPERATIONS]).toEqual(["AUTHORIZE", "CAPTURE", "REFUND", "READBACK"]);
    // Refunding uses REFUND; everything else, reading a payment back included,
    // uses PAY. Nothing borrows a reading capability to move money.
    expect(CODE).toMatch(/operate\("REFUND", REFUND_CAPABILITY/);
    expect(CODE).toMatch(/operate\("READBACK", PAYMENT_CAPABILITY/);
    expect(CODE).not.toMatch(/readThroughBinding/);
  });

  it("no financial value is taken from anything a caller said", () => {
    //   MODEL_CAN_SET_PAYMENT_AMOUNT = NO · MODEL_CAN_SET_PAYMENT_PAYEE = NO
    //
    // The bridge reads exactly two things: who owes, and who is owed. Both
    // arrive from the canonical payable resolution. It parses no amount, no
    // currency and no payee of its own.
    expect(CODE).not.toMatch(/amountMinor\s*[:=]\s*(input|values|envelope)/);
    expect(CODE).not.toMatch(/currency\s*[:=]\s*(input|values|envelope)/);
    expect(CODE).not.toMatch(/payeeRef\s*[:=]\s*(input|values|envelope)\./);
    // The only amount and currency it passes through are the ones the
    // execution runtime reconstructed and handed to `authorize`.
    expect(CODE).toMatch(/amountMinor: request\.amountMinor/);
    expect(CODE).toMatch(/currency: request\.currency/);
  });

  it("the route is derived from the settlement's two sides and nowhere else", () => {
    //   PAYMENT_BINDING_SCOPE_DERIVED_CANONICALLY
    const resolver = CODE.slice(
      CODE.indexOf("export async function resolvePaymentRoute"),
      CODE.indexOf("export const PAYMENT_OPERATIONS"),
    );
    expect(resolver).toMatch(/scopeId: input\.payerScopeId, side: "PAYER"/);
    expect(resolver).toMatch(/scopeId: input\.payable\.payeeRef, side: "PAYEE"/);
    // No third source of scopes, and no ordering used as a tiebreak.
    expect(resolver).not.toMatch(/sort\(|verifiedAt|pop\(|shift\(/);
    expect(resolver).toMatch(/AMBIGUOUS_ROUTE/);
  });

  it("the model no longer names the provider or its endpoint", () => {
    //   PAYMENT_EXECUTION_BYPASSES_GENERAL_PROVIDER_BINDING = 0
    //   PARALLEL_EXECUTABLE_PAYMENT_PATHS = 0
    //
    // The old path read both out of the envelope and handed them to checkout.
    // Neither read exists any more, and the orchestrator no longer imports the
    // checkout module at all — so there is no second executable path left.
    expect(ORCHESTRATOR).not.toMatch(/string\(values, "adapterEndpoint"\)/);
    expect(ORCHESTRATOR).not.toMatch(/createFinancialCheckout/);
    expect(ORCHESTRATOR).toMatch(/paymentExecutionRoute\(/);
  });

  it("the payment runtime is the only caller of the mutation door", () => {
    // The door checks VERIFIED, granted, scope and mutating-only. What it
    // cannot check is canonical authority to act, which belongs to the runtime
    // that owns the act — so this asserts that runtime is the only caller.
    const callers = ["api/runtime/payment-route.ts", "api/runtime/source-resolution.ts",
      "api/runtime/jasim-runtime.ts", "api/runtime/block31/conversation-orchestrator.ts"]
      .filter((file) => strip(read(file)).includes("invokeThroughBinding("));
    expect(callers).toEqual(["api/runtime/payment-route.ts"]);
    // And the door itself refuses anything that is not a mutation.
    const door = BINDING.slice(
      BINDING.indexOf("export async function invokeThroughBinding"),
      BINDING.indexOf("export async function verifiedBindingsFor"),
    );
    expect(door).toMatch(/!capabilityMutates\(input\.capability\)/);
    expect(door).toMatch(/lifecycle !== "VERIFIED"/);
    expect(door).toMatch(/grantedCapabilities\.includes\(input\.capability\)/);
    expect(door).toMatch(/row\.scopeId !== input\.onBehalfOfScopeId/);
  });

  it("a lost transport is uncertain, never failed", () => {
    //   AMBIGUOUS_NETWORK_FAILURE_BLIND_RECHARGE = 0
    //
    // The classification that keeps a system from double-charging: a request
    // that may have landed must never be recorded as one that did not.
    expect(CODE).toMatch(/PROVIDER_UNAVAILABLE[\s\S]{0,120}PspUncertainEffectError/);
    expect(CODE).toMatch(/PROVIDER_ERROR[\s\S]{0,120}PspRejectedError/);
    // The door reports a thrown adapter as unreachable for the same reason.
    expect(BINDING).toMatch(/status: "PROVIDER_UNAVAILABLE"/);
  });

  it("nothing here holds a secret or an endpoint", () => {
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: the word «token» appears nowhere in the route module.
    // WHY_IT_IS_WRONG: the word, not the thing. The module now carries a
    //   `paymentMethodToken` — an OPAQUE, provider-bound reference, which the
    //   permanent law distinguishes from credential material precisely so
    //   that it CAN travel:
    //
    //     RAW_PAYMENT_CREDENTIAL != PAYMENT_METHOD_REFERENCE
    //
    //   A test that cannot tell those apart forbids the reference along with
    //   the secret, which would have made the instrument unreachable.
    // NEW_EXPECTATION: no credential, no key, no vault, no endpoint — and the
    //   only token-shaped thing is the opaque reference, named exactly.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: the old one matched a substring.
    //   This enumerates every token-shaped identifier in the module and
    //   requires it to be the one permitted reference, so a real secret
    //   appearing under any other name now fails where it did not before.
    //
    //   PAYMENT_SPECIAL_SECRET_STORE = 0 · PAYMENT_SECRET_IN_EVENT_LOG = 0
    expect(CODE).not.toMatch(/credential|apiKey|vault|endpoint/i);
    const tokenish = [...new Set(CODE.match(/\w*[Tt]oken\w*/g) ?? [])];
    expect(tokenish).toEqual(["paymentMethodToken"]);
    expect(CODE).not.toMatch(/console\./);
  });

  it("no payment runtime names a kind of business", () => {
    //   DOMAIN_PAYMENT_HANDLERS_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
    for (const noun of [
      "stripe", "adyen", "paypal", "checkout\\.com", "visa", "mastercard",
      "food", "car", "hotel", "booking", "marketplace", "restaurant", "ticket",
    ]) {
      expect(CODE.toLowerCase(), noun).not.toMatch(new RegExp(`\\b${noun}s?\\b`));
    }
    expect(CODE).not.toMatch(/switch\s*\(/);
  });
});
