import { randomBytes } from "node:crypto";
import { db } from "./database";
import { projectAccess } from "./access";
import { accountSecrets, uploadBytes } from "./db";
import { AppError, hash, safeUrl } from "./security";
import { handoverText } from "./phase-two";
import { inspectZip } from "./uploads";
import { storedRecords } from "./versions";
import { prepareHandover } from "./phase-two";
import JSZip from "jszip";
import type { Project } from "./types";
export type ReviewOptions = {
  versionId: string;
  demo: boolean;
  feedback: boolean;
  source: boolean;
  screenshots: boolean;
  notes: boolean;
  days: number;
};
export type ReviewSnapshot = {
  name: string;
  description: string;
  status: Project["status"];
  color: string;
  version: string;
  record: string;
  notes: string;
  brief: string;
  demoUrl: string;
  sourceId: string;
  sourcePaths: string[];
  sourceDigest: string;
  sourceFiles?: { path: string; content: string }[];
  screenshotIds: string[];
  feedback: boolean;
  digest: string;
  capturedAt: string;
};
export async function reviewPreview(
  actor: string,
  id: string,
  options: ReviewOptions,
): Promise<ReviewSnapshot> {
  const access = await projectAccess(id, actor, "control"),
    p = structuredClone(access.project),
    secrets = await accountSecrets(access.owner);
  let label = "Current stored records";
  if (options.versionId) {
    const v = await db()
      .prepare("SELECT * FROM versions WHERE id=? AND project_id=?")
      .get(options.versionId, id);
    if (!v || !["notes", "brief", "package"].includes(String(v.kind)))
      throw new AppError("Stored version not found.", 404);
    Object.assign(p, JSON.parse(String(v.data)));
    label = `${v.kind} record saved ${v.at}; project overview frozen at link creation`;
  }
  const text = (s: string) => handoverText(s, secrets);
  let sourceFiles: { path: string; content: string }[] = [];
  if (options.source && p.sourceId) {
    const source = await uploadBytes(p.sourceId, access.owner);
    const eligible = await prepareHandover(p, source, [], secrets);
    sourceFiles = (
      await prepareHandover(p, source, eligible.paths, secrets)
    ).files.map(({ path, content }) => ({ path, content }));
    if (!sourceFiles.length)
      throw new AppError(
        "No eligible source files to review. Source download remains private.",
      );
  }
  const base = {
    name: text(p.name),
    description: text(p.description),
    status: p.status,
    color: p.color,
    version: text(p.version || "Not recorded"),
    record: label,
    notes: options.notes
      ? text(JSON.stringify(storedRecords(p).notes, null, 2))
      : "",
    brief: options.notes ? text(p.brief) : "",
    demoUrl: options.demo ? safeUrl(text(p.demoUrl)) : "",
    sourceId: options.source ? p.sourceId : "",
    screenshotIds: options.screenshots ? p.screenshotIds : [],
    feedback: options.feedback,
  };
  const sourcePaths = sourceFiles.map((f) => f.path),
    sourceDigest = hash(JSON.stringify(sourceFiles));
  if (Buffer.byteLength(JSON.stringify(sourceFiles)) > 3.5 * 1024 * 1024)
    throw new AppError(
      "The source preview is too large. Use a selected-file handover instead.",
      413,
    );
  return {
    ...base,
    sourcePaths,
    sourceDigest,
    sourceFiles,
    capturedAt: new Date().toISOString(),
    digest: hash(
      JSON.stringify({
        ...base,
        sourceDigest,
        days: options.days,
        updatedAt: access.project.updatedAt,
      }),
    ),
  };
}
export async function activeReview(id: string) {
  const row = await db()
    .prepare(
      "SELECT * FROM review_links WHERE id=? AND revoked=0 AND expires>?",
    )
    .get(id, Date.now());
  if (!row)
    throw new AppError(
      "This review link has expired or was revoked. Ask the owner for a new link.",
      404,
    );
  return { row, snapshot: JSON.parse(String(row.data)) as ReviewSnapshot };
}
export async function reviewData(id: string) {
  const { row, snapshot } = await activeReview(id);
  const feedback = await db()
    .prepare(
      "SELECT id,name,text,decision,at FROM review_feedback WHERE review_id=? ORDER BY at",
    )
    .all(id);
  const lastDecision = feedback
    .slice()
    .reverse()
    .find((f) => f.decision !== "Comment");
  return {
    ...snapshot,
    sourceFiles: undefined,
    sourcePaths: undefined,
    sourceDigest: undefined,
    sourceId: undefined,
    screenshotIds: undefined,
    screenshotUrls: snapshot.screenshotIds.map(
      (file) => `/api/reviews/${id}/file/${file}`,
    ),
    sourceUrl: snapshot.sourceId
      ? `/api/reviews/${id}/file/${snapshot.sourceId}`
      : "",
    id,
    expires: row.expires,
    approval: lastDecision?.decision || "Pending",
    feedback: snapshot.feedback,
    comments: feedback,
  };
}
export async function reviewFile(id: string, fileId: string) {
  const { row, snapshot } = await activeReview(id);
  if (!(
    snapshot.sourceId === fileId || snapshot.screenshotIds.includes(fileId)
  ))
    throw new AppError("Download was not included in this review.", 404);
  const upload = await db()
    .prepare("SELECT * FROM uploads WHERE id=? AND project_id=? AND owner=?")
    .get(fileId, row.project_id, row.owner);
  if (
    !upload ||
    (fileId === snapshot.sourceId && upload.kind !== "source") ||
    (fileId !== snapshot.sourceId && upload.kind !== "screenshot")
  )
    throw new AppError("Reviewed file is unavailable.", 404);
  const bytes = await uploadBytes(fileId, String(row.owner));
  if (fileId === snapshot.sourceId) {
    const p = (await projectAccess(String(row.project_id), String(row.owner)))
      .project;
    const preview = await prepareHandover(
      p,
      bytes,
      snapshot.sourcePaths,
      await accountSecrets(String(row.owner)),
    );
    const files = preview.files.map(({ path, content }) => ({ path, content }));
    if (hash(JSON.stringify(files)) !== snapshot.sourceDigest)
      throw new AppError(
        "Reviewed source no longer passes its recorded privacy check. Ask for a new review.",
        409,
      );
    const zip = new JSZip();
    for (const f of files) zip.file(f.path, f.content);
    return {
      bytes: await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
      }),
      name: "reviewed-source.zip",
      type: "application/zip",
      inline: false,
    };
  }
  return {
    bytes,
    name: String(upload.name),
    type: String(upload.type),
    inline: true,
    objectName: upload.object_name ? String(upload.object_name) : null,
  };
}
export function newReviewId() {
  return randomBytes(24).toString("hex");
}
