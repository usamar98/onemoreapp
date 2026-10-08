import { db, transaction } from "./database";
import { removeObject } from "./storage";
// Only used when a newly created import fails before it is returned to the owner.
export async function discardNewProject(id: string, owner: string) {
  const uploads = await db()
    .prepare(
      "SELECT object_name,size FROM uploads WHERE project_id=? AND owner=?",
    )
    .all(id, owner);
  await transaction([
    { sql: "DELETE FROM versions WHERE project_id=?", parameters: [id] },
    { sql: "DELETE FROM memories WHERE project_id=?", parameters: [id] },
    {
      sql: "DELETE FROM external_links WHERE project_id=? AND owner=?",
      parameters: [id, owner],
    },
    {
      sql: "DELETE FROM uploads WHERE project_id=? AND owner=?",
      parameters: [id, owner],
    },
    {
      sql: "DELETE FROM projects WHERE id=? AND owner=? RETURNING id",
      parameters: [id, owner],
      required:
        "Failed import could not be cleared. Retry after checking storage.",
    },
    {
      sql: "UPDATE usage_counters SET used=CASE WHEN used>0 THEN used-1 ELSE 0 END WHERE owner=? AND kind='projects' AND period='all'",
      parameters: [owner],
    },
    {
      sql: "UPDATE usage_counters SET used=CASE WHEN used>=? THEN used-? ELSE 0 END WHERE owner=? AND kind='storage' AND period='all'",
      parameters: [
        uploads.reduce((n, u) => n + Number(u.size || 0), 0),
        uploads.reduce((n, u) => n + Number(u.size || 0), 0),
        owner,
      ],
    },
  ]);
  for (const u of uploads)
    if (u.object_name) {
      try {
        await removeObject(String(u.object_name));
      } catch {
        /* File is unreferenced and cannot receive a download URL. */
      }
    }
}
