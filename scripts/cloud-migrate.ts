import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

async function migrate() {
  for (const key of [
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "CHAPTER_ENCRYPTION_KEY",
  ])
    if (!process.env[key])
      throw new Error(`Set ${key} in ignored .env.local first.`);
  const dir = path.resolve(process.env.CHAPTER_DATA_DIR || ".data");
  const source = new DatabaseSync(path.join(dir, "chapter.sqlite"), {
    readOnly: true,
  });
  const tokens = source
    .prepare("SELECT count(*) AS count FROM integrations")
    .get();
  if (
    Number(tokens?.count) &&
    !readFileSync(path.join(dir, "encryption.key")).equals(
      Buffer.from(process.env.CHAPTER_ENCRYPTION_KEY!, "base64"),
    )
  )
    throw new Error(
      "Existing connections need the original .data/encryption.key in CHAPTER_ENCRYPTION_KEY. Export it securely to your environment, or disconnect providers before migrating.",
    );
  const sql = postgres(process.env.DATABASE_URL!, {
    prepare: false,
    max: 1,
    ssl: "require",
    connect_timeout: 15,
  });
  const storage = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  ).storage.from("chapter-files");
  try {
    for (const table of [
      "users",
      "sessions",
      "projects",
      "memories",
      "integrations",
      "activity",
      "attempts",
      "interest",
      "workspaces",
      "members",
      "invitations",
      "comments",
      "versions",
      "templates",
      "subscriptions",
      "billing_events",
      "usage_counters",
      "notification_preferences",
      "notifications",
      "jobs",
      "connection_state",
      "import_batches",
      "external_links",
      "automation_rules",
      "automation_runs",
      "review_links",
      "review_access",
      "review_feedback",
      "account_verifications",
      "public_portfolios",
      "recovery_runs",
      "support_requests",
      "resume_sessions",
      "developer_tokens",
      "development_captures",
      "action_proposals",
      "attention_states",
      "product_feedback",
      "feedback_updates",
      "product_events",
    ]) {
      if (
        !source
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table)
      )
        continue;
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const columns = Object.keys(row),
          values = Object.values(row);
        await sql.unsafe(
          `INSERT INTO chapter.${table}(${columns.join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT DO NOTHING`,
          values as never[],
        );
      }
      console.log(`Migrated ${rows.length} ${table} records.`);
    }
    const uploads = source.prepare("SELECT * FROM uploads").all();
    for (const row of uploads) {
      const exists =
        await sql`SELECT id FROM chapter.uploads WHERE id=${String(row.id)}`;
      if (exists.length) continue;
      if (!row.data)
        throw new Error(
          "This migration supports local SQLite file blobs only.",
        );
      const objectName = `${row.owner}/${row.project_id || "feedback"}/${row.id}`;
      const { error } = await storage.upload(
        objectName,
        Buffer.from(row.data as Uint8Array),
        { contentType: String(row.type), upsert: false },
      );
      if (error && error.message !== "The resource already exists")
        throw new Error(
          "A private file upload failed. Fix storage setup, then run migration again.",
        );
      await sql`INSERT INTO chapter.uploads(id,owner,project_id,name,kind,type,data,object_name,size) VALUES(${String(row.id)},${String(row.owner)},${row.project_id ? String(row.project_id) : null},${String(row.name)},${String(row.kind)},${String(row.type)},null,${objectName},${(row.data as Uint8Array).byteLength})`;
    }
    if (
      source
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='backups'",
        )
        .get()
    )
      for (const row of source.prepare("SELECT * FROM backups").all()) {
        if (
          (
            await sql.unsafe("SELECT id FROM chapter.backups WHERE id=$1", [
              String(row.id),
            ])
          ).length
        )
          continue;
        if (!row.data)
          throw new Error(
            "A backup references unavailable cloud data. Copy provider objects separately before migrating.",
          );
        const objectName =
          String(row.owner) + "/backups/" + String(row.id) + ".zip";
        const { error } = await storage.upload(
          objectName,
          Buffer.from(row.data as Uint8Array),
          { contentType: "application/zip", upsert: false },
        );
        if (error && error.message !== "The resource already exists")
          throw new Error(
            "A private backup upload failed. Fix storage setup, then retry migration.",
          );
        await sql.unsafe(
          "INSERT INTO chapter.backups(id,owner,actor,project_ids,manifest,data,object_name,bytes,at) VALUES($1,$2,$3,$4,$5,null,$6,$7,$8) ON CONFLICT DO NOTHING",
          [
            row.id,
            row.owner,
            row.actor,
            row.project_ids,
            row.manifest,
            objectName,
            row.bytes,
            row.at,
          ] as never[],
        );
      }
    console.log(
      `Migrated ${uploads.length} private files. Local data remains intact; project IDs and share links are preserved.`,
    );
    // Phase Six references immutable uploads, so migrate it after file records.
    for (const table of [
      "preservation_bundles",
      "bundle_checks",
      "project_recreations",
      "transfer_uploads",
      "transfer_chunks",
      "package_links",
      "package_transfers",
      "shared_services",
      "service_dependencies",
    ]) {
      if (
        !source
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table)
      )
        continue;
      for (const original of source.prepare(`SELECT * FROM ${table}`).all()) {
        const row = { ...original };
        if (table === "transfer_chunks" && row.data) {
          const ticket = source
            .prepare("SELECT owner,project_id FROM transfer_uploads WHERE id=?")
            .get(row.upload_id);
          if (!ticket)
            throw new Error("Staging chunk has no owning upload session.");
          const objectName = `${ticket.owner}/${ticket.project_id}/staging/${row.upload_id}/${row.part}-migrated`;
          const result = await storage.upload(
            objectName,
            Buffer.from(row.data as Uint8Array),
            { contentType: "application/octet-stream", upsert: false },
          );
          if (
            result.error &&
            result.error.message !== "The resource already exists"
          )
            throw new Error(
              "Encrypted staging transfer could not be migrated. Retry after checking private storage.",
            );
          row.data = null;
          row.object_name = objectName;
        }
        const columns = Object.keys(row);
        await sql.unsafe(
          `INSERT INTO chapter.${table}(${columns.join(",")}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT DO NOTHING`,
          Object.values(row) as never[],
        );
      }
    }
  } finally {
    source.close();
    await sql.end();
  }
}
migrate().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed.");
  process.exitCode = 1;
});
