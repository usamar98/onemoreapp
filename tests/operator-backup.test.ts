import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import {
  createLocalBackup,
  restoreLocalBackup,
} from "../scripts/local-recovery";

test("encrypted platform snapshot verifies and restores accounts, access and files into a quarantined directory", async () => {
  const base = path.join(
    process.cwd(),
    ".data",
    "operator-test-" + randomUUID(),
  );
  const source = path.join(base, "source");
  mkdirSync(source, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path.join(source, "encryption.key"), key);
  const database = new DatabaseSync(path.join(source, "chapter.sqlite"));
  database.exec(
    "CREATE TABLE users(id TEXT,password TEXT); CREATE TABLE sessions(token TEXT); CREATE TABLE members(user_id TEXT,role TEXT); CREATE TABLE projects(id TEXT,data TEXT); CREATE TABLE uploads(id TEXT,data BLOB,object_name TEXT); CREATE TABLE jobs(state TEXT,lease INTEGER,error TEXT); CREATE TABLE automation_rules(enabled INTEGER); CREATE TABLE public_portfolios(published INTEGER); CREATE TABLE review_links(revoked INTEGER);",
  );
  database
    .prepare("INSERT INTO users VALUES(?,?)")
    .run("owner", "password-hash");
  database.prepare("INSERT INTO members VALUES(?,?)").run("editor", "Editor");
  database.prepare("INSERT INTO sessions VALUES(?)").run("private-session");
  database.prepare("INSERT INTO projects VALUES(?,?)").run(
    "garden",
    JSON.stringify({
      name: "Garden",
      status: "Parked",
      memory: { nextTask: "Fix progress" },
      shared: true,
      syncEnabled: true,
    }),
  );
  database
    .prepare("INSERT INTO uploads VALUES(?,?,?)")
    .run("source", Buffer.from("immutable upload"), null);
  database.exec(
    "INSERT INTO jobs VALUES('queued',0,NULL); INSERT INTO automation_rules VALUES(1); INSERT INTO public_portfolios VALUES(1); INSERT INTO review_links VALUES(0);",
  );
  const pass = "test-only-long-operator-passphrase";
  database.exec(
    "CREATE TABLE developer_tokens(revoked INTEGER); INSERT INTO developer_tokens VALUES(0); CREATE TABLE resume_sessions(state TEXT); INSERT INTO resume_sessions VALUES('active');",
  );
  const out = await createLocalBackup(source, pass);
  assert.ok(!out.bytes.includes(Buffer.from("password-hash")));
  assert.ok(!out.bytes.includes(key));
  await assert.rejects(
    restoreLocalBackup(
      out.bytes,
      "wrong-passphrase-with-enough-length",
      path.join(base, "wrong"),
    ),
    /authentication/,
  );
  const changed = Buffer.from(out.bytes);
  changed[changed.length - 1] ^= 1;
  await assert.rejects(
    restoreLocalBackup(changed, pass, path.join(base, "corrupt")),
    /authentication/,
  );
  const restored = await restoreLocalBackup(
    out.bytes,
    pass,
    path.join(base, "restored"),
  );
  const recovered = new DatabaseSync(
    path.join(restored.directory, "chapter.sqlite"),
    { readOnly: true },
  );
  assert.equal(
    recovered.prepare("SELECT revoked FROM developer_tokens").get()?.revoked,
    1,
  );
  assert.equal(
    recovered.prepare("SELECT state FROM resume_sessions").get()?.state,
    "canceled",
  );
  assert.equal(
    recovered.prepare("SELECT password FROM users").get()?.password,
    "password-hash",
  );
  assert.equal(
    recovered.prepare("SELECT role FROM members").get()?.role,
    "Editor",
  );
  assert.equal(
    Buffer.from(
      recovered.prepare("SELECT data FROM uploads").get()!.data as Uint8Array,
    ).toString(),
    "immutable upload",
  );
  assert.equal(
    recovered.prepare("SELECT count(*) AS n FROM sessions").get()?.n,
    0,
  );
  assert.equal(
    recovered.prepare("SELECT state FROM jobs").get()?.state,
    "failed",
  );
  assert.equal(
    recovered.prepare("SELECT enabled FROM automation_rules").get()?.enabled,
    0,
  );
  assert.equal(
    recovered.prepare("SELECT published FROM public_portfolios").get()
      ?.published,
    0,
  );
  assert.equal(
    recovered.prepare("SELECT revoked FROM review_links").get()?.revoked,
    1,
  );
  const p = JSON.parse(
    String(recovered.prepare("SELECT data FROM projects").get()?.data),
  );
  assert.equal(p.memory.nextTask, "Fix progress");
  assert.equal(p.shared, false);
  assert.equal(p.syncEnabled, false);
  assert.deepEqual(
    readFileSync(path.join(restored.directory, "encryption.key")),
    key,
  );
  assert.equal(
    database.prepare("SELECT token FROM sessions").get()?.token,
    "private-session",
  );
  await assert.rejects(
    restoreLocalBackup(out.bytes, pass, restored.directory),
    /never overwritten/,
  );
  recovered.close();
  database.close();
});
