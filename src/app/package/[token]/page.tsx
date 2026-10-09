import { Brand } from "@/components/ui";
import { PackageTransfer } from "@/components/package-transfer";
import { activePackageLink } from "@/lib/file-transfers";
import { PackageVisit } from "@/components/package-visit";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Shared package · Chapter",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function PackagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  try {
    const { link, bundle: b } = await activePackageLink(token);
    return (
      <main className="package-page">
        <Brand />
        <article>
          <span className="eyebrow">A preserved project version</span>
          <h1>{b.data.projectName}</h1>
          <p>
            Version {b.id} · saved {new Date(b.at).toLocaleDateString("en-GB")}
          </p>
          <p>
            {b.data.files.length} selected files ·{" "}
            {(b.data.bytes / 1024 ** 2).toFixed(2)} MB · expires{" "}
            {new Date(Number(link.expires)).toLocaleDateString("en-GB")}
          </p>
          <p>{b.data.limitation}</p>
          <details>
            <summary>Package integrity</summary>
            <code>{b.data.packageSha256}</code>
          </details>
          <PackageTransfer token={token} />
          <Visit token={token} />
        </article>
      </main>
    );
  } catch {
    return (
      <main className="package-page">
        <Brand />
        <article>
          <h1>This package is unavailable</h1>
          <p>
            The owner may have revoked access, the link may have expired, or the
            selected package is no longer retained. Ask the owner for a new
            reviewed link.
          </p>
          <a className="button" href="/">
            Back to Chapter
          </a>
        </article>
      </main>
    );
  }
}
function Visit({ token }: { token: string }) {
  return <PackageVisit token={token} />;
}
