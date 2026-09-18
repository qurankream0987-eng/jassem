import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VIEWPORTS, writeScenarioPages } from "./visual-harness";

/**
 * UI-2 — real-pixel capture, behind an explicit gate.
 *
 * It launches a browser and writes PNGs, so it must never run as part of an
 * ordinary test pass: a suite that shells out to Chromium on every push is a
 * suite that breaks on the first machine without one. Gate + a stated reason,
 * the same shape as the live-model gate from Wave 2.1.
 *
 *   JASIM_VISUAL_CAPTURE=before npx vitest run tests/ui/capture-visuals.test.ts
 *   JASIM_VISUAL_CAPTURE=after  npx vitest run tests/ui/capture-visuals.test.ts
 *
 * Prerequisites, and why each one matters:
 *   `npx vite build`            — the capture uses the COMPILED stylesheet, so
 *                                 an un-built dist would screenshot stale CSS.
 *   JASIM_VISUAL_FONTS=<dir>    — a directory holding `fonts.css` and the woff2
 *                                 files. Without it Arabic renders in a
 *                                 fallback face and every typographic
 *                                 judgement from the images is about the wrong
 *                                 font, which is worse than no image.
 *   JASIM_VISUAL_BROWSER=<path> — a Chromium executable.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const phase = process.env.JASIM_VISUAL_CAPTURE;

describe.skipIf(!phase)("UI-2 visual capture", () => {
  it(
    `captures ${phase ?? "(disabled)"} screenshots`,
    async () => {
      const { chromium } = await import("playwright-core");
      const outRoot = path.join(REPO_ROOT, "docs/ui/evidence/ui2", phase!);
      const pagesDir = path.join(REPO_ROOT, ".local/ui2-pages", phase!);
      mkdirSync(outRoot, { recursive: true });

      writeScenarioPages(pagesDir, process.env.JASIM_VISUAL_FONTS);

      const browser = await chromium.launch({
        executablePath:
          process.env.JASIM_VISUAL_BROWSER ??
          "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
        args: ["--no-sandbox", "--disable-gpu"],
      });

      /**
       * Overflow is measured in the real layout engine rather than eyeballed.
       *
       * Worth keeping permanently: an earlier raw-Chromium harness appeared to
       * show every mobile surface clipped, and the "bug" was the screenshotter
       * mishandling the RTL scroll origin, not the product. A number from
       * `getBoundingClientRect` cannot make that mistake.
       */
      const overflows: string[] = [];
      for (const file of readdirSync(pagesDir).filter((name) => name.endsWith(".html")).sort()) {
        const base = file.replace(/\.html$/, "");
        const key = base.split(".").pop();
        const viewport = VIEWPORTS.find((entry) => entry.id === key) ?? VIEWPORTS[2]!;
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 2,
          isMobile: viewport.id === "mobile",
          hasTouch: viewport.id === "mobile",
          locale: "ar",
        });
        const page = await context.newPage();
        await page.goto(`file://${path.join(pagesDir, file)}`, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        const measured = await page.evaluate(() => ({
          viewportWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        if (measured.scrollWidth > measured.viewportWidth + 1) {
          overflows.push(`${base}: ${measured.scrollWidth} > ${measured.viewportWidth}`);
        }
        await page.screenshot({ path: path.join(outRoot, `${base}.png`), fullPage: true });
        await context.close();
      }
      await browser.close();

      writeFileSync(
        path.join(outRoot, "OVERFLOW.txt"),
        overflows.length > 0 ? overflows.join("\n") : "none — no surface exceeds its viewport\n",
        "utf8",
      );
      expect(overflows, "surfaces wider than their viewport").toEqual([]);
    },
    600_000,
  );
});
