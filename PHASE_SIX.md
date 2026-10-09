# Phase Six: preserve, rebuild, recreate and transfer

Open **Preserve & rebuild** in your workspace, or open it from a project's details. The four main actions are **Preserve**, **Verify Build**, **Recreate Project**, and **Share Package**. A separate shared-services view documents dependencies. Creating a bundle or a recreation never changes the original repository, deployment, database, or public sharing settings.

## Preservation bundles

An Owner reviews selected source files, screenshots, runtime requirements, build instructions, configuration names, notes, and external assets before creating an immutable ZIP. The package contains `manifest.json`, `PRESERVATION.md`, `source/`, and selected `screenshots/`. Its manifest records the uploaded version, package and individual file SHA-256 checksums, and any recorded repository commit. A recorded commit is a reference; it does not prove uploaded files match that commit.

Selected files retain their exact bytes. Dependency lockfiles can be preserved, including those for unsupported build tools. Environment files, credential paths, detected secrets, and customer-data files are excluded. Review screenshots and source before sharing: automated checks cannot recognize every sensitive item. Required configuration names are preserved without values. Databases, API accounts, domains, provider settings, remote assets and services are documented as external; the ZIP does not back them up.

## Rebuild verification

Automated checks currently support a root npm `package.json`, `package-lock.json`, and build script. Other lockfiles are preserved but not executed. Configure Vercel Sandbox using deployment OIDC or all three server-only settings: `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID`. These credentials are never forwarded into a build. No Sandbox account is configured automatically.

A temporary VM uses one CPU, the provider's 2 GB memory allocation, a 180-second lifetime, and a 1.5 GB Node heap. Installation uses `npm ci --ignore-scripts`, strict engine checking, and npm-registry-only networking. The build has no network access or application secrets. Native installation scripts, private registries, secret-dependent builds and incompatible runtimes can fail; the interface identifies the stage and next step. Uploaded code never executes on Chapter's server.

Results record the exact package digest, uploaded version, date, actual Node runtime, limits, stage exit codes and recognized diagnostic codes. Raw arbitrary command output is not retained because it can contain private information. **Build verified** means dependency installation and the build succeeded. **Application functionality verified** remains **Not Checked**: these checks do not test user flows, databases, or external APIs. Missing Sandbox credentials produce **Not Checked**, with setup instructions.

Verified static output containing `index.html` can be captured separately for recreation. Output is bounded and scanned; symlinks and unsafe paths are rejected. A passed build without eligible static output remains a passed build, but cannot be recreated automatically.

## Guided recreation

A full-workspace Owner can recreate a Parked or Archived bundle with a verified static artifact in their connected Vercel account. Review the new project name, account, required services, configuration names and potential provider charges before confirming. Billing amounts are unknown unless the provider supplies them; Chapter never promises free hosting or savings.

Recreation creates a new private Chapter project and a separate Vercel project with a preview deployment. It copies source and verified output into independent stored versions. It does not attach a repository, move domains, promote production, copy a database, migrate data, or modify the original project. Provision independent external services and review any API URLs embedded in the static output before use.

When required names need values, password fields send them only to the new project's encrypted Vercel Preview settings. Values are cleared from the form and never enter jobs, archives, AI context, stored notes or logs. They are not injected into the already-built static output. Server-rendered applications and builds requiring secrets remain outside automatic recreation support.

Leases, a deterministic new project name and deployment metadata reconcile interrupted requests. An ambiguous deployment response triggers provider lookup instead of a second deployment. Success requires provider confirmation of the new project's deployment ID, `READY` status and URL. This confirms deployment readiness, not application functionality.

## Resumable uploads and package downloads

The Phase Six source uploader accepts ZIPs up to **100 MiB**, in **1 MiB** chunks with progress and three retry attempts. Individual expanded files are limited to 20 MiB, total expansion to 200 MiB, and entries to 2,000. Unsafe or nonportable paths are rejected. The existing simple project uploader retains its 20 MB compressed limit.

Select the same file after a reload to resume acknowledged chunks. Staging chunks are encrypted and reserved against the workspace storage limit. They expire after 24 hours. Completion checks every chunk and the complete SHA-256 digest, sanitizes the archive, then atomically saves one package version. Repeating completion returns that version. Uploading changes the project's stored source version; it never deploys code automatically.

Owners separately review and approve sharing one immutable package version through a link expiring in 1–30 days. Expiry is capped by package retention. Links can be revoked. Every download chunk and completion request rechecks the link, expiry, package availability and the granting owner's current permissions. Demo access does not grant source downloads. Tokens are hashed at rest and request logging is disabled to avoid recording capability URLs.

Cloud downloads use bounded private range requests; local downloads use bounded SQLite reads. The browser verifies chunk and whole-package checksums before acknowledging receipt and saving the ZIP. Pause/resume works within the current page; reopening it starts a new download. Completed transfers are counted only after all chunks and checksum acknowledgement, separately from page visits. This records verified browser receipt, not proof that the recipient saved the file to disk or ran the application. Downloaded copies cannot be recalled.

The authenticated private ZIP review download checks current project access and package integrity first. In cloud mode it uses a 60-second private Storage URL to bypass the hosting function's response-size limit. That already-issued private URL remains usable until expiry. Public package links always use the chunk routes and recheck revocation for each request.

## Retention and shared services

Storage usage includes staged uploads, preservation packages and captured build artifacts. Owners can change package retention or remove a bundle. Expiry immediately denies downloads; worker cleanup revokes links and removes package/artifact bytes with retryable cleanup records. Quota is released when stored bytes are removed. Original source versions and recreation copies remain independent. Removing a package never pauses hosting.

Document database, API, domain, storage and hosting relationships as **Manual** or **Unknown**. Integration imports use previously synchronized exact Vercel project IDs as evidence. Similar environment-variable names are not treated as proof. Scoped collaborators see only authorized project names. Hosting pause confirmation includes documented affected projects and is invalidated when the dependency map changes. Unrecorded dependencies remain unknown; Chapter does not pause external databases or domains.

## Setup, export and recovery

Local SQLite upgrades automatically. Cloud deployments must reapply `cloud/schema.sql` and run `npm run cloud:check` before deploying this phase. There are now **50 private tables**, with browser roles denied and RLS enabled. The private bucket limit is 100 MiB; do not grant public Storage access. Cloud migration includes the new records and encrypted staging bytes.

Private exports include preservation metadata, packages, build evidence and documented relationships. Recovery creates private, independent projects, restores files, labels imported relationships Unknown and clears provider IDs. Historical build evidence from an unsigned export becomes **Not Checked** and requires fresh verification. Active share links, deployment jobs and recreation operations are not restored.

The existing portable workspace backup retains its **18 MB compressed / 40 MB expanded** limits and rejects oversized exports. It is not a bulk backup solution for 100 MiB bundles: download large preservation packages individually. Operator backups include the full local stored data and encryption key; recovery invalidates active links. For cloud recovery, back up PostgreSQL and private Storage objects separately and test both. Supabase database backups do not include Storage bytes.

Run `npm run jobs:work` locally, or configure the authenticated cron described in Phase Four, for unattended retries and retention cleanup. Without a scheduled worker, queued work and cleanup depend on application activity. Existing subscription project and storage limits apply to recreation and transfers. Hosting and Sandbox charges remain separate.

## Verification and remaining limits

The automated suite exercises selected-file preservation, role and storage enforcement, secret exclusions, checksum failures, resumable 21 MiB uploads, revocation, expiry, private recovery and the original project's unchanged state. Controlled Sandbox and Vercel responses exercise resource settings, build evidence, new encrypted configuration, and reconciliation after a lost deployment response with only one deployment submission. Browser tests exercise actual uploads, reviewed package creation, downloads, revocation and mobile layout.

Live Sandbox, Vercel recreation and Supabase range downloads require configured accounts and are not verified by mocks. Current local setup has no Sandbox credentials or cloud database configured. Unsupported server applications, non-npm automated builds, functionality checks, external database restoration, automatic discovery of every dependency and large multipart workspace backups remain incomplete.
