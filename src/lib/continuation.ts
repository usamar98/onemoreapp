import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, cloudMode } from "./database";
import { projectAccess } from "./access";
import { accountSecrets, record, ownerRedact } from "./db";
import { versionSteps, actorContext } from "./versions";
import { AppError, hash } from "./security";
import { handoverText, transferablePath } from "./phase-two";
import { usageStep } from "./billing";
import { writeObject, removeObject } from "./storage";
import JSZip from "jszip";
import type { Project } from "./types";
import { metricStep } from "./product-insights";
export const progressSchema = z.object({
  id: z.string().max(100),
  at: z.string().max(100),
  notes: z.string().max(8000),
  commit: z.string().max(100),
  nextTask: z.string().max(4000),
  fileId: z.string().max(100),
  kind: z.enum(["capture", "session"]),
});
const now = () => new Date().toISOString();
export function projectDigest(data: string) {
  return hash(data);
}
function changedSteps(
  before: Project,
  p: Project,
  owner: string,
  previous: string,
) {
  p.updatedAt = now();
  delete p.role;
  delete p.workspaceOwner;
  delete p.interest;
  return {
    sql: "UPDATE projects SET data=? WHERE id=? AND owner=? AND data=? RETURNING id",
    parameters: [JSON.stringify(p), p.id, owner, previous],
    required:
      "Project notes changed. Reload the current context and review your changes again.",
  };
}
export async function resumeContext(actor: string, projectId: string) {
  const a = await projectAccess(projectId, actor);
  const sessions = await db()
    .prepare(
      "SELECT id,state,data,at,finished_at FROM resume_sessions WHERE project_id=? AND actor=? ORDER BY at DESC LIMIT 30",
    )
    .all(projectId, actor);
  return {
    project: a.project,
    digest: projectDigest(a.previousData),
    sessions: sessions.map((r) => ({ ...r, data: JSON.parse(String(r.data)) })),
    canEdit: a.role !== "Viewer",
  };
}
export async function startSession(
  actor: string,
  projectId: string,
  raw: unknown,
) {
  const input = z
    .object({
      id: z.uuid(),
      task: z.string().trim().min(1).max(4000),
      minutes: z.number().int().min(5).max(2880),
      digest: z.string().length(64),
      reviewed: z.literal(true),
    })
    .parse(raw);
  const a = await projectAccess(projectId, actor, "edit"),
    p = a.project;
  const existing = await db()
    .prepare("SELECT * FROM resume_sessions WHERE id=?")
    .get(input.id);
  if (existing) {
    if (existing.actor !== actor || existing.project_id !== projectId)
      throw new AppError("Session not found.", 404);
    const saved = JSON.parse(String(existing.data));
    if (
      saved.minutes !== input.minutes ||
      saved.task !== (await ownerRedact(a.owner, input.task))
    )
      throw new AppError(
        "This session ID was used for another task or time window. Use a new session ID.",
        409,
      );
    return { id: input.id, project: p, state: existing.state };
  }
  if (p.status === "Archived")
    throw new AppError(
      "Unarchive this project before starting a session.",
      409,
    );
  if (input.digest !== projectDigest(a.previousData))
    throw new AppError(
      "Project changed. Review the latest saved context.",
      409,
    );
  if (
    !p.revival ||
    p.revival.sourceId !== p.sourceId ||
    p.revival.version !== p.version ||
    Date.now() - Date.parse(p.revival.at) > 86400000
  )
    throw new AppError(
      "Run a current readiness check before starting a resume session.",
      409,
    );
  if (
    await db()
      .prepare(
        "SELECT id FROM resume_sessions WHERE project_id=? AND actor=? AND state='active'",
      )
      .get(projectId, actor)
  )
    throw new AppError(
      "You already have an active session here. Finish or cancel it first.",
      409,
    );
  const data = {
    task: await ownerRedact(a.owner, input.task),
    minutes: input.minutes,
    context: {
      purpose: p.description,
      memory: p.memory,
      blockers: p.blockers,
      setup: p.memory?.setup || "",
      brief: p.brief,
      readiness: p.revival,
    },
    completed: "",
    issues: "",
    nextTask: "",
  };
  const before = structuredClone(p);
  p.status = "Building";
  await transaction([
    changedSteps(before, p, a.owner, a.previousData),
    {
      sql: "INSERT INTO resume_sessions VALUES(?,?,?,?,?,?,null)",
      parameters: [
        input.id,
        projectId,
        actor,
        "active",
        JSON.stringify(data),
        now(),
      ],
    },
    ...(await versionSteps(before, p, a.owner)),
  ]);
  await record(
    a.owner,
    "Started a guided resume session for " + p.name,
    "resume",
    p.id,
  );
  return { id: input.id, project: p, state: "active" };
}
export async function completeSession(
  actor: string,
  projectId: string,
  id: string,
  raw: unknown,
) {
  const input = z
    .object({
      completed: z.string().max(8000),
      issues: z.string().max(8000),
      nextTask: z.string().trim().min(1).max(4000),
      digest: z.string().length(64),
      confirmed: z.literal(true),
    })
    .parse(raw);
  const a = await projectAccess(projectId, actor, "edit"),
    p = a.project;
  const r = await db()
    .prepare(
      "SELECT * FROM resume_sessions WHERE id=? AND project_id=? AND actor=?",
    )
    .get(id, projectId, actor);
  if (!r) throw new AppError("Session not found.", 404);
  if (r.state === "completed") return { project: p, id, state: "completed" };
  if (r.state !== "active")
    throw new AppError("This session was canceled.", 409);
  if (projectDigest(a.previousData) !== input.digest)
    throw new AppError(
      "Project notes changed. Reload and compare before confirming this session.",
      409,
    );
  const before = structuredClone(p),
    data = JSON.parse(String(r.data)),
    secrets = await accountSecrets(a.owner);
  const confirmed = {
    completed: handoverText(input.completed, secrets),
    issues: handoverText(input.issues, secrets),
    nextTask: handoverText(input.nextTask, secrets),
  };
  p.nextTask = confirmed.nextTask;
  p.blockers = confirmed.issues;
  const completed = [p.memory?.completed || "", confirmed.completed]
    .filter(Boolean)
    .join("\n");
  if (completed.length > 8000)
    throw new AppError(
      "Completed-features notes exceed 8,000 characters. Shorten your confirmed update.",
    );
  p.memory = {
    version: p.version,
    setup: "",
    reason: "",
    ...p.memory,
    ...confirmed,
    completed,
    savedAt: now(),
    returnDate: "",
  };
  p.progressUpdates = [
    ...(p.progressUpdates || []),
    {
      id,
      at: now(),
      notes: confirmed.completed,
      commit: "",
      nextTask: confirmed.nextTask,
      fileId: "",
      kind: "session" as const,
    },
  ].slice(-100);
  p.brief = "";
  p.briefKind = "";
  await transaction([
    changedSteps(before, p, a.owner, a.previousData),
    ...(await versionSteps(before, p, a.owner)),
    {
      sql: "UPDATE resume_sessions SET state='completed',data=?,finished_at=? WHERE id=? AND state='active' RETURNING id",
      parameters: [JSON.stringify({ ...data, ...confirmed }), now(), id],
      required: "This session changed. Reload its latest state.",
    },
    metricStep(
      actor,
      a.owner,
      p.id,
      "resume_session",
      "completed",
      "session:" + id,
    ),
  ]);
  await record(
    a.owner,
    "Completed a guided session for " + p.name + "; saved confirmed next step",
    "session",
    p.id,
  );
  return { project: p, id, state: "completed" };
}
export const captureSchema = z
  .object({
    id: z.uuid(),
    notes: z.string().max(8000).default(""),
    commit: z
      .string()
      .regex(/^(?:[a-fA-F0-9]{7,40})?$/)
      .default(""),
    nextTask: z.string().max(4000).optional(),
    blockers: z.string().max(8000).optional(),
    minutes: z.number().int().min(5).max(2880).optional(),
    files: z
      .array(
        z.object({ path: z.string().max(240), content: z.string().max(32768) }),
      )
      .max(30)
      .default([]),
  })
  .strict();
export async function captureProgress(
  actor: string,
  projectId: string,
  tokenId: string,
  raw: unknown,
  credential = "",
) {
  const input = captureSchema.parse(raw),
    a = await projectAccess(projectId, actor, "edit"),
    p = a.project;
  const token = await db()
    .prepare(
      "SELECT id FROM developer_tokens WHERE id=? AND actor=? AND project_id=? AND revoked=0 AND expires>?",
    )
    .get(tokenId, actor, projectId, Date.now());
  if (!token) throw new AppError("Capture token expired or revoked.", 401);
  const digest = hash(JSON.stringify(input)),
    existing = await db()
      .prepare("SELECT * FROM development_captures WHERE id=?")
      .get(input.id);
  if (existing) {
    if (existing.actor !== actor || existing.project_id !== projectId)
      throw new AppError("Capture not found.", 404);
    if (existing.digest !== digest)
      throw new AppError(
        "This capture ID was used for different content. Use a new ID.",
        409,
      );
    return { id: input.id, duplicate: true, project: p };
  }
  if (p.status === "Archived")
    throw new AppError("Unarchive the project before capturing updates.", 409);
  if (
    !input.notes.trim() &&
    !input.commit &&
    !input.files.length &&
    input.nextTask === undefined &&
    input.blockers === undefined
  )
    throw new AppError("Add notes, a commit, task changes or selected files.");
  const secrets = (await accountSecrets(a.owner)).concat(credential);
  const paths = new Set<string>(),
    zip = new JSZip();
  let bytes = 0;
  for (const f of input.files) {
    if (
      !transferablePath(f.path) ||
      handoverText(f.path, secrets) !== f.path ||
      f.path.includes("\\") ||
      f.path.split("/").some((s) => !s || s === ".." || s === ".") ||
      f.path.startsWith("/") ||
      f.path.includes(":") ||
      paths.has(f.path.toLowerCase())
    )
      throw new AppError(
        "Selected files contain a private, duplicate or unsafe path. Choose code and documentation only.",
      );
    if (
      f.content.includes("\0") ||
      handoverText(f.content, secrets) !== f.content
    )
      throw new AppError(
        "A selected file contains credentials or private contact data. Remove that content before capturing.",
      );
    bytes += Buffer.byteLength(f.content);
    if (bytes > 512 * 1024)
      throw new AppError(
        "Selected files exceed 512 KB. Capture a smaller selection.",
        413,
      );
    paths.add(f.path.toLowerCase());
    zip.file(f.path, f.content);
  }
  const before = structuredClone(p),
    at = now(),
    fileId = input.files.length ? randomUUID() : "";
  const archive = fileId
    ? await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
    : null;
  const object =
    archive && cloudMode() ? a.owner + "/" + p.id + "/" + fileId : null;
  const clean = (text: string) => handoverText(text, secrets);
  const update = {
    id: input.id,
    at,
    notes: clean(input.notes),
    commit: input.commit,
    nextTask: input.nextTask === undefined ? p.nextTask : clean(input.nextTask),
    fileId,
    kind: "capture" as const,
  };
  p.progressUpdates = [...(p.progressUpdates || []), update].slice(-100);
  if (input.notes.trim() && p.memory) {
    const setup = p.memory.setup;
    // Development notes are saved separately; no claim of completion is inferred.
    p.memory = { ...p.memory, setup, savedAt: at };
  }
  if (input.nextTask !== undefined) {
    p.nextTask = clean(input.nextTask);
    if (p.memory) p.memory.nextTask = p.nextTask;
  }
  if (input.blockers !== undefined) {
    p.blockers = clean(input.blockers);
    if (p.memory) p.memory.issues = p.blockers;
  }
  if (input.minutes !== undefined) p.taskMinutes = input.minutes;
  p.brief = "";
  p.briefKind = "";
  try {
    if (object) await writeObject(object, archive!, "application/zip");
    await transaction([
      {
        sql: "UPDATE developer_tokens SET last_used=? WHERE id=? AND revoked=0 AND expires>? RETURNING id",
        parameters: [at, tokenId, Date.now()],
        required: "Capture token was revoked. No update saved.",
      },
      changedSteps(before, p, a.owner, a.previousData),
      ...(await versionSteps(before, p, a.owner)),
      ...(archive
        ? [
            await usageStep(a.owner, "storage", archive.length),
            {
              sql: "INSERT INTO uploads(id,owner,project_id,name,kind,type,data,object_name,size) VALUES(?,?,?,?,?,?,?,?,?)",
              parameters: [
                fileId,
                a.owner,
                p.id,
                "capture-" + input.id + ".zip",
                "capture",
                "application/zip",
                object ? null : archive,
                object,
                archive.length,
              ],
            },
          ]
        : []),
      {
        sql: "INSERT INTO development_captures VALUES(?,?,?,?,?,?,?)",
        parameters: [
          input.id,
          p.id,
          actor,
          tokenId,
          digest,
          JSON.stringify(update),
          at,
        ],
      },
      metricStep(
        actor,
        a.owner,
        p.id,
        "capture",
        "completed",
        "capture:" + input.id,
      ),
    ]);
  } catch (e) {
    if (object) {
      try {
        await removeObject(object);
      } catch {}
    }
    throw e;
  }
  await actorContext.run(actor, () =>
    record(
      a.owner,
      "Captured development progress for " + p.name,
      "capture",
      p.id,
    ),
  );
  return { id: input.id, duplicate: false, project: p };
}
