-- Apply once in your dedicated Supabase project's SQL editor.
-- Chapter uses server-side password/session authentication. Browser roles have no table access.
begin;
create schema if not exists chapter;
revoke all on schema chapter from public, anon, authenticated;
create table if not exists chapter.users(id text primary key, name text not null, email text unique not null, password text not null, demo integer default 0);
create table if not exists chapter.sessions(token text primary key, user_id text references chapter.users(id), expires bigint not null);
create table if not exists chapter.projects(id text primary key, owner text references chapter.users(id), share_id text unique not null, data text not null);
create table if not exists chapter.uploads(id text primary key, owner text references chapter.users(id), project_id text references chapter.projects(id), name text, kind text, type text, data bytea, object_name text);
create table if not exists chapter.memories(id text primary key, owner text references chapter.users(id), project_id text references chapter.projects(id), data text, created_at text);
create table if not exists chapter.integrations(owner text references chapter.users(id), provider text, token text, primary key(owner, provider));
create table if not exists chapter.activity(id text primary key, owner text references chapter.users(id), text text, kind text, at text);
create table if not exists chapter.attempts(key text primary key, count integer, reset bigint);
create table if not exists chapter.upload_tickets(id text primary key, owner text references chapter.users(id), project_id text references chapter.projects(id), name text, kind text, object_name text, size integer, expires bigint);
alter table chapter.activity add column if not exists project_id text references chapter.projects(id);
create table if not exists chapter.interest(id text primary key, project_id text references chapter.projects(id), kind text not null, email text, message text, at text not null);
create index if not exists interest_project_idx on chapter.interest(project_id,kind);
create index if not exists projects_owner_idx on chapter.projects(owner);
create index if not exists uploads_project_idx on chapter.uploads(project_id);
create index if not exists uploads_owner_idx on chapter.uploads(owner);
create index if not exists sessions_user_idx on chapter.sessions(user_id);
create index if not exists sessions_expiry_idx on chapter.sessions(expires);
create index if not exists memories_project_idx on chapter.memories(project_id);
create index if not exists activity_owner_at_idx on chapter.activity(owner, at desc);
create index if not exists upload_tickets_expiry_idx on chapter.upload_tickets(expires);
alter table chapter.users enable row level security;
alter table chapter.sessions enable row level security;
alter table chapter.projects enable row level security;
alter table chapter.uploads enable row level security;
alter table chapter.memories enable row level security;
alter table chapter.integrations enable row level security;
alter table chapter.activity enable row level security;
alter table chapter.attempts enable row level security;
alter table chapter.upload_tickets enable row level security;
alter table chapter.interest enable row level security;

CREATE TABLE IF NOT EXISTS chapter.workspaces(id TEXT PRIMARY KEY REFERENCES chapter.users(id), name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.members(workspace_id TEXT REFERENCES chapter.workspaces(id), user_id TEXT REFERENCES chapter.users(id), role TEXT NOT NULL, scope TEXT, at TEXT NOT NULL, PRIMARY KEY(workspace_id,user_id));
CREATE TABLE IF NOT EXISTS chapter.invitations(id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES chapter.workspaces(id), email TEXT NOT NULL, role TEXT NOT NULL, scope TEXT, expires BIGINT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.comments(id TEXT PRIMARY KEY, project_id TEXT REFERENCES chapter.projects(id), actor TEXT REFERENCES chapter.users(id), text TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.versions(id TEXT PRIMARY KEY, project_id TEXT REFERENCES chapter.projects(id), actor TEXT, kind TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.templates(id TEXT PRIMARY KEY, owner TEXT REFERENCES chapter.users(id), workspace_id TEXT REFERENCES chapter.workspaces(id), name TEXT NOT NULL, data TEXT NOT NULL, bytes BIGINT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.subscriptions(owner TEXT PRIMARY KEY REFERENCES chapter.users(id), customer TEXT UNIQUE, subscription TEXT UNIQUE, plan TEXT NOT NULL, status TEXT NOT NULL, checked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.billing_events(id TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.usage_counters(owner TEXT REFERENCES chapter.users(id), kind TEXT NOT NULL, period TEXT NOT NULL, used BIGINT NOT NULL, PRIMARY KEY(owner,kind,period));
CREATE TABLE IF NOT EXISTS chapter.notification_preferences(user_id TEXT PRIMARY KEY REFERENCES chapter.users(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.notifications(id TEXT PRIMARY KEY, user_id TEXT REFERENCES chapter.users(id), project_id TEXT REFERENCES chapter.projects(id), kind TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL, read_at TEXT);
CREATE TABLE IF NOT EXISTS chapter.jobs(id TEXT PRIMARY KEY, actor TEXT REFERENCES chapter.users(id), owner TEXT REFERENCES chapter.users(id), kind TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, result TEXT, error TEXT, attempts INTEGER NOT NULL, next_run BIGINT NOT NULL, lease BIGINT NOT NULL, at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS members_user_idx ON chapter.members(user_id);
CREATE INDEX IF NOT EXISTS versions_project_idx ON chapter.versions(project_id,at);
CREATE INDEX IF NOT EXISTS comments_project_idx ON chapter.comments(project_id,at);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON chapter.notifications(user_id,at);
CREATE INDEX IF NOT EXISTS jobs_pending_idx ON chapter.jobs(state,next_run);

alter table chapter.uploads add column if not exists size bigint;
update chapter.uploads set size=octet_length(data) where size is null and data is not null;
alter table chapter.workspaces enable row level security;
alter table chapter.members enable row level security;
alter table chapter.invitations enable row level security;
alter table chapter.comments enable row level security;
alter table chapter.versions enable row level security;
alter table chapter.templates enable row level security;
alter table chapter.subscriptions enable row level security;
alter table chapter.billing_events enable row level security;
alter table chapter.usage_counters enable row level security;
alter table chapter.notification_preferences enable row level security;
alter table chapter.notifications enable row level security;
alter table chapter.jobs enable row level security;

CREATE TABLE IF NOT EXISTS chapter.connection_state(owner TEXT REFERENCES chapter.users(id), provider TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,provider));
CREATE TABLE IF NOT EXISTS chapter.import_batches(id TEXT PRIMARY KEY, owner TEXT REFERENCES chapter.users(id), actor TEXT REFERENCES chapter.users(id), data TEXT NOT NULL, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.external_links(owner TEXT REFERENCES chapter.users(id), identity TEXT NOT NULL, project_id TEXT REFERENCES chapter.projects(id), PRIMARY KEY(owner,identity));
CREATE TABLE IF NOT EXISTS chapter.automation_rules(id TEXT PRIMARY KEY, owner TEXT REFERENCES chapter.users(id), actor TEXT REFERENCES chapter.users(id), project_id TEXT REFERENCES chapter.projects(id), kind TEXT NOT NULL, enabled INTEGER NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.automation_runs(id TEXT PRIMARY KEY, rule_id TEXT REFERENCES chapter.automation_rules(id), event_key TEXT NOT NULL, job_id TEXT NOT NULL, state TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL, finished_at TEXT, UNIQUE(rule_id,event_key));
CREATE TABLE IF NOT EXISTS chapter.review_links(id TEXT PRIMARY KEY, project_id TEXT REFERENCES chapter.projects(id), owner TEXT REFERENCES chapter.users(id), actor TEXT REFERENCES chapter.users(id), data TEXT NOT NULL, expires BIGINT NOT NULL, revoked INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.review_feedback(id TEXT PRIMARY KEY, review_id TEXT REFERENCES chapter.review_links(id), name TEXT NOT NULL, text TEXT NOT NULL, decision TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.public_portfolios(owner TEXT PRIMARY KEY REFERENCES chapter.users(id), slug TEXT UNIQUE NOT NULL, data TEXT NOT NULL, published INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.backups(id TEXT PRIMARY KEY, owner TEXT REFERENCES chapter.users(id), actor TEXT REFERENCES chapter.users(id), project_ids TEXT NOT NULL, manifest TEXT NOT NULL, data BYTEA, object_name TEXT, bytes BIGINT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.recovery_runs(id TEXT PRIMARY KEY, owner TEXT REFERENCES chapter.users(id), actor TEXT REFERENCES chapter.users(id), digest TEXT NOT NULL, result TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.support_requests(id TEXT PRIMARY KEY, actor TEXT REFERENCES chapter.users(id), subject TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS automation_owner_idx ON chapter.automation_rules(owner,enabled);
CREATE INDEX IF NOT EXISTS reviews_project_idx ON chapter.review_links(project_id,at);
CREATE INDEX IF NOT EXISTS feedback_review_idx ON chapter.review_feedback(review_id,at);
CREATE INDEX IF NOT EXISTS backups_owner_idx ON chapter.backups(owner,at);

alter table chapter.connection_state enable row level security;
alter table chapter.import_batches enable row level security;
alter table chapter.external_links enable row level security;
alter table chapter.automation_rules enable row level security;
alter table chapter.automation_runs enable row level security;
alter table chapter.review_links enable row level security;
alter table chapter.review_feedback enable row level security;
alter table chapter.public_portfolios enable row level security;
alter table chapter.backups enable row level security;
alter table chapter.recovery_runs enable row level security;
alter table chapter.support_requests enable row level security;

CREATE TABLE IF NOT EXISTS chapter.resume_sessions(id TEXT PRIMARY KEY, project_id TEXT REFERENCES chapter.projects(id), actor TEXT REFERENCES chapter.users(id), state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS chapter.developer_tokens(id TEXT PRIMARY KEY, actor TEXT REFERENCES chapter.users(id), project_id TEXT REFERENCES chapter.projects(id), token_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, expires BIGINT NOT NULL, revoked INTEGER NOT NULL, at TEXT NOT NULL, last_used TEXT);
CREATE TABLE IF NOT EXISTS chapter.development_captures(id TEXT PRIMARY KEY, project_id TEXT REFERENCES chapter.projects(id), actor TEXT REFERENCES chapter.users(id), token_id TEXT REFERENCES chapter.developer_tokens(id), digest TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.action_proposals(id TEXT PRIMARY KEY, project_id TEXT REFERENCES chapter.projects(id), actor TEXT REFERENCES chapter.users(id), kind TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.attention_states(actor TEXT REFERENCES chapter.users(id), item_key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(actor,item_key));
CREATE TABLE IF NOT EXISTS chapter.product_feedback(id TEXT PRIMARY KEY, actor TEXT REFERENCES chapter.users(id), category TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.feedback_updates(id TEXT PRIMARY KEY, feedback_id TEXT REFERENCES chapter.product_feedback(id), text TEXT NOT NULL, published INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.product_events(id TEXT PRIMARY KEY, actor TEXT REFERENCES chapter.users(id), owner TEXT REFERENCES chapter.users(id), project_id TEXT, action TEXT NOT NULL, outcome TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS resume_project_idx ON chapter.resume_sessions(project_id,at);
CREATE UNIQUE INDEX IF NOT EXISTS resume_active_idx ON chapter.resume_sessions(project_id,actor) WHERE state='active';
CREATE INDEX IF NOT EXISTS capture_project_idx ON chapter.development_captures(project_id,at);
CREATE INDEX IF NOT EXISTS proposal_project_idx ON chapter.action_proposals(project_id,at);
CREATE INDEX IF NOT EXISTS product_events_owner_idx ON chapter.product_events(owner,at);

alter table chapter.resume_sessions enable row level security;
alter table chapter.developer_tokens enable row level security;
alter table chapter.development_captures enable row level security;
alter table chapter.action_proposals enable row level security;
alter table chapter.attention_states enable row level security;
alter table chapter.product_feedback enable row level security;
alter table chapter.feedback_updates enable row level security;
alter table chapter.product_events enable row level security;



CREATE TABLE IF NOT EXISTS chapter.preservation_bundles(id TEXT PRIMARY KEY, project_id TEXT REFERENCES chapter.projects(id), owner TEXT REFERENCES chapter.users(id), upload_id TEXT REFERENCES chapter.uploads(id), digest TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, expires BIGINT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS chapter.bundle_checks(id TEXT PRIMARY KEY, bundle_id TEXT REFERENCES chapter.preservation_bundles(id), actor TEXT REFERENCES chapter.users(id), state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.project_recreations(id TEXT PRIMARY KEY, bundle_id TEXT REFERENCES chapter.preservation_bundles(id), actor TEXT REFERENCES chapter.users(id), project_id TEXT REFERENCES chapter.projects(id), state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, lease BIGINT NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS recreation_bundle_idx ON chapter.project_recreations(bundle_id) WHERE state NOT IN ('canceled');
CREATE TABLE IF NOT EXISTS chapter.transfer_uploads(id TEXT PRIMARY KEY, owner TEXT REFERENCES chapter.users(id), actor TEXT REFERENCES chapter.users(id), project_id TEXT REFERENCES chapter.projects(id), name TEXT NOT NULL, size BIGINT NOT NULL, reserved BIGINT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, upload_id TEXT, lease BIGINT NOT NULL, expires BIGINT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.transfer_chunks(upload_id TEXT REFERENCES chapter.transfer_uploads(id), part INTEGER NOT NULL, digest TEXT NOT NULL, size BIGINT NOT NULL, data BYTEA, object_name TEXT, PRIMARY KEY(upload_id,part));
CREATE TABLE IF NOT EXISTS chapter.package_links(id TEXT PRIMARY KEY, bundle_id TEXT REFERENCES chapter.preservation_bundles(id), actor TEXT REFERENCES chapter.users(id), token_hash TEXT UNIQUE NOT NULL, expires BIGINT NOT NULL, revoked INTEGER NOT NULL, downloads INTEGER NOT NULL, visits INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.package_transfers(id TEXT PRIMARY KEY, link_id TEXT REFERENCES chapter.package_links(id), state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS chapter.shared_services(id TEXT PRIMARY KEY, owner TEXT REFERENCES chapter.users(id), name TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.service_dependencies(service_id TEXT REFERENCES chapter.shared_services(id), project_id TEXT REFERENCES chapter.projects(id), origin TEXT NOT NULL, evidence TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(service_id,project_id));
CREATE INDEX IF NOT EXISTS bundles_project_idx ON chapter.preservation_bundles(project_id,at);
CREATE UNIQUE INDEX IF NOT EXISTS bundle_digest_idx ON chapter.preservation_bundles(project_id,digest) WHERE deleted=0;
CREATE UNIQUE INDEX IF NOT EXISTS bundle_check_active_idx ON chapter.bundle_checks(bundle_id) WHERE state='queued';
CREATE INDEX IF NOT EXISTS transfer_expiry_idx ON chapter.transfer_uploads(state,expires);



alter table chapter.preservation_bundles enable row level security;
alter table chapter.bundle_checks enable row level security;
alter table chapter.project_recreations enable row level security;
alter table chapter.transfer_uploads enable row level security;
alter table chapter.transfer_chunks enable row level security;
alter table chapter.package_links enable row level security;
alter table chapter.package_transfers enable row level security;
alter table chapter.shared_services enable row level security;
alter table chapter.service_dependencies enable row level security;
CREATE TABLE IF NOT EXISTS chapter.account_verifications(user_id TEXT PRIMARY KEY REFERENCES chapter.users(id), email TEXT NOT NULL, verified_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.auth_tokens(token TEXT PRIMARY KEY, user_id TEXT REFERENCES chapter.users(id), email TEXT NOT NULL, purpose TEXT NOT NULL, scope TEXT NOT NULL, expires BIGINT NOT NULL, consumed INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.mail_deliveries(id TEXT PRIMARY KEY, token TEXT NOT NULL, user_id TEXT REFERENCES chapter.users(id), data TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, next_run BIGINT NOT NULL, lease BIGINT NOT NULL, expires BIGINT NOT NULL, error TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.review_access(review_id TEXT PRIMARY KEY REFERENCES chapter.review_links(id), mode TEXT NOT NULL, password TEXT NOT NULL, recipients TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chapter.review_grants(token TEXT PRIMARY KEY, review_id TEXT REFERENCES chapter.review_links(id), email TEXT NOT NULL, expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS auth_tokens_scope_idx ON chapter.auth_tokens(purpose,scope,email);
CREATE INDEX IF NOT EXISTS mail_pending_idx ON chapter.mail_deliveries(state,next_run);
CREATE INDEX IF NOT EXISTS review_grants_expiry_idx ON chapter.review_grants(expires);
alter table chapter.account_verifications enable row level security;
alter table chapter.auth_tokens enable row level security;
alter table chapter.mail_deliveries enable row level security;
alter table chapter.review_access enable row level security;
alter table chapter.review_grants enable row level security;
revoke all on all tables in schema chapter from public, anon, authenticated;
alter default privileges in schema chapter revoke all on tables from public, anon, authenticated;
-- No public Storage policies. Only the server secret can sign specific uploads/downloads.
insert into storage.buckets(id,name,public,file_size_limit)
values('chapter-files','chapter-files',false,104857600)
on conflict(id) do update set public=false,file_size_limit=104857600;
commit;
