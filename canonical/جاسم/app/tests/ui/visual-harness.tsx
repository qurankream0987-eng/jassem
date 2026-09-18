import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PresentationRenderer } from "../../src/components/jasim-core/PresentationRenderer";
import { UI_SCENARIOS } from "./ui-scenarios";

/**
 * UI-2 — a project-local visual harness that produces REAL PIXELS.
 *
 * UI-1's evidence was server-rendered markup, and its own report said plainly
 * that markup cannot show contrast, spacing or motion. This closes that gap
 * without touching product architecture to do it:
 *
 *   the REAL compiled stylesheet   (dist/assets/*.css — Tailwind + index.css)
 * + the REAL component output      (PresentationRenderer over decidePresentation)
 * + the REAL typeface             (Noto Sans Arabic, as the product loads)
 * + a REAL browser                (headless Chromium, --screenshot)
 *
 * WHAT IT IS NOT. It renders a single surface on the page background, not the
 * assembled application shell — no sidebar, no composer, no workspace column.
 * Those need the running app, and the shell shots are captured separately from
 * the dev server. Each screenshot's filename says which kind it is, and the
 * report does not blur the two.
 *
 * The harness writes HTML only. Screenshotting is a separate step so that a
 * failure to launch a browser degrades to "no pixels" rather than to a silently
 * empty run.
 */

const APP_ROOT = path.resolve(__dirname, "../..");

/** Viewports: a phone, a tablet, and a laptop. Part 19 asks for all three. */
export const VIEWPORTS = [
  { id: "mobile", width: 390, height: 844 },
  { id: "tablet", width: 834, height: 1112 },
  { id: "desktop", width: 1440, height: 900 },
] as const;

export type ViewportId = (typeof VIEWPORTS)[number]["id"];

/** The compiled product stylesheet, not the source. */
export function builtStylesheet(): string {
  const assets = path.join(APP_ROOT, "dist/assets");
  if (!existsSync(assets)) {
    throw new Error("dist/assets missing — run `npx vite build` before capturing visuals.");
  }
  const css = readdirSync(assets).find((file) => file.endsWith(".css"));
  if (!css) throw new Error("no compiled stylesheet in dist/assets");
  return readFileSync(path.join(assets, css), "utf8");
}

/**
 * The real typeface, served from a local directory.
 *
 * Without it the screenshots would render Arabic in whatever fallback the
 * container happens to have, and every judgement about line height, weight and
 * density would be about the wrong font — which is worse than no screenshot,
 * because it looks authoritative.
 */
function fontFace(fontDir?: string): string {
  if (!fontDir || !existsSync(path.join(fontDir, "fonts.css"))) {
    return `/* NO LOCAL FONT — screenshots use a fallback face. Judgements about
             typography from these images are NOT reliable. */`;
  }
  return readFileSync(path.join(fontDir, "fonts.css"), "utf8");
}

export function scenarioPage(input: {
  markup: string;
  viewport: (typeof VIEWPORTS)[number];
  label: string;
  fontDir?: string;
}): string {
  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${input.viewport.width}, initial-scale=1">
<style>${fontFace(input.fontDir)}</style>
<style>${builtStylesheet()}</style>
<style>
  /* Harness chrome only. It reproduces the page context a surface sits in —
     the app background and the conversation column's width — and nothing else.
     No colour, spacing or type value is invented here; they all come from the
     compiled stylesheet above. */
  html, body { height: auto; overflow: visible; background: var(--jasim-bg); }
  body { font-family: 'Noto Sans Arabic', system-ui, sans-serif; margin: 0; }
  .harness-page { padding: 24px; min-height: ${input.viewport.height}px; box-sizing: border-box; }
  .harness-column { max-width: 720px; margin-inline: auto; }
  .harness-label {
    font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
    color: var(--jasim-text-tertiary); margin-bottom: 16px; opacity: .55;
  }
</style>
</head>
<body>
  <div class="harness-page">
    <div class="harness-column">
      <div class="harness-label">${input.label}</div>
      ${input.markup}
    </div>
  </div>
</body>
</html>`;
}

/** Writes one HTML page per (scenario × viewport). Returns the page paths. */
export function writeScenarioPages(outDir: string, fontDir?: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  UI_SCENARIOS.forEach((scenario, index) => {
    const markup = renderToStaticMarkup(
      React.createElement(PresentationRenderer, { presentation: scenario.presentation }),
    );
    for (const viewport of VIEWPORTS) {
      const file = path.join(outDir, `${scenario.id}.${viewport.id}.html`);
      writeFileSync(
        file,
        scenarioPage({
          markup,
          viewport,
          label: `${scenario.id} · ${scenario.presentation.primitive} · ${viewport.id}`,
          fontDir,
        }),
        "utf8",
      );
      written.push(file);
    }
    void index;
  });
  return written;
}
