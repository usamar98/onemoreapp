import { randomUUID } from "node:crypto";
import { db, transaction } from "./database";
import { AppError, hash } from "./security";
import { projectAccess } from "./access";
import { notesBrief } from "./brief";
import { ownerRedact, record } from "./db";
import { storedRecords, versionSteps } from "./versions";
import { notify } from "./notifications";
import { syncEvent } from "./connections";
import type { Project } from "./types";
export const ruleKinds = ["return", "inactivity", "brief"] as const;
export type RuleKind = (typeof ruleKinds)[number];
export function notesFingerprint(p: Project) {
  return hash(JSON.stringify(storedRecords(p).notes));
}
export async function rulePreview(
  p: Project,
  kind: RuleKind,
  days: number,
  baseline = "",
) {
  if (kind === "brief") {
    const revision = await db()
      .prepare(
        "SELECT count(*) AS count FROM versions WHERE project_id=? AND kind='notes'",
      )
      .get(p.id);
    return {
      ready: !baseline || notesFingerprint(p) !== baseline,
      eventKey: notesFingerprint(p) + ":" + Number(revision?.count || 0),
      detail:
        "Refresh the saved-notes brief after notes change. This replaces the editable brief with recorded context, saves a version, and uses no paid AI request.",
      brief: notesBrief(p),
    };
  }
  if (kind === "return")
    return {
      ready:
        p.status === "Parked" &&
        !!p.memory?.returnDate &&
        p.memory.returnDate <= new Date().toISOString().slice(0, 10),
      eventKey: `return:${p.memory?.returnDate || "missing"}`,
      detail: p.memory?.returnDate
        ? `Send an in-app reminder on or after ${p.memory.returnDate} (UTC date), while this project is parked.`
        : "Save a return date when parking this project first.",
      brief: "",
    };
  const activity = await db()
    .prepare(
      "SELECT at FROM activity WHERE project_id=? AND kind NOT IN ('sync','automation','check','deploy') ORDER BY at DESC LIMIT 1",
    )
    .get(p.id);
  const since = String(activity?.at || p.createdAt);
  return {
    ready:
      p.status !== "Archived" &&
      Date.now() - new Date(since).getTime() >= days * 86400000,
    eventKey: `inactive:${days}:${since}`,
    detail: `Flag after ${days} days without recorded work. Last recorded work: ${since}. Syncs and automated checks do not reset this clock. Work outside Chapter may not be recorded.`,
    brief: "",
  };
}
export async function queueRule(id: string) {
  const row = await db()
    .prepare("SELECT * FROM automation_rules WHERE id=? AND enabled=1")
    .get(id);
  if (!row) return null;
  const a = await projectAccess(
    String(row.project_id),
    String(row.actor),
    "control",
  );
  const config = JSON.parse(String(row.data)),
    preview = await rulePreview(
      a.project,
      String(row.kind) as RuleKind,
      config.days || 30,
      config.baseline || "",
    );
  if (!preview.ready) return null;
  const runId = `rule:${hash(`${id}:${preview.eventKey}`)}`,
    jobId = runId,
    at = new Date().toISOString();
  try {
    await transaction([
      {
        sql: "INSERT INTO automation_runs VALUES(?,?,?,?,?,?,?,?)",
        parameters: [
          runId,
          id,
          preview.eventKey,
          jobId,
          "queued",
          preview.detail,
          at,
          null,
        ],
      },
      {
        sql: "INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        parameters: [
          jobId,
          row.actor,
          row.owner,
          "automation",
          "queued",
          JSON.stringify({
            ruleId: id,
            runId,
            eventKey: preview.eventKey,
            projectId: row.project_id,
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
    ]);
  } catch (e) {
    if (
      !(await db()
        .prepare("SELECT id FROM automation_runs WHERE id=?")
        .get(runId))
    )
      throw e;
  }
  return jobId;
}
export async function executeRule(
  actor: string,
  input: { ruleId: string; runId: string; eventKey: string; projectId: string },
) {
  const row = await db()
    .prepare("SELECT * FROM automation_rules WHERE id=? AND actor=?")
    .get(input.ruleId, actor);
  const run = await db()
    .prepare("SELECT state FROM automation_runs WHERE id=? AND rule_id=?")
    .get(input.runId, input.ruleId);
  if (!row || !run) throw new AppError("Automation no longer exists.", 404);
  if (["succeeded", "skipped"].includes(String(run.state)))
    return { message: "This event was already handled." };
  const access = await projectAccess(String(row.project_id), actor, "control"),
    p = access.project;
  const config = JSON.parse(String(row.data));
  const preview = await rulePreview(
    p,
    String(row.kind) as RuleKind,
    config.days || 30,
    config.baseline || "",
  );
  if (!row.enabled || !preview.ready || preview.eventKey !== input.eventKey) {
    await db()
      .prepare(
        "UPDATE automation_runs SET state='skipped',detail=?,finished_at=? WHERE id=?",
      )
      .run(
        "Rule was switched off or its recorded trigger changed. No action taken.",
        new Date().toISOString(),
        input.runId,
      );
    return { message: "Rule off or trigger changed; skipped." };
  }
  const before = structuredClone(p),
    steps = [],
    at = new Date().toISOString();
  if (row.kind === "brief") {
    p.brief = await ownerRedact(access.owner, notesBrief(p));
    p.briefKind = "Saved notes · automation";
    steps.push({
      sql: "UPDATE automation_rules SET data=? WHERE id=? AND data=? AND enabled=1 RETURNING id",
      parameters: [
        JSON.stringify({ ...config, baseline: notesFingerprint(p) }),
        input.ruleId,
        String(row.data),
      ],
      required:
        "The rule changed or was disabled. Retry with the current settings.",
    });
  } else if (row.kind === "inactivity")
    p.inactivityFlag = { at, detail: preview.detail };
  else
    await notify(
      actor,
      p.id,
      "return",
      `${p.name}: planned return ${p.memory?.returnDate}. Review saved context.`,
      `return:${p.id}:${p.memory?.returnDate}`,
    );
  if (row.kind !== "return") {
    p.updatedAt = at;
    steps.push(
      {
        sql: "UPDATE projects SET data=? WHERE id=? AND owner=? AND data=? RETURNING id",
        parameters: [
          JSON.stringify(p),
          p.id,
          access.owner,
          access.previousData,
        ],
        required:
          "Project notes changed during automation. Retry with current context.",
      },
      ...(await versionSteps(before, p, access.owner)),
    );
  }
  steps.push({
    sql: "UPDATE automation_runs SET state='succeeded',finished_at=? WHERE id=?",
    parameters: [at, input.runId],
  });
  await transaction(steps);
  await record(
    access.owner,
    `Automation: ${row.kind === "brief" ? "refreshed saved-notes brief" : row.kind === "return" ? "return reminder handled" : "flagged recorded inactivity"} for ${p.name}`,
    "automation",
    p.id,
  );
  return { projectId: p.id, message: preview.detail };
}
export async function schedulePhaseFour(actor?: string) {
  const rules = await db()
    .prepare(
      actor
        ? "SELECT id FROM automation_rules WHERE enabled=1 AND actor=? ORDER BY at"
        : "SELECT id FROM automation_rules WHERE enabled=1 ORDER BY at",
    )
    .all(...(actor ? [actor] : []));
  for (const row of rules) {
    try {
      await queueRule(String(row.id));
    } catch (e) {
      if (!(e instanceof AppError && [403, 404].includes(e.status))) throw e;
    }
  }
  const rows = await db()
    .prepare(
      actor
        ? "SELECT owner,data FROM projects WHERE owner=?"
        : "SELECT owner,data FROM projects",
    )
    .all(...(actor ? [actor] : []));
  for (const row of rows) {
    const p = JSON.parse(String(row.data)) as Project;
    if (!p.syncEnabled || (!p.repository && !p.hostingProjectId)) continue;
    if (
      p.sync?.attemptedAt &&
      Date.now() - Date.parse(p.sync.attemptedAt) < 6 * 60 * 60 * 1000
    )
      continue;
    const jobId = `sync:${syncEvent(p, Date.now())}`,
      at = new Date().toISOString();
    await db()
      .prepare(
        "INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      )
      .run(
        jobId,
        row.owner,
        row.owner,
        "sync",
        "queued",
        JSON.stringify({ projectId: p.id, scheduled: true }),
        null,
        null,
        0,
        Date.now(),
        0,
        at,
        at,
      );
  }
}
export function newRuleId() {
  return randomUUID();
}
