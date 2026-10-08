import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import path from "node:path";

test("workspace permissions, atomic limits, versions, grounded private search and verified subscription changes", async () => {
  process.env.CHAPTER_DATA_DIR = path.join(
    process.cwd(),
    ".data",
    `phase-three-unit-${randomUUID()}`,
  );
  process.env.CHAPTER_PLAN_LIMITS = JSON.stringify({
    Free: { projects: 3, storage: 4096, ai: 2, seats: 2 },
  });
  process.env.STRIPE_PRO_PRICE_ID = "price_pro";
  process.env.STRIPE_TEAM_PRICE_ID = "price_team";
  const { db, transaction } = await import("../src/lib/database");
  const { insertProject, newProject, saveProject, getProjects, storeUpload } =
    await import("../src/lib/db");
  const { projectAccess, ensureWorkspace } = await import("../src/lib/access");
  const {
    consume,
    usageStep,
    usage,
    billingState,
    syncSubscription,
    verifyBillingEvent,
    subscriptionPlan,
  } = await import("../src/lib/billing");
  const { searchMemory, groundedAnswer, memorySources } =
    await import("../src/lib/knowledge");
  const { actorContext } = await import("../src/lib/versions");
  for (const id of ["owner", "editor", "viewer", "outsider"])
    await db()
      .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
      .run(id, id, `${id}@example.test`, "not-a-real-password", 0);
  const p = await insertProject(
    newProject({
      name: "Authorized",
      description: "Already has encrypted uploads",
      nextTask: "Fix the import dialog",
    }),
    "owner",
  );
  const privateP = await insertProject(
    newProject({ name: "Hidden", description: "Secret internal project" }),
    "owner",
  );
  await ensureWorkspace("owner");
  await transaction([
    await usageStep("owner", "seats", 1),
    {
      sql: "INSERT INTO members VALUES(?,?,?,?,?)",
      parameters: [
        "owner",
        "editor",
        "Editor",
        JSON.stringify([p.id]),
        new Date().toISOString(),
      ],
    },
  ]);
  await db()
    .prepare("INSERT INTO members VALUES(?,?,?,?,?)")
    .run(
      "owner",
      "viewer",
      "Viewer",
      JSON.stringify([p.id]),
      new Date().toISOString(),
    );
  assert.equal((await projectAccess(p.id, "editor", "edit")).role, "Editor");
  await assert.rejects(
    projectAccess(p.id, "editor", "control"),
    /does not permit/,
  );
  await assert.rejects(
    projectAccess(p.id, "viewer", "edit"),
    /does not permit/,
  );
  await assert.rejects(projectAccess(privateP.id, "editor"), /not found/);
  await assert.rejects(projectAccess(p.id, "outsider"), /not found/);
  assert.equal((await getProjects("editor")).length, 1);
  const sources = await memorySources("editor", "owner");
  assert.equal(searchMemory(sources, "encrypted uploads")[0].projectId, p.id);
  assert.ok(sources.every((s) => s.projectId !== privateP.id));
  assert.throws(
    () =>
      groundedAnswer(sources, [
        { id: sources[0].id, excerpt: "Invented revenue" },
      ]),
    /unsupported/,
  );
  assert.equal(
    groundedAnswer(sources, [{ id: sources[0].id, excerpt: sources[0].text }])
      .length,
    1,
  );
  p.brief = "Saved work: implement uploads next.";
  await actorContext.run("editor", () => saveProject(p, "owner"));
  const versions = await db()
    .prepare("SELECT * FROM versions WHERE project_id=? AND kind='brief'")
    .all(p.id);
  assert.equal(versions.length, 2);
  assert.ok(versions.every((v) => v.actor === "editor"));
  await insertProject(newProject({ name: "Last allowed" }), "owner");
  await assert.rejects(
    insertProject(newProject({ name: "Over limit" }), "owner"),
    /projects limit/,
  );
  assert.equal(
    (
      await db()
        .prepare("SELECT count(*) AS count FROM projects WHERE owner=?")
        .get("owner")
    ).count,
    3,
  );
  const settled = await Promise.allSettled([
    consume("owner", "storage", 3000),
    consume("owner", "storage", 3000),
  ]);
  assert.equal(settled.filter((s) => s.status === "fulfilled").length, 1);
  await assert.rejects(
    storeUpload(
      "owner",
      p.id,
      "too-large.txt",
      "source",
      "text/plain",
      Buffer.alloc(2000),
    ),
    /storage limit/,
  );
  await consume("owner", "ai", 2);
  await assert.rejects(consume("owner", "ai", 1), /ai limit/);
  assert.equal((await usage("owner")).ai, 2);
  const stripe = new Stripe("sk_test_mock");
  const raw = JSON.stringify({
    id: "evt_verified",
    object: "event",
    type: "customer.subscription.updated",
    data: { object: { id: "sub_known", customer: "cus_known" } },
  });
  const header = stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret: "whsec_test",
  });
  assert.equal(
    verifyBillingEvent(raw, header, "whsec_test").id,
    "evt_verified",
  );
  assert.throws(
    () => verifyBillingEvent(raw + " ", header, "whsec_test"),
    /Invalid Stripe/,
  );
  await db()
    .prepare("INSERT INTO subscriptions VALUES(?,?,?,?,?,?)")
    .run("owner", "cus_known", null, "Free", "free", new Date().toISOString());
  const provider = (status: string, price: string) =>
    ({
      subscriptions: {
        list: async () => ({
          data: [
            {
              id: "sub_known",
              created: 100,
              status,
              items: { data: [{ price: { id: price } }] },
            },
          ],
        }),
      },
    }) as unknown as Stripe;
  await syncSubscription("owner", provider("active", "price_team"));
  assert.equal((await billingState("owner")).plan, "Team");
  await syncSubscription("owner", provider("canceled", "price_team"));
  assert.equal((await billingState("owner")).plan, "Free");
  assert.equal(subscriptionPlan("incomplete", "price_pro"), "Free");
  assert.equal(subscriptionPlan("active", "unrecognized_price"), "Free");
});
