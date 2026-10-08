#!/usr/bin/env node
// Standalone Chapter capture CLI. Node.js 24+; no dependency installation.
import { readFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
const privatePath =
  /(^|\/)(?:customers?|clients?|contacts?|exports?|backups?|dumps?|logs?|analytics|fixtures|__fixtures__|test-data|data)(?:[._/-]|$)|\.(?:csv|tsv|sql|db|sqlite\d?|log|xlsx?|parquet|pdf|png|jpe?g|webp|gif|mp4|zip|map)$/i;
class CaptureError extends Error {}
function eligible(name) {
  if (privatePath.test(name) || name.split("/").some((p) => p.startsWith(".")))
    return false;
  if (/\.json$/i.test(name))
    return /(^|\/)(?:package(?:-lock)?|tsconfig[^/]*|jsconfig|vercel|[^/]+\.config)\.json$/i.test(
      name,
    );
  return (
    /\.(?:[cm]?js|jsx|ts|tsx|html|css|scss|md|txt|ya?ml|toml|xml|svg|sh|py|rb|go|rs)$/i.test(
      name,
    ) || /(^|\/)(?:LICENSE|Dockerfile|Makefile)$/i.test(name)
  );
}
function credentials(text, token = "") {
  return (
    /\b(?:ch_dev_[a-f0-9]{64}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b|-----BEGIN [\w ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|authorization|database_url)\s*[:=]\s*["']?[^\s,;]+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/[^\s/@]+:[^\s/@]+@/i.test(
      text,
    ) ||
    (token && text.includes(token))
  );
}
export async function prepareCapture(input, root = process.cwd(), token = "") {
  const base = await realpath(root);
  if (!input || typeof input !== "object")
    throw new CaptureError("Input must be a JSON object.");
  const { filePaths = [], ...payload } = input;
  if (
    Object.keys(payload).some(
      (k) =>
        !["id", "notes", "commit", "nextTask", "blockers", "minutes"].includes(
          k,
        ),
    )
  )
    throw new CaptureError(
      "Unsupported input fields. Use notes, commit, nextTask, blockers, minutes and filePaths.",
    );
  if (!Array.isArray(filePaths) || filePaths.length > 30)
    throw new CaptureError("Select up to 30 files.");
  const files = [];
  let total = 0;
  for (const name of filePaths) {
    if (
      typeof name !== "string" ||
      !eligible(name) ||
      credentials(name, token) ||
      name.includes("\\") ||
      name.includes(":") ||
      name.split("/").some((p) => !p || p === "." || p === "..") ||
      path.isAbsolute(name)
    )
      throw new CaptureError(
        "Private or unsafe file path. Choose code and documentation inside the current directory.",
      );
    const absolute = path.resolve(base, name),
      resolved = await realpath(absolute),
      relative = path.relative(base, resolved);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      (await lstat(absolute)).isSymbolicLink() ||
      resolved !== absolute
    )
      throw new CaptureError(
        "Symlinks and files outside the working directory cannot be captured.",
      );
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.size > 32768)
      throw new CaptureError(
        "Each selected file must be regular text and under 32 KB.",
      );
    const bytes = await readFile(absolute),
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (content.includes("\0") || credentials(content, token))
      throw new CaptureError(
        "Selected file contains credentials or private contact data. Remove them before capture.",
      );
    total += bytes.length;
    if (total > 512 * 1024)
      throw new CaptureError("Selected files exceed 512 KB.");
    files.push({ path: name, content });
  }
  for (const key of ["notes", "nextTask", "blockers"])
    if (payload[key] && credentials(String(payload[key]), token))
      throw new CaptureError(
        "Notes contain credentials or private contact data. Remove them before capture.",
      );
  return { id: payload.id || randomUUID(), ...payload, files };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes("--help")) {
    process.stdout.write(
      "Chapter CLI: capture --input progress.json --dry-run | --reviewed\nSet CHAPTER_URL, CHAPTER_PROJECT, CHAPTER_TOKEN in your environment.\nInput: {id:UUID, notes, commit:SHA, nextTask, blockers, minutes, filePaths:[relative paths]}.\nUse a saved id for safe retries. No tokens, file contents or notes are printed.\n",
    );
    return;
  }
  if (
    args[0] !== "capture" ||
    args.some(
      (v, i) =>
        i > 0 &&
        !["--input", "--dry-run", "--reviewed"].includes(v) &&
        args[i - 1] !== "--input",
    )
  )
    throw new CaptureError("Unknown command or option. Run --help.");
  const at = args.indexOf("--input"),
    inputPath = args[at + 1];
  if (at < 0 || !inputPath || inputPath.startsWith("--"))
    throw new CaptureError("Use --input with a local progress JSON file.");
  if (!args.includes("--dry-run") && !args.includes("--reviewed"))
    throw new CaptureError(
      "Run a dry run, review the input and file list, then use --reviewed.",
    );
  const inputStat = await lstat(inputPath);
  if (inputStat.isSymbolicLink() || inputStat.size > 100000)
    throw new CaptureError("Input must be a regular JSON file under 100 KB.");
  let input;
  try {
    input = JSON.parse(await readFile(inputPath, "utf8"));
  } catch {
    throw new CaptureError("Input is not valid JSON.");
  }
  const token = process.env.CHAPTER_TOKEN || "",
    payload = await prepareCapture(input, process.cwd(), token);
  if (args.includes("--dry-run")) {
    process.stdout.write(
      JSON.stringify(
        {
          id: payload.id,
          fields: Object.keys(payload).filter((k) => k !== "files"),
          files: payload.files.map((f) => ({
            path: f.path,
            bytes: Buffer.byteLength(f.content),
          })),
          effect:
            "Private project notes and selected snapshots only. No repository, build, deployment or hosting change.",
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }
  const base = new URL(process.env.CHAPTER_URL || "http://localhost:3000"),
    project = process.env.CHAPTER_PROJECT;
  if (
    (base.protocol !== "https:" &&
      !(
        base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
      )) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new CaptureError(
      "CHAPTER_URL must use HTTPS, or HTTP localhost for development, without credentials.",
    );
  if (
    !project ||
    !/^[\w-]{1,100}$/.test(project) ||
    !/^ch_dev_[a-f0-9]{64}$/.test(token)
  )
    throw new CaptureError(
      "Set a valid CHAPTER_PROJECT and CHAPTER_TOKEN; never pass the token as a CLI argument.",
    );
  const url = new URL("/api/developer/projects/" + project + "/capture", base);
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      if (attempt === 2)
        throw new CaptureError(
          "Capture connection failed. Retry the same input id after checking Chapter's status.",
        );
    }
    if (response && response.status < 500 && response.status !== 429) break;
    if (attempt < 2)
      await new Promise((r) => setTimeout(r, (attempt + 1) * 1000));
  }
  if (!response?.ok)
    throw new CaptureError(
      "Capture was not accepted (HTTP " +
        (response?.status || "unavailable") +
        "). Check token scope, permission, file safety and plan limits in Chapter; retry using the same input id.",
    );
  const result = await response.json();
  process.stdout.write(
    JSON.stringify({
      saved: result.saved,
      id: result.id,
      duplicate: result.duplicate,
      projectId: result.projectId,
    }) + "\n",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch((error) => {
    process.stderr.write(
      "Chapter capture failed: " +
        (error instanceof CaptureError
          ? error.message
          : "Check input, selected file safety, project permissions, storage limits and connectivity. Use --help for supported options.") +
        "\n",
    );
    process.exitCode = 1;
  });
