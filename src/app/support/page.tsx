import { PublicDocument } from "@/components/public-site";
import { currentUser } from "@/lib/db";
import { publicMetadata } from "@/lib/site";
import styles from "@/components/landing.module.css";
export const dynamic = "force-dynamic";
export const metadata = publicMetadata(
  "Support · Chapter",
  "Get help with your Chapter workspace, integrations, project sharing, and saved project memory.",
  "/support",
);
export default async function Support() {
  const user = await currentUser().catch(() => null);
  const contact = process.env.SUPPORT_EMAIL;
  const email =
    contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : null;
  return (
    <PublicDocument
      authenticated={!!user}
      title="A little help for your next chapter."
      intro="Find the right next step, or leave a private support request from your workspace."
    >
      <h2>Contact support</h2>
      <p>
        In your workspace, open{" "}
        <strong>Launch & automation → Help & status</strong> to submit a private
        support request and receive a reference. To track product feedback and
        feature requests, use <strong>Continue & learn → Feedback</strong>.
      </p>
      <a href="/dashboard?tool=support" className={styles.primary}>
        {user ? "Open workspace support" : "Sign in to get support"}
      </a>
      {email ? (
        <p>
          You can also email <a href={"mailto:" + email}>{email}</a>. Never send
          passwords, API keys, or private customer data.
        </p>
      ) : (
        <p>
          Direct email support is not configured on this installation. No
          response-time guarantee is offered. If you cannot sign in, the site
          operator needs to provide a public contact address.
        </p>
      )}
      <h2>Connecting a provider</h2>
      <p>
        Chapter currently connects to GitHub and Vercel through your account.
        Vercel deployments support static HTML and exported web builds. An
        uploaded source archive does not become a deployment automatically. Open
        Integrations to connect, reconnect, or disconnect a provider;
        unavailable integrations show setup instructions.
      </p>
      <h2>A deployment or resume check failed</h2>
      <p>
        Review the reported error and tested version before retrying. Verify the
        required configuration names and the provider’s status. A build check is
        separate from a deployment and does not verify every application
        feature. Parking alone does not stop hosting or external charges.
      </p>
      <h2>Files, privacy, and recovery</h2>
      <p>
        Check the selected package version, expiry, revocation, and download
        permission when a transfer fails. Private records and files can be
        exported through the workspace’s backup and recovery tools. External
        repositories, databases, domains, and provider accounts are not included
        in platform backups.
      </p>
      <h2>Service setup status</h2>
      <p>
        The{" "}
        <a href="/api/health" target="_blank" rel="noreferrer">
          public health endpoint
        </a>{" "}
        reports application availability and configured services. It is a
        point-in-time check, not an uptime history. Workspace Help & status
        provides more setup detail after login.
      </p>
    </PublicDocument>
  );
}
