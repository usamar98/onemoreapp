"use client";
import { useState, useEffect } from "react";
import { Button, Field, Notice, api } from "./ui";
export function PublicInterest({
  shareId,
  waitlist,
  enquiries,
}: {
  shareId: string;
  waitlist: boolean;
  enquiries: boolean;
}) {
  const [kind, setKind] = useState(waitlist ? "signup" : "enquiry"),
    [email, setEmail] = useState(""),
    [message, setMessage] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(""),
    [website, setWebsite] = useState("");
  useEffect(() => {
    let visitor: string;
    try {
      visitor =
        sessionStorage.getItem("chapter-visitor") || crypto.randomUUID();
      sessionStorage.setItem("chapter-visitor", visitor);
    } catch {
      visitor = crypto.randomUUID();
    }
    void api(`public/${shareId}/visit`, "POST", { visitor }).catch(() => {});
  }, [shareId]);
  if (!waitlist && !enquiries) return null;
  return (
    <section className="public-interest">
      <h2>Be part of the next chapter.</h2>
      <p>
        {waitlist
          ? "Leave your email for the owner’s waitlist."
          : "Send the owner an enquiry about this project."}{" "}
        Your details stay private with the project owner.
      </p>
      <form
        className="lifecycle-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setDone("");
          try {
            await api(`public/${shareId}/${kind}`, "POST", {
              email,
              message,
              consent,
              website,
            });
            setDone(
              kind === "signup"
                ? "You're on the waitlist. Your interest has been saved for the owner."
                : "Your enquiry has been saved for the owner.",
            );
            setEmail("");
            setMessage("");
            setConsent(false);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {waitlist && enquiries ? (
          <Field label="I’d like to">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="signup">Join the waitlist</option>
              <option value="enquiry">Make an enquiry</option>
            </select>
          </Field>
        ) : null}
        <Field label="Your email">
          <input
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>
        {kind === "enquiry" ? (
          <Field label="Your enquiry">
            <textarea
              rows={4}
              required
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Please avoid passwords or private customer information."
            />
          </Field>
        ) : null}
        <label className="interest-honeypot" aria-hidden="true">
          Website
          <input
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
        <label className="option-check">
          <input
            type="checkbox"
            checked={consent}
            required
            onChange={(e) => setConsent(e.target.checked)}
          />
          I agree to share my email{kind === "enquiry" ? " and enquiry" : ""}{" "}
          with the project owner so they can contact me about this project.
        </label>
        <Button busy={busy} className="primary" type="submit">
          {kind === "signup" ? "Join waitlist" : "Send enquiry"}
        </Button>
        {error ? <Notice kind="error">{error}</Notice> : null}
        {done ? <Notice kind="success">{done}</Notice> : null}
      </form>
    </section>
  );
}
