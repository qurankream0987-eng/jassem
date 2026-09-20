/**
 * JASIM — the data surface, photographed inside the running product.
 *
 * Gated, because it needs the dev server, the dev database and a browser:
 *
 *   JASIM_SHELL_URL=http://127.0.0.1:5731 JASIM_SHELL_OUT=<dir> \
 *     npx vitest run tests/ui/capture-data-surface.test.ts
 *
 * ─── WHAT IS REAL HERE ──────────────────────────────────────────────────────
 *
 * The rows are rows this test inserted into the dev database. The turns run
 * through `routeRuntimeConversationTurn` — the same function the product's own
 * endpoint calls — so the DataNeed, the authorization, the query, the dataset,
 * the surface and the message are all produced by the shipped runtime. The
 * browser then authenticates through the product's own session endpoint, opens
 * the conversation from the sidebar the way a person does, and photographs
 * what is on screen.
 *
 * ─── WHAT IS NOT ────────────────────────────────────────────────────────────
 *
 * The model's envelope. No provider credentials exist in this environment
 * (REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT), so the one thing that cannot be
 * real is the JSON the model would have returned. Everything downstream of it
 * is. This is stated rather than hidden: a capture that pretended otherwise
 * would be the kind of false proof this product refuses to produce.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, eq, like } from "drizzle-orm";

const BASE = process.env.JASIM_SHELL_URL;
const OUT = process.env.JASIM_SHELL_OUT;
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const INTENT = {
  requiredCapabilities: [],
  missingInputs: [],
  inputs: {},
  risk: "none",
  persistence: "ephemeral",
  effects: "none",
};
const READ_PLAN = { version: 1, kind: "DIRECT_READ", nodes: [], blockers: [] };

function envelope(extra: Record<string, unknown>): string {
  return JSON.stringify({
    version: 1,
    decisionId: randomUUID(),
    kind: "direct_action",
    label: "قراءة",
    goal: "عرض البيانات",
    intent: INTENT,
    confidence: 0.85,
    ...extra,
  });
}

const read = (extra: Record<string, unknown> = {}) =>
  envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "runs", ...extra } });

describe.skipIf(!BASE || !OUT)("the data surface inside the running conversation", () => {
  let browser: Browser;
  let ownerId: string;
  let runtime: typeof import("../../api/runtime/jasim-runtime");
  let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;
  let db: typeof import("../../api/queries/connection").db;
  let schema: typeof import("@db/schema");
  const notes: string[] = [];

  beforeAll(async () => {
    mkdirSync(OUT!, { recursive: true });
    // The product's own endpoint. It also upserts the dev:local user, which is
    // the identity the browser will carry — so the conversation is seeded for
    // the same person who will be looking at it.
    const response = await fetch(`${BASE!}/api/runtime/session`, { method: "POST" });
    const body = (await response.json()) as { token?: string };
    expect(body.token, "dev session token").toBeTruthy();

    runtime = await import("../../api/runtime/jasim-runtime");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
    ({ db } = await import("../../api/queries/connection"));
    schema = await import("@db/schema");

    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.unionId, "dev:local"));
    expect(user, "dev:local user").toBeTruthy();
    ownerId = String(user!.id);

    browser = await chromium.launch({
      executablePath: CHROME,
      args: ["--no-sandbox", "--disable-gpu"],
    });
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    if (notes.length) writeFileSync(path.join(OUT!, "CAPTURED.txt"), notes.join("\n"), "utf8");
  });

  /** Rows from an earlier capture, so the numbers on screen are this run's. */
  async function clearCaptureRows() {
    await db
      .delete(schema.runs)
      .where(
        and(eq(schema.runs.ownerId, ownerId), like(schema.runs.idempotencyKey, "capture-%")),
      );
  }

  async function seedRuns(goals: readonly string[]) {
    for (const [index, goal] of goals.entries()) {
      await db.insert(schema.runs).values({
        ownerId,
        goal,
        status: index % 2 === 0 ? "blocked" : "awaiting_input",
        idempotencyKey: `capture-${randomUUID()}`,
      });
    }
  }

  async function turn(conversationId: string, utterance: string, body: string) {
    const original = ModelGateway.prototype.generate;
    ModelGateway.prototype.generate = (async () => ({
      text: body,
      provider: "capture",
      model: "envelope-stub",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })) as never;
    try {
      return await runtime.routeRuntimeConversationTurn({
        ownerId,
        conversationId,
        content: utterance,
      });
    } finally {
      ModelGateway.prototype.generate = original;
    }
  }

  /** Open a conversation the way a person does: from the sidebar, by name. */
  async function open(page: Page, title: string) {
    await page.goto(`${BASE!}/`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    // At phone width the sidebar starts closed, the way it does for a person.
    const toggle = page.getByLabel("فتح قائمة المحادثات");
    if (await toggle.count()) await toggle.first().click();
    const entry = page.locator(`text=${title}`).first();
    await entry.waitFor({ timeout: 30_000 });
    await entry.click();
    // Wait for the turn's own content, not for a fixed interval.
    const anchors = page.locator("[data-surface-primitive], [data-routed-state]");
    await anchors.first().waitFor({ timeout: 30_000 });
    // The newest turn is at the bottom of a long thread. Without this the
    // viewport can sit above everything the capture is meant to show.
    await anchors.last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
  }

  async function shoot(page: Page, name: string) {
    await page.screenshot({ path: path.join(OUT!, `${name}.png`), fullPage: false });
    const seen = await page.evaluate(() => ({
      primitives: [...document.querySelectorAll("[data-surface-primitive]")].map((node) =>
        node.getAttribute("data-surface-primitive"),
      ),
      lifecycles: [...document.querySelectorAll("[data-surface-lifecycle]")].map((node) =>
        node.getAttribute("data-surface-lifecycle"),
      ),
      routed: [...document.querySelectorAll("[data-routed-state]")].map((node) =>
        node.getAttribute("data-routed-state"),
      ),
      // A bar chart whose track collapsed to nothing draws its labels and no
      // bars, and looks almost the same in a thumbnail.
      trackWidths: [...document.querySelectorAll("[data-chart-track]")].map((node) =>
        Math.round(node.getBoundingClientRect().width),
      ),
      // And one whose value column overflowed the row has its numbers sliced
      // in half by the surface's own border — which a thumbnail also hides.
      chartClipped: [...document.querySelectorAll("[data-chart-track]")].reduce(
        (worst, track) => {
          const row = track.parentElement!;
          const rowBox = row.getBoundingClientRect();
          const over = [...row.children].reduce((most, child) => {
            const box = child.getBoundingClientRect();
            return Math.max(most, rowBox.left - box.left, box.right - rowBox.right);
          }, 0);
          return Math.max(worst, Math.round(over));
        },
        0,
      ),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dir: document.documentElement.getAttribute("dir"),
      // The whole page's text, untruncated. The sidebar comes first in the
      // DOM, so any truncated read would be a list of conversation titles and
      // would say nothing about what the turn actually rendered.
      conversation: (document.body.innerText || "").replace(/\n+/g, " | "),
    }));
    notes.push(
      // The tail: the conversation and the composer, past the sidebar.
      `${name}: ${JSON.stringify({ ...seen, conversation: seen.conversation.slice(-420) })}`,
    );
    return seen;
  }

  it("captures A–F from the active conversation", async () => {
    // ── The data half: a table, re-sorted, then morphed into a chart ────────
    await clearCaptureRows();
    await seedRuns([
      "مراجعة العقد",
      "جرد المخزن",
      "تسليم الطلب",
      "تدقيق الفاتورة",
      // A long Arabic value, because a table that only ever holds short words
      // proves nothing about what a real one does at 390px.
      "مراجعة عقد التوريد السنوي مع المورد الرئيسي قبل نهاية الربع",
    ]);
    const data = await runtime.createRuntimeConversation({
      ownerId,
      title: `بيانات ${new Date().toISOString().slice(11, 19)}`,
    });

    await turn(data.id, "أرني عملياتي", read({ fields: ["goal", "status"] }));

    const desktop = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      locale: "ar",
    });
    await desktop.addCookies([
      {
        name: "jasim_session",
        value: ((await (await fetch(`${BASE!}/api/runtime/session`, { method: "POST" })).json()) as { token: string })
          .token,
        url: BASE!,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await desktop.newPage();

    await open(page, data.title);
    const a = await shoot(page, "A-table.desktop");
    expect(a.primitives).toContain("TABLE");

    await turn(data.id, "رتبها من الأعلى", envelope({ datasetOp: { op: "SORT", field: "goal", direction: "DESC" } }));
    await open(page, data.title);
    const b = await shoot(page, "B-table-sorted.desktop");
    expect(b.primitives.filter((entry) => entry === "TABLE").length).toBeGreaterThanOrEqual(2);

    await turn(
      data.id,
      "حولها إلى رسم",
      envelope({ datasetOp: { op: "CHART", form: "BAR", categoryField: "status", aggregation: "COUNT" } }),
    );
    await open(page, data.title);
    const c = await shoot(page, "C-chart-after-morph.desktop");
    expect(c.primitives).toContain("CHART");

    // ── The truthful-state half ─────────────────────────────────────────────
    const states = await runtime.createRuntimeConversation({
      ownerId,
      title: `حالات ${new Date().toISOString().slice(11, 19)}`,
    });

    // D — empty: a filter that matches nothing. Real query, real zero rows.
    await turn(
      states.id,
      "أرني العمليات المكتملة",
      read({ filters: [{ field: "status", operator: "EQ", value: "لا-شيء-مطابق" }] }),
    );
    await open(page, states.title);
    const d = await shoot(page, "D-empty.desktop");
    expect(d.conversation).toContain("لا توجد نتائج");

    // E — UNAVAILABLE: a resource that does not exist. No invented sales.
    await turn(states.id, "أرني مبيعاتي", envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "مبيعاتي" } }));
    await open(page, states.title);
    const e = await shoot(page, "E-unavailable.desktop");
    expect(e.routed).toContain("UNAVAILABLE");

    // F — DENIED: a sensitive field.
    await turn(states.id, "أرني مفاتيح عملياتي", read({ fields: ["idempotencyKey"] }));
    await open(page, states.title);
    const f = await shoot(page, "F-denied.desktop");
    expect(f.routed).toContain("DENIED");
    // The denied values never reached the page.
    expect(f.conversation).not.toContain("capture-");

    // ── G — back to the table ───────────────────────────────────────────────
    //
    // Last, so the data conversation is the most recent one: the mobile app
    // opens the newest conversation on launch, and this is the conversation
    // the native capture needs to be looking at.
    await turn(data.id, "رجّعها جدول", envelope({ datasetOp: { op: "TABLE" } }));
    await open(page, data.title);
    const g = await shoot(page, "G-table-after-chart.desktop");
    // A CHART and a TABLE of the SAME dataset, both on screen: the morph went
    // one way and came back.
    expect(g.primitives).toContain("CHART");
    expect(g.primitives.filter((entry) => entry === "TABLE").length).toBeGreaterThanOrEqual(3);

    await desktop.close();

    // ── The same conversation at phone width ────────────────────────────────
    const narrow = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "ar",
    });
    await narrow.addCookies([
      {
        name: "jasim_session",
        value: ((await (await fetch(`${BASE!}/api/runtime/session`, { method: "POST" })).json()) as { token: string })
          .token,
        url: BASE!,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const small = await narrow.newPage();
    await open(small, data.title);
    const narrowShot = await shoot(small, "C-chart-after-morph.web-390");
    // A wide table must not make the whole page scroll sideways.
    expect(narrowShot.overflow).toBeLessThanOrEqual(1);
    // And the chart must still be a chart at 390px.
    expect(narrowShot.trackWidths.length).toBeGreaterThan(0);
    for (const width of narrowShot.trackWidths) expect(width).toBeGreaterThanOrEqual(40);
    expect(narrowShot.chartClipped).toBeLessThanOrEqual(1);
    await narrow.close();
  }, 600_000);
});
