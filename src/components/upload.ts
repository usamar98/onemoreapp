import { api } from "./ui";
import type { Project } from "@/lib/types";
export async function uploadProjectFile(
  projectId: string,
  file: File,
  kind: "source" | "screenshot",
) {
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
    return api<{ project: Project }>(
      `projects/${projectId}/upload`,
      "POST",
      form,
    );
  }
  if (!destination.signedUrl || !destination.ticket)
    throw new Error("Could not prepare this upload. Please try again.");
  const response = await fetch(destination.signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "false",
    },
    body: file,
  });
  if (!response.ok)
    throw new Error(
      "The private upload failed. Check your connection and try again.",
    );
  return api<{ project: Project }>(
    `projects/${projectId}/upload-complete`,
    "POST",
    { ticket: destination.ticket },
  );
}
