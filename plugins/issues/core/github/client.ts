// A minimal GitHub REST client for the Issues board.
//
// Only the calls the board makes live here. There is no ETag response cache: the
// board fetches on open and after each edit rather than polling, so a cache would
// buy little.

import type { Issue, LinkedPullRequest, RepoLabel, RepoRef } from '../types'

const API_ROOT = 'https://api.github.com'

export interface CreateIssueInput {
  title: string
  body: string
  labels: string[]
}

export interface EditIssueInput {
  title?: string
  body?: string
  state?: string
  addLabels?: string[]
  removeLabels?: string[]
}

function headers(token: string, extra?: HeadersInit): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    'User-Agent': 'bb-plugin-issues',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    ...(extra as Record<string, string> | undefined),
  }
}

/**
 * Percent-encode a single URL path segment, leaving only the unreserved set
 * (`A-Za-z0-9-._~`) intact. Label names routinely carry `:` and spaces.
 */
export function encodePathSegment(value: string): string {
  const HEX = '0123456789ABCDEF'
  let encoded = ''
  for (const byte of new TextEncoder().encode(value)) {
    const char = String.fromCharCode(byte)
    if (/[A-Za-z0-9\-._~]/.test(char)) {
      encoded += char
    } else {
      encoded += `%${HEX[byte >> 4]}${HEX[byte & 0x0f]}`
    }
  }
  return encoded
}

/** Turn a failed response into an error carrying GitHub's own message. */
async function apiError(response: Response): Promise<Error> {
  let detail = ''
  try {
    const body = (await response.json()) as { message?: unknown }
    if (typeof body.message === 'string') detail = `: ${body.message}`
  } catch {
    // A non-JSON error body tells the user nothing useful; the status carries it.
  }
  return new Error(`GitHub request failed (${response.status})${detail}`)
}

async function rawRequest(url: string, token: string, init?: RequestInit): Promise<Response> {
  // A JSON body needs saying so: fetch would otherwise label a string body text/plain.
  const contentType = init?.body === undefined ? undefined : { 'Content-Type': 'application/json' }
  const response = await fetch(url, {
    ...init,
    headers: headers(token, { ...contentType, ...(init?.headers as Record<string, string>) }),
  })
  if (!response.ok) throw await apiError(response)
  return response
}

async function request<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await rawRequest(url, token, init)
  return (await response.json()) as T
}

/**
 * The next page URL from a GitHub `Link` response header, or null on the last page.
 * GitHub's format: `<url>; rel="next", <url>; rel="last"` — entries in any order.
 */
export function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  for (const entry of linkHeader.split(',')) {
    const match = entry.match(/<([^>]+)>;\s*rel="next"/)
    if (match) return match[1]
  }
  return null
}

/** Sanity cap on pages fetched, so a runaway repo can't hang the board. */
const MAX_PAGES = 10

async function requestAllPages<T>(url: string, token: string): Promise<T[]> {
  const items: T[] = []
  let next: string | null = url
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const response: Response = await rawRequest(next, token)
    items.push(...((await response.json()) as T[]))
    next = nextPageUrl(response.headers.get('Link'))
  }
  return items
}

function repoUrl(repo: RepoRef, path: string): string {
  return `${API_ROOT}/repos/${repo.owner}/${repo.name}${path}`
}

/**
 * List a repo's open issues.
 *
 * `GET /issues` returns pull requests as well; entries carrying a `pull_request`
 * field are PRs and are dropped, matching what the board has always shown.
 *
 * Follows the `Link: rel="next"` header to fetch every page (capped at `MAX_PAGES`
 * pages / ~1000 issues) — a single 100-issue page silently dropped the rest of any
 * larger repo's open issues.
 */
export async function listOpenIssues(token: string, repo: RepoRef): Promise<Issue[]> {
  const issues = await requestAllPages<Issue & { pull_request?: unknown }>(
    repoUrl(repo, '/issues?state=open&per_page=100'),
    token,
  )
  return issues.filter((issue) => issue.pull_request === undefined || issue.pull_request === null)
}

/** List every label defined on the repo — the source of the board's columns. */
export function listLabels(token: string, repo: RepoRef): Promise<RepoLabel[]> {
  return request<RepoLabel[]>(repoUrl(repo, '/labels?per_page=100'), token)
}

export function createIssue(token: string, repo: RepoRef, input: CreateIssueInput): Promise<Issue> {
  return request<Issue>(repoUrl(repo, '/issues'), token, {
    method: 'POST',
    body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels }),
  })
}

/**
 * Compute the label set an edit results in: removals applied to the current set
 * first, then additions. De-duplicated, and stable — surviving labels keep their
 * original order, additions follow in the order given.
 */
export function resolveLabels(current: string[], input: EditIssueInput): string[] {
  const remove = new Set(input.removeLabels ?? [])
  const result: string[] = []
  const push = (label: string) => {
    if (remove.has(label) || result.includes(label)) return
    result.push(label)
  }
  for (const label of current) push(label)
  for (const label of input.addLabels ?? []) push(label)
  return result
}

function changesNothing(input: EditIssueInput): boolean {
  return (
    input.title === undefined &&
    input.body === undefined &&
    input.state === undefined &&
    (input.addLabels ?? []).length === 0 &&
    (input.removeLabels ?? []).length === 0
  )
}

export async function editIssue(
  token: string,
  repo: RepoRef,
  number: number,
  input: EditIssueInput,
): Promise<void> {
  if (changesNothing(input)) return

  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.body !== undefined) patch.body = input.body
  if (input.state !== undefined) patch.state = input.state

  // GitHub replaces the whole label set on PATCH, so an add or a remove has to be
  // resolved against the issue's current labels rather than sent on its own.
  if ((input.addLabels ?? []).length > 0 || (input.removeLabels ?? []).length > 0) {
    const current = await request<Issue>(repoUrl(repo, `/issues/${number}`), token)
    patch.labels = resolveLabels(
      current.labels.map((label) => label.name),
      input,
    )
  }

  await request<Issue>(repoUrl(repo, `/issues/${number}`), token, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function updateLabelColor(
  token: string,
  repo: RepoRef,
  name: string,
  color: string,
): Promise<void> {
  await request<RepoLabel>(repoUrl(repo, `/labels/${encodePathSegment(name)}`), token, {
    method: 'PATCH',
    body: JSON.stringify({ color }),
  })
}

const GRAPHQL_URL = `${API_ROOT}/graphql`

const LINKED_PULL_REQUESTS_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(states: [OPEN], first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
          nodes { number title url state }
        }
      }
    }
  }
}`

interface GraphqlErrorBody {
  message?: unknown
}

interface GraphqlLinkedPrNode {
  number?: unknown
  title?: unknown
  url?: unknown
  state?: unknown
}

interface GraphqlIssueNode {
  number?: unknown
  closedByPullRequestsReferences?: { nodes?: GraphqlLinkedPrNode[] | null } | null
}

interface GraphqlLinkedPrsData {
  repository?: {
    issues?: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes?: GraphqlIssueNode[] | null
    } | null
  } | null
}

interface GraphqlResponse {
  data?: GraphqlLinkedPrsData
  errors?: GraphqlErrorBody[]
}

async function graphqlLinkedPrs(
  token: string,
  variables: Record<string, unknown>,
): Promise<GraphqlLinkedPrsData> {
  const response = await request<GraphqlResponse>(GRAPHQL_URL, token, {
    method: 'POST',
    body: JSON.stringify({ query: LINKED_PULL_REQUESTS_QUERY, variables }),
  })
  const message = response.errors?.map((error) => error.message).find((value) => typeof value === 'string')
  if (typeof message === 'string') throw new Error(`GitHub request failed: ${message}`)
  if (!response.data) throw new Error('GitHub request failed: empty GraphQL response')
  return response.data
}

/** Map a GraphQL pull-request node onto the board wire shape, or null if unusable. */
export function parseLinkedPullRequest(raw: unknown): LinkedPullRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const node = raw as GraphqlLinkedPrNode
  if (typeof node.number !== 'number' || !Number.isInteger(node.number) || node.number < 1) return null
  if (typeof node.url !== 'string' || node.url.length === 0) return null
  return {
    number: node.number,
    title: typeof node.title === 'string' ? node.title : '',
    html_url: node.url,
    state: typeof node.state === 'string' ? node.state.toLowerCase() : 'open',
  }
}

/**
 * Linked pull requests for each open issue, keyed by issue number.
 *
 * GitHub's REST issue list does not include the Development-sidebar links; this
 * reads `closedByPullRequestsReferences` over GraphQL. Issues with no linked PR
 * are omitted from the map.
 */
export async function listLinkedPullRequestsByIssue(
  token: string,
  repo: RepoRef,
): Promise<Map<number, LinkedPullRequest[]>> {
  const byIssue = new Map<number, LinkedPullRequest[]>()
  let cursor: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await graphqlLinkedPrs(token, {
      owner: repo.owner,
      name: repo.name,
      cursor,
    })
    const connection = data.repository?.issues
    if (!connection) break

    for (const issue of connection.nodes ?? []) {
      if (typeof issue.number !== 'number') continue
      const prs = (issue.closedByPullRequestsReferences?.nodes ?? [])
        .map(parseLinkedPullRequest)
        .filter((pr): pr is LinkedPullRequest => pr !== null)
      if (prs.length > 0) byIssue.set(issue.number, prs)
    }

    if (!connection.pageInfo.hasNextPage) break
    cursor = connection.pageInfo.endCursor
    if (!cursor) break
  }

  return byIssue
}
