import { randomUUID } from "node:crypto";
import { db } from "./database";
import { workspaceAdmin } from "./access";
import { AppError } from "./security";
export const actions = [
  "import",
  "share",
  "park",
  "resume_session",
  "handover",
  "capture",
] as const;
export type ProductAction = (typeof actions)[number];
export function metricStep(
  actor: string,
  owner: string,
  projectId: string,
  action: ProductAction,
  outcome: "completed" | "failed",
  id: string = randomUUID(),
) {
  return {
    sql: "INSERT INTO product_events VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
    parameters: [
      id,
      actor,
      owner,
      projectId,
      action,
      outcome,
      new Date().toISOString(),
    ],
  };
}
export async function productEvent(
  actor: string,
  owner: string,
  projectId: string,
  action: ProductAction,
  outcome: "completed" | "failed",
  id?: string,
) {
  const s = metricStep(actor, owner, projectId, action, outcome, id);
  await db()
    .prepare(s.sql)
    .run(...s.parameters);
}
export async function isPlatformAdmin(actor: string) {
  // IDs are configured by the operator after registration; email alone is not verified by local auth.
  return (process.env.CHAPTER_ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(actor);
}
export async function requirePlatformAdmin(actor: string) {
  if (!(await isPlatformAdmin(actor)))
    throw new AppError("Platform administrator access required.", 403);
}
export async function insights(actor: string, owner?: string) {
  if (owner) await workspaceAdmin(owner, actor);
  else await requirePlatformAdmin(actor);
  const rows = await db()
    .prepare(
      "SELECT actor,project_id,action,outcome,at FROM product_events" +
        (owner ? " WHERE owner=?" : "") +
        " ORDER BY at",
    )
    .all(...(owner ? [owner] : []));
  const completed = rows.filter((r) => r.outcome === "completed");
  const counts = actions.map((action) => ({
    action,
    completed: completed.filter((r) => r.action === action).length,
    failed: rows.filter((r) => r.action === action && r.outcome === "failed")
      .length,
  }));
  const imported = new Set(
    completed.filter((r) => r.action === "import").map((r) => r.actor),
  );
  const shared = new Set(
    completed.filter((r) => r.action === "share").map((r) => r.actor),
  );
  const countsByActor = new Map<string, number>();
  for (const r of completed)
    countsByActor.set(
      String(r.actor),
      (countsByActor.get(String(r.actor)) || 0) + 1,
    );
  const daysByActor = new Map<string, Set<string>>();
  for (const r of completed) {
    const id = String(r.actor),
      days = daysByActor.get(id) || new Set<string>();
    days.add(String(r.at).slice(0, 10));
    daysByActor.set(id, days);
  }
  return {
    counts,
    importingUsers: imported.size,
    importersWithShare: [...imported].filter((id) => shared.has(id)).length,
    importersWithoutShare: [...imported].filter((id) => !shared.has(id)).length,
    repeatUsers: [...daysByActor.values()].filter((days) => days.size > 1)
      .length,
    activeUsers: countsByActor.size,
    measuredSince: rows[0]?.at || null,
    updatedAt: new Date().toISOString(),
    source:
      "product_events: completed server actions and failed attempts, recorded since Phase Five only",
    definition:
      "Import-to-share drop-off counts users with a successful import and no recorded successful share. Repeat usage means completed actions on two or more UTC days. A share is counted once per project. No source files, notes, enquiry text, or revenue predictions are collected.",
  };
}
