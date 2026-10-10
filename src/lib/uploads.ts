import JSZip from "jszip";
import { Readable } from "node:stream";
import { AppError, redact } from "./security";
import { referencedEnvNames } from "./env-names";
export const MAX_UPLOAD = 20 * 1024 * 1024;
const forbidden =
  /(^|\/)(\.env(?:\.[^/]*)?|\.git|node_modules|\.next|\.aws|\.ssh|\.npmrc|\.netrc|credentials[^/]*|secrets?[^/]*|id_rsa|id_ed25519)(\/|$)|\.(pem|key|p12|pfx)$/i;
const textFiles =
  /\.(?:js|mjs|cjs|ts|tsx|jsx|vue|svelte|json|html?|css|md|txt|yaml|yml|toml|ini|config|properties|xml|svg|csv|sh|py|rb|go|rs|sql|php[0-9]?|phtml|asp|aspx|jsp|map)$/i;
export function boundedEntry(
  entry: JSZip.JSZipObject,
  maximum: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = entry.nodeStream("nodebuffer") as Readable,
      parts: Buffer[] = [];
    let size = 0,
      stopped = false;
    stream.on("data", (chunk: Buffer) => {
      if (stopped) return;
      size += chunk.length;
      if (size > maximum) {
        stopped = true;
        stream.pause();
        stream.destroy();
        reject(
          new AppError(
            "The expanded ZIP is too large (50 MB total / 20 MB per file maximum).",
          ),
        );
        return;
      }
      parts.push(chunk);
    });
    stream.on("error", () => {
      if (!stopped) {
        stopped = true;
        reject(new AppError("The ZIP contains an unreadable or damaged file."));
      }
    });
    stream.on("end", () => {
      if (!stopped) resolve(Buffer.concat(parts));
    });
    stream.resume();
  });
}
export async function inspectZip(
  data: Buffer,
  secrets: string[] = [],
  maximum = MAX_UPLOAD,
) {
  const expandedLimit =
    maximum === MAX_UPLOAD
      ? 50 * 1024 * 1024
      : Math.min(maximum * 3, 200 * 1024 * 1024);
  if (data.length > maximum)
    throw new AppError(
      `ZIP files must be smaller than ${Math.round(maximum / 1024 ** 2)} MB.`,
    );
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new AppError("This file is not a valid ZIP archive.");
  }
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (!entries.length || entries.length > 2000)
    throw new AppError("Use a ZIP containing 1 to 2,000 files.");
  const rawNames = entries.map((f) => f.name),
    first = rawNames[0].split("/")[0];
  const strip = rawNames.every((n) => n.startsWith(`${first}/`))
    ? `${first}/`
    : "";
  const cleaned = new JSZip();
  let bytes = 0,
    excluded = 0;
  const names: string[] = [];
  const environmentNames = new Set<string>();
  for (const entry of entries) {
    const unsafe =
      (entry as unknown as { unsafeOriginalName?: string })
        .unsafeOriginalName || entry.name;
    if (
      unsafe.split(/[\\/]/).includes("..") ||
      unsafe.startsWith("/") ||
      /^[A-Za-z]:/.test(unsafe)
    )
      throw new AppError("The ZIP contains an unsafe file path.");
    if (/[\u0000-\u001f\\:<>|?*]/.test(unsafe))
      throw new AppError("The ZIP contains a non-portable or unsafe filename.");
    const name = entry.name.slice(strip.length);
    if (/(^|\/)\.env\.(?:example|sample|template)$/i.test(name)) {
      const template = await boundedEntry(
        entry,
        Math.min(64 * 1024, expandedLimit - bytes),
      );
      bytes += template.length;
      for (const match of template
        .toString("utf8")
        .matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{1,79})\s*=/gm))
        environmentNames.add(match[1]);
      excluded++;
      continue; // Keep names only, never template values or contents.
    }
    if (forbidden.test(name) || name.startsWith("__MACOSX/")) {
      excluded++;
      continue;
    }
    const declared =
      (entry as unknown as { _data?: { uncompressedSize: number } })._data
        ?.uncompressedSize || 0;
    if (declared > MAX_UPLOAD || bytes + declared > expandedLimit)
      throw new AppError(
        `The expanded ZIP exceeds ${Math.round(expandedLimit / 1024 ** 2)} MB or a file exceeds 20 MB.`,
      );
    const buffer = await boundedEntry(
      entry,
      Math.min(MAX_UPLOAD, expandedLimit - bytes),
    );
    bytes += buffer.length;
    if (bytes > expandedLimit)
      throw new AppError("The expanded ZIP is too large.");
    if (
      textFiles.test(name) &&
      redact(buffer.toString("utf8"), secrets) !== buffer.toString("utf8")
    )
      throw new AppError(
        `A possible secret was found in ${name}. Remove it and upload again.`,
      );
    if (textFiles.test(name))
      for (const key of referencedEnvNames(buffer.toString("utf8")))
        environmentNames.add(key);
    cleaned.file(name, buffer);
    names.push(name);
  }
  if (!names.length)
    throw new AppError(
      "The ZIP has no usable files after excluding sensitive files.",
    );
  // A source tree containing package.json is never automatically published, even if it has index.html.
  const outputRoot = ["dist/", "build/", "out/", "public/"].find((prefix) =>
    names.includes(`${prefix}index.html`),
  );
  const buildPrefix =
    outputRoot ||
    (!names.includes("package.json") && names.includes("index.html")
      ? ""
      : null);
  let build: Buffer | null = null;
  if (buildPrefix !== null) {
    const staticZip = new JSZip();
    for (const name of names.filter(
      (n) =>
        n.startsWith(buildPrefix) &&
        !/\.(?:map|ts|tsx|jsx|vue|svelte|py|rb|go|rs|sql|php[0-9]?|phtml|asp|aspx|jsp)$/i.test(
          n,
        ),
    ))
      staticZip.file(
        name.slice(buildPrefix.length),
        await cleaned.file(name)!.async("nodebuffer"),
      );
    build = await staticZip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
  }
  return {
    source: await cleaned.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    }),
    build,
    excluded,
    count: names.length,
    envNames: [...environmentNames].sort().slice(0, 100),
  };
}
export function screenshotType(data: Buffer) {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  if (
    data.subarray(0, 4).toString() === "RIFF" &&
    data.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  throw new AppError("Screenshots must be PNG, JPEG, or WebP images.");
}
