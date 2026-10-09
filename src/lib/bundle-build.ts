import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { Sandbox } from "@vercel/sandbox";
import { db } from "./database";
import { projectAccess } from "./access";
import { isolatedBuild, boundedCommandLog } from "./revival";
import { accountSecrets, record, storeUpload } from "./db";
import {
  bundleAccess,
  bundleSource,
  PACKAGE_LIMIT,
  sha256,
  removeStoredUpload,
} from "./preservation";
import { inspectZip } from "./uploads";
import { AppError } from "./security";
import { handoverText } from "./phase-two";
import type { RevivalItem } from "./types";

export type BuildEvidence = {
  bundleId: string;
  packageSha256: string;
  sourceSha256: string;
  recordedCommit: string;
  testedAt: string;
  result: RevivalItem;
  buildVerified: boolean;
  functionalityVerified: false;
  runtime: string;
  limits: string;
  logs: string[];
  artifactId: string;
  artifactSha256: string;
  artifactDetail: string;
  jobId?: string;
};
// Keep diagnostic categories and exit codes. Raw build stdout can contain arbitrary project data.
export function safeBuildDiagnostics(
  stage: string,
  code: number | null,
  raw: string,
) {
  const messages = [`${stage}: exit ${code === null ? "unknown" : code}.`];
  for (const m of raw
    .slice(0, 100000)
    .matchAll(
      /\b(E(?:RESOLVE|LOCKVERIFY|BADENGINE|NOTFOUND|CONNRESET|CONNREFUSED|INTEGRITY|ACCES|NOENT|NPM_[A-Z_]+)|TS\d{3,5}|MODULE_NOT_FOUND|ERR_[A-Z_]+)\b/g,
    ))
    if (!messages.includes(`Reported diagnostic: ${m[1]}`))
      messages.push(`Reported diagnostic: ${m[1]}`);
  if (/missing script/i.test(raw))
    messages.push("The package is missing the requested build script.");
  if (/lockfile|package-lock/i.test(raw) && code !== 0)
    messages.push(
      "Review package-lock.json and its agreement with package.json.",
    );
  if (/cannot find module|module not found/i.test(raw))
    messages.push("A dependency or imported module could not be found.");
  if (/out of memory|heap limit|allocation failed/i.test(raw))
    messages.push("The build exceeded its memory allowance.");
  return messages.slice(0, 20);
}
async function staticArtifact(
  sandbox: Sandbox,
  directory: string,
  secrets: string[],
) {
  // Fixed code runs only in the isolated VM. The host never executes uploaded project code.
  const root = `/vercel/sandbox/${directory === "." ? "" : directory}`;
  const script = `const fs=require('node:fs'),path=require('node:path');const root=process.argv[1];let files=[],total=0;function walk(dir){for(const n of fs.readdirSync(dir)){const p=path.join(dir,n),s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('Symlinks excluded');if(s.isDirectory())walk(p);else if(s.isFile()){if(s.size>20971520||files.length>=2000||(total+=s.size)>104857600)throw Error('Output limits');files.push({path:path.relative(root,p).split(path.sep).join('/'),size:s.size});}}}walk(root);console.log(JSON.stringify(files));`;
  const inventoryLog = boundedCommandLog(500001);
  const listing = await sandbox.runCommand({
    cmd: "node",
    args: ["-e", script, root],
    cwd: "/vercel/sandbox",
    stdout: inventoryLog.sink,
  });
  if (listing.exitCode !== 0)
    throw new AppError(
      "The selected static output directory is missing, oversized or contains symlinks.",
      409,
    );
  const raw = inventoryLog.text();
  if (raw.length > 500000)
    throw new AppError("Static output inventory exceeds its limit.");
  const files = JSON.parse(raw) as { path: string; size: number }[],
    zip = new JSZip();
  let total = 0;
  if (!Array.isArray(files) || !files.length || files.length > 2000)
    throw new AppError("Invalid static output inventory.");
  for (const f of files) {
    if (
      typeof f.path !== "string" ||
      !f.path ||
      f.path.split(/[\\/]/).some((p) => p === ".." || p.startsWith(".")) ||
      f.path.startsWith("/") ||
      /^[a-z]:/i.test(f.path) ||
      !Number.isSafeInteger(f.size) ||
      f.size < 0 ||
      f.size > 20 * 1024 ** 2
    )
      throw new AppError("Unsafe static output entry.");
    const readAbort = new AbortController();
    const stream = await sandbox.readFile(
      { path: `${root}/${f.path}` },
      { signal: readAbort.signal },
    );
    if (!stream) throw new AppError("Static output file is missing.");
    const parts: Buffer[] = [];
    let received = 0;
    for await (const part of stream) {
      const buffer = Buffer.from(part);
      if ((received += buffer.length) > f.size) {
        readAbort.abort();
        throw new AppError("Static output grew beyond its declared size.");
      }
      parts.push(buffer);
    }
    const bytes = Buffer.concat(parts);
    if (
      !bytes ||
      bytes.length !== f.size ||
      (total += bytes.length) > PACKAGE_LIMIT
    )
      throw new AppError("Static output changed or exceeded its size limit.");
    if (
      /\.(?:js|html|css|json|svg|txt|xml)$/i.test(f.path) &&
      handoverText(bytes.toString("utf8"), secrets) !== bytes.toString("utf8")
    )
      throw new AppError(
        "Static output contains possible credentials or private contact data. It was not retained.",
      );
    zip.file(f.path, bytes);
  }
  const inspected = await inspectZip(
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    secrets,
    PACKAGE_LIMIT,
  );
  if (!inspected.build)
    throw new AppError(
      "The output must be a static site with index.html. Server applications need an external deployment workflow.",
    );
  return inspected.build;
}
export async function verifyBundle(
  actor: string,
  bundleId: string,
  checkId: string,
  create = Sandbox.create,
) {
  const b = await bundleAccess(bundleId, actor),
    access = await projectAccess(b.project_id, actor, "edit");
  const row = await db()
    .prepare("SELECT data,state FROM bundle_checks WHERE id=? AND bundle_id=?")
    .get(checkId, bundleId);
  if (!row) throw new AppError("Build check not found.", 404);
  if (row.state === "failed")
    throw new AppError(
      "This build check ended without a result. Start a new Verify Build check for this version.",
      404,
    );
  if (row.state === "completed")
    return JSON.parse(String(row.data)) as BuildEvidence;
  const prior = JSON.parse(String(row.data)),
    source = await bundleSource(b),
    logs: string[] = [];
  let runtime = "Not checked",
    artifactId = "",
    artifactSha256 = "",
    artifactDetail = "No deployable static output was retained.";
  const result = await isolatedBuild(source, create, {
    maximum: PACKAGE_LIMIT,
    record(stage, code, raw) {
      if (stage === "Runtime")
        runtime =
          raw.trim().match(/^v\d+\.\d+\.\d+$/)?.[0] || "Version unavailable";
      logs.push(...safeBuildDiagnostics(stage, code, raw));
    },
    artifact: async (sandbox) => {
      try {
        const bytes = await staticArtifact(
          sandbox,
          b.data.outputDirectory,
          await accountSecrets(access.owner),
        );
        artifactId = await storeUpload(
          access.owner,
          b.project_id,
          "verified-static-build.zip",
          "verified-build",
          "application/zip",
          bytes,
        );
        artifactSha256 = sha256(bytes);
        artifactDetail =
          "Static output retained from this successful isolated build; application behavior has not been tested.";
      } catch (e) {
        artifactDetail =
          e instanceof AppError
            ? e.message
            : "Static output could not be retained. Review the selected output directory and retry.";
      }
    },
  });
  const data: BuildEvidence = {
    bundleId,
    packageSha256: b.data.packageSha256,
    sourceSha256: sha256(source),
    recordedCommit: b.data.snapshot.recordedCommit,
    testedAt: new Date().toISOString(),
    result,
    buildVerified: result.status === "Passed",
    functionalityVerified: false,
    runtime,
    limits:
      "Temporary VM: 1 vCPU, 2 GB RAM, 180 seconds; Node heap 1.5 GB. npm registry only for install, no lifecycle install scripts, build network denied, no secrets supplied.",
    logs,
    artifactId,
    artifactSha256,
    artifactDetail,
    ...(prior.jobId ? { jobId: prior.jobId } : {}),
  };
  try {
    await db()
      .prepare("UPDATE bundle_checks SET state='completed',data=? WHERE id=?")
      .run(JSON.stringify(data), checkId);
  } catch (e) {
    const saved = await db()
      .prepare("SELECT state,data FROM bundle_checks WHERE id=?")
      .get(checkId);
    if (saved?.state !== "completed" || saved.data !== JSON.stringify(data)) {
      if (artifactId) await removeStoredUpload(artifactId, access.owner);
      throw e;
    }
  }
  await record(
    access.owner,
    `Verified preserved version ${bundleId}: ${result.status}; application functionality not checked`,
    "build-check",
    b.project_id,
  );
  return data;
}
export async function newBundleCheck(actor: string, bundleId: string) {
  const b = await bundleAccess(bundleId, actor);
  await projectAccess(b.project_id, actor, "edit");
  const active = await db()
    .prepare(
      "SELECT id,data,actor FROM bundle_checks WHERE bundle_id=? AND state='queued' ORDER BY at DESC LIMIT 1",
    )
    .get(bundleId);
  if (active) {
    const job = await db()
      .prepare("SELECT state FROM jobs WHERE id=?")
      .get(
        (JSON.parse(String(active.data)) as { jobId?: string }).jobId ||
          `bundle-build:${active.id}`,
      );
    if (job?.state === "failed") {
      await db()
        .prepare(
          "UPDATE bundle_checks SET state='failed' WHERE id=? AND state='queued'",
        )
        .run(String(active.id));
      return newBundleCheck(actor, bundleId);
    }
    if (active.actor !== actor)
      throw new AppError(
        "A collaborator already queued this version's build check. Follow its result in the check history.",
        409,
      );
    return {
      id: String(active.id),
      data: JSON.parse(String(active.data)),
      owner: b.owner,
      projectId: b.project_id,
    };
  }
  const id = randomUUID();
  try {
    await db()
      .prepare("INSERT INTO bundle_checks VALUES(?,?,?,?,?,?)")
      .run(id, bundleId, actor, "queued", "{}", new Date().toISOString());
  } catch (e) {
    const row = await db()
      .prepare(
        "SELECT id,data,actor FROM bundle_checks WHERE bundle_id=? AND state='queued'",
      )
      .get(bundleId);
    if (row) {
      if (row.actor !== actor)
        throw new AppError(
          "A collaborator already queued this version's build check. Follow its result in the check history.",
          409,
        );
      return {
        id: String(row.id),
        data: JSON.parse(String(row.data)),
        owner: b.owner,
        projectId: b.project_id,
      };
    }
    throw e;
  }
  return { id, data: {}, owner: b.owner, projectId: b.project_id };
}
