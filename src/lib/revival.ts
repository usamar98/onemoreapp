import { Sandbox } from "@vercel/sandbox";
import JSZip from "jszip";
import { tokenFor, uploadBytes, accountSecrets } from "./db";
import { githubInfo } from "./integrations";
import { inspectZip } from "./uploads";
import { sourceEnvNames } from "./phase-two";
import { checkDemoLink } from "./link-check";
import { hostingStatus } from "./hosting";
import { vercelRequest } from "./vercel";
import type { Project, RevivalItem, RevivalReport } from "./types";
import { AppError } from "./security";
import { Writable } from "node:stream";
export function boundedCommandLog(maximum = 16000) {
  let text = "";
  const sink = new Writable({
    write(chunk, _encoding, done) {
      if (text.length < maximum)
        text += chunk.toString("utf8").slice(0, maximum - text.length);
      done();
    },
  });
  return { sink, text: () => text };
}
export function sandboxAvailable() {
  return (
    !!process.env.VERCEL_OIDC_TOKEN ||
    !!(
      process.env.VERCEL_TOKEN &&
      process.env.VERCEL_TEAM_ID &&
      process.env.VERCEL_PROJECT_ID
    )
  );
}
export async function isolatedBuild(
  source: Buffer,
  create = Sandbox.create,
  evidence?: {
    maximum: number;
    record: (stage: string, exitCode: number | null, output: string) => void;
    artifact: (sandbox: Sandbox) => Promise<void>;
  },
): Promise<RevivalItem> {
  const result = (
    status: RevivalItem["status"],
    detail: string,
    nextStep: string,
  ): RevivalItem => ({ name: "Isolated build", status, detail, nextStep });
  if (!sandboxAvailable())
    return result(
      "Not Checked",
      "Vercel Sandbox is not configured. No project code was executed.",
      "Configure Vercel OIDC or VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID on the server, then run the optional isolated build.",
    );
  const zip = await JSZip.loadAsync(
    (await inspectZip(source, [], evidence?.maximum || 100 * 1024 * 1024))
      .source,
  );
  const packageFile = zip.file("package.json"),
    lock = zip.file("package-lock.json");
  if (!packageFile || !lock)
    return result(
      "Not Checked",
      "An npm project with a package-lock.json at the archive root is required.",
      "Provide package.json, a lockfile and a build script, or use your external isolated CI for other stacks.",
    );
  let pkg: { scripts?: { build?: string } };
  try {
    pkg = JSON.parse(await packageFile.async("string"));
  } catch {
    return result(
      "Needs Attention",
      "package.json is invalid JSON.",
      "Fix the package file and upload the corrected source.",
    );
  }
  if (!pkg.scripts?.build)
    return result(
      "Not Checked",
      "No npm build script was recorded.",
      "Add scripts.build in package.json or verify the static build manually.",
    );
  const credentials =
    process.env.VERCEL_TOKEN &&
    process.env.VERCEL_TEAM_ID &&
    process.env.VERCEL_PROJECT_ID
      ? {
          token: process.env.VERCEL_TOKEN,
          teamId: process.env.VERCEL_TEAM_ID,
          projectId: process.env.VERCEL_PROJECT_ID,
        }
      : {};
  let sandbox: Sandbox | undefined;
  try {
    sandbox = await create({
      ...credentials,
      persistent: false,
      timeout: 180000,
      networkPolicy: { allow: ["registry.npmjs.org"] },
      resources: { vcpus: evidence ? 1 : 2 },
    });
    await sandbox.writeFiles(
      await Promise.all(
        Object.values(zip.files)
          .filter((f) => !f.dir)
          .map(async (f) => ({
            path: `/vercel/sandbox/${f.name}`,
            content: await f.async("nodebuffer"),
          })),
      ),
    );
    if (evidence) {
      const runtime = await sandbox.runCommand({
        cmd: "node",
        args: ["--version"],
        cwd: "/vercel/sandbox",
      });
      evidence.record("Runtime", runtime.exitCode, await runtime.stdout());
    }
    const installLog = boundedCommandLog();
    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      cwd: "/vercel/sandbox",
      ...(evidence
        ? {
            env: {
              NPM_CONFIG_ENGINE_STRICT: "true",
              NODE_OPTIONS: "--max-old-space-size=1536",
            },
          }
        : {}),
      ...(evidence ? { stdout: installLog.sink, stderr: installLog.sink } : {}),
    });
    if (evidence)
      evidence.record(
        "Dependency installation",
        install.exitCode,
        installLog.text(),
      );
    if (install.exitCode !== 0)
      return result(
        "Needs Attention",
        `Dependency installation exited with code ${install.exitCode} in an isolated VM.`,
        "Check the lockfile and npm dependencies. Only registry.npmjs.org is allowed; install scripts and private registry credentials are excluded.",
      );
    await sandbox.updateNetworkPolicy("deny-all");
    const buildLog = boundedCommandLog();
    const build = await sandbox.runCommand({
      cmd: "npm",
      args: ["run", "build"],
      cwd: "/vercel/sandbox",
      env: evidence
        ? { CI: "true", NODE_OPTIONS: "--max-old-space-size=1536" }
        : { CI: "true" },
      ...(evidence ? { stdout: buildLog.sink, stderr: buildLog.sink } : {}),
    });
    if (evidence) {
      evidence.record("Build", build.exitCode, buildLog.text());
      if (build.exitCode === 0) await evidence.artifact(sandbox);
    }
    return build.exitCode === 0
      ? result(
          "Passed",
          "npm ci and npm run build exited with code 0 in a temporary isolated VM, with no application secrets and no build network access.",
          "Verify deployment-specific environment values separately; this result only covers the saved source snapshot.",
        )
      : result(
          "Needs Attention",
          `npm run build exited with code ${build.exitCode} in an isolated VM.`,
          "Reproduce npm ci --ignore-scripts and npm run build in your isolated CI; add missing configuration securely. Chapter does not retain build output that may contain private data.",
        );
  } catch {
    return result(
      "Not Checked",
      "The isolated environment was unavailable or its three-minute limit expired.",
      "Check Vercel Sandbox access and plan limits, or run the build in your isolated CI. No successful build is claimed.",
    );
  } finally {
    if (sandbox) await sandbox.stop().catch(() => undefined);
  }
}
export async function revivalCheck(
  project: Project,
  owner: string,
  runBuild: boolean,
): Promise<RevivalReport> {
  const items: RevivalItem[] = [];
  const add = (
    name: string,
    status: RevivalItem["status"],
    detail: string,
    nextStep: string,
  ) => items.push({ name, status, detail, nextStep });
  if (!project.repository)
    add(
      "Repository",
      "Not Checked",
      "No repository URL recorded.",
      "Add a GitHub repository or upload the current source snapshot.",
    );
  else
    try {
      const info = await githubInfo(owner, project.repository);
      add(
        "Repository",
        info.version
          ? project.version && project.version !== info.version
            ? "Needs Attention"
            : "Passed"
          : "Not Checked",
        info.version
          ? `Current default-branch commit: ${info.version}.${project.version && project.version !== info.version ? ` Saved version: ${project.version}.` : ""}`
          : "GitHub metadata was available but the commit could not be verified.",
        info.version && project.version !== info.version
          ? "Compare the current repository with the parked snapshot before updating source."
          : "Review the saved notes and verify repository setup.",
      );
    } catch (e) {
      add(
        "Repository",
        "Not Checked",
        e instanceof Error ? e.message : "Repository unavailable.",
        "Check repository permissions and reconnect GitHub with Contents read access.",
      );
    }
  const connection = {
    token: await tokenFor(owner, "vercel"),
    teamId: project.hostingTeamId || "",
  };
  if (
    !connection.token ||
    project.hostingProvider !== "vercel" ||
    !project.hostingProjectId
  )
    add(
      "Deployment",
      "Not Checked",
      "No connected Vercel deployment is available.",
      "Connect Vercel and deploy a supported build; check external hosting manually.",
    );
  else
    try {
      const state = await hostingStatus(connection, project);
      project.hostingPaused =
        typeof state.paused === "boolean" ? state.paused : null;
      project.hostingCheckedAt = new Date().toISOString();
      if (state.paused)
        add(
          "Deployment",
          "Needs Attention",
          `Vercel production service ${state.name} is paused.`,
          "Use Hosting controls to resume service; resuming project work does not unpause hosting.",
        );
      else if (!project.deploymentId)
        add(
          "Deployment",
          "Not Checked",
          "Project is unpaused, but no deployment ID is recorded.",
          "Deploy a build and verify its readiness.",
        );
      else {
        const deployment: { readyState?: string; status?: string } =
          await vercelRequest(
            connection,
            `/v13/deployments/${encodeURIComponent(project.deploymentId)}`,
          );
        const state = deployment.readyState || deployment.status || "Unknown";
        add(
          "Deployment",
          state === "READY" ? "Passed" : "Needs Attention",
          `Vercel reports deployment ${project.deploymentId}: ${state}.`,
          state === "READY"
            ? "Confirm the production demo responds below."
            : "Review deployment errors in Vercel and redeploy a corrected build.",
        );
      }
    } catch {
      add(
        "Deployment",
        "Not Checked",
        "Vercel status could not be verified.",
        "Check your Vercel token, project access and team scope in Integrations.",
      );
    }
  if (!project.demoUrl)
    add(
      "Demo link",
      "Not Checked",
      "No demo URL recorded.",
      "Add a public demo URL or keep a video on the share page.",
    );
  else
    try {
      const status = await checkDemoLink(project.demoUrl);
      add(
        "Demo link",
        status >= 200 && status < 300
          ? "Passed"
          : status === 401 || status === 403 || status === 405 || status === 429
            ? "Not Checked"
            : "Needs Attention",
        `Public HEAD request returned HTTP ${status}.`,
        status >= 200 && status < 300
          ? "Check interactive behavior manually; an HTTP response does not verify app functionality."
          : "Check the demo in your browser, hosting state, redirects and access protection.",
      );
    } catch (e) {
      add(
        "Demo link",
        e instanceof AppError ? "Not Checked" : "Needs Attention",
        e instanceof AppError
          ? e.message
          : "The public demo could not be reached safely.",
        "Verify the demo URL manually and fix DNS, TLS or hosting as needed.",
      );
    }
  let source: Buffer | null = null;
  if (project.sourceId)
    try {
      source = (
        await inspectZip(
          await uploadBytes(project.sourceId, owner),
          await accountSecrets(owner),
          100 * 1024 * 1024,
        )
      ).source;
    } catch {
      add(
        "Source snapshot",
        "Needs Attention",
        "The saved source is missing or failed its privacy check.",
        "Upload a clean current archive before building or handing over.",
      );
    }
  const detected = source ? await sourceEnvNames(source) : [];
  project.referencedEnvNames = [
    ...new Set([...project.referencedEnvNames, ...detected]),
  ].sort();
  const required = project.requiredEnvNames;
  if (!required.length)
    add(
      "Environment names",
      "Not Checked",
      `No required names have been confirmed by the owner.${project.referencedEnvNames.length ? ` Source references: ${project.referencedEnvNames.join(", ")}. A reference does not establish that a value is required.` : " No supported source references found; this does not prove none are needed."}`,
      "Review the source references and save the required names in Readiness settings. Never enter values here.",
    );
  else if (
    connection.token &&
    project.hostingProvider === "vercel" &&
    project.hostingProjectId
  )
    try {
      const result: { envs: { key: string; target?: string | string[] }[] } =
        await vercelRequest(
          connection,
          `/v10/projects/${encodeURIComponent(project.hostingProjectId)}/env?decrypt=false`,
        );
      if (!Array.isArray(result.envs)) throw new Error("Names unavailable");
      const configured = result.envs
        .filter(
          (e) => e.target === "production" || e.target?.includes("production"),
        )
        .map((e) => e.key);
      const missing = required.filter((k) => !configured.includes(k));
      add(
        "Environment names",
        missing.length ? "Needs Attention" : "Passed",
        missing.length
          ? `Missing in Vercel production: ${missing.join(", ")}.`
          : `Production names present: ${required.join(", ")}. Values were not decrypted or retained.`,
        missing.length
          ? "Set these values securely in Vercel production settings and redeploy. Presence does not validate values."
          : "Verify values securely in the provider; Chapter checks names only.",
      );
    } catch {
      add(
        "Environment names",
        "Not Checked",
        `Required: ${required.join(", ")}. Provider names unavailable.`,
        "Verify these names and securely supplied values in your deployment account.",
      );
    }
  else
    add(
      "Environment names",
      "Not Checked",
      `Required names: ${required.join(", ")}. No provider environment connection.`,
      "Configure these names securely in your hosting provider; Chapter never stores their values here.",
    );
  if (runBuild && source) items.push(await isolatedBuild(source));
  else
    add(
      "Isolated build",
      "Not Checked",
      source
        ? "An isolated build was not requested."
        : "No saved source available for an isolated build.",
      "Select Run isolated npm build after configuring Vercel Sandbox and uploading an npm source archive.",
    );
  return {
    at: new Date().toISOString(),
    version: project.version,
    sourceId: project.sourceId,
    items,
  };
}
