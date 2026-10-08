"use client";
import { useEffect, useState } from "react";
import {
  Users,
  BookOpen,
  Boxes,
  History,
  BarChart3,
  CreditCard,
  Bell,
  ArrowRight,
  Copy,
  Check,
} from "lucide-react";
import { Panel, Button, Field, Notice, api } from "./ui";
import type { Workspace, Project } from "@/lib/types";
import type { MemorySource } from "@/lib/knowledge";
import type { HandoverPreview } from "@/lib/phase-two";
import type { Plan } from "@/lib/billing";

export const knowledgeTools = [
  { id: "team", label: "Team workspace", Icon: Users },
  { id: "memory", label: "Project memory", Icon: BookOpen },
  { id: "starters", label: "Private starters", Icon: Boxes },
  { id: "portfolio", label: "Portfolio overview", Icon: BarChart3 },
  { id: "billing", label: "Billing & usage", Icon: CreditCard },
  { id: "notifications", label: "Notifications", Icon: Bell },
] as const;
export type KnowledgeTool = (typeof knowledgeTools)[number]["id"] | "project";
function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api<T>(path)
      .then((r) => {
        if (live) setData(r);
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
  return { data, error, loading, reload: () => setRevision((r) => r + 1) };
}
function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function run<T>(fn: () => Promise<T>, success = "Saved") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await fn();
      setMessage(success);
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, message, run };
}
function Feedback({ a }: { a: ReturnType<typeof useAction> }) {
  return (
    <>
      <Notice kind="error">{a.error}</Notice>
      <Notice kind="success">{a.message}</Notice>
    </>
  );
}
function Loading({
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
export function KnowledgePanel({
  kind,
  workspace,
  owner,
  project,
  onClose,
  onRefresh,
  onSaved,
  onOpenProject,
}: {
  kind: KnowledgeTool;
  workspace: Workspace;
  owner: string;
  project?: Project;
  onClose: () => void;
  onRefresh: () => void;
  onSaved: (p: Project, message?: string) => void;
  onOpenProject: (p: Project) => void;
}) {
  const [tab, setTab] = useState("Collaboration");
  return (
    <Panel
      title={
        kind === "project"
          ? `${project?.name} · Project records`
          : knowledgeTools.find((t) => t.id === kind)?.label || "Workspace"
      }
      subtitle={
        kind === "project"
          ? "Work together and keep reusable knowledge close."
          : "Keep every project ready for its next chapter."
      }
      onClose={onClose}
      wide
    >
      {!workspace.user ? (
        <div className="empty-state">
          <h3>Sign in to your workspace</h3>
          <p>Team invitations require the invited email address.</p>
          <a className="button primary" href="/login">
            Sign in
          </a>
        </div>
      ) : (
        <div className="phase-three-content">
          {kind === "team" ? (
            <TeamPanel
              workspace={workspace}
              owner={owner}
              onRefresh={onRefresh}
            />
          ) : null}
          {kind === "memory" ? (
            <MemoryPanel
              owner={owner}
              onOpenProject={(id) => {
                const p = workspace.projects.find((p) => p.id === id);
                if (p) onOpenProject(p);
              }}
            />
          ) : null}
          {kind === "starters" ? (
            <StarterLibrary workspace={workspace} onSaved={onSaved} />
          ) : null}
          {kind === "portfolio" ? (
            <Portfolio
              owner={owner}
              onOpenProject={(id) => {
                const p = workspace.projects.find((p) => p.id === id);
                if (p) onOpenProject(p);
              }}
            />
          ) : null}
          {kind === "billing" ? (
            <Billing owner={owner} userId={workspace.user.id} />
          ) : null}
          {kind === "notifications" ? (
            <Notifications
              onOpenProject={(id) => {
                const p = workspace.projects.find((p) => p.id === id);
                if (p) onOpenProject(p);
              }}
            />
          ) : null}
          {kind === "project" && project ? (
            <>
              <div
                className="lifecycle-tabs"
                role="tablist"
                aria-label="Project records"
              >
                {["Collaboration", "Versions", "Create starter"].map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {tab === "Collaboration" ? (
                <Collaboration
                  project={project}
                  userId={workspace.user.id}
                  onSaved={onSaved}
                />
              ) : tab === "Versions" ? (
                <Versions project={project} onSaved={onSaved} />
              ) : (
                <StarterMaker project={project} />
              )}
            </>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
type Member = {
  id: string;
  name: string;
  email: string;
  role: "Owner" | "Editor" | "Viewer";
  scope: string[] | null;
  primary: boolean;
};
function TeamPanel({
  workspace,
  owner,
  onRefresh,
}: {
  workspace: Workspace;
  owner: string;
  onRefresh: () => void;
}) {
  const r = useResource<{
      members: Member[];
      invitations: {
        email: string;
        role: string;
        state: string;
        expires: number;
      }[];
      name: string;
    }>(`teams/${owner}`),
    a = useAction();
  const [email, setEmail] = useState(""),
    [role, setRole] = useState<Member["role"]>("Editor"),
    [selectedOnly, setSelectedOnly] = useState(false),
    [ids, setIds] = useState<string[]>([]),
    [link, setLink] = useState(""),
    [editing, setEditing] = useState<Member | null>(null),
    [invite, setInvite] = useState("");
  useEffect(() => {
    setInvite(new URL(window.location.href).searchParams.get("invite") || "");
  }, []);
  const projects = workspace.projects.filter((p) => p.workspaceOwner === owner),
    isOwner =
      workspace.workspaces?.find((w) => w.id === owner)?.role === "Owner";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = await a.run(
      () =>
        editing
          ? api(`teams/${owner}/member`, "PATCH", {
              userId: editing.id,
              role,
              scope: selectedOnly ? ids : null,
            })
          : api<{ link: string }>(`teams/${owner}/invite`, "POST", {
              email,
              role,
              scope: selectedOnly ? ids : null,
            }),
      editing
        ? "Access updated"
        : "Invitation ready. Send the link to the invited email.",
    );
    if (result) {
      if ("link" in result)
        setLink(new URL(String(result.link), window.location.origin).href);
      setEditing(null);
      r.reload();
      onRefresh();
    }
  }
  return (
    <>
      <div className="knowledge-callout">
        <strong>Invite with a private link</strong>
        <p>
          Owners manage sharing, hosting and access. Editors update projects and
          stored records. Viewers read authorized files and add comments. Each
          invitation can cover all projects or selected projects. Only the
          primary Owner manages billing.
        </p>
      </div>
      <Feedback a={a} />
      <Loading r={r} />
      {isOwner ? (
        <>
          <form onSubmit={submit} className="knowledge-form">
            <Field
              label={editing ? "Editing collaborator" : "Collaborator email"}
            >
              <input
                type="email"
                required
                value={editing?.email || email}
                disabled={!!editing}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Role">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Member["role"])}
              >
                {["Owner", "Editor", "Viewer"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <label className="option-check">
              <input
                type="checkbox"
                checked={selectedOnly}
                onChange={(e) => setSelectedOnly(e.target.checked)}
              />{" "}
              Limit to selected projects
            </label>
            {selectedOnly ? (
              <div className="selection-list">
                {projects.length ? (
                  projects.map((p) => (
                    <label className="option-check" key={p.id}>
                      <input
                        type="checkbox"
                        checked={ids.includes(p.id)}
                        onChange={(e) =>
                          setIds((s) =>
                            e.target.checked
                              ? [...s, p.id]
                              : s.filter((id) => id !== p.id),
                          )
                        }
                      />
                      {p.name}
                    </label>
                  ))
                ) : (
                  <p>No projects to grant yet.</p>
                )}
              </div>
            ) : null}
            <div className="button-row">
              <Button className="primary" type="submit" busy={a.busy}>
                {editing ? "Save access" : "Create invitation"}
              </Button>
              {editing ? (
                <Button type="button" onClick={() => setEditing(null)}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </form>
          {link ? (
            <div className="copy-link">
              <input aria-label="Invitation link" readOnly value={link} />
              <Button
                onClick={() =>
                  a.run(
                    () => navigator.clipboard.writeText(link),
                    "Invitation link copied",
                  )
                }
              >
                <Copy size={15} /> Copy invitation
              </Button>
            </div>
          ) : null}
          <h3>Workspace members</h3>
          <div className="knowledge-list">
            {r.data?.members.map((m) => (
              <div className="knowledge-row" key={m.id}>
                <div>
                  <strong>{m.name}</strong>
                  <small>
                    {m.email} · {m.role} ·{" "}
                    {m.scope
                      ? `${m.scope.length} selected projects`
                      : "All projects"}
                    {m.primary ? " · Billing owner" : ""}
                  </small>
                </div>
                {!m.primary ? (
                  <div className="button-row">
                    <Button
                      onClick={() => {
                        setEditing(m);
                        setRole(m.role);
                        setSelectedOnly(!!m.scope);
                        setIds(m.scope || []);
                      }}
                    >
                      Edit access
                    </Button>
                    <Button
                      busy={a.busy}
                      onClick={() =>
                        a.run(async () => {
                          await api(`teams/${owner}/member`, "DELETE", {
                            userId: m.id,
                          });
                          r.reload();
                          onRefresh();
                        }, "Access revoked")
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {r.data?.invitations.length ? (
            <>
              <h3>Invitations</h3>
              {r.data.invitations.map((i, n) => (
                <div className="knowledge-row" key={`${i.email}:${n}`}>
                  <div>
                    <strong>{i.email}</strong>
                    <small>
                      {i.role} · {i.state} · expires{" "}
                      {new Date(i.expires).toLocaleDateString()}
                    </small>
                  </div>
                  {i.state === "pending" ? (
                    <Button
                      busy={a.busy}
                      onClick={() =>
                        a.run(async () => {
                          await api(`teams/${owner}/revoke`, "POST", {
                            email: i.email,
                          });
                          r.reload();
                        }, "Invitation revoked")
                      }
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}
        </>
      ) : (
        <p className="field-hint">
          Ask a workspace Owner to manage collaborator access.
        </p>
      )}
      <form
        className="knowledge-form"
        onSubmit={(e) => {
          e.preventDefault();
          let token = invite;
          try {
            token = new URL(invite).searchParams.get("invite") || invite;
          } catch {}
          void a.run(async () => {
            await api("teams/accept", "POST", { token });
            onRefresh();
          }, "Invitation accepted. Choose the team in your workspace selector.");
        }}
      >
        <Field
          label="Accept an invitation"
          hint="Sign in with the invited email, then paste the link or token."
        >
          <input
            required
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
          />
        </Field>
        <Button busy={a.busy}>Accept invitation</Button>
      </form>
    </>
  );
}
type Job = {
  id: string;
  kind: string;
  state: string;
  attempts: number;
  error: string;
  nextRun: number;
  result: {
    kind: string;
    sources: MemorySource[];
    missing: string;
    setup?: string;
  } | null;
};
function MemoryPanel({
  owner,
  onOpenProject,
}: {
  owner: string;
  onOpenProject: (id: string) => void;
}) {
  const [question, setQuestion] = useState("Where did I stop?"),
    [useAI, setUseAI] = useState(true),
    [job, setJob] = useState<Job | null>(null),
    a = useAction();
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.state)) return;
    let live = true;
    const timer = setTimeout(() => {
      api<{ job: Job }>(`jobs/${job.id}`)
        .then((r) => {
          if (live) setJob(r.job);
        })
        .catch((e) => {
          if (live)
            setJob((j) =>
              j ? { ...j, state: "failed", error: e.message } : null,
            );
        });
    }, 1500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [job]);
  return (
    <>
      <div className="knowledge-callout">
        <strong>Your notes, with references</strong>
        <p>
          Search purpose, completed features, next tasks, blockers, setup,
          briefs and eligible text files from projects you can access in this
          workspace. AI selects exact supporting excerpts and marks missing
          information.
        </p>
      </div>
      <Feedback a={a} />
      <form
        className="knowledge-form"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            const result = await api<{ jobId: string }>("memory", "POST", {
              question,
              useAI,
            });
            setJob({
              id: result.jobId,
              kind: "memory",
              state: "queued",
              attempts: 0,
              error: "",
              nextRun: 0,
              result: null,
            });
          }, "Search started");
        }}
      >
        <Field label="Ask your project memory">
          <input
            required
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Which project already has file uploads?"
          />
        </Field>
        <label className="option-check">
          <input
            type="checkbox"
            checked={useAI}
            onChange={(e) => setUseAI(e.target.checked)}
          />{" "}
          Use AI when configured
        </label>
        <Button className="primary" busy={a.busy}>
          Search memory
        </Button>
      </form>
      {job ? (
        <>
          <p className="field-hint" role="status">
            Background job: {job.state} · {job.attempts} attempt
            {job.attempts === 1 ? "" : "s"}
          </p>
          <Notice kind="error">{job.error}</Notice>
          {job.state === "failed" ? (
            <Button
              onClick={() =>
                a.run(async () => {
                  await api(`jobs/${job.id}/retry`, "POST");
                  setJob({ ...job, state: "queued", error: "" });
                }, "Retry queued")
              }
            >
              Retry job
            </Button>
          ) : null}
          {job.state === "queued" ? (
            <Button
              onClick={() =>
                a.run(() => api(`jobs/${job.id}/run`, "POST"), "Worker checked")
              }
            >
              Run pending work now
            </Button>
          ) : null}
          {job.result ? (
            <>
              <h3>{job.result.kind}</h3>
              <p className="field-hint">{job.result.missing}</p>
              {job.result.setup ? <Notice>{job.result.setup}</Notice> : null}
              <div className="knowledge-list">
                {job.result.sources.map((s, n) => (
                  <article className="memory-result" key={`${s.id}:${n}`}>
                    <div className="knowledge-row">
                      <button
                        className="text-link"
                        onClick={() => onOpenProject(s.projectId)}
                      >
                        {s.projectName} · {s.label}
                      </button>
                      <small>{new Date(s.at).toLocaleString()}</small>
                    </div>
                    <p>{s.text}</p>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      Open supporting{" "}
                      {s.label.startsWith("File:") ? "file" : "project notes"} ↗
                    </a>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <p className="field-hint">
          Try “Where did I stop?” or search for a feature you remember building.
        </p>
      )}
    </>
  );
}
function Collaboration({
  project: p,
  userId,
  onSaved,
}: {
  project: Project;
  userId: string;
  onSaved: (p: Project, message?: string) => void;
}) {
  const comments = useResource<{
      comments: {
        id: string;
        text: string;
        name: string;
        actor: string;
        at: string;
      }[];
    }>(`projects/${p.id}/comments`),
    people = useResource<{
      members: { id: string; name: string; role: string }[];
    }>(`projects/${p.id}/collaborators`),
    a = useAction(),
    [text, setText] = useState(""),
    [assignee, setAssignee] = useState(p.assigneeId || "");
  return (
    <>
      <Feedback a={a} />
      <div className="knowledge-callout">
        <strong>Your access: {p.role || "Owner"}</strong>
        <p>Next task: {p.nextTask || p.memory?.nextTask || "Not recorded"}</p>
        {p.setupChecklist?.length ? (
          <details>
            <summary>Starter setup checklist</summary>
            <ul>
              {p.setupChecklist.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <Loading r={people} />
      {p.role !== "Viewer" ? (
        <form
          className="knowledge-form"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              const r = await api<{ project: Project }>(
                `projects/${p.id}/assignment`,
                "POST",
                { assigneeId: assignee },
              );
              onSaved(r.project, "Task assignment saved");
            });
          }}
        >
          <Field label="Assign the next task">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Unassigned</option>
              {people.data?.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.role}
                </option>
              ))}
            </select>
          </Field>
          <Button busy={a.busy}>Save assignment</Button>
        </form>
      ) : null}
      <h3>Project discussion</h3>
      <form
        className="knowledge-form"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            await api(`projects/${p.id}/comments`, "POST", { text });
            setText("");
            comments.reload();
          }, "Comment saved");
        }}
      >
        <Field label="Add a comment">
          <textarea
            required
            maxLength={4000}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Button busy={a.busy}>Post comment</Button>
      </form>
      <Loading r={comments} />
      {!comments.loading && !comments.data?.comments.length ? (
        <p className="field-hint">
          Start a discussion. Comments stay inside this project's authorized
          workspace.
        </p>
      ) : null}
      {comments.data?.comments.map((c) => (
        <article className="memory-result" key={c.id}>
          <strong>{c.name}</strong>
          <small> · {new Date(c.at).toLocaleString()}</small>
          <p>{c.text}</p>
          {c.actor === userId || p.role === "Owner" ? (
            <Button
              onClick={() =>
                a.run(async () => {
                  await api(`projects/${p.id}/comments`, "DELETE", {
                    commentId: c.id,
                  });
                  comments.reload();
                }, "Comment removed")
              }
            >
              Remove comment
            </Button>
          ) : null}
        </article>
      ))}
    </>
  );
}
type Version = {
  id: string;
  kind: string;
  at: string;
  data: Record<string, unknown>;
};
function Versions({
  project: p,
  onSaved,
}: {
  project: Project;
  onSaved: (p: Project, message?: string) => void;
}) {
  const r = useResource<{
      versions: Version[];
      current: Record<string, unknown>;
    }>(`projects/${p.id}/versions`),
    a = useAction(),
    [selected, setSelected] = useState(""),
    [preview, setPreview] = useState<{
      kind: string;
      before: unknown;
      after: unknown;
      digest: string;
      message: string;
    } | null>(null),
    [reviewed, setReviewed] = useState(false);
  return (
    <>
      <div className="knowledge-callout">
        <History size={20} />
        <strong>Stored records have their own history</strong>
        <p>
          Changes to notes, resume briefs and uploaded source packages are saved
          as versions. Restoring them changes Chapter's records only.
        </p>
      </div>
      <Feedback a={a} />
      <Loading r={r} />
      {r.data?.versions.length ? (
        <>
          <Field label="Choose a stored version">
            <select
              value={selected}
              onChange={(e) => {
                const id = e.target.value;
                setSelected(id);
                setReviewed(false);
                setPreview(null);
                if (id)
                  void a.run(async () => {
                    const result = await api<{
                      preview: NonNullable<typeof preview>;
                    }>(`projects/${p.id}/restore-preview`, "POST", {
                      versionId: id,
                    });
                    setPreview(result.preview);
                  }, "Comparison ready");
              }}
            >
              <option value="">Select a version</option>
              {r.data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.kind} · {new Date(v.at).toLocaleString()} ·{" "}
                  {v.id.slice(0, 6)}
                </option>
              ))}
            </select>
          </Field>
          {preview ? (
            <>
              <div className="record-diff">
                <div>
                  <h4>Current stored record</h4>
                  <pre>{JSON.stringify(preview.before, null, 2)}</pre>
                </div>
                <div>
                  <h4>Selected version</h4>
                  <pre>{JSON.stringify(preview.after, null, 2)}</pre>
                </div>
              </div>
              <p className="field-hint">{preview.message}</p>
              {p.role !== "Viewer" ? (
                <>
                  <label className="option-check">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />{" "}
                    I reviewed these changes and want to restore this stored
                    record.
                  </label>
                  <Button
                    className="primary"
                    busy={a.busy}
                    disabled={!reviewed}
                    onClick={() =>
                      a.run(async () => {
                        const result = await api<{ project: Project }>(
                          `projects/${p.id}/restore`,
                          "POST",
                          {
                            versionId: selected,
                            reviewed,
                            digest: preview.digest,
                          },
                        );
                        onSaved(
                          result.project,
                          "Stored records restored; external services unchanged",
                        );
                        r.reload();
                        setPreview(null);
                        setSelected("");
                      }, "Stored record restored")
                    }
                  >
                    Restore reviewed record
                  </Button>
                </>
              ) : null}
            </>
          ) : null}
        </>
      ) : !r.loading ? (
        <p className="field-hint">
          No versions yet. Update parked notes, edit a brief or upload a source
          package to start a history.
        </p>
      ) : null}
    </>
  );
}
type StarterPreview = HandoverPreview & {
  documentation: string;
  checklist: string[];
};
function StarterMaker({ project: p }: { project: Project }) {
  const a = useAction(),
    [name, setName] = useState(`${p.name} starter`),
    [paths, setPaths] = useState<string[]>([]),
    [preview, setPreview] = useState<StarterPreview | null>(null),
    [reviewed, setReviewed] = useState(false);
  async function review() {
    const r = await a.run(
      () =>
        api<{ preview: StarterPreview }>(
          `projects/${p.id}/template-preview`,
          "POST",
          { name, paths },
        ),
      "Review each included file and the setup document",
    );
    if (r) {
      setPreview(r.preview);
      setReviewed(false);
    }
  }
  if (p.role && p.role !== "Owner")
    return (
      <p className="field-hint">
        An Owner can turn this project's reviewed files into a private starter.
      </p>
    );
  return (
    <>
      <div className="knowledge-callout">
        <Boxes size={20} />
        <strong>Create a private, reusable starting point</strong>
        <p>
          Select code and documentation. Credentials, customer exports and
          unsupported assets are excluded. Review every included file before
          saving.
        </p>
      </div>
      <Feedback a={a} />
      <Field label="Starter name">
        <input
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setPreview(null);
            setReviewed(false);
          }}
        />
      </Field>
      <Button busy={a.busy} onClick={review}>
        Load files & review
      </Button>
      {preview ? (
        <>
          <h3>Select files</h3>
          <div className="selection-list">
            {preview.paths.map((path) => (
              <label className="option-check" key={path}>
                <input
                  type="checkbox"
                  checked={paths.includes(path)}
                  onChange={(e) => {
                    setPaths((s) =>
                      e.target.checked
                        ? [...s, path]
                        : s.filter((p) => p !== path),
                    );
                    setReviewed(false);
                  }}
                />
                {path}
              </label>
            ))}
          </div>
          <p className="field-hint">
            {preview.excluded.length} private or unsupported files excluded.{" "}
            {preview.files.length} files in the current preview.
          </p>
          <Button busy={a.busy} onClick={review}>
            Refresh selected file preview
          </Button>
          <details open>
            <summary>Starter setup document</summary>
            <pre className="review-text">{preview.documentation}</pre>
          </details>
          {preview.files.map((f) => (
            <details key={f.path}>
              <summary>
                {f.path} · {f.size} bytes
              </summary>
              <pre className="review-text">{f.content}</pre>
            </details>
          ))}
          <label className="option-check">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={
                JSON.stringify([...paths].sort()) !==
                JSON.stringify(preview.files.map((f) => f.path).sort())
              }
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I reviewed all selected files and documentation; credentials and
            customer data are excluded.
          </label>
          <Button
            className="primary"
            busy={a.busy}
            disabled={!reviewed}
            onClick={() =>
              a.run(async () => {
                await api(`projects/${p.id}/template-create`, "POST", {
                  name,
                  paths,
                  reviewed,
                  digest: preview.digest,
                });
                setReviewed(false);
              }, "Private starter saved. Find it under Private starters.")
            }
          >
            Save private starter
          </Button>
        </>
      ) : null}
    </>
  );
}
type Starter = {
  id: string;
  name: string;
  at: string;
  files: { path: string; content: string }[];
  documentation: string;
  checklist: string[];
  digest: string;
};
function StarterLibrary({
  workspace,
  onSaved,
}: {
  workspace: Workspace;
  onSaved: (p: Project, message?: string) => void;
}) {
  const r = useResource<{ templates: Pick<Starter, "id" | "name" | "at">[] }>(
      "templates",
    ),
    a = useAction(),
    [starter, setStarter] = useState<Starter | null>(null),
    [name, setName] = useState(""),
    [reviewed, setReviewed] = useState(false);
  return (
    <>
      <div className="knowledge-callout">
        <strong>Your private starters</strong>
        <p>
          Open a project → Collaboration & records → Create starter. Each
          starter creates an independent project with new files and a setup
          checklist. No hosting or repository connection is copied.
        </p>
      </div>
      <Feedback a={a} />
      <Loading r={r} />
      {!r.loading && !r.data?.templates.length ? (
        <p className="field-hint">
          No private starters yet. Review selected code and documentation from
          one of your projects to create one.
        </p>
      ) : null}
      {r.data?.templates.map((t) => (
        <div className="knowledge-row" key={t.id}>
          <div>
            <strong>{t.name}</strong>
            <small>Saved {new Date(t.at).toLocaleString()}</small>
          </div>
          <div className="button-row">
            <Button
              onClick={() =>
                a.run(async () => {
                  const result = await api<{ template: Starter }>(
                    `templates/${t.id}`,
                  );
                  setStarter(result.template);
                  setName(`${t.name} project`);
                  setReviewed(false);
                }, "Review starter contents")
              }
            >
              Review & use
            </Button>
            <Button
              onClick={() =>
                a.run(async () => {
                  await api(`templates/${t.id}`, "DELETE");
                  if (starter?.id === t.id) setStarter(null);
                  r.reload();
                }, "Starter removed")
              }
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      {starter ? (
        <>
          <h3>{starter.name}</h3>
          <pre className="review-text">{starter.documentation}</pre>
          {starter.files.map((f) => (
            <details key={f.path}>
              <summary>{f.path}</summary>
              <pre className="review-text">{f.content}</pre>
            </details>
          ))}
          <Field label="New independent project name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <label className="option-check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I reviewed this starter's files and configuration placeholders.
          </label>
          <Button
            className="primary"
            busy={a.busy}
            disabled={!reviewed || !name.trim()}
            onClick={() =>
              a.run(async () => {
                const result = await api<{ project: Project }>(
                  `templates/${starter.id}/use`,
                  "POST",
                  { name, reviewed, digest: starter.digest },
                );
                onSaved(result.project, "Independent starter project created");
                setStarter(null);
              }, "Project created with a setup checklist")
            }
          >
            Create independent project
          </Button>
        </>
      ) : null}
    </>
  );
}
type PortfolioEntry = {
  id: string;
  name: string;
  status: string;
  workspaceOwner: string;
  updatedAt: string;
  interestUpdatedAt: string | null;
  costs: Record<string, number>;
  nextTask: string;
  taskMinutes: number | null;
  returnDate: string | null;
  interest: { visit: number; signup: number; enquiry: number };
  previousInterest: { visit: number; signup: number; enquiry: number };
  expenses: { origin: string }[];
  source: string;
};
function Portfolio({
  owner,
  onOpenProject,
}: {
  owner: string;
  onOpenProject: (id: string) => void;
}) {
  const [days, setDays] = useState(30),
    [status, setStatus] = useState("All"),
    [compare, setCompare] = useState<string[]>([]),
    r = useResource<{
      entries: PortfolioEntry[];
      activity: { id: string; text: string; at: string; projectId?: string }[];
      observedAt: string;
      days: number;
    }>(`portfolio?days=${days}`);
  const entries = (r.data?.entries || []).filter(
    (p) =>
      p.workspaceOwner === owner &&
      (status === "All" || p.status === status) &&
      (!compare.length || compare.includes(p.id)),
  );
  return (
    <>
      <div className="knowledge-callout">
        <strong>A portfolio built from recorded facts</strong>
        <p>
          Interest counts cover the selected period. Costs are recorded monthly
          equivalents in each currency; manual estimates stay labeled. Connected
          hosting bills are separate from Chapter subscriptions.
        </p>
      </div>
      <div className="knowledge-filters">
        <Field label="Interest & activity period">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[7, 30, 90, 365].map((n) => (
              <option key={n} value={n}>
                Last {n} days
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {["All", "Idea", "Building", "Live", "Parked", "Archived"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
        </Field>
      </div>
      <Loading r={r} />
      <details>
        <summary>Compare selected projects ({compare.length || "all"})</summary>
        <div className="selection-list">
          {r.data?.entries
            .filter((p) => p.workspaceOwner === owner)
            .map((p) => (
              <label className="option-check" key={p.id}>
                <input
                  type="checkbox"
                  checked={compare.includes(p.id)}
                  onChange={(e) =>
                    setCompare((s) =>
                      e.target.checked
                        ? [...s, p.id]
                        : s.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
        </div>
      </details>
      {r.data ? (
        <p className="field-hint">
          Observed {new Date(r.data.observedAt).toLocaleString()}. Open a
          project for the source costs, interest and task notes.
        </p>
      ) : null}
      <div className="portfolio-table-wrap">
        <table className="portfolio-table">
          <thead>
            <tr>
              <th>Project & source</th>
              <th>Recorded cost / month</th>
              <th>Visits</th>
              <th>Signups</th>
              <th>Enquiries</th>
              <th>Upcoming task</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((p) => (
              <tr key={p.id}>
                <td>
                  <button
                    className="text-link"
                    onClick={() => onOpenProject(p.id)}
                  >
                    {p.name}
                  </button>
                  <small>
                    {p.status} · Updated{" "}
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </small>
                </td>
                <td>
                  {Object.entries(p.costs).length ? (
                    Object.entries(p.costs).map(([c, n]) => (
                      <span key={c}>
                        {c} {n.toFixed(2)}
                        <small>
                          {p.expenses.every(
                            (e) => e.origin === "Manual estimate",
                          )
                            ? "Manual estimates"
                            : "Recorded billing / estimates"}{" "}
                          · source: Costs
                        </small>
                      </span>
                    ))
                  ) : (
                    <small>No costs recorded</small>
                  )}
                </td>
                <td>{p.interest.visit}</td>
                <td>
                  {p.interest.signup}
                  <small>
                    Previous period: {p.previousInterest.signup} · Change{" "}
                    {p.interest.signup - p.previousInterest.signup >= 0
                      ? "+"
                      : ""}
                    {p.interest.signup - p.previousInterest.signup}
                  </small>
                </td>
                <td>
                  {p.interest.enquiry}
                  <small>
                    {p.interestUpdatedAt
                      ? `Last interest ${new Date(p.interestUpdatedAt).toLocaleDateString()}`
                      : "No interest in period"}
                  </small>
                </td>
                <td>
                  {p.nextTask || "Not recorded"}
                  <small>
                    {p.taskMinutes
                      ? `${p.taskMinutes} minutes estimated`
                      : "Time not estimated"}
                    {p.returnDate ? ` · Return ${p.returnDate}` : ""}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!r.loading && !entries.length ? (
        <p className="field-hint">
          No projects match these filters. Add a project or broaden your
          comparison.
        </p>
      ) : null}
      <h3>Recent project activity</h3>
      {r.data?.activity
        .filter((a) => entries.some((p) => p.id === a.projectId))
        .slice(0, 12)
        .map((a) => (
          <div className="knowledge-row" key={a.id}>
            <button
              className="text-link"
              onClick={() => a.projectId && onOpenProject(a.projectId)}
            >
              {a.text}
            </button>
            <small>{new Date(a.at).toLocaleString()}</small>
          </div>
        ))}
    </>
  );
}
type BillingData = {
  plan: Plan;
  status: string;
  checkedAt: string | null;
  usage: Record<string, number>;
  limits: Record<string, number>;
  plans: Record<Plan, Record<string, number>>;
  configured: boolean;
  pricesConfigured: { Pro: boolean; Team: boolean };
  hasCustomer: boolean;
  aiPeriod: string;
  storageUnknown: boolean;
};
function Billing({ owner, userId }: { owner: string; userId: string }) {
  const r = useResource<BillingData>(`billing/${owner}`),
    a = useAction();
  const format = (kind: string, n: number) =>
    kind === "storage" ? `${(n / 1024 ** 2).toFixed(1)} MB` : String(n);
  if (owner !== userId)
    return (
      <p className="field-hint">
        The primary workspace Owner manages billing and paid subscriptions.
      </p>
    );
  return (
    <>
      <Feedback a={a} />
      <Loading r={r} />
      {r.data ? (
        <>
          <div className="knowledge-callout">
            <strong>
              {r.data.plan} workspace · {r.data.status}
            </strong>
            <p>
              {r.data.checkedAt
                ? `Last verified with Stripe: ${new Date(r.data.checkedAt).toLocaleString()}`
                : "Free plan. No verified paid subscription."}{" "}
              AI usage resets each calendar month ({r.data.aiPeriod});
              historical packages and starters count toward storage. Seats
              include the Owner, members and pending invitations.
            </p>
          </div>
          <div className="usage-grid">
            {Object.entries(r.data.usage).map(([kind, n]) => (
              <div className="usage-tile" key={kind}>
                <small>{kind === "ai" ? "AI requests this month" : kind}</small>
                <strong>
                  {kind === "storage" && r.data!.storageUnknown
                    ? "Unknown"
                    : format(kind, n)}{" "}
                  <span>/ {format(kind, r.data!.limits[kind])}</span>
                </strong>
                <progress
                  aria-label={`${kind} usage`}
                  value={
                    kind === "storage" && r.data!.storageUnknown ? undefined : n
                  }
                  max={Math.max(1, r.data!.limits[kind])}
                />
              </div>
            ))}
          </div>
          {r.data.storageUnknown ? (
            <div className="knowledge-callout">
              <strong>Legacy file sizes need checking</strong>
              <p>
                New uploads are blocked until stored file sizes are measured.
                Run reconciliation, then refresh Billing & usage. Follow its
                status in Notifications → Background jobs.
              </p>
              <Button
                busy={a.busy}
                onClick={() =>
                  a.run(
                    () => api(`billing/${owner}/reconcile`, "POST"),
                    "Storage reconciliation queued",
                  )
                }
              >
                Reconcile legacy storage
              </Button>
              <Button onClick={r.reload}>Refresh usage</Button>
            </div>
          ) : null}
          {!r.data.configured ? (
            <Notice>
              Checkout and billing management are unavailable until Stripe keys,
              recurring price IDs and a signed webhook are configured. See
              PHASE_THREE.md. No payment is collected or paid plan activated
              from this screen.
            </Notice>
          ) : null}
          <div className="plan-grid">
            {(["Free", "Pro", "Team"] as Plan[]).map((plan) => (
              <article
                className={`plan-card ${r.data!.plan === plan ? "selected" : ""}`}
                key={plan}
              >
                <h3>{plan}</h3>
                <p>
                  {plan === "Free"
                    ? "Room for your next idea."
                    : plan === "Pro"
                      ? "More projects and reusable knowledge."
                      : "A shared space for the whole team."}
                </p>
                <ul>
                  {Object.entries(r.data!.plans[plan]).map(([k, n]) => (
                    <li key={k}>
                      {format(k, n)} {k === "ai" ? "AI requests / month" : k}
                    </li>
                  ))}
                </ul>
                {plan !== "Free" ? (
                  <Button
                    className="primary"
                    busy={a.busy}
                    disabled={
                      !r.data!.configured ||
                      !r.data!.pricesConfigured[plan] ||
                      r.data!.plan === plan
                    }
                    onClick={() =>
                      a.run(async () => {
                        const result = await api<{ url: string }>(
                          `billing/${owner}/checkout`,
                          "POST",
                          { plan },
                        );
                        window.location.assign(result.url);
                      }, "Opening secure Stripe checkout")
                    }
                  >
                    View {plan} checkout
                  </Button>
                ) : (
                  <span className="field-hint">Default plan</span>
                )}
              </article>
            ))}
          </div>
          <p className="field-hint">
            Stripe displays the actual configured price before payment. Plan
            limits are configurable. Connected Vercel, database, domain and API
            charges remain separate. Downgrades preserve data and block new
            usage above the new limits.
          </p>
          <div className="button-row">
            <Button
              busy={a.busy}
              disabled={!r.data.configured || !r.data.hasCustomer}
              onClick={() =>
                a.run(async () => {
                  const result = await api<{ url: string }>(
                    `billing/${owner}/portal`,
                    "POST",
                  );
                  window.location.assign(result.url);
                }, "Opening billing management")
              }
            >
              Billing management
            </Button>
            <Button
              busy={a.busy}
              disabled={!r.data.configured || !r.data.hasCustomer}
              onClick={() =>
                a.run(async () => {
                  await api(`billing/${owner}/sync`, "POST");
                  r.reload();
                }, "Subscription verified with Stripe")
              }
            >
              Verify subscription
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}
type NotificationsData = {
  notifications: {
    id: string;
    project_id: string;
    kind: string;
    text: string;
    at: string;
    read_at: string | null;
  }[];
  preferences: Record<string, boolean>;
};
function Notifications({
  onOpenProject,
}: {
  onOpenProject: (id: string) => void;
}) {
  const r = useResource<NotificationsData>("notifications"),
    jobs = useResource<{
      jobs: {
        id: string;
        kind: string;
        state: string;
        error: string;
        updated_at: string;
      }[];
    }>("jobs"),
    a = useAction(),
    [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const settings = prefs || r.data?.preferences;
  return (
    <>
      <Feedback a={a} />
      <Loading r={r} />
      <p className="field-hint">
        Notifications stay in Chapter. Return dates are checked when you visit
        and by the configured daily worker. New enquiries notify Owners;
        assignments notify the assignee.
      </p>
      {settings ? (
        <form
          className="knowledge-form"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(
              () => api("notifications/preferences", "POST", settings),
              "Notification preferences saved for future events",
            );
          }}
        >
          {Object.entries(settings).map(([kind, enabled]) => (
            <label className="option-check" key={kind}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) =>
                  setPrefs({ ...settings, [kind]: e.target.checked })
                }
              />
              {{
                assignment: "Assigned tasks",
                return: "Project return dates",
                deployment: "Failed deployments",
                enquiry: "New enquiries",
                blocker: "Unresolved blockers in attention inbox",
                integration: "Integration failures in attention inbox",
              }[kind] || kind}
            </label>
          ))}
          <Button busy={a.busy}>Save notification preferences</Button>
        </form>
      ) : null}
      <h3>Your inbox</h3>
      {!r.loading && !r.data?.notifications.length ? (
        <p className="field-hint">
          You're all caught up. Assigned work and project events will appear
          here.
        </p>
      ) : null}
      {r.data?.notifications.map((n) => (
        <div
          className={`knowledge-row ${n.read_at ? "" : "unread"}`}
          key={n.id}
        >
          <div>
            <button
              className="text-link"
              onClick={() => onOpenProject(n.project_id)}
            >
              {n.text}
            </button>
            <small>{new Date(n.at).toLocaleString()}</small>
          </div>
          {!n.read_at ? (
            <Button
              onClick={() =>
                a.run(async () => {
                  await api(
                    `notifications/${encodeURIComponent(n.id)}`,
                    "POST",
                  );
                  r.reload();
                }, "Marked as read")
              }
            >
              Mark read
            </Button>
          ) : null}
        </div>
      ))}
      <h3>Background jobs</h3>
      <Loading r={jobs} />
      {jobs.data?.jobs.length ? (
        jobs.data.jobs.map((j) => (
          <div className="knowledge-row" key={j.id}>
            <div>
              <strong>
                {j.kind} · {j.state}
              </strong>
              <small>
                {new Date(j.updated_at).toLocaleString()}{" "}
                {j.error ? `· ${j.error}` : ""}
              </small>
            </div>
            {j.state === "failed" || j.state === "queued" ? (
              <Button
                busy={a.busy}
                onClick={() =>
                  a.run(async () => {
                    await api(
                      `jobs/${j.id}/${j.state === "failed" ? "retry" : "run"}`,
                      "POST",
                    );
                    jobs.reload();
                  }, "Worker requested")
                }
              >
                {j.state === "failed" ? "Retry" : "Run now"}
              </Button>
            ) : null}
          </div>
        ))
      ) : (
        <p className="field-hint">
          No background work yet. Memory questions and deployment checks appear
          here with their real status.
        </p>
      )}
      <Button onClick={jobs.reload}>Refresh job status</Button>
    </>
  );
}
