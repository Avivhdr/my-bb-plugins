# Threads with PRs

A selectable BB sidebar thread list. It shows threads in three tabs and the PR status beside each thread. The PR status comes from the **github-insight** plugin. This plugin stores no Git host credentials.

Build: `bun install --frozen-lockfile && bb plugin types && bb plugin build`. Install locally: `bb plugin install .`. Choose **Threads with PRs** in Settings → Appearance → Sidebar. The bundled **Thread list** stays installed and can be selected again at any time.

## Requirements

- Install and enable the **github-insight** plugin. It needs the GitHub CLI (`gh`), signed in.
- Without github-insight, rows show no PR badge, the tabs use only thread signals, and a notice above the rows says that PR status needs it.

## Tabs

The tabs above the rows are **Needs attention**, **In flight**, and **All**. They show no counts. Use the arrow keys to move between them. The list opens on the tab you used last, or on **Needs attention** the first time.

**Needs attention** and **In flight** show only active threads. Each active thread is in one of them. The first rule that matches decides:

| Rule                                                                                                     | Tab                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Is snoozed                                                                                               | Neither (shows in **Snoozed** in All) |
| Waits for an approval or an answer, has an unread error, or has a queued message that failed to send     | Needs attention                       |
| Has unread output                                                                                        | Needs attention                       |
| Runs, has background work, or has a queued message that waits                                            | In flight                             |
| Has an active child thread, at any depth (runs, has background work, has a queued message, or needs you) | In flight                             |
| Has no PR, or no usable PR summary                                                                       | Needs attention                       |
| Open PR has a failed merge queue entry                                                                   | Needs attention                       |
| Open PR is queued or merging in a merge queue                                                            | In flight                             |
| PR has failed checks, a check waiting for you, requested changes, conflicts, or unresolved comments      | Needs attention                       |
| Open PR has checks running or waits for a required review                                                | In flight                             |
| Any other PR (ready, draft, behind, blocked, merged, closed)                                             | Needs attention                       |

A thread tree moves as one unit. The first matching tree-wide rule decides its tab:

1. If any eligible member needs input or approval, has unread output or an unread error, or has a failed queued message, the whole tree shows in **Needs attention**.
2. Otherwise, if any eligible member runs, has background work, or has a queued message waiting, the whole tree shows in **In flight**, even when another member has conflicts, failed checks, requested changes, unresolved comments, or a failed merge queue entry.
3. Otherwise, the existing idle-thread and PR rules apply. The top eligible thread can put the tree in **Needs attention**, and a child's PR problem can pull it there. A finished child with no PR, or with a ready, draft, merged, or closed PR, does not move its tree.

Only non-hidden, non-archived, non-snoozed members contribute signals. Dimmed context rows do not. Each child stays under its parent, and PR problem badges remain visible in **In flight**. When the last working member stops, the tree rechecks its idle-thread and PR rules without a reload.

Selecting a tree keeps it in its existing **Needs attention** or **In flight** tab until selection leaves the tree or is cleared. Moving between its parent, children, siblings, and grandchildren keeps that tab. Reading output, finishing work, and new attention or PR signals do not move the selected tree. Read markers, work indicators, and PR badges still show current data, so a held **In flight** tree can need attention.

When selection leaves, the tree immediately follows the current rules above. Archive, hide, removal, and snooze take priority over the hold. Switching tabs keeps the hold while the sidebar stays mounted; **All** still uses its normal grouping. The hold is not saved. Remounting the sidebar or reloading uses current natural placement.

**All** shows every thread, with the **Needs you** group on top and the **Snoozed** group at the bottom.

The tab of a thread does not depend on whether its row is on screen. The `summary-watch` service on the plugin server reads the github-insight summary of every active thread every 5 seconds. When a summary changes, it sends a `summaries.changed` realtime signal, and the list loads the summaries again. github-insight refreshes a PR when its thread goes idle, so a PR that an agent opens or pushes to shows within seconds. Changes on GitHub only, such as a finished check, come from github-insight's 60 second poll. When you resolve or unresolve a review thread in the Files sub-tab of github-insight's PR tab, the list asks at once. As a fallback, the list also asks once a minute and when the connection comes back.

## Snooze

Open the thread menu and select **Tomorrow** at 9:00 the next day or **Next week** at 9:00 next Monday. The times use the clock of the client. On Sunday, the menu shows only **Tomorrow**. Snooze includes the selected thread and all its existing active, non-hidden descendants, including grandchildren, collapsed rows, offscreen rows, and children in other projects. Selecting a child leaves its ancestors and siblings alone. Archived and hidden threads are untouched, but their active descendants can still be included. Children created after the action do not inherit the snooze.

Snooze is unavailable if the selected thread is archived or hidden, or any included member waits for an approval or answer, has an unread error, or has a queued message that failed to send. A running member without those signals does not block it. Existing descendant snoozes are replaced by the parent's new shared deadline.

Snooze marks every included member read without stopping running work. The members leave **Needs attention** and **In flight** together. In **All**, they stay nested in **Snoozed**, with the shared wake time in place of each age. Snoozed ancestors still appear as dimmed context rows for awake threads outside the captured group.

The whole stored group wakes and returns through the normal tree-tab rules when:

| Event                                                                                                                              | Unread behavior                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| The shared deadline comes, checked each minute on the server even with no client open                                              | Remaining non-archived members are marked unread                                                     |
| You select **Wake now** on any member, in its menu or the palette                                                                  | Read state is unchanged                                                                              |
| Any member completes or fails a run                                                                                                | BB's signaling member keeps its ordinary attention/unread state; other members are not marked unread |
| Any member waits for approval or an answer, has an unread error, or a queued message fails, as observed by an open plugin frontend | The group wakes without manufacturing unread output on other members                                 |

Archiving one member removes only that member's snooze. Other members stay snoozed and still wake together. Unarchive does not restore membership. PR-only changes and attention signals from threads outside the captured group do not wake it.

If marking a member read fails, no partial new snooze group is saved or published, and previous snoozes remain. Earlier successful read updates cannot be rolled back atomically, so some members may have become read even though snooze failed.

The server orders snooze read updates and scheduled unread updates through one queue. A replacement snooze waits for an in-flight sweep, then marks its members read. The sweep checks captured group ownership again before each unread call, so an intervening manual or terminal wake stops updates to the remaining members. Terminal-event capture starts when the snooze request enters that queue, before hierarchy loading.

Snoozes are stored in the plugin's database on the BB server, so all clients show the same snoozes. BB's bundled **Thread list** does not show them, but the server still wakes snoozed threads on time.

The database upgrade preserves old snoozes as independent one-member groups. Deploy and reload the server and frontend together. An older plugin can still read the original columns after rollback, but wakes members independently. Upgrading again assigns groups to new old-version rows. If old code changed a member's deadline or snooze timestamp, re-upgrade splits that inconsistent group into independent members while preserving their times. Untouched groups retain their membership, and equal deadlines never merge unrelated snoozes.

### Command palette

The palette has three commands:

- `Threads: Snooze until tomorrow`
- `Threads: Snooze until next week`
- `Threads: Wake now`

They target BB's currently focused thread, including the focused pane in a split view. The sidebar can be closed and the row can be offscreen. There are no default shortcuts. Assign your own in BB's Keyboard settings.

Menu and palette actions use the same captured subtree and stored group. Snooze commands appear only for a known, active, non-hidden thread with no active snooze, when no included descendant has a blocking attention signal. Waiting for an approval or answer, an unread error, or a failed queued message blocks snooze anywhere in the subtree. Running alone does not. Wake now appears only for an active snooze, not one that expired or received an early-wake signal. Inapplicable commands are absent, not disabled. All three stay hidden with no focused thread, an unknown thread, loading or failed required state, or a stopped plugin frontend.

The commands use the same client-local 9:00 presets as the menu. Next week is absent on Sunday because it equals Tomorrow. Execution checks the current focus, latest observed state, and local date again. A stale entry or shortcut does nothing when its action is no longer applicable. Snooze marks all included members read without stopping their runs. Wake now on any member ends the stored group's snooze without changing read state.

Commands work while this plugin's frontend is enabled even when another sidebar provider is selected. Only **Threads with PRs** displays the **Snoozed** group. Snooze loading and early wakes belong to the app-wide owner, not individual sidebar rows.

Approval, answer, unread-error, and queued-send early wakes require an open frontend with this plugin enabled. The owner observes those signals even with the sidebar closed. Run completion, failure, and the minute deadline sweep use server handlers and work with no client open. The final eligibility check uses the latest observed frontend state; it is not an atomic server attention check.

## List preferences

Open **List options** to group by project, machine, or custom section and to change the sort order. In **All**, List options also selects Active, Archived, or Both. The other tabs ignore this choice. Group and parent-thread headers collapse their descendants. The top thread of a tree decides its group and its pin: a tree shows in the project, section, or machine of its top thread, and in **Pinned** only when the top thread is pinned. Pinned trees stay at the top of their tab. When the archived selection leaves out the parent of a shown thread, and the list has that parent loaded, the parent shows as a dimmed row. It does not count in the group count. A child of a hidden or not loaded parent shows as a top-level row.

These choices, and the selected tab, are saved on this client under a versioned plugin key. They do not migrate from BB's bundled list. **Reset list preferences** restores the defaults: Needs attention, project grouping, active threads, newest first. If browser storage is unavailable, the list still works, but choices last only until reload.

## Triage

In **All**, **Needs you** sits above all other groups. It holds every tree with one or more threads that wait for an approval or an answer, have an unread error, or have a queued message that failed to send. The whole tree shows there, with its nesting.

Each row starts with the agent's logo. A red dot on the logo means the thread needs you. A blue dot means it is unread. The top right shows what the thread does now (**Needs you**, **Failed**, **Not sent**, **Working**, **Planning**, **Draft**, and similar), or its age when it does nothing. Live states use a nine-cell spiral lattice in the original status spinner's position and size. Reduced-motion users see a static lattice.

## PR badges

A thread row with a PR shows a PR icon on the right of the second line. The PR icon is draft, merged, or closed. For an open or draft PR, its colour shows checks: green when all passed, amber while running, red when one failed, grey when unknown. Hover it for the PR number. Each merge blocker that github-insight reports has an icon: conflicts, checks failed, checks waiting for you, changes requested, blocked, checks running, awaiting review, and unresolved comments. A check waits for you when github-insight sees a pending commit status, such as a Chromatic UI review, that has had no update for 3 minutes after every other check finished. Problems come first. Failed checks, waiting checks, running checks, and pending reviews show a count, and the tooltip names them. Only problems (**Checks failed**, **Changes requested**, **Conflicts**, **Blocked**), **Ready**, **Merged**, and the merge queue states below also show a word. A branch that is out of date gets no icon. It shows only in the tooltip. A merged PR shows its icon and word in purple.

An open PR in a merge queue shows its queue state instead of its blockers:

| Queue state       | Word             | Tone    | Icon           |
| ----------------- | ---------------- | ------- | -------------- |
| `queued`          | **Queued #N**    | waiting | none           |
| `awaiting_checks` | **Queued #N**    | waiting | running checks |
| `merging`         | **Merging**      | ready   | none           |
| `failed`          | **Queue failed** | problem | checks failed  |

A summary without `mergeQueue`, or with an invalid one, reads as not queued.

The left of the second line shows queued messages and background work (workflows, agents, commands, plan mode, goals) as icons with counts. When there is none, it shows the branch. Clicking anywhere on the PR badge opens that row's thread and selects its PR tab in BB. Focus the badge and press Enter or Space for the same action. It does not open a browser tab; external GitHub links remain available inside the PR panel. Threads that share an environment show the same PR.

There is no badge while the summaries load, when there is no PR, or when the summary is not usable. An open or draft PR summary older than one hour is not usable. A merged or closed PR summary stays usable at any age. No badge does not mean that checks passed or that a PR was closed.

## Rollout and fallback

Try the plugin on one client first. In Settings → Appearance → Sidebar, select **Threads with PRs**. To roll back, select **Thread list** there; both plugins remain installed, and no thread or PR data needs migration. The replacement's grouping and collapse settings are separate from the bundled list's settings, so switching back does not overwrite them.

Before daily use, note the current parity gaps: group ordering and row density do not exactly match the bundled list; there is no hover-to-archive button, section reorder/delete, or group hide control. Archive, section rename, and thread actions remain available through menus. The plugin currently offers project, machine, and section grouping, not every bundled presentation detail. Recheck these interactions and the experimental SDK contract after BB updates.
