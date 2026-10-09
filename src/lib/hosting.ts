import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./security";
import { vercelRequest, type VercelConnection } from "./vercel";
import type { Project } from "./types";
import { hostingImpact } from "./dependencies";
import { actorContext } from "./request-context";
export type HostingPreview = {
  id: string;
  name: string;
  paused: boolean | null;
  stop: string;
  remain: string[];
  expires: number;
  confirmation: string;
  affected: string[];
};
type ProviderProject = {
  id: string;
  name: string;
  paused?: boolean;
  alias?: { domain?: string }[];
  targets?: { production?: { alias?: string[] } };
  dependencyDigest?: string;
};
export async function hostingStatus(
  connection: VercelConnection,
  project: Project,
  request = fetch,
) {
  if (
    !connection.token ||
    project.hostingProvider !== "vercel" ||
    !project.hostingProjectId
  )
    throw new AppError(
      "Hosting controls are unavailable. Connect Vercel and deploy this project's static build first.",
      409,
    );
  const remote: ProviderProject = await vercelRequest(
    connection,
    `/v9/projects/${encodeURIComponent(project.hostingProjectId)}`,
    {},
    request,
  );
  if (remote.id !== project.hostingProjectId || !remote.name)
    throw new AppError(
      "Vercel did not return the expected project. Check its deployment connection.",
      502,
    );
  return remote;
}
function assertSeparateChapter(remote: ProviderProject) {
  const appHost = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).hostname
    : "";
  const aliases = [
    ...(remote.targets?.production?.alias || []),
    ...(remote.alias || []).map((a) => a.domain || ""),
  ];
  if (
    remote.id === process.env.VERCEL_PROJECT_ID ||
    (appHost && aliases.includes(appHost))
  )
    throw new AppError(
      "This Vercel project hosts Chapter itself. It cannot be paused here because that would stop the share pages. Use a separate Vercel project for your application.",
      409,
    );
}
function signature(
  connection: VercelConnection,
  remote: ProviderProject,
  expires: number,
  target: string,
) {
  return createHmac("sha256", connection.token)
    .update(
      JSON.stringify([
        remote.id,
        remote.name,
        remote.paused,
        connection.teamId,
        expires,
        target,
        remote.dependencyDigest,
      ]),
    )
    .digest("hex");
}
export async function hostingPreview(
  connection: VercelConnection,
  project: Project,
  target: "pause" | "resume",
  request = fetch,
): Promise<HostingPreview> {
  const remote = await hostingStatus(connection, project, request);
  assertSeparateChapter(remote);
  const impact = await hostingImpact(
    project,
    actorContext.getStore() || undefined,
  );
  remote.dependencyDigest = impact.digest;
  const expires = Date.now() + 5 * 60000;
  return {
    id: remote.id,
    name: remote.name,
    paused: typeof remote.paused === "boolean" ? remote.paused : null,
    stop: `Production deployment for Vercel project “${remote.name}” (${remote.id}).${remote.targets?.production?.alias?.length ? ` Production domains reported by Vercel: ${remote.targets.production.alias.join(", ")}.` : ""} Its production visitors will receive Vercel's 503 DEPLOYMENT_PAUSED page.`,
    remain: [
      "Chapter share page, screenshots, waitlist and enquiries remain available when sharing is enabled. The video link remains on the page; its playback depends on the video host. A video served by this paused application will also stop.",
      "Source snapshots and notes stay in Chapter. Vercel settings and domain ownership are retained.",
      "Database, domain renewals, APIs, storage and subscription charges are not cancelled. No savings are claimed.",
    ],
    affected: impact.detail,
    expires,
    confirmation: signature(connection, remote, expires, target),
  };
}
export async function changeHosting(
  connection: VercelConnection,
  project: Project,
  input: {
    target: "pause" | "resume";
    name: string;
    expires: number;
    confirmation: string;
  },
  request = fetch,
) {
  const remote = await hostingStatus(connection, project, request);
  assertSeparateChapter(remote);
  remote.dependencyDigest = (
    await hostingImpact(project, actorContext.getStore() || undefined)
  ).digest;
  const expected = signature(connection, remote, input.expires, input.target);
  if (
    input.name !== remote.name ||
    input.expires < Date.now() ||
    input.expires > Date.now() + 5 * 60000 ||
    !/^[a-f0-9]{64}$/.test(input.confirmation) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(input.confirmation))
  )
    throw new AppError(
      "Confirmation expired or the provider project changed. Review the affected service again and type its exact name.",
      409,
    );
  if (typeof remote.paused !== "boolean")
    throw new AppError(
      "Vercel has not reported its pause state. Check provider status before changing hosting.",
      409,
    );
  await vercelRequest(
    connection,
    `/v1/projects/${encodeURIComponent(remote.id)}/${input.target === "pause" ? "pause" : "unpause"}`,
    { method: "POST" },
    request,
  );
  const verified = await hostingStatus(connection, project, request);
  if (verified.paused !== (input.target === "pause"))
    throw new AppError(
      "The request was sent, but Vercel has not confirmed the requested state. Check provider status again; success has not been recorded.",
      502,
    );
  project.hostingPaused = verified.paused;
  project.revival = null;
  project.hostingCheckedAt = new Date().toISOString();
  return project;
}
