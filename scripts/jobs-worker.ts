import { runPending } from "../src/lib/jobs";
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
async function main() {
  let failures = 0;
  do {
    try {
      await runPending();
      failures = 0;
    } catch {
      failures++;
      console.error(
        JSON.stringify({
          event: "worker_sweep_failed",
          failures,
          detail:
            "Check database and integration configuration. Watch mode will retry.",
        }),
      );
      if (!process.argv.includes("--watch")) {
        process.exitCode = 1;
        break;
      }
    }
    if (!process.argv.includes("--watch") || stopping) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(60000, 15000 * 2 ** failures)),
    );
  } while (!stopping);
}
main().catch(() => {
  console.error(
    "Background worker failed. Check database and integration configuration, then retry. No secrets are logged.",
  );
  process.exitCode = 1;
});
