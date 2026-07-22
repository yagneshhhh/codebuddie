// Server-only GitHub API helpers using a per-user PAT.

export type GhFile = { path: string; type: "blob" | "tree"; size?: number };

async function gh<T = unknown>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "codebase-agent",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function getViewer(token: string) {
  return gh<{ login: string; avatar_url: string }>(token, "/user");
}

export async function listUserRepos(token: string) {
  return gh<Array<{ full_name: string; default_branch: string; description: string | null; language: string | null; private: boolean }>>(
    token,
    "/user/repos?per_page=100&sort=updated",
  );
}

export async function getRepoTree(token: string, fullName: string, branch: string) {
  const ref = await gh<{ commit: { sha: string } }>(token, `/repos/${fullName}/branches/${encodeURIComponent(branch)}`);
  const tree = await gh<{ tree: GhFile[]; truncated: boolean }>(
    token,
    `/repos/${fullName}/git/trees/${ref.commit.sha}?recursive=1`,
  );
  return tree.tree.filter((n) => n.type === "blob");
}

export async function getRawFile(token: string, fullName: string, branch: string, path: string): Promise<string | null> {
  const res = await fetch(
    `https://raw.githubusercontent.com/${fullName}/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`,
    { headers: { Authorization: `Bearer ${token}`, "User-Agent": "codebase-agent" } },
  );
  if (!res.ok) return null;
  return res.text();
}
