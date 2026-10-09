import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("docs/assets", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
await page.goto(process.env.PREVIEW_URL ?? "http://localhost:3000");
// eslint-disable-next-line no-undef -- executes in the browser, not Node.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
await page.screenshot({ path: "docs/assets/home-desktop.png", fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "docs/assets/home-mobile.png", fullPage: true });
await browser.close();
console.log("Screenshots captured from the real running application.");
