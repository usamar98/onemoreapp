import { createClient } from "@supabase/supabase-js";
import { AppError } from "./security";
let client: ReturnType<typeof createClient> | undefined;
export function privateStorage() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
    throw new AppError(
      "Private file storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY using the Vercel setup instructions.",
      503,
    );
  client ||= createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return client.storage.from("chapter-files");
}
export async function writeObject(
  objectName: string,
  data: Buffer,
  contentType: string,
) {
  const { error } = await privateStorage().upload(objectName, data, {
    contentType,
    upsert: false,
  });
  if (error)
    throw new AppError(
      "Could not save this file in private cloud storage. Check the chapter-files bucket and try again.",
      503,
    );
}
export async function readObject(
  objectName: string,
  maximum = 20 * 1024 * 1024,
) {
  // Read a bounded stream: untrusted staging uploads must never be fully buffered before checking their size.
  const { data, error } = await privateStorage().createSignedUrl(
    objectName,
    60,
  );
  if (error || !data)
    throw new AppError("The cloud file is unavailable. Upload it again.", 404);
  const response = await fetch(data.signedUrl, {
    signal: AbortSignal.timeout(45000),
    cache: "no-store",
  });
  if (!response.ok || !response.body)
    throw new AppError("Could not read the cloud file. Please try again.", 502);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new AppError("The uploaded file exceeds its size limit.");
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}
export async function objectUrl(objectName: string, download?: string) {
  const { data, error } = await privateStorage().createSignedUrl(
    objectName,
    60,
    download ? { download } : {},
  );
  if (error || !data)
    throw new AppError("Could not open this file. Please try again.", 503);
  return data.signedUrl;
}
export async function removeObject(objectName: string) {
  const { error } = await privateStorage().remove([objectName]);
  if (error)
    throw new AppError(
      "Could not clear the temporary upload. Please try again.",
      503,
    );
}
export async function readObjectRange(
  objectName: string,
  start: number,
  end: number,
) {
  const { data, error } = await privateStorage().createSignedUrl(
    objectName,
    60,
  );
  if (error || !data) throw new AppError("Package file is unavailable.", 404);
  const response = await fetch(data.signedUrl, {
    headers: { Range: `bytes=${start}-${end}` },
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  if (response.status !== 206 || !response.body)
    throw new AppError(
      "Private storage did not support a bounded package download. Check Storage range support and retry.",
      502,
    );
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((size += value.length) > end - start + 1) {
      await reader.cancel();
      throw new AppError("The package range exceeded its expected size.", 409);
    }
    parts.push(value);
  }
  if (size !== end - start + 1)
    throw new AppError(
      "The package range was interrupted. Retry this part.",
      502,
    );
  return Buffer.concat(parts);
}
