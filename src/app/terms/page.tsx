import { PublicDocument } from "@/components/public-site";
import { publicMetadata } from "@/lib/site";
export const dynamic = "force-dynamic";
export const metadata = publicMetadata(
  "Service terms · Chapter",
  "Chapter service scope, project ownership, subscription limits, hosting charges, and support information.",
  "/terms",
);
export default function Terms() {
  return (
    <PublicDocument
      title="Service scope & terms."
      intro="Practical conditions for the current Chapter application. Last updated October 9, 2026."
    >
      <h2>Your projects and responsibilities</h2>
      <p>
        You retain ownership of your project content. Upload and share only
        content you are authorized to use, and check selected files before
        creating a public link, template, or handover. Protect your account and
        API tokens, and do not upload credentials or private customer data for
        sharing.
      </p>
      <h2>What Chapter provides</h2>
      <p>
        Chapter organizes stored project records and selected files, sharing,
        parking, continuation, and collaboration. Hosting, repository
        synchronization, AI features, isolated build checks, and paid
        subscriptions depend on configured integrations and the capabilities of
        those providers.
      </p>
      <p>
        A successful build check confirms the recorded dependency-install and
        build steps for the tested version. It is not a guarantee of application
        functionality. Restoring a stored record does not restore an external
        repository, deployment, or database.
      </p>
      <h2>Plans and provider charges</h2>
      <p>
        The <a href="/#pricing">pricing section</a> shows the configured Free,
        Pro, and Team limits. Paid checkout is available only when the
        installation’s billing configuration is valid. Where checkout is
        enabled, review the actual recurring amount, currency, interval, and any
        taxes before paying. Billing management is accessible from your
        workspace.
      </p>
      <p>
        Connected hosting, domains, databases, APIs, and other external services
        charge separately. Parking a project does not cancel a subscription or
        stop those services. Hosting controls require explicit confirmation and
        may not support every provider operation.
      </p>
      <h2>Availability and backups</h2>
      <p>
        Keep independent backups of important projects. Platform exports and
        preservation bundles explain their included records and files; external
        provider assets require separate backups and ownership transfers. No
        uptime, recovery-time, or support-response guarantee is stated here.
      </p>
      <h2>Help and operator details</h2>
      <p>
        For a problem with your account or a stored project, use{" "}
        <a href="/support">support</a>. The deployment operator must provide its
        legal identity, applicable commercial terms, cancellation and refund
        policy, and any required jurisdiction-specific provisions before a
        public paid launch. Those operator-specific provisions have not been
        configured in this application.
      </p>
    </PublicDocument>
  );
}
