import { NextResponse, after } from "next/server";
import { z } from "zod";
import { db, cloudMode } from "./database";
import { requireUser, getProjects, rateLimit, record } from "./db";
import { objectUrl } from "./storage";
import { projectAccess, workspaceRole } from "./access";
import { AppError, hash } from "./security";
import { billingState, usage } from "./billing";
import {
  preparePreservation,
  createPreservation,
  bundleAccess,
  verifiedBundleBytes,
  removeBundle,
  PACKAGE_LIMIT,
  sha256,
} from "./preservation";
import { sandboxAvailable } from "./revival";
import { newBundleCheck } from "./bundle-build";
import {
  recreationPreview,
  beginRecreation,
  configureRecreation,
  recreationAccess,
} from "./recreation";
import { enqueue, runJob } from "./jobs";
import {
  dependencyMap,
  addService,
  removeService,
  importHostingDependencies,
} from "./dependencies";
import {
  startTransferUpload,
  transferUploadStatus,
  putTransferChunk,
  finishTransferUpload,
  cancelTransferUpload,
  createPackageLink,
  activePackageLink,
  startPackageDownload,
  packageDownloadPart,
  acknowledgePackageDownload,
  CHUNK_SIZE,
} from "./file-transfers";
const json = (v: unknown) =>
  NextResponse.json(v, {
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
async function bounded(request: Request, maximum: number) {
  if (Number(request.headers.get("content-length") || 0) > maximum)
    throw new AppError("Request exceeds its size limit.", 413);
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((size += value.length) > maximum) {
      await reader.cancel();
      throw new AppError("Request exceeds its size limit.", 413);
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}
async function body(request: Request) {
  try {
    return JSON.parse((await bounded(request, 250000)).toString("utf8"));
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("Invalid form data. Refresh and retry.");
  }
}
function file(bytes: Buffer, name: string, type = "application/zip") {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
export async function phaseSixRoute(request: Request, parts: string[]) {
  const [section, id, action, part] = parts,
    method = request.method;
  if (
    ![
      "preservation",
      "bundles",
      "recreations",
      "transfers",
      "packages",
      "dependencies",
    ].includes(section)
  )
    return null;
  if (section === "packages") {
    await rateLimit(
      `package:${hash(request.headers.get("x-forwarded-for")?.split(",")[0] || "local")}`,
      600,
      3600000,
    );
    const { link, bundle: b } = await activePackageLink(id);
    if (method === "GET" && !action) {
      await db()
        .prepare("UPDATE package_links SET visits=visits+1 WHERE id=?")
        .run(String(link.id));
      return json({
        name: b.data.projectName,
        version: b.id,
        at: b.at,
        expires: link.expires,
        bytes: b.data.bytes,
        sha256: b.data.packageSha256,
        fileCount: b.data.files.length,
        limitation: b.data.limitation,
      });
    }
    if (method === "POST" && action === "start")
      return json(await startPackageDownload(id));
    if (method === "GET" && action === "chunk") {
      const url = new URL(request.url),
        bytes = await packageDownloadPart(
          id,
          url.searchParams.get("receipt") || "",
          Number(url.searchParams.get("part")),
        );
      const response = file(bytes, "package-part", "application/octet-stream");
      response.headers.set("X-Chunk-SHA256", sha256(bytes));
      return response;
    }
    if (method === "POST" && action === "complete") {
      const input = z
        .object({
          receipt: z.string().max(100),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(await body(request));
      await acknowledgePackageDownload(id, input.receipt, input.sha256);
      return json({
        completed: true,
        detail:
          "Complete package received and checksum confirmed by the browser. This does not prove that a file was saved to disk.",
      });
    }
    throw new AppError("Package action not found.", 404);
  }
  const actor = (await requireUser()).id,
    owner = request.headers.get("x-chapter-workspace") || actor;
  await workspaceRole(owner, actor);
  if (section === "preservation") {
    if (method !== "GET") throw new AppError("Method not allowed.", 405);
    return json({
      projects: (await getProjects(actor)).filter(
        (p) => p.workspaceOwner === owner,
      ),
      sandbox: sandboxAvailable(),
      limits: {
        packageBytes: PACKAGE_LIMIT,
        chunkBytes: CHUNK_SIZE,
        stagingHours: 24,
      },
      storage: { ...(await billingState(owner)), usage: await usage(owner) },
      at: new Date().toISOString(),
    });
  }
  if (section === "dependencies") {
    if (!id && method === "GET") return json(await dependencyMap(actor, owner));
    if (id === "import" && method === "POST")
      return json(await importHostingDependencies(actor, owner));
    if (!id && method === "POST")
      return json({ id: await addService(actor, owner, await body(request)) });
    if (id && method === "DELETE") {
      await removeService(actor, id);
      return json({ removed: true });
    }
    throw new AppError("Dependency action not found.", 404);
  }
  if (section === "transfers") {
    if (!id && method === "POST") {
      const input = z
        .object({
          projectId: z.string().max(100),
          name: z.string(),
          size: z.number(),
          digest: z.string(),
        })
        .parse(await body(request));
      await rateLimit("transfer-start:" + actor, 20, 3600000);
      return json(await startTransferUpload(actor, input.projectId, input));
    }
    if (id && !action && method === "GET")
      return json(await transferUploadStatus(actor, id));
    if (id && !action && method === "DELETE") {
      await cancelTransferUpload(actor, id);
      return json({ canceled: true });
    }
    if (id && action === "chunk" && method === "PUT") {
      await putTransferChunk(
        actor,
        id,
        Number(part),
        await bounded(request, CHUNK_SIZE),
        request.headers.get("x-chunk-sha256") || "",
      );
      return json({ saved: true });
    }
    if (id && action === "complete" && method === "POST")
      return json(await finishTransferUpload(actor, id));
    throw new AppError("Upload action not found.", 404);
  }
  if (section === "bundles") {
    if (action === "preview" && method === "POST")
      return json(
        (await preparePreservation(actor, id, await body(request))).preview,
      );
    if (action === "create" && method === "POST") {
      const input = z
        .object({
          options: z.unknown(),
          digest: z.string().regex(/^[a-f0-9]{64}$/),
          reviewed: z.literal(true),
        })
        .parse(await body(request));
      return json({
        bundle: await createPreservation(
          actor,
          id,
          input.options,
          input.digest,
        ),
      });
    }
    if (!action && method === "GET") {
      await projectAccess(id, actor);
      const rows = await db()
          .prepare(
            "SELECT id FROM preservation_bundles WHERE project_id=? AND deleted=0 AND (expires=0 OR expires>?) ORDER BY at DESC",
          )
          .all(id, Date.now()),
        bundles = [];
      for (const r of rows)
        bundles.push(await bundleAccess(String(r.id), actor));
      return json({ bundles });
    }
    const b = await bundleAccess(
      id,
      actor,
      ["share", "retention"].includes(action) || method === "DELETE",
    );
    if (action === "download" && method === "GET") {
      const bytes = await verifiedBundleBytes(b),
        name = `chapter-preservation-${b.id}.zip`;
      if (cloudMode()) {
        const stored = await db()
          .prepare("SELECT object_name FROM uploads WHERE id=? AND owner=?")
          .get(b.upload_id, b.owner);
        if (!stored?.object_name)
          throw new AppError("Private package file is unavailable.", 404);
        const response = NextResponse.redirect(
          await objectUrl(String(stored.object_name), name),
        );
        response.headers.set("Cache-Control", "private, no-store");
        response.headers.set("Referrer-Policy", "no-referrer");
        return response;
      }
      return file(bytes, name);
    }
    if (!action && method === "DELETE") {
      await removeBundle(actor, id);
      return json({ removed: true });
    }
    if (action === "retention" && method === "POST") {
      const input = z
        .object({ days: z.number().int().min(0).max(3650) })
        .parse(await body(request));
      const expires = input.days ? Date.now() + input.days * 86400000 : 0;
      await db()
        .prepare("UPDATE preservation_bundles SET expires=? WHERE id=?")
        .run(expires, id);
      await record(
        b.owner,
        `Updated package ${id} retention: ${input.days ? input.days + " days" : "until owner removes it"}`,
        "preserve",
        b.project_id,
      );
      return json({ expires });
    }
    if (action === "checks" && method === "GET")
      return json({
        checks: (
          await db()
            .prepare(
              "SELECT * FROM bundle_checks WHERE bundle_id=? ORDER BY at DESC",
            )
            .all(id)
        ).map((r) => ({ ...r, data: JSON.parse(String(r.data)) })),
      });
    if (action === "verify" && method === "POST") {
      await rateLimit("bundle-build:" + actor, 6, 3600000);
      const check = await newBundleCheck(actor, id);
      let jobId = (check.data as { jobId?: string }).jobId;
      if (!jobId) {
        jobId = await enqueue(
          actor,
          check.owner,
          "bundle-build",
          {
            projectId: check.projectId,
            bundleId: id,
            checkId: check.id,
          },
          `bundle-build:${check.id}`,
        );
        await db()
          .prepare(
            "UPDATE bundle_checks SET data=? WHERE id=? AND state='queued'",
          )
          .run(JSON.stringify({ jobId }), check.id);
      }
      after(() => runJob(jobId!));
      return json({ checkId: check.id, jobId });
    }
    if (action === "share" && method === "POST") {
      const input = z
        .object({
          days: z.number().int().min(1).max(30),
          reviewed: z.literal(true),
        })
        .parse(await body(request));
      return json(await createPackageLink(actor, id, input.days));
    }
    if (action === "links" && method === "GET") {
      await projectAccess(b.project_id, actor, "control");
      return json({
        links: await db()
          .prepare(
            "SELECT id,expires,revoked,downloads,visits,at FROM package_links WHERE bundle_id=? ORDER BY at DESC",
          )
          .all(id),
        definition:
          "Completed transfers count only when all chunks were requested and the browser acknowledged the package SHA-256. Page visits are separate.",
      });
    }
    if (action === "recreate-preview" && method === "POST") {
      const input = z
        .object({ name: z.string().trim().min(1).max(80) })
        .parse(await body(request));
      return json(await recreationPreview(actor, id, input.name));
    }
    if (action === "recreate" && method === "POST") {
      const input = z
          .object({
            name: z.string().trim().min(1).max(80),
            expires: z.number(),
            confirmation: z.string().max(100),
            reviewed: z.literal(true),
          })
          .parse(await body(request)),
        r = await beginRecreation(actor, id, input);
      let jobId = r.recreation.data.jobId;
      if (!jobId) {
        jobId = await enqueue(actor, r.bundle.owner, "recreation", {
          projectId: r.bundle.project_id,
          recreationId: r.recreation.id,
        });
        r.recreation.data.jobId = jobId;
        await db()
          .prepare("UPDATE project_recreations SET data=? WHERE id=?")
          .run(JSON.stringify(r.recreation.data), r.recreation.id);
      }
      after(() => runJob(jobId!));
      return json({ recreation: r.recreation, jobId });
    }
    if (action === "recreations" && method === "GET") {
      await projectAccess(b.project_id, actor, "control");
      return json({
        recreations: (
          await db()
            .prepare(
              "SELECT * FROM project_recreations WHERE bundle_id=? ORDER BY at DESC",
            )
            .all(id)
        ).map((r) => ({ ...r, data: JSON.parse(String(r.data)) })),
      });
    }
    throw new AppError("Bundle action not found.", 404);
  }
  if (section === "recreations") {
    if (action === "revoke-link" && method === "POST") {
      const row = await db()
        .prepare("SELECT bundle_id FROM package_links WHERE id=?")
        .get(id);
      if (!row) throw new AppError("Link not found.", 404);
      const b = await bundleAccess(String(row.bundle_id), actor, true);
      await db()
        .prepare("UPDATE package_links SET revoked=1 WHERE id=?")
        .run(id);
      await record(
        b.owner,
        "Revoked a preserved package download link",
        "share-package",
        b.project_id,
      );
      return json({ revoked: true });
    }
    const { recreation: r, bundle: b } = await recreationAccess(id, actor);
    if (!action && method === "GET") return json({ recreation: r });
    if (action === "configuration" && method === "POST") {
      const input = z
        .object({
          values: z.record(
            z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
            z.string().max(16000),
          ),
          reviewed: z.literal(true),
        })
        .parse(await body(request));
      await configureRecreation(actor, id, input.values, input.reviewed);
    } else if (!(action === "check" && method === "POST"))
      throw new AppError("Recreation action not found.", 404);
    const jobId = await enqueue(actor, b.owner, "recreation", {
      projectId: b.project_id,
      recreationId: id,
    });
    after(() => runJob(jobId));
    return json({ jobId });
  }
  return null;
}
