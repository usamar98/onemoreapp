import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/dashboard",
        "/api/",
        "/demo",
        "/review/",
        "/package/",
        "/p/",
      ],
    },
    sitemap: siteOrigin() + "/sitemap.xml",
  };
}
