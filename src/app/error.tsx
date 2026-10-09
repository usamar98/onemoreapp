"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" tabIndex={-1} className="standalone-state">
      <h1>A little interruption.</h1>
      <p>We could not load this page. Please try again.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
