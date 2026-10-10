import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { reviewData, reviewGate } from "@/lib/reviews";
import { AppError } from "@/lib/security";
import { Badge, Brand } from "@/components/ui";
import { ExternalReview } from "@/components/external-review";
import { ClientPreviewGate } from "@/components/security-forms";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Project review · Chapter",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  let data;
  try {
    data = await reviewData((await params).reviewId);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.status === 401) {
      const id = (await params).reviewId,
        gate = await reviewGate(id);
      return (
        <div className="shared-page">
          <header>
            <Link href="/">
              <Brand />
            </Link>
            <span>Shared privately for review.</span>
          </header>
          <main id="main-content">
            <ClientPreviewGate
              id={id}
              mode={gate.mode === "password" ? "password" : "email"}
            />
          </main>
        </div>
      );
    }
    return (
      <div className="shared-page">
        <header>
          <Link href="/">
            <Brand />
          </Link>
        </header>
        <main id="main-content">
          <h1>Review unavailable</h1>
          <p>
            This link expired, was revoked, or is unavailable. Ask the owner for
            a new review link.
          </p>
        </main>
      </div>
    );
  }
  return (
    <div className="shared-page">
      <header>
        <Link href="/" className="brand-link">
          <Brand />
        </Link>
        <span>A captured version, ready for feedback.</span>
      </header>
      <main id="main-content" className="launch-stack">
        <span className="eyebrow">SHARED FOR EXTERNAL REVIEW</span>
        <h1>{data.name}</h1>
        <Badge status={data.status} />
        <p className="shared-description">{data.description}</p>
        <div className="launch-card">
          <strong>Version: {data.version}</strong>
          <small>{data.record}</small>
          <small>
            Captured {data.capturedAt} · Expires{" "}
            {new Date(Number(data.expires)).toISOString()}
          </small>
        </div>
        {data.status === "Parked" ? (
          <p className="shared-inactive">
            This project was parked when these records were captured. Its public
            review remains available until expiry or revocation.
          </p>
        ) : null}
        <div className="button-row">
          {data.documentUrls.map((f) => (
            <a key={f.url} href={f.url} className="button">
              Download PDF: {f.name}
            </a>
          ))}
          {data.demoUrl ? (
            <a
              href={data.demoUrl}
              className="button primary"
              target="_blank"
              rel="noreferrer"
            >
              View demo ↗
            </a>
          ) : null}
          {data.sourceUrl ? (
            <a href={data.sourceUrl} className="button">
              Download reviewed source ZIP
            </a>
          ) : null}
        </div>
        {data.demoUrl ? (
          <p className="field-hint">
            The demo is an external application and may change independently of
            these captured records. The Chapter access gate does not protect
            this direct URL. The owner must configure deployment protection at
            its hosting provider.
          </p>
        ) : null}
        {data.htmlPreview ? (
          <section className="launch-stack">
            <h2>Saved website preview</h2>
            <iframe
              title="Captured website layout"
              className="quick-preview-frame"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={data.htmlPreview}
            />
            <p className="field-hint">
              This layout is pinned to the reviewed package. Scripts, forms and
              network requests are blocked. Application functionality is not
              verified.
            </p>
          </section>
        ) : null}
        {data.screenshotUrls.map((url, i) => (
          <Image
            key={url}
            src={url}
            width={1000}
            height={650}
            unoptimized
            alt={data.name + " reviewed screenshot " + (i + 1)}
          />
        ))}
        {data.notes ? (
          <details>
            <summary>Selected setup and project notes</summary>
            <pre className="review-text">{data.notes}</pre>
          </details>
        ) : null}
        {data.brief ? (
          <details>
            <summary>Selected resume brief</summary>
            <pre className="review-text">{data.brief}</pre>
          </details>
        ) : null}
        <ExternalReview
          initial={{
            id: data.id,
            approval: data.approval,
            comments: data.comments,
            feedback: data.feedback,
            reviewerVerified: data.reviewerVerified,
          }}
        />
        <p className="field-hint">
          The owner chose viewing, feedback and source download permissions
          separately. Files already downloaded cannot be recalled.
        </p>
      </main>
      <footer>
        <Brand small />
        <span>Keep every project ready for its next chapter.</span>
      </footer>
    </div>
  );
}
