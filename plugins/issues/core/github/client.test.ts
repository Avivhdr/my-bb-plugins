import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createIssue,
  editIssue,
  encodePathSegment,
  listLabels,
  listLinkedPullRequestsByIssue,
  listOpenIssues,
  nextPageUrl,
  parseLinkedPullRequest,
  resolveLabels,
  updateLabelColor,
} from './client'

const REPO = { owner: 'acme', name: 'repo' }
const TOKEN = 'ghp_test'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function stubFetch(...responses: Response[]) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => responses.shift() ?? jsonResponse(200, {}))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listOpenIssues', () => {
  it('requests open issues with the authenticated GitHub headers', async () => {
    const spy = stubFetch(jsonResponse(200, []))

    await listOpenIssues(TOKEN, REPO)

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/acme/repo/issues?state=open&per_page=100')
    expect(init.headers).toMatchObject({
      Authorization: `token ${TOKEN}`,
      Accept: 'application/vnd.github+json',
    })
  })

  // A GET carries no body, so labelling it as JSON would be wrong.
  it('sends no content type when there is no body', async () => {
    const spy = stubFetch(jsonResponse(200, []))

    await listOpenIssues(TOKEN, REPO)

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('keeps GitHub parent and sub-issue fields on listed issues', async () => {
    stubFetch(
      jsonResponse(200, [
        {
          number: 35,
          title: 'Parent',
          labels: [],
          parent_issue_url: null,
          sub_issues_summary: { total: 1, completed: 0, percent_completed: 0 },
        },
        {
          number: 506,
          title: 'item a',
          labels: [],
          parent_issue_url: 'https://api.github.com/repos/acme/repo/issues/35',
        },
      ]),
    )

    const issues = await listOpenIssues(TOKEN, REPO)

    expect(issues[0]).toMatchObject({
      number: 35,
      sub_issues_summary: { total: 1, completed: 0, percent_completed: 0 },
    })
    expect(issues[1]).toMatchObject({
      number: 506,
      parent_issue_url: 'https://api.github.com/repos/acme/repo/issues/35',
    })
  })

  it('drops pull requests, which the issues endpoint also returns', async () => {
    stubFetch(
      jsonResponse(200, [
        { number: 1, title: 'a real issue', labels: [] },
        { number: 2, title: 'actually a PR', labels: [], pull_request: { url: 'https://api.github.com/…' } },
        { number: 3, title: 'another issue', labels: [] },
      ]),
    )

    const issues = await listOpenIssues(TOKEN, REPO)

    expect(issues.map((issue) => issue.number)).toEqual([1, 3])
  })

  it('surfaces the GitHub error message on a failed request', async () => {
    stubFetch(jsonResponse(401, { message: 'Bad credentials' }))

    await expect(listOpenIssues(TOKEN, REPO)).rejects.toThrow(/Bad credentials/)
  })

  it('follows the Link header to fetch every page', async () => {
    const page2Url = 'https://api.github.com/repos/acme/repo/issues?state=open&per_page=100&page=2'
    const spy = stubFetch(
      jsonResponse(200, [{ number: 1, title: 'first page', labels: [] }], {
        Link: `<${page2Url}>; rel="next", <${page2Url}>; rel="last"`,
      }),
      jsonResponse(200, [{ number: 2, title: 'second page', labels: [] }]),
    )

    const issues = await listOpenIssues(TOKEN, REPO)

    expect(issues.map((issue) => issue.number)).toEqual([1, 2])
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[1][0]).toBe(page2Url)
  })

  it('stops after MAX_PAGES so a runaway repo cannot hang the board', async () => {
    const nextUrl = 'https://api.github.com/repos/acme/repo/issues?state=open&per_page=100&page=2'
    const alwaysNext = () =>
      jsonResponse(200, [{ number: 1, title: 'page', labels: [] }], {
        Link: `<${nextUrl}>; rel="next"`,
      })
    const spy = vi.fn(async () => alwaysNext())
    vi.stubGlobal('fetch', spy)

    const issues = await listOpenIssues(TOKEN, REPO)

    expect(spy).toHaveBeenCalledTimes(10)
    expect(issues).toHaveLength(10)
  })
})

describe('nextPageUrl', () => {
  it('extracts the rel="next" URL among several Link entries', () => {
    const header =
      '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"'
    expect(nextPageUrl(header)).toBe('https://api.github.com/x?page=2')
  })

  it('returns null when there is no next link', () => {
    expect(nextPageUrl('<https://api.github.com/x?page=1>; rel="last"')).toBeNull()
  })

  it('returns null for a missing header', () => {
    expect(nextPageUrl(null)).toBeNull()
  })
})

describe('listLabels', () => {
  it('requests every repo label', async () => {
    const spy = stubFetch(jsonResponse(200, [{ name: 'bug', color: 'ff0000' }]))

    const labels = await listLabels(TOKEN, REPO)

    expect(spy.mock.calls[0][0]).toBe('https://api.github.com/repos/acme/repo/labels?per_page=100')
    expect(labels).toEqual([{ name: 'bug', color: 'ff0000' }])
  })
})

describe('createIssue', () => {
  it('posts the title, body and labels', async () => {
    const spy = stubFetch(jsonResponse(201, { number: 7, title: 'New', labels: [] }))

    const issue = await createIssue(TOKEN, REPO, { title: 'New', body: 'Details', labels: ['bug'] })

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/acme/repo/issues')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ title: 'New', body: 'Details', labels: ['bug'] })
    expect(issue.number).toBe(7)
  })

  // The Rust client used reqwest's .json(), which set this; fetch would otherwise
  // label a string body text/plain and leave us relying on GitHub's leniency.
  it('labels a JSON body as JSON', async () => {
    const spy = stubFetch(jsonResponse(201, { number: 7, title: 'New', labels: [] }))

    await createIssue(TOKEN, REPO, { title: 'New', body: '', labels: [] })

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})

describe('editIssue', () => {
  it('patches only the fields that were provided', async () => {
    const spy = stubFetch(jsonResponse(200, { number: 7, title: 'Renamed', labels: [] }))

    await editIssue(TOKEN, REPO, 7, { title: 'Renamed' })

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/acme/repo/issues/7')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Renamed' })
  })

  it('reads the current labels before applying an add, since GitHub replaces the whole set', async () => {
    const spy = stubFetch(
      jsonResponse(200, { number: 7, title: 'Issue', labels: [{ name: 'bug' }, { name: 'ui' }] }),
      jsonResponse(200, { number: 7, title: 'Issue', labels: [] }),
    )

    await editIssue(TOKEN, REPO, 7, { addLabels: ['polish'], removeLabels: ['ui'] })

    expect(spy.mock.calls[0][0]).toBe('https://api.github.com/repos/acme/repo/issues/7')
    const patch = JSON.parse((spy.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)
    expect(patch).toEqual({ labels: ['bug', 'polish'] })
  })

  it('does nothing when the edit would change no field', async () => {
    const spy = stubFetch()

    await editIssue(TOKEN, REPO, 7, {})

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('resolveLabels', () => {
  it('keeps surviving labels in order, then appends additions', () => {
    expect(resolveLabels(['bug', 'ui', 'chore'], { addLabels: ['polish'], removeLabels: ['ui'] })).toEqual([
      'bug',
      'chore',
      'polish',
    ])
  })

  it('de-duplicates and lets a removal win over an addition', () => {
    expect(resolveLabels(['bug', 'bug'], { addLabels: ['bug', 'new'], removeLabels: ['new'] })).toEqual(['bug'])
  })
})

describe('updateLabelColor', () => {
  it('percent-encodes the label name into the path', async () => {
    const spy = stubFetch(jsonResponse(200, { name: 'priority: high', color: '0e8a16' }))

    await updateLabelColor(TOKEN, REPO, 'priority: high', '0e8a16')

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/acme/repo/labels/priority%3A%20high')
    expect(JSON.parse(init.body as string)).toEqual({ color: '0e8a16' })
  })
})

describe('encodePathSegment', () => {
  it('leaves unreserved characters alone and encodes everything else', () => {
    expect(encodePathSegment('bug-fix_v2.0~x')).toBe('bug-fix_v2.0~x')
    expect(encodePathSegment('needs review')).toBe('needs%20review')
    expect(encodePathSegment('a/b')).toBe('a%2Fb')
  })
})

describe('parseLinkedPullRequest', () => {
  it('maps a GraphQL pull request node onto the board wire shape', () => {
    expect(
      parseLinkedPullRequest({
        number: 99,
        title: 'Fix hydrate',
        url: 'https://github.com/acme/repo/pull/99',
        state: 'OPEN',
      }),
    ).toEqual({
      number: 99,
      title: 'Fix hydrate',
      html_url: 'https://github.com/acme/repo/pull/99',
      state: 'open',
    })
  })

  it('drops nodes that are missing a usable number or URL', () => {
    expect(parseLinkedPullRequest({ number: 0, url: 'https://github.com/acme/repo/pull/0' })).toBeNull()
    expect(parseLinkedPullRequest({ number: 99, url: '' })).toBeNull()
    expect(parseLinkedPullRequest(null)).toBeNull()
  })
})

describe('listLinkedPullRequestsByIssue', () => {
  const graphqlUrl = 'https://api.github.com/graphql'

  function graphqlResponse(nodes: unknown[], pageInfo = { hasNextPage: false, endCursor: null as string | null }) {
    return jsonResponse(200, {
      data: {
        repository: {
          issues: { pageInfo, nodes },
        },
      },
    })
  }

  it('asks GraphQL for linked pull requests on open issues', async () => {
    const spy = stubFetch(
      graphqlResponse([
        {
          number: 1,
          closedByPullRequestsReferences: {
            nodes: [
              {
                number: 99,
                title: 'Fix the bug',
                url: 'https://github.com/acme/repo/pull/99',
                state: 'OPEN',
              },
            ],
          },
        },
        { number: 3, closedByPullRequestsReferences: { nodes: [] } },
      ]),
    )

    const linked = await listLinkedPullRequestsByIssue(TOKEN, REPO)

    expect(spy.mock.calls[0][0]).toBe(graphqlUrl)
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as { query: string; variables: Record<string, unknown> }
    expect(body.query).toContain('closedByPullRequestsReferences')
    expect(body.query).toContain('includeClosedPrs')
    expect(body.variables).toEqual({ owner: 'acme', name: 'repo', cursor: null })
    expect(linked.get(1)).toEqual([
      {
        number: 99,
        title: 'Fix the bug',
        html_url: 'https://github.com/acme/repo/pull/99',
        state: 'open',
      },
    ])
    expect(linked.has(3)).toBe(false)
  })

  it('follows GraphQL pageInfo to fetch every page of issues', async () => {
    const spy = stubFetch(
      graphqlResponse(
        [
          {
            number: 1,
            closedByPullRequestsReferences: {
              nodes: [{ number: 10, title: 'One', url: 'https://github.com/acme/repo/pull/10', state: 'MERGED' }],
            },
          },
        ],
        { hasNextPage: true, endCursor: 'cursor-2' },
      ),
      graphqlResponse([
        {
          number: 2,
          closedByPullRequestsReferences: {
            nodes: [{ number: 20, title: 'Two', url: 'https://github.com/acme/repo/pull/20', state: 'CLOSED' }],
          },
        },
      ]),
    )

    const linked = await listLinkedPullRequestsByIssue(TOKEN, REPO)

    expect(spy).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse((spy.mock.calls[1][1] as RequestInit).body as string) as {
      variables: Record<string, unknown>
    }
    expect(secondBody.variables.cursor).toBe('cursor-2')
    expect(linked.get(1)?.[0]?.state).toBe('merged')
    expect(linked.get(2)?.[0]?.state).toBe('closed')
  })

  it('surfaces a GraphQL error message', async () => {
    stubFetch(jsonResponse(200, { errors: [{ message: 'API rate limit exceeded' }] }))

    await expect(listLinkedPullRequestsByIssue(TOKEN, REPO)).rejects.toThrow(/rate limit/)
  })
})
