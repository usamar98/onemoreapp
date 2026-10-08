import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  Download,
  Github,
  Globe,
  LockKeyhole,
} from "lucide-react";
import { sharedProject } from "@/lib/public";
import { Badge, Brand, ProjectIcon } from "@/components/ui";
import { PublicInterest } from "@/components/public-interest";
export const dynamic = "force-dynamic";
export default async function SharedPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const project = await sharedProject((await params).shareId);
  if (!project) notFound();
  return (
    <div className="shared-page">
      <header>
        <Link href="/" className="brand-link">
          <Brand />
        </Link>
        <span>One project. Plenty of possibility.</span>
        <Link href="/signup" className="button">
          Make a little room
          <ArrowUpRight size={15} />
        </Link>
      </header>
      <main id="main-content" tabIndex={-1}>
        <span className="eyebrow">A PROJECT SHARED WITH YOU</span>
        <div className="shared-title">
          <ProjectIcon project={project} size={27} />
          <h1>
            {project.name}
            <span>.</span>
          </h1>
        </div>
        <Badge status={project.status} />
        {project.inactive ? (
          <p className="shared-inactive">
            {project.hostingPaused
              ? "The application's production service is paused. This project page remains open."
              : "Work on this project is parked. Its demo may still be available, and this page remains open for its next chapter."}
          </p>
        ) : null}
        <p className="shared-description">
          {project.description || "An idea, ready for its next chapter."}
        </p>
        <div className="shared-tags">
          {project.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <div className="shared-actions">
          {project.demoUrl ? (
            <a
              href={project.demoUrl}
              target="_blank"
              rel="noreferrer"
              className="button primary"
            >
              <Globe size={17} />
              Visit live demo
              <ArrowUpRight size={16} />
            </a>
          ) : null}
          {project.repository ? (
            <a
              href={project.repository}
              target="_blank"
              rel="noreferrer"
              className="button"
            >
              <Github size={16} />
              View repository
            </a>
          ) : null}
          {project.sourceId ? (
            <a href={`/api/files/${project.sourceId}`} className="button">
              <Download size={16} />
              Download source ZIP
            </a>
          ) : null}
        </div>
        {project.handoverUrl ? (
          <a href={project.handoverUrl} className="button">
            <Download size={16} />
            Download reviewed handover
          </a>
        ) : null}
        {project.videoUrl ? (
          <section className="shared-video">
            <h2>A look at the demo</h2>
            {/\.(mp4|webm)(?:\?|$)/i.test(project.videoUrl) ? (
              <video
                controls
                preload="none"
                src={project.videoUrl}
                aria-label={`${project.name} demo video`}
              />
            ) : (
              <a
                className="button"
                href={project.videoUrl}
                target="_blank"
                rel="noreferrer"
              >
                Watch demo video <ArrowUpRight size={16} />
              </a>
            )}
          </section>
        ) : null}
        {project.screenshotIds.length ? (
          <section className="shared-gallery">
            <h2>A closer look</h2>
            {project.screenshotIds.map((id) => (
              <Image
                key={id}
                src={`/api/files/${id}`}
                width={1000}
                height={650}
                unoptimized
                alt={`${project.name} project screenshot`}
              />
            ))}
          </section>
        ) : null}
        <PublicInterest
          shareId={project.shareId}
          waitlist={project.waitlistEnabled}
          enquiries={project.enquiriesEnabled}
        />
        <div className="shared-privacy">
          <LockKeyhole size={16} />
          <p>
            The owner chose what to share here.{" "}
            {project.handoverUrl
              ? "The reviewed handover package is explicitly shared. Other private records stay with the owner."
              : project.sourceId
                ? "Source download is explicitly enabled."
                : "Source files and private project notes stay with the owner."}
          </p>
        </div>
      </main>
      <footer>
        <Brand small />
        <span>Keep every project ready for its next chapter.</span>
      </footer>
    </div>
  );
}
