export const phaseFourSchema = `
CREATE TABLE IF NOT EXISTS connection_state(owner TEXT REFERENCES users(id), provider TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,provider));
CREATE TABLE IF NOT EXISTS import_batches(id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), actor TEXT REFERENCES users(id), data TEXT NOT NULL, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS external_links(owner TEXT REFERENCES users(id), identity TEXT NOT NULL, project_id TEXT REFERENCES projects(id), PRIMARY KEY(owner,identity));
CREATE TABLE IF NOT EXISTS automation_rules(id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), actor TEXT REFERENCES users(id), project_id TEXT REFERENCES projects(id), kind TEXT NOT NULL, enabled INTEGER NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automation_runs(id TEXT PRIMARY KEY, rule_id TEXT REFERENCES automation_rules(id), event_key TEXT NOT NULL, job_id TEXT NOT NULL, state TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL, finished_at TEXT, UNIQUE(rule_id,event_key));
CREATE TABLE IF NOT EXISTS review_links(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), owner TEXT REFERENCES users(id), actor TEXT REFERENCES users(id), data TEXT NOT NULL, expires BIGINT NOT NULL, revoked INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS review_feedback(id TEXT PRIMARY KEY, review_id TEXT REFERENCES review_links(id), name TEXT NOT NULL, text TEXT NOT NULL, decision TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS public_portfolios(owner TEXT PRIMARY KEY REFERENCES users(id), slug TEXT UNIQUE NOT NULL, data TEXT NOT NULL, published INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), actor TEXT REFERENCES users(id), project_ids TEXT NOT NULL, manifest TEXT NOT NULL, data BLOB, object_name TEXT, bytes BIGINT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_runs(id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), actor TEXT REFERENCES users(id), digest TEXT NOT NULL, result TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS support_requests(id TEXT PRIMARY KEY, actor TEXT REFERENCES users(id), subject TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS automation_owner_idx ON automation_rules(owner,enabled);
CREATE INDEX IF NOT EXISTS reviews_project_idx ON review_links(project_id,at);
CREATE INDEX IF NOT EXISTS feedback_review_idx ON review_feedback(review_id,at);
CREATE INDEX IF NOT EXISTS backups_owner_idx ON backups(owner,at);
`;
export const phaseFourTables = [
  "connection_state",
  "import_batches",
  "external_links",
  "automation_rules",
  "automation_runs",
  "review_links",
  "review_feedback",
  "public_portfolios",
  "backups",
  "recovery_runs",
  "support_requests",
];
