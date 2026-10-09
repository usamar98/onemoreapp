import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgresQuery } from "../src/lib/database";

test("cloud schema and runtime SQL work in PostgreSQL; browser roles cannot read private tables", async () => {
  const pg = new PGlite();
  try {
    // Supabase supplies these roles and Storage schema in a real project.
    await pg.exec(
      "create role anon; create role authenticated; create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);",
    );
    await pg.exec(readFileSync("cloud/schema.sql", "utf8"));
    const query = (sql: string, values: unknown[] = []) =>
      pg.query<Record<string, unknown>>(postgresQuery(sql), values);
    await query("INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)", [
      "owner",
      "Owner",
      "owner@example.test",
      "salt:hash",
    ]);
    await query("INSERT INTO sessions VALUES(?,?,?)", [
      "session-hash",
      "owner",
      Date.now() + 60000,
    ]);
    const session = await query(
      "SELECT u.id,u.name,u.email,u.demo FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
      ["session-hash", Date.now()],
    );
    assert.equal(session.rows[0].id, "owner");
    await query("INSERT INTO projects VALUES(?,?,?,?)", [
      "project",
      "owner",
      "stable-share",
      '{"name":"Cloud project","shared":false}',
    ]);
    assert.equal(
      (
        await query("SELECT data FROM projects WHERE id=? AND owner=?", [
          "project",
          "other-owner",
        ])
      ).rows.length,
      0,
    );
    await query(
      "INSERT INTO integrations VALUES(?,?,?) ON CONFLICT(owner,provider) DO UPDATE SET token=excluded.token",
      ["owner", "vercel", "encrypted-value"],
    );
    await query(
      "INSERT INTO activity(id,owner,text,kind,at,project_id) VALUES(?,?,?,?,?,?)",
      ["event", "owner", "Parked the project", "park", "2026-10-06", "project"],
    );
    await query(
      "INSERT INTO interest(id,project_id,kind,email,message,at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      ["signup", "project", "signup", "private@example.test", "", "2026-10-06"],
    );
    await query(
      "INSERT INTO interest(id,project_id,kind,email,message,at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      ["signup", "project", "signup", "private@example.test", "", "2026-10-06"],
    );
    assert.equal(
      (
        await query(
          "SELECT i.project_id,i.kind,count(*) AS count FROM interest i JOIN projects p ON p.id=i.project_id WHERE p.owner=? GROUP BY i.project_id,i.kind",
          ["owner"],
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await query(
          "SELECT i.project_id,i.kind,count(*) AS count FROM interest i JOIN projects p ON p.id=i.project_id WHERE p.owner=? GROUP BY i.project_id,i.kind",
          ["another-owner"],
        )
      ).rows.length,
      0,
    );
    const rateSql =
      "INSERT INTO attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN attempts.reset>? THEN attempts.count+1 ELSE 1 END, reset=CASE WHEN attempts.reset>? THEN attempts.reset ELSE excluded.reset END RETURNING count";
    const now = Date.now();
    assert.equal(
      (await query(rateSql, ["ip", 1, now + 60000, now, now])).rows[0].count,
      1,
    );
    assert.equal(
      (await query(rateSql, ["ip", 1, now + 60000, now, now])).rows[0].count,
      2,
    );
    await query(
      "INSERT INTO uploads(id,owner,project_id,name,kind,type,data,object_name) VALUES(?,?,?,?,?,?,?,?)",
      [
        "file",
        "owner",
        "project",
        "source.zip",
        "source",
        "application/zip",
        null,
        "owner/project/file",
      ],
    );
    await query("INSERT INTO upload_tickets VALUES(?,?,?,?,?,?,?,?)", [
      "ticket",
      "owner",
      "project",
      "build.zip",
      "source",
      "owner/project/staging/ticket",
      100,
      now + 60000,
    ]);
    assert.equal(
      (
        await query(
          "DELETE FROM upload_tickets WHERE id=? AND owner=? AND project_id=? AND expires>? RETURNING *",
          ["ticket", "other-owner", "project", now],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await query(
          "DELETE FROM upload_tickets WHERE id=? AND owner=? AND project_id=? AND expires>? RETURNING *",
          ["ticket", "owner", "project", now],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await query(
          "DELETE FROM upload_tickets WHERE id=? AND owner=? AND project_id=? AND expires>? RETURNING *",
          ["ticket", "owner", "project", now],
        )
      ).rows.length,
      0,
    );
    const tables = await pg.query<{ secured: boolean }>(
      "select relrowsecurity as secured from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='chapter' and c.relkind='r'",
    );
    assert.equal(tables.rows.length, 50);
    assert.ok(tables.rows.every((r) => r.secured));
    assert.equal(
      (
        await pg.query<{ public: boolean }>(
          "SELECT public FROM storage.buckets WHERE id='chapter-files'",
        )
      ).rows[0].public,
      false,
    );
    await pg.exec("set role anon");
    await assert.rejects(
      () => pg.query("SELECT * FROM chapter.projects"),
      /permission denied/,
    );
    await pg.exec("reset role; set role authenticated");
    await assert.rejects(
      () => pg.query("SELECT * FROM chapter.integrations"),
      /permission denied/,
    );
  } finally {
    await pg.close();
  }
});
