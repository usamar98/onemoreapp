import { createHash } from "node:crypto";
import JSZip from "jszip";
import { z } from "zod";
import { parse, serialize, type DefaultTreeAdapterTypes } from "parse5";
import { AppError, redact } from "./security";
import {
  inspectZip,
  screenshotType,
  MAX_UPLOAD,
  boundedEntry,
} from "./uploads";
import type { Project, QuickPublishPreview } from "./types";
import { accountSecrets, db, uploadBytes, tokenFor } from "./db";

export const quickDigest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export const quickPublishSchema = z.object({
  format: z.enum(["html", "zip", "pdf", "image"]),
  name: z.string().max(240),
  assetId: z.string().min(1).max(100),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt: z.string().max(80),
  fileCount: z.number().int().min(1).max(2000),
  excluded: z.number().int().min(0).max(2000),
  warnings: z.array(z.string().max(1600)).max(20),
});
export function inspectPdf(bytes: Buffer, secrets: string[] = []) {
  if (
    !bytes.length ||
    bytes.length > 10 * 1024 * 1024 ||
    !/^%PDF-(?:1\.[0-9]|2\.0)/.test(bytes.subarray(0, 16).toString("ascii")) ||
    !bytes.subarray(-2048).toString("latin1").includes("%%EOF")
  )
    throw new AppError("Choose a complete PDF file smaller than 10 MB.");
  const text = bytes.toString("latin1");
  if (
    /\/(?:JavaScript|JS|Launch|EmbeddedFiles|RichMedia|OpenAction|AA)\b/i.test(
      text.replace(/#([\da-f]{2})/gi, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      ),
    )
  )
    throw new AppError(
      "This PDF contains active actions or embedded files. Export a plain PDF before sharing.",
    );
  if (redact(text, secrets) !== text)
    throw new AppError(
      "A possible credential was found in this PDF. Remove it and upload again.",
    );
  return "application/pdf";
}

export async function inspectQuickFile(
  name: string,
  bytes: Buffer,
  secrets: string[] = [],
) {
  if (!bytes.length || bytes.length > MAX_UPLOAD)
    throw new AppError("Choose a non-empty file smaller than 20 MB.");
  const extension = name.split(".").pop()?.toLowerCase();
  const digest = quickDigest(bytes);
  if (extension === "pdf")
    return {
      format: "pdf" as const,
      digest,
      type: inspectPdf(bytes, secrets),
      archive: null,
      warnings: [
        "Review the document for private customer information before sharing. Automated checks cannot identify every sensitive detail.",
      ],
    };
  if (["png", "jpg", "jpeg", "webp"].includes(extension || "")) {
    if (bytes.length > 5 * 1024 * 1024)
      throw new AppError("Images must be smaller than 5 MB.");
    const type = screenshotType(bytes);
    const expected =
      extension === "png"
        ? "image/png"
        : extension === "webp"
          ? "image/webp"
          : "image/jpeg";
    if (type !== expected)
      throw new AppError("The image contents do not match its filename.");
    return {
      format: "image" as const,
      digest,
      type,
      archive: null,
      warnings: [
        "Review the image for credentials and private customer information before sharing.",
      ],
    };
  }
  let source = bytes;
  if (extension === "html" || extension === "htm") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new AppError("Save your HTML as UTF-8 text, then upload again.");
    }
    if (
      text.includes("\0") ||
      !/<(?:!doctype\s+html|html|head|body|h[1-6]|div|p|main|section)\b/i.test(
        text,
      )
    )
      throw new AppError(
        "This file does not contain a recognizable HTML page.",
      );
    const zip = new JSZip();
    zip.file("index.html", bytes);
    source = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
  } else if (extension !== "zip") {
    throw new AppError(
      "Quick Publish accepts HTML, ZIP, PDF, PNG, JPEG, and WebP files.",
    );
  }
  const archive = await inspectZip(source, secrets);
  const warnings = archive.build
    ? [
        "This is a static build. Backend services, authentication, databases, and external APIs are not verified.",
      ]
    : [
        "Source files are saved, but this ZIP has no supported static build. Build or export the project and upload a dist, build, or out folder containing index.html before deploying.",
      ];
  if (archive.excluded)
    warnings.push(
      `${archive.excluded} credential, environment, or unsupported system file(s) were excluded. Configuration names are retained without values.`,
    );
  if (archive.envNames.length)
    warnings.push(
      "Configuration names were detected. Confirm which services and values the application needs before deploying.",
    );
  if (archive.build) {
    const web = await JSZip.loadAsync(archive.build);
    const html = (
      await boundedEntry(web.file("index.html")!, MAX_UPLOAD)
    ).toString("utf8");
    const missing = new Set<string>();
    for (const match of html.matchAll(
      /(?:src|href)\s*=\s*["']([^"']+)["']/gi,
    )) {
      const value = match[1].split(/[?#]/)[0];
      if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) continue;
      const local = value.replace(/^\//, "").replace(/^\.\//, "");
      if (
        /\.(?:css|js|mjs|png|jpe?g|webp|svg|ico|woff2?)$/i.test(local) &&
        !web.file(local)
      )
        missing.add(redact(local, secrets));
    }
    if (missing.size)
      warnings.push(
        `Referenced assets are missing: ${[...missing].slice(0, 8).join(", ")}. Add them to the ZIP before deployment.`,
      );
    if (/(?:src|href)\s*=\s*["'](?:https?:|\/\/)/i.test(html))
      warnings.push(
        "The page references external assets. Their availability and charges remain with those providers.",
      );
  }
  return {
    format: extension === "zip" ? ("zip" as const) : ("html" as const),
    digest,
    type: "application/zip",
    archive,
    warnings,
  };
}

// Inert layout preview only: scripts, forms, frames and external network requests are blocked.
export async function staticLayoutPreview(build: Buffer) {
  const zip = await JSZip.loadAsync(build);
  const entry = zip.file("index.html");
  if (!entry) throw new AppError("This build has no index.html.");
  const entryBytes = await boundedEntry(entry, MAX_UPLOAD);
  let html =
    entryBytes.length > 512 * 1024
      ? "<main><h1>Your page is saved.</h1><p>This HTML is larger than the 512 KB layout-preview limit. Review it locally, then use the separate Vercel deployment to check functionality.</p></main>"
      : entryBytes.toString("utf8");
  let budget = 1024 * 1024;
  const replacements = new Map<string, string>();
  for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const reference = match[1],
      path = reference.split(/[?#]/)[0].replace(/^\//, "").replace(/^\.\//, "");
    if (
      /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference) ||
      !/\.(?:css|png|jpe?g|webp|svg)$/i.test(path)
    )
      continue;
    const file = zip.file(path);
    if (!file || budget <= 0) continue;
    try {
      const bytes = await boundedEntry(file, Math.min(budget, 256 * 1024));
      budget -= bytes.length;
      const type = path.endsWith(".css")
        ? "text/css"
        : path.endsWith(".svg")
          ? "image/svg+xml"
          : screenshotType(bytes);
      replacements.set(
        reference,
        `data:${type};base64,${bytes.toString("base64")}`,
      );
    } catch {
      /* A missing/oversized asset never runs code or breaks the preview response. */
    }
  }
  html = html.replace(
    /((?:src|href)\s*=\s*)(["'])([^"']+)\2/gi,
    (all, prefix, quote, ref) =>
      replacements.has(ref)
        ? `${prefix}${quote}${replacements.get(ref)}${quote}`
        : all,
  );
  const document = parse(html);
  const pending: { node: DefaultTreeAdapterTypes.ParentNode; depth: number }[] =
    [{ node: document, depth: 0 }];
  const blockedTags = new Set([
    "script",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "base",
    "meta",
    "template",
    "animate",
    "animatemotion",
    "animatetransform",
    "set",
  ]);
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > 20000 || depth > 100) {
      return "<!doctype html><main><h1>Your page is saved.</h1><p>This page exceeds the layout-preview complexity limit. Review it locally before deployment.</p></main>";
    }
    node.childNodes = node.childNodes.filter(
      (child) =>
        !("tagName" in child) || !blockedTags.has(child.tagName.toLowerCase()),
    );
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      child.attrs = child.attrs.filter((attr) => {
        if (
          /^on/i.test(attr.name) ||
          [
            "srcdoc",
            "srcset",
            "ping",
            "action",
            "formaction",
            "target",
            "download",
            "autofocus",
          ].includes(attr.name)
        )
          return false;
        if (attr.name === "href")
          return (
            attr.value.startsWith("#") ||
            (child.tagName === "link" &&
              attr.value.startsWith("data:text/css;base64,"))
          );
        return true;
      });
      pending.push({ node: child, depth: depth + 1 });
    }
  }
  html = serialize(document);
  const csp =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' data:; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">${html}`;
}

export async function quickPreview(
  project: Project,
  owner: string,
): Promise<QuickPublishPreview> {
  const record = project.quickPublish;
  if (!record)
    throw new AppError(
      "Upload a file with Quick Publish to prepare a preview.",
      404,
    );
  if (
    ["html", "zip"].includes(record.format) &&
    record.assetId !== project.sourceId
  )
    throw new AppError(
      "The stored source version changed. Prepare a new Quick Publish upload to review it.",
      409,
    );
  const row = await db()
    .prepare("SELECT id FROM uploads WHERE id=? AND owner=? AND project_id=?")
    .get(record.assetId, owner, project.id);
  if (!row)
    throw new AppError(
      "The selected upload is unavailable. Upload it again.",
      404,
    );
  const result: QuickPublishPreview = {
    record,
    deployable: !!project.buildId && ["html", "zip"].includes(record.format),
    envNames: project.referencedEnvNames,
    vercelConnected: !!(await tokenFor(owner, "vercel")),
  };
  const secrets = await accountSecrets(owner);
  if (record.format === "pdf") {
    inspectPdf(await uploadBytes(record.assetId, owner), secrets);
    result.fileUrl = `/api/files/${record.assetId}?preview=1`;
  } else if (record.format === "image") {
    screenshotType(await uploadBytes(record.assetId, owner));
    result.fileUrl = `/api/files/${record.assetId}`;
  } else if (result.deployable) {
    const build = await inspectZip(
      await uploadBytes(project.buildId, owner),
      secrets,
    );
    result.html = await staticLayoutPreview(build.source);
  }
  return result;
}
