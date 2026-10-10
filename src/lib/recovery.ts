import JSZip from "jszip";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { db, transaction, cloudMode } from "./database";
import {
  accessibleRows,
  projectAccess,
  workspaceRole,
  ensureWorkspace,
} from "./access";
import { accountSecrets, uploadBytes, newProject, record } from "./db";
import { AppError, hash, safeUrl } from "./security";
import {
  inspectZip,
  boundedEntry,
  screenshotType,
  MAX_UPLOAD,
} from "./uploads";
import { handoverText } from "./phase-two";
import { usageStep, release } from "./billing";
import { writeObject, readObject, removeObject } from "./storage";
import { statuses, type Project } from "./types";
import { progressSchema } from "./continuation";
import { inspectPreservationPackage } from "./preservation";
import { inspectPdf, quickPublishSchema } from "./quick-publish";
export const EXPORT_LIMIT = 18 * 1024 * 1024;
export async function recoveryTicket(actor: string, owner: string, id: string) {
  const access = await workspaceRole(owner, actor);
  if (access.role === "Viewer" || access.scope)
    throw new AppError(
      "Recovery uploads require full workspace Editor or Owner access.",
      403,
    );
  const ticket = await db()
    .prepare(
      "SELECT * FROM upload_tickets WHERE id=? AND owner=? AND project_id=? AND name=? AND kind='recovery' AND expires>?",
    )
    .get(id, owner, owner, actor, Date.now());
  if (!ticket)
    throw new AppError(
      "Recovery upload expired or belongs to another user. Upload the archive again.",
      404,
    );
  return ticket;
}
const checksum = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const instructions = `# Chapter portable backup, format chapter-export-v1

records.json holds project records, parking notes, task fields, comments, activity, stored versions, file metadata and configuration summaries. files/<upload-id> holds sanitized, immutable file bytes. Each file has a SHA-256 checksum. version references use original upload IDs, remapped on recovery.

Credentials, sessions, account passwords, integration tokens, billing identities, interest contact details, invitations and active public-link tokens are excluded. Source/build archives are checked again for secrets. This is a private export: uploaded files and notes may still contain confidential customer data. Keep it private.

External repositories, commit history, running deployments, domains, provider databases and third-party assets remain with their providers. This ZIP contains only files actually uploaded into Chapter. A repository URL is not a repository backup.

Recovery is additive. Review the archive then restore selected records into new independent private projects. Stored versions and available uploaded files are remapped. Sharing, review links, portfolio publication, automation, sync, team assignments and hosting connections stay OFF. Configuration summaries are retained for manual setup. No repository, live application, provider database, billing subscription or existing Chapter project is changed.

Private starters are exported as documentation but not automatically installed during recovery. Interest totals are exported without contact details and are not inserted as new interest events. Historical activity/comments are restored as archived text with actors removed. Keep an offline copy; a backup stored beside a database is not disaster recovery by itself.
`;
function safeTextTree(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return handoverText(value, secrets);
  if (Array.isArray(value)) return value.map((v) => safeTextTree(v, secrets));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            ![
              "shareId",
              "shareToken",
              "token",
              "password",
              "email",
              "object_name",
              "workspaceOwner",
              "role",
              "assigneeId",
              "actor",
              "owner",
            ].includes(k),
        )
        .map(([k, v]) => [k, safeTextTree(v, secrets)]),
    );
  return value;
}
export async function buildExport(
  actor: string,
  owner: string,
  projectIds: string[],
) {
  await workspaceRole(owner, actor);
  if (
    !projectIds.length ||
    projectIds.length > 100 ||
    new Set(projectIds).size !== projectIds.length
  )
    throw new AppError(
      "Select 1–100 authorized projects. Split large exports into smaller selections.",
    );
  const secrets = await accountSecrets(owner),
    zip = new JSZip(),
    records = [],
    files = [],
    warnings: string[] = [];
  let total = 0;
  for (const id of projectIds) {
    const access = await projectAccess(id, actor);
    if (access.owner !== owner)
      throw new AppError("Select projects from the chosen workspace.");
    const p = access.project;
    const uploads = await db()
      .prepare(
        "SELECT id,name,kind,type,size FROM uploads WHERE project_id=? AND owner=? ORDER BY id",
      )
      .all(id, owner);
    for (const u of uploads) {
      let bytes: Buffer = await uploadBytes(String(u.id), owner);
      if (u.kind === "preservation")
        bytes = await inspectPreservationPackage(bytes, secrets);
      else if (
        ["source", "build", "handover", "capture", "verified-build"].includes(
          String(u.kind),
        )
      )
        bytes = (await inspectZip(bytes, secrets)).source;
      else if (u.kind === "screenshot") screenshotType(bytes);
      else if (u.kind === "document") inspectPdf(bytes, secrets);
      else {
        warnings.push(`Unsupported stored file ${u.id} was excluded.`);
        continue;
      }
      total += bytes.length;
      if (total > 40 * 1024 * 1024)
        throw new AppError(
          "Expanded export exceeds 40 MB. Select fewer projects.",
          413,
        );
      zip.file(`files/${u.id}`, bytes);
      files.push({
        id: String(u.id),
        projectId: id,
        name: handoverText(String(u.name), secrets),
        kind: String(u.kind),
        type: String(u.type),
        bytes: bytes.length,
        sha256: checksum(bytes),
      });
    }
    const versions = (
      await db()
        .prepare(
          "SELECT id,kind,data,at FROM versions WHERE project_id=? ORDER BY at",
        )
        .all(id)
    ).map((v) => ({
      id: v.id,
      kind: v.kind,
      data: safeTextTree(JSON.parse(String(v.data)), secrets),
      at: v.at,
    }));
    const comments = await db()
      .prepare("SELECT text,at FROM comments WHERE project_id=? ORDER BY at")
      .all(id);
    const parkingRecords = (
      await db()
        .prepare(
          "SELECT id,data,created_at FROM memories WHERE project_id=? AND owner=? ORDER BY created_at",
        )
        .all(id, owner)
    ).map((m) => ({
      id: m.id,
      data: safeTextTree(JSON.parse(String(m.data)), secrets),
      at: m.created_at,
    }));
    const activity = await db()
      .prepare(
        "SELECT text,kind,at FROM activity WHERE project_id=? ORDER BY at",
      )
      .all(id);
    const interest = await db()
      .prepare(
        "SELECT kind,count(*) AS count FROM interest WHERE project_id=? GROUP BY kind",
      )
      .all(id);
    const rules = await db()
      .prepare(
        "SELECT kind,data,enabled FROM automation_rules WHERE project_id=?",
      )
      .all(id);
    const feedback = await db()
      .prepare(
        "SELECT f.text,f.decision,f.at,l.data AS snapshot FROM review_feedback f JOIN review_links l ON l.id=f.review_id WHERE l.project_id=?",
      )
      .all(id);
    const sessionHistory = (
      await db()
        .prepare(
          "SELECT state,data,at,finished_at FROM resume_sessions WHERE project_id=? ORDER BY at LIMIT 1000",
        )
        .all(id)
    ).map((r) => ({
      state: r.state,
      data: JSON.parse(String(r.data)),
      at: r.at,
      finishedAt: r.finished_at,
    }));
    const proposalHistory = (
      await db()
        .prepare(
          "SELECT kind,state,data,at FROM action_proposals WHERE project_id=? ORDER BY at LIMIT 1000",
        )
        .all(id)
    ).map((r) => {
      const d = JSON.parse(String(r.data));
      return { kind: r.kind, state: r.state, text: d.text || "", at: r.at };
    });
    const preservationRecords = (
      await db()
        .prepare(
          "SELECT id,upload_id,digest,data,at,expires FROM preservation_bundles WHERE project_id=? AND deleted=0",
        )
        .all(id)
    ).map((b) => ({
      id: String(b.id),
      uploadId: String(b.upload_id),
      digest: String(b.digest),
      data: JSON.parse(String(b.data)),
      at: String(b.at),
      expires: Number(b.expires),
    }));
    const preservationChecks = (
      await db()
        .prepare(
          "SELECT c.id,c.bundle_id,c.state,c.data,c.at FROM bundle_checks c JOIN preservation_bundles b ON b.id=c.bundle_id WHERE b.project_id=? AND b.deleted=0 AND c.state='completed'",
        )
        .all(id)
    ).map((c) => ({
      id: String(c.id),
      bundleId: String(c.bundle_id),
      data: JSON.parse(String(c.data)),
      at: String(c.at),
    }));
    const serviceRecords = await db()
      .prepare(
        "SELECT s.name,s.kind,s.data,d.origin,d.evidence,d.at FROM shared_services s JOIN service_dependencies d ON d.service_id=s.id WHERE d.project_id=?",
      )
      .all(id);
    records.push(
      safeTextTree(
        {
          project: {
            ...p,
            shared: false,
            shareFiles: false,
            shareRepo: false,
            shareDocuments: false,
            handover: null,
            syncEnabled: false,
          },
          versions,
          parkingRecords,
          sessionHistory,
          proposalHistory,
          preservationRecords,
          preservationChecks,
          serviceRecords,
          comments,
          activity,
          interest,
          automationConfiguration: rules,
          reviewFeedback: feedback.map((f) => ({
            text: f.text,
            decision: f.decision,
            at: f.at,
            reviewedRecord: JSON.parse(String(f.snapshot)).record,
          })),
        },
        secrets,
      ),
    );
    // Fail safely if permission was removed while files were being read.
    await projectAccess(id, actor);
  }
  const templates = (
    await db()
      .prepare(
        "SELECT name,data,at FROM templates WHERE owner=? AND workspace_id=?",
      )
      .all(actor, owner)
  ).map((t) => ({
    name: t.name,
    data: safeTextTree(JSON.parse(String(t.data)), secrets),
    at: t.at,
  }));
  const manifest = {
    format: "chapter-export-v1",
    exportedAt: new Date().toISOString(),
    projects: records,
    files,
    privateStarters: templates,
    warnings,
    externalAssets:
      "Repositories, deployment services, domains and external databases remain with their providers.",
    exclusions:
      "Credentials, authentication, contacts, billing and active sharing permissions.",
  };
  zip.file("records.json", JSON.stringify(manifest, null, 2));
  zip.file("README.md", instructions);
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  if (bytes.length > EXPORT_LIMIT)
    throw new AppError(
      "Compressed export exceeds 18 MB. Select fewer projects.",
      413,
    );
  return {
    bytes,
    manifest: {
      projectCount: records.length,
      fileCount: files.length,
      bytes: bytes.length,
      exportedAt: manifest.exportedAt,
      warnings,
    },
  };
}
export async function createBackup(
  actor: string,
  owner: string,
  ids: string[],
) {
  const { bytes, manifest } = await buildExport(actor, owner, ids),
    id = randomUUID(),
    object = cloudMode() ? `${owner}/backups/${id}` : null;
  try {
    if (object) await writeObject(object, bytes, "application/zip");
    await transaction([
      await usageStep(owner, "storage", bytes.length),
      {
        sql: "INSERT INTO backups VALUES(?,?,?,?,?,?,?,?,?)",
        parameters: [
          id,
          owner,
          actor,
          JSON.stringify(ids),
          JSON.stringify(manifest),
          object ? null : bytes,
          object,
          bytes.length,
          new Date().toISOString(),
        ],
      },
    ]);
  } catch (e) {
    if (object) {
      try {
        await removeObject(object);
      } catch {}
    }
    throw e;
  }
  for (const projectId of ids)
    await record(
      owner,
      "Created a private portable backup",
      "backup",
      projectId,
    );
  return { id, ...manifest };
}
export async function backupAccess(actor: string, id: string) {
  const row = await db()
    .prepare("SELECT * FROM backups WHERE id=? AND (actor=? OR owner=?)")
    .get(id, actor, actor);
  if (!row) throw new AppError("Backup not found.", 404);
  await workspaceRole(String(row.owner), actor);
  for (const p of JSON.parse(String(row.project_ids)) as string[])
    await projectAccess(p, actor);
  return row;
}
export async function backupBytes(actor: string, id: string) {
  const row = await backupAccess(actor, id);
  return row.object_name
    ? readObject(String(row.object_name), EXPORT_LIMIT)
    : Buffer.from(row.data as Uint8Array);
}
export async function removeBackup(actor: string, id: string) {
  const row = await backupAccess(actor, id);
  if (row.object_name) await removeObject(String(row.object_name));
  const gone = await db()
    .prepare("DELETE FROM backups WHERE id=? RETURNING id")
    .get(id);
  if (gone) await release(String(row.owner), "storage", Number(row.bytes));
}
const memorySchema = z.object({
  version: z.string().max(200),
  setup: z.string().max(8000),
  completed: z.string().max(8000),
  issues: z.string().max(8000),
  reason: z.string().max(4000),
  nextTask: z.string().max(4000),
  returnDate: z.string().max(20),
  savedAt: z.string().max(100).optional(),
  sourceId: z.string().max(100).optional(),
  repository: z.string().max(500).optional(),
  repoInfo: z.string().max(20000).optional(),
});
const projectSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(80),
  description: z.string().max(2000),
  status: z.enum(statuses),
  color: z.enum(["mint", "violet", "sand", "blue", "peach", "pink"]),
  tags: z.array(z.string().max(30)).max(6),
  repository: z.string().max(500),
  demoUrl: z.string().max(500),
  repoInfo: z.string().max(20000),
  version: z.string().max(200),
  screenshotIds: z.array(z.string().max(100)).max(10),
  documentIds: z.array(z.string().max(100)).max(8).default([]),
  quickPublish: quickPublishSchema.nullable().default(null),
  sourceId: z.string().max(100),
  sourceName: z.string().max(240),
  buildId: z.string().max(100),
  memory: memorySchema.nullable(),
  nextTask: z.string().max(4000),
  blockers: z.string().max(8000),
  documentation: z.string().max(40000).default(""),
  taskBreakdown: z.string().max(40000).default(""),
  progressUpdates: z.array(progressSchema).max(100).default([]),
  taskMinutes: z.number().min(0).max(100000).nullable(),
  taskPriority: z.enum(["High", "Normal", "Low"]),
  requiredEnvNames: z
    .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/))
    .max(100),
  referencedEnvNames: z
    .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/))
    .max(100),
  brief: z.string().max(40000),
  briefKind: z.string().max(100),
  expenses: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().max(80),
        category: z.enum(["Hosting", "Database", "Domain", "API", "Other"]),
        amount: z.number().min(0).max(1000000),
        currency: z.string().regex(/^[A-Z]{3}$/),
        interval: z.enum(["Monthly", "Yearly"]),
        continuesWhenParked: z.boolean(),
        origin: z.enum(["Manual estimate", "Connected billing"]),
      }),
    )
    .max(100),
  queued: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  videoUrl: z.string().max(500).default(""),
  setupChecklist: z.array(z.string().max(1000)).max(100).optional(),
});
const versionSchema = z.object({
  id: z.string().max(100),
  kind: z.enum(["notes", "brief", "package"]),
  data: z.record(z.string(), z.unknown()),
  at: z.string().max(100),
});
const archiveSchema = z.object({
  format: z.literal("chapter-export-v1"),
  exportedAt: z.string(),
  projects: z
    .array(
      z.object({
        project: projectSchema,
        versions: z.array(versionSchema).max(2000),
        sessionHistory: z
          .array(
            z.object({
              state: z.enum(["active", "completed", "canceled"]),
              data: z.object({
                task: z.string().max(4000),
                minutes: z.number().min(5).max(2880),
                completed: z.string().max(8000),
                issues: z.string().max(8000),
                nextTask: z.string().max(4000),
                context: z
                  .record(z.string(), z.unknown())
                  .refine((v) => JSON.stringify(v).length < 120000),
              }),
              at: z.string().max(100),
              finishedAt: z.string().max(100).nullable(),
            }),
          )
          .max(1000)
          .default([]),
        proposalHistory: z
          .array(
            z.object({
              kind: z.enum(["tasks", "documentation", "brief"]),
              state: z.string().max(40),
              text: z.string().max(40000),
              at: z.string().max(100),
            }),
          )
          .max(1000)
          .default([]),
        preservationRecords: z
          .array(
            z.object({
              id: z.string().max(100),
              uploadId: z.string().max(100),
              digest: z.string().regex(/^[a-f0-9]{64}$/),
              data: z
                .record(z.string(), z.unknown())
                .refine((d) => JSON.stringify(d).length < 500000),
              at: z.string().max(100),
              expires: z.number(),
            }),
          )
          .max(1000)
          .default([]),
        preservationChecks: z
          .array(
            z.object({
              id: z.string().max(100),
              bundleId: z.string().max(100),
              data: z
                .record(z.string(), z.unknown())
                .refine((d) => JSON.stringify(d).length < 500000),
              at: z.string().max(100),
            }),
          )
          .max(1000)
          .default([]),
        serviceRecords: z
          .array(
            z.object({
              name: z.string().max(100),
              kind: z.string().max(40),
              data: z.string().max(5000),
              origin: z.string().max(20),
              evidence: z.string().max(4000),
              at: z.string().max(100),
            }),
          )
          .max(1000)
          .default([]),
        parkingRecords: z
          .array(
            z.object({
              id: z.string().max(100),
              data: memorySchema,
              at: z.string().max(100),
            }),
          )
          .max(2000)
          .default([]),
        comments: z
          .array(z.object({ text: z.string().max(4000), at: z.string() }))
          .max(2000),
        activity: z
          .array(
            z.object({
              text: z.string().max(2000),
              kind: z.string(),
              at: z.string(),
            }),
          )
          .max(4000),
      }),
    )
    .min(1)
    .max(100),
  files: z
    .array(
      z.object({
        id: z.string().regex(/^[\w-]{1,100}$/),
        projectId: z.string().max(100),
        name: z.string().max(240),
        kind: z.enum([
          "source",
          "build",
          "handover",
          "screenshot",
          "capture",
          "preservation",
          "verified-build",
          "document",
        ]),
        type: z.string().max(80),
        bytes: z.number().int().min(0).max(MAX_UPLOAD),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(2000),
});
export async function readExport(bytes: Buffer, secrets: string[] = []) {
  if (bytes.length > EXPORT_LIMIT)
    throw new AppError("Recovery archive must be smaller than 18 MB.", 413);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new AppError("Invalid recovery ZIP.");
  }
  const metadata = zip.file("records.json");
  if (!metadata)
    throw new AppError(
      "This ZIP is not a Chapter export (records.json missing).",
    );
  let manifest: z.infer<typeof archiveSchema>;
  try {
    manifest = archiveSchema.parse(
      JSON.parse(
        (await boundedEntry(metadata, 5 * 1024 * 1024)).toString("utf8"),
      ),
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      "Unsupported or damaged Chapter records. Use a chapter-export-v1 archive.",
    );
  }
  if (
    new Set(manifest.projects.map((p) => p.project.id)).size !==
      manifest.projects.length ||
    new Set(manifest.files.map((f) => f.id)).size !== manifest.files.length
  )
    throw new AppError("Duplicate project or file identifiers in archive.");
  const fileData = new Map<string, Buffer>();
  let total = 0;
  for (const f of manifest.files) {
    if (!manifest.projects.some((p) => p.project.id === f.projectId))
      throw new AppError("A file references a missing project.");
    const entry = zip.file(`files/${f.id}`);
    if (!entry)
      throw new AppError(
        "A backed-up file is missing. Recovery was not started.",
      );
    let data = await boundedEntry(
      entry,
      Math.min(MAX_UPLOAD, 40 * 1024 * 1024 - total),
    );
    total += data.length;
    if (data.length !== f.bytes || checksum(data) !== f.sha256)
      throw new AppError("File checksum mismatch. Recovery was not started.");
    if (f.kind === "preservation") {
      await inspectPreservationPackage(data, secrets);
    } else if (f.kind === "screenshot") {
      f.type = screenshotType(data);
      if (data.length > 5 * 1024 * 1024)
        throw new AppError("Recovered screenshot exceeds 5 MB.");
    } else if (f.kind === "document") {
      f.type = inspectPdf(data, secrets);
    } else {
      data = (await inspectZip(data, secrets)).source;
      f.type = "application/zip";
    }
    fileData.set(f.id, data);
  }
  for (const p of manifest.projects) {
    const own = new Set(
      manifest.files
        .filter((f) => f.projectId === p.project.id)
        .map((f) => f.id),
    );
    for (const b of p.preservationRecords) {
      const file = manifest.files.find(
        (f) =>
          f.id === b.uploadId &&
          f.projectId === p.project.id &&
          f.kind === "preservation",
      );
      if (!file || checksum(fileData.get(file.id)!) !== b.data.packageSha256)
        throw new AppError(
          "Preservation bundle is missing or its package checksum changed.",
        );
    }
    for (const u of p.project.progressUpdates)
      if (u.fileId && !own.has(u.fileId))
        throw new AppError(
          "A captured file snapshot is missing from the export.",
        );
    if (
      [
        p.project.sourceId,
        p.project.buildId,
        ...p.project.screenshotIds,
        ...p.project.documentIds,
        p.project.quickPublish?.assetId,
      ]
        .filter(Boolean)
        .some((id) => !own.has(String(id)))
    )
      throw new AppError("A project references a missing uploaded file.");
    // Version contents must validate as the corresponding record shape, never arbitrary project properties.
    for (const m of p.parkingRecords)
      if (m.data.sourceId && !own.has(m.data.sourceId))
        throw new AppError(
          "A parking record is missing its uploaded source file.",
        );
    for (const v of p.versions) {
      if (v.kind === "notes")
        v.data = z
          .object({
            memory: memorySchema.nullable(),
            nextTask: z.string().max(4000),
            blockers: z.string().max(8000),
            documentation: z.string().max(40000).default(""),
            taskBreakdown: z.string().max(40000).default(""),
            progressUpdates: z.array(progressSchema).max(100).default([]),
            taskMinutes: z.number().nullable(),
            taskPriority: z.enum(["High", "Normal", "Low"]),
            requiredEnvNames: z
              .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/))
              .max(100),
          })
          .parse(v.data);
      if (v.kind === "notes") {
        for (const u of v.data.progressUpdates as z.infer<
          typeof progressSchema
        >[])
          if (u.fileId && !own.has(u.fileId))
            throw new AppError(
              "A historical captured file snapshot is missing.",
            );
        const memory = v.data.memory as { sourceId?: string } | null;
        if (memory?.sourceId && !own.has(memory.sourceId))
          throw new AppError(
            "A historical notes record is missing its uploaded source file.",
          );
      }
      if (v.kind === "brief")
        v.data = z
          .object({
            brief: z.string().max(40000),
            briefKind: z.string().max(100),
          })
          .parse(v.data);
      if (v.kind === "package")
        v.data = z
          .object({
            sourceId: z.string().max(100),
            sourceName: z.string().max(240),
            buildId: z.string().max(100),
            documentIds: z.array(z.string().max(100)).max(8).default([]),
            quickPublish: quickPublishSchema.nullable().default(null),
            version: z.string().max(200),
            referencedEnvNames: z
              .array(z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/))
              .max(100),
          })
          .parse(v.data);
      if (
        v.kind === "package" &&
        [
          v.data.sourceId,
          v.data.buildId,
          ...((v.data.documentIds as string[]) || []),
          (v.data.quickPublish as { assetId?: string } | null)?.assetId,
        ]
          .filter(Boolean)
          .some((id) => !own.has(String(id)))
      )
        throw new AppError(
          "A historical package is missing its uploaded file.",
        );
    }
  }
  return {
    manifest,
    fileData,
    digest: hash(bytes.toString("base64")),
    bytes: total,
  };
}
export async function recoveryPreview(
  actor: string,
  owner: string,
  bytes: Buffer,
) {
  const role = await workspaceRole(owner, actor);
  if (role.role === "Viewer" || role.scope)
    throw new AppError(
      "Recovery requires full workspace Editor or Owner access.",
      403,
    );
  const read = await readExport(bytes, await accountSecrets(owner));
  return {
    digest: read.digest,
    exportedAt: read.manifest.exportedAt,
    projects: read.manifest.projects.map((p) => ({
      id: p.project.id,
      name: p.project.name,
      status: p.project.status,
      notes: p.project.memory,
      nextTask: p.project.nextTask,
      versions: p.versions.length,
      files: read.manifest.files.filter((f) => f.projectId === p.project.id)
        .length,
    })),
    fileBytes: read.bytes,
    effect:
      "Create new private independent projects. External hosting, repositories, databases, billing and existing projects are unchanged.",
  };
}
export async function restoreExport(
  actor: string,
  owner: string,
  bytes: Buffer,
  digest: string,
  selection: string[],
) {
  const role = await workspaceRole(owner, actor);
  if (role.role === "Viewer" || role.scope)
    throw new AppError(
      "Recovery requires full workspace Editor or Owner access.",
      403,
    );
  const secrets = await accountSecrets(owner),
    read = await readExport(bytes, secrets);
  if (read.digest !== digest)
    throw new AppError("Archive changed since preview. Review again.", 409);
  if (
    !selection.length ||
    new Set(selection).size !== selection.length ||
    selection.some(
      (id) => !read.manifest.projects.some((p) => p.project.id === id),
    )
  )
    throw new AppError("Choose projects from the recovery preview.");
  const runId = `recovery:${hash(`${owner}:${actor}:${digest}:${selection.slice().sort().join(",")}`)}`;
  const existing = await db()
    .prepare("SELECT result FROM recovery_runs WHERE id=?")
    .get(runId);
  if (existing) return JSON.parse(String(existing.result));
  await ensureWorkspace(owner);
  const chosen = read.manifest.projects.filter((p) =>
      selection.includes(p.project.id),
    ),
    fileMap = new Map<string, string>(),
    projectMap = new Map<string, string>(),
    steps = [],
    objects: string[] = [],
    restored: { id: string; name: string }[] = [];
  let total = 0;
  for (const p of chosen) projectMap.set(p.project.id, randomUUID());
  for (const f of read.manifest.files.filter((f) =>
    projectMap.has(f.projectId),
  ))
    fileMap.set(f.id, randomUUID());
  const mapReferences = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(mapReferences);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          ["sourceId", "buildId", "fileId", "assetId"].includes(k)
            ? fileMap.get(String(v)) || ""
            : ["screenshotIds", "documentIds"].includes(k)
              ? (v as string[]).map((id) => fileMap.get(id)).filter(Boolean)
              : mapReferences(v),
        ]),
      );
    return typeof value === "string" ? handoverText(value, secrets) : value;
  };
  const at = new Date().toISOString();
  for (const item of chosen) {
    const p = newProject(mapReferences(item.project) as Partial<Project>);
    p.id = projectMap.get(item.project.id)!;
    p.shareId = newProject({}).shareId;
    p.name = `${p.name.slice(0, 68)} · recovered`;
    p.repository = safeUrl(p.repository);
    p.demoUrl = safeUrl(p.demoUrl);
    p.videoUrl = safeUrl(p.videoUrl);
    p.createdAt = at;
    p.updatedAt = at;
    // An additive recovery never restores publication or grants provider control.
    p.shared = false;
    p.shareFiles = false;
    p.shareRepo = false;
    p.shareDemo = false;
    p.shareScreenshots = false;
    p.shareDocuments = false;
    p.sharedSourceId = "";
    p.sharedScreenshotIds = [];
    p.sharedDocumentIds = [];
    p.shareVideo = false;
    p.waitlistEnabled = false;
    p.enquiriesEnabled = false;
    p.hostingProjectId = "";
    p.hostingTeamId = "";
    p.hostingProvider = "";
    p.deploymentId = "";
    p.deploymentState = "";
    p.syncEnabled = false;
    p.revival = null;
    p.handover = null;
    p.assigneeId = "";
    p.expenses = p.expenses.map((e) => ({ ...e, origin: "Manual estimate" }));
    p.setupChecklist = [
      ...(p.setupChecklist || []),
      "Review recovered records and files before reconnecting providers or publishing.",
    ];
    steps.push({
      sql: "INSERT INTO projects VALUES(?,?,?,?)",
      parameters: [p.id, owner, p.shareId, JSON.stringify(p)],
    });
    for (const v of item.versions)
      steps.push({
        sql: "INSERT INTO versions VALUES(?,?,?,?,?,?)",
        parameters: [
          randomUUID(),
          p.id,
          actor,
          v.kind,
          JSON.stringify(mapReferences(v.data)),
          v.at,
        ],
      });
    for (const m of item.parkingRecords)
      steps.push({
        sql: "INSERT INTO memories VALUES(?,?,?,?,?)",
        parameters: [
          randomUUID(),
          owner,
          p.id,
          JSON.stringify(mapReferences(m.data)),
          m.at,
        ],
      });
    for (const s of item.sessionHistory)
      steps.push({
        sql: "INSERT INTO resume_sessions VALUES(?,?,?,?,?,?,?)",
        parameters: [
          randomUUID(),
          p.id,
          actor,
          s.state === "active" ? "canceled" : s.state,
          JSON.stringify(mapReferences(s.data)),
          s.at,
          s.finishedAt || at,
        ],
      });
    for (const proposal of item.proposalHistory)
      steps.push({
        sql: "INSERT INTO action_proposals VALUES(?,?,?,?,?,?,?)",
        parameters: [
          randomUUID(),
          p.id,
          actor,
          proposal.kind,
          "archived",
          JSON.stringify({
            text: proposal.text,
            kind: "Recovered historical proposal",
            sources: [],
            missing: [],
            baseDigest: "",
          }),
          proposal.at,
        ],
      });
    const bundleMap = new Map<string, string>();
    for (const b of item.preservationRecords) {
      const id = randomUUID();
      bundleMap.set(b.id, id);
      steps.push({
        sql: "INSERT INTO preservation_bundles VALUES(?,?,?,?,?,?,?,?,0)",
        parameters: [
          id,
          p.id,
          owner,
          fileMap.get(b.uploadId)!,
          b.digest,
          JSON.stringify(b.data),
          b.at,
          0,
        ],
      });
    }
    for (const c of item.preservationChecks) {
      const bundleId = bundleMap.get(c.bundleId);
      if (!bundleId)
        throw new AppError("Build check references a missing bundle.");
      const data = mapReferences(c.data) as Record<string, unknown>;
      data.bundleId = bundleId;
      data.artifactId = fileMap.get(String(c.data.artifactId)) || "";
      data.buildVerified = false;
      data.functionalityVerified = false;
      data.result = {
        name: "Isolated build",
        status: "Not Checked",
        detail:
          "Recovered historical evidence from an unsigned export. Run a new isolated verification before recreating this package.",
        nextStep: "Verify Build for the recovered immutable package.",
      };
      delete data.jobId;
      steps.push({
        sql: "INSERT INTO bundle_checks VALUES(?,?,?,?,?,?)",
        parameters: [
          randomUUID(),
          bundleId,
          actor,
          "completed",
          JSON.stringify(data),
          c.at,
        ],
      });
    }
    for (const s of item.serviceRecords) {
      const id = randomUUID();
      steps.push(
        {
          sql: "INSERT INTO shared_services VALUES(?,?,?,?,?,?)",
          parameters: [
            id,
            owner,
            s.name,
            s.kind,
            JSON.stringify({
              notes: "Recovered relationship: " + s.evidence,
              provider: "",
              providerId: "",
              teamId: "",
            }),
            at,
          ],
        },
        {
          sql: "INSERT INTO service_dependencies VALUES(?,?,?,?,?)",
          parameters: [
            id,
            p.id,
            "Unknown",
            "Recovered documentation; provider relationship must be checked again.",
            at,
          ],
        },
      );
    }
    for (const c of item.comments)
      steps.push({
        sql: "INSERT INTO comments VALUES(?,?,?,?,?)",
        parameters: [
          randomUUID(),
          p.id,
          actor,
          `Recovered comment: ${handoverText(c.text, secrets)}`,
          c.at,
        ],
      });
    for (const a of item.activity)
      steps.push({
        sql: "INSERT INTO activity(id,owner,text,kind,at,project_id) VALUES(?,?,?,?,?,?)",
        parameters: [
          randomUUID(),
          owner,
          `Recovered history: ${handoverText(a.text, secrets)}`.slice(0, 2000),
          "recovered",
          a.at,
          p.id,
        ],
      });
    restored.push({ id: p.id, name: p.name });
  }
  try {
    for (const f of read.manifest.files.filter((f) =>
      projectMap.has(f.projectId),
    )) {
      const id = fileMap.get(f.id)!,
        p = projectMap.get(f.projectId)!,
        data = read.fileData.get(f.id)!,
        object = cloudMode() ? `${owner}/${p}/${id}` : null;
      total += data.length;
      if (object) {
        await writeObject(object, data, f.type);
        objects.push(object);
      }
      steps.push({
        sql: "INSERT INTO uploads(id,owner,project_id,name,kind,type,data,object_name,size) VALUES(?,?,?,?,?,?,?,?,?)",
        parameters: [
          id,
          owner,
          p,
          handoverText(f.name, secrets),
          f.kind,
          f.type,
          object ? null : data,
          object,
          data.length,
        ],
      });
    }
    // Projects precede files, and quota and idempotency commit in the same transaction.
    const result = {
      projects: restored,
      restoredFiles: fileMap.size,
      at,
      message:
        "Recovered private stored records. No external application changed.",
    };
    await transaction([
      await usageStep(owner, "projects", restored.length),
      await usageStep(owner, "storage", total),
      ...steps.filter(
        (step) =>
          !/^INSERT INTO (preservation_bundles|bundle_checks|shared_services|service_dependencies)\b/.test(
            step.sql,
          ),
      ),
      ...steps.filter((step) =>
        /^INSERT INTO (preservation_bundles|bundle_checks|shared_services|service_dependencies)\b/.test(
          step.sql,
        ),
      ),
      {
        sql: "INSERT INTO recovery_runs VALUES(?,?,?,?,?,?)",
        parameters: [runId, owner, actor, digest, JSON.stringify(result), at],
      },
    ]);
    return result;
  } catch (e) {
    for (const object of objects) {
      try {
        await removeObject(object);
      } catch {}
    }
    const done = await db()
      .prepare("SELECT result FROM recovery_runs WHERE id=?")
      .get(runId);
    if (done) return JSON.parse(String(done.result));
    throw e;
  }
}
export async function authorizedBackupList(actor: string, owner: string) {
  await workspaceRole(owner, actor);
  const ids = new Set(
    (await accessibleRows(actor)).map((p) => JSON.parse(String(p.data)).id),
  );
  return (
    await db()
      .prepare(
        "SELECT id,actor,project_ids,manifest,bytes,at FROM backups WHERE owner=? AND (actor=? OR owner=?) ORDER BY at DESC LIMIT 50",
      )
      .all(owner, actor, actor)
  )
    .filter((b) =>
      (JSON.parse(String(b.project_ids)) as string[]).every((id) =>
        ids.has(id),
      ),
    )
    .map((b) => ({
      id: b.id,
      bytes: b.bytes,
      at: b.at,
      ...JSON.parse(String(b.manifest)),
    }));
}
