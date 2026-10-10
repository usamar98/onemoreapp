import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";

// Set SECURE_E2E_DATA_DIR to the isolated server's data directory, never the live database.
const dataDir = process.env.SECURE_E2E_DATA_DIR;
function latestEmail(email: string, purpose: string) {
  const sqlite = new DatabaseSync(path.join(dataDir!, "chapter.sqlite"), {
    readOnly: true,
  });
  try {
    const row = sqlite
      .prepare(
        "SELECT m.id,m.state FROM mail_deliveries m JOIN auth_tokens t ON t.token=m.token WHERE t.email=? AND t.purpose=? ORDER BY m.at DESC LIMIT 1",
      )
      .get(email, purpose);
    if (!row || row.state !== "local") return "";
    const html = readFileSync(
      path.join(dataDir!, "mail-outbox", String(row.id) + ".html"),
      "utf8",
    );
    return html.match(/href="([^"]+#token=[a-f0-9]{64})"/)?.[1] || "";
  } finally {
    sqlite.close();
  }
}

test("account verification and recovery consume one-time links and revoke prior sessions", async ({
  page,
  browser,
}) => {
  test.skip(
    !dataDir,
    "Requires an isolated server with CHAPTER_EMAIL_MODE=local and SECURE_E2E_DATA_DIR.",
  );
  const email = `recovery-${Date.now()}@example.test`,
    password = "a-recovery-test-password";
  const registration = await page.request.post("/api/auth/register", {
    data: { name: "Recovery Owner", email, password },
  });
  expect(registration.status()).toBe(201);
  await expect.poll(() => latestEmail(email, "verify")).not.toBe("");
  const verification = latestEmail(email, "verify");
  await page.goto(verification);
  await expect(
    page.getByRole("button", { name: "Confirm email address" }),
  ).toBeEnabled();
  expect(
    await page.request
      .get("/api/auth/security")
      .then((r) => r.json())
      .then((r) => r.verifiedAt),
  ).toBeNull();
  await page.getByRole("button", { name: "Confirm email address" }).click();
  await expect(
    page.getByText("Your email address is verified.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.request
      .get("/api/auth/security")
      .then((r) => r.json())
      .then((r) => r.verifiedAt),
  ).toBeTruthy();
  const guest = await browser.newContext({
      baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
    }),
    recovery = await guest.newPage();
  await recovery.goto("/login");
  await recovery.getByRole("link", { name: "Forgot your password?" }).click();
  await recovery.getByLabel("Registered email address").fill(email);
  await recovery.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    recovery.getByText("If an eligible account", { exact: false }),
  ).toBeVisible();
  await expect.poll(() => latestEmail(email, "reset")).not.toBe("");
  const reset = latestEmail(email, "reset");
  await recovery.goto(reset);
  await expect(
    recovery.getByRole("button", { name: "Save new password" }),
  ).toBeEnabled();
  await recovery
    .getByLabel("New password", { exact: true })
    .fill("new-recovery-test-password");
  await recovery
    .getByLabel("Confirm new password")
    .fill("new-recovery-test-password");
  await recovery.getByRole("button", { name: "Save new password" }).click();
  await expect(
    recovery.getByText("Password changed.", { exact: false }),
  ).toBeVisible();
  expect((await page.request.get("/api/auth/security")).status()).toBe(401);
  expect(
    (
      await guest.request.post("/api/auth/login", { data: { email, password } })
    ).status(),
  ).toBe(401);
  expect(
    (
      await guest.request.post("/api/auth/login", {
        data: { email, password: "new-recovery-test-password" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await guest.request.post("/api/auth/reset-password", {
        data: {
          token: reset.split("token=")[1],
          password: "another-password-1234",
        },
      })
    ).status(),
  ).toBe(410);
  const known = await guest.request.post("/api/auth/forgot-password", {
    data: { email },
  });
  const unknown = await guest.request.post("/api/auth/forgot-password", {
    data: { email: "missing-" + Date.now() + "@example.test" },
  });
  expect(await known.json()).toEqual(await unknown.json());
  expect(
    (
      await guest.request.post("/api/auth/forgot-password", {
        headers: { origin: "https://untrusted.example" },
        data: { email },
      })
    ).status(),
  ).toBe(403);
  await recovery.setViewportSize({ width: 320, height: 740 });
  await recovery.goto("/forgot-password");
  expect(
    await recovery.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await guest.close();
});

test("Quick Publish client previews stay private, pin layouts and independently authorize downloads and feedback", async ({
  page,
  browser,
}) => {
  const registration = await page.request.post("/api/auth/register", {
    data: {
      name: "Preview Owner",
      email: `preview-owner-${Date.now()}@example.test`,
      password: "preview-owner-password-123",
    },
  });
  expect(registration.status()).toBe(201);
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Quick Publish", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Quick Publish file")
    .setInputFiles({
      name: "private.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        "<h1>Captured client work</h1><script>window.top.stolen=true</script>",
      ),
    });
  await dialog
    .getByLabel("Project name", { exact: true })
    .fill("Secret client project");
  await dialog.getByRole("button", { name: "Save & preview" }).click();
  await expect(
    dialog.getByText("Static build available", { exact: false }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Create private client preview" })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Client preview password")
    .fill("client-preview-password-123");
  await dialog
    .getByLabel("Include saved static website layout", { exact: false })
    .check();
  await dialog.getByRole("button", { name: "Preview review contents" }).click();
  await expect(
    page
      .frameLocator('iframe[title="Client review layout preview"]')
      .getByRole("heading", { name: "Captured client work" }),
  ).toBeVisible();
  await dialog
    .getByLabel(
      "I reviewed these records, source contents and download permissions.",
    )
    .check();
  await dialog.getByRole("button", { name: "Create reviewed link" }).click();
  await expect(
    dialog.getByText("Frozen review link created.", { exact: true }),
  ).toBeVisible();
  const ws = await (await page.request.get("/api/workspace")).json(),
    project = ws.projects.find(
      (p: { name: string }) => p.name === "Secret client project",
    );
  const links = await (
      await page.request.get(`/api/projects/${project.id}/review-links`)
    ).json(),
    id = links.links[0].id;
  const guest = await browser.newContext({
      baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
    }),
    client = await guest.newPage();
  const initial = await guest.request.get(`/review/${id}`),
    initialHtml = await initial.text();
  expect(initialHtml).not.toContain("Secret client project");
  expect(initialHtml).not.toContain("Captured client work");
  expect((await guest.request.get(`/api/reviews/${id}`)).status()).toBe(401);
  expect(
    (
      await guest.request.get(`/api/reviews/${id}/file/${project.sourceId}`)
    ).status(),
  ).toBe(401);
  expect(
    (await guest.request.get(`/api/files/${project.sourceId}`)).status(),
  ).toBe(404);
  await client.goto(`/review/${id}`);
  await client.getByLabel("Preview password").fill("wrong-preview-password");
  await client.getByRole("button", { name: "Open client preview" }).click();
  await expect(
    client.getByText("The preview password does not match.", { exact: true }),
  ).toBeVisible();
  await client
    .getByLabel("Preview password")
    .fill("client-preview-password-123");
  await client.getByRole("button", { name: "Open client preview" }).click();
  await expect(
    client.getByRole("heading", { name: "Secret client project", exact: true }),
  ).toBeVisible();
  await expect(
    client
      .frameLocator('iframe[title="Captured website layout"]')
      .getByRole("heading", { name: "Captured client work" }),
  ).toBeVisible();
  expect(
    (
      await guest.request.get(`/api/reviews/${id}/file/${project.sourceId}`)
    ).status(),
  ).toBe(404);
  await client.getByLabel("Your name").fill("Client Reviewer");
  await client.getByLabel("Review decision").selectOption("Changes Requested");
  await client
    .getByLabel("Your feedback")
    .fill("Please add our approved illustration.");
  await client
    .getByLabel("Share this feedback with the owner", { exact: false })
    .check();
  await client.getByRole("button", { name: "Submit version feedback" }).click();
  await expect(
    client.getByText("Feedback attached to this reviewed version.", {
      exact: true,
    }),
  ).toBeVisible();
  const overview = await (
    await page.request.get(`/api/projects/${project.id}/review-links`)
  ).json();
  expect(overview.links[0].approval).toBe("Changes Requested");
  expect(JSON.stringify(overview)).not.toContain("client-preview-password-123");
  await client.setViewportSize({ width: 320, height: 740 });
  expect(
    await client.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await client.screenshot({
    path: ".data/secure-preview-mobile.png",
    fullPage: true,
  });
  const permissionOptions = {
    versionId: "",
    demo: false,
    feedback: false,
    source: true,
    screenshots: false,
    notes: false,
    days: 7,
    access: "password",
    password: "source-review-password-123",
  };
  const preview = await (
    await page.request.post(`/api/projects/${project.id}/review-preview`, {
      data: permissionOptions,
    })
  ).json();
  const sourceReview = await (
    await page.request.post(`/api/projects/${project.id}/review-create`, {
      data: {
        ...permissionOptions,
        digest: preview.preview.digest,
        confirmed: true,
      },
    })
  ).json();
  expect(
    (
      await guest.request.get(
        `/api/reviews/${sourceReview.id}/file/${project.sourceId}`,
      )
    ).status(),
  ).toBe(401);
  expect(
    (
      await guest.request.post(`/api/reviews/${sourceReview.id}/unlock`, {
        data: { password: permissionOptions.password },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await guest.request.get(
        `/api/reviews/${sourceReview.id}/file/${project.sourceId}`,
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await guest.request.post(`/api/reviews/${sourceReview.id}/feedback`, {
        data: {},
      })
    ).status(),
  ).toBe(403);
  const other = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
  });
  await other.request.post("/api/auth/register", {
    data: {
      name: "Other Owner",
      email: `other-preview-${Date.now()}@example.test`,
      password: "other-owner-password-123",
    },
  });
  expect(
    (
      await other.request.post(`/api/projects/${project.id}/review-revoke`, {
        data: { reviewId: id },
      })
    ).status(),
  ).toBe(404);
  await page.request.post(`/api/projects/${project.id}/review-revoke`, {
    data: { reviewId: id },
  });
  expect((await guest.request.get(`/api/reviews/${id}`)).status()).toBe(404);
  await client.reload();
  await expect(
    client.getByRole("heading", { name: "Review unavailable" }),
  ).toBeVisible();
  await other.close();
  await guest.close();
});

test("invited email access rejects outsiders without revealing the invite list", async ({
  page,
  browser,
}) => {
  test.skip(!dataDir, "Requires local email outbox on an isolated server.");
  const email = `client-${Date.now()}@example.test`;
  await page.request.post("/api/auth/register", {
    data: {
      name: "Invite Owner",
      email: `invite-owner-${Date.now()}@example.test`,
      password: "invite-owner-password-123",
    },
  });
  const project = (
    await (
      await page.request.post("/api/projects", {
        data: { name: "Email protected draft" },
      })
    ).json()
  ).project;
  const options = { access: "email", recipientEmails: [email], feedback: true };
  const preview = (
    await (
      await page.request.post(`/api/projects/${project.id}/review-preview`, {
        data: options,
      })
    ).json()
  ).preview;
  const link = await (
    await page.request.post(`/api/projects/${project.id}/review-create`, {
      data: { ...options, confirmed: true, digest: preview.digest },
    })
  ).json();
  const guest = await browser.newContext({
      baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
    }),
    client = await guest.newPage();
  await client.goto(link.url);
  await client
    .getByLabel("Invited email address")
    .fill("uninvited@example.test");
  await client.getByRole("button", { name: "Send access link" }).click();
  await expect(
    client.getByText("If this email is an invited recipient", { exact: false }),
  ).toBeVisible();
  expect(latestEmail("uninvited@example.test", "review")).toBe("");
  await client.getByLabel("Invited email address").fill(email);
  await client.getByRole("button", { name: "Send access link" }).click();
  await expect.poll(() => latestEmail(email, "review")).not.toBe("");
  const access = latestEmail(email, "review");
  await client.goto(access);
  await client.getByRole("button", { name: "Open client preview" }).click();
  await expect(
    client.getByRole("heading", { name: "Email protected draft", exact: true }),
  ).toBeVisible();
  const data = await (
    await guest.request.get(`/api/reviews/${link.id}`)
  ).json();
  expect(data.review.reviewerVerified).toBe(true);
  expect(JSON.stringify(data)).not.toContain(email);
  expect(
    (
      await guest.request.post(`/api/reviews/${link.id}/unlock`, {
        data: { token: access.split("token=")[1] },
      })
    ).status(),
  ).toBe(410);
  await guest.close();
});
