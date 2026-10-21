# Token fixture provenance

The light and dark variants in `tests/preview.css` copy the relevant Default built-in UI tokens from BB's served `/assets/index-C5-8cYca.css`. The read-only command `bb theme show default --json` confirmed that Default has no custom CSS. No palette was activated or changed.

CSS SHA-256: `4679becb97e823c6fe046f59935b42b28abc08e1bd73286a4c884f4b8a895c36`.

| Token | Default light | Default dark |
| --- | --- | --- |
| canvas | `oklch(100% 0 0)` | `oklch(19.5% 0 0)` |
| ink | `oklch(32.11% 0 0)` | `oklch(81% 0 0)` |
| muted-foreground | `oklch(44% 0 0)` | `oklch(78% 0 0)` |
| primary / ring | `oklch(27% 0 0)` | `oklch(82% 0 0)` |
| border | ink 14%, canvas, in OKLCH | ink 19.4%, canvas, in OKLCH |
| surface-recessed | ink 6%, transparent, in OKLab | same |
| state-hover | ink 5.9%, transparent, in OKLab | ink 13.8%, transparent, in OKLab |
| state-active | ink 11.8%, transparent, in OKLab | ink 22.5%, transparent, in OKLab |
| radius | `.5rem` | `.5rem` |

Background aliases canvas; foreground aliases ink. The custom fixture uses warm canvas, blue-black ink, a purple ring, and 12 px radius to prove live token inheritance. These are test values, not a shipped palette.

The runner rasterizes computed CSS colors to sRGB and composites translucent code surfaces over the reader background before computing WCAG contrast. It measures body text and every highlighted token foreground, including muted comments. It checks state and DOM identity across live token changes.

The plugin uses a quiet UI-token treatment for lightweight code, not BB's separate VS Code syntax-theme document. Keywords, properties, and booleans have extra weight; comments use the host muted foreground; strings have a subdued underline. No independent syntax palette or theme switch is added.

This is a controlled Default-token fixture, not certification of an installed reader, the active palette, every built-in palette, or third-party theme contrast. Host fonts and native routing remain outside this fixture. Saved provenance and measured values are linked from `ACCEPTANCE.md`.
