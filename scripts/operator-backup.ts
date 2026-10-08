import { createLocalBackup, restoreLocalBackup } from "./local-recovery";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

async function main() {
  if (process.env.DATABASE_URL || process.env.VERCEL)
    throw new Error(
      "This tool is for local SQLite. Follow PHASE_FOUR.md for cloud database plus private Storage backups.",
    );
  const [action, file, target] = process.argv.slice(2);
  const passphrase = process.env.CHAPTER_BACKUP_PASSWORD || "";
  if (
    !file ||
    !["create", "restore"].includes(action) ||
    (action === "restore" && !target)
  )
    throw new Error(
      "Usage: npm run backup:local -- create <new-file.chapterbackup> OR restore <file.chapterbackup> <new-directory>",
    );
  if (action === "create") {
    const output = path.resolve(file);
    if (existsSync(output))
      throw new Error("Backup output exists. Choose a new filename.");
    const result = await createLocalBackup(
      process.env.CHAPTER_DATA_DIR || ".data",
      passphrase,
      process.env.CHAPTER_ENCRYPTION_KEY,
    );
    writeFileSync(output, result.bytes, { flag: "wx", mode: 0o600 });
    console.log(
      JSON.stringify({
        action,
        file: output,
        createdAt: result.manifest.createdAt,
        tables: result.manifest.tables,
      }),
    );
  } else {
    if (statSync(file).size > 128 * 1024 * 1024)
      throw new Error("Backup exceeds the 128 MB limit.");
    console.log(
      JSON.stringify({
        action,
        ...(await restoreLocalBackup(readFileSync(file), passphrase, target)),
      }),
    );
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Operator backup failed.",
  );
  process.exitCode = 1;
});
