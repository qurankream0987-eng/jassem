/**
 * JASIM — THE PROVIDER BINDING CONTRACT.
 *
 * What the binding layer PROMISES, checked without a database and without a
 * provider: the vocabulary is closed and general, read and write are different
 * sets rather than two levels of one, the runtime performs no transport of its
 * own, and nothing here names a business.
 *
 *   DOMAIN_PROVIDER_BINDING_TYPES = 0 · DOMAIN_NOUN_BRANCHES = 0
 *   NEW_PROVIDER != NEW_CORE · PAYMENT_PROVIDER_SPECIAL_BINDING_RUNTIME = 0
 *   MODEL_ARBITRARY_HTTP_EXECUTION = 0 · PRODUCTION_FAKE_PROVIDER = 0
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BINDING_LIFECYCLE,
  PROVIDER_AUTH_METHODS,
  PROVIDER_CAPABILITIES,
  ProviderDefinitionRegistry,
  capabilityMutates,
  providerDefinitions,
} from "../../api/runtime/provider-binding";

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");
const SOURCE = read("api/runtime/provider-binding.ts");
const VAULT = read("api/runtime/provider-credential-vault.ts");
const MIGRATION = read("db/migrations-pg/0026_provider_bindings.sql");
/** Comments say what is intended; code is what happens. Assertions read code. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
const VAULT_CODE = VAULT.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("the provider binding contract", () => {
  // ── A · THE VOCABULARY IS CLOSED AND GENERAL ─────────────────────────────

  it("capabilities are verbs, and there are no others", () => {
    expect([...PROVIDER_CAPABILITIES]).toEqual([
      "READ", "SEARCH", "DISCOVER", "OBSERVE", "TRACK",
      "CREATE", "UPDATE", "DELETE", "BOOK", "SCHEDULE", "MESSAGE", "PAY", "REFUND",
    ]);
    // Not READ_SHIRTS, not BOOK_HOTEL, not UPDATE_CAR. A capability that named
    // a thing would be the end of the generality this list carries.
    for (const capability of PROVIDER_CAPABILITIES) {
      expect(capability, capability).toMatch(/^[A-Z]+$/);
    }
  });

  it("read and write are different sets, not two levels of one", () => {
    //   READ_GRANT_IMPLIES_WRITE = 0
    const reads = PROVIDER_CAPABILITIES.filter((c) => !capabilityMutates(c));
    const writes = PROVIDER_CAPABILITIES.filter((c) => capabilityMutates(c));
    expect(reads).toEqual(["READ", "SEARCH", "DISCOVER", "OBSERVE", "TRACK"]);
    expect(writes).toEqual([
      "CREATE", "UPDATE", "DELETE", "BOOK", "SCHEDULE", "MESSAGE", "PAY", "REFUND",
    ]);
    // Partitioned: nothing is both, and nothing is neither.
    expect(reads.length + writes.length).toBe(PROVIDER_CAPABILITIES.length);
    expect(reads.filter((c) => writes.includes(c as never))).toEqual([]);
    // And an unknown verb is not quietly a read.
    expect(capabilityMutates("WHATEVER")).toBe(false);
  });

  it("payment is a capability, not a second binding runtime", () => {
    //   PAYMENT_PROVIDER_SPECIAL_BINDING_RUNTIME = 0
    expect(PROVIDER_CAPABILITIES).toContain("PAY");
    expect(PROVIDER_CAPABILITIES).toContain("REFUND");
    expect(capabilityMutates("PAY")).toBe(true);
    expect(capabilityMutates("REFUND")).toBe(true);
    // Each appears exactly twice in the whole runtime: once in the
    // vocabulary, once in the set of verbs that change something. There is no
    // third mention, so no branch anywhere treats money as a special case.
    expect((CODE.match(/"PAY"/g) ?? []).length).toBe(2);
    expect((CODE.match(/"REFUND"/g) ?? []).length).toBe(2);
  });

  it("the lifecycle keeps every arrow separate", () => {
    //   AUTHORIZED != AUTHENTICATED != VERIFIED · FALSE_CONNECTED_STATE = 0
    expect([...BINDING_LIFECYCLE]).toEqual([
      "SETUP_PENDING", "AUTHORIZED", "AUTHENTICATED", "VERIFIED", "SUSPENDED", "REVOKED",
    ]);
    // Exactly one state is usable, and the gate names it once.
    expect(CODE.match(/lifecycle !== "VERIFIED"/g) ?? []).not.toHaveLength(0);
  });

  it("every authentication method has a declared credential shape", () => {
    //   Auth method is CONFIGURATION, never a runtime of its own.
    for (const method of PROVIDER_AUTH_METHODS) {
      expect(CODE, method).toContain(`${method}:`);
    }
    // And there is no per-method branch: one lifecycle serves all of them.
    expect(CODE).not.toMatch(/if\s*\(\s*\w*[Aa]uthMethod\s*===/);
  });

  // ── B · NO BUSINESS IS NAMED ─────────────────────────────────────────────

  it("no provider and no industry is named anywhere in the runtime", () => {
    //   DOMAIN_PROVIDER_BINDING_TYPES = 0 · DOMAIN_PROVIDER_BINDING_HANDLERS = 0
    const named = [
      "shopify", "stripe", "paypal", "salesforce", "hubspot", "quickbooks",
      "xero", "square", "woocommerce", "magento", "netsuite", "sap",
      "google", "microsoft", "outlook", "twilio", "sendgrid", "slack",
    ];
    // Checked against CODE, not the prose. The header says out loud that
    // there is no ShopifyBindingRuntime; saying so is the opposite of being
    // one, and an assertion that could not tell them apart would forbid the
    // module from explaining itself.
    for (const name of named) {
      expect(CODE.toLowerCase(), `names ${name}`).not.toContain(name);
    }
    const nouns = [
      "car", "shirt", "garment", "restaurant", "hotel", "flight", "venue",
      "translator", "machine", "storage", "grocery", "pharmacy", "clinic",
      "inventory", "calendar", "invoice",
    ];
    for (const noun of nouns) {
      expect(CODE.toLowerCase(), `branches on ${noun}`)
        .not.toMatch(new RegExp(`\\b${noun}s?\\b`));
    }
  });

  it("the migration adds no column that names a kind of business", () => {
    const columns = [...MIGRATION.matchAll(/"([A-Za-z]+)"\s+(varchar|jsonb|integer|text|timestamptz)/g)]
      .map((match) => match[1]!.toLowerCase());
    expect(columns.length).toBeGreaterThan(10);
    for (const column of columns) {
      expect(column, column).not.toMatch(
        /shop|store|invoice|inventory|calendar|booking|order|payment|card/,
      );
    }
  });

  // ── C · THE RUNTIME IS NOT A TRANSPORT AND NOT AN EXECUTOR ───────────────

  it("the runtime performs no request of its own", () => {
    //   MODEL_ARBITRARY_HTTP_EXECUTION = 0
    //
    // It never builds a URL, a method, a header or a body. An ADAPTER does
    // that, in trusted code, from an endpoint the registry or a person at a
    // trusted surface supplied — so there is no path from model output to a
    // request, because there is no request here to reach.
    expect(CODE).not.toMatch(/\bfetch\s*\(|axios|got\s*\(|https?\.request|XMLHttpRequest/);
    expect(CODE).not.toMatch(/headers\s*:|method\s*:\s*"(GET|POST|PUT|PATCH|DELETE)"/);
  });

  it("the runtime plans nothing and decides no business fact", () => {
    //   PROVIDER_BINDING_DECLARES_BUSINESS_TRUTH = 0
    //   PROVIDER_RESPONSE_BYPASSES_FRESHNESS = 0
    //
    // It writes an observation and stops. It never reaches for the runtime
    // that decides whether evidence is good enough, because deciding that is
    // not its job — and a module that called it could be tempted to act on it.
    expect(CODE).not.toMatch(/assessSufficiency|decideSufficiency|evidencePolicyFor/);
    expect(CODE).not.toMatch(/createAgreement|commitAgreement|createReservation|createTransaction/);
    // And nothing here invents availability, a booking or a price.
    expect(CODE).not.toMatch(/available\s*[:=]\s*(true|false)/);
  });

  it("a provider failing is reported as a provider failing", () => {
    //   PROVIDER_UNAVAILABLE != BUSINESS_FACT · PROVIDER_ERROR != UNAVAILABLE
    expect(CODE).toContain("PROVIDER_UNAVAILABLE");
    expect(CODE).toContain("PROVIDER_ERROR");
    // Two outcomes, never collapsed into one another and never into a verdict.
    expect(CODE).not.toMatch(/UNAVAILABLE.*=>.*false|catch[\s\S]{0,120}?return\s*{\s*status:\s*"OK"/);
  });

  // ── D · THE SECRET ───────────────────────────────────────────────────────

  it("the binding runtime never writes credential material anywhere", () => {
    //   RAW_PROVIDER_SECRET_IN_CANONICAL_BINDING = 0
    //   RAW_PROVIDER_SECRET_IN_EVENT_LOG = 0
    //   RAW_PROVIDER_SECRET_IN_MODEL_CONTEXT = 0
    //
    // The only thing it holds is a reference, and the only thing that opens
    // one is the vault. There is no path from `credential` to an insert, a
    // projection or an event payload, because the audit payload is assembled
    // from a fixed list of named fields rather than spread from anything.
    expect(CODE).not.toMatch(/\.\.\.\s*credential|credential\s*:\s*material|payload:\s*\{\s*\.\.\./);
    expect(CODE).not.toMatch(/console\.(log|info|warn|error)/);
    // A projection is built field by field, so a column added later cannot
    // leak by existing.
    expect(CODE).not.toMatch(/return\s*\{\s*\.\.\.row/);
  });

  it("the vault seals and never encrypts something new of its own invention", () => {
    // The repository already had this construction. Using a second one would
    // have meant two places to get wrong.
    expect(VAULT_CODE).toContain("aes-256-gcm");
    expect(VAULT_CODE).toContain("setAAD");
    expect(VAULT_CODE).toContain("setAuthTag");
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: the AAD is scope, binding and version.
    // WHY_IT_IS_WRONG: it is not wrong — it is the assertion that pins what the
    //   envelope is bound to, and it is what flagged this change. It had become
    //   incomplete: one binding now holds two KINDS of material, an outbound
    //   credential and inbound webhook verification material.
    // NEW_EXPECTATION: scope, binding, KIND and version.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: without the kind in the AAD, somebody
    //   holding the database could move a credential reference into
    //   `webhookCredentialRef` and have an outbound API key accepted as the
    //   material that authenticates inbound callbacks. The kind is now
    //   authenticated rather than merely stored beside the envelope.
    //
    //   ENVELOPE_OPENED_AS_THE_WRONG_KIND = 0
    //
    // A sealed value still cannot be replayed into another binding or an older
    // rotation, and now not into another purpose either.
    expect(VAULT_CODE).toMatch(
      /scopeId\}:\$\{context\.bindingId\}:\$\{kind\}:\$\{context\.version\}/,
    );
    // No weaker mode, and no key that is not derived.
    expect(VAULT_CODE).not.toMatch(/aes-\d+-(cbc|ecb|ctr)/);
    // And nothing logs.
    expect(VAULT_CODE).not.toMatch(/console\./);
  });

  it("the migration stores a reference on the binding and material nowhere near it", () => {
    expect(MIGRATION).toContain('"credentialRef" varchar');
    expect(MIGRATION).toMatch(/ciphertext|authTag/);
    // The binding table gains no column that could hold a secret.
    // The statements, not the prose around them: the header of the vault
    // section states the law it enforces, and a law naming a secret is not a
    // column holding one.
    const statements = MIGRATION.replace(/^\s*--.*$/gm, "");
    const bindingSection = statements.slice(
      statements.indexOf("ALTER TABLE"),
      statements.indexOf("CREATE TABLE"),
    );
    expect(bindingSection).not.toMatch(/secret|token|password|apiKey|ciphertext/i);
  });

  // ── E · NO FIXTURE IS A PROVIDER ─────────────────────────────────────────

  it("the production registry is empty and cannot be given a fixture", () => {
    //   PRODUCTION_FAKE_PROVIDER = 0 — arithmetic, not a promise.
    expect(providerDefinitions.list()).toEqual([]);
    const fixture = {
      id: "anything", displayName: "x", authMethod: "API_KEY" as const,
      supports: ["READ"] as const, endpoint: { mode: "FIXED" as const, baseUrl: "https://example.com" },
      testOnly: true,
      adapter: {
        authenticate: async () => ({ ok: true as const, accountRef: "a" }),
        discover: async () => ["READ"] as const,
        invoke: async () => ({ status: "OK" as const, value: null }),
      },
    };
    expect(() => providerDefinitions.register(fixture)).toThrowError(/test fixture/);
    // A registry built to hold one accepts it, and that registry is test code.
    expect(() =>
      new ProviderDefinitionRegistry({ allowTestOnly: true }).register(fixture),
    ).not.toThrow();
  });

  it("a definition that supports nothing, or an unknown verb, is refused", () => {
    const registry = new ProviderDefinitionRegistry({ allowTestOnly: true });
    const base = {
      displayName: "x", authMethod: "API_KEY" as const, testOnly: true,
      endpoint: { mode: "FIXED" as const, baseUrl: "https://example.com" },
      adapter: {
        authenticate: async () => ({ ok: true as const, accountRef: "a" }),
        discover: async () => ["READ"] as const,
        invoke: async () => ({ status: "OK" as const, value: null }),
      },
    };
    expect(() => registry.register({ ...base, id: "a", supports: [] })).toThrow();
    expect(() =>
      registry.register({ ...base, id: "b", supports: ["READ_SHIRTS"] as never }),
    ).toThrowError(/not a capability/);
    // A fixed address is checked at registration, so a bad one fails at start.
    expect(() =>
      registry.register({
        ...base, id: "c", supports: ["READ"],
        endpoint: { mode: "FIXED", baseUrl: "http://example.com" },
      }),
    ).toThrowError(/https/);
    expect(() =>
      registry.register({
        ...base, id: "d", supports: ["READ"],
        endpoint: { mode: "FIXED", baseUrl: "https://localhost/api" },
      }),
    ).toThrowError(/local/);
  });

  // ── F · THE MODEL CREATES NOTHING ────────────────────────────────────────

  it("no state a model could name is taken from an input", () => {
    //   MODEL_CAN_DECLARE_PROVIDER_CONNECTED = NO
    //   MODEL_CAN_SET_BINDING_SCOPE = NO
    //
    // `lifecycle`, `grantedCapabilities`, `accountRef` and `verifiedAt` are
    // written by this module from what it established itself. None of them is
    // ever read off `input`, which is the only thing a caller controls.
    // Asserted on every write to the BINDING ROW — the `.set({…})` of each
    // update, and the single literal the insert is built from.
    //
    // The audit helper is deliberately not in this set. It records the
    // lifecycle its caller passed, and its callers are the transitions below,
    // each handing it a literal it just established. An event log that could
    // not say what happened would be no log; what matters is that the event
    // never becomes the source of the state.
    const writes = [
      ...[...CODE.matchAll(/\.set\(\{[\s\S]*?\}\)/g)].map((match) => match[0]),
      CODE.slice(CODE.indexOf("const values = {"), CODE.indexOf("if (existing)")),
    ];
    expect(writes.length).toBeGreaterThanOrEqual(6);
    for (const write of writes) {
      for (const key of ["lifecycle", "grantedCapabilities", "accountRef", "verifiedAt", "state"]) {
        expect(write, `${key} written from an input`).not.toMatch(
          new RegExp(`${key}:\\s*input\\.`),
        );
      }
    }
    // And the one thing the insert DOES take from its caller is the scope,
    // which arrives from a resolved acting scope and is authorized before it
    // is used — checked by the cross-scope proofs, not by a regular expression.
    expect(CODE).toMatch(/scopeId: input\.scopeId/);
    // The grant is an intersection of three things, and the request is only
    // one of them.
    expect(CODE).toMatch(/requested\.has\(/);
    expect(CODE).toMatch(/supported\.has\(/);
  });

  it("the address is written at one boundary, and it is the trusted one", () => {
    //   MODEL_OUTPUT_TO_BINDING_ENDPOINT_DIRECT_PATH = 0
    //
    // `beginProviderSetup` is reached from a conversation and has no endpoint
    // parameter at all. `completeProviderSetup` is reached only from the
    // trusted product action, and is the one place an address is validated
    // and stored — in the same statement as the credential reference.
    const begin = CODE.slice(
      CODE.indexOf("export async function beginProviderSetup"),
      CODE.indexOf("export async function completeProviderSetup"),
    );
    // No parameter for one, and no read of one either.
    expect(begin).not.toMatch(/endpointUrl\?:/);
    expect(begin).not.toMatch(/input\.endpointUrl/);
    expect(begin).not.toMatch(/assertReachableEndpoint/);
    // What it writes instead, explicitly: nothing.
    expect(begin).toMatch(/endpointUrl:\s*null/);

    const complete = CODE.slice(
      CODE.indexOf("export async function completeProviderSetup"),
      CODE.indexOf("export async function authenticateBinding"),
    );
    expect(complete).toMatch(/assertReachableEndpoint\(input\.endpointUrl\)/);
    // A FIXED provider's address is refused, not ignored.
    expect(complete).toMatch(/else if \(input\.endpointUrl\)/);

    // And the whole runtime validates an address in exactly one place.
    expect((CODE.match(/assertReachableEndpoint\(/g) ?? []).length).toBe(2);
  });

  it("the conversation schema has nowhere to put an address", () => {
    //   MODEL_CAN_SET_PROVIDER_ENDPOINT = NO
    const runtime = read("api/runtime/jasim-runtime.ts").replace(
      /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      "",
    );
    const schema = runtime.slice(
      runtime.indexOf("export const ProviderBindingRequestSchema"),
      runtime.indexOf("const WorldRequestSchema"),
    );
    expect(schema).not.toMatch(/endpoint/i);
    expect(schema).not.toMatch(/url/i);
    // What it DOES carry is intent and a registered definition id.
    expect(schema).toMatch(/definitionId/);
  });

  it("standing is re-read on every use, never remembered from setup", () => {
    //   FORMER_MEMBER_MANAGES_ORG_BINDING = 0 · CROSS_SCOPE_BINDING = 0
    //
    // `boundByPrincipalId` records who connected it. It is never consulted to
    // decide who may use or manage it afterwards.
    expect(CODE).not.toMatch(/boundByPrincipalId\s*(===|!==)/);
    expect((CODE.match(/authorizeScopeAction\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
