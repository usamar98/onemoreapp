import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";
import { db } from "@/lib/database";
export const dynamic = "force-dynamic";
// Enumerate public product pages only. Never enumerate private projects or bearer-token links.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const pages: MetadataRoute.Sitemap = [
    "/",
    "/support",
    "/privacy",
    "/terms",
  ].map((path) => ({
    url: origin + path,
    ...(path === "/"
      ? { images: [origin + "/images/dashboard-preview.webp"] }
      : {}),
  }));
  try {
    const portfolios = await db()
      .prepare(
        "SELECT slug,updated_at FROM public_portfolios WHERE published=1 ORDER BY slug",
      )
      .all();
    for (const portfolio of portfolios) {
      const slug = String(portfolio.slug);
      if (/^[a-z0-9][a-z0-9-]{2,49}$/.test(slug))
        pages.push({
          url: origin + "/portfolio/" + slug,
          lastModified: String(portfolio.updated_at),
        });
    }
  } catch {
    // Public marketing pages remain discoverable during a database outage.
    console.warn("Published portfolio sitemap entries could not be loaded.");
  }
  return pages;
}
