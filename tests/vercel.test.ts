import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  deployStaticBuild,
  applyDeployment,
  vercelRequest,
} from "../src/lib/vercel";
import { demoProjects } from "../src/lib/demo";

test("Vercel filters private source, emits supported configuration, and uses owner/team credentials", async () => {
  const applicationConfig = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.equal(Object.hasOwn(applicationConfig, "public"), false);
  const zip = new JSZip();
  zip.file("index.html", "<h1>A compiled build</h1>");
  zip.file("assets/app.js", "console.log('browser asset')");
  zip.file(
    "vercel.json",
    JSON.stringify({ public: true, builds: [{ use: "@vercel/node" }] }),
  );
  zip.file("vercel.ts", "export default {public:true}");
  zip.file("README.md", "Private notes");
  zip.file(".env", "PRIVATE=secret");
  zip.file("main.ts", "const source = true");
  zip.file("assets/app.js.map", "source map");
  const calls: { url: URL; body: RequestInit["body"]; headers: Headers }[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/v2/files") {
      const content = Buffer.from(init!.body as Uint8Array).toString();
      if (
        content.startsWith('{"version"') &&
        Object.hasOwn(JSON.parse(content), "public")
      )
        return Response.json(
          {
            error: {
              message:
                "Invalid request: should NOT have additional property public",
            },
          },
          { status: 400 },
        );
    }
    calls.push({ url, body: init?.body, headers: new Headers(init?.headers) });
    return new Response(
      url.pathname === "/v13/deployments"
        ? JSON.stringify({
            id: "dpl_test",
            readyState: "BUILDING",
            projectId: "prj_test",
          })
        : "",
      { status: 200 },
    );
  };
  const project = {
    ...demoProjects[0],
    id: "fixture-project",
    hostingProvider: "vercel",
    hostingProjectId: "prj_existing",
    hostingTeamId: "team_test",
  };
  const deployment = await deployStaticBuild(
    { token: "fixture-owner-token", teamId: "team_test" },
    project,
    await zip.generateAsync({ type: "nodebuffer" }),
    request,
  );
  assert.equal(deployment.id, "dpl_test");
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.url.origin, "https://api.vercel.com");
    assert.equal(call.url.searchParams.get("teamId"), "team_test");
    assert.equal(
      call.headers.get("Authorization"),
      "Bearer fixture-owner-token",
    );
  }
  const uploaded = calls.filter((c) => c.url.pathname === "/v2/files");
  for (const call of uploaded)
    assert.equal(
      call.headers.get("x-vercel-digest"),
      createHash("sha1")
        .update(call.body as Uint8Array)
        .digest("hex"),
    );
  const manifest = JSON.parse(calls.at(-1)!.body as string);
  assert.deepEqual(manifest.files.map((f: { file: string }) => f.file).sort(), [
    "assets/app.js",
    "index.html",
    "vercel.json",
  ]);
  assert.equal(manifest.project, "prj_existing");
  assert.equal(manifest.target, "production");
  assert.equal(manifest.projectSettings.framework, null);
  const config = uploaded
    .map((c) => Buffer.from(c.body as Uint8Array).toString())
    .find((text) => text.startsWith('{"version"'))!;
  assert.equal(Object.hasOwn(JSON.parse(config), "public"), false);
  assert.deepEqual(JSON.parse(config).builds, [
    { src: "**", use: "@vercel/static" },
  ]);
});
test("Vercel state polling waits for a real URL and preserves parked/archive status", () => {
  const project = {
    ...demoProjects[0],
    demoUrl: "",
    status: "Building" as const,
  };
  assert.equal(
    applyDeployment(project, {
      id: "dpl_test",
      readyState: "BUILDING",
      url: "pending.vercel.app",
    }).demoUrl,
    "",
  );
  assert.equal(
    applyDeployment(project, { id: "dpl_test", readyState: "READY" })
      .deploymentState,
    "awaiting-url",
  );
  const live = applyDeployment(project, {
    id: "dpl_test",
    readyState: "READY",
    url: "returned-by-provider.vercel.app",
  });
  assert.equal(live.status, "Live");
  assert.equal(live.demoUrl, "https://returned-by-provider.vercel.app/");
  for (const status of ["Parked", "Archived"] as const)
    assert.equal(
      applyDeployment(
        { ...project, status },
        { id: "dpl_test", readyState: "READY", url: "actual.vercel.app" },
      ).status,
      status,
    );
  assert.equal(
    applyDeployment({ ...project }, { id: "dpl_test", readyState: "CANCELED" })
      .deploymentState,
    "canceled",
  );
});
test("Vercel errors and unavailable credentials give actionable setup instructions without leaking tokens", async () => {
  await assert.rejects(
    () => vercelRequest({ token: "", teamId: "" }, "/v13/deployments"),
    /Connect your Vercel/,
  );
  await assert.rejects(
    () =>
      vercelRequest(
        { token: "do-not-print", teamId: "" },
        "/v13/deployments",
        {},
        async () => new Response('{"message":"do-not-print"}', { status: 401 }),
      ),
    (error: Error) =>
      error.message.includes("token, team scope") &&
      !error.message.includes("do-not-print"),
  );
});
