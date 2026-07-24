// Server-only GitHub API helpers using a per-user PAT.

export type GhFile = { path: string; type: "blob" | "tree"; size?: number };

async function gh<T = unknown>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "codebase-agent",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

// ── Write helpers (PR creation) ─────────────────────────────────
export async function getBranchSha(token: string, fullName: string, branch: string): Promise<string> {
  const r = await gh<{ commit: { sha: string } }>(token, `/repos/${fullName}/branches/${encodeURIComponent(branch)}`);
  return r.commit.sha;
}

export async function createBranch(token: string, fullName: string, newBranch: string, fromSha: string) {
  return gh(token, `/repos/${fullName}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
  });
}

export async function putFileOnBranch(
  token: string, fullName: string, branch: string, path: string, content: string, message: string,
) {
  // Look up existing sha if the file already exists (needed for update)
  let sha: string | undefined;
  const check = await fetch(
    `https://api.github.com/repos/${fullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
    { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "codebase-agent" } },
  );
  if (check.ok) sha = (await check.json() as { sha?: string }).sha;

  // btoa handles latin1; encode UTF-8 safely
  const b64 = btoa(unescape(encodeURIComponent(content)));
  return gh(token, `/repos/${fullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: b64, branch, ...(sha ? { sha } : {}) }),
  });
}

export async function createPullRequest(
  token: string, fullName: string, opts: { title: string; head: string; base: string; body: string },
) {
  return gh<{ number: number; html_url: string }>(token, `/repos/${fullName}/pulls`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export async function createIssueComment(
  token: string, fullName: string, issueNumber: number, body: string,
) {
  return gh<{ id: number; html_url: string }>(token, `/repos/${fullName}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
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
