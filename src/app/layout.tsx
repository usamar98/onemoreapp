import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/dm-serif-display/400.css";
import "./globals.css";
import { siteOrigin, siteDescription } from "@/lib/site";
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: "Chapter · A home for every project",
  description: siteDescription,
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
