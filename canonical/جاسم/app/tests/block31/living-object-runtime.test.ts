/**
 * JASIM — A DURABLE, AUTHORIZED HANDLE ON SOMETHING THAT KEEPS GOING.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   CONVERSATION · MATERIALIZATION POLICY · DURABLE HANDLE
 *   SUBJECT TRUTH READ LIVE · RECONCILIATION · SURFACE STATE
 *
 *   LIVING_OBJECT != CANONICAL_SUBJECT
 *   DUPLICATE_OPERATIONAL_TRUTH = 0
 *   SURFACE_EXIT != LIVING_OBJECT_DELETE
 *   HIDE != CANCEL · CANCEL != DELETE · RESOLVED != ERASED
 *   EVERY_TURN_BECOMES_LIVING_OBJECT = NO
 *
 * Everything runs against a real PostgreSQL database with the real migrations.
 * "Followed" always means a row read back after the call that wrote it
 * returned — never a value still in a response.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let runtime: typeof import("../../api/runtime/jasim-runtime");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

let handle: TestDbHandle;
let living: typeof import("../../api/runtime/living-object-runtime");
let monitoring: typeof import("../../api/runtime/monitoring-runtime");

type UserRow = typeof users.$inferSelect;

/**
 * Six subjects from contexts nothing in the runtime anticipated, each reduced
 * to the structural pair that decides. Not one of them is a kind of thing the
 * runtime knows: they are an obligation, an execution, a condition and a
 * surface, and they differ in the terms somebody declared and nothing else.
 *
 *   DOMAIN_LIVING_OBJECT_TYPES_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
 */
const HOLDOUTS = [
  { id: "meal_delivery", label: "توصيل وجبة" },
  { id: "cnc_machine_repair", label: "إصلاح مكنة CNC" },
  { id: "hall_reservation", label: "حجز قاعة" },
  { id: "vehicle_transfer", label: "نقل برادو" },
  { id: "translation_engagement", label: "ترجمة عقد" },
  { id: "warehouse_storage", label: "تخزين بضاعة" },
] as const;

describe("JASIM · living object runtime", () => {
  let actor: UserRow;
  let other: UserRow;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    living = await import("../../api/runtime/living-object-runtime");
    monitoring = await import("../../api/runtime/monitoring-runtime");
    runtime = await import("../../api/runtime/jasim-runtime");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE living_objects, standing_monitors, monitor_evaluations,
        commitments, transactions, agreements, events, scope_policies,
        memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'lo-%'`));
    const [one] = await handle.db
      .insert(users)
      .values({ unionId: `lo-${randomUUID()}`, name: "سارة", preferences: {} })
      .returning();
    const [two] = await handle.db
      .insert(users)
      .values({ unionId: `lo-${randomUUID()}`, name: "خالد", preferences: {} })
      .returning();
    actor = one!;
    other = two!;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const me = () => String(actor.id);
  const them = () => String(other.id);

  /**
   * A real canonical commitment. It is the subject «أين وصل طلبي؟» is actually
   * about, and every holdout above is one of these with a different termKey.
   */
  async function commitment(over: {
    ownerId?: string;
    beneficiaryActorId?: string | null;
    state?: string;
    verification?: string;
    termKey?: string;
  } = {}) {
    const id = `cmt_${randomUUID().slice(0, 16)}`;
    const agreementId = `agr_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO commitments (id, "agreementId", "ownerId", "termKey", state,
        "beneficiaryActorId", verification, "evidenceKind", terms, "updatedAt", "createdAt")
        VALUES ('${id}', '${agreementId}', '${over.ownerId ?? them()}',
        '${over.termKey ?? "تسليم"}', '${over.state ?? "open"}',
        ${over.beneficiaryActorId === null ? "NULL" : `'${over.beneficiaryActorId ?? me()}'`},
        '${over.verification ?? "PENDING"}', 'HUMAN_ACTION', '{}', now(), now())`),
    );
    return id;
  }

  async function advance(id: string, state: string, verification = "PENDING") {
    await handle.db.execute(
      sql.raw(`UPDATE commitments SET state = '${state}', verification = '${verification}',
        "updatedAt" = now() + interval '1 second' WHERE id = '${id}'`),
    );
  }

  const follow = (subjectId: string, over: Partial<Parameters<typeof living.materializeLivingObject>[0]> = {}) =>
    living.materializeLivingObject({
      principalId: me(),
      subjectKind: "commitment",
      subjectId,
      sideEffect: "INTERNAL_STATE",
      durability: "ONGOING",
      conversationId: "c-lo",
      ...over,
    });

  async function handleRows(scopeId: string) {
    const rows = await handle.db.execute(
      sql.raw(`SELECT id, "subjectKind", "subjectId", "followState", "surfaceState", reason
        FROM living_objects WHERE "scopeId" = '${scopeId}' ORDER BY "createdAt"`),
    );
    return rows.rows as {
      id: string; subjectKind: string; subjectId: string;
      followState: string; surfaceState: string; reason: string;
    }[];
  }

  // ── A · THE HANDLE EXISTS, AND IS READ BACK ───────────────────────────────

  it("a durable obligation becomes a followed handle, read back from the table", async () => {
    const subject = await commitment();
    const result = await follow(subject);
    expect(result.materialized).toBe(true);

    // Read BACK. A response that said "followed" proves nothing.
    const rows = await handleRows(me());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subjectKind).toBe("commitment");
    expect(rows[0]!.subjectId).toBe(subject);
    expect(rows[0]!.followState).toBe("FOLLOWING");
    expect(rows[0]!.reason).toBe("OBLIGATION_CREATED");
  });

  it("following the same subject twice makes one handle, not two", async () => {
    const subject = await commitment();
    const first = await follow(subject);
    const second = await follow(subject);
    expect(first.materialized && first.created).toBe(true);
    expect(second.materialized && second.created).toBe(false);
    expect(await handleRows(me())).toHaveLength(1);
  });

  it("a concurrent double-follow still makes one handle", async () => {
    const subject = await commitment();
    // The unique index is what decides, not an ordering the test arranged.
    const results = await Promise.all([follow(subject), follow(subject)]);
    expect(results.every((entry) => entry.materialized)).toBe(true);
    expect(await handleRows(me())).toHaveLength(1);
  });

  // ── B · THE HANDLE IS NOT THE SUBJECT ─────────────────────────────────────

  it("the handle stores no status: the subject moves and the projection follows without a write", async () => {
    const subject = await commitment({ state: "open" });
    await follow(subject);
    const before = await living.projectLivingObjects({ principalId: me() });
    expect(before.objects[0]!.status).toBe("WAITING");

    // Nothing touches living_objects here. The subject alone changes.
    await advance(subject, "active");
    const after = await living.projectLivingObjects({ principalId: me() });
    expect(after.objects[0]!.status).toBe("ACTIVE");
  });

  it("the table carries no operational column at all", async () => {
    //   DUPLICATE_OPERATIONAL_TRUTH = 0
    const rows = await handle.db.execute(
      sql.raw(`SELECT column_name FROM information_schema.columns
        WHERE table_name = 'living_objects'`),
    );
    const columns = rows.rows.map((row) => String((row as { column_name: string }).column_name));
    for (const forbidden of ["status", "state", "title", "progress", "payload", "terms", "amount"]) {
      expect(columns, `living_objects carries ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("CLAIMED_COMPLETE != VERIFIED_COMPLETE survives the projection", async () => {
    const subject = await commitment({ state: "completed", verification: "PENDING" });
    // Terminal-looking but unverified: it must not materialize as finished, and
    // the projection must not call it COMPLETED.
    const declined = await follow(subject);
    expect(declined.materialized).toBe(true);
    const projection = await living.projectLivingObjects({ principalId: me() });
    expect(projection.objects[0]!.status).toBe("VERIFYING");
  });

  // ── C · MATERIALIZATION POLICY ────────────────────────────────────────────

  it("a read-only turn leaves nothing behind", async () => {
    //   EVERY_TURN_BECOMES_LIVING_OBJECT = NO
    const subject = await commitment();
    const result = await follow(subject, { sideEffect: "NONE", durability: "EPHEMERAL" });
    expect(result.materialized).toBe(false);
    expect(result.materialized === false && result.decline).toBe("READ_ONLY_TURN");
    expect(await handleRows(me())).toHaveLength(0);
  });

  it("an ephemeral result leaves nothing behind even when it changed state", async () => {
    const subject = await commitment();
    const result = await follow(subject, { sideEffect: "INTERNAL_STATE", durability: "EPHEMERAL" });
    expect(result.materialized === false && result.decline).toBe("EPHEMERAL_RESULT");
  });

  it("a subject that already finished is never newly followed", async () => {
    const subject = await commitment({ state: "cancelled" });
    const result = await follow(subject);
    expect(result.materialized === false && result.decline).toBe("SUBJECT_ALREADY_TERMINAL");
  });

  it("the policy decides on shape alone — every holdout takes the same path", async () => {
    //   DOMAIN_NOUN_BRANCHES = 0 · SCENARIO_NAME_BRANCHES = 0
    for (const holdout of HOLDOUTS) {
      const subject = await commitment({ termKey: holdout.label });
      const result = await follow(subject);
      expect(result.materialized, holdout.id).toBe(true);
      expect(result.materialized && result.object.reason, holdout.id).toBe("OBLIGATION_CREATED");
    }
    expect(await handleRows(me())).toHaveLength(HOLDOUTS.length);
  });

  it("and every holdout is refused identically when the turn was a read", async () => {
    // The companion. Same six, same refusal — which is what makes the previous
    // test a statement about the policy rather than about six inserts.
    for (const holdout of HOLDOUTS) {
      const subject = await commitment({ termKey: holdout.label });
      const result = await follow(subject, { sideEffect: "NONE", durability: "EPHEMERAL" });
      expect(result.materialized, holdout.id).toBe(false);
    }
    expect(await handleRows(me())).toHaveLength(0);
  });

  // ── D · AUTHORIZATION ─────────────────────────────────────────────────────

  it("a guessed id is refused exactly as an absent one is", async () => {
    // If the two refusals differed, guessing would be an existence oracle.
    const foreign = await commitment({ ownerId: them(), beneficiaryActorId: null });
    const guessed = await follow(`cmt_${randomUUID().slice(0, 16)}`);
    const forbidden = await follow(foreign);
    expect(guessed.materialized).toBe(false);
    expect(forbidden.materialized).toBe(false);
    expect(await handleRows(me())).toHaveLength(0);
  });

  it("a party to an obligation may follow it; a stranger may not", async () => {
    const mine = await commitment({ ownerId: them(), beneficiaryActorId: me() });
    expect((await follow(mine)).materialized).toBe(true);
    const theirs = await commitment({ ownerId: them(), beneficiaryActorId: null });
    expect((await follow(theirs)).materialized).toBe(false);
  });

  it("another scope's handle is NOT_FOUND, never FORBIDDEN", async () => {
    const subject = await commitment();
    const made = await follow(subject);
    const id = made.materialized ? made.object.id : "";
    await expect(
      living.readLivingObject({ principalId: them(), id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("standing is re-asked on every read, not trusted from the handle", async () => {
    const subject = await commitment({ ownerId: them(), beneficiaryActorId: me() });
    await follow(subject);
    expect((await living.projectLivingObjects({ principalId: me() })).objects[0]!.unreadable).toBe(false);

    // The standing that made it visible is taken away. Nothing touches the handle.
    await handle.db.execute(
      sql.raw(`UPDATE commitments SET "beneficiaryActorId" = NULL WHERE id = '${subject}'`),
    );
    const after = await living.projectLivingObjects({ principalId: me() });
    expect(after.objects[0]!.unreadable).toBe(true);
    //   UNKNOWN != FALSE · UNKNOWN != ABSENT
    expect(after.objects[0]!.status).toBe("UNKNOWN");
    expect(after.objects[0]!.title).toBe("");
  });

  it("a deleted subject leaves the handle in place, saying it cannot be read", async () => {
    const subject = await commitment();
    await follow(subject);
    await handle.db.execute(sql.raw(`DELETE FROM commitments WHERE id = '${subject}'`));
    const after = await living.projectLivingObjects({ principalId: me() });
    // The handle survives — RESOLVED != ERASED, and so is a vanished subject.
    expect(after.objects).toHaveLength(1);
    expect(after.objects[0]!.unreadable).toBe(true);
  });

  // ── E · SURFACE STATE ─────────────────────────────────────────────────────

  it("hiding removes it from the surface and changes nothing about the subject", async () => {
    //   HIDE != CANCEL · SURFACE_EXIT != LIVING_OBJECT_DELETE
    const subject = await commitment({ state: "active" });
    const made = await follow(subject);
    const id = made.materialized ? made.object.id : "";
    await living.setLivingObjectState({ principalId: me(), id, surfaceState: "HIDDEN" });

    const visible = await living.projectLivingObjects({ principalId: me() });
    expect(visible.objects).toHaveLength(0);

    // The handle is still there…
    expect(await handleRows(me())).toHaveLength(1);
    // …and so is the obligation, untouched.
    const subjectRow = await handle.db.execute(
      sql.raw(`SELECT state FROM commitments WHERE id = '${subject}'`),
    );
    expect((subjectRow.rows[0] as { state: string }).state).toBe("active");
  });

  it("a hidden handle is still there when asked for", async () => {
    const subject = await commitment({ state: "active" });
    const made = await follow(subject);
    const id = made.materialized ? made.object.id : "";
    await living.setLivingObjectState({ principalId: me(), id, surfaceState: "HIDDEN" });
    const all = await living.projectLivingObjects({ principalId: me(), includeHidden: true });
    expect(all.objects).toHaveLength(1);
    expect(all.objects[0]!.surfaceState).toBe("HIDDEN");
  });

  it("resolving does not erase, and the subject is untouched", async () => {
    //   RESOLVED != ERASED
    const subject = await commitment({ state: "active" });
    const made = await follow(subject);
    const id = made.materialized ? made.object.id : "";
    await living.setLivingObjectState({ principalId: me(), id, followState: "RESOLVED" });
    expect(await handleRows(me())).toHaveLength(1);
    const subjectRow = await handle.db.execute(
      sql.raw(`SELECT state FROM commitments WHERE id = '${subject}'`),
    );
    expect((subjectRow.rows[0] as { state: string }).state).toBe("active");
  });

  it("the surface offers no way to cancel or delete the subject", async () => {
    //   CANCEL != DELETE, and neither is reachable from a handle.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/living-object-runtime.ts", "utf8"),
    );
    expect(source).not.toMatch(/delete\(commitments\)/);
    expect(source).not.toMatch(/delete\(transactions\)/);
    expect(source).not.toMatch(/delete\(agreements\)/);
    expect(source).not.toMatch(/delete\(standingMonitors\)/);
    // Not even its own rows: a handle is never destroyed, only released.
    expect(source).not.toMatch(/db\s*\n?\s*\.delete\(/);
  });

  // ── F · RECONCILIATION ────────────────────────────────────────────────────

  it("a follower is told what moved since they last looked", async () => {
    const subject = await commitment({ state: "open" });
    const made = await follow(subject);
    const id = made.materialized ? made.object.id : "";
    // Freshly materialized: the cursor was set, so nothing has moved yet.
    expect((await living.readLivingObject({ principalId: me(), id })).changedSinceLastSeen).toBe(false);

    await advance(subject, "active");
    expect((await living.readLivingObject({ principalId: me(), id })).changedSinceLastSeen).toBe(true);

    await living.acknowledgeLivingObject({ principalId: me(), id });
    expect((await living.readLivingObject({ principalId: me(), id })).changedSinceLastSeen).toBe(false);
  });

  it("the sweep resolves a handle whose subject reached a terminal state", async () => {
    const subject = await commitment({ state: "active" });
    await follow(subject);
    await advance(subject, "cancelled");
    const result = await living.reconcileLivingObjects({ scopeId: me() });
    expect(result.changed).toBe(1);
    expect(result.resolved).toBe(1);
    const rows = await handleRows(me());
    expect(rows[0]!.followState).toBe("RESOLVED");
  });

  it("the sweep writes a canonical event, and a quiet subject writes none", async () => {
    const moving = await commitment({ state: "open" });
    const quiet = await commitment({ state: "open" });
    await follow(moving);
    await follow(quiet);
    await handle.db.execute(sql.raw(`DELETE FROM events`));

    await advance(moving, "active");
    await living.reconcileLivingObjects({ scopeId: me() });

    const rows = await handle.db.execute(
      sql.raw(`SELECT type, "correlationId" FROM events WHERE "ownerId" = '${me()}'`),
    );
    // Exactly one: the subject that moved. A repeat is not a change.
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as { type: string }).type).toBe("LIVING_OBJECT_CHANGED");
  });

  it("an event carries ids and a closed vocabulary — never contents", async () => {
    const subject = await commitment({ termKey: "سرّ تجاري لا يجوز تسريبه" });
    await follow(subject);
    const rows = await handle.db.execute(
      sql.raw(`SELECT payload FROM events WHERE "ownerId" = '${me()}'`),
    );
    const payload = (rows.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(Object.keys(payload).sort()).toEqual(
      ["followState", "livingObjectId", "subjectKind", "surfaceState"].sort(),
    );
    expect(JSON.stringify(payload)).not.toContain("سرّ");
  });

  it("an unreadable subject is skipped by the sweep, not resolved and not deleted", async () => {
    const subject = await commitment();
    await follow(subject);
    await handle.db.execute(sql.raw(`DELETE FROM commitments WHERE id = '${subject}'`));
    const result = await living.reconcileLivingObjects({ scopeId: me() });
    expect(result.unreadable).toBe(1);
    expect(result.resolved).toBe(0);
    expect(await handleRows(me())).toHaveLength(1);
  });

  it("a released handle comes back when the subject gives a reason to follow again", async () => {
    const subject = await commitment({ state: "active" });
    const made = await follow(subject);
    const id = made.materialized ? made.object.id : "";
    await living.setLivingObjectState({ principalId: me(), id, followState: "RELEASED" });
    const again = await follow(subject);
    expect(again.materialized && again.object.id).toBe(id);
    expect(again.materialized && again.object.followState).toBe("FOLLOWING");
    expect(await handleRows(me())).toHaveLength(1);
  });

  // ── G · THE RUNTIME DECLARES NOTHING OF ITS OWN ───────────────────────────

  it("no table, socket, scheduler or ledger of its own", async () => {
    //   SECOND_EVENT_LEDGERS_ADDED = 0 · SECOND_CURSOR_MODELS_ADDED = 0
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/living-object-runtime.ts", "utf8"),
    );
    expect(source).not.toMatch(/pgTable\(/);
    expect(source).not.toMatch(/new WebSocketServer\(/);
    expect(source).not.toMatch(/setInterval\(|setTimeout\(/);
  });

  it("nothing it exports names a domain", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/living-object-runtime.ts", "utf8"),
    );
    const declared = [...source.matchAll(/export (?:type|function|const|class|async function) (\w+)/g)]
      .map((match) => match[1]!);
    expect(declared.length).toBeGreaterThan(5);
    for (const name of declared) {
      for (const word of ["Order", "Delivery", "Booking", "Job", "Driver", "Shipment", "Price", "Food"]) {
        expect(name, `${name} names ${word}`).not.toContain(word);
      }
    }
  });

  // ── H · THE REAL CONVERSATION BOUNDARY ────────────────────────────────────

  /** A real turn, with the model saying only what a model may say. */
  async function turn(content: string, livingObject?: Record<string, unknown>) {
    const conversation = await runtime.createRuntimeConversation({
      ownerId: me(),
      title: "living",
    });
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "direct_action",
        label: "متابعة",
        goal: "أين وصل",
        intent: {
          requiredCapabilities: [], missingInputs: [], inputs: {},
          risk: "low", persistence: "durable", effects: "none",
        },
        confidence: 0.9,
        ...(livingObject ? { livingObject } : {}),
      }),
      provider: "openai", model: "stub-for-living-objects",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: me(),
      conversationId: conversation.id,
      content,
    });
    return result.output as Record<string, unknown>;
  }

  it("«أين وصل طلبي؟» with nothing followed says so, and invents nothing", async () => {
    //   MODEL_INVENTED_SUBJECTS = 0
    const response = await turn("أين وصل طلبي؟", { intent: "LIST" });
    const text = JSON.stringify(response);
    expect(text).toContain("لا أتابع لك شيئاً");
    // Not one word that would imply an order exists, a courier is moving, or a
    // time is known.
    for (const invented of ["قريب", "دقيقة", "الطريق", "السائق", "وصل الآن"]) {
      expect(text, `invented «${invented}»`).not.toContain(invented);
    }
    expect(await handleRows(me())).toHaveLength(0);
  });

  it("«أين وصل طلبي؟» with something followed reports the subject's own state", async () => {
    const subject = await commitment({ state: "active", termKey: "تسليم الطلب" });
    await follow(subject);
    const response = await turn("أين وصل طلبي؟", { intent: "LIST" });
    const text = JSON.stringify(response);
    expect(text).toContain("تسليم الطلب");
    expect(text).toContain("ACTIVE");
  });

  it("a discovery turn through the real boundary leaves nothing followed", async () => {
    //   EVERY_TURN_BECOMES_LIVING_OBJECT = NO
    //   SHAWARMA_BRANCH = 0 · BROASTED_BRANCH = 0
    for (const asked of ["أين ألاقي شاورما؟", "قارن لي أسعار البروستد", "اختر لي الأفضل"]) {
      await turn(asked);
    }
    expect(await handleRows(me())).toHaveLength(0);
  });

  it("hiding through the boundary says plainly that nothing was cancelled", async () => {
    const subject = await commitment({ state: "active" });
    const made = await follow(subject);
    const id = made.materialized ? made.object.id : "";
    const response = await turn("أخفِ هذه", { intent: "HIDE", livingObjectRef: id });
    const text = JSON.stringify(response);
    expect(text).toContain("لم ألغِ شيئاً");
    const subjectRow = await handle.db.execute(
      sql.raw(`SELECT state FROM commitments WHERE id = '${subject}'`),
    );
    expect((subjectRow.rows[0] as { state: string }).state).toBe("active");
  });

  it("a handle the model named but this scope does not hold is refused", async () => {
    //   LLM != AUTHORITY
    const subject = await commitment({ ownerId: them(), beneficiaryActorId: null });
    await living.materializeLivingObject({
      principalId: them(), subjectKind: "commitment", subjectId: subject,
      sideEffect: "INTERNAL_STATE", durability: "ONGOING",
    });
    const theirs = await handleRows(them());
    expect(theirs).toHaveLength(1);
    const response = await turn("أرني هذه", { intent: "READ", livingObjectRef: theirs[0]!.id });
    expect(JSON.stringify(response)).toContain("لا أتابع شيئاً بهذا المعرّف");
  });

  // ── I · SUBJECT BREADTH ───────────────────────────────────────────────────

  it("every declared subject kind has a reader that reads a real canonical row", async () => {
    // The breadth claim, proven rather than declared. Each row is inserted into
    // the subject's OWN canonical table, and each is read back through the one
    // door. A kind whose reader was never exercised would be a promise.
    const made: Partial<Record<string, string>> = {};

    const cmt = await commitment({ state: "open" });
    made.commitment = cmt;

    const agr = `agr_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO agreements (id, "engagementId", "proposalId", participants, terms,
        "authorityBasis", "acceptedByOwnerId", status, "createdAt")
        VALUES ('${agr}', 'eng_x', 'prp_x', '["${me()}"]', '{}', '{}', '${me()}', 'agreed', now())`),
    );
    made.agreement = agr;

    const txn = `txn_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO transactions (id, "scopeId", parties, "agreementId", "termsSnapshot",
        "termsDigest", state, "createdAt", "updatedAt")
        VALUES ('${txn}', '${me()}', '["${me()}"]', '${agr}', '{}', 'digest', 'OPEN', now(), now())`),
    );
    made.transaction = txn;

    const res = `res_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO reservations (id, "ownerId", "resourceOwnerId", "resourceKind",
        "resourceId", quantity, unit, status, "idempotencyKey", "createdAt", "updatedAt")
        VALUES ('${res}', '${me()}', '${them()}', 'قاعة', 'r1', 1, 'unit', 'HELD',
        'idem_${randomUUID().slice(0, 8)}', now(), now())`),
    );
    made.reservation = res;

    const eng = `eng_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO economic_engagements (id, "initiatorOwnerId", participants, context,
        state, "createdAt", "updatedAt")
        VALUES ('${eng}', '${me()}', '["${me()}"]', '{}', 'open', now(), now())`),
    );
    made.engagement = eng;

    const neg = `neg_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO negotiation_envelopes (id, "engagementId", "ownerId", state, version, "setByPrincipalId", "createdAt")
        VALUES ('${neg}', '${eng}', '${me()}', 'active', 1, '${me()}', now())`),
    );
    made.negotiation = neg;

    // Through the monitoring runtime's own door, not an insert: a standing
    // condition is created the way the runtime creates one.
    const monitor = await monitoring.createMonitor({
      request: {
        label: "شرط دائم",
        subjectKind: "resource",
        subjectId: `subj_${randomUUID().slice(0, 12)}`,
        observationType: "sensor.reading",
        sourceClass: "OBSERVATION",
        condition: { op: "greater_than", field: "v", value: 1 },
        evaluationMode: "EDGE",
        repeatPolicy: "ONE_SHOT",
        freshnessRequirement: "CURRENT",
        actionKind: "NOTIFY",
        actionChannels: [],
      },
      scope: { kind: "PERSONAL", scopeId: me(), principalId: me() },
      conversationId: "c-lo",
    });
    made.monitor = monitor.monitorId;

    for (const [kind, id] of Object.entries(made)) {
      const snapshot = await living.readSubject(kind as never, id!);
      expect(snapshot.exists, kind).toBe(true);
      expect(snapshot.authorizedScopes, kind).toContain(me());
      // No reader may answer UNKNOWN for a row it just read: an unrecognized
      // state word would be a vocabulary gap hiding as a status.
      expect(snapshot.status, `${kind} reads as UNKNOWN`).not.toBe("UNKNOWN");
      expect(snapshot.revision, kind).not.toBe("");
    }
  });

  it("and each of them becomes a handle through the same one call", async () => {
    // The companion. If any kind needed its own path, generality has failed.
    const res = `res_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO reservations (id, "ownerId", "resourceOwnerId", "resourceKind",
        "resourceId", quantity, unit, status, "idempotencyKey", "createdAt", "updatedAt")
        VALUES ('${res}', '${me()}', '${them()}', 'قاعة', 'r1', 1, 'unit', 'HELD',
        'idem_${randomUUID().slice(0, 8)}', now(), now())`),
    );
    const neg = `neg_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO negotiation_envelopes (id, "engagementId", "ownerId", state, version, "setByPrincipalId", "createdAt")
        VALUES ('${neg}', 'eng_x', '${me()}', 'active', 1, '${me()}', now())`),
    );
    for (const [kind, id] of [["reservation", res], ["negotiation", neg]] as const) {
      const result = await follow(id, { subjectKind: kind });
      expect(result.materialized, kind).toBe(true);
    }
    const rows = await handleRows(me());
    expect(rows.map((row) => row.subjectKind).sort()).toEqual(["negotiation", "reservation"]);
  });
});
