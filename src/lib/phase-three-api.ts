import { randomUUID, randomBytes } from "node:crypto";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import JSZip from "jszip";
import { db, transaction } from "./database";
import {
  requireUser,
  getProjects,
  activities,
  integrations,
  accountSecrets,
  uploadBytes,
  ownerRedact,
  insertProject,
  newProject,
  storeUpload,
  saveProjectIfUnchanged,
  record,
  rateLimit,
} from "./db";
import {
  projectAccess,
  workspaceAdmin,
  workspaceRole,
  workspaceList,
  ensureWorkspace,
} from "./access";
import { AppError, hash } from "./security";
import {
  billingState,
  billingConfigured,
  usage,
  consume,
  release,
  usageStep,
  planLimits,
  stripeClient,
  verifyBillingEvent,
  syncSubscription,
  type Plan,
} from "./billing";
import { prepareHandover, handoverText } from "./phase-two";
import { memorySources, searchMemory } from "./knowledge";
import { enqueue, runJob, runPending } from "./jobs";
import {
  notificationList,
  preferences,
  notificationKinds,
  notify,
} from "./notifications";
import { storedRecords } from "./versions";
import { costTotals, taskFor } from "./planning";

const json = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function body(request: Request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 100000)
    throw new AppError("Form is too large.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("Invalid form.");
  }
}
const roles = z.enum(["Owner", "Editor", "Viewer"]),
  paths = z.array(z.string().min(1).max(300)).max(500);
async function scopeInput(owner: string, scope: string[] | null) {
  if (scope)
    for (const id of scope) {
      const a = await projectAccess(id, owner);
      if (a.owner !== owner)
        throw new AppError("Choose projects from this workspace.");
    }
}
async function members(owner: string) {
  const primary = await db()
    .prepare("SELECT id,name,email FROM users WHERE id=?")
    .get(owner);
  const rows = await db()
    .prepare(
      "SELECT u.id,u.name,u.email,m.role,m.scope,m.at FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?",
    )
    .all(owner);
  return [
    {
      id: String(primary.id),
      name: String(primary.name),
      email: String(primary.email),
      role: "Owner",
      scope: null as string[] | null,
      primary: true,
    },
    ...rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      email: String(r.email),
      role: String(r.role),
      scope: r.scope ? (JSON.parse(String(r.scope)) as string[]) : null,
      primary: false,
    })),
  ];
}
export async function workspaceData(user: {
  id: string;
  name: string;
  email: string;
  demo?: boolean;
}) {
  return {
    user,
    projects: await getProjects(user.id),
    activity: await activities(user.id),
    integrations: await integrations(user.id),
    workspaces: await workspaceList(user.id),
  };
}
function templateDocument(
  p: Awaited<ReturnType<typeof projectAccess>>["project"],
  preview: Awaited<ReturnType<typeof prepareHandover>>,
) {
  const checklist = [
    "Create a new repository for this independent project.",
    "Review dependencies and confirm licenses.",
    "Install dependencies using the recorded setup instructions.",
    ...p.requiredEnvNames.map(
      (n) => `Configure ${n} securely; no value is included.`,
    ),
    "Run the application and tests; configure a separate hosting project.",
  ];
  return {
    files: preview.files,
    documentation: handoverText(
      `# Starter: ${p.name}\n\n${p.description || "Purpose not recorded."}\n\nSetup\n${p.memory?.setup || "Not recorded. Add verified setup steps before using this starter."}\n\nConfiguration names\n${p.requiredEnvNames.map((n) => `${n}=<YOUR_VALUE>`).join("\n") || "No required names recorded."}\n\nSetup checklist\n${checklist.map((t) => `- [ ] ${t}`).join("\n")}\n\nThis starter creates stored files only. It does not copy repository, hosting, domain, subscription or database ownership.`,
    ),
    checklist,
    requiredEnvNames: p.requiredEnvNames,
  };
}
async function safeRecord(owner: string, value: unknown): Promise<unknown> {
  if (typeof value === "string") return ownerRedact(owner, value);
  if (Array.isArray(value))
    return Promise.all(value.map((v) => safeRecord(owner, v)));
  if (value && typeof value === "object")
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([k, v]) => [
          k,
          await safeRecord(owner, v),
        ]),
      ),
    );
  return value;
}
async function reviewedTemplate(
  row: Record<string, unknown>,
  actor: string,
  target: string,
) {
  await workspaceRole(target, actor);
  const raw = JSON.parse(String(row.data)),
    secrets = [
      ...(await accountSecrets(String(row.workspace_id))),
      ...(await accountSecrets(target)),
    ];
  const data = {
    ...raw,
    files: raw.files.map(
      (f: { path: string; content: string; size: number }) => ({
        ...f,
        content: handoverText(f.content, secrets),
      }),
    ),
    documentation: handoverText(raw.documentation, secrets),
    checklist: raw.checklist.map((t: string) => handoverText(t, secrets)),
  };
  return { data, digest: hash(JSON.stringify({ id: row.id, target, data })) };
}
export async function phaseThreeRoute(
  request: Request,
  parts: string[],
): Promise<Response | null> {
  const [section, id, action] = parts,
    method = request.method;
  if (section === "billing" && id === "webhook" && method === "POST") {
    if (!billingConfigured())
      throw new AppError("Stripe webhook is not configured.", 503);
    const raw = await request.text();
    if (raw.length > 1000000) throw new AppError("Webhook too large.", 413);
    const event = verifyBillingEvent(
      raw,
      request.headers.get("stripe-signature") || "",
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
    const object = event.data.object as unknown as {
      customer?: string | { id: string };
    };
    const customer =
      typeof object.customer === "string"
        ? object.customer
        : object.customer?.id;
    const row = customer
      ? await db()
          .prepare("SELECT owner FROM subscriptions WHERE customer=?")
          .get(customer)
      : null;
    if (
      row &&
      (event.type.startsWith("customer.subscription.") ||
        event.type.startsWith("invoice.") ||
        event.type === "checkout.session.completed")
    ) {
      const existing = await db()
        .prepare("SELECT id FROM billing_events WHERE id=?")
        .get(event.id);
      if (!existing) {
        const at = new Date().toISOString();
        try {
          await transaction([
            {
              sql: "INSERT INTO billing_events VALUES(?,?)",
              parameters: [event.id, at],
            },
            {
              sql: "INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
              parameters: [
                event.id,
                String(row.owner),
                String(row.owner),
                "billing",
                "queued",
                "{}",
                null,
                null,
                0,
                Date.now(),
                0,
                at,
                at,
              ],
            },
          ]);
        } catch (error) {
          if (
            !(await db()
              .prepare("SELECT id FROM billing_events WHERE id=?")
              .get(event.id))
          )
            throw error;
        }
      }
      after(() => runJob(event.id));
    }
    return json({ received: true });
  }
  if (section === "cron" && id === "jobs" && method === "GET") {
    if (
      !process.env.CRON_SECRET ||
      request.headers.get("authorization") !==
        `Bearer ${process.env.CRON_SECRET}`
    )
      throw new AppError("Unauthorized worker.", 401);
    await runPending();
    return json({ ok: true, at: new Date().toISOString() });
  }
  const projectActions = [
    "comments",
    "assignment",
    "versions",
    "restore-preview",
    "restore",
    "template-preview",
    "template-create",
    "memory-file",
    "collaborators",
  ];
  if (
    ![
      "teams",
      "templates",
      "memory",
      "portfolio",
      "billing",
      "notifications",
      "jobs",
    ].includes(section) &&
    !(section === "projects" && projectActions.includes(action))
  )
    return null;
  const user = await requireUser(),
    actor = user.id;
  if (section === "teams") {
    if (method === "GET" && !id)
      return json({ workspaces: await workspaceList(actor) });
    if (id === "accept" && method === "POST") {
      const { token } = z
        .object({ token: z.string().min(32).max(100) })
        .parse(await body(request));
      const row = await db()
        .prepare(
          "SELECT * FROM invitations WHERE id=? AND state='pending' AND expires>?",
        )
        .get(hash(token), Date.now());
      if (!row || row.email !== user.email)
        throw new AppError(
          "This invitation is expired, used, or belongs to another email address.",
          404,
        );
      const owner = String(row.workspace_id);
      await scopeInput(owner, row.scope ? JSON.parse(String(row.scope)) : null);
      if (
        await db()
          .prepare(
            "SELECT user_id FROM members WHERE workspace_id=? AND user_id=?",
          )
          .get(owner, actor)
      )
        throw new AppError(
          "You are already a member. Ask an Owner to update your role.",
          409,
        );
      await transaction([
        {
          sql: "UPDATE invitations SET state='accepted' WHERE id=? AND state='pending' AND expires>? RETURNING id",
          parameters: [hash(token), Date.now()],
          required: "Invitation was already used or expired.",
        },
        {
          sql: "INSERT INTO members VALUES(?,?,?,?,?)",
          parameters: [
            owner,
            actor,
            row.role,
            row.scope,
            new Date().toISOString(),
          ],
        },
      ]);
      await record(owner, `${user.name} joined as ${row.role}`, "team");
      return json({ workspaces: await workspaceList(actor) });
    }
    await workspaceAdmin(id, actor);
    if (method === "GET")
      return json({
        members: await members(id),
        invitations: (
          await db()
            .prepare(
              "SELECT email,role,scope,expires,state,at FROM invitations WHERE workspace_id=? ORDER BY at DESC LIMIT 50",
            )
            .all(id)
        ).map((r) => ({
          ...r,
          scope: r.scope ? JSON.parse(String(r.scope)) : null,
        })),
        name: (
          await db().prepare("SELECT name FROM workspaces WHERE id=?").get(id)
        )?.name,
      });
    if (method === "PATCH" && !action) {
      const { name } = z
        .object({ name: z.string().trim().min(1).max(80) })
        .parse(await body(request));
      await db()
        .prepare("UPDATE workspaces SET name=? WHERE id=?")
        .run(await ownerRedact(id, name), id);
      return json({ ok: true });
    }
    if (action === "invite" && method === "POST") {
      const input = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((v) => v.toLowerCase()),
          role: roles,
          scope: z.array(z.uuid()).max(500).nullable(),
        })
        .parse(await body(request));
      await rateLimit(`invite:${id}`, 20, 3600000);
      await scopeInput(id, input.scope);
      if (
        input.email === user.email ||
        (await db()
          .prepare(
            "SELECT m.user_id FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?",
          )
          .get(id, input.email))
      )
        throw new AppError(
          "This person already belongs to the workspace.",
          409,
        );
      if (
        await db()
          .prepare(
            "SELECT id FROM invitations WHERE workspace_id=? AND email=? AND state='pending' AND expires>?",
          )
          .get(id, input.email, Date.now())
      )
        throw new AppError(
          "There is already a pending invitation for this email.",
          409,
        );
      const token = randomBytes(32).toString("hex"),
        at = new Date().toISOString();
      await transaction([
        await usageStep(id, "seats", 1),
        {
          sql: "INSERT INTO invitations VALUES(?,?,?,?,?,?,?,?)",
          parameters: [
            hash(token),
            id,
            input.email,
            input.role,
            input.scope ? JSON.stringify(input.scope) : null,
            Date.now() + 7 * 86400000,
            "pending",
            at,
          ],
        },
      ]);
      await record(id, `Invited a ${input.role} collaborator`, "team");
      return json({
        token,
        link: `/dashboard?invite=${token}`,
        message:
          "Send this link yourself. The recipient must sign in with the invited email. It expires in seven days.",
      });
    }
    if (action === "member" && ["PATCH", "DELETE"].includes(method)) {
      const input = z
        .object({
          userId: z.uuid(),
          role: roles.optional(),
          scope: z.array(z.uuid()).max(500).nullable().optional(),
        })
        .parse(await body(request));
      if (input.userId === id)
        throw new AppError(
          "The primary Owner retains ownership and billing responsibility.",
          409,
        );
      const row = await db()
        .prepare("SELECT * FROM members WHERE workspace_id=? AND user_id=?")
        .get(id, input.userId);
      if (!row) throw new AppError("Member not found.", 404);
      if (method === "DELETE") {
        await transaction([
          {
            sql: "DELETE FROM members WHERE workspace_id=? AND user_id=? RETURNING user_id",
            parameters: [id, input.userId],
            required: "Member already removed.",
          },
          {
            sql: "UPDATE usage_counters SET used=used-1 WHERE owner=? AND kind='seats' AND period='all'",
            parameters: [id],
          },
        ]);
      } else {
        await scopeInput(
          id,
          input.scope === undefined
            ? row.scope
              ? JSON.parse(String(row.scope))
              : null
            : input.scope,
        );
        await db()
          .prepare(
            "UPDATE members SET role=?,scope=? WHERE workspace_id=? AND user_id=?",
          )
          .run(
            input.role || row.role,
            input.scope === undefined
              ? row.scope
              : input.scope
                ? JSON.stringify(input.scope)
                : null,
            id,
            input.userId,
          );
      }
      await record(
        id,
        `${method === "DELETE" ? "Removed" : "Updated"} collaborator access`,
        "team",
      );
      return json({ ok: true });
    }
    if (action === "revoke" && method === "POST") {
      const { email } = z
        .object({ email: z.email() })
        .parse(await body(request));
      const rows = await db()
        .prepare(
          "UPDATE invitations SET state='revoked' WHERE workspace_id=? AND email=? AND state='pending' RETURNING id",
        )
        .all(id, email);
      if (rows.length) await release(id, "seats", rows.length);
      return json({ ok: true });
    }
  }
  if (section === "billing") {
    const owner = id || actor;
    await workspaceAdmin(owner, actor, true);
    if (method === "GET") {
      const state = await billingState(owner);
      return json({
        plan: state.plan,
        status: state.status,
        checkedAt: state.checkedAt,
        usage: await usage(owner, true),
        storageUnknown: !!(await db()
          .prepare(
            "SELECT id FROM uploads WHERE owner=? AND size IS NULL LIMIT 1",
          )
          .get(owner)),
        limits: state.limits,
        plans: planLimits(),
        configured: billingConfigured(),
        pricesConfigured: {
          Pro: !!process.env.STRIPE_PRO_PRICE_ID,
          Team: !!process.env.STRIPE_TEAM_PRICE_ID,
        },
        hasCustomer: !!state.customer,
        aiPeriod: new Date().toISOString().slice(0, 7),
      });
    }
    if (action === "reconcile" && method === "POST") {
      const jobId = await enqueue(actor, owner, "storage", {});
      after(() => runJob(jobId));
      return json({ jobId }, 202);
    }
    const client = stripeClient(),
      state = await billingState(owner),
      base = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
    if (action === "sync" && method === "POST")
      return json(await syncSubscription(owner, client));
    if (action === "portal" && method === "POST") {
      if (!state.customer)
        throw new AppError(
          "No billing account yet. Choose a paid plan first.",
          409,
        );
      return json({
        url: (
          await client.billingPortal.sessions.create({
            customer: state.customer,
            return_url: `${base}/dashboard?billing=return`,
          })
        ).url,
      });
    }
    if (action === "checkout" && method === "POST") {
      const { plan } = z
        .object({ plan: z.enum(["Pro", "Team"]) })
        .parse(await body(request));
      if (
        state.subscription &&
        [
          "active",
          "trialing",
          "past_due",
          "unpaid",
          "incomplete",
          "paused",
        ].includes(state.status)
      )
        throw new AppError(
          "Manage your existing subscription in Billing management to change plans.",
          409,
        );
      const price =
        plan === "Pro"
          ? process.env.STRIPE_PRO_PRICE_ID
          : process.env.STRIPE_TEAM_PRICE_ID;
      if (!price)
        throw new AppError(
          `Configure the Stripe ${plan} recurring price ID first.`,
          503,
        );
      const verified = await client.prices.retrieve(price);
      if (!verified.active || !verified.recurring)
        throw new AppError(
          "The configured Stripe price must be active and recurring.",
          503,
        );
      let customer = state.customer;
      if (!customer) {
        customer = (
          await client.customers.create(
            {
              email: user.email,
              name: user.name,
              metadata: { chapterOwner: owner },
            },
            { idempotencyKey: `chapter-customer:${owner}` },
          )
        ).id;
        await db()
          .prepare(
            "INSERT INTO subscriptions VALUES(?,?,null,'Free','free',?) ON CONFLICT(owner) DO UPDATE SET customer=excluded.customer",
          )
          .run(owner, customer, new Date().toISOString());
      }
      await rateLimit(`checkout:${owner}`, 5, 60000);
      const pending = await client.checkout.sessions.list({
        customer,
        status: "open",
        limit: 20,
      });
      const reusable = pending.data.find(
        (s) =>
          s.metadata?.chapterOwner === owner &&
          s.metadata.chapterPlan === plan &&
          s.url,
      );
      if (reusable?.url) return json({ url: reusable.url });
      const session = await client.checkout.sessions.create(
        {
          mode: "subscription",
          customer,
          line_items: [{ price, quantity: 1 }],
          client_reference_id: owner,
          metadata: { chapterOwner: owner, chapterPlan: plan },
          subscription_data: { metadata: { chapterOwner: owner } },
          success_url: `${base}/dashboard?billing=return`,
          cancel_url: `${base}/dashboard?billing=cancel`,
          allow_promotion_codes: true,
        },
        {
          idempotencyKey: `chapter-checkout:${owner}:${plan}:${Math.floor(Date.now() / 60000)}`,
        },
      );
      if (!session.url)
        throw new AppError("Stripe did not return a checkout URL.", 502);
      return json({ url: session.url });
    }
  }
  if (section === "memory") {
    const owner =
      new URL(request.url).searchParams.get("workspace") ||
      request.headers.get("x-chapter-workspace") ||
      actor;
    await workspaceRole(owner, actor);
    if (method === "GET") {
      const q = (new URL(request.url).searchParams.get("q") || "").slice(
        0,
        500,
      );
      return json({
        sources: searchMemory(await memorySources(actor, owner), q),
      });
    }
    if (method === "POST") {
      const input = z
        .object({
          question: z.string().trim().min(3).max(500),
          useAI: z.boolean(),
        })
        .parse(await body(request));
      await rateLimit(`memory:${actor}`, 10, 60000);
      const jobId = await enqueue(actor, owner, "memory", {
        ...input,
        question: handoverText(input.question, await accountSecrets(owner)),
      });
      after(() => runJob(jobId));
      return json({ jobId }, 202);
    }
  }
  if (section === "jobs") {
    if (!id && method === "GET")
      return json({
        jobs: await db()
          .prepare(
            "SELECT id,kind,state,attempts,error,at,updated_at FROM jobs WHERE actor=? ORDER BY at DESC LIMIT 30",
          )
          .all(actor),
      });
    const row = await db()
      .prepare("SELECT * FROM jobs WHERE id=? AND actor=?")
      .get(id, actor);
    if (!row) throw new AppError("Job not found.", 404);
    await workspaceRole(String(row.owner), actor);
    if (
      [
        "bundle-build",
        "recreation",
        "deployment",
        "sync",
        "automation",
        "proposal",
      ].includes(String(row.kind))
    )
      await projectAccess(
        JSON.parse(String(row.payload)).projectId,
        actor,
        ["bundle-build", "proposal"].includes(String(row.kind))
          ? "edit"
          : "control",
      );
    if (method === "POST" && action === "retry") {
      if (row.state !== "failed")
        throw new AppError("Only failed jobs can be retried.", 409);
      await rateLimit(`retry:${actor}`, 10, 60000);
      await db()
        .prepare(
          "UPDATE jobs SET state='queued',attempts=0,next_run=?,error=null WHERE id=? AND state='failed'",
        )
        .run(Date.now(), id);
      after(() => runJob(id));
      return json({ ok: true });
    }
    if (method === "POST" && action === "run") {
      await runJob(id);
      return json({ ok: true });
    }
    if (method === "GET") {
      if (
        (row.state === "queued" && Number(row.next_run) <= Date.now()) ||
        (row.state === "running" && Number(row.lease) < Date.now())
      )
        after(() => runJob(id));
      if (["deployment", "sync", "automation"].includes(String(row.kind)))
        await projectAccess(
          JSON.parse(String(row.payload)).projectId,
          actor,
          "control",
        );
      if (row.kind === "proposal")
        await projectAccess(
          JSON.parse(String(row.payload)).projectId,
          actor,
          "edit",
        );
      if (row.kind === "backup")
        for (const projectId of JSON.parse(String(row.payload)).projectIds)
          await projectAccess(projectId, actor);
      let result = row.result ? JSON.parse(String(row.result)) : null;
      if (row.kind === "memory" && result)
        result = {
          ...result,
          sources: (
            await Promise.all(
              (result.sources || []).map(async (s: { projectId: string }) => {
                try {
                  await projectAccess(s.projectId, actor);
                  return s;
                } catch {
                  return null;
                }
              }),
            )
          ).filter(Boolean),
        };
      return json({
        job: {
          id: row.id,
          kind: row.kind,
          state: row.state,
          attempts: row.attempts,
          error: row.error,
          nextRun: row.next_run,
          updatedAt: row.updated_at,
          result,
        },
      });
    }
  }
  if (section === "notifications") {
    if (method === "GET") {
      await runPending(actor);
      return json({
        notifications: await notificationList(actor),
        preferences: await preferences(actor),
      });
    }
    if (id === "preferences" && method === "POST") {
      const input = z
        .object(
          Object.fromEntries(
            notificationKinds.map((k) => [k, z.boolean().default(true)]),
          ),
        )
        .parse(await body(request));
      await db()
        .prepare(
          "INSERT INTO notification_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data",
        )
        .run(actor, JSON.stringify(input));
      return json({ ok: true });
    }
    if (method === "POST") {
      await db()
        .prepare("UPDATE notifications SET read_at=? WHERE id=? AND user_id=?")
        .run(new Date().toISOString(), id, actor);
      return json({ ok: true });
    }
  }
  if (section === "portfolio" && method === "GET") {
    const days = z.coerce
        .number()
        .int()
        .min(1)
        .max(365)
        .parse(new URL(request.url).searchParams.get("days") || 30),
      since = new Date(Date.now() - days * 86400000).toISOString();
    const projects = await getProjects(actor),
      entries = [];
    for (const p of projects) {
      const counts = await db()
        .prepare(
          "SELECT kind,count(*) AS count,max(at) AS updated_at FROM interest WHERE project_id=? AND at>=? GROUP BY kind",
        )
        .all(p.id, since);
      const previousCounts = await db()
        .prepare(
          "SELECT kind,count(*) AS count FROM interest WHERE project_id=? AND at>=? AND at<? GROUP BY kind",
        )
        .all(
          p.id,
          new Date(Date.now() - 2 * days * 86400000).toISOString(),
          since,
        );
      entries.push({
        id: p.id,
        name: p.name,
        status: p.status,
        workspaceOwner: p.workspaceOwner,
        updatedAt: p.updatedAt,
        interestUpdatedAt:
          counts
            .map((r) => String(r.updated_at))
            .sort()
            .at(-1) || null,
        costs: costTotals(p.expenses),
        expenses: p.expenses,
        previousInterest: Object.fromEntries(
          ["visit", "signup", "enquiry"].map((k) => [
            k,
            Number(previousCounts.find((r) => r.kind === k)?.count || 0),
          ]),
        ),
        nextTask: taskFor(p),
        taskMinutes: p.taskMinutes,
        returnDate: p.memory?.returnDate || null,
        interest: Object.fromEntries(
          ["visit", "signup", "enquiry"].map((k) => [
            k,
            Number(counts.find((r) => r.kind === k)?.count || 0),
          ]),
        ),
        source: `/dashboard?project=${p.id}`,
      });
    }
    return json({
      entries,
      activity: (await activities(actor)).filter((a) => a.at >= since),
      observedAt: new Date().toISOString(),
      days,
    });
  }
  if (section === "templates") {
    if (method === "GET" && !id)
      return json({
        templates: await db()
          .prepare(
            "SELECT id,name,workspace_id,at FROM templates WHERE owner=? ORDER BY at DESC",
          )
          .all(actor),
      });
    const t = await db()
      .prepare("SELECT * FROM templates WHERE id=? AND owner=?")
      .get(id, actor);
    if (!t) throw new AppError("Private template not found.", 404);
    const target = request.headers.get("x-chapter-workspace") || actor;
    const reviewed = await reviewedTemplate(t, actor, target),
      data = reviewed.data;
    if (method === "GET")
      return json({
        template: {
          id: t.id,
          name: t.name,
          at: t.at,
          digest: reviewed.digest,
          ...data,
        },
      });
    if (method === "DELETE") {
      await transaction([
        {
          sql: "DELETE FROM templates WHERE id=? AND owner=? RETURNING id",
          parameters: [id, actor],
          required: "Template already removed.",
        },
        {
          sql: "UPDATE usage_counters SET used=used-? WHERE owner=? AND kind='storage' AND period='all'",
          parameters: [t.bytes, t.workspace_id],
        },
      ]);
      return json({ ok: true });
    }
    if (action === "use" && method === "POST") {
      const input = z
        .object({
          name: z.string().trim().min(1).max(80),
          reviewed: z.literal(true),
          digest: z.string(),
        })
        .parse(await body(request));
      if (input.digest !== reviewed.digest)
        throw new AppError("Review the latest template first.", 409);
      const owner = request.headers.get("x-chapter-workspace") || actor,
        a = await workspaceRole(owner, actor);
      if (a.role === "Viewer" || a.scope)
        throw new AppError(
          "Creating a project requires full workspace Editor or Owner access.",
          403,
        );
      const secrets = await accountSecrets(owner),
        docs = handoverText(data.documentation, secrets);
      const zip = new JSZip();
      for (const f of data.files)
        zip.file(f.path, handoverText(f.content, secrets));
      zip.file("CHAPTER_SETUP.md", docs);
      const p = await insertProject(
        newProject({
          name: await ownerRedact(owner, input.name),
          description:
            "Created from a private starter. Review and update its purpose.",
          status: "Idea",
          setupChecklist: data.checklist,
          requiredEnvNames: data.requiredEnvNames,
        }),
        owner,
      );
      p.sourceId = await storeUpload(
        owner,
        p.id,
        `${input.name}-starter.zip`,
        "source",
        "application/zip",
        await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
      );
      p.sourceName = `${input.name}-starter.zip`;
      p.version = `template:${id}`;
      const row = await db()
        .prepare("SELECT data FROM projects WHERE id=?")
        .get(p.id);
      await saveProjectIfUnchanged(p, owner, String(row.data));
      await record(
        owner,
        `Created independent ${p.name} from a reviewed starter`,
        "template",
        p.id,
      );
      return json({ project: p }, 201);
    }
  }
  if (section === "projects") {
    const cap = ["template-create", "template-preview"].includes(action)
      ? "control"
      : method === "GET" || action === "restore-preview"
        ? "read"
        : action === "comments"
          ? "comment"
          : "edit";
    const {
      owner,
      project: p,
      previousData,
    } = await projectAccess(id, actor, cap);
    if (action === "collaborators" && method === "GET")
      return json({
        members: (await members(owner))
          .filter((m) => !m.scope || m.scope.includes(id))
          .map((m) => ({ id: m.id, name: m.name, role: m.role })),
      });
    if (action === "comments") {
      if (method === "GET")
        return json({
          comments: await db()
            .prepare(
              "SELECT c.id,c.text,c.at,u.name,c.actor FROM comments c JOIN users u ON u.id=c.actor WHERE c.project_id=? ORDER BY c.at DESC LIMIT 100",
            )
            .all(id),
        });
      if (method === "POST") {
        const { text } = z
          .object({ text: z.string().trim().min(1).max(4000) })
          .parse(await body(request));
        await rateLimit(`comments:${actor}`, 20, 60000);
        await db()
          .prepare("INSERT INTO comments VALUES(?,?,?,?,?)")
          .run(
            randomUUID(),
            id,
            actor,
            await ownerRedact(owner, text),
            new Date().toISOString(),
          );
        await record(owner, `Commented on ${p.name}`, "comment", id);
        return json({ ok: true });
      }
      if (method === "DELETE") {
        const { commentId } = z
          .object({ commentId: z.uuid() })
          .parse(await body(request));
        const c = await db()
          .prepare("SELECT actor FROM comments WHERE id=? AND project_id=?")
          .get(commentId, id);
        if (
          !c ||
          (c.actor !== actor &&
            (await projectAccess(id, actor)).role !== "Owner")
        )
          throw new AppError(
            "Only the author or an Owner can remove this comment.",
            403,
          );
        await db()
          .prepare("DELETE FROM comments WHERE id=? AND project_id=?")
          .run(commentId, id);
        return json({ ok: true });
      }
    }
    if (action === "assignment" && method === "POST") {
      const { assigneeId } = z
        .object({ assigneeId: z.string().max(80) })
        .parse(await body(request));
      if (assigneeId) await projectAccess(id, assigneeId);
      p.assigneeId = assigneeId;
      await saveProjectIfUnchanged(p, owner, previousData);
      await record(
        owner,
        `Updated ${p.name} next-task assignment`,
        "assignment",
        id,
      );
      if (assigneeId)
        await notify(
          assigneeId,
          id,
          "assignment",
          `You were assigned ${p.name}: ${taskFor(p) || "next task not yet recorded"}`,
        );
      return json({ project: p });
    }
    if (action === "memory-file" && method === "GET") {
      const path = new URL(request.url).searchParams.get("path"),
        source = (await memorySources(actor, owner)).find(
          (s) => s.projectId === id && s.label === `File: ${path}`,
        );
      if (!source) throw new AppError("Authorized text file not found.", 404);
      return new NextResponse(source.text, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "private,no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (action === "versions" && method === "GET")
      return json({
        versions: (
          await db()
            .prepare(
              "SELECT * FROM versions WHERE project_id=? ORDER BY at DESC,id DESC LIMIT 100",
            )
            .all(id)
        ).map((v) => ({ ...v, data: JSON.parse(String(v.data)) })),
        current: storedRecords(p),
      });
    if (["restore-preview", "restore"].includes(action) && method === "POST") {
      const input = z
        .object({
          versionId: z.uuid(),
          reviewed: z.boolean().optional(),
          digest: z.string().optional(),
        })
        .parse(await body(request));
      const v = await db()
        .prepare("SELECT * FROM versions WHERE id=? AND project_id=?")
        .get(input.versionId, id);
      if (!v) throw new AppError("Version not found.", 404);
      const kind = String(v.kind) as keyof ReturnType<typeof storedRecords>,
        before = storedRecords(p)[kind],
        next = (await safeRecord(owner, JSON.parse(String(v.data)))) as Record<
          string,
          unknown
        >,
        digest = hash(JSON.stringify({ previousData, versionId: v.id, next }));
      if (action === "restore-preview")
        return json({
          preview: {
            kind,
            before,
            after: next,
            digest,
            message:
              "Restores stored records only. Your repository, deployment, database, share settings and project status are unchanged.",
          },
        });
      if (!input.reviewed || input.digest !== digest)
        throw new AppError(
          "Review the current before/after changes and confirm the restore.",
          409,
        );
      const allowed = Object.keys(before);
      if (Object.keys(next).some((k) => !allowed.includes(k)))
        throw new AppError("Unsupported stored record.", 409);
      if (kind === "package")
        for (const key of ["sourceId", "buildId"])
          if (
            next[key] &&
            !(await db()
              .prepare(
                "SELECT id FROM uploads WHERE id=? AND project_id=? AND owner=?",
              )
              .get(String(next[key]), id, owner))
          )
            throw new AppError("The stored package is unavailable.", 409);
      Object.assign(p, next);
      p.revival = null;
      await saveProjectIfUnchanged(p, owner, previousData);
      await record(
        owner,
        `Restored stored ${kind} records for ${p.name}; external services unchanged`,
        "restore",
        id,
      );
      return json({ project: p });
    }
    if (
      ["template-preview", "template-create"].includes(action) &&
      method === "POST"
    ) {
      const input = z
        .object({
          paths,
          name: z.string().trim().min(1).max(80),
          reviewed: z.boolean().optional(),
          digest: z.string().optional(),
        })
        .parse(await body(request));
      const preview = await prepareHandover(
        p,
        p.sourceId ? await uploadBytes(p.sourceId, owner) : null,
        input.paths,
        await accountSecrets(owner),
      );
      const data = templateDocument(p, preview),
        serialized = JSON.stringify(await safeRecord(owner, data)),
        digest = hash(
          JSON.stringify({
            name: input.name,
            sourceId: p.sourceId,
            data: serialized,
          }),
        );
      if (action === "template-preview")
        return json({
          preview: {
            ...preview,
            documentation: JSON.parse(serialized).documentation,
            checklist: data.checklist,
            digest,
          },
        });
      if (!input.reviewed || input.digest !== digest)
        throw new AppError(
          "Review every selected file and starter documentation, then confirm credentials and customer data are excluded.",
          409,
        );
      if (
        (
          await db()
            .prepare("SELECT id FROM templates WHERE owner=?")
            .all(actor)
        ).length >= 50
      )
        throw new AppError(
          "Keep up to 50 private starters. Remove an unused starter first.",
          409,
        );
      const bytes = Buffer.byteLength(serialized),
        templateId = randomUUID();
      await transaction([
        await usageStep(owner, "storage", bytes),
        {
          sql: "INSERT INTO templates VALUES(?,?,?,?,?,?,?)",
          parameters: [
            templateId,
            actor,
            owner,
            await ownerRedact(owner, input.name),
            serialized,
            bytes,
            new Date().toISOString(),
          ],
        },
      ]);
      await record(
        owner,
        `Created a reviewed private starter from ${p.name}`,
        "template",
        id,
      );
      return json({ template: { id: templateId, name: input.name } }, 201);
    }
  }
  throw new AppError("Method not allowed.", 405);
}
