import { PublicDocument } from "@/components/public-site";
import { publicMetadata } from "@/lib/site";
export const dynamic = "force-dynamic";
export const metadata = publicMetadata(
  "Privacy · Chapter",
  "How Chapter handles workspace records, uploads, sharing permissions, AI context, and account information.",
  "/privacy",
);
export default function Privacy() {
  return (
    <PublicDocument
      title="Privacy, with clear boundaries."
      intro="This page describes the data handled by the current Chapter application. Last updated October 9, 2026."
    >
      <h2>Information stored in your workspace</h2>
      <p>
        Chapter stores your account name, email, password hash, and sign-in
        sessions. Project records can include descriptions, repository and demo
        links, notes, setup instructions, tasks, versions, expenses, and
        activity. Files you select for upload, templates, preservation bundles,
        and backups are stored by the platform.
      </p>
      <p>
        Collaboration adds memberships, assignments, comments, and
        notifications. If you enable public interest forms, the platform stores
        submitted waitlist and enquiry information. Support and product feedback
        may include attachments and diagnostic information when you choose to
        provide them.
      </p>
      <h2>Private records and deliberate sharing</h2>
      <p>
        Projects start private. Workspace roles and project permissions control
        access. Owners can separately publish project pages and portfolios,
        create external review links, or permit selected downloads. Anyone who
        has an enabled public link may see the selected content; a recipient who
        has already downloaded a file keeps that copy even after the link is
        revoked.
      </p>
      <h2>Connected services and AI</h2>
      <p>
        Connecting a repository or hosting account lets Chapter request the
        information needed for the selected integration. Integration credentials
        are stored encrypted by the application and are not intended for shared
        pages, exports, or briefs. Configured external providers process
        requests under their own policies.
      </p>
      <p>
        When you request an AI feature, or enable an AI workflow rule,
        authorized project context may be sent to the configured AI provider.
        The application filters recognized secrets, but you should keep
        credentials and private customer data out of notes and selected files.
        Saved-notes briefs can be used without AI.
      </p>
      <h2>Cookies and usage information</h2>
      <p>
        Chapter uses a session cookie for authentication and local browser
        storage for workspace selection. It records product action events and
        operational status to distinguish completed workflows from failures. The
        product usage events do not contain source files or private project
        notes. This homepage does not add advertising trackers.
      </p>
      <h2>Billing and external infrastructure</h2>
      <p>
        If configured, Stripe handles checkout and billing management. Chapter
        stores subscription identifiers, status, and usage limits; payment card
        entry takes place through Stripe. Repository, hosting, database, domain,
        storage, and AI services remain external to Chapter and may retain their
        own records.
      </p>
      <h2>Export, retention, and requests</h2>
      <p>
        Workspace tools let authorized users export supported stored records and
        files, review sharing settings, and revoke eligible links. Package
        retention settings apply to the selected stored packages, not to
        external provider assets or copies already downloaded. Contact the site
        operator through <a href="/support">support</a> for account or
        data-deletion requests; there is currently no self-service
        account-deletion screen.
      </p>
      <p>
        The public operator identity, privacy contact, jurisdiction-specific
        notices, and applicable retention commitments must be supplied by the
        deployment operator before a public commercial launch. This
        implementation description does not supply those details.
      </p>
    </PublicDocument>
  );
}
