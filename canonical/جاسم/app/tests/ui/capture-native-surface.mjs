import { chromium } from "playwright-core";
const OUT = process.env.OUT;
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--font-render-hinting=none"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "ar",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto("http://127.0.0.1:5742/", { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(9000);

// A dev-only LogBox overlay (react-native-web's findNodeHandle warning) sits
// over the app. Dismissing it is what a developer does; it is not the product.
for (const label of ["Dismiss", "Minimize"]) {
  const button = page.getByText(label, { exact: true });
  if (await button.count()) { await button.first().click(); await page.waitForTimeout(800); break; }
}
// The collapsed LogBox toast sits over the composer. Its close control is an
// unlabelled Pressable, so it is dismissed by position.
await page.mouse.click(307, 810).catch(() => {});
await page.waitForTimeout(600);

const report = { errors: errors.slice(0, 3), shots: [] };
async function shoot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    text: document.body.innerText.replace(/\n+/g, " | ").slice(0, 700),
  }));
  report.shots.push({ name, overflow: m.scrollWidth - m.clientWidth, text: m.text });
}

// A wheel over the conversation, the way a thumb would drag it. Setting
// `scrollTop` on the container does nothing: react-native-web's ScrollView
// owns the scroll position.
async function scrollBy(delta) {
  await page.mouse.move(195, 220);
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(900);
}

// Up a little, so the sentence above the table is in frame with it.
await scrollBy(-330);
await shoot("M-A-table.native-390");


// Up again, to the chart the table came back from.
// In VIEW, not merely in the DOM: every message is mounted, so a text search
// would stop at the first scroll and photograph the wrong turn.
for (let step = 0; step < 10; step += 1) {
  await scrollBy(-420);
  const box = await page.locator("text=العدد حسب الحالة").first().boundingBox();
  if (box && box.y > 40 && box.y + box.height < 500) break;
}
// The conversation region ends where the workspace panel begins, so the chart
// header being in view is not the same as the bars being in view.
await scrollBy(170);
await shoot("M-B-chart.native-390");
console.log(JSON.stringify(report, null, 1));
await browser.close();
