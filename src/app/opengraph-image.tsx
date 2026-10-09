import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export const alt = "Chapter. Manage, host, and share your side projects.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
const fontData = readFile(
  join(
    process.cwd(),
    "node_modules/@fontsource/inter/files/inter-latin-700-normal.woff",
  ),
);
export default async function SocialPreview() {
  const font = await fontData;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#f4f7f4",
        color: "#25362d",
        padding: "55px 65px",
        flexDirection: "column",
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 35,
          letterSpacing: -2,
        }}
      >
        <svg
          width="39"
          height="39"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#285d45"
          strokeWidth="1.9"
        >
          <path d="M12 3 2 8l10 5 10-5-10-5ZM2 12l10 5 10-5M2 16l10 5 10-5" />
        </svg>
        chapter<span style={{ color: "#285d45" }}>.</span>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 13,
          color: "#285d45",
          letterSpacing: 3,
          marginTop: 55,
        }}
      >
        KEEP EVERY PROJECT READY FOR ITS NEXT CHAPTER
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 72,
          lineHeight: 1.08,
          letterSpacing: -4,
          maxWidth: 960,
          marginTop: 20,
        }}
      >
        Manage, host, and share your side projects.
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 22,
          color: "#52675a",
          marginTop: 25,
        }}
      >
        Projects. Live demos. Shared files. One clear next step.
      </div>
      <div style={{ display: "flex", marginTop: "auto", gap: 14 }}>
        {["Building", "Live", "Parked", "Ready to resume"].map((status, i) => (
          <div
            key={status}
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 14,
              color: i === 2 ? "#735635" : "#285d45",
              background: i === 2 ? "#f0e8d9" : "#e1eee4",
              borderRadius: 6,
              padding: "9px 16px",
            }}
          >
            {status}
          </div>
        ))}
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: "Inter", data: font, weight: 700, style: "normal" }],
    },
  );
}
