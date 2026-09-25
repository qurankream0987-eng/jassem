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

  it("the continuation reads canonical state and nothing a browser carried", () => {
    //   RETURN_QUERY_PAYMENT_STATUS_USED = 0 · RETURN_QUERY_AMOUNT_USED = 0
    //   RETURN_QUERY_CURRENCY_USED = 0 · RETURN_QUERY_PAYEE_USED = 0
    //   RETURN_QUERY_PROVIDER_USED = 0
    const METHOD = strip(read("api/runtime/payment-method.ts"));
    const resume = METHOD.slice(METHOD.indexOf("export async function resumePaymentAfterChallenge"));
    // Its whole input, and there is no verdict in it.
    expect(resume).toMatch(/challengeId: string;[\s\S]{0,120}state: string;[\s\S]{0,120}payerScopeId: string;/);
    for (const smuggled of ["success", "amount", "currency", "payee", "query", "searchParams"]) {
      expect(resume, smuggled).not.toMatch(new RegExp(`input\\.${smuggled}`));
    }
    // The money and the parties come from the intent, and the provider
    // reference is never passed in — the durable one is the only one read.
    expect(resume).toMatch(/payeeRef: intent\.payeeRef/);
    expect(resume).toMatch(/payerScopeId: intent\.ownerId/);
    expect(resume).not.toMatch(/providerReference:/);
  });

  it("a return may read the provider and may never pay it again", () => {
    //   CHALLENGE_RETURN_SECOND_PAY_CALL = 0
    //   RECONCILIATION_RETRY != PAYMENT_RETRY
    const METHOD = strip(read("api/runtime/payment-method.ts"));
    const resume = METHOD.slice(METHOD.indexOf("export async function resumePaymentAfterChallenge"));
    expect(resume).toMatch(/reconcilePaymentEffect\(/);
    // Not one of the doors that moves money is reachable from here.
    expect(resume).not.toMatch(/executePaymentEffect|refundPaymentEffect|authorize\(|capture\(/);
    expect(resume).not.toMatch(/createPaymentIntent/);
    // And the rail is checked against the one the payment was executed on.
    expect(resume).toMatch(/routed\.route\.definitionId !== intent\.providerRef/);
  });

  it("there is one continuation, and it names no provider", () => {
    //   DOMAIN_PAYMENT_RETURN_HANDLERS_ADDED = 0 · PROVIDER_NAME_RETURN_BRANCHES = 0
    const METHOD = strip(read("api/runtime/payment-method.ts"));
    for (const named of ["stripe", "adyen", "paypal", "threeds", "3ds", "applepay", "googlepay"]) {
      expect(METHOD.toLowerCase(), named).not.toContain(named);
    }
    expect(METHOD).not.toMatch(/switch\s*\(/);
    expect((METHOD.match(/export async function resumePaymentAfterChallenge/g) ?? []).length).toBe(1);
  });

  it("the event path can read a provider and can never spend at one", () => {
    //   EVENT_PATH_PAY_CALLS = 0 · CAPTURE = 0 · REFUND = 0 · WEBHOOK != PAY
    const EVENT = strip(read("api/runtime/payment-event.ts"));
    // Not one of the doors that moves money is even imported here.
    expect(EVENT).not.toMatch(/executePaymentEffect|refundPaymentEffect|pspClientForRoute/);
    expect(EVENT).not.toMatch(/\.authorize\(|\.capture\(|\.refund\(/);
    // What it does reach: the existing verifier and the existing appliers,
    // each of which reads the provider and writes nothing else.
    expect(EVENT).toMatch(/verifyPaymentClaim\(/);
    expect(EVENT).toMatch(/applyProviderSettlement|applyProviderCapture/);
  });

  it("an event is authenticated, deduplicated and correlated before a payment is touched", () => {
    //   UNAUTHENTICATED_EVENT_CAN_CHANGE_PAYMENT = 0
    //   EVENT_SUCCESS_BYPASSES_VERIFICATION = 0
    const EVENT = strip(read("api/runtime/payment-event.ts"));
    const ingest = EVENT.slice(EVENT.indexOf("export async function ingestPaymentEvent"));
    // The authenticated boundary runs first, and anything but ACCEPTED returns
    // before the payment is even loaded.
    const authIndex = ingest.indexOf("ingestAuthenticatedExternalEvent");
    const loadIndex = ingest.indexOf("from(paymentIntents)");
    const applyIndex = ingest.indexOf("await apply(");
    expect(authIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeLessThan(loadIndex);
    expect(ingest).toMatch(/ingested\.outcome !== "ACCEPTED"/);
    // And the verifier runs before anything is applied.
    expect(ingest.indexOf("verifyPaymentClaim")).toBeLessThan(applyIndex);
    expect(ingest).toMatch(/!verdict\.verified/);
  });

  it("an event finds its payment by reference, never by resemblance", () => {
    //   AMBIGUOUS_EVENT_PAYMENT_MATCH = 0
    //   OUT_OF_ORDER_EVENT_DOWNGRADES_TERMINAL_STATE = 0
    const EVENT = strip(read("api/runtime/payment-event.ts"));
    expect(EVENT).toMatch(/eq\(paymentIntents\.id, input\.reference\)/);
    // No search by money, by owner, by recency or by «the only open one».
    expect(EVENT).not.toMatch(/orderBy|amountMinor\)|ownerId\)|createdAt/);
    expect(EVENT).toMatch(/TERMINAL\.has\(intent\.status\)/);
  });

  it("the event path names no provider and no kind of business", () => {
    //   PROVIDER_NAME_EVENT_BRANCHES = 0 · DOMAIN_EVENT_HANDLERS_ADDED = 0
    const EVENT = strip(read("api/runtime/payment-event.ts"));
    for (const named of [
      "stripe", "adyen", "paypal", "visa", "mastercard", "bank",
      "restaurant", "car", "hotel", "booking", "food",
    ]) {
      expect(EVENT.toLowerCase(), named).not.toMatch(new RegExp(`\\b${named}s?\\b`));
    }
    expect(EVENT).not.toMatch(/switch\s*\(/);
    expect((EVENT.match(/export async function ingestPaymentEvent/g) ?? []).length).toBe(1);
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
