"use client";
import { useRef, useState } from "react";
import { Button, Notice, api } from "./ui";
export async function browserSha(bytes: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function retryTransfer<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted)
      throw new Error("Transfer paused. Resume with the same file.");
    try {
      return await fn();
    } catch (e) {
      if (signal?.aborted || attempt >= 2) throw e;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}
export function PackageTransfer({ token }: { token: string }) {
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  const receipt = useRef<{
      id: string;
      bytes: number;
      sha256: string;
      chunkSize: number;
      name: string;
    } | null>(null),
    chunks = useRef<ArrayBuffer[]>([]),
    controller = useRef<AbortController | null>(null);
  async function download() {
    setBusy(true);
    setError("");
    const control = new AbortController();
    controller.current = control;
    try {
      if (!receipt.current)
        receipt.current = await api(`packages/${token}/start`, "POST");
      const r = receipt.current!;
      for (
        let i = chunks.current.length;
        i < Math.ceil(r.bytes / r.chunkSize);
        i++
      ) {
        const bytes = await retryTransfer(async () => {
          const response = await fetch(
            `/api/packages/${token}/chunk?receipt=${r.id}&part=${i}`,
            { signal: control.signal },
          );
          if (!response.ok) {
            const e = await response.json();
            throw new Error(e.error || "Could not download this part.");
          }
          const bytes = await response.arrayBuffer();
          if (
            (await browserSha(bytes)) !== response.headers.get("X-Chunk-SHA256")
          )
            throw new Error(
              "Downloaded chunk integrity failed. Retry the transfer.",
            );
          return bytes;
        }, control.signal);
        chunks.current.push(bytes);
        setProgress(
          Math.round(
            (chunks.current.reduce((n, b) => n + b.byteLength, 0) / r.bytes) *
              100,
          ),
        );
      }
      const blob = new Blob(chunks.current, { type: "application/zip" });
      if (
        blob.size !== r.bytes ||
        (await browserSha(await blob.arrayBuffer())) !== r.sha256
      ) {
        chunks.current = [];
        receipt.current = null;
        throw new Error(
          "Complete package checksum failed. Restart the download.",
        );
      }
      await api(`packages/${token}/complete`, "POST", {
        receipt: r.id,
        sha256: r.sha256,
      });
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = r.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setDone(true);
      chunks.current = [];
    } catch (e) {
      setError(
        control.signal.aborted
          ? "Transfer paused. Select Resume download to continue."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  return (
    <div className="package-transfer">
      <Notice kind="error">{error}</Notice>
      {progress || busy ? (
        <>
          <progress
            value={progress}
            max={100}
            aria-label="Package download progress"
          />
          <p role="status">
            {progress}% received · SHA-256 checked on completion
          </p>
        </>
      ) : null}
      <div className="form-actions">
        <Button
          className="primary"
          busy={busy}
          disabled={done}
          onClick={() => void download()}
        >
          {done
            ? "Package received and verified"
            : receipt.current
              ? "Resume download"
              : "Download package"}
        </Button>
        {busy ? (
          <Button onClick={() => controller.current?.abort()}>
            Pause download
          </Button>
        ) : null}
        {error ? (
          <Button
            onClick={() => {
              chunks.current = [];
              receipt.current = null;
              setProgress(0);
              setError("");
            }}
          >
            Restart download
          </Button>
        ) : null}
      </div>
      {done ? (
        <Notice kind="success">
          The complete package was received and its checksum verified. Your
          browser opened the file-save action.
        </Notice>
      ) : null}
    </div>
  );
}
