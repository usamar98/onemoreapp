import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { AppError, dataDir } from "./security";
import { phaseThreeSchema } from "./phase-three-schema";
import { phaseFourSchema } from "./phase-four-schema";
import { phaseFiveSchema } from "./phase-five-schema";
import { phaseSixSchema } from "./phase-six-schema";
import { secureSchema } from "./secure-schema";

export type Row = Record<string, string | number | Uint8Array | null>;
type Parameter = string | number | Uint8Array | null;
let sqlite: DatabaseSync | undefined;
let remote: ReturnType<typeof postgres> | undefined;
export const cloudMode = () => !!process.env.DATABASE_URL;
function local() {
  if (process.env.VERCEL)
    throw new AppError(
      "Cloud storage is not configured. Follow the Vercel setup instructions in README.md.",
      503,
    );
  if (sqlite) return sqlite;
  mkdirSync(dataDir, { recursive: true });
  sqlite = new DatabaseSync(path.join(dataDir, "chapter.sqlite"));
  sqlite.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, demo INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), share_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), project_id TEXT REFERENCES projects(id), name TEXT, kind TEXT, type TEXT, data BLOB, object_name TEXT);
    CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, owner TEXT, project_id TEXT REFERENCES projects(id), data TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS integrations(owner TEXT REFERENCES users(id), provider TEXT, token TEXT, PRIMARY KEY(owner, provider));
    CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY, owner TEXT, text TEXT, kind TEXT, at TEXT);
    CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY, count INTEGER, reset INTEGER);
    CREATE TABLE IF NOT EXISTS upload_tickets(id TEXT PRIMARY KEY, owner TEXT, project_id TEXT, name TEXT, kind TEXT, object_name TEXT, size INTEGER, expires INTEGER);`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS interest(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), kind TEXT NOT NULL, email TEXT, message TEXT, at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS interest_project_idx ON interest(project_id,kind);`);
  const columns = sqlite.prepare("PRAGMA table_info(uploads)").all();
  if (!columns.some((c) => c.name === "object_name"))
    sqlite.exec("ALTER TABLE uploads ADD COLUMN object_name TEXT");
  if (
    !sqlite
      .prepare("PRAGMA table_info(activity)")
      .all()
      .some((c) => c.name === "project_id")
  )
    sqlite.exec("ALTER TABLE activity ADD COLUMN project_id TEXT");
  sqlite.exec(phaseThreeSchema);
  sqlite.exec(phaseFourSchema);
  sqlite.exec(phaseFiveSchema);
  sqlite.exec(phaseSixSchema);
  sqlite.exec(secureSchema);
  if (
    !sqlite
      .prepare("PRAGMA table_info(uploads)")
      .all()
      .some((c) => c.name === "size")
  ) {
    sqlite.exec("ALTER TABLE uploads ADD COLUMN size BIGINT");
    sqlite.exec("UPDATE uploads SET size=length(data) WHERE data IS NOT NULL");
  }
  return sqlite;
}
function connection() {
  if (!remote)
    remote = postgres(process.env.DATABASE_URL!, {
      prepare: false,
      max: 1,
      ssl: "require",
      idle_timeout: 20,
      connect_timeout: 15,
    });
  return remote;
}
export function postgresQuery(sql: string) {
  let parameter = 0;
  return sql
    .replace(
      /\b(users|sessions|projects|uploads|memories|integrations|activity|attempts|upload_tickets|interest|workspaces|members|invitations|comments|versions|templates|subscriptions|billing_events|usage_counters|notification_preferences|notifications|jobs|connection_state|import_batches|external_links|automation_rules|automation_runs|review_links|review_feedback|public_portfolios|backups|recovery_runs|support_requests|resume_sessions|developer_tokens|development_captures|action_proposals|attention_states|product_feedback|feedback_updates|product_events|preservation_bundles|bundle_checks|project_recreations|transfer_uploads|transfer_chunks|package_links|package_transfers|shared_services|service_dependencies)\b/g,
      "chapter.$1",
    )
    .replace(
      /\b(account_verifications|auth_tokens|mail_deliveries|review_access|review_grants)\b/g,
      "chapter.$1",
    )
    .replace(/\?/g, () => `$${++parameter}`);
}
async function query(sql: string, parameters: Parameter[]) {
  if (cloudMode()) {
    try {
      return (await connection().unsafe(
        postgresQuery(sql),
        parameters as never[],
      )) as unknown as Row[];
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new AppError(
          "This record already exists. Refresh and try again.",
          409,
        );
      throw new AppError(
        "Cloud database is unavailable. Check DATABASE_URL and apply cloud/schema.sql, then try again.",
        503,
      );
    }
  }
  try {
    const statement = local().prepare(sql);
    if (/^\s*SELECT|RETURNING\s+/i.test(sql))
      return statement.all(...parameters) as Row[];
    statement.run(...parameters);
    return [];
  } catch (error) {
    if ([1555, 2067].includes(Number((error as { errcode?: number }).errcode)))
      throw new AppError(
        "This record already exists. Refresh and review before retrying.",
        409,
      );
    throw error;
  }
}
export function db() {
  return {
    prepare(sql: string) {
      return {
        async get(...parameters: Parameter[]) {
          return (await query(sql, parameters))[0];
        },
        async all(...parameters: Parameter[]) {
          return query(sql, parameters);
        },
        async run(...parameters: Parameter[]) {
          await query(sql, parameters);
        },
      };
    },
  };
}
export async function transaction(
  statements: { sql: string; parameters: Parameter[]; required?: string }[],
) {
  if (cloudMode()) {
    await connection().begin(async (tx) => {
      for (const s of statements) {
        const result = await tx.unsafe(
          postgresQuery(s.sql),
          s.parameters as never[],
        );
        if (s.required && !result.length) throw new AppError(s.required, 409);
      }
    });
    return;
  }
  const localDatabase = local();
  localDatabase.exec("BEGIN");
  try {
    for (const s of statements) {
      if (s.required) {
        if (!localDatabase.prepare(s.sql).get(...s.parameters))
          throw new AppError(s.required, 409);
      } else localDatabase.prepare(s.sql).run(...s.parameters);
    }
    localDatabase.exec("COMMIT");
  } catch (error) {
    localDatabase.exec("ROLLBACK");
    if ([1555, 2067].includes(Number((error as { errcode?: number }).errcode)))
      throw new AppError(
        "This record already exists. Refresh and review before retrying.",
        409,
      );
    throw error;
  }
}
