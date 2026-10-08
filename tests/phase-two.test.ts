import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { newProject } from "../src/lib/db";
import { suggestions, costTotals } from "../src/lib/planning";
import { prepareHandover, handoverZip } from "../src/lib/phase-two";
import { inspectZip } from "../src/lib/uploads";
import { publicAddress, checkDemoLink } from "../src/lib/link-check";
import { hostingPreview, changeHosting } from "../src/lib/hosting";
import { isolatedBuild } from "../src/lib/revival";

test("task suggestions use owner estimates, priority and blockers; missing information is excluded", () => {
  const quick = newProject({
      name: "Quick",
      nextTask: "Fix spacing",
      taskMinutes: 20,
      taskPriority: "High",
    }),
    long = newProject({
      name: "Long",
      nextTask: "Add tests",
      taskMinutes: 100,
    }),
    blocked = newProject({
      nextTask: "Waiting",
      taskMinutes: 15,
      blockers: "Needs API access",
    }),
    missing = newProject({ nextTask: "Unknown" }),
    archived = newProject({
      nextTask: "Old",
      taskMinutes: 10,
      status: "Archived",
    });
  assert.deepEqual(
    suggestions([long, quick, blocked, missing, archived], 30).map(
      (s) => s.project.name,
    ),
    ["Quick"],
  );
  assert.deepEqual(
    suggestions([long, quick], 120).map((s) => s.project.name),
    ["Quick", "Long"],
  );
  assert.match(suggestions([quick], 30)[0].reason, /Your estimate is 20/);
  assert.doesNotMatch(
    suggestions([quick], 30)[0].reason,
    /revenue|score|completion/,
  );
});
test("cost totals preserve currencies and distinguish costs that may continue without reporting savings", () => {
  const project = newProject({
    expenses: [
      {
        id: "1",
        label: "Domain",
        category: "Domain",
        amount: 120,
        currency: "USD",
        interval: "Yearly",
        continuesWhenParked: true,
        origin: "Manual estimate",
      },
      {
        id: "2",
        label: "API",
        category: "API",
        amount: 5,
        currency: "EUR",
        interval: "Monthly",
        continuesWhenParked: false,
        origin: "Manual estimate",
      },
    ],
  });
  assert.deepEqual(costTotals(project.expenses), { USD: 10, EUR: 5 });
  assert.deepEqual(costTotals(project.expenses, true), { USD: 10 });
});
test("ZIP environment templates keep only names; handovers exclude data files, secrets and private contacts", async () => {
  const zip = new JSZip();
  zip.file(
    ".env.example",
    "DATABASE_URL=postgres://private-value\nAPI_KEY=template-secret",
  );
  zip.file(
    "src/app.ts",
    "export const value = process.env.API_KEY;\n// contact private.person@example.test",
  );
  zip.file("customers.csv", "name,email\nJane,jane@example.test");
  zip.file("private-data.json", '{"name":"Jane"}');
  zip.file("package.json", '{"name":"safe-source"}');
  zip.file("logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const archive = await inspectZip(
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  assert.deepEqual(archive.envNames, ["API_KEY", "DATABASE_URL"]);
  const cleaned = await JSZip.loadAsync(archive.source);
  assert.equal(cleaned.file(".env.example"), null);
  const project = newProject({
    name: "Hand over",
    description: "Contact jane@example.test",
    sourceId: "source-id",
    requiredEnvNames: archive.envNames,
    memory: {
      version: "1",
      setup: "npm install",
      completed: "UI",
      issues: "Bug",
      reason: "Time",
      nextTask: "Test",
      returnDate: "",
    },
  });
  const preview = await prepareHandover(project, archive.source, [
    "src/app.ts",
    "logo.svg",
  ]);
  assert.ok(!preview.paths.includes("customers.csv"));
  assert.ok(!preview.paths.includes("private-data.json"));
  assert.ok(!preview.manifest.includes("jane@example.test"));
  assert.ok(!preview.files[1]?.content.includes("private.person@example.test"));
  const output = await JSZip.loadAsync(await handoverZip(preview));
  assert.ok(output.file("HANDOVER.md"));
  assert.ok(output.file("source/src/app.ts"));
  assert.equal(output.file("source/customers.csv"), null);
  await assert.rejects(
    prepareHandover(project, archive.source, ["customers.csv"]),
    /eligible source/,
  );
  const changed = await prepareHandover(
    { ...project, description: "Updated purpose" },
    archive.source,
    ["src/app.ts", "logo.svg"],
  );
  assert.notEqual(changed.digest, preview.digest);
});
test("public demo checks block private IPs, metadata services and unsafe ports", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("1.1.1.1"), true);
  assert.equal(publicAddress("2606:4700:4700::1111"), true);
  await assert.rejects(checkDemoLink("http://127.0.0.1"), /private, local/);
  await assert.rejects(
    checkDemoLink("https://example.com:4321"),
    /standard ports/,
  );
});
test("hosting controls need explicit, current confirmation and verified provider state", async () => {
  const connection = { token: "owner-vercel-token", teamId: "team_123" },
    project = newProject({
      hostingProvider: "vercel",
      hostingProjectId: "prj_sample",
    });
  let paused = false,
    mutations = 0;
  const request = (async (url: URL | RequestInfo, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === "POST") {
      mutations++;
      paused = path.endsWith("/pause");
      return Response.json({});
    }
    return Response.json({
      id: "prj_sample",
      name: "sample-production",
      paused,
    });
  }) as typeof fetch;
  const preview = await hostingPreview(connection, project, "pause", request);
  assert.match(preview.stop, /Production deployment/);
  assert.match(preview.remain.join(" "), /share page/);
  await assert.rejects(
    changeHosting(
      connection,
      project,
      {
        target: "pause",
        name: "wrong",
        expires: preview.expires,
        confirmation: preview.confirmation,
      },
      request,
    ),
    /Confirmation/,
  );
  assert.equal(mutations, 0);
  await changeHosting(
    connection,
    project,
    {
      target: "pause",
      name: preview.name,
      expires: preview.expires,
      confirmation: preview.confirmation,
    },
    request,
  );
  assert.equal(project.hostingPaused, true);
  assert.equal(mutations, 1);
  const resume = await hostingPreview(connection, project, "resume", request);
  await changeHosting(
    connection,
    project,
    {
      target: "resume",
      name: resume.name,
      expires: resume.expires,
      confirmation: resume.confirmation,
    },
    request,
  );
  assert.equal(project.hostingPaused, false);
  const neverConfirms = (async (_url: URL | RequestInfo, init?: RequestInit) =>
    Response.json(
      init?.method === "POST"
        ? {}
        : { id: "prj_sample", name: "sample-production", paused: false },
    )) as typeof fetch;
  const pending = await hostingPreview(
    connection,
    project,
    "pause",
    neverConfirms,
  );
  await assert.rejects(
    changeHosting(
      connection,
      project,
      {
        target: "pause",
        name: pending.name,
        expires: pending.expires,
        confirmation: pending.confirmation,
      },
      neverConfirms,
    ),
    /not confirmed/,
  );
  assert.equal(project.hostingPaused, false);
  const oldId = process.env.VERCEL_PROJECT_ID;
  process.env.VERCEL_PROJECT_ID = "prj_sample";
  try {
    await assert.rejects(
      hostingPreview(connection, project, "pause", request),
      /Chapter itself/,
    );
  } finally {
    if (oldId) process.env.VERCEL_PROJECT_ID = oldId;
    else delete process.env.VERCEL_PROJECT_ID;
  }
});
test("isolated build has temporary VM, restricted network, no forwarded secrets and guaranteed shutdown", async () => {
  const keys = ["VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"],
    old = keys.map((k) => process.env[k]);
  keys.forEach(
    (k, i) =>
      (process.env[k] = ["server-secret-token", "team_test", "prj_test"][i]),
  );
  const zip = new JSZip();
  zip.file("package.json", '{"scripts":{"build":"node build.js"}}');
  zip.file("package-lock.json", "{}");
  zip.file("build.js", "console.log('ok')");
  const source = await zip.generateAsync({ type: "nodebuffer" });
  const calls: {
    options?: Record<string, unknown>;
    commands: Record<string, unknown>[];
    policy?: string;
    stopped?: boolean;
    files?: string[];
  } = { commands: [] };
  const create = async (options: Record<string, unknown>) => {
    calls.options = options;
    return {
      writeFiles: async (files: { path: string }[]) => {
        calls.files = files.map((f) => f.path);
      },
      runCommand: async (command: Record<string, unknown>) => {
        calls.commands.push(command);
        return { exitCode: 0 };
      },
      updateNetworkPolicy: async (policy: string) => {
        calls.policy = policy;
      },
      stop: async () => {
        calls.stopped = true;
      },
    };
  };
  try {
    const report = await isolatedBuild(source, create as never);
    assert.equal(report.status, "Passed");
    assert.equal(calls.options?.persistent, false);
    assert.deepEqual(calls.options?.networkPolicy, {
      allow: ["registry.npmjs.org"],
    });
    assert.equal(calls.policy, "deny-all");
    assert.equal(calls.stopped, true);
    assert.ok(calls.files?.every((p) => p.startsWith("/vercel/sandbox/")));
    assert.doesNotMatch(JSON.stringify(calls.commands), /server-secret-token/);
    assert.deepEqual(calls.commands[1].env, { CI: "true" });
  } finally {
    keys.forEach((k, i) => {
      if (old[i]) process.env[k] = old[i];
      else delete process.env[k];
    });
  }
});
