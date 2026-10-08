import { db, transaction } from "./database";
import { uploadBytes } from "./db";
export async function reconcileStorage(owner: string) {
  const rows = await db()
      .prepare("SELECT id FROM uploads WHERE owner=? AND size IS NULL")
      .all(owner),
    updates = [];
  if (!rows.length) return { measuredFiles: 0 };
  for (const [index, row] of rows.entries())
    updates.push({
      sql: `UPDATE uploads SET size=? WHERE id=? AND owner=? AND size IS NULL${index === 0 ? " RETURNING id" : ""}`,
      parameters: [
        (await uploadBytes(String(row.id), owner)).length,
        String(row.id),
        owner,
      ],
      ...(index === 0
        ? {
            required:
              "Storage was already reconciled. Retry to read the current usage.",
          }
        : {}),
    });
  await transaction([
    ...updates,
    {
      sql: "INSERT INTO usage_counters(owner,kind,period,used) VALUES(?,'storage','all',0) ON CONFLICT(owner,kind,period) DO NOTHING",
      parameters: [owner],
    },
    {
      sql: "UPDATE usage_counters SET used=(SELECT COALESCE(sum(size),0) FROM uploads WHERE owner=?)+(SELECT COALESCE(sum(bytes),0) FROM templates WHERE workspace_id=?)+(SELECT COALESCE(sum(size),0) FROM upload_tickets WHERE owner=?)+(SELECT COALESCE(sum(bytes),0) FROM backups WHERE owner=?) WHERE owner=? AND kind='storage' AND period='all'",
      parameters: [owner, owner, owner, owner, owner],
    },
  ]);
  return { measuredFiles: rows.length };
}
