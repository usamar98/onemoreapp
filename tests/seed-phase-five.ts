// Explicit isolated browser-test seed; never runs against an ordinary workspace.
async function main() {
  if (!process.env.CHAPTER_DATA_DIR?.includes("phase-five-browser"))
    throw new Error("Set an isolated phase-five-browser data directory.");
  const { db } = await import("../src/lib/database"),
    { passwordHash } = await import("../src/lib/security");
  const { ensureWorkspace } = await import("../src/lib/access");
  await db()
    .prepare("INSERT INTO users VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
    .run(
      "phase-five-admin",
      "Test Platform Admin",
      "phase-five-admin@example.test",
      await passwordHash("phase-five-admin-test-password"),
      0,
    );
  await ensureWorkspace("phase-five-admin");
  console.log("Seeded isolated platform-admin browser fixture.");
}
main().catch(() => {
  console.error("Isolated browser seed failed.");
  process.exitCode = 1;
});
