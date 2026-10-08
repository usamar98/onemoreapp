import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
test("reviewed bulk import, read-only sync, durable deduplicated rules, private export and recovery", async () => {
  process.env.CHAPTER_DATA_DIR = path.join(
    process.cwd(),
    ".data",
    "phase-four-unit-" + randomUUID(),
  );
  const { db } = await import("../src/lib/database");
  const {
    newProject,
    insertProject,
    getProject,
    saveProject,
    saveToken,
    storeUpload,
  } = await import("../src/lib/db");
  const { ensureWorkspace } = await import("../src/lib/access");
  const { discoverProjects, commitImport, syncProject } =
    await import("../src/lib/connections");
  const { queueRule, notesFingerprint, rulePreview } =
    await import("../src/lib/automation");
  const { runJob, runPending, enqueue } = await import("../src/lib/jobs");
  const {
    buildExport,
    readExport,
    restoreExport,
    createBackup,
    backupBytes,
    recoveryTicket,
  } = await import("../src/lib/recovery");
  const { reviewPreview, reviewData, reviewFile } =
    await import("../src/lib/reviews");
  const { portfolioPreview, publishedPortfolio } =
    await import("../src/lib/public-portfolio");
  const { usage } = await import("../src/lib/billing");
  const { discardNewProject } = await import("../src/lib/import-cleanup");
  for (const id of ["owner", "editor", "viewer", "outsider"])
    await db()
      .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
      .run(id, id, id + "@example.test", "unused", 0);
  await ensureWorkspace("owner");
  await db()
    .prepare("INSERT INTO upload_tickets VALUES(?,?,?,?,?,?,?,?)")
    .run(
      "recovery-ticket",
      "owner",
      "owner",
      "owner",
      "recovery",
      "owner/staging/recovery",
      100,
      Date.now() + 60000,
    );
  assert.equal(
    (await recoveryTicket("owner", "owner", "recovery-ticket")).size,
    100,
  );
  await assert.rejects(
    recoveryTicket("outsider", "owner", "recovery-ticket"),
    /not found/,
  );
  await db()
    .prepare("INSERT INTO members VALUES(?,?,?,?,?)")
    .run("owner", "editor", "Editor", null, new Date().toISOString());
  await db()
    .prepare("INSERT INTO members VALUES(?,?,?,?,?)")
    .run("owner", "viewer", "Viewer", null, new Date().toISOString());
  await assert.rejects(
    recoveryTicket("viewer", "owner", "recovery-ticket"),
    /full workspace/,
  );
  await assert.rejects(
    recoveryTicket("editor", "owner", "recovery-ticket"),
    /belongs to another/,
  );
  await db()
    .prepare("UPDATE upload_tickets SET expires=0 WHERE id=?")
    .run("recovery-ticket");
  await assert.rejects(
    recoveryTicket("owner", "owner", "recovery-ticket"),
    /expired/,
  );
  await db()
    .prepare("DELETE FROM upload_tickets WHERE id=?")
    .run("recovery-ticket");
  await saveToken("owner", "github", "github-unit-token-never-share");
  await saveToken("owner", "vercel", "vercel-unit-token-never-share");
  const fetchOriginal = global.fetch,
    calls: { url: string; method: string }[] = [];
  const provider = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method || "GET" });
    if (url.includes("/user/repos"))
      return Response.json([
        {
          id: 1,
          name: "Exact",
          html_url: "https://github.com/team/exact",
          description: "Saved description",
          default_branch: "main",
          updated_at: "2026-10-01",
        },
        {
          id: 2,
          name: "uncertain",
          html_url: "https://github.com/team/uncertain",
          description: "",
          default_branch: "main",
        },
      ]);
    if (url.includes("/v9/projects?"))
      return Response.json({
        projects: [
          {
            id: "prj_exact",
            name: "actual-deployment",
            link: { type: "github", org: "team", repo: "exact" },
            paused: false,
            targets: {
              production: {
                id: "dpl_live",
                url: "demo.vercel.app",
                readyState: "READY",
              },
            },
          },
          { id: "prj_uncertain", name: "uncertain", paused: false },
        ],
      });
    if (url.includes("/v9/projects/prj_exact"))
      return Response.json({
        id: "prj_exact",
        name: "actual-deployment",
        paused: false,
        targets: {
          production: {
            id: "dpl_new",
            url: "new.vercel.app",
            readyState: "READY",
          },
        },
      });
    if (url.endsWith("/readme"))
      return new Response(
        "Setup: npm install. Implement upload validation next.",
      );
    if (url.includes("/commits/"))
      return Response.json({ sha: "b".repeat(40) });
    if (url.includes("/repos/team/exact"))
      return Response.json({
        name: "Exact",
        html_url: "https://github.com/team/exact",
        default_branch: "main",
        language: "TypeScript",
      });
    return Response.json({ error: "unexpected request" }, { status: 500 });
  };
  try {
    const discovery = await discoverProjects(
      "owner",
      "owner",
      provider as typeof fetch,
    );
    assert.equal(discovery.repositories[0].matches[0].certain, true);
    assert.equal(discovery.repositories[1].matches[0].certain, false);
    await assert.rejects(
      discoverProjects("owner", "editor", provider as typeof fetch),
      /billing owner/,
    );
    const imported = await commitImport("owner", "owner", discovery.id, [
      { key: "repo:1", deploymentId: "prj_exact" },
    ]);
    assert.equal(imported[0].state, "Imported privately");
    const id = imported[0].id;
    const again = await commitImport("owner", "owner", discovery.id, [
      { key: "repo:1", deploymentId: "prj_exact" },
    ]);
    assert.equal(again[0].id, id);
    assert.equal((await usage("owner")).projects, 1);
    const originalLimits = process.env.CHAPTER_PLAN_LIMITS;
    process.env.CHAPTER_PLAN_LIMITS = JSON.stringify({ Free: { projects: 1 } });
    try {
      const limited = await commitImport("owner", "owner", discovery.id, [
        { key: "repo:2", deploymentId: "" },
      ]);
      assert.match(limited[0].state, /projects limit/);
      assert.equal((await usage("owner")).projects, 1);
    } finally {
      if (originalLimits === undefined) delete process.env.CHAPTER_PLAN_LIMITS;
      else process.env.CHAPTER_PLAN_LIMITS = originalLimits;
    }
    let p = await getProject(id, "owner");
    assert.equal(p.shared, false);
    assert.equal(p.sourceId, "");
    p.version = "a".repeat(40);
    p.status = "Parked";
    p.nextTask = "Fix upload validation";
    p.memory = {
      version: p.version,
      setup: "npm install",
      completed: "Upload form",
      issues: "Missing progress",
      reason: "Paused for other work",
      nextTask: p.nextTask,
      returnDate: "2026-01-01",
    };
    await saveProject(p, "owner");
    global.fetch = provider as typeof fetch;
    await syncProject("owner", id);
    p = await getProject(id, "owner");
    assert.equal(p.sync?.repository?.sha, "b".repeat(40));
    assert.equal(p.version, "a".repeat(40));
    assert.equal(p.status, "Parked");
    assert.equal(p.demoUrl, "https://demo.vercel.app/");
    assert.ok(calls.every((c) => c.method === "GET"));
    await assert.rejects(syncProject("editor", id), /does not permit/);
    global.fetch = async () => Response.json({}, { status: 401 });
    await assert.rejects(syncProject("owner", id), /GitHub|Vercel/);
    p = await getProject(id, "owner");
    assert.ok(p.sync?.error);
    assert.ok(p.sync?.succeededAt);
    global.fetch = provider as typeof fetch;
    const ruleId = randomUUID();
    await db()
      .prepare("INSERT INTO automation_rules VALUES(?,?,?,?,?,?,?,?)")
      .run(
        ruleId,
        "owner",
        "owner",
        id,
        "brief",
        1,
        JSON.stringify({ baseline: notesFingerprint(p), days: 30 }),
        new Date().toISOString(),
      );
    assert.equal(await queueRule(ruleId), null);
    p.nextTask = "Add progress feedback";
    await saveProject(p, "owner");
    const jobId = (await queueRule(ruleId))!;
    assert.ok(jobId);
    assert.equal(await queueRule(ruleId), jobId);
    await runJob(jobId);
    p = await getProject(id, "owner");
    assert.ok(p.brief.includes("Add progress feedback"));
    assert.equal(
      (
        await db()
          .prepare("SELECT state FROM automation_runs WHERE job_id=?")
          .get(jobId)
      )?.state,
      "succeeded",
    );
    const versionsBefore = (
      await db()
        .prepare("SELECT id FROM versions WHERE project_id=? AND kind='brief'")
        .all(id)
    ).length;
    await runJob(jobId);
    assert.equal(
      (
        await db()
          .prepare(
            "SELECT id FROM versions WHERE project_id=? AND kind='brief'",
          )
          .all(id)
      ).length,
      versionsBefore,
    );
    assert.equal(await queueRule(ruleId), null);
    p.nextTask = "Fix upload validation";
    await saveProject(p, "owner");
    const restoredNotesJob = (await queueRule(ruleId))!;
    assert.ok(restoredNotesJob);
    await runJob(restoredNotesJob);
    p = await getProject(id, "owner");
    assert.ok(p.brief.includes("Fix upload validation"));
    p.nextTask = "Add progress feedback";
    await saveProject(p, "owner");
    const repeatedContentJob = (await queueRule(ruleId))!;
    assert.ok(repeatedContentJob);
    assert.notEqual(repeatedContentJob, jobId);
    await runJob(repeatedContentJob);
    p = await getProject(id, "owner");
    assert.ok(p.brief.includes("Add progress feedback"));
    assert.equal(await queueRule(ruleId), null);
    p.nextTask = "Changed while off";
    await saveProject(p, "owner");
    const offJob = (await queueRule(ruleId))!;
    await db()
      .prepare("UPDATE automation_rules SET enabled=0 WHERE id=?")
      .run(ruleId);
    await runJob(offJob);
    assert.equal(
      (
        await db()
          .prepare("SELECT state FROM automation_runs WHERE job_id=?")
          .get(offJob)
      )?.state,
      "skipped",
    );
    const zip = new JSZip();
    zip.file("src/main.ts", "export const ready = true;");
    zip.file("README.md", "Setup: npm install.");
    zip.file("customers.csv", "private,contact@example.test");
    p = await getProject(id, "owner");
    p.sourceId = await storeUpload(
      "owner",
      id,
      "source.zip",
      "source",
      "application/zip",
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    p.sourceName = "source.zip";
    await saveProject(p, "owner");
    const opts = {
      versionId: "",
      demo: false,
      source: false,
      feedback: true,
      screenshots: false,
      notes: false,
      days: 7,
    };
    await assert.rejects(reviewPreview("editor", id, opts), /does not permit/);
    const preview = await reviewPreview("owner", id, opts),
      reviewId = randomUUID();
    await db()
      .prepare("INSERT INTO review_links VALUES(?,?,?,?,?,?,?,?)")
      .run(
        reviewId,
        id,
        "owner",
        "owner",
        JSON.stringify(preview),
        Date.now() + 60000,
        0,
        new Date().toISOString(),
      );
    assert.equal((await reviewData(reviewId)).sourceUrl, "");
    await assert.rejects(reviewFile(reviewId, p.sourceId), /not included/);
    const sourcePreview = await reviewPreview("owner", id, {
      ...opts,
      source: true,
    });
    assert.ok(
      sourcePreview.sourceFiles?.every((f) => !f.path.includes("customers")),
    );
    const sourceReview = randomUUID();
    delete sourcePreview.sourceFiles;
    await db()
      .prepare("INSERT INTO review_links VALUES(?,?,?,?,?,?,?,?)")
      .run(
        sourceReview,
        id,
        "owner",
        "owner",
        JSON.stringify(sourcePreview),
        Date.now() + 60000,
        0,
        new Date().toISOString(),
      );
    const publicZIP = await JSZip.loadAsync(
      (await reviewFile(sourceReview, p.sourceId)).bytes,
    );
    assert.ok(!publicZIP.file("customers.csv"));
    assert.ok(publicZIP.file("src/main.ts"));
    p.name = "Changed after review";
    await saveProject(p, "owner");
    assert.equal((await reviewData(reviewId)).name, "Exact");
    await db()
      .prepare("UPDATE review_links SET revoked=1 WHERE id=?")
      .run(reviewId);
    await assert.rejects(reviewData(reviewId), /expired or was revoked/);
    await db()
      .prepare("UPDATE review_links SET expires=0 WHERE id=?")
      .run(sourceReview);
    await assert.rejects(
      reviewFile(sourceReview, p.sourceId),
      /expired or was revoked/,
    );
    const portfolio = {
      title: "Selected work",
      intro: "Opt-in",
      accent: "mint" as const,
      projects: [{ id, demo: false, screenshots: false, enquiries: true }],
    };
    const publicPreview = await portfolioPreview("owner", "owner", portfolio);
    assert.equal(publicPreview.projects[0].status, "Parked");
    assert.equal(publicPreview.projects[0].demoUrl, "");
    await db()
      .prepare("INSERT INTO public_portfolios VALUES(?,?,?,?,?)")
      .run(
        "owner",
        "unit-owner",
        JSON.stringify(portfolio),
        0,
        new Date().toISOString(),
      );
    assert.equal(await publishedPortfolio("unit-owner"), null);
    await db()
      .prepare("UPDATE public_portfolios SET published=1 WHERE owner=?")
      .run("owner");
    assert.equal((await publishedPortfolio("unit-owner"))?.projects.length, 1);
    await db()
      .prepare("INSERT INTO memories VALUES(?,?,?,?,?)")
      .run(
        "legacy-parking",
        "owner",
        id,
        JSON.stringify({ ...p.memory, sourceId: p.sourceId }),
        "2026-01-01",
      );
    const out = await buildExport("owner", "owner", [id]);
    const parsed = await readExport(out.bytes);
    assert.equal(parsed.manifest.projects.length, 1);
    assert.equal(parsed.manifest.projects[0].parkingRecords.length, 1);
    assert.ok(!JSON.stringify(parsed.manifest).includes("unit-token"));
    assert.ok(!JSON.stringify(parsed.manifest).includes(p.shareId));
    await assert.rejects(buildExport("outsider", "owner", [id]), /not found/);
    const restored = await restoreExport(
      "owner",
      "owner",
      out.bytes,
      parsed.digest,
      [id],
    );
    assert.equal(restored.projects.length, 1);
    const copy = await getProject(restored.projects[0].id, "owner");
    assert.equal(copy.shared, false);
    assert.equal(copy.hostingProjectId, "");
    assert.equal(copy.status, "Parked");
    assert.equal(copy.nextTask, p.nextTask);
    assert.notEqual(copy.sourceId, p.sourceId);
    const restoredMemory = await db()
      .prepare("SELECT data FROM memories WHERE project_id=?")
      .get(copy.id);
    assert.equal(
      JSON.parse(String(restoredMemory?.data)).sourceId,
      copy.sourceId,
    );
    const repeat = await restoreExport(
      "owner",
      "owner",
      out.bytes,
      parsed.digest,
      [id],
    );
    assert.equal(repeat.projects[0].id, copy.id);
    await assert.rejects(
      restoreExport("viewer", "owner", out.bytes, parsed.digest, [id]),
      /requires full/,
    );
    const tampered = await JSZip.loadAsync(out.bytes),
      f = parsed.manifest.files[0];
    tampered.file("files/" + f.id, Buffer.from("corrupt"));
    await assert.rejects(
      readExport(await tampered.generateAsync({ type: "nodebuffer" })),
      /checksum/,
    );
    const storageBefore = (await usage("owner")).storage;
    process.env.CHAPTER_PLAN_LIMITS = JSON.stringify({
      Free: { storage: storageBefore },
    });
    try {
      await assert.rejects(
        createBackup("owner", "owner", [id]),
        /storage limit/,
      );
      assert.equal((await usage("owner")).storage, storageBefore);
    } finally {
      if (originalLimits === undefined) delete process.env.CHAPTER_PLAN_LIMITS;
      else process.env.CHAPTER_PLAN_LIMITS = originalLimits;
    }
    const backup = await createBackup("editor", "owner", [id]);
    assert.ok((await backupBytes("editor", backup.id)).length);
    await db().prepare("DELETE FROM members WHERE user_id=?").run("editor");
    await assert.rejects(backupBytes("editor", backup.id), /not found/);
    const discarded = await insertProject(
      newProject({
        name: "Failed import",
        repository: "https://github.com/team/fail",
      }),
      "owner",
    );
    const before = (await usage("owner")).projects;
    await discardNewProject(discarded.id, "owner");
    assert.equal((await usage("owner")).projects, before - 1);
    assert.equal(
      await db()
        .prepare("SELECT id FROM projects WHERE id=?")
        .get(discarded.id),
      undefined,
    );
    const retryId = await enqueue("owner", "owner", "sync", {
      projectId: id,
      scheduled: false,
    });
    global.fetch = async () => Response.json({}, { status: 503 });
    await runJob(retryId);
    assert.equal(
      (
        await db()
          .prepare("SELECT state,attempts FROM jobs WHERE id=?")
          .get(retryId)
      )?.state,
      "queued",
    );
    await db().prepare("UPDATE jobs SET next_run=0 WHERE id=?").run(retryId);
    global.fetch = provider as typeof fetch;
    await runJob(retryId);
    assert.equal(
      (await db().prepare("SELECT state FROM jobs WHERE id=?").get(retryId))
        ?.state,
      "succeeded",
    );
  } finally {
    global.fetch = fetchOriginal;
  }
});
