import { db, accountSecrets } from "./db";
import { redact } from "./redact";
import type { Project } from "./types";
import { normalizeProject } from "./types";
export async function sharedProject(shareId: string) {
  const row = await db()
    .prepare("SELECT owner,data FROM projects WHERE share_id=?")
    .get(shareId);
  if (!row) return null;
  const p: Project = normalizeProject(JSON.parse(String(row.data)));
  if (!p.shared) return null;
  const secrets = await accountSecrets(String(row.owner));
  const text = (value: string) => redact(value, secrets);
  const url = (value: string) => (text(value) === value ? value : "");
  return {
    id: p.id,
    shareId: p.shareId,
    name: text(p.name),
    description: text(p.description),
    status: p.status,
    color: p.color,
    tags: p.tags.map(text),
    demoUrl: p.shareDemo ? url(p.demoUrl) : "",
    repository: p.shareRepo ? url(p.repository) : "",
    screenshotIds: p.shareScreenshots ? p.screenshotIds : [],
    sourceId: p.shareFiles ? p.sourceId : "",
    sourceName: p.shareFiles ? text(p.sourceName) : "",
    videoUrl: p.shareVideo ? url(p.videoUrl) : "",
    waitlistEnabled: p.waitlistEnabled,
    enquiriesEnabled: p.enquiriesEnabled,
    inactive: p.status === "Parked" || p.hostingPaused === true,
    hostingPaused: p.hostingPaused === true,
    handoverUrl: p.handover?.shared
      ? `/api/handovers/${p.id}/${p.handover.shareToken}`
      : "",
  };
}
