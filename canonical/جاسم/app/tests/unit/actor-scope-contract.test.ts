/**
 * JASIM — the acting-scope contract.
 *
 * The live proof is `tests/block31/actor-scope-runtime.test.ts`. This file
 * holds what must be true of the contract without a database:
 *
 *   • a request may name a scope; it may never grant itself one
 *   • permissions are verbs, never industry roles
 *   • an organization has no TYPE in the core
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ActorScopeError,
  SCOPE_AUTHORITY_KEYS,
  SCOPE_PERMISSIONS,
  assertNoScopeAuthorityClaim,
  conversationScopeMemory,
  conversationScopeRequest,
  organizationScopeId,
} from "../../api/runtime/actor-scope";
import { AUTHORITY_KEYS } from "../../api/runtime/model-output-trust";

const source = readFileSync(resolve(process.cwd(), "api/runtime/actor-scope.ts"), "utf8");

/**
 * Comments removed.
 *
 * The module names `FactoryManager` in a comment saying it must never exist. A
 * check that cannot tell the rule from the violation would force the rule to be
 * deleted to pass, which is exactly backwards.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const schema = readFileSync(resolve(process.cwd(), "db/schema-block2.ts"), "utf8");

// ── Authority ────────────────────────────────────────────────────────────────

describe("a request may name a scope, never grant one", () => {
  it.each([
    "principalId", "actingScopeId", "scopeId", "organizationId", "businessId",
    "membershipId", "ownerId", "role", "permissions", "authority", "isMember",
  ])("%s is refused outright", (key) => {
    expect(() => assertNoScopeAuthorityClaim({ [key]: "x" }, "request")).toThrow(ActorScopeError);
  });

  it("refuses rather than strips", () => {
    // A trimmed claim looks like an ordinary request, and the one that
    // mattered would be the one nobody saw.
    try {
      assertNoScopeAuthorityClaim({ organizationId: "org_1" }, "request");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("SCOPE_AUTHORITY_REJECTED");
    }
  });

  it("the model output guard refuses the same names", () => {
    // One door closed and the other open is one open door.
    for (const key of ["actingscopeid", "organizationid", "businessid", "membershipid", "principalid"]) {
      expect(AUTHORITY_KEYS.has(key), key).toBe(true);
    }
  });

  it("every scope authority key is lowercase, so the check cannot be evaded by case", () => {
    for (const key of SCOPE_AUTHORITY_KEYS) {
      expect(key).toBe(key.toLowerCase());
    }
    expect(() => assertNoScopeAuthorityClaim({ OrGaNiZaTiOnId: 1 }, "x")).toThrow();
  });
});

// ── Permissions ──────────────────────────────────────────────────────────────

describe("permissions are verbs, not job titles", () => {
  it("is a closed generic set", () => {
    expect([...SCOPE_PERMISSIONS].sort()).toEqual([
      "act_financially", "approve", "manage_members", "manage_policies",
      "manage_providers", "mutate", "publish", "view",
    ]);
  });

  it("contains no industry role", () => {
    for (const permission of SCOPE_PERMISSIONS) {
      for (const role of ["Manager", "Owner", "Buyer", "Chef", "Driver", "Doctor", "Teacher"]) {
        expect(permission.toLowerCase(), permission).not.toContain(role.toLowerCase());
      }
    }
  });

  it("no domain role is defined anywhere in the module", () => {
    for (const role of [
      "FactoryManager", "RestaurantOwner", "HotelBuyer", "SchoolAdmin",
      "ClinicManager", "ShopOwner",
    ]) {
      expect(code, role).not.toContain(role);
    }
  });
});

// ── An organization has no type ──────────────────────────────────────────────

describe("an organization is a scope, not a kind of business", () => {
  it("the table has no business-type column", () => {
    const block = schema.slice(
      schema.indexOf('export const organizations = pgTable('),
      schema.indexOf("export const scopePolicies"),
    );
    for (const forbidden of ["businessType", "industry", "category", "sector", "vertical"]) {
      expect(block, forbidden).not.toContain(forbidden);
    }
    // What it IS lives in free-form attributes, as data.
    expect(block).toContain("attributes");
  });

  it("no industry noun is declared in the scope runtime", () => {
    const declared = [...source.matchAll(/export (?:type|function|const|class) (\w+)/g)].map(
      (match) => match[1]!,
    );
    for (const name of declared) {
      for (const word of [
        "Factory", "Restaurant", "Hotel", "School", "Clinic", "Shop",
        "Logistics", "Consultancy", "Business",
      ]) {
        expect(name, `${name} contains ${word}`).not.toContain(word);
      }
    }
  });

  it("the scope id of an organization is its id, with nothing encoded in it", () => {
    // A scope id that encoded a type would be a type in the core wearing a
    // string's clothes.
    expect(organizationScopeId("org_abc")).toBe("org_abc");
  });

  it("policy storage is generic: a key and a value", () => {
    const block = schema.slice(
      schema.indexOf("export const scopePolicies = pgTable("),
      schema.indexOf("export const scopeProviderBindings"),
    );
    for (const forbidden of ["price", "vendor", "credit", "delivery", "menu", "stock"]) {
      expect(block.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    expect(block).toContain("policyKey");
    expect(block).toContain("version");
  });

  it("a provider binding records a credential NAME, never a secret", () => {
    expect(source).toContain("credentialEnvName");
    expect(source).toMatch(/NAME.*secret|secret.*environment/is);
    for (const forbidden of ["apiKey", "secretValue", "token:", "password"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

// ── The distinction itself ───────────────────────────────────────────────────

describe("principal and acting scope stay separate", () => {
  it("the module states the distinction it exists for", () => {
    expect(source).toContain("AUTHENTICATED PRINCIPAL");
    expect(source).toContain("ACTING SCOPE");
  });

  it("no request path can produce a scope without consulting membership", () => {
    // Every ORGANIZATION branch of the resolver reads `listActingScopes`
    // first, which is a membership query. A branch that returned a scope
    // without one would be authority invented from a sentence.
    const resolver = source.slice(
      source.indexOf("export async function resolveActingScope("),
      source.indexOf("// ─────────────────────────────────────────────────────────────────────────────\n// Scope-owned policy"),
    );
    expect(resolver).toContain("await listActingScopes(principalId)");
    const organizationBranch = resolver.slice(resolver.indexOf("const available"));
    expect(organizationBranch).toContain("available.organizations");
  });

  it("reading a scope's policy requires permission, not merely the scope id", () => {
    const reader = source.slice(
      source.indexOf("export async function getScopePolicy("),
      source.indexOf("export async function scopePolicyHistory("),
    );
    expect(reader).toContain("authorizeScopeAction");
  });
});

// ── Continuity ───────────────────────────────────────────────────────────────

/**
 *   ESTABLISHED SCOPE != STANDING AUTHORITY
 *
 * What a conversation carries forward is the kind of thing a model is allowed
 * to say. Everything that decides whether it may be acted on happens again.
 */
describe("a conversation carries a request, never a permission", () => {
  it("carries an exact organization reference and nothing else", () => {
    expect(conversationScopeRequest({ actingScope: { organizationId: "org:7" } })).toEqual({
      intent: "ORGANIZATION",
      organizationId: "org:7",
    });
  });

  it("carries no hint — stale words must not re-match a changed membership list", () => {
    const carried = conversationScopeRequest({
      actingScope: { organizationId: "org:7", organizationHint: "شركة النور" },
    });
    expect(carried).toEqual({ intent: "ORGANIZATION", organizationId: "org:7" });
    expect(carried).not.toHaveProperty("organizationHint");
  });

  it("carries nothing it cannot read", () => {
    for (const metadata of [
      undefined, null, {}, "actingScope", 7,
      { actingScope: null },
      { actingScope: {} },
      { actingScope: { organizationId: "" } },
      { actingScope: { organizationId: "   " } },
      { actingScope: { organizationId: 7 } },
      { actingScope: "org:7" },
    ]) {
      expect(conversationScopeRequest(metadata), JSON.stringify(metadata)).toBeUndefined();
    }
  });

  it("refuses to carry an authority claim written beside it", () => {
    // A stored blob that also said `granted` or `role` would be a permission
    // travelling between turns. Only the reference is ever read.
    const carried = conversationScopeRequest({
      actingScope: { organizationId: "org:7", granted: true, role: "owner", permissions: ["approve"] },
    });
    expect(carried).toEqual({ intent: "ORGANIZATION", organizationId: "org:7" });
  });

  it("remembers only an organization that actually resolved", () => {
    expect(
      conversationScopeMemory({
        status: "RESOLVED",
        scope: {
          kind: "ORGANIZATION",
          scopeId: "org:7",
          principalId: "9801",
          organizationId: "org:7",
          displayName: "شركة النور",
        },
      }),
    ).toEqual({ organizationId: "org:7" });
  });

  it("forgets on personal, denied and ambiguous alike", () => {
    expect(
      conversationScopeMemory({
        status: "RESOLVED",
        scope: { kind: "PERSONAL", scopeId: "9801", principalId: "9801" },
      }),
    ).toBeNull();
    expect(
      conversationScopeMemory({ status: "DENIED", reason: "NOT_A_MEMBER", message: "لا" }),
    ).toBeNull();
    expect(
      conversationScopeMemory({
        status: "NEEDS_INPUT",
        reason: "AMBIGUOUS_ORGANIZATION",
        message: "أي واحدة؟",
        candidates: [],
      }),
    ).toBeNull();
  });

  it("the stored key holds a reference and no permission vocabulary", () => {
    // Read from the module, so a future field cannot be added quietly.
    const memory = code.slice(code.indexOf("export function conversationScopeMemory"));
    for (const word of ["permission", "role", "granted", "authority"]) {
      expect(memory.slice(0, 400).toLowerCase(), word).not.toContain(word);
    }
  });
});

// ── The UI is not authority ──────────────────────────────────────────────────

/**
 * §16. A client may let someone CHOOSE a scope. It may never decide that they
 * hold it. Every screen JASIM has ever shipped was rendered from something the
 * server decided, and this is what keeps that true for scope.
 */
describe("no scope decision lives in the client", () => {
  const clientFiles = execSync("find src -type f \\( -name '*.ts' -o -name '*.tsx' \\)", {
    cwd: process.cwd(),
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  it("no client file imports the acting-scope module", () => {
    for (const file of clientFiles) {
      const body = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(body, file).not.toContain("actor-scope");
    }
  });

  it("no client file decides a permission", () => {
    // The verbs may be DISPLAYED. They may not be compared against in order to
    // allow something: an `if (permissions.includes("approve"))` in a browser
    // is an authorization a person can edit.
    for (const file of clientFiles) {
      const body = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const verb of ["manage_members", "manage_policies", "manage_providers", "act_financially"]) {
        expect(body, `${file}: ${verb}`).not.toContain(verb);
      }
      expect(body, file).not.toContain("authorizeScopeAction");
    }
  });
});
