import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
test("development CLI capture, park, guided session, reviewed proposal, private feedback and attention", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now(),
    password = "phase-five-user-test-password";
  expect(
    (
      await page.request.post("/api/auth/register", {
        data: {
          name: "Continuation Owner",
          email: "p5-" + stamp + "@example.test",
          password,
        },
      })
    ).ok(),
  ).toBeTruthy();
  const create = await page.request.post("/api/projects", {
    data: {
      name: "Continuation Garden",
      description: "Track a small upload interface.",
    },
  });
  let p = (await create.json()).project;
  expect(create.ok()).toBeTruthy();
  const tokenResult = await page.request.post(
    "/api/projects/" + p.id + "/capture-tokens",
    { data: { name: "Browser test CLI", days: 1 } },
  );
  expect(tokenResult.ok()).toBeTruthy();
  const credential = await tokenResult.json();
  const cliDir = path.join(process.cwd(), ".data", "cli-browser-" + stamp);
  mkdirSync(path.join(cliDir, "src"), { recursive: true });
  writeFileSync(
    path.join(cliDir, "src", "upload.ts"),
    "export const uploadProgress = 'needs accessibility review';",
  );
  const captureId = randomUUID();
  writeFileSync(
    path.join(cliDir, "progress.json"),
    JSON.stringify({
      id: captureId,
      notes: "Upload progress UI drafted, pending review",
      commit: "abcdef1234567",
      nextTask: "Review progress accessibility",
      blockers: "Screen reader messages need review",
      minutes: 30,
      filePaths: ["src/upload.ts"],
    }),
  );
  const environment = {
    ...process.env,
    CHAPTER_URL: process.env.TEST_BASE_URL || "http://localhost:3000",
    CHAPTER_PROJECT: p.id,
    CHAPTER_TOKEN: credential.token,
  };
  const cliFile = path.join(process.cwd(), "public", "chapter-cli.mjs");
  const dry = await execute(
    process.execPath,
    [cliFile, "capture", "--input", "progress.json", "--dry-run"],
    { cwd: cliDir, env: environment },
  );
  expect(dry.stdout).toContain("src/upload.ts");
  expect(dry.stdout).not.toContain(credential.token);
  expect(dry.stdout).not.toContain("Upload progress UI drafted");
  const sent = await execute(
    process.execPath,
    [cliFile, "capture", "--input", "progress.json", "--reviewed"],
    { cwd: cliDir, env: environment },
  );
  expect(JSON.parse(sent.stdout).saved).toBe(true);
  const duplicate = await execute(
    process.execPath,
    [cliFile, "capture", "--input", "progress.json", "--reviewed"],
    { cwd: cliDir, env: environment },
  );
  expect(JSON.parse(duplicate.stdout).duplicate).toBe(true);
  const cookieBypass = await page.request.post(
    "/api/developer/projects/" + p.id + "/capture",
    { data: { id: randomUUID(), notes: "Cookie should not work" } },
  );
  expect(cookieBypass.status()).toBe(401);
  const another = await page.request.post("/api/projects", {
    data: { name: "Other Garden" },
  });
  const anotherId = (await another.json()).project.id;
  expect(
    (
      await page.request.post(
        "/api/developer/projects/" + anotherId + "/capture",
        {
          headers: { Authorization: "Bearer " + credential.token },
          data: { id: randomUUID(), notes: "Wrong scope" },
        },
      )
    ).status(),
  ).toBe(403);
  const snapshot = (
    await (await page.request.get("/api/workspace")).json()
  ).projects.find((q: { id: string }) => q.id === p.id).progressUpdates[0]
    .fileId;
  const anonymous = await browser.newContext(),
    publicRequest = anonymous.request;
  expect((await publicRequest.get("/api/files/" + snapshot)).status()).toBe(
    404,
  );
  expect(
    (
      await page.request.post("/api/projects/" + p.id + "/park", {
        data: {
          version: "abcdef1234567",
          setup: "npm install, then npm run dev",
          completed: "Upload form",
          issues: "Screen reader messages need review",
          reason: "Client work took priority",
          nextTask: "Review progress accessibility",
          returnDate: "2020-01-01",
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Continue & learn", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Keep moving, one next step at a time" }),
  ).toBeVisible();
  await page.getByLabel("Project to continue").selectOption(p.id);
  await expect(
    page.getByText("Client work took priority", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check readiness", exact: true })
    .click();
  await expect(page.locator(".readiness-section")).toContainText("Not Checked");
  await page
    .getByLabel("Task for this session")
    .fill("Review progress accessibility");
  await page.getByLabel("Available time").selectOption("30");
  await page
    .getByLabel("I reviewed the saved context and readiness results.")
    .check();
  await page
    .getByRole("button", { name: "Start guided session", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Finish with a clear next step" }),
  ).toBeVisible();
  await page
    .getByLabel("Completed during this session")
    .fill("Accessible upload progress messages");
  await page
    .getByLabel("Remaining issues and blockers")
    .fill("Check slow upload behavior");
  await page
    .getByLabel("Next task after this session")
    .fill("Test slow uploads with keyboard navigation");
  await page
    .getByLabel("These notes accurately describe my work and the next step.")
    .check();
  await page
    .getByRole("button", { name: "Confirm and save session", exact: true })
    .click();
  await expect(
    page.getByText("Session completed. Confirmed notes saved.", {
      exact: true,
    }),
  ).toBeVisible();
  p = (await (await page.request.get("/api/workspace")).json()).projects.find(
    (q: { id: string }) => q.id === p.id,
  );
  expect(p.nextTask).toBe("Test slow uploads with keyboard navigation");
  expect(p.memory.completed).toBe(
    "Upload form\nAccessible upload progress messages",
  );
  expect(p.blockers).toBe("Check slow upload behavior");
  expect(p.status).toBe("Building");
  await page
    .getByRole("button", { name: "Action proposals", exact: true })
    .click();
  await page.getByLabel("Proposal type").selectOption("documentation");
  const aiToggle = page.getByLabel("Use AI to select supporting excerpts");
  if (await aiToggle.isEnabled()) await aiToggle.uncheck();
  await page
    .getByRole("button", { name: "Generate editable proposal", exact: true })
    .click();
  await expect(page.getByLabel("Editable action proposal")).toBeVisible({
    timeout: 60000,
  });
  const editor = page.getByLabel("Editable action proposal");
  await editor.fill(
    (await editor.inputValue()) +
      "\n\nConfirmed checklist: verify keyboard progress.",
  );
  await page
    .getByLabel("I reviewed this draft and want to save these stored records.")
    .check();
  await page
    .getByRole("button", { name: "Apply reviewed proposal", exact: true })
    .click();
  await expect(
    page.getByText("Reviewed proposal saved.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Attention inbox", exact: true })
    .click();
  const blocker = page
    .locator(".attention-card")
    .filter({ hasText: "blocker · open" });
  await expect(blocker).toContainText("Unresolved blockers");
  await blocker.getByRole("button", { name: "Snooze 24h" }).click();
  await expect(blocker).toHaveCount(0);
  await page.getByLabel("Show resolved, snoozed and disabled items").check();
  await expect(
    page.locator(".attention-card").filter({ hasText: "blocker · snoozed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page
    .getByLabel("Feedback subject")
    .fill("Resume sessions need a timer");
  await page
    .getByLabel("Tell us what happened or what would help")
    .fill("An optional timer would help me budget a session.");
  await page
    .getByRole("button", { name: "Submit feedback", exact: true })
    .click();
  await expect(
    page.getByText("Resume sessions need a timer", { exact: true }),
  ).toBeVisible();
  const feedback = (await (await page.request.get("/api/feedback")).json())
    .requests[0];
  expect(feedback.data.diagnostics).toBeNull();
  expect((await publicRequest.get("/api/feedback")).status()).toBe(401);
  expect((await page.request.get("/api/feedback-admin")).status()).toBe(403);
  await page
    .getByRole("button", { name: "Usage insights", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Usage backed by completed actions" }),
  ).toBeVisible();
  const insights = await (await page.request.get("/api/insights")).json();
  expect(
    insights.counts.find(
      (r: { action: string }) => r.action === "resume_session",
    ).completed,
  ).toBe(1);
  expect(
    insights.counts.find((r: { action: string }) => r.action === "capture")
      .completed,
  ).toBe(1);
  expect(insights.definition).toContain("No source files");
  await page.request.delete("/api/projects/" + p.id + "/capture-tokens", {
    data: { tokenId: credential.id },
  });
  expect(
    (
      await page.request.post("/api/developer/projects/" + p.id + "/capture", {
        headers: { Authorization: "Bearer " + credential.token },
        data: { id: randomUUID(), notes: "Revoked attempt" },
      })
    ).status(),
  ).toBe(401);
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: "Continue & learn", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Guided resume", exact: true })
    .click();
  await expect(page.getByLabel("Project to continue")).toBeVisible();
  expect(errors).toEqual([]);
  await anonymous.close();
});
test("restricted platform administrators categorize feedback and publish updates with private screenshots", async ({
  browser,
  request,
}) => {
  test.skip(
    !process.env.TEST_ADMIN_EMAIL,
    "Seeded isolated admin test environment is required.",
  );
  const admin = await browser.newContext(),
    author = await browser.newContext(),
    outsider = await browser.newContext();
  const stamp = Date.now();
  expect(
    (
      await author.request.post("/api/auth/register", {
        data: {
          name: "Feedback Author",
          email: "feedback-" + stamp + "@example.test",
          password: "feedback-user-test-password",
        },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await outsider.request.post("/api/auth/register", {
        data: {
          name: "Feedback Outsider",
          email: "outsider-" + stamp + "@example.test",
          password: "feedback-user-test-password",
        },
      })
    ).ok(),
  ).toBeTruthy();
  const screenshot = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/4kAAAAASUVORK5CYII=",
    "base64",
  );
  const f = await author.request.post("/api/feedback", {
    multipart: {
      id: randomUUID(),
      subject: "Capture error needs detail " + stamp,
      text: "Please make the capture error clearer.",
      category: "Usability",
      diagnostics: "true",
      screenshotReviewed: "true",
      screenshot: {
        name: "private.png",
        mimeType: "image/png",
        buffer: screenshot,
      },
    },
  });
  expect(f.ok()).toBeTruthy();
  const id = (await f.json()).id;
  expect(
    (
      await outsider.request.get("/api/feedback/" + id + "/screenshot")
    ).status(),
  ).toBe(404);
  const login = await admin.request.post("/api/auth/login", {
    data: {
      email: process.env.TEST_ADMIN_EMAIL,
      password: "phase-five-admin-test-password",
    },
  });
  expect(login.ok()).toBeTruthy();
  const adminPage = await admin.newPage();
  await adminPage.goto("/dashboard");
  await adminPage
    .getByRole("button", { name: "Continue & learn", exact: true })
    .click();
  await adminPage
    .getByRole("button", { name: "Admin feedback", exact: true })
    .click();
  const row = adminPage
    .locator(".continuation-record")
    .filter({ hasText: "Capture error needs detail " + stamp });
  await row.getByLabel("Request status").selectOption("Planned");
  await row.getByLabel("Admin category").selectOption("Bug");
  await row
    .getByLabel("Progress update")
    .fill("A clearer capture error is planned.");
  await row.getByLabel("Problem theme").fill("Capture error clarity");
  await row.getByLabel("Publish this update to the submitting user").check();
  await row
    .getByRole("button", { name: "Save feedback update", exact: true })
    .click();
  await expect(row).toContainText("Bug · Planned");
  const tracked = await (await author.request.get("/api/feedback")).json();
  expect(tracked.requests[0].updates[0].text).toBe(
    "A clearer capture error is planned.",
  );
  expect(
    (await admin.request.get("/api/feedback-admin/" + id + "/screenshot")).ok(),
  ).toBeTruthy();
  expect(
    (await admin.request.get("/api/feedback-admin/usage")).ok(),
  ).toBeTruthy();
  await admin.close();
  await author.close();
  await outsider.close();
});
