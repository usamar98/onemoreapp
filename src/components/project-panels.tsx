"use client";
import { useState, useEffect } from "react";
import { Readiness } from "./lifecycle-panel";
import {
  Plus,
  Upload,
  Github,
  ArrowUpRight,
  LockKeyhole,
  Copy,
  Download,
  Play,
  Pause,
  Check,
  ImagePlus,
  Globe,
  Sparkles,
  Archive,
  ListPlus,
  FileArchive,
  FileText,
  X,
  ExternalLink,
} from "lucide-react";
import Image from "next/image";
import {
  Panel,
  Button,
  Field,
  Notice,
  Badge,
  Preview,
  api,
  downloadText,
} from "./ui";
import {
  statuses,
  emptyMemory,
  type Project,
  type Memory,
  type Workspace,
} from "@/lib/types";
import { redact } from "@/lib/redact";
import { uploadProjectFile } from "./upload";
type Props = {
  onClose: () => void;
  onSaved: (project: Project, message?: string) => void;
};
export function ProjectEditor({
  project,
  onClose,
  onSaved,
}: { project?: Project } & Props) {
  const [tab, setTab] = useState<"manual" | "github" | "zip">(
      project ? "manual" : "manual",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [values, setValues] = useState({
    name: project?.name || "",
    description: project?.description || "",
    repository: project?.repository || "",
    demoUrl: project?.demoUrl || "",
    status: project?.status || "Idea",
    tags: project?.tags.join(", ") || "",
    color: project?.color || "mint",
  });
  const [file, setFile] = useState<File | null>(null),
    [screenshots, setScreenshots] = useState<File[]>([]),
    [importUrl, setImportUrl] = useState("");
  const [createdId, setCreatedId] = useState(project?.id || "");
  const change = (key: string, value: string) =>
    setValues((s) => ({ ...s, [key]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    let saved: Project | undefined;
    try {
      if (tab === "github") {
        const result = await api<{ project: Project }>(
          "projects/import",
          "POST",
          { repository: importUrl },
        );
        saved = result.project;
      } else {
        if (!createdId) {
          const result = await api<{ project: Project }>("projects", "POST", {
            ...values,
            tags: values.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          });
          saved = result.project;
          setCreatedId(saved.id);
        } else
          saved = (
            await api<{ project: Project }>(`projects/${createdId}`, "PATCH", {
              ...values,
              tags: values.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            })
          ).project;
        if (file) {
          saved = (await uploadProjectFile(saved.id, file, "source")).project;
        }
        for (const screenshot of screenshots) {
          saved = (await uploadProjectFile(saved.id, screenshot, "screenshot"))
            .project;
        }
      }
      onSaved(
        saved!,
        project ? "Project updated" : "Your next chapter starts here",
      );
      onClose();
    } catch (err) {
      if (saved) onSaved(saved);
      setError(
        `${(err as Error).message}${saved ? " Project details were saved; try uploading the file again." : ""}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title={project ? "Edit project" : "A new chapter"}
      subtitle={
        project
          ? "Make this project feel at home."
          : "Start with an idea, a repository, or something you have already built."
      }
      onClose={onClose}
      wide
    >
      {!project ? (
        <div className="editor-tabs">
          {(
            [
              ["manual", "From scratch", Plus],
              ["github", "GitHub repository", Github],
              ["zip", "Upload ZIP", Upload],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={tab === key ? "active" : ""}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <form onSubmit={submit} className="panel-body">
        {error ? <Notice kind="error">{error}</Notice> : null}
        {tab === "github" ? (
          <>
            <div className="integration-explainer">
              <Github size={34} />
              <h3>Bring your repository along.</h3>
              <p>
                Import the description, README, current commit, and a source
                snapshot. Private repositories need a GitHub connection in
                Integrations.
              </p>
            </div>
            <Field label="Repository URL">
              <input
                required
                type="url"
                placeholder="https://github.com/you/your-next-project"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
              />
            </Field>
            <Notice>
              Imported projects are private. Connecting a repository does not
              publish its source.
            </Notice>
          </>
        ) : (
          <>
            <Field label="Project name">
              <input
                required
                maxLength={80}
                placeholder="What are you working on?"
                value={values.name}
                onChange={(e) => change("name", e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Description">
              <textarea
                rows={3}
                maxLength={2000}
                placeholder="The idea, the purpose, the little spark behind it."
                value={values.description}
                onChange={(e) => change("description", e.target.value)}
              />
            </Field>
            <div className="field-grid">
              <Field label="Status">
                <select
                  value={values.status}
                  onChange={(e) => change("status", e.target.value)}
                >
                  {statuses
                    .filter(
                      (s) => s !== "Parked" || project?.status === "Parked",
                    )
                    .map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                </select>
              </Field>
              <Field label="Tags" hint="Separate with commas. Up to six.">
                <input
                  placeholder="React, Side project"
                  value={values.tags}
                  onChange={(e) => change("tags", e.target.value)}
                />
              </Field>
            </div>
            <div className="field-grid">
              <Field label="GitHub repository (optional)">
                <input
                  type="url"
                  placeholder="https://github.com/..."
                  value={values.repository}
                  onChange={(e) => change("repository", e.target.value)}
                />
              </Field>
              <Field label="Demo URL (optional)">
                <input
                  type="url"
                  placeholder="https://your-project.com"
                  value={values.demoUrl}
                  onChange={(e) => change("demoUrl", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Project color">
              <div className="color-options">
                {["mint", "violet", "sand", "blue", "peach", "pink"].map(
                  (color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-choice ${color} ${values.color === color ? "selected" : ""}`}
                      aria-label={`${color} project color`}
                      aria-pressed={values.color === color}
                      onClick={() => change("color", color)}
                    >
                      {values.color === color ? <Check size={16} /> : null}
                    </button>
                  ),
                )}
              </div>
            </Field>
            <label className={`upload-zone ${file ? "has-file" : ""}`}>
              <Upload size={25} />
              <strong>
                {file ? file.name : "Drop a ZIP here, or browse files"}
              </strong>
              <span>Source or static web build · up to 20 MB</span>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required={tab === "zip"}
              />
            </label>
            <p className="field-hint">
              Source is stored for download. Only static builds containing
              index.html can be deployed. Environment files and credential files
              are excluded.
            </p>
            <label className="screenshot-upload">
              <ImagePlus size={19} />
              <span>
                {screenshots.length
                  ? `${screenshots.length} screenshot${screenshots.length > 1 ? "s" : ""} selected`
                  : "Add screenshots"}
                <small>PNG, JPG, WebP · up to 5 MB each</small>
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(e) =>
                  setScreenshots(Array.from(e.target.files || []))
                }
              />
              <Plus size={16} />
            </label>
          </>
        )}
        <div className="form-footer">
          <span>
            <LockKeyhole size={14} /> Private by default
          </span>
          <Button type="submit" className="primary" busy={busy}>
            {tab === "github" ? <Github size={16} /> : <Plus size={16} />}{" "}
            {project
              ? "Save changes"
              : tab === "github"
                ? "Import repository"
                : "Create project"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
export function SharePanel({
  project,
  onClose,
  onSaved,
}: { project: Project } & Props) {
  const [shared, setShared] = useState(project.shared),
    [options, setOptions] = useState({
      shareRepo: project.shareRepo,
      shareFiles: project.shareFiles,
      shareDemo: project.shareDemo,
      shareScreenshots: project.shareScreenshots,
    });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/p/${project.shareId}`
      : "";
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ project: Project }>(
        `projects/${project.id}/share`,
        "POST",
        { shared, ...options },
      );
      onSaved(r.project, shared ? "Share page is ready" : "Project is private");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="Share a little of your world"
      subtitle={project.name}
      onClose={onClose}
    >
      <form onSubmit={save} className="panel-body">
        {error ? <Notice kind="error">{error}</Notice> : null}
        <div className="share-privacy">
          <span className={`big-icon ${shared ? "mint" : ""}`}>
            {shared ? <Globe size={25} /> : <LockKeyhole size={25} />}
          </span>
          <div>
            <strong>{shared ? "Anyone with the link" : "Only you"}</strong>
            <p>
              {shared
                ? "Your selected details will be visible on the share page."
                : "Your project is tucked away in your workspace."}
            </p>
          </div>
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable public sharing"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
          />
        </div>
        <div className="sharing-options">
          <h4>Choose what goes with it</h4>
          {(
            [
              [
                "shareScreenshots",
                "Screenshots",
                "Show your selected project images.",
              ],
              ["shareDemo", "Demo link", "Let visitors try the live project."],
              [
                "shareRepo",
                "Repository link",
                "Include a link to your GitHub repository.",
              ],
              [
                "shareFiles",
                "Source download",
                "Explicitly allow downloading the stored source ZIP.",
              ],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className="check-row">
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) =>
                  setOptions((s) => ({ ...s, [key]: e.target.checked }))
                }
              />
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
            </label>
          ))}
        </div>
        <Notice>
          Parking notes, resume briefs, and integration credentials stay
          private. A demo preview does not grant access to source files.
        </Notice>
        {project.shared ? (
          <div className="copy-link">
            <input readOnly aria-label="Share link" value={url} />
            <button
              type="button"
              className="icon-button"
              aria-label="Copy share link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                } catch {
                  setError(
                    "Clipboard unavailable. Select and copy the link manually.",
                  );
                }
              }}
            >
              {copied ? <Check size={17} /> : <Copy size={17} />}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="icon-button"
              aria-label="Open share page"
            >
              <ArrowUpRight size={17} />
            </a>
          </div>
        ) : (
          <p className="field-hint">
            Save sharing settings to activate your stable project link.
          </p>
        )}
        <div className="form-footer">
          <Button type="button" onClick={onClose}>
            Done
          </Button>
          <Button type="submit" busy={busy} className="primary">
            Save sharing settings
          </Button>
        </div>
      </form>
    </Panel>
  );
}
export function ParkPanel({
  project,
  onClose,
  onSaved,
}: { project: Project } & Props) {
  const [memory, setMemory] = useState<Memory>({
      ...emptyMemory,
      ...project.memory,
      version: project.memory?.version || project.version,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const fields = [
    [
      "setup",
      "Setup instructions",
      "How do you run it? Dependencies, commands, and useful links.",
    ],
    ["completed", "Completed features", "What already works?"],
    ["issues", "Known issues & blockers", "What still needs attention?"],
    ["reason", "Reason for pausing", "What made you put this chapter on hold?"],
    ["nextTask", "The very next task", "One clear step for your future self."],
  ] as const;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ project: Project }>(
        `projects/${project.id}/park`,
        "POST",
        memory,
      );
      onSaved(r.project, "Parked with memory. Your future self says thanks.");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="A pause, with a plan"
      subtitle={`Leave a little context for the next chapter of ${project.name}.`}
      onClose={onClose}
      wide
    >
      <form onSubmit={save} className="panel-body">
        {error ? <Notice kind="error">{error}</Notice> : null}
        <Notice>
          Parking saves a version and your notes. Your live site keeps running.
        </Notice>
        <div className="field-grid">
          <Field
            label="Current version"
            hint="A commit, release, or snapshot identifier."
          >
            <input
              value={memory.version}
              placeholder="e.g. v0.3.0"
              onChange={(e) =>
                setMemory((s) => ({ ...s, version: e.target.value }))
              }
            />
          </Field>
          <Field label="Intended return date (optional)">
            <input
              type="date"
              value={memory.returnDate}
              onChange={(e) =>
                setMemory((s) => ({ ...s, returnDate: e.target.value }))
              }
            />
          </Field>
        </div>
        {fields.map(([key, label, placeholder]) => (
          <Field key={key} label={label}>
            <textarea
              rows={key === "setup" ? 3 : 2}
              required={key === "nextTask"}
              value={memory[key]}
              placeholder={placeholder}
              onChange={(e) =>
                setMemory((s) => ({ ...s, [key]: e.target.value }))
              }
            />
          </Field>
        ))}
        <p className="field-hint">
          Keep credentials in your secret manager. Detected keys and credentials
          are removed from saved notes and briefs.
        </p>
        <div className="form-footer">
          <Button type="button" onClick={onClose}>
            Keep building
          </Button>
          <Button type="submit" busy={busy} className="primary">
            <Pause size={16} /> Park with memory
          </Button>
        </div>
      </form>
    </Panel>
  );
}
export function ResumePanel({
  project,
  ai,
  onClose,
  onSaved,
  onGuided,
}: { project: Project; ai: boolean; onGuided?: () => void } & Props) {
  const [brief, setBrief] = useState(project.brief),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [kind, setKind] = useState(project.briefKind),
    [copied, setCopied] = useState(false);
  async function generate(generateAI: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ project: Project }>(
        `projects/${project.id}/brief`,
        "POST",
        { generateAI },
      );
      setBrief(r.project.brief);
      setKind(r.project.briefKind);
      onSaved(r.project);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(resume: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ project: Project }>(
        `projects/${project.id}/${resume ? "resume" : "save-brief"}`,
        "POST",
        { brief },
      );
      onSaved(
        r.project,
        resume ? "Welcome back. Time for the next chapter." : "Brief saved",
      );
      if (resume) onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="Pick up where you left off"
      subtitle={`${project.name} · ${project.memory?.savedAt ? `Parked ${new Date(project.memory.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "Project context"}`}
      onClose={onClose}
      wide
    >
      <div className="panel-body">
        {error ? <Notice kind="error">{error}</Notice> : null}
        <div className="resume-memory">
          <span className="eyebrow">YOUR NEXT STEP</span>
          <h3>
            {project.nextTask ||
              project.memory?.nextTask ||
              "Your next task has not been recorded yet."}
          </h3>
          <p>{project.memory?.reason || "No stopping notes recorded."}</p>
          {project.memory?.sourceId ? (
            <a
              className="text-link"
              href={`/api/files/${project.memory.sourceId}`}
            >
              <Download size={14} /> Download parked source snapshot
            </a>
          ) : null}
        </div>
        {onGuided ? (
          <div className="guided-session-callout">
            <div>
              <strong>Continue with a guided session</strong>
              <p>
                Choose your task and available time, then save the work you
                actually completed.
              </p>
            </div>
            <Button className="primary" onClick={onGuided}>
              Open guided resume
            </Button>
          </div>
        ) : null}
        <Readiness project={project} onSaved={onSaved} compact />
        <div className="brief-toolbar">
          <div>
            <h3>Your resume brief</h3>
            <span>
              {kind === "ai"
                ? "AI draft from your saved context. Review before using."
                : kind === "notes"
                  ? "Prepared directly from saved notes."
                  : "Ready for any coding assistant."}
            </span>
          </div>
          <div className="brief-generators">
            <Button busy={busy} onClick={() => generate(false)}>
              <FileText size={15} /> Prepare from notes
            </Button>
            {ai ? (
              <Button busy={busy} onClick={() => generate(true)}>
                <Sparkles size={15} /> Generate AI brief
              </Button>
            ) : null}
          </div>
        </div>
        {!ai ? (
          <p className="field-hint">
            AI is not connected yet. Your saved-notes brief works now. See
            Integrations for AI setup.
          </p>
        ) : null}
        <textarea
          className="brief-editor"
          aria-label="Editable resume brief"
          rows={16}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Prepare a brief to bring your saved context together. Missing information will be marked, never guessed."
        />
        <div className="brief-actions">
          <Button
            disabled={!brief}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(redact(brief));
                setCopied(true);
              } catch {
                setError(
                  "Clipboard unavailable. Select the brief and copy it manually.",
                );
              }
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
            {copied ? "Copied" : "Copy brief"}
          </Button>
          <Button
            disabled={!brief}
            onClick={() =>
              downloadText(
                `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-resume.md`,
                redact(brief),
              )
            }
          >
            <Download size={15} /> Download .md
          </Button>
          <Button disabled={!brief} busy={busy} onClick={() => save(false)}>
            Save edits
          </Button>
        </div>
        <div className="form-footer">
          <span>
            <LockKeyhole size={14} />{" "}
            {project.revival
              ? "Review the readiness results before resuming"
              : "Run a readiness check before resuming"}
          </span>
          <Button
            className="primary"
            busy={busy}
            disabled={
              !project.revival ||
              project.revival.sourceId !== project.sourceId ||
              project.revival.version !== project.version ||
              Date.now() - Date.parse(project.revival.at) > 86400000
            }
            onClick={() => save(true)}
          >
            <Play size={15} /> Resume building
          </Button>
        </div>
      </div>
    </Panel>
  );
}
export function DetailsPanel({
  project,
  onClose,
  onEdit,
  onShare,
  onPark,
  onResume,
  onLifecycle,
  onKnowledge,
  onLaunch,
  onSaved,
}: {
  project: Project;
  onEdit: () => void;
  onShare: () => void;
  onPark: () => void;
  onResume: () => void;
  onLifecycle: () => void;
  onKnowledge: () => void;
  onLaunch: () => void;
} & Props) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (
      !project.deploymentId ||
      ["ready", "error", "failed", "canceled"].includes(
        project.deploymentState,
      ) ||
      project.hostingProvider !== "vercel"
    )
      return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await api<{ project: Project }>(
          `projects/${project.id}/deployment`,
        );
        if (!cancelled)
          onSaved(
            r.project,
            r.project.deploymentState === "ready"
              ? "Your project is live"
              : undefined,
          );
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project.deploymentId, project.deploymentState, project.updatedAt]);
  async function deploy(check = false) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ project: Project }>(
        `projects/${project.id}/${check ? "deployment" : "deploy"}`,
        check ? "GET" : "POST",
      );
      onSaved(
        r.project,
        r.project.deploymentState === "ready"
          ? "Your project is live"
          : `Deployment: ${r.project.deploymentState}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title={project.name}
      subtitle="Every detail, ready for your next session."
      onClose={onClose}
      wide
    >
      <div className="panel-body">
        {error ? <Notice kind="error">{error}</Notice> : null}
        <Preview project={project} />
        <div className="detail-meta">
          <Badge status={project.status} />
          <span>
            <LockKeyhole size={14} />
            {project.shared ? "Shared by link" : "Private project"}
          </span>
        </div>
        <p className="detail-description">
          {project.description ||
            "Add a description to capture the purpose behind this project."}
        </p>
        <div className="detail-actions">
          <Button onClick={onShare}>
            <ArrowUpRight size={16} /> Share
          </Button>
          {project.status === "Parked" ? (
            <Button className="primary" onClick={onResume}>
              <Play size={15} /> Resume
            </Button>
          ) : (
            <Button onClick={onPark}>
              <Pause size={15} /> Park with memory
            </Button>
          )}
          <Button onClick={onEdit}>Edit project</Button>
          <Button onClick={onLifecycle}>Next chapter controls</Button>
        </div>
        <div className="detail-section">
          <Button onClick={onKnowledge}>Collaboration & records</Button>
          <Button onClick={onLaunch}>Reviews & automation</Button>
          {project.inactivityFlag ? (
            <Notice>
              Inactivity flagged{" "}
              {new Date(project.inactivityFlag.at).toLocaleString()}.{" "}
              {project.inactivityFlag.detail}
            </Notice>
          ) : null}
          {project.role ? (
            <p className="field-hint">Your project access: {project.role}</p>
          ) : null}
          <h3>Links & files</h3>
          {project.repository ? (
            <a
              href={project.repository}
              target="_blank"
              rel="noreferrer"
              className="detail-link"
            >
              <Github size={17} />
              <span>
                Repository<small>{project.repository}</small>
              </span>
              <ExternalLink size={15} />
            </a>
          ) : (
            <p className="field-hint">
              No repository connected. Add one in Edit project or import from
              GitHub.
            </p>
          )}
          {project.demoUrl ? (
            <a
              href={project.demoUrl}
              target="_blank"
              rel="noreferrer"
              className="detail-link"
            >
              <Globe size={17} />
              <span>
                Live demo<small>{project.demoUrl}</small>
              </span>
              <ExternalLink size={15} />
            </a>
          ) : null}
          {project.sourceId ? (
            <a href={`/api/files/${project.sourceId}`} className="detail-link">
              <FileArchive size={18} />
              <span>
                Download source
                <small>
                  {project.sourceName} · Private unless explicitly shared
                </small>
              </span>
              <Download size={16} />
            </a>
          ) : (
            <p className="field-hint">
              No source archive saved. Upload a ZIP in Edit project.
            </p>
          )}
        </div>
        <div className="detail-section">
          <div className="section-title">
            <h3>Hosting</h3>
            <span className={`hosting-state ${project.buildId ? "ready" : ""}`}>
              {project.buildId ? "Static build ready" : "Build needed"}
            </span>
          </div>
          <p className="field-hint">
            Deploy a static web build through your Vercel account. Source files
            are never automatically published.
          </p>
          <div className="hosting-actions">
            <Button
              className="primary"
              busy={busy}
              disabled={!!project.role && project.role !== "Owner"}
              onClick={() => deploy()}
            >
              <Globe size={16} /> Deploy to Vercel
            </Button>
            {project.deploymentId ? (
              <Button busy={busy} onClick={() => deploy(true)}>
                Check deployment
              </Button>
            ) : null}
          </div>
          {project.deploymentState ? (
            <p className="field-hint">
              Last deployment: {project.deploymentState}
            </p>
          ) : null}
        </div>
        {project.screenshotIds.length ? (
          <div className="detail-section">
            <h3>Screenshots</h3>
            <div className="screenshot-gallery">
              {project.screenshotIds.map((id) => (
                <div key={id}>
                  <Image
                    src={`/api/files/${id}`}
                    width={300}
                    height={180}
                    unoptimized
                    alt={`${project.name} screenshot`}
                  />
                  <button
                    className="icon-button"
                    aria-label="Remove screenshot"
                    onClick={async () => {
                      try {
                        const r = await api<{ project: Project }>(
                          `projects/${project.id}/screenshot`,
                          "DELETE",
                          { fileId: id },
                        );
                        onSaved(r.project);
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
export function IntegrationsPanel({
  workspace,
  onClose,
  onRefresh,
}: {
  workspace: Workspace;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [provider, setProvider] = useState<"github" | "vercel" | null>(null),
    [token, setToken] = useState(""),
    [teamId, setTeamId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!provider) return;
    setBusy(true);
    setError("");
    try {
      await api(`integrations/${provider}`, "POST", {
        token,
        teamId: provider === "vercel" ? teamId : "",
      });
      setToken("");
      setTeamId("");
      setProvider(null);
      setMessage("Account connected. You are ready to go.");
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect(p: "github" | "vercel") {
    setBusy(true);
    setError("");
    try {
      await api(`integrations/${p}`, "DELETE");
      onRefresh();
      setMessage("Account disconnected.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="A few helpful connections"
      subtitle="Your accounts, working together in your workspace."
      onClose={onClose}
    >
      <div className="panel-body">
        {error ? <Notice kind="error">{error}</Notice> : null}
        {message ? <Notice kind="success">{message}</Notice> : null}
        {(["github", "vercel"] as const).map((p) => (
          <div className="integration-block" key={p}>
            <div className="integration-row">
              <span className="big-icon">
                {p === "github" ? <Github size={24} /> : <Globe size={24} />}
              </span>
              <div>
                <h3>{p === "github" ? "GitHub" : "Vercel"}</h3>
                <p>
                  {p === "github"
                    ? "Import repositories and save their context."
                    : "Publish static web builds to a real live URL."}
                </p>
              </div>
              <span
                className={`connection-label ${workspace.integrations[p] ? "connected" : ""}`}
              >
                {workspace.integrations[p] ? "Connected" : "Not connected"}
              </span>
            </div>
            <p>
              {p === "github"
                ? "Create a fine-grained token with Contents: read access for the repositories you want to import. Public repositories also work without a token."
                : "Create an access token in Vercel account settings → Tokens with access to your deployment account. For a team, enter its Team ID from team settings. Deployments use your Vercel plan limits."}
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
              Open {p === "github" ? "GitHub" : "Vercel"} settings{" "}
              <ArrowUpRight size={14} />
            </a>
            <div className="integration-controls">
              {workspace.integrations[p] ? (
                <Button busy={busy} onClick={() => disconnect(p)}>
                  Disconnect
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setProvider(p);
                    setToken("");
                    setTeamId("");
                  }}
                >
                  {p === "github" ? <Github size={15} /> : <Globe size={15} />}
                  Connect {p === "github" ? "GitHub" : "Vercel"}
                </Button>
              )}
            </div>
            {provider === p ? (
              <form onSubmit={connect} className="connection-form">
                <Field label="Personal access token">
                  <input
                    type="password"
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                    placeholder="Token is encrypted and never shared"
                  />
                </Field>
                {p === "vercel" ? (
                  <Field label="Team ID (optional)">
                    <input
                      value={teamId}
                      onChange={(e) => setTeamId(e.target.value)}
                      placeholder="team_… · leave empty for a personal account"
                      autoComplete="off"
                    />
                  </Field>
                ) : null}
                <Button className="primary" type="submit" busy={busy}>
                  Verify & connect
                </Button>
              </form>
            ) : null}
          </div>
        ))}
        <div className="integration-block">
          <div className="integration-row">
            <span className="big-icon violet">
              <Sparkles size={24} />
            </span>
            <div>
              <h3>AI resume briefs</h3>
              <p>Turn saved notes into a clear starting point.</p>
            </div>
            <span
              className={`connection-label ${workspace.integrations.ai ? "connected" : ""}`}
            >
              {workspace.integrations.ai ? "Configured" : "Setup needed"}
            </span>
          </div>
          {workspace.integrations.ai ? (
            <p>
              OpenAI is configured on the server. Generation requires available
              API credits and model access. Only sanitized project context is
              sent when you choose Generate AI brief. Prepare from notes remains
              available.
            </p>
          ) : (
            <p>
              Your saved-notes brief works now. To enable AI generation,
              configure OPENAI_API_KEY in the server's ignored .env.local file
              and restart Chapter. Never add a key to project files.
            </p>
          )}
        </div>
        <Notice>
          Connection tokens are encrypted on the server. They never appear in
          shared pages, downloadable files, or resume briefs.
        </Notice>
      </div>
    </Panel>
  );
}
