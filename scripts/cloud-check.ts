import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

async function check() {
  for (const key of [
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "CHAPTER_ENCRYPTION_KEY",
  ])
    if (!process.env[key])
      throw new Error(`Set ${key} in ignored .env.local first.`);
  if (Buffer.from(process.env.CHAPTER_ENCRYPTION_KEY!, "base64").length !== 32)
    throw new Error(
      "CHAPTER_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
    );
  const sql = postgres(process.env.DATABASE_URL!, {
    prepare: false,
    max: 1,
    ssl: "require",
    connect_timeout: 15,
  });
  try {
    const rows =
      await sql`select count(*)::int as count from information_schema.tables where table_schema='chapter'`;
    if (rows[0].count !== 55)
      throw new Error(
        "Apply cloud/schema.sql in your Supabase SQL editor first.",
      );
    const exposed =
      await sql`select count(*)::int as count from information_schema.role_table_grants where table_schema='chapter' and grantee in ('anon','authenticated','PUBLIC')`;
    if (exposed[0].count !== 0)
      throw new Error(
        "Chapter tables must not be accessible by browser roles.",
      );
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false } },
    );
    const { data: bucket, error } =
      await supabase.storage.getBucket("chapter-files");
    if (error || !bucket || bucket.public)
      throw new Error(
        "Create the private chapter-files bucket using cloud/schema.sql.",
      );
    const path = `setup-check/${crypto.randomUUID()}`;
    const { error: uploadError } = await supabase.storage
      .from("chapter-files")
      .upload(path, Buffer.from("Chapter private storage check"), {
        upsert: false,
      });
    if (uploadError)
      throw new Error(
        "The server key cannot upload files to the private bucket.",
      );
    try {
      const { data, error: readError } = await supabase.storage
        .from("chapter-files")
        .download(path);
      if (readError || (await data?.text()) !== "Chapter private storage check")
        throw new Error("Could not verify private file persistence.");
    } finally {
      await supabase.storage.from("chapter-files").remove([path]);
    }
    console.log(
      "Cloud database schema, private permissions, encryption key, and file persistence verified. No credentials were printed.",
    );
  } finally {
    await sql.end();
  }
}
check().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Cloud setup check failed.",
  );
  process.exitCode = 1;
});
