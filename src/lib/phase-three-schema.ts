// Shared by the local and cloud migrations. Access remains server-only.
export const phaseThreeSchema = `
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY REFERENCES users(id), name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members(workspace_id TEXT REFERENCES workspaces(id), user_id TEXT REFERENCES users(id), role TEXT NOT NULL, scope TEXT, at TEXT NOT NULL, PRIMARY KEY(workspace_id,user_id));
CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id), email TEXT NOT NULL, role TEXT NOT NULL, scope TEXT, expires BIGINT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), actor TEXT REFERENCES users(id), text TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), actor TEXT, kind TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), workspace_id TEXT REFERENCES workspaces(id), name TEXT NOT NULL, data TEXT NOT NULL, bytes BIGINT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions(owner TEXT PRIMARY KEY REFERENCES users(id), customer TEXT UNIQUE, subscription TEXT UNIQUE, plan TEXT NOT NULL, status TEXT NOT NULL, checked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS billing_events(id TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usage_counters(owner TEXT REFERENCES users(id), kind TEXT NOT NULL, period TEXT NOT NULL, used BIGINT NOT NULL, PRIMARY KEY(owner,kind,period));
CREATE TABLE IF NOT EXISTS notification_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), project_id TEXT REFERENCES projects(id), kind TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL, read_at TEXT);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, actor TEXT REFERENCES users(id), owner TEXT REFERENCES users(id), kind TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, result TEXT, error TEXT, attempts INTEGER NOT NULL, next_run BIGINT NOT NULL, lease BIGINT NOT NULL, at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS members_user_idx ON members(user_id);
CREATE INDEX IF NOT EXISTS versions_project_idx ON versions(project_id,at);
CREATE INDEX IF NOT EXISTS comments_project_idx ON comments(project_id,at);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id,at);
CREATE INDEX IF NOT EXISTS jobs_pending_idx ON jobs(state,next_run);
`;
export const phaseThreeTables = [
  "workspaces",
  "members",
  "invitations",
  "comments",
  "versions",
  "templates",
  "subscriptions",
  "billing_events",
  "usage_counters",
  "notification_preferences",
  "notifications",
  "jobs",
];
