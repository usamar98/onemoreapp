import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
export { redact } from "./redact";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const dataDir = process.env.CHAPTER_DATA_DIR
  ? path.resolve(/* turbopackIgnore: true */ process.env.CHAPTER_DATA_DIR)
  : path.join(process.cwd(), ".data");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
let cachedKey: Buffer | undefined;
function encryptionKey() {
  if (cachedKey) return cachedKey;
  if (process.env.CHAPTER_ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.CHAPTER_ENCRYPTION_KEY, "base64");
    if (key.length !== 32)
      throw new AppError(
        "CHAPTER_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
        503,
      );
    return (cachedKey = key);
  }
  if (process.env.VERCEL || process.env.DATABASE_URL)
    throw new AppError(
      "Set a persistent CHAPTER_ENCRYPTION_KEY before connecting accounts in cloud mode.",
      503,
    );
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "encryption.key");
  if (!existsSync(file))
    writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
  cachedKey = readFileSync(file);
  return cachedKey;
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
export function decrypt(value: string) {
  const data = Buffer.from(value, "base64"),
    cipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      data.subarray(0, 12),
    );
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    cipher.update(data.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 16384 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function passwordMatches(password: string, saved: string) {
  const [salt, digest] = saved.split(":");
  const derived = await derive(password, salt);
  const expected = Buffer.from(digest, "hex");
  return (
    expected.length === derived.length && timingSafeEqual(derived, expected)
  );
}
export function safeUrl(input: string) {
  if (!input) return "";
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("Enter a complete URL, beginning with https://.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new AppError("Use an HTTP or HTTPS URL without credentials.");
  if (
    [...url.searchParams.keys()].some((key) =>
      /token|secret|password|api.?key|auth/i.test(key),
    )
  )
    throw new AppError("Remove credentials from the URL before saving.");
  return url.href;
}
export function githubSlug(input: string) {
  const url = new URL(safeUrl(input));
  const parts = url.pathname
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  if (
    url.hostname !== "github.com" ||
    parts.length !== 2 ||
    parts.some((part) => !/^[\w.-]+$/.test(part))
  )
    throw new AppError(
      "Use a repository URL such as https://github.com/owner/project.",
    );
  return parts.join("/");
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url),
    host = request.headers.get("host");
  const allowed = [
    url.origin,
    process.env.NEXT_PUBLIC_APP_URL,
    ...(host ? [`${url.protocol}//${host}`] : []),
  ];
  if (
    (origin && !allowed.includes(origin)) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AppError(
      "This request came from a different site. Refresh Chapter and try again.",
      403,
    );
}
