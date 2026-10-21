# Changes

Review the diff of a bb thread file by file, and write comments on its lines. The comments collect in a pending review. One click sends them to the thread's agent as one message.

## Install

```sh
bb plugin install git:https://github.com/koenvg/bb-plugins.git@main --subdirectory bb-plugin-changes
```

Requires bb 0.45 or later (`@get-bb/plugin-sdk` 0.6.15).

## The Changes tab

Open **Changes** from the new-tab list in a thread's right panel.

- The picker selects the diff: **All changes** (default), **Uncommitted**, **Committed on branch**, or one commit of the branch.
- Branch diffs compare with `origin/<default branch>` when that remote branch exists, else with the local default branch.
- The top shows the file count and the added lines (green) and deleted lines (red), for example `2 files +34 -5`.
- **Unified view** and **Split view** are the two icon buttons next to Refresh.
- Each file has its own section. Sections show folders first, then files, by name, at each folder level: `src/ui/a.ts`, then `src/b.ts`, then `README.md`. PNG, JPEG, GIF and WebP files show before/after previews. Other binary files show "Binary file". A file that is too large shows "Diff too large". A diff loads when its section comes near the visible area.
- **Refresh** (the arrow icon) loads the diff again. The last diff stays visible while it loads.

Image previews accept up to 4 MiB per side. They load only near the visible area while expanded and release content when collapsed or scrolled away. Each failed side has its own Retry. Committed previews use pinned revisions. **All changes** and **Uncommitted** show live working-tree content on the after side, read separately from the file list. Refresh invalidates previews immediately. The SDK can allocate its larger upstream read before the plugin enforces the 4 MiB acceptance limit. SVG previews are deferred; SVG keeps its text diff, comments and viewed marks. Image previews have no line comments or viewed marks.

Video previews support MP4 and WebM containers, up to 8 MiB per side. Choose **Load before video** or **Load after video**, then use the native Play control. Videos do not autoplay. Collapse, refresh, or **Unload** releases the loaded content. Unsupported containers, codecs, and larger files show a fallback message. H.264/AAC in MP4 and VP8/VP9 with Opus in WebM pass the local Chromium playback fixture; other browsers can differ.

Git LFS pointer files remain text diffs, with their comments, drafts and Viewed controls. Video previews do not fetch LFS objects.

Video reads run on the environment's host. Historical sides use pinned Git blobs and the first parent for a single-commit comparison. Live sides read only the working tree. The host checks sizes before reading, caps output, and permits at most two concurrent video reads. SDK 0.6.49 has no range option on revision file reads or binary host-RPC transport, so previews use bounded whole-file RPC after an explicit click.

## Expand unchanged lines

Choose **Load context** in a text file's header. Then use the gap controls to expand unchanged lines above or below a change, or reveal the whole gap. The controls support Enter and Space in Unified and Split views.

Context loading keeps the original diff visible. A read failure offers **Retry context**. If the file no longer matches the patch, choose **Refresh** before loading context again. Refresh, target changes, and collapsing a file discard its loaded context.

Each file revision and patch must fit within 1 MiB and 20,000 lines. Binary files, type changes, and paths that require quoting do not support context loading. Newly revealed lines are read-only. Existing comments and Viewed marks still refer to the original patch.

## Viewed files

- Check **Viewed** in a file header to mark the file as viewed. The file collapses to its header.
- Uncheck **Viewed** to remove the mark. The file expands.
- The chevron at the start of a file header expands or collapses the file. It does not change the mark.
- The top shows how many files you viewed, for example `2/3 viewed`. Binary files and files with "Diff too large" cannot be marked, and do not count.

A mark is linked to the patch you saw. When the file changes in any way, the mark drops and the file expands again. A mark also drops when the file leaves the diff.

Marks are per thread and per diff target, so a mark on **All changes** does not show on **Uncommitted**. They stay after a bb reload. The chevron state is lost when bb reloads.

When a mark cannot be saved, the checkbox goes back and the tab shows "Could not save viewed state" with the error.

The plugin saves marks in its kv storage, one entry per thread and target:

```text
key:   viewed:v1:<threadId>:<target>     target = all | uncommitted | branch_committed | commit:<sha>
value: { "v": 1, "marks": { "<path>": "<length>:<fnv1a32 of the patch>" } }
```

## File outline

When the Changes tab is 768px wide or more, a file outline shows at the left of the diff. Make the right panel narrower and the outline goes away.

- The outline is a folder tree, like the VS Code explorer. A folder with only one subfolder shows as one row, for example `src / ui / lib`.
- Click a folder to fold or unfold it. Folding hides rows in the outline only. The diff keeps all files.
- Each file row shows a file-type icon, the file name, the number of pending comments, a status letter, and the added and deleted lines.
- Status letters: **A** added, **M** modified, **D** deleted, **R** renamed, **C** copied, **T** type changed, **U** untracked.
- Click a file to scroll the diff to it. The file stays at the top while the diffs near it load.
- The outline marks the file at the top of the diff, and follows when you scroll.
- Drag the right edge of the outline to change its width (240px to 520px). The diff always keeps at least 400px. Double-click the edge to reset to 320px. With the edge focused, the arrow keys change the width by 10px. bb keeps the width after a reload.

The file-type icons come from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) through `vscode-material-icons` (MIT). See `ui/file-icons/LICENSE`.

## Inline comments

1. Move the pointer over a line and click **+** in the gutter.
2. Type the comment. **Add to review** (or Cmd/Ctrl+Enter) adds it to the pending review. **Cancel** (or Escape) closes the form.
3. The comment shows below its line. **Remove** deletes it.

A comment on an added or context line is on the new side. A comment on a deleted line is on the old side.

When a comment's line is not in the current diff (after a refresh, or with another diff target), the comment shows in **Not in this diff** at the top. It stays in the review.

The pending review belongs to one thread. It stays when you switch tabs or threads. It is lost when bb reloads.

## Send feedback

**Send feedback (N)** opens the review prompt. It lists the comments in the same file order as the sections, then by line. You can edit it. **Send to agent** (or Cmd/Ctrl+Enter) sends it to the thread as one message, and the sent comments leave the diff. **Cancel** keeps all comments and drops your edits to the prompt.

When the agent runs a turn, bb queues the message and the tab shows "Queued until the agent is idle". Otherwise it shows "Sent to agent".

The prompt has this format:

```text
Please address the following review comments:

1. `src/a.ts:42` - Null check missing
2. `src/b.ts:10 (deleted line)` - Why remove this?

Check each comment against the current code before you change anything.
Fix the valid ones at their location.
If a comment is invalid, stale, or already addressed, do not change code for it, and explain why.
```

The plugin never commits, pushes, or writes to GitHub.

## Known limits

- bb's own Changes tab stays visible next to this one.
- The marks of deleted threads stay in kv storage.
- bb 0.44 can fail to list the branch commits for some branches. Then the picker shows no commits, and the diff still loads. The plugin log shows "Branch commits unavailable".

## Development

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
bb plugin build
```

The diff, comment form, and comment card come from [`../review-ui`](../review-ui).

Run [`test:bb-renderer`](tests/bb-renderer/README.md) to check filename controls and context expansion against running BB without installing the candidate plugin. This separate acceptance check uses BB's renderer and native file viewer. It requires an owned local thread; CI's fixture tests do not replace it.

Run [`test:video-browser`](tests/video-browser/README.md) for an unauthenticated, owned local component fixture. This proves native video playback and responsive layout, not installed BB playback or GitHub authentication.
