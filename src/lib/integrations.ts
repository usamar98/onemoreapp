import { AppError, githubSlug } from "./security";
import { tokenFor } from "./db";
async function githubFetch(url: string, options: RequestInit) {
  try {
    return await fetch(url, options);
  } catch {
    throw new AppError(
      "GitHub could not be reached or timed out. Check network access, then retry. Reconnect GitHub if your token expired. Existing projects have not been changed.",
      502,
    );
  }
}
export async function githubInfo(owner: string, repository: string) {
  const slug = githubSlug(repository),
    token = await tokenFor(owner, "github");
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Chapter-project-workspace",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await githubFetch(`https://api.github.com/repos/${slug}`, {
    headers,
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new AppError(
      response.status === 404
        ? "Repository not found. For a private repository, connect GitHub with read access in Integrations."
        : "GitHub could not read this repository. Check your connection and try again.",
      502,
    );
  const repo = await response.json();
  const [readme, commit] = await Promise.all([
    githubFetch(`https://api.github.com/repos/${slug}/readme`, {
      headers: { ...headers, Accept: "application/vnd.github.raw+json" },
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    }),
    githubFetch(
      `https://api.github.com/repos/${slug}/commits/${encodeURIComponent(repo.default_branch)}`,
      { headers, signal: AbortSignal.timeout(20000), cache: "no-store" },
    ),
  ]);
  const sha = commit.ok ? ((await commit.json()).sha as string) : "";
  return {
    name: repo.name as string,
    description: repo.description || "",
    repository: repo.html_url as string,
    repoInfo: `Default branch: ${repo.default_branch}\nLanguage: ${repo.language || "Not reported"}\n\n${readme.ok ? (await readme.text()).slice(0, 18000) : "README: Not available"}`,
    version: sha,
    headers,
    slug,
  };
}
export async function githubArchive(
  owner: string,
  repository: string,
  ref: string,
) {
  const slug = githubSlug(repository),
    token = await tokenFor(owner, "github");
  const response = await githubFetch(
    `https://api.github.com/repos/${slug}/zipball/${encodeURIComponent(ref || "HEAD")}`,
    {
      headers: {
        "User-Agent": "Chapter-project-workspace",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new AppError(
      "GitHub could not download this version. Check repository access.",
      502,
    );
  if (Number(response.headers.get("content-length")) > 20 * 1024 * 1024)
    throw new AppError(
      "Repository archives larger than 20 MB are not supported.",
    );
  const reader = response.body!.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 20 * 1024 * 1024) {
      await reader.cancel();
      throw new AppError(
        "Repository archives larger than 20 MB are not supported.",
      );
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}
