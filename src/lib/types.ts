export const statuses = [
  "Idea",
  "Building",
  "Live",
  "Parked",
  "Archived",
] as const;
export type Status = (typeof statuses)[number];
export type Memory = {
  version: string;
  setup: string;
  completed: string;
  issues: string;
  reason: string;
  nextTask: string;
  returnDate: string;
  savedAt?: string;
  sourceId?: string;
  repository?: string;
  repoInfo?: string;
};
export type Project = {
  documentation?: string;
  taskBreakdown?: string;
  progressUpdates?: { id: string; at: string; notes: string; commit: string; nextTask: string; fileId: string; kind: "capture" | "session" }[];
  syncEnabled?: boolean;
  sync?: {
    attemptedAt: string;
    succeededAt: string;
    error: string;
    repository?: { sha: string; info: string; checkedAt: string };
    deployment?: { id: string; state: string; checkedAt: string };
  };
  inactivityFlag?: { at: string; detail: string };
  workspaceOwner?: string;
  role?: "Owner" | "Editor" | "Viewer";
  assigneeId?: string;
  setupChecklist?: string[];
  id: string;
  name: string;
  description: string;
  status: Status;
  color: string;
  tags: string[];
  repository: string;
  repoInfo: string;
  demoUrl: string;
  version: string;
  screenshotIds: string[];
  sourceId: string;
  sourceName: string;
  buildId: string;
  priority: number;
  queued: boolean;
  shared: boolean;
  shareRepo: boolean;
  shareFiles: boolean;
  shareDemo: boolean;
  shareScreenshots: boolean;
  shareId: string;
  memory: Memory | null;
  brief: string;
  briefKind: string;
  hostingProjectId: string;
  hostingProvider: string;
  hostingTeamId: string;
  deploymentId: string;
  deploymentState: string;
  createdAt: string;
  updatedAt: string;
  nextTask: string;
  taskMinutes: number | null;
  blockers: string;
  taskPriority: "High" | "Normal" | "Low";
  videoUrl: string;
  shareVideo: boolean;
  waitlistEnabled: boolean;
  enquiriesEnabled: boolean;
  requiredEnvNames: string[];
  referencedEnvNames: string[];
  revival: RevivalReport | null;
  hostingPaused: boolean | null;
  hostingCheckedAt: string;
  expenses: Expense[];
  handover: Handover | null;
  interest?: InterestCounts;
};
export type InterestCounts = {
  visits: number;
  signups: number;
  enquiries: number;
};
export type Expense = {
  id: string;
  label: string;
  category: "Hosting" | "Database" | "Domain" | "API" | "Other";
  amount: number;
  currency: string;
  interval: "Monthly" | "Yearly";
  continuesWhenParked: boolean;
  origin: "Manual estimate" | "Connected billing";
};
export type RevivalItem = {
  name: string;
  status: "Passed" | "Needs Attention" | "Not Checked";
  detail: string;
  nextStep: string;
};
export type RevivalReport = {
  at: string;
  version: string;
  sourceId: string;
  items: RevivalItem[];
};
export type Handover = {
  id: string;
  at: string;
  paths: string[];
  manifest: string;
  digest: string;
  shared: boolean;
  shareToken: string;
};
export type User = { id: string; name: string; email: string; demo?: boolean };
export type Activity = {
  id: string;
  text: string;
  at: string;
  kind: string;
  projectId?: string;
};
export type Workspace = {
  workspaces?: {
    id: string;
    name: string;
    role: string;
    scope: string[] | null;
  }[];
  user: User | null;
  projects: Project[];
  activity: Activity[];
  integrations: { github: boolean; vercel: boolean; ai: boolean };
};
// Older project records remain usable when new fields are introduced.
export function normalizeProject(project: Project): Project {
  return Object.assign(
    {
      nextTask: "",
      taskMinutes: null,
      blockers: "",
      taskPriority: "Normal",
      videoUrl: "",
      shareVideo: false,
      waitlistEnabled: false,
      enquiriesEnabled: false,
      requiredEnvNames: [],
      referencedEnvNames: [],
      revival: null,
      hostingPaused: null,
      hostingCheckedAt: "",
      expenses: [],
      handover: null,
    },
    project,
  );
}
export const emptyMemory: Memory = {
  version: "",
  setup: "",
  completed: "",
  issues: "",
  reason: "",
  nextTask: "",
  returnDate: "",
};
