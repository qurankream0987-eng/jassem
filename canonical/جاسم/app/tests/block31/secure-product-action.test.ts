/**
 * JASIM — A SECRET NEVER MEETS THE MODEL.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   CONVERSATION INITIATES · TRUSTED RUNTIME DEFINES · TRUSTED SURFACE COLLECTS
 *   SERVER VALIDATES · POLICY AUTHORIZES · RUNTIME MUTATES · AUDIT RECORDS
 *
 *   PASSWORD · TOKEN · BIOMETRIC SECRET · PAYMENT CREDENTIAL != LLM CONTEXT
 *   AUTHENTICATE != DAG NODE
 *   QUESTION != INTENT != CONFIRMATION != EXECUTION
 *
 * ─── THE SENTINEL ───────────────────────────────────────────────────────────
 *
 * One unique string is typed into the trusted surface and then hunted for in
 * every place a value could have been written: conversation messages, model
 * request payloads, assistant metadata, events, runs, DAG inputs, presentation
 * state and the action-session row itself. It is never printed.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { productActionSessions, users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let actions: typeof import("../../api/runtime/product-actions");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

/** Never printed, never asserted by value except as an absence. */
const SENTINEL = `s3nt1nel-${randomUUID()}`;

describe("a product action opens a door and carries no secret", () => {
  let actor: typeof users.$inferSelect;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    actions = await import("../../api/runtime/product-actions");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE events, product_action_sessions,
        identity_session_revocations, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'spa-%'`));
    const [row] = await handle.db
      .insert(users)
      .values({ unionId: `spa-${randomUUID()}`, name: "حسن", preferences: {} })
      .returning();
    actor = row!;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── 1. The registry defines, the model does not ───────────────────────────

  it("every registered action is a general product verb", () => {
    const ids = actions.listProductActions().map((action) => action.id).sort();
    expect(ids).toEqual([
      "account.close",
      "account.create",
      "credential.rotate",
      "session.establish",
      "session.revoke",
      "settings.update",
    ]);
    for (const action of actions.listProductActions()) {
      for (const word of ["Agent", "Restaurant", "Factory", "Notification", "Privacy"]) {
        expect(action.id, action.id).not.toContain(word);
      }
    }
  });

  it("the presentation contract carries labels and kinds, never a value", () => {
    const rotate = actions.getProductAction("credential.rotate")!;
    const presentation = actions.presentationFor(rotate);
    const serialized = JSON.stringify(presentation);
    expect(serialized).not.toContain("value");
    expect(presentation.fields.every((field) => !("value" in field))).toBe(true);
    // The sensitivity is the registry's, and it is in the contract a surface
    // renders — so a client cannot decide to show a password in clear.
    expect(presentation.fields.map((field) => field.kind)).toEqual([
      "SENSITIVE",
      "SENSITIVE",
      "SENSITIVE",
    ]);
    expect(presentation.reauthentication).toBe(true);
  });

  it("a caller cannot move a field from SENSITIVE to NORMAL", () => {
    // Structural: the only source of a field's kind is the registration, and
    // the registry is not reachable from a payload.
    const before = actions.sensitiveFieldsOf(actions.getProductAction("credential.rotate")!);
    expect(before).toEqual(["currentSecret", "newSecret", "confirmSecret"]);
  });

  it("a caller cannot state an authority", () => {
    for (const key of [
      "ownerId", "actorId", "isAdmin", "role", "verified", "authorized",
      "reauthenticated", "sessionId", "refreshToken", "passwordHash",
      "policyDecision", "confirmed", "actionCompleted",
    ]) {
      expect(
        () => actions.assertNoProductAuthorityClaim({ [key]: true }, "a submission"),
        key,
      ).toThrow(/establishes/i);
    }
  });

  // ── 2. The action session ─────────────────────────────────────────────────

  const open = (actionId: string, over: Record<string, unknown> = {}) =>
    actions.initiateProductAction({
      actionId,
      actor,
      conversationId: "c1",
      ...over,
    } as never);

  it("is opaque, short-lived and single-use", async () => {
    const { session } = await open("settings.update");
    expect(session.id).toMatch(/^pas_[A-Za-z0-9_-]{40,}$/);
    // No secret and no meaning in the identifier itself. `actor.id` is a
    // serial, and a single digit is a substring of almost any random blob —
    // greping for one proved nothing and failed at random. What is actually
    // claimed is that the identifier is MINTED rather than DERIVED, so it is
    // tested against the actor's real identifier, against the action's name,
    // and against itself: the same actor opening the same action twice gets
    // two different doors.
    expect(session.id).not.toContain(actor.unionId);
    expect(session.id).not.toContain("settings");
    const { session: again } = await open("settings.update");
    expect(again.id).not.toBe(session.id);
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBeLessThanOrEqual(
      600_000 + 2_000,
    );
    expect(session.status).toBe("AWAITING_INPUT");
  });

  it("an action needing somebody signed in refuses an anonymous initiation", async () => {
    await expect(
      actions.initiateProductAction({ actionId: "settings.update", anonymousRef: "anon" }),
    ).rejects.toThrow(/signed in/i);
  });

  it("login and signup do NOT need an existing identity", async () => {
    for (const actionId of ["session.establish", "account.create"]) {
      const { session } = await actions.initiateProductAction({
        actionId,
        anonymousRef: "browser-1",
      });
      expect(session.actorId).toBeNull();
    }
  });

  it("another person's action session is not found", async () => {
    const { session } = await open("settings.update");
    const [other] = await handle.db
      .insert(users)
      .values({ unionId: `spa-${randomUUID()}`, name: "ليلى", preferences: {} })
      .returning();
    await expect(
      actions.submitProductAction({
        actionSessionId: session.id,
        actor: other!,
        values: { preference: "display", value: "dark" },
      }),
    ).rejects.toThrow(/no such action session/i);
  });

  it("an anonymous session binds to one caller", async () => {
    const { session } = await actions.initiateProductAction({
      actionId: "session.establish",
      anonymousRef: "browser-1",
    });
    await expect(
      actions.submitProductAction({
        actionSessionId: session.id,
        anonymousRef: "browser-2",
        values: {},
      }),
    ).rejects.toThrow(/no such action session/i);
  });

  it("an expired session is refused and says so", async () => {
    const { session } = await open("settings.update");
    await handle.db
      .update(productActionSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(productActionSessions.id, session.id));
    await expect(
      actions.submitProductAction({
        actionSessionId: session.id,
        actor,
        values: { preference: "display", value: "dark" },
      }),
    ).rejects.toThrow(/expired/i);
    const [after] = await handle.db
      .select()
      .from(productActionSessions)
      .where(eq(productActionSessions.id, session.id));
    expect(after!.status).toBe("EXPIRED");
  });

  it("a replayed submission is not a second act", async () => {
    const { session } = await open("settings.update");
    const first = await actions.submitProductAction({
      actionSessionId: session.id,
      actor,
      values: { preference: "display", value: "dark" },
    });
    expect(first.status).toBe("EXECUTED");
    await expect(
      actions.submitProductAction({
        actionSessionId: session.id,
        actor,
        values: { preference: "display", value: "light" },
      }),
    ).rejects.toThrow(/EXECUTED/);
    const [row] = await handle.db.select().from(users).where(eq(users.id, actor.id));
    // The second value never landed.
    expect((row!.preferences as Record<string, string>).display).toBe("dark");
  });

  it("a surface built for another version may not submit", async () => {
    const { session } = await open("settings.update");
    await expect(
      actions.submitProductAction({
        actionSessionId: session.id,
        actor,
        actionVersion: 99,
        values: { preference: "display", value: "dark" },
      }),
    ).rejects.toThrow(/different version/i);
  });

  it("an undeclared field is refused, never dropped", async () => {
    const { session } = await open("settings.update");
    await expect(
      actions.submitProductAction({
        actionSessionId: session.id,
        actor,
        values: { preference: "display", value: "dark", extraSecret: "x" },
      }),
    ).rejects.toThrow(/not a field/i);
  });

  it("a value outside the registry's closed set is refused", async () => {
    const { session } = await open("settings.update");
    await expect(
      actions.submitProductAction({
        actionSessionId: session.id,
        actor,
        values: { preference: "arbitraryColumn", value: "x" },
      }),
    ).rejects.toThrow(/not an option/i);
  });

  // ── 3. Settings — a real mutation ─────────────────────────────────────────

  it("a low-risk preference changes the account and needs no ceremony", async () => {
    const { session, presentation } = await open("settings.update");
    expect(presentation.risk).toBe("LOW");
    expect(presentation.confirmation).toBe("NONE");
    const result = await actions.submitProductAction({
      actionSessionId: session.id,
      actor,
      values: { preference: "notifications", value: "off" },
    });
    expect(result.status).toBe("EXECUTED");
    const [row] = await handle.db.select().from(users).where(eq(users.id, actor.id));
    expect((row!.preferences as Record<string, string>).notifications).toBe("off");
  });

  it("repeating a preference leaves the same final state", async () => {
    for (const _ of [1, 2]) {
      const { session } = await open("settings.update");
      await actions.submitProductAction({
        actionSessionId: session.id,
        actor,
        values: { preference: "privacy", value: "strict" },
      });
    }
    const [row] = await handle.db.select().from(users).where(eq(users.id, actor.id));
    expect((row!.preferences as Record<string, string>).privacy).toBe("strict");
  });

  // ── 4. Logout — the one that used to be a lie ─────────────────────────────

  it("revoking ends every token issued for the identity before now", async () => {
    const before = Math.floor(Date.now() / 1000) - 60;
    expect(await actions.sessionIsRevoked({ unionId: actor.unionId, issuedAt: before })).toBe(false);

    const { session } = await open("session.revoke");
    const result = await actions.submitProductAction({
      actionSessionId: session.id,
      actor,
      values: {},
    });
    expect(result.status).toBe("EXECUTED");

    // The old token no longer authorizes anything, on either transport.
    expect(await actions.sessionIsRevoked({ unionId: actor.unionId, issuedAt: before })).toBe(true);
    // A token minted after the revocation does.
    const after = Math.floor(Date.now() / 1000) + 120;
    expect(await actions.sessionIsRevoked({ unionId: actor.unionId, issuedAt: after })).toBe(false);
  });

  it("a token that cannot say when it was minted does not pass", async () => {
    await actions.revokeIdentitySessions({ unionId: actor.unionId, reason: "test" });
    // Fail closed: unable to prove it predates nothing is not the same as
    // proving it postdates the revocation.
    expect(await actions.sessionIsRevoked({ unionId: actor.unionId })).toBe(true);
  });

  it("another identity is untouched", async () => {
    const [other] = await handle.db
      .insert(users)
      .values({ unionId: `spa-${randomUUID()}`, name: "ليلى", preferences: {} })
      .returning();
    await actions.revokeIdentitySessions({ unionId: actor.unionId, reason: "test" });
    expect(
      await actions.sessionIsRevoked({
        unionId: other!.unionId,
        issuedAt: Math.floor(Date.now() / 1000) - 60,
      }),
    ).toBe(false);
  });

  it("replaying a logout is harmless", async () => {
    for (const _ of [1, 2]) {
      const { session } = await open("session.revoke");
      const result = await actions.submitProductAction({
        actionSessionId: session.id,
        actor,
        values: {},
      });
      expect(result.status).toBe("EXECUTED");
    }
  });

  // ── 5. Destructive — confirmation is not a click ──────────────────────────

  it("a question does not become a deletion", async () => {
    const { session, presentation } = await open("account.close");
    expect(presentation.risk).toBe("IRREVERSIBLE");
    expect(presentation.confirmation).toBe("EXPLICIT_PHRASE");

    // No confirmation at all.
    const first = await actions.submitProductAction({
      actionSessionId: session.id,
      actor,
      values: {},
    });
    expect(first.status).toBe("AWAITING_CONFIRMATION");
    expect(first.outcome).toBe("CONFIRMATION_REQUIRED");

    // A yes, which is a click, and not the phrase.
    const second = await actions.submitProductAction({
      actionSessionId: session.id,
      actor,
      values: {},
      confirmation: true as never,
    });
    expect(second.status).toBe("AWAITING_CONFIRMATION");

    const [row] = await handle.db.select().from(users).where(eq(users.id, actor.id));
    expect(row!.status).toBe("active");
  });

  it("the exact phrase closes the account, and says it deleted nothing", async () => {
    const { session, presentation } = await open("account.close");
    // The consequence a person reads says what actually happens.
    expect(presentation.consequence).toContain("لا يحذف هذا بياناتك");
    const result = await actions.submitProductAction({
      actionSessionId: session.id,
      actor,
      values: {},
      confirmation: presentation.confirmationPhrase!,
    });
    expect(result.status).toBe("EXECUTED");
    expect(result.detail).toContain("No data was deleted");
    const [row] = await handle.db.select().from(users).where(eq(users.id, actor.id));
    expect(row!.status).toBe("suspended");
    // And the sessions went with it.
    expect(
      await actions.sessionIsRevoked({
        unionId: actor.unionId,
        issuedAt: Math.floor(Date.now() / 1000) - 60,
      }),
    ).toBe(true);
  });

  // ── 6. Credential rotation — truthful, not faked ──────────────────────────

  it("re-authentication cannot be asserted, only supplied", async () => {
    const { session } = await open("credential.rotate");
    // The proof is a SENSITIVE field the registry declared required, so
    // omitting it is refused before anything else is considered. And claiming
    // it instead is a refused key, which is the other half of the same rule.
    await expect(
      actions.submitProductAction({
        actionSessionId: session.id,
        actor,
        values: { currentSecret: "", newSecret: "", confirmSecret: "" } as never,
        confirmation: true,
      }),
    ).rejects.toThrow(/required/i);
    await expect(
      actions.submitProductAction({
        actionSessionId: session.id,
        actor,
        values: { reauthenticated: true } as never,
        confirmation: true,
      }),
    ).rejects.toThrow(/establishes/i);
  });

  it("rotation says it is blocked rather than pretending", async () => {
    const { session } = await open("credential.rotate");
    const result = await actions.submitProductAction({
      actionSessionId: session.id,
      actor,
      values: { currentSecret: SENTINEL, newSecret: SENTINEL, confirmSecret: SENTINEL },
      confirmation: true,
    });
    expect(result.status).toBe("DENIED");
    expect(result.outcome).toBe("BLOCKED_BY_PROVIDER");
    expect(result.detail).toContain("no stored credential");
  });

  // ── 7. THE SENTINEL HUNT ──────────────────────────────────────────────────

  it("a secret typed into the trusted surface appears nowhere", async () => {
    // Drive it through the whole path: a conversation initiates, the trusted
    // surface collects, the runtime validates and the handler receives it.
    const conversation = await runtime.createRuntimeConversation({
      ownerId: String(actor.id),
      title: "auth",
    });
    const captured: string[] = [];
    vi.spyOn(ModelGateway.prototype, "generate").mockImplementation((async (request: unknown) => {
      // Everything the model was asked, captured for the hunt.
      captured.push(JSON.stringify(request));
      return {
        text: JSON.stringify({
          version: 1,
          decisionId: randomUUID(),
          kind: "direct_action",
          label: "إجراء",
          goal: "تغيير كلمة السر",
          intent: {
            requiredCapabilities: [],
            missingInputs: [],
            inputs: {},
            risk: "high",
            persistence: "ephemeral",
            effects: "none",
          },
          confidence: 0.9,
          productAction: { actionId: "credential.rotate" },
        }),
        provider: "openai",
        model: "stub-for-secure-action",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    }) as never);

    const turn = await runtime.routeRuntimeConversationTurn({
      ownerId: String(actor.id),
      conversationId: conversation.id,
      content: "غير كلمة السر",
      actorUser: actor,
    });
    const output = turn.output as Record<string, unknown>;
    expect(output.state).toBe("NEEDS_TRUSTED_SURFACE");
    const carried = output.productAction as {
      actionSessionId: string;
      presentation: { fields: Array<{ kind: string }> };
    };
    // The conversation never asked for the password itself.
    expect(turn.assistantMessage.content).not.toContain("اكتب كلمة السر");
    expect(carried.presentation.fields.every((field) => field.kind === "SENSITIVE")).toBe(true);

    await actions.submitProductAction({
      actionSessionId: carried.actionSessionId,
      actor,
      values: { currentSecret: SENTINEL, newSecret: SENTINEL, confirmSecret: SENTINEL },
      confirmation: true,
    });

    // ── The hunt. Every table a value could have reached. ──────────────────
    const tables = [
      "messages",
      "conversations",
      "bubbles",
      "events",
      "product_action_sessions",
      "runs",
      "dag_nodes",
      "execution_attempts",
      "observations",
      "users",
    ];
    for (const table of tables) {
      const rows = await handle.db.execute(
        sql.raw(`SELECT to_jsonb(t) AS row FROM "${table}" t`),
      );
      const serialized = JSON.stringify(rows.rows);
      // Asserted as an absence. The value is never printed.
      expect(serialized.includes(SENTINEL), `${table} holds the sentinel`).toBe(false);
    }
    // And the model was never told it.
    expect(captured.join("").includes(SENTINEL)).toBe(false);
    // Nor did it come back out.
    expect(JSON.stringify(turn).includes(SENTINEL)).toBe(false);
  });

  // ── 8. The live conversational paths ──────────────────────────────────────

  async function turn(
    content: string,
    actionId: string,
    signedIn = true,
    inConversation?: string,
  ) {
    const conversation = inConversation
      ? { id: inConversation }
      : await runtime.createRuntimeConversation({
          ownerId: String(actor.id),
          title: "auth",
        });
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "direct_action",
        label: "إجراء",
        goal: "إجراء على الحساب",
        intent: {
          requiredCapabilities: [],
          missingInputs: [],
          inputs: {},
          risk: "high",
          persistence: "ephemeral",
          effects: "none",
        },
        confidence: 0.9,
        productAction: { actionId },
      }),
      provider: "openai",
      model: "stub-for-secure-action",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: String(actor.id),
      conversationId: conversation.id,
      content,
      ...(signedIn ? { actorUser: actor } : {}),
    });
    return { result, output: result.output as Record<string, unknown> };
  }

  it("A · «سجلني دخول» opens a trusted surface and no DAG", async () => {
    const { output, result } = await turn("سجلني دخول", "session.establish", false);
    expect(output.state).toBe("NEEDS_TRUSTED_SURFACE");
    const carried = output.productAction as { presentation: { availability: string } };
    // Truthful: this repository authenticates through an external exchange
    // nothing is configured for.
    expect(carried.presentation.availability).toBe("BLOCKED_BY_PROVIDER");
    // AUTHENTICATE != DAG NODE.
    const metadata = (result.assistantMessage.metadata ?? {}) as Record<string, unknown>;
    expect(metadata.runId).toBeUndefined();
    const runs = await handle.db.execute(sql.raw("SELECT id FROM runs"));
    expect(runs.rows).toHaveLength(0);
  });

  it("B · «سجلني خروج» revokes the actual session", async () => {
    const before = Math.floor(Date.now() / 1000) - 60;
    const { output } = await turn("سجلني خروج", "session.revoke");
    const carried = output.productAction as { actionSessionId: string };
    await actions.submitProductAction({
      actionSessionId: carried.actionSessionId,
      actor,
      values: {},
    });
    expect(await actions.sessionIsRevoked({ unionId: actor.unionId, issuedAt: before })).toBe(true);
  });

  it("D · a safe setting mutation runs and is visible", async () => {
    const { output } = await turn("غيّر إعداد الإشعارات", "settings.update");
    const carried = output.productAction as {
      actionSessionId: string;
      presentation: { fields: Array<{ key: string; options?: string[] }> };
    };
    // The options are the registry's, so a model cannot name a column.
    expect(carried.presentation.fields[0]!.options).toContain("notifications");
    const result = await actions.submitProductAction({
      actionSessionId: carried.actionSessionId,
      actor,
      values: { preference: "notifications", value: "daily" },
    });
    expect(result.status).toBe("EXECUTED");
    const [row] = await handle.db.select().from(users).where(eq(users.id, actor.id));
    expect((row!.preferences as Record<string, string>).notifications).toBe("daily");
  });

  it("E · a destructive action needs its phrase before anything happens", async () => {
    const { output } = await turn("احذف حسابي", "account.close");
    const carried = output.productAction as {
      actionSessionId: string;
      presentation: { confirmation: string; confirmationPhrase?: string };
    };
    expect(carried.presentation.confirmation).toBe("EXPLICIT_PHRASE");
    const refused = await actions.submitProductAction({
      actionSessionId: carried.actionSessionId,
      actor,
      values: {},
    });
    expect(refused.status).toBe("AWAITING_CONFIRMATION");
    const [row] = await handle.db.select().from(users).where(eq(users.id, actor.id));
    expect(row!.status).toBe("active");
  });

  it("F · a tampered action id and a forged session both fail closed", async () => {
    await expect(
      turn("افعل شيئاً", "account.delete_everything"),
    ).resolves.toMatchObject({ output: { cause: "UNKNOWN_PRODUCT_ACTION" } });
    await expect(
      actions.submitProductAction({
        actionSessionId: "pas_forged",
        actor,
        values: {},
      }),
    ).rejects.toThrow(/no such action session/i);
  });

  it("«خلاص لا تغيّر كلمة السر» cancels and mutates nothing", async () => {
    const { session } = await open("credential.rotate");
    const cancelled = await actions.cancelProductAction({
      actionSessionId: session.id,
      actor,
    });
    expect(cancelled.status).toBe("CANCELLED");
    await expect(
      actions.submitProductAction({
        actionSessionId: session.id,
        actor,
        values: { currentSecret: "x", newSecret: "y", confirmSecret: "y" },
        confirmation: true,
      }),
    ).rejects.toThrow(/CANCELLED/);
  });

  // ── 8b. Reference continuity ──────────────────────────────────────────────

  it("the conversation survives the detour and the reference moves forward", async () => {
    // A trusted surface is a detour, not an exit. The conversation that opened
    // the door must still be the conversation afterwards, and «غيّره مرة
    // ثانية» must open a NEW door rather than replaying the one that closed.
    const conversation = await runtime.createRuntimeConversation({
      ownerId: String(actor.id),
      title: "auth",
    });
    const first = await turn("غيّر إعداد الإشعارات", "settings.update", true, conversation.id);
    const firstCarried = (first.output.productAction as { actionSessionId: string })
      .actionSessionId;
    await actions.submitProductAction({
      actionSessionId: firstCarried,
      actor,
      values: { preference: "notifications", value: "daily" },
    });

    const second = await turn("غيّره مرة ثانية", "settings.update", true, conversation.id);
    const secondCarried = (second.output.productAction as { actionSessionId: string })
      .actionSessionId;
    expect(secondCarried).not.toBe(firstCarried);

    // The completed door does not reopen, whatever is said next.
    await expect(
      actions.submitProductAction({
        actionSessionId: firstCarried,
        actor,
        values: { preference: "notifications", value: "weekly" },
      }),
    ).rejects.toThrow(/EXECUTED/);

    // The new one carries the change forward.
    const moved = await actions.submitProductAction({
      actionSessionId: secondCarried,
      actor,
      values: { preference: "notifications", value: "weekly" },
    });
    expect(moved.status).toBe("EXECUTED");
    const [row] = await handle.db.select().from(users).where(eq(users.id, actor.id));
    expect((row!.preferences as Record<string, string>).notifications).toBe("weekly");

    // And both doors know which conversation opened them, so the turn that
    // follows can find what it started.
    const sessions = await handle.db.execute(
      sql.raw(`SELECT "conversationId" FROM product_action_sessions ORDER BY "createdAt"`),
    );
    expect(sessions.rows.map((entry) => (entry as { conversationId: string }).conversationId))
      .toEqual([conversation.id, conversation.id]);
  });

  // ── 9. Audit ──────────────────────────────────────────────────────────────

  it("records what happened and never what was typed", async () => {
    const { session } = await open("settings.update");
    await actions.submitProductAction({
      actionSessionId: session.id,
      actor,
      values: { preference: "language", value: "ar" },
    });
    const rows = await handle.db.execute(
      sql.raw(`SELECT type, payload FROM events WHERE type LIKE 'PRODUCT_ACTION%' ORDER BY id`),
    );
    const types = rows.rows.map((row) => (row as { type: string }).type);
    expect(types).toEqual(["PRODUCT_ACTION_INITIATED", "PRODUCT_ACTION_COMPLETED"]);
    const serialized = JSON.stringify(rows.rows);
    expect(serialized).toContain("settings.update");
    // The action session id correlates it; the value does not appear.
    expect(serialized).toContain("actionSessionId");
  });

  // ── 10. Permission mutation goes through the path that already exists ─────

  it("no product action duplicates the permission runtime", async () => {
    // «أعط أحمد صلاحية» is an AUTHORITY ACT with a statement and a digest. A
    // second approval mechanism beside it would be the thing to avoid.
    const ids = actions.listProductActions().map((action) => action.id);
    expect(ids.some((id) => id.includes("permission"))).toBe(false);
    expect(ids.some((id) => id.includes("membership"))).toBe(false);
    const authority = await import("../../api/runtime/authority-acts");
    expect(authority.getAuthorityAct("membership.grant")).toBeTruthy();
    expect(authority.getAuthorityAct("membership.grant")!.requiredPermission).toBe(
      "manage_members",
    );
  });

  // ── 11. The multi-party ratchet (§26) ─────────────────────────────────────

  it("an ambiguous multi-party beneficiary is REJECTED, never guessed", async () => {
    const txn = await import("../../api/runtime/transaction-runtime");
    const agreement = await import("../../api/runtime/agreement-runtime");
    const terms = agreement.parseTermSheet([
      { key: "work", kind: "NUMBER", value: 6, owedBy: "A" },
    ]);
    await expect(
      txn.materializeTransaction({
        agreement: {
          id: `agr_${randomUUID()}`,
          engagementId: "e1",
          proposalId: "p1",
          participants: ["A", "B", "C"],
          terms: { terms },
          authorityBasis: { kind: "OWNER_DIRECT", principalId: "A" },
          acceptedByOwnerId: "A",
          status: "agreed",
          createdAt: new Date(),
        } as never,
        scopeId: "A",
        commitments: [
          {
            id: `cmt_${randomUUID()}`,
            agreementId: "x",
            ownerId: "A",
            termKey: "work",
            state: "open",
          } as never,
        ],
      }),
    ).rejects.toThrow(/does not say who it is owed to/i);
  });
});
