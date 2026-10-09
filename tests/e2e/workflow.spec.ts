import { test, expect } from "@playwright/test";
import JSZip from "jszip";
test("complete private import → organize → share → park → resume experience", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Workflow Tester");
  const email = `workflow-${Date.now()}@example.test`;
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-project-2026");
  await page.getByRole("button", { name: "Create your workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Your projects." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Every chapter starts somewhere." }),
  ).toBeVisible();
  const zip = new JSZip();
  zip.file("index.html", "<!doctype html><h1>A real static build</h1>");
  zip.file("style.css", "body {color: teal}");
  zip.file(".env", "PRIVATE_TOKEN=never-public");
  const archive = await zip.generateAsync({ type: "nodebuffer" });
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("button", { name: "Upload ZIP", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Workflow Project");
  await page
    .getByLabel("Description", { exact: true })
    .fill("A working project for returning later.");
  await page.getByLabel("Demo URL (optional)").fill("https://example.com/demo");
  await page.getByLabel("Tags", { exact: true }).fill("React, Test");
  await page
    .locator('input[type=file][accept=".zip,application/zip"]')
    .setInputFiles({
      name: "project.zip",
      mimeType: "application/zip",
      buffer: archive,
    });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/0cAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator("input[type=file][multiple]").setInputFiles({
    name: "screenshot.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Workflow Project", exact: true }),
  ).toBeVisible();
  const ws = await (await page.request.get("/api/workspace")).json();
  const project = ws.projects.find(
    (p: { name: string }) => p.name === "Workflow Project",
  );
  const saveSharing = async () => {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/projects/${project.id}/share`) &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save sharing settings" }).click();
    expect((await response).ok()).toBeTruthy();
    await expect(
      page.getByRole("button", { name: "Save sharing settings" }),
    ).toBeEnabled();
  };
  expect(project.buildId).toBeTruthy();
  expect(project.shared).toBeFalsy();
  await page
    .getByRole("button", { name: "Actions for Workflow Project" })
    .click();
  await page.getByRole("button", { name: "Add to priority queue" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Added to your priority queue" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search projects", exact: true })
    .fill("not present");
  await expect(
    page.getByRole("heading", { name: "No projects match just yet" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  const visitor = await browser.newContext();
  const publicPage = await visitor.newPage();
  await publicPage.goto(`/p/${project.shareId}`);
  await expect(
    publicPage.getByRole("heading", { name: "This chapter is private." }),
  ).toBeVisible();
  expect(
    (await visitor.request.get(`/api/files/${project.sourceId}`)).status(),
  ).toBe(404);
  expect(
    (
      await visitor.request.get(`/api/files/${project.screenshotIds[0]}`)
    ).status(),
  ).toBe(404);
  await page
    .locator(".project-card")
    .getByRole("button", { name: "Share", exact: true })
    .click();
  await page.getByRole("switch", { name: "Enable public sharing" }).check();
  await saveSharing();
  await expect(page.getByLabel("Share link", { exact: true })).toBeVisible();
  await publicPage.goto(`/p/${project.shareId}`);
  await expect(
    publicPage.getByRole("heading", { name: "Workflow Project." }),
  ).toBeVisible();
  await expect(
    publicPage.getByRole("link", { name: "Visit live demo" }),
  ).toBeVisible();
  await expect(
    publicPage.getByRole("link", { name: "Download source ZIP" }),
  ).toHaveCount(0);
  expect(
    (await visitor.request.get(`/api/files/${project.sourceId}`)).status(),
  ).toBe(404);
  expect(
    (
      await visitor.request.get(`/api/files/${project.screenshotIds[0]}`)
    ).status(),
  ).toBe(200);
  await page.getByRole("checkbox", { name: /Source download/ }).check();
  await saveSharing();
  const source = await visitor.request.get(`/api/files/${project.sourceId}`);
  expect(source.status()).toBe(200);
  expect((await JSZip.loadAsync(await source.body())).file(".env")).toBeNull();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .locator(".project-card")
    .getByRole("button", { name: "Park", exact: true })
    .click();
  await page
    .getByLabel("Setup instructions")
    .fill("npm install\nnpm run dev\nAPI_KEY=this-should-be-redacted");
  await page
    .getByLabel("Completed features")
    .fill("Dashboard and authentication");
  await page
    .getByLabel("Known issues & blockers")
    .fill("Mobile sound playback needs testing");
  await page.getByLabel("Reason for pausing").fill("Finishing another project");
  await page
    .getByLabel("The very next task")
    .fill("Test audio on mobile Safari");
  await page.getByLabel("Intended return date (optional)").fill("2026-10-15");
  await page
    .getByRole("button", { name: "Park with memory", exact: true })
    .click();
  await expect(page.locator(".project-card .badge")).toHaveText("Parked");
  await page.reload();
  await expect(page.locator(".project-card .badge")).toHaveText("Parked");
  const parkedWs = await (await page.request.get("/api/workspace")).json();
  const parked = parkedWs.projects.find(
    (p: { id: string }) => p.id === project.id,
  );
  expect(parked.demoUrl).toBe("https://example.com/demo");
  expect(parked.memory.sourceId).toBe(project.sourceId);
  expect(parked.memory.setup).not.toContain("this-should-be-redacted");
  await publicPage.reload();
  const publicText = await publicPage.locator("body").innerText();
  expect(publicText).not.toContain("mobile Safari");
  expect(publicText).not.toContain("Finishing another project");
  await page
    .locator(".project-card")
    .getByRole("button", { name: "Resume", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Test audio on mobile Safari",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Prepare from notes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume building", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Check readiness", exact: true })
    .click();
  await expect(page.locator(".check-list")).toBeVisible();
  const textarea = page.getByRole("textbox", { name: "Editable resume brief" });
  await expect(textarea).toHaveValue(/## Project purpose/);
  expect(await textarea.inputValue()).toContain("Test audio on mobile Safari");
  expect(await textarea.inputValue()).not.toContain("this-should-be-redacted");
  await textarea.fill(
    (await textarea.inputValue()) + "\nOwner edit: verify before changing.",
  );
  await page.getByRole("button", { name: "Save edits", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .md" }).click();
  expect((await download).suggestedFilename()).toBe(
    "workflow-project-resume.md",
  );
  await page
    .getByRole("button", { name: "Resume building", exact: true })
    .click();
  await expect(page.locator(".project-card .badge")).toHaveText("Building");
  const other = await browser.newContext();
  await other.request.post("/api/auth/register", {
    data: {
      name: "Other Owner",
      email: `other-${Date.now()}@example.test`,
      password: "another-long-password",
    },
  });
  expect(
    (
      await other.request.patch(`/api/projects/${project.id}`, {
        data: { queued: false },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await other.request.post(`/api/projects/${project.id}/brief`, {
        data: { generateAI: false },
      })
    ).status(),
  ).toBe(404);
  // Revoking sharing revokes source and screenshots immediately.
  await page
    .locator(".project-card")
    .getByRole("button", { name: "Share", exact: true })
    .click();
  await page.getByRole("switch", { name: "Enable public sharing" }).uncheck();
  await saveSharing();
  await publicPage.reload();
  await expect(
    publicPage.getByRole("heading", { name: "This chapter is private." }),
  ).toBeVisible();
  expect(
    (await visitor.request.get(`/api/files/${project.sourceId}`)).status(),
  ).toBe(404);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Workflow Project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Deploy to Vercel", exact: true })
    .click();
  await expect(page.locator(".notice-error")).toContainText(
    "Connect your Vercel account",
  );
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.locator(".account-row").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-horse-project-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page
      .locator(".project-card")
      .getByRole("heading", { name: "Workflow Project", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".project-card .badge")).toHaveText("Building");
  expect(errors).toEqual([]);
  await visitor.close();
  await other.close();
});
test("dragging the priority queue persists its order and filters stay usable", async ({
  page,
}) => {
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Try your own workspace", exact: true })
    .click();
  await expect(page.locator(".account-row")).toContainText("Personal demo");
  const items = page.locator(".queue-item");
  await items.nth(2).dragTo(items.nth(0));
  await expect(items.first()).toContainText("Snippet Stash");
  await page.reload();
  await expect(page.locator(".queue-item").first()).toContainText(
    "Snippet Stash",
  );
  await page.getByRole("tab", { name: "Live 1", exact: true }).click();
  await expect(page.locator(".project-card")).toHaveCount(1);
  await expect(page.locator(".project-card")).toContainText("Devlog");
  await page.getByRole("tab", { name: "All projects 6", exact: true }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("Project tag").selectOption("React");
  await expect(page.locator(".project-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("textbox", { name: "Search projects", exact: true }),
  ).toBeFocused();
});
test("responsive demo dashboard and account login work", async ({ page }) => {
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "Your projects." }),
  ).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("button", { name: /Parked projects/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Parked projects/ }).click();
  await expect(
    page.getByRole("heading", { name: "Parked, with a plan." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/login");
  await page.getByLabel("Email address").fill("nobody@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("incorrect-long-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".notice-error")).toContainText("does not match");
});
