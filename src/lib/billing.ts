import Stripe from "stripe";
import { db, transaction } from "./database";
import { AppError } from "./security";
export type Plan = "Free" | "Pro" | "Team";
export type UsageKind = "projects" | "storage" | "ai" | "seats";
export const defaultLimits = {
  Free: { projects: 10, storage: 100 * 1024 * 1024, ai: 10, seats: 2 },
  Pro: { projects: 100, storage: 5 * 1024 ** 3, ai: 250, seats: 5 },
  Team: { projects: 500, storage: 25 * 1024 ** 3, ai: 2000, seats: 25 },
};
export function planLimits() {
  const limits = structuredClone(defaultLimits);
  if (process.env.CHAPTER_PLAN_LIMITS) {
    let config: typeof limits;
    try {
      config = JSON.parse(process.env.CHAPTER_PLAN_LIMITS);
    } catch {
      throw new AppError("CHAPTER_PLAN_LIMITS must contain valid JSON.", 503);
    }
    for (const plan of Object.keys(limits) as Plan[])
      for (const kind of Object.keys(limits[plan]) as UsageKind[]) {
        const n = config[plan]?.[kind];
        if (n !== undefined) {
          if (!Number.isSafeInteger(n) || n < (kind === "seats" ? 1 : 0))
            throw new AppError("Invalid plan limit configuration.", 503);
          limits[plan][kind] = n;
        }
      }
  }
  return limits;
}
export const billingConfigured = () =>
  !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
export function stripeClient() {
  if (!billingConfigured())
    throw new AppError(
      "Stripe is unavailable. Configure STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID and STRIPE_TEAM_PRICE_ID. Your Free workspace remains usable.",
      503,
    );
  if (
    process.env.STRIPE_PRO_PRICE_ID &&
    process.env.STRIPE_PRO_PRICE_ID === process.env.STRIPE_TEAM_PRICE_ID
  )
    throw new AppError(
      "Pro and Team need distinct Stripe recurring price IDs.",
      503,
    );
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    maxNetworkRetries: 2,
    timeout: 15000,
  });
}
export function subscriptionPlan(status: string, priceId: string): Plan {
  if (
    process.env.STRIPE_PRO_PRICE_ID &&
    process.env.STRIPE_PRO_PRICE_ID === process.env.STRIPE_TEAM_PRICE_ID
  )
    return "Free";
  if (!["active", "trialing"].includes(status)) return "Free";
  if (priceId && priceId === process.env.STRIPE_TEAM_PRICE_ID) return "Team";
  if (priceId && priceId === process.env.STRIPE_PRO_PRICE_ID) return "Pro";
  return "Free";
}
export async function billingState(owner: string) {
  const row = await db()
    .prepare("SELECT * FROM subscriptions WHERE owner=?")
    .get(owner);
  const plan = (row?.plan || "Free") as Plan;
  return {
    plan,
    status: String(row?.status || "free"),
    checkedAt: row?.checked_at || null,
    customer: row?.customer ? String(row.customer) : "",
    subscription: row?.subscription ? String(row.subscription) : "",
    limits: planLimits()[plan],
  };
}
function period(kind: UsageKind) {
  return kind === "ai" ? new Date().toISOString().slice(0, 7) : "all";
}
export async function usageInit(owner: string, kind: UsageKind) {
  const p = period(kind);
  const initial =
    kind === "projects"
      ? "SELECT count(*) FROM projects WHERE owner=?"
      : kind === "storage"
        ? "SELECT COALESCE(sum(size),0)+(SELECT COALESCE(sum(bytes),0) FROM templates WHERE workspace_id=?)+(SELECT COALESCE(sum(bytes),0) FROM backups WHERE owner=?)+(SELECT COALESCE(sum(size),0) FROM upload_tickets WHERE owner=?) FROM uploads WHERE owner=?"
        : kind === "seats"
          ? "SELECT 1+count(*) FROM members WHERE workspace_id=?"
          : "SELECT 0";
  await db()
    .prepare(
      `INSERT INTO usage_counters(owner,kind,period,used) VALUES(?,?,?,(${initial})) ON CONFLICT(owner,kind,period) DO NOTHING`,
    )
    .run(
      ...(kind === "ai"
        ? [owner, kind, p]
        : kind === "storage"
          ? [owner, kind, p, owner, owner, owner, owner]
          : [owner, kind, p, owner]),
    );
  if (
    kind === "storage" &&
    (await db()
      .prepare("SELECT id FROM uploads WHERE owner=? AND size IS NULL LIMIT 1")
      .get(owner))
  )
    throw new AppError(
      "Storage usage has legacy files with unknown sizes. Run the storage reconciliation job before uploading more files.",
      409,
    );
  return p;
}
export async function usageStep(
  owner: string,
  kind: UsageKind,
  amount: number,
) {
  const p = await usageInit(owner, kind),
    limits = planLimits();
  return {
    sql: "UPDATE usage_counters SET used=used+? WHERE owner=? AND kind=? AND period=? AND used+?<=CASE COALESCE((SELECT plan FROM subscriptions WHERE owner=?),'Free') WHEN 'Pro' THEN ? WHEN 'Team' THEN ? ELSE ? END RETURNING used",
    parameters: [
      amount,
      owner,
      kind,
      p,
      amount,
      owner,
      limits.Pro[kind],
      limits.Team[kind],
      limits.Free[kind],
    ],
    required: `Workspace ${kind} limit reached. Review Billing & usage to upgrade or reduce usage.`,
  };
}
export async function consume(owner: string, kind: UsageKind, amount: number) {
  await transaction([await usageStep(owner, kind, amount)]);
}
export async function release(owner: string, kind: UsageKind, amount: number) {
  await db()
    .prepare(
      "UPDATE usage_counters SET used=CASE WHEN used>=? THEN used-? ELSE 0 END WHERE owner=? AND kind=? AND period=?",
    )
    .run(amount, amount, owner, kind, period(kind));
}
export async function usage(owner: string, allowUnknown = false) {
  const result: Record<string, number> = {};
  for (const k of ["projects", "storage", "ai", "seats"] as UsageKind[]) {
    let p: string;
    try {
      p = await usageInit(owner, k);
    } catch (error) {
      if (
        allowUnknown &&
        k === "storage" &&
        error instanceof AppError &&
        error.status === 409
      ) {
        result.storage = Number(
          (
            await db()
              .prepare(
                "SELECT COALESCE(sum(size),0) AS size FROM uploads WHERE owner=?",
              )
              .get(owner)
          )?.size || 0,
        );
        continue;
      }
      throw error;
    }
    result[k] = Number(
      (
        await db()
          .prepare(
            "SELECT used FROM usage_counters WHERE owner=? AND kind=? AND period=?",
          )
          .get(owner, k, p)
      )?.used || 0,
    );
  }
  return result;
}
// The raw signature is verified before persisting anything. Stripe is queried again
// during processing so delayed events cannot roll a subscription back in time.
export function verifyBillingEvent(
  raw: string,
  signature: string,
  secret: string,
) {
  try {
    return new Stripe("sk_test_signature_verification").webhooks.constructEvent(
      raw,
      signature,
      secret,
    );
  } catch {
    throw new AppError("Invalid Stripe webhook signature.", 400);
  }
}
export async function syncSubscription(owner: string, client = stripeClient()) {
  const state = await billingState(owner);
  if (!state.customer)
    throw new AppError(
      "No Stripe customer is connected to this workspace.",
      409,
    );
  const list = await client.subscriptions.list({
    customer: state.customer,
    status: "all",
    limit: 100,
  });
  const relevant = list.data
    .filter((s) =>
      s.items.data.some((i) =>
        [
          process.env.STRIPE_PRO_PRICE_ID,
          process.env.STRIPE_TEAM_PRICE_ID,
        ].includes(i.price.id),
      ),
    )
    .sort((a, b) => b.created - a.created);
  const active = relevant.filter((s) =>
    ["active", "trialing"].includes(s.status),
  );
  const s =
    active.find((s) =>
      s.items.data.some((i) => i.price.id === process.env.STRIPE_TEAM_PRICE_ID),
    ) ||
    active[0] ||
    relevant[0];
  const price =
    s?.items.data.find((i) => i.price.id === process.env.STRIPE_TEAM_PRICE_ID)
      ?.price.id ||
    s?.items.data.find((i) => i.price.id === process.env.STRIPE_PRO_PRICE_ID)
      ?.price.id ||
    "";
  const plan = s ? subscriptionPlan(s.status, price) : "Free";
  const at = new Date(
    Math.max(Date.now(), Date.parse(String(state.checkedAt)) + 1),
  ).toISOString();
  const saved = await db()
    .prepare(
      "UPDATE subscriptions SET subscription=?,plan=?,status=?,checked_at=? WHERE owner=? AND customer=? AND checked_at=? RETURNING owner",
    )
    .get(
      s?.id || null,
      plan,
      s?.status || "free",
      at,
      owner,
      state.customer,
      String(state.checkedAt),
    );
  if (!saved)
    throw new AppError(
      "Billing changed during verification. Retry to confirm current provider status.",
      409,
    );
  return { plan, status: s?.status || "free", checkedAt: at };
}
