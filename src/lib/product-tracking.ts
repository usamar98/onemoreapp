import { projectAccess, workspaceRole } from "./access";
import { db } from "./database";
import { AppError } from "./security";
import { productEvent, type ProductAction } from "./product-insights";
export async function trackOutcome(
  actor: string,
  request: Request,
  parts: string[],
  response?: Response,
  previous = new Map<string, string>(),
) {
  if (request.method === "GET") return;
  const [section, id, action] = parts;
  let kind: ProductAction | undefined;
  if (section === "projects" && id === "import") kind = "import";
  if (section === "discovery" && id === "import") kind = "import";
  if (section === "projects" && ["upload", "upload-complete"].includes(action))
    kind = "import";
  if (section === "projects" && action === "share") kind = "share";
  if (section === "projects" && action === "park") kind = "park";
  if (section === "projects" && action === "handover-create") kind = "handover";
  if (!kind) return;
  try {
    const owner = request.headers.get("x-chapter-workspace") || actor;
    if (!response || !response.ok) {
      if (section === "projects" && id !== "import") {
        const a = await projectAccess(
          id,
          actor,
          kind === "share" ? "control" : "edit",
        );
        await productEvent(actor, a.owner, id, kind, "failed");
      } else {
        const a = await workspaceRole(owner, actor);
        if (a.role !== "Viewer" && !a.scope)
          await productEvent(actor, owner, "", kind, "failed");
      }
      return;
    }
    const data = await response.clone().json();
    if (kind === "import" && data.results) {
      for (const r of data.results) {
        if (r.state === "Imported privately")
          await productEvent(
            actor,
            owner,
            r.id,
            "import",
            "completed",
            "import:" + r.id,
          );
        else if (r.state !== "Already imported")
          await productEvent(actor, owner, "", "import", "failed");
      }
      return;
    }
    const p = data.project;
    if (!p) return;
    const a = await projectAccess(p.id, actor);
    if (kind === "share" && !p.shared) return;
    if (
      kind === "import" &&
      action &&
      !p.quickPublish &&
      (!p.sourceId || !Array.isArray(data.excluded))
    )
      return;
    const eventId =
      kind === "share"
        ? "first-share:" + p.id
        : kind === "park"
          ? "park:" + p.id + ":" + p.memory?.savedAt
          : kind === "handover"
            ? "handover:" + p.handover?.id
            : "import:" +
              p.id +
              ":" +
              (p.quickPublish?.assetId || p.sourceId || "metadata");
    await productEvent(actor, a.owner, p.id, kind, "completed", eventId);
  } catch (error) {
    if (error instanceof AppError && [401, 403, 404].includes(error.status))
      return;
    // Metrics are metadata only; failures cannot fail a successful project workflow.
    console.error(
      JSON.stringify({ event: "product_metrics_unavailable", action: kind }),
    );
  }
}
