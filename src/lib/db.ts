import { randomUUID, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  AppError,
  decrypt,
  encrypt,
  hash,
  redact,
  githubSlug,
} from "./security";
import type { Activity, Project, User } from "./types";
import { normalizeProject } from "./types";
import { db, cloudMode, transaction } from "./database";
import { writeObject, readObject, removeObject } from "./storage";
import { accessibleRows, projectAccess, ensureWorkspace } from "./access";
import { consume, release, usageStep } from "./billing";
import { commitProject, actorContext } from "./versions";
import { recordContext } from "./request-context";
export { db } from "./database";
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get("chapter-session")?.value;
  if (!token) return null;
  const row = await db()
    .prepare(
      "SELECT u.id,u.name,u.email,u.demo FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
    )
    .get(hash(token), Date.now());
  return row
    ? {
        id: String(row.id),
        name: String(row.name),
        email: String(row.email),
        demo: Boolean(row.demo),
      }
    : null;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user)
    throw new AppError("Sign in to save projects to your own workspace.", 401);
  return user;
}
export async function createSession(user: User) {
  const token = randomBytes(32).toString("hex");
  await db().prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  await db()
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(hash(token), user.id, Date.now() + 30 * 86400000);
  (await cookies()).set("chapter-session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      !!process.env.VERCEL ||
      process.env.COOKIE_SECURE === "true" ||
      !!process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://"),
    path: "/",
    maxAge: 30 * 86400,
  });
}
export async function rateLimit(key: string, limit = 15, windowMs = 900000) {
  const now = Date.now();
  const row = await db()
    .prepare(
      `INSERT INTO attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET
    count=CASE WHEN attempts.reset>? THEN attempts.count+1 ELSE 1 END,
    reset=CASE WHEN attempts.reset>? THEN attempts.reset ELSE excluded.reset END RETURNING count`,
    )
    .get(key, 1, now + windowMs, now, now);
  if (Number(row.count) > limit)
    throw new AppError(
      "Too many attempts. Please try again in a few minutes.",
      429,
    );
}
export async function getProjects(owner: string): Promise<Project[]> {
  const rows = await accessibleRows(owner);
  const workspaceOwners = [...new Set(rows.map((row) => String(row.owner)))];
  const counts = workspaceOwners.length
    ? await db()
        .prepare(
          "SELECT i.project_id,i.kind,count(*) AS count FROM interest i JOIN projects p ON p.id=i.project_id WHERE p.owner IN (" +
            workspaceOwners.map(() => "?").join(",") +
            ") GROUP BY i.project_id,i.kind",
        )
        .all(...workspaceOwners)
    : [];
  const byProject = new Map<string, Project["interest"]>();
  for (const r of counts) {
    const id = String(r.project_id);
    const interest = byProject.get(id) || {
      visits: 0,
      signups: 0,
      enquiries: 0,
    };
    if (r.kind === "visit") interest.visits = Number(r.count);
    if (r.kind === "signup") interest.signups = Number(r.count);
    if (r.kind === "enquiry") interest.enquiries = Number(r.count);
    byProject.set(id, interest);
  }
  return rows
    .map((row) => {
      const project = normalizeProject(JSON.parse(String(row.data)));
      project.workspaceOwner = String(row.owner);
      project.role =
        row.owner === owner ? "Owner" : (String(row.role) as Project["role"]);
      project.interest = byProject.get(project.id) || {
        visits: 0,
        signups: 0,
        enquiries: 0,
      };
      return project;
    })
    .sort((a, b) => a.priority - b.priority);
}
export async function getProject(id: string, owner: string): Promise<Project> {
  return (await projectAccess(id, owner)).project;
}
export async function saveProject(project: Project, owner: string) {
  const access = await projectAccess(project.id, owner);
  const previousData =
    recordContext.getStore()?.get(project.id) || access.previousData;
  const result = await commitProject(
    normalizeProject(JSON.parse(previousData)),
    project,
    access.owner,
    previousData,
  );
  recordContext.getStore()?.set(project.id, JSON.stringify(result));
  return result;
}
export async function saveProjectIfUnchanged(
  project: Project,
  owner: string,
  previousData: string,
) {
  return commitProject(
    normalizeProject(JSON.parse(previousData)),
    project,
    owner,
    previousData,
  );
}
export async function insertProject(project: Project, owner: string) {
  await ensureWorkspace(owner);
  const identity = project.repository
    ? `github:${githubSlug(project.repository).toLowerCase()}`
    : "";
  if (identity) {
    const rows = await db()
      .prepare("SELECT data FROM projects WHERE owner=?")
      .all(owner);
    if (
      rows.some((r) => {
        const p = JSON.parse(String(r.data));
        return (
          p.repository &&
          `github:${githubSlug(p.repository).toLowerCase()}` === identity
        );
      })
    )
      throw new AppError(
        "This repository is already in your workspace. Open its existing project instead.",
        409,
      );
  }
  await transaction([
    await usageStep(owner, "projects", 1),
    {
      sql: "INSERT INTO projects VALUES(?,?,?,?)",
      parameters: [project.id, owner, project.shareId, JSON.stringify(project)],
    },
    ...(identity
      ? [
          {
            sql: "INSERT INTO external_links VALUES(?,?,?)",
            parameters: [owner, identity, project.id],
          },
        ]
      : []),
  ]);
  return project;
}
export function newProject(input: Partial<Project>): Project {
  return normalizeProject({
    id: randomUUID(),
    name: "",
    description: "",
    status: "Idea",
    color: "mint",
    tags: [],
    repository: "",
    repoInfo: "",
    demoUrl: "",
    version: "",
    screenshotIds: [],
    sourceId: "",
    sourceName: "",
    buildId: "",
    priority: Date.now(),
    queued: false,
    shared: false,
    shareRepo: false,
    shareFiles: false,
    shareDemo: true,
    shareScreenshots: true,
    shareId: randomBytes(16).toString("hex"),
    memory: null,
    brief: "",
    briefKind: "",
    hostingProjectId: "",
    hostingProvider: "",
    hostingTeamId: "",
    deploymentId: "",
    deploymentState: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...input,
  } as Project);
}
export async function record(
  owner: string,
  text: string,
  kind = "project",
  projectId: string | null = null,
) {
  const actor = actorContext.getStore();
  if (actor && actor !== owner) {
    const user = await db()
      .prepare("SELECT name FROM users WHERE id=?")
      .get(actor);
    text = `${user?.name || "Collaborator"}: ${text}`;
  }
  await db()
    .prepare(
      "INSERT INTO activity(id,owner,text,kind,at,project_id) VALUES(?,?,?,?,?,?)",
    )
    .run(randomUUID(), owner, text, kind, new Date().toISOString(), projectId);
}
export async function activities(owner: string): Promise<Activity[]> {
  const ids = new Set(
    (await accessibleRows(owner)).map((r) => JSON.parse(String(r.data)).id),
  );
  return (
    await db()
      .prepare(
        "SELECT a.id,a.owner,a.text,a.kind,a.at,a.project_id FROM activity a WHERE a.owner=? OR a.owner IN (SELECT workspace_id FROM members WHERE user_id=?) ORDER BY a.at DESC LIMIT 200",
      )
      .all(owner, owner)
  )
    .filter((row) =>
      row.project_id ? ids.has(row.project_id) : row.owner === owner,
    )
    .map((row) => ({
      id: String(row.id),
      text: String(row.text),
      kind: String(row.kind),
      at: String(row.at),
      projectId: row.project_id ? String(row.project_id) : undefined,
    }));
}
export async function tokenFor(owner: string, provider: string) {
  const row = await db()
    .prepare("SELECT token FROM integrations WHERE owner=? AND provider=?")
    .get(owner, provider);
  return row ? decrypt(String(row.token)) : "";
}
export async function saveToken(
  owner: string,
  provider: string,
  token: string,
) {
  await db()
    .prepare(
      "INSERT INTO integrations VALUES(?,?,?) ON CONFLICT(owner,provider) DO UPDATE SET token=excluded.token",
    )
    .run(owner, provider, encrypt(token));
}
export async function accountSecrets(owner: string) {
  const actor = actorContext.getStore();
  return (
    await Promise.all(
      [...new Set([owner, actor].filter(Boolean) as string[])].flatMap((id) =>
        ["github", "vercel", "netlify"].map((p) => tokenFor(id, p)),
      ),
    )
  ).concat([
    process.env.OPENAI_API_KEY || "",
    process.env.SUPABASE_SECRET_KEY || "",
    process.env.DATABASE_URL || "",
    process.env.CHAPTER_ENCRYPTION_KEY || "",
    process.env.VERCEL_TOKEN || "",
    process.env.VERCEL_OIDC_TOKEN || "",
    process.env.STRIPE_SECRET_KEY || "",
    process.env.STRIPE_WEBHOOK_SECRET || "",
    process.env.CRON_SECRET || "",
  ]);
}
export async function ownerRedact(owner: string, value: string) {
  return redact(value, await accountSecrets(owner));
}
export async function integrations(owner: string) {
  return {
    github: !!(await tokenFor(owner, "github")),
    vercel: !!(await tokenFor(owner, "vercel")),
    ai: !!process.env.OPENAI_API_KEY,
  };
}
export async function storeUpload(
  owner: string,
  projectId: string | null,
  name: string,
  kind: string,
  type: string,
  data: Buffer,
) {
  const id = randomUUID();
  const objectName = cloudMode()
    ? `${owner}/${projectId || "feedback"}/${id}`
    : null;
  await consume(owner, "storage", data.length);
  try {
    if (objectName) await writeObject(objectName, data, type);
    await db()
      .prepare(
        "INSERT INTO uploads(id,owner,project_id,name,kind,type,data,object_name,size) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        owner,
        projectId,
        name,
        kind,
        type,
        objectName ? null : data,
        objectName,
        data.length,
      );
  } catch (error) {
    // A lost database response can follow a committed INSERT. Never delete its file.
    const saved = await db()
      .prepare("SELECT id FROM uploads WHERE id=? AND owner=?")
      .get(id, owner);
    if (saved) return id;
    await release(owner, "storage", data.length);
    if (objectName) {
      try {
        await removeObject(objectName);
      } catch {}
    }
    throw error;
  }
  return id;
}
export async function uploadBytes(id: string, owner: string) {
  const row = await db()
    .prepare("SELECT * FROM uploads WHERE id=? AND owner=?")
    .get(id, owner);
  if (!row) throw new AppError("The file is missing. Upload it again.", 404);
  return row.object_name
    ? readObject(
        String(row.object_name),
        Math.max(
          20 * 1024 * 1024,
          Math.min(Number(row.size) || 0, 100 * 1024 * 1024),
        ),
      )
    : Buffer.from(row.data as Uint8Array);
}
export async function reorderProjects(ids: string[], owner: string) {
  const access = await Promise.all(
    ids.map((id) => projectAccess(id, owner, "edit")),
  );
  const projects = await Promise.all(ids.map((id) => getProject(id, owner)));
  await transaction(
    projects.map((p, i) => {
      p.priority = i;
      p.updatedAt = new Date().toISOString();
      return {
        sql: "UPDATE projects SET data=? WHERE id=? AND owner=?",
        parameters: [JSON.stringify(p), p.id, access[i].owner],
      };
    }),
  );
  for (const p of projects)
    await record(
      access.find((a) => a.project.id === p.id)!.owner,
      `Reordered ${p.name} in the priority queue`,
      "queue",
      p.id,
    );
}
