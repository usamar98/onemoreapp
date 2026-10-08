"use client";
import { useState, useEffect } from "react";
import { Panel, Button, Field, Notice, Badge, api } from "./ui";
import {
  useResource,
  useAction,
  Loading,
  Feedback,
  JobStatus,
} from "./launch-panels";
import { Readiness } from "./lifecycle-panel";
import type { Project, Workspace } from "@/lib/types";
import type { AttentionItem } from "@/lib/attention";
type Tab =
  | "session"
  | "capture"
  | "proposals"
  | "inbox"
  | "feedback"
  | "insights"
  | "admin";
type Session = {
  id: string;
  state: string;
  at: string;
  finished_at: string;
  data: {
    task: string;
    minutes: number;
    completed: string;
    issues: string;
    nextTask: string;
    context: { memory: Project["memory"]; setup: string; blockers: string };
  };
};
type Context = {
  project: Project;
  digest: string;
  sessions: Session[];
  canEdit: boolean;
};
type Proposal = {
  id: string;
  kind: string;
  state: string;
  at: string;
  data: {
    text?: string;
    baseDigest: string;
    kind: string;
    jobId?: string;
    setup: string;
    missing: string[];
    sources: { id: string; label: string; text: string; url: string }[];
  };
};
export function ContinuationPanel({
  workspace,
  owner,
  initialProject,
  initialTab = "session",
  onClose,
  onRefresh,
}: {
  workspace: Workspace;
  owner: string;
  initialProject?: Project;
  initialTab?: Tab;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab),
    [projectId, setProjectId] = useState(initialProject?.id || "");
  const r = useResource<{ projects: Project[]; admin: boolean; ai: boolean }>(
    workspace.user ? "continuation" : null,
  );
  const projects =
    r.data?.projects ||
    workspace.projects.filter((p) => p.workspaceOwner === owner);
  const p = projects.find((p) => p.id === projectId) || projects[0];
  const tabs: { id: Tab; label: string }[] = [
    { id: "session", label: "Guided resume" },
    { id: "capture", label: "Developer capture" },
    { id: "proposals", label: "Action proposals" },
    { id: "inbox", label: "Attention inbox" },
    { id: "feedback", label: "Feedback" },
    { id: "insights", label: "Usage insights" },
    ...(r.data?.admin ? [{ id: "admin" as Tab, label: "Admin feedback" }] : []),
  ];
  function refresh() {
    r.reload();
    onRefresh();
  }
  return (
    <Panel
      title="Keep moving, one next step at a time"
      subtitle="Bring your context back, capture progress, and shape Chapter with your feedback."
      onClose={onClose}
      wide
    >
      <div className="phase-three-content phase-five-content">
        {!workspace.user ? (
          <div className="empty-state">
            <h3>A private workspace comes first</h3>
            <p>Sign in to continue projects and save your progress.</p>
            <a className="button primary" href="/login">
              Sign in
            </a>
          </div>
        ) : (
          <>
            <nav className="launch-tabs" aria-label="Continuation tools">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  className={tab === t.id ? "selected" : ""}
                  aria-current={tab === t.id ? "page" : undefined}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <Loading r={r} />
            {["session", "capture", "proposals"].includes(tab) ? (
              <>
                <Field label="Project to continue">
                  <select
                    value={p?.id || ""}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.status}
                      </option>
                    ))}
                  </select>
                </Field>
                {!p ? (
                  <div className="empty-state">
                    <h3>Your next chapter starts with a project</h3>
                    <p>
                      Add or import a project to save context and start a
                      session.
                    </p>
                  </div>
                ) : tab === "session" ? (
                  <SessionTool key={p.id} project={p} onRefresh={refresh} />
                ) : tab === "capture" ? (
                  <CaptureTool key={p.id} project={p} />
                ) : (
                  <ProposalTool
                    key={p.id}
                    project={p}
                    ai={r.data?.ai || false}
                    onRefresh={refresh}
                  />
                )}
              </>
            ) : null}
            {tab === "inbox" ? (
              <AttentionTool
                onChoose={(id) => {
                  setProjectId(id);
                  setTab("session");
                }}
              />
            ) : null}
            {tab === "feedback" ? <FeedbackTool /> : null}
            {tab === "insights" ? <InsightsTool /> : null}
            {tab === "admin" && r.data?.admin ? <FeedbackTool admin /> : null}
          </>
        )}
      </div>
    </Panel>
  );
}
function SessionTool({
  project,
  onRefresh,
}: {
  project: Project;
  onRefresh: () => void;
}) {
  const r = useResource<Context>("projects/" + project.id + "/session-context"),
    a = useAction();
  const [task, setTask] = useState(
      project.nextTask || project.memory?.nextTask || "",
    ),
    [minutes, setMinutes] = useState(30),
    [reviewed, setReviewed] = useState(false);
  const [completed, setCompleted] = useState(""),
    [issues, setIssues] = useState(
      project.blockers || project.memory?.issues || "",
    ),
    [nextTask, setNextTask] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [completionId, setCompletionId] = useState("");
  const [sessionRequestId, setSessionRequestId] = useState("");
  const p = r.data?.project || project,
    active = r.data?.sessions.find((s) => s.state === "active");
  useEffect(() => {
    setConfirmed(false);
    setReviewed(false);
  }, [r.data?.digest]);
  function refresh() {
    r.reload();
    onRefresh();
    setReviewed(false);
    setConfirmed(false);
  }
  const memory = active?.data.context.memory || p.memory;
  return (
    <section className="continuation-tool">
      <Loading r={r} />
      <Feedback a={a} />
      <div className="resume-memory">
        <span className="eyebrow">
          {active ? "SESSION IN PROGRESS" : "SAVED CONTEXT"}
        </span>
        <h3>
          {active?.data.task ||
            p.nextTask ||
            memory?.nextTask ||
            "No next task recorded"}
        </h3>
        <p>{p.description || "Purpose not recorded."}</p>
        {active ? (
          <p>
            {active.data.minutes} minutes planned · Started{" "}
            {new Date(active.at).toLocaleString()}
          </p>
        ) : null}
      </div>
      <div className="context-grid">
        <div>
          <h4>Where you stopped</h4>
          <p>{memory?.reason || "No stopping reason recorded."}</p>
          <h4>Completed features</h4>
          <p>{memory?.completed || "No completed features recorded."}</p>
        </div>
        <div>
          <h4>Blockers and remaining issues</h4>
          <p>
            {active?.data.context.blockers ||
              p.blockers ||
              memory?.issues ||
              "No blockers recorded; confirm before beginning."}
          </p>
          <h4>Setup instructions</h4>
          <p>
            {active?.data.context.setup ||
              memory?.setup ||
              "Setup instructions are missing."}
          </p>
        </div>
      </div>
      {p.progressUpdates?.length ? (
        <details>
          <summary>Recent confirmed development updates</summary>
          {p.progressUpdates
            .slice(-5)
            .reverse()
            .map((u) => (
              <div className="continuation-record" key={u.id}>
                <small>
                  {new Date(u.at).toLocaleString()} · {u.kind}
                </small>
                <p>{u.notes || "Task or file update"}</p>
                {u.commit ? <code>Commit reference: {u.commit}</code> : null}
                {u.fileId ? (
                  <p>
                    <a href={"/api/files/" + u.fileId}>
                      Download selected file snapshot
                    </a>
                  </p>
                ) : null}
              </div>
            ))}
        </details>
      ) : null}
      {r.data?.canEdit === false ? (
        <Notice>
          Viewer access lets you read context. Ask an Owner for Editor access to
          start a session.
        </Notice>
      ) : !active ? (
        <>
          <Readiness project={p} onSaved={() => refresh()} compact />
          <Field label="Task for this session">
            <textarea
              rows={3}
              value={task}
              onChange={(e) => {
                setTask(e.target.value);
                setReviewed(false);
              }}
              maxLength={4000}
            />
          </Field>
          <Field label="Available time">
            <select
              value={minutes}
              onChange={(e) => {
                setMinutes(Number(e.target.value));
                setReviewed(false);
              }}
            >
              <option value={30}>30 minutes</option>
              <option value={120}>2 hours</option>
              <option value={480}>This weekend · 8 hours</option>
              <option value={60}>1 hour</option>
            </select>
          </Field>
          <label className="check-row">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the saved context and readiness results.
          </label>
          <Button
            className="primary"
            busy={a.busy}
            disabled={!reviewed || !task.trim() || !r.data || !p.revival}
            onClick={async () => {
              const id = sessionRequestId || crypto.randomUUID();
              setSessionRequestId(id);
              const result = await a.run(
                () =>
                  api("projects/" + p.id + "/sessions", "POST", {
                    action: "start",
                    id,
                    task,
                    minutes,
                    digest: r.data!.digest,
                    reviewed,
                  }),
                "Guided session started. Hosting is unchanged.",
              );
              if (result) {
                setSessionRequestId("");
                refresh();
              }
            }}
          >
            Start guided session
          </Button>
        </>
      ) : (
        <>
          <div className="section-title">
            <h3>Finish with a clear next step</h3>
          </div>
          <p className="field-hint">
            Review the current project notes below before confirming. Completed
            work is appended to saved features; your remaining issues replace
            the blockers and issue notes. The saved brief is cleared so it can
            be refreshed from this confirmed context.
          </p>
          <details open>
            <summary>Current records that will be updated</summary>
            <p>Completed: {p.memory?.completed || "Not recorded"}</p>
            <p>Issues: {p.memory?.issues || "Not recorded"}</p>
            <p>Next task: {p.nextTask || "Not recorded"}</p>
          </details>
          <Button onClick={() => r.reload()}>
            Reload current context before confirming
          </Button>
          <Field label="Completed during this session">
            <textarea
              rows={3}
              value={completed}
              maxLength={8000}
              onChange={(e) => {
                setCompleted(e.target.value);
                setConfirmed(false);
              }}
            />
          </Field>
          <Field label="Remaining issues and blockers">
            <textarea
              rows={3}
              value={issues}
              maxLength={8000}
              onChange={(e) => {
                setIssues(e.target.value);
                setConfirmed(false);
              }}
            />
          </Field>
          <Field label="Next task after this session">
            <textarea
              rows={3}
              value={nextTask}
              maxLength={4000}
              onChange={(e) => {
                setNextTask(e.target.value);
                setConfirmed(false);
              }}
            />
          </Field>
          <label className="check-row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            These notes accurately describe my work and the next step.
          </label>
          <div className="brief-actions">
            <Button
              className="primary"
              busy={a.busy}
              disabled={!confirmed || !nextTask.trim()}
              onClick={async () => {
                const result = await a.run(
                  () =>
                    api("projects/" + p.id + "/sessions", "POST", {
                      action: "complete",
                      sessionId: active.id,
                      completed,
                      issues,
                      nextTask,
                      confirmed,
                      digest: r.data!.digest,
                    }),
                  "Session completed. Confirmed notes saved.",
                );
                if (result) {
                  setCompletionId(active.id);
                  setCompleted("");
                  setIssues("");
                  setNextTask("");
                  refresh();
                }
              }}
            >
              Confirm and save session
            </Button>
            <Button
              busy={a.busy}
              onClick={async () => {
                if (
                  await a.run(
                    () =>
                      api("projects/" + p.id + "/sessions", "POST", {
                        action: "cancel",
                        sessionId: active.id,
                      }),
                    "Session canceled; memory unchanged.",
                  )
                )
                  refresh();
              }}
            >
              Cancel session
            </Button>
          </div>
        </>
      )}
      {completionId ? (
        <Notice kind="success">
          Your session and next step are saved. Start another session when you
          are ready.
        </Notice>
      ) : null}
      {p.documentation ? (
        <details>
          <summary>Reviewed project documentation</summary>
          <p>{p.documentation}</p>
        </details>
      ) : null}
      {p.taskBreakdown ? (
        <details>
          <summary>Reviewed task breakdown</summary>
          <p>{p.taskBreakdown}</p>
        </details>
      ) : null}
      <details>
        <summary>Session history · {r.data?.sessions.length || 0}</summary>
        {r.data?.sessions
          .filter((s) => s.state !== "active")
          .map((s) => (
            <div className="continuation-record" key={s.id}>
              <strong>{s.data.task}</strong>
              <p>
                {s.state} · {new Date(s.at).toLocaleString()}
              </p>
              <p>{s.data.completed}</p>
              <p>Next: {s.data.nextTask || "Not recorded"}</p>
            </div>
          ))}
      </details>
    </section>
  );
}
function CaptureTool({ project }: { project: Project }) {
  const r = useResource<{
      tokens: {
        id: string;
        name: string;
        expires: number;
        revoked: number;
        last_used: string;
      }[];
    }>("projects/" + project.id + "/capture-tokens"),
    a = useAction();
  const [name, setName] = useState("My development environment"),
    [days, setDays] = useState(90),
    [token, setToken] = useState("");
  return (
    <section className="continuation-tool">
      <h3>Bring progress back from your editor</h3>
      <p>
        Create a capture-only token for this project. Tokens retain your current
        permissions; removing your project access also blocks your tokens.
        Selected files become private snapshots, separate from deployed builds.
      </p>
      <Loading r={r} />
      <Feedback a={a} />
      {project.role === "Viewer" ? (
        <Notice>
          Editor or Owner access is required to create capture tokens.
        </Notice>
      ) : (
        <>
          <Field label="Token label">
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Token expires in days">
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </Field>
          <Button
            busy={a.busy}
            disabled={!name.trim()}
            onClick={async () => {
              const data = await a.run(
                () =>
                  api<{ token: string }>(
                    "projects/" + project.id + "/capture-tokens",
                    "POST",
                    { name, days },
                  ),
                "Capture token created.",
              );
              if (data) {
                setToken(data.token);
                r.reload();
              }
            }}
          >
            Create project capture token
          </Button>
          {token ? (
            <div className="private-token">
              <strong>Copy once · keep this token private</strong>
              <input
                aria-label="New capture token"
                type="password"
                readOnly
                value={token}
              />
              <Button
                onClick={() =>
                  a.run(
                    () => navigator.clipboard.writeText(token),
                    "Token copied.",
                  )
                }
              >
                Copy token
              </Button>
              <Button onClick={() => setToken("")}>Hide token</Button>
            </div>
          ) : null}
        </>
      )}
      <div className="setup-instructions">
        <h4>CLI setup</h4>
        <p>
          Download the standalone CLI or run npm run chapter:cli -- from this
          repository. Requires Node.js 24+. Set CHAPTER_URL, CHAPTER_PROJECT and
          CHAPTER_TOKEN in your shell or ignored local environment file. The
          token is read from the environment and never printed.
        </p>
        <a className="button" href="/chapter-cli.mjs" download>
          Download lightweight CLI
        </a>
        <pre>
          CHAPTER_PROJECT={project.id}
          {"\n"}node chapter-cli.mjs capture --input progress.json --dry-run
          {"\n"}node chapter-cli.mjs capture --input progress.json --reviewed
        </pre>
        <p>
          progress.json uses a unique id, notes, optional commit SHA, nextTask,
          blockers, minutes, and filePaths. Review the dry run before sending.
          Reuse the same id for safe retries. File paths must stay inside the
          current directory. Credentials, customer exports and private contact
          data are rejected.
        </p>
      </div>
      {!r.data?.tokens.length ? (
        <p className="field-hint">
          No capture tokens yet. Create one for your development environment.
        </p>
      ) : (
        r.data.tokens.map((t) => (
          <div className="continuation-record" key={t.id}>
            <strong>{t.name}</strong>
            <p>
              {t.revoked
                ? "Revoked"
                : Date.now() > t.expires
                  ? "Expired"
                  : "Active"}{" "}
              · Expires {new Date(t.expires).toLocaleDateString()} · Last
              capture{" "}
              {t.last_used ? new Date(t.last_used).toLocaleString() : "Never"}
            </p>
            {!t.revoked ? (
              <Button
                busy={a.busy}
                onClick={async () => {
                  if (
                    await a.run(
                      () =>
                        api(
                          "projects/" + project.id + "/capture-tokens",
                          "DELETE",
                          { tokenId: t.id },
                        ),
                      "Token revoked.",
                    )
                  )
                    r.reload();
                }}
              >
                Revoke token
              </Button>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}
function ProposalTool({
  project,
  ai,
  onRefresh,
}: {
  project: Project;
  ai: boolean;
  onRefresh: () => void;
}) {
  const r = useResource<{ proposals: Proposal[] }>(
      "projects/" + project.id + "/proposals",
    ),
    a = useAction();
  const [kind, setKind] = useState("tasks"),
    [useAI, setAI] = useState(ai),
    [selected, setSelected] = useState(""),
    [text, setText] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [job, setJob] = useState("");
  const draft = r.data?.proposals.find((p) => p.id === selected);
  useEffect(() => {
    if (draft?.state === "draft") {
      setText(draft.data.text || "");
      setReviewed(false);
    }
  }, [draft?.id, draft?.state]);
  return (
    <section className="continuation-tool">
      <h3>Propose, review, then apply</h3>
      <p>
        Plans and documents use authorized notes and files. AI selects verified
        excerpts when configured; the editable draft clearly marks missing
        information. Applying saves stored records only.
      </p>
      <Loading r={r} />
      <Feedback a={a} />
      {!ai ? (
        <Notice>
          OpenAI is not configured. Saved-notes proposals work now; AI selection
          becomes available after secure setup.
        </Notice>
      ) : null}
      <Field label="Proposal type">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="tasks">Task breakdown</option>
          <option value="documentation">Documentation update</option>
          <option value="brief">Revised resume brief</option>
        </select>
      </Field>
      <label className="check-row">
        <input
          type="checkbox"
          disabled={!ai}
          checked={useAI && ai}
          onChange={(e) => setAI(e.target.checked)}
        />
        Use AI to select supporting excerpts
      </label>
      <Button
        busy={a.busy}
        disabled={project.role === "Viewer"}
        onClick={async () => {
          const result = await a.run(
            () =>
              api<{ id: string; jobId: string }>(
                "projects/" + project.id + "/proposals",
                "POST",
                {
                  action: "generate",
                  id: crypto.randomUUID(),
                  kind,
                  useAI: useAI && ai,
                },
              ),
            "Proposal queued for review.",
          );
          if (result) {
            setSelected(result.id);
            setJob(result.jobId);
            r.reload();
          }
        }}
      >
        Generate editable proposal
      </Button>
      {job ? (
        <JobStatus
          id={job}
          onFinished={() => {
            setJob("");
            r.reload();
          }}
        />
      ) : null}
      {draft?.state === "draft" ? (
        <div className="proposal-preview">
          <h4>Editable preview · {draft.data.kind}</h4>
          <Notice>
            {draft.data.missing.length
              ? "Missing: " + draft.data.missing.join(", ")
              : "Unrecorded work cannot be confirmed. Review all suggestions."}
          </Notice>
          <textarea
            aria-label="Editable action proposal"
            rows={14}
            value={text}
            maxLength={40000}
            onChange={(e) => {
              setText(e.target.value);
              setReviewed(false);
            }}
          />
          <details>
            <summary>Supporting sources · {draft.data.sources.length}</summary>
            {draft.data.sources.map((s) => (
              <div className="continuation-record" key={s.id}>
                <a href={s.url}>{s.label}</a>
                <p>{s.text}</p>
              </div>
            ))}
          </details>
          <label className="check-row">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed this draft and want to save these stored records.
          </label>
          <Button
            className="primary"
            busy={a.busy}
            disabled={!reviewed || !text.trim()}
            onClick={async () => {
              if (
                await a.run(
                  () =>
                    api("projects/" + project.id + "/proposals", "POST", {
                      action: "apply",
                      proposalId: draft.id,
                      text,
                      reviewed,
                      digest: draft.data.baseDigest,
                    }),
                  "Reviewed proposal saved.",
                )
              ) {
                r.reload();
                onRefresh();
              }
            }}
          >
            Apply reviewed proposal
          </Button>
          <p className="field-hint">
            Code, repository, deployment and hosting changes require separate
            workflows.
          </p>
        </div>
      ) : null}
      <details>
        <summary>Proposal history</summary>
        {r.data?.proposals.map((p) => (
          <div className="continuation-record" key={p.id}>
            <strong>
              {p.kind} · {p.state}
            </strong>
            <p>{new Date(p.at).toLocaleString()}</p>
            {p.state === "draft" ? (
              <Button onClick={() => setSelected(p.id)}>Review draft</Button>
            ) : p.state === "queued" && p.data.jobId ? (
              <Button onClick={() => setJob(p.data.jobId!)}>
                View job and retry
              </Button>
            ) : null}
          </div>
        ))}
      </details>
      {project.taskBreakdown ? (
        <details>
          <summary>Saved task plan</summary>
          <p>{project.taskBreakdown}</p>
        </details>
      ) : null}
      {project.documentation ? (
        <details>
          <summary>Saved documentation</summary>
          <p>{project.documentation}</p>
        </details>
      ) : null}
    </section>
  );
}
function AttentionTool({ onChoose }: { onChoose: (id: string) => void }) {
  const r = useResource<{
      items: AttentionItem[];
      explanation: string;
      updatedAt: string;
    }>("attention"),
    a = useAction(),
    [showAll, setAll] = useState(false);
  const rows = (r.data?.items || []).filter(
    (i) => showAll || i.state === "open",
  );
  async function update(key: string, action: string) {
    if (
      await a.run(
        () => api("attention", "POST", { key, action, hours: 24 }),
        "Inbox preference saved.",
      )
    )
      r.reload();
  }
  return (
    <section className="continuation-tool">
      <h3>Your attention, in one place</h3>
      <p>
        Recorded blockers, failed deployments, returns within seven days, new
        enquiries and integration failures. Archived projects are excluded. Your
        notification preferences apply.
      </p>
      <Loading r={r} />
      <Feedback a={a} />
      <label className="check-row">
        <input
          type="checkbox"
          checked={showAll}
          onChange={(e) => setAll(e.target.checked)}
        />
        Show resolved, snoozed and disabled items
      </label>
      {!rows.length ? (
        <div className="empty-state">
          <h3>No projects need your attention here</h3>
          <p>
            New recorded events appear after refreshing. Check notification
            preferences if an expected item is hidden.
          </p>
        </div>
      ) : (
        rows.map((i) => (
          <article className="attention-card" key={i.key}>
            <div>
              <strong>{i.projectName}</strong>
              <span className="source-kind">
                {i.kind} · {i.state}
                {i.count > 1 ? " · " + i.count + " events" : ""}
              </span>
            </div>
            <p>{i.reason}</p>
            <p className="field-hint">{i.nextStep}</p>
            <small>
              {i.at ? new Date(i.at).toLocaleString() : "Date unavailable"}
              {i.snoozedUntil
                ? " · Snoozed until " +
                  new Date(i.snoozedUntil).toLocaleString()
                : ""}
            </small>
            <div className="brief-actions">
              {i.projectId ? (
                <Button onClick={() => onChoose(i.projectId)}>
                  Open guided context
                </Button>
              ) : null}
              {i.state === "open" ? (
                <>
                  <Button
                    busy={a.busy}
                    onClick={() => update(i.key, "resolve")}
                  >
                    Resolve
                  </Button>
                  <Button busy={a.busy} onClick={() => update(i.key, "snooze")}>
                    Snooze 24h
                  </Button>
                  <Button
                    busy={a.busy}
                    onClick={() => update(i.key, "disable")}
                  >
                    Disable this item
                  </Button>
                </>
              ) : (
                <Button busy={a.busy} onClick={() => update(i.key, "reopen")}>
                  Reopen
                </Button>
              )}
            </div>
          </article>
        ))
      )}
      <p className="field-hint">{r.data?.explanation}</p>
      <Button onClick={r.reload}>Refresh inbox</Button>
    </section>
  );
}
type RequestRow = {
  id: string;
  category: string;
  state: string;
  at: string;
  updated_at: string;
  data: {
    subject: string;
    text: string;
    screenshotId: string;
    diagnostics: object | null;
    theme?: string;
  };
  updates: { id: string; text: string; at: string }[];
};
function FeedbackTool({ admin = false }: { admin?: boolean }) {
  const path = admin ? "feedback-admin" : "feedback",
    r = useResource<{
      requests: RequestRow[];
      categories?: Record<string, number>;
      themes?: Record<string, number>;
    }>(path),
    a = useAction();
  const [subject, setSubject] = useState(""),
    [text, setText] = useState(""),
    [category, setCategory] = useState("Feature request"),
    [diagnostics, setDiagnostics] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [reviewed, setReviewed] = useState(false),
    [requestId, setRequestId] = useState("");
  return (
    <section className="continuation-tool">
      <h3>
        {admin
          ? "Learn from submitted feedback"
          : "Help shape the next chapter"}
      </h3>
      <p>
        {admin
          ? "Restricted to server-configured platform admins. Categorize submitted requests and publish progress updates to the submitting user. Workspace ownership does not grant this access."
          : "Report a problem or suggest an improvement. Your requests and attachments are private to you and platform administrators."}
      </p>
      <Loading r={r} />
      <Feedback a={a} />
      {admin ? (
        r.data?.categories ? (
          <div className="usage-grid">
            {Object.entries(r.data.categories).map(([category, count]) => (
              <div className="usage-tile" key={category}>
                <small>{category}</small>
                <strong>{count}</strong>
                <span>submitted requests</span>
              </div>
            ))}
          </div>
        ) : null
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const id = requestId || crypto.randomUUID();
            setRequestId(id);
            const form = new FormData();
            form.set("id", id);
            form.set("subject", subject);
            form.set("text", text);
            form.set("category", category);
            form.set("diagnostics", String(diagnostics));
            form.set("screenshotReviewed", String(reviewed));
            if (file) form.set("screenshot", file);
            const result = await a.run(
              () => api("feedback", "POST", form),
              "Feedback submitted. You can track it below.",
            );
            if (result) {
              setRequestId("");
              setSubject("");
              setText("");
              setFile(null);
              setReviewed(false);
              r.reload();
            }
          }}
        >
          <Field label="Feedback subject">
            <input
              value={subject}
              maxLength={120}
              required
              onChange={(e) => {
                setSubject(e.target.value);
                setRequestId("");
              }}
            />
          </Field>
          <Field label="Feedback category">
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setRequestId("");
              }}
            >
              {["Bug", "Feature request", "Usability", "Other"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Tell us what happened or what would help">
            <textarea
              rows={4}
              value={text}
              required
              maxLength={4000}
              onChange={(e) => {
                setText(e.target.value);
                setRequestId("");
              }}
            />
          </Field>
          <Field
            label="Optional screenshot"
            hint="PNG, JPEG or WebP, up to 2 MB. Remove credentials and private customer data."
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setReviewed(false);
                setRequestId("");
              }}
            />
          </Field>
          {file ? (
            <label className="check-row">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed the screenshot; it contains no secrets or customer
              data.
            </label>
          ) : null}
          <label className="check-row">
            <input
              type="checkbox"
              checked={diagnostics}
              onChange={(e) => setDiagnostics(e.target.checked)}
            />
            Include limited diagnostics: app phase, received time and
            mobile/desktop client family.
          </label>
          <p className="field-hint">
            Diagnostics exclude URLs, source files, project notes, provider
            tokens and browser logs. Screenshot storage counts against your
            personal workspace storage limit.
          </p>
          <Button
            type="submit"
            className="primary"
            busy={a.busy}
            disabled={!!file && !reviewed}
          >
            Submit feedback
          </Button>
        </form>
      )}
      {admin && r.data?.themes ? (
        <div>
          <h4>Recurring problems by reviewed theme</h4>
          <p className="field-hint">
            Counts come from tags assigned by administrators, with no inferred
            success scores.
          </p>
          {Object.entries(r.data.themes).map(([theme, count]) => (
            <p key={theme}>
              {theme}: {count} submitted requests
            </p>
          ))}
        </div>
      ) : null}
      {admin ? <InsightsTool admin /> : null}
      <h4>{admin ? "Requests to review" : "Your submitted requests"}</h4>
      {!r.data?.requests.length ? (
        <p className="field-hint">No requests submitted yet.</p>
      ) : (
        r.data.requests.map((row) => (
          <FeedbackRow
            key={row.id}
            row={row}
            admin={admin}
            onSaved={r.reload}
          />
        ))
      )}
    </section>
  );
}
function FeedbackRow({
  row,
  admin,
  onSaved,
}: {
  row: RequestRow;
  admin: boolean;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState(row.category),
    [state, setState] = useState(row.state),
    [update, setUpdate] = useState(""),
    [publish, setPublish] = useState(false),
    [theme, setTheme] = useState(row.data.theme || ""),
    a = useAction();
  return (
    <article className="continuation-record">
      <strong>{row.data.subject}</strong>
      <p>
        {row.category} · {row.state} · Updated{" "}
        {new Date(row.updated_at).toLocaleString()}
      </p>
      <p>{row.data.text}</p>
      {row.data.screenshotId ? (
        <a
          href={
            "/api/" +
            (admin ? "feedback-admin" : "feedback") +
            "/" +
            row.id +
            "/screenshot"
          }
          target="_blank"
          rel="noreferrer"
        >
          View private screenshot
        </a>
      ) : null}
      {row.data.diagnostics ? (
        <details>
          <summary>Consented diagnostics</summary>
          <pre>{JSON.stringify(row.data.diagnostics, null, 2)}</pre>
        </details>
      ) : null}
      {row.updates.map((u) => (
        <div key={u.id}>
          <small>{new Date(u.at).toLocaleString()}</small>
          <p>{u.text}</p>
        </div>
      ))}
      {admin ? (
        <div className="admin-feedback">
          <Feedback a={a} />
          <Field label="Admin category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {["Bug", "Feature request", "Usability", "Other"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Request status">
            <select value={state} onChange={(e) => setState(e.target.value)}>
              {["Submitted", "Reviewing", "Planned", "Shipped", "Closed"].map(
                (s) => (
                  <option key={s}>{s}</option>
                ),
              )}
            </select>
          </Field>
          <Field
            label="Problem theme"
            hint="Use the same short tag for requests about the same problem."
          >
            <input
              value={theme}
              maxLength={80}
              onChange={(e) => setTheme(e.target.value)}
            />
          </Field>
          <Field label="Progress update">
            <textarea
              rows={2}
              value={update}
              maxLength={2000}
              onChange={(e) => setUpdate(e.target.value)}
            />
          </Field>
          <label className="check-row">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
            />
            Publish this update to the submitting user
          </label>
          <Button
            busy={a.busy}
            onClick={async () => {
              if (
                await a.run(
                  () =>
                    api("feedback-admin/" + row.id, "PATCH", {
                      category,
                      state,
                      update,
                      publish,
                      theme,
                    }),
                  "Feedback updated.",
                )
              ) {
                setUpdate("");
                onSaved();
              }
            }}
          >
            Save feedback update
          </Button>
        </div>
      ) : null}
    </article>
  );
}
function InsightsTool({ admin = false }: { admin?: boolean } = {}) {
  const r = useResource<{
    counts: { action: string; completed: number; failed: number }[];
    importingUsers: number;
    importersWithShare: number;
    importersWithoutShare: number;
    repeatUsers: number;
    activeUsers: number;
    source: string;
    definition: string;
    measuredSince: string | null;
    updatedAt: string;
  }>(admin ? "feedback-admin/usage" : "insights");
  return (
    <section className="continuation-tool">
      <h3>Usage backed by completed actions</h3>
      <p>
        Workspace Owners can view their workspace aggregates. Connected hosting
        charges and revenue are separate.
      </p>
      <Loading r={r} />
      {r.data ? (
        <>
          <div className="usage-grid">
            {r.data.counts.map((c) => (
              <div className="usage-tile" key={c.action}>
                <small>{c.action.replaceAll("_", " ")}</small>
                <strong>{c.completed}</strong>
                <span>completed · {c.failed} failed attempts</span>
              </div>
            ))}
          </div>
          <div className="context-grid">
            <div>
              <h4>Import → first share</h4>
              <p>
                {r.data.importingUsers} users imported ·{" "}
                {r.data.importersWithShare} shared ·{" "}
                {r.data.importersWithoutShare} have no recorded share
              </p>
            </div>
            <div>
              <h4>Returning usage</h4>
              <p>
                {r.data.repeatUsers} of {r.data.activeUsers} active users
                completed actions on multiple days.
              </p>
            </div>
          </div>
          <p className="field-hint">{r.data.definition}</p>
          <p>
            <strong>Source:</strong> {r.data.source}
          </p>
          <p className="field-hint">
            Measured since{" "}
            {r.data.measuredSince
              ? new Date(r.data.measuredSince).toLocaleString()
              : "no events yet"}{" "}
            · Updated {new Date(r.data.updatedAt).toLocaleString()}
          </p>
        </>
      ) : null}
    </section>
  );
}
