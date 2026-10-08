import { randomUUID } from "node:crypto";
import { db } from "./database";
import { AppError } from "./security";
import { projectAccess, workspaceRole } from "./access";
import { answerMemory } from "./knowledge";
import { returnNotifications, notifyOwners } from "./notifications";
import { tokenFor, saveProject, record } from "./db";
import {
  vercelRequest,
  applyDeployment,
  type VercelDeployment,
} from "./vercel";
import { syncSubscription, release } from "./billing";
import { removeObject } from "./storage";
import { reconcileStorage } from "./usage-reconcile";
import { syncProject } from "./connections";
import { executeRule, schedulePhaseFour } from "./automation";
import { createBackup } from "./recovery";
import { generateProposal } from "./action-proposals";
import { AIServiceError } from "./openai-errors";
export async function enqueue(
  actor: string,
  owner: string,
  kind: string,
  payload: unknown,
) {
  const id = randomUUID(),
    at = new Date().toISOString();
  await db()
    .prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(
      id,
      actor,
      owner,
      kind,
      "queued",
      JSON.stringify(payload),
      null,
      null,
      0,
      Date.now(),
      0,
      at,
      at,
    );
  return id;
}
export async function runJob(id: string) {
  const now = Date.now();
  const row = await db()
    .prepare(
      "UPDATE jobs SET state='running',attempts=attempts+1,lease=?,updated_at=? WHERE id=? AND attempts<3 AND ((state='queued' AND next_run<=?) OR (state='running' AND lease<?)) RETURNING *",
    )
    .get(now + 180000, new Date().toISOString(), id, now, now);
  if (!row) return;
  try {
    await workspaceRole(String(row.owner), String(row.actor));
    const input = JSON.parse(String(row.payload));
    let result: unknown;
    if (row.kind === "proposal") {
      result = await generateProposal(
        String(row.actor),
        input.projectId,
        input.proposalId,
        input.useAI,
      );
    } else if (row.kind === "sync") {
      const access = await projectAccess(
        input.projectId,
        String(row.actor),
        "control",
      );
      result =
        input.scheduled && !access.project.syncEnabled
          ? {
              message:
                "Scheduled synchronization is off. No provider read performed.",
            }
          : await syncProject(String(row.actor), input.projectId);
    } else if (row.kind === "automation")
      result = await executeRule(String(row.actor), input);
    else if (row.kind === "backup")
      result = await createBackup(
        String(row.actor),
        String(row.owner),
        input.projectIds,
      );
    else if (row.kind === "billing")
      result = await syncSubscription(String(row.owner));
    else if (row.kind === "storage") {
      if (row.actor !== row.owner)
        throw new AppError(
          "Only the billing owner can reconcile storage.",
          403,
        );
      result = await reconcileStorage(String(row.owner));
    } else if (row.kind === "memory")
      result = await answerMemory(
        String(row.actor),
        String(row.owner),
        input.question,
        input.useAI,
      );
    else if (row.kind === "deployment") {
      const access = await projectAccess(
          input.projectId,
          String(row.actor),
          "control",
        ),
        p = access.project;
      if (p.deploymentId !== input.deploymentId)
        result = { message: "A newer deployment replaced this check." };
      else {
        const deployment = (await vercelRequest(
          {
            token: await tokenFor(access.owner, "vercel"),
            teamId: p.hostingTeamId || "",
          },
          `/v13/deployments/${encodeURIComponent(p.deploymentId)}`,
        )) as VercelDeployment;
        applyDeployment(p, deployment);
        await saveProject(p, access.owner);
        if (
          ["error", "failed", "canceled"].includes(
            p.deploymentState.toLowerCase(),
          )
        )
          await notifyOwners(
            access.owner,
            p.id,
            "deployment",
            `${p.name}: deployment ${p.deploymentState}. Review provider details.`,
            `deployment:${p.deploymentId}`,
          );
        if (
          !["ready", "error", "failed", "canceled"].includes(
            p.deploymentState.toLowerCase(),
          )
        )
          throw new AppError(
            "Deployment is still processing. Check status again.",
            409,
          );
        await record(
          access.owner,
          `Verified ${p.name} deployment: ${p.deploymentState}`,
          "deploy",
          p.id,
        );
        result = { state: p.deploymentState };
      }
    } else throw new AppError("Unknown background job.");
    await db()
      .prepare(
        "UPDATE jobs SET state='succeeded',result=?,error=null,lease=0,updated_at=? WHERE id=? AND lease=?",
      )
      .run(JSON.stringify(result), new Date().toISOString(), id, now + 180000);
  } catch (error) {
    const terminal =
      Number(row.attempts) >= 3 ||
      (error instanceof AIServiceError && !error.retryable) ||
      (error instanceof AppError && [401, 403, 404].includes(error.status));
    const message =
      error instanceof AppError
        ? error.message
        : "Background work failed. Review integration setup and retry.";
    if (row.kind === "automation") {
      const input = JSON.parse(String(row.payload));
      await db()
        .prepare(
          "UPDATE automation_runs SET state=?,detail=? WHERE id=? AND state NOT IN ('succeeded','skipped')",
        )
        .run(terminal ? "failed" : "queued", message, input.runId);
    }
    await db()
      .prepare(
        "UPDATE jobs SET state=?,error=?,next_run=?,lease=0,updated_at=? WHERE id=? AND lease=?",
      )
      .run(
        terminal ? "failed" : "queued",
        message,
        Date.now() +
          Math.max(
            Number(row.attempts) * 15000,
            error instanceof AIServiceError ? error.retryAfterMs : 0,
          ),
        new Date().toISOString(),
        id,
        now + 180000,
      );
  }
}
export async function runPending(actor?: string, budgetMs = 180000) {
  const started = Date.now();
  await schedulePhaseFour(actor);
  const expiredUploads = await db()
    .prepare(
      "DELETE FROM upload_tickets WHERE expires<? RETURNING owner,object_name,size",
    )
    .all(Date.now());
  for (const ticket of expiredUploads) {
    await release(String(ticket.owner), "storage", Number(ticket.size));
    try {
      await removeObject(String(ticket.object_name));
    } catch {
      /* The expired signed URL cannot access approved immutable files. */
    }
  }
  const expired = await db()
    .prepare(
      "UPDATE invitations SET state='expired' WHERE state='pending' AND expires<? RETURNING workspace_id",
    )
    .all(Date.now());
  for (const row of expired)
    await release(String(row.workspace_id), "seats", 1);
  await db()
    .prepare(
      "UPDATE jobs SET state='failed',error='Worker stopped before completion. Retry this job.',lease=0 WHERE state='running' AND lease<? AND attempts>=3",
    )
    .run(Date.now());
  await returnNotifications(actor);
  const rows = await db()
    .prepare(
      actor
        ? "SELECT id FROM jobs WHERE actor=? AND ((state='queued' AND next_run<=?) OR (state='running' AND lease<?)) ORDER BY at LIMIT 20"
        : "SELECT id FROM jobs WHERE (state='queued' AND next_run<=?) OR (state='running' AND lease<?) ORDER BY at LIMIT 20",
    )
    .all(
      ...(actor ? [actor, Date.now(), Date.now()] : [Date.now(), Date.now()]),
    );
  for (const row of rows) {
    if (Date.now() - started >= budgetMs) break;
    await runJob(String(row.id));
  }
}
