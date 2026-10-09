import { test, expect } from "@playwright/test";
import JSZip from "jszip";
test("launch onboarding, reviewed automation, version feedback, opt-in portfolio, backup recovery and ownership", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now(),
    password = "phase-four-long-test-password";
  const registration = await page.request.post("/api/auth/register", {
    data: {
      name: "Launch Owner",
      email: "p4-owner-" + stamp + "@example.test",
      password,
    },
  });
  expect(registration.ok()).toBeTruthy();
  const owner = (await registration.json()).user;
  const create = await page.request.post("/api/projects", {
    data: {
      name: "Launch Garden",
      description: "A small project ready for its next chapter.",
      demoUrl: "https://example.com/demo",
    },
  });
  expect(create.ok()).toBeTruthy();
  let p = (await create.json()).project;
  const zip = new JSZip();
  zip.file("src/main.ts", "export const feature = 'upload progress';");
  zip.file("README.md", "Setup: npm install, then npm run dev.");
  zip.file("customers.csv", "email,name\nprivate@example.test,Private Person");
  zip.file(".env", "PRIVATE_KEY=do-not-export");
  const upload = await page.request.post("/api/projects/" + p.id + "/upload", {
    multipart: {
      kind: "source",
      file: {
        name: "garden.zip",
        mimeType: "application/zip",
        buffer: await zip.generateAsync({ type: "nodebuffer" }),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  p = (await upload.json()).project;
  expect(
    (
      await page.request.post("/api/projects/" + p.id + "/park", {
        data: {
          version: p.version,
          setup: "npm install",
          completed: "Upload interface",
          issues: "Needs better progress messages",
          reason: "Other work",
          nextTask: "Add upload progress",
          returnDate: "2020-01-01",
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Launch & automation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bring your existing work together." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Discover existing projects" })
    .click();
  await expect(
    page.getByRole("heading", { name: "No accessible projects found" }),
  ).toBeVisible();
  await expect(
    page.getByText("GitHub is not connected.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rules", exact: true }).click();
  await page.getByLabel("When to act").selectOption("return");
  await page.getByRole("button", { name: "Preview rule", exact: true }).click();
  await page.getByLabel("I reviewed this rule and its effect.").check();
  await page.getByRole("button", { name: "Enable reviewed rule" }).click();
  await expect(
    page.getByText("Launch Garden · return", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check trigger now" }).click();
  await expect(page.locator(".job-status")).toContainText("succeeded");
  const rules = (await (await page.request.get("/api/automations")).json())
    .rules;
  const rule = rules[0];
  const historyCount = rule.runs.length;
  expect(historyCount).toBe(1);
  await page.request.post("/api/automations/" + rule.id + "/run", { data: {} });
  expect(
    (await (await page.request.get("/api/automations")).json()).rules[0].runs
      .length,
  ).toBe(historyCount);
  await page.getByLabel("Rule on").uncheck();
  await expect(page.getByLabel("Rule on")).not.toBeChecked();
  await page.getByLabel("When to act").selectOption("brief");
  await page.getByRole("button", { name: "Preview rule", exact: true }).click();
  await page.getByLabel("I reviewed this rule and its effect.").check();
  await page.getByRole("button", { name: "Enable reviewed rule" }).click();
  await expect(
    page.getByText("Launch Garden · brief", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.post("/api/projects/" + p.id + "/task", {
        data: {
          nextTask: "Polish upload progress",
          taskMinutes: 30,
          blockers: "",
          taskPriority: "High",
        },
      })
    ).ok(),
  ).toBeTruthy();
  await expect
    .poll(async () => {
      const result = await (await page.request.get("/api/workspace")).json();
      return result.projects.find((item: { id: string }) => item.id === p.id)
        .brief;
    })
    .toContain("Polish upload progress");
  const briefRules = (await (await page.request.get("/api/automations")).json())
    .rules;
  expect(
    briefRules.find((item: { kind: string }) => item.kind === "brief").runs,
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Review links", exact: true }).click();
  await page.getByLabel("Include setup, notes and resume brief").check();
  await page.getByLabel("Allow demo viewing").check();
  await page.getByRole("button", { name: "Preview review contents" }).click();
  await page
    .getByLabel(
      "I reviewed these records, source contents and download permissions.",
    )
    .check();
  await page.getByRole("button", { name: "Create reviewed link" }).click();
  await expect(page.locator(".copy-link").first()).toBeVisible();
  const links = (
    await (
      await page.request.get("/api/projects/" + p.id + "/review-links")
    ).json()
  ).links;
  const reviewId = links[0].id;
  const guest = await browser.newContext({
      baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
    }),
    reviewPage = await guest.newPage();
  await reviewPage.goto("/review/" + reviewId);
  await expect(
    reviewPage.getByRole("heading", { name: "Launch Garden", exact: true }),
  ).toBeVisible();
  await expect(
    reviewPage.getByRole("link", { name: "View demo" }),
  ).toBeVisible();
  await expect(
    reviewPage.getByRole("link", { name: "Download reviewed source ZIP" }),
  ).toHaveCount(0);
  expect(
    (
      await guest.request.get(
        "/api/reviews/" + reviewId + "/file/" + p.sourceId,
      )
    ).status(),
  ).toBe(404);
  expect((await guest.request.get("/api/files/" + p.sourceId)).status()).toBe(
    404,
  );
  await reviewPage.getByLabel("Your name").fill("Client Reviewer");
  await reviewPage.getByLabel("Review decision").selectOption("Approved");
  await reviewPage
    .getByLabel("Your feedback")
    .fill("The captured upload interface looks good.");
  await reviewPage.getByLabel(/Share this feedback/).check();
  await reviewPage
    .getByRole("button", { name: "Submit version feedback" })
    .click();
  await expect(
    reviewPage.getByText("Approval status: Approved.", { exact: false }),
  ).toBeVisible();
  const sourceOptions = {
    versionId: "",
    demo: false,
    feedback: false,
    source: true,
    screenshots: false,
    notes: false,
    days: 1,
  };
  const sourcePreview = (
    await (
      await page.request.post("/api/projects/" + p.id + "/review-preview", {
        data: sourceOptions,
      })
    ).json()
  ).preview;
  expect(
    sourcePreview.sourceFiles.every(
      (f: { path: string }) => !f.path.includes("customers"),
    ),
  ).toBeTruthy();
  const sourceLink = (
    await (
      await page.request.post("/api/projects/" + p.id + "/review-create", {
        data: {
          ...sourceOptions,
          digest: sourcePreview.digest,
          confirmed: true,
        },
      })
    ).json()
  ).id;
  const sourceData = (
    await (await guest.request.get("/api/reviews/" + sourceLink)).json()
  ).review;
  expect(sourceData.sourceFiles).toBeUndefined();
  const sourceDownload = await guest.request.get(sourceData.sourceUrl);
  expect(sourceDownload.ok()).toBeTruthy();
  const safeZIP = await JSZip.loadAsync(await sourceDownload.body());
  expect(safeZIP.file("customers.csv")).toBeNull();
  expect(safeZIP.file("src/main.ts")).not.toBeNull();
  await page
    .getByRole("button", { name: "Public portfolio", exact: true })
    .click();
  await page.getByLabel("Portfolio title").fill("Launch Owner’s Garden");
  await page.getByLabel("Public portfolio address").fill("garden-" + stamp);
  await page
    .getByLabel("Launch Garden Parked", { exact: false })
    .count()
    .then(async (n) => {
      if (n)
        await page.getByLabel("Launch Garden Parked", { exact: false }).check();
      else
        await page
          .locator(".launch-card")
          .filter({ hasText: "Launch Garden" })
          .locator('input[type="checkbox"]')
          .first()
          .check();
    });
  await page.getByLabel("Project enquiries").check();
  await page.getByRole("button", { name: "Preview portfolio" }).click();
  await page
    .getByLabel("I reviewed the projects and public viewing options.")
    .check();
  await page
    .getByRole("button", { name: "Publish reviewed portfolio" })
    .click();
  const portfolioPage = await guest.newPage();
  await portfolioPage.goto("/portfolio/garden-" + stamp);
  const publicSitemap = await (await guest.request.get("/sitemap.xml")).text();
  expect(publicSitemap).toContain("/portfolio/garden-" + stamp + "</loc>");
  expect(publicSitemap).not.toContain("/review/" + reviewId);
  expect(publicSitemap).not.toMatch(/<loc>[^<]*\/dashboard/);
  await expect(
    portfolioPage.getByRole("heading", { name: "Launch Owner’s Garden" }),
  ).toBeVisible();
  await expect(
    portfolioPage.getByText("This project is currently inactive.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    portfolioPage.getByRole("link", { name: "Visit demo" }),
  ).toHaveCount(0);
  await portfolioPage
    .getByText("Enquire about this project", { exact: true })
    .click();
  await portfolioPage
    .getByLabel("Your email")
    .fill("portfolio-interest@example.test");
  await portfolioPage
    .getByLabel("Your enquiry")
    .fill("I would like to collaborate.");
  await portfolioPage.getByLabel(/Share my details privately/).check();
  await portfolioPage
    .getByRole("button", { name: "Send project enquiry" })
    .click();
  await expect(
    portfolioPage.getByText("Enquiry saved for the owner.", { exact: false }),
  ).toBeVisible();
  expect(
    (
      await (
        await page.request.get("/api/projects/" + p.id + "/interest")
      ).json()
    ).counts.enquiries,
  ).toBe(1);
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page
    .getByLabel("Launch Garden Parked", { exact: false })
    .count()
    .then(async (n) => {
      if (n)
        await page.getByLabel("Launch Garden Parked", { exact: false }).check();
      else
        await page
          .locator(".launch-card")
          .filter({ hasText: "Choose projects to back up" })
          .locator('input[type="checkbox"]')
          .first()
          .check();
    });
  await page.getByRole("button", { name: "Create private backup" }).click();
  await expect(page.locator(".job-status")).toContainText("succeeded");
  await expect(
    page.getByRole("link", { name: "Download private export" }),
  ).toBeVisible();
  const backups = (await (await page.request.get("/api/recovery")).json())
    .backups;
  const backupId = backups[0].id;
  expect(
    (
      await guest.request.get("/api/recovery/" + backupId + "/download")
    ).status(),
  ).toBe(401);
  const exported = await page.request.get(
    "/api/recovery/" + backupId + "/download",
  );
  const exportZIP = await JSZip.loadAsync(await exported.body());
  const records = await exportZIP.file("records.json")!.async("string");
  expect(records).not.toContain("PRIVATE_KEY");
  expect(records).not.toContain("portfolio-interest@example.test");
  expect(records).not.toContain(p.shareId);
  await page
    .getByRole("button", { name: "Review recovery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Preview recovery", exact: true })
    .click();
  await expect(
    page.getByText("Checksums and stored records verified.", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel(
      "I reviewed the selected records. Restore them as new private projects.",
    )
    .check();
  await page.getByRole("button", { name: "Restore reviewed records" }).click();
  await expect(
    page.getByRole("link", { name: "Launch Garden · recovered" }),
  ).toBeVisible();
  const workspace = (await (await page.request.get("/api/workspace")).json())
    .projects;
  const copy = workspace.find(
    (p: { name: string }) => p.name === "Launch Garden · recovered",
  );
  expect(copy.shared).toBe(false);
  expect(copy.hostingProjectId).toBe("");
  expect(copy.memory.setup).toBe("npm install");
  expect(copy.sourceId).not.toBe(p.sourceId);
  const viewer = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
  });
  const email = "p4-viewer-" + stamp + "@example.test";
  await viewer.request.post("/api/auth/register", {
    data: { name: "Viewer", email, password },
  });
  const invitation = await page.request.post(
    "/api/teams/" + owner.id + "/invite",
    { data: { email, role: "Viewer", scope: [p.id] } },
  );
  expect(invitation.ok()).toBeTruthy();
  const invite = (await invitation.json()).token;
  expect(
    (
      await viewer.request.post("/api/teams/accept", {
        data: { token: invite },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await viewer.request.post("/api/projects/" + p.id + "/sync", { data: {} })
    ).status(),
  ).toBe(403);
  expect(
    (
      await viewer.request.post("/api/projects/" + p.id + "/review-preview", {
        data: sourceOptions,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await viewer.request.get("/api/projects/" + copy.id + "/versions")
    ).status(),
  ).toBe(404);
  expect(
    (
      await viewer.request.post("/api/recovery/restore", {
        headers: { "x-chapter-workspace": owner.id },
        data: {
          backupId,
          digest: "invalid",
          selected: [p.id],
          confirmed: true,
        },
      })
    ).status(),
  ).toBe(404);
  await page.request.post("/api/projects/" + p.id + "/revival", {
    data: { build: false },
  });
  const brief = (
    await (
      await page.request.post("/api/projects/" + p.id + "/brief", {
        data: { generateAI: false },
      })
    ).json()
  ).project.brief;
  expect(
    (
      await page.request.post("/api/projects/" + p.id + "/resume", {
        data: { brief },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await (await guest.request.get("/api/reviews/" + reviewId)).json()).review
      .status,
  ).toBe("Parked");
  expect(
    (await (await guest.request.get("/api/showcase/garden-" + stamp)).json())
      .portfolio.projects[0].status,
  ).toBe("Building");
  await page.request.post("/api/projects/" + p.id + "/review-revoke", {
    data: { reviewId },
  });
  expect((await guest.request.get("/api/reviews/" + reviewId)).status()).toBe(
    404,
  );
  await page.request.delete("/api/showcase-settings");
  expect(await (await guest.request.get("/sitemap.xml")).text()).not.toContain(
    "/portfolio/garden-" + stamp + "</loc>",
  );
  expect(
    (await guest.request.get("/api/showcase/garden-" + stamp)).status(),
  ).toBe(404);
  await page
    .getByRole("button", { name: "Help & status", exact: true })
    .click();
  await page.getByLabel("Support subject").fill("Review link question");
  await page
    .getByLabel("What happened?")
    .fill("How do I revoke a link? API_KEY=private-value");
  await page.getByRole("button", { name: "Save support reference" }).click();
  await expect(
    page.getByText("Private support reference saved.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: "phase-four-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "phase-four-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Launch & automation", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(
    page.getByRole("button", { name: "Launch & automation", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
  await guest.close();
  await viewer.close();
});
