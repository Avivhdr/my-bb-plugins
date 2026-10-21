export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

export function parsePullRequestUrl(url: string): PullRequestRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com") return null;
  const match = PR_PATH.exec(parsed.pathname);
  if (match === null) return null;
  const [, owner, repo, number] = match;
  return { owner: owner!, repo: repo!, number: Number(number) };
}

export function prKey({ owner, repo, number }: PullRequestRef): string {
  return `${owner}/${repo}#${number}`;
}

export function pullRequestUrl({ owner, repo, number }: PullRequestRef): string {
  return `https://github.com/${owner}/${repo}/pull/${number}`;
}
