# Compose Chat

A new, independent restyle of BB's native chat, inspired by [Kiki's Compose component](https://21st.dev/@laziekiki/components/compose).

The writing area and follow-up footer share a lightly tinted rounded frame with a faint border, fine divider, and soft shadow. Typing does not add a separate dark outline. Replies stay unboxed. User messages and code use quiet, theme-derived surfaces. Buttons have visible keyboard focus and larger touch targets. BB still owns every input, picker, attachment, voice control, and send/stop action. Compose Chat adds keyboard access to the native voice controls.

A small nine-dot arrow sweep appears inline beside active tool and Thinking titles inside the conversation. The standalone status above the composer stays native. The lattice uses theme ink with no glow, disappears when an activity completes, and adds no chat DOM or animation dependency. Hidden tabs and BB's collapsed indicators pause the loop. Reduced motion shows a static lattice and removes the subtle standalone-button press animation.

Active rows use the lattice in place of their native activity glyph, keeping one 20px icon/text column. Grouped tool rows indent by that same column; completion restores the native glyph without shifting text.

Fast and Ultrafast have two selectable borders, using the approved gold palette in dark mode and cyan palette in light mode. Glow is the default and has no idle animation. Ultrafast Glow starts at the top-right and bottom-left corners, with the angle calculated from the frame dimensions. Electric uses the approved 15 fps preset and runs only for visible Fast/Ultrafast composers. Normal stays quiet. The effect follows BB 0.46 model-picker title metadata, not measured response speed; missing or changed metadata leaves the normal frame.

Glow follows pointer movement across the page, including outside the composer. It resets when the pointer leaves the page or the window loses focus. Pointer updates use at most one scheduled frame and do not start an idle animation loop.

## Speed border settings

Open **Settings → Installed plugins → Compose Chat**. **Speed border effect** offers **Glow**, **Electric**, and **Off**. Changes apply live without reload. **Animate Electric border** starts enabled, matching the approved preset; turn it off for a static Electric border. Reduced motion, hidden windows, hidden/clipped composers and modal dialogs stop Electric motion. Switching to Glow or Off disposes its renderer. Electric still costs GPU/CPU work when running; its limits are not a live-performance guarantee. The old inherited-angle metallic animation is removed.

The exact approved values live in `speed-settings.ts`. Fast uses 75% of the selected intensity, speed, arc density and glow intensity. Ultrafast uses the full values. Decorations are inert SDK-owned overlays; native nodes, draft contents and controls are never copied, moved or replaced.

React Bits Electric Border and Border Glow are vendored under `effects/react-bits/`. Their MIT + Commons Clause license is preserved in `effects/react-bits/LICENSE.md` and component notices. Local adaptations bound rendering and enforce pause/reduced-motion/arc cleanup. The plugin is an integrated application feature, not a standalone component library.

## Install

Requires BB 0.46 or newer. From this directory:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run build
bb plugin install .
```

Before enabling Compose Chat, disable Beautiful Chat or another chat restyler yourself. Both plugins target BB's markup; their overlapping CSS is not a supported combination. Compose Chat does not disable or replace any other plugin.

Disable it with the CLI. A visible, connected BB window removes the styling live:

```sh
bb plugin disable compose-chat
```

BB defers plugin updates in hidden tabs until they become visible. Current native checks confirmed cleanup on visibility return without refreshing. Reload remains a recovery option for a stale or disconnected client.

A local installation points to this checkout. Do not retire its worktree while you still use it; install from a durable checkout instead.

## Voice keyboard controls

With focus in the composer, press **Ctrl+Shift+Space** to start recording. Use Control on Mac, not Command. Change or remove Compose Chat's **Start voice input** shortcut in BB's Keyboard settings. The operating system can intercept a shortcut; use another binding if needed.

Press **Enter** during recording to stop and transcribe into the draft. This does not send. Enter does nothing during transcription. After completion, edit the draft or press Enter again to send normally. A held Enter cannot send when transcription completes. **Escape** keeps BB's native cancellation behavior. Enter on the focused cancel button also cancels.

These controls use native BB 0.44 and 0.45 attributes and button labels, not a public voice API. Enter uses "Stop and transcribe recording" or "Stop and add to draft", never "Send voice input". Missing or changed controls cause no voice action. Repeated starts are blocked while microphone permission is pending. A new native "Voice input failed" notification releases that guard. If a host update changes error markup, disable and enable the plugin to reset it. Pointer controls remain native. Focus is restored only for keyboard-controlled sessions while focus still belongs to their composer.

## Scope

- Uses the active theme's colors, font, and radius. The speed borders alone use the approved theme-specific gold or cyan colors. No theme switch or custom font.
- Preserves native compact mode, footer visibility, input layout, focus order, and mobile drawer/keyboard behavior.
- Adds a configurable Start voice input command, not a replacement composer or recorder.
- Does not read or write messages, drafts, or audio. Only BB's plugin settings persist. No plugin HTTP/RPC surfaces, custom storage, or polling.
- Public SDK content scripts own style markers and voice-keyboard listeners. A DOM observer reads native voice state and error-title metadata. Abort removes all listeners and observers and restores owned attributes. BB owns frontend generation updates.

BB's chat DOM is not a public API. The selectors were checked against the BB 0.44 and 0.45 frontend source. A future host release can require selector changes. The user-bubble selector also depends on BB's current message wrapper classes.

## Develop and test

```sh
bun run test
bun run typecheck
bb plugin types . --check
bun run build
```

### Browser matrix

Use Bun 1.4.3. From this package:

```sh
bun install --frozen-lockfile
bun --bun run playwright install chromium
bun run test:browser
```

The pinned Playwright Test 1.64.0 runner starts its own Chromium browser. It uses a fresh context for each case, never a signed-in profile or an existing browser. No Python, Browser Use, BB CLI, manual server, or daemon variables are needed. On Linux, use `bun --bun run playwright install --with-deps chromium` if browser system libraries are missing.

`bun run test:browser` starts this checkout's fixture before Playwright loads its config. The server binds `127.0.0.1` port `0` once and reports its actual bare origin. The runner retains that listener during the tests. All remaining command arguments go to local Playwright unchanged. Raw `playwright test` calls fail without the runner's handoff.

The server builds `tests/effects-fixture.tsx`, which imports the real `app.tsx` entry, decorator, and CSS with esbuild on every run. It serves assets in memory at the existing `dist/app.js` and `dist/app.css` URLs. It does not overwrite a BB build in `dist/`. Only fixture assets are served, with caching disabled and GET/HEAD access only.

Direct previews also bind port `0` and print the actual URL. Run `bun tests/preview-server.ts`. To request a specific port for direct previews or browser tests, set `COMPOSE_CHAT_PREVIEW_PORT=56429`. Values must be integers from `0` through `65535`. Empty or malformed values fail. An occupied explicit port fails without reusing or replacing the existing listener.

The wrapper owns a fresh temporary parent, even though this fixture builds only in memory. On success, test failure, startup failure, or cancellation, it stops its owned POSIX process groups before removing only that parent. Browser evidence and product `dist/` remain. Assertions, navigation errors, build errors, and timeouts fail the command. Retries stay disabled. SIGKILL of the runner and host crashes cannot run cleanup.

Separate worktrees have separate default evidence paths. Concurrent runs in one checkout or with the same explicit `--output` can overwrite evidence. From the repository root, `bun scripts/verify-concurrent-browser-worktrees.mjs /tmp/bbp-196` verifies concurrent Chromium runs for all three plugins. It checks distinct origins and changed checkout markers, retains evidence, and removes its two owned verification worktrees. It reuses installed locked dependencies without browser setup or suite retries.

`bun run test` still runs Vitest. Its only discovery change excludes `tests/browser/**`, where Playwright's `*.spec.ts` files live. `browser-evidence.test.ts` retains the complete-PNG and backing-pixel safeguards. The Python daemon/session contract tests were removed because the runner no longer connects to user browsers.

Coverage from `tests/browser-matrix.py` maps one-to-one to the same case names in `tests/browser/matrix.spec.ts`:

| Original cases                                             | Preserved coverage                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `hero-dark`, `desktop-dark`, `desktop-light`, `user-width` | Desktop geometry, dark/light themes, four viewport PNGs                    |
| `mobile-dark`, `mobile-light`                              | Touch hit areas, hidden native footer, two viewport PNGs                   |
| `custom-tokens`                                            | Custom theme colors and radius                                             |
| `compact-dark`, `compact-touch`                            | Independently framed compact composer and hidden native footer             |
| `new-thread`, `new-thread-touch`                           | Joined native footer and outward shadow                                    |
| `disabled-action`                                          | Disabled submit semantics                                                  |
| `reduced-motion`                                           | Static lattice and disabled transitions                                    |
| `long-draft`                                               | Long native draft and no horizontal overflow                               |
| `split-send-empty`, `split-send-draft`                     | Native split-send dimensions, joined corners and zero-width hidden options |

All 16 cases run the `tests/browser-checks.js` assertions, including native-node identity/order after excluding owned decorations through the existing `tests/preview.html` fixture. These include contrast, lattice and glyph alignment, native Thinking expansion, animation states, draft/node identity, native submit behavior, style abort/re-enable and unrelated-editor isolation. Every case also uses a real Tab key event to check native order, `:focus-visible` and the focus outline width.

Results are in `test-results/results.json` and the HTML report in `playwright-report/`. Each case attaches its named checks as JSON. The six original PNG filenames and their `.provenance.json` files are in per-case `test-results/` folders and attached to the report. Provenance records the viewport, validated PNG dimensions, pixel ratio, SHA-256 and hashes of the served build and fixture sources. The pixel ratio is fixed at 1 for repeatable dimensions. Failure screenshots and traces are retained. These directories are ignored by Git and replaced on the next run; copy them before rerunning if needed. Inspect the six images for clipping; PNG validation alone is not visual acceptance.

To rerun only the split-send regression cases:

```sh
bun run test:browser --grep split-send
```

To put per-case files in a separate directory, use `--output`. The JSON and HTML reports still use their configured paths:

```sh
bun run test:browser --output /tmp/compose-chat-evidence
```

The 16 cases and six screenshots are synthetic fixture evidence, not an installed native-BB acceptance check. Standalone actions get larger touch targets. Native split-send controls keep BB's joined corners and original widths, including the zero-width hidden options segment.

Unit tests exercise the SDK's actual content-script registration and cleanup, draft/control preservation, scoped CSS, theme-token use, keyboard focus, disabled actions, touch rules, and reduced motion.

The development fixture in `tests/preview.html` represents inspected native composer hooks, with synthetic conversation content. It is not a replacement chat UI and is never registered by the plugin. Browser checks against the fixture do not replace an installed native-BB activation check.

## Design reference

Compose is listed by its author under MIT. This plugin borrows its visual idea, not its source code, avatar assets, autocomplete implementation, animation library, or character-counter logic. No third-party component or generated mockup is shipped in the runtime bundle.
