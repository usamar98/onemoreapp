import { test, expect } from "@playwright/test";
import JSZip from "jszip";

test("park → collect real interest → check readiness → reviewed handover → resume persists with private access", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const registration = await page.request.post("/api/auth/register", {
    data: {
      name: "Phase Two Owner",
      email: `phase-two-${Date.now()}@example.test`,
      password: "phase-two-long-password",
    },
  });
  expect(registration.ok()).toBeTruthy();
  await page.goto("/dashboard");
  const zip = new JSZip();
  zip.file("index.html", "<!doctype html><h1>Chapter Phase Two</h1>");
  zip.file(
    "src/app.ts",
    "export const endpoint = process.env.API_ENDPOINT;\n// private.person@example.test",
  );
  zip.file(
    ".env.example",
    "API_ENDPOINT=https://private-config.example\nSECRET_API_KEY=never-export-this",
  );
  zip.file("customers.csv", "name,email\nJane,jane@example.test");
  zip.file("database.sql", "insert into customers values ('Jane');");
  zip.file("logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("button", { name: "Upload ZIP", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Phase Two Project");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A saved project with a safe next chapter.");
  await page
    .getByLabel("Demo URL (optional)")
    .fill("http://127.0.0.1/never-request");
  await page
    .locator('input[type=file][accept=".zip,application/zip"]')
    .setInputFiles({
      name: "phase-two.zip",
      mimeType: "application/zip",
      buffer: await zip.generateAsync({ type: "nodebuffer" }),
    });
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page.locator(".project-card")).toContainText(
    "Phase Two Project",
  );
  const project = (await (await page.request.get("/api/workspace")).json())
    .projects[0];
  expect(project.referencedEnvNames).toEqual([
    "API_ENDPOINT",
    "SECRET_API_KEY",
  ]);
  expect(project.requiredEnvNames).toEqual([]);
  async function save(button: string, action: string) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/projects/${project.id}/${action}`) &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: button, exact: true }).click();
    expect((await response).ok()).toBeTruthy();
    await expect(page.locator(".panel-body .spin")).toHaveCount(0);
  }
  async function controls() {
    await page
      .getByRole("button", { name: "Open Phase Two Project", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Next chapter controls", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Phase Two Project · Next chapter",
        exact: true,
      }),
    ).toBeVisible();
  }
  await controls();
  await page
    .getByLabel("Next task", { exact: true })
    .fill("Add the welcome page");
  await page.getByLabel("Estimated minutes").fill("25");
  await page.getByLabel("Task priority").selectOption("High");
  await save("Save next task", "task");
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: /Priority queue/ }).click();
  await page.getByRole("button", { name: "30 minutes", exact: true }).click();
  await expect(page.locator(".suggestion-note")).toContainText(
    "Your estimate is 25 minutes",
  );
  await expect(page.locator(".project-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Manage next task" }).click();
  await page
    .getByLabel("Blockers", { exact: true })
    .fill("Waiting for API approval");
  await save("Save next task", "task");
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.locator(".project-card")).toHaveCount(0);
  await expect(page.locator(".smart-queue")).toContainText(
    "No recorded tasks fit",
  );
  await page.getByRole("button", { name: /All projects/ }).click();
  await page
    .locator(".project-card")
    .getByRole("button", { name: "Park", exact: true })
    .click();
  await page
    .getByLabel("Setup instructions")
    .fill("npm install\nnpm run dev\nAPI_KEY=private-value");
  await page.getByLabel("Completed features").fill("Public welcome page");
  await page.getByLabel("Known issues & blockers").fill("API approval needed");
  await page.getByLabel("Reason for pausing").fill("Other work");
  await page.getByLabel("The very next task").fill("Test the welcome page");
  await save("Park with memory", "park");
  await page
    .getByRole("button", { name: "Close panel" })
    .count()
    .then(async (n) => {
      if (n) await page.getByRole("button", { name: "Close panel" }).click();
    });
  await expect(page.locator(".project-card .badge")).toHaveText("Parked");
  expect(
    (
      await page.request.post(`/api/projects/${project.id}/resume`, {
        data: { brief: "Attempt without a check" },
      })
    ).status(),
  ).toBe(409);
  await page
    .locator(".project-card")
    .getByRole("button", { name: "Share", exact: true })
    .click();
  await page.getByRole("switch", { name: "Enable public sharing" }).check();
  await save("Save sharing settings", "share");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await controls();
  await page.getByRole("button", { name: "Interest", exact: true }).click();
  await page.getByLabel("Demo video URL").fill("https://example.com/demo.mp4");
  await page.getByLabel("Share this demo video").check();
  await page.getByLabel("Collect waitlist signups").check();
  await page.getByLabel("Accept project enquiries").check();
  await save("Save interest settings", "interest-settings");
  await page.getByRole("button", { name: "Close panel" }).click();
  const visitor = await browser.newContext(),
    publicPage = await visitor.newPage();
  await publicPage.goto(`/p/${project.shareId}`);
  await expect(publicPage.locator(".shared-inactive")).toBeVisible();
  await expect(publicPage.locator("video")).toHaveAttribute(
    "src",
    "https://example.com/demo.mp4",
  );
  await expect(
    publicPage.getByRole("link", { name: "Download source ZIP" }),
  ).toHaveCount(0);
  expect(
    (await visitor.request.get(`/api/files/${project.sourceId}`)).status(),
  ).toBe(404);
  await publicPage
    .getByLabel("Your email", { exact: true })
    .fill("interested@example.test");
  await publicPage.getByLabel(/I agree to share/).check();
  await publicPage
    .getByRole("button", { name: "Join waitlist", exact: true })
    .click();
  await expect(publicPage.locator(".notice-success")).toContainText(
    "You're on the waitlist",
  );
  // Same email signup is idempotent and enquiries remain distinct records.
  expect(
    (
      await visitor.request.post(`/api/public/${project.shareId}/signup`, {
        data: { email: "interested@example.test", consent: true },
      })
    ).ok(),
  ).toBeTruthy();
  await publicPage.getByLabel("I’d like to").selectOption("enquiry");
  await publicPage
    .getByLabel("Your email", { exact: true })
    .fill("enquirer@example.test");
  await publicPage
    .getByLabel("Your enquiry", { exact: true })
    .fill("I would like to help finish this project.");
  await publicPage.getByLabel(/I agree to share/).check();
  await publicPage
    .getByRole("button", { name: "Send enquiry", exact: true })
    .click();
  await expect(publicPage.locator(".notice-success")).toContainText(
    "enquiry has been saved",
  );
  expect(
    (
      await visitor.request.get(`/api/projects/${project.id}/interest`)
    ).status(),
  ).toBe(401);
  await page.reload();
  await expect(page.locator(".parked-interest-summary")).toContainText(
    "1 visits · 1 signups · 1 enquiries",
  );
  await controls();
  await page.getByRole("button", { name: "Interest", exact: true }).click();
  await expect(page.locator(".contact-list")).toContainText(
    "interested@example.test",
  );
  await expect(page.locator(".contact-list")).toContainText(
    "I would like to help",
  );
  await page.getByRole("button", { name: "Readiness", exact: true }).click();
  await save("Save environment names", "environment-names");
  await save("Check readiness", "revival");
  await expect(page.locator(".check-list")).toContainText(
    "private, local, or reserved network",
  );
  await expect(page.locator(".check-list")).toContainText("API_ENDPOINT");
  await expect(page.locator(".check-list")).toContainText("Not Checked");
  await page.screenshot({ path: "phase-two-readiness.png", fullPage: true });
  await page.getByRole("button", { name: "Hosting", exact: true }).click();
  await expect(page.locator(".notice")).toContainText(
    "Hosting controls are unavailable",
  );
  expect(
    (
      await page.request.post(`/api/projects/${project.id}/hosting-control`, {
        data: {
          target: "pause",
          name: "bad",
          expires: Date.now() + 1000,
          confirmation: "bad",
        },
      })
    ).status(),
  ).toBe(409);
  await page.getByRole("button", { name: "Costs", exact: true }).click();
  await page.getByLabel("Expense name").fill("Production database");
  await page.getByLabel("Expense category").selectOption("Database");
  await page.getByLabel("Estimated amount").fill("12.50");
  await save("Add manual estimate", "expenses");
  await expect(page.locator(".cost-totals")).toContainText(
    "USD 12.50 may continue while parked",
  );
  await expect(page.locator(".expense-row")).toContainText("Manual estimate");
  await page.getByRole("button", { name: "Handover", exact: true }).click();
  expect(
    (
      await page.request.post(`/api/projects/${project.id}/handover-create`, {
        data: { paths: [], reviewed: false, digest: "not-reviewed" },
      })
    ).status(),
  ).toBe(409);
  await page
    .getByRole("button", { name: "Inspect handover contents", exact: true })
    .click();
  await expect(page.locator(".handover-files")).toContainText("src/app.ts");
  await expect(page.locator(".handover-files")).not.toContainText(
    "customers.csv",
  );
  await expect(
    page.getByRole("button", { name: "Create reviewed package", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("src/app.ts", { exact: true }).check();
  await page.getByLabel("logo.svg", { exact: true }).check();
  await page
    .getByRole("button", { name: "Review selected contents", exact: true })
    .click();
  await expect(page.locator(".handover-review").first()).toContainText(
    "Ownership transfer checklist",
  );
  await page.getByText("src/app.ts ·", { exact: false }).click();
  expect(
    (await page.locator(".handover-review").allTextContents()).join("\n"),
  ).not.toContain("private.person@example.test");
  await page
    .getByLabel(/I reviewed the manifest and all selected files/)
    .check();
  await save("Create reviewed package", "handover-create");
  const current = (await (await page.request.get("/api/workspace")).json())
    .projects[0];
  expect(
    (
      await visitor.request.get(
        `/api/handovers/${project.id}/${current.handover.shareToken}`,
      )
    ).status(),
  ).toBe(404);
  expect(
    (await visitor.request.get(`/api/files/${current.handover.id}`)).status(),
  ).toBe(404);
  const ownerDownload = await page.request.get(
    `/api/projects/${project.id}/handover-download`,
  );
  expect(ownerDownload.ok()).toBeTruthy();
  const packageZip = await JSZip.loadAsync(await ownerDownload.body());
  expect(packageZip.file("source/customers.csv")).toBeNull();
  expect(packageZip.file("source/database.sql")).toBeNull();
  expect(packageZip.file("source/src/app.ts")).not.toBeNull();
  const manifest = await packageZip.file("HANDOVER.md")!.async("string");
  expect(manifest).toContain("Next task");
  expect(manifest).not.toContain("interested@example.test");
  expect(manifest).not.toContain("private-value");
  expect(
    await packageZip.file("source/src/app.ts")!.async("string"),
  ).not.toContain("private.person@example.test");
  await save("Enable handover download on share page", "handover-share");
  await publicPage.reload();
  await expect(
    publicPage.getByRole("link", {
      name: "Download reviewed handover",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (
      await visitor.request.get(
        `/api/handovers/${project.id}/${current.handover.shareToken}`,
      )
    ).ok(),
  ).toBeTruthy();
  await save("Revoke handover sharing", "handover-share");
  expect(
    (
      await visitor.request.get(
        `/api/handovers/${project.id}/${current.handover.shareToken}`,
      )
    ).status(),
  ).toBe(404);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator(".project-history")).toContainText(
    "Parked Phase Two Project",
  );
  await expect(page.locator(".project-history")).toContainText(
    "Checked readiness",
  );
  await expect(page.locator(".project-history")).toContainText(
    "reviewed handover package",
  );
  await expect(page.locator(".project-history")).toContainText(
    "Received a waitlist signup",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Readiness", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "phase-two-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Close panel" }).click();
  await page
    .locator(".project-card")
    .getByRole("button", { name: "Resume", exact: true })
    .click();
  await expect(page.locator(".readiness-section")).toContainText(
    "Revival check",
  );
  await page
    .getByRole("button", { name: "Prepare from notes", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Editable resume brief" }),
  ).toHaveValue(/Test the welcome page/);
  await save("Resume building", "resume");
  await page.reload();
  await expect(page.locator(".project-card .badge")).toHaveText("Building");
  const final = (await (await page.request.get("/api/workspace")).json())
    .projects[0];
  expect(final.expenses[0].origin).toBe("Manual estimate");
  expect(final.taskMinutes).toBe(25);
  expect(final.revival.items.length).toBeGreaterThanOrEqual(5);
  expect(final.handover.shared).toBe(false);
  expect(final.interest).toEqual({ visits: 1, signups: 1, enquiries: 1 });
  const other = await browser.newContext();
  expect(
    (
      await other.request.post("/api/auth/register", {
        data: {
          name: "Other Phase Owner",
          email: `phase-other-${Date.now()}@example.test`,
          password: "another-long-password",
        },
      })
    ).ok(),
  ).toBeTruthy();
  for (const action of [
    "interest",
    "history",
    "revival",
    "handover-download",
    "hosting-status",
  ])
    expect(
      (
        await other.request.get(`/api/projects/${project.id}/${action}`)
      ).status(),
    ).toBe(404);
  for (const action of [
    "task",
    "revival",
    "expenses",
    "handover-preview",
    "handover-create",
    "handover-share",
    "hosting-control",
  ])
    expect(
      (
        await other.request.post(`/api/projects/${project.id}/${action}`, {
          data: {},
        })
      ).status(),
    ).toBe(404);
  expect(errors).toEqual([]);
  await other.close();
  await visitor.close();
});
