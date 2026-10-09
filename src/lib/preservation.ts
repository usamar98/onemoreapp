import JSZip from "jszip";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "./database";
import { projectAccess } from "./access";
import { accountSecrets, uploadBytes, storeUpload, record } from "./db";
import { inspectZip, boundedEntry, screenshotType } from "./uploads";
import { transferablePath, handoverText } from "./phase-two";
import { AppError } from "./security";
import { release } from "./billing";
import { removeObject } from "./storage";

export const PACKAGE_LIMIT = 100 * 1024 * 1024;
export const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export const preservationOptions = z.object({
  paths: z.array(z.string().min(1).max(240)).max(1000).default([]),
  screenshots: z.array(z.string().max(100)).max(10).default([]),
  runtime: z.string().trim().max(400).default(""),
  buildInstructions: z.string().trim().max(8000).default(""),
  outputDirectory: z
    .string()
    .regex(/^(dist|build|out|public|\.)$/)
    .default("dist"),
  externalAssets: z.string().trim().max(8000).default(""),
  retentionDays: z.number().int().min(0).max(3650).default(0),
});
export type PreservationOptions = z.infer<typeof preservationOptions>;
export type BundleManifest = {
  format: "chapter-preservation-v1";
  projectName: string;
  projectId: string;
  snapshot: {
    uploadId: string;
    sha256: string;
    recordedCommit: string;
    commitEvidence: string;
  };
  runtime: string;
  detectedRuntime: string;
  buildInstructions: string;
  outputDirectory: string;
  requiredEnvNames: string[];
  referencedEnvNames: string[];
  notes: Record<string, unknown>;
  externalAssets: string;
  services: { name: string; kind: string; origin: string; evidence: string }[];
  files: { path: string; size: number; sha256: string }[];
  limitation: string;
};
export type PreservationPreview = {
  digest: string;
  manifest: BundleManifest;
  eligible: { path: string; size: number; sha256: string; preview: string }[];
  excluded: string[];
  selectedBytes: number;
};
export type Bundle = {
  id: string;
  project_id: string;
  owner: string;
  upload_id: string;
  digest: string;
  data: BundleManifest & { packageSha256: string; bytes: number };
  at: string;
  expires: number;
  deleted: number;
};
export async function bundleAccess(
  id: string,
  actor: string,
  control = false,
): Promise<Bundle> {
  const row = await db()
    .prepare("SELECT * FROM preservation_bundles WHERE id=? AND deleted=0")
    .get(id);
  if (!row || (Number(row.expires) && Number(row.expires) <= Date.now()))
    throw new AppError(
      "Package is missing or its retention period has ended.",
      404,
    );
  await projectAccess(
    String(row.project_id),
    actor,
    control ? "control" : "read",
  );
  return { ...row, data: JSON.parse(String(row.data)) } as unknown as Bundle;
}
export async function preparePreservation(
  actor: string,
  projectId: string,
  raw: unknown,
) {
  const options = preservationOptions.parse(raw),
    { project: p, owner } = await projectAccess(projectId, actor, "control");
  if (!p.sourceId)
    throw new AppError(
      "Upload a source snapshot first. A repository URL alone does not preserve its files.",
      409,
    );
  const secrets = await accountSecrets(owner),
    original = await uploadBytes(p.sourceId, owner);
  const source = await inspectZip(original, secrets, PACKAGE_LIMIT),
    zip = await JSZip.loadAsync(source.source);
  const eligible: PreservationPreview["eligible"] = [],
    excluded: string[] = [],
    selected = new Map<string, Buffer>();
  for (const f of Object.values(zip.files).filter((f) => !f.dir)) {
    if (!transferablePath(f.name) || handoverText(f.name, secrets) !== f.name) {
      excluded.push(f.name);
      continue;
    }
    const bytes = await boundedEntry(f, 20 * 1024 * 1024),
      text = bytes.toString("utf8");
    // Do not silently rewrite source code: a modified snapshot is not the selected version.
    if (bytes.includes(0) || handoverText(text, secrets) !== text) {
      excluded.push(f.name);
      continue;
    }
    eligible.push({
      path: f.name,
      size: bytes.length,
      sha256: sha256(bytes),
      preview: text.slice(0, 500),
    });
    if (options.paths.includes(f.name)) selected.set(`source/${f.name}`, bytes);
  }
  if (
    new Set(options.paths).size !== options.paths.length ||
    options.paths.some((path) => !eligible.some((f) => f.path === path))
  )
    throw new AppError(
      "Select only the reviewed eligible files. Sensitive contents and unsupported binary assets are excluded.",
    );
  if (
    new Set(options.screenshots).size !== options.screenshots.length ||
    options.screenshots.some((id) => !p.screenshotIds.includes(id))
  )
    throw new AppError("Select screenshots belonging to this project.");
  for (const id of options.screenshots) {
    const bytes = await uploadBytes(id, owner),
      type = screenshotType(bytes);
    selected.set(
      `screenshots/${id}.${type === "image/jpeg" ? "jpg" : type.split("/")[1]}`,
      bytes,
    );
  }
  let detectedRuntime = "Not recorded";
  const pkg = zip.file("package.json");
  if (pkg)
    try {
      const packageInfo = JSON.parse(await pkg.async("string"));
      detectedRuntime = `Node.js: ${packageInfo.engines?.node || "version not declared"}; package manager: ${packageInfo.packageManager || "not declared"}`;
    } catch {
      detectedRuntime = "Invalid package.json; fix it before verification";
    }
  const services = await db()
    .prepare(
      "SELECT s.name,s.kind,d.origin,d.evidence FROM service_dependencies d JOIN shared_services s ON s.id=d.service_id WHERE d.project_id=?",
    )
    .all(p.id);
  const clean = (s: string) => handoverText(s, secrets);
  const manifest: BundleManifest = {
    format: "chapter-preservation-v1",
    projectName: clean(p.name),
    projectId: p.id,
    snapshot: {
      uploadId: p.sourceId,
      sha256: sha256(original),
      recordedCommit: clean(p.version),
      commitEvidence:
        "Exact uploaded bytes identified by SHA-256. The recorded commit is a reference, not proof that selected files match a repository commit.",
    },
    runtime: clean(options.runtime) || "Not recorded",
    detectedRuntime: clean(detectedRuntime),
    buildInstructions: clean(options.buildInstructions) || "Not recorded",
    outputDirectory: options.outputDirectory,
    requiredEnvNames: p.requiredEnvNames,
    referencedEnvNames: source.envNames,
    notes: {
      purpose: clean(p.description),
      status: p.status,
      setup: clean(p.memory?.setup || ""),
      completed: clean(p.memory?.completed || ""),
      issues: clean(p.memory?.issues || ""),
      reason: clean(p.memory?.reason || ""),
      nextTask: clean(p.nextTask || p.memory?.nextTask || ""),
      blockers: clean(p.blockers),
      documentation: clean(p.documentation || ""),
      resumeBrief: clean(p.brief),
    },
    externalAssets:
      clean(options.externalAssets) ||
      "No additional external assets recorded; this does not establish that none are required.",
    services: services.map((s) => ({
      name: clean(String(s.name)),
      kind: String(s.kind),
      origin: String(s.origin),
      evidence: clean(String(s.evidence)),
    })),
    files: [...selected]
      .map(([path, bytes]) => ({
        path,
        size: bytes.length,
        sha256: sha256(bytes),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    limitation:
      "Only selected files, selected screenshots and saved notes are preserved. Git history, live deployments, databases, domains, third-party storage, API accounts, videos and unselected assets remain with their providers. Credentials and customer datasets are excluded. Review screenshots manually for private information. Build verification does not establish application functionality.",
  };
  const digest = sha256(
    Buffer.from(
      JSON.stringify({ manifest, retentionDays: options.retentionDays }),
    ),
  );
  return {
    preview: {
      digest,
      manifest,
      eligible,
      excluded,
      selectedBytes: [...selected.values()].reduce((n, b) => n + b.length, 0),
    },
    selected,
    options,
    owner,
  };
}
export async function createPreservation(
  actor: string,
  projectId: string,
  input: unknown,
  expectedDigest: string,
) {
  await expireBundles();
  const { preview, selected, options, owner } = await preparePreservation(
    actor,
    projectId,
    input,
  );
  if (preview.digest !== expectedDigest)
    throw new AppError(
      "The project or selection changed. Review the current contents again.",
      409,
    );
  if (!selected.size || !options.paths.length)
    throw new AppError("Select source files before preserving this project.");
  const existing = await db()
    .prepare(
      "SELECT id FROM preservation_bundles WHERE project_id=? AND digest=? AND deleted=0 AND (expires=0 OR expires>?) ORDER BY at DESC LIMIT 1",
    )
    .get(projectId, preview.digest, Date.now());
  if (existing) return bundleAccess(String(existing.id), actor);
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(preview.manifest, null, 2));
  zip.file(
    "PRESERVATION.md",
    `# ${preview.manifest.projectName}\n\n${preview.manifest.limitation}\n\nRuntime\n${preview.manifest.runtime}\n${preview.manifest.detectedRuntime}\n\nBuild instructions\n${preview.manifest.buildInstructions}\n\nExternal assets\n${preview.manifest.externalAssets}\n\nConfiguration names (no values)\n${preview.manifest.requiredEnvNames.join("\n") || "Not recorded"}`,
  );
  for (const [path, bytes] of selected) zip.file(path, bytes);
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  if (bytes.length > PACKAGE_LIMIT)
    throw new AppError("Package exceeds the 100 MB transfer limit.", 413);
  const uploadId = await storeUpload(
      owner,
      projectId,
      "preservation.zip",
      "preservation",
      "application/zip",
      bytes,
    ),
    id = randomUUID(),
    at = new Date().toISOString();
  try {
    await db()
      .prepare("INSERT INTO preservation_bundles VALUES(?,?,?,?,?,?,?,?,0)")
      .run(
        id,
        projectId,
        owner,
        uploadId,
        preview.digest,
        JSON.stringify({
          ...preview.manifest,
          packageSha256: sha256(bytes),
          bytes: bytes.length,
        }),
        at,
        options.retentionDays
          ? Date.now() + options.retentionDays * 86400000
          : 0,
      );
  } catch (e) {
    const saved = await db()
      .prepare(
        "SELECT id,upload_id FROM preservation_bundles WHERE project_id=? AND digest=? AND deleted=0",
      )
      .get(projectId, preview.digest);
    if (saved) {
      if (saved.upload_id !== uploadId)
        await removeStoredUpload(uploadId, owner);
      return bundleAccess(String(saved.id), actor);
    }
    await removeStoredUpload(uploadId, owner);
    throw e;
  }
  await record(
    owner,
    `Preserved ${preview.manifest.projectName}; package version ${id}`,
    "preserve",
    projectId,
  );
  return bundleAccess(id, actor);
}
export async function verifiedBundleBytes(bundle: Bundle) {
  const bytes = await uploadBytes(bundle.upload_id, bundle.owner);
  if (sha256(bytes) !== bundle.data.packageSha256)
    throw new AppError(
      "Package integrity check failed. Recover a valid backup before sharing or building.",
      409,
    );
  return bytes;
}
export async function bundleSource(bundle: Bundle) {
  const zip = await JSZip.loadAsync(await verifiedBundleBytes(bundle)),
    source = new JSZip();
  for (const f of bundle.data.files.filter((f) =>
    f.path.startsWith("source/"),
  )) {
    const entry = zip.file(f.path);
    if (!entry)
      throw new AppError("The preserved source file is missing.", 409);
    const bytes = await boundedEntry(entry, 20 * 1024 * 1024);
    if (sha256(bytes) !== f.sha256)
      throw new AppError("A preserved file failed its integrity check.", 409);
    source.file(f.path.slice(7), bytes);
  }
  return source.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
export async function removeStoredUpload(id: string, owner: string) {
  const r = await db()
    .prepare("SELECT object_name,size FROM uploads WHERE id=? AND owner=?")
    .get(id, owner);
  if (!r) return;
  if (r.object_name) await removeObject(String(r.object_name));
  const gone = await db()
    .prepare("DELETE FROM uploads WHERE id=? AND owner=? RETURNING size")
    .get(id, owner);
  if (gone) await release(owner, "storage", Number(gone.size));
}
export async function removeBundle(actor: string, id: string) {
  const b = await bundleAccess(id, actor, true);
  if (await activeBundleBuild(id))
    throw new AppError(
      "A build check is running. Wait for it to finish before removing this package.",
      409,
    );
  const active = await db()
    .prepare(
      "SELECT id FROM project_recreations WHERE bundle_id=? AND state NOT IN ('ready','failed','canceled')",
    )
    .get(id);
  if (active)
    throw new AppError(
      "A recreation is active. Verify its provider result before removing this package.",
      409,
    );
  await retireBundle(b);
  await cleanupRetiredBundles();
  await record(
    b.owner,
    "Removed preserved package bytes and revoked its download links",
    "preserve",
    b.project_id,
  );
}
async function activeBundleBuild(id: string) {
  return db()
    .prepare(
      "SELECT j.id FROM bundle_checks c JOIN jobs j ON j.id=('bundle-build:' || c.id) WHERE c.bundle_id=? AND c.state='queued' AND j.state='running' AND j.lease>? LIMIT 1",
    )
    .get(id, Date.now());
}
async function retireBundle(b: Bundle) {
  const pending = [b.upload_id];
  for (const r of await db()
    .prepare("SELECT data FROM bundle_checks WHERE bundle_id=?")
    .all(b.id)) {
    const d = JSON.parse(String(r.data));
    if (d.artifactId) pending.push(d.artifactId);
  }
  await transaction([
    {
      sql: "UPDATE package_links SET revoked=1 WHERE bundle_id=?",
      parameters: [b.id],
    },
    {
      sql: "UPDATE preservation_bundles SET deleted=1,upload_id=NULL,data=? WHERE id=?",
      parameters: [
        JSON.stringify({
          ...b.data,
          cleanupFiles: [...new Set(pending.filter(Boolean))],
        }),
        b.id,
      ],
    },
  ]);
}
async function cleanupRetiredBundles() {
  for (const row of await db()
    .prepare("SELECT id,owner,data FROM preservation_bundles WHERE deleted=1")
    .all()) {
    const data = JSON.parse(String(row.data));
    if (!Array.isArray(data.cleanupFiles) || !data.cleanupFiles.length)
      continue;
    for (const id of [...data.cleanupFiles]) {
      await removeStoredUpload(id, String(row.owner));
      data.cleanupFiles = data.cleanupFiles.filter((f: string) => f !== id);
      await db()
        .prepare("UPDATE preservation_bundles SET data=? WHERE id=?")
        .run(JSON.stringify(data), String(row.id));
    }
  }
}
export async function expireBundles() {
  const rows = await db()
    .prepare(
      "SELECT * FROM preservation_bundles WHERE deleted=0 AND expires>0 AND expires<?",
    )
    .all(Date.now());
  for (const row of rows) {
    if (await activeBundleBuild(String(row.id))) continue;
    if (
      await db()
        .prepare(
          "SELECT id FROM project_recreations WHERE bundle_id=? AND lease>? LIMIT 1",
        )
        .get(String(row.id), Date.now())
    )
      continue;
    await retireBundle({
      ...row,
      data: JSON.parse(String(row.data)),
    } as unknown as Bundle);
    await record(
      String(row.owner),
      "Package retention expired; download links revoked and file cleanup scheduled",
      "preserve",
      String(row.project_id),
    );
  }
  await cleanupRetiredBundles();
}
export async function inspectPreservationPackage(
  bytes: Buffer,
  secrets: string[] = [],
) {
  if (bytes.length > PACKAGE_LIMIT)
    throw new AppError("Preservation package exceeds 100 MB.", 413);
  const checked = await inspectZip(bytes, secrets, PACKAGE_LIMIT),
    zip = await JSZip.loadAsync(checked.source),
    entry = zip.file("manifest.json");
  if (!entry) throw new AppError("Preservation manifest is missing.");
  const text = (await boundedEntry(entry, 500000)).toString("utf8");
  if (handoverText(text, secrets) !== text)
    throw new AppError(
      "Preservation manifest contains possible private information.",
    );
  const parsed = JSON.parse(text) as BundleManifest;
  if (
    parsed.format !== "chapter-preservation-v1" ||
    !Array.isArray(parsed.files) ||
    parsed.files.length > 1010
  )
    throw new AppError("Invalid preservation manifest.");
  const allowed = new Set(["manifest.json", "PRESERVATION.md"]);
  let total = 0;
  for (const f of parsed.files) {
    if (!f.path?.startsWith("source/") && !f.path?.startsWith("screenshots/"))
      throw new AppError("Unexpected preservation file path.");
    if (
      allowed.has(f.path) ||
      f.path.split(/[\\/]/).some((p) => p === ".." || p.startsWith("."))
    )
      throw new AppError("Unsafe or duplicate preservation path.");
    allowed.add(f.path);
    const file = zip.file(f.path);
    if (!file) throw new AppError("Preserved file is missing.");
    const data = await boundedEntry(file, 20 * 1024 ** 2);
    if (
      (total += data.length) > 200 * 1024 ** 2 ||
      data.length !== f.size ||
      sha256(data) !== f.sha256
    )
      throw new AppError("Preserved file checksum failed.");
    if (f.path.startsWith("source/")) {
      if (
        !transferablePath(f.path.slice(7)) ||
        handoverText(data.toString("utf8"), secrets) !== data.toString("utf8")
      )
        throw new AppError("Preserved source violates its transfer policy.");
    } else screenshotType(data);
  }
  if (Object.values(zip.files).some((f) => !f.dir && !allowed.has(f.name)))
    throw new AppError("Unreviewed file in preservation package.");
  return bytes; // Preserve exact package bytes and their checksum; never silently rewrite an immutable bundle.
}
