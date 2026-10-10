import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { samplePdf, samplePng } from "./fixtures/quick-publish";

test("single-use recovery, verified email, encrypted outbox and durable idempotent delivery", async () => {
  process.env.CHAPTER_DATA_DIR = path.join(
    process.cwd(),
    ".data",
    "secure-unit-" + randomUUID(),
  );
  process.env.CHAPTER_EMAIL_MODE = "local";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  const { db } = await import("../src/lib/database");
  const { decrypt, passwordHash, passwordMatches, hash } =
    await import("../src/lib/security");
  const { issueEmailToken, resetPassword, verifyEmail, accountSecurity } =
    await import("../src/lib/account-security");
  const { deliverMail, deliverPendingMail, emailMode } =
    await import("../src/lib/transactional-email");
  await db()
    .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
    .run(
      "owner",
      "Owner",
      "owner@example.test",
      await passwordHash("old-password-12345"),
      0,
    );
  const tokenOf = async (id: string) => {
    const row = await db()
      .prepare("SELECT data FROM mail_deliveries WHERE id=?")
      .get(id);
    return new URL(JSON.parse(decrypt(String(row.data))).url).hash.split(
      "token=",
    )[1];
  };
  const verification = await issueEmailToken(
    "owner",
    "owner@example.test",
    "verify",
    "owner",
  );
  const verifyToken = await tokenOf(verification);
  assert.equal(
    JSON.stringify(
      await db().prepare("SELECT * FROM auth_tokens").all(),
    ).includes(verifyToken),
    false,
  );
  await verifyEmail(verifyToken);
  assert.ok((await accountSecurity("owner")).verifiedAt);
  await assert.rejects(verifyEmail(verifyToken), /already used/);
  const old = await issueEmailToken(
      "owner",
      "owner@example.test",
      "reset",
      "owner",
    ),
    oldToken = await tokenOf(old);
  const fresh = await issueEmailToken(
      "owner",
      "owner@example.test",
      "reset",
      "owner",
    ),
    freshToken = await tokenOf(fresh);
  await assert.rejects(
    resetPassword(oldToken, "another-password-1234"),
    /already used/,
  );
  await deliverMail(old);
  assert.equal(
    (
      await db()
        .prepare("SELECT state FROM mail_deliveries WHERE id=?")
        .get(old)
    ).state,
    "expired",
  );
  await Promise.all([deliverMail(fresh), deliverMail(fresh)]);
  const local = await readFile(
    path.join(process.env.CHAPTER_DATA_DIR!, "mail-outbox", fresh + ".html"),
    "utf8",
  );
  assert.ok(local.includes(freshToken));
  assert.equal(
    (
      await db()
        .prepare("SELECT state,attempts FROM mail_deliveries WHERE id=?")
        .get(fresh)
    ).attempts,
    1,
  );
  await db()
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run("old-session", "owner", Date.now() + 60000);
  const resetResults = await Promise.allSettled([
    resetPassword(freshToken, "new-password-12345"),
    resetPassword(freshToken, "new-password-12345"),
  ]);
  assert.equal(resetResults.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await db().prepare("SELECT count(*) AS n FROM sessions").get()).n,
    0,
  );
  assert.ok(
    await passwordMatches(
      "new-password-12345",
      String(
        (
          await db()
            .prepare("SELECT password FROM users WHERE id='owner'")
            .get()
        ).password,
      ),
    ),
  );
  const expired = await issueEmailToken(
      "owner",
      "owner@example.test",
      "reset",
      "owner",
    ),
    expiredToken = await tokenOf(expired);
  await db()
    .prepare("UPDATE auth_tokens SET expires=0 WHERE token=?")
    .run(hash(expiredToken));
  await assert.rejects(
    resetPassword(expiredToken, "new-password-12345"),
    /expired/,
  );
  process.env.RESEND_API_KEY = "test-send-only";
  process.env.EMAIL_FROM = "Chapter <security@example.test>";
  const retry = await issueEmailToken(
    "owner",
    "owner@example.test",
    "verify",
    "owner",
  );
  const originalFetch = globalThis.fetch,
    keys: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
    assert.ok(!String(init?.body).includes("old-password"));
    return new Response("", { status: ++calls === 1 ? 503 : 200 });
  };
  try {
    await deliverMail(retry);
    assert.equal(
      (
        await db()
          .prepare("SELECT state FROM mail_deliveries WHERE id=?")
          .get(retry)
      ).state,
      "queued",
    );
    await db()
      .prepare("UPDATE mail_deliveries SET next_run=0 WHERE id=?")
      .run(retry);
    await deliverPendingMail();
    assert.equal(
      (
        await db()
          .prepare("SELECT state,data FROM mail_deliveries WHERE id=?")
          .get(retry)
      ).state,
      "sent",
    );
    assert.equal(keys[0], keys[1]);
    assert.equal(
      (
        await db()
          .prepare("SELECT data FROM mail_deliveries WHERE id=?")
          .get(retry)
      ).data,
      "",
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  }
  process.env.VERCEL = "1";
  assert.equal(emailMode(), "unavailable");
  delete process.env.VERCEL;
});

test("client preview gates all files, pins Quick Publish layouts, and verifies invited recipients", async () => {
  const { db, transaction } = await import("../src/lib/database");
  const { decrypt, hash } = await import("../src/lib/security");
  const { newProject, insertProject, saveProject, storeUpload } =
    await import("../src/lib/db");
  const {
    reviewPreview,
    newReviewId,
    reviewAccessStep,
    grantReview,
    requestReviewEmail,
    reviewData,
    reviewFile,
  } = await import("../src/lib/reviews");
  const p = newProject({ name: "Private client work", role: "Owner" });
  await insertProject(p, "owner");
  const zip = new JSZip();
  zip.file("index.html", "<h1>Captured layout</h1><script>steal()</script>");
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  p.sourceId = await storeUpload(
    "owner",
    p.id,
    "source.zip",
    "source",
    "application/zip",
    bytes,
  );
  p.buildId = await storeUpload(
    "owner",
    p.id,
    "build.zip",
    "build",
    "application/zip",
    bytes,
  );
  p.screenshotIds = [
    await storeUpload(
      "owner",
      p.id,
      "image.png",
      "screenshot",
      "image/png",
      samplePng,
    ),
  ];
  p.documentIds = [
    await storeUpload(
      "owner",
      p.id,
      "spec.pdf",
      "document",
      "application/pdf",
      samplePdf(),
    ),
  ];
  p.quickPublish = {
    format: "html",
    assetId: p.sourceId,
    name: "index.html",
    digest: hash(bytes.toString("base64")),
    fileCount: 1,
    excluded: 0,
    checkedAt: new Date().toISOString(),
    warnings: [],
  };
  await saveProject(p, "owner");
  const options = {
    versionId: "",
    demo: false,
    feedback: true,
    source: false,
    screenshots: true,
    notes: false,
    days: 7,
    access: "password" as const,
    password: "client-password-1234",
    packagePreview: true,
    documents: true,
  };
  const create = async (
    opts:
      | typeof options
      | (Omit<typeof options, "access"> & {
          access: "email";
          recipientEmails: string[];
        }),
  ) => {
    const snapshot = await reviewPreview("owner", p.id, opts),
      id = newReviewId();
    delete snapshot.sourceFiles;
    await transaction([
      {
        sql: "INSERT INTO review_links VALUES(?,?,?,?,?,?,?,?)",
        parameters: [
          id,
          p.id,
          "owner",
          "owner",
          JSON.stringify(snapshot),
          Date.now() + 86400000,
          0,
          new Date().toISOString(),
        ],
      },
      await reviewAccessStep(id, opts),
    ]);
    return id;
  };
  const id = await create(options);
  await assert.rejects(reviewData(id, null), /Unlock/);
  await assert.rejects(reviewFile(id, p.screenshotIds[0], null), /Unlock/);
  await assert.rejects(reviewFile(id, p.documentIds[0], null), /Unlock/);
  await assert.rejects(
    grantReview(id, { password: "wrong-password" }),
    /does not match/,
  );
  const { grant } = await grantReview(id, { password: options.password });
  const data = await reviewData(id, grant);
  assert.ok(data.htmlPreview!.includes("Captured layout"));
  assert.ok(!data.htmlPreview!.includes("steal()"));
  assert.equal(data.sourceUrl, "");
  assert.equal(data.access, undefined);
  assert.equal(data.documents, undefined);
  await assert.rejects(reviewFile(id, p.sourceId, grant), /not included/);
  assert.equal(
    (await reviewFile(id, p.documentIds[0], grant)).type,
    "application/pdf",
  );
  assert.equal(
    (await reviewFile(id, p.screenshotIds[0], grant)).type,
    "image/png",
  );
  p.name = "Updated private work";
  await saveProject(p, "owner");
  assert.equal((await reviewData(id, grant)).name, "Private client work");
  const other = await create(options);
  const broken = await create(options);
  await db().prepare("DELETE FROM review_access WHERE review_id=?").run(broken);
  await assert.rejects(
    reviewData(broken, null),
    /access settings are unavailable/,
  );
  await assert.rejects(
    reviewFile(broken, p.documentIds[0], null),
    /access settings are unavailable/,
  );
  await assert.rejects(reviewData(other, grant), /Unlock/);
  await db().prepare("UPDATE review_links SET revoked=1 WHERE id=?").run(id);
  await assert.rejects(reviewFile(id, p.documentIds[0], grant), /revoked/);
  const emailId = await create({
    ...options,
    access: "email",
    recipientEmails: ["client@example.test"],
  });
  assert.equal(
    await requestReviewEmail(emailId, "outsider@example.test"),
    null,
  );
  const mail = await requestReviewEmail(emailId, "client@example.test");
  const content = JSON.parse(
    decrypt(
      String(
        (
          await db()
            .prepare("SELECT data FROM mail_deliveries WHERE id=?")
            .get(mail!)
        ).data,
      ),
    ),
  );
  const token = new URL(content.url).hash.split("token=")[1];
  await assert.rejects(grantReview(other, { token }), /password/);
  const emailGrant = await grantReview(emailId, { token });
  assert.equal(
    (await reviewData(emailId, emailGrant.grant)).reviewerVerified,
    true,
  );
  await assert.rejects(grantReview(emailId, { token }), /already used/);
  await db()
    .prepare("UPDATE review_links SET expires=0 WHERE id=?")
    .run(emailId);
  await assert.rejects(reviewData(emailId, emailGrant.grant), /expired/);
});
