import { test, expect } from "@playwright/test";
import JSZip from "jszip";

test("team permissions, private memory, reviewed starter, version restore, notifications and billing limits", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now(),
    password = "phase-three-long-password";
  async function register(
    context: typeof page.request,
    name: string,
    email: string,
  ) {
    const r = await context.post("/api/auth/register", {
      data: { name, email, password },
    });
    expect(r.ok()).toBeTruthy();
    return (await r.json()).user;
  }
  const owner = await register(
    page.request,
    "Knowledge Owner",
    `p3-owner-${stamp}@example.test`,
  );
  const created = await page.request.post("/api/projects", {
    data: {
      name: "Reusable Lab",
      description: "An upload module with exact saved context.",
    },
  });
  expect(created.ok()).toBeTruthy();
  const p = (await created.json()).project;
  expect(
    (
      await page.request.post(`/api/projects/${p.id}/expenses`, {
        data: {
          label: "Recorded hosting estimate",
          category: "Hosting",
          amount: 12.5,
          currency: "USD",
          interval: "Monthly",
          continuesWhenParked: true,
        },
      })
    ).ok(),
  ).toBeTruthy();
  const hidden = (
    await (
      await page.request.post("/api/projects", {
        data: {
          name: "Hidden Research",
          description: "Private unreleased analytics engine.",
        },
      })
    ).json()
  ).project;
  const zip = new JSZip();
  zip.file("src/upload.ts", "export const feature = 'encrypted uploads';");
  zip.file("README.md", "Setup: npm install, then npm run dev.");
  zip.file("customers.csv", "name,email\nJane,jane@example.test");
  zip.file(".env", "API_KEY=private-value");
  const upload = await page.request.post(`/api/projects/${p.id}/upload`, {
    multipart: {
      kind: "source",
      file: {
        name: "lab.zip",
        mimeType: "application/zip",
        buffer: await zip.generateAsync({ type: "nodebuffer" }),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const sourceId = (await upload.json()).project.sourceId;
  expect(
    (
      await page.request.post(`/api/projects/${p.id}/share`, {
        data: {
          shared: true,
          shareRepo: false,
          shareFiles: false,
          shareDemo: false,
          shareScreenshots: false,
        },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.post(`/api/projects/${p.id}/interest-settings`, {
        data: {
          videoUrl: "",
          shareVideo: false,
          waitlistEnabled: true,
          enquiriesEnabled: true,
        },
      })
    ).ok(),
  ).toBeTruthy();
  const publicContext = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
  });
  expect(
    (
      await publicContext.request.post(`/api/public/${p.shareId}/visit`, {
        data: { visitor: crypto.randomUUID() },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await publicContext.request.post(`/api/public/${p.shareId}/signup`, {
        data: { email: `interest-${stamp}@example.test`, consent: true },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await publicContext.request.post(`/api/public/${p.shareId}/enquiry`, {
        data: {
          email: `enquiry-${stamp}@example.test`,
          message: "Please tell me when this returns.",
          consent: true,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await publicContext.close();
  await page.request.post(`/api/projects/${p.id}/park`, {
    data: {
      version: "v1",
      setup: "npm install, then npm run dev.",
      completed: "Encrypted uploads are implemented.",
      issues: "Import dialog still needs keyboard support.",
      reason: "Stopped after the upload module.",
      nextTask: "Add keyboard support to import dialog.",
      returnDate: "2026-01-01",
    },
  });
  const editorContext = await browser.newContext({
      baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
    }),
    editorPage = await editorContext.newPage();
  const editor = await register(
    editorPage.request,
    "Project Editor",
    `p3-editor-${stamp}@example.test`,
  );
  const invite = await page.request.post(`/api/teams/${owner.id}/invite`, {
    data: { email: editor.email, role: "Editor", scope: [p.id] },
  });
  expect(invite.ok()).toBeTruthy();
  const token = (await invite.json()).token;
  expect(
    (
      await editorPage.request.post("/api/teams/accept", { data: { token } })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await editorPage.request.post("/api/teams/accept", { data: { token } })
    ).status(),
  ).toBe(404);
  const ws = await (await editorPage.request.get("/api/workspace")).json();
  expect(ws.projects.map((r: { id: string }) => r.id)).toEqual([p.id]);
  expect(ws.projects[0].role).toBe("Editor");
  expect(
    (await editorPage.request.get(`/api/files/${sourceId}`)).ok(),
  ).toBeTruthy();
  expect(
    (
      await editorPage.request.post(`/api/projects/${p.id}/share`, {
        data: {
          shared: true,
          shareRepo: false,
          shareFiles: true,
          shareDemo: false,
          shareScreenshots: false,
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await editorPage.request.post(`/api/projects/${p.id}/hosting-preview`, {
        data: { target: "pause" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await editorPage.request.get(`/api/projects/${hidden.id}/versions`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await editorPage.request.post(`/api/projects/${p.id}/save-brief`, {
        data: { brief: "Editor draft: add keyboard support." },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await editorPage.request.post(`/api/projects/${p.id}/comments`, {
        data: { text: "The upload module is ready for review." },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.post(`/api/projects/${p.id}/assignment`, {
        data: { assigneeId: editor.id },
      })
    ).ok(),
  ).toBeTruthy();
  const notifications = await (
    await editorPage.request.get("/api/notifications")
  ).json();
  expect(
    notifications.notifications.some(
      (n: { kind: string }) => n.kind === "assignment",
    ),
  ).toBeTruthy();
  const memory = await editorPage.request.post("/api/memory", {
    headers: { "x-chapter-workspace": owner.id },
    data: { question: "encrypted uploads", useAI: false },
  });
  expect(memory.status()).toBe(202);
  const jobId = (await memory.json()).jobId;
  await expect
    .poll(
      async () =>
        (await (await editorPage.request.get(`/api/jobs/${jobId}`)).json()).job
          .state,
    )
    .toBe("succeeded");
  const answer = (
    await (await editorPage.request.get(`/api/jobs/${jobId}`)).json()
  ).job.result;
  expect(answer.sources.length).toBeGreaterThan(0);
  expect(
    answer.sources.every((s: { projectId: string }) => s.projectId === p.id),
  ).toBeTruthy();
  expect(JSON.stringify(answer)).not.toContain("Private unreleased analytics");
  const versions = await (
    await page.request.get(`/api/projects/${p.id}/versions`)
  ).json();
  const baseline = versions.versions.find(
    (v: { kind: string; data: { brief: string } }) =>
      v.kind === "brief" && !v.data.brief,
  );
  let preview = (
    await (
      await page.request.post(`/api/projects/${p.id}/restore-preview`, {
        data: { versionId: baseline.id },
      })
    ).json()
  ).preview;
  expect(
    (
      await page.request.post(`/api/projects/${p.id}/restore`, {
        data: {
          versionId: baseline.id,
          reviewed: false,
          digest: preview.digest,
        },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await editorPage.request.post(`/api/projects/${p.id}/save-brief`, {
        data: { brief: "A newer draft arrived during review." },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.post(`/api/projects/${p.id}/restore`, {
        data: {
          versionId: baseline.id,
          reviewed: true,
          digest: preview.digest,
        },
      })
    ).status(),
  ).toBe(409);
  preview = (
    await (
      await page.request.post(`/api/projects/${p.id}/restore-preview`, {
        data: { versionId: baseline.id },
      })
    ).json()
  ).preview;
  const restored = await page.request.post(`/api/projects/${p.id}/restore`, {
    data: { versionId: baseline.id, reviewed: true, digest: preview.digest },
  });
  expect(restored.ok()).toBeTruthy();
  expect((await restored.json()).project.status).toBe("Parked");
  expect(
    (
      await page.request.post(`/api/projects/${p.id}/environment-names`, {
        data: { names: ["SECRET_API_KEY", "DATABASE_URL"] },
      })
    ).ok(),
  ).toBeTruthy();
  const starterPreview = (
    await (
      await page.request.post(`/api/projects/${p.id}/template-preview`, {
        data: { name: "Upload Starter", paths: ["src/upload.ts", "README.md"] },
      })
    ).json()
  ).preview;
  expect(starterPreview.files).toHaveLength(2);
  expect(starterPreview.excluded).toContain("customers.csv");
  expect(starterPreview.documentation).toContain("SECRET_API_KEY");
  const starter = await page.request.post(
    `/api/projects/${p.id}/template-create`,
    {
      data: {
        name: "Upload Starter",
        paths: ["src/upload.ts", "README.md"],
        reviewed: true,
        digest: starterPreview.digest,
      },
    },
  );
  expect(starter.ok()).toBeTruthy();
  const templateId = (await starter.json()).template.id;
  expect(
    (await editorPage.request.get(`/api/templates/${templateId}`)).status(),
  ).toBe(404);
  const template = (
    await (await page.request.get(`/api/templates/${templateId}`)).json()
  ).template;
  const independent = await page.request.post(
    `/api/templates/${templateId}/use`,
    {
      data: {
        name: "Independent Lab",
        reviewed: true,
        digest: template.digest,
      },
    },
  );
  expect(independent.ok()).toBeTruthy();
  const independentP = (await independent.json()).project;
  expect(independentP.id).not.toBe(p.id);
  expect(independentP.sourceId).not.toBe(sourceId);
  expect(independentP.repository).toBe("");
  expect(independentP.hostingProjectId).toBe("");
  expect(independentP.shared).toBe(false);
  expect(independentP.setupChecklist.length).toBeGreaterThan(0);
  // Free includes the owner and one collaborator; pending invitations reserve seats.
  const overSeat = await page.request.post(`/api/teams/${owner.id}/invite`, {
    data: { email: `extra-${stamp}@example.test`, role: "Viewer", scope: null },
  });
  expect(overSeat.status()).toBe(409);
  expect((await overSeat.json()).error).toContain("seats limit");
  expect(
    (
      await page.request.delete(`/api/teams/${owner.id}/member`, {
        data: { userId: editor.id },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await editorPage.request.get(`/api/files/${sourceId}`)).status(),
  ).toBe(404);
  expect((await editorPage.request.get(`/api/jobs/${jobId}`)).status()).toBe(
    404,
  );
  const viewerInvite = (
    await (
      await page.request.post(`/api/teams/${owner.id}/invite`, {
        data: { email: editor.email, role: "Viewer", scope: [p.id] },
      })
    ).json()
  ).token;
  expect(
    (
      await editorPage.request.post("/api/teams/accept", {
        data: { token: viewerInvite },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await editorPage.request.post(`/api/projects/${p.id}/save-brief`, {
        data: { brief: "Forbidden" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await editorPage.request.post(`/api/projects/${p.id}/comments`, {
        data: { text: "Viewer can discuss." },
      })
    ).ok(),
  ).toBeTruthy();
  const billing = await (
    await page.request.get(`/api/billing/${owner.id}`)
  ).json();
  expect(billing.plan).toBe("Free");
  expect(billing.usage.projects).toBe(3);
  const portfolio = await (
    await page.request.get("/api/portfolio?days=30")
  ).json();
  const row = portfolio.entries.find((r: { id: string }) => r.id === p.id);
  expect(row.costs.USD).toBe(12.5);
  expect(row.expenses[0].origin).toBe("Manual estimate");
  expect(row.interest).toEqual({ visit: 1, signup: 1, enquiry: 1 });
  expect(row.previousInterest.signup).toBe(0);
  const ownerInbox = await (
    await page.request.get("/api/notifications")
  ).json();
  expect(
    ownerInbox.notifications.some(
      (n: { kind: string }) => n.kind === "enquiry",
    ),
  ).toBeTruthy();
  expect(
    (
      await editorPage.request.post(`/api/billing/${owner.id}/checkout`, {
        data: { plan: "Team" },
      })
    ).status(),
  ).toBe(403);
  if (!billing.configured)
    expect(
      (
        await page.request.post(`/api/billing/${owner.id}/checkout`, {
          data: { plan: "Pro" },
        })
      ).status(),
    ).toBe(503);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Project memory", exact: true })
    .click();
  await page.getByLabel("Ask your project memory").fill("Where did I stop?");
  await page.getByLabel("Use AI when configured").uncheck();
  await page
    .getByRole("button", { name: "Search memory", exact: true })
    .click();
  await expect(page.getByText("Saved notes", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Stopped after the upload module.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page
    .getByRole("button", { name: "Portfolio overview", exact: true })
    .click();
  await expect(page.getByRole("table")).toContainText("Reusable Lab");
  await page.screenshot({ path: "phase-three-portfolio.png" });
  await page.getByRole("button", { name: "Close panel" }).click();
  await page
    .getByRole("button", { name: "Open Reusable Lab", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Collaboration & records", exact: true })
    .click();
  await page.getByRole("tab", { name: "Versions", exact: true }).click();
  await expect(page.getByLabel("Choose a stored version")).toBeVisible();
  await page.screenshot({ path: "phase-three-versions.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "phase-three-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Close panel" }).click();
  const check = await page.request.post(`/api/projects/${p.id}/revival`, {
    data: { build: false },
    maxRetries: 2,
  });
  expect(check.ok()).toBeTruthy();
  const resume = await page.request.post(`/api/projects/${p.id}/resume`, {
    data: { brief: "Resume keyboard support from saved notes." },
  });
  expect(resume.ok()).toBeTruthy();
  expect((await resume.json()).project.status).toBe("Building");
  await page.reload();
  expect(
    (await (await page.request.get("/api/workspace")).json()).projects.find(
      (r: { id: string }) => r.id === p.id,
    ).status,
  ).toBe("Building");
  expect(errors).toEqual([]);
  await editorContext.close();
});
