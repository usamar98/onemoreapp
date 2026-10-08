import { db, transaction } from "./database";
import { projectAccess } from "./access";
import { accountSecrets, record } from "./db";
import { AppError, hash } from "./security";
import { handoverText } from "./phase-two";
import { answerMemory } from "./knowledge";
import { notesBrief } from "./brief";
import { versionSteps } from "./versions";
import { z } from "zod";
export const proposalKinds = ["tasks", "documentation", "brief"] as const;
export async function generateProposal(
  actor: string,
  projectId: string,
  id: string,
  useAI: boolean,
) {
  const a = await projectAccess(projectId, actor, "edit"),
    p = a.project;
  const row = await db()
    .prepare(
      "SELECT * FROM action_proposals WHERE id=? AND project_id=? AND actor=?",
    )
    .get(id, projectId, actor);
  if (!row) throw new AppError("Proposal not found.", 404);
  if (row.state === "draft" || row.state === "applied")
    return { id, state: row.state };
  const kind = z.enum(proposalKinds).parse(row.kind);
  const answer = await answerMemory(
    actor,
    a.owner,
    "Where did I stop? What setup and next task are recorded?",
    useAI,
    projectId,
  );
  const sources = answer.sources.map((s) => ({
    ...s,
    text: s.text.slice(0, 2500),
  }));
  const facts = {
    "Project purpose": p.description,
    "Setup instructions": p.memory?.setup,
    "Next task": p.nextTask || p.memory?.nextTask,
    Blockers: p.blockers || p.memory?.issues,
  };
  const missing = Object.entries(facts)
    .filter(([, value]) => !value?.trim())
    .map(([label]) => label);
  let text: string;
  if (kind === "brief") text = notesBrief(p);
  else if (kind === "documentation")
    text = [
      "# " + p.name + " — project documentation",
      ...sources.slice(0, 12).map((s) => "## " + s.label + "\n" + s.text),
      "\n## Missing information\n" +
        (missing.join("\n") ||
          "No required context fields are empty. Unrecorded work cannot be confirmed."),
    ].join("\n\n");
  else {
    const tasks = (p.nextTask || p.memory?.nextTask || "")
      .split(/\n|;\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
    text = [
      "# Suggested task plan",
      "Planning suggestions below require your review. They do not claim that work is complete.",
      p.memory?.setup
        ? "1. Review the recorded setup before changing the project:\n" +
          p.memory.setup
        : "1. Record the missing setup instructions.",
      p.blockers || p.memory?.issues
        ? "2. Review these recorded blockers:\n" +
          (p.blockers || p.memory?.issues)
        : "2. Confirm whether there are any blockers; none are recorded.",
      ...tasks.map((t, i) => i + 3 + ". Work on the saved task: " + t),
      !tasks.length
        ? "3. Record a specific next task before planning implementation."
        : "",
      Math.max(1, tasks.length) +
        3 +
        ". Verify the work, then record completed work, remaining issues and the next task.",
      "Only saved task segments are listed. Implementation details and time estimates require your input.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const data = {
    ...JSON.parse(String(row.data)),
    text:
      handoverText(text, await accountSecrets(a.owner)).slice(0, 39500) +
      (text.length > 39500
        ? "\n\n[Long context shortened for a reviewable preview. Consult the cited sources for the full record.]"
        : ""),
    sources,
    missing,
    kind: answer.kind,
    setup: "setup" in answer ? answer.setup : "",
    baseDigest: hash(a.previousData),
  };
  await db()
    .prepare(
      "UPDATE action_proposals SET state='draft',data=? WHERE id=? AND state='queued'",
    )
    .run(JSON.stringify(data), id);
  return { id, state: "draft" };
}
export async function applyProposal(
  actor: string,
  projectId: string,
  id: string,
  raw: unknown,
) {
  const input = z
    .object({
      text: z.string().trim().min(1).max(40000),
      reviewed: z.literal(true),
      digest: z.string().length(64),
    })
    .parse(raw);
  const a = await projectAccess(projectId, actor, "edit"),
    p = a.project;
  const r = await db()
    .prepare(
      "SELECT * FROM action_proposals WHERE id=? AND project_id=? AND actor=?",
    )
    .get(id, projectId, actor);
  if (!r) throw new AppError("Proposal not found.", 404);
  if (r.state === "applied") return { project: p };
  if (r.state !== "draft")
    throw new AppError("Wait for the editable preview.", 409);
  const data = JSON.parse(String(r.data));
  if (
    input.digest !== data.baseDigest ||
    hash(a.previousData) !== data.baseDigest
  )
    throw new AppError(
      "Project changed after this preview. Generate a fresh proposal and review it.",
      409,
    );
  const before = structuredClone(p),
    text = handoverText(input.text, await accountSecrets(a.owner));
  if (r.kind === "brief") {
    p.brief = text;
    p.briefKind = "reviewed";
  } else if (r.kind === "documentation") p.documentation = text;
  else p.taskBreakdown = text;
  p.updatedAt = new Date().toISOString();
  await transaction([
    {
      sql: "UPDATE projects SET data=? WHERE id=? AND owner=? AND data=? RETURNING id",
      parameters: [JSON.stringify(p), p.id, a.owner, a.previousData],
      required: "Project changed. Review again.",
    },
    ...(await versionSteps(before, p, a.owner)),
    {
      sql: "UPDATE action_proposals SET state='applied',data=? WHERE id=? AND state='draft' RETURNING id",
      parameters: [
        JSON.stringify({ ...data, text, appliedAt: p.updatedAt }),
        id,
      ],
      required: "Proposal already changed. Reload.",
    },
  ]);
  await record(
    a.owner,
    "Applied a reviewed " + r.kind + " proposal for " + p.name,
    "proposal",
    p.id,
  );
  return { project: p };
}
