import { api } from "./ui";
import type { Project } from "@/lib/types";
export async function uploadProjectFile(
  projectId: string,
  file: File,
  kind: "source" | "screenshot" | "quick",
  onProgress?: (percent: number) => void,
) {
  function send(url: string, body: File | FormData, cloud = false) {
    return new Promise<{ project: Project } | null>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(cloud ? "PUT" : "POST", url);
      xhr.timeout = 180000;
      if (cloud) {
        xhr.setRequestHeader(
          "Content-Type",
          file.type || "application/octet-stream",
        );
        xhr.setRequestHeader("x-upsert", "false");
      }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          onProgress?.(Math.min(95, Math.round((e.loaded / e.total) * 95)));
      };
      xhr.onerror = () =>
        reject(
          new Error(
            "The upload was interrupted. Your project is saved privately; retry the upload.",
          ),
        );
      xhr.ontimeout = () =>
        reject(
          new Error("The upload timed out. Check your connection and retry."),
        );
      xhr.onload = () => {
        let result: { project: Project; error?: string } | null = null;
        if (!cloud) {
          try {
            result = JSON.parse(xhr.responseText);
          } catch {
            reject(
              new Error(
                "The server could not finish the upload. Retry or check Help & status.",
              ),
            );
            return;
          }
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(
            new Error(
              result?.error ||
                "The private upload failed. Check storage configuration and retry.",
            ),
          );
          return;
        }
        resolve(result);
      };
      xhr.send(body);
    });
  }
  const destination = await api<{
    local: boolean;
    ticket?: string;
    signedUrl?: string;
  }>(`projects/${projectId}/upload-token`, "POST", {
    name: file.name,
    kind,
    size: file.size,
  });
  if (destination.local) {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    const result = onProgress
      ? await send(`/api/projects/${projectId}/upload`, form)
      : await api<{ project: Project }>(
          `projects/${projectId}/upload`,
          "POST",
          form,
        );
    onProgress?.(100);
    return result!;
  }
  if (!destination.signedUrl || !destination.ticket)
    throw new Error("Could not prepare this upload. Please try again.");
  const response = onProgress
    ? (await send(destination.signedUrl, file, true), null)
    : await fetch(destination.signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "x-upsert": "false",
        },
        body: file,
      });
  if (response && !response.ok)
    throw new Error(
      "The private upload failed. Check your connection and try again.",
    );
  const result = await api<{ project: Project }>(
    `projects/${projectId}/upload-complete`,
    "POST",
    { ticket: destination.ticket },
  );
  onProgress?.(100);
  return result;
}
