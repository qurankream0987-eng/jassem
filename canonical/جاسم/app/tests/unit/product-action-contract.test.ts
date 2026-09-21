/**
 * JASIM — the secure product action contract.
 *
 * The live proof is `tests/block31/secure-product-action.test.ts`. This file
 * holds what must be true without a database:
 *
 *   MODEL_DEFINED_SECRET_FIELDS = 0
 *   AUTHENTICATE != DAG NODE
 *   QUESTION != INTENT != CONFIRMATION != EXECUTION
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACTION_AVAILABILITY,
  ACTION_STATUSES,
  CONFIRMATION_POLICIES,
  FIELD_KINDS,
  PRODUCT_ACTION_AUTHORITY_KEYS,
  RISK_CLASSES,
  assertNoProductAuthorityClaim,
  getProductAction,
  listProductActions,
  presentationFor,
  sensitiveFieldsOf,
} from "../../api/runtime/product-actions";
import { AUTHORITY_KEYS } from "../../api/runtime/model-output-trust";

const source = readFileSync(resolve(process.cwd(), "api/runtime/product-actions.ts"), "utf8");
const runtime = readFileSync(resolve(process.cwd(), "api/runtime/jasim-runtime.ts"), "utf8");

/**
 * Comments removed.
 *
 * The module names `NotificationSettingsAgent` in a comment saying it must
 * never exist. A check that cannot tell the rule from the violation would
 * force the rule to be deleted in order to pass.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── One registry, no agents ──────────────────────────────────────────────────

describe("one trusted boundary for every product action there is", () => {
  it("exports no per-verb agent or handler", () => {
    const FORBIDDEN = ["Agent", "Notification", "Privacy", "Login", "Signup", "Password"];
    const declared = [...code.matchAll(/export (?:type|function|const|class) (\w+)/g)].map(
      (match) => match[1]!,
    );
    for (const name of declared) {
      for (const word of FORBIDDEN) {
        expect(name, `${name} contains ${word}`).not.toContain(word);
      }
    }
  });

  it("its vocabularies are closed", () => {
    expect([...ACTION_STATUSES]).toEqual([
      "INITIATED", "AWAITING_INPUT", "AWAITING_CONFIRMATION", "EXECUTED",
      "DENIED", "EXPIRED", "CANCELLED", "FAILED",
    ]);
    expect([...RISK_CLASSES]).toEqual(["LOW", "ELEVATED", "HIGH", "IRREVERSIBLE"]);
    expect([...FIELD_KINDS]).toEqual(["TEXT", "EMAIL", "CHOICE", "BOOLEAN", "SENSITIVE"]);
    expect([...CONFIRMATION_POLICIES]).toEqual(["NONE", "EXPLICIT", "EXPLICIT_PHRASE"]);
    expect([...ACTION_AVAILABILITY]).toEqual(["AVAILABLE", "BLOCKED_BY_PROVIDER"]);
  });

  it("every registered action declares its own consequence and idempotency", () => {
    for (const action of listProductActions()) {
      expect(action.consequence.length, action.id).toBeGreaterThan(20);
      expect(["SAFE_REPEAT", "SINGLE_USE"], action.id).toContain(action.idempotency);
      // Short-lived: an action session is a door left open.
      expect(action.ttlSeconds, action.id).toBeLessThanOrEqual(600);
    }
  });

  it("risk and confirmation move together", () => {
    for (const action of listProductActions()) {
      if (action.risk === "IRREVERSIBLE") {
        // A yes/no on something that cannot be undone is a click.
        expect(action.confirmation, action.id).toBe("EXPLICIT_PHRASE");
        expect(action.confirmationPhrase, action.id).toBeTruthy();
      }
      if (action.fields.some((field) => field.kind === "SENSITIVE")) {
        // Collecting a secret is never a low-risk act.
        expect(action.risk, action.id).not.toBe("LOW");
      }
    }
  });
});

// ── The model defines nothing ────────────────────────────────────────────────

describe("a model may name an action and nothing else", () => {
  it("the envelope schema carries only an actionId", () => {
    const schema = runtime.slice(runtime.indexOf("const ProductActionRequestSchema"));
    const body = schema.slice(0, schema.indexOf(";"));
    expect(body).toContain("actionId");
    expect(body).toContain(".strict()");
    for (const forbidden of ["fields", "sensitive", "values", "confirmation", "ownerId"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it.each([
    "ownerId", "actorId", "isAdmin", "role", "verified", "authorized",
    "reauthenticated", "sessionId", "refreshToken", "passwordHash",
    "policyDecision", "confirmed", "actionCompleted", "status",
  ])("refuses «%s» rather than ignoring it", (key) => {
    expect(() => assertNoProductAuthorityClaim({ [key]: true }, "a submission")).toThrow();
  });

  it("every product-action authority key is also refused in model output", () => {
    for (const key of PRODUCT_ACTION_AUTHORITY_KEYS) {
      expect(AUTHORITY_KEYS, key).toContain(key);
    }
  });

  it("the presentation is built from the registration, never from a payload", () => {
    const render = code.slice(code.indexOf("export function presentationFor"));
    const body = render.slice(0, render.indexOf("\n}\n"));
    expect(body).toContain("action.fields.map");
    // No value of any kind reaches a surface — not a default, not a hint.
    for (const forbidden of ["value", "default", "placeholder", "hint"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it("a sensitive field stays sensitive in the contract a surface renders", () => {
    const rotate = getProductAction("credential.rotate")!;
    expect(sensitiveFieldsOf(rotate)).toEqual(["currentSecret", "newSecret", "confirmSecret"]);
    const presentation = presentationFor(rotate);
    expect(presentation.fields.every((field) => field.kind === "SENSITIVE")).toBe(true);
  });
});

// ── AUTHENTICATE != DAG NODE ─────────────────────────────────────────────────

describe("an account action is not something a plan composes", () => {
  it("no capability performs a product action", () => {
    const registry = readFileSync(
      resolve(process.cwd(), "api/runtime/capability-registry.ts"),
      "utf8",
    );
    expect(registry).not.toContain("product-actions");
    expect(registry).not.toContain("initiateProductAction");
  });

  it("the runtime branch returns before anything executable", () => {
    // The product-action branch sits ahead of the dataset branch, the
    // authority branch and every path that could open a run.
    const branch = runtime.indexOf('"productAction" in envelope');
    const authority = runtime.indexOf('"authorityRequest" in envelope');
    expect(branch).toBeGreaterThan(0);
    // Ahead of the authority branch, which the previous phase already pinned
    // as preceding every path that can open a run.
    expect(branch).toBeLessThan(authority);
    // And it RETURNS. Nothing downstream of it runs for this turn.
    const body = runtime.slice(branch, authority);
    expect(body).toContain("return respondRouted(");
    expect(body).not.toContain("createRuntimeRun(");
    expect(body).not.toContain("createRuntimeDag(");
  });

  it("only the trusted transport and the runtime touch the boundary", () => {
    const callers = execSync("grep -rln 'product-actions' api || true", {
      cwd: process.cwd(),
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .sort();
    // The turn opens a door; the router submits into it; auth asks whether a
    // session was revoked; and the key set is mirrored. Nothing else.
    expect(callers).toEqual([
      "api/kimi/auth.ts",
      "api/routers/runtime.ts",
      "api/runtime/jasim-runtime.ts",
      "api/runtime/model-output-trust.ts",
    ]);
  });
});

// ── Secrets never come back ──────────────────────────────────────────────────

describe("a collected secret is used and dropped", () => {
  it("only the non-sensitive part is ever persisted", () => {
    const fn = code.slice(code.indexOf("function auditableRecord"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("sensitive.has(key)");
  });

  it("the submission returns an outcome and no echo", () => {
    const router = readFileSync(resolve(process.cwd(), "api/routers/runtime.ts"), "utf8");
    const procedure = router.slice(router.indexOf("productActionSubmit:"));
    const body = procedure.slice(0, procedure.indexOf("productActionCancel:"));
    const returned = body.slice(body.indexOf("return {"), body.indexOf("} catch"));
    expect(returned).toContain("status: outcome.status");
    // Nothing that was typed comes back out.
    expect(returned).not.toContain("values");
    expect(returned).not.toContain("record");
  });

  it("the audit payload is assembled from named fields", () => {
    const fn = code.slice(code.indexOf("async function audit("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("actionSessionId: input.session.id");
    // `db.insert(events).values({…})` is drizzle's own word; what matters is
    // that nothing a person typed is named here.
    const payload = body.slice(body.indexOf("payload: {"));
    for (const forbidden of ["secret", "password", "record", "submitted"]) {
      expect(payload, forbidden).not.toContain(forbidden);
    }
  });

  it("the session id is random rather than derived", () => {
    const fn = code.slice(code.indexOf("function newSessionId"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("randomBytes(32)");
    for (const forbidden of ["actor", "actionId", "hash", "sign"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });
});

// ── Revocation is real ───────────────────────────────────────────────────────

describe("logging out is not clearing a cookie", () => {
  it("both transports ask whether the session was revoked", () => {
    const auth = readFileSync(resolve(process.cwd(), "api/kimi/auth.ts"), "utf8");
    // Bearer and cookie. A mobile token that kept working after a logout was
    // the false success this closes.
    expect(auth.match(/assertNotRevoked\(claim\)/g)?.length).toBe(2);
  });

  it("a token with no issue time does not pass", () => {
    const fn = code.slice(code.indexOf("export async function sessionIsRevoked"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("if (input.issuedAt === undefined) return true;");
  });

  it("no second session system was built", () => {
    // The existing JWT is reused exactly as it was; only revocation is new.
    for (const forbidden of ["signSessionToken", "jose", "jwt", "cookie"]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
});
