export const phaseFiveSchema = `
CREATE TABLE IF NOT EXISTS resume_sessions(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), actor TEXT REFERENCES users(id), state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS developer_tokens(id TEXT PRIMARY KEY, actor TEXT REFERENCES users(id), project_id TEXT REFERENCES projects(id), token_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, expires BIGINT NOT NULL, revoked INTEGER NOT NULL, at TEXT NOT NULL, last_used TEXT);
CREATE TABLE IF NOT EXISTS development_captures(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), actor TEXT REFERENCES users(id), token_id TEXT REFERENCES developer_tokens(id), digest TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS action_proposals(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), actor TEXT REFERENCES users(id), kind TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attention_states(actor TEXT REFERENCES users(id), item_key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(actor,item_key));
CREATE TABLE IF NOT EXISTS product_feedback(id TEXT PRIMARY KEY, actor TEXT REFERENCES users(id), category TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feedback_updates(id TEXT PRIMARY KEY, feedback_id TEXT REFERENCES product_feedback(id), text TEXT NOT NULL, published INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS product_events(id TEXT PRIMARY KEY, actor TEXT REFERENCES users(id), owner TEXT REFERENCES users(id), project_id TEXT, action TEXT NOT NULL, outcome TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS resume_project_idx ON resume_sessions(project_id,at);
CREATE UNIQUE INDEX IF NOT EXISTS resume_active_idx ON resume_sessions(project_id,actor) WHERE state='active';
CREATE INDEX IF NOT EXISTS capture_project_idx ON development_captures(project_id,at);
CREATE INDEX IF NOT EXISTS proposal_project_idx ON action_proposals(project_id,at);
CREATE INDEX IF NOT EXISTS product_events_owner_idx ON product_events(owner,at);
`;
export const phaseFiveTables = [
  "resume_sessions",
  "developer_tokens",
  "development_captures",
  "action_proposals",
  "attention_states",
  "product_feedback",
  "feedback_updates",
  "product_events",
];
