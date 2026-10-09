import { test, expect } from "@playwright/test";

const headline = "Manage, host, and share your side projects.";
test("public homepage renders without JavaScript, with real plans, valid metadata and safe discovery", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
  });
  const page = await context.newPage();
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: headline, exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-plan=Free]")).toContainText("10 projects");
  await expect(page.locator("[data-plan=Pro]")).toContainText("100 projects");
  await expect(page.locator("[data-plan=Team]")).toContainText("500 projects");
  await expect(
    page
      .getByRole("heading", { name: "Publish as a Paid AI Tool", exact: true })
      .locator(".."),
  ).toContainText("COMING SOON");
  await expect(page).toHaveTitle(/Side project management, hosting & sharing/);
  const canonical = await page
    .locator('link[rel="canonical"]')
    .getAttribute("href");
  expect(canonical).toMatch(/^https:\/\//);
  expect(canonical).not.toContain("localhost");
  const origin = new URL(canonical!).origin;
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /side projects.*preserve project memory/,
  );
  const ogUrl = await page
    .locator('meta[property="og:url"]')
    .getAttribute("content");
  expect(new URL(ogUrl!).href).toBe(origin + "/");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  const data = JSON.parse(
    await page.locator('script[type="application/ld+json"]').innerText(),
  );
  expect(data["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual([
    "Organization",
    "WebSite",
    "SoftwareApplication",
  ]);
  expect(JSON.stringify(data)).not.toMatch(
    /aggregateRating|review|ratingValue/,
  );
  expect(data["@graph"][0].url).toBe(origin);
  const image = await page
    .locator('meta[property="og:image"]')
    .first()
    .getAttribute("content");
  const social = await page.request.get(new URL(image!).pathname);
  expect(social.status()).toBe(200);
  expect(social.headers()["content-type"]).toContain("image/png");
  const png = await social.body();
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  for (const path of ["/", "/support", "/privacy", "/terms"])
    expect(sitemap).toContain(`<loc>${origin}${path}</loc>`);
  expect(sitemap).not.toMatch(
    /<loc>[^<]*(dashboard|signup|login|\/p\/|\/review\/|\/package\/)/,
  );
  const robots = await (await page.request.get("/robots.txt")).text();
  expect(robots).toContain("Sitemap: " + origin + "/sitemap.xml");
  expect(robots).toContain("Disallow: /dashboard");
  await page
    .getByRole("link", { name: "Start Your Workspace", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.locator("form")).toHaveAttribute("method", "post");
  const signupHtml = await (await page.request.get("/signup")).text();
  expect(signupHtml).toContain("<noscript>");
  expect(signupHtml).toContain(
    "Enable JavaScript to create or sign in to your workspace.",
  );
  expect(
    (await page.request.get("/signup")).headers()["x-robots-tag"],
  ).toContain("noindex");
  await context.close();
});

test("signed-in visitors see the public homepage, private links work, and logout leaves the dashboard", async ({
  page,
  browser,
  baseURL,
}) => {
  const registration = await page.request.post("/api/auth/register", {
    data: {
      name: "Landing Owner",
      email: `landing-${Date.now()}@example.test`,
      password: "landing-test-long-password",
    },
  });
  expect(registration.status()).toBe(201);
  const project = await page.request.post("/api/projects", {
    data: {
      name: "PRIVATE-LANDING-SENTINEL",
      description: "PRIVATE-NOTE-DO-NOT-PUBLISH",
    },
  });
  expect(project.ok()).toBeTruthy();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: headline, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Dashboard" }),
  ).toHaveAttribute("href", "/dashboard");
  const html = await (await page.request.get("/")).text();
  expect(html).not.toContain("PRIVATE-LANDING-SENTINEL");
  expect(html).not.toContain("PRIVATE-NOTE-DO-NOT-PUBLISH");
  expect(html).not.toContain("Landing Owner");
  await page.getByRole("link", { name: "Open Dashboard" }).click();
  await expect(page.locator(".project-card")).toContainText(
    "PRIVATE-LANDING-SENTINEL",
  );
  expect(
    (await page.request.get("/dashboard")).headers()["x-robots-tag"],
  ).toContain("noindex");
  await page.goto("/dashboard?billing=return");
  await expect(
    page.getByRole("heading", { name: "Billing & usage", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.goto("/dashboard?tool=support");
  await expect(
    page.getByRole("button", { name: "Help & status", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.locator(".account-row").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: headline, exact: true }),
  ).toBeVisible();
  const visitor = await browser.newContext({ baseURL });
  const anonymous = await visitor.newPage();
  const guard = await anonymous.request.get(
    "/dashboard?invite=example-invite",
    { maxRedirects: 0 },
  );
  expect(guard.status()).toBe(307);
  expect(guard.headers().location).toBe(
    "/login?next=%2Fdashboard%3Finvite%3Dexample-invite",
  );
  expect((await anonymous.request.get("/api/projects")).status()).toBe(401);
  await anonymous.goto("/dashboard?tool=support");
  await expect(anonymous).toHaveURL(/\/login\?next=/);
  await expect(anonymous.locator(".project-card")).toHaveCount(0);
  await visitor.close();
});

test("mobile layouts, keyboard menu, FAQ and public footer destinations stay usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: headline, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/landing-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `test-results/landing-viewport-${width}.png`,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const menu = page.getByLabel("Toggle navigation");
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "Features", exact: true })
    .click();
  await expect(page).toHaveURL(/\/#features$/);
  const question = page
    .locator("summary")
    .filter({ hasText: "Does parking a project stop hosting or billing?" });
  await question.focus();
  await page.keyboard.press("Enter");
  await expect(question.locator("..").locator("p")).toContainText(
    "does not stop hosting",
  );
  for (const [label, path] of [
    ["Support", "/support"],
    ["Privacy", "/privacy"],
    ["Terms", "/terms"],
  ]) {
    await page.goto("/");
    const link = page
      .getByRole("navigation", { name: "Help and legal" })
      .getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", path);
    await link.click();
    await expect(page.locator("h1")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
  }
  expect(errors).toEqual([]);
});

test("existing invitations and billing links reach the protected dashboard, while ordinary visits remain public", async ({
  page,
}) => {
  for (const query of [
    "invite=old-invitation",
    "billing=return",
    "project=old-project",
  ]) {
    const response = await page.request.get("/?" + query, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toBe("/dashboard?" + query);
    await page.goto("/?" + query);
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByLabel("Email address")).toBeVisible();
  }
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: headline, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "See How It Works", exact: true })
    .click();
  await expect(page).toHaveURL(/\/#how-it-works$/);
  for (const step of [
    "Add your project",
    "Organize and share",
    "Return and continue",
  ])
    await expect(
      page.getByRole("heading", { name: step, exact: true }),
    ).toBeVisible();
  await page.getByRole("link", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
