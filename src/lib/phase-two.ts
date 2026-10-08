import JSZip from "jszip";
import { createHash } from "node:crypto";
import { AppError } from "./security";
import { redact } from "./redact";
import { inspectZip } from "./uploads";
import type { Project } from "./types";
import { taskFor } from "./planning";
import { referencedEnvNames } from "./env-names";
export async function sourceEnvNames(source: Buffer) {
  const zip = await JSZip.loadAsync((await inspectZip(source)).source);
  const names = new Set<string>();
  for (const entry of Object.values(zip.files).filter(
    (f) =>
      !f.dir && /\.(?:[cm]?js|jsx|ts|tsx|md|sh|py|ya?ml|toml)$/i.test(f.name),
  )) {
    for (const name of referencedEnvNames(await entry.async("string")))
      names.add(name);
  }
  return [...names].slice(0, 100).sort();
}
export function handoverText(value: string, secrets: string[] = []) {
  return redact(value, secrets)
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[PRIVATE EMAIL REMOVED]",
    )
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[PRIVATE NUMBER REMOVED]")
    .replace(
      /\b(?:customer|client|user)[_-]?(?:name|email|phone|address|data)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\n,;]+)/gi,
      "[PRIVATE CUSTOMER FIELD REMOVED]",
    );
}
const privatePaths =
  /(^|\/)(?:customers?|clients?|contacts?|exports?|backups?|dumps?|logs?|analytics|fixtures|__fixtures__|test-data|data)(?:[._/-]|$)|\.(?:csv|tsv|sql|db|sqlite\d?|log|xlsx?|parquet|pdf|png|jpe?g|webp|gif|mp4|zip|map)$/i;
export function transferablePath(name: string) {
  if (privatePaths.test(name) || name.split("/").some((p) => p.startsWith(".")))
    return false;
  if (/\.json$/i.test(name))
    return /(^|\/)(?:package(?:-lock)?|tsconfig[^/]*|jsconfig|vercel|[^/]+\.config)\.json$/i.test(
      name,
    );
  return (
    /\.(?:[cm]?js|jsx|ts|tsx|html|css|scss|md|txt|ya?ml|toml|xml|svg|sh|py|rb|go|rs)$/i.test(
      name,
    ) || /(^|\/)(?:LICENSE|Dockerfile|Makefile)$/i.test(name)
  );
}
export type HandoverPreview = {
  paths: string[];
  excluded: string[];
  files: { path: string; content: string; size: number }[];
  manifest: string;
  digest: string;
};
export async function prepareHandover(
  project: Project,
  source: Buffer | null,
  paths: string[],
  secrets: string[] = [],
): Promise<HandoverPreview> {
  const eligible: Record<string, Buffer> = {},
    excluded: string[] = [];
  if (source) {
    const zip = await JSZip.loadAsync(
      (await inspectZip(source, secrets)).source,
    );
    for (const entry of Object.values(zip.files).filter((f) => !f.dir)) {
      if (
        !transferablePath(entry.name) ||
        handoverText(entry.name, secrets) !== entry.name
      ) {
        excluded.push(entry.name);
        continue;
      }
      const data = await entry.async("nodebuffer");
      if (data.length > 128 * 1024) {
        excluded.push(entry.name);
        continue;
      }
      eligible[entry.name] = data;
    }
  }
  if (
    paths.some((p) => !Object.hasOwn(eligible, p)) ||
    new Set(paths).size !== paths.length
  )
    throw new AppError(
      "Choose files from the eligible source list. Private data and unsupported assets are excluded.",
    );
  const files = paths
    .slice()
    .sort()
    .map((path) => ({
      path,
      content: handoverText(eligible[path].toString("utf8"), secrets),
      size: eligible[path].length,
    }));
  if (
    files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) >
    3 * 1024 * 1024
  )
    throw new AppError(
      "Select less than 3 MB of source files for a reviewable handover.",
    );
  const m = project.memory;
  const inventory = Object.entries(eligible)
    .map(
      ([name, data]) =>
        `- ${name} (${data.length} bytes)${paths.includes(name) ? " · included" : " · not included"}`,
    )
    .join("\n");
  let manifest = handoverText(
    `# ${project.name} — handover\n\nPurpose\n${project.description || "Not recorded"}\n\nStatus: ${project.status}\nVersion: ${project.version || "Not recorded"}\nRepository: ${project.repository || "Not recorded"}\nHosting provider: ${project.hostingProvider || "Not connected"}\n\nSetup\n${m?.setup || "Not recorded"}\n\nRequired environment-variable names (obtain values securely)\n${project.requiredEnvNames.join("\n") || "Not recorded"}\n\nCompleted features\n${m?.completed || "Not recorded"}\n\nKnown issues\n${m?.issues || "Not recorded"}\n\nBlockers\n${project.blockers || "None recorded"}\n\nNext task\n${taskFor(project) || "Not recorded"}\n\nWhy paused\n${m?.reason || "Not recorded"}\n\nAsset inventory\n${inventory || "No eligible source assets"}\nScreenshots: ${project.screenshotIds.length} saved privately; image contents excluded.\nDemo video: ${project.shareVideo ? project.videoUrl || "Not recorded" : "Private; excluded"}\n\nOwnership transfer checklist\n- [ ] Confirm the recipient and licensing rights for selected source and assets.\n- [ ] Transfer repository ownership in GitHub; verify the recipient can access it.\n- [ ] Transfer the hosting project in Vercel; confirm team access and billing responsibility.\n- [ ] Transfer domain registration and DNS control; verify records and renewal responsibility.\n- [ ] Transfer database and third-party service ownership separately; exclude customer exports.\n- [ ] Deliver environment values through a secure channel and rotate credentials.\n- [ ] Recipient verifies setup, dependencies, build, deployment and domain resolution.\n- [ ] Revoke old collaborators and this package link when the transfer is complete.\n\nPrivacy\nThis package contains the reviewed files only. Waitlist contacts, enquiries, expenses, account credentials, screenshots and database exports are excluded.\n`,
    secrets,
  );
  if (project.documentation || project.taskBreakdown)
    manifest += handoverText(
      "\n\nReviewed project documentation\n" +
        (project.documentation || "Not recorded") +
        "\n\nReviewed task plan\n" +
        (project.taskBreakdown || "Not recorded"),
      secrets,
    );
  const digest = createHash("sha256")
    .update(JSON.stringify({ sourceId: project.sourceId, files, manifest }))
    .digest("hex");
  return {
    paths: Object.keys(eligible).sort(),
    excluded,
    files,
    manifest,
    digest,
  };
}
export async function handoverZip(preview: HandoverPreview) {
  const zip = new JSZip();
  zip.file("HANDOVER.md", preview.manifest);
  for (const f of preview.files) zip.file(`source/${f.path}`, f.content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
