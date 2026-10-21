/** The only default cleanup policy contributed to BB agent sessions. */
export function defaultGuidance(projectId: string): string {
  return `Code Cleanup for BB project ${projectId}:
Record substantial, actionable cleanup in files you edit or adjacent code you read as BB Tasks only for observed defects or concrete maintenance costs. State current evidence and expected benefit. No cleanup findings is a valid result. Prefer removing unnecessary code over adding abstractions. A possible edge case alone does not justify a task. Ignore minor style nits and formatting. Continue assigned work.

Use \`bb tasks\` help:
1. In \`project list\`, find the single tracker whose linkedBbProjectId equals this project ID. Use its prefix or ID, never a proj_ ID. If CLI unavailable or tracker missing or ambiguous, report candidate and limit; ask for a linked tracker or CLI. Never file elsewhere or create a tracker.
2. Search backlog, todo, in_progress, and in_review with relevant terms. Follow every nextCursor page with the same filters. Inspect and reuse matches.
3. \`create\` new issues with a short action title and description using the format below. Use only existing labels from \`label list\`.
4. Save only required blockers with verified task keys; never invent keys. If new cleanup needs the current change to merge first, save the new ticket as blocked by the current ticket. Never make the current ticket wait for that cleanup.
5. Report confirmed existing or new key. Missing keys or failed search, create, or dependency writes mean incomplete recording: report candidate and error, never claim success.

Record only: no unrelated cleanup, worker dispatch, notifications, or current-task status changes.

Description format for Code Cleanup follow-ups only. Count whitespace-delimited words in section bodies, excluding title and headings; no minimum.
## Summary
At most 80 words: problem, impact, desired outcome and up to three completion criteria. For maintenance work, name the current change that is difficult and how cleanup makes it easier.
## Agent context
Target at most 120 words: relevant locations, verified evidence, required safeguards, source task key when known and bbthread://THREAD_ID. Keep safeguards and briefly explain any overrun. Separate observations from uncertain causes. Link detailed reports through retrievable sources or task attachments. If evidence cannot be shared, state the limit and retain necessary facts. State each fact once.

Illustrative examples, not project findings. Replace placeholders with verified values.
### Defect: Keep keyboard focus after sheet replacement
\`\`\`markdown
## Summary
Replacing a sheet left controls without focus, blocking keyboard-only use.
Done when:
- The expected control retains focus.
- The keyboard regression passes with assertions intact.

## Agent context
Observed during [reproduction]. Start at [control/test locations]. Preserve draft and navigation behavior. Evidence: [trace]. Source: [task/thread].
\`\`\`
### Maintenance: Consolidate filter parsing
\`\`\`markdown
## Summary
Adding a label filter required matching edits in three parsers. Share parsing so the next change needs one edit.
Done when:
- Current callers share one parser.
- Existing filter checks pass unchanged.

## Agent context
Matching logic at [locations] complicated [current change]. Preserve the filter contract. Evidence: [comparison]. Source: [task/thread].
\`\`\`
### Investigation: Diagnose local browser focus failures
\`\`\`markdown
## Summary
Local focus failures prevent reliable browser validation.
Done when:
- Traces establish the cause.
- Relevant and full browser checks pass after a justified fix; report unresolved limits.

## Agent context
Current and baseline runs fail; the current change is not a proven cause. Start at [helper/tests]. Keep keyboard assertions intact. Evidence: [report/traces]. Source: [task/thread].
\`\`\``;
}
