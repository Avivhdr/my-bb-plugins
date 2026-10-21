// Wire types for this plugin's own backend methods. The board data they carry is
// assembled in the backend from the GitHub REST API plus the plugin's own
// per-project storage.

/** Resolved GitHub coordinates for the active project. */
export interface RepoRef {
  owner: string
  name: string
}

/** A label attached to an issue (subset of repo label fields). */
export interface IssueLabel {
  name: string
  color: string
}

/** GitHub's rollup of how many sub-issues are done, including closed ones. */
export interface SubIssuesSummaryRaw {
  total: number
  completed: number
  percent_completed: number
}

/** A GitHub issue from the core board response. */
export interface Issue {
  number: number
  title: string
  body: string | null
  state: string
  html_url: string
  labels: IssueLabel[]
  /** REST `parent_issue_url`; absent or null when this issue has no parent. */
  parent_issue_url?: string | null
  /** REST `sub_issues_summary`; absent when GitHub has no sub-issue rollup. */
  sub_issues_summary?: SubIssuesSummaryRaw | null
  /**
   * Pull requests GitHub lists as linked to this issue (Development sidebar and
   * closing references). Assembled from GraphQL, not from `GET /issues`.
   */
  linked_pull_requests?: LinkedPullRequest[]
  /** Open issues that block this issue. Assembled from GraphQL. */
  blocked_by?: IssueDependency[]
  /** Open issues that this issue blocks. Assembled from GraphQL. */
  blocking?: IssueDependency[]
  /**
   * Count of open blockers. This can be higher than `blocked_by.length` when
   * GitHub returns only part of the list.
   */
  blocked_by_open_count?: number
  /**
   * Count of open issues this issue blocks. This can be higher than
   * `blocking.length` when GitHub returns only part of the list.
   */
  blocking_open_count?: number
}

/** A pull request GitHub links to an issue. */
export interface LinkedPullRequest {
  number: number
  title: string
  html_url: string
  state: string
}

/**
 * One side of a GitHub issue dependency. Only open issues are included:
 * a closed blocker no longer blocks the issue.
 */
export interface IssueDependency {
  number: number
  title: string
  html_url: string
  state: string
  /** owner/name of the repository that contains this issue. */
  repo: string
}

/** A repository label (column source). */
export interface RepoLabel {
  name: string
  color: string
}

/** Raw board bundle returned by issues_get_board. */
export interface IssuesBoard {
  repo: RepoRef
  issues: Issue[]
  labels: RepoLabel[]
  /** Map keyed by stringified issue number → value (1..10). */
  values: Record<string, number>
  columnLabels: string[]
  /** Map keyed by stringified issue number → the bb thread started from it. */
  threadLinks?: Record<string, { threadId: string; title: string | null }>
}

/** A repo label augmented with whether any open issue uses it. */
export interface LabelUsage {
  name: string
  color: string
  used: boolean
}

/** Config bundle returned by issues_get_config. */
export interface IssuesConfig {
  columnLabels: string[]
  labels: LabelUsage[]
}

export interface SetValueRequest {
  projectId: string
  issueNumber: number
  value: number | null
}

export interface SetColumnLabelsRequest {
  projectId: string
  labels: string[]
}

export interface CreateIssueRequest {
  projectId: string
  title: string
  body: string
  labels: string[]
}

export interface EditIssueRequest {
  projectId: string
  number: number
  title?: string
  body?: string
  state?: string
  addLabels?: string[]
  removeLabels?: string[]
}

export interface UpdateLabelColorRequest {
  projectId: string
  name: string
  color: string
}

export interface TicketDraft {
  title: string
  body: string
}

/**
 * Refine is handled inside the plugin (see lib/anthropic/client.ts), so unlike the
 * types above this shape answers to no core command.
 *
 * `repo` and `repoLabels` ride along from the board the dialog was opened over: the
 * prompt grounds drafts in the repo's real terminology, and the frontend already
 * loaded both, so passing them beats re-fetching them in the backend.
 */
export interface RefineTicketRequest {
  projectId: string
  /** owner/name. */
  repo: string
  /** Every label in the repo — vocabulary for the model, not the ticket's own labels. */
  repoLabels: string[]
  text: string
  draft: TicketDraft | null
  feedback: string
}
