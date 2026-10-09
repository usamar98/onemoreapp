"use client";
import { useState, useRef, useEffect } from "react";
import { Panel, Button, Field, Notice, api } from "./ui";
import {
  useResource,
  useAction,
  Feedback,
  Loading,
  JobStatus,
} from "./launch-panels";
import { browserSha, retryTransfer } from "./package-transfer";
import type { Project, Workspace } from "@/lib/types";
import type {
  Bundle,
  PreservationOptions,
  PreservationPreview,
} from "@/lib/preservation";
import type { BuildEvidence } from "@/lib/bundle-build";
import type { Recreation } from "@/lib/recreation";
type Tab = "preserve" | "verify" | "recreate" | "share" | "services";
type Data = {
  projects: Project[];
  sandbox: boolean;
  storage: {
    plan: string;
    limits: { storage: number };
    usage: { storage: number };
  };
};
const size = (bytes: number) =>
  bytes < 1024 ** 2
    ? `${(bytes / 1024).toFixed(1)} KB`
    : (bytes / 1024 ** 2).toFixed(2) + " MB";
const date = (value: string | number) => new Date(value).toLocaleString();
export function PreservationPanel({
  workspace,
  owner,
  initialProject,
  onClose,
  onRefresh,
}: {
  workspace: Workspace;
  owner: string;
  initialProject?: Project;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<Tab>("preserve"),
    [projectId, setProjectId] = useState(initialProject?.id || "");
  const r = useResource<Data>(workspace.user ? "preservation" : null),
    projects =
      r.data?.projects ||
      workspace.projects.filter((p) => p.workspaceOwner === owner),
    p = projects.find((p) => p.id === projectId) || projects[0];
  const [bundleId, setBundleId] = useState("");
  const bundles = useResource<{ bundles: Bundle[] }>(
      p ? `bundles/${p.id}` : null,
    ),
    b =
      bundles.data?.bundles.find((b) => b.id === bundleId) ||
      bundles.data?.bundles[0];
  function refresh() {
    r.reload();
    bundles.reload();
    onRefresh();
  }
  return (
    <Panel
      title="Ready for the next rebuild"
      subtitle="Preserve a reviewed version, verify its build, and transfer it with confidence."
      wide
      onClose={onClose}
    >
      <div className="phase-three-content preservation-content">
        {!workspace.user ? (
          <div className="empty-state">
            <h3>Your files need a private workspace</h3>
            <a className="button primary" href="/login">
              Sign in
            </a>
          </div>
        ) : (
          <>
            <nav className="launch-tabs" aria-label="Preservation tools">
              {(
                [
                  ["preserve", "Preserve"],
                  ["verify", "Verify Build"],
                  ["recreate", "Recreate Project"],
                  ["share", "Share Package"],
                  ["services", "Shared services"],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={tab === id ? "selected" : ""}
                  aria-current={tab === id ? "page" : undefined}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <Loading r={r} />
            <p className="field-hint">
              Storage {size(r.data?.storage.usage.storage || 0)} /{" "}
              {size(r.data?.storage.limits.storage || 0)} ·{" "}
              {r.data?.storage.plan || "Loading plan"} · staged uploads count
              toward your limit.
            </p>
            {tab === "services" ? (
              <ServicesTool />
            ) : (
              <>
                <Field label="Saved project">
                  <select
                    value={p?.id || ""}
                    onChange={(e) => {
                      setProjectId(e.target.value);
                      setBundleId("");
                    }}
                  >
                    {projects.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name} · {p.status}
                      </option>
                    ))}
                  </select>
                </Field>
                {!p ? (
                  <div className="empty-state">
                    <h3>Bring a project into Chapter</h3>
                    <p>
                      Add or import a project, then preserve the files you want
                      to keep runnable.
                    </p>
                  </div>
                ) : (
                  <>
                    {tab === "preserve" ? (
                      <PreserveTool
                        key={p.id}
                        p={p}
                        refresh={refresh}
                        onCreated={(id) => {
                          setBundleId(id);
                          setTab("verify");
                        }}
                      />
                    ) : (
                      <>
                        <Loading r={bundles} />
                        {!b ? (
                          <div className="empty-state">
                            <h3>A saved version comes first</h3>
                            <p>
                              Use Preserve to review files and create an
                              immutable package.
                            </p>
                            <Button onClick={() => setTab("preserve")}>
                              Preserve this project
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Field label="Preserved package version">
                              <select
                                value={b.id}
                                onChange={(e) => setBundleId(e.target.value)}
                              >
                                {bundles.data?.bundles.map((b) => (
                                  <option value={b.id} key={b.id}>
                                    {date(b.at)} · {b.id.slice(0, 8)} ·{" "}
                                    {size(b.data.bytes)}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <p className="field-hint">
                              Saved upload {b.data.snapshot.uploadId} · recorded
                              version{" "}
                              {b.data.snapshot.recordedCommit || "Not recorded"}
                            </p>
                            {tab === "verify" ? (
                              <VerifyTool
                                key={b.id}
                                b={b}
                                p={p}
                                sandbox={r.data?.sandbox || false}
                              />
                            ) : tab === "recreate" ? (
                              <RecreateTool
                                key={b.id}
                                b={b}
                                p={p}
                                refresh={refresh}
                              />
                            ) : (
                              <ShareTool
                                key={b.id}
                                b={b}
                                p={p}
                                refresh={refresh}
                              />
                            )}
                          </>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
function PreserveTool({
  p,
  refresh,
  onCreated,
}: {
  p: Project;
  refresh: () => void;
  onCreated: (id: string) => void;
}) {
  const a = useAction(),
    [preview, setPreview] = useState<PreservationPreview | null>(null),
    [reviewed, setReviewed] = useState(false),
    [options, setOptions] = useState<PreservationOptions>({
      paths: [],
      screenshots: [],
      runtime: "",
      buildInstructions: "",
      outputDirectory: "dist",
      externalAssets: "",
      retentionDays: 0,
    });
  const owner = p.role === "Owner";
  function change<K extends keyof PreservationOptions>(
    key: K,
    value: PreservationOptions[K],
  ) {
    setOptions((old) => ({ ...old, [key]: value }));
    setPreview(null);
    setReviewed(false);
  }
  return (
    <section className="lifecycle-form">
      <h3>Preserve the version you can explain</h3>
      <p>
        Select source files and lockfiles, record runtime and build
        requirements, and identify services that need separate recovery.
      </p>
      <UploadTool p={p} refresh={refresh} />
      <Feedback a={a} />
      <div className="form-row">
        <Field
          label="Runtime requirements"
          hint="For example, the Node.js version declared by your project. Leave unknown information empty."
        >
          <input
            value={options.runtime}
            onChange={(e) => change("runtime", e.target.value)}
            maxLength={400}
          />
        </Field>
        <Field label="Static output directory">
          <select
            value={options.outputDirectory}
            onChange={(e) => change("outputDirectory", e.target.value)}
          >
            {["dist", "build", "out", "public", "."].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Build instructions">
        <textarea
          rows={3}
          value={options.buildInstructions}
          onChange={(e) => change("buildInstructions", e.target.value)}
          maxLength={8000}
        />
      </Field>
      <Field label="External services and assets not preserved">
        <textarea
          rows={3}
          value={options.externalAssets}
          onChange={(e) => change("externalAssets", e.target.value)}
          placeholder="Database, API accounts, domains, video hosting, private registries…"
          maxLength={8000}
        />
      </Field>
      <Field label="Package retention">
        <select
          value={options.retentionDays}
          onChange={(e) => change("retentionDays", Number(e.target.value))}
        >
          <option value={0}>Until I remove it</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={365}>One year</option>
        </select>
      </Field>
      <Button
        busy={a.busy}
        disabled={!owner || !p.sourceId}
        onClick={() =>
          void a.run(async () => {
            const result = await api<PreservationPreview>(
              `bundles/${p.id}/preview`,
              "POST",
              options,
            );
            setPreview(result);
            setReviewed(false);
          }, "Contents ready for review")
        }
      >
        Review preservation contents
      </Button>
      {!owner ? (
        <p className="field-hint">
          An Owner must select files and create preservation packages.
        </p>
      ) : null}
      {preview ? (
        <>
          <div className="section-title">
            <h4>Eligible source files</h4>
            <Button
              onClick={() => {
                setOptions((o) => ({
                  ...o,
                  paths: preview.eligible.map((f) => f.path),
                }));
                setPreview(null);
              }}
            >
              Select all eligible files
            </Button>
          </div>
          <div className="preservation-files">
            {preview.eligible.map((f) => (
              <label key={f.path} className="check-row">
                <input
                  type="checkbox"
                  checked={options.paths.includes(f.path)}
                  onChange={(e) => {
                    setOptions((o) => ({
                      ...o,
                      paths: e.target.checked
                        ? [...o.paths, f.path]
                        : o.paths.filter((n) => n !== f.path),
                    }));
                    setReviewed(false);
                  }}
                />
                <span>
                  <strong>{f.path}</strong>
                  <small>
                    {size(f.size)} · SHA-256 {f.sha256.slice(0, 12)}
                  </small>
                  <details>
                    <summary>Preview file</summary>
                    <pre>
                      {f.preview}
                      {f.size > 500
                        ? "\n… preview shortened; included bytes remain exact."
                        : ""}
                    </pre>
                  </details>
                </span>
              </label>
            ))}
          </div>
          {p.screenshotIds.map((id, i) => (
            <label className="check-row" key={id}>
              <input
                type="checkbox"
                checked={options.screenshots.includes(id)}
                onChange={(e) => {
                  setOptions((o) => ({
                    ...o,
                    screenshots: e.target.checked
                      ? [...o.screenshots, id]
                      : o.screenshots.filter((v) => v !== id),
                  }));
                  setReviewed(false);
                }}
              />
              Include screenshot {i + 1} (review privately in project details
              first)
            </label>
          ))}
          <Notice>
            {preview.excluded.length} files excluded by the transfer policy.{" "}
            {preview.manifest.limitation}
          </Notice>
          <details>
            <summary>Selected version, notes and configuration names</summary>
            <pre>{JSON.stringify(preview.manifest, null, 2)}</pre>
          </details>
          <Button
            busy={a.busy}
            onClick={() =>
              void a.run(async () => {
                setPreview(
                  await api(`bundles/${p.id}/preview`, "POST", options),
                );
                setReviewed(false);
              }, "Updated preview ready")
            }
          >
            Refresh selected contents
          </Button>
          <label className="check-row">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the selected source, notes and screenshots and excluded
            credentials and customer data.
          </label>
          <Button
            className="primary"
            busy={a.busy}
            disabled={!owner || !reviewed || !options.paths.length}
            onClick={() =>
              void a.run(async () => {
                const current = await api<PreservationPreview>(
                  `bundles/${p.id}/preview`,
                  "POST",
                  options,
                );
                if (current.digest !== preview.digest) {
                  setPreview(current);
                  setReviewed(false);
                  throw new Error(
                    "Selection changed. Review the refreshed contents before preserving.",
                  );
                }
                const result = await api<{ bundle: Bundle }>(
                  `bundles/${p.id}/create`,
                  "POST",
                  { options, digest: preview.digest, reviewed: true },
                );
                refresh();
                onCreated(result.bundle.id);
              }, "Version preserved")
            }
          >
            Preserve
          </Button>
        </>
      ) : null}
    </section>
  );
}
function UploadTool({ p, refresh }: { p: Project; refresh: () => void }) {
  const [file, setFile] = useState<File | null>(null),
    [progress, setProgress] = useState(0),
    [session, setSession] = useState(""),
    a = useAction(),
    controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function upload() {
    const control = new AbortController();
    controller.current = control;
    await a.run(async () => {
      if (!file) throw new Error("Select the same ZIP to start or resume.");
      if (file.size > 100 * 1024 ** 2)
        throw new Error("ZIP packages are limited to 100 MB.");
      const digest = await browserSha(await file.arrayBuffer()),
        status = await api<{
          id: string;
          state: string;
          size: number;
          chunkSize: number;
          parts: { part: number; digest: string }[];
        }>("transfers", "POST", {
          projectId: p.id,
          name: file.name,
          size: file.size,
          digest,
        });
      setSession(status.id);
      if (status.state !== "completed")
        for (
          let offset = 0, part = 0;
          offset < file.size;
          offset += status.chunkSize, part++
        ) {
          if (control.signal.aborted)
            throw new Error(
              "Upload paused. Resume with the same ZIP; acknowledged chunks are retained for 24 hours.",
            );
          const chunk = await file
              .slice(offset, offset + status.chunkSize)
              .arrayBuffer(),
            chunkDigest = await browserSha(chunk);
          if (
            !status.parts.some(
              (c) => c.part === part && c.digest === chunkDigest,
            )
          )
            await retryTransfer(async () => {
              const response = await fetch(
                `/api/transfers/${status.id}/chunk/${part}`,
                {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/octet-stream",
                    "x-chunk-sha256": chunkDigest,
                    "x-chapter-workspace":
                      localStorage.getItem("chapter-workspace-v3") || "",
                  },
                  body: chunk,
                  signal: control.signal,
                },
              );
              if (!response.ok) {
                const r = await response.json();
                throw new Error(r.error || "Chunk upload failed.");
              }
            }, control.signal);
          setProgress(
            Math.round(
              (Math.min(offset + status.chunkSize, file.size) / file.size) *
                100,
            ),
          );
        }
      await api(`transfers/${status.id}/complete`, "POST");
      setProgress(100);
      refresh();
    }, "ZIP saved after chunk and full-file integrity checks. Sensitive files were filtered; the stored version may have a different checksum.");
    controller.current = null;
  }
  return (
    <div className="preservation-upload">
      <Field
        label="Resumable source ZIP"
        hint="100 MB maximum; 1 MB chunks. Staging is encrypted, counts toward storage, and expires after 24 hours."
      >
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={a.busy || p.role === "Viewer"}
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setProgress(0);
          }}
        />
      </Field>
      <Feedback a={a} />
      {a.busy || progress ? (
        <>
          <progress
            max={100}
            value={progress}
            aria-label="Source upload progress"
          />
          <p role="status">
            {progress}% chunks acknowledged · complete file checked before
            saving
          </p>
        </>
      ) : null}
      <div className="form-actions">
        <Button
          busy={a.busy}
          disabled={!file || p.role === "Viewer"}
          onClick={() => void upload()}
        >
          {session ? "Resume ZIP upload" : "Upload ZIP"}
        </Button>
        {a.busy ? (
          <Button onClick={() => controller.current?.abort()}>
            Pause upload
          </Button>
        ) : null}
        {session && !a.busy && progress < 100 ? (
          <Button
            onClick={() =>
              void a.run(async () => {
                await api(`transfers/${session}`, "DELETE");
                setSession("");
                setProgress(0);
                refresh();
              }, "Staged upload removed")
            }
          >
            Cancel staged upload
          </Button>
        ) : null}
      </div>
    </div>
  );
}
function VerifyTool({
  b,
  p,
  sandbox,
}: {
  b: Bundle;
  p: Project;
  sandbox: boolean;
}) {
  const r = useResource<{
      checks: { id: string; state: string; at: string; data: BuildEvidence }[];
    }>(`bundles/${b.id}/checks`),
    a = useAction(),
    [jobId, setJobId] = useState("");
  return (
    <section className="lifecycle-form">
      <h3>Verify the saved build</h3>
      <p>
        Supported: npm projects with package.json, package-lock.json and
        scripts.build at the selected source root. Install scripts and private
        registries are excluded; builds run without secrets or external service
        access.
      </p>
      <Notice>
        {sandbox
          ? "Runs in a temporary Vercel Sandbox with a three-minute limit. Sandbox usage is billed separately by Vercel."
          : "Vercel Sandbox is unavailable. Configure Vercel OIDC or VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID on the server. Requests will be recorded as Not Checked."}
      </Notice>
      <Feedback a={a} />
      <Button
        className="primary"
        busy={a.busy}
        disabled={p.role === "Viewer"}
        onClick={() =>
          void a.run(async () => {
            const result = await api<{ jobId: string }>(
              `bundles/${b.id}/verify`,
              "POST",
              {},
            );
            setJobId(result.jobId);
            r.reload();
          }, "Build check queued")
        }
      >
        Verify Build
      </Button>
      {jobId ? <JobStatus id={jobId} onFinished={r.reload} /> : null}
      <Loading r={r} />
      {!r.data?.checks.length ? (
        <div className="lifecycle-empty">
          No build evidence saved for this version.
        </div>
      ) : (
        r.data.checks.map((c) => (
          <article className="revival-check" key={c.id}>
            <div className="section-title">
              <strong>
                {c.data.buildVerified
                  ? "Build verified"
                  : c.data.result?.status || c.state}
              </strong>
              <span>{date(c.data.testedAt || c.at)}</span>
            </div>
            <p>
              {c.data.result?.detail || "Waiting for an isolated environment."}
            </p>
            <p>
              <strong>Application functionality: Not Checked</strong>
            </p>
            {c.data.result ? (
              <>
                <p>Next: {c.data.result.nextStep}</p>
                <p>
                  Tested runtime: {c.data.runtime} · package{" "}
                  {c.data.packageSha256}
                </p>
                <p>{c.data.limits}</p>
                <pre>
                  {c.data.logs?.join("\n") || "No build commands executed."}
                </pre>
                <small>
                  Logs retain diagnostic categories and exit codes; raw stdout
                  is excluded because it can contain private data.
                </small>
                <p>{c.data.artifactDetail}</p>
              </>
            ) : null}
          </article>
        ))
      )}
    </section>
  );
}
function RecreateTool({
  b,
  p,
  refresh,
}: {
  b: Bundle;
  p: Project;
  refresh: () => void;
}) {
  const r = useResource<{ recreations: Recreation[] }>(
      p.role === "Owner" ? `bundles/${b.id}/recreations` : null,
    ),
    a = useAction(),
    [name, setName] = useState(`${p.name.slice(0, 60)} · recreated`),
    [preview, setPreview] = useState<{
      expires: number;
      confirmation: string;
      effect: string;
      charges: string;
      requiredEnvNames: string[];
      services: unknown[];
      externalAssets: string;
    } | null>(null),
    [reviewed, setReviewed] = useState(false),
    [jobId, setJobId] = useState(""),
    [values, setValues] = useState<Record<string, string>>({}),
    [configReview, setConfigReview] = useState(false);
  return (
    <section className="lifecycle-form">
      <h3>Recreate an independent static application</h3>
      <p>
        Uses the checked output of this preserved version. Server applications,
        database restoration, custom domains and builds requiring secrets need
        external setup.
      </p>
      <Feedback a={a} />
      <Field label="New independent project name">
        <input
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            setPreview(null);
            setReviewed(false);
          }}
        />
      </Field>
      <Button
        busy={a.busy}
        disabled={p.role !== "Owner"}
        onClick={() =>
          void a.run(async () => {
            setPreview(
              await api(`bundles/${b.id}/recreate-preview`, "POST", { name }),
            );
            setReviewed(false);
          }, "Configuration ready for owner review")
        }
      >
        Preview recreation
      </Button>
      {preview ? (
        <div className="hosting-confirm">
          <p>{preview.effect}</p>
          <Notice>{preview.charges}</Notice>
          <p>
            Required names:{" "}
            {preview.requiredEnvNames.join(", ") ||
              "None recorded; review source to confirm."}
          </p>
          <p>External assets: {preview.externalAssets}</p>
          <pre>{JSON.stringify(preview.services, null, 2)}</pre>
          <label className="check-row">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the configuration and potential charges. I will use
            independent services and have reviewed the static output for
            references to production systems.
          </label>
          <Button
            className="primary"
            busy={a.busy}
            disabled={!reviewed}
            onClick={() =>
              void a.run(async () => {
                const result = await api<{ jobId: string }>(
                  `bundles/${b.id}/recreate`,
                  "POST",
                  {
                    name,
                    expires: preview.expires,
                    confirmation: preview.confirmation,
                    reviewed: true,
                  },
                );
                setJobId(result.jobId);
                setPreview(null);
                r.reload();
                refresh();
              }, "Independent recreation queued")
            }
          >
            Confirm Recreate Project
          </Button>
        </div>
      ) : null}
      {jobId ? (
        <JobStatus
          id={jobId}
          onFinished={() => {
            r.reload();
            refresh();
          }}
        />
      ) : null}
      <Loading r={r} />
      {r.data?.recreations.map((rec) => (
        <article className="revival-check" key={rec.id}>
          <h4>
            {rec.data.name} · {rec.state}
          </h4>
          <p>{rec.data.detail}</p>
          <p>
            New provider project:{" "}
            {rec.data.remoteId || "Awaiting provider result"}
          </p>
          {rec.data.url ? (
            <a
              className="button"
              href={rec.data.url}
              target="_blank"
              rel="noreferrer"
            >
              Open independent deployment
            </a>
          ) : null}
          {rec.state === "needs-configuration" ? (
            <>
              <Notice>
                Enter fresh values for independent services. Values are sent to
                Vercel encrypted preview settings and cleared from this form;
                they are not stored in Chapter or used in the saved static
                build.
              </Notice>
              {rec.data.requiredEnvNames.map((key) => (
                <Field key={key} label={key}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={values[key] || ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [key]: e.target.value }))
                    }
                  />
                </Field>
              ))}
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={configReview}
                  onChange={(e) => setConfigReview(e.target.checked)}
                />
                I reviewed these values and they belong to independent services.
              </label>
              <Button
                busy={a.busy}
                disabled={!configReview}
                onClick={() =>
                  void a.run(async () => {
                    try {
                      const result = await api<{ jobId: string }>(
                        `recreations/${rec.id}/configuration`,
                        "POST",
                        { values, reviewed: true },
                      );
                      setJobId(result.jobId);
                      r.reload();
                    } finally {
                      setValues({});
                      setConfigReview(false);
                    }
                  }, "Provider configuration names verified")
                }
              >
                Securely configure new project
              </Button>
            </>
          ) : rec.state !== "ready" ? (
            <Button
              busy={a.busy}
              onClick={() =>
                void a.run(async () => {
                  const result = await api<{ jobId: string }>(
                    `recreations/${rec.id}/check`,
                    "POST",
                    {},
                  );
                  setJobId(result.jobId);
                  r.reload();
                }, "Provider status check queued")
              }
            >
              Retry provider status
            </Button>
          ) : (
            <p className="field-hint">
              Deployment verified {date(rec.data.verifiedAt || rec.at)}. Test
              application behavior manually.
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
function ShareTool({
  b,
  p,
  refresh,
}: {
  b: Bundle;
  p: Project;
  refresh: () => void;
}) {
  const a = useAction(),
    [days, setDays] = useState(7),
    [reviewed, setReviewed] = useState(false),
    [url, setUrl] = useState(""),
    [retention, setRetention] = useState(0),
    r = useResource<{
      links: {
        id: string;
        expires: number;
        revoked: number;
        downloads: number;
        visits: number;
        at: string;
      }[];
      definition: string;
    }>(p.role === "Owner" ? `bundles/${b.id}/links` : null);
  return (
    <section className="lifecycle-form">
      <h3>Share this package version</h3>
      <p>
        Source download permission is granted only by this package link. Demo
        and project-page sharing do not grant access to it.
      </p>
      <Feedback a={a} />
      <a className="button" href={`/api/bundles/${b.id}/download`}>
        Review private ZIP download
      </a>
      <details>
        <summary>Review included files and notes</summary>
        <pre>{JSON.stringify(b.data, null, 2)}</pre>
      </details>
      <label className="check-row">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        I reviewed this exact package version and approve sharing the selected
        source and screenshots.
      </label>
      <Field label="Download link expires in">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
        </select>
      </Field>
      <Button
        className="primary"
        busy={a.busy}
        disabled={!reviewed || p.role !== "Owner"}
        onClick={() =>
          void a.run(async () => {
            const result = await api<{ token: string }>(
              `bundles/${b.id}/share`,
              "POST",
              { days, reviewed: true },
            );
            setUrl(`${location.origin}/package/${result.token}`);
            r.reload();
          }, "Expiring package link created")
        }
      >
        Share Package
      </Button>
      {url ? (
        <Field
          label="Copy this link now"
          hint="The token is shown once. Revoke it below if access changes."
        >
          <input value={url} readOnly onFocus={(e) => e.target.select()} />
        </Field>
      ) : null}
      <Loading r={r} />
      <p>{r.data?.definition}</p>
      {r.data?.links.map((l) => (
        <article className="revival-check" key={l.id}>
          <strong>
            {l.revoked
              ? "Revoked"
              : l.expires <= Date.now()
                ? "Expired"
                : "Active"}{" "}
            · expires {date(l.expires)}
          </strong>
          <p>
            {l.visits} page visits · {l.downloads} completed transfers
          </p>
          {!l.revoked ? (
            <Button
              busy={a.busy}
              onClick={() =>
                void a.run(async () => {
                  await api(`recreations/${l.id}/revoke-link`, "POST", {});
                  r.reload();
                  setUrl("");
                }, "Package link revoked")
              }
            >
              Revoke download link
            </Button>
          ) : null}
        </article>
      ))}
      <h4>Storage and retention</h4>
      <p>
        {size(b.data.bytes)} package ·{" "}
        {b.expires
          ? `retained until ${date(b.expires)}`
          : "retained until you remove it"}
        . Earlier source snapshots remain versioned; removing this bundle does
        not remove those records.
      </p>
      <Field label="Update package retention">
        <select
          value={retention}
          onChange={(e) => setRetention(Number(e.target.value))}
        >
          <option value={0}>Until removed</option>
          <option value={30}>30 days from now</option>
          <option value={90}>90 days from now</option>
          <option value={365}>One year from now</option>
        </select>
      </Field>
      <Button
        disabled={p.role !== "Owner"}
        busy={a.busy}
        onClick={() =>
          void a.run(async () => {
            await api(`bundles/${b.id}/retention`, "POST", { days: retention });
            refresh();
          }, "Retention updated")
        }
      >
        Save retention
      </Button>
      <Button
        disabled={p.role !== "Owner"}
        busy={a.busy}
        onClick={() =>
          void a.run(async () => {
            await api(`bundles/${b.id}`, "DELETE");
            refresh();
          }, "Package bytes removed and links revoked")
        }
      >
        Remove package and revoke its links
      </Button>
    </section>
  );
}
function ServicesTool() {
  const r = useResource<{
      services: {
        id: string;
        name: string;
        kind: string;
        data: { notes: string };
        restricted: boolean;
        relationships: {
          projectId: string;
          projectName: string;
          origin: string;
          evidence: string;
          at: string;
        }[];
      }[];
      projects: { id: string; name: string }[];
      limitation: string;
    }>("dependencies"),
    a = useAction(),
    [name, setName] = useState(""),
    [kind, setKind] = useState("Database"),
    [notes, setNotes] = useState(""),
    [origin, setOrigin] = useState("Manual"),
    [projects, setProjects] = useState<string[]>([]);
  return (
    <section className="lifecycle-form">
      <h3>Document shared services</h3>
      <Loading r={r} />
      <Feedback a={a} />
      <Notice>{r.data?.limitation}</Notice>
      <div className="form-row">
        <Field label="Shared service name">
          <input
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Service type">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {["Hosting", "Database", "API", "Domain", "Storage", "Other"].map(
              (v) => (
                <option key={v}>{v}</option>
              ),
            )}
          </select>
        </Field>
      </div>
      <Field label="Relationship evidence">
        <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
          <option>Manual</option>
          <option>Unknown</option>
        </select>
      </Field>
      <Field label="Service notes (names and context only)">
        <textarea
          value={notes}
          maxLength={4000}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="No passwords, connection strings or customer data."
        />
      </Field>
      <fieldset>
        <legend>Projects that depend on this service</legend>
        {r.data?.projects.map((p) => (
          <label className="check-row" key={p.id}>
            <input
              type="checkbox"
              checked={projects.includes(p.id)}
              onChange={(e) =>
                setProjects((old) =>
                  e.target.checked
                    ? [...old, p.id]
                    : old.filter((id) => id !== p.id),
                )
              }
            />
            {p.name}
          </label>
        ))}
      </fieldset>
      <div className="form-actions">
        <Button
          className="primary"
          busy={a.busy}
          disabled={!name || !projects.length}
          onClick={() =>
            void a.run(async () => {
              await api("dependencies", "POST", {
                name,
                kind,
                notes,
                origin,
                projects,
              });
              setName("");
              setNotes("");
              setProjects([]);
              r.reload();
            }, "Dependency documented")
          }
        >
          Save service relationships
        </Button>
        <Button
          busy={a.busy}
          onClick={() =>
            void a.run(async () => {
              const result = await api<{ detail: string }>(
                "dependencies/import",
                "POST",
                {},
              );
              r.reload();
              return result;
            }, "Hosting evidence import completed; review the map")
          }
        >
          Import reliable hosting identities
        </Button>
      </div>
      {!r.data?.services.length ? (
        <div className="lifecycle-empty">
          No shared relationships recorded. Unknown dependencies cannot be ruled
          out.
        </div>
      ) : (
        r.data.services.map((s) => (
          <article className="revival-check" key={s.id}>
            <h4>
              {s.name} · {s.kind}
            </h4>
            <p>{s.data.notes}</p>
            {s.relationships.map((l) => (
              <p key={l.projectId}>
                <strong>
                  {l.projectName} · {l.origin}
                </strong>
                <br />
                {l.evidence}
                <br />
                <small>Updated {date(l.at)}</small>
              </p>
            ))}
            {s.restricted ? (
              <p>Additional relationships are outside your access scope.</p>
            ) : (
              <Button
                busy={a.busy}
                onClick={() =>
                  void a.run(async () => {
                    await api(`dependencies/${s.id}`, "DELETE");
                    r.reload();
                  }, "Relationship record removed; no external service changed")
                }
              >
                Remove relationship record
              </Button>
            )}
          </article>
        ))
      )}
    </section>
  );
}
