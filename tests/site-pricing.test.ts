import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { defaultLimits, planLimits } from "../src/lib/billing";
import { publicPlans, storageLabel } from "../src/lib/public-pricing";
import { siteOrigin, publicMetadata, workspaceReturn } from "../src/lib/site";

const price = (changes: Partial<Stripe.Price> = {}) =>
  ({
    active: true,
    type: "recurring",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    unit_amount: 1500,
    currency: "usd",
    billing_scheme: "per_unit",
    custom_unit_amount: null,
    transform_quantity: null,
    ...changes,
  }) as Stripe.Price;

test("public plan limits match enforcement and unavailable billing never invents prices", async () => {
  const previous = process.env.CHAPTER_PLAN_LIMITS;
  try {
    process.env.CHAPTER_PLAN_LIMITS = JSON.stringify({
      Free: { projects: 7, storage: 2 * 1024 ** 2, ai: 3, seats: 1 },
    });
    const plans = await publicPlans({
      configured: false,
      readPrice: async () => {
        throw new Error("Must not contact billing");
      },
    });
    assert.deepEqual(plans[0].limits, planLimits().Free);
    assert.equal(plans[0].limits.projects, 7);
    assert.equal(plans[0].price, "Free");
    for (const p of plans.slice(1)) {
      assert.equal(p.available, false);
      assert.equal(p.price, "Not available yet");
    }
    assert.equal(storageLabel(plans[0].limits.storage), "2 MiB");
    assert.equal(storageLabel(defaultLimits.Pro.storage), "5 GiB");
  } finally {
    if (previous === undefined) delete process.env.CHAPTER_PLAN_LIMITS;
    else process.env.CHAPTER_PLAN_LIMITS = previous;
  }
});

test("paid prices require verified fixed recurring data and provider errors degrade honestly", async () => {
  const ids = { Pro: "price_pro", Team: "price_team" };
  const plans = await publicPlans({
    configured: true,
    ids,
    readPrice: async (id) =>
      price({
        unit_amount: id === ids.Pro ? 2400 : 180000,
        currency: id === ids.Pro ? "usd" : "jpy",
      }),
  });
  assert.equal(plans[1].price, "$24.00");
  assert.equal(plans[1].interval, "per month");
  assert.equal(plans[1].available, true);
  assert.equal(plans[2].price, "¥180,000");
  for (const p of [
    null,
    price({ active: false }),
    price({ type: "one_time", recurring: null }),
    price({ unit_amount: null }),
    price({ billing_scheme: "tiered" }),
    price({
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "metered",
      } as Stripe.Price.Recurring,
    }),
  ]) {
    const unavailable = await publicPlans({
      configured: true,
      ids,
      readPrice: async () => p,
    });
    assert.equal(unavailable[1].available, false);
    assert.equal(unavailable[1].price, "Pricing unavailable");
  }
  const failed = await publicPlans({
    configured: true,
    ids,
    readPrice: async () => {
      throw new Error("provider failure");
    },
  });
  assert.equal(failed[1].available, false);
  assert.equal(failed[0].available, true);
  let called = false;
  await publicPlans({
    configured: true,
    ids: { Pro: "same", Team: "same" },
    readPrice: async () => {
      called = true;
      return price();
    },
  });
  assert.equal(called, false);
});

test("Stripe currency minor units and recurring intervals are preserved", async () => {
  for (const [currency, amount, expected] of [
    ["isk", 500, "ISK 5.00"],
    ["ugx", 500, "UGX 5.00"],
    ["mga", 500, "MGA 500"],
  ] as const) {
    const plans = await publicPlans({
      configured: true,
      ids: { Pro: "pro", Team: "team" },
      readPrice: async () =>
        price({
          currency,
          unit_amount: amount,
          recurring: {
            interval: "year",
            interval_count: 2,
            usage_type: "licensed",
          } as Stripe.Price.Recurring,
        }),
    });
    assert.equal(plans[1].price, expected);
    assert.equal(plans[1].interval, "every 2 years");
  }
});

test("production SEO never points to localhost and account returns cannot escape the workspace", () => {
  const site = process.env.NEXT_PUBLIC_SITE_URL,
    app = process.env.NEXT_PUBLIC_APP_URL;
  try {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3000";
    assert.equal(siteOrigin(), "https://onemoreapp.pro");
    process.env.NEXT_PUBLIC_SITE_URL =
      "https://chapter.example.test/path?query=ignored";
    assert.equal(siteOrigin(), "https://chapter.example.test");
    assert.equal(
      publicMetadata("Support", "Help", "/support").alternates?.canonical,
      "https://chapter.example.test/support",
    );
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    assert.throws(siteOrigin, /production URL/);
    process.env.NEXT_PUBLIC_SITE_URL = "https://user:password@example.test";
    assert.throws(siteOrigin, /public HTTPS origin/);
  } finally {
    if (site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = site;
    if (app === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = app;
  }
  for (const unsafe of [
    "https://evil.test",
    "//evil.test",
    "/dashboard/../evil",
    "/dashboard\\evil",
    "/dashboard\n",
    ["/dashboard"],
  ])
    assert.equal(workspaceReturn(unsafe), "/dashboard");
  assert.equal(
    workspaceReturn("/dashboard?invite=abc"),
    "/dashboard?invite=abc",
  );
});
