/**
 * JASIM — Web and Mobile are two bodies for one meaning.
 *
 * They may draw a table very differently. They may not disagree about what a
 * table IS, which primitives exist, or what the numbers are allowed to claim.
 * The failure this file exists to catch is the quiet one: the server starts
 * sending a field, the web renders it, and the phone silently shows less than
 * the person asked for.
 *
 * The mobile files import `react-native`, which this suite cannot load, so the
 * parity checks read the mobile source and compare it against what the server
 * actually produces — the same convention the Living Objects parity test uses.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chartSurface, isRefusal, tableSurface } from "../../api/runtime/dataset-presentation";
import type { CanonicalDataset } from "../../api/runtime/canonical-dataset";
import { TRUSTED_SURFACE_PRIMITIVES } from "../../src/components/jasim-core/TurnSurface";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), "../../../", path), "utf8");
}

const mobileSurface = source("artifacts/jasim-mobile/components/DatasetSurface.tsx");
const mobileTurnSurface = source("artifacts/jasim-mobile/components/MobileTurnSurface.tsx");
const mobileChat = source("artifacts/jasim-mobile/app/index.tsx");

/**
 * Comments removed.
 *
 * «مباشر» appears in both files — in a comment saying it must never be shown.
 * A check that cannot tell the rule from the violation would force the rule to
 * be deleted to pass, which is exactly backwards.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The keys of an `export interface X { ... }` declaration, in source order. */
function interfaceKeys(text: string, name: string): string[] {
  const start = text.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`no interface ${name}`);
  const open = text.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const body = text.slice(open + 1, end);
  return [...body.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\??:/gm)].map((match) => match[1]);
}

/** The keys of the `TRUSTED_SURFACES` registry literal. */
function registryKeys(text: string): string[] {
  const start = text.indexOf("const TRUSTED_SURFACES");
  const open = text.indexOf("{", text.indexOf("=", start));
  let depth = 0;
  let end = open;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const body = text.slice(open + 1, end);
  return [...body.matchAll(/^\s{2}([A-Z_]+):/gm)].map((match) => match[1]);
}

const dataset: CanonicalDataset = {
  datasetId: "ds_parity",
  revision: 1,
  columns: [
    { key: "status", label: "الحالة", type: "ENUM" },
    { key: "amount", label: "القيمة", type: "NUMBER" },
  ],
  rows: [{ ref: "r1", position: 1, values: { status: "منجزة", amount: 10 } }],
  view: {
    fields: ["status", "amount"],
    sort: [],
    filters: [],
    window: { limit: 50, offset: 0 },
    totalRows: 4_000,
  },
  provenance: {
    resourceId: "test",
    sourceId: "internal-runtime",
    sourceKind: "INTERNAL_RUNTIME",
    observedAt: "2026-09-20T00:00:00.000Z",
    generatedAt: "2026-09-20T00:00:00.000Z",
  },
  freshness: "UNKNOWN",
  ownerScope: "owner-a",
};

describe("one runtime, two bodies", () => {
  it("both platforms know exactly the same primitives", () => {
    expect(registryKeys(mobileTurnSurface).sort()).toEqual([...TRUSTED_SURFACE_PRIMITIVES].sort());
  });

  it("the phone understands every field the server puts in a TABLE", () => {
    const keys = interfaceKeys(mobileSurface, "TableSurfaceData");
    for (const key of Object.keys(tableSurface(dataset))) {
      expect(keys).toContain(key);
    }
  });

  it("the phone understands every field the server puts in a CHART", () => {
    const chart = chartSurface(dataset, {
      form: "BAR",
      categoryField: "status",
      aggregation: "COUNT",
    });
    if (isRefusal(chart)) throw new Error("expected a chart");
    const keys = interfaceKeys(mobileSurface, "ChartSurfaceData");
    for (const key of Object.keys(chart)) {
      expect(keys).toContain(key);
    }
  });

  it("the phone carries scope, so it can refuse to imply a whole dataset", () => {
    // The server marked this chart PARTIAL_WINDOW (one row of four thousand).
    const chart = chartSurface(dataset, {
      form: "BAR",
      categoryField: "status",
      aggregation: "COUNT",
    });
    if (isRefusal(chart)) throw new Error("expected a chart");
    expect(chart.scope).toBe("PARTIAL_WINDOW");
    expect(mobileSurface).toContain("PARTIAL_WINDOW");
    expect(mobileSurface).toContain("وليس على");
  });

  it("an unknown primitive is a named notice on the phone too", () => {
    expect(mobileTurnSurface).toContain("لا يمكن عرض هذا النوع من الأسطح");
  });

  it("neither mobile surface claims live data", () => {
    expect(withoutComments(mobileSurface)).not.toContain("مباشر");
    expect(withoutComments(mobileTurnSurface)).not.toContain("مباشر");
    expect(mobileSurface).toContain("حسب آخر قراءة");
  });

  it("a wide table scrolls rather than silently dropping columns", () => {
    // Showing four of nine columns without saying so is showing a person less
    // than they asked for and telling them it is everything.
    expect(mobileSurface).toContain("ScrollView horizontal");
    expect(mobileSurface).not.toMatch(/columns\.slice\(/);
  });

  it("the phone reads its numbers aloud, so identity never depends on colour", () => {
    expect(mobileSurface).toContain("accessibilityLabel");
  });

  it("the phone mounts the surface on the turn, inside the conversation", () => {
    // Not a panel, not a tab: the same place the web puts it.
    expect(mobileChat).toContain("<MobileTurnSurface surface={message.surface} />");
  });

  it("a routed turn is a notice on the phone too, not an ordinary bubble", () => {
    // The state travels, so UNAVAILABLE and DENIED stay distinguishable.
    expect(mobileChat).toContain("<MobileRoutedNotice");
    expect(mobileChat).toContain("state={message.routed.state}");
    expect(mobileTurnSurface).toContain("testID={`routed-${state ?? 'STATE'}`}");
  });

  it("neither platform gained a domain surface", () => {
    // DOMAIN_SURFACES_ADDED = 0.
    for (const forbidden of ["SalesChart", "InventoryTable", "SalesTable", "OrdersChart"]) {
      expect(mobileSurface).not.toContain(forbidden);
      expect(mobileTurnSurface).not.toContain(forbidden);
    }
  });
});
