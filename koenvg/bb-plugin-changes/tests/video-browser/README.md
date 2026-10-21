# Local video playback fixture

Run from the repository root with Bun 1.4.3, Node 24, the locked Changes dependencies, ffmpeg, and the package's pinned Playwright Chromium.

```sh
bun install --cwd bb-plugin-changes --frozen-lockfile
(cd bb-plugin-changes && bun --bun run playwright install chromium)
VIDEO_BROWSER_EVIDENCE="$BB_THREAD_STORAGE/video-playback-$(date +%Y%m%d-%H%M%S)-$$" \
  bun run --cwd bb-plugin-changes test:video-browser
```

The evidence directory must not exist. The runner generates small red MP4 H.264/AAC and blue WebM VP8/Opus and VP9/Opus clips in its own temporary directory. It serves the production `ReviewVideoDiff` component on an OS-assigned loopback port. The production workspace reader handles requested fixture bytes. No BB session, installed source, credentials, GitHub access, test thread, or PR is used.

At widths of 960 and 320 pixels, the check loads each side through its button and starts playback through the native keyboard control. It verifies decoded red and blue frames, no eager reads, controls without autoplay, responsive side placement, no horizontal overflow, and unloading. The report includes Chromium's codec capability answers. Capability answers alone do not prove decoding; the frame assertions do.

`report.json` and screenshots remain in the evidence directory. The runner closes its browser and listener and removes its own temporary clips, including on failure. This is local component and workspace-reader evidence, not installed BB playback or private/fork authentication acceptance. The separate BB renderer check remains necessary for BB-owned filename controls and requires its own browser approval.
