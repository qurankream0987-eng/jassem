/**
 * JASIM — THE SOURCE RESOLUTION CONTRACT.
 *
 * What the decision layer promises, checked without a database, a provider or
 * a person: it chooses and does nothing else.
 *
 *   SOURCE_RESOLUTION != TRUTH · SOURCE_RESOLUTION != AUTHORITY
 *   DOMAIN_SOURCE_HANDLERS_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
 *   SOURCE_RESOLUTION_MUTATING_PROVIDER_CALLS = 0
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FACT_CAPABILITIES, SOURCE_OUTCOMES } from "../../api/runtime/source-resolution";
import { PROVIDER_CAPABILITIES, capabilityMutates } from "../../api/runtime/provider-binding";

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");
const SOURCE = read("api/runtime/source-resolution.ts");
/** Comments say what is intended; code is what happens. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const BINDING_CODE = read("api/runtime/provider-binding.ts").replace(
  /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
  "",
);

describe("the source resolution contract", () => {
  it("only the two verbs that report on a known thing may establish a fact", () => {
    //   DOMAIN_SOURCE_CAPABILITIES_ADDED = 0
    expect([...FACT_CAPABILITIES]).toEqual(["READ", "OBSERVE"]);
    // Both are existing vocabulary. Neither is new, and neither mutates.
    for (const capability of FACT_CAPABILITIES) {
      expect(PROVIDER_CAPABILITIES, capability).toContain(capability);
      expect(capabilityMutates(capability), capability).toBe(false);
    }
    // No verb that changes something appears in this module at all, so no
    // path through it can reach one.
    for (const verb of PROVIDER_CAPABILITIES.filter((one) => capabilityMutates(one))) {
      expect(CODE, verb).not.toContain(`"${verb}"`);
    }
  });

  it("the outcomes distinguish every way this can end", () => {
    expect([...SOURCE_OUTCOMES]).toEqual([
      "SUFFICIENT_EXISTING",
      "SUFFICIENT_AFTER_PROVIDER",
      "AWAITING_HUMAN",
      "AMBIGUOUS_SOURCE",
      "NO_SOURCE",
    ]);
  });

  it("nothing here names a business, a provider or a thing", () => {
    for (const name of [
      "shopify", "stripe", "salesforce", "quickbooks", "google", "twilio",
      "car", "shirt", "garment", "restaurant", "hotel", "flight", "venue",
      "inventory", "calendar", "invoice", "stock", "room", "seat",
    ]) {
      expect(CODE.toLowerCase(), `names ${name}`).not.toMatch(
        new RegExp(`\\b${name}s?\\b`),
      );
    }
    // The property is matched as a string against what a definition declares
    // it observes — a check that lives in the binding runtime, reached by
    // passing the property through untouched. Nothing here interprets it, so
    // an unfamiliar one needs no new branch.
    expect(CODE).toMatch(/verifiedBindingsFor\(\{ scopeId, capability, property \}\)/);
    expect(BINDING_CODE).toMatch(/\(definition\?\.observes \?\? \[\]\)\.includes\(input\.property\)/);
    expect(CODE).not.toMatch(/switch\s*\(/);
  });

  it("it establishes nothing and judges nothing", () => {
    //   SOURCE_RESOLUTION != TRUTH
    //
    // Every verdict in the result came from `assessSufficiency`. This module
    // never builds one, never edits one, and never writes a fact of its own.
    expect(CODE).toMatch(/assessSufficiency\(/);
    expect(CODE).not.toMatch(/verdict:\s*"SUFFICIENT"/);
    expect(CODE).not.toMatch(/decideSufficiency|evidencePolicyFor/);
    // It creates no claim on anything.
    //
    //   PROVIDER_AVAILABILITY_CREATES_RESERVATION = 0
    expect(CODE).not.toMatch(
      /createReservation|createAgreement|commitAgreement|createTransaction|createProposal/,
    );
    // And it writes no row of its own: the only insert it causes is the
    // observation the provider runtime records.
    //
    //   NEW_SOURCE_TABLE_ADDED = NO
    expect(CODE).not.toMatch(/db\s*\.\s*insert|db\s*\.\s*update|db\s*\.\s*delete/);
  });

  it("it duplicates neither the human runtime nor the authority derivation", () => {
    //   SECOND_HUMAN_VERIFICATION_RUNTIME = 0
    expect(CODE).toMatch(/requireCounterpartyEvidence\(/);
    // No question of its own, no notification of its own, no expiry of its own.
    expect(CODE).not.toMatch(/verificationRequests|notificationIntents|answerVerification/);
    //   MODEL_CAN_CHOOSE_SOURCE_SCOPE = NO
    // The scopes come from the subject, and there is no other way in.
    expect(CODE).toMatch(/subjectAuthority\(/);
    expect(CODE).not.toMatch(/scopeIds:\s*input\.|sourceScope\s*=\s*input\./);
  });

  it("the asking scope is never where the answering system is looked for", () => {
    //   BUYER_PROVIDER_USED_FOR_SELLER_FACT = 0
    //
    // `requestingScopeId` reaches exactly three places: reading evidence,
    // reading this scope's own policy, and asking a person on its behalf. It
    // never reaches the binding lookup, which takes its scopes from the
    // authority derivation alone.
    const candidates = CODE.slice(CODE.indexOf("async function candidatesFor"));
    expect(candidates).not.toMatch(/requestingScopeId/);
    expect(candidates).toMatch(/scopeIds/);
  });

  it("a tie is reported, never broken by an ordering", () => {
    //   MULTIPLE_PROVIDER_LATEST_WINS = 0
    const choose = CODE.slice(CODE.indexOf("function chooseCandidate"));
    expect(choose).toMatch(/AMBIGUOUS/);
    // No ordering is consulted: no sort, and no reaching for a verification
    // time — the newest verification is not the better system.
    expect(choose).not.toMatch(/sort\(|verifiedAt|slice\(|pop\(|shift\(/);
    // The one index it takes is the ONLY candidate, and the line above it says
    // so. Anything else with more than one goes to the ambiguity.
    expect(choose).toMatch(/candidates\.length === 1\) return candidates\[0\]!/);
    expect((choose.match(/candidates\[0\]/g) ?? []).length).toBe(1);
  });

  it("policy may make JASIM ask a person, and may not make evidence sufficient", () => {
    const policy = CODE.slice(
      CODE.indexOf("export async function sourcePolicyFor"),
      CODE.indexOf("const inFlight"),
    );
    // Two fields, both narrowing. Nothing here touches age, source strength or
    // what counts as enough.
    expect(policy).toMatch(/humanRequiredFor/);
    expect(policy).toMatch(/preferredProviders/);
    expect(policy).not.toMatch(/maxAgeMs|acceptedSources|SUFFICIENT/);
    // An unknown entry is dropped rather than honoured.
    expect(policy).toMatch(/typeof entry === "string"/);
  });

  it("the in-flight collapse is not claimed to be coordination", () => {
    // It is a Map, it is honest about being a Map, and the reason that is safe
    // is written where somebody changing it will read it: a read mutates
    // nothing, so a duplicate across processes is waste rather than damage.
    expect(SOURCE).toMatch(/NOT\s*\n?\s*\*?\s*canonical coordination/);
    expect(CODE).toMatch(/inFlight\.delete\(key\)/);
  });
});
