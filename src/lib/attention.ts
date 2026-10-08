import { db } from "./database";
import { getProjects } from "./db";
import { preferences } from "./notifications";
import { hash } from "./security";
export type AttentionItem = {
  key: string;
  projectId: string;
  projectName: string;
  kind: string;
  reason: string;
  nextStep: string;
  at: string;
  count: number;
  fingerprint: string;
  state: string;
  snoozedUntil?: string;
};
export async function attentionInbox(actor: string, owner: string) {
  const projects = (await getProjects(actor)).filter(
      (p) => p.workspaceOwner === owner,
    ),
    pref = await preferences(actor),
    items: AttentionItem[] = [];
  function add(
    p: (typeof projects)[number],
    kind: string,
    reason: string,
    nextStep: string,
    at: string,
    count = 1,
    event = reason,
  ) {
    items.push({
      key: p.id + ":" + kind,
      projectId: p.id,
      projectName: p.name,
      kind,
      reason,
      nextStep,
      at,
      count,
      fingerprint: hash(event),
      state: "open",
    });
  }
  for (const p of projects) {
    if (p.status === "Archived") continue;
    if (
      pref.deployment &&
      ["failed", "error", "canceled"].includes(p.deploymentState.toLowerCase())
    )
      add(
        p,
        "deployment",
        "Provider recorded deployment status: " + p.deploymentState,
        "Review deployment status in Hosting & readiness.",
        p.sync?.deployment?.checkedAt || p.updatedAt,
        1,
        p.deploymentId + ":" + p.deploymentState,
      );
    if (pref.blocker && (p.blockers || p.memory?.issues))
      add(
        p,
        "blocker",
        "Unresolved blockers are recorded in project memory.",
        "Review blockers in a guided session and confirm which remain.",
        p.memory?.savedAt || p.updatedAt,
        1,
        p.blockers || p.memory?.issues,
      );
    const date = p.memory?.returnDate;
    if (
      pref.return &&
      p.status === "Parked" &&
      date &&
      Date.parse(date) <= Date.now() + 7 * 86400000
    )
      add(
        p,
        "return",
        "Planned return date: " + date,
        "Review readiness, then choose a session and available time.",
        p.memory?.savedAt || p.updatedAt,
        1,
        date,
      );
    if (pref.integration && p.sync?.error && p.role === "Owner")
      add(
        p,
        "integration",
        "The last project synchronization failed.",
        "Open Sync to review the failure, reconnect or retry.",
        p.sync.attemptedAt,
        1,
        p.sync.attemptedAt,
      );
    if (pref.enquiry && p.role === "Owner") {
      const r = await db()
        .prepare(
          "SELECT count(*) AS count,max(at) AS at FROM interest WHERE project_id=? AND kind='enquiry'",
        )
        .get(p.id);
      if (Number(r?.count))
        add(
          p,
          "enquiry",
          "This project has " + r.count + " recorded enquiries.",
          "Review enquiries in Interest before replying.",
          String(r.at),
          Number(r.count),
          String(r.count) + ":" + r.at,
        );
    }
  }
  if (pref.integration && projects.some((p) => p.role === "Owner")) {
    const rows = await db()
      .prepare("SELECT provider,data FROM connection_state WHERE owner=?")
      .all(owner);
    for (const r of rows) {
      const c = JSON.parse(String(r.data));
      if (!c.error) continue;
      items.push({
        key: "workspace:" + owner + ":" + r.provider,
        projectId: "",
        projectName: String(r.provider) + " connection",
        kind: "integration",
        reason: "Account discovery or connection failed.",
        nextStep: "Open Integrations, review setup and reconnect.",
        at: c.lastAttempt || "",
        count: 1,
        fingerprint: hash(c.lastAttempt + ":" + c.error),
        state: "open",
      });
    }
  }
  const states = await db()
    .prepare("SELECT item_key,data FROM attention_states WHERE actor=?")
    .all(actor);
  for (const i of items) {
    const stored = states.find((r) => r.item_key === i.key);
    if (!stored) continue;
    const s = JSON.parse(String(stored.data));
    if (s.disabled) i.state = "disabled";
    else if (s.snoozedUntil && Date.parse(s.snoozedUntil) > Date.now()) {
      i.state = "snoozed";
      i.snoozedUntil = s.snoozedUntil;
    } else if (s.resolved === i.fingerprint) i.state = "resolved";
  }
  return {
    items: items.sort((a, b) => b.at.localeCompare(a.at)),
    updatedAt: new Date().toISOString(),
    explanation:
      "Repeated events are grouped by project and issue type. Resolve acknowledges this saved event; a changed blocker, new enquiry or new failure appears again. Snoozing and disabling affect your inbox only.",
  };
}
