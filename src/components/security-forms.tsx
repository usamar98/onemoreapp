"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand, Button, Field, Notice, api } from "./ui";
function usePrivateToken() {
  const [token, setToken] = useState("");
  useEffect(() => {
    const consume = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get(
        "token",
      );
      if (value) {
        setToken(value);
        window.history.replaceState(null, "", window.location.pathname);
      }
    };
    consume();
    window.addEventListener("hashchange", consume);
    return () => window.removeEventListener("hashchange", consume);
  }, []);
  return token;
}
export function SecurityForm({
  mode,
}: {
  mode: "forgot" | "reset" | "verify";
}) {
  const token = usePrivateToken(),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const title =
    mode === "forgot"
      ? "Find your way back."
      : mode === "reset"
        ? "Choose a new password."
        : "Verify your email.";
  return (
    <div className="security-page">
      <header>
        <Link href="/">
          <Brand />
        </Link>
      </header>
      <main id="main-content" className="security-form launch-stack">
        <span className="eyebrow">YOUR CHAPTER ACCOUNT</span>
        <h1>{title}</h1>
        <p>
          {mode === "forgot"
            ? "We’ll send a one-time link to the email you registered with."
            : mode === "reset"
              ? "Confirm your new password below. This signs out existing sessions."
              : "Confirm this address so you can receive account security messages."}
        </p>
        <Notice kind="error">{error}</Notice>
        <Notice kind="success">{message}</Notice>
        {!message && (
          <form
            className="launch-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                if (mode === "reset" && password !== confirm)
                  throw new Error("The new passwords do not match.");
                const result = await api<{ message: string }>(
                  `auth/${mode === "forgot" ? "forgot-password" : mode === "reset" ? "reset-password" : "verify-email"}`,
                  "POST",
                  mode === "forgot"
                    ? { email }
                    : mode === "reset"
                      ? { token, password }
                      : { token },
                );
                setMessage(result.message);
                setPassword("");
                setConfirm("");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode === "forgot" ? (
              <Field label="Registered email address">
                <input
                  required
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            ) : mode === "reset" ? (
              <>
                <Field label="New password">
                  <input
                    required
                    type="password"
                    minLength={10}
                    maxLength={128}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Field label="Confirm new password">
                  <input
                    required
                    type="password"
                    minLength={10}
                    maxLength={128}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            {mode !== "forgot" && !token && (
              <Notice>
                Open the complete one-time link from your email. If it expired,
                request a new link.
              </Notice>
            )}
            <Button
              type="submit"
              className="primary"
              busy={busy}
              disabled={mode !== "forgot" && !token}
            >
              {mode === "forgot"
                ? "Send reset link"
                : mode === "reset"
                  ? "Save new password"
                  : "Confirm email address"}
            </Button>
          </form>
        )}
        <div className="button-row">
          <Link className="button" href="/login">
            Back to sign in
          </Link>
          {mode === "reset" && (
            <Link className="button" href="/forgot-password">
              Request another reset link
            </Link>
          )}
          {mode === "verify" && (
            <Link className="button" href="/dashboard">
              Open account settings
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
export function ClientPreviewGate({
  id,
  mode,
}: {
  id: string;
  mode: "password" | "email";
}) {
  const router = useRouter(),
    token = usePrivateToken(),
    [password, setPassword] = useState(""),
    [email, setEmail] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="security-form launch-stack">
      <span className="eyebrow">PRIVATE CLIENT PREVIEW</span>
      <h1>A little privacy before the preview.</h1>
      <p>
        {mode === "password"
          ? "Enter the password shared by the project owner."
          : "Only invited email addresses can open this captured version."}
      </p>
      <Notice kind="error">{error}</Notice>
      <Notice kind="success">{message}</Notice>
      <form
        className="launch-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setMessage("");
          try {
            if (mode === "email" && !token) {
              const r = await api<{ message: string }>(
                `reviews/${id}/request-access`,
                "POST",
                { email },
              );
              setMessage(r.message);
            } else {
              await api(
                `reviews/${id}/unlock`,
                "POST",
                mode === "password" ? { password } : { token },
              );
              setPassword("");
              router.refresh();
            }
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {mode === "password" ? (
          <Field label="Preview password">
            <input
              type="password"
              required
              maxLength={128}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        ) : !token ? (
          <Field label="Invited email address">
            <input
              type="email"
              required
              autoComplete="email"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        ) : (
          <Notice>
            Confirm this one-time access link to open the preview. Access lasts
            up to 24 hours, or until the owner revokes or expires the link.
          </Notice>
        )}
        <Button className="primary" type="submit" busy={busy}>
          {mode === "email" && !token
            ? "Send access link"
            : "Open client preview"}
        </Button>
      </form>
      <small>
        Viewing a preview never grants access to the owner’s workspace.
        Downloads and feedback need separate permission.
      </small>
    </section>
  );
}
type SecurityStatus = {
  verifiedAt: string | null;
  emailMode: "resend" | "local" | "unavailable";
  lastEmail: { state: string; error: string | null; at: string } | null;
};
export function AccountSecurity() {
  const [data, setData] = useState<SecurityStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    api<SecurityStatus>("auth/security")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section
      className="launch-stack account-security"
      aria-label="Account security"
    >
      <h3>Account security</h3>
      <Notice kind="error">{error}</Notice>
      <Notice kind="success">{message}</Notice>
      {!data && !error ? (
        <p role="status">Loading security settings…</p>
      ) : data ? (
        <>
          <p>
            Email:{" "}
            <strong>{data.verifiedAt ? "Verified" : "Not verified yet"}</strong>
          </p>
          {data.emailMode === "unavailable" ? (
            <Notice>
              Email delivery needs setup. Configure RESEND_API_KEY and
              EMAIL_FROM on the server. For local testing, use
              CHAPTER_EMAIL_MODE=local and the private .data/mail-outbox folder.
            </Notice>
          ) : data.emailMode === "local" ? (
            <Notice>
              Local testing mode: email previews are saved privately in
              .data/mail-outbox. No email is sent to an inbox.
            </Notice>
          ) : null}
          {data.lastEmail ? (
            <small>
              Last security email:{" "}
              {data.lastEmail.state === "local"
                ? "Saved to local outbox"
                : data.lastEmail.state}{" "}
              · {new Date(data.lastEmail.at).toLocaleString()}
              {data.lastEmail.error ? ". " + data.lastEmail.error : ""}
            </small>
          ) : null}
          {!data.verifiedAt && (
            <Button
              busy={busy}
              disabled={data.emailMode === "unavailable"}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const r = await api<{ message: string }>(
                    "auth/resend-verification",
                    "POST",
                    {},
                  );
                  setMessage(r.message);
                  setData(await api("auth/security"));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send verification link
            </Button>
          )}
          <Link href="/forgot-password" className="button">
            Reset your password
          </Link>
        </>
      ) : (
        <Button
          onClick={async () => {
            setError("");
            try {
              setData(await api("auth/security"));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Retry security settings
        </Button>
      )}
    </section>
  );
}
