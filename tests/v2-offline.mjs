import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 1024, height: 768 },
  }),
  page = await context.newPage(),
  errors = [],
  passed = [];
page.on("pageerror", (e) => errors.push(String(e)));
const check = (s, v) => {
  assert.ok(v, s);
  passed.push(s);
};
try {
  await page.goto("http://127.0.0.1:4173");
  await page.waitForFunction(() => navigator.serviceWorker.controller, {
    timeout: 15000,
  });
  check(
    "Production shell and audio worklets are cached offline",
    await page.evaluate(async () => {
      const keys = await caches.keys(),
        cache = await caches.open(
          keys.find((k) => k.startsWith("gmc-9000-v2-")),
        );
      return (
        !!(await cache.match(new URL("crusher.js", location.href))) &&
        !!(await cache.match(new URL("capture.js", location.href)))
      );
    }),
  );
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('[data-trigger="0"]');
  await page.click('[data-trigger="0"]');
  await page.waitForFunction(() =>
    document.querySelector("#engine-state").textContent.includes("PLAYING"),
  );
  check(
    "Offline reload can initialize worklet and play sample",
    await page
      .locator('[data-pad="0"]')
      .evaluate((e) => e.classList.contains("playing")),
  );
  for (const [width, height] of [
    [1024, 768],
    [768, 1024],
    [1180, 820],
    [820, 1180],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(120);
    check(
      `All workflow controls fit ${width}×${height}`,
      await page.evaluate(() => {
        const r = document.querySelector("#app").getBoundingClientRect(),
          m = document.querySelector(".machine").getBoundingClientRect();
        return (
          r.top >= -1 &&
          r.bottom <= innerHeight + 1 &&
          document.documentElement.scrollWidth <= innerWidth + 1 &&
          Math.abs(m.width / m.height - 1.5) < 0.001
        );
      }),
    );
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page
    .getByRole("button", { name: "EDIT", exact: true })
    .last()
    .click()
    .catch(async () => page.locator('[data-screen="EDIT"]').first().click());
  await page.waitForSelector("#v2-wave");
  check(
    "Touch workflow editor is available offline",
    await page.locator("#v2-panel").evaluate((e) => e.open),
  );
  await page.screenshot({ path: "artifacts/V2-tablet.png" });
  check("No runtime errors", errors.length === 0);
  await fs.writeFile(
    "artifacts/v2-offline-results.json",
    JSON.stringify({ passed, errors }, null, 2),
  );
  console.log(passed.map((x) => "PASS " + x).join("\n"));
} finally {
  await browser.close();
}
