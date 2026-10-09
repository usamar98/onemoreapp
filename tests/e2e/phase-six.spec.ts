import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

test("reviewed preservation, honest build/recreation states, resumable package transfer and revocation keep the original private", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const registered = await page.request.post("/api/auth/register", {
    data: {
      name: "Preservation Owner",
      email: `preservation-${Date.now()}@example.test`,
      password: "phase-six-test-password",
    },
  });
  expect(registered.ok()).toBeTruthy();
  const created = await page.request.post("/api/projects", {
    data: {
      name: "Preservation Garden",
      description: "Resume a garden dashboard",
    },
  });
  expect(created.ok()).toBeTruthy();
  const project = (await created.json()).project;
  const zip = new JSZip();
  zip.file(
    "package.json",
    '{"name":"garden","scripts":{"build":"node build.js"}}',
  );
  zip.file(
    "package-lock.json",
    '{"name":"garden","lockfileVersion":3,"packages":{}}',
  );
  zip.file("build.js", 'console.log("Build garden")');
  zip.file("index.html", "<h1>Preserved Garden</h1>");
  const sourceComment = () =>
    "// " +
    randomBytes(900000)
      .toString("hex")
      .replace(/[0-9a-f]/g, (c) => String.fromCharCode(65 + parseInt(c, 16)));
  zip.file("src/large-a.ts", sourceComment());
  zip.file("src/large-b.ts", sourceComment());
  zip.file(".env", "API_KEY=exclude-from-all-packages");
  zip.file("customers.csv", "private contact data");
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Preserve & rebuild", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Saved project", { exact: true })
    .selectOption(project.id);
  await page.getByLabel("Resumable source ZIP", { exact: true }).setInputFiles({
    name: "garden.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await page.getByRole("button", { name: "Upload ZIP", exact: true }).click();
  await expect(
    page.getByText(/ZIP saved after chunk and full-file integrity checks/),
  ).toBeVisible();
  await page
    .getByLabel("Runtime requirements", { exact: true })
    .fill("Node.js 24");
  await page
    .getByLabel("Build instructions", { exact: true })
    .fill("npm ci --ignore-scripts; npm run build");
  await page
    .getByLabel("External services and assets not preserved", { exact: true })
    .fill("Database and domain stay with providers.");
  await page
    .getByRole("button", { name: "Review preservation contents", exact: true })
    .click();
  await expect(
    page.getByText("Eligible source files", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Select all eligible files", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review preservation contents", exact: true })
    .click();
  await page
    .getByLabel(
      "I reviewed the selected source, notes and screenshots and excluded credentials and customer data.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", { name: "Preserve", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Verify the saved build", exact: true }),
  ).toBeVisible();
  const bundles = await page.request.get(`/api/bundles/${project.id}`);
  expect(bundles.ok()).toBeTruthy();
  const bundle = (await bundles.json()).bundles[0];
  expect(bundle.data.bytes).toBeGreaterThan(1024 * 1024);
  const privateDownload = await page.request.get(
    `/api/bundles/${bundle.id}/download`,
  );
  expect(privateDownload.ok()).toBeTruthy();
  expect(
    createHash("sha256")
      .update(await privateDownload.body())
      .digest("hex"),
  ).toBe(bundle.data.packageSha256);
  expect(
    bundle.data.files.some(
      (f: { path: string }) => f.path === "source/package-lock.json",
    ),
  ).toBeTruthy();
  expect(
    bundle.data.files.some((f: { path: string }) =>
      /\.env|customers/.test(f.path),
    ),
  ).toBeFalsy();
  await page
    .getByRole("button", { name: "Verify Build", exact: true })
    .last()
    .click();
  await expect(
    page.getByText("Application functionality: Not Checked", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Not Checked", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Recreate Project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Preview recreation", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Ready for the next rebuild" })
      .getByRole("alert"),
  ).toContainText(/Park or archive|Connect your Vercel/);
  await page
    .getByRole("button", { name: "Share Package", exact: true })
    .first()
    .click();
  await page
    .getByLabel(
      "I reviewed this exact package version and approve sharing the selected source and screenshots.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", { name: "Share Package", exact: true })
    .last()
    .click();
  const link = await page
    .getByLabel("Copy this link now", { exact: true })
    .inputValue();
  expect(link).toContain("/package/");
  const guest = await browser.newContext(),
    guestPage = await guest.newPage();
  let chunkAttempts = 0;
  await guestPage.route("**/api/packages/**/chunk?**", async (route) => {
    if (chunkAttempts++ === 0)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Temporary transfer failure; retry this part.",
        }),
      });
    else await route.continue();
  });
  await guestPage.goto(link);
  await expect(
    guestPage.getByRole("heading", {
      name: "Preservation Garden",
      exact: true,
    }),
  ).toBeVisible();
  const download = guestPage.waitForEvent("download");
  await guestPage
    .getByRole("button", { name: "Download package", exact: true })
    .click();
  const received = await download;
  const receivedBytes = await readFile((await received.path())!);
  expect(createHash("sha256").update(receivedBytes).digest("hex")).toBe(
    bundle.data.packageSha256,
  );
  expect(chunkAttempts).toBeGreaterThan(2);
  await expect(
    guestPage.getByText(
      /complete package was received and its checksum verified/,
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revoke download link", exact: true })
    .click();
  await expect(
    page.getByText("Package link revoked", { exact: true }),
  ).toBeVisible();
  await guestPage.reload();
  await expect(
    guestPage.getByRole("heading", {
      name: "This package is unavailable",
      exact: true,
    }),
  ).toBeVisible();
  const denied = await guestPage.request.get(
    `/api/bundles/${bundle.id}/download`,
  );
  expect(denied.status()).toBe(401);
  const original = await page.request.get("/api/workspace");
  const current = (await original.json()).projects.find(
    (p: { id: string }) => p.id === project.id,
  );
  expect(current.shared).toBeFalsy();
  expect(current.hostingProjectId).toBe("");
  expect(current.sourceId).toBe(bundle.data.snapshot.uploadId);
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Preserve & rebuild", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Ready for the next rebuild",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
  await guest.close();
});
