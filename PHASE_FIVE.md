# Phase Five — continuation, developer capture and user feedback

Open http://localhost:3000 and choose **Continue & learn**. Existing Resume dialogs also offer **Open guided resume**. This phase reuses authentication, team roles, private storage, version history, subscription limits and persistent jobs.

## Guided resume

Select an authorized project, next task and available time. Review purpose, stopping notes, completed features, blockers, setup and recent development captures together. Run the existing revival check and explicitly review its dated Passed, Needs Attention and Not Checked results. Starting changes the project to Building; hosting and deployments remain separate.

Sessions persist across visits with frozen starting context. At the end, review current records and confirm completed work, remaining issues and a next task. Confirmed completed work is appended; confirmed issues replace blockers/issue notes; the return date and stale brief are cleared. A concurrent project edit requires reload and fresh review. Canceling saves a canceled session without claiming completion or updating memory. Repeated completion cannot duplicate notes or usage events.

## Development capture and CLI

Download `/chapter-cli.mjs` from Developer capture, or run `npm run chapter:cli --` from this repository. Requires Node.js 24+, with no additional dependencies. Any editor can use this terminal workflow; editor-specific extensions and automatic code monitoring are not included.

Create a project-scoped token. Only its hash is stored; copy the credential once. Tokens expire in 1–365 days and can be revoked. Editors manage their own tokens; Owners can revoke project collaborator tokens. Every capture checks current project access. Revoked/expired tokens, Viewer roles and removed access cannot update projects. Tokens cannot download files, share, deploy or control hosting.

Set `CHAPTER_URL`, `CHAPTER_PROJECT` and `CHAPTER_TOKEN` in your development shell or an ignored local file. Use HTTPS outside localhost. Keep the token out of progress files and command arguments. PowerShell can prompt without printing or saving it in command history:

```powershell
$env:CHAPTER_URL = 'http://localhost:3000'
$env:CHAPTER_PROJECT = '<project ID>'
$captureCredential = Read-Host 'Capture token' -AsSecureString
$env:CHAPTER_TOKEN = [System.Net.NetworkCredential]::new('', $captureCredential).Password
```

Create and review a local `progress.json`. Use a fresh UUID for each distinct update and the same UUID when retrying:

```json
{
  "id": "fa238ea1-3039-4782-a490-908a99eed7ca",
  "notes": "Upload progress UI drafted; accessibility review remains.",
  "commit": "abcdef1234567",
  "nextTask": "Review progress accessibility",
  "blockers": "Screen reader messages need review",
  "minutes": 30,
  "filePaths": ["src/upload.ts", "README.md"]
}
```

```powershell
node chapter-cli.mjs capture --input progress.json --dry-run
node chapter-cli.mjs capture --input progress.json --reviewed
Remove-Item Env:CHAPTER_TOKEN
```

Dry runs print field names and selected paths/sizes, never notes, contents or tokens. Submissions retry transient failures up to three times with the same ID, refuse redirects and return safe success metadata. Private paths, symlinks, path escapes, non-text files, credential-looking content and private contacts are rejected. Limits: 30 files, 32 KB each, 512 KB combined; notes 8,000 characters; next task 4,000. Server validation is authoritative.

API: `POST /api/developer/projects/<id>/capture` with `Authorization: Bearer <token>`. The body uses the same fields, replacing `filePaths` with `files: [{path, content}]`. UUID `id` is required; different content with the same ID returns 409. Cookie authentication alone cannot use this endpoint. Unknown fields are rejected.

Captures save notes, user-submitted commit references, optional task/blocker/time updates and private selected-file snapshots. They preserve project status, the current source/build, repositories and deployments. Commit references are not automatically verified or treated as completion. File bytes consume workspace storage atomically; conflicts/quota failures roll back records and usage. Captured files need current project read access and are never exposed through a demo share grant.

## Reviewed assistant proposals

Choose task breakdown, documentation or revised resume brief. Persistent jobs produce editable previews with supporting authorized notes/files and explicit missing information. Captured snapshots are searchable and citable.

When OpenAI is configured, the existing Responses integration selects exact excerpts, validated against supplied sources. Otherwise the UI identifies saved-notes proposals. The original Resume dialog always offers **Prepare from notes**, including when an OpenAI key is configured or generation fails. Task plans split recorded task segments and add generic setup, blocker and verification reminders. They do not infer implementation details, commands, completion or estimates; detailed planning needs user input.

Apply requires explicit review and an unchanged project. It saves versioned stored documentation, task plans or briefs after credential/contact redaction. It never runs code, writes repositories, deploys or changes hosting. Jobs expose states, attempts, safe errors and retries using existing controls and workers.

Secure OpenAI key setup uses the connected Platform picker and confirmed ignored `.env.local` destination. The authorized key was securely saved as `OPENAI_API_KEY` on October 7, 2026. A live request reached OpenAI but returned HTTP 429 with `insufficient_quota`; live AI generation therefore remains unverified until the connected account's credits or spend/usage limits are addressed. Review [OpenAI billing](https://platform.openai.com/settings/organization/billing) and [organization limits](https://platform.openai.com/settings/organization/limits). Chapter does not purchase credits or change provider limits. Saved-notes proposals and briefs continue to work.

AI errors distinguish exhausted credits, organization/project spend limits, authentication/access problems, temporary rate limits, and provider outages without exposing provider request contents. Billing/access failures stop automatic job retries; temporary failures use bounded retries and respect `Retry-After`. After fixing the account, use the explicit Retry control. Calls enforce Chapter's existing monthly AI limits; failed provider attempts may still consume an allowance. See [OpenAI error guidance](https://developers.openai.com/api/docs/guides/error-codes). For simple future experiments, `OPENAI_MODEL=gpt-6-luna` is a [starter-model option](https://developers.openai.com/api/docs/models/gpt-6-luna); changing models does not resolve insufficient quota. Chapter's existing default model was preserved.

## Attention inbox

Repeated events are grouped by project and kind: recorded deployment failures, unresolved blockers, overdue/upcoming seven-day return dates on parked projects, enquiries and integration failures. Owners see enquiry and connection items. Archived projects are excluded. Existing notification preferences now include blockers and integration failures.

Resolve acknowledges the current event without silently editing memory; changed blockers or new enquiries/failures reopen it. Snooze lasts 24 hours from the UI. Disable applies only to your grouped item. Reopen using “Show resolved, snoozed and disabled items.” Refresh reads saved observations; provider freshness is shown in Sync and Hosting.

## Feedback and platform administrators

Users submit Bug, Feature request, Usability or Other requests and track statuses and published updates. Optional private PNG/JPEG/WebP screenshots are limited to 2 MB, require review for secrets/customer data, and count against the user's personal storage. Diagnostics are opt-in: app phase, receipt time, mobile/desktop family and an optional validated request UUID. URLs, browser logs, project notes, source and tokens are excluded.

Admin access defaults to disabled. Register an administrator normally, then set `CHAPTER_ADMIN_USER_IDS` on the server to trusted database user IDs. Email alone is not authority because local email ownership is not verified. Workspace Owners cannot grant themselves platform admin access.

Admins categorize feedback, assign problem-theme tags, change statuses and publish updates to submitting users. They may inspect consented diagnostics/private attachments and aggregate usage; this does not grant project access. Category/theme counts reflect actual submitted requests in the latest-200 review window. No success scores are invented. Feedback stays in Chapter; outbound email and issue-tracker delivery are not configured.

## Usage, cloud setup and recovery

Workspace Owners see completed imports, first shares, parking, completed resume sessions, captures and handovers; failed attempts are separate. Configured admins see platform aggregates. Events store internal actor/workspace/project IDs, enumerated actions, outcomes and UTC times only. No source, private notes, enquiry text, screenshots or provider credentials enter analytics.

Measurement starts with Phase Five; old actions are not fabricated. First shares count once per project. Import-to-share drop-off means users with successful imports and no recorded share. Repeat usage means completed actions on two or more UTC days. Source definitions, measurement start and update times are shown. Hosting charges remain separate.

**Cloud deployments must reapply idempotent `cloud/schema.sql` before upgrading:** 41 private tables, all with RLS and no browser-role grants. Local tables migrate automatically. `cloud:migrate` includes new records/private feedback files. Configure PostgreSQL, private Supabase storage, persistent encryption key, Stripe, Vercel and workers using README and VERCEL_SETUP.

Portable exports include captures, reviewed documents/task plans, stored versions, sessions and proposal history. Recovery creates independent private projects, remaps files, cancels unfinished sessions and archives proposals. Tokens, feedback screenshots, analytics identities and admin configuration are not project-sharing assets. Encrypted operator backups retain platform records/files; recovery invalidates sessions/tokens and cancels unfinished sessions. Cloud disaster recovery still needs provider database and private-bucket backups.

## Verification and honest limits

Verified on October 7, 2026: the production build passed, all 25 backend tests passed, and all 10 Chromium browser workflows passed against fresh isolated data. The browser run included a real public GitHub import, actual CLI capture, guided-session completion, reviewed proposals, restricted feedback administration, and mobile layouts. Additional checks verify that AI billing failures stop automatic retries and temporary rate limits respect retry guidance. The existing user database was preserved and the production server was restored at http://localhost:3000.

Checks cover token scope/revocation/role removal, duplicate capture, file/credential rejection, quota rollback, session conflicts/confirmation, private proposal sources, reviewed application, inbox preferences/grouping, analytics privacy, PostgreSQL RLS and recovery. Browser workflows run the actual standalone CLI through park → check → guided resume → confirmed next task, plus proposal editing, private feedback/admin updates and mobile layouts alongside prior phase tests.

Live OpenAI, paid Stripe updates, provider pause/resume and cloud disaster recovery require configured accounts/infrastructure. Mocked signature/billing/failure/build tests do not prove a paid production account is configured. Unavailable checks remain explicit. No editor extensions, automatic repository writes, automatic deployments/hosting actions, outbound feedback email or source-code telemetry were added.
