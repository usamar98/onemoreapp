# Host Chapter and your projects on Vercel

Chapter now uses Vercel for project hosting. To host the SaaS itself on Vercel, configure cloud persistence first. Your local workspace remains available until you migrate it. No cloud project or paid resource has been created automatically.

## 1. Set up your Supabase project

Create a dedicated Supabase project in your chosen organization. Review its plan and costs in your account. Run [cloud/schema.sql](cloud/schema.sql) in the project's SQL editor. This creates 41 tables in the private `chapter` schema and the private `chapter-files` bucket. Leave `chapter` out of the Data API's exposed schemas. Do not add public Storage policies to this bucket.

Chapter keeps its existing server-side authentication. Passwords are hashed, cookies are HttpOnly, and server queries check project ownership. Browser roles have no access to Chapter's tables; RLS is enabled as additional protection. PostgreSQL connects using your project's `postgres` role through the transaction pooler. Supabase is used for database and private file persistence.

From Supabase's **Connect** dialog, copy the transaction pooler connection string (port 6543). Supply the database password; URL-encode special characters. From **Project Settings → API Keys**, create/copy a server secret key (or the legacy `service_role` key). Keep these values in ignored `.env.local` and in Vercel's server environment, never in a `NEXT_PUBLIC_` variable.

## 2. Configure server environment variables

Copy `.env.example` to `.env.local` and set these values:

| Variable                 | Value                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| `DATABASE_URL`           | Supabase transaction pooler connection string for the `postgres` role        |
| `SUPABASE_URL`           | Your Supabase project's HTTPS API URL                                        |
| `SUPABASE_SECRET_KEY`    | Server secret key or legacy `service_role` key                               |
| `CHAPTER_ENCRYPTION_KEY` | One persistent, base64-encoded 32-byte encryption key                        |
| `NEXT_PUBLIC_APP_URL`    | Chapter's exact public origin, for example `https://your-chapter.vercel.app` |
| `COOKIE_SECURE`          | `true` in production                                                         |
| `OPENAI_API_KEY`         | Optional key from secure OpenAI key setup                                    |
| `OPENAI_MODEL`           | Optional; defaults to `gpt-4.1-mini`                                         |

Generate the encryption key once with your password manager or a cryptographically secure generator. Save and back it up securely. Every deployment sharing this database must use the same key. Changing it makes stored provider tokens unreadable.

If migrating an existing local workspace with connected accounts, use the existing `.data/encryption.key` bytes, base64 encoded, instead of generating a different key. Never commit `.env.local`, `.data`, database exports, or connection tokens.

Run the configuration check locally:

```sh
npm run cloud:check
```

It checks the database schema, denied browser permissions, key size, private bucket, and an actual private file write/read/delete. It never prints credentials. Set `NEXT_PUBLIC_APP_URL=http://localhost:3000` and `COOKIE_SECURE=false` temporarily for local browser verification against cloud storage; use the production values in Vercel.

## 3. Optionally migrate your existing local workspace

Back up `.data` and stop Chapter while migrating. Ensure the destination is your dedicated Chapter database. Run:

```sh
npm run cloud:migrate
```

The script reads the local SQLite database without changing it, preserves user/project/share/file IDs, moves file blobs into private Storage, and copies project memories and encrypted provider connections. Existing destination records are retained, so an interrupted copy can be retried. It does not merge differing records with the same ID. Keep the original encryption key for existing connections. New sessions and share links remain usable after migration because their IDs are preserved.

Start Chapter with the cloud environment and verify signup/login, ZIP and screenshot uploads, sharing, parking, and resume persistence. The original `.data` backup can still be used for local recovery.

## 4. Deploy Chapter

Import the Chapter repository into a new Vercel project, or deploy this directory using the Vercel CLI. The repository root is the project root. Use **Next.js**, **Node.js 24.x**, and the checked-in `vercel.json`. Add the server variables above to Production and to any Preview environment you want to test; an isolated preview Supabase project is preferable for testing real data changes.

Build command: `npm run build`. Install command: `npm ci`. Vercel's Next.js output is detected automatically. Deploy after the cloud configuration check passes. Set the public origin to the assigned Vercel production domain (or your custom domain), then redeploy if that value changed.

If Vercel reports `should NOT have additional property public`, deploy the latest `main` commit. The unsupported `public` key has been removed from both Chapter's configuration and generated static-project configurations. Vercel protects source and log views behind authentication without this flag. Chapter's source downloads still require separate owner permission. See [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json#public).

Chapter's API allows up to 300 seconds for imports, validation, and publishing, subject to your Vercel plan. Large uploads travel directly to private Storage. The SaaS refuses to use an ephemeral local database on Vercel. A successful build alone does not verify remote persistence; exercise the live app after deployment.

## 5. Connect Vercel inside Chapter

Sign in and open **Integrations → Connect Vercel**. Create an account access token at [Vercel Tokens](https://vercel.com/account/settings/tokens). For team deployments, scope the token to that team and enter its `team_…` ID from team settings. Chapter verifies the account/team and encrypts the token in the database. This per-user connection is separate from deploying Chapter itself.

Upload a static website ZIP, or a repository ZIP with a built `dist/`, `build/`, `out/`, or `public/` directory containing `index.html`. Click **Deploy to Vercel** in the project's details. Chapter uploads only the sanitized web build, preserves private source/log settings, polls readiness, and saves Vercel's returned live URL. Server-rendered apps and arbitrary build pipelines remain outside this MVP; build/export those projects first or deploy them directly through their own Vercel pipeline and save the demo URL.

Verify the returned URL opens, then explicitly enable the demo on the project's share page. Source downloads require a separate opt-in. Parking keeps hosting running.

## Storage housekeeping and limits

See [PHASE_FOUR.md](PHASE_FOUR.md) for worker/sync scheduling, direct private recovery uploads, export limits, monitoring, support configuration and operator backups. Supabase database backups do not include Storage object bytes; back up both separately and test recovery before launch.

For Phase Two, reapply `cloud/schema.sql` to add the private interest table and project-linked activity, then run `npm run cloud:check`. No new public table or Storage grants are needed. See [PHASE_TWO.md](PHASE_TWO.md) for optional Sandbox credentials and reviewed handover limits. Keep Chapter's Vercel project separate from managed projects; Chapter refuses to pause its own service.

ZIPs: 20 MB compressed, 50 MB expanded, 2,000 files. Screenshots: eight per project, 5 MB each. Unfinished direct uploads remain in owner-scoped `staging` paths; configure a storage housekeeping job to remove staging objects older than 24 hours and delete expired `chapter.upload_tickets` records. Keep approved file objects and memory snapshots.

Revoking a share immediately denies new requests. A cloud download URL already issued to an authorized visitor remains valid for at most 60 seconds. Downloaded copies cannot be recalled.

Reference: [Supabase connection pooling](https://supabase.com/docs/guides/database/connecting-to-postgres), [private file downloads](https://supabase.com/docs/guides/storage/serving/downloads), and [Vercel deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment).

# Phase Five upgrade

Reapply the idempotent schema before deploying Phase Five, then run the cloud configuration check. The new continuation, capture-token, proposal, attention, feedback and product-event tables remain private. Set `CHAPTER_ADMIN_USER_IDS` to trusted registered database user IDs only when enabling platform feedback administration. It defaults to disabled. Keep `OPENAI_API_KEY` server-only and reuse the existing worker/cron for proposal retries. See [PHASE_FIVE.md](PHASE_FIVE.md) for the authenticated capture API and CLI; capture tokens grant no hosting or source-download access.
