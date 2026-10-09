import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { db, transaction, cloudMode } from "./database";
import { projectAccess, workspaceRole } from "./access";
import { accountSecrets, uploadBytes, record } from "./db";
import { usageStep, release } from "./billing";
import { AppError, encrypt, decrypt, hash } from "./security";
import {
  writeObject,
  readObject,
  removeObject,
  readObjectRange,
} from "./storage";
import { inspectZip } from "./uploads";
import {
  bundleAccess,
  verifiedBundleBytes,
  PACKAGE_LIMIT,
  sha256,
} from "./preservation";
import { handoverText } from "./phase-two";
import { versionSteps } from "./versions";
export const CHUNK_SIZE = 1024 * 1024;
export const startUploadOptions = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .regex(/\.zip$/i),
  size: z.number().int().min(1).max(PACKAGE_LIMIT),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export async function transferAccess(actor: string, id: string, edit = true) {
  const r = await db()
    .prepare("SELECT * FROM transfer_uploads WHERE id=? AND actor=?")
    .get(id, actor);
  if (!r) throw new AppError("Upload session not found.", 404);
  await projectAccess(String(r.project_id), actor, edit ? "edit" : "read");
  if (Number(r.expires) <= Date.now() && r.state !== "completed")
    throw new AppError("Upload session expired. Start a new upload.", 410);
  return r;
}
export async function startTransferUpload(
  actor: string,
  projectId: string,
  raw: unknown,
) {
  const input = startUploadOptions.parse(raw),
    a = await projectAccess(projectId, actor, "edit");
  if (
    handoverText(input.name, await accountSecrets(a.owner)) !== input.name ||
    /(^|[\\/])\./.test(input.name) ||
    /[\\/]/.test(input.name)
  )
    throw new AppError(
      "Use a ZIP filename without private information or paths.",
    );
  const existing = await db()
    .prepare(
      "SELECT id FROM transfer_uploads WHERE actor=? AND project_id=? AND digest=? AND size=? AND state IN ('uploading','finalizing','completed') AND expires>? ORDER BY at DESC LIMIT 1",
    )
    .get(actor, projectId, input.digest, input.size, Date.now());
  if (existing) return transferUploadStatus(actor, String(existing.id));
  const id = randomUUID(),
    reserved =
      Math.ceil(input.size / 3) * 4 + Math.ceil(input.size / CHUNK_SIZE) * 28;
  await transaction([
    await usageStep(a.owner, "storage", reserved),
    {
      sql: "INSERT INTO transfer_uploads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      parameters: [
        id,
        a.owner,
        actor,
        projectId,
        input.name,
        input.size,
        reserved,
        input.digest,
        "uploading",
        randomUUID(),
        0,
        Date.now() + 86400000,
        new Date().toISOString(),
      ],
    },
  ]);
  return transferUploadStatus(actor, id);
}
export async function transferUploadStatus(actor: string, id: string) {
  const r = await transferAccess(actor, id, false),
    chunks = await db()
      .prepare(
        "SELECT part,digest,size FROM transfer_chunks WHERE upload_id=? ORDER BY part",
      )
      .all(id);
  return {
    id,
    state: String(r.state),
    size: Number(r.size),
    reserved: Number(r.reserved),
    digest: String(r.digest),
    chunkSize: CHUNK_SIZE,
    parts: chunks.map((c) => ({
      part: Number(c.part),
      digest: String(c.digest),
      size: Number(c.size),
    })),
    expires: Number(r.expires),
    uploadId: r.state === "completed" ? String(r.upload_id) : "",
  };
}
export async function putTransferChunk(
  actor: string,
  id: string,
  part: number,
  bytes: Buffer,
  digest: string,
) {
  const r = await transferAccess(actor, id),
    expected = Math.min(CHUNK_SIZE, Number(r.size) - part * CHUNK_SIZE);
  if (r.state !== "uploading")
    throw new AppError(
      "Upload is already finalizing or complete. Refresh its status.",
      409,
    );
  if (
    !Number.isInteger(part) ||
    part < 0 ||
    part >= Math.ceil(Number(r.size) / CHUNK_SIZE) ||
    bytes.length !== expected ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    sha256(bytes) !== digest
  )
    throw new AppError(
      "Chunk size or checksum did not match. Retry this chunk.",
      409,
    );
  const prior = await db()
    .prepare("SELECT digest FROM transfer_chunks WHERE upload_id=? AND part=?")
    .get(id, part);
  if (prior) {
    if (prior.digest !== digest)
      throw new AppError(
        "This chunk already has different contents. Start a new upload.",
        409,
      );
    return;
  }
  const encrypted = Buffer.from(encrypt(bytes.toString("base64")), "base64"),
    object = cloudMode()
      ? `${r.owner}/${r.project_id}/staging/${id}/${part}-${randomUUID()}`
      : null;
  try {
    if (object)
      await writeObject(object, encrypted, "application/octet-stream");
    await transaction([
      {
        sql: "UPDATE transfer_uploads SET lease=lease WHERE id=? AND state='uploading' AND expires>? RETURNING id",
        parameters: [id, Date.now()],
        required:
          "Upload session changed while sending this chunk. Refresh status.",
      },
      {
        sql: "INSERT INTO transfer_chunks VALUES(?,?,?,?,?,?)",
        parameters: [
          id,
          part,
          digest,
          bytes.length,
          object ? null : encrypted,
          object,
        ],
      },
    ]);
  } catch (e) {
    const prior = await db()
      .prepare(
        "SELECT digest,object_name FROM transfer_chunks WHERE upload_id=? AND part=?",
      )
      .get(id, part);
    if (prior?.digest === digest) {
      if (object && prior.object_name !== object)
        await removeObject(object).catch(() => undefined);
      return;
    }
    if (object) await removeObject(object).catch(() => undefined);
    throw e;
  }
}
export async function clearTransferChunks(id: string) {
  const rows = await db()
    .prepare("SELECT object_name FROM transfer_chunks WHERE upload_id=?")
    .all(id);
  for (const r of rows)
    if (r.object_name) await removeObject(String(r.object_name));
  await db().prepare("DELETE FROM transfer_chunks WHERE upload_id=?").run(id);
}
export async function cancelTransferUpload(actor: string, id: string) {
  const r = await transferAccess(actor, id);
  if (r.state === "finalizing" && Number(r.lease) > Date.now())
    throw new AppError(
      "Finalization is running. Refresh status before cancelling.",
      409,
    );
  if (r.state === "completed")
    throw new AppError(
      "Upload completed. It is now a versioned source record.",
      409,
    );
  await clearTransferChunks(id);
  const canceled = await db()
    .prepare(
      "UPDATE transfer_uploads SET state='canceled',reserved=0 WHERE id=? AND state IN ('uploading','finalizing','failed') RETURNING reserved",
    )
    .get(id);
  if (canceled) await release(String(r.owner), "storage", Number(r.reserved));
}
export async function finishTransferUpload(actor: string, id: string) {
  const original = await transferAccess(actor, id);
  if (original.state === "completed")
    return { uploadId: String(original.upload_id), duplicate: true };
  const now = Date.now(),
    r = await db()
      .prepare(
        "UPDATE transfer_uploads SET state='finalizing',lease=? WHERE id=? AND (state='uploading' OR (state='finalizing' AND lease<?)) RETURNING *",
      )
      .get(now + 180000, id, now);
  if (!r)
    throw new AppError(
      "This upload is finalizing. Refresh status; no duplicate file is created.",
      409,
    );
  let finalized = false;
  try {
    const chunks = await db()
        .prepare(
          "SELECT * FROM transfer_chunks WHERE upload_id=? ORDER BY part",
        )
        .all(id),
      parts: Buffer[] = [];
    if (chunks.length !== Math.ceil(Number(r.size) / CHUNK_SIZE))
      throw new AppError(
        "Some chunks are missing. Resume this upload before finalizing.",
        409,
      );
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      if (Number(c.part) !== i)
        throw new AppError("Chunk sequence is incomplete.", 409);
      const encrypted = c.object_name
        ? await readObject(String(c.object_name), 2 * CHUNK_SIZE)
        : Buffer.from(c.data as Uint8Array);
      const bytes = Buffer.from(
        decrypt(encrypted.toString("base64")),
        "base64",
      );
      if (bytes.length !== Number(c.size) || sha256(bytes) !== c.digest)
        throw new AppError(
          "Stored chunk integrity failed. Cancel and upload the file again.",
          409,
        );
      parts.push(bytes);
    }
    const raw = Buffer.concat(parts);
    if (raw.length !== Number(r.size) || sha256(raw) !== r.digest)
      throw new AppError(
        "The complete file checksum did not match. Cancel and upload the file again.",
        409,
      );
    const cleaned = await inspectZip(
        raw,
        await accountSecrets(String(r.owner)),
        PACKAGE_LIMIT,
      ),
      a = await projectAccess(String(r.project_id), actor, "edit"),
      p = a.project;
    const uploadId = String(r.upload_id),
      object = cloudMode() ? `${r.owner}/${r.project_id}/${uploadId}` : null;
    if (object)
      try {
        await writeObject(object, cleaned.source, "application/zip");
      } catch (e) {
        const existing = await readObject(object, PACKAGE_LIMIT).catch(
          () => null,
        );
        if (!existing || sha256(existing) !== sha256(cleaned.source)) throw e;
      }
    p.sourceId = uploadId;
    p.sourceName = String(r.name);
    p.version = `upload-sha256:${sha256(cleaned.source)}`;
    p.revival = null;
    p.buildId = "";
    p.referencedEnvNames = cleaned.envNames;
    p.updatedAt = new Date().toISOString();
    await transaction([
      {
        sql: "UPDATE usage_counters SET used=used-? WHERE owner=? AND kind='storage' AND period='all'",
        parameters: [Number(r.reserved), a.owner],
      },
      await usageStep(a.owner, "storage", cleaned.source.length),
      {
        sql: "UPDATE projects SET data=? WHERE id=? AND owner=? AND data=? RETURNING id",
        parameters: [JSON.stringify(p), p.id, a.owner, a.previousData],
        required:
          "Project changed while the upload was finalizing. Retry to attach it to the current record.",
      },
      {
        sql: "INSERT INTO uploads VALUES(?,?,?,?,?,?,?,?,?)",
        parameters: [
          uploadId,
          a.owner,
          p.id,
          String(r.name),
          "source",
          "application/zip",
          object ? null : cleaned.source,
          object,
          cleaned.source.length,
        ],
      },
      {
        sql: "UPDATE transfer_uploads SET state='completed',reserved=0,lease=0 WHERE id=? AND state='finalizing' AND lease=? RETURNING id",
        parameters: [id, now + 180000],
        required: "Upload finalization lease changed. Refresh status.",
      },
      ...(await versionSteps(JSON.parse(a.previousData), p, a.owner)),
    ]);
    finalized = true;
    await clearTransferChunks(id).catch(() => undefined);
    await record(
      a.owner,
      `Completed checksum-verified source upload for ${p.name}; ${cleaned.excluded} sensitive files excluded`,
      "upload",
      p.id,
    );
    return {
      uploadId,
      sha256: sha256(cleaned.source),
      excluded: cleaned.excluded,
      duplicate: false,
    };
  } finally {
    if (!finalized)
      await db()
        .prepare(
          "UPDATE transfer_uploads SET state='uploading',lease=0 WHERE id=? AND state='finalizing' AND lease=?",
        )
        .run(id, now + 180000);
  }
}
export async function createPackageLink(
  actor: string,
  bundleId: string,
  days: number,
) {
  const b = await bundleAccess(bundleId, actor, true);
  await verifiedBundleBytes(b);
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new AppError("Choose a link lifetime between 1 and 30 days.");
  const token = randomBytes(32).toString("hex"),
    id = randomUUID(),
    expires = Math.min(
      Date.now() + days * 86400000,
      b.expires || Number.MAX_SAFE_INTEGER,
    );
  await db()
    .prepare("INSERT INTO package_links VALUES(?,?,?,?,?,0,0,0,?)")
    .run(id, b.id, actor, hash(token), expires, new Date().toISOString());
  await record(
    b.owner,
    `Shared preserved package version ${b.id} with an expiring download link`,
    "share-package",
    b.project_id,
  );
  return { id, token, expires };
}
export async function activePackageLink(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new AppError("Download link not found.", 404);
  const l = await db()
    .prepare(
      "SELECT * FROM package_links WHERE token_hash=? AND revoked=0 AND expires>?",
    )
    .get(hash(token), Date.now());
  if (!l) throw new AppError("This package link expired or was revoked.", 404);
  // A link cannot outlive the granting Owner's current access.
  const b = await bundleAccess(String(l.bundle_id), String(l.actor), true);
  return { link: l, bundle: b };
}
export async function startPackageDownload(token: string) {
  const { link, bundle: b } = await activePackageLink(token),
    id = randomUUID();
  await db()
    .prepare("INSERT INTO package_transfers VALUES(?,?,'receiving',?,?,NULL)")
    .run(
      id,
      String(link.id),
      JSON.stringify({
        parts: [],
        bytes: b.data.bytes,
        sha256: b.data.packageSha256,
        expires: Math.min(Number(link.expires), Date.now() + 86400000),
      }),
      new Date().toISOString(),
    );
  return {
    id,
    bytes: b.data.bytes,
    sha256: b.data.packageSha256,
    chunkSize: CHUNK_SIZE,
    name: `chapter-${b.id}.zip`,
  };
}
export async function packageDownloadPart(
  token: string,
  receipt: string,
  part: number,
) {
  const { link, bundle: b } = await activePackageLink(token),
    r = await db()
      .prepare("SELECT * FROM package_transfers WHERE id=? AND link_id=?")
      .get(receipt, String(link.id));
  if (!r) throw new AppError("Transfer not found.", 404);
  const data = JSON.parse(String(r.data));
  if (data.expires <= Date.now() || r.state !== "receiving")
    throw new AppError(
      "Transfer expired or completed. Start a new download.",
      410,
    );
  if (
    !Number.isInteger(part) ||
    part < 0 ||
    part >= Math.ceil(b.data.bytes / CHUNK_SIZE)
  )
    throw new AppError("Invalid download part.");
  const stored = await db()
    .prepare("SELECT object_name,size FROM uploads WHERE id=? AND owner=?")
    .get(b.upload_id, b.owner);
  if (!stored || Number(stored.size) !== b.data.bytes)
    throw new AppError(
      "The immutable package file is missing or changed.",
      409,
    );
  const start = part * CHUNK_SIZE,
    end = Math.min(b.data.bytes, (part + 1) * CHUNK_SIZE) - 1;
  const bytes = stored.object_name
    ? await readObjectRange(String(stored.object_name), start, end)
    : Buffer.from(
        (await db()
          .prepare(
            "SELECT substr(data,?,?) AS chunk FROM uploads WHERE id=? AND owner=?",
          )
          .get(start + 1, end - start + 1, b.upload_id, b.owner))!
          .chunk as Uint8Array,
      );
  if (bytes.length !== end - start + 1)
    throw new AppError(
      "Package download was interrupted. Retry this chunk.",
      502,
    );
  const updated = {
    ...data,
    parts: [...new Set([...data.parts, part])].sort(
      (a: number, b: number) => a - b,
    ),
  };
  // The client requests chunks sequentially. CAS avoids a lost acknowledgement on repeated requests.
  const changed = await db()
    .prepare(
      "UPDATE package_transfers SET data=? WHERE id=? AND data=? RETURNING id",
    )
    .get(JSON.stringify(updated), receipt, String(r.data));
  if (!changed)
    throw new AppError("Transfer progress changed. Retry this chunk.", 409);
  return bytes;
}
export async function acknowledgePackageDownload(
  token: string,
  receipt: string,
  digest: string,
) {
  const { link, bundle: b } = await activePackageLink(token),
    r = await db()
      .prepare("SELECT * FROM package_transfers WHERE id=? AND link_id=?")
      .get(receipt, String(link.id));
  if (!r) throw new AppError("Transfer not found.", 404);
  const data = JSON.parse(String(r.data));
  if (data.expires <= Date.now())
    throw new AppError("Transfer receipt expired.", 410);
  if (
    digest !== b.data.packageSha256 ||
    data.parts.length !== Math.ceil(b.data.bytes / CHUNK_SIZE)
  )
    throw new AppError(
      "The download is incomplete or its checksum did not match. Resume the transfer.",
      409,
    );
  if (r.state === "completed") return;
  await transaction([
    {
      sql: "UPDATE package_transfers SET state='completed',finished_at=? WHERE id=? AND state='receiving' RETURNING id",
      parameters: [new Date().toISOString(), receipt],
      required: "This transfer was already acknowledged.",
    },
    {
      sql: "UPDATE package_links SET downloads=downloads+1 WHERE id=? AND revoked=0 AND expires>? RETURNING id",
      parameters: [String(link.id), Date.now()],
      required: "The package link expired or was revoked before completion.",
    },
  ]);
}
export async function expireTransfers() {
  const rows = await db()
    .prepare(
      "SELECT * FROM transfer_uploads WHERE expires<? AND state IN ('uploading','finalizing','canceled','completed','failed') AND lease<? AND (reserved>0 OR EXISTS (SELECT 1 FROM transfer_chunks WHERE upload_id=transfer_uploads.id))",
    )
    .all(Date.now(), Date.now());
  for (const r of rows) {
    try {
      await clearTransferChunks(String(r.id));
      const gone = await db()
        .prepare(
          "UPDATE transfer_uploads SET reserved=0,state=CASE WHEN state='completed' THEN 'completed' ELSE 'expired' END WHERE id=? AND reserved=? RETURNING id",
        )
        .get(String(r.id), Number(r.reserved));
      if (gone && Number(r.reserved))
        await release(String(r.owner), "storage", Number(r.reserved));
    } catch {
      /* Private staging remains inaccessible; the next worker retries cleanup. */
    }
  }
}
