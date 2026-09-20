/**
 * JASIM — the door into the Opportunity Exchange, as a contract.
 *
 * The live proof is in `tests/block31/opportunity-exchange-turn-path.test.ts`.
 * This file holds what must be true of the door itself, without a database:
 *
 *   • a caller never supplies identity
 *   • a caller never chooses what becomes public
 *   • the vocabulary is the fabric's own closed operator set
 *   • nothing in it knows what is being traded
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OpportunityInputError,
  executeOpportunityDiscover,
  executeOpportunityPublish,
} from "../../api/runtime/opportunity-capabilities";

const source = readFileSync(
  resolve(process.cwd(), "api/runtime/opportunity-capabilities.ts"),
  "utf8",
);

const OWNER = "contract-owner";

/** Every rejection below happens before any database call is attempted. */
const publish = (inputs: Record<string, unknown>) =>
  executeOpportunityPublish(inputs, OWNER);

const base = {
  kind: "OFFERING",
  semanticType: "generic unit",
  summary: "موجز",
};

// ── Identity and authority ───────────────────────────────────────────────────

describe("a caller never supplies identity or authority", () => {
  it.each(["ownerId", "userId", "tenantId", "actorId", "owner"])(
    "%s at the top level is refused, not ignored",
    async (key) => {
      await expect(publish({ ...base, [key]: "someone-else" })).rejects.toThrow(
        OpportunityInputError,
      );
    },
  );

  it.each(["verified", "trusted", "approved", "authorized", "published", "status"])(
    "%s at the top level is refused",
    async (key) => {
      await expect(publish({ ...base, [key]: true })).rejects.toThrow(OpportunityInputError);
    },
  );

  it("the same names are refused inside free-form attributes", async () => {
    for (const key of ["ownerId", "visibility", "status", "verified"]) {
      await expect(publish({ ...base, attributes: { [key]: "x" } })).rejects.toThrow(
        OpportunityInputError,
      );
    }
  });

  it("but `visibility` IS a legitimate top-level input", async () => {
    // It is taken from a closed two-value set and validated. Screening it with
    // the rest would have refused the ordinary case, which is how a guard
    // becomes something people work around.
    await expect(publish({ ...base, visibility: "SHARED" })).rejects.toThrow(
      /PRIVATE or PUBLIC/,
    );
  });

  it("discovery screens its inputs the same way", async () => {
    await expect(
      executeOpportunityDiscover({ kind: "OFFERING", ownerId: "someone-else" }, OWNER),
    ).rejects.toThrow(OpportunityInputError);
  });
});

// ── The public projection ────────────────────────────────────────────────────

describe("a caller never chooses what becomes public", () => {
  it("the projection is built from a closed set of fields", () => {
    // Structural, not a filter: the builder is handed four named values and
    // never sees `hardConstraints` or `attributes` at all. A filter can be
    // widened by accident; a function that cannot see the data cannot leak it.
    const builder = source.slice(
      source.indexOf("function publicProjection("),
      source.indexOf("// ── Publishing"),
    );
    expect(builder).toContain("semanticType");
    expect(builder).toContain("summary");
    expect(builder).toContain("publicTerms");
    expect(builder).toContain("availability");
    for (const forbidden of ["hardConstraints", "softPreferences", "attributes"]) {
      expect(builder, forbidden).not.toContain(forbidden);
    }
  });

  it("the fabric's own allow-list is what publishing is checked against", () => {
    // Belt and braces: even if this module widened its projection, the fabric
    // refuses keys outside PUBLIC_PROJECTION_KEYS.
    const fabric = readFileSync(resolve(process.cwd(), "api/runtime/economic-fabric.ts"), "utf8");
    expect(fabric).toContain("Public projection may only contain authorized keys");
  });
});

// ── Vocabulary ───────────────────────────────────────────────────────────────

describe("constraints speak the fabric's own closed vocabulary", () => {
  it("an unknown operator is refused", async () => {
    await expect(
      publish({ ...base, hardConstraints: [{ field: "q", operator: "DROP", value: 1 }] }),
    ).rejects.toThrow(/operator must be one of/);
  });

  it("a non-scalar constraint value is refused", async () => {
    await expect(
      publish({ ...base, hardConstraints: [{ field: "q", operator: "eq", value: { $ne: 1 } }] }),
    ).rejects.toThrow(/must be a scalar/);
  });

  it("a missing value is refused rather than defaulted", async () => {
    await expect(
      publish({ ...base, hardConstraints: [{ field: "q", operator: "gte" }] }),
    ).rejects.toThrow(/value is required/);
  });

  it("kind is NEED or OFFERING and nothing else", async () => {
    await expect(publish({ ...base, kind: "AUCTION" })).rejects.toThrow(/NEED or OFFERING/);
  });

  it("the required identity of an expression cannot be blank", async () => {
    await expect(publish({ ...base, semanticType: "   " })).rejects.toThrow(/semanticType/);
    await expect(publish({ ...base, summary: "" })).rejects.toThrow(/summary/);
  });

  it("everything is bounded", async () => {
    await expect(
      publish({
        ...base,
        hardConstraints: Array.from({ length: 40 }, () => ({
          field: "q",
          operator: "gte",
          value: 1,
        })),
      }),
    ).rejects.toThrow(/exceeds/);
    await expect(publish({ ...base, summary: "ء".repeat(500) })).rejects.toThrow(/exceeds/);
  });
});

// ── Registration ─────────────────────────────────────────────────────────────

describe("the exchange is registered as an ordinary capability", () => {
  // The registry itself is asserted BEHAVIOURALLY in
  // `tests/block31/opportunity-exchange-turn-path.test.ts`, which runs both
  // capabilities through the real executor. Importing the runtime registry
  // here would load the whole runtime into a unit test, which is why no unit
  // test in this repository does.
  const registry = readFileSync(
    resolve(process.cwd(), "api/runtime/capability-registry.ts"),
    "utf8",
  );

  it("publishing is INTERNAL_STATE and verified by a readback, not by its own word", () => {
    expect(registry).toContain('id: "opportunity-publish"');
    expect(registry).toContain('effectKind: "INTERNAL_STATE"');
    // Its own return value is worth EXECUTOR_RETURN, which INTERNAL_STATE does
    // not accept on its own. Only the readback verifies it.
    expect(registry).toContain("resolvePublishEffect");
  });

  it("a withdrawal is not pretended to be an undo", () => {
    const block = registry.slice(registry.indexOf('id: "opportunity-publish"'));
    expect(block.slice(0, block.indexOf("execute:"))).toContain("PARTIALLY_COMPENSATABLE");
  });

  it("discovery declares no effect to verify", () => {
    const block = registry.slice(registry.indexOf('id: "opportunity-discover"'));
    expect(block.slice(0, block.indexOf("execute:"))).toContain('effectKind: "NONE"');
  });

  it("no new semantic route was added for the market", async () => {
    // NEW MARKET CATEGORY != NEW MARKETPLACE, and the market is not a place
    // the runtime navigates to. It is two capabilities a plan can name.
    const router = readFileSync(
      resolve(process.cwd(), "api/runtime/semantic-router.ts"),
      "utf8",
    );
    const routes = router.slice(
      router.indexOf("export const SEMANTIC_ROUTES = ["),
      router.indexOf("] as const;"),
    );
    for (const forbidden of ["MARKET", "EXCHANGE", "OPPORTUNITY", "COMMERCE", "TRADE"]) {
      expect(routes, forbidden).not.toContain(forbidden);
    }
  });
});

// ── Generality ───────────────────────────────────────────────────────────────

describe("the door does not know what is being traded", () => {
  it("declares no domain identifier", () => {
    const declared = [...source.matchAll(/export (?:type|function|const|class) (\w+)/g)].map(
      (match) => match[1]!,
    );
    for (const name of declared) {
      for (const word of [
        "Wholesale", "Restaurant", "Job", "Factory", "Driver", "Grocery",
        "Laboratory", "Generator", "Storage", "Marketplace", "Product", "Sales",
      ]) {
        expect(name, `${name} contains ${word}`).not.toContain(word);
      }
    }
  });

  it("interprets no field name", () => {
    // `quantity`, `responseMinutes` and `degreesCelsius` are four identical
    // fields to this module. A branch on a field name would be the moment the
    // exchange acquired a domain.
    for (const field of [
      "quantity", "price", "unitPrice", "hours", "kilowatts", "tonnes",
      "salary", "rent", "weight", "volume",
    ]) {
      expect(source, field).not.toContain(`"${field}"`);
    }
  });

  it("registers three capabilities, not one per market", () => {
    // Two became three when matching was separated from discovery: discovery
    // lists and writes nothing, matching records findings. Sharing one
    // registration made a write look like a pure read, which is the one thing
    // a side-effect declaration may never do. The count is pinned so that a
    // FOURTH — a `PublishRestaurantOffering` — is a visible diff.
    const registrations = [...source.matchAll(/export async function execute(\w+)/g)].map(
      (match) => match[1]!,
    );
    expect(registrations.sort()).toEqual([
      "OpportunityDiscover",
      "OpportunityMatch",
      "OpportunityPublish",
    ]);
  });
});
