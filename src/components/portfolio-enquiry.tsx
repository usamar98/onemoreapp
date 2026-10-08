"use client";
import { useRef, useState } from "react";
import { Button, Field, Notice, api } from "./ui";
export function PortfolioEnquiry({
  slug,
  projectId,
}: {
  slug: string;
  projectId: string;
}) {
  const [email, setEmail] = useState(""),
    [message, setMessage] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    event = useRef("");
  return (
    <details className="portfolio-enquiry">
      <summary>Enquire about this project</summary>
      <form
        className="launch-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          if (!event.current) event.current = crypto.randomUUID();
          try {
            await api("showcase/" + slug + "/enquiry", "POST", {
              projectId,
              email,
              message,
              consent,
              requestId: event.current,
            });
            setSaved(true);
            event.current = "";
            setMessage("");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Your email">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Your enquiry">
          <textarea
            required
            value={message}
            maxLength={2000}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        <label className="check-field">
          <input
            required
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          Share my details privately with the project owner.
        </label>
        <Notice kind="error">{error}</Notice>
        {saved ? (
          <Notice kind="success">
            Enquiry saved for the owner. No email was sent automatically.
          </Notice>
        ) : null}
        <Button busy={busy} type="submit" className="primary">
          Send project enquiry
        </Button>
      </form>
    </details>
  );
}
