import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import { Readable } from "node:stream";

test("preserve, isolated rebuild, independent recreation, secret configuration, package transfer and recovery respect exact versions and permissions", async () => {
  process.env.CHAPTER_DATA_DIR = path.join(
    process.cwd(),
    ".data",
    "phase-six-unit-" + randomUUID(),
  );
  process.env.VERCEL_TOKEN = "unit-only-sandbox-credential";
  process.env.VERCEL_TEAM_ID = "team_unit";
  process.env.VERCEL_PROJECT_ID = "prj_platform";
  const { db } = await import("../src/lib/database"),
    {
      newProject,
      insertProject,
      getProject,
      saveProject,
      storeUpload,
      saveToken,
      uploadBytes,
    } = await import("../src/lib/db"),
    { ensureWorkspace } = await import("../src/lib/access");
  const {
      sha256,
      preparePreservation,
      createPreservation,
      bundleSource,
      bundleAccess,
      inspectPreservationPackage,
      expireBundles,
    } = await import("../src/lib/preservation"),
    { newBundleCheck, verifyBundle, safeBuildDiagnostics } =
      await import("../src/lib/bundle-build");
  const {
      recreationPreview,
      beginRecreation,
      runRecreation,
      configureRecreation,
      recreationAccess,
    } = await import("../src/lib/recreation"),
    {
      createPackageLink,
      activePackageLink,
      startPackageDownload,
      packageDownloadPart,
      acknowledgePackageDownload,
    } = await import("../src/lib/file-transfers");
  const {
      addService,
      dependencyMap,
      hostingImpact,
      importHostingDependencies,
    } = await import("../src/lib/dependencies"),
    { buildExport, restoreExport } = await import("../src/lib/recovery"),
    { usage } = await import("../src/lib/billing");
  for (const user of ["owner", "editor", "viewer", "other"])
    await db()
      .prepare("INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)")
      .run(user, user, user + "@example.test", "unused");
  await ensureWorkspace("owner");
  const p = await insertProject(
    newProject({
      name: "Preserved Garden",
      status: "Archived",
      description: "A static project",
      version: "abcdef1234567",
      requiredEnvNames: ["DEMO_API_KEY"],
      nextTask: "Verify navigation",
      memory: {
        version: "abcdef1234567",
        setup: "npm ci, npm run build",
        completed: "Landing page",
        issues: "Keyboard navigation needs review",
        reason: "Busy",
        nextTask: "Verify navigation",
        returnDate: "",
      },
    }),
    "owner",
  );
  const hidden = await insertProject(
    newProject({
      name: "Restricted project",
      hostingProvider: "vercel",
      hostingProjectId: "original_provider",
      hostingTeamId: "team_unit",
    }),
    "owner",
  );
  for (const role of ["Editor", "Viewer"])
    await db()
      .prepare("INSERT INTO members VALUES(?,?,?,?,?)")
      .run(
        "owner",
        role.toLowerCase(),
        role,
        JSON.stringify([p.id]),
        new Date().toISOString(),
      );
  const zip = new JSZip();
  zip.file(
    "package.json",
    JSON.stringify({
      name: "preserved-garden",
      version: "1.0.0",
      engines: { node: ">=24" },
      scripts: { build: "node build.js" },
    }),
  );
  zip.file(
    "package-lock.json",
    '{"name":"preserved-garden","version":"1.0.0","lockfileVersion":3,"packages":{}}',
  );
  zip.file(
    "build.js",
    "require('node:fs').mkdirSync('dist',{recursive:true});require('node:fs').copyFileSync('index.html','dist/index.html');",
  );
  zip.file(
    "index.html",
    "<!doctype html><title>Preserved Garden</title><h1>Garden</h1>",
  );
  zip.file(".env.example", "DEMO_API_KEY=do-not-preserve-this-value");
  zip.file("customers.csv", "private customer data");
  zip.file("yarn.lock", "# dependency lockfile\n");
  p.sourceId = await storeUpload(
    "owner",
    p.id,
    "source.zip",
    "source",
    "application/zip",
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  p.hostingProvider = "vercel";
  p.hostingProjectId = "original_provider";
  p.hostingTeamId = "team_unit";
  p.deploymentId = "original_deployment";
  await saveProject(p, "owner");
  await addService("owner", "owner", {
    name: "Shared DB",
    kind: "Database",
    notes: "Provision an independent instance",
    projects: [p.id, hidden.id],
    origin: "Manual",
  });
  await addService("owner", "owner", {
    name: "Shared serving layer",
    kind: "Hosting",
    projects: [p.id, hidden.id],
    origin: "Unknown",
  });
  const map = await dependencyMap("editor", "owner");
  assert.ok(
    map.services.every((s) =>
      s.relationships.every((l) => l.projectId === p.id),
    ),
  );
  assert.ok(!JSON.stringify(map).includes("Restricted project"));
  const impact = await hostingImpact(p, "editor");
  assert.ok(!JSON.stringify(impact).includes("Restricted project"));
  assert.match(impact.detail.join(" "), /outside your access scope/);
  const before = String(
    (await db().prepare("SELECT data FROM projects WHERE id=?").get(p.id))!
      .data,
  );
  const initial = await preparePreservation("owner", p.id, { paths: [] });
  assert.ok(
    initial.preview.eligible.some((f) => f.path === "package-lock.json"),
  );
  assert.ok(initial.preview.eligible.some((f) => f.path === "yarn.lock"));
  assert.ok(!initial.preview.eligible.some((f) => f.path === "customers.csv"));
  const options = {
    paths: initial.preview.eligible.map((f) => f.path),
    runtime: "Node.js >=24",
    buildInstructions: "npm ci --ignore-scripts then npm run build",
    outputDirectory: "dist",
    externalAssets: "Database, API accounts and domains remain external",
    retentionDays: 0,
  };
  const preview = await preparePreservation("owner", p.id, options);
  await assert.rejects(
    preparePreservation("editor", p.id, options),
    /does not permit/,
  );
  await assert.rejects(
    preparePreservation("other", p.id, options),
    /Workspace not found/,
  );
  await assert.rejects(
    createPreservation("owner", p.id, options, "0".repeat(64)),
    /changed/,
  );
  const b = await createPreservation(
      "owner",
      p.id,
      options,
      preview.preview.digest,
    ),
    duplicate = await createPreservation(
      "owner",
      p.id,
      options,
      preview.preview.digest,
    );
  assert.equal(duplicate.id, b.id);
  assert.equal(b.data.snapshot.uploadId, p.sourceId);
  assert.equal(b.data.snapshot.recordedCommit, "abcdef1234567");
  assert.match(b.data.snapshot.commitEvidence, /not proof/);
  const preserved = await uploadBytes(b.upload_id, "owner");
  await inspectPreservationPackage(preserved);
  const pack = await JSZip.loadAsync(preserved);
  assert.ok(pack.file("manifest.json"));
  assert.ok(pack.file("source/package-lock.json"));
  assert.equal(pack.file("source/.env.example"), null);
  assert.ok(!JSON.stringify(b.data).includes("do-not-preserve-this-value"));
  const calls: {
    options?: Record<string, unknown>;
    commands: Record<string, unknown>[];
    stopped: boolean;
    policy?: string;
  } = { commands: [], stopped: false };
  const artifact = Buffer.from(
    "<!doctype html><title>Saved build</title><h1>Garden</h1>",
  );
  const create = async (options: Record<string, unknown>) => {
    calls.options = options;
    return {
      writeFiles: async () => {},
      updateNetworkPolicy: async (policy: string) => {
        calls.policy = policy;
      },
      runCommand: async (command: Record<string, unknown>) => {
        calls.commands.push(command);
        const args = command.args as string[],
          stage =
            String(command.cmd) === "npm" && args[0] === "ci"
              ? "install"
              : args[0] === "run"
                ? "build"
                : args[0] === "-e"
                  ? "inventory"
                  : "runtime";
        const output =
          stage === "runtime"
            ? "v24.10.0\n"
            : stage === "inventory"
              ? JSON.stringify([{ path: "index.html", size: artifact.length }])
              : "Private arbitrary stdout and DEMO_API_KEY=unit-private-value";
        const sink = command.stdout as
          { write: (v: string) => void } | undefined;
        sink?.write(output);
        return {
          exitCode: 0,
          stdout: async () => output,
          stderr: async () => "",
        };
      },
      readFile: async () => Readable.from([artifact]),
      stop: async () => {
        calls.stopped = true;
      },
    };
  };
  const check = await newBundleCheck("editor", b.id);
  assert.equal((await newBundleCheck("editor", b.id)).id, check.id);
  await assert.rejects(
    newBundleCheck("owner", b.id),
    /collaborator already queued/,
  );
  const evidence = await verifyBundle(
    "editor",
    b.id,
    check.id,
    create as never,
  );
  assert.equal(evidence.buildVerified, true);
  assert.equal(evidence.functionalityVerified, false);
  assert.equal(evidence.runtime, "v24.10.0");
  assert.equal(evidence.packageSha256, b.data.packageSha256);
  assert.ok(evidence.artifactId);
  assert.equal(calls.options?.persistent, false);
  assert.deepEqual(calls.options?.resources, { vcpus: 1 });
  assert.equal(calls.options?.timeout, 180000);
  assert.equal(calls.policy, "deny-all");
  assert.equal(calls.stopped, true);
  assert.ok(!JSON.stringify(evidence).includes("unit-private-value"));
  assert.ok(
    !JSON.stringify(calls.commands).includes("unit-only-sandbox-credential"),
  );
  assert.match(
    safeBuildDiagnostics(
      "Install",
      1,
      "npm ERR! ERESOLVE\nSECRET=not-for-logs",
    ).join(" "),
    /ERESOLVE/,
  );
  assert.ok(
    !safeBuildDiagnostics("Install", 1, "SECRET=not-for-logs")
      .join(" ")
      .includes("not-for-logs"),
  );
  await assert.rejects(newBundleCheck("viewer", b.id), /does not permit/);
  await saveToken("owner", "vercel", "unit-provider-token");
  await saveToken("owner", "vercel-team", "team_unit");
  await db()
    .prepare(
      "UPDATE members SET role='Owner' WHERE workspace_id='owner' AND user_id='editor'",
    )
    .run();
  await assert.rejects(
    recreationPreview("editor", b.id, "Scoped recreation"),
    /full workspace Owner/,
  );
  await db()
    .prepare(
      "UPDATE members SET role='Editor' WHERE workspace_id='owner' AND user_id='editor'",
    )
    .run();
  const rp = await recreationPreview("owner", b.id, "Garden recreated");
  assert.match(rp.effect, /No repository link/);
  assert.match(rp.charges, /incur charges/);
  await assert.rejects(
    beginRecreation("editor", b.id, {
      name: rp.name,
      expires: rp.expires,
      confirmation: rp.confirmation,
      reviewed: true,
    }),
    /does not permit/,
  );
  const begun = await beginRecreation("owner", b.id, {
    name: rp.name,
    expires: rp.expires,
    confirmation: rp.confirmation,
    reviewed: true,
  });
  const same = await beginRecreation("owner", b.id, {
    name: rp.name,
    expires: rp.expires,
    confirmation: rp.confirmation,
    reviewed: true,
  });
  assert.equal(same.recreation.id, begun.recreation.id);
  let providerCreated = 0,
    deployed = 0,
    configured = 0,
    lostResponse = true;
  const providerId = "new_independent_provider";
  let remoteName = "";
  const requests: string[] = [];
  const request = (async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url));
    requests.push(`${init?.method || "GET"} ${u.pathname}`);
    const payload =
      init?.body && typeof init.body === "string"
        ? JSON.parse(init.body)
        : null;
    if (u.pathname.startsWith("/v9/projects/"))
      return providerCreated
        ? Response.json({ id: providerId, name: remoteName })
        : new Response("{}", { status: 404 });
    if (u.pathname === "/v11/projects") {
      providerCreated++;
      remoteName = payload.name;
      assert.notEqual(remoteName, p.name);
      assert.ok(!payload.gitRepository);
      return Response.json({ id: providerId, name: remoteName });
    }
    if (u.pathname.endsWith("/env") && init?.method === "POST") {
      configured++;
      assert.ok(
        payload.every(
          (v: { target: string[]; type: string; value: string }) =>
            v.target[0] === "preview" &&
            v.type === "encrypted" &&
            v.value === "independent-test-secret",
        ),
      );
      return Response.json({ created: [], failed: [] });
    }
    if (u.pathname.endsWith("/env"))
      return Response.json({
        envs: configured ? [{ key: "DEMO_API_KEY", target: ["preview"] }] : [],
      });
    if (u.pathname === "/v2/files") return Response.json({});
    if (u.pathname === "/v13/deployments") {
      deployed++;
      assert.equal(payload.project, providerId);
      assert.ok(!payload.target);
      assert.equal(payload.meta.chapterRecreation, begun.recreation.id);
      if (lostResponse) {
        lostResponse = false;
        throw new Error("Interrupted response");
      }
      return Response.json({
        id: "new_deployment",
        projectId: providerId,
        readyState: "QUEUED",
      });
    }
    if (u.pathname === "/v6/deployments")
      return Response.json({
        deployments: [
          {
            id: "new_deployment",
            projectId: providerId,
            meta: { chapterRecreation: begun.recreation.id },
          },
        ],
      });
    if (u.pathname === "/v13/deployments/new_deployment")
      return Response.json({
        id: "new_deployment",
        projectId: providerId,
        readyState: "READY",
        url: "independent-test.vercel.app",
      });
    throw new Error("Unexpected provider request");
  }) as typeof fetch;
  const needs = await runRecreation("owner", begun.recreation.id, request);
  assert.equal(needs.state, "needs-configuration");
  assert.equal(deployed, 0);
  await configureRecreation(
    "owner",
    needs.id,
    { DEMO_API_KEY: "independent-test-secret" },
    true,
    request,
  );
  assert.equal(configured, 1);
  assert.ok(
    !JSON.stringify(
      (await recreationAccess(needs.id, "owner")).recreation,
    ).includes("independent-test-secret"),
  );
  await assert.rejects(
    runRecreation("owner", needs.id, request),
    /could not be reached/,
  );
  const ready = await runRecreation("owner", needs.id, request);
  assert.equal(ready.state, "ready");
  assert.equal(providerCreated, 1);
  assert.equal(deployed, 1);
  assert.ok(
    requests.every(
      (path) =>
        !path.includes("original_provider") &&
        !path.includes("original_deployment"),
    ),
  );
  const recreated = await getProject(ready.project_id, "owner");
  assert.notEqual(recreated.sourceId, p.sourceId);
  assert.notEqual(recreated.sourceId, b.upload_id);
  assert.equal(recreated.hostingProjectId, providerId);
  assert.equal(recreated.repository, "");
  assert.equal(recreated.shared, false);
  assert.equal(
    String(
      (await db().prepare("SELECT data FROM projects WHERE id=?").get(p.id))!
        .data,
    ),
    before,
  );
  await assert.rejects(createPackageLink("viewer", b.id, 7), /does not permit/);
  const link = await createPackageLink("owner", b.id, 7),
    transfer = await startPackageDownload(link.token);
  await assert.rejects(
    acknowledgePackageDownload(link.token, transfer.id, transfer.sha256),
    /incomplete/,
  );
  const pieces: Buffer[] = [];
  for (let i = 0; i < Math.ceil(transfer.bytes / transfer.chunkSize); i++)
    pieces.push(await packageDownloadPart(link.token, transfer.id, i));
  assert.equal(sha256(Buffer.concat(pieces)), transfer.sha256);
  await acknowledgePackageDownload(link.token, transfer.id, transfer.sha256);
  await acknowledgePackageDownload(link.token, transfer.id, transfer.sha256);
  assert.equal(
    Number(
      (
        await db()
          .prepare("SELECT downloads FROM package_links WHERE id=?")
          .get(link.id)
      )?.downloads,
    ),
    1,
  );
  assert.equal(
    Number(
      (
        await db()
          .prepare("SELECT visits FROM package_links WHERE id=?")
          .get(link.id)
      )?.visits,
    ),
    0,
  );
  const interrupted = await startPackageDownload(link.token);
  const delegated = await db()
    .prepare("INSERT INTO members VALUES(?,?,?,?,?)")
    .run(
      "owner",
      "other",
      "Owner",
      JSON.stringify([p.id]),
      new Date().toISOString(),
    );
  const delegatedLink = await createPackageLink("other", b.id, 7);
  await db()
    .prepare(
      "UPDATE members SET role='Viewer' WHERE workspace_id='owner' AND user_id='other'",
    )
    .run();
  await assert.rejects(
    activePackageLink(delegatedLink.token),
    /does not permit/,
  );
  await db()
    .prepare("UPDATE package_links SET revoked=1 WHERE id=?")
    .run(link.id);
  await assert.rejects(
    packageDownloadPart(link.token, interrupted.id, 0),
    /expired or was revoked/,
  );
  const expired = await createPackageLink("owner", b.id, 1);
  await db()
    .prepare("UPDATE package_links SET expires=0 WHERE id=?")
    .run(expired.id);
  await assert.rejects(
    activePackageLink(expired.token),
    /expired or was revoked/,
  );
  const exported = await buildExport("owner", "owner", [p.id]);
  assert.ok(!exported.bytes.includes(Buffer.from("independent-test-secret")));
  const { recoveryPreview } = await import("../src/lib/recovery");
  const recover = await recoveryPreview("owner", "owner", exported.bytes),
    result = await restoreExport(
      "owner",
      "owner",
      exported.bytes,
      recover.digest,
      [p.id],
    );
  const recoveredId = result.projects[0].id,
    recoveredBundles = await db()
      .prepare("SELECT id FROM preservation_bundles WHERE project_id=?")
      .all(recoveredId);
  assert.equal(recoveredBundles.length, 1);
  const recovered = await bundleAccess(String(recoveredBundles[0].id), "owner");
  assert.equal(recovered.data.packageSha256, b.data.packageSha256);
  assert.equal(
    sha256(await uploadBytes(recovered.upload_id, "owner")),
    b.data.packageSha256,
  );
  assert.equal((await getProject(recoveredId, "owner")).hostingProjectId, "");
  const restoredChecks = await db()
    .prepare("SELECT data FROM bundle_checks WHERE bundle_id=?")
    .all(recovered.id);
  assert.ok(restoredChecks.length > 0);
  assert.ok(
    restoredChecks.every((row) => {
      const data = JSON.parse(String(row.data));
      return (
        data.buildVerified === false &&
        data.functionalityVerified === false &&
        data.result.status === "Not Checked"
      );
    }),
  );
  const recoveredMap = await dependencyMap("owner", "owner");
  assert.ok(
    recoveredMap.services.some((s) =>
      s.relationships.some(
        (l) => l.projectId === recoveredId && l.origin === "Unknown",
      ),
    ),
  );
  const usageBefore = (await usage("owner")).storage;
  await db()
    .prepare("UPDATE preservation_bundles SET expires=1 WHERE id=?")
    .run(b.id);
  await expireBundles();
  await assert.rejects(bundleAccess(b.id, "owner"), /missing/);
  assert.ok((await usage("owner")).storage < usageBefore);
  assert.equal(
    (await getProject(recreated.id, "owner")).hostingProjectId,
    providerId,
  );
});

test("large source uploads resume acknowledged chunks, reject corruption, enforce roles and storage, and finalize only once", async () => {
  const { db } = await import("../src/lib/database"),
    { newProject, insertProject, getProject } = await import("../src/lib/db"),
    { sha256 } = await import("../src/lib/preservation"),
    {
      startTransferUpload,
      putTransferChunk,
      transferUploadStatus,
      finishTransferUpload,
      cancelTransferUpload,
      CHUNK_SIZE,
      expireTransfers,
    } = await import("../src/lib/file-transfers"),
    { usage } = await import("../src/lib/billing");
  const p = await insertProject(
    newProject({ name: "Large transfer" }),
    "owner",
  );
  await db()
    .prepare(
      "UPDATE members SET scope=? WHERE workspace_id='owner' AND user_id='editor'",
    )
    .run(JSON.stringify([p.id]));
  const zip = new JSZip();
  zip.file("package.json", '{"name":"large"}');
  zip.file("public/large-a.bin", randomBytes(11 * 1024 * 1024));
  zip.file("public/large-b.bin", randomBytes(10 * 1024 * 1024));
  zip.file(".env", "API_KEY=never-in-stored-source");
  const bytes = await zip.generateAsync({ type: "nodebuffer" }),
    digest = sha256(bytes);
  const before = (await usage("owner")).storage;
  await assert.rejects(
    startTransferUpload("viewer", p.id, {
      name: "large.zip",
      size: bytes.length,
      digest,
    }),
    /not found/,
  );
  const limits = process.env.CHAPTER_PLAN_LIMITS;
  process.env.CHAPTER_PLAN_LIMITS = JSON.stringify({
    Free: { storage: before + 1 },
  });
  await assert.rejects(
    startTransferUpload("owner", p.id, {
      name: "large.zip",
      size: bytes.length,
      digest,
    }),
    /storage limit/,
  );
  if (limits === undefined) delete process.env.CHAPTER_PLAN_LIMITS;
  else process.env.CHAPTER_PLAN_LIMITS = limits;
  const first = await startTransferUpload("editor", p.id, {
    name: "large.zip",
    size: bytes.length,
    digest,
  });
  const chunk = bytes.subarray(0, CHUNK_SIZE);
  await assert.rejects(
    putTransferChunk("editor", first.id, 0, chunk, "0".repeat(64)),
    /checksum/,
  );
  await putTransferChunk("editor", first.id, 0, chunk, sha256(chunk));
  await putTransferChunk("editor", first.id, 0, chunk, sha256(chunk));
  const resumed = await startTransferUpload("editor", p.id, {
    name: "large.zip",
    size: bytes.length,
    digest,
  });
  assert.equal(resumed.id, first.id);
  assert.equal(resumed.parts.length, 1);
  await assert.rejects(finishTransferUpload("editor", first.id), /missing/);
  assert.equal(
    (await transferUploadStatus("editor", first.id)).state,
    "uploading",
  );
  const staged = await db()
    .prepare("SELECT data FROM transfer_chunks WHERE upload_id=? AND part=0")
    .get(first.id);
  assert.ok(
    !Buffer.from(staged!.data as Uint8Array)
      .subarray(0, 20)
      .equals(chunk.subarray(0, 20)),
  );
  for (let part = 1; part < Math.ceil(bytes.length / CHUNK_SIZE); part++) {
    const b = bytes.subarray(part * CHUNK_SIZE, (part + 1) * CHUNK_SIZE);
    await putTransferChunk("editor", first.id, part, b, sha256(b));
  }
  const finished = await finishTransferUpload("editor", first.id),
    again = await finishTransferUpload("editor", first.id);
  assert.equal(finished.uploadId, again.uploadId);
  assert.equal(again.duplicate, true);
  assert.equal((await getProject(p.id, "owner")).sourceId, finished.uploadId);
  assert.equal(
    Number(
      (
        await db()
          .prepare(
            "SELECT count(*) AS n FROM transfer_chunks WHERE upload_id=?",
          )
          .get(first.id)
      )?.n,
    ),
    0,
  );
  assert.equal((await transferUploadStatus("editor", first.id)).reserved, 0);
  assert.ok(
    Number(
      (
        await db()
          .prepare(
            "SELECT count(*) AS n FROM versions WHERE project_id=? AND kind='package'",
          )
          .get(p.id)
      )?.n,
    ) >= 2,
  );
  const small = new JSZip();
  small.file("index.html", "<h1>Second file</h1>");
  const data = await small.generateAsync({ type: "nodebuffer" }),
    pending = await startTransferUpload("owner", p.id, {
      name: "pending.zip",
      size: data.length,
      digest: sha256(data),
    });
  const held = (await usage("owner")).storage;
  await putTransferChunk("owner", pending.id, 0, data, sha256(data));
  await cancelTransferUpload("owner", pending.id);
  assert.ok((await usage("owner")).storage < held);
  const exp = await startTransferUpload("owner", p.id, {
    name: "expiry.zip",
    size: data.length,
    digest: sha256(data),
  });
  await db()
    .prepare("UPDATE transfer_uploads SET expires=0 WHERE id=?")
    .run(exp.id);
  await expireTransfers();
  assert.equal(
    (
      await db()
        .prepare("SELECT state FROM transfer_uploads WHERE id=?")
        .get(exp.id)
    )?.state,
    "expired",
  );
});

test("failed builds keep safe evidence, abandoned jobs can be replaced, and retention waits for active build leases", async () => {
  const { db } = await import("../src/lib/database"),
    { newProject, insertProject, storeUpload, saveProject } =
      await import("../src/lib/db"),
    { preparePreservation, createPreservation, removeBundle, expireBundles } =
      await import("../src/lib/preservation"),
    { newBundleCheck, verifyBundle } = await import("../src/lib/bundle-build"),
    { enqueue } = await import("../src/lib/jobs");
  const p = await insertProject(
    newProject({ name: "Failure recovery", status: "Archived" }),
    "owner",
  );
  const zip = new JSZip();
  zip.file(
    "package.json",
    '{"name":"failure","scripts":{"build":"node build.js"}}',
  );
  zip.file(
    "package-lock.json",
    '{"name":"failure","lockfileVersion":3,"packages":{}}',
  );
  zip.file("build.js", 'console.log("build")');
  p.sourceId = await storeUpload(
    "owner",
    p.id,
    "failure.zip",
    "source",
    "application/zip",
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  await saveProject(p, "owner");
  const options = { paths: ["package.json", "package-lock.json", "build.js"] },
    preview = await preparePreservation("owner", p.id, options),
    b = await createPreservation(
      "owner",
      p.id,
      options,
      preview.preview.digest,
    ),
    abandoned = await newBundleCheck("owner", b.id);
  const identity = `bundle-build:${abandoned.id}`,
    payload = { projectId: p.id, bundleId: b.id, checkId: abandoned.id };
  const ids = await Promise.all([
    enqueue("owner", "owner", "bundle-build", payload, identity),
    enqueue("owner", "owner", "bundle-build", payload, identity),
  ]);
  assert.equal(ids[0], ids[1]);
  assert.equal(
    Number(
      (
        await db()
          .prepare("SELECT count(*) AS n FROM jobs WHERE id=?")
          .get(identity)
      )?.n,
    ),
    1,
  );
  await db().prepare("UPDATE jobs SET state='failed' WHERE id=?").run(identity);
  const replacement = await newBundleCheck("owner", b.id);
  assert.notEqual(replacement.id, abandoned.id);
  await assert.rejects(
    verifyBundle("owner", b.id, abandoned.id),
    /ended without a result/,
  );
  let stopped = false,
    buildAttempted = false;
  const create = async () => ({
    writeFiles: async () => {},
    runCommand: async (command: {
      cmd: string;
      stdout?: { write: (s: string) => void };
    }) => {
      if (command.cmd === "node")
        return { exitCode: 0, stdout: async () => "v24.10.0" };
      if (command.cmd === "npm") {
        command.stdout?.write("npm ERR! ERESOLVE\nsecret=private-test-value");
        return { exitCode: 1 };
      }
      buildAttempted = true;
      throw new Error("Unexpected command");
    },
    stop: async () => {
      stopped = true;
    },
  });
  const failed = await verifyBundle(
    "owner",
    b.id,
    replacement.id,
    create as never,
  );
  assert.equal(failed.result.status, "Needs Attention");
  assert.equal(failed.buildVerified, false);
  assert.equal(failed.functionalityVerified, false);
  assert.equal(failed.artifactId, "");
  assert.match(failed.logs.join(" "), /ERESOLVE/);
  assert.ok(!JSON.stringify(failed).includes("private-test-value"));
  assert.equal(stopped, true);
  assert.equal(buildAttempted, false);
  const active = await newBundleCheck("owner", b.id),
    activeId = await enqueue(
      "owner",
      "owner",
      "bundle-build",
      { ...payload, checkId: active.id },
      `bundle-build:${active.id}`,
    );
  await db()
    .prepare("UPDATE jobs SET state='running',lease=? WHERE id=?")
    .run(Date.now() + 300000, activeId);
  await assert.rejects(removeBundle("owner", b.id), /build check is running/);
  await db()
    .prepare("UPDATE preservation_bundles SET expires=1 WHERE id=?")
    .run(b.id);
  await expireBundles();
  assert.equal(
    Number(
      (
        await db()
          .prepare("SELECT deleted FROM preservation_bundles WHERE id=?")
          .get(b.id)
      )?.deleted,
    ),
    0,
  );
  await db()
    .prepare("UPDATE jobs SET state='failed',lease=0 WHERE id=?")
    .run(activeId);
  await expireBundles();
  assert.equal(
    Number(
      (
        await db()
          .prepare("SELECT deleted FROM preservation_bundles WHERE id=?")
          .get(b.id)
      )?.deleted,
    ),
    1,
  );
  assert.equal(
    await db().prepare("SELECT id FROM uploads WHERE id=?").get(b.upload_id),
    undefined,
  );
});
