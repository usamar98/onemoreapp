"use client";
import { useState, useRef, useMemo, useEffect } from "react";
import {
  LayoutGrid,
  FolderKanban,
  ListOrdered,
  Pause,
  Archive,
  Plug,
  History,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  SlidersHorizontal,
  Grid2X2,
  List,
  ArrowUpRight,
  LockKeyhole,
  Globe,
  MoreHorizontal,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Play,
  Sprout,
  ArrowRight,
  Menu,
  X,
  CircleHelp,
  LogOut,
  Check,
  Sparkles,
  BookOpen,
  Leaf,
  Command,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import {
  Brand,
  Badge,
  ProjectIcon,
  Preview,
  Button,
  Panel,
  Notice,
  api,
} from "./ui";
import {
  ProjectEditor,
  SharePanel,
  ParkPanel,
  ResumePanel,
  DetailsPanel,
  IntegrationsPanel,
} from "./project-panels";
import type { Workspace, Project, Status } from "@/lib/types";
import { LifecyclePanel } from "./lifecycle-panel";
import { timeWindows, suggestions, taskFor } from "@/lib/planning";
import dynamic from "next/dynamic";
import { knowledgeTools, type KnowledgeTool } from "./knowledge-panels";
import { AccountSecurity } from "./security-forms";
const KnowledgePanel = dynamic(() =>
  import("./knowledge-panels").then((m) => m.KnowledgePanel),
);
type View = "all" | "queue" | "parked" | "archived" | "activity";
const LaunchPanel = dynamic(() =>
  import("./launch-panels").then((m) => m.LaunchPanel),
);
const ContinuationPanel = dynamic(() =>
  import("./continuation-panel").then((m) => m.ContinuationPanel),
);
const PreservationPanel = dynamic(() =>
  import("./preservation-panel").then((m) => m.PreservationPanel),
);
const QuickPublishPanel = dynamic(() =>
  import("./quick-publish-panel").then((m) => m.QuickPublishPanel),
);
type OpenPanel =
  | {
      kind:
        "new" | "edit" | "share" | "park" | "resume" | "details" | "lifecycle";
      project?: Project;
    }
  | { kind: "integrations" | "help" | "account" }
  | { kind: "knowledge"; tool: KnowledgeTool; project?: Project }
  | { kind: "launch"; project?: Project; tool?: "support" }
  | { kind: "continuation"; project?: Project }
  | { kind: "preservation"; project?: Project }
  | { kind: "quick-publish"; project?: Project };
export function Dashboard({ initial }: { initial: Workspace }) {
  const [activeWorkspace, setActiveWorkspace] = useState(
    initial.user?.id || "",
  );
  useEffect(() => {
    if (initial.user)
      localStorage.setItem("chapter-workspace-v3", initial.user.id);
    const params = new URL(window.location.href).searchParams;
    if (params.get("invite")) setPanel({ kind: "knowledge", tool: "team" });
    if (params.get("billing")) setPanel({ kind: "knowledge", tool: "billing" });
    if (params.get("tool") === "support")
      setPanel({ kind: "launch", tool: "support" });
    const p = initial.projects.find((p) => p.id === params.get("project"));
    if (p) {
      setActiveWorkspace(p.workspaceOwner || initial.user?.id || "");
      setPanel({ kind: "details", project: p });
    }
  }, [initial]);
  useEffect(() => {
    if (activeWorkspace)
      localStorage.setItem("chapter-workspace-v3", activeWorkspace);
  }, [activeWorkspace]);
  const [workspace, setWorkspace] = useState(initial),
    [view, setView] = useState<View>("all"),
    [status, setStatus] = useState<Status | "All">("All");
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("recent"),
    [layout, setLayout] = useState<"grid" | "list">("grid"),
    [panel, setPanel] = useState<OpenPanel | null>(null);
  const [timeFilter, setTimeFilter] = useState<
    keyof typeof timeWindows | "All tasks"
  >("All tasks");
  const taskSuggestions = useMemo(
    () =>
      timeFilter === "All tasks"
        ? []
        : suggestions(workspace.projects, timeWindows[timeFilter]),
    [workspace.projects, timeFilter],
  );
  const [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [filterOpen, setFilterOpen] = useState(false),
    [tagFilter, setTagFilter] = useState("All tags"),
    [menuId, setMenuId] = useState("");
  const searchRef = useRef<HTMLInputElement>(null),
    dragged = useRef("");
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const projects = workspace.projects.filter(
      (p) =>
        !workspace.user ||
        !activeWorkspace ||
        p.workspaceOwner === activeWorkspace,
    ),
    queue = projects
      .filter((p) => p.queued && p.status !== "Archived")
      .sort((a, b) => a.priority - b.priority);
  const counts = Object.fromEntries(
    ["Idea", "Building", "Live", "Parked", "Archived"].map((s) => [
      s,
      projects.filter((p) => p.status === s).length,
    ]),
  );
  const filtered = useMemo(
    () =>
      projects
        .filter((p) =>
          view === "archived"
            ? p.status === "Archived"
            : view === "parked"
              ? p.status === "Parked"
              : view === "queue"
                ? timeFilter !== "All tasks"
                  ? taskSuggestions.some((s) => s.project.id === p.id)
                  : p.queued && p.status !== "Archived"
                : p.status !== "Archived",
        )
        .filter((p) => status === "All" || p.status === status)
        .filter((p) => tagFilter === "All tags" || p.tags.includes(tagFilter))
        .filter((p) =>
          `${p.name} ${p.description} ${p.tags.join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          view === "queue" && timeFilter !== "All tasks"
            ? taskSuggestions.findIndex((s) => s.project.id === a.id) -
              taskSuggestions.findIndex((s) => s.project.id === b.id)
            : sort === "name"
              ? a.name.localeCompare(b.name)
              : sort === "priority"
                ? a.priority - b.priority
                : b.updatedAt.localeCompare(a.updatedAt),
        ),
    [
      projects,
      view,
      status,
      tagFilter,
      query,
      sort,
      timeFilter,
      taskSuggestions,
    ],
  );
  const selected =
    panel && "project" in panel && panel.project
      ? projects.find((p) => p.id === panel.project!.id) || panel.project
      : null;
  function notify(message: string) {
    setToast(message);
    setTimeout(() => setToast(""), 4500);
  }
  async function refresh() {
    try {
      const result = await api<Workspace>("workspace");
      setWorkspace(result);
      if (
        result.user &&
        !result.workspaces?.some((w) => w.id === activeWorkspace)
      )
        setActiveWorkspace(result.user.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function ensure(): Promise<Workspace> {
    if (workspace.user) return workspace;
    setBusy(true);
    try {
      await api("auth/demo", "POST");
      const result = await api<Workspace>("workspace");
      setWorkspace(result);
      if (result.user) {
        setActiveWorkspace(result.user.id);
        localStorage.setItem("chapter-workspace-v3", result.user.id);
      }
      notify("Your personal demo workspace is ready.");
      return result;
    } finally {
      setBusy(false);
    }
  }
  async function open(
    kind:
      "new" | "edit" | "share" | "park" | "resume" | "details" | "lifecycle",
    project?: Project,
  ) {
    setMenuId("");
    setError("");
    try {
      const ws = kind === "details" ? workspace : await ensure();
      const actual = project
        ? ws.projects.find((p) => p.id === project.id) ||
          ws.projects.find((p) => p.name === project.name)
        : undefined;
      if (
        actual?.role === "Viewer" &&
        ["edit", "park", "resume"].includes(kind)
      )
        throw new Error(
          "Viewer access is read-only. Ask an Editor or Owner to update this project.",
        );
      if (actual?.role && actual.role !== "Owner" && kind === "share")
        throw new Error("Only a project Owner can manage sharing.");
      setPanel({ kind, project: actual });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function openQuickPublish(project?: Project) {
    setError("");
    try {
      const ws = await ensure();
      const actual = project
        ? ws.projects.find((p) => p.id === project.id) ||
          ws.projects.find((p) => p.name === project.name)
        : undefined;
      setPanel({ kind: "quick-publish", project: actual });
      setMobileNav(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  function saved(project: Project, message?: string) {
    setWorkspace((s) => ({
      ...s,
      projects: s.projects.some((p) => p.id === project.id)
        ? s.projects.map((p) => (p.id === project.id ? project : p))
        : [project, ...s.projects],
    }));
    if (message) notify(message);
    void refresh();
  }
  function navigate(next: View) {
    setView(next);
    setStatus("All");
    setTagFilter("All tags");
    setQuery("");
    setTimeFilter("All tasks");
    setMobileNav(false);
  }
  async function toggleQueue(project: Project) {
    setMenuId("");
    try {
      const ws = await ensure(),
        actual =
          ws.projects.find((p) => p.id === project.id) ||
          ws.projects.find((p) => p.name === project.name)!;
      const r = await api<{ project: Project }>(
        `projects/${actual.id}`,
        "PATCH",
        { queued: !actual.queued },
      );
      saved(
        r.project,
        actual.queued
          ? "Removed from your queue"
          : "Added to your priority queue",
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function reorder(from: string, to: string) {
    if (from === to) return;
    try {
      const ws = await ensure(),
        actualQueue = ws.projects
          .filter((p) => p.queued && p.status !== "Archived")
          .sort((a, b) => a.priority - b.priority);
      const fromName = projects.find((p) => p.id === from)?.name,
        toName = projects.find((p) => p.id === to)?.name;
      const actualFrom = actualQueue.find(
          (p) => p.id === from || p.name === fromName,
        )?.id,
        actualTo = actualQueue.find(
          (p) => p.id === to || p.name === toName,
        )?.id;
      const ids = actualQueue.map((p) => p.id),
        at = ids.indexOf(actualFrom || ""),
        target = ids.indexOf(actualTo || "");
      if (at < 0 || target < 0) return;
      ids.splice(at, 1);
      ids.splice(target, 0, actualFrom!);
      const r = await api<{ projects: Project[] }>("projects/reorder", "POST", {
        ids,
      });
      setWorkspace((s) => ({ ...s, projects: r.projects }));
      notify("Priority queue updated");
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const parked = projects
    .filter((p) => p.status === "Parked")
    .sort((a, b) =>
      (a.memory?.returnDate || "9999").localeCompare(
        b.memory?.returnDate || "9999",
      ),
    )[0];
  const title =
    view === "all"
      ? "Your projects"
      : view === "parked"
        ? "Parked, with a plan"
        : view === "archived"
          ? "Past chapters"
          : view === "queue"
            ? "Your priority queue"
            : "Workspace activity";
  return (
    <div
      className="app-shell"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "k") {
          e.preventDefault();
          searchRef.current?.focus();
        }
      }}
    >
      {mobileNav ? (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      ) : null}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <Link href="/" className="brand-link" aria-label="Chapter home">
          <Brand />
        </Link>
        <button
          className="workspace-switch"
          onClick={() => setPanel({ kind: "account" })}
        >
          <span className="workspace-avatar">
            {workspace.user?.name.charAt(0) || "P"}
          </span>
          <span>
            {workspace.user?.demo
              ? "Demo workspace"
              : workspace.user
                ? "Personal workspace"
                : "Personal workspace"}
            <small>
              {workspace.user && !workspace.user.demo
                ? "Free plan"
                : "A little room to build"}
            </small>
          </span>
          <ChevronDown size={15} />
        </button>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          <button
            className={view === "all" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("all")}
          >
            <LayoutGrid size={18} />
            Overview
          </button>
          <button
            className="nav-item"
            onClick={() => {
              navigate("all");
              searchRef.current?.focus();
            }}
          >
            <FolderKanban size={18} />
            All projects
            <span className="nav-count">
              {projects.filter((p) => p.status !== "Archived").length}
            </span>
          </button>
          <button
            className={view === "queue" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("queue")}
          >
            <ListOrdered size={18} />
            Priority queue<span className="nav-count">{queue.length}</span>
          </button>
          <button
            className={view === "parked" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("parked")}
          >
            <Pause size={18} />
            Parked projects<span className="nav-count">{counts.Parked}</span>
          </button>
          <button
            className={view === "archived" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("archived")}
          >
            <Archive size={18} />
            Archive
          </button>
        </nav>
        <span className="nav-label tools-label">TOOLS</span>
        <nav aria-label="Workspace tools">
          <button className="nav-item" onClick={() => openQuickPublish()}>
            <UploadCloud size={18} /> Quick Publish
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setPanel({ kind: "preservation" });
              setMobileNav(false);
            }}
          >
            <Archive size={18} />
            Preserve & rebuild
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setPanel({ kind: "launch" });
              setMobileNav(false);
            }}
          >
            <Sparkles size={18} />
            Launch & automation
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setPanel({ kind: "continuation" });
              setMobileNav(false);
            }}
          >
            <Play size={18} /> Continue & learn
          </button>
          {knowledgeTools.map(({ id, label, Icon }) => (
            <button
              key={id}
              className="nav-item"
              onClick={() => {
                setPanel({ kind: "knowledge", tool: id });
                setMobileNav(false);
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
          <button
            className="nav-item"
            onClick={async () => {
              try {
                await ensure();
                setPanel({ kind: "integrations" });
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <Plug size={18} />
            Integrations<span className="nav-new">NEW</span>
          </button>
          <button
            className={view === "activity" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("activity")}
          >
            <History size={18} />
            Activity
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Sprout size={23} />
            <strong>A pause isn’t the end.</strong>
            <p>
              Good projects sometimes
              <br />
              need a little breathing room.
            </p>
            <button onClick={() => setPanel({ kind: "help" })}>
              Meet your next chapter <ArrowUpRight size={13} />
            </button>
          </div>
          <button
            className="help-nav"
            onClick={() => setPanel({ kind: "help" })}
          >
            <CircleHelp size={17} />
            Help & getting started
            <ArrowUpRight size={14} />
          </button>
          <button
            className="account-row"
            onClick={() => setPanel({ kind: "account" })}
          >
            <span className="user-avatar">
              {workspace.user
                ? workspace.user.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                : "AM"}
            </span>
            <span>
              <strong>{workspace.user?.name || "Alex Morgan"}</strong>
              <small>
                {workspace.user?.demo
                  ? "Personal demo"
                  : workspace.user
                    ? "Your workspace"
                    : "Demo preview"}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {view === "all"
                ? "Overview"
                : view === "activity"
                  ? "Activity"
                  : view === "archived"
                    ? "Archive"
                    : view === "queue"
                      ? "Priority queue"
                      : "Parked projects"}
            </strong>
          </div>
          <div className="topbar-actions">
            <button
              className="global-search"
              onClick={() => searchRef.current?.focus()}
            >
              <Search size={15} />
              <span>Find a project...</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="topbar-separator" />
            {workspace.user && !workspace.user.demo ? (
              <span className="workspace-private">
                <LockKeyhole size={14} /> Your private workspace
              </span>
            ) : (
              <Link className="signin-link" href="/signup">
                Create an account <ArrowUpRight size={14} />
              </Link>
            )}
          </div>
        </header>
        <main className="dashboard-main" id="main-content" tabIndex={-1}>
          {workspace.user && workspace.workspaces?.length ? (
            <div className="workspace-selector-bar">
              <label htmlFor="workspace-choice">Workspace</label>
              <select
                id="workspace-choice"
                value={activeWorkspace || workspace.user.id}
                onChange={(e) => {
                  setActiveWorkspace(e.target.value);
                  setPanel(null);
                }}
              >
                {workspace.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {w.role}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="page-heading">
            <div>
              <div className="heading-eyebrow">ROOM FOR EVERY IDEA</div>
              <h1>
                {title}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {view === "all"
                  ? "Big ideas, side quests, and everything in between."
                  : view === "parked"
                    ? "A little context now. A smoother start next time."
                    : view === "queue"
                      ? "Choose what gets your attention next."
                      : view === "archived"
                        ? "A place for projects that have had their moment."
                        : "The small steps that move your projects forward."}
              </p>
            </div>
            <div className="page-actions">
              <Button busy={busy} onClick={() => openQuickPublish()}>
                <UploadCloud size={17} /> Quick Publish
              </Button>
              <Button
                className="primary add-project"
                busy={busy}
                onClick={() => open("new")}
              >
                <Plus size={17} />
                New project
              </Button>
            </div>
          </div>
          {error ? (
            <div className="dashboard-error">
              <Notice kind="error">{error}</Notice>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          ) : null}
          {view === "all" ? (
            <section className="welcome-banner">
              <div className="welcome-copy">
                <span className="banner-eyebrow">
                  <Leaf size={13} /> BUILT FOR WHAT’S NEXT
                </span>
                <h2>Every project has another chapter.</h2>
                <p>Keep every project ready for its next chapter.</p>
                <button
                  onClick={async () => {
                    try {
                      if (!workspace.user) await ensure();
                      else setPanel({ kind: "help" });
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                >
                  {workspace.user
                    ? "Make a little progress today"
                    : "Try your own workspace"}
                  <ArrowRight size={14} />
                </button>
              </div>
              <div className="chapter-art" aria-hidden="true">
                <span className="art-spark spark-one">✳</span>
                <span className="art-spark spark-two">✦</span>
                <div className="art-orbit" />
                <div className="art-card art-card-back">
                  <CodeGlyph />
                </div>
                <div className="art-card art-card-front">
                  <span className="art-card-icon">
                    <BookOpen size={25} />
                  </span>
                  <div className="art-line" />
                  <div className="art-line short" />
                  <span className="art-card-status">
                    <span /> Ready for what’s next
                  </span>
                </div>
                <span className="art-small-check">
                  <Check size={16} />
                </span>
              </div>
            </section>
          ) : null}
          {view === "activity" ? (
            <section className="activity-view">
              <h2>A little progress, remembered.</h2>
              {workspace.activity.length ? (
                workspace.activity.map((a) => (
                  <div className="activity-item" key={a.id}>
                    <span
                      className={`activity-icon ${a.kind === "park" ? "violet" : "mint"}`}
                    >
                      {a.kind === "park" ? (
                        <Pause size={16} />
                      ) : a.kind === "resume" ? (
                        <Play size={16} />
                      ) : (
                        <History size={16} />
                      )}
                    </span>
                    <span>
                      {a.text}
                      <small>
                        {new Date(a.at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: "Asia/Karachi",
                        })}
                      </small>
                    </span>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <History size={35} />
                  <h3>A fresh start</h3>
                  <p>
                    Your imports, shares, pauses, and returns will appear here.
                  </p>
                </div>
              )}
            </section>
          ) : (
            <div className="dashboard-columns">
              <section className="projects-section">
                <div
                  className="project-tabs"
                  role="tablist"
                  aria-label="Filter by project status"
                >
                  {(view === "all"
                    ? ["All", "Building", "Live", "Parked", "Idea"]
                    : ["All"]
                  ).map((s) => (
                    <button
                      key={s}
                      role="tab"
                      aria-selected={status === s}
                      onClick={() => setStatus(s as Status | "All")}
                      className={status === s ? "selected" : ""}
                    >
                      {s === "All" ? "All projects" : s}
                      <span>
                        {s === "All"
                          ? projects.filter((p) =>
                              view === "archived"
                                ? p.status === "Archived"
                                : view === "parked"
                                  ? p.status === "Parked"
                                  : view === "queue"
                                    ? p.queued && p.status !== "Archived"
                                    : p.status !== "Archived",
                            ).length
                          : counts[s]}
                      </span>
                    </button>
                  ))}
                </div>
                {view === "queue" ? (
                  <section className="smart-queue">
                    <h2>A task that fits your time.</h2>
                    <div
                      className="time-filters"
                      aria-label="Available task time"
                    >
                      {["All tasks", ...Object.keys(timeWindows)].map(
                        (label) => (
                          <button
                            key={label}
                            aria-pressed={timeFilter === label}
                            onClick={() => {
                              setTimeFilter(label as typeof timeFilter);
                              setSort("priority");
                            }}
                          >
                            {label}
                          </button>
                        ),
                      )}
                    </div>
                    <p>
                      {timeFilter === "All tasks"
                        ? "Your priority queue is below. Open Next chapter controls to record each next task, estimate and blocker."
                        : `Suggestions across your projects use an owner estimate of at most ${timeWindows[timeFilter]} minutes, recorded priority and no recorded blockers. Weekend means up to eight hours. These are estimates, not promises.`}
                    </p>
                    {timeFilter !== "All tasks" && !taskSuggestions.length ? (
                      <Notice>
                        No recorded tasks fit this time yet. Add a next task and
                        estimate, or resolve its blockers.
                      </Notice>
                    ) : null}
                  </section>
                ) : null}
                {view === "parked" &&
                projects.some(
                  (p) =>
                    p.status === "Parked" &&
                    (p.interest?.signups || 0) + (p.interest?.enquiries || 0) >
                      0,
                ) ? (
                  <Notice>
                    Some parked projects have recorded signups or enquiries.
                    Open their Next chapter controls to review interest
                    privately.
                  </Notice>
                ) : null}
                <div className="project-toolbar">
                  <div className="project-search">
                    <Search size={16} />
                    <input
                      ref={searchRef}
                      aria-label="Search projects"
                      placeholder="Search your projects..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query ? (
                      <button
                        className="icon-button"
                        aria-label="Clear search"
                        onClick={() => setQuery("")}
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>
                  <div className="filter-container">
                    <Button
                      className={
                        filterOpen || tagFilter !== "All tags"
                          ? "filter-active"
                          : ""
                      }
                      onClick={() => setFilterOpen((s) => !s)}
                      aria-expanded={filterOpen}
                    >
                      <SlidersHorizontal size={15} />
                      <span className="filter-text">Filters</span>
                    </Button>
                    {filterOpen ? (
                      <div className="filter-dropdown">
                        <label>
                          Project tag
                          <select
                            value={tagFilter}
                            onChange={(e) => setTagFilter(e.target.value)}
                          >
                            <option>All tags</option>
                            {Array.from(
                              new Set(projects.flatMap((p) => p.tags)),
                            ).map((t) => (
                              <option key={t}>{t}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Sort by
                          <select
                            value={sort}
                            onChange={(e) => setSort(e.target.value)}
                          >
                            <option value="recent">Recently updated</option>
                            <option value="name">Name, A to Z</option>
                            <option value="priority">Queue priority</option>
                          </select>
                        </label>
                        <Button
                          onClick={() => {
                            setTagFilter("All tags");
                            setSort("recent");
                            setFilterOpen(false);
                          }}
                        >
                          Reset filters
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="view-toggle" aria-label="Project layout">
                    <button
                      className={layout === "grid" ? "selected" : ""}
                      aria-label="Grid view"
                      aria-pressed={layout === "grid"}
                      onClick={() => setLayout("grid")}
                    >
                      <Grid2X2 size={16} />
                    </button>
                    <button
                      className={layout === "list" ? "selected" : ""}
                      aria-label="List view"
                      aria-pressed={layout === "list"}
                      onClick={() => setLayout("list")}
                    >
                      <List size={17} />
                    </button>
                  </div>
                </div>
                <div
                  className={`project-grid ${layout === "list" ? "project-list" : ""}`}
                >
                  {filtered.map((project) => (
                    <article className="project-card" key={project.id}>
                      <button
                        className="preview-button"
                        aria-label={`Open ${project.name}`}
                        onClick={() => open("details", project)}
                      >
                        <Preview project={project} />
                      </button>
                      <div className="card-content">
                        <div className="card-title-row">
                          <button
                            className="project-title"
                            onClick={() => open("details", project)}
                          >
                            <ProjectIcon project={project} size={17} />
                            <h3>{project.name}</h3>
                          </button>
                          <div className="card-menu-container">
                            <button
                              className="icon-button card-more"
                              aria-label={`Actions for ${project.name}`}
                              aria-expanded={menuId === project.id}
                              onClick={() =>
                                setMenuId(
                                  menuId === project.id ? "" : project.id,
                                )
                              }
                            >
                              <MoreHorizontal size={20} />
                            </button>
                            {menuId === project.id ? (
                              <div className="card-dropdown">
                                <button onClick={() => open("edit", project)}>
                                  Edit project
                                </button>
                                <button onClick={() => toggleQueue(project)}>
                                  {project.queued
                                    ? "Remove from queue"
                                    : "Add to priority queue"}
                                </button>
                                <button onClick={() => open("share", project)}>
                                  Sharing settings
                                </button>
                                <button onClick={() => open("resume", project)}>
                                  Resume brief
                                </button>
                                <button
                                  onClick={() => open("lifecycle", project)}
                                >
                                  Next chapter controls
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <p className="card-description">
                          {project.description ||
                            "An idea with a little room to grow. Add a description to capture its purpose."}
                        </p>
                        {view === "queue" && timeFilter !== "All tasks" ? (
                          <div className="suggestion-note">
                            <strong>{taskFor(project)}</strong>
                            <small>
                              {
                                taskSuggestions.find(
                                  (s) => s.project.id === project.id,
                                )?.reason
                              }
                            </small>
                            <Button onClick={() => open("lifecycle", project)}>
                              Manage next task
                            </Button>
                          </div>
                        ) : null}
                        {project.status === "Parked" && project.interest ? (
                          <button
                            className="parked-interest-summary"
                            onClick={() => open("lifecycle", project)}
                          >
                            {project.interest.visits} visits ·{" "}
                            {project.interest.signups} signups ·{" "}
                            {project.interest.enquiries} enquiries
                          </button>
                        ) : null}
                        <div className="card-tags">
                          <Badge status={project.status} />
                          {project.tags.slice(0, 2).map((tag) => (
                            <span className="tag" key={tag}>
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div className="card-footer">
                          <span className="card-privacy">
                            {project.shared ? (
                              <Globe size={12} />
                            ) : (
                              <LockKeyhole size={12} />
                            )}{" "}
                            {project.shared ? "Shared" : "Private"}
                          </span>
                          <div className="card-actions">
                            <button onClick={() => open("share", project)}>
                              <ArrowUpRight size={14} />
                              Share
                            </button>
                            {project.status === "Parked" ? (
                              <button
                                className="resume-action"
                                onClick={() => open("resume", project)}
                              >
                                <Play size={12} />
                                Resume
                              </button>
                            ) : (
                              <button onClick={() => open("park", project)}>
                                <Pause size={12} />
                                Park
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                {!filtered.length ? (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <FolderKanban size={30} />
                    </span>
                    <h3>
                      {query || tagFilter !== "All tags"
                        ? "No projects match just yet"
                        : view === "parked"
                          ? "Everything is moving forward"
                          : view === "archived"
                            ? "No past chapters yet"
                            : view === "queue"
                              ? "Make room for your next priority"
                              : "Every chapter starts somewhere."}
                    </h3>
                    <p>
                      {query || tagFilter !== "All tags"
                        ? "Try a different search or reset your filters."
                        : view === "parked"
                          ? "When you need a pause, park a project with a note for next time."
                          : view === "queue"
                            ? "Use a project’s menu to add it to your priority queue."
                            : "Add your first project, import a repository, or upload a ZIP."}
                    </p>
                    {query || tagFilter !== "All tags" ? (
                      <Button
                        onClick={() => {
                          setQuery("");
                          setTagFilter("All tags");
                          setStatus("All");
                        }}
                      >
                        Clear filters
                      </Button>
                    ) : (
                      <Button className="primary" onClick={() => open("new")}>
                        <Plus size={15} />
                        Add a project
                      </Button>
                    )}
                  </div>
                ) : null}
                <div className="project-section-footer">
                  <span>
                    {filtered.length} project{filtered.length !== 1 ? "s" : ""}{" "}
                    · Plenty of possibility
                  </span>
                  <span>
                    <LockKeyhole size={12} />
                    Your ideas are safe here
                  </span>
                </div>
              </section>
              <aside className="right-rail">
                <section className="priority-section">
                  <div className="rail-heading">
                    <h2>
                      Up next<span>{queue.length}</span>
                    </h2>
                    <ListOrdered size={18} />
                  </div>
                  <p>A little focus goes a long way.</p>
                  <div className="queue-list">
                    {queue.length ? (
                      queue.map((project, i) => (
                        <div
                          className="queue-item"
                          key={project.id}
                          draggable
                          onDragStart={() => {
                            dragged.current = project.id;
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            void reorder(dragged.current, project.id);
                          }}
                        >
                          <span className="queue-handle">
                            <GripVertical size={16} />
                          </span>
                          <ProjectIcon project={project} size={17} />
                          <button onClick={() => open("details", project)}>
                            <strong>{project.name}</strong>
                            <small>
                              {taskFor(project) ||
                                `${project.status} · Ready when you are`}
                            </small>
                          </button>
                          <span className="queue-number">0{i + 1}</span>
                          <div className="queue-order-controls">
                            <button
                              disabled={i === 0}
                              aria-label={`Move ${project.name} up`}
                              onClick={() =>
                                reorder(project.id, queue[i - 1]?.id)
                              }
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              disabled={i === queue.length - 1}
                              aria-label={`Move ${project.name} down`}
                              onClick={() =>
                                reorder(project.id, queue[i + 1]?.id)
                              }
                            >
                              <ArrowDown size={12} />
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="queue-empty">
                        <ListOrdered size={24} />
                        <p>
                          Add a project to your queue
                          <br />
                          using its project menu.
                        </p>
                      </div>
                    )}
                  </div>
                  <span className="queue-hint">
                    <GripVertical size={12} />
                    Drag to reorder, or use the arrows
                  </span>
                  <button
                    className="queue-view"
                    onClick={() => navigate("queue")}
                  >
                    View priority queue
                    <ArrowRight size={14} />
                  </button>
                </section>
                {parked ? (
                  <section className="return-section">
                    <span className="return-eyebrow">
                      <History size={14} /> A NOTE FROM PAST YOU
                    </span>
                    <h2>Ready for a fresh start?</h2>
                    <p>
                      Your next chapter is
                      <br />
                      right where you left it.
                    </p>
                    <div className="return-project">
                      <ProjectIcon project={parked} />
                      <div>
                        <strong>{parked.name}</strong>
                        <span>Parked with memory</span>
                      </div>
                    </div>
                    <div className="return-next">
                      <span>NEXT ON YOUR LIST</span>
                      <p>
                        {parked.memory?.nextTask ||
                          "Review your saved project context."}
                      </p>
                    </div>
                    <Button onClick={() => open("resume", parked)}>
                      <Play size={13} />
                      Resume project
                      <ArrowRight size={14} />
                    </Button>
                    {parked.memory?.returnDate ? (
                      <span className="return-date">
                        Planned return ·{" "}
                        {new Date(
                          `${parked.memory.returnDate}T12:00:00Z`,
                        ).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })}
                      </span>
                    ) : null}
                  </section>
                ) : (
                  <section className="return-section">
                    <Sprout size={25} />
                    <h2>A little room to breathe.</h2>
                    <p>
                      Park a project with memory whenever you need to make
                      space.
                    </p>
                  </section>
                )}
                <div className="rail-tip">
                  <Sparkles size={16} />
                  <p>
                    Small steps count.
                    <br />
                    <span>Even the ones you come back to.</span>
                  </p>
                </div>
              </aside>
            </div>
          )}
        </main>
        <footer className="app-footer">
          <span>
            <Brand small /> <span>A home for unfinished possibilities.</span>
          </span>
          <span>Made for the way you build.</span>
        </footer>
      </div>
      {toast ? (
        <div className="toast" role="status">
          <span>
            <Check size={15} />
          </span>
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
      {panel?.kind === "new" ? (
        <ProjectEditor onClose={() => setPanel(null)} onSaved={saved} />
      ) : null}
      {panel?.kind === "quick-publish" ? (
        <QuickPublishPanel
          key={selected?.id || "new"}
          project={selected || undefined}
          vercel={workspace.integrations.vercel}
          workspaceRole={
            workspace.workspaces?.find((w) => w.id === activeWorkspace)?.role ||
            "Owner"
          }
          canCreate={
            !workspace.workspaces?.find((w) => w.id === activeWorkspace)
              ?.scope &&
            workspace.workspaces?.find((w) => w.id === activeWorkspace)
              ?.role !== "Viewer"
          }
          onClose={() => setPanel(null)}
          onSaved={saved}
          onIntegrations={() => setPanel({ kind: "integrations" })}
          onReview={(p) => setPanel({ kind: "launch", project: p })}
        />
      ) : null}
      {selected && panel?.kind === "edit" ? (
        <ProjectEditor
          project={selected}
          onClose={() => setPanel(null)}
          onSaved={saved}
        />
      ) : null}
      {selected && panel?.kind === "share" ? (
        <SharePanel
          project={selected}
          onClose={() => setPanel(null)}
          onSaved={saved}
        />
      ) : null}
      {selected && panel?.kind === "park" ? (
        <ParkPanel
          project={selected}
          onClose={() => setPanel(null)}
          onSaved={saved}
        />
      ) : null}
      {selected && panel?.kind === "resume" ? (
        <ResumePanel
          project={selected}
          ai={workspace.integrations.ai}
          onClose={() => setPanel(null)}
          onSaved={saved}
          onGuided={() => setPanel({ kind: "continuation", project: selected })}
        />
      ) : null}
      {selected && panel?.kind === "details" ? (
        <DetailsPanel
          project={selected}
          onClose={() => setPanel(null)}
          onSaved={saved}
          onEdit={() => open("edit", selected)}
          onShare={() => open("share", selected)}
          onPark={() => open("park", selected)}
          onResume={() => open("resume", selected)}
          onLifecycle={() => open("lifecycle", selected)}
          onKnowledge={() =>
            setPanel({ kind: "knowledge", tool: "project", project: selected })
          }
          onLaunch={() => setPanel({ kind: "launch", project: selected })}
          onPreserve={() =>
            setPanel({ kind: "preservation", project: selected })
          }
          onQuickPublish={() => openQuickPublish(selected)}
        />
      ) : null}
      {selected && panel?.kind === "lifecycle" ? (
        <LifecyclePanel
          project={selected}
          onClose={() => setPanel(null)}
          onSaved={saved}
        />
      ) : null}
      {panel?.kind === "knowledge" ? (
        <KnowledgePanel
          kind={panel.tool}
          workspace={workspace}
          owner={activeWorkspace || workspace.user?.id || ""}
          project={selected || undefined}
          onClose={() => setPanel(null)}
          onRefresh={refresh}
          onSaved={saved}
          onOpenProject={(p) => setPanel({ kind: "details", project: p })}
        />
      ) : null}
      {panel?.kind === "integrations" ? (
        <IntegrationsPanel
          workspace={workspace}
          onClose={() => setPanel(null)}
          onRefresh={refresh}
        />
      ) : null}
      {panel?.kind === "launch" ? (
        <LaunchPanel
          workspace={workspace}
          owner={activeWorkspace || workspace.user?.id || ""}
          initialProject={selected || undefined}
          initialTab={panel.tool}
          onClose={() => setPanel(null)}
          onRefresh={refresh}
        />
      ) : null}
      {panel?.kind === "continuation" ? (
        <ContinuationPanel
          workspace={workspace}
          owner={activeWorkspace || workspace.user?.id || ""}
          initialProject={selected || undefined}
          onClose={() => setPanel(null)}
          onRefresh={refresh}
        />
      ) : null}
      {panel?.kind === "preservation" ? (
        <PreservationPanel
          workspace={workspace}
          owner={activeWorkspace || workspace.user?.id || ""}
          initialProject={selected || undefined}
          onClose={() => setPanel(null)}
          onRefresh={refresh}
        />
      ) : null}
      {panel?.kind === "help" ? (
        <Panel
          title="Keep the next chapter close"
          subtitle="A few small steps to make future-you’s life easier."
          onClose={() => setPanel(null)}
        >
          <div className="panel-body help-content">
            <ol>
              <li>
                <strong>Bring your project home.</strong>
                <p>
                  Add an idea, import a GitHub repository, or upload a source
                  ZIP. Source archives stay private.
                </p>
              </li>
              <li>
                <strong>Choose what matters next.</strong>
                <p>
                  Search, filter, and add projects to the priority queue. Drag
                  or use the arrows to reorder them.
                </p>
              </li>
              <li>
                <strong>Share deliberately.</strong>
                <p>
                  Enable a share link and choose screenshots, demo, repository,
                  and source separately. Turn it off at any time.
                </p>
              </li>
              <li>
                <strong>Pause with a plan.</strong>
                <p>
                  Save your version, setup, features, issues, and one next task.
                  Parking keeps hosting running.
                </p>
              </li>
              <li>
                <strong>Start with your saved context.</strong>
                <p>
                  Prepare and edit a resume brief. Copy or download it for any
                  coding assistant, then resume building.
                </p>
              </li>
            </ol>
            <Notice>
              Hosting supports static HTML builds in this MVP. Connect your
              Vercel account, upload a build, and deploy from the project
              details.
            </Notice>
          </div>
        </Panel>
      ) : null}
      {panel?.kind === "account" ? (
        <Panel
          title={
            workspace.user && !workspace.user.demo
              ? "Your workspace"
              : "Make room for your projects"
          }
          onClose={() => setPanel(null)}
        >
          <div className="panel-body">
            {workspace.user && !workspace.user.demo ? (
              <>
                <h3>{workspace.user.name}</h3>
                <p className="field-hint">{workspace.user.email}</p>
                <AccountSecurity />
                <Notice>
                  Your projects are stored privately in your account.
                </Notice>
              </>
            ) : (
              <>
                <p className="account-explainer">
                  This is{" "}
                  {workspace.user
                    ? "your personal demo workspace"
                    : "a preview workspace"}
                  . Create an account to keep your own projects behind a
                  password.
                </p>
                <Link href="/signup" className="button primary">
                  Create your account
                  <ArrowRight size={16} />
                </Link>
                <Link href="/login" className="button">
                  Sign in
                </Link>
              </>
            )}
            {workspace.user ? (
              <Button
                onClick={async () => {
                  await api("auth/logout", "POST");
                  window.location.assign("/");
                }}
              >
                <LogOut size={16} />
                {workspace.user.demo ? "Leave demo workspace" : "Sign out"}
              </Button>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
function CodeGlyph() {
  return <span className="art-code">{"</>"}</span>;
}
