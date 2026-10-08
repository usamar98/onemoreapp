import { randomUUID } from "node:crypto";
import { db, transaction } from "./database";
import type { Project } from "./types";
import { AppError, githubSlug } from "./security";
import { actorContext } from "./request-context";
export { actorContext } from "./request-context";
export function storedRecords(project: Project) {
  return {
    notes: {
      memory: project.memory,
      nextTask: project.nextTask,
      blockers: project.blockers,
      taskMinutes: project.taskMinutes,
      taskPriority: project.taskPriority,
      requiredEnvNames: project.requiredEnvNames,
      documentation: project.documentation || "",
      taskBreakdown: project.taskBreakdown || "",
      progressUpdates: project.progressUpdates || [],
    },
    brief: { brief: project.brief, briefKind: project.briefKind },
    package: {
      sourceId: project.sourceId,
      sourceName: project.sourceName,
      buildId: project.buildId,
      version: project.version,
      referencedEnvNames: project.referencedEnvNames,
    },
  };
}
async function repositoryChanges(
  before: Project,
  project: Project,
  owner: string,
) {
  const repositorySteps = [];
  if (before.repository !== project.repository) {
    const identity = project.repository
      ? "github:" + githubSlug(project.repository).toLowerCase()
      : "";
    if (identity) {
      const rows = await db()
        .prepare("SELECT id,data FROM projects WHERE owner=? AND id<>?")
        .all(owner, project.id);
      if (
        rows.some((row) => {
          const repository = JSON.parse(String(row.data)).repository;
          return (
            repository &&
            "github:" + githubSlug(repository).toLowerCase() === identity
          );
        })
      )
        throw new AppError(
          "This repository already belongs to another project in this workspace.",
          409,
        );
    }
    repositorySteps.push({
      sql: "DELETE FROM external_links WHERE owner=? AND project_id=? AND identity LIKE 'github:%'",
      parameters: [owner, project.id],
    });
    if (identity)
      repositorySteps.push({
        sql: "INSERT INTO external_links VALUES(?,?,?)",
        parameters: [owner, identity, project.id],
      });
  }
  return repositorySteps;
}
export async function versionSteps(
  before: Project,
  after: Project,
  owner: string,
) {
  const old = storedRecords(before),
    next = storedRecords(after),
    steps = [];
  for (const kind of Object.keys(old) as (keyof typeof old)[])
    if (JSON.stringify(old[kind]) !== JSON.stringify(next[kind])) {
      const existing = await db()
        .prepare(
          "SELECT id FROM versions WHERE project_id=? AND kind=? LIMIT 1",
        )
        .get(after.id, kind);
      for (const data of existing ? [next[kind]] : [old[kind], next[kind]])
        steps.push({
          sql: "INSERT INTO versions VALUES(?,?,?,?,?,?)",
          parameters: [
            randomUUID(),
            after.id,
            actorContext.getStore() || owner,
            kind,
            JSON.stringify(data),
            new Date().toISOString(),
          ],
        });
    }
  return steps;
}
export async function commitProject(
  before: Project,
  project: Project,
  owner: string,
  previousData?: string,
) {
  delete project.interest;
  delete project.role;
  delete project.workspaceOwner;
  project.updatedAt = new Date().toISOString();
  await transaction([
    {
      sql: previousData
        ? "UPDATE projects SET data=? WHERE id=? AND owner=? AND data=? RETURNING id"
        : "UPDATE projects SET data=? WHERE id=? AND owner=? RETURNING id",
      parameters: previousData
        ? [JSON.stringify(project), project.id, owner, previousData]
        : [JSON.stringify(project), project.id, owner],
      required: "The project changed. Refresh and review again.",
    },
    ...(await versionSteps(before, project, owner)),
    ...(await repositoryChanges(before, project, owner)),
  ]);
  return project;
}
