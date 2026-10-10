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
  const documents =
    p.shareDocuments && p.sharedDocumentIds?.length
      ? await db()
          .prepare(
            `SELECT id,name FROM uploads WHERE owner=? AND project_id=? AND kind='document' AND id IN (${p.sharedDocumentIds.map(() => "?").join(",")})`,
          )
          .all(String(row.owner), p.id, ...p.sharedDocumentIds)
      : [];
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
    screenshotIds: p.shareScreenshots
      ? (p.sharedScreenshotIds ?? p.screenshotIds)
      : [],
    sourceId: p.shareFiles ? (p.sharedSourceId ?? p.sourceId) : "",
    sourceName: p.shareFiles ? text(p.sourceName) : "",
    documents: documents.map((d) => ({
      id: String(d.id),
      name: text(String(d.name)),
    })),
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
