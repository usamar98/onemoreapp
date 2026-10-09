import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["jszip"],
  logging: { incomingRequests: false },
  async redirects() {
    // Preserve workspace links issued before the dashboard moved off the homepage.
    return ["project", "invite", "billing"].map((key) => ({
      source: "/",
      has: [{ type: "query" as const, key }],
      destination: "/dashboard",
      permanent: false,
    }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/:path(dashboard|login|signup|demo|review|p|api)/:rest*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/package/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};
export default config;
