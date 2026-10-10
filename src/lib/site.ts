import type { Metadata } from "next";

export const siteName = "Chapter";
export const siteDescription =
  "Manage, host, and share your side projects with Chapter. Organize live demos and files, preserve project memory, and return with a clear next step.";
export function siteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  const candidate =
    configured ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://onemoreapp-sandy.vercel.app";
  const url = new URL(candidate);
  if (
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Configure NEXT_PUBLIC_SITE_URL as a public HTTPS origin.");
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    if (configured)
      throw new Error(
        "NEXT_PUBLIC_SITE_URL must be a public production URL, not localhost.",
      );
    return "https://onemoreapp-sandy.vercel.app";
  }
  if (url.protocol !== "https:")
    throw new Error("The production site URL must use HTTPS.");
  return url.origin;
}
export function publicMetadata(
  title: string,
  description: string,
  pathname = "/",
): Metadata {
  const url = siteOrigin() + (pathname === "/" ? "/" : pathname);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName,
      title,
      description,
      url,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: "Chapter. Keep every project ready for its next chapter.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"],
    },
    robots: { index: true, follow: true },
  };
}
export const privateMetadata: Metadata = {
  robots: { index: false, follow: false },
};
// Restrict account return paths to the private workspace; never accept external redirects.
export function workspaceReturn(value?: string | string[]) {
  if (
    typeof value !== "string" ||
    !/^\/dashboard(?:\?|$)/.test(value) ||
    /[\\\r\n]/.test(value)
  )
    return "/dashboard";
  return value;
}
