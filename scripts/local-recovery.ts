import { backup, DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { z } from "zod";

const MAGIC = Buffer.from("CHAPTEROP1");
const MAX = 128 * 1024 * 1024;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function password(value: string) {
  if (value.length < 20)
    throw new Error(
      "Set CHAPTER_BACKUP_PASSWORD to a private passphrase of at least 20 characters.",
    );
  return value;
}
function counts(database: DatabaseSync) {
  return Object.fromEntries(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => {
        const name = String(row.name);
        const count = database
          .prepare(
            'SELECT count(*) AS n FROM "' + name.replaceAll('"', '""') + '"',
          )
          .get();
        return [name, Number(count?.n)];
      }),
  );
}
function integrity(database: DatabaseSync) {
  const result = database.prepare("PRAGMA integrity_check").all();
  if (result.length !== 1 || Object.values(result[0])[0] !== "ok")
    throw new Error(
      "SQLite integrity check failed. The live database has not been changed.",
    );
}
export async function createLocalBackup(
  sourceDir: string,
  passphrase: string,
  configuredKey = "",
) {
  password(passphrase);
  const source = path.resolve(sourceDir);
  const sourceFile = path.join(source, "chapter.sqlite");
  if (!existsSync(sourceFile))
    throw new Error(
      "No local Chapter database exists at the chosen data directory.",
    );
  const temporary = mkdtempSync(path.join(source, ".operator-backup-"));
  const snapshotFile = path.join(temporary, "chapter.sqlite");
  const database = new DatabaseSync(sourceFile, { readOnly: true });
  let snapshot: DatabaseSync | undefined;
  try {
    await backup(database, snapshotFile);
    snapshot = new DatabaseSync(snapshotFile, { readOnly: true });
    integrity(snapshot);
    for (const table of ["uploads", "backups"])
      if (
        snapshot
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table) &&
        snapshot
          .prepare(
            'SELECT id FROM "' +
              table +
              '" WHERE object_name IS NOT NULL LIMIT 1',
          )
          .get()
      )
        throw new Error(
          "This database references cloud objects. Use the documented cloud database and Storage backup procedure.",
        );
    if (statSync(snapshotFile).size > MAX)
      throw new Error(
        "Local database exceeds the 128 MB operator-backup limit.",
      );
    const bytes = readFileSync(snapshotFile);
    const keyFile = path.join(source, "encryption.key");
    const key = configuredKey
      ? Buffer.from(configuredKey, "base64")
      : existsSync(keyFile)
        ? readFileSync(keyFile)
        : null;
    if (key && key.length !== 32)
      throw new Error("The Chapter encryption key must contain 32 bytes.");
    const tables = counts(snapshot);
    if (!key && tables.integrations)
      throw new Error(
        "Encrypted connections exist, but the encryption key is missing.",
      );
    const manifest = {
      format: "chapter-operator-backup-v1",
      createdAt: new Date().toISOString(),
      databaseSha256: sha(bytes),
      keySha256: key ? sha(key) : null,
      tables,
    };
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("chapter.sqlite", bytes);
    if (key) zip.file("encryption.key", key);
    const packed = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    const salt = randomBytes(16),
      iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      scryptSync(passphrase, salt, 32),
      iv,
    );
    const encrypted = Buffer.concat([cipher.update(packed), cipher.final()]);
    return {
      bytes: Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]),
      manifest,
    };
  } finally {
    snapshot?.close();
    database.close();
    if (existsSync(snapshotFile)) unlinkSync(snapshotFile);
    rmdirSync(temporary);
  }
}
const manifestSchema = z.object({
  format: z.literal("chapter-operator-backup-v1"),
  createdAt: z.string(),
  databaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
  keySha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  tables: z.record(z.string(), z.number().int().min(0)),
});
async function inspect(bytes: Buffer, passphrase: string) {
  password(passphrase);
  if (
    bytes.length > MAX ||
    bytes.length < MAGIC.length + 45 ||
    !bytes.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw new Error("Not a supported encrypted Chapter operator backup.");
  const start = MAGIC.length;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    scryptSync(passphrase, bytes.subarray(start, start + 16), 32),
    bytes.subarray(start + 16, start + 28),
  );
  decipher.setAuthTag(bytes.subarray(start + 28, start + 44));
  let packed: Buffer;
  try {
    packed = Buffer.concat([
      decipher.update(bytes.subarray(start + 44)),
      decipher.final(),
    ]);
  } catch {
    throw new Error(
      "Backup authentication failed: the passphrase is wrong or the file was changed.",
    );
  }
  const zip = await JSZip.loadAsync(packed);
  const allowed = new Set([
    "manifest.json",
    "chapter.sqlite",
    "encryption.key",
  ]);
  for (const file of Object.values(zip.files)) {
    const size = (file as unknown as { _data?: { uncompressedSize?: number } })
      ._data?.uncompressedSize;
    if (
      !allowed.has(file.name) ||
      file.dir ||
      !Number.isFinite(size) ||
      Number(size) > MAX
    )
      throw new Error("Unexpected or oversized operator backup contents.");
  }
  const manifestFile = zip.file("manifest.json"),
    databaseFile = zip.file("chapter.sqlite");
  if (!manifestFile || !databaseFile)
    throw new Error("Incomplete operator backup.");
  const manifest = manifestSchema.parse(
    JSON.parse(await manifestFile.async("string")),
  );
  const database = await databaseFile.async("nodebuffer");
  const key = zip.file("encryption.key")
    ? await zip.file("encryption.key")!.async("nodebuffer")
    : null;
  if (
    sha(database) !== manifest.databaseSha256 ||
    (key ? sha(key) : null) !== manifest.keySha256 ||
    (key && key.length !== 32)
  )
    throw new Error("Operator backup checksum mismatch.");
  return { manifest, database, key };
}
export async function restoreLocalBackup(
  bytes: Buffer,
  passphrase: string,
  destination: string,
) {
  const read = await inspect(bytes, passphrase);
  const target = path.resolve(destination);
  // Never overwrite an existing directory or the live platform.
  if (existsSync(target))
    throw new Error(
      "Choose a new recovery directory. Existing directories are never overwritten.",
    );
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const file = path.join(target, "chapter.sqlite");
  writeFileSync(file, read.database, { flag: "wx", mode: 0o600 });
  const database = new DatabaseSync(file);
  try {
    integrity(database);
    const actual = counts(database);
    if (JSON.stringify(actual) !== JSON.stringify(read.manifest.tables))
      throw new Error("Recovered table counts do not match the snapshot.");
    database.exec("BEGIN");
    const has = (table: string) => table in actual;
    if (has("sessions")) database.exec("DELETE FROM sessions");
    if (has("developer_tokens"))
      database.exec("UPDATE developer_tokens SET revoked=1");
    if (has("resume_sessions"))
      database.exec(
        "UPDATE resume_sessions SET state='canceled' WHERE state='active'",
      );
    if (has("jobs"))
      database.exec(
        "UPDATE jobs SET state='failed',lease=0,error='Operator recovery: review and retry deliberately.' WHERE state IN ('queued','running')",
      );
    if (has("automation_rules"))
      database.exec("UPDATE automation_rules SET enabled=0");
    if (has("public_portfolios"))
      database.exec("UPDATE public_portfolios SET published=0");
    if (has("review_links")) database.exec("UPDATE review_links SET revoked=1");
    if (has("projects"))
      for (const row of database
        .prepare("SELECT id,data FROM projects")
        .all()) {
        const p = JSON.parse(String(row.data));
        p.shared = false;
        p.shareFiles = false;
        p.syncEnabled = false;
        database
          .prepare("UPDATE projects SET data=? WHERE id=?")
          .run(JSON.stringify(p), String(row.id));
      }
    database.exec("COMMIT");
    if (read.key)
      writeFileSync(path.join(target, "encryption.key"), read.key, {
        flag: "wx",
        mode: 0o600,
      });
    writeFileSync(
      path.join(target, "recovery-report.json"),
      JSON.stringify(
        {
          format: read.manifest.format,
          backedUpAt: read.manifest.createdAt,
          verifiedTables: actual,
          recoveredAt: new Date().toISOString(),
          quarantine:
            "Sessions invalidated; queued jobs stopped; rules, sync and public pages disabled. Review before enabling.",
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    return {
      directory: target,
      tables: actual,
      backedUpAt: read.manifest.createdAt,
    };
  } catch (error) {
    // Leave failed restores quarantined for operator inspection; never touch the source.
    throw error;
  } finally {
    database.close();
  }
}
