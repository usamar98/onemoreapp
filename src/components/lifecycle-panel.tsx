"use client";
import { useState, useEffect } from "react";
import {
  Clock3,
  Signal,
  ShieldCheck,
  Globe,
  Wallet,
  Package,
  History,
  Download,
  Check,
  RefreshCw,
} from "lucide-react";
import { Panel, Button, Field, Notice, api } from "./ui";
import type { Project, Activity, InterestCounts } from "@/lib/types";
import type { HandoverPreview } from "@/lib/phase-two";
import type { HostingPreview } from "@/lib/hosting";
import { taskFor, costTotals } from "@/lib/planning";
type Saved = (project: Project, message?: string) => void;
const tabs = [
  { name: "Next task", Icon: Clock3 },
  { name: "Interest", Icon: Signal },
  { name: "Readiness", Icon: ShieldCheck },
  { name: "Hosting", Icon: Globe },
  { name: "Costs", Icon: Wallet },
  { name: "Handover", Icon: Package },
  { name: "History", Icon: History },
] as const;
export function LifecyclePanel({
  project,
  onClose,
  onSaved,
  initialTab = "Next task",
}: {
  project: Project;
  onClose: () => void;
  onSaved: Saved;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  return (
    <Panel
      title={`${project.name} · Next chapter`}
      subtitle="A useful next step, a safe pause, or a thoughtful handover."
      wide
      onClose={onClose}
    >
      <nav className="lifecycle-tabs" aria-label="Project management">
        {tabs.map(({ name, Icon }) => (
          <button
            key={name}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            <Icon size={16} />
            {name}
          </button>
        ))}
      </nav>
      <div className="panel-body lifecycle-body" key={tab}>
        {tab === "Next task" ? (
          <TaskSettings project={project} onSaved={onSaved} />
        ) : null}
        {tab === "Interest" ? (
          <InterestSettings project={project} onSaved={onSaved} />
        ) : null}
        {tab === "Readiness" ? (
          <Readiness project={project} onSaved={onSaved} />
        ) : null}
        {tab === "Hosting" ? (
          <Hosting project={project} onSaved={onSaved} />
        ) : null}
        {tab === "Costs" ? <Costs project={project} onSaved={onSaved} /> : null}
        {tab === "Handover" ? (
          <Handover project={project} onSaved={onSaved} />
        ) : null}
        {tab === "History" ? <ProjectHistory project={project} /> : null}
      </div>
    </Panel>
  );
}
function useAction(project: Project, onSaved: Saved) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function act(path: string, body?: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await api<{ project?: Project }>(
        `projects/${project.id}/${path}`,
        method,
        body,
      );
      if (r.project) onSaved(r.project);
      setMessage("Saved to your project.");
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const notices = (
    <>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {message ? <Notice kind="success">{message}</Notice> : null}
    </>
  );
  return { busy, error, setError, act, notices };
}
function TaskSettings({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: Saved;
}) {
  const [nextTask, setNextTask] = useState(taskFor(project)),
    [minutes, setMinutes] = useState(project.taskMinutes?.toString() || ""),
    [blockers, setBlockers] = useState(project.blockers),
    [priority, setPriority] = useState(project.taskPriority);
  const a = useAction(project, onSaved);
  return (
    <form
      className="lifecycle-form"
      onSubmit={(e) => {
        e.preventDefault();
        void a.act("task", {
          nextTask,
          taskMinutes: minutes ? Number(minutes) : null,
          blockers,
          taskPriority: priority,
        });
      }}
    >
      <div>
        <h3>Make the next step small enough to start.</h3>
        <p className="field-hint">
          Suggestions use your task estimate and priority. Tasks with recorded
          blockers need attention first.
        </p>
      </div>
      {a.notices}
      <Field label="Next task">
        <textarea
          rows={3}
          value={nextTask}
          maxLength={4000}
          onChange={(e) => setNextTask(e.target.value)}
          placeholder="One concrete task to pick up next"
        />
      </Field>
      <div className="form-row">
        <Field
          label="Estimated minutes"
          hint="An estimate for this task, not the whole project."
        >
          <input
            type="number"
            min={1}
            max={10080}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="Not estimated"
          />
        </Field>
        <Field label="Task priority">
          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as Project["taskPriority"])
            }
          >
            <option>High</option>
            <option>Normal</option>
            <option>Low</option>
          </select>
        </Field>
      </div>
      <Field label="Blockers" hint="Leave empty when no blockers are recorded.">
        <textarea
          rows={3}
          maxLength={4000}
          value={blockers}
          onChange={(e) => setBlockers(e.target.value)}
          placeholder="Waiting on API access, a design decision…"
        />
      </Field>
      <Button className="primary" type="submit" busy={a.busy}>
        Save next task
      </Button>
    </form>
  );
}
type Contact = {
  id: string;
  kind: string;
  email: string;
  message: string;
  at: string;
};
function InterestSettings({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: Saved;
}) {
  const [videoUrl, setVideo] = useState(project.videoUrl),
    [shareVideo, setShareVideo] = useState(project.shareVideo),
    [waitlist, setWaitlist] = useState(project.waitlistEnabled),
    [enquiries, setEnquiries] = useState(project.enquiriesEnabled);
  const [data, setData] = useState<{
      counts: InterestCounts;
      contacts: Contact[];
    } | null>(null),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const a = useAction(project, onSaved);
  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      setData(await api(`projects/${project.id}/interest`));
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [project.id]);
  return (
    <div className="lifecycle-form">
      <h3>A parked app can still find its people.</h3>
      <p className="field-hint">
        Your public project page stays available independently of application
        hosting. Contacts are visible only to you. Chapter does not send emails.
      </p>
      {!project.shared ? (
        <Notice>
          Enable your project share page in Share settings to start collecting
          interest.
        </Notice>
      ) : (
        <a
          className="text-link"
          href={`/p/${project.shareId}`}
          target="_blank"
          rel="noreferrer"
        >
          Open public project page ↗
        </a>
      )}
      {a.notices}
      <form
        className="lifecycle-form"
        onSubmit={(e) => {
          e.preventDefault();
          void a.act("interest-settings", {
            videoUrl,
            shareVideo,
            waitlistEnabled: waitlist,
            enquiriesEnabled: enquiries,
          });
        }}
      >
        <Field
          label="Demo video URL"
          hint="Use an independent video host so the demo stays available while application hosting is paused. Public MP4/WebM URLs and video-page links are supported."
        >
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideo(e.target.value)}
            placeholder="https://…"
          />
        </Field>
        <label className="option-check">
          <input
            type="checkbox"
            checked={shareVideo}
            onChange={(e) => setShareVideo(e.target.checked)}
          />
          Share this demo video
        </label>
        <label className="option-check">
          <input
            type="checkbox"
            checked={waitlist}
            onChange={(e) => setWaitlist(e.target.checked)}
          />
          Collect waitlist signups
        </label>
        <label className="option-check">
          <input
            type="checkbox"
            checked={enquiries}
            onChange={(e) => setEnquiries(e.target.checked)}
          />
          Accept project enquiries
        </label>
        <Button busy={a.busy} className="primary" type="submit">
          Save interest settings
        </Button>
      </form>
      <div className="section-title">
        <h3>Recorded interest</h3>
        <Button
          busy={loading}
          onClick={() => void load()}
          aria-label="Refresh interest"
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      {loadError ? <Notice kind="error">{loadError}</Notice> : null}
      {loading && !data ? <p role="status">Loading interest…</p> : null}
      {data ? (
        <>
          <div className="interest-metrics">
            {(
              [
                ["Visits", data.counts.visits],
                ["Signups", data.counts.signups],
                ["Enquiries", data.counts.enquiries],
              ] as const
            ).map(([name, count]) => (
              <div key={name}>
                <strong>{count}</strong>
                <span>{name}</span>
              </div>
            ))}
          </div>
          <p className="field-hint">
            Visits count at most once per browser per day. Your own visits are
            excluded. These counts may include bots; they are not revenue or
            unique-person estimates.
          </p>
          {data.contacts.length ? (
            <div className="contact-list">
              {data.contacts.map((c) => (
                <article key={c.id}>
                  <div>
                    <strong>{c.email}</strong>
                    <span className="tag">
                      {c.kind === "signup" ? "Waitlist" : "Enquiry"}
                    </span>
                  </div>
                  {c.message ? <p>{c.message}</p> : null}
                  <small>{new Date(c.at).toLocaleString()}</small>
                  <Button
                    busy={a.busy}
                    onClick={async () => {
                      const r = await a.act("interest", { id: c.id }, "DELETE");
                      if (r) void load();
                    }}
                  >
                    Delete contact
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="lifecycle-empty">
              No signups or enquiries yet. Share the page when you are ready.
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
export function Readiness({
  project,
  onSaved,
  compact = false,
}: {
  project: Project;
  onSaved: Saved;
  compact?: boolean;
}) {
  const [runBuild, setBuild] = useState(false),
    [names, setNames] = useState(
      (project.requiredEnvNames.length
        ? project.requiredEnvNames
        : project.referencedEnvNames
      ).join("\n"),
    ),
    [available, setAvailable] = useState(false);
  const a = useAction(project, onSaved);
  useEffect(() => {
    let live = true;
    void api<{ sandboxAvailable: boolean }>(`projects/${project.id}/revival`)
      .then((r) => {
        if (live) setAvailable(r.sandboxAvailable);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [project.id]);
  const report = project.revival;
  return (
    <section
      className={`readiness-section lifecycle-form ${compact ? "readiness-compact" : ""}`}
    >
      <div className="section-title">
        <h3>Revival check</h3>
        <ShieldCheck size={19} />
      </div>
      <p className="field-hint">
        Check the repository, provider, demo and environment names before
        returning. Results are dated observations, not a guarantee.
      </p>
      {a.notices}
      {!compact ? (
        <>
          <Field
            label="Required environment-variable names"
            hint="One NAME per line. Source references are suggestions; save to confirm which are required. Never paste values, tokens or a .env file."
          >
            <textarea
              rows={3}
              value={names}
              onChange={(e) => setNames(e.target.value)}
              placeholder={"DATABASE_URL\nNEXT_PUBLIC_APP_URL"}
            />
          </Field>
          <Button
            busy={a.busy}
            onClick={() =>
              void a.act("environment-names", {
                names: names
                  .split(/[\n,]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          >
            Save environment names
          </Button>
        </>
      ) : null}
      <label className="option-check">
        <input
          type="checkbox"
          checked={runBuild}
          onChange={(e) => setBuild(e.target.checked)}
          disabled={!available}
        />
        Run isolated npm build{" "}
        {available
          ? "(uses your configured Vercel Sandbox plan)"
          : "(integration unavailable)"}
      </label>
      {!available ? (
        <p className="field-hint">
          Build checks require Vercel Sandbox with OIDC, or server variables
          VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID. Builds remain Not
          Checked until configured.
        </p>
      ) : null}
      <Button
        busy={a.busy}
        className="primary"
        onClick={() => void a.act("revival", { runBuild })}
      >
        <ShieldCheck size={16} />
        {a.busy ? "Checking readiness…" : "Check readiness"}
      </Button>
      {report ? (
        <>
          <p className="field-hint">
            Checked {new Date(report.at).toLocaleString()} · saved version{" "}
            {report.version || "not recorded"}
          </p>
          <div className="check-list">
            {report.items.map((item) => (
              <article key={item.name}>
                <div className="section-title">
                  <strong>{item.name}</strong>
                  <span
                    className={`check-status ${item.status === "Passed" ? "passed" : item.status === "Needs Attention" ? "attention" : "unchecked"}`}
                  >
                    {item.status}
                  </span>
                </div>
                <p>{item.detail}</p>
                <small>Next: {item.nextStep}</small>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="lifecycle-empty">
          No readiness check saved yet. Missing integrations will be marked Not
          Checked.
        </div>
      )}
      {project.hostingPaused ? (
        <Notice>
          Your Vercel service is paused. Resume project work and resume hosting
          are separate actions.
        </Notice>
      ) : null}
    </section>
  );
}
function Hosting({ project, onSaved }: { project: Project; onSaved: Saved }) {
  const [preview, setPreview] = useState<HostingPreview | null>(null),
    [target, setTarget] = useState<"pause" | "resume">("pause"),
    [name, setName] = useState("");
  const a = useAction(project, onSaved),
    [busy, setBusy] = useState(false);
  async function review(next: "pause" | "resume") {
    setBusy(true);
    a.setError("");
    try {
      const r = await api<{ preview: HostingPreview }>(
        `projects/${project.id}/hosting-preview`,
        "POST",
        { target: next },
      );
      setTarget(next);
      setPreview(r.preview);
      setName("");
    } catch (e) {
      a.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="lifecycle-form">
      <h3>Hosting is a separate switch.</h3>
      <p className="field-hint">
        Parking saves memory. Only an explicit hosting action pauses Vercel
        production service.
      </p>
      {a.notices}
      {project.hostingProvider !== "vercel" || !project.hostingProjectId ? (
        <Notice>
          Hosting controls are unavailable until you connect Vercel in
          Integrations and deploy this project's static build. External
          database, API and domain services must be managed in their own
          accounts.
        </Notice>
      ) : (
        <>
          <div className="hosting-summary">
            <span>Vercel project</span>
            <code>{project.hostingProjectId}</code>
            <strong>
              {project.hostingPaused === null
                ? "Not checked"
                : project.hostingPaused
                  ? "Paused · last verified"
                  : "Unpaused · last verified"}
            </strong>
            {project.hostingCheckedAt ? (
              <small>
                {new Date(project.hostingCheckedAt).toLocaleString()}
              </small>
            ) : null}
          </div>
          <div className="detail-actions">
            <Button
              busy={a.busy}
              onClick={() => void a.act("hosting-status", undefined, "GET")}
            >
              Verify provider status
            </Button>
            <Button busy={busy} onClick={() => void review("pause")}>
              Review pause
            </Button>
            <Button busy={busy} onClick={() => void review("resume")}>
              Review hosting resume
            </Button>
          </div>
          {preview ? (
            <div className="hosting-confirm lifecycle-form">
              <h4>
                {target === "pause" ? "What will stop" : "What will resume"}
              </h4>
              <p>
                {target === "pause"
                  ? preview.stop
                  : `Production service for ${preview.name} (${preview.id}) will resume. Provider status will be checked; serving traffic may take a few minutes.`}
              </p>
              <h4>What remains available</h4>
              <ul>
                {preview.remain.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <Field label={`Type ${preview.name} to confirm`}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Button
                className="primary"
                busy={a.busy}
                disabled={name !== preview.name || preview.paused === null}
                onClick={async () => {
                  const r = await a.act("hosting-control", {
                    target,
                    name,
                    expires: preview.expires,
                    confirmation: preview.confirmation,
                  });
                  if (r) setPreview(null);
                }}
              >
                {target === "pause"
                  ? "Confirm pause hosting"
                  : "Confirm resume hosting"}
              </Button>
              <Button onClick={() => setPreview(null)}>Cancel</Button>
            </div>
          ) : null}
        </>
      )}
      <p className="field-hint">
        No connected billing data is available in this version. Pausing does not
        cancel subscriptions or domain renewals, and Chapter does not calculate
        unverified savings.
      </p>
    </div>
  );
}
function Costs({ project, onSaved }: { project: Project; onSaved: Saved }) {
  const [label, setLabel] = useState(""),
    [category, setCategory] = useState("Hosting"),
    [amount, setAmount] = useState(""),
    [currency, setCurrency] = useState("USD"),
    [interval, setInterval] = useState("Monthly"),
    [continues, setContinues] = useState(true);
  const a = useAction(project, onSaved),
    totals = costTotals(project.expenses),
    ongoing = costTotals(project.expenses, true);
  return (
    <div className="lifecycle-form">
      <h3>Know what keeps ticking.</h3>
      <p className="field-hint">
        All entries below are manual estimates. Connected billing is
        unavailable. Yearly amounts are divided by twelve for the monthly view;
        currencies are never combined.
      </p>
      {a.notices}
      {Object.keys(totals).length ? (
        <div className="cost-totals">
          {Object.entries(totals).map(([code, total]) => (
            <div key={code}>
              <strong>
                {code} {total.toFixed(2)} / month
              </strong>
              <span>
                {code} {(ongoing[code] || 0).toFixed(2)} may continue while
                parked
              </span>
              <small>Manual estimates · no verified savings data</small>
            </div>
          ))}
        </div>
      ) : (
        <div className="lifecycle-empty">
          No costs recorded. Add recurring expenses so a parked project does not
          surprise you.
        </div>
      )}
      {project.expenses.map((e) => (
        <article className="expense-row" key={e.id}>
          <div>
            <strong>{e.label}</strong>
            <p>
              {e.category} · {e.currency} {e.amount.toFixed(2)} /{" "}
              {e.interval.toLowerCase()}
            </p>
            <small>
              {e.origin} ·{" "}
              {e.continuesWhenParked
                ? "May continue while parked"
                : "Owner expects it to stop; cancellation not verified"}
            </small>
          </div>
          <Button
            busy={a.busy}
            onClick={() => void a.act("expenses", { id: e.id }, "DELETE")}
          >
            Remove
          </Button>
        </article>
      ))}
      <form
        className="lifecycle-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await a.act("expenses", {
            label,
            category,
            amount: Number(amount),
            currency,
            interval,
            continuesWhenParked: continues,
          });
          if (r) {
            setLabel("");
            setAmount("");
          }
        }}
      >
        <Field label="Expense name">
          <input
            value={label}
            required
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Production database"
          />
        </Field>
        <div className="form-row">
          <Field label="Expense category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {["Hosting", "Database", "Domain", "API", "Other"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Billing interval">
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            >
              <option>Monthly</option>
              <option>Yearly</option>
            </select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="Estimated amount">
            <input
              type="number"
              min={0}
              max={1000000}
              step="0.01"
              value={amount}
              required
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Currency code">
            <input
              value={currency}
              pattern="[A-Z]{3}"
              maxLength={3}
              required
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <label className="option-check">
          <input
            type="checkbox"
            checked={continues}
            onChange={(e) => setContinues(e.target.checked)}
          />
          This cost may continue while parked
        </label>
        <Button className="primary" busy={a.busy} type="submit">
          Add manual estimate
        </Button>
      </form>
    </div>
  );
}
function Handover({ project, onSaved }: { project: Project; onSaved: Saved }) {
  const [preview, setPreview] = useState<HandoverPreview | null>(null),
    [paths, setPaths] = useState<string[]>([]),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const a = useAction(project, onSaved);
  async function inspect(selection: string[]) {
    setBusy(true);
    a.setError("");
    setReviewed(false);
    try {
      const r = await api<{ preview: HandoverPreview }>(
        `projects/${project.id}/handover-preview`,
        "POST",
        { paths: selection },
      );
      setPreview(r.preview);
      setLoaded(true);
    } catch (e) {
      a.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const current =
    preview &&
    JSON.stringify(preview.files.map((f) => f.path).sort()) ===
      JSON.stringify(paths.slice().sort());
  return (
    <div className="lifecycle-form">
      <h3>Leave a useful package for the next owner.</h3>
      <p className="field-hint">
        Select files, review the complete text, then create a private ZIP.
        Sharing the package is a separate action. Database exports, customer
        data files, screenshots and credentials are excluded.
      </p>
      {a.notices}
      {!loaded ? (
        <Button busy={busy} onClick={() => void inspect([])}>
          Inspect handover contents
        </Button>
      ) : null}
      {preview ? (
        <>
          <div className="handover-files">
            <h4>Eligible source files</h4>
            {preview.paths.length ? (
              preview.paths.map((path) => (
                <label className="option-check" key={path}>
                  <input
                    type="checkbox"
                    checked={paths.includes(path)}
                    onChange={(e) => {
                      setPaths((p) =>
                        e.target.checked
                          ? [...p, path]
                          : p.filter((v) => v !== path),
                      );
                      setReviewed(false);
                    }}
                  />
                  {path}
                </label>
              ))
            ) : (
              <p className="field-hint">
                No eligible source saved. You can still create a notes-only
                package, or upload clean source in Edit project.
              </p>
            )}
          </div>
          {preview.excluded.length ? (
            <details>
              <summary>
                {preview.excluded.length} files excluded by privacy or size
                rules
              </summary>
              <pre>{preview.excluded.join("\n")}</pre>
            </details>
          ) : null}
          <Button busy={busy} onClick={() => void inspect(paths)}>
            Review selected contents
          </Button>
          {current ? (
            <>
              <details open className="handover-review">
                <summary>
                  HANDOVER.md · full manifest and transfer checklist
                </summary>
                <pre>{preview.manifest}</pre>
              </details>
              {preview.files.map((f) => (
                <details className="handover-review" key={f.path}>
                  <summary>
                    {f.path} · {f.size} bytes · review full content
                  </summary>
                  <pre>{f.content}</pre>
                </details>
              ))}
              <label className="option-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I reviewed the manifest and all selected files. I confirm they
                contain no secrets or private customer data and I have the right
                to transfer them.
              </label>
              <Button
                className="primary"
                busy={a.busy}
                disabled={!reviewed}
                onClick={async () => {
                  const r = await a.act("handover-create", {
                    paths,
                    digest: preview.digest,
                    reviewed,
                  });
                  if (r) {
                    setPreview(null);
                    setLoaded(false);
                    setReviewed(false);
                  }
                }}
              >
                <Package size={16} />
                Create reviewed package
              </Button>
            </>
          ) : (
            <Notice>
              The selection changed. Review selected contents again before
              creating a package.
            </Notice>
          )}
        </>
      ) : null}
      {project.handover ? (
        <section className="handover-saved lifecycle-form">
          <h4>
            Reviewed package · {new Date(project.handover.at).toLocaleString()}
          </h4>
          <p>
            {project.handover.paths.length} selected source files + handover
            manifest
          </p>
          <a
            className="button"
            href={`/api/projects/${project.id}/handover-download`}
          >
            <Download size={16} />
            Download private package
          </a>
          <details className="handover-review">
            <summary>Saved manifest</summary>
            <pre>{project.handover.manifest}</pre>
          </details>
          <Button
            busy={a.busy}
            disabled={!project.shared && !project.handover.shared}
            onClick={() =>
              void a.act("handover-share", {
                shared: !project.handover!.shared,
              })
            }
          >
            {project.handover.shared
              ? "Revoke handover sharing"
              : "Enable handover download on share page"}
          </Button>
          {!project.shared ? (
            <p className="field-hint">
              Enable the project share page in Share settings before sharing
              this package.
            </p>
          ) : null}
          {project.handover.shared && project.shared ? (
            <a
              className="text-link"
              href={`/api/handovers/${project.id}/${project.handover.shareToken}`}
            >
              Shared package download
            </a>
          ) : null}
          <p className="field-hint">
            Package sharing never transfers provider ownership automatically.
            Use the checklist and verify each transfer in the relevant account.
          </p>
        </section>
      ) : null}
    </div>
  );
}
function ProjectHistory({ project }: { project: Project }) {
  const [activity, setActivity] = useState<Activity[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void api<{ activity: Activity[] }>(`projects/${project.id}/history`)
      .then((r) => {
        if (live) setActivity(r.activity);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [project.id]);
  return (
    <div className="lifecycle-form">
      <h3>This project's history</h3>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {!activity && !error ? <p role="status">Loading history…</p> : null}
      {activity?.length ? (
        <ol className="project-history">
          {activity.map((item) => (
            <li key={item.id}>
              <span>
                <Check size={14} />
              </span>
              <div>
                <p>{item.text}</p>
                <small>
                  {new Date(item.at).toLocaleString()} · {item.kind}
                </small>
              </div>
            </li>
          ))}
        </ol>
      ) : activity ? (
        <div className="lifecycle-empty">
          No project activity recorded yet. New parking, sharing, checks,
          resumes and handovers appear here. Older workspace events remain in
          Activity.
        </div>
      ) : null}
    </div>
  );
}
