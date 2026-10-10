import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, cloudMode } from "./database";
import { privateStorage, readObject, removeObject, objectUrl } from "./storage";
import { consume, release } from "./billing";
import {
  requireUser,
  currentUser,
  getProjects,
  tokenFor,
  record,
  rateLimit,
  ownerRedact,
  uploadBytes,
  accountSecrets,
} from "./db";
import { projectAccess, workspaceRole, workspaceAdmin } from "./access";
import { AppError, hash } from "./security";
import { discoverProjects, commitImport, connectionState } from "./connections";
import { enqueue, runJob, runPending } from "./jobs";
import {
  ruleKinds,
  rulePreview,
  queueRule,
  newRuleId,
  notesFingerprint,
} from "./automation";
import {
  reviewPreview,
  reviewData,
  activeReview,
  reviewFile,
  newReviewId,
} from "./reviews";
import {
  portfolioPreview,
  publishedPortfolio,
  portfolioFile,
} from "./public-portfolio";
import {
  createBackup,
  backupAccess,
  backupBytes,
  authorizedBackupList,
  removeBackup,
  recoveryPreview,
  restoreExport,
  EXPORT_LIMIT,
  recoveryTicket,
} from "./recovery";
import { notifyOwners } from "./notifications";
import { handoverText } from "./phase-two";
import { billingConfigured } from "./billing";
const json = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
async function body(request: Request) {
  const raw = await request.text();
  if (raw.length > 150000) throw new AppError("This form is too large.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("Invalid form. Refresh and retry.");
  }
}
function fileResponse(
  bytes: Buffer,
  name: string,
  type = "application/zip",
  inline = false,
) {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\w. -]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
const reviewOptions = z.object({
  versionId: z.string().max(100).default(""),
  demo: z.boolean().default(false),
  feedback: z.boolean().default(true),
  source: z.boolean().default(false),
  screenshots: z.boolean().default(true),
  notes: z.boolean().default(false),
  days: z.number().int().min(1).max(90).default(7),
});
const portfolioOptions = z.object({
  title: z.string().trim().min(1).max(100),
  intro: z.string().max(2000),
  accent: z.enum(["mint", "violet", "blue"]),
  projects: z
    .array(
      z.object({
        id: z.string().max(100),
        demo: z.boolean(),
        screenshots: z.boolean(),
        enquiries: z.boolean(),
      }),
    )
    .max(100),
});
async function archiveInput(request: Request, actor: string, owner: string) {
  if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    if (
      Number(request.headers.get("content-length") || 0) >
      EXPORT_LIMIT + 100000
    )
      throw new AppError("Recovery archive exceeds 18 MB.", 413);
    const form = await request.formData(),
      file = form.get("file");
    if (!(file instanceof File) || file.size > EXPORT_LIMIT)
      throw new AppError("Choose a Chapter export ZIP under 18 MB.");
    return {
      bytes: Buffer.from(await file.arrayBuffer()),
      digest: String(form.get("digest") || ""),
      selected: JSON.parse(String(form.get("selected") || "[]")),
      confirmed: form.get("confirmed") === "true",
    };
  }
  const input = z
    .object({
      backupId: z.string().default(""),
      ticket: z.string().default(""),
      digest: z.string().default(""),
      selected: z.array(z.string()).max(100).default([]),
      confirmed: z.boolean().default(false),
    })
    .parse(await body(request));
  if (input.ticket) {
    const ticket = await recoveryTicket(actor, owner, input.ticket);
    const bytes = await readObject(
      String(ticket.object_name),
      Math.min(EXPORT_LIMIT, Number(ticket.size)),
    );
    if (bytes.length !== Number(ticket.size))
      throw new AppError(
        "The recovery upload size changed. Upload the original archive again.",
        409,
      );
    return { ...input, bytes };
  }
  return { ...input, bytes: await backupBytes(actor, input.backupId) };
}
export async function phaseFourRoute(
  request: Request,
  parts: string[],
): Promise<Response | null> {
  const [section, id, action, fileId] = parts,
    method = request.method;
  if (section === "health" && method === "GET") {
    try {
      await db().prepare("SELECT id FROM workspaces LIMIT 1").all();
      await db().prepare("SELECT id FROM automation_rules LIMIT 1").all();
      return json({ status: "ok", at: new Date().toISOString() });
    } catch {
      return json(
        {
          status: "unavailable",
          message: "Chapter storage needs attention.",
          at: new Date().toISOString(),
        },
        503,
      );
    }
  }
  if (section === "reviews") {
    if (method === "GET" && !action)
      return json({ review: await reviewData(id) });
    if (method === "GET" && action === "file") {
      const f = await reviewFile(id, fileId);
      if ("objectName" in f && f.objectName)
        return NextResponse.redirect(await objectUrl(f.objectName), {
          headers: {
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      return fileResponse(f.bytes, f.name, f.type, f.inline);
    }
    if (method === "POST" && action === "feedback") {
      const { row, snapshot } = await activeReview(id);
      if (!snapshot.feedback)
        throw new AppError(
          "Feedback is disabled for this reviewed version.",
          403,
        );
      const input = z
        .object({
          name: z.string().trim().min(1).max(80),
          text: z.string().trim().max(2000).default(""),
          decision: z.enum(["Comment", "Approved", "Changes Requested"]),
          consent: z.literal(true),
          requestId: z.uuid(),
          website: z.string().max(200).default(""),
        })
        .parse(await body(request));
      if (input.website) return json({ ok: true });
      if (!input.text && input.decision === "Comment")
        throw new AppError("Add a comment or choose an approval decision.");
      await rateLimit(
        `review:${hash(request.headers.get("x-forwarded-for")?.split(",")[0] || "local")}`,
        20,
        3600000,
      );
      const saved = await db()
        .prepare(
          "INSERT INTO review_feedback VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id",
        )
        .get(
          `${id}:${input.requestId}`,
          id,
          handoverText(input.name, await accountSecrets(String(row.owner))),
          handoverText(input.text, await accountSecrets(String(row.owner))),
          input.decision,
          new Date().toISOString(),
        );
      if (saved)
        await record(
          String(row.owner),
          `Received ${input.decision.toLowerCase()} feedback on a frozen version of ${snapshot.name}`,
          "review",
          String(row.project_id),
        );
      return json({ ok: true });
    }
  }
  if (section === "showcase") {
    if (method === "GET" && !action) {
      const portfolio = await publishedPortfolio(id);
      if (!portfolio) throw new AppError("Portfolio is not published.", 404);
      return json({ portfolio });
    }
    if (method === "GET" && action === "file") {
      const row = await portfolioFile(id, fileId);
      if (row.object_name)
        return NextResponse.redirect(await objectUrl(String(row.object_name)), {
          headers: {
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
      return fileResponse(
        await uploadBytes(fileId, String(row.owner)),
        String(row.name),
        String(row.type),
        true,
      );
    }
    if (method === "POST" && action === "enquiry") {
      const portfolio = await publishedPortfolio(id);
      if (!portfolio) throw new AppError("Portfolio unavailable.", 404);
      const input = z
        .object({
          projectId: z.string(),
          email: z.email().max(254),
          message: z.string().trim().min(1).max(2000),
          consent: z.literal(true),
          requestId: z.uuid(),
          website: z.string().max(200).default(""),
        })
        .parse(await body(request));
      const p = portfolio.projects.find(
        (p) => p.id === input.projectId && p.enquiries,
      );
      if (!p)
        throw new AppError(
          "Enquiries are not enabled for this published project.",
          403,
        );
      if (input.website) return json({ ok: true });
      await rateLimit(
        `showcase:${hash(request.headers.get("x-forwarded-for")?.split(",")[0] || "local")}`,
        12,
        3600000,
      );
      const row = await db()
          .prepare("SELECT owner FROM projects WHERE id=?")
          .get(p.id),
        owner = String(row!.owner),
        eventId = `portfolio:${id}:${input.requestId}`;
      const inserted = await db()
        .prepare(
          "INSERT INTO interest VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id",
        )
        .get(
          eventId,
          p.id,
          "enquiry",
          input.email.trim().toLowerCase(),
          await ownerRedact(owner, input.message),
          new Date().toISOString(),
        );
      if (inserted) {
        await record(
          owner,
          `Received a portfolio enquiry for ${p.name}`,
          "interest",
          p.id,
        );
        await notifyOwners(
          owner,
          p.id,
          "enquiry",
          `${p.name} received a portfolio enquiry. Review Interest.`,
          eventId,
        );
      }
      return json({ ok: true });
    }
  }
  const projectActions = [
    "sync",
    "sync-settings",
    "review-preview",
    "review-create",
    "review-links",
    "review-revoke",
  ];
  if (
    ![
      "launch",
      "discovery",
      "automations",
      "showcase-settings",
      "recovery",
      "support",
    ].includes(section) &&
    !(section === "projects" && projectActions.includes(action))
  )
    return null;
  const user = await requireUser(),
    actor = user.id,
    owner = request.headers.get("x-chapter-workspace") || actor;
  await workspaceRole(owner, actor);
  if (section === "launch" && method === "GET") {
    const projects = (await getProjects(actor)).filter(
      (p) => p.workspaceOwner === owner,
    );
    return json({
      primary: owner === actor,
      connections: {
        github: {
          connected: !!(await tokenFor(owner, "github")),
          ...(await connectionState(owner, "github")),
        },
        vercel: {
          connected: !!(await tokenFor(owner, "vercel")),
          ...(await connectionState(owner, "vercel")),
        },
      },
      projects,
      setup: {
        ai: !!process.env.OPENAI_API_KEY,
        billing: billingConfigured(),
        worker: !!process.env.CRON_SECRET,
        cloud: !!(
          process.env.DATABASE_URL &&
          process.env.SUPABASE_URL &&
          process.env.SUPABASE_SECRET_KEY
        ),
        support: !!process.env.SUPPORT_EMAIL,
      },
      supportEmail: process.env.SUPPORT_EMAIL || "",
      at: new Date().toISOString(),
    });
  }
  if (section === "discovery") {
    await workspaceAdmin(owner, actor, true);
    await rateLimit(`discovery:${actor}`, 10, 60000);
    if (method === "POST" && !id)
      return json({ discovery: await discoverProjects(owner, actor) });
    if (method === "POST" && id === "import") {
      const input = z
        .object({
          batchId: z.string(),
          selections: z
            .array(
              z.object({
                key: z.string(),
                deploymentId: z.string().default(""),
              }),
            )
            .min(1)
            .max(50),
          confirmed: z.literal(true),
        })
        .parse(await body(request));
      return json({
        results: await commitImport(
          owner,
          actor,
          input.batchId,
          input.selections,
        ),
      });
    }
  }
  if (section === "projects") {
    const a = await projectAccess(id, actor, "control");
    if (action === "sync" && method === "POST") {
      await rateLimit(`sync:${actor}`, 15, 60000);
      const jobId = await enqueue(actor, a.owner, "sync", {
        projectId: id,
        scheduled: false,
      });
      after(() => runJob(jobId));
      return json({ jobId }, 202);
    }
    if (action === "sync-settings" && method === "POST") {
      const { enabled } = z
        .object({ enabled: z.boolean() })
        .parse(await body(request));
      a.project.syncEnabled = enabled;
      const { saveProjectIfUnchanged } = await import("./db");
      await saveProjectIfUnchanged(a.project, a.owner, a.previousData);
      await record(
        a.owner,
        `${enabled ? "Enabled" : "Disabled"} scheduled metadata sync for ${a.project.name}`,
        "integration",
        id,
      );
      return json({ ok: true });
    }
    if (
      ["review-preview", "review-create"].includes(action) &&
      method === "POST"
    ) {
      const input = await body(request),
        options = reviewOptions.parse(input),
        preview = await reviewPreview(actor, id, options);
      if (action === "review-preview") return json({ preview });
      if (input.confirmed !== true || input.digest !== preview.digest)
        throw new AppError(
          "Review the exact contents and permissions again before creating a link.",
          409,
        );
      const count = await db()
        .prepare(
          "SELECT count(*) AS n FROM review_links WHERE project_id=? AND revoked=0 AND expires>?",
        )
        .get(id, Date.now());
      if (Number(count?.n) >= 25)
        throw new AppError(
          "Revoke an unused review link before adding another (25 active links per project).",
        );
      delete preview.sourceFiles;
      const linkId = newReviewId();
      await db()
        .prepare("INSERT INTO review_links VALUES(?,?,?,?,?,?,?,?)")
        .run(
          linkId,
          id,
          a.owner,
          actor,
          JSON.stringify(preview),
          Date.now() + options.days * 86400000,
          0,
          new Date().toISOString(),
        );
      await record(
        a.owner,
        `Created an expiring review of ${a.project.name}; source ${preview.sourceId ? "enabled" : "private"}`,
        "review",
        id,
      );
      return json({ url: `/review/${linkId}`, id: linkId }, 201);
    }
    if (action === "review-links" && method === "GET") {
      const links = await db()
        .prepare(
          "SELECT id,data,expires,revoked,at FROM review_links WHERE project_id=? ORDER BY at DESC LIMIT 100",
        )
        .all(id);
      return json({
        links: await Promise.all(
          links.map(async (l) => ({
            ...l,
            data: JSON.parse(String(l.data)),
            comments: await db()
              .prepare(
                "SELECT name,text,decision,at FROM review_feedback WHERE review_id=? ORDER BY at",
              )
              .all(String(l.id)),
          })),
        ),
      });
    }
    if (action === "review-revoke" && method === "POST") {
      const input = z
        .object({ reviewId: z.string() })
        .parse(await body(request));
      await db()
        .prepare(
          "UPDATE review_links SET revoked=1 WHERE id=? AND project_id=?",
        )
        .run(input.reviewId, id);
      await record(
        a.owner,
        `Revoked a review link for ${a.project.name}`,
        "review",
        id,
      );
      return json({ ok: true });
    }
  }
  if (section === "automations") {
    if (method === "GET") {
      const rows = await db()
          .prepare(
            "SELECT * FROM automation_rules WHERE owner=? ORDER BY at DESC",
          )
          .all(owner),
        rules = [];
      for (const r of rows) {
        try {
          const a = await projectAccess(String(r.project_id), actor, "control");
          const runs = await db()
            .prepare(
              "SELECT r.id,r.state,r.detail,r.at,r.finished_at,j.error,j.attempts,j.state AS job_state FROM automation_runs r LEFT JOIN jobs j ON j.id=r.job_id WHERE r.rule_id=? ORDER BY r.at DESC LIMIT 15",
            )
            .all(String(r.id));
          rules.push({
            ...r,
            data: JSON.parse(String(r.data)),
            name: a.project.name,
            runs,
          });
        } catch {}
      }
      return json({ rules });
    }
    if (method === "POST" && ["preview", "create"].includes(id)) {
      const input = z
        .object({
          projectId: z.string(),
          kind: z.enum(ruleKinds),
          days: z.number().int().min(1).max(3650).default(30),
          confirmed: z.boolean().default(false),
          digest: z.string().default(""),
        })
        .parse(await body(request));
      const a = await projectAccess(input.projectId, actor, "control");
      if (a.owner !== owner)
        throw new AppError("Select a project in this workspace.");
      const preview = await rulePreview(a.project, input.kind, input.days),
        digest = hash(
          JSON.stringify({
            projectId: input.projectId,
            kind: input.kind,
            days: input.days,
            notes: notesFingerprint(a.project),
            detail: preview.detail,
          }),
        );
      if (id === "preview") return json({ preview, digest });
      if (!input.confirmed || input.digest !== digest)
        throw new AppError(
          "Preview the current rule and confirm its effect.",
          409,
        );
      const count = await db()
        .prepare("SELECT count(*) AS n FROM automation_rules WHERE owner=?")
        .get(owner);
      if (Number(count?.n) >= 100)
        throw new AppError(
          "Keep up to 100 workspace rules. Remove an unused rule first.",
        );
      const ruleId = newRuleId();
      await db()
        .prepare("INSERT INTO automation_rules VALUES(?,?,?,?,?,?,?,?)")
        .run(
          ruleId,
          owner,
          actor,
          input.projectId,
          input.kind,
          1,
          JSON.stringify({
            days: input.days,
            baseline: input.kind === "brief" ? notesFingerprint(a.project) : "",
          }),
          new Date().toISOString(),
        );
      await record(
        owner,
        `Enabled ${input.kind} automation for ${a.project.name}`,
        "automation",
        input.projectId,
      );
      return json({ id: ruleId }, 201);
    }
    const row = await db()
      .prepare("SELECT * FROM automation_rules WHERE id=? AND owner=?")
      .get(id, owner);
    if (!row) throw new AppError("Automation not found.", 404);
    await projectAccess(String(row.project_id), actor, "control");
    if (method === "PATCH") {
      const { enabled } = z
        .object({ enabled: z.boolean() })
        .parse(await body(request));
      await db()
        .prepare("UPDATE automation_rules SET enabled=? WHERE id=?")
        .run(enabled ? 1 : 0, id);
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await transaction([
        {
          sql: "DELETE FROM automation_runs WHERE rule_id=?",
          parameters: [id],
        },
        { sql: "DELETE FROM automation_rules WHERE id=?", parameters: [id] },
      ]);
      return json({ ok: true });
    }
    if (method === "POST" && action === "run") {
      const jobId = await queueRule(id);
      if (jobId) after(() => runJob(jobId));
      return json({
        jobId,
        message: jobId
          ? "Eligible event queued once."
          : "Rule is off or the saved trigger is not due.",
      });
    }
  }
  if (section === "showcase-settings") {
    await workspaceAdmin(owner, actor);
    if (method === "GET") {
      const row = await db()
        .prepare("SELECT * FROM public_portfolios WHERE owner=?")
        .get(owner);
      return json({
        portfolio: row
          ? {
              slug: row.slug,
              published: !!row.published,
              updatedAt: row.updated_at,
              ...JSON.parse(String(row.data)),
            }
          : null,
      });
    }
    if (method === "POST") {
      const input = await body(request),
        options = portfolioOptions.parse(input);
      if (
        new Set(options.projects.map((p) => p.id)).size !==
        options.projects.length
      )
        throw new AppError("Portfolio projects must be unique.");
      const preview = await portfolioPreview(owner, actor, options),
        digest = hash(JSON.stringify(preview));
      if (id === "preview") return json({ preview, digest });
      if (input.confirmed !== true || input.digest !== digest)
        throw new AppError(
          "Preview the current portfolio before publishing.",
          409,
        );
      const slug = z
          .string()
          .regex(
            /^[a-z0-9][a-z0-9-]{2,49}$/,
            "Use 3–50 lowercase letters, numbers or hyphens.",
          )
          .parse(input.slug),
        published = z.boolean().parse(input.published);
      const data = {
        ...options,
        title: preview.title,
        intro: preview.intro,
        projects: options.projects.map((p) => ({
          ...p,
          screenshotIds: preview.projects.find((entry) => entry.id === p.id)!
            .screenshotIds,
        })),
      };
      if (
        await db()
          .prepare(
            "SELECT owner FROM public_portfolios WHERE slug=? AND owner<>?",
          )
          .get(slug, owner)
      )
        throw new AppError(
          "That portfolio address is already taken. Choose another address and preview again.",
          409,
        );
      await db()
        .prepare(
          "INSERT INTO public_portfolios VALUES(?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET slug=excluded.slug,data=excluded.data,published=excluded.published,updated_at=excluded.updated_at",
        )
        .run(
          owner,
          slug,
          JSON.stringify(data),
          published ? 1 : 0,
          new Date().toISOString(),
        );
      for (const p of options.projects)
        await record(
          owner,
          `${published ? "Published" : "Saved private draft"} portfolio entry`,
          "share",
          p.id,
        );
      return json({ url: `/portfolio/${slug}`, published });
    }
    if (method === "DELETE") {
      await db()
        .prepare("UPDATE public_portfolios SET published=0 WHERE owner=?")
        .run(owner);
      return json({ ok: true });
    }
  }
  if (section === "recovery") {
    if (method === "POST" && id === "upload-token") {
      const role = await workspaceRole(owner, actor);
      if (role.role === "Viewer" || role.scope)
        throw new AppError(
          "Recovery uploads require full workspace Editor or Owner access.",
          403,
        );
      const input = z
        .object({ size: z.number().int().positive().max(EXPORT_LIMIT) })
        .parse(await body(request));
      if (!cloudMode()) return json({ local: true });
      await rateLimit("recovery-upload:" + actor, 10, 60000);
      const ticket = randomUUID(),
        object = owner + "/staging/recovery/" + ticket;
      await consume(owner, "storage", input.size);
      try {
        const { data, error } = await privateStorage().createSignedUploadUrl(
          object,
          { upsert: false },
        );
        if (error || !data)
          throw new AppError(
            "Private recovery uploads are unavailable. Check cloud storage setup.",
            503,
          );
        await db()
          .prepare("INSERT INTO upload_tickets VALUES(?,?,?,?,?,?,?,?)")
          .run(
            ticket,
            owner,
            owner,
            actor,
            "recovery",
            object,
            input.size,
            Date.now() + 2 * 3600000,
          );
        return json({ local: false, ticket, signedUrl: data.signedUrl });
      } catch (error) {
        await release(owner, "storage", input.size);
        throw error;
      }
    }
    if (method === "GET" && !id)
      return json({ backups: await authorizedBackupList(actor, owner) });
    if (method === "POST" && id === "backup") {
      const input = z
        .object({ projectIds: z.array(z.string()).min(1).max(100) })
        .parse(await body(request));
      for (const p of input.projectIds) {
        const a = await projectAccess(p, actor);
        if (a.owner !== owner)
          throw new AppError("Select projects in this workspace.");
      }
      const jobId = await enqueue(actor, owner, "backup", input);
      after(() => runJob(jobId));
      return json({ jobId }, 202);
    }
    if (method === "GET" && action === "download") {
      const backup = await backupAccess(actor, id);
      if (backup.object_name)
        return NextResponse.redirect(
          await objectUrl(
            String(backup.object_name),
            "chapter-backup-" + id + ".zip",
          ),
          {
            headers: {
              "Cache-Control": "private, no-store",
              "Referrer-Policy": "no-referrer",
            },
          },
        );
      return fileResponse(
        await backupBytes(actor, id),
        `chapter-backup-${id}.zip`,
      );
    }
    if (method === "DELETE") {
      await removeBackup(actor, id);
      return json({ ok: true });
    }
    if (method === "POST" && ["preview", "restore"].includes(id)) {
      await rateLimit(`recovery:${actor}`, 10, 60000);
      const input = await archiveInput(request, actor, owner);
      if (id === "preview")
        return json({
          preview: await recoveryPreview(actor, owner, input.bytes),
        });
      if (!input.confirmed)
        throw new AppError("Review the recovery contents and confirm first.");
      const selection = z
        .array(z.string())
        .min(1)
        .max(100)
        .parse(input.selected);
      const restored = await restoreExport(
        actor,
        owner,
        input.bytes,
        input.digest,
        selection,
      );
      if ("ticket" in input && input.ticket) {
        const removed = await db()
          .prepare(
            "DELETE FROM upload_tickets WHERE id=? AND owner=? AND name=? AND kind='recovery' RETURNING object_name,size",
          )
          .get(input.ticket, owner, actor);
        if (removed) {
          await release(owner, "storage", Number(removed.size));
          try {
            await removeObject(String(removed.object_name));
          } catch {
            /* worker housekeeping can remove an unreferenced staging object */
          }
        }
      }
      return json(restored, 201);
    }
  }
  if (section === "support") {
    if (method === "GET")
      return json({
        requests: await db()
          .prepare(
            "SELECT id,subject,at FROM support_requests WHERE actor=? ORDER BY at DESC LIMIT 30",
          )
          .all(actor),
        supportEmail: process.env.SUPPORT_EMAIL || "",
      });
    if (method === "POST") {
      const input = z
        .object({
          subject: z.string().trim().min(1).max(120),
          text: z.string().trim().min(1).max(4000),
        })
        .parse(await body(request));
      await rateLimit(`support:${actor}`, 5, 3600000);
      const id = randomUUID();
      await db()
        .prepare("INSERT INTO support_requests VALUES(?,?,?,?,?)")
        .run(
          id,
          actor,
          await ownerRedact(owner, input.subject),
          handoverText(input.text, await accountSecrets(owner)),
          new Date().toISOString(),
        );
      return json(
        {
          id,
          message:
            "Saved privately. Contact the configured support address with this reference; no email was sent.",
        },
        201,
      );
    }
  }
  throw new AppError("Method not allowed.", 405);
}
