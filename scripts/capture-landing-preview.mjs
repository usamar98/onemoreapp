import { chromium } from "@playwright/test";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

// Always use a fresh anonymous context: marketing assets must never contain user data.
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  await page.goto(
    (process.env.TEST_BASE_URL || "http://127.0.0.1:3000") +
      (process.env.CHAPTER_PREVIEW_ROUTE || "/demo"),
  );
  await page.locator(".project-card").first().waitFor();
  const workspace = await (
    await page.request.get(new URL("/api/workspace", page.url()).href)
  ).json();
  if (
    (await page.locator(".project-card").count()) !== 6 ||
    workspace.user !== null
  )
    throw new Error(
      "Capture is restricted to the anonymous example workspace.",
    );
  await page.evaluate(() => document.fonts.ready);
  await mkdir("public/images", { recursive: true });
  const png = await page.screenshot({ animations: "disabled" });
  await sharp(png)
    .webp({ quality: 88 })
    .toFile("public/images/dashboard-preview.webp");
  console.log("Saved anonymous example workspace: 1440 × 960.");
} finally {
  await browser.close();
}
