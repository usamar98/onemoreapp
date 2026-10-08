import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { publishedPortfolio } from "@/lib/public-portfolio";
import { Brand, Badge, ProjectIcon } from "@/components/ui";
import { PortfolioEnquiry } from "@/components/portfolio-enquiry";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Project portfolio · Chapter" };
export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const p = await publishedPortfolio((await params).slug);
  if (!p) notFound();
  return (
    <div className={"shared-page public-portfolio accent-" + p.accent}>
      <header>
        <Link href="/" className="brand-link">
          <Brand />
        </Link>
        <span>A home for projects and their next chapters.</span>
      </header>
      <main id="main-content">
        <span className="eyebrow">SELECTED WORK</span>
        <h1>{p.title}</h1>
        <p className="shared-description">{p.intro}</p>
        <div className="public-portfolio-grid">
          {p.projects.map((project) => (
            <article className="portfolio-project" key={project.id}>
              <div className="shared-title">
                <ProjectIcon project={project} />
                <h2>{project.name}</h2>
              </div>
              <Badge status={project.status} />
              {project.inactive ? (
                <p className="shared-inactive">
                  This project is currently inactive. Its owner is keeping this
                  page open for its next chapter.
                </p>
              ) : null}
              <p>{project.description || "Description not recorded."}</p>
              {project.screenshotUrls.map((url, i) => (
                <Image
                  key={url}
                  src={url}
                  width={800}
                  height={500}
                  unoptimized
                  loading="lazy"
                  alt={project.name + " screenshot " + (i + 1)}
                />
              ))}
              {project.demoUrl ? (
                <a
                  href={project.demoUrl}
                  className="button"
                  target="_blank"
                  rel="noreferrer"
                >
                  Visit demo ↗
                </a>
              ) : null}
              {project.enquiries ? (
                <PortfolioEnquiry slug={p.slug} projectId={project.id} />
              ) : null}
              <small>Project record updated {project.updatedAt}</small>
            </article>
          ))}
        </div>
        {!p.projects.length ? (
          <p>No projects have been selected for this portfolio yet.</p>
        ) : null}
        <p className="field-hint">
          Selected entries update from their current project records. Source
          files and private notes are not published.
        </p>
      </main>
      <footer>
        <Brand small />
        <span>Keep every project ready for its next chapter.</span>
      </footer>
    </div>
  );
}
