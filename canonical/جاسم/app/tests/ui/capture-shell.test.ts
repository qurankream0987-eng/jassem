import { describe, it, expect } from "vitest";
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * UI-2.1 — the REAL assembled product shell, in a real browser.
 *
 * Gated, because it needs a running dev server and a browser:
 *
 *   JASIM_SHELL_URL=http://127.0.0.1:5731 JASIM_SHELL_OUT=<dir> \
 *     npx vitest run tests/ui/capture-shell.test.ts
 *
 * AUTH. The session comes from the product's own `/api/runtime/session`
 * endpoint, which issues a dev token only when `NODE_ENV !== "production"` and
 * otherwise demands a real cookie session. No bypass is added and none could
 * exist in production — the fail-closed branch is the pre-existing one. The
 * token is set as the ordinary `jasim_session` cookie, so the browser
 * authenticates exactly as a person would.
 */
const BASE = process.env.JASIM_SHELL_URL;
const OUT = process.env.JASIM_SHELL_OUT;
const VIEWPORTS = [
  { id: "mobile", width: 390, height: 844, isMobile: true },
  { id: "tablet", width: 834, height: 1112, isMobile: false },
  { id: "desktop", width: 1440, height: 900, isMobile: false },
];

describe.skipIf(!BASE || !OUT)("UI-2.1 full shell", () => {
it("captures the real authenticated shell", async () => {
  mkdirSync(OUT!, { recursive: true });
  // The session comes from the product's own endpoint, which issues a dev
  // token only when NODE_ENV !== production and requires a real cookie session
  // otherwise. No bypass is added; the fail-closed path already exists.
  const res = await fetch(`${BASE!}/api/runtime/session`, { method: "POST" });
  const { token } = (await res.json()) as { token: string };
  expect(token, "dev session token").toBeTruthy();

  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const report: string[] = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
      locale: "ar",
    });
    await ctx.addCookies([
      { name: "jasim_session", value: token, url: BASE!, httpOnly: true, sameSite: "Lax" },
    ]);
    const page = await ctx.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 140)); });
    await page.goto(`${BASE!}/`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);

    const measured = await page.evaluate(() => {
      const el = document.documentElement;
      const blurred = [...document.querySelectorAll("*")].filter((n) => {
        const s = getComputedStyle(n as Element);
        return s.backdropFilter !== "none" && s.backdropFilter !== "";
      }).length;
      const composer = document.querySelector("textarea, input[type=text]");
      const composerBox = composer?.getBoundingClientRect();
      return {
        viewportWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        dir: el.getAttribute("dir"),
        blurredLayers: blurred,
        composerVisible: Boolean(composerBox && composerBox.width > 0 && composerBox.height > 0),
        composerPlaceholder: (composer as HTMLTextAreaElement | null)?.placeholder ?? null,
        composerBottom: composerBox ? Math.round(composerBox.bottom) : null,
        innerHeight: window.innerHeight,
      };
    });
    report.push(`${vp.id}: ${JSON.stringify(measured)}`);
    if (consoleErrors.length) report.push(`${vp.id} console: ${consoleErrors.slice(0, 3).join(" ;; ")}`);

    await page.screenshot({ path: path.join(OUT!, `A-empty.${vp.id}.png`), fullPage: false });

    // A real turn through the real composer. No model provider is configured in
    // this environment, so what comes back is a truthful blocked state — which
    // is scenario G, captured for free and honestly.
    const composer = page.locator("textarea").first();
    if (await composer.count()) {
      await composer.fill("اعرض لي السائق");
      await composer.press("Enter");
      await page.waitForTimeout(6000);
      await page.screenshot({ path: path.join(OUT!, `G-after-turn.${vp.id}.png`), fullPage: false });
      const after = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        text: document.body.innerText.slice(0, 400),
      }));
      report.push(`${vp.id} after-turn: overflow=${after.scrollWidth - after.viewportWidth}`);
      report.push(`${vp.id} after-turn text: ${after.text.replace(/\n+/g, " | ").slice(0, 280)}`);
    }
    await ctx.close();
  }
  await browser.close();
  writeFileSync(path.join(OUT!, "MEASURED.txt"), report.join("\n"), "utf8");
  console.log(report.join("\n"));
}, 300_000);
});
