"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  LockKeyhole,
  Layers,
  Sprout,
  Pause,
  Play,
  Github,
} from "lucide-react";
import { Brand, Button, Field, Notice, api } from "./ui";
export function AuthForm({
  mode,
  returnTo = "/dashboard",
}: {
  mode: "login" | "register";
  returnTo?: string;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await api(`auth/${mode}`, "POST", Object.fromEntries(form.entries()));
      router.push(returnTo);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Link href="/" className="brand-link">
          <Brand />
        </Link>
        <div>
          <span className="eyebrow">FOR THE WAY YOU BUILD</span>
          <h1>
            Good ideas deserve
            <br />
            another chapter<span>.</span>
          </h1>
          <p>
            A home for side projects, small experiments, and the thing you’ll
            get back to someday.
          </p>
          <div className="auth-story-list">
            <span>
              <Layers size={19} />
              Every project, in one place
            </span>
            <span>
              <Pause size={19} />A pause that preserves the context
            </span>
            <span>
              <Play size={19} />A clear next step when you return
            </span>
          </div>
        </div>
        <span className="auth-story-bottom">
          <Sprout size={19} />
          Keep every project ready for its next chapter.
        </span>
      </div>
      <main id="main-content" tabIndex={-1} className="auth-main">
        <Link href="/" className="auth-back">
          ← Back to Chapter
        </Link>
        <div className="auth-form-wrap">
          <span className="auth-flower">✳</span>
          <h2>
            {mode === "login"
              ? "Welcome back."
              : "Your next chapter starts here."}
          </h2>
          <p>
            {mode === "login"
              ? "Your projects are right where you left them."
              : "A little space for everything you want to build."}
          </p>
          <noscript>
            <p className="field-hint">
              Enable JavaScript to create or sign in to your workspace.
            </p>
          </noscript>
          <form method="post" onSubmit={submit}>
            {error ? <Notice kind="error">{error}</Notice> : null}
            {mode === "register" ? (
              <Field label="Your name">
                <input
                  name="name"
                  required
                  autoComplete="name"
                  placeholder="Alex Morgan"
                  maxLength={60}
                />
              </Field>
            ) : null}
            <Field label="Email address">
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </Field>
            <Field
              label="Password"
              hint={
                mode === "register"
                  ? "At least 10 characters. Make it something only you know."
                  : undefined
              }
            >
              <input
                type="password"
                name="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder="Your password"
              />
            </Field>
            <Button type="submit" busy={busy} className="primary">
              {mode === "login" ? "Sign in" : "Create your workspace"}
              <ArrowRight size={16} />
            </Button>
          </form>
          {mode === "login" ? (
            <Link href="/forgot-password" className="auth-recovery-link">
              Forgot your password?
            </Link>
          ) : null}
          <div className="auth-divider">
            <span>or have a look around</span>
          </div>
          <Button
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("auth/demo", "POST");
                router.push(returnTo);
                router.refresh();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Explore a personal demo
            <ArrowUpRightIcon />
          </Button>
          <p className="auth-switch">
            {mode === "login"
              ? "New around here?"
              : "Already have a workspace?"}{" "}
            <Link
              href={
                (mode === "login" ? "/signup" : "/login") +
                (returnTo !== "/dashboard"
                  ? "?next=" + encodeURIComponent(returnTo)
                  : "")
              }
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </Link>
          </p>
          <span className="auth-private">
            <LockKeyhole size={13} />
            Private by default. Yours to share.
          </span>
        </div>
      </main>
    </div>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={15} />;
}
