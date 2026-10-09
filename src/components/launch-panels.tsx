"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, RefreshCw, ShieldCheck } from "lucide-react";
import { Panel, Button, Field, Notice, Badge, api } from "./ui";
import type { Project, Workspace } from "@/lib/types";
import type { Discovery } from "@/lib/connections";
import type { ReviewOptions, ReviewSnapshot } from "@/lib/reviews";
import type { PortfolioOptions } from "@/lib/public-portfolio";
type Tab =
  | "onboarding"
  | "sync"
  | "automation"
  | "reviews"
  | "public"
  | "recovery"
  | "support";
const tabs: { id: Tab; label: string }[] = [
  { id: "onboarding", label: "Get started" },
  { id: "sync", label: "Sync" },
  { id: "automation", label: "Rules" },
  { id: "reviews", label: "Review links" },
  { id: "public", label: "Public portfolio" },
  { id: "recovery", label: "Backups" },
  { id: "support", label: "Help & status" },
];
type Connection = {
  connected: boolean;
  connectedAt: string;
  lastSuccess: string;
  lastAttempt: string;
  error: string;
};
type LaunchData = {
  primary: boolean;
  connections: { github: Connection; vercel: Connection };
  projects: Project[];
  setup: Record<string, boolean>;
  supportEmail: string;
  at: string;
};
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  const previousPath = useRef(path);
  useEffect(() => {
    let live = true;
    if (previousPath.current !== path || !path) setData(null);
    previousPath.current = path;
    setError("");
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<T>(path)
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path, revision]);
  return {
    data: previousPath.current === path ? data : null,
    error,
    loading,
    setData,
    reload: () => setRevision((n) => n + 1),
  };
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function run<T>(fn: () => Promise<T>, success = "Saved") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fn();
      setMessage(success);
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, message, run };
}
export function Feedback({ a }: { a: ReturnType<typeof useAction> }) {
  return (
    <>
      <Notice kind="error">{a.error}</Notice>
      <Notice kind="success">{a.message}</Notice>
    </>
  );
}
export function Loading({
  r,
}: {
  r: { loading: boolean; error: string; reload: () => void };
}) {
  return (
    <>
      {r.loading ? (
        <p role="status" className="field-hint">
          Loading saved information…
        </p>
      ) : null}
      <Notice kind="error">{r.error}</Notice>
      {r.error ? <Button onClick={r.reload}>Retry loading</Button> : null}
    </>
  );
}
function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : "Never checked";
}
export function JobStatus({
  id,
  onFinished,
}: {
  id: string;
  onFinished: () => void;
}) {
  const [job, setJob] = useState<{
      state: string;
      attempts: number;
      error: string;
    } | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const finish = useRef(onFinished);
  finish.current = onFinished;
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const r = await api<{ job: NonNullable<typeof job> }>("jobs/" + id);
        if (!live) return;
        setJob(r.job);
        if (["queued", "running"].includes(r.job.state))
          timer = setTimeout(poll, 2000);
        else if (r.job.state === "succeeded") finish.current();
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    }
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, revision]);
  return (
    <div className="job-status" role="status">
      <strong>Background job · {job?.state || "checking"}</strong>
      <span>
        {job ? "Attempt " + job.attempts + " of 3" : "Saved in the job queue"}
      </span>
      <Notice kind="error">{error || job?.error}</Notice>
      {job?.state === "failed" ? (
        <Button
          onClick={async () => {
            try {
              await api("jobs/" + id + "/retry", "POST");
              setRevision((n) => n + 1);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Retry job
        </Button>
      ) : null}
    </div>
  );
}
export function LaunchPanel({
  workspace,
  owner,
  initialProject,
  initialTab,
  onClose,
  onRefresh,
}: {
  workspace: Workspace;
  owner: string;
  initialProject?: Project;
  initialTab?: "support";
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<Tab>(
      initialTab || (initialProject ? "reviews" : "onboarding"),
    ),
    r = useResource<LaunchData>(
      workspace.user ? "launch?workspace=" + encodeURIComponent(owner) : null,
    );
  function refresh() {
    r.reload();
    onRefresh();
  }
  return (
    <Panel
      title="Ready for the next chapter"
      subtitle="Connect, automate, get feedback, and keep a recovery plan."
      onClose={onClose}
      wide
    >
      <div className="phase-three-content phase-four-content">
        {!workspace.user ? (
          <div className="empty-state">
            <h3>A private workspace comes first</h3>
            <p>Sign in to connect accounts and keep your project records.</p>
            <a href="/signup" className="button primary">
              Create account
            </a>
            <a href="/login" className="button">
              Sign in
            </a>
          </div>
        ) : (
          <>
            <nav className="launch-tabs" aria-label="Launch tools">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  aria-current={tab === t.id ? "page" : undefined}
                  className={tab === t.id ? "selected" : ""}
                  onClick={() => {
                    setTab(t.id);
                    r.reload();
                  }}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <Loading r={r} />
            {r.data ? (
              <>
                {tab === "onboarding" ? (
                  <Onboarding
                    data={r.data}
                    onRefresh={onRefresh}
                    onConnectionsChanged={refresh}
                    onNext={() => {
                      setTab("sync");
                      r.reload();
                    }}
                  />
                ) : null}
                {tab === "sync" ? (
                  <Synchronization
                    projects={r.data.projects}
                    onRefresh={refresh}
                  />
                ) : null}
                {tab === "automation" ? (
                  <Automations
                    projects={r.data.projects}
                    onRefresh={onRefresh}
                  />
                ) : null}
                {tab === "reviews" ? (
                  <Reviews
                    projects={r.data.projects}
                    initialId={initialProject?.id}
                    onRefresh={onRefresh}
                  />
                ) : null}
                {tab === "public" ? (
                  <PortfolioEditor projects={r.data.projects} />
                ) : null}
                {tab === "recovery" ? (
                  <Recovery projects={r.data.projects} onRefresh={onRefresh} />
                ) : null}
                {tab === "support" ? <Support data={r.data} /> : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  );
}
function Onboarding({
  data,
  onRefresh,
  onConnectionsChanged,
  onNext,
}: {
  data: LaunchData;
  onRefresh: () => void;
  onConnectionsChanged: () => void;
  onNext: () => void;
}) {
  const a = useAction(),
    [provider, setProvider] = useState<"github" | "vercel" | null>(null),
    [token, setToken] = useState(""),
    [team, setTeam] = useState(""),
    [discovery, setDiscovery] = useState<Discovery | null>(null),
    [selections, setSelections] = useState<Record<string, string>>({}),
    [reviewed, setReviewed] = useState(false),
    [results, setResults] = useState<
      { name: string; id: string; state: string }[]
    >([]),
    [filter, setFilter] = useState("");
  const selected = Object.entries(selections).map(([key, deploymentId]) => ({
    key,
    deploymentId,
  }));
  return (
    <div className="launch-stack">
      <div className="launch-intro">
        <span className="eyebrow">A SMALL START, A LASTING HOME</span>
        <h3>Bring your existing work together.</h3>
        <p>
          Connect accounts, review matches, and import privately. Your live
          applications keep running exactly as they are.
        </p>
      </div>
      <ol className="onboarding-steps">
        <li>
          <span>1</span>Connect accounts
        </li>
        <li>
          <span>2</span>Review projects
        </li>
        <li>
          <span>3</span>Import metadata
        </li>
      </ol>
      <Feedback a={a} />
      {!data.primary ? (
        <Notice>
          Only the primary workspace owner connects provider accounts and
          imports account-wide metadata. Ask them to connect or select your own
          workspace.
        </Notice>
      ) : null}
      <div className="connection-grid">
        {(["github", "vercel"] as const).map((p) => (
          <section className="launch-card" key={p}>
            <div className="knowledge-row">
              <h3>{p === "github" ? "GitHub" : "Vercel"}</h3>
              <span
                className={
                  "connection-label " +
                  (data.connections[p].connected ? "connected" : "")
                }
              >
                {data.connections[p].connected ? "Connected" : "Setup needed"}
              </span>
            </div>
            <p>
              {p === "github"
                ? "Use a fine-grained token restricted to selected repositories with Contents: read-only. Metadata access is implicit. No write or administration permission is needed."
                : "Use an expiring token scoped to the required Vercel account or team. Vercel tokens may permit writes; discovery and synchronization perform reads only. Hosting actions stay separately confirmed."}
            </p>
            <a
              className="text-link"
              href={
                p === "github"
                  ? "https://github.com/settings/personal-access-tokens"
                  : "https://vercel.com/account/settings/tokens"
              }
              target="_blank"
              rel="noreferrer"
            >
              Open token settings ↗
            </a>
            <small>
              Last verified read: {formatDate(data.connections[p].lastSuccess)}
            </small>
            <Notice kind="error">{data.connections[p].error}</Notice>
            <div className="button-row">
              <Button
                disabled={!data.primary}
                onClick={() => {
                  setProvider(p);
                  setToken("");
                }}
              >
                {data.connections[p].connected ? "Reconnect" : "Connect"}{" "}
                {p === "github" ? "GitHub" : "Vercel"}
              </Button>
              {data.connections[p].connected ? (
                <Button
                  disabled={!data.primary}
                  busy={a.busy}
                  onClick={() =>
                    a.run(async () => {
                      await api("integrations/" + p, "DELETE");
                      onConnectionsChanged();
                    }, "Disconnected. Saved records and live services remain available.")
                  }
                >
                  Disconnect
                </Button>
              ) : null}
            </div>
            {provider === p ? (
              <form
                className="launch-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  a.run(async () => {
                    await api("integrations/" + p, "POST", {
                      token,
                      teamId: p === "vercel" ? team : "",
                    });
                    setToken("");
                    setProvider(null);
                    onConnectionsChanged();
                  }, "Account verified and connected.");
                }}
              >
                <Field
                  label={
                    (p === "github" ? "GitHub" : "Vercel") + " access token"
                  }
                >
                  <input
                    type="password"
                    autoComplete="off"
                    required
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </Field>
                {p === "vercel" ? (
                  <Field label="Vercel Team ID (optional)">
                    <input
                      value={team}
                      onChange={(e) => setTeam(e.target.value)}
                      placeholder="team_… or leave empty"
                    />
                  </Field>
                ) : null}
                <Button type="submit" className="primary" busy={a.busy}>
                  Verify connection
                </Button>
              </form>
            ) : null}
          </section>
        ))}
      </div>
      <Button
        className="primary"
        busy={a.busy}
        disabled={!data.primary}
        onClick={() =>
          a.run(async () => {
            const r = await api<{ discovery: Discovery }>("discovery", "POST");
            setDiscovery(r.discovery);
            setSelections({});
            setReviewed(false);
            setResults([]);
          }, "Discovery complete. Review the available matches.")
        }
      >
        <RefreshCw size={15} />
        Discover existing projects
      </Button>
      {discovery ? (
        <>
          <h3>Review your import</h3>
          <p className="field-hint">
            {discovery.repositories.length} repositories ·{" "}
            {discovery.deployments.length} Vercel applications
          </p>
          {discovery.warnings.map((w, i) => (
            <Notice key={i}>{w}</Notice>
          ))}
          <Field label="Filter discovered projects">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Repository or deployment name"
            />
          </Field>
          {!discovery.repositories.length && !discovery.deployments.length ? (
            <div className="empty-state">
              <h3>No accessible projects found</h3>
              <p>
                Check token expiry, selected repositories and Vercel team scope,
                then reconnect. Public repository import by URL is also
                available in New project.
              </p>
            </div>
          ) : null}
          {discovery.repositories
            .filter((r) =>
              (r.name + " " + r.repository)
                .toLowerCase()
                .includes(filter.toLowerCase()),
            )
            .map((r) => (
              <section className="launch-card import-row" key={r.key}>
                <label className="check-field">
                  <input
                    type="checkbox"
                    disabled={!!r.existing}
                    checked={Object.hasOwn(selections, r.key)}
                    onChange={(e) => {
                      setReviewed(false);
                      setSelections((s) => {
                        const next = { ...s };
                        if (e.target.checked)
                          next[r.key] =
                            r.matches.length === 1 && r.matches[0].certain
                              ? r.matches[0].id
                              : "";
                        else delete next[r.key];
                        return next;
                      });
                    }}
                  />
                  <span>
                    <strong>{r.name}</strong>
                    <small>{r.repository}</small>
                  </span>
                </label>
                {r.existing ? (
                  <span className="field-hint">Already in your workspace</span>
                ) : (
                  <Field
                    label={"Deployment for " + r.name}
                    hint={
                      r.matches.find((m) => m.id === selections[r.key])
                        ?.reason ||
                      "Optional. Confirm the application belongs to this repository."
                    }
                  >
                    <select
                      value={selections[r.key] || ""}
                      disabled={!Object.hasOwn(selections, r.key)}
                      onChange={(e) => {
                        setSelections((s) => ({
                          ...s,
                          [r.key]: e.target.value,
                        }));
                        setReviewed(false);
                      }}
                    >
                      <option value="">No hosting match</option>
                      {discovery.deployments
                        .filter((d) => !d.existing)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                            {r.matches.find((m) => m.id === d.id)?.certain
                              ? " · Git link match"
                              : r.matches.some((m) => m.id === d.id)
                                ? " · uncertain name match"
                                : " · manual choice"}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
              </section>
            ))}
          <details>
            <summary>
              Import Vercel applications without a repository match
            </summary>
            {discovery.deployments
              .filter((d) => !d.existing)
              .map((d) => (
                <label className="check-field" key={d.id}>
                  <input
                    type="checkbox"
                    checked={Object.hasOwn(selections, "deployment:" + d.id)}
                    onChange={(e) => {
                      setReviewed(false);
                      setSelections((s) => {
                        const next = { ...s };
                        if (e.target.checked) next["deployment:" + d.id] = "";
                        else delete next["deployment:" + d.id];
                        return next;
                      });
                    }}
                  />
                  {d.name} · {d.state}
                </label>
              ))}
          </details>
          <Notice>
            Metadata includes available descriptions, branches and production
            deployment references. Source files are downloaded separately. Every
            project starts private, with scheduled sync off.
          </Notice>
          <label className="check-field">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the selected projects and hosting matches.
          </label>
          <Button
            className="primary"
            busy={a.busy}
            disabled={!reviewed || !selected.length}
            onClick={() =>
              a.run(async () => {
                const r = await api<{ results: typeof results }>(
                  "discovery/import",
                  "POST",
                  {
                    batchId: discovery.id,
                    selections: selected,
                    confirmed: true,
                  },
                );
                setResults(r.results);
                onRefresh();
              }, "Import finished. Review individual results below.")
            }
          >
            Import {selected.length} selected projects
          </Button>
        </>
      ) : null}
      {results.length ? (
        <>
          <ul className="result-list">
            {results.map((r, i) => (
              <li key={i}>
                <strong>{r.name}</strong>
                <span>{r.state}</span>
              </li>
            ))}
          </ul>
          <Button onClick={onNext}>Set up synchronization →</Button>
        </>
      ) : null}
      <div className="launch-card">
        <h3>Prefer a smaller first step?</h3>
        <p>
          Use New project to add an idea, import a public repository, or upload
          a source ZIP. Then choose one next task, share a preview, and park
          with memory.
        </p>
      </div>
    </div>
  );
}
function Synchronization({
  projects,
  onRefresh,
}: {
  projects: Project[];
  onRefresh: () => void;
}) {
  const a = useAction(),
    [jobId, setJobId] = useState(""),
    [pending, setPending] = useState<Record<string, boolean>>({});
  return (
    <div className="launch-stack">
      <h3>Fresh information, deliberate changes.</h3>
      <p className="field-hint">
        Sync reads recent repository context and production deployment status.
        It preserves your work status, stored package version and chosen demo
        URL. Scheduled sync runs at most once per six-hour window when a worker
        is available.
      </p>
      <Feedback a={a} />
      {jobId ? <JobStatus id={jobId} onFinished={onRefresh} /> : null}
      {!projects.length ? (
        <div className="empty-state">
          <h3>No connected projects yet</h3>
          <p>Import metadata or add a repository first.</p>
        </div>
      ) : null}
      {projects.map((p) => (
        <section className="launch-card" key={p.id}>
          <div className="knowledge-row">
            <h3>{p.name}</h3>
            <Badge status={p.status} />
          </div>
          <p>{p.repository || "No repository linked"}</p>
          <small>Last complete sync: {formatDate(p.sync?.succeededAt)}</small>
          {p.sync?.attemptedAt ? (
            <small>Last attempt: {formatDate(p.sync.attemptedAt)}</small>
          ) : null}
          {p.sync?.repository ? (
            <small>
              Latest repository commit:{" "}
              {p.sync.repository.sha || "Not available"} ·{" "}
              {formatDate(p.sync.repository.checkedAt)}
            </small>
          ) : null}
          {p.sync?.deployment ? (
            <small>
              Deployment: {p.sync.deployment.state} ·{" "}
              {formatDate(p.sync.deployment.checkedAt)}
            </small>
          ) : null}
          <Notice kind="error">{p.sync?.error}</Notice>
          <div className="button-row">
            <Button
              disabled={
                p.role !== "Owner" || (!p.repository && !p.hostingProjectId)
              }
              busy={a.busy}
              onClick={() =>
                a.run(async () => {
                  const r = await api<{ jobId: string }>(
                    "projects/" + p.id + "/sync",
                    "POST",
                  );
                  setJobId(r.jobId);
                }, "Sync queued. Status below reports the provider result.")
              }
            >
              <RefreshCw size={14} />
              Sync {p.name}
            </Button>
            <label className="check-field">
              <input
                type="checkbox"
                disabled={p.role !== "Owner" || a.busy}
                checked={pending[p.id] ?? !!p.syncEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setPending((current) => ({ ...current, [p.id]: enabled }));
                  void a.run(async () => {
                    try {
                      await api("projects/" + p.id + "/sync-settings", "POST", {
                        enabled,
                      });
                    } finally {
                      onRefresh();
                      setPending((current) => {
                        const next = { ...current };
                        delete next[p.id];
                        return next;
                      });
                    }
                  }, "Scheduled sync preference saved.");
                }}
              />
              Scheduled sync
            </label>
          </div>
          {p.role !== "Owner" ? (
            <small>Ask an Owner to manage synchronization.</small>
          ) : null}
        </section>
      ))}
    </div>
  );
}
type Rule = {
  id: string;
  kind: string;
  enabled: number;
  name: string;
  project_id: string;
  data: { days: number };
  runs: {
    id: string;
    state: string;
    detail: string;
    at: string;
    error: string;
    job_state: string;
    attempts: number;
  }[];
};
function Automations({
  projects,
  onRefresh,
}: {
  projects: Project[];
  onRefresh: () => void;
}) {
  const owners = projects.filter((p) => p.role === "Owner"),
    [projectId, setProjectId] = useState(owners[0]?.id || ""),
    [kind, setKind] = useState("return"),
    [days, setDays] = useState(30),
    [preview, setPreview] = useState<{
      preview: { detail: string; ready: boolean; brief: string };
      digest: string;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [jobId, setJobId] = useState("");
  const r = useResource<{ rules: Rule[] }>("automations"),
    a = useAction();
  function clear() {
    setPreview(null);
    setConfirmed(false);
  }
  function refresh() {
    r.reload();
    onRefresh();
  }
  return (
    <div className="launch-stack">
      <h3>A few rules, with a clear off switch.</h3>
      <Notice>
        Rules send in-app reminders, flag recorded inactivity, or refresh a
        saved-notes brief. Hosting controls always require their own explicit
        owner confirmation. No rule stops a service or spends AI credits.
      </Notice>
      <Loading r={r} />
      <Feedback a={a} />
      {jobId ? <JobStatus id={jobId} onFinished={refresh} /> : null}
      {owners.length ? (
        <section className="launch-card">
          <div className="knowledge-filters">
            <Field label="Rule project">
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  clear();
                }}
              >
                {owners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="When to act">
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  clear();
                }}
              >
                <option value="return">On the saved return date</option>
                <option value="inactivity">After recorded inactivity</option>
                <option value="brief">When saved notes change</option>
              </select>
            </Field>
          </div>
          {kind === "inactivity" ? (
            <Field label="Days without recorded work">
              <input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => {
                  setDays(Number(e.target.value));
                  clear();
                }}
              />
            </Field>
          ) : null}
          <Button
            busy={a.busy}
            onClick={() =>
              a.run(
                async () =>
                  setPreview(
                    await api("automations/preview", "POST", {
                      projectId,
                      kind,
                      days,
                    }),
                  ),
                "Preview prepared. Review before enabling.",
              )
            }
          >
            Preview rule
          </Button>
          {preview ? (
            <>
              <Notice>
                {preview.preview.detail}{" "}
                {preview.preview.ready
                  ? "The current saved trigger is eligible."
                  : "Waiting for the recorded trigger."}
              </Notice>
              {preview.preview.brief ? (
                <pre className="review-text">{preview.preview.brief}</pre>
              ) : null}
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed this rule and its effect.
              </label>
              <Button
                className="primary"
                busy={a.busy}
                disabled={!confirmed}
                onClick={() =>
                  a.run(async () => {
                    await api("automations/create", "POST", {
                      projectId,
                      kind,
                      days,
                      digest: preview.digest,
                      confirmed: true,
                    });
                    clear();
                    refresh();
                  }, "Rule enabled. It will run when its recorded trigger is due.")
                }
              >
                Enable reviewed rule
              </Button>
            </>
          ) : null}
        </section>
      ) : (
        <div className="empty-state">
          <h3>Owner access is needed</h3>
          <p>
            Rules can change project records. Ask an Owner to configure them.
          </p>
        </div>
      )}
      {r.data?.rules.length === 0 ? (
        <p className="field-hint">
          No rules yet. Start with one return reminder.
        </p>
      ) : null}
      {r.data?.rules.map((rule) => (
        <section className="launch-card" key={rule.id}>
          <div className="knowledge-row">
            <h3>
              {rule.name} · {rule.kind}
            </h3>
            <label className="check-field">
              <input
                type="checkbox"
                disabled={a.busy}
                checked={!!rule.enabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  r.setData((current) =>
                    current
                      ? {
                          ...current,
                          rules: current.rules.map((item) =>
                            item.id === rule.id
                              ? { ...item, enabled: Number(enabled) }
                              : item,
                          ),
                        }
                      : current,
                  );
                  void a.run(async () => {
                    try {
                      await api("automations/" + rule.id, "PATCH", { enabled });
                    } finally {
                      r.reload();
                    }
                  }, "Rule preference saved.");
                }}
              />
              Rule on
            </label>
          </div>
          <div className="button-row">
            <Button
              busy={a.busy}
              onClick={() =>
                a.run(async () => {
                  const result = await api<{
                    jobId: string | null;
                    message: string;
                  }>("automations/" + rule.id + "/run", "POST");
                  if (result.jobId) setJobId(result.jobId);
                  r.reload();
                }, "Checked the recorded trigger.")
              }
            >
              Check trigger now
            </Button>
            <Button
              busy={a.busy}
              onClick={() =>
                a.run(async () => {
                  await api("automations/" + rule.id, "DELETE");
                  r.reload();
                }, "Rule removed.")
              }
            >
              Remove rule
            </Button>
          </div>
          <details>
            <summary>Execution history ({rule.runs.length})</summary>
            {rule.runs.length ? (
              rule.runs.map((run) => (
                <div className="history-entry" key={run.id}>
                  <strong>
                    {run.job_state || run.state} · {formatDate(run.at)}
                  </strong>
                  <p>{run.detail}</p>
                  {run.error ? <Notice kind="error">{run.error}</Notice> : null}
                  {run.job_state === "failed" ? (
                    <Button onClick={() => setJobId(run.id)}>
                      Open retry controls
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <p>Nothing has executed yet. Repeated events are handled once.</p>
            )}
          </details>
        </section>
      ))}
    </div>
  );
}
type ReviewLink = {
  id: string;
  expires: number;
  revoked: number;
  at: string;
  data: ReviewSnapshot;
  comments: { name: string; text: string; decision: string; at: string }[];
};
function PortfolioEditor({ projects }: { projects: Project[] }) {
  const r = useResource<{
      portfolio:
        (PortfolioOptions & { slug: string; published: boolean }) | null;
    }>("showcase-settings"),
    a = useAction(),
    [options, setOptions] = useState<PortfolioOptions>({
      title: "Projects, with room to grow",
      intro: "A few things I’m building, sharing, and returning to.",
      accent: "mint",
      projects: [],
    }),
    [slug, setSlug] = useState(""),
    [preview, setPreview] = useState<{
      preview: {
        title: string;
        intro: string;
        projects: {
          id: string;
          name: string;
          description: string;
          status: Project["status"];
          demoUrl: string;
          screenshotIds: string[];
          enquiries: boolean;
        }[];
      };
      digest: string;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [url, setUrl] = useState("");
  useEffect(() => {
    if (r.data?.portfolio) {
      const p = r.data.portfolio;
      setOptions({
        title: p.title,
        intro: p.intro,
        accent: p.accent,
        projects: p.projects,
      });
      setSlug(p.slug);
      if (p.published) setUrl("/portfolio/" + p.slug);
    }
  }, [r.data]);
  function change(part: Partial<PortfolioOptions>) {
    setOptions((s) => ({ ...s, ...part }));
    setPreview(null);
    setConfirmed(false);
  }
  function choose(
    id: string,
    key: "demo" | "screenshots" | "enquiries",
    value: boolean,
  ) {
    change({
      projects: options.projects.map((p) =>
        p.id === id ? { ...p, [key]: value } : p,
      ),
    });
  }
  return (
    <div className="launch-stack">
      <h3>A public home, chosen by you.</h3>
      <Loading r={r} />
      <Feedback a={a} />
      <Notice>
        Publishing a portfolio is separate from project share links. It includes
        only the entries and viewing options selected here. Source, private
        notes, repository links and waitlist contacts are excluded.
      </Notice>
      <Field label="Portfolio title">
        <input
          value={options.title}
          maxLength={100}
          onChange={(e) => change({ title: e.target.value })}
        />
      </Field>
      <Field label="Portfolio introduction">
        <textarea
          value={options.intro}
          maxLength={2000}
          onChange={(e) => change({ intro: e.target.value })}
        />
      </Field>
      <div className="knowledge-filters">
        <Field label="Public portfolio address">
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setConfirmed(false);
            }}
            placeholder="your-name"
            pattern="[a-z0-9][a-z0-9-]{2,49}"
          />
        </Field>
        <Field label="Accent">
          <select
            value={options.accent}
            onChange={(e) =>
              change({ accent: e.target.value as PortfolioOptions["accent"] })
            }
          >
            <option value="mint">Mint</option>
            <option value="violet">Violet</option>
            <option value="blue">Blue</option>
          </select>
        </Field>
      </div>
      {projects
        .filter((p) => p.role === "Owner")
        .map((p) => {
          const entry = options.projects.find((s) => s.id === p.id);
          return (
            <section className="launch-card" key={p.id}>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={!!entry}
                  onChange={(e) =>
                    change({
                      projects: e.target.checked
                        ? [
                            ...options.projects,
                            {
                              id: p.id,
                              demo: false,
                              screenshots: true,
                              enquiries: false,
                            },
                          ]
                        : options.projects.filter((s) => s.id !== p.id),
                    })
                  }
                />
                <strong>{p.name}</strong>
                <Badge status={p.status} />
              </label>
              {entry ? (
                <div className="permission-grid">
                  {(["demo", "screenshots", "enquiries"] as const).map(
                    (key) => (
                      <label className="check-field" key={key}>
                        <input
                          type="checkbox"
                          checked={entry[key]}
                          onChange={(e) => choose(p.id, key, e.target.checked)}
                        />
                        {key === "demo"
                          ? "Demo link"
                          : key === "screenshots"
                            ? "Screenshots"
                            : "Project enquiries"}
                      </label>
                    ),
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      <Button
        busy={a.busy}
        onClick={() =>
          a.run(
            async () =>
              setPreview(
                await api("showcase-settings/preview", "POST", options),
              ),
            "Private portfolio preview prepared.",
          )
        }
      >
        Preview portfolio
      </Button>
      {preview ? (
        <section
          className={"launch-card portfolio-preview accent-" + options.accent}
        >
          <h3>{preview.preview.title}</h3>
          <p>{preview.preview.intro}</p>
          {preview.preview.projects.map((p) => (
            <article key={p.id}>
              <h4>{p.name}</h4>
              <Badge status={p.status} />
              <p>{p.description}</p>
              <small>
                {p.screenshotIds.length} screenshots · Demo{" "}
                {p.demoUrl ? "included" : "private"} · Enquiries{" "}
                {p.enquiries ? "enabled" : "off"}
              </small>
              {p.status === "Parked" ? (
                <Notice>Work on this project is parked.</Notice>
              ) : null}
            </article>
          ))}
          {!preview.preview.projects.length ? (
            <p>No projects selected. This will publish an empty portfolio.</p>
          ) : null}
          <label className="check-field">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed the projects and public viewing options.
          </label>
          <div className="button-row">
            <Button
              disabled={!confirmed}
              busy={a.busy}
              onClick={() =>
                a.run(async () => {
                  await api("showcase-settings", "POST", {
                    ...options,
                    slug,
                    digest: preview.digest,
                    confirmed: true,
                    published: false,
                  });
                  r.reload();
                }, "Private draft saved.")
              }
            >
              Save private draft
            </Button>
            <Button
              className="primary"
              disabled={!confirmed || !slug}
              busy={a.busy}
              onClick={() =>
                a.run(async () => {
                  const result = await api<{ url: string }>(
                    "showcase-settings",
                    "POST",
                    {
                      ...options,
                      slug,
                      digest: preview.digest,
                      confirmed: true,
                      published: true,
                    },
                  );
                  setUrl(result.url);
                }, "Portfolio published with selected viewing permissions.")
              }
            >
              Publish reviewed portfolio
            </Button>
          </div>
        </section>
      ) : null}
      {url ? (
        <>
          <CopyLink url={url} />
          <Button
            busy={a.busy}
            onClick={() =>
              a.run(async () => {
                await api("showcase-settings", "DELETE");
                setUrl("");
                r.reload();
              }, "Portfolio unpublished. Project share settings are unchanged.")
            }
          >
            Unpublish portfolio
          </Button>
        </>
      ) : null}
    </div>
  );
}
type Backup = {
  id: string;
  projectCount: number;
  fileCount: number;
  bytes: number;
  at: string;
};
type RecoveryPreview = {
  digest: string;
  exportedAt: string;
  fileBytes: number;
  effect: string;
  projects: {
    id: string;
    name: string;
    status: Project["status"];
    versions: number;
    files: number;
    notes: unknown;
    nextTask: string;
  }[];
};
function Recovery({
  projects,
  onRefresh,
}: {
  projects: Project[];
  onRefresh: () => void;
}) {
  const r = useResource<{ backups: Backup[] }>("recovery"),
    a = useAction(),
    [selected, setSelected] = useState<string[]>([]),
    [jobId, setJobId] = useState(""),
    [backupId, setBackupId] = useState(""),
    [ticket, setTicket] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<RecoveryPreview | null>(null),
    [restoreIds, setRestoreIds] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [result, setResult] = useState<{
      projects: { id: string; name: string }[];
    } | null>(null);
  async function input(restore = false) {
    if (file) {
      if (file.size > 18 * 1024 * 1024)
        throw new Error("Choose a Chapter export ZIP under 18 MB.");
      let uploadTicket = ticket;
      if (!uploadTicket) {
        const upload = await api<{
          local: boolean;
          ticket?: string;
          signedUrl?: string;
        }>("recovery/upload-token", "POST", { size: file.size });
        if (!upload.local) {
          const sent = await fetch(upload.signedUrl!, {
            method: "PUT",
            headers: { "Content-Type": "application/zip", "x-upsert": "false" },
            body: file,
          });
          if (!sent.ok)
            throw new Error(
              "The private recovery upload failed. Check your connection and retry.",
            );
          uploadTicket = upload.ticket!;
          setTicket(uploadTicket);
        }
      }
      if (uploadTicket)
        return {
          ticket: uploadTicket,
          ...(restore
            ? { digest: preview!.digest, selected: restoreIds, confirmed: true }
            : {}),
        };
      const form = new FormData();
      form.set("file", file);
      if (restore) {
        form.set("digest", preview!.digest);
        form.set("selected", JSON.stringify(restoreIds));
        form.set("confirmed", "true");
      }
      return form;
    }
    return {
      backupId,
      ...(restore
        ? { digest: preview!.digest, selected: restoreIds, confirmed: true }
        : {}),
    };
  }
  function clear() {
    setPreview(null);
    setConfirmed(false);
    setResult(null);
    setTicket("");
  }
  return (
    <div className="launch-stack">
      <h3>Keep a copy. Prove you can recover it.</h3>
      <Loading r={r} />
      <Feedback a={a} />
      <Notice>
        Exports contain authorized stored records, uploaded files and version
        metadata. They exclude credentials, sessions, billing identities and
        interest contacts. External repositories, domains, live deployments and
        provider databases remain with their providers. Private backup bytes
        count toward storage limits.
      </Notice>
      <section className="launch-card">
        <h3>Choose projects to back up</h3>
        {projects.length ? (
          projects.map((p) => (
            <label className="check-field" key={p.id}>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked
                      ? [...s, p.id]
                      : s.filter((id) => id !== p.id),
                  )
                }
              />
              {p.name} <Badge status={p.status} />
            </label>
          ))
        ) : (
          <p>Add a project before making a backup.</p>
        )}
        <Button
          className="primary"
          disabled={!selected.length}
          busy={a.busy}
          onClick={() =>
            a.run(async () => {
              const r = await api<{ jobId: string }>(
                "recovery/backup",
                "POST",
                { projectIds: selected },
              );
              setJobId(r.jobId);
            }, "Private backup queued. Check its status before downloading.")
          }
        >
          <ShieldCheck size={15} />
          Create private backup
        </Button>
      </section>
      {jobId ? <JobStatus id={jobId} onFinished={() => r.reload()} /> : null}
      {r.data?.backups.length === 0 ? (
        <p className="field-hint">
          No private backups yet. Download an offline copy after creating your
          first one.
        </p>
      ) : null}
      {r.data?.backups.map((b) => (
        <section className="launch-card" key={b.id}>
          <h3>
            {b.projectCount} projects · {b.fileCount} files
          </h3>
          <small>
            {formatDate(b.at)} · {(b.bytes / 1024 / 1024).toFixed(2)} MB
          </small>
          <div className="button-row">
            <a className="button" href={"/api/recovery/" + b.id + "/download"}>
              <Download size={14} />
              Download private export
            </a>
            <Button
              onClick={() => {
                setBackupId(b.id);
                setFile(null);
                clear();
              }}
            >
              Review recovery
            </Button>
            <Button
              busy={a.busy}
              onClick={() =>
                a.run(async () => {
                  await api("recovery/" + b.id, "DELETE");
                  r.reload();
                }, "Stored backup removed; offline copies remain with their holder.")
              }
            >
              Remove stored copy
            </Button>
          </div>
        </section>
      ))}
      <section className="launch-card">
        <h3>Review an archive for recovery</h3>
        <Field label="Chapter export ZIP (under 18 MB)">
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setBackupId("");
              clear();
            }}
          />
        </Field>
        {backupId ? (
          <p className="field-hint">Selected a saved private backup.</p>
        ) : null}
        <Button
          disabled={!file && !backupId}
          busy={a.busy}
          onClick={() =>
            a.run(async () => {
              const r = await api<{ preview: RecoveryPreview }>(
                "recovery/preview",
                "POST",
                await input(),
              );
              setPreview(r.preview);
              setRestoreIds(r.preview.projects.map((p) => p.id));
              setConfirmed(false);
            }, "Checksums and stored records verified. Review the recovery preview.")
          }
        >
          Preview recovery
        </Button>
        {preview ? (
          <>
            <Notice>{preview.effect}</Notice>
            <small>
              Exported {formatDate(preview.exportedAt)} ·{" "}
              {(preview.fileBytes / 1024 / 1024).toFixed(2)} MB of file data
            </small>
            {preview.projects.map((p) => (
              <div className="history-entry" key={p.id}>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={restoreIds.includes(p.id)}
                    onChange={(e) =>
                      setRestoreIds((s) =>
                        e.target.checked
                          ? [...s, p.id]
                          : s.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <strong>{p.name}</strong>
                </label>
                <small>
                  {p.files} files · {p.versions} stored versions · {p.status}
                </small>
                <p>Next task: {p.nextTask || "Not recorded"}</p>
                <details>
                  <summary>Saved parking notes</summary>
                  <pre className="review-text">
                    {JSON.stringify(p.notes, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
            <label className="check-field">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed the selected records. Restore them as new private
              projects.
            </label>
            <Button
              className="primary"
              disabled={!confirmed || !restoreIds.length}
              busy={a.busy}
              onClick={() =>
                a.run(async () => {
                  const restored = await api<NonNullable<typeof result>>(
                    "recovery/restore",
                    "POST",
                    await input(true),
                  );
                  setResult(restored);
                  onRefresh();
                }, "Recovered selected records into independent private projects.")
              }
            >
              Restore reviewed records
            </Button>
          </>
        ) : null}
        {result ? (
          <ul className="result-list">
            {result.projects.map((p) => (
              <li key={p.id}>
                <a href={"/dashboard?project=" + p.id}>{p.name} ↗</a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
function Support({ data }: { data: LaunchData }) {
  const r = useResource<{
      requests: { id: string; subject: string; at: string }[];
      supportEmail: string;
    }>("support"),
    a = useAction(),
    [subject, setSubject] = useState(""),
    [text, setText] = useState(""),
    [reference, setReference] = useState("");
  return (
    <div className="launch-stack">
      <h3>Know what is ready, and what needs setup.</h3>
      <div className="connection-grid">
        {Object.entries(data.setup).map(([key, ready]) => (
          <section className="launch-card" key={key}>
            <h4>
              {(
                {
                  ai: "AI provider",
                  billing: "Stripe billing",
                  worker: "Scheduled worker",
                  cloud: "Cloud database and uploads",
                  support: "Support contact",
                } as Record<string, string>
              )[key] || key}
            </h4>
            <span className={"connection-label " + (ready ? "connected" : "")}>
              {ready ? "Configuration present" : "Setup needed"}
            </span>
            <small>
              Configuration presence is not a live service verification.
            </small>
          </section>
        ))}
      </div>
      <p className="field-hint">
        The Free plan, saved-notes briefs and local persistence work without
        cloud or paid integrations. For unattended rules and sync, configure the
        worker. Last status read: {formatDate(data.at)}.
      </p>
      <a className="button" href="/api/health" target="_blank" rel="noreferrer">
        Check storage health ↗
      </a>
      <details>
        <summary>Useful workflow checks</summary>
        <ol>
          <li>Import one project and save its source or setup instructions.</li>
          <li>Choose exactly what a share or review link can expose.</li>
          <li>Park with one clear next task and a return date.</li>
          <li>
            Run a readiness check before resuming or preparing a handover.
          </li>
          <li>
            Create a private backup, download it, and test recovery into a
            separate project.
          </li>
        </ol>
      </details>
      <Feedback a={a} />
      <Loading r={r} />
      <form
        className="launch-card launch-stack"
        onSubmit={(e) => {
          e.preventDefault();
          a.run(async () => {
            const result = await api<{ id: string }>("support", "POST", {
              subject,
              text,
            });
            setReference(result.id);
            setSubject("");
            setText("");
            r.reload();
          }, "Private support reference saved. No email was sent.");
        }}
      >
        <h3>Record a support issue</h3>
        <Field label="Support subject">
          <input
            required
            maxLength={120}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field
          label="What happened?"
          hint="Include the affected action and safe error message. Leave out credentials and customer details."
        >
          <textarea
            required
            maxLength={4000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Button type="submit" className="primary" busy={a.busy}>
          Save support reference
        </Button>
      </form>
      {reference ? (
        <Notice>
          Reference: {reference}.{" "}
          {data.supportEmail ? (
            <a
              href={
                "mailto:" +
                data.supportEmail +
                "?subject=" +
                encodeURIComponent("Chapter support " + reference)
              }
            >
              Contact support
            </a>
          ) : (
            "No support email is configured. Give this reference to the platform operator."
          )}
        </Notice>
      ) : null}
      {r.data?.requests.map((s) => (
        <div className="history-entry" key={s.id}>
          <strong>{s.subject}</strong>
          <small>
            {s.id} · {formatDate(s.at)}
          </small>
        </div>
      ))}
    </div>
  );
}
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <div className="copy-link">
        <input
          aria-label="Shareable link"
          readOnly
          value={
            typeof window !== "undefined"
              ? new URL(url, window.location.origin).href
              : url
          }
        />
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                new URL(url, window.location.origin).href,
              );
              setCopied(true);
            } catch {
              setError("Select the link and copy it manually.");
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}Copy
        </Button>
        <a className="button" href={url} target="_blank" rel="noreferrer">
          Open ↗
        </a>
      </div>
      <Notice>{error}</Notice>
    </>
  );
}
function Reviews({
  projects,
  initialId,
  onRefresh,
}: {
  projects: Project[];
  initialId?: string;
  onRefresh: () => void;
}) {
  const owners = projects.filter((p) => p.role === "Owner"),
    [projectId, setProjectId] = useState(initialId || owners[0]?.id || ""),
    [options, setOptions] = useState<ReviewOptions>({
      versionId: "",
      demo: false,
      feedback: true,
      source: false,
      screenshots: true,
      notes: false,
      days: 7,
    }),
    [preview, setPreview] = useState<ReviewSnapshot | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [url, setUrl] = useState("");
  const versions = useResource<{
      versions: { id: string; kind: string; at: string }[];
    }>(projectId ? "projects/" + projectId + "/versions" : null),
    links = useResource<{ links: ReviewLink[] }>(
      projectId ? "projects/" + projectId + "/review-links" : null,
    ),
    a = useAction();
  function change(p: Partial<ReviewOptions>) {
    setOptions((s) => ({ ...s, ...p }));
    setPreview(null);
    setConfirmed(false);
  }
  return (
    <div className="launch-stack">
      <h3>Feedback belongs to the version you shared.</h3>
      <p className="field-hint">
        Create an expiring, revocable link to frozen records. Reviewers enter
        their own name; possession of the link grants the selected permissions.
        Approval is feedback, not a verified signature.
      </p>
      <Feedback a={a} />
      <Loading r={links} />
      {owners.length ? (
        <>
          <Field label="Project to review">
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                change({ versionId: "" });
                setUrl("");
              }}
            >
              {owners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stored record version">
            <select
              value={options.versionId}
              onChange={(e) => change({ versionId: e.target.value })}
            >
              <option value="">Current stored records</option>
              {versions.data?.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.kind} · {formatDate(v.at)}
                </option>
              ))}
            </select>
          </Field>
          <Notice>
            A selected notes, brief or package version replaces that record in
            the snapshot. The overview is captured now. A demo URL can change at
            its provider after the review is created.
          </Notice>
          <div className="permission-grid">
            {(
              ["demo", "feedback", "source", "screenshots", "notes"] as const
            ).map((key) => (
              <label className="check-field" key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) => change({ [key]: e.target.checked })}
                />
                {
                  {
                    demo: "Allow demo viewing",
                    feedback: "Allow comments and approval feedback",
                    source: "Allow source ZIP download",
                    screenshots: "Include screenshots",
                    notes: "Include setup, notes and resume brief",
                  }[key]
                }
              </label>
            ))}
          </div>
          <Field label="Link expiry (days)">
            <input
              type="number"
              min={1}
              max={90}
              value={options.days}
              onChange={(e) => change({ days: Number(e.target.value) })}
            />
          </Field>
          <Button
            busy={a.busy}
            onClick={() =>
              a.run(
                async () =>
                  setPreview(
                    (
                      await api<{ preview: ReviewSnapshot }>(
                        "projects/" + projectId + "/review-preview",
                        "POST",
                        options,
                      )
                    ).preview,
                  ),
                "Review preview prepared.",
              )
            }
          >
            Preview review contents
          </Button>
          {preview ? (
            <section className="launch-card">
              <h3>{preview.name} · review preview</h3>
              <Badge status={preview.status} />
              <p>{preview.description}</p>
              <small>{preview.record}</small>
              <small>Version: {preview.version}</small>
              <p>
                Demo: {preview.demoUrl || "Private"} · Source:{" "}
                {preview.sourceId
                  ? "Reviewed eligible text files only"
                  : "Private"}{" "}
                · Feedback: {preview.feedback ? "Enabled" : "Off"} ·
                Screenshots: {preview.screenshotIds.length}
              </p>
              {preview.notes ? (
                <pre className="review-text">{preview.notes}</pre>
              ) : null}
              {preview.brief ? (
                <pre className="review-text">{preview.brief}</pre>
              ) : null}
              {preview.sourceFiles?.map((f) => (
                <details key={f.path}>
                  <summary>{f.path} · source to include</summary>
                  <pre className="review-text">{f.content}</pre>
                </details>
              ))}
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed these records, source contents and download
                permissions.
              </label>
              <Button
                className="primary"
                busy={a.busy}
                disabled={!confirmed}
                onClick={() =>
                  a.run(async () => {
                    const result = await api<{ url: string }>(
                      "projects/" + projectId + "/review-create",
                      "POST",
                      { ...options, digest: preview.digest, confirmed: true },
                    );
                    setUrl(result.url);
                    links.reload();
                    onRefresh();
                  }, "Frozen review link created.")
                }
              >
                Create reviewed link
              </Button>
            </section>
          ) : null}
          {url ? <CopyLink url={url} /> : null}
        </>
      ) : (
        <div className="empty-state">
          <h3>Ask an Owner for a review link</h3>
          <p>Only Owners choose what external reviewers can access.</p>
        </div>
      )}
      {links.data?.links.length === 0 ? (
        <p className="field-hint">
          No review links yet. Source stays private until explicitly included.
        </p>
      ) : null}
      {links.data?.links.map((l) => (
        <section className="launch-card" key={l.id}>
          <h3>
            {l.data.name} ·{" "}
            {l.revoked
              ? "Revoked"
              : l.expires < Date.now()
                ? "Expired"
                : "Active"}
          </h3>
          <small>{l.data.record}</small>
          <small>Expires {new Date(l.expires).toLocaleString()}</small>
          {!l.revoked ? (
            <>
              <CopyLink url={"/review/" + l.id} />
              <Button
                busy={a.busy}
                onClick={() =>
                  a.run(async () => {
                    await api(
                      "projects/" + projectId + "/review-revoke",
                      "POST",
                      { reviewId: l.id },
                    );
                    links.reload();
                  }, "Review revoked. New page and download requests are blocked.")
                }
              >
                Revoke link
              </Button>
            </>
          ) : null}
          <details>
            <summary>Version feedback ({l.comments.length})</summary>
            {l.comments.length ? (
              l.comments.map((c, i) => (
                <div className="history-entry" key={i}>
                  <strong>
                    {c.name} · {c.decision}
                  </strong>
                  <small>{formatDate(c.at)}</small>
                  <p>{c.text}</p>
                </div>
              ))
            ) : (
              <p>Waiting for feedback on this frozen version.</p>
            )}
          </details>
        </section>
      ))}
    </div>
  );
}
