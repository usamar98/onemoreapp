import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
test("project capture, confirmation sessions, proposals, private inbox and aggregate events preserve permissions and idempotency", async () => {
  process.env.CHAPTER_DATA_DIR = path.join(
    process.cwd(),
    ".data",
    "phase-five-unit-" + randomUUID(),
  );
  const { db } = await import("../src/lib/database");
  const { newProject, insertProject, getProject, saveProject } =
    await import("../src/lib/db");
  const { ensureWorkspace, projectAccess } = await import("../src/lib/access");
  const { hash } = await import("../src/lib/security");
  const { captureProgress, resumeContext, startSession, completeSession } =
    await import("../src/lib/continuation");
  const { authenticateDeveloper } = await import("../src/lib/phase-five-api");
  const { generateProposal, applyProposal } =
    await import("../src/lib/action-proposals");
  const { attentionInbox } = await import("../src/lib/attention");
  const { insights, isPlatformAdmin, productEvent } =
    await import("../src/lib/product-insights");
  const { buildExport, readExport, restoreExport } =
    await import("../src/lib/recovery");
  const { usage } = await import("../src/lib/billing");
  const { runJob, enqueue } = await import("../src/lib/jobs");
  for (const id of ["owner", "editor", "viewer", "outsider"])
    await db()
      .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
      .run(id, id, id + "@example.test", "unused", 0);
  await ensureWorkspace("owner");
  const p = await insertProject(
    newProject({
      name: "Continue Garden",
      description: "Help developers continue saved work",
      status: "Parked",
      version: "abc1234",
      nextTask: "Add progress; verify upload handling",
      blockers: "A progress message is missing",
      memory: {
        version: "abc1234",
        setup: "npm install, then npm run dev",
        completed: "Upload form",
        issues: "A progress message is missing",
        reason: "Other priorities",
        nextTask: "Add progress",
        returnDate: "2020-01-01",
        savedAt: new Date().toISOString(),
      },
    }),
    "owner",
  );
  const hidden = await insertProject(
    newProject({
      name: "Private secret project",
      description: "Unrelated private purpose",
    }),
    "owner",
  );
  await db()
    .prepare("INSERT INTO members VALUES(?,?,?,?,?)")
    .run(
      "owner",
      "editor",
      "Editor",
      JSON.stringify([p.id]),
      new Date().toISOString(),
    );
  await db()
    .prepare("INSERT INTO members VALUES(?,?,?,?,?)")
    .run(
      "owner",
      "viewer",
      "Viewer",
      JSON.stringify([p.id]),
      new Date().toISOString(),
    );
  const tokenId = randomUUID(),
    token = "ch_dev_" + randomBytes(32).toString("hex");
  await db()
    .prepare("INSERT INTO developer_tokens VALUES(?,?,?,?,?,?,0,?,null)")
    .run(
      tokenId,
      "editor",
      p.id,
      hash(token),
      "Editor CLI",
      Date.now() + 86400000,
      new Date().toISOString(),
    );
  assert.equal(
    (
      await authenticateDeveloper(
        new Request("http://localhost/api/developer", {
          headers: { authorization: "Bearer " + token },
        }),
        p.id,
      )
    ).actor,
    "editor",
  );
  await assert.rejects(
    authenticateDeveloper(
      new Request("http://localhost/api/developer", {
        headers: { authorization: "Bearer " + token },
      }),
      hidden.id,
    ),
    /not scoped/,
  );
  const capture = {
    id: randomUUID(),
    notes: "Progress UI drafted; requires review",
    commit: "abcdef1234567",
    nextTask: "Review progress UI",
    blockers: "Confirm accessibility",
    files: [
      {
        path: "src/progress.ts",
        content: "export const progress = 'ready for review';",
      },
    ],
  };
  const result = await captureProgress("editor", p.id, tokenId, capture, token);
  assert.equal(result.project.status, "Parked");
  assert.equal(result.project.memory?.completed, "Upload form");
  assert.equal(result.project.nextTask, "Review progress UI");
  assert.ok(result.project.progressUpdates?.[0].fileId);
  const bytesBefore = (await usage("owner")).storage;
  assert.equal(
    (await captureProgress("editor", p.id, tokenId, capture, token)).duplicate,
    true,
  );
  assert.equal((await usage("owner")).storage, bytesBefore);
  const originalLimits = process.env.CHAPTER_PLAN_LIMITS;
  process.env.CHAPTER_PLAN_LIMITS = JSON.stringify({ Free: { storage: 0 } });
  await assert.rejects(
    captureProgress("editor", p.id, tokenId, { ...capture, id: randomUUID() }),
    /storage limit/,
  );
  if (originalLimits === undefined) delete process.env.CHAPTER_PLAN_LIMITS;
  else process.env.CHAPTER_PLAN_LIMITS = originalLimits;
  assert.equal((await getProject(p.id, "owner")).progressUpdates?.length, 1);
  await assert.rejects(
    captureProgress("editor", p.id, tokenId, {
      ...capture,
      notes: "different",
    }),
    /different content/,
  );
  for (const f of [
    { path: ".env", content: "nothing" },
    { path: "../src/test.ts", content: "nothing" },
    { path: "customers.csv", content: "customer" },
    { path: "README.md", content: "API_KEY=do-not-capture" },
    { path: "README.md", content: token },
  ])
    await assert.rejects(
      captureProgress(
        "editor",
        p.id,
        tokenId,
        { ...capture, id: randomUUID(), files: [f] },
        token,
      ),
      /private|credentials/,
    );
  assert.equal(
    (
      await db()
        .prepare("SELECT count(*) AS count FROM development_captures")
        .get()
    ).count,
    1,
  );
  await db()
    .prepare("UPDATE members SET role='Viewer' WHERE user_id='editor'")
    .run();
  await assert.rejects(
    authenticateDeveloper(
      new Request("http://localhost", {
        headers: { authorization: "Bearer " + token },
      }),
      p.id,
    ),
    /Viewer/,
  );
  await db()
    .prepare("UPDATE members SET role='Editor' WHERE user_id='editor'")
    .run();
  await db()
    .prepare("UPDATE developer_tokens SET revoked=1 WHERE id=?")
    .run(tokenId);
  await assert.rejects(
    authenticateDeveloper(
      new Request("http://localhost", {
        headers: { authorization: "Bearer " + token },
      }),
      p.id,
    ),
    /revoked/,
  );
  await assert.rejects(
    startSession("viewer", p.id, {
      id: randomUUID(),
      task: "Review",
      minutes: 30,
      digest: "a".repeat(64),
      reviewed: true,
    }),
    /Viewer/,
  );
  let context = await resumeContext("owner", p.id);
  await assert.rejects(
    startSession("owner", p.id, {
      id: randomUUID(),
      task: "Review",
      minutes: 30,
      digest: context.digest,
      reviewed: true,
    }),
    /readiness/,
  );
  const ready = await getProject(p.id, "owner");
  ready.revival = {
    at: new Date().toISOString(),
    version: ready.version,
    sourceId: ready.sourceId,
    items: [
      {
        name: "Build",
        status: "Not Checked",
        detail: "Sandbox unavailable",
        nextStep: "Run in a configured isolated sandbox",
      },
    ],
  };
  await saveProject(ready, "owner");
  context = await resumeContext("owner", p.id);
  const session = randomUUID();
  await startSession("owner", p.id, {
    id: session,
    task: "Review progress UI",
    minutes: 30,
    digest: context.digest,
    reviewed: true,
  });
  assert.equal((await getProject(p.id, "owner")).status, "Building");
  context = await resumeContext("owner", p.id);
  const changed = await getProject(p.id, "owner");
  changed.blockers = "Another confirmed blocker";
  await saveProject(changed, "owner");
  await assert.rejects(
    completeSession("owner", p.id, session, {
      completed: "Accessible progress messages",
      issues: "",
      nextTask: "Verify slow uploads",
      digest: context.digest,
      confirmed: true,
    }),
    /notes changed/,
  );
  context = await resumeContext("owner", p.id);
  const finished = await completeSession("owner", p.id, session, {
    completed: "Accessible progress messages",
    issues: "Slow-upload edge case",
    nextTask: "Verify slow uploads",
    digest: context.digest,
    confirmed: true,
  });
  assert.equal(
    finished.project.memory?.completed,
    "Upload form\nAccessible progress messages",
  );
  assert.equal(finished.project.blockers, "Slow-upload edge case");
  assert.equal(finished.project.nextTask, "Verify slow uploads");
  assert.equal(finished.project.memory?.returnDate, "");
  await completeSession("owner", p.id, session, {
    completed: "Duplicate",
    issues: "",
    nextTask: "Wrong duplicate",
    digest: context.digest,
    confirmed: true,
  });
  assert.equal(
    (await getProject(p.id, "owner")).nextTask,
    "Verify slow uploads",
  );
  assert.equal(
    (
      await db()
        .prepare(
          "SELECT count(*) AS count FROM product_events WHERE action='resume_session'",
        )
        .get()
    ).count,
    1,
  );
  const proposalId = randomUUID(),
    jobId = await enqueue("editor", "owner", "proposal", {
      projectId: p.id,
      proposalId,
      useAI: false,
    });
  await db()
    .prepare("INSERT INTO action_proposals VALUES(?,?,?,?,?,?,?)")
    .run(
      proposalId,
      p.id,
      "editor",
      "documentation",
      "queued",
      JSON.stringify({ jobId }),
      new Date().toISOString(),
    );
  await runJob(jobId);
  const proposal = await db()
      .prepare("SELECT * FROM action_proposals WHERE id=?")
      .get(proposalId),
    draft = JSON.parse(String(proposal.data));
  assert.equal(proposal.state, "draft");
  assert.equal(draft.jobId, jobId);
  assert.ok(
    draft.sources.every((s: { projectId: string }) => s.projectId === p.id),
  );
  assert.ok(!JSON.stringify(draft).includes(hidden.description));
  await assert.rejects(
    applyProposal("viewer", p.id, proposalId, {
      text: draft.text,
      reviewed: true,
      digest: draft.baseDigest,
    }),
    /Viewer/,
  );
  const applied = await applyProposal("editor", p.id, proposalId, {
    text: draft.text + "\n\nConfirmed development checklist.",
    reviewed: true,
    digest: draft.baseDigest,
  });
  assert.ok(
    applied.project.documentation?.includes("Confirmed development checklist."),
  );
  assert.ok(
    (
      await db()
        .prepare("SELECT id FROM versions WHERE project_id=? AND kind='notes'")
        .all(p.id)
    ).length >= 2,
  );
  const staleId = randomUUID();
  await db()
    .prepare("INSERT INTO action_proposals VALUES(?,?,?,?,?,?,?)")
    .run(
      staleId,
      p.id,
      "owner",
      "tasks",
      "queued",
      "{}",
      new Date().toISOString(),
    );
  await generateProposal("owner", p.id, staleId, false);
  const stale = JSON.parse(
    String(
      (
        await db()
          .prepare("SELECT data FROM action_proposals WHERE id=?")
          .get(staleId)
      ).data,
    ),
  );
  const newer = await getProject(p.id, "owner");
  newer.nextTask = "Recheck final details";
  await saveProject(newer, "owner");
  await assert.rejects(
    applyProposal("owner", p.id, staleId, {
      text: stale.text,
      reviewed: true,
      digest: stale.baseDigest,
    }),
    /changed after/,
  );
  const originalFetch = globalThis.fetch,
    originalAIKey = process.env.OPENAI_API_KEY;
  let providerAttempts = 0;
  try {
    process.env.OPENAI_API_KEY = "test-key-not-a-real-credential";
    globalThis.fetch = async () => {
      providerAttempts++;
      return Response.json(
        {
          error: {
            code: "credit_balance_exhausted",
            type: "insufficient_quota",
          },
        },
        { status: 429 },
      );
    };
    const failedProposal = randomUUID(),
      failedJob = await enqueue("editor", "owner", "proposal", {
        projectId: p.id,
        proposalId: failedProposal,
        useAI: true,
      });
    await db()
      .prepare("INSERT INTO action_proposals VALUES(?,?,?,?,?,?,?)")
      .run(
        failedProposal,
        p.id,
        "editor",
        "tasks",
        "queued",
        JSON.stringify({ jobId: failedJob }),
        new Date().toISOString(),
      );
    await runJob(failedJob);
    const failed = await db()
      .prepare("SELECT state,error,attempts FROM jobs WHERE id=?")
      .get(failedJob);
    assert.equal(failed.state, "failed");
    assert.equal(failed.attempts, 1);
    assert.match(String(failed.error), /credits are exhausted/);
    await runJob(failedJob);
    assert.equal(providerAttempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalAIKey;
  }
  const attention = await attentionInbox("editor", "owner");
  assert.ok(attention.items.some((i) => i.kind === "blocker"));
  assert.ok(attention.items.every((i) => i.projectId === p.id));
  const blocker = attention.items.find((i) => i.kind === "blocker")!;
  await db()
    .prepare("INSERT INTO attention_states VALUES(?,?,?)")
    .run(
      "editor",
      blocker.key,
      JSON.stringify({ resolved: blocker.fingerprint }),
    );
  assert.equal(
    (await attentionInbox("editor", "owner")).items.find(
      (i) => i.key === blocker.key,
    )?.state,
    "resolved",
  );
  const updated = await getProject(p.id, "owner");
  updated.blockers = "New blocker";
  await saveProject(updated, "owner");
  assert.equal(
    (await attentionInbox("editor", "owner")).items.find(
      (i) => i.key === blocker.key,
    )?.state,
    "open",
  );
  await db()
    .prepare("INSERT INTO notification_preferences VALUES(?,?)")
    .run("editor", JSON.stringify({ blocker: false }));
  assert.ok(
    !(await attentionInbox("editor", "owner")).items.some(
      (i) => i.kind === "blocker",
    ),
  );
  await assert.rejects(insights("editor", "owner"), /Owner/);
  await productEvent(
    "owner",
    "owner",
    p.id,
    "share",
    "completed",
    "first-share:" + p.id,
  );
  await productEvent(
    "owner",
    "owner",
    p.id,
    "share",
    "completed",
    "first-share:" + p.id,
  );
  const metrics = await insights("owner", "owner");
  assert.equal(metrics.counts.find((c) => c.action === "share")?.completed, 1);
  assert.ok(!JSON.stringify(metrics).includes("Slow-upload"));
  assert.equal(await isPlatformAdmin("owner"), false);
  process.env.CHAPTER_ADMIN_USER_IDS = "outsider";
  assert.equal(await isPlatformAdmin("outsider"), true);
  await assert.rejects(projectAccess(hidden.id, "outsider"), /not found/);
  const backup = await buildExport("owner", "owner", [p.id]),
    read = await readExport(backup.bytes);
  assert.equal(read.manifest.projects[0].project.progressUpdates.length, 2);
  const restored = await restoreExport(
    "owner",
    "owner",
    backup.bytes,
    read.digest,
    [p.id],
  );
  const recovered = await getProject(restored.projects[0].id, "owner");
  assert.ok(
    recovered.documentation?.includes("Confirmed development checklist."),
  );
  assert.ok(recovered.progressUpdates?.[0].fileId);
  assert.notEqual(
    recovered.progressUpdates?.[0].fileId,
    (await getProject(p.id, "owner")).progressUpdates?.[0].fileId,
  );
  assert.equal(
    (
      await db()
        .prepare(
          "SELECT count(*) AS count FROM developer_tokens WHERE project_id=?",
        )
        .get(recovered.id)
    ).count,
    0,
  );
});
test("standalone CLI reviews selected text files and rejects credentials and path escapes", async () => {
  const base = path.join(process.cwd(), ".data", "cli-test-" + randomUUID());
  mkdirSync(base, { recursive: true });
  mkdirSync(path.join(base, "src"));
  writeFileSync(
    path.join(base, "src", "progress.ts"),
    "export const progress = true;",
  );
  const { prepareCapture } = await import("../public/chapter-cli.mjs");
  const p = await prepareCapture(
    { id: randomUUID(), notes: "UI recorded", filePaths: ["src/progress.ts"] },
    base,
  );
  assert.equal(p.files[0].path, "src/progress.ts");
  await assert.rejects(
    prepareCapture({ filePaths: ["../outside.ts"] }, base),
    /unsafe/,
  );
  writeFileSync(
    path.join(base, "src", "unsafe.ts"),
    "const API_KEY = 'private';",
  );
  await assert.rejects(
    prepareCapture({ filePaths: ["src/unsafe.ts"] }, base),
    /credentials/,
  );
});
