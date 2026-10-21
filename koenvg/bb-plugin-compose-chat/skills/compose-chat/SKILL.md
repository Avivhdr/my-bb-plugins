---
name: compose-chat
description: Configure Compose Chat's speed borders in BB. Use when switching Electric and Glow, pausing Electric motion, or troubleshooting this plugin's border cost.
---

# Compose Chat speed borders

Inspect effective settings with `bb plugin config compose-chat --json`.

When requested, set `speedBorder` to `Glow`, `Electric`, or `Off`. Set `electricMotion` to `false` for static Electric rendering. Saves apply live without reload.

Electric uses continuous rendering for visible Fast/Ultrafast composers, capped at 15 fps. Low visual intensity does not establish low CPU/GPU cost. Prefer Glow or Off when rendering cost is a problem.

Preserve native drafts and controls. Speed borders follow the selected tier, not measured response speed. Verify live behavior where possible and report limits when BB browser access or performance measurements are unavailable.
