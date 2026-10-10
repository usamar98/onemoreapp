import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { samplePdf, samplePng } from "../fixtures/quick-publish";

test("Quick Publish reviews HTML safely, shares selected PDFs/images, pins updates and enforces access", async ({
  page,
  browser,
}) => {
  const registration = await page.request.post("/api/auth/register", {
    data: {
      name: "Publisher",
      email: `publisher-${Date.now()}@example.test`,
      password: "correct-horse-publish-2026",
    },
  });
  expect(registration.ok()).toBeTruthy();
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Quick Publish", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Quick Publish file").setInputFiles({
    name: "hello.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      "<!doctype html><h1>Private layout</h1><script>window.top.__quickPublishInjected=true</script>",
    ),
  });
  await dialog
    .getByLabel("Project name", { exact: true })
    .fill("Quick Preview");
  await dialog.getByRole("button", { name: "Save & preview" }).click();
  await expect(
    dialog.getByText("Static build available", { exact: false }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Safe website layout preview"]')
      .getByRole("heading", { name: "Private layout" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __quickPublishInjected?: boolean })
          .__quickPublishInjected,
    ),
  ).toBeUndefined();
  await expect(dialog.locator("iframe")).toHaveAttribute("sandbox", "");
  await dialog.evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({
    path: ".data/quick-publish-desktop.png",
    fullPage: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Connect Vercel to deploy" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Publish project page", exact: true }),
  ).toBeDisabled();
  let ws = await (await page.request.get("/api/workspace")).json();
  let project = ws.projects.find(
    (p: { name: string }) => p.name === "Quick Preview",
  );
  const visitor = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
  });
  expect(
    (
      await visitor.request.get(`/api/projects/${project.id}/quick-preview`)
    ).status(),
  ).toBe(401);
  expect(
    (await visitor.request.get(`/api/files/${project.sourceId}`)).status(),
  ).toBe(404);
  await dialog
    .getByLabel("I reviewed the content and publishing checks.")
    .check();
  await dialog
    .getByRole("button", { name: "Publish project page", exact: true })
    .click();
  await expect(dialog.getByLabel("Published project link")).toBeVisible();
  expect(
    (await visitor.request.get(`/api/files/${project.sourceId}`)).status(),
  ).toBe(404);
  const source = project.sourceId;
  await dialog.getByLabel("Allow source ZIP download").check();
  await dialog.getByRole("button", { name: "Update sharing settings" }).click();
  await expect(
    dialog.getByRole("button", { name: "Update sharing settings" }),
  ).toBeEnabled();
  expect((await visitor.request.get(`/api/files/${source}`)).status()).toBe(
    200,
  );
  await dialog.getByLabel("Quick Publish file").setInputFiles({
    name: "updated.html",
    mimeType: "text/html",
    buffer: Buffer.from("<h1>Unpublished replacement</h1>"),
  });
  await dialog.getByRole("button", { name: "Save & preview" }).click();
  await expect(
    page
      .frameLocator('iframe[title="Safe website layout preview"]')
      .getByRole("heading", { name: "Unpublished replacement" }),
  ).toBeVisible();
  project = (await (await page.request.get("/api/workspace")).json())
    .projects[0];
  expect(project.sourceId).not.toBe(source);
  expect(
    (await visitor.request.get(`/api/files/${project.sourceId}`)).status(),
  ).toBe(404);
  expect((await visitor.request.get(`/api/files/${source}`)).status()).toBe(
    200,
  );
  await dialog.getByLabel("Quick Publish file").setInputFiles({
    name: "guide.pdf",
    mimeType: "application/pdf",
    buffer: samplePdf(),
  });
  await dialog.getByRole("button", { name: "Save & preview" }).click();
  await expect(
    dialog.getByText("PDF ready for review", { exact: true }),
  ).toBeVisible();
  project = (await (await page.request.get("/api/workspace")).json())
    .projects[0];
  const pdfId = project.documentIds[0];
  expect(
    (await visitor.request.get(`/api/files/${pdfId}?preview=1`)).status(),
  ).toBe(404);
  await dialog.getByLabel(/Include PDF documents/).check();
  await dialog.getByLabel("Allow source ZIP download").uncheck();
  await dialog
    .getByLabel("I reviewed the content and publishing checks.")
    .check();
  await dialog.getByRole("button", { name: "Update sharing settings" }).click();
  await expect(
    dialog.getByRole("button", { name: "Update sharing settings" }),
  ).toBeEnabled();
  const pdfResponse = await visitor.request.get(
    `/api/files/${pdfId}?preview=1`,
  );
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
  expect(pdfResponse.headers()["content-security-policy"]).toContain("sandbox");
  const publicPage = await visitor.newPage();
  await publicPage.goto(`/p/${project.shareId}`);
  await expect(
    publicPage.getByRole("heading", { name: "Project documents" }),
  ).toBeVisible();
  await expect(
    publicPage.getByRole("link", { name: "Open PDF" }),
  ).toBeVisible();
  await dialog.getByLabel("Quick Publish file").setInputFiles({
    name: "image.png",
    mimeType: "image/png",
    buffer: samplePng,
  });
  await dialog.getByRole("button", { name: "Save & preview" }).click();
  await expect(
    dialog.getByRole("img", { name: "Quick Preview uploaded image preview" }),
  ).toBeVisible();
  await dialog.getByLabel(/Include images/).check();
  await dialog
    .getByLabel("I reviewed the content and publishing checks.")
    .check();
  await dialog.getByRole("button", { name: "Update sharing settings" }).click();
  await expect(
    dialog.getByRole("button", { name: "Update sharing settings" }),
  ).toBeEnabled();
  project = (await (await page.request.get("/api/workspace")).json())
    .projects[0];
  expect(
    (
      await visitor.request.get(`/api/files/${project.screenshotIds[0]}`)
    ).status(),
  ).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () =>
        document.querySelector("dialog")!.scrollWidth <=
        document.querySelector("dialog")!.clientWidth,
    ),
  ).toBeTruthy();
  await dialog.evaluate((element) => element.scrollTo(0, 0));
  await page.screenshot({
    path: ".data/quick-publish-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole("button", { name: "Make page private" }).click();
  await expect(
    dialog.getByRole("button", { name: "Publish project page", exact: true }),
  ).toBeVisible();
  expect((await visitor.request.get(`/api/files/${pdfId}`)).status()).toBe(404);
  expect(
    (
      await visitor.request.get(`/api/files/${project.screenshotIds[0]}`)
    ).status(),
  ).toBe(404);
  await visitor.close();
});

test("source-only ZIPs, rejected credentials, duplicate retries, roles and project limits are handled honestly", async ({
  page,
  browser,
}) => {
  const registration = await page.request.post("/api/auth/register", {
    data: {
      name: "Checks",
      email: `checks-${Date.now()}@example.test`,
      password: "correct-horse-publish-2026",
    },
  });
  const owner = (await registration.json()).user;
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Quick Publish", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  const zip = new JSZip();
  zip.file("package.json", '{"scripts":{"build":"vite build"}}');
  zip.file("index.html", "<h1>Unbuilt source</h1>");
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  await dialog.getByLabel("Quick Publish file").setInputFiles({
    name: "source.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await dialog.getByRole("button", { name: "Save & preview" }).click();
  await expect(dialog.getByText(/no supported static build/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /deploy/i })).toHaveCount(0);
  let project = (await (await page.request.get("/api/workspace")).json())
    .projects[0];
  const retry = await page.request.post(`/api/projects/${project.id}/upload`, {
    multipart: {
      kind: "quick",
      file: { name: "source.zip", mimeType: "application/zip", buffer: bytes },
    },
  });
  expect(retry.ok()).toBeTruthy();
  expect((await retry.json()).project.sourceId).toBe(project.sourceId);
  const denied = await page.request.post(`/api/projects/${project.id}/upload`, {
    multipart: {
      kind: "quick",
      file: {
        name: "secret.html",
        mimeType: "text/html",
        buffer: Buffer.from(
          '<h1>Oops</h1><script>const api_key="private-value";</script>',
        ),
      },
    },
  });
  expect(denied.status()).toBe(400);
  const stranger = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
  });
  const otherRegistration = await stranger.request.post("/api/auth/register", {
    data: {
      name: "Other",
      email: `other-${Date.now()}@example.test`,
      password: "correct-horse-publish-2026",
    },
  });
  const other = (await otherRegistration.json()).user;
  expect(
    (
      await stranger.request.get(`/api/projects/${project.id}/quick-preview`)
    ).status(),
  ).toBe(404);
  expect(
    (await stranger.request.get(`/api/files/${project.sourceId}`)).status(),
  ).toBe(404);
  const invitation = await page.request.post(`/api/teams/${owner.id}/invite`, {
    data: { email: other.email, role: "Editor", scope: [project.id] },
  });
  expect(invitation.ok()).toBeTruthy();
  expect(
    (
      await stranger.request.post("/api/teams/accept", {
        data: { token: (await invitation.json()).token },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await stranger.request.get(`/api/projects/${project.id}/quick-preview`)
    ).ok(),
  ).toBeTruthy();
  expect(
    (await stranger.request.get(`/api/files/${project.sourceId}`)).ok(),
  ).toBeTruthy();
  const memberPdf = await stranger.request.post(
    `/api/projects/${project.id}/upload`,
    {
      multipart: {
        kind: "quick",
        file: {
          name: "editor.pdf",
          mimeType: "application/pdf",
          buffer: samplePdf(),
        },
      },
    },
  );
  expect(memberPdf.ok()).toBeTruthy();
  project = (await memberPdf.json()).project;
  expect(
    (
      await stranger.request.post(`/api/projects/${project.id}/share`, {
        data: {
          shared: true,
          shareRepo: false,
          shareFiles: false,
          shareDemo: false,
          shareScreenshots: false,
          shareDocuments: true,
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await stranger.request.post(`/api/projects/${project.id}/deploy`)
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.patch(`/api/teams/${owner.id}/member`, {
        data: { userId: other.id, role: "Viewer" },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await stranger.request.get(`/api/files/${project.documentIds[0]}`)).ok(),
  ).toBeTruthy();
  expect(
    (
      await stranger.request.post(`/api/projects/${project.id}/upload`, {
        multipart: {
          kind: "quick",
          file: {
            name: "viewer.pdf",
            mimeType: "application/pdf",
            buffer: samplePdf("Viewer edit"),
          },
        },
      })
    ).status(),
  ).toBe(403);
  for (let i = 1; i < 10; i++)
    expect(
      (
        await page.request.post("/api/projects", {
          data: { name: "Quota " + i },
        })
      ).ok(),
    ).toBeTruthy();
  const overQuota = await page.request.post("/api/projects", {
    data: { name: "Over quota" },
  });
  expect(overQuota.status()).toBe(409);
  expect((await overQuota.json()).error).toMatch(/limit|upgrade|Free/i);
  await stranger.close();
});
