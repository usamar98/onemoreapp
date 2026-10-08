import { NextResponse } from "next/server";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  db,
  requireUser,
  currentUser,
  saveProjectIfUnchanged,
  record,
  rateLimit,
  ownerRedact,
  accountSecrets,
  uploadBytes,
  storeUpload,
  tokenFor,
} from "./db";
import { AppError, safeUrl, hash } from "./security";
import { normalizeProject, type Project, type Expense } from "./types";
import { prepareHandover, handoverZip } from "./phase-two";
import { revivalCheck, sandboxAvailable } from "./revival";
import { hostingStatus, hostingPreview, changeHosting } from "./hosting";
import { handoverText } from "./phase-two";
import { projectAccess } from "./access";
import { notifyOwners } from "./notifications";

const json = (v: unknown, status = 200) =>
  NextResponse.json(v, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 100000)
    throw new AppError("This form is too large.", 413);
  try {
    return await request.json();
  } catch {
    throw new AppError("Check the form and try again.");
  }
}
async function publicProject(shareId: string) {
  const row = await db()
    .prepare("SELECT id,owner,data FROM projects WHERE share_id=?")
    .get(shareId);
  if (!row) throw new AppError("Project not found.", 404);
  const project = normalizeProject(JSON.parse(String(row.data)));
  if (!project.shared) throw new AppError("Project not found.", 404);
  return { project, owner: String(row.owner) };
}
export async function interestCounts(projectId: string) {
  const rows = await db()
    .prepare(
      "SELECT kind,count(*) AS count FROM interest WHERE project_id=? GROUP BY kind",
    )
    .all(projectId);
  return {
    visits: Number(rows.find((r) => r.kind === "visit")?.count || 0),
    signups: Number(rows.find((r) => r.kind === "signup")?.count || 0),
    enquiries: Number(rows.find((r) => r.kind === "enquiry")?.count || 0),
  };
}
const namesSchema = z
  .array(
    z
      .string()
      .regex(
        /^[A-Z][A-Z0-9_]{1,79}$/,
        "Enter environment-variable names only, such as DATABASE_URL. Never enter values.",
      ),
  )
  .max(100);
const pathsSchema = z.array(z.string().min(1).max(300)).max(500);
export async function phaseTwoRoute(
  request: Request,
  parts: string[],
): Promise<Response | null> {
  const [section, id, action] = parts,
    method = request.method;
  if (parts.length !== 3) return null;
  if (section === "public" && method === "POST") {
    const { project, owner } = await publicProject(id);
    const actor = await currentUser();
    if (action === "visit") {
      const input = z.object({ visitor: z.uuid() }).parse(await body(request));
      if (actor?.id === owner) return json({ ok: true });
      const day = new Date().toISOString().slice(0, 10),
        key = hash(`visit:${project.id}:${day}:${input.visitor}`);
      await rateLimit(
        `visit:${hash(request.headers.get("x-forwarded-for")?.split(",")[0] || "local")}`,
        120,
        60000,
      );
      await db()
        .prepare(
          "INSERT INTO interest(id,project_id,kind,email,message,at) VALUES(?,?,?,null,null,?) ON CONFLICT(id) DO NOTHING",
        )
        .run(key, project.id, "visit", new Date().toISOString());
      return json({ ok: true });
    }
    if (!["signup", "enquiry"].includes(action))
      throw new AppError("Not found.", 404);
    if (
      action === "signup" ? !project.waitlistEnabled : !project.enquiriesEnabled
    )
      throw new AppError(
        "The owner is not collecting this type of interest.",
        409,
      );
    const input = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((v) => v.trim().toLowerCase()),
        message: z.string().trim().max(2000).default(""),
        consent: z.literal(true, {
          error: "Please agree to share your details with the project owner.",
        }),
        website: z.string().max(200).default(""),
      })
      .parse(await body(request));
    if (input.website) return json({ ok: true });
    if (action === "enquiry" && !input.message)
      throw new AppError("Add an enquiry message.");
    await rateLimit(
      `interest:${hash(request.headers.get("x-forwarded-for")?.split(",")[0] || "local")}`,
      12,
      3600000,
    );
    await rateLimit(
      `interest-email:${hash(input.email)}:${project.id}`,
      5,
      3600000,
    );
    const eventId =
      action === "signup"
        ? hash(`signup:${project.id}:${input.email}`)
        : randomUUID();
    const saved = await db()
      .prepare(
        "INSERT INTO interest(id,project_id,kind,email,message,at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id",
      )
      .get(
        eventId,
        project.id,
        action,
        input.email,
        await ownerRedact(owner, input.message),
        new Date().toISOString(),
      );
    if (saved)
      await record(
        owner,
        `Received ${action === "signup" ? "a waitlist signup" : "an enquiry"} for ${project.name}`,
        "interest",
        project.id,
      );
    if (saved && action === "enquiry")
      await notifyOwners(
        owner,
        project.id,
        "enquiry",
        `${project.name} received a new enquiry. Review it in Interest.`,
        `enquiry:${eventId}`,
      );
    return json({ ok: true });
  }
  if (section === "handovers" && method === "GET") {
    const row = await db()
      .prepare("SELECT owner,data FROM projects WHERE id=?")
      .get(id);
    if (!row) throw new AppError("Package not found.", 404);
    const project = normalizeProject(JSON.parse(String(row.data)));
    if (
      !project.shared ||
      !project.handover?.shared ||
      action !== project.handover.shareToken
    )
      throw new AppError("Package not found.", 404);
    return packageDownload(project, String(row.owner));
  }
  const actions = [
    "task",
    "interest-settings",
    "interest",
    "revival",
    "environment-names",
    "hosting-status",
    "hosting-preview",
    "hosting-control",
    "expenses",
    "handover-preview",
    "handover-create",
    "handover-share",
    "handover-download",
    "history",
  ];
  if (section !== "projects" || !actions.includes(action)) return null;
  const actor = (await requireUser()).id;
  const control = [
    "interest-settings",
    "interest",
    "hosting-status",
    "hosting-preview",
    "hosting-control",
    "handover-preview",
    "handover-create",
    "handover-share",
  ].includes(action);
  const { owner, project, previousData } = await projectAccess(
    id,
    actor,
    control ? "control" : method === "GET" ? "read" : "edit",
  );
  const finish = async (text: string, kind: string) => {
    await saveProjectIfUnchanged(project, owner, previousData);
    await record(owner, text, kind, project.id);
    return json({ project });
  };
  if (action === "task" && method === "POST") {
    const input = z
      .object({
        nextTask: z.string().trim().max(4000),
        taskMinutes: z.number().int().min(1).max(10080).nullable(),
        blockers: z.string().max(4000),
        taskPriority: z.enum(["High", "Normal", "Low"]),
      })
      .parse(await body(request));
    project.nextTask = await ownerRedact(owner, input.nextTask);
    project.blockers = await ownerRedact(owner, input.blockers);
    project.taskMinutes = input.taskMinutes;
    project.taskPriority = input.taskPriority;
    return finish(`Updated the next task for ${project.name}`, "queue");
  }
  if (action === "interest-settings" && method === "POST") {
    const input = z
      .object({
        videoUrl: z.string().max(500),
        shareVideo: z.boolean(),
        waitlistEnabled: z.boolean(),
        enquiriesEnabled: z.boolean(),
      })
      .parse(await body(request));
    const video = safeUrl(input.videoUrl);
    if ((await ownerRedact(owner, video)) !== video)
      throw new AppError(
        "The video URL contains a possible secret. Use a public URL.",
      );
    Object.assign(project, input, { videoUrl: video });
    return finish(
      `Updated the public interest settings for ${project.name}`,
      "share",
    );
  }
  if (action === "interest" && method === "GET") {
    const rows = await db()
      .prepare(
        "SELECT id,kind,email,message,at FROM interest WHERE project_id=? AND kind<>? ORDER BY at DESC LIMIT 100",
      )
      .all(project.id, "visit");
    return json({
      counts: await interestCounts(project.id),
      contacts: rows.map((r) => ({
        id: String(r.id),
        kind: String(r.kind),
        email: String(r.email),
        message: String(r.message || ""),
        at: String(r.at),
      })),
    });
  }
  if (action === "interest" && method === "DELETE") {
    const input = z
      .object({ id: z.string().max(100) })
      .parse(await body(request));
    await db()
      .prepare("DELETE FROM interest WHERE id=? AND project_id=? AND kind<>?")
      .run(input.id, project.id, "visit");
    await record(
      owner,
      `Deleted an interest contact from ${project.name}`,
      "interest",
      project.id,
    );
    return json({ ok: true });
  }
  if (action === "environment-names" && method === "POST") {
    const { names } = z
      .object({ names: namesSchema })
      .parse(await body(request));
    project.requiredEnvNames = [...new Set(names)].sort();
    project.revival = null;
    return finish(
      `Updated required environment names for ${project.name}`,
      "check",
    );
  }
  if (action === "revival" && method === "GET")
    return json({
      report: project.revival,
      sandboxAvailable: sandboxAvailable(),
    });
  if (action === "revival" && method === "POST") {
    const { runBuild } = z
      .object({ runBuild: z.boolean().default(false) })
      .parse(await body(request));
    await rateLimit(`revival:${owner}`, 6, 60000);
    project.revival = await revivalCheck(project, owner, runBuild);
    return finish(`Checked readiness for ${project.name}`, "check");
  }
  const connection = {
    token: action.startsWith("hosting-") ? await tokenFor(owner, "vercel") : "",
    teamId: project.hostingTeamId || "",
  };
  if (action === "hosting-status" && method === "GET") {
    const state = await hostingStatus(connection, project);
    project.hostingPaused =
      typeof state.paused === "boolean" ? state.paused : null;
    project.hostingCheckedAt = new Date().toISOString();
    await saveProjectIfUnchanged(project, owner, previousData);
    return json({ project, name: state.name });
  }
  if (action === "hosting-preview" && method === "POST") {
    const { target } = z
      .object({ target: z.enum(["pause", "resume"]) })
      .parse(await body(request));
    return json({ preview: await hostingPreview(connection, project, target) });
  }
  if (action === "hosting-control" && method === "POST") {
    const input = z
      .object({
        target: z.enum(["pause", "resume"]),
        name: z.string().max(100),
        expires: z.number(),
        confirmation: z.string().max(100),
      })
      .parse(await body(request));
    await rateLimit(`hosting:${owner}`, 6, 60000);
    await changeHosting(connection, project, input);
    return finish(
      `${input.target === "pause" ? "Paused" : "Resumed"} ${project.name}'s Vercel production service; provider state verified`,
      "hosting",
    );
  }
  if (action === "expenses" && method === "POST") {
    const input = z
      .object({
        label: z.string().trim().min(1).max(80),
        category: z.enum(["Hosting", "Database", "Domain", "API", "Other"]),
        amount: z.number().min(0).max(1000000),
        currency: z.string().regex(/^[A-Z]{3}$/),
        interval: z.enum(["Monthly", "Yearly"]),
        continuesWhenParked: z.boolean(),
      })
      .parse(await body(request));
    if (project.expenses.length >= 50)
      throw new AppError("A project can have up to 50 recurring expenses.");
    project.expenses.push({
      ...input,
      id: randomUUID(),
      label: await ownerRedact(owner, input.label),
      origin: "Manual estimate",
    } satisfies Expense);
    return finish(`Recorded a recurring cost for ${project.name}`, "cost");
  }
  if (action === "expenses" && method === "DELETE") {
    const { id: expenseId } = z
      .object({ id: z.uuid() })
      .parse(await body(request));
    project.expenses = project.expenses.filter((e) => e.id !== expenseId);
    return finish(`Removed a recorded cost for ${project.name}`, "cost");
  }
  if (
    (action === "handover-preview" || action === "handover-create") &&
    method === "POST"
  ) {
    const input = z
      .object({
        paths: pathsSchema,
        reviewed: z.boolean().optional(),
        digest: z.string().max(100).optional(),
      })
      .parse(await body(request));
    const preview = await prepareHandover(
      project,
      project.sourceId ? await uploadBytes(project.sourceId, owner) : null,
      input.paths,
      await accountSecrets(owner),
    );
    if (action === "handover-preview") return json({ preview });
    if (!input.reviewed || input.digest !== preview.digest)
      throw new AppError(
        "Review the current manifest and each selected file, then confirm the package is free of secrets and customer data. Changes require a fresh review.",
        409,
      );
    const packageId = await storeUpload(
      owner,
      project.id,
      "handover.zip",
      "handover",
      "application/zip",
      await handoverZip(preview),
    );
    project.handover = {
      id: packageId,
      at: new Date().toISOString(),
      paths: input.paths,
      manifest: preview.manifest,
      digest: preview.digest,
      shared: false,
      shareToken: randomBytes(24).toString("hex"),
    };
    return finish(
      `Created a reviewed handover package for ${project.name}`,
      "handover",
    );
  }
  if (action === "handover-share" && method === "POST") {
    const { shared } = z
      .object({ shared: z.boolean() })
      .parse(await body(request));
    if (!project.handover)
      throw new AppError("Create and review a package first.", 409);
    if (shared && !project.shared)
      throw new AppError(
        "Enable the project share page first. Package downloads need a separate explicit opt-in.",
        409,
      );
    if (shared) await packageDownload(project, owner);
    project.handover.shared = shared;
    return finish(
      `${shared ? "Shared" : "Revoked sharing for"} ${project.name}'s handover package`,
      "handover",
    );
  }
  if (action === "handover-download" && method === "GET")
    return packageDownload(project, owner);
  if (action === "history" && method === "GET") {
    const rows = await db()
      .prepare(
        "SELECT id,text,kind,at FROM activity WHERE owner=? AND project_id=? ORDER BY at DESC LIMIT 100",
      )
      .all(owner, project.id);
    return json({
      activity: rows.map((r) => ({
        id: String(r.id),
        text: String(r.text),
        kind: String(r.kind),
        at: String(r.at),
      })),
    });
  }
  throw new AppError("Method not allowed.", 405);
}
async function packageDownload(project: Project, owner: string) {
  if (!project.handover)
    throw new AppError("Create a reviewed handover package first.", 404);
  const data = await uploadBytes(project.handover.id, owner),
    secrets = await accountSecrets(owner);
  // Recheck immutable contents against newly connected secrets before each download.
  const { default: JSZip } = await import("jszip"),
    zip = await JSZip.loadAsync(data);
  for (const f of Object.values(zip.files).filter((f) => !f.dir)) {
    const text = await f.async("string");
    if (handoverText(text, secrets) !== text)
      throw new AppError(
        "The package failed its current privacy check. Recreate and review it before sharing.",
        409,
      );
  }
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="chapter-handover.zip"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
