import { randomUUID } from "node:crypto";
import { db, transaction } from "./database";
import {
  accountSecrets,
  tokenFor,
  ownerRedact,
  newProject,
  record,
  saveProjectIfUnchanged,
} from "./db";
import { workspaceAdmin, projectAccess } from "./access";
import { AppError, githubSlug, hash, safeUrl } from "./security";
import { githubInfo } from "./integrations";
import { vercelRequest, type VercelDeployment } from "./vercel";
import { usageStep } from "./billing";
import { handoverText } from "./phase-two";
import { notifyOwners } from "./notifications";
import type { Project } from "./types";

export type RepoChoice = {
  id: string;
  name: string;
  repository: string;
  description: string;
  branch: string;
  updatedAt: string;
};
export type DeploymentChoice = {
  id: string;
  name: string;
  repository: string;
  teamId: string;
  demoUrl: string;
  deploymentId: string;
  state: string;
  paused: boolean | null;
};
export type ImportCandidate = RepoChoice & {
  key: string;
  matches: { id: string; reason: string; certain: boolean }[];
  existing: string;
};
export type Discovery = {
  id: string;
  repositories: ImportCandidate[];
  deployments: (DeploymentChoice & { existing: string })[];
  warnings: string[];
  at: string;
};
export function repositoryIdentity(url: string) {
  return `github:${githubSlug(url).toLowerCase()}`;
}
export function deploymentIdentity(id: string, team: string) {
  return `vercel:${team || "personal"}:${id}`;
}
export async function connectionState(owner: string, provider: string) {
  const row = await db()
    .prepare("SELECT data FROM connection_state WHERE owner=? AND provider=?")
    .get(owner, provider);
  return row
    ? JSON.parse(String(row.data))
    : { connectedAt: "", lastSuccess: "", lastAttempt: "", error: "" };
}
export async function connectionResult(
  owner: string,
  provider: string,
  error = "",
  connected = false,
) {
  const old = await connectionState(owner, provider),
    at = new Date().toISOString();
  const data = {
    ...old,
    ...(connected ? { connectedAt: at } : {}),
    lastAttempt: at,
    ...(error ? {} : { lastSuccess: at }),
    error,
  };
  await db()
    .prepare(
      "INSERT INTO connection_state VALUES(?,?,?) ON CONFLICT(owner,provider) DO UPDATE SET data=excluded.data",
    )
    .run(owner, provider, JSON.stringify(data));
}
async function githubRequest(owner: string, endpoint: string, request = fetch) {
  const token = await tokenFor(owner, "github");
  if (!token)
    throw new AppError(
      "Connect GitHub with a fine-grained token for selected repositories and read-only Contents permission.",
      409,
    );
  const response = await request(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Chapter-project-workspace",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new AppError(
      `GitHub discovery failed (${response.status}). Reconnect with access to the selected repositories; check token expiry and API rate limits.`,
      502,
    );
  return response.json();
}
export function matchRepositories(
  repos: RepoChoice[],
  deployments: DeploymentChoice[],
) {
  return repos.map((repo) => ({
    ...repo,
    key: `repo:${repo.id}`,
    existing: "",
    matches: deployments.flatMap((d) => {
      if (
        d.repository &&
        repositoryIdentity(d.repository) === repositoryIdentity(repo.repository)
      )
        return [
          {
            id: d.id,
            certain: true,
            reason:
              "Vercel’s Git connection points to this repository. Review branches and root directory in Vercel.",
          },
        ];
      if (d.name.toLowerCase() === repo.name.toLowerCase())
        return [
          {
            id: d.id,
            certain: false,
            reason:
              "Names match only. Confirm this application belongs to the repository.",
          },
        ];
      return [];
    }),
  }));
}
function deploymentChoice(
  p: Record<string, unknown>,
  teamId: string,
): DeploymentChoice {
  const link = p.link as
    | { type?: string; org?: string; repo?: string; repoOwner?: string }
    | undefined;
  const targets = p.targets as { production?: VercelDeployment } | undefined;
  const production = targets?.production;
  const repository =
    link?.type === "github" && (link.org || link.repoOwner) && link.repo
      ? `https://github.com/${link.org || link.repoOwner}/${link.repo}`
      : "";
  return {
    id: String(p.id),
    name: String(p.name || "Unnamed deployment"),
    repository,
    teamId,
    demoUrl: production?.url
      ? safeUrl(`https://${production.url.replace(/^https?:\/\//, "")}`)
      : "",
    deploymentId: production?.id || "",
    state: production?.readyState?.toLowerCase() || "not checked",
    paused: typeof p.paused === "boolean" ? p.paused : null,
  };
}
export async function discoverProjects(
  owner: string,
  actor: string,
  request = fetch,
): Promise<Discovery> {
  await workspaceAdmin(owner, actor, true);
  const repos: RepoChoice[] = [],
    deployments: DeploymentChoice[] = [],
    warnings: string[] = [];
  if (await tokenFor(owner, "github")) {
    try {
      for (let page = 1; page <= 5; page++) {
        const list = await githubRequest(
          owner,
          `/user/repos?per_page=100&page=${page}&sort=updated`,
          request,
        );
        if (!Array.isArray(list))
          throw new AppError(
            "GitHub returned an unexpected repository list.",
            502,
          );
        for (const r of list)
          repos.push({
            id: String(r.id),
            name: String(r.name),
            repository: `https://github.com/${githubSlug(String(r.html_url))}`,
            description: String(r.description || ""),
            branch: String(r.default_branch || ""),
            updatedAt: String(r.updated_at || ""),
          });
        if (list.length < 100) break;
        if (page === 5)
          warnings.push(
            "Discovery is limited to the 500 most recently updated accessible repositories. Import other repositories by URL.",
          );
      }
      await connectionResult(owner, "github");
    } catch (e) {
      const message =
        e instanceof AppError
          ? e.message
          : "GitHub is unavailable. Reconnect and retry discovery.";
      warnings.push(message);
      await connectionResult(owner, "github", message);
    }
  } else
    warnings.push(
      "GitHub is not connected. You can still import public repositories by URL.",
    );
  if (await tokenFor(owner, "vercel")) {
    try {
      const teamId = await tokenFor(owner, "vercel-team"),
        token = await tokenFor(owner, "vercel");
      let until = "";
      for (let page = 0; page < 5; page++) {
        const list = await vercelRequest(
          { token, teamId },
          `/v9/projects?limit=100${until ? `&until=${encodeURIComponent(until)}` : ""}`,
          {},
          request,
        );
        for (const p of list.projects || [])
          deployments.push(deploymentChoice(p, teamId));
        if (!list.pagination?.next) break;
        until = String(list.pagination.next);
        if (page === 4)
          warnings.push(
            "Showing up to 500 Vercel projects in the connected account/team.",
          );
      }
      await connectionResult(owner, "vercel");
    } catch (e) {
      const message =
        e instanceof AppError
          ? e.message
          : "Vercel is unavailable. Reconnect and retry discovery.";
      warnings.push(message);
      await connectionResult(owner, "vercel", message);
    }
  } else
    warnings.push(
      "Vercel is not connected. Importing metadata does not require hosting.",
    );
  const secrets = await accountSecrets(owner);
  for (const r of repos) {
    r.name = handoverText(r.name, secrets);
    r.description = handoverText(r.description, secrets);
  }
  const existing = (
    await db().prepare("SELECT data FROM projects WHERE owner=?").all(owner)
  ).map((r) => JSON.parse(String(r.data)) as Project);
  const candidates = matchRepositories(repos, deployments).map((r) => ({
    ...r,
    existing:
      existing.find(
        (p) =>
          p.repository &&
          repositoryIdentity(p.repository) === repositoryIdentity(r.repository),
      )?.id || "",
  }));
  const ds = deployments.map((d) => ({
    ...d,
    existing:
      existing.find(
        (p) =>
          p.hostingProvider === "vercel" &&
          p.hostingProjectId === d.id &&
          (p.hostingTeamId || "") === d.teamId,
      )?.id || "",
  }));
  const result = {
    id: randomUUID(),
    repositories: candidates,
    deployments: ds,
    warnings,
    at: new Date().toISOString(),
  };
  await db()
    .prepare("DELETE FROM import_batches WHERE expires<?")
    .run(Date.now());
  await db()
    .prepare("INSERT INTO import_batches VALUES(?,?,?,?,?)")
    .run(
      result.id,
      owner,
      actor,
      JSON.stringify(result),
      Date.now() + 30 * 60000,
    );
  return result;
}
export async function commitImport(
  owner: string,
  actor: string,
  batchId: string,
  selections: { key: string; deploymentId: string }[],
) {
  await workspaceAdmin(owner, actor, true);
  const row = await db()
    .prepare(
      "SELECT data FROM import_batches WHERE id=? AND owner=? AND actor=? AND expires>?",
    )
    .get(batchId, owner, actor, Date.now());
  if (!row)
    throw new AppError("Import preview expired. Discover projects again.", 409);
  const batch = JSON.parse(String(row.data)) as Discovery;
  if (
    !selections.length ||
    selections.length > 50 ||
    new Set(selections.map((s) => s.key)).size !== selections.length
  )
    throw new AppError("Choose 1–50 unique projects.");
  const chosen: Project[] = [],
    identities = new Set<string>();
  for (const s of selections) {
    const repo = batch.repositories.find((r) => r.key === s.key);
    const deployment = batch.deployments.find(
      (d) =>
        d.id === (repo ? s.deploymentId : s.key.replace(/^deployment:/, "")),
    );
    if ((!repo && !deployment) || (s.deploymentId && !deployment))
      throw new AppError("Selection is not in the reviewed discovery batch.");
    const ids = [
      ...(repo ? [repositoryIdentity(repo.repository)] : []),
      ...(deployment
        ? [deploymentIdentity(deployment.id, deployment.teamId)]
        : []),
    ];
    if (ids.some((i) => identities.has(i)))
      throw new AppError(
        "One repository or deployment was selected twice. Choose separate applications only.",
      );
    ids.forEach((i) => identities.add(i));
    chosen.push(
      newProject({
        name: repo?.name || deployment!.name,
        description: repo?.description || "",
        repository: repo?.repository || "",
        status: "Idea",
        tags: ["Imported"],
        repoInfo: repo
          ? `Default branch: ${repo.branch || "Not reported"}\nRepository metadata imported ${batch.at}. Source files and current commit have not been downloaded.`
          : "",
        ...(deployment
          ? {
              hostingProvider: "vercel",
              hostingProjectId: deployment.id,
              hostingTeamId: deployment.teamId,
              deploymentId: deployment.deploymentId,
              deploymentState: deployment.state,
              demoUrl: deployment.demoUrl,
              hostingPaused: deployment.paused,
              hostingCheckedAt: batch.at,
            }
          : {}),
        syncEnabled: false,
      }),
    );
  }
  const results: { name: string; id: string; state: string }[] = [];
  // Each project is atomic. Repeated commits return existing records and never consume duplicate quota.
  for (const p of chosen) {
    const ids = [
      ...(p.repository ? [repositoryIdentity(p.repository)] : []),
      ...(p.hostingProjectId
        ? [deploymentIdentity(p.hostingProjectId, p.hostingTeamId)]
        : []),
    ];
    const current = (
      await db()
        .prepare("SELECT id,data FROM projects WHERE owner=?")
        .all(owner)
    ).find((r) => {
      const q = JSON.parse(String(r.data)) as Project;
      return (
        (p.repository &&
          q.repository &&
          repositoryIdentity(p.repository) ===
            repositoryIdentity(q.repository)) ||
        (p.hostingProjectId &&
          q.hostingProjectId === p.hostingProjectId &&
          (q.hostingTeamId || "") === p.hostingTeamId)
      );
    });
    if (current) {
      results.push({
        name: p.name,
        id: String(current.id),
        state: "Already imported",
      });
      continue;
    }
    try {
      await transaction([
        await usageStep(owner, "projects", 1),
        {
          sql: "INSERT INTO projects VALUES(?,?,?,?)",
          parameters: [p.id, owner, p.shareId, JSON.stringify(p)],
        },
        ...ids.map((identity) => ({
          sql: "INSERT INTO external_links VALUES(?,?,?)",
          parameters: [owner, identity, p.id],
        })),
      ]);
      await record(
        owner,
        `Imported metadata for ${p.name}; live applications unchanged`,
        "import",
        p.id,
      );
      results.push({ name: p.name, id: p.id, state: "Imported privately" });
    } catch (e) {
      const linked = await db()
        .prepare(
          "SELECT project_id FROM external_links WHERE owner=? AND identity=?",
        )
        .get(owner, ids[0]);
      if (linked)
        results.push({
          name: p.name,
          id: String(linked.project_id),
          state: "Already imported",
        });
      else
        results.push({
          name: p.name,
          id: "",
          state:
            e instanceof AppError
              ? e.message
              : "Import failed. Retry this selection.",
        });
    }
  }
  return results;
}
export async function syncProject(actor: string, id: string) {
  const access = await projectAccess(id, actor, "control"),
    p = access.project;
  const at = new Date().toISOString(),
    errors: string[] = [];
  const next = {
    attemptedAt: at,
    succeededAt: p.sync?.succeededAt || "",
    error: "",
    repository: p.sync?.repository,
    deployment: p.sync?.deployment,
  };
  let checked = 0;
  if (p.repository) {
    try {
      // A disconnected account is not silently used for a scheduled repository sync.
      if (!(await tokenFor(access.owner, "github")))
        throw new AppError(
          "GitHub is disconnected. Reconnect to refresh repository metadata.",
          409,
        );
      const info = await githubInfo(access.owner, p.repository);
      next.repository = {
        sha: info.version,
        info: await ownerRedact(access.owner, info.repoInfo),
        checkedAt: at,
      };
      p.repoInfo = next.repository.info;
      await connectionResult(access.owner, "github");
      checked++;
    } catch (e) {
      const error =
        e instanceof AppError
          ? e.message
          : "Repository sync failed. Reconnect GitHub and retry.";
      errors.push(error);
      await connectionResult(access.owner, "github", error);
    }
  }
  if (p.hostingProvider === "vercel" && p.hostingProjectId) {
    try {
      const provider = await vercelRequest(
        {
          token: await tokenFor(access.owner, "vercel"),
          teamId: p.hostingTeamId || "",
        },
        `/v9/projects/${encodeURIComponent(p.hostingProjectId)}`,
      );
      const d = deploymentChoice(provider, p.hostingTeamId || "");
      if (d.deploymentId) {
        p.deploymentId = d.deploymentId;
        p.deploymentState = d.state;
        next.deployment = { id: d.deploymentId, state: d.state, checkedAt: at };
      }
      p.hostingPaused = d.paused;
      p.hostingCheckedAt = at;
      // Stored demo URL, work status and uploaded package version remain deliberate owner records.
      await connectionResult(access.owner, "vercel");
      checked++;
      if (["error", "failed", "canceled"].includes(d.state))
        await notifyOwners(
          access.owner,
          id,
          "deployment",
          `${p.name}: Vercel reports ${d.state}. Review the deployment.`,
          `sync-deployment:${d.deploymentId}`,
        );
    } catch (e) {
      const error =
        e instanceof AppError
          ? e.message
          : "Deployment sync failed. Reconnect Vercel and retry.";
      errors.push(error);
      await connectionResult(access.owner, "vercel", error);
    }
  }
  if (!checked && !errors.length)
    errors.push(
      "No repository or Vercel application is linked. Connect and import a project first.",
    );
  next.error = errors.join(" ");
  if (!errors.length) next.succeededAt = at;
  p.sync = next;
  await saveProjectIfUnchanged(p, access.owner, access.previousData);
  await record(
    access.owner,
    `${errors.length ? "Sync needs attention" : "Synchronized metadata"}: ${p.name}`,
    "sync",
    id,
  );
  if (errors.length) throw new AppError(next.error, 502);
  return {
    projectId: id,
    at,
    message:
      "Repository/deployment metadata synchronized. Live applications unchanged.",
  };
}
export function syncEvent(p: Project, now: number) {
  return hash(`${p.id}:${Math.floor(now / (6 * 3600000))}`);
}
