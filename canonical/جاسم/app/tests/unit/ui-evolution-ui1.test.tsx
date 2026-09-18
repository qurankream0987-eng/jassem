import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UI_SCENARIOS } from "../ui/ui-scenarios";
import { captureEvidence, webMarkup } from "../ui/capture-evidence";
import { cssVariables, palette as tokenPalette, tokens } from "../../../../../lib/jasim-design-tokens/tokens";
import { palette as mobilePalette } from "../../../../../artifacts/jasim-mobile/constants/colors";
import { MOBILE_PRESENTATION_REGISTRY } from "../../../../../artifacts/jasim-mobile/lib/mobile-presentation";

/**
 * UI EVOLUTION PHASE UI-1 — acceptance.
 *
 * The brief's Part 27 asks for a UI/UX review. A review that lives only in a
 * report decays the moment someone edits a component; these are the parts of it
 * that can be stated as a rule, so they keep holding.
 */

const APP_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(APP_ROOT, "../../..");
const read = (relative: string) => readFileSync(path.join(APP_ROOT, relative), "utf8");

const INDEX_CSS = read("src/index.css");
const HOME = read("src/pages/Home.tsx");
const PRESENTATION_RENDERER = read("src/components/jasim-core/PresentationRenderer.tsx");
const markupFor = (id: string) => webMarkup(UI_SCENARIOS.findIndex((s) => s.id === id));
const ALL_MARKUP = UI_SCENARIOS.map((_, index) => webMarkup(index));

describe("UI-1 — evidence capture", () => {
  const phase = process.env.JASIM_UI_EVIDENCE;
  if (phase) {
    it(`captures ${phase} evidence`, () => {
      expect(captureEvidence(phase)).toContain(phase);
    });
  }
  it("every scenario renders", () => {
    expect(ALL_MARKUP.every((markup) => markup.length > 0)).toBe(true);
  });
});

describe("UI-1 — design tokens have ONE source", () => {
  it("index.css declares exactly what cssVariables() produces", () => {
    // Web and Mobile previously held two hand-maintained copies of the same
    // palette. Same values, no mechanism — so the first divergence would have
    // gone unnoticed until someone compared screenshots.
    for (const [name, value] of Object.entries(cssVariables())) {
      expect(INDEX_CSS, `missing ${name}`).toContain(`${name}: ${value};`);
    }
  });

  it("the mobile palette matches the token source", () => {
    for (const key of ["text", "text2", "cyan", "blue", "purple", "green", "red", "amber"] as const) {
      expect(mobilePalette[key], `mobile palette.${key}`).toBe(tokenPalette[key]);
    }
  });

  it("the motion token matches the workspace exit duration it has to agree with", async () => {
    const { WORKSPACE_EXIT_DURATION_MS } = await import(
      "../../src/components/jasim-core/workspacePresentationVisual"
    );
    expect(tokens.duration.surface).toBe(WORKSPACE_EXIT_DURATION_MS);
  });
});

describe("UI-1 — no domain architecture, no fake data", () => {
  it("DOMAIN_SPECIFIC_UI_COMPONENTS_ADDED = 0", () => {
    // Generic primitives only. A CarCard is a business decision wearing a
    // component's clothes: once it exists, every new domain needs its own.
    const forbidden = /\b(Car|Job|Hotel|Driver|Restaurant|Flight|Property|Doctor|Course)(Card|Surface|Panel|View|Screen)\b/;
    const dirs = [
      path.join(APP_ROOT, "src/components/jasim-core"),
      path.join(APP_ROOT, "src/lib"),
      path.join(REPO_ROOT, "artifacts/jasim-mobile/components"),
      path.join(REPO_ROOT, "artifacts/jasim-mobile/lib"),
    ];
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of listFiles(dir)) {
        if (forbidden.test(path.basename(file))) offenders.push(path.relative(REPO_ROOT, file));
        else if (forbidden.test(readFileSync(file, "utf8"))) {
          offenders.push(`${path.relative(REPO_ROOT, file)} (reference)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("FAKE_PRODUCTION_DATA_ADDED = 0 — fixtures stay in tests/", () => {
    // Every scenario string lives in tests/ui/ui-scenarios.ts. If one turned up
    // in shipped source, a fixture would have become content.
    const fixtureStrings = ["الخيار الأول", "الخيار الثاني", "المرجع الأول", "الموضوع المتتبَّع"];
    const shipped = [
      ...listFiles(path.join(APP_ROOT, "src/components/jasim-core")),
      ...listFiles(path.join(APP_ROOT, "src/lib")),
      ...listFiles(path.join(REPO_ROOT, "artifacts/jasim-mobile/lib")),
      ...listFiles(path.join(REPO_ROOT, "artifacts/jasim-mobile/components")),
    ];
    const offenders = shipped.filter((file) => {
      const source = readFileSync(file, "utf8");
      return fixtureStrings.some((value) => source.includes(value));
    });
    expect(offenders).toEqual([]);
  });

  it("no hardcoded coordinates anywhere in shipped UI source", () => {
    const shipped = [
      ...listFiles(path.join(APP_ROOT, "src/components/jasim-core")),
      ...listFiles(path.join(REPO_ROOT, "artifacts/jasim-mobile/components")),
    ];
    const coordinate = /\b(lat|lng|latitude|longitude)\s*[:=]\s*-?\d+\.\d+/;
    const offenders = shipped.filter((file) => coordinate.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("UI-1 — a surface never claims more than it knows", () => {
  it("the English placeholder title is gone from every surface", () => {
    // It used to head all thirteen, including the error states.
    expect(ALL_MARKUP.filter((markup) => markup.includes("JASIM presentation"))).toEqual([]);
  });

  it("no surface wears a success-coloured 'Verified' badge", () => {
    expect(ALL_MARKUP.filter((markup) => markup.includes(">Verified<"))).toEqual([]);
  });

  it("blocked states are marked blocked, and announced", () => {
    for (const id of ["K-provider-unavailable", "L-model-unavailable"]) {
      const markup = markupFor(id);
      expect(markup, id).toContain('data-tone="blocked"');
      expect(markup, id).toContain('role="alert"');
      expect(markup, id).not.toContain('data-tone="success"');
      // And it must not read as merely "no results".
      expect(markup, id).not.toContain("لا توجد نتائج");
    }
  });

  it("an empty result is not dressed as a failure", () => {
    const markup = markupFor("M-empty-state");
    expect(markup).not.toContain('data-tone="blocked"');
    expect(markup).not.toContain('data-tone="danger"');
    expect(markup).not.toContain('role="alert"');
  });

  it("a stale observation renders no position", () => {
    const stale = markupFor("F-map-stale");
    expect(stale).toContain("مشاهدة قديمة");
    // The decisive check: the fresh scenario's coordinate value must not appear
    // on the stale one under any formatting.
    expect(stale).not.toMatch(/"(lat|lng)"\s*:/);
    expect(stale).not.toContain("coordinates");
  });

  it("a fresh observation says so, in words and with a glyph", () => {
    const fresh = markupFor("E-map-fresh");
    expect(fresh).toContain("مشاهدة حديثة");
    expect(fresh).toContain('class="jasim-state-icon"');
  });

  it("no status is communicated by colour alone", () => {
    // Every state surface carries a glyph and a sentence; the tone token is the
    // third signal. Greyscale, or colour-blind, the state is still legible.
    for (const markup of ALL_MARKUP) {
      for (const match of markup.matchAll(/data-tone="[a-z]+"/g)) {
        expect(markup.slice(match.index)).toContain("jasim-state-label");
      }
    }
  });
});

describe("UI-1 — generated surfaces", () => {
  it("CHOICE renders its options — the empty-choice bug stays fixed", () => {
    // `decidePresentation` emits the option set as `data.candidates`; the
    // renderer read `data.options`. Nothing bridged them, so every CHOICE was
    // an empty grid with a lone button.
    const markup = markupFor("D-ambiguous-choice");
    expect(markup).toContain("المرجع الأول");
    expect(markup).toContain("المرجع الثاني");
    expect(markup).not.toMatch(/class="grid gap-2"><\/div>/);
  });

  it("the CHOICE bridge carries only what is needed to pick", () => {
    // A reference key and a label. Not the candidate's other fields.
    expect(PRESENTATION_RENDERER).toContain("function choiceOptions");
    expect(PRESENTATION_RENDERER).toMatch(/id: reference, value: reference, label, ordinal/);
  });

  it("plain conversation is not a card", () => {
    const markup = markupFor("A-plain-conversation");
    expect(markup).toContain("jasim-surface-plain");
    expect(markup).not.toContain("jasim-surface-body");
    expect(markup).not.toContain("jasim-trust-chip");
  });

  it("a working surface still gets its pane", () => {
    for (const id of ["D-ambiguous-choice", "G-approval-required"]) {
      expect(markupFor(id), id).toContain("jasim-surface-body");
    }
  });

  it("the decision layer still chooses the primitive — the renderer only maps it", () => {
    expect(UI_SCENARIOS.find((s) => s.id === "D-ambiguous-choice")!.presentation.primitive).toBe("CHOICE");
    expect(UI_SCENARIOS.find((s) => s.id === "G-approval-required")!.presentation.primitive).toBe("APPROVAL");
  });
});

describe("UI-1 — conversation-first", () => {
  it("the workspace column no longer outweighs the conversation", () => {
    // It was lg:w-[min(62vw,47rem)] — the generated surface and the Living
    // Objects rail together took roughly two thirds of a desktop screen, with
    // the conversation squeezed into what was left.
    const workspaceWidth = HOME.match(/className="flex min-h-0 w-full shrink-0[^"]*lg:w-\[min\((\d+)vw/);
    expect(workspaceWidth).toBeTruthy();
    expect(Number(workspaceWidth![1])).toBeLessThan(50);
  });

  it("Living Objects are a rail, not a second dashboard", () => {
    const railWidth = HOME.match(/lg:w-\[min\((\d+)vw,11rem\)\]/);
    expect(railWidth).toBeTruthy();
    expect(Number(railWidth![1])).toBeLessThanOrEqual(14);
  });

  it("there is no service-category grid or launcher", () => {
    // JASIM must never ask which application you want before asking what you
    // want to happen.
    expect(HOME).not.toMatch(/الخدمات|categor(y|ies)|serviceGrid|launcher/i);
  });
});

describe("UI-1 — RTL and typography", () => {
  it("direction is set once, at the root", () => {
    expect(HOME).toContain('dir="rtl"');
    expect(HOME).toContain('lang="ar"');
  });

  it("message alignment uses logical properties, so RTL is not mirrored wrongly", () => {
    expect(INDEX_CSS).toContain("margin-inline-start: auto");
    // No physical-side alignment declaration survives anywhere in the sheet.
    expect(declarations(INDEX_CSS)).not.toMatch(/margin-(left|right):\s*auto/);
  });

  it("the sidebar uses a logical side", () => {
    expect(HOME).toContain("inset-y-0 start-0");
    expect(HOME).not.toContain("inset-y-0 left-0");
  });

  it("the caption size floor is 12px, not 10", () => {
    expect(cssVariables()["--jasim-font-caption"]).toBe("12px");
    expect(INDEX_CSS).toMatch(/\.bubble-hint[^{]*,[^{]*\.msg-time\s*\{\s*font-size: var\(--jasim-font-caption\)/);
  });

  it("the surfaces UI-1 rewrote carry no sub-12px hardcoded sizes", () => {
    const rewritten = read("src/lib/runtime-state-copy.ts");
    expect(rewritten).not.toMatch(/text-\[(8|9|10|11)px\]/);
  });
});

describe("UI-1 — accessibility", () => {
  it("motion honours the system preference", () => {
    expect(INDEX_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(INDEX_CSS).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  it("keyboard focus is visible, globally rather than per component", () => {
    expect(INDEX_CSS).toContain(":focus-visible");
    expect(INDEX_CSS).toContain("outline: 2px solid var(--jasim-border-focus)");
  });

  it("actions meet a 44px touch target", () => {
    expect(INDEX_CSS).toMatch(/\.jasim-action\s*\{[^}]*min-height:\s*44px/);
  });

  it("pinch-zoom and scrolling are no longer blocked outright", () => {
    expect(declarations(INDEX_CSS)).not.toMatch(/touch-action:\s*none/);
  });

  it("a waiting state is announced to assistive technology", () => {
    const renderer = read("src/components/jasim-core/SchemaRenderer.tsx");
    expect(renderer).toContain('role="status"');
    expect(renderer).toContain('aria-live="polite"');
  });

  it("decorative glyphs are hidden from screen readers", () => {
    for (const markup of ALL_MARKUP) {
      for (const match of markup.matchAll(/class="jasim-state-icon[^"]*"/g)) {
        expect(markup.slice(match.index, match.index + 120)).toContain('aria-hidden="true"');
      }
    }
  });
});

describe("UI-1 — truthful waiting states", () => {
  it("no state promises a percentage", () => {
    const renderer = read("src/components/jasim-core/SchemaRenderer.tsx");
    const copy = read("src/lib/runtime-state-copy.ts");
    // No progress value, and no field in which one could be reported.
    expect(copy).not.toMatch(/\b(percent|progress|ratio|completed\s*\/)\s*[:=]/i);
    // The loading surface is indeterminate by construction.
    expect(renderer).toContain("RUNTIME_PROGRESS_COPY[kind]");
  });

  it("waiting states are distinguishable from one another", async () => {
    const { RUNTIME_PROGRESS_COPY } = await import("../../src/lib/runtime-state-copy");
    const labels = Object.values(RUNTIME_PROGRESS_COPY).map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(RUNTIME_PROGRESS_COPY.WAITING_FOR_PROVIDER.label).not.toBe(
      RUNTIME_PROGRESS_COPY.UNDERSTANDING.label,
    );
  });

  it("an unknown runtime code gets no reassuring default", async () => {
    const { runtimeStateCopy } = await import("../../src/lib/runtime-state-copy");
    expect(runtimeStateCopy("SOMETHING_NOBODY_HAS_SEEN_YET")).toBeUndefined();
  });

  it("INCONCLUSIVE is neither success nor failure", async () => {
    const { runtimeStateCopy } = await import("../../src/lib/runtime-state-copy");
    const copy = runtimeStateCopy("INCONCLUSIVE")!;
    expect(copy.tone).not.toBe("success");
    expect(copy.guidance).toContain("لا تفترض النجاح");
  });
});

describe("UI-1 — Web/Mobile parity", () => {
  it("every primitive the decision layer emits in these scenarios renders on mobile too", () => {
    const unsupported = UI_SCENARIOS.map((scenario) => scenario.presentation.primitive).filter(
      (primitive) => !MOBILE_PRESENTATION_REGISTRY[primitive],
    );
    expect(unsupported).toEqual([]);
  });

  it("SMART_BUBBLE — a Living Object — is renderable on mobile", () => {
    // It was not. Durable monitors rendered on the web and fell through to
    // "unsupported" on the device where people actually watch long-running things.
    expect(MOBILE_PRESENTATION_REGISTRY.SMART_BUBBLE).toBeTruthy();
  });

  it("the mobile registry still fails closed for genuinely unsupported primitives", () => {
    for (const primitive of ["WORKSPACE", "EXTERNAL_ACTION", "CHAT"] as const) {
      expect(MOBILE_PRESENTATION_REGISTRY[primitive]).toBeUndefined();
    }
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

/** CSS with comments removed, so prose about a rule is not mistaken for one. */
function declarations(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function listFiles(dir: string): string[] {
  const { readdirSync, statSync, existsSync } = require("node:fs") as typeof import("node:fs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

// ── UI-2 — invariants established by looking at real pixels ────────────────

describe("UI-2 — defects found by rendering, not by reading CSS", () => {
  it("a tracker and its map are ONE surface, not a stack of panes", () => {
    // A TRACKER with a MAP child rendered as separately bordered, blurred and
    // badged panes — three of them on a phone — for a single tracking answer.
    const markup = markupFor("E-map-fresh");
    // Structurally: children now live INSIDE the parent's body rather than as
    // siblings stacked after it. Visually: the stylesheet strips their border,
    // blur, shadow and padding so the result is one pane with parts — which the
    // screenshots in docs/ui/evidence/ui2/ show and markup cannot.
    const bodyIndex = markup.indexOf("jasim-surface-body");
    const childrenIndex = markup.indexOf("jasim-surface-children");
    expect(childrenIndex).toBeGreaterThan(bodyIndex);
    expect(INDEX_CSS).toContain(".jasim-surface-children > * > .jasim-surface");
    expect(INDEX_CSS).toMatch(/\.jasim-surface-children[\s\S]{0,240}?backdrop-filter: none/);
  });

  it("a child does not repeat its parent's heading", () => {
    // Parent TRACKER and child TRACKER took the same default title, so the
    // answer read «التتبّع» twice, one under the other.
    const markup = markupFor("E-map-fresh");
    expect((markup.match(/التتبّع/g) ?? []).length).toBe(1);
  });

  it("the always-true trust chip is gone from every surface", () => {
    // It appeared on all thirteen — three times on one mobile MAP — and said
    // the same thing every time, which is the definition of decoration.
    expect(ALL_MARKUP.filter((markup) => markup.includes("jasim-trust-chip"))).toEqual([]);
  });

  it("a fresh observation renders its ACTUAL coordinate", () => {
    // The map read `data.coordinates` while the decision layer emits
    // `data.markers[0].coordinates`, so a FRESH position rendered
    // "لا يتوفّر موقع" — JASIM claiming not to know something it knew.
    const markup = markupFor("E-map-fresh");
    expect(markup).toContain("jasim-map-point");
    expect(markup).toContain("0.00000, 0.00000");
    expect(markup).not.toContain("لا يتوفّر موقع");
  });

  it("no surface renders a grey box labelled 'Map View'", () => {
    // A frame around an absence looks exactly like a map still loading.
    expect(ALL_MARKUP.filter((markup) => markup.includes("Map View"))).toEqual([]);
  });

  it("a surface with nothing to say renders no empty status pill", () => {
    // `??` let an empty string through, so a parent that only holds children
    // drew a bordered box containing nothing.
    const markup = markupFor("E-map-fresh");
    expect(markup).not.toMatch(/jasim-state-label"><\/p>/);
  });

  it("every user-visible action label is Arabic", () => {
    for (const english of [">Select<", ">Approve<", ">Reject<", ">Continue<"]) {
      expect(ALL_MARKUP.filter((markup) => markup.includes(english)), english).toEqual([]);
    }
    expect(markupFor("D-ambiguous-choice")).toContain("اختيار");
    expect(markupFor("G-approval-required")).toContain("أوافق");
  });

  it("an approval does not look like an ordinary choice", () => {
    // Both were the same filled cyan button — the muscle memory built by
    // picking between two harmless options carried into authorising an
    // external effect.
    expect(markupFor("G-approval-required")).toContain("jasim-action--consequential");
    expect(markupFor("D-ambiguous-choice")).not.toContain("jasim-action--consequential");
  });

  it("an approval says why it stopped", () => {
    expect(markupFor("G-approval-required")).toContain("لن يُنفَّذ شيء قبل موافقتك");
  });

  it("a choice shows ordinals, never the internal reference handle", () => {
    // `ref-1` was printed beside each label as if it were content. The ordinal
    // is what a person says next turn; the handle travels in a data attribute.
    const markup = markupFor("D-ambiguous-choice");
    expect(markup).toContain("jasim-choice-ordinal");
    expect(markup).toContain('data-reference="ref-1"');
    expect(markup).not.toMatch(/>ref-1</);
  });
});
