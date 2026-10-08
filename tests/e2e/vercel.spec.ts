import { test, expect } from "@playwright/test";

test("Vercel connection settings and missing account instructions are clear", async ({
  page,
}) => {
  const started = await page.request.post("/api/auth/demo");
  expect(started.ok()).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: /Integrations/ }).click();
  await expect(
    page.getByRole("heading", { name: "Vercel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Netlify", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Connect Vercel" }).click();
  await expect(page.getByLabel("Personal access token")).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByLabel("Personal access token").fill("fixture-invalid-token");
  await page.getByLabel("Team ID (optional)").fill("invalid-team-id");
  await page.getByRole("button", { name: "Verify & connect" }).click();
  await expect(
    page.getByText(
      "Use a Vercel Team ID starting with team_, or leave it empty.",
    ),
  ).toBeVisible();
  const legacy = await page.request.post("/api/integrations/netlify", {
    data: { token: "fixture-invalid-token" },
  });
  expect(legacy.status()).toBe(400);
  const workspace = await (await page.request.get("/api/workspace")).json();
  expect(workspace.integrations).toHaveProperty("vercel", false);
  expect(workspace.integrations).not.toHaveProperty("netlify");
});
