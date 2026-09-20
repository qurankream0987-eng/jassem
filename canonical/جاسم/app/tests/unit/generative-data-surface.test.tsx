/**
 * JASIM — the surface a turn produced, as the conversation actually renders it.
 *
 * The data system was proved in `canonical-data.test.ts`: a DataNeed becomes an
 * AuthorizedQuery becomes a CanonicalDataset. This file proves the last step —
 * that the dataset reaches a person, in the active chat, without the renderer
 * inventing, hiding or guessing anything on the way.
 *
 * The three things a presentation layer can lie about are all tested here:
 * what it draws (a primitive it does not understand), what it leaves out (a
 * field the runtime did not declare), and what it implies (an aggregate over a
 * window drawn as if it were the whole dataset).
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DatasetSurface,
  type ChartSurfaceData,
  type TableSurfaceData,
} from "../../src/components/jasim-core/DatasetSurface";
import { ChatMessage } from "../../src/components/chat/ChatMessage";
import {
  RoutedNotice,
  TRUSTED_SURFACE_PRIMITIVES,
  TurnSurface,
  classifyLifecycle,
} from "../../src/components/jasim-core/TurnSurface";

const table = (over: Partial<TableSurfaceData> = {}): TableSurfaceData => ({
  primitive: "TABLE",
  datasetId: "ds_1",
  revision: 1,
  columns: [
    { key: "goal", label: "الهدف", type: "TEXT" },
    { key: "amount", label: "القيمة", type: "NUMBER" },
  ],
  rows: [
    { ref: "r1", position: 1, cells: [{ key: "goal", value: "ألف" }, { key: "amount", value: 10 }] },
    { ref: "r2", position: 2, cells: [{ key: "goal", value: "باء" }, { key: "amount", value: 30 }] },
  ],
  window: { limit: 50, offset: 0 },
  sort: [],
  freshness: "UNKNOWN",
  ...over,
});

const chart = (over: Partial<ChartSurfaceData> = {}): ChartSurfaceData => ({
  primitive: "CHART",
  datasetId: "ds_1",
  revision: 1,
  form: "BAR",
  categoryLabel: "الحالة",
  measureLabel: "العدد",
  aggregation: "COUNT",
  points: [
    { category: "منجزة", value: 4 },
    { category: "معلّقة", value: 1 },
  ],
  freshness: "UNKNOWN",
  scope: "COMPLETE_WINDOW",
  coverage: { counted: 5 },
  ...over,
});

const render = (node: React.ReactElement) => renderToStaticMarkup(node);

// ── The registry is closed ───────────────────────────────────────────────────

describe("the client may not choose a presentation primitive", () => {
  it("the trusted registry is a closed set, not an open dispatch", () => {
    expect([...TRUSTED_SURFACE_PRIMITIVES].sort()).toEqual(["CHART", "TABLE"]);
  });

  it("holds no domain surface", () => {
    // DOMAIN_SURFACES_ADDED = 0. A SalesChart here would be a second data
    // architecture wearing a component's clothes.
    for (const primitive of TRUSTED_SURFACE_PRIMITIVES) {
      expect(["TABLE", "CHART"]).toContain(primitive);
    }
  });

  it("an unknown primitive renders a named notice and never the payload", () => {
    const markup = render(
      <TurnSurface
        surface={{
          primitive: "SALES_DASHBOARD",
          datasetId: "ds_1",
          revision: 1,
          secretNote: "لا يجب أن يظهر هذا",
        }}
      />,
    );
    expect(markup).toContain("لا يمكن عرض هذا النوع من الأسطح");
    expect(markup).toContain("SALES_DASHBOARD");
    expect(markup).not.toContain("لا يجب أن يظهر هذا");
  });

  it("a payload claiming TABLE with the wrong shape is refused, not rendered", () => {
    // Surface schema validation at the boundary: `rows` is not an array, so
    // this is not a table however it labels itself.
    const markup = render(
      <TurnSurface surface={{ primitive: "TABLE", datasetId: "ds_1", revision: 1, rows: "ألف" }} />,
    );
    expect(markup).toContain("لا يمكن عرض هذا النوع من الأسطح");
    expect(markup).not.toContain("<table");
  });

  it("a payload claiming CHART with no points is refused", () => {
    const markup = render(
      <TurnSurface surface={{ primitive: "CHART", datasetId: "ds_1", revision: 1 }} />,
    );
    expect(markup).toContain("لا يمكن عرض هذا النوع من الأسطح");
  });

  it("nothing at all renders nothing at all", () => {
    expect(render(<TurnSurface surface={undefined} />)).toBe("");
    expect(render(<TurnSurface surface={null} />)).toBe("");
  });

  it("carries the primitive and the lifecycle into the DOM", () => {
    const markup = render(<TurnSurface surface={table()} />);
    expect(markup).toContain('data-surface-primitive="TABLE"');
    expect(markup).toContain('data-surface-lifecycle="ENTER"');
  });
});

// ── Lifecycle is semantic state ──────────────────────────────────────────────

describe("surface lifecycle is a fact about the data, not an animation", () => {
  const view = (primitive: string, datasetId = "ds_1", revision = 1) => ({
    primitive,
    datasetId,
    revision,
  });

  it("the first surface of a turn ENTERs", () => {
    expect(classifyLifecycle(undefined, view("TABLE"))).toBe("ENTER");
  });

  it("the same dataset at a new revision UPDATEs", () => {
    expect(classifyLifecycle(view("TABLE"), view("TABLE", "ds_1", 2))).toBe("UPDATE");
  });

  it("TABLE → CHART over the same dataset is a MORPH", () => {
    expect(classifyLifecycle(view("TABLE"), view("CHART"))).toBe("MORPH");
  });

  it("CHART → TABLE is the same MORPH in the other direction", () => {
    expect(classifyLifecycle(view("CHART"), view("TABLE"))).toBe("MORPH");
  });

  it("a different dataset is a new surface, not an update of the old one", () => {
    expect(classifyLifecycle(view("TABLE"), view("TABLE", "ds_2"))).toBe("ENTER");
  });

  it("a surface that goes away EXITs", () => {
    expect(classifyLifecycle(view("TABLE"), undefined)).toBe("EXIT");
  });

  it("nothing changing is NO_CHANGE, not a redraw", () => {
    expect(classifyLifecycle(view("TABLE"), view("TABLE"))).toBe("NO_CHANGE");
    expect(classifyLifecycle(undefined, undefined)).toBe("NO_CHANGE");
  });
});

// ── TABLE ────────────────────────────────────────────────────────────────────

describe("a table draws exactly what the runtime declared", () => {
  it("renders every declared column and every cell", () => {
    const markup = render(<DatasetSurface surface={table()} />);
    expect(markup).toContain("الهدف");
    expect(markup).toContain("القيمة");
    expect(markup).toContain("ألف");
    expect(markup).toContain("باء");
  });

  it("renders no column the runtime did not declare", () => {
    // A row carrying a cell for an undeclared field: the column list is the
    // authority, so the value never reaches the DOM. This is the leak the
    // projection guard exists to prevent, checked on the far side of it.
    const leaky = table({
      rows: [
        {
          ref: "r1",
          position: 1,
          cells: [
            { key: "goal", value: "ألف" },
            { key: "amount", value: 10 },
            { key: "idempotencyKey", value: "seed-secret-value" },
          ],
        },
      ],
    });
    const markup = render(<DatasetSurface surface={leaky} />);
    expect(markup).toContain("ألف");
    expect(markup).not.toContain("seed-secret-value");
    expect(markup).not.toContain("idempotencyKey");
  });

  it("says how much of the data it is showing", () => {
    const markup = render(
      <DatasetSurface surface={table({ window: { limit: 50, offset: 0, totalRows: 4000 } })} />,
    );
    expect(markup).toContain("2 من 4000 صفاً");
  });

  it("does not say «من» when it is showing everything", () => {
    const markup = render(<DatasetSurface surface={table()} />);
    expect(markup).toContain("2 صفاً");
    expect(markup).not.toContain("من 2");
  });

  it("never claims live data", () => {
    for (const freshness of ["CURRENT", "STALE", "UNKNOWN"] as const) {
      const markup = render(<DatasetSurface surface={table({ freshness })} />);
      expect(markup).not.toContain("مباشر");
    }
    expect(render(<DatasetSurface surface={table({ freshness: "UNKNOWN" })} />)).toContain(
      "حسب آخر قراءة",
    );
  });

  it("an empty table is a real answer, not a header over nothing", () => {
    const markup = render(<DatasetSurface surface={table({ rows: [], emptyReason: "NO_ROWS" })} />);
    expect(markup).toContain("لا توجد نتائج مطابقة");
    expect(markup).not.toContain("<table");
  });

  it("reads right to left", () => {
    const markup = render(<DatasetSurface surface={table()} />);
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain("text-right");
  });

  it("shows which column the presented order is by", () => {
    const markup = render(
      <DatasetSurface surface={table({ sort: [{ field: "amount", direction: "DESC" }] })} />,
    );
    // The arrow is decorative; the point is that a sorted view says it is one.
    expect(markup).toContain("↓");
  });
});

// ── CHART ────────────────────────────────────────────────────────────────────

describe("a chart says what it computed, and over what", () => {
  it("names the measure and the category rather than showing a legend", () => {
    const markup = render(<DatasetSurface surface={chart()} />);
    expect(markup).toContain("العدد حسب الحالة");
  });

  it("draws one series in one hue", () => {
    const markup = render(<DatasetSurface surface={chart()} />);
    const hues = [...markup.matchAll(/#[0-9a-f]{6}/gi)].map((match) => match[0].toLowerCase());
    // Colouring each bar differently would be colouring by rank.
    expect(new Set(hues).size).toBe(1);
  });

  it("gives the numbers as text, so identity never depends on colour", () => {
    const markup = render(<DatasetSurface surface={chart()} />);
    expect(markup).toContain("عرض القيم كنص");
    expect(markup).toContain("منجزة");
    expect(markup).toContain("معلّقة");
  });

  it("a partial window says so, in words", () => {
    const markup = render(
      <DatasetSurface
        surface={chart({ scope: "PARTIAL_WINDOW", coverage: { counted: 50, total: 4000 } })}
      />,
    );
    expect(markup).toContain("محسوب على 50 من 4000 صفاً المعروضة، وليس على كامل البيانات");
    expect(markup).toContain('role="note"');
  });

  it("a complete window adds no caveat it has not earned", () => {
    expect(render(<DatasetSurface surface={chart({ scope: "COMPLETE_WINDOW" })} />)).not.toContain(
      "وليس على كامل البيانات",
    );
  });

  it("a source-side aggregate adds no caveat either", () => {
    expect(
      render(
        <DatasetSurface
          surface={chart({ scope: "SOURCE", coverage: { counted: 2, total: 2 } })}
        />,
      ),
    ).not.toContain("وليس على كامل البيانات");
  });

  it("a line chart starts on the right, where an Arabic reader starts", () => {
    const markup = render(<DatasetSurface surface={chart({ form: "LINE" })} />);
    // The path's first command is the first category, and it sits at x = 100.
    expect(markup).toMatch(/d="M100 /);
  });

  it("an empty chart refuses to draw rather than drawing zero", () => {
    const markup = render(
      <DatasetSurface surface={chart({ points: [], emptyReason: "NO_ROWS" })} />,
    );
    expect(markup).toContain("لا توجد بيانات لرسمها");
    expect(markup).not.toContain("<svg");
  });
});

// ── The turn that produced no surface ────────────────────────────────────────

describe("a routed turn with nothing to show does not look like an answer", () => {
  it.each(["UNAVAILABLE", "DENIED", "NEEDS_INPUT"] as const)("%s renders as a notice", (state) => {
    const markup = render(<RoutedNotice state={state} message="لا يوجد مصدر بيانات لهذا." />);
    expect(markup).toContain(`data-routed-state="${state}"`);
    expect(markup).toContain('role="status"');
    expect(markup).toContain("لا يوجد مصدر بيانات لهذا.");
  });

  it("a denial says it was denied and carries no denied content", () => {
    const markup = render(
      <RoutedNotice state="DENIED" message="لا يمكن عرض الحقل «مفتاح التنفيذ»." />,
    );
    expect(markup).toContain('data-routed-state="DENIED"');
    expect(markup).not.toContain("seed-");
  });
});

// ── Inside the active conversation ───────────────────────────────────────────

/**
 * The surfaces above are correct in isolation. This section is about the thing
 * the phase brief actually asks for: that they appear in the CONVERSATION —
 * mounted on the assistant's own message, in the thread, rather than in a panel
 * a person has to go and find.
 */
describe("the surface appears inside the chat, on the turn that produced it", () => {
  const message = (metadata: Record<string, unknown>, content = "عرضت جدولاً.") =>
    ({
      id: "m1",
      role: "assistant",
      content,
      createdAt: "2026-09-20T00:00:00.000Z",
      metadata,
    }) as never;

  it("a table turn mounts its table on the assistant's message", () => {
    const markup = render(<ChatMessage message={message({ surface: table() })} />);
    expect(markup).toContain('data-surface-primitive="TABLE"');
    expect(markup).toContain("الهدف");
    expect(markup).toContain("ألف");
    // The words the assistant said are still there: the surface is part of the
    // turn, not a replacement for it.
    expect(markup).toContain("عرضت جدولاً.");
  });

  it("a chart turn mounts its chart on the same message", () => {
    const markup = render(
      <ChatMessage message={message({ surface: chart() }, "عرضت رسماً.")} />,
    );
    expect(markup).toContain('data-surface-primitive="CHART"');
    expect(markup).toContain("العدد حسب الحالة");
  });

  it("an ordinary reply mounts no surface at all", () => {
    const markup = render(<ChatMessage message={message({}, "تم.")} />);
    expect(markup).not.toContain("data-surface-primitive");
    expect(markup).not.toContain("data-routed-state");
  });

  it.each(["UNAVAILABLE", "DENIED", "NEEDS_INPUT"] as const)(
    "a %s turn is drawn as a notice, never as an ordinary reply",
    (state) => {
      const markup = render(
        <ChatMessage
          message={message({ routed: { state, cause: state } }, "لا يوجد مصدر بيانات لهذا.")}
        />,
      );
      expect(markup).toContain(`data-routed-state="${state}"`);
      expect(markup).toContain("لا يوجد مصدر بيانات لهذا.");
      // Not in the prose bubble an answer would use — the two must not look
      // alike, or a refusal reads as a finding.
      expect(markup).not.toContain("prose prose-invert");
    },
  );

  it("a denial carries no denied content into the conversation", () => {
    const markup = render(
      <ChatMessage
        message={message(
          { routed: { state: "DENIED", cause: "DENIED" } },
          "لا يمكن عرض الحقل «مفتاح التنفيذ».",
        )}
      />,
    );
    expect(markup).toContain('data-routed-state="DENIED"');
    expect(markup).not.toContain("data-surface-primitive");
  });
});
