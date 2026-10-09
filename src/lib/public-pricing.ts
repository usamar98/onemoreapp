import {
  billingConfigured,
  planLimits,
  stripeClient,
  type Plan,
} from "./billing";
import type Stripe from "stripe";

export type PublicPlan = {
  name: Plan;
  limits: ReturnType<typeof planLimits>[Plan];
  price: string;
  interval: string;
  available: boolean;
  note: string;
};
type Price = Pick<
  Stripe.Price,
  | "active"
  | "type"
  | "recurring"
  | "unit_amount"
  | "currency"
  | "billing_scheme"
  | "custom_unit_amount"
  | "transform_quantity"
>;
const prices = new Map<
  string,
  { until: number; result: Promise<Price | null> }
>();
// Stripe's charging units differ from Intl for ISK, UGX, and MGA.
// https://docs.stripe.com/currencies#zero-decimal
const zeroDecimal = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);
async function loadPrice(id: string): Promise<Price | null> {
  const cached = prices.get(id);
  if (cached && cached.until > Date.now()) return cached.result;
  const entry = {
    until: Date.now() + 300_000,
    result: Promise.resolve(null) as Promise<Price | null>,
  };
  entry.result = stripeClient()
    .prices.retrieve(id, {}, { timeout: 3000, maxNetworkRetries: 0 })
    .catch(() => {
      entry.until = Date.now() + 30_000;
      return null;
    });
  prices.set(id, entry);
  if (prices.size > 8) prices.delete(prices.keys().next().value!);
  return entry.result;
}
export async function publicPlans(
  options: {
    limits?: ReturnType<typeof planLimits>;
    configured?: boolean;
    ids?: { Pro?: string; Team?: string };
    readPrice?: (id: string) => Promise<Price | null>;
  } = {},
): Promise<PublicPlan[]> {
  const limits = options.limits || planLimits();
  const configured = options.configured ?? billingConfigured();
  const ids = options.ids || {
    Pro: process.env.STRIPE_PRO_PRICE_ID,
    Team: process.env.STRIPE_TEAM_PRICE_ID,
  };
  const read = options.readPrice || loadPrice;
  const paid = await Promise.all(
    (["Pro", "Team"] as const).map(async (name) => {
      const id = ids[name];
      const unavailable = {
        name,
        limits: limits[name],
        price: "Not available yet",
        interval: "",
        available: false,
        note: "Paid checkout is not configured. You can start with Free.",
      };
      if (!configured || !id || ids.Pro === ids.Team) return unavailable;
      let p: Price | null;
      try {
        p = await read(id);
      } catch {
        p = null;
      }
      if (!p || !p.active || p.type !== "recurring" || !p.recurring)
        return {
          ...unavailable,
          price: "Pricing unavailable",
          note: "We couldn’t verify this plan’s current price. Please try again later.",
        };
      if (
        p.unit_amount === null ||
        p.billing_scheme !== "per_unit" ||
        p.custom_unit_amount ||
        p.transform_quantity ||
        p.recurring.usage_type !== "licensed"
      )
        return {
          ...unavailable,
          price: "Pricing unavailable",
          note: "This plan needs a fixed recurring price before checkout is available here.",
        };
      const digits = zeroDecimal.has(p.currency.toLowerCase()) ? 0 : 2;
      const format = new Intl.NumberFormat("en", {
        style: "currency",
        currency: p.currency.toUpperCase(),
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
      return {
        name,
        limits: limits[name],
        price: format.format(p.unit_amount / 10 ** digits),
        interval:
          p.recurring.interval_count === 1
            ? `per ${p.recurring.interval}`
            : `every ${p.recurring.interval_count} ${p.recurring.interval}s`,
        available: true,
        note: "Taxes, if applicable, are confirmed at checkout.",
      };
    }),
  );
  return [
    {
      name: "Free",
      limits: limits.Free,
      price: "Free",
      interval: "to get started",
      available: true,
      note: "No payment required to create your workspace.",
    },
    ...paid,
  ];
}
export function storageLabel(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${+(bytes / 1024 ** 3).toFixed(2)} GiB`
    : `${+(bytes / 1024 ** 2).toFixed(2)} MiB`;
}
