import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction } from "./database";
import { accessibleRows, projectAccess, workspaceRole } from "./access";
import { AppError, hash } from "./security";
import { accountSecrets, record } from "./db";
import { handoverText } from "./phase-two";
import type { Project } from "./types";

export const serviceOptions = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["Hosting", "Database", "API", "Domain", "Storage", "Other"]),
  notes: z.string().max(4000).default(""),
  projects: z.array(z.string().max(100)).min(1).max(100),
  origin: z.enum(["Manual", "Unknown"]).default("Manual"),
});
export async function dependencyMap(actor: string, owner: string) {
  await workspaceRole(owner, actor);
  const projects = (await accessibleRows(actor))
      .filter((p) => p.owner === owner)
      .map((p) => JSON.parse(String(p.data)) as Project),
    ids = new Set(projects.map((p) => p.id));
  const services = await db()
      .prepare("SELECT * FROM shared_services WHERE owner=? ORDER BY name")
      .all(owner),
    result = [];
  for (const s of services) {
    const links = await db()
      .prepare(
        "SELECT project_id,origin,evidence,at FROM service_dependencies WHERE service_id=?",
      )
      .all(String(s.id));
    const visible = links.filter((l) => ids.has(String(l.project_id)));
    if (!visible.length) continue;
    result.push({
      id: String(s.id),
      name: String(s.name),
      kind: String(s.kind),
      data: JSON.parse(String(s.data)),
      at: String(s.at),
      relationships: visible.map((l) => ({
        projectId: String(l.project_id),
        projectName:
          projects.find((p) => p.id === l.project_id)?.name || "Project",
        origin: String(l.origin),
        evidence: String(l.evidence),
        at: String(l.at),
      })),
      restricted: visible.length !== links.length,
    });
  }
  return {
    services: result,
    projects: projects.map((p) => ({ id: p.id, name: p.name, role: p.role })),
    limitation:
      "Environment names do not prove a shared service. Only exact connected Vercel project IDs are imported as evidence; database, API, domain and storage relationships require owner documentation.",
  };
}
export async function addService(actor: string, owner: string, raw: unknown) {
  const input = serviceOptions.parse(raw),
    secrets = await accountSecrets(owner);
  if (new Set(input.projects).size !== input.projects.length)
    throw new AppError("Select each project once.");
  for (const id of input.projects) {
    const a = await projectAccess(id, actor, "control");
    if (a.owner !== owner)
      throw new AppError("Select projects in this workspace.", 403);
  }
  const id = randomUUID(),
    at = new Date().toISOString(),
    clean = (v: string) => handoverText(v, secrets);
  await transaction([
    {
      sql: "INSERT INTO shared_services VALUES(?,?,?,?,?,?)",
      parameters: [
        id,
        owner,
        clean(input.name),
        input.kind,
        JSON.stringify({
          notes: clean(input.notes),
          provider: "",
          providerId: "",
          teamId: "",
        }),
        at,
      ],
    },
    ...input.projects.map((p) => ({
      sql: "INSERT INTO service_dependencies VALUES(?,?,?,?,?)",
      parameters: [
        id,
        p,
        input.origin,
        input.origin === "Unknown"
          ? "Owner recorded a possible relationship; not verified."
          : "Owner documented this dependency; integration has not verified it.",
        at,
      ],
    })),
  ]);
  for (const p of input.projects)
    await record(
      owner,
      `Documented ${clean(input.name)} dependency (${input.origin})`,
      "dependency",
      p,
    );
  return id;
}
export async function importHostingDependencies(actor: string, owner: string) {
  const a = await workspaceRole(owner, actor);
  if (a.role !== "Owner" || a.scope)
    throw new AppError(
      "A full workspace Owner must import shared hosting relationships.",
      403,
    );
  const rows = await db()
      .prepare("SELECT id,data FROM projects WHERE owner=?")
      .all(owner),
    at = new Date().toISOString();
  let count = 0;
  for (const row of rows) {
    const p = JSON.parse(String(row.data)) as Project;
    // A previously synchronized provider ID is reliable metadata, not a guess based on names.
    if (
      p.hostingProvider !== "vercel" ||
      !p.hostingProjectId ||
      !p.sync?.deployment?.checkedAt
    )
      continue;
    const id = hash(`${owner}:vercel:${p.hostingTeamId}:${p.hostingProjectId}`);
    await transaction([
      {
        sql: "INSERT INTO shared_services VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,at=excluded.at",
        parameters: [
          id,
          owner,
          `Vercel ${p.hostingProjectId}`,
          "Hosting",
          JSON.stringify({
            notes:
              "Connected hosting identity; synchronize again to refresh evidence.",
            provider: "vercel",
            providerId: p.hostingProjectId,
            teamId: p.hostingTeamId || "",
          }),
          at,
        ],
      },
      {
        sql: "INSERT INTO service_dependencies VALUES(?,?,?,?,?) ON CONFLICT(service_id,project_id) DO UPDATE SET origin=excluded.origin,evidence=excluded.evidence,at=excluded.at",
        parameters: [
          id,
          p.id,
          "Connected",
          `Vercel project ID ${p.hostingProjectId}; provider last checked ${p.sync.deployment.checkedAt}`,
          at,
        ],
      },
    ]);
    count++;
  }
  return {
    imported: count,
    detail: count
      ? "Imported exact synchronized Vercel hosting identities. Other service relationships were not inferred."
      : "No synchronized Vercel identities are available. Run Sync first, or document relationships manually.",
  };
}
export async function removeService(actor: string, id: string) {
  const s = await db()
    .prepare("SELECT owner FROM shared_services WHERE id=?")
    .get(id);
  if (!s) throw new AppError("Service not found.", 404);
  const links = await db()
    .prepare("SELECT project_id FROM service_dependencies WHERE service_id=?")
    .all(id);
  for (const p of links)
    await projectAccess(String(p.project_id), actor, "control");
  await transaction([
    {
      sql: "DELETE FROM service_dependencies WHERE service_id=?",
      parameters: [id],
    },
    { sql: "DELETE FROM shared_services WHERE id=?", parameters: [id] },
  ]);
}
export async function hostingImpact(project: Project, actor?: string) {
  const ownerRow = await db()
    .prepare("SELECT owner FROM projects WHERE id=?")
    .get(project.id);
  if (!ownerRow) return { detail: [], digest: hash("no-project") };
  const owner = String(ownerRow.owner),
    affected = new Map<string, string>(),
    evidence: unknown[] = [];
  const services = await db()
    .prepare(
      "SELECT s.id,s.name,s.kind,s.data FROM shared_services s JOIN service_dependencies d ON d.service_id=s.id WHERE d.project_id=?",
    )
    .all(project.id);
  for (const s of services) {
    const data = JSON.parse(String(s.data));
    // Only hosting services tied to this identity can stop when this Vercel project is paused.
    if (
      s.kind !== "Hosting" ||
      (data.providerId &&
        (data.providerId !== project.hostingProjectId ||
          (data.teamId || "") !== (project.hostingTeamId || "")))
    )
      continue;
    const links = await db()
      .prepare(
        "SELECT d.project_id,d.origin,p.data FROM service_dependencies d JOIN projects p ON p.id=d.project_id WHERE d.service_id=?",
      )
      .all(String(s.id));
    for (const link of links) {
      const p = JSON.parse(String(link.data)) as Project;
      affected.set(
        p.id,
        `${p.name} · ${link.origin} relationship to ${s.name}`,
      );
      evidence.push([s.id, p.id, link.origin]);
    }
  }
  for (const row of await db()
    .prepare("SELECT data FROM projects WHERE owner=?")
    .all(owner)) {
    const p = JSON.parse(String(row.data)) as Project;
    if (
      p.id !== project.id &&
      p.hostingProvider === "vercel" &&
      p.hostingProjectId === project.hostingProjectId &&
      (p.hostingTeamId || "") === (project.hostingTeamId || "")
    ) {
      affected.set(p.id, `${p.name} · same connected Vercel service`);
      evidence.push([p.id, p.hostingProjectId]);
    }
  }
  let restricted = false;
  const detail: string[] = [];
  for (const [id, text] of affected) {
    try {
      await projectAccess(id, actor || owner);
      detail.push(text);
    } catch {
      restricted = true;
    }
  }
  if (restricted)
    detail.push(
      "Additional projects outside your access scope may be affected. Ask a full workspace Owner to review the service.",
    );
  detail.push(
    "Unrecorded dependencies are unknown. External databases, APIs, domains and storage are not paused by this control and may continue charging.",
  );
  return { detail, digest: hash(JSON.stringify(evidence.sort())) };
}
