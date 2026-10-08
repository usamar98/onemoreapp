"use client";
import {
  useEffect,
  useRef,
  useId,
  isValidElement,
  cloneElement,
  type ReactNode,
} from "react";
import {
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Layers,
  Music2,
  Code2,
  Map,
  Palette,
  BookOpen,
} from "lucide-react";
import Image from "next/image";
import type { Project, Status } from "@/lib/types";
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-mark">
        <Layers size={25} strokeWidth={2.1} />
      </span>
      <span>
        chapter<span className="brand-period">.</span>
      </span>
    </span>
  );
}
export function Badge({ status }: { status: Status }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      <span />
      {status}
    </span>
  );
}
export function ProjectIcon({
  project,
  size = 20,
}: {
  project: Pick<Project, "name" | "color">;
  size?: number;
}) {
  const Icon =
    project.color === "violet"
      ? Layers
      : project.color === "sand"
        ? BookOpen
        : project.color === "mint"
          ? Music2
          : project.color === "blue"
            ? Code2
            : project.color === "peach"
              ? Map
              : Palette;
  return (
    <span className={`project-icon ${project.color}`}>
      <Icon size={size} />
    </span>
  );
}
export function Button({
  children,
  busy = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`button ${className}`}
    >
      {busy ? <Loader2 size={16} className="spin" /> : null}
      {children}
    </button>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const control =
    isValidElement<{ "aria-labelledby"?: string; "aria-describedby"?: string }>(
      children,
    ) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type)
      ? cloneElement(children, {
          "aria-labelledby": `${id}-label`,
          "aria-describedby": hint ? `${id}-hint` : undefined,
        })
      : children;
  return (
    <label className="field">
      <span id={`${id}-label`}>{label}</span>
      {control}
      {hint ? <small id={`${id}-hint`}>{hint}</small> : null}
    </label>
  );
}
export function Panel({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      queueMicrotask(() => {
        const rect = prior?.getBoundingClientRect();
        const mobileMenu = document.querySelector<HTMLElement>(".mobile-menu");
        const closedMobileNavigation =
          prior?.closest(".sidebar:not(.sidebar-open)") &&
          mobileMenu &&
          getComputedStyle(mobileMenu).display !== "none";
        if (
          prior?.isConnected &&
          prior !== document.body &&
          !closedMobileNavigation &&
          rect &&
          rect.width &&
          rect.height &&
          rect.right > 0 &&
          rect.left < window.innerWidth &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight
        )
          prior.focus();
        else mobileMenu?.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`panel ${wide ? "panel-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="panel-shell">
        <header className="panel-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button
            onClick={onClose}
            className="icon-button"
            aria-label="Close panel"
          >
            <X size={21} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Notice({
  children,
  kind = "info",
}: {
  children: ReactNode;
  kind?: "info" | "error" | "success";
}) {
  if (!children) return null;
  return (
    <div
      className={`notice notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {kind === "error" ? (
        <AlertCircle size={17} />
      ) : (
        <CheckCircle2 size={17} />
      )}
      <div>{children}</div>
    </div>
  );
}
export function Preview({ project }: { project: Project }) {
  if (project.screenshotIds.length)
    return (
      <div className="project-preview user-preview">
        <Image
          src={`/api/files/${project.screenshotIds[0]}`}
          alt={`${project.name} screenshot`}
          fill
          unoptimized
          sizes="(max-width: 700px) 90vw, 350px"
        />
      </div>
    );
  return (
    <div
      className={`project-preview preview-${project.color}`}
      aria-label={`${project.name} cover`}
    >
      {project.color === "violet" ? (
        <div className="mini-orbit">
          <div className="mini-orbit-nav">
            <Layers size={12} /> orbit<span>Components</span>
            <span>Docs ↗</span>
          </div>
          <div className="mini-orbit-body">
            <span className="mini-caption">YOUR NEXT BUILD STARTS HERE</span>
            <strong>
              Small pieces.
              <br />
              Infinite possibilities.
            </strong>
            <div className="mini-orbit-widgets">
              <div className="mini-widget">
                <span className="mini-avatar">J</span>
                <i />
                <i />
              </div>
              <div className="mini-widget widget-purple">
                Make it yours <span>↗</span>
              </div>
              <div className="mini-widget mini-bars">
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {project.color === "sand" ? (
        <div className="mini-devlog">
          <div className="mini-devlog-nav">
            devlog<span>About &nbsp; Archive &nbsp; ↗</span>
          </div>
          <span className="mini-caption">
            THOUGHTS, BUILDS & LITTLE DISCOVERIES
          </span>
          <strong>
            Notes from
            <br />
            the workbench<span>.</span>
          </strong>
          <div className="mini-devlog-bottom">
            A developer's notebook, in public.
            <div className="doodle-flower">✳</div>
          </div>
        </div>
      ) : null}
      {project.color === "mint" ? (
        <div className="mini-focus">
          <span className="focus-brand">
            <Music2 size={12} /> focus.fm
          </span>
          <div className="focus-blobs">
            <i />
            <i />
            <i />
          </div>
          <span className="mini-caption">A LITTLE SPACE TO FOCUS</span>
          <strong>25:00</strong>
          <span className="focus-play">▶</span>
          <div className="focus-channels">
            ☂ Rain &nbsp;&nbsp; ♧ Forest &nbsp;&nbsp; ≋ Waves
          </div>
        </div>
      ) : null}
      {project.color === "blue" ? (
        <div className="mini-code">
          <div className="mini-code-head">
            <Code2 size={12} /> snippet stash <span>● ● ●</span>
          </div>
          <div className="mini-code-body">
            <span className="code-line">
              1 &nbsp; <b>const</b> littleThings = {"{"}
            </span>
            <span className="code-line">
              2 &nbsp; &nbsp; ideas: <i>"worth keeping"</i>,
            </span>
            <span className="code-line">
              3 &nbsp; &nbsp; snippets: <em>Infinity</em>,
            </span>
            <span className="code-line">
              4 &nbsp; &nbsp; readyFor: <i>"what's next"</i>
            </span>
            <span className="code-line">5 &nbsp; {"}"};</span>
          </div>
          <div className="mini-code-footer">
            TypeScript <span>Saved to your collection ✓</span>
          </div>
        </div>
      ) : null}
      {project.color === "peach" ? (
        <div className="mini-atlas">
          <div className="mini-atlas-nav">
            <Map size={12} /> atlas<span>YOUR PLACES, YOUR PACE</span>
          </div>
          <strong>
            Take the
            <br />
            scenic route.
          </strong>
          <svg viewBox="0 0 350 120" aria-hidden="true">
            <path
              d="M0 120L75 35L130 76L190 10L270 85L330 42L350 80V120"
              fill="#cfad8d"
            />
            <path
              d="M0 120L60 90L150 50L250 110L305 65L350 100V120"
              fill="#8e9d86"
            />
            <path
              d="M180 120Q120 85 200 77T255 64"
              fill="none"
              stroke="#f4e4cf"
              strokeWidth="9"
            />
          </svg>
        </div>
      ) : null}
      {project.color === "pink" ? (
        <div className="mini-palette">
          <div className="mini-palette-nav">
            <Palette size={12} /> Palette Lab <span>Save palette ↗</span>
          </div>
          <strong>A little color goes a long way.</strong>
          <div className="palette-swatches">
            {["#d5ded1", "#e9ddc6", "#dcaa97", "#b07c76", "#696f63"].map(
              (c) => (
                <div key={c} style={{ background: c }}>
                  <span>{c.toUpperCase()}</span>
                </div>
              ),
            )}
          </div>
        </div>
      ) : null}
      <span className="cover-label">Project cover</span>
    </div>
  );
}
export async function api<T = Record<string, unknown>>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: {
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(localStorage.getItem("chapter-workspace-v3")
        ? {
            "x-chapter-workspace": localStorage.getItem(
              "chapter-workspace-v3",
            )!,
          }
        : {}),
    },
    body: body
      ? body instanceof FormData
        ? body
        : JSON.stringify(body)
      : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      (result.error || "Please try again.") +
        (response.status >= 500 && result.requestId
          ? " Support reference: " + result.requestId + "."
          : ""),
    );
  return result;
}
export function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
