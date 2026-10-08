import { NextResponse, after } from "next/server";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "./database";
import {
  requireUser,
  getProjects,
  rateLimit,
  record,
  uploadBytes,
  storeUpload,
  ownerRedact,
} from "./db";
import { projectAccess, workspaceRole } from "./access";
import { AppError, hash } from "./security";
import { actorContext, recordContext } from "./request-context";
import {
  resumeContext,
  startSession,
  completeSession,
  captureProgress,
} from "./continuation";
import { proposalKinds, applyProposal } from "./action-proposals";
import { runJob } from "./jobs";
import { attentionInbox } from "./attention";
import {
  isPlatformAdmin,
  requirePlatformAdmin,
  insights,
} from "./product-insights";
import { productEvent } from "./product-insights";
import { screenshotType } from "./uploads";
const json = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
async function body(request: Request, max = 750000) {
  if (Number(request.headers.get("content-length") || 0) > max)
    throw new AppError("Request too large.", 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > max)
    throw new AppError("Request too large.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("Invalid JSON. Correct the input before retrying.");
  }
}
export async function authenticateDeveloper(
  request: Request,
  projectId: string,
) {
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer ch_dev_[a-f0-9]{64}$/.test(header))
    throw new AppError("A project capture token is required.", 401);
  const credential = header.slice(7);
  const r = await db()
    .prepare(
      "SELECT * FROM developer_tokens WHERE token_hash=? AND revoked=0 AND expires>?",
    )
    .get(hash(credential), Date.now());
  if (!r) throw new AppError("Capture token expired or revoked.", 401);
  if (r.project_id !== projectId)
    throw new AppError("Token is not scoped to this project.", 403);
  const a = await projectAccess(projectId, String(r.actor), "edit");
  return {
    actor: String(r.actor),
    owner: a.owner,
    id: String(r.id),
    credential,
  };
}
export async function developerRoute(request: Request, parts: string[]) {
  const [section, resource, id, action] = parts;
  if (section !== "developer") return null;
  if (
    resource !== "projects" ||
    action !== "capture" ||
    request.method !== "POST" ||
    parts.length !== 4
  )
    throw new AppError(
      "Capture tokens only permit POST /api/developer/projects/:id/capture.",
      405,
    );
  const auth = await authenticateDeveloper(request, id);
  await rateLimit("capture:" + auth.id, 120, 3600000);
  const raw = await body(request);
  return actorContext.run(auth.actor, () =>
    recordContext.run(new Map(), async () => {
      try {
        const result = await captureProgress(
          auth.actor,
          id,
          auth.id,
          raw,
          auth.credential,
        );
        return json({
          id: result.id,
          duplicate: result.duplicate,
          saved: true,
          projectId: id,
          nextTask: result.project.nextTask,
          updatedAt: result.project.updatedAt,
        });
      } catch (e) {
        await productEvent(auth.actor, auth.owner, id, "capture", "failed");
        throw e;
      }
    }),
  );
}
export async function phaseFiveRoute(request: Request, parts: string[]) {
  const [section, id, action] = parts,
    method = request.method;
  const projectActions = [
    "session-context",
    "sessions",
    "capture-tokens",
    "proposals",
  ];
  if (
    ![
      "continuation",
      "attention",
      "feedback",
      "feedback-admin",
      "insights",
    ].includes(section) &&
    !(section === "projects" && projectActions.includes(action))
  )
    return null;
  const user = await requireUser(),
    actor = user.id;
  const owner = request.headers.get("x-chapter-workspace") || actor;
  await workspaceRole(owner, actor);
  if (section === "continuation" && method === "GET")
    return json({
      projects: (await getProjects(actor)).filter(
        (p) => p.workspaceOwner === owner,
      ),
      admin: await isPlatformAdmin(actor),
      ai: !!process.env.OPENAI_API_KEY,
    });
  if (section === "insights" && method === "GET")
    return json(await insights(actor, owner));
  if (section === "attention") {
    const inbox = await attentionInbox(actor, owner);
    if (method === "GET") return json(inbox);
    if (method === "POST") {
      const input = z
        .object({
          key: z.string().max(240),
          action: z.enum(["resolve", "snooze", "disable", "reopen"]),
          hours: z.number().int().min(1).max(720).default(24),
        })
        .parse(await body(request));
      const item = inbox.items.find((i) => i.key === input.key);
      if (!item)
        throw new AppError(
          "This item no longer applies or is outside your access.",
          404,
        );
      const state =
        input.action === "resolve"
          ? { resolved: item.fingerprint }
          : input.action === "disable"
            ? { disabled: true }
            : input.action === "snooze"
              ? {
                  snoozedUntil: new Date(
                    Date.now() + input.hours * 3600000,
                  ).toISOString(),
                }
              : {};
      await db()
        .prepare(
          "INSERT INTO attention_states VALUES(?,?,?) ON CONFLICT(actor,item_key) DO UPDATE SET data=excluded.data",
        )
        .run(actor, item.key, JSON.stringify(state));
      return json({ ok: true });
    }
  }
  if (section === "feedback" || section === "feedback-admin") {
    const admin = section === "feedback-admin";
    if (admin) await requirePlatformAdmin(actor);
    if (admin && method === "GET" && id === "usage")
      return json(await insights(actor));
    if (method === "GET" && !id) {
      const rows = await db()
        .prepare(
          admin
            ? "SELECT * FROM product_feedback ORDER BY updated_at DESC LIMIT 200"
            : "SELECT * FROM product_feedback WHERE actor=? ORDER BY updated_at DESC LIMIT 100",
        )
        .all(...(admin ? [] : [actor]));
      const updates = await db()
        .prepare(
          "SELECT * FROM feedback_updates WHERE published=1 ORDER BY at DESC LIMIT 200",
        )
        .all();
      const themes = new Map<string, number>();
      if (admin)
        for (const r of rows) {
          const theme = JSON.parse(String(r.data)).theme;
          if (typeof theme === "string" && theme)
            themes.set(theme, (themes.get(theme) || 0) + 1);
        }
      return json({
        requests: rows.map((r) => ({
          ...r,
          data: JSON.parse(String(r.data)),
          updates: updates.filter((u) => u.feedback_id === r.id),
        })),
        categories: admin
          ? rows.reduce(
              (acc, r) => ({
                ...acc,
                [String(r.category)]: Number(acc[String(r.category)] || 0) + 1,
              }),
              {} as Record<string, number>,
            )
          : undefined,
        themes: admin ? Object.fromEntries(themes) : undefined,
        admin,
      });
    }
    if (!admin && method === "POST" && !id) {
      await rateLimit("feedback:" + actor, 15, 3600000);
      const form = await request.formData();
      const input = z
        .object({
          id: z.uuid(),
          subject: z.string().trim().min(1).max(120),
          text: z.string().trim().min(1).max(4000),
          category: z.enum(["Bug", "Feature request", "Usability", "Other"]),
          diagnostics: z.boolean(),
          screenshotReviewed: z.boolean(),
        })
        .parse({
          id: form.get("id"),
          subject: form.get("subject"),
          text: form.get("text"),
          category: form.get("category"),
          diagnostics: form.get("diagnostics") === "true",
          screenshotReviewed: form.get("screenshotReviewed") === "true",
        });
      const existing = await db()
        .prepare("SELECT id FROM product_feedback WHERE id=? AND actor=?")
        .get(input.id, actor);
      if (existing) return json({ id: input.id });
      const file = form.get("screenshot");
      let screenshotId = "";
      if (file instanceof File && file.size) {
        if (file.size > 2 * 1024 * 1024)
          throw new AppError("Feedback screenshots must be under 2 MB.", 413);
        if (!input.screenshotReviewed)
          throw new AppError(
            "Review the screenshot for secrets and customer data before submitting.",
          );
        const bytes = Buffer.from(await file.arrayBuffer()),
          type = screenshotType(bytes);
        screenshotId = await storeUpload(
          actor,
          null,
          "feedback-screenshot",
          "feedback",
          type,
          bytes,
        );
      }
      const data = {
        subject: await ownerRedact(actor, input.subject),
        text: await ownerRedact(actor, input.text),
        screenshotId,
        diagnostics: input.diagnostics
          ? {
              platform: "Chapter Phase Five",
              receivedAt: new Date().toISOString(),
              requestId: String(form.get("requestId") || "").match(
                /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
              )
                ? String(form.get("requestId") || "")
                : "",
              clientFamily: (request.headers.get("user-agent") || "").includes(
                "Mobile",
              )
                ? "mobile"
                : "desktop",
            }
          : null,
      };
      try {
        await db()
          .prepare("INSERT INTO product_feedback VALUES(?,?,?,?,?,?,?)")
          .run(
            input.id,
            actor,
            input.category,
            "Submitted",
            JSON.stringify(data),
            new Date().toISOString(),
            new Date().toISOString(),
          );
      } catch (e) {
        if (screenshotId) {
          const { removeObject } = await import("./storage"),
            { release } = await import("./billing");
          const r = await db()
            .prepare(
              "DELETE FROM uploads WHERE id=? RETURNING object_name,size",
            )
            .get(screenshotId);
          if (r) {
            await release(actor, "storage", Number(r.size));
            if (r.object_name) await removeObject(String(r.object_name));
          }
        }
        throw e;
      }
      return json({ id: input.id });
    }
    const r = await db()
      .prepare("SELECT * FROM product_feedback WHERE id=?")
      .get(id);
    if (!r || (!admin && r.actor !== actor))
      throw new AppError("Feedback not found.", 404);
    if (action === "screenshot" && method === "GET") {
      const data = JSON.parse(String(r.data));
      if (!data.screenshotId)
        throw new AppError("No screenshot attached.", 404);
      const bytes = await uploadBytes(data.screenshotId, String(r.actor));
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": screenshotType(bytes),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (admin && method === "PATCH") {
      const input = z
        .object({
          category: z.enum(["Bug", "Feature request", "Usability", "Other"]),
          state: z.enum([
            "Submitted",
            "Reviewing",
            "Planned",
            "Shipped",
            "Closed",
          ]),
          update: z.string().max(2000),
          publish: z.boolean(),
          theme: z.string().max(80).default(""),
        })
        .parse(await body(request));
      await transaction([
        {
          sql: "UPDATE product_feedback SET category=?,state=?,updated_at=?,data=? WHERE id=?",
          parameters: [
            input.category,
            input.state,
            new Date().toISOString(),
            JSON.stringify({
              ...JSON.parse(String(r.data)),
              theme: await ownerRedact(actor, input.theme.trim()),
            }),
            id,
          ],
        },
        ...(input.update.trim()
          ? [
              {
                sql: "INSERT INTO feedback_updates VALUES(?,?,?,?,?)",
                parameters: [
                  randomUUID(),
                  id,
                  await ownerRedact(actor, input.update),
                  input.publish ? 1 : 0,
                  new Date().toISOString(),
                ],
              },
            ]
          : []),
      ]);
      return json({ ok: true });
    }
  }
  if (section === "projects") {
    const a = await projectAccess(
      id,
      actor,
      method === "GET" ? "read" : "edit",
    );
    if (action === "session-context" && method === "GET")
      return json(await resumeContext(actor, id));
    if (action === "sessions" && method === "POST") {
      const input = await body(request);
      if (input.action === "start")
        return json(await startSession(actor, id, input));
      if (input.action === "complete")
        return json(
          await completeSession(
            actor,
            id,
            z.uuid().parse(input.sessionId),
            input,
          ),
        );
      if (input.action === "cancel") {
        await db()
          .prepare(
            "UPDATE resume_sessions SET state='canceled',finished_at=? WHERE id=? AND actor=? AND project_id=? AND state='active'",
          )
          .run(
            new Date().toISOString(),
            z.uuid().parse(input.sessionId),
            actor,
            id,
          );
        return json({ ok: true });
      }
      throw new AppError("Choose start, complete or cancel.");
    }
    if (action === "capture-tokens") {
      if (method === "GET")
        return json({
          tokens: await db()
            .prepare(
              "SELECT id,actor,name,expires,revoked,at,last_used FROM developer_tokens WHERE project_id=?" +
                (a.role === "Owner" ? "" : " AND actor=?") +
                " ORDER BY at DESC",
            )
            .all(...(a.role === "Owner" ? [id] : [id, actor])),
        });
      if (method === "POST") {
        await rateLimit("token:" + actor, 20, 3600000);
        const input = z
          .object({
            name: z.string().trim().min(1).max(80),
            days: z.number().int().min(1).max(365).default(90),
          })
          .parse(await body(request));
        const key = "ch_dev_" + randomBytes(32).toString("hex"),
          tokenId = randomUUID(),
          at = new Date().toISOString();
        await db()
          .prepare("INSERT INTO developer_tokens VALUES(?,?,?,?,?,?,0,?,null)")
          .run(
            tokenId,
            actor,
            id,
            hash(key),
            await ownerRedact(a.owner, input.name),
            Date.now() + input.days * 86400000,
            at,
          );
        await record(
          a.owner,
          "Created a project-scoped development capture token",
          "token",
          id,
        );
        return json({
          id: tokenId,
          token: key,
          scope: { projectId: id, capabilities: ["capture"] },
          message:
            "Copy once to CHAPTER_TOKEN in your development environment. This token cannot download, share, deploy or control hosting.",
        });
      }
      if (method === "DELETE") {
        const input = z
          .object({ tokenId: z.uuid() })
          .parse(await body(request));
        const t = await db()
          .prepare(
            "SELECT actor FROM developer_tokens WHERE id=? AND project_id=?",
          )
          .get(input.tokenId, id);
        if (!t || (t.actor !== actor && a.role !== "Owner"))
          throw new AppError("Token not found.", 404);
        await db()
          .prepare("UPDATE developer_tokens SET revoked=1 WHERE id=?")
          .run(input.tokenId);
        return json({ ok: true });
      }
    }
    if (action === "proposals") {
      if (method === "GET")
        return json({
          proposals: (
            await db()
              .prepare(
                "SELECT id,kind,state,data,at FROM action_proposals WHERE project_id=? AND actor=? ORDER BY at DESC LIMIT 30",
              )
              .all(id, actor)
          ).map((r) => ({ ...r, data: JSON.parse(String(r.data)) })),
        });
      const input = await body(request);
      if (method === "POST" && input.action === "generate") {
        const parsed = z
          .object({
            id: z.uuid(),
            kind: z.enum(proposalKinds),
            useAI: z.boolean(),
          })
          .parse(input);
        const existing = await db()
          .prepare("SELECT * FROM action_proposals WHERE id=?")
          .get(parsed.id);
        if (existing) {
          if (existing.actor !== actor || existing.project_id !== id)
            throw new AppError("Proposal not found.", 404);
          return json({
            id: parsed.id,
            jobId: JSON.parse(String(existing.data)).jobId,
          });
        }
        await rateLimit("proposal:" + actor, 30, 3600000);
        const jobId = randomUUID(),
          at = new Date().toISOString();
        await transaction([
          {
            sql: "INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            parameters: [
              jobId,
              actor,
              a.owner,
              "proposal",
              "queued",
              JSON.stringify({
                projectId: id,
                proposalId: parsed.id,
                useAI: parsed.useAI,
              }),
              null,
              null,
              0,
              Date.now(),
              0,
              at,
              at,
            ],
          },
          {
            sql: "INSERT INTO action_proposals VALUES(?,?,?,?,?,?,?)",
            parameters: [
              parsed.id,
              id,
              actor,
              parsed.kind,
              "queued",
              JSON.stringify({ jobId }),
              at,
            ],
          },
        ]);
        after(() => runJob(jobId));
        return json({ id: parsed.id, jobId });
      }
      if (method === "POST" && input.action === "apply")
        return json(
          await applyProposal(
            actor,
            id,
            z.uuid().parse(input.proposalId),
            input,
          ),
        );
    }
  }
  throw new AppError("Method not allowed.", 405);
}
