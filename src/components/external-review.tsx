"use client";
import { useRef, useState } from "react";
import type { reviewData } from "@/lib/reviews";
import { Button, Field, Notice, api } from "./ui";
export function ExternalReview({
  initial,
}: {
  initial: Awaited<ReturnType<typeof reviewData>>;
}) {
  const [data, setData] = useState(initial),
    [name, setName] = useState(""),
    [text, setText] = useState(""),
    [decision, setDecision] = useState("Comment"),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    event = useRef("");
  return (
    <section className="launch-stack">
      <h2>Feedback on this version</h2>
      <Notice>
        Approval status: {data.approval}. Names and decisions are supplied by
        link holders and are not verified signatures.
      </Notice>
      {data.comments.map((c) => (
        <article className="launch-card" key={String(c.id)}>
          <strong>
            {String(c.name)} · {String(c.decision)}
          </strong>
          <small>{new Date(String(c.at)).toLocaleString()}</small>
          <p>{String(c.text)}</p>
        </article>
      ))}
      {!data.comments.length ? (
        <p className="field-hint">No feedback on this captured version yet.</p>
      ) : null}
      <Notice kind="error">{error}</Notice>
      <Notice kind="success">{message}</Notice>
      {data.feedback ? (
        <form
          className="launch-card launch-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            if (!event.current) event.current = crypto.randomUUID();
            try {
              await api("reviews/" + data.id + "/feedback", "POST", {
                name,
                text,
                decision,
                consent,
                requestId: event.current,
              });
              setData(
                (await api<{ review: typeof data }>("reviews/" + data.id))
                  .review,
              );
              setText("");
              setMessage("Feedback attached to this reviewed version.");
              event.current = "";
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Your name">
            <input
              value={name}
              required
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Review decision">
            <select
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              <option>Comment</option>
              <option>Approved</option>
              <option>Changes Requested</option>
            </select>
          </Field>
          <Field label="Your feedback">
            <textarea
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <label className="check-field">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Share this feedback with the owner and other holders of this review
            link.
          </label>
          <Button type="submit" className="primary" busy={busy}>
            Submit version feedback
          </Button>
        </form>
      ) : (
        <Notice>
          Feedback is off. This link grants viewing permissions only.
        </Notice>
      )}
    </section>
  );
}
