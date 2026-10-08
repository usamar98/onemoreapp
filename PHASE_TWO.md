# Chapter · Phase Two

Open a project → **Next chapter controls**, or use its card menu. The design, authentication and storage architecture are shared with the original app.

- **Next task:** record a task, estimated minutes, priority and blockers. The queue's **30 minutes**, **2 hours** and **This weekend** filters suggest tasks across the workspace with a recorded estimate and no recorded blockers. Weekend means up to eight hours. Explanations use those saved facts; no completion or revenue scores are generated.
- **Interest:** explicitly enable a public demo video, waitlist or enquiries on the shared page. The page stays available when the application is parked or its Vercel production service is paused. Visits, unique email signups and submitted enquiries are counted separately. Visits are deduplicated per browser per day; signed-in owner visits are excluded. Counts are recorded activity, not unique-person or revenue estimates. Only owners can read or delete contacts; Chapter sends no emails.
- **Readiness:** a dated report covers GitHub metadata/commit, Vercel deployment and pause status, the public demo's HTTP response, required environment names and an optional isolated build. Every item is Passed, Needs Attention or Not Checked with a next step. Public link checks block private/reserved addresses and pin each redirected connection to validated DNS answers. Environment presence is checked in production without decrypting or retaining values. A current check must be reviewed before resuming work; unresolved items remain visible and can be addressed while building.
- **Hosting:** preview the exact Vercel project and production-service scope, then type the provider project's name to confirm pause or resume. Confirmation expires after five minutes and is tied to the provider state. Chapter reads provider status after the mutation and reports success only when it matches. Chapter's own hosting project cannot be paused here. Parking and resuming work never change hosting automatically. Databases, domains, APIs, storage and subscriptions require their own controls. See [Vercel's pause behavior](https://vercel.com/docs/projects/managing-projects#pausing-a-project).
- **Costs:** record hosting, database, domain, API and other monthly/yearly expenses. Manual estimates are labeled and kept separate by currency. Owners mark expenses that may continue while parked. Connected billing is unavailable; no savings are inferred from pausing.
- **Handover:** inspect eligible source, select files and review the full sanitized text and manifest. Confirm review to create a private ZIP. The manifest includes status, setup, known issues, tasks, asset inventory and repository/hosting/domain transfer checklists. Explicitly enable its download on the share page; revoke it separately or disable the entire page. Package sharing never grants access to other source snapshots and does not transfer provider ownership automatically.
- **History:** project-level parking, resuming, sharing, checks, interest, costs and handover events persist. Older workspace events remain in Activity. Concurrent Phase Two saves reject stale versions instead of overwriting another request silently.

## Storage upgrade

Local databases upgrade automatically without removing records. Existing cloud installations must reapply the idempotent [cloud/schema.sql](cloud/schema.sql) before using Phase Two. It adds the private `chapter.interest` table and a project reference on activity. All ten tables deny browser roles; custom server-side authentication continues to enforce ownership. `npm run cloud:check` checks the updated schema. Local-to-cloud migration also includes interest records and project history.

## Isolated builds

Optional npm builds use `@vercel/sandbox` in a temporary Vercel microVM with a three-minute limit. Configure Vercel OIDC on a linked deployment, or all three server-only variables: `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`. Their values are never forwarded into the VM or included in notes/packages. This uses the configured Sandbox account's plan and limits. Chapter does not provision an account.

Upload an archive with root `package.json`, `package-lock.json` and `scripts.build`. Chapter installs with `npm ci --ignore-scripts` while allowing only `registry.npmjs.org`, then denies all network access before `npm run build`. No application secrets are supplied. Sandboxes are nonpersistent and stopped in cleanup, with timeout as a bound if cleanup fails. Other package managers, private registries, build-time secrets and network-dependent builds need the owner's isolated CI. No build runs on Chapter's server. Raw logs are not retained because they can contain private data. See [Vercel Sandbox SDK](https://vercel.com/docs/sandbox/sdk-reference).

Source references and `.env.example`, `.env.sample` and `.env.template` yield environment-variable names only; contents and values remain excluded from saved source. References are suggestions, not proof that values are required. Owners confirm the required names explicitly in Readiness settings before Chapter compares them with provider configuration.

## Handover privacy and review

Data exports, database files, credential files, screenshots and unsupported binaries are excluded. Recognized credentials, email addresses, long private numbers and labeled customer fields are removed from text. Account integrations and interest contacts are never assembled into packages. Owners must review for private information that automated scanning cannot identify. Source is limited to 128 KB per file and 3 MB selected total so each included file can be reviewed in full.

The server fingerprints selected source and the manifest. A changed selection or project context requires fresh review. Created packages are immutable. Every download is checked against currently known secrets; newly discovered secrets block delivery until a fresh package is reviewed. Only the currently selected, explicitly shared package is publicly downloadable.

## Verification

`npm test` covers fact-based suggestions, currency separation, environment-template exclusions, handover privacy, private-network denial, confirmation-bound hosting changes, verified provider status and isolated build boundaries. PostgreSQL tests cover private schema permissions, owner-scoped interest counts and duplicate signup handling.

`npm run test:e2e` includes the original MVP scenarios and a full park → collect visits/signup/enquiry → readiness → reviewed/revoked handover → resume journey. It checks persistence, mobile layout and denial from a second account. Provider calls and sandbox execution are tested with controlled responses. Live hosting changes, remote storage and actual sandbox builds require configured account access; local verification does not claim those external systems are verified.
