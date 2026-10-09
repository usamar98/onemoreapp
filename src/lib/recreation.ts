import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { db, transaction } from "./database";
import { projectAccess, workspaceRole } from "./access";
import {
  bundleAccess,
  verifiedBundleBytes,
  bundleSource,
  sha256,
  removeStoredUpload,
} from "./preservation";
import {
  tokenFor,
  newProject,
  record,
  uploadBytes,
  storeUpload,
  saveProject,
} from "./db";
import { usageStep } from "./billing";
import { AppError } from "./security";
import {
  staticFiles,
  vercelRequest,
  applyDeployment,
  type VercelConnection,
  type VercelDeployment,
} from "./vercel";
import type { BuildEvidence } from "./bundle-build";

type RecreationData = {
  name: string;
  providerName: string;
  teamId: string;
  originalProviderId: string;
  artifactId: string;
  artifactSha256: string;
  packageSha256: string;
  remoteId: string;
  deploymentId: string;
  requestSent: boolean;
  configured: boolean;
  requiredEnvNames: string[];
  jobId?: string;
  detail: string;
  url?: string;
  verifiedAt?: string;
};
export type Recreation = {
  id: string;
  bundle_id: string;
  actor: string;
  project_id: string;
  state: string;
  at: string;
  data: RecreationData;
};
async function connection(owner: string) {
  return {
    token: await tokenFor(owner, "vercel"),
    teamId: await tokenFor(owner, "vercel-team"),
  };
}
export async function recreationAccess(id: string, actor: string) {
  const row = await db()
    .prepare("SELECT * FROM project_recreations WHERE id=?")
    .get(id);
  if (!row) throw new AppError("Recreation not found.", 404);
  const b = await bundleAccess(String(row.bundle_id), actor, true);
  await projectAccess(String(row.project_id), actor, "control");
  return {
    recreation: {
      ...row,
      data: JSON.parse(String(row.data)),
    } as unknown as Recreation,
    bundle: b,
  };
}
export async function recreationPreview(
  actor: string,
  bundleId: string,
  name: string,
) {
  const b = await bundleAccess(bundleId, actor, true),
    a = await projectAccess(b.project_id, actor, "control");
  const workspace = await workspaceRole(b.owner, actor);
  if (workspace.role !== "Owner" || workspace.scope)
    throw new AppError(
      "A full workspace Owner must create an independent hosting project. Ask the workspace owner to review recreation.",
      403,
    );
  if (!["Parked", "Archived"].includes(a.project.status))
    throw new AppError(
      "Park or archive the original project before recreating its saved version.",
      409,
    );
  const c = await connection(b.owner);
  if (!c.token)
    throw new AppError(
      "Connect your Vercel account in Integrations before recreation.",
      409,
    );
  const check = await db()
      .prepare(
        "SELECT data FROM bundle_checks WHERE bundle_id=? AND state='completed' ORDER BY at DESC LIMIT 1",
      )
      .get(bundleId),
    evidence = check ? (JSON.parse(String(check.data)) as BuildEvidence) : null;
  if (
    !evidence?.buildVerified ||
    !evidence.artifactId ||
    evidence.packageSha256 !== b.data.packageSha256
  )
    throw new AppError(
      "Verify this package's npm build and retain a static output with index.html before recreation. Server applications and builds requiring secrets need an external workflow.",
      409,
    );
  await verifiedBundleBytes(b);
  const expires = Date.now() + 5 * 60000;
  const summary = {
    bundleId,
    name,
    packageSha256: b.data.packageSha256,
    artifactId: evidence.artifactId,
    artifactSha256: evidence.artifactSha256,
    teamId: c.teamId,
    originalProviderId: a.project.hostingProjectId,
    expires,
  };
  const confirmation = createHmac("sha256", c.token)
    .update(JSON.stringify(summary))
    .digest("hex");
  return {
    ...summary,
    confirmation,
    requiredEnvNames: b.data.requiredEnvNames,
    services: b.data.services,
    externalAssets: b.data.externalAssets,
    charges:
      "Creates a new Vercel project and preview deployment in your connected account. Vercel hosting, bandwidth and separately configured external services can incur charges under your provider plan; no price or savings estimate is available.",
    effect:
      "Deploy only the checked static output. No repository link, existing domain, production alias, original service or database is changed. Configure independent external services yourself. Secret values can be entered after the new project exists; they are sent only to that project's encrypted preview settings and are never embedded in the saved static build.",
  };
}
export async function beginRecreation(
  actor: string,
  bundleId: string,
  input: {
    name: string;
    expires: number;
    confirmation: string;
    reviewed: boolean;
  },
) {
  if (
    !input.reviewed ||
    input.expires < Date.now() ||
    input.expires > Date.now() + 5 * 60000
  )
    throw new AppError(
      "Review services and charges and confirm recreation again.",
      409,
    );
  const b = await bundleAccess(bundleId, actor, true);
  const existing = await db()
    .prepare(
      "SELECT id FROM project_recreations WHERE bundle_id=? AND state!='canceled'",
    )
    .get(bundleId);
  if (existing) return recreationAccess(String(existing.id), actor);
  const preview = await recreationPreview(actor, bundleId, input.name),
    c = await connection(b.owner);
  const {
    bundleId: bid,
    name,
    packageSha256,
    artifactId,
    artifactSha256,
    teamId,
    originalProviderId,
  } = preview;
  const expected = createHmac("sha256", c.token)
    .update(
      JSON.stringify({
        bundleId: bid,
        name,
        packageSha256,
        artifactId,
        artifactSha256,
        teamId,
        originalProviderId,
        expires: input.expires,
      }),
    )
    .digest("hex");
  if (
    !/^[a-f0-9]{64}$/.test(input.confirmation) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(input.confirmation))
  )
    throw new AppError(
      "The checked version or provider account changed. Preview again.",
      409,
    );
  const id = randomUUID(),
    p = newProject({
      name: input.name,
      status: "Building",
      description: String(b.data.notes.purpose || ""),
      nextTask: String(b.data.notes.nextTask || ""),
      blockers: String(b.data.notes.blockers || ""),
      version: `preserved:${b.id}`,
      requiredEnvNames: b.data.requiredEnvNames,
      setupChecklist: [
        "Review preserved source and configuration.",
        "Create independent external services; no production database is copied.",
        "Verify application functionality manually after deployment.",
      ],
      documentation: String(b.data.notes.documentation || ""),
    });
  const data: RecreationData = {
    name: input.name,
    providerName: `chapter-recreated-${p.id.replaceAll("-", "")}`,
    teamId,
    originalProviderId,
    artifactId,
    artifactSha256,
    packageSha256,
    remoteId: "",
    deploymentId: "",
    requestSent: false,
    configured: !b.data.requiredEnvNames.length,
    requiredEnvNames: b.data.requiredEnvNames,
    detail:
      "Owner confirmed a separate Vercel project and potential provider charges.",
  };
  try {
    await transaction([
      await usageStep(b.owner, "projects", 1),
      {
        sql: "INSERT INTO projects VALUES(?,?,?,?)",
        parameters: [p.id, b.owner, p.shareId, JSON.stringify(p)],
      },
      {
        sql: "INSERT INTO project_recreations VALUES(?,?,?,?,?,?,?,0)",
        parameters: [
          id,
          b.id,
          actor,
          p.id,
          "queued",
          JSON.stringify(data),
          new Date().toISOString(),
        ],
      },
    ]);
  } catch (e) {
    const existing = await db()
      .prepare(
        "SELECT id FROM project_recreations WHERE bundle_id=? AND state!='canceled'",
      )
      .get(bundleId);
    if (existing) return recreationAccess(String(existing.id), actor);
    throw e;
  }
  await record(
    b.owner,
    `Confirmed recreation of preserved version ${b.id} as ${p.name}`,
    "recreate",
    b.project_id,
  );
  return recreationAccess(id, actor);
}
async function lookupProject(
  c: VercelConnection,
  name: string,
  request: typeof fetch,
) {
  const url = new URL(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(name)}`,
  );
  if (c.teamId) url.searchParams.set("teamId", c.teamId);
  const response = await request(url, {
    headers: { Authorization: `Bearer ${c.token}` },
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new AppError(
      `Vercel project reconciliation failed (${response.status}). Reconnect and retry status.`,
      502,
    );
  return response.json() as Promise<{ id: string; name: string }>;
}
async function update(r: Recreation, state: string) {
  r.state = state;
  await db()
    .prepare("UPDATE project_recreations SET state=?,data=? WHERE id=?")
    .run(state, JSON.stringify(r.data), r.id);
}
function separate(r: Recreation, id: string, name?: string) {
  if (
    !id ||
    id === r.data.originalProviderId ||
    id === process.env.VERCEL_PROJECT_ID ||
    (name && name !== r.data.providerName)
  )
    throw new AppError(
      "Provider did not return the independent project expected by this recreation. No deployment was sent.",
      409,
    );
}
export async function runRecreation(
  actor: string,
  id: string,
  request = fetch,
) {
  await recreationAccess(id, actor);
  const lease = Date.now() + 300000;
  const claimed = await db()
    .prepare(
      "UPDATE project_recreations SET lease=? WHERE id=? AND lease<? RETURNING id",
    )
    .get(lease, id, Date.now());
  if (!claimed)
    throw new AppError(
      "This recreation is already processing. Check its saved status before retrying.",
      409,
    );
  try {
    return await executeRecreation(actor, id, request);
  } finally {
    await db()
      .prepare("UPDATE project_recreations SET lease=0 WHERE id=? AND lease=?")
      .run(id, lease);
  }
}
async function executeRecreation(
  actor: string,
  id: string,
  request: typeof fetch,
) {
  const { recreation: r, bundle: b } = await recreationAccess(id, actor);
  if (r.state === "ready") return r;
  const c = { token: await tokenFor(b.owner, "vercel"), teamId: r.data.teamId };
  if (!c.token)
    throw new AppError("Reconnect Vercel to verify this recreation.", 409);
  let remote = r.data.remoteId
    ? await vercelRequest(
        c,
        `/v9/projects/${encodeURIComponent(r.data.remoteId)}`,
        {},
        request,
      )
    : await lookupProject(c, r.data.providerName, request);
  if (!remote) {
    await update(r, "creating");
    remote = await vercelRequest(
      c,
      "/v11/projects",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: r.data.providerName,
          framework: null,
          buildCommand: "",
          installCommand: "",
          outputDirectory: ".",
        }),
      },
      request,
    );
  }
  separate(r, remote.id, remote.name);
  r.data.remoteId = remote.id;
  if (!r.data.configured) {
    r.data.detail =
      "New independent project created. Supply the required configuration securely for this project's preview environment. Values are not used to rebuild the static output.";
    await update(r, "needs-configuration");
    return r;
  }
  const a = await projectAccess(r.project_id, actor, "control"),
    p = a.project;
  if (!p.buildId) {
    const build = await uploadBytes(r.data.artifactId, b.owner);
    if (sha256(build) !== r.data.artifactSha256)
      throw new AppError(
        "Verified build integrity changed. Verify the bundle again.",
        409,
      );
    const sourceId = await storeUpload(
      b.owner,
      p.id,
      "preserved-source.zip",
      "source",
      "application/zip",
      await bundleSource(b),
    );
    try {
      p.buildId = await storeUpload(
        b.owner,
        p.id,
        "recreated-static-build.zip",
        "build",
        "application/zip",
        build,
      );
      p.sourceId = sourceId;
      p.sourceName = "preserved-source.zip";
      await saveProject(p, b.owner);
    } catch (e) {
      const saved = (await projectAccess(p.id, actor, "control")).project;
      if (saved.sourceId !== sourceId || saved.buildId !== p.buildId) {
        if (saved.sourceId !== sourceId)
          await removeStoredUpload(sourceId, b.owner);
        if (p.buildId && saved.buildId !== p.buildId)
          await removeStoredUpload(p.buildId, b.owner);
        throw e;
      }
    }
  }
  let deployment: VercelDeployment | null = null;
  if (r.data.deploymentId)
    deployment = await vercelRequest(
      c,
      `/v13/deployments/${encodeURIComponent(r.data.deploymentId)}`,
      {},
      request,
    );
  else if (r.data.requestSent) {
    const list = await vercelRequest(
      c,
      `/v6/deployments?projectId=${encodeURIComponent(r.data.remoteId)}&limit=100`,
      {},
      request,
    );
    deployment =
      (list.deployments || []).find(
        (d: VercelDeployment & { meta?: { chapterRecreation?: string } }) =>
          d.meta?.chapterRecreation === r.id,
      ) || null;
    if (!deployment) {
      r.data.detail =
        "A deployment request may have reached Vercel, but its result is unavailable. Check the new project's provider dashboard and retry status. No second deployment is submitted.";
      await update(r, "uncertain");
      throw new AppError(r.data.detail, 409);
    }
  } else {
    const build = await uploadBytes(p.buildId, b.owner),
      files = await staticFiles(build);
    for (let i = 0; i < files.length; i += 4)
      await Promise.all(
        files.slice(i, i + 4).map((f) =>
          vercelRequest(
            c,
            "/v2/files",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/octet-stream",
                "x-vercel-digest": f.sha,
                "x-vercel-size": String(f.size),
              },
              body: new Uint8Array(f.data),
            },
            request,
          ),
        ),
      );
    r.data.requestSent = true;
    await update(r, "deploying");
    deployment = await vercelRequest(
      c,
      "/v13/deployments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: r.data.providerName,
          project: r.data.remoteId,
          files: files.map(({ file, sha, size }) => ({ file, sha, size })),
          meta: { chapterRecreation: r.id, chapterBundle: b.id },
          projectSettings: {
            framework: null,
            buildCommand: "",
            installCommand: "",
            outputDirectory: ".",
          },
        }),
      },
      request,
    );
  }
  if (!deployment?.id)
    throw new AppError(
      "Vercel did not return a deployment ID. Retry status to reconcile the existing request.",
      502,
    );
  r.data.deploymentId = deployment.id;
  await update(r, "checking");
  const confirmed = (await vercelRequest(
    c,
    `/v13/deployments/${encodeURIComponent(deployment.id)}`,
    {},
    request,
  )) as VercelDeployment;
  const providerId = confirmed.projectId || confirmed.project?.id;
  if (providerId !== r.data.remoteId)
    throw new AppError(
      "Deployment belongs to an unexpected Vercel project; success is not recorded.",
      409,
    );
  applyDeployment(p, confirmed);
  p.hostingTeamId = c.teamId;
  p.hostingProjectId = r.data.remoteId;
  await saveProject(p, b.owner);
  const state = (
    confirmed.readyState ||
    confirmed.status ||
    "UNKNOWN"
  ).toUpperCase();
  r.data.verifiedAt = new Date().toISOString();
  r.data.url = p.demoUrl;
  if (state === "READY" && p.demoUrl) {
    r.data.detail =
      "Vercel confirmed READY for the new independent preview deployment. Application functionality has not been verified.";
    await update(r, "ready");
    await record(
      b.owner,
      `Recreated ${p.name}; Vercel confirmed READY for an independent deployment`,
      "recreate",
      b.project_id,
    );
    return r;
  }
  if (["ERROR", "FAILED", "CANCELED"].includes(state)) {
    r.data.detail = `Vercel reports ${state}. Review the new project's provider logs; the original is unchanged. No automatic redeployment is attempted.`;
    await update(r, "failed");
    return r;
  }
  r.data.detail = `Vercel reports ${state}; no successful deployment is claimed.`;
  await update(r, "checking");
  throw new AppError(r.data.detail, 409);
}
export async function configureRecreation(
  actor: string,
  id: string,
  values: Record<string, string>,
  reviewed: boolean,
  request = fetch,
) {
  const { recreation: r, bundle: b } = await recreationAccess(id, actor);
  if (!reviewed || r.state !== "needs-configuration" || !r.data.remoteId)
    throw new AppError(
      "Review the new independent service configuration before supplying secrets.",
      409,
    );
  separate(r, r.data.remoteId);
  if (
    Object.keys(values).some((k) => !r.data.requiredEnvNames.includes(k)) ||
    r.data.requiredEnvNames.some((k) => !values[k]?.trim()) ||
    Object.values(values).some((v) => v.length > 16000)
  )
    throw new AppError(
      "Provide only the required configuration names. Each value must be present and smaller than 16 KB.",
    );
  const c = { token: await tokenFor(b.owner, "vercel"), teamId: r.data.teamId };
  const remote = await vercelRequest(
    c,
    `/v9/projects/${encodeURIComponent(r.data.remoteId)}`,
    {},
    request,
  );
  separate(r, remote.id, remote.name);
  // Values exist only in this request and Vercel's encrypted preview settings. Never enqueue or archive them.
  const result = await vercelRequest(
    c,
    `/v10/projects/${encodeURIComponent(r.data.remoteId)}/env?upsert=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        Object.entries(values).map(([key, value]) => ({
          key,
          value,
          type: "encrypted",
          target: ["preview"],
        })),
      ),
    },
    request,
  );
  if (Array.isArray(result.failed) && result.failed.length)
    throw new AppError(
      "Vercel rejected part of the configuration. Check the new project's preview settings and retry securely.",
      502,
    );
  const env = await vercelRequest(
    c,
    `/v10/projects/${encodeURIComponent(r.data.remoteId)}/env?decrypt=false`,
    {},
    request,
  );
  const keys = (env.envs || [])
    .filter((e: { target?: string[] }) => e.target?.includes("preview"))
    .map((e: { key: string }) => e.key);
  if (r.data.requiredEnvNames.some((k) => !keys.includes(k)))
    throw new AppError(
      "Vercel did not confirm all required preview configuration names. No deployment was started.",
      409,
    );
  r.data.configured = true;
  r.data.detail =
    "Required names verified in the new project's preview environment. Values were not retained by Chapter; presence does not verify their behavior.";
  await update(r, "queued");
  return r;
}
