require("node:fs").mkdirSync("test-results", { recursive: true });
const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3000");
  await page.screenshot({
    path: "test-results/hamava-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "ساخت روم", exact: true }).click();
  await page.locator("input[name=nickname]").fill("سارا");
  await page.locator("input[name=name]").fill("شب‌های آرام");
  await page.locator(".modal .primary").click();
  await page
    .getByRole("heading", { name: "شب‌های آرام", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "تنظیمات روم" }).click();
  await page.locator("input[name=guestUpload]").check();
  await page.getByRole("button", { name: "ذخیرهٔ تنظیمات" }).click();
  await page.locator(".modal").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/hamava-mobile.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow || errors.length)
    throw Error(JSON.stringify({ overflow, errors }));
  console.log("Desktop/mobile rendering and create/settings flow passed");
  await browser.close();
})();
