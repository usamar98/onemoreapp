import { test, expect } from "@playwright/test";
import JSZip from "jszip";
test("imports a real public GitHub repository with a pinned source snapshot", async ({
  page,
}) => {
  test.skip(
    process.env.LIVE_GITHUB_TEST !== "true",
    "Run with LIVE_GITHUB_TEST=true for a real network integration check.",
  );
  const account = await page.request.post("/api/auth/register", {
    data: {
      name: "GitHub Import Tester",
      email: `github-${Date.now()}@example.test`,
      password: "a-long-github-test-password",
    },
  });
  expect(account.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).click();
  await page
    .getByRole("button", { name: "GitHub repository", exact: true })
    .click();
  await page
    .getByLabel("Repository URL")
    .fill("https://github.com/octocat/Hello-World");
  await page
    .getByRole("button", { name: "Import repository", exact: true })
    .click();
  await expect(
    page
      .locator(".project-card")
      .getByRole("heading", { name: "Hello-World", exact: true }),
  ).toBeVisible({ timeout: 45000 });
  const workspace = await (await page.request.get("/api/workspace")).json();
  const p = workspace.projects.find(
    (p: { name: string }) => p.name === "Hello-World",
  );
  expect(p.version).toMatch(/^[a-f0-9]{40}$/);
  expect(p.repoInfo).toContain("Default branch:");
  expect(p.shared).toBe(false);
  expect(p.sourceId).toBeTruthy();
  expect(p.buildId).toBe("");
  const source = await page.request.get(`/api/files/${p.sourceId}`);
  expect(source.status()).toBe(200);
  const zip = await JSZip.loadAsync(await source.body());
  expect(Object.keys(zip.files).length).toBeGreaterThan(0);
});
