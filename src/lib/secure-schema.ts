export const secureTables = [
  "account_verifications",
  "auth_tokens",
  "mail_deliveries",
  "review_access",
  "review_grants",
];
export const secureSchema = `
CREATE TABLE IF NOT EXISTS account_verifications(user_id TEXT PRIMARY KEY REFERENCES users(id), email TEXT NOT NULL, verified_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_tokens(token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), email TEXT NOT NULL, purpose TEXT NOT NULL, scope TEXT NOT NULL, expires BIGINT NOT NULL, consumed INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mail_deliveries(id TEXT PRIMARY KEY, token TEXT NOT NULL, user_id TEXT REFERENCES users(id), data TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, next_run BIGINT NOT NULL, lease BIGINT NOT NULL, expires BIGINT NOT NULL, error TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS review_access(review_id TEXT PRIMARY KEY REFERENCES review_links(id), mode TEXT NOT NULL, password TEXT NOT NULL, recipients TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS review_grants(token TEXT PRIMARY KEY, review_id TEXT REFERENCES review_links(id), email TEXT NOT NULL, expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS auth_tokens_scope_idx ON auth_tokens(purpose,scope,email);
CREATE INDEX IF NOT EXISTS mail_pending_idx ON mail_deliveries(state,next_run);
CREATE INDEX IF NOT EXISTS review_grants_expiry_idx ON review_grants(expires);
`;
