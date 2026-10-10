# Secure client previews and account recovery

Quick Publish → **Create private client preview** opens the existing versioned review flow. Owners select a password, invited email addresses, or anyone-with-link access. Password access is the new UI default. Existing review links retain their original access settings.

Select the saved static HTML layout, screenshots, PDF downloads, setup notes, feedback, and source downloads independently. Review the preview and confirm before creating the link. Static layouts are sanitized, inert snapshots: no scripts, forms, network requests or source ZIP are exposed by layout viewing. PDF permission grants access to its bytes; a viewer can save files they can view. Review included files for private information before sharing.

Feedback and approval belong to that captured version. The review overview shows Pending, Approved and Changes Requested. Email access verifies possession of the invited address, not a legal signature or a reviewer’s entered name. Access grants last at most 24 hours and stop on expiry or revocation. Downloads go through the server permission check, including cloud files. Previously viewed or downloaded content cannot be recalled.

A separate public project page, portfolio, source download, or direct Vercel deployment URL keeps its own permissions. This gate does not make an already-public resource private. For private **live application functionality**, configure [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments) on all relevant hosting URLs. This release does not change provider settings or add custom domains.

## Local testing

Add `CHAPTER_EMAIL_MODE=local` to ignored `.env.local` and keep `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000` (or your actual local origin). Restart the server. No provider key is needed. Email previews with one-time links are written to the private, ignored `.data/mail-outbox` folder. Open the latest HTML file locally and follow its link. Do not publish this directory, include it in source packages, or paste links into logs or chats. Local mode is disabled on Vercel and when `DATABASE_URL` is set.

The sign-in page links to **Forgot your password?**. Reset links last 30 minutes; confirmation changes the password and signs out existing browser sessions. Verification links last 24 hours; registration queues one when email delivery is configured. Account settings show verification and last delivery status and allow resending. Invited client access links last 20 minutes. Links use URL fragments, are removed from the address bar on load, and require an explicit confirmation POST. They are single-use and are never returned by public APIs or recorded in application logs.

Email delivery is persisted with an encrypted payload, a worker lease, at most three attempts, and a stable provider idempotency key. Each new link supersedes previous unused links for the same purpose, address and scope. The existing worker/cron retries transient failures; permanent sender or credential failures show a clear status. Local mail files are removed by the worker after 24 hours. No marketing email is sent.

## Production activation

The current production origin is `https://onemoreapp-sandy.vercel.app`. Set `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SITE_URL` to that origin and `COOKIE_SECURE=true` in Vercel. Configure the cloud database and private file storage using [VERCEL_SETUP.md](VERCEL_SETUP.md): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and a persistent `CHAPTER_ENCRYPTION_KEY`. Apply the updated, idempotent [cloud/schema.sql](cloud/schema.sql), now 55 private tables, then run `npm run cloud:check`. Use your original encryption key when migrating existing integrations. Perform migration before enabling traffic; `cloud:migrate` preserves review access restrictions and email verification records. Old local one-time links and grants are not migrated: request fresh links on the production origin.

Set server-only `RESEND_API_KEY` (send-only scope) and `EMAIL_FROM` from a verified sender domain. Follow [Resend’s domain setup](https://resend.com/docs/dashboard/domains/introduction); a Vercel-provided application hostname does not give you control of its mail DNS. Optional `SUPPORT_EMAIL` is the reply-to address. Never use `NEXT_PUBLIC_` names for provider keys. Remove local outbox mode in production. Configure the existing authenticated worker/cron (`CRON_SECRET`, `npm run jobs:work`) for delivery retries. Do not overwrite an existing `.env.local` containing AI or integration keys.

Until these provider settings are supplied, cloud persistence and real inbox delivery remain unavailable. Missing delivery configuration returns an explicit setup error; it never pretends an email was sent. Local authentication and private previews continue to work with local persistence.

Operator recovery revokes preview links and access grants, consumes old one-time tokens, and cancels mail deliveries. Restoring stored project records does not change deployments or provider databases.

## Verification

`npm test` includes recovery races, expiry, token replay, session revocation, email verification, encrypted queue payloads, idempotent delivery retries, recipient restrictions, pinned layouts, and file gating. PostgreSQL tests apply the real schema and verify browser roles have no private table access.

For browser tests, start an isolated server with a fresh `CHAPTER_DATA_DIR`, `CHAPTER_EMAIL_MODE=local`, and its matching local application URL. Set `SECURE_E2E_DATA_DIR` to that directory and `TEST_BASE_URL` to that server before running `npm run test:e2e -- tests/e2e/secure-previews.spec.ts`. These tests must not point at production or the live local database.
