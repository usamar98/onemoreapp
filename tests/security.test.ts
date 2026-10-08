import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  redact,
  safeUrl,
  githubSlug,
  passwordHash,
  passwordMatches,
  checkOrigin,
} from "../src/lib/security";
import { inspectZip, screenshotType } from "../src/lib/uploads";
import { notesBrief, groundedBrief } from "../src/lib/brief";
import { demoProjects } from "../src/lib/demo";
import { AIServiceError, assertOpenAIResponse } from "../src/lib/openai-errors";
test("redaction removes credentials, known account tokens and private keys", () => {
  const value =
    'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuv\nPASSWORD="do-not-share"\nAuthorization: Bearer actual-bearer-token-12345\nhttps://user:password@example.com\ncustom-account-credential';
  const safe = redact(value, ["custom-account-credential"]);
  for (const secret of [
    "abcdefghijklmnopqrstuv",
    "do-not-share",
    "actual-bearer-token-12345",
    "user:password",
    "custom-account-credential",
  ])
    assert.ok(!safe.includes(secret));
});
test("URLs reject credentials and unsafe protocols", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "https://example.com?api_key=credential",
    "https://example.com?access_token=credential",
  ])
    assert.throws(() => safeUrl(url));
  assert.equal(
    githubSlug("https://github.com/owner/project.git"),
    "owner/project",
  );
  assert.throws(() => githubSlug("https://github.com.evil.test/owner/project"));
});
test("sessions can verify salted scrypt hashes", async () => {
  const one = await passwordHash("a-long-unique-password"),
    two = await passwordHash("a-long-unique-password");
  assert.notEqual(one, two);
  assert.ok(await passwordMatches("a-long-unique-password", one));
  assert.ok(!(await passwordMatches("incorrect-password", one)));
});
test("cross-origin mutation is denied, including behind a local bind host", () => {
  assert.throws(() =>
    checkOrigin(
      new Request("http://localhost:3000/api/projects", {
        headers: { origin: "https://evil.test" },
      }),
    ),
  );
  checkOrigin(
    new Request("http://localhost:3000/api/projects", {
      headers: { origin: "http://localhost:3000" },
    }),
  );
  checkOrigin(
    new Request("http://0.0.0.0:3000/api/projects", {
      headers: { host: "localhost:3000", origin: "http://localhost:3000" },
    }),
  );
  assert.throws(() =>
    checkOrigin(
      new Request("http://0.0.0.0:3000/api/projects", {
        headers: { host: "localhost:3000", origin: "https://evil.test" },
      }),
    ),
  );
});
test("source archives are distinct from deployable output, and environment files are stripped", async () => {
  const zip = new JSZip();
  zip.file("project/package.json", '{"name":"test"}');
  zip.file("project/index.html", "<h1>Development entry</h1>");
  zip.file("project/.env", "PASSWORD=private");
  zip.file("project/src/main.ts", 'export const hello="world";');
  const result = await inspectZip(
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  assert.equal(result.build, null);
  assert.equal(result.excluded, 1);
  assert.ok(!(await JSZip.loadAsync(result.source)).file(".env"));
  zip.file("project/dist/index.html", "<h1>Production build</h1>");
  zip.file("project/dist/style.css", "body {color: green}");
  const build = await inspectZip(
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  assert.ok(build.build);
  const deployed = await JSZip.loadAsync(build.build!);
  assert.ok(deployed.file("index.html"));
  assert.ok(!deployed.file("package.json"));
});
test("uploads reject embedded secrets and disguised executable screenshots", async () => {
  const zip = new JSZip();
  zip.file("main.js", 'const access_token="this-is-a-private-token";');
  await assert.rejects(
    () => zip.generateAsync({ type: "nodebuffer" }).then(inspectZip),
    /possible secret/,
  );
  assert.throws(() => screenshotType(Buffer.from('<svg onload="alert(1)">')));
});
test("decompression is bounded even when ZIP metadata understates the expanded size", async () => {
  const zip = new JSZip();
  zip.file("large.txt", Buffer.alloc(21 * 1024 * 1024, 97));
  const archive = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const centralHeader = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(centralHeader >= 0);
  archive.writeUInt32LE(1, centralHeader + 24);
  await assert.rejects(() => inspectZip(archive), /expanded ZIP is too large/);
});
test("briefs identify missing information rather than inventing it", () => {
  const p = {
    ...demoProjects[0],
    memory: null,
    repository: "",
    repoInfo: "",
    version: "",
  };
  const brief = notesBrief(p);
  assert.ok(brief.includes("Not recorded."));
  assert.ok(!brief.includes("npm install"));
  assert.ok(brief.includes("## Next task"));
});
test("AI excerpts must be supported by the correct source section", () => {
  const sources = {
    "Project purpose": "A component library.",
    Setup: "Not recorded.",
    "Next task": "Fix mobile playback.",
  };
  const draft = {
    "Project purpose": ["A component library."],
    Setup: [],
    "Next task": ["Fix mobile playback."],
  };
  const brief = groundedBrief("Test", sources, draft);
  assert.ok(brief.includes("## Setup\nNot recorded."));
  assert.throws(
    () => groundedBrief("Test", sources, { ...draft, Setup: ["npm install"] }),
    /unsupported claim/,
  );
  assert.throws(
    () =>
      groundedBrief("Test", sources, {
        ...draft,
        Setup: ["Fix mobile playback."],
      }),
    /unsupported claim/,
  );
});

test("AI billing failures do not retry or expose provider contents; temporary limits honor retry-after", async () => {
  for (const code of [
    "insufficient_quota",
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
  ]) {
    await assert.rejects(
      assertOpenAIResponse(
        Response.json(
          { error: { code, message: "private source and credentials" } },
          { status: 429 },
        ),
      ),
      (error: unknown) => {
        assert.ok(error instanceof AIServiceError);
        assert.equal(error.retryable, false);
        assert.ok(!error.message.includes("private source"));
        assert.match(error.message, /Saved-notes/);
        return true;
      },
    );
  }
  await assert.rejects(
    assertOpenAIResponse(
      Response.json(
        { error: { type: "insufficient_quota", code: "future_billing_code" } },
        { status: 429 },
      ),
    ),
    (error: unknown) => error instanceof AIServiceError && !error.retryable,
  );
  await assert.rejects(
    assertOpenAIResponse(
      Response.json(
        { error: { code: "rate_limit_exceeded" } },
        { status: 429, headers: { "Retry-After": "120" } },
      ),
    ),
    (error: unknown) =>
      error instanceof AIServiceError &&
      error.retryable &&
      error.retryAfterMs === 120000,
  );
  await assert.rejects(
    assertOpenAIResponse(
      new Response("private upstream response", { status: 503 }),
    ),
    (error: unknown) =>
      error instanceof AIServiceError &&
      error.retryable &&
      !error.message.includes("upstream"),
  );
  await assertOpenAIResponse(Response.json({ ok: true }));
});
