# Chapter Phase Four

Phase Four extends the existing architecture, private workspace permissions and visual style. Open **Launch & automation** in the dashboard. Local SQLite upgrades on first use. Existing Supabase installations must reapply cloud/schema.sql and run npm run cloud:check before deploying; there are now **33 private tables**.

## Guided import and connections

**Get started** walks through account connections, discovery, match review and private import. GitHub discovery reads up to 500 accessible repositories; Vercel discovery reads up to 500 projects in the connected account/team. Exact repository links are explained as matches. Name-only matches are explicitly uncertain and are not chosen automatically. Branches, monorepo roots and multiple deployments require owner review.

Connect GitHub with a fine-grained personal access token restricted to the selected repositories, with read-only Contents access. GitHub automatically includes metadata access. Connect Vercel with an account token scoped to the chosen account/team, plus its team ID when applicable. Vercel account tokens also enable deliberately confirmed deployments/hosting controls; Chapter does not claim they are read-only credentials. Reconnect and disconnect controls are available. Tokens are encrypted on the server and never included in client responses or exports.

Reviewed bulk import creates **metadata records only**: descriptions, repository links, existing production URLs and deployment references. It does not clone every repository, create deployments, change production, pause hosting or publish source. Import a pinned source snapshot through the existing **New project → GitHub repository** workflow, or upload a ZIP when needed. Repository/deployment identities prevent duplicate imports, including repeated submissions. A quota failure reports which selection failed and preserves successful earlier selections. Import up to 50 reviewed selections per batch; discovery batches expire after 30 minutes.

These connections use the existing personal-token architecture. Provider OAuth/GitHub App installation flows and webhook-driven synchronization are not implemented. Public commercial release should replace personal-token onboarding with scoped provider applications.

## Read-only synchronization

**Sync** queues a persistent job. It reads available repository metadata, README and the latest default-branch commit, plus Vercel production deployment and pause status. It shows last complete success, last attempt and actionable errors. A partial failure does not move the last-success timestamp forward. Reconnect or correct permissions and retry.

Sync never replaces the stored source-package version, project lifecycle status, chosen demo URL or parking memory. Latest remote commit and stored uploaded version remain separate. Scheduled sync is opt-in, deduplicated in six-hour windows, and runs when a background worker or authenticated request sweep processes it. Disconnecting a token stops future reads; scheduled jobs recheck permissions and connection availability.

## Rules and background jobs

Available rules:

| Rule          | Saved evidence                                           | Effect                                                                            |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Return date   | Parking date and Parked status                           | One private in-app reminder per recorded date                                     |
| Inactivity    | Last recorded human activity, chosen day threshold       | A visible inactivity flag; no invented activity from outside Chapter              |
| Notes changed | Fingerprint of saved setup, blockers and next-task notes | Refreshes a saved-notes brief, records a version, and consumes no paid AI request |

Each rule requires a preview and confirmation. The brief preview explicitly warns that a refreshed brief replaces an edited brief; previous records remain versioned. Rules have an off switch, execution history and retry status. Deterministic event IDs and database uniqueness prevent the same event causing duplicate effects. Execution rechecks ownership, current notes and whether the rule remains enabled. Stale/off events are skipped. No rule can pause, resume or deploy hosting. Existing hosting controls require a fresh owner confirmation and provider verification.

Background jobs use persistent leases, backoff and up to three attempts. Failed jobs can be retried deliberately. Watch-mode workers retry sweep failures with capped backoff. For continuous local processing, run **npm run jobs:work -- --watch**. Without --watch the worker performs one sweep. Authenticated mutations also schedule work after responding. Notifications settings control return-date notification delivery, including the reminders already present in Phase Three.

On Vercel set a private CRON_SECRET of at least 32 characters. The checked-in daily cron calls GET /api/cron/jobs with its bearer secret. Six-hour sync is a maximum frequency, not a promise of six-hour execution: daily cron processes it daily. Use an appropriate higher-frequency scheduler/worker for timely unattended reminders and retries. Do not claim unattended automation is operating until that worker is configured.

## External version reviews

Owners preview and create a capability link for the current frozen snapshot or a selected stored notes/brief/package version. The preview identifies the historical record and explains that overview fields are captured at link creation. This is not an immutable Git branch/tag or a full repository version.

Demo viewing, screenshots, feedback, source downloads and setup/notes are separate choices. Source permission defaults off. For source-enabled reviews, the owner sees the complete eligible text-file list and contents before confirming. Credentials, customer export files and unsupported binary assets are excluded; only that sanitized source selection is downloadable, never the original ZIP. Later downloads revalidate the captured file digest and privacy checks.

Links expire after 1–90 days and may be revoked immediately. Comments and Pending/Approved/Changes Requested status stay attached to the frozen reviewed snapshot. Link holders enter their own names; approval is unverified feedback, not an authenticated signature. Use workspace invitations when verified collaborator identity is needed. Anyone possessing the active link has its selected permissions. Public review data has no hidden source payload, integration credentials or workspace identity.

## Public portfolio

Choose projects, title, introduction, address and accent; preview before explicitly publishing. Each entry separately opts into demo viewing, screenshots and enquiries. Portfolio publication is independent of the project's original share switch, and does not expose repositories, notes or source.

Published cards show current recorded project status. Parked projects say they are inactive. Enquiry forms request consent and save contact details privately for authorized Owners; in-app notifications link to the project. Enquiry request IDs prevent duplicate submissions. Unpublish removes access to the page and its screenshot routes. Previously downloaded copies cannot be recalled, and already-issued private cloud download URLs expire within 60 seconds.

## Portable project export and recovery

**Backups** creates a private downloadable ZIP of selected authorized projects. It includes project records, task estimates/blockers, parking records, expenses, comments/activity, stored versions, uploaded source/build/screenshots/handovers and selected configuration summaries. It includes private starter documentation owned by the exporter. Enquiry/signup contact details, account/session credentials, integration tokens, invitations, billing identities and active share tokens are omitted. Files are scanned again for credentials. Uploaded assets may still contain confidential data; keep exports private.

Format **chapter-export-v1**:

| Path              | Contents                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| records.json      | Format/version, export time, project records, parking records, versions, source file metadata and SHA-256 checksums |
| files/<upload-id> | Immutable stored uploaded bytes; archives are rescanned                                                             |
| README.md         | Format, privacy, provider-assets and recovery instructions                                                          |

Limits are 100 selected projects, 18 MiB compressed, 40 MiB of uploaded file bytes, and 5 MiB of JSON metadata. Split larger selections. Backups and temporary upload reservations count toward storage limits. Downloaded backups should be copied off-site; a backup next to the database does not protect against losing that database.

Recovery checks ZIP paths, size, schemas, file ownership references and checksums, then shows a preview. Full-workspace Editors/Owners may restore a reviewed selection as **new independent private projects**. Files and version references receive new IDs. Repeated confirmation is idempotent. Original projects, repositories, deployments, databases and subscriptions are unchanged. Hosting connections, sharing, public portfolios, automation, sync and assignments are disabled on restored copies. Historical comments/activity become attributed-as-recovered text; original team identities are not restored.

Configuration summaries and private starter definitions remain documentation for manual setup. Historical interest totals are not inserted as new visits/signups. A repository URL does not back up its Git history. Provider assets, domains, provider databases and third-party accounts remain with those providers.

On cloud deployments, uploaded recovery archives go directly into private staging storage using actor/workspace-bound tickets; preview and restore read bounded bytes on the server. Successful recovery removes the ticket and releases its reservation. Unfinished tickets expire after two hours; the worker removes expired objects/reservations. Configure daily cleanup of unreferenced staging objects older than 24 hours as a fallback. Large backup/screenshot downloads use authorized, short-lived Storage URLs to avoid Vercel response-body limits.

## Local operator disaster recovery

The user-facing ZIP is deliberately not an account/database dump. A separate local operator tool backs up **all SQLite tables and the encryption key** in an authenticated AES-256-GCM encrypted archive. Use an independent private passphrase of at least 20 characters in CHAPTER_BACKUP_PASSWORD, supplied through a password manager, ignored environment file or private environment injection. Never put it in command arguments or Git.

1. Run **npm run backup:local -- create <new-file.chapterbackup>**. The tool makes a consistent SQLite online snapshot, verifies integrity, checksums and table counts, then encrypts it. It refuses cloud-object references and local databases over 128 MiB.
2. Copy that encrypted file off-site and retain its passphrase separately.
3. Run **npm run backup:local -- restore <file.chapterbackup> <new-directory>**. It verifies authentication, checksums and exact table counts. It refuses existing destinations and leaves the running platform untouched.
4. Read recovery-report.json. Test login, project/file access and records against the new directory using CHAPTER_DATA_DIR. Do not use the old CHAPTER_ENCRYPTION_KEY environment value if it differs from the recovered key.
5. Recovery invalidates sessions and quarantines pending jobs, sync, rules, portfolios and public links. Review them before deliberately re-enabling. Existing connected credentials remain encrypted with the recovered key. Verify current subscription/provider states before returning the recovered instance to service.

The operator archive contains sensitive account/customer data inside encryption and is never available through a user/public route. Actual recovery of account records, team roles, files, key bytes and quarantine behavior is tested. The app itself is not stopped or switched automatically.

## Cloud operator backups

The SQLite operator tool refuses cloud mode. Configure provider backups for PostgreSQL **and separately for private Storage objects**, and retain CHAPTER_ENCRYPTION_KEY securely. Supabase database backups contain Storage metadata, not the objects themselves; see [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups). Recovery must use a separate database/bucket first, verify its access controls, files and key, then reconcile live Stripe/Vercel state. No cloud backup policy, paid point-in-time recovery or hosted database restoration was provisioned by this implementation. User-facing portable project backups still work in cloud mode.

## Launch and support setup

- Follow VERCEL_SETUP.md for the canonical HTTPS origin, secure cookies, PostgreSQL/private bucket and persistent encryption key. Apply all 33 private tables. Run npm run cloud:check against the real environment.
- Configure Stripe test credentials, separate recurring price IDs, portal settings and signed webhook as documented in PHASE_THREE.md. Hosting costs remain separate. Limits also apply to bulk imports, backups, recovery files and recovered projects.
- Configure OPENAI_API_KEY only on the server if paid AI briefs/answers are needed. Saved-notes workflows remain available without it. Automated brief refresh currently uses saved notes.
- Set SUPPORT_EMAIL to a monitored human support inbox. **Help & status** saves a private issue/reference and offers a manual email link. It never claims to have sent email. Automatic transactional email, email verification and password-reset delivery are not implemented.
- GET /api/health checks database/schema availability without returning account/configuration details. Point an external uptime monitor at it. Help & status labels configuration presence honestly; it is not a live verification of every provider.
- API responses include X-Request-ID; server failures include a safe support reference. Logs record failure status/timing without provider bodies, notes, tokens or raw request paths. Persistent jobs expose retries and actionable provider errors. Configure deployment logs/alerts in your host; no external monitoring account was created.
- Panels have accessible labels, dialog focus trapping/restoration, visible loading/error states and keyboard controls. There is a skip link, reduced-motion support, mobile layouts and a lazily loaded Phase Four interface. Dashboard interest metrics load in one grouped query rather than one query per card.

## Verification and remaining launch limits

Verified locally on 2026-10-07: production build and TypeScript compilation passed; all 22 backend tests passed; all eight production-browser workflows passed with real public GitHub import enabled. The final automation change was also checked by a targeted production-browser rerun and backend regressions covering notes changed back to earlier values. Local health returned HTTP 200. Test data used separate directories; the existing saved workspace was preserved.

Run **npm run typecheck**, **npm test**, **npm run build**, then **npm run test:e2e** with the app running. Set TEST_BASE_URL for an isolated test server and LIVE_GITHUB_TEST=true to exercise a real public repository import.

Backend checks cover real local PostgreSQL schema/RLS denial, ownership/scope, atomic usage limits, mocked Vercel/GitHub reads and failures, webhook signatures/subscription changes, deduplicated rules, reviewed source privacy, backup checksums, recovery idempotency and encrypted local disaster recovery. Browser flows cover original ZIP/screenshots → organize → share → park → resume, interest/readiness/handover, team/private search/templates/version restore, and Phase Four review feedback/portfolio enquiries/recovery/permission denials/mobile focus.

Live Vercel publishing/pause, Supabase remote object persistence, Stripe checkout/webhooks and OpenAI generation require configured accounts and are **not verified by mocked tests**. No production deployment, cloud backup policy or live payment was performed. Provider OAuth, webhooks for near-real-time project sync, verified reviewer identity and automatic email support are still incomplete. Supported hosted deployments remain prepared static web builds; arbitrary server applications are outside this MVP.
