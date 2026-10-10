import { NextResponse, after } from "next/server";
import { z } from "zod";
import { db, requireUser, rateLimit } from "./db";
import {
  accountSecurity,
  issueEmailToken,
  resetPassword,
  verifyEmail,
} from "./account-security";
import { deliverMail, requireEmail } from "./transactional-email";
import { AppError, hash } from "./security";
const json = (v: unknown) =>
  NextResponse.json(v, {
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
export async function accountSecurityRoute(request: Request, parts: string[]) {
  const [section, action] = parts;
  if (
    section !== "auth" ||
    ![
      "security",
      "forgot-password",
      "reset-password",
      "verify-email",
      "resend-verification",
    ].includes(action)
  )
    return null;
  if (action === "security" && request.method === "GET")
    return json(await accountSecurity((await requireUser()).id));
  if (request.method !== "POST") throw new AppError("Method not allowed.", 405);
  await rateLimit(
    `security-ip:${hash(request.headers.get("x-forwarded-for")?.split(",")[0] || "local")}`,
    30,
    3600000,
  );
  const raw = await request.text();
  if (raw.length > 3000) throw new AppError("This form is too large.", 413);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new AppError("Invalid form.");
  }
  if (action === "forgot-password") {
    requireEmail();
    const email = z.email().max(254).parse(input.email).toLowerCase();
    await rateLimit(`reset-email:${hash(email)}`, 3, 3600000);
    const user = await db()
      .prepare("SELECT id FROM users WHERE email=? AND demo=0")
      .get(email);
    if (user) {
      const id = await issueEmailToken(
        String(user.id),
        email,
        "reset",
        String(user.id),
      );
      after(() => deliverMail(id));
    }
    return json({
      message:
        "If an eligible account uses this email, a password reset link has been queued. Check your inbox and spam folder.",
    });
  }
  if (action === "reset-password") {
    const data = z
      .object({
        token: z.string().max(64),
        password: z.string().min(10).max(128),
      })
      .parse(input);
    await resetPassword(data.token, data.password);
    return json({
      message:
        "Password changed. All previous sessions are signed out. Sign in with your new password.",
    });
  }
  if (action === "verify-email") {
    await verifyEmail(z.string().max(64).parse(input.token));
    return json({ message: "Your email address is verified." });
  }
  const user = await requireUser();
  if (user.demo)
    throw new AppError("Create a personal account before verifying an email.");
  if ((await accountSecurity(user.id)).verifiedAt)
    return json({ message: "Your email is already verified." });
  requireEmail();
  await rateLimit(`verify-user:${user.id}`, 3, 3600000);
  const id = await issueEmailToken(user.id, user.email, "verify", user.id);
  after(() => deliverMail(id));
  return json({
    message: "Verification link queued. Check your inbox and spam folder.",
  });
}
