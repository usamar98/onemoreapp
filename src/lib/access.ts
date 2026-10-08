import { db } from "./database";
import { AppError } from "./security";
import { normalizeProject, type Project } from "./types";
import { recordContext } from "./request-context";
export type Role = "Owner" | "Editor" | "Viewer";
export type Capability = "read" | "comment" | "edit" | "control";
export function permits(role: Role, action: Capability) {
  return (
    action === "read" ||
    action === "comment" ||
    role === "Owner" ||
    (role === "Editor" && action === "edit")
  );
}
export async function ensureWorkspace(owner: string) {
  await db()
    .prepare(
      "INSERT INTO workspaces(id,name) SELECT id,name || '’s workspace' FROM users WHERE id=? ON CONFLICT(id) DO NOTHING",
    )
    .run(owner);
}
export async function workspaceRole(owner: string, actor: string) {
  if (owner === actor)
    return { role: "Owner" as Role, scope: null as string[] | null };
  const m = await db()
    .prepare(
      "SELECT role,scope FROM members WHERE workspace_id=? AND user_id=?",
    )
    .get(owner, actor);
  if (!m) throw new AppError("Workspace not found.", 404);
  return {
    role: String(m.role) as Role,
    scope: m.scope ? (JSON.parse(String(m.scope)) as string[]) : null,
  };
}
export async function projectAccess(
  id: string,
  actor: string,
  capability: Capability = "read",
) {
  const row = await db()
    .prepare("SELECT owner,data FROM projects WHERE id=?")
    .get(id);
  if (!row) throw new AppError("Project not found in your workspace.", 404);
  const owner = String(row.owner);
  const access = await workspaceRole(owner, actor);
  if (access.scope && !access.scope.includes(id))
    throw new AppError("Project not found in your workspace.", 404);
  if (!permits(access.role, capability))
    throw new AppError(
      `${access.role} access does not permit this action. Ask an Owner.`,
      403,
    );
  const project = normalizeProject(JSON.parse(String(row.data)) as Project);
  const records = recordContext.getStore();
  if (records && !records.has(id)) records.set(id, String(row.data));
  return { owner, role: access.role, project, previousData: String(row.data) };
}
export async function workspaceAdmin(
  owner: string,
  actor: string,
  billing = false,
) {
  await ensureWorkspace(owner);
  const a = await workspaceRole(owner, actor);
  if (a.role !== "Owner" || a.scope !== null || (billing && owner !== actor))
    throw new AppError(
      billing
        ? "Only the workspace billing owner can manage this subscription."
        : "Only a workspace Owner can manage collaborators.",
      403,
    );
}
export async function accessibleRows(actor: string) {
  const rows = await db()
    .prepare(
      "SELECT p.owner,p.data,m.role,m.scope FROM projects p LEFT JOIN members m ON m.workspace_id=p.owner AND m.user_id=? WHERE p.owner=? OR m.user_id=?",
    )
    .all(actor, actor, actor);
  return rows.filter(
    (r) =>
      r.owner === actor ||
      !r.scope ||
      (JSON.parse(String(r.scope)) as string[]).includes(
        JSON.parse(String(r.data)).id,
      ),
  );
}
export async function workspaceList(actor: string) {
  await ensureWorkspace(actor);
  return (
    await db()
      .prepare(
        "SELECT w.id,w.name,m.role,m.scope FROM workspaces w LEFT JOIN members m ON m.workspace_id=w.id AND m.user_id=? WHERE w.id=? OR m.user_id=?",
      )
      .all(actor, actor, actor)
  ).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    role: r.id === actor ? "Owner" : String(r.role),
    scope: r.scope ? JSON.parse(String(r.scope)) : null,
  }));
}
