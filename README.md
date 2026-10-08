# Chapter

Keep every project ready for its next chapter.

A focused, responsive SaaS MVP for importing, organizing, sharing, parking, and resuming developer projects. Built with Next.js App Router, React, and TypeScript. Local use stores data in SQLite; Vercel uses Supabase PostgreSQL and private object storage.

## Run

Requires Node.js 24 or newer.

```sh
npm install
npm run build
npm start
```

Open http://localhost:3000. The initial dashboard is an explicitly labeled preview. Click **Try your own workspace** for a personal persistent demo, or **Create an account** for a password-protected workspace. For development use `npm run dev`.

## What works

- Account registration, login, logout; salted scrypt password hashes; opaque HttpOnly session cookies; rate limits and origin checks.
- Persistent projects, descriptions, repository/demo links, tags, screenshots, all five statuses, search, filters, grid/list views, and a draggable queue with keyboard arrow buttons.
- GitHub imports with metadata, README, a real commit SHA, and a source snapshot. Public repositories work without credentials; private repositories use the owner's GitHub connection.
- ZIP uploads with bounds on size and file count, unsafe path rejection, credential-file exclusions, and secret scanning. Source archives and deployable static builds are stored separately.
- Vercel publishing through the owner's account, optional team scope, deployment-state polling, and a real provider URL recorded only when the deployment is ready. No fabricated demo URLs.
- Stable public project links; owners independently opt into screenshots, demo, repository link, and source downloads. Revoking sharing immediately stops new file access; already issued cloud download URLs expire within 60 seconds.
- Parking stores an immutable context record and source-version reference, including setup, completed features, blockers, reason, next task, and intended return date. Hosting continues unchanged.
- Editable saved-notes briefs, optional OpenAI generation, private brief persistence, copying, and Markdown downloads. Missing information is marked explicitly.

## Connections

Phase Two is implemented in **Next chapter controls**: task suggestions, parked-page interest, readiness checks, Vercel pause/resume, manual recurring costs, reviewed handovers and project history. See [PHASE_TWO.md](PHASE_TWO.md) for workflows, privacy rules and isolated-build setup. Existing cloud installations must reapply `cloud/schema.sql`; local databases upgrade automatically.

Open **Integrations** inside an authenticated workspace.

**GitHub:** create a fine-grained personal token with Contents: read access for selected repositories. The server verifies the token and encrypts it at rest. See [GitHub token documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

**Vercel:** connect an access token from [Vercel account settings → Tokens](https://vercel.com/account/settings/tokens). Scope it to the account or team you want to deploy into. For a team, also enter its `team_…` ID from team settings. This first version supports static HTML sites and exported `dist/`, `build/`, `out/`, or `public/` directories containing `index.html`. A source tree with `package.json` is not automatically treated as a deployable build. Chapter uploads the sanitized build using file digests, forces the static builder, and sets `public:false` to keep deployment source and logs private. Uploaded Vercel configuration cannot override this behavior. Deployment publishes prepared static output; optional readiness builds execute only in isolated Vercel Sandbox VMs. Vercel uses the connected account's limits and billing. See [Vercel deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment).

Personal-token connections are intended for this self-hosted MVP. A public multi-tenant release should replace this setup with provider OAuth applications.

**AI:** optional `OPENAI_API_KEY` in ignored `.env.local`, configured through secure OpenAI key setup. `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Restart after configuring. The Generate AI brief action sends sanitized notes and recorded repository context to OpenAI with response storage disabled. To avoid invented facts, AI selects exact excerpts for each brief section; the server rejects excerpts absent from that section's source. Missing information is marked explicitly. Saved-notes briefs work without an AI account. Briefs remain editable by the owner.

## Persistence and deployment

For Vercel, follow [VERCEL_SETUP.md](VERCEL_SETUP.md). It covers the cloud schema, private bucket, required environment variables, configuration checks, optional migration of existing local data, and deployment. Setting `DATABASE_URL` selects PostgreSQL automatically. On Vercel, Chapter refuses to write to ephemeral SQLite when cloud configuration is missing.

Locally, the application uses `.data/chapter.sqlite` for users, projects, files, snapshots, sessions, activity, and encrypted connection tokens. `.data/encryption.key` protects local tokens; back it up with the database. Both are ignored. Local mode continues to work without cloud accounts. Cloud mode requires a persistent `CHAPTER_ENCRYPTION_KEY` environment variable instead of a filesystem key.

Project hosting on Vercel is separate from hosting Chapter itself. Each user's Vercel connection publishes their managed projects. Chapter's own Vercel project uses the server-side cloud credentials in its environment. Share links are reachable by other people once Chapter has a public origin.

Cloud ZIPs and screenshots upload directly to a private staging object, bypassing Vercel's request-body limit. The server consumes an owner-bound, project-bound upload ticket, checks the actual byte size, scans/sanitizes the archive or validates the image, then saves a separate immutable object. Raw staging uploads are never attached to a project or shared. Downloads are authorized by Chapter before a 60-second private Storage URL is issued.

Limits: ZIPs up to 20 MB compressed / 50 MB expanded / 2,000 files; up to eight screenshots of 5 MB each. PNG, JPEG and WebP screenshots are supported. Environment and credential files are excluded, and detected secrets cause archive rejection. Never upload secrets or screenshots containing credentials; automated scanning cannot identify every possible secret format.

Demo workspaces are separate per visitor and persist with their session; registering creates a clean account. Team workspaces, subscriptions, configurable reminders and Phase Four workflows are available. Password-reset email delivery, domain management and deployment of arbitrary server apps remain outside this version's scope. Optional build checks execute only in Vercel Sandbox; uploaded code never runs on Chapter's server.

## Verification

```sh
npm run typecheck
npm test
npm exec playwright install chromium
# With the local app running:
npm run test:e2e
```

The browser test covers signup, ZIP and screenshot import, queue organization, search, opt-in public sharing, independent source permission, revocation, parking with a version, persistence after reload, redaction, editable/downloadable resume briefs, resuming, cross-account denial, unavailable Vercel setup, and mobile navigation. Unit tests verify Vercel file uploads/manifests with a mocked provider and check the cloud schema, session query, rate limits, upload-ticket ownership/single use, and denied browser roles in a real local PostgreSQL engine (PGlite). Live Vercel publishing, remote Supabase persistence, and AI generation require configured accounts; the local tests do not claim those external services are verified.

A real public GitHub import check is included and can be enabled with `LIVE_GITHUB_TEST=true` when running the browser suite. `TEST_BASE_URL` selects a different local server if needed.

# Phase Three

Team workspaces, authorized project-memory search, private reviewed starters, stored-record versions, portfolio metrics, configurable subscriptions and notifications are available. Read [PHASE_THREE.md](./PHASE_THREE.md) for permissions, Stripe configuration, usage limits and background workers. Reapply `cloud/schema.sql` for an existing cloud deployment before upgrading.

# Phase Four

Open **Launch & automation** for guided bulk discovery/import, read-only project sync, previewed rules, expiring version review links, opt-in public portfolios and private backup recovery. Read [PHASE_FOUR.md](./PHASE_FOUR.md) for setup, export formats, encrypted operator backups, verification and remaining launch limits. Existing deployments must reapply the schema and configuration check. Live integrations remain honestly unavailable until their credentials are configured.

# Phase Five

Open **Continue & learn** for guided resume sessions, project-scoped developer capture and the standalone CLI, editable grounded action proposals, an attention inbox, private feedback with restricted administration, and aggregate usage insights. Read [PHASE_FIVE.md](./PHASE_FIVE.md) for CLI/API setup, token scope and revocation, confirmed memory updates, analytics definitions, admin configuration and honest integration limits. Cloud setup now uses 41 private tables; reapply `cloud/schema.sql` before upgrading. Private captured files and continuation history are included in export/recovery.
