import { createHash } from "node:crypto";
import JSZip from "jszip";
import { AppError, safeUrl } from "./security";
import type { Project } from "./types";

export type VercelConnection = { token: string; teamId: string };
export type VercelDeployment = {
  id: string;
  url?: string;
  readyState?: string;
  status?: string;
  projectId?: string;
  project?: { id: string };
};
export async function vercelRequest(
  connection: VercelConnection,
  endpoint: string,
  options: RequestInit = {},
  request = fetch,
) {
  if (!connection.token)
    throw new AppError(
      "Connect your Vercel account in Integrations first.",
      409,
    );
  const url = new URL(`https://api.vercel.com${endpoint}`);
  if (connection.teamId) url.searchParams.set("teamId", connection.teamId);
  const response = await request(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${connection.token}`,
    },
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  }).catch(() => {
    throw new AppError(
      "Vercel could not be reached or timed out. Check network access and retry; use Sync to verify the current provider state before repeating a hosting change.",
      502,
    );
  });
  if (!response.ok)
    throw new AppError(
      `Vercel could not complete this request (${response.status}). Check your token, team scope, account limits, and build.`,
      502,
    );
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}
export async function staticFiles(build: Buffer) {
  const zip = await JSZip.loadAsync(build);
  const files: { file: string; data: Buffer; sha: string; size: number }[] = [];
  for (const entry of Object.values(zip.files)) {
    if (
      entry.dir ||
      entry.name
        .split("/")
        .some((part) => part.startsWith(".") || part === "..") ||
      /(^|\/)(vercel\.(json|ts)|package(?:-lock)?\.json|README(?:\.[^/]*)?)$/i.test(
        entry.name,
      ) ||
      /\.(map|ts|tsx|jsx|py|rb|go|rs|sql|pem|key)$/i.test(entry.name)
    )
      continue;
    const data = await entry.async("nodebuffer");
    files.push({
      file: entry.name,
      data,
      sha: createHash("sha1").update(data).digest("hex"),
      size: data.length,
    });
  }
  if (!files.some((f) => f.file === "index.html"))
    throw new AppError("The static build must contain index.html.");
  // Explicit static builder prevents uploaded API files or configuration from executing code.
  const data = Buffer.from(
    JSON.stringify({
      version: 2,
      public: false,
      builds: [{ src: "**", use: "@vercel/static" }],
    }),
  );
  files.push({
    file: "vercel.json",
    data,
    sha: createHash("sha1").update(data).digest("hex"),
    size: data.length,
  });
  return files;
}
export async function deployStaticBuild(
  connection: VercelConnection,
  project: Project,
  build: Buffer,
  request = fetch,
): Promise<VercelDeployment> {
  const files = await staticFiles(build);
  // Limit concurrency to avoid overwhelming the user's provider account.
  for (let i = 0; i < files.length; i += 4) {
    await Promise.all(
      files.slice(i, i + 4).map((f) =>
        vercelRequest(
          connection,
          "/v2/files",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "x-vercel-digest": f.sha,
              "x-vercel-size": String(f.size),
            },
            body: new Uint8Array(f.data),
          },
          request,
        ),
      ),
    );
  }
  const sameAccount =
    project.hostingProvider === "vercel" &&
    (project.hostingTeamId || "") === connection.teamId;
  return vercelRequest(
    connection,
    "/v13/deployments",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `chapter-${project.id}`,
        ...(sameAccount && project.hostingProjectId
          ? { project: project.hostingProjectId }
          : {}),
        target: "production",
        files: files.map(({ file, sha, size }) => ({ file, sha, size })),
        projectSettings: {
          framework: null,
          buildCommand: "",
          installCommand: "",
          outputDirectory: ".",
        },
      }),
    },
    request,
  );
}
export function applyDeployment(
  project: Project,
  deployment: VercelDeployment,
) {
  if (!deployment.id)
    throw new AppError(
      "Vercel did not return a deployment ID. Please try again.",
      502,
    );
  project.deploymentId = deployment.id;
  project.deploymentState = (
    deployment.readyState ||
    deployment.status ||
    "queued"
  ).toLowerCase();
  project.hostingProvider = "vercel";
  project.hostingProjectId =
    deployment.projectId ||
    deployment.project?.id ||
    project.hostingProjectId ||
    "";
  if (project.deploymentState === "ready") {
    if (!deployment.url) {
      project.deploymentState = "awaiting-url";
      return project;
    }
    project.demoUrl = safeUrl(
      `https://${deployment.url.replace(/^https?:\/\//, "")}`,
    );
    if (project.status !== "Parked" && project.status !== "Archived")
      project.status = "Live";
  }
  return project;
}
