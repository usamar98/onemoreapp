import { randomBytes, randomUUID } from "node:crypto";
import { db, transaction } from "./database";
import { AppError, encrypt, hash, passwordHash } from "./security";
import {
  emailMode,
  emailOrigin,
  requireEmail,
  type MailContent,
} from "./transactional-email";
export type TokenPurpose = "reset" | "verify" | "review";
export async function issueEmailToken(
  userId: string | null,
  email: string,
  purpose: TokenPurpose,
  scope: string,
) {
  requireEmail();
  const token = randomBytes(32).toString("hex"),
    id = randomUUID(),
    now = Date.now();
  const minutes = purpose === "verify" ? 1440 : purpose === "reset" ? 30 : 20;
  const url = `${emailOrigin()}${purpose === "review" ? `/review/${scope}` : purpose === "reset" ? "/reset-password" : "/verify-email"}#token=${token}`;
  const subject =
    purpose === "reset"
      ? "Reset your Chapter password"
      : purpose === "verify"
        ? "Verify your Chapter email"
        : "Access your Chapter client preview";
  const content: MailContent = {
    to: email,
    subject,
    action:
      purpose === "reset"
        ? "Choose a new password"
        : purpose === "verify"
          ? "Verify email"
          : "Open client preview",
    url,
    detail: `This one-time link expires in ${minutes === 1440 ? "24 hours" : minutes + " minutes"}. ${purpose === "reset" ? "After you confirm a new password, all existing sessions will be signed out." : "Confirm the action on the page to continue."}`,
  };
  await transaction([
    {
      sql: "UPDATE auth_tokens SET consumed=1 WHERE purpose=? AND scope=? AND email=? AND consumed=0",
      parameters: [purpose, scope, email],
    },
    {
      sql: "INSERT INTO auth_tokens VALUES(?,?,?,?,?,?,?,?)",
      parameters: [
        hash(token),
        userId,
        email,
        purpose,
        scope,
        now + minutes * 60000,
        0,
        new Date(now).toISOString(),
      ],
    },
    {
      sql: "INSERT INTO mail_deliveries VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      parameters: [
        id,
        hash(token),
        userId,
        encrypt(JSON.stringify(content)),
        "queued",
        0,
        now,
        0,
        now + minutes * 60000,
        null,
        new Date(now).toISOString(),
      ],
    },
  ]);
  return id;
}
export async function validEmailToken(
  token: string,
  purpose: TokenPurpose,
  scope?: string,
) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new AppError(
      "This link is invalid or expired. Request a new one.",
      410,
    );
  const row = await db()
    .prepare(
      "SELECT * FROM auth_tokens WHERE token=? AND purpose=? AND consumed=0 AND expires>?",
    )
    .get(hash(token), purpose, Date.now());
  if (!row || (scope !== undefined && row.scope !== scope))
    throw new AppError(
      "This link is invalid, already used, or expired. Request a new one.",
      410,
    );
  return row;
}
export async function resetPassword(token: string, password: string) {
  if (password.length < 10 || password.length > 128)
    throw new AppError("Use a password between 10 and 128 characters.");
  const row = await validEmailToken(token, "reset");
  const digest = await passwordHash(password);
  await transaction([
    {
      sql: "UPDATE auth_tokens SET consumed=1 WHERE token=? AND consumed=0 AND expires>? RETURNING token",
      parameters: [hash(token), Date.now()],
      required: "This link was already used or expired. Request a new one.",
    },
    {
      sql: "UPDATE users SET password=? WHERE id=? AND email=? RETURNING id",
      parameters: [digest, row.user_id, row.email],
      required: "The account changed. Request a new reset link.",
    },
    { sql: "DELETE FROM sessions WHERE user_id=?", parameters: [row.user_id] },
    {
      sql: "UPDATE auth_tokens SET consumed=1 WHERE user_id=? AND purpose='reset'",
      parameters: [row.user_id],
    },
  ]);
}
export async function verifyEmail(token: string) {
  const row = await validEmailToken(token, "verify");
  await transaction([
    {
      sql: "UPDATE auth_tokens SET consumed=1 WHERE token=? AND consumed=0 AND expires>? RETURNING token",
      parameters: [hash(token), Date.now()],
      required: "This verification link was already used or expired.",
    },
    {
      sql: "INSERT INTO account_verifications(user_id,email,verified_at) SELECT id,email,? FROM users WHERE id=? AND email=? ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at RETURNING user_id",
      parameters: [new Date().toISOString(), row.user_id, row.email],
      required: "The account email changed. Request a new verification link.",
    },
  ]);
}
export async function accountSecurity(userId: string) {
  const verified = await db()
    .prepare(
      "SELECT v.verified_at FROM account_verifications v JOIN users u ON u.id=v.user_id AND u.email=v.email WHERE v.user_id=?",
    )
    .get(userId);
  const last = await db()
    .prepare(
      "SELECT state,error,at FROM mail_deliveries WHERE user_id=? ORDER BY at DESC LIMIT 1",
    )
    .get(userId);
  return {
    verifiedAt: verified?.verified_at || null,
    emailMode: emailMode(),
    lastEmail: last || null,
  };
}
