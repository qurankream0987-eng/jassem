/**
 * JASIM — the transaction contract.
 *
 * The live proof is `tests/block31/transaction-fulfillment.test.ts`. This file
 * holds what must be true without a database:
 *
 *   TRANSACTION != PAYMENT != FULFILLMENT != VERIFICATION
 *   CLAIMED_COMPLETE != VERIFIED_COMPLETE
 *   DOMAIN_TRANSACTION_TYPES_ADDED = 0
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OBLIGATION_STATES,
  OBLIGATION_VERIFICATIONS,
  TRANSACTION_AUTHORITY_KEYS,
  TRANSACTION_STATES,
  assertNoTransactionAuthorityClaim,
  compensationFor,
  deriveTransactionState,
  termsDigest,
  transactionFacts,
} from "../../api/runtime/transaction-runtime";
import { parseTermSheet } from "../../api/runtime/agreement-runtime";
import { RELEASED_OBLIGATION_STATE } from "../../api/runtime/agreement-release";
import { AUTHORITY_KEYS } from "../../api/runtime/model-output-trust";

const source = readFileSync(resolve(process.cwd(), "api/runtime/transaction-runtime.ts"), "utf8");

/**
 * Comments removed.
 *
 * The module names `PurchaseTransaction` and "seller ships, buyer pays" in
 * comments saying neither must exist. A check that cannot tell the rule from
 * the violation would force the rule to be deleted in order to pass.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * …and the refused-keys set removed as well.
 *
 * It lists `captured`, `receipt` and `settled` because those are the words a
 * caller may never say. A check that could not tell a refusal from a
 * capability would force the refusal to be deleted, which is the same mistake
 * as deleting the comment.
 */
const doing = (() => {
  const start = code.indexOf("export const TRANSACTION_AUTHORITY_KEYS");
  const end = code.indexOf("]);", start);
  return start < 0 ? code : code.slice(0, start) + code.slice(end);
})();

const OBLIGATION = (over: Record<string, unknown> = {}) =>
  ({
    id: "cmt_1",
    termKey: "delivery",
    ownerId: "A",
    evidenceKind: "HUMAN_ACTION",
    state: "PENDING",
    verification: "PENDING",
    ...over,
  }) as never;

// ── Not a commerce vertical ──────────────────────────────────────────────────

describe("one transaction for every exchange there is", () => {
  it("exports no domain transaction type", () => {
    const DOMAIN = [
      "Purchase", "Rental", "Job", "Delivery", "Wholesale", "Shipping", "Order",
      "Booking", "Invoice", "Cart", "Checkout",
    ];
    const declared = [...code.matchAll(/export (?:type|function|const|class) (\w+)/g)].map(
      (match) => match[1]!,
    );
    for (const name of declared) {
      for (const word of DOMAIN) {
        expect(name, `${name} contains ${word}`).not.toContain(word);
      }
    }
  });

  it("names no role and no subject", () => {
    // "seller ships, buyer pays" is the assumption that ends an open market.
    for (const word of ['"buyer"', '"seller"', '"shipper"', '"vendor"', '"customer"', 'buyerRef', 'sellerRef']) {
      expect(code, word).not.toContain(word);
    }
  });

  it("the table has no buyer or seller column", () => {
    const schema = readFileSync(resolve(process.cwd(), "db/schema-block2.ts"), "utf8");
    const table = schema.slice(schema.indexOf('export const transactions = pgTable'));
    const body = table.slice(0, table.indexOf("\n);"));
    for (const word of ["buyer", "seller", "customer", "vendor", "product", "sku"]) {
      expect(body.toLowerCase(), word).not.toContain(word);
    }
    // A list, not two columns.
    expect(body).toContain('parties: jsonb("parties")');
  });

  it("its vocabularies are closed", () => {
    //
    // ── AN INHERITED EXPECTATION, WIDENED BY ONE MEMBER AND TIGHTENED ───────
    //
    // OLD_EXPECTATION: TRANSACTION_STATES is exactly
    //   [OPEN, SETTLED, FAILED, CANCELLED, COMPENSATING] and OBLIGATION_STATES
    //   is exactly [PENDING, IN_PROGRESS, CLAIMED, FAILED, CANCELLED].
    // WHY_IT_IS_WRONG: it is not wrong about anything it says — it is only a
    //   LITERAL LIST, and the rule it stands for is «the set is closed and
    //   every member is deliberate», not «these five forever». The mutual
    //   release phase added a state that a real transition needs: two parties
    //   ending what remained is neither SETTLED (which means every obligation
    //   was VERIFIED) nor CANCELLED (which means nothing irreversible
    //   happened), and without it such a transaction stayed OPEN forever.
    // NEW_EXPECTATION: the lists are pinned as before WITH `RELEASED`, and —
    //   the part the literal list could never say — every transaction state
    //   must actually appear in the one function that decides a transaction's
    //   state, and every value the runtime writes to `commitments.state` must
    //   be a member of the obligation vocabulary.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: a literal list is passed by adding
    //   a member to both the list and the test, which is exactly how
    //   decorative taxonomy arrives — and this module's own header argues
    //   against «a taxonomy member that changes no behaviour». The first new
    //   clause fails such a member. The second fails a THIRD vocabulary being
    //   written to a column that already carries two, which no list could see.
    expect([...TRANSACTION_STATES]).toEqual([
      "OPEN", "SETTLED", "FAILED", "CANCELLED", "COMPENSATING", "RELEASED",
    ]);
    expect([...OBLIGATION_STATES]).toEqual([
      "PENDING", "IN_PROGRESS", "CLAIMED", "FAILED", "CANCELLED", "RELEASED",
    ]);
    expect([...OBLIGATION_VERIFICATIONS]).toEqual([
      "PENDING", "VERIFIED", "FAILED", "INCONCLUSIVE",
    ]);

    // Every transaction state earns its place in the function that decides one.
    const decide = code.slice(code.indexOf("export function deriveTransactionState"));
    const body = decide.slice(0, decide.indexOf("\nasync function"));
    for (const state of TRANSACTION_STATES) {
      expect(body, `${state} changes no decision`).toContain(`"${state}"`);
    }

    // And nothing invents a third vocabulary for the obligation column. Scoped
    // to writes on `commitments`: the same `state` key on `transactions` is a
    // different vocabulary and a check that conflated them would prove nothing.
    const writers = [
      readFileSync(resolve(process.cwd(), "api/runtime/transaction-runtime.ts"), "utf8"),
      readFileSync(resolve(process.cwd(), "api/runtime/agreement-release.ts"), "utf8"),
    ].join("\n");
    const values: string[] = [];
    for (const hit of writers.matchAll(/update\(commitments\)/g)) {
      const window = writers.slice(hit.index!, hit.index! + 400);
      const state = /\bstate:\s*(?:RELEASED_OBLIGATION_STATE|"([A-Za-z_]+)")/.exec(window);
      // A write that sets no state at all is not this rule's business.
      if (state?.[1]) values.push(state[1]);
    }
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect([...OBLIGATION_STATES], value).toContain(value);
    }
    // The release writes its state through a named constant; it must be one too.
    expect([...OBLIGATION_STATES]).toContain(RELEASED_OBLIGATION_STATE);
  });

  it("treats unrelated term keys identically", () => {
    const digestOf = (key: string) =>
      termsDigest(parseTermSheet([{ key, kind: "NUMBER", value: 6, owedBy: "A" }]));
    const facts = (key: string) =>
      Object.keys(transactionFacts(parseTermSheet([{ key, kind: "NUMBER", value: 6 }])));
    const shapes = ["units", "instrumentHours", "palletDays", "ساعات الترجمة"].map(facts);
    expect(new Set(shapes.map((entry) => entry.join(","))).size).toBe(1);
    // And two different keys are two different commitments, as they must be.
    expect(digestOf("units")).not.toBe(digestOf("instrumentHours"));
  });
});

// ── The state is derived ─────────────────────────────────────────────────────

describe("a transaction's state is derived, never asserted", () => {
  it("one verified and one pending is OPEN", () => {
    // PAID != DELIVERED, as a function.
    expect(
      deriveTransactionState([
        OBLIGATION({ termKey: "payment", verification: "VERIFIED" }),
        OBLIGATION({ termKey: "delivery", verification: "PENDING" }),
      ]),
    ).toBe("OPEN");
  });

  it("all verified is SETTLED", () => {
    expect(
      deriveTransactionState([
        OBLIGATION({ verification: "VERIFIED" }),
        OBLIGATION({ verification: "VERIFIED" }),
      ]),
    ).toBe("SETTLED");
  });

  it("a CLAIM never settles anything", () => {
    // CLAIMED_COMPLETE != VERIFIED_COMPLETE, as a function.
    expect(
      deriveTransactionState([
        OBLIGATION({ state: "CLAIMED", verification: "PENDING" }),
        OBLIGATION({ state: "CLAIMED", verification: "PENDING" }),
      ]),
    ).toBe("OPEN");
  });

  it("a failure outranks the rest", () => {
    expect(
      deriveTransactionState([
        OBLIGATION({ verification: "VERIFIED" }),
        OBLIGATION({ verification: "FAILED" }),
      ]),
    ).toBe("FAILED");
  });

  it("an INCONCLUSIVE obligation does not settle and does not fail", () => {
    expect(
      deriveTransactionState([OBLIGATION({ verification: "INCONCLUSIVE" })]),
    ).toBe("OPEN");
  });

  it("cancelling and compensating are terminal to derivation", () => {
    expect(
      deriveTransactionState([OBLIGATION({ verification: "VERIFIED" })], "CANCELLED"),
    ).toBe("CANCELLED");
    expect(
      deriveTransactionState([OBLIGATION({ verification: "VERIFIED" })], "COMPENSATING"),
    ).toBe("COMPENSATING");
  });

  it("nothing in the module writes SETTLED by hand", () => {
    const writes = [...code.matchAll(/state:\s*"SETTLED"/g)];
    expect(writes).toHaveLength(0);
  });
});

// ── Verification is borrowed, not rebuilt ────────────────────────────────────

describe("no fulfillment verifier exists", () => {
  it("settlement runs the completion policy every effect runs through", () => {
    expect(code).toContain("COMPLETION_POLICIES[effectKind]");
    expect(code).toContain("decideCompletion(");
    // And reads observations through the bridge rather than a query of its own.
    expect(code).toContain("observationEvidence(");
  });

  it("the module defines no verifier and no evidence vocabulary of its own", () => {
    for (const forbidden = ["function verify", "CLAIM_SOURCES", "TRUST_", "sufficientSources ="] as const;;) {
      for (const entry of forbidden) expect(code, entry).not.toContain(entry);
      break;
    }
  });

  it("compensation comes from the policy the runtime already has", () => {
    expect(code).toContain("resolveCompensationPolicy(");
    const requirement = compensationFor([
      OBLIGATION({ evidenceKind: "REMOTE_MUTATION", verification: "VERIFIED" }),
    ]);
    expect(requirement).toHaveLength(1);
    expect(requirement[0]!.reversibility).toBeTruthy();
  });

  it("nothing deletes a row to undo an effect", () => {
    // A compensation is a NEW effect. Rollback by deletion is how history
    // stops being evidence.
    expect(code).not.toMatch(/db\s*\n?\s*\.delete\(/);
  });
});

// ── Payment is reused ────────────────────────────────────────────────────────

describe("there is one payment runtime and this is not it", () => {
  it("binds Block 3 rather than reimplementing it", () => {
    expect(code).toContain("createPaymentIntent(");
    // No second ledger, no second status machine, no provider call.
    for (const forbidden of ["psp", "capture", "settle(", "charge(", "refund("]) {
      expect(doing.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it("money is exact and never converted", () => {
    for (const forbidden of ["parseFloat", "Number(amount", "exchangeRate", "convertCurrency", "* rate"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("the payment identity is the obligation, so a retry is not a second payable", () => {
    expect(code).toContain("idempotencyKey: `obligation:${obligation.id}`");
  });
});

// ── Authority ────────────────────────────────────────────────────────────────

describe("a model may propose terms, never an outcome", () => {
  it.each(["settled", "fulfilled", "verified", "paid", "captured", "receipt", "transactionId"])(
    "refuses «%s» rather than ignoring it",
    (key) => {
      expect(() => assertNoTransactionAuthorityClaim({ [key]: true }, "inputs")).toThrow();
    },
  );

  it("every transaction authority key is also refused in model output", () => {
    for (const key of TRANSACTION_AUTHORITY_KEYS) {
      expect(AUTHORITY_KEYS, key).toContain(key);
    }
  });

  it("no capability materializes a transaction", () => {
    // It happens where a person's agreement happened, and nowhere a plan can
    // reach on its own.
    const callers = execSync("grep -rln 'transaction-runtime' api || true", {
      cwd: process.cwd(),
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(callers).toEqual([
      "api/runtime/agreement-runtime.ts",
      "api/runtime/model-output-trust.ts",
    ]);
  });
});

// ── Facts stay comparable ────────────────────────────────────────────────────

describe("a fact that is displayed is the fact that is compared", () => {
  it("value, unit and money are three separate facts", () => {
    const facts = transactionFacts(
      parseTermSheet([
        {
          key: "payment",
          kind: "NUMBER",
          value: 95,
          unit: "KWD",
          owedBy: "A",
          settlement: { amountMinor: "9500", currency: "KWD" },
        },
      ]),
    );
    expect(facts).toMatchObject({
      terms: { payment: 95 },
      units: { payment: "KWD" },
      settlements: { payment: 9500 },
      currencies: { payment: "KWD" },
    });
    // Never a display string a rule would compare and silently miss.
    expect(JSON.stringify(facts)).not.toContain("95 KWD");
  });

  it("the snapshot digest moves when any term moves", () => {
    const a = parseTermSheet([{ key: "price", kind: "NUMBER", value: 95 }]);
    const b = parseTermSheet([{ key: "price", kind: "NUMBER", value: 96 }]);
    expect(termsDigest(a)).not.toBe(termsDigest(b));
    expect(termsDigest(a)).toBe(termsDigest(parseTermSheet([{ key: "price", kind: "NUMBER", value: 95 }])));
  });
});
