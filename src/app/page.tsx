import Image from "next/image";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  LockKeyhole,
  Globe,
  FolderArchive,
  Link2,
  BookOpen,
  Users,
  ChevronRight,
  Music2,
  Pause,
  Sprout,
  Github,
} from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/public-site";
import styles from "@/components/landing.module.css";
import { currentUser } from "@/lib/db";
import { publicPlans, storageLabel } from "@/lib/public-pricing";
import { publicMetadata, siteOrigin, siteDescription } from "@/lib/site";
import { demoProjects } from "@/lib/demo";
export const dynamic = "force-dynamic";

export const metadata = publicMetadata(
  "Chapter · Side project management, hosting & sharing",
  siteDescription,
);
const features = [
  {
    Icon: Globe,
    title: "A home for your live demos.",
    text: "Connect your Vercel account and deploy a supported static build. Keep your repository, deployment status, and demo link with the project.",
    detail: "Vercel · static HTML and exported web builds",
  },
  {
    Icon: Link2,
    title: "Share the right things.",
    text: "Give each project its own page. Choose screenshots, demos, and downloads separately, or send a versioned package with an expiring, revocable link.",
    detail: "Private by default · explicit sharing controls",
  },
  {
    Icon: FolderArchive,
    title: "Park it. Keep the context.",
    text: "Save the version, setup instructions, known issues, and the reason you stopped. Preserve selected files in a versioned bundle for later.",
    detail: "Parking saves context; hosting keeps running",
  },
  {
    Icon: BookOpen,
    title: "Pick up the thread with AI.",
    text: "Turn saved notes and available repository information into an editable resume brief. Review it, then take it to your preferred coding assistant.",
    detail: "AI when configured · saved-notes fallback included",
  },
  {
    Icon: Users,
    title: "Build together, hand over clearly.",
    text: "Invite an Editor or Viewer, assign tasks, and leave comments. Prepare a reviewed handover with selected files, next steps, and a transfer checklist.",
    detail: "Project-level permissions · workspace roles",
  },
];
const faqs = [
  [
    "What can I host with Chapter?",
    "Chapter connects to your Vercel account to deploy supported static HTML and exported web builds. Upload a deployable build with an index.html; a source ZIP is stored separately and is not automatically deployable. Server applications and managed databases need their own provider setup. Isolated npm build checks require a configured build environment.",
  ],
  [
    "Are my projects and source files public?",
    "No. Projects start private. You choose what a project page, review link, portfolio, or package link exposes. Viewing a demo does not grant access to source files, and workspace roles are checked on downloads.",
  ],
  [
    "Does parking a project stop hosting or billing?",
    "Parking saves your project memory and changes its status. It does not stop hosting. Separate Vercel hosting controls require owner confirmation; databases, domains, and other external services may continue to incur charges.",
  ],
  [
    "Do I need AI to resume a project?",
    "No. You can use a saved-notes brief and a guided resume session without AI. AI-assisted briefs and proposals require a configured provider and available usage. They use authorized context, identify missing information, and can be reviewed before changes are applied.",
  ],
  [
    "Can I use Chapter with clients or a small team?",
    "Yes. Workspaces support Owner, Editor, and Viewer roles with project-specific access. External review links can collect feedback on a selected version without granting dashboard access. Seat limits, including the workspace owner, depend on your plan.",
  ],
  [
    "Can I export or hand over my projects?",
    "You can export stored project records and supported files, create preservation bundles, and prepare reviewed handover packages. External repositories, hosting accounts, databases, domains, and services remain with their providers. A verified build confirms an install/build check, not that every application feature works.",
  ],
  [
    "Can I publish my project as a paid AI tool?",
    "Publish as a Paid AI Tool is Coming Soon. There is currently no tool marketplace, metered customer billing, or automatic monetization. Today you can share a project page, demo, portfolio, and selected files.",
  ],
];
export default async function Home() {
  const [account, pricing] = await Promise.allSettled([
    currentUser(),
    publicPlans(),
  ]);
  const authenticated = account.status === "fulfilled" && !!account.value;
  const start = authenticated ? "/dashboard" : "/signup";
  const memory = demoProjects.find((p) => p.name === "Focus.fm")!.memory!;
  const url = siteOrigin();
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": url + "/#organization",
        name: "Chapter",
        url,
        logo: url + "/icon.svg",
      },
      {
        "@type": "WebSite",
        "@id": url + "/#website",
        name: "Chapter",
        url,
        description: siteDescription,
        publisher: { "@id": url + "/#organization" },
      },
      {
        "@type": "SoftwareApplication",
        name: "Chapter",
        url,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web",
        description: siteDescription,
      },
    ],
  };
  return (
    <div className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <SiteHeader authenticated={authenticated} />
      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-heading">
          <div className={styles.heroIntro}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>
                <span /> FOR INDIE DEVELOPERS & AGENCIES
              </p>
              <h1 id="hero-heading">
                Manage, host, and share your side projects<span>.</span>
              </h1>
              <p className={styles.heroDescription}>
                Keep your projects, live demos, shared files, and next steps in
                one place—ready whenever you return.
              </p>
              <div className={styles.ctas}>
                <a href={start} className={styles.primary}>
                  Start Your Workspace{" "}
                  <ArrowRight size={18} aria-hidden="true" />
                </a>
                <a href="#how-it-works" className={styles.secondary}>
                  See How It Works <ChevronRight size={17} aria-hidden="true" />
                </a>
              </div>
              <p className={styles.heroNote}>
                <LockKeyhole size={13} aria-hidden="true" /> Private by default.
                Free to get started.
              </p>
            </div>
            <aside
              className={styles.memoryAside}
              aria-label="Example saved project memory"
            >
              <span className={styles.marginLabel}>
                YOUR NEXT CHAPTER, SAVED.
              </span>
              <div className={styles.memoryCard}>
                <div className={styles.memoryHeader}>
                  <span className={styles.musicIcon}>
                    <Music2 size={21} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>Focus.fm</strong>
                    <span>Focus timer & ambient sound</span>
                  </div>
                  <span className={styles.parked}>
                    <Pause size={11} aria-hidden="true" /> Parked
                  </span>
                </div>
                <div className={styles.memoryVersion}>
                  <span>PROJECT MEMORY</span>
                  <span>{memory.version}</span>
                </div>
                <h2>Right where you left it.</h2>
                <p>{memory.reason}</p>
                <div className={styles.nextTask}>
                  <span>NEXT TASK</span>
                  <p>{memory.nextTask}</p>
                  <span className={styles.recorded}>
                    <Check size={12} aria-hidden="true" /> Saved with your
                    project
                  </span>
                </div>
                <div className={styles.memoryBottom}>
                  <BookOpen size={14} aria-hidden="true" />
                  <span>Context ready. Whenever you are.</span>
                </div>
              </div>
              <span className={styles.exampleLabel}>
                Example project · real workspace fields
              </span>
            </aside>
          </div>
          <figure className={styles.productPreview}>
            <div className={styles.previewBar}>
              <span>
                <span className={styles.windowDot} />
                <span className={styles.windowDot} />
                <span className={styles.windowDot} />
              </span>
              <span>
                <LockKeyhole size={12} aria-hidden="true" /> chapter / your
                workspace
              </span>
              <span className={styles.previewLabel}>
                A PLACE FOR EVERY PROJECT
              </span>
            </div>
            <div className={styles.previewImage}>
              <Image
                src="/images/dashboard-preview.webp"
                width={1440}
                height={960}
                sizes="(max-width: 740px) 100vw, (max-width: 1240px) 92vw, 1160px"
                loading="lazy"
                alt="Chapter example dashboard with Building, Live, Idea and Parked project cards, Share and Resume actions, and a draggable priority queue."
              />
            </div>
            <figcaption>
              <span>
                <span className={styles.captionDot} /> Your projects. Your
                priorities. Your next step.
              </span>
              <a href="/demo">
                Explore the example workspace{" "}
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </figcaption>
          </figure>
        </section>
        <section
          id="features"
          className={styles.features}
          aria-labelledby="features-heading"
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>LESS SCATTERED. MORE READY.</p>
            <h2 id="features-heading">
              Everything a project needs.
              <br />
              <span>Even a little breathing room.</span>
            </h2>
            <p>
              From the first idea to the next handover, keep the things that
              matter close to the work.
            </p>
          </div>
          <div className={styles.featureRows}>
            {features.map(({ Icon, title, text, detail }, index) => (
              <article className={styles.featureRow} key={title}>
                <span className={styles.featureNumber}>0{index + 1}</span>
                <div className={styles.featureTitle}>
                  <Icon size={23} strokeWidth={1.6} aria-hidden="true" />
                  <h3>{title}</h3>
                </div>
                <div className={styles.featureText}>
                  <p>{text}</p>
                  <span>{detail}</span>
                </div>
              </article>
            ))}
          </div>
          <div className={styles.comingSoon}>
            <div>
              <span className={styles.soonBadge}>COMING SOON</span>
              <h3>Publish as a Paid AI Tool</h3>
            </div>
            <p>
              A future way to offer your tools to others.
              <br />
              Tool monetization is not available today.
            </p>
          </div>
        </section>
        <section
          id="how-it-works"
          className={styles.how}
          aria-labelledby="how-heading"
        >
          <div className={styles.howIntro}>
            <p className={styles.eyebrow}>A SIMPLE RHYTHM</p>
            <h2 id="how-heading">
              Build. Take a break.
              <br />
              Come back with a plan.
            </h2>
            <p>
              One workspace for the projects you are building now and the ones
              you will return to later.
            </p>
            <a href={start} className={styles.textLink}>
              Make room for your next project{" "}
              <ArrowRight size={17} aria-hidden="true" />
            </a>
          </div>
          <ol className={styles.steps}>
            <li>
              <span>01</span>
              <div>
                <h3>Add your project</h3>
                <p>
                  Start with an idea, connect a GitHub repository, or upload a
                  source ZIP. Add screenshots, a demo, and the details worth
                  remembering.
                </p>
                <div className={styles.stepTags}>
                  <span>
                    <Github size={12} aria-hidden="true" /> GitHub
                  </span>
                  <span>Source ZIP</span>
                  <span>Manual entry</span>
                </div>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Organize and share</h3>
                <p>
                  Choose a status, reorder your priority queue, and decide
                  exactly what to share. Keep private files separate from public
                  demos.
                </p>
                <div className={styles.stepTags}>
                  <span>Idea</span>
                  <span>Building</span>
                  <span>Live</span>
                  <span>Parked</span>
                  <span>Archived</span>
                </div>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Return and continue</h3>
                <p>
                  Open your saved memory, review readiness checks, and start a
                  guided resume session. Confirm what changed and save the next
                  task.
                </p>
                <div className={styles.stepTags}>
                  <span>
                    <BookOpen size={12} aria-hidden="true" /> Saved context
                  </span>
                  <span>One clear next step</span>
                </div>
              </div>
            </li>
          </ol>
        </section>
        <section
          id="pricing"
          className={styles.pricing}
          aria-labelledby="pricing-heading"
        >
          <div className={styles.pricingHeading}>
            <div>
              <p className={styles.eyebrow}>ROOM TO GROW</p>
              <h2 id="pricing-heading">
                Start small.
                <br />
                Keep your possibilities open.
              </h2>
            </div>
            <p>
              The same project workflows, with more room as your workspace
              grows. Hosting-provider charges are separate.
            </p>
          </div>
          {pricing.status === "fulfilled" ? (
            <div className={styles.plans}>
              {pricing.value.map((plan) => (
                <article
                  className={styles.plan}
                  key={plan.name}
                  data-plan={plan.name}
                >
                  <div className={styles.planTop}>
                    <h3>{plan.name}</h3>
                    <span>
                      {plan.name === "Free"
                        ? "For your next idea"
                        : plan.name === "Pro"
                          ? "For a growing collection"
                          : "For working together"}
                    </span>
                  </div>
                  <p className={styles.price}>
                    {plan.price}
                    <span>{plan.interval || "Paid subscriptions"}</span>
                  </p>
                  <ul>
                    <li>
                      <Check size={15} aria-hidden="true" />{" "}
                      {plan.limits.projects.toLocaleString("en")} projects
                    </li>
                    <li>
                      <Check size={15} aria-hidden="true" />{" "}
                      {storageLabel(plan.limits.storage)} stored files
                    </li>
                    <li>
                      <Check size={15} aria-hidden="true" />{" "}
                      {plan.limits.ai.toLocaleString("en")} AI requests / month*
                    </li>
                    <li>
                      <Check size={15} aria-hidden="true" /> {plan.limits.seats}{" "}
                      workspace seats, including you
                    </li>
                  </ul>
                  <a
                    className={
                      plan.name === "Free" ? styles.primary : styles.planButton
                    }
                    href={
                      plan.available
                        ? plan.name === "Free"
                          ? start
                          : authenticated
                            ? "/dashboard?billing=return"
                            : "/signup?next=" +
                              encodeURIComponent("/dashboard?billing=return")
                        : start
                    }
                  >
                    {plan.name === "Free" || !plan.available
                      ? "Start with Free"
                      : "Choose " + plan.name}
                    <ArrowRight size={16} aria-hidden="true" />
                  </a>
                  <p className={styles.planNote}>{plan.note}</p>
                </article>
              ))}
            </div>
          ) : (
            <p role="status" className={styles.pricingError}>
              Plan information is temporarily unavailable.{" "}
              <a href="/support">Contact support</a> or try again later.
            </p>
          )}
          <div className={styles.pricingFootnote}>
            <span>
              * AI features require a configured provider and available quota.
              Saved-notes briefs remain usable without AI.
            </span>
            <span>
              Vercel, database, domain, and other external service costs are
              billed by their providers.
            </span>
          </div>
        </section>
        <section id="faq" className={styles.faq} aria-labelledby="faq-heading">
          <div>
            <p className={styles.eyebrow}>A FEW GOOD QUESTIONS</p>
            <h2 id="faq-heading">
              Before your
              <br />
              next chapter.
            </h2>
            <p>
              Something else on your mind?
              <br />
              <a href="/support" className={styles.textLink}>
                Visit support <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </p>
          </div>
          <div className={styles.questions}>
            {faqs.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className={styles.finalCta} aria-labelledby="final-heading">
          <div className={styles.finalInner}>
            <Sprout size={34} strokeWidth={1.5} aria-hidden="true" />
            <p className={styles.eyebrow}>THERE’S ALWAYS ANOTHER CHAPTER.</p>
            <h2 id="final-heading">
              Give your next idea
              <br />a place to come back to.
            </h2>
            <p>Keep every project ready for its next chapter.</p>
            <a href={start} className={styles.lightButton}>
              Start Your Workspace <ArrowRight size={18} aria-hidden="true" />
            </a>
            <span>Private by default. Free to get started.</span>
          </div>
          <span className={styles.finalMark} aria-hidden="true">
            ↗
          </span>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
