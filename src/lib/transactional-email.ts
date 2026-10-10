import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "./database";
import { AppError, dataDir, decrypt } from "./security";

export function emailMode(): "resend" | "local" | "unavailable" {
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) return "resend";
  // The local outbox is never served over HTTP and is forbidden in cloud mode.
  if (
    !process.env.VERCEL &&
    !process.env.DATABASE_URL &&
    process.env.CHAPTER_EMAIL_MODE === "local"
  )
    return "local";
  return "unavailable";
}
export function emailOrigin() {
  const url = new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  );
  if (
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new AppError(
      "Configure NEXT_PUBLIC_APP_URL with the HTTPS application origin.",
      503,
    );
  return url.origin;
}
export function requireEmail() {
  if (emailMode() === "unavailable")
    throw new AppError(
      "Email delivery is not configured. The operator must set RESEND_API_KEY and EMAIL_FROM; local testing can use CHAPTER_EMAIL_MODE=local. Your account and projects remain saved.",
      503,
    );
  emailOrigin();
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export type MailContent = {
  to: string;
  subject: string;
  action: string;
  url: string;
  detail: string;
};
export function mailHtml(m: MailContent) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(m.subject)}</title></head><body style="background:#f5f7f6;color:#243831;font:16px/1.6 Arial,sans-serif;padding:24px"><main style="max-width:560px;margin:auto"><p>CHAPTER</p><h1 style="font-size:26px">${escape(m.subject)}</h1><p>${escape(m.detail)}</p><p><a href="${escape(m.url)}" style="display:inline-block;padding:14px 20px;background:#23634d;color:#f9fcfa;border-radius:8px">${escape(m.action)}</a></p><p>If you did not request this, ignore this email. Opening the link alone does not change your account.</p><p>This is a security message, not a marketing subscription.</p></main></body></html>`;
}
export async function deliverMail(id: string) {
  const now = Date.now(),
    lease = now + 60000;
  const row = await db()
    .prepare(
      "UPDATE mail_deliveries SET state='sending',attempts=attempts+1,lease=? WHERE id=? AND attempts<3 AND expires>? AND ((state='queued' AND next_run<=?) OR (state='sending' AND lease<?)) RETURNING *",
    )
    .get(lease, id, now, now, now);
  if (!row) return;
  const token = await db()
    .prepare(
      "SELECT token FROM auth_tokens WHERE token=? AND consumed=0 AND expires>?",
    )
    .get(row.token, now);
  if (!token) {
    await db()
      .prepare(
        "UPDATE mail_deliveries SET state='expired',data='',lease=0 WHERE id=? AND lease=?",
      )
      .run(id, lease);
    return;
  }
  try {
    const m = JSON.parse(decrypt(String(row.data))) as MailContent;
    requireEmail();
    if (emailMode() === "local") {
      const dir = path.join(dataDir, "mail-outbox");
      await mkdir(dir, { recursive: true });
      // Stable file name makes worker retries idempotent. This private file includes a one-time link.
      try {
        await writeFile(path.join(dir, id + ".html"), mailHtml(m), {
          mode: 0o600,
          flag: "wx",
        });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    } else {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "chapter-security/" + id,
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [m.to],
          subject: m.subject,
          html: mailHtml(m),
          text: `${m.subject}\n${m.detail}\n${m.action}: ${m.url}\nIf you did not request this, ignore this email.`,
          ...(process.env.SUPPORT_EMAIL
            ? { reply_to: process.env.SUPPORT_EMAIL }
            : {}),
        }),
      });
      if (!response.ok) {
        const error = new AppError(
          "Email provider rejected delivery. Check the sender domain and server credentials.",
          response.status >= 500 || response.status === 429 ? 503 : 422,
        );
        throw error;
      }
    }
    await db()
      .prepare(
        "UPDATE mail_deliveries SET state=?,data='',error=null,lease=0 WHERE id=? AND lease=?",
      )
      .run(emailMode() === "local" ? "local" : "sent", id, lease);
  } catch (e) {
    const terminal =
      Number(row.attempts) >= 3 || (e instanceof AppError && e.status === 422);
    await db()
      .prepare(
        "UPDATE mail_deliveries SET state=?,error=?,next_run=?,lease=0 WHERE id=? AND lease=?",
      )
      .run(
        terminal ? "failed" : "queued",
        "Email could not be sent. Review email setup and request a new link, or wait for the worker retry.",
        now + Number(row.attempts) * 15000,
        id,
        lease,
      );
  }
}
export async function deliverPendingMail() {
  const now = Date.now();
  await db().prepare("DELETE FROM review_grants WHERE expires<?").run(now);
  await db()
    .prepare("DELETE FROM auth_tokens WHERE expires<?")
    .run(now - 86400000);
  await db()
    .prepare(
      "UPDATE mail_deliveries SET state='expired',data='',lease=0 WHERE expires<? AND state IN ('queued','sending')",
    )
    .run(now);
  await db()
    .prepare(
      "UPDATE mail_deliveries SET state='failed',data='',lease=0,error='Delivery retries exhausted. Request a new link.' WHERE state='sending' AND lease<? AND attempts>=3",
    )
    .run(now);
  await db()
    .prepare("DELETE FROM mail_deliveries WHERE expires<?")
    .run(now - 7 * 86400000);
  for (const row of await db()
    .prepare(
      "SELECT id FROM mail_deliveries WHERE (state='queued' AND next_run<=?) OR (state='sending' AND lease<?) ORDER BY at LIMIT 10",
    )
    .all(now, now))
    await deliverMail(String(row.id));
  if (emailMode() === "local") {
    const dir = path.join(dataDir, "mail-outbox");
    for (const file of await readdir(dir).catch(() => [])) {
      if (!/^[a-f0-9-]+\.html$/.test(file)) continue;
      const target = path.join(dir, file);
      if ((await stat(target)).mtimeMs < now - 86400000) await unlink(target);
    }
  }
}
