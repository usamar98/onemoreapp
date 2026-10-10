"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  FileText,
  Globe,
  ImageIcon,
  LockKeyhole,
  Package,
  UploadCloud,
} from "lucide-react";
import type { Project, QuickPublishPreview } from "@/lib/types";
import { api, Button, Field, Notice, Panel } from "./ui";
import { uploadProjectFile } from "./upload";

export function QuickPublishPanel({
  project: initial,
  vercel,
  canCreate,
  workspaceRole,
  onClose,
  onSaved,
  onIntegrations,
  onReview,
}: {
  project?: Project;
  vercel: boolean;
  canCreate: boolean;
  workspaceRole: string;
  onClose: () => void;
  onSaved: (project: Project, message?: string) => void;
  onIntegrations: () => void;
  onReview: (project: Project) => void;
}) {
  const [project, setProject] = useState<Project | undefined>(initial);
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<QuickPublishPreview | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [shareImages, setShareImages] = useState(
    initial?.shareScreenshots || false,
  );
  const [shareDocuments, setShareDocuments] = useState(
    initial?.shareDocuments || false,
  );
  const [shareSource, setShareSource] = useState(initial?.shareFiles || false);
  const [shareDemo, setShareDemo] = useState(initial?.shareDemo ?? true);
  const [reviewed, setReviewed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const working = useRef(false);
  const role = initial?.role || project?.role || workspaceRole;
  const canEdit = role !== "Viewer";
  const canControl = role === "Owner";

  function acceptFile(next: File | undefined) {
    setError("");
    if (!next) return;
    if (!/\.(?:html?|zip|pdf|png|jpe?g|webp)$/i.test(next.name)) {
      setError(
        "Choose HTML, ZIP, PDF, PNG, JPEG, or WebP. Backend projects need a built static export.",
      );
      return;
    }
    const limit = /\.pdf$/i.test(next.name)
      ? 10
      : /\.(?:png|jpe?g|webp)$/i.test(next.name)
        ? 5
        : 20;
    if (!next.size || next.size > limit * 1024 * 1024) {
      setError(`Choose a non-empty file smaller than ${limit} MB.`);
      return;
    }
    setFile(next);
    setPreview(null);
    setReviewed(false);
    setMessage("");
    if (!name.trim())
      setName(
        next.name
          .replace(/\.[^.]+$/, "")
          .replace(/[-_]/g, " ")
          .slice(0, 80),
      );
  }

  async function loadPreview(p: Project) {
    const result = await api<QuickPublishPreview>(
      `projects/${p.id}/quick-preview`,
    );
    setPreview(result);
    setReviewed(false);
    return result;
  }
  useEffect(() => {
    if (!initial?.quickPublish) return;
    let active = true;
    api<QuickPublishPreview>(`projects/${initial.id}/quick-preview`)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [initial?.id]);
  useEffect(() => {
    if (
      !project?.deploymentId ||
      !["queued", "building", "initializing", "awaiting-url"].includes(
        project.deploymentState,
      )
    )
      return;
    let active = true;
    let checking = false;
    const timer = setInterval(async () => {
      if (!active || checking) return;
      checking = true;
      try {
        const result = await api<{ project: Project }>(
          `projects/${project.id}/deployment`,
        );
        if (!active) return;
        setProject(result.project);
        onSaved(result.project);
        if (result.project.deploymentState === "ready")
          setMessage(
            "Vercel confirmed this deployment is ready. Review the live demo before sharing it.",
          );
      } catch (err) {
        if (active) {
          setError((err as Error).message);
          clearInterval(timer);
        }
      } finally {
        checking = false;
      }
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [project?.deploymentId, project?.deploymentState]);

  async function operation(label: string, run: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await run();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      working.current = false;
      setBusy("");
    }
  }
  async function prepare(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Select a file to prepare a preview.");
      return;
    }
    await operation("upload", async () => {
      setProgress(0);
      let current = project;
      if (!current) {
        current = (
          await api<{ project: Project }>("projects", "POST", {
            name: name.trim(),
            description,
            status: "Building",
          })
        ).project;
        setProject(current);
        onSaved(current);
      } else {
        current = (
          await api<{ project: Project }>(`projects/${current.id}`, "PATCH", {
            name: name.trim(),
            description,
            status: current.status,
            repository: current.repository,
            demoUrl: current.demoUrl,
            tags: current.tags,
            color: current.color,
          })
        ).project;
        setProject(current);
        onSaved(current);
      }
      const result = await uploadProjectFile(
        current.id,
        file,
        "quick",
        setProgress,
      );
      setProject(result.project);
      onSaved(result.project, "Upload saved privately");
      await loadPreview(result.project);
      setFile(null);
      setMessage(
        "Your upload is saved. Review the preview and checks, then choose what to share.",
      );
    });
  }
  async function deploy(check = false) {
    if (!project) return;
    await operation("deploy", async () => {
      const result = await api<{ project: Project }>(
        `projects/${project.id}/${check ? "deployment" : "deploy"}`,
        check ? "GET" : "POST",
      );
      setProject(result.project);
      onSaved(result.project);
      setMessage(
        result.project.deploymentState === "ready"
          ? "Vercel confirmed a live deployment. Its URL is below."
          : `Vercel reports ${result.project.deploymentState}. Check status before retrying deployment.`,
      );
    });
  }
  async function share(enabled: boolean) {
    if (!project) return;
    await operation("share", async () => {
      if (name.trim() !== project.name || description !== project.description) {
        const updated = await api<{ project: Project }>(
          `projects/${project.id}`,
          "PATCH",
          {
            name: name.trim(),
            description,
            status: project.status,
            repository: project.repository,
            demoUrl: project.demoUrl,
            tags: project.tags,
            color: project.color,
          },
        );
        setProject(updated.project);
        onSaved(updated.project);
      }
      const result = await api<{ project: Project }>(
        `projects/${project.id}/share`,
        "POST",
        {
          shared: enabled,
          shareRepo: project.shareRepo,
          shareDemo,
          shareScreenshots: shareImages,
          shareFiles: shareSource,
          shareDocuments,
        },
      );
      setProject(result.project);
      onSaved(
        result.project,
        enabled ? "Project page published" : "Project page made private",
      );
      setMessage(
        enabled
          ? "Your selected content is shared at the stable project link. Private notes and other files remain in your workspace."
          : "New visitors can no longer access the project page or its shared files. A separately deployed Vercel demo remains online.",
      );
    });
  }
  const link =
    project && typeof window !== "undefined"
      ? `${window.location.origin}/p/${project.shareId}`
      : "";
  const Icon =
    preview?.record.format === "pdf"
      ? FileText
      : preview?.record.format === "image"
        ? ImageIcon
        : preview?.deployable
          ? Code2
          : Package;
  return (
    <Panel
      title="Quick Publish"
      subtitle="A file, a preview, a next chapter."
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="panel-body quick-publish">
        <ol className="quick-steps" aria-label="Publishing steps">
          {[
            "Upload privately",
            "Review your content",
            "Choose what to share",
          ].map((step, i) => (
            <li key={step} className={i === 0 || preview ? "complete" : ""}>
              <span>{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        {error ? <Notice kind="error">{error}</Notice> : null}
        {message ? <Notice kind="success">{message}</Notice> : null}
        <div className="quick-grid">
          <form className="quick-upload-form" onSubmit={prepare}>
            <h3>Make something shareable.</h3>
            <p className="field-hint">
              HTML and static ZIPs can deploy through Vercel. PDFs and images
              can live on your project page.
            </p>
            <Field label="Project name">
              <input
                value={name}
                maxLength={80}
                required
                disabled={!canEdit || !!busy}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Description">
              <textarea
                value={description}
                maxLength={2000}
                rows={3}
                disabled={!canEdit || !!busy}
                placeholder="What should someone know about this project?"
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <label
              className={`quick-drop ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (canEdit && !busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!busy && canEdit) {
                  if (e.dataTransfer.files.length !== 1)
                    setError(
                      "Choose one file at a time. ZIP a multi-file website first.",
                    );
                  else acceptFile(e.dataTransfer.files[0]);
                }
              }}
            >
              <UploadCloud size={30} aria-hidden="true" />
              <strong>{file?.name || "Drop your file here"}</strong>
              <span>or browse from your computer</span>
              <input
                aria-label="Quick Publish file"
                type="file"
                accept=".html,.htm,.zip,.pdf,.png,.jpg,.jpeg,.webp"
                disabled={!canEdit || !!busy || (!project && !canCreate)}
                onChange={(e) => {
                  acceptFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <small>HTML / ZIP: 20 MB · PDF: 10 MB · Images: 5 MB</small>
            </label>
            {busy === "upload" ? (
              <div className="quick-progress" aria-live="polite">
                <progress
                  max={100}
                  value={progress}
                  aria-label="Upload progress"
                />
                <span>
                  {progress < 95
                    ? `Uploading ${progress}%`
                    : progress < 100
                      ? "Checking your file…"
                      : "Preparing preview…"}
                </span>
              </div>
            ) : null}
            <p className="quick-private">
              <LockKeyhole size={14} /> Saved privately. Uploading does not
              publish or deploy.
            </p>
            {!project && !canCreate ? (
              <Notice>
                Only a full workspace Owner or Editor can create projects.
                Choose an existing authorized project.
              </Notice>
            ) : null}
            <Button
              type="submit"
              className="primary"
              busy={busy === "upload"}
              disabled={
                !!busy ||
                !file ||
                !name.trim() ||
                !canEdit ||
                (!project && !canCreate)
              }
            >
              Save & preview
            </Button>
          </form>
          <section className="quick-review" aria-label="Upload review">
            {!preview ? (
              <div className="quick-empty">
                <FileText size={35} />
                <h3>See it before you share it.</h3>
                <p>
                  Your private preview and publishing checks appear here after
                  upload.
                </p>
                <span>Source downloads always need separate permission.</span>
              </div>
            ) : (
              <>
                <div className="quick-file-heading">
                  <Icon size={21} />
                  <div>
                    <strong>{preview.record.name}</strong>
                    <small>
                      {preview.record.fileCount} file(s) ·{" "}
                      {preview.deployable
                        ? "Static build available"
                        : preview.record.format === "zip"
                          ? "Source package only"
                          : "Shareable file"}
                    </small>
                  </div>
                </div>
                {preview.html ? (
                  <>
                    <iframe
                      title="Safe website layout preview"
                      sandbox=""
                      referrerPolicy="no-referrer"
                      srcDoc={preview.html}
                      className="quick-preview-frame"
                    />
                    <p className="field-hint">
                      Layout preview only. Scripts, forms, and network requests
                      are blocked; relative CSS assets may differ. Test
                      functionality on the separate live deployment.
                    </p>
                  </>
                ) : preview.record.format === "image" ? (
                  <img
                    src={preview.fileUrl}
                    alt={`${project?.name} uploaded image preview`}
                    className="quick-image-preview"
                  />
                ) : preview.record.format === "pdf" ? (
                  <div className="quick-pdf-preview">
                    <FileText size={46} />
                    <strong>PDF ready for review</strong>
                    <a
                      href={preview.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="button"
                    >
                      Open private PDF <ArrowUpRight size={15} />
                    </a>
                    <p>
                      Opens in your browser's PDF viewer. This does not publish
                      the file.
                    </p>
                  </div>
                ) : (
                  <Notice>
                    Source is safely stored. Upload a built static export to
                    enable deployment.
                  </Notice>
                )}
                <div className="quick-checks">
                  <h4>Publishing checks</h4>
                  <p>
                    <CheckCircle2 size={15} /> File format and upload limits
                    checked
                  </p>
                  <p>
                    <CheckCircle2 size={15} /> Recognized credentials and
                    sensitive paths checked
                  </p>
                  {preview.record.warnings.map((w) => (
                    <p key={w} className="quick-warning">
                      {w}
                    </p>
                  ))}
                  {preview.envNames.length ? (
                    <p>
                      Referenced configuration names:{" "}
                      <code>{preview.envNames.join(", ")}</code>
                    </p>
                  ) : null}
                  <small>
                    Checked{" "}
                    {new Date(preview.record.checkedAt).toLocaleString()}. These
                    checks do not verify application functionality.
                  </small>
                </div>
              </>
            )}
          </section>
        </div>
        {preview && project ? (
          <section className="quick-publish-actions">
            <div>
              <span className="eyebrow">READY WHEN YOU ARE</span>
              <h3>Choose your next step.</h3>
              <p>
                Publishing your project page and deploying a website are
                separate actions.
              </p>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={!!busy}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              <span>
                <strong>I reviewed the content and publishing checks.</strong>
                <small>
                  Check for private information that automated scanning might
                  miss.
                </small>
              </span>
            </label>
            <div className="quick-sharing-options">
              <Button
                disabled={!!busy || !canControl}
                onClick={() => onReview(project)}
              >
                <LockKeyhole size={16} />
                Create private client preview
              </Button>
              {project.demoUrl ? (
                <label>
                  <input
                    type="checkbox"
                    checked={shareDemo}
                    disabled={!canControl || !!busy}
                    onChange={(e) => setShareDemo(e.target.checked)}
                  />{" "}
                  Include demo link
                </label>
              ) : null}
              {project.documentIds?.length ? (
                <label>
                  <input
                    type="checkbox"
                    checked={shareDocuments}
                    disabled={!canControl || !!busy}
                    onChange={(e) => setShareDocuments(e.target.checked)}
                  />{" "}
                  Include PDF documents ({project.documentIds.length})
                </label>
              ) : null}
              {project.screenshotIds.length ? (
                <label>
                  <input
                    type="checkbox"
                    checked={shareImages}
                    disabled={!canControl || !!busy}
                    onChange={(e) => setShareImages(e.target.checked)}
                  />{" "}
                  Include images ({project.screenshotIds.length})
                </label>
              ) : null}
              {project.sourceId ? (
                <label>
                  <input
                    type="checkbox"
                    checked={shareSource}
                    disabled={!canControl || !!busy}
                    onChange={(e) => setShareSource(e.target.checked)}
                  />{" "}
                  Allow source ZIP download
                </label>
              ) : null}
            </div>
            {!canControl ? (
              <Notice>
                An Owner must publish the page or deploy the website. Your
                upload and preview remain private.
              </Notice>
            ) : null}
            <div className="quick-action-row">
              <Button
                className="primary"
                busy={busy === "share"}
                disabled={!!busy || !reviewed || !canControl}
                onClick={() => share(true)}
              >
                <Globe size={16} />
                {project.shared
                  ? "Update sharing settings"
                  : "Publish project page"}
              </Button>
              {preview.deployable ? (
                (preview.vercelConnected ?? vercel) ? (
                  <Button
                    busy={busy === "deploy"}
                    disabled={
                      !!busy ||
                      !reviewed ||
                      !canControl ||
                      (!!project.deploymentId &&
                        !["ready", "error", "failed", "canceled"].includes(
                          project.deploymentState,
                        ))
                    }
                    onClick={() => deploy()}
                  >
                    <UploadCloud size={16} /> Deploy website to Vercel
                  </Button>
                ) : (
                  <Button
                    onClick={onIntegrations}
                    disabled={!!busy || !canControl}
                  >
                    Connect Vercel to deploy <ArrowUpRight size={15} />
                  </Button>
                )
              ) : null}
              {project.deploymentId && canControl ? (
                <Button
                  busy={busy === "deploy"}
                  disabled={!!busy}
                  onClick={() => deploy(true)}
                >
                  Check deployment
                </Button>
              ) : null}
              {project.shared && canControl ? (
                <Button disabled={!!busy} onClick={() => share(false)}>
                  Make page private
                </Button>
              ) : null}
            </div>
            {preview.deployable ? (
              <p className="field-hint">
                Deployment publishes the static build on Vercel and can incur
                provider charges. Making the Chapter page private does not stop
                that deployment.
              </p>
            ) : null}
            {project.deploymentState ? (
              <p className="field-hint">
                Vercel deployment: <strong>{project.deploymentState}</strong>
              </p>
            ) : null}
            {project.demoUrl ? (
              <a
                className="button"
                target="_blank"
                rel="noreferrer"
                href={project.demoUrl}
              >
                Open live demo <ArrowUpRight size={15} />
              </a>
            ) : null}
            {project.shared ? (
              <div className="copy-link">
                <input
                  readOnly
                  aria-label="Published project link"
                  value={link}
                />
                <button
                  aria-label="Copy published link"
                  className="icon-button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                      setCopied(true);
                    } catch {
                      setError(
                        "Select the link and copy it manually; clipboard access is unavailable.",
                      );
                    }
                  }}
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </button>
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-button"
                  aria-label="Open published page"
                >
                  <ArrowUpRight size={17} />
                </a>
              </div>
            ) : null}
          </section>
        ) : null}
        <div className="form-footer">
          <Button disabled={!!busy} onClick={onClose}>
            Done
          </Button>
          {project ? (
            <span className="field-hint">
              Your project stays saved when you close this panel.
            </span>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
