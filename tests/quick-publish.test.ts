import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { samplePdf, samplePng } from "./fixtures/quick-publish";

test("Quick Publish detects runnable static output, missing assets, source-only ZIPs, secrets and active PDFs", async () => {
  process.env.CHAPTER_DATA_DIR = path.join(
    process.cwd(),
    ".data",
    "quick-unit-" + randomUUID(),
  );
  const { inspectQuickFile, inspectPdf, staticLayoutPreview } =
    await import("../src/lib/quick-publish");
  const html = await inspectQuickFile(
    "landing.html",
    Buffer.from(
      '<!doctype html><h1>Hello</h1><img src="missing.png"><script>window.top.pwned=true</script><META HTTP-EQUIV="ref&#114;esh" content="0;url=https://example.test"><a href="https://example.test">External</a>',
    ),
  );
  assert.equal(html.format, "html");
  assert.ok(html.archive?.build);
  assert.ok(html.warnings.some((w) => w.includes("missing.png")));
  const preview = await staticLayoutPreview(html.archive!.build!);
  assert.match(preview, /script-src 'none'/);
  assert.match(preview, /form-action 'none'/);
  assert.doesNotMatch(preview, /http-equiv="refresh"|href="https:|<script/i);
  const backendFiles = new JSZip();
  backendFiles.file("index.html", "<h1>Static</h1>");
  backendFiles.file("server.php", "<?php echo 'server code'; ?>");
  const backendReport = await inspectQuickFile(
    "mixed.zip",
    await backendFiles.generateAsync({ type: "nodebuffer" }),
  );
  assert.equal(
    (await JSZip.loadAsync(backendReport.archive!.build!)).file("server.php"),
    null,
  );
  backendFiles.file("server.php", "<?php $api_key='private-value'; ?>");
  await assert.rejects(
    () =>
      backendFiles
        .generateAsync({ type: "nodebuffer" })
        .then((bytes) => inspectQuickFile("credentials.zip", bytes)),
    /possible secret/,
  );
  const zip = new JSZip();
  zip.file(
    "index.html",
    '<html><head><link rel="stylesheet" href="styles.css"></head><body>Demo</body></html>',
  );
  zip.file("styles.css", "body{color:green}");
  zip.file("package.json", '{"scripts":{"build":"vite build"}}');
  zip.file(".env", "TOKEN=never-saved");
  zip.file(".env.example", "PROJECT_API_KEY=never-saved");
  const source = await inspectQuickFile(
    "source.zip",
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  assert.equal(source.archive?.build, null);
  assert.equal(source.archive?.excluded, 2);
  assert.deepEqual(source.archive?.envNames, ["PROJECT_API_KEY"]);
  assert.ok(
    source.warnings.some((w) => w.includes("no supported static build")),
  );
  zip.file(
    "dist/index.html",
    '<html><link href="styles.css" rel="stylesheet"><h1>Export</h1></html>',
  );
  zip.file("dist/styles.css", "h1{color:green}");
  const exported = await inspectQuickFile(
    "export.zip",
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  assert.ok(exported.archive?.build);
  assert.match(
    await staticLayoutPreview(exported.archive!.build!),
    /data:text\/css;base64/,
  );
  await assert.rejects(
    () =>
      inspectQuickFile(
        "secret.html",
        Buffer.from(
          '<h1>secret</h1><script>const api_key="private-value"</script>',
        ),
      ),
    /possible secret/,
  );
  await assert.rejects(
    () => inspectQuickFile("fake.html", Buffer.from([0xff, 0xfe, 0x00])),
    /UTF-8/,
  );
  await assert.rejects(
    () => inspectQuickFile("app.php", Buffer.from("<?php")),
    /accepts HTML/,
  );
  assert.equal(
    (await inspectQuickFile("image.png", samplePng)).type,
    "image/png",
  );
  await assert.rejects(
    () => inspectQuickFile("fake.jpg", samplePng),
    /do not match/,
  );
  assert.equal(inspectPdf(samplePdf()), "application/pdf");
  assert.throws(
    () => inspectPdf(Buffer.from("%PDF-1.4\n/JavaScript alert(1)\n%%EOF")),
    /active actions/,
  );
  assert.throws(
    () => inspectPdf(Buffer.from("%PDF-1.4\n/J#53 (alert(1))\n%%EOF")),
    /active actions/,
  );
  assert.throws(
    () => inspectPdf(samplePdf("api_key=private-value")),
    /credential/,
  );
  assert.throws(
    () => inspectPdf(Buffer.from("%PDF-1.4 damaged")),
    /complete PDF/,
  );
  assert.match(
    await staticLayoutPreview(
      (
        await inspectQuickFile(
          "big.html",
          Buffer.from("<h1>Large</h1>" + " ".repeat(600 * 1024)),
        )
      ).archive!.build!,
    ),
    /larger than the 512 KB/,
  );
});

test("PDF records survive private export/recovery and public output remains pinned to approved files", async () => {
  const { db } = await import("../src/lib/database");
  const { newProject, insertProject, storeUpload, saveProject, getProject } =
    await import("../src/lib/db");
  const { sharedProject } = await import("../src/lib/public");
  const { quickPreview, quickDigest } =
    await import("../src/lib/quick-publish");
  const { buildExport, readExport, restoreExport } =
    await import("../src/lib/recovery");
  const { projectAccess } = await import("../src/lib/access");
  const { pinPortfolioScreenshots, publishedPortfolio, portfolioFile } =
    await import("../src/lib/public-portfolio");
  for (const user of ["owner", "other"])
    await db()
      .prepare("INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)")
      .run(user, user, `${user}@example.test`, "unused");
  const p = await insertProject(
    newProject({ name: "Document project" }),
    "owner",
  );
  const bytes = samplePdf();
  const docId = await storeUpload(
    "owner",
    p.id,
    "guide.pdf",
    "document",
    "application/pdf",
    bytes,
  );
  p.documentIds = [docId];
  p.quickPublish = {
    format: "pdf",
    name: "guide.pdf",
    assetId: docId,
    digest: quickDigest(bytes),
    checkedAt: new Date().toISOString(),
    fileCount: 1,
    excluded: 0,
    warnings: [],
  };
  await saveProject(p, "owner");
  assert.equal(await sharedProject(p.shareId), null);
  await assert.rejects(() => projectAccess(p.id, "other"), /not found/);
  assert.equal((await quickPreview(p, "owner")).deployable, false);
  p.shared = true;
  p.shareDocuments = true;
  p.sharedDocumentIds = [docId];
  const imgId = await storeUpload(
    "owner",
    p.id,
    "image.png",
    "screenshot",
    "image/png",
    samplePng,
  );
  p.screenshotIds = [imgId];
  p.shareScreenshots = true;
  p.sharedScreenshotIds = [imgId];
  await saveProject(p, "owner");
  await db()
    .prepare("INSERT INTO public_portfolios VALUES(?,?,?,?,?)")
    .run(
      "owner",
      "quick-library",
      JSON.stringify({
        title: "Library",
        intro: "Projects",
        accent: "mint",
        projects: [
          { id: p.id, demo: false, screenshots: true, enquiries: false },
        ],
      }),
      1,
      new Date().toISOString(),
    );
  await pinPortfolioScreenshots("owner", p);
  const privateDoc = await storeUpload(
    "owner",
    p.id,
    "new-private.pdf",
    "document",
    "application/pdf",
    samplePdf("Private update"),
  );
  p.documentIds.push(privateDoc);
  const privateImage = await storeUpload(
    "owner",
    p.id,
    "new-private.png",
    "screenshot",
    "image/png",
    samplePng,
  );
  p.screenshotIds.push(privateImage);
  await saveProject(p, "owner");
  const publicData = await sharedProject(p.shareId);
  assert.deepEqual(
    publicData?.documents.map((d) => d.id),
    [docId],
  );
  assert.deepEqual(publicData?.screenshotIds, [imgId]);
  assert.deepEqual(
    (await publishedPortfolio("quick-library"))?.projects[0].screenshotUrls,
    [`/api/showcase/quick-library/file/${imgId}`],
  );
  await assert.rejects(
    () => portfolioFile("quick-library", privateImage),
    /not published/,
  );
  const exported = await buildExport("owner", "owner", [p.id]);
  const checked = await readExport(exported.bytes);
  assert.equal(
    checked.manifest.files.filter((f) => f.kind === "document").length,
    2,
  );
  const recovered = await restoreExport(
    "owner",
    "owner",
    exported.bytes,
    checked.digest,
    [p.id],
  );
  const restored = await getProject(recovered.projects[0].id, "owner");
  assert.equal(restored.shared, false);
  assert.equal(restored.shareDocuments, false);
  assert.equal(restored.documentIds?.length, 2);
  assert.notEqual(restored.quickPublish?.assetId, docId);
  assert.equal(
    (await quickPreview(restored, "owner")).record.name,
    "guide.pdf",
  );
});
