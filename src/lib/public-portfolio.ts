import { db } from "./database";
import { workspaceAdmin, projectAccess } from "./access";
import { accountSecrets } from "./db";
import { AppError, safeUrl } from "./security";
import { handoverText } from "./phase-two";
export type PortfolioOptions = {
  title: string;
  intro: string;
  accent: "mint" | "violet" | "blue";
  projects: {
    id: string;
    demo: boolean;
    screenshots: boolean;
    enquiries: boolean;
  }[];
};
export async function portfolioPreview(
  owner: string,
  actor: string,
  options: PortfolioOptions,
) {
  await workspaceAdmin(owner, actor);
  const secrets = await accountSecrets(owner),
    text = (s: string) => handoverText(s, secrets);
  const projects = [];
  for (const selection of options.projects) {
    const a = await projectAccess(selection.id, actor, "control");
    if (a.owner !== owner)
      throw new AppError("Choose projects in this workspace.");
    const p = a.project;
    projects.push({
      id: p.id,
      name: text(p.name),
      description: text(p.description),
      status: p.status,
      color: p.color,
      inactive: p.status === "Parked" || p.hostingPaused === true,
      demoUrl: selection.demo ? safeUrl(text(p.demoUrl)) : "",
      screenshotIds: selection.screenshots ? p.screenshotIds : [],
      enquiries: selection.enquiries,
      updatedAt: p.updatedAt,
    });
  }
  return {
    title: text(options.title),
    intro: text(options.intro),
    accent: options.accent,
    projects,
  };
}
export async function publishedPortfolio(slug: string) {
  const row = await db()
    .prepare("SELECT * FROM public_portfolios WHERE slug=? AND published=1")
    .get(slug);
  if (!row) return null;
  const options = JSON.parse(String(row.data)) as PortfolioOptions;
  const p = await portfolioPreview(
    String(row.owner),
    String(row.owner),
    options,
  );
  return {
    ...p,
    slug,
    updatedAt: row.updated_at,
    projects: p.projects.map((p) => ({
      ...p,
      screenshotUrls: p.screenshotIds.map(
        (id) => `/api/showcase/${slug}/file/${id}`,
      ),
      screenshotIds: undefined,
    })),
  };
}
export async function portfolioFile(slug: string, fileId: string) {
  const row = await db()
    .prepare(
      "SELECT owner,data FROM public_portfolios WHERE slug=? AND published=1",
    )
    .get(slug);
  if (!row) throw new AppError("Portfolio is unavailable.", 404);
  const options = JSON.parse(String(row.data)) as PortfolioOptions;
  for (const s of options.projects.filter((s) => s.screenshots)) {
    const a = await projectAccess(s.id, String(row.owner));
    if (a.project.screenshotIds.includes(fileId)) {
      const f = await db()
        .prepare(
          "SELECT * FROM uploads WHERE id=? AND project_id=? AND kind='screenshot'",
        )
        .get(fileId, s.id);
      if (f) return f;
    }
  }
  throw new AppError("Screenshot is not published.", 404);
}
