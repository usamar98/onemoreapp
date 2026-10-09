export const phaseSixTables = [
  "preservation_bundles",
  "bundle_checks",
  "project_recreations",
  "transfer_uploads",
  "transfer_chunks",
  "package_links",
  "package_transfers",
  "shared_services",
  "service_dependencies",
];
export const phaseSixSchema = `
CREATE TABLE IF NOT EXISTS preservation_bundles(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), owner TEXT REFERENCES users(id), upload_id TEXT REFERENCES uploads(id), digest TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, expires BIGINT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS bundle_checks(id TEXT PRIMARY KEY, bundle_id TEXT REFERENCES preservation_bundles(id), actor TEXT REFERENCES users(id), state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_recreations(id TEXT PRIMARY KEY, bundle_id TEXT REFERENCES preservation_bundles(id), actor TEXT REFERENCES users(id), project_id TEXT REFERENCES projects(id), state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, lease BIGINT NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS recreation_bundle_idx ON project_recreations(bundle_id) WHERE state NOT IN ('canceled');
CREATE TABLE IF NOT EXISTS transfer_uploads(id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), actor TEXT REFERENCES users(id), project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, size BIGINT NOT NULL, reserved BIGINT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, upload_id TEXT, lease BIGINT NOT NULL, expires BIGINT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transfer_chunks(upload_id TEXT REFERENCES transfer_uploads(id), part INTEGER NOT NULL, digest TEXT NOT NULL, size BIGINT NOT NULL, data BLOB, object_name TEXT, PRIMARY KEY(upload_id,part));
CREATE TABLE IF NOT EXISTS package_links(id TEXT PRIMARY KEY, bundle_id TEXT REFERENCES preservation_bundles(id), actor TEXT REFERENCES users(id), token_hash TEXT UNIQUE NOT NULL, expires BIGINT NOT NULL, revoked INTEGER NOT NULL, downloads INTEGER NOT NULL, visits INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS package_transfers(id TEXT PRIMARY KEY, link_id TEXT REFERENCES package_links(id), state TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS shared_services(id TEXT PRIMARY KEY, owner TEXT REFERENCES users(id), name TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS service_dependencies(service_id TEXT REFERENCES shared_services(id), project_id TEXT REFERENCES projects(id), origin TEXT NOT NULL, evidence TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(service_id,project_id));
CREATE INDEX IF NOT EXISTS bundles_project_idx ON preservation_bundles(project_id,at);
CREATE UNIQUE INDEX IF NOT EXISTS bundle_digest_idx ON preservation_bundles(project_id,digest) WHERE deleted=0;
CREATE UNIQUE INDEX IF NOT EXISTS bundle_check_active_idx ON bundle_checks(bundle_id) WHERE state='queued';
CREATE INDEX IF NOT EXISTS transfer_expiry_idx ON transfer_uploads(state,expires);
`;
