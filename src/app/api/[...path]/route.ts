import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  db,
  currentUser,
  requireUser,
  createSession,
  getProjects,
  getProject,
  saveProject,
  insertProject,
  newProject,
  record,
  activities,
  integrations,
  saveToken,
  tokenFor,
  ownerRedact,
  storeUpload,
  rateLimit,
  accountSecrets,
  uploadBytes,
  reorderProjects,
} from "@/lib/db";
import { cloudMode } from "@/lib/database";
import {
  privateStorage,
  readObject,
  removeObject,
  objectUrl,
} from "@/lib/storage";
import {
  vercelRequest,
  deployStaticBuild,
  applyDeployment,
  type VercelDeployment,
} from "@/lib/vercel";
import {
  AppError,
  checkOrigin,
  hash,
  passwordHash,
  passwordMatches,
  safeUrl,
  githubSlug,
} from "@/lib/security";
import { MAX_UPLOAD, inspectZip, screenshotType } from "@/lib/uploads";
import { demoProjects, previewWorkspace } from "@/lib/demo";
import { githubInfo, githubArchive } from "@/lib/integrations";
import { notesBrief, aiBrief } from "@/lib/brief";
import { phaseTwoRoute } from "@/lib/phase-two-api";
import { phaseThreeRoute, workspaceData } from "@/lib/phase-three-api";
import { phaseFourRoute } from "@/lib/phase-four-api";
import { phaseFiveRoute, developerRoute } from "@/lib/phase-five-api";
import { trackOutcome } from "@/lib/product-tracking";
import { connectionResult } from "@/lib/connections";
import { workspaceAdmin } from "@/lib/access";
import { discardNewProject } from "@/lib/import-cleanup";
import { projectAccess, workspaceRole } from "@/lib/access";
import { actorContext } from "@/lib/versions";
import { recordContext } from "@/lib/request-context";
import { consume, release } from "@/lib/billing";
import { enqueue, runJob, runPending } from "@/lib/jobs";
import { notifyOwners } from "@/lib/notifications";
import { after } from "next/server";
import { statuses, type Project, type Memory, type User } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).default(""),
  status: z.enum(statuses).default("Idea"),
  repository: z.string().max(500).default(""),
  demoUrl: z.string().max(500).default(""),
  tags: z.array(z.string().max(30)).max(6).default([]),
  color: z
    .enum(["mint", "violet", "sand", "blue", "peach", "pink"])
    .default("mint"),
});
const memorySchema = z.object({
  version: z.string().max(200),
  setup: z.string().max(8000),
  completed: z.string().max(8000),
  issues: z.string().max(8000),
  reason: z.string().max(4000),
  nextTask: z
    .string()
    .trim()
    .min(1, "Add a next task so you know where to resume.")
    .max(4000),
  returnDate: z
    .string()
    .refine(
      (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v),
      "Use a valid return date.",
    ),
});
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
async function body(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new AppError("Invalid request. Please try again.");
  }
}
async function safeProjectInput(
  owner: string,
  input: z.infer<typeof projectSchema>,
) {
  const repository = safeUrl(input.repository);
  if (repository) githubSlug(repository);
  return {
    ...input,
    name: await ownerRedact(owner, input.name),
    description: await ownerRedact(owner, input.description),
    tags: await Promise.all(input.tags.map((t) => ownerRedact(owner, t))),
    repository,
    demoUrl: safeUrl(input.demoUrl),
  };
}
async function attachArchive(
  owner: string,
  project: Project,
  name: string,
  buffer: Buffer,
) {
  const archive = await inspectZip(buffer, await accountSecrets(owner));
  project.referencedEnvNames = [
    ...new Set([...project.referencedEnvNames, ...archive.envNames]),
  ]
    .sort()
    .slice(0, 100);
  project.sourceId = await storeUpload(
    owner,
    project.id,
    name,
    "source",
    "application/zip",
    archive.source,
  );
  project.sourceName = name;
  project.revival = null;
  project.buildId = archive.build
    ? await storeUpload(
        owner,
        project.id,
        "web-build.zip",
        "build",
        "application/zip",
        archive.build,
      )
    : "";
  if (!project.repository)
    project.version = `sha256:${hash(archive.source.toString("base64")).slice(0, 16)}`;
  await saveProject(project, owner);
  return archive;
}
async function route(request: Request, parts: string[]) {
  const [section, id, action] = parts,
    method = request.method;
  if (section === "developer") return (await developerRoute(request, parts))!;
  if (method !== "GET" && !(section === "billing" && id === "webhook"))
    checkOrigin(request);
  const phaseFive = await phaseFiveRoute(request, parts);
  if (phaseFive) return phaseFive;
  const phaseFour = await phaseFourRoute(request, parts);
  if (phaseFour) return phaseFour;
  const phaseThree = await phaseThreeRoute(request, parts);
  if (phaseThree) return phaseThree;
  const phaseTwo = await phaseTwoRoute(request, parts);
  if (phaseTwo) return phaseTwo;
  if (section === "auth") {
    if (method !== "POST") throw new AppError("Method not allowed.", 405);
    if (id === "logout") {
      const jar = await cookies(),
        token = jar.get("chapter-session")?.value;
      if (token)
        await db()
          .prepare("DELETE FROM sessions WHERE token=?")
          .run(hash(token));
      jar.delete("chapter-session");
      return json({ ok: true });
    }
    const key = `auth:${request.headers.get("x-forwarded-for")?.split(",")[0] || "local"}`;
    await rateLimit(key, 30);
    if (id === "demo") {
      const owner = randomUUID();
      const user: User = {
        id: owner,
        name: "Alex Morgan",
        email: `${owner}@demo.chapter.local`,
        demo: true,
      };
      await db()
        .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
        .run(owner, user.name, user.email, await passwordHash(randomUUID()), 1);
      for (const sample of demoProjects)
        await insertProject(
          newProject({
            ...sample,
            id: randomUUID(),
            shareId: randomUUID().replaceAll("-", ""),
          }),
          owner,
        );
      await record(owner, "Started a personal demo workspace", "project");
      await createSession(user);
      return json({ user });
    }
    const input = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        password: z
          .string()
          .min(10, "Use at least 10 characters for your password.")
          .max(128),
        name: z.string().trim().min(1).max(60).optional(),
      })
      .parse(await body(request));
    await rateLimit(`email:${input.email}`, 15);
    if (id === "register") {
      if (!input.name) throw new AppError("Enter your name.");
      if (
        await db()
          .prepare("SELECT id FROM users WHERE email=?")
          .get(input.email)
      )
        throw new AppError(
          "This email is already registered. Sign in instead.",
          409,
        );
      const user = { id: randomUUID(), name: input.name, email: input.email };
      await db()
        .prepare("INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)")
        .run(
          user.id,
          user.name,
          user.email,
          await passwordHash(input.password),
        );
      await createSession(user);
      await record(user.id, "Created your Chapter workspace");
      return json({ user }, 201);
    }
    if (id === "login") {
      const row = await db()
        .prepare("SELECT * FROM users WHERE email=?")
        .get(input.email);
      const valid = row
        ? await passwordMatches(input.password, String(row.password))
        : (await passwordHash(input.password), false);
      if (!row || !valid)
        throw new AppError(
          "The email or password does not match. Please try again.",
          401,
        );
      const user = {
        id: String(row.id),
        name: String(row.name),
        email: String(row.email),
        demo: Boolean(row.demo),
      };
      await createSession(user);
      return json({ user });
    }
    throw new AppError("Not found.", 404);
  }
  if (section === "workspace" && method === "GET") {
    const user = await currentUser();
    return json(user ? await workspaceData(user) : previewWorkspace);
  }
  if (section === "files" && method === "GET") {
    const row = await db().prepare("SELECT * FROM uploads WHERE id=?").get(id);
    if (!row) throw new AppError("File not found.", 404);
    const user = await currentUser();
    let memberAccess = false;
    if (user) {
      try {
        await projectAccess(String(row.project_id), user.id);
        memberAccess = true;
      } catch {}
    }
    if (!memberAccess) {
      const projectRow = await db()
        .prepare("SELECT data FROM projects WHERE id=?")
        .get(row.project_id);
      const project: Project | null = projectRow
        ? JSON.parse(String(projectRow.data))
        : null;
      const allowed =
        project?.shared &&
        ((row.kind === "screenshot" &&
          project.shareScreenshots &&
          project.screenshotIds.includes(id)) ||
          (row.kind === "source" &&
            project.shareFiles &&
            project.sourceId === id));
      if (!allowed) throw new AppError("File not found.", 404);
    }
    if (row.kind === "source")
      await inspectZip(
        await uploadBytes(id, String(row.owner)),
        await accountSecrets(String(row.owner)),
      );
    const name = String(row.name).replace(/[^\w. -]/g, "_");
    if (row.object_name)
      return NextResponse.redirect(
        await objectUrl(
          String(row.object_name),
          row.kind === "screenshot" ? undefined : name,
        ),
        { status: 307, headers: { "Cache-Control": "private, no-store" } },
      );
    return new NextResponse(new Uint8Array(row.data as Uint8Array), {
      headers: {
        "Content-Type": String(row.type),
        "Content-Disposition": `${row.kind === "screenshot" ? "inline" : "attachment"}; filename="${name}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const user = await requireUser();
  let owner = user.id;
  if (section === "integrations") {
    owner = request.headers.get("x-chapter-workspace") || user.id;
    await workspaceAdmin(owner, user.id, true);
    if (!["github", "vercel"].includes(id))
      throw new AppError("Unsupported integration.");
    if (method === "DELETE") {
      await db()
        .prepare("DELETE FROM integrations WHERE owner=? AND provider=?")
        .run(owner, id);
      if (id === "vercel")
        await db()
          .prepare("DELETE FROM integrations WHERE owner=? AND provider=?")
          .run(owner, "vercel-team");
      await connectionResult(
        owner,
        id,
        "Disconnected. Reconnect to refresh metadata.",
      );
      return json({ integrations: await integrations(owner) });
    }
    if (method === "POST") {
      const { token, teamId } = z
        .object({
          token: z.string().trim().min(10).max(1000),
          teamId: z
            .string()
            .trim()
            .regex(
              /^(team_[a-zA-Z0-9]+)?$/,
              "Use a Vercel Team ID starting with team_, or leave it empty.",
            )
            .default(""),
        })
        .parse(await body(request));
      const endpoint =
        id === "github"
          ? "https://api.github.com/user"
          : "https://api.vercel.com/v2/user";
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "Chapter-project-workspace",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new AppError(
          `Could not connect ${id === "github" ? "GitHub" : "Vercel"}. Check that your token is valid and has the required access.`,
        );
      if (id === "vercel" && teamId)
        await vercelRequest(
          { token, teamId },
          `/v2/teams/${encodeURIComponent(teamId)}`,
        );
      await saveToken(owner, id, token);
      if (id === "vercel") await saveToken(owner, "vercel-team", teamId);
      await connectionResult(owner, id, "", true);
      await record(
        owner,
        `Connected ${id === "github" ? "GitHub" : "Vercel"}`,
        "integration",
      );
      return json({ integrations: await integrations(owner) });
    }
  }
  if (section !== "projects") throw new AppError("Not found.", 404);
  if (id === "reorder" && method === "POST") {
    const { ids } = z
      .object({ ids: z.array(z.string()).max(500) })
      .parse(await body(request));
    if (new Set(ids).size !== ids.length)
      throw new AppError("Queue entries must be unique.");
    await reorderProjects(ids, owner);
    return json({ projects: await getProjects(owner) });
  }
  if (!id && method === "POST") {
    owner = request.headers.get("x-chapter-workspace") || user.id;
    const access = await workspaceRole(owner, user.id);
    if (access.role === "Viewer" || access.scope)
      throw new AppError(
        "Creating a project requires full workspace Editor or Owner access.",
        403,
      );
    const input = await safeProjectInput(
      owner,
      projectSchema.parse(await body(request)),
    );
    if (input.status === "Parked")
      throw new AppError("Create the project first, then park it with memory.");
    const project = await insertProject(newProject(input), owner);
    await record(owner, `Added ${project.name}`, "project", project.id);
    return json({ project }, 201);
  }
  if (id === "import" && method === "POST") {
    owner = request.headers.get("x-chapter-workspace") || user.id;
    const access = await workspaceRole(owner, user.id);
    if (access.role === "Viewer" || access.scope)
      throw new AppError(
        "Importing requires full workspace Editor or Owner access.",
        403,
      );
    const { repository } = z
      .object({ repository: z.string().max(500) })
      .parse(await body(request));
    const info = await githubInfo(user.id, repository);
    const archive = await githubArchive(user.id, info.repository, info.version);
    // Validate before creating a project, so failed imports never leave an empty project behind.
    await inspectZip(archive, await accountSecrets(owner));
    const project = await insertProject(
      newProject({
        name: await ownerRedact(owner, info.name),
        description: await ownerRedact(owner, info.description),
        repository: info.repository,
        repoInfo: await ownerRedact(owner, info.repoInfo),
        version: info.version,
        status: "Building",
        tags: ["GitHub"],
      }),
      owner,
    );
    let report;
    try {
      report = await attachArchive(
        owner,
        project,
        `${info.name}-source.zip`,
        archive,
      );
    } catch (error) {
      await discardNewProject(project.id, owner);
      throw error;
    }
    await record(
      owner,
      `Imported ${project.name} from GitHub`,
      "import",
      project.id,
    );
    return json({ project, excluded: report.excluded }, 201);
  }
  const access = await projectAccess(
    id,
    user.id,
    ["share", "deploy", "deployment"].includes(action)
      ? "control"
      : method === "GET"
        ? "read"
        : "edit",
  );
  owner = access.owner;
  const project = access.project;
  if (action === "upload-token" && method === "POST") {
    const input = z
      .object({
        name: z.string().min(1).max(240),
        kind: z.enum(["source", "screenshot"]),
        size: z.number().int().positive().max(MAX_UPLOAD),
      })
      .parse(await body(request));
    if (input.kind === "screenshot" && input.size > 5 * 1024 * 1024)
      throw new AppError("Screenshots must be smaller than 5 MB.");
    if (!cloudMode()) return json({ local: true });
    await rateLimit(`upload:${owner}`, 30, 60000);
    const ticket = randomUUID(),
      objectName = `${owner}/${project.id}/staging/${ticket}`;
    await consume(owner, "storage", input.size);
    try {
      const { data, error } = await privateStorage().createSignedUploadUrl(
        objectName,
        { upsert: false },
      );
      if (error || !data)
        throw new AppError(
          "Could not prepare a private upload. Check cloud storage setup.",
          503,
        );
      await db()
        .prepare("INSERT INTO upload_tickets VALUES(?,?,?,?,?,?,?,?)")
        .run(
          ticket,
          owner,
          project.id,
          input.name,
          input.kind,
          objectName,
          input.size,
          Date.now() + 2 * 3600000,
        );
      return json({ local: false, ticket, signedUrl: data.signedUrl });
    } catch (error) {
      await release(owner, "storage", input.size);
      throw error;
    }
  }
  if (method === "PATCH" && !action) {
    const raw = await body(request);
    if (typeof raw.queued === "boolean" && Object.keys(raw).length === 1) {
      project.queued = raw.queued;
      await record(
        owner,
        `${raw.queued ? "Added" : "Removed"} ${project.name} ${raw.queued ? "to" : "from"} the priority queue`,
        "queue",
        project.id,
      );
    } else {
      const input = await safeProjectInput(owner, projectSchema.parse(raw));
      if (input.status === "Parked" && project.status !== "Parked")
        throw new AppError(
          "Use Park to save context before changing this status.",
        );
      Object.assign(project, input);
      project.revival = null;
      await record(
        owner,
        `Updated ${project.name} (${project.status})`,
        "project",
        project.id,
      );
    }
    return json({ project: await saveProject(project, owner) });
  }
  if (
    (action === "upload" || action === "upload-complete") &&
    method === "POST"
  ) {
    if (
      Number(request.headers.get("content-length") || 0) >
      MAX_UPLOAD + 2 * 1024 * 1024
    )
      throw new AppError("Uploads must be smaller than 20 MB.");
    let file: File, kind: string;
    if (action === "upload-complete") {
      if (!cloudMode())
        throw new AppError("Cloud uploads are not configured.", 409);
      const { ticket } = z
        .object({ ticket: z.uuid() })
        .parse(await body(request));
      const row = await db()
        .prepare(
          "DELETE FROM upload_tickets WHERE id=? AND owner=? AND project_id=? AND expires>? RETURNING *",
        )
        .get(ticket, owner, project.id, Date.now());
      if (!row)
        throw new AppError(
          "The upload expired or was already processed. Select the file and upload again.",
          404,
        );
      const objectName = String(row.object_name);
      try {
        const bytes = await readObject(objectName, Number(row.size));
        if (bytes.length !== Number(row.size))
          throw new AppError(
            "The uploaded file is incomplete. Please upload again.",
          );
        file = new File([new Uint8Array(bytes)], String(row.name));
        kind = String(row.kind);
      } finally {
        try {
          await removeObject(objectName);
        } finally {
          await release(owner, "storage", Number(row.size));
        }
      }
    } else {
      if (cloudMode())
        throw new AppError(
          "Use the direct private upload flow in the project editor.",
          409,
        );
      const form = await request.formData();
      const inputFile = form.get("file");
      if (!(inputFile instanceof File))
        throw new AppError("Select a file to upload.");
      file = inputFile;
      kind = String(form.get("kind"));
    }
    if (!(file instanceof File) || !file.size || file.size > MAX_UPLOAD)
      throw new AppError("Select a non-empty file smaller than 20 MB.");
    const data = Buffer.from(await file.arrayBuffer());
    if (kind === "screenshot") {
      if (file.size > 5 * 1024 * 1024)
        throw new AppError("Screenshots must be smaller than 5 MB.");
      if (project.screenshotIds.length >= 8)
        throw new AppError("A project can have up to eight screenshots.");
      const type = screenshotType(data);
      const fileId = await storeUpload(
        owner,
        project.id,
        file.name,
        "screenshot",
        type,
        data,
      );
      project.screenshotIds.push(fileId);
      await saveProject(project, owner);
      return json({ project });
    }
    if (kind !== "source" || !file.name.toLowerCase().endsWith(".zip"))
      throw new AppError("Upload a .zip file for source or a static build.");
    const report = await attachArchive(owner, project, file.name, data);
    await record(
      owner,
      `Uploaded ${project.name} ${report.build ? "with a deployable web build" : "source files"}`,
      "import",
      project.id,
    );
    return json({ project, excluded: report.excluded });
  }
  if (action === "screenshot" && method === "DELETE") {
    const { fileId } = z
      .object({ fileId: z.string() })
      .parse(await body(request));
    project.screenshotIds = project.screenshotIds.filter((s) => s !== fileId);
    return json({ project: await saveProject(project, owner) });
  }
  if (action === "share" && method === "POST") {
    const input = z
      .object({
        shared: z.boolean(),
        shareRepo: z.boolean(),
        shareFiles: z.boolean(),
        shareDemo: z.boolean(),
        shareScreenshots: z.boolean(),
      })
      .parse(await body(request));
    if (input.shared && input.shareFiles && project.sourceId)
      await inspectZip(
        await uploadBytes(project.sourceId, owner),
        await accountSecrets(owner),
      );
    Object.assign(project, input);
    await saveProject(project, owner);
    await record(
      owner,
      `${input.shared ? "Shared" : "Made private"} ${project.name}`,
      "share",
      project.id,
    );
    return json({ project });
  }
  if (action === "park" && method === "POST") {
    const input = memorySchema.parse(await body(request));
    const memory = Object.fromEntries(
      await Promise.all(
        Object.entries(input).map(async ([key, value]) => [
          key,
          await ownerRedact(owner, value),
        ]),
      ),
    ) as Memory;
    // Pin repository data to a real commit. Existing data remains available if GitHub is unavailable.
    if (project.repository) {
      try {
        const info = await githubInfo(owner, project.repository);
        const buffer = await githubArchive(
          owner,
          project.repository,
          info.version,
        );
        await attachArchive(
          owner,
          project,
          `${project.name}-parked-source.zip`,
          buffer,
        );
        project.version = info.version;
        project.repoInfo = await ownerRedact(owner, info.repoInfo);
      } catch {
        memory.issues +=
          "\nRepository snapshot could not be refreshed. The last recorded version is preserved.";
      }
    }
    Object.assign(memory, {
      version: memory.version || project.version,
      sourceId: project.sourceId,
      repository: project.repository,
      repoInfo: project.repoInfo,
      savedAt: new Date().toISOString(),
    });
    project.memory = memory;
    project.nextTask = memory.nextTask;
    project.revival = null;
    project.status = "Parked";
    project.brief = "";
    project.briefKind = "";
    await db()
      .prepare("INSERT INTO memories VALUES(?,?,?,?,?)")
      .run(
        randomUUID(),
        owner,
        project.id,
        JSON.stringify(memory),
        memory.savedAt!,
      );
    await saveProject(project, owner);
    await record(
      owner,
      `Parked ${project.name} with a note for next time`,
      "park",
      project.id,
    );
    return json({ project });
  }
  if (action === "brief" && method === "POST") {
    const { generateAI } = z
      .object({ generateAI: z.boolean().default(false) })
      .parse(await body(request));
    const savedNotes = await ownerRedact(owner, notesBrief(project));
    let brief = savedNotes,
      kind = "notes";
    if (generateAI) {
      if (!process.env.OPENAI_API_KEY)
        throw new AppError(
          "AI is not configured yet. A brief from your saved notes is available. See Integrations for setup.",
          503,
        );
      await consume(owner, "ai", 1);
      const output = await aiBrief(project, savedNotes);
      if (output) {
        brief = await ownerRedact(owner, output);
        kind = "ai";
      }
    }
    project.brief = brief;
    project.briefKind = kind;
    await saveProject(project, owner);
    return json({ project });
  }
  if (action === "resume" && method === "POST") {
    if (
      !project.revival ||
      project.revival.sourceId !== project.sourceId ||
      project.revival.version !== project.version ||
      Date.now() - Date.parse(project.revival.at) > 86400000
    )
      throw new AppError(
        "Run a current revival check and review its results before resuming. Needs Attention and Not Checked items can be addressed while building.",
        409,
      );
    const { brief } = z
      .object({ brief: z.string().max(24000) })
      .parse(await body(request));
    project.brief = await ownerRedact(owner, brief);
    project.status = "Building";
    await saveProject(project, owner);
    await record(owner, `Resumed ${project.name}`, "resume", project.id);
    return json({ project });
  }
  if (action === "save-brief" && method === "POST") {
    const { brief } = z
      .object({ brief: z.string().max(24000) })
      .parse(await body(request));
    project.brief = await ownerRedact(owner, brief);
    return json({ project: await saveProject(project, owner) });
  }
  if (action === "deploy" && method === "POST") {
    await rateLimit(`deploy:${owner}`, 3, 60000);
    if (!project.buildId)
      throw new AppError(
        "This project has source files but no deployable build. Upload a ZIP with a static index.html or a dist, build, or out folder. Server apps need their own build pipeline.",
        409,
      );
    if (!(await integrations(owner)).vercel)
      throw new AppError(
        "Connect your Vercel account in Integrations first.",
        409,
      );
    const connection = {
      token: await tokenFor(owner, "vercel"),
      teamId: await tokenFor(owner, "vercel-team"),
    };
    const deployment = await deployStaticBuild(
      connection,
      project,
      await uploadBytes(project.buildId, owner),
    );
    if (
      project.hostingProvider !== "vercel" ||
      (project.hostingTeamId || "") !== connection.teamId
    )
      project.hostingProjectId = "";
    applyDeployment(project, deployment);
    project.hostingTeamId = connection.teamId;
    await saveProject(project, owner);
    await record(
      owner,
      `Submitted ${project.name} to Vercel`,
      "deploy",
      project.id,
    );
    const jobId = await enqueue(user.id, owner, "deployment", {
      projectId: project.id,
      deploymentId: project.deploymentId,
    });
    after(() => runJob(jobId));
    return json({ project });
  }
  if (action === "deployment" && method === "GET") {
    if (!project.deploymentId || project.hostingProvider !== "vercel")
      return json({ project });
    const deployment: VercelDeployment = await vercelRequest(
      {
        token: await tokenFor(owner, "vercel"),
        teamId: project.hostingTeamId || "",
      },
      `/v13/deployments/${encodeURIComponent(project.deploymentId)}`,
    );
    applyDeployment(project, deployment);
    if (
      ["error", "failed", "canceled"].includes(
        project.deploymentState.toLowerCase(),
      )
    )
      await notifyOwners(
        owner,
        project.id,
        "deployment",
        `${project.name}: deployment ${project.deploymentState}.`,
        `deployment:${project.deploymentId}`,
      );
    return json({ project: await saveProject(project, owner) });
  }
  throw new AppError("Method not allowed.", 405);
}
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const requestId = randomUUID();
  const started = Date.now();
  let actor: User | null = null;
  let parts: string[] = [];
  const previous = new Map<string, string>();
  const responseWithId = (response: Response) => {
    response.headers.set("X-Request-ID", requestId);
    if (response.status >= 500)
      console.error(
        JSON.stringify({
          event: "request_failed",
          requestId,
          method: request.method,
          status: response.status,
          durationMs: Date.now() - started,
        }),
      );
    return response;
  };
  try {
    parts = (await context.params).path;
    actor = parts[0] === "developer" ? null : await currentUser();
    const user = actor;
    const response = await actorContext.run(user?.id || "", () =>
      recordContext.run(previous, () => route(request, parts)),
    );
    if (user) await trackOutcome(user.id, request, parts, response, previous);
    if (
      user &&
      response.ok &&
      (parts[0] === "workspace" ||
        (request.method !== "GET" &&
          !["auth", "jobs", "reviews", "showcase", "support"].includes(
            parts[0],
          )))
    ) {
      after(async () => {
        try {
          await runPending(user.id, 90000);
        } catch {
          console.error(
            JSON.stringify({
              event: "worker_failed",
              requestId,
              detail: "Retry using the worker or Jobs controls.",
            }),
          );
        }
      });
    }
    return responseWithId(response);
  } catch (error) {
    if (actor)
      await trackOutcome(actor.id, request, parts, undefined, previous);
    if (error instanceof z.ZodError)
      return responseWithId(
        json(
          {
            error: error.issues[0]?.message || "Check the form and try again.",
            requestId,
          },
          400,
        ),
      );
    if (error instanceof AppError)
      return responseWithId(
        json({ error: error.message, requestId }, error.status),
      );
    if (error instanceof Error && error.message.startsWith("AI generation"))
      return responseWithId(json({ error: error.message, requestId }, 502));
    return responseWithId(
      json(
        {
          error:
            "Something went wrong. Your saved projects are safe. Please try again.",
          requestId,
        },
        500,
      ),
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
