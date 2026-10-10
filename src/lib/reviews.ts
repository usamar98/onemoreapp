import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db, transaction } from "./database";
import { projectAccess } from "./access";
import { accountSecrets, uploadBytes } from "./db";
import {
  AppError,
  hash,
  safeUrl,
  passwordHash,
  passwordMatches,
} from "./security";
import { issueEmailToken, validEmailToken } from "./account-security";
import { quickPreview, inspectPdf } from "./quick-publish";
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
  access?: "link" | "password" | "email";
  password?: string;
  recipientEmails?: string[];
  packagePreview?: boolean;
  documents?: boolean;
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
  access?: { mode: "link" | "password" | "email"; recipientEmails: string[] };
  htmlPreview?: string;
  documents?: { id: string; name: string; digest: string }[];
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
  const mode = options.access || "link";
  const recipients = [
    ...new Set(
      (options.recipientEmails || []).map((e) => e.trim().toLowerCase()),
    ),
  ].sort();
  if (
    mode === "password" &&
    (!options.password ||
      options.password.length < 10 ||
      options.password.length > 128)
  )
    throw new AppError(
      "Use a client preview password between 10 and 128 characters.",
    );
  if (mode === "email" && (!recipients.length || recipients.length > 20))
    throw new AppError("Choose between 1 and 20 recipient email addresses.");
  const htmlPreview =
    options.packagePreview &&
    p.quickPublish &&
    ["html", "zip"].includes(p.quickPublish.format)
      ? (await quickPreview(p, access.owner)).html || ""
      : "";
  if (options.packagePreview && !htmlPreview)
    throw new AppError(
      "This version has no supported Quick Publish static layout preview.",
    );
  const documents: { id: string; name: string; digest: string }[] = [];
  if (options.documents)
    for (const fileId of p.documentIds || []) {
      const row = await db()
        .prepare(
          "SELECT name FROM uploads WHERE id=? AND owner=? AND project_id=? AND kind='document'",
        )
        .get(fileId, access.owner, id);
      if (!row)
        throw new AppError(
          "A selected PDF is unavailable. Review this package again.",
          409,
        );
      const bytes = await uploadBytes(fileId, access.owner);
      inspectPdf(bytes, secrets);
      documents.push({
        id: fileId,
        name: text(String(row.name)),
        digest: hash(bytes.toString("base64")),
      });
    }
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
    access: { mode, recipientEmails: mode === "email" ? recipients : [] },
    htmlPreview,
    documents,
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
export function reviewCookie(id: string) {
  return "chapter-review-" + id;
}
export async function reviewGate(id: string) {
  await activeReview(id);
  const access = await db()
    .prepare("SELECT mode FROM review_access WHERE review_id=?")
    .get(id);
  return { mode: (access?.mode || "link") as "link" | "password" | "email" };
}
export async function authorizedReview(id: string, grant?: string | null) {
  const review = await activeReview(id);
  const access = await db()
    .prepare("SELECT mode FROM review_access WHERE review_id=?")
    .get(id);
  if (
    !access &&
    review.snapshot.access &&
    review.snapshot.access.mode !== "link"
  )
    throw new AppError(
      "This private preview’s access settings are unavailable. Ask the owner to create a new review after checking cloud setup.",
      503,
    );
  if (!access || access.mode === "link")
    return { ...review, reviewerEmail: "" };
  const credential =
    grant === undefined
      ? (await cookies()).get(reviewCookie(id))?.value
      : grant;
  const saved =
    credential && /^[a-f0-9]{64}$/.test(credential)
      ? await db()
          .prepare(
            "SELECT email FROM review_grants WHERE token=? AND review_id=? AND expires>?",
          )
          .get(hash(credential), id, Date.now())
      : null;
  if (!saved)
    throw new AppError(
      "Unlock this client preview before viewing its contents.",
      401,
    );
  return { ...review, reviewerEmail: String(saved.email) };
}
export async function grantReview(
  id: string,
  input: { password?: string; token?: string },
) {
  const { row } = await activeReview(id);
  const access = await db()
    .prepare("SELECT * FROM review_access WHERE review_id=?")
    .get(id);
  if (!access || access.mode === "link")
    throw new AppError("This preview does not require unlocking.");
  let email = "";
  const steps = [];
  if (access.mode === "password") {
    if (
      !input.password ||
      input.password.length > 128 ||
      !(await passwordMatches(input.password, String(access.password)))
    )
      throw new AppError("The preview password does not match.", 401);
  } else {
    const token = await validEmailToken(input.token || "", "review", id);
    email = String(token.email);
    if (!(JSON.parse(String(access.recipients)) as string[]).includes(email))
      throw new AppError("This recipient no longer has access.", 403);
    steps.push({
      sql: "UPDATE auth_tokens SET consumed=1 WHERE token=? AND consumed=0 AND expires>? RETURNING token",
      parameters: [token.token, Date.now()],
      required: "This access link was used or expired. Request a new one.",
    });
  }
  const grant = randomBytes(32).toString("hex"),
    expires = Math.min(Number(row.expires), Date.now() + 86400000);
  steps.push({
    sql: "INSERT INTO review_grants VALUES(?,?,?,?)",
    parameters: [hash(grant), id, email, expires],
  });
  await transaction(steps);
  return { grant, expires };
}
export async function requestReviewEmail(id: string, email: string) {
  await activeReview(id);
  const access = await db()
    .prepare("SELECT * FROM review_access WHERE review_id=? AND mode='email'")
    .get(id);
  if (!access) throw new AppError("This preview does not use email access.");
  if (
    !(JSON.parse(String(access.recipients)) as string[]).includes(
      email.toLowerCase(),
    )
  )
    return null;
  return issueEmailToken(null, email.toLowerCase(), "review", id);
}
export async function reviewAccessStep(id: string, options: ReviewOptions) {
  return {
    sql: "INSERT INTO review_access VALUES(?,?,?,?)",
    parameters: [
      id,
      options.access || "link",
      options.access === "password"
        ? await passwordHash(options.password!)
        : "",
      JSON.stringify(
        options.access === "email"
          ? [
              ...new Set(
                (options.recipientEmails || []).map((e) =>
                  e.toLowerCase().trim(),
                ),
              ),
            ].sort()
          : [],
      ),
    ],
  };
}
export async function reviewData(id: string, grant?: string | null) {
  const { row, snapshot, reviewerEmail } = await authorizedReview(id, grant);
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
    access: undefined,
    documents: undefined,
    documentUrls: (snapshot.documents || []).map((f) => ({
      name: f.name,
      url: `/api/reviews/${id}/file/${f.id}`,
    })),
    accessMode: snapshot.access?.mode || "link",
    reviewerVerified: !!reviewerEmail,
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
export async function reviewFile(
  id: string,
  fileId: string,
  grant?: string | null,
) {
  const { row, snapshot } = await authorizedReview(id, grant);
  const document = snapshot.documents?.find((f) => f.id === fileId);
  if (!(
    snapshot.sourceId === fileId ||
    snapshot.screenshotIds.includes(fileId) ||
    document
  ))
    throw new AppError("Download was not included in this review.", 404);
  const upload = await db()
    .prepare("SELECT * FROM uploads WHERE id=? AND project_id=? AND owner=?")
    .get(fileId, row.project_id, row.owner);
  if (
    !upload ||
    (fileId === snapshot.sourceId && upload.kind !== "source") ||
    (fileId !== snapshot.sourceId &&
      upload.kind !== (document ? "document" : "screenshot"))
  )
    throw new AppError("Reviewed file is unavailable.", 404);
  const bytes = await uploadBytes(fileId, String(row.owner));
  if (document) {
    inspectPdf(bytes, await accountSecrets(String(row.owner)));
    if (hash(bytes.toString("base64")) !== document.digest)
      throw new AppError(
        "The reviewed PDF changed. Ask for a new preview.",
        409,
      );
    return {
      bytes,
      name: document.name,
      type: "application/pdf",
      inline: false,
    };
  }
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
