# Chapter Phase Three

Phase Three extends the existing private project, import, hosting, sharing, parking, revival and handover workflows. Local data stays in the existing SQLite database and private files. Existing records migrate on first use. Cloud installations must reapply the idempotent `cloud/schema.sql` before deploying this version. Phase Four expands it to 33 private tables; see [PHASE_FOUR.md](PHASE_FOUR.md). Browser database roles have no access.

## Workspaces and permissions

Each account owns a workspace and may join other workspaces. Use the dashboard's workspace selector to switch. The primary Owner remains responsible for billing and connected accounts. Workspace Owners can rename the workspace and invite collaborators. Invitation links expire after seven days, can be revoked, reserve a seat, and are accepted once by an authenticated user with the invited email. Send the generated link yourself; Chapter does not silently send email.

| Role   | Read project notes/files/history | Comment | Edit, upload, park/resume, assign, restore | Share, handover, starter creation, hosting | Workspace invitations |
| ------ | -------------------------------- | ------- | ------------------------------------------ | ------------------------------------------ | --------------------- |
| Owner  | Yes                              | Yes     | Yes                                        | Yes                                        | Full-workspace Owners |
| Editor | Yes                              | Yes     | Yes                                        | No                                         | No                    |
| Viewer | Yes                              | Yes     | No                                         | No                                         | No                    |

Access may cover all projects or selected projects. A project-specific grant does not grant access to other projects, their historical packages, activity or search results. Enquiry contact details are Owner-only. Collaborators never receive integration tokens. Only the primary Owner manages Stripe billing. Removing a collaborator immediately revokes authenticated API access, including old package downloads and memory-job results. Previously downloaded copies cannot be recalled; cloud download URLs expire after 60 seconds.

## Search and reusable knowledge

Project memory searches authorized projects in the selected workspace: purpose, setup, completed features, stopping reason, blockers, next tasks, resume briefs, repository metadata and eligible text source files. Queries run as persistent background jobs. Every result links to the supporting project or authorized text file. OpenAI, when configured, selects exact excerpts; unsupported excerpts are rejected. Missing information stays explicit. Without `OPENAI_API_KEY`, saved-notes search works and the UI identifies the unavailable AI integration. Secrets and private customer fields are removed before sending context to AI.

To create a private starter, open a project, choose **Collaboration & records → Create starter**, select files, refresh the preview, review the setup document and every selected file, and confirm the contents. Credentials, customer exports and unsupported assets are excluded. Starters belong privately to their creator and do not get a public download link. **Private starters → Review & use** creates a separate project, fresh source upload, private share identity, configuration placeholders and setup checklist. It copies no repository connection, deployment, contacts, billing or database. Automated filtering complements the owner's review; review remains required.

Notes, briefs and source/build package references are versioned whenever changed. **Versions** compares the current record and the selected version. A reviewed restore checks the project has not changed since the preview. It restores only that stored record and invalidates stale readiness checks. Repository, hosting, database, sharing and project status are unchanged. Files are immutable, so historical packages remain downloadable only to authorized project members.

Portfolio metrics come from project records, expense records, interest events and activity timestamps. Costs retain currencies and provenance. Signups compare the selected period with the preceding equally sized period. There are no revenue forecasts, invented scores or assumed hosting savings.

## Subscriptions

The Free plan works without Stripe. Default limits are configurable server-side:

| Plan | Projects | Stored file/template bytes | AI requests/month | Seats including Owner |
| ---- | -------: | -------------------------: | ----------------: | --------------------: |
| Free |       10 |                    100 MiB |                10 |                     2 |
| Pro  |      100 |                      5 GiB |               250 |                     5 |
| Team |      500 |                     25 GiB |             2,000 |                    25 |

Set `CHAPTER_PLAN_LIMITS` to JSON with partial plan overrides, for example `{"Free":{"projects":5,"seats":2},"Pro":{"projects":100}}`. Only the server reads this setting. Limits apply atomically to project creation/import, stored uploads, private starters, AI calls and invited seats. Historical packages and pending direct-upload reservations count toward file storage. Pending invitations count toward seats; revocation or expiry releases the seat. Failed external AI attempts count as requests; saved-notes answers consume no AI request. AI counters reset by UTC calendar month. Downgrades preserve existing data while blocking new usage above the new limits. Connected hosting charges remain separate.

Configure these in ignored `.env.local` locally and server environment variables on Vercel:

- `STRIPE_SECRET_KEY`: your Stripe secret key; start with Stripe test mode.
- `STRIPE_WEBHOOK_SECRET`: the signing secret for this app's webhook endpoint.
- `STRIPE_PRO_PRICE_ID`, `STRIPE_TEAM_PRICE_ID`: active recurring Stripe price IDs from your account. Do not configure the same price for two plans.
- `NEXT_PUBLIC_APP_URL`: the canonical Chapter URL, used for checkout/portal return URLs.

Enable Stripe's hosted Customer Portal and allow the configured prices for plan changes. Register **POST `/api/billing/webhook`** for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, and `invoice.payment_failed`. For local testing, use Stripe CLI forwarding to that route and configure its returned signing secret securely. Actual prices are shown by Stripe before payment; Chapter does not invent prices.

Webhook signatures are verified against the raw body. Event IDs are deduplicated transactionally with a persistent job. The worker retrieves current subscriptions from Stripe rather than trusting redirect parameters or client requests. Only recognized configured prices with `active`/`trialing` status activate Pro/Team limits. Incomplete, canceled, unpaid and unrecognized subscriptions do not grant paid access. Verification uses a compare-and-update check to prevent concurrent refreshes overwriting a newer result. The primary Owner can also select **Verify subscription**. Checkout and billing management report explicit setup errors when unavailable. Test verification uses real Stripe signature verification with provider responses mocked; no live payment was taken or verified without configured credentials.

See [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks) and [signature verification](https://docs.stripe.com/webhooks#verify-events).

## Notifications and background work

In-app notification preferences cover assignments, return dates, failed deployments and new enquiries. Assignment notifications go to the assignee; enquiry and deployment notifications go to authorized Owners. Project return reminders use recorded dates. Notifications are private, deduplicated and hidden when access is revoked.

Jobs persist their queued/running/succeeded/failed status, attempts, next retry time and lease. Next.js `after` starts work after requests. A worker recovers expired leases and retries with backoff up to three attempts. Users can retry failed jobs or run pending work from Notifications. Each execution rechecks current permissions. Jobs retain safe errors and never log keys or raw provider payloads. Deployment checks report verified provider states; a still-processing service is not reported as a failed deployment.

For ongoing local processing run `npm run jobs:work -- --watch`; without `--watch` it performs one sweep. In production, set a random secret of at least 32 characters in `CRON_SECRET`. The daily Vercel cron in `vercel.json` invokes `/api/cron/jobs` and requires the bearer secret. Higher-frequency schedules depend on your Vercel plan. Jobs can also advance when their owner checks their status. Configure the worker for return reminders and retries while nobody is visiting. See [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

If pre-existing cloud files have unknown byte sizes, Billing shows **Unknown** and blocks new uploads until **Reconcile legacy storage** measures the immutable files. Follow this job in Notifications, then refresh usage. Existing files remain readable. No zero usage is assumed for unknown files.

## Verification

`npm test` includes schema/RLS, upload/privacy, hosting checks, role/scope access, atomic usage limits, version records, grounded search, webhook signatures and verified subscription transitions. `npm run test:e2e` includes the original import/share/park/resume and Phase Two interest/handover workflows plus Phase Three collaborator permissions, private files/search, comments/assignments, private reviewed starters, reviewed restoration, notifications, plan limits and responsive screens. Set `TEST_BASE_URL` when testing a separate local server/database.
